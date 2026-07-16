import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LearningStatus, LearningTier } from "@/lib/thalamusApi";

const TIER_STYLES: Record<LearningTier, string> = {
  // gold=amber, medium=blue, low=neutral
  gold: "border-accent/50 bg-accent/15 text-accent",
  medium: "border-primary/50 bg-primary/15 text-primary",
  low: "border-border bg-secondary text-secondary-foreground",
};

export function TierBadge({ tier }: { tier: LearningTier }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", TIER_STYLES[tier])}>
      {tier}
    </Badge>
  );
}

const STATUS_STYLES: Record<LearningStatus, string> = {
  pending: "border-primary/40 bg-primary/10 text-primary animate-pulse",
  scored: "border-border bg-secondary text-secondary-foreground",
  rejected: "border-destructive/50 bg-destructive/15 text-destructive",
  duplicate: "border-border/60 bg-transparent text-muted-foreground/60",
};

export function StatusBadge({ status }: { status: LearningStatus }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", STATUS_STYLES[status])}>
      {status}
    </Badge>
  );
}
