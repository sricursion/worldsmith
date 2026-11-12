// Password on the web page. When SITE_PASSWORD is set on the host, every page and asset needs it; the
// API under /api is left alone, and so is /demo, which shows the demo video.
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

/** The demo video shown at /demo unless DEMO_VIDEO_URL on the host names another. */
export const DEMO_VIDEO = 'https://drive.google.com/file/d/1MokiJSskr7jKnP9GUeDOXmvrT62b3fWY/view';

/**
 * Turns a video's share address into one a page can show in a frame: a Drive file's preview, a YouTube
 * embed, or the address itself when it is already a video file. null when it is not an https address.
 */
export function embedOf(target: string | undefined): { src: string; kind: 'frame' | 'file' } | null {
  let url: URL | null = null;
  try {
    url = target ? new URL(target.trim()) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');
  const drive = /^\/file\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname);
  if (host === 'drive.google.com' && drive) return { src: `https://drive.google.com/file/d/${drive[1]}/preview`, kind: 'frame' };
  const idOk = (v: string | null | undefined): v is string => !!v && /^[A-Za-z0-9_-]{6,20}$/.test(v);
  if (host === 'youtu.be' && idOk(url.pathname.slice(1))) return { src: `https://www.youtube.com/embed/${url.pathname.slice(1)}`, kind: 'frame' };
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const v = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts)\/([^/]+)/.exec(url.pathname)?.[1];
    if (idOk(v)) return { src: `https://www.youtube.com/embed/${v}`, kind: 'frame' };
  }
  if (/\.(mp4|webm)$/i.test(url.pathname)) return { src: url.toString(), kind: 'file' };
  return { src: url.toString(), kind: 'frame' };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * /demo shows the demo video on this site, in a player that fills the page. It needs no password.
 * The address is DEMO_VIDEO_URL on the host, or the video above.
 */
export function demoResponse(target: string | undefined): Response {
  const embed = embedOf(target) ?? embedOf(DEMO_VIDEO);
  const head = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Worldsmith demo video</title>' +
    '<style>html,body{height:100%;margin:0;background:#0b0d12;color:#f2e9d8;font:16px/1.5 system-ui,sans-serif}body{display:flex;flex-direction:column}' +
    'header{display:flex;gap:16px;align-items:baseline;justify-content:space-between;padding:12px 20px;flex-wrap:wrap}h1{font:400 22px Georgia,serif;margin:0}' +
    'a{color:#e8a33d}main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 12px 12px}' +
    '.player{width:min(100%,calc((100vh - 76px) * 16 / 9));aspect-ratio:16/9;border:0;background:#000}</style>';
  const top = '<header><h1>Worldsmith demo video</h1><a href="/">Open the live demo</a></header>';
  const player = !embed
    ? '<p>The video is being uploaded and will play here shortly.</p>'
    : embed.kind === 'file'
      ? `<video class="player" src="${esc(embed.src)}" controls playsinline></video>`
      : `<iframe class="player" src="${esc(embed.src)}" title="Worldsmith demo video" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  return new Response(`${head}<body>${top}<main>${player}</main></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
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
