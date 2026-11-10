import { describe, expect, it } from 'vitest';
import { CREATURE_FAMILIES, GAIT_DUTY, bodyBounds, bodyCatalogText, buildBody, gaitPhases, restPositions } from '../../app/src/world/bodies';
import type { BodyDials } from '../../app/src/world/bodies';
import { makeRng } from '../../app/src/world/rng';

const DIAL_NAMES = [
  'legs', 'body', 'neck', 'head', 'snout', 'ears', 'tail', 'tailw', 'bulk', 'slope', 'sprawl', 'frill', 'plates', 'mane', 'hump', 'shoulders',
  'hips', 'limbs', 'arms', 'posture', 'hair', 'wingspan', 'feather', 'chord', 'crown', 'spade', 'beak', 'crest', 'girth', 'humps', 'hood',
  'depth', 'flat', 'fluke', 'dorsal', 'pectoral', 'pairs', 'stance', 'wide', 'abdomen', 'shell', 'claws', 'stinger', 'tentacles', 'length',
  'eye', 'fins', 'glow', 'hover', 'still', 'units', 'wings', 'long', 'glow_eyes', 'horns', 'long_ears', 'visor', 'antenna', 'cloak', 'armor', 'pack', 'mask',
];
const OPTIONS: Record<string, readonly string[]> = {
  pattern: ['plain', 'stripes', 'spots', 'scales', 'patches'], horns: ['none', 'horns', 'antlers', 'tusks', 'horn', 'crown'],
  outfit: ['bare', 'tunic', 'coat', 'robe', 'armor', 'suit', 'work'], hat: ['brim', 'cap', 'cone', 'helm'], tool: ['none', 'staff', 'tool', 'blade', 'book', 'lamp'],
  shape: ['bell', 'orb', 'disc', 'bag'],
};

describe('body plans', () => {
  it('builds every family for 100 random dial sets with finite transforms and feet on the ground', () => {
    for (const family of CREATURE_FAMILIES) {
      const rng = makeRng(77, family);
      for (let n = 0; n < 100; n++) {
        const dials: BodyDials = {};
        for (const name of DIAL_NAMES) if (rng.chance(0.5)) dials[name] = rng.chance(0.15) ? rng.int(0, 5) : rng.next();
        for (const [name, xs] of Object.entries(OPTIONS)) if (rng.chance(0.5)) dials[name] = rng.pick(xs);
        const size = rng.range(0.2, 40);
        const plan = buildBody(family, dials, size, n);
        const label = `${family} ${JSON.stringify(dials)}`;
        expect(plan.joints.length).toBeGreaterThan(0);
        expect(plan.segments.length).toBeGreaterThan(0);
        let ok = true;
        plan.joints.forEach((j, i) => {
          if (j.parent >= i) ok = false;
          for (const v of j.pos) if (!Number.isFinite(v)) ok = false;
        });
        for (const s of plan.segments) {
          for (const v of [...s.pos, ...s.quat, ...s.size, s.taper, s.shade]) if (!Number.isFinite(v)) ok = false;
          if (Math.abs(Math.hypot(...s.quat) - 1) > 1e-4) ok = false;
        }
        for (const v of Object.values(plan.meta)) if (typeof v === 'number' && !Number.isFinite(v)) ok = false;
        expect(ok, label).toBe(true);
        const at = restPositions(plan);
        const tol = plan.size * 0.03 + 0.002;
        for (const leg of plan.legs) {
          const y = (at[leg.foot] as number[])[1] as number;
          expect(Math.abs(y - leg.footR), `${label} foot`).toBeLessThan(tol);
          const k = plan.joints[leg.knee]?.pos ?? [0, 0, 0], f = plan.joints[leg.foot]?.pos ?? [0, 0, 0];
          expect(leg.l1).toBeCloseTo(Math.hypot(...k), 5);
          expect(leg.l2).toBeCloseTo(Math.hypot(...f), 5);
        }
        if (plan.legs.length > 0) expect(bodyBounds(plan).min[1], label).toBeGreaterThan(-plan.size * 0.06 - 0.01);
      }
    }
  });

  it('gives each foot its place in the cycle for 2, 4, 6 and 8 legs', () => {
    for (const legs of [2, 4, 6, 8]) {
      const walk = gaitPhases(legs, 'walk'), trot = gaitPhases(legs, 'trot'), run = gaitPhases(legs, 'run');
      for (const p of [walk, trot, run]) {
        expect(p).toHaveLength(legs);
        for (const x of p) expect(x >= 0 && x < 1).toBe(true);
      }
      expect(walk.reduce((a, b) => a + b, 0)).toBeCloseTo((legs - 1) / 2, 6);
      expect(new Set(walk.map((x) => Math.round(x * legs))).size).toBe(legs);
      expect(trot.reduce((a, b) => a + b, 0)).toBeCloseTo(legs / 4, 6);
      for (let i = 0; i < legs; i += 2) expect(Math.abs((walk[i] as number) - (walk[i + 1] as number))).toBeCloseTo(0.5, 6);
    }
    expect(GAIT_DUTY.walk).toBeGreaterThan(GAIT_DUTY.trot);
    expect(GAIT_DUTY.trot).toBeGreaterThan(GAIT_DUTY.run);
  });

  it('stands a default person 7 to 8 heads tall at the asked height', () => {
    const plan = buildBody('biped', {}, 1.75, 1);
    const heads = plan.meta.height / plan.meta.headHeight;
    expect(heads).toBeGreaterThanOrEqual(7);
    expect(heads).toBeLessThanOrEqual(8);
    const b = bodyBounds(plan);
    expect(b.max[1] - b.min[1]).toBeGreaterThan(1.6);
    expect(b.max[1] - b.min[1]).toBeLessThan(1.95);
    expect(plan.legs).toHaveLength(2);
    expect(plan.arms).toHaveLength(2);
  });

  it('describes every family to the model within its budget', () => {
    const text = bodyCatalogText();
    expect(text.length).toBeLessThan(4500);
    for (const f of CREATURE_FAMILIES) expect(text).toContain(f);
    for (const b of ['roam', 'graze', 'patrol', 'perch', 'circle', 'sleep', 'guard', 'flock', 'stalk']) expect(text).toContain(b);
  });
});
