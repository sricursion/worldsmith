// Palette recolouring for the KayKit gradient atlas. Pure maths on RGBA bytes, no DOM.
import type { ThemeId } from '../world/spec';

export interface PaletteVariant {
  /** Hue rotation in degrees applied to every pixel of the atlas. */
  hue: number;
  /** Multiplier on HSV value. */
  value: number;
}

export const PALETTE_COUNT = 10;

/**
 * Hue ring per theme. Index 0 is always the untouched atlas, so palette 0 keeps the pack's own look.
 * Rotations are relative to the pack's colours, so each ring is a spread around the hue families the
 * theme should read as: western browns, dust and red; medieval greens, blues and burgundy;
 * scifi cyan, white and orange; modern grey, navy and yellow.
 */
export const PALETTE_RINGS: Record<ThemeId, readonly PaletteVariant[]> = {
  western: [
    { hue: 0, value: 1 },
    { hue: -18, value: 0.92 },
    { hue: 12, value: 0.88 },
    { hue: -34, value: 0.85 },
    { hue: 22, value: 1.05 },
    { hue: -8, value: 0.75 },
    { hue: 36, value: 0.9 },
    { hue: -48, value: 0.95 },
    { hue: 6, value: 1.12 },
    { hue: -26, value: 0.7 },
  ],
  medieval: [
    { hue: 0, value: 1 },
    { hue: 70, value: 0.9 },
    { hue: 105, value: 0.85 },
    { hue: 150, value: 0.95 },
    { hue: -25, value: 0.8 },
    { hue: 190, value: 0.9 },
    { hue: 215, value: 0.85 },
    { hue: -50, value: 0.75 },
    { hue: 125, value: 1.05 },
    { hue: 240, value: 0.8 },
  ],
  scifi: [
    { hue: 0, value: 1 },
    { hue: 165, value: 1.1 },
    { hue: 185, value: 1.2 },
    { hue: 205, value: 1 },
    { hue: 25, value: 1.15 },
    { hue: -160, value: 1.05 },
    { hue: 145, value: 0.95 },
    { hue: 40, value: 1.25 },
    { hue: 225, value: 1.1 },
    { hue: 12, value: 0.9 },
  ],
  modern: [
    { hue: 0, value: 1 },
    { hue: 200, value: 0.7 },
    { hue: 215, value: 0.55 },
    { hue: 230, value: 0.65 },
    { hue: 45, value: 1.15 },
    { hue: 60, value: 1.05 },
    { hue: 185, value: 0.8 },
    { hue: -30, value: 0.6 },
    { hue: 245, value: 0.5 },
    { hue: 30, value: 0.85 },
  ],
};

/** Palette index folded into the ring, so any integer (including negatives) maps to a variant. */
export function paletteVariant(theme: ThemeId, index: number): PaletteVariant {
  const ring = PALETTE_RINGS[theme];
  const i = ((Math.trunc(Number.isFinite(index) ? index : 0) % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
  return ring[i] ?? { hue: 0, value: 1 };
}

export function paletteSlot(index: number): number {
  return ((Math.trunc(Number.isFinite(index) ? index : 0) % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
}

/** Rotates hue and scales value of RGBA bytes in place; alpha is untouched. */
export function shiftPixels(data: Uint8ClampedArray, hueDeg: number, valueMul: number): void {
  const shift = (((hueDeg % 360) + 360) % 360) / 60; // in sextants
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = (data[i] ?? 0) / 255;
    const g = (data[i + 1] ?? 0) / 255;
    const b = (data[i + 2] ?? 0) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta > 1e-6) {
      if (max === r) h = ((g - b) / delta + 6) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
    }
    h = (h + shift) % 6;
    const s = max <= 0 ? 0 : delta / max;
    const v = Math.min(1, max * valueMul);
    // HSV -> RGB
    const c = v * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = v - c;
    let rr = 0;
    let gg = 0;
    let bb = 0;
    if (h < 1) [rr, gg, bb] = [c, x, 0];
    else if (h < 2) [rr, gg, bb] = [x, c, 0];
    else if (h < 3) [rr, gg, bb] = [0, c, x];
    else if (h < 4) [rr, gg, bb] = [0, x, c];
    else if (h < 5) [rr, gg, bb] = [x, 0, c];
    else [rr, gg, bb] = [c, 0, x];
    data[i] = Math.round((rr + m) * 255);
    data[i + 1] = Math.round((gg + m) * 255);
    data[i + 2] = Math.round((bb + m) * 255);
  }
}
