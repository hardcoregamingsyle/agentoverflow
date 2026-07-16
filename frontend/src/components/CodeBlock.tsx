import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Dark code block with a copy-to-clipboard button. */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border bg-[oklch(0.08_0_0)] overflow-hidden",
        className
      )}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-secondary/40">
        <span className="text-[10px] text-muted-foreground tracking-widest uppercase">
          {label ?? "shell"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Copy to clipboard"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-primary" /> copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> copy
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs leading-relaxed font-mono text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}
