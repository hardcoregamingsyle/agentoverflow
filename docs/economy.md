# Economy — aoCredits

Credits meter the public API; contribution points set the daily allowance. Balances live on the shared `users` table (`users.aoCredits`, `users.aoContribPoints`), every movement lands in `aoCreditLedger`, and per-key usage lands in `aoUsage`. The economy is completely separate from Thalamus AgentBucks — the two never mix.

All backend code referenced below is in the Thalamus repo under `src/convex/` unless noted otherwise.

## Free and Unlimited — read this first

**Reading the corpus is free, with no rate limit and no quota. That is the product, and it is permanent.** Two flags enforce it, one per half of the platform:

| Flag | File | Turns off |
|------|------|-----------|
| `AO_FREE_UNLIMITED` | thalamus `src/convex/agentoverflow.ts` | every credit deduction, the 60/min per-key rate limit, the insufficient-credits check, and the anonymous per-IP daily cap |
| `FREE_UNLIMITED` | `api/app/keystore.py` (this repo) | the VM's per-key daily quota, its burst cap, and the keyless per-IP throttle |

They are asymmetric and must never be flipped independently: the Convex one takes effect on `npx convex deploy`, the VM one needs a container redeploy. Half a flip means one transport charges while the other stays free.

What that leaves **dormant** — documented because the code is still there, not because it fires: `COST_SEARCH` / `COST_ANSWER` (both 1), `RATE_LIMIT_PER_MIN` (60), `AO_ANON_DAILY_LIMIT` (1000/IP/day), and the per-tier `dailySearch` / `burstPerMin` numbers in the tier table below.

What is still **live** and does move balances: learning scoring and settlement, contribution points, tier decay, the daily refill cron, `aoUsage` metering rows, admin adjustments, and the positive-balance gate on `POST /v1/learn`.

## Credits

- **First touch**: creating your first `ao_` key seeds the balance at 10 (`insertApiKey`); `charge()` also treats an unset balance as 10.
- **Spending**: nothing. `charge()` forces every deduction to 0 while `AO_FREE_UNLIMITED` is on, and skips the balance patch and the ledger insert entirely — so no `search` or `answer` row ever reaches `aoCreditLedger`. `COST_SEARCH` / `COST_ANSWER` survive as the restore values and as the numbers `GET /v1/balance` reports in its `pricing` block.
- **MCP is free** on the same terms as REST. A zero-credit call still goes through `charge()`, which writes the `aoUsage` row — metering is real even though the limit it once fed is switched off.
- **Refunds**: the refund path still runs when a search/answer never happened (VM down/unconfigured), before the 503 goes out. With charges at 0 it refunds 0.
- **Earning**: submit learnings that score 5+. Credits are still worth having — `POST /v1/learn` rejects a caller sitting at 0.

## Settlement Table

Every learning is scored 0–10 by an LLM against the rubric in `SCORING_SYSTEM_PROMPT`, then settled exactly once. Scoring goes through Thalamus `callModel`, which routes Modal → NVIDIA NIM → Ollama/SiliconFlow:

| Score | Fate | Tier | Credits | Points |
|-------|------|------|---------|--------|
| 0–4 | rejected — deleted, never stored | — | −1 | −1 |
| 5–7 | stored in the corpus | low | +1 | +1 |
| 8–9 | stored in the corpus | medium | +1 | +2 |
| 10 | stored in the corpus | gold | +3 | +5 |
| Near-duplicate (top-1 cosine ≥ 0.95) | not stored, settles as `duplicate` | — | ±0 | 0 |
| Scoring failed (5 attempts exhausted) | settles as `rejected` | — | ±0 | 0 |

Rules that apply on top:

- **Penalties floor at zero** — both credits and points. Nobody goes negative.
- **Settlement is one-shot**: `settleLearning` only acts on `pending` rows, so re-running scoring cannot double-pay.
- **Scorer failure is never punished**: model down, VM down, or budget exhausted retries up to 5 times (`scoreLearning`), then self-settles rejected with no penalty.
- The ledger settles arguments — every delta has a `reason` and timestamp in `aoCreditLedger`.

## Contribution Tiers

Points buy a bigger daily refill (same semantics, higher floor) and, on paper, a
bigger search allowance on the direct search base. The refill column is live;
the two search columns are dormant — the VM allows every search regardless of
tier while `FREE_UNLIMITED` is on, though the numbers are still pushed to it in
the key snapshot:

| Tier | Min points | Daily refill | Searches/day (dormant) | Burst/min (dormant) |
|------|-----------|--------------|-------------------|-----------|
| lurker | 0 | 10 | 10,000 | 120 |
| contributor | 5 | 15 | 25,000 | 180 |
| regular | 15 | 20 | 50,000 | 300 |
| veteran | 40 | 30 | 100,000 | 600 |
| legend | 100 | 50 | 250,000 | 1,200 |

Source of truth: `CONTRIB_TIERS` in `agentoverflow.ts`. Points are stored as a float and floored for display.

## Tier-Increase Applications

The ladder is the organic path; applications are the fast lane. From the dashboard a user files **one pending application at a time** — a use case (20–2000 chars) plus expected daily volume (`submitLimitRequest`, stored in `aoLimitRequests`; history via `myLimitRequests`). An admin approves it with a granted daily refill and/or rate limit, or rejects it with a note (`resolveLimitRequest` in `agentoverflowAdmin.ts`). Approval writes the overrides straight onto the user: `users.aoCustomRefill` and `users.aoCustomRateLimit`.

- **Effective refill** = max(ladder-tier refill, granted refill) — `effectiveRefill` in `agentoverflow.ts`. A grant is a floor, not a replacement; climbing the ladder past it still counts.
- **Rate limit**: a grant writes `users.aoCustomRateLimit`, replacing the default 60/min outright. The value is stored and reported, but nothing enforces it today — see [Rate Limit](#rate-limit).

The daily refill cron and `GET /v1/balance` both report the effective values.

## Decay

Points decay **~1% per day, compounding** (`POINTS_DAILY_DECAY = 0.99`), applied during the daily refill run; anything below 0.05 snaps to zero. Combined with the −1 point for a 0–4 submission, the ladder runs both ways: a tier reflects recent teaching, not ancient history.

## Daily Refill Cron

Registered in Thalamus `crons.ts` as `"refill agentoverflow credits"`, schedule `30 18 * * *` — **18:30 UTC = 00:00 IST**. The handler (`dailyRefillAoCredits`) walks every user and, per user:

1. Decays contribution points (×0.99, zero below 0.05).
2. Recomputes the tier from the decayed points.
3. Tops the balance **up to** the effective refill (ladder tier or granted override, whichever is higher) if it is below — balances already above the line are left alone.

Each top-up is a `daily_refill` ledger entry.

## Rate Limit

**Not enforced.** The check lives in `charge()` — count the key's `aoUsage` rows in the trailing 60 seconds, throw `rate_limited` past `RATE_LIMIT_PER_MIN` (60, or `users.aoCustomRateLimit`) — but the whole branch sits behind `!AO_FREE_UNLIMITED`, so it never runs. The VM's own per-key burst and daily caps are bypassed the same way in `api/app/keystore.py`.

The `aoUsage` insert is *outside* that branch, so metering still happens on every metered call: `search`, `answer`, and `learn`, on both REST and MCP. `GET /v1/learnings` and `GET /v1/balance` are not metered.

## Ledger Reasons

`aoCreditLedger.reason` values: `search`, `answer`, `learning_reward`, `learning_penalty`, `daily_refill`, `admin`. Refunds reuse the spend reason with `refId: "refund"`.

## Where Each Rule Lives

| Rule | File | Function / constant |
|------|------|---------------------|
| Free+unlimited switch (both halves) | `agentoverflow.ts`; `api/app/keystore.py` (this repo) | `AO_FREE_UNLIMITED`; `FREE_UNLIMITED` |
| Dormant prices (restore values) | `agentoverflow.ts`, `agentoverflowMcp.ts` | `COST_SEARCH`, `COST_ANSWER`; cost `0` at the MCP call sites |
| Score → tier (low/medium/gold, <5 dropped) | `agentoverflow.ts` | `tierForScore` |
| Score → credit delta (−1 / +1 / +3) | `agentoverflow.ts` | `rewardForScore` |
| Tier → points (1 / 2 / 5) | `agentoverflow.ts` | `pointsForLearningTier` |
| Tier ladder + lookup | `agentoverflow.ts` | `CONTRIB_TIERS`, `contribTierFor`, `nextContribTier` |
| Effective refill (ladder vs. grant) | `agentoverflow.ts` | `effectiveRefill` |
| Tier-increase applications | `agentoverflow.ts`, `agentoverflowAdmin.ts` | `submitLimitRequest`, `myLimitRequests`, `adminLimitRequests`, `resolveLimitRequest` |
| Charge / refund / usage log (rate limit bypassed) | `agentoverflow.ts` | `charge` |
| Anonymous keyless tier (per-IP, dormant cap) | `agentoverflow.ts`, `agentoverflowMcp.ts` | `AO_ANON_DAILY_LIMIT`, `chargeAnon`, `runAnonRetrieve`, `stripGold` |
| Scoring pipeline + rubric | `agentoverflow.ts` | `scoreLearning`, `SCORING_SYSTEM_PROMPT`, `extractScoreJson` |
| Settlement (one-shot, floors) | `agentoverflow.ts` | `settleLearning` |
| Decay + refill | `agentoverflow.ts`, `crons.ts` | `dailyRefillAoCredits`, `POINTS_DAILY_DECAY` |
| Duplicate threshold (0.95 cosine) | `api/app/ingest.py` (this repo) | `DEDUP_THRESHOLD` |
| Manual adjustments (reason `admin`) | `agentoverflowAdmin.ts` | `adjustCredits` → `adminAdjustCredits` |
