// Text-to-3D vendor clients for landmark generation: Tripo (preferred) and Meshy (fallback).
//
// Sources read on 2026-11-10 (docs disagree in places; the disagreements are listed below):
//
// Tripo, current "v3" API
//   https://developers.tripo3d.ai/                                   (landing page example)
//   https://developers.tripo3d.com/en/docs/generation-text-to-model/standard.md
//   https://developers.tripo3d.com/assets/developer/tripo-v2-to-v3-migration/SKILL.md
//   - Create:  POST {base}/generation/text-to-model        auth: "Authorization: Bearer <key>"
//   - Body:    prompt (<=1024 chars), model (REQUIRED, e.g. "v3.1-20260211"), face_limit (int),
//              texture (bool, default true), pbr (bool, default true; true forces texture on),
//              texture_quality ("fast"|"standard"|"detailed"|"extreme"), smart_low_poly, compress.
//              There is no "type" field in v3 (v2 used POST /v2/openapi/task with type:"text_to_model"
//              and "model_version").
//   - Response: {"code":0,"status":"success","data":{"task_id":"...","type":"...","status":"queued"}}
//   - Poll:    GET {base}/tasks/{task_id}; status in queued|running|success|failed|cancelled
//              (anything else is treated as failed); output.model_url is the GLB (v2 called it
//              output.pbr_model / model / base_model; all four are read here).
//   - Expiry:  signed output URLs live about 24 h, so the bytes are copied to our own storage at once.
//   - Price:   1 credit = $0.01; text-to-3D 10 to 20 credits per task (landing page). Exact credits per
//              option were not found.
//   UNCONFIRMED / disagreeing: base URL is https://openapi.tripo3d.ai/v3 (international) per the migration
//   guide but the generation page shows https://openapi.tripo3d.com/v3 (mainland; keys are region-bound).
//   Override with TRIPO_BASE_URL. The model id can be overridden with TRIPO_MODEL. The poll path
//   /tasks/{id} comes from the migration guide only and was not exercised against the live API.
//
// Meshy, text-to-3D preview
//   https://docs.meshy.ai/en/api/text-to-3d
//   - Create:  POST https://api.meshy.ai/openapi/v2/text-to-3d   auth: "Authorization: Bearer <key>"
//   - Body:    mode:"preview", prompt (<=800 chars), ai_model:"latest", should_remesh, target_polycount
//              (100..300000 with remesh), topology:"triangle". art_style is deprecated and omitted.
//   - Response: {"result":"<task id>"}
//   - Poll:    GET https://api.meshy.ai/openapi/v2/text-to-3d/{id}; status PENDING|IN_PROGRESS|SUCCEEDED|
//              FAILED|CANCELED; model_urls.glb is the download URL (carries an Expires query parameter,
//              lifetime not stated there).
//   - Price:   the sample task shows consumed_credits 20; failed tasks are refunded.
//   Note: a preview task returns an untextured mesh, so landmarks from Meshy are one flat colour.
//
// Keys are read from the environment by the caller and are never logged here.

export type Vendor = 'tripo' | 'meshy';

export interface VendorEnv {
  TRIPO_API_KEY?: string;
  MESHY_API_KEY?: string;
  TRIPO_BASE_URL?: string;
  TRIPO_MODEL?: string;
}

export const TRIPO_DEFAULT_BASE = 'https://openapi.tripo3d.ai/v3';
export const TRIPO_DEFAULT_MODEL = 'v3.1-20260211';
export const MESHY_BASE = 'https://api.meshy.ai/openapi/v2';
export const STYLE_SUFFIX = ', low-poly stylized game asset, flat colors, single object, no ground plane';
export const MAX_MODEL_BYTES = 20 * 1024 * 1024;

export function pickVendor(env: VendorEnv): Vendor | null {
  if (env.TRIPO_API_KEY) return 'tripo';
  if (env.MESHY_API_KEY) return 'meshy';
  return null;
}

export type CreateResult = { ok: true; taskId: string } | { ok: false };
export type PollResult = { state: 'pending' } | { state: 'ready'; modelUrl: string } | { state: 'failed'; reason: string };

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function tripoBase(env: VendorEnv): string {
  return (env.TRIPO_BASE_URL ?? TRIPO_DEFAULT_BASE).replace(/\/+$/, '');
}

function bearer(key: string | undefined): HeadersInit {
  return { authorization: `Bearer ${key ?? ''}`, 'content-type': 'application/json', accept: 'application/json' };
}

export async function createTask(vendor: Vendor, env: VendorEnv, prompt: string): Promise<CreateResult> {
  try {
    if (vendor === 'tripo') {
      const res = await fetch(`${tripoBase(env)}/generation/text-to-model`, {
        method: 'POST',
        headers: bearer(env.TRIPO_API_KEY),
        body: JSON.stringify({
          prompt,
          model: env.TRIPO_MODEL ?? TRIPO_DEFAULT_MODEL,
          texture: true,
          pbr: false,
          face_limit: 12000,
        }),
      });
      if (!res.ok) return { ok: false };
      const data = rec(rec(await readJson(res))?.['data']);
      const taskId = str(data?.['task_id']);
      return taskId ? { ok: true, taskId } : { ok: false };
    }
    const res = await fetch(`${MESHY_BASE}/text-to-3d`, {
      method: 'POST',
      headers: bearer(env.MESHY_API_KEY),
      body: JSON.stringify({ mode: 'preview', prompt: prompt.slice(0, 800), ai_model: 'latest', should_remesh: true, topology: 'triangle', target_polycount: 8000 }),
    });
    if (!res.ok) return { ok: false };
    const taskId = str(rec(await readJson(res))?.['result']);
    return taskId ? { ok: true, taskId } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** A transport error or a 5xx while polling reports 'pending'; the route gives up on its own clock. */
export async function pollTask(vendor: Vendor, env: VendorEnv, taskId: string): Promise<PollResult> {
  try {
    if (vendor === 'tripo') {
      const res = await fetch(`${tripoBase(env)}/tasks/${encodeURIComponent(taskId)}`, { headers: bearer(env.TRIPO_API_KEY) });
      if (res.status >= 400 && res.status < 500) return { state: 'failed', reason: 'vendor' };
      if (!res.ok) return { state: 'pending' };
      const body = rec(await readJson(res));
      const task = rec(body?.['data']) ?? body;
      const status = str(task?.['status'])?.toLowerCase();
      if (status === 'queued' || status === 'running') return { state: 'pending' };
      if (status === 'success') {
        const out = rec(task?.['output']);
        const url = str(out?.['model_url']) ?? str(out?.['pbr_model']) ?? str(out?.['model']) ?? str(out?.['base_model']);
        return url ? { state: 'ready', modelUrl: url } : { state: 'failed', reason: 'no_model' };
      }
      return { state: 'failed', reason: 'vendor' };
    }
    const res = await fetch(`${MESHY_BASE}/text-to-3d/${encodeURIComponent(taskId)}`, { headers: bearer(env.MESHY_API_KEY) });
    if (res.status >= 400 && res.status < 500) return { state: 'failed', reason: 'vendor' };
    if (!res.ok) return { state: 'pending' };
    const task = rec(await readJson(res));
    const status = str(task?.['status'])?.toUpperCase();
    if (status === 'PENDING' || status === 'IN_PROGRESS') return { state: 'pending' };
    if (status === 'SUCCEEDED') {
      const url = str(rec(task?.['model_urls'])?.['glb']);
      return url ? { state: 'ready', modelUrl: url } : { state: 'failed', reason: 'no_model' };
    }
    return { state: 'failed', reason: 'vendor' };
  } catch {
    return { state: 'pending' };
  }
}

/** Fetches the finished GLB. Signed vendor URLs carry their own credentials, so no auth header is sent. */
export async function downloadModel(url: string): Promise<{ ok: true; bytes: ArrayBuffer } | { ok: false; reason: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: 'download' };
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_MODEL_BYTES) return { ok: false, reason: 'too_large' };
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_MODEL_BYTES) return { ok: false, reason: 'too_large' };
    const m = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
    if (m.length < 4 || m[0] !== 0x67 || m[1] !== 0x6c || m[2] !== 0x54 || m[3] !== 0x46) {
      return { ok: false, reason: 'not_glb' };
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: 'download' };
  }
}
