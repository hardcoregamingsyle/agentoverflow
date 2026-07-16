"""Tests for the pure scoring math."""

import math
import unittest

from ingestion.scoring import (
    calibrate_cutpoints,
    log1p_clamped,
    percentile_rank,
    quantile,
    raw_score,
    reservoir_sample,
    score_from_cutpoints,
    tier_for_score,
)


class TestPercentileRank(unittest.TestCase):
    def test_empty_sample_raises(self):
        with self.assertRaises(ValueError):
            percentile_rank([], 1.0)

    def test_below_everything_is_zero(self):
        self.assertEqual(percentile_rank([1.0, 2.0, 3.0], 0.5), 0.0)

    def test_above_everything_is_one(self):
        self.assertEqual(percentile_rank([1.0, 2.0, 3.0], 4.0), 1.0)

    def test_ties_count_less_or_equal(self):
        self.assertAlmostEqual(percentile_rank([1.0, 2.0, 2.0, 3.0], 2.0), 0.75)


class TestRawScore(unittest.TestCase):
    def test_full_marks(self):
        self.assertAlmostEqual(raw_score(1.0, 1.0, True, 1.0), 1.0)

    def test_zero(self):
        self.assertEqual(raw_score(0.0, 0.0, False, 0.0), 0.0)

    def test_accepted_bonus_is_exactly_a_tenth(self):
        self.assertAlmostEqual(
            raw_score(0.5, 0.5, True, 0.5) - raw_score(0.5, 0.5, False, 0.5), 0.10)

    def test_weights(self):
        self.assertAlmostEqual(raw_score(1.0, 0.0, False, 0.0), 0.45)
        self.assertAlmostEqual(raw_score(0.0, 1.0, False, 0.0), 0.35)
        self.assertAlmostEqual(raw_score(0.0, 0.0, False, 1.0), 0.10)


class TestQuantile(unittest.TestCase):
    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            quantile([], 0.5)

    def test_endpoints_and_interpolation(self):
        vals = [0.0, 1.0, 2.0, 3.0]
        self.assertEqual(quantile(vals, 0.0), 0.0)
        self.assertEqual(quantile(vals, 1.0), 3.0)
        self.assertAlmostEqual(quantile(vals, 0.5), 1.5)


class TestCutpoints(unittest.TestCase):
    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            calibrate_cutpoints([])

    def test_cutpoints_ascending(self):
        cuts = calibrate_cutpoints([i / 999 for i in range(1000)])
        self.assertEqual(cuts, sorted(cuts))
        self.assertEqual(len(cuts), 10)

    def test_all_equal_distribution_collapses_upward(self):
        cuts = calibrate_cutpoints([0.5] * 100)
        self.assertEqual(score_from_cutpoints(0.5, cuts), 10)
        self.assertEqual(score_from_cutpoints(0.4999, cuts), 0)

    def test_target_fractions_on_uniform_distribution(self):
        raws = [i / 9999 for i in range(10000)]
        cuts = calibrate_cutpoints(raws)
        scores = [score_from_cutpoints(r, cuts) for r in raws]
        n = len(scores)
        self.assertAlmostEqual(sum(s == 10 for s in scores) / n, 0.05, delta=0.005)
        self.assertAlmostEqual(sum(s in (8, 9) for s in scores) / n, 0.15, delta=0.01)

    def test_exact_cutpoint_takes_higher_score(self):
        raws = [i / 999 for i in range(1000)]
        cuts = calibrate_cutpoints(raws)
        self.assertEqual(score_from_cutpoints(cuts[3], cuts), 4)
        self.assertEqual(score_from_cutpoints(cuts[9], cuts), 10)
        self.assertEqual(score_from_cutpoints(math.nextafter(cuts[0], -1.0), cuts), 0)

    def test_mapping_is_monotonic(self):
        raws = [i / 999 for i in range(1000)]
        cuts = calibrate_cutpoints(raws)
        scores = [score_from_cutpoints(r, cuts) for r in raws]
        self.assertEqual(scores, sorted(scores))


class TestTierMapping(unittest.TestCase):
    def test_drop_below_four(self):
        for s in (0, 1, 2, 3):
            self.assertIsNone(tier_for_score(s))

    def test_tiers(self):
        self.assertEqual(tier_for_score(4), "quarantine")
        for s in (5, 6, 7):
            self.assertEqual(tier_for_score(s), "low")
        for s in (8, 9):
            self.assertEqual(tier_for_score(s), "medium")
        self.assertEqual(tier_for_score(10), "gold")

    def test_out_of_range_raises(self):
        for s in (-1, 11):
            with self.assertRaises(ValueError):
                tier_for_score(s)


class TestReservoirSample(unittest.TestCase):
    def test_input_smaller_than_k_returned_whole(self):
        self.assertEqual(reservoir_sample(range(5), 10, seed=1), [0, 1, 2, 3, 4])

    def test_sample_size_respected(self):
        self.assertEqual(len(reservoir_sample(range(1000), 50, seed=1)), 50)

    def test_deterministic_for_same_seed(self):
        a = reservoir_sample(range(1000), 50, seed=42)
        b = reservoir_sample(range(1000), 50, seed=42)
        self.assertEqual(a, b)

    def test_seed_changes_selection(self):
        a = reservoir_sample(range(1000), 50, seed=1)
        b = reservoir_sample(range(1000), 50, seed=2)
        self.assertNotEqual(a, b)


class TestLog1pClamped(unittest.TestCase):
    def test_negative_clamps_to_zero(self):
        self.assertEqual(log1p_clamped(-5.0), 0.0)

    def test_zero(self):
        self.assertEqual(log1p_clamped(0.0), 0.0)

    def test_positive_matches_log1p(self):
        self.assertEqual(log1p_clamped(9.0), math.log1p(9.0))


if __name__ == "__main__":
    unittest.main()
