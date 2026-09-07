import { Component, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useQuery } from "convex/react";
import { getAnalyticsConfig } from "@/lib/thalamusApi";
import {
  fetchGeoVerdict,
  loadTags,
  readConsent,
  trackPageView,
  writeConsent,
} from "@/lib/analytics";

/**
 * GA4 / Tag Manager, loaded when an admin has set the IDs on the shared
 * Thalamus backend (the /admin Analytics tab there covers both products).
 *
 * Region decides the flow: outside the UK/EU/EEA the tags load on first paint
 * with nothing suppressed; inside it nothing loads until the visitor accepts.
 * So the banner never renders for most of the traffic — which matters here more
 * than anywhere, since these pages are fighting for a click at position 8.
 */
function AnalyticsInner() {
  const config = useQuery(getAnalyticsConfig, { site: "agentoverflow" });
  const [needsConsent, setNeedsConsent] = useState(false);
  const [ready, setReady] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!config) return;
    if (!config.ga4Id && !config.gtmId) return;
    let cancelled = false;

    void (async () => {
      const { consentRequired } = await fetchGeoVerdict();
      if (cancelled) return;
      if (!consentRequired) {
        loadTags(config);
        setReady(true);
        return;
      }
      const prior = readConsent();
      if (prior === "granted") {
        loadTags(config);
        setReady(true);
      } else if (prior === null) {
        setNeedsConsent(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config]);

  useEffect(() => {
    if (ready) trackPageView(location.pathname + location.search);
  }, [ready, location.pathname, location.search]);

  if (!needsConsent || !config) return null;

  const decide = (choice: "granted" | "denied") => {
    writeConsent(choice);
    setNeedsConsent(false);
    if (choice === "granted") {
      loadTags(config);
      setReady(true);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-border bg-card/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs leading-6 text-muted-foreground">
          We use Google Analytics to see which solutions people find useful. No ads, no profile
          building, and nothing loads until you choose. See our{" "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            privacy policy
          </a>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide("denied")}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Decline
          </button>
          <button
            onClick={() => decide("granted")}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

// Analytics must never be load-bearing. A Convex query that throws — the
// function not deployed yet, a schema mismatch, a backend outage — surfaces as
// a render-time throw from useQuery, and without this boundary it walked up past
// the router and blanked both sites. That happened: the frontend shipped a call
// to analytics:getAnalyticsConfig before the backend had the function. Here the
// worst case is no analytics.
class AnalyticsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[analytics] disabled after error:", err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Analytics() {
  return (
    <AnalyticsBoundary>
      <AnalyticsInner />
    </AnalyticsBoundary>
  );
}
