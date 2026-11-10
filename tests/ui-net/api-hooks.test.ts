import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPILE_IDLE_MS, COMPILE_TOTAL_MS, createApi } from '../../app/src/net/api';

const enc = new TextEncoder();

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A stream the test feeds by hand and never closes. */
function openStream(): { res: Response; send(s: string): void } {
  let ctl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  return { res: new Response(body, { status: 200 }), send: (s) => {
      try {
        ctl?.enqueue(enc.encode(s));
      } catch {
        // the client already cancelled the stream
      }
    } };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('compile hooks', () => {
  it('calls onOutline and onLook, then resolves with the spec', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'event: outline\ndata: {"title":"T"}\n\n',
        'event: partial\ndata: {"text":"x"}\n\n',
        'event: look\ndata: {"site":{"pattern":"ring"}}\n\n',
        'event: spec\ndata: {"a":1}\n\n',
      ]),
    );
    const calls: string[] = [];
    const r = await createApi().compile('x', 1, () => calls.push('partial'), undefined, {
      onOutline: (o) => calls.push(`outline:${JSON.stringify(o)}`),
      onLook: (l) => calls.push(`look:${JSON.stringify(l)}`),
    });
    expect(r).toEqual({ ok: true, spec: { a: 1 } });
    expect(calls).toEqual(['outline:{"title":"T"}', 'partial', 'look:{"site":{"pattern":"ring"}}']);
  });

  it('works without hooks and ignores unknown events', async () => {
    fetchMock.mockResolvedValue(sseResponse(['event: outline\ndata: {}\n\n', 'event: mystery\ndata: 1\n\n', 'event: spec\ndata: {"a":2}\n\n']));
    expect(await createApi().compile('x', 1, () => undefined)).toEqual({ ok: true, spec: { a: 2 } });
  });

  it('survives a throwing hook', async () => {
    fetchMock.mockResolvedValue(sseResponse(['event: look\ndata: {}\n\n', 'event: spec\ndata: {"a":3}\n\n']));
    const r = await createApi().compile('x', 1, () => undefined, undefined, {
      onLook: () => {
        throw new Error('boom');
      },
    });
    expect(r).toEqual({ ok: true, spec: { a: 3 } });
  });

  it('keeps the idle guard alive on ping and unknown events', async () => {
    vi.useFakeTimers();
    const s = openStream();
    fetchMock.mockResolvedValue(s.res);
    const pending = createApi().compile('x', 1, () => undefined);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(COMPILE_IDLE_MS - 5_000);
      s.send(i % 2 === 0 ? 'event: ping\ndata: {}\n\n' : 'event: whatever\ndata: {}\n\n');
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    s.send('event: spec\ndata: {"ok":true}\n\n');
    expect(await pending).toEqual({ ok: true, spec: { ok: true } });
  });

  it('gives up at the overall cap even when pings keep arriving', async () => {
    vi.useFakeTimers();
    const s = openStream();
    fetchMock.mockResolvedValue(s.res);
    const pending = createApi().compile('x', 1, () => undefined);
    let elapsed = 0;
    while (elapsed < COMPILE_TOTAL_MS + 1_000) {
      await vi.advanceTimersByTimeAsync(10_000);
      elapsed += 10_000;
      s.send('event: ping\ndata: {}\n\n');
    }
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
  });
});
