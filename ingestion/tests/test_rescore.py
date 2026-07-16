"""Tests for the pure parts of the rescore-llm stage (no network)."""

import unittest

from ingestion.stages.rescore_llm import build_prompt, final_score, parse_grade


class TestParseGrade(unittest.TestCase):
    def test_strict_json(self):
        self.assertEqual(parse_grade('{"score": 9, "reason": "solid fix"}'), 9)

    def test_tolerates_markdown_fence(self):
        self.assertEqual(parse_grade('```json\n{"score": 7, "reason": "ok"}\n```'), 7)

    def test_non_json_raises(self):
        with self.assertRaises(ValueError):
            parse_grade("nine out of ten")

    def test_missing_score_raises(self):
        with self.assertRaises(KeyError):
            parse_grade('{"reason": "no score"}')

    def test_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            parse_grade('{"score": 11, "reason": "x"}')


class TestFinalScore(unittest.TestCase):
    def test_demotion_floors_at_seven(self):
        self.assertEqual(final_score(0), 7)
        self.assertEqual(final_score(6), 7)

    def test_band_passthrough(self):
        for s in (7, 8, 9, 10):
            self.assertEqual(final_score(s), s)


class TestBuildPrompt(unittest.TestCase):
    def test_contains_rubric_and_content(self):
        prompt = build_prompt("Title X", "problem text", "solution text", 8000)
        self.assertIn("Title X", prompt)
        self.assertIn("problem text", prompt)
        self.assertIn("solution text", prompt)
        self.assertIn('"score"', prompt)

    def test_truncates_long_bodies(self):
        prompt = build_prompt("t", "p" * 100_000, "s" * 100_000, 8000)
        self.assertLess(len(prompt), 9000)


if __name__ == "__main__":
    unittest.main()
