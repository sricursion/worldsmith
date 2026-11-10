import { describe, expect, it } from 'vitest';
import { lintBlueprint } from '../../app/src/world/blueprints';
import { makeRng } from '../../app/src/world/rng';
import { buildSkeleton, SKELETONS, skeletonCatalogText } from '../../app/src/world/skeletons';
import type { DialSpec } from '../../app/src/world/skeletons';
import type { BlueprintPart } from '../../app/src/world/spec';

const bp = (parts: BlueprintPart[]) => ({ id: 't', summary: 't', parts, doorX: 0 });
const ids = Object.keys(SKELETONS);

function randomDials(specs: DialSpec[], rng: ReturnType<typeof makeRng>): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const s of specs) {
    if (s.kind === 'choice') out[s.name] = rng.pick(s.choices ?? ['']);
    else out[s.name] = rng.range(s.min ?? 0, s.max ?? 1);
  }
  return out;
}

const numericOk = (parts: BlueprintPart[]): boolean =>
  parts.every((p) => [p.x, p.z, p.y, p.w, p.d, p.h, p.rot, p.repeat, p.gap].every(Number.isFinite));

describe('skeleton catalogue', () => {
  it('has 16 to 20 skeletons, each with five or more becomes and defaults inside range', () => {
    expect(ids.length).toBeGreaterThanOrEqual(16);
    expect(ids.length).toBeLessThanOrEqual(20);
    for (const s of Object.values(SKELETONS)) {
      expect(s.becomes.length, s.id).toBeGreaterThanOrEqual(5);
      expect(s.dials.length, s.id).toBeGreaterThanOrEqual(3);
      for (const d of s.dials) {
        if (d.kind === 'number') {
          expect(typeof d.default, `${s.id}.${d.name}`).toBe('number');
          expect(d.default as number).toBeGreaterThanOrEqual(d.min as number);
          expect(d.default as number).toBeLessThanOrEqual(d.max as number);
        } else expect(d.choices).toContain(d.default);
      }
    }
  });

  it('covers the three groups', () => {
    const groups = new Set(Object.values(SKELETONS).map((s) => s.group));
    expect([...groups].sort()).toEqual(['nature', 'object', 'structure']);
  });

  it('catalogue text is under 6000 characters and names every skeleton and dial', () => {
    const text = skeletonCatalogText();
    expect(text.length).toBeLessThan(6000);
    for (const s of Object.values(SKELETONS)) {
      expect(text).toContain(`${s.id}:`);
      for (const d of s.dials) expect(text, `${s.id}.${d.name}`).toContain(d.name);
    }
  });
});

describe.each(ids)('skeleton %s', (id) => {
  const sk = SKELETONS[id]!;

  it('lints clean with default dials and stays within 28 parts', () => {
    const parts = buildSkeleton(id, undefined, 7);
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts.length).toBeLessThanOrEqual(28);
    expect(numericOk(parts)).toBe(true);
    expect(lintBlueprint(bp(parts))).toEqual([]);
  });

  it('lints clean for 200 random dial settings, with finite numbers', () => {
    const rng = makeRng(1234, id);
    for (let i = 0; i < 200; i++) {
      const dials = randomDials(sk.dials, rng);
      const parts = buildSkeleton(id, dials, rng.int(0, 1e9));
      const msg = `${id} ${JSON.stringify(dials)}`;
      expect(parts.length, msg).toBeLessThanOrEqual(28);
      expect(numericOk(parts), msg).toBe(true);
      expect(lintBlueprint(bp(parts)), msg).toEqual([]);
    }
  });

  it('survives garbage dials', () => {
    const garbage = [
      { storeys: 'many', roof: 42, height: -5, count: Number.NaN, form: {}, top: null, taper: Infinity },
      Object.fromEntries(sk.dials.map((d) => [d.name, d.kind === 'choice' ? 9999 : 'abc'])),
      Object.fromEntries(sk.dials.map((d) => [d.name, d.kind === 'choice' ? 'nonsense' : 1e12])),
      Object.fromEntries(sk.dials.map((d) => [d.name, d.kind === 'choice' ? '' : -1e12])),
    ];
    for (const g of garbage) {
      const parts = buildSkeleton(id, g as unknown as Record<string, number | string>, Number.NaN);
      expect(parts.length).toBeGreaterThanOrEqual(4);
      expect(parts.length).toBeLessThanOrEqual(28);
      expect(numericOk(parts)).toBe(true);
      expect(lintBlueprint(bp(parts))).toEqual([]);
    }
  });

  it('is deterministic for a seed', () => {
    expect(buildSkeleton(id, undefined, 99)).toEqual(buildSkeleton(id, undefined, 99));
  });

  it('dials change the result, so the prompt supplies the body', () => {
    const seen = new Set<string>();
    const rng = makeRng(5, id);
    for (let i = 0; i < 40; i++) seen.add(JSON.stringify(buildSkeleton(id, randomDials(sk.dials, rng), 3)));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('buildSkeleton', () => {
  it('returns [] for unknown or missing family', () => {
    expect(buildSkeleton('nonsense', {}, 1)).toEqual([]);
    expect(buildSkeleton(undefined, {}, 1)).toEqual([]);
    expect(buildSkeleton('', {}, 1)).toEqual([]);
  });

  it('accepts case and aliases', () => {
    expect(buildSkeleton('HALL', {}, 1)).toEqual(buildSkeleton('hall', {}, 1));
    const crystal = buildSkeleton('crystal', {}, 1);
    expect(crystal).toEqual(buildSkeleton('rock', { form: 'crystal' }, 1));
    expect(crystal.some((p) => p.tone === 'glow')).toBe(true);
  });

  it('gives visibly different massing for the same skeleton under different dials', () => {
    const top = (parts: BlueprintPart[]): number => Math.max(...parts.map((p) => p.y + p.h));
    expect(top(buildSkeleton('hall', { storeys: 1, roof: 'flat' }, 1))).toBeLessThan(top(buildSkeleton('hall', { storeys: 4, roof: 'pyramid' }, 1)));
    const forest = buildSkeleton('tree', { crown: 'cone' }, 1).map((p) => p.shape);
    const desert = buildSkeleton('tree', { crown: 'cactus' }, 1).map((p) => p.shape);
    expect(forest).not.toEqual(desert);
  });
});
