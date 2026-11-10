// Part and dial helpers shared by the skeleton groups. Pure, no three.
import type { BlueprintPart, PartShape, PartTone } from '../spec';
import type { Rng } from '../rng';
import type { DialSpec, Dials, Skeleton } from './types';

export interface PartOpts { rot?: number; repeat?: number; gap?: number }

/** part(shape, x, z, y, w, d, h, tone, opts): x/z/w/d are footprint fractions, y/h metres (props: footprint units). */
export function part(
  shape: PartShape, x: number, z: number, y: number, w: number, d: number, h: number, tone: PartTone, o: PartOpts = {},
): BlueprintPart {
  const repeat = o.repeat ?? 1;
  return { shape, x, z, y, w, d, h, rot: o.rot ?? 0, tone, repeat, gap: repeat > 1 ? (o.gap ?? 0) : 0 };
}

type Maker = (x: number, z: number, y: number, w: number, d: number, h: number, tone: PartTone, o?: PartOpts) => BlueprintPart;
const maker = (shape: PartShape): Maker => (x, z, y, w, d, h, tone, o) => part(shape, x, z, y, w, d, h, tone, o);
export const box = maker('box');
export const cyl = maker('cylinder');
export const cone = maker('cone');
export const pyr = maker('pyramid');
export const gable = maker('gable');
export const dome = maker('dome');
export const sph = maker('sphere');
export const wedge = maker('wedge');
export const arch = maker('arch');
export const ring = maker('ring');

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Resolved dial readers. The resolver guarantees presence and type; the fallbacks only keep types honest. */
export const num = (d: Dials, k: string): number => {
  const v = d[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};
export const int = (d: Dials, k: string): number => Math.round(num(d, k));
export const str = (d: Dials, k: string): string => {
  const v = d[k];
  return typeof v === 'string' ? v : '';
};

export const N = (name: string, min: number, max: number, def: number, meaning: string): DialSpec =>
  ({ name, kind: 'number', min, max, default: def, meaning });
export const C = (name: string, choices: string[], def: string, meaning: string): DialSpec =>
  ({ name, kind: 'choice', choices, default: def, meaning });

export function skel(
  id: string, group: Skeleton['group'], summary: string, becomes: string[], dials: DialSpec[],
  build: (d: Dials, rng: Rng) => BlueprintPart[],
): Skeleton {
  return { id, group, summary, becomes, dials, build };
}
