"""Request-model and auth-layer tests.

Need only pydantic (+ fastapi/httpx for the endpoint tests) — never
qdrant-client, psycopg, or fastembed. Every class skips cleanly when its
dependency is missing so `unittest discover` still passes stdlib-only.
"""

import os
import sys
import unittest

_API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

try:
    import pydantic  # noqa: F401

    HAS_PYDANTIC = True
except ImportError:
    HAS_PYDANTIC = False

try:
    import fastapi  # noqa: F401
    import httpx  # noqa: F401

    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

TEST_SECRET = "test-secret"


@unittest.skipUnless(HAS_PYDANTIC, "pydantic not installed")
class SearchRequestTests(unittest.TestCase):
    def test_defaults_match_contract(self):
        from app.search import SearchRequest

        req = SearchRequest(query="q")
        self.assertEqual(req.top_k, 5)
        self.assertEqual(req.tags, [])
        self.assertTrue(req.expand)

    def test_query_is_required(self):
        from pydantic import ValidationError

        from app.search import SearchRequest

        with self.assertRaises(ValidationError):
            SearchRequest()

    def test_explicit_values(self):
        from app.search import SearchRequest

        req = SearchRequest(query="q", top_k=10, tags=["python"], expand=False)
        self.assertEqual(req.top_k, 10)
        self.assertEqual(req.tags, ["python"])
        self.assertFalse(req.expand)

    def test_bounds_rejected(self):
        """The gateway clamps these; the VM re-checks so it never trusts it."""
        from pydantic import ValidationError

        from app.search import SearchRequest

        for bad in [
            {"query": ""},                       # empty query
            {"query": "q" * 8001},               # oversize query
            {"query": "q", "top_k": 0},          # below range
            {"query": "q", "top_k": 26},         # above range
            {"query": "q", "tags": ["t"] * 11},  # too many tags
            {"query": "q", "tags": ["x" * 65]},  # oversize tag
            {"query": "q", "tags": [""]},        # empty tag
        ]:
            with self.assertRaises(ValidationError, msg=repr(bad)):
                SearchRequest(**bad)

    def test_bounds_accepted_at_edges(self):
        from app.search import SearchRequest

        req = SearchRequest(query="q" * 8000, top_k=25, tags=["t" * 64] * 10)
        self.assertEqual(req.top_k, 25)
        self.assertEqual(len(req.tags), 10)


@unittest.skipUnless(HAS_PYDANTIC, "pydantic not installed")
class IngestRequestTests(unittest.TestCase):
    VALID = {
        "doc_id": "learning-abc123",
        "title": "How to frobnicate",
        "problem": "Frobnication fails with E_NO_FROB.",
        "solution": "Enable the frob flag.",
        "tags": ["frob"],
        "score": 8,
        "tier": "medium",
    }

    def test_defaults(self):
        from app.ingest import IngestRequest

        req = IngestRequest(**self.VALID)
        self.assertEqual(req.source, "learning")
        self.assertIsNone(req.url)

    def test_url_accepts_null_and_string(self):
        from app.ingest import IngestRequest

        self.assertIsNone(IngestRequest(**self.VALID, url=None).url)
        self.assertEqual(
            IngestRequest(**self.VALID, url="https://example.com").url,
            "https://example.com",
        )

    def test_required_fields(self):
        from pydantic import ValidationError

        from app.ingest import IngestRequest

        for field in self.VALID:
            body = {k: v for k, v in self.VALID.items() if k != field}
            with self.assertRaises(ValidationError, msg=f"{field} should be required"):
                IngestRequest(**body)


@unittest.skipUnless(HAS_FASTAPI, "fastapi/httpx not installed")
class SecretHeaderTests(unittest.TestCase):
    """Auth + validation layers only — no handler that needs qdrant/postgres
    ever executes with real work (health degrades to ok:false gracefully)."""

    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("AO_INTERNAL_SECRET", TEST_SECRET)
        cls.secret = os.environ["AO_INTERNAL_SECRET"]

        from fastapi.testclient import TestClient

        from app.main import app

        cls.client = TestClient(app)

    def test_missing_header_is_401(self):
        for method, path in [
            ("post", "/internal/search"),
            ("post", "/internal/ingest"),
            ("delete", "/internal/item/some-doc"),
            ("post", "/internal/sync-keys"),
            ("get", "/internal/health"),
        ]:
            response = getattr(self.client, method)(path)
            self.assertEqual(response.status_code, 401, path)

    def test_wrong_secret_is_401(self):
        response = self.client.get(
            "/internal/health", headers={"X-AO-Internal-Secret": "wrong"}
        )
        self.assertEqual(response.status_code, 401)

    def test_non_ascii_secret_is_401_not_500(self):
        # Raw non-ASCII header bytes (what a real client can always send —
        # starlette decodes them latin-1 into a non-ASCII str) used to hit
        # str-mode compare_digest, which raises TypeError → 500. The bytes
        # comparison must keep this a clean auth failure.
        response = self.client.get(
            "/internal/health",
            headers={b"X-AO-Internal-Secret": "sécret".encode("utf-8")},
        )
        self.assertEqual(response.status_code, 401)

    def test_auto_docs_are_disabled(self):
        # /docs, /redoc and /openapi.json don't inherit the app dependency —
        # the only safe setting for an internal API is off.
        for path in ["/docs", "/redoc", "/openapi.json"]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404, path)

    def test_invalid_search_body_is_422(self):
        response = self.client.post(
            "/internal/search",
            headers={"X-AO-Internal-Secret": self.secret},
            json={"top_k": 3},  # query missing
        )
        self.assertEqual(response.status_code, 422)

    def test_invalid_delete_doc_id_is_400(self):
        # Rejected by the shape check before run_delete — no backend needed.
        response = self.client.delete(
            "/internal/item/has%20spaces!",
            headers={"X-AO-Internal-Secret": self.secret},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"error": "invalid_doc_id"})

    def test_invalid_ingest_body_is_422(self):
        response = self.client.post(
            "/internal/ingest",
            headers={"X-AO-Internal-Secret": self.secret},
            json={"doc_id": "learning-x"},
        )
        self.assertEqual(response.status_code, 422)

    def test_health_shape_without_backends(self):
        response = self.client.get(
            "/internal/health", headers={"X-AO-Internal-Secret": self.secret}
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"ok", "qdrant", "postgres", "points"})
        self.assertIsInstance(body["points"], int)


@unittest.skipUnless(HAS_PYDANTIC, "pydantic not installed")
class KeyHashTests(unittest.TestCase):
    def test_hash_is_deterministic_sha256_hex(self):
        from app.keystore import hash_key

        h = hash_key("ao_abc123")
        self.assertEqual(len(h), 64)
        self.assertEqual(h, hash_key("ao_abc123"))
        self.assertNotEqual(h, hash_key("ao_abc124"))


@unittest.skipUnless(HAS_FASTAPI, "fastapi/httpx not installed")
class PublicSurfaceTests(unittest.TestCase):
    """Public /v1 auth + health — the paths that don't need a live DB."""

    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("AO_INTERNAL_SECRET", TEST_SECRET)

        from fastapi.testclient import TestClient

        from app.main import app

        cls.client = TestClient(app)

    def test_search_without_bearer_is_401(self):
        # Malformed/missing key is rejected before any DB lookup.
        for headers in [{}, {"Authorization": "Bearer nope"}, {"Authorization": "Basic x"}]:
            response = self.client.post("/v1/search", json={"query": "hi"}, headers=headers)
            self.assertEqual(response.status_code, 401, headers)

    def test_doc_without_bearer_is_401(self):
        response = self.client.get("/v1/doc/learning-abc")
        self.assertEqual(response.status_code, 401)

    def test_public_health_is_open_and_shaped(self):
        response = self.client.get("/v1/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"ok", "points"})
        self.assertIsInstance(body["points"], int)

    def test_public_doc_is_open_no_bearer(self):
        # No auth required (crawlers can't carry a key); a bad id is a clean 400
        # before any DB access.
        response = self.client.get("/public/doc/has spaces!")
        self.assertEqual(response.status_code, 400)

    def test_public_search_needs_no_bearer_but_validates(self):
        # No Authorization header — a malformed body is still a 422, proving the
        # route is reachable without a key (the DB-backed happy path isn't
        # exercised here; there's no Postgres in unit tests).
        response = self.client.post("/public/search", json={"top_k": 3})
        self.assertEqual(response.status_code, 422)
