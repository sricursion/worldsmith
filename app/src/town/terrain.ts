// The ground, the distance and the road surfaces of a town. Pure geometry: nothing here touches the DOM.
//
// The walkable town stays exactly flat at y = 0 (the navmesh is built over a flat plane); FLAT_MARGIN metres
// past the town bounds the ground starts to roll (dunes, hills, crater rims or drifts, by ground kind) and
// keeps climbing to a ring of silhouette forms that the fog fades into. Everything out there is visual only.
// Ground and road meshes carry world-space UVs (u = x, v = z, in metres) and a `color` attribute that is a
// multiplier around 1: wear, grime, verges and blotches, on top of whatever the surface material draws.
import * as THREE from 'three';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { ReliefKind, SiteSpec, SurfaceKind, SurfaceSet, TerrainSpec, ThemeId } from '../world/spec';
import { TRACK_WIDTH, buildingAabb, distanceToPolyline, distanceToRoad, roadRect, waterInside } from './layout';
import type { PlacedBuilding, Rect, RoadSegment, TownLayout, WaterBody } from './layout';

export type Quality = 0 | 1 | 2;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---- Noise -------------------------------------------------------------------------------------------------

/** Integer lattice hash, uniform in [0, 1). */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1] with quintic interpolation (continuous first and second derivatives). */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return mix(mix(a, b, ux), mix(c, d, ux), uz);
}

/** Fractal value noise in [0, 1]. Each octave is rotated so the lattice never lines up with itself. */
export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x;
  let pz = z;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(px, pz, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    const rx = px * 1.6 - pz * 1.2;
    pz = px * 1.2 + pz * 1.6;
    px = rx;
  }
  return sum / norm;
}

// ---- Height field ------------------------------------------------------------------------------------------

export type Landform = 'dunes' | 'hills' | 'craters' | 'drifts' | 'flats';

/** Metres of flat ground kept around the town bounds before the terrain starts to rise. */
export const FLAT_MARGIN = 40;

export interface TerrainField { bounds: Rect; seed: number; form: Landform }

export function landformFor(ground: SurfaceKind): Landform {
  switch (ground) {
    case 'sand': return 'dunes';
    case 'snow': case 'ice': return 'drifts';
    case 'regolith': case 'ash': return 'craters';
    case 'asphalt': case 'concrete': case 'cobble': case 'gravel': return 'flats';
    default: return 'hills';
  }
}

export function makeTerrainField(bounds: Rect, ground: SurfaceKind, seed: number): TerrainField {
  return { bounds: { ...bounds }, seed: seed | 0, form: landformFor(ground) };
}

/** Distance from a point to the bounds rectangle, 0 inside it. */
export function outsideDistance(b: Rect, x: number, z: number): number {
  return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
}

function craterRelief(x: number, z: number, seed: number): number {
  const cell = 85;
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  let h = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = (gx + i + 0.2 + 0.6 * hash2(gx + i, gz + j, seed + 11)) * cell;
      const cz = (gz + j + 0.2 + 0.6 * hash2(gx + i, gz + j, seed + 23)) * cell;
      const r = 14 + 22 * hash2(gx + i, gz + j, seed + 37);
      const d = Math.hypot(x - cx, z - cz);
      const rim = Math.exp(-(((d - r) / (r * 0.4)) ** 2));
      const bowl = d < r ? 1 - (d / r) ** 2 : 0;
      h += r * 0.26 * rim - r * 0.12 * bowl;
    }
  }
  return h;
}

function relief(f: TerrainField, x: number, z: number): number {
  const s = f.seed;
  switch (f.form) {
    case 'dunes': {
      // Crests run across the prevailing wind; a slow warp bends them, the power sharpens the slip face.
      const warp = 26 * (fbm(x / 140, z / 140, s + 5, 3) - 0.5);
      const along = (x * 0.82 + z * 0.57 + warp) / 58;
      const crest = 1 - Math.abs(2 * (along - Math.floor(along)) - 1);
      const tall = 0.45 + 0.9 * fbm(x / 170, z / 170, s + 9, 2);
      return 9 * tall * crest ** 1.6 + 2.5 * fbm(x / 34, z / 34, s + 3, 3);
    }
    case 'craters':
      return craterRelief(x, z, s) + 4 * fbm(x / 60, z / 60, s + 2, 4);
    case 'drifts': {
      const n = fbm(x / 75, z / 75, s + 4, 3);
      return 9 * n * n + 1.5 * fbm(x / 22, z / 22, s + 8, 2);
    }
    case 'flats':
      return 4 * fbm(x / 120, z / 120, s + 6, 3);
    default:
      return 16 * fbm(x / 110, z / 110, s + 1, 4) + 2.2 * fbm(x / 27, z / 27, s + 7, 3);
  }
}

/**
 * Ground height in metres. Exactly 0 inside the bounds and for FLAT_MARGIN metres around them; past that the
 * relief fades in with a smoothstep (so height and slope are both continuous at the seam) and the whole
 * landscape tilts upward with distance, which puts the far ground above eye level.
 */
export function terrainHeight(f: TerrainField, x: number, z: number): number {
  const e = outsideDistance(f.bounds, x, z) - FLAT_MARGIN;
  if (e <= 0) return 0;
  const ramp = smoothstep(0, 75, e);
  const tilt = f.form === 'flats' ? 5 : 11;
  return ramp * (relief(f, x, z) + tilt * (e / 160) ** 1.4);
}

// ---- The land ----------------------------------------------------------------------------------------------
// A world that carries WorldSpec.terrain has relief inside the playable area, not only around it. The height
// at a point is built in layers:
//   1. relief by kind (rolling, dunes, craggy, ...), `ruggedness` setting its amplitude: up to 6 m inside the
//      bounds, several times that outside them;
//   2. calm: the small-scale part of the relief is damped near buildings, roads and clearings, so a settlement
//      sits on gently undulating ground while the land between and around it keeps its full shape;
//   3. benches (a cliffside site steps up level terraces) and water (the land is carved to hold each body);
//   4. routes: every road and trail gets a profile along its length whose grade is limited, and the ground
//      beside it is blended to that profile, so there is always a walkable way between points of interest;
//   5. pads: the ground under every footprint, and out past its door, is exactly level.
// Buildings therefore stand at y = heightAt(centre): the builder lifts each one onto its pad.
// Inside the bounds (plus LAND_MARGIN) the layers are baked once into a grid and heightAt interpolates it with
// the same triangles the walk mesh and the visible ground use, so what is placed on heightAt sits on the mesh.
// Heights are shifted so the spawn point is at y = 0.

/** Metres of baked height grid kept around the bounds. */
export const LAND_MARGIN = 32;
/** How deep a ford lies under the water surface, and the deepest water the walk mesh still covers. */
export const FORD_DEPTH = 0.1;
export const WADE_DEPTH = 0.28;
/** The steepest grade a road or trail keeps along its length (rise over run). */
export const ROUTE_GRADE = 0.24;
const PAD_FULL = 1.7;
const PAD_BLEND = 4.5;
const ROUTE_BLEND = 4.5;

export interface LandWater { body: WaterBody; kind: WaterBody['kind']; level: number }

export interface LandGrid { x0: number; z0: number; cell: number; nx: number; nz: number; h: Float32Array }

export interface Land {
  /** True when the spec carried terrain: the playable area has relief and may hold water. */
  readonly shaped: boolean;
  readonly bounds: Rect;
  heightAt(x: number, z: number): number;
  /** Depth of water standing over the land at a point, metres; 0 on dry land. */
  waterDepthAt(x: number, z: number): number;
  /** Surface height of the water a point lies in or beside (within `reach` metres of its edge), or null. */
  waterLevelNear(x: number, z: number, reach: number): number | null;
  readonly water: readonly LandWater[];
  readonly grid: LandGrid | null;
}

interface RouteLayer { xs: Float64Array; zs: Float64Array; hs: Float64Array; half: number; box: Rect }
interface Pad { rect: Rect | null; x: number; z: number; r: number; h: number; box: Rect }

const growRect = (r: Rect, m: number): Rect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
const inRect = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const rectDist = (r: Rect, x: number, z: number): number => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
const frac = (v: number): number => v - Math.floor(v);

/** How the shape of each water kind is cut into the land: bank width, bed slope and greatest depth, metres. */
function carveFor(kind: WaterBody['kind'], shape: WaterBody['area']['shape']): { bank: number; slope: number; deep: number } {
  if (shape === 'outside') return { bank: 14, slope: 1.3, deep: 60 };
  if (shape === 'half') return { bank: 16, slope: 0.16, deep: kind === 'lava' || kind === 'acid' ? 2 : 7 };
  switch (kind) {
    case 'pond': return { bank: 6, slope: 0.3, deep: 1.1 };
    case 'lake': return { bank: 9, slope: 0.25, deep: 3 };
    case 'river': return { bank: 8, slope: 0.35, deep: 1.5 };
    case 'ice_sheet': return { bank: 8, slope: 0.3, deep: 0.5 };
    default: return { bank: 7, slope: 0.35, deep: 1.4 };
  }
}

// Scratch for the two parts of the relief: the broad shape, and the detail that calm ground damps.
let reliefLow = 0;
let reliefDetail = 0;

interface ReliefFrame { kind: ReliefKind; seed: number; cx: number; cz: number; reach: number; alongX: boolean; cross: number }

function shapeRelief(f: ReliefFrame, x: number, z: number, a: number, big: number): void {
  const s = f.seed;
  switch (f.kind) {
    case 'rolling':
      reliefLow = 0.9 * a * (fbm(x / 120, z / 120, s + 1, 3) - 0.5);
      reliefDetail = 0.9 * a * (fbm(x / 42, z / 42, s + 2, 4) - 0.5);
      return;
    case 'dunes': {
      // Crests run across the wind: a long windward rise, then a short slip face.
      const warp = 20 * (fbm(x / 130, z / 130, s + 5, 3) - 0.5);
      const t = frac((x * 0.82 + z * 0.57 + warp) / 46);
      const prof = t < 0.7 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.7) : 0.5 + 0.5 * Math.cos((Math.PI * (t - 0.7)) / 0.3);
      const tall = 0.4 + 0.8 * fbm(x / 150, z / 150, s + 9, 2);
      reliefLow = 0.3 * a * (fbm(x / 170, z / 170, s + 1, 2) - 0.5);
      reliefDetail = 0.85 * a * tall * prof + 0.05 * a * fbm(x / 7, z / 7, s + 3, 2);
      return;
    }
    case 'craggy': {
      // Outcrops: stepped rock masses on a rough base.
      const cell = 24;
      const gx = Math.floor(x / cell);
      const gz = Math.floor(z / cell);
      let top = 0;
      const rag = 1 + 0.3 * (valueNoise(x / 5, z / 5, s + 13) - 0.5);
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const k = hash2(gx + i, gz + j, s + 17);
          if (k < 0.45) continue;
          const ox = (gx + i + 0.2 + 0.6 * hash2(gx + i, gz + j, s + 19)) * cell;
          const oz = (gz + j + 0.2 + 0.6 * hash2(gx + i, gz + j, s + 23)) * cell;
          const r = 5 + 8 * hash2(gx + i, gz + j, s + 29);
          const q = (1 - smoothstep(0.5 * r, r, Math.hypot(x - ox, z - oz) * rag)) * 3;
          const stepped = (Math.floor(q) + smoothstep(0.3, 0.7, q - Math.floor(q))) / 3;
          top = Math.max(top, (0.35 + 0.65 * k) * stepped);
        }
      }
      reliefLow = 0.5 * a * (fbm(x / 110, z / 110, s + 1, 3) - 0.5);
      reliefDetail = a * top + 0.12 * a * (fbm(x / 9, z / 9, s + 3, 3) - 0.5);
      return;
    }
    case 'terraced': {
      // Level benches with short risers, climbing and falling across the land.
      const t = (x * 0.6 + z * 0.8 + 16 * (fbm(x / 90, z / 90, s + 3, 2) - 0.5)) / 24;
      const k = Math.floor(t);
      const level = k + smoothstep(0.76, 1, t - k);
      const wave = 3 - Math.abs((((level % 6) + 6) % 6) - 3);
      reliefLow = 0;
      reliefDetail = (a / 3) * wave + 0.04 * a * (fbm(x / 8, z / 8, s + 5, 2) - 0.5);
      return;
    }
    case 'crater': {
      // The place lies on the floor of one great crater; small ones pock the floor.
      const d = Math.hypot(x - f.cx, z - f.cz);
      const r0 = f.reach + 14;
      const rim = big * 1.3 * (smoothstep(r0, r0 + 55, d) - 0.55 * smoothstep(r0 + 60, r0 + 190, d));
      reliefLow = 0.5 * a * Math.min(1, d / r0) ** 3 + rim;
      const cell = 30;
      const gx = Math.floor(x / cell);
      const gz = Math.floor(z / cell);
      let pock = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const ox = (gx + i + 0.2 + 0.6 * hash2(gx + i, gz + j, s + 11)) * cell;
          const oz = (gz + j + 0.2 + 0.6 * hash2(gx + i, gz + j, s + 23)) * cell;
          const r = 3 + 6 * hash2(gx + i, gz + j, s + 37);
          const dd = Math.hypot(x - ox, z - oz);
          pock += 0.3 * Math.exp(-(((dd - r) / (r * 0.4)) ** 2)) - (dd < r ? 0.35 * (1 - (dd / r) ** 2) : 0);
        }
      }
      reliefDetail = 0.5 * a * pock + 0.3 * a * (fbm(x / 34, z / 34, s + 2, 3) - 0.5);
      return;
    }
    case 'canyon': {
      // A floor between two walls, running the long way through the place.
      const u = f.alongX ? x - f.cx : z - f.cz;
      const v = (f.alongX ? z - f.cz : x - f.cx) + 12 * (fbm(u / 80, 3.7, s + 5, 2) - 0.5);
      const wall = smoothstep(f.cross + 8, f.cross + 34, Math.abs(v));
      const raw = big * 1.7 * wall * (0.75 + 0.5 * fbm(x / 45, z / 45, s + 7, 3));
      reliefLow = 0.5 * raw + 0.5 * Math.round(raw / 7) * 7;
      reliefDetail = 0.6 * a * (fbm(x / 30, z / 30, s + 2, 3) - 0.5) * (1 - wall);
      return;
    }
    case 'icefield': {
      // Flat pans of ice, broken by pressure ridges where the plates meet.
      const n = fbm(x / 38, z / 38, s + 2, 2);
      const ridge = smoothstep(0.88, 0.985, 1 - Math.abs(2 * n - 1)) * smoothstep(0.38, 0.58, fbm(x / 55 + 9, z / 55, s + 4, 2));
      reliefLow = 0.25 * a * (fbm(x / 160, z / 160, s + 1, 2) - 0.5);
      reliefDetail = 0.7 * a * ridge * (0.5 + 0.5 * valueNoise(x / 6, z / 6, s + 6));
      return;
    }
    case 'swamp':
      reliefLow = 0.12 * a * (fbm(x / 120, z / 120, s + 1, 2) - 0.5);
      reliefDetail = (0.5 + 0.14 * a) * 2 * (fbm(x / 15, z / 15, s + 2, 3) - 0.5);
      return;
    case 'islands':
      reliefLow = 0;
      reliefDetail = (1.2 + 0.5 * a) * 2.2 * (fbm(x / 58, z / 58, s + 2, 4) - 0.5);
      return;
    default:
      reliefLow = 0.35 * a * (fbm(x / 140, z / 140, s + 1, 3) - 0.5);
      reliefDetail = 0.12 * a * (fbm(x / 23, z / 23, s + 2, 3) - 0.5);
  }
}

/** A G-Lipschitz version of a height profile sampled at stations `st` (metres along): the mean of its upper and lower envelopes. */
function limitGrade(h: Float64Array, st: Float64Array, g: number): Float64Array {
  const n = h.length;
  const up = Float64Array.from(h);
  const lo = Float64Array.from(h);
  for (let i = 1; i < n; i++) {
    const d = g * ((st[i] as number) - (st[i - 1] as number));
    up[i] = Math.min(up[i] as number, (up[i - 1] as number) + d);
    lo[i] = Math.max(lo[i] as number, (lo[i - 1] as number) - d);
  }
  for (let i = n - 2; i >= 0; i--) {
    const d = g * ((st[i + 1] as number) - (st[i] as number));
    up[i] = Math.min(up[i] as number, (up[i + 1] as number) + d);
    lo[i] = Math.max(lo[i] as number, (lo[i + 1] as number) - d);
  }
  for (let i = 0; i < n; i++) up[i] = ((up[i] as number) + (lo[i] as number)) / 2;
  return up;
}

/** Flat land: the legacy field (level over the town, rising beyond it), no water, no grid. */
function flatLand(layout: TownLayout, ground: SurfaceKind, seed: number): Land {
  const field = makeTerrainField(layout.bounds, ground, seed);
  return {
    shaped: false, bounds: field.bounds, water: [], grid: null,
    heightAt: (x, z) => terrainHeight(field, x, z),
    waterDepthAt: () => 0,
    waterLevelNear: () => null,
  };
}

export function makeLand(layout: TownLayout, terrain: TerrainSpec | undefined, ground: SurfaceKind, seed: number): Land {
  if (!terrain) return flatLand(layout, ground, seed);
  const b = layout.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const reach = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const unit = (v: number, d: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : d);
  const rug = unit(terrain.ruggedness, 0.3);
  const settled = unit(terrain.settled, 0.7);
  const aIn = 0.5 + 5.5 * rug;
  const aOut = 10 + 30 * rug;
  const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
  const frame: ReliefFrame = {
    kind: terrain.relief, seed: seed | 0, cx, cz, reach, alongX, cross: (alongX ? b.maxZ - b.minZ : b.maxX - b.minX) / 2,
  };
  const sheetBody = (layout.water ?? []).find((w) => w.area.shape === 'sheet');
  const sheetLevel = terrain.relief === 'swamp' ? -0.2 * (0.5 + 0.14 * aIn) : -0.15;
  const sunk = !!sheetBody || (layout.water ?? []).some((w) => w.area.shape === 'outside' || w.area.shape === 'half');

  // Calm ground: near anything built.
  const rects = layout.buildings.map((bd) => buildingAabb(bd));
  const roadRects = layout.roads.map((r) => roadRect(r));
  const discs = [...(layout.plaza.r > 0 ? [layout.plaza] : []), ...(layout.clearings ?? [])];
  const calm1 = 15 + 14 * settled;
  const calmBox = growRect(b, calm1);
  const calmAt = (x: number, z: number): number => {
    if (!inRect(calmBox, x, z)) return 0;
    let d = 1e9;
    for (const r of rects) d = Math.min(d, rectDist(r, x, z));
    for (const r of roadRects) d = Math.min(d, rectDist(r, x, z));
    for (const q of discs) d = Math.min(d, Math.max(0, Math.hypot(x - q.x, z - q.z) - q.r));
    return 1 - smoothstep(3, calm1, d);
  };

  // Benches of a cliffside site: level between s0 and s1, a riser from each to the next, a last rise behind the top one.
  const benches = layout.benches;
  const rise = 1.8 + 3.2 * rug;
  const benchAt = (x: number, z: number): number => {
    if (!benches || benches.steps.length === 0) return 0;
    const st = benches.steps;
    const s = x * benches.nx + z * benches.nz;
    const first = st[0] as { s0: number; s1: number; level: number };
    if (s <= first.s1) return first.level * rise - 0.6 * rise * smoothstep(first.s0, first.s0 - 14, s);
    for (let k = 0; k + 1 < st.length; k++) {
      const a = st[k] as { s0: number; s1: number; level: number };
      const c = st[k + 1] as { s0: number; s1: number; level: number };
      if (s <= c.s0) return rise * mix(a.level, c.level, smoothstep(a.s1, c.s0, s));
      if (s <= c.s1) return rise * c.level;
    }
    const last = st[st.length - 1] as { s0: number; s1: number; level: number };
    return rise * (last.level + 1.6 * smoothstep(last.s1, last.s1 + 7, s));
  };

  // Layer 1 to 3 without water: relief, calm, benches.
  const dry = (x: number, z: number): number => {
    const e = outsideDistance(b, x, z);
    const grow = smoothstep(8, 170, e);
    const a = aIn + (aOut - aIn) * grow;
    shapeRelief(frame, x, z, a, aOut);
    const c = calmAt(x, z);
    let h = reliefLow + reliefDetail * (1 - 0.85 * c) * (benches ? 0.4 : 1);
    // Land that is not ringed by water climbs with distance, so the far ground stands above eye level.
    if (!sunk) h += 9 * (Math.max(0, e - 30) / 160) ** 1.4;
    if (sheetBody && c > 0) h = mix(h, Math.max(h, sheetLevel + 0.5), c);
    // Benches belong to the place: beyond it they sink back into the land instead of running on as ruled lines.
    return h + benchAt(x, z) * (1 - 0.85 * smoothstep(14, 80, e));
  };

  // Water levels, then the carve.
  const held: LandWater[] = [];
  const carves: { w: LandWater; bank: number; slope: number; deep: number; box: Rect | null }[] = [];
  for (const body of layout.water ?? []) {
    const a = body.area;
    let level = sheetLevel;
    if (a.shape === 'disc') {
      level = dry(a.x, a.z) - 0.5;
      for (let k = 0; k < 8; k++) level = Math.min(level, dry(a.x + Math.cos(k * 0.785) * a.r, a.z + Math.sin(k * 0.785) * a.r) - 0.25);
    } else if (a.shape === 'band') {
      level = Infinity;
      for (const p of a.pts) if (outsideDistance(b, p.x, p.z) < 30) level = Math.min(level, dry(p.x, p.z) - 0.6);
      if (!Number.isFinite(level)) level = dry(body.x, body.z) - 0.6;
    } else if (a.shape === 'half') {
      level = Infinity;
      for (let t = -2 * reach; t <= 2 * reach; t += 8) {
        const px = a.nx * a.offset + a.nz * t;
        const pz = a.nz * a.offset - a.nx * t;
        if (outsideDistance(b, px, pz) < 25) level = Math.min(level, dry(px - a.nx * 6, pz - a.nz * 6) - 0.5);
      }
      if (!Number.isFinite(level)) level = dry(cx, cz) - 1;
    } else if (a.shape === 'outside') {
      level = Math.min(dry(cx, cz), dry(b.minX, b.minZ), dry(b.maxX, b.maxZ), dry(b.minX, b.maxZ), dry(b.maxX, b.minZ)) - (5 + 9 * rug);
    }
    const w: LandWater = { body, kind: body.kind, level };
    held.push(w);
    if (a.shape !== 'sheet') {
      const cv = carveFor(body.kind, a.shape);
      carves.push({ w, ...cv, box: a.shape === 'disc' ? growRect({ minX: a.x - a.r * 1.3, maxX: a.x + a.r * 1.3, minZ: a.z - a.r * 1.3, maxZ: a.z + a.r * 1.3 }, cv.bank) : null });
    }
  }
  const base = (x: number, z: number): number => {
    let h = dry(x, z);
    for (const cv of carves) {
      if (cv.box && !inRect(cv.box, x, z)) continue;
      const d = waterInside(cv.w.body, x, z);
      if (d <= -cv.bank) continue;
      const edge = cv.w.level + 0.12;
      h = d <= 0 ? mix(h, edge, smoothstep(-cv.bank, 0, d)) : edge - Math.min(cv.deep, d * cv.slope);
    }
    return h;
  };
  /** Level of the water whose region covers a point, or -Infinity on ground no water can stand on. */
  const levelOver = (x: number, z: number): number => {
    let level = -Infinity;
    for (const w of held) {
      if (w.body.area.shape === 'sheet' || waterInside(w.body, x, z) > 0) level = Math.max(level, w.level);
    }
    return level;
  };

  // Pads.
  const pads: Pad[] = [];
  const padDist = (p: Pad, x: number, z: number): number => (p.rect ? rectDist(p.rect, x, z) : Math.max(0, Math.hypot(x - p.x, z - p.z) - p.r));
  const addPad = (rect: Rect | null, x: number, z: number, r: number): void => {
    let h = Math.max(base(x, z), levelOver(x, z) + 0.45);
    const p: Pad = { rect, x, z, r, h, box: growRect(rect ?? { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r }, PAD_FULL + PAD_BLEND) };
    // Neighbouring pads never differ by more than a walkable step over the ground between them.
    for (const q of pads) {
      const gap = q.rect && rect
        ? Math.hypot(Math.max(0, rect.minX - q.rect.maxX, q.rect.minX - rect.maxX), Math.max(0, rect.minZ - q.rect.maxZ, q.rect.minZ - rect.maxZ))
        : Math.max(0, padDist(q, x, z) - (rect ? Math.hypot(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2 : r));
      const lim = 0.05 + 0.4 * gap;
      h = clamp(h, q.h - lim, q.h + lim);
    }
    p.h = h;
    pads.push(p);
  };
  for (const q of discs) addPad(null, q.x, q.z, q.r);
  if (discs.length === 0) addPad(null, layout.spawn.x, layout.spawn.z, 1.5);
  layout.buildings.forEach((bd, i) => addPad(rects[i] as Rect, bd.x, bd.z, 0));

  // Routes, in order: each is graded over the land as it stands with the ones before it.
  const routes: RouteLayer[] = [];
  let padW = 0;
  let padH = 0;
  const padsAt = (x: number, z: number): void => {
    let wMax = 0;
    let sum = 0;
    let norm = 0;
    for (const p of pads) {
      if (!inRect(p.box, x, z)) continue;
      const near = padDist(p, x, z);
      const d = Math.max(0, near - PAD_FULL);
      if (d >= PAD_BLEND) continue;
      const w = 1 - smoothstep(0, PAD_BLEND, d);
      // Weighted steeply by the true distance, so the ground inside a footprint is that pad's height and
      // nothing else's, and stays close to it right up to the walls even where the next pad is an alley away.
      const u = w / (near * near * near * near + 1e-9);
      sum += u * p.h;
      norm += u;
      if (w > wMax) wMax = w;
    }
    padW = wMax;
    padH = norm > 0 ? sum / norm : 0;
  };
  let routeW = 0;
  let routeH = 0;
  const routesAt = (x: number, z: number): void => {
    let wMax = 0;
    let sum = 0;
    let norm = 0;
    for (const r of routes) {
      if (!inRect(r.box, x, z)) continue;
      let best = Infinity;
      let bh = 0;
      for (let i = 0; i + 1 < r.xs.length; i++) {
        const ax = r.xs[i] as number;
        const az = r.zs[i] as number;
        const dx = (r.xs[i + 1] as number) - ax;
        const dz = (r.zs[i + 1] as number) - az;
        const len2 = dx * dx + dz * dz;
        const t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
        const d2 = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
        if (d2 < best) { best = d2; bh = mix(r.hs[i] as number, r.hs[i + 1] as number, t); }
      }
      const d = Math.max(0, Math.sqrt(best) - r.half - 0.4);
      if (d >= ROUTE_BLEND) continue;
      const w = 1 - smoothstep(0, ROUTE_BLEND, d);
      const u = w / (d * d + 1e-9);
      sum += u * bh;
      norm += u;
      if (w > wMax) wMax = w;
    }
    routeW = wMax;
    routeH = norm > 0 ? sum / norm : 0;
  };
  let y0 = 0;
  const analytic = (x: number, z: number): number => {
    let h = base(x, z);
    padsAt(x, z);
    if (padW > 0) h = mix(h, padH, padW);
    // A route was graded over land that already had its pads, so it goes on top of them; only the ground
    // right under a footprint keeps the pad's height whatever passes by.
    routesAt(x, z);
    if (routeW > 0) h = mix(h, routeH, routeW * (1 - smoothstep(0.9, 1, padW)));
    return h - y0;
  };
  const addRoute = (line: readonly { x: number; z: number }[], width: number, raised: boolean): void => {
    // Resample to stations at most 1.5 m apart.
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i] as { x: number; z: number };
      const q = line[i + 1] as { x: number; z: number };
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 1.5));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) { xs.push(p.x + ((q.x - p.x) * k) / n); zs.push(p.z + ((q.z - p.z) * k) / n); }
    }
    const n = xs.length;
    if (n < 2) return;
    const st = new Float64Array(n);
    const h = new Float64Array(n);
    const pinned = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = xs[i] as number;
      const z = zs[i] as number;
      if (i > 0) st[i] = (st[i - 1] as number) + Math.hypot(x - (xs[i - 1] as number), z - (zs[i - 1] as number));
      h[i] = analytic(x, z);
      // Where a pad or an earlier route already decides the ground, this route takes that height as given.
      if (padW > 0.9 || routeW > 0.999) pinned[i] = 1;
      // Through water a trail fords just under the surface and a road runs on a low causeway just above it.
      const level = levelOver(x, z);
      const floor = level + (raised ? 0.3 : -FORD_DEPTH);
      if (Number.isFinite(level) && (h[i] as number) < floor && !pinned[i]) { h[i] = floor; pinned[i] = 1; }
    }
    const out = limitGrade(h, st, ROUTE_GRADE);
    // Put the pinned stations back where they were and carry the correction linearly between them.
    const pins: number[] = [];
    for (let i = 0; i < n; i++) if (pinned[i]) pins.push(i);
    if (pins.length > 0) {
      const delta = pins.map((i) => (h[i] as number) - (out[i] as number));
      let k = 0;
      for (let i = 0; i < n; i++) {
        while (k + 1 < pins.length && (pins[k + 1] as number) <= i) k++;
        const k2 = Math.min(k + 1, pins.length - 1);
        const pa = pins[k] as number;
        const pc = pins[k2] as number;
        const t = i <= pa || pc === pa ? 0 : clamp(((st[i] as number) - (st[pa] as number)) / ((st[pc] as number) - (st[pa] as number)), 0, 1);
        out[i] = (out[i] as number) + mix(delta[k] as number, delta[k2] as number, t);
      }
    }
    let box: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < n; i++) {
      box = { minX: Math.min(box.minX, xs[i] as number), maxX: Math.max(box.maxX, xs[i] as number), minZ: Math.min(box.minZ, zs[i] as number), maxZ: Math.max(box.maxZ, zs[i] as number) };
    }
    routes.push({ xs: Float64Array.from(xs), zs: Float64Array.from(zs), hs: out, half: width / 2, box: growRect(box, width / 2 + 0.4 + ROUTE_BLEND) });
  };
  for (const r of layout.roads) addRoute([{ x: r.ax, z: r.az }, { x: r.bx, z: r.bz }], r.width, true);
  for (const t of layout.trails ?? []) addRoute(t.pts, t.width, false);
  y0 = analytic(layout.spawn.x, layout.spawn.z);
  const water: LandWater[] = held.map((w) => ({ ...w, level: w.level - y0 }));

  // Bake the grid.
  const area = (b.maxX - b.minX + 2 * LAND_MARGIN) * (b.maxZ - b.minZ + 2 * LAND_MARGIN);
  const cell = Math.max(1, Math.ceil(Math.sqrt(area / 90000) * 2) / 2);
  const x0 = Math.floor((b.minX - LAND_MARGIN) / cell) * cell;
  const z0 = Math.floor((b.minZ - LAND_MARGIN) / cell) * cell;
  const nx = Math.ceil((b.maxX + LAND_MARGIN - x0) / cell) + 1;
  const nz = Math.ceil((b.maxZ + LAND_MARGIN - z0) / cell) + 1;
  const gh = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) gh[j * nx + i] = analytic(x0 + i * cell, z0 + j * cell);
  const grid: LandGrid = { x0, z0, cell, nx, nz, h: gh };

  const heightAt = (x: number, z: number): number => {
    const u = (x - x0) / cell;
    const v = (z - z0) / cell;
    if (!(u >= 0 && v >= 0 && u < nx - 1 && v < nz - 1)) return analytic(x, z);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const o = j * nx + i;
    const h00 = gh[o] as number;
    const h10 = gh[o + 1] as number;
    const h01 = gh[o + nx] as number;
    const h11 = gh[o + nx + 1] as number;
    // The cell is split along the diagonal from (i+1, j) to (i, j+1), as the meshes are.
    return fu + fv <= 1 ? h00 + (h10 - h00) * fu + (h01 - h00) * fv : h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
  };
  return {
    shaped: true, bounds: { ...b }, water, grid, heightAt,
    waterDepthAt(x: number, z: number): number {
      const level = levelOver(x, z);
      return Number.isFinite(level) ? Math.max(0, level - y0 - heightAt(x, z)) : 0;
    },
    waterLevelNear(x: number, z: number, near: number): number | null {
      let level: number | null = null;
      for (const w of water) {
        if (w.body.area.shape === 'sheet' || waterInside(w.body, x, z) > -near) level = level === null ? w.level : Math.max(level, w.level);
      }
      return level;
    },
  };
}

/**
 * The walkable land as a plain triangle mesh in world space: the baked grid inside the bounds plus `margin`
 * metres, without the cells that lie under water deeper than a person wades (fords stay). For flat land it
 * is one level square, as the collider always was.
 */
export function buildWalkGeometry(land: Land, margin = 18, flatSize = 400): THREE.BufferGeometry {
  const grid = land.grid;
  if (!grid) return new THREE.PlaneGeometry(flatSize, flatSize).rotateX(-Math.PI / 2);
  const { x0, z0, cell, nx, nz, h } = grid;
  const b = growRect(land.bounds, margin);
  const i0 = Math.max(0, Math.floor((b.minX - x0) / cell));
  const i1 = Math.min(nx - 1, Math.ceil((b.maxX - x0) / cell));
  const j0 = Math.max(0, Math.floor((b.minZ - z0) / cell));
  const j1 = Math.min(nz - 1, Math.ceil((b.maxZ - z0) / cell));
  const wet = new Uint8Array(nx * nz);
  if (land.water.length > 0) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) wet[j * nx + i] = land.waterDepthAt(x0 + i * cell, z0 + j * cell) > WADE_DEPTH ? 1 : 0;
  }
  const remap = new Int32Array(nx * nz).fill(-1);
  const pos: number[] = [];
  const idx: number[] = [];
  const vert = (i: number, j: number): number => {
    const o = j * nx + i;
    let v = remap[o] as number;
    if (v < 0) {
      v = pos.length / 3;
      pos.push(x0 + i * cell, h[o] as number, z0 + j * cell);
      remap[o] = v;
    }
    return v;
  };
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const o = j * nx + i;
      const a = wet[o] as number;
      const c = wet[o + 1] as number;
      const d = wet[o + nx] as number;
      const e = wet[o + nx + 1] as number;
      if (!a && !c && !d) idx.push(vert(i, j), vert(i, j + 1), vert(i + 1, j));
      if (!c && !d && !e) idx.push(vert(i + 1, j), vert(i, j + 1), vert(i + 1, j + 1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---- Triangle soup -----------------------------------------------------------------------------------------

/** Collects coloured triangles (RGBA, world-space UVs) and turns them into one geometry. */
class Soup {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];

  get empty(): boolean { return this.pos.length === 0; }

  vert(x: number, y: number, z: number, k: number, a = 1, tint: readonly [number, number, number] = WHITE): void {
    this.pos.push(x, y, z);
    this.col.push(tint[0] * k, tint[1] * k, tint[2] * k, a);
  }

  /** Axis-aligned-in-its-own-frame box: centre, half sizes along `ux,uz` (width), y, and the perpendicular. */
  box(cx: number, y0: number, cz: number, hw: number, h: number, hd: number, ux: number, uz: number, k: number, tint: readonly [number, number, number]): void {
    const px = -uz;
    const pz = ux;
    const c: [number, number][] = [
      [cx - ux * hw - px * hd, cz - uz * hw - pz * hd], [cx + ux * hw - px * hd, cz + uz * hw - pz * hd],
      [cx + ux * hw + px * hd, cz + uz * hw + pz * hd], [cx - ux * hw + px * hd, cz - uz * hw + pz * hd],
    ];
    const y1 = y0 + h;
    const q = (a: number, b: number, top: boolean): void => {
      const A = c[a] as [number, number];
      const B = c[b] as [number, number];
      const kk = top ? k : k * 0.82;
      this.vert(A[0], y0, A[1], kk, 1, tint); this.vert(A[0], y1, A[1], kk, 1, tint); this.vert(B[0], y1, B[1], kk, 1, tint);
      this.vert(A[0], y0, A[1], kk, 1, tint); this.vert(B[0], y1, B[1], kk, 1, tint); this.vert(B[0], y0, B[1], kk, 1, tint);
    };
    q(0, 1, false); q(1, 2, false); q(2, 3, false); q(3, 0, false);
    const [c0, c1, c2, c3] = c as [[number, number], [number, number], [number, number], [number, number]];
    this.vert(c0[0], y1, c0[1], k, 1, tint); this.vert(c2[0], y1, c2[1], k, 1, tint); this.vert(c1[0], y1, c1[1], k, 1, tint);
    this.vert(c0[0], y1, c0[1], k, 1, tint); this.vert(c3[0], y1, c3[1], k, 1, tint); this.vert(c2[0], y1, c2[1], k, 1, tint);
  }

  /**
   * Flat blob facing up. `radius(i)` gives the rim distance per segment. Inside `core` (a fraction of the
   * radius) the alpha is `a0`; from there it falls to `a1` at the rim, so edges are soft and middles solid.
   */
  blob(cx: number, y: number, cz: number, segs: number, ux: number, uz: number, stretch: number, radius: (i: number) => number, k: number, a0: number, a1: number, tint: readonly [number, number, number], core = 0): void {
    const at = (i: number, f: number): [number, number] => {
      const ang = (i / segs) * Math.PI * 2;
      const r = radius(i % segs) * f;
      const lx = Math.cos(ang) * r * stretch;
      const lz = Math.sin(ang) * r;
      return [cx + ux * lx - uz * lz, cz + uz * lx + ux * lz];
    };
    for (let i = 0; i < segs; i++) {
      const p = at(i, 1);
      const q = at(i + 1, 1);
      if (core <= 0) {
        this.vert(cx, y, cz, k, a0, tint); this.vert(q[0], y, q[1], k, a1, tint); this.vert(p[0], y, p[1], k, a1, tint);
        continue;
      }
      const pi = at(i, core);
      const qi = at(i + 1, core);
      this.vert(cx, y, cz, k, a0, tint); this.vert(qi[0], y, qi[1], k, a0, tint); this.vert(pi[0], y, pi[1], k, a0, tint);
      this.vert(pi[0], y, pi[1], k, a0, tint); this.vert(qi[0], y, qi[1], k, a0, tint); this.vert(q[0], y, q[1], k, a1, tint);
      this.vert(pi[0], y, pi[1], k, a0, tint); this.vert(q[0], y, q[1], k, a1, tint); this.vert(p[0], y, p[1], k, a1, tint);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    const n = this.pos.length / 3;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = this.pos[i * 3] as number;
      uv[i * 2 + 1] = this.pos[i * 3 + 2] as number;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE: readonly [number, number, number] = [1, 1, 1];
const rgb = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// ---- Ground mesh -------------------------------------------------------------------------------------------

/** Grid lines for one axis: fine over the town, then stretching geometrically out to `lo`/`hi`. */
function axisLines(min: number, max: number, lo: number, hi: number, fine: number, coarse: number): number[] {
  const step = Math.max(fine, (max - min) / 230);
  const n = Math.max(1, Math.ceil((max - min) / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(min + ((max - min) * i) / n);
  let s = step;
  for (let v = max; v < hi;) { s = Math.min(coarse, s * 1.22); v = Math.min(hi, v + s); out.push(v); }
  s = step;
  for (let v = min; v > lo;) { s = Math.min(coarse, s * 1.22); v = Math.max(lo, v - s); out.unshift(v); }
  return out;
}

export interface GroundOptions {
  quality: Quality; doors: readonly { x: number; z: number }[]; half: number;
  /** Shaped land: the ground takes its heights, on the same grid lines and triangles as the walk mesh. */
  land?: Land;
}

/** The baked grid's lines along one axis (every `stride`-th), then stretching geometrically out to `lo`/`hi`. */
function gridLines(o: number, cell: number, n: number, stride: number, lo: number, hi: number, coarse: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += stride) out.push(o + i * cell);
  const last = o + (n - 1) * cell;
  if ((out[out.length - 1] as number) < last) out.push(last);
  let s = cell * stride;
  for (let v = last; v < hi;) { s = Math.min(coarse, s * 1.22); v = Math.min(hi, v + s); out.push(v); }
  s = cell * stride;
  for (let v = o; v > lo;) { s = Math.min(coarse, s * 1.22); v = Math.max(lo, v - s); out.unshift(v); }
  return out;
}

/** Half the side of the ground square: far enough to carry the horizon ring. */
export function groundHalfExtent(bounds: Rect): number {
  return horizonRadii(bounds).outer + 60;
}

/**
 * The visible ground: one indexed grid, 1 m cells over the town (coarser on low quality), stretching out to
 * `half` metres from the centre of the bounds. Vertex colours carry blotches at two scales, a warm/cool
 * drift, worn earth along roads and at doors, lighter verges, and a dark contact band at every wall base.
 */
export function buildGroundGeometry(layout: TownLayout, field: TerrainField, opts: GroundOptions): THREE.BufferGeometry {
  const b = layout.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const fine = opts.quality === 2 ? 1 : opts.quality === 1 ? 1.6 : 2.6;
  const coarse = opts.quality === 2 ? 10 : 14;
  const land = opts.land?.shaped ? opts.land : undefined;
  const lg = land?.grid;
  const stride = opts.quality === 0 ? 2 : 1;
  const xs = lg ? gridLines(lg.x0, lg.cell, lg.nx, stride, cx - opts.half, cx + opts.half, coarse) : axisLines(b.minX - 6, b.maxX + 6, cx - opts.half, cx + opts.half, fine, coarse);
  const zs = lg ? gridLines(lg.z0, lg.cell, lg.nz, stride, cz - opts.half, cz + opts.half, coarse) : axisLines(b.minZ - 6, b.maxZ + 6, cz - opts.half, cz + opts.half, fine, coarse);
  const trails = land ? layout.trails ?? [] : [];
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const col = new Float32Array(nx * nz * 3);
  const boxes = layout.buildings.map((bd) => buildingAabb(bd));
  const seed = field.seed;
  let v = 0;
  for (let j = 0; j < nz; j++) {
    const z = zs[j] as number;
    for (let i = 0; i < nx; i++, v++) {
      const x = xs[i] as number;
      const y = land ? land.heightAt(x, z) : terrainHeight(field, x, z);
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      uv[v * 2] = x; uv[v * 2 + 1] = z;
      let k = 0.83 + 0.2 * fbm(x / 31, z / 31, seed + 41, 3) + 0.14 * fbm(x / 6.5, z / 6.5, seed + 43, 2);
      const drift = fbm(x / 52, z / 52, seed + 47, 2) - 0.5;
      if (outsideDistance(b, x, z) < 12) {
        let roadD = 1e9;
        for (const r of layout.roads) roadD = Math.min(roadD, distanceToRoad(r, x, z));
        roadD = Math.min(roadD, Math.max(0, Math.hypot(x - layout.plaza.x, z - layout.plaza.z) - layout.plaza.r));
        let doorD = 1e9;
        for (const d of opts.doors) doorD = Math.min(doorD, Math.hypot(x - d.x, z - d.z));
        let wallD = 1e9;
        for (const r of boxes) wallD = Math.min(wallD, Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ)));
        // The worn band has a ragged edge: the noise moves where it ends by a metre or so.
        const ragged = 1.6 + 1.6 * fbm(x / 4, z / 4, seed + 53, 2);
        const worn = Math.max(1 - smoothstep(0.2, ragged, roadD), 1 - smoothstep(0.9, 3.4, doorD));
        const verge = smoothstep(ragged, ragged + 1.2, roadD) * (1 - smoothstep(4.2, 6.5, roadD));
        k *= mix(1, 0.76, worn) * (1 + 0.08 * verge) * mix(0.7, 1, smoothstep(0, 1.2, wallD));
        // Trails are worn into the land, and ground that water stands on is dark and wet.
        for (const t of trails) k *= mix(t.kind === 'path' ? 0.72 : 0.84, 1, smoothstep(t.width * 0.3, t.width * 0.5 + ragged * 0.5, distanceToPolyline(t.pts, x, z)));
        if (land && land.water.length > 0) k *= mix(1, 0.62, smoothstep(-0.05, 0.25, land.waterDepthAt(x, z)));
      } else if (!land && y > 0) {
        // Out in the landscape: crests catch a little more light than the hollows between them.
        k *= 0.9 + 0.2 * smoothstep(0, 1, fbm(x / 70, z / 70, seed + 59, 2));
      }
      col[v * 3] = k * (1 + 0.07 * drift);
      col[v * 3 + 1] = k;
      col[v * 3 + 2] = k * (1 - 0.09 * drift);
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx[t++] = a; idx[t++] = a + nx; idx[t++] = a + 1;
      idx[t++] = a + 1; idx[t++] = a + nx; idx[t++] = a + nx + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---- Horizon ring ------------------------------------------------------------------------------------------

export type HorizonKind = 'mesas' | 'mountains' | 'trees' | 'mushrooms' | 'towers' | 'spires';

export interface HorizonForm { kind: HorizonKind; x: number; z: number; y: number; radius: number; height: number; yaw: number; stretch: number; seed: number }

/** What stands on the horizon, from the words of the world first, then its ground, then its theme. */
export function horizonKindFor(words: string, ground: SurfaceKind, theme: ThemeId, first = ''): HorizonKind {
  // `first` is what the terrain says the far distance is made of: it decides when it names a kind at all.
  if (first.trim()) {
    const f = first.toLowerCase();
    if (/mushroom|fung|spore/.test(f)) return 'mushrooms';
    if (/canopy|forest|jungle|tree|wood|mangrove/.test(f)) return 'trees';
    if (/skyline|city|tower|megastructure|crane|stack|refiner|industr/.test(f)) return 'towers';
    if (/spire|crater rim|pinnacle|crystal|needle/.test(f)) return 'spires';
    if (/mountain|glacier|ice wall|peak|volcan|alp|ridge|cliff|range/.test(f)) return 'mountains';
    if (/mesa|dune|butte|canyon|badland|plateau/.test(f)) return 'mesas';
  }
  const w = words.toLowerCase();
  if (/mushroom|fung|spore|mycel|toadstool/.test(w)) return 'mushrooms';
  if (/forest|grove|jungle|woodland|swamp|bayou|treetop|redwood|elven|sylvan/.test(w)) return 'trees';
  if (/neon|arcolog|cyber|metropol|skyscraper|megacity|downtown|megastructure|container port|shipyard|industrial/.test(w)) return 'towers';
  if (/moon|lunar|mars|martian|asteroid|crater|exoplanet|alien/.test(w)) return 'spires';
  if (/snow|alpine|mountain|monastery|glacier|fjord|peak|himalay|tundra/.test(w)) return 'mountains';
  if (/desert|canyon|mesa|frontier|dune|wasteland|badland|oasis|gulch|prairie/.test(w)) return 'mesas';
  if (ground === 'moss') return 'trees';
  if (ground === 'regolith' || ground === 'ash') return 'spires';
  if (ground === 'snow' || ground === 'ice') return 'mountains';
  if (ground === 'sand') return 'mesas';
  if (ground === 'asphalt' || ground === 'concrete') return 'towers';
  return theme === 'western' ? 'mesas' : theme === 'modern' ? 'towers' : theme === 'scifi' ? 'spires' : 'mountains';
}

/** The ring sits at least 150 m from the centre of the town and always well clear of its bounds. */
export function horizonRadii(bounds: Rect): { inner: number; outer: number } {
  const reach = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
  const inner = Math.max(150, reach + FLAT_MARGIN + 60);
  return { inner, outer: inner + 150 };
}

/** How far a form's geometry can reach from its centre, in multiples of its radius (profile, wobble, clustering). */
const FOOTPRINT: Record<HorizonKind, number> = { mesas: 1.75, mountains: 1.4, trees: 1.85, mushrooms: 1.05, towers: 2.3, spires: 2.7 };

export function horizonForms(field: TerrainField, kind: HorizonKind, quality: Quality): HorizonForm[] {
  const rng = makeRng(field.seed, 'horizon');
  const b = field.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const { inner, outer } = horizonRadii(b);
  const slim = kind === 'trees' || kind === 'mushrooms' || kind === 'spires' || kind === 'towers';
  const count = (quality === 0 ? 12 : quality === 1 ? 18 : 24) + (slim ? 10 : 0);
  const forms: HorizonForm[] = [];
  for (let i = 0; i < count; i++) {
    const ang = ((i + rng.range(-0.38, 0.38)) / count) * Math.PI * 2;
    // Alternate a near row and a far row so silhouettes overlap in depth.
    const far = i % 2 === 1 ? rng.range(0.5, 1) : rng.range(0, 0.45);
    const dist = mix(inner + 8, outer - 30, far);
    const big = 0.75 + 0.6 * far + rng.range(-0.1, 0.25);
    let radius: number;
    let height: number;
    switch (kind) {
      case 'mesas': radius = rng.range(34, 72) * big; height = rng.range(34, 70) * big; break;
      case 'mountains': radius = rng.range(80, 140) * big; height = rng.range(90, 170) * big; break;
      case 'trees': radius = rng.range(16, 26) * big; height = rng.range(55, 95) * big; break;
      case 'mushrooms': radius = rng.range(18, 34) * big; height = rng.range(45, 90) * big; break;
      case 'towers': radius = rng.range(14, 30) * big; height = rng.range(70, 190) * big; break;
      default: radius = rng.range(9, 22) * big; height = rng.range(45, 120) * big;
    }
    const x = cx + Math.cos(ang) * dist;
    const z = cz + Math.sin(ang) * dist;
    const stretch = kind === 'mesas' || kind === 'mountains' ? rng.range(1, 2.1) : 1;
    // No form may put a foot on the flat ground: one that would is narrowed, and lowered to keep its proportions.
    const room = (outsideDistance(b, x, z) - FLAT_MARGIN - 5) / (stretch * FOOTPRINT[kind]);
    if (radius > room) {
      height = Math.max(30, height * (room / radius) ** 0.6);
      radius = room;
    }
    forms.push({
      kind, x, z, y: terrainHeight(field, x, z) - 4, radius, height,
      yaw: rng.range(0, Math.PI * 2), stretch, seed: rng.int(1, 1 << 20),
    });
  }
  return forms;
}

export interface HorizonPalette { rock: string; rock2: string; cap: string; stem: string; canopy: string; dark: string; glow: string }

/** Horizon colours from the style: rock leans on the ground colour so distant forms belong to the same land. */
export function horizonPalette(style: { ground: string; dark: string; wall: string; accent: string; trim: string; glow: string }, kind: HorizonKind, ground: SurfaceKind): HorizonPalette {
  const g = new THREE.Color(style.ground);
  const hsl = { h: 0, s: 0, l: 0 };
  g.getHSL(hsl);
  const rock = new THREE.Color().setHSL(hsl.h, hsl.s * 0.75, clamp(hsl.l * 0.72, 0.12, 0.5));
  const rock2 = new THREE.Color().setHSL((hsl.h + 0.97) % 1, hsl.s * 0.9, clamp(hsl.l * 0.52, 0.08, 0.4));
  const snowy = ground === 'snow' || ground === 'ice' || kind === 'mountains';
  const cap = kind === 'mushrooms' ? new THREE.Color(style.accent) : snowy ? new THREE.Color('#e9eef4') : rock.clone().offsetHSL(0, -0.05, 0.1);
  const canopy = ground === 'grass' || ground === 'moss'
    ? new THREE.Color().setHSL(hsl.h, clamp(hsl.s * 0.9, 0, 0.6), clamp(hsl.l * 0.5, 0.08, 0.26))
    : new THREE.Color('#27402a').lerp(g, 0.25);
  const hex = (c: THREE.Color): string => `#${c.getHexString()}`;
  return {
    rock: hex(rock), rock2: hex(rock2), cap: hex(cap), canopy: hex(canopy),
    stem: hex(new THREE.Color(kind === 'mushrooms' ? style.trim : '#4a3a2c').lerp(g, 0.2)),
    dark: hex(new THREE.Color(style.dark).lerp(new THREE.Color(style.wall), 0.22)), glow: style.glow,
  };
}

/** A lumpy solid of revolution: `profile(t)` is the radius factor at height fraction t, `wobble` its angular noise. */
function lathe(
  out: THREE.BufferGeometry[], f: HorizonForm, y0: number, radius: number, height: number, segs: number, rings: number,
  profile: (t: number) => number, wobble: number, colour: (t: number, n: number, into: THREE.Color) => void,
): void {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const cy = Math.cos(f.yaw);
  const sy = Math.sin(f.yaw);
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const n = fbm(Math.cos(a) * 1.7 + 9, Math.sin(a) * 1.7 + t * 1.3, f.seed, 3);
      const rr = radius * profile(t) * (1 + wobble * (n - 0.5) * 2);
      const lx = Math.cos(a) * rr * f.stretch;
      const lz = Math.sin(a) * rr;
      pos.push(f.x + lx * cy - lz * sy, y0 + t * height, f.z + lx * sy + lz * cy);
      colour(t, n, c);
      col.push(c.r, c.g, c.b);
    }
  }
  const top = pos.length / 3;
  pos.push(f.x, y0 + height, f.z);
  colour(1, 0.5, c);
  col.push(c.r, c.g, c.b);
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * segs + s;
      const b = r * segs + ((s + 1) % segs);
      idx.push(a, a + segs, b, b, a + segs, b + segs);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(rings * segs + s, top, rings * segs + ((s + 1) % segs));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  out.push(g);
}

/** A stock primitive placed and tinted with one colour (a vertical shade from `k0` at its base to `k1` at its top). */
function placed(out: THREE.BufferGeometry[], g: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, colour: THREE.Color, k0: number, k1: number): void {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.rotateY(yaw).translate(x, y, z);
  n.computeBoundingBox();
  const bb = n.boundingBox as THREE.Box3;
  const p = n.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = mix(k0, k1, (p.getY(i) - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y));
    col[i * 3] = colour.r * k; col[i * 3 + 1] = colour.g * k; col[i * 3 + 2] = colour.b * k;
  }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  n.deleteAttribute('uv');
  n.deleteAttribute('normal');
  out.push(n);
}

function mergeColoured(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (list.length === 0) return null;
  let count = 0;
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    count += n.getAttribute('position').count;
    return n;
  });
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    col.set(g.getAttribute('color').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Builds the ring. `solid` is everything matte (flat-shaded, vertex-coloured); `glow` holds the lit window
 * bands of megastructures and the gills of giant mushrooms, for an emissive material. Either may be null.
 */
export function buildHorizonGeometry(forms: readonly HorizonForm[], pal: HorizonPalette, quality: Quality): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  const solid: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const rock = new THREE.Color(pal.rock);
  const rock2 = new THREE.Color(pal.rock2);
  const cap = new THREE.Color(pal.cap);
  const stem = new THREE.Color(pal.stem);
  const canopy = new THREE.Color(pal.canopy);
  const dark = new THREE.Color(pal.dark);
  const lit = new THREE.Color(pal.glow);
  const segs = quality === 0 ? 10 : 16;
  for (const f of forms) {
    const rng = makeRng(f.seed, 'form');
    switch (f.kind) {
      case 'mesas': {
        // Talus apron, then a near-vertical cliff cut by two ledges, then the flat cap.
        const ledge = rng.range(0.55, 0.7);
        lathe(solid, f, f.y, f.radius, f.height, segs, 7, (t) => (t < 0.3 ? mix(1.45, 0.9, t / 0.3) : t < ledge ? 0.88 : t < 0.96 ? 0.78 : 0.74), 0.16,
          (t, n, c) => {
            const strata = Math.floor(t * 9 + n * 1.5) % 2 === 0 ? 1 : 0.8;
            c.copy(t < 0.3 ? rock : rock2).lerp(rock, t < 0.3 ? 0 : 0.35 + 0.3 * n).multiplyScalar(t > 0.95 ? 1.15 : strata);
          });
        break;
      }
      case 'mountains':
        lathe(solid, f, f.y, f.radius, f.height, segs + 4, 8, (t) => (1 - t) ** 0.8 * (1 - 0.25 * t) + 0.02, 0.34,
          (t, n, c) => { c.copy(rock2).lerp(rock, 0.3 + 0.5 * n).lerp(cap, smoothstep(0.5, 0.68, t + (n - 0.5) * 0.35)); });
        break;
      case 'spires':
        for (let k = 0, m = rng.int(2, 4); k < m; k++) {
          const g: HorizonForm = { ...f, x: f.x + rng.range(-1.6, 1.6) * f.radius, z: f.z + rng.range(-1.6, 1.6) * f.radius, seed: f.seed + k * 17 };
          lathe(solid, g, f.y, f.radius * rng.range(0.5, 1), f.height * rng.range(0.45, 1), 8, 6, (t) => (1 - t) ** 0.55 * (1 - 0.35 * Math.sin(t * 9)) * 0.9 + 0.03, 0.3,
            (t, n, c) => { c.copy(rock2).lerp(rock, 0.2 + 0.7 * n).multiplyScalar(0.8 + 0.3 * t); });
        }
        break;
      case 'trees': {
        const trunkH = f.height * 0.72;
        lathe(solid, f, f.y, f.radius * 0.2, trunkH, 8, 5, (t) => 1.7 - 1.1 * smoothstep(0, 0.25, t) - 0.2 * t, 0.15, (t, n, c) => { c.copy(stem).multiplyScalar(0.7 + 0.5 * n); });
        for (let k = 0, m = rng.int(4, 6); k < m; k++) {
          const r = f.radius * rng.range(0.55, 1);
          const g = new THREE.IcosahedronGeometry(r, 1).scale(1, rng.range(0.55, 0.8), 1);
          placed(solid, g, f.x + rng.range(-0.8, 0.8) * f.radius, f.y + trunkH + rng.range(-0.12, 0.2) * f.height, f.z + rng.range(-0.8, 0.8) * f.radius, rng.range(0, 6), canopy, 0.55, 1.25);
        }
        break;
      }
      case 'mushrooms': {
        const stemH = f.height * 0.86;
        lathe(solid, f, f.y, f.radius * 0.17, stemH, 8, 6, (t) => 1.5 - 0.8 * smoothstep(0, 0.3, t) + 0.25 * smoothstep(0.8, 1, t), 0.12, (t, n, c) => { c.copy(stem).multiplyScalar(0.75 + 0.4 * n + 0.15 * t); });
        const capGeo = new THREE.SphereGeometry(f.radius, segs, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, rng.range(0.45, 0.8), 1);
        placed(solid, capGeo, f.x, f.y + stemH - 1, f.z, f.yaw, cap, 0.6, 1.2);
        placed(glow, new THREE.CylinderGeometry(f.radius * 0.94, f.radius * 0.3, f.radius * 0.1, segs, 1, true), f.x, f.y + stemH - 1 - f.radius * 0.05, f.z, f.yaw, lit, 0.5, 1);
        break;
      }
      default: {
        // Megastructure: a slab that steps back as it rises, a mast, and bands of lit floors on every face.
        let y = f.y;
        let w = f.radius * 2;
        let d = f.radius * rng.range(1.1, 2);
        for (let tier = 0, tiers = rng.int(2, 4); tier < tiers; tier++) {
          const h = (f.height / tiers) * rng.range(0.8, 1.2);
          placed(solid, new THREE.BoxGeometry(w, h, d), f.x, y + h / 2, f.z, f.yaw, dark, 0.7, 1.15);
          const bands = quality === 0 ? 2 : rng.int(3, 6);
          for (let k = 0; k < bands; k++) {
            const by = y + h * rng.range(0.1, 0.92);
            const run = rng.range(0.25, 0.9);
            const shift = rng.range(-0.5, 0.5) * (1 - run);
            const onX = rng.chance(0.5);
            const g = onX ? new THREE.BoxGeometry(w * run, 1.1, d + 0.6) : new THREE.BoxGeometry(w + 0.6, 1.1, d * run);
            g.translate(onX ? w * shift : 0, 0, onX ? 0 : d * shift);
            placed(glow, g, f.x, by, f.z, f.yaw, lit, 1, 1);
          }
          y += h;
          w *= rng.range(0.55, 0.85);
          d *= rng.range(0.55, 0.85);
        }
        placed(solid, new THREE.BoxGeometry(1.4, f.height * 0.22, 1.4), f.x, y + f.height * 0.11, f.z, f.yaw, dark, 0.8, 0.8);
      }
    }
  }
  return { solid: mergeColoured(solid), glow: mergeColoured(glow) };
}

// ---- Roads, kerbs, boardwalks, puddles, decals -----------------------------------------------------------

export type RoadClass = 'paved' | 'track';
const SOFT = new Set<SurfaceKind>(['dirt', 'sand', 'grass', 'moss', 'snow', 'mud', 'gravel', 'regolith', 'ash']);

/** A road is a worn track when the site says so or when its surface is loose; otherwise it is paved and kerbed. */
export function roadClassFor(road: SurfaceKind, paths: SiteSpec['paths']): RoadClass {
  return paths === 'track' || SOFT.has(road) ? 'track' : 'paved';
}

export type RoadDecalKind = 'manholes' | 'hoofprints' | 'tyre_tracks';
export function roadDecalKind(cls: RoadClass, theme: ThemeId): RoadDecalKind {
  return cls === 'paved' ? 'manholes' : theme === 'western' || theme === 'medieval' ? 'hoofprints' : 'tyre_tracks';
}

export interface RoadInput {
  layout: TownLayout; surfaces: SurfaceSet; theme: ThemeId; paths: SiteSpec['paths']; seed: number; quality: Quality;
  roadHex: string; wallHex: string;
}

export interface RoadGeometry {
  /** One strip per drawn road, for roadMaterial. Colour multiplies: gutters and ruts are darker, the crown lighter. */
  roads: THREE.BufferGeometry[];
  plaza: THREE.BufferGeometry;
  /** Kerb stones and boardwalk planks: opaque, fully vertex-coloured. */
  trim: THREE.BufferGeometry | null;
  /** Standing water, alpha in the colour attribute. Null unless surfaces.wet > 0.5. */
  puddles: THREE.BufferGeometry | null;
  /** Manhole covers and drains, or hoofprints, or tyre tracks; alpha in the colour attribute. */
  decals: THREE.BufferGeometry | null;
  cls: RoadClass; decalKind: RoadDecalKind; puddleCount: number; kerbCount: number; boardwalkCount: number;
}

const ROAD_Y = 0.02;
const DECAL_Y = 0.06;
const WATER_Y = 0.064;
const KERB_H = 0.07;
const PAVED_COLS = [0, 0.07, 0.28, 0.5, 0.72, 0.93, 1];
const TRACK_COLS = [0, 0.12, 0.24, 0.32, 0.41, 0.5, 0.59, 0.68, 0.76, 0.88, 1];

interface Lane { seg: RoadSegment; ux: number; uz: number; len: number; width: number; y: number }

function lanes(layout: TownLayout, paths: SiteSpec['paths']): Lane[] {
  if (paths === 'none') return [];
  return layout.roads.map((seg, i) => {
    const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
    const width = paths === 'track' ? Math.min(seg.width, TRACK_WIDTH) : seg.width;
    return { seg, ux: len > 0 ? (seg.bx - seg.ax) / len : 1, uz: len > 0 ? (seg.bz - seg.az) / len : 0, len, width, y: ROAD_Y + (i % 4) * 0.003 };
  }).filter((l) => l.len > 0.5);
}

/** Surface height and colour multiplier across a road, t in 0..1 from one edge to the other. */
function crossSection(cls: RoadClass, t: number, wear: number): { dy: number; k: number } {
  const c = 1 - (2 * t - 1) ** 2;
  if (cls === 'paved') {
    const lane = Math.exp(-(((Math.abs(t - 0.5) - 0.22) / 0.07) ** 2));
    return { dy: 0.025 * c, k: mix(0.74 - 0.1 * wear, 1.03, smoothstep(0, 0.2, c)) * (1 - 0.1 * lane) };
  }
  const rut = Math.exp(-(((Math.abs(t - 0.5) - 0.18) / 0.075) ** 2));
  return { dy: 0.012 * c - 0.014 * rut, k: mix(0.93, 1.1, c) * (1 - 0.3 * rut) };
}

export function buildRoadGeometry(inp: RoadInput): RoadGeometry {
  const { layout, surfaces, seed } = inp;
  const cls = roadClassFor(surfaces.road, inp.paths);
  const decalKind = roadDecalKind(cls, inp.theme);
  const all = lanes(layout, inp.paths);
  const rng = makeRng(seed, 'roads');
  const wear = clamp(surfaces.wear, 0, 1);
  const roads: THREE.BufferGeometry[] = [];
  const trim = new Soup();
  const water = new Soup();
  const decal = new Soup();
  const pl = layout.plaza;
  const rects = all.map((l) => roadRect({ ...l.seg, width: l.width }));
  const onOther = (self: number, x: number, z: number, grow: number): boolean =>
    rects.some((r, i) => i !== self && x > r.minX - grow && x < r.maxX + grow && z > r.minZ - grow && z < r.maxZ + grow)
    || Math.hypot(x - pl.x, z - pl.z) < pl.r + grow;
  const kerbTint = ((): [number, number, number] => {
    const c = new THREE.Color(inp.roadHex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s * 0.5, clamp(hsl.l * 1.25 + 0.06, 0.2, 0.75));
    return [c.r, c.g, c.b];
  })();
  let kerbCount = 0;

  all.forEach((l, li) => {
    const road = new Soup();
    const cols = cls === 'paved' ? PAVED_COLS : TRACK_COLS;
    const px = -l.uz;
    const pz = l.ux;
    const n = Math.max(1, Math.ceil(l.len / (inp.quality === 0 ? 3 : 1.5)));
    const at = (i: number, c: number): [number, number, number, number] => {
      const s = (i / n) * l.len;
      const t = cols[c] as number;
      let off = (t - 0.5) * l.width;
      const x0 = l.seg.ax + l.ux * s;
      const z0 = l.seg.az + l.uz * s;
      // Tracks have no drawn edge: the two outer columns wander so the worn strip frays into the ground.
      if (cls === 'track' && (c === 0 || c === cols.length - 1)) off += Math.sign(off) * 0.55 * (fbm(x0 / 3.1, z0 / 3.1, seed + 61 + c, 2) - 0.35);
      const x = x0 + px * off;
      const z = z0 + pz * off;
      const cs = crossSection(cls, t, wear);
      const blot = 0.9 + 0.2 * fbm(x / 5.3, z / 5.3, seed + 67, 3) - 0.12 * wear * smoothstep(0.55, 0.8, fbm(x / 2.1, z / 2.1, seed + 71, 2));
      return [x, l.y + cs.dy, z, cs.k * blot];
    };
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < cols.length - 1; c++) {
        const a = at(i, c); const b = at(i + 1, c); const d = at(i, c + 1); const e = at(i + 1, c + 1);
        road.vert(a[0], a[1], a[2], a[3]); road.vert(d[0], d[1], d[2], d[3]); road.vert(b[0], b[1], b[2], b[3]);
        road.vert(b[0], b[1], b[2], b[3]); road.vert(d[0], d[1], d[2], d[3]); road.vert(e[0], e[1], e[2], e[3]);
      }
    }
    const strip = road.build();
    if (strip) roads.push(strip);
    if (cls === 'paved') {
      // Kerb stones down both edges, each its own length and shade, left out wherever another road or the plaza crosses.
      for (const side of [-1, 1]) {
        for (let s = 0; s < l.len;) {
          const stone = Math.min(l.len - s, rng.range(0.75, 1.15));
          const mid = s + stone / 2;
          const x = l.seg.ax + l.ux * mid + px * side * (l.width / 2 + 0.09);
          const z = l.seg.az + l.uz * mid + pz * side * (l.width / 2 + 0.09);
          if (stone > 0.3 && !onOther(li, x, z, 0.12)) {
            trim.box(x, 0, z, stone / 2 - 0.012, ROAD_Y + KERB_H + rng.range(-0.008, 0.008), 0.09, l.ux, l.uz, rng.range(0.82, 1.08) * (1 - 0.2 * wear * rng.next()), kerbTint);
            kerbCount++;
          }
          s += stone;
        }
      }
    }
  });

  // Plaza: paved or trodden like the roads, lighter where feet polish the middle, grimy at the rim.
  const plaza = new Soup();
  const segs = 40;
  const ringsR = [0, 0.4, 0.75, 0.93, 1];
  const pk = (r: number, x: number, z: number): number => mix(1.06, 0.8, smoothstep(0.55, 1, r)) * (0.92 + 0.16 * fbm(x / 4.7, z / 4.7, seed + 73, 3));
  for (let r = 0; r < ringsR.length - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const p = (rr: number, ss: number): [number, number, number] => {
        const a = (ss / segs) * Math.PI * 2;
        const x = pl.x + Math.cos(a) * pl.r * rr;
        const z = pl.z + Math.sin(a) * pl.r * rr;
        return [x, z, pk(rr, x, z)];
      };
      const a = p(ringsR[r] as number, s); const b = p(ringsR[r] as number, s + 1);
      const c = p(ringsR[r + 1] as number, s); const d = p(ringsR[r + 1] as number, s + 1);
      const y = ROAD_Y + 0.014;
      plaza.vert(a[0], y, a[1], a[2]); plaza.vert(b[0], y, b[1], b[2]); plaza.vert(c[0], y, c[1], c[2]);
      plaza.vert(b[0], y, b[1], b[2]); plaza.vert(d[0], y, d[1], d[2]); plaza.vert(c[0], y, c[1], c[2]);
    }
  }
  if (cls === 'paved' && pl.r > 0) {
    const stones = Math.max(8, Math.round((Math.PI * 2 * pl.r) / 0.95));
    for (let s = 0; s < stones; s++) {
      const a = ((s + 0.5) / stones) * Math.PI * 2;
      const x = pl.x + Math.cos(a) * (pl.r + 0.09);
      const z = pl.z + Math.sin(a) * (pl.r + 0.09);
      if (rects.some((r) => x > r.minX - 0.15 && x < r.maxX + 0.15 && z > r.minZ - 0.15 && z < r.maxZ + 0.15)) continue;
      trim.box(x, 0, z, (Math.PI * pl.r) / stones - 0.012, ROAD_Y + KERB_H, 0.09, -Math.sin(a), Math.cos(a), rng.range(0.82, 1.08), kerbTint);
      kerbCount++;
    }
  }

  // Boardwalks: a low plank deck along the front of each timber building, stopping short of the road.
  let boardwalkCount = 0;
  if (surfaces.wall === 'timber' || surfaces.wall === 'planks' || surfaces.wall === 'log') {
    const wood = new THREE.Color(inp.wallHex).lerp(new THREE.Color('#6a5a4a'), 0.55);
    const tint: [number, number, number] = [wood.r, wood.g, wood.b];
    for (const b of layout.buildings) boardwalkCount += boardwalk(trim, b, all, pl, rng, tint, wear) ? 1 : 0;
  }

  // Puddles gather in the low spots: gutters on paved roads, ruts on tracks, the dished rim of the plaza.
  let puddleCount = 0;
  if (surfaces.wet > 0.5) {
    const amount = clamp((surfaces.wet - 0.5) * 2, 0, 1);
    const threshold = 0.37 + 0.13 * amount;
    const waterTint = ((): [number, number, number] => {
      const c = new THREE.Color(inp.roadHex).multiplyScalar(0.3).lerp(new THREE.Color('#1c2228'), 0.6);
      return [c.r, c.g, c.b];
    })();
    const pool = (x: number, z: number, ux: number, uz: number, r0: number): void => {
      if (puddleCount >= 140) return;
      const ph = rng.range(0, 6);
      const id = puddleCount;
      water.blob(x, WATER_Y, z, 14, ux, uz, rng.range(1.2, 2.1), (i) => r0 * (0.8 + 0.34 * Math.sin(i * 0.9 + ph) * Math.sin(i * 2.3 + ph * 2) + 0.14 * hash2(i, id, seed)), 1, 0.9, 0, waterTint, 0.72);
      puddleCount++;
    };
    for (const l of all) {
      const lows = cls === 'paved' ? [0.1, 0.9] : [0.32, 0.68];
      for (let s = 1.2; s < l.len - 1.2; s += 2.4) {
        const t = (rng.pick(lows) + rng.range(-0.04, 0.04) - 0.5) * l.width;
        const x = l.seg.ax + l.ux * s - l.uz * t;
        const z = l.seg.az + l.uz * s + l.ux * t;
        const low = fbm(x / 9, z / 9, seed + 79, 3);
        if (low < threshold) pool(x, z, l.ux, l.uz, mix(0.3, 0.95, smoothstep(threshold, threshold - 0.2, low)) * (cls === 'paved' ? 1 : 0.7));
      }
    }
    for (let k = 0; k < 10 && pl.r > 0; k++) {
      const a = rng.range(0, Math.PI * 2);
      const x = pl.x + Math.cos(a) * pl.r * rng.range(0.35, 0.85);
      const z = pl.z + Math.sin(a) * pl.r * rng.range(0.35, 0.85);
      if (fbm(x / 9, z / 9, seed + 79, 3) < threshold + 0.04) pool(x, z, Math.cos(a), Math.sin(a), rng.range(0.35, 0.9));
    }
  }

  // Decals by road kind.
  const black: [number, number, number] = [0.03, 0.03, 0.035];
  for (const l of all) {
    if (decalKind === 'manholes') {
      const iron: [number, number, number] = [0.13, 0.13, 0.14];
      for (let s = rng.range(6, 14); s < l.len - 3; s += rng.range(19, 31)) {
        const t = (rng.pick([0.3, 0.5, 0.7]) - 0.5) * l.width;
        const x = l.seg.ax + l.ux * s - l.uz * t;
        const z = l.seg.az + l.uz * s + l.ux * t;
        decal.blob(x, DECAL_Y, z, 16, l.ux, l.uz, 1, () => 0.4, 0.75, 1, 1, [0.3, 0.3, 0.31]);
        decal.blob(x, DECAL_Y + 0.002, z, 16, l.ux, l.uz, 1, () => 0.34, 1, 1, 1, iron);
        for (const o of [-0.16, 0, 0.16]) decal.box(x + l.ux * o, DECAL_Y + 0.002, z + l.uz * o, 0.025, 0.003, 0.24 - Math.abs(o) * 0.5, l.ux, l.uz, 0.45, iron);
      }
      // Gutter drains: a slotted grate against the kerb every so often.
      for (let s = rng.range(4, 10); s < l.len - 2; s += rng.range(14, 22)) {
        const side = rng.chance(0.5) ? 1 : -1;
        const t = side * (l.width / 2 - 0.24);
        const x = l.seg.ax + l.ux * s - l.uz * t;
        const z = l.seg.az + l.uz * s + l.ux * t;
        decal.box(x, DECAL_Y - 0.004, z, 0.3, 0.004, 0.18, l.ux, l.uz, 1, [0.1, 0.1, 0.11]);
        for (let k = -2; k <= 2; k++) decal.box(x + l.ux * k * 0.11, DECAL_Y, z + l.uz * k * 0.11, 0.022, 0.004, 0.15, l.ux, l.uz, 1, [0.26, 0.26, 0.27]);
      }
    } else if (decalKind === 'hoofprints') {
      for (let trail = 0, m = Math.max(1, Math.round(l.len / 30)); trail < m * 2; trail++) {
        const dir = rng.chance(0.5) ? 1 : -1;
        let s = rng.range(0, l.len * 0.5);
        let t = rng.range(-0.3, 0.3) * l.width;
        const steps = Math.min(60, Math.floor((l.len - s) / 0.62));
        for (let k = 0; k < steps; k++, s += rng.range(0.52, 0.72)) {
          t = clamp(t + rng.range(-0.05, 0.05), -l.width * 0.42, l.width * 0.42);
          const tt = t + (k % 2 === 0 ? 0.11 : -0.11);
          const along = dir > 0 ? s : l.len - s;
          const x = l.seg.ax + l.ux * along - l.uz * tt;
          const z = l.seg.az + l.uz * along + l.ux * tt;
          // A horseshoe: open toward the heel, so the rim of the blob is cut on one side.
          decal.blob(x, DECAL_Y - 0.012, z, 9, l.ux * dir, l.uz * dir, 1.15, (i) => (i === 4 || i === 5 ? 0.02 : 0.062), 1, 0.62, 0.3, black);
        }
      }
    } else {
      for (let pair = 0; pair < 2; pair++) {
        const centre = rng.range(-0.12, 0.12) * l.width;
        const gauge = Math.min(1.5, l.width * 0.62);
        const ph = rng.range(0, 10);
        const s0 = rng.range(0, l.len * 0.3);
        const s1 = l.len - rng.range(0, l.len * 0.3);
        for (const wheel of [-0.5, 0.5]) {
          for (let s = s0; s < s1 - 1; s += 1) {
            const p = (ss: number, e: number): [number, number] => {
              const t = centre + wheel * gauge + 0.12 * Math.sin(ss * 0.11 + ph) + e;
              return [l.seg.ax + l.ux * ss - l.uz * t, l.seg.az + l.uz * ss + l.ux * t];
            };
            const a = p(s, -0.11); const b = p(s, 0.11); const c = p(s + 1, -0.11); const d = p(s + 1, 0.11);
            const al = 0.34 * smoothstep(s0, s0 + 4, s) * (1 - smoothstep(s1 - 5, s1 - 1, s)) * (0.6 + 0.4 * hash2(Math.floor(s), pair, seed));
            const y = DECAL_Y - 0.012;
            decal.vert(a[0], y, a[1], 1, al, black); decal.vert(b[0], y, b[1], 1, al, black); decal.vert(c[0], y, c[1], 1, al, black);
            decal.vert(b[0], y, b[1], 1, al, black); decal.vert(d[0], y, d[1], 1, al, black); decal.vert(c[0], y, c[1], 1, al, black);
          }
        }
      }
    }
  }

  const plazaGeo = plaza.build() as THREE.BufferGeometry;
  return {
    roads, plaza: plazaGeo, trim: trim.build(), puddles: water.build(), decals: decal.build(),
    cls, decalKind, puddleCount, kerbCount, boardwalkCount,
  };
}

/** One deck of planks along a building front. Returns false when there is no room between the wall and the road. */
function boardwalk(out: Soup, b: PlacedBuilding, roads: readonly Lane[], plaza: TownLayout['plaza'], rng: Rng, tint: readonly [number, number, number], wear: number): boolean {
  const fx = -Math.sin(b.rotY);
  const fz = -Math.cos(b.rotY);
  const ux = Math.cos(b.rotY);
  const uz = -Math.sin(b.rotY);
  const wx = b.x + fx * (b.d / 2);
  const wz = b.z + fz * (b.d / 2);
  let room = Math.hypot(wx - plaza.x, wz - plaza.z) - plaza.r;
  for (const l of roads) {
    for (const o of [-0.45, 0, 0.45]) room = Math.min(room, distanceToRoad({ ...l.seg, width: l.width }, wx + ux * b.w * o, wz + uz * b.w * o));
  }
  const depth = Math.min(1.7, room - 0.2);
  if (depth < 0.7) return false;
  const span = b.w + 0.5;
  for (let s = -span / 2; s < span / 2;) {
    const plank = Math.min(span / 2 - s, rng.range(0.17, 0.25));
    const len = depth + rng.range(-0.05, 0.05);
    const a = s + plank / 2;
    const cxp = wx + ux * a + fx * (len / 2 - 0.05);
    const czp = wz + uz * a + fz * (len / 2 - 0.05);
    // Weathered boards: each its own grey-brown, a few sprung a little proud of the rest.
    const k = rng.range(0.72, 1.08) * (1 - 0.25 * wear * rng.next());
    out.box(cxp, 0, czp, plank / 2 - 0.006, 0.048 + (rng.chance(0.1) ? 0.009 : 0), len / 2, ux, uz, k, tint);
    s += plank;
  }
  return true;
}
