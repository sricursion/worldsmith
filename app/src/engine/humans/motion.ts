// Locomotion from how the owner moves the root. The game moves the root itself, so speed is read back from
// displacement each frame, classified into idle / walk / run with hysteresis, and turned into a playback rate
// so the stride matches the ground covered.

export type Locomotion = 'idle' | 'walk' | 'run';

export const WALK_ENTER = 0.35;
export const WALK_EXIT = 0.18;
export const RUN_HYSTERESIS = 0.25;
/** Used when a body's stride could not be measured, in metres per second. */
export const DEFAULT_WALK_STRIDE = 1.4;
export const DEFAULT_RUN_STRIDE = 3.8;
/** A jump of this many metres in one frame is a teleport, not motion. */
export const TELEPORT_STEP_M = 3;

/** Speed over one frame from the distance the root moved. Teleports and empty frames read as standing still. */
export function rootSpeed(stepMetres: number, dt: number): number {
  if (!(dt > 1e-4) || !Number.isFinite(stepMetres) || stepMetres >= TELEPORT_STEP_M) return 0;
  return stepMetres / dt;
}

/** Exponential smoothing of the measured speed; dt is clamped so a stalled frame does not overshoot. */
export function smoothSpeed(prev: number, raw: number, dt: number, rate = 6): number {
  const h = Math.min(0.1, Math.max(0, dt));
  return prev + (raw - prev) * (1 - Math.exp(-rate * h));
}

/** Fastest and slowest playback rates at which a clip still reads as natural. */
export const WALK_MAX_RATE = 1.6;
export const RUN_MIN_RATE = 0.65;
export const RUN_MAX_RATE = 1.9;

/** Speed at which to hand over from the walk clip to the run clip: where the fastest natural walk meets the slowest
 * natural run, taken as the geometric mean of the two ground speeds. */
export function runThreshold(walkStride: number, runStride: number): number {
  return Math.sqrt(walkStride * WALK_MAX_RATE * runStride * RUN_MIN_RATE);
}

export function classifyLocomotion(speed: number, prev: Locomotion, runAt: number): Locomotion {
  if (prev === 'run') {
    if (speed >= runAt - RUN_HYSTERESIS) return 'run';
    return speed >= WALK_EXIT ? 'walk' : 'idle';
  }
  if (speed >= runAt + RUN_HYSTERESIS) return 'run';
  if (prev === 'walk') return speed >= WALK_EXIT ? 'walk' : 'idle';
  return speed >= WALK_ENTER ? 'walk' : 'idle';
}

/** Playback rate that makes a clip whose natural ground speed is `strideSpeed` cover `speed` without sliding. */
export function strideRate(kind: 'walk' | 'run', speed: number, strideSpeed: number): number {
  const base = strideSpeed > 0.05 ? strideSpeed : kind === 'walk' ? DEFAULT_WALK_STRIDE : DEFAULT_RUN_STRIDE;
  const lo = kind === 'walk' ? 0.55 : RUN_MIN_RATE;
  const hi = kind === 'walk' ? WALK_MAX_RATE : RUN_MAX_RATE;
  return Math.min(hi, Math.max(lo, speed / base));
}
