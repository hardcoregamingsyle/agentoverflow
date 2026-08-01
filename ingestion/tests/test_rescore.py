"""Tests for the pure parts of the rescore-llm stage (no network)."""

import unittest
import urllib.error
from unittest.mock import patch

from ingestion.stages.rescore_llm import (
    _KeyRateLimiter,
    _grade_with_retries,
    build_prompt,
    final_score,
    parse_grade,
)


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


class TestKeyRateLimiter(unittest.TestCase):
    def test_acquire_fills_one_key_before_moving_to_the_next(self):
        limiter = _KeyRateLimiter(["a", "b"], rpm=2)
        self.assertEqual([limiter.acquire() for _ in range(4)], ["a", "a", "b", "b"])

    def test_penalize_makes_a_key_unavailable_immediately(self):
        limiter = _KeyRateLimiter(["a", "b"], rpm=40)
        limiter.penalize("a")
        self.assertEqual(limiter.acquire(), "b")


class TestGradeWithRetries(unittest.TestCase):
    def test_429_penalizes_the_key_and_the_retry_uses_a_different_one(self):
        # Regression test: a prior version acquired a key once and retried on
        # it directly, so a 429 just kept hammering the same already-limited
        # key until all attempts were exhausted and the whole stage crashed.
        limiter = _KeyRateLimiter(["a", "b"], rpm=40)
        calls = []

        def fake_call_nim(model, key, prompt):
            calls.append(key)
            if key == "a":
                raise urllib.error.HTTPError("url", 429, "Too Many Requests", {}, None)
            return '{"score": 8, "reason": "ok"}'

        with patch("ingestion.stages.rescore_llm._call_nim", side_effect=fake_call_nim):
            score = _grade_with_retries("model", limiter, "prompt")

        self.assertEqual(score, 8)
        self.assertEqual(calls, ["a", "b"])

    def test_non_retryable_status_raises_immediately(self):
        limiter = _KeyRateLimiter(["a"], rpm=40)

        def fake_call_nim(model, key, prompt):
            raise urllib.error.HTTPError("url", 404, "Not Found", {}, None)

        with patch("ingestion.stages.rescore_llm._call_nim", side_effect=fake_call_nim):
            with self.assertRaises(urllib.error.HTTPError):
                _grade_with_retries("model", limiter, "prompt")


if __name__ == "__main__":
    unittest.main()
