// Procedural fallback props, used when the kit has no mesh for a prop kind, and the set dressing that
// gathers against buildings (see dressTown below).
// Sizes follow PROP_SIZES at scale 1; the world matrix (position, yaw, scale) is baked into the batch.
import * as THREE from 'three';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { Blueprint, PropBlueprint, StyleSpec, SurfaceKind, SurfaceSet, ThemeId, WorldSpec } from '../world/spec';
import { GeoBatch } from './batch';
import type { MaterialCache } from './batch';
import { addBlueprint, addPropParts, expandBlueprintParts } from './blueprint-mesh';
import { GROWN_FOOTPRINTS, buildingAabb, distanceToRoad } from './layout';
import type { PlacedBuilding, PlacedProp, TownLayout } from './layout';
import { Part } from './procedural';
import type { ProcEnv } from './procedural';

/** Props whose longest side is under this many metres are drawn but never block the navmesh. */
export const VISUAL_ONLY_SIZE = 0.8;
export const isVisualOnlyProp = (sizeMetres: number): boolean => sizeMetres < VISUAL_ONLY_SIZE;

const WOOD = '#7a5233';
const DARK_WOOD = '#4e3422';
const METAL = '#6a7078';

function cyl(rt: number, rb: number, h: number, seg = 12): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(rt, rb, h, seg);
}

function foliage(theme: ThemeId): string {
  return theme === 'modern' ? '#4f8a3c' : '#3f7a35';
}

export function addProceduralProp(env: ProcEnv, prop: PlacedProp): void {
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(prop.x, 0, prop.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prop.rotY),
    new THREE.Vector3(prop.scale, prop.scale, prop.scale),
  );
  const p = new Part(env, base);
  switch (prop.kind) {
    case 'barrel':
      p.geo(cyl(0.35, 0.32, 0.9), WOOD, 0, 0.45, 0);
      for (const y of [0.25, 0.65]) p.geo(cyl(0.37, 0.37, 0.06), METAL, 0, y, 0);
      break;
    case 'crate':
      p.box(0.9, 0.9, 0.9, 0, 0.45, 0, env.theme === 'scifi' ? '#7d8a96' : '#9a7448');
      p.box(0.94, 0.1, 0.94, 0, 0.45, 0, DARK_WOOD);
      break;
    case 'tree':
      p.geo(cyl(0.22, 0.32, 2.4, 8), '#5b4030', 0, 1.2, 0);
      p.geo(new THREE.ConeGeometry(1.7, 3.4, 9), foliage(env.theme), 0, 4.0, 0);
      break;
    case 'bush':
      p.geo(new THREE.IcosahedronGeometry(0.7, 1), '#4b7d3a', 0, 0.7, 0);
      break;
    case 'cactus':
      p.geo(new THREE.CapsuleGeometry(0.25, 1.5, 4, 8), '#4f7f4a', 0, 1.0, 0);
      p.geo(new THREE.CapsuleGeometry(0.15, 0.55, 4, 8), '#4f7f4a', 0.5, 1.2, 0);
      p.geo(new THREE.CapsuleGeometry(0.15, 0.4, 4, 8), '#4f7f4a', -0.45, 0.9, 0);
      p.box(0.9, 0.12, 0.12, 0.3, 0.95, 0, '#4f7f4a');
      break;
    case 'fence':
      for (const x of [-1.4, 0, 1.4]) p.box(0.14, 1.1, 0.14, x, 0.55, 0, WOOD);
      for (const y of [0.4, 0.85]) p.box(3, 0.1, 0.06, 0, y, 0, DARK_WOOD);
      break;
    case 'water_trough':
      p.box(2, 0.6, 0.7, 0, 0.3, 0, WOOD);
      p.box(1.8, 0.05, 0.5, 0, 0.58, 0, '#3f6f8f', { roughness: 0.2, metalness: 0.2 });
      for (const x of [-0.8, 0.8]) p.box(0.12, 0.3, 0.8, x, 0.15, 0, DARK_WOOD);
      break;
    case 'hitching_post':
      for (const x of [-0.9, 0.9]) p.box(0.16, 1.3, 0.16, x, 0.65, 0, DARK_WOOD);
      p.box(2.2, 0.1, 0.1, 0, 1.1, 0, WOOD);
      break;
    case 'wagon_wheel':
      p.geo(new THREE.TorusGeometry(0.6, 0.06, 6, 16), WOOD, 0, 0.66, 0);
      p.geo(cyl(0.1, 0.1, 0.14, 8).rotateX(Math.PI / 2), DARK_WOOD, 0, 0.66, 0);
      p.box(1.1, 0.05, 0.05, 0, 0.66, 0, WOOD);
      p.box(0.05, 1.1, 0.05, 0, 0.66, 0, WOOD);
      break;
    case 'well':
      p.geo(cyl(0.9, 0.9, 0.8, 14), '#8a8478', 0, 0.4, 0);
      p.geo(cyl(0.65, 0.65, 0.05, 14), '#2c4a5c', 0, 0.78, 0);
      for (const x of [-0.8, 0.8]) p.box(0.12, 1.8, 0.12, x, 1.4, 0, DARK_WOOD);
      p.geo(new THREE.ConeGeometry(1.3, 0.7, 4).rotateY(Math.PI / 4), '#7a4a35', 0, 2.65, 0);
      break;
    case 'cart':
      p.box(1.5, 0.15, 0.9, 0, 0.6, 0, WOOD);
      p.box(1.5, 0.4, 0.08, 0, 0.85, 0.42, DARK_WOOD);
      p.box(1.5, 0.4, 0.08, 0, 0.85, -0.42, DARK_WOOD);
      for (const z of [-0.5, 0.5]) p.geo(new THREE.TorusGeometry(0.4, 0.05, 6, 14), DARK_WOOD, 0, 0.45, z);
      p.box(1.2, 0.06, 0.06, 1.3, 0.55, 0, WOOD);
      break;
    case 'hay':
      p.box(1.2, 0.9, 0.8, 0, 0.45, 0, '#d1b258');
      p.box(1.22, 0.05, 0.82, 0, 0.3, 0, '#8a7438');
      p.box(1.22, 0.05, 0.82, 0, 0.62, 0, '#8a7438');
      break;
    case 'container':
      p.box(5.8, 2.4, 2.3, 0, 1.2, 0, env.theme === 'scifi' ? '#8a5a4a' : '#7a6a58');
      p.box(5.9, 0.12, 2.4, 0, 2.4, 0, '#4a4f58');
      p.box(5.9, 0.12, 2.4, 0, 0.06, 0, '#4a4f58');
      break;
    case 'antenna':
      p.geo(cyl(0.08, 0.12, 3.2, 6), METAL, 0, 1.6, 0);
      p.geo(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 3), '#d6dae0', 0, 3.1, 0);
      p.geo(new THREE.SphereGeometry(0.08, 6, 6), '#ff4d4d', 0, 3.3, 0, { emissive: '#ff4d4d', emissiveIntensity: 1.5 });
      break;
    case 'light_pole':
      p.geo(cyl(0.06, 0.09, 3.8, 8), METAL, 0, 1.9, 0);
      p.box(0.7, 0.08, 0.14, 0.3, 3.8, 0, METAL);
      p.geo(new THREE.SphereGeometry(0.16, 8, 6), '#fff2c4', 0.6, 3.72, 0, { emissive: '#ffe9a0', emissiveIntensity: 1.6 });
      break;
    case 'plant_pod':
      p.geo(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#9fd8e8', 0, 0.2, 0, { roughness: 0.2, metalness: 0.1 });
      p.geo(cyl(0.72, 0.8, 0.2, 12), '#4a5260', 0, 0.1, 0);
      p.geo(new THREE.ConeGeometry(0.25, 0.8, 6), '#4fb06a', 0, 0.55, 0);
      break;
    case 'bench':
      p.box(1.8, 0.1, 0.5, 0, 0.5, 0, WOOD);
      p.box(1.8, 0.45, 0.08, 0, 0.8, 0.22, WOOD);
      for (const x of [-0.8, 0.8]) p.box(0.08, 0.5, 0.45, x, 0.25, 0, METAL);
      break;
    case 'bin':
      p.geo(cyl(0.34, 0.28, 0.9, 10), '#3f5a45', 0, 0.45, 0);
      p.geo(cyl(0.37, 0.37, 0.06, 10), '#2c3d30', 0, 0.92, 0);
      break;
    case 'hydrant':
      p.geo(cyl(0.16, 0.18, 0.7, 8), '#c43b2f', 0, 0.35, 0);
      p.geo(new THREE.SphereGeometry(0.17, 8, 6), '#c43b2f', 0, 0.75, 0);
      p.box(0.5, 0.12, 0.12, 0, 0.5, 0, '#c43b2f');
      break;
    case 'car': {
      const body = ['#b23a3a', '#3a5ab2', '#d8d8d8', '#2f2f35'][Math.abs(Math.round(prop.x * 7 + prop.z * 13)) % 4] ?? '#b23a3a';
      p.box(1.8, 0.6, 4.2, 0, 0.6, 0, body);
      p.box(1.6, 0.55, 2.2, 0, 1.15, -0.2, '#9cc2d8', { roughness: 0.2, metalness: 0.3 });
      for (const sx of [-1, 1]) for (const z of [-1.3, 1.3]) p.geo(cyl(0.35, 0.35, 0.25, 10).rotateZ(Math.PI / 2), '#1e1f22', sx * 0.9, 0.35, z);
      break;
    }
    default:
      p.box(0.7, 0.7, 0.7, 0, 0.35, 0, '#a08060');
  }
}

export interface TownLight { pos: THREE.Vector3; color: string; radius: number }

// ---- Poles ---------------------------------------------------------------------------------------------------
// Lamp posts, masts and antennas read as clutter long before anything else does: a thin dark line against the
// sky from every angle. A town keeps a handful, along its streets and by its doors, and each lamp among them
// gets a real light.

/** A prop is a pole when it stands taller than this and its width, averaged over its height, is under POLE_MAX_WIDTH. */
export const POLE_MIN_HEIGHT = 3;
export const POLE_MAX_WIDTH = 0.6;
/** How many poles a town keeps, and how far apart they stand. */
export const MAX_POLES = 14;
export const POLE_SPACING = 9;

export interface PropProfile {
  /** Top of the tallest part, metres. */
  height: number;
  /** Width of the parts averaged over their heights, metres: a lamp post is its shaft, a tree is its crown. */
  width: number;
  /** Centre height of the highest glowing part, or null when nothing on it glows. */
  glowY: number | null;
}

/** The outline of a prop kind at a slot scale, measured the way addPropParts builds it. */
export function propProfile(kind: Pick<PropBlueprint, 'size' | 'parts'>, scale = 1): PropProfile {
  const fp = Math.min(6, Math.max(0.3, kind.size)) * scale;
  let height = 0;
  let area = 0;
  let span = 0;
  let glowY: number | null = null;
  for (const p of expandBlueprintParts(kind.parts)) {
    const h = Math.min(30, Math.max(0.02, p.h)) * fp;
    const y = Math.min(30, Math.max(0, p.y)) * fp;
    const w = Math.min(1.4, Math.max(0.002, Math.max(p.w, p.d))) * fp;
    height = Math.max(height, y + h);
    area += w * h;
    span += h;
    if (p.tone === 'glow') glowY = Math.max(glowY ?? 0, y + h / 2);
  }
  return { height, width: span > 0 ? area / span : 0, glowY };
}

export function isPole(profile: Pick<PropProfile, 'height' | 'width'>): boolean {
  return profile.height > POLE_MIN_HEIGHT && profile.width < POLE_MAX_WIDTH;
}

/**
 * Which of the candidate spots keep their pole: those nearest a road or a door first, each at least
 * `spacing` metres from every one already kept, `max` at most. Returns indices into `spots`.
 */
export function pickPoleSpots(
  spots: readonly { x: number; z: number }[], layout: Pick<TownLayout, 'roads' | 'buildings'>, max = MAX_POLES, spacing = POLE_SPACING,
): number[] {
  const ranked = spots.map((s, index) => {
    let near = Infinity;
    for (const rd of layout.roads) near = Math.min(near, distanceToRoad(rd, s.x, s.z));
    for (const b of layout.buildings) near = Math.min(near, Math.hypot(s.x - b.door.x, s.z - b.door.z));
    return { index, near };
  }).sort((a, b) => a.near - b.near || a.index - b.index);
  const kept: number[] = [];
  for (const c of ranked) {
    if (kept.length >= max) break;
    const s = spots[c.index] as { x: number; z: number };
    if (kept.some((k) => Math.hypot((spots[k] as { x: number; z: number }).x - s.x, (spots[k] as { x: number; z: number }).z - s.z) < spacing)) continue;
    kept.push(c.index);
  }
  return kept;
}

/** How far a lamp of this height lights the ground, metres: it has to reach the ground to be worth a light. */
export function lampRadius(glowY: number): number {
  return Math.min(18, Math.max(7, glowY * 1.4));
}

function pickWeighted<T>(items: readonly T[], weights: readonly number[], rng: Rng): T | undefined {
  const total = weights.reduce((a, b) => a + b, 0);
  let t = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    t -= weights[i] ?? 0;
    if (t < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Scatters generated prop kinds over the layout's prop slots. Each slot takes one spec prop, picked by
 * weight with the rng; the slot's position, yaw and scale are kept. Poles are capped (see pickPoleSpots,
 * which needs `layout`): a slot that loses its pole takes another kind of prop, or stays empty when the
 * town has no other kind. A kept pole with a glowing part adds a light to `lights`, unless it glows too
 * high up to light the ground. Returns how many were placed per kind.
 */
export function scatterBlueprintProps(
  slots: readonly PlacedProp[], kinds: readonly PropBlueprint[], style: StyleSpec,
  env: {
    batch: GeoBatch; mats: MaterialCache; rng: Rng; visualBatch?: GeoBatch;
    layout?: Pick<TownLayout, 'roads' | 'buildings'>; lights?: TownLight[];
    /** Called with a slot's position before its prop is added, and with nulls after: lets the caller seat it on the land. */
    seat?: (x: number | null, z: number | null) => void;
    /** How many poles are kept and how far apart (defaults MAX_POLES, POLE_SPACING): a wilderness of snags and cacti keeps more. */
    maxPoles?: number; poleSpacing?: number;
  },
): Map<string, number> {
  const counts = new Map<string, number>();
  const usable = kinds.filter((k) => k.parts.length > 0);
  if (usable.length === 0) return counts;
  const weight = (k: PropBlueprint): number => Math.min(5, Math.max(1, Number.isFinite(k.weight) ? k.weight : 1));
  const weights = usable.map(weight);
  const picks = slots.map(() => pickWeighted(usable, weights, env.rng));

  // Poles: a kind is one or is not, judged at its own size; then the slots that drew one, and the few that keep it.
  const poles = new Set(usable.filter((k) => isPole(propProfile(k))));
  const poleSlots: number[] = [];
  picks.forEach((kind, i) => {
    if (kind && poles.has(kind)) poleSlots.push(i);
  });
  const keptPoles = new Set(
    pickPoleSpots(poleSlots.map((i) => slots[i] as PlacedProp), env.layout ?? { roads: [], buildings: [] }, env.maxPoles ?? MAX_POLES, env.poleSpacing ?? POLE_SPACING)
      .map((k) => poleSlots[k] as number),
  );
  const sturdy = usable.filter((k) => !poles.has(k));
  const sturdyWeights = sturdy.map(weight);

  slots.forEach((slot, i) => {
    let kind = picks[i];
    const pole = keptPoles.has(i);
    if (!pole && kind !== undefined && poles.has(kind)) kind = sturdy.length > 0 ? pickWeighted(sturdy, sturdyWeights, env.rng) : undefined;
    if (!kind) return;
    const small = isVisualOnlyProp(kind.size * slot.scale);
    const target = small && env.visualBatch ? env.visualBatch : env.batch;
    env.seat?.(slot.x, slot.z);
    addPropParts(kind.parts, kind.size, style, slot, { batch: target, mats: env.mats, rng: env.rng });
    env.seat?.(null, null);
    counts.set(kind.kind, (counts.get(kind.kind) ?? 0) + 1);
    const glowY = pole ? propProfile(kind, slot.scale).glowY : null;
    // A beacon on a mast too tall for its light to reach the ground is left as a glow.
    if (glowY !== null && env.lights && lampRadius(glowY) >= glowY) {
      env.lights.push({ pos: new THREE.Vector3(slot.x, glowY, slot.z), color: style.glow, radius: lampRadius(glowY) });
    }
  });
  return counts;
}

// ---- Set dressing ------------------------------------------------------------------------------------------
// What accumulates against buildings: goods stacked by a side wall, planks left leaning, a sign on a bracket,
// a lantern on a post by the door, lines strung across the street. Stacks of crates and barrels are solid
// (they go to `batch`, so the navmesh and the camera respect them); everything else is drawn only.

export interface DressInput {
  layout: TownLayout; spec: WorldSpec; style: StyleSpec; surfaces: SurfaceSet;
  /** Roof height per building id, metres. */
  heights: ReadonlyMap<string, number>;
  /** The blueprint each building was built from, when it was. */
  blueprints: ReadonlyMap<string, Blueprint>;
  /** Spots nothing may be put on (landmark anchors). */
  keepClear: readonly { x: number; z: number; r: number }[];
  batch: GeoBatch; visualBatch: GeoBatch; mats: MaterialCache; quality: 0 | 1 | 2;
}

export type LineKind = 'bunting' | 'cables' | 'vines' | 'lights';

export interface DressResult {
  lights: TownLight[];
  smoke: THREE.Vector3[];
  counts: { stacks: number; planks: number; signs: number; lanterns: number; lines: number };
  lineKind: LineKind;
}

const mixHex = (a: string, b: string, t: number): string => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const WOODY = new Set<SurfaceKind>(['timber', 'planks', 'log', 'thatch', 'shingle', 'bark']);
const HIGH_TECH = new Set<SurfaceKind>(['metal_panel', 'hull_plate', 'glass_curtain', 'corrugated', 'concrete', 'rusted']);
const HEARTH = new Set<string>(['house', 'inn', 'tavern', 'saloon', 'blacksmith', 'cafe', 'workshop', 'hotel', 'cantina', 'habitat', 'reactor', 'general_store']);
const GOODS = /crate|barrel|sack|box|stack|pot|urn|basket|jar|bale|keg|drum|bundle|bag|canister|cask|amphora/;

/** What is strung between facing buildings, from the words of the world, then its materials, then its theme. */
export function lineKindFor(words: string, theme: ThemeId, surfaces: SurfaceSet, wild: number): LineKind {
  const w = words.toLowerCase();
  if (/neon|cyber|arcolog|industrial|station|container|dock|shipyard|colony|outpost/.test(w)) return 'cables';
  if (/forest|jungle|grove|mushroom|swamp|overgrown|ruin|fung|elven/.test(w)) return 'vines';
  if (/festival|market|fair|carnival|lantern|edo|bazaar|harbou?r/.test(w)) return 'lights';
  if (surfaces.wall === 'organic' || surfaces.wall === 'bark' || surfaces.wall === 'coral' || surfaces.ground === 'moss' || wild > 0.7) return 'vines';
  if (HIGH_TECH.has(surfaces.wall) || theme === 'scifi' || theme === 'modern') return 'cables';
  return 'bunting';
}

/**
 * Points along a line hanging between two fixed ends: a true catenary (a cosh curve) whose lowest point is
 * `sag` metres below the chord at mid-span, sheared so it meets both ends when they are at different heights.
 * Returns n + 1 points, the first at `a`, the last at `b`.
 */
export function catenaryPoints(a: THREE.Vector3, b: THREE.Vector3, sag: number, n: number): THREE.Vector3[] {
  const span = Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z));
  const drop = Math.max(0, sag);
  // Solve c * (cosh(span / 2c) - 1) = drop for c by bisection; a large c is a taut line.
  let lo = span / 40;
  let hi = span * 400;
  for (let i = 0; i < 48; i++) {
    const c = (lo + hi) / 2;
    if (c * (Math.cosh(span / (2 * c)) - 1) > drop) lo = c; else hi = c;
  }
  const c = (lo + hi) / 2;
  const edge = Math.cosh(span / (2 * c));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = drop > 0 ? c * (Math.cosh(((t - 0.5) * span) / c) - edge) : 0;
    out.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + y, a.z + (b.z - a.z) * t));
  }
  return out;
}

const frontOf = (b: { rotY: number }): { fx: number; fz: number; ux: number; uz: number } =>
  ({ fx: -Math.sin(b.rotY), fz: -Math.cos(b.rotY), ux: Math.cos(b.rotY), uz: -Math.sin(b.rotY) });

/** Pairs of buildings that look at each other across 6 to 30 m of open ground, nearest pairs first. */
export function facingPairs(buildings: readonly PlacedBuilding[]): [PlacedBuilding, PlacedBuilding][] {
  const pairs: { a: PlacedBuilding; b: PlacedBuilding; gap: number }[] = [];
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const a = buildings[i] as PlacedBuilding;
      const b = buildings[j] as PlacedBuilding;
      const fa = frontOf(a);
      const fb = frontOf(b);
      if (fa.fx * fb.fx + fa.fz * fb.fz > -0.9) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const gap = dx * fa.fx + dz * fa.fz - a.d / 2 - b.d / 2;
      const lateral = Math.abs(dx * fa.ux + dz * fa.uz);
      if (gap < 6 || gap > 30 || lateral > (a.w + b.w) / 2) continue;
      pairs.push({ a, b, gap });
    }
  }
  return pairs.sort((p, q) => p.gap - q.gap).map((p) => [p.a, p.b]);
}

/** Half extents and centre offset of a building's main body in its own frame (x along the front, -z toward the street). */
function bodyOf(b: PlacedBuilding, bp: Blueprint | undefined): { hw: number; hd: number; ox: number; oz: number } {
  const p = bp && !bp.family ? bp.parts[0] : undefined;
  if (p && p.shape === 'box' && p.y < 0.6 && [p.w, p.d, p.x, p.z].every(Number.isFinite)) {
    // Blueprint +z is the street side; the building frame faces -z, so both axes flip.
    return { hw: (clampTo(p.w, 0.3, 1) * b.w) / 2, hd: (clampTo(p.d, 0.3, 1) * b.d) / 2, ox: -clampTo(p.x, -0.3, 0.3) * b.w, oz: -clampTo(p.z, -0.3, 0.3) * b.d };
  }
  return { hw: b.w / 2, hd: b.d / 2, ox: 0, oz: 0 };
}

/** Where smoke should rise: the top of a chimney-like blueprint part, else a point on the roof of a building with a hearth. */
export function chimneyTops(
  layout: TownLayout, blueprints: ReadonlyMap<string, Blueprint>, heights: ReadonlyMap<string, number>,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const limit = Math.max(2, Math.ceil(layout.buildings.length / 2));
  for (const b of layout.buildings) {
    if (out.length >= limit) break;
    const h = heights.get(b.id) ?? 4;
    const a = b.rotY + Math.PI;
    const world = (px: number, y: number, pz: number): THREE.Vector3 =>
      new THREE.Vector3(b.x + px * Math.cos(a) + pz * Math.sin(a), y, b.z - px * Math.sin(a) + pz * Math.cos(a));
    const bp = blueprints.get(b.id);
    let best: THREE.Vector3 | null = null;
    let bestTop = 0;
    for (const p of bp ? expandBlueprintParts(bp.parts) : []) {
      const top = p.y + p.h;
      if ((p.shape !== 'box' && p.shape !== 'cylinder') || p.w > 0.22 || p.d > 0.22 || p.h < 0.5) continue;
      if (p.tone === 'glow' || p.tone === 'glass' || top < h * 0.85 || top <= bestTop) continue;
      bestTop = top;
      best = world(p.x * b.w, top + 0.1, p.z * b.d);
    }
    if (best) out.push(best);
    else if (HEARTH.has(b.role)) out.push(world(-0.25 * b.w, h + 0.1, -0.15 * b.d));
  }
  return out;
}

export function dressTown(inp: DressInput): DressResult {
  const { layout, spec, style, surfaces, batch, visualBatch, mats } = inp;
  const rng = makeRng(spec.seed, 'dress');
  const lights: TownLight[] = [];
  const counts = { stacks: 0, planks: 0, signs: 0, lanterns: 0, lines: 0 };
  const woody = WOODY.has(surfaces.wall) || WOODY.has(surfaces.trim);
  const tech = HIGH_TECH.has(surfaces.wall) || ((spec.theme === 'scifi' || spec.theme === 'modern') && !woody);
  const wood = mixHex(style.wall2, '#7a5c3e', woody ? 0.35 : 0.7);
  const darkWood = mixHex(wood, style.dark, 0.55);
  const metal = mixHex(style.dark, '#7b8188', 0.45);
  const cloth = mixHex(style.trim, '#b7a37a', 0.5);
  const glow = style.glow;
  const glowMat = mats.get(glow, { emissive: glow, emissiveIntensity: 2.2, roughness: 0.4 });
  const iron = mats.get(metal, { roughness: 0.6, metalness: 0.5 });
  const goods = (spec.props ?? []).filter((k) => k.parts.length > 0 && k.size <= 1.4 && GOODS.test(k.kind));
  const boxes = layout.buildings.map((b) => buildingAabb(b));
  const pl = layout.plaza;

  const clear = (x: number, z: number, r: number, own: number): boolean => {
    if (Math.hypot(x - pl.x, z - pl.z) < pl.r + r + 0.3) return false;
    if (layout.roads.some((rd) => distanceToRoad(rd, x, z) < r + 0.3)) return false;
    if (boxes.some((q, i) => i !== own && x > q.minX - r && x < q.maxX + r && z > q.minZ - r && z < q.maxZ + r)) return false;
    if (layout.buildings.some((b) => Math.hypot(x - b.door.x, z - b.door.z) < 2.6)) return false;
    if (layout.walkable.some((p) => Math.hypot(x - p.x, z - p.z) < 1.6)) return false;
    if (inp.keepClear.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r)) return false;
    return Math.hypot(x - layout.spawn.x, z - layout.spawn.z) > 3;
  };

  const tmp = new THREE.Matrix4();
  const rotM = new THREE.Matrix4();
  /** Adds `geo` at a point in a base frame, turned `yaw` about the vertical and `roll` about the frame's z axis. */
  const put = (target: GeoBatch, base: THREE.Matrix4, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, yaw = 0, roll = 0): void => {
    const m = new THREE.Matrix4().multiplyMatrices(base, tmp.makeTranslation(x, y, z));
    if (yaw !== 0) m.multiply(rotM.makeRotationY(yaw));
    if (roll !== 0) m.multiply(rotM.makeRotationZ(roll));
    target.add(geo, mat, m);
  };
  type Goods = 'crate' | 'barrel' | 'sack';
  /** One crate, barrel or sack with its base at `y`; returns its height. */
  const unit = (kind: Goods, base: THREE.Matrix4, x: number, y: number, z: number, s: number, yaw: number): number => {
    if (kind === 'crate') {
      put(batch, base, new THREE.BoxGeometry(s, s, s), mats.get(tech ? mixHex(metal, style.wall, 0.4) : wood), x, y + s / 2, z, yaw);
      for (const f of [0.2, 0.8]) put(batch, base, new THREE.BoxGeometry(s * 1.04, s * 0.1, s * 1.04), mats.get(tech ? style.accent : darkWood), x, y + s * f, z, yaw);
      return s;
    }
    if (kind === 'barrel') {
      const h = s * 1.25;
      put(batch, base, new THREE.CylinderGeometry(s * 0.42, s * 0.38, h, 12), mats.get(tech ? mixHex(style.accent, metal, 0.55) : wood), x, y + h / 2, z, yaw);
      for (const f of [0.24, 0.72]) put(batch, base, new THREE.CylinderGeometry(s * 0.435, s * 0.435, h * 0.06, 12), iron, x, y + h * f, z, yaw);
      return h;
    }
    put(visualBatch, base, new THREE.SphereGeometry(0.5, 8, 6).scale(s * 1.25, s * 0.55, s * 0.85), mats.get(cloth), x, y + s * 0.26, z, yaw);
    return s * 0.5;
  };

  layout.buildings.forEach((b, index) => {
    const base = new THREE.Matrix4().makeTranslation(b.x, 0, b.z).multiply(new THREE.Matrix4().makeRotationY(b.rotY));
    const body = bodyOf(b, inp.blueprints.get(b.id));
    const h = inp.heights.get(b.id) ?? 4;
    const f = frontOf(b);
    const toWorld = (lx: number, lz: number): { x: number; z: number } => ({ x: b.x + f.ux * lx - f.fx * lz, z: b.z + f.uz * lx - f.fz * lz });

    // Goods against the right-hand wall and the back wall; never the front, never both sides of one alley.
    const walls: { lx: (t: number) => number; lz: (t: number) => number; len: number }[] = [
      { lx: () => body.ox + body.hw + 0.5, lz: (t) => body.oz + t, len: body.hd * 2 },
      { lx: (t) => body.ox + t, lz: () => body.oz + body.hd + 0.5, len: body.hw * 2 },
    ];
    for (const w of walls) {
      if (!rng.chance(inp.quality === 0 ? 0.4 : 0.7)) continue;
      const centre = rng.range(-0.3, 0.3) * w.len;
      const n = rng.int(2, 3);
      const kind: Goods = rng.pick(tech ? (['crate', 'crate', 'barrel'] as const) : (['crate', 'barrel', 'sack', 'crate'] as const));
      let placedAny = false;
      let prev: { lx: number; lz: number; top: number } | null = null;
      for (let k = 0; k < n; k++) {
        const s = kind === 'sack' ? rng.range(0.5, 0.7) : rng.range(0.55, 0.8);
        const t = centre + (k - (n - 1) / 2) * 0.86;
        const yaw = rng.range(-0.22, 0.22);
        const prop = goods.length > 0 && rng.chance(0.5) ? rng.pick(goods) : null;
        if (Math.abs(t) > w.len / 2 - 0.3) continue;
        const lx = w.lx(t);
        const lz = w.lz(t);
        const p = toWorld(lx, lz);
        if (!clear(p.x, p.z, 0.5, index)) continue;
        placedAny = true;
        if (prop) {
          const scale = clampTo(0.8 / prop.size, 0.5, 1) * rng.range(0.9, 1.1);
          addPropParts(prop.parts, prop.size, style, { x: p.x, z: p.z, rotY: b.rotY + yaw, scale }, { batch: isVisualOnlyProp(prop.size * scale) ? visualBatch : batch, mats, rng });
          prev = null;
          continue;
        }
        const top = unit(kind, base, lx, 0, lz, s, yaw);
        // One more on top of a pair, set askew.
        if (prev && rng.chance(0.6)) unit(kind, base, (prev.lx + lx) / 2, Math.min(prev.top, top) * (kind === 'sack' ? 0.8 : 1), (prev.lz + lz) / 2, s * 0.85, yaw + 0.5);
        prev = { lx, lz, top };
      }
      if (placedAny) counts.stacks++;
    }

    // Planks left leaning on the other side wall.
    if (!tech && rng.chance(0.55)) {
      const lz = body.oz + rng.range(-0.5, 0.5) * body.hd;
      const n = rng.int(2, 4);
      const p = toWorld(body.ox - body.hw - 0.3, lz);
      const ok = clear(p.x, p.z, 0.35, index);
      for (let k = 0; k < n; k++) {
        const len = Math.min(h * 0.85, rng.range(1.9, 3.1));
        const out = rng.range(0.38, 0.6);
        const width = rng.range(0.14, 0.22);
        if (!ok) continue;
        const lean = Math.asin(Math.min(0.9, out / len));
        put(visualBatch, base, new THREE.BoxGeometry(0.035, len, width), mats.get(k % 2 === 0 ? wood : mixHex(wood, '#9a8f80', 0.4)),
          body.ox - body.hw - 0.03 - out / 2, (len * Math.cos(lean)) / 2, lz + (k - 1) * 0.2, 0, -lean);
      }
      if (ok) counts.planks++;
    }

    // The door in this frame, then a lantern on one side of it and a hanging sign on the other.
    const doorX = clampTo((b.door.x - b.x) * f.ux + (b.door.z - b.z) * f.uz, -b.w / 2, b.w / 2);
    const side = doorX > 0.01 ? -1 : doorX < -0.01 ? 1 : rng.chance(0.5) ? 1 : -1;
    const frontZ = body.oz - body.hd;
    const lx = doorX + side * 1.05;
    let lz = -b.d / 2 - 0.5;
    const wp = toWorld(lx, lz);
    if (layout.roads.some((rd) => distanceToRoad(rd, wp.x, wp.z) < 0.2)) lz = -b.d / 2 - 0.12;
    const postMat = tech ? iron : mats.get(darkWood);
    let lampX = lx - side * 0.25;
    let lampY = 2.66;
    if (tech) {
      // A slim pylon with a light bar reaching toward the door.
      put(visualBatch, base, new THREE.BoxGeometry(0.07, 2.7, 0.07), postMat, lx, 1.35, lz);
      put(visualBatch, base, new THREE.BoxGeometry(0.56, 0.06, 0.13), postMat, lx - side * 0.22, 2.72, lz);
      put(visualBatch, base, new THREE.BoxGeometry(0.46, 0.035, 0.09), glowMat, lampX, 2.675, lz);
    } else {
      // A post with a braced arm; the lantern hangs from it: cap, four corner bars, the lit core, a base plate.
      lampX = lx - side * 0.38;
      lampY = 2.02;
      put(visualBatch, base, new THREE.BoxGeometry(0.09, 2.4, 0.09), postMat, lx, 1.2, lz);
      put(visualBatch, base, new THREE.BoxGeometry(0.46, 0.05, 0.05), postMat, lx - side * 0.2, 2.32, lz);
      put(visualBatch, base, new THREE.BoxGeometry(0.035, 0.42, 0.035), postMat, lx - side * 0.13, 2.16, lz, 0, side * 0.75);
      put(visualBatch, base, new THREE.BoxGeometry(0.012, 0.12, 0.012), postMat, lampX, 2.24, lz);
      put(visualBatch, base, new THREE.ConeGeometry(0.16, 0.09, 4).rotateY(Math.PI / 4), postMat, lampX, 2.165, lz);
      put(visualBatch, base, new THREE.BoxGeometry(0.13, 0.2, 0.13), glowMat, lampX, lampY, lz);
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) put(visualBatch, base, new THREE.BoxGeometry(0.014, 0.22, 0.014), postMat, lampX + cx * 0.075, lampY, lz + cz * 0.075);
      put(visualBatch, base, new THREE.BoxGeometry(0.18, 0.025, 0.18), postMat, lampX, 1.905, lz);
    }
    const lamp = toWorld(lampX, lz);
    lights.push({ pos: new THREE.Vector3(lamp.x, lampY, lamp.z), color: glow, radius: tech ? 9 : 7 });
    counts.lanterns++;

    if (rng.chance(0.6) && h >= 3.2) {
      // Bracket arm out from the wall, two short chains, a board hung edge-on to the street so it reads from along it.
      const sx = clampTo(doorX - side * 1.3, body.ox - body.hw + 0.25, body.ox + body.hw - 0.25);
      const y = clampTo(h * 0.55, 2.5, 3.4);
      put(visualBatch, base, new THREE.BoxGeometry(0.05, 0.05, 0.86), iron, sx, y, frontZ - 0.4);
      for (const dz of [-0.62, -0.28]) put(visualBatch, base, new THREE.BoxGeometry(0.014, 0.1, 0.014), iron, sx, y - 0.075, frontZ + dz);
      put(visualBatch, base, new THREE.BoxGeometry(0.035, 0.44, 0.6), mats.get(tech ? style.dark : mixHex(style.trim, wood, 0.3)), sx, y - 0.345, frontZ - 0.45);
      put(visualBatch, base, new THREE.BoxGeometry(0.05, 0.3, 0.46), tech ? glowMat : mats.get(style.accent), sx, y - 0.345, frontZ - 0.45);
      counts.signs++;
    }
  });

  // Lines across the street between buildings that face each other.
  const lineKind = lineKindFor(`${spec.prompt} ${spec.title} ${spec.era} ${style.name}`, spec.theme, surfaces, spec.site?.wild ?? 0.3);
  const maxLines = inp.quality === 0 ? 3 : inp.quality === 1 ? 5 : 8;
  const flagColours = [style.accent, style.trim, style.glow, style.wall2];
  const flagTris: number[][] = flagColours.map(() => []);
  const rope = mats.get(lineKind === 'vines' ? mixHex('#3d5a2e', style.ground, 0.3) : lineKind === 'cables' ? mixHex(style.dark, '#15161a', 0.5) : darkWood);
  const leaf = mats.get(mixHex('#4f7a38', style.ground, 0.25));
  const identity = new THREE.Matrix4();
  for (const [a, b] of facingPairs(layout.buildings)) {
    if (counts.lines >= maxLines) break;
    const ends = [a, b].map((bd) => {
      const f = frontOf(bd);
      const lat = rng.range(-0.32, 0.32) * bd.w;
      const y = clampTo((inp.heights.get(bd.id) ?? 4) * 0.72, 3.1, 6);
      return new THREE.Vector3(bd.x + f.fx * (bd.d / 2 - 0.15) + f.ux * lat, y, bd.z + f.fz * (bd.d / 2 - 0.15) + f.uz * lat);
    }) as [THREE.Vector3, THREE.Vector3];
    const span = Math.hypot(ends[1].x - ends[0].x, ends[1].z - ends[0].z);
    const strands = lineKind === 'cables' ? rng.int(2, 3) : 1;
    let hung = false;
    for (let strand = 0; strand < strands; strand++) {
      const sag = Math.min(span * rng.range(0.05, 0.11), Math.min(ends[0].y, ends[1].y) - 2.75);
      if (sag < 0.12 || span < 1) continue;
      hung = true;
      const segs = Math.max(8, Math.round(span / 0.8));
      const pts = catenaryPoints(ends[0], ends[1], sag, segs);
      const radius = lineKind === 'vines' ? 0.03 : lineKind === 'cables' ? 0.02 : 0.012;
      visualBatch.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, 4, false), rope, identity);
      const dirX = (ends[1].x - ends[0].x) / span;
      const dirZ = (ends[1].z - ends[0].z) / span;
      const every = lineKind === 'bunting' ? 0.42 : lineKind === 'vines' ? 0.33 : lineKind === 'lights' ? 0.85 : 1.3;
      for (let k = 1, steps = Math.floor(span / every); k < steps; k++) {
        const t = ((k * every) / span) * segs;
        const i0 = Math.min(segs - 1, Math.floor(t));
        const p = (pts[i0] as THREE.Vector3).clone().lerp(pts[i0 + 1] as THREE.Vector3, t - i0);
        if (lineKind === 'bunting') {
          // A pennant: two corners on the rope, the point hanging below, wound both ways.
          const tri = flagTris[k % flagTris.length] as number[];
          const ax = p.x - dirX * 0.12; const az = p.z - dirZ * 0.12; const bx = p.x + dirX * 0.12; const bz = p.z + dirZ * 0.12;
          tri.push(ax, p.y, az, bx, p.y, bz, p.x, p.y - 0.3, p.z, bx, p.y, bz, ax, p.y, az, p.x, p.y - 0.3, p.z);
        } else if (lineKind === 'vines') {
          const dropLen = rng.chance(0.25) ? rng.range(0.4, 1.1) : rng.range(0.08, 0.25);
          put(visualBatch, identity, new THREE.BoxGeometry(0.014, dropLen, 0.014), rope, p.x, p.y - dropLen / 2, p.z);
          put(visualBatch, identity, new THREE.OctahedronGeometry(0.09, 0).scale(1, 1.5, 0.25), leaf, p.x, p.y - dropLen, p.z, rng.range(0, 3));
        } else if (lineKind === 'lights' || strand === 0) {
          // Lantern string, or marker lamps along the first cable of a bundle.
          put(visualBatch, identity, new THREE.BoxGeometry(0.08, 0.1, 0.08), glowMat, p.x, p.y - 0.07, p.z);
        }
      }
      if (strand === 0 && lineKind === 'lights') {
        const mid = pts[Math.floor(segs / 2)] as THREE.Vector3;
        lights.push({ pos: new THREE.Vector3(mid.x, mid.y - 0.1, mid.z), color: glow, radius: 6 });
      }
    }
    if (hung) counts.lines++;
  }
  flagTris.forEach((tri, i) => {
    if (tri.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    g.computeVertexNormals();
    visualBatch.add(g, mats.get(flagColours[i] as string), identity);
  });

  return { lights, smoke: chimneyTops(layout, inp.blueprints, inp.heights), counts, lineKind };
}

// ---- The middle distance -----------------------------------------------------------------------------------
// Beyond the last building the land should not be empty. A world that carries terrain gets a ring, out to
// BACKDROP_REACH metres past its bounds, of the world's own things at larger than life: its tall natural
// props (trees, spires, snags, kelp) thickening with SiteSpec.wild, and silhouettes of its own blueprints at
// 1.5 to 3 times their size thickening with TerrainSpec.settled. Each kind is built once and drawn instanced;
// nothing here collides or feeds the navmesh, and the fog takes the far end of it.

export const BACKDROP_REACH = 120;
/** A prop stands in the middle distance when it is at least this tall and this wide and carries no light. */
export const BACKDROP_MIN_HEIGHT = 2.5;
export const BACKDROP_MIN_WIDTH = 0.45;

export interface BackdropInput {
  layout: Pick<TownLayout, 'bounds'>;
  seed: number;
  style: StyleSpec;
  /** SiteSpec.wild and TerrainSpec.settled, 0..1. */
  wild: number; settled: number;
  props: readonly PropBlueprint[];
  blueprints: readonly Blueprint[];
  heightAt(x: number, z: number): number;
  waterDepthAt(x: number, z: number): number;
  mats: MaterialCache;
  quality: 0 | 1 | 2;
  /** Where the ring starts, metres past the bounds: outside what can be walked. */
  inner: number;
}

export interface Backdrop {
  group: THREE.Group;
  /** Instances placed. */
  plants: number; structures: number;
  triangles: number;
  dispose(): void;
}

/** Which prop kinds stand in the middle distance: tall, not thin, unlit. Judged from their shape alone. */
export function backdropKinds(props: readonly PropBlueprint[]): PropBlueprint[] {
  return props.filter((k) => {
    if (k.parts.length === 0) return false;
    const pr = propProfile(k);
    return pr.height >= BACKDROP_MIN_HEIGHT && pr.width >= BACKDROP_MIN_WIDTH && pr.glowY === null;
  });
}

/** How many plants and structures the ring holds at a quality, before the land's own dials thin them. */
export function backdropBudget(quality: 0 | 1 | 2, wild: number, settled: number): { plants: number; structures: number; triangles: number } {
  const unit = (v: number, d: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  const w = unit(wild, 0.3);
  const st = unit(settled, 0.7);
  const cap = quality === 2 ? 2000 : quality === 1 ? 1100 : 450;
  return {
    plants: Math.round(cap * w ** 0.8 * (1 - 0.8 * st)),
    structures: Math.round((quality === 0 ? 20 : 46) * Math.max(0, (st - 0.25) / 0.75)),
    triangles: quality === 2 ? 900000 : quality === 1 ? 450000 : 150000,
  };
}

export function buildBackdrop(inp: BackdropInput): Backdrop {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const b = inp.layout.bounds;
  const budget = backdropBudget(inp.quality, inp.wild, inp.settled);
  const rng = makeRng(inp.seed, 'backdrop');
  const geos: THREE.BufferGeometry[] = [];
  const instanced: THREE.InstancedMesh[] = [];
  let triangles = 0;
  const r0 = inp.inner;
  const r1 = Math.max(r0 + 20, BACKDROP_REACH);
  const outside = (x: number, z: number): number => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
  /** A dry point in the ring, biased toward its near edge; `t` is how far out it lies, 0..1. Null when none is found. */
  const spot = (): { x: number; z: number; t: number } | null => {
    for (let k = 0; k < 12; k++) {
      const x = rng.range(b.minX - r1, b.maxX + r1);
      const z = rng.range(b.minZ - r1, b.maxZ + r1);
      const d = outside(x, z);
      if (d < r0 || d > r1) continue;
      const t = (d - r0) / (r1 - r0);
      if (rng.next() < 0.45 * t) continue;
      if (inp.waterDepthAt(x, z) > 0.1) continue;
      return { x, z, t };
    }
    return null;
  };
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  /** One model, many places: every mesh of the model becomes an instanced mesh. */
  const place = (meshes: THREE.Mesh[], at: { x: number; y: number; z: number; yaw: number; s: number }[], name: string): void => {
    for (const mesh of meshes) {
      geos.push(mesh.geometry);
      if (at.length === 0) continue;
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, at.length);
      at.forEach((a, i) => {
        m4.compose(pos.set(a.x, a.y, a.z), quat.setFromAxisAngle(up, a.yaw), scl.set(a.s, a.s, a.s));
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = name;
      im.castShadow = false;
      im.receiveShadow = false;
      im.matrixAutoUpdate = false;
      instanced.push(im);
      group.add(im);
      triangles += (mesh.geometry.getAttribute('position').count / 3) * at.length;
    }
  };
  const trianglesOf = (meshes: THREE.Mesh[]): number => meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0);

  // Structures first: they are few, and the plants then fill around them.
  let structures = 0;
  const taken: { x: number; z: number; r: number }[] = [];
  if (budget.structures > 0 && inp.blueprints.length > 0) {
    const fp = GROWN_FOOTPRINTS.medium;
    const per = new Map<number, { x: number; y: number; z: number; yaw: number; s: number }[]>();
    for (let k = 0; k < budget.structures; k++) {
      const p = spot();
      if (!p) continue;
      const s = 1.5 + 1.5 * Math.min(1, p.t * 0.8 + rng.range(0, 0.4));
      const r = Math.hypot(fp.w, fp.d) * 0.5 * s + 2;
      if (taken.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < q.r + r)) continue;
      taken.push({ x: p.x, z: p.z, r });
      const which = rng.int(0, inp.blueprints.length - 1);
      const list = per.get(which) ?? [];
      // Sunk a little, so no base floats where the land falls away under a wide footprint.
      list.push({ x: p.x, y: inp.heightAt(p.x, p.z) - 0.6 * s, z: p.z, yaw: rng.int(0, 3) * (Math.PI / 2) + rng.range(-0.15, 0.15), s });
      per.set(which, list);
      structures++;
    }
    for (const [which, list] of per) {
      const bp = inp.blueprints[which] as Blueprint;
      const model = new GeoBatch();
      addBlueprint(bp, inp.style, { x: 0, z: 0, rotY: 0, w: fp.w, d: fp.d }, { batch: model, mats: inp.mats, rng }, { dress: false });
      place(model.build(), list, `backdrop:${bp.id}`);
    }
  }

  let plants = 0;
  const kinds = backdropKinds(inp.props);
  if (budget.plants > 0 && kinds.length > 0) {
    const models = kinds.map((k) => {
      const model = new GeoBatch();
      addPropParts(k.parts, k.size, inp.style, { x: 0, z: 0, rotY: 0, scale: 1 }, { batch: model, mats: inp.mats, rng });
      return model.build();
    });
    const weights = kinds.map((k) => Math.min(5, Math.max(1, Number.isFinite(k.weight) ? k.weight : 1)));
    const mean = models.reduce((n, m, i) => n + trianglesOf(m) * (weights[i] as number), 0) / weights.reduce((a, c) => a + c, 0);
    const want = Math.min(budget.plants, Math.floor(Math.max(0, budget.triangles - triangles) / Math.max(1, mean)));
    const lists = kinds.map((): { x: number; y: number; z: number; yaw: number; s: number }[] => []);
    const index = kinds.map((_, i) => i);
    for (let k = 0; k < want; k++) {
      const p = spot();
      if (!p) continue;
      if (taken.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < q.r * 0.7)) continue;
      const i = pickWeighted(index, weights, rng) ?? 0;
      // Giants behind the giants: what stands further off stands taller.
      const s = (1 + 1.3 * p.t) * rng.range(0.8, 1.3);
      (lists[i] as { x: number; y: number; z: number; yaw: number; s: number }[]).push({ x: p.x, y: inp.heightAt(p.x, p.z) - 0.15 * s, z: p.z, yaw: rng.range(0, Math.PI * 2), s });
      plants++;
    }
    models.forEach((meshes, i) => place(meshes, lists[i] as { x: number; y: number; z: number; yaw: number; s: number }[], `backdrop:${(kinds[i] as PropBlueprint).kind}`));
  }

  let disposed = false;
  return {
    group, plants, structures, triangles,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const im of instanced) im.dispose();
      for (const g of geos) g.dispose();
      group.clear();
    },
  };
}
