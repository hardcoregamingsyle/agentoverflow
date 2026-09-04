// Edge-render for /q/<docId> solution pages.
//
// The site is a client-rendered SPA — great for humans, near-invisible to a
// crawler that won't run our JS across 3.7M pages. This Pages Function sits in
// front of every /q/<id> request, pulls the solved problem from the corpus VM,
// and rewrites the shell's <head> in place (title, description, canonical, OG /
// Twitter) plus a QAPage JSON-LD block, and drops the full question + answer
// text into #root. Googlebot indexes that immediately; React clears #root on
// mount, so a human just sees the normal app.
//
// In place matters: the shell already ships a generic <title>, a homepage
// <link rel=canonical>, and OG tags. Appending would leave two titles and two
// canonicals — poison for ranking — so every singleton is overwritten, never
// duplicated. Only the robots meta and the JSON-LD (which the shell lacks) are
// appended.
//
// The doc fetch is cached at the Cloudflare edge (the VM sends a 1-day
// Cache-Control), so a full crawl doesn't hammer the backend.

const DOC_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;
const SEARCH_BASE = "https://api.agentoverflow.aphantic.skinticals.com";
const SITE = "https://agentoverflow.aphantic.skinticals.com";

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const docId = String(params.docId || "");

  const shell = await env.ASSETS.fetch(new URL("/index.html", request.url));

  // Malformed id: never a real page — keep it out of the index.
  if (!DOC_ID_RE.test(docId)) return serveNoindex(shell, 200);

  let doc = null;
  try {
    const res = await fetch(`${SEARCH_BASE}/public/doc/${encodeURIComponent(docId)}`, {
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (res.status === 404) return serveNoindex(shell, 404); // real 404, not a soft one
    if (res.ok) doc = await res.json();
  } catch {
    // VM unreachable — fall through and let the client-side app fetch it.
  }
  if (!doc) return shell;

  return renderDoc(shell, doc, docId);
}

function renderDoc(shell, doc, docId) {
  const url = `${SITE}/q/${docId}`;
  const fullTitle = pageTitle(doc);
  const description = metaDescription(doc);

  const rw = new HTMLRewriter()
    // Overwrite the singletons the shell already ships.
    .on("title", { element: (e) => e.setInnerContent(fullTitle) })
    .on('meta[name="description"]', { element: (e) => e.setAttribute("content", description) })
    .on('link[rel="canonical"]', { element: (e) => e.setAttribute("href", url) })
    .on('meta[property="og:type"]', { element: (e) => e.setAttribute("content", "article") })
    .on('meta[property="og:title"]', { element: (e) => e.setAttribute("content", fullTitle) })
    .on('meta[property="og:description"]', { element: (e) => e.setAttribute("content", description) })
    .on('meta[property="og:url"]', { element: (e) => e.setAttribute("content", url) })
    .on('meta[name="twitter:title"]', { element: (e) => e.setAttribute("content", fullTitle) })
    .on('meta[name="twitter:description"]', { element: (e) => e.setAttribute("content", description) })
    // Append the things the shell doesn't have: index directive + QAPage schema.
    .on("head", {
      element(e) {
        e.append(`<meta name="robots" content="index,follow,max-image-preview:large" />`, { html: true });
        e.append(jsonLd(doc, url), { html: true });
      },
    })
    // Crawler-visible content; React clears #root on mount for humans.
    .on("#root", { element: (e) => e.append(prerender(doc, docId), { html: true }) });

  return capped(rw.transform(shell), 200);
}

// Missing/invalid doc: keep the shell but tell crawlers not to index it.
function serveNoindex(shell, status) {
  const rw = new HTMLRewriter().on("head", {
    element: (e) => e.append(`<meta name="robots" content="noindex,follow" />`, { html: true }),
  });
  return capped(rw.transform(shell), status);
}

function capped(res, status) {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=600, s-maxage=3600");
  return new Response(res.body, { status, headers });
}

function prerender(doc, docId) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  // Real internal links to related /q pages (from the corpus graph edges). This
  // is the discovery lever: crawlers follow these to reach deep pages instead of
  // relying on the sitemap alone, and the link graph tells Google which pages
  // matter. Each id is validated to the same shape used everywhere else.
  const related = (Array.isArray(doc.related) ? doc.related : [])
    .filter((r) => r && DOC_ID_RE.test(r.doc_id || ""))
    .slice(0, 8);
  const relatedBlock = related.length
    ? `<h2>Related problems</h2><ul>${related
        .map((r) => `<li><a href="${SITE}/q/${attr(r.doc_id)}">${esc(r.title || r.doc_id)}</a></li>`)
        .join("")}</ul>`
    : "";
  return [
    `<main>`,
    `<h1>${esc(doc.title || "")}</h1>`,
    tags.length ? `<p>${tags.map((t) => esc(t)).join(", ")}</p>` : "",
    `<h2>Problem</h2><p>${esc(doc.problem || "")}</p>`,
    `<h2>Solution</h2><pre>${esc(doc.solution || "")}</pre>`,
    doc.url ? `<p><a href="${attr(doc.url)}" rel="noreferrer">Original source</a></p>` : "",
    relatedBlock,
    `<p><a href="${SITE}/playground?q=${encodeURIComponent(clip(oneLine(doc.title || ""), 120))}">Search AgentOverflow for related problems</a></p>`,
    `</main>`,
  ].join("");
}

function jsonLd(doc, url) {
  const data = {
    "@context": "https://schema.org",
    "@type": "QAPage",
    mainEntity: {
      "@type": "Question",
      name: clip(doc.title || "", 300),
      text: clip(oneLine(doc.problem || ""), 1000),
      answerCount: 1,
      acceptedAnswer: {
        "@type": "Answer",
        text: clip(doc.solution || "", 5000),
        url,
      },
    },
  };
  // </script> can't appear raw inside a script element.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// ── SERP copy ─────────────────────────────────────────────────────────────────
// The listing, not the ranking, was the problem. These pages average position 8
// on ~200k monthly impressions and were converting at 0.035% — roughly 50x under
// the ~1.5% a position-8 result normally earns. The cause is visible the moment
// you look at a SERP: we shipped the Stack Overflow title verbatim, so our row
// read as a lower-authority mirror of the row above it, and the description
// restated the *question* — which the searcher already knows, having just typed
// it — in raw Markdown, cut mid-word.
//
// So: lead the title with the thing SO's own row can't claim in its title, and
// spend the description on the answer instead of the question.

function pageTitle(doc) {
  const title = clip(oneLine(doc.title || ""), 80) || "Solved problem";
  // "Solved:" only where a solution genuinely exists — every corpus doc is an
  // accepted answer scored >= 5, but the prefix is a claim, so it stays tied to
  // the field rather than the assumption.
  const prefix = String(doc.solution || "").trim() ? "Solved: " : "";
  return `${prefix}${title} — AgentOverflow`;
}

function metaDescription(doc) {
  const answer = plain(doc.solution || "");
  const problem = plain(doc.problem || "");
  // Answer first. Fall back to the question only when the solution is pure code
  // and strips to nothing worth reading in a SERP.
  const body = answer.length >= 60 ? answer : [answer, problem].filter(Boolean).join(" ");
  return clipWords(body || problem, 155);
}

// Markdown → prose a human can read in a search result. Fenced code is dropped
// outright (it renders as noise at 160 chars); inline code keeps its text since
// that is usually the identifier the answer turns on.
function plain(s) {
  return oneLine(
    String(s)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/~~~[\s\S]*?~~~/g, " ")
      .replace(/^ {4,}\S.*$/gm, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[`*_>#]/g, "")
      .replace(/^\s*[-+]\s+/gm, " "),
  );
}

// ── text helpers ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function attr(s) {
  return esc(s).replace(/"/g, "&quot;");
}
function oneLine(s) {
  return String(s).replace(/\s+/g, " ").trim();
}
function clip(s, n) {
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}
// Same as clip() but never cuts mid-word — a description ending "attribut…" reads
// as broken scraper output, which is exactly the impression we're trying to lose.
// Falls back to a hard cut if the last space is so early that word-safety would
// throw away most of the budget.
function clipWords(s, n) {
  const t = oneLine(s);
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}
