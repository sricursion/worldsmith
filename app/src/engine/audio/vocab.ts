// The ambience vocabulary: the words a world may name, and what each one means to the sound engine.
// A word gives continuous beds (wind, surf, a machine hum), one-shot events (a gull, a bell, a door),
// or both. Pure data and string matching, so it can be tested without audio.

export type BedId =
  | 'rain' | 'thunder' | 'wind' | 'snow' | 'desert' | 'crickets' | 'frogs' | 'birds'
  | 'murmur' | 'hum' | 'leaves' | 'water' | 'fire'
  | 'surf' | 'stream' | 'cave' | 'underwater' | 'vent' | 'buzz' | 'traffic' | 'drone'
  | 'cicadas' | 'jungle' | 'ice' | 'lava'
  // Beds with no texture of their own: they carry the one-shot events of animals, of people at work, and of the shore.
  | 'wildlife' | 'townlife' | 'shorelife';

export type EventKind =
  | 'gull' | 'crow' | 'owl' | 'wolf' | 'dog' | 'hawk' | 'rooster' | 'whoop' | 'squawk' | 'coo' | 'low' | 'growl'
  | 'seal' | 'whale' | 'fly' | 'squeak'
  | 'gust' | 'drip' | 'bubble' | 'splash' | 'rustle' | 'peck' | 'icecrack' | 'rumble'
  | 'bell' | 'chime' | 'gong' | 'door' | 'creak' | 'hoof' | 'anvil' | 'call' | 'clink' | 'horn' | 'flap' | 'knock'
  | 'train' | 'carpass' | 'spark' | 'static' | 'hiss' | 'clank' | 'servo' | 'beep';

export interface WordEntry {
  /** The word the compile prompt offers. */
  word: string;
  /** Other spellings and near words; the word itself always counts. */
  stems: readonly string[];
  beds: readonly BedId[];
  events?: readonly EventKind[];
  /** Understood when a spec uses it, but not offered in the prompt, which has to stay short. */
  unlisted?: true;
}

export const VOCABULARY: readonly WordEntry[] = [
  { word: 'rain', stems: ['drizzle', 'downpour', 'shower', 'monsoon', 'patter'], beds: ['rain'] },
  { word: 'thunder', stems: ['storm', 'lightning'], beds: ['thunder'] },
  { word: 'wind', stems: ['breeze', 'gust', 'gale', 'howl', 'draft', 'draught', 'blizzard', 'whistl'], beds: ['wind'] },
  { word: 'snow', stems: ['hush', 'blizzard', 'frost'], beds: ['snow'] },
  { word: 'desert', stems: ['dust', 'sand', 'dune', 'dry', 'arid', 'sirocco'], beds: ['desert'] },
  { word: 'leaves', stems: ['leaf', 'rustl', 'forest', 'tree', 'canopy', 'foliage', 'grass', 'reed', 'bamboo', 'woods', 'woodland'], beds: ['leaves'] },
  { word: 'water', stems: ['lapping', 'lake', 'pond', 'shore', 'canal', 'moat'], beds: ['water'] },
  { word: 'stream', stems: ['river', 'creek', 'brook', 'fountain', 'waterfall', 'rapids'], beds: ['stream'] },
  { word: 'surf', stems: ['wave', 'sea', 'ocean', 'tide', 'coast', 'seaside', 'breaker', 'beach'], beds: ['surf'] },
  { word: 'harbor', stems: ['harbour', 'dock', 'wharf', 'pier', 'quay', 'jetty', 'marina'], beds: ['water'], events: ['gull', 'creak', 'clink'] },
  { word: 'cave', stems: ['cavern', 'drip', 'grotto', 'tunnel', 'crypt', 'mine$', 'mines$', 'catacomb'], beds: ['cave'] },
  { word: 'underwater', stems: ['bubble', 'submerged', 'undersea', 'abyss', 'reef', 'sunken'], beds: ['underwater'] },
  { word: 'fire', stems: ['campfire', 'bonfire', 'ember', 'crackl', 'torch', 'hearth', 'flame', 'brazier', 'furnace'], beds: ['fire'] },
  { word: 'lava', stems: ['magma', 'volcan', 'molten', 'geyser'], beds: ['lava'], unlisted: true },
  { word: 'crickets', stems: ['cricket', 'insect', 'night', 'chirr', 'firefl'], beds: ['crickets'] },
  { word: 'cicadas', stems: ['cicada', 'locust', 'katydid'], beds: ['cicadas'] },
  { word: 'frogs', stems: ['frog', 'toad', 'swamp', 'marsh', 'bog', 'croak'], beds: ['frogs'] },
  { word: 'birds', stems: ['bird', 'songbird', 'chorus', 'sparrow', 'chirp', 'dove', 'lark'], beds: ['birds'] },
  { word: 'jungle', stems: ['rainforest', 'tropic', 'monkey', 'parrot', 'macaw'], beds: ['jungle'] },
  { word: 'gulls', stems: ['gull', 'seagull', 'seabird', 'tern'], beds: [], events: ['gull'] },
  { word: 'crows', stems: ['crow$', 'raven', 'rook', 'caw', 'vulture'], beds: [], events: ['crow'] },
  { word: 'owls', stems: ['owl', 'hoot'], beds: [], events: ['owl'] },
  { word: 'wolves', stems: ['wolf', 'coyote', 'jackal'], beds: [], events: ['wolf'] },
  { word: 'dogs', stems: ['dog', 'hound', 'bark'], beds: [], events: ['dog'], unlisted: true },
  { word: 'crowd', stems: ['murmur', 'voice', 'chatter', 'people', 'bustle', 'babble', 'street', 'talk'], beds: ['murmur'] },
  { word: 'market', stems: ['bazaar', 'souk', 'vendor', 'stall', 'hawker', 'haggl'], beds: ['murmur'], events: ['call', 'clink'] },
  { word: 'tavern', stems: ['saloon', 'inn', 'pub', 'bar', 'cafe', 'teahouse'], beds: ['murmur'], events: ['clink', 'door'] },
  { word: 'hooves', stems: ['hoof', 'horse', 'cavalry', 'gallop', 'cart', 'wagon'], beds: [], events: ['hoof'] },
  { word: 'forge', stems: ['anvil', 'smith', 'hammer', 'foundry'], beds: ['fire'], events: ['anvil', 'hiss'] },
  { word: 'bells', stems: ['bell', 'toll', 'chapel', 'church'], beds: [], events: ['bell'] },
  { word: 'chimes', stems: ['chime', 'tinkl', 'windchime'], beds: [], events: ['chime'] },
  { word: 'creaks', stems: ['creak', 'timber', 'rigging', 'groan', 'rope'], beds: [], events: ['creak'] },
  { word: 'temple', stems: ['shrine', 'monk$', 'monks$', 'chant', 'gong', 'monastery', 'prayer'], beds: ['drone'], events: ['gong', 'chime'] },
  { word: 'machinery', stems: ['hum', 'machine', 'engine', 'reactor', 'generator', 'servo', 'computer', 'humming', 'turbine', 'factory', 'industr', 'pump'], beds: ['hum'] },
  { word: 'vents', stems: ['vent', 'airlock', 'steam', 'duct', 'fan'], beds: ['vent'], unlisted: true },
  { word: 'buzz', stems: ['electric', 'static', 'transformer', 'spark', 'power'], beds: ['buzz'], unlisted: true },
  { word: 'neon', stems: ['sign$', 'signs$', 'hologram', 'arcade'], beds: ['buzz'], events: ['spark'] },
  { word: 'station', stems: ['spaceship', 'starship', 'orbital', 'habitat', 'console'], beds: ['hum', 'vent'], events: ['beep', 'static'] },
  { word: 'traffic', stems: ['road', 'highway', 'cars', 'city', 'avenue', 'downtown'], beds: ['traffic'] },
  { word: 'train', stems: ['railway', 'railroad', 'locomotive', 'subway', 'metro', 'tram'], beds: [], events: ['train'] },
  { word: 'ice', stems: ['glacier', 'iceberg', 'frozen', 'floe'], beds: ['ice'], unlisted: true },
];

/** The words offered to the compile model. */
export const AMBIENCE_WORDS: readonly string[] = VOCABULARY.filter((e) => !e.unlisted).map((e) => e.word);

/** Which bus carries each event: animals, people at work, or the shore. */
export const EVENT_BUS: Record<EventKind, 'wildlife' | 'townlife' | 'shorelife'> = {
  gull: 'shorelife', seal: 'shorelife', splash: 'shorelife',
  crow: 'wildlife', owl: 'wildlife', wolf: 'wildlife', hawk: 'wildlife', whoop: 'wildlife', squawk: 'wildlife', coo: 'wildlife',
  low: 'wildlife', growl: 'wildlife', whale: 'wildlife', fly: 'wildlife', squeak: 'wildlife', gust: 'wildlife', drip: 'wildlife',
  bubble: 'wildlife', rustle: 'wildlife', peck: 'wildlife', icecrack: 'wildlife', rumble: 'wildlife',
  dog: 'townlife', rooster: 'townlife', bell: 'townlife', chime: 'townlife', gong: 'townlife', door: 'townlife', creak: 'townlife',
  hoof: 'townlife', anvil: 'townlife', call: 'townlife', clink: 'townlife', horn: 'townlife', flap: 'townlife', knock: 'townlife',
  train: 'townlife', carpass: 'townlife', spark: 'townlife', static: 'townlife', hiss: 'townlife', clank: 'townlife',
  servo: 'townlife', beep: 'townlife',
};

/** Lower-case letters only, single spaces. */
export function tidy(text: string): string {
  return text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/**
 * True when tidy text carries the stem. Long stems may sit anywhere ('distant crowd', 'campfire');
 * four-letter stems must start a word ('rain' fires on 'rainfall' but not 'train'); shorter ones
 * must be the whole word, give or take a plural. A stem written with a trailing '$' must be a
 * whole word whatever its length ('crow$' is not 'crowd', 'mars$' is not 'marsh').
 */
export function hasStem(text: string, tokens: readonly string[], stem: string): boolean {
  if (stem.endsWith('$')) return tokens.includes(stem.slice(0, -1));
  if (stem.length >= 5) return text.includes(stem);
  if (stem.length === 4) return tokens.some((t) => t.startsWith(stem));
  return tokens.some((t) => t === stem || t === `${stem}s`);
}

export interface WordLayers {
  beds: BedId[];
  events: EventKind[];
}

/** Everything one free ambience word such as 'distant_crowd' or 'Night insects' asks for. */
export function wordLayers(word: string): WordLayers {
  const text = tidy(word);
  const out: WordLayers = { beds: [], events: [] };
  if (text === '') return out;
  const tokens = text.split(' ');
  for (const e of VOCABULARY) {
    if (!hasStem(text, tokens, e.word) && !e.stems.some((s) => hasStem(text, tokens, s))) continue;
    for (const b of e.beds) if (!out.beds.includes(b)) out.beds.push(b);
    for (const k of e.events ?? []) if (!out.events.includes(k)) out.events.push(k);
  }
  return out;
}

/** Beds one free word maps to; a word that only names events maps to the bus that carries them. */
export function bedsForWord(word: string): BedId[] {
  const layers = wordLayers(word);
  const out = [...layers.beds];
  for (const k of layers.events) if (!out.includes(EVENT_BUS[k])) out.push(EVENT_BUS[k]);
  return out;
}
