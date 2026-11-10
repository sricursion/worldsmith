import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  HemisphereLight,
  Mesh,
  MathUtils,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { SkyPreset } from '../world/spec';
import { makeRng } from '../world/rng';
import { AIR, LAMP_COUNT, LAMP_GLOW, currentQuality, onQuality, type Quality } from './post';

export interface SkyRig {
  setHour(h: number): void;
  setPreset(p: SkyPreset, fog: number): void;
  /** Moves the shadow box so it is centred on this ground position (metres). */
  setFocus?(x: number, z: number): void;
  /**
   * Tints the hemisphere light's ground bounce, as a '#rrggbb' colour. The same colour tells the rig how
   * dark the ground is, so the low-light fill and exposure can make up for it (see groundLift).
   */
  setGroundTint?(hex: string): void;
  /** Turns the dramatic key-light bias on or off (on by default). The clock and the sky colours are not affected. */
  setCinematic?(on: boolean): void;
  /** Camera heading on the ground plane; the shadow box is pushed ahead along it so it covers what is on screen. */
  setViewDir?(x: number, z: number): void;
  /** Advances the cloud drift. */
  tick?(dt: number): void;
  /** 0..1 lightning: a burst of cold light from away from the key. */
  setFlash?(v: number): void;
  getPreset?(): SkyPreset;
  getFogHint?(): number;
  /**
   * Unit vector towards the sun the player sees (below the horizon at night). The same object every call,
   * refreshed whenever the hour changes: read it, do not keep a copy. Sky features light themselves from it.
   */
  sunDirection?(): Vector3;
  /** 0 at night .. 1 in full day. */
  daylight?(): number;
  dispose(): void;
}

export interface SunState {
  /** Degrees above the horizon, negative at night. */
  elevationDeg: number;
  /** Degrees clockwise from north (east = 90, south = 180). */
  azimuthDeg: number;
  /** 0 at night, 1 in full day; smooth through dawn and dusk. */
  daylight: number;
  /** Unit vector from the origin towards the sun. +Y up, north is -Z. */
  direction: [number, number, number];
}

export const MAX_SUN_ELEVATION_DEG = 68;
export const ENV_STEPS = 24;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function wrapHour(h: number): number {
  return ((h % 24) + 24) % 24;
}

/** Sun position from the town hour: rises east at 6, peaks south at 12, sets west at 18, below the horizon from 18 to 6. */
export function sunFromHour(hour: number): SunState {
  const h = wrapHour(hour);
  const phase = ((h - 6) / 12) * Math.PI; // 0 at 6, pi at 18, 2pi at 6 again
  const elevationDeg = Math.sin(phase) * (h >= 6 && h <= 18 ? MAX_SUN_ELEVATION_DEG : 55);
  const azimuthDeg = (((90 + (h - 6) * 15) % 360) + 360) % 360;
  const el = MathUtils.degToRad(elevationDeg);
  const az = MathUtils.degToRad(azimuthDeg);
  const direction: [number, number, number] = [
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    -Math.cos(el) * Math.cos(az),
  ];
  return { elevationDeg, azimuthDeg, daylight: smoothstep(-3, 14, elevationDeg), direction };
}

export interface KeyLight {
  elevationDeg: number;
  azimuthDeg: number;
  /** Unit vector from the origin towards the light. */
  direction: [number, number, number];
  /** 0 where the light is where the clock puts it, 1 at full bias. */
  bias: number;
}

/** Elevation where the cinematic bias starts, and where it is complete. */
export const CINEMATIC_BIAS_START_DEG = 38;
export const CINEMATIC_BIAS_FULL_DEG = 62;
/** The elevation a fully biased key light is pulled towards, and how far it is swung round. */
export const CINEMATIC_KEY_ELEVATION_DEG = 36;
export const CINEMATIC_SWING_DEG = 38;

/**
 * A high light makes short shadows that fall straight down the walls. The bias lowers it and swings it
 * round, so shadows rake across the streets instead of lying along them. Low lights pass through untouched.
 */
export function cinematicAngles(elevationDeg: number, azimuthDeg: number): { elevationDeg: number; azimuthDeg: number; bias: number } {
  const bias = smoothstep(CINEMATIC_BIAS_START_DEG, CINEMATIC_BIAS_FULL_DEG, elevationDeg);
  return {
    elevationDeg: MathUtils.lerp(elevationDeg, CINEMATIC_KEY_ELEVATION_DEG, 0.9 * bias),
    azimuthDeg: (((azimuthDeg + CINEMATIC_SWING_DEG * bias) % 360) + 360) % 360,
    bias,
  };
}

function directionFrom(elevationDeg: number, azimuthDeg: number): [number, number, number] {
  const el = MathUtils.degToRad(elevationDeg);
  const az = MathUtils.degToRad(azimuthDeg);
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

/** Where the sun's key light comes from at an hour. With `cinematic` off it is exactly the sun. */
export function keyLightFor(hour: number, cinematic = true): KeyLight {
  const sun = sunFromHour(hour);
  if (!cinematic) return { elevationDeg: sun.elevationDeg, azimuthDeg: sun.azimuthDeg, direction: sun.direction, bias: 0 };
  const a = cinematicAngles(sun.elevationDeg, sun.azimuthDeg);
  return { ...a, direction: directionFrom(a.elevationDeg, a.azimuthDeg) };
}

/** The moon sits opposite the sun, never lower than 15 degrees; the same bias keeps it from standing overhead. */
export function moonLightFor(hour: number, cinematic = true): KeyLight {
  const sun = sunFromHour(hour);
  const elevationDeg = Math.max(15, -sun.elevationDeg);
  const azimuthDeg = (sun.azimuthDeg + 180) % 360;
  if (!cinematic) return { elevationDeg, azimuthDeg, direction: directionFrom(elevationDeg, azimuthDeg), bias: 0 };
  const a = cinematicAngles(elevationDeg, azimuthDeg);
  return { ...a, direction: directionFrom(a.elevationDeg, a.azimuthDeg) };
}

// ---- Practical lights ----------------------------------------------------------------------------
// Lamps, lit windows, fires. Any code may register one; the live sky rig lights the nearest few with
// pooled point lights, so a town can hold hundreds of lamps at the cost of a dozen.

interface Practical {
  x: number;
  y: number;
  z: number;
  color: Color;
  radius: number;
}

const practicals: Practical[] = [];
let practicalVersion = 0;
const HEX6 = /^#?[0-9a-f]{6}$/i;

/** How many of the nearest lamps are also handed to particle shaders and to the air pass. */
export const GLOW_LAMPS = LAMP_COUNT;
/**
 * The nearest lit lamps, nearest first, for shaders that light themselves (rain, snow) and for the halos the
 * air pass draws round them: `pos` holds x, y, z, radius per lamp, `col` the colour times its slot weight,
 * `gain` the day/night level.
 */
export const PRACTICAL_GLOW = LAMP_GLOW;
/** Candela per square metre of radius: a lamp leaves this much light on a wall one radius away. */
export const PRACTICAL_LEVEL = 0.8;

/** Pool size per quality tier. */
export const PRACTICAL_POOL: readonly [number, number, number] = [4, 8, 12];
/** Lamps further than this from the focus stay dark. */
export const PRACTICAL_RANGE = 90;

/**
 * Registers a warm practical light: `radius` is how far, in metres, it still reads on a wall. Returns the
 * function that removes it. Cheap to call for every lamp and glowing window; only the nearest are lit.
 */
export function addPracticalLight(pos: Vector3, colorHex: string, radius: number): () => void {
  const hex = HEX6.test(colorHex) ? (colorHex.startsWith('#') ? colorHex : `#${colorHex}`) : '#ffb469';
  const r = Number.isFinite(radius) ? Math.min(30, Math.max(0.5, radius)) : 4;
  const p: Practical = { x: pos.x, y: pos.y, z: pos.z, color: new Color(hex), radius: r };
  practicals.push(p);
  practicalVersion++;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const i = practicals.indexOf(p);
    if (i >= 0) practicals.splice(i, 1);
    practicalVersion++;
  };
}

/**
 * Picks the `count` points nearest to (fx, fz). Writes their indices to `outIndex` and a 0..1 weight to
 * `outWeight` that falls to zero at the distance of the first point left out, so a lamp is already dark
 * when it loses its slot. Returns how many were written.
 */
export function nearestPracticals(
  points: readonly { x: number; z: number }[],
  fx: number,
  fz: number,
  count: number,
  outIndex: number[],
  outWeight: number[],
): number {
  const keep = Math.max(0, Math.floor(count));
  if (keep === 0) return 0;
  let n = 0;
  let cut = PRACTICAL_RANGE * PRACTICAL_RANGE;
  // Insertion into a short sorted list; outWeight holds squared distances until the end.
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    const d2 = (p.x - fx) * (p.x - fx) + (p.z - fz) * (p.z - fz);
    if (d2 >= cut) continue;
    let j = n;
    if (n === keep) {
      // The list is full: this point or the current last one becomes the nearest one left out.
      const last = outWeight[keep - 1] ?? cut;
      if (d2 >= last) {
        cut = d2;
        continue;
      }
      cut = last;
      j = keep - 1;
    } else {
      n++;
    }
    while (j > 0 && (outWeight[j - 1] ?? 0) > d2) {
      outWeight[j] = outWeight[j - 1] ?? 0;
      outIndex[j] = outIndex[j - 1] ?? 0;
      j--;
    }
    outWeight[j] = d2;
    outIndex[j] = i;
  }
  const edge = Math.sqrt(cut);
  for (let i = 0; i < n; i++) {
    outWeight[i] = 1 - smoothstep(0.7 * edge, edge, Math.sqrt(outWeight[i] ?? 0));
  }
  return n;
}

/** Index of the environment-map bucket for an hour; the PMREM is rebuilt only when this changes. */
export function envStepForHour(hour: number): number {
  return Math.floor(wrapHour(hour)) % ENV_STEPS;
}

export interface SkyPresetParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  /** Multiplier on direct sun light. */
  sunScale: number;
  /** Multiplier on hemisphere light. */
  ambientScale: number;
  /** 0..1 floor on the low-light fill: a preset whose sky stays dark all day keeps that much of it at noon. */
  gloom: number;
  /** Cloud cover of the sky shader, 0..1. */
  cloudCoverage: number;
  /** Colour layer drawn over the physical sky: colour and opacity at the zenith and at the horizon. */
  hazeTop: string;
  hazeTopAlpha: number;
  hazeHorizon: string;
  hazeHorizonAlpha: number;
}

/**
 * The physical sky supplies the blue and the sun glow; the haze layer supplies the horizon colour
 * (a plain physical horizon is almost white after tone mapping). Overcast is mostly haze.
 */
export const SKY_PRESETS: Record<SkyPreset, SkyPresetParams> = {
  dawn: {
    turbidity: 3, rayleigh: 1.0, mieCoefficient: 0.004, mieDirectionalG: 0.85, sunScale: 1, ambientScale: 1, gloom: 0,
    cloudCoverage: 0.35, hazeTop: '#5f7fd0', hazeTopAlpha: 0.4, hazeHorizon: '#f0a4c4', hazeHorizonAlpha: 0.94,
  },
  day: {
    turbidity: 2.2, rayleigh: 0.8, mieCoefficient: 0.0028, mieDirectionalG: 0.78, sunScale: 1, ambientScale: 1, gloom: 0,
    cloudCoverage: 0.35, hazeTop: '#3a78d0', hazeTopAlpha: 0.45, hazeHorizon: '#dcd5c8', hazeHorizonAlpha: 0.94,
  },
  dusk: {
    turbidity: 4, rayleigh: 1.2, mieCoefficient: 0.006, mieDirectionalG: 0.88, sunScale: 1, ambientScale: 1, gloom: 0,
    cloudCoverage: 0.4, hazeTop: '#4a4090', hazeTopAlpha: 0.55, hazeHorizon: '#f58a58', hazeHorizonAlpha: 0.95,
  },
  night: {
    turbidity: 2, rayleigh: 0.3, mieCoefficient: 0.002, mieDirectionalG: 0.7, sunScale: 0.55, ambientScale: 1, gloom: 0.7,
    cloudCoverage: 0.2, hazeTop: '#050a22', hazeTopAlpha: 0.97, hazeHorizon: '#1c326a', hazeHorizonAlpha: 0.97,
  },
  overcast: {
    turbidity: 6, rayleigh: 0.9, mieCoefficient: 0.01, mieDirectionalG: 0.6, sunScale: 0.45, ambientScale: 1.3, gloom: 0.5,
    cloudCoverage: 0.9, hazeTop: '#6a7f94', hazeTopAlpha: 0.99, hazeHorizon: '#9fb0c0', hazeHorizonAlpha: 0.95,
  },
};

/** FogExp2 density from the 0..1 fog hint, in 1/m. */
export function fogDensityFor(fog: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(fog) ? fog : 0));
  return 0.0005 + f * f * 0.02 + f * 0.003;
}

// ---- Sky shader port -------------------------------------------------------------------------
// The scattering model of three's Sky (clouds left out), evaluated once per update on the CPU so the
// fog can be given the colour the horizon actually has.

const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5] as const;
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14] as const;
const NIGHT_FLOOR = [0, 0.0003, 0.00075] as const;

function sunIntensity(zenithCos: number): number {
  const c = Math.min(1, Math.max(-1, zenithCos));
  return 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(c)) / 1.5)));
}

/** Linear radiance the Sky shader writes (before tone mapping) for a view direction. */
export function skyRadiance(
  p: Pick<SkyPresetParams, 'turbidity' | 'rayleigh' | 'mieCoefficient' | 'mieDirectionalG'>,
  sun: readonly [number, number, number],
  dir: readonly [number, number, number],
): [number, number, number] {
  const sunE = sunIntensity(sun[1]);
  const fade = 1 - Math.min(1, Math.max(0, 1 - Math.exp(sun[1] / 450000)));
  const rayleigh = p.rayleigh - (1 - fade);
  const mieScale = 0.434 * (0.2 * p.turbidity * 10e-18) * p.mieCoefficient;
  const zenith = Math.acos(Math.max(0, dir[1]));
  const inv = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - (zenith * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inv;
  const sM = 1.25e3 * inv;
  const cosTheta = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2];
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG;
  const g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosTheta + g2, 1.5));
  const twilight = Math.min(1, Math.max(0, Math.pow(1 - sun[1], 5)));
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const betaR = (TOTAL_RAYLEIGH[i] ?? 0) * rayleigh;
    const betaM = (MIE_CONST[i] ?? 0) * mieScale;
    const fex = Math.exp(-(betaR * sR + betaM * sM));
    const ratio = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= 1 + (Math.pow(sunE * ratio * fex, 0.5) - 1) * twilight;
    out[i] = (lin + 0.1 * fex) * 0.04 + (NIGHT_FLOOR[i] ?? 0);
  }
  return out;
}

// ---- Look: everything that depends only on (preset, hour) --------------------------------------

const NIGHT_TOP = new Color('#040922');
const NIGHT_HORIZON = new Color('#1a2f6a');
/** Exposure with the sun well down, over mid-grey ground: open enough that the moon and the lamps carry the frame. */
export const NIGHT_EXPOSURE = 1.0;
/** Added around sunrise and sunset, when neither the sun nor the moon lights the ground. */
export const TWILIGHT_EXPOSURE = 0.34;
/** Exposure under a high sun, and how much it opens as the sun comes down to the horizon. */
export const DAY_EXPOSURE = 0.74;
export const LOW_SUN_EXPOSURE = 0.98;
/** How much further the lens opens under cloud once the light is low: an overcast night has no moon to speak of. */
const OVERCAST_NIGHT_EXPOSURE = 1.3;
const SUN_LOW = new Color(0xffb27a);
const SUN_HIGH = new Color(0xfff1d8);
const MOON = new Color(0x9db4ff);
const HEMI_SKY_DAY = new Color(0xb4d0ff);
const HEMI_SKY_NIGHT = new Color(0x4a63b8);
const HEMI_GROUND_DAY = new Color(0x6b5a45);
const HEMI_GROUND_NIGHT = new Color(0x161b30);
const RIM_DAY = new Color(0xa8c8ff);
const RIM_NIGHT = new Color(0x4a64b0);
const FLASH = new Color(0xcfe0ff);

/**
 * Light levels. Cinematic: one hard key over a thin fill, about six to one by day, with a cool rim from the
 * far side. The fill is the sky; the shadows are kept readable by the light the ground throws back (see
 * BOUNCE_SHARE), not by raising the fill.
 */
export const LIGHT_RATIOS = {
  cinematic: { key: 4.0, fill: 0.4, rim: 0.3, moon: 2.0 },
  plain: { key: 3.4, fill: 0.55, rim: 0, moon: 1.0 },
} as const;

/** Sky fill added to the hemisphere light once the sun is down, and the level it has around sunrise and sunset. */
export const NIGHT_FILL = 1.4;
export const TWILIGHT_FILL = 2.0;
/** Sky fill added while the sun is up but low: in the golden hour the sky is a larger share of the light. */
export const LOW_SUN_FILL = 0.5;
/** Share of the moon that gets through an overcast sky, and how much more the cloud spreads into the fill. */
const OVERCAST_MOON = 0.7;
const OVERCAST_FILL = 1.15;
/** Environment-map level at night and what full daylight adds. Kept low: it is a fill no shadow can touch. */
export const ENV_LEVEL = { night: 0.08, day: 0.05 } as const;
/** Share of the key light landing on the ground that comes back up as bounce (the rest falls in shadow). */
export const BOUNCE_SHARE = 0.5;

/**
 * The player fill: a wide, shadowless light that rides above the player on the camera's side, so the
 * ground at the player's feet stays readable when the sun is down. Candela at full strength, its height over
 * the ground, how far it sits back towards the camera, and where it cuts off. Kept under any lamp.
 */
export const PLAYER_FILL = { candela: 3, height: 8, back: 3, range: 34 } as const;
const PLAYER_FILL_COLOR = new Color(0xd6e0ff);

/** The albedo the low-light levels are set for, and how far they may be pushed for darker or paler ground. */
export const REFERENCE_ALBEDO = 0.18;
export const GROUND_LIFT_MIN = 0.5;
export const GROUND_LIFT_MAX = 1.6;

/**
 * How much the low-light fill is scaled for the ground the town stands on: 1 on mid-grey, less on snow or
 * pale sand (which need no help), more on dark asphalt or moss. `groundLuminance` is the linear luminance
 * of the ground colour; undefined means mid-grey.
 */
export function groundLift(groundLuminance?: number): number {
  if (groundLuminance === undefined || !Number.isFinite(groundLuminance)) return 1;
  return Math.min(GROUND_LIFT_MAX, Math.max(GROUND_LIFT_MIN, Math.sqrt(REFERENCE_ALBEDO / Math.max(groundLuminance, 0.005))));
}

/**
 * Two 0..1 weights from the sun's elevation. `dark` is 1 at night and gone once the sun stands 14 degrees up
 * (never below `gloom`, a preset's own floor); `twilight` is the bump around the horizon, where the sun is
 * down and the moon has not taken over. Both are nearly gone in the golden hour: a low sun is a hard key and
 * the frame is built on it, not on a raised fill.
 */
export function lowLight(elevationDeg: number, gloom = 0): { dark: number; twilight: number } {
  return {
    dark: Math.max(gloom, 1 - smoothstep(-4, 14, elevationDeg)),
    twilight: smoothstep(-24, -8, elevationDeg) * (1 - smoothstep(0, 12, elevationDeg)),
  };
}

/** Irradiance the player fill leaves on flat ground `distance` metres from the player, for a light of `candela`. */
export function playerFillIrradiance(candela: number, distance: number): number {
  const flat = Math.max(0, distance) + PLAYER_FILL.back;
  const d = Math.hypot(flat, PLAYER_FILL.height);
  const cut = Math.min(1, Math.max(0, 1 - Math.pow(d / PLAYER_FILL.range, 4)));
  // The light is built with decay 1: it thins with distance, not with its square, so the pool has no hard edge.
  return (candela / d) * cut * cut * (PLAYER_FILL.height / d);
}

export interface LightRig {
  daylight: number;
  dark: number;
  twilight: number;
  /** Ground lift in force (see groundLift). */
  lift: number;
  /** True while the key is the sun, false while it is the moon. */
  sunUp: boolean;
  keyIntensity: number;
  keyColor: Color;
  /** Unit vector towards the key light. */
  keyDirection: [number, number, number];
  hemiLevel: number;
  hemiSky: Color;
  /** Irradiance the lit ground throws back up, before the ground's own colour: the hemisphere light's ground side. */
  bounce: number;
  rimLevel: number;
  rimColor: Color;
  /** Candela of the player fill; its colour is tinted by the grade when it is applied. */
  fillCandela: number;
  fillColor: Color;
  envIntensity: number;
  /** 0..1 level of lamps and lit windows. */
  practicalGain: number;
  exposure: number;
}

/** Every light level and the exposure for a preset and hour. The live rig applies exactly these. */
export function lightRigFor(
  preset: SkyPreset,
  hour: number,
  options: { cinematic?: boolean; groundLuminance?: number; keyDim?: number } = {},
): LightRig {
  const cinematic = options.cinematic !== false;
  const p = SKY_PRESETS[preset];
  const sun = sunFromHour(hour);
  const d = sun.daylight;
  const { dark, twilight } = lowLight(sun.elevationDeg, p.gloom);
  const lift = groundLift(options.groundLuminance);
  // The fill takes most of the correction for the ground; the exposure takes the rest (see exposureFor).
  const fillLift = Math.pow(lift, 1.5);
  const ratios = cinematic ? LIGHT_RATIOS.cinematic : LIGHT_RATIOS.plain;
  const overcast = preset === 'overcast';

  // Direct light: the sun by day, a blue moon (opposite the sun) once the sun is well down.
  const keyDim = options.keyDim === undefined || !Number.isFinite(options.keyDim) ? 1 : Math.min(1, Math.max(0, options.keyDim));
  const sunIntensity = ratios.key * d * p.sunScale * keyDim;
  // The moon is turned down over pale ground but never up: the bloom threshold follows the key.
  const moonIntensity = ratios.moon * (1 - d) * (overcast ? OVERCAST_MOON : 1) * Math.min(1, fillLift);
  const sunUp = sunIntensity >= moonIntensity;
  const key = sunUp ? keyLightFor(hour, cinematic) : moonLightFor(hour, cinematic);
  const keyColor = sunUp ? SUN_LOW.clone().lerp(SUN_HIGH, smoothstep(0, 35, sun.elevationDeg)) : MOON.clone();

  // In low light the sky fill comes up, but stays under the moon: the frame is still built on a key.
  const fill = cinematic ? ratios.fill : 0.3 + 0.25 * d;
  const keyIntensity = sunUp ? sunIntensity : moonIntensity;
  const lowFill = (NIGHT_FILL * dark + (TWILIGHT_FILL - NIGHT_FILL * dark) * twilight) * (overcast ? OVERCAST_FILL : 1);

  return {
    daylight: d,
    dark,
    twilight,
    lift,
    sunUp,
    keyIntensity,
    keyColor,
    keyDirection: key.direction,
    hemiLevel: fill * p.ambientScale + lowFill * fillLift + LOW_SUN_FILL * d * (1 - dark) * (1 - smoothstep(4, 30, sun.elevationDeg)),
    hemiSky: HEMI_SKY_NIGHT.clone().lerp(HEMI_SKY_DAY, Math.max(d, 0.6 * twilight)),
    bounce: BOUNCE_SHARE * keyIntensity * Math.max(0, key.direction[1]),
    rimLevel: ratios.rim * (0.35 + 0.65 * d) * (overcast ? 0.6 : 1),
    rimColor: RIM_NIGHT.clone().lerp(RIM_DAY, d),
    fillCandela: PLAYER_FILL.candela * dark * fillLift,
    fillColor: PLAYER_FILL_COLOR.clone(),
    envIntensity: ENV_LEVEL.night + ENV_LEVEL.day * d,
    // Lamps come up as the daylight goes; by day they are a faint warm spill.
    practicalGain: 0.12 + 0.88 * (1 - d) + (overcast ? 0.2 * d : 0),
    exposure: exposureFor(preset, hour, options.groundLuminance),
  };
}

/**
 * Shadow map size, the width of the box it covers and the filter radius in texels, per quality tier. One map
 * fitted round the camera and pushed ahead of it: 120 m and more of cover, about 3 cm a texel on the top tier.
 */
export const SHADOW_TIERS: readonly [
  { map: number; box: number; radius: number },
  { map: number; box: number; radius: number },
  { map: number; box: number; radius: number },
] = [
  { map: 1024, box: 120, radius: 1 },
  { map: 2048, box: 128, radius: 1 },
  { map: 4096, box: 136, radius: 1.25 },
];

function luminanceOf(c: Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export interface Contrast {
  /** Sunlit over shadowed level ground. */
  ground: number;
  /** Lit over shadowed, for a wall that faces the key. */
  wall: number;
  /** The larger of the two: what the frame's contrast is built on. */
  best: number;
  /** Key irradiance at normal incidence over the fill on level ground. */
  keyToFill: number;
}

/**
 * Lit-to-shadow ratio on a matt mid-grey surface away from the player and from any lamp, from the numbers
 * the rig applies. The shadow side keeps the sky fill, the environment map, the rim and, on a wall, half of
 * the ground bounce.
 */
export function contrastFor(preset: SkyPreset, hour: number, options: { cinematic?: boolean; groundLuminance?: number } = {}): Contrast {
  const rig = lightRigFor(preset, hour, options);
  const look = skyLookFor(preset, hour, options.groundLuminance);
  const key = rig.keyIntensity * luminanceOf(rig.keyColor);
  const up = Math.max(0, rig.keyDirection[1]);
  const flat = Math.hypot(rig.keyDirection[0], rig.keyDirection[2]);
  const envTop = luminanceOf(look.hazeTopColor);
  const envHorizon = luminanceOf(look.hazeHorizonColor);
  const hemi = rig.hemiLevel * luminanceOf(rig.hemiSky);
  const rim = rig.rimLevel * luminanceOf(rig.rimColor) * (42 / Math.hypot(42, 100));
  const fillGround = hemi + 0.5 * (envTop + envHorizon) * rig.envIntensity * Math.PI + rim;
  const fillWall = 0.5 * hemi + 0.5 * REFERENCE_ALBEDO * rig.bounce * luminanceOf(rig.keyColor) + envHorizon * rig.envIntensity * Math.PI;
  const ground = (key * up + fillGround) / fillGround;
  const wall = (key * flat + fillWall) / fillWall;
  return { ground, wall, best: Math.max(ground, wall), keyToFill: key / fillGround };
}

export interface SkyLook {
  /** Renderer tone mapping exposure. */
  exposure: number;
  /** Fog colour (linear working space), equal to the horizon the player sees. */
  fog: Color;
  /** Haze mixed into the sky before tone mapping, linear. Fully opaque at night. */
  hazeTopColor: Color;
  hazeHorizonColor: Color;
  hazeTopAlpha: number;
  hazeHorizonAlpha: number;
  /** 1 once the physical sky has gone dark, 0 in full light. */
  nightness: number;
}

const OVERCAST_DARKEN_MIN = 0.4;

/** Sun-side-neutral horizon sample: 4 degrees up, a quarter turn from the sun's azimuth. */
function horizonSample(sunAzimuthDeg: number): [number, number, number] {
  const az = MathUtils.degToRad(sunAzimuthDeg + 90);
  const el = MathUtils.degToRad(4);
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

/**
 * Renderer exposure. `groundLuminance` (linear, see groundLift) opens it up over dark ground and closes it
 * over snow while the light is low; by day it has no effect.
 */
export function exposureFor(preset: SkyPreset, hour: number, groundLuminance?: number): number {
  const sun = sunFromHour(hour);
  // A low sun rakes across the ground and barely lights it: the lens opens up, and the walls it does hit burn.
  const lowSun = 1 - smoothstep(4, 30, sun.elevationDeg);
  const day = DAY_EXPOSURE + LOW_SUN_EXPOSURE * lowSun + (preset === 'overcast' ? 0.05 : 0);
  const { dark, twilight } = lowLight(sun.elevationDeg, SKY_PRESETS[preset].gloom);
  const lift = Math.sqrt(groundLift(groundLuminance));
  const night = NIGHT_EXPOSURE * (preset === 'overcast' ? 1 + (OVERCAST_NIGHT_EXPOSURE - 1) * (1 - twilight) : 1);
  const base = MathUtils.lerp(night, day, sun.daylight) + TWILIGHT_EXPOSURE * twilight;
  return base * (1 + (lift - 1) * dark);
}

/** What the shader does with the haze layer, for a view direction with the given y. */
export function hazeMix(
  look: Pick<SkyLook, 'hazeTopColor' | 'hazeHorizonColor' | 'hazeTopAlpha' | 'hazeHorizonAlpha'>,
  radiance: readonly [number, number, number],
  dirY: number,
): [number, number, number] {
  const t = smoothstep(0, 0.6, dirY);
  const alpha = MathUtils.lerp(look.hazeHorizonAlpha, look.hazeTopAlpha, t);
  const squash = (v: number): number => v / (1 + HAZE_COMPRESS * (1 - t) * v);
  const c = look.hazeHorizonColor.clone().lerp(look.hazeTopColor, t);
  return [
    MathUtils.lerp(squash(radiance[0]), c.r, alpha),
    MathUtils.lerp(squash(radiance[1]), c.g, alpha),
    MathUtils.lerp(squash(radiance[2]), c.b, alpha),
  ];
}

/** three's ACES filmic curve at an exposure: linear radiance in, linear display colour out (before sRGB encoding). */
export function acesDisplay(rgb: readonly [number, number, number], exposure: number): [number, number, number] {
  const k = exposure / 0.6;
  const r0 = rgb[0] * k;
  const g0 = rgb[1] * k;
  const b0 = rgb[2] * k;
  const fit = (v: number): number => {
    const a = v * (v + 0.0245786) - 0.000090537;
    return a / (v * (0.983729 * v + 0.432951) + 0.238081);
  };
  const r = fit(0.59719 * r0 + 0.35458 * g0 + 0.04823 * b0);
  const g = fit(0.076 * r0 + 0.90834 * g0 + 0.01566 * b0);
  const b = fit(0.0284 * r0 + 0.13383 * g0 + 0.83777 * b0);
  const c = (v: number): number => Math.min(1, Math.max(0, v));
  return [
    c(1.60475 * r - 0.53108 * g - 0.07367 * b),
    c(-0.10208 * r + 1.10813 * g - 0.00605 * b),
    c(-0.00327 * r - 0.07276 * g + 1.07602 * b),
  ];
}

/**
 * The radiance that tone-maps to the wanted display colour at this exposure. Haze colours are written as
 * what the player should see; the physical sky is far brighter than 1 and would otherwise burn them out.
 */
export function radianceFor(display: Color, exposure: number): Color {
  const want = [Math.min(display.r, 0.97), Math.min(display.g, 0.97), Math.min(display.b, 0.97)] as const;
  const x: [number, number, number] = [want[0] * 2, want[1] * 2, want[2] * 2];
  for (let i = 0; i < 24; i++) {
    const y = acesDisplay(x, exposure);
    for (let j = 0; j < 3; j++) {
      const target = want[j] ?? 0;
      const cur = Math.max(y[j] ?? 0, 1e-5);
      x[j] = Math.min(60, Math.max(0, (x[j] ?? 0) * Math.min(2, Math.max(0.5, target / cur))));
    }
  }
  return new Color(x[0], x[1], x[2]);
}

export function skyLookFor(preset: SkyPreset, hour: number, groundLuminance?: number): SkyLook {
  const p = SKY_PRESETS[preset];
  const sun = sunFromHour(hour);
  const d = sun.daylight;
  const lit = smoothstep(-3, 3, sun.elevationDeg);
  const night = 1 - lit;

  // Overcast gets darker with the sun, so an evening storm is not as bright as noon.
  const bright = preset === 'overcast' ? OVERCAST_DARKEN_MIN + (1 - OVERCAST_DARKEN_MIN) * d : 1;
  const exposure = exposureFor(preset, hour, groundLuminance);
  const hazeTop = new Color(p.hazeTop).multiplyScalar(bright);
  const hazeHor = new Color(p.hazeHorizon).multiplyScalar(bright);
  const topAlpha = p.hazeTopAlpha;
  const horAlpha = p.hazeHorizonAlpha;

  const hazeTopColor = radianceFor(hazeTop.lerp(NIGHT_TOP, night), exposure);
  const hazeHorizonColor = radianceFor(hazeHor.lerp(NIGHT_HORIZON, night), exposure);
  const hazeTopAlpha = MathUtils.lerp(topAlpha, 1, night);
  const hazeHorizonAlpha = MathUtils.lerp(horAlpha, 1, night);

  const look: SkyLook = { exposure, fog: new Color(), hazeTopColor, hazeHorizonColor, hazeTopAlpha, hazeHorizonAlpha, nightness: night };
  const sample = horizonSample(sun.azimuthDeg);
  const f = hazeMix(look, skyRadiance(p, sun.direction, sample), sample[1]);
  look.fog.setRGB(f[0], f[1], f[2]);
  return look;
}

// ---- Rig ---------------------------------------------------------------------------------------

/** Share of the shadow box half-width the box is pushed ahead of the focus, along the camera heading. */
const SHADOW_LEAD = 0.55;
/** Radiance scale for the stars and the moon when the frame is tone-mapped after them. */
const NIGHT_SKY_HDR = 2.6;
const MOON_DISC = new Color(0xdfe8ff);
/** Smallest change of hour that re-lights the scene: about seven seconds of town time. */
const HOUR_STEP = 0.002;
const LIGHT_DISTANCE = 120;
const STAR_RADIUS = 1850;
const MOON_RADIUS = 1700;
const STAR_COUNT = 600;
const STAR_DAYLIGHT_LIMIT = 0.15;

/** Matches the final write of three's Sky fragment shader; a test checks it is still present. */
export const HAZE_MARKER = 'gl_FragColor = vec4( texColor, 1.0 );';
const HAZE_COMPRESS = 0.9;
const HAZE_DECLARATIONS = `
  const float HAZE_COMPRESS = ${HAZE_COMPRESS.toFixed(2)};
  uniform vec3 hazeTop;
  uniform vec3 hazeHorizon;
  uniform float hazeTopAlpha;
  uniform float hazeHorizonAlpha;
  uniform float hazeNight;
`;
const HAZE_MIX = `
  float hazeT = smoothstep( 0.0, 0.6, direction.y );
  float hazeSun = pow( max( dot( direction, vSunDirection ), 0.0 ), 12.0 );
  float hazeA = mix( hazeHorizonAlpha, hazeTopAlpha, hazeT ) * ( 1.0 - 0.8 * hazeSun * ( 1.0 - hazeNight ) );
  vec3 hazeBase = texColor / ( 1.0 + HAZE_COMPRESS * ( 1.0 - hazeT ) * texColor );
  texColor = mix( hazeBase, mix( hazeHorizon, hazeTop, hazeT ), hazeA );
  texColor = min( texColor, vec3( 64.0 ) );
`;

const MOON_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const MOON_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float disc = 1.0 - smoothstep(0.12, 0.14, r);
    float glow = exp(-r * 6.0) * 0.4;
    gl_FragColor = vec4(color, (disc + glow) * opacity);
    #include <colorspace_fragment>
  }`;

export function createSky(scene: Scene, renderer: WebGLRenderer, options: { cinematic?: boolean } = {}): SkyRig {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  sky.frustumCulled = false;
  sky.material.depthWrite = false;
  sky.renderOrder = -3;
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.position.copy(camera.position);
  };
  scene.add(sky);

  // The haze is mixed into the Sky shader's output before tone mapping, so the CPU-side fog colour matches it exactly.
  const hazeUniforms = {
    hazeTop: { value: new Color() },
    hazeHorizon: { value: new Color() },
    hazeTopAlpha: { value: 0 },
    hazeHorizonAlpha: { value: 0 },
    hazeNight: { value: 0 },
  };
  sky.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, hazeUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', HAZE_DECLARATIONS + 'void main() {')
      .replace(HAZE_MARKER, HAZE_MIX + HAZE_MARKER);
  };
  sky.material.needsUpdate = true;

  // Stars: seeded, upper hemisphere only, re-centred on the camera every frame.
  const rng = makeRng(0x5ca1ab1e, 'stars');
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starCol = new Float32Array(STAR_COUNT * 3);
  const starColor = new Color();
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = rng.range(0.03, 1);
    const az = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - y * y);
    starPos[i * 3] = Math.cos(az) * r * STAR_RADIUS;
    starPos[i * 3 + 1] = y * STAR_RADIUS;
    starPos[i * 3 + 2] = Math.sin(az) * r * STAR_RADIUS;
    starColor.setHSL(rng.chance(0.5) ? 0.6 : 0.1, rng.range(0.1, 0.5), rng.range(0.55, 1));
    starCol[i * 3] = starColor.r;
    starCol[i * 3 + 1] = starColor.g;
    starCol[i * 3 + 2] = starColor.b;
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new BufferAttribute(starCol, 3));
  const starMat = new PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const stars = new Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  stars.visible = false;
  stars.onBeforeRender = (_r, _s, camera) => {
    stars.position.copy(camera.position);
  };
  scene.add(stars);

  const moonMaterial = new ShaderMaterial({
    uniforms: { color: { value: MOON_DISC.clone() }, opacity: { value: 0 } },
    vertexShader: MOON_VERTEX,
    fragmentShader: MOON_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
  const moon = new Mesh(new PlaneGeometry(380, 380), moonMaterial);
  moon.frustumCulled = false;
  moon.renderOrder = -1;
  moon.visible = false;
  const moonOffset = new Vector3();
  moon.onBeforeRender = (_r, _s, camera) => {
    moon.position.copy(camera.position).add(moonOffset);
  };
  scene.add(moon);
  const moonDir = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  const moonAim = new Vector3();

  // A second mesh sharing geometry and material, kept in its own scene, feeds the PMREM generator.
  const envScene = new Scene();
  const envSky = new Mesh(sky.geometry, sky.material);
  envSky.scale.setScalar(40);
  envScene.add(envSky);
  const pmrem = new PMREMGenerator(renderer);
  let envTarget: WebGLRenderTarget | null = null;
  let envStep = -1;

  const hemi = new HemisphereLight(HEMI_SKY_DAY, HEMI_GROUND_DAY, 0.6);
  scene.add(hemi);
  const groundDay = HEMI_GROUND_DAY.clone();

  const light = new DirectionalLight(0xffffff, 1);
  light.castShadow = true;
  const cam = light.shadow.camera;
  cam.near = 1;
  cam.far = LIGHT_DISTANCE * 2.2;
  light.shadow.bias = -0.00025;
  scene.add(light);
  scene.add(light.target);

  // Cool light from the far side of the key: it lifts the shadow side of a building off the background.
  const rim = new DirectionalLight(RIM_DAY, 0);
  rim.castShadow = false;
  scene.add(rim);
  scene.add(rim.target);

  // The player fill stays in the scene at all hours (zero by day), so the light count never changes.
  const playerFill = new PointLight(PLAYER_FILL_COLOR, 0, PLAYER_FILL.range, 1);
  playerFill.castShadow = false;
  scene.add(playerFill);

  let quality: Quality = currentQuality();
  let texel = 1;
  let shadowHalf = 1;
  const applyShadowTier = (): void => {
    const tier = SHADOW_TIERS[quality];
    shadowHalf = tier.box / 2;
    texel = tier.box / tier.map;
    cam.left = -shadowHalf;
    cam.right = shadowHalf;
    cam.top = shadowHalf;
    cam.bottom = -shadowHalf;
    cam.updateProjectionMatrix();
    // About a texel and a half of normal offset: enough to stop acne on flat-shaded faces, small enough not to float shadows off walls.
    light.shadow.normalBias = texel * 1.5;
    // A tight filter: the edge at the player's feet is a few centimetres wide, as a hard sun leaves it.
    light.shadow.radius = tier.radius;
    if (light.shadow.mapSize.x !== tier.map) {
      light.shadow.mapSize.set(tier.map, tier.map);
      if (light.shadow.map !== null) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
    }
  };
  applyShadowTier();

  // Practical lights: a fixed pool, each moved to one of the lamps nearest the focus.
  const pool: PointLight[] = [];
  const poolBase: number[] = [];
  const pickIndex: number[] = [];
  const pickWeight: number[] = [];
  for (let i = 0; i < PRACTICAL_POOL[2]; i++) {
    const lamp = new PointLight(0xffb469, 0, 10, 2);
    lamp.castShadow = false;
    lamp.visible = false;
    scene.add(lamp);
    pool.push(lamp);
    poolBase.push(0);
  }
  let seenPracticalVersion = -1;
  let practicalX = Number.NaN;
  let practicalZ = 0;
  let practicalGain = 0;

  const fogColor = new Color();
  scene.fog = new FogExp2(0xbcd2e6, fogDensityFor(0.1));

  let hour = 12;
  let preset: SkyPreset = 'day';
  let fogHint = 0.1;
  let disposed = false;
  let focusX = 0;
  let focusZ = 0;
  const lightDir = new Vector3(0, 1, 0);
  const basisX = new Vector3();
  const basisY = new Vector3();
  const focus = new Vector3();
  const UP = new Vector3(0, 1, 0);
  let cinematic = options.cinematic !== false;
  let viewX = 0;
  let viewZ = 0;
  let flash = 0;
  let rimLevel = 0;
  let hemiLevel = 0;
  let groundLuminance: number | undefined;
  const groundTint = HEMI_GROUND_DAY.clone();
  const sunDirOut = new Vector3(0, 1, 0);
  let daylightOut = 1;
  let seenKeyDim = AIR.keyDim;
  let seenRigMoon = AIR.rigMoon;
  const rimColor = new Color();
  const hemiColor = new Color();
  const bounceBase = new Color();
  const fillColor = new Color();
  const moonQuat = new Quaternion();

  /** Re-deals the pool when the lamps, the focus or the tier changed; otherwise leaves it alone. */
  const assignPracticals = (force: boolean): void => {
    const moved = !(Math.abs(focusX - practicalX) < 1.5 && Math.abs(focusZ - practicalZ) < 1.5);
    if (!force && !moved && seenPracticalVersion === practicalVersion) return;
    seenPracticalVersion = practicalVersion;
    practicalX = focusX;
    practicalZ = focusZ;
    const size = practicals.length === 0 ? 0 : PRACTICAL_POOL[quality];
    const n = nearestPracticals(practicals, focusX, focusZ, size, pickIndex, pickWeight);
    PRACTICAL_GLOW.pos.fill(0);
    PRACTICAL_GLOW.col.fill(0);
    for (let i = 0; i < pool.length; i++) {
      const lamp = pool[i];
      if (lamp === undefined) continue;
      // Every slot of the pool stays in the shader while any lamp exists, so walking about never recompiles a material.
      lamp.visible = i < size;
      const p = i < n ? practicals[pickIndex[i] ?? -1] : undefined;
      if (p === undefined) {
        poolBase[i] = 0;
        lamp.intensity = 0;
        continue;
      }
      lamp.position.set(p.x, p.y, p.z);
      lamp.color.copy(p.color);
      lamp.distance = p.radius * 1.7;
      // Candela that leaves PRACTICAL_LEVEL on a wall one radius away: inside that the pool is far brighter than the fill.
      poolBase[i] = PRACTICAL_LEVEL * p.radius * p.radius * (pickWeight[i] ?? 0);
      lamp.intensity = (poolBase[i] ?? 0) * practicalGain;
      if (i < GLOW_LAMPS) {
        const w = pickWeight[i] ?? 0;
        PRACTICAL_GLOW.pos.set([p.x, p.y, p.z, p.radius], i * 4);
        PRACTICAL_GLOW.col.set([p.color.r * w, p.color.g * w, p.color.b * w], i * 3);
      }
    }
  };

  const applyFlash = (): void => {
    rim.intensity = rimLevel + flash * 3.2;
    rim.color.copy(rimColor).lerp(FLASH, Math.min(1, flash * 1.5));
    hemi.intensity = hemiLevel + flash * 1.4;
    hemi.color.copy(hemiColor).lerp(FLASH, Math.min(1, flash));
  };

  /** Puts the light and its target over the focus point, with the target snapped to shadow texels so edges do not crawl. */
  const placeLight = (): void => {
    const lead = shadowHalf * SHADOW_LEAD;
    focus.set(focusX + viewX * lead, AIR.groundY, focusZ + viewZ * lead);
    basisX.crossVectors(UP, lightDir);
    if (basisX.lengthSq() > 1e-6) {
      basisX.normalize();
      basisY.crossVectors(lightDir, basisX);
      const a = focus.dot(basisX);
      const b = focus.dot(basisY);
      focus.addScaledVector(basisX, Math.round(a / texel) * texel - a);
      focus.addScaledVector(basisY, Math.round(b / texel) * texel - b);
    }
    light.target.position.copy(focus);
    light.target.updateMatrixWorld();
    light.position.copy(focus).addScaledVector(lightDir, LIGHT_DISTANCE);

    // The rim comes from the opposite side, low over the roofs.
    const flat = Math.hypot(lightDir.x, lightDir.z);
    rim.target.position.copy(focus);
    rim.target.updateMatrixWorld();
    if (flat > 0.05) rim.position.set(focus.x - (lightDir.x / flat) * 100, 42, focus.z - (lightDir.z / flat) * 100);
    else rim.position.set(focus.x + 100, 42, focus.z);

    // The player fill hangs over the player, set back towards the camera so it lights the side the camera sees.
    playerFill.position.set(focusX - viewX * PLAYER_FILL.back, AIR.groundY + PLAYER_FILL.height, focusZ - viewZ * PLAYER_FILL.back);
    playerFill.color.copy(fillColor).multiply(AIR.fillTint);
  };

  const rebuildEnv = (): void => {
    const next = pmrem.fromScene(envScene, 0.02);
    scene.environment = next.texture;
    if (envTarget !== null) envTarget.dispose();
    envTarget = next;
  };

  const apply = (): void => {
    const p = SKY_PRESETS[preset];
    const key = keyLightFor(hour, cinematic);
    const moonKey = moonLightFor(hour, cinematic);
    seenKeyDim = AIR.keyDim;
    seenRigMoon = AIR.rigMoon;
    const rig = lightRigFor(preset, hour, { cinematic, groundLuminance, keyDim: seenKeyDim });
    const look = skyLookFor(preset, hour, groundLuminance);
    sunDirOut.set(...key.direction);
    daylightOut = rig.daylight;
    if (seenKeyDim < 1) {
      // A dimmed sun (an eclipse) takes the sky down with it, though less far: the air still scatters.
      const skyDim = 0.35 + 0.65 * (1 - rig.daylight + rig.daylight * seenKeyDim);
      look.hazeTopColor.multiplyScalar(skyDim);
      look.hazeHorizonColor.multiplyScalar(skyDim);
      look.fog.multiplyScalar(skyDim);
    }
    const u = sky.material.uniforms;
    const set = (key: string, value: number): void => {
      const uni = u[key];
      if (uni !== undefined) uni.value = value;
    };
    set('turbidity', p.turbidity);
    set('rayleigh', p.rayleigh);
    set('mieCoefficient', p.mieCoefficient);
    set('mieDirectionalG', p.mieDirectionalG);
    set('cloudCoverage', p.cloudCoverage);
    const sunPos = u['sunPosition'];
    // The sun disc and the scattering follow the key light, so the shadows agree with the sun the player sees.
    if (sunPos !== undefined) (sunPos.value as Vector3).set(...key.direction);

    hazeUniforms.hazeTop.value.copy(look.hazeTopColor);
    hazeUniforms.hazeHorizon.value.copy(look.hazeHorizonColor);
    hazeUniforms.hazeTopAlpha.value = look.hazeTopAlpha;
    hazeUniforms.hazeHorizonAlpha.value = look.hazeHorizonAlpha;
    hazeUniforms.hazeNight.value = look.nightness;

    const d = rig.daylight;
    const sunUp = rig.sunUp;
    lightDir.set(...rig.keyDirection);
    light.intensity = rig.keyIntensity;
    light.color.copy(rig.keyColor);
    fillColor.copy(rig.fillColor);
    playerFill.intensity = rig.fillCandela;
    placeLight();
    rimLevel = rig.rimLevel;
    rimColor.copy(rig.rimColor);

    // Moon and stars: only once the sun is down.
    moonDir.set(...moonKey.direction);
    moonOffset.copy(moonDir).multiplyScalar(MOON_RADIUS);
    moonAim.copy(moonDir).negate();
    moon.quaternion.copy(moonQuat.setFromUnitVectors(zAxis, moonAim));
    // Drawn before tone mapping when the film pipeline is on, so they need radiance, not display colour.
    const nightSky = AIR.postActive ? NIGHT_SKY_HDR : 1;
    const moonColor = moonMaterial.uniforms['color'];
    if (moonColor !== undefined) (moonColor.value as Color).copy(MOON_DISC).multiplyScalar(nightSky);
    starMat.color.setScalar(nightSky);
    const cloudCut = preset === 'overcast' ? 0.15 : 1;
    const moonAlpha = seenRigMoon ? look.nightness * cloudCut : 0;
    moon.visible = moonAlpha > 0.01;
    const moonOpacity = moonMaterial.uniforms['opacity'];
    if (moonOpacity !== undefined) moonOpacity.value = moonAlpha;
    // Cloud hides the stars more thoroughly than it hides the moon.
    const starAlpha = (d < STAR_DAYLIGHT_LIMIT ? 1 - d / STAR_DAYLIGHT_LIMIT : 0) * cloudCut * cloudCut;
    stars.visible = starAlpha > 0.01;
    starMat.opacity = starAlpha;

    hemiColor.copy(rig.hemiSky);
    // The ground side of the hemisphere is the key coming back off the land, in the land's own colour: it is what
    // lights the shadow side of a wall and the underside of a roof. A share of the old flat ground tone stays under it.
    const bounceGain = Math.min(8, rig.bounce / Math.max(rig.hemiLevel, 0.05));
    hemi.groundColor
      .copy(groundTint)
      .multiply(rig.keyColor)
      .multiplyScalar(bounceGain)
      .add(bounceBase.copy(HEMI_GROUND_NIGHT).lerp(groundDay, Math.max(d, 0.6 * rig.twilight)).multiplyScalar(0.35));
    hemiLevel = rig.hemiLevel;
    applyFlash();

    practicalGain = rig.practicalGain;
    PRACTICAL_GLOW.gain = practicalGain;
    assignPracticals(false);
    for (let i = 0; i < pool.length; i++) {
      const lamp = pool[i];
      if (lamp !== undefined) lamp.intensity = (poolBase[i] ?? 0) * practicalGain;
    }

    fogColor.copy(look.fog);
    const density = fogDensityFor(fogHint);
    const fog = scene.fog;
    if (fog instanceof FogExp2) {
      // With the film pipeline the fog is drawn in post (height falloff, sun glow); the scene fog then only carries the colour.
      fog.color.copy(fogColor);
      fog.density = AIR.postActive ? 0 : density;
    }
    AIR.fogColor.copy(fogColor);
    AIR.fogDensity = density;
    AIR.keyDir.copy(lightDir);
    AIR.keyColor.copy(light.color).multiplyScalar(light.intensity);
    AIR.ambient.copy(hemiColor).multiplyScalar(hemiLevel);
    // Weighted by how bright the key's colour is: a blue moon lights a wall far less than its intensity says,
    // and the bloom threshold that follows this must stay under the lamps.
    AIR.keyLevel = light.intensity * (0.2126 * light.color.r + 0.7152 * light.color.g + 0.0722 * light.color.b);
    AIR.daylight = d;
    AIR.cloudCover = p.cloudCoverage;
    AIR.beam = sunUp ? Math.min(1, p.sunScale) : 0.5;
    scene.environmentIntensity = rig.envIntensity;
    renderer.toneMappingExposure = look.exposure;
    AIR.exposure = look.exposure;

    const step = envStepForHour(hour);
    if (step !== envStep) {
      envStep = step;
      rebuildEnv();
    }
  };

  apply();

  const offQuality = onQuality((q) => {
    if (disposed) return;
    quality = q;
    applyShadowTier();
    placeLight();
    assignPracticals(true);
  });

  return {
    setHour(h) {
      if (disposed || !Number.isFinite(h)) return;
      const next = wrapHour(h);
      // Called every frame; the sun moves a thirtieth of a degree in this much time, so smaller steps wait.
      if (Math.abs(next - hour) < HOUR_STEP) return;
      hour = next;
      apply();
    },
    setPreset(p, fog) {
      if (disposed) return;
      preset = p;
      fogHint = fog;
      envStep = -1; // the sky look changed, so the env map must be rebuilt
      apply();
    },
    setFocus(x, z) {
      if (disposed || !Number.isFinite(x) || !Number.isFinite(z)) return;
      focusX = x;
      focusZ = z;
      placeLight();
      assignPracticals(false);
    },
    setCinematic(on) {
      if (disposed || on === cinematic) return;
      cinematic = on;
      apply();
    },
    setViewDir(x, z) {
      if (disposed) return;
      const len = Math.hypot(x, z);
      if (!Number.isFinite(len) || len < 1e-4) return;
      viewX = x / len;
      viewZ = z / len;
    },
    tick(dt) {
      if (disposed || !Number.isFinite(dt)) return;
      const t = sky.material.uniforms['time'];
      if (t !== undefined) t.value = ((t.value as number) + dt) % 36000;
      // A sky feature (an eclipse, a drawn moon) changed what the rig should do.
      if (AIR.keyDim !== seenKeyDim || AIR.rigMoon !== seenRigMoon) apply();
    },
    setFlash(v) {
      if (disposed || !Number.isFinite(v)) return;
      const next = Math.min(1, Math.max(0, v));
      if (next === flash) return;
      flash = next;
      applyFlash();
    },
    getPreset() {
      return preset;
    },
    getFogHint() {
      return fogHint;
    },
    sunDirection() {
      return sunDirOut;
    },
    daylight() {
      return daylightOut;
    },
    setGroundTint(hex) {
      if (disposed || !HEX6.test(hex)) return;
      // A bounce is the tint lit by the sun: keep it close to the default so a saturated tint stays gentle.
      const tint = new Color(hex.startsWith('#') ? hex : `#${hex}`);
      groundDay.copy(HEMI_GROUND_DAY).lerp(tint, 0.65);
      groundTint.copy(tint);
      groundLuminance = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b;
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offQuality();
      scene.remove(sky, stars, moon, hemi, light, light.target, rim, rim.target, playerFill, ...pool);
      playerFill.dispose();
      for (const lamp of pool) lamp.dispose();
      PRACTICAL_GLOW.pos.fill(0);
      PRACTICAL_GLOW.col.fill(0);
      PRACTICAL_GLOW.gain = 0;
      AIR.exposure = 0.5;
      rim.dispose();
      envScene.remove(envSky);
      sky.geometry.dispose();
      sky.material.dispose();
      starGeo.dispose();
      starMat.dispose();
      moon.geometry.dispose();
      moonMaterial.dispose();
      light.dispose();
      hemi.dispose();
      if (envTarget !== null) envTarget.dispose();
      envTarget = null;
      scene.environment = null;
      scene.fog = null;
      pmrem.dispose();
    },
  };
}
