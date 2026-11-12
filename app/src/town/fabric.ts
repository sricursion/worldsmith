// The fabric of a place: everything that stands around the handful of named structures. A spec names the few
// buildings that matter to its story; its scale (see world/scale.ts) says how much more there is. Here that
// "more" is planned, as data:
//
//   - kinds: a dozen or so buildings made from the world's own blueprints, each in its own version, drawn up or
//     pressed down to the heights this place is built at, a few of them broken where the place is damaged.
//     Where the world has too few ordinary buildings of its own, plain ones of the right size fill in.
//   - urban fabric (town, city, metropolis): a lattice of streets and blocks laid round the named site, which
//     sits in a hole of whole blocks. Inside the hole the gaps along the site's own streets are built up and its
//     streets are carried out to a street that rings it; these lots are part of the place (solid, on the
//     navmesh). Outside it every block of the lattice has its own lots, decided by its coordinates alone, so
//     the city can be made block by block for as far as anyone walks. Past `extent` the lots thin out.
//   - rural fabric (hamlet, village): a few more houses along the tracks and round the green.
//
// Pure module: no three, no DOM. Same spec in, same fabric out.
import { makeRng, hash32 } from '../world/rng';
import type { Rng } from '../world/rng';
import type { ScaleProfile } from '../world/scale';
import { buildSkeleton } from '../world/skeletons';
import { ruinParts } from '../world/skeletons/util';
import type { Blueprint, BlueprintPart, WorldSpec } from '../world/spec';
import { fieldNoise, varyBlueprint } from './variation';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
interface Pt { x: number; z: number }
interface Road { ax: number; az: number; bx: number; bz: number; width: number }

/** One building of the fabric as a model: its parts at their final height, and the footprint it is built on. */
export interface FabricKind {
  bp: Blueprint;
  /** Footprint the parts are laid out on, metres (what addBlueprint is given). */
  fw: number; fd: number;
  /** The ground the building actually covers at scale 1, metres: what a lot of this kind measures. */
  w: number; d: number;
  height: number;
  /** stand: an ordinary building. ruin: one of them broken. feature: a canopy, mast or frame of this world, set on open ground. */
  role: 'stand' | 'ruin' | 'feature';
}

export interface FabricLot {
  x: number; z: number; rotY: number;
  /** Ground covered, metres, along the front and back from it. */
  w: number; d: number;
  /** Point 1 m outside the front. */
  door: Pt;
  /** Index into the kinds, and this lot's own stretch of it across, up and back. */
  kind: number; sx: number; sy: number; sz: number;
  height: number;
  /** Cast of colour: a multiplier and a lean to warm (+) or cool (-). */
  value: number; warm: number;
  /** Stands high enough to be seen over the roofs from far off. */
  tall: boolean;
}

export interface FabricGrid {
  /** A street centre line runs at x0 + i * pitch and at z0 + j * pitch for every whole i and j. */
  x0: number; z0: number; pitch: number; street: number;
  /** The named site: a rectangle of whole blocks, bounded by street centre lines. */
  hole: Rect;
  /** Middle of the place, and how far the fabric runs from it before thinning (Infinity: never). */
  cx: number; cz: number; extent: number;
}

export interface Fabric {
  /** Lots built with the place itself. */
  lots: FabricLot[];
  /** Streets added inside the place: the ring round the site and the site's own streets carried out to it. */
  roads: Road[];
  /** The first stretch of every lattice street that leaves the ring, laid as road over the place's own ground. */
  stubs: Road[];
  /** Where street clutter may stand inside the place. */
  clutter: { x: number; z: number; rotY: number }[];
  grid: FabricGrid | null;
  /** The bounds of the place with its fabric. */
  bounds: Rect;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const grow = (r: Rect, m: number): Rect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
const hits = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const topOf = (parts: readonly BlueprintPart[]): number => parts.reduce((m, p) => Math.max(m, p.y + p.h), 0);
/** Cell hash in 0..1. */
const unit = (seed: number, a: number, b: number, salt: number): number => hash32(`${seed >>> 0}|${a}|${b}|${salt}`) / 4294967296;

/** Below this doors and shopfronts keep their size whatever the building above them does. */
const HEAD = 2.6;
/** A building is never drawn up to more than this many times its own height, nor pressed below this share of it. */
const MOST_STRETCH = 3;
const LEAST_STRETCH = 0.4;
/** No building is drawn up past this. */
export const MAX_FABRIC_HEIGHT = 200;

/** Draws everything above head height up or down so the top stands at `target` metres. */
export function stretchTo(parts: readonly BlueprintPart[], target: number): BlueprintPart[] {
  const top = topOf(parts);
  if (!(top > HEAD + 0.5) || !(target > HEAD + 0.5) || Math.abs(target - top) < 0.25) return parts.map((p) => ({ ...p }));
  const f = (target - HEAD) / (top - HEAD);
  const g = (t: number): number => (t <= HEAD ? t : HEAD + (t - HEAD) * f);
  return parts.map((p) => {
    const y = g(p.y);
    return { ...p, y, h: Math.max(0.05, g(p.y + p.h) - y) };
  });
}

/**
 * The height a blueprint was meant to have when its summary says so ("glass office spire, 120 m") and the parts
 * stop short of it, which they do wherever a dial tops out. Null when the summary gives no height or the
 * building already has it.
 */
export function saidHeight(bp: Pick<Blueprint, 'summary' | 'parts'>, most: number): number | null {
  const all = [...bp.summary.matchAll(/(\d{2,3})\s*m\b/g)].map((m) => Number(m[1]));
  if (all.length === 0) return null;
  const top = topOf(bp.parts);
  const said = Math.min(Math.max(...all), most, MAX_FABRIC_HEIGHT, top * MOST_STRETCH);
  return said > top * 1.12 && top > 6 ? said : null;
}

/** How much of its footprint a blueprint fills as solid mass, 0..1: a house about a half, a mast or a canopy next to nothing. */
export function massOf(bp: Pick<Blueprint, 'parts'>): number {
  const top = topOf(bp.parts);
  if (top < 2.5) return 0;
  let v = 0;
  for (const p of bp.parts) {
    if (p.tone === 'glow' || p.tone === 'dark') continue;
    const n = Math.max(1, Math.round(p.repeat));
    const round = p.shape === 'cone' || p.shape === 'pyramid' || p.shape === 'dome' || p.shape === 'sphere' ? 0.45 : p.shape === 'cylinder' ? 0.78 : p.shape === 'gable' || p.shape === 'wedge' ? 0.5 : 1;
    v += Math.min(1, p.w) * Math.min(1, p.d) * p.h * n * round;
  }
  return clamp(v / top, 0, 1);
}

/** The share of the footprint the ground-standing mass spans, across and back (0.3..1). */
function spanOf(parts: readonly BlueprintPart[]): { w: number; d: number } {
  let w = 0;
  let d = 0;
  for (const p of parts) {
    if (p.y > 1 || p.h < 1.8 || p.w * p.d < 0.02) continue;
    const turned = Math.abs(Math.sin((p.rot * Math.PI) / 180)) > 0.7;
    const run = p.repeat > 1 ? (p.repeat - 1) * p.gap : 0;
    const hx = ((turned ? p.d : p.w + run) / 2);
    const hz = ((turned ? p.w + run : p.d) / 2);
    w = Math.max(w, 2 * (Math.abs(p.x) + hx));
    d = Math.max(d, 2 * (Math.abs(p.z) + hz));
  }
  return { w: clamp(w || 1, 0.3, 1), d: clamp(d || 1, 0.3, 1) };
}

/** True for a blueprint with a body: a mass standing on the ground at least a storey high and a fair share of its lot across. */
export function isBuilding(bp: Pick<Blueprint, 'parts'>): boolean {
  if (topOf(bp.parts) < 3) return false;
  // Masts, cranes and derricks have next to no mass; canopies and stilt houses have no wall that reaches the ground.
  const body = bp.parts.some((p) => p.y <= 0.8 && p.h >= 2.2 && Math.min(p.w, p.d) >= 0.18 && p.tone !== 'glow' && p.tone !== 'dark' && p.tone !== 'glass');
  return body && massOf(bp) >= 0.085;
}


/** The source to build a kind of a given height from: one that reaches it without being pulled out of shape, taking turns. */
function sourceFor(sources: readonly Blueprint[], height: number, turn: number): Blueprint {
  const ok = sources.filter((b) => { const t = topOf(b.parts); return height <= t * MOST_STRETCH && height >= t * LEAST_STRETCH; });
  if (ok.length > 0) return ok[turn % ok.length] as Blueprint;
  return [...sources].sort((a, b) => Math.abs(Math.log(topOf(a.parts) / height)) - Math.abs(Math.log(topOf(b.parts) / height)))[0] as Blueprint;
}

/** A plain building of the right kind for the scale, for a world whose own blueprints are all masts, wrecks and caves. */
function plainSource(i: number, profile: ScaleProfile, flat: boolean, seed: number): Blueprint {
  const tall = profile.level >= 5 && i % 2 === 1;
  const family = tall ? (i % 4 === 1 ? 'tower' : 'block') : 'hall';
  const dials: Record<string, number | string> = family === 'tower'
    ? { height: 24, section: 'square', taper: 0.15 + 0.1 * (i % 3), bands: 2 + (i % 3), top: flat ? 'flat' : 'crown' }
    : family === 'block'
      ? { modules: 6 + (i % 4), offset: 0.15, cantilever: 0.15 }
      : { storeys: clamp(Math.round(profile.low / 3), 1, 4), roof: flat ? 'flat' : i % 3 === 0 ? 'hip' : 'gable', rhythm: 3 + (i % 3), front: i % 2 === 0 ? 'plain' : 'stoop', chimney: flat ? 0 : i % 2 };
  return { id: `fabric_${family}_${i}`, summary: `plain ${family}`, parts: buildSkeleton(family, dials, hash32(`${seed >>> 0}|plain|${i}`)), doorX: 0 };
}

/**
 * The buildings the fabric is made of. Standing kinds come first, lowest to tallest; then broken ones when the
 * place is damaged; then the world's own open structures (canopies, masts, frames) as features.
 */
export function fabricKinds(spec: Pick<WorldSpec, 'seed' | 'blueprints' | 'style' | 'terrain'>, profile: ScaleProfile): FabricKind[] {
  if (profile.fabric === 'none') return [];
  const seed = spec.seed >>> 0;
  const own = (spec.blueprints ?? []).filter((b) => b.parts.length > 0);
  const massive = own.filter((b) => isBuilding(b)).sort((a, b) => topOf(a.parts) - topOf(b.parts));
  const open = own.filter((b) => !massive.includes(b) && topOf(b.parts) >= 2.5);
  // Flat roofs unless the world's own buildings are mostly pitched.
  const pitched = own.filter((b) => b.parts.some((p) => p.tone === 'roof' && (p.shape === 'gable' || p.shape === 'pyramid' || p.shape === 'cone' || p.shape === 'wedge'))).length;
  const flat = pitched * 2 < Math.max(1, own.length);
  const sources = massive.slice();
  for (let i = 0; sources.length < (profile.fabric === 'urban' ? 3 : 2); i++) sources.push(plainSource(i, profile, flat, seed));
  const urban = profile.fabric === 'urban';
  const n = urban ? 9 : 4;
  const wear = clamp(0.25 + 0.6 * profile.damage, 0, 1);
  const settled = clamp(spec.terrain?.settled ?? 0.7, 0, 1);
  const kinds: FabricKind[] = [];
  const make = (src: Blueprint, height: number, salt: string, ruin: number): FabricKind => {
    const rng = makeRng(seed, `fabric-kind|${salt}`);
    const varied = varyBlueprint(src, hash32(`${seed}|fabric|${salt}`), { amount: 1, wear, settled });
    let parts = stretchTo(varied.parts, height);
    if (ruin > 0) parts = ruinParts(parts, ruin, rng);
    const span = spanOf(parts);
    // What a lot of this kind measures: broader as it rises, never a sliver.
    const w = clamp(8 + 0.1 * height, 8, 20) * rng.range(0.92, 1.12);
    const d = clamp(8 + 0.07 * height, 8, 15) * rng.range(0.92, 1.08);
    const fw = w / span.w;
    const fd = d / span.d;
    // A slim building is laid out on a footprint larger than its lot so that its body fills the lot. Whatever it
    // had standing out at the edges of that footprint (a lamp, a sign, a fence) would land in the street or in
    // the next lot, so only what stands on or against the body is kept.
    parts = parts.filter((p, i) => i === 0 || (Math.abs(p.x) <= span.w / 2 + 0.8 / fw && Math.abs(p.z) <= span.d / 2 + 0.8 / fd));
    return { bp: { ...varied, id: `${src.id}_f${salt}`, parts }, fw, fd, w, d, height: topOf(parts), role: ruin > 0 ? 'ruin' : 'stand' };
  };
  // Most stand near the low figure; a few reach the high one.
  const STEPS = [0, 0.05, 0.11, 0.18, 0.27, 0.38, 0.52, 0.74, 1];
  for (let i = 0; i < n; i++) {
    const q = urban ? (STEPS[i] as number) : i / Math.max(1, n - 1);
    const height = profile.low + (profile.high - profile.low) * q;
    // The world's lower buildings give the low kinds and its towers the tall ones, each used more than once.
    kinds.push(make(sourceFor(sources, height, i), Math.min(height, MAX_FABRIC_HEIGHT), `s${i}`, 0));
  }
  if (profile.damage > 0.05) {
    const broken = urban ? 3 : 1;
    for (let i = 0; i < broken; i++) {
      const height = profile.low + (profile.high - profile.low) * [0.1, 0.3, 0.6][i % 3]!;
      kinds.push(make(sourceFor(sources, height, i + 1), height, `r${i}`, clamp(0.35 + 0.22 * i + 0.3 * profile.damage, 0.3, 0.95)));
    }
  }
  if (urban) {
    for (const src of open.slice(0, 2)) {
      const top = topOf(src.parts);
      kinds.push({ bp: src, fw: 11, fd: 9, w: 11, d: 9, height: top, role: 'feature' });
    }
  }
  return kinds;
}

// ---- Lots --------------------------------------------------------------------------------------------------------

/** Axis-aligned ground a lot covers (rotations are multiples of 90 degrees). */
export function lotRect(l: { x: number; z: number; rotY: number; w: number; d: number }): Rect {
  const turned = Math.abs(Math.sin(l.rotY)) > 0.5;
  const hx = (turned ? l.d : l.w) / 2;
  const hz = (turned ? l.w : l.d) / 2;
  return { minX: l.x - hx, maxX: l.x + hx, minZ: l.z - hz, maxZ: l.z + hz };
}

interface Choice { kind: number; sx: number; sy: number; sz: number; value: number; warm: number }

/** Chooses the kind of a lot and its own version of it. `core` is 0 at the edge of the place and 1 in its heart. */
function pickKind(kinds: readonly FabricKind[], profile: ScaleProfile, seed: number, x: number, z: number, rng: Rng, prev: number, core: number, role: 'row' | 'tower'): Choice {
  const stand = kinds.map((k, i) => (k.role === 'stand' ? i : -1)).filter((i) => i >= 0);
  const ruins = kinds.map((k, i) => (k.role === 'ruin' ? i : -1)).filter((i) => i >= 0);
  // Damage comes in districts: whole streets gone in one, a broken house here and there in the next.
  const hurt = profile.damage * (0.25 + 0.75 * fieldNoise(x / 110, z / 110, seed + 733));
  let kind: number;
  if (ruins.length > 0 && rng.next() < hurt) kind = rng.pick(ruins);
  else {
    // Height gathers too: a district of towers, then lower streets.
    const high = clamp(0.25 + 0.55 * core + 0.9 * (fieldNoise(x / 150, z / 150, seed + 911) - 0.5), 0.05, 1);
    const u = role === 'tower' ? 1 - 0.3 * rng.next() : rng.next() ** (1 / Math.max(0.15, high * 1.3));
    let at = Math.min(stand.length - 1, Math.floor((role === 'tower' ? u : u * high + 0.12 * rng.next()) * stand.length));
    if (stand[at] === prev && stand.length > 1) at = at + 1 < stand.length ? at + 1 : at - 1;
    kind = stand[at] ?? 0;
  }
  return {
    kind, sx: rng.range(0.9, 1.12), sy: rng.range(0.86, 1.22), sz: rng.range(0.92, 1.1),
    value: rng.range(0.8, 1.06), warm: rng.range(-0.05, 0.05),
  };
}

function lotAt(kinds: readonly FabricKind[], p: Choice, x: number, z: number, rotY: number, tallFrom: number): FabricLot {
  const k = kinds[p.kind] as FabricKind;
  const w = k.w * p.sx;
  const d = k.d * p.sz;
  const height = k.height * p.sy;
  return {
    x, z, rotY, w, d, door: { x: x - Math.sin(rotY) * (d / 2 + 1), z: z - Math.cos(rotY) * (d / 2 + 1) },
    kind: p.kind, sx: p.sx, sy: p.sy, sz: p.sz, height, value: p.value, warm: p.warm, tall: k.role !== 'ruin' && height >= tallFrom,
  };
}

/** A line buildings front onto: from a to b, with the unit direction their backs lie in. */
interface Frontage { ax: number; az: number; bx: number; bz: number; nx: number; nz: number }

interface FillOpts {
  kinds: readonly FabricKind[]; profile: ScaleProfile; seed: number; rng: Rng; core: number;
  /** Whether a footprint may stand. */
  fits(r: Rect): boolean;
  /** Chance that a lot is left out altogether. */
  skip: number;
  most?: number;
}

/** Builds up one frontage from end to end. Returns the deepest lot placed. */
function fillFrontage(f: Frontage, o: FillOpts, out: FabricLot[]): number {
  const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
  if (len < 7) return 0;
  const ux = (f.bx - f.ax) / len;
  const uz = (f.bz - f.az) / len;
  // The front looks away from the backs: rotY 0 faces -Z, so the facing (-nx, -nz) gives atan2(nx, nz).
  const rotY = Math.atan2(f.nx, f.nz);
  const tallFrom = Math.max(o.profile.low + 0.55 * (o.profile.high - o.profile.low), 26);
  const lvl = o.profile.level;
  let cur = o.rng.range(0, lvl >= 5 ? 0.6 : 2);
  let prev = -1;
  let deepest = 0;
  for (let guard = 0; guard < 80 && cur < len - 6; guard++) {
    if (o.most !== undefined && out.length >= o.most) break;
    const p = pickKind(o.kinds, o.profile, o.seed, f.ax + ux * cur, f.az + uz * cur, o.rng, prev, o.core, 'row');
    const k = o.kinds[p.kind] as FabricKind;
    // The last lot of a row is drawn in to close it, where it nearly fits.
    const room = len - cur;
    if (k.w * p.sx > room) {
      if (room < k.w * 0.78) break;
      p.sx = room / k.w;
    }
    const lot = lotAt(o.kinds, p, 0, 0, rotY, tallFrom);
    const t = cur + lot.w / 2;
    lot.x = f.ax + ux * t + f.nx * (lot.d / 2);
    lot.z = f.az + uz * t + f.nz * (lot.d / 2);
    lot.door = { x: lot.x - f.nx * (lot.d / 2 + 1), z: lot.z - f.nz * (lot.d / 2 + 1) };
    // An alley now and then; in a town every house stands a little apart.
    const gap = lvl >= 6 ? (o.rng.chance(0.12) ? 3 : 0.15) : lvl === 5 ? (o.rng.chance(0.22) ? 2.6 : 0.3) : o.rng.range(1, 4.5);
    const free = o.fits(lotRect(lot));
    if (free && !o.rng.chance(o.skip)) {
      out.push(lot);
      prev = p.kind;
      deepest = Math.max(deepest, lot.d);
    }
    cur += free ? lot.w + gap : 2;
  }
  return deepest;
}

// ---- The lattice -------------------------------------------------------------------------------------------------

/** How much of the fabric is still there at a point: 1 inside the extent, falling to 0 beyond it, ragged at the edge. */
export function fabricPresence(grid: FabricGrid, seed: number, x: number, z: number): number {
  if (!Number.isFinite(grid.extent)) return 1;
  const d = Math.hypot(x - grid.cx, z - grid.cz) * (0.8 + 0.4 * fieldNoise(x / 160, z / 160, seed + 311));
  return 1 - smooth(grid.extent * 0.75, grid.extent * 1.25, d);
}

export const blockOf = (grid: FabricGrid, x: number, z: number): { i: number; j: number } => ({ i: Math.floor((x - grid.x0) / grid.pitch), j: Math.floor((z - grid.z0) / grid.pitch) });

/** The ground of block (i, j) between its four streets. */
export function blockRect(grid: FabricGrid, i: number, j: number): Rect {
  const h = grid.street / 2;
  return { minX: grid.x0 + i * grid.pitch + h, maxX: grid.x0 + (i + 1) * grid.pitch - h, minZ: grid.z0 + j * grid.pitch + h, maxZ: grid.z0 + (j + 1) * grid.pitch - h };
}

/** True when block (i, j) lies in the hole the named site stands in. */
export function inHole(grid: FabricGrid, i: number, j: number): boolean {
  const cx = grid.x0 + (i + 0.5) * grid.pitch;
  const cz = grid.z0 + (j + 0.5) * grid.pitch;
  return cx > grid.hole.minX && cx < grid.hole.maxX && cz > grid.hole.minZ && cz < grid.hole.maxZ;
}

/** Pavement between the street and the fronts, metres. */
const WALK = 1.2;

/**
 * The lots of one block of the lattice outside the hole, from its coordinates alone. Street walls along all four
 * sides, sometimes a tower in the middle; one block in a dozen or so is left open as a square.
 */
export function blockLots(grid: FabricGrid, kinds: readonly FabricKind[], profile: ScaleProfile, seed: number, i: number, j: number): FabricLot[] {
  const out: FabricLot[] = [];
  if (inHole(grid, i, j) || kinds.length === 0) return out;
  const b = blockRect(grid, i, j);
  const mx = (b.minX + b.maxX) / 2;
  const mz = (b.minZ + b.maxZ) / 2;
  const here = fabricPresence(grid, seed, mx, mz);
  if (here <= 0.02) return out;
  const rng = makeRng(seed, `block|${i}|${j}`);
  const core = Number.isFinite(grid.extent) ? clamp(1 - Math.hypot(mx - grid.cx, mz - grid.cz) / grid.extent, 0, 1) : 0.75;
  const tallFrom = Math.max(profile.low + 0.55 * (profile.high - profile.low), 26);
  const features = kinds.map((k, n) => (k.role === 'feature' ? n : -1)).filter((n) => n >= 0);
  if (unit(seed, i, j, 5) < 0.07 && here > 0.6) {
    // A square: open ground, with one or two of the world's own open structures standing in it.
    for (let n = 0; n < Math.min(2, features.length); n++) {
      const k = kinds[features[n] as number] as FabricKind;
      const x = mx + (n === 0 ? -1 : 1) * (features.length > 1 ? (b.maxX - b.minX) * 0.22 : 0);
      out.push(lotAt(kinds, { kind: features[n] as number, sx: 1, sy: 1, sz: 1, value: 1, warm: 0 }, x, mz + rng.range(-3, 3), rng.int(0, 3) * (Math.PI / 2), tallFrom + k.height));
    }
    return out;
  }
  const taken: Rect[] = [];
  const fits = (r: Rect): boolean => r.minX >= b.minX - 0.01 && r.maxX <= b.maxX + 0.01 && r.minZ >= b.minZ - 0.01 && r.maxZ <= b.maxZ + 0.01 && !taken.some((q) => hits(r, q));
  const o: FillOpts = { kinds, profile, seed, rng, core, fits, skip: (1 - here) + (profile.level === 4 ? 0.12 : 0.03) + 0.12 * profile.damage };
  const run = (f: Frontage): number => {
    const from = out.length;
    const deep = fillFrontage(f, o, out);
    for (let n = from; n < out.length; n++) taken.push(lotRect(out[n] as FabricLot));
    return deep;
  };
  // South and north rows run corner to corner; the east and west rows fill what is left between them.
  const dS = run({ ax: b.minX, az: b.minZ + WALK, bx: b.maxX, bz: b.minZ + WALK, nx: 0, nz: 1 });
  const dN = run({ ax: b.maxX, az: b.maxZ - WALK, bx: b.minX, bz: b.maxZ - WALK, nx: 0, nz: -1 });
  const z0 = b.minZ + WALK + dS + 0.4;
  const z1 = b.maxZ - WALK - dN - 0.4;
  const dW = run({ ax: b.minX + WALK, az: z1, bx: b.minX + WALK, bz: z0, nx: 1, nz: 0 });
  const dE = run({ ax: b.maxX - WALK, az: z0, bx: b.maxX - WALK, bz: z1, nx: -1, nz: 0 });
  // The middle of the block: in a big city a tower often rises out of it.
  const freeX = b.maxX - b.minX - 2 * WALK - dW - dE - 3;
  const freeZ = z1 - z0 - 3;
  if (profile.level >= 5 && freeX >= 11 && freeZ >= 11 && rng.chance((profile.level >= 6 ? 0.55 : 0.25) * (0.5 + 0.5 * core) * here)) {
    const p = pickKind(kinds, profile, seed, mx, mz, rng, -1, core, 'tower');
    const k = kinds[p.kind] as FabricKind;
    p.sx = Math.min(p.sx, freeX / k.w);
    p.sz = Math.min(p.sz, freeZ / k.d);
    if (p.sx >= 0.7 && p.sz >= 0.7) {
      p.sy *= 1.12;
      out.push(lotAt(kinds, p, (b.minX + WALK + dW + b.maxX - WALK - dE) / 2, (z0 + z1) / 2, rng.int(0, 3) * (Math.PI / 2), tallFrom));
    }
  }
  return out;
}

// ---- The place itself --------------------------------------------------------------------------------------------

export interface FabricSite {
  /** Footprints of the named buildings and the points outside their doors. */
  boxes: readonly Rect[]; doors: readonly Pt[];
  /** The site's own streets (axis-aligned). */
  roads: readonly Road[];
  plaza: { x: number; z: number; r: number }; spawn: Pt;
  bounds: Rect;
  /** True where nothing may be built: water, trails, clearings. */
  avoid?: (x: number, z: number) => boolean;
}

const roadRect = (r: Road): Rect => {
  const h = r.width / 2;
  const alongX = r.az === r.bz;
  return {
    minX: Math.min(r.ax, r.bx) - (alongX ? 0 : h), maxX: Math.max(r.ax, r.bx) + (alongX ? 0 : h),
    minZ: Math.min(r.az, r.bz) - (alongX ? h : 0), maxZ: Math.max(r.az, r.bz) + (alongX ? h : 0),
  };
};

/** How far past the ring a leaving street is laid as road, metres: a little more than the place's own ground reaches. */
const STUB = 38;
/** Most lots built with the place itself: they are solid and detailed, so they are counted. */
export const MAX_INNER_LOTS = 72;
const MAX_CLUTTER = 140;

function siteFits(site: FabricSite, taken: Rect[], roads: readonly Rect[]): (r: Rect) => boolean {
  const boxes = site.boxes.map((r) => grow(r, 1.4));
  return (r: Rect): boolean => {
    if (boxes.some((q) => hits(r, q)) || taken.some((q) => hits(r, q)) || roads.some((q) => hits(r, q))) return false;
    const near = (px: number, pz: number): number => Math.hypot(Math.max(r.minX - px, 0, px - r.maxX), Math.max(r.minZ - pz, 0, pz - r.maxZ));
    if (site.plaza.r > 0 && near(site.plaza.x, site.plaza.z) < site.plaza.r + 1.5) return false;
    if (near(site.spawn.x, site.spawn.z) < 3.5) return false;
    if (site.doors.some((p) => near(p.x, p.z) < 2.6)) return false;
    if (site.avoid) {
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ], [cx, cz], [cx, r.minZ], [cx, r.maxZ], [r.minX, cz], [r.maxX, cz]] as const) {
        if (site.avoid(x, z)) return false;
      }
    }
    return true;
  };
}

/** Clutter slots along both kerbs of a street. */
function kerbSlots(r: Road, every: number, rng: Rng, ok: (x: number, z: number) => boolean, out: Fabric['clutter']): void {
  const alongX = r.az === r.bz;
  const lo = alongX ? Math.min(r.ax, r.bx) : Math.min(r.az, r.bz);
  const hi = alongX ? Math.max(r.ax, r.bx) : Math.max(r.az, r.bz);
  for (const side of [-1, 1]) {
    for (let t = lo + rng.range(1, every); t < hi - 1; t += every * rng.range(0.6, 1.5)) {
      if (out.length >= MAX_CLUTTER) return;
      const off = side * (r.width / 2 - rng.range(0.5, 1.1));
      const x = alongX ? t : r.ax + off;
      const z = alongX ? r.az + off : t;
      if (ok(x, z)) out.push({ x, z, rotY: (alongX ? 0 : Math.PI / 2) + rng.range(-0.4, 0.4) });
    }
  }
}

/** The fabric of a place, given where its named structures stand. Null when the scale asks for none. */
export function planFabric(spec: Pick<WorldSpec, 'seed'>, profile: ScaleProfile, kinds: readonly FabricKind[], site: FabricSite): Fabric | null {
  if (profile.fabric === 'none' || kinds.length === 0) return null;
  const seed = spec.seed >>> 0;
  const rng = makeRng(seed, 'fabric');
  const lots: FabricLot[] = [];
  const taken: Rect[] = [];
  const clutter: Fabric['clutter'] = [];
  const every = 11 - 8 * profile.density;
  const clear = (x: number, z: number): boolean =>
    !site.doors.some((p) => Math.hypot(p.x - x, p.z - z) < 2.2) && Math.hypot(site.spawn.x - x, site.spawn.z - z) > 3
    && !(site.plaza.r > 0 && Math.hypot(site.plaza.x - x, site.plaza.z - z) < site.plaza.r * 0.6) && !site.avoid?.(x, z);

  if (profile.fabric === 'rural') {
    // A few more houses: first along the site's own tracks past the last named one, then loosely round the middle.
    const fits = siteFits(site, taken, site.roads.map((r) => grow(roadRect(r), 1.2)));
    const o: FillOpts = { kinds, profile, seed, rng, core: 0.3, fits, skip: 0.45, most: profile.extras };
    const foot = site.boxes.length > 0 ? site.boxes.reduce((a, c) => ({ minX: Math.min(a.minX, c.minX), maxX: Math.max(a.maxX, c.maxX), minZ: Math.min(a.minZ, c.minZ), maxZ: Math.max(a.maxZ, c.maxZ) })) : grow({ minX: site.spawn.x, maxX: site.spawn.x, minZ: site.spawn.z, maxZ: site.spawn.z }, 8);
    const reach = grow(foot, 26);
    for (const r of site.roads) {
      if (r.width < 2) continue;
      const alongX = r.az === r.bz;
      const off = r.width / 2 + 2.2;
      for (const side of [-1, 1]) {
        const from = lots.length;
        if (alongX) fillFrontage({ ax: Math.max(reach.minX, Math.min(r.ax, r.bx)), az: r.az + side * off, bx: Math.min(reach.maxX, Math.max(r.ax, r.bx)), bz: r.az + side * off, nx: 0, nz: side }, o, lots);
        else fillFrontage({ ax: r.ax + side * off, az: Math.max(reach.minZ, Math.min(r.az, r.bz)), bx: r.ax + side * off, bz: Math.min(reach.maxZ, Math.max(r.az, r.bz)), nx: side, nz: 0 }, o, lots);
        for (let n = from; n < lots.length; n++) taken.push(grow(lotRect(lots[n] as FabricLot), 2.5));
      }
    }
    const cx = (foot.minX + foot.maxX) / 2;
    const cz = (foot.minZ + foot.maxZ) / 2;
    const R = Math.hypot(foot.maxX - foot.minX, foot.maxZ - foot.minZ) / 2;
    const tallFrom = 1e9;
    for (let attempt = 0; attempt < 400 && lots.length < profile.extras; attempt++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(R * 0.5 + 6, R + 22 + attempt * 0.08);
      const x = cx + Math.cos(ang) * dist;
      const z = cz + Math.sin(ang) * dist;
      // Each looks toward the middle, on the nearest of the four facings.
      const rotY = Math.abs(x - cx) > Math.abs(z - cz) ? (x > cx ? Math.PI / 2 : -Math.PI / 2) : z > cz ? 0 : Math.PI;
      const lot = lotAt(kinds, pickKind(kinds, profile, seed, x, z, rng, lots[lots.length - 1]?.kind ?? -1, 0.3, 'row'), x, z, rotY, tallFrom);
      const r = lotRect(lot);
      if (!fits(grow(r, 3))) continue;
      lots.push(lot);
      taken.push(grow(r, 3));
    }
    let bounds = site.bounds;
    for (const l of lots) {
      const r = grow(lotRect(l), 20);
      bounds = { minX: Math.min(bounds.minX, r.minX), maxX: Math.max(bounds.maxX, r.maxX), minZ: Math.min(bounds.minZ, r.minZ), maxZ: Math.max(bounds.maxZ, r.maxZ) };
    }
    return { lots, roads: [], stubs: [], clutter, grid: null, bounds };
  }

  // Urban. The named site stands in a hole of whole blocks, with room for a row of lots between it and the ring street.
  const P = profile.pitch;
  const W = profile.street;
  let c: Rect = grow({ minX: site.spawn.x, maxX: site.spawn.x, minZ: site.spawn.z, maxZ: site.spawn.z }, 4);
  const add = (r: Rect): void => { c = { minX: Math.min(c.minX, r.minX), maxX: Math.max(c.maxX, r.maxX), minZ: Math.min(c.minZ, r.minZ), maxZ: Math.max(c.maxZ, r.maxZ) }; };
  for (const r of site.boxes) add(r);
  for (const r of site.roads) add(roadRect(r));
  if (site.plaza.r > 0) add(grow({ minX: site.plaza.x, maxX: site.plaza.x, minZ: site.plaza.z, maxZ: site.plaza.z }, site.plaza.r));
  const band = 17 + W / 2;
  const nX = Math.max(1, Math.ceil((c.maxX - c.minX + 2 * band) / P));
  const nZ = Math.max(1, Math.ceil((c.maxZ - c.minZ + 2 * band) / P));
  const mx = (c.minX + c.maxX) / 2;
  const mz = (c.minZ + c.maxZ) / 2;
  const hole: Rect = { minX: mx - (nX * P) / 2, maxX: mx + (nX * P) / 2, minZ: mz - (nZ * P) / 2, maxZ: mz + (nZ * P) / 2 };
  const grid: FabricGrid = { x0: hole.minX, z0: hole.minZ, pitch: P, street: W, hole, cx: mx, cz: mz, extent: profile.extent };
  const h = W / 2;
  const ring: Road[] = [
    { ax: hole.minX - h, az: hole.minZ, bx: hole.maxX + h, bz: hole.minZ, width: W },
    { ax: hole.minX - h, az: hole.maxZ, bx: hole.maxX + h, bz: hole.maxZ, width: W },
    { ax: hole.minX, az: hole.minZ, bx: hole.minX, bz: hole.maxZ, width: W },
    { ax: hole.maxX, az: hole.minZ, bx: hole.maxX, bz: hole.maxZ, width: W },
  ];
  // The site's own streets are carried on to the ring wherever nothing named stands in the way.
  const links: Road[] = [];
  for (const r of site.roads) {
    if (r.width < 2.5) continue;
    const alongX = r.az === r.bz;
    const lo = alongX ? Math.min(r.ax, r.bx) : Math.min(r.az, r.bz);
    const hi = alongX ? Math.max(r.ax, r.bx) : Math.max(r.az, r.bz);
    const ends: [number, number][] = alongX ? [[lo, hole.minX], [hi, hole.maxX]] : [[lo, hole.minZ], [hi, hole.maxZ]];
    for (const [from, to] of ends) {
      if (Math.abs(to - from) < 1) continue;
      const seg: Road = alongX ? { ax: Math.min(from, to), az: r.az, bx: Math.max(from, to), bz: r.az, width: r.width } : { ax: r.ax, az: Math.min(from, to), bx: r.ax, bz: Math.max(from, to), width: r.width };
      const q = grow(roadRect(seg), 0.8);
      // Another street of the site already lying along this run would make a doubled road.
      const doubled = site.roads.some((s) => s !== r && hits(grow(roadRect(s), 0.5), q) && (s.az === s.bz) === alongX);
      if (doubled || site.boxes.some((bx) => hits(bx, q)) || (site.avoid && [0.25, 0.5, 0.75, 1].some((t) => site.avoid?.(seg.ax + (seg.bx - seg.ax) * t, seg.az + (seg.bz - seg.az) * t)))) continue;
      links.push(seg);
    }
  }
  const wet = (r: Road): boolean => !!site.avoid && [0.1, 0.3, 0.5, 0.7, 0.9].some((t) => site.avoid?.(r.ax + (r.bx - r.ax) * t, r.az + (r.bz - r.az) * t));
  const roads = [...ring.filter((r) => !wet(r)), ...links];
  const closed = [...site.roads, ...roads].map((r) => grow(roadRect(r), WALK - 0.2));
  const inner = grow(hole, -(h + WALK));
  const fitsSite = siteFits(site, taken, closed);
  const fits = (r: Rect): boolean => r.minX >= inner.minX - 0.01 && r.maxX <= inner.maxX + 0.01 && r.minZ >= inner.minZ - 0.01 && r.maxZ <= inner.maxZ + 0.01 && fitsSite(r);
  const o: FillOpts = { kinds, profile, seed, rng, core: 1, fits, skip: profile.level === 4 ? 0.1 : 0.02, most: MAX_INNER_LOTS };
  const run = (f: Frontage): void => {
    const from = lots.length;
    fillFrontage(f, o, lots);
    for (let n = from; n < lots.length; n++) taken.push(grow(lotRect(lots[n] as FabricLot), 0.1));
  };
  // Along the site's own streets and their links first, so the middle of the place closes up; then the ring.
  for (const r of [...site.roads, ...links]) {
    if (r.width < 2.5) continue;
    const alongX = r.az === r.bz;
    const off = r.width / 2 + WALK;
    if (alongX) {
      run({ ax: Math.min(r.ax, r.bx), az: r.az + off, bx: Math.max(r.ax, r.bx), bz: r.az + off, nx: 0, nz: 1 });
      run({ ax: Math.max(r.ax, r.bx), az: r.az - off, bx: Math.min(r.ax, r.bx), bz: r.az - off, nx: 0, nz: -1 });
    } else {
      run({ ax: r.ax + off, az: Math.max(r.az, r.bz), bx: r.ax + off, bz: Math.min(r.az, r.bz), nx: 1, nz: 0 });
      run({ ax: r.ax - off, az: Math.min(r.az, r.bz), bx: r.ax - off, bz: Math.max(r.az, r.bz), nx: -1, nz: 0 });
    }
  }
  run({ ax: inner.minX, az: inner.minZ, bx: inner.maxX, bz: inner.minZ, nx: 0, nz: 1 });
  run({ ax: inner.maxX, az: inner.maxZ, bx: inner.minX, bz: inner.maxZ, nx: 0, nz: -1 });
  run({ ax: inner.minX, az: inner.maxZ, bx: inner.minX, bz: inner.minZ, nx: 1, nz: 0 });
  run({ ax: inner.maxX, az: inner.minZ, bx: inner.maxX, bz: inner.maxZ, nx: -1, nz: 0 });

  for (const r of [...roads, ...site.roads]) if (r.width >= 2.5) kerbSlots(r, every, rng, clear, clutter);
  // Streets leaving the ring are road for as far as the place's own ground reaches; past that the far ground is marked with them.
  const stubs: Road[] = [];
  for (let k = 0; k <= nX; k++) {
    const x = hole.minX + k * P;
    stubs.push({ ax: x, az: hole.minZ - STUB, bx: x, bz: hole.minZ - h, width: W }, { ax: x, az: hole.maxZ + h, bx: x, bz: hole.maxZ + STUB, width: W });
  }
  for (let k = 0; k <= nZ; k++) {
    const z = hole.minZ + k * P;
    stubs.push({ ax: hole.minX - STUB, az: z, bx: hole.minX - h, bz: z, width: W }, { ax: hole.maxX + h, az: z, bx: hole.maxX + STUB, bz: z, width: W });
  }
  // The walkable place ends at the far kerb of the ring street: beyond it the blocks are made as they are reached.
  return { lots, roads, stubs: stubs.filter((r) => !wet(r)), clutter, grid, bounds: grow(hole, h - 3) };
}

/** Lots of the lattice whose blocks lie within `radius` of a point (whole blocks), hole excluded. */
export function lotsAround(grid: FabricGrid, kinds: readonly FabricKind[], profile: ScaleProfile, seed: number, x: number, z: number, radius: number): FabricLot[] {
  const a = blockOf(grid, x - radius, z - radius);
  const b = blockOf(grid, x + radius, z + radius);
  const out: FabricLot[] = [];
  for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) out.push(...blockLots(grid, kinds, profile, seed, i, j));
  return out;
}
