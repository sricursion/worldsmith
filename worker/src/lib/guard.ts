// Abuse controls for the model routes: rate limit, Turnstile, per-session token budget.
import { isExhausted, loadBudget, recordUsage, type BudgetRecord } from './budget';
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

/** Verify a Turnstile token when TURNSTILE_SECRET is set. */
export async function checkTurnstile(req: Request, env: Env): Promise<Response | null> {
  if (!env.TURNSTILE_SECRET) return null;
  const token = req.headers.get('cf-turnstile-token');
  if (!token) return errorJson(403, 'turnstile_required', 'bad_request');
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET);
  form.set('response', token);
  form.set('remoteip', clientIp(req));
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = (await r.json()) as { success?: boolean };
    if (data.success === true) return null;
  } catch {
    return errorJson(503, 'turnstile_unavailable', 'upstream');
  }
  return errorJson(403, 'turnstile_failed', 'bad_request');
}

export interface EarlyGuardOptions {
  turnstile: boolean;
}

/** Runs before the body is read, so abusive clients cost almost nothing. */
export async function guardEarly(req: Request, env: Env, opts: EarlyGuardOptions): Promise<Response | null> {
  const rl = await checkRateLimit(req, env);
  if (rl) return rl;
  if (opts.turnstile) return checkTurnstile(req, env);
  return null;
}

export type BudgetGate = { ok: true; record: BudgetRecord | null } | { ok: false; res: Response };

/** 429 {error:'resting', reason:'resting'} once a session has spent its daily output tokens. */
export async function guardBudget(env: Env, sessionId: string): Promise<BudgetGate> {
  if (isMock(env)) return { ok: true, record: null };
  const record = await loadBudget(env, sessionId, Math.floor(Date.now() / 1000));
  if (record && isExhausted(record)) return { ok: false, res: errorJson(429, 'resting', 'resting') };
  return { ok: true, record };
}

export function chargeBudget(env: Env, sessionId: string, outputTokens: number): Promise<void> {
  return recordUsage(env, sessionId, outputTokens, Math.floor(Date.now() / 1000));
}

/** Compile has no sessionId in its body: take it from a header, else fall back to the IP. */
export function sessionFromRequest(req: Request): string {
  const h = req.headers.get('x-session-id');
  if (h && /^[A-Za-z0-9_-]{1,64}$/.test(h)) return h;
  return `ip-${clientIp(req)}`;
}
