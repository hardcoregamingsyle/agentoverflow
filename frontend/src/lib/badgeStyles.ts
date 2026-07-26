/**
 * Badge palettes and the day formatter shared by the user dashboard and the
 * admin panel. These lived in both files as byte-identical copies, which meant
 * the colour language could drift between the view a user sees and the one an
 * admin sees for the same record.
 *
 * Kept separate from components/TierBadge.tsx on purpose: that module owns the
 * *learning* tier/status palettes (gold/medium/low, pending/scored/rejected/
 * duplicate), and four similarly-named records in one file is a wrong-import
 * trap.
 */
import type { LimitRequestStatus } from "./thalamusApi";

/**
 * Contribution tiers. Same colour language as the learning TierBadge:
 * neutral → blue → violet → gold.
 *
 * Deliberately `Record<string, string>` — `tier` arrives from the backend as a
 * plain string, so every call site indexes defensively and falls back to
 * `CONTRIB_TIER_STYLES.lurker`.
 */
export const CONTRIB_TIER_STYLES: Record<string, string> = {
  lurker: "border-border bg-secondary text-secondary-foreground",
  contributor: "border-primary/50 bg-primary/15 text-primary",
  regular: "border-primary/50 bg-primary/15 text-primary",
  veteran: "border-violet-400/50 bg-violet-400/15 text-violet-400",
  legend: "border-accent/50 bg-accent/15 text-accent",
};

/** Limit-request states — same badge language as learning statuses. */
export const REQUEST_STATUS_STYLES: Record<LimitRequestStatus, string> = {
  pending: "border-primary/40 bg-primary/10 text-primary animate-pulse",
  approved: "border-primary/50 bg-primary/15 text-primary",
  rejected: "border-destructive/50 bg-destructive/15 text-destructive",
};

/** Date only, no clock — for created/resolved timestamps in tables. */
export function formatDay(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
