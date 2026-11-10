// Turns blueprints (lists of primitive parts, see world/spec.ts) into flat-shaded geometry in a GeoBatch.
// Every part is built with its base at y = 0 and centred on x/z, sized in metres, then placed by one
// matrix: building transform, the front flip, the part offset and the part rotation. All geometry is
// non-indexed with per-face normals, so the batch merges it without smoothing.
import * as THREE from 'three';
import type { Rng } from '../world/rng';
import { expandParts } from '../world/blueprints';
import type { Blueprint, BlueprintPart, PartShape, PartTone, StyleSpec } from '../world/spec';
import type { GeoBatch, MaterialCache } from './batch';

export interface BlueprintEnv { batch: GeoBatch; mats: MaterialCache; rng: Rng }
export interface BlueprintPlacement { x: number; z: number; rotY: number; w: number; d: number }
export interface BlueprintResult { height: number; door: THREE.Vector3 }

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const HEX = /^#[0-9a-f]{6}$/i;
const safeHex = (c: string, fallback: string): string => (HEX.test(c) ? c : fallback);
const UP = new THREE.Vector3(0, 1, 0);

/** Repeat expansion from world/blueprints, after dropping parts that carry non-finite numbers. */
export function expandBlueprintParts(parts: readonly BlueprintPart[]): BlueprintPart[] {
  return expandParts(parts.filter((p) => [p.x, p.z, p.y, p.w, p.d, p.h, p.rot, p.repeat, p.gap].every(Number.isFinite)));
}

type Tri = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

function fromTris(tris: readonly Tri[]): THREE.BufferGeometry {
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    t.forEach((v, j) => {
      pos[i * 9 + j * 3] = v[0];
      pos[i * 9 + j * 3 + 1] = v[1];
      pos[i * 9 + j * 3 + 2] = v[2];
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

/** Scales a unit geometry (xz footprint 1, base at y = 0 after `lift`) to metres and drops its base on y = 0. */
function sized(g: THREE.BufferGeometry, sx: number, sy: number, sz: number, lift: number): THREE.BufferGeometry {
  g.scale(sx, sy, sz);
  if (lift !== 0) g.translate(0, lift, 0);
  return g;
}

function gable(w: number, h: number, d: number): THREE.BufferGeometry {
  const a = [-w / 2, 0, -d / 2] as const;
  const b = [w / 2, 0, -d / 2] as const;
  const c = [w / 2, 0, d / 2] as const;
  const dd = [-w / 2, 0, d / 2] as const;
  const e = [-w / 2, h, 0] as const;
  const f = [w / 2, h, 0] as const;
  return fromTris([[a, b, c], [a, c, dd], [a, dd, e], [b, f, c], [dd, c, f], [dd, f, e], [b, a, e], [b, e, f]]);
}

function wedge(w: number, h: number, d: number): THREE.BufferGeometry {
  const a = [-w / 2, 0, -d / 2] as const;
  const b = [w / 2, 0, -d / 2] as const;
  const c = [w / 2, 0, d / 2] as const;
  const dd = [-w / 2, 0, d / 2] as const;
  const e = [w / 2, h, -d / 2] as const;
  const f = [w / 2, h, d / 2] as const;
  return fromTris([[a, b, c], [a, c, dd], [b, e, f], [b, f, c], [a, e, b], [dd, c, f], [a, dd, f], [a, f, e]]);
}

/** Geometry for one part, sized in metres, base at y = 0, centred on x/z. Arch is two pieces. */
export function shapeGeometries(shape: PartShape, w: number, h: number, d: number): THREE.BufferGeometry[] {
  const list: THREE.BufferGeometry[] = [];
  switch (shape) {
    case 'box': list.push(sized(new THREE.BoxGeometry(1, 1, 1), w, h, d, h / 2)); break;
    case 'cylinder': list.push(sized(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), w, h, d, h / 2)); break;
    case 'cone': list.push(sized(new THREE.ConeGeometry(0.5, 1, 10), w, h, d, h / 2)); break;
    case 'pyramid': list.push(sized(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4), w, h, d, h / 2)); break;
    case 'gable': list.push(gable(w, h, d)); break;
    case 'wedge': list.push(wedge(w, h, d)); break;
    case 'dome': list.push(sized(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), w, h * 2, d, 0)); break;
    case 'sphere': list.push(sized(new THREE.SphereGeometry(0.5, 10, 8), w, h, d, h / 2)); break;
    case 'arch': {
      const ry = Math.min(w / 2, h / 2);
      const bodyH = h - ry;
      list.push(sized(new THREE.BoxGeometry(1, 1, 1), w, bodyH, d, bodyH / 2));
      const top = new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2);
      list.push(sized(top, w / 2, ry, d, bodyH));
      break;
    }
    case 'ring': {
      // Unit torus with a thin tube; x and z scale to the footprint, y scales so the tube is t thick.
      const t = Math.max(0.01, Math.min(h / 2, Math.min(w, d) / 4));
      const tr = Math.min(0.5, t / (Math.min(w, d) / 2));
      const g = new THREE.TorusGeometry(1, tr, 6, 12).rotateX(Math.PI / 2);
      list.push(sized(g, w / 2 / (1 + tr), t / tr, d / 2 / (1 + tr), t));
      break;
    }
  }
  return list;
}

function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.computeVertexNormals();
  return n;
}

function drift(color: string, shift: number): string {
  if (shift === 0) return color;
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  return `#${new THREE.Color().setHSL(hsl.h, hsl.s, clamp(hsl.l + shift, 0.02, 0.98)).getHexString()}`;
}

type Palette = Record<PartTone, THREE.Material>;

function palette(style: StyleSpec, mats: MaterialCache, shifts: { wall: number; wall2: number; roof: number }): Palette {
  const c = (v: string, fb: string): string => safeHex(v, fb);
  const matte = (v: string): THREE.Material => mats.get(v);
  const glow = c(style.glow, '#ffd27a');
  return {
    wall: matte(drift(c(style.wall, '#b0a090'), shifts.wall)),
    wall2: matte(drift(c(style.wall2, '#908070'), shifts.wall2)),
    roof: matte(drift(c(style.roof, '#604030'), shifts.roof)),
    trim: matte(c(style.trim, '#d8d0c0')),
    accent: matte(c(style.accent, '#c04030')),
    dark: matte(c(style.dark, '#2a2420')),
    glass: mats.get(c(style.glass, '#6f9bb8'), { roughness: 0.15, metalness: 0.3 }),
    glow: mats.get(glow, { emissive: glow, emissiveIntensity: 1.6 }),
  };
}

const tmpA = new THREE.Matrix4();
const tmpB = new THREE.Matrix4();

/** Adds already-expanded parts. `fw`/`fd` are the footprint in metres; `hScale` scales y and h (props). */
function emit(
  parts: readonly BlueprintPart[], pal: Palette, batch: GeoBatch, base: THREE.Matrix4,
  fw: number, fd: number, hScale: number,
): number {
  let top = 0;
  for (const p of parts) {
    const pw = clamp(p.w, 0.02, 1.4) * fw;
    const pd = clamp(p.d, 0.02, 1.4) * fd;
    const ph = clamp(p.h, 0.05, 30) * hScale;
    const py = clamp(p.y, 0, 30) * hScale;
    const px = clamp(p.x, -0.7, 0.7) * fw;
    const pz = clamp(p.z, -0.7, 0.7) * fd;
    const m = new THREE.Matrix4().multiplyMatrices(base, tmpA.makeTranslation(px, py, pz));
    m.multiply(tmpB.makeRotationY(p.rot * DEG));
    const mat = pal[p.tone] ?? pal.wall;
    for (const g of shapeGeometries(p.shape, pw, ph, pd)) batch.add(flat(g), mat, m);
    top = Math.max(top, py + ph);
  }
  return top;
}

/**
 * Adds one blueprint building. Blueprint +z is the street-facing front; the building's own frame faces
 * -Z (as the procedural buildings do), so the part frame is turned half a revolution before rotY applies.
 * Returns the roof height and the point 1 m outside the door on the street side.
 */
export function addBlueprint(bp: Blueprint, style: StyleSpec, placed: BlueprintPlacement, env: BlueprintEnv): BlueprintResult {
  const variety = clamp(Number.isFinite(style.variety) ? style.variety : 0.5, 0, 1);
  const step = (): number => Math.round(env.rng.range(-1, 1) * 2) / 2 * 0.06 * variety;
  const pal = palette(style, env.mats, { wall: step(), wall2: step(), roof: step() });
  const base = new THREE.Matrix4()
    .makeTranslation(placed.x, 0, placed.z)
    .multiply(new THREE.Matrix4().makeRotationY(placed.rotY + Math.PI));
  const height = emit(expandBlueprintParts(bp.parts), pal, env.batch, base, placed.w, placed.d, 1);
  const doorX = clamp(Number.isFinite(bp.doorX) ? bp.doorX : 0, -0.4, 0.4);
  const door = new THREE.Vector3(doorX * placed.w, 0, placed.d / 2 + 1).applyMatrix4(base);
  return { height, door };
}

/** Adds one prop built from parts on a size x size footprint; heights scale with `scale` only. */
export function addPropParts(
  parts: readonly BlueprintPart[], size: number, style: StyleSpec,
  placed: { x: number; z: number; rotY: number; scale: number }, env: BlueprintEnv,
): number {
  const pal = palette(style, env.mats, { wall: 0, wall2: 0, roof: 0 });
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(placed.x, 0, placed.z),
    new THREE.Quaternion().setFromAxisAngle(UP, placed.rotY),
    new THREE.Vector3(1, 1, 1),
  );
  const fp = clamp(size, 0.3, 6) * placed.scale;
  return emit(expandBlueprintParts(parts), pal, env.batch, base, fp, fp, placed.scale);
}
