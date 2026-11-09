import { describe, expect, it } from 'vitest';
import { parseSse, type SseEvent } from '../../app/src/net/sse';

const enc = new TextEncoder();

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of parseSse(stream, signal)) out.push(ev);
  return out;
}

describe('parseSse', () => {
  it('parses consecutive events with names', async () => {
    const events = await collect(streamOf(['event: partial\ndata: {"text":"a"}\n\nevent: spec\ndata: {"x":1}\n\n']));
    expect(events).toEqual([
      { event: 'partial', data: '{"text":"a"}' },
      { event: 'spec', data: '{"x":1}' },
    ]);
  });

  it('joins multi-line data with newlines', async () => {
    const events = await collect(streamOf(['event: spec\ndata: line one\ndata: line two\ndata:\ndata: last\n\n']));
    expect(events).toEqual([{ event: 'spec', data: 'line one\nline two\n\nlast' }]);
  });

  it('reassembles events split across chunks, even mid-character', async () => {
    const bytes = enc.encode('event: token\ndata: {"t":"café ☕"}\n\nevent: done\ndata: {}\n\n');
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 3) chunks.push(bytes.slice(i, i + 3));
    const events = await collect(streamOf(chunks));
    expect(events).toEqual([
      { event: 'token', data: '{"t":"café ☕"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('handles CRLF, including a CR and LF split across chunks, and lone CR', async () => {
    const events = await collect(streamOf(['event: a\r\ndata: one\r', '\n\r', '\nevent: b\rdata: two\r\r']));
    expect(events).toEqual([
      { event: 'a', data: 'one' },
      { event: 'b', data: 'two' },
    ]);
  });

  it('ignores comments, unknown fields and empty events; defaults the name to message', async () => {
    const events = await collect(streamOf([': keep-alive\n\nid: 7\nretry: 100\n\ndata:no-space\n\nevent: empty\n\n']));
    expect(events).toEqual([{ event: 'message', data: 'no-space' }]);
  });

  it('flushes a final event that lacks the closing blank line', async () => {
    const events = await collect(streamOf(['event: done\ndata: {"refusal":true}']));
    expect(events).toEqual([{ event: 'done', data: '{"refusal":true}' }]);
  });

  it('rejects when the signal aborts while a read never settles', async () => {
    const hanging = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) });
    const ctl = new AbortController();
    const done = collect(hanging, ctl.signal);
    ctl.abort();
    await expect(done).rejects.toThrow('aborted');
  });
});
