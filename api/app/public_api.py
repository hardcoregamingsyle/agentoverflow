"""Public /v1 surface — the endpoint agents actually hit.

Auth is a local bearer-key check (see keystore): no Convex round-trip on the
hot path, so search is a Qdrant query and nothing else. Every response carries
the caller's daily budget in headers so a client can back off before it 429s.

Routes:
* POST /v1/search      — semantic + graph search over the corpus (free tier)
* GET  /v1/doc/{id}    — one full document by id
* GET  /v1/health      — unauthenticated liveness, for the load balancer
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from app import keystore
from app.public import run_get_doc, valid_doc_id
from app.search import SearchRequest, SearchResponse, run_search

router = APIRouter()


@dataclass(frozen=True)
class Authed:
    record: keystore.KeyRecord
    key_hash: str


def require_key(authorization: str = Header(default="")) -> Authed:
    """Resolve an `ao_` bearer token to its local key record, or 401.

    Kept deliberately cheap — one indexed lookup — because it runs on every
    search. Quota is charged later, in the route, so an unauthorized request
    never touches the counters.
    """
    raw = authorization[7:].strip() if authorization.startswith("Bearer ") else ""
    if not raw.startswith("ao_"):
        raise HTTPException(status_code=401, detail="missing or malformed bearer key")
    key_hash = keystore.hash_key(raw)
    record = keystore.lookup(key_hash)
    if record is None:
        raise HTTPException(status_code=401, detail="unknown or revoked API key")
    return Authed(record=record, key_hash=key_hash)


def _charge(auth: Authed, response: Response) -> None:
    """Count the request and 429 if it's over the minute burst or daily cap.

    Surfaces the daily budget as headers on the allowed path so well-behaved
    clients can pace themselves instead of discovering the wall at request 10001.
    """
    result = keystore.charge_quota(auth.record, auth.key_hash)
    if not result.allowed:
        if result.reason == "over_burst":
            raise HTTPException(
                status_code=429,
                detail="per-minute burst limit exceeded; slow down",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(
            status_code=429,
            detail=f"daily free-tier limit of {result.daily_limit} requests reached",
            headers={"Retry-After": "3600"},
        )
    response.headers["X-AO-Daily-Limit"] = str(result.daily_limit)
    response.headers["X-AO-Daily-Used"] = str(result.daily_used)


@router.post("/v1/search", response_model=SearchResponse)
def public_search(
    body: SearchRequest, response: Response, auth: Authed = Depends(require_key)
) -> SearchResponse:
    _charge(auth, response)
    return run_search(body)


@router.get("/v1/doc/{doc_id}")
def public_doc(doc_id: str, response: Response, auth: Authed = Depends(require_key)):
    _charge(auth, response)
    if not valid_doc_id(doc_id):
        raise HTTPException(status_code=400, detail="invalid doc_id")
    doc = run_get_doc(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="not found")
    return doc


@router.get("/v1/health")
def public_health() -> dict[str, bool | int]:
    from app.db import postgres_health, qdrant_health

    qdrant_ok, points = qdrant_health()
    postgres_ok = postgres_health()
    return {"ok": qdrant_ok and postgres_ok, "points": points}


# ── SEO surface (no auth) ─────────────────────────────────────────────────────
# The corpus is public, indexable content — Stack Overflow (CC BY-SA) plus agent
# learnings. This route feeds the site's /q/<id> solution pages and the edge
# renderer that injects their HTML for crawlers. No key: a search engine can't
# carry one. Abuse is bounded by the Cloudflare edge cache in front (identical
# doc requests never reach the VM twice within the TTL), and the id is validated
# to the same shape used everywhere else.

DOC_CACHE_SECONDS = 86_400


@router.get("/public/doc/{doc_id}")
def public_doc_seo(doc_id: str, response: Response):
    if not valid_doc_id(doc_id):
        raise HTTPException(status_code=400, detail="invalid doc_id")
    doc = run_get_doc(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="not found")
    # Long TTL: a solved problem's text doesn't change. Lets the edge absorb a
    # full 3.7M-page crawl without re-hitting Postgres for every request.
    response.headers["Cache-Control"] = f"public, max-age={DOC_CACHE_SECONDS}"
    return doc
