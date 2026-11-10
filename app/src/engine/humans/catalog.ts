// Which body a person gets. Pure data and decisions, no rendering: the human/not-human call for a folk spec, the
// model catalogue (file, sex, which trades and themes it suits, which materials are skin, hair and clothing), and
// the seeded choice of body and colours.
import type { FolkSpec, ThemeId } from '../../world/spec';
import { makeRng } from '../../world/rng';
import type { Rng } from '../../world/rng';

export const HUMAN_PACK_URL = '/third_party/quaternius-animated-humans/';
export const HUMAN_HEIGHT_MIN_M = 1.4;
export const HUMAN_HEIGHT_MAX_M = 2.1;
export const DEFAULT_HUMAN_HEIGHT_M = 1.75;

const NON_HUMAN_FEATURES: ReadonlySet<string> = new Set(['tail', 'horns', 'snout', 'wings', 'visor', 'antenna']);
const NON_HUMAN_NAME = /\b(androids?|robots?|droids?|golems?|sprites?|kobolds?|goblins?|orcs?|trolls?|aliens?|lizards?|ghosts?|skeletons?|ogres?|imps?|insectoids?|cyborgs?)\b/i;

/** True when the folk read as ordinary adult people, so a human body fits. No spec means people. */
export function isHumanFolk(folk?: FolkSpec): boolean {
  if (folk === undefined) return true;
  if (!(folk.height >= HUMAN_HEIGHT_MIN_M && folk.height <= HUMAN_HEIGHT_MAX_M)) return false;
  if (folk.features.some((f) => NON_HUMAN_FEATURES.has(f))) return false;
  if (NON_HUMAN_NAME.test(folk.name)) return false;
  return true;
}

export type Trade = 'arms' | 'robe' | 'work' | 'gentry' | 'travel' | 'crew' | 'common';

const TRADES: readonly { kind: Exclude<Trade, 'common'>; words: RegExp }[] = [
  { kind: 'arms', words: /guard|soldier|knight|sheriff|marshal|deputy|warrior|captain|watch|sentinel|sentry|trooper|paladin|warden|enforcer|officer|police/ },
  { kind: 'robe', words: /priest|monk|mage|wizard|witch|sage|elder|oracle|druid|shaman|scholar|nun|seer|abbot|cleric|librarian|mystic|keeper|preacher/ },
  { kind: 'work', words: /smith|cook|baker|bartender|barkeep|butcher|mechanic|engineer|farmer|miner|worker|tanner|brewer|carpenter|technician|innkeeper|fisher|mason|potter|weaver|stable|labou?rer|tinker|dock/ },
  { kind: 'gentry', words: /merchant|banker|mayor|noble|doctor|lord|lady|judge|clerk|trader|official|gambler|undertaker|lawyer|governor|chief|owner|teacher|manager|director/ },
  { kind: 'travel', words: /drifter|courier|travel|pilgrim|scout|hunter|peddler|porter|ranger|nomad|wanderer|prospector|explorer|trapper|smuggler|messenger/ },
  { kind: 'crew', words: /pilot|astronaut|scientist|diver|cosmonaut|researcher|medic|operator|android|robot|drone|unit/ },
];
const FEMALE_WORDS = /\b(woman|women|lady|girl|mother|mrs|miss|madam|queen|waitress|actress|nun|witch|priestess|sister|daughter|wife|maid|hostess|duchess|countess|cowgirl)\b/;
const MALE_WORDS = /\b(man|men|lord|boy|father|mr|sir|king|waiter|actor|monk|priest|brother|son|husband|duke|count|cowboy|gentleman)\b/;

export function tradeOf(role: string): Trade {
  const r = role.toLowerCase();
  for (const t of TRADES) if (t.words.test(r)) return t.kind;
  return 'common';
}

/** 'f' or 'm' when the role names a sex, otherwise null. */
export function roleSex(role: string): 'm' | 'f' | null {
  const r = role.toLowerCase();
  if (FEMALE_WORDS.test(r)) return 'f';
  if (MALE_WORDS.test(r)) return 'm';
  return null;
}

/** Which clothing materials a model lets the world recolour. Names are the material names inside the GLB. */
export interface TintSlots {
  top?: readonly string[];
  bottom?: readonly string[];
  accent?: readonly string[];
  hat?: readonly string[];
}

export interface HumanModel {
  file: string;
  sex: 'm' | 'f' | 'n';
  /** Rig family: 'A' is the 24-clip CharacterArmature set, 'B' the 11-clip HumanArmature set. */
  rig: 'A' | 'B';
  trades: readonly Trade[];
  themes: readonly ThemeId[];
  skin: readonly string[];
  hair: readonly string[];
  slots: TintSlots;
}

const ALL: readonly ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

export const HUMAN_MODELS: readonly HumanModel[] = [
  { file: 'casual.glb', sex: 'm', rig: 'A', trades: ['common', 'travel'], themes: ['modern', 'scifi', 'western'], skin: ['Skin', 'Skin_Darker'], hair: ['Hair', 'Eyebrows'], slots: { top: ['LightBrown'], bottom: ['LightBlue'], accent: ['Red_Dark'] } },
  { file: 'worker.glb', sex: 'm', rig: 'A', trades: ['work'], themes: ALL, skin: ['Skin'], hair: ['Eyebrows', 'Moustache'], slots: { top: ['LightBrown', 'Worker_Vest'], bottom: ['Brown2', 'Brown'], hat: ['Worker_Yellow'] } },
  { file: 'businessman.glb', sex: 'm', rig: 'A', trades: ['gentry'], themes: ['western', 'modern', 'scifi'], skin: ['Skin'], hair: ['Hair', 'Eyebrows'], slots: { top: ['Suit'], accent: ['Tie'] } },
  { file: 'farmer.glb', sex: 'm', rig: 'A', trades: ['work', 'common'], themes: ['western', 'medieval'], skin: ['Skin'], hair: ['Eyebrows'], slots: { top: ['Beige'], bottom: ['LightBlue'], accent: ['Red'] } },
  { file: 'hoodie.glb', sex: 'm', rig: 'A', trades: ['common'], themes: ['modern', 'scifi'], skin: ['Skin'], hair: ['Hair', 'Eyebrows'], slots: { top: ['Purple'], bottom: ['LightBlue'] } },
  { file: 'beach.glb', sex: 'm', rig: 'A', trades: ['common'], themes: ['modern'], skin: ['Skin'], hair: ['Hair', 'Eyebrows'], slots: { top: ['LightBrown'], bottom: ['Red_Dark'] } },
  { file: 'punk.glb', sex: 'm', rig: 'A', trades: ['common'], themes: ['modern', 'scifi'], skin: ['Skin'], hair: ['Red', 'Red_Dark', 'Eyebrows'], slots: { top: ['White'], bottom: ['LightBlue'] } },
  { file: 'adventurer.glb', sex: 'm', rig: 'A', trades: ['travel', 'common', 'arms'], themes: ['western', 'medieval'], skin: ['Skin'], hair: ['Hair', 'Eyebrows'], slots: { top: ['Green', 'LightGreen'], bottom: ['Brown2', 'Brown'] } },
  { file: 'adventuress.glb', sex: 'f', rig: 'A', trades: ['travel', 'common'], themes: ['medieval', 'western'], skin: ['Skin'], hair: ['Hair_Brown', 'Brown'], slots: { top: ['Green', 'LightGreen'], accent: ['Brown2', 'Brown_02'] } },
  { file: 'hooded.glb', sex: 'f', rig: 'A', trades: ['robe', 'travel'], themes: ['medieval', 'western'], skin: ['Skin'], hair: ['Brown'], slots: { top: ['Black'], accent: ['LightBrown', 'DarkBrown'] } },
  { file: 'formal-woman.glb', sex: 'f', rig: 'A', trades: ['gentry', 'common'], themes: ['western', 'medieval', 'modern'], skin: ['Skin'], hair: ['Red', 'Brown'], slots: { top: ['LimeGreen'] } },
  { file: 'astronaut.glb', sex: 'n', rig: 'A', trades: ['crew'], themes: ['scifi'], skin: [], hair: [], slots: { top: ['SciFi_Main'], accent: ['SciFi_Light_Accent'] } },
  { file: 'swat.glb', sex: 'n', rig: 'A', trades: ['arms'], themes: ['modern', 'scifi'], skin: ['Skin'], hair: [], slots: { top: ['Swat'] } },
  { file: 'woman-jacket.glb', sex: 'f', rig: 'B', trades: ['common', 'gentry'], themes: ['modern', 'scifi', 'western'], skin: ['Skin'], hair: ['Hair', 'HairBase', 'Eyebrows'], slots: { top: ['Shirt', 'LightJacket', 'Jacket'], bottom: ['Pants'] } },
  { file: 'woman-tank.glb', sex: 'f', rig: 'B', trades: ['common', 'work'], themes: ['modern', 'western', 'scifi'], skin: ['Skin'], hair: ['Hair', 'HairBase'], slots: { top: ['Shirt'], bottom: ['Pants'] } },
  { file: 'woman-casual.glb', sex: 'f', rig: 'B', trades: ['common'], themes: ALL, skin: ['Skin'], hair: ['Hair', 'HairBase'], slots: { top: ['Shirt'], bottom: ['Pants'], accent: ['Socks'] } },
  { file: 'man-casual.glb', sex: 'm', rig: 'B', trades: ['common', 'work'], themes: ALL, skin: ['Skin'], hair: ['Hair'], slots: { top: ['Shirt'], bottom: ['Pants'], accent: ['Socks'] } },
  { file: 'man-suit.glb', sex: 'm', rig: 'B', trades: ['gentry'], themes: ['modern', 'western', 'scifi'], skin: ['Skin'], hair: [], slots: { top: ['Shirt'], bottom: ['Pants'] } },
];

/** Relative weight of a model for a role in a theme. Zero means never. */
export function modelWeight(m: HumanModel, trade: Trade, theme: ThemeId, sex: 'm' | 'f' | null): number {
  if (m.sex === 'n' && !m.trades.includes(trade)) return 0; // suits and armour only for the trades they belong to
  if (sex !== null && m.sex !== 'n' && m.sex !== sex) return 0;
  let w = 1;
  if (m.trades.includes(trade)) w += 3;
  if (m.themes.includes(theme)) w += 1.5;
  else w *= 0.35;
  if (trade === 'robe' && !m.trades.includes('robe')) w *= 0.5;
  return w;
}

/** Seeded choice of body for a person. */
export function pickHumanModel(role: string, theme: ThemeId, seed: number, available: readonly HumanModel[] = HUMAN_MODELS): HumanModel | null {
  const trade = tradeOf(role);
  const sex = roleSex(role);
  const rng = makeRng(seed, `human-body|${role}`);
  let total = 0;
  const weights = available.map((m) => {
    const w = modelWeight(m, trade, theme, sex);
    total += w;
    return w;
  });
  if (total <= 0) return available[0] ?? null;
  let r = rng.next() * total;
  for (let i = 0; i < available.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) return available[i] ?? null;
  }
  return available[available.length - 1] ?? null;
}

/** Natural skin tones, light to deep, as sRGB hex. */
export const NATURAL_SKIN: readonly string[] = ['#e8c4a0', '#d9ab84', '#c58f65', '#a87049', '#8a5a39', '#6b4429', '#4e321f'];
export const NATURAL_HAIR: readonly string[] = ['#17120e', '#2b1d14', '#4a3222', '#6b4a2b', '#8a6a3c', '#b09460', '#7d7b78', '#5a2e1c'];

/** Muted clothing colours per theme, used when the folk give none. */
export const THEME_CLOTH: Record<ThemeId, readonly string[]> = {
  western: ['#6f5a44', '#8a7a62', '#4f5560', '#7a4a38', '#9a8f7a', '#3f4638'],
  medieval: ['#5e5345', '#6e4a3a', '#48553f', '#7d7462', '#3f4a5a', '#8a6f4a'],
  scifi: ['#5a6068', '#3f4850', '#7a7f84', '#4a5a5e', '#8a8478', '#55504a'],
  modern: ['#3a4250', '#5a5a5c', '#6e665a', '#44504a', '#7a6a5e', '#2f3238'],
};
export const LEATHER: readonly string[] = ['#3a2a1e', '#4a3828', '#2a2622', '#5a4630', '#33302c'];

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return null;
  let h = m[1] ?? '';
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** sRGB hex -> [h 0..1, s 0..1, l 0..1]. */
export function hexToHsl(hex: string): [number, number, number] | null {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) return toHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}

/** Pulls a colour toward something worn rather than something painted: saturation and lightness stay in a calm band. */
export function mutedCloth(hex: string): string {
  const hsl = hexToHsl(hex);
  if (hsl === null) return '#5a5a5c';
  return hslToHex(hsl[0], Math.min(hsl[1], 0.42), Math.min(0.58, Math.max(0.16, hsl[2])));
}

/** True when a colour could plausibly be a skin tone (warm hue, moderate saturation, mid lightness). */
export function plausibleSkin(hex: string): boolean {
  const hsl = hexToHsl(hex);
  if (hsl === null) return false;
  const deg = hsl[0] * 360;
  return deg >= 8 && deg <= 50 && hsl[1] >= 0.12 && hsl[1] <= 0.75 && hsl[2] >= 0.14 && hsl[2] <= 0.85;
}

export interface HumanColors {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  accent: string;
  hat: string;
}

/** Colours for one person: skin from the folk when it reads as skin, clothing drawn from folk.cloth or the theme. */
export function pickHumanColors(opts: { role: string; theme: ThemeId; folk?: FolkSpec; seed: number; variant?: number }): HumanColors {
  const rng: Rng = makeRng(opts.seed, `human-colors|${opts.role}|${opts.variant ?? 0}`);
  const folkSkin = (opts.folk?.skin ?? []).filter(plausibleSkin);
  const skin = folkSkin.length > 0 ? rng.pick(folkSkin) : rng.pick(NATURAL_SKIN);
  const cloth = (opts.folk?.cloth ?? []).filter((c) => parseHex(c) !== null);
  const pool = cloth.length > 0 ? cloth : THEME_CLOTH[opts.theme];
  const trim = (opts.folk?.trim ?? []).filter((c) => parseHex(c) !== null);
  const top = mutedCloth(rng.pick(pool));
  // Trousers and skirts sit darker and quieter than the top.
  const bottomBase = hexToHsl(mutedCloth(rng.pick(pool)));
  const bottom = bottomBase === null ? '#3a4250' : hslToHex(bottomBase[0], bottomBase[1] * 0.7, Math.min(0.32, bottomBase[2] * 0.8));
  const accent = mutedCloth(trim.length > 0 ? rng.pick(trim) : rng.pick(LEATHER));
  const hat = mutedCloth(rng.pick(pool));
  return { skin, hair: rng.pick(NATURAL_HAIR), top, bottom, accent, hat };
}

/** Standing height for a person: the folk's height with a small seeded spread, or the human default. */
export function humanHeight(folk: FolkSpec | undefined, seed: number): number {
  const base = folk !== undefined && Number.isFinite(folk.height) ? folk.height : DEFAULT_HUMAN_HEIGHT_M;
  const spread = makeRng(seed, 'human-height').range(-0.03, 0.03);
  return Math.min(HUMAN_HEIGHT_MAX_M, Math.max(HUMAN_HEIGHT_MIN_M, base * (1 + spread)));
}
