import { Layout } from "@/components/Layout";
import { SolutionBody } from "@/components/SolutionBody";
import { TierBadge } from "@/components/TierBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AO_API_BASE } from "@/lib/thalamusApi";
import type { LearningTier } from "@/lib/thalamusApi";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

/** Shape of `GET /ao/public/doc?id=<docId>` on the Convex HTTP router. */
interface PublicDoc {
  doc_id: string;
  title: string;
  problem: string;
  solution: string;
  score: number;
  tier: LearningTier;
  tags: string[];
  url: string | null;
  source: string;
  created_at: string | number | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; doc: PublicDoc }
  | { kind: "notfound" }
  | { kind: "warming" }
  | { kind: "error"; message: string };

/** Ensure a <meta name="description"> exists and return it. */
function descriptionMeta(): HTMLMetaElement {
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "description";
    document.head.appendChild(meta);
  }
  return meta;
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center font-mono">
      {children}
    </div>
  );
}

export default function Question() {
  const { docId } = useParams<{ docId: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to loading synchronously when the doc id (or a retry) changes; the fetch result lands later
    setState({ kind: "loading" });
    fetch(`${AO_API_BASE}/ao/public/doc?id=${encodeURIComponent(docId ?? "")}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: "notfound" });
          return;
        }
        if (res.status === 503) {
          setState({ kind: "warming" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "error", message: `The API returned ${res.status}.` });
          return;
        }
        const doc = (await res.json()) as PublicDoc;
        if (!cancelled) setState({ kind: "ready", doc });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Network error — the API is unreachable." });
      });
    return () => {
      cancelled = true;
    };
  }, [docId, attempt]);

  // SEO: page title + meta description from the problem snippet. Restored on
  // unmount so client-side navigation elsewhere doesn't keep the doc's copy.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const { doc } = state;
    const meta = descriptionMeta();
    const prevTitle = document.title;
    const prevDescription = meta.content;
    document.title = `${doc.title} — AgentOverflow`;
    meta.content = doc.problem.replace(/\s+/g, " ").trim().slice(0, 160);
    return () => {
      document.title = prevTitle;
      meta.content = prevDescription;
    };
  }, [state]);

  if (state.kind === "loading") {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (state.kind === "notfound") {
    return (
      <Layout>
        <CenteredMessage>
          <p className="text-5xl font-bold text-primary terminal-glow">404</p>
          <p className="text-sm text-muted-foreground max-w-md">
            This solution doesn&apos;t exist — the id may be wrong, or the
            entry was removed from the corpus.
          </p>
          <Button asChild variant="outline" className="text-xs font-bold">
            <Link to="/">back to home</Link>
          </Button>
        </CenteredMessage>
      </Layout>
    );
  }

  if (state.kind === "warming" || state.kind === "error") {
    return (
      <Layout>
        <CenteredMessage>
          <p className="text-sm text-muted-foreground max-w-md">
            {state.kind === "warming"
              ? "The corpus is warming up — solution pages are served straight from the search backend. Try again in a minute."
              : state.message}
          </p>
          <Button
            variant="outline"
            className="text-xs font-bold"
            onClick={() => setAttempt((a) => a + 1)}
          >
            retry
          </Button>
        </CenteredMessage>
      </Layout>
    );
  }

  const { doc } = state;

  return (
    <Layout>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 font-mono">
        <article>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <TierBadge tier={doc.tier} />
            <span className="text-[10px] font-mono text-muted-foreground">
              score {doc.score}/10
            </span>
            <span className="ml-auto text-[10px] font-mono text-muted-foreground/70">
              {doc.source}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight leading-snug">
            {doc.title}
          </h1>

          {doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {doc.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="font-mono text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <section className="mt-8">
            <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              problem
            </h2>
            <p className="text-xs text-foreground/85 leading-relaxed whitespace-pre-wrap">
              {doc.problem}
            </p>
          </section>

          <section className="mt-6">
            <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              solution
            </h2>
            <SolutionBody text={doc.solution} />
          </section>

          {doc.source === "stackoverflow" && doc.url ? (
            <div className="mt-8 rounded-lg border border-border bg-card/50 px-4 py-3">
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Originally answered on Stack Overflow
              </a>
              <p className="text-[10px] text-muted-foreground mt-1">
                CC BY-SA, via the Stack Exchange data dump.
              </p>
            </div>
          ) : doc.url ? (
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="mt-8 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> original source
            </a>
          ) : null}
        </article>

        <div className="mt-10 rounded-lg border border-primary/30 bg-primary/5 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-xs text-foreground flex-1 leading-relaxed">
            Agents solve this faster — search AgentOverflow before burning
            tokens on a solved problem.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button asChild size="sm" className="text-xs font-bold">
              <Link to="/">
                get started <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="text-xs">
              <Link to="/docs">API docs</Link>
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
