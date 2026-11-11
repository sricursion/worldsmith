import { describe, expect, it } from 'vitest';
import { expandParts, lintBlueprint } from '../../app/src/world/blueprints';
import { makeRng } from '../../app/src/world/rng';
import { buildSkeleton } from '../../app/src/world/skeletons';
import { NATURE_SKELETONS } from '../../app/src/world/skeletons/nature';
import { dialsFor } from '../../app/src/world/skeletons/nature-util';
import type { Skeleton } from '../../app/src/world/skeletons';
import type { BlueprintPart } from '../../app/src/world/spec';

type DialSet = Record<string, number | string>;
interface Box { w: number; d: number; h: number }
const bp = (parts: BlueprintPart[]) => ({ id: 't', summary: 't', parts, doorX: 0 });
const NEW = NATURE_SKELETONS.filter((s) => s.id !== 'tree' && s.id !== 'rock');

/** Builds a skeleton the way the registry does: resolved dials, an rng salted with the id. */
function make(sk: Skeleton, dials: DialSet, seed: number): BlueprintPart[] {
  return sk.build(dialsFor(sk, dials), makeRng(seed, sk.id));
}

function randomDials(sk: Skeleton, rng: ReturnType<typeof makeRng>): DialSet {
  const out: DialSet = {};
  for (const s of sk.dials) out[s.name] = s.kind === 'choice' ? rng.pick(s.choices ?? ['']) : rng.range(s.min ?? 0, s.max ?? 1);
  return out;
}

/** True when a part is already inside the limits every blueprint part is clamped to. */
function inLimits(p: BlueprintPart): boolean {
  return [p.x, p.z, p.y, p.w, p.d, p.h, p.rot, p.repeat, p.gap].every(Number.isFinite) &&
    Math.abs(p.x) <= 0.5 && Math.abs(p.z) <= 0.5 && p.y >= 0 && p.y <= 30 &&
    p.w >= 0.02 && p.w <= 1.4 && p.d >= 0.02 && p.d <= 1.4 && p.h >= 0.05 && p.h <= 30 &&
    Number.isInteger(p.repeat) && p.repeat >= 1 && p.repeat <= 12 && p.gap >= 0 && p.gap <= 1.4;
}

function bounds(parts: BlueprintPart[]): Box {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let h = 0;
  for (const p of expandParts(parts)) {
    const r = Math.hypot(p.w, p.d) / 2;
    x0 = Math.min(x0, p.x - r);
    x1 = Math.max(x1, p.x + r);
    z0 = Math.min(z0, p.z - r);
    z1 = Math.max(z1, p.z + r);
    h = Math.max(h, p.y + p.h);
  }
  return { w: x1 - x0, d: z1 - z0, h };
}

/** Largest relative difference between two boxes along any axis. */
function boxGap(a: Box, b: Box): number {
  const rel = (p: number, q: number): number => Math.abs(p - q) / Math.max(p, q);
  return Math.max(rel(a.w, b.w), rel(a.d, b.d), rel(a.h, b.h));
}

describe('nature catalogue', () => {
  it('lists the old ids and the eleven families, each with what it becomes and dials inside range', () => {
    expect(NATURE_SKELETONS.map((s) => s.id)).toEqual([
      'tree', 'rock', 'broadleaf', 'conifer', 'palm', 'succulent', 'fungus', 'shrub', 'grassclump', 'vine', 'deadwood', 'boulder', 'crystal',
    ]);
    for (const s of NATURE_SKELETONS) {
      expect(s.group, s.id).toBe('nature');
      expect(s.becomes.length, s.id).toBeGreaterThanOrEqual(5);
      expect(s.dials.length, s.id).toBeGreaterThanOrEqual(3);
      for (const d of s.dials) {
        expect(d.meaning.length, `${s.id}.${d.name}`).toBeGreaterThan(0);
        if (d.kind === 'number') {
          expect(d.default as number, `${s.id}.${d.name}`).toBeGreaterThanOrEqual(d.min as number);
          expect(d.default as number, `${s.id}.${d.name}`).toBeLessThanOrEqual(d.max as number);
        } else expect(d.choices, `${s.id}.${d.name}`).toContain(d.default);
      }
    }
  });
});

describe.each(NATURE_SKELETONS.map((s) => [s.id, s] as const))('nature skeleton %s', (_id, sk) => {
  it('lints clean at its defaults, within 28 parts and the part limits', () => {
    const parts = make(sk, {}, 7);
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts.length).toBeLessThanOrEqual(28);
    expect(parts.every(inLimits)).toBe(true);
    expect(lintBlueprint(bp(parts))).toEqual([]);
  });

  it('lints clean for 200 random dial sets', () => {
    const rng = makeRng(4321, sk.id);
    for (let i = 0; i < 200; i++) {
      const dials = randomDials(sk, rng);
      const parts = make(sk, dials, rng.int(0, 1e9));
      const msg = `${sk.id} ${JSON.stringify(dials)}`;
      expect(parts.length, msg).toBeGreaterThanOrEqual(4);
      expect(parts.length, msg).toBeLessThanOrEqual(28);
      expect(parts.every(inLimits), msg).toBe(true);
      expect(lintBlueprint(bp(parts)), msg).toEqual([]);
    }
  });

  it('lints clean with every number dial at its least and at its most, for each choice', () => {
    const choice = sk.dials.find((d) => d.kind === 'choice');
    for (const pick of choice?.choices ?? ['']) {
      for (const end of ['min', 'max'] as const) {
        const dials: DialSet = {};
        for (const d of sk.dials) dials[d.name] = d.kind === 'choice' ? (d === choice ? pick : d.default) : ((end === 'min' ? d.min : d.max) ?? 0);
        const parts = make(sk, dials, 11);
        const msg = `${sk.id} ${pick} ${end}`;
        expect(parts.length, msg).toBeGreaterThanOrEqual(4);
        expect(parts.length, msg).toBeLessThanOrEqual(28);
        expect(parts.every(inLimits), msg).toBe(true);
        expect(lintBlueprint(bp(parts)), msg).toEqual([]);
      }
    }
  });

  it('is deterministic for a seed and changes with it', () => {
    expect(make(sk, {}, 99)).toEqual(make(sk, {}, 99));
    expect(make(sk, {}, 99)).not.toEqual(make(sk, {}, 100));
  });

  it('glows only when asked to', () => {
    if (!sk.dials.some((d) => d.name === 'glow')) return;
    const rng = makeRng(77, sk.id);
    for (let i = 0; i < 60; i++) {
      const dials = { ...randomDials(sk, rng), glow: 0 };
      expect(make(sk, dials, i).some((p) => p.tone === 'glow'), JSON.stringify(dials)).toBe(false);
    }
    expect(make(sk, { glow: 1 }, 3).some((p) => p.tone === 'glow')).toBe(true);
  });
});

describe.each(NEW.map((s) => [s.id, s] as const))('family %s', (_id, sk) => {
  it('has clearly different bounding boxes at its defaults and two random settings', () => {
    const rng = makeRng(2025, sk.id);
    const a = bounds(make(sk, {}, 1));
    const b = bounds(make(sk, randomDials(sk, rng), 2));
    const c = bounds(make(sk, randomDials(sk, rng), 3));
    expect(boxGap(a, b)).toBeGreaterThan(0.1);
    expect(boxGap(a, c)).toBeGreaterThan(0.1);
    expect(boxGap(b, c)).toBeGreaterThan(0.1);
  });

  it('is built from 6 to 22 parts at its defaults, of at least three shapes', () => {
    const parts = make(sk, {}, 7);
    expect(parts.length).toBeGreaterThanOrEqual(6);
    expect(parts.length).toBeLessThanOrEqual(22);
    expect(new Set(parts.map((p) => p.shape)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('families are structurally different', () => {
  it('no two families share a shape sequence at their defaults', () => {
    const seen = new Set(NEW.map((sk) => make(sk, {}, 7).map((p) => p.shape).join(',')));
    expect(seen.size).toBe(NEW.length);
  });

  it('a tree crown is several masses of differing size, not one ball', () => {
    const broadleaf = NEW.find((s) => s.id === 'broadleaf') as Skeleton;
    const crown = make(broadleaf, {}, 7).filter((p) => p.tone === 'accent' && p.shape === 'sphere');
    expect(crown.length).toBeGreaterThanOrEqual(3);
    expect(new Set(crown.map((p) => p.w.toFixed(2))).size).toBe(crown.length);
    expect(new Set(crown.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size).toBe(crown.length);
  });
});

describe('old ids', () => {
  it('tree still builds with its old dial names, and every crown lints clean', () => {
    const crowns = ['ball', 'cone', 'layers', 'umbrella', 'weeping', 'dead', 'palm', 'cactus', 'giant-mushroom', 'bush', 'reeds', 'fern', 'flowers'];
    const seen = new Set<string>();
    for (const crown of crowns) {
      const parts = buildSkeleton('tree', { trunk: 1.2, crown, crownSize: 0.6, lean: 0.3 }, 5);
      expect(parts.length, crown).toBeGreaterThanOrEqual(4);
      expect(parts.length, crown).toBeLessThanOrEqual(28);
      expect(lintBlueprint(bp(parts)), crown).toEqual([]);
      seen.add(parts.map((p) => p.shape).join(','));
    }
    expect(seen.size).toBe(crowns.length);
    const top = (parts: BlueprintPart[]): number => Math.max(...parts.map((p) => p.y + p.h));
    expect(top(buildSkeleton('tree', { trunk: 2 }, 5))).toBeGreaterThan(top(buildSkeleton('tree', { trunk: 0.3 }, 5)));
    expect(bounds(buildSkeleton('tree', { crownSize: 0.85 }, 5)).w).toBeGreaterThan(bounds(buildSkeleton('tree', { crownSize: 0.3 }, 5)).w);
  });

  it('rock still builds with its old dial names, in both forms', () => {
    const boulders = buildSkeleton('rock', { form: 'boulder', count: 5, height: 0.8, jagged: 0.9, flat: 0.1 }, 5);
    const crystals = buildSkeleton('rock', { form: 'crystal', count: 5, height: 0.8, jagged: 0.9, flat: 0.1 }, 5);
    for (const parts of [boulders, crystals]) {
      expect(parts.length).toBeGreaterThanOrEqual(4);
      expect(lintBlueprint(bp(parts))).toEqual([]);
    }
    expect(boulders.some((p) => p.tone === 'glow')).toBe(false);
    expect(crystals.some((p) => p.tone === 'glow')).toBe(true);
    // 'crystal' builds whether the registry folds it into rock or reaches the family of that name.
    const named = buildSkeleton('crystal', {}, 1);
    expect(named.length).toBeGreaterThanOrEqual(4);
    expect(lintBlueprint(bp(named))).toEqual([]);
    expect(named.some((p) => p.tone === 'glow')).toBe(true);
    expect(named.some((p) => p.tone === 'glass')).toBe(true);
    // Sharp boulders are blocks with a sloped face, not a row of spikes.
    expect(boulders.some((p) => p.shape === 'cone' || p.shape === 'pyramid')).toBe(false);
  });
});
