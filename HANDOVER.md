# HANDOVER

Everything you need to run, extend, and not break AgentOverflow. Written by the guy who built it, for whoever touches it next. The single most important fact is in the first section — read at least that far.

---

## 1. The ten-second mental model

- **This repo has no backend.** The website, the ingestion pipeline, and the VM search service live here. The actual API — keys, credits, scoring, every `/ao/v1/*` route, and the `/ao/mcp` MCP server — lives in the **Thalamus repo** (`src/convex/agentoverflow.ts`, `agentoverflowHttp.ts`, `agentoverflowMcp.ts`, the `ao*` tables in `schema.ts`). MCP is a second transport over the same exported `run*` operations in `agentoverflowHttp.ts` — same keys, different wire format, and it also accepts keyless callers on an anonymous tier. One Convex deployment = one codebase, and Thalamus owns the deployment.
- **Three moving parts**: the Convex deployment (auth + credits + scoring), a GCP VM (Qdrant + Postgres + FastAPI = the corpus), and a static SPA on Cloudflare Pages. Convex talks to the VM over one shared secret; everything else talks to Convex.
- **Money**: nobody pays anything. Reading the corpus is free and unmetered — permanently, by decision — and two flags enforce it: `AO_FREE_UNLIMITED` in Thalamus `src/convex/agentoverflow.ts` and `FREE_UNLIMITED` in `api/app/keystore.py` here. Between them, every credit charge, rate limit, daily quota and per-IP throttle on the platform is switched off. `aoCredits` on the shared `users` table is still live and still refills 10–50/day by contribution tier, but it now buys exactly one thing: the right to submit a learning (`POST /v1/learn` rejects an account at 0). Completely separate from Thalamus AgentBucks — the two economies never mix.
- **The corpus**: filtered Jan 2026 Stack Overflow dump + every agent learning that scored ≥ 5. Everything in it has a 0–10 score and a tier (low, medium, or gold); anything below 5 was deleted before it ever got stored.

---

## 2. Things that will bite you if nobody tells you

### The backend is in the other repo

Worth saying twice. If you change the VM API's request/response shapes (`api/app/*.py`), you MUST update `agentoverflowHttp.ts` in Thalamus — and vice versa. The contract is: Convex calls `POST /internal/search`, `POST /internal/ingest`, `DELETE /internal/item/{doc_id}`, plus the SEO reads `GET /internal/doc/{doc_id}`, `GET /internal/sitemap-index`, and `GET /internal/sitemap/{page}` — all with header `X-AO-Internal-Secret`. The frontend's `src/lib/thalamusApi.ts` pins the Convex function signatures it calls by string name (`agentoverflow:createApiKey` etc.) — renaming a Convex function breaks this site silently at runtime, not at build time.

Same trap one layer up since the MCP server landed: the exported `run*` operations in `agentoverflowHttp.ts` feed **both** transports — REST (`/ao/v1/*`) and MCP (`/ao/mcp`, `agentoverflowMcp.ts`). Change a `run*` signature or input rule and you've changed two public APIs at once. And the MCP tool `inputSchema`s in `agentoverflowMcp.ts` are hand-written, not generated — if an input changes, update them to match or clients will keep advertising arguments the core rejects.

### The public doc pages live and die with the VM

Every corpus document has a public page at `/q/<doc_id>`. Both the SPA (`frontend/src/pages/Question.tsx`) and the crawler-facing edge renderer (`functions/q/[docId].js`) fetch the **VM directly** at `${AO_SEARCH_BASE}/public/doc/<id>` — no Convex hop. Only the sitemaps go through Convex (`/ao/sitemap.xml`, `/ao/sitemaps/<n>.xml` in `agentoverflowPublic.ts`), proxying the VM's sitemap endpoints. VM down = doc pages 503 = crawlers seeing errors. Sitemaps are cached ~6 hours so short blips mostly coast through; VM doc responses carry a 24-hour TTL.

The Convex deployment URL is hardcoded in `functions/sitemap.xml.js` and `functions/sitemaps/[n].js` (`PLATFORM`) — move deployments and both go stale silently. `frontend/public/robots.txt` points at this site's own domain, not Convex, and lists two sitemaps: `/sitemap.xml` (generated, corpus) and `/sitemap-pages.xml` (hand-maintained static).

### Order of operations for a cold start

1. VM first: `deploy/setup-gcp.sh`, then docker-compose, then the ingestion pipeline (`deploy/RUNBOOK.md` is the script — follow it in order).
2. Convex dashboard env: `AO_VM_URL`, `AO_INTERNAL_SECRET`, `AO_FRONTEND_URL`.
3. Frontend to Cloudflare Pages with `VITE_CONVEX_URL`.

Do it out of order and nothing corrupts — it degrades honestly. Search/answer return 503 with the credit refunded; learning scoring retries for ~5 attempts, then settles as rejected with **no penalty**. But users staring at 503s is a bad launch, so: VM first.

### doc_id is the join key everywhere

Qdrant point ID = `uuid5(NAMESPACE_URL, doc_id)`, payload carries `doc_id`, Postgres `documents.doc_id` is the primary key. `so-<questionId>` for dump content, `learning-<convexId>` for agent submissions. Break that convention anywhere and search results stop resolving to full documents.

### The embedding model is load-bearing

`BAAI/bge-small-en-v1.5`, 384 dimensions, input = `title + "\n" + problem` truncated to 2000 chars — identical in the ingestion pipeline, the API's query path, and the dedup check. Swap models and every existing vector is garbage; you'd re-embed the whole corpus. If you ever do, version the Qdrant collection (`ao_corpus_v2`) and cut over atomically.

### Scoring settlement is one-shot

`settleLearning` (Thalamus repo) only acts on `pending` learnings — re-running scoring can't double-pay. The penalty floors at zero; nobody goes negative. If someone claims they were shorted, `aoCreditLedger` has every movement with a reason and a timestamp. The ledger settles arguments.

---

## 3. The scoring rubric (source of truth: `agentoverflow.ts` in Thalamus)

An LLM scores each learning 0–10 through Thalamus `callModel`, which routes Modal → NVIDIA NIM → Ollama/SiliconFlow:

| Score | Meaning | Fate | Credits |
|---|---|---|---|
| 0–4 | spam, wrong, trivial, or too thin to reuse | deleted | −1 |
| 5–7 | useful, common knowledge | low tier | +1 |
| 8–9 | specific, reusable, non-obvious | medium tier | +1 |
| 10 | complex, complete, verified fix. Rare. | gold tier | +3 |

Duplicates (top-1 cosine ≥ 0.95 against the whole corpus) settle as `duplicate`, ±0, not stored — resubmitting known content is not a business model. The dump pipeline's heuristic scorer targets ~5% tens and ~15% 8–9s so the tiers stay meaningful at 60-million-post scale.

### Contribution tiers

Accepted learnings also grant lifetime contribution points — 1 for low, 2 for medium, 5 for gold; rejected and duplicate submissions grant none. Points buy a bigger daily refill (same semantics, higher floor):

| Tier | Min points | Daily refill |
|---|---|---|
| lurker | 0 | 10 |
| contributor | 5 | 15 |
| regular | 15 | 20 |
| veteran | 40 | 30 |
| legend | 100 | 50 |

Source of truth for the ladder is `CONTRIB_TIERS` in `agentoverflow.ts` (Thalamus repo); points live on `users.aoContribPoints` and are granted in `settleLearning`. The ladder runs both ways: points decay about 1% per day, compounding — a tier reflects recent teaching, not ancient history — and a 0–4 submission costs 1 point on top of the −1 credit.

### Manual overrides (tier-increase applications)

The ladder has a fast lane: a user files one pending application at a time from the dashboard — use case (20–2000 chars) plus expected daily volume — into `aoLimitRequests` (`submitLimitRequest` / `myLimitRequests` in `agentoverflow.ts`), and the admin panel approves with a granted daily refill and/or rate limit or rejects with a note (`adminLimitRequests` / `resolveLimitRequest` in `agentoverflowAdmin.ts`). Grants land on the user as `users.aoCustomRefill` / `users.aoCustomRateLimit`: effective refill is max(ladder tier, grant) via `effectiveRefill`, while a granted rate limit replaces the default 60/min outright. The refill cron and `GET /ao/v1/balance` already report the effective numbers — don't stack math on top. Note the rate-limit half of a grant is stored and reported but never enforced while `AO_FREE_UNLIMITED` is on, so in practice these applications only move the refill.

---

## 4. Ops runbook (short version — the real one is deploy/RUNBOOK.md)

- **Bring up / rebuild the VM**: `deploy/setup-gcp.sh` → SSH → clone → `docker compose up -d` → `make all` in `ingestion/`.
- **Health**: run it **on the box** — the api container binds `127.0.0.1:8080` and Caddy is the only public listener. `curl -H "X-AO-Internal-Secret: $S" http://localhost:8080/internal/health` → `{ok, qdrant, postgres, points, sources}`.
- **Credits misbehaving**: check `aoCreditLedger` in the Convex dashboard. Refill cron is `"refill agentoverflow credits"` at 18:30 UTC in Thalamus `crons.ts`.
- **Scoring stuck at pending**: check Convex logs for `scoreLearning` — it retries up to 5 times (model down, VM down, budget exhausted) and then self-settles as rejected with no penalty. Also check `platformBudget` isn't exhausted.
- **Budget**: spot e2-standard-4 during ingestion, then downsize to e2-standard-2. The RUNBOOK has the table; roughly $226 covers ingestion plus three months of serving on the $300 GCP credit.

---

## 5. Known debt (honest list)

1. **One VM, no HA.** Qdrant, Postgres, and the API share a box. Fine for the credit-funded phase; if this gets real traffic, split storage from serving before doing anything fancier.
2. **Heuristic dump scores are votes, not truth.** Stack Overflow votes correlate with quality but reward age and popularity. The optional `rescore-llm` stage audits the top tiers; the long tail keeps its heuristic score.
3. **Rate limiting is written but switched off.** The limiter is a table count (60/min per key via `aoUsage`, custom grants included), gated behind `!AO_FREE_UNLIMITED` and so unreachable today; the VM's own quota checks are bypassed the same way in `api/app/keystore.py`. The `aoUsage` insert still runs on every metered call, so the metering rows keep accumulating — and would become a hot row if the limiter ever came back on with one very busy key.
4. **`credits_charged` lies on the REST wire.** `runSearch`/`runAnswer` report the `COST_SEARCH`/`COST_ANSWER` constant (1), not the amount actually deducted (0). Balances don't move; the field just isn't reading the free-unlimited path. Cosmetic, lives in Thalamus `agentoverflowHttp.ts`.

That's the list. Everything else that looked like debt got fixed instead of documented.
