// Server-sent-events parsing as a pure function over a byte stream, plus the abort helper the
// API client shares with it. No DOM, no fetch: it runs under Node in tests.

export interface SseEvent {
  event: string;
  data: string;
}

export class SseAbortError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'SseAbortError';
  }
}

/** A promise that rejects when `signal` aborts. `off()` detaches the listener. */
export function abortPromise(signal: AbortSignal): { promise: Promise<never>; off(): void } {
  let off = (): void => undefined;
  const promise = new Promise<never>((_, reject) => {
    const fail = (): void => reject(new SseAbortError());
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
    off = () => signal.removeEventListener('abort', fail);
  });
  promise.catch(() => undefined); // never an unhandled rejection when nobody is racing it any more
  return { promise, off };
}

/** Splits `buf` into lines (LF, CRLF or lone CR), calls `onLine` for each, returns the unfinished tail. */
function drainLines(buf: string, onLine: (line: string) => void): string {
  let start = 0;
  let i = 0;
  while (i < buf.length) {
    const c = buf.charCodeAt(i);
    if (c === 10) {
      onLine(buf.slice(start, i));
      i += 1;
      start = i;
    } else if (c === 13) {
      if (i + 1 >= buf.length) break; // a CR at the very end may be half of a CRLF split across chunks
      onLine(buf.slice(start, i));
      i += buf.charCodeAt(i + 1) === 10 ? 2 : 1;
      start = i;
    } else {
      i += 1;
    }
  }
  return buf.slice(start);
}

/**
 * Yields one SseEvent per dispatched event. Handles multi-line `data:`, events split across chunks
 * (including inside a multi-byte character), CRLF, comments and unknown fields. Rejects with
 * SseAbortError when `signal` aborts, even if the underlying read never settles.
 */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const aborter = signal ? abortPromise(signal) : null;
  let eventName = '';
  let dataLines: string[] = [];
  let buf = '';
  const pending: SseEvent[] = [];

  const onLine = (line: string): void => {
    if (line === '') {
      if (dataLines.length > 0) pending.push({ event: eventName || 'message', data: dataLines.join('\n') });
      eventName = '';
      dataLines = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
  };

  try {
    for (;;) {
      const next = aborter ? await Promise.race([reader.read(), aborter.promise]) : await reader.read();
      if (next.done) break;
      buf = drainLines(buf + decoder.decode(next.value, { stream: true }), onLine);
      while (pending.length > 0) {
        const ev = pending.shift();
        if (ev) yield ev;
      }
    }
    buf += decoder.decode();
    if (buf.endsWith('\r')) buf = buf.slice(0, -1);
    if (buf !== '') onLine(buf);
    onLine('');
    while (pending.length > 0) {
      const ev = pending.shift();
      if (ev) yield ev;
    }
  } finally {
    aborter?.off();
    reader.cancel().catch(() => undefined);
  }
}
