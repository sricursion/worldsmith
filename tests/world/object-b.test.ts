import { describe, expect, it } from 'vitest';
import { lintBlueprint } from '../../app/src/world/blueprints';
import { makeRng } from '../../app/src/world/rng';
import { buildSkeleton, SKELETONS } from '../../app/src/world/skeletons';
import type { BlueprintPart } from '../../app/src/world/spec';

const IDS = ['vehicle', 'machine', 'fence', 'stall'];
const bp = (parts: BlueprintPart[]) => ({ id: 't', summary: 't', parts, doorX: 0 });
const inClamp = (p: BlueprintPart): boolean =>
  Math.abs(p.x) <= 0.5 && Math.abs(p.z) <= 0.5 && p.y >= 0 && p.w >= 0.02 && p.w <= 1.4 && p.d >= 0.02 && p.d <= 1.4 && p.h >= 0.05;

function check(id: string, dials: Record<string, number | string>, seed: number): BlueprintPart[] {
  const parts = buildSkeleton(id, dials, seed);
  const msg = `${id} ${JSON.stringify(dials)}`;
  expect(parts.length, msg).toBeGreaterThanOrEqual(4);
  expect(parts.length, msg).toBeLessThanOrEqual(28);
  expect(parts.every(inClamp), msg).toBe(true);
  expect(lintBlueprint(bp(parts)), msg).toEqual([]);
  return parts;
}

describe.each(IDS)('object family %s', (id) => {
  const sk = SKELETONS[id]!;

  it('is registered with six or more things it becomes and four or more dials', () => {
    expect(sk.group).toBe('object');
    expect(sk.becomes.length).toBeGreaterThanOrEqual(6);
    expect(sk.dials.length).toBeGreaterThanOrEqual(4);
  });

  it('builds 4 to 28 sound parts at defaults, at each end of every number dial and for every choice', () => {
    check(id, {}, 7);
    for (const d of sk.dials) {
      const values = d.kind === 'choice' ? (d.choices ?? []) : [d.min ?? 0, d.max ?? 1];
      for (const v of values) check(id, { [d.name]: v }, 7);
    }
    const form = sk.dials.find((d) => d.kind === 'choice');
    for (const pick of form?.choices ?? []) {
      for (const end of ['min', 'max'] as const) {
        const dials: Record<string, number | string> = {};
        for (const d of sk.dials) dials[d.name] = d.kind === 'choice' ? pick : ((end === 'min' ? d.min : d.max) ?? 0);
        check(id, dials, 11);
      }
    }
  });

  it('stays sound for 200 random dial sets', () => {
    const rng = makeRng(99, id);
    for (let i = 0; i < 200; i++) {
      const dials: Record<string, number | string> = {};
      for (const d of sk.dials) dials[d.name] = d.kind === 'choice' ? rng.pick(d.choices ?? ['']) : rng.range(d.min ?? 0, d.max ?? 1);
      check(id, dials, rng.int(0, 1e9));
    }
  });

  it('every choice of form gives a different build', () => {
    const form = sk.dials.find((d) => d.kind === 'choice')!;
    const seen = new Set((form.choices ?? []).map((c) => JSON.stringify(buildSkeleton(id, { [form.name]: c }, 3).map((p) => [p.shape, Math.round(p.h * 10), Math.round(p.d * 100)]))));
    expect(seen.size).toBe((form.choices ?? []).length);
  });
});
