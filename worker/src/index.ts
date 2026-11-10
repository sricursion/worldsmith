// Townforge Worker: model proxy, decision proxy, share links. Static files are served by the
// assets binding; only /api/* reaches this code (run_worker_first).
import type { Env } from './lib/env';
import { isMock } from './lib/env';
import { errorJson, json, originAllowed, preflight, withCors } from './lib/http';
import { handleCompile } from './routes/compile';
import { handleLandmarkFile, handleLandmarkStart, handleLandmarkStatus } from './routes/landmark';
import { handleNpcSay } from './routes/npc';
import { handleRulesPatch } from './routes/rules';
import { handleLoad, handleShare } from './routes/share';
import { handleTick } from './routes/tick';

async function route(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const path = url.pathname;
  const post = req.method === 'POST';

  if (path === '/api/health' && req.method === 'GET') return json({ ok: true, mock: isMock(env) });
  if (path === '/api/compile' && post) return handleCompile(req, env, ctx);
  if (path === '/api/npc/say' && post) return handleNpcSay(req, env, ctx);
  if (path === '/api/tick' && post) return handleTick(req, env, url);
  if (path === '/api/rules/patch' && post) return handleRulesPatch(req, env);
  if (path === '/api/share' && post) return handleShare(req, env);
  if (path === '/api/landmark' && post) return handleLandmarkStart(req, env);
  const lmFile = /^\/api\/landmark\/file\/([^/]+)$/.exec(path);
  if (lmFile && req.method === 'GET') return handleLandmarkFile(lmFile[1] ?? '', env);
  const lmJob = /^\/api\/landmark\/([^/]+)$/.exec(path);
  if (lmJob && req.method === 'GET') return handleLandmarkStatus(req, env, lmJob[1] ?? '');
  const load = /^\/api\/load\/([^/]+)$/.exec(path);
  if (load && req.method === 'GET') return handleLoad(load[1] ?? '', env);

  return errorJson(404, 'not_found');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!originAllowed(req.headers.get('origin'), url)) return errorJson(403, 'forbidden_origin', 'bad_request');
    if (req.method === 'OPTIONS') return preflight(req);
    try {
      return withCors(await route(req, env, ctx, url), req);
    } catch {
      return withCors(errorJson(500, 'internal', 'upstream'), req);
    }
  },
} satisfies ExportedHandler<Env>;
