// The air of a town: fog that lies on the ground and takes the colour of the horizon, light scattered
// towards the sun, drifting cloud shadow, weather, lightning and how wet the ground is. It turns a
// MoodSpec into numbers; the film pipeline (engine/post) and the weather layers do the drawing.

import { Color, Vector3 } from 'three';
import type { GradeKind, MoodSpec, SkyPreset, StyleSpec, SurfaceKind, ThemeId, WeatherKind } from '../world/spec';
import { makeRng } from '../world/rng';
import type { Viewport } from './renderer';
import { AIR, GRADES, applyGrade, gradeTint, onQuality, resetAirMods } from './post';
import { REFERENCE_ALBEDO, acesDisplay, lightRigFor, playerFillIrradiance, skyLookFor, sunFromHour, type SkyRig } from './sky';
import { createWeather, type WeatherTint } from './weather';

/** 0 dry .. 1 soaked. The atmosphere sets it; a ground material may read `WET.value` or hold the object as a uniform. */
export const WET = { value: 0 };

export interface Atmosphere {
  /** Applies a mood; with none, one is inferred from the sky preset and the look of the town. */
  setMood(mood: MoodSpec | undefined, style: StyleSpec | undefined, sitePattern?: string): void;
  /** Call once per frame: `focus` is the player's position, `hour` the town hour. */
  update(dt: number, focus: Vector3, hour: number): void;
  /** Overrides how wet the ground is, 0..1, until the next setMood. */
  setWetness?(w: number): void;
  /** Tells the inference which theme the town has; without it the theme is read off the style's surfaces. */
  setTheme?(theme: ThemeId | undefined): void;
  /** The mood in force, given or inferred. */
  getMood?(): MoodSpec;
  dispose(): void;
}

// ---- Inference ---------------------------------------------------------------------------------

const SURFACE_THEME: Partial<Record<SurfaceKind, ThemeId>> = {
  timber: 'western', planks: 'western', adobe: 'western', canvas: 'western', dirt: 'western', sand: 'western', shingle: 'western',
  log: 'medieval', plaster: 'medieval', stone: 'medieval', cobble: 'medieval', thatch: 'medieval', slate: 'medieval', tile: 'medieval',
  moss: 'medieval', grass: 'medieval', mud: 'medieval',
  metal_panel: 'scifi', hull_plate: 'scifi', glass_curtain: 'scifi', crystal: 'scifi', chitin: 'scifi', regolith: 'scifi',
  concrete: 'modern', asphalt: 'modern', brick: 'modern', corrugated: 'modern', rusted: 'modern', gravel: 'modern',
};

/** Which of the four themes a style's materials point to, or undefined when it carries no surfaces or they do not say. */
export function inferTheme(style: StyleSpec | undefined): ThemeId | undefined {
  const s = style?.surfaces;
  if (s === undefined) return undefined;
  const votes: Record<ThemeId, number> = { western: 0, medieval: 0, scifi: 0, modern: 0 };
  const cast = (kind: SurfaceKind, weight: number): void => {
    const t = SURFACE_THEME[kind];
    if (t !== undefined) votes[t] += weight;
  };
  cast(s.wall, 3);
  cast(s.wall2, 1);
  cast(s.roof, 2);
  cast(s.trim, 1);
  cast(s.ground, 2);
  cast(s.road, 1);
  let best: ThemeId | undefined;
  let top = 0;
  for (const t of ['western', 'medieval', 'scifi', 'modern'] as const) {
    if (votes[t] > top) {
      top = votes[t];
      best = t;
    }
  }
  return best;
}

type MoodRow = readonly [weather: WeatherKind, intensity: number, grade: GradeKind, haze: number];

const THEME_MOODS: Record<ThemeId, Record<SkyPreset, MoodRow>> = {
  western: {
    dawn: ['dust', 0.3, 'golden', 0.55],
    day: ['dust', 0.4, 'golden', 0.5],
    dusk: ['dust', 0.45, 'golden', 0.65],
    night: ['fireflies', 0.35, 'moonlit', 0.3],
    overcast: ['dust', 0.6, 'sepia', 0.6],
  },
  medieval: {
    dawn: ['mist', 0.55, 'verdant', 0.6],
    day: ['dust', 0.2, 'verdant', 0.35],
    dusk: ['fireflies', 0.6, 'golden', 0.5],
    night: ['fireflies', 0.5, 'moonlit', 0.4],
    overcast: ['rain', 0.45, 'bleached', 0.5],
  },
  scifi: {
    dawn: ['mist', 0.45, 'cold_steel', 0.55],
    day: ['mist', 0.35, 'cold_steel', 0.45],
    dusk: ['mist', 0.5, 'teal_orange', 0.6],
    night: ['mist', 0.5, 'neon_noir', 0.7],
    overcast: ['rain', 0.55, 'cold_steel', 0.6],
  },
  modern: {
    dawn: ['mist', 0.3, 'teal_orange', 0.45],
    day: ['clear', 0, 'neutral', 0.25],
    dusk: ['clear', 0, 'teal_orange', 0.4],
    night: ['rain', 0.4, 'neon_noir', 0.6],
    overcast: ['rain', 0.5, 'bleached', 0.5],
  },
};

const PRESET_MOODS: Record<SkyPreset, MoodRow> = {
  dawn: ['mist', 0.35, 'golden', 0.5],
  day: ['clear', 0, 'neutral', 0.3],
  dusk: ['clear', 0, 'teal_orange', 0.45],
  night: ['clear', 0, 'moonlit', 0.35],
  overcast: ['mist', 0.4, 'bleached', 0.5],
};

const WEATHER_AMBIENCE: Partial<Record<WeatherKind, readonly string[]>> = {
  rain: ['rain', 'wind'],
  storm: ['rain', 'wind', 'thunder'],
  snow: ['wind'],
  dust: ['wind'],
  ash: ['wind', 'fire'],
  embers: ['fire'],
  fireflies: ['crickets'],
};

/**
 * The mood for a town whose spec carries none: a frontier town gets golden dust, a station cold mist.
 * `fog` is the palette's 0..1 hint; thick fog on a clear mood becomes fog weather.
 */
export function defaultMood(theme: ThemeId | undefined, sky: SkyPreset, fog = 0, sitePattern?: string): MoodSpec {
  const row = theme !== undefined ? THEME_MOODS[theme][sky] : PRESET_MOODS[sky];
  let weather = row[0];
  let intensity = row[1];
  let haze = row[3];
  const f = Number.isFinite(fog) ? Math.min(1, Math.max(0, fog)) : 0;
  if (f > 0.55 && (weather === 'clear' || weather === 'dust' || weather === 'fireflies')) {
    weather = 'fog';
    intensity = f;
  }
  // A camp or a grove holds more air between its trees than a street grid does.
  if (sitePattern === 'scatter' || sitePattern === 'ring') haze += 0.08;
  if (sitePattern === 'grid') haze -= 0.05;
  haze = Math.min(1, Math.max(0, haze + 0.25 * f));
  const ambience = [...(WEATHER_AMBIENCE[weather] ?? (sky === 'night' ? ['crickets', 'wind'] : ['wind']))];
  return { weather, intensity, grade: row[2], haze, ambience, music: '' };
}

// ---- Mood to air -------------------------------------------------------------------------------

interface WeatherAir {
  /** Extinction added at full intensity, 1/m. */
  add: number;
  /** Multiplier on the sky's own fog at full intensity. */
  mul: number;
  /** Height falloff, 1/m: high keeps the fog on the ground. */
  falloff: number;
  exposure: number;
  /** Ground wetness at full intensity. */
  wet: number;
  /** Wind speed, m/s. */
  wind: number;
  /** How much of the cloud-shadow pattern survives. */
  cloud: number;
  /** Fog takes this share of the tint colour at full intensity. */
  tint: number;
}

export const WEATHER_AIR: Record<WeatherKind, WeatherAir> = {
  clear: { add: 0, mul: 1, falloff: 0.07, exposure: 1, wet: 0, wind: 0.8, cloud: 1, tint: 0 },
  rain: { add: 0.004, mul: 1.4, falloff: 0.045, exposure: 0.92, wet: 0.9, wind: 2.2, cloud: 0.3, tint: 0 },
  storm: { add: 0.008, mul: 1.8, falloff: 0.035, exposure: 0.8, wet: 1, wind: 5.5, cloud: 0, tint: 0 },
  snow: { add: 0.005, mul: 1.3, falloff: 0.04, exposure: 1.04, wet: 0.15, wind: 1.4, cloud: 0.3, tint: 0 },
  fog: { add: 0.022, mul: 1.5, falloff: 0.03, exposure: 0.96, wet: 0.25, wind: 0.4, cloud: 0, tint: 0 },
  mist: { add: 0.007, mul: 1.2, falloff: 0.16, exposure: 1, wet: 0.2, wind: 0.5, cloud: 0.6, tint: 0 },
  dust: { add: 0.004, mul: 1.5, falloff: 0.05, exposure: 1.03, wet: 0, wind: 2.6, cloud: 0.8, tint: 0.6 },
  ash: { add: 0.006, mul: 1.6, falloff: 0.04, exposure: 0.86, wet: 0, wind: 1.2, cloud: 0.2, tint: 0.5 },
  spores: { add: 0.004, mul: 1.2, falloff: 0.12, exposure: 0.97, wet: 0.1, wind: 0.3, cloud: 0.7, tint: 0.22 },
  embers: { add: 0.003, mul: 1.3, falloff: 0.05, exposure: 0.93, wet: 0, wind: 1, cloud: 0.5, tint: 0.25 },
  fireflies: { add: 0.001, mul: 1.1, falloff: 0.12, exposure: 1, wet: 0, wind: 0.3, cloud: 1, tint: 0 },
};

export interface AirSettings {
  densityMul: number;
  densityAdd: number;
  falloff: number;
  fogTintMix: number;
  haze: number;
  cloudShadow: number;
  exposureMul: number;
  wet: number;
  wind: number;
}

/** The numbers a mood asks of the air. `baseWet` is the style's own wetness (surfaces.wet). */
export function airFor(mood: MoodSpec, baseWet = 0): AirSettings {
  const w = WEATHER_AIR[mood.weather];
  const i = Number.isFinite(mood.intensity) ? Math.min(1, Math.max(0, mood.intensity)) : 0;
  const haze = Number.isFinite(mood.haze) ? Math.min(1, Math.max(0, mood.haze)) : 0.3;
  return {
    densityMul: 1 + (w.mul - 1) * i + 0.8 * haze,
    densityAdd: w.add * i,
    falloff: 0.07 + (w.falloff - 0.07) * Math.min(1, i * 1.5),
    fogTintMix: w.tint * i,
    haze,
    cloudShadow: 0.42 * (1 + (w.cloud - 1) * i),
    exposureMul: 1 + (w.exposure - 1) * i,
    wet: Math.min(1, Math.max(Number.isFinite(baseWet) ? Math.max(0, baseWet) : 0, w.wet * i)),
    wind: w.wind * (0.5 + 0.5 * i),
  };
}

// ---- Brightness estimate -----------------------------------------------------------------------

export interface ShownLuminance {
  /** Linear display luminance, 0..1, after tone mapping and the grade. */
  linear: number;
  /** The same as an sRGB-encoded signal level, 0..1: what a waveform monitor reads. */
  encoded: number;
  /** Exposure the final pass uses: sky rig times weather times grade. */
  exposure: number;
}

export interface LuminanceInput {
  preset: SkyPreset;
  hour: number;
  mood: Pick<MoodSpec, 'weather' | 'intensity' | 'grade' | 'haze'>;
  /** Linear RGB albedo of the surface; mid-grey when left out. */
  albedo?: readonly [number, number, number];
  /** Linear luminance of the town's ground colour, as the sky rig is told it; mid-grey when left out. */
  groundLuminance?: number;
  /** Metres from the player, for the player fill. Infinity leaves the fill out. Default 0. */
  distance?: number;
}

const RIM_COSINE = 42 / Math.hypot(42, 100);
const srgbEncode = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/**
 * Estimates how bright a matt, level, unshadowed surface is shown, from the same numbers the sky rig, the
 * weather and the grade apply. Left out: ambient occlusion, cloud shadow, fog between the camera and the
 * surface, lamps, bloom and the vignette. Good for setting levels, not for pixel values.
 */
export function shownLuminance(input: LuminanceInput): ShownLuminance {
  const rig = lightRigFor(input.preset, input.hour, input.groundLuminance === undefined ? {} : { groundLuminance: input.groundLuminance });
  const look = skyLookFor(input.preset, input.hour, input.groundLuminance);
  const grade = GRADES[input.mood.grade];
  const air = airFor({ ...input.mood, ambience: [], music: '' });
  const albedo = input.albedo ?? [REFERENCE_ALBEDO, REFERENCE_ALBEDO, REFERENCE_ALBEDO];
  const distance = input.distance ?? 0;
  const fill = Number.isFinite(distance) ? playerFillIrradiance(rig.fillCandela, distance) : 0;
  const tint = gradeTint(grade);
  const key = rig.keyIntensity * Math.max(0, rig.keyDirection[1]);
  // The environment map is the sky: roughly the mean of its zenith and horizon colours, seen by a level surface.
  const env = look.hazeTopColor.clone().lerp(look.hazeHorizonColor, 0.5).multiplyScalar(rig.envIntensity * Math.PI);
  const irradiance: [number, number, number] = [
    rig.keyColor.r * key + rig.hemiSky.r * rig.hemiLevel + rig.rimColor.r * rig.rimLevel * RIM_COSINE + rig.fillColor.r * tint[0] * fill + env.r,
    rig.keyColor.g * key + rig.hemiSky.g * rig.hemiLevel + rig.rimColor.g * rig.rimLevel * RIM_COSINE + rig.fillColor.g * tint[1] * fill + env.g,
    rig.keyColor.b * key + rig.hemiSky.b * rig.hemiLevel + rig.rimColor.b * rig.rimLevel * RIM_COSINE + rig.fillColor.b * tint[2] * fill + env.b,
  ];
  const exposure = rig.exposure * air.exposureMul * grade.exposure;
  const radiance: [number, number, number] = [
    (albedo[0] / Math.PI) * irradiance[0],
    (albedo[1] / Math.PI) * irradiance[1],
    (albedo[2] / Math.PI) * irradiance[2],
  ];
  const shown = applyGrade(acesDisplay(radiance, exposure), grade);
  const linear = 0.2126 * shown[0] + 0.7152 * shown[1] + 0.0722 * shown[2];
  return { linear, encoded: srgbEncode(linear), exposure };
}

/** Lightning: brightness `age` seconds into a strike made of up to three pulses (start time, strength). */
export function flashAt(age: number, pulses: readonly number[]): number {
  let v = 0;
  for (let i = 0; i + 1 < pulses.length; i += 2) {
    const t = age - (pulses[i] ?? 0);
    if (t >= 0) v += (pulses[i + 1] ?? 0) * Math.exp(-t * 13);
  }
  return Math.min(1, v);
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const ASH_TINT = new Color('#5c5753');
const EMBER_TINT = new Color('#ff7a3c');
const NEUTRAL_AIR = airFor({ weather: 'clear', intensity: 0, grade: 'neutral', haze: 0.3, ambience: [], music: '' });
/** How fast the air moves towards a new mood, per second. */
const EASE = 0.6;
const WET_RISE = 0.07;
const WET_FALL = 0.02;
const WIND_X = 0.92;
const WIND_Z = 0.39;

function ease(from: number, to: number, k: number): number {
  return from + (to - from) * k;
}

export function createAtmosphere(viewport: Viewport, sky: SkyRig): Atmosphere {
  const weather = createWeather(viewport.overlay ?? viewport.scene);
  const rng = makeRng(0x57012f, 'lightning');
  const offQuality = onQuality((q) => weather.setQuality(q));

  let mood: MoodSpec = defaultMood(undefined, sky.getPreset?.() ?? 'day', sky.getFogHint?.() ?? 0);
  let target: AirSettings = { ...NEUTRAL_AIR };
  const now: AirSettings = { ...NEUTRAL_AIR };
  let theme: ThemeId | undefined;
  let tint: WeatherTint = {};
  let wetOverride: number | undefined;
  let shownLevel = -1;
  let time = 0;
  let strikeIn = 4;
  let strikeAge = 100;
  const pulses = [0, 0, 0, 0, 0, 0];
  let disposed = false;
  const fogTint = new Color(1, 1, 1);
  const heading = new Vector3();
  let groundY = 0;
  let grounded = false;

  return {
    setMood(next, style, sitePattern) {
      if (disposed) return;
      mood = next ?? defaultMood(theme ?? inferTheme(style), sky.getPreset?.() ?? 'day', sky.getFogHint?.() ?? 0, sitePattern);
      target = airFor(mood, style?.surfaces?.wet ?? 0);
      wetOverride = undefined;
      tint = {
        ...(style !== undefined && HEX6.test(style.glow) ? { glow: style.glow } : {}),
        ...(style !== undefined && HEX6.test(style.ground) ? { dust: style.ground } : {}),
      };
      if (mood.weather === 'dust' && tint.dust !== undefined) fogTint.set(tint.dust);
      else if (mood.weather === 'spores' && tint.glow !== undefined) fogTint.set(tint.glow);
      else if (mood.weather === 'ash') fogTint.copy(ASH_TINT);
      else if (mood.weather === 'embers') fogTint.copy(EMBER_TINT);
      else fogTint.setRGB(1, 1, 1);
      viewport.setGrade?.(mood.grade, 1);
      shownLevel = -1;
      strikeIn = 2 + rng.next() * 5;
    },
    update(dt, focus, hour) {
      if (disposed) return;
      const h = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
      time = (time + h) % 86400;
      const k = 1 - Math.exp(-EASE * h);

      now.densityMul = ease(now.densityMul, target.densityMul, k);
      now.densityAdd = ease(now.densityAdd, target.densityAdd, k);
      now.falloff = ease(now.falloff, target.falloff, k);
      now.fogTintMix = ease(now.fogTintMix, target.fogTintMix, k);
      now.haze = ease(now.haze, target.haze, k);
      now.cloudShadow = ease(now.cloudShadow, target.cloudShadow, k);
      now.exposureMul = ease(now.exposureMul, target.exposureMul, k);
      now.wind = ease(now.wind, target.wind, k);

      // The fog floor follows the ground the player stands on, slowly, so stairs do not pump it.
      if (!grounded) {
        groundY = focus.y;
        grounded = true;
      } else {
        groundY = ease(groundY, focus.y, 1 - Math.exp(-0.8 * h));
      }

      // Gusts: the wind breathes on two slow periods, harder in a storm.
      const gust = 1 + (mood.weather === 'storm' ? 0.45 : 0.2) * (Math.sin(time * 0.37) * 0.6 + Math.sin(time * 0.91 + 1.3) * 0.4);
      const wind = now.wind * gust;
      weather.setWind(WIND_X * wind, WIND_Z * wind);

      const daylight = sunFromHour(hour).daylight;
      // Fireflies keep to the dark. The level is stepped so the layers are not re-targeted every frame.
      const lit = mood.weather === 'fireflies' ? 1 - daylight : 1;
      const level = Math.round(Math.min(1, Math.max(0, mood.intensity)) * lit * 20) / 20;
      if (level !== shownLevel) {
        shownLevel = level;
        weather.set(mood.weather, level, tint);
      }
      weather.update(h, viewport.camera, groundY, viewport.renderer.domElement.height);

      // Lightning comes in strikes of two or three pulses; more often in a harder storm.
      let flash = 0;
      if (mood.weather === 'storm' && mood.intensity > 0) {
        strikeAge += h;
        strikeIn -= h;
        if (strikeIn <= 0) {
          strikeAge = 0;
          strikeIn = (3.5 + rng.next() * 9) / Math.max(0.3, mood.intensity);
          pulses[0] = 0;
          pulses[1] = 0.55 + rng.next() * 0.45;
          pulses[2] = 0.09 + rng.next() * 0.1;
          pulses[3] = 0.4 + rng.next() * 0.6;
          pulses[4] = (pulses[2] ?? 0) + 0.12 + rng.next() * 0.25;
          pulses[5] = rng.chance(0.5) ? 0.3 + rng.next() * 0.5 : 0;
        }
        if (strikeAge < 2) flash = flashAt(strikeAge, pulses);
      }
      sky.setFlash?.(flash);

      const wetTarget = wetOverride ?? target.wet;
      WET.value = WET.value < wetTarget ? Math.min(wetTarget, WET.value + WET_RISE * h) : Math.max(wetTarget, WET.value - WET_FALL * h);

      AIR.densityMul = now.densityMul;
      AIR.densityAdd = now.densityAdd;
      AIR.falloff = now.falloff;
      AIR.fogTint.copy(fogTint);
      AIR.fogTintMix = now.fogTintMix;
      AIR.haze = now.haze;
      AIR.cloudShadow = now.cloudShadow;
      AIR.exposureMul = now.exposureMul * (1 + 0.5 * flash);
      AIR.flash = flash;
      AIR.groundY = groundY;
      AIR.cloudSpeed.set(WIND_X * 0.004 * (0.5 + now.wind * 0.35), WIND_Z * 0.004 * (0.5 + now.wind * 0.35));

      sky.tick?.(h);
      viewport.camera.getWorldDirection(heading);
      sky.setViewDir?.(heading.x, heading.z);
    },
    setWetness(w) {
      if (disposed || !Number.isFinite(w)) return;
      wetOverride = Math.min(1, Math.max(0, w));
    },
    setTheme(next) {
      theme = next;
    },
    getMood() {
      return mood;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offQuality();
      weather.dispose();
      sky.setFlash?.(0);
      resetAirMods();
      AIR.groundY = 0;
      WET.value = 0;
    },
  };
}
