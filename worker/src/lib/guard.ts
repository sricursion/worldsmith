// Abuse controls for the model routes: rate limit and daily token budgets (session, IP, global).
import {
  addCounter,
  budgetLimits,
  globalBudgetKey,
  ipBudgetKey,
  isExhausted,
  loadBudget,
  loadCounter,
  recordUsage,
  type BudgetRecord,
} from './budget';
import type { Env } from './env';
import { isMock } from './env';
import { errorJson } from './http';

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

/** Rate limit per IP. A missing binding or a binding error never blocks a request. */
export async function checkRateLimit(req: Request, env: Env): Promise<Response | null> {
  if (!env.RATE_LIMITER) return null;
  try {
    const { success } = await env.RATE_LIMITER.limit({ key: clientIp(req) });
    if (!success) return errorJson(429, 'rate_limited', 'rate_limited');
  } catch {
    /* binding unavailable: skip */
  }
  return null;
}

/** Runs before the body is read, so abusive clients cost almost nothing. */
export async function guardEarly(req: Request, env: Env): Promise<Response | null> {
  // No bot challenge here: the client has no widget to produce a token, so rate limits and budgets do the work.
  return checkRateLimit(req, env);
}

export type BudgetGate = { ok: true; record: BudgetRecord | null } | { ok: false; res: Response };

/** Who a request is charged to: the client-chosen session plus the IP, which the client cannot choose. */
export interface BudgetScope {
  session: string;
  ip: string;
}

export function budgetScope(req: Request, session: string): BudgetScope {
  return { session, ip: clientIp(req) };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** 429 {error:'resting', reason:'resting'} once the session, the IP or the whole site has spent its daily output tokens. */
export async function guardBudget(env: Env, scope: BudgetScope): Promise<BudgetGate> {
  if (isMock(env)) return { ok: true, record: null };
  const now = nowSec();
  const limits = budgetLimits(env);
  const [record, ip, global] = await Promise.all([
    loadBudget(env, scope.session, now),
    loadCounter(env, ipBudgetKey(scope.ip, now)),
    loadCounter(env, globalBudgetKey(now)),
  ]);
  const resting =
    (record && isExhausted(record, limits.session)) ||
    (ip !== null && ip >= limits.ip) ||
    (global !== null && global >= limits.global);
  if (resting) return { ok: false, res: errorJson(429, 'resting', 'resting') };
  return { ok: true, record };
}

export async function chargeBudget(env: Env, scope: BudgetScope, outputTokens: number): Promise<void> {
  const now = nowSec();
  await Promise.all([
    recordUsage(env, scope.session, outputTokens, now),
    addCounter(env, ipBudgetKey(scope.ip, now), outputTokens, now),
    addCounter(env, globalBudgetKey(now), outputTokens, now),
  ]);
}

/** Compile has no sessionId in its body: take it from a header, else fall back to the IP. */
export function sessionFromRequest(req: Request): string {
  const h = req.headers.get('x-session-id');
  if (h && /^[A-Za-z0-9_-]{1,64}$/.test(h)) return h;
  return `ip-${clientIp(req)}`;
}
