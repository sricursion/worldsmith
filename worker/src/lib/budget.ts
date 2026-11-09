// Daily output-token budgets: per session, per client IP and global. The arithmetic is pure;
// KV access is at the bottom.
import type { Env } from './env';

export const DAILY_TOKEN_BUDGET = 300_000;
export const DAILY_IP_BUDGET = 600_000;
export const DAILY_GLOBAL_BUDGET = 6_000_000;
const DAY_SECONDS = 86_400;

export interface BudgetRecord {
  used: number;
  /** Epoch seconds at which the counter resets. */
  resetAt: number;
}

export interface BudgetLimits {
  session: number;
  ip: number;
  global: number;
}

function limitFrom(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Ceilings from the BUDGET_* vars, falling back to the defaults on a missing or bad value. */
export function budgetLimits(env: Env): BudgetLimits {
  return {
    session: limitFrom(env.BUDGET_SESSION_TOKENS, DAILY_TOKEN_BUDGET),
    ip: limitFrom(env.BUDGET_IP_TOKENS, DAILY_IP_BUDGET),
    global: limitFrom(env.BUDGET_GLOBAL_TOKENS, DAILY_GLOBAL_BUDGET),
  };
}

/** Key part for an IP: IPv4 as is, IPv6 reduced to its /64 so a client cannot rotate the low bits. */
export function ipBudgetId(ip: string): string {
  const v = ip.trim().toLowerCase();
  if (!v.includes(':')) return v || 'local';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return mapped[1] ?? v;
  const [head = '', tail = ''] = v.split('::', 2);
  const hasGap = v.includes('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = hasGap && tail ? tail.split(':') : [];
  const fill = hasGap ? Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill('0') : [];
  const groups = [...headParts, ...fill, ...tailParts].slice(0, 4);
  while (groups.length < 4) groups.push('0');
  return groups.map((g) => g.padStart(4, '0')).join(':');
}

export function utcDate(nowSec: number): string {
  return new Date(nowSec * 1000).toISOString().slice(0, 10);
}

export function ipBudgetKey(ip: string, nowSec: number): string {
  return `budget:ip:${ipBudgetId(ip)}:${utcDate(nowSec)}`;
}

export function globalBudgetKey(nowSec: number): string {
  return `budget:global:${utcDate(nowSec)}`;
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

/** Day-keyed counters (ip, global) hold a bare integer and expire on their own. */
export async function loadCounter(env: Env, key: string): Promise<number | null> {
  if (!env.TOWNS) return null;
  try {
    const n = Number(await env.TOWNS.get(key));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return null;
  }
}

export async function addCounter(env: Env, key: string, tokens: number, nowSec: number): Promise<void> {
  if (!env.TOWNS || !Number.isFinite(tokens) || tokens <= 0) return;
  try {
    const cur = Number(await env.TOWNS.get(key));
    const next = (Number.isFinite(cur) && cur > 0 ? cur : 0) + Math.floor(tokens);
    await env.TOWNS.put(key, String(next), { expiration: nowSec + 2 * DAY_SECONDS });
  } catch {
    /* budget is best effort */
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
