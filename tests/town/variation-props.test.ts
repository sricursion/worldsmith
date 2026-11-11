import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GeoBatch, MaterialCache } from '../../app/src/town/batch';
import { generateLayout } from '../../app/src/town/layout';
import type { PlacedProp } from '../../app/src/town/layout';
import {
  WILD_KINDS, WILD_SHARE, buildBackdrop, formOf, grownShare, isNatural, planPropScatter, scatterBlueprintProps, standKinds,
} from '../../app/src/town/props';
import type { PlannedProp, PropMix } from '../../app/src/town/props';
import { makeRng } from '../../app/src/world/rng';
import type { Blueprint, PropBlueprint } from '../../app/src/world/spec';
import { BLUEPRINTS, STYLE, makeBlueprintSpec, part } from './helpers';

vi.setConfig({ testTimeout: 60000 });

const PINE: PropBlueprint = {
  kind: 'pine', size: 3, weight: 5,
  parts: [part('cylinder', { w: 0.1, d: 0.1, h: 0.8 }, 'wall2'), part('cone', { y: 0.6, w: 0.8, d: 0.8, h: 1.4 }, 'roof')],
};
const OAK: PropBlueprint = {
  kind: 'oak', size: 4, weight: 2,
  parts: [part('cylinder', { w: 0.14, d: 0.14, h: 0.7 }, 'wall2'), part('sphere', { y: 0.5, w: 0.9, d: 0.9, h: 0.9 }, 'roof')],
};
const SCRUB: PropBlueprint = { kind: 'scrub', size: 1, weight: 1, parts: [part('sphere', { w: 0.9, d: 0.9, h: 0.7 }, 'roof')] };
const BOULDER: PropBlueprint = { kind: 'boulder', size: 1.6, weight: 1, parts: [part('sphere', { w: 1, d: 0.8, h: 0.7, rot: 20 }, 'wall2')] };
const FERN: PropBlueprint = { kind: 'fern', size: 0.7, weight: 1, parts: [part('cone', { w: 0.9, d: 0.9, h: 0.8 }, 'roof')] };
const SNAG: PropBlueprint = { kind: 'snag', size: 4, weight: 1, parts: [part('cone', { w: 0.08, d: 0.08, h: 1.2, rot: 12 }, 'wall2')] };
const CRATE: PropBlueprint = { kind: 'crate', size: 1, weight: 1, parts: [part('box', { w: 0.9, d: 0.9, h: 0.9 })] };
const LAMP: PropBlueprint = {
  kind: 'street_lamp', size: 3, weight: 3,
  parts: [part('cylinder', { w: 0.06, d: 0.06, h: 2.4 }, 'dark'), part('sphere', { y: 2.2, w: 0.15, d: 0.15, h: 0.2 }, 'glow')],
};
const WILD_KINDS_LIST = [PINE, OAK, SCRUB, BOULDER, FERN, SNAG];

function wildWorld(seed = 21): { slots: PlacedProp[]; layout: ReturnType<typeof generateLayout>; mix: PropMix } {
  const spec = { ...makeBlueprintSpec({ seed, count: 3 }), site: { pattern: 'scatter' as const, wild: 0.85, paths: 'track' as const, spacing: 8 } };
  const layout = generateLayout(spec);
  return { slots: layout.props, layout, mix: { seed, wild: 0.85, settled: 0.05 } };
}

const share = (plan: PlannedProp[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const p of plan) m.set(p.kind.kind, (m.get(p.kind.kind) ?? 0) + 1 / plan.length);
  return m;
};

/** Variance over mean of the number of props per cell: 1 for points thrown down at random, less for even spacing, more for clumps. */
function dispersion(points: readonly { x: number; z: number }[], b: { minX: number; maxX: number; minZ: number; maxZ: number }, cell = 14): number {
  const nx = Math.max(1, Math.floor((b.maxX - b.minX) / cell));
  const nz = Math.max(1, Math.floor((b.maxZ - b.minZ) / cell));
  const counts = new Array<number>(nx * nz).fill(0);
  for (const p of points) {
    const i = Math.floor((p.x - b.minX) / cell);
    const j = Math.floor((p.z - b.minZ) / cell);
    if (i >= 0 && j >= 0 && i < nx && j < nz) counts[j * nx + i] = (counts[j * nx + i] ?? 0) + 1;
  }
  const mean = counts.reduce((a, c) => a + c, 0) / counts.length;
  const variance = counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length;
  return variance / Math.max(1e-9, mean);
}

describe('prop kinds in a wild world', () => {
  it('uses at least four kinds and lets none hold more than 55 percent, over several seeds', () => {
    for (const seed of [21, 22, 23, 24, 25]) {
      const w = wildWorld(seed);
      expect(w.slots.length).toBeGreaterThan(120);
      const plan = planPropScatter(w.slots, WILD_KINDS_LIST, makeRng(seed, 'build'), { layout: w.layout, mix: w.mix });
      const s = share(plan);
      expect(s.size, `seed ${seed}`).toBeGreaterThanOrEqual(WILD_KINDS);
      expect(Math.max(...s.values()), `seed ${seed}`).toBeLessThanOrEqual(WILD_SHARE + 1e-9);
    }
  });

  it('caps a kind that would have taken over, and leaves a spec of one or two kinds as it is', () => {
    const w = wildWorld(31);
    const heavy = [{ ...PINE, weight: 5 }, { ...SCRUB, weight: 1 }, { ...BOULDER, weight: 1 }];
    const flat = share(planPropScatter(w.slots, heavy, makeRng(31, 'build'), { layout: w.layout }));
    expect(flat.get('pine') ?? 0).toBeGreaterThan(0.62);
    const mixed = share(planPropScatter(w.slots, heavy, makeRng(31, 'build'), { layout: w.layout, mix: w.mix }));
    expect(mixed.get('pine') ?? 0).toBeLessThanOrEqual(WILD_SHARE + 1e-9);
    expect(mixed.size).toBe(3);
    const two = share(planPropScatter(w.slots, [{ ...PINE, weight: 5 }, SCRUB], makeRng(31, 'build'), { layout: w.layout, mix: w.mix }));
    expect(two.size).toBe(2);
    const one = share(planPropScatter(w.slots, [PINE], makeRng(31, 'build'), { layout: w.layout, mix: w.mix }));
    expect(one.get('pine')).toBeCloseTo(1, 9);
  });

  it('keeps kinds to their own neighbourhoods', () => {
    const w = wildWorld(41);
    const sameNeighbour = (plan: PlannedProp[]): number => {
      let same = 0;
      for (const p of plan) {
        let best: PlannedProp | null = null;
        let bestD = Infinity;
        for (const q of plan) {
          if (q === p) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bestD) { bestD = d; best = q; }
        }
        if (best && best.kind === p.kind) same++;
      }
      return same / plan.length;
    };
    const flat = planPropScatter(w.slots, WILD_KINDS_LIST, makeRng(41, 'build'), { layout: w.layout });
    const mixed = planPropScatter(w.slots, WILD_KINDS_LIST, makeRng(41, 'build'), { layout: w.layout, mix: w.mix });
    expect(sameNeighbour(mixed)).toBeGreaterThan(sameNeighbour(flat) + 0.12);
  });
});

describe('prop clustering', () => {
  it('gathers props into stands with bare ground between: local density varies more than the even scatter it started from', () => {
    for (const seed of [21, 33, 47]) {
      const w = wildWorld(seed);
      const kinds = [PINE, OAK, SCRUB, BOULDER];
      const flat = planPropScatter(w.slots, kinds, makeRng(seed, 'build'), { layout: w.layout });
      const mixed = planPropScatter(w.slots, kinds, makeRng(seed, 'build'), { layout: w.layout, mix: { ...w.mix, wild: 0.3 } });
      const even = dispersion(flat, w.layout.bounds);
      const clumped = dispersion(mixed, w.layout.bounds);
      expect(clumped, `seed ${seed}`).toBeGreaterThan(even * 1.5);
      // Bare ground is made by moving growth, not by removing it: most of what was there is still there.
      expect(mixed.length).toBeGreaterThan(flat.length * 0.7);
      expect(mixed.length).toBeLessThanOrEqual(flat.length);
      expect(mixed.some((p) => p.added)).toBe(true);
    }
  });

  it('leaves a dense town its street furniture: nothing is thinned beside roads and doors, and nothing is added on them', () => {
    const spec = makeBlueprintSpec({ count: 9 });
    const layout = generateLayout(spec);
    const kinds = [LAMP, CRATE, PINE];
    const flat = planPropScatter(layout.props, kinds, makeRng(1, 'b'), { layout });
    const dense = planPropScatter(layout.props, kinds, makeRng(1, 'b'), { layout, mix: { seed: 1, wild: 0.2, settled: 1 } });
    expect(dense.length).toBe(flat.length);
    expect(dense.some((p) => p.added)).toBe(false);
    const loose = planPropScatter(layout.props, kinds, makeRng(1, 'b'), { layout, mix: { seed: 1, wild: 0.2, settled: 0.2 } });
    for (const p of loose.filter((q) => q.added)) {
      for (const b of layout.buildings) expect(Math.hypot(p.x - b.door.x, p.z - b.door.z)).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('is the same plan for the same seed, and every instance differs from the next', () => {
    const w = wildWorld(55);
    const a = planPropScatter(w.slots, WILD_KINDS_LIST, makeRng(55, 'build'), { layout: w.layout, mix: w.mix });
    const b = planPropScatter(w.slots, WILD_KINDS_LIST, makeRng(55, 'build'), { layout: w.layout, mix: w.mix });
    expect(a).toEqual(b);
    const pines = a.filter((p) => p.kind.kind === 'pine');
    expect(pines.length).toBeGreaterThan(10);
    expect(new Set(pines.map((p) => p.scale.toFixed(3))).size).toBeGreaterThan(pines.length * 0.8);
    expect(pines.some((p) => p.look.leanX !== 0)).toBe(true);
    for (const p of a) {
      expect(p.scale).toBeGreaterThan(0.45);
      expect(p.scale).toBeLessThan(2);
    }
  });

  it('builds what it planned: counts per kind match, and leaning trees are still whole geometry', () => {
    const w = wildWorld(61);
    const plan = planPropScatter(w.slots, WILD_KINDS_LIST, makeRng(61, 'build'), { layout: w.layout, mix: w.mix });
    const batch = new GeoBatch();
    const mats = new MaterialCache();
    const counts = scatterBlueprintProps(w.slots, WILD_KINDS_LIST, STYLE, { batch, mats, rng: makeRng(61, 'build'), layout: w.layout, mix: w.mix });
    expect([...counts.values()].reduce((x, y) => x + y, 0)).toBe(plan.length);
    for (const [kind, n] of counts) expect(n).toBe(plan.filter((p) => p.kind.kind === kind).length);
    const meshes = batch.build();
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 97) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      const col = m.geometry.getAttribute('color');
      expect(col).toBeDefined();
      m.geometry.dispose();
    }
    mats.dispose();
  });
});

describe('what is of the land and what was made', () => {
  it('tells grown form from made form by shape', () => {
    expect(grownShare(BOULDER)).toBe(1);
    expect(grownShare(CRATE)).toBe(0);
    expect(isNatural(PINE)).toBe(true);
    expect(isNatural(CRATE)).toBe(false);
    expect(isNatural(LAMP)).toBe(false);
    expect(formOf(PINE)).toBe('tree');
    expect(formOf(BOULDER)).toBe('grown');
    expect(formOf(LAMP)).toBe('pole');
    expect(formOf(CRATE)).toBe('thing');
  });

  it('fills the middle distance with the land, not with street furniture, and with more than one form where it can', () => {
    const wild = standKinds([PINE, OAK, SCRUB, BOULDER, CRATE, LAMP], 0.05);
    expect(wild.map((e) => e.kind.kind).sort()).toEqual(['boulder', 'oak', 'pine', 'scrub']);
    const total = wild.reduce((n, e) => n + e.weight, 0);
    for (const e of wild) expect(e.weight / total).toBeLessThanOrEqual(WILD_SHARE + 1e-9);
    // A settled place with enough tall growth keeps to it; with only one tall kind the low growth joins in.
    const tall3 = [PINE, OAK, { ...OAK, kind: 'elm' }, SCRUB];
    expect(standKinds(tall3, 0.8).map((e) => e.kind.kind)).toEqual(['pine', 'oak', 'elm']);
    expect(standKinds([PINE, SCRUB, CRATE], 0.8).map((e) => e.kind.kind)).toEqual(['pine', 'scrub']);
    expect(standKinds([CRATE, LAMP], 0.05)).toEqual([]);
  });
});

describe('structures in the middle distance', () => {
  const far = (blueprints: Blueprint[], seed = 7): ReturnType<typeof buildBackdrop> =>
    buildBackdrop({
      layout: { bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 } }, seed, style: STYLE, wild: 0.2, settled: 0.95,
      props: [PINE], blueprints, heightAt: () => 0, waterDepthAt: () => 0, mats: new MaterialCache(), quality: 1, inner: 20,
    });

  it('draws on every blueprint of the world, in more than one version of each, sized by how tall each is', () => {
    const hut: Blueprint = {
      id: 'hut', summary: 'low hut', doorX: 0,
      parts: [part('box', { w: 0.8, d: 0.8, h: 2.6 }), part('gable', { w: 0.9, d: 0.9, y: 2.6, h: 1, tone: 'roof' }),
        part('box', { z: 0.41, w: 0.14, d: 0.03, h: 2, tone: 'dark' }), part('box', { x: 0.25, z: 0.41, y: 1, w: 0.1, d: 0.03, h: 0.7 }, 'glass')],
    };
    const spire: Blueprint = {
      id: 'spire', summary: 'tall spire', doorX: 0,
      parts: [part('box', { w: 0.5, d: 0.5, h: 16 }), part('pyramid', { w: 0.55, d: 0.55, y: 16, h: 6, tone: 'roof' }),
        part('box', { z: 0.26, w: 0.14, d: 0.03, h: 2, tone: 'dark' }), part('box', { z: 0.26, y: 6, w: 0.1, d: 0.03, h: 1 }, 'glass')],
    };
    const all = [...BLUEPRINTS, hut, spire];
    const b = far(all);
    expect(b.structures).toBeGreaterThan(all.length * 2);
    const scales = new Map<string, number[]>();
    const versions = new Map<string, Set<string>>();
    const m4 = new THREE.Matrix4();
    const s = new THREE.Vector3();
    b.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh)) return;
      const [, id, version] = o.name.split(':');
      if (!id || version === undefined) return;
      versions.set(id, (versions.get(id) ?? new Set<string>()).add(version));
      const list = scales.get(id) ?? [];
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4);
        list.push(s.setFromMatrixScale(m4).y);
      }
      scales.set(id, list);
    });
    for (const bp of all) expect(scales.get(bp.id)?.length ?? 0, bp.id).toBeGreaterThan(0);
    expect([...versions.values()].some((v) => v.size > 1)).toBe(true);
    const mean = (id: string): number => { const l = scales.get(id) ?? []; return l.reduce((a, c) => a + c, 0) / Math.max(1, l.length); };
    expect(mean('spire')).toBeGreaterThan(mean('hut') * 1.4);
    expect(mean('hut')).toBeLessThan(2.1);
    b.dispose();
  });

  it('is the same ring for the same seed', () => {
    const a = far(BLUEPRINTS);
    const b = far(BLUEPRINTS);
    expect(a.structures).toBe(b.structures);
    expect(a.plants).toBe(b.plants);
    expect(Array.from(a.solids)).toEqual(Array.from(b.solids));
    a.dispose();
    b.dispose();
  });
});
