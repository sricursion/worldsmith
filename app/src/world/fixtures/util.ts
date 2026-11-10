import type { Blueprint, BlueprintPart, NpcActionId, PartShape, PartTone, PropBlueprint, ScheduleEntry } from '../spec';
import { NPC_ACTION_IDS } from '../schema';

export const at = (hour: number, place: string, activity: ScheduleEntry['activity']): ScheduleEntry => ({ hour, place, activity });

/** Full action-id bias table with zero defaults, so fixtures are already normalised. */
export function bias(p: Partial<Record<NpcActionId, number>> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of NPC_ACTION_IDS) out[id] = p[id] ?? 0;
  return out;
}

// ---- Blueprint helpers: keep the architecture tables terse ------------------------------------

export interface PartOpts { rot?: number; repeat?: number; gap?: number }

/** part(shape, x, z, y, w, d, h, tone, opts): x/z/w/d are footprint fractions, y/h metres. */
export function part(
  shape: PartShape, x: number, z: number, y: number, w: number, d: number, h: number, tone: PartTone, o: PartOpts = {},
): BlueprintPart {
  const repeat = o.repeat ?? 1;
  // Same limits normalizeSpec enforces, so a fixture is already in normal form.
  const c = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    shape, x: c(x, -0.5, 0.5), z: c(z, -0.5, 0.5), y, w: c(w, 0.02, 1.4), d: c(d, 0.02, 1.4), h: Math.max(0.05, h),
    rot: o.rot ?? 0, tone, repeat, gap: repeat > 1 ? (o.gap ?? 0) : 0,
  };
}

type Maker = (x: number, z: number, y: number, w: number, d: number, h: number, tone: PartTone, o?: PartOpts) => BlueprintPart;
const maker = (shape: PartShape): Maker => (x, z, y, w, d, h, tone, o) => part(shape, x, z, y, w, d, h, tone, o);
export const box = maker('box');
export const cyl = maker('cylinder');
export const cone = maker('cone');
export const pyramid = maker('pyramid');
export const gable = maker('gable');
export const dome = maker('dome');
export const sphere = maker('sphere');
export const wedge = maker('wedge');
export const arch = maker('arch');
export const ring = maker('ring');

/** A door slab on the front face. zf is where the wall's front face sits. */
export const door = (x: number, zf = 0.5, w = 0.12, h = 2.2, tone: PartTone = 'dark'): BlueprintPart =>
  box(x, zf + 0.005, 0, w, 0.03, h, tone);

/** A row of windows on the front face, centred on x. */
export const windows = (x: number, y: number, n: number, gap: number, zf = 0.5, w = 0.09, h = 1.1, tone: PartTone = 'glass'): BlueprintPart =>
  box(x, zf + 0.005, y, w, 0.03, h, tone, { repeat: n, gap });

export const blueprint = (id: string, summary: string, doorX: number, parts: BlueprintPart[]): Blueprint => ({ id, summary, parts, doorX });
export const propOf = (kind: string, size: number, weight: number, parts: BlueprintPart[]): PropBlueprint => ({ kind, size, parts, weight });
