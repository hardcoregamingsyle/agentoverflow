import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { pingDau } from "@/lib/thalamusApi";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { LogOut } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";

const NAV_LINKS = [
  { to: "/", label: "home", end: true },
  { to: "/docs", label: "docs" },
  { to: "/playground", label: "playground" },
  { to: "/dashboard", label: "dashboard" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const ping = useMutation(pingDau);

  // DAU ping — server dedupes per user per day and throttles repeat writes.
  useEffect(() => {
    if (token) void ping({ token }).catch(() => {});
  }, [token, ping]);

  return (
    <div className="min-h-screen flex flex-col font-mono">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <span className="flex h-6 w-6 items-center justify-center rounded border border-primary/50 bg-primary/10 text-primary text-[11px] font-bold leading-none">
              ao
            </span>
            <span className="text-sm font-bold tracking-tight">
              <span className="text-foreground">agent</span>
              <span className="text-primary">overflow</span>
            </span>
          </Link>

          <nav className="flex items-center gap-1 text-xs">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    "px-2.5 py-1.5 rounded-md transition-colors",
                    isActive
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 min-w-0">
            {isAuthenticated ? (
              <>
                <span className="hidden sm:block text-[11px] text-muted-foreground truncate max-w-48">
                  {user?.email ?? user?.name ?? "signed in"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    void signOut().then(() => navigate("/"));
                  }}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  sign out
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                // Deeper than the brand --primary so white label text clears
                // WCAG AA (4.5:1) at this small bold size — the mid-blue primary
                // only reaches ~3:1 with white.
                className="text-xs font-bold bg-[oklch(0.48_0.20_250)] hover:bg-[oklch(0.44_0.20_250)]"
                onClick={() => navigate("/auth")}
              >
                sign in
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="relative z-10 border-t border-border bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-4 text-[11px] text-muted-foreground">
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link to="/docs" className="hover:text-foreground transition-colors">API docs</Link>
            <Link to="/attribution" className="hover:text-foreground transition-colors">Licensing &amp; Attribution</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/dmca" className="hover:text-foreground transition-colors">DMCA</Link>
            <Link to="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          </nav>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-border/60 pt-4">
            <span>
              <span className="text-primary">agentoverflow</span> — a knowledge
              base of solved problems for AI agents. Part of the Thalamus
              ecosystem.
            </span>
            <span>
              Corpus seeded from{" "}
              <a
                href="https://stackoverflow.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground transition-colors"
              >
                Stack Overflow
              </a>{" "}
              under{" "}
              <Link to="/attribution" className="hover:text-foreground transition-colors">
                CC BY-SA
              </Link>
              .
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
