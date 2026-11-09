// Per-session daily output-token budget. The arithmetic is pure; KV access is at the bottom.
import type { Env } from './env';

export const DAILY_TOKEN_BUDGET = 300_000;
const DAY_SECONDS = 86_400;

export interface BudgetRecord {
  used: number;
  /** Epoch seconds at which the counter resets. */
  resetAt: number;
}

export function budgetKey(sessionId: string): string {
  return `budget:${sessionId}`;
}

export function freshBudget(nowSec: number): BudgetRecord {
  return { used: 0, resetAt: nowSec + DAY_SECONDS };
}

/** Parse a stored record; anything missing, malformed or expired becomes a fresh day. */
export function parseBudget(raw: string | null, nowSec: number): BudgetRecord {
  if (!raw) return freshBudget(nowSec);
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      if (typeof o.used === 'number' && typeof o.resetAt === 'number' && o.used >= 0 && o.resetAt > nowSec) {
        return { used: o.used, resetAt: o.resetAt };
      }
    }
  } catch {
    /* fall through */
  }
  return freshBudget(nowSec);
}

export function isExhausted(rec: BudgetRecord, limit = DAILY_TOKEN_BUDGET): boolean {
  return rec.used >= limit;
}

export function addUsage(rec: BudgetRecord, tokens: number): BudgetRecord {
  const add = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0;
  return { used: rec.used + add, resetAt: rec.resetAt };
}

export function remaining(rec: BudgetRecord, limit = DAILY_TOKEN_BUDGET): number {
  return Math.max(0, limit - rec.used);
}

// KV is eventually consistent and has no atomic increment, so the budget is a soft cap: two
// concurrent requests can both pass the check. That is acceptable for abuse control.

export async function loadBudget(env: Env, sessionId: string, nowSec: number): Promise<BudgetRecord | null> {
  if (!env.TOWNS) return null;
  try {
    return parseBudget(await env.TOWNS.get(budgetKey(sessionId)), nowSec);
  } catch {
    return null;
  }
}

export async function recordUsage(env: Env, sessionId: string, tokens: number, nowSec: number): Promise<void> {
  if (!env.TOWNS || tokens <= 0) return;
  try {
    const cur = parseBudget(await env.TOWNS.get(budgetKey(sessionId)), nowSec);
    const next = addUsage(cur, tokens);
    await env.TOWNS.put(budgetKey(sessionId), JSON.stringify(next), {
      expiration: Math.max(next.resetAt, nowSec + 60),
    });
  } catch {
    /* budget is best effort */
  }
}
