// One-shot events over the beds: what kinds exist, how often each wants to sound at each time of
// day, and the scheduler that turns those wishes into irregular moments without ever stacking up
// more voices than the machine should carry. No Web Audio here; the rig plays what this decides.

import type { Rng } from '../../world/rng';
import type { BedId, EventKind } from './vocab';

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export const DAY_PHASES: readonly DayPhase[] = ['dawn', 'day', 'dusk', 'night'];

export interface EventMeta {
  /** Mean seconds between two of these when nothing else is going on. */
  gap: number;
  /** The longest one can last, in seconds: how long it holds a voice. */
  seconds: number;
  /** How keen it is at dawn, by day, at dusk and at night; 0 is never. */
  phase: readonly [number, number, number, number];
  /** Pitch spread from one event to the next, in octaves either way. */
  spread: number;
}

const ALWAYS = [1, 1, 1, 1] as const;
const DIURNAL = [0.8, 1, 0.6, 0] as const;
const WORKDAY = [0.3, 1, 0.6, 0.08] as const;

export const EVENTS: Record<EventKind, EventMeta> = {
  gull: { gap: 14, seconds: 3.2, phase: [1.2, 1, 0.7, 0.05], spread: 0.15 },
  crow: { gap: 20, seconds: 2.2, phase: [1.1, 1, 0.9, 0.05], spread: 0.12 },
  owl: { gap: 24, seconds: 3.2, phase: [0.3, 0, 0.6, 1], spread: 0.08 },
  wolf: { gap: 50, seconds: 8, phase: [0.2, 0, 0.5, 1], spread: 0.12 },
  dog: { gap: 32, seconds: 2, phase: [0.8, 1, 1, 0.5], spread: 0.2 },
  hawk: { gap: 40, seconds: 3.2, phase: DIURNAL, spread: 0.08 },
  rooster: { gap: 26, seconds: 2.4, phase: [1.6, 0.12, 0, 0], spread: 0.08 },
  whoop: { gap: 26, seconds: 3.4, phase: [1.4, 0.8, 1, 0.2], spread: 0.2 },
  squawk: { gap: 18, seconds: 1.4, phase: [1.3, 1, 0.7, 0], spread: 0.2 },
  coo: { gap: 20, seconds: 3.2, phase: [1.2, 1, 0.6, 0], spread: 0.1 },
  low: { gap: 45, seconds: 3.2, phase: [0.8, 1, 0.8, 0.2], spread: 0.15 },
  growl: { gap: 70, seconds: 2.6, phase: [0.5, 0.3, 1, 1], spread: 0.15 },
  seal: { gap: 36, seconds: 2, phase: [1, 1, 0.8, 0.3], spread: 0.15 },
  whale: { gap: 55, seconds: 5, phase: ALWAYS, spread: 0.25 },
  fly: { gap: 22, seconds: 2, phase: [0.6, 1, 0.8, 0.15], spread: 0.25 },
  squeak: { gap: 24, seconds: 1, phase: [0.6, 0.4, 1, 1], spread: 0.2 },
  gust: { gap: 28, seconds: 4.2, phase: ALWAYS, spread: 0.3 },
  drip: { gap: 6, seconds: 1.2, phase: ALWAYS, spread: 0.35 },
  bubble: { gap: 9, seconds: 2, phase: ALWAYS, spread: 0.4 },
  splash: { gap: 30, seconds: 0.8, phase: ALWAYS, spread: 0.3 },
  rustle: { gap: 20, seconds: 1.6, phase: ALWAYS, spread: 0.2 },
  peck: { gap: 34, seconds: 1.2, phase: DIURNAL, spread: 0.2 },
  icecrack: { gap: 26, seconds: 2.2, phase: ALWAYS, spread: 0.4 },
  rumble: { gap: 60, seconds: 6, phase: ALWAYS, spread: 0.2 },
  bell: { gap: 55, seconds: 14, phase: [1, 1, 1, 0.25], spread: 0.02 },
  chime: { gap: 18, seconds: 7, phase: ALWAYS, spread: 0.05 },
  gong: { gap: 65, seconds: 14, phase: [1.2, 0.6, 1.2, 0.4], spread: 0.03 },
  door: { gap: 34, seconds: 1.2, phase: [0.6, 1, 1, 0.3], spread: 0.25 },
  creak: { gap: 20, seconds: 2, phase: ALWAYS, spread: 0.3 },
  hoof: { gap: 45, seconds: 3.6, phase: WORKDAY, spread: 0.15 },
  anvil: { gap: 26, seconds: 5.5, phase: WORKDAY, spread: 0.06 },
  call: { gap: 20, seconds: 2.4, phase: WORKDAY, spread: 0.25 },
  clink: { gap: 16, seconds: 1.2, phase: [0.3, 0.8, 1, 0.6], spread: 0.3 },
  horn: { gap: 75, seconds: 5.5, phase: [1, 0.7, 1, 0.2], spread: 0.08 },
  flap: { gap: 20, seconds: 2.4, phase: ALWAYS, spread: 0.2 },
  knock: { gap: 30, seconds: 2.4, phase: WORKDAY, spread: 0.2 },
  train: { gap: 80, seconds: 5, phase: [0.8, 1, 1, 0.6], spread: 0.06 },
  carpass: { gap: 16, seconds: 5, phase: [0.5, 1, 1, 0.3], spread: 0.3 },
  spark: { gap: 20, seconds: 1, phase: [0.6, 0.5, 1, 1], spread: 0.3 },
  static: { gap: 26, seconds: 2, phase: ALWAYS, spread: 0.2 },
  hiss: { gap: 28, seconds: 1.8, phase: ALWAYS, spread: 0.3 },
  clank: { gap: 24, seconds: 1.6, phase: [0.5, 1, 0.7, 0.3], spread: 0.3 },
  servo: { gap: 22, seconds: 1.8, phase: ALWAYS, spread: 0.3 },
  beep: { gap: 20, seconds: 1, phase: ALWAYS, spread: 0.2 },
};

export const EVENT_KINDS = Object.keys(EVENTS) as EventKind[];

/** Events that come with a bed whenever it is in the mix: [kind, keenness]. */
export const BED_EVENTS: Partial<Record<BedId, readonly (readonly [EventKind, number])[]>> = {
  wind: [['gust', 0.6]],
  desert: [['gust', 0.5]],
  leaves: [['rustle', 0.8]],
  water: [['splash', 0.6]],
  stream: [['splash', 0.4]],
  surf: [['gull', 0.4]],
  cave: [['drip', 1.3], ['rumble', 0.2]],
  underwater: [['bubble', 1.4], ['whale', 0.5]],
  jungle: [['whoop', 0.5], ['squawk', 0.8], ['drip', 0.4]],
  ice: [['icecrack', 1], ['gust', 0.5]],
  lava: [['rumble', 0.8], ['hiss', 0.6], ['bubble', 0.6]],
  hum: [['clank', 0.6], ['hiss', 0.4]],
  vent: [['hiss', 0.7]],
  buzz: [['spark', 0.8]],
  traffic: [['carpass', 1]],
  drone: [['chime', 0.4]],
  fire: [['hiss', 0.15]],
  frogs: [['splash', 0.3]],
};

export interface EventSpec {
  kind: EventKind;
  /** Mean seconds between events for this source at full keenness. */
  gap: number;
}

/** An event the scheduler has decided to sound now. */
export interface Fired {
  /** The source that asked for it, as returned by add(). */
  source: number;
  kind: EventKind;
  at: number;
  /** Frequency multiplier around 1. */
  pitch: number;
  /** 0..1 loudness within the kind's own range. */
  level: number;
  /** -1 left .. 1 right. */
  pan: number;
  /** 0 close by .. 1 far off: quieter, duller, more of the room. */
  far: number;
  seconds: number;
}

/** Counts sounding one-shot voices, so beds and events share one ceiling. */
export class VoicePool {
  private ends: number[] = [];

  constructor(readonly cap: number) {}

  active(now: number): number {
    this.ends = this.ends.filter((t) => t > now);
    return this.ends.length;
  }

  /** Claims a voice until `until`; false when every voice is busy. */
  take(now: number, until: number): boolean {
    if (this.active(now) >= this.cap) return false;
    this.ends.push(until);
    return true;
  }
}

/** Voices a machine of each quality may sound at once. */
export const VOICE_CAP = [3, 5, 7] as const;

export const MIN_GAP_FACTOR = 0.12;
export const MAX_GAP_FACTOR = 2.6;
/** No source repeats sooner than this, whatever its mean. */
export const MIN_GAP_SECONDS = 1.5;

/**
 * The wait before a source's next event. Mostly a long, lopsided spread around the mean; now and
 * then a short one, the way a bird answers another or a dog barks twice.
 */
export function nextGap(rng: Rng, mean: number): number {
  if (rng.chance(0.18)) return Math.max(MIN_GAP_SECONDS, mean * rng.range(MIN_GAP_FACTOR, 0.3));
  const u = rng.next();
  return Math.max(MIN_GAP_SECONDS, mean * (0.45 + (MAX_GAP_FACTOR - 0.45) * u * u));
}

interface Source {
  id: number;
  kind: EventKind;
  gap: number;
  next: number;
}

export interface SchedulerOptions {
  /** Multiplier on how often things happen; lower on weak machines. Default 1. */
  rate?: number;
}

export class EventScheduler {
  private sources: Source[] = [];
  private ids = 0;
  /** Nothing starts before this: events take turns instead of piling into one moment. */
  private breath = 0;
  private readonly rate: number;

  constructor(private readonly rng: Rng, private readonly pool: VoicePool, opts: SchedulerOptions = {}) {
    this.rate = Math.max(0.1, opts.rate ?? 1);
  }

  /** Registers a source; its first event falls somewhere inside its first mean gap. */
  add(spec: EventSpec, now: number): number {
    const id = ++this.ids;
    const gap = Math.max(MIN_GAP_SECONDS, spec.gap / this.rate);
    this.sources.push({ id, kind: spec.kind, gap, next: now + gap * this.rng.range(0.1, 1) });
    return id;
  }

  remove(id: number): void {
    this.sources = this.sources.filter((s) => s.id !== id);
  }

  get size(): number {
    return this.sources.length;
  }

  /** The events that start at `now`. Call every frame or so; at most one event starts per call. */
  due(now: number, phase: DayPhase): Fired[] {
    const out: Fired[] = [];
    const p = DAY_PHASES.indexOf(phase);
    for (const s of this.sources) {
      if (now < s.next) continue;
      const meta = EVENTS[s.kind];
      const keen = meta.phase[p] ?? 1;
      if (keen <= 0) {
        // Asleep at this hour: look again later without sounding.
        s.next = now + this.rng.range(10, 25);
        continue;
      }
      if (out.length > 0 || now < this.breath) {
        s.next = Math.max(this.breath, now) + this.rng.range(0.4, 2.5);
        continue;
      }
      // A less keen hour is not a slower clock but a coin: the rhythm stays irregular either way.
      if (keen < 1 && !this.rng.chance(keen)) {
        s.next = now + nextGap(this.rng, s.gap);
        continue;
      }
      if (!this.pool.take(now, now + meta.seconds)) {
        s.next = now + this.rng.range(1, 3);
        continue;
      }
      const far = this.rng.next();
      out.push({
        source: s.id, kind: s.kind, at: now,
        pitch: Math.pow(2, this.rng.range(-meta.spread, meta.spread)),
        level: this.rng.range(0.45, 1) * (1 - 0.45 * far),
        pan: this.rng.range(-0.9, 0.9),
        far,
        seconds: meta.seconds,
      });
      s.next = now + nextGap(this.rng, s.gap / Math.max(1, keen));
      this.breath = now + this.rng.range(0.8, 3.5) / this.rate;
    }
    return out;
  }
}
