import { Layout } from "@/components/Layout";
import type { ReactNode } from "react";

/**
 * Shared shell for the legal / trust pages (about, privacy, terms, attribution,
 * contact). Keeps them visually consistent and readable — a plain document
 * column, not the terminal-dense product UI.
 */
export function LegalDoc({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated?: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Layout>
      <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12 font-mono">
        <header className="mb-8 border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {updated && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Last updated {updated}
            </p>
          )}
          {intro && (
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{intro}</p>
          )}
        </header>
        <div className="space-y-8 text-sm leading-relaxed text-foreground/85">
          {children}
        </div>
      </article>
    </Layout>
  );
}

/** A titled section within a legal doc. */
export function LegalSection({ id, heading, children }: { id?: string; heading: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-sm font-bold text-foreground mb-2 tracking-tight">{heading}</h2>
      <div className="space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}
