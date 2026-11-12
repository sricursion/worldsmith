// Vercel entry point. The API is written as a fetch handler with a small set of bindings; this file
// supplies those bindings on Vercel's Edge runtime and forwards every /api/* request to it.
//
// vercel.json rewrites /api/<anything> to /api?p=<anything>, so one function serves the whole API.
import worker from '../worker/src/index';
import type { Env } from '../worker/src/lib/env';

export const config = { runtime: 'edge' };

interface Entry { value: string | ArrayBuffer; expires: number }

/**
 * Per-instance key-value store with expiry. It backs the spend counters, which only need to hold for
 * the life of an instance. It is not durable, so the routes that need durable storage (saved share
 * links, generated landmark files) are answered before they reach it.
 */
function memoryStore(): NonNullable<Env['TOWNS']> {
  const data = new Map<string, Entry>();
  const live = (key: string): Entry | null => {
    const e = data.get(key);
    if (!e) return null;
    if (e.expires > 0 && e.expires < Date.now() / 1000) {
      data.delete(key);
      return null;
    }
    return e;
  };
  const store = {
    async get(key: string, type?: unknown): Promise<unknown> {
      const e = live(key);
      if (!e) return null;
      const wantBytes = type === 'arrayBuffer' || (typeof type === 'object' && type !== null && (type as { type?: string }).type === 'arrayBuffer');
      if (wantBytes) return typeof e.value === 'string' ? new TextEncoder().encode(e.value).buffer : e.value;
      return typeof e.value === 'string' ? e.value : new TextDecoder().decode(e.value);
    },
    async put(key: string, value: string | ArrayBuffer, opts?: { expiration?: number; expirationTtl?: number }): Promise<void> {
      if (data.size > 5000) data.clear(); // counters only; never let an instance grow without bound
      const expires = opts?.expiration ?? (opts?.expirationTtl ? Date.now() / 1000 + opts.expirationTtl : 0);
      data.set(key, { value, expires });
    },
    async delete(key: string): Promise<void> {
      data.delete(key);
    },
  };
  return store as unknown as NonNullable<Env['TOWNS']>;
}

const TOWNS = memoryStore();

function readEnv(): Env {
  const e = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return {
    ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY ?? e.ANTHROPIC_API,
    ANTHROPIC_BASE_URL: e.ANTHROPIC_BASE_URL,
    GROQ_API_KEY: e.GROQ_API_KEY,
    TYPESAFE_API_KEY: e.TYPESAFE_API_KEY,
    BUDGET_SESSION_TOKENS: e.BUDGET_SESSION_TOKENS,
    BUDGET_IP_TOKENS: e.BUDGET_IP_TOKENS,
    BUDGET_GLOBAL_TOKENS: e.BUDGET_GLOBAL_TOKENS,
    ELEVENLABS_API_KEY: e.ELEVENLABS_API_KEY,
    VOICE_DAILY_CHARS: e.VOICE_DAILY_CHARS,
    VOICE_SESSION_CHARS: e.VOICE_SESSION_CHARS,
    MOCK: e.MOCK,
    TOWNS,
  };
}

/** Rebuilds the original /api/... URL from the rewrite's ?p= parameter. */
export function originalUrl(raw: string): URL {
  const url = new URL(raw);
  const p = url.searchParams.get('p');
  if (p !== null && (url.pathname === '/api' || url.pathname === '/api/' || url.pathname === '/api/index')) {
    url.searchParams.delete('p');
    url.pathname = `/api/${p.replace(/^\/+/, '')}`;
  }
  return url;
}

const noStore = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async function handler(req: Request, context?: { waitUntil?(p: Promise<unknown>): void }): Promise<Response> {
  const url = originalUrl(req.url);
  // No durable store here: the client keeps the whole world in the link instead of a short id.
  if (url.pathname === '/api/share') return noStore(503, { error: 'unavailable', reason: 'upstream' });
  if (url.pathname.startsWith('/api/load/')) return noStore(404, { error: 'not_found' });

  const forwarded = new Request(url.toString(), req);
  const ctx = {
    waitUntil(p: Promise<unknown>): void {
      if (context?.waitUntil) context.waitUntil(p);
      else void p.catch(() => undefined);
    },
    passThroughOnException(): void {},
  };
  return worker.fetch(forwarded as never, readEnv(), ctx as never);
}
