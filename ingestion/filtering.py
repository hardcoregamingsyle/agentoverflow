"""Keep/drop decisions for the filter stage (stdlib only).

Rules pinned by the spec: keep questions with Score >= 2; per question keep
the best answer — the accepted one if present (regardless of its score), else
the top-scoring answer with Score >= 2. Questions ending up with no
qualifying answer are dropped (they simply never get an ``answers`` row).
"""

from __future__ import annotations

from dataclasses import dataclass

from .xmlrows import AnswerRow, QuestionRow


@dataclass(frozen=True)
class BestAnswer:
    aid: int
    body: str
    score: int
    accepted: bool


def keep_question(q: QuestionRow, min_score: int) -> bool:
    return q.score >= min_score and bool(q.title) and bool(q.body)


def best_answer(
    current: BestAnswer | None,
    candidate: AnswerRow,
    accepted_aid: int | None,
    min_score: int,
) -> BestAnswer | None:
    """Fold one answer into the best-so-far for its question.

    Ranking: accepted beats everything, then higher score, then lower answer
    id (a deterministic tie-break so reruns produce identical shards).
    """
    if not candidate.body:
        return current
    accepted = accepted_aid is not None and candidate.aid == accepted_aid
    if not accepted and candidate.score < min_score:
        return current
    cand = BestAnswer(candidate.aid, candidate.body, candidate.score, accepted)
    if current is None:
        return cand
    if cand.accepted != current.accepted:
        return cand if cand.accepted else current
    if cand.score != current.score:
        return cand if cand.score > current.score else current
    return cand if cand.aid < current.aid else current
