"""fastembed BAAI/bge-small-en-v1.5 (384-d, cosine) as a process-wide singleton.

The import is lazy so this module stays importable without fastembed installed
(unit tests, tooling). The Docker image pre-downloads the model weights into
FASTEMBED_CACHE_PATH at build time, so first use here never hits the network.
"""

from __future__ import annotations

from typing import Any

MODEL_NAME = "BAAI/bge-small-en-v1.5"
VECTOR_SIZE = 384
# Pinned contract: embedding input everywhere (corpus + queries + dedup) is
# truncated to 2000 chars.
EMBED_MAX_CHARS = 2000

_model: Any = None


def get_model() -> Any:
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        _model = TextEmbedding(MODEL_NAME)
    return _model


def embedding_input(title: str, problem: str) -> str:
    return (title + "\n" + problem)[:EMBED_MAX_CHARS]


def embed_text(text: str) -> list[float]:
    vector = next(iter(get_model().embed([text[:EMBED_MAX_CHARS]])))
    return [float(x) for x in vector]
