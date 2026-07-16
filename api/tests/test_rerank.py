"""Unit tests for app.rerank — stdlib only, no third-party deps required."""

import os
import sys
import unittest

_API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from app.rerank import Candidate, rerank, rerank_score  # noqa: E402


class RerankScoreTests(unittest.TestCase):
    def test_similarity_only_for_low_tier(self):
        self.assertAlmostEqual(
            rerank_score(Candidate("a", 0.80, "low")), 0.80
        )

    def test_gold_bonus(self):
        self.assertAlmostEqual(
            rerank_score(Candidate("a", 0.80, "gold")), 0.90
        )

    def test_medium_bonus(self):
        self.assertAlmostEqual(
            rerank_score(Candidate("a", 0.80, "medium")), 0.85
        )

    def test_unknown_tiers_get_no_bonus(self):
        self.assertAlmostEqual(
            rerank_score(Candidate("a", 0.80, "nonsense")), 0.80
        )

    def test_graph_neighbor_bonus(self):
        self.assertAlmostEqual(
            rerank_score(Candidate("a", 0.80, "low", graph_neighbor=True)), 0.85
        )

    def test_bonuses_stack(self):
        self.assertAlmostEqual(
            rerank_score(Candidate("a", 0.80, "gold", graph_neighbor=True)), 0.95
        )


class RerankTests(unittest.TestCase):
    def test_orders_by_similarity(self):
        ranked = rerank(
            [
                Candidate("lo", 0.60, "low"),
                Candidate("hi", 0.90, "low"),
                Candidate("mid", 0.75, "low"),
            ],
            top_k=5,
        )
        self.assertEqual([c.doc_id for c in ranked], ["hi", "mid", "lo"])

    def test_gold_neighbor_outranks_stronger_direct_hit(self):
        # 0.80 + 0.10 (gold) + 0.05 (neighbor) = 0.95 > 0.92
        ranked = rerank(
            [
                Candidate("direct", 0.92, "low"),
                Candidate("neighbor", 0.80, "gold", graph_neighbor=True),
            ],
            top_k=2,
        )
        self.assertEqual([c.doc_id for c in ranked], ["neighbor", "direct"])

    def test_dedup_keeps_best_variant(self):
        direct = Candidate("dup", 0.70, "low")
        as_neighbor = Candidate("dup", 0.70, "low", graph_neighbor=True)
        ranked = rerank([direct, as_neighbor], top_k=5)
        self.assertEqual(len(ranked), 1)
        self.assertTrue(ranked[0].graph_neighbor)

    def test_top_k_truncates(self):
        candidates = [Candidate(f"d{i}", 0.5 + i / 100, "low") for i in range(10)]
        ranked = rerank(candidates, top_k=3)
        self.assertEqual([c.doc_id for c in ranked], ["d9", "d8", "d7"])

    def test_top_k_zero_or_negative_returns_empty(self):
        candidates = [Candidate("a", 0.9, "low")]
        self.assertEqual(rerank(candidates, top_k=0), [])
        self.assertEqual(rerank(candidates, top_k=-1), [])

    def test_empty_input(self):
        self.assertEqual(rerank([], top_k=5), [])

    def test_tie_breaks_are_deterministic(self):
        # Equal final score and similarity -> ordered by doc_id.
        ranked = rerank(
            [Candidate("b", 0.80, "low"), Candidate("a", 0.80, "low")],
            top_k=2,
        )
        self.assertEqual([c.doc_id for c in ranked], ["a", "b"])
