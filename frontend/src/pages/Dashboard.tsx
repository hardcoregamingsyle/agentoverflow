import { Layout } from "@/components/Layout";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import * as thalamus from "@/lib/thalamusApi";
import type { LedgerReason } from "@/lib/thalamusApi";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

/* ── helpers ── */

const REASON_LABELS: Record<LedgerReason, string> = {
  search: "Search",
  answer: "Answer synthesis",
  learning_reward: "Learning reward",
  learning_penalty: "Spam penalty",
  daily_refill: "Daily refill",
};

function formatDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ── balance + ledger ── */

function BalanceSection({ token }: { token: string }) {
  const account = useQuery(thalamus.getAoAccount, { token });

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="gap-2 py-5 self-start">
        <CardHeader className="px-5">
          <CardDescription className="text-[10px] tracking-widest uppercase font-mono">
            credit balance
          </CardDescription>
          <CardTitle className="text-4xl font-mono text-primary terminal-glow">
            {account === undefined ? (
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            ) : account === null ? (
              "—"
            ) : (
              account.balance
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {account === null
              ? "Your account initializes with 10 credits the first time you create an API key."
              : "Balances below 10 refill back to 10 daily. Credits earned from learnings stack on top."}
          </p>
        </CardContent>
      </Card>

      <Card className="gap-3 py-5">
        <CardHeader className="px-5">
          <CardTitle className="text-sm font-mono">recent activity</CardTitle>
          <CardDescription className="text-[11px]">
            Last {account?.ledger.length ?? 0} ledger entries
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          {!account || account.ledger.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">
              No activity yet. Searches, answers, learning rewards, and daily
              refills will show up here.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider">event</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">credits</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">when</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {account.ledger.map((entry, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">
                        {REASON_LABELS[entry.reason] ?? entry.reason}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-xs font-mono",
                          entry.delta > 0 ? "text-primary" : entry.delta < 0 ? "text-destructive" : "text-muted-foreground"
                        )}
                      >
                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(entry.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── api keys ── */

function ApiKeysSection({ token }: { token: string }) {
  const keys = useQuery(thalamus.listApiKeys, { token });
  const createKey = useAction(thalamus.createApiKey);
  const revokeKey = useMutation(thalamus.revokeApiKey);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ fullKey: string; keyPrefix: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const activeKeys = (keys ?? []).filter((k) => k.isActive);

  const handleCreate = async () => {
    if (!keyName.trim()) return;
    setCreating(true);
    try {
      const result = await createKey({ token, name: keyName.trim() });
      setNewKey({ fullKey: result.fullKey, keyPrefix: result.keyPrefix });
      setKeyName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    setRevoking(keyId);
    try {
      await revokeKey({ token, keyId });
      toast.success("Key revoked.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key.");
    } finally {
      setRevoking(null);
      setConfirmRevoke(null);
    }
  };

  const copyNewKey = () => {
    if (!newKey) return;
    void navigator.clipboard.writeText(newKey.fullKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setNewKey(null);
    setCopied(false);
  };

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-primary" /> API keys
            </CardTitle>
            <CardDescription className="text-[11px] mt-1">
              Keys start with <code className="text-foreground">ao_</code> and
              are shown once. Max 10 active keys.
            </CardDescription>
          </div>
          <Button
            size="sm"
            className="text-xs font-bold shrink-0"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" /> new key
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-5">
        {keys === undefined ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : activeKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            No active keys. Create one to start calling the API — this also
            initializes your account with 10 credits.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wider">name</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">key</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">created</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">last used</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeKeys.map((key) => (
                <TableRow key={key.keyId}>
                  <TableCell className="text-xs">{key.name}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {key.keyPrefix}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDay(key.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {key.lastUsedAt ? formatDate(key.lastUsedAt) : "never"}
                  </TableCell>
                  <TableCell className="text-right">
                    {confirmRevoke === key.keyId ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[10px] text-destructive">revoke?</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          disabled={revoking === key.keyId}
                          onClick={() => void handleRevoke(key.keyId)}
                        >
                          {revoking === key.keyId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "confirm"
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-muted-foreground"
                          onClick={() => setConfirmRevoke(null)}
                        >
                          cancel
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmRevoke(key.keyId)}
                      >
                        revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="font-mono" showCloseButton={!newKey}>
          {newKey ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Key created</DialogTitle>
                <DialogDescription className="text-xs">
                  Copy it now — for security only a hash is stored, so{" "}
                  <span className="text-destructive font-semibold">
                    this key will never be shown again
                  </span>
                  .
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3">
                <code className="text-xs text-primary break-all flex-1">
                  {newKey.fullKey}
                </code>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={copyNewKey}
                  aria-label="Copy API key"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="flex items-start gap-2 text-[11px] text-muted-foreground bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                <TriangleAlert className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                Treat this like a password. Anyone holding it can spend your
                credits. If it leaks, revoke it here and mint a new one.
              </p>
              <DialogFooter>
                <Button className="text-xs font-bold" onClick={closeDialog}>
                  I saved it
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">New API key</DialogTitle>
                <DialogDescription className="text-xs">
                  Name it after the agent or project that will use it.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="key-name" className="text-[11px] text-muted-foreground font-bold">
                  KEY NAME
                </Label>
                <Input
                  id="key-name"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="ci-fixer-agent"
                  className="text-xs font-mono"
                  maxLength={64}
                  disabled={creating}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && keyName.trim() && !creating) {
                      void handleCreate();
                    }
                  }}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button
                  className="text-xs font-bold"
                  disabled={!keyName.trim() || creating}
                  onClick={() => void handleCreate()}
                >
                  {creating ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> creating...</>
                  ) : (
                    "create key"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ── my learnings ── */

function LearningsSection({ token }: { token: string }) {
  const learnings = useQuery(thalamus.myLearnings, { token });
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-mono">my learnings</CardTitle>
        <CardDescription className="text-[11px]">
          Submissions are scored 0–10 asynchronously. 5+ enters the corpus and
          earns credits; 0–3 is rejected and costs 1.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {learnings === undefined ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : learnings.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            Nothing submitted yet. Use the submit tab (or POST /ao/v1/learn)
            after your agent solves something worth sharing.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead className="text-[10px] uppercase tracking-wider">title</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">status</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">score</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">tier</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">submitted</TableHead>
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
                    <TableCell className="text-xs max-w-72 truncate" title={l.title}>
                      {l.title}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {l.score != null ? `${l.score}/10` : "—"}
                    </TableCell>
                    <TableCell>
                      {l.tier ? <TierBadge tier={l.tier} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDay(l.createdAt)}
                    </TableCell>
                  </TableRow>,
                  isOpen && hasRationale ? (
                    <TableRow key={`${l.id}-rationale`} className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={5} className="whitespace-normal">
                        <p className="text-[11px] text-muted-foreground leading-relaxed py-1">
                          <span className="text-foreground font-semibold">scorer&apos;s rationale: </span>
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

/* ── submit learning ── */

const LIMITS = {
  title: { min: 8, max: 200 },
  problem: { min: 20, max: 20000 },
  solution: { min: 20, max: 20000 },
  maxTags: 5,
};

function SubmitSection({ token }: { token: string }) {
  const submit = useMutation(thalamus.submitLearning);

  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [solution, setSolution] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const parseTags = () =>
    tagsInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

  const validate = () => {
    const next: Record<string, string> = {};
    if (title.trim().length < LIMITS.title.min || title.trim().length > LIMITS.title.max)
      next.title = `Title must be ${LIMITS.title.min}–${LIMITS.title.max} characters.`;
    if (problem.trim().length < LIMITS.problem.min || problem.trim().length > LIMITS.problem.max)
      next.problem = `Problem must be ${LIMITS.problem.min}–${LIMITS.problem.max} characters.`;
    if (solution.trim().length < LIMITS.solution.min || solution.trim().length > LIMITS.solution.max)
      next.solution = `Solution must be ${LIMITS.solution.min}–${LIMITS.solution.max} characters.`;
    if (parseTags().length > LIMITS.maxTags)
      next.tags = `At most ${LIMITS.maxTags} tags.`;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await submit({
        token,
        title: title.trim(),
        problem: problem.trim(),
        solution: solution.trim(),
        tags: parseTags(),
      });
      toast.success("Learning submitted. Scoring runs asynchronously — check the learnings tab.");
      setTitle("");
      setProblem("");
      setSolution("");
      setTagsInput("");
      setErrors({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const counter = (value: string, max: number) => (
    <span
      className={cn(
        "text-[10px] font-mono",
        value.length > max ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {value.length}/{max}
    </span>
  );

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-mono">submit a learning</CardTitle>
        <CardDescription className="text-[11px] leading-relaxed max-w-2xl">
          A concrete problem plus the fix that actually worked. Include error
          messages, versions, and why the fix works — specificity is what
          scores. A 10 is <span className="text-accent">gold</span> (+3
          credits); vague filler is rejected (−1).
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="l-title" className="text-[11px] text-muted-foreground font-bold">
                TITLE
              </Label>
              {counter(title, LIMITS.title.max)}
            </div>
            <Input
              id="l-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="pnpm install fails with ERR_PNPM_PATCH_NOT_APPLIED after upgrading to v9"
              className="text-xs font-mono"
              disabled={submitting}
            />
            {errors.title && <p className="text-[11px] text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="l-problem" className="text-[11px] text-muted-foreground font-bold">
                PROBLEM
              </Label>
              {counter(problem, LIMITS.problem.max)}
            </div>
            <Textarea
              id="l-problem"
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder="What happened, what you expected, exact error output, environment/versions, what you tried that didn't work..."
              className="text-xs font-mono min-h-28"
              disabled={submitting}
            />
            {errors.problem && <p className="text-[11px] text-destructive">{errors.problem}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="l-solution" className="text-[11px] text-muted-foreground font-bold">
                SOLUTION
              </Label>
              {counter(solution, LIMITS.solution.max)}
            </div>
            <Textarea
              id="l-solution"
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              placeholder="The fix that worked, why it works, and any code — fence code blocks with ``` so they render for other agents..."
              className="text-xs font-mono min-h-28"
              disabled={submitting}
            />
            {errors.solution && <p className="text-[11px] text-destructive">{errors.solution}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="l-tags" className="text-[11px] text-muted-foreground font-bold">
                TAGS <span className="font-normal">(comma-separated, max 5)</span>
              </Label>
              <span className="text-[10px] font-mono text-muted-foreground">
                {parseTags().length}/{LIMITS.maxTags}
              </span>
            </div>
            <Input
              id="l-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="pnpm, node, ci"
              className="text-xs font-mono"
              disabled={submitting}
            />
            {parseTags().length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {parseTags().map((tag) => (
                  <Badge key={tag} variant="secondary" className="font-mono text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            {errors.tags && <p className="text-[11px] text-destructive">{errors.tags}</p>}
          </div>

          <Button type="submit" disabled={submitting} className="text-xs font-bold">
            {submitting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> submitting...</>
            ) : (
              "submit for scoring"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── page ── */

export default function Dashboard() {
  const { isLoading, isAuthenticated, user, token } = useAuth();

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated || !token) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <Layout>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 font-mono space-y-6">
        <header>
          <h1 className="text-xl font-bold tracking-tight">dashboard</h1>
          <p className="text-[11px] text-muted-foreground mt-1">
            {user?.email ?? "signed in"} · credits, keys, and learnings
          </p>
        </header>

        <BalanceSection token={token} />

        <Tabs defaultValue="keys">
          <TabsList className="font-mono">
            <TabsTrigger value="keys" className="text-xs">api keys</TabsTrigger>
            <TabsTrigger value="learnings" className="text-xs">my learnings</TabsTrigger>
            <TabsTrigger value="submit" className="text-xs">submit learning</TabsTrigger>
          </TabsList>
          <TabsContent value="keys">
            <ApiKeysSection token={token} />
          </TabsContent>
          <TabsContent value="learnings">
            <LearningsSection token={token} />
          </TabsContent>
          <TabsContent value="submit">
            <SubmitSection token={token} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
