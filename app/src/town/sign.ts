// Building signs. What a sign is follows what the building is made of: a painted board or a hanging
// shingle on timber and render, a carved plaque on stone, an enamel or stencilled sheet on metal, brick
// and concrete, tubes of light on a dark backing where the place is modern and lit. The lettering face
// follows the words of the era. Colours come from the style, held well short of pure hue (the board is
// never brighter than aged paint); only the tubes of a lit sign emit. The label is drawn on a canvas
// with its weathering; under Node (no document) the sign is the same object with a plain face.
import * as THREE from 'three';
import { hash32, makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { StyleSpec, SurfaceSet, ThemeId } from '../world/spec';
import { groundTone, surfaceDefaults, surfaceFamily } from './surfaces';

export type SignKind = 'board' | 'shingle' | 'plaque' | 'enamel' | 'neon';

/** No sign is wider than this, metres, whatever width is asked for. */
export const SIGN_MAX_WIDTH = 2.4;
const KIND_WIDTH: Record<SignKind, number> = { board: 2.4, shingle: 1.3, plaque: 1.6, enamel: 2.2, neon: 2.4 };
const KIND_DEPTH: Record<SignKind, number> = { board: 0.05, shingle: 0.04, plaque: 0.08, enamel: 0.012, neon: 0.06 };

/** What a sign is made for. Anything left out follows surfaceDefaults(): the building built last, the town's theme and era. */
export interface SignContext { style?: StyleSpec; surfaces?: SurfaceSet; theme?: ThemeId; era?: string }

export interface SignFace {
  /** CSS font family list. */
  family: string;
  weight: number;
  upper: boolean;
  /** Letter spacing as a fraction of the font size. */
  spacing: number;
}

export interface SignDesign {
  kind: SignKind;
  /** Size of the board in metres. */
  width: number;
  height: number;
  depth: number;
  /** The label as lettered: one or two lines. */
  lines: string[];
  /** Colour of the board, of the lettering and of the board's edges. */
  board: string;
  ink: string;
  edge: string;
  /** Colour of the tubes on a lit sign; null on every other kind. */
  glow: string | null;
  /** Letters cut as a stencil (bridged), as on a sheet-metal sign. */
  stencil: boolean;
  face: SignFace;
  wear: number;
  seed: number;
}

const FACE_FUTURE: SignFace = { family: 'Bahnschrift, "DIN Alternate", "Segoe UI", "Helvetica Neue", Arial, sans-serif', weight: 600, upper: true, spacing: 0.12 };
const FACE_GROTESQUE: SignFace = { family: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif', weight: 700, upper: true, spacing: 0.05 };
const FACE_SLAB: SignFace = { family: 'Rockwell, "Rockwell Nova", Clarendon, "Bookman Old Style", Georgia, serif', weight: 700, upper: true, spacing: 0.07 };
const FACE_OLD: SignFace = { family: '"Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", serif', weight: 700, upper: false, spacing: 0.03 };

/** Words of an era and the lettering they call for. The first row that matches wins. */
const ERA_FACES: readonly (readonly [RegExp, SignFace])[] = [
  [/futur|cyber|space|orbit|colony|star|alien|android|mech|sci-?fi|interstellar|2[1-9]\d\d/, FACE_FUTURE],
  [/medieval|feudal|gothic|norse|viking|saxon|dark age|fantas|myth|kingdom|ancient|roman|greek|egypt|bronze|iron age|renaiss|tudor|dynasty|shogun|samurai|\b1[0-6]\d\d/, FACE_OLD],
  [/west|frontier|victor|georgian|regency|edwardian|steam|colonial|pirate|gold rush|civil war|19th|18th|\b1[78]\d\d|\b19[01]\d/, FACE_SLAB],
  [/modern|contempor|industr|today|present|\bnow\b|urban|post-?war|cold war|apocal|20th|21st|\b19[2-9]\d|\b20\d\d/, FACE_GROTESQUE],
];
const THEME_FACE: Record<ThemeId, SignFace> = { western: FACE_SLAB, medieval: FACE_OLD, scifi: FACE_FUTURE, modern: FACE_GROTESQUE };

/** The lettering face for a period given in free words, falling back to the theme. */
export function signFace(era: string, theme: ThemeId): SignFace {
  const words = era.toLowerCase();
  for (const [re, face] of ERA_FACES) if (re.test(words)) return face;
  return THEME_FACE[theme] ?? FACE_OLD;
}

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const hslOf = (hex: string): { h: number; s: number; l: number } => new THREE.Color(HEX.test(hex) ? hex : '#808080').getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
const hslHex = (h: number, s: number, l: number): string => `#${new THREE.Color().setHSL(h, clamp(s, 0, 1), clamp(l, 0, 1), THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
const mixHex = (a: string, b: string, t: number): string => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
/** Relative luminance, 0..1. */
const lumOf = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
/** Whichever of two lettering colours stands out more against a board. */
const inkOn = (board: string, pale: string, deep: string): string => (lumOf(board) > 0.16 ? deep : pale);

/** An aged paint in the hue of `hex`: saturation and lightness held to what `sMax` and the range allow. */
function agedPaint(hex: string, wear: number, sMax: number, lLo: number, lHi: number): string {
  const c = hslOf(hex);
  return hslHex(c.h, Math.min(c.s, sMax) * (1 - 0.35 * wear), clamp(c.l, lLo, lHi));
}

function splitLabel(label: string, upper: boolean): string[] {
  const text = (upper ? label.toUpperCase() : label).replace(/\s+/g, ' ').trim() || '?';
  if (text.length <= 13 || !text.includes(' ')) return [text];
  // Break at the space nearest the middle.
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (best < 0 || Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2))) best = i;
  }
  return [text.slice(0, best), text.slice(best + 1)];
}

function kindFor(surfaces: SurfaceSet | undefined, style: StyleSpec | undefined, theme: ThemeId, pick: number): SignKind {
  const late = theme === 'scifi' || theme === 'modern';
  if (!surfaces) return late ? 'enamel' : 'board';
  const fam = surfaceFamily(surfaces.wall);
  if (fam === 'metal' || fam === 'glass') {
    // Tubes of light need a place that is lit and kept: modern, with a glow colour, not a ruin.
    const lit = late && style !== undefined && HEX.test(style.glow) && surfaces.wear < 0.65;
    return lit && pick < 0.55 ? 'neon' : 'enamel';
  }
  if (fam === 'masonry' || fam === 'mineral') {
    if (late) return pick < 0.7 ? 'enamel' : 'board';
    if (surfaces.wall === 'brick') return pick < 0.6 ? 'board' : 'shingle';
    return pick < 0.65 ? 'plaque' : 'shingle';
  }
  if (late && fam === 'render') return pick < 0.5 ? 'enamel' : 'board';
  return pick < 0.6 ? 'board' : 'shingle';
}

/**
 * Decides everything about a sign without drawing it: its kind, size, colours and lettering. `accent`
 * is the colour the world wants its signs in; `width` the room there is for it, metres. Deterministic.
 */
export function signDesign(label: string, accent: string, width: number, context: SignContext = {}): SignDesign {
  const d = surfaceDefaults();
  const style = context.style ?? d.style;
  const surfaces = context.surfaces ?? d.surfaces;
  const theme = context.theme ?? d.theme;
  const era = `${context.era ?? d.era ?? ''} ${style?.name ?? ''}`;
  const seed = hash32(`sign|${label}`);
  const rng = makeRng(seed, 'design');
  const wear = clamp(surfaces?.wear ?? 0.4, 0, 1);
  const kind = kindFor(surfaces, style, theme, rng.next());
  const face = signFace(era, theme);
  const lines = splitLabel(label, face.upper || kind === 'enamel' || kind === 'neon');
  const two = lines.length > 1;
  const chars = Math.max(...lines.map((l) => l.length));
  const room = Number.isFinite(width) && width > 0 ? width : SIGN_MAX_WIDTH;
  const w = Math.min(room, SIGN_MAX_WIDTH, KIND_WIDTH[kind], Math.max(1.2, 0.6 + 0.16 * chars));
  const tall = kind === 'shingle' || kind === 'plaque';
  const h = two ? clamp(w * (tall ? 0.58 : 0.4), 0.5, 0.85) : clamp(w * (tall ? 0.42 : 0.26), 0.32, 0.6);

  const tone = HEX.test(accent) ? accent : style?.accent ?? '#7a3b30';
  const cream = mixHex('#e2dac6', '#b9b09c', wear * 0.6);
  const dark = style && HEX.test(style.dark) ? groundTone('timber', style.dark, wear) : '#2a2420';
  const scheme = makeRng(seed, 'scheme').next();
  let board: string;
  let ink: string;
  let glow: string | null = null;
  let stencil = false;
  if (kind === 'neon') {
    board = mixHex('#14161a', agedPaint(dark, wear, 0.2, 0.05, 0.12), 0.5);
    glow = style && HEX.test(style.glow) ? style.glow : '#ffd9a0';
    // Every other lit sign takes the world's accent as its light instead, brought up to a tube's brightness.
    if (scheme < 0.45) {
      const a = hslOf(tone);
      glow = hslHex(a.h, Math.max(a.s, 0.75), 0.62);
    }
    ink = glow;
  } else if (kind === 'plaque') {
    const trim = style && surfaces && surfaceFamily(surfaces.trim) === 'masonry' && HEX.test(style.trim) ? style.trim : '#8a867e';
    board = groundTone('stone', mixHex(trim, '#8a867e', 0.4), wear);
    const b = hslOf(board);
    ink = hslHex(b.h, b.s, b.l * 0.3);
  } else if (kind === 'enamel') {
    const metal = surfaces !== undefined && surfaceFamily(surfaces.wall) === 'metal';
    stencil = metal && scheme < 0.4;
    if (stencil && style && HEX.test(style.wall2)) {
      // Lettered straight onto a sheet in the building's own second colour.
      board = groundTone('metal_panel', style.wall2, wear);
      ink = inkOn(board, cream, '#1d1c1a');
    } else if (scheme < 0.7) {
      board = mixHex('#d6d3c8', '#b4ad9c', wear * 0.5);
      ink = agedPaint(tone, wear, 0.55, 0.14, 0.28);
    } else {
      board = agedPaint(tone, wear, 0.5, 0.18, 0.32);
      ink = inkOn(board, cream, '#1d1c1a');
    }
  } else if (scheme < 0.4) {
    board = agedPaint(tone, wear, 0.5, 0.2, 0.38);
    ink = inkOn(board, cream, dark);
  } else if (scheme < 0.7) {
    board = mixHex('#d9cfb6', '#a79c84', wear * 0.6);
    ink = scheme < 0.55 ? agedPaint(tone, wear, 0.55, 0.14, 0.28) : dark;
  } else {
    board = agedPaint(dark, wear, 0.3, 0.12, 0.2);
    ink = scheme < 0.85 ? cream : hslHex(0.115, 0.42 * (1 - 0.3 * wear), 0.56);
  }
  const b = hslOf(board);
  return {
    kind, width: w, height: h, depth: KIND_DEPTH[kind], lines, board, ink, glow, stencil, face, wear, seed,
    edge: hslHex(b.h, b.s * 0.7, b.l * 0.5),
  };
}

// ---- drawing ----------------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
const CANVAS_W = 512;

/** An irregular patch about `r` across. */
function blob(ctx: Ctx, rng: Rng, x: number, y: number, r: number): void {
  const n = 7;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = r * rng.range(0.45, 1);
    if (i === 0) ctx.moveTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
    else ctx.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
  }
  ctx.closePath();
  ctx.fill();
}

/** Run-off: thin streaks hanging from `y0`, fading as they fall. */
function drips(ctx: Ctx, rng: Rng, count: number, x0: number, x1: number, y0: number, length: number, color: string, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rng.range(x0, x1);
    const len = length * rng.range(0.3, 1);
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * rng.range(0.4, 1);
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, rng.range(1.5, 5), len);
  }
  ctx.globalAlpha = 1;
}

/** Fine mottle in darker and paler flecks. */
function mottle(ctx: Ctx, rng: Rng, W: number, H: number, count: number, alpha: number, size: number): void {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * rng.next();
    ctx.fillStyle = rng.chance(0.5) ? '#000000' : '#ffffff';
    ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(1, size), rng.range(1, size));
  }
  ctx.globalAlpha = 1;
}

interface Lettering { size: number; ys: number[] }

/** Sets the font to the largest size at which every line fits inside the margins and returns where the lines sit. */
function fitLetters(ctx: Ctx, d: SignDesign, W: number, H: number, mx: number, my: number): Lettering {
  const n = d.lines.length;
  let size = Math.floor(((H - 2 * my) / n) * 0.86);
  const spaced = ctx as unknown as { letterSpacing?: string };
  for (;;) {
    ctx.font = `${d.face.weight} ${size}px ${d.face.family}`;
    if ('letterSpacing' in ctx) spaced.letterSpacing = `${(size * d.face.spacing).toFixed(1)}px`;
    if (size <= 14 || d.lines.every((l) => ctx.measureText(l).width <= W - 2 * mx)) break;
    size -= 2;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pitch = size * 1.12;
  const ys = d.lines.map((_, i) => H / 2 + (i - (n - 1) / 2) * pitch + size * 0.04);
  return { size, ys };
}

function letters(ctx: Ctx, d: SignDesign, W: number, at: Lettering, dx: number, dy: number, stroke = false): void {
  d.lines.forEach((line, i) => {
    if (stroke) ctx.strokeText(line, W / 2 + dx, (at.ys[i] as number) + dy);
    else ctx.fillText(line, W / 2 + dx, (at.ys[i] as number) + dy);
  });
}

function paintBoard(ctx: Ctx, d: SignDesign, W: number, H: number, rng: Rng): void {
  const bare = '#6f6050';
  ctx.fillStyle = d.board;
  ctx.fillRect(0, 0, W, H);
  // Two or three boards, each a shade apart, with the grain showing through the paint.
  const planks = H > 150 ? 3 : 2;
  for (let p = 0; p < planks; p++) {
    const y0 = (p / planks) * H;
    ctx.globalAlpha = rng.range(0.02, 0.1);
    ctx.fillStyle = rng.chance(0.5) ? '#000000' : '#ffffff';
    ctx.fillRect(0, y0, W, H / planks);
    ctx.fillStyle = '#000000';
    for (let i = 0; i < 46; i++) {
      ctx.globalAlpha = rng.range(0.03, 0.12 + 0.1 * d.wear);
      ctx.fillRect(rng.range(-40, W), y0 + rng.range(2, H / planks - 2), rng.range(30, 220), 1);
    }
    if (p > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillRect(0, y0 - 1, W, 2);
    }
  }
  ctx.globalAlpha = 0.5 * (1 - 0.5 * d.wear);
  ctx.strokeStyle = d.ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(9, 9, W - 18, H - 18);
  ctx.globalAlpha = 1;
  const at = fitLetters(ctx, d, W, H, 30, 20);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  letters(ctx, d, W, at, 1.5, 2);
  ctx.fillStyle = d.ink;
  letters(ctx, d, W, at, 0, 0);
  // Paint lifting along the grain and flaking at the edges and joints: bare grey wood shows, through the letters too.
  ctx.fillStyle = bare;
  const flakes = Math.round(240 * d.wear * d.wear);
  for (let i = 0; i < flakes; i++) {
    const edge = rng.chance(0.45);
    const y = edge ? (rng.chance(0.5) ? rng.range(0, 14) : H - rng.range(0, 14)) : rng.range(0, H);
    ctx.globalAlpha = rng.range(0.35, 0.9);
    ctx.fillRect(rng.range(0, W), y, rng.range(3, 26 + 30 * d.wear), rng.range(1, 2.6));
  }
  for (let i = 0; i < 26 * d.wear; i++) {
    ctx.globalAlpha = rng.range(0.5, 0.9);
    blob(ctx, rng, rng.chance(0.5) ? rng.range(0, 30) : W - rng.range(0, 30), rng.range(0, H), rng.range(3, 9));
  }
  ctx.globalAlpha = 1;
  // Iron fixings and what runs from them.
  for (const x of [20, W - 20]) {
    for (const y of [H * 0.25, H * 0.75]) {
      drips(ctx, rng, 2, x - 3, x + 1, y, 16 + 50 * d.wear, 'rgba(70,40,24,1)', 0.5 * d.wear + 0.15);
      ctx.fillStyle = '#1c1816';
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drips(ctx, rng, Math.round(5 + 14 * d.wear), 0, W, 0, H * 0.7, 'rgba(30,24,18,1)', 0.12 + 0.2 * d.wear);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.16)');
  g.addColorStop(0.2, 'rgba(0,0,0,0)');
  g.addColorStop(0.7, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(20,14,8,${0.15 + 0.25 * d.wear})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function paintPlaque(ctx: Ctx, d: SignDesign, W: number, H: number, rng: Rng): void {
  ctx.fillStyle = d.board;
  ctx.fillRect(0, 0, W, H);
  mottle(ctx, rng, W, H, 1400, 0.1, 4);
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = rng.range(0.03, 0.08);
    ctx.fillStyle = rng.chance(0.5) ? '#000000' : '#ffffff';
    blob(ctx, rng, rng.range(0, W), rng.range(0, H), rng.range(20, 70));
  }
  ctx.globalAlpha = 1;
  // A sunk panel: its upper and left walls in shade, its lower and right walls catching the light.
  const m = 12;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.moveTo(m, H - m);
  ctx.lineTo(m, m);
  ctx.lineTo(W - m, m);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.moveTo(W - m, m);
  ctx.lineTo(W - m, H - m);
  ctx.lineTo(m, H - m);
  ctx.stroke();
  // Cut letters, shaded the same way.
  const at = fitLetters(ctx, d, W, H, 34, 24);
  const cut = Math.max(1.5, at.size * 0.035);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  letters(ctx, d, W, at, cut, cut);
  ctx.fillStyle = d.ink;
  letters(ctx, d, W, at, 0, 0);
  // Weather: a crack or two, lichen, and dirt washed down from the top edge.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < Math.round(3 * d.wear); i++) {
    let x = rng.range(0, W);
    let y = rng.chance(0.5) ? 0 : H;
    const dir = y === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += rng.range(-16, 16);
      y += dir * rng.range(4, H / 8);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 30 * d.wear; i++) {
    ctx.globalAlpha = rng.range(0.15, 0.4);
    ctx.fillStyle = rng.chance(0.6) ? '#6a6f4a' : '#b9b59a';
    blob(ctx, rng, rng.range(0, W), rng.range(0, H), rng.range(3, 12));
  }
  ctx.globalAlpha = 1;
  drips(ctx, rng, Math.round(6 + 16 * d.wear), 0, W, 0, H * 0.8, 'rgba(24,22,18,1)', 0.12 + 0.2 * d.wear);
}

function paintEnamel(ctx: Ctx, d: SignDesign, W: number, H: number, rng: Rng): void {
  const rust = 'rgba(96,50,24,1)';
  ctx.fillStyle = d.board;
  ctx.fillRect(0, 0, W, H);
  if (!d.stencil) {
    ctx.strokeStyle = d.ink;
    ctx.lineWidth = 5;
    ctx.strokeRect(11, 11, W - 22, H - 22);
  }
  const at = fitLetters(ctx, d, W, H, 36, 24);
  ctx.fillStyle = d.ink;
  letters(ctx, d, W, at, 0, 0);
  if (d.stencil) {
    // Bridges: the ties that hold the middle of a stencilled letter in place.
    ctx.fillStyle = d.board;
    const pitch = at.size * 0.52;
    for (let x = (W / 2) % pitch; x < W; x += pitch) ctx.fillRect(x - 1.5, 0, 3, H);
    mottle(ctx, rng, W, H, 500, 0.08, 3);
  }
  // Fixing holes with rust around and below them.
  const holes: [number, number][] = [[14, 14], [W - 14, 14], [14, H - 14], [W - 14, H - 14], [W / 2, 9], [W / 2, H - 9]];
  for (const [x, y] of holes) {
    const r = 5 + 16 * d.wear * rng.range(0.5, 1);
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, rust);
    g.addColorStop(1, 'rgba(96,50,24,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    drips(ctx, rng, 2, x - 3, x + 1, y, 18 + 70 * d.wear, rust, 0.25 + 0.5 * d.wear);
    ctx.fillStyle = '#17120f';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Chips: where the coat has been knocked off, mostly along the edges, the steel beneath has rusted.
  const chips = Math.round(4 + 26 * d.wear);
  for (let i = 0; i < chips; i++) {
    const edge = rng.chance(0.75);
    const side = rng.int(0, 3);
    const x = edge ? (side === 0 ? rng.range(0, 8) : side === 1 ? W - rng.range(0, 8) : rng.range(0, W)) : rng.range(0, W);
    const y = edge ? (side === 2 ? rng.range(0, 8) : side === 3 ? H - rng.range(0, 8) : rng.range(0, H)) : rng.range(0, H);
    const r = rng.range(3, 6 + 12 * d.wear);
    ctx.fillStyle = '#5e3520';
    blob(ctx, rng, x, y, r);
    ctx.fillStyle = '#2a1a12';
    blob(ctx, rng, x, y, r * 0.55);
    if (rng.chance(0.5)) drips(ctx, rng, 1, x - 2, x + 2, y, 10 + 50 * d.wear, rust, 0.3 + 0.3 * d.wear);
  }
  drips(ctx, rng, Math.round(4 + 10 * d.wear), 0, W, 0, H * 0.8, 'rgba(40,32,24,1)', 0.08 + 0.14 * d.wear);
  // Years of sun: the whole face a little chalked.
  ctx.fillStyle = `rgba(200,196,186,${0.1 * d.wear})`;
  ctx.fillRect(0, 0, W, H);
}

function paintNeon(ctx: Ctx, d: SignDesign, W: number, H: number, rng: Rng): void {
  const glow = d.glow ?? '#ffd9a0';
  ctx.fillStyle = d.board;
  ctx.fillRect(0, 0, W, H);
  mottle(ctx, rng, W, H, 300, 0.05, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (const [x, y] of [[10, 10], [W - 10, 10], [10, H - 10], [W - 10, H - 10]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Bent tube: an outline of light, a soft halo on the backing, a hot core.
  const at = fitLetters(ctx, d, W, H, 40, 30);
  const tube = Math.max(3, at.size * 0.075);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = glow;
  ctx.shadowBlur = 16;
  ctx.strokeStyle = glow;
  ctx.lineWidth = tube;
  letters(ctx, d, W, at, 0, 0, true);
  letters(ctx, d, W, at, 0, 0, true);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = mixHex(glow, '#ffffff', 0.7);
  ctx.lineWidth = tube * 0.4;
  letters(ctx, d, W, at, 0, 0, true);
  // The clips that hold the glass, and dust on the backing.
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  for (let i = 0; i < 12; i++) ctx.fillRect(rng.range(40, W - 40), rng.range(30, H - 30), 2, 5);
  drips(ctx, rng, Math.round(3 + 8 * d.wear), 0, W, 0, H * 0.6, 'rgba(90,84,74,1)', 0.05 + 0.1 * d.wear);
}

function paint(canvas: HTMLCanvasElement, d: SignDesign): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  const rng = makeRng(d.seed, 'paint');
  if (d.kind === 'neon') paintNeon(ctx, d, W, H, rng);
  else if (d.kind === 'plaque') paintPlaque(ctx, d, W, H, rng);
  else if (d.kind === 'enamel') paintEnamel(ctx, d, W, H, rng);
  else paintBoard(ctx, d, W, H, rng);
  ctx.restore();
}

/** Draws a sign's face onto a canvas of the design's proportions. Exposed for previews. */
export function paintSign(canvas: HTMLCanvasElement, design: SignDesign): void {
  paint(canvas, design);
}

// ---- the object -------------------------------------------------------------------------------

interface SignData { canvas: HTMLCanvasElement | null; texture: THREE.CanvasTexture | null; design: SignDesign; disposed: boolean }

const data = new WeakMap<THREE.Object3D, SignData>();

/** The design of a sign made by createSign. */
export function signDesignOf(sign: THREE.Object3D): SignDesign | undefined {
  return data.get(sign)?.design;
}

/**
 * Creates a sign facing local -Z, to be placed by its centre 8 cm in front of a wall (position and
 * rotate the returned mesh yourself). `board` is the colour the world wants its signs in and `width` the
 * room there is, metres; the sign is as wide as its label needs, never wider than SIGN_MAX_WIDTH, and
 * what it is made of follows `context` (default: the building built last, see surfaceDefaults).
 * Brackets, battens and chains are children of the returned mesh; release everything with disposeSign.
 */
export function createSign(label: string, board: string, width: number, context?: SignContext): THREE.Mesh {
  const d = signDesign(label, board, width, context);
  const neon = d.kind === 'neon';
  const edge = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.edge), roughness: 0.85, metalness: d.kind === 'enamel' ? 0.4 : 0 });
  const face = new THREE.MeshStandardMaterial({
    color: new THREE.Color(d.board),
    roughness: d.kind === 'enamel' ? 0.3 + 0.35 * d.wear : d.kind === 'neon' ? 0.5 : 0.88,
  });
  const info: SignData = { canvas: null, texture: null, design: d, disposed: false };
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = Math.round((CANVAS_W * d.height) / d.width / 4) * 4;
    paint(canvas, d);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    face.map = texture;
    face.color.set('#ffffff');
    if (neon) {
      // Only the tubes are bright in the picture, so only they emit.
      face.emissive.set('#ffffff');
      face.emissiveMap = texture;
      face.emissiveIntensity = 1.5;
    }
    info.canvas = canvas;
    info.texture = texture;
    // Redraw once the page fonts are ready, in case the first paint used a fallback face.
    void document.fonts?.ready.then(() => {
      if (info.disposed || !info.canvas) return;
      paint(info.canvas, info.design);
      texture.needsUpdate = true;
    });
  }
  // The caller's wall is at local z = +0.08. A fixed sign stands 3 cm off it on battens; a shingle hangs 30 cm out.
  const hung = d.kind === 'shingle';
  const back = hung ? -0.2 : 0.05;
  const geo = new THREE.BoxGeometry(d.width, d.height, d.depth).translate(0, 0, back - d.depth / 2);
  const mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, edge, face]); // +x -x +y -y +z -z: the -Z face carries the label
  mesh.castShadow = true;
  mesh.name = 'sign';
  const iron = new THREE.MeshStandardMaterial({ color: new THREE.Color('#231f1c'), roughness: 0.7, metalness: 0.5 });
  const piece = (w: number, h: number, dp: number, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp).translate(x, y, z), iron);
    m.castShadow = true;
    m.name = 'sign-fixing';
    mesh.add(m);
  };
  if (hung) {
    const z = back - d.depth / 2;
    const top = d.height / 2 + 0.16;
    piece(d.width + 0.16, 0.035, 0.035, 0, top, z);
    for (const sx of [-1, 1]) {
      piece(0.035, 0.035, 0.08 - z, sx * (d.width / 2 + 0.05), top, (0.08 + z) / 2);
      piece(0.012, 0.16, 0.012, sx * d.width * 0.36, d.height / 2 + 0.08, z);
    }
  } else {
    for (const sx of [-1, 1]) piece(0.04, d.height * 0.8, 0.03, sx * d.width * 0.32, 0, 0.065);
  }
  data.set(mesh, info);
  return mesh;
}

/** Redraws a sign made by createSign with new text; the board keeps its size and kind. */
export function setSignLabel(sign: THREE.Object3D, label: string): void {
  const info = data.get(sign);
  if (!info) return;
  const d = info.design;
  info.design = { ...d, lines: splitLabel(label, d.face.upper || d.kind === 'enamel' || d.kind === 'neon') };
  if (!info.canvas || !info.texture) return;
  paint(info.canvas, info.design);
  info.texture.needsUpdate = true;
}

export function disposeSign(sign: THREE.Mesh): void {
  const info = data.get(sign);
  if (info) {
    info.disposed = true;
    info.texture?.dispose();
  }
  const mats = new Set<THREE.Material>();
  sign.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
  });
  for (const m of mats) m.dispose();
}
