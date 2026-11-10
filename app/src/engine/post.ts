// Film pipeline: scene (HDR, MSAA) -> ambient occlusion -> air (fog, shafts, lamp halos, cloud shadow) ->
// weather overlay -> focus pull (conversations, top tier) -> bloom -> final grade. Tone mapping happens once, in the final pass. The numeric state the
// sky rig and the atmosphere write lives here so neither has to know about the composer.

import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  NoBlending,
  RGBAFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { PerspectiveCamera, Texture, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { GradeKind } from '../world/spec';
import { makeRng } from '../world/rng';

export type Quality = 0 | 1 | 2;
export type Vec3 = readonly [number, number, number];

// ---- Quality tiers -----------------------------------------------------------------------------

export interface QualityTier {
  /** Upper bound on the device pixel ratio. */
  pixelRatio: number;
  /** MSAA samples on the scene target. */
  msaa: number;
  /** Ambient occlusion samples per pixel; 0 turns the pass off. */
  aoSamples: number;
  /** Upper bound on the pixel count of the occlusion buffer. */
  aoPixels: number;
  /** Depth taps of the light-shaft march; 0 turns it off. */
  shaftTaps: number;
  /** Bloom chain size relative to the frame. */
  bloomScale: number;
  chromatic: boolean;
  /** How many of the nearest lamps get a halo in the air; 0 turns the halos off. */
  haloLamps: number;
  /** Lens dirt and halation on the bloom. */
  lens: boolean;
  /** Shallow focus while a conversation is framed. */
  focusPull: boolean;
}

export const QUALITY_TIERS: readonly [QualityTier, QualityTier, QualityTier] = [
  { pixelRatio: 1, msaa: 0, aoSamples: 0, aoPixels: 0, shaftTaps: 0, bloomScale: 0.5, chromatic: false, haloLamps: 0, lens: false, focusPull: false },
  { pixelRatio: 1.5, msaa: 2, aoSamples: 8, aoPixels: 520_000, shaftTaps: 12, bloomScale: 1, chromatic: true, haloLamps: 4, lens: true, focusPull: false },
  { pixelRatio: 2, msaa: 4, aoSamples: 16, aoPixels: 1_300_000, shaftTaps: 24, bloomScale: 1, chromatic: true, haloLamps: 6, lens: true, focusPull: true },
];

export const QUALITY_WINDOW_FRAMES = 90;
export const QUALITY_DOWN_FPS = 40;
export const QUALITY_UP_FPS = 58;
export const QUALITY_UP_HOLD_MS = 10_000;
const QUALITY_UP_HOLD_MAX_MS = 160_000;
const QUALITY_WARMUP_FRAMES = 45;
const QUALITY_STALL_MS = 250;
/** A step down this soon after a step up means the upper tier does not hold; the next try waits longer. */
const QUALITY_REGRET_MS = 30_000;

export interface QualityState {
  level: Quality;
  /** Auto stepping never goes above this. */
  ceiling: Quality;
  frames: number;
  accMs: number;
  /** Time spent above the step-up rate since the last window that fell short. */
  goodMs: number;
  /** How long the frame rate must hold before a step up. Doubles after a step up that did not hold. */
  upHoldMs: number;
  sinceUpMs: number;
  warmup: number;
}

export function initialQualityState(level: Quality = 2, ceiling: Quality = 2): QualityState {
  return {
    level: Math.min(level, ceiling) as Quality,
    ceiling,
    frames: 0,
    accMs: 0,
    goodMs: 0,
    upHoldMs: QUALITY_UP_HOLD_MS,
    sinceUpMs: Number.POSITIVE_INFINITY,
    warmup: QUALITY_WARMUP_FRAMES,
  };
}

/**
 * Feeds one frame time into the tier controller and returns the same state object. Every 90 frames
 * the mean rate is judged: under 40 fps steps down at once, 10 s above 58 fps steps up.
 */
export function stepQuality(s: QualityState, frameMs: number): QualityState {
  if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > QUALITY_STALL_MS) return s; // tab switch or a compile hitch
  if (s.warmup > 0) {
    s.warmup--;
    return s;
  }
  s.frames++;
  s.accMs += frameMs;
  if (s.frames < QUALITY_WINDOW_FRAMES) return s;

  const fps = (1000 * s.frames) / s.accMs;
  const windowMs = s.accMs;
  s.frames = 0;
  s.accMs = 0;
  s.sinceUpMs += windowMs;

  if (fps < QUALITY_DOWN_FPS) {
    s.goodMs = 0;
    if (s.level > 0) {
      if (s.sinceUpMs < QUALITY_REGRET_MS) s.upHoldMs = Math.min(QUALITY_UP_HOLD_MAX_MS, s.upHoldMs * 2);
      s.level = (s.level - 1) as Quality;
      s.warmup = QUALITY_WARMUP_FRAMES;
    }
    return s;
  }
  if (fps > QUALITY_UP_FPS) {
    s.goodMs += windowMs;
    if (s.goodMs >= s.upHoldMs && s.level < s.ceiling) {
      s.level = (s.level + 1) as Quality;
      s.goodMs = 0;
      s.sinceUpMs = 0;
      s.warmup = QUALITY_WARMUP_FRAMES;
    }
  } else {
    s.goodMs = 0;
  }
  return s;
}

/** Starting tier from the GPU name the browser reports: software rasterisers start at 0, integrated and mobile chips at 1. */
export function initialQualityFor(gpuName: string): Quality {
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpuName)) return 0;
  if (/intel|mali|adreno|powervr|apple gpu|videocore|radeon(\(tm\))? (graphics|vega|\d{3}m)/i.test(gpuName)) return 1;
  return 2;
}

const qualityListeners = new Set<(q: Quality) => void>();
let publishedQuality: Quality = 2;

export function currentQuality(): Quality {
  return publishedQuality;
}

/** Calls `fn` whenever the renderer changes tier. Returns the unsubscribe function. */
export function onQuality(fn: (q: Quality) => void): () => void {
  qualityListeners.add(fn);
  return () => {
    qualityListeners.delete(fn);
  };
}

export function publishQuality(q: Quality): void {
  if (q === publishedQuality) return;
  publishedQuality = q;
  for (const fn of qualityListeners) fn(q);
}

// ---- Grades ------------------------------------------------------------------------------------

export interface GradeParams {
  /** Raises (or, negative, crushes) the blacks per channel. */
  lift: Vec3;
  /** Midtone power per channel; above 1 brightens. */
  gamma: Vec3;
  /** White point per channel. */
  gain: Vec3;
  /** Split toning: colour multipliers at the dark and the bright end. */
  shadows: Vec3;
  highlights: Vec3;
  saturation: number;
  /** 0 leaves the curve alone, 1 is a full S-curve. */
  contrast: number;
  /** Multiplier on the scene exposure. */
  exposure: number;
  /** 0..1 darkening at the frame corners. */
  vignette: number;
  /** Grain amplitude in display units. */
  grain: number;
  /**
   * 0..1: how much of a saturated warm colour (a lamp, a neon sign, a fire) is spared from the grade, so a
   * cool look still carries its complementary accents. See accentWeight.
   */
  keep: number;
}

export const GRADE_KINDS: readonly GradeKind[] = [
  'neutral', 'golden', 'teal_orange', 'cold_steel', 'sepia', 'neon_noir', 'verdant', 'bleached', 'crimson', 'moonlit',
];

/**
 * Restrained looks: the split tones stay within about a tenth of neutral and no grade adds saturation to
 * what the scene had, so a look colours the light without turning surfaces into poster paint.
 */
export const GRADES: Record<GradeKind, GradeParams> = {
  neutral: {
    lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], shadows: [1, 1, 1], highlights: [1, 1, 1],
    saturation: 0.94, contrast: 0.22, exposure: 1, vignette: 0.24, grain: 0.022, keep: 0,
  },
  golden: {
    lift: [0.008, 0.004, 0], gamma: [1.02, 1.0, 0.97], gain: [1.03, 1.0, 0.95], shadows: [0.95, 1.0, 1.06], highlights: [1.04, 1.0, 0.92],
    saturation: 0.97, contrast: 0.3, exposure: 1.03, vignette: 0.3, grain: 0.028, keep: 0.5,
  },
  teal_orange: {
    lift: [0, 0.003, 0.008], gamma: [1, 1, 1], gain: [1.02, 1.0, 0.97], shadows: [0.86, 1.01, 1.12], highlights: [1.09, 1.0, 0.89],
    saturation: 0.98, contrast: 0.34, exposure: 1, vignette: 0.3, grain: 0.026, keep: 0.7,
  },
  cold_steel: {
    lift: [0, 0.003, 0.01], gamma: [0.98, 1.0, 1.02], gain: [0.96, 1.0, 1.05], shadows: [0.88, 0.99, 1.12], highlights: [0.97, 1.0, 1.04],
    saturation: 0.72, contrast: 0.38, exposure: 0.98, vignette: 0.34, grain: 0.032, keep: 0.8,
  },
  sepia: {
    lift: [0.016, 0.01, 0.002], gamma: [1.02, 1.0, 0.96], gain: [1.06, 1.0, 0.86], shadows: [1.05, 0.99, 0.91], highlights: [1.05, 1.0, 0.89],
    saturation: 0.44, contrast: 0.28, exposure: 1.02, vignette: 0.36, grain: 0.044, keep: 0,
  },
  neon_noir: {
    lift: [0, 0.002, 0.008], gamma: [0.99, 0.98, 1.01], gain: [1.02, 0.99, 1.04], shadows: [0.9, 0.96, 1.14], highlights: [1.07, 0.98, 1.03],
    saturation: 1.02, contrast: 0.36, exposure: 1.12, vignette: 0.36, grain: 0.034, keep: 0.85,
  },
  verdant: {
    lift: [0.002, 0.006, 0.002], gamma: [0.99, 1.02, 0.98], gain: [0.98, 1.03, 0.96], shadows: [0.92, 1.03, 1.02], highlights: [1.04, 1.02, 0.92],
    saturation: 0.98, contrast: 0.26, exposure: 1, vignette: 0.28, grain: 0.024, keep: 0.7,
  },
  bleached: {
    lift: [0.012, 0.012, 0.014], gamma: [1.02, 1.02, 1.02], gain: [1.04, 1.04, 1.03], shadows: [0.98, 1.0, 1.03], highlights: [1.02, 1.0, 0.98],
    saturation: 0.6, contrast: 0.5, exposure: 1.06, vignette: 0.28, grain: 0.038, keep: 0,
  },
  crimson: {
    lift: [0.008, 0, 0.002], gamma: [1.02, 0.98, 0.98], gain: [1.05, 0.97, 0.94], shadows: [1.0, 0.9, 0.97], highlights: [1.09, 0.97, 0.91],
    saturation: 0.96, contrast: 0.4, exposure: 0.98, vignette: 0.38, grain: 0.032, keep: 0.5,
  },
  moonlit: {
    lift: [0, 0.003, 0.012], gamma: [0.97, 1.0, 1.04], gain: [0.9, 0.98, 1.1], shadows: [0.82, 0.95, 1.2], highlights: [0.94, 1.0, 1.08],
    saturation: 0.66, contrast: 0.34, exposure: 1.08, vignette: 0.36, grain: 0.036, keep: 0.85,
  },
};

const LUMA: Vec3 = [0.2126, 0.7152, 0.0722];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth01(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

const ACCENT_SATURATION: readonly [number, number] = [0.35, 0.7];
const ACCENT_WARMTH: readonly [number, number] = [0.1, 0.4];
const ACCENT_FLOOR = 0.06;

/**
 * 0..1: how much a display colour counts as a warm accent. 1 for a saturated orange, yellow, red or magenta
 * that is not lost in the blacks; 0 for greys, for cool colours and for near-black. Kept in step with
 * GRADE_GLSL below.
 */
export function accentWeight(rgb: Vec3): number {
  const hi = Math.max(rgb[0], rgb[1], rgb[2]);
  const lo = Math.min(rgb[0], rgb[1], rgb[2]);
  const inv = 1 / Math.max(hi, 1e-4);
  const sat = smooth01(((hi - lo) * inv - ACCENT_SATURATION[0]) / (ACCENT_SATURATION[1] - ACCENT_SATURATION[0]));
  const warm = smooth01(((rgb[0] - rgb[2]) * inv - ACCENT_WARMTH[0]) / (ACCENT_WARMTH[1] - ACCENT_WARMTH[0]));
  return sat * warm * smooth01(hi / ACCENT_FLOOR);
}

/**
 * The cast a grade gives a neutral mid-tone, with its brightest channel at 1. The player fill light takes
 * this colour, so the light on the character belongs to the look.
 */
export function gradeTint(grade: GradeParams, strength = 1): [number, number, number] {
  const k = clamp01(strength);
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) c[i] = (grade.gain[i] ?? 1) * 0.5 * ((grade.shadows[i] ?? 1) + (grade.highlights[i] ?? 1));
  const top = Math.max(c[0], c[1], c[2], 1e-4);
  return [1 + (c[0] / top - 1) * k, 1 + (c[1] / top - 1) * k, 1 + (c[2] / top - 1) * k];
}

/**
 * The grade as the final pass applies it: display-linear colour in (after tone mapping, 0..1), display-linear
 * out. Kept in step with GRADE_GLSL below; the tests run this one.
 */
export function applyGrade(rgb: Vec3, grade: GradeParams, strength = 1): [number, number, number] {
  const c: [number, number, number] = [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  const o: Vec3 = [c[0], c[1], c[2]];
  for (let i = 0; i < 3; i++) {
    const v = c[i] ?? 0;
    const lifted = Math.max(0, (grade.gain[i] ?? 1) * (v + (grade.lift[i] ?? 0) * (1 - v)));
    const g = Math.pow(lifted, 1 / (grade.gamma[i] ?? 1));
    const s = Math.sqrt(g);
    const curved = s + (smooth01(s) - s) * grade.contrast;
    c[i] = s > 1 ? g : curved * curved;
  }
  let l = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  const t = smooth01(Math.sqrt(Math.max(0, l)));
  for (let i = 0; i < 3; i++) {
    const sh = grade.shadows[i] ?? 1;
    c[i] = (c[i] ?? 0) * (sh + ((grade.highlights[i] ?? 1) - sh) * t);
  }
  l = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  const k = clamp01(strength) * (1 - clamp01(grade.keep) * accentWeight(o));
  return [
    (o[0] ?? 0) + (clamp01(l + (c[0] - l) * grade.saturation) - (o[0] ?? 0)) * k,
    (o[1] ?? 0) + (clamp01(l + (c[1] - l) * grade.saturation) - (o[1] ?? 0)) * k,
    (o[2] ?? 0) + (clamp01(l + (c[2] - l) * grade.saturation) - (o[2] ?? 0)) * k,
  ];
}

const GRADE_GLSL = /* glsl */ `
  const vec2 ACCENT_SAT = vec2(${ACCENT_SATURATION[0].toFixed(3)}, ${ACCENT_SATURATION[1].toFixed(3)});
  const vec2 ACCENT_WARM = vec2(${ACCENT_WARMTH[0].toFixed(3)}, ${ACCENT_WARMTH[1].toFixed(3)});
  const float ACCENT_FLOOR = ${ACCENT_FLOOR.toFixed(3)};
  vec3 applyGrade(vec3 c) {
    vec3 o = c;
    vec3 g = pow(max(uGain * (c + uLift * (1.0 - c)), vec3(0.0)), 1.0 / uGamma);
    vec3 s = sqrt(g);
    vec3 curved = mix(s, s * s * (3.0 - 2.0 * s), uContrast);
    c = mix(curved * curved, g, step(vec3(1.0), s));
    float l = dot(c, LUMA);
    float t = smoothstep(0.0, 1.0, sqrt(max(l, 0.0)));
    c *= mix(uShadows, uHighlights, t);
    l = dot(c, LUMA);
    c = clamp(mix(vec3(l), c, uSaturation), 0.0, 1.0);
    // Warm accents are spared: see accentWeight.
    float hi = max(o.r, max(o.g, o.b));
    float lo = min(o.r, min(o.g, o.b));
    float inv = 1.0 / max(hi, 1e-4);
    float accent = smoothstep(ACCENT_SAT.x, ACCENT_SAT.y, (hi - lo) * inv) * smoothstep(ACCENT_WARM.x, ACCENT_WARM.y, (o.r - o.b) * inv)
      * smoothstep(0.0, ACCENT_FLOOR, hi);
    return mix(o, c, uStrength * (1.0 - uKeep * accent));
  }
`;

// ---- Shared air state --------------------------------------------------------------------------

/**
 * What the air is doing this frame. The sky rig writes the first group every time the hour or preset
 * changes; the atmosphere writes the second. The pipeline folds both into its uniforms before it renders.
 */
export const AIR = {
  /** True while a film pipeline is alive: fog is then drawn in post and scene.fog stays empty. */
  postActive: false,

  // ---- written by the sky rig
  /** Horizon radiance, linear. */
  fogColor: new Color(0.62, 0.72, 0.84),
  /** Ground-level extinction, 1/m. */
  fogDensity: 0.001,
  /** Unit vector towards the key light (sun or moon). */
  keyDir: new Vector3(0.4, 0.6, 0.5).normalize(),
  /** Key colour times its intensity. */
  keyColor: new Color(4, 3.8, 3.4),
  /** Sky fill colour times its intensity. */
  ambient: new Color(0.2, 0.24, 0.3),
  keyLevel: 4,
  daylight: 1,
  cloudCover: 0.35,
  /** 0..1: how much of the key reaches the ground as a beam (low under overcast). */
  beam: 1,
  /** Tone-mapping exposure the sky rig set, before the weather and the grade. */
  exposure: 0.5,
  /** Unit vector towards the moon the night key shines from, at any hour. */
  moonDir: new Vector3(-0.4, 0.5, -0.5).normalize(),

  // ---- written by the sky features
  /** Multiplier on the sun's key light and on the sky it lights; an eclipse lowers it. */
  keyDim: 1,
  /** False while a sky feature draws the moon, so the rig keeps its own disc hidden. */
  rigMoon: true,

  // ---- written by the player
  /** True while a conversation is framed: the top tier pulls focus to `focus`. */
  focusOn: false,
  /** World point the lens focuses on. */
  focus: new Vector3(),

  // ---- written by the pipeline when the grade changes
  /** Colour cast of the grade; the sky rig tints the player fill light with it. */
  fillTint: new Color(1, 1, 1),

  // ---- written by the atmosphere
  densityMul: 1,
  densityAdd: 0,
  /** 1/m: how fast the fog thins with height. */
  falloff: 0.07,
  /** World height the fog sits on. */
  groundY: 0,
  fogTint: new Color(1, 1, 1),
  fogTintMix: 0,
  /** 0..1 light scattered in the air. */
  haze: 0.3,
  /** 0..1 lightning. */
  flash: 0,
  /** 0..1 depth of the drifting cloud shadows. */
  cloudShadow: 0.4,
  /** How fast the cloud-shadow pattern travels, in pattern widths per second. */
  cloudSpeed: new Vector2(0.0037, 0.0016),
  /** Where the pattern has got to; the pipeline advances it. */
  cloudDrift: new Vector2(0, 0),
  exposureMul: 1,
  /** Multiplier on the light shafts: thick air throws longer ones, rain breaks them up. */
  shaftGain: 1,
  /** 0..1: how much lamp light the air itself catches (fog, mist, rain). */
  halo: 0.2,
};

/** How many of the nearest lit lamps are handed to shaders that draw their glow. */
export const LAMP_COUNT = 6;
/**
 * The nearest lit lamps, nearest first, written by the sky rig: `pos` holds x, y, z, radius per lamp, `col`
 * the colour times its slot weight, `gain` the day/night level. The air pass and the weather read them.
 */
export const LAMP_GLOW = {
  pos: new Float32Array(LAMP_COUNT * 4),
  col: new Float32Array(LAMP_COUNT * 3),
  gain: 0,
};

/** Puts the atmosphere's half of AIR back to a clear day. */
export function resetAirMods(): void {
  AIR.densityMul = 1;
  AIR.densityAdd = 0;
  AIR.falloff = 0.07;
  AIR.fogTint.setRGB(1, 1, 1);
  AIR.fogTintMix = 0;
  AIR.haze = 0.3;
  AIR.flash = 0;
  AIR.cloudShadow = 0.4;
  AIR.cloudSpeed.set(0.0037, 0.0016);
  AIR.exposureMul = 1;
  AIR.shaftGain = 1;
  AIR.halo = 0.2;
}

/** Strength of the lamp halos in the air pass, from the lamp level, the haze and how much the air holds. */
export function haloStrengthFor(lampGain: number, haze: number, halo: number): number {
  const g = Number.isFinite(lampGain) ? clamp01(lampGain) : 0;
  const h = Number.isFinite(haze) ? clamp01(haze) : 0;
  const a = Number.isFinite(halo) ? clamp01(halo) : 0;
  return g * (0.01 + 0.05 * h + 0.07 * a);
}

/** Colour the fog leans to looking away from the key; towards the key it leans to the key's own hue. */
const FOG_COOL: Vec3 = [0.84, 0.95, 1.12];
/** How far the fog colour leans warm on the key side and cool away from it, at a full beam. */
export const FOG_SIDE_TINT = 0.5;

/**
 * Circle of confusion of the focus pull, 0 sharp .. 1 fully soft, for a view depth in metres. A band round the
 * focus distance stays sharp; the background softens over a few focus distances, the foreground less.
 */
export function focusBlur(depth: number, focus: number): number {
  const f = Math.max(0.5, focus);
  if (depth >= f) return smooth01((depth - (f * 1.3 + 0.6)) / (f * 2.7 + 3.4));
  return 0.6 * smooth01((f * 0.75 - depth) / (f * 0.5));
}

/**
 * Uniform objects any overlay material may hold by reference: the pipeline refreshes them once per frame.
 * tDepth is the resolved scene depth, so an overlay fragment can test and soften itself against the scene.
 */
export const AIR_UNIFORMS = {
  tDepth: { value: null as Texture | null },
  tNoise: { value: null as Texture | null },
  /** Drawing-buffer size in pixels. */
  uResolution: { value: new Vector2(1, 1) },
  uNear: { value: 0.1 },
  uFar: { value: 6000 },
  /** Linear radiance above which a pixel blooms. Emissive colours scaled past this glow. */
  uBloomLevel: { value: 4 },
  uFogColor: { value: new Color(0.62, 0.72, 0.84) },
  uKeyColor: { value: new Color(4, 3.8, 3.4) },
  uAmbient: { value: new Color(0.2, 0.24, 0.3) },
  uKeyDir: { value: new Vector3(0, 1, 0) },
  uTime: { value: 0 },
};

const BLOOM_FLOOR = 0.8;
/** Power the ambient occlusion is raised to before it darkens the fill. */
export const AO_POWER = 1.6;
/** Light-shaft strength at full haze, looking at the key. */
export const SHAFT_STRENGTH = 0.4;
/** How much of the bloom comes back through dirt on the lens and as halation. */
const LENS_DIRT = 0.5;
/** Rate the focus pull eases in and out, per second. */
const FOCUS_EASE = 2.2;

/** Radiance where bloom starts: above anything the key light can make a matt surface, and above the horizon haze. */
export function bloomThresholdFor(keyLevel: number, fogLuminance: number): number {
  return Math.max(BLOOM_FLOOR, 1.02 * keyLevel, 1.3 * fogLuminance);
}

/** How much brighter than the horizon the fog is drawn at night, at full haze. */
export const NIGHT_FOG_LIFT = 0.35;

/**
 * Multiplier on the fog colour. By day it is 1: the fog is the horizon. At night hazy air catches the moon
 * and the lamps, so distant walls fade into a pale veil that still shows their shape, not into the dark.
 */
export function nightFogGain(haze: number, daylight: number): number {
  const h = Number.isFinite(haze) ? clamp01(haze) : 0;
  const d = Number.isFinite(daylight) ? clamp01(daylight) : 1;
  return 1 + NIGHT_FOG_LIFT * h * (1 - d);
}

/** Optical depth of the height fog along a ray, as the air pass computes it. `dirY` is the ray's vertical direction cosine. */
export function fogOpticalDepth(density: number, falloff: number, cameraHeight: number, dirY: number, distance: number, sky = false): number {
  const dy = dirY * distance;
  const bdy = Math.max(-30, falloff * dy);
  const integ = Math.abs(bdy) > 1e-3 ? (1 - Math.exp(-bdy)) / bdy : 1 - 0.5 * bdy;
  const h = Math.min(400, Math.max(-8, cameraHeight));
  const layer = (1 - FOG_FLOOR) * Math.exp(-falloff * h) * integ * distance;
  const floor = FOG_FLOOR * (sky ? Math.min(distance, FOG_FLOOR_DEPTH / Math.max(Math.abs(dirY), 0.02)) : distance);
  return density * (layer + floor);
}

/** Share of the fog that does not thin with height. */
const FOG_FLOOR = 0.22;
/** Thickness of that uniform share when looking through it at the sky, metres. */
const FOG_FLOOR_DEPTH = 150;
const SKY_DISTANCE = 1200;
const MAX_RADIANCE = 64;

// ---- Tileable noise ----------------------------------------------------------------------------

/** Four octaves of wrapped value noise in 0..255, `size` squared; tiles in both directions. */
export function makeTileNoise(size: number, seed: number): Uint8Array {
  const rng = makeRng(seed, 'tile-noise');
  const octaves = [4, 8, 16, 32];
  const lattices = octaves.map((n) => {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = rng.next();
    return a;
  });
  const raw = new Float32Array(size * size);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      for (let o = 0; o < octaves.length; o++) {
        const n = octaves[o] ?? 4;
        const lat = lattices[o];
        if (lat === undefined) continue;
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const a = lat[y0 * n + x0] ?? 0;
        const b = lat[y0 * n + x1] ?? 0;
        const c = lat[y1 * n + x0] ?? 0;
        const d = lat[y1 * n + x1] ?? 0;
        v += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        amp *= 0.5;
      }
      raw[y * size + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const out = new Uint8Array(size * size);
  const span = hi - lo || 1;
  for (let i = 0; i < raw.length; i++) out[i] = Math.round((((raw[i] ?? 0) - lo) / span) * 255);
  return out;
}

const NOISE_SIZE = 128;

function makeNoiseTexture(): DataTexture {
  const a = makeTileNoise(NOISE_SIZE, 0x51a7e);
  const b = makeTileNoise(NOISE_SIZE, 0x0b5e55);
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  for (let i = 0; i < NOISE_SIZE * NOISE_SIZE; i++) {
    data[i * 4] = a[i] ?? 0;
    data[i * 4 + 1] = b[i] ?? 0;
    data[i * 4 + 2] = a[NOISE_SIZE * NOISE_SIZE - 1 - i] ?? 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---- Shaders -----------------------------------------------------------------------------------

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const AIR_FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tAO;
  uniform sampler2D tNoise;
  uniform mat4 uProjInv;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFogFalloff;
  uniform float uFogHeight;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunGlow;
  uniform vec2 uSunUv;
  uniform float uShaft;
  uniform vec3 uFogWarm;
  uniform vec3 uFogCool;
  uniform vec4 uLampPos[${LAMP_COUNT}];
  uniform vec3 uLampCol[${LAMP_COUNT}];
  uniform float uHalo;
  uniform float uAO;
  uniform vec3 uCloud;      // strength, coverage, 1 / pattern size in metres
  uniform vec2 uCloudDrift;
  uniform float uKey;
  uniform float uBloomLevel;
  uniform float uFlash;
  uniform float uFrame;
  varying vec2 vUv;

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  const vec3 FLASH_COLOR = vec3(0.72, 0.8, 1.0);
  const float SKY_DEPTH = 0.9999995;

  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec3 col = min(texture2D(tScene, vUv).rgb, vec3(${MAX_RADIANCE.toFixed(1)}));
    float depth = texture2D(tDepth, vUv).x;
    bool sky = depth >= SKY_DEPTH;

    vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vp.xyz /= vp.w;
    float dist = sky ? ${SKY_DISTANCE.toFixed(1)} : length(vp.xyz);
    vec3 dir = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
    float lum = dot(col, LUMA);
    float toSun = max(dot(dir, uSunDir), 0.0);

    if (sky) {
      col += FLASH_COLOR * (uFlash * (0.35 + 0.65 * texture2D(tNoise, dir.xz * 0.35 + 0.5).r));
    } else {
      #if AO_ON
        // Occlusion belongs to the fill light: ease it off where the key or an emitter dominates.
        // Raised to a power so creases and the foot of a wall go properly dark and objects sit on the ground.
        float direct = smoothstep(uKey * 0.2, uKey * 0.75, lum);
        float ao = pow(clamp(texture2D(tAO, vUv).r, 0.0, 1.0), uAO);
        col *= mix(1.0, ao, 1.0 - 0.45 * direct);
      #endif

      // Cloud shadow: the pattern sits on a plane overhead and is projected down the key direction.
      vec3 wp = uCamPos + dir * dist;
      vec2 cp = wp.xz + uSunDir.xz * ((180.0 - wp.y) / max(uSunDir.y, 0.2));
      vec2 cuv = cp * uCloud.z + uCloudDrift;
      float cn = texture2D(tNoise, cuv).r * 0.68 + texture2D(tNoise, cuv * 2.63 + 0.37 - uCloudDrift * 0.7).g * 0.32;
      float shade = smoothstep(0.86 - uCloud.y * 0.62, 1.06 - uCloud.y * 0.62, cn);
      float lit = smoothstep(uKey * 0.1, uKey * 0.42, lum) * (1.0 - smoothstep(uBloomLevel * 0.9, uBloomLevel * 1.5, lum));
      col *= 1.0 - uCloud.x * shade * lit * (1.0 - smoothstep(220.0, 480.0, dist));
    }

    // Height fog, integrated along the view ray.
    float bdy = max(uFogFalloff * dir.y * dist, -30.0);
    float integ = abs(bdy) > 1e-3 ? (1.0 - exp(-bdy)) / bdy : 1.0 - 0.5 * bdy;
    float h = clamp(uCamPos.y - uFogHeight, -8.0, 400.0);
    float layer = ${(1 - FOG_FLOOR).toFixed(2)} * exp(-uFogFalloff * h) * integ * dist;
    float flo = ${FOG_FLOOR.toFixed(2)} * (sky ? min(dist, ${FOG_FLOOR_DEPTH.toFixed(1)} / max(abs(dir.y), 0.02)) : dist);
    float trans = exp(-uFogDensity * (layer + flo));
    // The air is warm looking towards the key and cool looking away from it.
    vec3 fogCol = uFogColor * mix(uFogCool, uFogWarm, smoothstep(-0.7, 0.9, dot(dir, uSunDir)));
    fogCol += uSunColor * (uSunGlow * (0.3 * pow(toSun, 4.0) + 0.7 * pow(toSun, 28.0)));
    fogCol += FLASH_COLOR * (uFlash * 0.3);
    if (!sky) {
      // Aerial perspective: distance takes the colour out of a surface before it takes the surface.
      float veil = 1.0 - trans * trans * trans;
      col = mix(col, vec3(dot(col, LUMA)), 0.6 * veil);
    }
    col = mix(fogCol, col, trans);

    #if HALO_LAMPS > 0
      if (uHalo > 0.0005) {
        // Lamp halos: the light each lamp leaves in the air along this ray, greatest where the ray passes closest.
        vec3 halo = vec3(0.0);
        for (int i = 0; i < HALO_LAMPS; i++) {
          vec4 lp = uLampPos[i];
          vec3 toLamp = lp.xyz - uCamPos;
          float along = clamp(dot(toLamp, dir), 0.0, dist);
          vec3 off = toLamp - dir * along;
          float r2 = max(lp.w * lp.w, 0.01);
          float d2 = dot(off, off);
          float reach = max(0.0, 1.0 - d2 / (1.44 * r2));
          halo += uLampCol[i] * (reach * reach * lp.w / sqrt(d2 + 0.0025 * r2) / (1.0 + 0.012 * along));
        }
        col += halo * uHalo;
      }
    #endif

    #if SHAFT_TAPS > 0
      if (uShaft > 0.002) {
        // Light shafts: walk towards the key light on screen and count how much open sky the walk crosses.
        vec2 stepUv = (uSunUv - vUv) * (0.9 / float(SHAFT_TAPS));
        vec2 p = vUv + stepUv * ign(gl_FragCoord.xy + uFrame * 5.588238);
        float acc = 0.0;
        float w = 1.0;
        float wsum = 0.0;
        for (int i = 0; i < SHAFT_TAPS; i++) {
          acc += step(SKY_DEPTH, texture2D(tDepth, p).x) * w;
          wsum += w;
          w *= 0.95;
          p += stepUv;
        }
        float open = acc / wsum;
        col += uSunColor * (uShaft * open * open * (0.06 + 0.94 * pow(toSun, 6.0)));
      }
    #endif

    gl_FragColor = vec4(col, 1.0);
  }
`;

const FOCUS_TAPS = 12;
const FOCUS_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uFocus;
  uniform float uAmount;
  varying vec2 vUv;

  float viewDepth(vec2 uv) {
    float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  }

  // Kept in step with focusBlur.
  float blurAt(float depth) {
    float f = max(0.5, uFocus);
    if (depth >= f) return smoothstep(0.0, 1.0, (depth - (f * 1.3 + 0.6)) / (f * 2.7 + 3.4));
    return 0.6 * smoothstep(0.0, 1.0, (f * 0.75 - depth) / (f * 0.5));
  }

  void main() {
    vec3 centre = texture2D(tDiffuse, vUv).rgb;
    float c = blurAt(viewDepth(vUv)) * uAmount;
    if (c < 0.01) {
      gl_FragColor = vec4(centre, 1.0);
      return;
    }
    vec2 radius = c * 9.0 * (uResolution.y / 1080.0) / uResolution;
    vec3 sum = centre;
    float wsum = 1.0;
    for (int i = 0; i < ${FOCUS_TAPS}; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / ${FOCUS_TAPS.toFixed(1)});
      float a = fi * 2.39996323;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * radius;
      // A tap that is sharper than this pixel is in focus or in front of the blur: it must not smear into it.
      float w = clamp(blurAt(viewDepth(uv)) * uAmount / c, 0.0, 1.0);
      sum += texture2D(tDiffuse, uv).rgb * w;
      wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, 1.0);
  }
`;

const FINAL_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform sampler2D tNoise;
  uniform float uLens;
  uniform vec2 uResolution;
  uniform float uExposure;
  uniform vec3 uLift;
  uniform vec3 uGamma;
  uniform vec3 uGain;
  uniform vec3 uShadows;
  uniform vec3 uHighlights;
  uniform float uSaturation;
  uniform float uContrast;
  uniform float uStrength;
  uniform float uKeep;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uAberration;
  uniform float uTime;
  varying vec2 vUv;

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // three's ACES filmic fit, so the sky rig's exposure and haze maths hold exactly.
  vec3 acesFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 toneMap(vec3 color) {
    const mat3 inputMat = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777));
    const mat3 outputMat = mat3(
      vec3(1.60475, -0.10208, -0.00327),
      vec3(-0.53108, 1.10813, -0.07276),
      vec3(-0.07367, -0.00605, 1.07602));
    color *= uExposure / 0.6;
    color = outputMat * acesFit(inputMat * color);
    return clamp(color, 0.0, 1.0);
  }

  vec3 encode(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(vec3(0.0031308), c));
  }
  ${GRADE_GLSL}

  void main() {
    vec2 c = vUv - 0.5;
    #if CHROMATIC
      // Lateral colour: red and blue part ways towards the corners, as in a fast lens.
      vec2 off = c * dot(c, c) * uAberration;
      vec3 hdr = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b);
    #else
      vec3 hdr = texture2D(tDiffuse, vUv).rgb;
    #endif

    #if LENS
      // The glow again where the glass is dirty, and a red fringe of it as film halation. Both are faint.
      vec3 glow = max(texture2D(tBloom, vUv).rgb, vec3(0.0));
      vec2 luv = vUv * vec2(uResolution.x / uResolution.y, 1.0);
      float smear = smoothstep(0.52, 0.92, texture2D(tNoise, luv * 0.9 + 0.13).b);
      float specks = smoothstep(0.66, 0.9, texture2D(tNoise, luv * 4.3 + 0.41).g);
      hdr += glow * (uLens * (0.5 * smear + 0.35 * specks)) + glow * vec3(0.22, 0.06, 0.02) * uLens;
    #endif

    vec3 col = applyGrade(toneMap(max(hdr, vec3(0.0))));

    // Vignette: measured on a frame squeezed towards square, so wide screens darken at the sides too.
    vec2 vc = c * vec2(mix(1.0, uResolution.x / uResolution.y, 0.35), 1.0);
    float edge = smoothstep(0.32, 1.02, length(vc) * 1.42);
    col *= 1.0 - uVignette * edge * edge;

    col = encode(clamp(col, 0.0, 1.0));

    // Grain is strongest in the mids and fades into the blacks and the whites; it changes every frame.
    vec2 seed = gl_FragCoord.xy + fract(uTime * 7.31) * vec2(311.7, 173.3);
    float l = dot(col, LUMA);
    float n = hash12(seed) + hash12(seed + 19.19) - 1.0;
    col += n * uGrain * (0.35 + 2.6 * l * (1.0 - l));

    // One bit of triangular noise hides the banding of slow gradients in the sky and the fog.
    col += (hash12(seed + 71.7) + hash12(seed + 131.3) - 1.0) / 255.0;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- Passes ------------------------------------------------------------------------------------

class ScenePass extends Pass {
  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly target: WebGLRenderTarget,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
  }
}

class QuadPass extends Pass {
  private readonly quad: FullScreenQuad;

  constructor(
    readonly material: ShaderMaterial,
    private readonly prepare: (read: WebGLRenderTarget) => void,
  ) {
    super();
    this.quad = new FullScreenQuad(material);
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    this.prepare(readBuffer);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

/** Draws the overlay scene (weather) over the fogged frame. It has no depth buffer; overlay shaders test tDepth themselves. */
class OverlayPass extends Pass {
  constructor(
    private readonly overlay: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(renderer: WebGLRenderer, _write: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    if (this.overlay.children.length === 0) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.render(this.overlay, this.camera);
    renderer.autoClear = autoClear;
  }
}

// ---- Pipeline ----------------------------------------------------------------------------------

export interface PostPipeline {
  /** Objects here draw after the fog and before the bloom. */
  readonly overlay: Scene;
  render(dt: number): void;
  /** CSS size and the pixel ratio the renderer was given. */
  setSize(width: number, height: number, pixelRatio: number): void;
  setQuality(q: Quality): void;
  setGrade(grade: GradeKind, strength?: number): void;
  dispose(): void;
}

function setDefine(material: ShaderMaterial, key: string, value: number): void {
  if (material.defines[key] === value) return;
  material.defines[key] = value;
  material.needsUpdate = true;
}

export function createPostPipeline(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): PostPipeline {
  let quality: Quality = 2;
  let width = 1;
  let height = 1;
  let ratio = 1;
  let frame = 0;
  let clock = 0;
  let disposed = false;

  const depthTexture = new DepthTexture(1, 1, UnsignedIntType);
  depthTexture.minFilter = NearestFilter;
  depthTexture.magFilter = NearestFilter;
  const sceneTarget = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    samples: QUALITY_TIERS[quality].msaa,
    depthTexture,
  });
  sceneTarget.texture.name = 'film.scene';

  const buffer = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  buffer.texture.wrapS = ClampToEdgeWrapping;
  buffer.texture.wrapT = ClampToEdgeWrapping;
  const composer = new EffectComposer(renderer, buffer);

  const noise = makeNoiseTexture();
  const overlay = new Scene();

  const scenePass = new ScenePass(scene, camera, sceneTarget);

  // Built with its own (never allocated) buffers, then pointed at the scene depth; normals come from depth.
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.setGBuffer(depthTexture, undefined);
  gtao.output = GTAOPass.OUTPUT.Off;
  gtao.needsSwap = false;
  // A wide radius for the shade under eaves and between crates, a strong scale so the foot of every object reads.
  gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.2, distanceFallOff: 1, scale: 1.45, samples: 16, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });

  const airMaterial = new ShaderMaterial({
    name: 'film.air',
    defines: { AO_ON: 1, SHAFT_TAPS: QUALITY_TIERS[quality].shaftTaps, HALO_LAMPS: QUALITY_TIERS[quality].haloLamps },
    uniforms: {
      tScene: { value: sceneTarget.texture },
      tDepth: { value: depthTexture },
      tAO: { value: gtao.pdRenderTarget.texture },
      tNoise: { value: noise },
      uProjInv: { value: camera.projectionMatrixInverse },
      uCamWorld: { value: camera.matrixWorld },
      uCamPos: { value: new Vector3() },
      uFogColor: { value: new Color() },
      uFogDensity: { value: 0.001 },
      uFogFalloff: { value: 0.07 },
      uFogHeight: { value: 0 },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Color() },
      uSunGlow: { value: 0 },
      uSunUv: { value: new Vector2(0.5, 0.5) },
      uShaft: { value: 0 },
      uFogWarm: { value: new Color(1, 1, 1) },
      uFogCool: { value: new Color(1, 1, 1) },
      uLampPos: { value: LAMP_GLOW.pos },
      uLampCol: { value: LAMP_GLOW.col },
      uHalo: { value: 0 },
      uAO: { value: AO_POWER },
      uCloud: { value: [0, 0.35, 1 / 150] },
      uCloudDrift: { value: AIR.cloudDrift },
      uKey: { value: 4 },
      uBloomLevel: AIR_UNIFORMS.uBloomLevel,
      uFlash: { value: 0 },
      uFrame: { value: 0 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: AIR_FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const airPass = new QuadPass(airMaterial, () => undefined);

  const overlayPass = new OverlayPass(overlay, camera);

  // Focus pull: off (and skipped by the composer) except while a conversation is framed on the top tier.
  const focusMaterial = new ShaderMaterial({
    name: 'film.focus',
    uniforms: {
      tDiffuse: { value: null as Texture | null },
      tDepth: { value: depthTexture },
      uResolution: AIR_UNIFORMS.uResolution,
      uNear: AIR_UNIFORMS.uNear,
      uFar: AIR_UNIFORMS.uFar,
      uFocus: { value: 3 },
      uAmount: { value: 0 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: FOCUS_FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const focusPass = new QuadPass(focusMaterial, (read) => {
    const u = focusMaterial.uniforms['tDiffuse'];
    if (u !== undefined) u.value = read.texture;
  });
  focusPass.enabled = false;
  let focusAmount = 0;
  let focusDistance = 3;

  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.35, 0.62, 4);

  const startGrade = GRADES.neutral;
  const finalMaterial = new ShaderMaterial({
    name: 'film.final',
    defines: { CHROMATIC: 1, LENS: 1 },
    uniforms: {
      tDiffuse: { value: null as Texture | null },
      tBloom: { value: (bloom.renderTargetsHorizontal[0]?.texture ?? null) as Texture | null },
      tNoise: { value: noise },
      uLens: { value: LENS_DIRT },
      uResolution: AIR_UNIFORMS.uResolution,
      uExposure: { value: 0.5 },
      uLift: { value: new Vector3(...startGrade.lift) },
      uGamma: { value: new Vector3(...startGrade.gamma) },
      uGain: { value: new Vector3(...startGrade.gain) },
      uShadows: { value: new Vector3(...startGrade.shadows) },
      uHighlights: { value: new Vector3(...startGrade.highlights) },
      uSaturation: { value: startGrade.saturation },
      uContrast: { value: startGrade.contrast },
      uStrength: { value: 1 },
      uKeep: { value: startGrade.keep },
      uVignette: { value: startGrade.vignette },
      uGrain: { value: startGrade.grain },
      uAberration: { value: 0.0065 },
      uTime: { value: 0 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: FINAL_FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  let gradeExposure = startGrade.exposure;
  const finalPass = new QuadPass(finalMaterial, (read) => {
    const u = finalMaterial.uniforms['tDiffuse'];
    if (u !== undefined) u.value = read.texture;
  });

  composer.addPass(scenePass);
  composer.addPass(gtao);
  composer.addPass(airPass);
  composer.addPass(overlayPass);
  composer.addPass(focusPass);
  composer.addPass(bloom);
  composer.addPass(finalPass);

  AIR.postActive = true;
  AIR_UNIFORMS.tDepth.value = depthTexture;
  AIR_UNIFORMS.tNoise.value = noise;

  const applySize = (): void => {
    const tier = QUALITY_TIERS[quality];
    const w = Math.max(1, Math.floor(width * ratio));
    const h = Math.max(1, Math.floor(height * ratio));
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    sceneTarget.setSize(w, h);
    const aoScale = tier.aoPixels > 0 ? Math.min(1, Math.sqrt(tier.aoPixels / (w * h))) : 0.25;
    gtao.setSize(Math.max(1, Math.round(w * aoScale)), Math.max(1, Math.round(h * aoScale)));
    bloom.setSize(Math.max(2, Math.round(w * tier.bloomScale)), Math.max(2, Math.round(h * tier.bloomScale)));
    AIR_UNIFORMS.uResolution.value.set(w, h);
  };

  const applyQuality = (): void => {
    const tier = QUALITY_TIERS[quality];
    if (sceneTarget.samples !== tier.msaa) {
      sceneTarget.samples = tier.msaa;
      sceneTarget.dispose(); // the GL buffers are rebuilt with the new sample count on the next frame
    }
    gtao.enabled = tier.aoSamples > 0;
    if (tier.aoSamples > 0) gtao.updateGtaoMaterial({ samples: tier.aoSamples });
    setDefine(airMaterial, 'AO_ON', tier.aoSamples > 0 ? 1 : 0);
    setDefine(airMaterial, 'SHAFT_TAPS', tier.shaftTaps);
    setDefine(airMaterial, 'HALO_LAMPS', tier.haloLamps);
    setDefine(finalMaterial, 'CHROMATIC', tier.chromatic ? 1 : 0);
    setDefine(finalMaterial, 'LENS', tier.lens ? 1 : 0);
    applySize();
  };
  applyQuality();

  const air = airMaterial.uniforms;
  const fin = finalMaterial.uniforms;
  const camPos = air['uCamPos']?.value as Vector3;
  const fogColor = air['uFogColor']?.value as Color;
  const sunDir = air['uSunDir']?.value as Vector3;
  const sunColor = air['uSunColor']?.value as Color;
  const sunUv = air['uSunUv']?.value as Vector2;
  const cloud = air['uCloud']?.value as number[];
  const fogWarm = air['uFogWarm']?.value as Color;
  const fogCool = air['uFogCool']?.value as Color;
  const foc = focusMaterial.uniforms;
  const viewSun = new Vector3();
  const tint = new Color();

  const setNumber = (set: typeof air, key: string, v: number): void => {
    const u = set[key];
    if (u !== undefined) u.value = v;
  };

  const refresh = (dt: number): void => {
    frame = (frame + 1) % 1024;
    clock = (clock + dt) % 4096;

    const haze = Math.min(1, Math.max(0, AIR.haze));
    const fogGain = nightFogGain(haze, AIR.daylight);
    const fogLum = fogGain * (0.2126 * AIR.fogColor.r + 0.7152 * AIR.fogColor.g + 0.0722 * AIR.fogColor.b);
    fogColor.copy(AIR.fogColor).multiplyScalar(fogGain);
    if (AIR.fogTintMix > 0) {
      // A tint changes the hue of the fog, not how bright the horizon is.
      const tl = Math.max(0.02, 0.2126 * AIR.fogTint.r + 0.7152 * AIR.fogTint.g + 0.0722 * AIR.fogTint.b);
      tint.copy(AIR.fogTint).multiplyScalar(fogLum / tl);
      fogColor.lerp(tint, Math.min(1, AIR.fogTintMix));
    }
    const threshold = bloomThresholdFor(AIR.keyLevel, fogLum);

    camera.getWorldPosition(camPos);
    sunDir.copy(AIR.keyDir);
    sunColor.copy(AIR.keyColor).multiplyScalar(0.5);
    setNumber(air, 'uFogDensity', Math.max(0, AIR.fogDensity * AIR.densityMul + AIR.densityAdd));
    setNumber(air, 'uFogFalloff', Math.max(0.005, AIR.falloff));
    setNumber(air, 'uFogHeight', AIR.groundY);
    setNumber(air, 'uSunGlow', (0.06 + 0.4 * haze) * AIR.beam);
    setNumber(air, 'uHalo', haloStrengthFor(LAMP_GLOW.gain, haze, AIR.halo));

    // Side tint: towards the key the fog takes a share of the key's hue, away from it a cool cast.
    const side = FOG_SIDE_TINT * Math.min(1, Math.max(0, AIR.beam));
    const keyTop = Math.max(AIR.keyColor.r, AIR.keyColor.g, AIR.keyColor.b, 1e-4);
    fogWarm.setRGB(
      1 + (AIR.keyColor.r / keyTop - 1) * side,
      1 + (AIR.keyColor.g / keyTop - 1) * side,
      1 + (AIR.keyColor.b / keyTop - 1) * side,
    );
    // Dimming two channels to make a warm cast would darken the horizon on the key side: put the level back.
    fogWarm.multiplyScalar(1 / Math.max(0.5, 0.2126 * fogWarm.r + 0.7152 * fogWarm.g + 0.0722 * fogWarm.b));
    fogCool.setRGB(1 + (FOG_COOL[0] - 1) * side, 1 + (FOG_COOL[1] - 1) * side, 1 + (FOG_COOL[2] - 1) * side);
    setNumber(air, 'uKey', Math.max(0.3, AIR.keyLevel));
    setNumber(air, 'uFlash', AIR.flash);
    setNumber(air, 'uFrame', frame);
    cloud[0] = AIR.cloudShadow * AIR.daylight * AIR.beam;
    cloud[1] = AIR.cloudCover;
    AIR.cloudDrift.addScaledVector(AIR.cloudSpeed, dt);

    // Where the key light sits on screen, and how much of a shaft it can throw from there.
    viewSun.copy(AIR.keyDir).transformDirection(camera.matrixWorldInverse);
    let shaft = 0;
    if (viewSun.z < -0.05) {
      const e = camera.projectionMatrix.elements;
      const nx = ((e[0] ?? 1) * viewSun.x) / -viewSun.z;
      const ny = ((e[5] ?? 1) * viewSun.y) / -viewSun.z;
      sunUv.set(nx * 0.5 + 0.5, ny * 0.5 + 0.5);
      const off = Math.max(Math.abs(nx), Math.abs(ny));
      const onScreen = 1 - Math.min(1, Math.max(0, (off - 0.9) / 0.9));
      const facing = Math.min(1, (-viewSun.z - 0.05) / 0.25);
      shaft = haze * AIR.beam * onScreen * facing * SHAFT_STRENGTH * Math.min(2, Math.max(0, AIR.shaftGain));
    }
    setNumber(air, 'uShaft', shaft);

    // Focus pull: eases in when a conversation is framed and out when it ends; the pass is skipped at rest.
    const wantFocus = AIR.focusOn && QUALITY_TIERS[quality].focusPull ? 1 : 0;
    focusAmount += (wantFocus - focusAmount) * (1 - Math.exp(-FOCUS_EASE * dt));
    if (wantFocus === 0 && focusAmount < 0.01) focusAmount = 0;
    focusPass.enabled = focusAmount > 0;
    if (focusPass.enabled) {
      if (AIR.focusOn) focusDistance += (Math.max(0.8, camPos.distanceTo(AIR.focus)) - focusDistance) * (1 - Math.exp(-6 * dt));
      setNumber(foc, 'uFocus', focusDistance);
      setNumber(foc, 'uAmount', focusAmount);
    }

    bloom.threshold = threshold;
    bloom.strength = 0.16 + 0.3 * haze;
    setNumber(fin, 'uExposure', renderer.toneMappingExposure * AIR.exposureMul * gradeExposure);
    setNumber(fin, 'uTime', clock);

    const shared = AIR_UNIFORMS;
    shared.uNear.value = camera.near;
    shared.uFar.value = camera.far;
    shared.uBloomLevel.value = threshold;
    shared.uFogColor.value.copy(fogColor);
    shared.uKeyColor.value.copy(AIR.keyColor);
    shared.uAmbient.value.copy(AIR.ambient);
    shared.uKeyDir.value.copy(AIR.keyDir);
    shared.uTime.value = clock;
  };

  return {
    overlay,
    render(dt) {
      if (disposed) return;
      refresh(dt);
      composer.render(dt);
    },
    setSize(w, h, pixelRatio) {
      if (disposed) return;
      width = Math.max(1, w);
      height = Math.max(1, h);
      ratio = pixelRatio;
      applySize();
    },
    setQuality(q) {
      if (disposed || q === quality) return;
      quality = q;
      applyQuality();
    },
    setGrade(grade, strength = 1) {
      if (disposed) return;
      const g = GRADES[grade];
      (fin['uLift']?.value as Vector3).set(...g.lift);
      (fin['uGamma']?.value as Vector3).set(...g.gamma);
      (fin['uGain']?.value as Vector3).set(...g.gain);
      (fin['uShadows']?.value as Vector3).set(...g.shadows);
      (fin['uHighlights']?.value as Vector3).set(...g.highlights);
      const k = Math.min(1, Math.max(0, strength));
      setNumber(fin, 'uSaturation', g.saturation);
      setNumber(fin, 'uContrast', g.contrast);
      setNumber(fin, 'uStrength', k);
      setNumber(fin, 'uKeep', g.keep);
      AIR.fillTint.setRGB(...gradeTint(g, k));
      setNumber(fin, 'uVignette', 0.22 + (g.vignette - 0.22) * k);
      setNumber(fin, 'uGrain', 0.02 + (g.grain - 0.02) * k);
      gradeExposure = 1 + (g.exposure - 1) * k;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      AIR.postActive = false;
      AIR.fillTint.setRGB(1, 1, 1);
      AIR_UNIFORMS.tDepth.value = null;
      AIR_UNIFORMS.tNoise.value = null;
      gtao.dispose();
      airPass.dispose();
      bloom.dispose();
      focusPass.dispose();
      finalPass.dispose();
      composer.dispose();
      sceneTarget.dispose();
      depthTexture.dispose();
      noise.dispose();
    },
  };
}
