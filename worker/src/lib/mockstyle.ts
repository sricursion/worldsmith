// Mock mode: keyword-driven look for a town, so different prompts look different offline.
import type { Blueprint, BuildingRole, ThemeId, WorldSpec, StyleSpec, SkyPreset } from '../../../app/src/world/spec';
import { HOUSE_BLUEPRINT, LANTERN_PROP, MOCK_BLUEPRINTS, PAGODA_BLUEPRINT, SALOON_BLUEPRINT } from './mockblueprints';

type Look = Partial<StyleSpec> & { sky?: SkyPreset; fog?: number };

const BASE: Record<ThemeId, StyleSpec> = {
  western: { name: 'weathered frontier timber', wall: '#b98b5a', wall2: '#d9c7a1', roof: '#6d4a35', trim: '#f0e6d0', accent: '#b5412e', dark: '#2a211c', glass: '#3b4a52', glow: '#ffbf5e', ground: '#c9a56b', road: '#a98a5a', variety: 0.25 },
  medieval: { name: 'timber and plaster village', wall: '#e3d3b0', wall2: '#8a6a4a', roof: '#7a3b2e', trim: '#4a3526', accent: '#2f5d8a', dark: '#241d19', glass: '#3a4a58', glow: '#ffb347', ground: '#6f9a52', road: '#a89878', variety: 0.3 },
  scifi: { name: 'brushed alloy station', wall: '#aeb8c4', wall2: '#5d6b7a', roof: '#3a4553', trim: '#d8e0ea', accent: '#ff8a2a', dark: '#14181e', glass: '#1d3a4a', glow: '#4de3ff', ground: '#4a5460', road: '#2f353d', variety: 0.15 },
  modern: { name: 'plain painted streets', wall: '#d9d4c8', wall2: '#9fb0be', roof: '#59616b', trim: '#f4f1ea', accent: '#d2493b', dark: '#22262b', glass: '#4a6275', glow: '#ffe7a3', ground: '#7fa06a', road: '#4b4f55', variety: 0.2 },
};

/** First match wins for the main look; later matches only add small overrides. Order is by how specific the word is. */
const LOOKS: [RegExp, Look][] = [
  [/\b(neon|cyber\w*|arcology|synth\w*|tokyo|noir)\b/, { name: 'neon-lit concrete', wall: '#2c2f45', wall2: '#4a3d6b', roof: '#1a1b2b', trim: '#8a7bd6', accent: '#ff3cac', dark: '#0b0b14', glass: '#123049', glow: '#2de2e6', ground: '#1b1c2a', road: '#101018', variety: 0.1, sky: 'night', fog: 0.35 }],
  [/\b(under\s?water|ocean\w*|sea\w*|reef|coral|atlantis|pirate\w*|cove|harbou?r|island|lagoon)\b/, { name: 'salt-bleached driftwood and coral', wall: '#9db7b0', wall2: '#d7c8a4', roof: '#2f6f7d', trim: '#e9e0c8', accent: '#ff7a59', dark: '#1d2b33', glass: '#2a5a6a', glow: '#7ff0d0', ground: '#d8c79a', road: '#b8a67a', variety: 0.3, sky: 'day', fog: 0.35 }],
  [/\b(volcan\w*|lava|magma|ember\w*|ash|inferno|forge)\b/, { name: 'basalt and ember', wall: '#4a4244', wall2: '#6b5047', roof: '#2a2426', trim: '#8c7a6e', accent: '#ff5a1f', dark: '#120e0e', glass: '#3a2a2a', glow: '#ff7a2a', ground: '#2f2b2c', road: '#201c1d', variety: 0.2, sky: 'dusk', fog: 0.5 }],
  [/\b(snow\w*|ice|icy|arctic|winter|frozen|tundra|glacier|frost\w*)\b/, { name: 'frosted pine and slate', wall: '#cdd6dc', wall2: '#8c6f55', roof: '#5b6f86', trim: '#f4f7fa', accent: '#c0392b', dark: '#1f2a33', glass: '#3f6279', glow: '#ffd27a', ground: '#e8eef2', road: '#c3ccd3', variety: 0.2, sky: 'overcast', fog: 0.45 }],
  [/\b(jungle|rain\s?forest|tropic\w*|swamp|bayou|mangrove|overgrown|mayan?|aztec)\b/, { name: 'mossy thatch and vine', wall: '#8aa36a', wall2: '#b79a6a', roof: '#5a7a3a', trim: '#e0d4a8', accent: '#e0572f', dark: '#1d2a1a', glass: '#2d4a3d', glow: '#c8ff7a', ground: '#4f7a3c', road: '#8a7a52', variety: 0.35, sky: 'day', fog: 0.4 }],
  [/\b(desert|dune\w*|oasis|sahara|bedouin|canyon|mesa|arid|egypt\w*)\b/, { name: 'sun-baked adobe', wall: '#d9b88a', wall2: '#efdcb6', roof: '#b0623f', trim: '#f7efe0', accent: '#2a8f9a', dark: '#3a2a20', glass: '#3a4f5a', glow: '#ffc25e', ground: '#e0c28c', road: '#cfae76', variety: 0.2, sky: 'day', fog: 0.2 }],
  [/\b(gothic|vampir\w*|haunted|graveyard|crypt|cursed|witch\w*|spooky|horror)\b/, { name: 'soot-black stone and iron', wall: '#4b4a55', wall2: '#2e2d38', roof: '#1f1e27', trim: '#7e7a8c', accent: '#9b2335', dark: '#0d0c12', glass: '#2a3a4a', glow: '#b8ff6a', ground: '#34363a', road: '#26272b', variety: 0.2, sky: 'night', fog: 0.55 }],
  [/\b(pastel|candy|sweet\w*|cute|fairy\s?tale|toy|bakery|dream\w*)\b/, { name: 'sugar-washed pastel', wall: '#f6d5de', wall2: '#cfe8e0', roof: '#a9c4ea', trim: '#fff8ef', accent: '#f08aa8', dark: '#5a4a5e', glass: '#8aa9c8', glow: '#fff0a0', ground: '#bfe3b4', road: '#efe2cf', variety: 0.35, sky: 'dawn', fog: 0.15 }],
  [/\b(edo|samurai|japan\w*|shogun|ninja|pagoda|feudal|china|chinese|dynasty)\b/, { name: 'lacquered timber and tile', wall: '#e7dcc2', wall2: '#6b4a38', roof: '#3b4a52', trim: '#2a1f1a', accent: '#c0392b', dark: '#1d1815', glass: '#3a3f4a', glow: '#ffb15e', ground: '#a8a07a', road: '#8f8869', variety: 0.2, sky: 'dusk', fog: 0.3 }],
  [/\b(space|station|orbital|asteroid|mars|moon|alien|colony|starship)\b/, { name: 'brushed alloy and amber', wall: '#b9c0c8', wall2: '#6a7480', roof: '#39424e', trim: '#e6ebf0', accent: '#ff9330', dark: '#11151a', glass: '#1a3548', glow: '#58e0ff', ground: '#585f68', road: '#343a42', variety: 0.12, sky: 'night', fog: 0.2 }],
];

/** Overrides that stack on a main look: time of day and mood words. */
const MODS: [RegExp, Look][] = [
  [/\b(night|midnight|moonlit)\b/, { sky: 'night' }],
  [/\b(dusk|sunset|twilight)\b/, { sky: 'dusk' }],
  [/\b(dawn|sunrise|morning)\b/, { sky: 'dawn' }],
  [/\b(fog\w*|mist\w*|storm\w*|rain\w*)\b/, { sky: 'overcast', fog: 0.6 }],
];

const HEX = /^#[0-9a-f]{6}$/i;

function pickLook(prompt: string): Look | null {
  const p = prompt.toLowerCase();
  for (const [re, look] of LOOKS) if (re.test(p)) return look;
  return null;
}

function pickMods(prompt: string): Look {
  const p = prompt.toLowerCase();
  let out: Look = {};
  for (const [re, look] of MODS) if (re.test(p)) out = { ...out, ...look };
  return out;
}

/** The style a prompt asks for, laid over the base style (the spec's own style when it has one). */
export function remixStyle(prompt: string, base: StyleSpec): { style: StyleSpec; sky: SkyPreset | null; fog: number | null } {
  const main = pickLook(prompt);
  const mods = pickMods(prompt);
  const merged: Look = { ...(main ?? {}), ...mods };
  const style: StyleSpec = { ...base };
  for (const key of ['name', 'wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow', 'ground', 'road'] as const) {
    const v = merged[key];
    if (typeof v === 'string' && (key === 'name' || HEX.test(v))) style[key] = v;
  }
  if (typeof merged.variety === 'number') style.variety = merged.variety;
  return { style, sky: merged.sky ?? null, fog: merged.fog ?? null };
}

const GRAND: ReadonlySet<BuildingRole> = new Set<BuildingRole>(['church', 'townhall', 'command', 'station', 'school', 'lab', 'reactor', 'hangar']);
const SOCIAL: ReadonlySet<BuildingRole> = new Set<BuildingRole>(['saloon', 'tavern', 'inn', 'hotel', 'bank', 'cafe', 'cantina', 'market', 'office', 'general_store', 'shop']);

function blueprintFor(role: BuildingRole, blueprints: readonly Blueprint[]): string {
  const find = (id: string): string => blueprints.find((b) => b.id === id)?.id ?? blueprints[0]?.id ?? id;
  if (GRAND.has(role)) return find(PAGODA_BLUEPRINT.id);
  if (SOCIAL.has(role)) return find(SALOON_BLUEPRINT.id);
  return find(HOUSE_BLUEPRINT.id);
}

/**
 * The spec mock mode streams. A fixture that already has blueprints is kept as is, with the keyword style laid
 * over its own. A fixture without them gets the hand-written blueprints, a prop and a landmark, so the new
 * path is visible offline.
 */
export function mockSpec(fixture: WorldSpec, prompt: string, seed: number): WorldSpec {
  const hasBlueprints = (fixture.blueprints?.length ?? 0) > 0;
  const base = fixture.style ?? BASE[fixture.theme];
  const { style, sky, fog } = remixStyle(prompt, base);
  const spec: WorldSpec = {
    ...fixture,
    prompt,
    seed,
    style,
    palette: { ...fixture.palette, ground: style.ground, accent: style.accent, sky: sky ?? fixture.palette.sky, fog: fog ?? fixture.palette.fog },
  };
  if (hasBlueprints) return spec;
  const blueprints = [...MOCK_BLUEPRINTS];
  return {
    ...spec,
    blueprints,
    buildings: fixture.buildings.map((b) => ({ ...b, blueprint: blueprintFor(b.role, blueprints) })),
    props: fixture.props && fixture.props.length > 0 ? fixture.props : [LANTERN_PROP],
    landmarks: fixture.landmarks ?? [{ id: 'landmark_tower', prompt: 'a tall weathered wooden watchtower on four legs with a small roofed platform, low-poly stylised', place: 'plaza', height: 9 }],
  };
}
