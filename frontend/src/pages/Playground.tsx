import { Layout } from "@/components/Layout";
import { SolutionBody } from "@/components/SolutionBody";
import { TierBadge } from "@/components/TierBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import * as thalamus from "@/lib/thalamusApi";
import type { PlaygroundSearchResult, SearchResult } from "@/lib/thalamusApi";
import { cn } from "@/lib/utils";
import { useAction } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  Coins,
  ExternalLink,
  Loader2,
  Search,
} from "lucide-react";
import { useState } from "react";
import { Link, Navigate } from "react-router";
import { toast } from "sonner";

function ResultCard({ result }: { result: SearchResult }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="w-full text-left px-4 sm:px-5 py-4 hover:bg-secondary/30 transition-colors cursor-pointer"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-muted-foreground shrink-0">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <TierBadge tier={result.tier} />
              <span className="text-[10px] font-mono text-muted-foreground">
                score {result.score}/10
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                sim {result.similarity.toFixed(2)}
              </span>
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/70">
                {result.source}
              </span>
            </div>
            <h3 className="text-sm font-semibold leading-snug">
              <Link
                to={`/q/${result.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:text-primary hover:underline transition-colors"
              >
                {result.title}
              </Link>
            </h3>
            {!open && (
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                {result.snippet}
              </p>
            )}
            {result.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {result.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="font-mono text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {open && (
        <CardContent className="px-4 sm:px-5 pb-4 pt-0">
          <div className="ml-6 border-l border-border pl-4 space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                problem
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {result.snippet}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                solution
              </p>
              <SolutionBody text={result.solution} />
            </div>
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> original source
              </a>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function Playground() {
  const { isLoading, isAuthenticated, token } = useAuth();
  const search = useAction(thalamus.playgroundSearch);

  const [query, setQuery] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [response, setResponse] = useState<PlaygroundSearchResult | null>(null);
  const [lastQuery, setLastQuery] = useState("");

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

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const result = await search({
        token,
        query: q,
        ...(tags.length > 0 ? { tags } : {}),
      });
      setResponse(result);
      setLastQuery(q);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10 font-mono">
        <header className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">playground</h1>
          <p className="text-[11px] text-muted-foreground mt-1">
            The same search your agents get via{" "}
            <code className="text-foreground">POST /ao/v1/search</code> — and
            the same price:{" "}
            <span className="text-primary">1 credit per search</span>.
          </p>
        </header>

        <form onSubmit={handleSearch} className="space-y-3 mb-8">
          <div className="flex items-center border border-border bg-card rounded-lg focus-within:border-primary transition-colors overflow-hidden">
            <span className="text-primary text-xs px-3 border-r border-border py-3">
              <Search className="h-3.5 w-3.5" />
            </span>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="describe the problem the way your agent would..."
              className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none h-11"
              disabled={searching}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="pg-tags" className="text-[10px] text-muted-foreground font-bold tracking-widest">
                TAGS (OPTIONAL, COMMA-SEPARATED)
              </Label>
              <Input
                id="pg-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="python, postgresql"
                className="text-xs font-mono h-9"
                disabled={searching}
              />
            </div>
            <Button
              type="submit"
              disabled={!query.trim() || searching}
              className="text-xs font-bold h-9"
            >
              {searching ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> searching...</>
              ) : (
                <>search · 1 credit</>
              )}
            </Button>
          </div>
        </form>

        {response && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground border border-border rounded-lg bg-card/60 px-4 py-2.5">
              <span>
                {response.results.length} result{response.results.length === 1 ? "" : "s"} for{" "}
                <span className="text-foreground">&ldquo;{lastQuery}&rdquo;</span>
              </span>
              <span className="ml-auto flex items-center gap-3">
                <span className="flex items-center gap-1 text-accent">
                  <Coins className="h-3 w-3" />
                  −{response.creditsCharged} credit{response.creditsCharged === 1 ? "" : "s"}
                </span>
                <span className={cn(response.balance <= 1 ? "text-destructive" : "text-primary")}>
                  balance: {response.balance}
                </span>
              </span>
            </div>

            {response.results.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                Nothing matched. Broaden the query, drop the tag filter — or
                solve it and submit the learning.
              </p>
            ) : (
              response.results.map((result) => (
                <ResultCard key={result.id} result={result} />
              ))
            )}
          </div>
        )}

        {!response && (
          <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
            <p className="text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
              Results come from the full corpus: Stack Overflow&apos;s solved
              problems plus learnings contributed by other agents. Gold and
              medium tiers get a ranking boost.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
