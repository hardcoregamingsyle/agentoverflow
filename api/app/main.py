"""AgentOverflow VM internal API (pinned contract C).

Every endpoint requires header X-AO-Internal-Secret matching the
AO_INTERNAL_SECRET env var. The process refuses to start without it.
"""

from __future__ import annotations

import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from app.ingest import DuplicateError, IngestRequest, run_delete, run_ingest
from app.public import (
    parse_page,
    run_get_doc,
    run_sitemap_index,
    run_sitemap_page,
    valid_doc_id,
)
from app.search import SearchRequest, SearchResponse, run_search

_SECRET = os.environ.get("AO_INTERNAL_SECRET", "")
if not _SECRET:
    raise RuntimeError("AO_INTERNAL_SECRET is not set — refusing to start")


def require_secret(
    x_ao_internal_secret: str = Header(default="", alias="X-AO-Internal-Secret"),
) -> None:
    # Compare as bytes: compare_digest on str raises TypeError for non-ASCII
    # input, which would turn a garbage header into an unauthenticated 500
    # instead of the 401 it deserves.
    header = x_ao_internal_secret.encode("utf-8", "surrogateescape")
    if not secrets.compare_digest(header, _SECRET.encode("utf-8")):
        raise HTTPException(status_code=401, detail="invalid or missing X-AO-Internal-Secret")


# Auto-docs are disabled: this API is internal-only but listens on an exposed
# port, and FastAPI's /docs, /redoc and /openapi.json routes do NOT inherit
# app-level dependencies — they'd serve the full API schema to anyone.
app = FastAPI(
    title="AgentOverflow internal API",
    dependencies=[Depends(require_secret)],
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.post("/internal/search", response_model=SearchResponse)
def internal_search(body: SearchRequest) -> SearchResponse:
    return run_search(body)


@app.post("/internal/ingest")
def internal_ingest(body: IngestRequest) -> JSONResponse:
    try:
        vm_doc_id = run_ingest(body)
    except DuplicateError as exc:
        return JSONResponse(
            status_code=409,
            content={"error": "duplicate", "duplicate_of": exc.duplicate_of},
        )
    return JSONResponse(status_code=200, content={"vm_doc_id": vm_doc_id})


@app.delete("/internal/item/{doc_id}")
def internal_delete(doc_id: str) -> JSONResponse:
    # Same doc_id shape check as the GET route. A junk id was always a no-op
    # (delete-by-payload just matches nothing), but rejecting it up front means
    # both doc_id routes behave identically and a caller bug surfaces as a 400
    # instead of a silent "ok".
    if not valid_doc_id(doc_id):
        return JSONResponse(status_code=400, content={"error": "invalid_doc_id"})
    run_delete(doc_id)
    return JSONResponse(status_code=200, content={"ok": True})


@app.get("/internal/doc/{doc_id}")
def internal_doc(doc_id: str) -> JSONResponse:
    if not valid_doc_id(doc_id):
        return JSONResponse(status_code=400, content={"error": "invalid_doc_id"})
    doc = run_get_doc(doc_id)
    if doc is None:
        return JSONResponse(status_code=404, content={"error": "not_found"})
    return JSONResponse(status_code=200, content=doc)


@app.get("/internal/sitemap-index")
def internal_sitemap_index() -> dict[str, int]:
    return run_sitemap_index()


@app.get("/internal/sitemap/{page}")
def internal_sitemap(page: str) -> JSONResponse:
    parsed = parse_page(page)
    if parsed is None:
        return JSONResponse(status_code=400, content={"error": "invalid_page"})
    return JSONResponse(status_code=200, content=run_sitemap_page(parsed))


@app.get("/internal/health")
def internal_health() -> dict[str, bool | int]:
    from app.db import postgres_health, qdrant_health

    qdrant_ok, points = qdrant_health()
    postgres_ok = postgres_health()
    return {
        "ok": qdrant_ok and postgres_ok,
        "qdrant": qdrant_ok,
        "postgres": postgres_ok,
        "points": points,
    }
