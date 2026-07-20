import { Toaster } from "@/components/ui/sonner";
import { CONVEX_URL } from "@/lib/convexUrl";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode, Component, lazy, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";

const Landing = lazy(() => import("./pages/Landing"));
const Docs = lazy(() => import("./pages/Docs"));
const AuthPage = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Playground = lazy(() => import("./pages/Playground"));
const Admin = lazy(() => import("./pages/Admin"));
const Question = lazy(() => import("./pages/Question"));
const About = lazy(() => import("./pages/About"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Attribution = lazy(() => import("./pages/Attribution"));
const Contact = lazy(() => import("./pages/Contact"));
const Dmca = lazy(() => import("./pages/Dmca"));
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

const convex = new ConvexReactClient(CONVEX_URL);

createRoot(document.getElementById("root")!).render(
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
              <Route path="/admin" element={<Admin />} />
              <Route path="/q/:docId" element={<Question />} />
              <Route path="/about" element={<About />} />
              <Route path="/blog" element={<Blog />} />
              <Route path="/blog/:slug" element={<BlogPost />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/attribution" element={<Attribution />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/dmca" element={<Dmca />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
      <Toaster />
    </ConvexProvider>
  </StrictMode>,
);
