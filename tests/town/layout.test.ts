import { describe, expect, it } from 'vitest';
import {
  FOOTPRINTS, buildingAabb, crossStreetCount, distanceToRoad, footprintFor, generateLayout, roadRect,
} from '../../app/src/town/layout';
import type { Rect } from '../../app/src/town/layout';
import { makeRng } from '../../app/src/world/rng';
import { THEMES, makeSpec } from './helpers';

const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
const within = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

describe('generateLayout', () => {
  it('is deterministic for the same spec', () => {
    const a = generateLayout(makeSpec({ seed: 77, count: 11 }));
    const b = generateLayout(makeSpec({ seed: 77, count: 11 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('changes when the seed changes', () => {
    const a = generateLayout(makeSpec({ seed: 1, count: 9, salt: 'same' }));
    const b = generateLayout(makeSpec({ seed: 2, count: 9, salt: 'same' }));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('places every building without overlap and with 3 m gaps', () => {
    for (const count of [6, 9, 12, 14]) {
      const spec = makeSpec({ seed: count * 31, count });
      const layout = generateLayout(spec);
      expect(layout.buildings).toHaveLength(count);
      const boxes = layout.buildings.map(buildingAabb);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i] as Rect;
          const b = boxes[j] as Rect;
          expect(overlaps(a, b, 2.99), `${i} vs ${j}`).toBe(false);
        }
      }
    }
  });

  it('keeps footprints off the roads and the plaza', () => {
    const layout = generateLayout(makeSpec({ seed: 5, count: 13 }));
    for (const b of layout.buildings) {
      const r = buildingAabb(b);
      for (const road of layout.roads) expect(overlaps(r, roadRect(road))).toBe(false);
      const nx = Math.max(r.minX, Math.min(0, r.maxX));
      const nz = Math.max(r.minZ, Math.min(0, r.maxZ));
      expect(Math.hypot(nx, nz)).toBeGreaterThan(layout.plaza.r);
    }
  });

  it('puts every door within 3 m of a road edge, on the street side', () => {
    for (const seed of [3, 4, 5, 6]) {
      const layout = generateLayout(makeSpec({ seed, count: 12 }));
      for (const b of layout.buildings) {
        const d = Math.min(...layout.roads.map((r) => distanceToRoad(r, b.door.x, b.door.z)));
        expect(d).toBeLessThanOrEqual(3);
        // the door is outside the footprint
        expect(within(buildingAabb(b), b.door.x, b.door.z)).toBe(false);
      }
    }
  });

  it('puts key buildings nearest the centre crossing, alternating sides', () => {
    const spec = makeSpec({ seed: 21, count: 10 });
    const layout = generateLayout(spec);
    const keys = layout.buildings.filter((b) => spec.buildings.find((s) => s.id === b.id)?.keyBuilding);
    const others = layout.buildings.filter((b) => !keys.includes(b));
    const far = Math.max(...keys.map((b) => Math.hypot(b.x, b.z)));
    const nearOther = Math.min(...others.map((b) => Math.hypot(b.x, b.z)));
    expect(keys.length).toBe(3);
    expect(far).toBeLessThan(nearOther + 20);
    expect(new Set(keys.map((b) => Math.sign(b.z))).size).toBeGreaterThan(1);
  });

  it('contains buildings, roads, plaza, props and spawn in its bounds', () => {
    const layout = generateLayout(makeSpec({ seed: 9, count: 14, theme: 'modern' }));
    const bd = layout.bounds;
    for (const b of layout.buildings) {
      const r = buildingAabb(b);
      expect(within(bd, r.minX, r.minZ) && within(bd, r.maxX, r.maxZ)).toBe(true);
    }
    for (const rd of layout.roads) {
      const r = roadRect(rd);
      expect(within(bd, r.minX, r.minZ) && within(bd, r.maxX, r.maxZ)).toBe(true);
    }
    for (const p of layout.props) expect(within(bd, p.x, p.z)).toBe(true);
    for (const w of layout.walkable) expect(within(bd, w.x, w.z)).toBe(true);
    expect(within(bd, layout.plaza.x - layout.plaza.r, layout.plaza.z - layout.plaza.r)).toBe(true);
    expect(within(bd, layout.plaza.x + layout.plaza.r, layout.plaza.z + layout.plaza.r)).toBe(true);
    expect(within(bd, layout.spawn.x, layout.spawn.z)).toBe(true);
  });

  it('never puts props inside footprints, on roads, or on the plaza', () => {
    for (const theme of THEMES) {
      const layout = generateLayout(makeSpec({ seed: 40, count: 12, theme }));
      expect(layout.props.length).toBeGreaterThan(10);
      for (const p of layout.props) {
        for (const b of layout.buildings) expect(within(buildingAabb(b), p.x, p.z)).toBe(false);
        for (const rd of layout.roads) expect(within(roadRect(rd), p.x, p.z)).toBe(false);
        expect(Math.hypot(p.x - layout.plaza.x, p.z - layout.plaza.z)).toBeGreaterThan(layout.plaza.r);
      }
    }
  });

  it('uses theme prop kinds', () => {
    const modern = new Set(['bench', 'tree', 'bin', 'light_pole', 'hydrant', 'car']);
    const layout = generateLayout(makeSpec({ seed: 2, count: 8, theme: 'modern' }));
    for (const p of layout.props) expect(modern.has(p.kind)).toBe(true);
  });

  it('chooses the cross-street count from the building count', () => {
    expect(crossStreetCount(6)).toBe(1);
    expect(crossStreetCount(7)).toBe(1);
    expect(crossStreetCount(8)).toBe(2);
    expect(crossStreetCount(10)).toBe(2);
    expect(crossStreetCount(11)).toBe(3);
    for (const [count, cross] of [[6, 1], [7, 1], [8, 2], [10, 2], [11, 3], [14, 3]] as const) {
      const layout = generateLayout(makeSpec({ seed: 12, count }));
      expect(layout.roads.filter((r) => r.width === 6)).toHaveLength(cross);
      expect(layout.roads.filter((r) => r.width === 8)).toHaveLength(1);
    }
  });

  it('spaces cross streets 26 to 34 m apart and puts the plaza on the main crossing', () => {
    const layout = generateLayout(makeSpec({ seed: 15, count: 13 }));
    const xs = layout.roads.filter((r) => r.width === 6).map((r) => r.ax).sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    for (let i = 1; i < xs.length; i++) {
      const gap = (xs[i] as number) - (xs[i - 1] as number);
      expect(gap).toBeGreaterThanOrEqual(26);
      expect(gap).toBeLessThanOrEqual(34);
    }
    expect(xs).toContain(0);
    expect(layout.plaza).toEqual({ x: 0, z: 0, r: 7 });
  });

  it('spawns on the main street 12 m from the centre, facing the plaza', () => {
    const layout = generateLayout(makeSpec({ seed: 8, count: 8 }));
    expect(layout.spawn.z).toBe(0);
    expect(Math.abs(layout.spawn.x)).toBe(12);
    const fx = -Math.sin(layout.spawn.rotY);
    expect(Math.sign(fx)).toBe(-Math.sign(layout.spawn.x));
  });

  it('samples walkable points along the street centrelines', () => {
    const layout = generateLayout(makeSpec({ seed: 8, count: 8 }));
    expect(layout.walkable.length).toBeGreaterThan(10);
    for (const w of layout.walkable) {
      const onRoad = layout.roads.some((r) => within(roadRect(r), w.x, w.z));
      expect(onRoad).toBe(true);
    }
  });

  it('handles 50 random specs without throwing', () => {
    const rng = makeRng(99, 'fuzz');
    for (let i = 0; i < 50; i++) {
      const spec = makeSpec({ seed: rng.int(0, 2 ** 31), count: rng.int(6, 14), theme: rng.pick(THEMES), salt: `f${i}` });
      const layout = generateLayout(spec);
      expect(layout.buildings).toHaveLength(spec.buildings.length);
      const boxes = layout.buildings.map(buildingAabb);
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          expect(overlaps(boxes[a] as Rect, boxes[b] as Rect)).toBe(false);
        }
      }
    }
  });
});

describe('footprintFor', () => {
  it('uses the default table without a kit', () => {
    expect(footprintFor('house', 'medium')).toEqual(FOOTPRINTS.medium);
    expect(FOOTPRINTS).toEqual({ small: { w: 6, d: 6 }, medium: { w: 9, d: 8 }, large: { w: 12, d: 10 } });
  });
  it('defers to the kit when it supplies a footprint', () => {
    expect(footprintFor('house', 'small', { footprint: () => ({ w: 5, d: 7 }) })).toEqual({ w: 5, d: 7 });
    expect(footprintFor('house', 'small', { footprint: () => ({ w: 0, d: 0 }) })).toEqual(FOOTPRINTS.small);
  });
});
