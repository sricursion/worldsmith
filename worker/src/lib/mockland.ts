// Mock mode: the land, the sky, the creatures and the folk read from the words of the prompt, so the offline
// demo shows wilderness as well as towns. Also what a live outline falls back to for anything it leaves out.
import type {
  Blueprint, BuildingRole, CreatureBehaviour, CreatureFamily, CreatureSpec, FolkSpec, PropBlueprint, SiteSpec, SkyFeature,
  TerrainSpec, ThemeId,
} from '../../../app/src/world/spec';

/** A structure a keyword land brings with it: the outline row and the skeleton that builds it. */
export interface LandStructure {
  id: string; role: BuildingRole; label: string; form: string; size: 'small' | 'medium' | 'large';
  family: string; dials: Record<string, number | string>;
}

export interface Land {
  /** The keyword group that matched, or null for a plain settlement. */
  biome: string | null;
  terrain: TerrainSpec;
  site: SiteSpec;
  skyFeatures: SkyFeature[];
  creatures: CreatureSpec[];
  folk: FolkSpec;
  /** Structures that replace the fixture town, or null to keep the town. */
  structures: LandStructure[] | null;
  /** Vegetation and rocks as skeleton settings, or null to keep the fixture's props. */
  props: PropBlueprint[] | null;
  /** How many people live here, or null to keep the fixture cast. */
  people: number | null;
}

function creature(
  id: string, name: string, family: CreatureFamily, size: number, count: number, behaviour: CreatureBehaviour, haunt: string,
  body: string, accent: string, glow: string, note: string,
): CreatureSpec {
  return { id, name, family, dials: {}, size, count, behaviour, haunt, body, accent, glow, note };
}

function folk(name: string, height: number, bulk: number, features: FolkSpec['features'], skin: string[], cloth: string[], trim: string[]): FolkSpec {
  return { name, height, bulk, head: 1, features, skin, cloth, trim };
}

function prop(kind: string, family: string, dials: Record<string, number | string>, size: number, weight: number): PropBlueprint {
  return { kind, family, dials, size, weight, parts: [] };
}

const SKIN = ['#c69c7b', '#8d5f43', '#e0b89a'];

interface Biome extends Omit<Land, 'biome'> { name: string; re: RegExp }

/** First match wins; the order is by how specific the word is. */
const BIOMES: Biome[] = [
  {
    name: 'volcano', re: /\b(volcan\w*|lava|magma|caldera|dragon\w*|wyvern\w*)\b/,
    terrain: { relief: 'crater', ruggedness: 0.9, water: 'lava', waterAmount: 0.3, horizon: 'smoking caldera rim', settled: 0.03 },
    site: { pattern: 'cliffside', wild: 0.5, paths: 'track', spacing: 14 },
    skyFeatures: [{ kind: 'storm_wall', size: 0.5, color: '#3a2a26' }],
    creatures: [
      creature('ash_dragon', 'ash dragon', 'winged', 18, 1, 'sleep', 'bone_nest', '#3b3432', '#6b2a1c', '#ff7a2a', 'It sleeps on its hoard, and the ground is warm under it.'),
      creature('ember_moths', 'ember moths', 'swarm', 0.2, 12, 'flock', 'wild', '#5a3a2a', '#2a1c16', '#ffb05a', 'Sparks that turn out to have wings.'),
      creature('cinder_lizard', 'cinder lizard', 'crawler', 1.1, 3, 'roam', 'wild', '#4a4038', '#2c2622', '#ff8a3a', 'It basks on rock too hot to touch.'),
    ],
    folk: folk('kobolds', 1.1, 0.3, ['snout', 'tail', 'horns'], ['#7a5a48', '#5c4a3e'], ['#4a3f38', '#6a4a36'], ['#2a2422', '#8a6a3a']),
    structures: [
      { id: 'cave_mouth', role: 'house', label: 'The Maw', form: 'jagged basalt cave mouth', size: 'large', family: 'arch', dials: { span: 0.7, thickness: 0.3, lintel: 'pointed', towers: 0 } },
      { id: 'bone_nest', role: 'plaza', label: 'The Nest', form: 'low ring of charred rock and bone', size: 'large', family: 'dome', dials: { flatness: 1, drum: 0, oculus: 0, ribs: 6, pods: 4 } },
      { id: 'vent_spires', role: 'reactor', label: 'The Vents', form: 'cluster of leaning basalt spires', size: 'medium', family: 'spire', dials: { count: 6, height: 20, lean: 0.4, sharpness: 0.6, variance: 0.9 } },
    ],
    props: [
      prop('basalt_boulders', 'rock', { form: 'boulder', count: 5, height: 0.8, jagged: 0.9, flat: 0.1 }, 4, 5),
      prop('charred_tree', 'tree', { trunk: 1.8, crown: 'dead', crownSize: 0.6, lean: 0.5 }, 5, 2),
      prop('obsidian_shards', 'rock', { form: 'crystal', count: 4, height: 1, jagged: 0.9, flat: 0.5 }, 3, 2),
    ],
    people: 2,
  },
  {
    name: 'mars', re: /\b(mars|martian|red planet|lunar|moon base|asteroid|alien planet|exoplanet)\b/,
    terrain: { relief: 'crater', ruggedness: 0.6, water: 'none', waterAmount: 0, horizon: 'rust-red crater rim under dust', settled: 0.15 },
    site: { pattern: 'scatter', wild: 0.25, paths: 'track', spacing: 12 },
    skyFeatures: [{ kind: 'moon', size: 0.08, color: '#b8a898' }, { kind: 'moon', size: 0.05, color: '#9a8a7c' }],
    creatures: [
      creature('survey_rover', 'survey rover', 'crawler', 1.6, 3, 'patrol', 'wild', '#b9b2a6', '#4a4a4c', '#ffcf7a', 'A six-wheeled rover reading the ground as it goes.'),
      creature('scout_drone', 'scout drone', 'floater', 0.7, 2, 'patrol', 'sky', '#c8ccd0', '#3a3d42', '#7ad0ff', 'It holds still in the thin air, then moves on.'),
    ],
    folk: folk('colonists in pressure suits', 1.75, 0.5, ['visor', 'pack'], SKIN, ['#c9c4b8', '#a8693c'], ['#3a3d42', '#c8502a']),
    structures: [
      { id: 'hab_dome', role: 'habitat', label: 'Hab One', form: 'pressurised dome with airlock pods', size: 'large', family: 'dome', dials: { flatness: 0.4, drum: 2, oculus: 0.7, ribs: 4, pods: 3 } },
      { id: 'lab_stack', role: 'lab', label: 'Geo Lab', form: 'stacked habitat modules', size: 'medium', family: 'block', dials: { modules: 5, offset: 0.4, cantilever: 0.2 } },
      { id: 'comms_mast', role: 'command', label: 'Uplink', form: 'tall lattice mast with dish', size: 'small', family: 'tower', dials: { height: 22, section: 'square', taper: 0.8, bands: 4, top: 'needle', flare: 0.3 } },
    ],
    props: [
      prop('regolith_boulders', 'rock', { form: 'boulder', count: 4, height: 0.6, jagged: 0.6, flat: 0.3 }, 3, 5),
      prop('antenna_post', 'pole', { head: 'antenna', height: 3, arms: 2 }, 2.5, 1),
      prop('supply_tanks', 'container', { form: 'tank', count: 2, height: 1 }, 1.6, 2),
    ],
    people: 4,
  },
  {
    name: 'arctic', re: /\b(arctic|antarctic\w*|tundra|glacier\w*|polar|ice\s?field|ice\s?cap|frozen|blizzard|iceberg\w*)\b/,
    terrain: { relief: 'icefield', ruggedness: 0.4, water: 'ice_sheet', waterAmount: 0.4, horizon: 'glacier wall and pressure ridges', settled: 0.1 },
    site: { pattern: 'scatter', wild: 0.2, paths: 'track', spacing: 12 },
    skyFeatures: [{ kind: 'aurora', size: 0.7, color: '#6fe0a8' }],
    creatures: [
      creature('ringed_seal', 'ringed seal', 'swimmer', 1.5, 4, 'sleep', 'water', '#6f7478', '#3c4044', '#000000', 'Hauled out by a breathing hole, one eye open.'),
      creature('arctic_fox', 'arctic fox', 'quadruped', 0.7, 2, 'roam', 'wild', '#e6e8ea', '#b8bcc0', '#000000', 'White on white until it moves.'),
      creature('snow_petrel', 'snow petrel', 'bird', 0.4, 6, 'flock', 'sky', '#eef0f2', '#2a2c30', '#000000', 'They ride the wind without a wingbeat.'),
    ],
    folk: folk('researchers in parkas', 1.75, 0.6, ['hood', 'pack'], SKIN, ['#b8402c', '#2f4a6a', '#d0a23a'], ['#22262b', '#d8d8d2']),
    structures: [
      { id: 'main_module', role: 'habitat', label: 'Main Hut', form: 'raised insulated module on legs', size: 'large', family: 'stilts', dials: { legHeight: 2, legs: 6, hut: 0.9, access: 'ramp' } },
      { id: 'science_dome', role: 'lab', label: 'Dome Lab', form: 'low geodesic dome', size: 'medium', family: 'dome', dials: { flatness: 0.5, drum: 1, oculus: 0, ribs: 5, pods: 1 } },
      { id: 'radio_mast', role: 'command', label: 'Radio Mast', form: 'guyed mast with beacon', size: 'small', family: 'tower', dials: { height: 18, section: 'square', taper: 0.85, bands: 3, top: 'needle', flare: 0.2 } },
    ],
    props: [
      prop('ice_shards', 'rock', { form: 'crystal', count: 5, height: 1, jagged: 0.8, flat: 0.4 }, 4, 4),
      prop('snow_boulders', 'rock', { form: 'boulder', count: 3, height: 0.5, jagged: 0.2, flat: 0.5 }, 3, 4),
      prop('flag_line', 'pole', { head: 'banner', height: 2.2, arms: 1 }, 1.4, 2),
    ],
    people: 4,
  },
  {
    name: 'ocean', re: /\b(under\s?water|ocean\w*|reef|coral|sea\s?bed|atlantis|lagoon|island\w*|beach\w*|coast\w*|shore\w*|atoll)\b/,
    terrain: { relief: 'islands', ruggedness: 0.35, water: 'shore', waterAmount: 0.5, horizon: 'open sea to the horizon', settled: 0.1 },
    site: { pattern: 'shoreline', wild: 0.5, paths: 'track', spacing: 12 },
    skyFeatures: [],
    creatures: [
      creature('gulls', 'gulls', 'bird', 0.5, 8, 'flock', 'sky', '#e8e8e4', '#5a5f66', '#000000', 'They quarrel over everything the tide leaves.'),
      creature('silver_shoal', 'silver shoal', 'swarm', 0.25, 16, 'flock', 'water', '#9fb4bc', '#5a6f78', '#e6f4ff', 'A thousand small fish turning as one.'),
      creature('green_turtle', 'green turtle', 'swimmer', 1.2, 2, 'roam', 'water', '#5a6a4a', '#3a4434', '#000000', 'Older than anything built here.'),
    ],
    folk: folk('shore folk', 1.7, 0.4, ['hat'], SKIN, ['#d8d0bc', '#4a6a78', '#b0623f'], ['#2f3a40', '#c8b890']),
    structures: [
      { id: 'pier_hut', role: 'house', label: 'Pier House', form: 'driftwood hut on a short pier', size: 'medium', family: 'stilts', dials: { legHeight: 2.5, legs: 6, hut: 0.7, access: 'ramp' } },
      { id: 'beached_hull', role: 'warehouse', label: 'The Wreck', form: 'beached timber hull on its side', size: 'large', family: 'hull', dials: { ratio: 3.5, sheer: 0.7, masts: 1, cabin: 'aft' } },
    ],
    props: [
      prop('coconut_palm', 'tree', { trunk: 2, crown: 'palm', crownSize: 0.8, lean: 0.6 }, 7, 5),
      prop('tide_rocks', 'rock', { form: 'boulder', count: 4, height: 0.5, jagged: 0.4, flat: 0.5 }, 3, 3),
      prop('dune_grass', 'tree', { trunk: 0.3, crown: 'reeds', crownSize: 0.7, lean: 0.3 }, 1.2, 4),
    ],
    people: 3,
  },
  {
    name: 'swamp', re: /\b(swamp\w*|bayou|marsh\w*|bog|mangrove\w*|fen|wetland\w*)\b/,
    terrain: { relief: 'swamp', ruggedness: 0.15, water: 'pond', waterAmount: 0.45, horizon: 'drowned trees fading into mist', settled: 0.05 },
    site: { pattern: 'path', wild: 0.85, paths: 'track', spacing: 12 },
    skyFeatures: [],
    creatures: [
      creature('grey_heron', 'grey heron', 'bird', 1.1, 2, 'perch', 'water', '#8a9298', '#3a4046', '#000000', 'It has not moved since you arrived.'),
      creature('gator', 'alligator', 'crawler', 3.2, 2, 'stalk', 'water', '#3f4a36', '#2a3024', '#d8c04a', 'A log with eyes.'),
      creature('fireflies', 'fireflies', 'swarm', 0.2, 14, 'flock', 'wild', '#3a3a2a', '#22221a', '#d8ff7a', 'Slow green sparks over the black water.'),
    ],
    folk: folk('marsh dwellers', 1.7, 0.45, ['hat', 'cloak'], SKIN, ['#5a5a44', '#4a4034'], ['#2a2a22', '#7a6a4a']),
    structures: [
      { id: 'stilt_shack', role: 'house', label: 'Stilt Shack', form: 'plank shack on tall stilts', size: 'medium', family: 'stilts', dials: { legHeight: 3.5, legs: 4, hut: 0.75, access: 'ladder' } },
      { id: 'sunk_boat', role: 'warehouse', label: 'Sunk Flatboat', form: 'half-sunk flat river boat', size: 'medium', family: 'hull', dials: { ratio: 3, sheer: 0.2, masts: 0, cabin: 'aft' } },
    ],
    props: [
      prop('cypress', 'tree', { trunk: 2, crown: 'weeping', crownSize: 0.8, lean: 0.3 }, 9, 5),
      prop('reed_bed', 'tree', { trunk: 0.5, crown: 'reeds', crownSize: 0.8, lean: 0.2 }, 2, 5),
      prop('dead_snag', 'tree', { trunk: 1.8, crown: 'dead', crownSize: 0.5, lean: 0.6 }, 6, 2),
    ],
    people: 1,
  },
  {
    name: 'jungle', re: /\b(jungle\w*|rain\s?forest\w*|amazon\w*|tropic\w*|congo|borneo)\b/,
    terrain: { relief: 'rolling', ruggedness: 0.5, water: 'river', waterAmount: 0.25, horizon: 'unbroken jungle canopy', settled: 0.03 },
    site: { pattern: 'path', wild: 0.95, paths: 'track', spacing: 14 },
    skyFeatures: [],
    creatures: [
      creature('howler_monkeys', 'howler monkeys', 'biped', 0.7, 5, 'roam', 'wild', '#3a2a22', '#6a3a22', '#000000', 'You hear them long before you see them.'),
      creature('macaws', 'scarlet macaws', 'bird', 0.8, 6, 'flock', 'sky', '#b03a2a', '#2a5a9a', '#000000', 'Red against the green, gone in a second.'),
      creature('jaguar', 'jaguar', 'quadruped', 1.8, 1, 'stalk', 'wild', '#b8894a', '#2a2018', '#d8c04a', 'It has been watching you for some time.'),
    ],
    folk: folk('river people', 1.65, 0.4, ['pack'], SKIN, ['#6a5a3a', '#8a3a2a'], ['#2a2a22', '#c8a84a']),
    structures: [
      { id: 'river_hut', role: 'house', label: 'River Hut', form: 'thatched hut raised on stilts', size: 'medium', family: 'stilts', dials: { legHeight: 2, legs: 6, hut: 0.8, access: 'ladder' } },
    ],
    props: [
      prop('emergent_tree', 'tree', { trunk: 2, crown: 'umbrella', crownSize: 0.85, lean: 0.2 }, 13, 4),
      prop('understory_palm', 'tree', { trunk: 1.4, crown: 'palm', crownSize: 0.8, lean: 0.4 }, 5, 5),
      prop('fern_bank', 'tree', { trunk: 0.3, crown: 'fern', crownSize: 0.85, lean: 0.2 }, 1.8, 5),
      prop('buttress_tree', 'tree', { trunk: 2, crown: 'ball', crownSize: 0.8, lean: 0.3 }, 9, 4),
    ],
    people: 1,
  },
  {
    name: 'desert', re: /\b(sahara|desert\w*|dune\w*|arid|wasteland\w*|badlands|bedouin|oasis)\b/,
    terrain: { relief: 'dunes', ruggedness: 0.6, water: 'none', waterAmount: 0, horizon: 'dune sea under heat haze', settled: 0.05 },
    site: { pattern: 'wild', wild: 0.15, paths: 'track', spacing: 14 },
    skyFeatures: [],
    creatures: [
      creature('camels', 'dromedary camels', 'quadruped', 2.2, 4, 'graze', 'caravan_tent', '#b8956a', '#8a6a48', '#000000', 'Hobbled, chewing, unimpressed by you.'),
      creature('desert_hawk', 'desert hawk', 'bird', 0.6, 1, 'circle', 'sky', '#7a5a3a', '#3a2a1c', '#000000', 'One dark mark turning in a white sky.'),
      creature('sand_beetles', 'sand beetles', 'crawler', 0.2, 5, 'roam', 'wild', '#2a2420', '#4a3a2a', '#000000', 'They leave stitched tracks down the dune face.'),
    ],
    folk: folk('desert nomads', 1.72, 0.4, ['hood', 'cloak'], SKIN, ['#2f4a6a', '#d8d0bc', '#5a3a2a'], ['#2a2420', '#c8a84a']),
    structures: [
      { id: 'caravan_tent', role: 'house', label: 'Caravan Camp', form: 'low black goat-hair tent', size: 'medium', family: 'tent', dials: { form: 'ridge', poles: 3, sag: 0.7, flaps: 2 } },
    ],
    props: [
      prop('wind_rock', 'rock', { form: 'boulder', count: 3, height: 0.7, jagged: 0.5, flat: 0.6 }, 4, 3),
      prop('dry_scrub', 'tree', { trunk: 0.3, crown: 'bush', crownSize: 0.6, lean: 0.4 }, 1.2, 4),
      prop('dead_acacia', 'tree', { trunk: 1.2, crown: 'dead', crownSize: 0.8, lean: 0.6 }, 4, 1),
    ],
    people: 2,
  },
  {
    name: 'city', re: /\b(city|cities|metropolis|manhattan|downtown|skyscraper\w*|megacity|rooftop\w*|skyline)\b/,
    terrain: { relief: 'flat', ruggedness: 0.05, water: 'none', waterAmount: 0, horizon: 'towers and lit windows to the horizon', settled: 0.95 },
    site: { pattern: 'grid', wild: 0.05, paths: 'road', spacing: 4 },
    skyFeatures: [],
    creatures: [
      creature('pigeons', 'pigeons', 'bird', 0.35, 10, 'flock', 'plaza', '#7a7f86', '#4a4e54', '#000000', 'They own the square and know it.'),
      creature('alley_cat', 'alley cat', 'quadruped', 0.5, 2, 'roam', 'wild', '#3a3632', '#8a7a6a', '#d8c04a', 'It watches from under a parked shadow.'),
    ],
    folk: folk('city people', 1.72, 0.45, [], SKIN, ['#3a3f48', '#6a5a4a', '#8a8f96'], ['#22262b', '#b8402c']),
    structures: null,
    props: null,
    people: null,
  },
];

/** What each fixture theme is when the prompt names no land: a settlement on gentle ground with birds overhead. */
const THEME_LAND: Record<ThemeId, { horizon: string; folk: FolkSpec; creature: CreatureSpec }> = {
  western: {
    horizon: 'dry hills and mesas', folk: folk('frontier settlers', 1.72, 0.45, ['hat'], SKIN, ['#6a5a44', '#4a4a52', '#8a3a2a'], ['#2a2420', '#8a7a5c']),
    creature: creature('vultures', 'turkey vultures', 'bird', 0.8, 3, 'circle', 'sky', '#2a2622', '#6a3a32', '#000000', 'Patient, and in no hurry at all.'),
  },
  medieval: {
    horizon: 'wooded hills', folk: folk('villagers', 1.68, 0.45, ['hood'], SKIN, ['#5b5a4f', '#6f5a44', '#4a5a3a'], ['#2b2622', '#8a7a5c']),
    creature: creature('crows', 'crows', 'bird', 0.45, 6, 'flock', 'sky', '#1c1c1e', '#2a2a30', '#000000', 'They lift off the thatch all at once.'),
  },
  scifi: {
    horizon: 'bare ridges under a dark sky', folk: folk('station crew', 1.75, 0.45, ['visor'], SKIN, ['#aeb8c4', '#5d6b7a'], ['#22262b', '#ff8a2a']),
    creature: creature('service_drones', 'service drones', 'floater', 0.6, 3, 'patrol', 'plaza', '#b9c0c8', '#3a4553', '#58e0ff', 'They drift from task to task without a sound.'),
  },
  modern: {
    horizon: 'rooftops and wires', folk: folk('townspeople', 1.72, 0.45, [], SKIN, ['#3a3f48', '#6a5a4a', '#8a8f96'], ['#22262b', '#b8402c']),
    creature: creature('pigeons', 'pigeons', 'bird', 0.35, 8, 'flock', 'plaza', '#7a7f86', '#4a4e54', '#000000', 'They own the square and know it.'),
  },
};

/** Words that mean people built here in numbers, whatever the land around is. */
const SETTLED = /\b(city|cities|town|village|port|harbou?r|metropolis|capital|market|district)\b/;

const SKY_WORDS: [RegExp, SkyFeature][] = [
  [/\b(two|twin|double|binary) suns?\b/, { kind: 'second_sun', size: 0.15, color: '#ffd9a0' }],
  [/\beclipse\b/, { kind: 'eclipse', size: 0.3, color: '#ffe2b0' }],
  [/\bblood moon\b/, { kind: 'moon', size: 0.4, color: '#b8402c' }],
  [/\b(full moon|huge moon|giant moon|moonlit|moonlight)\b/, { kind: 'moon', size: 0.3, color: '#e6e2d6' }],
  [/\b(two|twin|three) moons\b/, { kind: 'moon', size: 0.18, color: '#cfc8b8' }],
  [/\b(aurora|northern lights)\b/, { kind: 'aurora', size: 0.7, color: '#6fe0a8' }],
  [/\b(ringed|gas giant|saturn)\b/, { kind: 'ringed_planet', size: 0.5, color: '#d8c8a0' }],
  [/\b(floating (rocks?|islands?)|sky islands?)\b/, { kind: 'floating_islands', size: 0.5, color: '#8a8478' }],
  [/\b(nebula|galaxy)\b/, { kind: 'nebula', size: 0.7, color: '#8a6ad0' }],
  [/\bcomet\b/, { kind: 'comet', size: 0.2, color: '#d8f0ff' }],
  [/\b(orbital ring|space elevator)\b/, { kind: 'orbital_ring', size: 0.8, color: '#c8ccd0' }],
];

/** The land, sky, creatures and folk a prompt's words call for. */
export function mockLand(prompt: string, theme: ThemeId): Land {
  const p = prompt.toLowerCase();
  const base = THEME_LAND[theme];
  const hit = BIOMES.find((b) => b.re.test(p));
  // What the prompt names in the sky comes first; the biome's own sky fills what is left of the three.
  const skyFeatures: SkyFeature[] = [];
  for (const [re, f] of SKY_WORDS) if (re.test(p) && skyFeatures.length < 3) skyFeatures.push(f);
  for (const f of hit?.skyFeatures ?? []) if (skyFeatures.length < 3 && !skyFeatures.some((x) => x.kind === f.kind)) skyFeatures.push(f);
  if (!hit) {
    return {
      biome: null,
      terrain: { relief: 'flat', ruggedness: 0.15, water: 'none', waterAmount: 0, horizon: base.horizon, settled: 0.8 },
      site: { pattern: 'street', wild: 0.3, paths: 'road', spacing: 7 },
      skyFeatures, creatures: [base.creature], folk: base.folk, structures: null, props: null, people: null,
    };
  }
  // A town in the desert is still a town: keep the fixture's buildings and cast on the biome's ground.
  const town = hit.structures !== null && SETTLED.test(p);
  const places = new Set((town ? [] : (hit.structures ?? [])).map((s) => s.id));
  return {
    biome: hit.name,
    terrain: town ? { ...hit.terrain, settled: Math.max(hit.terrain.settled, 0.7) } : hit.terrain,
    site: town ? { pattern: hit.site.pattern === 'shoreline' ? 'shoreline' : 'street', wild: Math.min(hit.site.wild, 0.4), paths: 'road', spacing: 7 } : hit.site,
    skyFeatures,
    creatures: hit.creatures.map((c) => (['sky', 'water', 'wild', 'plaza'].includes(c.haunt) || places.has(c.haunt) ? c : { ...c, haunt: 'wild' })),
    folk: hit.folk,
    structures: town ? null : hit.structures,
    props: hit.props,
    people: town ? null : hit.people,
  };
}

/** Skeleton blueprints for a keyword land's structures. */
export function landBlueprints(structures: readonly LandStructure[]): Blueprint[] {
  return structures.map((s) => ({ id: `${s.id}_form`, summary: s.form, family: s.family, dials: s.dials, parts: [], doorX: 0 }));
}
