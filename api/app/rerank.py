"""Pure re-ranking logic for /internal/search.

Deliberately dependency-free (stdlib only) so it can be unit-tested without
qdrant/postgres/fastembed installed. Contract: similarity is the primary
signal; graph neighbors get +0.05, tier gold +0.10 / medium +0.05.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

GRAPH_NEIGHBOR_BONUS = 0.05
TIER_BONUS = {"gold": 0.10, "medium": 0.05}


@dataclass(frozen=True)
class Candidate:
    doc_id: str
    similarity: float
    tier: str
    graph_neighbor: bool = False


def rerank_score(candidate: Candidate) -> float:
    bonus = GRAPH_NEIGHBOR_BONUS if candidate.graph_neighbor else 0.0
    return candidate.similarity + bonus + TIER_BONUS.get(candidate.tier, 0.0)


def rerank(candidates: Iterable[Candidate], top_k: int) -> list[Candidate]:
    """Merge vector hits and graph neighbors, dedup by doc_id, rank, cut to top_k.

    A doc_id appearing more than once (e.g. both a vector hit and someone's
    graph neighbor) keeps its highest-scoring variant.
    """
    best: dict[str, Candidate] = {}
    for candidate in candidates:
        current = best.get(candidate.doc_id)
        if current is None or rerank_score(candidate) > rerank_score(current):
            best[candidate.doc_id] = candidate
    ordered = sorted(
        best.values(),
        key=lambda c: (-rerank_score(c), -c.similarity, c.doc_id),
    )
    return ordered[: max(top_k, 0)]
