"""Tests for the filter stage's keep/drop decisions."""

import unittest

from ingestion.filtering import BestAnswer, best_answer, keep_question
from ingestion.xmlrows import AnswerRow, QuestionRow


def _question(**overrides) -> QuestionRow:
    base = dict(qid=1, title="How?", body="<p>b</p>", score=2, views=10,
                tags=["python"], accepted_aid=None)
    base.update(overrides)
    return QuestionRow(**base)


def _answer(aid=1, score=2, body="<p>a</p>") -> AnswerRow:
    return AnswerRow(aid=aid, parent_qid=1, body=body, score=score)


class TestKeepQuestion(unittest.TestCase):
    def test_keeps_at_threshold(self):
        self.assertTrue(keep_question(_question(score=2), min_score=2))

    def test_drops_below_threshold(self):
        self.assertFalse(keep_question(_question(score=1), min_score=2))

    def test_drops_empty_title(self):
        self.assertFalse(keep_question(_question(title=""), min_score=2))

    def test_drops_empty_body(self):
        self.assertFalse(keep_question(_question(body=""), min_score=2))


class TestBestAnswer(unittest.TestCase):
    def test_low_score_non_accepted_is_rejected(self):
        self.assertIsNone(best_answer(None, _answer(score=1), None, min_score=2))

    def test_at_threshold_is_kept(self):
        best = best_answer(None, _answer(aid=5, score=2), None, min_score=2)
        self.assertEqual(best, BestAnswer(5, "<p>a</p>", 2, False))

    def test_accepted_qualifies_regardless_of_score(self):
        best = best_answer(None, _answer(aid=5, score=-2), accepted_aid=5, min_score=2)
        self.assertIsNotNone(best)
        self.assertTrue(best.accepted)

    def test_accepted_beats_higher_scoring(self):
        current = best_answer(None, _answer(aid=1, score=100), accepted_aid=5, min_score=2)
        best = best_answer(current, _answer(aid=5, score=3), accepted_aid=5, min_score=2)
        self.assertEqual(best.aid, 5)

    def test_accepted_not_displaced_by_higher_score(self):
        current = best_answer(None, _answer(aid=5, score=3), accepted_aid=5, min_score=2)
        best = best_answer(current, _answer(aid=1, score=100), accepted_aid=5, min_score=2)
        self.assertEqual(best.aid, 5)

    def test_higher_score_wins(self):
        current = best_answer(None, _answer(aid=1, score=3), None, min_score=2)
        best = best_answer(current, _answer(aid=2, score=7), None, min_score=2)
        self.assertEqual(best.aid, 2)

    def test_tie_prefers_lower_answer_id(self):
        current = best_answer(None, _answer(aid=9, score=5), None, min_score=2)
        best = best_answer(current, _answer(aid=3, score=5), None, min_score=2)
        self.assertEqual(best.aid, 3)
        # and in the other arrival order
        current = best_answer(None, _answer(aid=3, score=5), None, min_score=2)
        best = best_answer(current, _answer(aid=9, score=5), None, min_score=2)
        self.assertEqual(best.aid, 3)

    def test_empty_body_is_ignored_even_if_accepted(self):
        self.assertIsNone(best_answer(None, _answer(aid=5, body=""), accepted_aid=5,
                                      min_score=2))

    def test_unqualified_candidate_keeps_current(self):
        current = best_answer(None, _answer(aid=1, score=5), None, min_score=2)
        best = best_answer(current, _answer(aid=2, score=1), None, min_score=2)
        self.assertIs(best, current)


if __name__ == "__main__":
    unittest.main()
