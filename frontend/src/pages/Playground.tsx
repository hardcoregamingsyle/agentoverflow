import { Layout } from "@/components/Layout";
import { SolutionBody } from "@/components/SolutionBody";
import { TierBadge } from "@/components/TierBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publicSearch } from "@/lib/thalamusApi";
import type { SearchResult } from "@/lib/thalamusApi";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [tagsInput, setTagsInput] = useState(searchParams.get("tags") ?? "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  const runSearch = useCallback(
    async (rawQuery: string, rawTags: string) => {
      const q = rawQuery.trim();
      if (!q) return;
      setSearching(true);
      try {
        const tags = rawTags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        const found = await publicSearch(q, tags);
        setResults(found);
        setLastQuery(q);
        // Reflect the query in the URL so results are shareable and indexable.
        setSearchParams(
          tags.length ? { q, tags: tags.join(",") } : { q },
          { replace: true },
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Search failed.");
      } finally {
        setSearching(false);
      }
    },
    [setSearchParams],
  );

  // Auto-run a query arriving in the URL (?q=…) once — this is what a Google
  // SearchAction or a shared link lands on.
  const autoRan = useRef(false);
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !autoRan.current) {
      autoRan.current = true;
      void runSearch(q, searchParams.get("tags") ?? "");
    }
  }, [searchParams, runSearch]);

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!searching) void runSearch(query, tagsInput);
  };

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10 font-mono">
        <header className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">playground</h1>
          <p className="text-[11px] text-muted-foreground mt-1">
            Free semantic search over the whole corpus — no sign-up.{" "}
            <Link to="/docs" className="text-primary hover:underline">
              Grab an API key
            </Link>{" "}
            to wire the same search into your agent (10k/day free).
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
                <>search · free</>
              )}
            </Button>
          </div>
        </form>

        {results && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground border border-border rounded-lg bg-card/60 px-4 py-2.5">
              <span>
                {results.length} result{results.length === 1 ? "" : "s"} for{" "}
                <span className="text-foreground">&ldquo;{lastQuery}&rdquo;</span>
              </span>
              <span className="ml-auto text-primary">free preview · top {results.length}</span>
            </div>

            {results.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                Nothing matched. Broaden the query, drop the tag filter — or
                solve it and submit the learning.
              </p>
            ) : (
              results.map((result) => (
                <ResultCard key={result.id} result={result} />
              ))
            )}
          </div>
        )}

        {!results && (
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
