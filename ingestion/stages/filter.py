"""Stage 2 — stream Posts.xml out of its 7z archive and keep good Q&A pairs.

Two streaming passes over ``7z e -so Posts.7z`` (the ~100 GB XML is never
extracted), with a sqlite spill file as the only intermediate:

* pass 1 keeps questions (PostTypeId=1, Score >= filter.min_question_score,
  non-empty title/body) and spills qid -> (title, body, score, views, tags,
  acceptedAnswerId) into sqlite;
* pass 2 streams answers (PostTypeId=2) whose ParentId was kept and folds
  each into the best-so-far per question: accepted wins outright, otherwise
  top score with Score >= filter.min_answer_score;
* the emit pass joins both tables (questions with no qualifying answer drop
  out here), converts HTML to text with code preserved as fenced ``` blocks,
  and writes gzipped JSONL shards:

      {qid, title, problem, solution, qscore, ascore, accepted, views, tags}

Resume: state/filter.json marks finished passes. An interrupted pass 1/2
restarts from scratch (its spill writes are wiped first), and the emit pass
continues after the last fully written shard.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from ..config import Config
from ..filtering import BestAnswer, best_answer, keep_question
from ..htmltext import html_to_text
from ..shards import write_jsonl_gz
from ..state import load_state, save_state
from ..streams import stream_7z_rows
from ..xmlrows import parse_answer, parse_question

_DDL = """
CREATE TABLE IF NOT EXISTS questions (
  qid INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  score INTEGER NOT NULL,
  views INTEGER NOT NULL,
  tags TEXT NOT NULL,
  accepted_aid INTEGER
);
CREATE TABLE IF NOT EXISTS answers (
  qid INTEGER PRIMARY KEY,
  aid INTEGER NOT NULL,
  body TEXT NOT NULL,
  score INTEGER NOT NULL,
  accepted INTEGER NOT NULL
);
"""

_PROGRESS_EVERY = 2_000_000
_INSERT_BATCH = 5_000


def run(cfg: Config) -> None:
    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    cfg.shards_dir.mkdir(parents=True, exist_ok=True)
    state_path = cfg.state_dir / "filter.json"
    state = load_state(state_path)
    if state.get("done"):
        print("[filter] already done — delete state/filter.json to redo", flush=True)
        return

    archive = cfg.archive_path(cfg.posts_url)
    db = sqlite3.connect(cfg.state_dir / "filter.sqlite")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.executescript(_DDL)

    if not state.get("pass1_done"):
        _pass1_questions(cfg, db, archive)
        state["pass1_done"] = True
        save_state(state_path, state)
    if not state.get("pass2_done"):
        _pass2_answers(cfg, db, archive)
        state["pass2_done"] = True
        save_state(state_path, state)

    _emit_shards(cfg, db, state, state_path)
    state["done"] = True
    save_state(state_path, state)
    db.close()
    print("[filter] done", flush=True)


def _pass1_questions(cfg: Config, db: sqlite3.Connection, archive: Path) -> None:
    db.execute("DELETE FROM questions")  # a half-finished pass restarts clean
    db.commit()
    seen = kept = 0
    batch: list[tuple] = []
    for attrib in stream_7z_rows(archive):
        seen += 1
        if seen % _PROGRESS_EVERY == 0:
            print(f"[filter/pass1] {seen:,} rows seen, {kept:,} questions kept", flush=True)
        q = parse_question(attrib)
        if q is None or not keep_question(q, cfg.min_question_score):
            continue
        kept += 1
        batch.append((q.qid, q.title, q.body, q.score, q.views,
                      json.dumps(q.tags), q.accepted_aid))
        if len(batch) >= _INSERT_BATCH:
            db.executemany("INSERT OR REPLACE INTO questions VALUES (?,?,?,?,?,?,?)", batch)
            db.commit()
            batch.clear()
    if batch:
        db.executemany("INSERT OR REPLACE INTO questions VALUES (?,?,?,?,?,?,?)", batch)
    db.commit()
    print(f"[filter/pass1] done: {seen:,} rows seen, {kept:,} questions kept", flush=True)


def _pass2_answers(cfg: Config, db: sqlite3.Connection, archive: Path) -> None:
    db.execute("DELETE FROM answers")
    db.commit()
    seen = writes = 0
    for attrib in stream_7z_rows(archive):
        seen += 1
        if seen % _PROGRESS_EVERY == 0:
            print(f"[filter/pass2] {seen:,} rows seen, {writes:,} best-answer writes", flush=True)
        ans = parse_answer(attrib)
        if ans is None:
            continue
        row = db.execute(
            "SELECT q.accepted_aid, a.aid, a.body, a.score, a.accepted "
            "FROM questions q LEFT JOIN answers a ON a.qid = q.qid "
            "WHERE q.qid = ?",
            (ans.parent_qid,),
        ).fetchone()
        if row is None:
            continue  # parent question was not kept
        current = BestAnswer(row[1], row[2], row[3], bool(row[4])) if row[1] is not None else None
        chosen = best_answer(current, ans, row[0], cfg.min_answer_score)
        if chosen is not None and chosen is not current:
            db.execute(
                "INSERT OR REPLACE INTO answers VALUES (?,?,?,?,?)",
                (ans.parent_qid, chosen.aid, chosen.body, chosen.score, int(chosen.accepted)),
            )
            writes += 1
            if writes % 20_000 == 0:
                db.commit()
    db.commit()
    print(f"[filter/pass2] done: {seen:,} rows seen, {writes:,} best-answer writes", flush=True)


def _emit_shards(cfg: Config, db: sqlite3.Connection, state: dict, state_path: Path) -> None:
    last_qid = int(state.get("emit_last_qid", 0))
    shard_idx = int(state.get("emit_next_shard", 0))
    skipped = 0
    buf: list[dict] = []

    def flush() -> None:
        nonlocal shard_idx, buf
        write_jsonl_gz(cfg.shards_dir / f"filtered-{shard_idx:05d}.jsonl.gz", buf)
        state["emit_last_qid"] = buf[-1]["qid"]
        shard_idx += 1
        state["emit_next_shard"] = shard_idx
        save_state(state_path, state)
        print(f"[filter/emit] shard {shard_idx - 1:05d} written ({len(buf):,} records)", flush=True)
        buf = []

    cur = db.execute(
        "SELECT q.qid, q.title, q.body, q.score, q.views, q.tags, "
        "a.body, a.score, a.accepted "
        "FROM questions q JOIN answers a ON a.qid = q.qid "
        "WHERE q.qid > ? ORDER BY q.qid",
        (last_qid,),
    )
    for qid, title, qbody, qscore, views, tags, abody, ascore, accepted in cur:
        problem = html_to_text(qbody)
        solution = html_to_text(abody)
        if not problem or not solution:
            skipped += 1
            continue
        buf.append({
            "qid": qid, "title": title, "problem": problem, "solution": solution,
            "qscore": qscore, "ascore": ascore, "accepted": bool(accepted),
            "views": views, "tags": json.loads(tags),
        })
        if len(buf) >= cfg.shard_size:
            flush()
    if buf:
        flush()
    print(f"[filter/emit] done ({skipped:,} pairs dropped for empty text)", flush=True)
