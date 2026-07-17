"""GET /internal/doc/{doc_id} and the sitemap endpoints.

Read-only Postgres lookups used by the AgentOverflow site for public doc
pages and sitemap generation. Validation helpers are pure so the test suite
can exercise them stdlib-only; db imports stay inside the run_* functions.
"""

from __future__ import annotations

import math
import re
from typing import Any

DOC_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")
SITEMAP_PER_PAGE = 10000


def valid_doc_id(doc_id: str) -> bool:
    return DOC_ID_RE.fullmatch(doc_id) is not None


def parse_page(raw: str) -> int | None:
    """0-based sitemap page number, or None when raw isn't a non-negative
    base-10 integer (rejects "-1", "1.5", "+2", "1e3", "")."""
    if not raw.isdecimal():
        return None
    return int(raw)


def run_get_doc(doc_id: str) -> dict[str, Any] | None:
    """Full documents row + tags, or None when the doc_id doesn't exist."""
    from app.db import get_pool

    with get_pool().connection() as conn:
        row = conn.execute(
            "SELECT doc_id, title, problem, solution, score, tier, source, url, created_at "
            "FROM documents WHERE doc_id = %s",
            (doc_id,),
        ).fetchone()
        if row is None:
            return None
        tags = [
            tag
            for (tag,) in conn.execute(
                "SELECT tag FROM doc_tags WHERE doc_id = %s ORDER BY tag", (doc_id,)
            ).fetchall()
        ]
    return {
        "doc_id": row[0],
        "title": row[1],
        "problem": row[2],
        "solution": row[3],
        "score": row[4],
        "tier": row[5],
        "tags": tags,
        "url": row[7],
        "source": row[6],
        "created_at": row[8].isoformat() if row[8] is not None else None,
    }


def run_sitemap_index() -> dict[str, int]:
    from app.db import get_pool

    with get_pool().connection() as conn:
        (total,) = conn.execute("SELECT COUNT(*) FROM documents").fetchone()
    return {"pages": math.ceil(total / SITEMAP_PER_PAGE), "per_page": SITEMAP_PER_PAGE}


def run_sitemap_page(page: int) -> dict[str, list[str]]:
    """doc_ids for one 0-based sitemap page; empty list beyond the end."""
    from app.db import get_pool

    with get_pool().connection() as conn:
        rows = conn.execute(
            "SELECT doc_id FROM documents ORDER BY doc_id LIMIT %s OFFSET %s",
            (SITEMAP_PER_PAGE, page * SITEMAP_PER_PAGE),
        ).fetchall()
    return {"doc_ids": [row[0] for row in rows]}
