import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ThemeId } from '../../app/src/world/spec';
import { CLIP_CANDIDATES, LOGICAL_CLIPS, resolveClipNames } from '../../app/src/engine/kaykit-clips';
import { PALETTE_COUNT, PALETTE_RINGS, classifyPixel, paletteSlot, paletteVariant, shiftPixels } from '../../app/src/engine/palette';
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
      expect(PALETTE_RINGS[t][0]).toEqual({ hue: 0, value: 1, sat: 1 });
    }
  });

  it('keeps every variant distinct inside a theme and in moderate ranges', () => {
    for (const t of THEMES) {
      const keys = new Set(PALETTE_RINGS[t].map((p) => `${p.hue}|${p.value}|${p.sat}`));
      expect(keys.size).toBe(PALETTE_COUNT);
      for (const p of PALETTE_RINGS[t]) {
        expect(Math.abs(p.hue)).toBeLessThanOrEqual(150);
        expect(p.value).toBeGreaterThan(0.3);
        expect(p.value).toBeLessThanOrEqual(1.3);
        expect(p.sat).toBeGreaterThan(0.3);
        expect(p.sat).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('gives each theme its own ring', () => {
    const rings = THEMES.map((t) => JSON.stringify(PALETTE_RINGS[t]));
    expect(new Set(rings).size).toBe(THEMES.length);
  });

  it('puts the theme flavours in the intended direction', () => {
    const meanAbs = (t: ThemeId): number => PALETTE_RINGS[t].reduce((a, p) => a + Math.abs(p.hue), 0) / PALETTE_COUNT;
    expect(meanAbs('western')).toBeLessThan(meanAbs('medieval'));
    const modernValue = PALETTE_RINGS.modern.reduce((a, p) => a + p.value, 0) / PALETTE_COUNT;
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
  const hueOf = (d: Uint8ClampedArray): number => {
    const r = (d[0] ?? 0) / 255;
    const g = (d[1] ?? 0) / 255;
    const b = (d[2] ?? 0) / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    if (delta === 0) return 0;
    const h = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return h * 60;
  };
  const SKIN = [248, 200, 168] as const;
  const HAIR = [168, 104, 72] as const;
  const BLUE = [40, 60, 200] as const;
  const GREY = [128, 128, 128] as const;

  /** Synthetic atlas holding skin, hair, blue cloth, grey and a saturated red pixel. */
  const atlas = (): Uint8ClampedArray => new Uint8ClampedArray([...SKIN, 255, ...HAIR, 255, ...BLUE, 255, ...GREY, 255, 255, 0, 0, 255]);

  it('classifies skin, hair, grey and cloth', () => {
    expect(classifyPixel(...SKIN)).toBe('skin');
    expect(classifyPixel(...HAIR)).toBe('skin');
    expect(classifyPixel(...GREY)).toBe('neutral');
    expect(classifyPixel(...BLUE)).toBe('cloth');
    expect(classifyPixel(255, 0, 0)).toBe('cloth');
  });

  it('makes palette 0 the identity for every theme', () => {
    for (const t of THEMES) {
      const p = paletteVariant(t, 0);
      const d = atlas();
      shiftPixels(d, p.hue, p.value, p.sat);
      expect(Array.from(d)).toEqual(Array.from(atlas()));
    }
  });

  it('never changes skin or hair pixels under any palette', () => {
    for (const t of THEMES) {
      for (let i = 0; i < PALETTE_COUNT; i++) {
        const p = paletteVariant(t, i);
        const d = atlas();
        shiftPixels(d, p.hue, p.value, p.sat);
        expect(Array.from(d.subarray(0, 8))).toEqual([...SKIN, 255, ...HAIR, 255]);
      }
    }
  });

  it('changes the hue of blue cloth under a non-zero palette', () => {
    for (const t of THEMES) {
      const p = paletteVariant(t, 1);
      const d = px(...BLUE);
      shiftPixels(d, p.hue, p.value, p.sat);
      const diff = Math.abs(hueOf(d) - hueOf(px(...BLUE)));
      expect(Math.min(diff, 360 - diff)).toBeGreaterThan(5);
    }
  });

  it('keeps grey hue, and alpha, untouched', () => {
    const grey = px(...GREY, 77);
    shiftPixels(grey, 90, 0.5, 1.5);
    expect(Array.from(grey)).toEqual([128, 128, 128, 77]);
  });

  it('rotates cloth red to green at +120 degrees and wraps negatives', () => {
    const g = px(255, 0, 0);
    shiftPixels(g, 120, 1);
    expect(Array.from(g)).toEqual([0, 255, 0, 255]);
    const b = px(255, 0, 0);
    shiftPixels(b, -120, 1);
    expect(Array.from(b)).toEqual([0, 0, 255, 255]);
  });

  it('scales value and saturation of cloth only', () => {
    const dim = px(200, 0, 0);
    shiftPixels(dim, 0, 0.5);
    expect(Array.from(dim)).toEqual([100, 0, 0, 255]);
    const pale = px(...BLUE);
    shiftPixels(pale, 0, 1, 0.5);
    expect(pale[2]).toBe(BLUE[2]);
    expect(pale[0]).toBeGreaterThan(BLUE[0]);
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
