"""Tests for app.public — doc lookup + sitemap endpoints.

Validator tests are stdlib-only; the endpoint tests need fastapi/httpx and
skip cleanly without them, like the rest of the suite. No handler that needs
postgres ever executes real work — only the auth and validation layers run.
"""

import os
import sys
import unittest

_API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from app.public import SITEMAP_PER_PAGE, parse_page, valid_doc_id  # noqa: E402

try:
    import fastapi  # noqa: F401
    import httpx  # noqa: F401

    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

TEST_SECRET = "test-secret"


class ValidDocIdTests(unittest.TestCase):
    def test_accepts_corpus_and_learning_ids(self):
        for doc_id in ["so-12345", "learning-abc123", "a_b-C9", "abc"]:
            self.assertTrue(valid_doc_id(doc_id), doc_id)

    def test_length_bounds(self):
        self.assertFalse(valid_doc_id("ab"))  # under 3
        self.assertTrue(valid_doc_id("a" * 64))
        self.assertFalse(valid_doc_id("a" * 65))

    def test_rejects_bad_characters(self):
        for doc_id in ["", "so 123", "so/123", "so.123", "so%00x", "só-123"]:
            self.assertFalse(valid_doc_id(doc_id), doc_id)


class ParsePageTests(unittest.TestCase):
    def test_valid_pages(self):
        self.assertEqual(parse_page("0"), 0)
        self.assertEqual(parse_page("7"), 7)
        self.assertEqual(parse_page("123"), 123)

    def test_rejects_non_integers(self):
        for raw in ["-1", "1.5", "+2", "1e3", "", "abc", " 1"]:
            self.assertIsNone(parse_page(raw), raw)

    def test_per_page_contract(self):
        self.assertEqual(SITEMAP_PER_PAGE, 10000)


@unittest.skipUnless(HAS_FASTAPI, "fastapi/httpx not installed")
class PublicEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("AO_INTERNAL_SECRET", TEST_SECRET)
        cls.secret = os.environ["AO_INTERNAL_SECRET"]

        from fastapi.testclient import TestClient

        from app.main import app

        cls.client = TestClient(app)

    def test_missing_header_is_401(self):
        for path in [
            "/internal/doc/so-123",
            "/internal/sitemap-index",
            "/internal/sitemap/0",
        ]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 401, path)

    def test_invalid_doc_id_is_400(self):
        for doc_id in ["ab", "a" * 65, "so%20123", "so.123"]:
            response = self.client.get(
                f"/internal/doc/{doc_id}",
                headers={"X-AO-Internal-Secret": self.secret},
            )
            self.assertEqual(response.status_code, 400, doc_id)
            self.assertEqual(response.json(), {"error": "invalid_doc_id"})

    def test_invalid_sitemap_page_is_400(self):
        for page in ["-1", "1.5", "abc", "1e3"]:
            response = self.client.get(
                f"/internal/sitemap/{page}",
                headers={"X-AO-Internal-Secret": self.secret},
            )
            self.assertEqual(response.status_code, 400, page)
            self.assertEqual(response.json(), {"error": "invalid_page"})
