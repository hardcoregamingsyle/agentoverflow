"""Deployment switches read from the environment.

Stdlib only, and deliberately so: everything here is plain configuration logic
that the test suite has to be able to import without fastapi, pydantic or a
database driver present. Putting it in search.py would have chained a one-line
env lookup to pydantic.
"""

from __future__ import annotations

import os

# Search is the only thing on this box that needs Qdrant, and Qdrant is the only
# thing that needed a big machine: 2.45M x 384-d vectors plus the HNSW graph is
# what sized the VM at e2-standard-4 (5g cap, against 2g each for Postgres and
# the API). The /q solution pages — which carry all of the site's search traffic
# — are a plain Postgres row lookup and never touch it.
#
# With no agents calling /v1/search, that index was pure cost. AO_SEARCH_DISABLED
# lets the Qdrant container be removed entirely while the corpus stays fully
# served and indexed. Clearing the flag and restoring the container brings
# search back with no code change.
SEARCH_DISABLED_DETAIL = (
    "Corpus search is turned off on this deployment. The solved-problem pages "
    "remain available; only the semantic search index is offline."
)

_TRUTHY = {"1", "true", "yes", "on"}


def search_disabled() -> bool:
    return os.environ.get("AO_SEARCH_DISABLED", "").strip().lower() in _TRUTHY
