// Roof coverings, cloth and screens, and the grown or crystalline surfaces of stranger worlds.
// Roof tiles are laid with v running up the slope: each course is thickest at its lower (butt) edge and
// the course above casts a shadow line across the top of the one below.
import type { SurfaceDef, TexelFn } from './field';
import { shade, tint } from './field';
import { bricks, fbm, lerp, makeBrick, makeCell, ridged, ss, vnoise, wave, worley } from './noise';

const B = makeBrick();
const W = makeCell();
const W2 = makeCell();
const frac = (x: number): number => x - Math.floor(x);

/** Split wooden shakes: 20 cm exposure, uneven widths, curled butts, silvering with age. */
const shingle: TexelFn = (u, v, t, c) => {
  bricks(u, v, 8, 8, -1, c.seed, B);
  const gap = 1 - ss(0.0014, 0.004, B.ex);
  const under = ss(0.8, 1, B.fy);
  const butt = 1 - ss(0, 0.07, B.fy);
  const grain = fbm(u + B.id * 9, v, 90, 6, 3, c.seed + 1);
  shade(t, c, (0.76 + 0.44 * B.id) * (0.88 + 0.24 * grain) * (1 - 0.5 * under) * (1 - 0.7 * gap) * (1 + 0.1 * butt));
  const grey = (t.r + t.g + t.b) / 3;
  tint(t, grey * 1.05, grey * 1.04, grey, c.wear * 0.5 * frac(B.id * 7.31));
  t.h = 0.22 + (0.5 + 0.2 * frac(B.id * 13.7)) * (1 - B.fy) + (grain - 0.5) * 0.12 - 0.3 * gap;
  t.rough = 0.82 + 0.14 * grain;
  t.crease = Math.max(gap, under * 0.7);
};

/** Clay barrel tiles in straight runs: a rounded crown, a narrow gutter between, each butt casting a crisp shadow. */
const tile: TexelFn = (u, v, t, c) => {
  bricks(u, v, 7, 5, 0, c.seed, B);
  const barrel = Math.sin(Math.PI * B.fx);
  const gutter = 1 - ss(0, 0.07, Math.min(B.fx, 1 - B.fx));
  // The butt of the course above is a barrel end: its shadow dips lowest under the crown.
  const under = ss(0.9 - 0.07 * barrel, 0.96 - 0.07 * barrel, B.fy);
  const lip = (1 - ss(0, 0.05, B.fy)) * barrel;
  const clay = fbm(u + B.id, v, 40, 40, 3, c.seed + 1);
  const fired = fbm(u, v, 5, 5, 2, c.seed + 2);
  shade(t, c, (0.8 + 0.36 * B.id) * (0.88 + 0.2 * clay) * (0.82 + 0.2 * barrel) * (0.94 + 0.12 * fired) * (1 - 0.6 * under) * (1 - 0.55 * gutter) * (1 + 0.12 * lip));
  const warm = frac(B.id * 23.17) - 0.5;
  t.r *= 1 + 0.08 * warm;
  t.b *= 1 - 0.16 * warm;
  t.h = 0.08 + 0.55 * barrel + 0.3 * (1 - B.fy) - 0.25 * under;
  t.rough = 0.78 + 0.14 * clay;
  t.crease = Math.max(gutter * 0.8, under * 0.6);
};

/** Thatch: reed bundles in three ragged layers, every stalk catching light along its length. */
const thatch: TexelFn = (u, v, t, c) => {
  const y = v * 3 + 0.3 * (fbm(u, 0.5, 48, 1, 2, c.seed + 1) - 0.5);
  const fy = frac(y);
  const strand = fbm(u, v, 160, 3, 2, c.seed + 2);
  const stalk = vnoise(u, v, 256, 8, c.seed + 3);
  const under = ss(0.78, 1, fy);
  shade(t, c, (0.72 + 0.56 * strand) * (0.9 + 0.2 * stalk) * (1 - 0.55 * under));
  t.h = 0.18 + 0.55 * (1 - fy) + 0.3 * (strand - 0.5);
  t.rough = 0.95;
  t.crease = under * 0.6;
};

/** Slate: thin crisp courses on a half bond, cleft faces, a purple-to-green drift and broken corners. */
const slate: TexelFn = (u, v, t, c) => {
  bricks(u, v, 6, 8, 0.5, c.seed, B);
  const gap = 1 - ss(0.001, 0.003, B.ex);
  const under = ss(0.9, 1, B.fy);
  const cleft = fbm(u + B.id, v + B.id * 3, 8, 8, 3, c.seed + 1);
  const broken = frac(B.id * 13.7) > 0.8 ? 1 - ss(0.16, 0.2, B.fx + B.fy * 0.8) : 0;
  shade(t, c, (0.8 + 0.34 * B.id) * (0.92 + 0.16 * cleft) * (1 - 0.55 * under) * (1 - 0.65 * gap) * (1 - 0.5 * broken));
  const hue = frac(B.id * 7.31) - 0.5;
  t.r *= 1 + 0.1 * hue;
  t.g *= 1 - 0.06 * hue;
  t.h = 0.3 + 0.45 * (1 - B.fy) + (cleft - 0.5) * 0.16 - 0.3 * gap - 0.3 * broken;
  t.rough = 0.55 + 0.25 * cleft;
  t.crease = Math.max(gap, under * 0.7, broken * 0.5);
};

/** Canvas: a plain weave you can count, slubs in the yarn, a stitched seam and soft fold shading. */
const canvas: TexelFn = (u, v, t, c) => {
  const wu = wave(u * 96);
  const wv = wave(v * 96);
  const over = (Math.floor(u * 96) + Math.floor(v * 96)) & 1;
  const weave = over ? wu * (0.5 + 0.5 * wv) : wv * (0.5 + 0.5 * wu);
  const slub = fbm(u, v, 4, 120, 2, c.seed + 1);
  const fold = fbm(u, v, 2, 3, 3, c.seed + 2);
  const d = Math.abs(frac(u) - 0.5);
  const seam = 1 - ss(0.006, 0.008, d);
  const stitch = (1 - ss(0.001, 0.002, Math.abs(d - 0.004))) * (wave(v * 48) > 0.3 ? 1 : 0);
  shade(t, c, (0.84 + 0.2 * weave) * (0.94 + 0.12 * slub) * (0.9 + 0.2 * fold) * (1 - 0.35 * stitch));
  // The cloth hangs in soft folds a centimetre deep; the weave is a fraction of that.
  t.h = 0.12 + 0.16 * weave + 0.55 * fold + 0.08 * seam + 0.08 * stitch;
  t.rough = 0.94;
  t.crease = stitch * 0.5;
};

/** Paper screen: a 30 by 45 cm lattice of dark wooden bars over fibrous paper that glows unevenly. */
const paperScreen: TexelFn = (u, v, t, c) => {
  bricks(u, v, 6, 4, 0, c.seed, B);
  const edge = Math.min(B.ex, B.ey);
  const bar = 1 - ss(0.0042, 0.0052, edge);
  const glue = (1 - ss(0.0052, 0.012, edge)) * (1 - bar);
  const fibre = fbm(u, v, 64, 64, 3, c.seed + 1);
  const thread = ss(0.9, 0.96, ridged(u, v, 20, 20, 2, c.seed + 2));
  shade(t, c, (0.93 + 0.1 * fibre + 0.06 * thread) * (0.95 + 0.08 * B.id) * (1 - 0.1 * glue));
  const grain = 0.8 + 0.4 * fbm(u, v, 12, 90, 2, c.seed + 3);
  tint(t, (0.17 + c.base[0] * 0.08) * grain, (0.11 + c.base[1] * 0.08) * grain, (0.07 + c.base[2] * 0.08) * grain, bar);
  t.h = lerp(0.2 + 0.05 * fibre, 1, bar);
  t.rough = lerp(0.9, 0.6, bar);
  t.crease = glue * 0.4;
};

/** Grown tissue: swollen lobes, raised veins where they meet, pores, a damp sheen. */
const organic: TexelFn = (u, v, t, c) => {
  worley(u, v, 5, 5, c.seed, 1, W);
  worley(u, v, 28, 28, c.seed + 1, 1, W2);
  const lobe = 1 - ss(0, 0.9, W.f1);
  const vein = 1 - ss(0.01, 0.055, W.f2 - W.f1);
  const pore = W2.id > 0.7 ? 1 - ss(0.06, 0.2, W2.f1) : 0;
  const skin = fbm(u, v, 20, 20, 3, c.seed + 2);
  shade(t, c, (0.8 + 0.32 * lobe) * (0.92 + 0.16 * skin) * (1 - 0.3 * pore));
  tint(t, c.base[0] * 0.55 + 0.12, c.base[1] * 0.45, c.base[2] * 0.5 + 0.04, vein * 0.6);
  t.h = 0.28 + 0.45 * lobe + 0.2 * vein - 0.22 * pore + (skin - 0.5) * 0.1;
  t.rough = 0.42 + 0.22 * skin;
  t.crease = pore;
};

/** Bark: long plates split by deep furrows that run up the trunk, fibrous faces, lichen. */
const bark: TexelFn = (u, v, t, c) => {
  const bend = 0.05 * (fbm(u, v, 4, 4, 2, c.seed + 1) - 0.5);
  worley(u + bend, v, 10, 3, c.seed + 2, 1, W);
  const e = W.f2 - W.f1;
  const furrow = 1 - ss(0.02, 0.16, e);
  const fibre = fbm(u, v, 90, 8, 3, c.seed + 3);
  const plate = ss(0.1, 0.5, e);
  shade(t, c, (0.8 + 0.34 * W.id) * (1 - 0.62 * furrow) * (0.86 + 0.28 * fibre));
  const lichen = ss(0.68, 0.74, fbm(u, v, 9, 9, 3, c.seed + 5)) * (1 - furrow);
  tint(t, 0.58, 0.63, 0.5, lichen * 0.3);
  t.h = 0.25 + 0.5 * plate + 0.15 * W.id + (fibre - 0.5) * 0.25 - 0.2 * furrow;
  t.rough = 0.95;
  t.crease = furrow;
};

/** Chitin: overlapping armour scales with a keel down each, glossy, the colour shifting across the plate. */
const chitin: TexelFn = (u, v, t, c) => {
  bricks(u, v, 6, 8, 0.5, c.seed, B);
  const cx = 2 * B.fx - 1;
  const y0 = 0.42 * cx * cx;
  const on = B.fy >= y0;
  const along = on ? (B.fy - y0) / (1 - y0) : 0;
  const lip = on ? 1 - ss(0, 0.1, along) : 0;
  const keel = 1 - ss(0, 0.09, Math.abs(cx));
  const sheen = fbm(u, v, 24, 24, 3, c.seed + 1);
  shade(t, c, (0.8 + 0.32 * B.id) * (on ? 0.9 + 0.14 * lip : 0.45) * (0.94 + 0.12 * sheen));
  tint(t, c.base[2], c.base[0], c.base[1], on ? 0.28 * along : 0);
  t.h = on ? 0.35 + 0.5 * (1 - along) + 0.1 * keel : 0.12 + 0.15 * (y0 > 0 ? B.fy / y0 : 0);
  t.rough = 0.2 + 0.16 * sheen;
  t.metal = 0.15;
  t.crease = on ? 0 : 0.7;
};

/** Crystal: flat facets at different tilts, bright arrises, each face its own depth of colour. */
const crystal: TexelFn = (u, v, t, c) => {
  worley(u, v, 6, 6, c.seed, 1, W);
  worley(u, v, 15, 15, c.seed + 1, 1, W2);
  const ax = Math.cos(W.id * 40);
  const ay = Math.sin(W.id * 40);
  const bx = Math.cos(W2.id * 40);
  const by = Math.sin(W2.id * 40);
  const slope = W.dx * ax + W.dy * ay;
  const arris = 1 - ss(0, 0.035, W.f2 - W.f1);
  const frost = fbm(u, v, 30, 30, 2, c.seed + 2);
  shade(t, c, (0.68 + 0.5 * W.id + 0.25 * slope) * (1 + 0.3 * arris));
  tint(t, 1, 1, 1, 0.16 * frac(W.id * 7.31) + 0.25 * arris);
  t.h = 0.5 + 0.45 * slope + 0.14 * (W2.dx * bx + W2.dy * by);
  t.rough = 0.08 + 0.12 * frost;
  t.metal = 0.2;
};

/** Ice: clear and dark where it is deep, white along fractures, frosted where snow has stuck. */
const ice: TexelFn = (u, v, t, c) => {
  const swell = fbm(u, v, 3, 3, 4, c.seed + 1);
  worley(u + 0.05 * (fbm(u, v, 6, 6, 3, c.seed + 7) - 0.5), v + 0.05 * (fbm(u, v, 6, 6, 3, c.seed + 8) - 0.5), 3, 3, c.seed + 2, 1, W);
  const crack = 1 - ss(0.003, 0.012, W.f2 - W.f1);
  const veil = ss(0.88, 0.96, ridged(u, v, 5, 5, 3, c.seed + 3));
  const bubble = ss(0.9, 0.94, vnoise(u, v, 160, 160, c.seed + 4));
  const frost = ss(0.5, 0.75, fbm(u, v, 6, 6, 4, c.seed + 5));
  const rime = vnoise(u, v, 200, 200, c.seed + 6);
  shade(t, c, 0.82 + 0.28 * swell);
  tint(t, 0.95, 0.97, 1, Math.min(1, 0.6 * crack + 0.22 * veil + 0.3 * bubble));
  tint(t, 0.92, 0.95, 1, 0.5 * frost);
  t.h = 0.4 + 0.3 * swell - 0.3 * crack + frost * (0.08 + 0.2 * (rime - 0.5));
  t.rough = lerp(0.07, 0.6, frost) + 0.2 * crack;
  t.crease = crack * 0.5;
};

/** Coral: a lumpy colony pitted with polyp cups, each with a pale rim. */
const coral: TexelFn = (u, v, t, c) => {
  const lump = fbm(u, v, 4, 4, 3, c.seed + 1);
  worley(u, v, 22, 22, c.seed, 0.9, W);
  const cup = 1 - ss(0.12, 0.38, W.f1);
  const rim = ss(0.3, 0.4, W.f1) * (1 - ss(0.44, 0.52, W.f1));
  shade(t, c, (0.84 + 0.3 * lump) * (1 - 0.45 * cup) * (1 + 0.12 * rim));
  const hue = W.id - 0.5;
  t.r *= 1 + 0.12 * hue;
  t.b *= 1 - 0.12 * hue;
  t.h = 0.35 + 0.4 * lump + 0.15 * rim - 0.3 * cup;
  t.rough = 0.85;
  t.crease = cup;
};

export const COVER_SURFACES = {
  shingle: { fn: shingle, scale: 1.6, relief: 0.03, family: 'roof' },
  tile: { fn: tile, scale: 1.4, relief: 0.05, family: 'roof' },
  thatch: { fn: thatch, scale: 1.6, relief: 0.05, family: 'roof' },
  slate: { fn: slate, scale: 1.6, relief: 0.024, family: 'roof' },
  canvas: { fn: canvas, scale: 1.0, relief: 0.012, family: 'fabric' },
  paper_screen: { fn: paperScreen, scale: 1.8, relief: 0.01, family: 'fabric' },
  organic: { fn: organic, scale: 2.5, relief: 0.04, family: 'organic' },
  bark: { fn: bark, scale: 1.5, relief: 0.05, family: 'wood' },
  chitin: { fn: chitin, scale: 2.0, relief: 0.025, family: 'organic' },
  crystal: { fn: crystal, scale: 2.0, relief: 0.06, family: 'mineral' },
  ice: { fn: ice, scale: 3.0, relief: 0.045, family: 'mineral' },
  coral: { fn: coral, scale: 1.8, relief: 0.03, family: 'organic' },
} satisfies Record<string, SurfaceDef>;
