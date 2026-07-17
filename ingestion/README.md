# AgentOverflow ingestion

Turns the Jan 2026 Stack Overflow dump into the AO corpus: Qdrant `ao_corpus`
(384-d `BAAI/bge-small-en-v1.5`, cosine) + Postgres `documents` / `doc_tags` /
`doc_links`. Six stages, each resumable, run on the GCP VM — the dumps are
~60 GB compressed and Posts.xml is ~100 GB uncompressed, so don't try this in
a dev container.

Contract highlights (pinned in the platform spec):

- `doc_id` = `so-<questionId>`; Qdrant point id = `uuid5(NAMESPACE_URL, doc_id)`
- embedding input = `title + "\n" + problem`, truncated to 2000 chars
- point payload = `{doc_id, title, snippet (first 400 chars of problem),
  score, tier, tags, source: "stackoverflow", url}`
- tiers: 5-7 = low, 8-9 = medium, 10 = gold; below 5 never makes it into
  the corpus at all

## Setup on the VM

```bash
sudo apt install -y p7zip-full aria2          # 7z streaming + fast downloads
pip install -r ingestion/requirements.txt     # only needed for embed-load / graph-load
```

Qdrant and Postgres come up via `deploy/docker-compose.yml`. Edit
`ingestion/config.toml` first: `data_dir` (needs ~150 GB free), the Postgres
DSN password, and the Qdrant URL if it isn't localhost.

Stages run from the repo root:

```bash
python -m ingestion <stage>            # download | filter | score | rescore-llm | embed-load | graph-load
python -m ingestion --config /path/to/other.toml <stage>
```

or via make, from this directory:

```bash
make all           # everything in order
make skip-rescore  # stamp rescore-llm as done without spending a cent
make test          # unit tests, stdlib only
```

## Stages

### 1. download — 1-2 h

Fetches `stackoverflow.com-Posts.7z`, `stackoverflow.com-PostLinks.7z` and
`stackoverflow.com-Tags.7z` from the archive.org `stackexchange` item.
aria2c with 16 connections if present, `wget -c` otherwise.

Resume: partial files continue (`-c`); a `<name>.done` marker skips finished
ones. Tags.7z is fetched per spec but not consumed downstream — question tags
come from the `Tags` attribute in Posts.xml.

### 2. filter — 4-8 h

Streams `7z e -so Posts.7z` through an incremental XML parser — twice. Never
extracts anything. Pass 1 keeps questions with Score >= 2 and spills them into
`state/filter.sqlite` (the only intermediate that touches disk). Pass 2 keeps
the best answer per kept question: accepted wins outright, otherwise top score
with Score >= 2. Questions left without a qualifying answer drop out. HTML
becomes plain text with `<pre>`/`<code>` preserved as fenced ``` blocks.
Output: `shards/filtered-*.jsonl.gz` with
`{qid, title, problem, solution, qscore, ascore, accepted, views, tags}`.

Resume: pass-level. A finished pass is never repeated; an interrupted pass
restarts clean (both full streams cost hours, not days — tracking byte offsets
inside a 7z pipe isn't worth the complexity). Shard emission resumes after the
last fully written shard.

### 3. score — 1-2 h

The heuristic, deterministic and stdlib-pure (`ingestion/scoring.py`):

```
raw = 0.45*pct(log1p(qscore)) + 0.35*pct(log1p(ascore)) + 0.10*accepted + 0.10*pct(log1p(views))
```

`pct` is the percentile rank over the filtered corpus, approximated by a
seeded 200k reservoir sample (error is a small fraction of one score bucket).
`raw` maps to 0-10 through cutpoints calibrated on the sample: ~5% tens,
~15% 8-9s, the rest spread over 0-7. Score < 5 is dropped entirely. Output:
`shards/scored-*.jsonl.gz` with `score` and `tier` added.

Resume: calibration is cached in `state/score_calibration.json` (delete it to
recalibrate); shards with existing `scored-*` output are skipped.

### 4. rescore-llm — optional, hours to days depending on rate limits, ~$20-60

Second opinion on everything the heuristic put at 8+. Gemini
(`rescore.model`, REST `generateContent`, key from `GEMINI_API_KEY`) grades
each item 0-10 on the learning rubric — correctness plausibility, specificity,
reusability, non-triviality — and the verdict is clamped to 7-10: it can
demote a medium to low or promote to gold, nothing else. 429/5xx get
exponential backoff honoring Retry-After.

Skip it entirely with `python -m ingestion rescore-llm --skip` (or
`make skip-rescore`) — embed-load then uses heuristic scores as-is.

Resume: results append to `state/rescore_overrides.jsonl` one flushed line at
a time; already-graded qids are skipped on restart.

### 5. embed-load — 12-24 h (CPU embedding dominates)

fastembed `BAAI/bge-small-en-v1.5` in batches of 256. Creates `ao_corpus` on
first run (on-disk vectors, int8 scalar quantization) and the Postgres schema
with `IF NOT EXISTS`. Applies rescore overrides when present, recomputing the
tier. Full problem/solution text goes to `documents`, tags to `doc_tags`.
HNSW indexing is switched off (`indexing_threshold=0`) while the stage loads —
at collection creation and on every restart — and restored to 20000 at the
end, so Qdrant indexes once instead of during every upsert.

Resume: `state/embed_load.json` tracks finished shards; inside a shard both
Qdrant upserts and `ON CONFLICT DO NOTHING` inserts are idempotent, so an
interrupted shard is just replayed.

### 6. graph-load — under 1 h

Streams PostLinks.7z the same way and inserts `doc_links` edges for
LinkTypeId 1 (linked) and 3 (duplicate) — only where both endpoints exist in
`documents`. Kept ids are held in memory (a few million ints; the VM is fine).

Resume: inserts are idempotent and a done marker in `state/graph_load.json`
no-ops completed runs. Delete the marker to replay.

## Layout under data_dir

```
dumps/    the three .7z archives + .done markers
shards/   filtered-*.jsonl.gz, scored-*.jsonl.gz
state/    filter.sqlite, *.json state files, score_calibration.json,
          rescore_overrides.jsonl
```

## Tests

Every pure-logic module (XML row parsing, HTML->text, keep/drop decisions,
scoring math, record helpers, the rescore prompt/parse/clamp) is covered by
stdlib-only tests — no fastembed, no qdrant, no postgres, no network:

```bash
cd <repo root>
python3 -m unittest discover -s ingestion/tests -v
```

Heavy dependencies are imported lazily inside the stage `run()` functions, so
the suite runs anywhere Python 3.11 does.
