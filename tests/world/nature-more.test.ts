import { describe, expect, it } from 'vitest';
import { expandParts, lintBlueprint } from '../../app/src/world/blueprints';
import { makeRng } from '../../app/src/world/rng';
import { buildSkeleton, SKELETONS } from '../../app/src/world/skeletons';
import type { BlueprintPart } from '../../app/src/world/spec';

type DialSet = Record<string, number | string>;
const NEW = ['coral', 'lily', 'flower', 'crop', 'pod', 'pinnacle', 'vent', 'mound'];
const FIXED = ['vine', 'shrub', 'boulder'];
const bp = (parts: BlueprintPart[]) => ({ id: 't', summary: 't', parts, doorX: 0 });
const inClamp = (p: BlueprintPart): boolean =>
  Math.abs(p.x) <= 0.5 && Math.abs(p.z) <= 0.5 && p.y >= 0 && p.w >= 0.02 && p.w <= 1.4 && p.d >= 0.02 && p.d <= 1.4 && p.h >= 0.05;

function check(id: string, dials: DialSet, seed: number): BlueprintPart[] {
  const parts = buildSkeleton(id, dials, seed);
  const msg = `${id} ${JSON.stringify(dials)}`;
  expect(parts.length, msg).toBeGreaterThanOrEqual(4);
  expect(parts.length, msg).toBeLessThanOrEqual(28);
  expect(parts.every(inClamp), msg).toBe(true);
  expect(lintBlueprint(bp(parts)), msg).toEqual([]);
  return parts;
}

function randomDials(id: string, rng: ReturnType<typeof makeRng>, fixed: DialSet = {}): DialSet {
  const out: DialSet = {};
  for (const d of SKELETONS[id]!.dials) out[d.name] = d.kind === 'choice' ? rng.pick(d.choices ?? ['']) : rng.range(d.min ?? 0, d.max ?? 1);
  return { ...out, ...fixed };
}

describe.each([...NEW, ...FIXED])('nature family %s', (id) => {
  const sk = SKELETONS[id]!;

  it('builds 4 to 28 sound parts at defaults, at each end of every number dial and for every choice', () => {
    check(id, {}, 7);
    for (const d of sk.dials) {
      const values = d.kind === 'choice' ? (d.choices ?? []) : [d.min ?? 0, d.max ?? 1];
      for (const v of values) check(id, { [d.name]: v }, 7);
    }
    const form = sk.dials.find((d) => d.kind === 'choice');
    for (const pick of form?.choices ?? ['']) {
      for (const end of ['min', 'max'] as const) {
        const dials: DialSet = {};
        for (const d of sk.dials) dials[d.name] = d.kind === 'choice' ? (d === form ? pick : d.default) : ((end === 'min' ? d.min : d.max) ?? 0);
        check(id, dials, 11);
      }
    }
  });

  it('stays sound for 200 random dial sets', () => {
    const rng = makeRng(31, id);
    for (let i = 0; i < 200; i++) check(id, randomDials(id, rng), rng.int(0, 1e9));
  });
});

describe.each(NEW)('new family %s', (id) => {
  it('becomes six or more things and has four or more dials', () => {
    expect(SKELETONS[id]!.becomes.length).toBeGreaterThanOrEqual(6);
    expect(SKELETONS[id]!.dials.length).toBeGreaterThanOrEqual(4);
  });
});

describe('vine', () => {
  const supports = SKELETONS.vine!.dials[0]!.choices ?? [];

  it('never has a long level bar held up in the air, whatever carries it', () => {
    const rng = makeRng(5, 'vine-bar');
    for (const support of supports) {
      for (let i = 0; i < 80; i++) {
        const parts = expandParts(buildSkeleton('vine', randomDials('vine', rng, { support }), i));
        const bar = parts.find((p) => (p.shape === 'box' || p.shape === 'cylinder' || p.shape === 'arch') && p.y > 0.25 && Math.max(p.w, p.d) >= 0.45 && p.h <= 0.25);
        expect(bar, `${support} ${i}`).toBeUndefined();
      }
    }
  });

  it('as a curtain is hanging strands of uneven length with no post wider than a liana', () => {
    const rng = makeRng(6, 'vine-curtain');
    for (let i = 0; i < 60; i++) {
      const dials = randomDials('vine', rng, { support: 'curtain' });
      const parts = buildSkeleton('vine', dials, i);
      const strands = parts.filter((p) => p.shape === 'box' && p.w <= 0.03);
      expect(strands.length, JSON.stringify(dials)).toBeGreaterThanOrEqual(2);
      expect(new Set(strands.map((p) => p.h.toFixed(3))).size, JSON.stringify(dials)).toBeGreaterThanOrEqual(Math.min(3, strands.length));
      const posts = parts.filter((p) => p.y <= 0.05 && p.tone === 'wall2' && p.h > 0.3 && Math.max(p.w, p.d) > 0.06 && p.shape !== 'sphere');
      expect(posts, JSON.stringify(dials)).toEqual([]);
    }
  });

  it('as a swag dips well below the lower of its two supports', () => {
    for (const sag of [0, 0.5, 1]) {
      const parts = buildSkeleton('vine', { support: 'swag', length: 2, sag }, 4);
      const lobes = parts.filter((p) => p.shape === 'sphere' && p.z === 0 && p.d < 0.2);
      expect(lobes.length).toBeGreaterThanOrEqual(6);
      const ends = Math.min(...lobes.filter((p) => Math.abs(p.x) > 0.3).map((p) => p.y + p.h));
      const low = Math.min(...lobes.map((p) => p.y));
      expect(ends - low).toBeGreaterThan(0.25);
    }
  });
});

describe('fern and tangle', () => {
  /** Round parts that share an axis, from the lowest up. */
  function stacks(parts: BlueprintPart[]): BlueprintPart[][] {
    const round = expandParts(parts).filter((p) => p.shape === 'sphere' || p.shape === 'ring' || p.shape === 'dome' || p.shape === 'cylinder');
    const groups = new Map<string, BlueprintPart[]>();
    for (const p of round) {
      const key = `${Math.round(p.x / 0.04)},${Math.round(p.z / 0.04)}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    return [...groups.values()].map((g) => g.sort((a, b) => a.y - b.y));
  }

  it('no shrub is a ball banded in alternating tones up its height, and none is hooped', () => {
    const rng = makeRng(8, 'bands');
    for (let i = 0; i < 400; i++) {
      const dials = randomDials('shrub', rng);
      const parts = buildSkeleton('shrub', dials, i);
      for (const g of stacks(parts)) {
        const wide = g.filter((p) => Math.min(p.w, p.d) > 0.15);
        let flips = 0;
        for (let j = 0; j + 1 < wide.length; j++) if (wide[j]!.tone !== wide[j + 1]!.tone && wide[j + 1]!.y > wide[j]!.y + 0.01) flips++;
        expect(flips, JSON.stringify(dials)).toBeLessThan(2);
      }
      expect(parts.some((p) => p.shape === 'ring'), JSON.stringify(dials)).toBe(false);
    }
  });

  it('the fern is fronds that arch and lean out of a crown, with no ball in it', () => {
    const parts = buildSkeleton('shrub', { form: 'fern', stems: 5 }, 3);
    expect(parts.filter((p) => p.shape === 'dome' && p.d <= 0.13).length).toBeGreaterThanOrEqual(4);
    expect(parts.filter((p) => p.shape === 'wedge').length).toBeGreaterThanOrEqual(4);
    expect(parts.some((p) => p.shape === 'sphere' && p.w > 0.15)).toBe(false);
  });
});

describe('boulder', () => {
  it('is never built from blocks: no box but a glowing seam, at any angularity', () => {
    const rng = makeRng(9, 'boulder');
    for (let i = 0; i < 200; i++) {
      const dials = randomDials('boulder', rng);
      const parts = buildSkeleton('boulder', dials, i);
      expect(parts.some((p) => p.shape === 'box' && p.tone !== 'glow'), JSON.stringify(dials)).toBe(false);
    }
  });

  it('when fractured is faces sloping different ways to different heights', () => {
    const faces = buildSkeleton('boulder', { angular: 1, scatter: 0, moss: 0 }, 2).filter((p) => p.shape === 'wedge' && p.h > 0.2);
    expect(faces.length).toBeGreaterThanOrEqual(4);
    expect(new Set(faces.map((p) => Math.round(p.rot))).size).toBe(faces.length);
    expect(new Set(faces.map((p) => p.h.toFixed(2))).size).toBe(faces.length);
  });
});
