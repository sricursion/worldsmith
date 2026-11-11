// Architectural dressing: turns a blueprint's bare primitives into believable construction. Works on
// expanded parts (repeat = 1) and returns the same parts followed by what was added:
//   - a stepped plinth, corner posts or quoin strips, storey bands every 3.2 m, a wall plate;
//   - at the roof: a fascia and shadow line, eaves carried out past the wall by an amount that suits
//     the roofing, gutters along the eaves and downpipes to the ground, a parapet with coping on a flat roof;
//   - a chimney where the walls are timber, masonry or render, vents and plant where they are metal;
//   - on metal walls: stiffeners, flanges, an access ladder, service pipes on brackets, a cable tray;
//   - buttresses on tall masonry, beams between posts, joists and corbels under decks.
// Trim sits flush or a few centimetres proud of what it dresses; eaves, pipes, ladders and roof clutter
// reach further (see REACH_FAR and RISE). The pass also reports where dirty water runs: under every
// sill, under gutter ends and below iron brackets (ctx.stains).
//
// dressBuilding goes further than a list of parts can: it also says which openings to cut into which
// walls (a recess with reveals, a frame and the glazing or door at the back), which sloping roofs to
// build as a slab with real thickness, and where oriented members (rafter tails, bargeboards, braces,
// hip caps, dome ribs) go. blueprint-mesh.ts builds those. dressParts is the parts-only pass: openings
// stay on the wall face, framed and trimmed.
import type { Rng } from '../world/rng';
import type { BlueprintPart, PartShape, PartTone, SurfaceKind, SurfaceSet } from '../world/spec';
import { surfaceFamily } from './surfaces';
import type { Quality } from './surfaces';

/** A run-off stain on a wall, metres in the building's frame (x, z on the footprint, +z the front). */
export interface Stain {
  /** Middle of the stain's top edge. */
  x: number;
  z: number;
  y: number;
  /** Width along the wall and length down it. */
  w: number;
  h: number;
  /** Direction the stained face looks, degrees about the vertical; 0 is +z. */
  rot: number;
  kind: 'stain' | 'rust';
}

/** A side face of a box part, in the part's own frame: +z, -z, +x, -x. */
export type Face = 0 | 1 | 2 | 3;
/** How far each face's frame is turned against the part's own, degrees. In a face's frame +z looks out of the wall. */
export const FACE_TURN: readonly [number, number, number, number] = [0, 180, 90, -90];

/** An opening cut into one face of a box part. `u` runs along the face from its middle, `v` up from the part's base. */
export interface Opening {
  /** Index of the wall part in the dressed list. */
  wall: number;
  face: Face;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** How far the glazing or door sits behind the wall face, metres. */
  depth: number;
  kind: 'window' | 'door';
  /** What closes the back: glazing, or darkness (a plate, or a room when `room` is set). */
  fill: 'glass' | 'dark';
  /** Tone of the frame built into the recess; null for a bare hole. */
  frame: PartTone | null;
  frameWidth: number;
  /** Rise of the sloped sill from the wall face to the frame, metres. */
  sill: number;
  /** Depth of the dark volume behind the opening, metres; 0 for none. */
  room: number;
  /** 0..1, picks which patch of the interior-glow map this window shows at night. */
  glow: number;
}

/** A straight member of rectangular section between two points, metres in the building's frame. */
export interface Strut {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  /** Section: `w` across (horizontal), `t` the other way. */
  w: number;
  t: number;
  tone: PartTone;
}

/** A gable or lean-to roof part to be built as a slab with thickness instead of a bare prism. */
export interface RoofShell {
  /** Index of the roof part in the dressed list. */
  part: number;
  /** How far the slab runs past the part's eave line and past its gable ends, metres. */
  out: number;
  verge: number;
  /** Thickness of the roofing, square to the slope. */
  thick: number;
  /** The eave: cut plumb, rounded (thatch), scalloped (pantile, corrugated sheet) or with a doubled starter course. */
  edge: 'plain' | 'round' | 'wave' | 'step';
  pitch: number;
  amp: number;
  /** Ridge capping: how far it laps down each slope and how proud it stands; 0 for none. */
  cap: number;
  capRise: number;
  capTone: PartTone;
  soffit: PartTone;
}

export interface Dressed {
  /** The authored parts, untouched, followed by the added ones. */
  parts: BlueprintPart[];
  openings: Opening[];
  struts: Strut[];
  roofs: RoofShell[];
  /** Indices of authored parts that an opening replaces (the glass slab, the door leaf) and must not be drawn. */
  hidden: number[];
}

export interface DressContext {
  /** Footprint in metres. */
  w: number;
  d: number;
  rng: Rng;
  surfaces: SurfaceSet;
  /** Door position on the front face as a fraction of the footprint width; no door dressing when absent. */
  doorX?: number;
  /** When given, the pass appends the run-off stains it wants drawn. */
  stains?: Stain[];
  /** Sets the part budget (PART_BUDGET) and drops the finest work at 0. Left out: MAX_DRESSED_PARTS, everything. */
  quality?: Quality;
  /** 0 old (many small panes) .. 1 modern (plain sheets). Left out: taken from the wall surface. */
  era?: number;
}

/** Most parts a building may have after dressing when no quality is stated. */
export const MAX_DRESSED_PARTS = 140;
/** Most parts' worth of geometry a building may have at quality 0, 1 and 2. */
export const PART_BUDGET: readonly [number, number, number] = [80, 140, 220];
/** Furthest ordinary trim may reach outside the original bounding box, metres. */
const REACH = 0.085;
/** Furthest eaves, gutters, pipes and ladders may reach outside it. */
export const REACH_FAR = 0.65;
/** Highest a chimney, vent or rail may stand above it. */
export const RISE = 1.5;
const RAD = Math.PI / 180;

/** Floor-to-floor height, door size and how far each roofing is carried past the wall, metres. */
export const STOREY = 3.2;
export const DOOR = { w: 1.0, h: 2.1 } as const;
const OVERHANG: Partial<Record<SurfaceKind, number>> = {
  thatch: 0.5, tile: 0.4, shingle: 0.35, slate: 0.3, timber: 0.3, planks: 0.3, corrugated: 0.25, metal_panel: 0.2, rusted: 0.25, canvas: 0.15,
};

/** How deep an opening sits in a wall of each surface: thick for laid and stacked walls, thin for sheet and cloth. */
const REVEAL: Partial<Record<SurfaceKind, number>> = {
  adobe: 0.35, stone: 0.32, cobble: 0.32, log: 0.3, ice: 0.3, thatch: 0.28, brick: 0.26, organic: 0.26, coral: 0.26, concrete: 0.24,
  plaster: 0.22, bark: 0.22, chitin: 0.2, crystal: 0.2, timber: 0.18, planks: 0.16, hull_plate: 0.15, rusted: 0.13,
  metal_panel: 0.12, corrugated: 0.12, glass_curtain: 0.12, canvas: 0.12, paper_screen: 0.12,
};
export const revealDepth = (kind: SurfaceKind): number => REVEAL[kind] ?? 0.2;

interface Roofing { thick: number; edge: RoofShell['edge']; pitch: number; amp: number; cap: number; capRise: number; capTone: PartTone; barge: boolean; fascia: boolean }
const ROOFING_PLAIN: Roofing = { thick: 0.08, edge: 'plain', pitch: 0, amp: 0, cap: 0.14, capRise: 0.03, capTone: 'roof', barge: true, fascia: true };
const SHEET: Roofing = { thick: 0.03, edge: 'wave', pitch: 0.2, amp: 0.03, cap: 0.2, capRise: 0.03, capTone: 'roof', barge: false, fascia: false };
const PANEL: Roofing = { thick: 0.05, edge: 'plain', pitch: 0, amp: 0, cap: 0.16, capRise: 0.03, capTone: 'dark', barge: false, fascia: true };
const BOARDED: Roofing = { thick: 0.06, edge: 'step', pitch: 0, amp: 0, cap: 0.1, capRise: 0.03, capTone: 'roof', barge: true, fascia: true };
const CLOTH: Roofing = { thick: 0.02, edge: 'plain', pitch: 0, amp: 0, cap: 0, capRise: 0, capTone: 'roof', barge: false, fascia: false };
/** How each roofing is laid: thatch thick and rounded, tile scalloped at the eave, sheet thin and wavy, slate thin and crisp. */
const ROOFING: Partial<Record<SurfaceKind, Roofing>> = {
  thatch: { thick: 0.34, edge: 'round', pitch: 0, amp: 0, cap: 0.42, capRise: 0.1, capTone: 'roof', barge: false, fascia: false },
  tile: { thick: 0.1, edge: 'wave', pitch: 0.26, amp: 0.045, cap: 0.17, capRise: 0.07, capTone: 'roof', barge: true, fascia: true },
  shingle: { thick: 0.07, edge: 'step', pitch: 0, amp: 0, cap: 0.14, capRise: 0.03, capTone: 'roof', barge: true, fascia: true },
  slate: { thick: 0.035, edge: 'plain', pitch: 0, amp: 0, cap: 0.13, capRise: 0.025, capTone: 'dark', barge: true, fascia: true },
  corrugated: SHEET, rusted: SHEET, metal_panel: PANEL, hull_plate: PANEL, planks: BOARDED, timber: BOARDED, canvas: CLOTH, paper_screen: CLOTH,
};

const OLD_WORDS = /\b(medieval|gothic|tudor|castle|ancient|ruin\w*|old|colonial|victorian|frontier|western|rustic|village|temple|abbey|keep|feudal)\b/i;
const NEW_WORDS = /\b(modern|futur\w*|sci-?fi|neon|cyber\w*|station|lab|orbital|colony|corporate|skyscraper|metro\w*|contemporary)\b/i;
/** Reads an age from a description: 0.15 for words of the past, 0.9 for words of the present and after, nothing otherwise. */
export function eraFromWords(text: string): number | undefined {
  if (OLD_WORDS.test(text)) return 0.15;
  if (NEW_WORDS.test(text)) return 0.9;
  return undefined;
}

/** A part in metres on the footprint, with its rotation resolved. */
interface Solid { cx: number; cz: number; y: number; w: number; d: number; h: number; rot: number; cos: number; sin: number }
interface Bounds { x0: number; x1: number; z0: number; z1: number; top: number }
interface Extra { part: BlueprintPart | null; strut: Strut | null; rank: number; loose: boolean; size: number }
interface AddOpts { loose?: boolean; reach?: number; rise?: number }
interface Rect { u0: number; u1: number; v0: number; v1: number }
interface FaceRef { F: Solid; /** Width of the face and thickness of the box behind it. */ A: number; T: number }
interface WallRef { i: number; p: BlueprintPart; s: Solid; faces: readonly [FaceRef, FaceRef, FaceRef, FaceRef] }
interface Seat extends Rect { wl: WallRef; face: Face; fc: FaceRef }

const FACES: readonly Face[] = [0, 1, 2, 3];
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function solid(p: BlueprintPart, W: number, D: number): Solid {
  return { cx: p.x * W, cz: p.z * D, y: p.y, w: p.w * W, d: p.d * D, h: p.h, rot: p.rot, cos: Math.cos(p.rot * RAD), sin: Math.sin(p.rot * RAD) };
}

/** A point given along a solid's own axes, on the footprint. */
const toWorld = (s: Solid, lx: number, lz: number): [number, number] => [s.cx + lx * s.cos + lz * s.sin, s.cz - lx * s.sin + lz * s.cos];
/** A point on the footprint, along a solid's own axes. */
function toLocal(s: Solid, x: number, z: number): [number, number] {
  const rx = x - s.cx;
  const rz = z - s.cz;
  return [rx * s.cos - rz * s.sin, rx * s.sin + rz * s.cos];
}
/** A frame centred at an offset in `s`, turned by `turn` degrees against it. */
function frameAt(s: Solid, lx: number, lz: number, turn: number): Solid {
  const [cx, cz] = toWorld(s, lx, lz);
  const rot = s.rot + turn;
  return { cx, cz, y: s.y, w: 1, d: 1, h: 1, rot, cos: Math.cos(rot * RAD), sin: Math.sin(rot * RAD) };
}
function faceOf(s: Solid, f: Face): FaceRef {
  const alongX = f < 2;
  const half = alongX ? s.d / 2 : s.w / 2;
  const F = frameAt(s, f === 2 ? half : f === 3 ? -half : 0, f === 0 ? half : f === 1 ? -half : 0, FACE_TURN[f]);
  return { F, A: alongX ? s.w : s.d, T: alongX ? s.d : s.w };
}

function boundsOf(s: Solid): Bounds {
  const c = Math.abs(s.cos);
  const n = Math.abs(s.sin);
  const hx = (s.w / 2) * c + (s.d / 2) * n;
  const hz = (s.w / 2) * n + (s.d / 2) * c;
  return { x0: s.cx - hx, x1: s.cx + hx, z0: s.cz - hz, z1: s.cz + hz, top: s.y + s.h };
}

/** Bounding box of a set of parts, metres on a `w` by `d` footprint. */
export function partsBounds(parts: readonly BlueprintPart[], w: number, d: number): Bounds & { y0: number } {
  const out = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, top: -Infinity, y0: Infinity };
  for (const p of parts) {
    const b = boundsOf(solid(p, w, d));
    out.x0 = Math.min(out.x0, b.x0);
    out.x1 = Math.max(out.x1, b.x1);
    out.z0 = Math.min(out.z0, b.z0);
    out.z1 = Math.max(out.z1, b.z1);
    out.top = Math.max(out.top, b.top);
    out.y0 = Math.min(out.y0, p.y);
  }
  return out;
}

/** The parts-only pass: the authored parts followed by trim. Openings stay on the wall face. */
export function dressParts(parts: BlueprintPart[], ctx: DressContext): BlueprintPart[] {
  return dress(parts, ctx, false).parts;
}

/**
 * The full pass: trim as parts, plus the openings to cut, the roofs to build as slabs and the oriented
 * members to lay. Everything together stays within the part budget of ctx.quality.
 */
export function dressBuilding(parts: BlueprintPart[], ctx: DressContext): Dressed {
  return dress(parts, ctx, true);
}

function dress(parts: BlueprintPart[], ctx: DressContext, deep: boolean): Dressed {
  const W = ctx.w;
  const D = ctx.d;
  const cap = ctx.quality === undefined ? MAX_DRESSED_PARTS : PART_BUDGET[ctx.quality];
  const fine = ctx.quality !== 0;
  const openings: Opening[] = [];
  const shells: RoofShell[] = [];
  const hidden: number[] = [];
  if (parts.length === 0 || parts.length >= cap || !(W > 0) || !(D > 0)) return { parts, openings, struts: [], roofs: shells, hidden };
  const limit = partsBounds(parts, W, D);
  const extras: Extra[] = [];
  const wear = Math.min(1, Math.max(0, ctx.surfaces.wear));
  const rng = ctx.rng;

  /** Adds a part given in metres in the frame of `s`: `lx`/`lz` offset its centre along the solid's own axes. */
  const add = (
    shape: PartShape, s: Solid, lx: number, lz: number, y: number, w: number, d: number, h: number,
    tone: PartTone, rank: number, o: AddOpts = {},
  ): boolean => {
    if (!(w > 0.005) || !(d > 0.005) || !(h > 0.005) || !(y >= 0)) return false;
    const q: Solid = { ...s, cx: s.cx + lx * s.cos + lz * s.sin, cz: s.cz - lx * s.sin + lz * s.cos, y, w, d, h };
    const b = boundsOf(q);
    const reach = o.reach ?? REACH;
    const rise = o.rise ?? REACH;
    if (b.x0 < limit.x0 - reach || b.x1 > limit.x1 + reach || b.z0 < limit.z0 - reach || b.z1 > limit.z1 + reach || b.top > limit.top + rise) return false;
    extras.push({
      part: { shape, x: q.cx / W, z: q.cz / D, y, w: w / W, d: d / D, h, rot: s.rot, tone, repeat: 1, gap: 0 },
      strut: null, rank, loose: o.loose === true, size: w * d * h,
    });
    return true;
  };

  /** Lays a member between two points given along the axes of `s`. Only the full pass can draw one. */
  const brace = (
    s: Solid, lx0: number, lz0: number, y0: number, lx1: number, lz1: number, y1: number, w: number, t: number, tone: PartTone, rank: number,
  ): void => {
    if (!deep || !(y0 >= 0) || !(y1 >= 0)) return;
    const [ax, az] = toWorld(s, lx0, lz0);
    const [bx, bz] = toWorld(s, lx1, lz1);
    const len = Math.hypot(bx - ax, y1 - y0, bz - az);
    if (!(len > 0.08) || !Number.isFinite(len)) return;
    if (Math.min(ax, bx) < limit.x0 - REACH_FAR || Math.max(ax, bx) > limit.x1 + REACH_FAR || Math.min(az, bz) < limit.z0 - REACH_FAR
      || Math.max(az, bz) > limit.z1 + REACH_FAR || Math.max(y0, y1) > limit.top + RISE) return;
    extras.push({ part: null, strut: { ax, ay: y0, az, bx, by: y1, bz, w, t, tone }, rank, loose: false, size: w * t * len });
  };

  /** Records a stain on the face of `s` that looks along its local z (`side` 1 or -1) or local x (`axis` 'x'). */
  const stain = (s: Solid, axis: 'x' | 'z', side: number, along: number, y: number, w: number, h: number, kind: Stain['kind']): void => {
    if (!ctx.stains || !(w > 0.05) || !(h > 0.12)) return;
    const lx = axis === 'x' ? side * (s.w / 2 + 0.006) : along;
    const lz = axis === 'z' ? side * (s.d / 2 + 0.006) : along;
    ctx.stains.push({
      x: s.cx + lx * s.cos + lz * s.sin, z: s.cz - lx * s.sin + lz * s.cos, y, w, h: Math.min(h, y - 0.02),
      rot: s.rot + (axis === 'z' ? (side > 0 ? 0 : 180) : side > 0 ? 90 : -90), kind,
    });
  };

  const family = surfaceFamily(ctx.surfaces.wall);
  const grown = family === 'organic' || family === 'mineral';
  const industrial = family === 'metal' || family === 'glass';
  // What the frame of the building is made of, as a tone: dark timber on rendered and metal walls,
  // dressed trim on masonry and boarded ones.
  const frameTone: PartTone = family === 'render' || industrial || family === 'fabric' ? 'dark' : 'trim';
  const postSize = family === 'masonry' ? 0.4 : industrial || family === 'fabric' ? 0.1 : 0.18;
  const kindOf = (tone: PartTone): SurfaceKind => (tone === 'wall2' ? ctx.surfaces.wall2 : tone === 'trim' ? ctx.surfaces.trim : ctx.surfaces.wall);
  const far = { reach: REACH_FAR, rise: RISE };

  // Walls an opening can be cut into, and the part of each face already spoken for.
  const walls: WallRef[] = [];
  parts.forEach((p, i) => {
    if (p.shape !== 'box' || (p.tone !== 'wall' && p.tone !== 'wall2' && p.tone !== 'trim' && p.tone !== 'accent') || p.h < 1) return;
    const s = solid(p, W, D);
    if (Math.min(s.w, s.d) >= 0.3) walls.push({ i, p, s, faces: [faceOf(s, 0), faceOf(s, 1), faceOf(s, 2), faceOf(s, 3)] });
  });
  const taken = new Map<string, Rect[]>();
  const rectsOn = (wall: number, face: Face): Rect[] => {
    const key = `${wall}:${face}`;
    let list = taken.get(key);
    if (!list) {
      list = [];
      taken.set(key, list);
    }
    return list;
  };
  const reserve = (wall: number, face: Face, r: Rect): boolean => {
    const list = rectsOn(wall, face);
    if (list.some((o) => o.u0 < r.u1 + 0.08 && o.u1 > r.u0 - 0.08 && o.v0 < r.v1 + 0.08 && o.v1 > r.v0 - 0.08)) return false;
    list.push(r);
    return true;
  };
  /** Whether a stretch of a face, widened a little, meets an opening. */
  const busy = (wall: number, face: Face, u0: number, u1: number): boolean => rectsOn(wall, face).some((o) => o.u0 < u1 + 0.12 && o.u1 > u0 - 0.12);
  /** Depth of an opening in a wall of this surface and thickness: a little different on every building. */
  const depthJitter = deep ? 0.92 + 0.16 * rng.next() : 1;
  const revealFor = (kind: SurfaceKind, thick: number): number => Math.min(clamp(revealDepth(kind) * depthJitter, 0.12, 0.35), thick * 0.45);
  /** Whether another part stands in the space a recess `depth` deep would open behind this stretch of a face. */
  const obstructed = (wl: WallRef, fc: FaceRef, r: Rect, depth: number, self: number): boolean => {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as BlueprintPart;
      if (i === wl.i || i === self || p.tone === 'glass' || p.y >= wl.s.y + r.v1 - 0.02 || p.y + p.h <= wl.s.y + r.v0 + 0.02) continue;
      const q = solid(p, W, D);
      const c = Math.abs(q.cos * fc.F.cos + q.sin * fc.F.sin);
      const [u, z] = toLocal(fc.F, q.cx, q.cz);
      const round = Math.hypot(q.w, q.d) / 2;
      const hu = c >= 0.999 ? q.w / 2 : c <= 0.03 ? q.d / 2 : round;
      const hz = c >= 0.999 ? q.d / 2 : c <= 0.03 ? q.w / 2 : round;
      if (u + hu > r.u0 + 0.02 && u - hu < r.u1 - 0.02 && z - hz < -0.02 && z + hz > -depth - 0.02) return true;
    }
    return false;
  };
  /** Makes room for an opening beside or above those already on the face, narrowing it if it must; false if it cannot fit. */
  const fit = (wall: number, face: Face, r: Rect): boolean => {
    for (const o of rectsOn(wall, face)) {
      if (!(o.u0 < r.u1 + 0.08 && o.u1 > r.u0 - 0.08 && o.v0 < r.v1 + 0.08 && o.v1 > r.v0 - 0.08)) continue;
      const right = (r.u0 + r.u1) / 2 >= (o.u0 + o.u1) / 2;
      if (right && r.u1 - (o.u1 + 0.12) >= 0.35) r.u0 = o.u1 + 0.12;
      else if (!right && o.u0 - 0.12 - r.u0 >= 0.35) r.u1 = o.u0 - 0.12;
      else if (r.v1 - (o.v1 + 0.15) >= 0.4) r.v0 = o.v1 + 0.15;
      else return false;
    }
    return reserve(wall, face, r);
  };

  // The main body: the biggest wall mass standing on the ground.
  let body: BlueprintPart | null = null;
  let bodyVol = 0;
  for (const p of parts) {
    if ((p.shape !== 'box' && p.shape !== 'cylinder') || p.y > 0.3 || (p.tone !== 'wall' && p.tone !== 'wall2')) continue;
    const vol = p.w * W * p.d * D * p.h;
    if (vol > bodyVol && p.h >= 1.8) {
      body = p;
      bodyVol = vol;
    }
  }
  const bs = body ? solid(body, W, D) : null;
  const boxBody = body !== null && body.shape === 'box';
  const bodyWall = body ? walls.find((wl) => wl.p === body) ?? null : null;
  /** Whether a solid stands square to the body, and if so the body's middle and half-sizes along that solid's axes. */
  const bodyIn = (s: Solid): { lx: number; lz: number; hx: number; hz: number } | null => {
    if (!bs || !boxBody) return null;
    const c = Math.abs(bs.cos * s.cos + bs.sin * s.sin);
    if (c < 0.999 && c > 0.03) return null;
    const [lx, lz] = toLocal(s, bs.cx, bs.cz);
    return c >= 0.999 ? { lx, lz, hx: bs.w / 2, hz: bs.d / 2 } : { lx, lz, hx: bs.d / 2, hz: bs.w / 2 };
  };

  const plinthH = bs ? Math.min(0.45, Math.max(0.25, bs.h * 0.09)) : 0;
  if (body && bs && !grown) {
    const baseTone: PartTone = family === 'masonry' ? 'trim' : 'dark';
    add(body.shape, bs, 0, 0, bs.y, bs.w + 0.1, bs.d + 0.1, plinthH, baseTone, 0);
    // A footing course a step wider under the plinth.
    add(body.shape, bs, 0, 0, bs.y, bs.w + 0.16, bs.d + 0.16, 0.12, baseTone, 4);
    if (boxBody && Math.min(bs.w, bs.d) > 2) {
      const t = postSize;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) add('box', bs, sx * (bs.w / 2 - t / 2 + 0.03), sz * (bs.d / 2 - t / 2 + 0.03), bs.y, t, t, bs.h, frameTone, 1);
      }
    }
    if (family !== 'fabric') {
      let bands = 0;
      for (let y = bs.y + STOREY; y < bs.y + bs.h - 1.2 && bands < 4; y += STOREY, bands++) {
        add(body.shape, bs, 0, 0, y - 0.08, bs.w + 0.05, bs.d + 0.05, 0.16, frameTone, 3);
        // On metal the band is a bolted joint: a second flange a hand above the first.
        if (industrial) add(body.shape, bs, 0, 0, y + 0.13, bs.w + 0.09, bs.d + 0.09, 0.05, frameTone, 6);
      }
      // The plate the roof sits on; on a round masonry tower, a corbelled course under the roof.
      if (boxBody) add('box', bs, 0, 0, bs.y + bs.h - 0.12, bs.w + 0.04, bs.d + 0.04, 0.12, frameTone, 3);
      else if (family === 'masonry' || family === 'render') add('cylinder', bs, 0, 0, bs.y + bs.h - 0.3, bs.w + 0.16, bs.d + 0.16, 0.3, 'trim', 3);
    }
  }
  // Storeys above the body and wings beside it are framed at their corners the same way.
  const storeys = grown ? [] : walls
    .filter((wl) => wl.p !== body && (wl.p.tone === 'wall' || wl.p.tone === 'wall2') && Math.min(wl.s.w, wl.s.d) > 2 && wl.s.h >= 1.8)
    .slice(0, 4);
  for (const wl of storeys) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) add('box', wl.s, sx * (wl.s.w / 2 - postSize / 2 + 0.03), sz * (wl.s.d / 2 - postSize / 2 + 0.03), wl.s.y, postSize, postSize, wl.s.h, frameTone, 2);
    }
  }

  // Roofs: a fascia board under the roof edge, a shadow line under that; a sloping roof is laid as a slab
  // with its own thickness and eave, on rafter tails or a boxed soffit, with bargeboards at the verges.
  const roofs = parts
    .filter((p) => p.tone === 'roof' && p.y >= 1.5 && p.shape !== 'sphere' && p.shape !== 'ring' && p.shape !== 'arch' && Math.min(p.w * W, p.d * D) >= 1.5)
    .sort((a, b) => b.w * b.d - a.w * a.d)
    .slice(0, deep ? 6 : 4);
  const roofKind = ctx.surfaces.roof;
  const roofFamily = surfaceFamily(roofKind);
  const roofing = ROOFING[roofKind] ?? ROOFING_PLAIN;
  const guttered = !grown && family !== 'fabric' && roofFamily !== 'fabric' && roofFamily !== 'organic' && roofFamily !== 'mineral' && roofKind !== 'thatch';
  // Eaves are either open, on rafter tails, or boxed in with a soffit board: one way per building.
  const boxed = deep && (industrial || ((family === 'masonry' || family === 'render') && rng.chance(0.45)));
  roofs.forEach((r, index) => {
    if (grown) return;
    const s = solid(r, W, D);
    const round = r.shape === 'cone' || r.shape === 'dome' || r.shape === 'cylinder';
    const shape: PartShape = round ? 'cylinder' : 'box';
    add(shape, s, 0, 0, s.y - 0.16, s.w + 0.06, s.d + 0.06, 0.16, 'trim', 1);
    add(shape, s, 0, 0, s.y - 0.21, s.w + 0.02, s.d + 0.02, 0.05, 'dark', 4);
    const sloped = r.shape === 'gable' || r.shape === 'wedge';
    const shelled = deep && sloped && roofFamily !== 'organic' && roofFamily !== 'mineral';
    if (r.shape === 'gable' && !shelled) {
      const n = Math.min(7, Math.max(2, Math.floor(s.w / 0.9)));
      for (let i = 0; i < n; i++) {
        const lx = ((i + 0.5) / n - 0.5) * (s.w - 0.3);
        for (const sz of [-1, 1]) add('box', s, lx, sz * (s.d / 2 - 0.09), s.y - 0.28, 0.09, 0.28, 0.12, 'dark', 6, { loose: true });
      }
    }
    if (deep && index <= 1 && r.shape === 'pyramid' && roofing.cap > 0) {
      // Hip caps from the corners to the apex.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) brace(s, sx * s.w / 2, sz * s.d / 2, s.y + 0.03, 0, 0, s.y + s.h + 0.02, roofing.cap * 0.9, roofing.capRise + 0.03, roofing.capTone, 5);
      }
    }
    if (deep && fine && index === 0 && r.shape === 'dome') {
      // Ribs up the dome, in short straight lengths.
      const ribs = ctx.quality === 1 ? 6 : 8;
      const steps = 4;
      for (let j = 0; j < ribs; j++) {
        const a = (j / ribs) * Math.PI * 2;
        for (let k = 0; k < steps; k++) {
          const p0 = (k / steps) * 82 * RAD;
          const p1 = ((k + 1) / steps) * 82 * RAD;
          brace(
            s, Math.cos(a) * Math.cos(p0) * (s.w / 2 + 0.015), Math.sin(a) * Math.cos(p0) * (s.d / 2 + 0.015), s.y + s.h * Math.sin(p0),
            Math.cos(a) * Math.cos(p1) * (s.w / 2 + 0.015), Math.sin(a) * Math.cos(p1) * (s.d / 2 + 0.015), s.y + s.h * Math.sin(p1), 0.1, 0.06, 'trim', 7,
          );
        }
      }
    }
    if (!sloped || (index > 1 && !shelled)) return;
    // Eaves. A gable sheds to both sides of its ridge (local z), a lean-to to its low side (local -x).
    const gabled = r.shape === 'gable';
    const span = gabled ? s.d / 2 : s.w;
    const run = gabled ? s.w : s.d;
    const tan = s.h / span;
    const cos = span / Math.hypot(span, s.h);
    const eaves: { axis: 'x' | 'z'; side: number }[] = gabled ? [{ axis: 'z', side: -1 }, { axis: 'z', side: 1 }] : [{ axis: 'x', side: -1 }];
    let out = OVERHANG[roofKind] ?? 0.2;
    // How far the roofing hangs below the roof part's own eave line at its outer edge.
    let drop = 0.07;
    let verge = 0;
    if (shelled) {
      // Where the roof part already sails past the wall, the slab adds only a lip.
      const rel = bodyIn(s);
      let sail = 0;
      let sailEnd = 0;
      if (rel) {
        const across = gabled ? Math.min(s.d / 2 - rel.lz - rel.hz, s.d / 2 + rel.lz - rel.hz) : s.w / 2 + rel.lx - rel.hx;
        const ends = gabled ? Math.min(s.w / 2 - rel.lx - rel.hx, s.w / 2 + rel.lx - rel.hx) : Math.min(s.d / 2 - rel.lz - rel.hz, s.d / 2 + rel.lz - rel.hz);
        sail = Math.max(0, across);
        sailEnd = Math.max(0, ends);
      }
      out = clamp(out - sail, 0.06, Math.min(out, 0.4 / Math.max(0.05, tan)));
      verge = roofing.barge || roofing.edge === 'round' ? clamp(out * 0.7 - sailEnd * 0.5, 0.05, 0.3) : 0.04;
      // The underside of the slab lies this far below the roof part's own slope, measured plumb (see roofSlab).
      const stepped = roofing.edge === 'step';
      const tv = stepped ? 0.045 + (0.75 * roofing.thick) / cos : roofing.thick / cos;
      drop = (out + (stepped ? 0.05 : 0)) * tan + tv;
      shells.push({
        part: parts.indexOf(r), out, verge, thick: roofing.thick, edge: fine || roofing.edge !== 'wave' ? roofing.edge : 'plain',
        pitch: roofing.pitch, amp: roofing.amp, cap: gabled ? roofing.cap : 0, capRise: roofing.capRise, capTone: roofing.capTone,
        soffit: boxed ? 'trim' : 'dark',
      });
      if (index <= 1) {
        /** A point `ss` down the slope from the ridge line and `rr` along the eave, in the roof's own axes. */
        const at = (rr: number, ss: number, side: number): [number, number] => (gabled ? [rr, side * ss] : [s.w / 2 - ss, rr]);
        const under = (ss: number): number => s.y + (span - ss) * tan - tv;
        for (const e of eaves) {
          // Rafter tails under an open eave.
          if (!boxed && roofFamily !== 'fabric' && out >= 0.16) {
            const n = Math.min(10, Math.max(2, Math.round(run / 0.8)));
            for (let i = 0; i < n; i++) {
              const rr = ((i + 0.5) / n - 0.5) * (run - 0.24);
              const a = at(rr, span - 0.14, e.side);
              const b = at(rr, span + out - 0.035, e.side);
              brace(s, a[0], a[1], under(span - 0.14) - 0.06 / cos, b[0], b[1], under(span + out - 0.035) - 0.06 / cos, 0.07, 0.11, 'dark', 6);
            }
          }
          // The fascia board the gutter hangs from.
          if (roofing.fascia && (boxed || guttered)) {
            const c = at(0, span + out - 0.02, e.side);
            const len = run + 2 * verge;
            add('box', s, c[0], c[1], s.y - drop - 0.11, gabled ? len : 0.03, gabled ? 0.03 : len, 0.15, 'trim', 4, far);
          }
        }
        // Bargeboards under the verges.
        if (roofing.barge && verge >= 0.06) {
          const sides = gabled ? [-1, 1] : [1];
          for (const end of [-1, 1]) {
            for (const side of sides) {
              const rr = end * (run / 2 + verge - 0.02);
              const a = at(rr, 0.03, side);
              const b = at(rr, span + out - 0.02, side);
              const sink = (roofing.thick + 0.09) / cos;
              brace(s, a[0], a[1], s.y + (span - 0.03) * tan - sink, b[0], b[1], s.y - (out - 0.02) * tan - sink, 0.03, 0.17, 'trim', 5);
            }
          }
        }
      }
    }
    if (index > 1) return;
    for (const e of eaves) {
      const half = e.axis === 'z' ? s.d / 2 : s.w / 2;
      const place = (off: number, y: number, across: number, h: number, tone: PartTone, rank: number, length = run + 0.12): boolean =>
        e.axis === 'z'
          ? add('box', s, 0, e.side * (half + off), y, length, across, h, tone, rank, { reach: REACH_FAR })
          : add('box', s, e.side * (half + off), 0, y, across, length, h, tone, rank, { reach: REACH_FAR });
      if (!shelled) {
        place(out / 2, s.y - 0.07, out, 0.09, 'roof', 2);
        place(out / 2, s.y - 0.13, out - 0.04, 0.06, 'trim', 5);
      }
      if (!guttered) continue;
      place(out + 0.055, s.y - drop - 0.08, 0.11, 0.1, 'dark', 5);
      // A downpipe at one end of each eave: it stands against the wall, and an offset under the soffit
      // carries the water back to it from the gutter.
      const end = (index + (e.side > 0 ? 1 : 0)) % 2 === 0 ? 1 : -1;
      const at = end * (run / 2 - 0.3);
      const gutterAt = half + out + 0.055;
      let wallAt = half - 0.07;
      if (bs && boxBody && Math.abs(Math.abs(bs.cos * s.cos + bs.sin * s.sin) - 1) < 0.01) {
        // The body's face on this side, measured in the roof's own frame.
        const rx = bs.cx - s.cx;
        const rz = bs.cz - s.cz;
        const centre = e.axis === 'z' ? rx * s.sin + rz * s.cos : rx * s.cos - rz * s.sin;
        wallAt = Math.min(gutterAt, e.side * centre + (e.axis === 'z' ? bs.d : bs.w) / 2 + 0.07);
      }
      const pipeTop = s.y - drop - 0.17;
      const piped = e.axis === 'z'
        ? add('cylinder', s, at, e.side * wallAt, 0.12, 0.09, 0.09, pipeTop - 0.12, 'dark', 6, { reach: REACH_FAR })
        : add('cylinder', s, e.side * wallAt, at, 0.12, 0.09, 0.09, pipeTop - 0.12, 'dark', 6, { reach: REACH_FAR });
      const offset = gutterAt - wallAt;
      if (piped && offset > 0.1) {
        if (e.axis === 'z') add('box', s, at, e.side * (wallAt + offset / 2), pipeTop - 0.04, 0.08, offset + 0.08, 0.08, 'dark', 7, { reach: REACH_FAR });
        else add('box', s, e.side * (wallAt + offset / 2), at, pipeTop - 0.04, offset + 0.08, 0.08, 0.08, 'dark', 7, { reach: REACH_FAR });
      }
      if (piped && bs && boxBody && Math.abs(Math.abs(bs.cos * s.cos + bs.sin * s.sin) - 1) < 0.01) {
        // Where the gutter overflows at its far end, the wall below is streaked.
        const sameAxis = e.axis;
        const reach = 0.6 + 1.6 * wear * rng.next();
        const span2 = sameAxis === 'z' ? bs.w : bs.d;
        stain(bs, sameAxis, e.side, -end * (span2 / 2 - 0.5), bs.y + bs.h - 0.02, 0.5 + 0.5 * rng.next(), reach, 'stain');
      }
    }
  });

  // Door: find the wall face behind doorX. Where that wall is a box the doorway is cut into it: a recess
  // with a frame, a leaf of boards or panels hung at the back (sometimes ajar on a dark room), a threshold.
  // Otherwise a leaf is hung on the face, framed, with a step.
  if (ctx.doorX !== undefined && Number.isFinite(ctx.doorX)) {
    const dx = Math.min(0.4, Math.max(-0.4, ctx.doorX)) * W;
    let face = -Infinity;
    for (const p of parts) {
      if (p.tone === 'glass' || p.tone === 'roof' || p.tone === 'glow' || p.y > 0.3 || p.h < 1.8) continue;
      const b = boundsOf(solid(p, W, D));
      if (b.x1 - b.x0 >= 1 && dx > b.x0 + 0.3 && dx < b.x1 - 0.3 && b.z1 > face) face = b.z1;
    }
    if (face > 0) {
      const wallFace = face;
      let dw: number = DOOR.w;
      let dh: number = DOOR.h;
      let leaf = false;
      let leafIndex = -1;
      let leafTone: PartTone = 'dark';
      let cuttable = true;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i] as BlueprintPart;
        if (p.tone === 'wall' || p.tone === 'wall2' || p.tone === 'roof' || p.y > 0.3 || p.h < 1.6 || p.h > 3.2) continue;
        const b = boundsOf(solid(p, W, D));
        const bw = b.x1 - b.x0;
        if (bw >= 0.6 && bw <= 2.4 && dx > b.x0 && dx < b.x1 && b.z1 >= face - 0.06 && b.z1 <= face + 0.3) {
          leaf = true;
          dw = bw;
          dh = b.top;
          face = Math.max(face, b.z1);
          leafIndex = i;
          leafTone = p.tone;
          // Only a plain slab can be swapped for a leaf in a recess; a portal or a porch stays as authored.
          cuttable = p.shape === 'box' && b.z1 - b.z0 <= 0.5;
        }
      }
      // The floor of the doorway clears anything low that runs across in front of the wall.
      let sillY = 0.12;
      for (const p of parts) {
        if (p.y > 0.05 || p.h >= 0.6) continue;
        const b = boundsOf(solid(p, W, D));
        if (dx > b.x0 && dx < b.x1 && b.z1 > wallFace + 0.01 && b.z0 < wallFace) sillY = Math.max(sillY, b.top);
      }
      let seat: Seat | null = null;
      for (const wl of walls) {
        if (seat || !cuttable || wl.s.y > 0.3) continue;
        for (const f of FACES) {
          const fc = wl.faces[f];
          if (fc.F.cos < 0.999 || Math.abs(fc.F.cz - wallFace) > 0.04 || fc.T < 0.5) continue;
          const u = dx - fc.F.cx;
          const v0 = Math.max(0.02, sillY - wl.s.y);
          const v1 = Math.min(wl.s.h - 0.12, Math.max(dh, sillY + 1.95) - wl.s.y);
          if (Math.abs(u) + dw / 2 > fc.A / 2 - 0.12 || v1 - v0 < 1.5) continue;
          const at: Seat = { wl, face: f, fc, u0: u - dw / 2, u1: u + dw / 2, v0, v1 };
          if (obstructed(wl, fc, at, revealFor(kindOf(wl.p.tone), fc.T), leafIndex)) continue;
          seat = at;
          break;
        }
      }
      if (seat) reserve(seat.wl.i, seat.face, seat);
      const front: Solid = { cx: dx, cz: face, y: 0, w: 1, d: 1, h: 1, rot: 0, cos: 1, sin: 0 };
      if (deep && seat) {
        const { wl, fc } = seat;
        const F = fc.F;
        const u = (seat.u0 + seat.u1) / 2;
        const kind = kindOf(wl.p.tone);
        const fam = surfaceFamily(kind);
        const wild = fam === 'organic' || fam === 'mineral';
        const metal = fam === 'metal' || fam === 'glass';
        const r = revealFor(kind, fc.T);
        const roomMax = obstructed(wl, fc, seat, r + 1, leafIndex) ? 0 : Math.min(1, fc.T - r - 0.1);
        const glazed = leaf && leafTone === 'glass';
        const ajar = !wild && !glazed && roomMax >= 0.4 && rng.chance(0.3);
        const fTone: PartTone = fam === 'render' || metal || fam === 'fabric' ? 'dark' : 'trim';
        openings.push({
          wall: wl.i, face: seat.face, u0: seat.u0, u1: seat.u1, v0: seat.v0, v1: seat.v1, depth: r, kind: 'door', fill: glazed ? 'glass' : 'dark',
          frame: wild ? null : fTone, frameWidth: 0.07, sill: 0, room: wild || ajar ? Math.max(0, roomMax) : 0, glow: rng.next(),
        });
        if (leafIndex >= 0) hidden.push(leafIndex);
        const y0 = wl.s.y + seat.v0;
        const high = seat.v1 - seat.v0;
        if (!wild) {
          const fw = 0.07;
          const iu0 = seat.u0 + fw;
          const iu1 = seat.u1 - fw;
          const lh = high - fw - 0.01;
          const ly = y0 + 0.005;
          const double = dw > 1.5;
          const count = double ? 2 : 1;
          const swung = rng.int(0, count - 1);
          const angle = rng.range(15, 60);
          const style = leafTone === 'glow' ? 'plain' : metal ? 'slab' : rng.chance(0.55) ? 'planks' : 'panels';
          const single = rng.chance(0.5) ? -1 : 1;
          for (let k = 0; k < count && !glazed; k++) {
            const lw = (iu1 - iu0) / count - 0.004;
            const hinge = double ? (k === 0 ? -1 : 1) : single;
            const a = ajar && k === swung ? angle : 0;
            const dirX = -hinge * Math.cos(a * RAD);
            const dirZ = -Math.sin(a * RAD);
            // The leaf's own frame: local x runs from the hinge to the free edge.
            const L = frameAt(F, (hinge < 0 ? iu0 : iu1) + (dirX * lw) / 2, -r + (dirZ * lw) / 2, hinge < 0 ? a : 180 - a);
            const zs = hinge < 0 ? 1 : -1;
            if (style === 'planks') {
              const n = clamp(Math.round(lw / 0.19), 3, 6);
              for (let i = 0; i < n; i++) add('box', L, ((i + 0.5) / n - 0.5) * lw, 0, ly, lw / n - 0.006, 0.045, lh, leafTone, 1);
              for (const t of [0.12, 0.5, 0.86]) add('box', L, 0, zs * 0.032, ly + lh * t - 0.05, lw - 0.06, 0.02, 0.1, leafTone, 6);
              for (const t of [0.15, 0.82]) add('box', L, -lw / 2 + 0.15, zs * 0.045, ly + lh * t, 0.28, 0.008, 0.045, leafTone === 'dark' ? 'trim' : 'dark', 8);
            } else {
              add('box', L, 0, 0, ly, lw, 0.045, lh, leafTone, 1);
              if (style === 'panels') {
                const cols = lw > 0.75 ? 2 : 1;
                for (const [a0, a1] of [[0.08, 0.42], [0.5, 0.93]] as const) {
                  for (let c = 0; c < cols; c++) add('box', L, ((c + 0.5) / cols - 0.5) * lw, zs * 0.027, ly + lh * a0, lw / cols - 0.14, 0.012, lh * (a1 - a0), leafTone, 7);
                }
              } else if (style === 'slab') {
                add('box', L, 0, zs * 0.03, ly + lh * 0.5, lw, 0.016, 0.07, leafTone, 7);
                add('box', L, 0, zs * 0.026, ly + 0.02, lw - 0.04, 0.008, 0.26, 'trim', 8);
              }
            }
            if (style !== 'plain') add('box', L, lw / 2 - 0.09, zs * 0.045, ly + 0.95, 0.035, 0.05, 0.16, leafTone === 'dark' ? 'trim' : 'dark', 8);
          }
          // Architrave on the wall face, and a threshold board on the floor of the recess.
          if (!metal && fam !== 'fabric') {
            for (const sx of [-1, 1]) add('box', F, u + sx * (dw / 2 + 0.05), 0.0125, y0, 0.1, 0.025, high, 'trim', 3);
            if (fam === 'masonry') add('box', F, u, -0.013, y0 + high, dw + 0.36, 0.05, 0.2, 'trim', 3, { loose: true });
            else add('box', F, u, 0.015, y0 + high, dw + 0.3, 0.03, 0.12, 'trim', 3, { loose: true });
          }
          add('box', F, u, -r / 2 + 0.01, y0, dw - 0.02, r + 0.02, 0.03, fam === 'masonry' ? 'trim' : 'dark', 4);
        }
        const out = Math.min(0.42, limit.z1 + REACH - 0.005 - wallFace);
        if (out >= 0.06 && !wild) add('box', { ...front, cz: wallFace }, 0, out / 2 - 0.03, 0, dw + 0.5, out + 0.06, Math.min(0.14, sillY), family === 'masonry' ? 'trim' : 'dark', 3);
      } else {
        if (!leaf) add('box', front, 0, 0.01, 0, dw, 0.06, dh, 'dark', 1);
        for (const sx of [-1, 1]) add('box', front, sx * (dw / 2 + 0.05), 0.02, 0, 0.1, 0.1, dh + 0.02, 'trim', 2);
        add('box', front, 0, 0.02, dh, dw + 0.36, 0.12, 0.14, 'trim', 2, { loose: true });
        const out = Math.min(0.42, limit.z1 + REACH - 0.005 - face);
        if (out >= 0.06) add('box', front, 0, out / 2 - 0.03, 0, dw + 0.5, out + 0.06, 0.14, family === 'masonry' ? 'trim' : 'dark', 3);
      }
    }
  }

  // Windows. Every thin glass slab that lies on the face of a box wall is seated in it: the pass that
  // meshes the building cuts a recess there with reveals, a sloped sill and a frame, and sets the glazing
  // at the back. What goes with it depends on the wall and on the building: glazing bars, a sill board
  // and lintel, shutters, iron bars, blinds or curtains, boards across it when the place is far gone.
  const seats = new Map<number, Seat>();
  const hiddenNow = new Set(hidden);
  parts.forEach((p, i) => {
    if (p.tone !== 'glass' || p.shape !== 'box' || p.h < 0.4 || hiddenNow.has(i)) return;
    const g = solid(p, W, D);
    let best: Seat | null = null;
    let bestGap = Infinity;
    for (const wl of walls) {
      for (const f of FACES) {
        const fc = wl.faces[f];
        const c = Math.abs(g.cos * fc.F.cos + g.sin * fc.F.sin);
        if (c < 0.999 && c > 0.03) continue;
        const along = c >= 0.999 ? g.w : g.d;
        const through = c >= 0.999 ? g.d : g.w;
        if (through > 0.45 || along < 0.35 || through >= along || fc.T < 0.3) continue;
        const [u, z] = toLocal(fc.F, g.cx, g.cz);
        const gap = Math.abs(z);
        if (gap > through / 2 + 0.25 || gap >= bestGap || Math.abs(u) + along / 2 > fc.A / 2 - 0.1) continue;
        const v0 = Math.max(0, g.y - wl.s.y);
        const v1 = Math.min(g.y + g.h - wl.s.y, wl.s.h - 0.08);
        if (g.y - wl.s.y < -0.02 || v1 - v0 < 0.4) continue;
        best = { wl, face: f, fc, u0: u - along / 2, u1: u + along / 2, v0, v1 };
        bestGap = gap;
      }
    }
    if (!best) return;
    if (!deep) {
      if (reserve(best.wl.i, best.face, best)) seats.set(i, best);
    } else if (!obstructed(best.wl, best.fc, best, revealFor(kindOf(best.wl.p.tone), best.fc.T), i)) {
      // A pane that cannot be fitted beside the door or its neighbours is left out: it would stand across them.
      if (fit(best.wl.i, best.face, best)) seats.set(i, best);
      else hidden.push(i);
    }
  });
  const dropped = new Set(hidden);

  // One way of dressing windows per building.
  const era = clamp(ctx.era ?? (industrial ? 0.85 : family === 'masonry' ? 0.3 : family === 'fabric' ? 0.5 : 0.4), 0, 1);
  const treat = {
    paneW: (0.3 + 1.2 * era * era) * (deep ? rng.range(0.8, 1.25) : 1),
    paneH: 0.42 + 1.9 * era * era,
    transom: deep && rng.chance(0.3),
    shutters: deep && !industrial && family !== 'fabric' && rng.chance(family === 'masonry' ? 0.35 : 0.5),
    grilles: deep && family === 'masonry' && rng.chance(0.15 + 0.25 * wear),
    blinds: deep && rng.chance(industrial ? 0.6 : 0.12),
    curtains: deep && !industrial && rng.chance(0.7),
    cloth: (deep ? rng.pick(['trim', 'wall2', 'accent'] as const) : 'trim') as PartTone,
    shutterTone: (deep ? rng.pick(['dark', 'accent', 'trim'] as const) : 'dark') as PartTone,
  };

  const seatWindow = (st: Seat, index: number): void => {
    const { wl, fc } = st;
    const F = fc.F;
    const kind = kindOf(wl.p.tone);
    const fam = surfaceFamily(kind);
    const wild = fam === 'organic' || fam === 'mineral';
    const metal = fam === 'metal' || fam === 'glass';
    const r = revealFor(kind, fc.T);
    const along = st.u1 - st.u0;
    const h = st.v1 - st.v0;
    const u = (st.u0 + st.u1) / 2;
    const y = wl.s.y + st.v0;
    const big = h > 3.5 || along > 4;
    const fTone: PartTone = fam === 'render' || metal || fam === 'fabric' ? 'dark' : 'trim';
    const fw = big ? 0.06 : 0.045;
    const fate = rng.next();
    const broken = !big && wear > 0.55 && fate < (wear - 0.55) * 0.5;
    const boarded = !big && !broken && wear > 0.5 && fate < (wear - 0.5) * 1.1;
    openings.push({
      wall: wl.i, face: st.face, u0: st.u0, u1: st.u1, v0: st.v0, v1: st.v1, depth: r, kind: 'window', fill: broken ? 'dark' : 'glass',
      frame: wild ? null : fTone, frameWidth: fw, sill: st.v0 > 0.05 ? Math.min(0.06, r * 0.3) : 0,
      room: broken && !obstructed(wl, fc, st, r + 0.6, index) ? Math.max(0, Math.min(0.6, fc.T - r - 0.1)) : 0, glow: rng.next(),
    });
    hidden.push(index);
    if (wild) return;
    /** A box on this window's axis: `front` is how far its outer face sits behind the wall face (negative: proud of it). */
    const m = (lu: number, yy: number, a: number, hh: number, t: number, front: number, tone: PartTone, rank: number, loose = false): boolean =>
      add('box', F, u + lu, -front - t / 2, yy, a, t, hh, tone, rank, { loose });
    if (!big && fam !== 'fabric') {
      // A sill board that throws water clear of the wall, and what carries the wall over the opening.
      if (st.v0 >= 0.3) m(0, y - (metal ? 0.025 : 0.05), along + 0.14, metal ? 0.025 : 0.05, Math.min(r, 0.12) + 0.05, -0.05, fam === 'masonry' ? 'trim' : fTone, 3, true);
      if (fam === 'masonry') m(0, y + h, along + 0.3, 0.16, 0.05, -0.012, 'trim', 5, true);
      else if (!metal) {
        m(0, y + h, along + 0.2, 0.09, 0.03, -0.03, 'trim', 5, true);
        for (const sx of [-1, 1]) m(sx * (along / 2 + 0.045), y, 0.09, h, 0.025, -0.025, 'trim', 7);
      }
    }
    const iw = along - 2 * fw;
    const ih = h - 2 * fw;
    if (!broken) {
      // Glazing bars a finger in front of the glass.
      const cols = big ? clamp(Math.round(along / 1.2), 1, 5) : clamp(Math.round(iw / treat.paneW), 1, 4);
      const rows = big ? clamp(Math.round(h / 1.5), 1, 3) : clamp(Math.round(ih / treat.paneH), 1, 4);
      const split = !big && treat.transom && ih > 1;
      const low = split ? ih * 0.68 : ih;
      for (let i = 1; i < cols; i++) m((i / cols - 0.5) * iw, y + fw, 0.03, low, 0.03, r - 0.035, fTone, 6);
      if (split) m(0, y + fw + low - 0.02, iw, 0.04, 0.035, r - 0.04, fTone, 6);
      else for (let i = 1; i < rows; i++) m(0, y + fw + (i / rows) * ih - 0.015, iw, 0.03, 0.03, r - 0.035, fTone, 7);
      if (!boarded && !big) {
        if (treat.blinds) {
          const down = rng.range(0.15, 0.95);
          m(0, y + fw + ih * (1 - down), iw, ih * down, 0.012, r - 0.02, 'trim', 7);
        } else if (treat.curtains && rng.chance(0.65)) {
          const cw = iw * rng.range(0.16, 0.42);
          for (const sx of [-1, 1]) m(sx * (iw / 2 - cw / 2), y + fw, cw, ih, 0.01, r - 0.014, treat.cloth, 8);
        }
      }
    }
    if (boarded) {
      const n = h > 1.3 ? 3 : 2;
      for (let i = 0; i < n; i++) m(rng.range(-0.04, 0.04), y + ((i + 0.5) / n) * h - 0.07 + rng.range(-0.05, 0.05), along + 0.2, 0.14, 0.025, -0.025, 'dark', 4, true);
    }
    if (big || fam === 'fabric') return;
    if (treat.grilles && y < 2.6) {
      const n = clamp(Math.round(along / 0.16) - 1, 2, 6);
      for (let i = 1; i <= n; i++) m((i / (n + 1) - 0.5) * along, y, 0.022, h, 0.022, r * 0.45, 'dark', 8);
    } else if (treat.shutters && !metal && !boarded && along <= 1.5 && h <= 2.2) {
      // A leaf each side on the wall face, where there is wall for it; one may have gone.
      const leafW = along / 2;
      const clear = (side: number): boolean => {
        const a0 = side < 0 ? st.u0 - leafW - 0.03 : st.u1 + 0.01;
        const a1 = a0 + leafW + 0.02;
        if (a0 < -fc.A / 2 + 0.05 || a1 > fc.A / 2 - 0.05) return false;
        return !rectsOn(wl.i, st.face).some((o) => o !== st && o.u0 < a1 && o.u1 > a0 && o.v0 < st.v1 && o.v1 > st.v0);
      };
      for (const side of [-1, 1]) {
        const gone = wear > 0.5 && rng.chance((wear - 0.5) * 0.6);
        if (!gone && clear(side)) m(side * (along / 2 + leafW / 2 + 0.01), y, leafW, h, 0.03, -0.03, treat.shutterTone, 6, true);
      }
    }
  };

  for (let index = 0; index < parts.length; index++) {
    const p = parts[index] as BlueprintPart;
    if (p.tone !== 'glass' || p.shape !== 'box') continue;
    const s = solid(p, W, D);
    const alongX = s.w >= s.d;
    const along = alongX ? s.w : s.d;
    const thick = alongX ? s.d : s.w;
    if (thick > 0.45 || along < 0.35 || s.h < 0.4) continue;
    const big = s.h > 3.5 || along > 4;
    const st = seats.get(index);
    if (deep && !st && dropped.has(index)) continue;
    if (deep && st) seatWindow(st, index);
    else {
      // On the face: a casing behind the slab, reveals at its sides and head, a sill, a lintel, glazing bars in front.
      /** A box sized along the pane, up it and through it, offset along the pane by `la`. */
      const pane = (la: number, y: number, a: number, h: number, t: number, tone: PartTone, rank: number, loose = false): void => {
        if (alongX) add('box', s, la, 0, y, a, t, h, tone, rank, { loose });
        else add('box', s, 0, la, y, t, a, h, tone, rank, { loose });
      };
      if (!big) {
        pane(0, Math.max(0, s.y - 0.07), along + 0.14, s.h + 0.14 - Math.max(0, 0.07 - s.y), thick > 0.06 ? thick - 0.03 : thick * 0.5, 'trim', 2);
        if (s.y >= 0.3) pane(0, s.y - 0.13, along + 0.26, 0.07, thick + 0.14, 'trim', 3, true);
        pane(0, s.y + s.h + 0.05, along + 0.2, 0.1, thick + 0.04, 'trim', 5, true);
        // Reveals: the glass sits back between jambs as deep as the wall is thick.
        if (!grown) {
          for (const sx of [-1, 1]) pane(sx * (along / 2 + 0.035), s.y - 0.06, 0.07, s.h + 0.11, thick + 0.12, frameTone, 4);
          pane(0, s.y + s.h - 0.01, along + 0.14, 0.07, thick + 0.12, frameTone, 4);
        }
      }
      const bars = big ? Math.min(4, Math.max(1, Math.round(along / 1.2) - 1)) : along > 1.8 ? 2 : 1;
      for (let i = 1; i <= bars; i++) pane((i / (bars + 1) - 0.5) * along, s.y, 0.045, s.h, thick + 0.03, 'trim', 4);
      const rails = big ? Math.min(2, Math.max(1, Math.round(s.h / 1.5) - 1)) : s.h > 0.9 ? 1 : 0;
      for (let i = 1; i <= rails; i++) pane(0, s.y + (rails === 1 ? 0.56 : i / (rails + 1)) * s.h, along, 0.045, thick + 0.03, 'trim', 4);
    }
    // Water runs off the ends of the sill and down the wall beneath: find the body face this pane is on.
    if (!big && bs && boxBody && s.y >= 0.7 && Math.abs(Math.abs(bs.cos * s.cos + bs.sin * s.sin) - 1) < 0.01) {
      const rx = s.cx - bs.cx;
      const rz = s.cz - bs.cz;
      const lx = rx * bs.cos - rz * bs.sin;
      const lz = rx * bs.sin + rz * bs.cos;
      const sameWay = Math.abs(bs.cos * s.cos + bs.sin * s.sin) > 0.99 ? alongX : !alongX;
      const length = Math.min(s.y - 0.2, (0.35 + 0.9 * wear) * (0.6 + 0.8 * rng.next()));
      if (sameWay && Math.abs(Math.abs(lz) - bs.d / 2) < thick / 2 + 0.12 && Math.abs(lx) < bs.w / 2) {
        stain(bs, 'z', Math.sign(lz) || 1, lx, s.y - 0.12, along + 0.2, length, 'stain');
      } else if (!sameWay && Math.abs(Math.abs(lx) - bs.w / 2) < thick / 2 + 0.12 && Math.abs(lz) < bs.d / 2) {
        stain(bs, 'x', Math.sign(lx) || 1, lz, s.y - 0.12, along + 0.2, length, 'stain');
      }
    }
  }

  // Balconies and awnings: thin slabs that sail past the front of the body get corbels beneath.
  if (body && bs) {
    const bb = boundsOf(bs);
    let done = 0;
    for (const p of parts) {
      if (done >= 3) break;
      if (p === body || p.shape !== 'box' || p.y < 1.8 || p.h > 0.45 || p.tone === 'glass' || p.tone === 'glow') continue;
      const b = boundsOf(solid(p, W, D));
      const sail = b.z1 - bb.z1;
      const width = b.x1 - b.x0;
      if (sail < 0.4 || width < 1.2 || b.z0 > bb.z1 + 0.1) continue;
      const depth = Math.min(0.5, sail * 0.6);
      const wall: Solid = { cx: (b.x0 + b.x1) / 2, cz: bb.z1, y: 0, w: 1, d: 1, h: 1, rot: 0, cos: 1, sin: 0 };
      const n = width > 3.5 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const lx = (i / (n - 1) - 0.5) * (width - 0.5);
        add('box', wall, lx, depth / 2 - 0.02, p.y - 0.28, 0.1, depth, 0.28, 'dark', 5, { loose: true });
      }
      done++;
    }
  }

  // What stands on the roof. A building that already has something tall and slim rising through its
  // roof line (a chimney, a mast, a spire) keeps that and gets nothing more.
  const top = roofs[0];
  if (top && !grown && family !== 'fabric') {
    const s = solid(top, W, D);
    const crown = s.y + s.h;
    const flat = top.shape === 'box' || top.shape === 'cylinder';
    const stacked = parts.some((p) => p !== top && p.tone !== 'roof' && p.y + p.h > crown - 0.3 && Math.max(p.w * W, p.d * D) < 1.6 && p.h > 1);
    const sx = rng.chance(0.5) ? 1 : -1;
    const sz = rng.chance(0.5) ? 1 : -1;
    const up = { rise: RISE, reach: REACH };
    if (!stacked && !industrial && (top.shape === 'gable' || top.shape === 'wedge' || flat)) {
      // A chimney, built of the masonry the building has, or a flue pipe where it has none.
      const stackTone: PartTone | null = surfaceFamily(ctx.surfaces.wall2) === 'masonry' ? 'wall2'
        : surfaceFamily(ctx.surfaces.trim) === 'masonry' ? 'trim' : family === 'masonry' || family === 'render' ? 'wall' : null;
      const lx = sx * 0.24 * s.w;
      const lz = top.shape === 'gable' ? sz * 0.16 * s.d : sz * 0.2 * s.d;
      const from = flat ? crown - 0.05 : Math.max(0, s.y - 0.2);
      const to = crown + (flat ? 1.0 : 0.7);
      if (stackTone) {
        if (add('box', s, lx, lz, from, 0.58, 0.58, to - from, stackTone, 4, up)) {
          add('box', s, lx, lz, to, 0.72, 0.72, 0.08, 'trim', 7, up);
          add('cylinder', s, lx - 0.12, lz, to + 0.08, 0.2, 0.2, 0.3, 'dark', 8, up);
          add('cylinder', s, lx + 0.14, lz, to + 0.08, 0.17, 0.17, 0.24, 'dark', 8, up);
        }
      } else if (add('cylinder', s, lx, lz, from, 0.2, 0.2, to - from + 0.2, 'dark', 4, up)) {
        add('cone', s, lx, lz, to + 0.2, 0.34, 0.34, 0.16, 'dark', 8, up);
      }
    }
    if (industrial) {
      if (flat) {
        // Plant on a flat roof: a housed unit on a frame, two cowled vents, a pipe run between them.
        const ux = sx * 0.2 * s.w;
        const uz = -0.15 * s.d;
        add('box', s, ux, uz, crown, 1.3, 0.8, 0.12, 'dark', 6, up);
        add('box', s, ux, uz, crown + 0.12, 1.2, 0.72, 0.78, 'wall2', 5, up);
        add('box', s, ux, uz + 0.37, crown + 0.3, 0.9, 0.03, 0.42, 'dark', 8, up);
        for (const k of [0, 1]) {
          const vx = -sx * (0.12 + 0.2 * k) * s.w;
          const vz = sz * 0.22 * s.d;
          if (add('cylinder', s, vx, vz, crown, 0.36, 0.36, 0.45 + 0.2 * k, 'dark', 6, up)) add('cone', s, vx, vz, crown + 0.5 + 0.2 * k, 0.52, 0.52, 0.16, 'dark', 8, up);
        }
        add('box', s, 0, sz * 0.22 * s.d - sz * 0.5, crown + 0.1, 0.55 * s.w, 0.1, 0.1, 'dark', 8, up);
        // A guard rail along the front edge.
        const n = Math.min(7, Math.max(2, Math.round(s.w / 1.6)));
        const fz = s.d / 2 - 0.08;
        for (let i = 0; i <= n; i++) add('box', s, (i / n - 0.5) * (s.w - 0.16), fz, crown, 0.05, 0.05, 1.05, 'dark', 9, up);
        add('box', s, 0, fz, crown + 1.0, s.w - 0.1, 0.05, 0.05, 'dark', 8, up);
        add('box', s, 0, fz, crown + 0.5, s.w - 0.1, 0.035, 0.035, 'dark', 9, up);
      } else if (top.shape === 'gable') {
        // A raised ridge vent.
        add('box', s, 0, 0, crown - 0.12, 0.55 * s.w, 0.5, 0.2, 'dark', 6, up);
        add('box', s, 0, 0, crown + 0.08, 0.6 * s.w, 0.7, 0.06, 'roof', 6, up);
      }
    }
  }

  // Services on a metal building: an access ladder on one side wall, pipes and a cable tray on the other.
  if (industrial && bs && boxBody && bs.h >= 3 && bs.d >= 3) {
    const side = rng.chance(0.5) ? 1 : -1;
    const wallX = bs.w / 2;
    // Ladder: two stiles standing 15 cm off the wall, rungs every 30 cm, stand-offs back to the wall.
    const lz0 = -0.22 * bs.d;
    const ladderH = bs.h + 0.9;
    for (const dz of [-0.22, 0.22]) add('box', bs, side * (wallX + 0.17), lz0 + dz, bs.y + 0.3, 0.05, 0.05, ladderH - 0.3, 'dark', 7, far);
    const rungs = Math.min(28, Math.floor((ladderH - 0.6) / 0.3));
    const pitch = (ladderH - 0.6) / rungs;
    for (let i = 0; i < rungs; i++) add('box', bs, side * (wallX + 0.17), lz0, bs.y + 0.5 + i * pitch, 0.03, 0.44, 0.03, 'dark', 9, far);
    for (const y of [bs.y + 0.8, bs.y + bs.h * 0.5, bs.y + bs.h - 0.3]) {
      for (const dz of [-0.22, 0.22]) add('box', bs, side * (wallX + 0.085), lz0 + dz, y, 0.17, 0.04, 0.04, 'dark', 10, far);
    }
    // Pipes: two risers of different bore, clipped to the wall every two metres, rust below the clips.
    const px = -side * (wallX + 0.11);
    const pz = 0.18 * bs.d;
    add('cylinder', bs, px, pz, bs.y, 0.14, 0.14, bs.h - 0.15, 'dark', 7, far);
    add('cylinder', bs, px + side * 0.02, pz + 0.26, bs.y, 0.09, 0.09, bs.h * 0.8, 'trim', 8, far);
    for (let y = bs.y + 1; y < bs.y + bs.h - 0.4; y += 2) {
      add('box', bs, -side * (wallX + 0.1), pz + 0.13, y, 0.2, 0.5, 0.05, 'dark', 9, far);
      stain(bs, 'x', -side, pz + 0.13, y, 0.42, 0.5 + 1.2 * wear * rng.next(), 'rust');
    }
    // Cable tray: a shallow channel along the wall above head height, on angle brackets.
    const ty = bs.y + Math.min(2.9, bs.h * 0.62);
    const tz = -0.12 * bs.d;
    const tl = 0.5 * bs.d;
    if (add('box', bs, -side * (wallX + 0.12), tz, ty, 0.2, tl, 0.07, 'dark', 8, far)) {
      for (const k of [-1, 0, 1]) add('box', bs, -side * (wallX + 0.1), tz + k * (tl / 2 - 0.15), ty - 0.16, 0.2, 0.04, 0.16, 'dark', 10, far);
      stain(bs, 'x', -side, tz + tl / 2 - 0.15, ty - 0.16, 0.3, 0.4 + wear * rng.next(), 'rust');
    }
  }

  // A flat roof gets a parapet with a coping: on the roof part, or on the body itself where nothing covers it.
  if (!grown && !industrial && family !== 'fabric') {
    const flatTop = roofs[0] && roofs[0].shape === 'box' ? roofs[0] : null;
    const bare = !flatTop && roofs.length === 0 && body !== null && boxBody && bs !== null
      && !parts.some((p) => p !== body && p.y + p.h > bs.y + bs.h + 0.3 && p.w * W * p.d * D > 0.2 * bs.w * bs.d);
    const under = flatTop ?? (bare ? body : null);
    if (under) {
      const s = solid(under, W, D);
      const crown = s.y + s.h;
      const t = family === 'masonry' || family === 'render' ? 0.22 : 0.1;
      const hp = 0.35 + 0.45 * rng.next();
      const up = { rise: RISE, reach: REACH };
      if (Math.min(s.w, s.d) > 2.4) {
        for (const sz of [-1, 1]) {
          add('box', s, 0, sz * (s.d / 2 - t / 2), crown, s.w, t, hp, 'wall', 3, up);
          add('box', s, 0, sz * (s.d / 2 - t / 2), crown + hp, s.w + 0.06, t + 0.06, 0.06, 'trim', 6, up);
        }
        for (const sx of [-1, 1]) {
          add('box', s, sx * (s.w / 2 - t / 2), 0, crown, t, s.d - 2 * t, hp, 'wall', 3, up);
          add('box', s, sx * (s.w / 2 - t / 2), 0, crown + hp, t + 0.06, s.d - 2 * t, 0.06, 'trim', 6, up);
        }
      }
    }
  }

  // Posts carry something: a cap where each meets its load, a beam from post to post, knee braces both ways.
  if (!grown) {
    interface Post { s: Solid; top: number; load: number; lx: number; lz: number }
    const posts: Post[] = [];
    const loads = new Map<number, Solid>();
    for (const p of parts) {
      if (posts.length >= 10) break;
      if ((p.shape !== 'box' && p.shape !== 'cylinder') || p.h < 1.2 || p.tone === 'glass' || p.tone === 'glow' || p.tone === 'roof') continue;
      const s = solid(p, W, D);
      if (Math.max(s.w, s.d) > 0.5) continue;
      const top = s.y + s.h;
      let load = -1;
      let area = 0;
      parts.forEach((q, j) => {
        if (q === p || q.y < top - 0.3 || q.y > top + 0.15 || (q.shape !== 'box' && q.shape !== 'gable' && q.shape !== 'wedge')) return;
        const qs = solid(q, W, D);
        const [lx, lz] = toLocal(qs, s.cx, s.cz);
        if (Math.max(qs.w, qs.d) < 1.2 || Math.abs(lx) > qs.w / 2 + 0.1 || Math.abs(lz) > qs.d / 2 + 0.1 || qs.w * qs.d <= area) return;
        load = j;
        area = qs.w * qs.d;
        loads.set(j, qs);
      });
      const ls = loads.get(load);
      if (!ls) continue;
      const [lx, lz] = toLocal(ls, s.cx, s.cz);
      posts.push({ s, top, load, lx, lz });
    }
    const tone: PartTone = industrial ? 'dark' : frameTone;
    for (const post of posts) {
      const ls = loads.get(post.load) as Solid;
      const size = Math.max(post.s.w, post.s.d);
      add('box', post.s, 0, 0, Math.max(0, ls.y - 0.09), size + 0.12, size + 0.12, 0.09, tone, 7);
      // Braces along the longer way of what is carried, where it reaches that far.
      const longX = ls.w >= ls.d;
      const reach = Math.min(0.7, post.s.h * 0.28);
      for (const dir of [-1, 1]) {
        const hx = post.lx + (longX ? dir * reach : 0);
        const hz = post.lz + (longX ? 0 : dir * reach);
        if (Math.abs(hx) > ls.w / 2 || Math.abs(hz) > ls.d / 2) continue;
        brace(ls, post.lx, post.lz, ls.y - reach, hx, hz, ls.y - 0.02, 0.07, 0.08, tone, 6);
      }
    }
    // Beams: between neighbouring posts under the same load that stand in a row.
    for (const [load, ls] of loads) {
      const row = posts.filter((p) => p.load === load);
      for (const alongX of [true, false]) {
        const sorted = row.slice().sort((a, b) => (alongX ? a.lx - b.lx : a.lz - b.lz));
        for (let i = 0; i + 1 < sorted.length; i++) {
          const a = sorted[i] as Post;
          for (let j = i + 1; j < sorted.length; j++) {
            const b = sorted[j] as Post;
            const gap = alongX ? b.lx - a.lx : b.lz - a.lz;
            const off = alongX ? Math.abs(b.lz - a.lz) : Math.abs(b.lx - a.lx);
            if (off > 0.2 || gap < 0.8) continue;
            if (gap <= 7 && ls.y >= 0.17) {
              if (alongX) add('box', ls, (a.lx + b.lx) / 2, a.lz, ls.y - 0.16, gap + 0.2, 0.1, 0.16, tone, 4, far);
              else add('box', ls, a.lx, (a.lz + b.lz) / 2, ls.y - 0.16, 0.1, gap + 0.2, 0.16, tone, 4, far);
            }
            break;
          }
        }
      }
    }
  }

  // Decks: under a thin slab that sails clear of the body, edge beams and joists.
  if (!grown) {
    /** The wall mass a slab rests on, as its middle and half-sizes along the slab's own axes. */
    const massUnder = (s: Solid): { lx: number; lz: number; hx: number; hz: number } | null => {
      let best: { lx: number; lz: number; hx: number; hz: number } | null = null;
      let area = 0;
      for (const wl of walls) {
        const q = wl.s;
        if (q.y > s.y - 0.1 || q.y + q.h < s.y - 0.25 || q.w * q.d <= area) continue;
        const c = Math.abs(q.cos * s.cos + q.sin * s.sin);
        if (c < 0.999 && c > 0.03) continue;
        const [lx, lz] = toLocal(s, q.cx, q.cz);
        const hx = c >= 0.999 ? q.w / 2 : q.d / 2;
        const hz = c >= 0.999 ? q.d / 2 : q.w / 2;
        if (Math.abs(lx) >= hx + s.w / 2 || Math.abs(lz) >= hz + s.d / 2) continue;
        best = { lx, lz, hx, hz };
        area = q.w * q.d;
      }
      return best;
    };
    const decks = parts
      .filter((p) => p !== body && !roofs.includes(p) && p.shape === 'box' && p.h <= 0.45 && p.y >= 0.6 && p.tone !== 'glass' && p.tone !== 'glow' && Math.min(p.w * W, p.d * D) >= 1 && Math.max(p.w * W, p.d * D) >= 1.6)
      .sort((a, b) => b.w * b.d - a.w * a.d)
      .slice(0, 3);
    for (const deck of decks) {
      const s = solid(deck, W, D);
      // The part of the slab that shows from below: the widest strip outside the body, or all of it.
      let x0 = -s.w / 2;
      let x1 = s.w / 2;
      let z0 = -s.d / 2;
      let z1 = s.d / 2;
      const rel = massUnder(s);
      if (rel) {
        const strips = [
          { x0, x1, z0: Math.max(z0, rel.lz + rel.hz), z1 },
          { x0, x1, z0, z1: Math.min(z1, rel.lz - rel.hz) },
          { x0: Math.max(x0, rel.lx + rel.hx), x1, z0, z1 },
          { x0, x1: Math.min(x1, rel.lx - rel.hx), z0, z1 },
        ].filter((r) => r.x1 - r.x0 >= 0.4 && r.z1 - r.z0 >= 0.4);
        const bestStrip = strips.sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
        if (!bestStrip) continue;
        ({ x0, x1, z0, z1 } = bestStrip);
      }
      const lenX = x1 - x0;
      const lenZ = z1 - z0;
      const longX = lenX >= lenZ;
      const long = Math.max(lenX, lenZ);
      const short = Math.min(lenX, lenZ);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const tone: PartTone = industrial ? 'dark' : frameTone;
      for (const side of [-1, 1]) {
        const off = side * (short / 2 - 0.06);
        if (longX) add('box', s, cx, cz + off, s.y - 0.16, long, 0.09, 0.16, tone, 5, far);
        else add('box', s, cx + off, cz, s.y - 0.16, 0.09, long, 0.16, tone, 5, far);
      }
      const n = Math.min(8, Math.max(2, Math.round(long / 0.6)));
      for (let i = 0; i < n; i++) {
        const at = ((i + 0.5) / n - 0.5) * (long - 0.1);
        if (longX) add('box', s, cx + at, cz, s.y - 0.11, 0.05, short - 0.2, 0.11, tone, 8, far);
        else add('box', s, cx, cz + at, s.y - 0.11, short - 0.2, 0.05, 0.11, tone, 8, far);
      }
    }
  }

  // Tall masonry leans on stepped buttresses along its side walls; metal sheet is stiffened with ribs,
  // and a round tank stands on gussets.
  if (body && bs && bodyWall && family === 'masonry' && bs.h >= 8) {
    for (const f of FACES) {
      const fc = bodyWall.faces[f];
      // Not on the street front, and not where the wall is too short to need one.
      if (fc.F.cos > 0.7 || Math.abs(fc.F.sin) < 0.7 || fc.A < 3) continue;
      const count = clamp(Math.round(fc.A / 3.5) + 1, 2, 4);
      const h1 = bs.h * 0.55;
      const h2 = bs.h * 0.28;
      for (let i = 0; i < count; i++) {
        const u = (i / (count - 1) - 0.5) * (fc.A - 1);
        if (busy(bodyWall.i, f, u - 0.3, u + 0.3)) continue;
        if (!add('box', fc.F, u, 0.25, bs.y, 0.6, 0.5, h1, body.tone, 3, far)) continue;
        add('wedge', frameAt(fc.F, u, 0.25, 90), 0, 0, bs.y + h1, 0.5, 0.6, 0.45, 'trim', 5, far);
        add('box', fc.F, u, 0.13, bs.y + h1, 0.5, 0.26, h2, body.tone, 4, far);
        add('wedge', frameAt(fc.F, u, 0.13, 90), 0, 0, bs.y + h1 + h2, 0.26, 0.5, 0.32, 'trim', 6, far);
      }
    }
  }
  // Sheet walls are stiffened with ribs, and a round tank stands on gussets. A rendered wall may show its
  // timber frame instead: studs between the openings, a brace up from each corner.
  const framed = deep && family === 'render' && rng.chance(0.5);
  if (industrial || framed) {
    const ribbed = bodyWall ? [bodyWall, ...storeys] : storeys;
    ribbed.forEach((wl, k) => {
      const foot = wl === bodyWall ? plinthH : 0;
      const y0 = wl.s.y + foot;
      const high = wl.s.h - foot - 0.05;
      for (const f of FACES) {
        const fc = wl.faces[f];
        const n = clamp(Math.round(fc.A / (framed ? 1.5 : 2)) - 1, 1, 5);
        for (let i = 1; i <= n; i++) {
          const u = (i / (n + 1) - 0.5) * fc.A;
          if (busy(wl.i, f, u - 0.06, u + 0.06)) continue;
          if (framed) add('box', fc.F, u, 0.015, y0, 0.12, 0.03, high, 'dark', 5 + k);
          else add('box', fc.F, u, 0.028, y0, 0.07, 0.056, high, 'dark', 6);
        }
        if (!framed || fc.A < 3 || high < 2) continue;
        for (const side of [-1, 1]) {
          const u0 = side * (fc.A / 2 - postSize);
          const u1 = u0 - side * Math.min(1.1, fc.A * 0.2);
          if (!busy(wl.i, f, Math.min(u0, u1), Math.max(u0, u1))) brace(fc.F, u1, 0.015, y0 + 0.05, u0, 0.015, y0 + Math.min(high * 0.6, 1.9), 0.03, 0.12, 'dark', 6 + k);
        }
      }
    });
    if (industrial && body && bs && !bodyWall && body.shape === 'cylinder' && Math.abs(bs.w - bs.d) < 0.2 && bs.w > 1.5) {
      const n = fine ? 8 : 6;
      for (let k = 0; k < n; k++) add('wedge', frameAt(bs, 0, 0, (k / n) * 360 + 15), -(bs.w / 2 + 0.13), 0, bs.y, 0.3, 0.05, 0.5, 'dark', 7, far);
    }
  }

  // Old buildings settle: loose trim hangs a little out of true.
  if (wear > 0.5) {
    const amount = (wear - 0.5) * 2;
    for (const e of extras) {
      if (!e.loose || !e.part || !rng.chance(0.4)) continue;
      e.part.rot += rng.range(-1.5, 1.5) * amount;
      e.part.y = Math.max(0, e.part.y - rng.range(0, 0.02) * amount);
    }
  }

  // Keep the most structural additions; among equals, the larger ones. An opening stands in for the
  // slab it replaces, and a roof slab counts as three parts.
  extras.sort((a, b) => a.rank - b.rank || b.size - a.size);
  const spent = parts.length - hidden.length + openings.length + shells.length * 3;
  const kept = extras.slice(0, Math.max(0, cap - spent));
  const added: BlueprintPart[] = [];
  const struts: Strut[] = [];
  for (const e of kept) {
    if (e.part) added.push(e.part);
    else if (e.strut) struts.push(e.strut);
  }
  return { parts: parts.concat(added), openings, struts, roofs: shells, hidden };
}
