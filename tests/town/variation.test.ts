import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_SETBACK, planBuildings } from '../../app/src/town/build';
import { buildingAabb, generateLayout } from '../../app/src/town/layout';
import {
  MAX_WIDEN, assignBlueprints, buildingSeed, evenShares, fieldNoise, growthAt, instanceLook, mixKind, silhouetteKey, varyBlueprint,
} from '../../app/src/town/variation';
import { expandParts, lintBlueprint } from '../../app/src/world/blueprints';
import { normalizeSpec } from '../../app/src/world/schema';
import type { Blueprint, WorldSpec } from '../../app/src/world/spec';
import { BLUEPRINTS, makeBlueprintSpec } from './helpers';

const LIVE_DIR = fileURLToPath(new URL('../worker/_live/out/', import.meta.url));
const liveSpecs = (): WorldSpec[] =>
  readdirSync(LIVE_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => normalizeSpec(JSON.parse(readFileSync(LIVE_DIR + f, 'utf8')) as WorldSpec));

const SHOP = BLUEPRINTS[0] as Blueprint;
const OPTS = { amount: 0.5, wear: 0.3, settled: 0.7 };

/** The outline of a blueprint as its part boxes, rounded: to a twentieth of the footprint across, a quarter metre up. */
function outline(bp: Blueprint): string {
  return expandParts(bp.parts)
    .map((p) => {
      const c = Math.abs(Math.cos((p.rot * Math.PI) / 180));
      const s = Math.abs(Math.sin((p.rot * Math.PI) / 180));
      const hx = (p.w / 2) * c + (p.d / 2) * s;
      const r = (v: number, step: number): number => Math.round(v / step);
      return `${r(p.x - hx, 0.05)},${r(p.x + hx, 0.05)},${r(p.y, 0.25)},${r(p.y + p.h, 0.25)}`;
    })
    .sort()
    .join('|');
}

describe('varyBlueprint', () => {
  it('gives 20 buildings from one blueprint at least 15 outlines, every one of them sound', () => {
    const outlines = new Set<string>();
    const keys = new Set<string>();
    expect(lintBlueprint(SHOP)).toEqual([]);
    for (let i = 0; i < 20; i++) {
      const v = varyBlueprint(SHOP, buildingSeed(99, `b${i}`), OPTS);
      expect(lintBlueprint(v), `building ${i}`).toEqual([]);
      outlines.add(outline(v));
      keys.add(silhouetteKey(v));
    }
    expect(outlines.size).toBeGreaterThanOrEqual(15);
    expect(keys.size).toBeGreaterThanOrEqual(15);
  });

  it('is the same building for the same seed and another for another', () => {
    for (const bp of BLUEPRINTS) {
      const a = varyBlueprint(bp, 4242, OPTS);
      const b = varyBlueprint(bp, 4242, OPTS);
      expect(a).toEqual(b);
    }
    const all = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(varyBlueprint(SHOP, i + 1, OPTS).parts)));
    expect(all.size).toBeGreaterThan(8);
  });

  it('leaves the blueprint alone at amount 0 and never changes the one it was given', () => {
    const before = JSON.stringify(SHOP);
    expect(varyBlueprint(SHOP, 7, { ...OPTS, amount: 0 })).toEqual(SHOP);
    varyBlueprint(SHOP, 7, { ...OPTS, amount: 1, wear: 1 });
    expect(JSON.stringify(SHOP)).toBe(before);
  });

  it('keeps the body standing, the door in reach and every number in range', () => {
    for (const bp of BLUEPRINTS) {
      const clean = lintBlueprint(bp).length;
      for (let i = 0; i < 40; i++) {
        const v = varyBlueprint(bp, buildingSeed(5, `x${i}`), { amount: 1, wear: i % 2 ? 0.9 : 0.2, settled: (i % 5) / 4 });
        const body = v.parts[0];
        expect(body?.shape).toBe(bp.parts[0]?.shape);
        expect(body?.y).toBe(bp.parts[0]?.y);
        expect(Math.abs(v.doorX)).toBeLessThanOrEqual(0.4);
        expect(v.parts.length).toBeLessThanOrEqual(28);
        expect(v.parts.length).toBeGreaterThanOrEqual(4);
        expect(lintBlueprint(v).length, `${bp.id} ${i}`).toBeLessThanOrEqual(clean);
        expect(v.id).toBe(bp.id);
        for (const p of v.parts) {
          for (const n of [p.x, p.z, p.y, p.w, p.d, p.h, p.rot, p.repeat, p.gap]) expect(Number.isFinite(n)).toBe(true);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y + p.h).toBeLessThanOrEqual(60);
          expect(p.h).toBeGreaterThanOrEqual(0.05);
          expect(p.w).toBeGreaterThanOrEqual(0.02);
          expect(p.w).toBeLessThanOrEqual(1.4);
        }
        // The body is never more than MAX_WIDEN wider or narrower.
        const w0 = bp.parts[0]?.w ?? 1;
        expect(Math.abs((body?.w ?? w0) / w0 - 1)).toBeLessThanOrEqual(MAX_WIDEN + 0.002);
      }
    }
  });

  it('changes height by storeys and by eaves, hands buildings both ways round and adds the odd lean-to', () => {
    const heights = new Set<number>();
    let mirrored = 0;
    let annexed = 0;
    const hall = BLUEPRINTS[2] as Blueprint;
    for (let i = 0; i < 60; i++) {
      const v = varyBlueprint(SHOP, buildingSeed(11, `h${i}`), { amount: 0.8, wear: 0.2, settled: 0.2 });
      heights.add(v.parts[0]?.h ?? 0);
      if (v.parts.length > SHOP.parts.length && v.parts.some((p) => p.shape === 'wedge' || (p.tone === 'roof' && p.shape === 'box'))) annexed++;
      const h = varyBlueprint(hall, buildingSeed(11, `h${i}`), { amount: 0.8, wear: 0.2, settled: 0.2 });
      if (Math.sign(h.doorX) !== Math.sign(hall.doorX)) mirrored++;
    }
    // The shop body is 4 m, one storey: some stay near that (eaves a little up or down), some gain a storey or more.
    const tall = [...heights].filter((h) => h > 6.5).length;
    expect(tall).toBeGreaterThan(5);
    expect([...heights].filter((h) => h < 5).length).toBeGreaterThan(5);
    expect(heights.size).toBeGreaterThan(20);
    expect(mirrored).toBeGreaterThan(15);
    expect(mirrored).toBeLessThan(45);
    expect(annexed).toBeGreaterThan(0);
  });

  it('drops and skews more on a worn building than on a kept one', () => {
    const changed = (wear: number): number => {
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const v = varyBlueprint(SHOP, buildingSeed(3, `w${i}`), { amount: 0.6, wear, settled: 0.9 });
        const copies = expandParts(v.parts).filter((p) => p.tone === 'glass').length;
        if (copies < 5 || v.parts.some((p) => Math.abs(p.rot % 90) > 1)) n++;
      }
      return n;
    };
    expect(changed(0.1)).toBe(0);
    expect(changed(1)).toBeGreaterThan(10);
  });

  it('holds for every blueprint of the generated worlds', () => {
    const specs = liveSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(5);
    let distinct = 0;
    let total = 0;
    for (const spec of specs) {
      for (const bp of spec.blueprints ?? []) {
        const clean = lintBlueprint(bp).length;
        const keys = new Set<string>();
        for (let i = 0; i < 6; i++) {
          const v = varyBlueprint(bp, buildingSeed(spec.seed, `b${i}`), { amount: 0.5, wear: spec.style?.surfaces?.wear ?? 0.3, settled: spec.terrain?.settled ?? 0.7 });
          expect(lintBlueprint(v).length, `${spec.title} ${bp.id}`).toBeLessThanOrEqual(clean);
          expect(v.parts.length).toBeLessThanOrEqual(Math.max(28, bp.parts.length));
          keys.add(silhouetteKey(v));
        }
        distinct += keys.size;
        total += 6;
      }
    }
    // Across every world, more than four in five variants have an outline of their own.
    expect(distinct / total).toBeGreaterThan(0.8);
  });
});

describe('assignBlueprints', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const street = (n: number, blueprint?: (i: number) => string | undefined): { id: string; x: number; z: number; blueprint?: string }[] =>
    Array.from({ length: n }, (_, i) => ({ id: `h${i}`, x: i * 11, z: 0, blueprint: blueprint?.(i) }));

  it('never gives neighbours in a 12-building street the same one of 5 blueprints, and uses them all', () => {
    for (const seed of [1, 2, 3, 77]) {
      const got = assignBlueprints(street(12), ids, seed);
      const row = street(12).map((b) => got.get(b.id) as string);
      for (let i = 0; i + 1 < row.length; i++) expect(row[i], `seed ${seed} at ${i}`).not.toBe(row[i + 1]);
      for (let i = 0; i + 2 < row.length; i++) expect(row[i], `seed ${seed} at ${i}`).not.toBe(row[i + 2]);
      expect(new Set(row).size).toBe(5);
      const counts = ids.map((id) => row.filter((r) => r === id).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps what a building names, except an ordinary twin next door in a crowded town', () => {
    // Fewer buildings than blueprints: the model's word stands, twins and all.
    const few = assignBlueprints(street(4, () => 'a'), ids, 1);
    expect([...few.values()]).toEqual(['a', 'a', 'a', 'a']);
    // More buildings than blueprints, all naming one: neighbours are told apart.
    const many = street(12, () => 'a');
    const got = assignBlueprints(many, ids, 1);
    const row = many.map((b) => got.get(b.id) as string);
    for (let i = 0; i + 1 < row.length; i++) expect(row[i]).not.toBe(row[i + 1]);
    expect(row[0]).toBe('a');
    // A key building keeps its blueprint whatever stands beside it.
    const keyed = many.map((b, i) => ({ ...b, keyBuilding: i === 5 || i === 6 }));
    const k = assignBlueprints(keyed, ids, 1);
    expect(k.get('h5')).toBe('a');
    expect(k.get('h6')).toBe('a');
    // An unknown id is treated as none.
    const odd = assignBlueprints(street(3, () => 'nope'), ids, 1);
    for (const v of odd.values()) expect(ids).toContain(v);
    expect(assignBlueprints([], ids, 1).size).toBe(0);
    expect(assignBlueprints(street(3), [], 1).size).toBe(0);
  });
});

describe('planBuildings', () => {
  it('builds no two buildings of a town alike, and is the same plan every time', () => {
    for (const count of [9, 14]) {
      const spec = makeBlueprintSpec({ count });
      const layout = generateLayout(spec);
      const vary = { amount: 0.5, wear: 0.3, settled: 0.7 };
      const plan = planBuildings(layout, spec, spec.blueprints ?? [], vary);
      expect(plan.built.size).toBe(layout.buildings.length);
      const keys = new Set([...plan.built.values()].map((bp) => `${bp.id}|${silhouetteKey(bp)}`));
      expect(keys.size).toBe(layout.buildings.length);
      for (const bp of plan.built.values()) expect(lintBlueprint(bp)).toEqual([]);
      const again = planBuildings(layout, spec, spec.blueprints ?? [], vary);
      expect(again.layout.buildings).toEqual(plan.layout.buildings);
      expect([...again.built.values()]).toEqual([...plan.built.values()]);
    }
  });

  it('sets buildings back by up to MAX_SETBACK in a settled place, clear of each other and of the roads, and leaves the given layout alone', () => {
    const spec = makeBlueprintSpec({ count: 12 });
    const layout = generateLayout(spec);
    const before = JSON.stringify(layout.buildings);
    const plan = planBuildings(layout, spec, spec.blueprints ?? [], { amount: 0.5, wear: 0.3, settled: 0.9 });
    expect(JSON.stringify(layout.buildings)).toBe(before);
    let moved = 0;
    const backs = new Set<number>();
    plan.layout.buildings.forEach((b, i) => {
      const o = layout.buildings[i] as (typeof layout.buildings)[number];
      const back = (b.x - o.x) * Math.sin(o.rotY) + (b.z - o.z) * Math.cos(o.rotY);
      const side = (b.x - o.x) * Math.cos(o.rotY) - (b.z - o.z) * Math.sin(o.rotY);
      expect(back).toBeGreaterThanOrEqual(-1e-9);
      expect(back).toBeLessThanOrEqual(MAX_SETBACK + 1e-9);
      expect(Math.abs(side)).toBeLessThan(1e-9);
      expect(Math.abs(b.rotY - o.rotY)).toBeLessThanOrEqual((1.5 * Math.PI) / 180 + 1e-9);
      if (back > 0.05) moved++;
      backs.add(Math.round(back * 10));
      // The door is 1 m out from the front of the building where it now stands.
      const out = (b.door.x - b.x) * -Math.sin(b.rotY) + (b.door.z - b.z) * -Math.cos(b.rotY);
      expect(out).toBeCloseTo(b.d / 2 + 1, 6);
    });
    expect(moved).toBeGreaterThan(2);
    expect(backs.size).toBeGreaterThan(2);
    const boxes = plan.layout.buildings.map((b) => buildingAabb(b));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i] as (typeof boxes)[number];
        const c = boxes[j] as (typeof boxes)[number];
        expect(a.minX < c.maxX && a.maxX > c.minX && a.minZ < c.maxZ && a.maxZ > c.minZ, `${i} ${j}`).toBe(false);
      }
    }
    // Out in the wild nothing is set back: there is no line to stand back from.
    const wild = planBuildings(layout, spec, spec.blueprints ?? [], { amount: 0.5, wear: 0.3, settled: 0.1 });
    wild.layout.buildings.forEach((b, i) => {
      expect(b.x).toBe(layout.buildings[i]?.x);
      expect(b.z).toBe(layout.buildings[i]?.z);
    });
  });
});

describe('stands and instances', () => {
  it('has smooth noise in 0..1 around a half, and growth that is bare in places and thick in others', () => {
    let sum = 0;
    let bare = 0;
    let thick = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const x = (i % 63) * 9.7;
      const z = Math.floor(i / 63) * 9.7;
      const v = fieldNoise(x / 24, z / 24, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      sum += v;
      const g = growthAt(x, z, 5);
      if (g < 0.2) bare++;
      if (g > 0.8) thick++;
      expect(Math.abs(growthAt(x + 0.5, z, 5) - g)).toBeLessThan(0.15);
    }
    expect(sum / n).toBeGreaterThan(0.42);
    expect(sum / n).toBeLessThan(0.58);
    expect(bare / n).toBeGreaterThan(0.05);
    expect(thick / n).toBeGreaterThan(0.25);
  });

  it('draws kinds by weight when asked plainly and by neighbourhood when asked to mix', () => {
    const w = [4, 3, 1];
    const same = (strength: number): number => {
      let agree = 0;
      let pairs = 0;
      for (let i = 0; i < 3000; i++) {
        const x = ((i * 37) % 400) - 200;
        const z = ((i * 91) % 400) - 200;
        const u = ((i * 0.6180339887) % 1);
        const v = (((i + 0.5) * 0.7548776662) % 1);
        if (mixKind(w, x, z, 9, strength, u) === mixKind(w, x + 2, z + 1, 9, strength, v)) agree++;
        pairs++;
      }
      return agree / pairs;
    };
    // Independent draws at 4:3:1 agree about 41 times in 100; neighbours in a stand agree far more often.
    expect(same(0)).toBeLessThan(0.48);
    expect(same(1)).toBeGreaterThan(same(0) + 0.15);
    expect(mixKind([0, 0], 0, 0, 1, 1, 0.5)).toBe(0);
    expect(mixKind([1, 2, 3], 5, 5, 1, 0, 0.999)).toBe(2);
  });

  it('evens out a wild place: no kind over the cap, and a kind that came up nowhere gets a stand', () => {
    const sites = Array.from({ length: 200 }, (_, i) => ({ x: (i % 20) * 6, z: Math.floor(i / 20) * 6 }));
    const kinds = sites.map(() => 0);
    const weights = [5, 2, 2, 1, 1];
    evenShares(kinds, sites, weights, { open: weights.map(() => true), cap: 0.55, minKinds: 4, seed: 3 });
    const counts = weights.map((_, k) => kinds.filter((v) => v === k).length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(110);
    expect(counts.filter((c) => c > 0).length).toBeGreaterThanOrEqual(4);
    // Closed kinds and locked sites are left as they are; one or two kinds are not capped at all.
    const two = sites.map(() => 0);
    evenShares(two, sites, [5, 1], { open: [true, true], cap: 0.55, minKinds: 4, seed: 3 });
    expect(two.every((k) => k === 0)).toBe(true);
    const locked = sites.map(() => 0);
    evenShares(locked, sites, weights, { open: weights.map(() => true), locked: (i) => i < 150, cap: 0.55, minKinds: 4, seed: 3 });
    expect(locked.slice(0, 150).every((k) => k === 0)).toBe(true);
  });

  it('gives every instance its own size, lean and cast of colour, the same each time', () => {
    const trees = Array.from({ length: 400 }, (_, i) => instanceLook(8, i * 3.1, i * 1.7, 'tree'));
    const scales = trees.map((t) => t.scale);
    // With the slot scale of 0.85 to 1.2 on top, a tree runs from about 0.75 to 1.3, the odd giant beyond.
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.86);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.1 * 1.4 + 1e-9);
    expect(scales.filter((s) => s > 1.12).length).toBeGreaterThan(8);
    expect(scales.filter((s) => s > 1.12).length).toBeLessThan(80);
    expect(scales.filter((s) => s < 0.95).length).toBeGreaterThan(150);
    for (const t of trees) {
      expect(Math.hypot(t.leanX, t.leanZ)).toBeLessThanOrEqual(0.0851);
      expect(Math.abs(t.value - 1)).toBeLessThanOrEqual(0.0801);
      expect(Math.abs(t.warm)).toBeLessThanOrEqual(0.0351);
      expect(t.height).toBeGreaterThan(0.8);
      expect(t.height).toBeLessThan(1.25);
    }
    expect(trees.filter((t) => Math.hypot(t.leanX, t.leanZ) > 0.01).length).toBeGreaterThan(150);
    expect(new Set(scales.map((s) => s.toFixed(3))).size).toBeGreaterThan(100);
    expect(instanceLook(8, 12.5, -3, 'tree')).toEqual(instanceLook(8, 12.5, -3, 'tree'));
    const pole = instanceLook(8, 1, 2, 'pole');
    expect([pole.leanX, pole.leanZ, pole.height, pole.wide, pole.deep, pole.value]).toEqual([0, 0, 1, 1, 1, 1]);
    const thing = instanceLook(8, 1, 2, 'thing');
    expect([thing.leanX, thing.leanZ, thing.height, thing.wide, thing.deep]).toEqual([0, 0, 1, 1, 1]);
    const rock = instanceLook(8, 4, 2, 'grown');
    expect(rock.leanX).toBe(0);
    expect(rock.wide).not.toBe(rock.deep);
  });
});
