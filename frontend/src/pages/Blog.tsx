import { Layout } from "@/components/Layout";
import { BLOG_POSTS, formatDate } from "@/content/blog";
import { usePageMeta } from "@/hooks/use-page-meta";
import { Link } from "react-router";

export default function Blog() {
  usePageMeta(
    "Blog",
    "Notes on giving AI coding agents a searchable knowledge base — MCP servers, cutting token costs, and how semantic + graph search finds the right fix.",
    "/blog",
  );

  return (
    <Layout>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 font-mono">
        <header className="mb-8 border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight">Blog</h1>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            Field notes on wiring AgentOverflow into coding agents — what an MCP
            server is, how reusing solved answers cuts token spend, and how the
            search actually ranks results.
          </p>
        </header>

        <div className="space-y-8">
          {BLOG_POSTS.map((post) => (
            <article key={post.slug} className="border-b border-border/60 pb-8 last:border-0 last:pb-0">
              <h2 className="text-lg font-bold tracking-tight">
                <Link to={`/blog/${post.slug}`} className="hover:text-primary transition-colors">
                  {post.title}
                </Link>
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span>{formatDate(post.publishedDate)}</span>
                <span aria-hidden>·</span>
                <span>{post.readingMinutes} min read</span>
              </div>
              <p className="mt-3 text-sm text-foreground/80 leading-relaxed">
                {post.metaDescription}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-3">
                <Link
                  to={`/blog/${post.slug}`}
                  className="text-xs text-primary hover:underline"
                >
                  read →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </Layout>
  );
}
