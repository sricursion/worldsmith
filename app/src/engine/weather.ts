// Weather: every kind is one or more GPU particle layers. Each particle has a fixed seed; the vertex
// shader moves it, wraps it into a box that travels with the camera and fades it at the box faces, so
// the CPU only updates a handful of uniforms per frame. Layers live in the viewport's overlay scene:
// they draw after the fog, test themselves against the scene depth, and the additive ones bloom.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { IUniform, Object3D, PerspectiveCamera, Scene } from 'three';
import type { WeatherKind } from '../world/spec';
import { makeRng } from '../world/rng';
import { AIR_UNIFORMS, currentQuality, type Quality } from './post';
import { GLOW_LAMPS, PRACTICAL_GLOW } from './sky';

export type Triple = readonly [number, number, number];

/** Wraps a coordinate into the box of width `size` centred on `center`; the result is congruent to `p` modulo `size`. */
export function wrapToBox(p: number, center: number, size: number): number {
  const half = size * 0.5;
  const m = (((p - center + half) % size) + size) % size;
  return center + m - half;
}

/** 1 inside the box, falling to 0 at its faces: hides the jump when a particle wraps. `rel` is the offset from the centre. */
export function boxEdgeFade(rel: number, size: number): number {
  const e = Math.abs(rel) / (size * 0.5);
  const t = Math.min(1, Math.max(0, (e - 0.82) / 0.18));
  return 1 - t * t * (3 - 2 * t);
}

/** Share of the full particle count each tier draws. */
export const PARTICLE_SCALE: readonly [number, number, number] = [0.3, 0.6, 1];

export function particleCount(full: number, q: Quality): number {
  return Math.max(1, Math.round(full * PARTICLE_SCALE[q]));
}

// ---- Layer descriptions ------------------------------------------------------------------------

interface LayerBase {
  /** Particle count at the top tier. */
  count: number;
  /** Box the particles wrap in, metres. */
  size: Triple;
  /** Drift in m/s before wind. */
  vel: Triple;
  /** How much of the wind the particles pick up. */
  wind: number;
  /** Share of the kind's intensity this layer gets. */
  share: number;
  /** The box rests on the ground instead of surrounding the camera. */
  grounded: boolean;
}

interface PointLayer extends LayerBase {
  type: 'points';
  /** Per-particle spread of the drift, m/s. */
  vary: Triple;
  /** Sideways amplitude (m), frequency (rad/s), vertical amplitude (m). */
  sway: Triple;
  /** Diameter range in metres. A glowing mote's sprite is mostly halo: its hot core is a quarter of this. */
  diameter: readonly [number, number];
  colorA: string;
  colorB: string;
  /** Colour runs A to B up the box (embers cooling as they rise) instead of varying per particle. */
  lifeColor: boolean;
  /** 0: lit by the scene. Above 0: emissive, as a multiple of the bloom level. */
  glow: number;
  /** Extra brightness when seen against the key light. */
  scatter: number;
  opacity: number;
  /** Blink rate (rad/s) and the share of the cycle spent dark; rate 0 never blinks. */
  blink: readonly [number, number];
  twinkle: number;
  additive: boolean;
  /** Takes the glow tint of the town when one is given. */
  tinted: 'glow' | 'dust' | 'none';
}

interface StreakLayer extends LayerBase {
  type: 'streaks';
  /** Streak length in metres and width in metres. */
  length: number;
  width: number;
  opacity: number;
}

interface SplashLayer extends LayerBase {
  type: 'splashes';
  /** Largest ring radius, metres, and rings per second per particle. */
  radius: number;
  rate: number;
  opacity: number;
}

interface BankLayer extends LayerBase {
  type: 'banks';
  /** Billboard width range and height range, metres. */
  width: readonly [number, number];
  height: readonly [number, number];
  opacity: number;
  tinted: 'dust' | 'none';
}

export type LayerSpec = PointLayer | StreakLayer | SplashLayer | BankLayer;

const POINT_DEFAULTS = {
  type: 'points', wind: 1, share: 1, grounded: false, vary: [0, 0, 0], sway: [0, 0, 0], lifeColor: false, glow: 0, scatter: 0,
  blink: [0, 0], twinkle: 0, additive: false, tinted: 'none',
} as const;

const RAIN: StreakLayer = {
  type: 'streaks', count: 11000, size: [30, 18, 30], vel: [0, -11.5, 0], wind: 1, share: 1, grounded: false, length: 0.62, width: 0.011, opacity: 0.5,
};
const RAIN_SPLASH: SplashLayer = {
  type: 'splashes', count: 520, size: [22, 1, 22], vel: [0, 0, 0], wind: 0, share: 1, grounded: true, radius: 0.13, rate: 2.6, opacity: 0.55,
};
const LOW_MIST: BankLayer = {
  type: 'banks', count: 46, size: [150, 1, 150], vel: [0.35, 0, 0.12], wind: 0.35, share: 1, grounded: true, width: [14, 30], height: [2.2, 4.5], opacity: 0.2, tinted: 'none',
};

/** What each weather kind is made of. */
export const WEATHER_LAYERS: Record<WeatherKind, readonly LayerSpec[]> = {
  clear: [],
  rain: [RAIN, RAIN_SPLASH],
  storm: [
    { ...RAIN, count: 16000, vel: [0, -14.5, 0], wind: 1.6, length: 0.85, opacity: 0.55 },
    { ...RAIN_SPLASH, count: 800, rate: 3.4 },
    { ...LOW_MIST, count: 30, vel: [1.6, 0, 0.5], wind: 0.9, height: [3, 7], opacity: 0.14, share: 0.8 },
  ],
  snow: [
    {
      ...POINT_DEFAULTS, count: 9000, size: [34, 18, 34], vel: [0, -1.15, 0], wind: 0.8, vary: [0, 0.5, 0], sway: [0.35, 0.9, 0.06],
      diameter: [0.022, 0.05], colorA: '#f4f8ff', colorB: '#dfe9f7', scatter: 0.6, opacity: 0.9,
    },
  ],
  fog: [{ ...LOW_MIST, count: 54, width: [22, 44], height: [6, 12], opacity: 0.26, vel: [0.22, 0, 0.1] }],
  mist: [LOW_MIST],
  dust: [
    {
      ...POINT_DEFAULTS, count: 5200, size: [22, 9, 22], vel: [0.25, 0.03, 0.1], wind: 0.6, vary: [0.2, 0.05, 0.2], sway: [0.25, 0.5, 0.18],
      diameter: [0.006, 0.016], colorA: '#ffe6bd', colorB: '#f2c890', scatter: 5, opacity: 0.55, twinkle: 0.6, additive: true, tinted: 'dust',
    },
    { ...LOW_MIST, count: 34, vel: [1.1, 0, 0.4], wind: 0.8, width: [16, 34], height: [2.5, 6], opacity: 0.13, tinted: 'dust', share: 0.9 },
  ],
  ash: [
    {
      ...POINT_DEFAULTS, count: 5200, size: [30, 16, 30], vel: [0.1, -0.55, 0.05], wind: 0.9, vary: [0.1, 0.3, 0.1], sway: [0.5, 0.7, 0.12],
      diameter: [0.014, 0.042], colorA: '#8d8a86', colorB: '#3d3a38', scatter: 0.2, opacity: 0.85, twinkle: 0.35,
    },
    {
      ...POINT_DEFAULTS, count: 260, size: [30, 14, 30], vel: [0.15, -0.3, 0.05], wind: 0.9, vary: [0.1, 0.25, 0.1], sway: [0.6, 1.1, 0.2],
      diameter: [0.03, 0.07], colorA: '#ff8a3a', colorB: '#ff3c12', glow: 1.5, opacity: 0.9, twinkle: 0.7, additive: true, share: 0.6,
    },
  ],
  spores: [
    {
      ...POINT_DEFAULTS, count: 2400, size: [30, 11, 30], vel: [0.04, 0.07, 0.02], wind: 0.3, vary: [0.08, 0.08, 0.08], sway: [0.7, 0.32, 0.4],
      diameter: [0.06, 0.16], colorA: '#7dffd2', colorB: '#c8a6ff', glow: 1.35, opacity: 0.85, blink: [0.5, 0.15], additive: true, tinted: 'glow',
    },
  ],
  embers: [
    {
      ...POINT_DEFAULTS, count: 1700, size: [26, 12, 26], vel: [0.1, 1.25, 0.05], wind: 0.7, vary: [0.2, 0.7, 0.2], sway: [0.42, 1.7, 0.1],
      diameter: [0.035, 0.09], colorA: '#ffb347', colorB: '#ff2e0a', lifeColor: true, glow: 1.7, opacity: 0.95, twinkle: 0.8, additive: true,
    },
  ],
  fireflies: [
    {
      ...POINT_DEFAULTS, count: 420, size: [44, 3.2, 44], vel: [0, 0, 0], wind: 0.05, vary: [0.25, 0, 0.25], sway: [1.6, 0.5, 0.45], grounded: true,
      diameter: [0.1, 0.17], colorA: '#d9ff62', colorB: '#a8ff7a', glow: 1.9, opacity: 1, blink: [1.9, 0.5], additive: true,
    },
  ],
};

export interface WeatherTint {
  /** Colour for spores and other glowing motes, '#rrggbb'. */
  glow?: string;
  /** Colour for airborne dust, usually the ground colour, '#rrggbb'. */
  dust?: string;
}

export interface Weather {
  /** Cross-fades to a kind at an intensity of 0..1. Layers of the previous kind fade out and are freed. */
  set(kind: WeatherKind, intensity: number, tint?: WeatherTint): void;
  /** Wind on the ground plane, m/s. */
  setWind(x: number, z: number): void;
  /** `viewportHeight` is the drawing-buffer height in pixels; `groundY` the height of the ground under the camera. */
  update(dt: number, camera: PerspectiveCamera, groundY: number, viewportHeight: number): void;
  setQuality(q: Quality): void;
  dispose(): void;
}

// ---- Shaders -----------------------------------------------------------------------------------

const DEPTH_GLSL = /* glsl */ `
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  // Distance along the view axis to whatever the scene drew at this pixel.
  float sceneDepth() {
    float d = texture2D(tDepth, gl_FragCoord.xy / uResolution).x;
    return (uNear * uFar) / (uFar - (uFar - uNear) * d);
  }
`;

const WRAP_GLSL = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uSize;
  uniform vec3 uOffset;
  uniform float uIntensity;
  vec3 wrapRel(vec3 p) {
    return mod(p - uCenter + 0.5 * uSize, uSize) - 0.5 * uSize;
  }
  float edgeFade(vec3 rel) {
    vec3 e = abs(rel) / (0.5 * uSize);
    return 1.0 - smoothstep(0.82, 1.0, max(e.x, max(e.y, e.z)));
  }
`;

const LAMP_GLSL = /* glsl */ `
  uniform vec4 uLampPos[${GLOW_LAMPS}];
  uniform vec3 uLampCol[${GLOW_LAMPS}];
  uniform float uLampGain;
  // Light the nearest practical lamps throw on a point in the air.
  vec3 lampLight(vec3 world) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${GLOW_LAMPS}; i++) {
      vec3 d = uLampPos[i].xyz - world;
      float r2 = uLampPos[i].w * uLampPos[i].w;
      float d2 = dot(d, d);
      float w = max(0.0, 1.0 - d2 / max(r2 * 2.9, 1e-3));
      sum += uLampCol[i] * (w * w * 0.5 * r2 / (d2 + 0.25));
    }
    return sum * uLampGain;
  }
`;

const POINT_VERTEX = /* glsl */ `
  attribute vec4 aRand;
  uniform float uTime;
  uniform vec3 uVary;
  uniform vec3 uSway;
  uniform vec2 uDiameter;
  uniform float uScale;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uLifeColor;
  uniform float uGlow;
  uniform float uScatter;
  uniform float uOpacity;
  uniform vec2 uBlink;
  uniform float uTwinkle;
  uniform float uBloomLevel;
  uniform vec3 uKeyColor;
  uniform vec3 uAmbient;
  uniform vec3 uKeyDir;
  varying vec4 vColor;
  varying float vDepth;
  ${WRAP_GLSL}
  ${LAMP_GLSL}

  void main() {
    float ph = aRand.y * 6.2831853;
    vec3 p = position * uSize + uOffset + uVary * ((aRand.x - 0.5) * 2.0 * uTime);
    float f = uTime * uSway.y;
    p += vec3(
      sin(f * (0.7 + aRand.z * 0.6) + ph) + 0.5 * sin(f * 2.3 * (0.6 + aRand.x * 0.8) + ph * 1.9),
      sin(f * 0.63 * (0.7 + aRand.x * 0.6) + ph * 1.7),
      cos(f * 0.81 * (0.7 + aRand.y * 0.6) + ph * 2.3) + 0.5 * cos(f * 1.9 * (0.6 + aRand.z * 0.8) + ph * 1.3)
    ) * uSway.xzx;

    vec3 rel = wrapRel(p);
    vec3 world = uCenter + rel;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 0.05);
    vDepth = -mv.z;

    // A particle under a pixel and a half wide keeps that size and dims instead, so far ones do not shimmer.
    float px = mix(uDiameter.x, uDiameter.y, aRand.z) * uScale / dist;
    gl_PointSize = clamp(px, 1.5, 96.0);
    float small = min(1.0, px / 1.5);

    float life = rel.y / uSize.y + 0.5;
    float blink = 1.0;
    if (uBlink.x > 0.0) {
      float b = sin(uTime * uBlink.x * (0.6 + aRand.x * 0.8) + ph * 3.0) * 0.5 + 0.5;
      float rest = sin(uTime * uBlink.x * 0.13 * (0.5 + aRand.z) + ph * 5.0) * 0.5 + 0.5;
      blink = smoothstep(uBlink.y, min(1.0, uBlink.y + 0.25), b) * smoothstep(0.15, 0.45, rest);
    }
    float twinkle = 1.0 + uTwinkle * sin(uTime * (3.0 + aRand.x * 6.0) + ph * 7.0);

    vec3 base = mix(uColorA, uColorB, uLifeColor > 0.5 ? life : aRand.x);
    vec3 toPoint = normalize(world - cameraPosition);
    float forward = pow(max(dot(toPoint, uKeyDir), 0.0), 6.0);
    vec3 lit = base * (uAmbient * 1.5 + uKeyColor * (0.3 + uScatter * forward) + lampLight(world));
    vec3 emit = base * (uBloomLevel * uGlow);
    vec3 col = (uGlow > 0.0 ? emit : lit) * twinkle;

    float keep = step(aRand.w, uIntensity);
    float fade = edgeFade(rel) * smoothstep(0.2, 1.1, dist) * small * small;
    if (uLifeColor > 0.5) fade *= 1.0 - smoothstep(0.55, 0.98, life);
    vColor = vec4(col, uOpacity * keep * fade * blink);
    if (vColor.a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  uniform float uGlow;
  varying vec4 vColor;
  varying float vDepth;
  ${DEPTH_GLSL}
  void main() {
    if (vDepth > sceneDepth()) discard;
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    // Glowing motes are a hot core in a soft halo; lit ones a soft disc.
    float shape = uGlow > 0.0
      ? exp(-r2 * 16.0) + 0.3 * exp(-r2 * 3.2) * (1.0 - smoothstep(0.7, 1.0, r2))
      : 1.0 - smoothstep(0.35, 1.0, r2);
    gl_FragColor = vec4(vColor.rgb, vColor.a * shape);
  }
`;

const STREAK_VERTEX = /* glsl */ `
  attribute vec3 aSeed;
  attribute vec4 aRand;
  uniform float uTime;
  uniform vec3 uVel;
  uniform float uLength;
  uniform float uWidth;
  uniform float uScale;
  uniform float uOpacity;
  uniform vec3 uFogColor;
  uniform vec3 uKeyColor;
  uniform vec3 uAmbient;
  uniform vec3 uKeyDir;
  varying vec4 vColor;
  varying vec2 vQuad;
  varying float vDepth;
  ${WRAP_GLSL}
  ${LAMP_GLSL}

  void main() {
    // Each drop falls a little faster or slower than the sheet, along the same line.
    vec3 p = aSeed * uSize + uOffset + uVel * ((aRand.x - 0.5) * 0.3 * uTime);
    vec3 rel = wrapRel(p);
    vec3 world = uCenter + rel;
    vec3 axis = normalize(uVel);
    vec3 toCam = cameraPosition - world;
    float dist = max(length(toCam), 0.05);
    vec3 side = normalize(cross(axis, toCam));

    // Never thinner than a pixel and a quarter: a widened streak is dimmed by as much.
    float width = max(uWidth, 1.25 * dist / uScale);
    float thin = uWidth / width;
    float len = uLength * (0.6 + 0.8 * aRand.z);
    vec3 pos = world - axis * (position.y * len) + side * (position.x * width);
    vec4 mv = viewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    vDepth = -mv.z;
    vQuad = position.xy;

    // A drop shows the light behind it: sky, the key when seen against it, and any lamp it falls past.
    float forward = pow(max(dot(-toCam / dist, uKeyDir), 0.0), 5.0);
    vec3 col = uAmbient * 1.6 + uFogColor * 0.22 + uKeyColor * (0.05 + 0.5 * forward) + lampLight(world) * 1.4;
    float keep = step(aRand.w, uIntensity);
    float fade = edgeFade(rel) * smoothstep(0.5, 2.0, dist) * (0.55 + 0.45 * aRand.y);
    vColor = vec4(col, uOpacity * keep * fade * thin);
    if (vColor.a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const STREAK_FRAGMENT = /* glsl */ `
  varying vec4 vColor;
  varying vec2 vQuad;
  varying float vDepth;
  ${DEPTH_GLSL}
  void main() {
    if (vDepth > sceneDepth()) discard;
    float across = 1.0 - abs(vQuad.x) * 2.0;
    float along = smoothstep(0.0, 0.12, vQuad.y) * (1.0 - smoothstep(0.35, 1.0, vQuad.y));
    gl_FragColor = vec4(vColor.rgb, vColor.a * across * along);
  }
`;

const SPLASH_VERTEX = /* glsl */ `
  attribute vec3 aSeed;
  attribute vec4 aRand;
  uniform float uTime;
  uniform float uRadius;
  uniform float uRate;
  uniform float uOpacity;
  uniform vec3 uFogColor;
  uniform vec3 uKeyColor;
  uniform vec3 uAmbient;
  varying vec4 vColor;
  varying vec2 vQuad;
  varying float vPhase;
  varying float vDepth;
  ${WRAP_GLSL}
  ${LAMP_GLSL}

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  void main() {
    // Every cycle the ring lands somewhere new; within a cycle it stays where it fell.
    float cycle = uTime * uRate * (0.7 + 0.6 * aRand.x) + aRand.y * 37.0;
    float born = floor(cycle);
    vPhase = cycle - born;
    vec2 spot = hash22(aSeed.xz * 97.0 + born * vec2(0.618, 0.414));
    vec3 rel = wrapRel(vec3(spot.x * uSize.x, uCenter.y, spot.y * uSize.z));
    vec3 world = vec3(uCenter.x + rel.x, uCenter.y, uCenter.z + rel.z);
    vec3 pos = world + vec3(position.x, 0.0, position.y) * (2.0 * uRadius);
    vec4 mv = viewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    vDepth = -mv.z;
    vQuad = position.xy * 2.0;

    vec3 col = uAmbient * 1.8 + uFogColor * 0.3 + uKeyColor * 0.08 + lampLight(world) * 1.6;
    float keep = step(aRand.w, uIntensity);
    vec2 e = abs(rel.xz) / (0.5 * uSize.xz);
    float fade = 1.0 - smoothstep(0.6, 1.0, max(e.x, e.y));
    vColor = vec4(col, uOpacity * keep * fade * (1.0 - vPhase) * (1.0 - vPhase));
    if (vColor.a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const SPLASH_FRAGMENT = /* glsl */ `
  varying vec4 vColor;
  varying vec2 vQuad;
  varying float vPhase;
  varying float vDepth;
  ${DEPTH_GLSL}
  void main() {
    // The ring lies on the ground, so it is allowed a hand's width of slack against the surface it sits on.
    if (vDepth > sceneDepth() + 0.2) discard;
    float r = length(vQuad);
    float ring = sqrt(vPhase);
    float band = 0.1 + 0.08 * vPhase;
    float a = exp(-pow((r - ring * 0.9) / band, 2.0));
    a += (1.0 - smoothstep(0.0, 0.18, vPhase)) * exp(-r * r * 40.0) * 1.5;
    gl_FragColor = vec4(vColor.rgb, vColor.a * a * (1.0 - smoothstep(0.9, 1.0, r)));
  }
`;

const BANK_VERTEX = /* glsl */ `
  attribute vec3 aSeed;
  attribute vec4 aRand;
  uniform float uTime;
  uniform vec4 uExtent;   // width min, width max, height min, height max
  uniform float uOpacity;
  uniform vec3 uTint;
  uniform vec3 uFogColor;
  uniform vec3 uKeyColor;
  uniform vec3 uKeyDir;
  varying vec4 vColor;
  varying vec2 vQuad;
  varying vec2 vNoise;
  varying float vDepth;
  ${WRAP_GLSL}

  void main() {
    // Each bank also wanders a little on its own, so the field does not slide as one sheet.
    vec3 wander = vec3(aRand.x - 0.5, 0.0, aRand.y - 0.5) * (0.22 * uTime);
    vec3 rel = wrapRel(vec3(aSeed.x * uSize.x, uCenter.y, aSeed.z * uSize.z) + vec3(uOffset.x, 0.0, uOffset.z) + wander);
    float w = mix(uExtent.x, uExtent.y, aRand.z);
    float h = mix(uExtent.z, uExtent.w, aRand.y);
    vec3 base = vec3(uCenter.x + rel.x, uCenter.y - h * 0.22, uCenter.z + rel.z);
    vec3 toCam = cameraPosition - base;
    float dist = max(length(toCam.xz), 0.05);
    vec3 right = vec3(toCam.z, 0.0, -toCam.x) / dist;
    vec3 pos = base + right * (position.x * w) + vec3(0.0, (position.y + 0.5) * h, 0.0);
    vec4 mv = viewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    vDepth = -mv.z;
    vQuad = position.xy * 2.0;
    vNoise = position.xy * vec2(w / 26.0, h / 13.0) + aRand.xy * 7.0 + vec2(uTime * 0.012, uTime * 0.004);

    // Mist is the colour of the horizon, brighter where the key shines through it.
    float forward = pow(max(dot(-normalize(toCam), uKeyDir), 0.0), 3.0);
    vec3 col = uFogColor * uTint + uKeyColor * (0.07 * forward);
    float keep = step(aRand.w, uIntensity);
    vec2 e = abs(rel.xz) / (0.5 * uSize.xz);
    float fade = (1.0 - smoothstep(0.7, 1.0, max(e.x, e.y))) * smoothstep(w * 0.25, w * 0.7, dist);
    vColor = vec4(col, uOpacity * keep * fade);
    if (vColor.a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const BANK_FRAGMENT = /* glsl */ `
  uniform sampler2D tNoise;
  varying vec4 vColor;
  varying vec2 vQuad;
  varying vec2 vNoise;
  varying float vDepth;
  ${DEPTH_GLSL}
  void main() {
    // Fades out over three metres before it meets a wall or the ground, so no billboard edge shows.
    float soft = clamp((sceneDepth() - vDepth) / 3.0, 0.0, 1.0);
    if (soft <= 0.0) discard;
    float r = length(vQuad);
    float shape = 1.0 - smoothstep(0.0, 1.0, r);
    float n = texture2D(tNoise, vNoise).r * 0.6 + texture2D(tNoise, vNoise * 2.7 + 0.31).g * 0.4;
    float a = shape * shape * smoothstep(0.18, 0.75, n + shape * 0.35);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a * soft);
  }
`;

// ---- Layers ------------------------------------------------------------------------------------

type Uniforms = Record<string, IUniform>;

interface LiveLayer {
  kind: WeatherKind;
  index: number;
  spec: LayerSpec;
  object: Object3D;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  uniforms: Uniforms;
  /** Integrated drift, kept inside one box width. */
  offset: Vector3;
  intensity: number;
  target: number;
}

function sharedUniforms(): Uniforms {
  return {
    tDepth: AIR_UNIFORMS.tDepth,
    tNoise: AIR_UNIFORMS.tNoise,
    uResolution: AIR_UNIFORMS.uResolution,
    uNear: AIR_UNIFORMS.uNear,
    uFar: AIR_UNIFORMS.uFar,
    uBloomLevel: AIR_UNIFORMS.uBloomLevel,
    uFogColor: AIR_UNIFORMS.uFogColor,
    uKeyColor: AIR_UNIFORMS.uKeyColor,
    uAmbient: AIR_UNIFORMS.uAmbient,
    uKeyDir: AIR_UNIFORMS.uKeyDir,
    uLampPos: { value: PRACTICAL_GLOW.pos },
    uLampCol: { value: PRACTICAL_GLOW.col },
    uLampGain: { value: 0 },
    uCenter: { value: new Vector3() },
    uSize: { value: new Vector3(1, 1, 1) },
    uOffset: { value: new Vector3() },
    uIntensity: { value: 0 },
    uTime: { value: 0 },
    uScale: { value: 1000 },
  };
}

function seedArrays(count: number, salt: string): { seed: Float32Array; rand: Float32Array } {
  const rng = makeRng(0x7ea7be11, salt);
  const seed = new Float32Array(count * 3);
  const rand = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seed[i * 3] = rng.next();
    seed[i * 3 + 1] = rng.next();
    seed[i * 3 + 2] = rng.next();
    rand[i * 4] = rng.next();
    rand[i * 4 + 1] = rng.next();
    rand[i * 4 + 2] = rng.next();
    // The last value orders the particles: intensity i shows those below i, so the field thins evenly.
    rand[i * 4 + 3] = (i + rng.next()) / count;
  }
  return { seed, rand };
}

const QUAD_POSITIONS = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
const STREAK_POSITIONS = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]);
const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

function quadGeometry(positions: Float32Array, count: number, salt: string): InstancedBufferGeometry {
  const { seed, rand } = seedArrays(count, salt);
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(QUAD_INDEX);
  g.setAttribute('aSeed', new InstancedBufferAttribute(seed, 3));
  g.setAttribute('aRand', new InstancedBufferAttribute(rand, 4));
  g.instanceCount = count;
  return g;
}

function tintOr(hex: string | undefined, fallback: string): Color {
  return new Color(hex !== undefined && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback);
}

function buildLayer(kind: WeatherKind, index: number, spec: LayerSpec, q: Quality, tint: WeatherTint): LiveLayer {
  const count = particleCount(spec.count, q);
  const salt = `${kind}:${index}`;
  const uniforms = sharedUniforms();
  (uniforms['uSize']?.value as Vector3).set(...spec.size);
  let geometry: BufferGeometry;
  let material: ShaderMaterial;
  let object: Object3D;

  const make = (vertexShader: string, fragmentShader: string, additive: boolean): ShaderMaterial =>
    new ShaderMaterial({
      name: `weather.${salt}`,
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // The quads are turned in the vertex shader, so which way they wind is not known here.
      side: DoubleSide,
      blending: additive ? AdditiveBlending : NormalBlending,
      toneMapped: false,
      fog: false,
    });

  if (spec.type === 'points') {
    const { seed, rand } = seedArrays(count, salt);
    geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(seed, 3));
    geometry.setAttribute('aRand', new BufferAttribute(rand, 4));
    const a = spec.tinted === 'glow' ? tintOr(tint.glow, spec.colorA) : spec.tinted === 'dust' ? tintOr(tint.dust, spec.colorA) : new Color(spec.colorA);
    const b = new Color(spec.colorB);
    if (spec.tinted === 'glow' && tint.glow !== undefined) b.lerp(a, 0.55);
    if (spec.tinted === 'dust') {
      // Airborne dust is the ground, bleached by the light it scatters.
      a.lerp(new Color('#fff1d6'), 0.55);
      b.copy(a).multiplyScalar(0.85);
    }
    Object.assign(uniforms, {
      uVary: { value: new Vector3(...spec.vary) },
      uSway: { value: new Vector3(...spec.sway) },
      uDiameter: { value: new Vector2(...spec.diameter) },
      uColorA: { value: a },
      uColorB: { value: b },
      uLifeColor: { value: spec.lifeColor ? 1 : 0 },
      uGlow: { value: spec.glow },
      uScatter: { value: spec.scatter },
      uOpacity: { value: spec.opacity },
      uBlink: { value: new Vector2(...spec.blink) },
      uTwinkle: { value: spec.twinkle },
    });
    material = make(POINT_VERTEX, POINT_FRAGMENT, spec.additive);
    object = new Points(geometry, material);
  } else if (spec.type === 'streaks') {
    geometry = quadGeometry(STREAK_POSITIONS, count, salt);
    Object.assign(uniforms, {
      uVel: { value: new Vector3(...spec.vel) },
      uLength: { value: spec.length },
      uWidth: { value: spec.width },
      uOpacity: { value: spec.opacity },
    });
    material = make(STREAK_VERTEX, STREAK_FRAGMENT, true);
    object = new Mesh(geometry, material);
  } else if (spec.type === 'splashes') {
    geometry = quadGeometry(QUAD_POSITIONS, count, salt);
    Object.assign(uniforms, {
      uRadius: { value: spec.radius },
      uRate: { value: spec.rate },
      uOpacity: { value: spec.opacity },
    });
    material = make(SPLASH_VERTEX, SPLASH_FRAGMENT, true);
    object = new Mesh(geometry, material);
  } else {
    geometry = quadGeometry(QUAD_POSITIONS, count, salt);
    const t = new Color(1, 1, 1);
    if (spec.tinted === 'dust' && tint.dust !== undefined) {
      // Keep the brightness of the fog and take the hue of the ground.
      const c = tintOr(tint.dust, '#c9a878');
      const l = Math.max(0.05, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
      t.copy(c).multiplyScalar(1 / l).lerp(new Color(1, 1, 1), 0.35);
    }
    Object.assign(uniforms, {
      uExtent: { value: [spec.width[0], spec.width[1], spec.height[0], spec.height[1]] },
      uOpacity: { value: spec.opacity },
      uTint: { value: t },
    });
    material = make(BANK_VERTEX, BANK_FRAGMENT, false);
    object = new Mesh(geometry, material);
  }

  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  // Banks first, then lit particles, then the ones that glow.
  object.renderOrder = spec.type === 'banks' ? 0 : spec.type === 'points' && spec.glow > 0 ? 2 : 1;
  return { kind, index, spec, object, geometry, material, uniforms, offset: uniforms['uOffset']?.value as Vector3, intensity: 0, target: 0 };
}

function setUniform(u: Uniforms, key: string, v: number): void {
  const uni = u[key];
  if (uni !== undefined) uni.value = v;
}

const FADE_PER_SECOND = 0.45;
/** How far ahead of the camera the particle box is centred, as a share of its depth. */
const BOX_LEAD = 0.3;

export function createWeather(scene: Scene): Weather {
  let layers: LiveLayer[] = [];
  let quality: Quality = currentQuality();
  let kind: WeatherKind = 'clear';
  let level = 0;
  let tint: WeatherTint = {};
  let windX = 0.6;
  let windZ = 0.25;
  let clock = 0;
  let disposed = false;
  const forward = new Vector3();
  const eye = new Vector3();

  const drop = (l: LiveLayer): void => {
    scene.remove(l.object);
    l.geometry.dispose();
    l.material.dispose();
  };

  const retarget = (): void => {
    const specs = WEATHER_LAYERS[kind];
    for (const l of layers) l.target = 0;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (spec === undefined) continue;
      let live = layers.find((l) => l.kind === kind && l.index === i);
      if (live === undefined && level > 0) {
        live = buildLayer(kind, i, spec, quality, tint);
        layers.push(live);
        scene.add(live.object);
      }
      if (live !== undefined) live.target = Math.min(1, level * spec.share);
    }
  };

  return {
    set(nextKind, intensity, nextTint) {
      if (disposed) return;
      const nextLevel = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
      const tintChanged = nextTint !== undefined && (nextTint.glow !== tint.glow || nextTint.dust !== tint.dust);
      if (nextKind === kind && nextLevel === level && !tintChanged) return;
      if (tintChanged && nextTint !== undefined) {
        tint = { ...nextTint };
        // Colours are baked into a layer's uniforms: layers of this kind are rebuilt with the new ones.
        const stale = layers.filter((l) => l.kind === nextKind);
        layers = layers.filter((l) => l.kind !== nextKind);
        for (const l of stale) drop(l);
      }
      kind = nextKind;
      level = nextLevel;
      retarget();
    },
    setWind(x, z) {
      if (disposed || !Number.isFinite(x) || !Number.isFinite(z)) return;
      windX = x;
      windZ = z;
    },
    update(dt, camera, groundY, viewportHeight) {
      if (disposed || layers.length === 0) return;
      const h = Math.min(0.1, Math.max(0, dt));
      clock += h;
      camera.getWorldPosition(eye);
      camera.getWorldDirection(forward);
      const scale = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      let dead = false;

      for (const l of layers) {
        const step = FADE_PER_SECOND * h;
        l.intensity = l.intensity < l.target ? Math.min(l.target, l.intensity + step) : Math.max(l.target, l.intensity - step);
        if (l.target === 0 && l.intensity === 0) {
          dead = true;
          continue;
        }
        const s = l.spec;
        const u = l.uniforms;
        const vx = s.vel[0] + windX * s.wind;
        const vy = s.vel[1];
        const vz = s.vel[2] + windZ * s.wind;
        // The drift is integrated here in double precision and kept inside one box, so it never loses accuracy.
        l.offset.set((l.offset.x + vx * h) % s.size[0], (l.offset.y + vy * h) % s.size[1], (l.offset.z + vz * h) % s.size[2]);

        const center = u['uCenter']?.value as Vector3;
        const lead = s.type === 'banks' ? 0 : BOX_LEAD;
        center.set(eye.x + forward.x * s.size[0] * lead, eye.y + forward.y * s.size[1] * lead * 0.5, eye.z + forward.z * s.size[2] * lead);
        if (s.grounded) center.y = s.type === 'points' ? groundY + s.size[1] * 0.5 + 0.25 : groundY + 0.04;

        setUniform(u, 'uIntensity', l.intensity);
        setUniform(u, 'uTime', clock);
        setUniform(u, 'uScale', scale);
        setUniform(u, 'uLampGain', PRACTICAL_GLOW.gain);
        if (s.type === 'streaks') (u['uVel']?.value as Vector3).set(vx, vy, vz);
      }

      if (dead) {
        const keep: LiveLayer[] = [];
        for (const l of layers) {
          if (l.target === 0 && l.intensity === 0) drop(l);
          else keep.push(l);
        }
        layers = keep;
      }
    },
    setQuality(q) {
      if (disposed || q === quality) return;
      quality = q;
      // Counts are baked into the buffers: rebuild what is live at the new size and keep its fade state.
      const old = layers;
      layers = [];
      for (const l of old) {
        const next = buildLayer(l.kind, l.index, l.spec, quality, tint);
        next.intensity = l.intensity;
        next.target = l.target;
        next.offset.copy(l.offset);
        drop(l);
        layers.push(next);
        scene.add(next.object);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const l of layers) drop(l);
      layers = [];
    },
  };
}
