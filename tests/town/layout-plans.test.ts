import { describe, expect, it } from 'vitest';
import { buildingAabb, distanceToRoad, generateLayout, roadRect, waterInside } from '../../app/src/town/layout';
import type { Rect, TownLayout } from '../../app/src/town/layout';
import type { SitePattern, TerrainSpec, WaterKind, WorldSpec } from '../../app/src/world/spec';
import { makeSiteSpec } from './helpers';

const SEEDS = Array.from({ length: 20 }, (_, i) => 211 + i * 53);
const WATERS: WaterKind[] = ['none', 'pond', 'river', 'shore', 'lake'];

function landSite(o: { pattern: SitePattern; count: number; seed: number; settled: number; water?: WaterKind }): WorldSpec {
  const terrain: TerrainSpec = { relief: 'rolling', ruggedness: 0.5, water: o.water ?? 'none', waterAmount: 0.4, horizon: 'hills', settled: o.settled };
  return { ...makeSiteSpec({ pattern: o.pattern, count: o.count, seed: o.seed }), terrain };
}

const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;

/** What must hold for any plan: nothing overlaps, nothing on a road or in water, every door by a route, roads joined up. */
function checkSound(l: TownLayout, count: number, tag: string, fronted = true): void {
  expect(l.buildings, tag).toHaveLength(count);
  const boxes = l.buildings.map(buildingAabb);
  boxes.forEach((a, i) => {
    for (let j = i + 1; j < boxes.length; j++) expect(overlaps(a, boxes[j] as Rect, 1.49), `${tag} ${i}/${j}`).toBe(false);
    for (const r of l.roads) expect(overlaps(a, roadRect(r)), `${tag} road over ${i}`).toBe(false);
    for (const w of l.water ?? []) {
      if (w.area.shape === 'sheet') continue;
      for (const [x, z] of [[a.minX, a.minZ], [a.maxX, a.minZ], [a.minX, a.maxZ], [a.maxX, a.maxZ]] as [number, number][]) {
        expect(waterInside(w, x, z), `${tag} ${i} in water`).toBeLessThan(0);
      }
    }
  });
  for (const b of l.buildings) {
    if (fronted) expect(Math.min(...l.roads.map((r) => distanceToRoad(r, b.door.x, b.door.z))), `${tag} door ${b.id}`).toBeLessThanOrEqual(3);
    expect(Math.min(...l.walkable.map((p) => Math.hypot(p.x - b.door.x, p.z - b.door.z))), `${tag} walk ${b.id}`).toBeLessThanOrEqual(6);
  }
  // Every road touches the rest: flood from the first one.
  const rects = l.roads.map((r) => roadRect(r));
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const i = queue.pop() as number;
    rects.forEach((r, j) => { if (!seen.has(j) && overlaps(rects[i] as Rect, r, 0.6)) { seen.add(j); queue.push(j); } });
  }
  expect(seen.size, `${tag} roads joined`).toBe(rects.length);
}

describe('plans chosen from how settled the land is', () => {
  it('a thinly settled street place is one street, with the key building closing its far end', () => {
    for (const count of [3, 6, 9]) for (const seed of SEEDS) {
      const spec = landSite({ pattern: 'street', count, seed, settled: 0.4, water: WATERS[seed % WATERS.length] });
      const l = generateLayout(spec);
      const tag = `single/${count}/${seed}`;
      checkSound(l, count, tag);
      expect(l.roads, tag).toHaveLength(1);
      const road = l.roads[0]!;
      const head = l.buildings[0]!;
      expect(head.id).toBe(spec.buildings.find((b) => b.keyBuilding)!.id);
      // square across the end of the street, looking back down it
      expect(head.z).toBe(0);
      expect(head.rotY).toBeCloseTo(Math.PI / 2, 9);
      expect(head.door.x).toBeCloseTo(Math.max(road.ax, road.bx), 9);
      for (const b of l.buildings.slice(1)) {
        expect(buildingAabb(b).maxX, tag).toBeLessThan(buildingAabb(head).minX);
        // everyone else fronts the street from one side or the other
        expect(Math.abs(Math.sin(b.rotY)), tag).toBeLessThan(1e-9);
      }
      if (seed === SEEDS[0]) expect(JSON.stringify(generateLayout(spec))).toBe(JSON.stringify(l));
    }
  });

  it('a settled street place, or a large one, keeps its cross streets', () => {
    for (const seed of SEEDS) {
      expect(generateLayout(landSite({ pattern: 'street', count: 9, seed, settled: 0.7 })).roads.length).toBeGreaterThan(1);
      expect(generateLayout(landSite({ pattern: 'street', count: 12, seed, settled: 0.4 })).roads.length).toBeGreaterThan(1);
    }
  });

  it('a ring on land gives the key building the head of the plaza, on the side with no spoke', () => {
    for (const count of [6, 9, 14]) for (const seed of SEEDS) {
      const spec = landSite({ pattern: 'ring', count, seed, settled: 0.6, water: WATERS[seed % WATERS.length] });
      const l = generateLayout(spec);
      const tag = `ring/${count}/${seed}`;
      checkSound(l, count, tag, false); // the outer band reaches the ring road over open ground
      expect(l.roads, tag).toHaveLength(7); // the square and three spokes
      const head = l.buildings[0]!;
      expect(head.id).toBe(spec.buildings.find((b) => b.keyBuilding)!.id);
      // on an axis through the centre, facing the plaza, and the nearest building to it on that side
      expect(Math.min(Math.abs(head.x), Math.abs(head.z)), tag).toBe(0);
      expect(Math.hypot(head.door.x, head.door.z)).toBeLessThan(Math.hypot(head.x, head.z));
      const ux = Math.sign(head.x);
      const uz = Math.sign(head.z);
      // no spoke runs out on the landmark's side
      for (const r of l.roads.slice(4)) expect(Math.sign(r.bx) === ux && Math.sign(r.bz) === uz, tag).toBe(false);
      // the spoke opposite ends its run looking straight at it
      expect(l.roads.slice(4).some((r) => Math.sign(r.bx) === -ux && Math.sign(r.bz) === -uz), tag).toBe(true);
      for (const b of l.buildings) expect(Math.hypot(b.door.x, b.door.z)).toBeLessThan(Math.hypot(b.x, b.z));
    }
  });

  it('a settled scatter is a village whose doors all look onto the green; a thin one keeps wide gaps', () => {
    for (const seed of SEEDS) {
      const village = generateLayout(landSite({ pattern: 'scatter', count: 9, seed, settled: 0.6 }));
      checkSound(village, 9, `village/${seed}`);
      for (const b of village.buildings) expect(Math.hypot(b.door.x, b.door.z), `village/${seed}`).toBeLessThan(Math.hypot(b.x, b.z));
      const camp = generateLayout(landSite({ pattern: 'scatter', count: 9, seed, settled: 0.2 }));
      checkSound(camp, 9, `camp/${seed}`);
      const boxes = camp.buildings.map(buildingAabb);
      const apart = (a: Rect, b: Rect): number => Math.hypot(Math.max(a.minX - b.maxX, b.minX - a.maxX, 0), Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0));
      boxes.forEach((a, i) => { for (let j = i + 1; j < boxes.length; j++) expect(apart(a, boxes[j] as Rect), `camp/${seed}`).toBeGreaterThanOrEqual(9.99); });
    }
  });
});
