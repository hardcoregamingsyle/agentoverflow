"""Tests for <row> attribute parsing, especially missing attributes."""

import unittest

from ingestion.xmlrows import (
    parse_answer,
    parse_postlink,
    parse_question,
    parse_tags,
)


class TestParseTags(unittest.TestCase):
    def test_pipe_format(self):
        self.assertEqual(parse_tags("|python|pandas|"), ["python", "pandas"])

    def test_angle_format(self):
        self.assertEqual(parse_tags("<python><pandas>"), ["python", "pandas"])

    def test_empty_and_none(self):
        self.assertEqual(parse_tags(""), [])
        self.assertEqual(parse_tags(None), [])

    def test_bare_word_is_one_tag(self):
        self.assertEqual(parse_tags("python"), ["python"])


class TestParseQuestion(unittest.TestCase):
    def test_full_row(self):
        q = parse_question({
            "Id": "42", "PostTypeId": "1", "Title": "How do I X?",
            "Body": "<p>body</p>", "Score": "7", "ViewCount": "1234",
            "Tags": "|python|", "AcceptedAnswerId": "99",
        })
        self.assertIsNotNone(q)
        self.assertEqual(q.qid, 42)
        self.assertEqual(q.title, "How do I X?")
        self.assertEqual(q.score, 7)
        self.assertEqual(q.views, 1234)
        self.assertEqual(q.tags, ["python"])
        self.assertEqual(q.accepted_aid, 99)

    def test_missing_optional_attributes_get_defaults(self):
        q = parse_question({"Id": "1", "PostTypeId": "1"})
        self.assertIsNotNone(q)
        self.assertEqual(q.title, "")
        self.assertEqual(q.body, "")
        self.assertEqual(q.score, 0)
        self.assertEqual(q.views, 0)
        self.assertEqual(q.tags, [])
        self.assertIsNone(q.accepted_aid)

    def test_missing_id_returns_none(self):
        self.assertIsNone(parse_question({"PostTypeId": "1", "Title": "t"}))

    def test_non_integer_id_returns_none(self):
        self.assertIsNone(parse_question({"Id": "abc", "PostTypeId": "1"}))

    def test_wrong_post_type_returns_none(self):
        self.assertIsNone(parse_question({"Id": "1", "PostTypeId": "2"}))

    def test_negative_score_preserved(self):
        q = parse_question({"Id": "1", "PostTypeId": "1", "Score": "-3"})
        self.assertEqual(q.score, -3)


class TestParseAnswer(unittest.TestCase):
    def test_full_row(self):
        a = parse_answer({"Id": "99", "PostTypeId": "2", "ParentId": "42",
                          "Body": "<p>fix</p>", "Score": "5"})
        self.assertIsNotNone(a)
        self.assertEqual(a.aid, 99)
        self.assertEqual(a.parent_qid, 42)
        self.assertEqual(a.score, 5)

    def test_missing_parent_returns_none(self):
        self.assertIsNone(parse_answer({"Id": "99", "PostTypeId": "2"}))

    def test_missing_score_defaults_to_zero(self):
        a = parse_answer({"Id": "99", "PostTypeId": "2", "ParentId": "42"})
        self.assertEqual(a.score, 0)

    def test_wrong_post_type_returns_none(self):
        self.assertIsNone(parse_answer({"Id": "1", "PostTypeId": "1", "ParentId": "2"}))


class TestParsePostLink(unittest.TestCase):
    def test_full_row(self):
        link = parse_postlink({"Id": "1", "PostId": "10", "RelatedPostId": "20",
                               "LinkTypeId": "3"})
        self.assertIsNotNone(link)
        self.assertEqual((link.post_id, link.related_id, link.kind), (10, 20, 3))

    def test_missing_related_returns_none(self):
        self.assertIsNone(parse_postlink({"PostId": "10", "LinkTypeId": "1"}))

    def test_missing_kind_returns_none(self):
        self.assertIsNone(parse_postlink({"PostId": "10", "RelatedPostId": "20"}))


if __name__ == "__main__":
    unittest.main()
