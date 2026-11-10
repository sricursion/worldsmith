import { describe, expect, it } from 'vitest';
import { buildingAabb, distanceToRoad, generateLayout, roadRect } from '../../app/src/town/layout';
import type { Rect, TownLayout } from '../../app/src/town/layout';
import { PATTERNS, makeSiteSpec, makeSpec } from './helpers';

const COUNTS = [6, 9, 14];
const SEEDS = Array.from({ length: 20 }, (_, i) => 101 + i * 37);
const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
const within = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

function checkInvariants(l: TownLayout, count: number, tag: string, drawn: boolean): void {
  expect(l.buildings, tag).toHaveLength(count);
  const boxes = l.buildings.map(buildingAabb);
  boxes.forEach((a, i) => {
    for (let j = i + 1; j < boxes.length; j++) expect(overlaps(a, boxes[j] as Rect, 2.99), `${tag} ${i}/${j}`).toBe(false);
    if (drawn) for (const r of l.roads) expect(overlaps(a, roadRect(r)), `${tag} road ${i}`).toBe(false);
    expect(Math.hypot(Math.max(a.minX, Math.min(l.plaza.x, a.maxX)) - l.plaza.x, Math.max(a.minZ, Math.min(l.plaza.z, a.maxZ)) - l.plaza.z)).toBeGreaterThan(l.plaza.r);
  });
  l.buildings.forEach((b, i) => {
    expect(within(boxes[i] as Rect, b.door.x, b.door.z), `${tag} door ${b.id} outside`).toBe(false);
    const nearest = Math.min(...l.walkable.map((p) => Math.hypot(p.x - b.door.x, p.z - b.door.z)));
    expect(nearest, `${tag} door ${b.id} walkable`).toBeLessThanOrEqual(6);
  });
  for (const b of boxes) expect(within(b, l.spawn.x, l.spawn.z), `${tag} spawn in footprint`).toBe(false);
  // bounds contain everything
  const inB = (x: number, z: number): boolean => within(l.bounds, x, z);
  for (const b of boxes) expect(inB(b.minX, b.minZ) && inB(b.maxX, b.maxZ), `${tag} bounds b`).toBe(true);
  for (const r of l.roads) { const q = roadRect(r); expect(inB(q.minX, q.minZ) && inB(q.maxX, q.maxZ), `${tag} bounds r`).toBe(true); }
  expect(inB(l.spawn.x, l.spawn.z) && inB(l.plaza.x - l.plaza.r, l.plaza.z - l.plaza.r) && inB(l.plaza.x + l.plaza.r, l.plaza.z + l.plaza.r)).toBe(true);
  for (const p of l.walkable) expect(inB(p.x, p.z), `${tag} bounds w`).toBe(true);
  for (const p of l.props) {
    expect(inB(p.x, p.z), `${tag} bounds p`).toBe(true);
    for (const b of boxes) expect(within(b, p.x, p.z), `${tag} prop in footprint`).toBe(false);
    for (const b of l.buildings) expect(Math.hypot(p.x - b.door.x, p.z - b.door.z), `${tag} prop at door`).toBeGreaterThanOrEqual(1.5);
    if (drawn) for (const r of l.roads) expect(distanceToRoad(r, p.x, p.z), `${tag} prop on road`).toBeGreaterThan(0);
  }
  expect(l.props.length).toBeLessThanOrEqual(420);
}

describe('site layouts: shared invariants', () => {
  for (const pattern of PATTERNS) {
    for (const count of COUNTS) {
      it(`${pattern} x ${count} buildings over 20 seeds`, () => {
        for (const seed of SEEDS) {
          const spec = makeSiteSpec({ pattern, count, seed });
          const a = generateLayout(spec);
          checkInvariants(a, count, `${pattern}/${count}/${seed}`, true);
          if (seed === SEEDS[0]) expect(JSON.stringify(generateLayout(spec))).toBe(JSON.stringify(a));
        }
      }, 60000);
    }
  }
});

describe('site layouts: pattern shapes', () => {
  it('ring: buildings sit between one and five plaza radii from the centre, in one or two bands', () => {
    for (const count of COUNTS) for (const seed of SEEDS) {
      const l = generateLayout(makeSiteSpec({ pattern: 'ring', count, seed }));
      const ratios = l.buildings.map((b) => Math.hypot(b.x, b.z) / l.plaza.r);
      expect(Math.min(...ratios)).toBeGreaterThan(1);
      expect(Math.max(...ratios)).toBeLessThan(5);
      expect(l.roads.length).toBeGreaterThanOrEqual(7); // ring of 4 plus 3 or 4 spokes
      expect(l.plaza.r).toBeCloseTo(Math.min(13, Math.max(7, 4.5 + count * 0.55)), 6);
      for (const b of l.buildings) {
        // faces the centre: the door is nearer the centre than the building is
        expect(Math.hypot(b.door.x, b.door.z)).toBeLessThan(Math.hypot(b.x, b.z));
      }
    }
  });

  it('scatter: no road wider than 2.5 on tracks, every track axis-aligned, 2 to 4 segments per door', () => {
    for (const count of COUNTS) for (const seed of SEEDS) {
      const l = generateLayout(makeSiteSpec({ pattern: 'scatter', count, seed, paths: 'track', spacing: 5 }));
      expect(l.roads.length).toBeGreaterThanOrEqual(count);
      expect(l.roads.length).toBeLessThanOrEqual(count * 4);
      for (const r of l.roads) {
        expect(r.width).toBeLessThanOrEqual(2.5);
        expect(r.ax === r.bx || r.az === r.bz).toBe(true);
      }
      // a track starts at every door
      for (const b of l.buildings) {
        expect(l.roads.some((r) => distanceToRoad(r, b.door.x, b.door.z) < 0.01), `${seed} door ${b.id}`).toBe(true);
      }
    }
  });

  it('scatter: footprints keep at least the spacing apart (diagonal-based)', () => {
    for (const seed of SEEDS) {
      const l = generateLayout(makeSiteSpec({ pattern: 'scatter', count: 12, seed, spacing: 8 }));
      const boxes = l.buildings.map(buildingAabb);
      const dist = (a: Rect, b: Rect): number => Math.hypot(Math.max(a.minX - b.maxX, b.minX - a.maxX, 0), Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0));
      boxes.forEach((a, i) => { for (let j = i + 1; j < boxes.length; j++) expect(dist(a, boxes[j] as Rect)).toBeGreaterThanOrEqual(7.99); });
    }
  });

  it('grid: at least 4 axis-aligned road segments, and buildings face a street', () => {
    for (const count of COUNTS) for (const seed of SEEDS) {
      const l = generateLayout(makeSiteSpec({ pattern: 'grid', count, seed, spacing: 3 }));
      expect(l.roads.filter((r) => r.ax === r.bx || r.az === r.bz).length).toBeGreaterThanOrEqual(4);
      for (const b of l.buildings) {
        expect(Math.min(...l.roads.map((r) => distanceToRoad(r, b.door.x, b.door.z)))).toBeLessThanOrEqual(3);
      }
    }
  });

  it('terraces: every building faces the same way and rows step back from the front road', () => {
    for (const count of COUNTS) for (const seed of SEEDS) {
      const l = generateLayout(makeSiteSpec({ pattern: 'terraces', count, seed }));
      const fronts = new Set(l.buildings.map((b) => Math.round(b.z - b.d / 2)));
      for (const b of l.buildings) expect(b.rotY).toBe(0);
      expect(fronts.size).toBeGreaterThanOrEqual(2);
      expect(fronts.size).toBeLessThanOrEqual(count <= 8 ? 2 : 3);
    }
  });
});
