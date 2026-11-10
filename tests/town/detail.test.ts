import { describe, expect, it } from 'vitest';
import { MAX_DRESSED_PARTS, dressParts, partsBounds } from '../../app/src/town/detail';
import { expandBlueprintParts } from '../../app/src/town/blueprint-mesh';
import { inferSurfaces } from '../../app/src/town/surfaces';
import { makeRng } from '../../app/src/world/rng';
import type { BlueprintPart, SurfaceSet } from '../../app/src/world/spec';
import { BLUEPRINTS, STYLE, part } from './helpers';

const W = 9;
const D = 8;
const SURFACES: SurfaceSet = { ...inferSurfaces(STYLE, 'western'), wear: 0.3 };
const ctx = (over: Partial<SurfaceSet> = {}, doorX: number | null = 0) => ({ w: W, d: D, rng: makeRng(7, 'dress-test'), surfaces: { ...SURFACES, ...over }, doorX: doorX ?? undefined });

const HOUSE: BlueprintPart[] = [
  part('box', { w: 0.8, d: 0.8, h: 6.5 }),
  part('gable', { w: 0.9, d: 0.9, y: 6.5, h: 2.4, tone: 'roof' }),
  part('box', { x: 0, z: 0.4 + 0.015, y: 1, w: 0.09, d: 0.03, h: 1.1, repeat: 3, gap: 0.25 }, 'glass'),
  part('box', { x: 0, z: 0.4 + 0.015, y: 4, w: 0.09, d: 0.03, h: 1.1, repeat: 3, gap: 0.25 }, 'glass'),
  part('box', { x: 0, z: 0.5, y: 3, w: 0.7, d: 0.2, h: 0.2, tone: 'wall2' }),
];

describe('dressParts', () => {
  it('keeps the authored parts first and untouched, and adds trim', () => {
    const src = expandBlueprintParts(HOUSE);
    const copy = structuredClone(src);
    const out = dressParts(src, ctx());
    expect(out.slice(0, src.length)).toEqual(copy);
    expect(out.length).toBeGreaterThan(src.length + 12);
    for (const p of out) {
      for (const v of [p.x, p.z, p.y, p.w, p.d, p.h, p.rot]) expect(Number.isFinite(v)).toBe(true);
      expect(p.repeat).toBe(1);
      expect(p.w).toBeGreaterThan(0);
      expect(p.d).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays inside the bounding box to within 12 cm and under the part cap', () => {
    for (const bp of [HOUSE, ...BLUEPRINTS.map((b) => b.parts)]) {
      for (const wear of [0.2, 1]) {
        const src = expandBlueprintParts(bp);
        const before = partsBounds(src, W, D);
        const out = dressParts(src, ctx({ wear }));
        const after = partsBounds(out, W, D);
        expect(out.length).toBeLessThanOrEqual(MAX_DRESSED_PARTS);
        expect(after.x0).toBeGreaterThanOrEqual(before.x0 - 0.12);
        expect(after.x1).toBeLessThanOrEqual(before.x1 + 0.12);
        expect(after.z0).toBeGreaterThanOrEqual(before.z0 - 0.12);
        expect(after.z1).toBeLessThanOrEqual(before.z1 + 0.12);
        expect(after.top).toBeLessThanOrEqual(before.top + 0.12);
        expect(after.y0).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never exceeds the cap, dropping the least structural trim first', () => {
    const many: BlueprintPart[] = [
      part('box', { w: 0.9, d: 0.9, h: 9 }),
      part('gable', { w: 1, d: 1, y: 9, h: 2, tone: 'roof' }),
      ...[1, 4, 7].flatMap((y) => [
        part('box', { z: 0.46, y, w: 0.06, d: 0.03, h: 1.2, repeat: 8, gap: 0.11 }, 'glass'),
        part('box', { z: -0.46, y, w: 0.06, d: 0.03, h: 1.2, repeat: 8, gap: 0.11 }, 'glass'),
      ]),
    ];
    const src = expandBlueprintParts(many);
    expect(src).toHaveLength(50);
    const out = dressParts(src, ctx());
    expect(out).toHaveLength(MAX_DRESSED_PARTS);
    // the plinth and the roof fascia survive the cut
    const added = out.slice(src.length);
    expect(added.some((p) => p.y === 0 && p.w * W > 0.9 * W && p.h < 0.5)).toBe(true);
    expect(added.some((p) => p.tone === 'trim' && Math.abs(p.y + p.h - 9) < 1e-6)).toBe(true);

    const full = Array.from({ length: MAX_DRESSED_PARTS + 4 }, (_, i) => part('box', { x: (i % 10) * 0.05 - 0.25, h: 2 }));
    expect(dressParts(full, ctx())).toBe(full);
  });

  it('frames every window: casing behind, bars proud of the glass', () => {
    const src = expandBlueprintParts([part('box', { w: 0.8, d: 0.8, h: 4 }), part('box', { z: 0.4, y: 1.2, w: 0.12, d: 0.03, h: 1.2 }, 'glass')]);
    const glass = src[1] as BlueprintPart;
    const out = dressParts(src, ctx({}, null)).slice(src.length);
    const near = out.filter((p) => Math.abs(p.z * D - glass.z * D) < 0.3 && Math.abs(p.x) < 0.2 && p.y > 0.9 && p.y < 2.6);
    const front = (p: BlueprintPart): number => p.z * D + (p.d * D) / 2;
    const casing = near.find((p) => p.w > glass.w && p.h > glass.h);
    expect(casing).toBeDefined();
    expect(front(casing as BlueprintPart)).toBeLessThan(front(glass) - 0.005);
    const bars = near.filter((p) => p.w * W < 0.06 || p.h < 0.06);
    expect(bars.length).toBeGreaterThanOrEqual(2);
    for (const b of bars) {
      expect(front(b)).toBeGreaterThan(front(glass) + 0.005);
      expect(front(b)).toBeLessThan(front(glass) + 0.08);
    }
    expect(near.some((p) => p.h < 0.09 && p.w > glass.w && p.y < glass.y)).toBe(true);
  });

  it('frames the door on the front wall and lays a low step', () => {
    const src = expandBlueprintParts([part('box', { w: 0.8, d: 0.8, h: 4 }), part('box', { z: 0.55, w: 0.9, d: 0.3, h: 0.15, tone: 'wall2' })]);
    const out = dressParts(src, ctx({}, 0.2)).slice(src.length);
    const face = 0.4 * D;
    const atDoor = out.filter((p) => Math.abs(p.x * W - 0.2 * W) < 1 && p.y < 2.5 && p.z * D > face - 0.1);
    expect(atDoor.some((p) => p.tone === 'dark' && p.h > 1.9 && p.w * W > 0.9)).toBe(true);
    expect(atDoor.filter((p) => p.tone === 'trim' && p.h > 2 && p.w * W < 0.15)).toHaveLength(2);
    expect(atDoor.some((p) => p.y > 2 && p.h < 0.2 && p.w * W > 1.2)).toBe(true);
    const step = atDoor.find((p) => p.y === 0 && p.h < 0.2 && p.w * W > 1.4);
    expect(step).toBeDefined();
    // low enough to walk over
    expect((step as BlueprintPart).h).toBeLessThan(0.4);
    // no door dressing without a wall that reaches the ground, or without a door position
    const lifted = expandBlueprintParts([part('box', { w: 0.8, d: 0.8, h: 3, y: 1 })]);
    expect(dressParts(lifted, ctx()).every((p) => p.y >= 1 - 0.3)).toBe(true);
    expect(dressParts(src, ctx({}, null)).some((p) => p.tone === 'dark' && p.h > 1.9 && p.y === 0 && p.w * W < 1.2)).toBe(false);
  });

  it('matches corner treatment to the wall surface and leaves grown walls bare', () => {
    const src = expandBlueprintParts([part('box', { w: 0.8, d: 0.8, h: 4 })]);
    const posts = (wall: SurfaceSet['wall']): BlueprintPart[] =>
      dressParts(src, ctx({ wall }, null)).slice(1).filter((p) => p.h === 4 && Math.abs(p.x) > 0.3 && Math.abs(p.z) > 0.3);
    const timber = posts('planks');
    const masonry = posts('stone');
    const metal = posts('corrugated');
    expect(timber).toHaveLength(4);
    expect(masonry).toHaveLength(4);
    expect(metal).toHaveLength(4);
    expect((masonry[0] as BlueprintPart).w).toBeGreaterThan((timber[0] as BlueprintPart).w);
    expect((timber[0] as BlueprintPart).w).toBeGreaterThan((metal[0] as BlueprintPart).w);
    expect(dressParts(src, ctx({ wall: 'organic' }, null))).toHaveLength(1);
  });

  it('is deterministic and only tilts trim on worn buildings', () => {
    const src = expandBlueprintParts(HOUSE);
    expect(dressParts(src, ctx({ wear: 0.9 }))).toEqual(dressParts(src, ctx({ wear: 0.9 })));
    expect(dressParts(src, ctx({ wear: 0.4 })).slice(src.length).every((p) => p.rot === 0)).toBe(true);
    expect(dressParts(src, ctx({ wear: 1 })).slice(src.length).some((p) => p.rot !== 0)).toBe(true);
  });
});
