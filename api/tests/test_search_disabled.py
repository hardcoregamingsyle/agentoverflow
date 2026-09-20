"""The switch that let Qdrant come off the box.

Search was the only thing on the VM that needed the vector index, and the index
was the only thing that needed a big machine. With no agents calling it, the
flag below is what lets the container go away while the 2.45M-page corpus stays
served from Postgres. These tests pin the two things that make that safe: the
flag reads the way the compose file sets it, and a disabled deployment still
reports itself healthy rather than looking like an outage.
"""

import os
import unittest

from app.config import SEARCH_DISABLED_DETAIL, search_disabled


class SearchDisabledFlagTest(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.get("AO_SEARCH_DISABLED")

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("AO_SEARCH_DISABLED", None)
        else:
            os.environ["AO_SEARCH_DISABLED"] = self._saved

    def set_flag(self, value):
        if value is None:
            os.environ.pop("AO_SEARCH_DISABLED", None)
        else:
            os.environ["AO_SEARCH_DISABLED"] = value

    def test_unset_means_search_is_on(self):
        # Absent flag must never disable search — a deployment that forgot to
        # set it should behave exactly as it always did.
        self.set_flag(None)
        self.assertFalse(search_disabled())

    def test_compose_default_disables(self):
        # docker-compose.yml passes AO_SEARCH_DISABLED: ${AO_SEARCH_DISABLED:-1},
        # so "1" is the value that actually reaches the container.
        self.set_flag("1")
        self.assertTrue(search_disabled())

    def test_accepts_the_spellings_a_human_will_type(self):
        for value in ("1", "true", "TRUE", "yes", "on", " true "):
            self.set_flag(value)
            self.assertTrue(search_disabled(), f"{value!r} should disable search")

    def test_falsey_values_leave_search_on(self):
        # "0" must not read as truthy just because it is a non-empty string —
        # that would silently kill search on a box meant to keep it.
        for value in ("0", "false", "no", "off", "", "   "):
            self.set_flag(value)
            self.assertFalse(search_disabled(), f"{value!r} should leave search on")

    def test_detail_explains_pages_are_unaffected(self):
        # The 503 body is what an agent and an admin both read. It has to say
        # that the corpus pages still work, or a switched-off index looks like
        # the whole deployment fell over.
        self.assertIn("pages", SEARCH_DISABLED_DETAIL.lower())
        self.assertNotIn("unreachable", SEARCH_DISABLED_DETAIL.lower())


try:  # pragma: no cover - import probe
    import pydantic  # noqa: F401

    HAS_PYDANTIC = True
except ImportError:  # pragma: no cover
    HAS_PYDANTIC = False


@unittest.skipUnless(HAS_PYDANTIC, "router import needs pydantic")
class HealthWhenSearchDisabledTest(unittest.TestCase):
    """`ok` must track what the box still promises: the corpus pages."""

    def setUp(self):
        self._saved = os.environ.get("AO_SEARCH_DISABLED")
        os.environ["AO_SEARCH_DISABLED"] = "1"

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("AO_SEARCH_DISABLED", None)
        else:
            os.environ["AO_SEARCH_DISABLED"] = self._saved

    def test_health_ignores_qdrant_and_reports_state(self):
        import app.public_api as public_api

        # Postgres up, and no Qdrant to ask — the container is gone. Folding a
        # missing Qdrant into `ok` would report the deployment as down while
        # every /q page is being served perfectly.
        original = None
        try:
            import app.db as db

            original = db.postgres_health
            db.postgres_health = lambda: True
            result = public_api.public_health()
        finally:
            if original is not None:
                import app.db as db

                db.postgres_health = original

        self.assertTrue(result["ok"])
        self.assertEqual(result["search"], "disabled")


if __name__ == "__main__":
    unittest.main()
