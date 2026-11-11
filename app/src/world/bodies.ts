// Body plans for everything that lives: one articulated skeleton per CreatureFamily, reshaped by dials.
// Pure data and math. A plan is a joint tree (rest positions only; every joint frame is axis-aligned at
// rest) plus rigid primitive segments hung on the joints. +Z is forward, +Y up, +X the body's left.
// The engine turns a plan into a skinned mesh and animates it from the joint roles; nothing here knows
// about any particular world.
import type { CreatureFamily } from './spec';
import { makeRng } from './rng';
import type { Rng } from './rng';

export type V3 = [number, number, number];
export type Quat = [number, number, number, number];
export type SegmentShape = 'capsule' | 'box' | 'cone' | 'ellipsoid' | 'membrane' | 'fin';
/** body, accent and glow are the creature colours; the rest dress a person (they fall back to body/accent). */
export type BodyTone = 'body' | 'accent' | 'glow' | 'skin' | 'cloth' | 'cloth2' | 'trim' | 'hair' | 'dark';
export type GaitRole =
  | 'root' | 'spine' | 'neck' | 'head' | 'jaw' | 'tail' | 'hip' | 'knee' | 'foot'
  | 'shoulder' | 'elbow' | 'hand' | 'wing' | 'wing_mid' | 'wing_tip' | 'fin' | 'tentacle';
export type BodyPattern = 'plain' | 'stripes' | 'spots' | 'scales' | 'patches';

export interface BodyJoint {
  name: string;
  /** Index of the parent joint, -1 for the root. Parents always come first. */
  parent: number;
  /** Rest position relative to the parent joint (to the ground origin for the root), metres. */
  pos: V3;
  role: GaitRole;
  /** +1 left, -1 right, 0 on the midline. */
  side: -1 | 0 | 1;
  /** Position along its chain (spine, neck, tail, tentacle), 0 at the base. */
  chain: number;
}

export interface BodySegment {
  shape: SegmentShape;
  joint: number;
  /** Centre relative to the joint, and orientation. Capsules and cones run along local +Y. */
  pos: V3;
  quat: Quat;
  /** Full extents. Capsule: x and z are the base diameters, y the total length. Cone: base diameters and height. */
  size: V3;
  /** Capsule: top radius over base radius. */
  taper: number;
  tone: BodyTone;
  /** Brightness multiplier, below 1 toward the extremities. */
  shade: number;
  /** membrane and fin: a flat polygon (triangle fan from the first point), xyz triples relative to the joint. */
  pts?: number[];
}

export interface BodyLeg {
  hip: number; knee: number; foot: number;
  /** 0 is the front pair. */
  pair: number;
  side: -1 | 1;
  /** Upper and lower bone lengths, and the height of the ankle joint above the sole. */
  l1: number; l2: number; footR: number;
  /** Legs that reach sideways (lizards, spiders) step by swinging about the vertical axis. */
  splay: boolean;
}
export interface BodyArm { shoulder: number; elbow: number; hand: number; side: -1 | 1 }
export interface BodyWing { root: number; mid: number; tip: number; side: -1 | 1 }
export interface BodyChain { kind: 'spine' | 'neck' | 'tail' | 'tentacle'; joints: number[] }

export interface BodyMeta {
  height: number; length: number; width: number;
  /** Chin to crown of the head, and the height of the head joint at rest. */
  headHeight: number; eyeHeight: number;
  /** How far the body can sink before the belly meets the ground. */
  clearance: number;
  legLength: number;
  /** Comfortable and top ground speeds, m/s; cruise is the flying or swimming speed. */
  walkSpeed: number; runSpeed: number; cruise: number;
  wingspan: number;
  /** Preferred height of the body above the ground for things that hover. */
  hover: number;
  /** Swarm: how many units make one group. */
  units: number;
  /** Swimmers: 1 when the tail beats up and down. Serpents: 0..1 vertical humps. */
  fluke: number; humps: number;
  /** 0 walks .. 1 never moves its feet (statues, rooted giants). */
  still: number;
  pattern: BodyPattern;
  hasGlow: boolean;
}

export interface BodyPlan {
  family: CreatureFamily;
  size: number;
  joints: BodyJoint[];
  segments: BodySegment[];
  legs: BodyLeg[];
  arms: BodyArm[];
  wings: BodyWing[];
  chains: BodyChain[];
  /** Joint index of the head, or -1. */
  head: number;
  jaw: number;
  fins: number[];
  meta: BodyMeta;
}

export type BodyDials = Record<string, number | string>;
export type GaitKind = 'walk' | 'trot' | 'run';

export const CREATURE_FAMILIES: readonly CreatureFamily[] = [
  'quadruped', 'biped', 'winged', 'serpent', 'bird', 'swimmer', 'crawler', 'floater', 'colossus', 'swarm',
];

/** Fraction of the cycle each foot spends on the ground. */
export const GAIT_DUTY: Record<GaitKind, number> = { walk: 0.64, trot: 0.5, run: 0.36 };

/**
 * Phase offset of each foot in [0, 1), ordered front pair first, left before right: [L0, R0, L1, R1, ...].
 * walk: a wave from the back pair forward, left and right of a pair half a cycle apart; the offsets are
 * a permutation of k / legs, so they sum to (legs - 1) / 2. trot: alternating diagonals (two feet, the
 * tripod of six, the tetrapod of eight), offsets 0 or 0.5, summing to legs / 4. run: a bound, the pairs
 * landing in turn from the back with the two feet of a pair a tenth of a cycle apart.
 */
export function gaitPhases(legs: number, gait: GaitKind): number[] {
  const pairs = Math.max(1, Math.round(legs / 2));
  const n = pairs * 2;
  const out: number[] = [];
  for (let p = 0; p < pairs; p++) {
    if (gait === 'walk') {
      const l = (pairs - 1 - p) / n;
      out.push(l, l + 0.5);
    } else if (gait === 'trot') {
      out.push(p % 2 === 0 ? 0 : 0.5, p % 2 === 0 ? 0.5 : 0);
    } else if (pairs === 1) {
      out.push(0, 0.5);
    } else {
      const l = ((pairs - 1 - p) / pairs) * 0.5;
      out.push(l + 0.1, l);
    }
  }
  return out;
}

// ---- Small math -------------------------------------------------------------------------------------

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const L = (a: number, b: number, t: number): number => a + (b - a) * t;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mix = (a: V3, b: V3, t: number): V3 => [L(a[0], b[0], t), L(a[1], b[1], t), L(a[2], b[2], t)];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const IDENT: Quat = [0, 0, 0, 1];

/** Shortest rotation taking +Y onto the unit vector d. */
function quatFromY(d: V3): Quat {
  if (d[1] < -0.9999) return [1, 0, 0, 0];
  const w = 1 + d[1];
  const n = Math.hypot(d[2], d[0], w);
  return [d[2] / n, 0, -d[0] / n, w / n];
}

export function rotateByQuat(v: V3, q: Quat): V3 {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}

const OFF = new Set(['', 'none', 'no', 'false', 'off', '0']);

/** Proportions that differ a little from one individual to the next. Switch-like dials are left alone. */
const VARIED = new Set([
  'legs', 'body', 'neck', 'head', 'snout', 'ears', 'tail', 'tailw', 'bulk', 'slope', 'shoulders', 'hips', 'limbs', 'arms', 'posture',
  'wingspan', 'chord', 'girth', 'depth', 'pectoral', 'stance', 'wide', 'abdomen', 'length', 'beak', 'hair',
]);
const VARIATION = 0.045;

/** Reads the model's dials forgivingly: numbers are 0..1, strings may be numbers, words or option names. */
class Dials {
  private readonly features: Set<string>;
  /** With a seed, each shape dial drifts by a few percent, the same way every time for that seed. */
  constructor(private readonly d: BodyDials, private readonly seed: number | null = null) {
    const f = d['features'];
    this.features = new Set(typeof f === 'string' ? f.toLowerCase().split(/[^a-z_]+/).filter((s) => s.length > 0) : []);
  }
  raw(k: string): number | null {
    const x = this.d[k];
    if (typeof x === 'number') return Number.isFinite(x) ? x : null;
    if (typeof x === 'string') {
      const f = Number.parseFloat(x);
      return Number.isFinite(f) ? f : null;
    }
    return null;
  }
  n(k: string, def: number): number {
    const v = this.plain(k, def);
    // A dial at exactly 0 means "none of this" and stays there.
    if (this.seed === null || v <= 0 || !VARIED.has(k)) return v;
    return clamp(v + makeRng(this.seed, `vary|${k}`).range(-VARIATION, VARIATION), 0.01, 1);
  }
  private plain(k: string, def: number): number {
    const r = this.raw(k);
    if (r !== null) return clamp(r, 0, 1);
    const x = this.d[k];
    if (typeof x === 'string') return OFF.has(x.trim().toLowerCase()) ? 0 : 0.8;
    return def;
  }
  on(k: string, def = false): boolean {
    if (this.features.has(k)) return true;
    const x = this.d[k];
    if (typeof x === 'number') return x > 0.5;
    if (typeof x === 'string') return !OFF.has(x.trim().toLowerCase());
    return def;
  }
  /** An option by name. A bare "yes" (a number above 0.5, an unknown word) picks `yes` when given. */
  s<T extends string>(k: string, opts: readonly T[], def: T, yes?: T): T {
    const x = this.d[k];
    if (typeof x === 'string') {
      const w = x.trim().toLowerCase();
      const hit = opts.find((o) => o === w) ?? opts.find((o) => w.includes(o));
      if (hit !== undefined) return hit;
      if (yes !== undefined && !OFF.has(w)) return yes;
    }
    if (typeof x === 'number' && x > 0.5 && yes !== undefined) return yes;
    return def;
  }
  /** A count: values above 1 are taken literally, 0..1 spans the range. */
  count(k: string, lo: number, hi: number, def: number): number {
    const r = this.raw(k);
    if (r === null) return this.on(k) ? hi : def;
    return clamp(Math.round(r > 1 ? r : L(lo, hi, clamp(r, 0, 1))), lo, hi);
  }
}

// ---- Builder ----------------------------------------------------------------------------------------

/** Joints and segments are placed in absolute rest coordinates; finish() makes them relative and scales. */
class Rig {
  readonly joints: BodyJoint[] = [];
  readonly at: V3[] = [];
  readonly segs: BodySegment[] = [];
  readonly legs: { hip: number; knee: number; foot: number; pair: number; side: -1 | 1; footR: number }[] = [];
  readonly arms: BodyArm[] = [];
  readonly wings: BodyWing[] = [];
  readonly chains: BodyChain[] = [];
  head = -1;
  jaw = -1;
  headHeight = 0;
  clearance = 0;
  hover = 0;
  units = 1;
  fluke = 0;
  humps = 0;
  still = 0;
  pattern: BodyPattern = 'plain';

  joint(name: string, parent: number, at: V3, role: GaitRole, side: -1 | 0 | 1 = 0, chain = 0): number {
    this.joints.push({ name, parent, pos: at, role, side, chain });
    this.at.push(at);
    return this.joints.length - 1;
  }
  private rel(j: number, p: V3): V3 {
    return sub(p, this.at[j] ?? [0, 0, 0]);
  }
  /** Tapered capsule from a (radius ra) to b (radius rb); the radii reach the end points. */
  cap(j: number, a: V3, b: V3, ra: number, rb: number, tone: BodyTone = 'body', shade = 1, flat = 1): void {
    const d = sub(b, a);
    const l = Math.max(1e-5, len(d));
    const r0 = Math.max(1e-4, ra);
    this.segs.push({
      shape: 'capsule', joint: j, pos: this.rel(j, mix(a, b, 0.5)), quat: quatFromY([d[0] / l, d[1] / l, d[2] / l]),
      size: [r0 * 2, l + r0 + Math.max(1e-4, rb), r0 * 2 * flat], taper: Math.max(1e-4, rb) / r0, tone, shade,
    });
  }
  ell(j: number, c: V3, r: V3, tone: BodyTone = 'body', shade = 1): void {
    this.segs.push({ shape: 'ellipsoid', joint: j, pos: this.rel(j, c), quat: IDENT, size: [r[0] * 2, r[1] * 2, r[2] * 2], taper: 1, tone, shade });
  }
  box(j: number, c: V3, s: V3, tone: BodyTone = 'body', shade = 1): void {
    this.segs.push({ shape: 'box', joint: j, pos: this.rel(j, c), quat: IDENT, size: s, taper: 1, tone, shade });
  }
  cone(j: number, base: V3, tip: V3, r: number, tone: BodyTone = 'accent', shade = 1): void {
    const d = sub(tip, base);
    const l = Math.max(1e-5, len(d));
    this.segs.push({
      shape: 'cone', joint: j, pos: this.rel(j, mix(base, tip, 0.5)), quat: quatFromY([d[0] / l, d[1] / l, d[2] / l]),
      size: [r * 2, l, r * 2], taper: 0, tone, shade,
    });
  }
  /**
   * Hanging cloth: a cone with its point hidden up inside the body and a flat hem of half-widths rx, rz.
   * Unlike a capsule it ends in a clean edge instead of a rounded bulb.
   */
  skirt(j: number, tip: V3, hemY: number, rx: number, rz: number, tone: BodyTone, shade = 1): void {
    const l = Math.max(1e-4, tip[1] - hemY);
    this.segs.push({ shape: 'cone', joint: j, pos: this.rel(j, [tip[0], hemY + l / 2, tip[2]]), quat: IDENT, size: [rx * 2, l, rz * 2], taper: 0, tone, shade });
  }
  sheet(j: number, pts: V3[], tone: BodyTone = 'accent', shade = 1, shape: 'membrane' | 'fin' = 'membrane'): void {
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    const flat: number[] = [];
    for (const p of pts) {
      const r = this.rel(j, p);
      flat.push(r[0], r[1], r[2]);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k] as number, r[k] as number);
        hi[k] = Math.max(hi[k] as number, r[k] as number);
      }
    }
    this.segs.push({ shape, joint: j, pos: mix(lo, hi, 0.5), quat: IDENT, size: sub(hi, lo), taper: 1, tone, shade, pts: flat });
  }
  /** A chain of joints with a tapered capsule on each link. Returns the joint indices. */
  chain(kind: BodyChain['kind'], name: string, parent: number, pts: V3[], r0: number, r1: number, tone: BodyTone = 'body', shade0 = 1, shade1 = 1, side: -1 | 0 | 1 = 0): number[] {
    const ids: number[] = [];
    let p = parent;
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i] as V3;
      const b = pts[i + 1] as V3;
      const j = this.joint(`${name}${i}`, p, a, kind, side, i);
      this.cap(j, a, b, L(r0, r1, i / n), L(r0, r1, (i + 1) / n), tone, L(shade0, shade1, i / Math.max(1, n - 1)));
      ids.push(j);
      p = j;
    }
    this.chains.push({ kind, joints: ids });
    return ids;
  }
  /** Two-bone leg with a foot. r: radii at hip, knee, ankle. The ankle sits footR above the sole. */
  leg(name: string, parent: number, hip: V3, knee: V3, ankle: V3, r: V3, pair: number, side: -1 | 1, tones: [BodyTone, BodyTone, BodyTone] = ['body', 'body', 'dark'], toe = 1.2, shoeYaw: number | null = null): { hip: number; knee: number; foot: number } {
    const h = this.joint(`${name}_hip`, parent, hip, 'hip', side);
    const k = this.joint(`${name}_knee`, h, knee, 'knee', side);
    const f = this.joint(`${name}_foot`, k, ankle, 'foot', side);
    this.cap(h, hip, knee, r[0], r[1], tones[0], 0.96);
    // The shin's rounded top is a touch larger than the end of the thigh and swallows it, so the two
    // meet in one clean line at the knee instead of two skins lying on top of each other.
    this.cap(k, knee, ankle, r[1] * (tones[0] === tones[1] ? 1.07 : 1.12), r[2], tones[1], 0.86);
    const fr = ankle[1];
    if (toe > 0 && shoeYaw !== null) {
      // A person's foot: a rounded heel under the ankle and a lower, wider forefoot, both flat on the
      // ground and turned out by shoeYaw.
      const w = Math.max(r[2] * 1.15, fr * 0.6);
      const q: Quat = [0, Math.sin(shoeYaw / 2), 0, Math.cos(shoeYaw / 2)];
      const put = (off: V3, rad: V3, shade: number): void => {
        const c = add([ankle[0], 0, ankle[2]], rotateByQuat(off, q));
        this.segs.push({ shape: 'ellipsoid', joint: f, pos: this.rel(f, c), quat: q, size: [rad[0] * 2, rad[1] * 2, rad[2] * 2], taper: 1, tone: tones[2], shade });
      };
      put([0, fr * 0.62, -fr * 0.2], [w * 0.92, fr * 0.62, fr * 0.7], 0.7);
      put([0, fr * 0.42, fr * toe * 0.62], [w * 1.08, fr * 0.42, fr * toe * 0.72], 0.74);
    } else if (toe > 0) this.ell(f, [ankle[0], fr * 0.52, ankle[2] + fr * toe * 0.45], [Math.max(r[2] * 1.15, fr * 0.6), fr * 0.5, fr * toe], tones[2], 0.7);
    this.legs.push({ hip: h, knee: k, foot: f, pair, side, footR: fr });
    return { hip: h, knee: k, foot: f };
  }

  bounds(): { lo: V3; hi: V3 } {
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const s of this.segs) {
      const o = add(this.at[s.joint] ?? [0, 0, 0], s.pos);
      const h: V3 = [s.size[0] / 2, s.size[1] / 2, s.size[2] / 2];
      for (let c = 0; c < 8; c++) {
        const p = rotateByQuat([c & 1 ? h[0] : -h[0], c & 2 ? h[1] : -h[1], c & 4 ? h[2] : -h[2]], s.quat);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k] as number, (o[k] as number) + (p[k] as number));
          hi[k] = Math.max(hi[k] as number, (o[k] as number) + (p[k] as number));
        }
      }
    }
    return { lo, hi };
  }

  finish(family: CreatureFamily, size: number, measure: 'height' | 'length' | 'max'): BodyPlan {
    const b0 = this.bounds();
    const h0 = b0.hi[1] - b0.lo[1];
    const l0 = b0.hi[2] - b0.lo[2];
    const principal = measure === 'height' ? h0 : measure === 'length' ? l0 : Math.max(h0, l0);
    const k = clamp(size, 0.05, 60) / Math.max(1e-4, principal);
    // Legged bodies stand on their soles; everything else rests its lowest point on the ground.
    let floor = b0.lo[1];
    if (this.legs.length > 0) {
      floor = Infinity;
      for (const l of this.legs) floor = Math.min(floor, (this.at[l.foot] as V3)[1] - l.footR);
    }
    const abs = this.at.map((p): V3 => [p[0] * k, (p[1] - floor) * k, p[2] * k]);
    const joints = this.joints.map((j, i): BodyJoint => {
      const a = abs[i] as V3;
      return { ...j, pos: j.parent < 0 ? a : sub(a, abs[j.parent] as V3) };
    });
    const segments = this.segs.map((s): BodySegment => ({
      ...s,
      pos: [s.pos[0] * k, s.pos[1] * k, s.pos[2] * k],
      size: [s.size[0] * k, s.size[1] * k, s.size[2] * k],
      ...(s.pts !== undefined ? { pts: s.pts.map((x) => x * k) } : {}),
    }));
    const legs = this.legs.map((l): BodyLeg => {
      const hip = abs[l.hip] as V3;
      const knee = abs[l.knee] as V3;
      const foot = abs[l.foot] as V3;
      const l1 = len(sub(knee, hip));
      const l2 = len(sub(foot, knee));
      return { ...l, footR: l.footR * k, l1, l2, splay: Math.hypot(foot[0] - hip[0], foot[2] - hip[2]) > 0.35 * (l1 + l2) };
    });
    let legLength = 0;
    for (const l of legs) legLength += (abs[l.hip] as V3)[1] / legs.length;
    const wingspan = this.wings.length > 0 ? (b0.hi[0] - b0.lo[0]) * k : 0;
    const g = 9.81;
    const head = this.head >= 0 ? (abs[this.head] as V3)[1] : (b0.hi[1] - floor) * k * 0.8;
    const meta: BodyMeta = {
      height: (b0.hi[1] - floor) * k, length: l0 * k, width: (b0.hi[0] - b0.lo[0]) * k,
      headHeight: this.headHeight * k, eyeHeight: head,
      clearance: this.clearance * k, legLength,
      walkSpeed: legLength > 0 ? 0.5 * Math.sqrt(g * legLength) : 0.25 * Math.sqrt(g * l0 * k),
      runSpeed: legLength > 0 ? 1.5 * Math.sqrt(g * legLength) : 0.6 * Math.sqrt(g * l0 * k),
      cruise: clamp(4.2 * Math.sqrt(Math.max(wingspan, l0 * k)), 1.2, 17),
      wingspan, hover: this.hover * k, units: this.units, fluke: this.fluke, humps: this.humps, still: this.still,
      pattern: this.pattern, hasGlow: segments.some((s) => s.tone === 'glow'),
    };
    return { family, size, joints, segments, legs, arms: this.arms, wings: this.wings, chains: this.chains, head: this.head, jaw: this.jaw, fins: joints.flatMap((j, i) => (j.role === 'fin' ? [i] : [])), meta };
  }
}

const SIDES: readonly (-1 | 1)[] = [1, -1];
const PATTERNS: readonly BodyPattern[] = ['plain', 'stripes', 'spots', 'scales', 'patches'];

/** Skull, muzzle, jaw, eyes, ears and headgear shared by the four-legged and winged plans. */
function beastHead(g: Rig, d: Dials, parent: number, at: V3, hr: number, o: { snout: number; ears: number; beak?: boolean }): number {
  const h = g.joint('head', parent, at, 'head');
  g.head = h;
  const c: V3 = add(at, [0, hr * 0.15, hr * 0.55]);
  g.ell(h, c, [hr * 0.86, hr * 0.88, hr * 1.12]);
  const sl = hr * L(0.45, 2.7, o.snout);
  const m0: V3 = add(c, [0, -hr * 0.2, hr * 0.7]);
  const m1: V3 = add(m0, [0, -hr * 0.22, sl]);
  const jaw = g.joint('jaw', h, add(c, [0, -hr * 0.5, hr * 0.35]), 'jaw');
  g.jaw = jaw;
  if (o.beak === true) {
    g.cone(h, add(c, [0, -hr * 0.05, hr * 0.8]), add(c, [0, -hr * 0.3, hr * 0.8 + sl * 1.3]), hr * 0.42, 'accent', 0.9);
    g.cone(jaw, add(c, [0, -hr * 0.3, hr * 0.7]), add(c, [0, -hr * 0.38, hr * 0.7 + sl * 1.1]), hr * 0.3, 'accent', 0.75);
  } else {
    g.cap(h, m0, m1, hr * 0.62, hr * 0.4, 'body', 0.97);
    g.cap(jaw, add(c, [0, -hr * 0.5, hr * 0.45]), add(m1, [0, -hr * 0.28, -sl * 0.08]), hr * 0.36, hr * 0.24, 'body', 0.85);
    g.ell(h, add(m1, [0, hr * 0.08, hr * 0.3]), [hr * 0.2, hr * 0.15, hr * 0.14], 'dark', 0.6);
  }
  const glowEyes = d.on('glow_eyes') || d.on('glow');
  for (const s of SIDES) {
    g.ell(h, add(c, [s * hr * 0.66, hr * 0.28, hr * 0.62]), [hr * 0.13, hr * 0.14, hr * 0.17], glowEyes ? 'glow' : 'dark', 0.5);
    if (o.ears > 0.02) {
      const el = hr * L(0.35, 2, o.ears);
      g.sheet(h, [add(c, [s * hr * 0.4, hr * 0.72, hr * 0.15]), add(c, [s * hr * 0.78, hr * 0.5, -hr * 0.2]), add(c, [s * (hr * 0.7 + el * 0.35), hr * 0.7 + el, -hr * 0.25])], 'body', 0.82, 'fin');
    }
  }
  const horns = d.s('horns', ['none', 'horns', 'antlers', 'tusks', 'horn', 'crown'] as const, 'none', 'horns');
  for (const s of SIDES) {
    const b: V3 = add(c, [s * hr * 0.45, hr * 0.75, -hr * 0.1]);
    if (horns === 'horns' || horns === 'crown') {
      const k: V3 = add(b, [s * hr * 0.55, hr * 0.9, -hr * 0.5]);
      g.cap(h, b, k, hr * 0.2, hr * 0.13, 'accent', 0.9);
      g.cone(h, k, add(k, [s * hr * 0.1, hr * 0.9, hr * 0.35]), hr * 0.13, 'accent', 0.8);
      if (horns === 'crown') {
        g.cone(h, add(c, [s * hr * 0.75, hr * 0.3, -hr * 0.5]), add(c, [s * hr * 1.5, hr * 0.7, -hr * 1.5]), hr * 0.16, 'accent', 0.85);
        g.cone(h, add(c, [s * hr * 0.2, hr * 0.8, -hr * 0.5]), add(c, [s * hr * 0.3, hr * 1.5, -hr * 1.4]), hr * 0.14, 'accent', 0.85);
      }
    } else if (horns === 'antlers') {
      const k: V3 = add(b, [s * hr * 0.9, hr * 1.5, -hr * 0.3]);
      g.cap(h, b, k, hr * 0.12, hr * 0.09, 'accent', 0.9);
      g.cone(h, k, add(k, [s * hr * 0.7, hr * 1.1, hr * 0.2]), hr * 0.09, 'accent', 0.85);
      g.cone(h, k, add(k, [-s * hr * 0.1, hr * 1.2, -hr * 0.5]), hr * 0.08, 'accent', 0.85);
      g.cone(h, mix(b, k, 0.5), add(mix(b, k, 0.5), [s * hr * 0.2, hr * 0.5, hr * 0.9]), hr * 0.08, 'accent', 0.85);
    } else if (horns === 'tusks') {
      const t0: V3 = add(m0, [s * hr * 0.45, -hr * 0.3, sl * 0.5]);
      g.cone(h, t0, add(t0, [s * hr * 0.35, -hr * 0.5, hr * 1.5]), hr * 0.16, 'accent', 1.05);
    }
  }
  if (horns === 'horn') g.cone(h, add(m1, [0, hr * 0.2, -sl * 0.25]), add(m1, [0, hr * 1.5, hr * 0.2]), hr * 0.24, 'accent', 0.9);
  if (d.on('frill')) {
    for (const s of SIDES) g.sheet(h, [add(c, [0, hr * 0.3, -hr * 0.6]), add(c, [0, hr * 2.0, -hr * 1.3]), add(c, [s * hr * 1.7, hr * 1.2, -hr * 1.2]), add(c, [s * hr * 1.5, -hr * 0.2, -hr * 0.9])], 'accent', 0.9);
  }
  g.headHeight = hr * 1.8;
  return h;
}

// ---- Families ---------------------------------------------------------------------------------------

function quadruped(d: Dials, g: Rig): void {
  const legs = d.n('legs', 0.5), body = d.n('body', 0.5), neck = d.n('neck', 0.35), bulk = d.n('bulk', 0.45);
  const slope = d.n('slope', 0.5), sprawl = d.n('sprawl', 0), tail = d.n('tail', 0.5);
  const R = L(0.15, 0.46, bulk);
  const span = L(0.75, 1.9, body) + R;
  const legV = L(0.2, 1.6, legs) * (1 - 0.5 * sprawl);
  const fr = R * 0.3;
  const hf = legV * (1 + 0.3 * (slope - 0.5)), hh = legV * (1 - 0.3 * (slope - 0.5));
  const zf = span / 2, zh = -span / 2;
  const pf: V3 = [0, fr + hf + R * 0.35, zf], ph: V3 = [0, fr + hh + R * 0.35, zh];
  const mid = mix(ph, pf, 0.5);
  const root = g.joint('pelvis', -1, ph, 'root');
  const chest = g.joint('chest', root, mid, 'spine');
  g.chains.push({ kind: 'spine', joints: [chest] });
  // Drawn in a little at the loin, so the ribcage and the rump read as two masses.
  g.cap(root, ph, mid, R * 0.95, R * 0.82);
  g.cap(chest, mid, pf, R * 0.82, R * 1.02);
  g.ell(chest, add(pf, [0, -R * 0.12, 0]), [R * 0.96, R * 1.14, R * 1.02]);
  g.ell(root, ph, [R * 0.98, R, R * 1.02]);
  g.clearance = Math.min(pf[1], ph[1]) - R * 1.05;

  const up = L(0.3, 1.2, clamp(neck * 0.7 + (slope - 0.3) * 0.5, 0, 1));
  const nl = L(0.25, 2.3, neck * neck) + R * 0.5;
  const nn = neck > 0.6 ? 3 : 2;
  const n0: V3 = add(pf, [0, R * 0.4, R * 0.55]);
  const hr = L(0.09, 0.25, d.n('head', 0.5)) + R * 0.16;
  const npts: V3[] = [];
  for (let i = 0; i <= nn; i++) npts.push(add(n0, [0, Math.sin(up) * nl * (i / nn), Math.cos(up) * nl * (i / nn)]));
  const nk = g.chain('neck', 'neck', chest, npts, R * 0.66, hr * 0.8);
  beastHead(g, d, nk[nk.length - 1] ?? chest, npts[nn] as V3, hr, { snout: d.n('snout', 0.5), ears: d.n('ears', 0.45) });
  if (d.on('mane')) {
    for (let i = 0; i < nn; i++) g.ell(nk[i] ?? chest, add(mix(npts[i] as V3, npts[i + 1] as V3, 0.5), [0, R * 0.45, -R * 0.25]), [R * 0.3, R * 0.5, nl / nn * 0.62], 'hair', 0.8);
  }
  if (d.on('plates')) {
    for (let i = 0; i < 6; i++) {
      const p = add(mix(ph, pf, i / 5), [0, R * 0.95, 0]);
      const s = R * (0.5 + 0.5 * Math.sin((i + 0.5) / 6 * Math.PI));
      g.sheet(i < 3 ? root : chest, [add(p, [0, 0, s * 0.6]), add(p, [0, s * 1.5, 0]), add(p, [0, 0, -s * 0.6])], 'accent', 0.9, 'fin');
    }
  }
  if (d.on('hump')) g.ell(chest, add(pf, [0, R * 0.8, -R * 0.6]), [R * 0.7, R * 0.7, R * 0.9]);

  const tl = L(0.05, 2.2, tail) * span * 0.7;
  if (tl > 0.08) {
    const tw = R * L(0.14, 0.62, d.n('tailw', sprawl > 0.5 ? 0.8 : 0.25));
    const t0: V3 = add(ph, [0, R * 0.3, -R * 0.8]);
    const pts: V3[] = [];
    for (let i = 0; i <= 4; i++) pts.push([0, Math.max(tw * 0.6, t0[1] - Math.sin(0.55) * tl * (i / 4) * (1 - 0.12 * i)), t0[2] - Math.cos(0.45) * tl * (i / 4)]);
    g.chain('tail', 'tail', root, pts, tw, tw * 0.2, 'body', 0.95, 0.8);
  }

  const hx = R * (0.55 + 0.5 * sprawl);
  for (let p = 0; p < 2; p++) {
    const H = p === 0 ? hf : hh;
    const z = p === 0 ? zf - R * 0.15 : zh + R * 0.15;
    const r: V3 = [Math.max(R * (p === 0 ? 0.36 : 0.5), H * 0.07), Math.max(R * 0.25, H * 0.055), Math.max(R * 0.16, H * 0.04)];
    for (const s of SIDES) {
      const hip: V3 = [s * hx, fr + H, z];
      const lat = sprawl > 0.5;
      const ankle: V3 = lat ? [s * (hx + H * 1.5 * sprawl), fr, z + H * 0.1] : [s * hx, fr, z - (p === 1 ? H * 0.1 : 0)];
      const knee: V3 = lat ? [s * (hx + H * 0.8 * sprawl), fr + H * 1.05, z] : add(mix(hip, ankle, 0.5), [0, 0, (p === 0 ? -1 : 1) * H * 0.14]);
      const made = g.leg(`leg${p}${s > 0 ? 'l' : 'r'}`, p === 0 ? chest : root, hip, knee, ankle, r, p, s);
      // Shoulder and haunch: the muscle that joins a leg to the trunk, carried by the leg so it works in the walk.
      if (!lat) g.ell(made.hip, add(hip, [-s * R * 0.08, -H * 0.06, p === 0 ? 0 : R * 0.1]), [r[0] * (p === 0 ? 1.55 : 1.2), Math.min(H * 0.3, R * 0.95), r[0] * (p === 0 ? 1.5 : 1.8)], 'body', 0.98);
    }
  }
  g.pattern = d.s('pattern', PATTERNS, sprawl > 0.5 ? 'scales' : 'plain');
}

type Outfit = 'bare' | 'tunic' | 'coat' | 'robe' | 'armor' | 'suit' | 'work';

function biped(d: Dials, g: Rig, rng: Rng, giant = false): void {
  const bulk = d.n('bulk', giant ? 0.85 : 0.4), sh = d.n('shoulders', giant ? 0.8 : 0.5), hp = d.n('hips', 0.5);
  const limb = d.n('limbs', 0.5), post = d.n('posture', giant ? 0.4 : 0.12);
  const hd = d.n('head', giant ? 0.2 : 0.5);
  const hs = d.raw('head_scale') ?? (hd < 0.5 ? L(0.55, 1, hd * 2) : L(1, 1.9, (hd - 0.5) * 2));
  const as = L(0.8, 1.2, d.n('arms', giant ? 0.85 : 0.5));
  const outfit = d.s('outfit', ['bare', 'tunic', 'coat', 'robe', 'armor', 'suit', 'work'] as const, 'bare') as Outfit;
  const bare = outfit === 'bare';
  const skin: BodyTone = bare ? 'body' : 'skin';
  const top: BodyTone = bare ? 'body' : 'cloth';
  const low: BodyTone = bare ? 'body' : outfit === 'suit' ? 'cloth' : 'cloth2';
  const fat = outfit === 'suit' ? 1.3 : 1;
  // Cloth that hangs below the waist covers the hips, and a long coat or robe covers the thighs too.
  const skirted = outfit === 'tunic' || outfit === 'work' || outfit === 'armor' || outfit === 'coat' || outfit === 'robe';
  const long = outfit === 'coat' || outfit === 'robe';
  // An unclothed body with a visor or an aerial is a machine: it gets dark joints and a chest panel.
  const machine = bare && (d.on('visor') || d.on('antenna'));
  // What sets one person apart from the next: which shoulder rides higher, how far each arm hangs from
  // the body, the turn of the feet, the waistline, how the hair is worn and what is at the neck.
  const tilt = rng.range(-0.006, 0.006);
  const hang: [number, number] = [rng.range(0, 0.012), rng.range(0, 0.012)];
  const toeOut = rng.range(0.1, 0.24);
  const belly = rng.range(0, 0.1);
  const style = rng.int(0, 3);
  const whiskers = rng.chance(0.22), scarf = rng.chance(0.35), boots = rng.chance(0.6);

  const hipY = L(0.47, 0.59, limb);
  const headH = 0.1333 * clamp(hs, 0.4, 2.2);
  const trunk = 1 - hipY - headH;
  // Posture leans everything above the hips forward and down a little.
  const P = (x: number, y: number, z = 0): V3 => [x, y - (y - hipY) * post * post * 0.14, z + (y - hipY) * post * 0.55];
  const sw = L(0.084, 0.14, sh) * (0.9 + bulk * 0.25);
  const hw = L(0.04, 0.066, hp);
  const shY = hipY + trunk * 0.86, nkY = hipY + trunk * 0.93, chinY = 1 - headH;

  const root = g.joint('pelvis', -1, [0, hipY + 0.03, 0], 'root');
  const spine = g.joint('spine', root, P(0, hipY + trunk * 0.3), 'spine', 0, 0);
  const chest = g.joint('chest', spine, P(0, hipY + trunk * 0.6), 'spine', 0, 1);
  g.chains.push({ kind: 'spine', joints: [spine, chest] });
  const neck = g.joint('neck', chest, P(0, nkY), 'neck');
  g.chains.push({ kind: 'neck', joints: [neck] });
  const head = g.joint('head', neck, P(0, chinY + headH * 0.12, 0.005), 'head');
  g.head = head;
  g.headHeight = headH;
  g.clearance = hipY * 0.8;

  const wr = (0.058 + bulk * 0.055) * (1 + belly);
  g.ell(root, [0, hipY + 0.035, 0], [(hw + 0.052 + bulk * 0.035) * (skirted ? 0.9 : 1), 0.078, 0.062 + bulk * 0.05], skirted ? top : low);
  g.cap(spine, P(0, hipY + 0.07), P(0, hipY + trunk * 0.55), wr * 1.02, wr * 1.08, top, 1, 0.74);
  g.ell(chest, P(0, hipY + trunk * 0.68, 0.006), [sw - 0.012, trunk * 0.25, 0.06 + bulk * 0.058], top);
  // Shoulders slope from the base of the neck down to the arm rather than running straight across.
  const yoke = 0.036 + bulk * 0.022;
  for (const s of SIDES) g.cap(chest, P(s * 0.02, nkY - 0.014), P(s * (sw - 0.016), shY - 0.008 + s * tilt), yoke * 1.1, yoke * 0.82, top, 1, 0.92);
  g.cap(neck, P(0, nkY - 0.012), P(0, chinY + 0.014, 0.004), 0.029 + bulk * 0.014, 0.026 + bulk * 0.01, skin);
  if (!bare && outfit !== 'suit' && outfit !== 'armor') {
    // A collar where cloth meets the neck, and on some a neckerchief.
    g.ell(chest, P(0, nkY - 0.006, 0.002), [0.043 + bulk * 0.016, 0.015, 0.041 + bulk * 0.016], top, 0.82);
    if (scarf && !d.on('hood')) {
      g.ell(chest, P(0, nkY - 0.012, 0.006), [0.05 + bulk * 0.016, 0.02, 0.05 + bulk * 0.016], 'cloth2', 1);
      g.ell(chest, P(0, nkY - 0.034, 0.05 + bulk * 0.03), [0.016, 0.024, 0.012], 'cloth2', 0.9);
    }
  }

  // Head: skull, jaw line, nose, eyes, ears.
  const hc = P(0, 1 - headH / 2, 0.008);
  const hwid = 0.0425 * hs, hdep = 0.054 * hs;
  g.ell(head, add(hc, [0, headH * 0.06, 0]), [hwid, headH * 0.44, hdep], skin);
  g.ell(head, add(hc, [0, -headH * 0.22, hdep * 0.2]), [hwid * 0.8, headH * 0.27, hdep * 0.74], skin);
  const eyes: BodyTone = d.on('glow_eyes') ? 'glow' : 'dark';
  if (!d.on('visor') && outfit !== 'suit') {
    if (d.on('snout')) {
      g.cap(head, add(hc, [0, -headH * 0.1, hdep * 0.6]), add(hc, [0, -headH * 0.18, hdep * 1.9]), hwid * 0.6, hwid * 0.4, skin, 0.95);
      g.ell(head, add(hc, [0, -headH * 0.14, hdep * 2.2]), [hwid * 0.2, hwid * 0.16, hwid * 0.14], 'dark', 0.6);
    } else if (!d.on('mask')) {
      g.ell(head, add(hc, [0, -headH * 0.07, hdep * 0.98]), [hwid * 0.17, headH * 0.1, hdep * 0.17], skin, 0.94);
    }
    for (const s of SIDES) g.ell(head, add(hc, [s * hwid * 0.42, headH * 0.06, hdep * 0.86]), [hwid * 0.16, headH * 0.045, hwid * 0.1], eyes, 0.45);
  }
  for (const s of SIDES) {
    if (d.on('long_ears')) g.sheet(head, [add(hc, [s * hwid * 0.9, headH * 0.08, 0]), add(hc, [s * hwid * 0.95, -headH * 0.1, -hdep * 0.1]), add(hc, [s * hwid * 2.3, headH * 0.42, -hdep * 0.7])], skin, 0.9, 'fin');
    else if (outfit !== 'suit') g.ell(head, add(hc, [s * hwid, 0, -hdep * 0.05]), [hwid * 0.14, headH * 0.11, hdep * 0.2], skin, 0.92);
    if (d.on('horns')) g.cone(head, add(hc, [s * hwid * 0.6, headH * 0.36, hdep * 0.2]), add(hc, [s * hwid * 1.3, headH * 0.95, -hdep * 0.2]), hwid * 0.22, 'accent', 0.9);
  }
  const hair = d.n('hair', bare ? 0 : 0.5);
  const hat = d.on('hat') ? d.s('hat', ['brim', 'cap', 'cone', 'helm'] as const, 'brim') : null;
  const helmet = outfit === 'suit' || hat === 'helm';
  if (helmet) {
    const k = outfit === 'suit' ? 1.42 : 1.14;
    g.ell(head, add(hc, [0, headH * 0.08, -hdep * 0.04]), [hwid * k * 1.12, headH * 0.5 * k, hdep * k], 'trim');
    if (outfit === 'suit') g.ell(head, add(hc, [0, headH * 0.04, hdep * 0.62]), [hwid * 1.2, headH * 0.4, hdep * 0.9], d.on('glow_eyes') ? 'glow' : 'dark', 0.5);
  } else if (d.on('hood')) {
    g.ell(head, add(hc, [0, headH * 0.1, -hdep * 0.22]), [hwid * 1.3, headH * 0.6, hdep * 1.22], 'cloth', 0.9);
    g.cap(chest, P(0, nkY + 0.01, -0.03), P(0, shY - 0.06, -0.06), 0.06, 0.075, 'cloth', 0.9, 0.6);
  } else if (hair > 0.05) {
    g.ell(head, add(hc, [0, headH * 0.16, -hdep * 0.16]), [hwid * 1.06, headH * 0.4, hdep * 1.02], 'hair', 0.9);
    if (hair > 0.7) g.cap(head, add(hc, [0, 0, -hdep * 0.6]), P(0, shY - 0.03, -0.045), hwid * 0.9, hwid * 0.75, 'hair', 0.85, 0.55);
    if (hat === null) {
      // The same hair worn four ways: cropped, with a fringe, tied up behind, or swept to one side.
      const side = tilt > 0 ? 1 : -1;
      if (style === 1) g.ell(head, add(hc, [0, headH * 0.3, hdep * 0.5]), [hwid * 0.92, headH * 0.13, hdep * 0.5], 'hair', 0.86);
      else if (style === 2) g.ell(head, add(hc, [0, headH * 0.34, -hdep * 1.1]), [hwid * 0.5, headH * 0.2, hdep * 0.42], 'hair', 0.82);
      else if (style === 3) g.ell(head, add(hc, [side * hwid * 0.3, headH * 0.34, hdep * 0.1]), [hwid * 0.82, headH * 0.16, hdep * 0.9], 'hair', 0.86);
    }
  }
  if (!bare && !helmet && hair > 0.3 && !d.on('mask') && !d.on('visor') && !d.on('snout') && d.on('beard', whiskers)) {
    g.ell(head, add(hc, [0, -headH * 0.36, hdep * 0.4]), [hwid * 0.72, headH * 0.2, hdep * 0.6], 'hair', 0.84);
  }
  if (hat === 'brim') {
    g.ell(head, add(hc, [0, headH * 0.34, 0]), [hwid * 2.5, headH * 0.05, hdep * 2.3], 'trim', 0.85);
    g.ell(head, add(hc, [0, headH * 0.5, 0]), [hwid * 1.12, headH * 0.26, hdep * 1.06], 'trim', 0.9);
  } else if (hat === 'cap') {
    g.ell(head, add(hc, [0, headH * 0.3, -hdep * 0.05]), [hwid * 1.1, headH * 0.3, hdep * 1.1], 'trim', 0.9);
    g.ell(head, add(hc, [0, headH * 0.26, hdep * 1.05]), [hwid * 0.9, headH * 0.03, hdep * 0.5], 'trim', 0.8);
  } else if (hat === 'cone') {
    g.cone(head, add(hc, [0, headH * 0.24, 0]), add(hc, [0, headH * 0.95, -hdep * 0.1]), hwid * 2.3, 'trim', 0.9);
  }
  if (d.on('visor')) g.box(head, add(hc, [0, headH * 0.06, hdep * 0.8]), [hwid * 1.9, headH * 0.2, hdep * 0.5], d.on('glow_eyes') ? 'glow' : 'dark', 0.6);
  if (d.on('mask')) g.ell(head, add(hc, [0, -headH * 0.08, hdep * 0.55]), [hwid * 0.9, headH * 0.36, hdep * 0.62], 'trim', 0.95);
  if (d.on('antenna')) {
    const a0 = add(hc, [hwid * 0.6, headH * 0.4, -hdep * 0.2]);
    g.cap(head, a0, add(a0, [hwid * 0.3, headH * 0.9, -hdep * 0.3]), 0.004, 0.003, 'dark');
    g.ell(head, add(a0, [hwid * 0.3, headH * 0.92, -hdep * 0.3]), [0.009, 0.009, 0.009], 'glow');
  }

  // Arms.
  const ua = (0.025 + bulk * 0.028) * fat, fa = (0.0215 + bulk * 0.02) * fat;
  const sleeve: BodyTone = outfit === 'tunic' || outfit === 'work' ? skin : top;
  for (const s of SIDES) {
    const out = hang[s > 0 ? 0 : 1];
    const sp = P(s * sw, shY + s * tilt);
    const ep = add(sp, [s * (0.014 + out), -0.172 * as, -0.006]);
    const wp = add(ep, [s * (0.004 + out * 0.6), -0.15 * as, 0.012]);
    const sj = g.joint(`shoulder_${s > 0 ? 'l' : 'r'}`, chest, sp, 'shoulder', s);
    const ej = g.joint(`elbow_${s > 0 ? 'l' : 'r'}`, sj, ep, 'elbow', s);
    const hj = g.joint(`hand_${s > 0 ? 'l' : 'r'}`, ej, wp, 'hand', s);
    g.arms.push({ shoulder: sj, elbow: ej, hand: hj, side: s });
    g.cap(sj, sp, ep, ua * 1.06, ua * 0.92, top);
    g.cap(ej, ep, wp, outfit === 'robe' ? fa * 1.5 : fa, outfit === 'robe' ? fa * 1.9 : fa * 0.78, sleeve, 0.97);
    // A short sleeve ends in a hem above the bare forearm.
    if (outfit === 'tunic' || outfit === 'work') g.ell(sj, add(ep, [0, 0.012, 0]), [ua * 1.04, 0.014, ua * 1.04], top, 0.84);
    if (machine) g.ell(ej, ep, [ua * 1.05, ua * 1.05, ua * 1.05], 'dark', 0.7);
    g.ell(hj, add(wp, [0, -0.048 * as, 0.004]), [0.017 * fat + bulk * 0.008, 0.05 * as, 0.027 * fat + bulk * 0.008], outfit === 'suit' ? 'trim' : skin, 0.94);
    // A thumb set forward of the palm gives the hand a front and a back.
    const tb = add(wp, [-s * 0.004, -0.022 * as, 0.022 * fat]);
    g.cap(hj, tb, add(tb, [-s * 0.006, -0.036 * as, 0.014]), (0.0085 + bulk * 0.003) * fat, (0.007 + bulk * 0.002) * fat, outfit === 'suit' ? 'trim' : skin, 0.9);
    if (outfit === 'coat' || outfit === 'suit') g.ell(ej, add(wp, [0, 0.006, 0]), [fa * 0.98, 0.013, fa * 0.98], outfit === 'suit' ? 'trim' : 'cloth2', 0.85);
    if (outfit === 'armor' || d.on('armor')) {
      g.ell(sj, add(sp, [s * 0.012, 0.012, 0]), [ua * 1.65, ua * 1.3, ua * 1.75], 'trim', 0.95);
      g.cap(ej, add(ep, [0, -0.03, 0]), add(wp, [0, 0.02, 0]), fa * 1.25, fa * 1.05, 'trim', 0.9);
    }
    if (d.on('wings')) {
      const w0 = P(s * 0.035, shY - 0.03, -0.07);
      const w1 = add(w0, [s * 0.16, 0.2, -0.1]);
      const w2 = add(w1, [s * 0.1, -0.42, -0.06]);
      const a = g.joint(`wing_${s > 0 ? 'l' : 'r'}`, chest, w0, 'wing', s);
      const b = g.joint(`wingmid_${s > 0 ? 'l' : 'r'}`, a, w1, 'wing_mid', s);
      const c = g.joint(`wingtip_${s > 0 ? 'l' : 'r'}`, b, w2, 'wing_tip', s);
      g.cap(a, w0, w1, 0.012, 0.009, 'body');
      g.cap(b, w1, w2, 0.009, 0.004, 'body');
      g.sheet(b, [w1, w2, add(w0, [s * 0.03, -0.3, -0.04]), w0], 'accent', 0.9);
    }
  }

  // Legs and feet.
  const th = (0.046 + bulk * 0.036) * fat, kn = (0.033 + bulk * 0.022) * fat, an = (0.023 + bulk * 0.014) * fat;
  const kneeY = hipY * 0.535, ankY = 0.045;
  for (const s of SIDES) {
    const armoured = outfit === 'armor' || d.on('armor');
    const knee: V3 = [s * hw * 0.98, kneeY, 0.014], ankle: V3 = [s * hw * 0.94, ankY, -0.012];
    const made = g.leg(`leg_${s > 0 ? 'l' : 'r'}`, root, [s * hw, hipY, 0], knee, ankle, [th, kn, an], 0, s, [long ? top : low, armoured ? 'trim' : low, bare ? 'body' : 'dark'], 1.75, s * toeOut);
    if (machine) g.ell(made.knee, knee, [kn * 1.14, kn * 1.14, kn * 1.14], 'dark', 0.7);
    // Boots come up over the trouser leg on some; the rest wear shoes.
    if (boots && !bare && !armoured && outfit !== 'robe' && outfit !== 'suit') g.cap(made.knee, ankle, mix(ankle, knee, 0.42), an + 0.007, L(an, kn, 0.42) + 0.007, 'dark', 0.76);
  }

  // Clothing shells and gear. Hems are cut wide enough to clear the thighs all the way up.
  const hemR = hw + th + 0.03;
  if (outfit === 'tunic' || outfit === 'work' || outfit === 'armor') {
    g.skirt(root, [0, hipY + 0.33, 0], hipY - 0.085, hemR + 0.01, (hemR + 0.01) * 0.7, top, 0.96);
    g.ell(spine, P(0, hipY + 0.085), [wr * 1.14, 0.018, wr * 0.9], 'trim', 0.8);
    g.box(spine, P(0, hipY + 0.085, wr * 0.9), [0.03, 0.026, 0.012], 'trim', 1.15);
  }
  if (machine) {
    g.box(chest, P(0, hipY + trunk * 0.68, 0.058 + bulk * 0.058), [sw * 0.9, trunk * 0.2, 0.03], 'accent', 0.9);
    g.ell(spine, P(0, hipY + 0.085), [wr * 1.1, 0.016, wr * 0.86], 'dark', 0.7);
  }
  if (outfit === 'coat') g.skirt(root, [0, hipY + 0.33, 0], kneeY - 0.012, hemR + 0.012, (hemR + 0.012) * 0.72, top, 0.95);
  if (outfit === 'robe') {
    g.skirt(root, [0, hipY + 0.29, 0], ankY + 0.05, hemR + 0.045, (hemR + 0.045) * 0.84, top, 0.94);
    g.ell(spine, P(0, hipY + 0.085), [wr * 1.12, 0.014, wr * 0.88], 'trim', 0.85);
  }
  if (outfit === 'work') {
    // An apron from the chest to the hem, leaning out to lie on the front of the tunic.
    const y1 = hipY + 0.17, y0 = hipY - 0.08, z1 = wr * 0.8, z0 = hemR * 0.7 + 0.004;
    const a = Math.atan2(z0 - z1, y1 - y0);
    g.segs.push({ shape: 'box', joint: spine, pos: sub([0, (y0 + y1) / 2, (z0 + z1) / 2], g.at[spine] as V3), quat: [Math.sin(-a / 2), 0, 0, Math.cos(a / 2)], size: [wr * 1.5, Math.hypot(y1 - y0, z0 - z1), 0.012], taper: 1, tone: 'trim', shade: 0.85 });
  }
  if (outfit === 'armor' || d.on('armor')) g.ell(chest, P(0, hipY + trunk * 0.68, 0.012), [sw - 0.004, trunk * 0.26, 0.068 + bulk * 0.06], 'trim', 0.95);
  if (outfit === 'suit') g.ell(chest, P(0, nkY - 0.01), [0.075, 0.02, 0.075], 'trim', 0.85);
  if (d.on('pack') || outfit === 'suit') g.box(chest, P(0, hipY + trunk * 0.62, -(0.1 + bulk * 0.05)), [0.15, 0.2, 0.08], outfit === 'suit' ? 'trim' : 'cloth2', 0.8);
  if (d.on('cloak')) {
    const y1 = kneeY - 0.06;
    g.sheet(chest, [P(-sw, shY, -0.045), P(sw, shY, -0.045), [sw + 0.05, y1, -0.13], [-sw - 0.05, y1, -0.13]], 'cloth2', 0.85);
    for (const s of SIDES) g.sheet(chest, [P(s * sw, shY, -0.045), P(s * (sw + 0.012), shY - 0.02, 0.03), [s * (sw + 0.06), kneeY + 0.1, 0], [s * (sw + 0.05), y1, -0.13]], 'cloth2', 0.8);
  }
  if (d.on('tail')) {
    const pts: V3[] = [];
    for (let i = 0; i <= 4; i++) pts.push([0, hipY + 0.02 - 0.3 * hipY * Math.sin((i / 4) * 1.3), -0.06 - 0.42 * hipY * (i / 4)]);
    g.chain('tail', 'tail', root, pts, 0.034 + bulk * 0.02, 0.008, skin, 0.95, 0.8);
  }
  const tool = d.s('tool', ['none', 'staff', 'tool', 'blade', 'book', 'lamp'] as const, 'none');
  const hand = g.arms[1]?.hand ?? -1;
  if (tool !== 'none' && hand >= 0) {
    const w = add(g.at[hand] as V3, [-0.012, -0.055 * as, 0.01]);
    if (tool === 'staff') g.cap(hand, add(w, [0, -(w[1] - 0.02), 0.03]), add(w, [0, 0.62, 0.03]), 0.011, 0.01, 'trim', 0.75);
    else if (tool === 'tool') {
      g.cap(hand, w, add(w, [0, -0.02, 0.3]), 0.01, 0.01, 'trim', 0.75);
      g.box(hand, add(w, [0, -0.02, 0.31]), [0.035, 0.09, 0.04], 'dark', 0.8);
    } else if (tool === 'blade') {
      g.cap(hand, w, add(w, [0, -0.02, 0.07]), 0.011, 0.011, 'dark');
      g.box(hand, add(w, [0, -0.035, 0.33]), [0.008, 0.035, 0.5], 'trim', 1.1);
    } else if (tool === 'book') g.box(hand, add(w, [0.012, 0.0, 0.03]), [0.03, 0.14, 0.1], 'cloth2', 0.8);
    else {
      g.cap(hand, w, add(w, [0, -0.1, 0.02]), 0.004, 0.004, 'dark');
      g.box(hand, add(w, [0, -0.15, 0.02]), [0.05, 0.075, 0.05], 'glow');
    }
  }
  if (giant) {
    const core = d.n('glow', 0.5);
    if (core > 0.3) g.ell(chest, P(0, hipY + trunk * 0.66, 0.058 + bulk * 0.055), [0.03, 0.04, 0.014], 'glow');
    const spires = d.count('plates', 0, 6, 3);
    for (let i = 0; i < spires; i++) {
      const y = L(hipY + trunk * 0.3, shY + 0.02, i / Math.max(1, spires - 1));
      g.cone(i < 2 ? spine : chest, P(0, y, -0.07), P(0, y + 0.09, -0.2 - 0.03 * (i % 2)), 0.035, 'accent', 0.85);
    }
    g.still = d.n('still', 0);
  }
  g.pattern = d.s('pattern', PATTERNS, 'plain');
}

function winged(d: Dials, g: Rig, bird: boolean): void {
  const bulk = d.n('bulk', 0.45), neck = d.n('neck', bird ? 0.15 : 0.55), tail = d.n('tail', bird ? 0.2 : 0.65);
  const R = L(0.11, 0.26, bulk);
  const half = 0.5;
  const legs = L(0.22, 0.75, d.n('legs', bird ? 0.3 : 0.45));
  const four = !bird && d.count('limbs', 2, 4, 4) >= 3;
  const fr = R * 0.26;
  const y0 = fr + legs + R * 0.3;
  const pf: V3 = [0, y0 + (four ? 0 : R * 0.5), half], ph: V3 = [0, y0, -half];
  const c = mix(ph, pf, 0.5);
  const root = g.joint('body', -1, c, 'root');
  if (bird) {
    g.ell(root, c, [R * 1.0, R * 1.05, half + R * 0.5]);
    g.ell(root, add(c, [0, -R * 0.15, half * 0.45]), [R * 0.95, R * 1.0, half * 0.7]);
  } else {
    g.cap(root, ph, pf, R * 0.9, R * 1.05);
    g.ell(root, add(pf, [0, -R * 0.15, -R * 0.2]), [R * 1.0, R * 1.2, R * 1.15]);
  }
  g.clearance = y0 - R * 1.1;

  // Most birds carry the head close on the shoulders; only the high end of the dial is a heron.
  const nl = bird ? L(0.07, 1.7, neck * neck) : L(0.12, 1.7, neck);
  const up = bird ? 0.9 : 0.75;
  const hr = (bird ? L(0.1, 0.17, d.n('head', 0.5)) : L(0.1, 0.2, d.n('head', 0.5))) + R * 0.12;
  const n0: V3 = add(pf, [0, R * 0.45, R * 0.5]);
  const npts: V3[] = [];
  const nn = neck > 0.35 ? 3 : 2;
  for (let i = 0; i <= nn; i++) npts.push(add(n0, [0, Math.sin(up) * nl * (i / nn), Math.cos(up) * nl * (i / nn)]));
  const nk = g.chain('neck', 'neck', root, npts, R * 0.62, hr * 0.72);
  const dh = new Dials({ horns: d.on('crown', !bird) ? 'crown' : 'none', glow_eyes: d.on('glow_eyes') || d.on('glow') ? 1 : 0, frill: d.on('frill') ? 1 : 0 });
  beastHead(g, dh, nk[nk.length - 1] ?? root, npts[nn] as V3, hr, { snout: d.n(bird ? 'beak' : 'snout', bird ? 0.3 : 0.55), ears: 0, beak: bird });
  if (bird && d.on('crest')) g.sheet(g.head, [add(npts[nn] as V3, [0, hr * 0.9, hr * 0.6]), add(npts[nn] as V3, [0, hr * 2.2, -hr * 0.6]), add(npts[nn] as V3, [0, hr * 0.7, -hr * 0.3])], 'accent', 0.95, 'fin');

  const tl = L(0.15, 2.4, tail);
  const tn = bird ? 1 : 5;
  const tpts: V3[] = [];
  const t0: V3 = add(ph, [0, R * 0.1, -R * 0.6]);
  for (let i = 0; i <= tn; i++) tpts.push([0, Math.max(R * 0.12, t0[1] - Math.sin(0.35) * tl * (i / tn) * (bird ? 0.2 : 1)), t0[2] - tl * (i / tn)]);
  // A bird's tail is a thin wedge under the fan of feathers, not a limb.
  const tj = g.chain('tail', 'tail', root, tpts, R * (bird ? 0.36 : 0.6), R * (bird ? 0.1 : 0.07), 'body', 0.95, 0.82);
  const tip = tpts[tn] as V3;
  const last = tj[tj.length - 1] ?? root;
  if (bird) g.sheet(last, [t0, add(tip, [R * 1.3, R * 0.05, -R * 0.6]), add(tip, [0, 0, -R * 1.0]), add(tip, [-R * 1.3, R * 0.05, -R * 0.6])], 'accent', 0.9);
  else if (d.on('spade', true)) g.sheet(last, [add(tip, [0, 0, R * 0.6]), add(tip, [R * 0.6, 0, -R * 0.2]), add(tip, [0, 0, -R * 1.2]), add(tip, [-R * 0.6, 0, -R * 0.2])], 'accent', 0.85);
  if (!bird && d.on('plates', true)) {
    for (let i = 0; i < 5; i++) {
      const p = add(mix(ph, pf, i / 4), [0, R * 0.95, 0]);
      g.sheet(root, [add(p, [0, 0, R * 0.4]), add(p, [0, R * 0.7, -R * 0.1]), add(p, [0, 0, -R * 0.4])], 'accent', 0.85, 'fin');
    }
  }

  for (let p = four ? 0 : 1; p < 2; p++) {
    const z = p === 0 ? half * 0.7 : -half * (bird ? 0.1 : 0.7);
    const top = fr + legs;
    const r: V3 = bird ? [R * 0.3, R * 0.11, R * 0.08] : [R * (p === 0 ? 0.36 : 0.5), R * 0.24, R * 0.16];
    for (const s of SIDES) {
      const hip: V3 = [s * R * 0.6, top, z];
      const ankle: V3 = [s * R * 0.75, fr, z - (p === 1 ? legs * 0.08 : 0)];
      const made = g.leg(`leg${p}${s > 0 ? 'l' : 'r'}`, root, hip, add(mix(hip, ankle, 0.5), [0, 0, (p === 0 ? -1 : 1) * legs * 0.16]), ankle, r, four ? p : 0, s, ['body', bird ? 'accent' : 'body', bird ? 'accent' : 'dark'], bird ? 0 : 1.3);
      if (bird) {
        // A feathered thigh above a bare shank, and a foot of three toes forward and one back.
        g.ell(made.hip, add(hip, [0, -legs * 0.12, 0]), [R * 0.4, Math.min(legs * 0.3, R * 0.8), R * 0.5], 'body', 0.96);
        for (const a of [-0.55, 0, 0.55, Math.PI]) {
          const reach = fr * (a === Math.PI ? 1.6 : 3);
          g.cone(made.foot, [ankle[0], fr * 0.55, ankle[2]], [ankle[0] + Math.sin(a + s * 0.15) * reach, fr * 0.12, ankle[2] + Math.cos(a) * reach], fr * 0.42, 'accent', 0.7);
        }
      } else {
        g.ell(made.hip, add(hip, [-s * R * 0.06, -legs * 0.08, p === 0 ? 0 : R * 0.1]), [r[0] * 1.25, Math.min(legs * 0.32, R * 0.95), r[0] * (p === 0 ? 1.5 : 1.8)], 'body', 0.98);
      }
    }
  }

  // Wings rest spread, as in a glide; the animator folds them on the ground.
  const hsn = L(0.9, 2.7, d.n('wingspan', 0.6)) * (bird ? 1 : 1.35);
  const feather = bird || d.n('feather', 0) > 0.5;
  const chord = L(0.4, 1.0, d.n('chord', feather ? 0.45 : 0.7)) * (bird ? 1 : 1.3);
  for (const s of SIDES) {
    const a0: V3 = [s * R * 0.7, pf[1] + R * 0.55, half * 0.45];
    const a1: V3 = add(a0, [s * hsn * 0.26, hsn * 0.05, hsn * 0.06]);
    const a2: V3 = add(a1, [s * hsn * 0.3, hsn * 0.015, -hsn * 0.05]);
    const a3: V3 = add(a2, [s * hsn * 0.42, -hsn * 0.01, -hsn * 0.2]);
    const n = s > 0 ? 'l' : 'r';
    const wr = g.joint(`wing_${n}`, root, a0, 'wing', s);
    const wm = g.joint(`wingmid_${n}`, wr, a1, 'wing_mid', s);
    const wt = g.joint(`wingtip_${n}`, wm, a2, 'wing_tip', s);
    g.wings.push({ root: wr, mid: wm, tip: wt, side: s });
    const br = R * 0.22;
    g.cap(wr, a0, a1, br, br * 0.75, 'body', 0.95);
    g.cap(wm, a1, a2, br * 0.75, br * 0.5, 'body', 0.92);
    g.cap(wt, a2, a3, br * 0.5, br * 0.12, 'body', 0.88);
    const back = (p: V3, k: number): V3 => add(p, [0, -R * 0.04, -chord * k]);
    const hipSide: V3 = [s * R * 0.7, ph[1] + R * 0.2, -half * 0.55];
    const tone: BodyTone = 'accent';
    if (feather) {
      const b0 = back(a0, 0.75), b1 = back(a1, 0.95), b2 = back(a2, 1.0);
      g.sheet(wr, [a0, a1, b1, b0], tone, 0.95);
      g.sheet(wm, [a1, a2, b2, b1], tone, 0.9);
      g.sheet(wt, [a2, a3, add(a3, [-s * hsn * 0.1, 0, -chord * 0.75]), b2], tone, 0.8);
      g.sheet(wr, [add(a0, [0, 0.01, 0]), add(a1, [0, 0.01, 0]), add(back(a1, 0.4), [0, 0.012, 0]), add(back(a0, 0.4), [0, 0.012, 0])], 'body', 0.98);
      g.sheet(wm, [add(a1, [0, 0.01, 0]), add(a2, [0, 0.01, 0]), add(back(a2, 0.4), [0, 0.012, 0]), add(back(a1, 0.4), [0, 0.012, 0])], 'body', 0.96);
    } else {
      const b1 = back(a1, 1.05), b2 = back(a2, 1.15);
      g.sheet(wr, [a0, a1, b1, hipSide], tone, 0.92);
      g.sheet(wm, [a1, a2, b2, b1], tone, 0.88);
      const f1 = add(a2, [s * hsn * 0.2, -R * 0.04, -chord * 1.0]);
      g.sheet(wt, [a2, a3, f1, b2], tone, 0.84);
      g.cap(wt, a2, f1, br * 0.3, br * 0.08, 'body', 0.85);
      g.cap(wt, a2, b2, br * 0.3, br * 0.08, 'body', 0.85);
      g.cone(wt, a2, add(a2, [0, hsn * 0.03, hsn * 0.07]), br * 0.3, 'dark', 0.8);
    }
  }
  g.pattern = d.s('pattern', PATTERNS, bird ? 'plain' : 'scales');
}

function serpent(d: Dials, g: Rig): void {
  const girth = L(0.012, 0.075, d.n('girth', 0.4));
  const hr = girth * L(0.9, 2.2, d.n('head', 0.4));
  const N = 14;
  const prof = (t: number): number => girth * Math.max(0.1, Math.min(1, 0.72 + t * 1.6) * Math.pow(1 - t, 0.55));
  const root = g.joint('neck', -1, [0, prof(0), 0], 'root');
  const dh = new Dials({ horns: d.on('horns') ? 'horns' : 'none', glow_eyes: d.on('glow_eyes') || d.on('glow') ? 1 : 0, frill: d.on('frill') ? 1 : 0 });
  beastHead(g, dh, root, [0, Math.max(prof(0), hr * 1.1), 0], hr, { snout: d.n('snout', 0.35), ears: 0 });
  const ids: number[] = [];
  let parent = root;
  const pairs = d.count('legs', 0, 10, 0);
  const fins = d.on('crest') || d.on('fins');
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const a: V3 = [0, prof(t0), -t0], b: V3 = [0, prof(t1), -t1];
    const j = i === 0 ? root : g.joint(`spine${i}`, parent, a, 'spine', 0, i);
    g.cap(j, a, b, prof(t0), prof(t1), 'body', L(1, 0.85, t0));
    if (i > 0) ids.push(j);
    if (fins && i < N - 2) g.sheet(j, [add(a, [0, prof(t0) * 0.8, 0]), add(mix(a, b, 0.5), [0, prof(t0) * 2.1, -0.02]), add(b, [0, prof(t1) * 0.8, 0])], 'accent', 0.9, 'fin');
    if (d.on('hood') && i === 1) for (const s of SIDES) g.sheet(j, [a, add(a, [s * girth * 3.2, girth * 0.4, -0.02]), add(b, [s * girth * 2.2, 0, -0.03]), b], 'accent', 0.95);
    if (pairs > 0 && i >= 1 && i < N - 2 && (i - 1) % Math.max(1, Math.floor((N - 3) / pairs)) === 0 && g.legs.length < pairs * 2) {
      const r = prof(t0);
      const reach = girth * 2.6;
      for (const s of SIDES) {
        const hip: V3 = [s * r * 0.7, r, -t0 - 0.5 / N];
        const fr = r * 0.18;
        g.leg(`leg${i}${s > 0 ? 'l' : 'r'}`, j, hip, add(hip, [s * reach * 0.5, r * 0.9, 0]), [hip[0] + s * reach, fr, hip[2]], [r * 0.3, r * 0.22, r * 0.1], g.legs.length >> 1, s, ['accent', 'accent', 'dark'], 0);
      }
    }
    parent = j;
  }
  g.chains.push({ kind: 'spine', joints: ids });
  g.clearance = 0;
  g.humps = d.n('humps', 0);
  g.pattern = d.s('pattern', PATTERNS, 'scales');
}

function swimmer(d: Dials, g: Rig): void {
  const bulk = d.n('bulk', 0.45), flat = d.n('flat', 0), depth = d.n('depth', 0.5);
  const w = L(0.07, 0.2, bulk) * (1 + flat * 2.2), h = L(0.08, 0.24, bulk) * L(0.7, 1.5, depth) * (1 - flat * 0.6);
  const N = 5;
  const prof = (t: number): number => Math.max(0.12, Math.sin(Math.PI * Math.pow(clamp(t, 0, 1), 0.62)) * 0.98 + 0.06);
  const z = (i: number): number => 0.42 - (i / N) * 0.84;
  const root = g.joint('head', -1, [0, h, z(0)], 'root');
  g.head = root;
  g.headHeight = h * 1.4;
  let parent = root;
  const ids: number[] = [];
  for (let i = 0; i < N; i++) {
    const j = i === 0 ? root : g.joint(`spine${i}`, parent, [0, h, z(i)], 'spine', 0, i);
    const t = (i + 0.5) / N;
    g.ell(j, [0, h, (z(i) + z(i + 1)) / 2], [w * prof(t * 0.92 + 0.06), h * prof(t * 0.92 + 0.06), 0.84 / N * 1.3], 'body', L(1, 0.9, t));
    if (i > 0) ids.push(j);
    parent = j;
  }
  g.chains.push({ kind: 'spine', joints: ids });
  g.ell(root, [0, h * 0.95, 0.44], [w * 0.5, h * 0.48, 0.09]);
  const jaw = g.joint('jaw', root, [0, h * 0.75, 0.36], 'jaw');
  g.jaw = jaw;
  g.ell(jaw, [0, h * 0.68, 0.43], [w * 0.42, h * 0.2, 0.075], 'body', 0.9);
  const eyes: BodyTone = d.on('glow_eyes') || d.on('glow') ? 'glow' : 'dark';
  for (const s of SIDES) g.ell(root, [s * w * 0.46, h * 1.12, 0.4], [0.012 + w * 0.05, 0.014 + h * 0.05, 0.016], eyes, 0.5);
  const tailJ = ids[ids.length - 1] ?? root;
  // The body sections overlap into one smooth form; the tail fin starts inside the last of them.
  const tz = z(N) - 0.02;
  const cl = L(0.1, 0.24, d.n('tail', 0.5)), ch = cl * 1.05;
  g.fluke = d.n('fluke', 0) > 0.5 ? 1 : 0;
  const cau: V3[] = g.fluke > 0
    ? [[0, h, tz], [ch, h, tz - cl], [0, h, tz - cl * 0.45], [-ch, h, tz - cl]]
    : [[0, h, tz], [0, h + ch, tz - cl], [0, h, tz - cl * 0.45], [0, h - Math.min(h * 0.98, ch * 0.8), tz - cl]];
  g.sheet(tailJ, cau, 'accent', 0.85, 'fin');
  const dor = d.n('dorsal', 0.5);
  const top = h + h * prof(0.4) * 0.92;
  if (dor > 0.05 && flat < 0.5) g.sheet(ids[0] ?? root, [[0, top, 0.12], [0, top + L(0.03, 0.22, dor), -0.08], [0, top - h * 0.06, -0.14]], 'accent', 0.88, 'fin');
  if (flat < 0.5 && g.fluke === 0) {
    // A second dorsal and an anal fin toward the tail, so the outline is a fish from the side and from below.
    const half = h * prof(0.7) * 0.9, fin = L(0.02, 0.09, dor);
    g.sheet(ids[2] ?? root, [[0, h - half, -0.1], [0, h - half - fin, -0.2], [0, h - half + h * 0.05, -0.24]], 'accent', 0.84, 'fin');
    if (dor > 0.05) g.sheet(ids[2] ?? root, [[0, h + half, -0.14], [0, h + half + fin * 0.8, -0.24], [0, h + half - h * 0.05, -0.27]], 'accent', 0.86, 'fin');
  }
  const pec = L(0.05, 0.28, d.n('pectoral', 0.4)) * (1 + flat * 2.2);
  for (const s of SIDES) {
    const p0: V3 = [s * w * 0.8, h * (flat > 0.5 ? 1 : 0.6), 0.2];
    const f = g.joint(`fin_${s > 0 ? 'l' : 'r'}`, root, p0, 'fin', s);
    const drop = flat > 0.5 ? 0 : -pec * 0.45;
    g.sheet(f, [add(p0, [0, 0, flat > 0.5 ? 0.2 : 0.05]), add(p0, [s * pec, Math.max(-p0[1] + 0.004, drop), -pec * 0.7]), add(p0, [0, 0, flat > 0.5 ? -0.42 : -0.1])], flat > 0.5 ? 'body' : 'accent', 0.9, 'fin');
  }
  g.pattern = d.s('pattern', PATTERNS, 'plain');
}

function crawler(d: Dials, g: Rig): void {
  const pairs = d.count('pairs', 3, 5, 4);
  const bulk = d.n('bulk', 0.5), wide = d.n('wide', 0.3);
  const reach = L(0.3, 1.0, d.n('legs', 0.5));
  const bw = L(0.13, 0.24, bulk) * (1 + wide);
  const bh = L(0.09, 0.16, bulk);
  const y = bh + reach * L(0.12, 0.5, d.n('stance', 0.4));
  const root = g.joint('thorax', -1, [0, y, 0.15], 'root');
  g.ell(root, [0, y, 0.15], [bw, bh, 0.24]);
  g.clearance = y - bh;
  const ab = L(0.1, 0.36, d.n('abdomen', 0.5));
  const stinger = d.on('stinger');
  if (ab > 0.12 && !stinger) {
    const aj = g.joint('abdomen', root, [0, y, -0.05], 'spine', 0, 0);
    g.chains.push({ kind: 'spine', joints: [aj] });
    g.ell(aj, [0, y + ab * 0.15, -0.08 - ab * 0.85], [ab * (0.8 + wide * 0.5), ab * 0.75, ab], 'body', 0.94);
  }
  if (d.on('shell')) g.ell(root, [0, y + bh * 0.35, 0.05], [bw * 1.25, bh * 0.95, 0.36], 'accent', 0.95);
  const eyes: BodyTone = d.on('glow_eyes') || d.on('glow') ? 'glow' : 'dark';
  g.head = g.joint('head', root, [0, y + bh * 0.2, 0.36], 'head');
  g.headHeight = bh;
  g.ell(g.head, [0, y + bh * 0.05, 0.36], [bw * 0.5, bh * 0.62, 0.07], 'body', 0.92);
  // Six legs make an insect, and an insect carries feelers; spiders and clawed things do not.
  if (d.on('antennae', pairs === 3 && !d.on('claws'))) {
    for (const s of SIDES) {
      const a0: V3 = [s * bw * 0.22, y + bh * 0.5, 0.41];
      const a1: V3 = add(a0, [s * bw * 0.35, bh * 0.9, 0.1]);
      g.cap(g.head, a0, a1, 0.009, 0.007, 'dark', 0.8);
      g.cap(g.head, a1, add(a1, [s * bw * 0.3, -bh * 0.2, 0.12]), 0.007, 0.004, 'dark', 0.75);
    }
  }
  for (const s of SIDES) {
    g.ell(g.head, [s * bw * 0.32, y + bh * 0.5, 0.37], [0.022, 0.022, 0.022], eyes, 0.5);
    g.ell(g.head, [s * bw * 0.12, y + bh * 0.62, 0.39], [0.015, 0.015, 0.015], eyes, 0.5);
    g.cone(g.head, [s * bw * 0.2, y - bh * 0.3, 0.37], [s * bw * 0.08, y - bh * 0.7, 0.47], 0.02, 'dark', 0.7);
  }
  for (let p = 0; p < pairs; p++) {
    const f = pairs === 1 ? 0.5 : p / (pairs - 1);
    const ang = L(0.6, 2.35, f);
    const zc = L(0.3, -0.02, f);
    const lr = reach * (0.85 + 0.3 * Math.abs(f - 0.5));
    for (const s of SIDES) {
      const dir: V3 = [s * Math.sin(ang), 0, Math.cos(ang)];
      const hip: V3 = [s * bw * 0.8, y - bh * 0.2, zc];
      const fr = 0.012;
      const knee: V3 = [hip[0] + dir[0] * lr * 0.45, y + lr * 0.32, hip[2] + dir[2] * lr * 0.45];
      const tipP: V3 = [hip[0] + dir[0] * lr, fr, hip[2] + dir[2] * lr];
      g.leg(`leg${p}${s > 0 ? 'l' : 'r'}`, root, hip, knee, tipP, [bh * 0.3, bh * 0.22, 0.012], p, s, ['body', 'body', 'dark'], 0);
    }
  }
  if (d.on('claws')) {
    const cs = L(0.5, 1.4, d.n('claws', 0.6));
    for (const s of SIDES) {
      const s0: V3 = [s * bw * 0.6, y, 0.34];
      const e0: V3 = add(s0, [s * 0.16 * cs, 0.03, 0.14 * cs]);
      const h0: V3 = add(e0, [-s * 0.05 * cs, -0.01, 0.2 * cs]);
      const n = s > 0 ? 'l' : 'r';
      const sj = g.joint(`claw_${n}`, root, s0, 'shoulder', s);
      const ej = g.joint(`clawmid_${n}`, sj, e0, 'elbow', s);
      const hj = g.joint(`clawhand_${n}`, ej, h0, 'hand', s);
      g.arms.push({ shoulder: sj, elbow: ej, hand: hj, side: s });
      g.cap(sj, s0, e0, bh * 0.3, bh * 0.28);
      g.cap(ej, e0, h0, bh * 0.28, bh * 0.4);
      g.ell(hj, add(h0, [0, 0, 0.04 * cs]), [bh * 0.5 * cs, bh * 0.4 * cs, 0.085 * cs], 'accent');
      g.cone(hj, add(h0, [s * 0.02, 0.01, 0.08 * cs]), add(h0, [s * 0.03, 0.015, 0.25 * cs]), bh * 0.24 * cs, 'accent', 0.9);
      g.cone(hj, add(h0, [-s * 0.03, -0.01, 0.08 * cs]), add(h0, [-s * 0.01, 0, 0.22 * cs]), bh * 0.18 * cs, 'accent', 0.8);
    }
  }
  if (stinger) {
    const pts: V3[] = [];
    const tl = L(0.5, 1.1, d.n('tail', 0.6));
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * 2.5;
      pts.push([0, y + tl * 0.42 * (1 - Math.cos(a)), -0.1 - tl * 0.42 * Math.sin(a)]);
    }
    const tj = g.chain('tail', 'tail', root, pts, bh * 0.75, bh * 0.38, 'body', 0.95, 0.85);
    const e = pts[5] as V3;
    g.ell(tj[tj.length - 1] ?? root, e, [bh * 0.5, bh * 0.5, bh * 0.5], 'accent');
    g.cone(tj[tj.length - 1] ?? root, e, add(e, [0, -0.06, 0.17]), bh * 0.3, d.on('glow') ? 'glow' : 'dark', 0.8);
  }
  g.pattern = d.s('pattern', PATTERNS, 'plain');
}

function floater(d: Dials, g: Rig, rng: Rng): void {
  const shape = d.s('shape', ['bell', 'orb', 'disc', 'bag'] as const, 'bell');
  const count = d.count('tentacles', 0, 10, shape === 'bell' ? 7 : shape === 'bag' ? 4 : 0);
  const tl = L(0.25, 1.9, d.n('length', 0.5));
  const r: V3 = shape === 'bell' ? [0.36, 0.2, 0.36] : shape === 'orb' ? [0.3, 0.3, 0.3] : shape === 'disc' ? [0.42, 0.09, 0.42] : [0.3, 0.42, 0.34];
  const top = (count > 0 ? tl : 0.12) + r[1];
  const c: V3 = [0, top, 0];
  const root = g.joint('body', -1, c, 'root');
  g.head = root;
  g.headHeight = r[1] * 2;
  const glow = d.n('glow', 0.5) > 0.3;
  g.ell(root, c, r);
  if (shape === 'bell') {
    g.ell(root, add(c, [0, -r[1] * 0.55, 0]), [r[0] * 1.04, r[1] * 0.5, r[2] * 1.04], 'accent', 0.95);
    if (glow) g.ell(root, add(c, [0, -r[1] * 0.5, 0]), [r[0] * 0.4, r[1] * 0.5, r[2] * 0.4], 'glow');
  } else if (shape === 'disc') {
    g.ell(root, add(c, [0, r[1] * 0.7, 0]), [r[0] * 0.45, r[1] * 0.9, r[2] * 0.45], 'accent', 0.95);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const p: V3 = add(c, [Math.cos(a) * r[0] * 1.15, r[1] * 0.3, Math.sin(a) * r[0] * 1.15]);
      g.cap(root, c, p, 0.03, 0.025, 'dark', 0.8);
      g.ell(root, add(p, [0, 0.05, 0]), [0.17, 0.012, 0.17], 'dark', 0.6);
    }
    g.ell(root, add(c, [0, -r[1] * 1.1, r[2] * 0.35]), [0.07, 0.07, 0.07], glow ? 'glow' : 'dark');
  }
  if (d.on('eye', shape === 'orb')) {
    g.ell(root, add(c, [0, 0, r[2] * 0.72]), [r[0] * 0.55, r[1] * 0.55, r[2] * 0.36], glow ? 'glow' : 'accent');
    g.ell(root, add(c, [0, 0, r[2] * 1.02]), [r[0] * 0.2, r[1] * 0.26, r[2] * 0.1], 'dark', 0.4);
  } else if (shape === 'orb' && glow) g.ell(root, c, [r[0] * 0.6, r[1] * 0.6, r[2] * 0.6], 'glow');
  if (d.on('fins', shape === 'bag')) {
    for (const s of SIDES) {
      const p0 = add(c, [s * r[0] * 0.9, 0, -r[2] * 0.2]);
      const f = g.joint(`fin_${s > 0 ? 'l' : 'r'}`, root, p0, 'fin', s);
      g.sheet(f, [add(p0, [0, 0, 0.15]), add(p0, [s * 0.36, 0.05, -0.2]), add(p0, [0, 0, -0.2])], 'accent', 0.9, 'fin');
    }
  }
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const rr = shape === 'bell' ? 0.82 : 0.5;
    const x = Math.cos(a) * r[0] * rr, zz = Math.sin(a) * r[2] * rr;
    const y0 = top - r[1] * (shape === 'bell' ? 0.7 : 0.85);
    const l = Math.min(y0 - 0.01, tl * rng.range(0.7, 1));
    const pts: V3[] = [];
    for (let k = 0; k <= 4; k++) pts.push([x, y0 - l * (k / 4), zz]);
    g.chain('tentacle', `tent${i}_`, root, pts, 0.03, 0.008, i % 2 === 0 ? 'body' : 'accent', 0.95, 0.8);
  }
  g.hover = L(0.6, 4.5, d.n('hover', 0.4)) + 0.4;
  g.pattern = d.s('pattern', PATTERNS, 'plain');
}

function swarmUnit(d: Dials, g: Rig): void {
  const long = d.n('long', 0.4), wings = d.n('wings', 0.7);
  const r = L(0.2, 0.09, long);
  const root = g.joint('unit', -1, [0, r, 0], 'root');
  g.ell(root, [0, r, 0], [r, r, 0.5]);
  if (d.n('glow', 0.4) > 0.3) g.ell(root, [0, r, -0.36], [r * 0.9, r * 0.9, 0.2], 'glow');
  if (wings > 0.05) {
    const sp = L(0.3, 1.3, wings);
    for (const s of SIDES) {
      const w = g.joint(`wing_${s > 0 ? 'l' : 'r'}`, root, [s * r * 0.5, r * 1.6, 0.1], 'wing', s);
      g.sheet(w, [[s * r * 0.5, r * 1.6, 0.25], [s * (r + sp), r * 1.7, 0.1], [s * (r + sp * 0.8), r * 1.65, -0.3], [s * r * 0.5, r * 1.6, -0.15]], 'accent', 0.95);
    }
  }
  g.units = d.count('units', 6, 60, 24);
  g.hover = L(1.5, 30, d.n('hover', 0.3));
}

/**
 * Builds one body. `size` is the standing height for bipeds, colossi and floaters, the length for
 * serpents and swimmers, and the larger of length and height otherwise, in metres. Deterministic.
 */
export function buildBody(family: CreatureFamily, dials: BodyDials, size: number, seed: number): BodyPlan {
  const d = new Dials(dials, seed);
  const g = new Rig();
  const rng = makeRng(seed, `body|${family}`);
  const s = Number.isFinite(size) ? size : 1;
  switch (family) {
    case 'quadruped': quadruped(d, g); return g.finish(family, s, 'max');
    case 'biped': biped(d, g, rng); return g.finish(family, s, 'height');
    case 'winged': winged(d, g, false); return g.finish(family, s, 'length');
    case 'bird': winged(d, g, true); return g.finish(family, s, 'length');
    case 'serpent': serpent(d, g); return g.finish(family, s, 'length');
    case 'swimmer': swimmer(d, g); return g.finish(family, s, 'length');
    case 'crawler': crawler(d, g); return g.finish(family, s, 'length');
    case 'floater': floater(d, g, rng); return g.finish(family, s, 'height');
    case 'colossus':
      if (d.count('legs', 2, 4, 2) >= 3) {
        quadruped(new Dials({ bulk: 0.9, neck: 0.3, head: 0.3, tail: 0.3, plates: 1, glow_eyes: 1, ...dials, legs: 0.75 }), g);
        g.still = d.n('still', 0);
      } else biped(d, g, rng, true);
      return g.finish(family, clamp(s, 2, 60), 'height');
    case 'swarm': swarmUnit(d, g); return g.finish(family, s, 'length');
  }
}

/** Rest position of every joint in body space. */
export function restPositions(plan: BodyPlan): V3[] {
  const out: V3[] = [];
  for (const j of plan.joints) out.push(j.parent < 0 ? [j.pos[0], j.pos[1], j.pos[2]] : add(out[j.parent] as V3, j.pos));
  return out;
}

/** Axis-aligned bounds of the rest pose in body space. */
export function bodyBounds(plan: BodyPlan): { min: V3; max: V3 } {
  const at = restPositions(plan);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of plan.segments) {
    const o = add(at[s.joint] as V3, s.pos);
    for (let c = 0; c < 8; c++) {
      const p = rotateByQuat([(c & 1 ? 0.5 : -0.5) * s.size[0], (c & 2 ? 0.5 : -0.5) * s.size[1], (c & 4 ? 0.5 : -0.5) * s.size[2]], s.quat);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, (o[k] as number) + (p[k] as number));
        max[k] = Math.max(max[k] as number, (o[k] as number) + (p[k] as number));
      }
    }
  }
  return { min, max };
}

/** What the world model is told about bodies. Dials are 0..1 unless options are listed. */
export function bodyCatalogText(): string {
  return [
    'LIVING THINGS. Each creature is a body plan (family) reshaped by dials; dials are 0..1 unless options are listed, omitted dials take sensible defaults. size is metres. Colours stay natural and muted; glow is only for eyes, fire and lamps. Any family accepts pattern: plain|stripes|spots|scales|patches and glow_eyes: 0|1.',
    'quadruped (wolf, horse, elephant, lizard, boar, stag): legs (stubby..stilt), body (length), neck, head, snout, ears, tail, tailw (tail thickness), bulk, slope (0 rump high .. 1 shoulders high), sprawl (0 upright .. 1 belly-low reptile), horns: none|horns|antlers|tusks|horn|crown, frill, plates, mane, hump. size = larger of length and height.',
    'biped (apes, trolls, robots, any upright folk): bulk, shoulders, hips, limbs (leg length), arms, head (0.5 = real human, 7.5 heads tall), posture (0 upright .. 1 stooped), hair, outfit: bare|tunic|coat|robe|armor|suit|work, hat: brim|cap|cone|helm, tool: none|staff|tool|blade|book|lamp, features 0|1: tail, horns, long_ears, snout, visor, antenna, wings, hood, cloak, armor, pack, mask, beard. size = height.',
    'winged (dragon, wyvern, giant bat, pterosaur, angel-thing): wingspan, feather (0 membrane .. 1 feathered), chord (wing depth), neck, tail, bulk, head, snout, legs, limbs: 2|4, crown (horn crown), frill, plates (back spines), spade (tail tip). size = length nose to tail.',
    'bird (crow, gull, heron, owl, vulture): wingspan, neck, legs, beak, tail, bulk, head, crest. size = length.',
    'serpent (snake, worm, eel, centipede, sea serpent): girth, head, snout, legs (0 none .. 1 ten pairs), humps (arching coils), hood, crest, horns, frill. size = length.',
    'swimmer (fish, shark, whale, ray): bulk, depth (tall body), flat (ray-like, wide wings), fluke (1 = whale tail, beats up and down), dorsal, pectoral, tail. size = length. Lives in water when the world has any.',
    'crawler (spider, crab, beetle, scorpion): pairs (3..5 leg pairs), legs (reach), stance (belly height), bulk, wide, abdomen, shell, claws, stinger, tail, antennae. size = body length.',
    'floater (jellyfish, drone, balloon beast, wisp, eye): shape: bell|orb|disc|bag, tentacles (0..10), length (tentacle length), eye, fins, glow, hover (height above ground). size = height.',
    'colossus (a vast slow walker or standing giant, size 15..40): legs: 2|4, bulk, shoulders, arms, head, posture, plates (back spires), glow (chest core), still (1 = stands like a statue). size = height.',
    'swarm (insects, bats, motes, scrap drones): units (6..60 per group), wings, long (0 round .. 1 slender), glow, hover (flying height). size = one unit, 0.05..0.6.',
    'Behaviours: roam, graze (walks, stops, lowers its head), patrol (between doors), perch (rests on high ground, takes off), circle (wide banking orbits in the sky; only winged, bird, floater, swarm fly), sleep (curled at its haunt, lifts its head when approached), guard (holds a spot, turns to face you), flock (moves as a group), stalk (follows at a distance). haunt: sky | water | wild | plaza | a building id.',
    'Scale honestly: a horse is 2.4, an elephant 6, a dragon 10..18, a crow 0.45, a person 1.5..1.9. Creatures over 6 m keep to open land or sky. Choose life that belongs: a desert has few, a jungle many; an empty world may have none.',
  ].join('\n');
}
