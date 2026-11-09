// JSON responses, same-origin CORS and bounded body reading.

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export type ErrorReason = 'resting' | 'rate_limited' | 'refusal' | 'upstream' | 'bad_request';

export function errorJson(status: number, error: string, reason?: ErrorReason): Response {
  return json(reason ? { error, reason } : { error }, status);
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Same-origin only. A request without an Origin header (curl, server to server) is allowed;
 * a browser request must come from the same host, or from a local dev server when the Worker
 * itself is served from localhost (Vite on :5173 proxying to wrangler on :8787).
 */
export function originAllowed(origin: string | null, reqUrl: URL): boolean {
  if (!origin) return true;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.host === reqUrl.host) return true;
  return isLocalHost(o.hostname) && isLocalHost(reqUrl.hostname);
}

export function withCors(res: Response, req: Request): Response {
  const origin = req.headers.get('origin');
  if (!origin) return res;
  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.set('vary', 'Origin');
  return out;
}

export function preflight(req: Request): Response {
  const headers = new Headers({
    'access-control-allow-origin': req.headers.get('origin') ?? '',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-session-id',
    'access-control-max-age': '600',
    vary: 'Origin',
  });
  return new Response(null, { status: 204, headers });
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; res: Response };

/** Read a JSON body with a hard byte cap, stopping as soon as the running total passes it. */
export async function readJson(req: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, res: errorJson(413, 'too_large', 'bad_request') };
  }
  let text = '';
  try {
    if (req.body) {
      const reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, res: errorJson(413, 'too_large', 'bad_request') };
        }
        chunks.push(value);
      }
      const all = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        all.set(c, off);
        off += c.byteLength;
      }
      text = new TextDecoder().decode(all);
    }
  } catch {
    return { ok: false, res: errorJson(400, 'unreadable_body', 'bad_request') };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, res: errorJson(400, 'invalid_json', 'bad_request') };
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isLocalRequest(url: URL): boolean {
  return isLocalHost(url.hostname);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
