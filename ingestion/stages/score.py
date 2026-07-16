"""Stage 3 — deterministic heuristic scoring, 0-10.

Two passes over the filtered shards:

* calibration: reservoir-sample (qscore, ascore, accepted, views) tuples,
  build sorted log1p distributions for the three percentile terms, compute
  the raw score of every sampled record, and derive cutpoints targeting
  ~5% tens and ~15% 8-9s. Persisted to state/score_calibration.json so the
  mapping stays fixed across resumes and reruns.
* mapping: score every record, drop score < score.min_keep_score (the
  delete-below-4 rule), attach the tier, and write scored-*.jsonl.gz
  shard-for-shard.

Resume: an existing scored shard is skipped, so re-running continues where
the last run stopped and no-ops once everything is written.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path

from ..config import Config
from ..scoring import (
    calibrate_cutpoints,
    log1p_clamped,
    percentile_rank,
    raw_score,
    reservoir_sample,
    score_from_cutpoints,
    tier_for_score,
)
from ..shards import iter_jsonl_gz, write_jsonl_gz


def run(cfg: Config) -> None:
    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    shards = sorted(cfg.shards_dir.glob("filtered-*.jsonl.gz"))
    if not shards:
        raise SystemExit("[score] no filtered shards — run the filter stage first")

    calib = _load_or_build_calibration(cfg, shards)
    q_sorted = calib["log_qscore"]
    a_sorted = calib["log_ascore"]
    v_sorted = calib["log_views"]
    cuts = calib["cutpoints"]

    kept = dropped = 0
    for shard in shards:
        out = cfg.shards_dir / shard.name.replace("filtered-", "scored-")
        if out.exists():
            continue  # resume: finished output shards are the state
        records: list[dict] = []
        for rec in iter_jsonl_gz(shard):
            raw = raw_score(
                percentile_rank(q_sorted, log1p_clamped(rec["qscore"])),
                percentile_rank(a_sorted, log1p_clamped(rec["ascore"])),
                bool(rec["accepted"]),
                percentile_rank(v_sorted, log1p_clamped(rec["views"])),
            )
            score = score_from_cutpoints(raw, cuts)
            if score < cfg.min_keep_score:
                dropped += 1
                continue
            rec["score"] = score
            rec["tier"] = tier_for_score(score)
            records.append(rec)
        write_jsonl_gz(out, records)
        kept += len(records)
        print(f"[score] {out.name}: {len(records):,} kept", flush=True)
    print(f"[score] done: {kept:,} kept, {dropped:,} dropped below "
          f"{cfg.min_keep_score} this run", flush=True)


def _sample_stream(shards: list[Path]) -> Iterator[tuple[float, float, bool, float]]:
    for shard in shards:
        for rec in iter_jsonl_gz(shard):
            yield (rec["qscore"], rec["ascore"], bool(rec["accepted"]), rec["views"])


def _load_or_build_calibration(cfg: Config, shards: list[Path]) -> dict:
    path = cfg.state_dir / "score_calibration.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    print(f"[score] calibrating on a reservoir sample of {cfg.sample_size:,} "
          f"records (seed {cfg.sample_seed})", flush=True)
    sample = reservoir_sample(_sample_stream(shards), cfg.sample_size, cfg.sample_seed)
    if not sample:
        raise SystemExit("[score] filtered shards are empty")
    q_sorted = sorted(log1p_clamped(t[0]) for t in sample)
    a_sorted = sorted(log1p_clamped(t[1]) for t in sample)
    v_sorted = sorted(log1p_clamped(t[3]) for t in sample)
    raws = [
        raw_score(
            percentile_rank(q_sorted, log1p_clamped(q)),
            percentile_rank(a_sorted, log1p_clamped(a)),
            acc,
            percentile_rank(v_sorted, log1p_clamped(v)),
        )
        for q, a, acc, v in sample
    ]
    cuts = calibrate_cutpoints(raws, cfg.target_gold_frac, cfg.target_high_frac)
    calib = {
        "sample_size": len(sample),
        "seed": cfg.sample_seed,
        "log_qscore": q_sorted,
        "log_ascore": a_sorted,
        "log_views": v_sorted,
        "cutpoints": cuts,
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(calib), encoding="utf-8")
    os.replace(tmp, path)
    print(f"[score] cutpoints: {[round(c, 4) for c in cuts]}", flush=True)
    return calib
