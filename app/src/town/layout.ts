// Deterministic town layout. Pure: no three, no DOM. Same spec in, same layout out.
// With no WorldSpec.site: main street along X through the origin, cross streets along Z. With a site the
// pattern (street, ring, scatter, grid, terraces) decides. Buildings face their route; rotations are always
// multiples of 90 degrees (rotY 0 faces -Z, PI faces +Z, PI/2 faces -X, -PI/2 faces +X).
//
// A spec that carries WorldSpec.terrain is laid out for land rather than for a town: footprints grow, lots
// tighten or spread with terrain.settled, the wilderness patterns (wild, path, shoreline, cliffside) put a few
// points of interest among trails instead of streets, zero buildings is a valid world, and the water the
// terrain asks for is planned here as plain shapes (see WaterBody) so the land can be carved to hold it.
import PoissonDiskSampling from 'poisson-disk-sampling';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { BuildingRole, BuildingSize, BuildingSpec, SitePattern, SiteSpec, TerrainSpec, ThemeId, WaterKind, WorldSpec } from '../world/spec';

export interface PlacedBuilding {
  id: string; role: BuildingRole; size: BuildingSize;
  x: number; z: number; rotY: number; w: number; d: number;
  /** Point 1 m outside the door, on the street side. */
  door: { x: number; z: number };
}
export interface RoadSegment { ax: number; az: number; bx: number; bz: number; width: number }
export interface PlacedProp { kind: string; x: number; z: number; rotY: number; scale: number }
export interface TownLayout {
  buildings: PlacedBuilding[]; roads: RoadSegment[]; props: PlacedProp[];
  plaza: { x: number; z: number; r: number }; spawn: { x: number; z: number; rotY: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  walkable: { x: number; z: number }[];
  /** Winding footpaths (wilderness patterns): polylines the land grades to a walkable slope. Absent on towns. */
  trails?: Trail[];
  /** Water the terrain asks for, as shapes. Absent when there is none. */
  water?: WaterBody[];
  /** Open ground kept clear and level: the spawn clearing of a wilderness, a camp circle. */
  clearings?: { x: number; z: number; r: number }[];
  /** Level benches a cliffside site steps up: flat between s0 and s1 along (nx, nz), `level` steps above the first. */
  benches?: { nx: number; nz: number; steps: { s0: number; s1: number; level: number }[] };
}
/** A footpath. 'path' is the one drawn route of a path site; 'trail' is a faint worn line. */
export interface Trail { pts: { x: number; z: number }[]; width: number; kind: 'trail' | 'path' }
export type WaterShape =
  | { shape: 'disc'; x: number; z: number; r: number; wobble: number; phase: number }
  | { shape: 'band'; pts: { x: number; z: number }[]; half: number }
  /** Water where x * nx + z * nz exceeds `offset` (a wobbling shoreline). */
  | { shape: 'half'; nx: number; nz: number; offset: number; wobble: number; phase: number }
  /** Water (or mist) everywhere further than `margin` from the rectangle. */
  | { shape: 'outside'; rect: Rect; margin: number }
  /** Water wherever the land lies below the water level: the pools of a swamp, the channels between islands. */
  | { shape: 'sheet' };
export interface WaterBody {
  kind: Exclude<WaterKind, 'none'>;
  area: WaterShape;
  /** A disc that stands for the body, for audio and life: the point of it nearest the middle of the place. */
  x: number; z: number; r: number;
}
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export const FOOTPRINTS: Record<BuildingSize, { w: number; d: number }> = {
  small: { w: 6, d: 6 },
  medium: { w: 9, d: 8 },
  large: { w: 12, d: 10 },
};

/** Footprints of a world that carries terrain: structures a person looks up at. */
export const GROWN_FOOTPRINTS: Record<BuildingSize, { w: number; d: number }> = {
  small: { w: 7, d: 7 },
  medium: { w: 11, d: 9 },
  large: { w: 16, d: 12 },
};

export const MAIN_WIDTH = 8;
export const CROSS_WIDTH = 6;
export const LOT_DEPTH = 14;
export const SETBACK = 2.5;
export const GAP = 3;
export const PLAZA_RADIUS = 7;
export const TRACK_WIDTH = 2.2;
export const MAX_WILD_PROPS = 420;
const ROAD_MARGIN = 1.5;
const FAR = 1000;
const MAX_PROPS = 160;

export function footprintFor(
  role: BuildingRole, size: BuildingSize,
  kit?: { footprint(role: BuildingRole, size: BuildingSize): { w: number; d: number } },
): { w: number; d: number } {
  const fp = kit?.footprint(role, size);
  if (fp && fp.w > 0 && fp.d > 0) return { w: fp.w, d: fp.d };
  return { ...FOOTPRINTS[size] };
}

/** Footprint of a building in this world: grown when the spec carries terrain, the classic sizes otherwise. */
function fpFor(spec: WorldSpec, s: { role: BuildingRole; size: BuildingSize }): { w: number; d: number } {
  return spec.terrain ? { ...GROWN_FOOTPRINTS[s.size] } : footprintFor(s.role, s.size);
}

const PROP_KINDS: Record<ThemeId, [string, number][]> = {
  western: [['barrel', 3], ['crate', 3], ['cactus', 4], ['fence', 2], ['water_trough', 1.5], ['hitching_post', 1.5], ['wagon_wheel', 1]],
  medieval: [['barrel', 2], ['crate', 2], ['tree', 5], ['bush', 3], ['well', 0.7], ['cart', 1.2], ['hay', 2]],
  scifi: [['crate', 3], ['container', 2], ['antenna', 1.2], ['light_pole', 3], ['plant_pod', 2]],
  modern: [['bench', 2], ['tree', 4], ['bin', 2], ['light_pole', 3], ['hydrant', 1], ['car', 2]],
};

/** Axis-aligned footprint of a building (rotations are always multiples of 90 degrees). */
export function buildingAabb(b: { x: number; z: number; rotY: number; w: number; d: number }): Rect {
  const turned = Math.abs(Math.sin(b.rotY)) > 0.5;
  const hx = (turned ? b.d : b.w) / 2;
  const hz = (turned ? b.w : b.d) / 2;
  return { minX: b.x - hx, maxX: b.x + hx, minZ: b.z - hz, maxZ: b.z + hz };
}

/** The rectangle a road segment covers (width applied across its axis only). */
export function roadRect(r: RoadSegment): Rect {
  const h = r.width / 2;
  const alongX = r.az === r.bz;
  return {
    minX: Math.min(r.ax, r.bx) - (alongX ? 0 : h), maxX: Math.max(r.ax, r.bx) + (alongX ? 0 : h),
    minZ: Math.min(r.az, r.bz) - (alongX ? h : 0), maxZ: Math.max(r.az, r.bz) + (alongX ? h : 0),
  };
}

const grow = (r: Rect, m: number): Rect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
const hits = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const inside = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const union = (a: Rect, b: Rect): Rect => ({
  minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ),
});

/** Distance from a point to a road's edge (0 when the point is on the road). */
export function distanceToRoad(r: RoadSegment, x: number, z: number): number {
  const q = roadRect(r);
  return Math.hypot(Math.max(q.minX - x, 0, x - q.maxX), Math.max(q.minZ - z, 0, z - q.maxZ));
}

export function crossStreetCount(buildingCount: number): number {
  return buildingCount <= 7 ? 1 : buildingCount <= 10 ? 2 : 3;
}

function crossStreetXs(n: number, rng: Rng): number[] {
  const d1 = rng.range(26, 34);
  const d2 = rng.range(26, 34);
  if (n === 1) return [0];
  if (n === 2) return [0, rng.chance(0.5) ? d1 : -d1];
  return [-d1, 0, d2];
}

interface Arm { side: 1 | -1; dir: 1 | -1 }
interface Pt { x: number; z: number }
type Paths = SiteSpec['paths'];

/** What a pattern produces before bounds and props are added. `routes` are drawn unless paths is 'none'. */
interface Plan {
  placed: PlacedBuilding[]; boxes: Rect[]; routes: RoadSegment[];
  plaza: TownLayout['plaza']; spawn: TownLayout['spawn']; walkable: Pt[];
  trails?: Trail[]; clearings?: { x: number; z: number; r: number }[]; benches?: TownLayout['benches']; water?: WaterBody[];
}

const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const widthFor = (paths: Paths, normal: number): number => (paths === 'road' ? normal : TRACK_WIDTH);
const faceToward = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));
const rectOf = (x: number, z: number): Rect => ({ minX: x, maxX: x, minZ: z, maxZ: z });

function streetPlan(spec: WorldSpec, ordered: BuildingSpec[], o: { mainW: number; crossW: number; gap: number; setback?: number; jitter?: number; single?: boolean }): Plan {
  const { mainW, crossW, gap } = o;
  const setback = o.setback ?? SETBACK;
  const jitter = o.jitter ?? 1.5;
  const rng = makeRng(spec.seed, 'layout');
  const count = ordered.length;
  // A strung-out place (frontier, roadside) is one street and nothing else: no cross streets, every lot on the
  // main street, and the key building across the far end so the street leads the eye to it.
  const single = o.single === true;
  const nCross = single ? 0 : crossStreetCount(count);
  const crossXs = single ? [] : crossStreetXs(nCross, rng);
  const head = single && count >= 3 && ordered[0]?.keyBuilding ? ordered[0] : null;

  // While placing, streets are treated as infinite so every building keeps its setback.
  const corridors: Rect[] = [
    { minX: -FAR, maxX: FAR, minZ: -mainW / 2, maxZ: mainW / 2 },
    ...crossXs.map((cx) => ({ minX: cx - crossW / 2, maxX: cx + crossW / 2, minZ: -FAR, maxZ: FAR })),
  ].map((r) => grow(r, ROAD_MARGIN));
  const placed: PlacedBuilding[] = [];
  const boxes: Rect[] = [];
  const onStreet: number[] = []; // 0 = main street, n = cross street n-1

  const fits = (r: Rect): boolean => {
    if (corridors.some((c) => hits(r, c))) return false;
    const cx = Math.max(r.minX, Math.min(0, r.maxX));
    const cz = Math.max(r.minZ, Math.min(0, r.maxZ));
    if (Math.hypot(cx, cz) < PLAZA_RADIUS + 0.5) return false;
    const g = grow(r, gap);
    return !boxes.some((q) => hits(g, q));
  };

  const cursors = new Map<string, number>();
  const commit = (i: number, street: number, x: number, z: number, rotY: number, w: number, d: number): void => {
    const s = ordered[i];
    if (!s) return;
    const b: PlacedBuilding = {
      id: s.id, role: s.role, size: s.size, x, z, rotY, w, d,
      door: { x: x - Math.sin(rotY) * (d / 2 + 1), z: z - Math.cos(rotY) * (d / 2 + 1) },
    };
    placed.push(b);
    boxes.push(buildingAabb(b));
    onStreet.push(street);
  };

  // Walk a cursor outward along a street arm until the footprint fits.
  const slide = (key: string, extent: number, make: (c: number) => { r: Rect; x: number; z: number }): { x: number; z: number } | null => {
    let c = cursors.get(key) ?? 0;
    for (let step = 0; step < 1200; step++, c += 0.5) {
      const cand = make(c);
      if (fits(cand.r)) {
        cursors.set(key, c + extent + rng.range(0, jitter));
        return { x: cand.x, z: cand.z };
      }
    }
    return null;
  };

  const mainCount = single ? count : Math.min(count, Math.max(Math.min(count, 4), Math.ceil(count * 0.6)));
  const mainStart: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const perSide: Record<string, number> = {};
  for (let i = head ? 1 : 0; i < mainCount; i++) {
    const s = ordered[i];
    if (!s) continue;
    const { w, d } = fpFor(spec, s);
    const side = ((i % 2 === 0 ? 1 : -1) * mainStart) as 1 | -1;
    const k = perSide[side] ?? 0;
    perSide[side] = k + 1;
    const dir: 1 | -1 = k % 2 === 0 ? 1 : -1;
    const rotY = side > 0 ? 0 : Math.PI;
    // Along a single street the fronts do not line up: each lot sits a little nearer or further back.
    const z = side * (mainW / 2 + setback + (single ? rng.range(0, 1.5) : 0) + d / 2);
    const pos = slide(`m:${side}:${dir}`, w, (c) => {
      const x = dir * (c + w / 2);
      return { x, z, r: buildingAabb({ x, z, rotY, w, d }) };
    });
    if (pos) commit(i, 0, pos.x, pos.z, rotY, w, d);
  }

  const arms: Arm[][] = crossXs.map(() => rng.shuffle<Arm>([
    { side: 1, dir: 1 }, { side: -1, dir: -1 }, { side: -1, dir: 1 }, { side: 1, dir: -1 },
  ]));
  for (let i = mainCount; i < count; i++) {
    const s = ordered[i];
    if (!s) continue;
    const j = (i - mainCount) % nCross;
    const arm = arms[j]?.[Math.floor((i - mainCount) / nCross) % 4];
    const cx = crossXs[j];
    if (!arm || cx === undefined) continue;
    const { w, d } = fpFor(spec, s);
    const rotY = arm.side > 0 ? Math.PI / 2 : -Math.PI / 2;
    const x = cx + arm.side * (crossW / 2 + setback + d / 2);
    const pos = slide(`c:${j}:${arm.side}:${arm.dir}`, w, (c) => {
      const z = arm.dir * (c + w / 2);
      return { x, z, r: buildingAabb({ x, z, rotY, w, d }) };
    });
    if (pos) commit(i, j + 1, pos.x, pos.z, rotY, w, d);
  }

  // Road extents follow the buildings, with a 12 m run-out past the last one.
  let mainMin = -30;
  let mainMax = 30;
  for (const cx of crossXs) { mainMin = Math.min(mainMin, cx - 12); mainMax = Math.max(mainMax, cx + 12); }
  const crossMin = crossXs.map(() => -24);
  const crossMax = crossXs.map(() => 24);
  boxes.forEach((r, idx) => {
    const st = onStreet[idx] ?? 0;
    if (st === 0) {
      mainMin = Math.min(mainMin, r.minX - 12);
      mainMax = Math.max(mainMax, r.maxX + 12);
    } else {
      crossMin[st - 1] = Math.min(crossMin[st - 1] ?? -24, r.minZ - 12);
      crossMax[st - 1] = Math.max(crossMax[st - 1] ?? 24, r.maxZ + 12);
    }
  });
  if (head) {
    // The street stops at the landmark's door; the landmark stands square across it, facing back down the street.
    const { w, d } = fpFor(spec, head);
    const front = Math.max(20, boxes.reduce((m, r) => Math.max(m, r.maxX), 0) + Math.max(gap, 3) + 3);
    const rotY = Math.PI / 2;
    const b: PlacedBuilding = { id: head.id, role: head.role, size: head.size, x: front + d / 2, z: 0, rotY, w, d, door: { x: front - 1, z: 0 } };
    placed.unshift(b);
    boxes.unshift(buildingAabb(b));
    mainMax = front - 1;
  }
  const roads: RoadSegment[] = [{ ax: mainMin, az: 0, bx: mainMax, bz: 0, width: mainW }];
  crossXs.forEach((cx, j) => roads.push({ ax: cx, az: crossMin[j] ?? -24, bx: cx, bz: crossMax[j] ?? 24, width: crossW }));

  const plaza = { x: 0, z: 0, r: PLAZA_RADIUS };
  const spawn = { x: 12, z: 0, rotY: Math.PI / 2 };

  const walkable: Pt[] = [];
  for (let x = mainMin; x <= mainMax + 1e-6; x += 3) walkable.push({ x, z: 0 });
  crossXs.forEach((cx, j) => {
    for (let z = crossMin[j] ?? -24; z <= (crossMax[j] ?? 24) + 1e-6; z += 3) {
      if (Math.abs(z) > 1.5) walkable.push({ x: cx, z });
    }
  });
  return { placed, boxes, routes: roads, plaza, spawn, walkable };
}

// ---- Shared pieces for the non-street patterns -------------------------------------------------

interface Ctx {
  rng: Rng; gap: number; plaza: TownLayout['plaza']; corridors: Rect[];
  placed: PlacedBuilding[]; boxes: Rect[];
}

function newCtx(rng: Rng, gap: number, plazaR: number, corridors: Rect[]): Ctx {
  return { rng, gap, plaza: { x: 0, z: 0, r: plazaR }, corridors: corridors.map((r) => grow(r, ROAD_MARGIN)), placed: [], boxes: [] };
}

function ctxFits(c: Ctx, r: Rect): boolean {
  if (c.corridors.some((k) => hits(r, k))) return false;
  const nx = Math.max(r.minX, Math.min(c.plaza.x, r.maxX));
  const nz = Math.max(r.minZ, Math.min(c.plaza.z, r.maxZ));
  if (Math.hypot(nx - c.plaza.x, nz - c.plaza.z) < c.plaza.r + 0.5) return false;
  const g = grow(r, c.gap);
  return !c.boxes.some((q) => hits(g, q));
}

function ctxCommit(c: Ctx, s: BuildingSpec, x: number, z: number, rotY: number, w: number, d: number): void {
  const b: PlacedBuilding = {
    id: s.id, role: s.role, size: s.size, x, z, rotY, w, d,
    door: { x: x - Math.sin(rotY) * (d / 2 + 1), z: z - Math.cos(rotY) * (d / 2 + 1) },
  };
  c.placed.push(b);
  c.boxes.push(buildingAabb(b));
}

/** Nearest of the four axis facings (multiples of 90 degrees) to the direction from (x,z) toward (tx,tz). */
function snapRot(x: number, z: number, tx: number, tz: number): number {
  const ux = tx - x;
  const uz = tz - z;
  let best = 0;
  let bd = -Infinity;
  for (let k = 0; k < 4; k++) {
    const rot = k === 3 ? -Math.PI / 2 : (k * Math.PI) / 2;
    const dot = -Math.sin(rot) * ux - Math.cos(rot) * uz;
    if (dot > bd + 1e-9) { bd = dot; best = rot; }
  }
  return best;
}

/** Last resort so every building is placed: spiral outward from the centre until a spot is free. */
function fallbackPlace(c: Ctx, s: BuildingSpec, w: number, d: number): void {
  for (let r = 10; r < 230; r += 1.5) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2 + r * 0.37;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const rotY = snapRot(x, z, 0, 0);
      if (ctxFits(c, buildingAabb({ x, z, rotY, w, d }))) { ctxCommit(c, s, x, z, rotY, w, d); return; }
    }
  }
}

function walkAlong(r: RoadSegment, out: Pt[]): void {
  const alongX = r.az === r.bz;
  const lo = alongX ? Math.min(r.ax, r.bx) : Math.min(r.az, r.bz);
  const hi = alongX ? Math.max(r.ax, r.bx) : Math.max(r.az, r.bz);
  const at = (t: number): Pt => (alongX ? { x: t, z: r.az } : { x: r.ax, z: t });
  for (let t = lo; t < hi - 0.5; t += 3) out.push(at(t));
  out.push(at(hi));
}

function pickSpawn(plaza: TownLayout['plaza'], boxes: Rect[]): TownLayout['spawn'] {
  for (let k = 0; k < 40; k++) {
    const r = plaza.r * 0.6 + k * 0.75;
    for (let a = 0; a < 8; a++) {
      const ang = (a * Math.PI) / 4 + k * 0.2;
      const x = plaza.x + Math.cos(ang) * r;
      const z = plaza.z + Math.sin(ang) * r;
      if (boxes.some((b) => inside(grow(b, 1.5), x, z))) continue;
      return { x, z, rotY: faceToward(x, z, plaza.x, plaza.z) };
    }
  }
  return { x: plaza.x + plaza.r * 0.6, z: plaza.z, rotY: Math.PI / 2 };
}

/** One or two rings of buildings around a plaza; a square ring road and 3 or 4 spokes. */
function ringPlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number, paths: Paths): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const rw = widthFor(paths, 5);
  const sw = widthFor(paths, 4);
  const P = clampN(4.5 + n * 0.55, 7, 13); // plaza radius, scaled to the building count
  const S = P + rw / 2 + 0.5;           // half-side of the square ring road
  const h = rw / 2;
  const ring: RoadSegment[] = [
    { ax: -S - h, az: -S, bx: S + h, bz: -S, width: rw },
    { ax: -S - h, az: S, bx: S + h, bz: S, width: rw },
    { ax: -S, az: -S, bx: -S, bz: S, width: rw },
    { ax: S, az: -S, bx: S, bz: S, width: rw },
  ];
  const allDirs = rng.shuffle<[number, number]>([[1, 0], [-1, 0], [0, 1], [0, -1]]);
  const fourSpokes = !rng.chance(0.5);
  // On land the key building takes the head of the plaza: the side with no spoke is its own, and it stands
  // centred there facing the open ground, so the spoke opposite arrives looking straight at it.
  const head = spec.terrain && n >= 4 && ordered[0]?.keyBuilding ? ordered[0] : null;
  const rest = head ? ordered.slice(1) : ordered;
  const m = rest.length;
  const dirs = allDirs.slice(0, fourSpokes && !head ? 4 : 3);
  const spokeRect = ([dx, dz]: [number, number]): Rect => (dx !== 0
    ? { minX: dx > 0 ? P : -FAR, maxX: dx > 0 ? FAR : -P, minZ: -sw / 2, maxZ: sw / 2 }
    : { minX: -sw / 2, maxX: sw / 2, minZ: dz > 0 ? P : -FAR, maxZ: dz > 0 ? FAR : -P });
  // The whole square (road and the open ground inside it) is closed to buildings.
  const c = newCtx(rng, gap, P, [{ minX: -S - h, maxX: S + h, minZ: -S - h, maxZ: S + h }, ...dirs.map(spokeRect)]);

  const closed = allDirs[3];
  if (head && closed) {
    const { w, d } = fpFor(spec, head);
    const rotY = snapRot(closed[0], closed[1], 0, 0);
    for (let r = S + h + 1.5 + d / 2; r < S + 60; r += 0.5) {
      const x = closed[0] * r;
      const z = closed[1] * r;
      if (ctxFits(c, buildingAabb({ x, z, rotY, w, d }))) { ctxCommit(c, head, x, z, rotY, w, d); break; }
    }
    if (c.placed.length === 0) fallbackPlace(c, head, w, d);
  }

  const inner = m <= 8 ? m : Math.ceil(m * 0.55);
  let index = 0;
  let startR = S;
  for (let ringNo = 0; ringNo < 2 && index < m; ringNo++) {
    const k = ringNo === 0 ? inner : m - inner;
    const a0 = rng.range(0, (Math.PI * 2) / Math.max(1, k)) + (ringNo === 1 ? Math.PI / Math.max(1, k) : 0);
    const from = index;
    for (let j = 0; j < k; j++, index++) {
      const s = rest[index];
      if (!s) continue;
      const { w, d } = fpFor(spec, s);
      let best: { r: number; x: number; z: number; rotY: number } | null = null;
      for (const dTheta of [0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4, 0.55, -0.55]) {
        const th = a0 + (Math.PI * 2 * j) / k + dTheta;
        for (let r = startR; r < startR + 50 && (!best || r < best.r); r += 0.5) {
          const x = Math.cos(th) * r;
          const z = Math.sin(th) * r;
          const rotY = snapRot(x, z, 0, 0);
          if (ctxFits(c, buildingAabb({ x, z, rotY, w, d }))) { best = { r, x, z, rotY }; break; }
        }
      }
      const done = best !== null;
      if (best) ctxCommit(c, s, best.x, best.z, best.rotY, w, d);
      if (!done) fallbackPlace(c, s, w, d);
    }
    if (ringNo === 0) {
      const rs = c.placed.slice(from + (head ? 1 : 0)).map((b) => Math.hypot(b.x, b.z));
      startR = (rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : S) + 6;
    }
  }

  let extent = S + h;
  for (const r of c.boxes) extent = Math.max(extent, Math.abs(r.minX), Math.abs(r.maxX), Math.abs(r.minZ), Math.abs(r.maxZ));
  const E = extent + 10;
  const spokes: RoadSegment[] = dirs.map(([dx, dz]) => (dx !== 0
    ? { ax: dx * P, az: 0, bx: dx * E, bz: 0, width: sw }
    : { ax: 0, az: dz * P, bx: 0, bz: dz * E, width: sw }));
  const routes = [...ring, ...spokes];
  const walkable: Pt[] = [];
  for (const r of routes) walkAlong(r, walkable);
  const plaza = { x: 0, z: 0, r: P };
  return { placed: c.placed, boxes: c.boxes, routes, plaza, spawn: pickSpawn(plaza, c.boxes), walkable };
}

/** 2x2 to 3x3 city blocks; buildings line the block edges and face the streets. */
function gridPlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number, paths: Paths, jitter = 2): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const W = widthFor(paths, 6);
  const h = W / 2;
  const [nx, ny] = n <= 8 ? [2, 2] : n <= 11 ? [3, 2] : [3, 3];
  let maxD = 6;
  for (const s of ordered) maxD = Math.max(maxD, fpFor(spec, s).d);
  const B = Math.max(28, 2 * maxD + gap + 3.2 + 4);
  const pitch = B + W;
  const xs = Array.from({ length: nx + 1 }, (_, j) => (j - nx / 2) * pitch);
  const zs = Array.from({ length: ny + 1 }, (_, j) => (j - ny / 2) * pitch);
  const x0 = xs[0] ?? 0;
  const x1 = xs[nx] ?? 0;
  const z0 = zs[0] ?? 0;
  const z1 = zs[ny] ?? 0;
  const routes: RoadSegment[] = [
    ...xs.map((x) => ({ ax: x, az: z0, bx: x, bz: z1, width: W })),
    ...zs.map((z) => ({ ax: x0 - h, az: z, bx: x1 + h, bz: z, width: W })),
  ];
  const c = newCtx(rng, gap, PLAZA_RADIUS, routes.map(roadRect));

  const blocks: Rect[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      blocks.push({ minX: (xs[i] ?? 0) + h, maxX: (xs[i + 1] ?? 0) - h, minZ: (zs[j] ?? 0) + h, maxZ: (zs[j + 1] ?? 0) - h });
    }
  }
  const dist = (b: Rect): number => Math.hypot((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
  blocks.sort((a, b) => dist(a) - dist(b));
  const nb = blocks.length;
  const cursors = new Map<string, number>();
  const SET = 1.6;

  // Edge 0 south (faces -Z), 1 east (faces +X), 2 north (faces +Z), 3 west (faces -X).
  const tryEdge = (bi: number, e: number, w: number, d: number): { x: number; z: number; rotY: number } | null => {
    const b = blocks[bi];
    if (!b) return null;
    const alongX = e === 0 || e === 2;
    const len = alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
    const key = `${bi}:${e}`;
    for (let cur = cursors.get(key) ?? 0; cur <= len - w; cur += 0.5) {
      const along = (alongX ? b.minX : b.minZ) + cur + w / 2;
      let x = 0;
      let z = 0;
      let rotY = 0;
      if (e === 0) { x = along; z = b.minZ + SET + d / 2; rotY = 0; }
      else if (e === 2) { x = along; z = b.maxZ - SET - d / 2; rotY = Math.PI; }
      else if (e === 3) { z = along; x = b.minX + SET + d / 2; rotY = Math.PI / 2; }
      else { z = along; x = b.maxX - SET - d / 2; rotY = -Math.PI / 2; }
      if (ctxFits(c, buildingAabb({ x, z, rotY, w, d }))) {
        cursors.set(key, cur + w + rng.range(0, jitter));
        return { x, z, rotY };
      }
    }
    return null;
  };

  ordered.forEach((s, i) => {
    const { w, d } = fpFor(spec, s);
    const e0 = (Math.floor(i / nb) + rng.int(0, 3)) % 4;
    for (let off = 0; off < nb; off++) {
      for (let k = 0; k < 4; k++) {
        const pos = tryEdge((i + off) % nb, (e0 + k) % 4, w, d);
        if (pos) { ctxCommit(c, s, pos.x, pos.z, pos.rotY, w, d); return; }
      }
    }
    fallbackPlace(c, s, w, d);
  });

  const walkable: Pt[] = [];
  for (const r of routes) walkAlong(r, walkable);
  const plaza = { x: 0, z: 0, r: PLAZA_RADIUS };
  return { placed: c.placed, boxes: c.boxes, routes, plaza, spawn: pickSpawn(plaza, c.boxes), walkable };
}

/** 2 or 3 parallel rows behind one front road, all facing the same way, each row served by a lane. */
function terracePlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number, paths: Paths, jitter = 1.5): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const mainW = widthFor(paths, 8);
  const laneW = widthFor(paths, 3.5);
  const rowsN = n <= 8 ? 2 : 3;
  const sizes = rowsN === 2 ? [Math.ceil(n * 0.55), 0] : [Math.ceil(n * 0.4), Math.ceil(n * 0.33), 0];
  sizes[rowsN - 1] = n - sizes.slice(0, rowsN - 1).reduce((a, b) => a + b, 0);
  const rows: BuildingSpec[][] = [];
  let at = 0;
  for (const sz of sizes) { rows.push(ordered.slice(at, at + sz)); at += sz; }
  const depth = rows.map((r) => r.reduce((m, s) => Math.max(m, fpFor(spec, s).d), 0));
  const base: number[] = [mainW / 2 + 1.6];
  for (let k = 1; k < rowsN; k++) base.push((base[k - 1] ?? 0) + (depth[k - 1] ?? 0) + laneW + 3.2);
  const laneZ = base.map((b, k) => (k === 0 ? 0 : b - 1.6 - laneW / 2));

  const corridors: Rect[] = [
    { minX: -FAR, maxX: FAR, minZ: -mainW / 2, maxZ: mainW / 2 },
    ...laneZ.slice(1).map((z) => ({ minX: -FAR, maxX: FAR, minZ: z - laneW / 2, maxZ: z + laneW / 2 })),
  ];
  const c = newCtx(rng, gap, 5, corridors);
  const cursors = new Map<string, number>();
  rows.forEach((row, k) => {
    row.forEach((s, j) => {
      const { w, d } = fpFor(spec, s);
      const dir: 1 | -1 = j % 2 === 0 ? 1 : -1;
      const z = (base[k] ?? 0) + d / 2;
      const key = `${k}:${dir}`;
      let cur = cursors.get(key) ?? k * 3; // each row steps in from the one before
      for (let step = 0; step < 1200; step++, cur += 0.5) {
        const x = dir * (cur + w / 2);
        if (ctxFits(c, buildingAabb({ x, z, rotY: 0, w, d }))) {
          ctxCommit(c, s, x, z, 0, w, d);
          cursors.set(key, cur + w + rng.range(0, jitter));
          return;
        }
      }
      fallbackPlace(c, s, w, d);
    });
  });

  let minX = -20;
  let maxX = 20;
  for (const r of c.boxes) { minX = Math.min(minX, r.minX); maxX = Math.max(maxX, r.maxX); }
  const cx = maxX + 6;
  const routes: RoadSegment[] = [{ ax: minX - 12, az: 0, bx: cx + laneW / 2, bz: 0, width: mainW }];
  for (let k = 1; k < rowsN; k++) routes.push({ ax: minX - 6, az: laneZ[k] ?? 0, bx: cx + laneW / 2, bz: laneZ[k] ?? 0, width: laneW });
  routes.push({ ax: cx, az: 0, bx: cx, bz: laneZ[rowsN - 1] ?? 0, width: laneW });
  const walkable: Pt[] = [];
  for (const r of routes) walkAlong(r, walkable);
  const plaza = { x: 0, z: 0, r: 5 };
  return { placed: c.placed, boxes: c.boxes, routes, plaza, spawn: pickSpawn(plaza, c.boxes), walkable };
}

/** An axis-aligned winding track from a door to the centre, steering clear of every footprint. */
function trackFor(from: PlacedBuilding, boxes: Rect[], width: number, rng: Rng): RoadSegment[] {
  const fx = Math.round(-Math.sin(from.rotY));
  const fz = Math.round(-Math.cos(from.rotY));
  const alongX = fx !== 0;
  const D = from.door;
  const clear = (segs: RoadSegment[]): boolean => {
    const rects = segs.map((s) => grow(roadRect(s), 0.4));
    return !boxes.some((b) => rects.some((r) => hits(r, b)));
  };
  // Segments from waypoints; interior joints are extended by half a width so corners fill in.
  const build = (pts: Pt[]): RoadSegment[] => {
    const segs: RoadSegment[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as Pt;
      const b = pts[i + 1] as Pt;
      const horiz = Math.abs(b.z - a.z) < 1e-9;
      const len = horiz ? b.x - a.x : b.z - a.z;
      if (Math.abs(len) < 0.5) continue;
      const sgn = Math.sign(len);
      const e0 = i > 0 ? (width / 2) * sgn : 0;
      const e1 = i + 2 < pts.length ? (width / 2) * sgn : 0;
      segs.push(horiz
        ? { ax: a.x - e0, az: a.z, bx: b.x + e1, bz: a.z, width }
        : { ax: a.x, az: a.z - e0, bx: a.x, bz: b.z + e1, width });
    }
    return segs;
  };
  // a = the facing axis, b = the other; `pt` puts them back into x/z so one recipe serves both axes.
  const pt = (a: number, b: number): Pt => (alongX ? { x: a, z: b } : { x: b, z: a });
  const pa = (p: Pt): number => (alongX ? p.x : p.z);
  const pb = (p: Pt): number => (alongX ? p.z : p.x);
  // After the usual tries the search widens (a longer first leg, a crossing leg beyond either end), so a track
  // in a widely spaced place still reaches the centre instead of stopping short outside its door.
  for (let t = 0; t < 96; t++) {
    const wide = t >= 36;
    const L1 = rng.range(2, wide ? 6 + (t - 36) * 0.5 : 6);
    const p1: Pt = { x: D.x + fx * L1, z: D.z + fz * L1 };
    const variant = wide ? 1 + (t % 2) : t % 3;
    let pts: Pt[];
    if (variant === 0) {
      const direct = alongX ? -D.x * fx : -D.z * fz; // distance along the facing axis to the centre line
      if (direct < 2) continue;
      pts = [D, pt(0, pb(D)), { x: 0, z: 0 }];
    } else if (variant === 1) {
      pts = [D, p1, pt(pa(p1), 0), { x: 0, z: 0 }];
    } else {
      const bm = wide ? rng.range(-1, 1) * (2 + (t - 36) * 0.4) : pb(p1) * rng.range(0.3, 0.7);
      pts = [D, p1, pt(pa(p1), bm), pt(0, bm), { x: 0, z: 0 }];
    }
    const segs = build(pts);
    if (segs.length >= 2 && segs.length <= 4 && clear(segs)) return segs;
  }
  // No simple dog-leg is free: search a 1 m grid for the route to the centre with the fewest corners. The
  // track is drawn narrow here, since what blocked the simple routes is usually a tight gap.
  const narrow = Math.min(width, TRACK_WIDTH);
  const found = fewestCorners(D, fx, fz, boxes, narrow);
  if (found) {
    const segs: RoadSegment[] = [];
    for (let i = 0; i + 1 < found.length; i++) {
      const a = found[i] as Pt;
      const b = found[i + 1] as Pt;
      const horiz = Math.abs(b.z - a.z) < 1e-6;
      const sgn = Math.sign(horiz ? b.x - a.x : b.z - a.z);
      const e0 = i > 0 ? (narrow / 2) * sgn : 0;
      const e1 = (narrow / 2) * sgn;
      segs.push(horiz ? { ax: a.x - e0, az: a.z, bx: b.x + e1, bz: a.z, width: narrow } : { ax: a.x, az: a.z - e0, bx: a.x, bz: b.z + e1, width: narrow });
    }
    return segs;
  }
  return build([D, { x: D.x + fx * 3, z: D.z + fz * 3 }]);
}

/**
 * Corner points of an axis-aligned route from a door to the middle of the place that keeps `width` clear of
 * every footprint, with as few corners as can be had; null when the door is boxed in. Works on a 1 m grid
 * hung off the door, so the route ends within half a metre of the centre rather than exactly on it.
 */
function fewestCorners(D: Pt, fx: number, fz: number, boxes: readonly Rect[], width: number): Pt[] | null {
  const grown = boxes.map((r) => grow(r, width / 2 + 0.4));
  let area = union(rectOf(D.x, D.z), rectOf(0, 0));
  for (const r of boxes) area = union(area, r);
  area = grow(area, 8);
  const i0 = Math.floor(area.minX - D.x);
  const j0 = Math.floor(area.minZ - D.z);
  const W = Math.ceil(area.maxX - D.x) - i0 + 1;
  const H = Math.ceil(area.maxZ - D.z) - j0 + 1;
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) {
      const x = D.x + i0 + i;
      const z = D.z + j0 + j;
      if (!grown.some((r) => inside(r, x, z))) open[i * H + j] = 1;
    }
  }
  const at = (i: number, j: number): number => (i - i0) * H + (j - j0);
  const start = at(fx * 2, fz * 2); // two steps out of the door, clear of the building's own walls
  const goal = at(Math.round(-D.x), Math.round(-D.z));
  if (!open[start] || !open[goal]) return null;
  // Breadth-first by straight runs: everything reached in one run from a cell has one corner more than it.
  const prev = new Int32Array(W * H).fill(-2);
  prev[start] = -1;
  const queue = [start];
  for (let q = 0; q < queue.length && prev[goal] === -2; q++) {
    const cur = queue[q] as number;
    const ci = Math.floor(cur / H);
    const cj = cur % H;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let i = ci + di, j = cj + dj; i >= 0 && i < W && j >= 0 && j < H && open[i * H + j]; i += di, j += dj) {
        const k = i * H + j;
        if (prev[k] === -2) { prev[k] = cur; queue.push(k); }
      }
    }
  }
  if (prev[goal] === -2) return null;
  const pts: Pt[] = [];
  for (let k = goal; k >= 0; k = prev[k] as number) pts.push({ x: D.x + i0 + Math.floor(k / H), z: D.z + j0 + (k % H) });
  pts.push({ x: D.x, z: D.z });
  pts.reverse();
  // Drop the points that lie on a straight run (the first leg out of the door often continues straight on).
  return pts.filter((p, i) => {
    const a = pts[i - 1];
    const b = pts[i + 1];
    if (!a || !b) return true;
    return !((Math.abs(a.x - p.x) < 1e-6 && Math.abs(b.x - p.x) < 1e-6) || (Math.abs(a.z - p.z) < 1e-6 && Math.abs(b.z - p.z) < 1e-6));
  });
}

/** A camp, grove or village: no street grid, buildings dart-thrown with per-pair spacing, tracks to the centre. */
function scatterPlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number, paths: Paths): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const plazaR = clampN(3.5 + n * 0.15, 4, 6);
  const c = newCtx(rng, gap, plazaR, []);
  // A settled scatter is a village round its green: every door looks onto the green. A thin one is a camp or
  // compound, where some turn to a neighbour instead.
  const village = !!spec.terrain && clampN(finiteOr(spec.terrain.settled, 0.7), 0, 1) >= 0.5;
  const diag: number[] = [];
  // Two centres stay at least half of each diagonal apart plus the spacing, so footprints never come closer than the spacing.
  for (const s of ordered) {
    const { w, d } = fpFor(spec, s);
    const dg = Math.hypot(w, d);
    const rMin = plazaR + dg / 2 + 1.5;
    let R = rMin + 6;
    let done = false;
    for (let attempt = 0; attempt < 600 && !done; attempt++) {
      if (attempt % 10 === 9) R += 2.5;
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(rMin, R);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (c.placed.some((b, i) => Math.hypot(b.x - x, b.z - z) < ((diag[i] ?? 0) + dg) / 2 + gap)) continue;
      let tx = 0;
      let tz = 0;
      if (!village && c.placed.length > 0 && rng.chance(0.45)) {
        const near = [...c.placed].sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z)).slice(0, 3);
        const t = rng.pick(near);
        tx = t.x;
        tz = t.z;
      }
      ctxCommit(c, s, x, z, snapRot(x, z, tx, tz), w, d);
      diag.push(dg);
      done = true;
    }
    if (!done) {
      const before = c.placed.length;
      fallbackPlace(c, s, w, d);
      if (c.placed.length > before) diag.push(dg);
    }
  }

  const width = widthFor(paths, 3.4);
  const routes: RoadSegment[] = [];
  const order = [...c.placed].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  for (const b of order) routes.push(...trackFor(b, c.boxes, width, rng));
  const walkable: Pt[] = [];
  for (const r of routes) walkAlong(r, walkable);
  const plaza = { x: 0, z: 0, r: plazaR };
  return { placed: c.placed, boxes: c.boxes, routes, plaza, spawn: pickSpawn(plaza, c.boxes), walkable };
}

// ---- Trails and wilderness patterns ------------------------------------------------------------

const WILD_PATTERNS: readonly SitePattern[] = ['wild', 'path', 'shoreline', 'cliffside'];

/** Distance from a point to the centre line of a polyline. */
export function distanceToPolyline(pts: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as Pt;
    const b = pts[i + 1] as Pt;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clampN(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1) : 0;
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < best) best = d;
  }
  if (pts.length === 1) best = Math.hypot(x - (pts[0] as Pt).x, z - (pts[0] as Pt).z);
  return best;
}

const rectDistance = (r: Rect, x: number, z: number): number => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));

/** Moves a point that lies inside a rectangle to its nearest edge. */
function pushOut(p: Pt, r: Rect): void {
  if (!inside(r, p.x, p.z)) return;
  const dl = p.x - r.minX;
  const dr = r.maxX - p.x;
  const dn = p.z - r.minZ;
  const df = r.maxZ - p.z;
  const m = Math.min(dl, dr, dn, df);
  if (m === dl) p.x = r.minX; else if (m === dr) p.x = r.maxX; else if (m === dn) p.z = r.minZ; else p.z = r.maxZ;
}

/** A footpath from a to b that wanders off the straight line and bends round every footprint. */
function windingTrail(a: Pt, b: Pt, rng: Rng, boxes: readonly Rect[], width: number, kind: Trail['kind'] = 'trail'): Trail {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(2, Math.ceil(len / 2));
  const px = len > 0 ? -(b.z - a.z) / len : 0;
  const pz = len > 0 ? (b.x - a.x) / len : 0;
  const amp = Math.min(7, len * 0.16);
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const k1 = rng.range(0.8, 1.6);
  const k2 = rng.range(2.2, 3.4);
  const grown = boxes.map((r) => grow(r, width / 2 + 1.2));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = amp * Math.sin(Math.PI * t) * (0.7 * Math.sin(k1 * Math.PI * 2 * t + p1) + 0.3 * Math.sin(k2 * Math.PI * 2 * t + p2));
    const p = { x: a.x + (b.x - a.x) * t + px * off, z: a.z + (b.z - a.z) * t + pz * off };
    if (i > 0 && i < n) for (const r of grown) pushOut(p, r);
    pts.push(p);
  }
  return { pts, width, kind };
}

function trailWalkable(trails: readonly Trail[], extra: readonly Pt[]): Pt[] {
  const out: Pt[] = [...extra];
  for (const t of trails) {
    let run = 3;
    for (let i = 0; i < t.pts.length; i++) {
      const p = t.pts[i] as Pt;
      const q = t.pts[i - 1];
      if (q) run += Math.hypot(p.x - q.x, p.z - q.z);
      if (run >= 3 || i === t.pts.length - 1) { out.push({ x: p.x, z: p.z }); run = 0; }
    }
  }
  return out;
}

/** The trail point nearest to p. */
function nearestOn(trail: Trail, p: Pt): Pt {
  let best = trail.pts[0] as Pt;
  let bd = Infinity;
  for (const q of trail.pts) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** Untouched land: points of interest far apart, each reached by a faint trail from the clearing or from a neighbour. */
function wildPlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const c = newCtx(rng, gap, 0, []);
  const sep = clampN(34 - n * 1.5, 16, 30);
  const centres: Pt[] = [];
  for (const s of ordered) {
    const { w, d } = fpFor(spec, s);
    const dg = Math.hypot(w, d) / 2;
    let R = 26 + n * 5;
    let done = false;
    for (let attempt = 0; attempt < 400 && !done; attempt++) {
      if (attempt % 12 === 11) R += 6;
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(16, R);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (centres.some((p) => Math.hypot(p.x - x, p.z - z) < sep + dg)) continue;
      const rotY = snapRot(x, z, 0, 0);
      if (!ctxFits(c, buildingAabb({ x, z, rotY, w, d }))) continue;
      ctxCommit(c, s, x, z, rotY, w, d);
      centres.push({ x, z });
      done = true;
    }
    if (!done) {
      const before = c.placed.length;
      fallbackPlace(c, s, w, d);
      const b = c.placed[c.placed.length - 1];
      if (b && c.placed.length > before) centres.push({ x: b.x, z: b.z });
    }
  }
  const width = 1.4;
  const trails: Trail[] = [];
  const nodes: Pt[] = [{ x: 0, z: 0 }];
  const order = [...c.placed].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  for (const b of order) {
    let to = nodes[0] as Pt;
    for (const q of nodes) if (Math.hypot(q.x - b.door.x, q.z - b.door.z) < Math.hypot(to.x - b.door.x, to.z - b.door.z)) to = q;
    trails.push(windingTrail(b.door, to, rng, c.boxes, width));
    nodes.push(b.door);
  }
  // Game trails that lead out of the clearing and peter out among the trees.
  const strays = n === 0 ? 3 : rng.int(1, 2);
  const a0 = rng.range(0, Math.PI * 2);
  for (let k = 0; k < strays; k++) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const ang = a0 + (k / strays) * Math.PI * 2 + rng.range(-0.5, 0.5);
      const len = rng.range(28, 46);
      const end = { x: Math.cos(ang) * len, z: Math.sin(ang) * len };
      if (c.boxes.some((r) => inside(grow(r, 3), end.x, end.z))) continue;
      trails.push(windingTrail({ x: 0, z: 0 }, end, rng, c.boxes, width));
      break;
    }
  }
  const first = trails[trails.length - 1]?.pts;
  const look = first ? first[Math.min(3, first.length - 1)] : undefined;
  const spawn = { x: 0, z: 0, rotY: look ? faceToward(0, 0, look.x, look.z) : 0 };
  return {
    placed: c.placed, boxes: c.boxes, routes: [], plaza: { x: 0, z: 0, r: 0 }, spawn, trails,
    walkable: trailWalkable(trails, [{ x: 0, z: 0 }]), clearings: [{ x: 0, z: 0, r: 5 }],
  };
}

/** One winding trail through the land with the points of interest strung along it. */
function pathPlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number, paths: Paths): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const width = paths === 'road' ? 3 : TRACK_WIDTH;
  const stride = clampN(11 + gap, 13, 26);
  const half = (56 + n * stride) / 2;
  const a1 = rng.range(7, 12);
  const l1 = rng.range(10, 14);
  const p1 = rng.range(0, Math.PI * 2);
  const a2 = rng.range(2, 3.5);
  const l2 = rng.range(4.5, 6.5);
  const p2 = rng.range(0, Math.PI * 2);
  const zAt = (x: number): number => a1 * Math.sin(x / l1 + p1) + a2 * Math.sin(x / l2 + p2);
  const main: Trail = { pts: [], width, kind: 'path' };
  for (let x = -half - 12; x <= half + 12 + 1e-6; x += 2) main.pts.push({ x, z: zAt(x) });
  const c = newCtx(rng, Math.min(gap, 4), 0, []);
  c.plaza = { x: 0, z: zAt(0), r: 0 };
  const trails: Trail[] = [main];
  ordered.forEach((s, i) => {
    const { w, d } = fpFor(spec, s);
    const x0 = -half + ((i + 0.5) * 2 * half) / n + rng.range(-2, 2);
    const side = (i % 2 === 0 ? 1 : -1) * (rng.chance(0.85) ? 1 : -1);
    const t = { x: x0, z: zAt(x0) };
    const slope = zAt(x0 + 0.5) - zAt(x0 - 0.5);
    const nl = Math.hypot(slope, 1);
    const nx = (-slope / nl) * side;
    const nz = (1 / nl) * side;
    const before = c.placed.length;
    for (let off = width / 2 + 2.5 + Math.min(w, d) / 2; off < 40 && c.placed.length === before; off += 1) {
      const x = t.x + nx * off;
      const z = t.z + nz * off;
      const rotY = snapRot(x, z, t.x, t.z);
      const r = buildingAabb({ x, z, rotY, w, d });
      if (main.pts.some((q) => rectDistance(r, q.x, q.z) < width / 2 + 1.6)) continue;
      if (ctxFits(c, r)) ctxCommit(c, s, x, z, rotY, w, d);
    }
    if (c.placed.length === before) fallbackPlace(c, s, w, d);
  });
  for (const b of c.placed) {
    const to = nearestOn(main, b.door);
    if (Math.hypot(to.x - b.door.x, to.z - b.door.z) > 1.2) trails.push(windingTrail(b.door, to, rng, c.boxes, 1.4));
  }
  const sp = nearestOn(main, { x: -half * 0.8, z: zAt(-half * 0.8) });
  const ahead = { x: sp.x + 4, z: zAt(sp.x + 4) };
  return {
    placed: c.placed, boxes: c.boxes, routes: [], plaza: c.plaza, spawn: { x: sp.x, z: sp.z, rotY: faceToward(sp.x, sp.z, ahead.x, ahead.z) },
    trails, walkable: trailWalkable(trails, []), clearings: [{ x: sp.x, z: sp.z, r: 4 }],
  };
}

const wobble = (t: number, phase: number): number => 0.5 * Math.sin(t + phase) + 0.3 * Math.sin(t * 2.3 + phase * 1.7) + 0.2 * Math.sin(t * 4.1 + phase * 2.9);

/** Points of interest in one or two rows along a waterline, all facing the water, with a beach trail past their doors. */
function shorelinePlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const sign: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const phase = rng.range(0, Math.PI * 2);
  const W = 16; // the waterline, metres along the shore normal from the origin
  const trailV = (x: number): number => W - 5.5 + 1.1 * Math.sin(x / 9 + phase);
  const c = newCtx(rng, gap, 0, []);
  const rotY = sign > 0 ? Math.PI : 0;
  const front = n > 6 ? Math.ceil(n * 0.6) : n;
  const cursors = [0, 0, 0, 0];
  let depth0 = 0;
  for (let i = 0; i < front; i++) depth0 = Math.max(depth0, fpFor(spec, ordered[i] as BuildingSpec).d);
  ordered.forEach((s, i) => {
    const { w, d } = fpFor(spec, s);
    const row = i < front ? 0 : 1;
    const dir = i % 2 === 0 ? 1 : -1;
    const slot = row * 2 + (dir > 0 ? 0 : 1);
    const v = row === 0 ? W - 5.5 - 3.4 - d / 2 - rng.range(0, 2.5) : W - 5.5 - 3.4 - depth0 - Math.max(6, gap) - d / 2 - rng.range(0, 3);
    let cur = (cursors[slot] ?? 0) + (row === 1 ? 4 : 0);
    const before = c.placed.length;
    for (let step = 0; step < 800 && c.placed.length === before; step++, cur += 0.5) {
      const x = dir * (cur + w / 2 + (row === 0 ? 2.5 : 0));
      if (ctxFits(c, buildingAabb({ x, z: v * sign, rotY, w, d }))) {
        ctxCommit(c, s, x, v * sign, rotY, w, d);
        cursors[slot] = cur + w + gap * rng.range(0.6, 1.2);
      }
    }
    if (c.placed.length === before) fallbackPlace(c, s, w, d);
  });
  let minX = -24;
  let maxX = 24;
  for (const r of c.boxes) { minX = Math.min(minX, r.minX - 14); maxX = Math.max(maxX, r.maxX + 14); }
  const beach: Trail = { pts: [], width: 1.8, kind: 'trail' };
  for (let x = minX; x <= maxX + 1e-6; x += 2) beach.pts.push({ x, z: trailV(x) * sign });
  const trails: Trail[] = [beach];
  for (const b of c.placed) {
    const to = nearestOn(beach, b.door);
    if (Math.hypot(to.x - b.door.x, to.z - b.door.z) > 1.2) trails.push(windingTrail(b.door, to, rng, c.boxes, 1.4));
  }
  const sp = nearestOn(beach, { x: 0, z: trailV(0) * sign });
  const kind: WaterBody['kind'] = spec.terrain && spec.terrain.water !== 'none' ? spec.terrain.water : 'shore';
  const water: WaterBody = { kind, area: { shape: 'half', nx: 0, nz: sign, offset: W, wobble: 2.2, phase }, x: 0, z: (W + 20) * sign, r: 40 };
  return {
    placed: c.placed, boxes: c.boxes, routes: [], plaza: { x: sp.x, z: sp.z, r: 0 }, spawn: { x: sp.x, z: sp.z, rotY: Math.PI / 2 },
    trails, walkable: trailWalkable(trails, []), clearings: [{ x: sp.x, z: sp.z, r: 3 }], water: [water],
  };
}

/** Rows on level benches stepping up a rise, each with a lane along its front; hairpin trails climb from bench to bench. */
function cliffsidePlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const rowsN = n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows: BuildingSpec[][] = Array.from({ length: rowsN }, () => []);
  ordered.forEach((s, i) => (rows[i % rowsN] as BuildingSpec[]).push(s));
  const depth = rows.map((r) => r.reduce((m, s) => Math.max(m, fpFor(spec, s).d), 6));
  const base: number[] = [4];
  for (let k = 1; k < rowsN; k++) base.push((base[k - 1] ?? 0) + (depth[k - 1] ?? 0) + 9);
  const lane = base.map((b) => b - 2.4);
  const c = newCtx(rng, gap, 0, lane.map((z) => ({ minX: -FAR, maxX: FAR, minZ: z - 0.7, maxZ: z + 0.7 })));
  c.plaza = { x: 0, z: lane[0] ?? 0, r: 0 };
  rows.forEach((row, k) => {
    const cursors = [k * 2.5, k * 2.5 + 3];
    row.forEach((s, j) => {
      const { w, d } = fpFor(spec, s);
      const dir = j % 2 === 0 ? 1 : -1;
      const z = (base[k] ?? 0) + d / 2;
      let cur = cursors[dir > 0 ? 0 : 1] ?? 0;
      const before = c.placed.length;
      for (let step = 0; step < 800 && c.placed.length === before; step++, cur += 0.5) {
        const x = dir * (cur + w / 2);
        if (ctxFits(c, buildingAabb({ x, z, rotY: 0, w, d }))) {
          ctxCommit(c, s, x, z, 0, w, d);
          cursors[dir > 0 ? 0 : 1] = cur + w + gap * rng.range(0.5, 1.1);
        }
      }
      if (c.placed.length === before) fallbackPlace(c, s, w, d);
    });
  });
  let minX = -18;
  let maxX = 18;
  for (const r of c.boxes) { minX = Math.min(minX, r.minX - 8); maxX = Math.max(maxX, r.maxX + 8); }
  const trails: Trail[] = [];
  for (const z of lane) {
    const t: Trail = { pts: [], width: 2, kind: 'path' };
    const steps = Math.max(1, Math.ceil((maxX - minX) / 2));
    for (let i = 0; i <= steps; i++) t.pts.push({ x: minX + ((maxX - minX) * i) / steps, z });
    trails.push(t);
  }
  for (let k = 0; k + 1 < rowsN; k++) {
    const dir = k % 2 === 0 ? 1 : -1;
    const e = dir > 0 ? maxX : minX;
    const z0 = lane[k] ?? 0;
    const z1 = lane[k + 1] ?? 0;
    const t: Trail = { pts: [], width: 1.8, kind: 'path' };
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      t.pts.push({ x: e + dir * 18 * Math.sin(Math.PI * u), z: z0 + ((z1 - z0) * (1 - Math.cos(Math.PI * u))) / 2 });
    }
    trails.push(t);
  }
  const steps = base.map((b, k) => ({ s0: (lane[k] ?? 0) - 2.6, s1: b + (depth[k] ?? 0) + 1.6, level: k }));
  const sp = { x: 0, z: lane[0] ?? 0 };
  return {
    placed: c.placed, boxes: c.boxes, routes: [], plaza: c.plaza, spawn: { x: sp.x, z: sp.z, rotY: Math.PI / 2 },
    trails, walkable: trailWalkable(trails, []), clearings: [{ x: sp.x, z: sp.z, r: 3 }], benches: { nx: 0, nz: 1, steps },
  };
}

// ---- Water -------------------------------------------------------------------------------------

/**
 * How far inside a water body a point lies, metres: positive in the water, negative on land, 0 at the edge.
 * A sheet has no edge of its own (the land decides where it shows), so it reports +Infinity everywhere.
 */
export function waterInside(body: WaterBody, x: number, z: number): number {
  const a = body.area;
  switch (a.shape) {
    case 'disc': {
      const dx = x - a.x;
      const dz = z - a.z;
      return a.r * (1 + a.wobble * wobble(Math.atan2(dz, dx) * 2, a.phase)) - Math.hypot(dx, dz);
    }
    case 'band': return a.half - distanceToPolyline(a.pts, x, z);
    case 'half': return x * a.nx + z * a.nz - a.offset - a.wobble * wobble((x * a.nz - z * a.nx) / 7, a.phase);
    case 'outside': return rectDistance(a.rect, x, z) - a.margin;
    default: return Number.POSITIVE_INFINITY;
  }
}

/** Where the water goes: beside or among what was placed, never under it. Deterministic from the seed. */
function planWater(spec: WorldSpec, terrain: TerrainSpec, wilderness: boolean, plan: Plan, bounds: Rect): WaterBody[] {
  const sheet = terrain.relief === 'swamp' || terrain.relief === 'islands';
  if (terrain.water === 'none' && !sheet) return [];
  const rng = makeRng(spec.seed, 'water');
  const amount = clampN(finiteOr(terrain.waterAmount, 0.3), 0, 1);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const reach = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
  const kind: WaterBody['kind'] = terrain.water === 'none' ? 'pond' : terrain.water;
  if (sheet) return [{ kind, area: { shape: 'sheet' }, x: cx, z: cz, r: reach }];
  if (kind === 'mist_sea') return [{ kind, area: { shape: 'outside', rect: { ...bounds }, margin: 3 }, x: cx, z: cz, r: reach + 60 }];

  // What the water must stay off, as points with a radius.
  const keep: { x: number; z: number; r: number }[] = [{ x: plan.spawn.x, z: plan.spawn.z, r: 5 }, { x: plan.plaza.x, z: plan.plaza.z, r: plan.plaza.r + 3 }];
  for (const b of plan.boxes) {
    const hx = (b.maxX - b.minX) / 2;
    const hz = (b.maxZ - b.minZ) / 2;
    keep.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, r: Math.hypot(hx, hz) + 4 });
  }
  for (const b of plan.placed) keep.push({ x: b.door.x, z: b.door.z, r: 4 });
  const support = (nx: number, nz: number): number => keep.reduce((m, k) => Math.max(m, k.x * nx + k.z * nz + k.r), -Infinity);

  if (kind === 'shore') {
    const [nx, nz] = rng.pick<[number, number]>([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    let far = support(nx, nz);
    for (const t of plan.trails ?? []) for (const p of t.pts) far = Math.max(far, p.x * nx + p.z * nz + 2);
    const offset = far + 12 - 7 * amount;
    return [{ kind, area: { shape: 'half', nx, nz, offset, wobble: 2.5, phase: rng.range(0, 6.28) }, x: nx * (offset + 25), z: nz * (offset + 25), r: 45 }];
  }

  const banded = kind === 'river' || ((kind === 'lava' || kind === 'acid') && (terrain.relief === 'canyon' || terrain.relief === 'craggy'));
  if (banded) {
    const half = 2.5 + 6.5 * amount;
    const meander = 5;
    // A canyon's river keeps to the canyon floor, which runs along the longer side of the place.
    const along = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ ? 0 : Math.PI / 2;
    let best: { th: number; off: number } | null = null;
    if (wilderness) {
      for (let attempt = 0; attempt < 60 && !best; attempt++) {
        const th = terrain.relief === 'canyon' ? along + rng.range(-0.12, 0.12) : rng.range(0, Math.PI);
        const off = rng.range(-0.3, 0.3) * reach;
        const nx = -Math.sin(th);
        const nz = Math.cos(th);
        if (keep.every((k) => Math.abs((k.x - cx) * nx + (k.z - cz) * nz - off) > k.r + half + meander + 2)) best = { th, off };
      }
    }
    if (!best) {
      const th = terrain.relief === 'canyon' ? along : rng.range(0, Math.PI);
      const nx = -Math.sin(th);
      const nz = Math.cos(th);
      best = { th, off: support(nx, nz) - (cx * nx + cz * nz) + half + meander + 3 };
    }
    const ux = Math.cos(best.th);
    const uz = Math.sin(best.th);
    const nx = -uz;
    const nz = ux;
    const ph = rng.range(0, 6.28);
    const run = reach + 260;
    const pts: Pt[] = [];
    for (let t = -run; t <= run; t += 6) {
      const lat = best.off + meander * (0.7 * Math.sin(t / 31 + ph) + 0.3 * Math.sin(t / 13 + ph * 2));
      pts.push({ x: cx + ux * t + nx * lat, z: cz + uz * t + nz * lat });
    }
    return [{ kind, area: { shape: 'band', pts, half }, x: cx + nx * best.off, z: cz + nz * best.off, r: half }];
  }

  const count = kind === 'pond' || kind === 'lava' || kind === 'acid' ? 1 + Math.round(amount * 2) : 1;
  const radius = (): number => (kind === 'pond' ? 4 + 8 * amount : kind === 'lake' ? 14 + 28 * amount : kind === 'ice_sheet' ? 16 + 32 * amount : 5 + 11 * amount) * rng.range(0.85, 1.15);
  const out: WaterBody[] = [];
  const trailPts: Pt[] = [];
  for (const t of plan.trails ?? []) for (const p of t.pts) trailPts.push(p);
  for (let k = 0; k < count; k++) {
    const r = radius();
    let spot: Pt | null = null;
    for (let attempt = 0; attempt < 240 && !spot; attempt++) {
      // Later attempts look further out, so a crowded place still gets its water at the edge.
      const grown = grow(bounds, Math.max(0, attempt - 120) * 0.4 - Math.min(r, 12) * 0.5);
      const x = rng.range(grown.minX, grown.maxX);
      const z = rng.range(grown.minZ, grown.maxZ);
      if (keep.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r * 1.25 + 3)) continue;
      if (plan.routes.some((rd) => distanceToRoad(rd, x, z) < r * 1.25 + 2)) continue;
      if (trailPts.some((q) => Math.hypot(q.x - x, q.z - z) < r * 1.25 + 2.5)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 6)) continue;
      spot = { x, z };
    }
    if (!spot) continue;
    out.push({ kind, area: { shape: 'disc', x: spot.x, z: spot.z, r, wobble: 0.2, phase: rng.range(0, 6.28) }, x: spot.x, z: spot.z, r });
  }
  return out;
}

interface Site { pattern: SitePattern; wild: number; paths: Paths; gap: number; setback: number; jitter: number; settled?: number }

/**
 * Lot spacing from the site and, when the world carries terrain, from how settled it is: above 0.8 walls
 * close in (1.5 to 3 m between neighbours, shallow setbacks); below 0.3 structures stand well apart.
 * A jitter below zero means "as the pattern always did".
 */
function normaliseSite(site: SiteSpec, terrain?: TerrainSpec): Site {
  const patterns: SitePattern[] = ['street', 'ring', 'scatter', 'grid', 'terraces', ...WILD_PATTERNS];
  const pattern = patterns.includes(site.pattern) ? site.pattern : 'street';
  const paths: Paths = site.paths === 'track' || site.paths === 'none' ? site.paths : 'road';
  const wild = clampN(finiteOr(site.wild, 0.3), 0, 1);
  const spacing = clampN(finiteOr(site.spacing, 6), 3, 14);
  if (!terrain) return { pattern, wild, paths, gap: spacing, setback: SETBACK, jitter: -1 };
  const settled = clampN(finiteOr(terrain.settled, 0.7), 0, 1);
  if (settled > 0.8) return { pattern, wild, paths, gap: 1.5 + ((1 - settled) / 0.2) * 1.5, setback: 1.2, jitter: 0.6 };
  if (settled < 0.3) return { pattern, wild, paths, gap: clampN(spacing * 1.6, 10, 18), setback: SETBACK, jitter: 3, settled };
  const t = (settled - 0.3) / 0.5;
  return { pattern, wild, paths, gap: clampN(spacing * (1.3 - 0.75 * t), 3, 12), setback: SETBACK - 1.1 * t, jitter: 1.5, settled };
}

const NEUTRAL_SITE: SiteSpec = { pattern: 'street', wild: 0.3, paths: 'road', spacing: 6 };

export function generateLayout(spec: WorldSpec): TownLayout {
  const ordered = [...spec.buildings.filter((b) => b.keyBuilding), ...spec.buildings.filter((b) => !b.keyBuilding)];
  const terrain = spec.terrain;
  const site = spec.site ? normaliseSite(spec.site, terrain) : terrain ? normaliseSite(NEUTRAL_SITE, terrain) : null;
  const wilderness = !!site && WILD_PATTERNS.includes(site.pattern);
  const j = site && site.jitter >= 0 ? site.jitter : undefined;
  let plan: Plan;
  if (!site) plan = streetPlan(spec, ordered, { mainW: MAIN_WIDTH, crossW: CROSS_WIDTH, gap: GAP });
  else if (site.pattern === 'ring') plan = ringPlan(spec, ordered, site.gap, site.paths);
  else if (site.pattern === 'scatter') plan = scatterPlan(spec, ordered, site.gap, site.paths);
  else if (site.pattern === 'grid') plan = gridPlan(spec, ordered, site.gap, site.paths, j);
  else if (site.pattern === 'terraces') plan = terracePlan(spec, ordered, site.gap, site.paths, j);
  else if (site.pattern === 'wild') plan = wildPlan(spec, ordered, site.gap);
  else if (site.pattern === 'path') plan = pathPlan(spec, ordered, site.gap, site.paths);
  else if (site.pattern === 'shoreline') plan = shorelinePlan(spec, ordered, site.gap);
  else if (site.pattern === 'cliffside') plan = cliffsidePlan(spec, ordered, site.gap);
  else {
    plan = streetPlan(spec, ordered, {
      mainW: widthFor(site.paths, MAIN_WIDTH), crossW: widthFor(site.paths, CROSS_WIDTH), gap: site.gap, setback: site.setback, jitter: j,
      // A thinly settled street place with few buildings is a single strung-out street, not a crossroads town.
      single: !!spec.site && site.settled !== undefined && site.settled < 0.5 && ordered.length <= 9,
    });
  }
  const { placed, boxes, routes, plaza, spawn, walkable } = plan;

  // Bounds: footprints plus a 20 m margin, widened if a road or the plaza reaches further.
  const foot = boxes.length > 0
    ? boxes.reduce(union)
    : wilderness
      ? grow(rectOf(spawn.x, spawn.z), PLAZA_RADIUS)
      : { minX: -PLAZA_RADIUS, maxX: PLAZA_RADIUS, minZ: -PLAZA_RADIUS, maxZ: PLAZA_RADIUS };
  let bounds = grow(foot, 20);
  for (const rd of routes) bounds = union(bounds, roadRect(rd));
  if (!wilderness) bounds = union(bounds, { minX: -PLAZA_RADIUS, maxX: PLAZA_RADIUS, minZ: -PLAZA_RADIUS, maxZ: PLAZA_RADIUS });

  if (!site) {
    const props = scatterProps(spec, placed, routes, plaza, spawn, bounds);
    return { buildings: placed, roads: routes, props, plaza, spawn, bounds, walkable };
  }

  bounds = union(bounds, grow(rectOf(plaza.x, plaza.z), plaza.r));
  bounds = union(bounds, rectOf(spawn.x, spawn.z));
  for (const p of walkable) bounds = union(bounds, rectOf(p.x, p.z));
  // A building whose door is far from every route still gets a wander target at its door.
  for (const b of placed) {
    if (!walkable.some((p) => Math.hypot(p.x - b.door.x, p.z - b.door.z) <= 3)) walkable.push({ x: b.door.x, z: b.door.z });
  }
  const trails = plan.trails ?? [];
  if (wilderness) {
    // Land is the place here: the trails and a broad margin of nature around them are all inside it.
    let land = rectOf(spawn.x, spawn.z);
    for (const t of trails) for (const p of t.pts) land = union(land, rectOf(p.x, p.z));
    bounds = union(bounds, grow(land, 16));
  }
  let water = plan.water ?? [];
  if (terrain && water.length === 0) water = planWater(spec, terrain, wilderness, plan, bounds);
  for (const w of water) if (w.area.shape === 'disc') bounds = union(bounds, grow(rectOf(w.area.x, w.area.z), w.area.r + 6));
  const band = site.wild >= 0.6;
  if (band) bounds = union(bounds, grow(foot, 25));
  const clearings = plan.clearings ?? [];
  const avoid = trails.length > 0 || water.length > 0 || clearings.length > 0
    ? (x: number, z: number): boolean => trails.some((t) => distanceToPolyline(t.pts, x, z) < t.width / 2 + 1)
      || water.some((w) => w.area.shape !== 'sheet' && waterInside(w, x, z) > -1.5)
      || clearings.some((q) => Math.hypot(x - q.x, z - q.z) < q.r)
    : undefined;
  const props = scatterWild(spec, site.wild, band && !wilderness, placed, routes, plaza, spawn, bounds, foot, avoid);
  const layout: TownLayout = { buildings: placed, roads: site.paths === 'none' ? [] : routes, props, plaza, spawn, bounds, walkable };
  if (trails.length > 0) layout.trails = trails;
  if (water.length > 0) layout.water = water;
  if (clearings.length > 0) layout.clearings = clearings;
  if (plan.benches) layout.benches = plan.benches;
  return layout;
}

function weightedKind(table: [string, number][], rng: Rng): string {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let t = rng.next() * total;
  for (const [kind, w] of table) {
    t -= w;
    if (t <= 0) return kind;
  }
  return table[table.length - 1]?.[0] ?? 'crate';
}

function scatterProps(
  spec: WorldSpec, buildings: PlacedBuilding[], roads: RoadSegment[],
  plaza: TownLayout['plaza'], spawn: TownLayout['spawn'], bounds: Rect,
): PlacedProp[] {
  const rng = makeRng(spec.seed, 'props');
  const pds = new PoissonDiskSampling(
    { shape: [bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ], minDistance: 4, tries: 20 },
    rng.next,
  );
  const roadBoxes = roads.map((r) => grow(roadRect(r), 1.5));
  const footBoxes = buildings.map((b) => grow(buildingAabb(b), 1));
  const table = PROP_KINDS[spec.theme];
  const kept: PlacedProp[] = [];
  for (const p of pds.fill()) {
    const x = bounds.minX + (p[0] ?? 0);
    const z = bounds.minZ + (p[1] ?? 0);
    if (roadBoxes.some((r) => inside(r, x, z))) continue;
    if (Math.hypot(x - plaza.x, z - plaza.z) < plaza.r + 1.5) continue;
    if (footBoxes.some((r) => inside(r, x, z))) continue;
    if (buildings.some((b) => Math.hypot(x - b.door.x, z - b.door.z) < 2.5)) continue;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 3) continue;
    kept.push({ kind: weightedKind(table, rng), x, z, rotY: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.2) });
  }
  return kept.length > MAX_PROPS ? rng.shuffle(kept).slice(0, MAX_PROPS) : kept;
}

/**
 * Prop scatter for a site. `wild` sets the spacing (5.5 m at 0 down to 1.8 m at 1) and how close props may
 * sit to buildings. From wild 0.6 the sampled area reaches 25 m past the buildings, so the place is
 * surrounded by props. Routes keep their clearance even when they are not drawn.
 */
function scatterWild(
  spec: WorldSpec, wild: number, band: boolean, buildings: PlacedBuilding[], routes: RoadSegment[],
  plaza: TownLayout['plaza'], spawn: TownLayout['spawn'], bounds: Rect, foot: Rect,
  avoid?: (x: number, z: number) => boolean,
): PlacedProp[] {
  const rng = makeRng(spec.seed, 'props');
  const minDistance = 5.5 - (5.5 - 1.8) * wild;
  const pds = new PoissonDiskSampling(
    { shape: [bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ], minDistance, tries: 20 },
    rng.next,
  );
  const margin = 1.2 - 0.8 * wild;
  const roadBoxes = routes.map((r) => grow(roadRect(r), 1.5));
  const footBoxes = buildings.map((b) => grow(buildingAabb(b), margin));
  const limit = grow(foot, 25);
  const table = PROP_KINDS[spec.theme];
  const kept: PlacedProp[] = [];
  for (const p of pds.fill()) {
    const x = bounds.minX + (p[0] ?? 0);
    const z = bounds.minZ + (p[1] ?? 0);
    if (band && !inside(limit, x, z)) continue;
    if (roadBoxes.some((r) => inside(r, x, z))) continue;
    if (Math.hypot(x - plaza.x, z - plaza.z) < plaza.r + 1.5) continue;
    if (footBoxes.some((r) => inside(r, x, z))) continue;
    if (buildings.some((b) => Math.hypot(x - b.door.x, z - b.door.z) < 1.5)) continue;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 2.5) continue;
    if (avoid?.(x, z)) continue;
    kept.push({ kind: weightedKind(table, rng), x, z, rotY: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.2) });
  }
  return kept.length > MAX_WILD_PROPS ? rng.shuffle(kept).slice(0, MAX_WILD_PROPS) : kept;
}
