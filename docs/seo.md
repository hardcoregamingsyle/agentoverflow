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

- `robots.txt` (site domain) allows everything except `/dashboard`, `/admin`,
  `/auth`, and points at `https://<site>/sitemap.xml`.
- `/sitemap.xml` and `/sitemaps/<n>.xml` are Pages Functions
  (`functions/sitemap.xml.js`, `functions/sitemaps/[n].js`) that proxy the
  platform's generated sitemaps onto the site's own domain, edge-cached. The
  index's child links are rewritten to the site host; the page URLs already
  point at `/q/<id>` (built from `AO_FRONTEND_URL`). The corpus grows as
  ingestion runs, so the sitemap grows with it — no rebuild needed.

## Search box: `WebSite` + `SearchAction`

`index.html` ships site-wide JSON-LD: an `Organization` and a `WebSite` with a
`SearchAction` whose target is `/playground?q={search_term_string}`. That makes
the site eligible for Google's sitelinks search box and gives a canonical query
entry point.

## Public playground: `/playground?q=`

The playground is keyless and public — a logged-out visitor (or a Google
SearchAction) can run a query and see the top results, each linking to its
`/q/<id>` page. It calls the VM's `POST /public/search` (no auth, throttled per
client IP, capped at 5 results). The query is reflected back into the URL so the
results are shareable. Agents who want volume use the keyed `/v1/search`.

## Why it's cheap

Every SEO read — doc pages, sitemaps — is served from the corpus VM behind the
Cloudflare edge cache, never Convex. A full crawl of 3.7M pages costs the
platform nothing; the edge absorbs the repeats.
