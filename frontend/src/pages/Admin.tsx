import { StatusBadge, TierBadge } from "@/components/TierBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import * as thalamus from "@/lib/thalamusApi";
import type {
  AdminLearning,
  AdminLimitRequest,
  AdminStats,
  AdminUsagePoint,
  AdminUser,
  CorpusHealth,
} from "@/lib/thalamusApi";
import { cn } from "@/lib/utils";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  RefreshCw,
  Shield,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

const ADMIN_TOKEN_KEY = "ao_admin_token";

// Same three questions as the Thalamus admin — shared deployment, shared
// credentials. Wording must match exactly; answers are checked server-side.
const SECURITY_QUESTIONS = [
  "Favourite game on Roblox",
  "Crush name",
  "Greatest enemy of all times",
];

// Same color language as the dashboard's contribution tiers.
const CONTRIB_TIER_STYLES: Record<string, string> = {
  lurker: "border-border bg-secondary text-secondary-foreground",
  contributor: "border-primary/50 bg-primary/15 text-primary",
  regular: "border-primary/50 bg-primary/15 text-primary",
  veteran: "border-violet-400/50 bg-violet-400/15 text-violet-400",
  legend: "border-accent/50 bg-accent/15 text-accent",
};

function isUnauthorized(err: unknown) {
  return err instanceof Error && /unauthorized/i.test(err.message);
}

function formatDay(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ── login ── */

function AdminLogin({ onToken }: { onToken: (token: string) => void }) {
  const adminLoginAction = useAction(thalamus.adminLogin);
  const [step, setStep] = useState<"password" | "questions">("password");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [answers, setAnswers] = useState(["", "", ""]);
  const [verifying, setVerifying] = useState(false);

  const canSubmit =
    step === "password" ? !!password.trim() : answers.every((a) => a.trim());

  const handleLogin = async () => {
    if (step === "password") {
      if (!password.trim()) return;
      setStep("questions");
      return;
    }
    if (answers.some((a) => !a.trim())) return;
    setVerifying(true);
    try {
      // Server-side check of password + all three answers; returns the admin
      // token only on success.
      const result = await adminLoginAction({
        password,
        answer1: answers[0],
        answer2: answers[1],
        answer3: answers[2],
      });
      try {
        localStorage.setItem(ADMIN_TOKEN_KEY, result.token);
      } catch {
        /* ignore */
      }
      onToken(result.token);
    } catch {
      toast.error("Invalid credentials");
      setVerifying(false);
      setStep("password");
      setAnswers(["", "", ""]);
    }
  };

  return (
    <div className="min-h-screen font-mono flex items-center justify-center p-6">
      <meta name="robots" content="noindex" />
      <div className="w-full max-w-sm border border-border bg-card rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/50 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Admin Portal</h1>
            <p className="text-xs text-muted-foreground">
              agentoverflow · Aphantic Corporation
            </p>
          </div>
        </div>
        <div className="space-y-4">
          {step === "password" ? (
            <div>
              <Label
                htmlFor="admin-pass"
                className="text-[11px] text-muted-foreground mb-1.5 font-bold"
              >
                PASSWORD
              </Label>
              <div className="relative">
                <Input
                  id="admin-pass"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleLogin();
                  }}
                  placeholder="Enter admin password"
                  className="text-xs font-mono pr-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] font-bold text-muted-foreground tracking-widest">
                SECURITY VERIFICATION
              </p>
              {SECURITY_QUESTIONS.map((q, i) => (
                <div key={q}>
                  <Label
                    htmlFor={`admin-q${i}`}
                    className="text-[11px] text-muted-foreground mb-1 block"
                  >
                    {q}
                  </Label>
                  <Input
                    id={`admin-q${i}`}
                    type="text"
                    value={answers[i]}
                    onChange={(e) =>
                      setAnswers((prev) =>
                        prev.map((a, j) => (j === i ? e.target.value : a))
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleLogin();
                    }}
                    className="text-xs font-mono"
                    autoFocus={i === 0}
                  />
                </div>
              ))}
            </div>
          )}
          <Button
            onClick={() => void handleLogin()}
            disabled={verifying || !canSubmit}
            className="w-full text-xs font-bold h-10"
          >
            {verifying ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> verifying...
              </>
            ) : step === "password" ? (
              "Continue"
            ) : (
              "Sign In"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── overview tiles ── */

function Tile({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  title?: string;
}) {
  return (
    <Card className="gap-1 py-4" title={title}>
      <CardHeader className="px-4 gap-1">
        <CardDescription className="text-[10px] tracking-widest uppercase font-mono">
          {label}
        </CardDescription>
        <CardTitle className="text-2xl font-mono">{value}</CardTitle>
      </CardHeader>
      {sub ? (
        <CardContent className="px-4">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {sub}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function OverviewTiles({
  stats,
  corpus,
  today,
}: {
  stats: AdminStats;
  corpus: CorpusHealth;
  today: AdminUsagePoint | undefined;
}) {
  const { learnings, keys, users } = stats;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Tile
        label="corpus docs"
        value={
          <span className={cn(corpus.ok && "text-primary terminal-glow")}>
            {corpus.points != null ? corpus.points.toLocaleString() : "—"}
          </span>
        }
        sub={
          <>
            <span className={corpus.ok ? "text-primary" : "text-destructive"}>
              {corpus.ok ? "ok" : "degraded"}
            </span>
            {" · qdrant "}
            <span className={corpus.qdrant ? "text-primary" : "text-destructive"}>
              {corpus.qdrant ? "up" : "down"}
            </span>
            {" · postgres "}
            <span className={corpus.postgres ? "text-primary" : "text-destructive"}>
              {corpus.postgres ? "up" : "down"}
            </span>
          </>
        }
        title={corpus.error ?? "learnings + Stack Overflow docs in the corpus"}
      />
      <Tile
        label="learnings"
        value={learnings.total.toLocaleString()}
        sub={`${learnings.pending} pending · ${learnings.scored} scored · ${learnings.rejected} rejected · ${learnings.duplicate} duplicate`}
      />
      <Tile
        label="tier split"
        value={
          <>
            <span className="text-secondary-foreground">
              {learnings.byTier.low}
            </span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-primary">{learnings.byTier.medium}</span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-accent">{learnings.byTier.gold}</span>
          </>
        }
        sub="low / medium / gold"
      />
      <Tile label="ao users" value={users.total.toLocaleString()} />
      <Tile
        label="credits in circulation"
        value={users.creditsInCirculation.toLocaleString()}
      />
      <Tile
        label="contribution points"
        value={users.totalPoints.toLocaleString()}
      />
      <Tile
        label="active api keys"
        value={keys.active.toLocaleString()}
        sub={`of ${keys.total} total`}
      />
      <Tile
        label="today"
        value={today ? today.dau.toLocaleString() : "—"}
        sub={today ? `dau · ${today.requests.toLocaleString()} requests` : "no usage data"}
      />
    </div>
  );
}

/* ── usage chart ── */

function UsageChart({ series }: { series: AdminUsagePoint[] }) {
  const maxStack = Math.max(1, ...series.map((d) => d.dauSite + d.dauApi));
  const maxReq = Math.max(1, ...series.map((d) => d.requests));

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-mono">dau &amp; usage</CardTitle>
        <CardDescription className="text-[11px]">
          Last {series.length} days. Requests are scaled independently of DAU.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {series.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No usage data yet.</p>
        ) : (
          <>
            <div className="flex items-end gap-[3px] h-36 border-b border-border">
              {series.map((d) => (
                <div
                  key={d.date}
                  className="flex-1 h-full flex items-end justify-center gap-px min-w-0"
                  title={`${d.date} — dau ${d.dau} (site ${d.dauSite}, api ${d.dauApi}) · ${d.requests} requests · ${d.creditsSpent} credits spent`}
                >
                  <div className="w-[55%] h-full flex flex-col justify-end">
                    <div
                      className="w-full rounded-t-[2px] bg-accent/80"
                      style={{ height: `${(d.dauApi / maxStack) * 100}%` }}
                    />
                    <div
                      className="w-full bg-primary/80"
                      style={{ height: `${(d.dauSite / maxStack) * 100}%` }}
                    />
                  </div>
                  <div className="w-[25%] h-full flex flex-col justify-end">
                    <div
                      className="w-full rounded-t-[2px] bg-secondary-foreground/25"
                      style={{ height: `${(d.requests / maxReq) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-[3px] mt-1">
              {series.map((d, i) => (
                <div
                  key={d.date}
                  className="flex-1 min-w-0 text-center text-[9px] text-muted-foreground whitespace-nowrap"
                >
                  {i % 7 === 0 || i === series.length - 1 ? d.date.slice(5) : ""}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-[2px] bg-primary/80" />
                dau site
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-[2px] bg-accent/80" />
                dau api
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-[2px] bg-secondary-foreground/25" />
                requests
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── learnings table ── */

function LearningsTable({
  learnings,
  onDelete,
}: {
  learnings: AdminLearning[];
  onDelete: (learning: AdminLearning) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-mono">learnings</CardTitle>
        <CardDescription className="text-[11px]">
          Latest submissions across all users. Removing one also drops it from
          the corpus.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {learnings.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No learnings yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead className="text-[10px] uppercase tracking-wider">title</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">submitter</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">status</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">score</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">tier</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">credits</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">corpus</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">submitted</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {learnings.map((l) => {
                const isOpen = expanded === l.id;
                const hasRationale = !!l.scoreRationale;
                return [
                  <TableRow
                    key={l.id}
                    className={cn(hasRationale && "cursor-pointer")}
                    onClick={() =>
                      hasRationale && setExpanded(isOpen ? null : l.id)
                    }
                  >
                    <TableCell className="text-muted-foreground">
                      {hasRationale &&
                        (isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ))}
                    </TableCell>
                    <TableCell className="text-xs max-w-56 truncate" title={l.title}>
                      {l.title}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-40 truncate" title={l.userEmail}>
                      {l.userEmail}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {l.score != null ? `${l.score}/10` : "—"}
                    </TableCell>
                    <TableCell>
                      {l.tier ? (
                        <TierBadge tier={l.tier} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-xs font-mono",
                        l.creditsDelta == null || l.creditsDelta === 0
                          ? "text-muted-foreground"
                          : l.creditsDelta > 0
                            ? "text-primary"
                            : "text-destructive"
                      )}
                    >
                      {l.creditsDelta == null
                        ? "—"
                        : l.creditsDelta > 0
                          ? `+${l.creditsDelta}`
                          : l.creditsDelta}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-block h-2 w-2 rounded-full",
                          l.inCorpus ? "bg-primary" : "bg-border"
                        )}
                        title={l.inCorpus ? "in corpus" : "not in corpus"}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDay(l.createdAt)}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {confirmDelete === l.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[10px] text-destructive">remove?</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            onClick={() => {
                              setConfirmDelete(null);
                              void onDelete(l);
                            }}
                          >
                            confirm
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2 text-muted-foreground"
                            onClick={() => setConfirmDelete(null)}
                          >
                            cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmDelete(l.id)}
                        >
                          remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>,
                  isOpen && hasRationale ? (
                    <TableRow key={`${l.id}-rationale`} className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={9} className="whitespace-normal">
                        <p className="text-[11px] text-muted-foreground leading-relaxed py-1">
                          <span className="text-foreground font-semibold">
                            scorer&apos;s rationale:{" "}
                          </span>
                          {l.scoreRationale}
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : null,
                ];
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ── limit requests ── */

const REQUEST_STATUS_STYLES: Record<string, string> = {
  pending: "border-primary/40 bg-primary/10 text-primary animate-pulse",
  approved: "border-primary/50 bg-primary/15 text-primary",
  rejected: "border-destructive/50 bg-destructive/15 text-destructive",
};

interface ResolveLimitArgs {
  requestId: string;
  approve: boolean;
  dailyRefill?: number;
  rateLimitPerMin?: number;
  note?: string;
}

function ResolveControls({
  request,
  onResolve,
}: {
  request: AdminLimitRequest;
  onResolve: (args: ResolveLimitArgs) => Promise<void>;
}) {
  // Prefilled with the user's current limits so "approve" grants at least the
  // status quo unless the admin raises them. Clearing a field omits it.
  const [refill, setRefill] = useState(String(request.currentRefill));
  const [rate, setRate] = useState(String(request.currentRateLimit));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const refillNum = Number(refill);
  const rateNum = Number(rate);
  const approveValid =
    (refill.trim() === "" || (Number.isInteger(refillNum) && refillNum > 0)) &&
    (rate.trim() === "" || (Number.isInteger(rateNum) && rateNum > 0));

  const resolve = async (approve: boolean) => {
    setBusy(approve ? "approve" : "reject");
    try {
      await onResolve({
        requestId: request.id,
        approve,
        ...(approve && refill.trim() !== "" ? { dailyRefill: refillNum } : {}),
        ...(approve && rate.trim() !== "" ? { rateLimitPerMin: rateNum } : {}),
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2 pt-1">
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">daily refill</Label>
        <Input
          type="number"
          value={refill}
          onChange={(e) => setRefill(e.target.value)}
          className="h-7 w-24 text-[11px] font-mono px-2"
          disabled={busy !== null}
          aria-label="Granted daily refill"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">rate limit /min</Label>
        <Input
          type="number"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="h-7 w-24 text-[11px] font-mono px-2"
          disabled={busy !== null}
          aria-label="Granted rate limit per minute"
        />
      </div>
      <div className="space-y-1 flex-1 min-w-44">
        <Label className="text-[10px] text-muted-foreground">note (optional)</Label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="shown to the user"
          className="h-7 text-[11px] font-mono px-2"
          disabled={busy !== null}
          aria-label="Resolution note"
        />
      </div>
      <Button
        size="sm"
        className="h-7 text-[10px] px-3 font-bold"
        disabled={!approveValid || busy !== null}
        onClick={() => void resolve(true)}
      >
        {busy === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : "approve"}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        className="h-7 text-[10px] px-3"
        disabled={busy !== null}
        onClick={() => void resolve(false)}
      >
        {busy === "reject" ? <Loader2 className="h-3 w-3 animate-spin" /> : "reject"}
      </Button>
    </div>
  );
}

function LimitRequestsTable({
  requests,
  onResolve,
}: {
  requests: AdminLimitRequest[];
  onResolve: (args: ResolveLimitArgs) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-mono">limit requests</CardTitle>
        <CardDescription className="text-[11px]">
          Applications for higher daily refill / rate limits, pending first.
          Expand a row for the use case and approval controls.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {requests.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No limit requests yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead className="text-[10px] uppercase tracking-wider">email</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">tier</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">current limits</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">expected volume</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">status</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">granted</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">requested</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => {
                const isOpen = expanded === r.id;
                return [
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                  >
                    <TableCell className="text-muted-foreground">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-48 truncate" title={r.userEmail}>
                      {r.userEmail}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[10px]",
                          CONTRIB_TIER_STYLES[r.userTier] ?? CONTRIB_TIER_STYLES.lurker
                        )}
                      >
                        {r.userTier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {r.currentRefill}/day · {r.currentRateLimit}/min
                    </TableCell>
                    <TableCell className="text-xs max-w-40 truncate" title={r.expectedDaily}>
                      {r.expectedDaily}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[10px]",
                          REQUEST_STATUS_STYLES[r.status]
                        )}
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {r.status === "approved"
                        ? `${r.grantedRefill ?? "—"}/day · ${r.grantedRateLimit ?? "—"}/min`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDay(r.createdAt)}
                    </TableCell>
                  </TableRow>,
                  isOpen ? (
                    <TableRow key={`${r.id}-detail`} className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={7} className="whitespace-normal">
                        <div className="py-1 space-y-2">
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            <span className="text-foreground font-semibold">use case: </span>
                            {r.useCase}
                          </p>
                          {r.adminNote && (
                            <p className="text-[11px] text-muted-foreground">
                              <span className="text-foreground font-semibold">note: </span>
                              {r.adminNote}
                            </p>
                          )}
                          {r.status === "pending" && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <ResolveControls request={r} onResolve={onResolve} />
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null,
                ];
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ── users table ── */

function CreditAdjust({
  onApply,
}: {
  onApply: (delta: number) => Promise<number>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const delta = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(delta) && delta !== 0;

  const apply = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const balance = await onApply(delta);
      toast.success(`Balance now ${balance}.`);
      setValue("");
    } catch (err) {
      if (!isUnauthorized(err)) {
        toast.error(err instanceof Error ? err.message : "Adjustment failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <Input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void apply();
        }}
        placeholder="±0"
        className="h-6 w-20 text-[11px] font-mono px-2"
        disabled={busy}
        aria-label="Credit adjustment"
      />
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-[10px] px-2"
        disabled={!valid || busy}
        onClick={() => void apply()}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "apply"}
      </Button>
    </span>
  );
}

function UsersTable({
  users,
  onAdjust,
}: {
  users: AdminUser[];
  onAdjust: (userId: string, delta: number) => Promise<number>;
}) {
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-mono">users</CardTitle>
        <CardDescription className="text-[11px]">
          Top contributors first, max 200. Credit adjustments apply
          immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {users.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No users yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wider">email</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">tier</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">points</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">daily refill</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">balance</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">adjust credits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell
                    className="text-xs max-w-56 truncate"
                    title={u.name ? `${u.email} (${u.name})` : u.email}
                  >
                    {u.email}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-mono text-[10px]",
                        CONTRIB_TIER_STYLES[u.tier] ?? CONTRIB_TIER_STYLES.lurker
                      )}
                    >
                      {u.tier}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono">{u.points}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {u.dailyRefill}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-primary">
                    {u.balance}
                  </TableCell>
                  <TableCell className="text-right">
                    <CreditAdjust onApply={(delta) => onAdjust(u.userId, delta)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ── dashboard ── */

interface AdminData {
  stats: AdminStats;
  series: AdminUsagePoint[];
  learnings: AdminLearning[];
  users: AdminUser[];
  corpus: CorpusHealth;
  limitRequests: AdminLimitRequest[];
}

function AdminDashboard({
  token,
  onSignOut,
}: {
  token: string;
  onSignOut: () => void;
}) {
  const convex = useConvex();
  const deleteLearningAction = useAction(thalamus.deleteLearning);
  const adjustCreditsAction = useAction(thalamus.adjustCredits);
  const resolveLimitRequestMutation = useMutation(thalamus.resolveLimitRequest);

  const [data, setData] = useState<AdminData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [stats, series, learnings, users, corpus, limitRequests] = await Promise.all([
        convex.query(thalamus.adminStats, { adminToken: token }),
        convex.query(thalamus.adminUsageSeries, { adminToken: token }),
        convex.query(thalamus.adminLearnings, { adminToken: token, limit: 200 }),
        convex.query(thalamus.adminUsers, { adminToken: token }),
        convex.action(thalamus.adminCorpusHealth, { adminToken: token }),
        convex.query(thalamus.adminLimitRequests, { adminToken: token }),
      ]);
      setData({ stats, series, learnings, users, corpus, limitRequests });
      setLoadError(null);
    } catch (err) {
      if (isUnauthorized(err)) {
        onSignOut();
        return;
      }
      setLoadError(
        err instanceof Error ? err.message : "Failed to load admin data."
      );
    }
  }, [convex, token, onSignOut]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; every setState in load() runs after an await, never synchronously in the effect body
    void load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };

  // Optimistic removal — the row disappears immediately and is restored if
  // the backend call fails.
  const handleDeleteLearning = async (learning: AdminLearning) => {
    setData((d) =>
      d ? { ...d, learnings: d.learnings.filter((x) => x.id !== learning.id) } : d
    );
    try {
      await deleteLearningAction({ adminToken: token, learningId: learning.id });
      toast.success("Learning removed.");
    } catch (err) {
      setData((d) =>
        d
          ? {
              ...d,
              learnings: [...d.learnings, learning].sort(
                (a, b) => b.createdAt - a.createdAt
              ),
            }
          : d
      );
      if (isUnauthorized(err)) {
        onSignOut();
        return;
      }
      toast.error(
        err instanceof Error ? err.message : "Failed to remove learning."
      );
    }
  };

  const handleResolveLimitRequest = async (args: ResolveLimitArgs) => {
    try {
      await resolveLimitRequestMutation({ adminToken: token, ...args });
      toast.success(args.approve ? "Request approved." : "Request rejected.");
      await load();
    } catch (err) {
      if (isUnauthorized(err)) {
        onSignOut();
        return;
      }
      toast.error(
        err instanceof Error ? err.message : "Failed to resolve request."
      );
    }
  };

  const handleAdjustCredits = async (userId: string, delta: number) => {
    try {
      const { balance } = await adjustCreditsAction({
        adminToken: token,
        userId,
        delta,
      });
      setData((d) =>
        d
          ? {
              ...d,
              users: d.users.map((u) =>
                u.userId === userId ? { ...u, balance } : u
              ),
            }
          : d
      );
      return balance;
    } catch (err) {
      if (isUnauthorized(err)) onSignOut();
      throw err;
    }
  };

  return (
    <div className="min-h-screen font-mono">
      <meta name="robots" content="noindex" />
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded border border-primary/50 bg-primary/10 text-primary text-[11px] font-bold leading-none">
            ao
          </span>
          <span className="text-sm font-bold tracking-tight">
            <span className="text-foreground">agent</span>
            <span className="text-primary">overflow</span>
            <span className="text-muted-foreground font-normal"> / admin</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={onSignOut}
            >
              <LogOut className="h-3.5 w-3.5" />
              sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-4">
        {loadError && (
          <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {loadError} — use refresh to retry.
          </p>
        )}
        {data === null ? (
          !loadError && (
            <div className="min-h-[60vh] flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )
        ) : (
          <>
            <OverviewTiles
              stats={data.stats}
              corpus={data.corpus}
              today={data.series[data.series.length - 1]}
            />
            <UsageChart series={data.series} />
            <LimitRequestsTable
              requests={data.limitRequests}
              onResolve={handleResolveLimitRequest}
            />
            <LearningsTable
              learnings={data.learnings}
              onDelete={handleDeleteLearning}
            />
            <UsersTable users={data.users} onAdjust={handleAdjustCredits} />
          </>
        )}
      </main>
    </div>
  );
}

/* ── page ── */

export default function AdminPage() {
  const [adminToken, setAdminToken] = useState(() => {
    try {
      return localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  });

  // Validate the stored token server-side before showing the dashboard.
  const tokenValid = useQuery(
    thalamus.verifyAdminToken,
    adminToken ? { token: adminToken } : "skip"
  );

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setAdminToken("");
  }, []);

  useEffect(() => {
    if (adminToken && tokenValid === false) {
      try {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
      } catch {
        /* ignore */
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to the async Convex token verification result; not derivable at render time
      setAdminToken("");
    }
  }, [adminToken, tokenValid]);

  if (!adminToken) {
    return <AdminLogin onToken={setAdminToken} />;
  }

  if (tokenValid !== true) {
    return (
      <div className="min-h-screen font-mono flex items-center justify-center">
        <meta name="robots" content="noindex" />
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <AdminDashboard token={adminToken} onSignOut={signOut} />;
}
