// Palette recolouring for the KayKit gradient atlas. Pure maths on RGBA bytes, no DOM.
import type { ThemeId } from '../world/spec';

export interface PaletteVariant {
  /** Hue rotation in degrees applied to cloth pixels only. */
  hue: number;
  /** Multiplier on HSV value, cloth pixels only. */
  value: number;
  /** Multiplier on HSV saturation, cloth pixels only. */
  sat: number;
}

export const PALETTE_COUNT = 10;

const pv = (hue: number, value: number, sat: number): PaletteVariant => ({ hue, value, sat });

/**
 * Cloth ring per theme. Index 0 is always the identity, so palette 0 keeps the pack's own look.
 * Skin, hair, leather and greys are never touched (see classifyPixel), so rotations only move the
 * saturated cloth colours. Hue stays within 150 degrees; value and saturation vary so variants differ.
 * Theme flavour: western earthy and dusty; medieval greens, blues and burgundy; scifi cool and bright;
 * modern muted and dark.
 */
export const PALETTE_RINGS: Record<ThemeId, readonly PaletteVariant[]> = {
  western: [pv(0, 1, 1), pv(-20, 0.9, 0.9), pv(15, 0.85, 1.1), pv(-40, 0.8, 0.8), pv(30, 1.05, 1), pv(-10, 0.7, 0.9), pv(45, 0.9, 0.85), pv(-60, 0.95, 1.15), pv(8, 1.1, 0.7), pv(-30, 0.65, 1)],
  medieval: [pv(0, 1, 1), pv(70, 0.9, 1), pv(105, 0.85, 0.9), pv(145, 0.95, 0.85), pv(-25, 0.8, 1.1), pv(120, 0.9, 1.2), pv(-90, 0.85, 0.9), pv(-50, 0.75, 1), pv(90, 1.05, 0.7), pv(150, 0.8, 1.1)],
  scifi: [pv(0, 1, 1), pv(105, 1.1, 0.9), pv(135, 1.2, 1.1), pv(150, 1, 0.8), pv(25, 1.15, 1.2), pv(-110, 1.05, 0.9), pv(80, 0.95, 1), pv(40, 1.25, 0.7), pv(-145, 1.1, 1.1), pv(12, 0.9, 1.25)],
  modern: [pv(0, 1, 1), pv(145, 0.7, 0.6), pv(120, 0.55, 0.8), pv(-120, 0.65, 0.7), pv(45, 1.15, 0.9), pv(60, 1.05, 0.65), pv(-85, 0.8, 0.5), pv(-30, 0.6, 1), pv(150, 0.5, 0.7), pv(30, 0.85, 0.55)],
};

/** Palette index folded into the ring, so any integer (including negatives) maps to a variant. */
export function paletteVariant(theme: ThemeId, index: number): PaletteVariant {
  const ring = PALETTE_RINGS[theme];
  const i = ((Math.trunc(Number.isFinite(index) ? index : 0) % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
  return ring[i] ?? { hue: 0, value: 1, sat: 1 };
}

export function paletteSlot(index: number): number {
  return ((Math.trunc(Number.isFinite(index) ? index : 0) % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
}

export type PixelClass = 'skin' | 'neutral' | 'cloth';

/**
 * Classifies one RGB pixel. Warm hues (reds through yellow-browns, covering skin, hair, leather and wood)
 * at moderate saturation are 'skin' and stay fixed; low saturation (greys, metal, white) is 'neutral';
 * everything else saturated is 'cloth' and is the only class a palette recolours.
 */
export function classifyPixel(r: number, g: number, b: number): PixelClass {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  const s = max <= 0 ? 0 : delta / max;
  if (s < 0.12) return 'neutral';
  let h: number;
  if (max === rr) h = ((gg - bb) / delta + 6) % 6;
  else if (max === gg) h = (bb - rr) / delta + 2;
  else h = (rr - gg) / delta + 4;
  h *= 60;
  if ((h <= 50 || h >= 345) && s <= 0.75) return 'skin';
  return 'cloth';
}

/**
 * Recolours cloth pixels of RGBA bytes in place: hue rotation, then saturation and value multipliers.
 * Skin, hair and neutral pixels and alpha are untouched. hue 0 with both multipliers 1 is the identity.
 */
export function shiftPixels(data: Uint8ClampedArray, hueDeg: number, valueMul: number, satMul = 1): void {
  if (hueDeg % 360 === 0 && valueMul === 1 && satMul === 1) return;
  const shift = (((hueDeg % 360) + 360) % 360) / 60; // in sextants
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r8 = data[i] ?? 0;
    const g8 = data[i + 1] ?? 0;
    const b8 = data[i + 2] ?? 0;
    if (classifyPixel(r8, g8, b8) !== 'cloth') continue;
    const r = r8 / 255;
    const g = g8 / 255;
    const b = b8 / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta > 1e-6) {
      if (max === r) h = ((g - b) / delta + 6) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
    }
    h = (h + shift) % 6;
    const s = Math.min(1, (max <= 0 ? 0 : delta / max) * satMul);
    const val = Math.min(1, max * valueMul);
    // HSV -> RGB
    const c = val * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = val - c;
    let rr = 0;
    let gg = 0;
    let bb = 0;
    if (h < 1) [rr, gg, bb] = [c, x, 0];
    else if (h < 2) [rr, gg, bb] = [x, c, 0];
    else if (h < 3) [rr, gg, bb] = [0, c, x];
    else if (h < 4) [rr, gg, bb] = [0, x, c];
    else if (h < 5) [rr, gg, bb] = [x, 0, c];
    else [rr, gg, bb] = [c, 0, x];
    data[i] = Math.round((rr + m) * 255);
    data[i + 1] = Math.round((gg + m) * 255);
    data[i + 2] = Math.round((bb + m) * 255);
  }
}

// ---- Outfits: which accessories a character wears, chosen from role words and theme -----------

export type AccessorySlot = 'head' | 'chest' | 'left' | 'right';
export type AccessoryKind =
  | 'helmet' | 'horned' | 'hat' | 'cape' | 'shield' | 'blade' | 'axe' | 'knife' | 'ranged'
  | 'staff' | 'wand' | 'book' | 'mug' | 'throwable' | 'other';

export interface Accessory {
  /** Mesh node name as shipped in the model, e.g. "Knight_Helmet". */
  name: string;
  slot: AccessorySlot;
}

export interface OutfitPlan {
  /** Accessory names to show, sorted. Everything else on the four slots is hidden. */
  visible: string[];
}

/** Minimal random source, satisfied by world/rng's Rng. */
export interface OutfitRng {
  next(): number;
}

const KIND_PATTERNS: readonly (readonly [RegExp, AccessoryKind])[] = [
  [/helmet/, 'helmet'],
  [/barbarian_hat/, 'horned'],
  [/hat|hood/, 'hat'],
  [/cape|cloak/, 'cape'],
  [/shield/, 'shield'],
  [/bow/, 'ranged'],
  [/staff/, 'staff'],
  [/wand/, 'wand'],
  [/book/, 'book'],
  [/mug/, 'mug'],
  [/knife|dagger/, 'knife'],
  [/axe/, 'axe'],
  [/sword/, 'blade'],
  [/throw/, 'throwable'],
];

export function accessoryKind(name: string): AccessoryKind {
  const n = name.toLowerCase();
  for (const [re, kind] of KIND_PATTERNS) if (re.test(n)) return kind;
  return 'other';
}

/**
 * Two-handed and off-hand pieces need combat poses the townsfolk never play, so they are never chosen.
 * Staffs are the exception: a long stick held at rest reads fine.
 */
function isAwkward(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('offhand')) return true;
  return n.startsWith('2h_') && accessoryKind(name) !== 'staff';
}

const ROLE_WORDS = {
  martial: /guard|knight|soldier|watch|captain|sergeant|warrior|mercenar|sentry|trooper|marine|security|enforcer|warden|paladin|gladiator|militia|legion|samurai/,
  clergy: /monk|priest|nun\b|abbot|abbess|friar|cleric|preacher|pastor|reverend|chaplain|acolyte|bishop|pilgrim|shaman|druid|oracle|lama|vicar/,
  arcane: /mage|wizard|witch|sorcer|warlock|alchemist|enchant|seer|astrolog|necromanc|conjur|magician|mystic/,
  scholar: /scholar|scribe|librarian|teacher|professor|judge|clerk|lawyer|archivist|historian|student|notary|schoolm/,
  tavern: /bartender|barkeep|innkeeper|tavern|brewer|drunk|publican|barmaid|saloon|barista|bar owner/,
  hunter: /hunter|poacher|scout|archer|marksman/,
  knife: /butcher|cook|chef|thief|assassin|cutpurse|smuggler|pirate|fisher|trapper|skinner|tanner/,
  woodcut: /woodcut|lumber|logger|forester|carpenter/,
  hatted: /sheriff|marshal|deputy|cowboy|rancher|drifter|gambler|outlaw|bandit|rider|prospector|farmer|undertaker|stranger|gunslinger|bounty|wrangler|mayor|rustler/,
  cloaked: /captain|drifter|stranger|travell?er|wanderer|noble|lord|lady|king|queen|baron|duke|count|envoy|herald|commander|outlaw|bandit|rider|vampire|knight|emissary|chancellor/,
  elder: /shepherd|elder|hermit|prophet|pilgrim|druid|shaman|sage/,
  rough: /barbarian|chief|raider|smith|viking|berserk|brute|hunter|warrior/,
} as const;

export type RoleTag = keyof typeof ROLE_WORDS;

export function roleTags(role: string): Record<RoleTag, boolean> {
  const r = role.toLowerCase();
  const out = {} as Record<RoleTag, boolean>;
  for (const k of Object.keys(ROLE_WORDS) as RoleTag[]) out[k] = ROLE_WORDS[k].test(r);
  return out;
}

/**
 * Decides what a character carries. Hats and capes follow the role and theme; held items appear only
 * where they tell you who the person is (a mug for the barkeep, a book for the scribe, a sword for the
 * watch in a medieval town). Medieval weapons never show in western, modern or sci-fi towns.
 * Always draws four numbers from the rng, so the stream stays aligned whatever the role.
 */
export function planOutfit(accessories: readonly Accessory[], theme: ThemeId, role: string, rng: OutfitRng): OutfitPlan {
  const r0 = rng.next();
  const r1 = rng.next();
  const r2 = rng.next();
  const r3 = rng.next();
  const t = roleTags(role);
  const robed = t.clergy || t.arcane;
  const visible: string[] = [];
  const usable = accessories.filter((a) => !isAwkward(a.name));
  const pickOf = (slot: AccessorySlot, kinds: readonly AccessoryKind[], r: number): string | null => {
    for (const kind of kinds) {
      const found = usable.filter((a) => a.slot === slot && accessoryKind(a.name) === kind).map((a) => a.name).sort();
      if (found.length > 0) return found[Math.min(found.length - 1, Math.floor(r * found.length))] ?? null;
    }
    return null;
  };

  for (const a of accessories) {
    if (a.slot !== 'head' && a.slot !== 'chest') continue;
    const kind = accessoryKind(a.name);
    let show = false;
    if (kind === 'helmet') show = !t.clergy && t.martial && (theme === 'medieval' || theme === 'scifi');
    else if (kind === 'horned') show = theme === 'medieval' && !t.clergy && (t.rough || t.martial || r0 < 0.4);
    else if (kind === 'hat') {
      if (t.clergy) show = false;
      else if (theme === 'medieval') show = t.arcane || t.scholar || r0 < 0.35;
      else if (theme === 'western') show = t.hatted || r0 < 0.5;
      else show = t.arcane;
    } else if (kind === 'cape') {
      if (theme === 'medieval') show = t.cloaked || robed || r1 < 0.4;
      else if (theme === 'western') show = t.cloaked || t.clergy || r1 < 0.15;
      else if (theme === 'scifi') show = t.cloaked || t.clergy || r1 < 0.1;
      else show = robed;
    }
    if (show) visible.push(a.name);
  }

  let right: string | null = null;
  if (t.tavern) right = pickOf('right', ['mug'], r2);
  if (right === null && theme === 'medieval') {
    if (t.arcane) right = pickOf('right', r3 < 0.5 ? ['staff', 'wand'] : ['wand', 'staff'], r2);
    else if (t.elder) right = pickOf('right', ['staff'], r2);
    else if (t.martial) right = pickOf('right', ['blade', 'axe'], r2);
    else if (t.hunter) right = pickOf('right', ['ranged', 'knife'], r2);
    else if (t.woodcut) right = pickOf('right', ['axe'], r2);
    else if (t.knife) right = pickOf('right', ['knife'], r2);
  } else if (right === null && theme === 'western') {
    if (t.woodcut) right = pickOf('right', ['axe'], r2);
    else if (t.knife) right = pickOf('right', ['knife'], r2);
    else if (t.elder) right = pickOf('right', ['staff'], r2);
  }
  if (right !== null) visible.push(right);

  let left: string | null = null;
  if (theme !== 'scifi' && (t.scholar || t.clergy || (t.arcane && theme === 'medieval'))) left = pickOf('left', ['book'], r2 < 0.3 ? 0.99 : 0);
  if (left === null && theme === 'medieval' && t.martial && right !== null && r3 < 0.6) left = pickOf('left', ['shield'], r2);
  if (left !== null) visible.push(left);

  return { visible: visible.sort() };
}

/**
 * Palette index that suits a role: sober trades take the darkest, least saturated cloth in the theme's
 * ring, showy ones the most vivid, everyone else any. Skin and hair never change (see classifyPixel).
 */
export function paletteForRole(theme: ThemeId, role: string, rng: OutfitRng): number {
  const r = rng.next();
  const lower = role.toLowerCase();
  const ranked = PALETTE_RINGS[theme].map((p, i) => ({ i, vivid: p.value * p.sat })).sort((a, b) => a.vivid - b.vivid || a.i - b.i);
  const third = Math.max(1, Math.floor(ranked.length / 3));
  let pool = ranked;
  if (ROLE_WORDS.clergy.test(lower) || ROLE_WORDS.scholar.test(lower) || /undertaker|mourner|widow|gravedigger/.test(lower)) pool = ranked.slice(0, third);
  else if (/noble|lord|lady|merchant|bard|gambler|performer|singer|dancer|herald|jester|mayor/.test(lower)) pool = ranked.slice(ranked.length - third);
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))]?.i ?? 0;
}
