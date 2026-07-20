import { CodeBlock } from "@/components/CodeBlock";
import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * Minimal Markdown renderer — no npm dependency, matching the site's
 * minimalism. Handles headings (# / ## / ###), paragraphs, unordered (- ) and
 * ordered (1. ) lists, fenced ``` code blocks, and inline `code`, **bold**, and
 * [text](url) links. Output is built as React nodes, so text is escaped by
 * React and internal links become <Link> for client-side routing.
 */

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; content: string }
  | { type: "p"; text: string };

const HEADING = /^(#{1,3})\s+(.*)$/;
const UL_ITEM = /^-\s+(.*)$/;
const OL_ITEM = /^\d+\.\s+(.*)$/;

function isFence(line: string): boolean {
  return line.trimStart().startsWith("```");
}

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block — collect verbatim until the closing fence.
    if (isFence(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence, if any
      blocks.push({ type: "code", content: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length as 1 | 2 | 3, text: h[2].trim() });
      i++;
      continue;
    }

    if (UL_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_ITEM.test(lines[i])) {
        items.push(UL_ITEM.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (OL_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_ITEM.test(lines[i])) {
        items.push(OL_ITEM.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph — soft-wrapped lines join with a space until a blank or a
    // structural line ends the run.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isFence(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !UL_ITEM.test(lines[i]) &&
      !OL_ITEM.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }

  return blocks;
}

// Inline: `code` | **bold** | [text](url). Each alternative captures so the
// matched kind can be told apart.
const INLINE = "(`[^`]+`)|(\\*\\*[^*]+\\*\\*)|(\\[[^\\]]+\\]\\([^)]+\\))";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const re = new RegExp(INLINE, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${n++}`;

    if (m[1]) {
      out.push(
        <code
          key={key}
          className="rounded bg-secondary px-1 py-0.5 text-[0.85em] text-foreground"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const label = lm[1];
      const href = lm[2];
      if (href.startsWith("/")) {
        out.push(
          <Link key={key} to={href} className="text-primary hover:underline">
            {label}
          </Link>,
        );
      } else {
        out.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {label}
          </a>,
        );
      }
    }
    last = m.index + tok.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderBlock(block: Block, i: number): ReactNode {
  const key = `b-${i}`;
  switch (block.type) {
    case "heading": {
      const inner = renderInline(block.text, key);
      if (block.level === 1)
        return (
          <h1 key={key} className="text-2xl font-bold tracking-tight mt-10 first:mt-0 text-foreground">
            {inner}
          </h1>
        );
      if (block.level === 2)
        return (
          <h2 key={key} className="text-lg font-bold tracking-tight mt-8 first:mt-0 text-foreground">
            {inner}
          </h2>
        );
      return (
        <h3 key={key} className="text-base font-bold tracking-tight mt-6 first:mt-0 text-foreground">
          {inner}
        </h3>
      );
    }
    case "ul":
      return (
        <ul key={key} className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
          {block.items.map((it, j) => (
            <li key={j}>{renderInline(it, `${key}-${j}`)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="list-decimal space-y-1.5 pl-5 marker:text-muted-foreground">
          {block.items.map((it, j) => (
            <li key={j}>{renderInline(it, `${key}-${j}`)}</li>
          ))}
        </ol>
      );
    case "code":
      return <CodeBlock key={key} code={block.content} label="shell" />;
    case "p":
      return <p key={key}>{renderInline(block.text, key)}</p>;
  }
}

export function Markdown({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground/85">
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
}
