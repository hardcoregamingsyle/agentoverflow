import { Toaster } from "@/components/ui/sonner";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode, Component, lazy, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing"));
const Docs = lazy(() => import("./pages/Docs"));
const AuthPage = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Playground = lazy(() => import("./pages/Playground"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Without a boundary, a failed lazy-route chunk (typical after a deploy purges
// old hashed assets while a stale index.html is still cached) unmounts the
// whole tree. Chunk failures get one automatic reload before showing an error.
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    const isChunkError = /Failed to fetch dynamically imported module|Loading chunk|error loading dynamically imported/i.test(error.message);
    if (isChunkError && !sessionStorage.getItem("chunk-reload")) {
      sessionStorage.setItem("chunk-reload", "1");
      window.location.reload();
    } else {
      sessionStorage.removeItem("chunk-reload");
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-foreground font-semibold">Something went wrong loading this page.</p>
        <p className="text-muted-foreground text-sm">A new version may have been deployed.</p>
        <button
          onClick={() => { sessionStorage.removeItem("chunk-reload"); window.location.reload(); }}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
        >
          Reload
        </button>
      </div>
    );
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- app entry point; HMR component boundaries don't apply here
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground font-mono text-xs">loading...</div>
    </div>
  );
}

// A build without VITE_CONVEX_URL would otherwise throw before React mounts,
// leaving a silent blank page on every route. Fail loudly instead.
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

// eslint-disable-next-line react-refresh/only-export-components -- app entry point; HMR component boundaries don't apply here
function ConfigError() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d0d", color: "#e2e8f0", fontFamily: "system-ui", padding: 24, textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Deployment configuration error</h1>
        <p style={{ fontSize: 14, opacity: 0.7 }}>VITE_CONVEX_URL was not set when this build was produced.<br />Set it in the build environment and redeploy.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  !convex ? <ConfigError /> :
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <RouteErrorBoundary>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/playground" element={<Playground />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
      <Toaster />
    </ConvexProvider>
  </StrictMode>,
);
