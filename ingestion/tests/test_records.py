"""Tests for the contract-pinned record helpers."""

import unittest
import uuid

from ingestion.records import doc_id, embedding_text, point_id, question_url, snippet


class TestRecords(unittest.TestCase):
    def test_doc_id(self):
        self.assertEqual(doc_id(12345), "so-12345")

    def test_point_id_is_uuid5_of_doc_id(self):
        self.assertEqual(point_id("so-42"),
                         str(uuid.uuid5(uuid.NAMESPACE_URL, "so-42")))

    def test_question_url(self):
        self.assertEqual(question_url(42), "https://stackoverflow.com/q/42")

    def test_embedding_text_joins_with_newline(self):
        self.assertEqual(embedding_text("title", "problem"), "title\nproblem")

    def test_embedding_text_truncates_to_2000_by_default(self):
        text = embedding_text("t", "x" * 5000)
        self.assertEqual(len(text), 2000)
        self.assertTrue(text.startswith("t\nxxx"))

    def test_snippet_truncates_to_400_by_default(self):
        self.assertEqual(len(snippet("y" * 1000)), 400)
        self.assertEqual(snippet("short"), "short")


if __name__ == "__main__":
    unittest.main()
