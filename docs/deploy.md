# Deployment — GCP VM

The whole read side (Qdrant + Postgres + FastAPI) runs on one GCP VM. `deploy/RUNBOOK.md` is the authoritative step-by-step with every copy-pasteable command; this page is the reference for what the pieces are and why.

## Lifecycle at a Glance

1. `deploy/setup-gcp.sh` creates the VM (below).
2. SSH in, clone the repo, fill `deploy/.env`.
3. `docker compose up -d --build` in `deploy/`.
4. Run the ingestion pipeline ([ingestion.md](./ingestion.md)).
5. Promote the external IP to static.
6. Set the three env vars in the Convex dashboard.
7. Downsize the machine for serving.

## setup-gcp.sh

```bash
PROJECT=YOUR_PROJECT_ID ZONE=us-central1-a ./setup-gcp.sh
```

Creates, idempotently (existing resources are left alone):

| Resource | Value |
|----------|-------|
| Instance | `agentoverflow`, `e2-standard-4`, **SPOT** (`--instance-termination-action=STOP`), debian-12 |
| Boot disk | 200 GB `pd-balanced` |
| Firewall | `ao-allow-8080` — tcp:8080 ingress to tag `ao-api` |
| Metadata | a startup script (below) |

No secrets live in the script — those go in `deploy/.env` on the VM. Spot is ~70% cheaper and fine for the ingestion week: preemption stops (not deletes) the VM; `gcloud compute instances start ...` and re-run the interrupted stage, since every pipeline stage is resumable.

## The Self-Bootstrapping Startup Script

The instance carries its provisioning as `startup-script` metadata: on first boot it installs ca-certificates, curl, gnupg, git, p7zip-full, aria2, and Docker CE with the compose plugin, then enables the docker service. There is no config management — a fresh VM converges on its own in ~2–3 minutes, and rebuilding the box is "delete it, re-run `setup-gcp.sh`". Everything stateful (corpus data) lives in docker volumes and `data_dir`, not in the provisioning.

## docker-compose Services (`deploy/docker-compose.yml`)

| Service | Image / build | Ports | Mem cap | Notes |
|---------|---------------|-------|---------|-------|
| `qdrant` | `qdrant/qdrant:v1.15.1` | `127.0.0.1:6333` | 5g | volume `qdrant_data`; loopback-only — only the local pipeline and the api container reach it |
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5432` | 2g | `init.sql` creates `documents` / `doc_tags` / `doc_links` on first boot; volume `pg_data`; password from `deploy/.env` |
| `api` | build `../api` | `8080` (public) | 2g | env: `AO_INTERNAL_SECRET`, `QDRANT_URL`, `PG_DSN`; refuses to start without the secret; image pre-downloads the embedding model at build time |

All three use `restart: unless-stopped` with healthchecks; `api` waits for both stores to be healthy. Memory caps are limits, not reservations — sized for e2-standard-4 (16 GB) and still fit after the downsize to e2-standard-2 (8 GB).

Secrets: `deploy/.env` (from `deploy/.env.example`) holds `POSTGRES_PASSWORD` and `AO_INTERNAL_SECRET`, each generated with `openssl rand -hex 32`.

## Static IP

Stop/start cycles rotate an ephemeral IP, which would silently break the Convex → VM URL. Promote it once (RUNBOOK step 8):

```bash
IP=$(gcloud compute instances describe agentoverflow --zone=us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
gcloud compute addresses create ao-ip --region=us-central1 --addresses="$IP"
```

## Convex Environment Variables

In the **thalamus** Convex dashboard → Settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `AO_VM_URL` | `http://<static-ip>:8080` |
| `AO_INTERNAL_SECRET` | the same value as in `deploy/.env` — the shared secret on every `/internal/*` call |
| `AO_FRONTEND_URL` | the AgentOverflow Pages origin (e.g. `https://agentoverflow.pages.dev`) — OAuth redirect allowlist |

Until the first two are set, `vmFetch` throws `AO_BACKEND_UNCONFIGURED`: search/answer return 503 with the credit refunded, and learning scoring retries then settles rejected with no penalty. Wrong order degrades honestly, but the RUNBOOK's order (VM first) avoids users staring at 503s.

## Downsize After Ingestion

Serving needs half the machine ingestion did:

```bash
gcloud compute instances stop agentoverflow --zone=us-central1-a
gcloud compute instances set-machine-type agentoverflow --zone=us-central1-a \
  --machine-type=e2-standard-2
gcloud compute instances start agentoverflow --zone=us-central1-a
```

Optionally convert SPOT → on-demand while stopped (`set-scheduling --provisioning-model=STANDARD`); staying on spot is cheaper with occasional preemption blips (containers come back via `restart: unless-stopped`). After the restart: `docker compose ps`, then the health curl from RUNBOOK step 10. The static IP means Convex needs no changes.

## Budget

Estimates at July 2026 GCP list prices, us-central1 (spot prices float — set a budget alert regardless):

| Item | Est. cost |
|------|-----------|
| Ingestion week: e2-standard-4 SPOT (~$0.04/h) | ~$7 one-off |
| Serving: e2-standard-2 on-demand (~$0.067/h) | ~$49 / month |
| 200 GB pd-balanced ($0.10/GB-mo) | ~$20 / month |
| Static external IPv4 (~$0.005/h) | ~$4 / month |
| Egress (JSON responses only) | ~$0–1 / month |
| **Steady state** | **~$73 / month** |
| **Ingest week + 3 months serving** | **~$7 + $219 ≈ $226** |

The $300 trial credit covers roughly 4 months. To stretch further: serve on spot e2-standard-2 (~$20/mo, total ~$44/mo → 6+ months) and accept rare preemption blips.
