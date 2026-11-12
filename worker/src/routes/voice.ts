// POST /api/npc/voice: one spoken line as MP3 from ElevenLabs, streamed straight through.
// Body {sessionId, text, voiceKey}. 404 voice_off without a key, 429 voice_budget past the character caps,
// 502 when ElevenLabs fails. The key and the upstream headers never reach the client or the logs.
import type { Env } from '../lib/env';
import { addCounter, loadCounter, utcDate } from '../lib/budget';
import { clientIp, guardEarly } from '../lib/guard';
import { errorJson, isRecord, readJson } from '../lib/http';

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_flash_v2_5';
const MAX_SPOKEN = 400;
const MAX_RAW = 2000;
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const DEFAULT_VOICE_DAILY_CHARS = 20_000;
export const DEFAULT_VOICE_SESSION_CHARS = 2_500;

/** Premade ElevenLabs voices. A voiceKey is "<m|f>-<age>-<n>"; n picks within the group, wrapping. */
export const VOICE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  'm-mid': ['JBFqnCBsd6RMkjVDRZzb', 'cjVigY5qzO86Huf0OWal', 'nPczCjzI2devNBz1zQrb', 'onwK4e9ZLuTAKqWW03F9', 'iP95p4xoKVk53GoZ742B'],
  'm-young': ['bIHbv24MWmeRgasZH58o', 'TX3LPaxmHKxFdv7VOQHJ', 'IKne3meq5aSn9XLyUdCD'],
  'm-old': ['pqHfZKP75CvOlQylNhV4'],
  'm-rough': ['N2lVS1w4EtoT3dr4eOWO', 'SOYHLrjzK2X1ezoPC6cr'],
  'f-young': ['EXAVITQu4vr4xnSDxMaL', 'cgSgspJ2msm6clMCkdW9', 'FGY2WhTYpPnrIDTdsKH5'],
  'f-mid': ['Xb7hH8MSUJpSbSDYk0k2', 'XrExE9yKIg1WjnnlVkGX', 'pFZP5JQG7iQjIQuC4Bku', 'hpp4J3VqNfWAUOO0d1Us'],
};
export const NEUTRAL_VOICE = 'SAz9YHcvj6GT2YYXdXww';

const KEY_RE = /^([mf]-(?:mid|young|old|rough))-(\d{1,6})$/;

/** Voice id for a key; anything unknown (or a group that does not exist) gets the neutral voice. */
export function voiceIdFor(voiceKey: unknown): string {
  if (typeof voiceKey !== 'string') return NEUTRAL_VOICE;
  const m = KEY_RE.exec(voiceKey);
  const group = m ? VOICE_GROUPS[m[1] ?? ''] : undefined;
  if (!m || !group || group.length === 0) return NEUTRAL_VOICE;
  return group[Number(m[2]) % group.length] ?? NEUTRAL_VOICE;
}

/** Drops *stage directions*, stray asterisks and runs of whitespace; what is left is what gets spoken. */
export function spokenText(raw: string): string {
  return raw.replace(/\*[^*]*\*/g, ' ').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
}

function limitFrom(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function voiceLimits(env: Env): { daily: number; session: number } {
  return {
    daily: limitFrom(env.VOICE_DAILY_CHARS, DEFAULT_VOICE_DAILY_CHARS),
    session: limitFrom(env.VOICE_SESSION_CHARS, DEFAULT_VOICE_SESSION_CHARS),
  };
}

// Always kept alongside the key-value store: it is the only counter when there is no store, and it covers
// a store read that fails. It is per instance and in memory.
const localCounts = new Map<string, number>();

async function readCount(env: Env, key: string): Promise<number> {
  const local = localCounts.get(key) ?? 0;
  const stored = await loadCounter(env, key);
  return Math.max(local, stored ?? 0);
}

async function addCount(env: Env, key: string, chars: number, nowSec: number): Promise<void> {
  if (localCounts.size > 2000) localCounts.clear();
  localCounts.set(key, (localCounts.get(key) ?? 0) + chars);
  await addCounter(env, key, chars, nowSec);
}

export function resetVoiceCountsForTests(): void {
  localCounts.clear();
}

export async function handleNpcVoice(request: Request, env: Env): Promise<Response> {
  if (!env.ELEVENLABS_API_KEY) return errorJson(404, 'voice_off');
  const early = await guardEarly(request, env);
  if (early) return early;
  const body = await readJson(request, 8_192);
  if (!body.ok) return body.res;
  const b = body.value;
  if (!isRecord(b)) return errorJson(400, 'body must be an object', 'bad_request');
  if (typeof b.sessionId !== 'string' || !SESSION_RE.test(b.sessionId)) return errorJson(400, 'sessionId invalid', 'bad_request');
  if (typeof b.text !== 'string' || b.text.length > MAX_RAW) return errorJson(400, 'text must be 1 to 400 characters', 'bad_request');
  const text = spokenText(b.text);
  if (text.length < 1 || text.length > MAX_SPOKEN) return errorJson(400, 'text must be 1 to 400 characters', 'bad_request');
  const voiceKey = typeof b.voiceKey === 'string' ? b.voiceKey.slice(0, 32) : '';

  // Reserve the characters before calling out, so concurrent requests cannot all slip under the cap.
  const now = Math.floor(Date.now() / 1000);
  const day = utcDate(now);
  const limits = voiceLimits(env);
  const sessionKey = `voice:session:${b.sessionId}:${day}`;
  const ipKey = `voice:ip:${clientIp(request)}:${day}`;
  const globalKey = `voice:global:${day}`;
  const [session, ip, global] = await Promise.all([readCount(env, sessionKey), readCount(env, ipKey), readCount(env, globalKey)]);
  // A client picks its own sessionId, so the same per-session allowance also bounds each IP (times four, for shared networks).
  if (session + text.length > limits.session || ip + text.length > limits.session * 4 || global + text.length > limits.daily) {
    return errorJson(429, 'voice_budget');
  }
  await Promise.all([addCount(env, sessionKey, text.length, now), addCount(env, ipKey, text.length, now), addCount(env, globalKey, text.length, now)]);

  let upstream: Response;
  try {
    upstream = await fetch(`${TTS_URL}/${voiceIdFor(voiceKey)}/stream?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: { stability: 0.45, similarity_boost: 0.8 } }),
    });
  } catch {
    return errorJson(502, 'voice_upstream', 'upstream');
  }
  if (!upstream.ok || !upstream.body) {
    console.error(`[voice] elevenlabs status ${upstream.status}`);
    await upstream.body?.cancel().catch(() => undefined);
    return errorJson(502, 'voice_upstream', 'upstream');
  }
  return new Response(upstream.body, { status: 200, headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
}
