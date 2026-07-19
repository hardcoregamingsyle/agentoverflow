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
    """Full documents row + tags + related docs, or None when it doesn't exist."""
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
        # Related solutions via the graph edges (doc_links.src is indexed, so this
        # is a cheap fan-out). Feeds the "Related" block on the /q page and, more
        # importantly, the crawlable internal links the edge renderer injects —
        # turning the corpus into a link graph instead of an island of sitemap-only
        # URLs, which is what actually gets deep pages discovered at scale.
        related = [
            {"doc_id": r_id, "title": r_title}
            for (r_id, r_title) in conn.execute(
                "SELECT d.doc_id, d.title FROM doc_links l "
                "JOIN documents d ON d.doc_id = l.dst "
                "WHERE l.src = %s AND d.doc_id <> %s "
                "ORDER BY l.kind, d.score DESC LIMIT 8",
                (doc_id, doc_id),
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
        "related": related,
    }


def run_sitemap_index() -> dict[str, int]:
    from app.db import get_pool

    with get_pool().connection() as conn:
        (total,) = conn.execute("SELECT COUNT(*) FROM documents").fetchone()
    return {"pages": math.ceil(total / SITEMAP_PER_PAGE), "per_page": SITEMAP_PER_PAGE}


def run_sitemap_page(page: int) -> dict[str, Any]:
    """One 0-based sitemap page; empty beyond the end.

    Returns both `doc_ids` (unchanged, so a not-yet-redeployed Convex sitemap
    builder keeps working) and `docs` — each `{doc_id, lastmod}` — so the
    updated builder can emit a <lastmod> per URL. lastmod gives Google a
    freshness/recrawl signal it otherwise lacks across a 500k+ URL set.
    """
    from app.db import get_pool

    with get_pool().connection() as conn:
        rows = conn.execute(
            "SELECT doc_id, created_at FROM documents ORDER BY doc_id LIMIT %s OFFSET %s",
            (SITEMAP_PER_PAGE, page * SITEMAP_PER_PAGE),
        ).fetchall()
    return {
        "doc_ids": [row[0] for row in rows],
        "docs": [
            {"doc_id": row[0], "lastmod": row[1].isoformat() if row[1] is not None else None}
            for row in rows
        ],
    }
