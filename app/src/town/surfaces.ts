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
import { beginSurface, finishSurface, hexToRgb, renderSurface, sampleSurface, stepSurface } from './surfaces/field';
import { GROUND_SURFACES } from './surfaces/ground';
import { fbm, ss, vnoise } from './surfaces/noise';
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
  /**
   * When true the material weathers in world space (see patchSurfaceShader) and reads the geometry's
   * `wearing` attribute. Geometry must come through a GeoBatch, which supplies the attribute where it is missing.
   */
  worn?: boolean;
}

/**
 * What callers that pass no options get. A town build states its theme and mood when it infers
 * surfaces and its quality when it asks for the ground; buildings and props added afterwards without
 * options follow the same town instead of a fixed default.
 */
export interface SurfaceDefaults {
  quality: Quality; theme: ThemeId; mood: MoodSpec | undefined;
  /** The style and surfaces of the building most recently built, for things made beside it (its sign). */
  style?: StyleSpec; surfaces?: SurfaceSet;
  /** Free words for the period, e.g. WorldSpec.era; signs choose their lettering from it. */
  era?: string;
}
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

const setKey = (kind: SurfaceId, hex: string, wear: number, wet: number, size: number, seed: number): string => `${kind}|${hex}|${wear}|${wet}|${size}|${seed}`;

function mapSet(kind: SurfaceId, hex: string, wear: number, wet: number, size: number, seed: number, ready?: SurfacePixels): MapSet {
  const key = setKey(kind, hex, wear, wet, size, seed);
  let s = sets.get(key);
  if (s) {
    sets.delete(key);
    sets.set(key, s);
    return s;
  }
  const px = ready ?? surfacePixels(kind, hex, { wear, wet, size, seed });
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
  const wear = step(opts.wear);
  const wet = step(opts.wet);
  return standard(s, `${opts.tint ? 'tint' : 'plain'}${opts.worn ? '+worn' : ''}`, (m) => {
    m.vertexColors = opts.tint === true;
    m.name = `surface:${id}`;
    m.userData.baseHex = cleanHex(baseHex);
    if (opts.worn) {
      const look = wearLook(DEFS[id].family, wear, wet);
      m.userData.wearing = true;
      m.onBeforeCompile = (shader) => patchSurfaceShader(shader as unknown as ShaderSource, look);
      m.customProgramCacheKey = () => 'townforge-surface';
    }
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

// ---- weathering in world space ----------------------------------------------------------------

const SURFACE_GLSL = /* glsl */ `
float sHash3( vec3 p ) {
	p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
	p += dot( p, p.yxz + 33.33 );
	return fract( ( p.x + p.y ) * p.z );
}
float sNoise3( vec3 p ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	float a = mix( sHash3( i ), sHash3( i + vec3( 1.0, 0.0, 0.0 ) ), f.x );
	float b = mix( sHash3( i + vec3( 0.0, 1.0, 0.0 ) ), sHash3( i + vec3( 1.0, 1.0, 0.0 ) ), f.x );
	float c = mix( sHash3( i + vec3( 0.0, 0.0, 1.0 ) ), sHash3( i + vec3( 1.0, 0.0, 1.0 ) ), f.x );
	float d = mix( sHash3( i + vec3( 0.0, 1.0, 1.0 ) ), sHash3( i + vec3( 1.0, 1.0, 1.0 ) ), f.x );
	return mix( mix( a, b, f.y ), mix( c, d, f.y ), f.z );
}
float sNoise2( vec2 p ) {
	return sNoise3( vec3( p, 17.3 ) );
}
`;

/** How a surface material weathers in the shader; see patchSurfaceShader. */
export interface WearLook {
  /** Paler exposed material along convex edges, 0..1. */
  edge: number;
  /** Run-off under top edges and dirt at the foot of upright faces, 0..1. */
  grime: number;
  /** Sun-bleach and dust on faces that look up, 0..1. */
  bleach: number;
  /** How much a run-off streak lowers roughness (wet) or, negative, raises it (dry deposit). */
  dripGloss: number;
  /** How much a worn edge lowers roughness: bare metal shines, chipped stone does not. */
  edgeGloss: number;
}

const EDGE_BY_FAMILY: Record<SurfaceFamily, number> = {
  wood: 0.8, masonry: 0.7, render: 0.5, metal: 1, glass: 0.2, roof: 0.5, fabric: 0.2, organic: 0.2, mineral: 0.3, ground: 0.3, paint: 1,
};

function wearLook(family: SurfaceFamily, wear: number, wet: number): WearLook {
  return {
    edge: EDGE_BY_FAMILY[family] * (0.25 + 0.75 * wear),
    grime: family === 'glass' ? 0.3 * wear : 0.3 + 0.7 * wear,
    bleach: family === 'glass' || family === 'mineral' ? 0.15 : 0.4 + 0.6 * wear,
    dripGloss: wet > 0.05 ? 0.3 : -0.08,
    edgeGloss: family === 'metal' || family === 'paint' ? 0.16 : 0,
  };
}

/**
 * Rewrites a standard material's shader so the surface weathers where it stands rather than where its
 * texture repeats. In world space: a slow drift of value, warmth and roughness that no tile boundary
 * follows. From the geometry's `wearing` attribute (distance in metres from the fragment to the left,
 * right, bottom and top edge of its face; see blueprint-mesh.ts): paler exposed material along convex
 * edges, broken up by noise; dark run-off hanging from the top edge of every upright face; dirt packed
 * along its foot. From the world normal: sun-bleach and dust on faces that look up, shade under ones
 * that look down.
 */
export function patchSurfaceShader(shader: ShaderSource, look: WearLook): void {
  shader.uniforms.uSurf = { value: new THREE.Vector4(look.edge, look.grime, look.bleach, look.dripGloss) };
  shader.uniforms.uSurfGloss = { value: look.edgeGloss };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 wearing;\nvarying vec4 vWearing;\nvarying vec3 vSurfP;\nvarying vec3 vSurfN;')
    .replace('#include <uv_vertex>', `#include <uv_vertex>
	vWearing = wearing;
	vSurfP = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	vSurfN = normalize( mat3( modelMatrix ) * normal );`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform vec4 uSurf;\nuniform float uSurfGloss;\nvarying vec4 vWearing;\nvarying vec3 vSurfP;\nvarying vec3 vSurfN;\n${SURFACE_GLSL}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
	float sUp = vSurfN.y;
	float sMacro = sNoise3( vSurfP * 0.31 ) * 0.6 + sNoise3( vSurfP * 1.17 + 11.0 ) * 0.4;
	float sTone = sNoise3( vSurfP * 0.07 + 31.0 ) - 0.5;
	diffuseColor.rgb *= 0.86 + 0.28 * sMacro;
	diffuseColor.rgb *= vec3( 1.0 + 0.05 * sTone, 1.0, 1.0 - 0.07 * sTone );
	float sBreak = sNoise3( vSurfP * 13.0 ) * 0.65 + sNoise3( vSurfP * 41.0 ) * 0.35;
	float sUpright = 1.0 - smoothstep( 0.3, 0.6, abs( sUp ) );
	float sTop = smoothstep( 0.4, 0.7, sUp );
	float sDown = smoothstep( 0.4, 0.7, - sUp );
	float sFaceW = vWearing.x + vWearing.y;
	float sFaceH = vWearing.z + vWearing.w;
	float sSide = min( vWearing.x, vWearing.y );
	float sNear = mix( min( sSide, min( vWearing.z, vWearing.w ) ), sSide, sUpright );
	float sBand = clamp( 0.22 * min( sFaceW, sFaceH ), 0.008, 0.07 );
	float sEdge = ( 1.0 - smoothstep( 0.0, sBand * ( 0.25 + 1.5 * sBreak ), sNear ) ) * uSurf.x * ( 1.0 - sDown );
	float sLum = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb, vec3( sLum ), 0.5 ) * 1.5 + 0.035, sEdge * 0.6 );
	float sAlong = vSurfP.x * vSurfN.z - vSurfP.z * vSurfN.x;
	float sRun = sNoise2( vec2( sAlong * 9.0, vSurfP.y * 0.35 ) );
	float sLen = min( 0.15 + 1.5 * sNoise2( vec2( sAlong * 2.3, 3.7 ) ), 0.6 * sFaceH );
	float sDrip = sUpright * ( 1.0 - smoothstep( 0.0, sLen, vWearing.w ) ) * smoothstep( 0.42, 0.75, sRun ) * uSurf.y;
	float sFoot = sUpright * ( 1.0 - smoothstep( 0.0, min( 0.1 + 0.35 * sBreak, 0.5 * sFaceH ), vWearing.z ) ) * uSurf.y;
	diffuseColor.rgb *= 1.0 - 0.42 * sDrip - 0.3 * sFoot - 0.22 * sDown;
	float sBleach = sTop * uSurf.z * ( 0.5 + 0.5 * sMacro );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( sLum ) * 1.15 + 0.03, 0.3 * sBleach );`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	roughnessFactor = clamp( roughnessFactor + ( sMacro - 0.5 ) * 0.22 + 0.12 * sBleach + 0.1 * sFoot - uSurf.w * sDrip - uSurfGloss * sEdge, 0.04, 1.0 );`);
}

/** Name of the per-vertex attribute patchSurfaceShader reads, and the value that means "far from any edge". */
export const WEARING = 'wearing';
export const WEARING_FAR = 9;

// ---- run-off stains ---------------------------------------------------------------------------

let stainMaps: { stain: THREE.Texture; rust: THREE.Texture } | null = null;
const stainMats = new Map<string, THREE.MeshBasicMaterial>();

/**
 * The multiply colour of a run-off stain hanging from v = 1: ragged streaks that thin out and fade
 * toward v = 0 and toward both sides. White where there is no stain. RGBA, row 0 is v = 0.
 */
export function stainPixels(width: number, height: number, tone: readonly [number, number, number], seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const side = ss(0, 0.16, Math.min(u, 1 - u));
      const reach = 0.25 + 0.75 * vnoise(u, 0.5, 6, 1, seed) * (0.6 + 0.4 * vnoise(u, 0.5, 23, 1, seed + 1));
      const fall = 1 - ss(0, reach, 1 - v);
      const strand = 0.35 + 0.65 * ss(0.3, 0.7, fbm(u, v, 14, 1, 2, seed + 2));
      const a = Math.min(1, side * fall * fall * strand * (0.75 + 0.5 * vnoise(u, v, 9, 5, seed + 3)));
      const o = (y * width + x) * 4;
      px[o] = 255 * (1 - a * (1 - tone[0]));
      px[o + 1] = 255 * (1 - a * (1 - tone[1]));
      px[o + 2] = 255 * (1 - a * (1 - tone[2]));
      px[o + 3] = 255;
    }
  }
  return px;
}

function stainTexture(tone: readonly [number, number, number], seed: number): THREE.Texture {
  const tex = new THREE.DataTexture(stainPixels(64, 128, tone, seed), 64, 128, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The material for run-off stains: quads laid a few millimetres proud of a wall, whose colour multiplies
 * what is behind them (order-independent, no depth write, no shadow). 'rust' is the brown that runs from
 * iron fixings; 'stain' is the grey-brown of dirty water. UV v = 1 is the top of the stain. One draw per kind.
 */
export function stainMaterial(kind: 'stain' | 'rust' = 'stain'): THREE.MeshBasicMaterial {
  let m = stainMats.get(kind);
  if (!m) {
    if (!stainMaps) stainMaps = { stain: stainTexture([0.5, 0.47, 0.43], 5), rust: stainTexture([0.6, 0.4, 0.27], 9) };
    m = new THREE.MeshBasicMaterial({
      map: stainMaps[kind], transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    m.name = `stain:${kind}`;
    m.userData.noShadow = true;
    // In fog a stain fades to nothing (white under multiply) instead of taking the fog colour.
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float stainFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float stainFog = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 1.0 ), stainFog );
#endif`);
    };
    m.customProgramCacheKey = () => 'townforge-stain';
    stainMats.set(kind, m);
  }
  return m;
}

// ---- colour restraint -------------------------------------------------------------------------

/**
 * The colours a material is found in, in HSL. Inside `hue` (degrees, may run below 0 to wrap through
 * red) a tone may be as saturated as `sat`. Outside it the tone is read as a paint, dye or tint over
 * the material and keeps its hue at no more than `off` saturation; with no `off` the hue is pulled to
 * the nearest end of the band, because nobody paints a log or a dune. `l` bounds lightness.
 */
interface ToneRange { hue?: readonly [number, number]; sat: number; off?: number; l: readonly [number, number] }

const TONE_RANGES: Record<SurfaceId, ToneRange> = {
  timber: { hue: [14, 46], sat: 0.42, off: 0.32, l: [0.1, 0.8] },
  planks: { hue: [14, 46], sat: 0.42, off: 0.32, l: [0.1, 0.8] },
  log: { hue: [14, 42], sat: 0.4, l: [0.08, 0.52] },
  bark: { hue: [14, 44], sat: 0.38, off: 0.2, l: [0.07, 0.5] },
  plaster: { hue: [18, 62], sat: 0.3, off: 0.3, l: [0.25, 0.9] },
  adobe: { hue: [12, 42], sat: 0.45, l: [0.22, 0.74] },
  brick: { hue: [-10, 30], sat: 0.5, off: 0.22, l: [0.14, 0.62] },
  stone: { hue: [14, 56], sat: 0.28, off: 0.13, l: [0.12, 0.82] },
  cobble: { hue: [14, 56], sat: 0.24, off: 0.12, l: [0.12, 0.7] },
  concrete: { hue: [18, 62], sat: 0.12, off: 0.08, l: [0.18, 0.8] },
  metal_panel: { sat: 0.45, l: [0.1, 0.82] },
  corrugated: { sat: 0.45, l: [0.1, 0.8] },
  rusted: { hue: [6, 36], sat: 0.5, off: 0.3, l: [0.1, 0.62] },
  hull_plate: { sat: 0.38, l: [0.1, 0.8] },
  glass_curtain: { sat: 0.4, l: [0.1, 0.7] },
  shingle: { hue: [14, 46], sat: 0.38, off: 0.2, l: [0.1, 0.56] },
  tile: { hue: [0, 34], sat: 0.52, off: 0.34, l: [0.14, 0.62] },
  thatch: { hue: [26, 56], sat: 0.45, l: [0.22, 0.7] },
  slate: { sat: 0.18, l: [0.1, 0.52] },
  canvas: { hue: [24, 56], sat: 0.35, off: 0.4, l: [0.14, 0.86] },
  paper_screen: { hue: [28, 62], sat: 0.3, off: 0.3, l: [0.35, 0.92] },
  organic: { sat: 0.5, l: [0.08, 0.8] },
  chitin: { sat: 0.5, l: [0.05, 0.7] },
  crystal: { sat: 0.55, l: [0.1, 0.85] },
  coral: { sat: 0.52, l: [0.12, 0.82] },
  ice: { hue: [165, 235], sat: 0.45, off: 0.22, l: [0.42, 0.95] },
  dirt: { hue: [10, 46], sat: 0.42, l: [0.1, 0.56] },
  mud: { hue: [10, 50], sat: 0.36, l: [0.08, 0.45] },
  sand: { hue: [16, 54], sat: 0.5, off: 0.32, l: [0.18, 0.86] },
  grass: { hue: [52, 145], sat: 0.42, off: 0.34, l: [0.1, 0.5] },
  moss: { hue: [56, 150], sat: 0.42, off: 0.34, l: [0.08, 0.46] },
  snow: { sat: 0.22, l: [0.6, 0.97] },
  asphalt: { sat: 0.1, l: [0.07, 0.42] },
  gravel: { hue: [14, 52], sat: 0.22, off: 0.1, l: [0.14, 0.72] },
  regolith: { hue: [2, 48], sat: 0.46, off: 0.2, l: [0.1, 0.76] },
  ash: { sat: 0.1, l: [0.08, 0.62] },
  paint: { sat: 0.55, l: [0.12, 0.8] },
};

/** No surface, however it is painted, is more saturated than this; only light sources are. */
export const MAX_SURFACE_SATURATION = 0.55;

const hslScratch = { h: 0, s: 0, l: 0 };
const colScratch = new THREE.Color();

function clampTone(hex: string, range: ToneRange, wear: number, lShift = 0, ceiling = MAX_SURFACE_SATURATION): string {
  colScratch.set(cleanHex(hex)).getHSL(hslScratch, THREE.SRGBColorSpace);
  let h = hslScratch.h * 360;
  let s = hslScratch.s;
  // Age takes the colour out of everything: a ruin keeps three quarters of what a new wall may have.
  const age = 1 - 0.25 * clamp01(wear);
  let cap = range.sat;
  if (range.hue && s > 0.08) {
    const [lo, hi] = range.hue;
    const mid = (lo + hi) / 2;
    // Hue as an offset from the middle of the band, -180..180.
    const d = ((((h - mid) % 360) + 540) % 360) - 180;
    const half = (hi - lo) / 2;
    if (Math.abs(d) > half) {
      if (range.off === undefined) h = (mid + Math.sign(d) * half + 360) % 360;
      else cap = range.off;
    }
  }
  s = Math.min(s, cap * age, ceiling);
  const l = Math.min(range.l[1], Math.max(range.l[0], hslScratch.l + lShift));
  return `#${colScratch.setHSL(h / 360, s, l, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
}

const lightness = (hex: string): number => colScratch.set(cleanHex(hex)).getHSL(hslScratch, THREE.SRGBColorSpace).l;

/** One colour pulled into the natural range of a surface kind; `wear` 0..1 ages it further. */
export function groundTone(kind: SurfaceId, hex: string, wear = 0): string {
  return clampTone(hex, TONE_RANGES[kind in TONE_RANGES ? kind : 'paint'], wear);
}

/**
 * The colour of a small painted accent or a sign: the one place fresh paint may pass the surface limit,
 * though still short of a pure hue, and less the more the place has aged.
 */
export function signTone(hex: string, wear = 0): string {
  return clampTone(hex, { sat: 0.72, l: [0.14, 0.72] }, wear, 0, 0.72);
}

const DARK_RANGE: ToneRange = { sat: 0.32, l: [0.04, 0.26] };
const GLASS_RANGE: ToneRange = { sat: 0.4, l: [0.14, 0.6] };

/**
 * The realism rule. Returns the style with every tone pulled toward the colours its SurfaceKind is
 * found in: timber cannot be bright orange, concrete stays neutral, a painted accent is allowed but
 * aged, and nothing but `glow` passes MAX_SURFACE_SATURATION. Hue is kept wherever the material could
 * carry it (as paint, dye or a tint in the stone), and where clamping would flatten the difference in
 * lightness between the wall and its second wall, roof or trim, the second tone is moved back apart.
 * Applying it twice changes nothing more.
 */
export function groundedPalette(style: StyleSpec, surfaces: SurfaceSet): StyleSpec {
  const wear = clamp01(surfaces.wear);
  const tone = (kind: SurfaceKind, hex: string): string => clampTone(hex, TONE_RANGES[isSurfaceKind(kind) ? kind : 'plaster'], wear);
  const out: StyleSpec = {
    ...style,
    wall: tone(surfaces.wall, style.wall),
    wall2: tone(surfaces.wall2, style.wall2),
    roof: tone(surfaces.roof, style.roof),
    trim: tone(surfaces.trim, style.trim),
    accent: clampTone(style.accent, TONE_RANGES.paint, wear),
    dark: clampTone(style.dark, DARK_RANGE, wear),
    glass: clampTone(style.glass, GLASS_RANGE, 0),
    ground: tone(surfaces.ground, style.ground),
    road: tone(surfaces.road, style.road),
  };
  const wallWas = lightness(style.wall);
  const wallNow = lightness(out.wall);
  for (const key of ['wall2', 'roof', 'trim'] as const) {
    const was = lightness(style[key]) - wallWas;
    const now = lightness(out[key]) - wallNow;
    if (Math.abs(was) < 0.06 || (Math.sign(now) === Math.sign(was) && Math.abs(now) >= 0.6 * Math.abs(was))) continue;
    const kind = surfaces[key];
    out[key] = clampTone(out[key], TONE_RANGES[isSurfaceKind(kind) ? kind : 'plaster'], wear, 0.8 * was - now);
  }
  return out;
}

export interface GroundOpts { quality?: Quality; seed?: number }
export interface RoadOpts extends GroundOpts {
  /** 'road' is the paved or beaten way; 'track' is half worn back into the ground; 'plaza' is a lighter, tidier apron. */
  variant?: 'road' | 'track' | 'plaza';
}

function mixHex(a: string, b: string, t: number): string {
  return `#${new THREE.Color(cleanHex(a)).lerp(new THREE.Color(cleanHex(b)), t).getHexString()}`;
}

function worldMaterial(kind: SurfaceKind, hex: string, wear: number, wet: number, opts: GroundOpts, offset: number, styleHex: string): THREE.MeshStandardMaterial {
  const w = step(wet);
  const s = mapSet(kind, cleanHex(hex), step(wear), w, sizeFor(opts.quality ?? defaults.quality), (opts.seed ?? 0) | 0);
  return standard(s, `world${offset}`, (m) => {
    const tile = DEFS[kind].scale;
    m.onBeforeCompile = (shader) => patchGroundShader(shader as unknown as ShaderSource, tile, w);
    m.customProgramCacheKey = () => 'townforge-ground';
    m.name = `ground:${kind}`;
    // baseHex is the colour the style asked for; bakedHex is the colour in the map, after restraint.
    m.userData.baseHex = cleanHex(styleHex);
    m.userData.bakedHex = cleanHex(hex);
    if (offset !== 0) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = offset;
      m.polygonOffsetUnits = offset;
    }
  });
}

/**
 * The ground: `surfaces.ground` in `style.ground`, sampled by world position, so any mesh lying in the
 * xz plane (whatever its UVs or size) shows the texture at true scale. The colour, held to the natural
 * range of the ground kind (groundTone), is baked into the map; `material.color` stays white,
 * `material.userData.baseHex` records the style colour and `userData.bakedHex` the colour in the map.
 */
export function groundMaterial(surfaces: SurfaceSet, style: StyleSpec, opts: GroundOpts = {}): THREE.MeshStandardMaterial {
  if (opts.quality !== undefined) defaults.quality = opts.quality;
  const g = groundLook(surfaces, style, 'ground');
  return worldMaterial(g.kind, g.hex, g.wear, surfaces.wet, opts, 0, style.ground);
}

/** Kind, baked colour and wear of the ground or one road variant. The colour is held to the kind's natural range. */
function groundLook(surfaces: SurfaceSet, style: StyleSpec, variant: 'ground' | 'road' | 'track' | 'plaza'): { kind: SurfaceKind; hex: string; wear: number } {
  if (variant === 'ground') {
    const kind = isSurfaceKind(surfaces.ground) ? surfaces.ground : 'dirt';
    return { kind, hex: groundTone(kind, style.ground, surfaces.wear), wear: surfaces.wear };
  }
  const kind = isSurfaceKind(surfaces.road) ? surfaces.road : 'dirt';
  const road = groundTone(kind, style.road, surfaces.wear);
  if (variant === 'track') return { kind, hex: mixHex(road, groundLook(surfaces, style, 'ground').hex, 0.5), wear: Math.min(1, surfaces.wear + 0.2) };
  if (variant === 'plaza') return { kind, hex: mixHex(road, '#d6cfc2', 0.3), wear: surfaces.wear * 0.6 };
  return { kind, hex: road, wear: surfaces.wear };
}

/** Roads, tracks and plazas: `surfaces.road` in `style.road`, world-sampled, with polygon offset so they can lie 1 to 3 cm above the ground. */
export function roadMaterial(surfaces: SurfaceSet, style: StyleSpec, opts: RoadOpts = {}): THREE.MeshStandardMaterial {
  const variant = opts.variant ?? 'road';
  const g = groundLook(surfaces, style, variant);
  return worldMaterial(g.kind, g.hex, g.wear, surfaces.wet, opts, variant === 'plaza' ? -3 : -2, variant === 'road' ? style.road : g.hex);
}

// ---- warming ----------------------------------------------------------------------------------

/** One surface a world is about to need. Wear and wet are 0..1; quality and seed default as in getSurface. */
export interface SurfaceRequest { kind: SurfaceId; hex: string; wear: number; wet: number; quality?: Quality; seed?: number }

/** The ground, road, track and plaza surfaces groundMaterial and roadMaterial will ask for. */
export function groundRequests(surfaces: SurfaceSet, style: StyleSpec, opts: GroundOpts = {}): SurfaceRequest[] {
  return (['ground', 'road', 'track', 'plaza'] as const).map((variant) => {
    const g = groundLook(surfaces, style, variant);
    return { kind: g.kind, hex: g.hex, wear: g.wear, wet: surfaces.wet, quality: opts.quality, seed: opts.seed };
  });
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const breathe = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Generates the maps for every surface in `list` that is not cached yet, a few rows at a time, handing
 * the thread back to the page every `sliceMs` milliseconds, so a world can load behind a moving
 * progress screen without a hitch. Afterwards getSurface, groundMaterial and roadMaterial find the same
 * surfaces ready. Safe to call again or alongside the synchronous path; duplicates are generated once.
 */
export async function warmSurfaces(list: readonly SurfaceRequest[], sliceMs = 7): Promise<void> {
  let t0 = now();
  for (const req of list) {
    const kind: SurfaceId = req.kind in DEFS ? req.kind : 'plaster';
    const hex = cleanHex(req.hex);
    const wear = step(req.wear);
    const wet = step(req.wet);
    const size = sizeFor(req.quality ?? defaults.quality);
    const seed = (req.seed ?? 0) | 0;
    if (sets.has(setKey(kind, hex, wear, wet, size, seed))) continue;
    const job = beginSurface(DEFS[kind], hexToRgb(hex), { wear, wet, size, seed });
    while (stepSurface(job, 8)) {
      if (now() - t0 >= sliceMs) {
        await breathe();
        t0 = now();
      }
    }
    await breathe();
    t0 = now();
    // Another caller may have built it synchronously while this one was waiting.
    if (!sets.has(setKey(kind, hex, wear, wet, size, seed))) mapSet(kind, hex, wear, wet, size, seed, finishSurface(job));
  }
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
  for (const m of stainMats.values()) m.dispose();
  stainMats.clear();
  stainMaps?.stain.dispose();
  stainMaps?.rust.dispose();
  stainMaps = null;
}
