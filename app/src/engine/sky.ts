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

export interface SkyRig {
  setHour(h: number): void;
  setPreset(p: SkyPreset, fog: number): void;
  /** Moves the shadow box so it is centred on this ground position (metres). */
  setFocus?(x: number, z: number): void;
  /** Tints the hemisphere light's ground bounce, as a '#rrggbb' colour. */
  setGroundTint?(hex: string): void;
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
    turbidity: 3, rayleigh: 1.0, mieCoefficient: 0.004, mieDirectionalG: 0.85, sunScale: 1, ambientScale: 1,
    cloudCoverage: 0.35, hazeTop: '#5f7fd0', hazeTopAlpha: 0.4, hazeHorizon: '#f0a4c4', hazeHorizonAlpha: 0.94,
  },
  day: {
    turbidity: 2.2, rayleigh: 0.8, mieCoefficient: 0.0028, mieDirectionalG: 0.78, sunScale: 1, ambientScale: 1,
    cloudCoverage: 0.35, hazeTop: '#3a78d0', hazeTopAlpha: 0.45, hazeHorizon: '#dcd5c8', hazeHorizonAlpha: 0.94,
  },
  dusk: {
    turbidity: 4, rayleigh: 1.2, mieCoefficient: 0.006, mieDirectionalG: 0.88, sunScale: 1, ambientScale: 1,
    cloudCoverage: 0.4, hazeTop: '#4a4090', hazeTopAlpha: 0.55, hazeHorizon: '#f58a58', hazeHorizonAlpha: 0.95,
  },
  night: {
    turbidity: 2, rayleigh: 0.3, mieCoefficient: 0.002, mieDirectionalG: 0.7, sunScale: 0.55, ambientScale: 1,
    cloudCoverage: 0.2, hazeTop: '#050a22', hazeTopAlpha: 0.97, hazeHorizon: '#1c326a', hazeHorizonAlpha: 0.97,
  },
  overcast: {
    turbidity: 6, rayleigh: 0.9, mieCoefficient: 0.01, mieDirectionalG: 0.6, sunScale: 0.35, ambientScale: 1.6,
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
const NIGHT_EXPOSURE = 0.58;
const SUN_LOW = new Color(0xffb27a);
const SUN_HIGH = new Color(0xfff1d8);
const MOON = new Color(0x9db4ff);
const HEMI_SKY_DAY = new Color(0xb4d0ff);
const HEMI_SKY_NIGHT = new Color(0x2a3f80);
const HEMI_GROUND_DAY = new Color(0x6b5a45);
const HEMI_GROUND_NIGHT = new Color(0x0d0f1a);

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

export function exposureFor(preset: SkyPreset, hour: number): number {
  const sun = sunFromHour(hour);
  const lowSun = 1 - smoothstep(8, 55, sun.elevationDeg);
  const day = 0.46 + 0.14 * lowSun + (preset === 'overcast' ? 0.05 : 0);
  return MathUtils.lerp(NIGHT_EXPOSURE, day, sun.daylight);
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

export function skyLookFor(preset: SkyPreset, hour: number): SkyLook {
  const p = SKY_PRESETS[preset];
  const sun = sunFromHour(hour);
  const d = sun.daylight;
  const lit = smoothstep(-3, 3, sun.elevationDeg);
  const night = 1 - lit;

  // Overcast gets darker with the sun, so an evening storm is not as bright as noon.
  const bright = preset === 'overcast' ? OVERCAST_DARKEN_MIN + (1 - OVERCAST_DARKEN_MIN) * d : 1;
  const exposure = exposureFor(preset, hour);
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

const SHADOW_BOX = 90;
const SHADOW_MAP = 2048;
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

const HEX6 = /^#?[0-9a-f]{6}$/i;

export function createSky(scene: Scene, renderer: WebGLRenderer): SkyRig {
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
    uniforms: { color: { value: new Color(0xdfe8ff) }, opacity: { value: 0 } },
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
  light.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  const cam = light.shadow.camera;
  const half = SHADOW_BOX / 2;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = LIGHT_DISTANCE * 2.2;
  // About a texel and a half of normal offset: enough to stop acne on flat-shaded faces, small enough not to float shadows off walls.
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.065;
  scene.add(light);
  scene.add(light.target);

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
  const texel = SHADOW_BOX / SHADOW_MAP;

  /** Puts the light and its target over the focus point, with the target snapped to shadow texels so edges do not crawl. */
  const placeLight = (): void => {
    focus.set(focusX, 0, focusZ);
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
  };

  const rebuildEnv = (): void => {
    const next = pmrem.fromScene(envScene, 0.02);
    scene.environment = next.texture;
    if (envTarget !== null) envTarget.dispose();
    envTarget = next;
  };

  const apply = (): void => {
    const p = SKY_PRESETS[preset];
    const sun = sunFromHour(hour);
    const look = skyLookFor(preset, hour);
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
    if (sunPos !== undefined) (sunPos.value as Vector3).set(...sun.direction);

    hazeUniforms.hazeTop.value.copy(look.hazeTopColor);
    hazeUniforms.hazeHorizon.value.copy(look.hazeHorizonColor);
    hazeUniforms.hazeTopAlpha.value = look.hazeTopAlpha;
    hazeUniforms.hazeHorizonAlpha.value = look.hazeHorizonAlpha;
    hazeUniforms.hazeNight.value = look.nightness;

    const d = sun.daylight;
    // Direct light: the sun by day, a blue moon (opposite the sun) once the sun is well down.
    const sunIntensity = 3.4 * d * p.sunScale;
    const moonIntensity = 0.6 * (1 - d);
    if (sunIntensity >= moonIntensity) {
      lightDir.set(...sun.direction);
      light.intensity = sunIntensity;
      light.color.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0, 35, sun.elevationDeg));
    } else {
      lightDir.set(-sun.direction[0], Math.max(0.25, -sun.direction[1]), -sun.direction[2]).normalize();
      light.intensity = moonIntensity;
      light.color.copy(MOON);
    }
    placeLight();

    // Moon and stars: only once the sun is down.
    moonDir.set(-sun.direction[0], Math.max(0.3, -sun.direction[1]), -sun.direction[2]).normalize();
    moonOffset.copy(moonDir).multiplyScalar(MOON_RADIUS);
    moonAim.copy(moonDir).negate();
    moon.quaternion.copy(new Quaternion().setFromUnitVectors(zAxis, moonAim));
    const cloudCut = preset === 'overcast' ? 0.15 : 1;
    const moonAlpha = look.nightness * cloudCut;
    moon.visible = moonAlpha > 0.01;
    const moonOpacity = moonMaterial.uniforms['opacity'];
    if (moonOpacity !== undefined) moonOpacity.value = moonAlpha;
    const starAlpha = (d < STAR_DAYLIGHT_LIMIT ? 1 - d / STAR_DAYLIGHT_LIMIT : 0) * cloudCut;
    stars.visible = starAlpha > 0.01;
    starMat.opacity = starAlpha;

    hemi.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_DAY, d);
    hemi.groundColor.copy(HEMI_GROUND_NIGHT).lerp(groundDay, d);
    hemi.intensity = (0.3 + 0.25 * d) * p.ambientScale;

    fogColor.copy(look.fog);
    const fog = scene.fog;
    if (fog instanceof FogExp2) {
      fog.color.copy(fogColor);
      fog.density = fogDensityFor(fogHint);
    }
    scene.environmentIntensity = 0.1 + 0.3 * d;
    renderer.toneMappingExposure = look.exposure;

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
    setFocus(x, z) {
      if (disposed || !Number.isFinite(x) || !Number.isFinite(z)) return;
      focusX = x;
      focusZ = z;
      placeLight();
    },
    setGroundTint(hex) {
      if (disposed || !HEX6.test(hex)) return;
      // A bounce is the tint lit by the sun: keep it close to the default so a saturated tint stays gentle.
      groundDay.copy(HEMI_GROUND_DAY).lerp(new Color(hex.startsWith('#') ? hex : `#${hex}`), 0.65);
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(sky, stars, moon, hemi, light, light.target);
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
