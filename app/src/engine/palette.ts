// Palette recolouring for the KayKit gradient atlas. Pure maths on RGBA bytes, no DOM.
import type { ThemeId } from '../world/spec';

export interface PaletteVariant {
  /** Hue rotation in degrees applied to cloth pixels only. */
  hue: number;
  /** Multiplier on HSV value, cloth pixels only. */
  value: number;
  /** Multiplier on HSV saturation, cloth pixels only. */
  sat: number;
}

export const PALETTE_COUNT = 10;

const pv = (hue: number, value: number, sat: number): PaletteVariant => ({ hue, value, sat });

/**
 * Cloth ring per theme. Index 0 is always the identity, so palette 0 keeps the pack's own look.
 * Skin, hair, leather and greys are never touched (see classifyPixel), so rotations only move the
 * saturated cloth colours. Hue stays within 150 degrees; value and saturation vary so variants differ.
 * Theme flavour: western earthy and dusty; medieval greens, blues and burgundy; scifi cool and bright;
 * modern muted and dark.
 */
export const PALETTE_RINGS: Record<ThemeId, readonly PaletteVariant[]> = {
  western: [pv(0, 1, 1), pv(-20, 0.9, 0.9), pv(15, 0.85, 1.1), pv(-40, 0.8, 0.8), pv(30, 1.05, 1), pv(-10, 0.7, 0.9), pv(45, 0.9, 0.85), pv(-60, 0.95, 1.15), pv(8, 1.1, 0.7), pv(-30, 0.65, 1)],
  medieval: [pv(0, 1, 1), pv(70, 0.9, 1), pv(105, 0.85, 0.9), pv(145, 0.95, 0.85), pv(-25, 0.8, 1.1), pv(120, 0.9, 1.2), pv(-90, 0.85, 0.9), pv(-50, 0.75, 1), pv(90, 1.05, 0.7), pv(150, 0.8, 1.1)],
  scifi: [pv(0, 1, 1), pv(105, 1.1, 0.9), pv(135, 1.2, 1.1), pv(150, 1, 0.8), pv(25, 1.15, 1.2), pv(-110, 1.05, 0.9), pv(80, 0.95, 1), pv(40, 1.25, 0.7), pv(-145, 1.1, 1.1), pv(12, 0.9, 1.25)],
  modern: [pv(0, 1, 1), pv(145, 0.7, 0.6), pv(120, 0.55, 0.8), pv(-120, 0.65, 0.7), pv(45, 1.15, 0.9), pv(60, 1.05, 0.65), pv(-85, 0.8, 0.5), pv(-30, 0.6, 1), pv(150, 0.5, 0.7), pv(30, 0.85, 0.55)],
};

/** Palette index folded into the ring, so any integer (including negatives) maps to a variant. */
export function paletteVariant(theme: ThemeId, index: number): PaletteVariant {
  const ring = PALETTE_RINGS[theme];
  const i = ((Math.trunc(Number.isFinite(index) ? index : 0) % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
  return ring[i] ?? { hue: 0, value: 1, sat: 1 };
}

export function paletteSlot(index: number): number {
  return ((Math.trunc(Number.isFinite(index) ? index : 0) % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
}

export type PixelClass = 'skin' | 'neutral' | 'cloth';

/**
 * Classifies one RGB pixel. Warm hues (reds through yellow-browns, covering skin, hair, leather and wood)
 * at moderate saturation are 'skin' and stay fixed; low saturation (greys, metal, white) is 'neutral';
 * everything else saturated is 'cloth' and is the only class a palette recolours.
 */
export function classifyPixel(r: number, g: number, b: number): PixelClass {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  const s = max <= 0 ? 0 : delta / max;
  if (s < 0.12) return 'neutral';
  let h: number;
  if (max === rr) h = ((gg - bb) / delta + 6) % 6;
  else if (max === gg) h = (bb - rr) / delta + 2;
  else h = (rr - gg) / delta + 4;
  h *= 60;
  if ((h <= 50 || h >= 345) && s <= 0.75) return 'skin';
  return 'cloth';
}

/**
 * Recolours cloth pixels of RGBA bytes in place: hue rotation, then saturation and value multipliers.
 * Skin, hair and neutral pixels and alpha are untouched. hue 0 with both multipliers 1 is the identity.
 */
export function shiftPixels(data: Uint8ClampedArray, hueDeg: number, valueMul: number, satMul = 1): void {
  if (hueDeg % 360 === 0 && valueMul === 1 && satMul === 1) return;
  const shift = (((hueDeg % 360) + 360) % 360) / 60; // in sextants
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r8 = data[i] ?? 0;
    const g8 = data[i + 1] ?? 0;
    const b8 = data[i + 2] ?? 0;
    if (classifyPixel(r8, g8, b8) !== 'cloth') continue;
    const r = r8 / 255;
    const g = g8 / 255;
    const b = b8 / 255;
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
    const s = Math.min(1, (max <= 0 ? 0 : delta / max) * satMul);
    const val = Math.min(1, max * valueMul);
    // HSV -> RGB
    const c = val * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = val - c;
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
