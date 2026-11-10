// The procedural PBR surface library. Every SurfaceKind in the world spec becomes three tileable maps
// generated in the browser (see surfaces/field.ts for the pixel side): an sRGB albedo, a tangent-space
// normal map and a data map carrying height (R), roughness (G) and metalness (B). Maps are built once
// per (kind, colour, wear, wet, size, seed) and cached; materials built on them are cached too.
//
// Normal mapping needs no vertex tangents: three's standard material derives the tangent frame from
// screen-space derivatives of position and UV when the geometry has none, which is exact for the
// flat-shaded, box-projected geometry the town is made of and survives merging and mirroring.
//
// Textures are uploaded as DataTextures by default: the bytes reach the GPU untouched (a 2D canvas may
// colour-manage or premultiply) and the module runs under Node. A canvas factory can be injected to
// go through CanvasTexture instead.
import * as THREE from 'three';
import type { MoodSpec, StyleSpec, SurfaceKind, SurfaceSet, ThemeId } from '../world/spec';
import { COVER_SURFACES } from './surfaces/covers';
import type { SurfaceDef, SurfaceFamily, SurfacePixels, Texel } from './surfaces/field';
import { hexToRgb, renderSurface, sampleSurface } from './surfaces/field';
import { GROUND_SURFACES } from './surfaces/ground';
import { fbm, ss } from './surfaces/noise';
import { WALL_SURFACES } from './surfaces/walls';

export type Quality = 0 | 1 | 2;
/** Every SurfaceKind plus the painted finish used for accent parts. */
export type SurfaceId = SurfaceKind | 'paint';

const DEFS: Record<SurfaceId, SurfaceDef> = { ...WALL_SURFACES, ...COVER_SURFACES, ...GROUND_SURFACES };

export const SURFACE_KINDS = (Object.keys(DEFS) as SurfaceId[]).filter((k): k is SurfaceKind => k !== 'paint');
const KIND_SET: ReadonlySet<string> = new Set(SURFACE_KINDS);
export const isSurfaceKind = (v: unknown): v is SurfaceKind => typeof v === 'string' && KIND_SET.has(v);

/** Metres covered by one repeat of a surface's texture. */
export const surfaceScale = (kind: SurfaceId): number => DEFS[kind].scale;
export const surfaceFamily = (kind: SurfaceId): SurfaceFamily => DEFS[kind].family;

export interface SurfaceOpts {
  wear: number;
  wet: number;
  quality: Quality;
  seed: number;
  /** When true the material multiplies by the geometry's `color` attribute (per-building drift, ground grime). */
  tint?: boolean;
}

/**
 * What callers that pass no options get. A town build states its theme and mood when it infers
 * surfaces and its quality when it asks for the ground; buildings and props added afterwards without
 * options follow the same town instead of a fixed default.
 */
export interface SurfaceDefaults { quality: Quality; theme: ThemeId; mood: MoodSpec | undefined }
const defaults: SurfaceDefaults = { quality: 2, theme: 'medieval', mood: undefined };

export function setSurfaceDefaults(next: Partial<SurfaceDefaults>): void {
  Object.assign(defaults, next);
}
export function surfaceDefaults(): Readonly<SurfaceDefaults> {
  return defaults;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const step = (v: number): number => Math.round(clamp01(v) * 10) / 10;
const sizeFor = (q: Quality): number => (q === 0 ? 256 : 512);
const HEX = /^#[0-9a-f]{6}$/i;
const cleanHex = (hex: string): string => (HEX.test(hex) ? hex.toLowerCase() : '#808080');

/** The raw maps for a surface, without touching three.js or the DOM. */
export function surfacePixels(kind: SurfaceId, baseHex: string, opts: { wear: number; wet: number; size: number; seed: number }): SurfacePixels {
  return renderSurface(DEFS[kind], hexToRgb(cleanHex(baseHex)), opts);
}

/** One texel of a surface at any (u, v); a surface tiles when this is unchanged by whole steps in u and v. */
export function surfaceTexel(kind: SurfaceId, baseHex: string, u: number, v: number, opts: { wear: number; wet: number; seed: number }): Texel {
  return sampleSurface(DEFS[kind], hexToRgb(cleanHex(baseHex)), u, v, opts);
}

// ---- textures ---------------------------------------------------------------------------------

export interface Context2DLike {
  createImageData(w: number, h: number): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void;
}
export interface CanvasLike { width: number; height: number; getContext(kind: '2d'): Context2DLike | null }
export type CanvasFactory = (size: number) => CanvasLike;

let canvasFactory: CanvasFactory | null = null;

/** Routes texture upload through canvases from `factory` (CanvasTexture); null restores DataTexture. */
export function setCanvasFactory(factory: CanvasFactory | null): void {
  canvasFactory = factory;
}

function toTexture(pixels: Uint8ClampedArray, size: number, srgb: boolean): THREE.Texture {
  let tex: THREE.Texture | null = null;
  if (canvasFactory) {
    const canvas = canvasFactory(size);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(size, size);
      img.data.set(pixels);
      ctx.putImageData(img, 0, 0);
      tex = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
    }
  }
  if (!tex) tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  // Row 0 of the pixel arrays is v = 0, for both upload paths.
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface MapSet { albedo: THREE.Texture; normal: THREE.Texture; data: THREE.Texture; mats: Map<string, THREE.MeshStandardMaterial> }

/** Most recently used last. Old sets are released once the cache passes MAX_SETS. */
const sets = new Map<string, MapSet>();
const MAX_SETS = 28;

function releaseSet(s: MapSet): void {
  for (const m of s.mats.values()) m.dispose();
  s.mats.clear();
  s.albedo.dispose();
  s.normal.dispose();
  s.data.dispose();
}

function mapSet(kind: SurfaceId, hex: string, wear: number, wet: number, size: number, seed: number): MapSet {
  const key = `${kind}|${hex}|${wear}|${wet}|${size}|${seed}`;
  let s = sets.get(key);
  if (s) {
    sets.delete(key);
    sets.set(key, s);
    return s;
  }
  const px = surfacePixels(kind, hex, { wear, wet, size, seed });
  s = { albedo: toTexture(px.albedo, size, true), normal: toTexture(px.normal, size, false), data: toTexture(px.data, size, false), mats: new Map() };
  sets.set(key, s);
  if (sets.size > MAX_SETS) {
    // A released set that is still on screen re-uploads on its next draw; nothing breaks, it only leaves the cache.
    const oldest = sets.keys().next();
    if (!oldest.done) {
      const old = sets.get(oldest.value);
      sets.delete(oldest.value);
      if (old) releaseSet(old);
    }
  }
  return s;
}

function standard(s: MapSet, variant: string, make: (m: THREE.MeshStandardMaterial) => void): THREE.MeshStandardMaterial {
  let m = s.mats.get(variant);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: s.albedo, normalMap: s.normal, roughnessMap: s.data, metalnessMap: s.data, roughness: 1, metalness: 1,
    });
    make(m);
    s.mats.set(variant, m);
  }
  return m;
}

/**
 * The material for a surface in a base colour. UVs are expected in repeats, i.e. metres divided by
 * surfaceScale(kind); see surfaces/uv.ts. Cached: the same arguments return the same material.
 */
export function getSurface(kind: SurfaceId, baseHex: string, opts: SurfaceOpts): THREE.MeshStandardMaterial {
  const id: SurfaceId = kind in DEFS ? kind : 'plaster';
  const s = mapSet(id, cleanHex(baseHex), step(opts.wear), step(opts.wet), sizeFor(opts.quality), opts.seed | 0);
  return standard(s, opts.tint ? 'tint' : 'plain', (m) => {
    m.vertexColors = opts.tint === true;
    m.name = `surface:${id}`;
    m.userData.baseHex = cleanHex(baseHex);
  });
}

// ---- glass ------------------------------------------------------------------------------------

let windowGlow = 0.2;
const glassMats = new Map<string, THREE.MeshStandardMaterial>();
let glowMap: THREE.Texture | null = null;
const GLOW_GAIN = 2.4;

/** The lit-interior pattern behind window glass: soft pools of light, some panes dark. One repeat is 2.5 m. */
export function glowPixels(size: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const lit = ss(0.36, 0.6, fbm(u, v, 3, 3, 3, 71));
      const warm = fbm(u, v, 5, 5, 2, 73);
      const k = 0.12 + 0.88 * lit;
      const o = (y * size + x) * 4;
      px[o] = 255 * k;
      px[o + 1] = 255 * k * (0.82 + 0.14 * warm);
      px[o + 2] = 255 * k * (0.6 + 0.3 * warm);
      px[o + 3] = 255;
    }
  }
  return px;
}

/** Metres per repeat of the glass material's interior-glow map. */
export const GLASS_SCALE = 2.5;

/**
 * Window glass: dark, near-mirror, tinted, with a warm interior glow that setWindowGlow raises at dusk.
 * Reflections come from the scene environment map.
 */
export function glassMaterial(glassHex: string, glowHex: string): THREE.MeshStandardMaterial {
  const key = `${cleanHex(glassHex)}|${cleanHex(glowHex)}`;
  let m = glassMats.get(key);
  if (!m) {
    if (!glowMap) glowMap = toTexture(glowPixels(64), 64, true);
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cleanHex(glassHex)).multiplyScalar(0.45),
      roughness: 0.07,
      metalness: 0.85,
      emissive: new THREE.Color(cleanHex(glowHex)),
      emissiveMap: glowMap,
      emissiveIntensity: windowGlow * GLOW_GAIN,
    });
    m.name = 'surface:window';
    glassMats.set(key, m);
  }
  return m;
}

/** 0 = dark windows (day), 1 = fully lit interiors (night). Applies to every window, now and later. */
export function setWindowGlow(amount: number): void {
  windowGlow = clamp01(amount);
  for (const m of glassMats.values()) m.emissiveIntensity = windowGlow * GLOW_GAIN;
}

// ---- ground and roads -------------------------------------------------------------------------

const GROUND_GLSL = /* glsl */ `
float gHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float gNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

/** Minimal view of the shader object three hands to onBeforeCompile. */
export interface ShaderSource { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }

/**
 * Rewrites a standard material's shader so its maps are sampled by world position (x, z) instead of
 * the mesh's UVs, with a large-scale brightness drift that hides the repeat and, above wet 0.5,
 * puddles: mirror-smooth, darker, flat-normalled pools in the low parts of the height map.
 */
export function patchGroundShader(shader: ShaderSource, tile: number, wet: number): void {
  shader.uniforms.uTile = { value: 1 / tile };
  shader.uniforms.uWet = { value: wet };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTile;\nvarying vec2 vGroundXZ;')
    .replace('#include <uv_vertex>', `#include <uv_vertex>
	vGroundXZ = ( modelMatrix * vec4( position, 1.0 ) ).xz;
	#ifdef USE_MAP
		vMapUv = vGroundXZ * uTile;
	#endif
	#ifdef USE_NORMALMAP
		vNormalMapUv = vGroundXZ * uTile;
	#endif
	#ifdef USE_ROUGHNESSMAP
		vRoughnessMapUv = vGroundXZ * uTile;
	#endif
	#ifdef USE_METALNESSMAP
		vMetalnessMapUv = vGroundXZ * uTile;
	#endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform float uWet;\nvarying vec2 vGroundXZ;\n${GROUND_GLSL}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
	float gMacro = gNoise( vGroundXZ * 0.045 ) * 0.6 + gNoise( vGroundXZ * 0.19 + 7.3 ) * 0.4;
	diffuseColor.rgb *= 0.8 + 0.4 * gMacro;`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	float gPuddle = 0.0;
	#ifdef USE_ROUGHNESSMAP
		float gLie = gNoise( vGroundXZ * 0.11 + 3.1 ) * 0.7 + gNoise( vGroundXZ * 0.37 ) * 0.3 + ( texelRoughness.r - 0.5 ) * 0.3;
		float gFill = mix( 0.12, 0.44, clamp( ( uWet - 0.5 ) * 2.0, 0.0, 1.0 ) );
		gPuddle = step( 0.5, uWet ) * ( 1.0 - smoothstep( gFill - 0.035, gFill, gLie ) );
		float gDamp = uWet * ( 1.0 - smoothstep( gFill, gFill + 0.2, gLie ) );
		roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, gDamp );
		roughnessFactor = mix( roughnessFactor, 0.03, gPuddle );
		diffuseColor.rgb *= 1.0 - 0.18 * gDamp - 0.4 * gPuddle;
	#endif`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	normal = normalize( mix( normal, nonPerturbedNormal, gPuddle ) );`);
}

export interface GroundOpts { quality?: Quality; seed?: number }
export interface RoadOpts extends GroundOpts {
  /** 'road' is the paved or beaten way; 'track' is half worn back into the ground; 'plaza' is a lighter, tidier apron. */
  variant?: 'road' | 'track' | 'plaza';
}

function mixHex(a: string, b: string, t: number): string {
  return `#${new THREE.Color(cleanHex(a)).lerp(new THREE.Color(cleanHex(b)), t).getHexString()}`;
}

function worldMaterial(kind: SurfaceKind, hex: string, wear: number, wet: number, opts: GroundOpts, offset: number): THREE.MeshStandardMaterial {
  const w = step(wet);
  const s = mapSet(kind, cleanHex(hex), step(wear), w, sizeFor(opts.quality ?? defaults.quality), (opts.seed ?? 0) | 0);
  return standard(s, `world${offset}`, (m) => {
    const tile = DEFS[kind].scale;
    m.onBeforeCompile = (shader) => patchGroundShader(shader as unknown as ShaderSource, tile, w);
    m.customProgramCacheKey = () => 'townforge-ground';
    m.name = `ground:${kind}`;
    m.userData.baseHex = cleanHex(hex);
    if (offset !== 0) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = offset;
      m.polygonOffsetUnits = offset;
    }
  });
}

/**
 * The ground: `surfaces.ground` in `style.ground`, sampled by world position, so any mesh lying in the
 * xz plane (whatever its UVs or size) shows the texture at true scale. The colour is baked into the
 * map; `material.color` stays white and `material.userData.baseHex` records the style colour.
 */
export function groundMaterial(surfaces: SurfaceSet, style: StyleSpec, opts: GroundOpts = {}): THREE.MeshStandardMaterial {
  const kind = isSurfaceKind(surfaces.ground) ? surfaces.ground : 'dirt';
  if (opts.quality !== undefined) defaults.quality = opts.quality;
  return worldMaterial(kind, style.ground, surfaces.wear, surfaces.wet, opts, 0);
}

/** Roads, tracks and plazas: `surfaces.road` in `style.road`, world-sampled, with polygon offset so they can lie 1 to 3 cm above the ground. */
export function roadMaterial(surfaces: SurfaceSet, style: StyleSpec, opts: RoadOpts = {}): THREE.MeshStandardMaterial {
  const kind = isSurfaceKind(surfaces.road) ? surfaces.road : 'dirt';
  const variant = opts.variant ?? 'road';
  if (variant === 'track') return worldMaterial(kind, mixHex(style.road, style.ground, 0.5), Math.min(1, surfaces.wear + 0.2), surfaces.wet, opts, -2);
  if (variant === 'plaza') return worldMaterial(kind, mixHex(style.road, '#d6cfc2', 0.3), surfaces.wear * 0.6, surfaces.wet, opts, -3);
  return worldMaterial(kind, style.road, surfaces.wear, surfaces.wet, opts, -2);
}

// ---- inference --------------------------------------------------------------------------------

type Hint = Partial<Pick<SurfaceSet, 'wall' | 'wall2' | 'roof' | 'trim' | 'ground' | 'road'>>;

/** Words in a style name and the surfaces they imply. Earlier rows win field by field. */
const HINTS: readonly (readonly [RegExp, Hint])[] = [
  [/corrugat|shanty|shack|tin\b|scrap|container|dock|port\b|favela/, { wall: 'corrugated', wall2: 'rusted', roof: 'corrugated', trim: 'rusted' }],
  [/rust|derelict|wreck|salvage|junk/, { wall: 'rusted', wall2: 'corrugated', roof: 'corrugated', trim: 'rusted' }],
  [/hull|ship|station|bulkhead|submarine|orbital|starship/, { wall: 'hull_plate', wall2: 'metal_panel', roof: 'hull_plate', trim: 'metal_panel' }],
  [/glass|skyscraper|curtain wall|high-?rise|corporate/, { wall: 'glass_curtain', wall2: 'concrete', roof: 'concrete', trim: 'metal_panel' }],
  [/neon|cyber|arcology|chrome|steel|alloy|metal|titanium|industrial|foundry/, { wall: 'metal_panel', wall2: 'concrete', roof: 'metal_panel', trim: 'metal_panel' }],
  [/concrete|brutal|bunker|cement/, { wall: 'concrete', wall2: 'concrete', roof: 'concrete', trim: 'metal_panel' }],
  [/mushroom|fung|spore|myc|flesh|hive|grown|living|organic|gourd/, { wall: 'organic', wall2: 'bark', roof: 'organic', trim: 'bark', ground: 'moss', road: 'dirt' }],
  [/chitin|insect|carapace|beetle|shell/, { wall: 'chitin', wall2: 'organic', roof: 'chitin', trim: 'chitin' }],
  [/crystal|gem|quartz|amethyst|prism|obsidian/, { wall: 'crystal', wall2: 'stone', roof: 'crystal', trim: 'crystal', road: 'gravel' }],
  [/\bice\b|icy|frost|glaci|igloo|frozen/, { wall: 'ice', wall2: 'ice', roof: 'ice', trim: 'ice', ground: 'snow', road: 'snow' }],
  [/coral|reef|undersea|atlant|abyss|kelp/, { wall: 'coral', wall2: 'stone', roof: 'coral', trim: 'coral', ground: 'sand', road: 'sand' }],
  [/tree|bark|elven|treehouse|grove|druid|root/, { wall: 'bark', wall2: 'planks', roof: 'thatch', trim: 'bark', ground: 'moss', road: 'dirt' }],
  [/paper|shoji|edo|lacquer|pagoda|teahouse|kyoto|ryokan/, { wall: 'plaster', wall2: 'paper_screen', roof: 'tile', trim: 'timber', road: 'gravel' }],
  [/canvas|tent|yurt|nomad|caravan|bazaar|circus|pavilion|\bcamp/, { wall: 'canvas', wall2: 'canvas', roof: 'canvas', trim: 'timber', road: 'dirt' }],
  [/adobe|pueblo|mud ?brick|clay|kasbah|sandstone|desert|oasis|mesa/, { wall: 'adobe', wall2: 'adobe', roof: 'adobe', trim: 'timber', ground: 'sand', road: 'dirt' }],
  [/\blog\b|logs|cabin|lodge|longhouse|stave|viking|nordic/, { wall: 'log', wall2: 'planks', roof: 'shingle', trim: 'timber' }],
  [/thatch|straw|reed|hut\b|crofter/, { roof: 'thatch' }],
  [/slate|granite|monastery|abbey|castle|keep|fortress|citadel|gothic|basalt|ruin/, { wall: 'stone', wall2: 'stone', roof: 'slate', trim: 'stone', road: 'cobble' }],
  [/stone|rock|flint|masonry|cobble/, { wall: 'stone', wall2: 'stone', trim: 'stone', road: 'cobble' }],
  [/brick|terrace|victorian|mill\b|brownstone/, { wall: 'brick', wall2: 'brick', roof: 'slate', trim: 'stone', road: 'cobble' }],
  [/plaster|stucco|whitewash|half-?timber|tudor|lime|mediterranean|villa|wattle/, { wall: 'plaster', wall2: 'timber', roof: 'tile', trim: 'timber' }],
  [/timber|wood|plank|clapboard|frontier|saloon|pine|oak|cedar|driftwood|barn|pirate|wharf/, { wall: 'planks', wall2: 'timber', roof: 'shingle', trim: 'timber' }],
  [/snow|winter|alpine|tundra|arctic/, { ground: 'snow', road: 'snow' }],
  [/swamp|bog|marsh|bayou|mire/, { ground: 'mud', road: 'mud' }],
  [/moon|lunar|mars|martian|asteroid|crater|colony/, { ground: 'regolith', road: 'regolith' }],
  [/volcan|ash|burnt|scorch|cinder|ember/, { ground: 'ash', road: 'ash' }],
  [/dune|sand|beach|shore|island/, { ground: 'sand' }],
  [/forest|meadow|village|pasture|shire|garden/, { ground: 'grass' }],
];

const THEME_SURFACES: Record<ThemeId, Required<Hint>> = {
  western: { wall: 'planks', wall2: 'timber', roof: 'shingle', trim: 'timber', ground: 'dirt', road: 'dirt' },
  medieval: { wall: 'plaster', wall2: 'stone', roof: 'tile', trim: 'timber', ground: 'grass', road: 'cobble' },
  scifi: { wall: 'metal_panel', wall2: 'hull_plate', roof: 'metal_panel', trim: 'metal_panel', ground: 'concrete', road: 'concrete' },
  modern: { wall: 'brick', wall2: 'concrete', roof: 'concrete', trim: 'concrete', ground: 'grass', road: 'asphalt' },
};

/** A ground kind from the ground colour alone, for style names that say nothing about the land. */
function groundFromColour(hex: string): SurfaceKind | null {
  if (!HEX.test(hex)) return null;
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  const hue = hsl.h * 360;
  if (hsl.l > 0.8 && hsl.s < 0.35) return 'snow';
  if (hue > 62 && hue < 170 && hsl.s > 0.16) return 'grass';
  if (hue > 28 && hue <= 62 && hsl.l > 0.58 && hsl.s > 0.2) return 'sand';
  return null;
}

const WET_WEATHER: Partial<Record<MoodSpec['weather'], number>> = { rain: 0.6, storm: 0.8, mist: 0.3, fog: 0.25, snow: 0.15 };

/**
 * Surfaces for a style that names none: read from the words of `style.name`, then the ground colour,
 * then the theme. Wear follows words like "weathered" or "pristine"; wetness follows the weather.
 */
export function inferSurfaces(style: StyleSpec, theme: ThemeId, mood?: MoodSpec): SurfaceSet {
  defaults.theme = theme in THEME_SURFACES ? theme : 'medieval';
  defaults.mood = mood;
  return infer(style, theme, mood);
}

function infer(style: StyleSpec, theme: ThemeId, mood?: MoodSpec): SurfaceSet {
  const name = (typeof style.name === 'string' ? style.name : '').toLowerCase();
  const out: Hint = {};
  for (const [re, hint] of HINTS) {
    if (!re.test(name)) continue;
    for (const k of Object.keys(hint) as (keyof Hint)[]) out[k] ??= hint[k];
  }
  const base = THEME_SURFACES[theme] ?? THEME_SURFACES.medieval;
  const ground = out.ground ?? groundFromColour(style.ground) ?? (mood?.weather === 'snow' && mood.intensity > 0.5 ? 'snow' : base.ground);
  let wear = 0.4;
  if (/ruin|derelict|abandon|decay|rotting|wreck|crumbl|ancient|forgotten/.test(name)) wear = 0.85;
  else if (/weather|worn|rust|dusty|old|aged|batter|faded|grim|soot|shanty|scrap|frontier/.test(name)) wear = 0.65;
  else if (/pristine|new|gleam|polish|lacquer|clean|sleek|immaculate|corporate|chrome/.test(name)) wear = 0.12;
  let wet = /rain|soak|drench|wet|damp|swamp|bog|marsh|drown|flood/.test(name) ? 0.6 : 0;
  if (mood) wet = Math.max(wet, (WET_WEATHER[mood.weather] ?? 0) * (0.5 + 0.5 * clamp01(mood.intensity)) + (mood.weather === 'rain' || mood.weather === 'storm' ? 0.2 : 0));
  return {
    wall: out.wall ?? base.wall,
    wall2: out.wall2 ?? out.wall ?? base.wall2,
    roof: out.roof ?? base.roof,
    trim: out.trim ?? base.trim,
    ground,
    road: out.road ?? (ground === 'snow' || ground === 'sand' || ground === 'moss' ? ground : base.road),
    wear,
    wet: clamp01(wet),
  };
}

/** `style.surfaces` where it is present and valid, the inferred set for any field that is not. */
export function resolveSurfaces(style: StyleSpec, theme: ThemeId, mood?: MoodSpec): SurfaceSet {
  const inferred = infer(style, theme, mood);
  const s: Partial<SurfaceSet> | undefined = style.surfaces;
  if (!s || typeof s !== 'object') return inferred;
  const pick = (v: unknown, fb: SurfaceKind): SurfaceKind => (isSurfaceKind(v) ? v : fb);
  const num = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fb);
  return {
    wall: pick(s.wall, inferred.wall),
    wall2: pick(s.wall2, inferred.wall2),
    roof: pick(s.roof, inferred.roof),
    trim: pick(s.trim, inferred.trim),
    ground: pick(s.ground, inferred.ground),
    road: pick(s.road, inferred.road),
    wear: num(s.wear, inferred.wear),
    wet: num(s.wet, inferred.wet),
  };
}

/** Releases every cached texture and material. Call when no town is on screen. */
export function disposeSurfaces(): void {
  for (const s of sets.values()) releaseSet(s);
  sets.clear();
  for (const m of glassMats.values()) m.dispose();
  glassMats.clear();
  glowMap?.dispose();
  glowMap = null;
}
