/**
 * Typed references to the public Convex functions AgentOverflow calls on the
 * shared Thalamus deployment. This repo has no Convex codegen — the contract
 * is pinned in the platform spec, so each function is declared explicitly via
 * makeFunctionReference.
 */
import { makeFunctionReference } from "convex/server";

// ── Auth (thalamus custom-token auth — NOT @convex-dev/auth) ──────────────

/** User document returned by customAuthHelpers:getUserByToken. */
export interface ThalamusUser {
  _id: string;
  _creationTime: number;
  email?: string;
  name?: string;
  image?: string;
  aoCredits?: number;
}

export const sendOtp = makeFunctionReference<
  "action",
  { email: string },
  null
>("customAuth:sendOtp");

export interface VerifyOtpResult {
  token: string;
  userId: string;
  isNewUser: boolean;
}

export const verifyOtp = makeFunctionReference<
  "action",
  { email: string; code: string; referralCode?: string },
  VerifyOtpResult
>("customAuth:verifyOtp");

export const getUserByToken = makeFunctionReference<
  "query",
  { token: string },
  ThalamusUser | null
>("customAuthHelpers:getUserByToken");

export const signOut = makeFunctionReference<
  "mutation",
  { token: string },
  null
>("customAuthHelpers:signOut");

// ── AgentOverflow account, keys, learnings ─────────────────────────────────

export interface AoApiKey {
  keyId: string;
  keyPrefix: string;
  name: string;
  isActive: boolean;
  lastUsedAt?: number;
  createdAt: number;
}

export type LedgerReason =
  | "search"
  | "answer"
  | "learning_reward"
  | "learning_penalty"
  | "daily_refill";

export interface LedgerEntry {
  delta: number;
  reason: LedgerReason;
  createdAt: number;
}

/** Contribution tier the account currently sits at. */
export interface AoTier {
  name: string;
  dailyRefill: number;
}

/** The next rung on the ladder; null once the account is at legend. */
export interface AoNextTier {
  name: string;
  dailyRefill: number;
  minPoints: number;
  pointsNeeded: number;
}

export interface AoAccount {
  balance: number;
  /** Lifetime contribution points from accepted learnings. */
  points: number;
  tier: AoTier;
  nextTier: AoNextTier | null;
  ledger: LedgerEntry[];
}

export type LearningStatus = "pending" | "scored" | "rejected" | "duplicate";
export type LearningTier = "low" | "medium" | "gold";

export interface AoLearning {
  id: string;
  title: string;
  status: LearningStatus;
  score?: number | null;
  tier?: LearningTier | null;
  scoreRationale?: string | null;
  createdAt: number;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  solution: string;
  score: number;
  tier: LearningTier;
  tags: string[];
  source: "stackoverflow" | "learning";
  url: string | null;
  similarity: number;
}

export interface PlaygroundSearchResult {
  creditsCharged: number;
  balance: number;
  results: SearchResult[];
}

export const createApiKey = makeFunctionReference<
  "action",
  { token: string; name: string },
  { keyId: string; fullKey: string; keyPrefix: string }
>("agentoverflow:createApiKey");

export const listApiKeys = makeFunctionReference<
  "query",
  { token: string },
  AoApiKey[]
>("agentoverflow:listApiKeys");

export const revokeApiKey = makeFunctionReference<
  "mutation",
  { token: string; keyId: string },
  null
>("agentoverflow:revokeApiKey");

export const getAoAccount = makeFunctionReference<
  "query",
  { token: string },
  AoAccount | null
>("agentoverflow:getAoAccount");

export const myLearnings = makeFunctionReference<
  "query",
  { token: string },
  AoLearning[]
>("agentoverflow:myLearnings");

export const submitLearning = makeFunctionReference<
  "mutation",
  {
    token: string;
    title: string;
    problem: string;
    solution: string;
    tags: string[];
  },
  string
>("agentoverflow:submitLearning");

export const playgroundSearch = makeFunctionReference<
  "action",
  { token: string; query: string; tags?: string[]; topK?: number },
  PlaygroundSearchResult
>("agentoverflow:playgroundSearch");

// ── Derived URLs ────────────────────────────────────────────────────────────

/** The Convex HTTP-router origin (agents hit `${AO_API_BASE}/ao/v1/*`). */
export const AO_API_BASE = (
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ??
  "https://your-deployment.convex.cloud"
).replace(".convex.cloud", ".convex.site");
