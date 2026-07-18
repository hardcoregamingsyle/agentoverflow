// /sitemap.xml on the site's own domain.
//
// The sitemap is generated on the platform (Convex, backed by the corpus VM),
// but a crawler wants it under the same host as the pages it lists. This proxies
// the platform sitemap index and rewrites the child-sitemap links to this
// domain's /sitemaps/<n>.xml (served by the sibling function). Edge-cached, so a
// crawl doesn't re-hit the backend.

const PLATFORM = "https://befitting-wildebeest-866.convex.site";
const SITE = "https://agentoverflow.aphantic.skinticals.com";

export async function onRequestGet() {
  const res = await fetch(`${PLATFORM}/ao/sitemap.xml`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  let body = await res.text();
  // Point the child sitemaps at this host regardless of the platform origin.
  body = body.replace(/https?:\/\/[^/]+\/ao\/sitemaps\/(\d+)\.xml/g, `${SITE}/sitemaps/$1.xml`);
  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
