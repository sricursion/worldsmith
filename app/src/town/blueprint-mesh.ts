// Turns blueprints (lists of primitive parts, see world/spec.ts) into textured geometry in a GeoBatch.
// Every part is built with its base at y = 0 and centred on x/z, sized in metres, moved into the
// building's own frame (part offset and rotation), given box-projected UVs in metres there, and only
// then placed in the world. A plank is therefore the same size on a hut and on a hall, and courses
// stay level on a building that stands at an angle to the street. Geometry is non-indexed; flat-sided
// shapes carry face normals, round ones keep smooth normals. Each vertex also carries a colour: the
// building's own drift from the style colour, a small shift of value and warmth per part (no two boards
// or panels are quite alike), darkened toward the ground where dirt and damp collect. Boxes carry a
// `wearing` attribute as well: the distance from each vertex to the four edges of its face, from which
// the surface shader draws worn edges, run-off and dirt (see patchSurfaceShader in surfaces.ts).
//
// Colours never go to the materials as the style gives them: they pass through groundedPalette first.
import * as THREE from 'three';
import type { Rng } from '../world/rng';
import { makeRng } from '../world/rng';
import { expandParts } from '../world/blueprints';
import type { Blueprint, BlueprintPart, MoodSpec, PartShape, PartTone, StyleSpec, SurfaceSet, ThemeId } from '../world/spec';
import type { GeoBatch, MaterialCache } from './batch';
import { DOOR, FACE_TURN, dressBuilding, dressParts, eraFromWords, partsBounds } from './detail';
import type { Dressed, DressContext, Face, Opening, RoofShell, Stain, Strut } from './detail';
import {
  GLASS_SCALE, WEARING, WEARING_FAR, getSurface, glassMaterial, groundRequests, groundTone, groundedPalette, resolveSurfaces, setSurfaceDefaults, signTone,
  stainMaterial, surfaceDefaults, surfaceFamily, surfaceScale, warmSurfaces,
} from './surfaces';
import type { Quality, SurfaceId, SurfaceRequest } from './surfaces';
import { projectWorldUV } from './surfaces/uv';
import { boxGeometry, contactShade, contactsOf, growthOf, organicGeometry, partSeed, roundSegments, shapeGeometries, solidOf } from './part-geometry';
import type { BoxDetail, Solid, V3 } from './part-geometry';

export { boxGeometry, shapeGeometries } from './part-geometry';
export type { BoxDetail } from './part-geometry';

export interface BlueprintEnv {
  batch: GeoBatch; mats: MaterialCache; rng: Rng;
  /** Where geometry that should not collide or feed the navmesh goes (stain decals). Defaults to `batch`. */
  visualBatch?: GeoBatch;
}
export interface BlueprintPlacement {
  x: number; z: number; rotY: number; w: number; d: number;
  /** Height of the ground line where the building stands, metres. Default 0. */
  y?: number;
}
export interface BlueprintResult { height: number; door: THREE.Vector3 }
/**
 * Optional look controls. What is left out follows surfaceDefaults(): the quality, theme and mood the
 * current town build last stated (see surfaces.ts), or quality 2 and 'medieval' before any build.
 */
export interface BlueprintOptions {
  /** 0 low (256 px maps, fewer sides, no bevels), 1 medium, 2 high (bevelled boxes). */
  quality?: Quality;
  /** Used with `mood` to infer surfaces when the style carries none. */
  theme?: ThemeId;
  mood?: MoodSpec;
  /** Texture seed; the same seed shares cached maps across towns. Default 0. */
  seed?: number;
  /** Set false to skip the architectural dressing pass. */
  dress?: boolean;
  /** A prop that grows or lies in the land: it takes bark, leaf and stone surfaces, not the building tones. */
  nature?: 'plant' | 'mineral';
  /**
   * Set false to keep the dressing flat: openings framed on the wall face and roofs as bare prisms.
   * By default windows and doors are cut into the wall as recesses, sloping roofs are laid as slabs
   * with an eave and a verge, and braces, rafter tails and rails are set as oriented members; how
   * much of the fine work is kept follows `quality` (see PART_BUDGET in detail.ts).
   */
  depth?: boolean;
  /**
   * Height of the floor above the ground line, metres (0..3). The building is raised on a foundation of
   * that height and a landing and flight of steps are laid from the door down to the ground; the door
   * point returned moves out to the foot of the steps. Default 0.
   */
  baseHeight?: number;
  /**
   * How far the foundation carries on below the ground line, metres (0..8), for a building seated on a
   * slope or a pad: the downhill side then shows wall instead of a gap. Default 0.
   */
  skirt?: number;
  /**
   * Tallest a part may stand or sit, metres. Default 30, the most a blueprint is authored at; the fabric of a
   * city passes more for buildings it has drawn up (see fabric.ts).
   */
  maxHeight?: number;
}

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const HEX = /^#[0-9a-f]{6}$/i;
const safeHex = (c: string, fallback: string): string => (HEX.test(c) ? c : fallback);
const UP = new THREE.Vector3(0, 1, 0);

/** Repeat expansion from world/blueprints, after dropping parts that carry non-finite numbers. */
export function expandBlueprintParts(parts: readonly BlueprintPart[]): BlueprintPart[] {
  return expandParts(parts.filter((p) => [p.x, p.z, p.y, p.w, p.d, p.h, p.rot, p.repeat, p.gap].every(Number.isFinite)));
}

/** Shapes whose curved faces keep the smooth normals they were built with. */
const SMOOTH: ReadonlySet<PartShape> = new Set<PartShape>(['cylinder', 'cone', 'dome', 'sphere', 'ring']);

/** Non-indexed geometry with normals: per face for flat-sided shapes, as built for round ones. */
function unindexed(g: THREE.BufferGeometry, smooth: boolean): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  if (!smooth || !n.getAttribute('normal')) n.computeVertexNormals();
  return n;
}

/** Which way the grain of each wooden surface runs in its texture. */
const GRAIN: Partial<Record<SurfaceId, 'u' | 'v'>> = { timber: 'u', log: 'u', planks: 'v', bark: 'v' };

interface ToneLook {
  material: THREE.Material;
  /** Metres per texture repeat. */
  tile: number;
  /** Texture axis the grain follows, for surfaces that have one. */
  grain?: 'u' | 'v';
  /** Linear colour multiplier for this building (colour drift). */
  tint: number;
  /** Whether dirt and damp darken this tone toward the ground. */
  grime: boolean;
  /** Whether parts of this tone differ a little from one another in value and warmth. */
  vary: boolean;
  /** How readily a standing mass of this tone leans in toward its top, 0..1: laid stone and earth do, boards and sheet do not. */
  batter: number;
}
/**
 * Beyond the spec's tones: `accentSmall` is the fresher paint a small accent may carry (a sign board, a
 * shutter), `glowBig` the dimmer emission of a glowing part too large to be a lamp, `base` the foundation.
 */
type Palette = Record<PartTone | 'accentSmall' | 'glowBig' | 'glassBig' | 'base', ToneLook>;

/** A style after groundedPalette, which also remembers the accent as the model gave it. */
interface GroundedStyle extends StyleSpec { accentRaw?: string }
interface Look { surfaces: SurfaceSet; quality: Quality; seed: number; style: GroundedStyle; nature?: 'plant' | 'mineral'; cap?: number }

/** A part's biggest face, m2, above which an accent is a painted wall, and above which a glow is a lit panel and not a lamp. */
const SMALL_FACE = 2;
const LAMP_FACE = 6;
/** A glass part's biggest face, m2, above which it is a sheet of glass and not a window. */
const SHEET_FACE = 9;

/** Lightness shift (HSL) expressed as the linear multiplier that produces it on this colour. */
function driftFactor(hex: string, shift: number): number {
  if (shift === 0) return 1;
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  const l = Math.max(0.04, hsl.l);
  return clamp(Math.pow(clamp(l + shift, 0.02, 0.98) / l, 2.2), 0.5, 1.8);
}

type PlanKey = 'wall' | 'wall2' | 'roof' | 'trim' | 'accent' | 'accentSmall' | 'dark' | 'base';
interface PlanEntry { kind: SurfaceId; hex: string; roof: boolean }

/** Which surface in which colour each tone of a building takes. `look.style` is already grounded. */
function tonePlan(look: Look): Record<PlanKey, PlanEntry> {
  const s = look.surfaces;
  const style = look.style;
  const fam = surfaceFamily(s.wall);
  // Dark parts are doors, beams and frames: aged timber on most buildings, metal on metal ones.
  const darkKind: SurfaceId = fam === 'metal' || fam === 'glass' ? 'metal_panel' : fam === 'organic' ? 'bark' : fam === 'mineral' ? 'stone' : 'timber';
  // The foundation is whatever masonry the building already has; failing that, cast concrete under
  // metal and glass and rubble stone under everything else, in the colour of the local ground.
  const masonry = ([['trim', s.trim], ['wall2', s.wall2], ['wall', s.wall]] as const).find(([, k]) => surfaceFamily(k) === 'masonry');
  const baseKind: SurfaceId = masonry ? masonry[1] : fam === 'metal' || fam === 'glass' ? 'concrete' : 'stone';
  const baseHex = masonry
    ? safeHex(style[masonry[0]], '#8a8680')
    : groundTone(baseKind, `#${new THREE.Color(safeHex(style.ground, '#807868')).lerp(new THREE.Color('#77736c'), 0.6).getHexString()}`, s.wear);
  if (look.nature) return naturePlan(look, baseKind, baseHex);
  return {
    wall: { kind: s.wall, hex: safeHex(style.wall, '#b0a090'), roof: false },
    wall2: { kind: s.wall2, hex: safeHex(style.wall2, '#908070'), roof: false },
    roof: { kind: s.roof, hex: safeHex(style.roof, '#604030'), roof: true },
    trim: { kind: s.trim, hex: safeHex(style.trim, '#d8d0c0'), roof: false },
    accent: { kind: 'paint', hex: safeHex(style.accent, '#8a4034'), roof: false },
    accentSmall: { kind: 'paint', hex: signTone(safeHex(style.accentRaw ?? style.accent, '#8a4034'), s.wear), roof: false },
    dark: { kind: darkKind, hex: safeHex(style.dark, '#2a2420'), roof: false },
    base: { kind: baseKind, hex: baseHex, roof: false },
  };
}

const blend = (a: string, b: string, t: number): string => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

/** Leaf colour: the style's own, else the accent when it is already a leaf green, else a green drawn toward the ground. */
function foliageHex(style: GroundedStyle): string {
  if (style.foliage) return safeHex(style.foliage, '#4f7a38');
  const hsl = { h: 0, s: 0, l: 0 };
  const raw = safeHex(style.accentRaw ?? style.accent, '#8a4034');
  new THREE.Color(raw).getHSL(hsl);
  if (hsl.h > 0.17 && hsl.h < 0.47 && hsl.s > 0.12) return raw;
  return blend('#4f7a38', safeHex(style.ground, '#6a6a4a'), 0.25);
}

/**
 * Tones of a plant or a mineral. A plant: wall and wall2 are bark, accent the leaves, roof a second leaf
 * tone, trim the flowers or fruit in the world's pigment. A mineral: wall, wall2 and trim are the local
 * stone, roof its moss or snow cap, accent the crystal. Where the world's walls are themselves ice,
 * crystal or coral, stone keeps that material.
 */
function naturePlan(look: Look, baseKind: SurfaceId, baseHex: string): Record<PlanKey, PlanEntry> {
  const s = look.surfaces;
  const style = look.style;
  const ground = safeHex(style.ground, '#6a6a4a');
  const pigment = safeHex(style.accentRaw ?? style.accent, '#8a4034');
  const dark: PlanEntry = { kind: 'bark', hex: safeHex(style.dark, '#2a2420'), roof: false };
  const base: PlanEntry = { kind: baseKind, hex: baseHex, roof: false };
  const cold = s.ground === 'snow' || s.ground === 'ice';
  if (look.nature === 'plant') {
    const leaf = foliageHex(style);
    const bark = style.bark ? safeHex(style.bark, '#4a3b2e') : blend('#4a3b2e', ground, 0.22);
    const leaf2 = blend(leaf, '#2c3a1c', 0.3);
    return {
      wall: { kind: 'bark', hex: bark, roof: false },
      wall2: { kind: 'bark', hex: bark, roof: false },
      roof: { kind: 'organic', hex: leaf2, roof: false },
      trim: { kind: 'paint', hex: pigment, roof: false },
      accent: { kind: 'organic', hex: leaf, roof: false },
      accentSmall: { kind: 'organic', hex: leaf, roof: false },
      dark, base,
    };
  }
  const mineral = surfaceFamily(s.wall) === 'mineral';
  const stoneKind: SurfaceId = mineral ? s.wall : cold ? 'ice' : 'regolith';
  const stone = mineral ? safeHex(style.wall, '#8a8680') : cold ? blend('#b9d4e0', ground, 0.35) : blend(ground, '#77736c', 0.5);
  const cap: PlanEntry = cold ? { kind: 'snow', hex: '#e8eef2', roof: true } : { kind: 'moss', hex: blend(foliageHex(style), ground, 0.35), roof: true };
  return {
    wall: { kind: stoneKind, hex: stone, roof: false },
    wall2: { kind: stoneKind, hex: blend(stone, '#3a3836', 0.18), roof: false },
    roof: cap,
    trim: { kind: stoneKind, hex: blend(stone, '#d8d4cc', 0.2), roof: false },
    accent: { kind: 'crystal', hex: pigment, roof: false },
    accentSmall: { kind: 'crystal', hex: pigment, roof: false },
    dark, base,
  };
}

const surfaceOpts = (look: Look, roof: boolean): { wear: number; wet: number; quality: Quality; seed: number; tint: boolean; worn: boolean } => ({
  wear: look.surfaces.wear, wet: look.surfaces.wet * (roof ? 0.85 : 0.5), quality: look.quality, seed: look.seed, tint: true, worn: look.quality > 0,
});

function palette(mats: MaterialCache, look: Look, shifts: { wall: number; wall2: number; roof: number }): Palette {
  const plan = tonePlan(look);
  const surf = (key: PlanKey, tint: number): ToneLook => {
    const e = plan[key];
    const fam = surfaceFamily(e.kind);
    const batter = e.roof ? 0 : fam === 'masonry' || fam === 'mineral' ? 1 : e.kind === 'adobe' ? 0.8 : 0;
    return { material: getSurface(e.kind, e.hex, surfaceOpts(look, e.roof)), tile: surfaceScale(e.kind), grain: GRAIN[e.kind], tint, grime: !e.roof, vary: true, batter };
  };
  const glow = safeHex(look.style.glow, '#ffd27a');
  // A light source shows its emitted colour only. With a bright base colour as well, sun or lamp light on
  // top of the emission clips the part to white and the hue is lost.
  const unlit = `#${new THREE.Color(glow).multiplyScalar(0.12).getHexString()}`;
  const lamp = (intensity: number): ToneLook => ({ material: mats.get(unlit, { emissive: glow, emissiveIntensity: intensity, roughness: 0.6 }), tile: 1, tint: 1, grime: false, vary: false, batter: 0 });
  return {
    wall: surf('wall', driftFactor(plan.wall.hex, shifts.wall)),
    wall2: surf('wall2', driftFactor(plan.wall2.hex, shifts.wall2)),
    roof: surf('roof', driftFactor(plan.roof.hex, shifts.roof)),
    trim: surf('trim', 1),
    accent: surf('accent', 1),
    accentSmall: surf('accentSmall', 1),
    dark: surf('dark', 1),
    base: surf('base', 1),
    // On a building glass is a window with a room behind it. On a crystal, a rock or a plant it is the
    // clear mineral itself, in the world's pigment.
    glass: look.nature
      ? {
          material: getSurface('crystal', blend(safeHex(look.style.accentRaw ?? look.style.accent, '#8a4034'), safeHex(look.style.glass, '#6f9bb8'), 0.35), surfaceOpts(look, false)),
          tile: surfaceScale('crystal'), tint: 1, grime: false, vary: true, batter: 0,
        }
      : { material: glassMaterial(safeHex(look.style.glass, '#6f9bb8'), glow), tile: GLASS_SCALE, tint: 1, grime: false, vary: false, batter: 0 },
    glow: lamp(1.05),
    glowBig: lamp(0.28),
    // Glass that is no window pane (too large, or a cone, a ball, a prism) is plain glass: dark and glossy, with no lit rooms drawn across it.
    glassBig: { material: mats.get(`#${new THREE.Color(safeHex(look.style.glass, '#6f9bb8')).multiplyScalar(0.5).getHexString()}`, { roughness: 0.08, metalness: 0.85 }), tile: 1, tint: 1, grime: false, vary: false, batter: 0 },
  };
}

/**
 * Vertex colours: the tone's tint times this part's own shift (`kr`, `kg`, `kb`), graded darker over
 * the lowest metre and a half where splash-back and damp sit. `shade` darkens further, for the whole
 * geometry or vertex by vertex: the faces of a reveal, the back of a room.
 */
function paint(
  g: THREE.BufferGeometry, tone: ToneLook, wear: number, wet: number, kr: number, kg: number, kb: number, shade: ArrayLike<number> | number = 1,
): void {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const dirt = tone.grime ? 0.1 + 0.28 * wear : 0;
  const damp = tone.grime ? 0.16 * wet : 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const low = clamp(1 - y / 1.5, 0, 1);
    const lower = clamp(1 - y / 2.6, 0, 1);
    const k = tone.tint * (1 - dirt * low * low - damp * lower) * (typeof shade === 'number' ? shade : shade[i] ?? 1);
    col[i * 3] = k * kr;
    col[i * 3 + 1] = k * kg;
    col[i * 3 + 2] = k * kb;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/**
 * Splits a non-indexed geometry into its sloping faces, its upright ones and those that look down. A
 * gable or lean-to roof part is roofing on the slopes only: the triangles under the ridge are wall.
 */
function splitUpright(g: THREE.BufferGeometry): { slopes: THREE.BufferGeometry; upright: THREE.BufferGeometry; under: THREE.BufferGeometry } {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const keep: number[][] = [[], [], []];
  const normals: number[][] = [[], [], []];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ny = nor.getY(i);
    const side = Math.abs(ny) < 0.2 ? 1 : ny < 0 ? 2 : 0;
    for (let j = 0; j < 3; j++) {
      (keep[side] as number[]).push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
      (normals[side] as number[]).push(nor.getX(i + j), nor.getY(i + j), nor.getZ(i + j));
    }
  }
  const make = (k: number): THREE.BufferGeometry => {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(keep[k] as number[], 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(normals[k] as number[], 3));
    return out;
  };
  g.dispose();
  return { slopes: make(0), upright: make(1), under: make(2) };
}

// ---- built depth: openings cut into walls, roofs with thickness, oriented members -----------------

/** A vertex: position, and optionally a texture coordinate that travels with it. */
type P = readonly [number, number, number, number?, number?];
const FACES: readonly Face[] = [0, 1, 2, 3];
const FAR: readonly [number, number, number, number] = [WEARING_FAR, WEARING_FAR, WEARING_FAR, WEARING_FAR];

/** Triangles under construction: positions, a shade per vertex, and where asked for UVs and edge distances. */
class Soup {
  readonly pos: number[] = [];
  readonly shade: number[] = [];
  readonly uv: number[] = [];
  readonly wear: number[] = [];

  get count(): number {
    return this.pos.length / 3;
  }

  private put(p: P, shade: number): void {
    this.pos.push(p[0], p[1], p[2]);
    this.uv.push(p[3] ?? 0, p[4] ?? 0);
    this.shade.push(shade);
  }

  /** A triangle, wound to face along `n`. */
  tri(a: P, b: P, c: P, n: V3, sa = 1, sb = sa, sc = sa): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    this.put(a, sa);
    if (nx * n[0] + ny * n[1] + nz * n[2] >= 0) {
      this.put(b, sb);
      this.put(c, sc);
    } else {
      this.put(c, sc);
      this.put(b, sb);
    }
  }

  quad(a: P, b: P, c: P, d: P, n: V3, sa = 1, sb = sa, sc = sa, sd = sa): void {
    this.tri(a, b, c, n, sa, sb, sc);
    this.tri(a, c, d, n, sa, sc, sd);
  }

  /**
   * Appends another soup moved by `m`, turning the winding over if `m` mirrors. `wearAt`, given a
   * source vertex, returns its distances to the edges of its face (see boxGeometry).
   */
  take(src: Soup, m: THREE.Matrix4, wearAt?: (x: number, y: number, z: number) => readonly [number, number, number, number]): void {
    const e = m.elements;
    const flip = m.determinant() < 0;
    const n = src.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = t + (flip && k > 0 ? 3 - k : k);
        const x = src.pos[i * 3] as number;
        const y = src.pos[i * 3 + 1] as number;
        const z = src.pos[i * 3 + 2] as number;
        this.pos.push(
          (e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + (e[12] as number),
          (e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z + (e[13] as number),
          (e[2] as number) * x + (e[6] as number) * y + (e[10] as number) * z + (e[14] as number),
        );
        this.uv.push(src.uv[i * 2] as number, src.uv[i * 2 + 1] as number);
        this.shade.push(src.shade[i] as number);
        const w = wearAt ? wearAt(x, y, z) : FAR;
        this.wear.push(w[0], w[1], w[2], w[3]);
      }
    }
  }

  /** Non-indexed geometry with face normals; `uvs` and `wearing` add those attributes. */
  geometry(opts: { uvs?: boolean; wearing?: boolean } = {}): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (opts.uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (opts.wearing && this.wear.length === this.count * 4) g.setAttribute(WEARING, new THREE.Float32BufferAttribute(this.wear, 4));
    g.computeVertexNormals();
    return g;
  }
}

const IDENTITY = new THREE.Matrix4();
const PX: V3 = [1, 0, 0];
const NX: V3 = [-1, 0, 0];
const PY: V3 = [0, 1, 0];
const NY: V3 = [0, -1, 0];
const PZ: V3 = [0, 0, 1];

/** The frame of a box's side face in the box's own: x along the face, y up, +z out of the wall. */
function faceMatrix(f: Face, pw: number, pd: number): THREE.Matrix4 {
  const half = f < 2 ? pd / 2 : pw / 2;
  return new THREE.Matrix4().makeRotationY(FACE_TURN[f] * DEG).setPosition(f === 2 ? half : f === 3 ? -half : 0, 0, f === 0 ? half : f === 1 ? -half : 0);
}

/** Sorted cut lines across a face: its two edges plus every opening edge that falls between them. */
function cutLines(lo: number, hi: number, at: readonly number[]): number[] {
  const all = [lo, hi, ...at.filter((v) => v > lo + 1e-4 && v < hi - 1e-4)].sort((a, b) => a - b);
  return all.filter((v, i) => i === 0 || v - (all[i - 1] as number) > 1e-4);
}

interface CutSoups { wall: Soup; frames: Map<PartTone, Soup>; dark: Soup; glass: Soup }

/**
 * One opening, in the frame of its face: reveals from the wall face back to the frame (the sill rising
 * as it goes), the frame, then the glazing, a dark plate or a dark room behind.
 */
function cutOpening(o: Opening, A: number, H: number, out: CutSoups): void {
  const { u0, u1, v0, v1 } = o;
  const r = o.depth;
  const fd = o.frame ? Math.min(0.07, r * 0.5) : 0;
  const zf = -(r - fd);
  const zg = -r;
  const vb = v0 + o.sill * ((r - fd) / r);
  out.wall.quad([u0, v0, 0], [u0, v1, 0], [u0, v1, zf], [u0, vb, zf], PX, 0.8);
  out.wall.quad([u1, v0, 0], [u1, v1, 0], [u1, v1, zf], [u1, vb, zf], NX, 0.8);
  out.wall.quad([u0, v1, 0], [u1, v1, 0], [u1, v1, zf], [u0, v1, zf], NY, 0.66);
  out.wall.quad([u0, v0, 0], [u1, v0, 0], [u1, vb, zf], [u0, vb, zf], PY, 0.9);
  let iu0 = u0;
  let iu1 = u1;
  let iv0 = vb;
  let iv1 = v1;
  if (o.frame) {
    const door = o.kind === 'door';
    const fw = Math.min(o.frameWidth, (u1 - u0) * 0.2, (v1 - vb) * 0.2);
    iu0 += fw;
    iu1 -= fw;
    iv1 -= fw;
    if (!door) iv0 += fw;
    let fs = out.frames.get(o.frame);
    if (!fs) {
      fs = new Soup();
      out.frames.set(o.frame, fs);
    }
    fs.quad([u0, vb, zf], [iu0, iv0, zf], [iu0, iv1, zf], [u0, v1, zf], PZ);
    fs.quad([u1, vb, zf], [iu1, iv0, zf], [iu1, iv1, zf], [u1, v1, zf], PZ);
    fs.quad([u0, v1, zf], [iu0, iv1, zf], [iu1, iv1, zf], [u1, v1, zf], PZ);
    fs.quad([iu0, iv0, zf], [iu0, iv1, zf], [iu0, iv1, zg], [iu0, iv0, zg], PX, 0.8);
    fs.quad([iu1, iv0, zf], [iu1, iv1, zf], [iu1, iv1, zg], [iu1, iv0, zg], NX, 0.8);
    fs.quad([iu0, iv1, zf], [iu1, iv1, zf], [iu1, iv1, zg], [iu0, iv1, zg], NY, 0.7);
    if (!door) {
      fs.quad([u0, vb, zf], [iu0, iv0, zf], [iu1, iv0, zf], [u1, vb, zf], PZ);
      fs.quad([iu0, iv0, zf], [iu1, iv0, zf], [iu1, iv0, zg], [iu0, iv0, zg], PY, 0.9);
    }
  }
  if (o.fill === 'glass') {
    // Each window shows its own small patch of the interior-glow map, so no two are lit alike at night.
    const gu = (o.glow * 7.31) % 1;
    const gv = (o.glow * 3.17) % 1;
    const k = 0.3 / GLASS_SCALE;
    const uc = (iu0 + iu1) / 2;
    const vc = (iv0 + iv1) / 2;
    const at = (u: number, v: number): P => [u, v, zg, gu + (u - uc) * k, gv + (v - vc) * k];
    out.glass.quad(at(iu0, iv0), at(iu1, iv0), at(iu1, iv1), at(iu0, iv1), PZ);
    return;
  }
  if (o.room > 0.2) {
    // A room: five faces that look inward, darker toward the back.
    const a0 = Math.max(-A / 2 + 0.05, iu0 - 0.3);
    const a1 = Math.min(A / 2 - 0.05, iu1 + 0.3);
    const b0 = o.kind === 'door' ? iv0 : Math.max(0.02, iv0 - 0.3);
    const b1 = Math.min(H - 0.05, iv1 + 0.3);
    const zb = zg - o.room;
    out.dark.quad([a0, b0, zg], [a0, b1, zg], [a0, b1, zb], [a0, b0, zb], PX, 0.5, 0.5, 0.12, 0.12);
    out.dark.quad([a1, b0, zg], [a1, b1, zg], [a1, b1, zb], [a1, b0, zb], NX, 0.5, 0.5, 0.12, 0.12);
    out.dark.quad([a0, b1, zg], [a1, b1, zg], [a1, b1, zb], [a0, b1, zb], NY, 0.4, 0.4, 0.1, 0.1);
    out.dark.quad([a0, b0, zg], [a1, b0, zg], [a1, b0, zb], [a0, b0, zb], PY, 0.6, 0.6, 0.15, 0.15);
    out.dark.quad([a0, b0, zb], [a1, b0, zb], [a1, b1, zb], [a0, b1, zb], PZ, 0.1);
    return;
  }
  // A plate close behind: what shows through a broken pane or past the edge of a door leaf.
  const back = o.kind === 'door' ? zg - 0.06 : zg;
  const pad = o.kind === 'door' ? 0.15 : 0;
  out.dark.quad([iu0 - pad, iv0, back], [iu1 + pad, iv0, back], [iu1 + pad, iv1 + pad, back], [iu0 - pad, iv1 + pad, back], PZ, 0.22);
}

/**
 * A box (base on y = 0, centred on x/z) with openings cut into its side faces. Each face is laid as
 * panels around its openings on the lines their edges make, so no boolean is needed; `lines` adds a
 * line at each of those heights for the dirt grading and the shade under an overhang. With `chamfer`
 * the four upright corners and the top edge are bevelled as on a plain box (the foot stays square: it
 * stands on something, and doorways reach it). Edge distances for the wear shader are true on the faces.
 */
function cutWall(pw: number, ph: number, pd: number, cuts: readonly Opening[], lines: readonly number[], chamfer = 0): CutSoups {
  const out: CutSoups = { wall: new Soup(), frames: new Map(), dark: new Soup(), glass: new Soup() };
  const c = Math.max(0, Math.min(chamfer, Math.min(pw, ph, pd) * 0.3));
  const top = ph - c;
  for (const f of FACES) {
    const A = f < 2 ? pw : pd;
    const T = f < 2 ? pd : pw;
    const e0 = -A / 2 + c;
    const e1 = A / 2 - c;
    // An opening is kept only where it fits this box as it is actually built.
    const ops = cuts.filter((o) => o.face === f && o.u0 > e0 + 0.02 && o.u1 < e1 - 0.02 && o.v0 >= 0 && o.v1 < top - 0.02 && o.depth < T - 0.02 && o.u1 - o.u0 > 0.1 && o.v1 - o.v0 > 0.1);
    const local: CutSoups = { wall: new Soup(), frames: new Map(), dark: new Soup(), glass: new Soup() };
    const us = cutLines(e0, e1, ops.flatMap((o) => [o.u0, o.u1]));
    const vs = cutLines(0, top, ops.flatMap((o) => [o.v0, o.v1]).concat(lines.filter((v) => v > 0.05 && v < top - 0.05)));
    for (let i = 0; i + 1 < us.length; i++) {
      const ua = us[i] as number;
      const ub = us[i + 1] as number;
      for (let j = 0; j + 1 < vs.length; j++) {
        const va = vs[j] as number;
        const vb = vs[j + 1] as number;
        const uc = (ua + ub) / 2;
        const vc = (va + vb) / 2;
        if (ops.some((o) => uc > o.u0 && uc < o.u1 && vc > o.v0 && vc < o.v1)) continue;
        local.wall.quad([ua, va, 0], [ub, va, 0], [ub, vb, 0], [ua, vb, 0], PZ);
      }
    }
    for (const o of ops) cutOpening(o, A, ph, local);
    const m = faceMatrix(f, pw, pd);
    out.wall.take(local.wall, m, (x, y, z) => (z > -1e-6 ? [x - e0, e1 - x, y, top - y] : FAR));
    if (c > 0) {
      // The bevel down this face's right-hand corner, the one along its top, and the facet where they meet.
      const edge = new Soup();
      for (let j = 0; j + 1 < vs.length; j++) {
        const va = vs[j] as number;
        const vb = vs[j + 1] as number;
        edge.quad([e1, va, 0], [A / 2, va, -c], [A / 2, vb, -c], [e1, vb, 0], [1, 0, 1]);
      }
      for (let i = 0; i + 1 < us.length; i++) edge.quad([us[i] as number, top, 0], [us[i + 1] as number, top, 0], [us[i + 1] as number, ph, -c], [us[i] as number, ph, -c], [0, 1, 1]);
      edge.tri([e1, top, 0], [A / 2, top, -c], [e1, ph, -c], [1, 1, 1]);
      // A bevel is an edge all along: no distance to either side, its true height on the wall.
      out.wall.take(edge, m, (_x, y) => [0, 0, y, Math.max(0, top - y)]);
    }
    out.dark.take(local.dark, m);
    out.glass.take(local.glass, m);
    for (const [tone, s] of local.frames) {
      let dst = out.frames.get(tone);
      if (!dst) {
        dst = new Soup();
        out.frames.set(tone, dst);
      }
      dst.take(s, m);
    }
  }
  const caps = new Soup();
  const x = pw / 2;
  const z = pd / 2;
  caps.quad([-x + c, ph, -z + c], [x - c, ph, -z + c], [x - c, ph, z - c], [-x + c, ph, z - c], PY);
  caps.quad([-x + c, 0, -z], [x - c, 0, -z], [x - c, 0, z], [-x + c, 0, z], NY);
  if (c > 0) {
    for (const sx of [-1, 1]) caps.quad([sx * (x - c), 0, -z + c], [sx * x, 0, -z + c], [sx * x, 0, z - c], [sx * (x - c), 0, z - c], NY);
  }
  out.wall.take(caps, IDENTITY);
  return out;
}

type P2 = readonly [number, number];

/** A strip between two points of a section (z outward, y up) drawn out along x; it faces to the left of its direction. */
function strip(dst: Soup, a: P2, b: P2, r0: number, r1: number, shade: number): void {
  dst.quad([r0, a[1], a[0]], [r1, a[1], a[0]], [r1, b[1], b[0]], [r0, b[1], b[0]], [0, b[0] - a[0], a[1] - b[1]], shade);
}

/**
 * One slope of a roof as a slab, in a frame where x runs along the eave and z runs out from the ridge
 * line: the top face on the roof part's own slope from the ridge (height `H` at z = 0) to `out` beyond
 * its eave line (z = `S`, y = 0), the eave in the roofing's own manner, the underside, and the cut ends
 * at the verges. `over` carries the top edge past the ridge line (a lean-to against nothing).
 */
function roofSlab(top: Soup, under: Soup, m: THREE.Matrix4, H: number, S: number, r0: number, r1: number, sh: RoofShell, over: number): void {
  const tan = H / S;
  const L = Math.hypot(S, H);
  const cos = S / L;
  const sin = H / L;
  const tv = sh.thick / cos;
  const a = new Soup();
  const b = new Soup();
  // A rounded eave is carried on down the slope by what the rounding takes back, so it still reaches `out`.
  const rho = sh.edge === 'round' ? Math.min(sh.thick * 0.6, 0.22) : 0;
  const reach = sh.out + rho * (cos + sin - 1);
  const e: P2 = [S + reach, -reach * tan];
  const head: P2 = [-over, H + over * tan];
  // The section from the top face round the eave to where the underside begins.
  const sec: P2[] = [head];
  if (sh.edge === 'round') {
    const cz = e[0] - cos * rho - sin * rho;
    const cy = e[1] + sin * rho - cos * rho;
    for (let k = 0; k <= 3; k++) {
      const t = (k / 3) * (Math.PI / 2);
      sec.push([cz + (sin * Math.cos(t) + cos * Math.sin(t)) * rho, cy + (cos * Math.cos(t) - sin * Math.sin(t)) * rho]);
    }
    sec.push([e[0] - sin * sh.thick - cos * rho * 0.8, e[1] - cos * sh.thick + sin * rho * 0.8]);
  } else if (sh.edge === 'step') {
    // A doubled starter course: the edge drops, steps out and drops again.
    sec.push(e, [e[0], e[1] - 0.045], [e[0] + 0.05, e[1] - 0.045 - 0.05 * tan], [e[0] + 0.05, e[1] - 0.045 - 0.05 * tan - tv * 0.75]);
  } else {
    sec.push(e, [e[0], e[1] - tv]);
  }
  const last = sec[sec.length - 1] as P2;
  const yUnder = (z: number): number => last[1] + (last[0] - z) * tan;
  for (let i = 0; i + 1 < sec.length; i++) {
    const p = sec[i] as P2;
    const q = sec[i + 1] as P2;
    if (sh.edge === 'wave' && i === 1 && sh.pitch > 0) {
      // A scalloped edge: the lower line of the sheet or the tile ends rises and falls along the eave.
      const n = clamp(Math.round((r1 - r0) / (sh.pitch / 2)), 2, 96);
      for (let k = 0; k < n; k++) {
        const ra = r0 + ((r1 - r0) * k) / n;
        const rb = r0 + ((r1 - r0) * (k + 1)) / n;
        a.quad([ra, p[1], p[0]], [rb, p[1], p[0]], [rb, q[1] - (k % 2 === 0 ? sh.amp : 0), q[0]], [ra, q[1] - (k % 2 === 0 ? 0 : sh.amp), q[0]], PZ, 0.8);
      }
    } else {
      strip(a, p, q, r0, r1, i === 0 ? 1 : 0.8);
    }
  }
  // Underside: back to the roof part's eave line and up to its base along the middle, right up the slope at the verges.
  const v = Math.min(sh.verge, (r1 - r0) / 2);
  const end: P2 = [-over, yUnder(-over)];
  if (sh.out > 0.02 && r1 - r0 > 2 * v) {
    const back = Math.min(S, last[0]);
    if (last[0] > back + 0.01) strip(b, last, [back, yUnder(back)], r0 + v, r1 - v, 0.85);
    strip(b, [back, yUnder(back)], [back, 0], r0 + v, r1 - v, 0.7);
  }
  if (over > 0) {
    strip(b, [0, yUnder(0)], end, r0 + v, r1 - v, 0.85);
    strip(a, end, head, r0, r1, 0.8);
  }
  for (const [ra, rb] of [[r0, r0 + v], [r1 - v, r1]] as const) strip(b, last, end, ra, rb, 0.85);
  const loop = sec.concat([end]);
  for (const [r, n] of [[r0, NX], [r1, PX]] as const) {
    for (let i = 1; i + 1 < loop.length; i++) {
      const p = loop[i] as P2;
      const q = loop[i + 1] as P2;
      a.tri([r, head[1], head[0]], [r, p[1], p[0]], [r, q[1], q[0]], n, 0.78);
    }
  }
  top.take(a, m);
  under.take(b, m);
}

/** Ridge capping over a gable, in the gable's own frame: lapping `sh.cap` down each slope, `sh.capRise` proud. */
function ridgeCap(dst: Soup, H: number, S: number, r0: number, r1: number, sh: RoofShell): void {
  const L = Math.hypot(S, H);
  const cos = S / L;
  const sin = H / L;
  const c = Math.min(sh.cap, L * 0.4);
  const e = sh.capRise;
  const sec: P2[] = [
    [-c * cos, H - c * sin], [-c * cos - sin * e, H - c * sin + cos * e], [0, H + e / cos], [c * cos + sin * e, H - c * sin + cos * e], [c * cos, H - c * sin],
  ];
  for (let i = 0; i + 1 < sec.length; i++) strip(dst, sec[i] as P2, sec[i + 1] as P2, r0, r1, i === 0 || i === 3 ? 0.8 : 0.95);
  const head = sec[0] as P2;
  for (const [r, n] of [[r0, NX], [r1, PX]] as const) {
    for (let i = 1; i + 1 < sec.length; i++) {
      const p = sec[i] as P2;
      const q = sec[i + 1] as P2;
      dst.tri([r, head[1], head[0]], [r, p[1], p[0]], [r, q[1], q[0]], n, 0.8);
    }
  }
}

const MIRROR_Z = new THREE.Matrix4().makeScale(1, 1, -1);

/** The slabs of a gable or lean-to roof part sized `pw` x `ph` x `pd`, in the part's own frame. */
function roofShell(shape: 'gable' | 'wedge', pw: number, ph: number, pd: number, sh: RoofShell): { top: Soup; under: Soup; cap: Soup } {
  const top = new Soup();
  const under = new Soup();
  const cap = new Soup();
  if (shape === 'gable') {
    const r = pw / 2 + sh.verge;
    roofSlab(top, under, IDENTITY, ph, pd / 2, -r, r, sh, 0);
    roofSlab(top, under, MIRROR_Z, ph, pd / 2, -r, r, sh, 0);
    if (sh.cap > 0) ridgeCap(cap, ph, pd / 2, -r - 0.02, r + 0.02, sh);
  } else {
    // The lean-to's slope falls toward -x: along the eave is z, out from the high edge is -x.
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), UP, new THREE.Vector3(-1, 0, 0)).setPosition(pw / 2, 0, 0);
    const r = pd / 2 + sh.verge;
    roofSlab(top, under, m, ph, pw, -r, r, sh, 0.06);
  }
  return { top, under, cap };
}

const tmpA = new THREE.Matrix4();
const tmpB = new THREE.Matrix4();
const local = new THREE.Matrix4();
const vx = new THREE.Vector3();
const vy = new THREE.Vector3();
const vz = new THREE.Vector3();

/** What the dressing pass asks of the mesher beyond plain parts, keyed by part index. */
interface Depth { hidden: ReadonlySet<number>; cuts: ReadonlyMap<number, Opening[]>; roofs: ReadonlyMap<number, RoofShell> }

function depthOf(d: Dressed): Depth {
  const cuts = new Map<number, Opening[]>();
  for (const o of d.openings) {
    const list = cuts.get(o.wall);
    if (list) list.push(o);
    else cuts.set(o.wall, [o]);
  }
  return { hidden: new Set(d.hidden), cuts, roofs: new Map(d.roofs.map((r) => [r.part, r])) };
}

interface Finish { value: number; warm: number; turned: boolean; shade?: ArrayLike<number> | number; keepUv?: boolean }
type Finisher = (g: THREE.BufferGeometry, tone: ToneLook, f: Finish) => void;

/** The last steps every piece of a building goes through: UVs in metres, vertex colour, placing, batching. */
function finisher(batch: GeoBatch, base: THREE.Matrix4, look: Look, uOff: number): Finisher {
  const wear = clamp(look.surfaces.wear, 0, 1);
  const wet = clamp(look.surfaces.wet, 0, 1);
  return (g, tone, f) => {
    if (g.getAttribute('position').count === 0) {
      g.dispose();
      return;
    }
    if (!f.keepUv) projectWorldUV(g, tone.tile, uOff, 0, f.turned);
    const v = tone.vary ? f.value : 1;
    const w = tone.vary ? f.warm : 0;
    paint(g, tone, wear, wet, v * (1 + w), v, v * (1 - w), f.shade);
    g.applyMatrix4(base);
    batch.add(g, tone.material);
  };
}

/** Glass in one of these shapes can be a window; in any other it is a piece of plain glass. */
const WINDOW_SHAPES: ReadonlySet<PartShape> = new Set<PartShape>(['box', 'arch']);

/**
 * Adds already-expanded parts. `fw`/`fd` are the footprint in metres; `hScale` scales y and h (props).
 * `vary` draws each part's small shift of value and warmth; the first part keeps the tone exactly.
 * With `depth`, hidden parts are skipped, walls with openings are built around them and sloping roofs
 * are laid as slabs. Parts of a plant or a mineral take grown and weathered shapes (see part-geometry.ts),
 * and every part is shaded where another overhangs it or carries it. Returns the height of the tallest
 * of the first `count` parts (the authored ones).
 */
function emit(
  parts: readonly BlueprintPart[], count: number, pal: Palette, batch: GeoBatch, base: THREE.Matrix4,
  fw: number, fd: number, hScale: number, look: Look, uOff: number, vary: Rng | null, depth: Depth | null = null,
): number {
  let top = 0;
  const finish = finisher(batch, base, look, uOff);
  const sizes = parts.map((p) => ({
    pw: clamp(p.w, 0.002, 1.4) * fw, pd: clamp(p.d, 0.002, 1.4) * fd, ph: clamp(p.h, 0.02, look.cap ?? 30) * hScale,
    py: clamp(p.y, 0, look.cap ?? 30) * hScale, px: clamp(p.x, -0.7, 0.7) * fw, pz: clamp(p.z, -0.7, 0.7) * fd,
  }));
  // Every part as a box in this frame, for the shade one casts on another. A roof laid as a slab reaches past its part.
  const solids: (Solid | null)[] = parts.map((p, i) => {
    if (depth?.hidden.has(i)) return null;
    const s = sizes[i] as (typeof sizes)[number];
    const eave = depth?.roofs.get(i);
    return solidOf(s.px, s.pz, s.py, s.pw, s.ph, s.pd, p.rot, p.tone !== 'glass' && p.tone !== 'glow', eave ? eave.out * 0.8 : 0);
  });
  const e = base.elements;
  parts.forEach((p, index) => {
    const { pw, pd, ph, py, px, pz } = sizes[index] as (typeof sizes)[number];
    if (index < count) top = Math.max(top, py + ph);
    // A narrow, natural range: under five percent in value, a trace warmer or cooler.
    const value = vary && index > 0 ? 1 + (vary.next() - 0.5) * 0.09 : 1;
    const warm = vary && index > 0 ? (vary.next() - 0.5) * 0.035 : 0;
    const own = solids[index];
    if (!own) return;
    local.multiplyMatrices(tmpA.makeTranslation(px, py, pz), tmpB.makeRotationY(p.rot * DEG));
    // Paint is only fresh, and light only a lamp, on something small. Glass is a window only as a pane or
    // an arch (or a drum wide enough to be a glazed room), and only while it is no bigger than a window.
    const face = Math.max(pw * ph, pd * ph, pw * pd);
    const pane = WINDOW_SHAPES.has(p.shape) || (p.shape === 'cylinder' && Math.min(pw, pd) >= 1.5);
    const tone = p.tone === 'accent' && face <= SMALL_FACE ? pal.accentSmall : p.tone === 'glow' && face > LAMP_FACE ? pal.glowBig
      : p.tone === 'glass' && (face > SHEET_FACE || !pane) && !look.nature ? pal.glassBig : pal[p.tone] ?? pal.wall;
    const contact = contactsOf(solids, index);
    const thin = Math.min(pw, ph, pd);
    const cuts = p.shape === 'box' ? depth?.cuts.get(index) : undefined;
    // A wall that stands under an overhang gets a line where that shade runs out, so it stays up under the eaves.
    const hood = contact ? contact.over.reduce((m, o) => (o.y0 > py + ph - 0.1 ? Math.max(m, o.reach) : m), 0) : 0;
    const band = hood > 0 && ph > hood + 0.7 ? ph - hood : 0;
    // Masonry that stands on the ground with nothing set into it leans in a little as it rises: a
    // foundation, a pier, a buttress, a chimney stack.
    const massive = tone === pal.base || (depth !== null && ph >= 1.2 * Math.max(pw, pd));
    const box: BoxDetail = {
      chamfer: look.quality === 2 && thin > 0.3 ? Math.min(0.035, thin * 0.1) : 0,
      split: tone.grime && ph > 2.4 && py < 1.2 ? 1.5 - py : 0,
      band,
      batter: tone.batter > 0 && !cuts && !look.nature && massive && py < 0.05 && ph >= 0.6 && thin >= 0.5 ? tone.batter * Math.min(0.05, ph * 0.012) : 0,
    };
    // Wood runs along the member: a post takes the grain up, a beam takes it along, whatever the texture's own lay.
    const across = Math.max(pw, pd);
    const long = ph > 2.5 * across ? 'v' : across > 2.5 * ph && Math.min(pw, pd) < 0.5 ? 'u' : null;
    const turn = tone.grain !== undefined && long !== null && tone.grain !== long;
    const put = (s: Soup, to: ToneLook, wearing = false): void => {
      if (s.count === 0) return;
      const g = s.geometry({ wearing });
      g.applyMatrix4(local);
      finish(g, to, { value, warm, turned: false, shade: contactShade(g, own, contact, s.shade) });
    };
    /** Moves a finished piece into the frame of the whole and hands it on with the shade its neighbours cast on it. */
    const place = (g: THREE.BufferGeometry, to: ToneLook, turned: boolean, shade: ArrayLike<number> | number = 1): void => {
      g.applyMatrix4(local);
      finish(g, to, { value, warm, turned, shade: contactShade(g, own, contact, shade) });
    };

    if (cuts) {
      const cut = cutWall(pw, ph, pd, cuts, [box.split, band], box.chamfer);
      put(cut.wall, tone, true);
      put(cut.dark, pal.dark);
      for (const [frameTone, s] of cut.frames) put(s, pal[frameTone]);
      if (cut.glass.count > 0) {
        const g = cut.glass.geometry({ uvs: true });
        g.applyMatrix4(local);
        finish(g, pal.glass, { value: 1, warm: 0, turned: false, keepUv: true });
      }
      return;
    }
    // A round shape is as many-sided as its girth asks: a long thin frond is a small thing, whatever its length.
    const segments = roundSegments(Math.sqrt(pw * pd), look.quality);
    const shell = depth?.roofs.get(index);
    if (shell && p.tone === 'roof' && (p.shape === 'gable' || p.shape === 'wedge')) {
      // The part keeps its upright ends as wall and its base as a soffit; its slopes become slabs.
      for (const raw of shapeGeometries(p.shape, pw, ph, pd, segments, box)) {
        const g = unindexed(raw, false);
        g.applyMatrix4(local);
        const { slopes, upright, under } = splitUpright(g);
        slopes.dispose();
        finish(upright, pal.wall, { value, warm, turned: false });
        finish(under, pal[shell.soffit], { value, warm, turned: false, shade: 0.8 });
      }
      const slab = roofShell(p.shape, pw, ph, pd, shell);
      put(slab.top, tone);
      put(slab.under, pal[shell.soffit]);
      put(slab.cap, pal[shell.capTone]);
      return;
    }
    const growth = look.nature ? growthOf(look.nature, p.shape, p.tone, pw, ph, pd) : null;
    if (growth) {
      // Only wood spreads into roots where it leaves the ground; a green stalk rises straight out of it.
      const rooted = py < 0.02 * hScale && (growth !== 'stem' || p.tone === 'wall' || p.tone === 'wall2' || p.tone === 'dark');
      const grown = organicGeometry(growth, p.shape, pw, ph, pd, partSeed(look.seed, e[12] as number, e[14] as number, index), look.quality, rooted);
      place(grown.geometry, tone, turn, grown.shade);
      return;
    }
    for (const raw of shapeGeometries(p.shape, pw, ph, pd, segments, box)) {
      const g = unindexed(raw, SMOOTH.has(p.shape) || (p.shape === 'arch' && raw.getAttribute('normal') !== undefined));
      if (p.tone === 'roof' && (p.shape === 'gable' || p.shape === 'wedge')) {
        g.applyMatrix4(local);
        const { slopes, upright, under } = splitUpright(g);
        finish(slopes, tone, { value, warm, turned: false });
        finish(under, tone, { value, warm, turned: false });
        finish(upright, pal.wall, { value, warm, turned: false });
      } else {
        place(g, tone, turn);
      }
    }
  });
  return top;
}

/** Lays oriented members (see Strut in detail.ts): a box of the given section from one point to the other. */
function emitStruts(struts: readonly Strut[], pal: Palette, batch: GeoBatch, base: THREE.Matrix4, look: Look, uOff: number, vary: Rng | null): void {
  const finish = finisher(batch, base, look, uOff);
  for (const s of struts) {
    vy.set(s.bx - s.ax, s.by - s.ay, s.bz - s.az);
    const len = vy.length();
    if (!(len > 0.02) || !(s.w > 0.004) || !(s.t > 0.004)) continue;
    vy.divideScalar(len);
    // Across the member is level; a plumb member takes x.
    vx.set(vy.z, 0, -vy.x);
    if (vx.lengthSq() < 1e-8) vx.set(1, 0, 0);
    vx.normalize();
    vz.crossVectors(vx, vy);
    local.makeBasis(vx, vy, vz).setPosition(s.ax, s.ay, s.az);
    const g = unindexed(boxGeometry(s.w, len, s.t), false);
    g.applyMatrix4(local);
    const tone = pal[s.tone];
    const long = Math.abs(vy.y) > 0.7 ? 'v' : 'u';
    const value = vary ? 1 + (vary.next() - 0.5) * 0.09 : 1;
    finish(g, tone, { value, warm: 0, turned: tone.grain !== undefined && tone.grain !== long });
  }
}

/** Lays run-off stains (see detail.ts) as quads a few millimetres off the wall, in the building's frame. */
function emitStains(stains: readonly Stain[], batch: GeoBatch, base: THREE.Matrix4): void {
  for (const s of stains) {
    if (!(s.w > 0.05) || !(s.h > 0.1)) continue;
    const g = new THREE.PlaneGeometry(s.w, s.h).toNonIndexed();
    // One repeat of the streak pattern is about 0.9 m wide; wider stains repeat it rather than stretch it.
    const uv = g.getAttribute('uv');
    const reps = Math.max(1, Math.round(s.w / 0.9));
    const shift = (Math.abs(s.x * 3.1 + s.z * 1.7) % 1);
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * reps + shift);
    local.multiplyMatrices(tmpA.makeTranslation(s.x, s.y - s.h / 2, s.z), tmpB.makeRotationY(s.rot * DEG));
    g.applyMatrix4(local);
    g.applyMatrix4(base);
    batch.add(g, stainMaterial(s.kind));
  }
}

function lookFor(style: StyleSpec, opts: BlueprintOptions | undefined): Look {
  const d = surfaceDefaults();
  const surfaces = resolveSurfaces(style, opts?.theme ?? d.theme, opts?.mood ?? d.mood);
  return {
    surfaces,
    quality: opts?.quality ?? d.quality,
    seed: opts?.seed ?? 0,
    style: { ...groundedPalette(style, surfaces), accentRaw: style.accent },
    ...(opts?.nature ? { nature: opts.nature } : {}),
    ...(opts?.maxHeight !== undefined && opts.maxHeight > 30 ? { cap: Math.min(400, opts.maxHeight) } : {}),
  };
}

/** Every generated surface a town in this style will ask for: its buildings' tones, the ground and the roads. */
export function townSurfaceRequests(style: StyleSpec, opts?: BlueprintOptions): SurfaceRequest[] {
  const look = lookFor(style, opts);
  const plan = tonePlan(look);
  const list: SurfaceRequest[] = (Object.keys(plan) as PlanKey[]).map((key) => {
    const o = surfaceOpts(look, plan[key].roof);
    return { kind: plan[key].kind, hex: plan[key].hex, wear: o.wear, wet: o.wet, quality: o.quality, seed: o.seed };
  });
  return list.concat(groundRequests(look.surfaces, style, { quality: look.quality, seed: look.seed }));
}

/**
 * Generates every surface a town in this style needs without blocking the page: await it behind the
 * loading screen before building the town, and the build finds its maps ready. See warmSurfaces.
 */
export function warmTownSurfaces(style: StyleSpec, opts?: BlueprintOptions): Promise<void> {
  return warmSurfaces(townSurfaceRequests(style, opts));
}

/**
 * Adds one blueprint building. Blueprint +z is the street-facing front; the building's own frame faces
 * -Z (as the procedural buildings do), so the part frame is turned half a revolution before rotY applies.
 * Parts are dressed (see detail.ts) before meshing. Returns the roof height of the authored parts above
 * the ground line and the point 1 m outside the door on the street side (beyond the steps, if any).
 */
export function addBlueprint(
  bp: Blueprint, style: StyleSpec, placed: BlueprintPlacement, env: BlueprintEnv, opts?: BlueprintOptions,
): BlueprintResult {
  const variety = clamp(Number.isFinite(style.variety) ? style.variety : 0.5, 0, 1);
  const step = (): number => Math.round(env.rng.range(-1, 1) * 2) / 2 * 0.06 * variety;
  const look = lookFor(style, opts);
  setSurfaceDefaults({ style, surfaces: look.surfaces });
  const pal = palette(env.mats, look, { wall: step(), wall2: step(), roof: step() });
  const ground = Number.isFinite(placed.y) ? (placed.y as number) : 0;
  const lift = clamp(opts?.baseHeight ?? 0, 0, 3);
  const skirt = clamp(opts?.skirt ?? 0, 0, 8);
  const turn = new THREE.Matrix4().makeRotationY(placed.rotY + Math.PI);
  const base = new THREE.Matrix4().makeTranslation(placed.x, ground + lift, placed.z).multiply(turn);
  const doorX = clamp(Number.isFinite(bp.doorX) ? bp.doorX : 0, -0.4, 0.4);
  const authored = expandBlueprintParts(bp.parts);
  // The dressing pass and the texture offset draw from the building's position, not from env.rng, so
  // they never shift the random sequence the rest of the town build depends on.
  const own = makeRng(look.seed, `dress|${Math.round(placed.x * 100)}|${Math.round(placed.z * 100)}|${bp.id}`);
  const uOff = Math.floor(own.next() * 16) / 16;
  const stains: Stain[] = [];
  let parts = authored;
  let dressed: Dressed | null = null;
  if (opts?.dress !== false) {
    // How old the place reads decides how its windows are divided: its own words first, then the theme.
    const theme = opts?.theme ?? surfaceDefaults().theme;
    const era = eraFromWords(`${style.name} ${bp.summary} ${bp.id}`) ?? (theme === 'scifi' ? 0.92 : theme === 'modern' ? 0.8 : undefined);
    const ctx: DressContext = {
      w: placed.w, d: placed.d, rng: own, surfaces: look.surfaces, doorX, stains: look.quality > 0 ? stains : undefined, quality: look.quality, era,
    };
    if (opts?.depth === false) parts = dressParts(authored, ctx);
    else {
      dressed = dressBuilding(authored, ctx);
      parts = dressed.parts;
    }
  }
  const vary = makeRng(look.seed, `vary|${Math.round(placed.x * 100)}|${Math.round(placed.z * 100)}|${bp.id}`);
  const height = emit(parts, authored.length, pal, env.batch, base, placed.w, placed.d, 1, look, uOff, vary, dressed ? depthOf(dressed) : null);
  if (dressed) emitStruts(dressed.struts, pal, env.batch, base, look, uOff, vary);
  if (stains.length > 0 && look.surfaces.wear > 0.1) emitStains(stains, env.visualBatch ?? env.batch, base);

  // Foundation, landing and steps, built in a frame whose zero is the bottom of the foundation.
  let run = 0;
  if ((lift > 0.02 || skirt > 0.02) && authored.length > 0) {
    const standing = authored.filter((p) => p.y < 0.3 && p.h >= 1 && p.tone !== 'glass' && p.tone !== 'glow');
    const b = partsBounds(standing.length > 0 ? standing : authored, placed.w, placed.d);
    const W = placed.w;
    const D = placed.d;
    const solidBox = (cx: number, cz: number, w: number, d: number, h: number): BlueprintPart =>
      ({ shape: 'box', x: cx / W, z: cz / D, y: 0, w: w / W, d: d / D, h, rot: 0, tone: 'wall', repeat: 1, gap: 0 });
    const under: BlueprintPart[] = [solidBox((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0 + 0.24, b.z1 - b.z0 + 0.24, skirt + lift)];
    // A deep foundation steps out toward its foot.
    if (skirt + lift > 0.6) under.push(solidBox((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0 + 0.5, b.z1 - b.z0 + 0.5, (skirt + lift) * 0.4));
    const rails: Strut[] = [];
    if (lift > 0.1) {
      const risers = Math.max(1, Math.ceil(lift / 0.18));
      const rise = lift / risers;
      const tread = 0.28;
      const landing = 0.9;
      const width = DOOR.w + 0.9;
      const face = b.z1 + 0.12;
      under.push(solidBox(doorX * W, face + landing / 2, width, landing, skirt + lift));
      for (let k = 1; k < risers; k++) under.push(solidBox(doorX * W, face + landing + (k - 0.5) * tread, width, tread, skirt + lift - k * rise));
      run = landing + (risers - 1) * tread + 0.12 + Math.max(0, b.z1 - D / 2);
      if (risers >= 3 && look.quality > 0 && opts?.dress !== false && opts?.depth !== false) {
        // A flight this high gets a handrail each side: posts at the wall, the head and the foot of the stair, a rail over them.
        const floor = skirt + lift;
        const foot = face + landing + (risers - 1) * tread - 0.06;
        for (const sx of [-1, 1]) {
          const x = doorX * W + sx * (width / 2 - 0.06);
          const stops: [number, number][] = [[face + 0.06, floor], [face + landing - 0.06, floor], [foot, skirt + rise]];
          for (const [z, y] of stops) rails.push({ ax: x, ay: y, az: z, bx: x, by: y + 0.95, bz: z, w: 0.06, t: 0.06, tone: 'dark' });
          for (let k = 0; k + 1 < stops.length; k++) {
            const [z0, y0] = stops[k] as [number, number];
            const [z1, y1] = stops[k + 1] as [number, number];
            rails.push({ ax: x, ay: y0 + 0.93, az: z0 - 0.03, bx: x, by: y1 + 0.93, bz: z1 + 0.03, w: 0.05, t: 0.06, tone: 'dark' });
          }
        }
      }
    }
    const low = new THREE.Matrix4().makeTranslation(placed.x, ground - skirt, placed.z).multiply(turn);
    emit(under, 0, { ...pal, wall: pal.base }, env.batch, low, W, D, 1, look, uOff, null);
    emitStruts(rails, pal, env.batch, low, look, uOff, null);
  }
  const door = new THREE.Vector3(doorX * placed.w, -lift, placed.d / 2 + 1 + run).applyMatrix4(base);
  return { height: height + lift, door };
}

/** Adds one prop built from parts on a size x size footprint; heights scale with `scale` only. */
export function addPropParts(
  parts: readonly BlueprintPart[], size: number, style: StyleSpec,
  placed: { x: number; z: number; rotY: number; scale: number; y?: number }, env: BlueprintEnv, opts?: BlueprintOptions,
): number {
  const look = lookFor(style, opts);
  const pal = palette(env.mats, look, { wall: 0, wall2: 0, roof: 0 });
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(placed.x, Number.isFinite(placed.y) ? (placed.y as number) : 0, placed.z),
    new THREE.Quaternion().setFromAxisAngle(UP, placed.rotY),
    new THREE.Vector3(1, 1, 1),
  );
  const fp = clamp(size, 0.3, 16) * placed.scale;
  const expanded = expandBlueprintParts(parts);
  const vary = makeRng(look.seed, `prop|${Math.round(placed.x * 100)}|${Math.round(placed.z * 100)}`);
  // Props are authored on a unit footprint with heights in the same unit, so height scales with size too.
  return emit(expanded, expanded.length, pal, env.batch, base, fp, fp, fp, look, 0, vary);
}
