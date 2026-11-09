import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MathUtils,
  PMREMGenerator,
  Scene,
  Vector3,
} from 'three';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { SkyPreset } from '../world/spec';

export interface SkyRig {
  setHour(h: number): void;
  setPreset(p: SkyPreset, fog: number): void;
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
}

export const SKY_PRESETS: Record<SkyPreset, SkyPresetParams> = {
  dawn: { turbidity: 8, rayleigh: 2.4, mieCoefficient: 0.008, mieDirectionalG: 0.85, sunScale: 1, ambientScale: 1 },
  day: { turbidity: 3.5, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.8, sunScale: 1, ambientScale: 1 },
  dusk: { turbidity: 10, rayleigh: 3, mieCoefficient: 0.01, mieDirectionalG: 0.9, sunScale: 1, ambientScale: 1 },
  night: { turbidity: 2, rayleigh: 0.3, mieCoefficient: 0.002, mieDirectionalG: 0.7, sunScale: 1, ambientScale: 1 },
  overcast: { turbidity: 20, rayleigh: 0.7, mieCoefficient: 0.03, mieDirectionalG: 0.6, sunScale: 0.3, ambientScale: 1.25 },
};

/** FogExp2 density from the 0..1 fog hint, in 1/m. */
export function fogDensityFor(fog: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(fog) ? fog : 0));
  return 0.0005 + f * f * 0.02 + f * 0.003;
}

const NIGHT_FOG = new Color(0x0b1226);
const DAY_FOG = new Color(0xbcd2e6);
const DUSK_FOG = new Color(0xe3a77a);
const OVERCAST_FOG = new Color(0x9aa3ab);
const SUN_LOW = new Color(0xffb27a);
const SUN_HIGH = new Color(0xfff1d8);
const MOON = new Color(0x8fa8ff);
const HEMI_SKY_DAY = new Color(0xbfd8ff);
const HEMI_SKY_NIGHT = new Color(0x1c2a55);
const HEMI_GROUND_DAY = new Color(0x6b5a45);
const HEMI_GROUND_NIGHT = new Color(0x0d0f1a);

const SHADOW_EXTENT = 70;
const LIGHT_DISTANCE = 140;

export function createSky(scene: Scene, renderer: WebGLRenderer): SkyRig {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  sky.frustumCulled = false;
  sky.material.depthWrite = false;
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.position.copy(camera.position);
  };
  scene.add(sky);

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

  const light = new DirectionalLight(0xffffff, 1);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  const cam = light.shadow.camera;
  cam.left = -SHADOW_EXTENT;
  cam.right = SHADOW_EXTENT;
  cam.top = SHADOW_EXTENT;
  cam.bottom = -SHADOW_EXTENT;
  cam.near = 1;
  cam.far = LIGHT_DISTANCE * 2.2;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.05;
  scene.add(light);
  scene.add(light.target);

  const fogColor = new Color();
  scene.fog = new FogExp2(DAY_FOG.getHex(), fogDensityFor(0.1));

  let hour = 12;
  let preset: SkyPreset = 'day';
  let fogHint = 0.1;
  let disposed = false;
  const tmp = new Vector3();

  const rebuildEnv = (): void => {
    const next = pmrem.fromScene(envScene, 0.02);
    scene.environment = next.texture;
    if (envTarget !== null) envTarget.dispose();
    envTarget = next;
  };

  const apply = (): void => {
    const p = SKY_PRESETS[preset];
    const sun = sunFromHour(hour);
    const u = sky.material.uniforms;
    const set = (key: string, value: number): void => {
      const uni = u[key];
      if (uni !== undefined) uni.value = value;
    };
    set('turbidity', p.turbidity);
    set('rayleigh', p.rayleigh);
    set('mieCoefficient', p.mieCoefficient);
    set('mieDirectionalG', p.mieDirectionalG);
    const sunPos = u['sunPosition'];
    if (sunPos !== undefined) (sunPos.value as Vector3).set(...sun.direction);

    const d = sun.daylight;
    // Direct light: the sun by day, a dim blue moon (opposite the sun) once the sun is well down.
    const sunIntensity = 2.8 * d * p.sunScale;
    const moonIntensity = 0.35 * (1 - d);
    if (sunIntensity >= moonIntensity) {
      tmp.set(...sun.direction);
      light.intensity = sunIntensity;
      light.color.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0, 35, sun.elevationDeg));
    } else {
      tmp.set(-sun.direction[0], Math.max(0.25, -sun.direction[1]), -sun.direction[2]).normalize();
      light.intensity = moonIntensity;
      light.color.copy(MOON);
    }
    light.position.copy(light.target.position).addScaledVector(tmp, LIGHT_DISTANCE);

    hemi.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_DAY, d);
    hemi.groundColor.copy(HEMI_GROUND_NIGHT).lerp(HEMI_GROUND_DAY, d);
    hemi.intensity = (0.22 + 0.5 * d) * p.ambientScale;

    const duskAmount = 1 - smoothstep(4, 22, Math.abs(sun.elevationDeg));
    fogColor.copy(NIGHT_FOG).lerp(DAY_FOG, d).lerp(DUSK_FOG, duskAmount * 0.5 * d + duskAmount * 0.15);
    if (preset === 'overcast') fogColor.lerp(OVERCAST_FOG, 0.6 * d);
    const fog = scene.fog;
    if (fog instanceof FogExp2) {
      fog.color.copy(fogColor);
      fog.density = fogDensityFor(fogHint);
    }
    scene.environmentIntensity = 0.1 + 0.55 * d;
    renderer.toneMappingExposure = 0.38 + 0.17 * d;

    const step = envStepForHour(hour);
    if (step !== envStep) {
      envStep = step;
      rebuildEnv();
    }
  };

  apply();

  return {
    setHour(h) {
      if (disposed || !Number.isFinite(h)) return;
      hour = wrapHour(h);
      apply();
    },
    setPreset(p, fog) {
      if (disposed) return;
      preset = p;
      fogHint = fog;
      envStep = -1; // the sky look changed, so the env map must be rebuilt
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(sky, hemi, light, light.target);
      envScene.remove(envSky);
      sky.geometry.dispose();
      sky.material.dispose();
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
