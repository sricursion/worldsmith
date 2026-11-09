// POST /api/share (spec -> id) and GET /api/load/:id, backed by the TOWNS KV namespace.
import type { Env } from '../lib/env';
import { errorJson, json, readJson } from '../lib/http';
import { guardEarly } from '../lib/guard';
import { looksLikeSpec } from '../lib/validate';

export const SHARE_MAX_BYTES = 64 * 1024;
export const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60;
// New ids are 24 hex characters; 10 to 32 are accepted on read so links minted with the old 10-character ids still load.
const ID_RE = /^[0-9a-f]{10,32}$/;

/** First 24 hex characters (96 bits) of the SHA-256 of the canonical JSON text. */
export async function shareId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

export async function handleShare(req: Request, env: Env): Promise<Response> {
  const early = await guardEarly(req, env);
  if (early) return early;
  if (!env.TOWNS) return errorJson(503, 'storage_unavailable', 'upstream');
  const body = await readJson(req, SHARE_MAX_BYTES);
  if (!body.ok) return body.res;
  if (!looksLikeSpec(body.value)) return errorJson(400, 'not a world spec', 'bad_request');
  const text = JSON.stringify(body.value);
  const id = await shareId(text);
  const key = `town:${id}`;
  // Never overwrite: a stored town keeps its content for the life of its link.
  if ((await env.TOWNS.get(key)) !== null) return json({ id });
  await env.TOWNS.put(key, text, { expirationTtl: SHARE_TTL_SECONDS });
  return json({ id });
}

export async function handleLoad(id: string, env: Env): Promise<Response> {
  if (!ID_RE.test(id)) return errorJson(400, 'bad id', 'bad_request');
  if (!env.TOWNS) return errorJson(503, 'storage_unavailable', 'upstream');
  const text = await env.TOWNS.get(`town:${id}`);
  if (!text) return errorJson(404, 'not_found');
  return new Response(text, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
