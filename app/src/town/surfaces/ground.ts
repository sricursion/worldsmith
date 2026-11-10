// Ground surfaces. These cover hundreds of square metres, so each one avoids a single loud feature
// that would read as a repeat: detail comes in two or three scales and the strongest marks fade in
// and out across the tile.
import type { SurfaceDef, TexelFn } from './field';
import { shade, tint } from './field';
import { fbm, lerp, makeCell, ss, vnoise, worley } from './noise';

const W = makeCell();
const W2 = makeCell();
const frac = (x: number): number => x - Math.floor(x);

/** Packed earth: clods at two scales, scattered pebbles, faint wheel ruts that come and go. */
const dirt: TexelFn = (u, v, t, c) => {
  const clod = fbm(u, v, 4, 4, 5, c.seed + 1);
  const fine = fbm(u, v, 64, 64, 3, c.seed + 2);
  worley(u, v, 22, 22, c.seed + 3, 1, W);
  const rad = 0.14 + 0.2 * frac(W.id * 7.31);
  const pebble = W.id > 0.62 ? 1 - ss(rad * 0.6, rad, W.f1) : 0;
  const vv = frac(v + 0.04 * (fbm(u, 0.5, 3, 1, 2, c.seed + 4) - 0.5));
  const rut = (1 - ss(0.02, 0.06, Math.min(Math.abs(vv - 0.3), Math.abs(vv - 0.7))))
    * ss(0.45, 0.65, fbm(u, v, 2, 2, 2, c.seed + 5)) * (0.3 + 0.7 * c.wear);
  shade(t, c, (0.82 + 0.3 * clod + (fine - 0.5) * 0.2) * (1 - 0.04 * rut));
  const stone = 0.7 + 0.5 * frac(W.id * 13.7);
  tint(t, 0.6 * stone, 0.57 * stone, 0.52 * stone, pebble * 0.8);
  t.h = 0.4 + 0.3 * (clod - 0.5) + 0.25 * (fine - 0.5) + 0.35 * pebble - 0.18 * rut;
  t.rough = 0.95 - 0.15 * pebble - 0.1 * rut;
  t.crease = rut * 0.3;
};

/** Sand: wind ripples with a gentle windward face and a steep lee, sparkling grains. */
const sand: TexelFn = (u, v, t, c) => {
  const warp = fbm(u, v, 3, 3, 3, c.seed + 1);
  const p = frac(v * 18 + 2.2 * warp + 0.6 * fbm(u, v, 6, 2, 2, c.seed + 2));
  const prof = p < 0.7 ? p / 0.7 : (1 - p) / 0.3;
  const amp = 0.4 + 0.6 * fbm(u, v, 2, 2, 2, c.seed + 3);
  const grain = vnoise(u, v, 256, 256, c.seed + 4);
  shade(t, c, 0.9 + 0.12 * prof * amp + (grain - 0.5) * 0.1 + 0.08 * (warp - 0.5));
  t.h = 0.3 + 0.4 * prof * amp + 0.1 * warp;
  t.rough = 0.9 - 0.25 * ss(0.93, 0.97, grain);
};

/** Grass seen from standing height: fine blades lying two ways, soft tufts, dry patches, bare soil when worn. */
const grass: TexelFn = (u, v, t, c) => {
  const lay = fbm(u, v, 5, 5, 2, c.seed + 4);
  const bladeA = fbm(u, v, 56, 170, 3, c.seed + 1);
  const bladeB = fbm(u, v, 170, 56, 3, c.seed + 5);
  const blade = lerp(bladeA, bladeB, ss(0.4, 0.6, lay));
  const tuft = fbm(u, v, 22, 22, 3, c.seed + 6);
  const tone = fbm(u, v, 6, 6, 3, c.seed + 2);
  const gap = ss(0.62, 0.8, 1 - tuft) * ss(0.4, 0.7, 1 - blade);
  shade(t, c, (0.74 + 0.5 * tone) * (0.62 + 0.76 * blade) * (0.85 + 0.3 * tuft) * (1 - 0.45 * gap));
  const dry = ss(0.55, 0.75, fbm(u, v, 3, 3, 4, c.seed + 7)) * (0.5 + 0.5 * blade);
  tint(t, t.g * 1.15, t.g, t.b * 0.5, 0.4 * dry);
  const edge = 0.72 - 0.25 * c.wear;
  const soil = ss(edge, edge + 0.08, fbm(u, v, 5, 5, 4, c.seed + 3) + 0.08 * (tuft - 0.5));
  const earth = 0.8 + 0.4 * tuft;
  tint(t, 0.34 * earth, 0.26 * earth, 0.17 * earth, soil * 0.85);
  t.h = lerp(0.2 + 0.45 * tuft + 0.35 * blade - 0.2 * gap, 0.12 + 0.12 * tuft, soil);
  t.rough = 0.9;
  t.crease = gap * 0.4;
};

/** Moss: soft cushions with a fine pile, yellow-green at the tips. */
const moss: TexelFn = (u, v, t, c) => {
  worley(u, v, 9, 9, c.seed, 1, W);
  worley(u, v, 30, 30, c.seed + 1, 1, W2);
  const cushion = 1 - ss(0, 0.75, W.f1);
  const pile = 1 - ss(0, 0.6, W2.f1);
  shade(t, c, (0.7 + 0.3 * cushion + 0.2 * pile) * (0.85 + 0.3 * W.id));
  tint(t, Math.min(1, t.r * 1.3), Math.min(1, t.g * 1.1), t.b * 0.7, pile * 0.3);
  t.h = 0.2 + 0.5 * cushion + 0.25 * pile;
  t.rough = 0.97;
};

/** Snow: drifts and wind crust, blue in the hollows, single crystals flashing in the roughness map. */
const snow: TexelFn = (u, v, t, c) => {
  const drift = fbm(u, v, 3, 3, 4, c.seed + 1);
  const crust = fbm(u, v, 4, 14, 3, c.seed + 2);
  const grain = vnoise(u, v, 256, 256, c.seed + 3);
  const spark = ss(0.972, 0.985, grain);
  shade(t, c, 0.93 + 0.1 * drift + 0.05 * spark);
  tint(t, c.base[0] * 0.78, c.base[1] * 0.87, c.base[2], 0.35 * (1 - ss(0.3, 0.6, drift)));
  t.h = 0.35 + 0.4 * drift + 0.2 * crust + (grain - 0.5) * 0.04;
  t.rough = lerp(0.78, 0.12, spark);
};

/** Mud: churned lumps, hoof and boot pocks, standing water in every low spot. */
const mud: TexelFn = (u, v, t, c) => {
  const lie = fbm(u, v, 4, 4, 5, c.seed + 1);
  const lump = fbm(u, v, 14, 14, 3, c.seed + 2);
  worley(u, v, 10, 10, c.seed + 3, 1, W);
  const pock = W.id > 0.6 ? 1 - ss(0.14, 0.3, W.f1) : 0;
  const rim = W.id > 0.6 ? ss(0.26, 0.34, W.f1) * (1 - ss(0.38, 0.46, W.f1)) : 0;
  const ground = 0.3 + (lie - 0.4) * 1.2 + (lump - 0.5) * 0.3 - 0.3 * pock + 0.12 * rim;
  const pool = 1 - ss(0.3, 0.36, ground);
  shade(t, c, (0.85 + 0.25 * lump) * (1 - 0.3 * pool) * (1 - 0.15 * pock));
  t.h = lerp(ground, 0.3, pool);
  t.rough = lerp(0.5 + 0.3 * lump, 0.08, pool);
  t.crease = pock * 0.3;
};

const span = (x: number, a: number, b: number): number => ss(a, a + 0.006, x) * (1 - ss(b - 0.006, b, x));

/** Asphalt: pale aggregate in dark binder, crazed cracks, squared-off repair patches with tar seams, oil. */
const asphalt: TexelFn = (u, v, t, c) => {
  const agg = vnoise(u, v, 256, 256, c.seed + 1);
  const agg2 = vnoise(u, v, 128, 128, c.seed + 2);
  const cloud = fbm(u, v, 3, 3, 3, c.seed + 3);
  worley(u + 0.05 * (fbm(u, v, 6, 6, 3, c.seed + 7) - 0.5), v + 0.05 * (fbm(u, v, 6, 6, 3, c.seed + 8) - 0.5), 3, 3, c.seed + 4, 1, W);
  const pu = frac(u);
  const pv = frac(v);
  const patch = Math.max(span(pu, 0.12, 0.47) * span(pv, 0.55, 0.83), span(pu, 0.6, 0.9) * span(pv, 0.1, 0.3));
  const tar = patch * (1 - patch) * 4;
  const zone = ss(0.35, 0.6, fbm(u, v, 2, 2, 2, c.seed + 5)) * (0.35 + 0.65 * c.wear);
  const crack = (1 - ss(0.004, 0.012, W.f2 - W.f1)) * zone * (1 - patch);
  const oil = ss(0.66, 0.74, fbm(u, v, 2, 2, 4, c.seed + 6));
  shade(t, c, (0.88 + 0.22 * agg * agg2 + 0.35 * ss(0.9, 0.95, agg) + 0.16 * (cloud - 0.5))
    * (1 - 0.7 * crack) * (1 - 0.12 * patch) * (1 - 0.35 * tar) * (1 - 0.3 * oil));
  t.h = 0.5 + (agg - 0.5) * 0.5 * (1 - 0.3 * patch) + 0.1 * patch + 0.15 * tar - 0.6 * crack;
  t.rough = 0.88 - 0.1 * patch - 0.4 * tar - 0.3 * oil;
  t.crease = crack;
};

/** Gravel: angular stones of mixed greys lying on grit. */
const gravel: TexelFn = (u, v, t, c) => {
  worley(u, v, 26, 26, c.seed, 1, W);
  const e = W.f2 - W.f1;
  const face = ss(0.02, 0.3, e);
  const grit = vnoise(u, v, 256, 256, c.seed + 1);
  shade(t, c, (0.64 + 0.62 * W.id) * (0.72 + 0.28 * face) * (0.94 + 0.12 * grit));
  const warm = frac(W.id * 13.7) - 0.5;
  t.r *= 1 + 0.1 * warm;
  t.b *= 1 - 0.1 * warm;
  t.h = 0.1 + 0.8 * Math.sqrt(face) * (0.6 + 0.4 * frac(W.id * 7.31));
  t.rough = 0.9;
  t.crease = 1 - ss(0, 0.1, e);
};

/** Regolith: fine dust, small impact bowls with raised rims, loose rocks. */
const regolith: TexelFn = (u, v, t, c) => {
  const dust = fbm(u, v, 5, 5, 5, c.seed + 1);
  const fine = fbm(u, v, 80, 80, 2, c.seed + 2);
  worley(u, v, 6, 6, c.seed + 3, 1, W);
  worley(u, v, 30, 30, c.seed + 4, 1, W2);
  let bowl = 0;
  let rim = 0;
  if (W.id > 0.5) {
    const d = W.f1 / (0.18 + 0.25 * frac(W.id * 7.31));
    const q = (d - 1.05) / 0.12;
    bowl = d < 1 ? 1 - d * d : 0;
    rim = Math.exp(-q * q);
  }
  const rock = W2.id > 0.86 ? 1 - ss(0.12, 0.26, W2.f1) : 0;
  shade(t, c, (0.88 + 0.2 * dust + (fine - 0.5) * 0.12) * (1 - 0.12 * bowl) * (1 + 0.08 * rim) * (1 - 0.3 * rock));
  t.h = 0.5 + 0.25 * (dust - 0.5) + 0.1 * (fine - 0.5) - 0.35 * bowl + 0.2 * rim + 0.3 * rock;
  t.rough = 0.96;
};

/** Ash: soft grey fall in thin flakes, pale flecks and scraps of charcoal. */
const ash: TexelFn = (u, v, t, c) => {
  const soft = fbm(u, v, 4, 4, 4, c.seed + 1);
  worley(u, v, 40, 40, c.seed + 2, 1, W);
  worley(u, v, 14, 14, c.seed + 3, 1, W2);
  const char = W2.id > 0.9 ? 1 - ss(0.06, 0.16, W2.f1) : 0;
  const flake = 1 - ss(0.2, 0.5, W.f1);
  shade(t, c, (0.85 + 0.25 * soft) * (0.95 + 0.1 * W.id) + (W.id > 0.93 ? 0.14 * flake : 0));
  tint(t, 0.08, 0.08, 0.08, char * 0.8);
  t.h = 0.45 + 0.3 * (soft - 0.5) + 0.2 * (W.id - 0.5) * flake + 0.3 * char;
  t.rough = 0.97;
};

export const GROUND_SURFACES = {
  dirt: { fn: dirt, scale: 3.0, relief: 0.05, family: 'ground' },
  sand: { fn: sand, scale: 4.0, relief: 0.06, family: 'ground' },
  grass: { fn: grass, scale: 2.5, relief: 0.04, family: 'ground' },
  moss: { fn: moss, scale: 2.0, relief: 0.035, family: 'ground' },
  snow: { fn: snow, scale: 4.0, relief: 0.08, family: 'ground' },
  mud: { fn: mud, scale: 3.0, relief: 0.06, family: 'ground' },
  asphalt: { fn: asphalt, scale: 4.0, relief: 0.02, family: 'ground' },
  gravel: { fn: gravel, scale: 2.0, relief: 0.03, family: 'ground' },
  regolith: { fn: regolith, scale: 4.0, relief: 0.06, family: 'ground' },
  ash: { fn: ash, scale: 3.0, relief: 0.05, family: 'ground' },
} satisfies Record<string, SurfaceDef>;
