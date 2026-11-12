import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index';
import type { Env } from '../../worker/src/lib/env';
import { NEUTRAL_VOICE, resetVoiceCountsForTests, spokenText, VOICE_GROUPS, voiceIdFor } from '../../worker/src/routes/voice';

const KEY = 'test-key-not-real';
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

class FakeKv {
  data = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}

function post(body: unknown): Request {
  return new Request('https://x.test/api/npc/voice', { method: 'POST', body: JSON.stringify(body) });
}
function call(env: Env, body: unknown): Promise<Response> {
  return worker.fetch(post(body), env, ctx);
}
const ok = (extra: Record<string, unknown> = {}) => ({ sessionId: 's1', text: 'Howdy, stranger.', voiceKey: 'm-mid-0', ...extra });
const envWith = (extra: Partial<Env> = {}): Env => ({ ELEVENLABS_API_KEY: KEY, ANTHROPIC_API_KEY: 'a', TOWNS: new FakeKv() as unknown as KVNamespace, ...extra });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetVoiceCountsForTests();
  fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg', 'x-upstream-secret': 'nope' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('spokenText', () => {
  it('removes *stage directions* and stray asterisks', () => {
    expect(spokenText('*tips hat* Howdy there. *grins* Fine day.')).toBe('Howdy there. Fine day.');
    expect(spokenText('Hello *unfinished')).toBe('Hello unfinished');
    expect(spokenText('*only an action*')).toBe('');
  });
});

describe('voice table', () => {
  it('maps keys inside their group, wrapping the index', () => {
    expect(voiceIdFor('m-mid-0')).toBe('JBFqnCBsd6RMkjVDRZzb');
    expect(voiceIdFor('m-mid-5')).toBe('JBFqnCBsd6RMkjVDRZzb');
    expect(voiceIdFor('f-young-2')).toBe('FGY2WhTYpPnrIDTdsKH5');
    expect(voiceIdFor('m-old-7')).toBe('pqHfZKP75CvOlQylNhV4');
  });
  it('falls back to the neutral voice for anything unknown', () => {
    for (const k of ['', 'nonsense', 'f-old-1', 'x-mid-1', 'm-mid-', 'm-mid--1', undefined, 5, 'm-mid-1; drop']) {
      expect(voiceIdFor(k)).toBe(NEUTRAL_VOICE);
    }
  });
  it('lists 18 distinct premade voices', () => {
    const all = Object.values(VOICE_GROUPS).flat();
    expect(all).toHaveLength(18);
    expect(new Set(all).size).toBe(18);
  });
});

describe('POST /api/npc/voice', () => {
  it('returns 404 voice_off without a key and never calls out', async () => {
    const res = await call(envWith({ ELEVENLABS_API_KEY: undefined }), ok());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'voice_off' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates the body', async () => {
    const env = envWith();
    expect((await call(env, ok({ sessionId: 'bad id!' }))).status).toBe(400);
    expect((await call(env, ok({ sessionId: undefined }))).status).toBe(400);
    expect((await call(env, ok({ text: 5 }))).status).toBe(400);
    expect((await call(env, ok({ text: '   ' }))).status).toBe(400);
    expect((await call(env, ok({ text: '*only an action*' }))).status).toBe(400);
    expect((await call(env, ok({ text: 'a'.repeat(401) }))).status).toBe(400);
    expect((await call(env, [1, 2])).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await call(env, ok({ text: 'a'.repeat(400) }))).status).toBe(200);
  });

  it('streams audio/mpeg without leaking the key or upstream headers, and sends the documented request', async () => {
    const res = await call(envWith(), ok({ text: '*tips hat* Howdy, stranger.', voiceKey: 'f-young-1' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-upstream-secret')).toBeNull();
    expect([...res.headers.values()].join(' ')).not.toContain(KEY);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/cgSgspJ2msm6clMCkdW9/stream?output_format=mp3_44100_128');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'Howdy, stranger.',
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.45, similarity_boost: 0.8 },
    });
  });

  it('uses the neutral voice for an unknown key', async () => {
    await call(envWith(), ok({ voiceKey: 'whatever' }));
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain(`/${NEUTRAL_VOICE}/stream`);
  });

  it('answers 502 without upstream details when ElevenLabs fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"bad key"}', { status: 401, headers: { 'x-secret': 'z' } }));
    const res = await call(envWith(), ok());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('bad key');
    expect(text).not.toContain(KEY);
    expect(res.headers.get('x-secret')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect((await call(envWith(), ok({ sessionId: 's2' }))).status).toBe(502);
    expect(err.mock.calls.flat().join(' ')).not.toContain(KEY);
    err.mockRestore();
  });

  it('caps characters per session and answers 429 voice_budget past it', async () => {
    const env = envWith({ VOICE_SESSION_CHARS: '40' });
    const line = 'x'.repeat(15);
    expect((await call(env, ok({ text: line }))).status).toBe(200);
    expect((await call(env, ok({ text: line }))).status).toBe(200);
    const res = await call(env, ok({ text: line }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'voice_budget' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // another session is unaffected
    expect((await call(env, ok({ sessionId: 'other', text: line }))).status).toBe(200);
  });

  it('caps characters per day across sessions', async () => {
    const env = envWith({ VOICE_DAILY_CHARS: '30', VOICE_SESSION_CHARS: '1000' });
    const line = 'y'.repeat(20);
    expect((await call(env, ok({ sessionId: 'a', text: line }))).status).toBe(200);
    expect((await call(env, ok({ sessionId: 'b', text: line }))).status).toBe(429);
  });

  it('still enforces the cap when there is no key-value store', async () => {
    const env: Env = { ELEVENLABS_API_KEY: KEY, ANTHROPIC_API_KEY: 'a', VOICE_SESSION_CHARS: '20' };
    expect((await call(env, ok({ text: 'z'.repeat(15) }))).status).toBe(200);
    expect((await call(env, ok({ text: 'z'.repeat(15) }))).status).toBe(429);
  });

  it('counts the spoken text, not the stage directions', async () => {
    const env = envWith({ VOICE_SESSION_CHARS: '20' });
    const text = `*${'a'.repeat(300)}* Hi there.`;
    expect((await call(env, ok({ text }))).status).toBe(200);
    expect((await call(env, ok({ text }))).status).toBe(200);
  });
});

describe('GET /api/health voices flag', () => {
  const health = async (env: Env): Promise<Record<string, unknown>> =>
    (await worker.fetch(new Request('https://x.test/api/health'), env, ctx)).json() as Promise<Record<string, unknown>>;
  it('is true only with a key and not in mock mode', async () => {
    expect(await health({ ELEVENLABS_API_KEY: KEY, ANTHROPIC_API_KEY: 'a' })).toMatchObject({ voices: true, mock: false });
    expect(await health({ ANTHROPIC_API_KEY: 'a' })).toMatchObject({ voices: false });
    expect(await health({ ELEVENLABS_API_KEY: KEY, ANTHROPIC_API_KEY: 'a', MOCK: '1' })).toMatchObject({ voices: false, mock: true });
    expect(await health({ ELEVENLABS_API_KEY: KEY })).toMatchObject({ voices: false });
  });
});
