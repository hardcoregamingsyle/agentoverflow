"""Gzipped JSONL shard IO (stdlib only).

Shards are written to a temp file and renamed into place, so a crash never
leaves a half-written shard that a resumed run would mistake for a whole one.
"""

from __future__ import annotations

import gzip
import json
import os
from collections.abc import Iterable, Iterator
from pathlib import Path


def write_jsonl_gz(path: Path, records: Iterable[dict]) -> None:
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def iter_jsonl_gz(path: Path) -> Iterator[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)
