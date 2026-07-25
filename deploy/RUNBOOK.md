# AgentOverflow VM — Ops Runbook

End-to-end: zero → GCP VM → corpus ingested → Convex wired up → downsized and
cheap. Every command is copy-pasteable. Shell vars you must fill in are
UPPER_CASE placeholders.

## 1. Prerequisites

- `gcloud` CLI installed and authenticated:

  ```bash
  gcloud auth login
  gcloud config set project YOUR_PROJECT_ID
  ```

- A GCP project with billing enabled — the $300 free-trial credit covers this
  entire setup for 3+ months (budget table at the bottom).
- Access to the agentoverflow repo and to the thalamus Convex dashboard.

## 2. Create the VM

```bash
cd deploy
PROJECT=YOUR_PROJECT_ID ZONE=us-central1-a ./setup-gcp.sh
```

Creates an `e2-standard-4` (debian-12, 30GB boot), two data disks, a firewall
rule for tcp:80/443, a daily snapshot schedule, and a startup script that
installs docker + the compose plugin + git + p7zip-full + aria2 and mounts the
disks. Re-running is harmless.

The disk layout is the important part:

| Mount      | Disk         | Type        | Survives instance delete | Holds                          |
| ---------- | ------------ | ----------- | ------------------------ | ------------------------------ |
| `/data`    | `ao-data`    | pd-balanced | yes — `auto-delete=no`   | docker data-root → the corpus  |
| `/scratch` | `ao-scratch` | pd-standard | yes — `auto-delete=no`   | dumps + shards, disposable     |

Docker's data-root is moved to `/data/docker` *before* any volume exists, so
`qdrant_data` and `pg_data` — the corpus — land on the disk that outlives the
instance. The VM also gets `--deletion-protection`, so deleting it is refused
outright until someone explicitly disarms the flag first.

Spot note: SPOT is ~70% cheaper and preemption stops the VM rather than
deleting it. `PREEMPTIBLE_CPUS=0` does *not* block it — Spot draws on standard
CPU quota, which is worth knowing because the quota page makes it look
otherwise. It is still off by default: nothing here restarts a preempted
instance, so it sits stopped until you run `gcloud compute instances start
agentoverflow --zone=us-central1-a`, and a stalled day during a two-week embed
costs more than the discount saves. Turn it on with `SPOT=1` once something is
watching the instance. Stages resume at pass granularity: a finished pass never
repeats, an interrupted one restarts clean.

## 3. SSH in

Give the startup script ~2-3 minutes, then:

```bash
# a named user, not root — debian-12 refuses root logins
gcloud compute ssh aoops@agentoverflow --zone=us-central1-a
# verify the startup script finished:
sudo docker --version && git --version && aria2c --version | head -1
# run docker without sudo:
sudo usermod -aG docker $USER && newgrp docker
```

Check the disks came up before you touch anything else:

```bash
df -h /data /scratch
sudo docker info | grep "Docker Root Dir"   # must print /data/docker
```

If `Docker Root Dir` is anything but `/data/docker`, stop here and fix it. Any
volume created before that point is sitting on the boot disk, which is exactly
the mistake this layout exists to prevent.

## 4. Clone the repo

```bash
git clone https://github.com/YOUR_GH_USER/agentoverflow.git
cd agentoverflow
```

## 5. Configure secrets

```bash
cp deploy/.env.example deploy/.env
# fill in both values; generate each with:
openssl rand -hex 32
nano deploy/.env
```

`AO_INTERNAL_SECRET` is the shared secret between Convex and this VM — you
will paste the same value into the Convex dashboard in step 9.

## 6. Start the stack

```bash
cd deploy
docker compose up -d --build
docker compose ps          # wait until all three services are "healthy"
```

First build takes a few minutes (it pre-downloads the embedding model).
Postgres creates the `documents` / `doc_tags` / `doc_links` tables from
`init.sql` on first boot.

Quick local health check:

```bash
source .env
curl -s -H "X-AO-Internal-Secret: $AO_INTERNAL_SECRET" http://localhost:8080/internal/health
# {"ok":true,"qdrant":true,"postgres":true,"points":0}
```

## 7. Run the ingestion pipeline

Full stage docs live in `../ingestion/README.md` — that file is authoritative
for flags and config (`ingestion/config.toml`). Summary:

```bash
cd ~/agentoverflow
sudo apt-get install -y python3-venv
python3 -m venv .venv && source .venv/bin/activate
pip install -r ingestion/requirements.txt
```

Run the stages inside tmux — the long ones outlive any SSH session:

```bash
sudo apt-get install -y tmux && tmux new -s ingest
python -m ingestion download      # ~1-2 h   (archive.org SO dump, ~60 GB)
python -m ingestion filter        # ~4-8 h   (stream-parse Posts.xml)
python -m ingestion score         # fast     (heuristic 0-10, drops <5)
python -m ingestion rescore-llm   # optional (Gemini re-score, ~$20-60; skippable)
python -m ingestion embed-load    # ~12-24 h (embeddings -> Qdrant, text -> Postgres)
python -m ingestion graph-load    # fast     (PostLinks -> doc_links, doc_tags)
```

Every stage is resumable; if the spot VM gets preempted, start it again and
re-run the interrupted stage. Detach tmux with `Ctrl-b d`, reattach with
`tmux attach -t ingest`.

## 8. Pin the external IP

Stop/start cycles change an ephemeral IP, which would silently break the
Convex → VM URL. Promote it to static once:

```bash
IP=$(gcloud compute instances describe agentoverflow --zone=us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
gcloud compute addresses create ao-ip --region=us-central1 --addresses="$IP"
echo "VM IP: $IP"
```

## 9. Wire up Convex

In the thalamus Convex dashboard → Settings → Environment Variables, set:

| Variable             | Value                                        |
| -------------------- | -------------------------------------------- |
| `AO_VM_URL`          | `https://api.<your-domain>` once the TLS edge in step 11 is up (interim: `http://<VM_IP>:8080`) |
| `AO_INTERNAL_SECRET` | same value as in `deploy/.env`               |
| `AO_FRONTEND_URL`    | the AgentOverflow Pages URL (e.g. `https://agentoverflow.pages.dev`) |

## 10. Smoke tests

From your laptop (`VM_IP` from step 8, `SECRET` from `deploy/.env`):

```bash
VM_IP=1.2.3.4
SECRET=your-ao-internal-secret

# health — expect ok:true and a 7-figure points count after ingestion
curl -s -H "X-AO-Internal-Secret: $SECRET" http://$VM_IP:8080/internal/health

# search
curl -s -X POST http://$VM_IP:8080/internal/search \
  -H "X-AO-Internal-Secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"query": "flatten a nested list in python", "top_k": 3}'

# ingest — expect 200 {"vm_doc_id":"learning-smoke1"}
curl -s -X POST http://$VM_IP:8080/internal/ingest \
  -H "X-AO-Internal-Secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"doc_id":"learning-smoke1","title":"Smoke test doc","problem":"A uniquely phrased smoke-test problem about frobnicating widgets.","solution":"Enable the frob flag.","tags":["smoke"],"score":5,"tier":"low","source":"learning","url":null}'

# dedup — same content, DIFFERENT doc_id: expect HTTP 409 {"error":"duplicate","duplicate_of":"learning-smoke1"}
curl -s -w "\n%{http_code}\n" -X POST http://$VM_IP:8080/internal/ingest \
  -H "X-AO-Internal-Secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"doc_id":"learning-smoke2","title":"Smoke test doc","problem":"A uniquely phrased smoke-test problem about frobnicating widgets.","solution":"Enable the frob flag.","tags":["smoke"],"score":5,"tier":"low","source":"learning","url":null}'

# cleanup — expect {"ok":true}
curl -s -X DELETE http://$VM_IP:8080/internal/item/learning-smoke1 \
  -H "X-AO-Internal-Secret: $SECRET"
```

Also confirm no secret = no service:
`curl -s -o /dev/null -w "%{http_code}\n" http://$VM_IP:8080/internal/health` → `401`.

## 11. Public API & TLS edge (Caddy)

Agents hit the corpus through `https://api.<domain>/v1/*` — a public,
bearer-authed surface served straight from the VM, so a search never touches
Convex. Caddy terminates TLS in front of the api container, which now binds
`127.0.0.1` only.

1. DNS: add an **A record** pointing the API hostname at the static IP from
   step 8. It has to be an A record — a CNAME can't target a bare IP.

   | Type | Name                | Value     | TTL |
   | ---- | ------------------- | --------- | --- |
   | A    | `api.<your-domain>` | `<VM_IP>` | 300 |

2. Put that hostname in `deploy/.env` so Caddy knows what cert to request:

   ```bash
   echo "AO_API_HOST=api.<your-domain>" >> deploy/.env
   ```

3. Open 80/443 and drop the legacy world-open 8080 rule (re-running
   `setup-gcp.sh` does both), then bring the edge up:

   ```bash
   cd deploy && docker compose up -d
   docker compose logs -f caddy   # watch the Let's Encrypt cert issue — needs DNS live
   ```

4. Point Convex at the TLS endpoint (dashboard → Environment Variables):
   set `AO_VM_URL` to `https://api.<your-domain>`.

5. Public smoke test — no internal secret, this is the agent-facing surface:

   ```bash
   curl -s https://api.<your-domain>/v1/health
   # search needs a real ao_ key issued from the site:
   curl -s -X POST https://api.<your-domain>/v1/search \
     -H "Authorization: Bearer ao_YOURKEY" -H "Content-Type: application/json" \
     -d '{"query":"flatten a nested list in python","top_k":3}'
   ```

Keys sync Convex → VM every 2 minutes (`sync agentoverflow keys to vm` cron),
so a new key works within ~2 min and a revoked one dies just as fast. Free tier
is 10k searches/day per key; higher contribution tiers lift it (CONTRIB_TIERS).

## 12. Downsize after ingestion

Serving needs half the machine ingestion did:

```bash
gcloud compute instances stop agentoverflow --zone=us-central1-a
gcloud compute instances set-machine-type agentoverflow --zone=us-central1-a \
  --machine-type=e2-standard-2
gcloud compute instances start agentoverflow --zone=us-central1-a
```

Optionally convert SPOT → on-demand for guaranteed uptime (while stopped):

```bash
gcloud compute instances set-scheduling agentoverflow --zone=us-central1-a \
  --provisioning-model=STANDARD
```

If your gcloud version lacks that flag, staying on spot is fine — it's
cheaper; the tradeoff is occasional preemption (auto-restarts on `start`,
containers come back via `restart: unless-stopped`).

After the restart: `docker compose ps` on the VM, then re-run the step-10
health curl. The static IP from step 8 means Convex needs no changes.

## 13. When the VM dies

The corpus is on `ao-data`, not on the instance. Losing the VM — preemption,
a bad upgrade, someone deleting it — costs you the box, not the data. Three
layers, worst case first.

**The instance is gone, disks are fine.** The usual case, because
`auto-delete=no` detaches the disks instead of destroying them. Confirm, then
rebuild around them:

```bash
gcloud compute disks list --zone=us-central1-a          # ao-data should be READY, no users
PROJECT=YOUR_PROJECT_ID ZONE=us-central1-a ./setup-gcp.sh
```

`setup-gcp.sh` skips disks that already exist and attaches them to the new
instance, so this reattaches the corpus as-is. Re-clone the repo, restore
`deploy/.env`, `docker compose up -d`, done — the qdrant and postgres volumes
are already populated under `/data/docker`.

**The disk is gone too.** Restore from the daily snapshot — retention is 7
days and `keep-auto-snapshots` means they survive the disk's deletion:

```bash
gcloud compute snapshots list --filter="sourceDisk~ao-data" --sort-by=~creationTimestamp
gcloud compute disks create ao-data --zone=us-central1-a \
  --source-snapshot=SNAPSHOT_NAME --type=pd-balanced
```

Then run `setup-gcp.sh` as above. You lose at most a day of ingestion.

**Everything is gone.** Re-ingest from scratch: the pipeline's only real input
is the public archive.org dump, so nothing is unrecoverable, it just costs the
compute again. `make all` from step 7, roughly two weeks on an e2-standard-4.

Deletion protection means step one of any *intentional* teardown is disarming
it first:

```bash
gcloud compute instances update agentoverflow --zone=us-central1-a \
  --no-deletion-protection
```

## 14. Budget

Estimates at July 2026 GCP list prices, us-central1 (spot prices float;
treat every number here as an estimate, and set a budget alert regardless):

| Item                                            | Est. cost             |
| ----------------------------------------------- | --------------------- |
| Ingestion ~2 weeks: e2-standard-4 (~$0.134/h)    | ~$45 one-off          |
| Serving: e2-standard-2 on-demand (~$0.067/h)     | ~$49 / month          |
| 150 GB `ao-data` pd-balanced ($0.10/GB-mo)       | ~$15 / month          |
| 30 GB boot pd-balanced                           | ~$3 / month           |
| 300 GB `ao-scratch` pd-standard ($0.04/GB-mo)    | ~$12 / month, ingest only |
| Daily snapshots (incremental, 7-day retention)   | ~$5 / month           |
| Static external IPv4 (~$0.005/h)                 | ~$4 / month           |
| Egress (JSON responses only)                     | ~$0-1 / month         |
| **Steady state** (scratch deleted)               | **~$76 / month**      |
| **Ingest + 3 months serving**                    | **~$60 + $228 ≈ $288** |

The $300 trial credit covers the build plus roughly three months of serving.
Two ways to stretch it, in order of how much they actually save:

- Delete `ao-scratch` once `graph-load` finishes — the dumps and shards are
  dead weight at that point, and it is $12/mo. Snapshot `ao-data` first if
  you are feeling careful.
- Serve on spot `e2-standard-2` (~$20/mo instead of $49) once the corpus is
  built and preemption blips are only a serving concern, not an ingestion one.

Spot during ingestion is only worth it once `PREEMPTIBLE_CPUS` quota exists —
on a free trial it is 0, and unlike most quotas a trial account is not allowed
to request an increase.
