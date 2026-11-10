// Decisions the sound engine makes from spec data, kept pure so they can be tested without audio:
// which ambience beds a scene mixes, what a surface sounds like underfoot, how fast feet fall,
// how big the reverb is, and what the generative music plays.

import type { MoodSpec, SurfaceKind, ThemeId, WeatherKind } from '../../world/spec';
import type { StepFamily } from './loops';

export type BedId =
  | 'rain' | 'thunder' | 'wind' | 'snow' | 'desert' | 'crickets' | 'frogs' | 'birds'
  | 'murmur' | 'hum' | 'leaves' | 'water' | 'fire';

export interface BedMix {
  id: BedId;
  /** 0..1 mix level. */
  level: number;
  /** 0 light, 1 medium, 2 heavy: picks the character of the bed, not just its loudness. */
  variant: 0 | 1 | 2;
}

export interface SceneOpts {
  mood?: MoodSpec;
  theme: ThemeId;
  groundKind?: SurfaceKind;
  sitePattern?: string;
  hour: number;
}

export type DayPhase = 'day' | 'dusk' | 'night';

export function dayPhase(hour: number): DayPhase {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h < 18.5) return 'day';
  if (h >= 5 && h < 20) return 'dusk';
  return 'night';
}

export function intensityBand(intensity: number): 0 | 1 | 2 {
  return intensity < 0.34 ? 0 : intensity < 0.67 ? 1 : 2;
}

// Word stems the ambience vocabulary understands. A free word maps to every bed with a stem it contains.
const WORD_BEDS: readonly (readonly [BedId, readonly string[]])[] = [
  ['rain', ['rain', 'drizzle', 'downpour', 'drip', 'shower', 'monsoon', 'patter']],
  ['thunder', ['thunder', 'storm', 'lightning']],
  ['wind', ['wind', 'breeze', 'gust', 'gale', 'howl', 'draft', 'draught', 'blizzard', 'whistl']],
  ['snow', ['snow', 'hush', 'blizzard', 'frost']],
  ['desert', ['desert', 'dust', 'sand', 'dune', 'dry', 'arid', 'sirocco']],
  ['crickets', ['cricket', 'insect', 'cicada', 'night', 'chirr', 'firefl']],
  ['frogs', ['frog', 'toad', 'swamp', 'marsh', 'bog', 'croak']],
  ['birds', ['bird', 'songbird', 'chorus', 'gull', 'raven', 'sparrow', 'chirp', 'dove', 'lark']],
  ['murmur', ['crowd', 'murmur', 'voice', 'chatter', 'market', 'tavern', 'people', 'bustle', 'saloon', 'babble', 'bazaar', 'street', 'talk']],
  ['hum', ['hum', 'machine', 'engine', 'reactor', 'generator', 'servo', 'electric', 'neon', 'buzz', 'vent', 'static', 'computer', 'drone', 'humming', 'turbine', 'factory', 'industr']],
  ['leaves', ['leaves', 'leaf', 'rustl', 'forest', 'tree', 'canopy', 'foliage', 'grass', 'reed', 'bamboo', 'jungle', 'woods', 'woodland']],
  ['water', ['water', 'wave', 'sea', 'ocean', 'shore', 'harbor', 'harbour', 'dock', 'seaside', 'seagull', 'river', 'stream', 'lapping', 'lake', 'creek', 'brook', 'fountain', 'surf', 'tide', 'coast', 'gull', 'canal']],
  ['fire', ['fire', 'campfire', 'bonfire', 'ember', 'crackl', 'torch', 'hearth', 'forge', 'flame', 'lava', 'brazier', 'furnace']],
];

/** Beds suggested by one free ambience word such as 'distant_crowd' or 'Night insects'. */
export function bedsForWord(word: string): BedId[] {
  const w = word.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (w === '') return [];
  const tokens = w.split(' ');
  const out: BedId[] = [];
  for (const [id, stems] of WORD_BEDS) {
    // Long stems may sit anywhere ('distant_crowd', 'campfire'); four-letter stems must start a token
    // ('rain' fires on 'rainfall' but not 'train'); shorter ones must be the whole token.
    const hit = stems.some((s) =>
      s.length >= 5 ? w.includes(s) : s.length === 4 ? tokens.some((t) => t.startsWith(s)) : tokens.some((t) => t === s || t === `${s}s`));
    if (hit) out.push(id);
  }
  return out;
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
      add('snow', 0.6 + 0.4 * intensity, band);
      add('wind', 0.15 + 0.5 * intensity, band);
      break;
    case 'fog':
    case 'mist':
      add('wind', 0.14, 0);
      break;
    case 'dust':
      add('desert', 0.5 + 0.5 * intensity, band);
      break;
    case 'ash':
      add('wind', 0.25 + 0.2 * intensity, 0);
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

/**
 * The ambience mix for a scene. Weather contributes its own beds, mood.ambience words add theirs,
 * and when no word maps to anything the theme, ground and hour supply a default. A proximity-only
 * murmur bed is always present so nearby NPCs can be heard.
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
  const mood = opts.mood;
  const phase = dayPhase(opts.hour);
  const weather: WeatherKind = mood?.weather ?? 'clear';
  const intensity = mood ? Math.min(1, Math.max(0, mood.intensity)) : 0;
  weatherBeds(weather, intensity, add);

  const named = new Set<BedId>();
  for (const word of mood?.ambience ?? []) for (const id of bedsForWord(word)) named.add(id);
  for (const id of named) {
    if (id === 'murmur') add(id, 0.7, 1);
    else add(id, 0.7, id === 'rain' || id === 'wind' || id === 'snow' || id === 'desert' ? intensityBand(Math.max(intensity, 0.4)) : 1);
  }

  if (named.size === 0) {
    const sheltered = weather === 'rain' || weather === 'storm' || weather === 'snow';
    const life = sheltered ? 0.25 : 1; // animals go quiet in bad weather
    const g = opts.groundKind;
    switch (opts.theme) {
      case 'western':
        add('desert', 0.35, 0);
        add('birds', 0.2 * life, 0);
        add('crickets', 0.6 * life, 1);
        break;
      case 'medieval':
        add('leaves', 0.3, 0);
        add('birds', 0.5 * life, 1);
        add('crickets', 0.5 * life, 1);
        add('frogs', 0.2 * life, 0);
        break;
      case 'scifi':
        add('hum', 0.6, 1);
        add('wind', 0.15, 0);
        break;
      case 'modern':
        add('murmur', 0.35, 1);
        add('hum', 0.12, 0);
        add('birds', 0.2 * life, 0);
        add('crickets', 0.25 * life, 0);
        break;
    }
    if (g === 'sand' || g === 'regolith') add('desert', 0.4, 0);
    if (g === 'snow' || g === 'ice') add('snow', 0.5, 0);
    if (g === 'grass' || g === 'moss') add('leaves', 0.3, 0);
    if (g === 'mud') add('frogs', 0.3 * life, 0);
  }

  // Hour gating: birds belong to the day, crickets and frogs to the night.
  const dayGain = phase === 'day' ? 1 : phase === 'dusk' ? 0.4 : 0;
  const nightGain = phase === 'night' ? 1 : phase === 'dusk' ? 0.6 : named.has('crickets') || named.has('frogs') ? 0.35 : 0;
  const birds = mix.get('birds');
  if (birds) birds.level *= dayGain;
  for (const id of ['crickets', 'frogs'] as const) {
    const bed = mix.get(id);
    if (bed) bed.level *= nightGain;
  }

  if (!mix.has('murmur')) mix.set('murmur', { id: 'murmur', level: 0.5, variant: 0 });
  return [...mix.values()].filter((b) => b.level > 0.02);
}

export function bedKey(b: BedMix): string {
  return `${b.id}:${b.variant}`;
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

export type ModeName = 'dorian' | 'mixolydian' | 'aeolian' | 'lydian' | 'phrygian' | 'ionian' | 'pentatonic';

export const MODES: Record<ModeName, readonly number[]> = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  pentatonic: [0, 3, 5, 7, 10],
};

export interface MusicPlan {
  voice: 'pluck' | 'pad' | 'epiano';
  /** String character for the pluck voice. */
  timbre: 'guitar' | 'lute' | 'harp';
  /** An optional sustained melody line over the main voice. */
  lead: 'reed' | 'flute' | null;
  mode: ModeName;
  /** MIDI note of the tonic in the bass register. */
  root: number;
  bpm: number;
  /** 0..1: how many bars carry notes and how many notes they carry. */
  density: number;
  drone: boolean;
  bells: boolean;
}

const THEME_MUSIC: Record<ThemeId, MusicPlan> = {
  western: { voice: 'pluck', timbre: 'guitar', lead: null, mode: 'dorian', root: 45, bpm: 56, density: 0.35, drone: false, bells: false },
  medieval: { voice: 'pluck', timbre: 'lute', lead: null, mode: 'mixolydian', root: 50, bpm: 72, density: 0.5, drone: true, bells: false },
  scifi: { voice: 'pad', timbre: 'harp', lead: null, mode: 'lydian', root: 48, bpm: 48, density: 0.3, drone: false, bells: true },
  modern: { voice: 'epiano', timbre: 'guitar', lead: null, mode: 'dorian', root: 53, bpm: 60, density: 0.4, drone: false, bells: false },
};

function has(text: string, stems: readonly string[]): boolean {
  return stems.some((s) => text.includes(s));
}

/**
 * The music for a scene, or null for silence. A mood with an empty music string means the author
 * wants none; a spec with no mood at all gets the theme default. Words bend the default: instrument
 * words pick the voice, feeling words pick the mode and tempo.
 */
export function musicPlan(mood: MoodSpec | undefined, theme: ThemeId): MusicPlan | null {
  const plan: MusicPlan = { ...THEME_MUSIC[theme] };
  if (!mood) return plan;
  const text = mood.music.toLowerCase().trim();
  if (text === '' || has(text, ['none', 'silen', 'no music'])) return null;

  if (has(text, ['guitar', 'banjo', 'twang', 'steel string', 'dobro'])) { plan.voice = 'pluck'; plan.timbre = 'guitar'; }
  else if (has(text, ['lute', 'mandolin', 'oud', 'sitar', 'shamisen', 'zither', 'dulcimer', 'pluck'])) { plan.voice = 'pluck'; plan.timbre = 'lute'; }
  else if (has(text, ['harp', 'koto', 'kalimba', 'lyre', 'music box', 'string'])) { plan.voice = 'pluck'; plan.timbre = 'harp'; }
  else if (has(text, ['piano', 'keys', 'rhodes', 'jazz', 'lofi', 'lo-fi', 'chord'])) plan.voice = 'epiano';
  else if (has(text, ['pad', 'synth', 'ambient', 'choir', 'drone', 'organ', 'hum', 'wash', 'ether'])) plan.voice = 'pad';

  if (has(text, ['harmonica', 'accordion', 'reed', 'fiddle', 'violin', 'horn', 'sax', 'trumpet'])) plan.lead = 'reed';
  else if (has(text, ['flute', 'whistle', 'pipe', 'ocarina', 'shakuhachi', 'recorder'])) plan.lead = 'flute';

  if (has(text, ['bell', 'chime', 'glass', 'celesta', 'crystal', 'gamelan'])) plan.bells = true;
  if (has(text, ['drone', 'bagpipe', 'hurdy', 'tanpura', 'monk', 'chant'])) plan.drone = true;

  if (has(text, ['lonely', 'sad', 'mourn', 'melanch', 'wist', 'sorrow', 'blue', 'bitter'])) { plan.mode = 'dorian'; plan.bpm *= 0.9; plan.density *= 0.8; }
  else if (has(text, ['dark', 'omin', 'dread', 'grim', 'tense', 'menac', 'low', 'brood', 'noir'])) { plan.mode = 'aeolian'; plan.bpm *= 0.85; plan.root -= 2; }
  else if (has(text, ['eerie', 'strange', 'alien', 'uncanny', 'myst', 'dream', 'float', 'wonder'])) { plan.mode = 'lydian'; plan.bpm *= 0.9; }
  else if (has(text, ['exotic', 'bazaar', 'desert', 'ancient', 'ritual', 'spanish', 'flamenco'])) plan.mode = 'phrygian';
  else if (has(text, ['bright', 'cheer', 'merry', 'happy', 'joy', 'jaunty', 'hope', 'sunny', 'playful', 'lively'])) { plan.mode = 'mixolydian'; plan.bpm *= 1.15; plan.density = Math.min(1, plan.density * 1.3); }
  else if (has(text, ['calm', 'gentle', 'peace', 'warm', 'soft', 'tender', 'pastoral'])) { plan.mode = 'ionian'; plan.bpm *= 0.92; }
  else if (has(text, ['zen', 'pentaton', 'east', 'bamboo', 'temple', 'koto'])) plan.mode = 'pentatonic';

  if (has(text, ['slow', 'sparse', 'still', 'quiet', 'distant'])) { plan.bpm *= 0.85; plan.density *= 0.75; }
  if (has(text, ['fast', 'busy', 'driving', 'quick', 'upbeat'])) { plan.bpm *= 1.2; plan.density = Math.min(1, plan.density * 1.3); }
  plan.bpm = Math.round(Math.min(110, Math.max(36, plan.bpm)));
  plan.density = Math.min(1, Math.max(0.12, plan.density));
  return plan;
}

/** MIDI note for a scale step counted from the tonic; steps beyond the scale wrap into higher octaves. */
export function scaleNote(plan: MusicPlan, step: number): number {
  const scale = MODES[plan.mode];
  const len = scale.length;
  const oct = Math.floor(step / len);
  return plan.root + 12 * oct + (scale[((step % len) + len) % len] ?? 0);
}
