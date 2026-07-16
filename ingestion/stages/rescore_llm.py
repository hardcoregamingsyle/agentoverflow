"""Stage 4 (optional) — LLM rescoring of heuristic 8+ items via Gemini.

Every record with heuristic score >= rescore.min_score is graded by Gemini
(REST generateContent, model from config, key from the GEMINI_API_KEY env
var) against the same 0-10 rubric used for agent learnings: correctness
plausibility, specificity, reusability, non-triviality; 10 = a complex,
complete, verified fix. The LLM verdict is clamped to 7-10 — it can demote a
heuristic 8-9 to 7 or promote to 10, never below the medium band's floor.

Output is state/rescore_overrides.jsonl, one ``{"qid", "llm_score", "score"}``
line per graded item, flushed as it goes: resuming skips already-graded qids.
429/5xx responses get exponential backoff (honoring Retry-After).

Entirely skippable: ``python -m ingestion rescore-llm --skip`` marks the
stage done without any API call; embed-load treats a missing or empty
overrides file as "no overrides".
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from ..config import Config
from ..shards import iter_jsonl_gz
from ..state import load_state, save_state

_MAX_ATTEMPTS = 8
_RETRYABLE = {429, 500, 502, 503, 504}


def build_prompt(title: str, problem: str, solution: str, max_chars: int) -> str:
    """Rubric prompt demanding strict JSON. problem/solution split max_chars."""
    half = max(1, max_chars // 2)
    return (
        "You grade Stack Overflow Q&A pairs for reuse by AI coding agents.\n"
        "Score the pair 0-10 against this rubric: correctness plausibility, "
        "specificity, reusability, non-triviality. 10 means a complex, "
        "complete, verified fix; 7 means decent but generic or partial.\n"
        "Respond with strict JSON only: "
        '{"score": <integer 0-10>, "reason": "<one short sentence>"}\n\n'
        f"TITLE: {title}\n\n"
        f"PROBLEM:\n{problem[:half]}\n\n"
        f"SOLUTION:\n{solution[:half]}\n"
    )


def parse_grade(text: str) -> int:
    """Extract the integer score from the model's JSON reply.

    Tolerates a stray markdown fence around the JSON; anything else raises.
    """
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    score = int(json.loads(t)["score"])
    if not 0 <= score <= 10:
        raise ValueError(f"score out of range: {score}")
    return score


def final_score(llm_score: int) -> int:
    """Clamp the LLM verdict into the allowed 7-10 band."""
    return max(7, min(10, llm_score))


def run(cfg: Config, skip: bool = False) -> None:
    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    out_path = cfg.state_dir / "rescore_overrides.jsonl"
    state_path = cfg.state_dir / "rescore.json"
    state = load_state(state_path)

    if skip:
        out_path.touch()
        state.update({"done": True, "skipped": True})
        save_state(state_path, state)
        print("[rescore-llm] skipped — embed-load will use heuristic scores", flush=True)
        return
    if state.get("done"):
        print("[rescore-llm] already done — delete state/rescore.json to redo", flush=True)
        return

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("[rescore-llm] set GEMINI_API_KEY, or run with --skip")

    shards = sorted(cfg.shards_dir.glob("scored-*.jsonl.gz"))
    if not shards:
        raise SystemExit("[rescore-llm] no scored shards — run the score stage first")

    done_qids: set[int] = set()
    if out_path.exists():
        with out_path.open(encoding="utf-8") as fh:
            done_qids = {json.loads(line)["qid"] for line in fh if line.strip()}
    print(f"[rescore-llm] {len(done_qids):,} items already graded", flush=True)

    graded = 0
    with out_path.open("a", encoding="utf-8") as fh:
        for shard in shards:
            for rec in iter_jsonl_gz(shard):
                if rec["score"] < cfg.rescore_min_score or rec["qid"] in done_qids:
                    continue
                prompt = build_prompt(rec["title"], rec["problem"], rec["solution"],
                                      cfg.rescore_max_chars)
                llm = _grade_with_retries(cfg.rescore_model, api_key, prompt)
                fh.write(json.dumps({"qid": rec["qid"], "llm_score": llm,
                                     "score": final_score(llm)}) + "\n")
                fh.flush()
                graded += 1
                if graded % 100 == 0:
                    print(f"[rescore-llm] {graded:,} graded this run", flush=True)
    state["done"] = True
    save_state(state_path, state)
    print(f"[rescore-llm] done: {graded:,} graded this run", flush=True)


def _call_gemini(model: str, api_key: str, prompt: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _grade_with_retries(model: str, api_key: str, prompt: str) -> int:
    delay = 2.0
    for attempt in range(_MAX_ATTEMPTS):
        try:
            return parse_grade(_call_gemini(model, api_key, prompt))
        except urllib.error.HTTPError as err:
            if err.code not in _RETRYABLE or attempt == _MAX_ATTEMPTS - 1:
                raise
            retry_after = err.headers.get("Retry-After")
            time.sleep(min(float(retry_after) if retry_after else delay, 120.0))
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError):
            if attempt == _MAX_ATTEMPTS - 1:
                raise
            time.sleep(delay)
        delay = min(delay * 2, 60.0)
    raise RuntimeError("unreachable")
