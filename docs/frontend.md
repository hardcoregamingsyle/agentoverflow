# Frontend — the Site

The human-facing site (`frontend/`): landing, API docs, auth, dashboard, playground, blog, the legal pages, and the admin panel. A static Vite + React SPA that talks straight to the shared Thalamus Convex deployment — no backend of its own, no Convex codegen.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 + react-router v7 (the `react-router` package, not react-router-dom) |
| Build | TypeScript strict, Vite 7, Bun |
| Styling | Tailwind v4 CSS-first (no config file) + a minimal vendored shadcn layer (`src/components/ui/` — don't customize) |
| Data | `convex/react` with `makeFunctionReference` — auth is Thalamus custom tokens, **not** `@convex-dev/auth` |

## Routes

Declared in `src/main.tsx`; every page is lazy-loaded behind an error boundary that gives a failed route chunk one automatic reload (covers the stale-index.html-after-deploy case).

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Landing | pitch + API quickstart |
| `/docs` | Docs | user-facing `/ao/v1/*` reference (repo-facing version: [api.md](./api.md)) |
| `/auth` | Auth | email OTP + Google/GitHub OAuth |
| `/dashboard` | Dashboard | `ao_` keys, credits/ledger, tier progress, tier-increase applications, learnings |
| `/playground` | Playground | keyless corpus search from the browser — no key, no session, no charge (see below) |
| `/admin` | Admin | operator panel — see [admin.md](./admin.md) |
| `/q/:docId` | Question | public page for one corpus document, fetched straight from the corpus VM (`GET {AO_SEARCH_BASE}/public/doc/<id>`, no auth); the target of every sitemap URL (see [architecture.md](./architecture.md#public-seo-surface)) |
| `/about` | About | what the corpus is and how search works |
| `/blog` | Blog | post index; the posts themselves are declared in `src/content/blog.ts` |
| `/blog/:slug` | BlogPost | one post, resolved from that same module |
| `/privacy`, `/terms`, `/attribution`, `/contact`, `/dmca` | Privacy, Terms, Attribution, Contact, Dmca | the legal cluster — static copy, one component each, with no data of their own beyond the shared `Layout` header. Not product surfaces; `/attribution` is where the corpus's CC BY-SA terms live. |
| `*` | NotFound | 404 |

`/about`, `/blog`, `/blog/:slug` and the five legal pages exist for crawlers and humans reading before they sign up, which is why they carry sitemap entries ([seo.md](./seo.md)) while `/dashboard`, `/admin` and `/auth` are disallowed in `robots.txt`.

## Public Playground

`/playground` is the one search surface with no key at all. `publicSearch` in `src/lib/thalamusApi.ts` POSTs to `${AO_SEARCH_BASE}/public/search` with **no `Authorization` header**, and the VM's `public_search_seo` route (`api/app/public_api.py`) takes no auth dependency — there is no session, no `ao_` key and no credit involved:

- Results are clamped to `PUBLIC_SEARCH_TOP_K = 5` server-side regardless of the `top_k` the client asks for.
- The route resolves a client IP from the first hop of `X-Forwarded-For` (falling back to the socket peer) and counts it, but the throttle it feeds is **not enforced** while the platform is free and unlimited — `charge_public_ip` counts and returns allowed. The counters keep running so usage metrics stay honest. See [economy.md](./economy.md#free-and-unlimited--read-this-first).
- The 429 path is therefore dormant, not gone. If it ever fires, `publicSearch` throws and `Playground.tsx` surfaces it as a `sonner` toast.
- The query is mirrored into the URL (`?q=`, plus `?tags=`) so results are shareable — that's the target of the site's `SearchAction` JSON-LD.

## Auth Against the Shared Deployment

There is no AgentOverflow login — the site uses Thalamus's custom-token auth (`src/hooks/use-auth.ts`):

- The session token lives in localStorage under `agentoverflow_session_token` (`SESSION_KEY`); a `storage` listener syncs sign-in/out across tabs.
- **Email OTP**: `customAuth:sendOtp` then `customAuth:verifyOtp` (actions on the shared deployment) return the token.
- **OAuth**: `startOAuth("google" | "github")` redirects through the deployment's OAuth flow, which lands back on `/auth?token=...` (or `?oauth_error=...`); the token is adopted into localStorage. The site's origin must be allowlisted via `AO_FRONTEND_URL` on the Convex side or the redirect is rejected.
- The current user is a reactive query (`customAuthHelpers:getUserByToken`); `customAuthHelpers:signOut` invalidates the session server-side.
- Every authenticated Convex call passes `{ token }` explicitly — there is no ambient auth context.

## The makeFunctionReference Pattern

`src/lib/thalamusApi.ts` declares every Convex function this app calls, typed, in one place:

```ts
export const createApiKey = makeFunctionReference<
  "action",
  { token: string; name: string },
  { keyId: string; fullKey: string; keyPrefix: string }
>("agentoverflow:createApiKey");
```

There is no `_generated/api` here — the contract is pinned by string name. Consequence: renaming a Convex function in the Thalamus repo breaks this site **silently at runtime, not at build time**. If you touch function names over there, update this file.

## CONVEX_URL Fallback

`src/lib/convexUrl.ts`: `VITE_CONVEX_URL` wins when set (local dev, staging); otherwise the production deployment URL is the compiled-in default — the URL ships in the public bundle either way and was never a secret, so an unset env var doesn't break builds. The public agent API base is derived at runtime: `AO_API_BASE = CONVEX_URL.replace(".convex.cloud", ".convex.site")`.

## Local Dev

```bash
cd frontend
bun install
cp .env.example .env.local    # VITE_CONVEX_URL=https://<deployment>.convex.cloud
bun run dev                   # http://localhost:5173 (vite.config.ts sets no port — Vite's default)
bun run build                 # tsc -b + vite build → dist/
bun run type-check            # TypeScript only
bun run lint                  # ESLint
```

## Cloudflare Pages Build

The repo builds from its **root** on purpose, so the Pages dashboard needs no root-directory fiddling:

- Root `package.json` carries the build script: `cd frontend && bun install && bun run build`.
- Root `wrangler.toml` sets `pages_build_output_dir = "frontend/dist"`.
- Pages setup: Workers & Pages → Create → Pages → Connect to Git, build command `bun run build`, leave root/output directories alone.
- `VITE_CONVEX_URL` is optional (see the fallback above); set it only to point a build at a different deployment.
- `frontend/public/_redirects` carries the SPA fallback (every route → `/index.html`) so deep links survive refreshes.
- Custom domains that should receive OAuth redirects must also be allowlisted via `AO_FRONTEND_URL` in the Thalamus deployment's env.

CLI deploy from the repo root: `bun run build && bunx wrangler pages deploy frontend/dist`.
