// The world spec is the single contract between the language model, the town generator,
// the engine, the NPC brain and the UI. The model emits this; the engine runs it.
// Keep it JSON-serialisable, flat where possible, and free of engine objects.

export const SPEC_VERSION = 1 as const;

export type ThemeId = 'western' | 'medieval' | 'scifi' | 'modern';
export type SkyPreset = 'dawn' | 'day' | 'dusk' | 'night' | 'overcast';

/** Building roles the generator knows how to place. Theme kits map each role to a mesh. */
export type BuildingRole =
  | 'saloon' | 'tavern' | 'inn' | 'bank' | 'jail' | 'sheriff' | 'church' | 'stable'
  | 'general_store' | 'market' | 'blacksmith' | 'house' | 'hotel' | 'townhall'
  | 'doctor' | 'school' | 'barber' | 'undertaker' | 'warehouse' | 'workshop'
  | 'lab' | 'hangar' | 'cantina' | 'command' | 'habitat' | 'reactor'
  | 'cafe' | 'office' | 'shop' | 'garage' | 'apartment' | 'station' | 'plaza';

export type BuildingSize = 'small' | 'medium' | 'large';

export interface BuildingSpec {
  id: string;                 // slug, unique in the town, e.g. "saloon_1"
  role: BuildingRole;
  label: string;              // sign text, e.g. "The Dusty Spur"
  size: BuildingSize;
  /** Set by the generator; the model may leave it out. Metres, town origin at (0,0). */
  position?: { x: number; z: number; rotY: number };
  footprint?: { w: number; d: number }; // metres, filled by the generator from the kit
  keyBuilding?: boolean;       // placed on the main street near the centre
  /** Blueprint id from WorldSpec.blueprints. When set and found, the engine builds this instead of a kit mesh. */
  blueprint?: string;
}

/** What an NPC does at a given hour. The brain interpolates between entries. */
export interface ScheduleEntry {
  hour: number;               // 0..23, local town time
  place: string;              // building id, or 'street' | 'plaza'
  activity: 'work' | 'rest' | 'drink' | 'pray' | 'patrol' | 'wander' | 'trade' | 'sleep' | 'eat' | 'guard';
}

export type CharacterBase = 'knight' | 'barbarian' | 'mage' | 'rogue' | 'ranger' | 'rogue_hooded';

export type Mood = 'calm' | 'tense' | 'cheerful' | 'grieving' | 'drunk' | 'angry' | 'afraid';
export type Stance = 'friend' | 'rival' | 'family' | 'debtor' | 'suspicious' | 'neutral';

export interface NpcSpec {
  id: string;                 // slug, e.g. "sheriff_cole"
  name: string;
  role: string;               // free text used in prompts: "sheriff", "bartender", "drifter"
  persona: string;            // 2 to 4 sentences, voice and motive, for the dialogue model
  /** What this NPC knows and will reveal; plain facts the dialogue model may use. */
  knowledge: string[];
  /** Facts they hide unless the player earns them (quest steps may unlock these). */
  secrets: string[];
  home: string;               // building id
  work: string;               // building id, or 'street'
  schedule: ScheduleEntry[];  // at least 3 entries, sorted by hour
  relationships: { npcId: string; stance: Stance }[];
  appearance: { base: CharacterBase; palette: number }; // palette index into the theme recolour set
  /** Client-side sampling temperament: tau < 1 sharpens the decision model's probabilities, > 1 flattens. */
  temperament: { tau: number; bias: Record<string, number> }; // bias keys are action ids, values added to logit
  voice: { pitch: number; rate: number }; // SpeechSynthesis params, 0.5..2
  mood: Mood;
}

export type ItemId = string;

export interface ItemSpec {
  id: ItemId;
  name: string;
  description: string;
  /** Where the item starts: an NPC id, a building id, or 'player'. */
  holder: string;
}

export type QuestStepKind = 'talk' | 'fetch' | 'deliver' | 'visit' | 'choose' | 'confront';

export interface QuestStep {
  id: string;
  kind: QuestStepKind;
  /** NPC id for talk/deliver/confront, item id for fetch, building id for visit. */
  target: string;
  item?: ItemId;              // deliver: what to hand over; fetch: what to pick up
  /** Step ids that must be complete first. Empty for the opening step. */
  requires: string[];
  /** Shown in the journal. */
  objective: string;
  /** What the target NPC says or does when this step completes; the dialogue model expands it. */
  beat: string;
  /** For 'choose': the options and which steps each unlocks. */
  choices?: { label: string; unlocks: string[] }[];
  /** Secrets this step reveals, as "npcId:secretIndex", so later dialogue may use them. */
  reveals?: string[];
}

export interface QuestSpec {
  id: string;
  title: string;
  hook: string;               // one paragraph shown when the town loads
  giver: string;              // NPC id who opens the quest
  steps: QuestStep[];
  /** Step ids whose completion ends the quest. */
  endings: { stepId: string; label: string; tone: 'good' | 'bitter' | 'neutral' }[];
}

/** Rules are the live-rewritable part of the world. Each has the plain text and a typed effect. */
export type RuleEffect =
  | { type: 'curfew'; fromHour: number; toHour: number; exemptRoles: string[] }
  | { type: 'ban'; what: string; where: string; enforcer?: string } // where: building id or 'town'
  | { type: 'price'; item: ItemId; multiplier: number }
  | { type: 'mood'; who: string; mood: Mood }                        // who: npc id or 'all'
  | { type: 'time_scale'; minutesPerRealSecond: number }
  | { type: 'weather'; sky: SkyPreset; fog: number }
  | { type: 'schedule_override'; who: string; entry: ScheduleEntry }
  | { type: 'relationship'; a: string; b: string; stance: Stance }
  | { type: 'custom'; summary: string }; // last resort, dialogue-only effect

export interface RuleSpec {
  id: string;
  text: string;               // the plain-language rule as the player wrote it or the model proposed it
  effect: RuleEffect;
  source: 'world' | 'player';
}

// ---- Blueprints: buildings and props authored as data by the compile model --------------------
// A blueprint is a small list of primitive parts. The engine turns it into geometry, so a town in
// any setting (a pirate cove, an Edo village, a neon arcology) gets its own architecture without a
// pre-made kit. Kits and the procedural fallback remain for specs that carry no blueprints.

export type PartShape = 'box' | 'cylinder' | 'cone' | 'pyramid' | 'gable' | 'dome' | 'sphere' | 'wedge' | 'arch' | 'ring';

/** Which style colour a part takes. 'glow' is emissive; 'glass' is dark and glossy. */
export type PartTone = 'wall' | 'wall2' | 'roof' | 'trim' | 'accent' | 'dark' | 'glass' | 'glow';

export interface BlueprintPart {
  shape: PartShape;
  /** Centre of the part on the footprint: x and z are fractions of the footprint, -0.5..0.5; +z is the street-facing front. */
  x: number;
  z: number;
  /** Height of the part's base above the ground, metres, 0..30. */
  y: number;
  /** Size: w and d are fractions of the footprint (0.02..1.4), h is metres (0.05..30). */
  w: number;
  d: number;
  h: number;
  /** Rotation about the vertical axis in degrees. Gable ridges and wedge slopes run along local x. */
  rot: number;
  tone: PartTone;
  /** Repeats the part along its local x axis: `count` copies spaced `gap` (fraction of footprint) apart, centred on x. */
  repeat: number;   // 1..12
  gap: number;      // 0 when repeat is 1
}

export interface Blueprint {
  id: string;                  // slug, unique in the town
  /**
   * Optional skeleton: a general structural family (see world/skeletons.ts) plus dial settings.
   * The skeleton supplies the bones (massing, roof, openings); `parts` then adds what makes this
   * building belong to this world. With no family, `parts` is the whole building.
   */
  family?: string;
  dials?: Record<string, number | string>;
  /** What it is, e.g. "two-storey saloon with a false front and balcony". Shown in the build log. */
  summary: string;
  parts: BlueprintPart[];      // 4..28, the first part should be the main body
  /** Where the door is on the front face, fraction of footprint width, -0.4..0.4. The engine paths NPCs here. */
  doorX: number;
}

export interface PropBlueprint {
  /** Optional skeleton family and dials, as on Blueprint; `parts` are additions. */
  family?: string;
  dials?: Record<string, number | string>;
  kind: string;                // slug, e.g. "hitching_post", "paper_lantern", "coral_spire"
  /** Longest dimension in metres, 0.3..6. Parts use a 1 x 1 footprint scaled to this. */
  size: number;
  parts: BlueprintPart[];      // 1..8
  /** Relative frequency when scattering, 1..5. */
  weight: number;
  /**
   * Set from the skeleton family: a plant takes bark and leaf colours and surfaces of its own, a mineral
   * (rock, boulder, crystal) the local stone. Absent for made things, which take the building tones.
   */
  nature?: 'plant' | 'mineral';
}

/** How the place is laid out. Not every world is a street of houses. */
export type SitePattern = 'street' | 'ring' | 'scatter' | 'grid' | 'terraces' | 'wild' | 'path' | 'shoreline' | 'cliffside';

/** How big the place is, from one keeper on a rock to a city without end. */
export type SiteScale = 'lone' | 'outpost' | 'hamlet' | 'village' | 'town' | 'city' | 'metropolis';

export interface SiteSpec {
  pattern: SitePattern;        // street: main road and cross streets; ring: around a centre; scatter: a camp or grove with paths; grid: city blocks; terraces: rows stepping back
  /** 0..1: how much of the open ground is filled with scattered props (trees, rocks, crystals). A forest is 0.9, a plaza city 0.1. */
  wild: number;
  /** Whether paths are drawn as roads, worn tracks, or not at all. */
  paths: 'road' | 'track' | 'none';
  /** Typical spacing between structures in metres, 2..14. */
  spacing: number;
  /**
   * How big the place is. The named structures are the few that matter; the scale says how much stands around
   * them (see world/scale.ts). Absent on old specs, which are built from their named structures alone.
   */
  scale?: SiteScale;
  /** 0..1: how crowded the streets are with people and clutter. An overpopulated city is 1, a sleepy one 0.3. */
  density?: number;
  /** Typical building height in metres: most stand near the first figure, the tallest reach the second. */
  heights?: [number, number];
  /** 0..1: how much of the place is broken: war, quake, long neglect. */
  damage?: number;
}

/** What a surface is made of. The engine generates the texture, normal and roughness maps for each in the browser. */
export type SurfaceKind =
  | 'timber' | 'planks' | 'log' | 'plaster' | 'adobe' | 'brick' | 'stone' | 'cobble' | 'concrete'
  | 'metal_panel' | 'corrugated' | 'rusted' | 'hull_plate' | 'glass_curtain'
  | 'shingle' | 'tile' | 'thatch' | 'slate' | 'canvas' | 'paper_screen'
  | 'organic' | 'bark' | 'chitin' | 'crystal' | 'ice' | 'coral'
  | 'dirt' | 'sand' | 'grass' | 'moss' | 'snow' | 'mud' | 'asphalt' | 'gravel' | 'regolith' | 'ash';

export interface SurfaceSet {
  wall: SurfaceKind;
  wall2: SurfaceKind;
  roof: SurfaceKind;
  trim: SurfaceKind;
  ground: SurfaceKind;
  road: SurfaceKind;
  /** 0 pristine .. 1 ruined: grime, stains, chipped edges, rust streaks, moss in the creases. */
  wear: number;
  /** 0 dry .. 1 soaked: darkens and glosses the ground and low walls; puddles appear above 0.5. */
  wet: number;
}

export type WeatherKind = 'clear' | 'rain' | 'storm' | 'snow' | 'fog' | 'dust' | 'ash' | 'spores' | 'embers' | 'fireflies' | 'mist';
export type GradeKind = 'neutral' | 'golden' | 'teal_orange' | 'cold_steel' | 'sepia' | 'neon_noir' | 'verdant' | 'bleached' | 'crimson' | 'moonlit';

// ---- The land, the sky and the living things: what makes a world more than a town --------------

/** Shape of the walkable land. The engine keeps slopes gentle enough to walk. */
export type ReliefKind = 'flat' | 'rolling' | 'dunes' | 'craggy' | 'terraced' | 'crater' | 'canyon' | 'icefield' | 'swamp' | 'islands';
export type WaterKind = 'none' | 'pond' | 'river' | 'shore' | 'lake' | 'lava' | 'acid' | 'ice_sheet' | 'mist_sea';

export interface TerrainSpec {
  relief: ReliefKind;
  /** 0..1: how tall the relief is inside the playable area (0.2 gentle, 1 dramatic). */
  ruggedness: number;
  water: WaterKind;
  /** 0..1: how much of the area the water takes. */
  waterAmount: number;
  /** What the far distance is made of, in a few words: "red mesas", "glacier wall", "jungle canopy", "megacity skyline", "ringed gas giant on the horizon". */
  horizon: string;
  /** 0..1: how much of the place is settlement versus wilderness. 0 is untouched nature with a few points of interest; 1 is dense city. */
  settled: number;
}

/** The people of this world, as a body plan. Humans are one setting among many. */
export interface FolkSpec {
  name: string;                // "frontier settlers", "kobolds", "maintenance androids", "moss sprites"
  /** Typical adult height in metres, 0.5..3. */
  height: number;
  /** 0 slight .. 1 massive. */
  bulk: number;
  /** Head size relative to a real human (1 = realistic; keep 0.9..1.3 unless the folk are stylised by nature). */
  head: number;
  features: ('tail' | 'horns' | 'long_ears' | 'snout' | 'visor' | 'antenna' | 'wings' | 'hood' | 'hat' | 'cloak' | 'armor' | 'pack' | 'mask' | 'glow_eyes')[];
  /** Hex ranges to draw from: skin or shell, cloth, trim. */
  skin: string[];
  cloth: string[];
  trim: string[];
}

/** Things in the sky. */
export interface SkyFeature {
  kind: 'moon' | 'planet' | 'ringed_planet' | 'second_sun' | 'aurora' | 'nebula' | 'comet' | 'floating_islands' | 'orbital_ring' | 'storm_wall' | 'eclipse';
  /** Apparent size 0..1 and a hex tint. */
  size: number;
  color: string;
}

/** Body plans for non-human life. Dials reshape each plan far beyond its name. */
export type CreatureFamily = 'quadruped' | 'biped' | 'winged' | 'serpent' | 'bird' | 'swimmer' | 'crawler' | 'floater' | 'colossus' | 'swarm';
export type CreatureBehaviour = 'roam' | 'graze' | 'patrol' | 'perch' | 'circle' | 'sleep' | 'guard' | 'flock' | 'stalk';

export interface CreatureSpec {
  id: string;
  name: string;                // "ash dragon", "sand strider", "arctic fox", "maintenance drone"
  family: CreatureFamily;
  dials: Record<string, number | string>;
  /** Body length or height in metres, 0.2..40. */
  size: number;
  count: number;               // 1..24
  behaviour: CreatureBehaviour;
  /** Where it keeps to: 'sky', 'water', 'wild', 'plaza', or a building id. */
  haunt: string;
  /** Hex colours: body, secondary, glow (eyes, fire, lights). */
  body: string;
  accent: string;
  glow: string;
  /** One sentence the player sees when they look at it. */
  note: string;
}

/** The mood of the place: what the light, air and sound are doing. */
export interface MoodSpec {
  weather: WeatherKind;
  /** 0..1 strength of the weather. */
  intensity: number;
  grade: GradeKind;
  /** 0..1: how much light scatters in the air (shafts, haze glow around lamps). */
  haze: number;
  /** Ambient sound beds to mix, e.g. ['wind','crickets','distant_crowd']. Free words; the audio engine maps what it knows. */
  ambience: string[];
  /** One or two words for the generative music: 'lonely harmonica', 'low drone', 'bright lute'. Empty for none. */
  music: string;
}

/** The look of one town. Every colour is a hex string. */
export interface StyleSpec {
  name: string;                // "weathered frontier timber", "lacquered Edo townhouse"
  wall: string;
  wall2: string;
  roof: string;
  trim: string;
  accent: string;
  dark: string;
  glass: string;
  glow: string;
  ground: string;
  road: string;
  /** How much per-building colour drift the engine applies, 0..1. */
  variety: number;
  /** Colour of living leaves and of bark or stems in this world. Absent: the engine derives them from the ground. */
  foliage?: string;
  bark?: string;
  /** What each tone is made of. Absent on old specs: the engine infers it from the style name and theme. */
  surfaces?: SurfaceSet;
}

export interface PaletteSpec {
  ground: string;             // hex
  accent: string;             // hex, used for signs and UI tint
  sky: SkyPreset;
  fog: number;                // 0..1 density hint
}

export interface WorldSpec {
  version: typeof SPEC_VERSION;
  seed: number;               // the generator is deterministic given seed + spec
  prompt: string;             // original player prompt, verbatim
  title: string;              // "Dry Gulch, Arizona Territory, 1874"
  tagline: string;            // one sentence shown under the title
  theme: ThemeId;
  era: string;                // free text used in prompts: "1874, Arizona Territory"
  palette: PaletteSpec;
  time: { startHour: number; minutesPerRealSecond: number };
  buildings: BuildingSpec[];  // 6 to 14
  npcs: NpcSpec[];            // 5 to 10
  items: ItemSpec[];
  quest: QuestSpec;
  rules: RuleSpec[];
  /** Short glossary the dialogue model is told to use: slang, currency, place names. */
  lexicon: string[];
  /** Optional generated architecture. Present on every model-compiled town; absent on old share links. */
  style?: StyleSpec;
  site?: SiteSpec;
  mood?: MoodSpec;
  terrain?: TerrainSpec;
  skyFeatures?: SkyFeature[];   // 0..3
  creatures?: CreatureSpec[];   // 0..6 kinds
  folk?: FolkSpec;
  blueprints?: Blueprint[];    // 3..8 archetypes shared by the buildings
  props?: PropBlueprint[];     // 0..6 kinds scattered instead of kit props
  /** One or two set pieces worth generating as full 3D models in the background. */
  landmarks?: LandmarkSpec[];
}

export interface LandmarkSpec {
  id: string;
  /** Text-to-3D prompt: one object, no scene, e.g. "a weathered wooden water tower on stilts, low-poly". */
  prompt: string;
  /** Where it stands: 'plaza' or a building id (placed beside that building's lot). */
  place: string;
  /** Target height in metres, 2..14. */
  height: number;
}

/** Runtime-only state layered over the spec. Never sent to the compile model; sent (trimmed) to the dialogue model. */
export interface WorldState {
  hour: number;               // fractional town hour
  day: number;
  completedSteps: string[];
  unlockedSteps: string[];
  inventory: ItemId[];
  itemHolders: Record<ItemId, string>;
  npcMoods: Record<string, Mood>;
  npcPlaces: Record<string, string>; // where each NPC currently is (building id or 'street')
  flags: Record<string, boolean | number | string>;
  rules: RuleSpec[];          // current rules, may differ from spec.rules after patches
  log: { t: number; who: string; what: string }[]; // last ~50 events, for "why?" answers
}

export type NpcActionId = 'continue' | 'go_to' | 'talk_to' | 'idle' | 'flee' | 'investigate' | 'follow_player' | 'work';

/** Per-tick decision for one NPC, chosen by the decision model and sampled client-side. */
export interface NpcAction {
  id: NpcActionId;
  target?: string;            // building id or npc id
  reason: string;             // one short clause for the "why?" overlay
}
