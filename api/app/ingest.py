"""POST /internal/ingest and DELETE /internal/item/{doc_id} (pinned contract C)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel

DEDUP_THRESHOLD = 0.95  # top-1 cosine at/above this is the same knowledge reworded — nobody farms credits here
SNIPPET_CHARS = 400


class IngestRequest(BaseModel):
    doc_id: str
    title: str
    problem: str
    solution: str
    tags: list[str]
    score: int
    tier: str
    source: str = "learning"
    url: str | None = None


class DuplicateError(Exception):
    def __init__(self, duplicate_of: str) -> None:
        super().__init__(f"duplicate of {duplicate_of}")
        self.duplicate_of = duplicate_of


def _point_id(doc_id: str) -> str:
    # Deterministic point id so re-ingesting the same doc_id overwrites.
    return str(uuid.uuid5(uuid.NAMESPACE_URL, doc_id))


def run_ingest(req: IngestRequest) -> str:
    """Upsert Qdrant point + Postgres row + tag edges. Raises DuplicateError
    when the top-1 cosine neighbor scores >= 0.95 (unless it is the same
    doc_id, which is an update, not a duplicate)."""
    from qdrant_client import models as qm

    from app.db import COLLECTION, ensure_collection, get_pool, get_qdrant
    from app.embedding import embed_text, embedding_input

    ensure_collection()
    client = get_qdrant()
    vector = embed_text(embedding_input(req.title, req.problem))

    top = client.query_points(
        collection_name=COLLECTION, query=vector, limit=1, with_payload=["doc_id"]
    ).points
    if top:
        duplicate_of = str((top[0].payload or {}).get("doc_id", ""))
        if float(top[0].score) >= DEDUP_THRESHOLD and duplicate_of != req.doc_id:
            raise DuplicateError(duplicate_of)

    client.upsert(
        collection_name=COLLECTION,
        points=[
            qm.PointStruct(
                id=_point_id(req.doc_id),
                vector=vector,
                payload={
                    "doc_id": req.doc_id,
                    "title": req.title,
                    "snippet": req.problem[:SNIPPET_CHARS],
                    "score": req.score,
                    "tier": req.tier,
                    "tags": req.tags,
                    "source": req.source,
                    "url": req.url,
                },
            )
        ],
    )

    with get_pool().connection() as conn:
        conn.execute(
            """
            INSERT INTO documents (doc_id, title, problem, solution, score, tier, source, url)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (doc_id) DO UPDATE SET
              title = EXCLUDED.title, problem = EXCLUDED.problem,
              solution = EXCLUDED.solution, score = EXCLUDED.score,
              tier = EXCLUDED.tier, source = EXCLUDED.source, url = EXCLUDED.url
            """,
            (req.doc_id, req.title, req.problem, req.solution, req.score, req.tier,
             req.source, req.url),
        )
        conn.execute("DELETE FROM doc_tags WHERE doc_id = %s", (req.doc_id,))
        for tag in dict.fromkeys(req.tags):
            conn.execute(
                "INSERT INTO doc_tags (doc_id, tag) VALUES (%s, %s)", (req.doc_id, tag)
            )
    return req.doc_id


def run_delete(doc_id: str) -> None:
    """Remove a document from Qdrant + Postgres. Idempotent."""
    from qdrant_client import models as qm

    from app.db import COLLECTION, get_pool, get_qdrant

    client = get_qdrant()
    if client.collection_exists(COLLECTION):
        # Delete by payload filter, not point id, so points loaded by the
        # ingestion pipeline are removable regardless of their id scheme.
        client.delete(
            collection_name=COLLECTION,
            points_selector=qm.FilterSelector(
                filter=qm.Filter(
                    must=[qm.FieldCondition(key="doc_id", match=qm.MatchValue(value=doc_id))]
                )
            ),
        )
    with get_pool().connection() as conn:
        conn.execute("DELETE FROM doc_tags WHERE doc_id = %s", (doc_id,))
        conn.execute("DELETE FROM doc_links WHERE src = %s OR dst = %s", (doc_id, doc_id))
        conn.execute("DELETE FROM documents WHERE doc_id = %s", (doc_id,))
