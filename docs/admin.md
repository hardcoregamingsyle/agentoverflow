# Admin Panel

The operator panel at `/admin` on the site. Everything it shows and does is backed by `src/convex/agentoverflowAdmin.ts` in the Thalamus repo; the panel itself is just a client for those functions.

## Login

Same gate, same credentials as the Thalamus `/admin` panel — one deployment, one operator login:

1. The panel calls `admin:adminLogin` (Thalamus `admin.ts`) with a password and three security-question answers. The password is case-sensitive; answers are case/whitespace-insensitive. Only salted SHA-256 hashes live in the repo — never the values — and a failed check returns one generic error regardless of which field was wrong.
2. On success the server hands back `ADMIN_TOKEN` (a Convex dashboard env var). The browser never sees it until the credentials check out server-side.
3. Every function in `agentoverflowAdmin.ts` revalidates that token (`requireAdmin`) and fails closed when `ADMIN_TOKEN` is unset on the server. `admin:verifyAdminToken` validates a stored token on page load without exposing the value.

## Sections

| Section | What it shows / does | Backing function |
|---------|----------------------|------------------|
| Corpus health | Live passthrough of the VM's `/internal/health`: `ok`, `qdrant`, `postgres`, and the Qdrant point count — the "is the whole read side alive" number. Reports "VM not configured" when `AO_VM_URL`/`AO_INTERNAL_SECRET` are unset. | `adminCorpusHealth` (action) |
| Headline stats | Learnings by status (`pending` / `scored` / `rejected` / `duplicate`) and scored learnings by tier (`low` / `medium` / `gold`); API keys total and active; AO users (users with `aoCredits` set), credits in circulation, total contribution points. | `adminStats` (query) |
| Usage charts | Per-day series, default 30 days (max 90): DAU with a site/api split (from `aoDailyActiveUsers`), request count, and credits spent (from `aoUsage`). | `adminUsageSeries` (query) |
| Learnings moderation | Latest learnings across all users (up to 200): title, status, score, tier, rationale, credit delta, submitter email, and whether the entry is in the corpus (`vmDocId` set). | `adminLearnings` (query) |
| Remove a learning | Pulls it out of the corpus (`DELETE /internal/item/{doc_id}` on the VM; a 404 there is tolerated) and marks the row `rejected` with rationale "Removed from the corpus by admin." | `deleteLearning` (action) → `adminMarkRemoved` |
| Users & tiers | Every AO user, top contributors first (sorted by points, then balance; capped at 200): email, name, balance, points, tier, daily refill. | `adminUsers` (query) |
| Credit adjustment | Manual grant or deduction for a user. The balance floors at zero and the movement lands in `aoCreditLedger` with reason `admin`, like everything else. | `adjustCredits` (action) → `adminAdjustCredits` |

## Data Sources

The panel reads only `ao*` tables and the shared `users` table: `aoLearnings`, `aoApiKeys`, `aoCreditLedger`, `aoUsage`, `aoDailyActiveUsers`, plus `users.aoCredits` / `users.aoContribPoints`. Tier names come from the same `contribTierFor` / `CONTRIB_TIERS` ladder the economy uses ([economy.md](./economy.md)).

Scale note (from the code): the stats queries scan with bounded pagination — fine at current scale, revisit with counters past ~15k users.
