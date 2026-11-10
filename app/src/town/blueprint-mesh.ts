// Turns blueprints (lists of primitive parts, see world/spec.ts) into textured geometry in a GeoBatch.
// Every part is built with its base at y = 0 and centred on x/z, sized in metres, moved into the
// building's own frame (part offset and rotation), given box-projected UVs in metres there, and only
// then placed in the world. A plank is therefore the same size on a hut and on a hall, and courses
// stay level on a building that stands at an angle to the street. Geometry is non-indexed; flat-sided
// shapes carry face normals, round ones keep smooth normals. Each vertex also carries a colour: the
// building's own drift from the style colour, darkened toward the ground where dirt and damp collect.
import * as THREE from 'three';
import type { Rng } from '../world/rng';
import { makeRng } from '../world/rng';
import { expandParts } from '../world/blueprints';
import type { Blueprint, BlueprintPart, MoodSpec, PartShape, PartTone, StyleSpec, SurfaceSet, ThemeId } from '../world/spec';
import type { GeoBatch, MaterialCache } from './batch';
import { dressParts } from './detail';
import { GLASS_SCALE, getSurface, glassMaterial, resolveSurfaces, surfaceDefaults, surfaceFamily, surfaceScale } from './surfaces';
import type { Quality, SurfaceId } from './surfaces';
import { projectWorldUV } from './surfaces/uv';

export interface BlueprintEnv { batch: GeoBatch; mats: MaterialCache; rng: Rng }
export interface BlueprintPlacement { x: number; z: number; rotY: number; w: number; d: number }
export interface BlueprintResult { height: number; door: THREE.Vector3 }
/**
 * Optional look controls. What is left out follows surfaceDefaults(): the quality, theme and mood the
 * current town build last stated (see surfaces.ts), or quality 2 and 'medieval' before any build.
 */
export interface BlueprintOptions {
  /** 0 low (256 px maps, fewer sides, no bevels), 1 medium, 2 high (bevelled boxes). */
  quality?: Quality;
  /** Used with `mood` to infer surfaces when the style carries none. */
  theme?: ThemeId;
  mood?: MoodSpec;
  /** Texture seed; the same seed shares cached maps across towns. Default 0. */
  seed?: number;
  /** Set false to skip the architectural dressing pass. */
  dress?: boolean;
}

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const HEX = /^#[0-9a-f]{6}$/i;
const safeHex = (c: string, fallback: string): string => (HEX.test(c) ? c : fallback);
const UP = new THREE.Vector3(0, 1, 0);

/** Repeat expansion from world/blueprints, after dropping parts that carry non-finite numbers. */
export function expandBlueprintParts(parts: readonly BlueprintPart[]): BlueprintPart[] {
  return expandParts(parts.filter((p) => [p.x, p.z, p.y, p.w, p.d, p.h, p.rot, p.repeat, p.gap].every(Number.isFinite)));
}

type V3 = readonly [number, number, number];
type Tri = readonly [V3, V3, V3];

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

export interface BoxDetail {
  /** Width of the 45 degree bevel on every edge, metres; 0 for sharp edges. */
  chamfer: number;
  /** Height above the base at which the side faces are split, so vertex colour can grade near the ground; 0 for none. */
  split: number;
}

const PLAIN_BOX: BoxDetail = { chamfer: 0, split: 0 };

/**
 * A box with its base on y = 0, optionally bevelled on all twelve edges (one flat facet per edge, a
 * triangle per corner) and with its sides split at a height. Triangles are wound outward.
 */
export function boxGeometry(w: number, h: number, d: number, detail: BoxDetail = PLAIN_BOX): THREE.BufferGeometry {
  const c = Math.max(0, Math.min(detail.chamfer, Math.min(w, h, d) * 0.3));
  const x1 = w / 2;
  const z1 = d / 2;
  const ya = c;
  const yb = h - c;
  // The outline of the sides seen from above, and the inset outline of the top and bottom faces.
  const ring: (readonly [number, number])[] = [
    [x1, -z1 + c], [x1, z1 - c], [x1 - c, z1], [-x1 + c, z1], [-x1, z1 - c], [-x1, -z1 + c], [-x1 + c, -z1], [x1 - c, -z1],
  ];
  const cap: (readonly [number, number])[] = [[x1 - c, -z1 + c], [x1 - c, z1 - c], [-x1 + c, z1 - c], [-x1 + c, -z1 + c]];
  const levels = [ya];
  if (detail.split > ya + 0.05 && detail.split < yb - 0.05) levels.push(detail.split);
  levels.push(yb);
  const tris: Tri[] = [];
  const mid = h / 2;
  const tri = (a: V3, b: V3, e: V3): void => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = e[0] - a[0];
    const vy = e[1] - a[1];
    const vz = e[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    // The box is convex, so a face is wound outward when its normal points away from the centre.
    const out = nx * (a[0] + b[0] + e[0]) + ny * (a[1] + b[1] + e[1] - 3 * mid) + nz * (a[2] + b[2] + e[2]);
    tris.push(out >= 0 ? [a, b, e] : [a, e, b]);
  };
  const quad = (a: V3, b: V3, e: V3, f: V3): void => {
    tri(a, b, e);
    tri(a, e, f);
  };
  const at = (p: readonly [number, number] | undefined, y: number): V3 => [p ? p[0] : 0, y, p ? p[1] : 0];
  for (let i = 0; i < 8; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % 8];
    for (let l = 0; l + 1 < levels.length; l++) {
      const lo = levels[l] as number;
      const hi = levels[l + 1] as number;
      quad(at(p, lo), at(q, lo), at(q, hi), at(p, hi));
    }
    if (c > 0) {
      // Faces (even i) meet the caps along an edge; bevels (odd i) meet them at a corner.
      const k = i >> 1;
      const e0 = cap[i % 2 === 0 ? k : (k + 1) % 4];
      const e1 = cap[(k + 1) % 4];
      quad(at(p, yb), at(q, yb), at(e1, h), at(e0, h));
      quad(at(p, ya), at(q, ya), at(e1, 0), at(e0, 0));
    }
  }
  quad(at(cap[0], h), at(cap[1], h), at(cap[2], h), at(cap[3], h));
  quad(at(cap[0], 0), at(cap[1], 0), at(cap[2], 0), at(cap[3], 0));
  return fromTris(tris);
}

/**
 * Geometry for one part, sized in metres, base at y = 0, centred on x/z. Arch is two pieces.
 * `segments` sets how many sides round shapes get; `box` bevels and splits box parts.
 */
export function shapeGeometries(shape: PartShape, w: number, h: number, d: number, segments = 10, box: BoxDetail = PLAIN_BOX): THREE.BufferGeometry[] {
  const list: THREE.BufferGeometry[] = [];
  const n = Math.max(6, Math.round(segments));
  switch (shape) {
    case 'box': list.push(boxGeometry(w, h, d, box)); break;
    case 'cylinder': list.push(sized(new THREE.CylinderGeometry(0.5, 0.5, 1, n), w, h, d, h / 2)); break;
    case 'cone': list.push(sized(new THREE.ConeGeometry(0.5, 1, n), w, h, d, h / 2)); break;
    case 'pyramid': list.push(sized(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4), w, h, d, h / 2)); break;
    case 'gable': list.push(gable(w, h, d)); break;
    case 'wedge': list.push(wedge(w, h, d)); break;
    case 'dome': list.push(sized(new THREE.SphereGeometry(0.5, n, Math.max(4, n >> 1), 0, Math.PI * 2, 0, Math.PI / 2), w, h * 2, d, 0)); break;
    case 'sphere': list.push(sized(new THREE.SphereGeometry(0.5, n, Math.max(6, (n * 3) >> 2)), w, h, d, h / 2)); break;
    case 'arch': {
      const ry = Math.min(w / 2, h / 2);
      const bodyH = h - ry;
      list.push(boxGeometry(w, bodyH, d));
      const top = new THREE.CylinderGeometry(1, 1, 1, n).rotateX(Math.PI / 2);
      list.push(sized(top, w / 2, ry, d, bodyH));
      break;
    }
    case 'ring': {
      // Unit torus with a thin tube; x and z scale to the footprint, y scales so the tube is t thick.
      const t = Math.max(0.01, Math.min(h / 2, Math.min(w, d) / 4));
      const tr = Math.min(0.5, t / (Math.min(w, d) / 2));
      const g = new THREE.TorusGeometry(1, tr, 6, Math.max(12, n + 2)).rotateX(Math.PI / 2);
      list.push(sized(g, w / 2 / (1 + tr), t / tr, d / 2 / (1 + tr), t));
      break;
    }
  }
  return list;
}

/** Shapes whose curved faces keep the smooth normals they were built with. */
const SMOOTH: ReadonlySet<PartShape> = new Set<PartShape>(['cylinder', 'cone', 'dome', 'sphere', 'ring']);

/** Non-indexed geometry with normals: per face for flat-sided shapes, as built for round ones. */
function unindexed(g: THREE.BufferGeometry, smooth: boolean): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  if (!smooth || !n.getAttribute('normal')) n.computeVertexNormals();
  return n;
}

/** Which way the grain of each wooden surface runs in its texture. */
const GRAIN: Partial<Record<SurfaceId, 'u' | 'v'>> = { timber: 'u', log: 'u', planks: 'v', bark: 'v' };

interface ToneLook {
  material: THREE.Material;
  /** Metres per texture repeat. */
  tile: number;
  /** Texture axis the grain follows, for surfaces that have one. */
  grain?: 'u' | 'v';
  /** Linear colour multiplier for this building (colour drift). */
  tint: number;
  /** Whether dirt and damp darken this tone toward the ground. */
  grime: boolean;
}
type Palette = Record<PartTone, ToneLook>;

interface Look { surfaces: SurfaceSet; quality: Quality; seed: number }

/** Lightness shift (HSL) expressed as the linear multiplier that produces it on this colour. */
function driftFactor(hex: string, shift: number): number {
  if (shift === 0) return 1;
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  const l = Math.max(0.04, hsl.l);
  return clamp(Math.pow(clamp(l + shift, 0.02, 0.98) / l, 2.2), 0.5, 1.8);
}

function palette(style: StyleSpec, mats: MaterialCache, look: Look, shifts: { wall: number; wall2: number; roof: number }): Palette {
  const s = look.surfaces;
  const wallOpts = { wear: s.wear, wet: s.wet * 0.5, quality: look.quality, seed: look.seed, tint: true };
  const roofOpts = { ...wallOpts, wet: s.wet * 0.85 };
  const surf = (kind: SurfaceId, hex: string, tint: number, roof = false): ToneLook => ({
    material: getSurface(kind, hex, roof ? roofOpts : wallOpts), tile: surfaceScale(kind), grain: GRAIN[kind], tint, grime: !roof,
  });
  const wall = safeHex(style.wall, '#b0a090');
  const wall2 = safeHex(style.wall2, '#908070');
  const roof = safeHex(style.roof, '#604030');
  const glow = safeHex(style.glow, '#ffd27a');
  // Dark parts are doors, beams and frames: aged timber on most buildings, metal on metal ones.
  const fam = surfaceFamily(s.wall);
  const darkKind: SurfaceId = fam === 'metal' || fam === 'glass' ? 'metal_panel' : fam === 'organic' ? 'bark' : fam === 'mineral' ? 'stone' : 'timber';
  return {
    wall: surf(s.wall, wall, driftFactor(wall, shifts.wall)),
    wall2: surf(s.wall2, wall2, driftFactor(wall2, shifts.wall2)),
    roof: surf(s.roof, roof, driftFactor(roof, shifts.roof), true),
    trim: surf(s.trim, safeHex(style.trim, '#d8d0c0'), 1),
    accent: surf('paint', safeHex(style.accent, '#c04030'), 1),
    dark: surf(darkKind, safeHex(style.dark, '#2a2420'), 1),
    glass: { material: glassMaterial(safeHex(style.glass, '#6f9bb8'), glow), tile: GLASS_SCALE, tint: 1, grime: false },
    glow: { material: mats.get(glow, { emissive: glow, emissiveIntensity: 1.6 }), tile: 1, tint: 1, grime: false },
  };
}

/** Vertex colours: the tone's tint, graded darker over the lowest metre and a half where splash-back and damp sit. */
function paint(g: THREE.BufferGeometry, tone: ToneLook, wear: number, wet: number): void {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const dirt = tone.grime ? 0.1 + 0.28 * wear : 0;
  const damp = tone.grime ? 0.16 * wet : 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const low = clamp(1 - y / 1.5, 0, 1);
    const lower = clamp(1 - y / 2.6, 0, 1);
    const k = tone.tint * (1 - dirt * low * low - damp * lower);
    col[i * 3] = k;
    col[i * 3 + 1] = k;
    col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/**
 * Splits a non-indexed geometry into its sloping faces and its upright ones. A gable or lean-to roof
 * part is roofing on the slopes only: the triangles under the ridge are wall.
 */
function splitUpright(g: THREE.BufferGeometry): { slopes: THREE.BufferGeometry; upright: THREE.BufferGeometry } {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const keep: number[][] = [[], []];
  const normals: number[][] = [[], []];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const side = Math.abs(nor.getY(i)) < 0.2 ? 1 : 0;
    for (let j = 0; j < 3; j++) {
      (keep[side] as number[]).push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
      (normals[side] as number[]).push(nor.getX(i + j), nor.getY(i + j), nor.getZ(i + j));
    }
  }
  const make = (k: number): THREE.BufferGeometry => {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(keep[k] as number[], 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(normals[k] as number[], 3));
    return out;
  };
  g.dispose();
  return { slopes: make(0), upright: make(1) };
}

const tmpA = new THREE.Matrix4();
const tmpB = new THREE.Matrix4();
const local = new THREE.Matrix4();

/**
 * Adds already-expanded parts. `fw`/`fd` are the footprint in metres; `hScale` scales y and h (props).
 * Returns the height of the tallest of the first `count` parts (the ones the blueprint authored).
 */
function emit(
  parts: readonly BlueprintPart[], count: number, pal: Palette, batch: GeoBatch, base: THREE.Matrix4,
  fw: number, fd: number, hScale: number, look: Look, uOff: number,
): number {
  let top = 0;
  const segments = look.quality === 0 ? 10 : 16;
  const wear = clamp(look.surfaces.wear, 0, 1);
  const wet = clamp(look.surfaces.wet, 0, 1);
  parts.forEach((p, index) => {
    const pw = clamp(p.w, 0.002, 1.4) * fw;
    const pd = clamp(p.d, 0.002, 1.4) * fd;
    const ph = clamp(p.h, 0.02, 30) * hScale;
    const py = clamp(p.y, 0, 30) * hScale;
    const px = clamp(p.x, -0.7, 0.7) * fw;
    const pz = clamp(p.z, -0.7, 0.7) * fd;
    local.multiplyMatrices(tmpA.makeTranslation(px, py, pz), tmpB.makeRotationY(p.rot * DEG));
    const tone = pal[p.tone] ?? pal.wall;
    const thin = Math.min(pw, ph, pd);
    const box: BoxDetail = {
      chamfer: look.quality === 2 && thin > 0.3 ? Math.min(0.035, thin * 0.1) : 0,
      split: tone.grime && ph > 2.4 && py < 1.2 ? 1.5 - py : 0,
    };
    // Wood runs along the member: a post takes the grain up, a beam takes it along, whatever the texture's own lay.
    const across = Math.max(pw, pd);
    const long = ph > 2.5 * across ? 'v' : across > 2.5 * ph && Math.min(pw, pd) < 0.5 ? 'u' : null;
    const turn = tone.grain !== undefined && long !== null && tone.grain !== long;
    const finish = (g: THREE.BufferGeometry, look: ToneLook, turned: boolean): void => {
      if (g.getAttribute('position').count === 0) {
        g.dispose();
        return;
      }
      projectWorldUV(g, look.tile, uOff, 0, turned);
      paint(g, look, wear, wet);
      g.applyMatrix4(base);
      batch.add(g, look.material);
    };
    for (const raw of shapeGeometries(p.shape, pw, ph, pd, segments, box)) {
      const g = unindexed(raw, SMOOTH.has(p.shape) || (p.shape === 'arch' && raw.getAttribute('normal') !== undefined));
      g.applyMatrix4(local);
      if (p.tone === 'roof' && (p.shape === 'gable' || p.shape === 'wedge')) {
        const { slopes, upright } = splitUpright(g);
        finish(slopes, tone, false);
        finish(upright, pal.wall, false);
      } else {
        finish(g, tone, turn);
      }
    }
    if (index < count) top = Math.max(top, py + ph);
  });
  return top;
}

function lookFor(style: StyleSpec, opts: BlueprintOptions | undefined): Look {
  const d = surfaceDefaults();
  return {
    surfaces: resolveSurfaces(style, opts?.theme ?? d.theme, opts?.mood ?? d.mood),
    quality: opts?.quality ?? d.quality,
    seed: opts?.seed ?? 0,
  };
}

/**
 * Adds one blueprint building. Blueprint +z is the street-facing front; the building's own frame faces
 * -Z (as the procedural buildings do), so the part frame is turned half a revolution before rotY applies.
 * Parts are dressed (see detail.ts) before meshing. Returns the roof height of the authored parts and
 * the point 1 m outside the door on the street side.
 */
export function addBlueprint(
  bp: Blueprint, style: StyleSpec, placed: BlueprintPlacement, env: BlueprintEnv, opts?: BlueprintOptions,
): BlueprintResult {
  const variety = clamp(Number.isFinite(style.variety) ? style.variety : 0.5, 0, 1);
  const step = (): number => Math.round(env.rng.range(-1, 1) * 2) / 2 * 0.06 * variety;
  const look = lookFor(style, opts);
  const pal = palette(style, env.mats, look, { wall: step(), wall2: step(), roof: step() });
  const base = new THREE.Matrix4()
    .makeTranslation(placed.x, 0, placed.z)
    .multiply(new THREE.Matrix4().makeRotationY(placed.rotY + Math.PI));
  const doorX = clamp(Number.isFinite(bp.doorX) ? bp.doorX : 0, -0.4, 0.4);
  const authored = expandBlueprintParts(bp.parts);
  // The dressing pass and the texture offset draw from the building's position, not from env.rng, so
  // they never shift the random sequence the rest of the town build depends on.
  const own = makeRng(look.seed, `dress|${Math.round(placed.x * 100)}|${Math.round(placed.z * 100)}|${bp.id}`);
  const uOff = Math.floor(own.next() * 16) / 16;
  const parts = opts?.dress === false
    ? authored
    : dressParts(authored, { w: placed.w, d: placed.d, rng: own, surfaces: look.surfaces, doorX });
  const height = emit(parts, authored.length, pal, env.batch, base, placed.w, placed.d, 1, look, uOff);
  const door = new THREE.Vector3(doorX * placed.w, 0, placed.d / 2 + 1).applyMatrix4(base);
  return { height, door };
}

/** Adds one prop built from parts on a size x size footprint; heights scale with `scale` only. */
export function addPropParts(
  parts: readonly BlueprintPart[], size: number, style: StyleSpec,
  placed: { x: number; z: number; rotY: number; scale: number }, env: BlueprintEnv, opts?: BlueprintOptions,
): number {
  const look = lookFor(style, opts);
  const pal = palette(style, env.mats, look, { wall: 0, wall2: 0, roof: 0 });
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(placed.x, 0, placed.z),
    new THREE.Quaternion().setFromAxisAngle(UP, placed.rotY),
    new THREE.Vector3(1, 1, 1),
  );
  const fp = clamp(size, 0.3, 6) * placed.scale;
  const expanded = expandBlueprintParts(parts);
  // Props are authored on a unit footprint with heights in the same unit, so height scales with size too.
  return emit(expanded, expanded.length, pal, env.batch, base, fp, fp, fp, look, 0);
}
