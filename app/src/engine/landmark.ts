// Loads a generated landmark GLB and restyles it to the town's flat-shaded look; polls the Worker job.
import { Color, Mesh, MeshStandardMaterial } from 'three';
import type { Material, Object3D, Texture } from 'three';
import type { Api } from '../net/api';
import { loadGltf, normalizeTemplate } from './gltf';

const FALLBACK = new Color(0xb8a98f);

function restyle(old: Material, hasVertexColors: boolean): MeshStandardMaterial {
  const src = old as Partial<{ color: Color; map: Texture | null }>;
  const map = src.map ?? null;
  const mat = new MeshStandardMaterial({
    color: map || hasVertexColors ? 0xffffff : (src.color?.clone() ?? FALLBACK.clone()),
    map,
    vertexColors: hasVertexColors,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
  });
  mat.name = old.name;
  return mat;
}

/** Loads the GLB, makes every mesh a flat-shaded standard material, centres on x/z and rests the base on y = 0. */
export async function loadLandmark(url: string): Promise<Object3D> {
  const gltf = await loadGltf(url);
  const scene = gltf.scene;
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const hasColors = o.geometry.getAttribute('color') !== undefined;
    const olds: Material[] = Array.isArray(o.material) ? o.material : [o.material];
    const next = olds.map((m) => restyle(m, hasColors));
    // Textures are kept by the new materials, so only the old materials are released.
    for (const m of olds) m.dispose();
    o.material = Array.isArray(o.material) ? next : (next[0] as MeshStandardMaterial);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return normalizeTemplate(scene).object;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type PollOutcome = { ok: true; url: string } | { ok: false; reason: string };

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Polls a landmark job until it is ready, failed, aborted or out of time. Transient request errors are retried. */
export async function pollLandmark(
  api: Pick<Api, 'landmarkStatus'>,
  jobId: string,
  { intervalMs = 5000, timeoutMs = 240000, signal }: PollOptions = {},
): Promise<PollOutcome> {
  if (jobId === 'none') return { ok: false, reason: 'disabled' };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    const r = await api.landmarkStatus(jobId);
    if (r.ok) {
      if (r.status === 'ready') return r.url ? { ok: true, url: r.url } : { ok: false, reason: 'bad_response' };
      if (r.status === 'failed') return { ok: false, reason: r.reason ?? 'failed' };
    }
    if (Date.now() + intervalMs > deadline) return { ok: false, reason: 'timeout' };
    await wait(intervalMs, signal);
  }
}
