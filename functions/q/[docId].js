// Edge-render for /q/<docId> solution pages.
//
// The site is a client-rendered SPA — great for humans, near-invisible to a
// crawler that won't run our JS across 3.7M pages. This Pages Function sits in
// front of every /q/<id> request, pulls the solved problem from the corpus VM,
// and injects real HTML into the shell before it ships: <title>, meta
// description, canonical, Open Graph/Twitter, a QAPage JSON-LD block, and the
// full question + answer text inside #root. Googlebot indexes that immediately;
// React clears #root on mount, so a human just sees the normal app.
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

  // Malformed id: never a real page — serve the shell but keep it out of the
  // index rather than letting a junk URL rank.
  if (!DOC_ID_RE.test(docId)) {
    return rewriteHead(shell, [noindexTag()], 200);
  }

  let doc = null;
  try {
    const res = await fetch(`${SEARCH_BASE}/public/doc/${encodeURIComponent(docId)}`, {
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (res.status === 404) {
      // Real 404 status + noindex so Google drops it, not a soft-404.
      return rewriteHead(shell, [noindexTag()], 404);
    }
    if (res.ok) doc = await res.json();
  } catch {
    // VM unreachable — fall through and let the client-side app retry.
  }

  // Couldn't render server-side: ship the plain shell, the SPA fetches the doc.
  if (!doc) return shell;

  const url = `${SITE}/q/${docId}`;
  const title = clip(doc.title || "Solved problem", 110);
  const description = clip(oneLine(doc.problem || ""), 160);

  const headTags = [
    `<title>${esc(title)} — AgentOverflow</title>`,
    `<meta name="description" content="${attr(description)}" />`,
    `<link rel="canonical" href="${attr(url)}" />`,
    `<meta name="robots" content="index,follow,max-image-preview:large" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${attr(title)}" />`,
    `<meta property="og:description" content="${attr(description)}" />`,
    `<meta property="og:url" content="${attr(url)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${attr(title)}" />`,
    `<meta name="twitter:description" content="${attr(description)}" />`,
    jsonLd(doc, url),
  ];

  return rewriteHead(shell, headTags, 200, prerender(doc, docId));
}

// Apply the head injections (and optional #root prerender) to the shell.
function rewriteHead(shell, headTags, status, rootHtml) {
  let rw = new HTMLRewriter().on("head", {
    element(el) {
      for (const tag of headTags) el.append(tag, { html: true });
    },
  });
  if (rootHtml) {
    rw = rw.on("#root", {
      element(el) {
        el.append(rootHtml, { html: true });
      },
    });
  }
  const out = rw.transform(shell);
  // Preserve headers, override status (404 for missing docs) and let humans and
  // crawlers share the edge cache for a while.
  const headers = new Headers(out.headers);
  headers.set("Cache-Control", "public, max-age=600, s-maxage=3600");
  return new Response(out.body, { status, headers });
}

// The crawler-visible content. React's createRoot().render() clears #root on
// mount, so this never double-renders for a human.
function prerender(doc, docId) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  return [
    `<main>`,
    `<h1>${esc(doc.title || "")}</h1>`,
    tags.length ? `<p>${tags.map((t) => esc(t)).join(", ")}</p>` : "",
    `<h2>Problem</h2><p>${esc(doc.problem || "")}</p>`,
    `<h2>Solution</h2><pre>${esc(doc.solution || "")}</pre>`,
    doc.url ? `<p><a href="${attr(doc.url)}" rel="noreferrer">Original source</a></p>` : "",
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

function noindexTag() {
  return `<meta name="robots" content="noindex,follow" />`;
}

// ── text helpers ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
