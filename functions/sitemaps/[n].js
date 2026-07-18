// /sitemaps/<n>.xml — one page of up to 10k /q/ URLs, proxied from the platform.
//
// The URLs inside already point at this domain (the platform builds them from
// AO_FRONTEND_URL), so this just forwards the page and caches it at the edge.

const PLATFORM = "https://befitting-wildebeest-866.convex.site";

export async function onRequestGet(context) {
  const seg = String(context.params.n || "");
  const match = seg.match(/^(\d{1,6})\.xml$/);
  if (!match) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><error/>`, {
      status: 404,
      headers: { "Content-Type": "application/xml" },
    });
  }
  const res = await fetch(`${PLATFORM}/ao/sitemaps/${match[1]}.xml`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
