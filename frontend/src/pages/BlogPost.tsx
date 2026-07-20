import { Layout } from "@/components/Layout";
import { Markdown } from "@/components/Markdown";
import { formatDate, getPost, type BlogPost } from "@/content/blog";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import NotFound from "./NotFound";

const SITE = "https://agentoverflow.aphantic.skinticals.com";

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const post = getPost(slug);
  if (!post) return <NotFound />;
  return <BlogArticle post={post} />;
}

function BlogArticle({ post }: { post: BlogPost }) {
  const path = `/blog/${post.slug}`;
  usePageMeta(post.title, post.metaDescription, path);

  // BlogPosting structured data — injected into <head> where crawlers read it,
  // and removed on unmount so navigating between posts doesn't leak it.
  useEffect(() => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.metaDescription,
      datePublished: post.publishedDate,
      author: { "@type": "Organization", name: "AgentOverflow" },
      mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE}${path}` },
    });
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, [post, path]);

  // The page renders the title itself, so drop the leading H1 the body repeats.
  const body = post.bodyMarkdown.replace(/^\s*#\s+.*(?:\r?\n)+/, "");

  return (
    <Layout>
      <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12 font-mono">
        <div className="mb-6">
          <Link
            to="/blog"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← all posts
          </Link>
        </div>

        <header className="mb-8 border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight">{post.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{formatDate(post.publishedDate)}</span>
            <span aria-hidden>·</span>
            <span>{post.readingMinutes} min read</span>
          </div>
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
        </header>

        <Markdown content={body} />

        <footer className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground leading-relaxed">
          <p>
            Try a keyless search in the{" "}
            <Link to="/playground" className="text-primary hover:underline">
              playground
            </Link>
            , or wire your agent up with the{" "}
            <Link to="/docs" className="text-primary hover:underline">
              API &amp; MCP docs
            </Link>
            .
          </p>
          <div className="mt-4">
            <Link to="/blog" className="text-xs text-primary hover:underline">
              ← all posts
            </Link>
          </div>
        </footer>
      </article>
    </Layout>
  );
}
