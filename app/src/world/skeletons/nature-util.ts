// Helpers shared by the nature skeletons. Pure, no three.
// Parts only turn about the vertical axis, so anything that leans is built from a thin wedge (a tapering
// blade whose tip sits over its outer end), anything that arches from a thin dome, and anything that
// bends from short segments that step sideways.
import type { BlueprintPart, PartTone } from '../spec';
import type { Rng } from '../rng';
import { expandParts } from '../blueprints';
import type { Dials, Skeleton } from './types';
import { clamp, cyl, lerp, sph, wedge } from './util';

export const TAU = Math.PI * 2;
/** Golden angle: successive pieces placed this far apart never line up. */
export const GOLD = 2.39996;
const deg = (a: number): number => (a * 180) / Math.PI;

/** Rotation that points a part's local +x away from the centre along angle `a` (radians). */
export const outward = (a: number): number => -deg(a);
/** Rotation that points a part's local +x toward the centre from angle `a`. */
export const inward = (a: number): number => 180 - deg(a);

export interface P2 { x: number; z: number }
export const polar = (o: P2, a: number, r: number): P2 => ({ x: o.x + r * Math.cos(a), z: o.z + r * Math.sin(a) });
export const ORIGIN: P2 = { x: 0, z: 0 };

/** Keeps a part inside the limits every blueprint part is held to, so a skeleton's output needs no repair. */
function fit(p: BlueprintPart): BlueprintPart {
  return {
    ...p,
    x: clamp(p.x, -0.5, 0.5), z: clamp(p.z, -0.5, 0.5), y: clamp(p.y, 0, 30),
    w: clamp(p.w, 0.02, 1.4), d: clamp(p.d, 0.02, 1.4), h: clamp(p.h, 0.05, 30),
    gap: p.repeat > 1 ? clamp(p.gap, 0, 1.4) : 0,
  };
}

/** The most parts a skeleton may return. */
export const MAX_PARTS = 28;

/** A part list that takes structure freely and garnish only while there is room. */
export class Parts {
  readonly list: BlueprintPart[] = [];
  add(...ps: BlueprintPart[]): void {
    for (const p of ps) this.list.push(fit(p));
  }
  /** Adds optional detail; dropped once the list is full, so the bones are never what gets cut. */
  extra(p: BlueprintPart): void {
    if (this.list.length < MAX_PARTS) this.list.push(fit(p));
  }
  get room(): number {
    return MAX_PARTS - this.list.length;
  }
}

export interface Stem {
  parts: BlueprintPart[];
  /** Centre of the stem at height y. */
  at(y: number): P2;
  /** Width of the stem at height y. */
  width(y: number): number;
  height: number;
}

/**
 * A trunk or stalk of `segs` stacked cylinders, tapering from w0 to w1 and bending `bend` (footprint
 * fraction) toward `dir` by its top. Each segment overlaps the one under it, so the stem stays whole.
 */
export function stem(o: P2, height: number, w0: number, w1: number, bend: number, dir: number, segs: number, tone: PartTone): Stem {
  const n = Math.max(1, Math.round(segs));
  const h = height / n;
  const offs: number[] = [];
  const widths: number[] = [];
  const parts: BlueprintPart[] = [];
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const t = n > 1 ? k / (n - 1) : 0;
    const w = Math.max(0.02, lerp(w0, w1, t));
    const off = k === 0 ? 0 : Math.min(bend * Math.pow(t, 1.5), prev + 0.45 * w);
    prev = off;
    offs.push(off);
    widths.push(w);
    const c = polar(o, dir, off);
    parts.push(cyl(c.x, c.z, k * h, w, w, h, tone));
  }
  const index = (y: number): number => clamp(Math.floor(y / h), 0, n - 1);
  return {
    parts,
    at: (y) => polar(o, dir, offs[index(y)] ?? 0),
    width: (y) => widths[index(y)] ?? w1,
    height,
  };
}

/** A blade or twig that rises from `from` and leans `reach` outward along angle `a`, tapering to its tip. */
export function blade(from: P2, a: number, y: number, reach: number, thick: number, h: number, tone: PartTone): BlueprintPart {
  const r = Math.max(0.02, reach);
  const c = polar(from, a, r / 2);
  return wedge(c.x, c.z, y, r, thick, h, tone, { rot: outward(a) });
}

/** A fin that is tall at `from` and runs down to nothing `reach` away along angle `a`: a root, a drooping leaf. */
export function fin(from: P2, a: number, y: number, reach: number, thick: number, h: number, tone: PartTone): BlueprintPart {
  const r = Math.max(0.02, reach);
  const c = polar(from, a, r / 2);
  return wedge(c.x, c.z, y, r, thick, h, tone, { rot: inward(a) });
}

/** A strand of `n` overlapping lobes that sways from side to side as it rises: kelp, a tendril, a liana. */
export function lobes(o: P2, a: number, height: number, w: number, sway: number, n: number, tone: PartTone): BlueprintPart[] {
  const count = Math.max(1, Math.round(n));
  const seg = height / count;
  const amp = Math.min(sway, w * 0.4);
  const out: BlueprintPart[] = [];
  for (let k = 0; k < count; k++) {
    const c = polar(o, a, k % 2 === 0 ? -amp : amp);
    const wk = w * lerp(1, 0.6, count > 1 ? k / (count - 1) : 0);
    out.push(sph(c.x, c.z, k * seg, wk, Math.max(0.02, wk * 0.55), seg * 1.2, tone, { rot: outward(a) }));
  }
  return out;
}

/**
 * Not a dial: set by a caller that will keep only a few parts, so trunks come as one piece and leave the
 * part budget to what gives the plant its outline.
 */
export const SPARE = '_spare';
export const spare = (d: Dials): boolean => d[SPARE] === 1;

/** Full, clamped dials for `sk` from a partial set: lets one skeleton stand on another's bones. */
export function dialsFor(sk: Skeleton, over: Dials): Dials {
  const d: Dials = {};
  for (const s of sk.dials) {
    const v = over[s.name];
    if (s.kind === 'number') d[s.name] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, s.min ?? 0, s.max ?? 1) : s.default;
    else d[s.name] = typeof v === 'string' && (s.choices ?? []).includes(v) ? v : s.default;
  }
  if (over[SPARE] === 1) d[SPARE] = 1;
  return d;
}

export const build = (sk: Skeleton, over: Dials, rng: Rng): BlueprintPart[] => sk.build(dialsFor(sk, over), rng);

// ---- Finishing: order and orientation -------------------------------------------------------------------

interface Rect { x0: number; x1: number; z0: number; z1: number }

function rectOf(p: BlueprintPart): Rect {
  const a = (p.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const hx = (p.w / 2) * c + (p.d / 2) * s;
  const hz = (p.w / 2) * s + (p.d / 2) * c;
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}

const meet = (a: Rect, b: Rect): boolean => a.x0 <= b.x1 + 0.02 && b.x0 <= a.x1 + 0.02 && a.z0 <= b.z1 + 0.02 && b.z0 <= a.z1 + 0.02;

/** One copy rests on another: its base lies within the other's height, or it hangs from the other's underside. */
function rests(p: BlueprintPart, q: BlueprintPart): boolean {
  return meet(rectOf(p), rectOf(q)) && ((p.y >= q.y - 0.15 && p.y <= q.y + q.h + 0.15) || Math.abs(p.y + p.h - q.y) <= 0.15);
}

const onGround = (p: BlueprintPart): boolean => p.y <= 0.05;
const weight = (p: BlueprintPart): number => p.w * p.d * p.h * p.repeat * (p.tone === 'wall2' || p.tone === 'wall' ? 1 : 4);

/**
 * Puts the parts that matter most first, each after whatever carries it, so that any leading run of the
 * list is a whole plant with nothing left hanging in the air: the big masses and the stem under them come
 * before twigs, spines and fruit.
 */
export function arrange(parts: BlueprintPart[]): BlueprintPart[] {
  const n = parts.length;
  const copies = parts.map((p) => expandParts([p]));
  // carriedBy[i]: parts any one of which holds every copy of part i.
  const carriedBy: number[][] = parts.map((_, i) => {
    const mine = copies[i] ?? [];
    const holders: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const theirs = copies[j] ?? [];
      if (mine.every((c) => theirs.some((q) => rests(c, q)))) holders.push(j);
    }
    return holders;
  });
  const grounded = copies.map((cs) => cs.every(onGround));
  const kept: number[] = [];
  const done = new Set<number>();
  /** Shortest run of parts, base first, that must go in before part i can stand; null when nothing carries it. */
  const chainTo = (i: number): number[] | null => {
    if (grounded[i]) return [];
    const from = new Map<number, number>();
    const queue: number[] = [i];
    const seen = new Set<number>([i]);
    while (queue.length > 0) {
      const cur = queue.shift() as number;
      for (const h of carriedBy[cur] ?? []) {
        if (seen.has(h)) continue;
        seen.add(h);
        from.set(h, cur);
        if (done.has(h) || grounded[h]) {
          const chain: number[] = [];
          let at: number | undefined = h;
          while (at !== undefined && at !== i) {
            if (!done.has(at)) chain.push(at);
            at = from.get(at);
          }
          return chain;
        }
        queue.push(h);
      }
    }
    return null;
  };
  const byWeight = parts.map((_, i) => i).sort((a, b) => weight(parts[b] as BlueprintPart) - weight(parts[a] as BlueprintPart) || a - b);
  while (kept.length < n) {
    let placed = false;
    for (const i of byWeight) {
      if (done.has(i)) continue;
      const chain = chainTo(i);
      if (chain === null) continue;
      for (const k of [...chain, i]) {
        if (done.has(k)) continue;
        done.add(k);
        kept.push(k);
      }
      placed = true;
      break;
    }
    if (!placed) {
      for (let i = 0; i < n; i++) if (!done.has(i)) kept.push(i);
      break;
    }
  }
  return kept.map((i) => parts[i] as BlueprintPart);
}

/** Whether anything stands in the strip in front of the footprint that blueprints keep clear. */
function frontBlocked(parts: BlueprintPart[]): boolean {
  return expandParts(parts).some((p) => {
    const r = rectOf(p);
    return r.x0 <= 0 && r.x1 >= 0 && r.z0 <= 0.56 && r.z1 >= 0.56 && p.y < 1.8 && p.y + p.h > 0.4;
  });
}

const quarterTurn = (p: BlueprintPart): BlueprintPart => ({ ...p, x: p.z, z: -p.x, rot: p.rot + 90 > 180 ? p.rot - 270 : p.rot + 90 });
const drawnIn = (p: BlueprintPart, k: number): BlueprintPart =>
  ({ ...p, x: p.x * k, z: p.z * k, w: Math.max(0.02, p.w * k), d: Math.max(0.02, p.d * k), gap: p.gap * k });

/**
 * Turns a plant by quarter turns until nothing low overhangs the front edge of its footprint, and draws
 * it in a little if no turn clears it. Plants are scattered at every angle, so the turn changes nothing seen.
 */
export function settle(parts: BlueprintPart[]): BlueprintPart[] {
  let cur = parts;
  for (let shrink = 0; shrink < 14; shrink++) {
    for (let turn = 0; turn < 4; turn++) {
      if (!frontBlocked(cur)) return cur;
      cur = cur.map(quarterTurn);
    }
    cur = cur.map((p) => drawnIn(p, 0.93));
  }
  return cur;
}

const LITTER: readonly P2[] = [{ x: 0.3, z: -0.26 }, { x: -0.28, z: 0.2 }, { x: -0.2, z: -0.34 }];

/** Nothing grows on swept ground: the sparest settings still get a stone or two at the foot. */
function littered(parts: BlueprintPart[]): BlueprintPart[] {
  const out = [...parts];
  for (let i = 0; out.length < 4 && i < LITTER.length; i++) {
    const at = LITTER[i] as P2;
    out.push(sph(at.x, at.z, 0, 0.09 - 0.015 * i, 0.07, 0.05, 'wall2', { rot: 40 * i }));
  }
  return out;
}

/** The finished form of a nature skeleton: built, put in order, cut to `max` parts and settled on its footprint. */
export function finished(sk: Skeleton, max = MAX_PARTS): Skeleton {
  return { ...sk, build: (d, rng) => settle(arrange(littered(sk.build(d, rng))).slice(0, max)) };
}
