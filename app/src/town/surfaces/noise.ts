// Tileable noise for the surface generators. Everything here is periodic on the unit square when the
// period arguments are integers, so a texture built from these wraps without a seam. Pure functions,
// no allocation per call: worley and bricks write into a caller-owned scratch object.

export const sat = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function ss(a: number, b: number, x: number): number {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const TAU = Math.PI * 2;
export const wave = (x: number): number => 0.5 - 0.5 * Math.cos(TAU * x);

/** Integer lattice hash to [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Value noise in [0, 1], periodic with `px` lattice cells across u and `py` across v. */
export function vnoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px;
  const y = v * py;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(ix, px);
  const x1 = wrap(ix + 1, px);
  const y0 = wrap(iy, py);
  const y1 = wrap(iy + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal value noise in [0, 1]; each octave doubles both periods and halves the amplitude. */
export function fbm(u: number, v: number, px: number, py: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u, v, px << o, py << o, seed + o * 131);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged fractal noise in [0, 1]: sharp crests where the octaves cross their midline. */
export function ridged(u: number, v: number, px: number, py: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(2 * vnoise(u, v, px << o, py << o, seed + o * 173) - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

export interface Cell {
  /** Distance to the nearest and second nearest feature point, in cell units. */
  f1: number;
  f2: number;
  /** Stable random value in [0, 1) for the nearest cell. */
  id: number;
  /** Vector from the nearest feature point to the sample, in cell units. */
  dx: number;
  dy: number;
}

export const makeCell = (): Cell => ({ f1: 0, f2: 0, id: 0, dx: 0, dy: 0 });

/** Worley noise with `cx` by `cy` wrapped cells. `jitter` 0 gives a grid, 1 fully random points. */
export function worley(u: number, v: number, cx: number, cy: number, seed: number, jitter: number, out: Cell): void {
  const x = u * cx;
  const y = v * cy;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let bx = 0;
  let by = 0;
  let bdx = 0;
  let bdy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = wrap(ix + i, cx);
      const gy = wrap(iy + j, cy);
      const dx = x - (ix + i + 0.5 + (hash2(gx, gy, seed) - 0.5) * jitter);
      const dy = y - (iy + j + 0.5 + (hash2(gx, gy, seed + 57) - 0.5) * jitter);
      const d = dx * dx + dy * dy;
      if (d < f1) {
        f2 = f1;
        f1 = d;
        bx = gx;
        by = gy;
        bdx = dx;
        bdy = dy;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.f1 = Math.sqrt(f1);
  out.f2 = Math.sqrt(f2);
  out.id = hash2(bx, by, seed + 91);
  out.dx = bdx;
  out.dy = bdy;
}

export interface Brick {
  /** Stable random value in [0, 1) for this brick. */
  id: number;
  /** Position inside the brick, 0..1 along and across. */
  fx: number;
  fy: number;
  /** Distance to the nearest edge along u and along v, as a fraction of the tile. */
  ex: number;
  ey: number;
  row: number;
}

export const makeBrick = (): Brick => ({ id: 0, fx: 0, fy: 0, ex: 0, ey: 0, row: 0 });

/**
 * Running-bond layout: `rows` courses of `cols` units. `stagger` shifts odd rows by that fraction of a
 * unit (rows must be even to tile); a negative stagger gives every row its own random shift instead.
 */
export function bricks(u: number, v: number, cols: number, rows: number, stagger: number, seed: number, out: Brick): void {
  const y = v * rows;
  const row = wrap(Math.floor(y), rows);
  const shift = stagger < 0 ? hash2(row, 7, seed + 11) : (row & 1) * stagger;
  const x = u * cols + shift;
  const col = Math.floor(x);
  out.fx = x - col;
  out.fy = y - Math.floor(y);
  out.row = row;
  out.id = hash2(wrap(col, cols), row, seed);
  out.ex = Math.min(out.fx, 1 - out.fx) / cols;
  out.ey = Math.min(out.fy, 1 - out.fy) / rows;
}
