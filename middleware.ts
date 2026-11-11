// Password on the web page. When SITE_PASSWORD is set on the host, every page and asset needs it; the
// API under /api is left alone.
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

export default function middleware(request: Request): Response | undefined {
  const want = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['SITE_PASSWORD'];
  if (!want) return undefined;
  const got = passwordFrom(request.headers.get('authorization'));
  if (got !== null && same(got, want)) return undefined;
  return new Response('Password required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Worldsmith", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
