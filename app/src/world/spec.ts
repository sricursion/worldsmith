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
