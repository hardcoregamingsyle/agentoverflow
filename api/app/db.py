"""psycopg connection pool + Qdrant client factories, plus health probes.

Heavy imports (psycopg, qdrant_client) happen inside the factories so the
module is importable without them installed.
"""

from __future__ import annotations

import os
import time
from typing import Any

from app.embedding import VECTOR_SIZE

COLLECTION = "ao_corpus"

QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333")
# Default matches deploy/docker-compose.yml service names; the compose file
# overrides this with the real POSTGRES_PASSWORD.
PG_DSN = os.environ.get("PG_DSN", "postgresql://ao:ao@postgres:5432/ao")

_pool: Any = None
_qdrant: Any = None


def get_pool() -> Any:
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool

        _pool = ConnectionPool(PG_DSN, min_size=1, max_size=8, open=True)
    return _pool


def get_qdrant() -> Any:
    global _qdrant
    if _qdrant is None:
        from qdrant_client import QdrantClient

        _qdrant = QdrantClient(url=QDRANT_URL)
    return _qdrant


def ensure_collection() -> None:
    """Create ao_corpus if missing (fresh VM before the ingestion pipeline ran).

    Mirrors the pipeline's embed-load settings: 384-d cosine, on-disk vectors,
    int8 scalar quantization.
    """
    from qdrant_client import models as qm

    client = get_qdrant()
    if client.collection_exists(COLLECTION):
        return
    client.create_collection(
        collection_name=COLLECTION,
        vectors_config=qm.VectorParams(
            size=VECTOR_SIZE, distance=qm.Distance.COSINE, on_disk=True
        ),
        quantization_config=qm.ScalarQuantization(
            scalar=qm.ScalarQuantizationConfig(type=qm.ScalarType.INT8)
        ),
    )


def qdrant_health() -> tuple[bool, int]:
    try:
        client = get_qdrant()
        if not client.collection_exists(COLLECTION):
            return True, 0
        return True, int(client.count(COLLECTION, exact=True).count)
    except Exception:
        return False, 0


def postgres_health() -> bool:
    try:
        with get_pool().connection() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


# documents.source has no index, so the breakdown is a sequential scan of a
# multi-million-row table. The docker healthcheck calls /internal/health every
# 30s and the admin panel reads the same payload, so the result is memoized —
# corpus counts move on ingestion timescales, not on a 30-second probe's.
SOURCE_COUNTS_TTL_SECONDS = 600
_source_counts: dict[str, int] | None = None
_source_counts_at = 0.0


def corpus_source_counts() -> dict[str, int]:
    """Breakdown of corpus documents by source (so, learning), cached 10 min."""
    global _source_counts, _source_counts_at

    now = time.monotonic()
    if _source_counts is not None and now - _source_counts_at < SOURCE_COUNTS_TTL_SECONDS:
        return _source_counts

    try:
        with get_pool().connection() as conn:
            rows = conn.execute(
                "SELECT source, COUNT(*) as cnt FROM documents GROUP BY source"
            ).fetchall()
        counts = {source: int(cnt) for source, cnt in rows}
    except Exception:
        # Don't cache a failure — the next probe should retry.
        return {}

    _source_counts = counts
    _source_counts_at = now
    return counts
