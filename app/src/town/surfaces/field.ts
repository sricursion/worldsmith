// The pixel side of the surface library: a generator fills one texel at a time (height, colour,
// roughness, metalness, crease), then a shared weathering pass applies wear and wetness and the result
// is packed into three RGBA byte arrays: albedo (sRGB), tangent-space normal (linear, +Y up in v) and
// a data map (R height, G roughness, B metalness). Nothing here touches the DOM or three.js.
import { fbm, sat, ss } from './noise';

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

const RUST: readonly [number, number, number] = [0.42, 0.2, 0.09];
const MOSS: readonly [number, number, number] = [0.2, 0.27, 0.1];

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

function weather(u: number, v: number, t: Texel, c: GenCtx, w: Weather): void {
  const wear = c.wear;
  if (wear > 0) {
    // Broad uneven staining, and dirt packed into every joint.
    const blot = fbm(u, v, 3, 3, 3, c.seed + 901);
    mul(t, 1 - wear * w.stain * ss(0.35, 0.75, blot));
    mul(t, 1 - t.crease * (0.1 + 0.35 * wear));
    // Run-off: narrow streaks that follow gravity (down v), strongest where the blotches are.
    if (w.streak > 0) {
      const run = fbm(u, v, 40, 2, 3, c.seed + 907);
      const m = ss(0.6, 0.82, run) * ss(0.25, 0.6, blot) * wear * w.streak;
      if (w.rust > 0) {
        tint(t, RUST[0], RUST[1], RUST[2], m * 1.4 > 1 ? 1 : m * 1.4);
        t.rough += (0.85 - t.rough) * m;
        t.metal *= 1 - m;
      } else {
        mul(t, 1 - 0.6 * m);
      }
    }
    // Paint and render failing in patches: the coat is gone, the substrate shows a step lower.
    if (w.chip > 0 && wear > 0.15) {
      const chip = fbm(u, v, 7, 7, 5, c.seed + 911);
      const edge = 0.8 - 0.3 * wear * w.chip;
      const m = ss(edge, edge + 0.025, chip);
      if (m > 0) {
        if (w.rust > 0) {
          const k = 0.7 + 0.6 * fbm(u, v, 48, 48, 2, c.seed + 913);
          tint(t, RUST[0] * k, RUST[1] * k, RUST[2] * k, m);
          t.metal *= 1 - m;
          t.rough += (0.9 - t.rough) * m;
        } else {
          const l = (t.r + t.g + t.b) / 3;
          const grit = 0.9 + 0.2 * fbm(u, v, 56, 56, 2, c.seed + 913);
          tint(t, (l * 0.78 + 0.06) * grit, (l * 0.7 + 0.05) * grit, (l * 0.62 + 0.04) * grit, m);
          t.rough += (0.95 - t.rough) * m;
        }
        t.h -= 0.18 * m;
        t.crease = Math.max(t.crease, m * (1 - m) * 4 * 0.6);
      }
    }
    // Moss and algae where water sits.
    if (w.moss > 0 && wear > 0.3) {
      const grow = fbm(u, v, 5, 5, 4, c.seed + 917);
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

function texel(def: SurfaceDef, u: number, v: number, t: Texel, ctx: GenCtx): void {
  t.h = 0.5;
  t.r = ctx.base[0];
  t.g = ctx.base[1];
  t.b = ctx.base[2];
  t.rough = 0.8;
  t.metal = 0;
  t.crease = 0;
  def.fn(u, v, t, ctx);
  if (ctx.wear > 0 || ctx.wet > 0) weather(u, v, t, ctx, WEATHER[def.family]);
}

/** One weathered texel at any (u, v), including outside the unit square. Used to check that a surface repeats. */
export function sampleSurface(def: SurfaceDef, base: readonly [number, number, number], u: number, v: number, opts: { wear: number; wet: number; seed: number }): Texel {
  const t: Texel = { h: 0, r: 0, g: 0, b: 0, rough: 0, metal: 0, crease: 0 };
  texel(def, u, v, t, context(base, opts));
  return t;
}

/** Runs a generator over a size x size tile and packs albedo, normal and data maps. */
export function renderSurface(def: SurfaceDef, base: readonly [number, number, number], opts: RenderOpts): SurfacePixels {
  const size = opts.size;
  const n = size * size;
  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const data = new Uint8ClampedArray(n * 4);
  const height = new Float32Array(n);
  const ctx = context(base, opts);
  const t = SCRATCH;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      texel(def, u, v, t, ctx);
      const i = y * size + x;
      const o = i * 4;
      const h = sat(t.h);
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
  // Normal from the height field with a wrapped Sobel kernel. Slope = relief / texel size, both in metres.
  const k = (def.relief / (def.scale / size)) / 8;
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
      const nx = -gx * k;
      const ny = -gy * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (yc + x) * 4;
      normal[o] = (nx * inv * 0.5 + 0.5) * 255;
      normal[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      normal[o + 2] = (inv * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
    }
  }
  return { size, albedo, normal, data };
}

/** Parses "#rrggbb" to sRGB 0..1; anything else gives mid grey. */
export function hexToRgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return [0.5, 0.5, 0.5];
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
