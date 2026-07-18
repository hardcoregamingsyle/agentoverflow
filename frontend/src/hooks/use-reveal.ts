import { useEffect, useRef } from "react";

/**
 * Adds `is-visible` to an element the first time it scrolls into view, which
 * fires the CSS reveal transition (see .reveal / .reveal-stagger in index.css).
 * One-shot: once revealed it stops observing, so scrolling back up doesn't
 * re-trigger. Returns a ref to attach to the target element.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  options?: IntersectionObserverInit,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (old/headless): just show it.
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px", ...options },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [options]);

  return ref;
}
