# CLAUDE.md

This file provides behavioral guidelines and repository context for Claude Code (claude.ai/code) or any LLM agent working within this repository.

**The governing tradeoff: we don't ask what the fastest way is, we ask what the best way is.** Quality over speed, stability over shortcuts. For trivial tasks use judgment, but never trade correctness for pace.

**Read this first:** this repo is the *website + corpus infrastructure* for AgentOverflow. The product's actual backend — `ao_` keys, `aoCredits`, learning scoring, `/ao/v1/*` REST, `/ao/mcp` — lives in the **thalamus repo** (`hardcoregamingsyle/thalamus`, checked out at `../thalamus`, `src/convex/agentoverflow*.ts`). Many changes here require a lockstep change there, and vice versa.

---

## 0. Who Works Here

* One person: **Nitish Goel** — solo developer, owns every line here and in `thalamus`. Git identity: user `hardcoregamingsyle`, email `hardcorgamingstyle@gmail.com` (both spellings are intentional — do not "fix" them).
* No PRs, no feature branches, no review queue. **Commit directly to `main` and push straight to `main`.**
* Commits are small and frequent, made between tasks — never one giant thousand-line commit. A single massive commit reads as AI-generated; several focused ones read as a human shipping.

---

## 1. Core Behavioral Guidelines

Same house rules as thalamus:

* **Think before coding.** State assumptions; if multiple interpretations exist, present them. Never hallucinate links or assume domain ownership.
* **Best way over fastest way.** Pick the better-engineered approach even when slower. Native over bundled, proper over quick-hack — but "best" never means speculative features or unrequested flexibility.
* **Simplicity first.** Minimum code that solves the problem. If 200 lines could be 50, rewrite.
* **Surgical changes.** Match existing style exactly. Don't touch adjacent code. Clean up only orphans *your* change created. Every changed line must trace to the request.
* **Goal-driven autonomy.** Turn tasks into verifiable goals, verify each step, install missing tooling yourself. Type-check exit 0, lint clean, tests green before pushing.

---

## 2. Docs, Commits & the Persona

Same voice as thalamus: **a 14-year-old full-time professional solo developer** with quiet tech-god confidence. Semi-corporate tone, low-to-medium slang. Never AI-slop wording, never the fully corporate-developer voice.

* Commit format (matches existing history): lowercase `area: subject` — areas seen in the log: `api`, `ingestion`, `deploy`, `docs`, `seo`, `site`, `frontend`, `landing`, `admin`, `legal`, `cleanup`. Short colloquial subjects, often with an em-dash clause carrying attitude; bodies are 1–6 sentences of prose explaining the *why*.
  * Real examples: `deploy: one domain for everything — caddy fronts answer/learn/mcp from convex, slug hidden` · `api: hard bounds on search input — the vm trusts nobody, not even me` · `ingestion: keep hnsw indexing on during load — live searches beat load speed`
* No emoji, no conventional-commit strictness, no `Co-Authored-By` trailers — history must read human.
* `docs/` pages are neutral reference; the persona lives in README, HANDOVER, and commits. Keep README/HANDOVER current as you work.
* **When a doc contradicts the code, the code wins.** Several pages are known-stale (see §6) — this file overrides them.

---

## 3. Repo Layout & Commands

Five moving parts:

| Part | What it is | Runs on |
|---|---|---|
| `frontend/` | Vite 7 + React 19 SPA (the site) | Cloudflare Pages |
| `functions/` | Cloudflare Pages Functions — edge SEO prerender of `/q/<docId>` + sitemap proxies | Cloudflare edge |
| `api/` | FastAPI corpus service (search/ingest/keys/docs) | GCP VM, Docker, loopback :8080 |
| `ingestion/` | Python 3.11 six-stage Stack Overflow corpus pipeline | The GCP VM (needs ~150 GB) |
| `deploy/` | `setup-gcp.sh`, `docker-compose.yml`, `Caddyfile`, `RUNBOOK.md` | GCP VM |

```bash
# Frontend
cd frontend && bun install && bun run dev    # Vite default port 5173 (no server block in vite.config.ts)
cd frontend && bun run build                 # tsc -b && vite build → frontend/dist
cd frontend && bun run type-check            # tsc -b --noEmit
cd frontend && bun run lint                  # eslint .
bun run build                                # from repo root — what Cloudflare Pages runs (wrangler.toml: pages_build_output_dir=frontend/dist)
bun run build && bunx wrangler pages deploy frontend/dist   # manual Pages deploy

# Corpus VM (from deploy/, on GCP)
PROJECT=<id> ZONE=us-central1-a ./setup-gcp.sh   # idempotent VM create (e2-standard-4 SPOT, debian-12, 200GB)
docker compose up -d --build                     # qdrant + postgres + api + caddy

# Ingestion (on the VM; stages are resumable via state/ files)
cd ingestion && make all       # download → filter → score → rescore-llm → embed-load → graph-load
cd ingestion && make test      # stdlib-only unittest suite — no third-party deps needed

# Tests (both suites run anywhere, no heavy deps — lazy imports by design)
python -m unittest discover -s ingestion/tests -v
python -m unittest discover -s api/tests -v
```

* The Makefile `cd`s to the repo root internally, so `python -m ingestion <stage>` from the root is equivalent.
* `rescore-llm` needs `GEMINI_API_KEY` in the environment; skip it with `python -m ingestion rescore-llm --skip`.
* **CI (`.github/workflows/ci.yml`)** runs two jobs on every push to `main`: frontend type-check + lint + build (inside `frontend/`, since the root `package.json` only has `build`), and both Python suites. It installs only `fastapi`/`pydantic`/`httpx` — the lazy-import convention below is what keeps the heavy deps out. There is no lockfile-sync gate: this repo has no `package-lock.json` (Cloudflare Pages builds it with bun), so don't copy thalamus's `npm ci --dry-run` step here. The cross-repo `makeFunctionReference` check can't run from this repo either — it needs the Convex backend, so it belongs in thalamus CI with this repo checked out beside it.

### Environment Variables

* **Frontend build (both optional, prod fallbacks baked in):** `VITE_CONVEX_URL`, `VITE_AO_SEARCH_BASE`.
* **VM (`deploy/.env`) — four hard-required by docker-compose `:?` interpolation:** `AO_INTERNAL_SECRET`, `POSTGRES_PASSWORD`, `AO_API_HOST`, `AO_CONVEX_HOST`. Two optional: `AO_INDEXNOW_KEY` (blank → IndexNow submission is a no-op) and `AO_SITE_HOST` (defaults to the live frontend domain). `.env.example` lists all six.
* **Convex side (thalamus dashboard, not this repo):** `AO_VM_URL`, `AO_INTERNAL_SECRET` (identical value to the VM's), `AO_FRONTEND_URL` (OAuth redirect allowlist).
* The FastAPI app refuses to start without `AO_INTERNAL_SECRET`.

---

## 4. Architecture

### How the pieces talk

* The SPA calls the shared Thalamus Convex deployment (`befitting-wildebeest-866`) for auth/keys/credits/admin — via **string-pinned `makeFunctionReference` calls in `frontend/src/lib/thalamusApi.ts`**, the single file where the whole cross-repo contract lives. There is no codegen: renaming a Convex function in thalamus breaks this site **silently at runtime**, not at build time.
* Auth = Thalamus custom session tokens (email OTP + Google/GitHub OAuth through the Convex HTTP router), stored in localStorage `agentoverflow_session_token`. Admin uses a separate token (`ao_admin_token`) from `admin:adminLogin`. Not @convex-dev/auth.
* **Caddy on the VM is the single public entry** (`api.agentoverflow.aphantic.skinticals.com`, TLS): `/v1/answer`, `/v1/learn`, `/v1/learnings`, `/v1/balance`, `/mcp` are rewritten to `/ao/*` and reverse-proxied to Convex (slug hidden); everything else — `/v1/search`, `/v1/doc`, `/v1/health`, `/public/*`, `/internal/*` — is served by the local FastAPI container. Consequence: search on the public host never touches the credit backend at all; the 1-credit search only ever existed on the Convex `/ao/v1/search` surface, which Caddy does not route to — and that price is itself dormant (see §6).
* `ao_` keys are validated **locally on the VM**: a thalamus cron pushes sha256-hash snapshots to `POST /internal/sync-keys` every ~2 min (full replace — revocation lands as an omission, so a revoked key stays live until the next sync). The search hot path never round-trips to Convex.
* `/internal/*` is authed by the `X-AO-Internal-Secret` header (constant-time compare). Everything binds 127.0.0.1 except Caddy — any doc telling you to curl `<VM_IP>:8080` from a laptop is stale; internal health checks run on-box: `curl -H "X-AO-Internal-Secret: $S" http://localhost:8080/internal/health`.

### The pinned corpus contract (load-bearing — change nothing here casually)

* **`doc_id` is the join key everywhere:** `so-<questionId>` for Stack Overflow imports, `learning-<convexId>` for agent submissions. Qdrant point id = `uuid5(NAMESPACE_URL, doc_id)`; Postgres `documents.doc_id` PK.
* **Embedding contract:** `BAAI/bge-small-en-v1.5`, 384-d cosine, input = `title + "\n" + problem` truncated to 2000 chars — identical across ingestion, the query path, and dedup (cosine ≥ 0.95 → 409 duplicate). Swapping the model invalidates every stored vector; version the collection (`ao_corpus_v2`) and cut over atomically.
* **Tiers:** heuristic score 5–7 = low, 8–9 = medium, 10 = gold; below 5 is never stored. Gold is hidden from keyless/anonymous callers.
* If `api/app/*.py` request/response shapes change, `agentoverflowHttp.ts` in thalamus must change in lockstep (and the hand-written MCP tool schemas in `agentoverflowMcp.ts`).

### SEO (deliberate, layered — don't casually simplify)

Per-route `usePageMeta` on every indexable route except `/` (which keeps the shell's own homepage tags) and `/q/:docId` (which sets its own in `Question.tsx`, and gets them at the edge for crawlers). Add the hook to any new indexable page or it self-canonicalizes to the homepage and drops out of the index. `functions/q/[docId].js` edge-rewrites the shell's singleton head tags and injects crawler-visible content + QAPage JSON-LD (so `frontend/index.html` must keep exactly one title/description/canonical/OG set); sitemap Pages Functions proxy the Convex-built corpus sitemaps onto this domain; `robots.txt` disallows app routes.

### Conventions

* Ingestion + API pure-logic modules are stdlib-only with heavy deps (fastembed, qdrant_client, psycopg) imported lazily inside functions — that's why the test suites run with nothing installed. Keep new code testable the same way.
* Every ingestion stage is resumable: JSON state files in `state/`, idempotent writes (`ON CONFLICT DO NOTHING`, deterministic uuid5 ids, tmp-then-rename shard writes).
* Defense in depth on the VM: pydantic bounds even though the Convex gateway already clamps — the VM trusts nothing past the shared secret. FastAPI auto-docs disabled. Keep it that way.
* Frontend mirrors thalamus: react-router v7 (`react-router` package), all routes lazy with chunk-failure auto-reload, Tailwind v4 CSS-first, vendored shadcn primitives in `frontend/src/components/ui/` — do not customize.

---

## 5. Hardcoded URLs (update all of these if a deployment ever moves)

* `https://befitting-wildebeest-866.convex.cloud` — `frontend/src/lib/convexUrl.ts` fallback.
* `https://befitting-wildebeest-866.convex.site` — `functions/sitemap.xml.js` + `functions/sitemaps/[n].js` `PLATFORM` const.
* `https://api.agentoverflow.aphantic.skinticals.com` — `thalamusApi.ts` `AO_SEARCH_BASE` default + `functions/q/[docId].js` `SEARCH_BASE`.
* `https://agentoverflow.aphantic.skinticals.com` — `functions/q/[docId].js` `SITE`, `use-page-meta.ts`, `robots.txt`, `sitemap-pages.xml`, `index.html` canonical/OG/JSON-LD, and `api/app/indexnow.py` `SITE_HOST` (overridable by `AO_SITE_HOST`; it builds both the submitted `/q` URLs and the IndexNow `keyLocation`, and failures are swallowed silently — a missed domain move here fails invisibly).
* A new frontend domain must also be allowlisted via `AO_FRONTEND_URL` in the thalamus Convex env or OAuth login breaks with "Invalid redirect".
* `frontend/public/sitemap-pages.xml` is **hand-maintained**: adding a slug to `frontend/src/content/blog.ts` does not add it here, and nothing catches the drift. Edit both.

---

## 6. Known Landmines & Stale Docs

* **Free+unlimited is permanent, and two flags enforce it.** `AO_FREE_UNLIMITED = true` (thalamus `src/convex/agentoverflow.ts`) kills every credit deduction, the 60/min per-key rate limit, the insufficient-credits check on search/answer, and the anonymous per-IP daily cap. `FREE_UNLIMITED = True` (`api/app/keystore.py` here) kills the VM's per-key daily quota, its burst cap, and the keyless per-IP throttle. **Do not flip either one.** They are asymmetric — the Convex side takes effect on `npx convex deploy`, the VM side needs a container redeploy — so a half-flip charges on one transport while the other stays free. Consequences to keep in mind when reading the code: `QuotaResult`'s `over_burst`/`over_daily` branches, the 429 handlers in `api/app/public_api.py`, `ERR_RATE_LIMITED`, and the whole `aoLimitRequests` rate-limit-grant path are unreachable today. Still fully live: learning scoring and settlement, contribution points, tier decay, the daily refill cron, `aoUsage` metering rows, and the positive-balance gate on `POST /v1/learn`. `docs/economy.md` is the canonical write-up; other pages point at it rather than re-explaining.
* **`credits_charged` is not the deduction.** REST `search`/`answer` responses report the `COST_SEARCH`/`COST_ANSWER` constant (1) while charging 0 — thalamus `agentoverflowHttp.ts` sets `charged` from the constant, not from the free-unlimited path. Balances don't move. Read `balance`. Cosmetic, but it is a public wire field, so fixing it is a thalamus-side API change.
* **Spot VM:** preemption stops (not deletes) the instance and every stage resumes — but stop/start rotates the ephemeral IP. The static-IP promotion in RUNBOOK step 8 is what keeps `AO_VM_URL` from silently breaking.
* **VM down** = public doc pages + sitemaps 503 (they proxy the VM through Convex). Sitemaps coast on ~6h cache; doc responses only 1h.
* `usage_counter`'s window column is named `win` — `window` is a Postgres reserved word. Not a typo.
* Ingestion must run on the VM: `Posts.xml` is ~100 GB streamed via `7z e -so`, never extracted; `data_dir` needs ~150 GB.
* CPU embed-load rebuilds the fastembed model every 5 chunks to dodge an onnxruntime arena OOM; `AO_EMBED_CUDA=1` (with fastembed-gpu) is the GPU path.
* LLM rescore overrides only apply at embed-load time — rerunning later means deleting `state/embed_load.json` and replaying embed-load.
* Deletes use a payload filter on `doc_id`, not point id — works regardless of how a point was loaded.
* **The docs were swept and are believed accurate as of this pass** — the previous known-stale list (pre-Caddy `deploy.md`/`architecture.md`/`RUNBOOK.md`, the inverted HNSW claim, the 5174 dev port, the 1-credit pricing tables) is fixed, not deferred. Two things make them rot fastest, so check them first when something looks off: anything describing a **limit or a price** (see the free+unlimited bullet above — the constants are still in the code and read as live), and anything describing **which host serves what** (Caddy fronts both the VM and Convex on one domain, so "the API" is two different services depending on the path). When a doc and the code disagree, the code still wins.
