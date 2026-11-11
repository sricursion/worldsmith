// Things in the sky: moons, planets, a second sun, aurora, nebula, comet, floating islands, an orbital ring, a
// storm wall on the horizon, an eclipse. All of it rides with the camera on the far sky layer and writes no
// depth, so the land hides it and the air pass fogs it exactly as it fogs the sky behind it. Bodies are lit
// from the sun the player sees: a moon shows the phase its place in the sky gives it.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Matrix4,
  Mesh,
  Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera, IUniform, Scene, Side } from 'three';
import type { SkyFeature } from '../world/spec';
import { makeRng } from '../world/rng';
import { AIR, AIR_UNIFORMS } from './post';

export interface SkyFeatures {
  update(dt: number, camera: Camera): void;
  dispose(): void;
}

/** At most this many features are drawn; the spec allows three. */
export const MAX_SKY_FEATURES = 4;
/** Share of the sun's key light an eclipse lets through. */
export const ECLIPSE_KEY_DIM = 0.14;
/** Radiance of a sunlit white body against a night sky, and its share of the horizon's radiance by day. */
export const BODY_LEVEL_NIGHT = 1.25;
export const BODY_LEVEL_DAY_SHARE = 0.5;

const BODY_DISTANCE = 1500;
const BACKDROP_DISTANCE = 1750;
const WALL_DISTANCE = 1400;
const RING_DISTANCE = 1600;
const HEX6 = /^#?[0-9a-f]{6}$/i;
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Angular radius in radians for an apparent size 0..1: our moon (0.08) about 2.7 degrees, a huge one (0.4) about 11. */
export function featureAngularRadius(size: number): number {
  return MathUtils.degToRad(0.6 + 26 * clamp01(size));
}

/** Unit vector for an elevation and an azimuth clockwise from north (+Y up, north is -Z), written to `out`. */
export function skyDirection(elevationDeg: number, azimuthDeg: number, out: Vector3): Vector3 {
  const el = MathUtils.degToRad(elevationDeg);
  const az = MathUtils.degToRad(azimuthDeg);
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}

const ELEVATION: Partial<Record<SkyFeature['kind'], readonly [number, number]>> = {
  moon: [20, 48],
  // Low enough to stand in the frame when the player looks level: a big one rests on the horizon.
  planet: [13, 32],
  ringed_planet: [14, 30],
  comet: [26, 52],
  nebula: [38, 66],
};

/**
 * Where a feature sits in the sky. Each slot is a golden-angle turn from the last, so two features of a
 * world never share a patch of sky; the seed turns the whole arrangement and jitters each one.
 */
export function featurePlacement(kind: SkyFeature['kind'], index: number, seed: number): { elevationDeg: number; azimuthDeg: number } {
  const base = makeRng(seed, 'sky-features').range(0, 360);
  const rng = makeRng(seed, `sky-feature-${index}`);
  const band = ELEVATION[kind] ?? [20, 45];
  return {
    elevationDeg: rng.range(band[0], band[1]),
    azimuthDeg: (base + index * 137.5 + rng.range(-18, 18) + 720) % 360,
  };
}

/** Share of a body's disc that is lit, 0 new .. 1 full, seen from the ground with the sun far behind everything. */
export function litFraction(body: Vector3, sun: Vector3): number {
  return clamp01((1 - body.dot(sun)) / 2);
}

/** How much of a solid body's disc covers the sky behind it: all of it at night, this share at noon. */
export const BODY_COVER_DAY = 0.45;

/**
 * The hue a world's sky leans to and how far (0..1), from what hangs in it. A second sun colours the whole
 * day; a planet that fills a good share of the sky lends a little of its own. Everything else, and a sky
 * with no features at all, gives 0: a natural sky.
 */
export function skyCastFor(features: readonly SkyFeature[]): { color: string; amount: number } {
  let color = '#ffffff';
  let amount = 0;
  for (const f of features) {
    if (!HEX6.test(f.color)) continue;
    const size = clamp01(f.size);
    let a = 0;
    if (f.kind === 'second_sun') a = 0.25 + 0.35 * size;
    else if ((f.kind === 'planet' || f.kind === 'ringed_planet') && size >= 0.3) a = 0.08 + 0.2 * size;
    if (a > amount) {
      amount = a;
      color = f.color.startsWith('#') ? f.color : `#${f.color}`;
    }
  }
  return { color, amount };
}

/** A companion sun: the sun turned round the zenith by `offsetRad` and held a little lower, so it rises and sets with it. */
export function secondSunDirection(sun: Vector3, offsetRad: number, out: Vector3): Vector3 {
  const c = Math.cos(offsetRad);
  const s = Math.sin(offsetRad);
  return out.set(sun.x * c - sun.z * s, sun.y * 0.82 - 0.04, sun.x * s + sun.z * c).normalize();
}

/** Radiance of a sunlit white body: fixed against the night, a share of the sky's own level by day. */
export function bodyLevel(daylight: number, skyLuminance: number): number {
  const d = clamp01(daylight);
  return BODY_LEVEL_NIGHT + (Math.max(0.2, BODY_LEVEL_DAY_SHARE * Math.max(0, skyLuminance)) - BODY_LEVEL_NIGHT) * d;
}

/** Brightness of a lightning strike inside the storm wall, `age` seconds after it starts: two pulses. */
export function boltAt(age: number): number {
  if (!(age >= 0)) return 0;
  return Math.exp(-age * 9) + (age > 0.14 ? 0.7 * Math.exp(-(age - 0.14) * 12) : 0);
}

function hash3(x: number, y: number, z: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 17.3) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise, 0..1, on a unit lattice. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const at = (i: number, j: number, k: number): number => hash3(xi + i, yi + j, zi + k, seed);
  const a = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * sx;
  const b = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * sx;
  const c = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * sx;
  const d = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * sx;
  return a + (b - a) * sy + (c + (d - c) * sy - (a + (b - a) * sy)) * sz;
}

/**
 * A floating rock, about two units across: an uneven, nearly flat top over an underside that narrows into
 * hanging spurs. Faceted on purpose: it is only ever seen far off, against the sky.
 */
export function islandGeometry(seed: number): BufferGeometry {
  const geo = new IcosahedronGeometry(1, 3);
  const pos = geo.getAttribute('position');
  const rng = makeRng(seed, 'island');
  const key = rng.range(1, 90);
  const depth = rng.range(1.1, 1.9);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Everything here is a function of the position alone, so the copies of a shared corner stay together.
    const reach = 0.7 + 0.65 * noise3(x * 1.7 + 4, 0.5, z * 1.7 + 4, key);
    if (y >= 0) {
      pos.setXYZ(i, x * reach, y * (0.08 + 0.3 * noise3(x * 2.6, 5.5, z * 2.6, key)), z * reach);
    } else {
      const t = -y;
      const spur = noise3(x * 3.4, 9.5, z * 3.4, key);
      const narrow = reach * Math.pow(1 - t, 0.75) * (0.8 + 0.4 * noise3(x * 5, y * 5, z * 5, key));
      pos.setXYZ(i, x * narrow, -t * depth * (0.6 + 0.9 * spur), z * narrow);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---- Shaders -----------------------------------------------------------------------------------

const HORIZON = /* glsl */ `
  // Everything in the sky sinks into the horizon instead of ending on a line under it.
  float horizonFade(vec3 dir) {
    return smoothstep(-0.02, 0.05, dir.y);
  }
`;

const NOISE = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s / 0.9375;
  }
  ${HORIZON}
`;

const RING_ALPHA = /* glsl */ `
  uniform vec4 uRing; // inner radius, outer radius (in globe radii), opacity, 1 when the globe has a ring
  uniform float uSeed;
  float ringAlpha(float rho) {
    float t = (rho - uRing.x) / (uRing.y - uRing.x);
    if (t < 0.0 || t > 1.0) return 0.0;
    float edge = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.93, 1.0, t));
    float gap = smoothstep(0.018, 0.045, abs(t - 0.62));
    float grooves = 0.5 + 0.5 * vnoise(vec3(t * 34.0, uSeed, 0.5));
    return uRing.z * edge * gap * (0.45 + 0.55 * grooves);
  }
`;

const WORLD_VERTEX = /* glsl */ `
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vDir;
  varying vec2 vUv;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vP = position;
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vDir = w.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BODY_FRAGMENT = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uSkyCol;
  uniform float uLevel;
  uniform float uAlpha;
  uniform vec3 uTint;
  uniform vec3 uTint2;
  uniform float uGas;
  uniform float uBandFreq;
  uniform vec3 uRingN;
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vDir;
  ${NOISE}
  ${RING_ALPHA}
  void main() {
    vec3 n = normalize(vN);
    vec3 view = normalize(vDir);
    vec3 p = normalize(vP);
    vec3 albedo;
    if (uGas > 0.5) {
      // Cloud bands along the latitudes, sheared by slow turbulence, with one long-lived storm.
      float warp = fbm(p * 3.0 + uSeed);
      float lat = p.y + 0.12 * (warp - 0.5);
      float band = 0.5 + 0.5 * sin(lat * uBandFreq + 3.0 * fbm(vec3(p.xz * 1.5, lat * 6.0) + uSeed));
      float streak = fbm(vec3(p.x * 2.0, lat * 26.0, p.z * 2.0) + uSeed * 1.3);
      albedo = mix(uTint, uTint2, smoothstep(0.2, 0.8, 0.7 * band + 0.3 * streak));
      vec3 sp = normalize(vec3(cos(uSeed * 2.1) * 0.9, -0.32, sin(uSeed * 2.1) * 0.9));
      float spot = 1.0 - smoothstep(0.05, 0.2, length((p - sp) * vec3(1.0, 2.4, 1.0)));
      albedo = mix(albedo, uTint2 * 1.2, 0.6 * spot);
    } else {
      // Rock: dark plains, fine mottling, and craters with a bright rim round a darker bowl.
      float maria = smoothstep(0.45, 0.62, fbm(p * 2.2 + uSeed));
      float rough = fbm(p * 11.0 + uSeed * 1.7);
      vec3 q = p * 4.5 + uSeed;
      vec3 ci = floor(q);
      float bowl = 0.0;
      float rim = 0.0;
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          for (int z = -1; z <= 1; z++) {
            vec3 g = ci + vec3(float(x), float(y), float(z));
            vec3 o = hash33(g);
            float rad = 0.1 + 0.32 * o.x * o.x;
            float d = length(q - (g + 0.2 + 0.6 * hash33(g + 11.3))) / rad;
            bowl += 1.0 - smoothstep(0.0, 0.9, d);
            rim += smoothstep(0.8, 0.98, d) * (1.0 - smoothstep(0.98, 1.2, d));
          }
        }
      }
      albedo = mix(uTint, uTint2, maria) * (0.72 + 0.45 * rough) * (1.0 - 0.25 * min(bowl, 1.0) + 0.2 * min(rim, 1.0));
    }
    float nl = dot(n, uSun);
    float mu = max(dot(n, -view), 0.0);
    // A thick atmosphere carries light past the terminator and darkens the limb; bare rock does neither.
    float lit = mix(max(nl, 0.0), smoothstep(-0.12, 0.7, nl), 0.5 * uGas) * mix(1.0, 0.5 + 0.5 * sqrt(mu), uGas);
    if (uRing.w > 0.5) {
      float dn = dot(uSun, uRingN);
      if (abs(dn) > 0.001) {
        float t = -dot(n, uRingN) / dn;
        if (t > 0.0) lit *= 1.0 - 0.85 * ringAlpha(length(n + uSun * t));
      }
    }
    float soft = smoothstep(0.0, 0.14, mu) * horizonFade(view);
    float a = uAlpha * soft;
    // The unlit side is not black: it is the sky in front of it.
    gl_FragColor = vec4(albedo * (lit + 0.012) * uLevel * soft + uSkyCol * (0.4 * a), a);
  }
`;

const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uSun;
  uniform float uLevel;
  uniform float uAlpha;
  uniform vec3 uTint;
  uniform vec3 uRingN;
  uniform vec3 uToCam;
  uniform vec3 uCentre; // the globe's centre, relative to the camera
  uniform float uRadius;
  varying vec3 vP;
  varying vec3 vDir;
  ${NOISE}
  ${RING_ALPHA}
  void main() {
    float rho = length(vP.xy);
    float a = ringAlpha(rho);
    // Position in globe radii from the globe's centre: the globe hides the far arc and shades another.
    vec3 rel = (vDir - uCentre) / uRadius;
    float behind = dot(rel, uToCam);
    if (behind < 0.0) a *= smoothstep(0.97, 1.03, length(rel - uToCam * behind));
    float lit = 0.3 + 0.7 * abs(dot(uRingN, uSun));
    float shaded = dot(rel, uSun);
    if (shaded < 0.0) lit *= mix(0.06, 1.0, smoothstep(0.95, 1.06, length(rel - uSun * shaded)));
    float t = (rho - uRing.x) / (uRing.y - uRing.x);
    vec3 col = uTint * (0.75 + 0.35 * vnoise(vec3(t * 23.0, uSeed, 1.0))) * lit * uLevel;
    float f = horizonFade(normalize(vDir));
    gl_FragColor = vec4(col * a * f, a * uAlpha * f);
  }
`;

const QUAD_FRAGMENT_HEAD = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uSkyCol;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uTint;
  uniform vec3 uTint2;
  uniform float uGain;
  uniform vec4 uShape;
  varying vec3 vDir;
  varying vec2 vUv;
  ${NOISE}
`;

const SUN_FRAGMENT = /* glsl */ `
  ${QUAD_FRAGMENT_HEAD}
  void main() {
    // uShape.x: disc radius as a share of the quad.
    vec2 c = (vUv - 0.5) * 2.0;
    float r = length(c);
    float disc = 1.0 - smoothstep(uShape.x * 0.86, uShape.x, r);
    float edge = max(1.0 - r, 0.0);
    float glow = 0.3 * exp(-r * r / (uShape.x * uShape.x * 7.0)) + 0.05 * edge * edge * edge;
    float streak = 0.07 * pow(abs(cos(atan(c.y, c.x) * 3.0 + uSeed)), 48.0) * edge * edge;
    vec3 dir = normalize(vDir);
    // Low in the sky it reddens, as the first sun does.
    vec3 tint = mix(uTint * vec3(1.0, 0.62, 0.36), uTint, smoothstep(0.0, 0.3, dir.y));
    gl_FragColor = vec4(tint * (disc * 40.0 + (glow + streak) * 6.0) * uGain * horizonFade(dir), 1.0);
  }
`;

const ECLIPSE_FRAGMENT = /* glsl */ `
  ${QUAD_FRAGMENT_HEAD}
  void main() {
    // uShape.x: radius of the dark disc as a share of the quad.
    vec2 c = (vUv - 0.5) * 2.0;
    float r = length(c);
    float rd = uShape.x;
    float occ = 1.0 - smoothstep(rd * 0.96, rd * 1.03, r);
    // With the disc covered, the glare the sky draws round the sun goes too: a wide veil takes it down.
    float a = max(occ, 0.9 * (1.0 - smoothstep(0.25, 1.0, r)));
    float ang = atan(c.y, c.x);
    float rays = 0.45 + 0.9 * vnoise(vec3(cos(ang) * 2.6, sin(ang) * 2.6, uSeed)) + 0.35 * vnoise(vec3(cos(ang) * 9.0, sin(ang) * 9.0, uSeed + 5.0));
    float corona = pow(rd / max(r, rd), 2.2) * rays * (1.0 - smoothstep(0.5, 1.0, r));
    float off = (r - rd) / (rd * 0.1);
    float rim = exp(-off * off);
    float f = horizonFade(normalize(vDir));
    vec3 col = (uTint * corona * 0.9 + mix(uTint, vec3(1.0), 0.6) * rim * 3.0) * uGain * (1.0 - occ);
    gl_FragColor = vec4((col + uSkyCol * (0.3 * a)) * f, a * f);
  }
`;

const COMET_FRAGMENT = /* glsl */ `
  ${QUAD_FRAGMENT_HEAD}
  void main() {
    // The head sits near one end of the quad; the tail runs the rest of its length. uShape.x: length over width.
    float along = vUv.x - 0.08;
    float u = along / 0.92;
    float v = (vUv.y - 0.5) * 2.0;
    float dh = length(vec2(along * uShape.x, v));
    float head = 3.0 * exp(-dh * dh * 110.0) + 0.4 * exp(-dh * dh * 14.0);
    float w = 0.07 + 0.85 * max(u, 0.0);
    float streaks = 0.75 + 0.25 * vnoise(vec3(v / w * 3.0, u * 2.0, uSeed));
    float tail = exp(-v * v / (w * w)) * pow(max(1.0 - u, 0.0), 1.7) * smoothstep(-0.02, 0.05, u) * 0.11 / (0.08 + w) * streaks;
    vec3 col = mix(vec3(1.0), uTint, smoothstep(0.0, 0.35, u)) * (head + tail);
    gl_FragColor = vec4(col * uGain * horizonFade(normalize(vDir)), 1.0);
  }
`;

const NEBULA_FRAGMENT = /* glsl */ `
  ${QUAD_FRAGMENT_HEAD}
  void main() {
    vec2 c = (vUv - 0.5) * 2.0;
    float r = length(c);
    float n1 = fbm(vec3(c * 2.2, uSeed));
    float n2 = fbm(vec3(c * 3.1 + 5.0, uSeed + 9.0));
    float lanes = fbm(vec3(c * 5.3 - 2.0, uSeed + 3.0));
    float body = smoothstep(0.3, 0.75, n1 + 0.25 * (1.0 - r)) * (1.0 - smoothstep(0.35, 1.0, r));
    vec3 col = mix(uTint, uTint2, smoothstep(0.3, 0.7, n2));
    col += mix(uTint2, vec3(1.0), 0.5) * smoothstep(0.55, 0.85, n1 * n2 * 2.4) * 0.8;
    col *= 1.0 - 0.65 * smoothstep(0.5, 0.78, lanes);
    gl_FragColor = vec4(col * body * uGain * horizonFade(normalize(vDir)), 1.0);
  }
`;

const AURORA_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec3 vDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    // The curtain folds along its length; the top sways further than the foot.
    float sway = sin(uTime * 0.17 + uv.x * 23.0 + uSeed) + 0.6 * sin(uTime * 0.11 - uv.x * 41.0);
    p.xz *= 1.0 + 0.035 * sway * (0.4 + 0.6 * uv.y);
    vec4 w = modelMatrix * vec4(p, 1.0);
    vDir = w.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const AURORA_FRAGMENT = /* glsl */ `
  ${QUAD_FRAGMENT_HEAD}
  void main() {
    // uShape.x: how many rays the curtain holds along its length.
    float x = vUv.x * uShape.x;
    float rays = vnoise(vec3(x + 0.6 * sin(uTime * 0.05 + vUv.x * 9.0), uTime * 0.12, uSeed));
    float fine = vnoise(vec3(x * 4.3, uTime * 0.31, uSeed + 3.1));
    float ray = pow(rays, 1.7) * (0.5 + 0.5 * fine);
    float rise = smoothstep(0.0, 0.05, vUv.y) * pow(max(1.0 - vUv.y, 0.0), 1.9);
    float foot = 0.7 * exp(-vUv.y * 16.0) * smoothstep(0.0, 0.02, vUv.y);
    float ends = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
    vec3 col = mix(uTint, uTint2, smoothstep(0.12, 0.85, vUv.y));
    gl_FragColor = vec4(col * (ray * (rise + foot)) * ends * uGain * horizonFade(normalize(vDir)), 1.0);
  }
`;

const ORBIT_FRAGMENT = /* glsl */ `
  ${QUAD_FRAGMENT_HEAD}
  uniform float uLevel;
  uniform float uAlpha;
  void main() {
    vec3 dir = normalize(vDir);
    // The arc that has passed into the planet's shadow goes dark; its lights then show instead.
    float lit = 1.0 - smoothstep(0.68, 0.78, -dot(dir, uSun));
    float v = vUv.y;
    float band = smoothstep(0.0, 0.1, v) * (1.0 - smoothstep(0.9, 1.0, v));
    float rails = 0.55 + 0.45 * smoothstep(0.3, 0.36, abs(v - 0.5));
    float seg = 0.7 + 0.3 * step(0.1, fract(vUv.x * 180.0));
    float shape = band * rails * seg;
    float lamps = step(0.93, hash13(vec3(floor(vUv.x * 900.0), floor(v * 3.0), uSeed))) * band;
    float f = horizonFade(dir);
    vec3 col = uTint * shape * lit * uLevel + uTint2 * lamps * (1.0 - lit) * 1.6;
    gl_FragColor = vec4(col * f, shape * uAlpha * f);
  }
`;

const STORM_FRAGMENT = /* glsl */ `
  ${QUAD_FRAGMENT_HEAD}
  uniform vec3 uBolt; // where along the wall, how high, how bright
  void main() {
    // uShape.x: the wall's length in units of its height.
    float x = vUv.x * uShape.x;
    float n = fbm(vec3(x * 1.3 + uTime * 0.004, vUv.y * 2.2 - uTime * 0.006, uSeed));
    float billow = fbm(vec3(x * 4.0, vUv.y * 6.0 + uTime * 0.01, uSeed + 4.0));
    float top = 1.0 - smoothstep(0.42 + 0.45 * n, 0.54 + 0.45 * n, vUv.y + 0.16 * (billow - 0.5));
    float ends = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
    float a = top * ends;
    // A cloud mass as dark as the horizon lets it be: a share of the sky's own level, deeper towards the foot.
    float shade = mix(0.03, 0.34, billow * billow) * mix(0.45, 1.0, smoothstep(0.0, 0.7, vUv.y));
    vec3 col = uSkyCol * uTint * shade;
    float d = length(vec2((vUv.x - uBolt.x) * uShape.x * 1.6, (vUv.y - uBolt.y) * 2.2));
    col += vec3(0.74, 0.82, 1.0) * (uBolt.z * exp(-d * d * 9.0) * (0.35 + 0.65 * billow) * uGain);
    gl_FragColor = vec4(col * a, a);
  }
`;

const ISLAND_FRAGMENT = /* glsl */ `
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uAmbient;
  uniform vec3 uTint;
  uniform vec3 uTint2;
  varying vec3 vN;
  void main() {
    vec3 n = normalize(vN);
    vec3 albedo = mix(uTint2, uTint, smoothstep(0.35, 0.75, n.y));
    vec3 light = uKeyColor * max(dot(n, uKeyDir), 0.0) + uAmbient * (0.6 + 0.4 * n.y);
    gl_FragColor = vec4(albedo * light * 0.3183, 1.0);
  }
`;

// ---- Build -------------------------------------------------------------------------------------

type Uniforms = Record<string, IUniform>;

export function createSkyFeatures(
  scene: Scene,
  features: SkyFeature[] | undefined,
  opts: { sunDir(): Vector3; daylight(): number; seed: number },
): SkyFeatures {
  const list = (features ?? []).filter((f) => f !== null && typeof f === 'object' && typeof f.kind === 'string').slice(0, MAX_SKY_FEATURES);
  const group = new Group();
  group.name = 'sky-features';
  const disposables: { dispose(): void }[] = [];
  const ticks: ((dt: number) => void)[] = [];
  let disposed = false;
  let time = 0;
  let day = 1;
  let night = 0;
  let ownsMoon = false;
  let eclipsed = false;

  const sun = new Vector3(0, 1, 0);
  const shared = {
    uSun: { value: sun },
    uSkyCol: AIR_UNIFORMS.uFogColor,
    uTime: { value: 0 },
    /** Radiance of a sunlit white body. */
    uLevel: { value: BODY_LEVEL_NIGHT },
    /** How much a solid body hides of what is behind it: all of it at night, little by day. */
    uAlpha: { value: 1 },
  };

  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();
  const basis = new Matrix4();

  const tintOf = (f: SkyFeature, fallback: string): Color => new Color(HEX6.test(f.color) ? (f.color.startsWith('#') ? f.color : `#${f.color}`) : fallback);
  const shifted = (c: Color, h: number, s: number, l: number): Color => c.clone().offsetHSL(h, s, l);

  const material = (vertexShader: string, fragmentShader: string, uniforms: Uniforms, blend: 'add' | 'over', side: Side = DoubleSide): ShaderMaterial => {
    const m = new ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side,
      fog: false,
      toneMapped: false,
    });
    if (blend === 'add') {
      m.blending = AdditiveBlending;
    } else {
      // Colour comes premultiplied, so one material can both add light and cover what is behind it.
      m.blending = CustomBlending;
      m.blendSrc = OneFactor;
      m.blendDst = OneMinusSrcAlphaFactor;
      m.blendSrcAlpha = OneFactor;
      m.blendDstAlpha = OneMinusSrcAlphaFactor;
    }
    disposables.push(m);
    return m;
  };

  const add = <T extends Object3D>(o: T, order: number, parent: Object3D = group): T => {
    o.frustumCulled = false;
    o.renderOrder = order;
    o.castShadow = false;
    o.receiveShadow = false;
    parent.add(o);
    return o;
  };

  const own = <T extends { dispose(): void }>(g: T): T => {
    disposables.push(g);
    return g;
  };

  /** Puts a quad `distance` away along `dir`, facing the camera. */
  const aim = (o: Object3D, dir: Vector3, distance: number): void => {
    o.position.copy(dir).multiplyScalar(distance);
    o.quaternion.setFromUnitVectors(Z_AXIS, tmpA.copy(dir).negate());
  };

  const quadUniforms = (tint: Color, tint2: Color, seed: number, shape: number): Uniforms => ({
    uSun: shared.uSun,
    uSkyCol: shared.uSkyCol,
    uTime: shared.uTime,
    uSeed: { value: seed },
    uTint: { value: tint },
    uTint2: { value: tint2 },
    uGain: { value: 1 },
    uShape: { value: [shape, 0, 0, 0] },
  });
  const gainOf = (u: Uniforms): IUniform => u['uGain'] ?? { value: 1 };

  // ---- Moons and planets

  const buildBody = (f: SkyFeature, index: number, gas: boolean, ringed: boolean, followMoon: boolean): void => {
    const rng = makeRng(opts.seed, `sky-body-${index}`);
    const place = featurePlacement(f.kind, index, opts.seed);
    const dir = skyDirection(place.elevationDeg, place.azimuthDeg, new Vector3());
    // A ring more than doubles the width of what is drawn, so the globe itself is held smaller.
    const radius = BODY_DISTANCE * Math.tan(featureAngularRadius(f.size) * (ringed ? 0.62 : 1));
    const tint = tintOf(f, gas ? '#c9a878' : '#b8b2a6');
    const tint2 = gas ? shifted(tint, rng.range(-0.06, 0.06), -0.08, -0.16) : shifted(tint, 0, -0.05, -0.2);
    const seed = rng.range(1, 50);

    // Not a Group: a group would be sorted as a block, ahead of the stars its globe has to cover.
    const pivot = add(new Object3D(), -0.6);
    pivot.position.copy(dir).multiplyScalar(BODY_DISTANCE);
    // The pole leans away from straight up in the sky, and towards the viewer by enough to open a ring.
    const side = tmpB.crossVectors(dir, Y_AXIS).normalize();
    const up = tmpC.crossVectors(side, dir).normalize();
    const roll = rng.range(-0.6, 0.6);
    const open = rng.range(0.2, 0.5);
    const pole = new Vector3()
      .addScaledVector(up, Math.cos(open) * Math.cos(roll))
      .addScaledVector(side, Math.cos(open) * Math.sin(roll))
      .addScaledVector(dir, -Math.sin(open))
      .normalize();
    pivot.quaternion.setFromUnitVectors(Y_AXIS, pole);

    const ring = [1.35, 2.3, ringed ? 0.9 : 0, ringed ? 1 : 0];
    const uniforms: Uniforms = {
      uSun: shared.uSun,
      uSkyCol: shared.uSkyCol,
      uLevel: shared.uLevel,
      uAlpha: shared.uAlpha,
      uTint: { value: tint },
      uTint2: { value: tint2 },
      uGas: { value: gas ? 1 : 0 },
      uBandFreq: { value: rng.range(9, 20) },
      uSeed: { value: seed },
      uRing: { value: ring },
      uRingN: { value: pole },
    };
    const globe = add(new Mesh(own(new SphereGeometry(1, 48, 24)), material(WORLD_VERTEX, BODY_FRAGMENT, uniforms, 'over', FrontSide)), -0.6, pivot);
    globe.scale.setScalar(radius);
    const spin = rng.range(0.002, 0.006) * (gas ? 2 : 1);

    let ringMaterial: ShaderMaterial | null = null;
    const toCam = new Vector3().copy(dir).negate();
    if (ringed) {
      const ringUniforms: Uniforms = {
        uSun: shared.uSun,
        uLevel: shared.uLevel,
        uAlpha: shared.uAlpha,
        uTint: { value: shifted(tint, 0.01, -0.1, 0.08) },
        uSeed: { value: seed },
        uRing: { value: ring },
        uRingN: { value: pole },
        uToCam: { value: toCam },
        uCentre: { value: pivot.position },
        uRadius: { value: radius },
      };
      ringMaterial = material(WORLD_VERTEX, RING_FRAGMENT, ringUniforms, 'over');
      // The ring lies in the globe's equator: the geometry is built flat in XY, in globe radii.
      const mesh = add(new Mesh(own(new RingGeometry(1.35, 2.3, 128, 1)), ringMaterial), -0.55, pivot);
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.setScalar(radius);
    }

    ticks.push((dt) => {
      globe.rotation.y += spin * dt;
      if (followMoon) {
        // The first moon is the one the night is lit by: it stands where the moonlight comes from.
        pivot.position.copy(AIR.moonDir).multiplyScalar(BODY_DISTANCE);
        toCam.copy(AIR.moonDir).negate();
      }
    });
  };

  // ---- Second sun

  const buildSecondSun = (f: SkyFeature, index: number): void => {
    const rng = makeRng(opts.seed, `sky-sun-${index}`);
    const offset = rng.range(0.4, 0.85) * (rng.chance(0.5) ? 1 : -1);
    const disc = featureAngularRadius(f.size * 0.25);
    const half = Math.max(MathUtils.degToRad(9), disc * 4);
    const u = quadUniforms(tintOf(f, '#ffd9a0'), new Color(1, 1, 1), rng.range(0, 6.28), disc / half);
    const size = 2 * BODY_DISTANCE * Math.tan(half);
    const mesh = add(new Mesh(own(new PlaneGeometry(size, size)), material(WORLD_VERTEX, SUN_FRAGMENT, u, 'add')), -0.5);
    const dir = new Vector3();
    const gain = gainOf(u);
    ticks.push(() => {
      secondSunDirection(sun, offset, dir);
      aim(mesh, dir, BODY_DISTANCE);
      mesh.visible = dir.y > -0.06;
      gain.value = AIR.postActive ? 1 : 0.05;
    });
  };

  // ---- Eclipse

  const buildEclipse = (f: SkyFeature, index: number): void => {
    const rng = makeRng(opts.seed, `sky-eclipse-${index}`);
    const half = MathUtils.degToRad(18 + 14 * clamp01(f.size));
    const u = quadUniforms(tintOf(f, '#ffe9c8'), new Color(1, 1, 1), rng.range(0, 40), MathUtils.degToRad(2 + 2.5 * clamp01(f.size)) / half);
    const size = 2 * BODY_DISTANCE * Math.tan(half);
    const mesh = add(new Mesh(own(new PlaneGeometry(size, size)), material(WORLD_VERTEX, ECLIPSE_FRAGMENT, u, 'over')), -0.5);
    eclipsed = true;
    AIR.keyDim = ECLIPSE_KEY_DIM;
    const gain = gainOf(u);
    ticks.push(() => {
      aim(mesh, sun, BODY_DISTANCE);
      mesh.visible = sun.y > -0.06;
      gain.value = AIR.postActive ? 1 : 0.1;
    });
  };

  // ---- Comet

  const buildComet = (f: SkyFeature, index: number): void => {
    const rng = makeRng(opts.seed, `sky-comet-${index}`);
    const place = featurePlacement('comet', index, opts.seed);
    const dir = skyDirection(place.elevationDeg, place.azimuthDeg, new Vector3());
    const aspect = 4;
    const length = 2 * BODY_DISTANCE * Math.tan(MathUtils.degToRad(4 + 22 * clamp01(f.size)));
    const u = quadUniforms(tintOf(f, '#cfe4ff'), new Color(1, 1, 1), rng.range(0, 40), aspect);
    const mesh = add(new Mesh(own(new PlaneGeometry(length, length / aspect)), material(WORLD_VERTEX, COMET_FRAGMENT, u, 'add')), -0.5);
    const tail = new Vector3();
    const gain = gainOf(u);
    ticks.push(() => {
      // A comet's tail is blown straight away from the sun, wherever the comet is going.
      tail.copy(sun).negate().addScaledVector(dir, sun.dot(dir));
      if (tail.lengthSq() < 1e-4) tail.copy(Y_AXIS).addScaledVector(dir, -dir.y);
      tail.normalize();
      const z = tmpA.copy(dir).negate();
      const y = tmpB.crossVectors(z, tail);
      mesh.quaternion.setFromRotationMatrix(basis.makeBasis(tail, y, z));
      mesh.position.copy(dir).multiplyScalar(BODY_DISTANCE).addScaledVector(tail, 0.42 * length);
      gain.value = 2.2 * (0.12 + 0.88 * night);
    });
  };

  // ---- Nebula

  const buildNebula = (f: SkyFeature, index: number): void => {
    const rng = makeRng(opts.seed, `sky-nebula-${index}`);
    const place = featurePlacement('nebula', index, opts.seed);
    const dir = skyDirection(place.elevationDeg, place.azimuthDeg, new Vector3());
    const half = MathUtils.degToRad(20 + 32 * clamp01(f.size));
    const tint = tintOf(f, '#8a5cc8');
    const u = quadUniforms(tint, shifted(tint, rng.chance(0.5) ? 0.22 : -0.2, 0.05, 0), rng.range(0, 40), 1);
    const size = 2 * BACKDROP_DISTANCE * Math.tan(half);
    const mesh = add(new Mesh(own(new PlaneGeometry(size, size)), material(WORLD_VERTEX, NEBULA_FRAGMENT, u, 'add')), -0.9);
    aim(mesh, dir, BACKDROP_DISTANCE);

    // Star clusters: knots of stars gathered round a few centres inside the cloud.
    const count = Math.round(140 + 360 * clamp01(f.size));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const side = new Vector3().crossVectors(dir, Y_AXIS).normalize();
    const up = new Vector3().crossVectors(side, dir).normalize();
    const reach = Math.tan(half) * 0.55;
    const centres: [number, number, number][] = [];
    for (let i = 0; i < 4; i++) centres.push([rng.range(-reach, reach), rng.range(-reach, reach), rng.range(0.05, 0.22) * reach * 2]);
    const star = new Color();
    const p = new Vector3();
    for (let i = 0; i < count; i++) {
      const c = centres[i % centres.length] ?? [0, 0, 0.1];
      const gx = (rng.next() + rng.next() + rng.next() - 1.5) * c[2];
      const gy = (rng.next() + rng.next() + rng.next() - 1.5) * c[2];
      p.copy(dir).addScaledVector(side, c[0] + gx).addScaledVector(up, c[1] + gy).normalize().multiplyScalar(BACKDROP_DISTANCE - 10);
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      star.copy(tint).lerp(new Color(1, 1, 1), rng.range(0.5, 1)).multiplyScalar(rng.range(0.5, 1));
      colors[i * 3] = star.r;
      colors[i * 3 + 1] = star.g;
      colors[i * 3 + 2] = star.b;
    }
    const geo = own(new BufferGeometry());
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const starMaterial = own(new PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false, blending: AdditiveBlending }));
    const stars = add(new Points(geo, starMaterial), -0.85);
    const gain = gainOf(u);
    ticks.push(() => {
      gain.value = 0.6 * night;
      mesh.visible = night > 0.01;
      const alpha = clamp01(1 - day / 0.2);
      stars.visible = alpha > 0.01;
      starMaterial.opacity = alpha;
      starMaterial.color.setScalar(AIR.postActive ? 2.6 : 1);
    });
  };

  // ---- Aurora

  const buildAurora = (f: SkyFeature, index: number): void => {
    const rng = makeRng(opts.seed, `sky-aurora-${index}`);
    const size = clamp01(f.size);
    const tint = tintOf(f, '#6fe0a8');
    const tint2 = shifted(tint, 0.3, 0, -0.05);
    const centre = featurePlacement('aurora', index, opts.seed).azimuthDeg;
    const curtains = size > 0.45 ? 3 : 2;
    const segments = 96;
    for (let c = 0; c < curtains; c++) {
      const span = MathUtils.degToRad(70 + 190 * size) * rng.range(0.7, 1);
      const az0 = MathUtils.degToRad(centre + rng.range(-25, 25));
      const reach = rng.range(900, 1350);
      const foot = Math.tan(MathUtils.degToRad(rng.range(9, 16)));
      const head = Math.tan(MathUtils.degToRad(rng.range(34, 46) + 16 * size));
      const ph = [rng.range(0, 6.28), rng.range(0, 6.28)] as const;
      const positions = new Float32Array((segments + 1) * 2 * 3);
      const uvs = new Float32Array((segments + 1) * 2 * 2);
      const indices: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const az = az0 + (t - 0.5) * span;
        const r = reach * (1 + 0.16 * Math.sin(t * 7 + ph[0]) + 0.08 * Math.sin(t * 19 + ph[1]));
        const x = Math.sin(az) * r;
        const z = -Math.cos(az) * r;
        positions.set([x, r * foot, z, x, r * head, z], i * 6);
        uvs.set([t, 0, t, 1], i * 4);
        if (i < segments) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const geo = own(new BufferGeometry());
      geo.setAttribute('position', new BufferAttribute(positions, 3));
      geo.setAttribute('uv', new BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      const u = quadUniforms(tint, tint2, rng.range(0, 40), (span * reach) / 90);
      add(new Mesh(geo, material(AURORA_VERTEX, AURORA_FRAGMENT, u, 'add')), -0.8);
      const gain = gainOf(u);
      const level = (0.75 + 0.8 * size) * rng.range(0.75, 1);
      // An aurora is far too faint for a lit sky: it comes up through dusk and owns the night.
      ticks.push(() => {
        gain.value = level * night;
      });
    }
  };

  // ---- Orbital ring

  const buildOrbit = (f: SkyFeature, index: number): void => {
    const rng = makeRng(opts.seed, `sky-orbit-${index}`);
    const width = 2 * RING_DISTANCE * Math.tan(MathUtils.degToRad(0.4 + 3 * clamp01(f.size)));
    const tint = tintOf(f, '#d8dde6');
    const u: Uniforms = { ...quadUniforms(tint, new Color('#ffcf8a'), rng.range(0, 40), 1), uLevel: shared.uLevel, uAlpha: shared.uAlpha };
    const mesh = add(new Mesh(own(new CylinderGeometry(RING_DISTANCE, RING_DISTANCE, width, 192, 1, true)), material(WORLD_VERTEX, ORBIT_FRAGMENT, u, 'over')), -0.7);
    // The ring's axis lies low, so the arc climbs from one horizon, passes high and comes down on the other.
    const axis = skyDirection(rng.range(12, 38), rng.range(0, 360), new Vector3());
    mesh.quaternion.setFromUnitVectors(Y_AXIS, axis);
  };

  // ---- Storm wall

  const buildStorm = (f: SkyFeature, index: number): void => {
    const rng = makeRng(opts.seed, `sky-storm-${index}`);
    const size = clamp01(f.size);
    const span = MathUtils.degToRad(80 + 200 * size);
    const below = 90;
    const height = WALL_DISTANCE * Math.tan(MathUtils.degToRad(9 + 30 * size)) + below;
    const tint = tintOf(f, '#3a3f4a');
    // Only the hue of the tint is used: how dark the wall is follows the sky it stands in.
    const top = Math.max(tint.r, tint.g, tint.b, 0.05);
    tint.multiplyScalar(1 / top);
    const u: Uniforms = { ...quadUniforms(tint, new Color(1, 1, 1), rng.range(0, 40), (span * WALL_DISTANCE) / height), uBolt: { value: new Vector3(0.5, 0.4, 0) } };
    const geo = own(new CylinderGeometry(WALL_DISTANCE, WALL_DISTANCE, height, 96, 1, true, -span / 2, span));
    geo.translate(0, height / 2 - below, 0);
    const mesh = add(new Mesh(geo, material(WORLD_VERTEX, STORM_FRAGMENT, u, 'over')), -0.4);
    mesh.rotation.y = MathUtils.degToRad(rng.range(0, 360));
    const bolt = u['uBolt']?.value as Vector3;
    const gain = gainOf(u);
    let age = 100;
    let wait = rng.range(1, 4);
    ticks.push((dt) => {
      age += dt;
      wait -= dt;
      if (wait <= 0) {
        wait = rng.range(1.8, 8) / (0.5 + size);
        age = 0;
        bolt.x = rng.range(0.15, 0.85);
        bolt.y = rng.range(0.15, 0.5);
      }
      bolt.z = age < 2 ? boltAt(age) : 0;
      // Lightning inside the cloud: bright against the night, still visible by day.
      const sky = shared.uSkyCol.value;
      gain.value = 3 + 2.5 * (0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b);
    });
  };

  // ---- Floating islands

  const buildIslands = (f: SkyFeature, index: number): void => {
    const rng = makeRng(opts.seed, `sky-islands-${index}`);
    const size = clamp01(f.size);
    const count = 2 + Math.round(4 * size);
    const tint = tintOf(f, '#6f7a58');
    const rock = shifted(tint, 0.02, -0.25, -0.12);
    const base = featurePlacement('floating_islands', index, opts.seed).azimuthDeg;
    const dir = new Vector3();
    for (let i = 0; i < count; i++) {
      const distance = rng.range(520, 1100);
      skyDirection(rng.range(9, 26), base + (i - (count - 1) / 2) * rng.range(16, 30) + rng.range(-8, 8), dir);
      const u: Uniforms = {
        uKeyDir: AIR_UNIFORMS.uKeyDir,
        uKeyColor: AIR_UNIFORMS.uKeyColor,
        uAmbient: AIR_UNIFORMS.uAmbient,
        uTint: { value: tint },
        uTint2: { value: rock },
      };
      // The one feature that is a solid thing at a real distance: it writes depth, so the air pass fogs it,
      // shades its creases and takes its colour out with distance like any far hillside.
      const solid = own(new ShaderMaterial({ uniforms: u, vertexShader: WORLD_VERTEX, fragmentShader: ISLAND_FRAGMENT, fog: false, toneMapped: false }));
      const mesh = add(new Mesh(own(islandGeometry(opts.seed + index * 31 + i * 7)), solid), 0);
      const width = distance * Math.tan(MathUtils.degToRad(3 + 9 * size)) * rng.range(0.6, 1.3);
      mesh.scale.set(width, width * rng.range(0.7, 1.1), width * rng.range(0.7, 1.2));
      mesh.rotation.y = rng.range(0, 6.28);
      mesh.position.copy(dir).multiplyScalar(distance);
      const rest = mesh.position.y;
      const phase = rng.range(0, 6.28);
      const turn = rng.range(-0.004, 0.004);
      ticks.push((dt) => {
        mesh.position.y = rest + Math.sin(time * 0.09 + phase) * width * 0.03;
        mesh.rotation.y += turn * dt;
      });
    }
  };

  let moons = 0;
  list.forEach((f, index) => {
    switch (f.kind) {
      case 'moon':
        buildBody(f, index, false, false, moons === 0);
        moons++;
        ownsMoon = true;
        break;
      case 'planet':
        buildBody(f, index, makeRng(opts.seed, `sky-planet-${index}`).chance(0.5), false, false);
        break;
      case 'ringed_planet':
        buildBody(f, index, true, true, false);
        break;
      case 'second_sun':
        buildSecondSun(f, index);
        break;
      case 'eclipse':
        buildEclipse(f, index);
        break;
      case 'comet':
        buildComet(f, index);
        break;
      case 'nebula':
        buildNebula(f, index);
        break;
      case 'aurora':
        buildAurora(f, index);
        break;
      case 'orbital_ring':
        buildOrbit(f, index);
        break;
      case 'storm_wall':
        buildStorm(f, index);
        break;
      case 'floating_islands':
        buildIslands(f, index);
        break;
      default:
        break;
    }
  });
  if (ownsMoon) AIR.rigMoon = false;
  if (group.children.length > 0) scene.add(group);
  // The sky rig colours the air and shapes its clouds from these.
  const cast = skyCastFor(list);
  AIR.skyCast.set(cast.color);
  AIR.skyCastMix = cast.amount;
  AIR.skySeed = opts.seed;
  AIR.skyRev++;

  return {
    update(dt, camera) {
      if (disposed || group.children.length === 0) return;
      const h = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
      time = (time + h) % 36000;
      shared.uTime.value = time;
      sun.copy(opts.sunDir());
      day = clamp01(opts.daylight());
      night = (1 - day) * (1 - day);
      const sky = AIR.fogColor;
      shared.uLevel.value = bodyLevel(day, 0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b) * (AIR.postActive ? 1 : 0.4);
      shared.uAlpha.value = 1 - (1 - BODY_COVER_DAY) * day;
      group.position.setFromMatrixPosition(camera.matrixWorld);
      for (const tick of ticks) tick(h);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      ticks.length = 0;
      if (ownsMoon) AIR.rigMoon = true;
      if (eclipsed) AIR.keyDim = 1;
      AIR.skyCast.setRGB(1, 1, 1);
      AIR.skyCastMix = 0;
      AIR.skySeed = 0;
      AIR.skyRev++;
    },
  };
}
