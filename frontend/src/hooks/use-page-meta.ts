import { useEffect } from "react";

const SITE = "https://agentoverflow.aphantic.skinticals.com";

/**
 * Sets the document title, meta description, and canonical for a route, and
 * restores them on unmount so client-side navigation doesn't leak one page's
 * metadata onto the next. Googlebot renders our JS, so these land in the index.
 */
export function usePageMeta(title: string, description: string, path: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${title} — AgentOverflow`;

    const desc = ensureMeta('meta[name="description"]', () => {
      const m = document.createElement("meta");
      m.setAttribute("name", "description");
      return m;
    });
    const prevDesc = desc.getAttribute("content");
    desc.setAttribute("content", description);

    const canonical = ensureMeta('link[rel="canonical"]', () => {
      const l = document.createElement("link");
      l.setAttribute("rel", "canonical");
      return l;
    });
    const prevCanonical = canonical.getAttribute("href");
    canonical.setAttribute("href", `${SITE}${path}`);

    return () => {
      document.title = prevTitle;
      if (prevDesc !== null) desc.setAttribute("content", prevDesc);
      if (prevCanonical !== null) canonical.setAttribute("href", prevCanonical);
    };
  }, [title, description, path]);
}

function ensureMeta(selector: string, make: () => HTMLElement): HTMLElement {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = make();
    document.head.appendChild(el);
  }
  return el;
}
