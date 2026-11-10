// The pixel side of the surface library: a generator fills one texel at a time (height, colour,
// roughness, metalness, crease), then a shared weathering pass applies wear and wetness and the result
// is packed into three RGBA byte arrays: albedo (sRGB), tangent-space normal (linear, +Y up in v) and
// a data map (R height, G roughness, B metalness). Nothing here touches the DOM or three.js.
//
// After the generator has run, three passes work on the whole tile, on typed arrays: cavity shading
// (texels lying below their surroundings are darkened and roughened, the way a joint or a valley sits
// in its own shadow; proud arrises are rubbed paler as the surface wears), the normal map from the
// height field, and a fine grain in the normal that keeps a highlight from lying dead flat.
import { fbm, hash2, sat, ss, vnoise } from './noise';

/** One texel while it is being generated. Colours are sRGB 0..1. */
export interface Texel {
  /** Relief, 0 deepest .. 1 proudest. */
  h: number;
  r: number;
  g: number;
  b: number;
  rough: number;
  metal: number;
  /** 0..1: how much this texel is a joint, gap or pit, where dirt and moss collect. */
  crease: number;
}

export interface GenCtx {
  seed: number;
  /** Base colour, sRGB 0..1. */
  base: readonly [number, number, number];
  wear: number;
  wet: number;
  /** True when the base colour is close to grey, which metal kinds read as bare (unpainted) metal. */
  bare: boolean;
}

/** `u` runs right, `v` runs up, both in [0, 1). */
export type TexelFn = (u: number, v: number, t: Texel, c: GenCtx) => void;

export type SurfaceFamily = 'wood' | 'masonry' | 'render' | 'metal' | 'glass' | 'roof' | 'fabric' | 'organic' | 'mineral' | 'ground' | 'paint';

export interface SurfaceDef {
  fn: TexelFn;
  /** Metres covered by one tile. */
  scale: number;
  /** Depth of the relief in metres between height 0 and height 1. */
  relief: number;
  family: SurfaceFamily;
  /** 0..1: how dark the hollows of the relief are drawn. Default by family. */
  cavity?: number;
  /** Strength of the fine grain added to the normal map, as a slope. Default by family. */
  micro?: number;
}

export interface SurfacePixels {
  size: number;
  /** RGBA, sRGB colour, row 0 is v = 0. */
  albedo: Uint8ClampedArray;
  /** RGBA, tangent-space normal. */
  normal: Uint8ClampedArray;
  /** RGBA: R height, G roughness, B metalness. */
  data: Uint8ClampedArray;
}

export interface RenderOpts { size: number; wear: number; wet: number; seed: number }

/** Sets the texel colour to the base colour times `k`. */
export function shade(t: Texel, c: GenCtx, k: number): void {
  t.r = c.base[0] * k;
  t.g = c.base[1] * k;
  t.b = c.base[2] * k;
}

/** Moves the texel colour toward (r, g, b) by `a`. */
export function tint(t: Texel, r: number, g: number, b: number, a: number): void {
  t.r += (r - t.r) * a;
  t.g += (g - t.g) * a;
  t.b += (b - t.b) * a;
}

/** Scales the texel colour. */
export function mul(t: Texel, k: number): void {
  t.r *= k;
  t.g *= k;
  t.b *= k;
}

const RUST: readonly [number, number, number] = [0.4, 0.2, 0.09];
const RUST_DARK: readonly [number, number, number] = [0.2, 0.105, 0.06];
const MOSS: readonly [number, number, number] = [0.2, 0.27, 0.1];
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** How strongly each family takes each kind of weathering. */
interface Weather { stain: number; streak: number; moss: number; chip: number; rust: number; soak: number }
const WEATHER: Record<SurfaceFamily, Weather> = {
  wood: { stain: 0.3, streak: 0.22, moss: 0.5, chip: 0, rust: 0, soak: 0.4 },
  masonry: { stain: 0.3, streak: 0.25, moss: 0.8, chip: 0, rust: 0, soak: 0.35 },
  render: { stain: 0.35, streak: 0.3, moss: 0.4, chip: 0.6, rust: 0, soak: 0.35 },
  metal: { stain: 0.2, streak: 0.5, moss: 0, chip: 0.7, rust: 1, soak: 0.1 },
  glass: { stain: 0.12, streak: 0.2, moss: 0, chip: 0, rust: 0, soak: 0.03 },
  roof: { stain: 0.3, streak: 0.2, moss: 0.9, chip: 0, rust: 0, soak: 0.3 },
  fabric: { stain: 0.4, streak: 0.3, moss: 0, chip: 0, rust: 0, soak: 0.45 },
  organic: { stain: 0.2, streak: 0.1, moss: 0.3, chip: 0, rust: 0, soak: 0.2 },
  mineral: { stain: 0.15, streak: 0.1, moss: 0, chip: 0, rust: 0, soak: 0.08 },
  ground: { stain: 0.25, streak: 0, moss: 0, chip: 0, rust: 0, soak: 0.45 },
  paint: { stain: 0.25, streak: 0.25, moss: 0, chip: 1, rust: 0, soak: 0.15 },
};

/** A scalar field sampled on a coarse grid that wraps in both directions. */
interface Grid { w: number; h: number; data: Float32Array }

function makeGrid(w: number, h: number, f: (u: number, v: number) => number): Grid {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x / w, y / h);
  return { w, h, data };
}

/** Bilinear read of a grid at (u, v), wrapping. */
function gridAt(g: Grid, u: number, v: number): number {
  const x = u * g.w;
  const y = v * g.h;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let x0 = ix % g.w;
  if (x0 < 0) x0 += g.w;
  let y0 = iy % g.h;
  if (y0 < 0) y0 += g.h;
  const r0 = y0 * g.w;
  const r1 = (y0 + 1 === g.h ? 0 : y0 + 1) * g.w;
  const x1 = x0 + 1 === g.w ? 0 : x0 + 1;
  const d = g.data;
  const a = d[r0 + x0] as number;
  const b = d[r0 + x1] as number;
  const e = d[r1 + x0] as number;
  return a + (b - a) * fx + (e - a) * fy + (a - b - e + (d[r1 + x1] as number)) * fx * fy;
}

/**
 * The slow fields of the weathering pass for one tile. They vary over many texels, so a whole-tile
 * render reads them from coarse grids instead of summing octaves of noise at every texel; a single
 * texel (sampleSurface) computes them directly.
 */
interface Fields {
  size: number;
  blot: Grid;
  chip: Grid | null;
  /** Length of the rust run under a patch, per texel column. */
  trail: Float32Array | null;
  run: Grid | null;
  grow: Grid | null;
}

const blotAt = (u: number, v: number, seed: number): number => fbm(u, v, 3, 3, 3, seed + 901);
const chipAt = (u: number, v: number, seed: number): number => fbm(u, v, 7, 7, 4, seed + 911);
const trailAt = (u: number, seed: number): number => 0.02 + 0.14 * vnoise(u, 0.5, 64, 1, seed + 919) * vnoise(u, 0.5, 9, 1, seed + 923);
const runAt = (u: number, v: number, seed: number): number => fbm(u, v, 40, 2, 3, seed + 907);
const growAt = (u: number, v: number, seed: number): number => fbm(u, v, 5, 5, 4, seed + 917);

function makeFields(size: number, c: GenCtx, w: Weather): Fields | null {
  if (!(c.wear > 0) || size < 64) return null;
  const seed = c.seed;
  const chipped = w.chip > 0 && c.wear > 0.15;
  let trail: Float32Array | null = null;
  if (chipped && w.rust > 0) {
    trail = new Float32Array(size);
    for (let x = 0; x < size; x++) trail[x] = trailAt((x + 0.5) / size, seed);
  }
  return {
    size, trail,
    blot: makeGrid(size >> 2, size >> 2, (u, v) => blotAt(u, v, seed)),
    chip: chipped ? makeGrid(size >> 1, size >> 1, (u, v) => chipAt(u, v, seed)) : null,
    // Streaks are fine across the sheet and long down it.
    run: w.streak > 0 ? makeGrid(size, size >> 3, (u, v) => runAt(u, v, seed)) : null,
    grow: w.moss > 0 && c.wear > 0.3 ? makeGrid(size >> 1, size >> 1, (u, v) => growAt(u, v, seed)) : null,
  };
}

function weather(u: number, v: number, t: Texel, c: GenCtx, w: Weather, f: Fields | null): void {
  const wear = c.wear;
  if (wear > 0) {
    // Broad uneven staining, and dirt packed into every joint. Where dust has settled the surface is matte.
    const blot = f ? gridAt(f.blot, u, v) : blotAt(u, v, c.seed);
    const dust = ss(0.35, 0.75, blot);
    mul(t, 1 - wear * w.stain * dust);
    t.rough += (1 - t.rough) * 0.3 * wear * dust;
    mul(t, 1 - t.crease * (0.1 + 0.35 * wear));
    // Paint and render failing in patches: the coat is gone, the substrate shows a step lower. On metal
    // the patches run down the sheet, the way rust does.
    let chipNear = 0;
    if (w.chip > 0 && wear > 0.15) {
      let chip = f?.chip ? gridAt(f.chip, u, v) : chipAt(u, v, c.seed);
      if (w.rust > 0) {
        // The same patches again, slid down the sheet by a length that changes from column to column and
        // a little weaker: each patch keeps its upper edge and trails ragged runs beneath it.
        const len = f?.trail ? (f.trail[(u * f.size) | 0] ?? 0.02) : trailAt(u, c.seed);
        const trail = (f?.chip ? gridAt(f.chip, u, v + len) : chipAt(u, v + len, c.seed)) - 0.012;
        if (trail > chip) chip = trail;
      }
      // On metal only small patches are drawn into the tile: a big one would be seen again at every
      // repeat, so the large patches of rust are laid in world space by the surface shader instead.
      const edge = w.rust > 0 ? 0.9 - 0.13 * wear : 0.8 - 0.3 * wear * w.chip;
      const m = ss(edge, edge + 0.025, chip);
      chipNear = ss(edge - 0.16, edge, chip);
      if (m > 0) {
        if (w.rust > 0) {
          // Two-toned: dark scale in the middle of a patch, an orange bloom at its rim.
          const k = 0.75 + 0.5 * vnoise(u, v, 96, 96, c.seed + 913);
          const core = ss(edge + 0.02, edge + 0.09, chip);
          tint(t, mix(RUST[0], RUST_DARK[0], core) * k, mix(RUST[1], RUST_DARK[1], core) * k, mix(RUST[2], RUST_DARK[2], core) * k, m);
          t.metal *= 1 - m;
          t.rough += (0.92 - t.rough) * m;
        } else {
          const l = (t.r + t.g + t.b) / 3;
          const grit = 0.9 + 0.2 * vnoise(u, v, 112, 112, c.seed + 913);
          tint(t, (l * 0.78 + 0.06) * grit, (l * 0.7 + 0.05) * grit, (l * 0.62 + 0.04) * grit, m);
          t.rough += (0.95 - t.rough) * m;
        }
        t.h -= 0.22 * m;
        t.crease = Math.max(t.crease, m * (1 - m) * 4 * 0.6);
      }
    }
    // Run-off: narrow streaks that follow gravity (down v), strongest where the blotches are and, on
    // metal, around every rusting patch. Wet streaks shine; dry ones are a matte deposit.
    if (w.streak > 0) {
      const run = f?.run ? gridAt(f.run, u, v) : runAt(u, v, c.seed);
      const where = w.rust > 0 ? Math.max(ss(0.25, 0.6, blot) * 0.6, chipNear) : ss(0.25, 0.6, blot);
      const m = ss(0.58, 0.82, run) * where * wear * w.streak;
      if (w.rust > 0) {
        tint(t, RUST[0], RUST[1], RUST[2], m * 1.3 > 0.85 ? 0.85 : m * 1.3);
        t.rough += (0.85 - t.rough) * m;
        t.metal *= 1 - m;
      } else {
        mul(t, 1 - 0.6 * m);
        t.rough += c.wet > 0.05 ? -0.35 * m * t.rough : 0.1 * m;
      }
    }
    // Moss and algae where water sits.
    if (w.moss > 0 && wear > 0.3) {
      const grow = f?.grow ? gridAt(f.grow, u, v) : growAt(u, v, c.seed);
      const m = sat((t.crease * 0.8 + ss(0.55, 0.8, grow) * 0.7) * ss(0.45, 0.7, grow) * ((wear - 0.3) / 0.7) * w.moss);
      if (m > 0) {
        const k = 0.8 + 0.5 * grow;
        tint(t, MOSS[0] * k, MOSS[1] * k, MOSS[2] * k, m);
        t.rough += (0.95 - t.rough) * m;
        t.h += 0.06 * m;
      }
    }
  }
  if (c.wet > 0) {
    // Water darkens porous surfaces and fills the low relief first.
    const pool = c.wet * (0.55 + 0.45 * (1 - sat(t.h)));
    mul(t, 1 - w.soak * pool);
    const gloss = Math.max(0.07, t.rough * 0.3);
    t.rough += (gloss - t.rough) * pool * (0.55 + 0.45 * (1 - w.soak));
  }
}

const SCRATCH: Texel = { h: 0, r: 0, g: 0, b: 0, rough: 0, metal: 0, crease: 0 };

function context(base: readonly [number, number, number], opts: { wear: number; wet: number; seed: number }): GenCtx {
  const hi = Math.max(base[0], base[1], base[2]);
  const lo = Math.min(base[0], base[1], base[2]);
  return { seed: opts.seed | 0, base, wear: sat(opts.wear), wet: sat(opts.wet), bare: hi - lo < 0.12 };
}

function texel(def: SurfaceDef, u: number, v: number, t: Texel, ctx: GenCtx, fields: Fields | null): void {
  t.h = 0.5;
  t.r = ctx.base[0];
  t.g = ctx.base[1];
  t.b = ctx.base[2];
  t.rough = 0.8;
  t.metal = 0;
  t.crease = 0;
  def.fn(u, v, t, ctx);
  if (ctx.wear > 0 || ctx.wet > 0) weather(u, v, t, ctx, WEATHER[def.family], fields);
}

/** One weathered texel at any (u, v), including outside the unit square. Used to check that a surface repeats. */
export function sampleSurface(def: SurfaceDef, base: readonly [number, number, number], u: number, v: number, opts: { wear: number; wet: number; seed: number }): Texel {
  const t: Texel = { h: 0, r: 0, g: 0, b: 0, rough: 0, metal: 0, crease: 0 };
  texel(def, u, v, t, context(base, opts), null);
  return t;
}

/** Darkness of hollows, strength of the normal grain and how far proud edges rub pale, by family. */
const FINISH: Record<SurfaceFamily, { cavity: number; micro: number; rub: number }> = {
  wood: { cavity: 0.55, micro: 0.09, rub: 0.1 },
  masonry: { cavity: 0.6, micro: 0.13, rub: 0.14 },
  render: { cavity: 0.5, micro: 0.12, rub: 0.08 },
  metal: { cavity: 0.5, micro: 0.045, rub: 0.2 },
  glass: { cavity: 0.3, micro: 0.008, rub: 0 },
  roof: { cavity: 0.6, micro: 0.1, rub: 0.1 },
  fabric: { cavity: 0.35, micro: 0.04, rub: 0 },
  organic: { cavity: 0.5, micro: 0.03, rub: 0 },
  mineral: { cavity: 0.3, micro: 0.015, rub: 0 },
  ground: { cavity: 0.45, micro: 0.1, rub: 0 },
  paint: { cavity: 0.3, micro: 0.05, rub: 0.15 },
};

/** Steepest slope a normal may take: keeps z above 0.3 so a texel never faces along the wall. */
const MAX_SLOPE = 3;

// Scratch fields for the blurred height, kept between renders of the same size.
let fieldSize = 0;
let fieldH = new Float32Array(0);
let fieldA = new Float32Array(0);
let fieldB = new Float32Array(0);

/** A render in progress: rows are generated over any number of calls, then finished once. */
export interface SurfaceJob {
  readonly size: number;
  /** Rows generated so far. */
  rows: number;
  readonly pixels: SurfacePixels;
  readonly def: SurfaceDef;
  readonly ctx: GenCtx;
  readonly height: Float32Array;
  /** Coarse weathering fields, made when the first rows are generated. */
  fields?: Fields | null;
}

export function beginSurface(def: SurfaceDef, base: readonly [number, number, number], opts: RenderOpts): SurfaceJob {
  const size = opts.size;
  const n = size * size;
  return {
    size, rows: 0, def, ctx: context(base, opts), height: new Float32Array(n),
    pixels: { size, albedo: new Uint8ClampedArray(n * 4), normal: new Uint8ClampedArray(n * 4), data: new Uint8ClampedArray(n * 4) },
  };
}

/** Generates up to `count` more rows; returns true while rows remain. */
export function stepSurface(job: SurfaceJob, count: number): boolean {
  const { size, def, ctx, height } = job;
  const { albedo, data } = job.pixels;
  const t = SCRATCH;
  if (job.fields === undefined) job.fields = makeFields(size, ctx, WEATHER[def.family]);
  const fields = job.fields;
  const end = Math.min(size, job.rows + count);
  for (let y = job.rows; y < end; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      texel(def, (x + 0.5) / size, v, t, ctx, fields);
      const i = y * size + x;
      const o = i * 4;
      const h = t.h < 0 ? 0 : t.h > 1 ? 1 : t.h;
      height[i] = h;
      albedo[o] = t.r * 255;
      albedo[o + 1] = t.g * 255;
      albedo[o + 2] = t.b * 255;
      albedo[o + 3] = 255;
      data[o] = h * 255;
      data[o + 1] = sat(t.rough) * 255;
      data[o + 2] = sat(t.metal) * 255;
      data[o + 3] = 255;
    }
  }
  job.rows = end;
  return end < size;
}

/** One wrapped box blur of radius `r` along x, written transposed, so two calls blur both ways. */
function blurT(src: Float32Array, dst: Float32Array, size: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + ((k + size) % size)] as number;
    for (let x = 0; x < size; x++) {
      dst[x * size + y] = sum * inv;
      const add = x + r + 1;
      const drop = x - r;
      sum += (src[row + (add >= size ? add - size : add)] as number) - (src[row + (drop < 0 ? drop + size : drop)] as number);
    }
  }
}

/** Cavity shading, the normal map and its grain. Call once, after the last row. */
export function finishSurface(job: SurfaceJob): SurfacePixels {
  const { size, def, ctx, height } = job;
  const { albedo, normal, data } = job.pixels;
  const n = size * size;
  if (fieldSize !== size) {
    fieldSize = size;
    fieldH = new Float32Array(n);
    fieldA = new Float32Array(n);
    fieldB = new Float32Array(n);
  }
  const fin = FINISH[def.family];
  const cavity = def.cavity ?? fin.cavity;
  const micro = def.micro ?? fin.micro;
  const rub = fin.rub * ctx.wear;
  // Mean height of the neighbourhood: two box passes each way, a few percent of the tile wide.
  const r = Math.max(1, Math.round(size / 80));
  blurT(height, fieldA, size, r);
  blurT(fieldA, fieldB, size, r);
  blurT(fieldB, fieldA, size, r);
  blurT(fieldA, fieldH, size, r);
  const gain = 5.5;
  // Shading the hollows must not shift the tile's overall colour away from the one asked for: the
  // mean darkening is measured first and given back to every texel (within reason).
  let shadeSum = 0;
  for (let i = 0; i < n; i++) {
    const d = ((fieldH[i] as number) - (height[i] as number)) * gain;
    if (d > 0) shadeSum += cavity * (d > 1 ? 1 : d);
  }
  const lift = Math.min(1.3, 1 / (1 - shadeSum / n));
  for (let i = 0; i < n; i++) {
    const d = (fieldH[i] as number) - (height[i] as number);
    const o = i * 4;
    if (d > 0) {
      const c = d * gain > 1 ? 1 : d * gain;
      const k = (1 - cavity * c) * lift;
      albedo[o] = (albedo[o] as number) * k;
      albedo[o + 1] = (albedo[o + 1] as number) * k;
      albedo[o + 2] = (albedo[o + 2] as number) * k;
      data[o + 1] = (data[o + 1] as number) + (255 - (data[o + 1] as number)) * 0.35 * c;
    } else {
      // Proud arrises wear first: the colour lifts toward a paler, greyer version of itself.
      const e = -d * gain * 1.4 > 1 ? 1 : -d * gain * 1.4;
      const a = rub * e;
      const r0 = (albedo[o] as number) * lift;
      const g0 = (albedo[o + 1] as number) * lift;
      const b0 = (albedo[o + 2] as number) * lift;
      const grey = ((r0 + g0 + b0) / 3) * 1.25 + 14;
      albedo[o] = r0 + (grey - r0) * a;
      albedo[o + 1] = g0 + (grey - g0) * a;
      albedo[o + 2] = b0 + (grey - b0) * a;
    }
  }
  // Normal from the height field with a wrapped Sobel kernel. Slope = relief / texel size, both in metres.
  const k = (def.relief / (def.scale / size)) / 8;
  // The grain is specified at 512 texels; a 256 map carries half the slope so both look alike.
  const grain = micro * (size / 512);
  const seed = ctx.seed + 4099;
  for (let y = 0; y < size; y++) {
    const ym = ((y + size - 1) % size) * size;
    const yc = y * size;
    const yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x + size - 1) % size;
      const xp = (x + 1) % size;
      const gx = (height[ym + xp] as number) + 2 * (height[yc + xp] as number) + (height[yp + xp] as number)
        - (height[ym + xm] as number) - 2 * (height[yc + xm] as number) - (height[yp + xm] as number);
      const gy = (height[yp + xm] as number) + 2 * (height[yp + x] as number) + (height[yp + xp] as number)
        - (height[ym + xm] as number) - 2 * (height[ym + x] as number) - (height[ym + xp] as number);
      let nx = -gx * k + (hash2(x, y, seed) - 0.5) * grain;
      let ny = -gy * k + (hash2(x, y, seed + 1) - 0.5) * grain;
      const steep = nx * nx + ny * ny;
      if (steep > MAX_SLOPE * MAX_SLOPE) {
        const f = MAX_SLOPE / Math.sqrt(steep);
        nx *= f;
        ny *= f;
      }
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (yc + x) * 4;
      normal[o] = (nx * inv * 0.5 + 0.5) * 255;
      normal[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      normal[o + 2] = (inv * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
    }
  }
  return job.pixels;
}

/** Runs a generator over a size x size tile and packs albedo, normal and data maps. */
export function renderSurface(def: SurfaceDef, base: readonly [number, number, number], opts: RenderOpts): SurfacePixels {
  const job = beginSurface(def, base, opts);
  stepSurface(job, opts.size);
  return finishSurface(job);
}

/** Parses "#rrggbb" to sRGB 0..1; anything else gives mid grey. */
export function hexToRgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return [0.5, 0.5, 0.5];
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
