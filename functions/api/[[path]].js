// Same-origin proxy for the browser-facing corpus reads.
//
// The playground (POST /public/search) and the /q pages (GET /public/doc/<id>)
// used to call the VM host cross-origin. That requires CORS on the VM, and the
// VM's running container predated the commit that added the middleware — every
// browser call died at preflight as "Failed to fetch", while server-to-server
// calls worked, which made it look intermittent. Serving these two reads from
// the site's own origin removes the CORS dependency permanently: a stale VM
// build can no longer break the playground.
//
// Strict allowlist — this must never become a generic proxy (the VM also
// hosts the secret-authed /internal surface; nothing outside this list is
// reachable through here).
const VM_BASE = "https://api.agentoverflow.aphantic.skinticals.com";

const DOC_ID_RE = /^(so-\d+|learning-[A-Za-z0-9]+)$/;

export async function onRequest({ request, params }) {
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const path = segments.join("/");

  let upstream = null;
  if (request.method === "POST" && path === "public/search") {
    upstream = new Request(`${VM_BASE}/public/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: request.body,
    });
  } else if (request.method === "GET" && segments[0] === "public" && segments[1] === "doc" && segments.length === 3) {
    const docId = decodeURIComponent(segments[2]);
    if (!DOC_ID_RE.test(docId)) {
      return new Response(JSON.stringify({ error: "invalid_doc_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    upstream = new Request(`${VM_BASE}/public/doc/${encodeURIComponent(docId)}`);
  }

  if (!upstream) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Preserve the real client IP for the VM's keyless per-IP throttle (dormant
  // under free-unlimited, but the header should be honest when it re-arms).
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) upstream.headers.set("X-Forwarded-For", clientIp);

  try {
    const res = await fetch(upstream);
    // Pass the body and status through; strip hop-by-hop noise by rebuilding.
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
