import { Mesh } from 'three';
import type { Material, Object3D } from 'three';
import type { Rng } from '../world/rng';
import type { BuildingRole, BuildingSize, ThemeId } from '../world/spec';
import { KITS } from '../town/kits';
import type { KitManifest } from '../town/kits';
import { enableShadows, loadGltf, normalizeTemplate } from './gltf';

export interface LoadedKit {
  manifest: KitManifest;
  building(role: BuildingRole, size: BuildingSize, rng: Rng): Object3D | null;
  prop(kind: string): Object3D | null;
  footprint(role: BuildingRole, size: BuildingSize): { w: number; d: number };
}

/** Fallback footprints from the architecture file, used when no mesh for a role has loaded. */
export const FOOTPRINT_TABLE: Record<BuildingSize, { w: number; d: number }> = {
  small: { w: 6, d: 6 },
  medium: { w: 9, d: 8 },
  large: { w: 12, d: 10 },
};

/** Candidates whose area is within this ratio of the best fit are interchangeable for variety. */
const VARIETY_AREA_RATIO = 1.25;

interface Template {
  url: string;
  object: Object3D;
  w: number;
  d: number;
}

const warned = new Set<string>();
function warnOnce(url: string, why: string): void {
  if (warned.has(url)) return;
  warned.add(url);
  console.warn(`Townforge: asset ${url} unavailable (${why}); using fallback geometry`);
}

const kitCache = new Map<ThemeId, Promise<LoadedKit>>();
const kitTemplates = new Map<ThemeId, Template[]>();

async function loadTemplate(url: string): Promise<Template | null> {
  try {
    const gltf = await loadGltf(url);
    const { object, size } = normalizeTemplate(gltf.scene);
    enableShadows(object);
    return { url, object, w: size.x, d: size.z };
  } catch (err) {
    warnOnce(url, err instanceof Error ? err.message : 'load failed');
    return null;
  }
}

function area(t: Template): number {
  return Math.max(0.01, t.w * t.d);
}

/** Loaded candidates for a role, ordered best fit first for the requested size. */
function rankCandidates(candidates: Template[], size: BuildingSize): Template[] {
  const want = FOOTPRINT_TABLE[size];
  const target = want.w * want.d;
  const score = (t: Template): number => Math.abs(Math.log(area(t) / target));
  return [...candidates].sort((a, b) => score(a) - score(b) || a.url.localeCompare(b.url));
}

function variants(ranked: Template[]): Template[] {
  const best = ranked[0];
  if (best === undefined) return [];
  return ranked.filter((t) => {
    const r = area(t) / area(best);
    return r <= VARIETY_AREA_RATIO && r >= 1 / VARIETY_AREA_RATIO;
  });
}

function cloneTemplate(t: Template): Object3D {
  // Geometry and materials are shared with the template; only the node tree is copied.
  return t.object.clone(true);
}

async function buildKit(theme: ThemeId, onProgress?: (p: number) => void): Promise<LoadedKit> {
  const manifest = KITS[theme];
  const urls = new Set<string>();
  for (const list of Object.values(manifest.buildings)) for (const u of list) urls.add(u);
  for (const u of Object.values(manifest.props)) urls.add(u);

  const total = urls.size;
  let done = 0;
  const templates = new Map<string, Template>();
  await Promise.all(
    [...urls].map(async (url) => {
      const t = await loadTemplate(url);
      if (t !== null) templates.set(url, t);
      done += 1;
      onProgress?.(total === 0 ? 1 : done / total);
    }),
  );
  if (total === 0) onProgress?.(1);
  kitTemplates.set(theme, [...templates.values()]);

  const loadedFor = (role: BuildingRole): Template[] => {
    const urlsForRole = manifest.buildings[role] ?? [];
    const out: Template[] = [];
    for (const u of urlsForRole) {
      const t = templates.get(u);
      if (t !== undefined) out.push(t);
    }
    return out;
  };

  return {
    manifest,
    building(role, size, rng) {
      const pool = variants(rankCandidates(loadedFor(role), size));
      if (pool.length === 0) return null;
      return cloneTemplate(rng.pick(pool));
    },
    prop(kind) {
      const url = manifest.props[kind];
      if (url === undefined) return null;
      const t = templates.get(url);
      return t === undefined ? null : cloneTemplate(t);
    },
    footprint(role, size) {
      // Kits flagged scaleToFootprint are rescaled to the lot by the town builder, so the table size is the truth.
      if (manifest.scaleToFootprint === true) return { ...FOOTPRINT_TABLE[size] };
      const unit = manifest.unitScale ?? 1;
      const best = rankCandidates(loadedFor(role), size)[0];
      if (best === undefined) return { ...FOOTPRINT_TABLE[size] };
      return { w: best.w * unit, d: best.d * unit };
    },
  };
}

/** Loads (once per theme) and returns the kit. Missing files are tolerated and reported once with console.warn. */
export function loadKit(theme: ThemeId, onProgress?: (p: number) => void): Promise<LoadedKit> {
  const cached = kitCache.get(theme);
  if (cached !== undefined) {
    void cached.then(() => onProgress?.(1));
    return cached;
  }
  const p = buildKit(theme, onProgress);
  kitCache.set(theme, p);
  // A failed build must not poison the cache.
  p.catch(() => kitCache.delete(theme));
  return p;
}

/** Frees the GPU resources of every cached kit. Clones handed out earlier become invalid. */
export function disposeKits(): void {
  for (const list of kitTemplates.values()) {
    for (const t of list) {
      t.object.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      });
    }
  }
  kitTemplates.clear();
  kitCache.clear();
}
