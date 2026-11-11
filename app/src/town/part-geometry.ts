// The solids a blueprint part is built from, before it is textured, coloured and placed (see blueprint-mesh.ts).
// Every builder returns geometry sized in metres with its base on y = 0, centred on x/z, inside the box the
// part was authored in.
//   - The plain shapes: boxes with bevelled edges, a batter and split lines; round shapes with as many sides
//     as their size on screen needs (roundSegments).
//   - Grown and weathered shapes for plants and minerals (growthOf, organicGeometry): leaf masses as lumpy
//     clumps, conifer whorls with a ragged skirt, stems that taper, bow and flare at the foot, boulders worn
//     round with flats broken off them, blocks of rock with chipped corners. Each is shaped from a seed alone,
//     and is stretched afterwards to fill the part's own box exactly, so what was authored to touch still does.
//   - Contact shading (solidOf, contactsOf, contactShade): how much darker a vertex is for standing under an
//     overhang or on top of another part. It goes into the vertex colour.
import * as THREE from 'three';
import type { PartShape, PartTone } from '../world/spec';
import { WEARING } from './surfaces';
import type { Quality } from './surfaces';

export type V3 = readonly [number, number, number];
type Tri = readonly [V3, V3, V3];

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const ramp = (lo: number, hi: number, v: number): number => {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

function fromTris(tris: readonly Tri[]): THREE.BufferGeometry {
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    t.forEach((v, j) => {
      pos[i * 9 + j * 3] = v[0];
      pos[i * 9 + j * 3 + 1] = v[1];
      pos[i * 9 + j * 3 + 2] = v[2];
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

/** Scales a unit geometry (xz footprint 1, base at y = 0 after `lift`) to metres and drops its base on y = 0. */
function sized(g: THREE.BufferGeometry, sx: number, sy: number, sz: number, lift: number): THREE.BufferGeometry {
  g.scale(sx, sy, sz);
  if (lift !== 0) g.translate(0, lift, 0);
  return g;
}

function gable(w: number, h: number, d: number): THREE.BufferGeometry {
  const a = [-w / 2, 0, -d / 2] as const;
  const b = [w / 2, 0, -d / 2] as const;
  const c = [w / 2, 0, d / 2] as const;
  const dd = [-w / 2, 0, d / 2] as const;
  const e = [-w / 2, h, 0] as const;
  const f = [w / 2, h, 0] as const;
  return fromTris([[a, b, c], [a, c, dd], [a, dd, e], [b, f, c], [dd, c, f], [dd, f, e], [b, a, e], [b, e, f]]);
}

function wedge(w: number, h: number, d: number): THREE.BufferGeometry {
  const a = [-w / 2, 0, -d / 2] as const;
  const b = [w / 2, 0, -d / 2] as const;
  const c = [w / 2, 0, d / 2] as const;
  const dd = [-w / 2, 0, d / 2] as const;
  const e = [w / 2, h, -d / 2] as const;
  const f = [w / 2, h, d / 2] as const;
  return fromTris([[a, b, c], [a, c, dd], [b, e, f], [b, f, c], [a, e, b], [dd, c, f], [a, dd, f], [a, f, e]]);
}

export interface BoxDetail {
  /** Width of the 45 degree bevel on every edge, metres; 0 for sharp edges. */
  chamfer: number;
  /** Height above the base at which the side faces are split, so vertex colour can grade near the ground; 0 for none. */
  split: number;
  /** A second split line, for the shade under an overhang; 0 or absent for none. */
  band?: number;
  /** How far each side leans in by the top, metres: laid stone and earth walls are thicker at the foot. */
  batter?: number;
}

const PLAIN_BOX: BoxDetail = { chamfer: 0, split: 0 };

/**
 * A box with its base on y = 0, optionally bevelled on all twelve edges (one flat facet per edge, a
 * triangle per corner), with its sides split at up to two heights and leaning in toward the top.
 * Triangles are wound outward.
 */
export function boxGeometry(w: number, h: number, d: number, detail: BoxDetail = PLAIN_BOX): THREE.BufferGeometry {
  const c = Math.max(0, Math.min(detail.chamfer, Math.min(w, h, d) * 0.3));
  const x1 = w / 2;
  const z1 = d / 2;
  const ya = c;
  const yb = h - c;
  // The outline of the sides seen from above, and the inset outline of the top and bottom faces.
  const ring: (readonly [number, number])[] = [
    [x1, -z1 + c], [x1, z1 - c], [x1 - c, z1], [-x1 + c, z1], [-x1, z1 - c], [-x1, -z1 + c], [-x1 + c, -z1], [x1 - c, -z1],
  ];
  const cap: (readonly [number, number])[] = [[x1 - c, -z1 + c], [x1 - c, z1 - c], [-x1 + c, z1 - c], [-x1 + c, -z1 + c]];
  const levels = [ya];
  for (const line of [detail.split, detail.band ?? 0].sort((a, b) => a - b)) {
    if (line > (levels[levels.length - 1] as number) + 0.05 && line < yb - 0.05) levels.push(line);
  }
  levels.push(yb);
  const tris: Tri[] = [];
  const mid = h / 2;
  const tri = (a: V3, b: V3, e: V3): void => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = e[0] - a[0];
    const vy = e[1] - a[1];
    const vz = e[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    // The box is convex, so a face is wound outward when its normal points away from the centre.
    const out = nx * (a[0] + b[0] + e[0]) + ny * (a[1] + b[1] + e[1] - 3 * mid) + nz * (a[2] + b[2] + e[2]);
    tris.push(out >= 0 ? [a, b, e] : [a, e, b]);
  };
  const quad = (a: V3, b: V3, e: V3, f: V3): void => {
    tri(a, b, e);
    tri(a, e, f);
  };
  // The lean is kept small enough that a side still reads as upright to everything that sorts faces by their normal.
  const lean = clamp(detail.batter ?? 0, 0, Math.min(w * 0.2, d * 0.2, h * 0.06));
  const kx = lean > 0 ? (2 * lean) / (w * h) : 0;
  const kz = lean > 0 ? (2 * lean) / (d * h) : 0;
  const at = (p: readonly [number, number] | undefined, y: number): V3 => [p ? p[0] * (1 - kx * y) : 0, y, p ? p[1] * (1 - kz * y) : 0];
  for (let i = 0; i < 8; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % 8];
    for (let l = 0; l + 1 < levels.length; l++) {
      const lo = levels[l] as number;
      const hi = levels[l + 1] as number;
      quad(at(p, lo), at(q, lo), at(q, hi), at(p, hi));
    }
    if (c > 0) {
      // Faces (even i) meet the caps along an edge; bevels (odd i) meet them at a corner.
      const k = i >> 1;
      const e0 = cap[i % 2 === 0 ? k : (k + 1) % 4];
      const e1 = cap[(k + 1) % 4];
      quad(at(p, yb), at(q, yb), at(e1, h), at(e0, h));
      quad(at(p, ya), at(q, ya), at(e1, 0), at(e0, 0));
    }
  }
  quad(at(cap[0], h), at(cap[1], h), at(cap[2], h), at(cap[3], h));
  quad(at(cap[0], 0), at(cap[1], 0), at(cap[2], 0), at(cap[3], 0));
  const g = fromTris(tris);
  // Distance from every vertex to the left, right, bottom and top edge of the face it belongs to. On the
  // six faces these are true distances (they interpolate exactly); a bevel facet is an edge, so all zero.
  const wearing = new Float32Array(tris.length * 12);
  const ax = x1 - c;
  const az = z1 - c;
  tris.forEach((t, i) => {
    const [a, b, e] = t;
    const nx = (b[1] - a[1]) * (e[2] - a[2]) - (b[2] - a[2]) * (e[1] - a[1]);
    const ny = (b[2] - a[2]) * (e[0] - a[0]) - (b[0] - a[0]) * (e[2] - a[2]);
    const nz = (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]);
    const len = Math.hypot(nx, ny, nz);
    const face = Math.abs(nx) > 0.99 * len ? 0 : Math.abs(ny) > 0.99 * len ? 1 : Math.abs(nz) > 0.99 * len ? 2 : -1;
    if (face < 0) return;
    t.forEach((v, j) => {
      const o = i * 12 + j * 4;
      // Across the face: z on the x sides, x elsewhere. Up the face: height on the sides, z on the caps.
      const across = face === 0 ? v[2] : v[0];
      const halfAcross = face === 0 ? az : ax;
      wearing[o] = across + halfAcross;
      wearing[o + 1] = halfAcross - across;
      wearing[o + 2] = face === 1 ? v[2] + az : v[1] - ya;
      wearing[o + 3] = face === 1 ? az - v[2] : yb - v[1];
    });
  });
  g.setAttribute(WEARING, new THREE.BufferAttribute(wearing, 4));
  return g;
}

/**
 * How many sides a round shape `span` metres across gets. A pipe or a finial is a few centimetres on
 * screen and keeps six or eight; a drum, a dome or a tank wide enough to fill the view gets enough that
 * its outline shows no corners. Quality 0 takes about two thirds.
 */
export function roundSegments(span: number, quality: Quality): number {
  const n = span < 0.12 ? 6 : span < 0.3 ? 8 : span < 0.8 ? 12 : span < 2 ? 16 : span < 4.5 ? 24 : span < 9 ? 32 : 40;
  return quality === 0 ? Math.max(6, Math.round(n * 0.65)) : n;
}

/**
 * Geometry for one part, sized in metres, base at y = 0, centred on x/z. Arch is two pieces.
 * `segments` sets how many sides round shapes get; `box` bevels and splits box parts.
 */
export function shapeGeometries(shape: PartShape, w: number, h: number, d: number, segments = 10, box: BoxDetail = PLAIN_BOX): THREE.BufferGeometry[] {
  const list: THREE.BufferGeometry[] = [];
  const n = Math.max(6, Math.round(segments));
  switch (shape) {
    case 'box': list.push(boxGeometry(w, h, d, box)); break;
    case 'cylinder': list.push(sized(new THREE.CylinderGeometry(0.5, 0.5, 1, n), w, h, d, h / 2)); break;
    case 'cone': list.push(sized(new THREE.ConeGeometry(0.5, 1, n), w, h, d, h / 2)); break;
    case 'pyramid': list.push(sized(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4), w, h, d, h / 2)); break;
    case 'gable': list.push(gable(w, h, d)); break;
    case 'wedge': list.push(wedge(w, h, d)); break;
    case 'dome': list.push(sized(new THREE.SphereGeometry(0.5, n, Math.max(4, n >> 1), 0, Math.PI * 2, 0, Math.PI / 2), w, h * 2, d, 0)); break;
    case 'sphere': list.push(sized(new THREE.SphereGeometry(0.5, n, Math.max(6, (n * 3) >> 2)), w, h, d, h / 2)); break;
    case 'arch': {
      const ry = Math.min(w / 2, h / 2);
      const bodyH = h - ry;
      list.push(boxGeometry(w, bodyH, d));
      const top = new THREE.CylinderGeometry(1, 1, 1, n).rotateX(Math.PI / 2);
      list.push(sized(top, w / 2, ry, d, bodyH));
      break;
    }
    case 'ring': {
      // Unit torus with a thin tube; x and z scale to the footprint, y scales so the tube is t thick.
      const t = Math.max(0.01, Math.min(h / 2, Math.min(w, d) / 4));
      const tr = Math.min(0.5, t / (Math.min(w, d) / 2));
      const g = new THREE.TorusGeometry(1, tr, 6, Math.max(12, n + 2)).rotateX(Math.PI / 2);
      list.push(sized(g, w / 2 / (1 + tr), t / tr, d / 2 / (1 + tr), t));
      break;
    }
  }
  return list;
}

// ---- grown and weathered shapes -----------------------------------------------------------------------

/** A stable 32-bit seed for one part: the world's seed, where the thing stands (to the centimetre) and which part it is. */
export function partSeed(seed: number, x: number, z: number, index: number): number {
  let h = (seed | 0) ^ Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663) ^ Math.imul(index + 1, 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A small repeatable generator (mulberry32), 0..1. */
function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in three dimensions, 0..1. */
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iy, iz) + (lattice(ix + 1, iy, iz) - lattice(ix, iy, iz)) * fx;
  const b = lattice(ix, iy + 1, iz) + (lattice(ix + 1, iy + 1, iz) - lattice(ix, iy + 1, iz)) * fx;
  const c = lattice(ix, iy, iz + 1) + (lattice(ix + 1, iy, iz + 1) - lattice(ix, iy, iz + 1)) * fx;
  const e = lattice(ix, iy + 1, iz + 1) + (lattice(ix + 1, iy + 1, iz + 1) - lattice(ix, iy + 1, iz + 1)) * fx;
  const lo = a + (b - a) * fy;
  const hi = c + (e - c) * fy;
  return lo + (hi - lo) * fz;
}

/** Shared-vertex triangles: points on a unit shape and the corners of each triangle, wound outward. */
interface Topology { pos: Float32Array; idx: Uint16Array }

/** Joins points that coincide, and turns every triangle of a convex shape about the origin to face outward. */
function weld(points: readonly number[], corners: readonly number[]): Topology {
  const seen = new Map<string, number>();
  const pos: number[] = [];
  const remap: number[] = [];
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i] as number;
    const y = points[i + 1] as number;
    const z = points[i + 2] as number;
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let at = seen.get(key);
    if (at === undefined) {
      at = pos.length / 3;
      seen.set(key, at);
      pos.push(x, y, z);
    }
    remap.push(at);
  }
  const idx: number[] = [];
  for (let i = 0; i < corners.length; i += 3) {
    const a = remap[corners[i] as number] as number;
    let b = remap[corners[i + 1] as number] as number;
    let c = remap[corners[i + 2] as number] as number;
    const ax = pos[a * 3] as number;
    const ay = pos[a * 3 + 1] as number;
    const az = pos[a * 3 + 2] as number;
    const ux = (pos[b * 3] as number) - ax;
    const uy = (pos[b * 3 + 1] as number) - ay;
    const uz = (pos[b * 3 + 2] as number) - az;
    const vx = (pos[c * 3] as number) - ax;
    const vy = (pos[c * 3 + 1] as number) - ay;
    const vz = (pos[c * 3 + 2] as number) - az;
    if ((uy * vz - uz * vy) * ax + (uz * vx - ux * vz) * ay + (ux * vy - uy * vx) * az < 0) [b, c] = [c, b];
    idx.push(a, b, c);
  }
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
}

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_POINTS = [-1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T, 0, 0, -1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T, ICO_T, 0, -1, ICO_T, 0, 1, -ICO_T, 0, -1, -ICO_T, 0, 1];
const ICO_FACES = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];
const balls = new Map<number, Topology>();
const cubes = new Map<number, Topology>();

/** A ball of 20 f² near-equal triangles: an icosahedron with each face divided f ways, pushed out to radius 1. */
function ball(f: number): Topology {
  let t = balls.get(f);
  if (t) return t;
  const points: number[] = [];
  const corners: number[] = [];
  for (let face = 0; face < ICO_FACES.length; face += 3) {
    const [a, b, c] = [ICO_FACES[face] as number, ICO_FACES[face + 1] as number, ICO_FACES[face + 2] as number];
    const first = points.length / 3;
    const row = (i: number): number => first + i * (f + 1) - (i * (i - 1)) / 2;
    for (let i = 0; i <= f; i++) {
      for (let j = 0; j <= f - i; j++) {
        const wa = (f - i - j) / f;
        const wb = i / f;
        const wc = j / f;
        const p = [0, 1, 2].map((k) => (ICO_POINTS[a * 3 + k] as number) * wa + (ICO_POINTS[b * 3 + k] as number) * wb + (ICO_POINTS[c * 3 + k] as number) * wc) as [number, number, number];
        const len = Math.hypot(p[0], p[1], p[2]);
        points.push(p[0] / len, p[1] / len, p[2] / len);
      }
    }
    for (let i = 0; i < f; i++) {
      for (let j = 0; j < f - i; j++) {
        corners.push(row(i) + j, row(i + 1) + j, row(i) + j + 1);
        if (j < f - i - 1) corners.push(row(i + 1) + j, row(i + 1) + j + 1, row(i) + j + 1);
      }
    }
  }
  t = weld(points, corners);
  balls.set(f, t);
  return t;
}

/** The surface of a cube of side 1 about the origin, each face divided into n by n squares. */
function cube(n: number): Topology {
  let t = cubes.get(n);
  if (t) return t;
  const points: number[] = [];
  const corners: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [-0.5, 0.5]) {
      const first = points.length / 3;
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          const p = [0, 0, 0];
          p[axis] = side;
          p[(axis + 1) % 3] = i / n - 0.5;
          p[(axis + 2) % 3] = j / n - 0.5;
          points.push(p[0] as number, p[1] as number, p[2] as number);
        }
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const a = first + i * (n + 1) + j;
          corners.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
        }
      }
    }
  }
  t = weld(points, corners);
  cubes.set(n, t);
  return t;
}

/** Geometry of a grown or weathered part, and how much darker than the tone each of its vertices is. */
export interface Organic { geometry: THREE.BufferGeometry; shade: Float32Array }

/** Stretches points to fill the box w x h x d standing on y = 0, so a shaped part reaches exactly as far as the plain one did. */
function fill(pos: Float32Array, w: number, h: number, d: number): void {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const v = pos[i] as number;
    const k = i % 3;
    if (v < (lo[k] as number)) lo[k] = v;
    if (v > (hi[k] as number)) hi[k] = v;
  }
  const size = [w, h, d];
  const start = [-w / 2, 0, -d / 2];
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    const span = (hi[k] as number) - (lo[k] as number);
    pos[i] = (start[k] as number) + (span > 1e-9 ? (((pos[i] as number) - (lo[k] as number)) / span) * (size[k] as number) : (size[k] as number) / 2);
  }
}

/**
 * Unshares the triangles and gives them normals: one per face (`smooth` false), or the average of the
 * faces round each shared point, so the lumps themselves shade and no facet shows.
 */
function unshare(pos: Float32Array, idx: ArrayLike<number>, shade: Float32Array, smooth: boolean): Organic {
  const n = idx.length;
  const outPos = new Float32Array(n * 3);
  const outNor = new Float32Array(n * 3);
  const outShade = new Float32Array(n);
  const sum = smooth ? new Float32Array(pos.length) : null;
  for (let t = 0; t < n; t += 3) {
    const a = (idx[t] as number) * 3;
    const b = (idx[t + 1] as number) * 3;
    const c = (idx[t + 2] as number) * 3;
    const ux = (pos[b] as number) - (pos[a] as number);
    const uy = (pos[b + 1] as number) - (pos[a + 1] as number);
    const uz = (pos[b + 2] as number) - (pos[a + 2] as number);
    const vx = (pos[c] as number) - (pos[a] as number);
    const vy = (pos[c + 1] as number) - (pos[a + 1] as number);
    const vz = (pos[c + 2] as number) - (pos[a + 2] as number);
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (sum) {
      // Left unnormalised, so a large face counts for more than a sliver.
      for (const v of [a, b, c]) {
        sum[v] = (sum[v] as number) + nx;
        sum[v + 1] = (sum[v + 1] as number) + ny;
        sum[v + 2] = (sum[v + 2] as number) + nz;
      }
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let k = 0; k < 3; k++) {
      const v = (idx[t + k] as number) * 3;
      const o = (t + k) * 3;
      outPos[o] = pos[v] as number;
      outPos[o + 1] = pos[v + 1] as number;
      outPos[o + 2] = pos[v + 2] as number;
      outNor[o] = nx;
      outNor[o + 1] = ny;
      outNor[o + 2] = nz;
      outShade[t + k] = shade[v / 3] as number;
    }
  }
  if (sum) {
    for (let i = 0; i < n; i++) {
      const v = (idx[i] as number) * 3;
      const len = Math.hypot(sum[v] as number, sum[v + 1] as number, sum[v + 2] as number);
      if (len < 1e-12) continue;
      outNor[i * 3] = (sum[v] as number) / len;
      outNor[i * 3 + 1] = (sum[v + 1] as number) / len;
      outNor[i * 3 + 2] = (sum[v + 2] as number) / len;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(outNor, 3));
  return { geometry, shade: outShade };
}

/** A direction drawn evenly from the sphere. */
function anyDirection(rnd: () => number): [number, number, number] {
  const y = 2 * rnd() - 1;
  const a = rnd() * TAU;
  const s = Math.sqrt(Math.max(0, 1 - y * y));
  return [s * Math.cos(a), y, s * Math.sin(a)];
}

/** What a part of a plant or a mineral is shaped as; see growthOf. */
export type Growth = 'leaf' | 'whorl' | 'stem' | 'boulder' | 'rock';

/**
 * Which grown or weathered shape a part of a plant or mineral takes, or null where the plain shape stays:
 * anything thin (a blade, a frond, a fin), anything too small to see the difference on, and the cut and
 * lit things (crystal, glass, lamps, fruit). Sizes in metres.
 */
export function growthOf(nature: 'plant' | 'mineral', shape: PartShape, tone: PartTone, w: number, h: number, d: number): Growth | null {
  const big = Math.max(w, h, d);
  const across = Math.max(w, d);
  if (big < 0.12 || tone === 'glass' || tone === 'glow') return null;
  const lump = Math.min(w, h, d) >= 0.2 * big && Math.min(w, d) >= 0.4 * across;
  const woody = tone === 'wall' || tone === 'wall2' || tone === 'dark';
  if (nature === 'plant') {
    const leafy = tone === 'accent' || tone === 'roof';
    if (shape === 'cylinder') return tone !== 'trim' && across >= 0.08 && h >= 1.2 * across && Math.min(w, d) >= 0.6 * across ? 'stem' : null;
    if (!lump) return null;
    if (leafy && (shape === 'sphere' || shape === 'dome' || shape === 'box')) return 'leaf';
    if (leafy && shape === 'cone') return 'whorl';
    // A burl, a stump or a root ball: wood worn round.
    if (woody && (shape === 'sphere' || shape === 'dome')) return 'boulder';
    return null;
  }
  if (!lump || tone === 'accent') return null;
  if (shape === 'sphere' || shape === 'dome') return 'boulder';
  return shape === 'box' || shape === 'pyramid' || shape === 'cone' || shape === 'wedge' ? 'rock' : null;
}

/**
 * A rounded mass: a leaf clump, or a boulder. Leaves swell into a handful of lobes with hollows between
 * (so the outline is clumped, not a circle); a boulder is a ball with flats broken off it. Either way
 * the surface is then roughened, pressed flat underneath for a dome, and stretched to fill its box.
 */
function mass(kind: 'leaf' | 'boulder', shape: PartShape, w: number, h: number, d: number, seed: number, quality: Quality, grounded: boolean): Organic {
  const big = Math.max(w, h, d);
  const rnd = sequence(seed);
  const boxy = shape === 'box';
  let topo: Topology;
  if (boxy) topo = cube(Math.max(2, (big < 0.5 ? 2 : big < 2.5 ? 3 : 4) - (quality === 0 ? 1 : 0)));
  else topo = ball(Math.max(2, (big < 0.35 ? 2 : big < 0.9 ? 3 : big < 2.2 ? 4 : big < 5 ? 5 : 6) - (quality === 0 ? 1 : 0)));
  const count = topo.pos.length / 3;
  const pos = new Float32Array(topo.pos.length);
  const shade = new Float32Array(count);
  // A small clump is only a little uneven; a crown metres across is deeply lobed. A dome (a cap, a cushion) keeps more of its line.
  const amount = ramp(0.3, 1.8, big) * (shape === 'dome' ? 0.45 : 1);
  const off = rnd() * 61;
  const leaf = kind === 'leaf';
  const n = leaf ? 5 + Math.floor(rnd() * 4) : 4 + Math.floor(rnd() * 4);
  // Each row: a direction, then for a lobe its weight and the cosine of its half-angle, for a flat its distance from the middle.
  const marks: number[] = [];
  for (let k = 0; k < n; k++) {
    const dir = anyDirection(rnd);
    if (leaf) marks.push(dir[0], dir[1], dir[2], 0.78 + 0.22 * rnd(), Math.cos(0.75 + 0.4 * rnd()));
    else marks.push(dir[0], grounded ? Math.abs(dir[1]) : dir[1], dir[2], 0.74 + 0.21 * rnd(), 0);
  }
  // A boulder that stands on the ground has lost its underside: it sits on a flat, not on a point.
  if (!leaf && grounded && shape === 'sphere') marks.push(0, -1, 0, 0.7, 0);
  const low = 0.88 - 0.24 * amount;
  const rough = leaf ? 0.05 + 0.09 * amount : 0.07;
  for (let i = 0; i < count; i++) {
    const px = topo.pos[i * 3] as number;
    const py = topo.pos[i * 3 + 1] as number;
    const pz = topo.pos[i * 3 + 2] as number;
    const len = Math.hypot(px, py, pz);
    const ux = px / len;
    const uy = py / len;
    const uz = pz / len;
    // A box of leaves keeps something of its corners.
    let r = boxy ? (len + (0.62 - len) * 0.55) / 0.62 : 1;
    let swell = 0;
    for (let k = 0; k < marks.length; k += 5) {
      const c = ux * (marks[k] as number) + uy * (marks[k + 1] as number) + uz * (marks[k + 2] as number);
      if (leaf) {
        const cut = marks[k + 4] as number;
        if (c <= cut) continue;
        const t = (c - cut) / (1 - cut);
        swell = Math.max(swell, (marks[k + 3] as number) * Math.sqrt(t * (2 - t)));
      } else if (c > 0.05) {
        r = Math.min(r, (marks[k + 3] as number) / c);
      }
    }
    const grit = noise3(ux * 2.7 + off, uy * 2.7 + off, uz * 2.7 + off);
    if (leaf) r *= low + (1 - low) * swell;
    r *= 1 - rough * grit;
    pos[i * 3] = ux * r;
    pos[i * 3 + 1] = (shape === 'dome' && uy < 0 ? 0.3 : 1) * uy * r;
    pos[i * 3 + 2] = uz * r;
    // Hollows between lobes and pits in the stone hold shadow; what stands proud catches the light.
    shade[i] = leaf ? 0.74 + 0.3 * clamp((swell - 0.2) / 0.8, 0, 1) - 0.1 * grit : 1.05 - 0.2 * grit;
  }
  fill(pos, w, h, d);
  for (let i = 0; i < count; i++) {
    const up = (pos[i * 3 + 1] as number) / h;
    // The underside of a crown is in its own shade; a stone is dark where it meets the ground.
    if (leaf) shade[i] = (shade[i] as number) * (0.62 + 0.38 * ramp(0.05, 0.6, up));
    else if (grounded) shade[i] = (shade[i] as number) * (0.7 + 0.3 * ramp(0, 0.22, up));
  }
  return unshare(pos, topo.idx, shade, true);
}

/**
 * A block of stone: a box with its corners worn back, a few of them broken off along a flat, every face a
 * little out of true. A pyramid or a cone becomes a crag, the same block drawn in toward a blunt top; a
 * wedge becomes a slab that rises to one side. Flat-shaded.
 */
function block(shape: PartShape, w: number, h: number, d: number, seed: number, quality: Quality, grounded: boolean): Organic {
  const big = Math.max(w, h, d);
  const rnd = sequence(seed);
  const topo = cube(Math.max(2, (big < 0.5 ? 2 : big < 2.5 ? 3 : 4) - (quality === 0 ? 1 : 0)));
  const count = topo.pos.length / 3;
  const pos = new Float32Array(topo.pos.length);
  const shade = new Float32Array(count);
  const off = rnd() * 61;
  const flats: number[] = [];
  const n = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    // A flat faces a corner or an edge of the box, never straight down into the ground it stands on.
    let nx = Math.floor(rnd() * 3) - 1;
    let ny = Math.floor(rnd() * 3) - 1;
    const nz = Math.floor(rnd() * 3) - 1;
    if (grounded && ny < 0) ny = 0;
    if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) < 2) {
      nx = nx === 0 ? 1 : nx;
      ny = 1;
    }
    const len = Math.hypot(nx, ny, nz);
    const reach = (0.5 * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz))) / len;
    flats.push(nx / len, ny / len, nz / len, reach * (0.68 + 0.2 * rnd()));
  }
  for (let i = 0; i < count; i++) {
    const px = topo.pos[i * 3] as number;
    const py = topo.pos[i * 3 + 1] as number;
    const pz = topo.pos[i * 3 + 2] as number;
    const len = Math.hypot(px, py, pz);
    const ux = px / len;
    const uy = py / len;
    const uz = pz / len;
    let r = len + (0.62 - len) * 0.2;
    for (let k = 0; k < flats.length; k += 4) {
      const c = ux * (flats[k] as number) + uy * (flats[k + 1] as number) + uz * (flats[k + 2] as number);
      if (c > 0.05) r = Math.min(r, (flats[k + 3] as number) / c);
    }
    const grit = noise3(px * 2.9 + off, py * 2.9 + off, pz * 2.9 + off);
    // The face it stands on stays as it is, so it meets the ground all along.
    if (!(grounded && py < -0.499)) r *= 1 - 0.09 * grit;
    let x = ux * r;
    let y = uy * r;
    let z = uz * r;
    const up = clamp(y + 0.5, 0, 1);
    if (shape === 'pyramid' || shape === 'cone') {
      x *= 1 - 0.78 * up;
      z *= 1 - 0.78 * up;
    } else if (shape === 'wedge') {
      y = -0.5 + up * (0.18 + 0.82 * clamp(x + 0.5, 0, 1));
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    shade[i] = 1.06 - 0.2 * grit;
  }
  fill(pos, w, h, d);
  if (grounded) {
    for (let i = 0; i < count; i++) shade[i] = (shade[i] as number) * (0.7 + 0.3 * ramp(0, 0.2, (pos[i * 3 + 1] as number) / h));
  }
  return unshare(pos, topo.idx, shade, false);
}

/** Rings of points about the vertical axis, joined into a skin; `ends` closes the top (and the bottom) with a fan to a point. */
class Lathe {
  readonly pos: number[] = [];
  readonly shade: number[] = [];
  readonly idx: number[] = [];

  constructor(readonly sides: number) {}

  point(x: number, y: number, z: number, shade: number): number {
    this.pos.push(x, y, z);
    this.shade.push(shade);
    return this.pos.length / 3 - 1;
  }

  /** Joins the ring that starts at point `lower` to the one that starts at `upper`. */
  skin(lower: number, upper: number): void {
    const s = this.sides;
    for (let k = 0; k < s; k++) {
      const n = (k + 1) % s;
      this.idx.push(lower + k, upper + k, lower + n, lower + n, upper + k, upper + n);
    }
  }

  /** A fan from a point to a ring: looking up from it when `up`, down otherwise. */
  fan(ring: number, tip: number, up: boolean): void {
    const s = this.sides;
    for (let k = 0; k < s; k++) {
      const n = (k + 1) % s;
      if (up) this.idx.push(tip, ring + n, ring + k);
      else this.idx.push(tip, ring + k, ring + n);
    }
  }

  /** Copies a ring, so a cap does not share its points (and so its normals) with the side it closes. */
  copy(ring: number, shade: number): number {
    const first = this.pos.length / 3;
    for (let k = 0; k < this.sides; k++) {
      const o = (ring + k) * 3;
      this.point(this.pos[o] as number, this.pos[o + 1] as number, this.pos[o + 2] as number, shade);
    }
    return first;
  }
}

/**
 * A trunk, a stalk or a limb: narrower at the top than at the bottom, bowed a little off the plumb line
 * between its two ends (which stay where they were, so stacked lengths still join), never quite round,
 * and spread into root flares where it leaves the ground. It keeps inside the cylinder it replaces.
 */
function stem(w: number, h: number, d: number, seed: number, quality: Quality, grounded: boolean): Organic {
  const across = Math.max(w, d);
  const rnd = sequence(seed);
  const sides = Math.max(5, (across < 0.12 ? 5 : across < 0.3 ? 7 : across < 0.7 ? 9 : 12) - (quality === 0 ? 2 : 0));
  const levels = grounded ? [0, 0.05, 0.14] : [0];
  const from = levels[levels.length - 1] as number;
  const lengths = clamp(Math.round(h / (1.5 * across)) + 1, 2, 5);
  for (let k = 1; k <= lengths; k++) levels.push(from + ((1 - from) * k) / lengths);
  const lean = rnd() * TAU;
  const bow = 0.02 + 0.04 * rnd();
  const twist = (rnd() - 0.5) * 1.2;
  const off = rnd() * 61;
  const lathe = new Lathe(sides);
  let below = -1;
  let ring = -1;
  for (const t of levels) {
    const sway = bow * Math.sin(Math.PI * t);
    const flare = grounded && t < 0.14 ? (1 - t / 0.14) ** 2 : 0;
    ring = lathe.pos.length / 3;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU + twist * t;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const furrow = noise3(ca * 1.3 + off, (t * h * 0.6) / across, sa * 1.3 + off);
      let r = (0.45 - 0.05 * t) * (1 - 0.12 * furrow);
      // Root flares: some reach the edge of the footprint, some hardly start.
      if (flare > 0) r += Math.max(0, 0.499 - sway - r) * flare * (0.4 + 0.6 * noise3(ca * 2.1 + off, 7.3, sa * 2.1 + off));
      lathe.point((sway * Math.cos(lean) + r * ca) * w, t * h, (sway * Math.sin(lean) + r * sa) * d, (1.06 - 0.22 * furrow) * (grounded ? 0.78 + 0.22 * ramp(0, 0.14, t) : 1));
    }
    if (below >= 0) lathe.skin(below, ring);
    below = ring;
  }
  lathe.fan(lathe.copy(ring, 0.9), lathe.point(0, h, 0, 0.9), true);
  // The foot of a stem that starts in the air shows; one that stands in the ground does not.
  if (!grounded) lathe.fan(lathe.copy(0, 0.8), lathe.point(0, 0, 0, 0.8), false);
  return unshare(new Float32Array(lathe.pos), lathe.idx, new Float32Array(lathe.shade), true);
}

/**
 * A whorl of boughs: a cone whose skirt is cut into hanging tips with gaps between them, hollow and
 * dark underneath, where the plain cone had a flat disc.
 */
function whorl(w: number, h: number, d: number, seed: number, quality: Quality): Organic {
  const across = Math.max(w, d);
  const rnd = sequence(seed);
  const sides = Math.max(7, (across < 0.5 ? 8 : across < 1.5 ? 11 : across < 3.5 ? 14 : 18) - (quality === 0 ? 3 : 0));
  const off = rnd() * 61;
  const turn = rnd() * TAU;
  const lathe = new Lathe(sides);
  let below = -1;
  for (const t of [0, 0.32, 0.66]) {
    const ring = lathe.pos.length / 3;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU + turn;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const bough = ramp(0.25, 0.75, noise3(ca * 2.2 + off, t * 0.9, sa * 2.2 + off));
      const gap = (1 - t) * (1 - t) * (1 - bough);
      const r = 0.5 * (1 - t) ** 0.85 * (1 - 0.36 * gap - 0.05 * (1 - bough));
      lathe.point(r * ca, t + 0.16 * gap, r * sa, (0.62 + 0.4 * t ** 0.7) * (0.84 + 0.2 * bough));
    }
    if (below >= 0) lathe.skin(below, ring);
    below = ring;
  }
  lathe.fan(below, lathe.point(0, 1, 0, 1.05), true);
  lathe.fan(lathe.copy(0, 0.52), lathe.point(0, 0.3, 0, 0.4), false);
  const pos = new Float32Array(lathe.pos);
  fill(pos, w, h, d);
  return unshare(pos, lathe.idx, new Float32Array(lathe.shade), true);
}

/**
 * The geometry of one grown or weathered part: non-indexed, with normals, standing on y = 0 inside the
 * box w x h x d, and the same for the same seed. `grounded` says the part starts at the ground line.
 */
export function organicGeometry(kind: Growth, shape: PartShape, w: number, h: number, d: number, seed: number, quality: Quality, grounded: boolean): Organic {
  switch (kind) {
    case 'leaf': return mass('leaf', shape, w, h, d, seed, quality, grounded);
    case 'boulder': return mass('boulder', shape, w, h, d, seed, quality, grounded);
    case 'rock': return block(shape, w, h, d, seed, quality, grounded);
    case 'whorl': return whorl(w, h, d, seed, quality);
    case 'stem': return stem(w, h, d, seed, quality, grounded);
  }
}

// ---- contact shading ----------------------------------------------------------------------------------

/** A part as a box in the frame of the thing it belongs to: where it stands, how far it reaches, which way it is turned. */
export interface Solid {
  cx: number; cz: number; y0: number; y1: number;
  /** Half its width and depth along its own axes. */
  hw: number; hd: number;
  cos: number; sin: number;
  /** Half the size of the box that holds it on the footprint, whichever way it is turned. */
  ax: number; az: number;
  /** How far below itself it shades what it overhangs, metres; 0 for a part too slight or too bright to. */
  reach: number;
}

/** `grow` widens the footprint, for a roof whose covering sails past the part it is laid on. */
export function solidOf(px: number, pz: number, py: number, pw: number, ph: number, pd: number, rotDeg: number, casts: boolean, grow = 0): Solid {
  const cos = Math.cos((rotDeg * Math.PI) / 180);
  const sin = Math.sin((rotDeg * Math.PI) / 180);
  const hw = pw / 2 + grow;
  const hd = pd / 2 + grow;
  return {
    cx: px, cz: pz, y0: py, y1: py + ph, hw, hd, cos, sin,
    ax: hw * Math.abs(cos) + hd * Math.abs(sin), az: hw * Math.abs(sin) + hd * Math.abs(cos),
    reach: casts && Math.min(pw, pd) >= 0.25 ? clamp(0.6 * Math.min(pw, pd), 0.15, 0.9) : 0,
  };
}

/** What shades a part: the parts that hang over it, and the parts a small one stands on. */
export interface Contact { over: Solid[]; under: Solid[] }

/** How deep under an overhang a point must be for the full shade, and how dark that and a seat are. */
const UNDER = 0.2;
const OVERHANG_SHADE = 0.28;
const SEAT_SHADE = 0.2;

/** The solids that could shade part `i`, or null when none can. */
export function contactsOf(solids: readonly (Solid | null)[], i: number): Contact | null {
  const own = solids[i];
  if (!own) return null;
  const over: Solid[] = [];
  const under: Solid[] = [];
  const seated = own.y0 > 0.05 && own.y1 - own.y0 <= 1.5;
  for (let k = 0; k < solids.length; k++) {
    const o = solids[k];
    if (!o || k === i) continue;
    if (Math.abs(o.cx - own.cx) >= o.ax + own.ax || Math.abs(o.cz - own.cz) >= o.az + own.az) continue;
    if (o.reach > 0 && o.y0 >= own.y0 - 0.03 && o.y0 < own.y1 + o.reach) over.push(o);
    if (seated && o.y1 > own.y0 - 0.08 && o.y1 < own.y0 + 0.25) under.push(o);
  }
  return over.length > 0 || under.length > 0 ? { over, under } : null;
}

/** How far a point on the footprint lies outside a solid's own outline, metres; negative inside it. */
function outside(o: Solid, x: number, z: number): number {
  const rx = x - o.cx;
  const rz = z - o.cz;
  return Math.max(Math.abs(rx * o.cos - rz * o.sin) - o.hw, Math.abs(rx * o.sin + rz * o.cos) - o.hd);
}

/**
 * A shade per vertex of a part's geometry (already in the frame the solids are in): darker the closer it
 * stands under the underside of something that overhangs it, and along its foot where it stands on another
 * part. Two parts stacked flush do not shade each other. `prior` is multiplied in. Returns one number
 * when nothing shades the part.
 */
export function contactShade(g: THREE.BufferGeometry, own: Solid, contact: Contact | null, prior: ArrayLike<number> | number = 1): ArrayLike<number> | number {
  if (!contact) return prior;
  const pos = g.getAttribute('position');
  const out = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let s = 1;
    for (const o of contact.over) {
      const dy = o.y0 - y;
      if (dy < -0.03 || dy >= o.reach) continue;
      const e = outside(o, x, z);
      if (e > -0.02) continue;
      s = Math.min(s, 1 - OVERHANG_SHADE * (1 - Math.max(0, dy) / o.reach) * Math.min(1, (-e - 0.02) / UNDER));
    }
    if (y <= own.y0 + 0.03) {
      for (const o of contact.under) {
        if (outside(o, x, z) < -0.02) s = Math.min(s, 1 - SEAT_SHADE);
      }
    }
    out[i] = s * (typeof prior === 'number' ? prior : prior[i] ?? 1);
  }
  return out;
}
