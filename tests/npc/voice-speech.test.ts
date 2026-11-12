import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeech, voiceKeyFor } from '../../app/src/npc/speech';

const g = globalThis as Record<string, unknown>;
const flush = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  delete g['window'];
  delete g['SpeechSynthesisUtterance'];
  delete g['Audio'];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('voiceKeyFor', () => {
  const mid = { pitch: 1, rate: 1 };
  it('is stable per id and differs across ids', () => {
    const a = voiceKeyFor({ id: 'npc_one', role: 'baker' }, mid);
    expect(voiceKeyFor({ id: 'npc_one', role: 'baker' }, mid)).toBe(a);
    const keys = new Set(Array.from({ length: 30 }, (_, i) => voiceKeyFor({ id: `npc_${i}`, role: 'baker' }, { pitch: 0.8, rate: 1 })));
    expect(keys.size).toBeGreaterThan(5);
  });
  it('leans on pitch for the sex', () => {
    expect(voiceKeyFor({ id: 'a' }, { pitch: 1.3, rate: 1 })).toMatch(/^f-/);
    expect(voiceKeyFor({ id: 'a' }, { pitch: 0.7, rate: 1 })).toMatch(/^m-/);
  });
  it('reads age and roughness from role and persona', () => {
    expect(voiceKeyFor({ id: 'a', role: 'retired lighthouse keeper' }, { pitch: 0.8, rate: 1 })).toMatch(/^m-old-/);
    expect(voiceKeyFor({ id: 'a', role: 'drifter' }, { pitch: 0.8, rate: 1 })).toMatch(/^m-rough-/);
    expect(voiceKeyFor({ id: 'a', role: 'stable boy' }, { pitch: 0.8, rate: 1 })).toMatch(/^m-young-/);
    expect(voiceKeyFor({ id: 'a', persona: 'A young apprentice.' }, { pitch: 1.4, rate: 1 })).toMatch(/^f-young-/);
    // no old or rough voices exist for women: they land in the middle group
    expect(voiceKeyFor({ id: 'a', role: 'elder' }, { pitch: 1.4, rate: 1 })).toMatch(/^f-mid-/);
    expect(voiceKeyFor({ id: 'a', role: 'baker' }, { pitch: 0.8, rate: 1 })).toMatch(/^m-mid-/);
  });
});

interface Harness {
  fetchMock: ReturnType<typeof vi.fn>;
  spoken: string[];
  played: string[];
  cancelled: () => number;
  signals: AbortSignal[];
}

function setup(opts: { voices?: boolean; voiceStatus?: number; hang?: boolean }): Harness {
  const spoken: string[] = [];
  const played: string[] = [];
  const signals: AbortSignal[] = [];
  let cancelled = 0;
  g['SpeechSynthesisUtterance'] = class {
    pitch = 1;
    rate = 1;
    volume = 1;
    voice: unknown = null;
    lang = '';
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  };
  g['window'] = {
    speechSynthesis: {
      getVoices: () => [{ name: 'A', lang: 'en-US' }],
      speak: (u: { text: string; onend: (() => void) | null }) => {
        spoken.push(u.text);
        queueMicrotask(() => u.onend?.());
      },
      cancel: () => {
        cancelled++;
      },
    },
  };
  g['Audio'] = class {
    volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) {}
    play(): Promise<void> {
      played.push(this.src);
      queueMicrotask(() => this.onended?.());
      return Promise.resolve();
    }
    pause(): void {}
  };
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => `blob:${(b as Blob).size}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, mock: false, voices: opts.voices ?? true }), { status: 200 });
    if (init?.signal) signals.push(init.signal);
    if (opts.hang) {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    const status = opts.voiceStatus ?? 200;
    return status === 200 ? new Response(new Uint8Array([7, 7, 7, 7]), { status }) : new Response('{}', { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, spoken, played, cancelled: () => cancelled, signals };
}

const who = { id: 'npc_1', role: 'baker' };
const voice = { pitch: 1, rate: 1 };
const voiceCalls = (h: Harness): number => h.fetchMock.mock.calls.filter((c) => !(c[0] as string).endsWith('/health')).length;

describe('server voices', () => {
  it('requests each sentence in order with the session, plays them and skips the browser voice', async () => {
    const h = setup({});
    const s = createSpeech({ sessionId: 'sess-1' });
    await tick();
    expect(s.enabled).toBe(true);
    s.speak('One. Two!', voice, 'Cole', who);
    await tick(5);
    const bodies = h.fetchMock.mock.calls.filter((c) => !(c[0] as string).endsWith('/health')).map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies.map((b) => b.text)).toEqual(['One.', 'Two!']);
    expect(bodies[0]).toMatchObject({ sessionId: 'sess-1', voiceKey: voiceKeyFor(who, voice) });
    expect(h.played).toEqual(['blob:4', 'blob:4']);
    expect(h.spoken).toEqual([]);
  });

  it('uses the browser voice when health says voices are off', async () => {
    const h = setup({ voices: false });
    const s = createSpeech({ sessionId: 's' });
    await tick();
    s.speak('One. Two!', voice, 'Cole', who);
    expect(h.spoken).toEqual(['One.', 'Two!']);
    expect(voiceCalls(h)).toBe(0);
  });

  it('uses the browser voice when the health check fails', async () => {
    const h = setup({});
    h.fetchMock.mockRejectedValue(new Error('down'));
    const s = createSpeech({ sessionId: 's' });
    await tick();
    s.speak('Hello.', voice, 'Cole', who);
    expect(h.spoken).toEqual(['Hello.']);
  });

  it('falls back to the browser voice on a server error but keeps trying server voices', async () => {
    const h = setup({ voiceStatus: 502 });
    const s = createSpeech({ sessionId: 's' });
    await tick();
    s.speak('Hello.', voice, 'Cole', who);
    await tick(5);
    expect(h.spoken).toEqual(['Hello.']);
    s.speak('Again.', voice, 'Cole', who);
    await tick(5);
    expect(voiceCalls(h)).toBe(2);
  });

  it.each([404, 429])('after a %i it falls back and stops asking for the rest of the session', async (status) => {
    const h = setup({ voiceStatus: status });
    const s = createSpeech({ sessionId: 's' });
    await tick();
    s.speak('Hello.', voice, 'Cole', who);
    await tick(5);
    expect(h.spoken).toEqual(['Hello.']);
    s.speak('Again.', voice, 'Cole', who);
    await tick(5);
    expect(voiceCalls(h)).toBe(1);
    expect(h.spoken).toEqual(['Hello.', 'Again.']);
  });

  it('cancel aborts pending fetches and plays nothing afterwards', async () => {
    const h = setup({ hang: true });
    const s = createSpeech({ sessionId: 's' });
    await tick();
    s.speak('One. Two.', voice, 'Cole', who);
    await flush();
    expect(h.signals).toHaveLength(2);
    s.cancel();
    expect(h.signals.every((sig) => sig.aborted)).toBe(true);
    expect(h.cancelled()).toBe(1);
    await tick(5);
    expect(h.played).toEqual([]);
    expect(h.spoken).toEqual([]);
  });

  it('does not request audio while muted', async () => {
    const h = setup({});
    const s = createSpeech({ sessionId: 's' });
    await tick();
    s.setVolume(0);
    s.speak('Hello.', voice, 'Cole', who);
    expect(voiceCalls(h)).toBe(0);
  });
});
