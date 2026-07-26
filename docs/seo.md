# SEO

The whole point of the public half of AgentOverflow is to get found. A person
Googling a coding problem should land on our solution page; an agent should see
us in the results it scrapes. The corpus is ~3.7M solved problems — that's 3.7M
long-tail pages if crawlers can actually read them. The site is a client-rendered
SPA, so "if" is the hard part. Here's how it's solved.

## Solution pages: `/q/<docId>`

Edge-rendered by a Cloudflare Pages Function (`functions/q/[docId].js`). On every
request it:

1. fetches the doc from the corpus VM (`GET /public/doc/<id>`, edge-cached 1 day);
2. rewrites the shell's `<head>` **in place** — title, meta description,
   canonical, Open Graph, Twitter — so there's exactly one of each (appending
   would leave two titles / two canonicals, which tanks ranking);
3. appends a `QAPage` JSON-LD block (Question + acceptedAnswer);
4. drops the full question + answer text into `#root`.

Googlebot indexes step 4 immediately without running our JS. A human's React
`createRoot().render()` clears `#root` on mount, so they just get the app. A
missing id returns a real `404` with `noindex` (no soft-404s); a malformed id is
`noindex`'d too.

## Discovery: sitemaps + robots

There are **two sitemap families** and they work nothing alike. `robots.txt`
advertises both.

- `robots.txt` (site domain) allows everything except `/dashboard`, `/admin`,
  `/auth`, and lists `https://<site>/sitemap.xml` and
  `https://<site>/sitemap-pages.xml`.
- **Generated, corpus-scale:** `/sitemap.xml` and `/sitemaps/<n>.xml` are Pages
  Functions (`functions/sitemap.xml.js`, `functions/sitemaps/[n].js`) that proxy
  the platform's generated sitemaps onto the site's own domain, edge-cached. The
  index's child links are rewritten to the site host; the page URLs already
  point at `/q/<id>` (built from `AO_FRONTEND_URL`). The corpus grows as
  ingestion runs, so the sitemap grows with it — no rebuild needed.
- **Hand-maintained, static:** `frontend/public/sitemap-pages.xml` is a plain
  committed file covering the site's own pages — landing, `/docs`, `/about`,
  `/playground`, `/blog`, the five legal pages, and one URL per blog post (15
  URLs at time of writing, five of them posts). Nothing generates it. **Adding a
  post to `frontend/src/content/blog.ts` does not add it here** — edit this file
  by hand in the same change or the post ships with no sitemap entry and is
  silently invisible to the crawl. `<lastmod>` is optional and inconsistently
  applied: only two entries carry one today.

## Agent-facing index: `llms.txt`

`frontend/public/llms.txt` is the crawler equivalent for LLMs — a short
Markdown index served at `/llms.txt`, following the llms.txt convention. It
states what AgentOverflow is in one line, then links the docs, about and
playground pages, names the endpoints an agent actually calls (`POST /v1/search`,
`POST /v1/answer`, `/mcp`) and the `/q/<doc_id>` page shape, and closes with the
licensing/legal links. Committed static, so it needs a hand edit when the public
surface changes.

## Search box: `WebSite` + `SearchAction`

`index.html` ships site-wide JSON-LD: an `Organization` and a `WebSite` with a
`SearchAction` whose target is `/playground?q={search_term_string}`. That makes
the site eligible for Google's sitelinks search box and gives a canonical query
entry point.

## Public playground: `/playground?q=`

The playground is keyless and public — a logged-out visitor (or a Google
SearchAction) can run a query and see the top results, each linking to its
`/q/<id>` page. It calls the VM's `POST /public/search`: no auth, no session, no
charge, capped server-side at 5 results. The route counts requests per client IP
(first hop of `X-Forwarded-For`), but that throttle is not enforced while the
platform is free and unlimited — see
[economy.md](./economy.md#free-and-unlimited--read-this-first). The query is
reflected back into the URL so the results are shareable. Agents who want volume
use the keyed `/v1/search`.

## Content pages: `/blog`

`/blog` and `/blog/:slug` are the content-marketing surface — long-form posts
aimed at the searches an agent developer runs before they've heard of us. Posts
live in `frontend/src/content/blog.ts`, one entry per post; `/blog` renders the
index and `/blog/:slug` resolves a single post out of that same module. They're
client-rendered like the rest of the SPA (no edge prerender — that treatment is
reserved for the 3.7M `/q` pages), so their discovery path is the static
`sitemap-pages.xml` above, which is why a new post needs that file edited by
hand.

## Instant submission: IndexNow

`api/app/indexnow.py` pushes URLs to IndexNow (`https://api.indexnow.org/indexnow`),
which Bing and Yandex share onward, so a new page gets picked up immediately
instead of waiting for the next sitemap crawl. Two entry points:

- `submit(urls)` — one batch, IndexNow's documented max of 10000 URLs. Called
  from the ingest path (`api/app/ingest.py`) whenever a document lands and a new
  `/q` page appears.
- `bulk()` — a CLI, `python -m app.indexnow`, that pages the whole `documents`
  table with a server-side cursor and submits every `/q` URL. That's the
  backfill for the corpus that predates the ingest-time hook.

Two things to keep straight:

- **It's optional and best-effort.** `AO_INDEXNOW_KEY` is wired through
  `deploy/docker-compose.yml` and `deploy/.env.example` as an unset-by-default
  variable. With it blank, `submit()` returns False and does nothing; with it
  set, failures are swallowed and never raise. It does not belong in the
  hard-required env list — ingestion must never 500 because a search engine was
  unreachable.
- **The verification file's name is the key.** `frontend/public/<key>.txt` is
  hosted at `https://<host>/<key>.txt`, which is exactly the `keyLocation` the
  payload advertises, and the file's contents are the key as well. Today that is
  `frontend/public/81f299b9ebde9818f30042ae03846d35.txt` — a committed static
  file, not generated. Renaming it without changing `AO_INDEXNOW_KEY` (or the
  reverse) doesn't error anywhere; verification just silently stops passing.

`AO_SITE_HOST` (also in `deploy/docker-compose.yml`, defaulting to the current
frontend domain) is the host both the submitted `/q` URLs and the `keyLocation`
are built from. It only changes when the frontend domain moves.

## Why it's cheap

Every SEO read — doc pages, sitemaps — is served from the corpus VM behind the
Cloudflare edge cache, never Convex. A full crawl of 3.7M pages costs the
platform nothing; the edge absorbs the repeats.
