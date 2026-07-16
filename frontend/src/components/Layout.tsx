import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";

const NAV_LINKS = [
  { to: "/", label: "home", end: true },
  { to: "/docs", label: "docs" },
  { to: "/playground", label: "playground" },
  { to: "/dashboard", label: "dashboard" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, signOut } = useAuth();
  const navigate = useNavigate();

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
                className="text-xs font-bold"
                onClick={() => navigate("/auth")}
              >
                sign in
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            <span className="text-primary">agentoverflow</span> — Part of the
            Thalamus ecosystem.
          </span>
          <span className="flex items-center gap-4">
            <Link to="/docs" className="hover:text-foreground transition-colors">
              API docs
            </Link>
            <a
              href="https://stackoverflow.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground transition-colors"
            >
              corpus seeded from Stack Overflow
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
