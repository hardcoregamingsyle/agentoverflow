# Ingestion Pipeline

Turns the January 2026 Stack Overflow dump (~60 GB compressed; Posts.xml is ~100 GB uncompressed) into the corpus: Qdrant `ao_corpus` + Postgres `documents` / `doc_tags` / `doc_links`. Six stages, each resumable, run on the GCP VM — never in a dev container. `ingestion/README.md` is the authoritative per-flag reference; this page is the map.

## Running

From the repo root:

```bash
python -m ingestion <stage>                      # download | filter | score | rescore-llm | embed-load | graph-load
python -m ingestion --config /path/other.toml <stage>
```

Or via make, from `ingestion/`:

```bash
make all           # every stage in order
make skip-rescore  # stamp rescore-llm as done without spending anything
make test          # stdlib-only unit tests
```

Long stages should run inside tmux (see `deploy/RUNBOOK.md` step 7). Qdrant and Postgres must already be up via `deploy/docker-compose.yml`.

## The Six Stages

| # | Stage | Consumes | Produces | Duration |
|---|-------|----------|----------|----------|
| 1 | `download` | archive.org `stackexchange` item | `dumps/*.7z` + `.done` markers | ~1–2 h |
| 2 | `filter` | `Posts.7z` (streamed, never extracted) | `shards/filtered-*.jsonl.gz` (+ `state/filter.sqlite` spill) | ~4–8 h |
| 3 | `score` | filtered shards | `shards/scored-*.jsonl.gz` (score + tier added; < 5 dropped) | ~1–2 h |
| 4 | `rescore-llm` (optional) | scored shards, heuristic ≥ 8 only | `state/rescore_overrides.jsonl` | hours–days, ~$20–60 |
| 5 | `embed-load` | scored shards + overrides | Qdrant `ao_corpus` + Postgres `documents`, `doc_tags` | ~12–24 h (CPU embedding dominates) |
| 6 | `graph-load` | `PostLinks.7z` + loaded `documents` | Postgres `doc_links` | < 1 h |

Stage notes:

- **download** — Posts, PostLinks, and Tags archives; aria2c with 16 connections when present, `wget -c` otherwise. Tags.7z is fetched per spec but not consumed — question tags come from the `Tags` attribute in Posts.xml.
- **filter** — streams `7z e -so` through an incremental XML parser, twice. Pass 1 keeps questions with Score ≥ 2; pass 2 keeps the best answer per question (accepted wins outright, otherwise top answer with Score ≥ 2). Questions without a qualifying answer drop out. HTML becomes plain text with `<pre>`/`<code>` preserved as fenced blocks.
- **score** — deterministic heuristic (`ingestion/scoring.py`): `raw = 0.45*pct(log1p(qscore)) + 0.35*pct(log1p(ascore)) + 0.10*accepted + 0.10*pct(log1p(views))`, percentiles from a seeded 200k reservoir sample, cutpoints calibrated to ~5% tens and ~15% 8–9s. Score < 5 is dropped entirely.
- **rescore-llm** — second opinion on everything the heuristic put at 8+; see below.
- **embed-load** — fastembed `BAAI/bge-small-en-v1.5` in batches of 256; creates `ao_corpus` (on-disk vectors, int8 quantization) and the Postgres schema with `IF NOT EXISTS`; applies rescore overrides when present, recomputing the tier.
- **graph-load** — inserts `doc_links` edges for LinkTypeId 1 (linked) and 3 (duplicate), only where both endpoints exist in `documents`.

## Resume Semantics

Every stage survives a spot-VM preemption: start the instance again and re-run the interrupted stage.

| Stage | Resume unit |
|-------|-------------|
| download | partial files continue (`-c`); a `<name>.done` marker skips finished archives |
| filter | pass-level — a finished pass never repeats; an interrupted pass restarts clean; shard emission resumes after the last fully written shard |
| score | calibration cached in `state/score_calibration.json` (delete to recalibrate); shards with existing `scored-*` output are skipped |
| rescore-llm | one flushed line per item appended to `state/rescore_overrides.jsonl`; already-graded qids are skipped on restart |
| embed-load | `state/embed_load.json` lists finished shards; inside a shard, Qdrant upserts and `ON CONFLICT DO NOTHING` inserts are idempotent, so an interrupted shard is just replayed |
| graph-load | inserts are idempotent; a done marker in `state/graph_load.json` no-ops completed runs (delete the marker to replay) |

## config.toml

Relative paths resolve against the file's directory; use an absolute `data_dir` on the VM (~150 GB free needed).

| Section | Key | Meaning (default) |
|---------|-----|-------------------|
| `[paths]` | `data_dir` | working directory for dumps/shards/state (`/data/ao-ingest`) |
| `[download]` | `posts_url`, `postlinks_url`, `tags_url` | archive.org dump URLs (Jan 2026 snapshot) |
| | `aria2_connections` | parallel connections (16) |
| `[filter]` | `min_question_score` | keep questions with Score ≥ N (2) |
| | `min_answer_score` | non-accepted answers need Score ≥ N; accepted always qualifies (2) |
| | `shard_size` | records per gzipped JSONL shard (100000) |
| `[score]` | `sample_size`, `sample_seed` | reservoir sample for percentile calibration (200000, 1337 — deterministic) |
| | `target_gold_frac`, `target_high_frac` | calibration targets: ~5% tens, ~15% 8–9s |
| | `min_keep_score` | below this is dropped entirely (5) |
| `[rescore]` | `model` | Gemini model for the re-score pass (`gemini-flash-lite`) |
| | `min_score` | only heuristic ≥ N goes to the LLM (8) |
| | `max_chars` | problem+solution budget per prompt (8000) |
| `[qdrant]` | `url`, `collection` | `http://localhost:6333`, `ao_corpus` |
| `[postgres]` | `dsn` | set the real password from `deploy/.env` |
| `[embed]` | `model` | `BAAI/bge-small-en-v1.5` — load-bearing, see [architecture.md](./architecture.md) |
| | `batch_size` | embedding batch (256) |
| | `max_chars` | embedding input truncation (2000) |
| | `snippet_chars` | payload snippet length (400) |

## Layout Under data_dir

```
dumps/    the three .7z archives + .done markers
shards/   filtered-*.jsonl.gz, scored-*.jsonl.gz
state/    filter.sqlite, *.json state files, score_calibration.json,
          rescore_overrides.jsonl
```

## Running rescore-llm Later

The stage is skippable at ingest time (`make skip-rescore` stamps it done and `embed-load` uses heuristic scores as-is). To run it afterwards with a real key:

1. `export GEMINI_API_KEY=...` — the stage exits immediately without it.
2. Delete `state/rescore.json` (the skip/done stamp), then run `python -m ingestion rescore-llm`. It grades every heuristic-8+ item 0–10 on the learning rubric via REST `generateContent`, with exponential backoff honoring `Retry-After`; the verdict is clamped to 7–10, so it can demote a medium to low or promote to gold — nothing else.
3. Overrides only take effect at load time: delete `state/embed_load.json` and re-run `python -m ingestion embed-load`. Point ids are deterministic and Postgres inserts upsert, so the replay overwrites in place.

## Tests

Every pure-logic module (XML parsing, HTML→text, keep/drop, scoring math, rescore prompt/parse/clamp) has stdlib-only tests — no fastembed, qdrant, postgres, or network:

```bash
python3 -m unittest discover -s ingestion/tests -v
```
