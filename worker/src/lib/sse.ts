// Server-sent events: framing, a writer over a TransformStream, and an incremental parser
// for upstream streams (Anthropic and Groq both speak SSE).

const enc = new TextEncoder();

/** One SSE frame. Data is JSON on a single line, so a newline can never break the frame. */
export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface SseWriter {
  response: Response;
  send(event: string, data: unknown): Promise<void>;
  close(): Promise<void>;
  readonly closed: boolean;
}

export function createSse(): SseWriter {
  const ts = new TransformStream<Uint8Array, Uint8Array>();
  const writer = ts.writable.getWriter();
  let closed = false;
  return {
    response: new Response(ts.readable, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
      },
    }),
    async send(event, data) {
      if (closed) return;
      try {
        await writer.write(enc.encode(formatSse(event, data)));
      } catch {
        closed = true; // client went away
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    },
    get closed() {
      return closed;
    },
  };
}

export interface SseFrame {
  event: string;
  data: string;
}

/** Split a buffer into complete frames plus the unconsumed remainder. */
export function parseSseBuffer(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    let event = 'message';
    const data: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length > 0) frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

/** Async iteration over the frames of an upstream SSE response body. */
export async function* readSseFrames(res: Response): AsyncGenerator<SseFrame> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parsed = parseSseBuffer(buf);
      buf = parsed.rest;
      for (const f of parsed.frames) yield f;
    }
    buf += dec.decode();
    for (const f of parseSseBuffer(buf + '\n\n').frames) yield f;
  } finally {
    reader.releaseLock();
  }
}
