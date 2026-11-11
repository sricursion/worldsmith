import { describe, expect, it } from 'vitest';
import { expandParts, lintBlueprint } from '../../app/src/world/blueprints';
import { makeRng } from '../../app/src/world/rng';
import { buildSkeleton, RUIN_DIAL, SKELETONS, skeletonCatalogText } from '../../app/src/world/skeletons';
import type { DialSpec } from '../../app/src/world/skeletons';
import type { BlueprintPart } from '../../app/src/world/spec';

const bp = (parts: BlueprintPart[]) => ({ id: 't', summary: 't', parts, doorX: 0 });
const ids = Object.keys(SKELETONS);
const NEW_FAMILIES = ['cliff', 'cave', 'ruin', 'bridge', 'stair', 'gantry', 'stack', 'mast', 'pit', 'colonnade', 'wreck', 'megastructure'];

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
  it('has 37 or more skeletons, each with five or more becomes and defaults inside range', () => {
    expect(ids.length).toBeGreaterThanOrEqual(37);
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

  it('catalogue text is at most 13500 characters and names every skeleton and dial', () => {
    const text = skeletonCatalogText();
    expect(text.length).toBeLessThanOrEqual(13500);
    for (const s of Object.values(SKELETONS)) {
      expect(text).toContain(`${s.id}:`);
      const line = text.split('\n').find((l) => l.startsWith(`${s.id}: `)) ?? '';
      for (const d of s.dials) expect(line, `${s.id}.${d.name}`).toMatch(new RegExp(`[);] ${d.name}( |;|$)`));
    }
  });

  it('catalogue is grouped structure, nature, object and documents the ruin dial once, in the header', () => {
    const text = skeletonCatalogText();
    const at = ['== structure', '== nature', '== object'].map((t) => text.indexOf(t));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text.slice(0, at[0])).toContain(`${RUIN_DIAL.name} (`);
    expect(text.split('stand as its own ruin').length).toBe(2);
  });

  it('registers the twelve wild, ruined and vertical structure families, each becoming six or more things', () => {
    for (const id of NEW_FAMILIES) {
      const s = SKELETONS[id];
      expect(s?.group, id).toBe('structure');
      expect(s?.becomes.length, id).toBeGreaterThanOrEqual(6);
    }
  });
});

/** Outline of a part list: overall extent to the nearest step, and how many parts of each shape. */
function silhouette(parts: BlueprintPart[]): string {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
  const shapes: Record<string, number> = {};
  for (const p of expandParts(parts)) {
    const hx = Math.max(p.w, p.d) / 2;
    x0 = Math.min(x0, p.x - hx); x1 = Math.max(x1, p.x + hx);
    z0 = Math.min(z0, p.z - hx); z1 = Math.max(z1, p.z + hx);
    top = Math.max(top, p.y + p.h);
    shapes[p.shape] = (shapes[p.shape] ?? 0) + 1;
  }
  const r = (n: number): number => Math.round(n * 10);
  return JSON.stringify([r(x1 - x0), r(z1 - z0), r(top), Object.entries(shapes).sort()]);
}

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

  it('two random settings do not share a silhouette: extent or shape counts differ', () => {
    const rng = makeRng(77, id);
    const seen = new Set<string>();
    let twins = 0;
    for (let i = 0; i < 30; i++) {
      const a = silhouette(buildSkeleton(id, randomDials(sk.dials, rng), 11));
      const b = silhouette(buildSkeleton(id, randomDials(sk.dials, rng), 11));
      if (a === b) twins++;
      seen.add(a).add(b);
    }
    // The new structure families are held to the strict bar; the few-dial older ones to a looser one.
    const strict = NEW_FAMILIES.includes(id);
    expect(twins, id).toBeLessThanOrEqual(strict ? 0 : 6);
    expect(seen.size, id).toBeGreaterThanOrEqual(strict ? 50 : 24);
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

describe.each(ids.filter((id) => SKELETONS[id]?.group === 'structure'))('ruin dial on %s', (id) => {
  const sk = SKELETONS[id]!;
  const height = (parts: BlueprintPart[]): number => Math.max(...parts.map((p) => p.y + p.h));

  it('lints clean at default dials for every degree of ruin', () => {
    for (const ruin of [0.1, 0.3, 0.5, 0.75, 1]) {
      const parts = buildSkeleton(id, { ruin }, 7);
      expect(parts.length, `${id} ruin ${ruin}`).toBeLessThanOrEqual(28);
      expect(numericOk(parts)).toBe(true);
      expect(lintBlueprint(bp(parts)), `${id} ruin ${ruin}`).toEqual([]);
    }
  });

  it('lints clean for 200 random dial settings with a random degree of ruin', () => {
    const rng = makeRng(4321, id);
    for (let i = 0; i < 200; i++) {
      const dials = { ...randomDials(sk.dials, rng), ruin: rng.range(0, 1) };
      const parts = buildSkeleton(id, dials, rng.int(0, 1e9));
      const msg = `${id} ${JSON.stringify(dials)}`;
      expect(parts.length, msg).toBeLessThanOrEqual(28);
      expect(numericOk(parts), msg).toBe(true);
      expect(lintBlueprint(bp(parts)), msg).toEqual([]);
    }
  });

  it('leaves a whole structure untouched, and a ruined one lower, different and seeded', () => {
    expect(buildSkeleton(id, { ruin: 0 }, 5)).toEqual(buildSkeleton(id, undefined, 5));
    const whole = buildSkeleton(id, undefined, 5);
    const gone = buildSkeleton(id, { ruin: 1 }, 5);
    expect(gone).not.toEqual(whole);
    expect(gone).toEqual(buildSkeleton(id, { ruin: 1 }, 5));
    expect(height(gone)).toBeLessThan(height(whole));
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(buildSkeleton(id, { ruin: 0.7 }, s).map((p) => [p.shape, Math.round(p.h * 10)]))));
    expect(seeds.size, id).toBeGreaterThanOrEqual(3);
  });
});

describe('buildSkeleton', () => {
  it('ignores the ruin dial outside the structure group', () => {
    for (const s of Object.values(SKELETONS)) {
      if (s.group !== 'structure') expect(buildSkeleton(s.id, { ruin: 1 }, 3), s.id).toEqual(buildSkeleton(s.id, undefined, 3));
    }
  });

  it('returns [] for unknown or missing family', () => {
    expect(buildSkeleton('nonsense', {}, 1)).toEqual([]);
    expect(buildSkeleton(undefined, {}, 1)).toEqual([]);
    expect(buildSkeleton('', {}, 1)).toEqual([]);
  });

  it('accepts case and aliases', () => {
    expect(buildSkeleton('HALL', {}, 1)).toEqual(buildSkeleton('hall', {}, 1));
    expect(buildSkeleton('monolith', { form: 'ring' }, 1)).toEqual(buildSkeleton('megastructure', { form: 'slab' }, 1));
    expect(buildSkeleton('crane', { load: 'claw' }, 1)).toEqual(buildSkeleton('gantry', { load: 'claw' }, 1));
    // A family registered under a name that is also an alias is built as itself.
    for (const id of ids) expect(buildSkeleton(id, {}, 1).length, id).toBeGreaterThanOrEqual(4);
    if (SKELETONS.crystal) expect(buildSkeleton('crystal', {}, 1)).not.toEqual(buildSkeleton('rock', { form: 'crystal' }, 1));
  });

  it('gives visibly different massing for the same skeleton under different dials', () => {
    const top = (parts: BlueprintPart[]): number => Math.max(...parts.map((p) => p.y + p.h));
    expect(top(buildSkeleton('hall', { storeys: 1, roof: 'flat' }, 1))).toBeLessThan(top(buildSkeleton('hall', { storeys: 4, roof: 'pyramid' }, 1)));
    const forest = buildSkeleton('tree', { crown: 'cone' }, 1).map((p) => p.shape);
    const desert = buildSkeleton('tree', { crown: 'cactus' }, 1).map((p) => p.shape);
    expect(forest).not.toEqual(desert);
  });
});
