import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../../app/src/net/api';
import type { NpcSayRequest } from '../../app/src/net/types';

const enc = new TextEncoder();

function sseResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

/** Sends `first` and then never produces another byte. */
function stalledResponse(first: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(first));
    },
    pull: () => new Promise<void>(() => undefined),
  });
  return new Response(body, { status: 200 });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const say: NpcSayRequest = {
  sessionId: 's',
  npc: { id: 'n', name: 'N', role: 'r', persona: 'p', knowledge: [], revealed: [], mood: 'calm', place: 'street' },
  context: { title: 't', era: 'e', theme: 'western', lexicon: [], hour: 8, day: 1, rules: [], activeBeats: [], recentLog: [] },
  history: [],
  playerText: 'hello',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('compile', () => {
  it('accumulates partial text and resolves with the spec', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['event: partial\ndata: {"text":"{\\"a\\""}\n\n', 'event: partial\ndata: {"text":":1}"}\n\n', 'event: spec\ndata: {"a":1}\n\n']),
    );
    const seen: string[] = [];
    const r = await createApi('/api/').compile('a town', 7, (t) => seen.push(t));
    expect(r).toEqual({ ok: true, spec: { a: 1 } });
    expect(seen).toEqual(['{"a"', '{"a":1}']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/compile');
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'a town', seed: 7 });
  });

  it('surfaces an error event', async () => {
    fetchMock.mockResolvedValue(sseResponse(['event: error\ndata: {"error":"bad model output"}\n\n']));
    expect(await createApi().compile('x', 1, () => undefined)).toEqual({ ok: false, error: 'bad model output' });
  });

  it('times out after 20 s of silence on a stream that never resolves', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(stalledResponse('event: partial\ndata: {"text":"hi"}\n\n'));
    const partials: string[] = [];
    const pending = createApi().compile('x', 1, (t) => partials.push(t));
    await vi.advanceTimersByTimeAsync(19_000);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
    expect(partials).toEqual(['hi']);
  });

  it('times out when the response headers never arrive', async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const pending = createApi().compile('x', 1, () => undefined);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
  });

  it('reports aborted when the caller aborts', async () => {
    fetchMock.mockResolvedValue(stalledResponse(''));
    const ctl = new AbortController();
    const pending = createApi().compile('x', 1, () => undefined, ctl.signal);
    await Promise.resolve();
    ctl.abort();
    expect(await pending).toEqual({ ok: false, error: 'aborted' });
  });

  it('maps HTTP 429 resting to "resting"', async () => {
    fetchMock.mockResolvedValue(json({ error: 'slow down', reason: 'resting' }, 429));
    expect(await createApi().compile('x', 1, () => undefined)).toEqual({ ok: false, error: 'resting' });
  });
});

describe('npcSay', () => {
  it('streams tokens and returns the joined text', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['event: token\ndata: {"t":"Howdy"}\n\n', 'event: token\ndata: {"t":", stranger."}\n\n', 'event: done\ndata: {}\n\n']),
    );
    const tokens: string[] = [];
    const r = await createApi().npcSay(say, (t) => tokens.push(t));
    expect(r).toEqual({ ok: true, text: 'Howdy, stranger.' });
    expect(tokens).toEqual(['Howdy', ', stranger.']);
  });

  it('turns done with refusal into a refusal result', async () => {
    fetchMock.mockResolvedValue(sseResponse(['event: token\ndata: {"t":"no"}\n\n', 'event: done\ndata: {"refusal":true}\n\n']));
    expect(await createApi().npcSay(say, () => undefined)).toEqual({ ok: false, error: 'refusal', refusal: true });
  });

  it('times out after 8 s of silence', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(stalledResponse('event: token\ndata: {"t":"Well"}\n\n'));
    const pending = createApi().npcSay(say, () => undefined);
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
  });
});

describe('plain JSON endpoints', () => {
  it('maps 429 resting on tick and patchRules, and plain 429 to rate_limited', async () => {
    const api = createApi();
    fetchMock.mockImplementation(() => Promise.resolve(json({ error: 'x', reason: 'resting' }, 429)));
    expect(await api.tick({ sessionId: 's', stateSummary: '', questions: [] })).toEqual({ ok: false, error: 'resting' });
    expect(await api.patchRules({ sessionId: 's', ruleText: 'r', summary: '' })).toEqual({ ok: false, error: 'resting' });
    fetchMock.mockImplementation(() => Promise.resolve(json({ error: 'x' }, 429)));
    expect(await api.share({} as never)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('parses success bodies and encodes the load id', async () => {
    const api = createApi();
    fetchMock.mockResolvedValueOnce(json({ probs: [[0.2, 0.8]] }));
    expect(await api.tick({ sessionId: 's', stateSummary: '', questions: [] })).toEqual({ ok: true, probs: [[0.2, 0.8]] });
    fetchMock.mockResolvedValueOnce(json({ id: 'abc' }));
    expect(await api.share({} as never)).toEqual({ ok: true, id: 'abc' });
    fetchMock.mockResolvedValueOnce(json({ title: 'T' }));
    expect(await api.load('a/b')).toEqual({ ok: true, spec: { title: 'T' } });
    expect((fetchMock.mock.calls[2] as [string])[0]).toBe('/api/load/a%2Fb');
    fetchMock.mockResolvedValueOnce(json({ ok: true, mock: true }));
    expect(await api.health()).toEqual({ ok: true, mock: true });
  });

  it('rejects malformed bodies and network failures as values', async () => {
    const api = createApi();
    fetchMock.mockResolvedValueOnce(json({ probs: 'nope' }));
    expect(await api.tick({ sessionId: 's', stateSummary: '', questions: [] })).toEqual({ ok: false, error: 'bad_response' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await api.health()).toEqual({ ok: false, mock: false });
  });

  it('times out after 6 s', async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const pending = createApi().tick({ sessionId: 's', stateSummary: '', questions: [] });
    await vi.advanceTimersByTimeAsync(6_001);
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
  });

  it('gives patchRules 25 s while other JSON calls keep 6 s', async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const pending = createApi().patchRules({ sessionId: 's', ruleText: 'r', summary: '' });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(24_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
  });

  it('ignores ping events and unknown events on a compile stream', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['event: ping\ndata: {}\n\n', 'event: whatever\ndata: x\n\n', 'event: spec\ndata: {"title":"T"}\n\n']),
    );
    expect(await createApi().compile('x', 1, () => undefined)).toEqual({ ok: true, spec: { title: 'T' } });
  });

  it('pings keep a silent compile alive past the idle limit', async () => {
    vi.useFakeTimers();
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctl = c;
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    const pending = createApi().compile('x', 1, () => undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    ctl.enqueue(enc.encode('event: ping\ndata: {}\n\n'));
    await vi.advanceTimersByTimeAsync(15_000);
    ctl.enqueue(enc.encode('event: spec\ndata: {"title":"T"}\n\n'));
    expect(await pending).toEqual({ ok: true, spec: { title: 'T' } });
  });
});
