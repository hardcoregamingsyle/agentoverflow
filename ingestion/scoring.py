"""Pure scoring math for the score stage (stdlib only).

The heuristic from the spec:

    raw = 0.45*pct(log1p(qscore)) + 0.35*pct(log1p(ascore))
        + 0.10*accepted          + 0.10*pct(log1p(views))

where ``pct`` is the percentile rank over the filtered corpus, approximated
by a reservoir sample. ``raw`` in [0, 1] is then mapped to an integer 0-10
through cutpoints calibrated on the sampled raw distribution so that ~5% of
records land on 10 and ~15% on 8-9. Scores below 4 are dropped entirely;
4 = quarantine, 5-7 = low, 8-9 = medium, 10 = gold.
"""

from __future__ import annotations

import bisect
import math
import random
from collections.abc import Iterable, Sequence
from typing import TypeVar

T = TypeVar("T")


def reservoir_sample(items: Iterable[T], k: int, seed: int) -> list[T]:
    """Algorithm R with a fixed seed — deterministic for a given input order.

    Sampling is acceptable here because the distributions only feed percentile
    ranks that get bucketed into 11 integer scores: at k=200k the percentile
    error is a small fraction of one bucket.
    """
    rng = random.Random(seed)
    sample: list[T] = []
    for i, item in enumerate(items):
        if i < k:
            sample.append(item)
        else:
            j = rng.randint(0, i)
            if j < k:
                sample[j] = item
    return sample


def log1p_clamped(x: float) -> float:
    """log1p with negatives clamped to 0 (accepted answers can be downvoted)."""
    return math.log1p(max(0.0, x))


def percentile_rank(sorted_sample: Sequence[float], x: float) -> float:
    """Fraction of the sample <= x. Raises ValueError on an empty sample."""
    if not sorted_sample:
        raise ValueError("empty sample")
    return bisect.bisect_right(sorted_sample, x) / len(sorted_sample)


def raw_score(pct_q: float, pct_a: float, accepted: bool, pct_v: float) -> float:
    return 0.45 * pct_q + 0.35 * pct_a + (0.10 if accepted else 0.0) + 0.10 * pct_v


def quantile(sorted_vals: Sequence[float], q: float) -> float:
    """Linear-interpolation quantile of an ascending sequence, q in [0, 1]."""
    if not sorted_vals:
        raise ValueError("empty sample")
    if not 0.0 <= q <= 1.0:
        raise ValueError(f"quantile out of range: {q}")
    pos = q * (len(sorted_vals) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = pos - lo
    return sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac


def calibrate_cutpoints(
    raw_values: Iterable[float],
    target_ten: float = 0.05,
    target_high: float = 0.15,
) -> list[float]:
    """Derive 10 ascending cutpoints c1..c10 from a sample of raw scores.

    ``score(raw)`` = number of cutpoints <= raw (see score_from_cutpoints).
    The top ``target_ten`` of the mass maps to 10, the next ``target_high``
    to 8-9 (split evenly), and the remaining mass spreads evenly over 0-7.
    Degenerate all-equal distributions collapse upward: every value scores 10.
    """
    vals = sorted(raw_values)
    if not vals:
        raise ValueError("no raw values to calibrate on")
    lower_mass = 1.0 - target_ten - target_high
    qs = [lower_mass * k / 8 for k in range(1, 8)]          # c1..c7 -> scores 1..7
    qs += [lower_mass, lower_mass + target_high / 2]        # c8, c9
    qs.append(1.0 - target_ten)                             # c10
    return [quantile(vals, q) for q in qs]


def score_from_cutpoints(raw: float, cuts: Sequence[float]) -> int:
    """Map raw -> 0-10. A raw exactly on a cutpoint takes the higher score."""
    return bisect.bisect_right(cuts, raw)


def tier_for_score(score: int) -> str | None:
    """Tier for an integer score. None means dropped (the delete-below-4 rule)."""
    if not 0 <= score <= 10:
        raise ValueError(f"score out of range: {score}")
    if score < 4:
        return None
    if score == 4:
        return "quarantine"
    if score <= 7:
        return "low"
    if score <= 9:
        return "medium"
    return "gold"
