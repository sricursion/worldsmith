// Ambient life: the small moving things that make a place feel inhabited. Flocks overhead, smoke off the
// chimneys, cloth in the wind, litter along the ground, lights far off at night. Everything is instanced and
// animated in the vertex shader from a handful of shared uniforms, so a frame costs five or six draw calls
// and no CPU work beyond writing those uniforms. Nothing is loaded: shapes are triangles or fragment maths.
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  Vector4,
} from 'three';
import type { IUniform, Material, Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MoodSpec, StyleSpec, ThemeId } from '../world/spec';
import type { Rng } from '../world/rng';

export type FlyerKind = 'birds' | 'gulls' | 'drones' | 'fish' | 'none';
/** Small things hanging in still air near the eye. Never set when the weather already fills the air. */
export type MoteKind = 'pollen' | 'dust' | 'embers' | 'bubbles' | 'none';
export type NightFlyerKind = 'bats' | 'drones' | 'none';
export type DriftKind = 'leaves' | 'tumbleweed' | 'paper' | 'none';
export type FlagKind = 'flag' | 'banner' | 'holo';
export type FarLightKind = 'lantern' | 'traffic' | 'craft';

export interface LifePlan {
  flyer: FlyerKind;
  nightFlyer: NightFlyerKind;
  insects: boolean;
  drift: DriftKind;
  motes: MoteKind;
  flag: FlagKind;
  lights: FarLightKind;
  /** Mean wind speed in metres per second. */
  wind: number;
  /** 0..1 share of the daytime flock that stays out in this weather. */
  flockShare: number;
}

export interface LifeOptions {
  theme: ThemeId;
  mood?: MoodSpec;
  style?: StyleSpec;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Chimney tops and campfires; smoke rises from each. */
  smoke?: Vector3[];
  /** Bases for flagpoles. When absent a few stand around the edge of the bounds. */
  flags?: Vector3[];
  /** 0 integrated graphics .. 2 full; scales instance counts. Default 2. */
  quality?: 0 | 1 | 2;
  rng: Rng;
}

export interface Life {
  update(dt: number, focus: Vector3, hour: number): void;
  dispose(): void;
}

const COAST = /sea|coast|harbo|port\b|dock|gull|wave|ocean|ship|pier|beach|island|cove|wharf|tide|surf|lagoon/;
const FOREST = /forest|wood|grove|jungle|swamp|mushroom|garden|meadow|cricket|insect|frog|cicada|orchard|glade|marsh|fern/;
const DESERT = /desert|dust|frontier|canyon|mesa|dune|badland|prairie|steppe|wasteland|arid/;
const UNDERWATER = /underwater|undersea|sea ?floor|seabed|submerged|sunken|abyssal|atlantis|beneath the waves/;
const FIERY = /lava|volcan|magma|forge|furnace|foundry|smelt|ember|infernal|brimstone|cinder/;

/** Chooses what lives here from the theme, the style words, the ground and the weather. Pure. */
export function planLife(theme: ThemeId, mood?: MoodSpec, style?: StyleSpec): LifePlan {
  const words = `${style?.name ?? ''} ${(mood?.ambience ?? []).join(' ')}`.toLowerCase();
  const ground = style?.surfaces?.ground;
  const weather = mood?.weather ?? 'clear';
  const strength = Math.min(1, Math.max(0, mood?.intensity ?? 0.5));
  const cold = weather === 'snow' || ground === 'snow' || ground === 'ice';
  const coast = COAST.test(words);
  const forest = FOREST.test(words) || ground === 'grass' || ground === 'moss' || ground === 'organic' || weather === 'spores' || weather === 'fireflies';
  const desert = DESERT.test(words) || ground === 'sand' || ground === 'regolith' || weather === 'dust';
  const wet = weather === 'rain' || weather === 'storm';

  let flyer: FlyerKind = theme === 'scifi' ? 'drones' : coast ? 'gulls' : 'birds';
  if (weather === 'ash' || ground === 'regolith') flyer = theme === 'scifi' ? 'drones' : 'none';
  const sunk = UNDERWATER.test(words);
  if (sunk) flyer = 'fish';
  const nightFlyer: NightFlyerKind = sunk ? 'none' : theme === 'scifi' ? 'drones' : cold || weather === 'storm' ? 'none' : 'bats';
  // Motes are for air the weather leaves empty: with rain, snow, dust, ash, spores, embers or fireflies falling there is enough in it.
  let motes: MoteKind = 'none';
  if (sunk) motes = 'bubbles';
  else if (weather === 'clear' || weather === 'fog' || weather === 'mist') {
    motes = FIERY.test(words) || ground === 'ash' ? 'embers' : cold ? 'none' : forest ? 'pollen' : 'dust';
  }
  let drift: DriftKind = 'leaves';
  if (cold || weather === 'rain' || sunk) drift = 'none';
  else if (theme === 'scifi' || theme === 'modern') drift = forest ? 'leaves' : 'paper';
  else if (!forest && (desert || theme === 'western')) drift = 'tumbleweed';

  const windBase = weather === 'storm' ? 7 : weather === 'dust' ? 5 : weather === 'rain' || weather === 'snow' || weather === 'ash' ? 3.2 : weather === 'fog' || weather === 'mist' || weather === 'spores' || weather === 'fireflies' ? 0.8 : 2.2;
  const scaled = weather === 'clear' ? windBase : windBase * (0.6 + 0.6 * strength);
  return {
    flyer,
    nightFlyer,
    insects: forest && !cold && !wet && !sunk && theme !== 'scifi',
    drift,
    motes,
    flag: theme === 'medieval' ? 'banner' : theme === 'scifi' ? 'holo' : 'flag',
    lights: theme === 'scifi' ? 'craft' : theme === 'modern' ? 'traffic' : 'lantern',
    wind: scaled,
    flockShare: weather === 'storm' ? 0.2 : wet || weather === 'snow' ? 0.5 : 1,
  };
}

function wrapHour(h: number): number {
  return Number.isFinite(h) ? ((h % 24) + 24) % 24 : 12;
}

/** Sine of the sun's height for a clock hour: 0 at 06:00 and 18:00, 1 at noon, -1 at midnight. */
export function sunHeight(hour: number): number {
  return Math.sin(((wrapHour(hour) - 6) / 12) * Math.PI);
}

/** 0 in daylight, 1 at night, easing through about forty minutes either side of sunrise and sunset. */
export function nightFactor(hour: number): number {
  const x = Math.min(1, Math.max(0, 0.5 - sunHeight(hour) * 3));
  return x * x * (3 - 2 * x);
}

/** Light falling on unlit sprites (smoke, leaves, wings) for an hour: cool and dim at night, warm near the horizon. */
export function lifeLight(hour: number, out: Color): Color {
  const s = sunHeight(hour);
  const day = 1 - nightFactor(hour);
  const low = Math.max(0, 1 - Math.abs(s) * 2.2) * day; // golden hour
  const r = 0.1 + day * (0.9 - 0.02 * low);
  const g = 0.13 + day * (0.84 - 0.24 * low);
  const b = 0.22 + day * (0.68 - 0.42 * low);
  return out.setRGB(r, g, b);
}

const HEX = /^#[0-9a-f]{6}$/i;
function hexColor(value: string | undefined, fallback: number): Color {
  return value !== undefined && HEX.test(value) ? new Color(value) : new Color(fallback);
}

// ---- Shaders ------------------------------------------------------------------------------------

/** Closed loop with two harmonics: a lopsided orbit that never repeats the same line of flight exactly. */
const LOOP_GLSL = /* glsl */ `
vec3 loopPath( vec4 path, float h, float th, float s ) {
  return vec3(
    path.x + path.z * ( cos( th ) + 0.22 * cos( 2.0 * th + s ) ),
    h * ( 1.0 + 0.12 * sin( 2.0 * th + s * 1.7 ) ),
    path.y + path.w * ( sin( th ) + 0.22 * sin( 3.0 * th + s ) ) );
}`;

const TAIL_GLSL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>`;

const FLYER_VERT = /* glsl */ `
attribute vec4 aPath;  // centre x, centre z, radius x, radius z
attribute vec4 aFly;   // height, angular speed, phase, half span
attribute vec4 aVar;   // lateral offset, vertical offset, loop shape, seed
attribute float aWing; // 0 at the body, 1 at the wingtip
uniform float uTime, uVis, uFlap, uAmp, uGlide, uJitter, uWrap, uMode;
uniform vec3 uFocus;
varying float vWing;
varying float vSeed;
#include <fog_pars_vertex>
${LOOP_GLSL}
void main() {
  float seed = aVar.w;
  vec4 path = aPath;
  if ( uWrap > 0.0 ) path.xy = uFocus.xz + mod( path.xy - uFocus.xz + 0.5 * uWrap, uWrap ) - 0.5 * uWrap;
  float dir = aFly.y < 0.0 ? -1.0 : 1.0;
  float th = aFly.z + uTime * aFly.y;
  vec3 p0 = loopPath( path, aFly.x, th, aVar.z );
  vec3 p1 = loopPath( path, aFly.x, th + 0.02 * dir, aVar.z );
  vec3 f = normalize( p1 - p0 );
  vec3 r = normalize( vec3( f.z, 0.0, -f.x ) );
  vec3 u = cross( f, r );
  vec3 c = p0 + r * aVar.x + vec3( 0.0, aVar.y, 0.0 );
  c += uJitter * vec3( sin( uTime * 5.3 + seed * 40.0 ), sin( uTime * 7.1 + seed * 13.0 ), cos( uTime * 4.7 + seed * 29.0 ) );
  // Wingbeat: the tip trails the root by a fraction of a cycle; gliders hold still for seconds at a time.
  float glide = mix( 1.0, smoothstep( -0.3, 0.5, sin( uTime * 0.4 + seed * 17.0 ) ), uGlide );
  float ph = uTime * uFlap * ( 0.85 + 0.3 * fract( seed * 7.31 ) ) + seed * 6.283;
  float a = sin( ph ) * uAmp * glide + 0.12;
  float tip = sin( ph - 0.9 ) * 0.45 * uAmp * glide;
  float size = aFly.w * uVis;
  vec3 world = c + size * ( r * position.x * cos( a ) + u * ( aWing * sin( a ) + aWing * aWing * tip ) + f * position.z );
  // A fish is the same outline turned on edge: its length along the way it swims, a wave running down it to the tail.
  if ( uMode > 1.5 ) world = c + size * ( f * position.x + u * position.z + r * sin( ph - position.x * 2.5 ) * 0.2 * uAmp );
  vWing = aWing;
  vSeed = seed;
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FLYER_FRAG = /* glsl */ `
uniform vec3 uColor, uColor2, uLight;
uniform float uMode, uTime;
varying float vWing;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec3 lit = 0.25 + 0.75 * uLight;
  vec3 col = mix( uColor, uColor2, smoothstep( 0.55, 0.95, vWing ) ) * lit;
  if ( uMode > 0.5 && uMode < 1.5 ) {
    float blink = step( 0.86, fract( uTime * 0.9 + vSeed * 5.0 ) );
    col = uColor * lit + uColor2 * ( 0.4 + 3.0 * blink ) * ( 1.0 - smoothstep( 0.0, 0.3, vWing ) );
  }
  gl_FragColor = vec4( col, 1.0 );
  ${TAIL_GLSL}
}`;

const NOISE_GLSL = /* glsl */ `
float hash21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash21( i ), hash21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash21( i + vec2( 0.0, 1.0 ) ), hash21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`;

const SMOKE_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec4 aSeed; // phase, lifetime, size, swirl
uniform float uTime;
uniform vec3 uWind;
varying vec2 vUv;
varying float vAge;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  float age = fract( uTime / aSeed.y + aSeed.x );
  float secs = age * aSeed.y;
  // Hot smoke climbs fast, slows as it cools, and leans further into the wind the higher it gets.
  float rise = secs * 1.25 * ( 1.0 - 0.35 * age );
  vec2 drift = uWind.xz * secs * ( 0.25 + 0.75 * age );
  vec2 wobble = vec2( sin( secs * 1.3 + aSeed.x * 30.0 ), cos( secs * 1.1 + aSeed.x * 17.0 ) ) * 0.12 * secs;
  vec3 centre = aOrigin + vec3( drift.x + wobble.x, rise, drift.y + wobble.y );
  float size = mix( 0.45, 3.4, pow( age, 0.7 ) ) * aSeed.z;
  float ang = aSeed.x * 6.283 + secs * aSeed.w;
  vec2 corner = vec2( position.x * cos( ang ) - position.y * sin( ang ), position.x * sin( ang ) + position.y * cos( ang ) );
  vec4 mvPosition = viewMatrix * vec4( centre, 1.0 );
  mvPosition.xy += corner * size;
  vUv = uv;
  vAge = age;
  vSeed = aSeed.x;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SMOKE_FRAG = /* glsl */ `
uniform vec3 uLight, uSmokeDark, uSmokeLight, uEmber;
uniform float uNight, uDensity;
varying vec2 vUv;
varying float vAge;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float body = 1.0 - smoothstep( 0.15, 1.0, length( q ) );
  vec2 np = vUv * 2.6 + vec2( vSeed * 37.0, vSeed * 11.0 - vAge * 1.4 );
  float n = vnoise( np ) * 0.65 + vnoise( np * 2.3 + 4.0 ) * 0.35;
  float billow = smoothstep( 0.28, 0.8, body * 0.75 + n * 0.55 );
  float alpha = billow * smoothstep( 0.0, 0.07, vAge ) * ( 1.0 - smoothstep( 0.4, 1.0, vAge ) ) * uDensity;
  if ( alpha < 0.004 ) discard;
  vec3 col = mix( uSmokeDark, uSmokeLight, smoothstep( 0.0, 0.5, vAge ) ) * ( 0.8 + 0.4 * n );
  col *= ( 0.2 + 0.8 * uLight ) * ( 1.0 + 0.25 * q.y );
  col += uEmber * ( 1.0 - smoothstep( 0.0, 0.2, vAge ) ) * ( 0.15 + 0.5 * uNight );
  gl_FragColor = vec4( col, alpha );
  ${TAIL_GLSL}
}`;

const DRIFT_VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aSeed; // speed share, phase, size, tint
uniform float uTime, uBox, uMode, uVis;
uniform vec3 uWind, uFocus;
uniform vec4 uBounds;
varying vec2 vUv;
varying float vTint;
varying float vRoll;
#include <fog_pars_vertex>
void main() {
  float ph = aSeed.y * 6.283;
  float windLen = max( 0.05, length( uWind.xz ) );
  // Stop and go: each piece scuds forward on a gust and nearly rests between them.
  float travel = aSeed.x * ( uTime + 1.14 * sin( uTime * 0.7 + ph ) );
  vec2 side = vec2( -uWind.z, uWind.x ) / windLen;
  vec2 p = aBase.xz + uWind.xz * travel + side * 1.5 * sin( travel * 0.35 + ph * 1.7 );
  vec2 d = mod( p - uFocus.xz + 0.5 * uBox, uBox ) - 0.5 * uBox;
  vec2 g = uFocus.xz + d;
  float edge = 1.0 - smoothstep( 0.38 * uBox, 0.5 * uBox, max( abs( d.x ), abs( d.y ) ) );
  float inside = step( uBounds.x, g.x ) * step( g.x, uBounds.y ) * step( uBounds.z, g.y ) * step( g.y, uBounds.w );
  float size = aSeed.z * edge * inside * uVis;
  float dist = travel * windLen;
  vec3 world;
  vRoll = 0.0;
  if ( uMode > 0.5 && uMode < 1.5 ) {
    // Tumbleweed: a ball that rolls a turn per circumference and skips off the ground.
    float hop = abs( sin( dist * 0.55 + ph ) );
    vec3 c = vec3( g.x, aSeed.z * 0.5 + hop * hop * 0.45 * aSeed.z, g.y );
    vec3 right = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
    vec3 up = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
    world = c + ( right * position.x + up * position.y ) * size;
    vRoll = dist / max( 0.05, aSeed.z * 0.5 );
  } else {
    // Leaf or sheet: lies on the ground, flips end over end as it travels, lifts when a gust takes it.
    float lift = pow( max( 0.0, sin( uTime * 0.45 * aSeed.x + ph ) ), 6.0 ) * ( uMode > 1.5 ? 1.5 : 0.6 );
    float spin = ph + dist * 0.4;
    float flip = dist * 2.6 + lift * 5.0;
    vec3 ax = vec3( cos( spin ), 0.0, sin( spin ) );
    vec3 az = vec3( -sin( spin ), 0.0, cos( spin ) ) * cos( flip ) + vec3( 0.0, sin( flip ), 0.0 );
    vec3 c = vec3( g.x, 0.03 + abs( sin( flip ) ) * 0.5 * aSeed.z + lift, g.y );
    world = c + ( ax * position.x + az * position.y ) * size;
  }
  vUv = uv;
  vTint = aSeed.w;
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const DRIFT_FRAG = /* glsl */ `
uniform vec3 uColor, uColor2, uLight;
uniform float uMode;
varying vec2 vUv;
varying float vTint;
varying float vRoll;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  vec3 col = mix( uColor, uColor2, vTint );
  if ( uMode < 0.5 ) {
    // Leaf: a pointed lens with a darker midrib.
    if ( abs( q.x ) * 1.9 > 1.0 - q.y * q.y ) discard;
    col *= 0.78 + 0.22 * smoothstep( 0.0, 0.1, abs( q.x ) );
  } else if ( uMode < 1.5 ) {
    // Tumbleweed: a ball of crossing twigs with daylight through it.
    float cr = cos( vRoll ), sr = sin( vRoll );
    vec2 t = vec2( q.x * cr - q.y * sr, q.x * sr + q.y * cr );
    float rad = length( t );
    float ang = atan( t.y, t.x );
    float twigs = abs( sin( ang * 5.0 + rad * 7.0 ) * sin( ang * 8.0 - rad * 11.0 + 2.0 ) );
    if ( rad > 1.0 - 0.12 * sin( ang * 9.0 ) * sin( ang * 4.0 + 1.0 ) || ( twigs > 0.42 && rad > 0.2 ) ) discard;
    col *= ( 0.55 + 0.45 * rad ) * ( 0.8 + 0.3 * q.y );
  } else {
    // Paper: a sheet with a few lines of print.
    if ( abs( q.x ) > 0.72 ) discard;
    col *= 0.9 + 0.1 * step( 0.5, fract( q.y * 5.0 + vTint * 3.0 ) );
  }
  gl_FragColor = vec4( col * ( 0.2 + 0.8 * uLight ), 1.0 );
  ${TAIL_GLSL}
}`;

const MOTE_VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aSeed; // climb in metres per second, phase, size, tint
uniform float uTime, uBox, uHeight;
uniform vec3 uWind, uFocus;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  float ph = aSeed.y * 6.283;
  // Carried on a share of the wind, climbing or settling at its own rate, wandering in slow loops.
  vec3 p = aBase + vec3( uWind.x * 0.12, aSeed.x, uWind.z * 0.12 ) * uTime;
  p += 0.35 * vec3( sin( uTime * 0.31 + ph ), sin( uTime * 0.23 + ph * 1.7 ), cos( uTime * 0.27 + ph * 2.3 ) );
  // The box of air they fill travels with the player; a mote leaving one side comes back in at the other.
  vec3 box = vec3( uBox, uHeight, uBox );
  vec3 mid = uFocus + vec3( 0.0, 0.5 * uHeight - 0.3, 0.0 );
  vec3 d = mod( p - mid + 0.5 * box, box ) - 0.5 * box;
  vec3 e = abs( d ) / ( 0.5 * box );
  vec4 mvPosition = viewMatrix * vec4( mid + d, 1.0 );
  vFade = ( 1.0 - smoothstep( 0.7, 1.0, max( e.x, e.z ) ) ) * ( 1.0 - smoothstep( 0.75, 1.0, e.y ) ) * smoothstep( 0.4, 1.5, -mvPosition.z );
  // Held to about a pixel and a half so a far mote is a steady speck and not a flicker.
  mvPosition.xy += position.xy * max( aSeed.z, -mvPosition.z * 0.0016 );
  vUv = uv;
  vSeed = aSeed.w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor, uColor2, uLight;
uniform float uMode, uTime, uNight;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
void main() {
  float r = length( vUv * 2.0 - 1.0 );
  float alpha = ( 1.0 - smoothstep( 0.25, 1.0, r ) ) * vFade;
  vec3 col = mix( uColor, uColor2, vSeed );
  if ( uMode > 1.5 ) {
    // Bubble: a bright rim around a nearly clear middle.
    alpha *= 0.2 + 0.8 * smoothstep( 0.45, 0.8, r );
    col *= 0.3 + 0.7 * uLight;
  } else if ( uMode > 0.5 ) {
    // Ember: lit from within, breathing as it burns.
    col *= 1.6 + 1.2 * sin( uTime * ( 3.0 + 4.0 * vSeed ) + vSeed * 40.0 );
  } else {
    // Pollen or dust: seen because the light catches it, so nearly gone at night.
    alpha *= 0.6 * ( 1.0 - 0.75 * uNight );
    col *= 0.3 + 0.7 * uLight;
  }
  if ( alpha < 0.004 ) discard;
  gl_FragColor = vec4( col, alpha );
  ${TAIL_GLSL}
}`;

const LIGHT_VERT = /* glsl */ `
attribute vec4 aPath;
attribute vec4 aFly; // height, angular speed, phase, size
attribute vec4 aVar; // bob, blink rate, colour pick, seed
uniform float uTime, uNight;
varying vec2 vUv;
varying float vPick;
varying float vBlink;
${LOOP_GLSL}
void main() {
  vec3 c = loopPath( aPath, aFly.x, aFly.z + uTime * aFly.y, aVar.w * 6.283 );
  c.y += aVar.x * sin( uTime * 5.5 + aVar.w * 40.0 );
  vec4 mvPosition = viewMatrix * vec4( c, 1.0 );
  // Hold a minimum size on screen so a lantern a kilometre off is still a point of light.
  mvPosition.xy += position.xy * aFly.w * max( 1.0, -mvPosition.z * 0.02 ) * step( 0.01, uNight );
  vUv = uv;
  vPick = aVar.z;
  vBlink = aVar.y > 0.0 ? 0.25 + 0.75 * step( 0.5, fract( uTime * aVar.y + aVar.w * 9.0 ) ) : 0.85 + 0.15 * sin( uTime * 9.0 + aVar.w * 50.0 );
  gl_Position = projectionMatrix * mvPosition;
}`;

const LIGHT_FRAG = /* glsl */ `
uniform vec3 uColor, uColor2;
uniform float uNight;
varying vec2 vUv;
varying float vPick;
varying float vBlink;
#include <common>
void main() {
  float r = length( vUv * 2.0 - 1.0 );
  float glow = ( exp( -r * r * 9.0 ) * 1.6 + exp( -r * 2.6 ) * 0.22 ) * ( 1.0 - smoothstep( 0.75, 1.0, r ) );
  gl_FragColor = vec4( mix( uColor, uColor2, step( 0.5, vPick ) ) * glow * vBlink * uNight, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---- Builders -----------------------------------------------------------------------------------

type Uniforms = Record<string, IUniform>;

interface Shared {
  uTime: IUniform<number>;
  /** Gusting wind, for things that only look a few seconds back (smoke). */
  uWind: IUniform<Vector3>;
  /** Steady mean wind, for things whose position is wind times elapsed time (ground drift). */
  uMeanWind: IUniform<Vector3>;
  uNight: IUniform<number>;
  uLight: IUniform<Color>;
  uFocus: IUniform<Vector3>;
}

interface Part {
  mesh: Mesh;
  /** Visibility uniform driven by the clock, when the part comes and goes with day and night. */
  vis?: { uniform: IUniform<number>; day: number; night: number };
}

function instanced(base: BufferGeometry, count: number, attrs: Record<string, [Float32Array, number]>): InstancedBufferGeometry {
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  for (const name of Object.keys(base.attributes)) {
    const a = base.getAttribute(name);
    geo.setAttribute(name, a);
  }
  for (const [name, [data, size]] of Object.entries(attrs)) geo.setAttribute(name, new InstancedBufferAttribute(data, size));
  geo.instanceCount = count;
  base.dispose(); // nothing was uploaded; the attributes now belong to the instanced geometry
  return geo;
}

function shader(vertexShader: string, fragmentShader: string, uniforms: Uniforms, extra: Partial<ShaderMaterial> = {}): ShaderMaterial {
  const mat = new ShaderMaterial({ vertexShader, fragmentShader, uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...uniforms }, fog: true, side: DoubleSide });
  Object.assign(mat, extra);
  return mat;
}

function put4(a: Float32Array, i: number, x: number, y: number, z: number, w: number): void {
  a[i * 4] = x;
  a[i * 4 + 1] = y;
  a[i * 4 + 2] = z;
  a[i * 4 + 3] = w;
}

/** A bird seen from above, span 2 along x: slim body, two wings each a swept quad and a pointed tip. */
function wingGeometry(): BufferGeometry {
  const pts: number[] = [];
  const tri = (a: [number, number], b: [number, number], c: [number, number]): void => {
    for (const p of [a, b, c]) pts.push(p[0], 0, p[1]);
  };
  tri([0, 0.5], [0.07, 0.05], [-0.07, 0.05]);
  tri([0.07, 0.05], [0, -0.45], [-0.07, 0.05]);
  for (const s of [1, -1]) {
    tri([0.05 * s, 0.22], [0.55 * s, 0.14], [0.05 * s, -0.12]);
    tri([0.55 * s, 0.14], [0.55 * s, -0.18], [0.05 * s, -0.12]);
    tri([0.55 * s, 0.14], [1 * s, -0.24], [0.55 * s, -0.18]);
  }
  const position = new Float32Array(pts);
  const wing = new Float32Array(position.length / 3);
  for (let i = 0; i < wing.length; i++) wing[i] = Math.abs(position[i * 3] ?? 0);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(position, 3));
  geo.setAttribute('aWing', new BufferAttribute(wing, 1));
  return geo;
}

interface FlyerSpec {
  height: [number, number];
  speed: [number, number];
  size: [number, number];
  /** Orbit radius as a share of the half extent, or metres when `wrap` is set. */
  radius: [number, number];
  flock: [number, number];
  spread: number;
  flap: number;
  amp: number;
  glide: number;
  jitter: number;
  wrap: number;
  mode: number;
  formation: boolean;
}

const FLYERS: Record<'birds' | 'gulls' | 'bats' | 'drones' | 'insects' | 'fish', FlyerSpec> = {
  fish: { height: [1.5, 7], speed: [1.4, 3], size: [0.22, 0.42], radius: [0.12, 0.4], flock: [12, 24], spread: 2.2, flap: 7, amp: 1, glide: 0, jitter: 0.03, wrap: 0, mode: 2, formation: false },
  birds: { height: [26, 55], speed: [7, 11], size: [0.55, 0.8], radius: [0.35, 0.75], flock: [7, 14], spread: 6, flap: 9, amp: 0.75, glide: 0.35, jitter: 0, wrap: 0, mode: 0, formation: true },
  gulls: { height: [16, 38], speed: [6, 9], size: [0.7, 0.95], radius: [0.3, 0.7], flock: [4, 8], spread: 9, flap: 6, amp: 0.6, glide: 1, jitter: 0, wrap: 0, mode: 0, formation: false },
  bats: { height: [6, 15], speed: [6, 10], size: [0.22, 0.32], radius: [0.15, 0.4], flock: [6, 12], spread: 5, flap: 26, amp: 0.9, glide: 0, jitter: 0.6, wrap: 0, mode: 0, formation: false },
  drones: { height: [14, 42], speed: [9, 16], size: [0.5, 0.8], radius: [0.4, 0.95], flock: [1, 3], spread: 10, flap: 0, amp: 0, glide: 0, jitter: 0.04, wrap: 0, mode: 1, formation: true },
  insects: { height: [0.5, 2.2], speed: [0.8, 2], size: [0.035, 0.06], radius: [0.4, 1.6], flock: [5, 9], spread: 0.5, flap: 24, amp: 1.1, glide: 0, jitter: 0.1, wrap: 36, mode: 0, formation: false },
};

function buildFlyers(kind: keyof typeof FLYERS, count: number, o: LifeOptions, shared: Shared, colors: [Color, Color]): { mesh: Mesh; vis: IUniform<number> } {
  const k = FLYERS[kind];
  const { rng, bounds } = o;
  const hx = Math.max(30, (bounds.maxX - bounds.minX) / 2);
  const hz = Math.max(30, (bounds.maxZ - bounds.minZ) / 2);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const path = new Float32Array(count * 4);
  const fly = new Float32Array(count * 4);
  const vary = new Float32Array(count * 4);
  let i = 0;
  while (i < count) {
    const n = Math.min(count - i, rng.int(k.flock[0], k.flock[1]));
    const frac = rng.range(k.radius[0], k.radius[1]);
    const rx = k.wrap > 0 ? frac : hx * frac;
    const rz = k.wrap > 0 ? frac * rng.range(0.6, 1.2) : hz * frac * rng.range(0.8, 1.1);
    const px = k.wrap > 0 ? rng.range(0, k.wrap) : cx + rng.range(-0.25, 0.25) * hx;
    const pz = k.wrap > 0 ? rng.range(0, k.wrap) : cz + rng.range(-0.25, 0.25) * hz;
    const mean = (rx + rz) / 2;
    const dir = rng.chance(0.5) ? 1 : -1;
    const omega = (rng.range(k.speed[0], k.speed[1]) / mean) * dir;
    const height = rng.range(k.height[0], k.height[1]);
    const start = rng.range(0, Math.PI * 2);
    const shape = rng.range(0, Math.PI * 2);
    const vee = k.formation && rng.chance(0.6);
    for (let j = 0; j < n; j++, i++) {
      const rank = Math.ceil(j / 2);
      const lag = vee ? rank * k.spread * 0.3 : rng.range(-1, 1) * k.spread;
      const lat = vee ? (j % 2 === 0 ? -1 : 1) * rank * k.spread * 0.22 : rng.range(-1, 1) * k.spread * 0.8;
      const vert = vee ? rank * 0.12 : rng.range(-0.35, 0.35) * k.spread;
      put4(path, i, px, pz, rx, rz);
      put4(fly, i, height, omega * (k.wrap > 0 ? rng.range(0.7, 1.3) : 1), start - (dir * lag) / mean, rng.range(k.size[0], k.size[1]));
      put4(vary, i, lat, vert, shape, rng.next());
    }
  }
  const vis: IUniform<number> = { value: 1 };
  const uniforms: Uniforms = {
    uTime: shared.uTime, uFocus: shared.uFocus, uLight: shared.uLight, uVis: vis,
    uFlap: { value: k.flap }, uAmp: { value: k.amp }, uGlide: { value: k.glide }, uJitter: { value: k.jitter },
    uWrap: { value: k.wrap }, uMode: { value: k.mode }, uColor: { value: colors[0] }, uColor2: { value: colors[1] },
  };
  const mesh = new Mesh(instanced(wingGeometry(), count, { aPath: [path, 4], aFly: [fly, 4], aVar: [vary, 4] }), shader(FLYER_VERT, FLYER_FRAG, uniforms));
  mesh.name = `life_${kind}`;
  return { mesh, vis };
}

function buildSmoke(points: readonly Vector3[], perSource: number, o: LifeOptions, shared: Shared): Mesh {
  const count = points.length * perSource;
  const origin = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  let i = 0;
  for (const p of points) {
    const life = o.rng.range(7, 11);
    for (let j = 0; j < perSource; j++, i++) {
      origin[i * 3] = p.x;
      origin[i * 3 + 1] = p.y;
      origin[i * 3 + 2] = p.z;
      // Evenly staggered ages with a little jitter: a steady column, not pulses.
      put4(seed, i, (j + o.rng.range(0, 0.6)) / perSource, life, o.rng.range(0.8, 1.25), o.rng.range(-0.5, 0.5));
    }
  }
  // A hearth gives dark smoke with a glow at its root; a machine vent gives pale steam and no fire.
  const steam = o.theme === 'scifi';
  const uniforms: Uniforms = {
    uTime: shared.uTime, uWind: shared.uWind, uNight: shared.uNight, uLight: shared.uLight,
    uSmokeDark: { value: steam ? new Color(0.5, 0.52, 0.54) : new Color(0.1, 0.095, 0.09) }, uSmokeLight: { value: steam ? new Color(0.82, 0.84, 0.86) : new Color(0.55, 0.55, 0.56) },
    uEmber: { value: steam ? new Color(0, 0, 0) : new Color(1.0, 0.42, 0.12) }, uDensity: { value: steam ? 0.42 : 0.6 },
  };
  const mesh = new Mesh(
    instanced(new PlaneGeometry(1, 1), count, { aOrigin: [origin, 3], aSeed: [seed, 4] }),
    shader(SMOKE_VERT, SMOKE_FRAG, uniforms, { transparent: true, depthWrite: false }),
  );
  mesh.name = 'life_smoke';
  mesh.renderOrder = 2;
  return mesh;
}

const DRIFT: Record<Exclude<DriftKind, 'none'>, { mode: number; box: number; count: number; size: [number, number]; speed: [number, number] }> = {
  leaves: { mode: 0, box: 44, count: 300, size: [0.07, 0.13], speed: [0.15, 0.6] },
  tumbleweed: { mode: 1, box: 90, count: 14, size: [0.45, 0.85], speed: [0.35, 0.7] },
  paper: { mode: 2, box: 60, count: 60, size: [0.16, 0.26], speed: [0.2, 0.7] },
};

function buildDrift(kind: Exclude<DriftKind, 'none'>, scale: number, o: LifeOptions, shared: Shared, colors: [Color, Color]): Mesh {
  const k = DRIFT[kind];
  const count = Math.max(4, Math.round(k.count * scale));
  const base = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    base[i * 3] = o.rng.range(0, k.box);
    base[i * 3 + 2] = o.rng.range(0, k.box);
    put4(seed, i, o.rng.range(k.speed[0], k.speed[1]), o.rng.next(), o.rng.range(k.size[0], k.size[1]), o.rng.next());
  }
  const b = o.bounds;
  const uniforms: Uniforms = {
    uTime: shared.uTime, uWind: shared.uMeanWind, uFocus: shared.uFocus, uLight: shared.uLight,
    uBox: { value: k.box }, uMode: { value: k.mode }, uVis: { value: 1 },
    uBounds: { value: new Vector4(b.minX, b.maxX, b.minZ, b.maxZ) }, uColor: { value: colors[0] }, uColor2: { value: colors[1] },
  };
  const mesh = new Mesh(instanced(new PlaneGeometry(1, 1), count, { aBase: [base, 3], aSeed: [seed, 4] }), shader(DRIFT_VERT, DRIFT_FRAG, uniforms));
  mesh.name = `life_${kind}`;
  return mesh;
}

/** Most motes ever drawn (full quality); two triangles each. */
export const MOTE_CAP = 220;
const MOTES: Record<Exclude<MoteKind, 'none'>, { mode: number; climb: [number, number]; size: [number, number] }> = {
  pollen: { mode: 0, climb: [-0.04, 0.05], size: [0.03, 0.06] },
  dust: { mode: 0, climb: [-0.02, 0.02], size: [0.02, 0.04] },
  embers: { mode: 1, climb: [0.25, 0.7], size: [0.03, 0.07] },
  bubbles: { mode: 2, climb: [0.3, 0.8], size: [0.04, 0.12] },
};
const MOTE_BOX = 28;
const MOTE_HEIGHT = 6;

function buildMotes(kind: Exclude<MoteKind, 'none'>, scale: number, o: LifeOptions, shared: Shared, colors: [Color, Color]): Mesh {
  const k = MOTES[kind];
  const count = Math.min(MOTE_CAP, Math.max(4, Math.round(MOTE_CAP * scale)));
  const base = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    base[i * 3] = o.rng.range(0, MOTE_BOX);
    base[i * 3 + 1] = o.rng.range(0, MOTE_HEIGHT);
    base[i * 3 + 2] = o.rng.range(0, MOTE_BOX);
    put4(seed, i, o.rng.range(k.climb[0], k.climb[1]), o.rng.next(), o.rng.range(k.size[0], k.size[1]), o.rng.next());
  }
  const uniforms: Uniforms = {
    uTime: shared.uTime, uWind: shared.uMeanWind, uFocus: shared.uFocus, uLight: shared.uLight, uNight: shared.uNight,
    uBox: { value: MOTE_BOX }, uHeight: { value: MOTE_HEIGHT }, uMode: { value: k.mode }, uColor: { value: colors[0] }, uColor2: { value: colors[1] },
  };
  const mesh = new Mesh(
    instanced(new PlaneGeometry(1, 1), count, { aBase: [base, 3], aSeed: [seed, 4] }),
    shader(MOTE_VERT, MOTE_FRAG, uniforms, { transparent: true, depthWrite: false, ...(kind === 'embers' ? { blending: AdditiveBlending } : {}) }),
  );
  mesh.name = 'life_motes';
  mesh.renderOrder = 2;
  return mesh;
}

function buildLights(kind: FarLightKind, count: number, o: LifeOptions, shared: Shared, accent: Color): Mesh {
  const { rng, bounds } = o;
  const hx = Math.max(40, (bounds.maxX - bounds.minX) / 2);
  const hz = Math.max(40, (bounds.maxZ - bounds.minZ) / 2);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const path = new Float32Array(count * 4);
  const fly = new Float32Array(count * 4);
  const vary = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const far = kind === 'lantern' ? rng.range(1.25, 1.9) : kind === 'traffic' ? rng.range(1.6, 2.4) : rng.range(1.5, 3);
    const speed = kind === 'lantern' ? rng.range(0.9, 1.5) : kind === 'traffic' ? rng.range(9, 15) : rng.range(14, 26);
    const height = kind === 'lantern' ? 1.5 : kind === 'traffic' ? 0.8 : rng.range(30, 90);
    const dir = rng.chance(0.5) ? 1 : -1;
    put4(path, i, cx, cz, hx * far, hz * far);
    put4(fly, i, height, (speed / ((hx + hz) * 0.5 * far)) * dir, rng.range(0, Math.PI * 2), kind === 'lantern' ? 0.5 : 0.7);
    // Road traffic shows white coming and red going; craft blink; lanterns swing as they are carried.
    put4(vary, i, kind === 'lantern' ? 0.06 : 0, kind === 'craft' ? rng.range(0.6, 1.2) : 0, kind === 'traffic' ? (dir > 0 ? 0 : 1) : rng.next() < 0.3 ? 1 : 0, rng.next());
  }
  const warm = new Color(1.0, 0.62, 0.26);
  const pair: [Color, Color] = kind === 'lantern' ? [warm, new Color(1.0, 0.8, 0.5)] : kind === 'traffic' ? [new Color(1.0, 0.95, 0.85), new Color(1.0, 0.1, 0.06)] : [accent, new Color(1.0, 0.25, 0.2)];
  const mat = new ShaderMaterial({
    vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: shared.uTime, uNight: shared.uNight, uColor: { value: pair[0].multiplyScalar(2.2) }, uColor2: { value: pair[1].multiplyScalar(2.2) } },
  });
  const mesh = new Mesh(instanced(new PlaneGeometry(1, 1), count, { aPath: [path, 4], aFly: [fly, 4], aVar: [vary, 4] }), mat);
  mesh.name = 'life_far_lights';
  mesh.renderOrder = 3;
  return mesh;
}

const FLAGS: Record<FlagKind, { pole: number; w: number; h: number; amp: number; k: number; speed: number; droop: number; glow: number }> = {
  flag: { pole: 6.5, w: 2.0, h: 1.25, amp: 0.2, k: 2.8, speed: 5.5, droop: 0.22, glow: 0 },
  banner: { pole: 5.2, w: 1.0, h: 2.6, amp: 0.13, k: 2.2, speed: 3.2, droop: 0, glow: 0 },
  holo: { pole: 6.0, w: 0.8, h: 3.2, amp: 0.05, k: 3.5, speed: 2.4, droop: 0, glow: 1.6 },
};

/** Pole and cloth in one geometry. aFly.x is how free the vertex is to move (0 at the fixing), aFly.y marks cloth. */
function flagGeometry(kind: FlagKind): BufferGeometry {
  const f = FLAGS[kind];
  const tag = (g: BufferGeometry, weight: (u: number, v: number) => number, cloth: number): BufferGeometry => {
    const uv = g.getAttribute('uv');
    const data = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      data[i * 2] = cloth > 0 ? weight(uv.getX(i), uv.getY(i)) : 0;
      data[i * 2 + 1] = cloth;
    }
    g.setAttribute('aFly', new BufferAttribute(data, 2));
    return g.index === null ? g : g.toNonIndexed();
  };
  const parts: BufferGeometry[] = [];
  const raw: BufferGeometry[] = [];
  const add = (g: BufferGeometry, weight: (u: number, v: number) => number, cloth: number): void => {
    raw.push(g);
    const t = tag(g, weight, cloth);
    if (t !== g) raw.push(t);
    parts.push(t);
  };
  add(new CylinderGeometry(0.045, 0.06, f.pole, 6).translate(0, f.pole / 2, 0), () => 0, 0);
  if (kind === 'banner') {
    add(new BoxGeometry(f.w + 0.3, 0.06, 0.06).translate(f.w / 2 + 0.1, f.pole - 0.1, 0), () => 0, 0);
    add(new PlaneGeometry(f.w, f.h, 6, 14).translate(f.w / 2 + 0.1, f.pole - 0.13 - f.h / 2, 0), (_u, v) => 1 - v, 1);
  } else {
    add(new PlaneGeometry(f.w, f.h, 14, 6).translate(f.w / 2 + 0.05, f.pole - 0.15 - f.h / 2, 0), (u) => u, 1);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of raw) g.dispose();
  if (merged === null) throw new Error('flag geometry failed to merge');
  return merged;
}

function buildFlags(kind: FlagKind, at: readonly Vector3[], o: LifeOptions, shared: Shared, cloth: Color, trim: Color, windYaw: number): InstancedMesh {
  const f = FLAGS[kind];
  const banner = kind === 'banner';
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: DoubleSide });
  const uniforms: Uniforms = {
    uTime: shared.uTime,
    uWave: { value: new Vector4(f.amp, f.k, f.speed, f.droop) },
    uRun: { value: new Vector3(banner ? 0 : 1, banner ? -1 : 0, banner ? f.h : f.w) },
    uPole: { value: new Color(kind === 'holo' ? 0x23262b : 0x3a2c20) },
    uTrim: { value: trim },
    uGlow: { value: f.glow },
  };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFly;\nuniform float uTime;\nuniform vec4 uWave;\nuniform vec3 uRun;\nvarying vec2 vFly;\nvarying vec2 vClothUv;')
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
  float tfPh = 0.0;
  #ifdef USE_INSTANCING
    tfPh = dot( instanceMatrix[3].xz, vec2( 0.37, 0.21 ) );
  #endif
  float tfRun = aFly.x * uRun.z;
  float tfCross = dot( position.xy, vec2( uRun.y, uRun.x ) );
  float tfGust = 0.65 + 0.35 * sin( uTime * 0.6 + tfPh );
  float tfA = tfRun * uWave.y - uTime * uWave.z + tfPh;
  float tfB = tfRun * uWave.y * 2.1 - uTime * uWave.z * 1.6 + tfPh * 1.7 + tfCross * 1.3;
  float tfDisp = aFly.x * uWave.x * tfGust * ( sin( tfA ) + 0.35 * sin( tfB ) );
  float tfSlope = aFly.x * uWave.x * tfGust * uWave.y * ( cos( tfA ) + 0.735 * cos( tfB ) );
  if ( aFly.y > 0.5 ) objectNormal = normalize( vec3( -tfSlope * uRun.x, -tfSlope * uRun.y, 1.0 ) );
  vFly = aFly;
  vClothUv = uv;`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.z += tfDisp;\n  transformed.y -= aFly.x * aFly.x * uWave.w * aFly.y;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uGlow;\nuniform vec3 uPole;\nuniform vec3 uTrim;\nvarying vec2 vFly;\nvarying vec2 vClothUv;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  if ( vFly.y < 0.5 ) {
    diffuseColor.rgb = uPole;
  } else {
    // A trim band across the cloth and a hem at the free edge; the fly end weathers darker.
    float band = step( abs( vClothUv.y - 0.5 ), 0.12 ) + step( 0.93, vFly.x );
    diffuseColor.rgb = mix( diffuseColor.rgb, uTrim, min( 1.0, band ) * 0.9 );
    diffuseColor.rgb *= 1.0 - 0.22 * vFly.x;
  }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uGlow * vFly.y * ( 0.7 + 0.3 * sin( vClothUv.y * 90.0 - uTime * 3.0 ) );',
      );
  };
  mat.customProgramCacheKey = () => 'worldsmith-life-flag';
  const mesh = new InstancedMesh(flagGeometry(kind), mat, at.length);
  const dummy = new Object3D();
  const tint = new Color();
  at.forEach((p, i) => {
    dummy.position.copy(p);
    // Flags trail downwind (cloth runs along local +x); banners hang square to it so the wind fills them.
    dummy.rotation.set(0, -windYaw + (banner ? Math.PI / 2 : 0) + o.rng.range(-0.25, 0.25), 0);
    dummy.scale.setScalar(o.rng.range(0.9, 1.15));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, tint.copy(cloth).multiplyScalar(o.rng.range(0.8, 1.1)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = `life_${kind}s`;
  mesh.receiveShadow = true;
  return mesh;
}

const THEME_CLOTH: Record<ThemeId, [number, number]> = {
  western: [0x8a2f25, 0xe6d9b8],
  medieval: [0x7a1f2b, 0xd9b24a],
  scifi: [0x35d0ff, 0xf2fbff],
  modern: [0x2d4f8f, 0xf0f0f0],
};

/**
 * Populates a scene with ambient life chosen from the spec. Call update once a frame with the player's
 * ground position and the town hour; it writes five uniforms and allocates nothing.
 */
export function createLife(scene: Scene, opts: LifeOptions): Life {
  const plan = planLife(opts.theme, opts.mood, opts.style);
  const q = opts.quality ?? 2;
  const scale = q === 0 ? 0.45 : q === 1 ? 0.7 : 1;
  const { rng, bounds } = opts;
  const windYaw = rng.range(0, Math.PI * 2);
  const windDir = new Vector3(Math.cos(windYaw), 0, Math.sin(windYaw));
  const gustPhase = rng.range(0, 10);
  const shared: Shared = {
    uTime: { value: 0 },
    uWind: { value: windDir.clone().multiplyScalar(plan.wind) },
    uMeanWind: { value: windDir.clone().multiplyScalar(plan.wind) },
    uNight: { value: 0 },
    uLight: { value: new Color(1, 1, 1) },
    uFocus: { value: new Vector3() },
  };
  const style = opts.style;
  const accent = hexColor(style?.accent, THEME_CLOTH[opts.theme][0]);
  const trim = hexColor(style?.trim, THEME_CLOTH[opts.theme][1]);
  const glow = hexColor(style?.glow, 0x35d0ff);
  const parts: Part[] = [];

  if (plan.flyer !== 'none') {
    const n = Math.round((plan.flyer === 'drones' ? 14 : plan.flyer === 'gulls' ? 30 : plan.flyer === 'fish' ? 90 : 64) * scale * plan.flockShare);
    const colors: [Color, Color] = plan.flyer === 'fish' ? [new Color(0.55, 0.6, 0.64).lerp(accent, 0.25), accent.clone()] : plan.flyer === 'gulls' ? [new Color(0.82, 0.83, 0.85), new Color(0.12, 0.12, 0.14)] : plan.flyer === 'drones' ? [new Color(0.07, 0.08, 0.1), glow.clone().multiplyScalar(1.5)] : [new Color(0.045, 0.04, 0.04), new Color(0.02, 0.02, 0.02)];
    if (n > 0) {
      const f = buildFlyers(plan.flyer, n, opts, shared, colors);
      parts.push({ mesh: f.mesh, vis: plan.flyer === 'drones' || plan.flyer === 'fish' ? undefined : { uniform: f.vis, day: 1, night: 0 } });
    }
  }
  if (plan.nightFlyer === 'bats') {
    const f = buildFlyers('bats', Math.round(40 * scale), opts, shared, [new Color(0.03, 0.025, 0.03), new Color(0.015, 0.012, 0.015)]);
    parts.push({ mesh: f.mesh, vis: { uniform: f.vis, day: 0, night: 1 } });
  }
  if (plan.insects) {
    const f = buildFlyers('insects', Math.round(110 * scale), opts, shared, [accent.clone().lerp(new Color(1, 1, 1), 0.35), glow.clone()]);
    parts.push({ mesh: f.mesh, vis: { uniform: f.vis, day: 1, night: 0.25 } });
  }
  const smoke = (opts.smoke ?? []).slice(0, 24);
  if (smoke.length > 0) parts.push({ mesh: buildSmoke(smoke, q === 0 ? 10 : q === 1 ? 14 : 20, opts, shared) });
  if (plan.drift !== 'none') {
    const ground = hexColor(style?.ground, 0x6b5a3c);
    const colors: [Color, Color] =
      plan.drift === 'leaves' ? [new Color(0.42, 0.2, 0.05).lerp(ground, 0.25), new Color(0.5, 0.36, 0.06).lerp(accent, 0.2)]
      : plan.drift === 'tumbleweed' ? [new Color(0.45, 0.34, 0.18), new Color(0.2, 0.14, 0.07)]
      : [new Color(0.78, 0.76, 0.7), new Color(0.6, 0.58, 0.52).lerp(accent, 0.15)];
    parts.push({ mesh: buildDrift(plan.drift, scale, opts, shared, colors) });
  }

  let poles = opts.flags ?? [];
  if (opts.flags === undefined) {
    // No anchors given: a ring of poles just inside the edge of the place, like markers on the way in.
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const n = q === 0 ? 4 : 6;
    const turn = rng.range(0, Math.PI * 2);
    poles = Array.from({ length: n }, (_, i) => {
      const a = turn + (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = rng.range(0.43, 0.48);
      return new Vector3(cx + Math.cos(a) * (bounds.maxX - bounds.minX) * r, 0, cz + Math.sin(a) * (bounds.maxZ - bounds.minZ) * r);
    });
  }
  if (poles.length > 0) parts.push({ mesh: buildFlags(plan.flag, poles, opts, shared, plan.flag === 'holo' ? glow : accent, trim, windYaw) });
  parts.push({ mesh: buildLights(plan.lights, q === 0 ? 6 : q === 1 ? 10 : 14, opts, shared, glow.clone()) });
  // Built last, so adding them leaves every other part of a seeded world exactly where it was.
  if (plan.motes !== 'none') {
    const ground = hexColor(style?.ground, 0x6b5a3c);
    const colors: [Color, Color] =
      plan.motes === 'embers' ? [new Color(1.0, 0.42, 0.1), new Color(1.0, 0.7, 0.25).lerp(glow, 0.2)]
      : plan.motes === 'bubbles' ? [new Color(0.8, 0.92, 1.0), new Color(0.95, 0.98, 1.0)]
      : plan.motes === 'pollen' ? [new Color(0.95, 0.9, 0.6), new Color(0.9, 0.95, 0.75)]
      : [new Color(0.9, 0.86, 0.78).lerp(ground, 0.3), new Color(1, 0.97, 0.9)];
    parts.push({ mesh: buildMotes(plan.motes, scale, opts, shared, colors) });
  }

  for (const p of parts) {
    p.mesh.frustumCulled = false; // positions are computed in the vertex shader
    p.mesh.matrixAutoUpdate = false;
    scene.add(p.mesh);
  }

  let disposed = false;
  return {
    update(dt, focus, hour) {
      if (disposed) return;
      const t = shared.uTime.value + Math.min(0.1, Math.max(0, dt));
      shared.uTime.value = t;
      shared.uFocus.value.copy(focus);
      const night = nightFactor(hour);
      shared.uNight.value = night;
      lifeLight(hour, shared.uLight.value);
      // Wind breathes: long swells with a quicker flutter on top, never fully still.
      const gust = 0.75 + 0.25 * Math.sin(t * 0.21 + gustPhase) + 0.12 * Math.sin(t * 0.83 + gustPhase * 2.3);
      shared.uWind.value.copy(windDir).multiplyScalar(plan.wind * gust);
      for (const p of parts) {
        if (p.vis !== undefined) p.vis.uniform.value = p.vis.day + (p.vis.night - p.vis.day) * night;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const p of parts) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as Material).dispose();
        if (p.mesh instanceof InstancedMesh) p.mesh.dispose();
      }
      parts.length = 0;
    },
  };
}
