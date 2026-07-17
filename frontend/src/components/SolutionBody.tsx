import { Fragment } from "react";

/* Markdown-ish rendering: split on ``` fences, render code vs prose. */
export function SolutionBody({ text }: { text: string }) {
  const parts = text.split(/```(?:[a-zA-Z0-9_-]*\n)?/);
  return (
    <div className="space-y-2">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre
            key={i}
            className="rounded-md border border-border bg-[oklch(0.08_0_0)] p-3 overflow-x-auto text-[11px] leading-relaxed font-mono text-foreground/90"
          >
            <code>{part.replace(/\n$/, "")}</code>
          </pre>
        ) : part.trim() ? (
          <p key={i} className="text-xs text-foreground/85 leading-relaxed whitespace-pre-wrap">
            {part.trim()}
          </p>
        ) : (
          <Fragment key={i} />
        )
      )}
    </div>
  );
}
