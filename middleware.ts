// Password on the web page. When SITE_PASSWORD is set on the host, every page and asset needs it; the
// API under /api is left alone, and so is /demo, which forwards to the demo video.
// (HTTP Basic: any user name, the password as given). When it is not set the site is open, which is
// how it runs locally. The browser remembers the answer and sends it with the page's own requests.

export const config = { matcher: '/((?!api(?:/|$)).*)' };

/** Compares two strings in time that does not depend on where they differ. */
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % Math.max(1, b.length));
  return diff === 0;
}

export function passwordFrom(header: string | null): string | null {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const colon = decoded.indexOf(':');
    return colon < 0 ? null : decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

/**
 * /demo sends the visitor to the demo video, whose address is DEMO_VIDEO_URL on the host. It needs no
 * password. Until the address is set, it says so in a line.
 */
export function demoResponse(target: string | undefined): Response {
  let url: URL | null = null;
  try {
    url = target ? new URL(target.trim()) : null;
  } catch {
    url = null;
  }
  if (url && url.protocol === 'https:') {
    return new Response(null, { status: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store' } });
  }
  const page = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Worldsmith demo video</title><body style="font:16px/1.5 system-ui,sans-serif;margin:15vh auto;max-width:32em;padding:0 16px"><h1 style="font-size:22px">Worldsmith demo video</h1><p>The video is being uploaded and will open from this address shortly.</p></body>';
  return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default function middleware(request: Request): Response | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path === '/demo') return demoResponse(env['DEMO_VIDEO_URL']);
  const want = env['SITE_PASSWORD'];
  if (!want) return undefined;
  const got = passwordFrom(request.headers.get('authorization'));
  if (got !== null && same(got, want)) return undefined;
  return new Response('Password required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Worldsmith", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
