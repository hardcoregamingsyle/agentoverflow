import * as thalamus from "@/lib/thalamusApi";
import { useQuery, useMutation, useAction } from "convex/react";
import { useState, useEffect } from "react";

export const SESSION_KEY = "agentoverflow_session_token";

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SESSION_KEY);
    }
    return null;
  });

  const user = useQuery(
    thalamus.getUserByToken,
    token && token.length >= 32 ? { token } : "skip"
  );

  const signOutMutation = useMutation(thalamus.signOut);
  const sendOtpAction = useAction(thalamus.sendOtp);
  const verifyOtpAction = useAction(thalamus.verifyOtp);

  const isLoading = token !== null && user === undefined;
  const isAuthenticated = !!user;

  const signIn = async (provider: string, formData: FormData) => {
    if (provider === "email-otp") {
      const email = formData.get("email") as string;
      const code = formData.get("code") as string | null;

      if (!code) {
        await sendOtpAction({ email });
        return { started: true };
      } else {
        const result = await verifyOtpAction({ email, code });
        localStorage.setItem(SESSION_KEY, result.token);
        setToken(result.token);
        return result;
      }
    }
    throw new Error("Unknown provider");
  };

  const signOut = async () => {
    if (token) {
      try {
        await signOutMutation({ token });
      } catch {
        // token may already be dead server-side; local sign-out proceeds anyway
      }
    }
    localStorage.removeItem(SESSION_KEY);
    setToken(null);
  };

  // cross-tab sync: signing in/out in one tab updates every other tab
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) {
        setToken(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
    token,
  };
}
