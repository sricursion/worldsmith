// Landmark generation: POST /api/landmark, GET /api/landmark/:jobId, GET /api/landmark/file/:key.
// A text-to-3D vendor task is started per landmark prompt; finished GLBs are copied into our own
// storage (R2 binding LANDMARKS, else KV) because vendor URLs expire.
import type { Env } from '../lib/env';
import { isMock } from '../lib/env';
import { guardEarly } from '../lib/guard';
import { errorJson, isRecord, json, readJson } from '../lib/http';
import { createTask, downloadModel, MAX_MODEL_BYTES, pickVendor, pollTask, STYLE_SUFFIX, type Vendor, type VendorEnv } from '../lib/tripo';
import { shareId } from './share';

export interface LandmarkEnv extends Env, VendorEnv {
  LANDMARKS?: R2Bucket;
  LANDMARK_DAILY_CAP?: string;
}

export const DEFAULT_DAILY_CAP = 150;
export const PER_SESSION_CAP = 2;
export const JOB_TTL_SECONDS = 3600;
export const JOB_GIVE_UP_MS = 10 * 60 * 1000;
const BODY_MAX = 4096;
const KEY_RE = /^[0-9a-f]{24}$/;
const JOB_RE = /^[A-Za-z0-9-]{1,64}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;

type JobStatus = 'pending' | 'ready' | 'failed';
interface JobRecord {
  vendor: Vendor | null;
  taskId: string;
  key: string;
  status: JobStatus;
  reason?: string;
  createdAt: number;
}

export function normalisePrompt(p: string): string {
  return p.toLowerCase().replace(/\s+/g, ' ').trim();
}

export const landmarkKey = (prompt: string): Promise<string> => shareId(normalisePrompt(prompt));

const jobKey = (id: string): string => `landmark:job:${id}`;
const glbKey = (key: string): string => `landmark:glb:${key}`;
const inflightKey = (key: string): string => `landmark:inflight:${key}`;
const dayKey = (): string => `landmark:cap:${new Date().toISOString().slice(0, 10)}`;
const sessKey = (s: string): string => `landmark:sess:${s}`;

function dailyCap(env: LandmarkEnv): number {
  const raw = env.LANDMARK_DAILY_CAP;
  if (raw === undefined || raw === '') return DEFAULT_DAILY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

function activeVendor(env: LandmarkEnv): Vendor | null {
  if (isMock(env)) return null;
  return pickVendor(env);
}

// Storage. Raw bytes go to KV as an ArrayBuffer (no base64 inflation), so 20 MB stays under the 25 MB value limit.
async function hasModel(env: LandmarkEnv, key: string): Promise<boolean> {
  if (env.LANDMARKS) return (await env.LANDMARKS.head(key)) !== null;
  if (env.TOWNS) return (await env.TOWNS.get(glbKey(key), 'arrayBuffer')) !== null;
  return false;
}

async function storeModel(env: LandmarkEnv, key: string, bytes: ArrayBuffer): Promise<boolean> {
  if (env.LANDMARKS) {
    await env.LANDMARKS.put(key, bytes, { httpMetadata: { contentType: 'model/gltf-binary' } });
    return true;
  }
  if (env.TOWNS && bytes.byteLength < MAX_MODEL_BYTES) {
    await env.TOWNS.put(glbKey(key), bytes);
    return true;
  }
  return false;
}

async function loadJob(env: LandmarkEnv, id: string): Promise<JobRecord | null> {
  const raw = env.TOWNS ? await env.TOWNS.get(jobKey(id)) : null;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return isRecord(v) ? (v as unknown as JobRecord) : null;
  } catch {
    return null;
  }
}

async function saveJob(env: LandmarkEnv, id: string, job: JobRecord): Promise<void> {
  await env.TOWNS?.put(jobKey(id), JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
}

async function readCount(env: LandmarkEnv, key: string): Promise<number> {
  const n = Number((await env.TOWNS?.get(key)) ?? '0');
  return Number.isFinite(n) ? n : 0;
}

const fileUrl = (key: string): string => `/api/landmark/file/${key}`;

export async function handleLandmarkStart(req: Request, envIn: Env): Promise<Response> {
  const env: LandmarkEnv = envIn;
  const early = await guardEarly(req, env);
  if (early) return early;
  const vendor = activeVendor(env);
  const kv = env.TOWNS;
  if (!vendor || !kv) return json({ jobId: 'none' });
  const body = await readJson(req, BODY_MAX);
  if (!body.ok) return body.res;
  const b = body.value;
  if (!isRecord(b)) return errorJson(400, 'bad body', 'bad_request');
  const { sessionId, id, prompt, height } = b;
  if (
    typeof sessionId !== 'string' || !SESSION_RE.test(sessionId) ||
    typeof id !== 'string' || id.length < 1 || id.length > 64 ||
    typeof prompt !== 'string' || prompt.trim().length < 3 || prompt.length > 400 ||
    typeof height !== 'number' || !Number.isFinite(height)
  ) {
    return errorJson(400, 'bad landmark request', 'bad_request');
  }

  const key = await landmarkKey(prompt);
  const jobId = crypto.randomUUID();
  const now = Date.now();

  if (await hasModel(env, key)) {
    await saveJob(env, jobId, { vendor, taskId: '', key, status: 'ready', createdAt: now });
    return json({ jobId, status: 'ready', url: fileUrl(key) });
  }

  // The same prompt already in flight: share that job instead of paying twice.
  const inflight = await kv.get(inflightKey(key));
  if (inflight) {
    const j = await loadJob(env, inflight);
    if (j && j.status === 'pending') return json({ jobId: inflight, status: 'pending' });
  }

  const failed = async (reason: string): Promise<Response> => {
    await saveJob(env, jobId, { vendor, taskId: '', key, status: 'failed', reason, createdAt: now });
    return json({ jobId, status: 'failed', reason });
  };

  const [day, sess] = await Promise.all([readCount(env, dayKey()), readCount(env, sessKey(sessionId))]);
  if (day >= dailyCap(env) || sess >= PER_SESSION_CAP) return failed('cap');

  const task = await createTask(vendor, env, prompt.trim() + STYLE_SUFFIX);
  if (!task.ok) return failed('vendor');

  await Promise.all([
    kv.put(dayKey(), String(day + 1), { expirationTtl: 2 * 24 * 3600 }),
    kv.put(sessKey(sessionId), String(sess + 1), { expirationTtl: 24 * 3600 }),
    saveJob(env, jobId, { vendor, taskId: task.taskId, key, status: 'pending', createdAt: now }),
    kv.put(inflightKey(key), jobId, { expirationTtl: JOB_TTL_SECONDS }),
  ]);
  return json({ jobId, status: 'pending' });
}

export async function handleLandmarkStatus(req: Request, envIn: Env, jobId: string): Promise<Response> {
  const env: LandmarkEnv = envIn;
  const early = await guardEarly(req, env);
  if (early) return early;
  if (jobId === 'none' || !activeVendor(env) || !env.TOWNS) return json({ status: 'failed', reason: 'disabled' });
  if (!JOB_RE.test(jobId)) return errorJson(400, 'bad id', 'bad_request');
  const job = await loadJob(env, jobId);
  if (!job) return json({ status: 'failed', reason: 'unknown' });
  if (job.status === 'ready') return json({ status: 'ready', url: fileUrl(job.key) });
  if (job.status === 'failed') return json({ status: 'failed', reason: job.reason ?? 'failed' });

  const finish = async (status: JobStatus, reason?: string): Promise<Response> => {
    const next: JobRecord = reason === undefined ? { ...job, status } : { ...job, status, reason };
    await saveJob(env, jobId, next);
    return status === 'ready' ? json({ status, url: fileUrl(job.key) }) : json({ status, reason });
  };

  if (!job.vendor) return finish('failed', 'disabled');
  const r = await pollTask(job.vendor, env, job.taskId);
  if (r.state === 'failed') return finish('failed', r.reason);
  if (r.state === 'pending') {
    if (Date.now() - job.createdAt > JOB_GIVE_UP_MS) return finish('failed', 'timeout');
    return json({ status: 'pending' });
  }
  // Vendor URLs expire: copy the bytes now.
  const dl = await downloadModel(r.modelUrl);
  if (!dl.ok) return finish('failed', dl.reason);
  if (!(await storeModel(env, job.key, dl.bytes))) return finish('failed', 'too_large');
  return finish('ready');
}

export async function handleLandmarkFile(key: string, envIn: Env): Promise<Response> {
  const env: LandmarkEnv = envIn;
  if (!KEY_RE.test(key)) return errorJson(400, 'bad key', 'bad_request');
  const headers = {
    'content-type': 'model/gltf-binary',
    'cache-control': 'public, max-age=31536000, immutable',
  };
  if (env.LANDMARKS) {
    const obj = await env.LANDMARKS.get(key);
    if (!obj) return errorJson(404, 'not_found');
    return new Response(obj.body, { headers });
  }
  const bytes = env.TOWNS ? await env.TOWNS.get(glbKey(key), 'arrayBuffer') : null;
  if (!bytes) return errorJson(404, 'not_found');
  return new Response(bytes, { headers });
}
