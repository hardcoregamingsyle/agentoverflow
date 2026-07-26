# Deployment — GCP VM

The whole read side (Qdrant + Postgres + FastAPI, with Caddy as the TLS edge) runs on one GCP VM. `deploy/RUNBOOK.md` is the authoritative step-by-step with every copy-pasteable command; this page is the reference for what the pieces are and why.

## Lifecycle at a Glance

1. `deploy/setup-gcp.sh` creates the VM (below).
2. SSH in, clone the repo, fill `deploy/.env`.
3. `docker compose up -d --build` in `deploy/`.
4. Run the ingestion pipeline ([ingestion.md](./ingestion.md)).
5. Promote the external IP to static.
6. Point an A record for `AO_API_HOST` at that IP and let Caddy issue its certificate.
7. Set the three env vars in the Convex dashboard.
8. Downsize the machine for serving.

## setup-gcp.sh

```bash
PROJECT=YOUR_PROJECT_ID ZONE=us-central1-a ./setup-gcp.sh
```

Creates, idempotently (existing resources are left alone):

| Resource | Value |
|----------|-------|
| Instance | `agentoverflow`, `e2-standard-4`, debian-12, `--deletion-protection`. On-demand by default — pass `SPOT=1` to opt into spot |
| Boot disk | 30 GB `pd-balanced` (`BOOT_SIZE`) — disposable; nothing stateful lives here |
| `ao-data` | 150 GB `pd-balanced` (`DATA_SIZE`), mounted `/data`, `auto-delete=no`. Docker's data-root, so the Qdrant + Postgres volumes — the corpus — sit here |
| `ao-scratch` | 300 GB `pd-standard` (`SCRATCH_SIZE`), mounted `/scratch`, `auto-delete=no`. Dumps and shards only; `config.toml`'s `data_dir` points here |
| Snapshots | `ao-daily-snap` — daily schedule on `ao-data`, 7-day retention, `keep-auto-snapshots` so they outlive the disk |
| Firewall | `ao-allow-web` — tcp:80,443 ingress to tag `ao-api`. The legacy `ao-allow-8080` rule is deleted on every run |
| Metadata | a startup script (below) |

No secrets live in the script — those go in `deploy/.env` on the VM.

The disk split is the point: a boot disk defaults to auto-delete, so a single-disk layout means deleting the instance takes the corpus with it. Here the corpus sits on `ao-data` with `auto-delete=no`, the instance carries deletion protection, and `ao-data` has a daily snapshot schedule — three independent failures before anything is actually lost.

Spot is ~70% cheaper and preemption only *stops* the instance, but it is **off by default**: nothing here auto-restarts a preempted VM, so it stays stopped until someone runs `instances start`, and a multi-week embed stalling for a day costs more than the discount saves. Set `SPOT=1` only if something is watching the instance. Every pipeline stage is resumable, so restarting and re-running the interrupted stage is always safe.

## The Self-Bootstrapping Startup Script

The instance carries its provisioning as `startup-script` metadata: on first boot it installs ca-certificates, curl, gnupg, git, p7zip-full, aria2, python3-venv, and Docker CE with the compose plugin, then enables the docker service. It also formats (first boot only) and mounts `ao-data` at `/data` and `ao-scratch` at `/scratch` with `fstab` entries, and moves Docker's data-root onto `/data` so the corpus volumes land on the surviving disk rather than the boot disk. There is no config management — a fresh VM converges on its own in ~2–3 minutes, and rebuilding the box is "delete the instance, re-run `setup-gcp.sh`" with both data disks reattached intact.

## docker-compose Services (`deploy/docker-compose.yml`)

| Service | Image / build | Ports | Mem cap | Notes |
|---------|---------------|-------|---------|-------|
| `qdrant` | `qdrant/qdrant:v1.15.1` | `127.0.0.1:6333` | 5g | volume `qdrant_data`; loopback-only — only the local pipeline and the api container reach it |
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5432` | 2g | `init.sql` creates `documents` / `doc_tags` / `doc_links` on first boot; volume `pg_data`; password from `deploy/.env` |
| `api` | build `../api` | `127.0.0.1:8080` | 2g | env: `AO_INTERNAL_SECRET`, `QDRANT_URL`, `PG_DSN`; refuses to start without the secret; loopback-only, so nothing off-box reaches it except through Caddy; image pre-downloads the embedding model at build time |
| `caddy` | `caddy:2-alpine` | `80`, `443` | — | the only public listener; terminates Let's Encrypt TLS for `AO_API_HOST` and reverse-proxies to `api:8080`, except `/v1/answer`, `/v1/learn`, `/v1/learnings`, `/v1/balance` and `/mcp`, which it rewrites to `/ao/*` on `AO_CONVEX_HOST`; volumes `caddy_data`, `caddy_config` |

All four use `restart: unless-stopped`. `qdrant`, `postgres` and `api` carry healthchecks and `api` waits for both stores to report healthy; `caddy` has neither a healthcheck nor a memory cap, and only waits for `api` to start. Memory caps are limits, not reservations — sized for e2-standard-4 (16 GB) and still fit after the downsize to e2-standard-2 (8 GB).

## VM Environment (`deploy/.env`)

Copy `deploy/.env.example`. Four values are hard-required — docker-compose interpolates them with `:?`, so a missing one fails `docker compose up` immediately instead of booting a half-configured stack:

| Variable | What it is |
|----------|------------|
| `POSTGRES_PASSWORD` | Postgres password for user/db `ao`; generate with `openssl rand -hex 32` |
| `AO_INTERNAL_SECRET` | shared secret behind `X-AO-Internal-Secret`; the same value goes in the Convex dashboard; `openssl rand -hex 32` |
| `AO_API_HOST` | public API hostname Caddy requests a certificate for, e.g. `api.<your-domain>` |
| `AO_CONVEX_HOST` | the deployment's `.convex.site` host — where Caddy sends the credit/LLM/MCP routes |

Two more are optional:

| Variable | What it is |
|----------|------------|
| `AO_INDEXNOW_KEY` | IndexNow submission key; blank makes `app/indexnow.py`'s `submit()` a no-op, so ingest just skips the search-engine ping |
| `AO_SITE_HOST` | frontend hostname the submitted `/q` URLs and the IndexNow `keyLocation` are built from; defaults to the live site host, so only set it if the site domain moved |

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
| `AO_VM_URL` | `https://api.<your-domain>` — the Caddy hostname, i.e. the `AO_API_HOST` value. Not the raw IP: 8080 is loopback-only and closed at the firewall |
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
| Ingestion week: e2-standard-4 on-demand (~$0.134/h) | ~$23 one-off (~$7 with `SPOT=1`) |
| Serving: e2-standard-2 on-demand (~$0.067/h) | ~$49 / month |
| Boot 30 GB + `ao-data` 150 GB, pd-balanced ($0.10/GB-mo) | ~$18 / month |
| `ao-scratch` 300 GB pd-standard ($0.04/GB-mo) | ~$12 / month — detach and delete after ingestion |
| Static external IPv4 (~$0.005/h) | ~$4 / month |
| Egress (JSON responses only) | ~$0–1 / month |
| **Steady state (scratch deleted)** | **~$71 / month** |
| **Ingest week + 3 months serving** | **~$23 + $225 ≈ $248** |

The $300 trial credit covers roughly 4 months. Two levers stretch it: run the ingestion week with `SPOT=1` (saves ~$16), and detach + delete `ao-scratch` once ingestion is done — it holds only dumps and shards, so it is pure waste during serving. Serving on spot e2-standard-2 (~$20/mo, total ~$42/mo → 6+ months) goes further if you accept preemption blips and have something restarting the VM.
