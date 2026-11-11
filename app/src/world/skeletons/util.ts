// Part and dial helpers shared by the skeleton groups. Pure, no three.
import type { BlueprintPart, PartShape, PartTone } from '../spec';
import type { Rng } from '../rng';
import type { DialSpec, Dials, Skeleton } from './types';

export interface PartOpts { rot?: number; repeat?: number; gap?: number }

/** part(shape, x, z, y, w, d, h, tone, opts): x/z/w/d are footprint fractions, y/h metres (props: footprint units). */
export function part(
  shape: PartShape, x: number, z: number, y: number, w: number, d: number, h: number, tone: PartTone, o: PartOpts = {},
): BlueprintPart {
  const repeat = o.repeat ?? 1;
  return { shape, x, z, y, w, d, h, rot: o.rot ?? 0, tone, repeat, gap: repeat > 1 ? (o.gap ?? 0) : 0 };
}

type Maker = (x: number, z: number, y: number, w: number, d: number, h: number, tone: PartTone, o?: PartOpts) => BlueprintPart;
const maker = (shape: PartShape): Maker => (x, z, y, w, d, h, tone, o) => part(shape, x, z, y, w, d, h, tone, o);
export const box = maker('box');
export const cyl = maker('cylinder');
export const cone = maker('cone');
export const pyr = maker('pyramid');
export const gable = maker('gable');
export const dome = maker('dome');
export const sph = maker('sphere');
export const wedge = maker('wedge');
export const arch = maker('arch');
export const ring = maker('ring');

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Resolved dial readers. The resolver guarantees presence and type; the fallbacks only keep types honest. */
export const num = (d: Dials, k: string): number => {
  const v = d[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};
export const int = (d: Dials, k: string): number => Math.round(num(d, k));
export const str = (d: Dials, k: string): string => {
  const v = d[k];
  return typeof v === 'string' ? v : '';
};

export const N = (name: string, min: number, max: number, def: number, meaning: string): DialSpec =>
  ({ name, kind: 'number', min, max, default: def, meaning });
export const C = (name: string, choices: string[], def: string, meaning: string): DialSpec =>
  ({ name, kind: 'choice', choices, default: def, meaning });

export function skel(
  id: string, group: Skeleton['group'], summary: string, becomes: string[], dials: DialSpec[],
  build: (d: Dials, rng: Rng) => BlueprintPart[],
): Skeleton {
  return { id, group, summary, becomes, dials, build };
}

/**
 * Height of the low footing that natural and engineered masses stand on (scree, a pad, a kerb). A mass that
 * starts above 0.3 m is not taken for a house wall by the dressing pass, so it gets no door or plinth.
 */
export const SILL = 0.31;
/** Footprint width assumed when a height in metres has to match a width given as a fraction. */
export const NOMINAL = 9;

const RAD = Math.PI / 180;

/** Turns parts about the centre of the footprint by `deg` (same sense as a part's own rot). */
export function turn(parts: BlueprintPart[], deg: number): BlueprintPart[] {
  if (deg === 0) return parts;
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return parts.map((p) => ({ ...p, x: p.x * c + p.z * s, z: -p.x * s + p.z * c, rot: p.rot + deg }));
}

export interface Rect { x0: number; x1: number; z0: number; z1: number }

/** Axis-aligned footprint of one copy of a part. */
export function rectOf(p: BlueprintPart): Rect {
  const c = Math.abs(Math.cos(p.rot * RAD));
  const s = Math.abs(Math.sin(p.rot * RAD));
  const hx = (p.w / 2) * c + (p.d / 2) * s;
  const hz = (p.w / 2) * s + (p.d / 2) * c;
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}

/** The copies a repeated part stands for, each with repeat 1. */
export function copiesOf(p: BlueprintPart): BlueprintPart[] {
  const n = Math.max(1, Math.min(12, Math.round(p.repeat)));
  if (n === 1) return [p];
  const c = Math.cos(p.rot * RAD);
  const s = Math.sin(p.rot * RAD);
  const out: BlueprintPart[] = [];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * p.gap;
    out.push({ ...p, x: p.x + off * c, z: p.z - off * s, repeat: 1, gap: 0 });
  }
  return out;
}

/** Footprint of a part with all its copies. */
export function spanOf(p: BlueprintPart): Rect {
  const out = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const c of copiesOf(p)) {
    const r = rectOf(c);
    out.x0 = Math.min(out.x0, r.x0);
    out.x1 = Math.max(out.x1, r.x1);
    out.z0 = Math.min(out.z0, r.z0);
    out.z1 = Math.max(out.z1, r.z1);
  }
  return out;
}

const touches = (a: Rect, b: Rect): boolean => a.x0 <= b.x1 + 0.02 && b.x0 <= a.x1 + 0.02 && a.z0 <= b.z1 + 0.02 && b.z0 <= a.z1 + 0.02;

/**
 * Indices of parts with a copy that neither stands on the ground nor is carried by another part. The rule
 * is the one lintBlueprint applies: the base lies inside the other part's height, or the top meets its underside.
 */
export function unsupported(parts: BlueprintPart[]): number[] {
  const flat = parts.flatMap((p, src) => copiesOf(p).map((c) => ({ c, src, r: rectOf(c) })));
  const bad = new Set<number>();
  for (const f of flat) {
    if (f.c.y <= 0.05 || bad.has(f.src)) continue;
    const top = f.c.y + f.c.h;
    const held = flat.some((q) => q.src !== f.src && touches(f.r, q.r)
      && ((f.c.y >= q.c.y - 0.15 && f.c.y <= q.c.y + q.c.h + 0.15) || Math.abs(top - q.c.y) <= 0.15));
    if (!held) bad.add(f.src);
  }
  return [...bad];
}

const STRAIGHT: ReadonlySet<PartShape> = new Set<PartShape>(['box', 'cylinder', 'arch']);
const isLight = (p: BlueprintPart): boolean => p.tone === 'glass' || p.tone === 'glow';

/**
 * Wears a finished structure down into a ruin. The skyline breaks at a different height in each of four
 * zones across the width: what stands above its zone's break is gone, walls and posts that cross it are
 * left as stubs, wide walls and rows of posts break into pieces of unequal height, whatever loses its
 * support falls with it, a few slim pieces are knocked askew and fallen blocks lie around the foot.
 * `amount` is 0..1. The result stays within 28 parts when the input does.
 */
export function ruinParts(parts: BlueprintPart[], amount: number, rng: Rng): BlueprintPart[] {
  if (!(amount > 0.04) || parts.length === 0) return parts;
  const top = Math.max(...parts.map((p) => p.y + p.h));
  const breaks = [0, 1, 2, 3].map(() => top * (1 - amount * rng.range(0.3, 0.95)));
  const lowest = Math.min(...breaks);
  const zone = (x: number): number => clamp(Math.floor((x + 0.5) * 4), 0, 3);
  const breakOver = (x0: number, x1: number): number => {
    let b = Infinity;
    for (let k = zone(x0 + 1e-4); k <= zone(x1 - 1e-4); k++) b = Math.min(b, breaks[k] ?? top);
    return Number.isFinite(b) ? b : (breaks[zone((x0 + x1) / 2)] ?? top);
  };
  // Wide walls and rows of posts are divided first, so that each piece can break at its own height.
  let spare = Math.max(0, 24 - parts.length);
  const pieces: BlueprintPart[] = [];
  for (const p of parts) {
    const upright = Math.abs(p.rot) < 1 && p.h >= 1.2 && p.y + p.h > lowest && !isLight(p) && spare > 0;
    if (upright && p.shape === 'box' && p.repeat === 1 && p.w >= 0.4) {
      const edges = [-0.25, 0, 0.25].filter((e) => e > p.x - p.w / 2 + 0.06 && e < p.x + p.w / 2 - 0.06).slice(0, spare);
      const cuts = [p.x - p.w / 2, ...edges, p.x + p.w / 2];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i] as number;
        const b = cuts[i + 1] as number;
        pieces.push({ ...p, x: (a + b) / 2, w: b - a });
      }
      spare -= edges.length;
    } else if (upright && (p.shape === 'box' || p.shape === 'cylinder') && p.repeat >= 2 && p.gap > 0) {
      const left = Math.floor(p.repeat / 2);
      const right = p.repeat - left;
      pieces.push({ ...p, x: p.x - (right * p.gap) / 2, repeat: left, gap: left > 1 ? p.gap : 0 });
      pieces.push({ ...p, x: p.x + (left * p.gap) / 2, repeat: right, gap: right > 1 ? p.gap : 0 });
      spare -= 1;
    } else pieces.push(p);
  }
  // Rubble is mostly the stuff of the largest solid mass, with the odd piece of whatever came down last.
  const solid = (p: BlueprintPart): boolean => !isLight(p) && p.tone !== 'accent' && p.tone !== 'dark';
  const body = parts.filter(solid).reduce<BlueprintPart | undefined>((a, p) => (!a || p.w * p.d * p.h > a.w * a.d * a.h ? p : a), undefined);
  const bodyTone: PartTone = body?.tone ?? 'wall';
  let fallen: PartTone = bodyTone;
  let kept: BlueprintPart[] = [];
  for (const p of pieces) {
    const s = spanOf(p);
    const at = breakOver(s.x0, s.x1);
    const grounded = p.y <= 0.05;
    if (p.y + p.h <= at) {
      kept.push(p);
      continue;
    }
    if (solid(p)) fallen = p.tone;
    if (!grounded && (p.y >= at - 0.1 || isLight(p))) continue;
    if (STRAIGHT.has(p.shape)) {
      const h = Math.max(at - p.y, grounded ? 0.15 : 0);
      if (h >= 0.15) kept.push({ ...p, shape: p.shape === 'arch' ? 'box' : p.shape, h });
    } else if (grounded) kept.push({ ...p, h: Math.max(at, p.h * 0.3) });
    else if (at - p.y >= p.h * 0.5) kept.push(p);
  }
  // Slim standing pieces are knocked a little out of line.
  kept = kept.map((p) => {
    if (p.shape !== 'box' || p.repeat !== 1 || Math.max(p.w, p.d) > 0.2 || p.h < 0.8 || !rng.chance(0.6 * amount)) return p;
    const turned = { ...p, rot: p.rot + rng.range(-1, 1) * 25 * amount };
    return rectOf(turned).z1 > 0.54 ? p : turned;
  });
  for (let guard = 0; guard < 28; guard++) {
    const bad = unsupported(kept);
    if (bad.length === 0) break;
    kept = kept.filter((_, i) => !bad.includes(i));
  }
  // Fallen blocks around the foot, against the front or one of the sides of what still stands.
  const foot = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const p of kept) {
    if (p.y > 0.05) continue;
    const s = spanOf(p);
    foot.x0 = Math.min(foot.x0, s.x0);
    foot.x1 = Math.max(foot.x1, s.x1);
    foot.z0 = Math.min(foot.z0, s.z0);
    foot.z1 = Math.max(foot.z1, s.z1);
  }
  if (!Number.isFinite(foot.x0)) Object.assign(foot, { x0: -0.3, x1: 0.3, z0: -0.3, z1: 0.3 });
  const blocks = clamp(Math.max(Math.round(1 + amount * 4), 4 - kept.length), 0, 28 - kept.length);
  for (let i = 0; i < blocks; i++) {
    const side = rng.int(0, 2);
    const x = side === 0 ? rng.range(foot.x0, foot.x1) : side === 1 ? foot.x0 - 0.05 : foot.x1 + 0.05;
    const z = side === 0 ? foot.z1 + 0.05 : rng.range(foot.z0, foot.z1);
    const w = rng.range(0.05, 0.13);
    const d = rng.range(0.05, 0.1);
    const h = rng.range(0.25, 0.8) * (0.5 + amount);
    kept.push((rng.chance(0.3) ? wedge : box)(clamp(x, -0.45, 0.45), clamp(z, -0.4, 0.4), 0, w, d, h, i % 3 === 2 ? fallen : bodyTone, { rot: rng.range(0, 90) }));
  }
  return kept;
}
