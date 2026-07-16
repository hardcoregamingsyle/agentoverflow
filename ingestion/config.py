"""config.toml loading (stdlib tomllib).

Relative paths resolve against the config file's directory, so stages behave
the same regardless of the caller's cwd.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    data_dir: Path
    posts_url: str
    postlinks_url: str
    tags_url: str
    aria2_connections: int
    min_question_score: int
    min_answer_score: int
    shard_size: int
    sample_size: int
    sample_seed: int
    target_gold_frac: float
    target_high_frac: float
    min_keep_score: int
    rescore_model: str
    rescore_min_score: int
    rescore_max_chars: int
    qdrant_url: str
    qdrant_collection: str
    pg_dsn: str
    embed_model: str
    embed_batch_size: int
    embed_max_chars: int
    snippet_chars: int

    @property
    def dumps_dir(self) -> Path:
        return self.data_dir / "dumps"

    @property
    def shards_dir(self) -> Path:
        return self.data_dir / "shards"

    @property
    def state_dir(self) -> Path:
        return self.data_dir / "state"

    def archive_path(self, url: str) -> Path:
        return self.dumps_dir / url.rsplit("/", 1)[1]


def load_config(path: Path) -> Config:
    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    data_dir = Path(raw["paths"]["data_dir"])
    if not data_dir.is_absolute():
        data_dir = (path.resolve().parent / data_dir).resolve()
    dl, fl, sc, rs = raw["download"], raw["filter"], raw["score"], raw["rescore"]
    qd, pg, em = raw["qdrant"], raw["postgres"], raw["embed"]
    return Config(
        data_dir=data_dir,
        posts_url=dl["posts_url"],
        postlinks_url=dl["postlinks_url"],
        tags_url=dl["tags_url"],
        aria2_connections=int(dl["aria2_connections"]),
        min_question_score=int(fl["min_question_score"]),
        min_answer_score=int(fl["min_answer_score"]),
        shard_size=int(fl["shard_size"]),
        sample_size=int(sc["sample_size"]),
        sample_seed=int(sc["sample_seed"]),
        target_gold_frac=float(sc["target_gold_frac"]),
        target_high_frac=float(sc["target_high_frac"]),
        min_keep_score=int(sc["min_keep_score"]),
        rescore_model=rs["model"],
        rescore_min_score=int(rs["min_score"]),
        rescore_max_chars=int(rs["max_chars"]),
        qdrant_url=qd["url"],
        qdrant_collection=qd["collection"],
        pg_dsn=pg["dsn"],
        embed_model=em["model"],
        embed_batch_size=int(em["batch_size"]),
        embed_max_chars=int(em["max_chars"]),
        snippet_chars=int(em["snippet_chars"]),
    )
