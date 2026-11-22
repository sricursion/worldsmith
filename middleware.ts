// Password on the web page. When SITE_PASSWORD is set on the host, every page and asset needs it; the
// API under /api is left alone, and so are /demo, which shows the demo video, and the host's own
// /_vercel paths, which serve the page-view counter. /prompts lists what visitors typed; it needs the
// password and is not served at all when no password is set.
// (HTTP Basic: any user name, the password as given). When it is not set the site is open, which is
// how it runs locally. The browser remembers the answer and sends it with the page's own requests.

import { PROMPT_KEY, type PromptEntry } from './worker/src/lib/promptlog';

export const config = { matcher: '/((?!api(?:/|$)|_vercel/).*)' };

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
  // The host's page-view counter, the same script the app loads.
  const count = '<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script><script defer src="/_vercel/insights/script.js"></script>';
  const top = '<header><h1>Worldsmith demo video</h1><a href="/">Open the live demo</a></header>';
  const player = !embed
    ? '<p>The video is being uploaded and will play here shortly.</p>'
    : embed.kind === 'file'
      ? `<video class="player" src="${esc(embed.src)}" controls playsinline></video>`
      : `<iframe class="player" src="${esc(embed.src)}" title="Worldsmith demo video" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  return new Response(`${head}${count}<body>${top}<main>${player}</main></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const KIND: Record<string, string> = { world: 'World', rule: 'Rule', talk: 'Said' };

/** /prompts: the newest prompts visitors typed, read from the host's Redis store. */
export async function promptsResponse(env: Record<string, string | undefined>, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = env['KV_REST_API_URL'];
  const token = env['KV_REST_API_READ_ONLY_TOKEN'] ?? env['KV_REST_API_TOKEN'];
  let rows: PromptEntry[] = [];
  let note = '';
  if (!url || !token) note = 'No store is connected, so nothing has been recorded.';
  else {
    try {
      const res = await fetcher(`${url.replace(/\/+$/, '')}/lrange/${encodeURIComponent(PROMPT_KEY)}/0/999`, { headers: { authorization: `Bearer ${token}` } });
      const body = (await res.json()) as { result?: unknown };
      const list = Array.isArray(body.result) ? body.result : [];
      rows = list.flatMap((raw) => {
        try {
          const e = JSON.parse(String(raw)) as PromptEntry;
          return typeof e.text === 'string' && typeof e.t === 'string' ? [e] : [];
        } catch {
          return [];
        }
      });
      if (!res.ok) note = `The store answered ${res.status}.`;
    } catch {
      note = 'The store could not be reached.';
    }
  }
  const counts = { world: 0, rule: 0, talk: 0 } as Record<string, number>;
  for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const summary = `${rows.length} shown, newest first: ${counts['world']} worlds, ${counts['rule']} rules, ${counts['talk']} lines said to characters.`;
  const body = rows.map((r) =>
    `<tr class="k-${esc(r.kind)}"><td><time datetime="${esc(r.t)}">${esc(r.t.slice(0, 16).replace('T', ' '))} UTC</time></td>` +
    `<td>${esc(KIND[r.kind] ?? r.kind)}${r.to ? `<span class="to">to ${esc(r.to)}</span>` : ''}</td><td class="text">${esc(r.text)}</td><td class="s">${esc(r.session ?? '')}</td></tr>`).join('');
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Worldsmith prompts</title>' +
    '<style>body{margin:0;background:#0b0d12;color:#f2e9d8;font:15px/1.45 system-ui,sans-serif;padding:16px max(16px,env(safe-area-inset-right))}' +
    'h1{font:400 24px Georgia,serif;margin:0 0 4px}p{margin:0 0 14px;color:#b9ae9c}.wrap{overflow-x:auto}' +
    'table{border-collapse:collapse;width:100%;min-width:640px}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid #262a33}' +
    'th{font-weight:600;color:#b9ae9c;font-size:13px}td:first-child{white-space:nowrap;color:#b9ae9c}.text{white-space:pre-wrap;word-break:break-word;width:60%}' +
    '.k-world td:nth-child(2){color:#e8a33d}.to{display:block;color:#8d8577;font-size:13px}.s{color:#6f685d;font-family:ui-monospace,monospace;font-size:12px}</style>' +
    `<body><h1>Prompts</h1><p>${esc(note || summary)} The tag on the right groups one visit.</p>` +
    `<div class="wrap"><table><thead><tr><th>When</th><th>Kind</th><th>Text</th><th>Visit</th></tr></thead><tbody>${body}</tbody></table></div>` +
    '<script>for(const t of document.querySelectorAll("time")){const d=new Date(t.dateTime);if(!isNaN(d))t.textContent=d.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})}</script></body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export default function middleware(request: Request): Response | Promise<Response> | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path === '/demo') return demoResponse(env['DEMO_VIDEO_URL']);
  if (path.startsWith('/_vercel/')) return undefined;
  const want = env['SITE_PASSWORD'];
  if (!want) return path === '/prompts' ? new Response('Not found.', { status: 404 }) : undefined;
  const got = passwordFrom(request.headers.get('authorization'));
  if (got !== null && same(got, want)) return path === '/prompts' ? promptsResponse(env) : undefined;
  return new Response('Password required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Worldsmith", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
