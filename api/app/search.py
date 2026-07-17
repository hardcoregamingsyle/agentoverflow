"""POST /internal/search implementation (pinned contract C)."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, Field

from app.rerank import Candidate, rerank

SNIPPET_CHARS = 400


class SearchRequest(BaseModel):
    # The Convex gateway already clamps these before calling us, but this API
    # trusts nothing past the shared secret: bounds here keep a compromised or
    # buggy caller from asking for a 10k-result scan or a megabyte "query"
    # (embedding truncates at 2000 chars anyway — the cap just refuses the
    # pointless payload outright).
    query: str = Field(min_length=1, max_length=8000)
    top_k: int = Field(default=5, ge=1, le=25)
    tags: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(
        default=[], max_length=10)
    expand: bool = True


class SearchResult(BaseModel):
    doc_id: str
    title: str
    snippet: str
    solution: str
    score: int
    tier: str
    tags: list[str]
    source: str
    url: str | None
    similarity: float


class SearchResponse(BaseModel):
    results: list[SearchResult]


def run_search(req: SearchRequest) -> SearchResponse:
    from app.db import COLLECTION, get_pool, get_qdrant
    from app.embedding import embed_text

    vector = embed_text(req.query)
    hits = get_qdrant().query_points(
        collection_name=COLLECTION,
        query=vector,
        limit=req.top_k,
        query_filter=_build_filter(req),
        with_payload=["doc_id"],
    ).points

    # similarity per direct hit; setdefault keeps the best score if Qdrant
    # ever returns the same doc twice (scores arrive descending).
    similarities: dict[str, float] = {}
    for hit in hits:
        doc_id = (hit.payload or {}).get("doc_id")
        if doc_id:
            similarities.setdefault(str(doc_id), float(hit.score))

    hit_ids = list(similarities)
    with get_pool().connection() as conn:
        docs = _fetch_documents(conn, hit_ids)
        neighbor_sim: dict[str, float] = {}
        if req.expand and hit_ids:
            neighbor_sim = _expand_neighbors(conn, similarities, docs)
        tags_map = _fetch_tags(conn, list(docs))

    candidates = [
        Candidate(doc_id=doc_id, similarity=sim, tier=docs[doc_id]["tier"])
        for doc_id, sim in similarities.items()
        if doc_id in docs
    ] + [
        Candidate(doc_id=doc_id, similarity=sim, tier=docs[doc_id]["tier"], graph_neighbor=True)
        for doc_id, sim in neighbor_sim.items()
    ]

    results = [
        _to_result(docs[c.doc_id], tags_map.get(c.doc_id, []), c.similarity)
        for c in rerank(candidates, req.top_k)
    ]
    return SearchResponse(results=results)


def _build_filter(req: SearchRequest) -> Any:
    from qdrant_client import models as qm

    if not req.tags:
        return None
    # tag filter matches ANY of the given tags
    return qm.Filter(
        must=[qm.FieldCondition(key="tags", match=qm.MatchAny(any=req.tags))]
    )


def _expand_neighbors(
    conn: Any,
    similarities: dict[str, float],
    docs: dict[str, dict[str, Any]],
) -> dict[str, float]:
    """1-hop expansion via doc_links. Neighbors inherit the (best) similarity
    of the hit that linked to them and are flagged for the graph bonus.
    Mutates `docs` with the fetched neighbor rows."""
    links = conn.execute(
        "SELECT src, dst FROM doc_links WHERE src = ANY(%s)", (list(similarities),)
    ).fetchall()
    neighbor_sim: dict[str, float] = {}
    for src, dst in links:
        if dst in similarities:
            continue
        neighbor_sim[dst] = max(neighbor_sim.get(dst, 0.0), similarities[src])
    if not neighbor_sim:
        return {}
    neighbor_docs = _fetch_documents(conn, list(neighbor_sim))
    docs.update(neighbor_docs)
    return {doc_id: sim for doc_id, sim in neighbor_sim.items() if doc_id in neighbor_docs}


def _fetch_documents(conn: Any, doc_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not doc_ids:
        return {}
    rows = conn.execute(
        "SELECT doc_id, title, problem, solution, score, tier, source, url "
        "FROM documents WHERE doc_id = ANY(%s)",
        (doc_ids,),
    ).fetchall()
    return {
        row[0]: {
            "doc_id": row[0],
            "title": row[1],
            "problem": row[2],
            "solution": row[3],
            "score": row[4],
            "tier": row[5],
            "source": row[6],
            "url": row[7],
        }
        for row in rows
    }


def _fetch_tags(conn: Any, doc_ids: list[str]) -> dict[str, list[str]]:
    if not doc_ids:
        return {}
    rows = conn.execute(
        "SELECT doc_id, tag FROM doc_tags WHERE doc_id = ANY(%s) ORDER BY tag", (doc_ids,)
    ).fetchall()
    tags_map: dict[str, list[str]] = {}
    for doc_id, tag in rows:
        tags_map.setdefault(doc_id, []).append(tag)
    return tags_map


def _to_result(doc: dict[str, Any], tags: list[str], similarity: float) -> SearchResult:
    return SearchResult(
        doc_id=doc["doc_id"],
        title=doc["title"],
        snippet=doc["problem"][:SNIPPET_CHARS],
        solution=doc["solution"],
        score=doc["score"],
        tier=doc["tier"],
        tags=tags,
        source=doc["source"],
        url=doc["url"],
        similarity=similarity,
    )
