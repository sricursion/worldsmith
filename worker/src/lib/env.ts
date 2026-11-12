// Worker bindings and secrets. Every binding is optional so the Worker degrades gracefully
// (mock mode, no rate limiting, no KV) when running locally with no credentials.

export interface Env {
  ANTHROPIC_API_KEY?: string;
  /** Optional gateway origin for model calls; requests go to <base>/v1/messages. Default https://api.anthropic.com. */
  ANTHROPIC_BASE_URL?: string;
  GROQ_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
  /** Daily output-token ceilings; wrangler vars, strings. See budget.ts for defaults. */
  BUDGET_SESSION_TOKENS?: string;
  BUDGET_IP_TOKENS?: string;
  BUDGET_GLOBAL_TOKENS?: string;
  /** ElevenLabs text-to-speech key. Without it /api/npc/voice answers 404 voice_off. */
  ELEVENLABS_API_KEY?: string;
  /** Daily and per-session character caps for NPC voice; strings. Defaults live in routes/voice.ts. */
  VOICE_DAILY_CHARS?: string;
  VOICE_SESSION_CHARS?: string;
  MOCK?: string;
  TOWNS?: KVNamespace;
  AI?: Ai;
  RATE_LIMITER?: RateLimit;
}

/** True when the Worker should answer from fixtures instead of calling a model. */
export function isMock(env: Env): boolean {
  return env.MOCK === '1' || !env.ANTHROPIC_API_KEY;
}
