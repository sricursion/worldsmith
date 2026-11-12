// Decisions the sound engine makes from spec data, kept pure so they can be tested without audio:
// which ambience beds and events a scene mixes, how they shift with the hour and with where the
// player stands, what a surface sounds like underfoot, how fast feet fall, how big the reverb is,
// and what the generative music plays.

import { makeRng } from '../../world/rng';
import type { MoodSpec, SurfaceKind, ThemeId, WeatherKind } from '../../world/spec';
import { BED_EVENTS, DAY_PHASES, EVENTS, type DayPhase, type EventSpec } from './events';
import { identityLayers, type Place, type WorldSound } from './identity';
import type { StepFamily } from './loops';
import { EVENT_BUS, wordLayers, type BedId, type EventKind } from './vocab';

export { bedsForWord, type BedId } from './vocab';
export type { DayPhase } from './events';

export interface BedMix {
  id: BedId;
  /** 0..1 mix level. */
  level: number;
  /** 0 light, 1 medium, 2 heavy: picks the character of the bed, not just its loudness. */
  variant: 0 | 1 | 2;
  /** One-shot events this bed carries, for the three life buses. */
  events?: EventSpec[];
}

export interface SceneOpts {
  mood?: MoodSpec;
  theme: ThemeId;
  groundKind?: SurfaceKind;
  sitePattern?: string;
  hour: number;
  /** What the world is, read off its spec: gives the place its own sound and its seed. */
  world?: WorldSound;
}

export function dayPhase(hour: number): DayPhase {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 7.5) return 'dawn';
  if (h >= 7.5 && h < 18.5) return 'day';
  if (h >= 18.5 && h < 20) return 'dusk';
  return 'night';
}

export function intensityBand(intensity: number): 0 | 1 | 2 {
  return intensity < 0.34 ? 0 : intensity < 0.67 ? 1 : 2;
}

/** How one world's version of a bed differs from another's. Every number is a multiplier around 1. */
export interface BedChar {
  /** Pitch of whatever in the bed has one: 0.75 .. 1.34. */
  pitch: number;
  /** How fast it moves: gusts, waves, calls. 0.66 .. 1.5. */
  rate: number;
  /** How much of it there is: insects, drops, voices. 0.6 .. 1.5. */
  density: number;
  /** Filter colour, dark to bright: 0.7 .. 1.4. */
  colour: number;
  seed: number;
}

/** The character a bed takes in the world with this seed: the same word never sounds identical in two worlds. */
export function bedCharacter(seed: number, id: BedId): BedChar {
  const r = makeRng(seed, `bed:${id}`);
  return {
    pitch: Math.pow(2, r.range(-0.42, 0.42)),
    rate: Math.pow(2, r.range(-0.6, 0.6)),
    density: Math.pow(2, r.range(-0.7, 0.6)),
    colour: Math.pow(2, r.range(-0.5, 0.5)),
    seed,
  };
}

function weatherBeds(weather: WeatherKind, intensity: number, add: (id: BedId, level: number, variant?: 0 | 1 | 2) => void): void {
  const band = intensityBand(intensity);
  switch (weather) {
    case 'rain':
      add('rain', 0.55 + 0.45 * intensity, band);
      if (intensity > 0.5) add('wind', 0.3 * intensity, 0);
      break;
    case 'storm':
      add('rain', 0.7 + 0.3 * intensity, band === 0 ? 1 : 2);
      add('thunder', 0.6 + 0.4 * intensity, band);
      add('wind', 0.35 + 0.4 * intensity, band === 0 ? 1 : 2);
      break;
    case 'snow':
      add('snow', 0.45 + 0.4 * intensity, band);
      add('wind', 0.12 + 0.4 * intensity, band);
      break;
    case 'fog':
    case 'mist':
      add('wind', 0.12, 0);
      break;
    case 'dust':
      add('desert', 0.2 + 0.45 * intensity, band);
      break;
    case 'ash':
      add('wind', 0.15 + 0.2 * intensity, 0);
      break;
    case 'embers':
      add('fire', 0.35 + 0.35 * intensity, band);
      break;
    case 'spores':
      add('leaves', 0.2, 0);
      break;
    case 'fireflies':
      add('crickets', 0.4, 1);
      break;
    case 'clear':
      break;
  }
}

// Moving air and water are the floor of a scene, not its subject: a named wind sits well under
// the life of the place, and only weather can push it forward.
const WORD_LEVEL: Partial<Record<BedId, number>> = {
  wind: 0.26, desert: 0.3, leaves: 0.3, snow: 0.45, water: 0.4, surf: 0.45, stream: 0.42, cave: 0.4, ice: 0.35,
  rain: 0.7, thunder: 0.7, murmur: 0.7, hum: 0.5, birds: 0.75, crickets: 0.75, frogs: 0.7,
};
const AIR_BEDS: readonly BedId[] = ['wind', 'desert', 'snow', 'rain'];

/** Wind and water in their several forms: the layers that must never be the whole soundscape. */
export const FLOOR_BEDS: readonly BedId[] = ['wind', 'desert', 'snow', 'leaves', 'water', 'surf', 'stream', 'rain'];
const FLOOR_EVENTS: readonly EventKind[] = ['gust', 'splash', 'rustle'];

// How loud a bed is at dawn, by day, at dusk and at night.
const PHASE_GAIN: Partial<Record<BedId, readonly [number, number, number, number]>> = {
  birds: [1, 0.75, 0.4, 0],
  crickets: [0.3, 0, 0.6, 1],
  frogs: [0.3, 0, 0.6, 1],
  cicadas: [0.2, 1, 0.6, 0.1],
  jungle: [1, 0.8, 0.9, 0.7],
  murmur: [0.4, 1, 0.85, 0.4],
  traffic: [0.5, 1, 1, 0.45],
};

// What each theme adds when nobody says otherwise: [kind, keenness].
const THEME_EVENTS: Record<ThemeId, readonly (readonly [EventKind, number])[]> = {
  western: [['creak', 0.5], ['hawk', 0.4], ['wolf', 0.4], ['door', 0.35]],
  medieval: [['dog', 0.35], ['door', 0.35], ['crow', 0.35], ['creak', 0.3]],
  scifi: [['beep', 0.45], ['static', 0.35], ['servo', 0.45], ['clank', 0.3]],
  modern: [['dog', 0.35], ['door', 0.35], ['carpass', 0.4]],
};

// Under water only these events make sense.
const SUBMERGED: readonly EventKind[] = ['bubble', 'whale', 'beep', 'static', 'servo', 'clank', 'hiss', 'rumble', 'creak', 'chime', 'gong', 'bell', 'growl'];

/** Events in a scene never come faster than one per this many seconds on average, however many kinds it has. */
export const EVENT_FLOOR_SECONDS = 5;
/** The most kinds of event one scene carries. */
export const MAX_EVENT_KINDS = 10;

/**
 * The ambience mix for a scene. Weather contributes its own beds, mood.ambience words add theirs,
 * and what the world is (its buildings, creatures, people and water) adds the layers that make it
 * recognisable. When nothing is named the theme, ground and hour supply a default. One-shot events
 * ride on three life buses, and a proximity-only murmur bed is always present so nearby people can be heard.
 */
export function sceneMix(opts: SceneOpts): BedMix[] {
  const mix = new Map<BedId, BedMix>();
  const add = (id: BedId, level: number, variant: 0 | 1 | 2 = 1): void => {
    const cur = mix.get(id);
    if (!cur) mix.set(id, { id, level: Math.min(1, level), variant });
    else {
      cur.level = Math.min(1, Math.max(cur.level, level));
      cur.variant = Math.max(cur.variant, variant) as 0 | 1 | 2;
    }
  };
  const events = new Map<EventKind, number>();
  const event = (kind: EventKind, keen: number): void => { events.set(kind, Math.max(events.get(kind) ?? 0, keen)); };

  const mood = opts.mood;
  const phase = dayPhase(opts.hour);
  const weather: WeatherKind = mood?.weather ?? 'clear';
  const intensity = mood ? Math.min(1, Math.max(0, mood.intensity)) : 0;
  weatherBeds(weather, intensity, add);

  const named = new Set<BedId>();
  for (const word of mood?.ambience ?? []) {
    const layers = wordLayers(word);
    for (const id of layers.beds) named.add(id);
    for (const kind of layers.events) event(kind, 1);
  }
  const wordsHit = named.size > 0 || events.size > 0;
  for (const id of named) add(id, WORD_LEVEL[id] ?? 0.6, AIR_BEDS.includes(id) ? intensityBand(Math.max(intensity, 0.4)) : 1);

  const sheltered = weather === 'rain' || weather === 'storm' || weather === 'snow';
  const life = sheltered ? 0.3 : 1; // animals go quiet in bad weather

  const identity = opts.world ? identityLayers(opts.world, opts.theme) : null;
  if (identity) {
    for (const [id, level] of identity.beds) add(id, level * (id === 'birds' || id === 'cicadas' || id === 'frogs' ? life : 1), 1);
    for (const [kind, keen] of identity.events) event(kind, keen);
  }

  // A scene that so far is only moving air and water (or nothing at all) takes the theme's own life as well.
  const lively = [...mix.keys()].filter((id) => !FLOOR_BEDS.includes(id)).length + events.size;
  if (lively < 3) {
    const k = wordsHit ? 0.75 : 1;
    switch (opts.theme) {
      case 'western':
        if (!wordsHit) add('desert', 0.3, 0);
        add('birds', 0.3 * life * k, 0);
        add('crickets', 0.7 * life * k, 1);
        break;
      case 'medieval':
        if (!wordsHit) add('leaves', 0.25, 0);
        add('birds', 0.6 * life * k, 1);
        add('crickets', 0.6 * life * k, 1);
        add('frogs', 0.25 * life * k, 0);
        break;
      case 'scifi':
        add('hum', 0.65 * k, 1);
        add('vent', 0.3 * k, 0);
        break;
      case 'modern':
        add('murmur', 0.4 * k, 1);
        add('traffic', 0.3 * k, 0);
        add('birds', 0.3 * life * k, 0);
        add('crickets', 0.3 * life * k, 0);
        break;
    }
  }
  if (!wordsHit) {
    const g = opts.groundKind;
    if (g === 'sand' || g === 'regolith') add('desert', 0.3, 0);
    if (g === 'snow' || g === 'ice') add('snow', 0.4, 0);
    if (g === 'grass' || g === 'moss') add('leaves', 0.25, 0);
    if (g === 'mud') add('frogs', 0.3 * life, 0);
  }
  // The theme only speaks up when the world itself has said little.
  if (events.size < 3) for (const [kind, keen] of THEME_EVENTS[opts.theme]) event(kind, keen);

  for (const id of identity?.mute ?? []) mix.delete(id);
  const submerged = identity?.mute.has('wind') ?? false;

  // The hour: a dawn chorus, daytime bustle, insects and frogs after dark.
  const p = DAY_PHASES.indexOf(phase);
  for (const bed of mix.values()) {
    const gains = PHASE_GAIN[bed.id];
    if (!gains) continue;
    let k = gains[p] ?? 1;
    // Insects somebody asked for by name are still faintly there by day.
    if (k === 0 && (bed.id === 'crickets' || bed.id === 'frogs') && named.has(bed.id)) k = 0.3;
    bed.level *= k;
  }
  const birds = mix.get('birds');
  if (birds && phase === 'dawn') birds.variant = 2;

  // A place is known by a handful of sounds heard often, not by thirty heard once: keep the keenest
  // of what the world and its words named, and let the events that merely come with a bed fill what room is left.
  const rank = (m: Map<EventKind, number>): [EventKind, number][] =>
    [...m].filter(([kind, keen]) => keen > 0 && !(submerged && !SUBMERGED.includes(kind))).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const garnish = new Map<EventKind, number>();
  for (const bed of mix.values()) {
    if (bed.level <= 0.02) continue;
    for (const [kind, keen] of BED_EVENTS[bed.id] ?? []) if (!events.has(kind)) garnish.set(kind, Math.max(garnish.get(kind) ?? 0, keen));
  }
  const ranked = [...rank(events), ...rank(garnish)].slice(0, MAX_EVENT_KINDS);
  const specs: EventSpec[] = ranked.map(([kind, keen]) => ({ kind, gap: EVENTS[kind].gap / keen }));
  // However many kinds a place has, together they keep to a pace the ear can follow.
  const pace = specs.reduce((acc, s) => acc + 1 / s.gap, 0) * EVENT_FLOOR_SECONDS;
  if (pace > 1) for (const s of specs) s.gap *= pace;
  specs.sort((a, b) => (a.kind < b.kind ? -1 : 1));
  for (const bus of ['wildlife', 'townlife', 'shorelife'] as const) {
    const own = specs.filter((s) => EVENT_BUS[s.kind] === bus);
    if (own.length > 0) mix.set(bus, { id: bus, level: 0.8, variant: 1, events: own });
  }

  if (!mix.has('murmur')) mix.set('murmur', { id: 'murmur', level: 0.5, variant: 0 });
  return [...mix.values()].filter((b) => b.level > 0.02);
}

export function bedKey(b: BedMix): string {
  const events = b.events ? `:${b.events.map((e) => `${e.kind}${Math.round(e.gap)}`).join(',')}` : '';
  return `${b.id}:${b.variant}${events}`;
}

/** Keeps the loudest `max` textured beds on a weak machine; the event buses and the proximity murmur cost almost nothing and stay. */
export function trimMix(mix: BedMix[], max: number): BedMix[] {
  const free = (b: BedMix): boolean => b.events !== undefined || (b.id === 'murmur' && b.variant === 0);
  const keep = mix.filter((b) => !free(b)).sort((a, b) => b.level - a.level).slice(0, max);
  return mix.filter((b) => free(b) || keep.includes(b));
}

const WATER_GROUP: readonly BedId[] = ['water', 'surf', 'stream', 'shorelife'];
const CROWD_GROUP: readonly BedId[] = ['murmur', 'townlife', 'traffic'];
const WIND_GROUP: readonly BedId[] = ['wind', 'desert', 'leaves'];

/**
 * How the player's position scales a bed: water swells at the water's edge, voices and work
 * towards the middle of the settlement, wind on high ground, and animals out where people are not.
 * 1 wherever the position does not say.
 */
export function placeGain(id: BedId, place: Place | undefined): number {
  if (!place) return 1;
  if (WATER_GROUP.includes(id) && place.water !== undefined) return 0.2 + 0.8 * place.water;
  if (CROWD_GROUP.includes(id) && place.settled !== undefined) return 0.45 + 0.55 * place.settled;
  if (WIND_GROUP.includes(id)) return (0.75 + 0.5 * (place.high ?? 0.5)) * (1.1 - 0.2 * (place.settled ?? 0.5));
  if (id === 'wildlife' && place.settled !== undefined) return 1 - 0.3 * place.settled;
  return 1;
}

export interface SoundPlan {
  beds: BedMix[];
  /** Every one-shot event the scene can make, across the buses. */
  events: EventSpec[];
  music: MusicPlan | null;
  /** Names of the layers that are neither moving air nor water: what gives the place its identity. */
  identity: string[];
}

/** The whole plan for a scene in one object: what the rig will mix, play and sing. */
export function soundPlan(opts: SceneOpts): SoundPlan {
  const beds = sceneMix(opts);
  const events = beds.flatMap((b) => b.events ?? []);
  const identity = [
    ...beds.filter((b) => !b.events && !FLOOR_BEDS.includes(b.id) && !(b.id === 'murmur' && b.variant === 0)).map((b) => b.id as string),
    ...events.filter((e) => !FLOOR_EVENTS.includes(e.kind)).map((e) => e.kind as string),
  ].sort();
  return { beds, events, music: musicPlan(opts.mood, opts.theme, opts.world?.seed), identity };
}

const STEP_OF: Record<SurfaceKind, StepFamily> = {
  timber: 'wood', planks: 'wood', log: 'wood', bark: 'wood', paper_screen: 'wood', shingle: 'wood',
  plaster: 'hard', adobe: 'hard', brick: 'hard', stone: 'hard', cobble: 'hard', concrete: 'hard',
  glass_curtain: 'hard', tile: 'hard', slate: 'hard', chitin: 'hard', crystal: 'hard', ice: 'hard',
  coral: 'hard', asphalt: 'hard',
  metal_panel: 'metal', corrugated: 'metal', rusted: 'metal', hull_plate: 'metal',
  thatch: 'soft', canvas: 'soft', organic: 'soft', dirt: 'soft', grass: 'soft', moss: 'soft', mud: 'soft', ash: 'soft',
  sand: 'grit', gravel: 'grit', regolith: 'grit',
  snow: 'snow',
};

const THEME_GROUND: Record<ThemeId, StepFamily> = { western: 'soft', medieval: 'soft', scifi: 'metal', modern: 'hard' };
const THEME_FLOOR: Record<ThemeId, StepFamily> = { western: 'wood', medieval: 'wood', scifi: 'metal', modern: 'hard' };

/** What the ground sounds like underfoot; the theme decides when the spec does not say. */
export function stepFamily(kind: SurfaceKind | undefined, theme: ThemeId): StepFamily {
  return kind ? STEP_OF[kind] : THEME_GROUND[theme];
}

/** Interior floors are not in the spec, so the theme picks them. */
export function indoorStepFamily(theme: ThemeId): StepFamily {
  return THEME_FLOOR[theme];
}

export const WALK_STEP_HZ = 1.9;
export const RUN_STEP_HZ = 2.9;

/** Footfalls per second for a movement speed in metres per second; 0 when standing. */
export function stepRate(speed: number, running: boolean): number {
  if (!(speed > 0.35)) return 0;
  if (running) return RUN_STEP_HZ * Math.min(1.1, Math.max(0.8, speed / 5));
  return WALK_STEP_HZ * Math.min(1.1, Math.max(0.7, speed / 2.2));
}

/** Turns per-frame movement into footfalls. advance() returns how many steps land in this frame (0 or 1). */
export class StepClock {
  private phase = 0.55;

  advance(dt: number, speed: number, running: boolean): number {
    const rate = stepRate(speed, running);
    if (rate === 0) {
      // Standing still re-arms the clock so the first step lands shortly after setting off.
      this.phase = 0.55;
      return 0;
    }
    this.phase += Math.min(dt, 0.25) * rate;
    if (this.phase < 1) return 0;
    this.phase -= 1;
    if (this.phase >= 1) this.phase = 0;
    return 1;
  }
}

export interface RoomSpec {
  seconds: number;
  damping: number;
  predelay: number;
  /** Level of the reverb return. */
  wet: number;
}

const ROOMS: Record<string, RoomSpec> = {
  street: { seconds: 1.4, damping: 0.45, predelay: 0.012, wet: 0.5 },
  ring: { seconds: 1.9, damping: 0.4, predelay: 0.02, wet: 0.55 },
  scatter: { seconds: 0.8, damping: 0.8, predelay: 0.006, wet: 0.3 },
  grid: { seconds: 2.6, damping: 0.25, predelay: 0.028, wet: 0.6 },
  terraces: { seconds: 2.1, damping: 0.35, predelay: 0.022, wet: 0.55 },
};

/** Reverb size for a site layout: city blocks ring longest, an open camp barely at all. */
export function roomFor(sitePattern: string | undefined): RoomSpec & { key: string } {
  const key = sitePattern !== undefined && sitePattern in ROOMS ? sitePattern : 'street';
  return { ...(ROOMS[key] as RoomSpec), key };
}


export type ModeName =
  | 'dorian' | 'mixolydian' | 'aeolian' | 'lydian' | 'phrygian' | 'ionian' | 'pentatonic'
  | 'major_pentatonic' | 'hirajoshi' | 'harmonic_minor';

export const MODES: Record<ModeName, readonly number[]> = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  pentatonic: [0, 3, 5, 7, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
  hirajoshi: [0, 2, 3, 7, 8],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
};

/**
 * How the notes of a phrase are laid out: a wandering melody, a broken chord, a short figure that
 * repeats, slow chords alone, or a phrase and its answer.
 */
export type MusicPattern = 'wander' | 'arpeggio' | 'ostinato' | 'chorale' | 'answer';
export const MUSIC_PATTERNS: readonly MusicPattern[] = ['wander', 'arpeggio', 'ostinato', 'chorale', 'answer'];

export interface MusicPlan {
  voice: 'pluck' | 'pad' | 'epiano' | 'mallet';
  /** String character for the pluck voice. */
  timbre: 'guitar' | 'lute' | 'harp';
  /** An optional sustained melody line over the main voice. */
  lead: 'reed' | 'flute' | 'bow' | null;
  mode: ModeName;
  /** MIDI note of the tonic in the bass register. */
  root: number;
  bpm: number;
  /** 0..1: how many bars carry notes and how many notes they carry. */
  density: number;
  drone: boolean;
  bells: boolean;
  /** A soft hand-drum pulse under the phrase. */
  drums: boolean;
  pattern: MusicPattern;
  /** Bars of music, then bars of nothing at all: the music comes and goes instead of running on. */
  phraseBars: number;
  restBars: number;
  /** Seeds the figures the pattern repeats; 0 when the world gave none. */
  seed: number;
}

const BASE = { drums: false, pattern: 'wander', phraseBars: 6, restBars: 4, seed: 0 } as const;
const THEME_MUSIC: Record<ThemeId, MusicPlan> = {
  western: { ...BASE, voice: 'pluck', timbre: 'guitar', lead: null, mode: 'dorian', root: 45, bpm: 56, density: 0.35, drone: false, bells: false },
  medieval: { ...BASE, voice: 'pluck', timbre: 'lute', lead: null, mode: 'mixolydian', root: 50, bpm: 72, density: 0.5, drone: true, bells: false },
  scifi: { ...BASE, voice: 'pad', timbre: 'harp', lead: null, mode: 'lydian', root: 48, bpm: 48, density: 0.3, drone: false, bells: true },
  modern: { ...BASE, voice: 'epiano', timbre: 'guitar', lead: null, mode: 'dorian', root: 53, bpm: 60, density: 0.4, drone: false, bells: false },
};

// Modes a theme may fall into when the words name no feeling, and the patterns it favours.
const THEME_MODES: Record<ThemeId, readonly ModeName[]> = {
  western: ['dorian', 'mixolydian', 'major_pentatonic', 'aeolian'],
  medieval: ['mixolydian', 'dorian', 'aeolian', 'ionian', 'harmonic_minor'],
  scifi: ['lydian', 'pentatonic', 'aeolian', 'hirajoshi'],
  modern: ['dorian', 'ionian', 'aeolian', 'major_pentatonic', 'lydian'],
};
const THEME_PATTERNS: Record<ThemeId, readonly MusicPattern[]> = {
  western: ['wander', 'answer', 'arpeggio', 'ostinato'],
  medieval: ['wander', 'answer', 'arpeggio', 'chorale', 'ostinato'],
  scifi: ['chorale', 'ostinato', 'arpeggio', 'wander'],
  modern: ['wander', 'chorale', 'arpeggio', 'ostinato', 'answer'],
};

function has(text: string, stems: readonly string[]): boolean {
  return stems.some((s) => text.includes(s));
}

/**
 * The music for a scene, or null for silence. A mood with an empty music string means the author
 * wants none; a spec with no mood at all gets the theme default. Words bend the default: instrument
 * words pick the voice, feeling words pick the mode and tempo. With a seed, whatever the words
 * leave open (key, tempo, mode, pattern, how long the phrases and the silences are) is settled by
 * the world, so two worlds with the same words still play different music.
 */
export function musicPlan(mood: MoodSpec | undefined, theme: ThemeId, seed?: number): MusicPlan | null {
  const plan: MusicPlan = { ...THEME_MUSIC[theme] };
  const text = mood ? mood.music.toLowerCase().trim() : '';
  if (mood && (text === '' || has(text, ['none', 'silen', 'no music']))) return null;
  let feeling = false;
  let patterned = false;

  if (has(text, ['guitar', 'banjo', 'twang', 'steel string', 'dobro', 'cavaquinho', 'ukulele'])) { plan.voice = 'pluck'; plan.timbre = 'guitar'; }
  else if (has(text, ['lute', 'mandolin', 'oud', 'sitar', 'shamisen', 'zither', 'dulcimer', 'pluck', 'guimbri', 'balalaika', 'bouzouki'])) { plan.voice = 'pluck'; plan.timbre = 'lute'; }
  else if (has(text, ['kalimba', 'marimba', 'xylophone', 'music box', 'celesta', 'glockenspiel', 'vibraphone', 'mallet', 'gamelan', 'glass', 'steel drum'])) plan.voice = 'mallet';
  else if (has(text, ['harp', 'koto', 'lyre', 'string'])) { plan.voice = 'pluck'; plan.timbre = 'harp'; }
  else if (has(text, ['piano', 'keys', 'rhodes', 'jazz', 'lofi', 'lo-fi', 'chord', 'radio', 'croon'])) plan.voice = 'epiano';
  else if (has(text, ['pad', 'synth', 'ambient', 'choir', 'drone', 'organ', 'hum', 'wash', 'ether', 'cello', 'harmonics'])) plan.voice = 'pad';

  if (has(text, ['harmonica', 'accordion', 'reed', 'fiddle', 'violin', 'horn', 'sax', 'trumpet'])) plan.lead = 'reed';
  else if (has(text, ['flute', 'whistle', 'pipe', 'ocarina', 'shakuhachi', 'recorder'])) plan.lead = 'flute';
  else if (has(text, ['cello', 'viol', 'bowed', 'erhu'])) plan.lead = 'bow';

  if (has(text, ['bell', 'chime', 'glass', 'celesta', 'crystal', 'gamelan'])) plan.bells = true;
  if (has(text, ['drone', 'bagpipe', 'hurdy', 'tanpura', 'monk', 'chant'])) plan.drone = true;
  if (has(text, ['drum', 'percussion', 'taiko', 'tabla', 'samba', 'march', 'tribal'])) plan.drums = true;

  if (has(text, ['lonely', 'sad', 'mourn', 'melanch', 'wist', 'sorrow', 'blue', 'bitter'])) { feeling = true; plan.mode = 'dorian'; plan.bpm *= 0.9; plan.density *= 0.8; }
  else if (has(text, ['dark', 'omin', 'dread', 'grim', 'tense', 'menac', 'low', 'brood', 'noir'])) { feeling = true; plan.mode = 'aeolian'; plan.bpm *= 0.85; plan.root -= 2; }
  else if (has(text, ['eerie', 'strange', 'alien', 'uncanny', 'myst', 'dream', 'float', 'wonder'])) { feeling = true; plan.mode = 'lydian'; plan.bpm *= 0.9; }
  else if (has(text, ['exotic', 'bazaar', 'desert', 'ancient', 'ritual', 'spanish', 'flamenco', 'gnawa', 'oud'])) { feeling = true; plan.mode = 'phrygian'; }
  else if (has(text, ['bright', 'cheer', 'merry', 'happy', 'joy', 'jaunty', 'hope', 'sunny', 'playful', 'lively', 'samba'])) { feeling = true; plan.mode = 'mixolydian'; plan.bpm *= 1.15; plan.density = Math.min(1, plan.density * 1.3); }
  else if (has(text, ['calm', 'gentle', 'peace', 'warm', 'soft', 'tender', 'pastoral'])) { feeling = true; plan.mode = 'ionian'; plan.bpm *= 0.92; }
  else if (has(text, ['zen', 'pentaton', 'east', 'bamboo', 'temple', 'koto', 'shakuhachi', 'shamisen'])) { feeling = true; plan.mode = has(text, ['koto', 'shakuhachi', 'shamisen']) ? 'hirajoshi' : 'pentatonic'; }

  if (has(text, ['arpeggio', 'ripple', 'cascade', 'harp', 'music box'])) { patterned = true; plan.pattern = 'arpeggio'; }
  else if (has(text, ['ostinato', 'pulse', 'hypnotic', 'minimal', 'drum', 'restless', 'driving'])) { patterned = true; plan.pattern = 'ostinato'; }
  else if (has(text, ['hymn', 'choir', 'chorale', 'solemn', 'organ', 'cello', 'harmonics'])) { patterned = true; plan.pattern = 'chorale'; }
  else if (has(text, ['folk', 'dance', 'jig', 'reel', 'fiddle', 'banjo'])) { patterned = true; plan.pattern = 'answer'; }

  if (has(text, ['slow', 'sparse', 'still', 'quiet', 'distant'])) { plan.bpm *= 0.85; plan.density *= 0.75; plan.restBars += 2; }
  if (has(text, ['fast', 'busy', 'driving', 'quick', 'upbeat', 'restless'])) { plan.bpm *= 1.2; plan.density = Math.min(1, plan.density * 1.3); plan.restBars -= 1; }

  if (seed !== undefined) {
    const r = makeRng(seed, 'music');
    plan.seed = seed >>> 0;
    plan.root += r.int(-4, 4);
    plan.bpm *= r.range(0.88, 1.14);
    plan.density *= r.range(0.8, 1.25);
    const mode = r.pick(THEME_MODES[theme]);
    const pattern = r.pick(THEME_PATTERNS[theme]);
    if (!feeling) plan.mode = mode;
    if (!patterned) plan.pattern = pattern;
    plan.phraseBars = r.int(4, 8);
    plan.restBars += r.int(-1, 3);
    if (!plan.bells && r.chance(0.2)) plan.bells = true;
  }
  plan.bpm = Math.round(Math.min(110, Math.max(36, plan.bpm)));
  plan.density = Math.min(1, Math.max(0.12, plan.density));
  plan.restBars = Math.min(10, Math.max(3, plan.restBars + Math.round((1 - plan.density) * 2)));
  return plan;
}

/** MIDI note for a scale step counted from the tonic; steps beyond the scale wrap into higher octaves. */
export function scaleNote(plan: Pick<MusicPlan, 'mode' | 'root'>, step: number): number {
  const scale = MODES[plan.mode];
  const len = scale.length;
  const oct = Math.floor(step / len);
  return plan.root + 12 * oct + (scale[((step % len) + len) % len] ?? 0);
}
