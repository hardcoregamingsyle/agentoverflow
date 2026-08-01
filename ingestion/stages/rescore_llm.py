"""Stage 4 (optional) — LLM rescoring of heuristic 8+ items via NVIDIA NIM.

Every record with heuristic score >= rescore.min_score is graded by an NIM
free-endpoint model (OpenAI-compatible /v1/chat/completions, model from
config, keys from the comma-separated NIM_API_KEYS env var) against the same
0-10 rubric used for agent learnings: correctness plausibility, specificity,
reusability, non-triviality; 10 = a complex, complete, verified fix. The LLM
verdict is clamped to 7-10 — it can demote a heuristic 8-9 to 7 or promote to
10, never below the medium band's floor.

Graded concurrently across all provided keys, each held to its own 40
requests/minute — free-endpoint accounts are metered per key, not pooled, so
running N keys through one shared limiter is what actually buys N x the
throughput instead of tripping the first key's cap and stalling the rest.

Output is state/rescore_overrides.jsonl, one ``{"qid", "llm_score", "score"}``
line per graded item, flushed as it goes: resuming skips already-graded qids.
429/5xx responses get exponential backoff (honoring Retry-After).

Entirely skippable: ``python -m ingestion rescore-llm --skip`` marks the
stage done without any API call; embed-load treats a missing or empty
overrides file as "no overrides".
"""

from __future__ import annotations

import itertools
import json
import os
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from ..config import Config
from ..shards import iter_jsonl_gz
from ..state import load_state, save_state

_MAX_ATTEMPTS = 8
_RETRYABLE = {429, 500, 502, 503, 504}
_RPM_PER_KEY = 40
_MAX_WORKERS = 12


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


class _KeyRateLimiter:
    """Sliding 60s window per key, shared across worker threads.

    acquire() blocks until some key has headroom, then returns that key —
    this is what lets N keys behave as N x 40 RPM instead of the first
    thread to grab a key hogging it past its own cap. Every attempt of a
    grading call must go through acquire(), retries included — a retry that
    reuses its original key without re-checking the limiter is exactly what
    turns one 429 into a pile-up on that key.

    penalize() marks a key as fully spent for a rolling minute the instant a
    429 comes back for it. A server-side rejection is stronger evidence than
    our own request-timestamp forecast, so it overrides the forecast instead
    of waiting for it to naturally agree.
    """

    def __init__(self, keys: list[str], rpm: int) -> None:
        self._rpm = rpm
        self._lock = threading.Lock()
        self._history: dict[str, list[float]] = {k: [] for k in keys}

    def acquire(self) -> str:
        while True:
            with self._lock:
                now = time.monotonic()
                for key, hist in self._history.items():
                    while hist and now - hist[0] >= 60.0:
                        hist.pop(0)
                    if len(hist) < self._rpm:
                        hist.append(now)
                        return key
            time.sleep(0.25)

    def penalize(self, key: str) -> None:
        with self._lock:
            self._history[key] = [time.monotonic()] * self._rpm


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

    api_keys = [k.strip() for k in os.environ.get("NIM_API_KEYS", "").split(",") if k.strip()]
    if not api_keys:
        raise SystemExit("[rescore-llm] set NIM_API_KEYS (comma-separated), or run with --skip")

    shards = sorted(cfg.shards_dir.glob("scored-*.jsonl.gz"))
    if not shards:
        raise SystemExit("[rescore-llm] no scored shards — run the score stage first")

    done_qids: set[int] = set()
    if out_path.exists():
        with out_path.open(encoding="utf-8") as fh:
            done_qids = {json.loads(line)["qid"] for line in fh if line.strip()}
    print(f"[rescore-llm] {len(done_qids):,} items already graded", flush=True)
    print(f"[rescore-llm] {len(api_keys)} key(s) @ {_RPM_PER_KEY} RPM each "
          f"= {len(api_keys) * _RPM_PER_KEY} RPM combined", flush=True)

    limiter = _KeyRateLimiter(api_keys, _RPM_PER_KEY)
    write_lock = threading.Lock()
    graded = 0

    # Streamed, not materialized: 978k full-text records held in memory at
    # once would be gigabytes for no reason when a bounded in-flight window
    # gets the same throughput.
    def pending() -> Iterator[dict]:
        for shard in shards:
            for rec in iter_jsonl_gz(shard):
                if rec["score"] >= cfg.rescore_min_score and rec["qid"] not in done_qids:
                    yield rec

    pending_iter = pending()
    out_fh = out_path.open("a", encoding="utf-8")
    try:
        def grade_one(rec: dict) -> None:
            nonlocal graded
            prompt = build_prompt(rec["title"], rec["problem"], rec["solution"],
                                  cfg.rescore_max_chars)
            llm = _grade_with_retries(cfg.rescore_model, limiter, prompt)
            line = json.dumps({"qid": rec["qid"], "llm_score": llm,
                               "score": final_score(llm)}) + "\n"
            with write_lock:
                out_fh.write(line)
                out_fh.flush()
                graded += 1
                if graded % 500 == 0:
                    print(f"[rescore-llm] {graded:,} graded this run", flush=True)

        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            in_flight = {pool.submit(grade_one, rec): True
                         for rec in itertools.islice(pending_iter, _MAX_WORKERS * 4)}
            while in_flight:
                done, _ = wait(in_flight, return_when=FIRST_COMPLETED)
                for fut in done:
                    fut.result()
                    del in_flight[fut]
                    nxt = next(pending_iter, None)
                    if nxt is not None:
                        in_flight[pool.submit(grade_one, nxt)] = True
    finally:
        out_fh.close()

    state["done"] = True
    save_state(state_path, state)
    print(f"[rescore-llm] done: {graded:,} graded this run", flush=True)


def _call_nim(model: str, api_key: str, prompt: str) -> str:
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 200,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    return data["choices"][0]["message"]["content"]


def _grade_with_retries(model: str, limiter: "_KeyRateLimiter", prompt: str) -> int:
    delay = 2.0
    for attempt in range(_MAX_ATTEMPTS):
        key = limiter.acquire()
        try:
            return parse_grade(_call_nim(model, key, prompt))
        except urllib.error.HTTPError as err:
            if err.code == 429:
                limiter.penalize(key)
            if err.code not in _RETRYABLE or attempt == _MAX_ATTEMPTS - 1:
                raise
            retry_after = err.headers.get("Retry-After")
            if retry_after:
                time.sleep(min(float(retry_after), 120.0))
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError):
            if attempt == _MAX_ATTEMPTS - 1:
                raise
            time.sleep(delay)
        delay = min(delay * 2, 60.0)
    raise RuntimeError("unreachable")
