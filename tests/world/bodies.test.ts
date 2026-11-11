import { describe, expect, it } from 'vitest';
import { CREATURE_FAMILIES, GAIT_DUTY, bodyBounds, bodyCatalogText, buildBody, gaitPhases, restPositions } from '../../app/src/world/bodies';
import type { BodyDials } from '../../app/src/world/bodies';
import { makeRng } from '../../app/src/world/rng';
import type { CreatureFamily } from '../../app/src/world/spec';
import { buildBodyGeometry } from '../../app/src/engine/bodies/geometry';

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

/** Triangles at full quality for one of each kind. Budgets are twice what the plans drew before they gained detail. */
const TRIANGLE_CASES: Record<string, { family: CreatureFamily; dials: BodyDials; size: number; budget: number }> = {
  bare: { family: 'biped', dials: {}, size: 1.75, budget: 6072 },
  tunic_hat: { family: 'biped', dials: { outfit: 'tunic', hat: 'brim' }, size: 1.75, budget: 7504 },
  coat_long_hair: { family: 'biped', dials: { outfit: 'coat', hair: 0.9 }, size: 1.75, budget: 6920 },
  robe_hood_staff: { family: 'biped', dials: { outfit: 'robe', hood: 1, tool: 'staff' }, size: 1.75, budget: 7488 },
  armor_helm_blade: { family: 'biped', dials: { outfit: 'armor', hat: 'helm', tool: 'blade', cloak: 1 }, size: 1.8, budget: 8680 },
  suit: { family: 'biped', dials: { outfit: 'suit' }, size: 1.8, budget: 6272 },
  work_cap_tool: { family: 'biped', dials: { outfit: 'work', hat: 'cap', tool: 'tool', pack: 1 }, size: 1.7, budget: 7716 },
  robot: { family: 'biped', dials: { visor: 1, antenna: 1, glow_eyes: 1, bulk: 0.7 }, size: 1.9, budget: 5980 },
  quadruped: { family: 'quadruped', dials: {}, size: 2.4, budget: 7928 },
  stag: { family: 'quadruped', dials: { horns: 'antlers', legs: 0.7, mane: 1 }, size: 2.2, budget: 9456 },
  lizard: { family: 'quadruped', dials: { sprawl: 1, tail: 0.9, plates: 1 }, size: 2, budget: 7952 },
  bird: { family: 'bird', dials: {}, size: 0.45, budget: 6064 },
  winged: { family: 'winged', dials: {}, size: 12, budget: 14332 },
  serpent: { family: 'serpent', dials: {}, size: 3, budget: 5632 },
  swimmer: { family: 'swimmer', dials: {}, size: 1, budget: 2612 },
  crawler: { family: 'crawler', dials: {}, size: 0.6, budget: 6528 },
  beetle: { family: 'crawler', dials: { pairs: 3, shell: 1, claws: 1 }, size: 0.6, budget: 8032 },
  floater: { family: 'floater', dials: {}, size: 1.5, budget: 7724 },
  colossus: { family: 'colossus', dials: {}, size: 25, budget: 8144 },
  swarm: { family: 'swarm', dials: {}, size: 0.2, budget: 592 },
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

  it('keeps every kind of body inside its triangle budget at full quality', () => {
    const counts: Record<string, number> = {};
    for (const [name, c] of Object.entries(TRIANGLE_CASES)) {
      const geo = buildBodyGeometry(buildBody(c.family, c.dials, c.size, 5), { body: '#806040', accent: '#404040', glow: '#ffcc66' }, 2, 5);
      counts[name] = ((geo.main.index?.count ?? 0) + (geo.glow?.index?.count ?? 0)) / 3;
      geo.main.dispose();
      geo.glow?.dispose();
      expect(counts[name], name).toBeLessThanOrEqual(c.budget);
    }
    console.log('triangles', JSON.stringify(counts));
  });

  it('builds the same body for the same seed and a different individual for another', () => {
    for (const family of ['biped', 'quadruped', 'bird', 'swimmer', 'crawler'] as const) {
      const dials: BodyDials = family === 'biped' ? { outfit: 'tunic' } : {};
      const a = buildBody(family, dials, 1.7, 21), again = buildBody(family, dials, 1.7, 21), other = buildBody(family, dials, 1.7, 22);
      expect(again).toEqual(a);
      expect(JSON.stringify(other.joints), family).not.toBe(JSON.stringify(a.joints));
      // Individuals differ in build, not in what they were asked to be.
      expect(other.legs.length).toBe(a.legs.length);
      expect(other.meta.pattern).toBe(a.meta.pattern);
    }
    const tall = (seed: number): number => { const b = bodyBounds(buildBody('biped', { outfit: 'coat' }, 1.75, seed)); return b.max[1] - b.min[1]; };
    for (let seed = 1; seed <= 20; seed++) expect(tall(seed)).toBeCloseTo(1.75, 2);
  });

  it('plants a person on heel and forefoot, feet turned out, never through the ground', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const plan = buildBody('biped', { outfit: seed % 2 === 0 ? 'tunic' : 'bare' }, 1.75, seed);
      const at = restPositions(plan);
      const turns: number[] = [];
      for (const leg of plan.legs) {
        const parts = plan.segments.filter((s) => s.joint === leg.foot);
        expect(parts).toHaveLength(2);
        turns.push(Math.sign((parts[0]?.quat[1] ?? 0) * leg.side));
        for (const s of parts) {
          // Heel and forefoot are ellipsoids turned about the vertical, so half the height is the drop to the sole.
          const sole = ((at[leg.foot] as number[])[1] as number) + s.pos[1] - s.size[1] / 2;
          expect(Math.abs(sole)).toBeLessThan(0.002);
        }
      }
      expect(turns).toEqual([1, 1]);
    }
  });

  it('hangs cloth to a clean hem over legs of the same cloth', () => {
    for (const outfit of ['tunic', 'coat', 'robe'] as const) {
      const plan = buildBody('biped', { outfit }, 1.75, 3);
      const at = restPositions(plan);
      const hem = plan.segments.find((s) => s.shape === 'cone' && s.joint === 0 && s.tone === 'cloth');
      expect(hem, outfit).toBeDefined();
      if (hem === undefined) continue;
      const hemY = ((at[0] as number[])[1] as number) + hem.pos[1] - hem.size[1] / 2;
      const leg = plan.legs[0];
      if (leg === undefined) continue;
      const hipAt = at[leg.hip] as number[], kneeAt = at[leg.knee] as number[];
      const thigh = plan.segments.find((s) => s.joint === leg.hip && s.shape === 'capsule');
      // Wider than the outside of the thigh at the hem, and below the hip.
      expect(hem.size[0] / 2).toBeGreaterThan(Math.abs(hipAt[0] as number) + (thigh?.size[0] ?? 0) / 2);
      expect(hemY).toBeLessThan(hipAt[1] as number);
      if (outfit !== 'tunic') {
        expect(hemY).toBeLessThan((kneeAt[1] as number) + 0.001);
        expect(thigh?.tone).toBe('cloth');
      }
    }
  });

  it('describes every family to the model within its budget', () => {
    const text = bodyCatalogText();
    expect(text.length).toBeLessThan(4500);
    for (const f of CREATURE_FAMILIES) expect(text).toContain(f);
    for (const b of ['roam', 'graze', 'patrol', 'perch', 'circle', 'sleep', 'guard', 'flock', 'stalk']) expect(text).toContain(b);
  });
});
