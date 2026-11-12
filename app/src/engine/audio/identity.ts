// What a world sounds like because of what it is. The ambience words are only a hint; the spec
// also says what is built there (a forge, market stalls, a pier, a reactor), what lives there and
// how many people there are. This file reads those and names the sound layers they bring.

import type { CreatureFamily, ReliefKind, ThemeId, WaterKind, WorldSpec } from '../../world/spec';
import { hasStem, tidy, type BedId, type EventKind } from './vocab';

/** The parts of a spec the sound engine cares about, boiled down so the rig never holds the spec. */
export interface WorldSound {
  seed: number;
  /** What the spec calls the place and the things in it: prompt, title, era, building roles and names, blueprint and prop kinds. */
  text: string;
  creatures: { name: string; family: CreatureFamily; count: number }[];
  /** How many people live there. */
  people: number;
  /** 0 wilderness .. 1 dense city. */
  settled: number;
  relief?: ReliefKind;
  water: WaterKind;
  waterAmount: number;
}

function words(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ');
}

export function soundProfile(spec: WorldSpec): WorldSound {
  const built = [
    ...spec.buildings.map((b) => words(b.role, b.label, b.blueprint)),
    ...(spec.blueprints ?? []).map((b) => words(b.id, b.family)),
    ...(spec.props ?? []).map((p) => { const q = p as { kind?: string; id?: string; family?: string }; return words(q.kind, q.id, q.family); }),
  ];
  return {
    seed: spec.seed,
    text: tidy(words(spec.prompt, spec.title, spec.era, ...built)),
    creatures: (spec.creatures ?? []).map((c) => ({ name: c.name, family: c.family, count: c.count })),
    people: spec.npcs.length,
    settled: spec.terrain?.settled ?? 0.6,
    relief: spec.terrain?.relief,
    water: spec.terrain?.water ?? 'none',
    waterAmount: spec.terrain?.waterAmount ?? 0,
  };
}

interface PlaceRule {
  stems: readonly string[];
  /** Only in these themes; everywhere when absent. */
  themes?: readonly ThemeId[];
  /** Not when any of these is also there: a shrine is filed as a church but does not ring like one. */
  unless?: readonly string[];
  beds?: readonly (readonly [BedId, number])[];
  events?: readonly (readonly [EventKind, number])[];
  /** Beds that cannot be heard in such a place, whatever the words say. */
  mute?: readonly BedId[];
}

const AIRLESS: readonly BedId[] = ['birds', 'crickets', 'cicadas', 'frogs', 'leaves', 'jungle'];

// What the things that stand in a place bring to its sound. Levels are bed levels 0..1; event numbers are keenness.
const PLACES: readonly PlaceRule[] = [
  { stems: ['forge', 'blacksmith', 'smithy', 'anvil', 'foundry', 'farrier', 'armour', 'armor'], beds: [['fire', 0.3]], events: [['anvil', 1.4], ['hiss', 0.5]] },
  { stems: ['market', 'stall', 'bazaar', 'souk', 'tabernae', 'vendor', 'cart$', 'shop', 'store$', 'deli', 'bakery', 'exchange'], beds: [['murmur', 0.5]], events: [['call', 1.2], ['clink', 0.6]] },
  { stems: ['tavern', 'inn', 'saloon', 'cafe', 'bar', 'pub', 'tea house', 'teahouse', 'noodle', 'diner', 'canteen', 'soda fountain'], beds: [['murmur', 0.4]], events: [['clink', 1], ['door', 0.7]] },
  { stems: ['church', 'chapel', 'cathedral', 'abbey', 'clock tower', 'steeple', 'belfry', 'mission', 'lych gate'], unless: ['temple', 'shrine', 'pyramid', 'pagoda', 'minaret', 'mosque', 'medina', 'reef'], events: [['bell', 1]] },
  { stems: ['temple', 'shrine', 'pyramid', 'monastery', 'pagoda', 'stupa', 'ziggurat', 'altar', 'stela', 'stelae'], unless: ['roman', 'rome$', 'forum', 'greek', 'athens'], beds: [['drone', 0.35]], events: [['gong', 1], ['chime', 0.6]] },
  { stems: ['minaret', 'mosque', 'medina', 'souk', 'caravan', 'riad'], events: [['call', 1], ['coo', 0.5], ['knock', 0.4]] },
  { stems: ['pier', 'dock', 'jetty', 'wharf', 'harbor', 'harbour', 'hull', 'ship', 'boat', 'quay', 'lighthouse', 'rig', 'helideck', 'north sea'], beds: [['water', 0.3]], events: [['creak', 1], ['gull', 1], ['clink', 0.4], ['splash', 0.5], ['bell', 0.25]] },
  { stems: ['keep$', 'castle', 'fort$', 'fortress', 'arena', 'barracks', 'gatehouse', 'garrison', 'siege', 'rampart', 'colosseum', 'stable', 'citadel'], events: [['flap', 1], ['hoof', 0.8], ['horn', 0.7], ['knock', 0.4]] },
  { stems: ['forum', 'basilica', 'senate', 'rostra', 'agora', 'colonnade', 'triumphal'], beds: [['murmur', 0.55]], events: [['call', 0.9], ['hoof', 0.8], ['horn', 0.6], ['flap', 0.8], ['knock', 0.4]] },
  { stems: ['tank$', 'tanks$', 'gantry', 'crane', 'derrick', 'refinery', 'factory', 'silo', 'pipe', 'process', 'drill', 'pump$', 'pumps$', 'flare', 'generator', 'reactor', 'tannery', 'salvage'], beds: [['hum', 0.55]], events: [['clank', 1], ['hiss', 0.8], ['servo', 0.4]] },
  { stems: ['workshop', 'garage', 'warehouse', 'loom', 'lantern maker', 'weaver'], events: [['knock', 0.8], ['door', 0.4], ['clank', 0.3]] },
  { stems: ['mill$', 'windmill', 'granary', 'barn', 'farm', 'farmhouse', 'storehouse', 'paddy'], themes: ['medieval', 'western'], events: [['creak', 0.8], ['rooster', 1], ['low', 0.4]] },
  { stems: ['hab', 'dome', 'lab', 'airlock', 'module', 'relay', 'antenna', 'colony', 'outpost', 'research', 'bunker', 'hangar', 'orbital', 'starship', 'radio mast'], themes: ['scifi', 'modern'], beds: [['hum', 0.45], ['vent', 0.35]], events: [['beep', 0.9], ['static', 0.7], ['servo', 0.4]] },
  { stems: ['coral', 'reef', 'kelp', 'underwater', 'abyss', 'seabed', 'submarine', 'sunken', 'atlantis', 'polyp'], beds: [['underwater', 0.6]], events: [['bubble', 1.5], ['whale', 0.6]], mute: [...AIRLESS, 'wind', 'desert', 'traffic', 'water', 'surf', 'stream'] },
  { stems: ['neon', 'billboard', 'cyber', 'megacity', 'hologram'], beds: [['buzz', 0.4], ['traffic', 0.3]], events: [['spark', 0.9], ['static', 0.4], ['carpass', 0.5]] },
  { stems: ['office', 'subway', 'apartment', 'skyscraper', 'avenue', 'manhattan', 'downtown', 'highway', 'midtown', 'rush hour', 'metro', 'cable car', 'cable station'], themes: ['modern', 'scifi'], beds: [['traffic', 0.5]], events: [['carpass', 1], ['train', 0.6], ['dog', 0.3]] },
  { stems: ['house$', 'houses$', 'farmhouse', 'townhouse', 'cottage', 'hut', 'home$', 'homes$', 'ranch', 'suburb', 'favela', 'village'], events: [['dog', 0.6], ['door', 0.6]] },
  { stems: ['suburb', 'favela', 'school', 'court'], themes: ['modern'], events: [['carpass', 0.4], ['call', 0.5]] },
  { stems: ['cave', 'cavern', 'mine$', 'mines$', 'grotto', 'tunnel', 'catacomb'], beds: [['cave', 0.3]], events: [['drip', 1.2]] },
  { stems: ['glacier', 'ice', 'arctic', 'tundra', 'frozen', 'iceberg', 'icefield'], beds: [['ice', 0.3]], events: [['icecrack', 1], ['gust', 0.5]] },
  { stems: ['jungle', 'rainforest', 'mangrove', 'tropic'], beds: [['jungle', 0.5], ['cicadas', 0.3]], events: [['whoop', 0.5], ['squawk', 0.7], ['drip', 0.4]] },
  { stems: ['forest', 'redwood', 'woods', 'grove', 'pines$', 'treehouse', 'orchard'], beds: [['leaves', 0.25], ['birds', 0.5]], events: [['peck', 0.7], ['rustle', 0.6], ['creak', 0.5]] },
  { stems: ['grave$', 'graves$', 'graveyard', 'gravestone', 'gothic', 'haunted', 'tomb', 'cemetery', 'undertaker'], events: [['crow', 0.8], ['bell', 0.4], ['creak', 0.8], ['owl', 0.7], ['drip', 0.4]] },
  { stems: ['desert', 'dune', 'mesa', 'canyon', 'sahara', 'frontier', 'badlands', 'gulch'], beds: [['desert', 0.2]], events: [['hawk', 0.7], ['wolf', 0.6], ['creak', 0.5]] },
  { stems: ['lava', 'volcano', 'volcanic', 'caldera', 'magma'], beds: [['lava', 0.5]], events: [['rumble', 0.8], ['hiss', 0.5]] },
  { stems: ['mars$', 'martian', 'lunar', 'moon base', 'asteroid', 'regolith', 'vacuum', 'airless'], events: [['rumble', 0.3]], mute: AIRLESS },
  { stems: ['swamp', 'bayou', 'marsh', 'bog', 'fen'], beds: [['frogs', 0.5]], events: [['bubble', 0.5], ['fly', 0.7], ['splash', 0.4]] },
  { stems: ['candy', 'storybook', 'fairy', 'toy$', 'gingerbread'], events: [['chime', 1]] },
  { stems: ['radio', 'broadcast', 'antenna'], themes: ['modern'], events: [['static', 0.5]] },
];

// Small birds are heard as a chorus rather than as single calls.
const SONGBIRDS: readonly string[] = ['sparrow', 'swallow', 'finch', 'robin', 'swift', 'martin', 'wren', 'songbird', 'thrush', 'lark', 'warbler', 'starling', 'tit$', 'tits$'];

// The call each creature makes, by what it is called; the first match wins.
const CALLS: readonly (readonly [readonly string[], EventKind])[] = [
  [['bee', 'bees', 'dragonfly', 'dragonflies', 'moth', 'moths', 'wasp', 'beetle', 'locust', 'fly', 'flies', 'mosquito', 'butterfly', 'butterflies'], 'fly'],
  [['gull', 'fulmar', 'tern', 'albatross', 'pelican', 'seabird'], 'gull'],
  [['crow', 'raven', 'rook', 'vulture', 'magpie', 'jackdaw'], 'crow'],
  [['owl'], 'owl'],
  [['wolf', 'wolves', 'coyote', 'jackal', 'dingo'], 'wolf'],
  [['dog', 'hound', 'terrier', 'beagle', 'stray', 'strays', 'mastiff', 'husky', 'vira lata'], 'dog'],
  [['hawk', 'eagle', 'falcon', 'kite', 'buzzard', 'condor'], 'hawk'],
  [['rooster', 'chicken', 'hen', 'cockerel'], 'rooster'],
  [['monkey', 'ape', 'howler', 'marmoset', 'baboon', 'gibbon', 'lemur'], 'whoop'],
  [['macaw', 'parrot', 'toucan', 'stork', 'goose', 'geese', 'duck', 'crane', 'heron', 'peacock', 'cockatoo', 'flamingo'], 'squawk'],
  [['pigeon', 'dove'], 'coo'],
  [['horse', 'warhorse', 'donkey', 'mule', 'camel', 'pony', 'stallion'], 'hoof'],
  [['ox', 'oxen', 'cow', 'cattle', 'elk', 'tapir', 'deer', 'bison', 'yak', 'buffalo', 'moose', 'goat', 'sheep', 'llama', 'strider', 'mammoth'], 'low'],
  [['jaguar', 'tiger', 'lion', 'panther', 'bear', 'dragon$', 'dragons$', 'leopard', 'wyvern', 'beast'], 'growl'],
  [['seal', 'walrus', 'otter', 'penguin'], 'seal'],
  [['whale', 'manta', 'ray', 'dolphin', 'turtle', 'leviathan'], 'whale'],
  [['fish', 'jelly', 'jellies', 'squid', 'eel', 'shark'], 'bubble'],
  [['rat', 'rats', 'mouse', 'mice', 'bat', 'bats', 'squirrel', 'squirrels', 'fox', 'cat', 'cats', 'tabby', 'lizard', 'rabbit', 'hare'], 'squeak'],
  [['drone', 'drones', 'rover', 'rovers', 'robot', 'bot', 'mech', 'walker', 'automaton'], 'servo'],
  [['frog', 'toad'], 'splash'],
];

const FAMILY_CALL: Record<CreatureFamily, EventKind> = {
  quadruped: 'low', biped: 'whoop', winged: 'growl', serpent: 'rustle', bird: 'squawk', swimmer: 'splash',
  crawler: 'rustle', floater: 'servo', colossus: 'growl', swarm: 'fly',
};

/** The sound one kind of creature makes now and then. */
export function creatureCall(name: string, family: CreatureFamily): EventKind {
  const text = tidy(name);
  const tokens = text.split(' ');
  for (const [stems, kind] of CALLS) if (stems.some((s) => hasStem(text, tokens, s))) return kind;
  return FAMILY_CALL[family];
}

export interface IdentityLayers {
  beds: Map<BedId, number>;
  events: Map<EventKind, number>;
  mute: Set<BedId>;
}

/** The layers a world brings by being what it is, before weather, words and the hour are applied. */
export function identityLayers(w: WorldSound, theme: ThemeId): IdentityLayers {
  const out: IdentityLayers = { beds: new Map(), events: new Map(), mute: new Set() };
  const bed = (id: BedId, level: number): void => { out.beds.set(id, Math.max(out.beds.get(id) ?? 0, level)); };
  const event = (kind: EventKind, keen: number): void => { out.events.set(kind, Math.max(out.events.get(kind) ?? 0, keen)); };
  const tokens = w.text.split(' ');

  for (const rule of PLACES) {
    if (rule.themes && !rule.themes.includes(theme)) continue;
    if (!rule.stems.some((s) => hasStem(w.text, tokens, s))) continue;
    if (rule.unless?.some((s) => hasStem(w.text, tokens, s))) continue;
    for (const [id, level] of rule.beds ?? []) bed(id, level);
    for (const [kind, keen] of rule.events ?? []) event(kind, keen);
    for (const id of rule.mute ?? []) out.mute.add(id);
  }

  for (const c of w.creatures) {
    const name = tidy(c.name);
    if (SONGBIRDS.some((s) => hasStem(name, name.split(' '), s))) {
      bed('birds', 0.5);
      continue;
    }
    const kind = creatureCall(c.name, c.family);
    // A flock is heard more often than one animal, but not twenty times more.
    event(kind, Math.min(1.6, 0.5 + 0.35 * Math.sqrt(Math.max(1, c.count))));
    // Small birds are a chorus rather than single calls.
    if (c.family === 'bird' && (kind === 'squawk' || kind === 'coo') && c.count >= 6) bed('birds', 0.4);
  }

  // People are heard before they are seen: the more of them and the denser the place, the more voices carry.
  if (w.people >= 4 && w.settled >= 0.5) bed('murmur', Math.min(0.75, 0.2 + 0.05 * w.people + 0.3 * w.settled));
  // Voices do not carry under water.
  if (out.mute.has('wind') && out.beds.has('murmur')) out.beds.set('murmur', Math.min(0.3, out.beds.get('murmur') ?? 0));

  // The water the land holds, heard as what it is.
  if (w.waterAmount > 0.03) {
    if (w.water === 'river') bed('stream', 0.4);
    else if (w.water === 'shore') bed('surf', 0.4);
    else if (w.water === 'pond' || w.water === 'lake') bed('water', 0.3);
    else if (w.water === 'lava') bed('lava', 0.5);
    else if (w.water === 'ice_sheet') bed('ice', 0.3);
  }
  return out;
}

/** Where the player stands, as the mix hears it. Each is 0..1; a missing one means "not known". */
export interface Place {
  /** 1 at the water's edge, 0 far from any. */
  water?: number;
  /** 1 in the middle of the settlement, 0 out in the wild. */
  settled?: number;
  /** 1 on the highest ground of the place, 0 on the lowest. */
  high?: number;
}

export interface Land {
  plaza: { x: number; z: number; r: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  water: readonly { x: number; z: number; r: number }[];
  /** Lowest and highest ground inside the bounds, metres. */
  lo: number;
  hi: number;
}

const WATER_REACH = 45;

/** Reads a position against the land; cheap enough to run every frame. */
export function placeOf(x: number, y: number, z: number, land: Land): Place {
  const out: Place = {};
  if (land.water.length > 0) {
    let near = 0;
    for (const b of land.water) near = Math.max(near, 1 - Math.max(0, Math.hypot(x - b.x, z - b.z) - b.r) / WATER_REACH);
    out.water = Math.max(0, near);
  }
  const reach = Math.max(20, Math.hypot(land.bounds.maxX - land.bounds.minX, land.bounds.maxZ - land.bounds.minZ) / 2);
  out.settled = Math.min(1, Math.max(0, 1 - Math.max(0, Math.hypot(x - land.plaza.x, z - land.plaza.z) - land.plaza.r) / reach));
  if (land.hi - land.lo > 4) out.high = Math.min(1, Math.max(0, (y - land.lo) / (land.hi - land.lo)));
  return out;
}
