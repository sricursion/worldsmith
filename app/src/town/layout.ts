// Deterministic town layout. Pure: no three, no DOM. Same spec in, same layout out.
// Main street runs along X through the origin; cross streets run along Z. Buildings face the
// street they sit on (rotY 0 faces -Z, PI faces +Z, PI/2 faces -X, -PI/2 faces +X).
import PoissonDiskSampling from 'poisson-disk-sampling';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { BuildingRole, BuildingSize, ThemeId, WorldSpec } from '../world/spec';

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

export function generateLayout(spec: WorldSpec): TownLayout {
  const rng = makeRng(spec.seed, 'layout');
  const ordered = [...spec.buildings.filter((b) => b.keyBuilding), ...spec.buildings.filter((b) => !b.keyBuilding)];
  const count = ordered.length;
  const nCross = crossStreetCount(count);
  const crossXs = crossStreetXs(nCross, rng);

  // While placing, streets are treated as infinite so every building keeps its setback.
  const corridors: Rect[] = [
    { minX: -FAR, maxX: FAR, minZ: -MAIN_WIDTH / 2, maxZ: MAIN_WIDTH / 2 },
    ...crossXs.map((cx) => ({ minX: cx - CROSS_WIDTH / 2, maxX: cx + CROSS_WIDTH / 2, minZ: -FAR, maxZ: FAR })),
  ].map((r) => grow(r, ROAD_MARGIN));
  const placed: PlacedBuilding[] = [];
  const boxes: Rect[] = [];
  const onStreet: number[] = []; // 0 = main street, n = cross street n-1

  const fits = (r: Rect): boolean => {
    if (corridors.some((c) => hits(r, c))) return false;
    const cx = Math.max(r.minX, Math.min(0, r.maxX));
    const cz = Math.max(r.minZ, Math.min(0, r.maxZ));
    if (Math.hypot(cx, cz) < PLAZA_RADIUS + 0.5) return false;
    const g = grow(r, GAP);
    return !boxes.some((o) => hits(g, o));
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
    const z = side * (MAIN_WIDTH / 2 + SETBACK + d / 2);
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
    const x = cx + arm.side * (CROSS_WIDTH / 2 + SETBACK + d / 2);
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
  const roads: RoadSegment[] = [{ ax: mainMin, az: 0, bx: mainMax, bz: 0, width: MAIN_WIDTH }];
  crossXs.forEach((cx, j) => roads.push({ ax: cx, az: crossMin[j] ?? -24, bx: cx, bz: crossMax[j] ?? 24, width: CROSS_WIDTH }));

  const plaza = { x: 0, z: 0, r: PLAZA_RADIUS };
  const spawn = { x: 12, z: 0, rotY: Math.PI / 2 };

  // Bounds: footprints plus a 20 m margin, widened if a road or the plaza reaches further.
  const foot = boxes.length > 0
    ? boxes.reduce(union)
    : { minX: -PLAZA_RADIUS, maxX: PLAZA_RADIUS, minZ: -PLAZA_RADIUS, maxZ: PLAZA_RADIUS };
  let bounds = grow(foot, 20);
  for (const rd of roads) bounds = union(bounds, roadRect(rd));
  bounds = union(bounds, { minX: -PLAZA_RADIUS, maxX: PLAZA_RADIUS, minZ: -PLAZA_RADIUS, maxZ: PLAZA_RADIUS });

  const walkable: { x: number; z: number }[] = [];
  for (let x = mainMin; x <= mainMax + 1e-6; x += 3) walkable.push({ x, z: 0 });
  crossXs.forEach((cx, j) => {
    for (let z = crossMin[j] ?? -24; z <= (crossMax[j] ?? 24) + 1e-6; z += 3) {
      if (Math.abs(z) > 1.5) walkable.push({ x: cx, z });
    }
  });

  const props = scatterProps(spec, placed, roads, plaza, spawn, bounds);
  return { buildings: placed, roads, props, plaza, spawn, bounds, walkable };
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
