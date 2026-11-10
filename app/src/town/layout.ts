// Deterministic town layout. Pure: no three, no DOM. Same spec in, same layout out.
// With no WorldSpec.site: main street along X through the origin, cross streets along Z. With a site the
// pattern (street, ring, scatter, grid, terraces) decides. Buildings face their route; rotations are always
// multiples of 90 degrees (rotY 0 faces -Z, PI faces +Z, PI/2 faces -X, -PI/2 faces +X).
import PoissonDiskSampling from 'poisson-disk-sampling';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { BuildingRole, BuildingSize, BuildingSpec, SitePattern, SiteSpec, ThemeId, WorldSpec } from '../world/spec';

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
}
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export const FOOTPRINTS: Record<BuildingSize, { w: number; d: number }> = {
  small: { w: 6, d: 6 },
  medium: { w: 9, d: 8 },
  large: { w: 12, d: 10 },
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
}

const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const widthFor = (paths: Paths, normal: number): number => (paths === 'road' ? normal : TRACK_WIDTH);
const faceToward = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));
const rectOf = (x: number, z: number): Rect => ({ minX: x, maxX: x, minZ: z, maxZ: z });

function streetPlan(spec: WorldSpec, ordered: BuildingSpec[], o: { mainW: number; crossW: number; gap: number }): Plan {
  const { mainW, crossW, gap } = o;
  const rng = makeRng(spec.seed, 'layout');
  const count = ordered.length;
  const nCross = crossStreetCount(count);
  const crossXs = crossStreetXs(nCross, rng);

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
        cursors.set(key, c + extent + rng.range(0, 1.5));
        return { x: cand.x, z: cand.z };
      }
    }
    return null;
  };

  const mainCount = Math.min(count, Math.max(Math.min(count, 4), Math.ceil(count * 0.6)));
  const mainStart: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const perSide: Record<string, number> = {};
  for (let i = 0; i < mainCount; i++) {
    const s = ordered[i];
    if (!s) continue;
    const { w, d } = footprintFor(s.role, s.size);
    const side = ((i % 2 === 0 ? 1 : -1) * mainStart) as 1 | -1;
    const k = perSide[side] ?? 0;
    perSide[side] = k + 1;
    const dir: 1 | -1 = k % 2 === 0 ? 1 : -1;
    const rotY = side > 0 ? 0 : Math.PI;
    const z = side * (mainW / 2 + SETBACK + d / 2);
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
    const { w, d } = footprintFor(s.role, s.size);
    const rotY = arm.side > 0 ? Math.PI / 2 : -Math.PI / 2;
    const x = cx + arm.side * (crossW / 2 + SETBACK + d / 2);
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
  const dirs = rng.shuffle<[number, number]>([[1, 0], [-1, 0], [0, 1], [0, -1]]).slice(0, rng.chance(0.5) ? 3 : 4);
  const spokeRect = ([dx, dz]: [number, number]): Rect => (dx !== 0
    ? { minX: dx > 0 ? P : -FAR, maxX: dx > 0 ? FAR : -P, minZ: -sw / 2, maxZ: sw / 2 }
    : { minX: -sw / 2, maxX: sw / 2, minZ: dz > 0 ? P : -FAR, maxZ: dz > 0 ? FAR : -P });
  // The whole square (road and the open ground inside it) is closed to buildings.
  const c = newCtx(rng, gap, P, [{ minX: -S - h, maxX: S + h, minZ: -S - h, maxZ: S + h }, ...dirs.map(spokeRect)]);

  const inner = n <= 8 ? n : Math.ceil(n * 0.55);
  let index = 0;
  let startR = S;
  for (let ringNo = 0; ringNo < 2 && index < n; ringNo++) {
    const k = ringNo === 0 ? inner : n - inner;
    const a0 = rng.range(0, (Math.PI * 2) / Math.max(1, k)) + (ringNo === 1 ? Math.PI / Math.max(1, k) : 0);
    const from = index;
    for (let j = 0; j < k; j++, index++) {
      const s = ordered[index];
      if (!s) continue;
      const { w, d } = footprintFor(s.role, s.size);
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
      const rs = c.placed.slice(from).map((b) => Math.hypot(b.x, b.z));
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
function gridPlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number, paths: Paths): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const W = widthFor(paths, 6);
  const h = W / 2;
  const [nx, ny] = n <= 8 ? [2, 2] : n <= 11 ? [3, 2] : [3, 3];
  let maxD = 6;
  for (const s of ordered) maxD = Math.max(maxD, footprintFor(s.role, s.size).d);
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
        cursors.set(key, cur + w + rng.range(0, 2));
        return { x, z, rotY };
      }
    }
    return null;
  };

  ordered.forEach((s, i) => {
    const { w, d } = footprintFor(s.role, s.size);
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
function terracePlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number, paths: Paths): Plan {
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
  const depth = rows.map((r) => r.reduce((m, s) => Math.max(m, footprintFor(s.role, s.size).d), 0));
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
      const { w, d } = footprintFor(s.role, s.size);
      const dir: 1 | -1 = j % 2 === 0 ? 1 : -1;
      const z = (base[k] ?? 0) + d / 2;
      const key = `${k}:${dir}`;
      let cur = cursors.get(key) ?? k * 3; // each row steps in from the one before
      for (let step = 0; step < 1200; step++, cur += 0.5) {
        const x = dir * (cur + w / 2);
        if (ctxFits(c, buildingAabb({ x, z, rotY: 0, w, d }))) {
          ctxCommit(c, s, x, z, 0, w, d);
          cursors.set(key, cur + w + rng.range(0, 1.5));
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
  for (let t = 0; t < 36; t++) {
    const L1 = rng.range(2, 6);
    const p1: Pt = { x: D.x + fx * L1, z: D.z + fz * L1 };
    const variant = t % 3;
    let pts: Pt[];
    if (variant === 0) {
      const direct = alongX ? -D.x * fx : -D.z * fz; // distance along the facing axis to the centre line
      if (direct < 2) continue;
      pts = [D, pt(0, pb(D)), { x: 0, z: 0 }];
    } else if (variant === 1) {
      pts = [D, p1, pt(pa(p1), 0), { x: 0, z: 0 }];
    } else {
      const bm = pb(p1) * rng.range(0.3, 0.7);
      pts = [D, p1, pt(pa(p1), bm), pt(0, bm), { x: 0, z: 0 }];
    }
    const segs = build(pts);
    if (segs.length >= 2 && segs.length <= 4 && clear(segs)) return segs;
  }
  return build([D, { x: D.x + fx * 3, z: D.z + fz * 3 }]);
}

/** A camp, grove or village: no street grid, buildings dart-thrown with per-pair spacing, tracks to the centre. */
function scatterPlan(spec: WorldSpec, ordered: BuildingSpec[], gap: number, paths: Paths): Plan {
  const rng = makeRng(spec.seed, 'layout');
  const n = ordered.length;
  const plazaR = clampN(3.5 + n * 0.15, 4, 6);
  const c = newCtx(rng, gap, plazaR, []);
  const diag: number[] = [];
  // Two centres stay at least half of each diagonal apart plus the spacing, so footprints never come closer than the spacing.
  for (const s of ordered) {
    const { w, d } = footprintFor(s.role, s.size);
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
      if (c.placed.length > 0 && rng.chance(0.45)) {
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

function normaliseSite(site: SiteSpec): { pattern: SitePattern; wild: number; paths: Paths; gap: number } {
  const patterns: SitePattern[] = ['street', 'ring', 'scatter', 'grid', 'terraces'];
  const pattern = patterns.includes(site.pattern) ? site.pattern : 'street';
  const paths: Paths = site.paths === 'track' || site.paths === 'none' ? site.paths : 'road';
  return { pattern, wild: clampN(finiteOr(site.wild, 0.3), 0, 1), paths, gap: clampN(finiteOr(site.spacing, 6), 3, 14) };
}

export function generateLayout(spec: WorldSpec): TownLayout {
  const ordered = [...spec.buildings.filter((b) => b.keyBuilding), ...spec.buildings.filter((b) => !b.keyBuilding)];
  const site = spec.site ? normaliseSite(spec.site) : null;
  let plan: Plan;
  if (!site) plan = streetPlan(spec, ordered, { mainW: MAIN_WIDTH, crossW: CROSS_WIDTH, gap: GAP });
  else if (site.pattern === 'ring') plan = ringPlan(spec, ordered, site.gap, site.paths);
  else if (site.pattern === 'scatter') plan = scatterPlan(spec, ordered, site.gap, site.paths);
  else if (site.pattern === 'grid') plan = gridPlan(spec, ordered, site.gap, site.paths);
  else if (site.pattern === 'terraces') plan = terracePlan(spec, ordered, site.gap, site.paths);
  else {
    plan = streetPlan(spec, ordered, {
      mainW: widthFor(site.paths, MAIN_WIDTH), crossW: widthFor(site.paths, CROSS_WIDTH), gap: site.gap,
    });
  }
  const { placed, boxes, routes, plaza, spawn, walkable } = plan;

  // Bounds: footprints plus a 20 m margin, widened if a road or the plaza reaches further.
  const foot = boxes.length > 0
    ? boxes.reduce(union)
    : { minX: -PLAZA_RADIUS, maxX: PLAZA_RADIUS, minZ: -PLAZA_RADIUS, maxZ: PLAZA_RADIUS };
  let bounds = grow(foot, 20);
  for (const rd of routes) bounds = union(bounds, roadRect(rd));
  bounds = union(bounds, { minX: -PLAZA_RADIUS, maxX: PLAZA_RADIUS, minZ: -PLAZA_RADIUS, maxZ: PLAZA_RADIUS });

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
  const band = site.wild >= 0.6;
  if (band) bounds = union(bounds, grow(foot, 25));
  const props = scatterWild(spec, site.wild, band, placed, routes, plaza, spawn, bounds, foot);
  return { buildings: placed, roads: site.paths === 'none' ? [] : routes, props, plaza, spawn, bounds, walkable };
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
    kept.push({ kind: weightedKind(table, rng), x, z, rotY: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.2) });
  }
  return kept.length > MAX_WILD_PROPS ? rng.shuffle(kept).slice(0, MAX_WILD_PROPS) : kept;
}
