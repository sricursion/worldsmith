import { describe, expect, it } from 'vitest';
import { expandParts, lintBlueprint } from '../../app/src/world/blueprints';
import { makeRng } from '../../app/src/world/rng';
import { buildSkeleton, SKELETONS } from '../../app/src/world/skeletons';
import type { BlueprintPart } from '../../app/src/world/spec';

const FAMILIES = ['keep', 'arena', 'tank', 'pier', 'terrace'];
const bp = (parts: BlueprintPart[]) => ({ id: 't', summary: 't', parts, doorX: 0 });

/** Furthest any copy of any part reaches from the middle of the footprint, as a fraction of it. */
function reach(parts: BlueprintPart[]): number {
  let r = 0;
  for (const p of expandParts(parts)) {
    const c = Math.abs(Math.cos((p.rot * Math.PI) / 180));
    const s = Math.abs(Math.sin((p.rot * Math.PI) / 180));
    const hx = (p.w / 2) * c + (p.d / 2) * s;
    const hz = (p.w / 2) * s + (p.d / 2) * c;
    r = Math.max(r, Math.abs(p.x) + hx, Math.abs(p.z) + hz);
  }
  return r;
}

function sound(id: string, dials: Record<string, number | string>, seed = 7): void {
  const msg = `${id} ${JSON.stringify(dials)}`;
  const parts = buildSkeleton(id, dials, seed);
  expect(parts.length, msg).toBeGreaterThanOrEqual(4);
  expect(parts.length, msg).toBeLessThanOrEqual(28);
  expect(lintBlueprint(bp(parts)), msg).toEqual([]);
  // Nothing reaches past the line in front of the door that has to stay walkable.
  expect(reach(parts), msg).toBeLessThanOrEqual(0.56);
}

describe.each(FAMILIES)('structure family %s', (id) => {
  const sk = SKELETONS[id]!;

  it('is a general structure family with four or more dials', () => {
    expect(sk.group).toBe('structure');
    expect(sk.becomes.length).toBeGreaterThanOrEqual(6);
    expect(sk.dials.length).toBeGreaterThanOrEqual(4);
  });

  it('builds 12 or more parts at default dials', () => {
    sound(id, {});
    expect(buildSkeleton(id, {}, 7).length).toBeGreaterThanOrEqual(12);
  });

  it('is sound at both ends of every number dial and for every choice, whole and ruined', () => {
    for (const dial of sk.dials) {
      const values = dial.kind === 'choice' ? (dial.choices ?? []) : [dial.min ?? 0, dial.max ?? 1];
      for (const v of values) {
        for (const ruin of [0, 0.5, 1]) sound(id, { [dial.name]: v, ruin });
      }
    }
  });

  it('is sound with every dial at its lowest and at its highest', () => {
    for (const end of ['min', 'max'] as const) {
      const dials = Object.fromEntries(sk.dials.map((dl) => [dl.name, dl.kind === 'choice'
        ? (end === 'min' ? dl.choices?.[0] : dl.choices?.at(-1)) ?? '' : (end === 'min' ? dl.min : dl.max) ?? 0]));
      sound(id, dials);
    }
  });

  it('stays inside the footprint for 150 random settings', () => {
    const rng = makeRng(99, id);
    for (let i = 0; i < 150; i++) {
      const dials: Record<string, number | string> = {};
      for (const dl of sk.dials) dials[dl.name] = dl.kind === 'choice' ? rng.pick(dl.choices ?? ['']) : rng.range(dl.min ?? 0, dl.max ?? 1);
      sound(id, dials, rng.int(0, 1e9));
    }
  });
});
