import { describe, expect, it } from 'vitest';
import { blueprintBounds, expandParts, lintBlueprint, repairBlueprint } from '../../app/src/world/blueprints';
import { FIXTURES } from '../../app/src/world/fixtures';
import { blueprint, box, door, gable } from '../../app/src/world/fixtures/util';
import type { ThemeId } from '../../app/src/world/spec';

const THEMES: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

describe('expandParts', () => {
  it('returns repeat=1 parts spaced along local x, centred on the part', () => {
    const out = expandParts([box(0, 0, 0, 0.1, 0.1, 1, 'wall', { repeat: 3, gap: 0.2 })]);
    expect(out).toHaveLength(3);
    [-0.2, 0, 0.2].forEach((v, i) => expect(out[i]?.x).toBeCloseTo(v, 9));
    expect(out.every((p) => p.repeat === 1 && p.gap === 0 && p.z === 0)).toBe(true);
  });

  it('honours rot: a quarter turn spreads copies along z', () => {
    const out = expandParts([box(0.1, 0, 0, 0.1, 0.1, 1, 'wall', { rot: 90, repeat: 2, gap: 0.4 })]);
    expect(out).toHaveLength(2);
    for (const p of out) expect(p.x).toBeCloseTo(0.1, 9);
    expect(Math.abs((out[0]?.z ?? 0) - (out[1]?.z ?? 0))).toBeCloseTo(0.4, 9);
  });

  it('leaves single parts alone', () => {
    const p = box(0.2, -0.1, 1, 0.3, 0.3, 2, 'roof');
    expect(expandParts([p])).toEqual([p]);
  });
});

describe('blueprintBounds', () => {
  it('reports the tallest part top', () => {
    const bp = blueprint('t', 't', 0, [box(0, 0, 0, 0.5, 0.5, 3, 'wall'), gable(0, 0, 3, 0.5, 0.5, 1.5, 'roof')]);
    expect(blueprintBounds(bp, { w: 9, d: 8 }).height).toBeCloseTo(4.5, 9);
  });
});

const sound = () =>
  blueprint('ok', 'a plain hut', 0, [
    box(0, 0, 0, 0.8, 0.8, 3, 'wall'),
    gable(0, 0, 3, 0.9, 0.9, 1.5, 'roof'),
    door(0, 0.4, 0.14, 2.1),
    box(0.3, 0.4, 1, 0.1, 0.03, 1, 'glass'),
  ]);

describe('lintBlueprint', () => {
  it('passes a sound blueprint', () => {
    expect(lintBlueprint(sound())).toEqual([]);
  });

  it('flags too few parts and a missing body', () => {
    const w = lintBlueprint(blueprint('x', 'x', 0, [box(0, 0, 2, 0.5, 0.5, 1, 'wall')]));
    expect(w.some((m) => /at least 4/.test(m))).toBe(true);
    expect(w.some((m) => /no body/.test(m))).toBe(true);
  });

  it('flags a floating part', () => {
    const bp = sound();
    bp.parts.push(box(0, 0, 9, 0.2, 0.2, 1, 'accent'));
    expect(lintBlueprint(bp).some((m) => /floats/.test(m))).toBe(true);
  });

  it('accepts a sign hung from a bracket', () => {
    const bp = sound();
    bp.parts.push(box(0.3, 0.5, 2.6, 0.03, 0.3, 0.05, 'dark'), box(0.3, 0.5, 2.1, 0.3, 0.03, 0.5, 'accent'));
    expect(lintBlueprint(bp)).toEqual([]);
  });

  it('flags a part far outside the footprint', () => {
    const bp = sound();
    bp.parts.push({ ...box(0, 0, 0, 0.1, 0.1, 1, 'wall'), x: 1.4 });
    expect(lintBlueprint(bp).some((m) => /outside the footprint/.test(m))).toBe(true);
  });

  it('flags a blocked door', () => {
    const bp = sound();
    bp.parts.push({ ...box(0, 0, 0, 0.1, 0.1, 1.2, 'dark'), z: 0.56 });
    expect(lintBlueprint(bp).some((m) => /door/.test(m))).toBe(true);
  });
});

describe('repairBlueprint', () => {
  it('snaps a floating part down onto the part below it', () => {
    const bp = sound();
    bp.parts.push(box(0, 0, 9, 0.2, 0.2, 1, 'accent'));
    const fixed = repairBlueprint(bp);
    expect(lintBlueprint(fixed)).toEqual([]);
    expect(fixed.parts[fixed.parts.length - 1]?.y).toBeCloseTo(4.5, 9);
  });

  it('snaps to the ground when nothing is below', () => {
    const bp = sound();
    bp.parts.push(box(0.5, -0.5, 6, 0.04, 0.04, 1, 'dark'));
    const fixed = repairBlueprint(bp);
    expect(lintBlueprint(fixed)).toEqual([]);
    expect(fixed.parts[fixed.parts.length - 1]?.y).toBe(0);
  });

  it('adds a body and pads to four parts', () => {
    const fixed = repairBlueprint(blueprint('x', 'x', 0, [box(0, 0, 2, 0.5, 0.5, 1, 'wall')]));
    expect(lintBlueprint(fixed)).toEqual([]);
    expect(fixed.parts.length).toBeGreaterThanOrEqual(4);
  });

  it('pulls a detached part back and clears a blocked door', () => {
    const bp = sound();
    bp.parts.push({ ...box(0, 0, 0, 0.1, 0.1, 1, 'wall'), x: 3 });
    bp.parts.push({ ...box(0, 0, 0, 0.1, 0.1, 1.2, 'dark'), z: 0.56 });
    const fixed = repairBlueprint(bp);
    expect(lintBlueprint(fixed)).toEqual([]);
    expect(fixed.doorX).not.toBe(0);
  });

  it('returns a sound blueprint unchanged and does not mutate its input', () => {
    const bp = sound();
    const copy = structuredClone(bp);
    expect(repairBlueprint(bp)).toEqual(bp);
    expect(bp).toEqual(copy);
  });
});

describe.each(THEMES)('%s blueprints', (theme) => {
  const spec = FIXTURES[theme];
  it.each((spec.blueprints ?? []).map((b) => [b.id, b] as const))('%s lints clean and survives repair untouched', (_id, bp) => {
    expect(lintBlueprint(bp)).toEqual([]);
    expect(repairBlueprint(bp)).toEqual(bp);
    expect(blueprintBounds(bp, { w: 9, d: 8 }).height).toBeGreaterThan(2);
  });
});
