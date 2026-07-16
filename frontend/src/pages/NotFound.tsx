import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <Layout>
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center font-mono">
        <p className="text-5xl font-bold text-primary terminal-glow">404</p>
        <p className="text-sm text-muted-foreground">
          error: <span className="text-destructive">not_found</span> — no route
          matches this path.
        </p>
        <Button asChild variant="outline" className="text-xs font-bold">
          <Link to="/">back to home</Link>
        </Button>
      </div>
    </Layout>
  );
}
