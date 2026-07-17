"""Stage 5 — embed with bge-small-en-v1.5 and load Qdrant + Postgres.

Creates the ``ao_corpus`` collection if missing (384-d cosine, on-disk
vectors, int8 scalar quantization) and the pinned Postgres schema
(documents / doc_tags / doc_links) with IF NOT EXISTS. Then streams the
scored shards in batches of embed.batch_size:

* embedding input = title + "\\n" + problem, truncated to embed.max_chars;
* Qdrant point id = uuid5(NAMESPACE_URL, doc_id) — the scheme the VM API
  uses to address points — payload = {doc_id, title, snippet (first
  embed.snippet_chars of problem), score, tier, tags,
  source: "stackoverflow", url};
* full text rows go to Postgres documents, tags to doc_tags.

Rescore overrides (state/rescore_overrides.jsonl) are applied when present:
the override replaces the heuristic score and the tier is recomputed.

HNSW indexing is disabled (indexing_threshold=0) for the duration of the
bulk load — on collection creation and again on every (re)start against an
existing collection — and restored to 20000 when the stage finishes.

Resume: state/embed_load.json lists finished shards; within a shard, both
Qdrant upserts and ON CONFLICT DO NOTHING inserts are idempotent, so an
interrupted shard is simply replayed.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from pathlib import Path

from ..config import Config
from ..records import doc_id, embedding_text, point_id, question_url, snippet
from ..scoring import tier_for_score
from ..shards import iter_jsonl_gz
from ..state import load_state, save_state

# Docs per model.embed() call. Big enough that the parallel=0 worker-pool
# spawn amortizes; small enough to keep a chunk's rows in memory.
EMBED_CHUNK = 8192

# Qdrant's default optimizer threshold (in kB of vectors per segment); the
# stage sets it to 0 while bulk-loading and restores this value at the end.
INDEXING_THRESHOLD = 20000

_PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
  doc_id text PRIMARY KEY,
  title text NOT NULL, problem text NOT NULL, solution text NOT NULL,
  score int NOT NULL, tier text NOT NULL,
  source text NOT NULL,
  url text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS doc_tags (doc_id text, tag text, PRIMARY KEY (doc_id, tag));
CREATE TABLE IF NOT EXISTS doc_links (src text, dst text, kind smallint, PRIMARY KEY (src, dst, kind));
CREATE INDEX IF NOT EXISTS doc_tags_tag_idx ON doc_tags (tag);
CREATE INDEX IF NOT EXISTS doc_links_src_idx ON doc_links (src)
"""


def run(cfg: Config) -> None:
    # Heavy deps live here so the pure modules stay stdlib-importable.
    import psycopg
    from fastembed import TextEmbedding
    from qdrant_client import QdrantClient
    from qdrant_client import models as qm

    shards = sorted(cfg.shards_dir.glob("scored-*.jsonl.gz"))
    if not shards:
        raise SystemExit("[embed-load] no scored shards — run the score stage first")
    overrides = _load_overrides(cfg.state_dir / "rescore_overrides.jsonl")

    state_path = cfg.state_dir / "embed_load.json"
    state = load_state(state_path)
    done = set(state.get("done_shards", []))

    # Generous timeout: even in-RAM upserts of a few hundred vectors shouldn't
    # need it, but it stops a slow moment from killing the whole stage.
    client = QdrantClient(url=cfg.qdrant_url, timeout=120)
    if not client.collection_exists(cfg.qdrant_collection):
        # on_disk=False keeps vectors in RAM during the load. The whole corpus
        # (~3.7M x 384-d fp32 ~ 6 GB) fits the ingest box many times over, and
        # writing to a network disk per batch was the real bottleneck — ~30s a
        # batch. int8 quantization (always_ram) still serves search from RAM.
        # indexing_threshold=0 disables HNSW indexing during the bulk load;
        # it is restored at the end of the stage once everything is upserted.
        client.create_collection(
            collection_name=cfg.qdrant_collection,
            vectors_config=qm.VectorParams(
                size=384, distance=qm.Distance.COSINE, on_disk=False),
            quantization_config=qm.ScalarQuantization(
                scalar=qm.ScalarQuantizationConfig(
                    type=qm.ScalarType.INT8, always_ram=True)),
            optimizers_config=qm.OptimizersConfigDiff(indexing_threshold=0),
        )
        print(f"[embed-load] created collection {cfg.qdrant_collection} "
              "(indexing disabled for bulk load)", flush=True)
    else:
        # Resume on an existing collection: same deal, indexing off while
        # loading, restored at stage end.
        client.update_collection(
            collection_name=cfg.qdrant_collection,
            optimizers_config=qm.OptimizersConfigDiff(indexing_threshold=0),
        )
        print(f"[embed-load] indexing disabled on {cfg.qdrant_collection} "
              "for bulk load (indexing_threshold=0)", flush=True)

    pg = psycopg.connect(cfg.pg_dsn)
    for stmt in _PG_SCHEMA.split(";"):
        if stmt.strip():
            pg.execute(stmt)
    pg.commit()

    model = TextEmbedding(cfg.embed_model)
    total = 0
    for shard in shards:
        if shard.name in done:
            continue
        # Embedding is fast (~170 docs/s). With vectors in RAM the writes keep
        # up: upsert in modest batches (a huge single upsert can exceed the HTTP
        # timeout) and commit Postgres once per chunk so fsync isn't per-batch.
        # Per-chunk logging shows the real rate without waiting for a 100k shard.
        for chunk in _batches(iter_jsonl_gz(shard), EMBED_CHUNK):
            rows = [_prepare(rec, overrides, cfg) for rec in chunk]
            paired = list(zip(rows, model.embed(
                [r["embed_text"] for r in rows], batch_size=cfg.embed_batch_size)))
            for i in range(0, len(paired), cfg.embed_batch_size):
                sub = paired[i:i + cfg.embed_batch_size]
                points = [
                    qm.PointStruct(id=r["point_id"], vector=[float(x) for x in vec],
                                   payload=r["payload"])
                    for r, vec in sub
                ]
                client.upsert(collection_name=cfg.qdrant_collection, points=points, wait=False)
            with pg.cursor() as cur:
                cur.executemany(
                    "INSERT INTO documents (doc_id, title, problem, solution, score, tier, source, url) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (doc_id) DO NOTHING",
                    [r["doc_row"] for r in rows],
                )
                tag_rows = [t for r in rows for t in r["tag_rows"]]
                if tag_rows:
                    cur.executemany(
                        "INSERT INTO doc_tags (doc_id, tag) VALUES (%s,%s) "
                        "ON CONFLICT DO NOTHING",
                        tag_rows,
                    )
            pg.commit()
            total += len(rows)
            print(f"[embed-load] {shard.name}: {total:,} docs this run", flush=True)
        done.add(shard.name)
        state["done_shards"] = sorted(done)
        save_state(state_path, state)
        print(f"[embed-load] {shard.name} done ({total:,} docs this run)", flush=True)
    pg.close()
    client.update_collection(
        collection_name=cfg.qdrant_collection,
        optimizers_config=qm.OptimizersConfigDiff(
            indexing_threshold=INDEXING_THRESHOLD),
    )
    print(f"[embed-load] indexing re-enabled on {cfg.qdrant_collection} "
          f"(indexing_threshold={INDEXING_THRESHOLD})", flush=True)
    print("[embed-load] done", flush=True)


def _prepare(rec: dict, overrides: dict[int, int], cfg: Config) -> dict:
    qid = rec["qid"]
    score = overrides.get(qid, rec["score"])
    tier = tier_for_score(score)
    did = doc_id(qid)
    url = question_url(qid)
    return {
        "point_id": point_id(did),
        "embed_text": embedding_text(rec["title"], rec["problem"], cfg.embed_max_chars),
        "payload": {
            "doc_id": did,
            "title": rec["title"],
            "snippet": snippet(rec["problem"], cfg.snippet_chars),
            "score": score,
            "tier": tier,
            "tags": rec["tags"],
            "source": "stackoverflow",
            "url": url,
        },
        "doc_row": (did, rec["title"], rec["problem"], rec["solution"],
                    score, tier, "stackoverflow", url),
        "tag_rows": [(did, tag) for tag in rec["tags"]],
    }


def _load_overrides(path: Path) -> dict[int, int]:
    if not path.exists():
        print("[embed-load] no rescore overrides — using heuristic scores", flush=True)
        return {}
    overrides: dict[int, int] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                row = json.loads(line)
                overrides[row["qid"]] = row["score"]
    print(f"[embed-load] {len(overrides):,} rescore overrides loaded", flush=True)
    return overrides


def _batches(records: Iterable[dict], size: int) -> Iterator[list[dict]]:
    batch: list[dict] = []
    for rec in records:
        batch.append(rec)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch
