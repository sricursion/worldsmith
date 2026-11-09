import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ThemeId } from '../../app/src/world/spec';
import { CLIP_CANDIDATES, LOGICAL_CLIPS, resolveClipNames } from '../../app/src/engine/kaykit-clips';
import { PALETTE_COUNT, PALETTE_RINGS, paletteSlot, paletteVariant, shiftPixels } from '../../app/src/engine/palette';
import { BASE_FILES, CHARACTER_HEIGHT_M } from '../../app/src/engine/character';
import { FOOTPRINT_TABLE } from '../../app/src/engine/assets';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const THEMES: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

function glbClipNames(file: string): string[] {
  const buf = readFileSync(join(ROOT, 'assets', 'third_party', 'kaykit-adventurers', `${file}.glb`));
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { animations?: { name?: string }[] };
  return (json.animations ?? []).map((a) => a.name ?? '');
}

describe('palette tables', () => {
  it('has ten variants per theme with the first untouched', () => {
    for (const t of THEMES) {
      expect(PALETTE_RINGS[t]).toHaveLength(PALETTE_COUNT);
      expect(PALETTE_RINGS[t][0]).toEqual({ hue: 0, value: 1 });
    }
  });

  it('keeps every variant distinct inside a theme and in sane ranges', () => {
    for (const t of THEMES) {
      const keys = new Set(PALETTE_RINGS[t].map((v) => `${v.hue}|${v.value}`));
      expect(keys.size).toBe(PALETTE_COUNT);
      for (const v of PALETTE_RINGS[t]) {
        expect(Math.abs(v.hue)).toBeLessThanOrEqual(360);
        expect(v.value).toBeGreaterThan(0.3);
        expect(v.value).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('gives each theme its own ring', () => {
    const rings = THEMES.map((t) => JSON.stringify(PALETTE_RINGS[t]));
    expect(new Set(rings).size).toBe(THEMES.length);
  });

  it('puts the theme hues in the intended families', () => {
    const mean = (t: ThemeId): number => PALETTE_RINGS[t].reduce((a, v) => a + v.hue, 0) / PALETTE_COUNT;
    expect(Math.abs(mean('western'))).toBeLessThan(25); // stays in warm browns and reds
    expect(mean('medieval')).toBeGreaterThan(60); // toward green and blue
    expect(mean('scifi')).toBeGreaterThan(50);
    const modernValue = PALETTE_RINGS.modern.reduce((a, v) => a + v.value, 0) / PALETTE_COUNT;
    expect(modernValue).toBeLessThan(0.9); // darker greys and navies
  });

  it('folds any index into the ring', () => {
    expect(paletteSlot(0)).toBe(0);
    expect(paletteSlot(10)).toBe(0);
    expect(paletteSlot(13)).toBe(3);
    expect(paletteSlot(-1)).toBe(9);
    expect(paletteSlot(Number.NaN)).toBe(0);
    expect(paletteVariant('scifi', 14)).toEqual(PALETTE_RINGS.scifi[4]);
  });
});

describe('shiftPixels', () => {
  const px = (r: number, g: number, b: number, a = 255): Uint8ClampedArray => new Uint8ClampedArray([r, g, b, a]);

  it('is the identity for hue 0, value 1', () => {
    const d = px(200, 100, 50);
    shiftPixels(d, 0, 1);
    expect(Array.from(d)).toEqual([200, 100, 50, 255]);
  });

  it('rotates red to green at +120 degrees and blue at +240', () => {
    const g = px(255, 0, 0);
    shiftPixels(g, 120, 1);
    expect(Array.from(g)).toEqual([0, 255, 0, 255]);
    const b = px(255, 0, 0);
    shiftPixels(b, 240, 1);
    expect(Array.from(b)).toEqual([0, 0, 255, 255]);
  });

  it('wraps negative rotations', () => {
    const d = px(255, 0, 0);
    shiftPixels(d, -120, 1);
    expect(Array.from(d)).toEqual([0, 0, 255, 255]);
  });

  it('leaves greys and alpha alone, and scales value', () => {
    const grey = px(128, 128, 128, 77);
    shiftPixels(grey, 90, 1);
    expect(Array.from(grey)).toEqual([128, 128, 128, 77]);
    const dim = px(200, 0, 0);
    shiftPixels(dim, 0, 0.5);
    expect(Array.from(dim)).toEqual([100, 0, 0, 255]);
    const bright = px(200, 0, 0);
    shiftPixels(bright, 0, 2);
    expect(bright[0]).toBe(255);
  });
});

describe('clip mapping against the real GLBs', () => {
  const files = Array.from(new Set(Object.values(BASE_FILES)));

  it('resolves all six logical names on every shipped model', () => {
    for (const f of files) {
      const map = resolveClipNames(glbClipNames(f));
      for (const logical of LOGICAL_CLIPS) {
        expect(map[logical], `${f}:${logical}`).not.toBeNull();
      }
      expect(map.idle).toBe('Idle');
      expect(map.walk).toBe('Walking_A');
      expect(map.run).toBe('Running_A');
    }
  });

  it('falls back through candidates and returns null when nothing matches', () => {
    expect(resolveClipNames(['Unarmed_Idle']).idle).toBe('Unarmed_Idle');
    expect(resolveClipNames([]).walk).toBeNull();
  });

  it('is described in the committed rig report', () => {
    const report = readFileSync(join(ROOT, 'tests', 'engine', 'kaykit-rig-report.md'), 'utf8');
    for (const logical of LOGICAL_CLIPS) {
      const first = CLIP_CANDIDATES[logical][0];
      expect(first).toBeDefined();
      expect(report).toContain(first as string);
    }
    expect(report).toContain('missing [], extra []');
  });
});

describe('constants', () => {
  it('maps every character base to an existing file', () => {
    for (const f of Object.values(BASE_FILES)) {
      expect(glbClipNames(f).length).toBeGreaterThan(0);
    }
    expect(CHARACTER_HEIGHT_M).toBe(1.75);
  });

  it('keeps the architecture footprint table', () => {
    expect(FOOTPRINT_TABLE).toEqual({ small: { w: 6, d: 6 }, medium: { w: 9, d: 8 }, large: { w: 12, d: 10 } });
  });
});
