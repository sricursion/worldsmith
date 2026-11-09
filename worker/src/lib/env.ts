// Worker bindings and secrets. Every binding is optional so the Worker degrades gracefully
// (mock mode, no rate limiting, no KV) when running locally with no credentials.

export interface Env {
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  MOCK?: string;
  TOWNS?: KVNamespace;
  AI?: Ai;
  RATE_LIMITER?: RateLimit;
}

/** True when the Worker should answer from fixtures instead of calling a model. */
export function isMock(env: Env): boolean {
  return env.MOCK === '1' || !env.ANTHROPIC_API_KEY;
}
