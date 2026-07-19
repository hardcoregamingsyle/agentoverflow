"""AgentOverflow VM API — two surfaces on one uvicorn.

* /internal/*  — secret-authed (X-AO-Internal-Secret). Convex reaches these for
                 ingest, delete, sitemaps, health, and pushing key snapshots.
                 The process refuses to start without AO_INTERNAL_SECRET.
* /v1/*        — public, bearer `ao_` key + local quota (see public_api). This
                 is the surface agents hit; it never calls Convex.

The internal secret used to ride cleartext HTTP on port 8080. Behind Caddy TLS
both surfaces are HTTPS and 8080 is loopback-only, so the secret no longer
crosses the wire.
"""

from __future__ import annotations

import os
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import keystore
from app.ingest import DuplicateError, IngestRequest, run_delete, run_ingest
from app.public import (
    parse_page,
    run_get_doc,
    run_sitemap_index,
    run_sitemap_page,
    valid_doc_id,
)
from app.public_api import router as public_router
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


# The secret dependency lives on this router, NOT the app — that's what lets the
# public /v1 router coexist under a different (bearer) auth on the same app.
internal = APIRouter(dependencies=[Depends(require_secret)])


@internal.post("/internal/search", response_model=SearchResponse)
def internal_search(body: SearchRequest) -> SearchResponse:
    return run_search(body)


@internal.post("/internal/ingest")
def internal_ingest(body: IngestRequest) -> JSONResponse:
    try:
        vm_doc_id = run_ingest(body)
    except DuplicateError as exc:
        return JSONResponse(
            status_code=409,
            content={"error": "duplicate", "duplicate_of": exc.duplicate_of},
        )
    return JSONResponse(status_code=200, content={"vm_doc_id": vm_doc_id})


@internal.delete("/internal/item/{doc_id}")
def internal_delete(doc_id: str) -> JSONResponse:
    # Same doc_id shape check as the GET route. A junk id was always a no-op
    # (delete-by-payload just matches nothing), but rejecting it up front means
    # both doc_id routes behave identically and a caller bug surfaces as a 400
    # instead of a silent "ok".
    if not valid_doc_id(doc_id):
        return JSONResponse(status_code=400, content={"error": "invalid_doc_id"})
    run_delete(doc_id)
    return JSONResponse(status_code=200, content={"ok": True})


@internal.post("/internal/sync-keys")
def internal_sync_keys(body: dict) -> JSONResponse:
    """Full snapshot of active API keys, pushed by Convex on a cron.

    Body: {"keys": [{"key_hash","user_id","daily_quota","burst_per_min"}, ...]}.
    A full replace (see keystore.replace_keys) means a revocation in Convex
    lands here as an omission — no separate delete call to keep in sync.
    """
    keys = body.get("keys")
    if not isinstance(keys, list):
        return JSONResponse(status_code=400, content={"error": "keys must be a list"})
    keystore.ensure_schema()
    active = keystore.replace_keys(keys)
    return JSONResponse(status_code=200, content={"ok": True, "active_keys": active})


@internal.get("/internal/doc/{doc_id}")
def internal_doc(doc_id: str) -> JSONResponse:
    if not valid_doc_id(doc_id):
        return JSONResponse(status_code=400, content={"error": "invalid_doc_id"})
    doc = run_get_doc(doc_id)
    if doc is None:
        return JSONResponse(status_code=404, content={"error": "not_found"})
    return JSONResponse(status_code=200, content=doc)


@internal.get("/internal/sitemap-index")
def internal_sitemap_index() -> dict[str, int]:
    return run_sitemap_index()


@internal.get("/internal/sitemap/{page}")
def internal_sitemap(page: str) -> JSONResponse:
    parsed = parse_page(page)
    if parsed is None:
        return JSONResponse(status_code=400, content={"error": "invalid_page"})
    return JSONResponse(status_code=200, content=run_sitemap_page(parsed))


@internal.get("/internal/health")
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


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Best-effort: if Postgres isn't up yet the first /internal/sync-keys will
    # create the tables anyway. Never let a cold DB stop the process booting.
    try:
        keystore.ensure_schema()
    except Exception:
        pass
    yield


# Auto-docs are disabled: even the public surface shouldn't hand out a schema of
# every route on an internet-facing port.
app = FastAPI(
    title="AgentOverflow API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=_lifespan,
)

# CORS for the browser-facing surfaces. The playground (public /public/search)
# and the /q solution pages (public /public/doc) are fetched cross-origin from
# the AgentOverflow site, and agents call /v1/* from anywhere — all need
# Access-Control-Allow-Origin and a handled OPTIONS preflight. A public,
# unauthenticated read API is a "*" origin by nature; this doesn't weaken
# /internal, which is gated by the X-AO-Internal-Secret header (a browser CORS
# grant can't forge a server-checked header), nor the bearer-key quota on /v1.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    max_age=86400,
)
app.include_router(internal)
app.include_router(public_router)
