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

Creates an `e2-standard-4` SPOT instance (debian-12, 200GB pd-balanced), a
firewall rule for tcp:8080, and a startup script that installs docker,
the compose plugin, git, p7zip-full, and aria2. Re-running is harmless.

Spot note: SPOT is ~70% cheaper and fine for the ingestion week. If GCP
preempts the VM it stops (not deleted) — just `gcloud compute instances start
agentoverflow --zone=us-central1-a` and resume; every pipeline stage is
resumable.

## 3. SSH in

Give the startup script ~2-3 minutes, then:

```bash
gcloud compute ssh agentoverflow --zone=us-central1-a
# verify the startup script finished:
sudo docker --version && git --version && aria2c --version | head -1
# run docker without sudo:
sudo usermod -aG docker $USER && newgrp docker
```

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

## 13. Budget

Estimates at July 2026 GCP list prices, us-central1 (spot prices float;
treat every number here as an estimate, and set a budget alert regardless):

| Item                                        | Est. cost           |
| ------------------------------------------- | ------------------- |
| Ingestion week: e2-standard-4 SPOT (~$0.04/h) | ~$7 one-off        |
| Serving: e2-standard-2 on-demand (~$0.067/h) | ~$49 / month        |
| 200 GB pd-balanced ($0.10/GB-mo)             | ~$20 / month        |
| Static external IPv4 (~$0.005/h)             | ~$4 / month         |
| Egress (JSON responses only)                 | ~$0-1 / month       |
| **Steady state**                             | **~$73 / month**    |
| **Ingest week + 3 months serving**           | **~$7 + $219 ≈ $226** |

The $300 trial credit covers roughly 4 months. To stretch further: serve on
spot e2-standard-2 instead (~$20/mo, total ~$44/mo → 6+ months) and accept
rare preemption blips.
