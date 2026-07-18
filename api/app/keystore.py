"""Local API-key auth + daily/burst quota for the public /v1 surface.

The whole point of the public API is that a search never calls Convex: an
agent's bearer key is validated against a table that lives right here in the
VM's Postgres. Convex owns the keys (it issues them), but it *pushes* them to
us on a cron — see /internal/sync-keys — so at request time auth is a single
local indexed lookup and search keeps working even if Convex is down.

Two tables, both created IF NOT EXISTS on first use:

* api_keys      — one row per active key: sha256(key) -> user_id + daily quota,
                  plus a revoked flag the sync flips instead of deleting.
* usage_counter — per-key hit counts bucketed by day and by minute, so one key
                  can't burn the free tier in a burst or blow past the daily cap.

Quota numbers arrive per-key from Convex (a tier can lift them); FREE_* are the
fallback the code uses if a row somehow predates the quota columns.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

# Free tier, per key. 10k/day matches StackOverflow's free API allowance; the
# burst cap keeps a single key from hammering the corpus VM flat-out.
FREE_DAILY_QUOTA = 10_000
FREE_BURST_PER_MIN = 120

_SCHEMA = """
CREATE TABLE IF NOT EXISTS api_keys (
  key_hash text PRIMARY KEY,
  user_id text NOT NULL,
  daily_quota int NOT NULL,
  burst_per_min int NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS usage_counter (
  key_hash text NOT NULL,
  win text NOT NULL,
  bucket text NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (key_hash, win, bucket));
CREATE INDEX IF NOT EXISTS usage_counter_bucket_idx ON usage_counter (win, bucket)
"""


@dataclass(frozen=True)
class KeyRecord:
    user_id: str
    daily_quota: int
    burst_per_min: int


@dataclass(frozen=True)
class QuotaResult:
    allowed: bool
    # "ok" | "over_daily" | "over_burst"; reason is set only when allowed=False.
    reason: str
    daily_used: int
    daily_limit: int


def hash_key(raw_key: str) -> str:
    """sha256 hex of the presented bearer token — the same scheme Convex hashes
    with, so the two stores address a key by the identical value."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def ensure_schema() -> None:
    from app.db import get_pool

    with get_pool().connection() as conn:
        for stmt in _SCHEMA.split(";"):
            if stmt.strip():
                conn.execute(stmt)
        conn.commit()


def lookup(key_hash: str) -> KeyRecord | None:
    """Active key -> its record, or None when unknown or revoked."""
    from app.db import get_pool

    with get_pool().connection() as conn:
        row = conn.execute(
            "SELECT user_id, daily_quota, burst_per_min FROM api_keys "
            "WHERE key_hash = %s AND NOT revoked",
            (key_hash,),
        ).fetchone()
    if row is None:
        return None
    return KeyRecord(user_id=row[0], daily_quota=int(row[1]), burst_per_min=int(row[2]))


def charge_quota(key: KeyRecord, key_hash: str) -> QuotaResult:
    """Count one request against the key's day and minute buckets and decide.

    The minute bucket is checked first so a burst is refused before it eats into
    the daily allowance. Both increments are a single UPSERT returning the new
    count, so concurrent requests can't race past the cap.
    """
    now = datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    minute = now.strftime("%Y-%m-%dT%H:%M")

    from app.db import get_pool

    with get_pool().connection() as conn:
        minute_count = _bump(conn, key_hash, "min", minute)
        if minute_count > key.burst_per_min:
            conn.commit()  # persist the attempt; it still counts toward the burst
            return QuotaResult(False, "over_burst", 0, key.daily_quota)
        day_count = _bump(conn, key_hash, "day", day)
        conn.commit()
        if day_count > key.daily_quota:
            return QuotaResult(False, "over_daily", day_count, key.daily_quota)
        return QuotaResult(True, "ok", day_count, key.daily_quota)


def _bump(conn: Any, key_hash: str, win: str, bucket: str) -> int:
    # "win" not "window": window is a reserved word in Postgres.
    return conn.execute(
        "INSERT INTO usage_counter (key_hash, win, bucket, count) VALUES (%s,%s,%s,1) "
        "ON CONFLICT (key_hash, win, bucket) DO UPDATE SET count = usage_counter.count + 1 "
        "RETURNING count",
        (key_hash, win, bucket),
    ).fetchone()[0]


def replace_keys(records: list[dict[str, Any]]) -> int:
    """Apply a full key snapshot pushed by Convex.

    Upsert every key in the snapshot, then flip revoked=true on any local key the
    snapshot omitted — a revocation in Convex propagates as an absence here. A
    full replace (not a diff) means the two stores can't drift. Returns the
    number of active keys after the sync.
    """
    from app.db import get_pool

    present = [r["key_hash"] for r in records]
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            for r in records:
                cur.execute(
                    "INSERT INTO api_keys (key_hash, user_id, daily_quota, burst_per_min, revoked, synced_at) "
                    "VALUES (%s,%s,%s,%s,false,now()) "
                    "ON CONFLICT (key_hash) DO UPDATE SET "
                    "  user_id = EXCLUDED.user_id, daily_quota = EXCLUDED.daily_quota, "
                    "  burst_per_min = EXCLUDED.burst_per_min, revoked = false, synced_at = now()",
                    (r["key_hash"], r["user_id"], int(r["daily_quota"]), int(r["burst_per_min"])),
                )
            # Anything not in the snapshot is revoked, not deleted — keeps its
            # usage_counter rows so a re-issued hash can't dodge today's cap.
            if present:
                cur.execute(
                    "UPDATE api_keys SET revoked = true, synced_at = now() "
                    "WHERE key_hash <> ALL(%s) AND NOT revoked",
                    (present,),
                )
            else:
                cur.execute("UPDATE api_keys SET revoked = true, synced_at = now() WHERE NOT revoked")
            active = cur.execute("SELECT count(*) FROM api_keys WHERE NOT revoked").fetchone()[0]
        conn.commit()
    return int(active)
