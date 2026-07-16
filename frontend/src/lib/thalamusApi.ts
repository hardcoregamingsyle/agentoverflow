/**
 * Typed references to the public Convex functions AgentOverflow calls on the
 * shared Thalamus deployment. This repo has no Convex codegen — the contract
 * is pinned in the platform spec, so each function is declared explicitly via
 * makeFunctionReference.
 */
import { makeFunctionReference } from "convex/server";
import { CONVEX_URL } from "./convexUrl";

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

/** Daily-active-user ping; the layout fires it once per load for signed-in users. */
export const pingDau = makeFunctionReference<
  "mutation",
  { token: string },
  null
>("agentoverflow:pingDau");

// ── Admin (shared Thalamus admin token; see /admin) ────────────────────────

export const adminLogin = makeFunctionReference<
  "action",
  { password: string; answer1: string; answer2: string; answer3: string },
  { token: string }
>("admin:adminLogin");

export const verifyAdminToken = makeFunctionReference<
  "query",
  { token: string },
  boolean
>("admin:verifyAdminToken");

export interface AdminStats {
  learnings: {
    total: number;
    pending: number;
    scored: number;
    rejected: number;
    duplicate: number;
    byTier: { low: number; medium: number; gold: number };
  };
  keys: { total: number; active: number };
  users: { total: number; creditsInCirculation: number; totalPoints: number };
}

/** One day of platform usage; series is ordered oldest first. */
export interface AdminUsagePoint {
  date: string;
  dau: number;
  dauSite: number;
  dauApi: number;
  requests: number;
  creditsSpent: number;
}

export interface AdminLearning {
  id: string;
  title: string;
  status: LearningStatus;
  score: number | null;
  tier: LearningTier | null;
  scoreRationale: string | null;
  creditsDelta: number | null;
  userEmail: string;
  inCorpus: boolean;
  createdAt: number;
}

export interface AdminUser {
  userId: string;
  email: string;
  name: string | null;
  balance: number;
  points: number;
  tier: string;
  dailyRefill: number;
}

export interface CorpusHealth {
  ok: boolean;
  qdrant?: boolean;
  postgres?: boolean;
  points?: number;
  error?: string;
}

export const adminStats = makeFunctionReference<
  "query",
  { adminToken: string },
  AdminStats
>("agentoverflowAdmin:adminStats");

export const adminUsageSeries = makeFunctionReference<
  "query",
  { adminToken: string; days?: number },
  AdminUsagePoint[]
>("agentoverflowAdmin:adminUsageSeries");

export const adminLearnings = makeFunctionReference<
  "query",
  { adminToken: string; limit?: number },
  AdminLearning[]
>("agentoverflowAdmin:adminLearnings");

export const adminUsers = makeFunctionReference<
  "query",
  { adminToken: string },
  AdminUser[]
>("agentoverflowAdmin:adminUsers");

export const adjustCredits = makeFunctionReference<
  "action",
  { adminToken: string; userId: string; delta: number },
  { balance: number }
>("agentoverflowAdmin:adjustCredits");

export const adminCorpusHealth = makeFunctionReference<
  "action",
  { adminToken: string },
  CorpusHealth
>("agentoverflowAdmin:adminCorpusHealth");

export const deleteLearning = makeFunctionReference<
  "action",
  { adminToken: string; learningId: string },
  { ok: boolean }
>("agentoverflowAdmin:deleteLearning");

// ── Derived URLs ────────────────────────────────────────────────────────────

/** The Convex HTTP-router origin (agents hit `${AO_API_BASE}/ao/v1/*`). */
export const AO_API_BASE = CONVEX_URL.replace(".convex.cloud", ".convex.site");
