// Procedural fallback buildings, used when a kit has no mesh for a role (all of western, and gaps elsewhere).
// Everything is added to a GeoBatch with its world transform baked in. Local frame: the door faces -Z.
// Walls, roofs and timbers take generated surfaces (see surfaces.ts) with UVs in metres.
import * as THREE from 'three';
import type { Rng } from '../world/rng';
import type { BuildingSize, SurfaceKind, ThemeId } from '../world/spec';
import type { GeoBatch, MaterialCache } from './batch';
import type { PlacedBuilding } from './layout';
import { getSurface, groundTone, surfaceDefaults, surfaceScale } from './surfaces';
import type { Quality } from './surfaces';
import { projectWorldUV } from './surfaces/uv';

export const BODY_HEIGHT: Record<BuildingSize, number> = { small: 4, medium: 6, large: 9 };

const PALETTES: Record<ThemeId, { walls: string[]; roofs: string[] }> = {
  western: { walls: ['#8b5a3c', '#a0703f', '#7a4e32', '#b88a55', '#6e4630', '#9c6b4a'], roofs: ['#5b4030', '#4a3426', '#6a4a35'] },
  medieval: { walls: ['#d9c9a3', '#cdb98f', '#e0d2b4', '#c9b48a'], roofs: ['#8a3b2b', '#6b4a3a', '#4e5a4a', '#7a5a3a'] },
  scifi: { walls: ['#c8ccd4', '#aeb6c2', '#d8dce2', '#98a4b4'], roofs: ['#586070', '#454c5a', '#6b7385'] },
  modern: { walls: ['#d8d4cc', '#b9c0c8', '#c9b8a8', '#aab3a0'], roofs: ['#6f7378', '#5c6065', '#80848a'] },
};

const DOOR_W = 1.5;
const RECESS = 0.45;

export interface ProcEnv {
  batch: GeoBatch;
  mats: MaterialCache;
  theme: ThemeId;
  /** Surface weathering and wetness, 0..1 (defaults 0.4 and 0), and texture quality (default: surfaceDefaults()). */
  wear?: number;
  wet?: number;
  quality?: Quality;
}

export class Part {
  constructor(private readonly env: ProcEnv, private readonly base: THREE.Matrix4) {}

  /** With `kind` the part takes that generated surface in `color` (held to the kind's natural range), with UVs in metres; without, a flat colour. */
  geo(g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, opts?: Parameters<MaterialCache['get']>[1], kind?: SurfaceKind): void {
    if (!kind) {
      const m = new THREE.Matrix4().multiplyMatrices(this.base, new THREE.Matrix4().makeTranslation(x, y, z));
      this.env.batch.add(g, this.env.mats.get(color, opts), m);
      return;
    }
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    n.translate(x, y, z);
    projectWorldUV(n, surfaceScale(kind));
    const env = this.env;
    const wear = env.wear ?? 0.4;
    const quality = env.quality ?? surfaceDefaults().quality;
    // The colour is held to what the material is found in, and the surface weathers in world space.
    const mat = getSurface(kind, groundTone(kind, color, wear), { wear, wet: env.wet ?? 0, quality, seed: 0, tint: true, worn: quality > 0 });
    env.batch.add(n, mat, this.base);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, opts?: Parameters<MaterialCache['get']>[1], kind?: SurfaceKind): void {
    this.geo(new THREE.BoxGeometry(w, h, d), color, x, y, z, opts, kind);
  }
}

/** Rounded rectangle footprint extruded upward from y = 0. */
function roundedSlab(w: number, d: number, h: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Walls with a real recess: back block plus left, right and lintel slabs that leave an opening for the door. */
function recessedBody(p: Part, w: number, h: number, d: number, wall: string, doorH: number, kind: SurfaceKind): void {
  p.box(w, h, d - RECESS, 0, h / 2, RECESS / 2, wall, undefined, kind);
  const sideW = (w - DOOR_W) / 2;
  const zf = -d / 2 + RECESS / 2;
  p.box(sideW, h, RECESS, -(DOOR_W / 2 + sideW / 2), h / 2, zf, wall, undefined, kind);
  p.box(sideW, h, RECESS, DOOR_W / 2 + sideW / 2, h / 2, zf, wall, undefined, kind);
  p.box(DOOR_W, h - doorH, RECESS, 0, doorH + (h - doorH) / 2, zf, wall, undefined, kind);
  p.box(DOOR_W - 0.1, doorH, 0.1, 0, doorH / 2, -d / 2 + RECESS + 0.05, '#2b1d14', undefined, 'timber'); // door leaf at the back of the recess
}

function frontWindows(p: Part, w: number, h: number, d: number, color: string, opts?: Parameters<MaterialCache['get']>[1]): void {
  const slab = (w - DOOR_W) / 2;
  const x = DOOR_W / 2 + slab / 2;
  if (slab < 1.3) return;
  for (const sx of [-1, 1]) p.box(0.9, 1.1, 0.12, sx * x, h * 0.55, -d / 2 - 0.02, color, opts);
  for (const sx of [-1, 1]) p.box(0.12, 1.1, 0.9, sx * (w / 2 + 0.02), h * 0.55, 0, color, opts);
}

function western(p: Part, w: number, h: number, d: number, wall: string, roof: string): void {
  recessedBody(p, w, h, d, wall, 2.4, 'planks');
  p.box(w + 0.3, 0.2, d + 0.3, 0, h + 0.1, 0, roof, undefined, 'shingle');
  // false front: a facade 1.5 m above the roof line, flush with the street wall
  p.box(w, 1.5, 0.3, 0, h + 0.75, -d / 2 + 0.15, wall, undefined, 'timber');
  p.box(w + 0.3, 0.2, 0.45, 0, h + 1.6, -d / 2 + 0.1, roof, undefined, 'timber');
  frontWindows(p, w, h, d, '#2a3a46');
  // porch slab, four posts and a header beam
  const pd = 1.6;
  p.box(w - 0.4, 0.15, pd, 0, 0.075, -d / 2 - pd / 2, '#6e4630', undefined, 'planks');
  for (const sx of [-1, 1]) for (const zo of [0.3, pd - 0.1]) p.box(0.18, 2.6, 0.18, sx * (w / 2 - 0.5), 1.45, -d / 2 - zo, '#5b4030', undefined, 'timber');
  p.box(w - 0.4, 0.18, 0.25, 0, 2.7, -d / 2 - pd + 0.1, '#5b4030', undefined, 'timber');
}

function medieval(p: Part, w: number, h: number, d: number, wall: string, roof: string): void {
  recessedBody(p, w, h, d, wall, 2.4, 'plaster');
  const timber = '#4a3426';
  for (const y of [2.55, h - 0.1]) {
    p.box(w + 0.06, 0.2, 0.08, 0, y, -d / 2 - 0.02, timber, undefined, 'timber');
    for (const sx of [-1, 1]) p.box(0.08, 0.2, d + 0.06, sx * (w / 2 + 0.02), y, 0, timber, undefined, 'timber');
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.24, h, 0.24, sx * w / 2, h / 2, sz * d / 2, timber, undefined, 'timber');
  for (const sx of [-1, 1]) p.box(0.2, 2.4, 0.1, sx * (DOOR_W / 2 + 0.1), 1.2, -d / 2 - 0.02, timber, undefined, 'timber');
  frontWindows(p, w, h, d, '#3a4a58');
  // steep gable, ridge running front to back
  const rw = w + 0.7;
  const rd = d + 0.7;
  const rh = Math.max(2.4, w * 0.6);
  const tri = new THREE.Shape();
  tri.moveTo(-rw / 2, 0);
  tri.lineTo(rw / 2, 0);
  tri.lineTo(0, rh);
  tri.closePath();
  const g = new THREE.ExtrudeGeometry(tri, { depth: rd, bevelEnabled: false });
  g.translate(0, 0, -rd / 2);
  p.geo(g, roof, 0, h, 0, undefined, 'tile');
}

function scifi(p: Part, w: number, h: number, d: number, wall: string, roof: string, accent: string): void {
  p.geo(roundedSlab(w, d, h, 0.7), wall, 0, 0, 0, undefined, 'metal_panel');
  p.geo(roundedSlab(w + 0.3, d + 0.3, 0.25, 0.8), roof, 0, h, 0, undefined, 'hull_plate');
  p.geo(roundedSlab(w + 0.08, d + 0.08, 0.2, 0.72), '#222831', 0, h - 0.75, 0, { emissive: accent, emissiveIntensity: 1.4 });
  // door: dark panel with a lit frame, proud of the curved hull
  p.box(DOOR_W - 0.1, 2.4, 0.1, 0, 1.2, -d / 2 - 0.03, '#161a20');
  const lit = { emissive: '#7fe8ff', emissiveIntensity: 1.2 };
  p.box(0.1, 2.5, 0.14, -DOOR_W / 2, 1.25, -d / 2 - 0.05, '#7fe8ff', lit);
  p.box(0.1, 2.5, 0.14, DOOR_W / 2, 1.25, -d / 2 - 0.05, '#7fe8ff', lit);
  p.box(DOOR_W + 0.1, 0.1, 0.14, 0, 2.5, -d / 2 - 0.05, '#7fe8ff', lit);
  const slit = (w - DOOR_W) / 2 - 0.8;
  if (slit > 0.6) for (const sx of [-1, 1]) p.box(slit, 0.35, 0.1, sx * (DOOR_W / 2 + 0.4 + slit / 2), h * 0.55, -d / 2 - 0.02, '#9fe8ff', lit);
}

function modern(p: Part, w: number, h: number, d: number, wall: string, roof: string): void {
  recessedBody(p, w, h, d, wall, 2.4, 'concrete');
  p.box(w + 0.2, 0.25, d + 0.2, 0, h + 0.125, 0, roof, undefined, 'concrete');
  p.box(1.4, 0.9, 1.4, w * 0.2, h + 0.7, d * 0.15, '#8d9298', undefined, 'metal_panel');
  // window grid on the second material
  const glass = '#6f9bb8';
  const gl = { roughness: 0.25, metalness: 0.4 };
  const floors = Math.max(1, Math.round(h / 3));
  const fh = h / floors;
  const cols = Math.max(2, Math.floor((w - 1.4) / 1.8));
  const cw = (w - 0.8) / cols;
  for (let r = 0; r < floors; r++) {
    const y = (r + 0.58) * fh;
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + 0.4 + cw * (c + 0.5);
      if (r === 0 && Math.abs(x) < DOOR_W / 2 + 0.7) continue;
      p.box(Math.min(1.2, cw - 0.5), 1.2, 0.1, x, y, -d / 2 - 0.02, glass, gl);
    }
    const sc = Math.max(1, Math.floor((d - 1.4) / 2));
    const sw = (d - 0.8) / sc;
    for (let c = 0; c < sc; c++) {
      const z = -d / 2 + 0.4 + sw * (c + 0.5);
      for (const sx of [-1, 1]) p.box(0.1, 1.2, Math.min(1.2, sw - 0.5), sx * (w / 2 + 0.02), y, z, glass, gl);
    }
  }
}

export interface ProceduralResult { height: number; signY: number }

/** Adds one themed fallback building to the batch. The door faces -Z locally and the result is rotated by rotY. */
export function addProceduralBuilding(env: ProcEnv, b: PlacedBuilding, accent: string, rng: Rng): ProceduralResult {
  const base = new THREE.Matrix4().multiplyMatrices(
    new THREE.Matrix4().makeTranslation(b.x, 0, b.z),
    new THREE.Matrix4().makeRotationY(b.rotY),
  );
  const p = new Part(env, base);
  const pal = PALETTES[env.theme];
  const wall = rng.pick(pal.walls);
  const roof = rng.pick(pal.roofs);
  const h = BODY_HEIGHT[b.size];
  switch (env.theme) {
    case 'western': western(p, b.w, h, b.d, wall, roof); return { height: h + 1.6, signY: h + 0.75 };
    case 'medieval': medieval(p, b.w, h, b.d, wall, roof); return { height: h + Math.max(2.4, b.w * 0.6), signY: 3.2 };
    case 'scifi': scifi(p, b.w, h, b.d, wall, roof, accent); return { height: h + 0.25, signY: 3.1 };
    case 'modern': modern(p, b.w, h, b.d, wall, roof); return { height: h + 0.25, signY: 3.1 };
  }
}
