// Wall surfaces: wood, render, masonry, metal and glass. Each generator describes one tile as it reads
// at 2 to 30 metres: the unit (board, brick, panel), its joints, its fixings and its own colour scatter.
// Sizes are worked out from the tile scale so a brick course is 8 cm on every building.
import type { SurfaceDef, TexelFn } from './field';
import { mul, shade, tint } from './field';
import { bricks, fbm, hash2, lerp, makeBrick, makeCell, ridged, ss, vnoise, wave, worley } from './noise';

const B = makeBrick();
const W = makeCell();
const frac = (x: number): number => x - Math.floor(x);

/** Horizontal lap siding: 18 cm boards, butt joints, nails at the board ends, the lower edge proud. */
const timber: TexelFn = (u, v, t, c) => {
  bricks(u, v, 2, 12, -1, c.seed, B);
  const grain = fbm(u + B.id * 3.7, v, 6, 96, 3, c.seed + 1);
  const figure = fbm(u + B.id * 1.3, v, 3, 24, 2, c.seed + 2);
  const butt = 1 - ss(0, 0.0025, B.ex);
  const under = ss(0.86, 1, B.fy);
  const endGrain = 1 - ss(0, 0.014, B.ex);
  let k = (0.84 + 0.3 * B.id) * (0.88 + 0.24 * grain) * (0.94 + 0.12 * figure);
  k *= (1 - 0.22 * endGrain) * (1 - 0.7 * butt) * (1 - 0.45 * under);
  shade(t, c, k);
  // Sun-bleached boards go silver where the figure is open.
  const grey = (t.r + t.g + t.b) / 3;
  tint(t, grey * 1.08, grey * 1.05, grey, c.wear * 0.45 * figure);
  const nail = 1 - ss(0.0014, 0.0032, Math.hypot(B.ex - 0.012, Math.min(Math.abs(B.fy - 0.28), Math.abs(B.fy - 0.72)) / 12));
  tint(t, 0.1, 0.09, 0.08, nail * 0.85);
  t.h = 0.75 - 0.5 * B.fy + (grain - 0.5) * 0.14 - 0.5 * butt + 0.08 * nail;
  t.rough = 0.76 + 0.18 * grain;
  t.crease = Math.max(butt, under * 0.6);
};

/** Vertical boards, 20 cm wide, with open gaps, a butt joint per board and the odd knot. */
const planks: TexelFn = (u, v, t, c) => {
  bricks(v, u, 1, 10, -1, c.seed, B);
  const grain = fbm(u, v + B.id * 5.1, 80, 5, 3, c.seed + 1);
  const gap = 1 - ss(0.0018, 0.0055, B.ey);
  const butt = 1 - ss(0, 0.002, B.ex);
  worley(u, v, 5, 3, c.seed + 5, 1, W);
  const knot = W.id > 0.5 ? 1 - ss(0.03, 0.075, Math.hypot(W.dx, W.dy * 0.55)) : 0;
  let k = (0.82 + 0.32 * B.id) * (0.86 + 0.28 * grain);
  k *= (1 - 0.5 * knot) * (1 - 0.8 * gap) * (1 - 0.6 * butt);
  shade(t, c, k);
  const grey = (t.r + t.g + t.b) / 3;
  tint(t, grey * 1.06, grey * 1.04, grey, c.wear * 0.4 * grain);
  t.h = 0.6 + (grain - 0.5) * 0.16 + 0.1 * (wave(B.fy) - 0.5) - 0.6 * gap - 0.3 * butt + 0.1 * knot;
  t.rough = 0.78 + 0.16 * grain;
  t.crease = Math.max(gap, butt);
};

/** Stacked round logs, 30 cm, with clay chinking between them and drying checks along the grain. */
const log: TexelFn = (u, v, t, c) => {
  bricks(u, v, 1, 8, -1, c.seed, B);
  const round = Math.sqrt(Math.max(0, 1 - (2 * B.fy - 1) * (2 * B.fy - 1)));
  const grain = fbm(u + B.id * 2.9, v, 5, 72, 3, c.seed + 1);
  const check = ss(0.86, 0.95, ridged(u + B.id, v, 4, 64, 2, c.seed + 2)) * round;
  const chink = 1 - ss(0.3, 0.5, round);
  const butt = 1 - ss(0, 0.0022, B.ex);
  shade(t, c, (0.84 + 0.28 * B.id) * (0.86 + 0.26 * grain) * (0.72 + 0.28 * round) * (1 - 0.5 * check) * (1 - 0.6 * butt));
  const clay = 0.8 + 0.3 * vnoise(u, v, 90, 90, c.seed + 3);
  tint(t, 0.62 * clay, 0.57 * clay, 0.48 * clay, chink * 0.75);
  t.h = 0.12 + 0.8 * round + (grain - 0.5) * 0.08 - 0.15 * check + 0.12 * chink;
  t.rough = 0.8 + 0.15 * grain;
  t.crease = Math.max(chink * 0.6, check, butt);
};

/** Lime plaster: trowel sweeps, the edge of an old repair, hairline cracks where the wall has moved. */
const plaster: TexelFn = (u, v, t, c) => {
  const trowel = fbm(u, v, 5, 9, 4, c.seed + 1);
  const fine = fbm(u, v, 48, 48, 2, c.seed + 2);
  const patch = ss(0.58, 0.66, fbm(u, v, 3, 3, 3, c.seed + 3));
  const patchEdge = patch * (1 - patch) * 4;
  // Cracks wander: the cell pattern is sampled through a slow warp so no edge runs dead straight.
  const wu = u + 0.035 * (fbm(u, v, 7, 7, 3, c.seed + 6) - 0.5);
  const wv = v + 0.035 * (fbm(u, v, 7, 7, 3, c.seed + 7) - 0.5);
  worley(wu, wv, 4, 4, c.seed + 4, 1, W);
  const zone = ss(0.45, 0.7, fbm(u, v, 2, 2, 2, c.seed + 5)) * (0.3 + 0.7 * c.wear);
  const crack = (1 - ss(0.003, 0.013, W.f2 - W.f1)) * zone * (1 - patch);
  shade(t, c, (0.92 + 0.14 * trowel) * (1 + 0.05 * patch) * (1 - 0.04 * patchEdge) * (1 - 0.55 * crack) + (fine - 0.5) * 0.05);
  t.h = 0.5 + (trowel - 0.5) * 0.5 * (1 - 0.5 * patch) + (fine - 0.5) * 0.14 + 0.08 * patch - 0.5 * crack;
  t.rough = 0.86 + 0.1 * fine;
  t.crease = crack;
};

/** Mud render over sun-dried brick: the courses ghost through, straw and grit show, cracks open as it dries. */
const adobe: TexelFn = (u, v, t, c) => {
  bricks(u, v, 5, 12, 0.5, c.seed, B);
  const course = ss(0, 0.006, Math.min(B.ex, B.ey));
  const lump = fbm(u, v, 6, 6, 4, c.seed + 1);
  const straw = ss(0.8, 0.9, vnoise(u, v, 256, 90, c.seed + 2));
  const grit = ss(0.88, 0.94, vnoise(u, v, 180, 180, c.seed + 3));
  const wu = u + 0.04 * (fbm(u, v, 8, 8, 3, c.seed + 6) - 0.5);
  const wv = v + 0.04 * (fbm(u, v, 8, 8, 3, c.seed + 7) - 0.5);
  worley(wu, wv, 5, 5, c.seed + 4, 1, W);
  const zone = ss(0.4, 0.65, fbm(u, v, 2, 2, 2, c.seed + 5)) * (0.4 + 0.6 * c.wear);
  const crack = (1 - ss(0.004, 0.016, W.f2 - W.f1)) * zone;
  shade(t, c, (0.88 + 0.22 * lump) * (0.97 + 0.03 * course) * (1 - 0.25 * grit) * (1 - 0.55 * crack));
  tint(t, Math.min(1, t.r * 1.25 + 0.08), Math.min(1, t.g * 1.2 + 0.06), t.b * 1.05, straw * 0.4);
  t.h = 0.42 + 0.12 * course + (lump - 0.5) * 0.5 + 0.1 * straw - 0.5 * crack;
  t.rough = 0.92;
  t.crease = crack;
};

/** Running-bond brick: 7.5 cm courses, 10 mm recessed mortar, kiln colour scatter and the odd burnt header. */
const brick: TexelFn = (u, v, t, c) => {
  bricks(u, v, 7, 20, 0.5, c.seed, B);
  const edge = Math.min(B.ex, B.ey);
  const mortar = 1 - ss(0.0032, 0.0062, edge);
  const face = fbm(u + B.id, v, 24, 24, 3, c.seed + 1);
  const pit = ss(0.74, 0.82, vnoise(u, v, 128, 128, c.seed + 2));
  const sand = vnoise(u, v, 200, 200, c.seed + 3);
  const id2 = frac(B.id * 7.31);
  let k = (0.8 + 0.36 * id2) * (0.92 + 0.16 * face) * (1 - 0.16 * pit);
  if (B.id > 0.88) k *= 0.68;
  shade(t, c, k);
  t.r *= 1 + 0.1 * (frac(B.id * 23.17) - 0.5);
  t.b *= 1 - 0.14 * (frac(B.id * 23.17) - 0.5);
  const m = 0.84 + 0.2 * sand;
  tint(t, lerp(c.base[0], 0.72, 0.75) * m, lerp(c.base[1], 0.69, 0.75) * m, lerp(c.base[2], 0.64, 0.75) * m, mortar);
  const round = ss(0.0032, 0.011, edge);
  t.h = lerp(0.45 + 0.3 * round + 0.18 * (face - 0.5) - 0.15 * pit, 0.18 + 0.1 * sand, mortar);
  t.rough = lerp(0.84, 0.96, mortar);
  t.crease = mortar;
};

/** Coursed stone: 40 cm courses of dressed blocks with tooled faces, arrises worn round, deep joints. */
const stone: TexelFn = (u, v, t, c) => {
  bricks(u, v, 4, 6, -1, c.seed, B);
  const edge = Math.min(B.ex, B.ey);
  const joint = 1 - ss(0.0035, 0.0075, edge);
  const round = ss(0.0035, 0.03, edge);
  const tool = fbm(u + B.id * 3, v + B.id, 10, 10, 4, c.seed + 1);
  const speck = vnoise(u, v, 160, 160, c.seed + 2);
  const id2 = frac(B.id * 7.31);
  shade(t, c, (0.8 + 0.34 * id2) * (0.9 + 0.2 * tool) * (0.95 + 0.1 * speck));
  const warm = frac(B.id * 23.17) - 0.5;
  t.r *= 1 + 0.08 * warm;
  t.b *= 1 - 0.1 * warm;
  tint(t, c.base[0] * 0.4 + 0.08, c.base[1] * 0.4 + 0.08, c.base[2] * 0.4 + 0.07, joint);
  t.h = lerp(0.32 + 0.45 * round + (tool - 0.5) * 0.36, 0.08, joint);
  t.rough = lerp(0.82 + 0.1 * speck, 0.97, joint);
  t.crease = joint;
};

/** Cobbles: rounded 25 cm setts, tops polished by traffic, packed earth between. */
const cobble: TexelFn = (u, v, t, c) => {
  worley(u, v, 8, 8, c.seed, 0.8, W);
  const e = W.f2 - W.f1;
  const dome = ss(0.02, 0.45, e);
  const gap = 1 - ss(0.03, 0.1, e);
  const fine = fbm(u, v, 40, 40, 2, c.seed + 1);
  shade(t, c, (0.76 + 0.44 * W.id) * (0.9 + 0.2 * fine));
  const warm = frac(W.id * 17.3) - 0.5;
  t.r *= 1 + 0.08 * warm;
  t.b *= 1 - 0.1 * warm;
  tint(t, c.base[0] * 0.3 + 0.07, c.base[1] * 0.28 + 0.06, c.base[2] * 0.25 + 0.04, gap);
  t.h = 0.08 + 0.8 * Math.sqrt(dome) + (fine - 0.5) * 0.1;
  t.rough = lerp(0.9 - 0.32 * dome, 0.97, gap);
  t.crease = gap;
};

/** Cast concrete: 2 m form panels, tie holes, board lines, blow holes and run-off under every seam. */
const concrete: TexelFn = (u, v, t, c) => {
  bricks(u, v, 2, 3, 0, c.seed, B);
  const cloud = fbm(u, v, 4, 4, 4, c.seed + 1);
  const fine = fbm(u, v, 96, 96, 2, c.seed + 2);
  const seam = 1 - ss(0.0008, 0.0022, Math.min(B.ex, B.ey));
  const board = hash2(Math.floor(frac(v) * 24), 3, c.seed + 3);
  const tie = 1 - ss(0.0024, 0.004, Math.hypot(Math.min(Math.abs(B.fx - 0.12), Math.abs(B.fx - 0.88)) / 2, Math.min(Math.abs(B.fy - 0.2), Math.abs(B.fy - 0.8)) / 3));
  const blow = ss(0.87, 0.91, vnoise(u, v, 200, 200, c.seed + 4));
  const run = ss(0.6, 1, B.fy) * ss(0.45, 0.75, fbm(u, v, 30, 1, 2, c.seed + 5));
  let k = 0.9 + 0.2 * (cloud - 0.5) * 2 * 0.5 + (fine - 0.5) * 0.08 + 0.05 * (board - 0.5);
  k *= (1 - 0.5 * seam) * (1 - 0.75 * tie) * (1 - 0.3 * blow) * (1 - 0.14 * run * (0.5 + c.wear));
  shade(t, c, k);
  t.h = 0.5 + (cloud - 0.5) * 0.2 + (fine - 0.5) * 0.25 + 0.06 * (board - 0.5) - 0.5 * seam - 0.6 * tie - 0.3 * blow;
  t.rough = 0.8 + 0.14 * fine;
  t.crease = Math.max(seam, tie);
};

/** Rivet rows 4 cm in from each edge of a panel; returns 0..1 coverage. */
function rivets(b: typeof B, cols: number, rows: number, per: number, inset: number): number {
  const along = Math.hypot((frac(b.fx * per) - 0.5) / (per * cols), b.ey - inset);
  const up = Math.hypot((frac(b.fy * per) - 0.5) / (per * rows), b.ex - inset);
  return Math.min(along, up);
}

/** Sheet metal cladding: 1.2 m panels, folded seams, rivets, a brushed finish that streaks the highlight. */
const metalPanel: TexelFn = (u, v, t, c) => {
  bricks(u, v, 2, 2, 0, c.seed, B);
  const edge = Math.min(B.ex, B.ey);
  const seam = 1 - ss(0.0015, 0.004, edge);
  const lip = ss(0.004, 0.006, edge) * (1 - ss(0.009, 0.013, edge));
  const r = rivets(B, 2, 2, 8, 0.02);
  const rivet = 1 - ss(0.003, 0.0052, r);
  const ring = ss(0.0052, 0.006, r) * (1 - ss(0.007, 0.009, r));
  const brushed = fbm(u, v, 4, 160, 2, c.seed + 1);
  const can = fbm(u + B.id * 2, v, 3, 3, 2, c.seed + 2);
  shade(t, c, (0.94 + 0.12 * B.id) * (0.93 + 0.14 * brushed) * (1 - 0.6 * seam) * (1 + 0.1 * rivet) * (1 - 0.2 * ring));
  t.h = 0.5 + (can - 0.5) * 0.16 + 0.15 * lip + 0.45 * rivet - 0.4 * seam;
  t.metal = (c.bare ? 0.6 : 0.12) * (1 - seam);
  t.rough = (c.bare ? 0.36 : 0.5) + 0.2 * brushed + 0.3 * seam;
  t.crease = Math.max(seam, ring * 0.5);
};

/** Corrugated sheet: 7.5 cm pitch, sheets lapped side and end, a screw on every other crest. */
const corrugated: TexelFn = (u, v, t, c) => {
  bricks(u, v, 2, 1, 0, c.seed, B);
  const prof = wave(u * 16);
  const side = 1 - ss(0, 0.004, B.ex);
  const lap = 1 - ss(0, 0.012, B.fy);
  const under = ss(0.985, 1, B.fy);
  const screw = 1 - ss(0.004, 0.007, Math.hypot((frac(u * 8) - 0.5) / 8, B.fy - 0.06));
  worley(u, v, 24, 24, c.seed + 1, 1, W);
  const dent = fbm(u, v, 3, 3, 2, c.seed + 2);
  const spangle = c.bare ? 0.12 * (W.id - 0.5) : 0.03 * (W.id - 0.5);
  shade(t, c, (0.82 + 0.2 * prof + spangle) * (0.96 + 0.08 * B.id) * (1 - 0.5 * side) * (1 - 0.55 * under) * (1 - 0.6 * screw));
  t.h = 0.14 + 0.56 * prof + (dent - 0.5) * 0.12 + 0.2 * lap + 0.1 * screw;
  t.metal = c.bare ? 0.6 : 0.12;
  t.rough = (c.bare ? 0.4 : 0.5) + 0.12 * W.id;
  t.crease = Math.max(side, under, screw * 0.5);
};

/** Corroded plate: paint lifting in sheets, scale and pits where it has gone, the rust two-toned. */
const rusted: TexelFn = (u, v, t, c) => {
  bricks(u, v, 2, 2, 0, c.seed, B);
  const big = fbm(u, v, 3, 3, 5, c.seed + 1);
  const mid = fbm(u, v, 12, 12, 4, c.seed + 2);
  const fine = fbm(u, v, 64, 64, 3, c.seed + 3);
  const seam = 1 - ss(0.0012, 0.0035, Math.min(B.ex, B.ey));
  const edge0 = 0.5 - 0.22 * c.wear;
  const rust = Math.max(ss(edge0, edge0 + 0.07, big * 0.65 + mid * 0.35), seam * 0.6);
  const flake = rust * (1 - rust) * 4;
  shade(t, c, (0.9 + 0.16 * mid) * (1 + 0.12 * flake));
  const tone = 0.7 * fine + 0.3 * mid;
  tint(t, lerp(0.2, 0.58, tone) * 0.8 + c.base[0] * 0.2, lerp(0.1, 0.29, tone) * 0.8 + c.base[1] * 0.2, lerp(0.05, 0.11, tone) * 0.8 + c.base[2] * 0.2, rust);
  mul(t, 1 - 0.5 * seam);
  t.h = 0.55 - 0.22 * rust + (fine - 0.5) * 0.35 * rust + 0.2 * flake - 0.3 * seam;
  t.metal = (c.bare ? 0.5 : 0.1) * (1 - rust);
  t.rough = lerp(0.48, 0.93, rust);
  t.crease = Math.max(seam, rust * 0.3);
};

/** Ship or station plating: 1.5 m strakes, raised weld beads, double rivet rows, plates dished between frames. */
const hullPlate: TexelFn = (u, v, t, c) => {
  bricks(u, v, 2, 4, 0.5, c.seed, B);
  const edge = Math.min(B.ex, B.ey);
  const weld = 1 - ss(0.0018, 0.0055, edge);
  const heat = 1 - ss(0.006, 0.022, edge);
  const r = Math.min(rivets(B, 2, 4, 12, 0.013), rivets(B, 2, 4, 12, 0.026));
  const rivet = 1 - ss(0.0022, 0.004, r);
  const dish = fbm(u + B.id * 2, v, 2, 2, 2, c.seed + 1);
  const scuff = ss(0.9, 0.96, ridged(u, v, 3, 120, 2, c.seed + 2));
  const mill = fbm(u, v, 30, 30, 3, c.seed + 3);
  shade(t, c, (0.88 + 0.2 * frac(B.id * 7.31)) * (0.92 + 0.16 * mill) * (1 - 0.14 * heat) * (1 + 0.14 * scuff) * (1 + 0.08 * rivet));
  t.h = 0.42 + (dish - 0.5) * 0.3 * ss(0, 0.1, edge) + 0.35 * weld * (0.7 + 0.3 * wave((B.fx + B.fy) * 40)) + 0.4 * rivet;
  t.metal = c.bare ? 0.6 : 0.15;
  t.rough = (c.bare ? 0.42 : 0.52) + 0.2 * mill - 0.12 * scuff;
  t.crease = Math.max(heat * 0.4, (1 - ss(0.004, 0.0055, r)) * 0.4);
};

/** Curtain wall: 1.5 m panes in dark mullions, each pane graded toward the sky, a few with blinds down. */
const glassCurtain: TexelFn = (u, v, t, c) => {
  bricks(u, v, 2, 2, 0, c.seed, B);
  const edge = Math.min(B.ex, B.ey);
  const frame = 1 - ss(0.008, 0.0092, edge);
  const gasket = ss(0.0092, 0.0098, edge) * (1 - ss(0.011, 0.012, edge));
  const dust = fbm(u, v, 5, 5, 3, c.seed + 1);
  const sky = Math.pow(B.fy, 1.5);
  shade(t, c, (0.6 + 0.5 * sky) * (0.88 + 0.24 * B.id));
  tint(t, 0.62, 0.75, 0.88, 0.22 * sky);
  if (B.id > 0.78) {
    const slat = wave(B.fy * 40);
    tint(t, 0.8 * (0.8 + 0.2 * slat), 0.78 * (0.8 + 0.2 * slat), 0.72 * (0.8 + 0.2 * slat), 0.4);
  }
  mul(t, 1 - 0.7 * gasket);
  tint(t, 0.11 + c.base[0] * 0.12, 0.12 + c.base[1] * 0.12, 0.13 + c.base[2] * 0.12, frame);
  t.h = lerp(0.25, 1, frame) - 0.2 * gasket;
  t.metal = lerp(0.6, 0.5, frame);
  t.rough = lerp(0.05 + 0.1 * dust, 0.42, frame);
  t.crease = gasket;
};

/** A painted face: brush drag in the sheen more than in the colour. */
const paint: TexelFn = (u, v, t, c) => {
  const brush = fbm(u, v, 6, 80, 3, c.seed + 1);
  const sheen = fbm(u, v, 5, 5, 3, c.seed + 2);
  shade(t, c, 0.95 + 0.1 * brush);
  t.h = 0.5 + (brush - 0.5) * 0.4;
  t.rough = 0.42 + 0.26 * sheen;
};

export const WALL_SURFACES = {
  timber: { fn: timber, scale: 2.2, relief: 0.02, family: 'wood' },
  planks: { fn: planks, scale: 2.0, relief: 0.02, family: 'wood' },
  log: { fn: log, scale: 2.4, relief: 0.06, family: 'wood' },
  plaster: { fn: plaster, scale: 3.0, relief: 0.02, family: 'render' },
  adobe: { fn: adobe, scale: 3.0, relief: 0.03, family: 'render' },
  brick: { fn: brick, scale: 1.6, relief: 0.012, family: 'masonry' },
  stone: { fn: stone, scale: 2.4, relief: 0.03, family: 'masonry' },
  cobble: { fn: cobble, scale: 2.0, relief: 0.04, family: 'masonry' },
  concrete: { fn: concrete, scale: 4.0, relief: 0.02, family: 'masonry' },
  metal_panel: { fn: metalPanel, scale: 2.4, relief: 0.012, family: 'metal' },
  corrugated: { fn: corrugated, scale: 1.2, relief: 0.018, family: 'metal' },
  rusted: { fn: rusted, scale: 2.0, relief: 0.02, family: 'metal' },
  hull_plate: { fn: hullPlate, scale: 3.0, relief: 0.02, family: 'metal' },
  glass_curtain: { fn: glassCurtain, scale: 3.0, relief: 0.012, family: 'glass' },
  paint: { fn: paint, scale: 2.0, relief: 0.006, family: 'paint' },
} satisfies Record<string, SurfaceDef>;
