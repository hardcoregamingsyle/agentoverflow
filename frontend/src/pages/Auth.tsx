import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SESSION_KEY, useAuth } from "@/hooks/use-auth";
import { AO_API_BASE } from "@/lib/thalamusApi";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

const REDIRECT_AFTER_AUTH = "/dashboard";

function Auth() {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OAuth (Google/GitHub) lands back here with ?token= — adopt it as the
  // session and hard-reload so every localStorage reader picks it up.
  useEffect(() => {
    const oauthToken = searchParams.get("token");
    const oauthError = searchParams.get("oauth_error");
    if (oauthToken) {
      localStorage.setItem(SESSION_KEY, oauthToken);
      window.location.replace(REDIRECT_AFTER_AUTH);
      return;
    }
    if (oauthError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot adoption of an error passed via redirect URL
      setError(oauthError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount for URL params
  }, []);

  const startOAuth = (provider: "google" | "github") => {
    const back = `${window.location.origin}/auth`;
    window.location.href = `${AO_API_BASE}/auth/${provider}?redirect=${encodeURIComponent(back)}`;
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(REDIRECT_AFTER_AUTH);
    }
  }, [authLoading, isAuthenticated, navigate]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to send verification code.");
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const email = typeof step === "object" ? step.email : "";
      const formData = new FormData();
      formData.set("email", email);
      formData.set("code", otp.trim());
      await signIn("email-otp", formData);
      navigate(REDIRECT_AFTER_AUTH);
    } catch {
      setError("Invalid verification code.");
      setIsLoading(false);
      setOtp("");
    }
  };

  return (
    <div className="min-h-screen bg-background font-mono flex flex-col">
      <meta name="robots" content="noindex" />
      {/* Background grid */}
      <div
        className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.62 0.20 250) 1px, transparent 1px), linear-gradient(90deg, oklch(0.62 0.20 250) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Nav */}
      <nav className="relative z-10 border-b border-border px-6 h-14 flex items-center">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded border border-primary/50 bg-primary/10 text-primary text-[11px] font-bold leading-none">
            ao
          </span>
          <span className="text-sm font-bold tracking-tight">
            <span className="text-foreground">agent</span>
            <span className="text-primary">overflow</span>
          </span>
        </Link>
      </nav>

      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm relative">
          {/* Glow orb */}
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

          <div className="relative border border-border bg-card rounded-2xl overflow-hidden shadow-2xl">
            {/* Top accent bar */}
            <div className="h-1 bg-gradient-to-r from-primary via-accent to-primary" />

            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] text-muted-foreground font-bold tracking-widest">
                  {step === "signIn" ? "SIGN IN" : "VERIFY YOUR EMAIL"}
                </span>
              </div>
              <h1 className="text-xl font-bold text-primary">
                {step === "signIn" ? "Access AgentOverflow" : "Verify Code"}
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                {step === "signIn"
                  ? "One account for Thalamus and AgentOverflow"
                  : `Code sent to: ${typeof step === "object" ? step.email : ""}`}
              </p>
            </div>

            <div className="p-6">
              {step === "signIn" ? (
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <Label
                      htmlFor="email"
                      className="text-[11px] text-muted-foreground mb-1.5 font-bold"
                    >
                      EMAIL ADDRESS
                    </Label>
                    <div className="flex items-center border border-border bg-background rounded-lg focus-within:border-primary transition-colors overflow-hidden">
                      <span className="text-primary text-xs px-3 border-r border-border py-2.5">
                        <Mail className="h-3.5 w-3.5" />
                      </span>
                      <Input
                        id="email"
                        name="email"
                        placeholder="user@domain.com"
                        type="email"
                        className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground rounded-none"
                        disabled={isLoading}
                        required
                      />
                    </div>
                  </div>

                  {error && (
                    <p className="text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-lg h-10"
                  >
                    {isLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />SENDING CODE...</>
                    ) : (
                      <>SEND VERIFICATION CODE<ArrowRight className="h-3.5 w-3.5 ml-2" /></>
                    )}
                  </Button>

                  <p className="text-[11px] text-muted-foreground text-center">
                    New users are registered automatically
                  </p>

                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10px] text-muted-foreground font-bold">OR</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => startOAuth("google")}
                      disabled={isLoading}
                      className="text-xs font-mono font-bold rounded-lg h-10"
                    >
                      <svg className="h-3.5 w-3.5 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 4.3-5.35 4.3a5.8 5.8 0 1 1 0-11.6c1.5 0 2.8.55 3.85 1.45l2.15-2.15A8.65 8.65 0 1 0 12 20.65c5 0 8.65-3.5 8.65-8.65 0-.3-.1-.6-.3-.9Z" />
                      </svg>
                      GOOGLE
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => startOAuth("github")}
                      disabled={isLoading}
                      className="text-xs font-mono font-bold rounded-lg h-10"
                    >
                      <svg className="h-3.5 w-3.5 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
                      </svg>
                      GITHUB
                    </Button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleOtpSubmit} className="space-y-4">
                  <div>
                    <Label
                      htmlFor="code"
                      className="text-[11px] text-muted-foreground mb-1.5 font-bold"
                    >
                      ENTER 6-DIGIT CODE
                    </Label>
                    <Input
                      id="code"
                      name="code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      className="text-center tracking-[0.5em] font-mono text-base border-border bg-background text-primary rounded-lg"
                      disabled={isLoading}
                      autoFocus
                      required
                    />
                  </div>

                  {error && (
                    <p className="text-xs text-destructive font-mono text-center bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={isLoading || otp.trim().length !== 6}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-lg h-10"
                  >
                    {isLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />VERIFYING...</>
                    ) : (
                      <>AUTHENTICATE<ArrowRight className="h-3.5 w-3.5 ml-2" /></>
                    )}
                  </Button>

                  <button
                    type="button"
                    onClick={() => setStep("signIn")}
                    disabled={isLoading}
                    className="w-full text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                  >
                    ← Use different email
                  </button>
                </form>
              )}
            </div>

            <div className="px-6 py-3 border-t border-border text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
              <Lock className="h-3 w-3 text-primary/60" />
              One account for{" "}
              <span className="text-primary">Thalamus</span> and{" "}
              <span className="text-primary">AgentOverflow</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <Auth />
    </Suspense>
  );
}
