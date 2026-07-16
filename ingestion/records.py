"""Corpus record helpers pinned by contract C (stdlib only).

doc_id "so-<questionId>", Qdrant point id = uuid5(NAMESPACE_URL, doc_id)
(what the VM API expects), canonical question URL, embedding input
title + "\\n" + problem truncated to 2000 chars, snippet = first 400 chars
of the problem.
"""

from __future__ import annotations

import uuid


def doc_id(qid: int) -> str:
    return f"so-{qid}"


def point_id(doc_id: str) -> str:
    """Deterministic Qdrant point id for a doc_id (shared with the VM API)."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, doc_id))


def question_url(qid: int) -> str:
    return f"https://stackoverflow.com/q/{qid}"


def embedding_text(title: str, problem: str, max_chars: int = 2000) -> str:
    return f"{title}\n{problem}"[:max_chars]


def snippet(problem: str, max_chars: int = 400) -> str:
    return problem[:max_chars]
