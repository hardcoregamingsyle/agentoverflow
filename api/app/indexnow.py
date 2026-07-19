"""IndexNow submission — instant URL push to Bing/Yandex (shared onward).

Best-effort by design: a failed submission never blocks ingestion, and if
AO_INDEXNOW_KEY isn't set, submit() is a no-op. The key is also hosted at
https://<host>/<key>.txt (frontend/public/<key>.txt) so IndexNow can verify we
own the host.

Two entry points:
* submit(urls) — fire one batch (<=10000 URLs) from the ingest path when a new
                 /q page appears, so search engines learn about it immediately
                 instead of waiting for the next sitemap crawl.
* bulk()       — CLI (`python -m app.indexnow`) that pages the whole corpus and
                 submits every /q URL, for the existing 500k+ docs that predate
                 the ingest-time hook.
"""

from __future__ import annotations

import json
import os
import urllib.request

INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
SITE_HOST = os.environ.get("AO_SITE_HOST", "agentoverflow.aphantic.skinticals.com")
BATCH = 10_000  # IndexNow's documented max URLs per request


def _key() -> str:
    return os.environ.get("AO_INDEXNOW_KEY", "").strip()


def q_url(doc_id: str) -> str:
    return f"https://{SITE_HOST}/q/{doc_id}"


def submit(urls: list[str]) -> bool:
    """POST up to BATCH urls to IndexNow. Returns True on 200/202, False on any
    error or when unconfigured. Never raises — the caller is often the ingest
    hot path, and telling a search engine about a page is never worth a 500."""
    key = _key()
    if not key or not urls:
        return False
    payload = json.dumps(
        {
            "host": SITE_HOST,
            "key": key,
            "keyLocation": f"https://{SITE_HOST}/{key}.txt",
            "urlList": urls[:BATCH],
        }
    ).encode()
    req = urllib.request.Request(
        INDEXNOW_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status in (200, 202)
    except Exception:
        return False


def bulk() -> None:
    """Submit every corpus doc's /q URL in BATCH-sized requests. Streams doc_ids
    with a server-side cursor so it stays flat in memory across millions of rows."""
    from app.db import get_pool

    if not _key():
        raise SystemExit("AO_INDEXNOW_KEY not set")

    sent = 0
    batch: list[str] = []

    def flush() -> None:
        nonlocal sent, batch
        if not batch:
            return
        ok = submit(batch)
        sent += len(batch)
        print(f"submitted {sent} urls (last batch ok={ok})", flush=True)
        batch = []

    with get_pool().connection() as conn:
        with conn.cursor(name="indexnow_bulk") as cur:
            cur.execute("SELECT doc_id FROM documents ORDER BY doc_id")
            for (doc_id,) in cur:
                batch.append(q_url(doc_id))
                if len(batch) >= BATCH:
                    flush()
    flush()
    print(f"done: {sent} urls", flush=True)


if __name__ == "__main__":
    bulk()
