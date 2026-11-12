// Zod mirror of spec.ts, plus normalisation and the JSON schema handed to the compile model.
import { z } from 'zod';
import { SPEC_VERSION } from './spec';
import { repairBlueprint } from './blueprints';
import { hash32 } from './rng';
import { buildSkeleton, skeletonNature } from './skeletons';
import { SITE_SCALES, scaleFields } from './scale';
import type {
  Blueprint, BlueprintPart, BuildingRole, BuildingSpec, CreatureBehaviour, CreatureFamily, CreatureSpec, FolkSpec, GradeKind,
  LandmarkSpec, MoodSpec, NpcActionId, NpcSpec, PartShape, PartTone, PropBlueprint, QuestStep, ReliefKind, RuleEffect, RuleSpec,
  ScheduleEntry, SitePattern, SiteScale, SiteSpec, SkyFeature, StyleSpec, SurfaceKind, SurfaceSet, TerrainSpec, WaterKind, WeatherKind,
  WorldSpec,
} from './spec';

export const NPC_ACTION_IDS: readonly NpcActionId[] = [
  'continue', 'go_to', 'talk_to', 'idle', 'flee', 'investigate', 'follow_player', 'work',
];

const ThemeS = z.enum(['western', 'medieval', 'scifi', 'modern']);
const SkyS = z.enum(['dawn', 'day', 'dusk', 'night', 'overcast']);
const RoleS = z.enum([
  'saloon', 'tavern', 'inn', 'bank', 'jail', 'sheriff', 'church', 'stable',
  'general_store', 'market', 'blacksmith', 'house', 'hotel', 'townhall',
  'doctor', 'school', 'barber', 'undertaker', 'warehouse', 'workshop',
  'lab', 'hangar', 'cantina', 'command', 'habitat', 'reactor',
  'cafe', 'office', 'shop', 'garage', 'apartment', 'station', 'plaza',
]);
const SizeS = z.enum(['small', 'medium', 'large']);
const MoodS = z.enum(['calm', 'tense', 'cheerful', 'grieving', 'drunk', 'angry', 'afraid']);
const StanceS = z.enum(['friend', 'rival', 'family', 'debtor', 'suspicious', 'neutral']);
const ActivityS = z.enum(['work', 'rest', 'drink', 'pray', 'patrol', 'wander', 'trade', 'sleep', 'eat', 'guard']);
const BaseS = z.enum(['knight', 'barbarian', 'mage', 'rogue', 'ranger', 'rogue_hooded']);

const ScheduleEntryS = z.object({ hour: z.number(), place: z.string(), activity: ActivityS });

const BuildingS = z.object({
  id: z.string(),
  role: RoleS,
  label: z.string(),
  size: SizeS,
  position: z.object({ x: z.number(), z: z.number(), rotY: z.number() }).optional(),
  footprint: z.object({ w: z.number(), d: z.number() }).optional(),
  keyBuilding: z.boolean().optional(),
  blueprint: z.string().optional(),
});

const NpcS = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  persona: z.string(),
  knowledge: z.array(z.string()),
  secrets: z.array(z.string()),
  home: z.string(),
  work: z.string(),
  schedule: z.array(ScheduleEntryS),
  relationships: z.array(z.object({ npcId: z.string(), stance: StanceS })),
  appearance: z.object({ base: BaseS, palette: z.number() }),
  temperament: z.object({ tau: z.number(), bias: z.record(z.string(), z.number()) }),
  voice: z.object({ pitch: z.number(), rate: z.number() }),
  mood: MoodS,
});

const ItemS = z.object({ id: z.string(), name: z.string(), description: z.string(), holder: z.string() });

const StepS = z.object({
  id: z.string(),
  kind: z.enum(['talk', 'fetch', 'deliver', 'visit', 'choose', 'confront']),
  target: z.string(),
  item: z.string().optional(),
  requires: z.array(z.string()),
  objective: z.string(),
  beat: z.string(),
  choices: z.array(z.object({ label: z.string(), unlocks: z.array(z.string()) })).optional(),
  reveals: z.array(z.string()).optional(),
});

const QuestS = z.object({
  id: z.string(),
  title: z.string(),
  hook: z.string(),
  giver: z.string(),
  steps: z.array(StepS),
  endings: z.array(z.object({ stepId: z.string(), label: z.string(), tone: z.enum(['good', 'bitter', 'neutral']) })),
});

const EffectS = z.discriminatedUnion('type', [
  z.object({ type: z.literal('curfew'), fromHour: z.number(), toHour: z.number(), exemptRoles: z.array(z.string()) }),
  z.object({ type: z.literal('ban'), what: z.string(), where: z.string(), enforcer: z.string().optional() }),
  z.object({ type: z.literal('price'), item: z.string(), multiplier: z.number() }),
  z.object({ type: z.literal('mood'), who: z.string(), mood: MoodS }),
  z.object({ type: z.literal('time_scale'), minutesPerRealSecond: z.number() }),
  z.object({ type: z.literal('weather'), sky: SkyS, fog: z.number() }),
  z.object({ type: z.literal('schedule_override'), who: z.string(), entry: ScheduleEntryS }),
  z.object({ type: z.literal('relationship'), a: z.string(), b: z.string(), stance: StanceS }),
  z.object({ type: z.literal('custom'), summary: z.string() }),
]);

const RuleS = z.object({ id: z.string(), text: z.string(), effect: EffectS, source: z.enum(['world', 'player']) });

const PART_SHAPES: readonly PartShape[] = ['box', 'cylinder', 'cone', 'pyramid', 'gable', 'dome', 'sphere', 'wedge', 'arch', 'ring'];
const PART_TONES: readonly PartTone[] = ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow'];

const PartS = z.object({
  shape: z.enum(PART_SHAPES as [PartShape, ...PartShape[]]),
  x: z.number(),
  z: z.number(),
  y: z.number(),
  w: z.number(),
  d: z.number(),
  h: z.number(),
  rot: z.number(),
  tone: z.enum(PART_TONES as [PartTone, ...PartTone[]]),
  repeat: z.number(),
  gap: z.number(),
});

export const SITE_PATTERNS: readonly SitePattern[] = ['street', 'ring', 'scatter', 'grid', 'terraces', 'wild', 'path', 'shoreline', 'cliffside'];
/** Patterns for land that is mostly or wholly unbuilt. */
export const WILD_PATTERNS: readonly SitePattern[] = ['wild', 'path', 'shoreline', 'cliffside'];
const SITE_PATHS: readonly SiteSpec['paths'][] = ['road', 'track', 'none'];
const DialsS = z.record(z.string(), z.union([z.number(), z.string()]));
const BlueprintS = z.object({
  id: z.string(), family: z.string().optional(), dials: DialsS.optional(), summary: z.string(), parts: z.array(PartS), doorX: z.number(),
});
const PropS = z.object({
  family: z.string().optional(), dials: DialsS.optional(), kind: z.string(), size: z.number(), parts: z.array(PartS), weight: z.number(), nature: z.enum(['plant', 'mineral']).optional(),
});
const SiteS = z.object({
  pattern: z.enum(SITE_PATTERNS as [SitePattern, ...SitePattern[]]),
  wild: z.number(),
  paths: z.enum(SITE_PATHS as [SiteSpec['paths'], ...SiteSpec['paths'][]]),
  spacing: z.number(),
  scale: z.enum(SITE_SCALES as [SiteScale, ...SiteScale[]]).optional(),
  density: z.number().optional(),
  heights: z.tuple([z.number(), z.number()]).optional(),
  damage: z.number().optional(),
});
export const SURFACE_KINDS: readonly SurfaceKind[] = [
  'timber', 'planks', 'log', 'plaster', 'adobe', 'brick', 'stone', 'cobble', 'concrete',
  'metal_panel', 'corrugated', 'rusted', 'hull_plate', 'glass_curtain',
  'shingle', 'tile', 'thatch', 'slate', 'canvas', 'paper_screen',
  'organic', 'bark', 'chitin', 'crystal', 'ice', 'coral',
  'dirt', 'sand', 'grass', 'moss', 'snow', 'mud', 'asphalt', 'gravel', 'regolith', 'ash',
];
export const WEATHER_KINDS: readonly WeatherKind[] = [
  'clear', 'rain', 'storm', 'snow', 'fog', 'dust', 'ash', 'spores', 'embers', 'fireflies', 'mist',
];
export const GRADE_KINDS: readonly GradeKind[] = [
  'neutral', 'golden', 'teal_orange', 'cold_steel', 'sepia', 'neon_noir', 'verdant', 'bleached', 'crimson', 'moonlit',
];
const SurfaceS = z.enum(SURFACE_KINDS as [SurfaceKind, ...SurfaceKind[]]);
const SurfacesS = z.object({
  wall: SurfaceS, wall2: SurfaceS, roof: SurfaceS, trim: SurfaceS, ground: SurfaceS, road: SurfaceS,
  wear: z.number(), wet: z.number(),
});
const MoodSpecS = z.object({
  weather: z.enum(WEATHER_KINDS as [WeatherKind, ...WeatherKind[]]),
  intensity: z.number(),
  grade: z.enum(GRADE_KINDS as [GradeKind, ...GradeKind[]]),
  haze: z.number(),
  ambience: z.array(z.string()),
  music: z.string(),
});
const StyleS = z.object({
  name: z.string(),
  foliage: z.string().optional(),
  bark: z.string().optional(),
  wall: z.string(),
  wall2: z.string(),
  roof: z.string(),
  trim: z.string(),
  accent: z.string(),
  dark: z.string(),
  glass: z.string(),
  glow: z.string(),
  ground: z.string(),
  road: z.string(),
  variety: z.number(),
  surfaces: SurfacesS.optional(),
});
const LandmarkS = z.object({ id: z.string(), prompt: z.string(), place: z.string(), height: z.number() });

export const RELIEF_KINDS: readonly ReliefKind[] = [
  'flat', 'rolling', 'dunes', 'craggy', 'terraced', 'crater', 'canyon', 'icefield', 'swamp', 'islands',
];
export const WATER_KINDS: readonly WaterKind[] = ['none', 'pond', 'river', 'shore', 'lake', 'lava', 'acid', 'ice_sheet', 'mist_sea'];
export const SKY_FEATURE_KINDS: readonly SkyFeature['kind'][] = [
  'moon', 'planet', 'ringed_planet', 'second_sun', 'aurora', 'nebula', 'comet', 'floating_islands', 'orbital_ring', 'storm_wall', 'eclipse',
];
export const CREATURE_FAMILIES: readonly CreatureFamily[] = [
  'quadruped', 'biped', 'winged', 'serpent', 'bird', 'swimmer', 'crawler', 'floater', 'colossus', 'swarm',
];
export const CREATURE_BEHAVIOURS: readonly CreatureBehaviour[] = [
  'roam', 'graze', 'patrol', 'perch', 'circle', 'sleep', 'guard', 'flock', 'stalk',
];
export const FOLK_FEATURES: readonly FolkSpec['features'][number][] = [
  'tail', 'horns', 'long_ears', 'snout', 'visor', 'antenna', 'wings', 'hood', 'hat', 'cloak', 'armor', 'pack', 'mask', 'glow_eyes',
];
/** Where a creature may keep to, besides a building id. */
export const HAUNT_WORDS: readonly string[] = ['sky', 'water', 'wild', 'plaza'];

const TerrainS = z.object({
  relief: z.enum(RELIEF_KINDS as [ReliefKind, ...ReliefKind[]]),
  ruggedness: z.number(),
  water: z.enum(WATER_KINDS as [WaterKind, ...WaterKind[]]),
  waterAmount: z.number(),
  horizon: z.string(),
  settled: z.number(),
});
const SkyFeatureS = z.object({
  kind: z.enum(SKY_FEATURE_KINDS as [SkyFeature['kind'], ...SkyFeature['kind'][]]),
  size: z.number(),
  color: z.string(),
});
const CreatureS = z.object({
  id: z.string(),
  name: z.string(),
  family: z.enum(CREATURE_FAMILIES as [CreatureFamily, ...CreatureFamily[]]),
  dials: DialsS,
  size: z.number(),
  count: z.number(),
  behaviour: z.enum(CREATURE_BEHAVIOURS as [CreatureBehaviour, ...CreatureBehaviour[]]),
  haunt: z.string(),
  body: z.string(),
  accent: z.string(),
  glow: z.string(),
  note: z.string(),
});
const FolkS = z.object({
  name: z.string(),
  height: z.number(),
  bulk: z.number(),
  head: z.number(),
  features: z.array(z.enum(FOLK_FEATURES as [FolkSpec['features'][number], ...FolkSpec['features'][number][]])),
  skin: z.array(z.string()),
  cloth: z.array(z.string()),
  trim: z.array(z.string()),
});

export const WorldSpecSchema: z.ZodType<WorldSpec> = z.object({
  version: z.literal(SPEC_VERSION),
  seed: z.number(),
  prompt: z.string(),
  title: z.string(),
  tagline: z.string(),
  theme: ThemeS,
  era: z.string(),
  palette: z.object({ ground: z.string(), accent: z.string(), sky: SkyS, fog: z.number() }),
  time: z.object({ startHour: z.number(), minutesPerRealSecond: z.number() }),
  buildings: z.array(BuildingS),
  npcs: z.array(NpcS),
  items: z.array(ItemS),
  quest: QuestS,
  rules: z.array(RuleS),
  lexicon: z.array(z.string()),
  style: StyleS.optional(),
  site: SiteS.optional(),
  mood: MoodSpecS.optional(),
  terrain: TerrainS.optional(),
  skyFeatures: z.array(SkyFeatureS).optional(),
  creatures: z.array(CreatureS).optional(),
  folk: FolkS.optional(),
  blueprints: z.array(BlueprintS).optional(),
  props: z.array(PropS).optional(),
  landmarks: z.array(LandmarkS).optional(),
});

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const p of path) out += typeof p === 'number' ? `[${p}]` : `${out ? '.' : ''}${String(p)}`;
  return out || '(root)';
}

// ---------------------------------------------------------------------------------------------
// Surfaces and mood: read leniently, so a slip in one field never rejects or flattens a world
// ---------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const unit = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};
const enumWord = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '');

/** The set used for any field a spec leaves out or misspells. */
export const NEUTRAL_SURFACES: SurfaceSet = {
  wall: 'plaster', wall2: 'timber', roof: 'shingle', trim: 'timber', ground: 'dirt', road: 'gravel', wear: 0.4, wet: 0,
};

/** Any value into a full SurfaceSet: unknown kinds take the fallback's field, wear and wet are clamped to 0..1. */
export function coerceSurfaces(raw: unknown, fallback: SurfaceSet = NEUTRAL_SURFACES): SurfaceSet {
  const r = isObj(raw) ? raw : {};
  const kind = (v: unknown, d: SurfaceKind): SurfaceKind => SURFACE_KINDS.find((k) => k === enumWord(v)) ?? d;
  return {
    wall: kind(r.wall, fallback.wall),
    wall2: kind(r.wall2, fallback.wall2),
    roof: kind(r.roof, fallback.roof),
    trim: kind(r.trim, fallback.trim),
    ground: kind(r.ground, fallback.ground),
    road: kind(r.road, fallback.road),
    wear: unit(r.wear, fallback.wear),
    wet: unit(r.wet, fallback.wet),
  };
}

const AMBIENCE_CAP = 6;
const AMBIENCE_WORD_LEN = 24;
const MUSIC_LEN = 40;

function ambienceWord(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, AMBIENCE_WORD_LEN).replace(/_+$/g, '');
}

/** Any value into a full MoodSpec: weather and grade fall back to clear and neutral, numbers are clamped, words tidied. */
export function coerceMood(raw: unknown): MoodSpec {
  const r = isObj(raw) ? raw : {};
  const weather = WEATHER_KINDS.find((k) => k === enumWord(r.weather)) ?? 'clear';
  const ambience: string[] = [];
  for (const v of Array.isArray(r.ambience) ? r.ambience : []) {
    const w = ambienceWord(v);
    if (w && !ambience.includes(w) && ambience.length < AMBIENCE_CAP) ambience.push(w);
  }
  return {
    weather,
    intensity: unit(r.intensity, weather === 'clear' ? 0 : 0.5),
    grade: GRADE_KINDS.find((k) => k === enumWord(r.grade)) ?? 'neutral',
    haze: unit(r.haze, 0.3),
    ambience,
    music: typeof r.music === 'string' ? r.music.replace(/\s+/g, ' ').trim().slice(0, MUSIC_LEN).trim() : '',
  };
}

// ---------------------------------------------------------------------------------------------
// Land, sky, creatures and folk: read leniently too
// ---------------------------------------------------------------------------------------------

const HEX6 = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const numIn = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const hexIn = (v: unknown, fallback: string): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!HEX6.test(t)) return fallback;
  const h = t.slice(1).toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
};
const textIn = (v: unknown, cap: number, fallback = ''): string =>
  (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, cap).trim() : '') || fallback;

/** The word itself when it is in the list, else the first alias whose pattern the word matches. */
function wordIn<T extends string>(v: unknown, allowed: readonly T[], aliases: readonly [RegExp, T][]): T | undefined {
  const w = enumWord(v);
  if (w === '') return undefined;
  const direct = allowed.find((k) => k === w);
  if (direct) return direct;
  for (const [re, k] of aliases) if (re.test(w)) return k;
  return undefined;
}

const RELIEF_ALIASES: readonly [RegExp, ReliefKind][] = [
  [/dune|erg|sand/, 'dunes'], [/crater|caldera|volcan|basin|pit/, 'crater'], [/canyon|gorge|ravine|mesa|gulch/, 'canyon'],
  [/ice|glaci|tundra|frozen|snow/, 'icefield'], [/swamp|marsh|bog|fen|bayou|mangrove|wetland/, 'swamp'],
  [/island|archipel|atoll|reef|shoal/, 'islands'], [/terrace|step|paddy/, 'terraced'],
  [/crag|mountain|cliff|rock|ridge|alpine|peak|karst|jagged/, 'craggy'], [/roll|hill|down|undulat|valley|forest|jungle/, 'rolling'],
  [/flat|plain|level|steppe|salt|deck|street|urban|city/, 'flat'],
];
const WATER_ALIASES: readonly [RegExp, WaterKind][] = [
  [/lava|magma|molten/, 'lava'], [/acid|toxic|slime|sludge/, 'acid'], [/ice|frozen|pack/, 'ice_sheet'],
  [/mist|cloud|fog|void|abyss/, 'mist_sea'], [/shore|sea|ocean|coast|beach|bay|surf|tide|harbou?r/, 'shore'],
  [/river|stream|creek|canal|brook|delta/, 'river'], [/lake|lagoon|reservoir|loch/, 'lake'],
  [/pond|pool|oasis|spring|well|puddle/, 'pond'], [/^(none|dry|no)$/, 'none'],
];
const SKY_ALIASES: readonly [RegExp, SkyFeature['kind']][] = [
  [/eclipse/, 'eclipse'], [/ringed|saturn/, 'ringed_planet'], [/sun|star/, 'second_sun'], [/moon/, 'moon'],
  [/planet|gas_giant|earth|world/, 'planet'], [/aurora|northern_lights/, 'aurora'], [/nebula|galaxy|milky/, 'nebula'],
  [/comet|meteor/, 'comet'], [/float|island|rock/, 'floating_islands'], [/ring|orbital|station/, 'orbital_ring'],
  [/storm|cyclone|wall|tornado|dust_front/, 'storm_wall'],
];
const FAMILY_ALIASES: readonly [RegExp, CreatureFamily][] = [
  [/swarm|flies|locust|gnats|shoal|school/, 'swarm'], [/coloss|titan|giant|leviathan|behemoth|kaiju/, 'colossus'],
  [/wing|dragon|wyvern|bat|pter|griffin|gryph/, 'winged'], [/bird|gull|crow|hawk|eagle|owl|pigeon|raven|vulture|parrot/, 'bird'],
  [/serpent|snake|worm|eel|wyrm|centipede/, 'serpent'], [/swim|fish|whale|shark|seal|dolphin|ray|squid|turtle/, 'swimmer'],
  [/crawl|insect|spider|crab|beetle|scorpion|lizard|rover|tread|ant/, 'crawler'],
  [/float|drone|jelly|balloon|wisp|ghost|spirit|orb|hover/, 'floater'],
  [/biped|ape|monkey|golem|robot|android|mech|humanoid|penguin|raptor/, 'biped'],
  [/quad|horse|camel|wolf|deer|cat|dog|bear|ox|cow|goat|fox|boar|elk|beast/, 'quadruped'],
];
const BEHAVIOUR_ALIASES: readonly [RegExp, CreatureBehaviour][] = [
  [/graz|feed|forag|brows/, 'graze'], [/patrol|march|sweep/, 'patrol'], [/perch|roost|sit/, 'perch'],
  [/circl|soar|orbit|wheel|hover/, 'circle'], [/sleep|rest|dormant|doze|bask/, 'sleep'], [/guard|watch|sentry|defend/, 'guard'],
  [/flock|swarm|herd|school|shoal/, 'flock'], [/stalk|hunt|prowl|lurk/, 'stalk'], [/roam|wander|drift|swim|walk|fly/, 'roam'],
];
const FAMILY_BEHAVIOUR: Record<CreatureFamily, CreatureBehaviour> = {
  quadruped: 'graze', biped: 'roam', winged: 'circle', serpent: 'stalk', bird: 'flock', swimmer: 'roam', crawler: 'roam',
  floater: 'patrol', colossus: 'sleep', swarm: 'flock',
};
const FAMILY_HAUNT: Record<CreatureFamily, string> = {
  quadruped: 'wild', biped: 'wild', winged: 'sky', serpent: 'wild', bird: 'sky', swimmer: 'water', crawler: 'wild',
  floater: 'wild', colossus: 'wild', swarm: 'wild',
};

/** Used when a spec has a terrain object with nothing usable in it. */
export const NEUTRAL_TERRAIN: TerrainSpec = { relief: 'flat', ruggedness: 0.2, water: 'none', waterAmount: 0, horizon: '', settled: 0.7 };

/** Any value into a full TerrainSpec. Water that is 'none' takes no area; water that exists takes at least a little. */
export function coerceTerrain(raw: unknown, fallback: TerrainSpec = NEUTRAL_TERRAIN): TerrainSpec {
  const r = isObj(raw) ? raw : {};
  const water = wordIn(r.water, WATER_KINDS, WATER_ALIASES) ?? fallback.water;
  return {
    relief: wordIn(r.relief, RELIEF_KINDS, RELIEF_ALIASES) ?? fallback.relief,
    ruggedness: unit(r.ruggedness, fallback.ruggedness),
    water,
    waterAmount: water === 'none' ? 0 : Math.max(0.05, unit(r.waterAmount, fallback.waterAmount > 0 ? fallback.waterAmount : 0.25)),
    horizon: textIn(r.horizon, 80, fallback.horizon),
    settled: unit(r.settled, fallback.settled),
  };
}

const SKY_FEATURE_CAP = 3;

/** Up to three sky features; entries with no recognisable kind are dropped. A row [kind, size, color] is read too. */
export function coerceSkyFeatures(raw: unknown): SkyFeature[] {
  const out: SkyFeature[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const e: Record<string, unknown> | null = Array.isArray(v)
      ? { kind: v[0] as unknown, size: v[1] as unknown, color: v[2] as unknown }
      : isObj(v) ? v : typeof v === 'string' ? { kind: v } : null;
    if (!e || out.length >= SKY_FEATURE_CAP) continue;
    const kind = wordIn(e.kind, SKY_FEATURE_KINDS, SKY_ALIASES);
    if (kind) out.push({ kind, size: unit(e.size, 0.3), color: hexIn(e.color, '#e6e2d6') });
  }
  return out;
}

const CREATURE_CAP = 6;
const DIAL_CAP = 12;

function coerceCreatureDials(v: unknown): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (Object.keys(out).length >= DIAL_CAP) break;
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
    else if (typeof x === 'string' && x.trim() !== '') out[k] = Number.isFinite(Number(x)) ? Number(x) : x.trim().slice(0, 24);
  }
  return out;
}

const CREATURE_ROW = ['id', 'name', 'family', 'size', 'count', 'behaviour', 'haunt', 'body', 'accent', 'glow', 'note', 'dials'] as const;

/**
 * Up to six kinds of creature. A family or behaviour the engine does not know is read from the word itself
 * or from the creature's name, so "wyvern" still flies and "crab" still crawls. Haunt is kept as written;
 * normalizeSpec repairs it against the buildings.
 */
export function coerceCreatures(raw: unknown): CreatureSpec[] {
  const out: CreatureSpec[] = [];
  const used = new Set<string>();
  for (const v of Array.isArray(raw) ? raw : []) {
    let e: Record<string, unknown> | null = null;
    if (Array.isArray(v)) {
      const row: Record<string, unknown> = {};
      CREATURE_ROW.forEach((k, i) => { row[k] = v[i] as unknown; });
      e = row;
    } else if (isObj(v)) e = v;
    if (!e || out.length >= CREATURE_CAP) continue;
    const name = textIn(e.name, 40) || textIn(e.id, 40).replace(/_/g, ' ');
    if (name === '') continue;
    const base = slugify(textIn(e.id, 40) || name, `creature_${out.length + 1}`);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    const family = wordIn(e.family, CREATURE_FAMILIES, FAMILY_ALIASES) ?? wordIn(name, CREATURE_FAMILIES, FAMILY_ALIASES) ?? 'quadruped';
    const behaviourRaw = e.behaviour ?? e.behavior;
    out.push({
      id,
      name,
      family,
      dials: coerceCreatureDials(e.dials),
      size: numIn(e.size, 0.2, 40, family === 'colossus' ? 14 : 1.2),
      count: Math.round(numIn(e.count, 1, 24, 1)),
      behaviour: wordIn(behaviourRaw, CREATURE_BEHAVIOURS, BEHAVIOUR_ALIASES) ?? FAMILY_BEHAVIOUR[family],
      haunt: textIn(e.haunt, 40).toLowerCase() || FAMILY_HAUNT[family],
      body: hexIn(e.body, '#6b5d4f'),
      accent: hexIn(e.accent, '#3d352d'),
      glow: hexIn(e.glow, '#000000'),
      note: textIn(e.note, 160),
    });
  }
  return out;
}

const NEUTRAL_FOLK: FolkSpec = {
  name: 'people', height: 1.7, bulk: 0.4, head: 1, features: [],
  skin: ['#c69c7b', '#8d5f43', '#e0b89a'], cloth: ['#5b5a4f', '#6f5a44', '#3f4a55'], trim: ['#2b2622', '#8a7a5c'],
};

function hexList(v: unknown, fallback: string[]): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : typeof v === 'string' ? [v] : []) {
    const h = hexIn(x, '');
    if (h !== '' && !out.includes(h) && out.length < 4) out.push(h);
  }
  return out.length > 0 ? out : [...fallback];
}

/** Any value into a full FolkSpec: real human proportions unless the spec says otherwise. */
export function coerceFolk(raw: unknown): FolkSpec {
  const r = isObj(raw) ? raw : {};
  const features: FolkSpec['features'] = [];
  for (const v of Array.isArray(r.features) ? r.features : []) {
    const f = FOLK_FEATURES.find((k) => k === enumWord(v));
    if (f && !features.includes(f) && features.length < 6) features.push(f);
  }
  return {
    name: textIn(r.name, 40, NEUTRAL_FOLK.name),
    height: numIn(r.height, 0.5, 3, NEUTRAL_FOLK.height),
    bulk: unit(r.bulk, NEUTRAL_FOLK.bulk),
    head: numIn(r.head, 0.6, 2, NEUTRAL_FOLK.head),
    features,
    skin: hexList(r.skin, NEUTRAL_FOLK.skin),
    cloth: hexList(r.cloth, NEUTRAL_FOLK.cloth),
    trim: hexList(r.trim, NEUTRAL_FOLK.trim),
  };
}

/**
 * An unknown site pattern, surface kind, weather, grade, relief or creature family is a slip in one field, not
 * a reason to reject the whole world. Surfaces, mood, terrain and folk that are not objects at all are dropped,
 * and the engine infers them.
 */
function lenient(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  if (isObj(raw.site)) {
    const site = raw.site;
    const pattern = SITE_PATTERNS.includes(site.pattern as SitePattern) ? site.pattern : 'street';
    const paths = SITE_PATHS.includes(site.paths as SiteSpec['paths']) ? site.paths : 'road';
    // The scale fields are optional: one that is misspelt or out of range is dropped or clamped, never a reason to refuse the world.
    const rest: Record<string, unknown> = { ...site };
    for (const k of ['scale', 'density', 'heights', 'damage']) delete rest[k];
    out.site = { ...rest, pattern, paths, ...scaleFields(site) };
  }
  if (raw.mood !== undefined) {
    if (isObj(raw.mood)) out.mood = coerceMood(raw.mood);
    else delete out.mood;
  }
  if (isObj(raw.style) && raw.style.surfaces !== undefined) {
    const { surfaces, ...style } = raw.style;
    out.style = isObj(surfaces) ? { ...style, surfaces: coerceSurfaces(surfaces) } : style;
  }
  if (raw.terrain !== undefined) {
    if (isObj(raw.terrain)) out.terrain = coerceTerrain(raw.terrain);
    else delete out.terrain;
  }
  if (raw.folk !== undefined) {
    if (isObj(raw.folk)) out.folk = coerceFolk(raw.folk);
    else delete out.folk;
  }
  if (raw.skyFeatures !== undefined) {
    if (Array.isArray(raw.skyFeatures)) out.skyFeatures = coerceSkyFeatures(raw.skyFeatures);
    else delete out.skyFeatures;
  }
  if (raw.creatures !== undefined) {
    if (Array.isArray(raw.creatures)) out.creatures = coerceCreatures(raw.creatures);
    else delete out.creatures;
  }
  return out;
}

export function validateSpec(raw: unknown): { ok: true; value: WorldSpec } | { ok: false; error: string } {
  const r = WorldSpecSchema.safeParse(lenient(raw));
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  const more = r.error.issues.length > 1 ? ` (+${r.error.issues.length - 1} more)` : '';
  if (!first) return { ok: false, error: '(root): invalid spec' };
  return { ok: false, error: `${formatPath(first.path)}: ${first.message}${more}` };
}

// ---------------------------------------------------------------------------------------------
// JSON schema for the compile model
// ---------------------------------------------------------------------------------------------

/** Free-form skeleton dials: the one object in the model schema that is not closed. */
const DIALS_JSON = { type: 'object', additionalProperties: { anyOf: [{ type: 'number' }, { type: 'string' }] } };

const DROP_KEYS = new Set([
  '$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength',
  'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'propertyNames',
]);

function cleanJson(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanJson);
  if (typeof node !== 'object' || node === null) return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (DROP_KEYS.has(k)) continue;
    // Structured-output schemas accept anyOf only; the discriminated union exports as oneOf.
    if (k === 'oneOf') {
      out.anyOf = cleanJson(v);
      continue;
    }
    if (k === 'properties' && typeof v === 'object' && v !== null) {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = pk === 'dials' ? DIALS_JSON : cleanJson(pv);
      out[k] = props;
    } else out[k] = cleanJson(v);
  }
  // A record (only temperament.bias) becomes an explicit object over the action ids.
  if (out.type === 'object' && out.properties === undefined && typeof out.additionalProperties === 'object') {
    const valueSchema = out.additionalProperties;
    const props: Record<string, unknown> = {};
    for (const id of NPC_ACTION_IDS) props[id] = valueSchema;
    out.properties = props;
  }
  if (out.type === 'object') out.additionalProperties = false;
  if (Array.isArray(out.required) && out.required.length === 0) delete out.required;
  return out;
}

export function worldSpecJsonSchema(): object {
  const raw = z.toJSONSchema(WorldSpecSchema, { io: 'output' });
  const cleaned = cleanJson(raw) as Record<string, unknown>;
  delete cleaned.$defs;
  // Optional in zod so old share links validate; required for the model so every new town carries them.
  const require = (node: unknown, keys: string[]): void => {
    const o = node as { required?: string[] };
    o.required = [...new Set([...(o.required ?? []), ...keys])];
  };
  const props = cleaned.properties as Record<string, unknown>;
  require(cleaned, ['style', 'site', 'mood', 'terrain', 'skyFeatures', 'creatures', 'folk', 'blueprints', 'props', 'landmarks']);
  require(props.style, ['surfaces']);
  require((props.buildings as { items: unknown }).items, ['blueprint']);
  // Every blueprint and prop names a skeleton family and its dials; an empty family string means none.
  require((props.blueprints as { items: unknown }).items, ['family', 'dials']);
  require((props.props as { items: unknown }).items, ['family', 'dials']);
  return cleaned;
}

// ---------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export function slugify(s: string, fallback = 'item'): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return out || fallback;
}

interface IdMap { ids: string[]; resolve(v: string | undefined): string | undefined }

function makeIdMap(olds: string[], prefix: string): IdMap {
  const used = new Set<string>();
  const map = new Map<string, string>();
  const ids: string[] = [];
  olds.forEach((o, i) => {
    const base = slugify(o, `${prefix}_${i + 1}`);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    ids.push(id);
    if (!map.has(o)) map.set(o, id);
  });
  olds.forEach((o, i) => {
    const sl = slugify(o, '');
    if (sl && !map.has(sl)) map.set(sl, ids[i] as string);
  });
  for (const id of ids) if (!map.has(id)) map.set(id, id);
  return {
    ids,
    resolve: (v) => (v === undefined ? undefined : (map.get(v) ?? map.get(slugify(v, '')))),
  };
}

const HOUSING: BuildingRole[] = ['house', 'apartment', 'habitat', 'inn', 'hotel'];
const ROLE_HINTS: [RegExp, BuildingRole[]][] = [
  [/sheriff|marshal|deputy|constable|police|officer/i, ['sheriff', 'jail', 'station', 'townhall']],
  [/bartend|barkeep|innkeep|publican|tavern|saloon/i, ['saloon', 'tavern', 'inn', 'cantina', 'cafe']],
  [/bank|clerk|reeve|mayor|steward/i, ['bank', 'townhall', 'office', 'command']],
  [/preach|priest|monk|abbot|reverend|pastor|chaplain|brother/i, ['church']],
  [/stable|groom|ostler|farrier/i, ['stable']],
  [/doctor|herbal|healer|physician|nurse|medic/i, ['doctor', 'lab']],
  [/smith/i, ['blacksmith', 'workshop', 'garage']],
  [/mechanic/i, ['garage', 'workshop']],
  [/teacher|professor/i, ['school']],
  [/merchant|shopkeep|grocer|trader|vendor/i, ['general_store', 'market', 'shop', 'warehouse']],
  [/pilot/i, ['hangar']],
  [/engineer|technician/i, ['reactor', 'workshop']],
  [/scien|research/i, ['lab']],
  [/command|captain|chief of/i, ['command', 'townhall', 'sheriff']],
  [/undertaker/i, ['undertaker']],
  [/barber/i, ['barber']],
  [/barista|baker|cook/i, ['cafe', 'tavern', 'saloon']],
  [/haul|dock|porter|loader/i, ['warehouse']],
];

function buildingForRole(role: string, buildings: BuildingSpec[]): string | undefined {
  for (const [re, roles] of ROLE_HINTS) {
    if (!re.test(role)) continue;
    for (const r of roles) {
      const b = buildings.find((x) => x.role === r);
      if (b) return b.id;
    }
  }
  return undefined;
}

function homeFallback(buildings: BuildingSpec[]): string {
  for (const r of HOUSING) {
    const b = buildings.find((x) => x.role === r);
    if (b) return b.id;
  }
  return buildings[0]?.id ?? 'street';
}

function fillSchedule(entries: ScheduleEntry[], home: string, work: string): ScheduleEntry[] {
  const out = [...entries];
  const defaults: ScheduleEntry[] = [
    { hour: 22, place: home, activity: 'sleep' },
    { hour: 8, place: work, activity: 'work' },
    { hour: 18, place: 'plaza', activity: 'wander' },
    { hour: 13, place: work, activity: 'eat' },
  ];
  for (const d of defaults) {
    if (out.length >= 3) break;
    if (!out.some((e) => e.hour === d.hour)) out.push(d);
  }
  return out;
}

const sortByHour = (xs: ScheduleEntry[]): ScheduleEntry[] =>
  xs.map((e, i) => ({ e, i })).sort((a, b) => a.e.hour - b.e.hour || a.i - b.i).map((x) => x.e);

const trimList = (xs: string[], cap: number): string[] =>
  xs.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, cap);

interface FixCtx {
  bMap: IdMap; nMap: IdMap; itemId(v: string | undefined): string | undefined;
  place(v: string | undefined): string | undefined;
}

function fixEffect(e: RuleEffect, c: FixCtx): RuleEffect | null {
  switch (e.type) {
    case 'curfew':
      return { ...e, fromHour: clamp(e.fromHour, 0, 23), toHour: clamp(e.toHour, 0, 23), exemptRoles: trimList(e.exemptRoles, 12) };
    case 'ban': {
      const where = e.where === 'town' ? 'town' : (c.bMap.resolve(e.where) ?? 'town');
      const enforcer = c.nMap.resolve(e.enforcer);
      const out: RuleEffect = { type: 'ban', what: e.what, where };
      if (enforcer) out.enforcer = enforcer;
      return out;
    }
    case 'price': {
      const item = c.itemId(e.item);
      return item ? { ...e, item, multiplier: clamp(e.multiplier, 0.1, 10) } : null;
    }
    case 'mood': {
      const who = e.who === 'all' ? 'all' : c.nMap.resolve(e.who);
      return who ? { ...e, who } : null;
    }
    case 'time_scale':
      return { ...e, minutesPerRealSecond: clamp(e.minutesPerRealSecond, 0.5, 30) };
    case 'weather':
      return { ...e, fog: clamp(e.fog, 0, 1) };
    case 'schedule_override': {
      const who = c.nMap.resolve(e.who);
      if (!who) return null;
      return { ...e, who, entry: { ...e.entry, hour: clamp(e.entry.hour, 0, 23), place: c.place(e.entry.place) ?? 'street' } };
    }
    case 'relationship': {
      const a = c.nMap.resolve(e.a);
      const b = c.nMap.resolve(e.b);
      return a && b && a !== b ? { ...e, a, b } : null;
    }
    case 'custom':
      return e;
  }
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexOr(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  if (!HEX_RE.test(t)) return fallback;
  const h = t.slice(1).toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

const NEUTRAL_STYLE: StyleSpec = {
  name: 'plain',
  wall: '#b8a88a', wall2: '#9c8c70', roof: '#6b4f3a', trim: '#d8ceb8', accent: '#b5532d',
  dark: '#2b2622', glass: '#3b5568', glow: '#ffd27a', ground: '#8a8a6a', road: '#6e6a60', variety: 0.2,
};

function fixStyle(s: StyleSpec): StyleSpec {
  const out: StyleSpec = { ...NEUTRAL_STYLE, name: s.name.trim() || NEUTRAL_STYLE.name, variety: clamp(s.variety, 0, 1) };
  for (const k of ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow', 'ground', 'road'] as const) {
    out[k] = hexOr(s[k], NEUTRAL_STYLE[k]);
  }
  if (s.surfaces) out.surfaces = coerceSurfaces(s.surfaces);
  for (const k of ['foliage', 'bark'] as const) {
    const v = s[k];
    if (typeof v === 'string' && hexOr(v, '') !== '') out[k] = hexOr(v, '');
  }
  return out;
}

function fixPart(p: BlueprintPart): BlueprintPart {
  const repeat = Math.round(clamp(p.repeat, 1, 12));
  const rot = Number.isFinite(p.rot) ? (p.rot >= -180 && p.rot <= 180 ? p.rot : ((((p.rot + 180) % 360) + 360) % 360) - 180) : 0;
  return {
    shape: PART_SHAPES.includes(p.shape) ? p.shape : 'box',
    x: clamp(p.x, -0.5, 0.5),
    z: clamp(p.z, -0.5, 0.5),
    y: clamp(p.y, 0, 30),
    w: clamp(p.w, 0.02, 1.4),
    d: clamp(p.d, 0.02, 1.4),
    h: clamp(p.h, 0.05, 30),
    rot,
    tone: PART_TONES.includes(p.tone) ? p.tone : 'wall',
    repeat,
    gap: repeat === 1 ? 0 : clamp(p.gap, 0, 1.4),
  };
}

/**
 * Skeleton expansion: final parts are the skeleton's parts followed by the model's own, capped at 28 with
 * the skeleton first. The result carries no family or dials, so expansion happens once and normalizeSpec
 * is idempotent. Share links carry the expanded parts.
 */
function fixBlueprints(input: Blueprint[], seed: number): Blueprint[] {
  const src = input.slice(0, 8);
  const ids = makeIdMap(src.map((b) => b.id), 'blueprint').ids;
  return src.map((b, i) => {
    const bones = b.family ? buildSkeleton(b.family, b.dials, hash32(`${seed}|${b.id}`)) : [];
    return repairBlueprint({
      id: ids[i] as string,
      summary: b.summary.trim(),
      parts: [...bones, ...b.parts].slice(0, 28).map(fixPart),
      doorX: clamp(b.doorX, -0.4, 0.4),
    });
  });
}

/** Largest prop footprint in metres: wide enough for a forest giant whose crown spreads over a house. */
export const PROP_SIZE_MAX = 16;
/** Tallest pole-like prop (lamp, mast, banner) in metres; industrial places may raise real masts. */
const POLE_MAX_M = 9;
const POLE_MAX_INDUSTRIAL_M = 18;
const POLE_DIAL_MAX = 3.5;
const INDUSTRIAL_SURFACES: readonly SurfaceKind[] = ['corrugated', 'rusted', 'hull_plate', 'metal_panel'];

function fixProps(input: PropBlueprint[], seed: number, industrial: boolean): PropBlueprint[] {
  const src = input.slice(0, 6);
  const ids = makeIdMap(src.map((p) => p.kind), 'prop').ids;
  const out: PropBlueprint[] = [];
  src.forEach((p, i) => {
    const bones = p.family ? buildSkeleton(p.family, p.dials, hash32(`${seed}|${p.kind}`)) : [];
    const parts = [...bones, ...p.parts].slice(0, 28).map(fixPart);
    if (parts.length === 0) return;
    let size = clamp(p.size, 0.3, PROP_SIZE_MAX);
    if (p.family?.trim().toLowerCase() === 'pole') {
      // A pole's height dial is in footprint units, so its real height is size times the dial.
      const raw = Number(p.dials?.['height']);
      const dial = clamp(Number.isFinite(raw) ? raw : 2.2, 1, POLE_DIAL_MAX);
      size = clamp(Math.min(size, (industrial ? POLE_MAX_INDUSTRIAL_M : POLE_MAX_M) / dial), 0.3, PROP_SIZE_MAX);
    }
    const nature = p.nature === 'plant' || p.nature === 'mineral' ? p.nature : skeletonNature(p.family);
    out.push({
      kind: ids[i] as string,
      size,
      parts,
      weight: clamp(p.weight, 1, 5),
      ...(nature ? { nature } : {}),
    });
  });
  return out;
}

/** Haunt is 'sky', 'water', 'wild', 'plaza' or a building id; anything else, or water where there is none, is the wild. */
function fixCreatures(input: CreatureSpec[], bMap: IdMap, terrain: TerrainSpec | undefined): CreatureSpec[] {
  const dry = terrain !== undefined && terrain.water === 'none';
  return coerceCreatures(input).map((c) => {
    const word = HAUNT_WORDS.find((h) => h === c.haunt);
    let haunt = word ?? bMap.resolve(c.haunt) ?? 'wild';
    if (haunt === 'water' && dry) haunt = 'wild';
    return { ...c, haunt };
  });
}

/** The presence that speaks for a place with nobody in it, made only when the quest needs someone to talk to. */
function spiritOfThePlace(spec: WorldSpec, home: string): NpcSpec {
  const title = spec.title.trim() || 'this place';
  const tagline = spec.tagline.trim();
  return {
    id: slugify(spec.quest.giver, 'spirit_of_the_place'),
    name: 'Spirit of the Place',
    role: 'spirit of the place',
    persona: `The old presence of ${title}. It speaks in few, plain words about what it has watched happen here.`,
    knowledge: tagline ? [tagline] : [],
    secrets: [],
    home,
    work: 'plaza',
    schedule: [
      { hour: 0, place: 'plaza', activity: 'rest' },
      { hour: 6, place: 'plaza', activity: 'guard' },
      { hour: 18, place: 'plaza', activity: 'wander' },
    ],
    relationships: [],
    appearance: { base: 'mage', palette: 0 },
    temperament: { tau: 0.8, bias: {} },
    voice: { pitch: 0.8, rate: 0.85 },
    mood: 'calm',
  };
}

const NPC_STEP_KINDS: readonly QuestStep['kind'][] = ['talk', 'deliver', 'confront', 'choose'];

function fixSite(s: SiteSpec): SiteSpec {
  return {
    pattern: SITE_PATTERNS.includes(s.pattern) ? s.pattern : 'street',
    wild: clamp(s.wild, 0, 1),
    paths: SITE_PATHS.includes(s.paths) ? s.paths : 'road',
    spacing: clamp(s.spacing, 2, 14),
    ...scaleFields(s as unknown as Record<string, unknown>),
  };
}

function fixLandmarks(input: LandmarkSpec[], bMap: IdMap): LandmarkSpec[] {
  const src = input.slice(0, 2);
  const ids = makeIdMap(src.map((l) => l.id), 'landmark').ids;
  return src.map((l, i) => ({
    id: ids[i] as string,
    prompt: l.prompt.trim(),
    place: l.place === 'plaza' ? 'plaza' : (bMap.resolve(l.place) ?? 'plaza'),
    height: clamp(l.height, 2, 14),
  }));
}

/** Picks a blueprint for a building that has none: by role word in id or summary, else round-robin. */
function assignBlueprints(buildings: BuildingSpec[], bps: Blueprint[]): BuildingSpec[] {
  let next = 0;
  return buildings.map((b) => {
    if (b.blueprint !== undefined) return b;
    const words = [b.role.replace(/_/g, ' ')];
    const last = b.role.split('_').pop() ?? b.role;
    if (last.length >= 4) words.push(last);
    let hit: Blueprint | undefined;
    for (const w of words) {
      hit = bps.find((bp) => bp.id.replace(/_/g, ' ').includes(w) || bp.summary.toLowerCase().includes(w));
      if (hit) break;
    }
    return { ...b, blueprint: (hit ?? (bps[next++ % bps.length] as Blueprint)).id };
  });
}

export function normalizeSpec(input: WorldSpec): WorldSpec {
  const spec = structuredClone(input);

  // Buildings: 0..14. A wilderness may have a single cave mouth, or nothing built at all.
  let buildings = spec.buildings.slice(0, 14);
  const bMap = makeIdMap(buildings.map((b) => b.id), 'building');
  buildings = buildings.map((b, i) => ({ ...b, id: bMap.ids[i] as string, label: b.label.trim() || b.id }));

  const seed = Math.trunc(Number.isFinite(spec.seed) ? spec.seed : 0) >>> 0;
  const bps = spec.blueprints ? fixBlueprints(spec.blueprints, seed) : undefined;
  const bpMap = makeIdMap((spec.blueprints ?? []).slice(0, 8).map((b) => b.id), 'blueprint');
  buildings = buildings.map((b) => {
    const { blueprint: old, ...rest } = b;
    const id = old !== undefined ? bpMap.resolve(old) : undefined;
    return id !== undefined && bps?.some((x) => x.id === id) ? { ...rest, blueprint: id } : rest;
  });
  if (bps && bps.length > 0) buildings = assignBlueprints(buildings, bps);

  // People: 0..10. With nobody there, a quest that still needs someone to talk to gets the spirit of the place.
  const npcsIn = spec.npcs.slice(0, 10);
  const wantsNpc = spec.quest.giver.trim() !== '' || spec.quest.steps.some((s) => NPC_STEP_KINDS.includes(s.kind));
  if (npcsIn.length === 0 && wantsNpc) npcsIn.push(spiritOfThePlace(spec, homeFallback(buildings)));
  const nMap = makeIdMap(npcsIn.map((n) => n.id), 'npc');
  const iMap = makeIdMap(spec.items.map((i) => i.id), 'item');
  const sMap = makeIdMap(spec.quest.steps.map((s) => s.id), 'step');
  const rMap = makeIdMap(spec.rules.map((r) => r.id), 'rule');

  const place = (v: string | undefined): string | undefined =>
    v === 'street' || v === 'plaza' ? v : bMap.resolve(v);

  const npcs: NpcSpec[] = npcsIn.map((n, idx) => {
    const id = nMap.ids[idx] as string;
    const home = bMap.resolve(n.home) ?? homeFallback(buildings);
    const work = place(n.work) ?? buildingForRole(n.role, buildings) ?? 'street';
    const sched = n.schedule.map((e): ScheduleEntry => {
      const fallback = e.activity === 'sleep' || e.activity === 'rest' || e.activity === 'eat' ? home : work;
      return { hour: clamp(e.hour, 0, 23), place: place(e.place) ?? fallback, activity: e.activity };
    });
    const rels: NpcSpec['relationships'] = [];
    for (const r of n.relationships) {
      const t = nMap.resolve(r.npcId);
      if (t && t !== id && !rels.some((x) => x.npcId === t)) rels.push({ npcId: t, stance: r.stance });
    }
    const biasOut: Record<string, number> = {};
    for (const a of NPC_ACTION_IDS) {
      const v = n.temperament.bias[a];
      biasOut[a] = typeof v === 'number' ? clamp(v, -5, 5) : 0;
    }
    return {
      ...n,
      id,
      name: n.name.trim(),
      knowledge: trimList(n.knowledge, 12),
      secrets: trimList(n.secrets, 6),
      home,
      work,
      schedule: sortByHour(fillSchedule(sortByHour(sched), home, work)),
      relationships: rels,
      appearance: { base: n.appearance.base, palette: Math.max(0, Math.round(n.appearance.palette)) },
      temperament: { tau: clamp(n.temperament.tau, 0.3, 3), bias: biasOut },
      voice: { pitch: clamp(n.voice.pitch, 0.5, 2), rate: clamp(n.voice.rate, 0.5, 2) },
    };
  });

  // With nobody in the world the giver stays empty: a quest of places and things needs no one to open it.
  const giver = nMap.resolve(spec.quest.giver) ?? npcs[0]?.id ?? '';

  const items = spec.items.slice(0, 20).map((it, i) => ({
    ...it,
    id: iMap.ids[i] as string,
    holder: it.holder === 'player' ? 'player' : (nMap.resolve(it.holder) ?? bMap.resolve(it.holder) ?? (giver || buildings[0]?.id || 'player')),
  }));
  const itemId = (v: string | undefined): string | undefined => {
    const r = iMap.resolve(v);
    return r !== undefined && items.some((x) => x.id === r) ? r : undefined;
  };

  const stepRef = (v: string): string | undefined => {
    const r = sMap.resolve(v);
    return r !== undefined && sMap.ids.includes(r) ? r : undefined;
  };
  const uniq = (xs: string[]): string[] => [...new Set(xs)];

  const steps: QuestStep[] = spec.quest.steps.map((s, i) => {
    const id = sMap.ids[i] as string;
    const asNpc = (): string => {
      const direct = nMap.resolve(s.target);
      if (direct) return direct;
      const t = slugify(s.target, '');
      return npcs.find((n) => slugify(n.name, '') === t)?.id ?? giver;
    };
    let target = s.target;
    let item: string | undefined;
    if (s.kind === 'talk' || s.kind === 'deliver' || s.kind === 'confront') target = asNpc();
    else if (s.kind === 'fetch') target = itemId(s.target) ?? itemId(s.item) ?? items[0]?.id ?? s.target;
    else if (s.kind === 'visit') {
      const b = bMap.resolve(s.target);
      const npc = npcs.find((n) => n.id === nMap.resolve(s.target));
      target = b ?? (npc && npc.work !== 'street' && npc.work !== 'plaza' ? npc.work : undefined) ?? buildings[0]?.id ?? s.target;
    } else {
      // choose: only an NPC can offer the choice, so a building resolves to whoever works or lives there.
      const direct = nMap.resolve(s.target);
      const b = direct ? undefined : bMap.resolve(s.target);
      const keeper = b ? (npcs.find((n) => n.work === b) ?? npcs.find((n) => n.home === b))?.id : undefined;
      target = direct ?? keeper ?? asNpc();
    }
    if (s.kind === 'fetch') item = target;
    else if (s.kind === 'deliver') item = itemId(s.item);

    const out: QuestStep = {
      id,
      kind: s.kind,
      target,
      requires: uniq(s.requires.map(stepRef).filter((x): x is string => x !== undefined && x !== id)),
      objective: s.objective.trim(),
      beat: s.beat.trim(),
    };
    if (item !== undefined) out.item = item;
    if (s.kind === 'choose' && s.choices) {
      out.choices = s.choices.slice(0, 4).map((c) => ({
        label: c.label.trim(),
        unlocks: uniq(c.unlocks.map(stepRef).filter((x): x is string => x !== undefined)),
      }));
    }
    if (s.reveals) {
      const kept: string[] = [];
      for (const r of s.reveals) {
        const [who, idx] = r.split(':');
        const npcId = nMap.resolve(who);
        const npc = npcs.find((n) => n.id === npcId);
        const k = Number(idx);
        if (npc && Number.isInteger(k) && k >= 0 && k < npc.secrets.length) kept.push(`${npc.id}:${k}`);
      }
      out.reveals = kept;
    }
    return out;
  });

  const endings = spec.quest.endings
    .map((e) => ({ ...e, stepId: stepRef(e.stepId) }))
    .filter((e): e is typeof e & { stepId: string } => e.stepId !== undefined)
    .filter((e, i, all) => all.findIndex((x) => x.stepId === e.stepId) === i);

  const rules: RuleSpec[] = [];
  spec.rules.slice(0, 12).forEach((r, i) => {
    const effect = fixEffect(r.effect, { bMap, nMap, itemId, place });
    if (effect) rules.push({ ...r, id: rMap.ids[i] as string, effect });
  });

  const arch: Partial<Pick<WorldSpec,
    'style' | 'site' | 'mood' | 'terrain' | 'skyFeatures' | 'creatures' | 'folk' | 'blueprints' | 'props' | 'landmarks'>> = {};
  if (spec.style) arch.style = fixStyle(spec.style);
  if (spec.site) arch.site = fixSite(spec.site);
  if (spec.mood) arch.mood = coerceMood(spec.mood);
  if (spec.terrain) arch.terrain = coerceTerrain(spec.terrain);
  if (spec.skyFeatures) arch.skyFeatures = coerceSkyFeatures(spec.skyFeatures);
  if (spec.creatures) arch.creatures = fixCreatures(spec.creatures, bMap, arch.terrain);
  if (spec.folk) arch.folk = coerceFolk(spec.folk);
  if (bps) arch.blueprints = bps;
  const surf = arch.style?.surfaces;
  const industrial = surf !== undefined && (INDUSTRIAL_SURFACES.includes(surf.wall) || INDUSTRIAL_SURFACES.includes(surf.wall2));
  if (spec.props) arch.props = fixProps(spec.props, seed, industrial);
  if (spec.landmarks) arch.landmarks = fixLandmarks(spec.landmarks, bMap);

  return {
    ...spec,
    ...arch,
    seed,
    palette: { ...spec.palette, fog: clamp(spec.palette.fog, 0, 1) },
    time: {
      startHour: clamp(spec.time.startHour, 0, 23),
      minutesPerRealSecond: clamp(spec.time.minutesPerRealSecond, 0.5, 30),
    },
    buildings,
    npcs,
    items,
    quest: { ...spec.quest, id: slugify(spec.quest.id, 'quest'), giver, steps, endings },
    rules,
    lexicon: trimList(spec.lexicon, 30),
  };
}
