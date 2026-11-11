// What lies on the ground: dead wood, single boulders and crystal clusters. Heights are in footprint units.
// Tones: wall2 wood and stone, accent moss, glass crystal, roof bracket fungus,
// glow only when the glow dial is above 0.
import type { PartTone } from '../spec';
import { arch, box, C, clamp, cone, dome, lerp, N, num, pyr, skel, sph, str, int, wedge } from './util';
import { blade, fin, GOLD, ORIGIN, Parts, polar, outward, TAU } from './nature-util';

const rad = (deg: number): number => (deg * Math.PI) / 180;

export const deadwood = skel(
  'deadwood', 'nature', 'Dead wood on the ground: fallen log, stump, upturned root plate, driftwood or a bare ribcage.',
  ['fallen log', 'stump', 'driftwood', 'ribcage', 'petrified wood', 'root wad'],
  [
    C('form', ['log', 'stump', 'rootwad', 'driftwood', 'ribs'], 'log', 'what it is'),
    N('size', 0.4, 1.4, 1, 'length or extent'),
    N('girth', 0.08, 0.5, 0.22, 'thickness'),
    N('branches', 0, 5, 2, 'stubs, roots, prongs or rib pairs'),
    N('moss', 0, 1, 0.3, 'moss and bracket fungus'),
    N('glow', 0, 1, 0, 'glowing growth'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const size = num(d, 'size');
    const g = num(d, 'girth');
    const br = int(d, 'branches');
    const moss = num(d, 'moss');
    const glow = num(d, 'glow');
    const out = new Parts();
    const rot = rng.range(0, 180);
    // A lying trunk is an arch part: its round top runs along local z, so `u` is the direction it lies in.
    const u = { x: Math.sin(rad(rot)), z: Math.cos(rad(rot)) };
    const v = { x: Math.cos(rad(rot)), z: -Math.sin(rad(rot)) };
    const along = (t: number, side = 0): { x: number; z: number } => ({ x: u.x * t + v.x * side, z: u.z * t + v.z * side });
    const a0 = rng.range(0, TAU);
    const mossy = (c: { x: number; z: number }, y: number, w: number, dd: number): void => {
      if (moss > 0.1) out.extra(dome(c.x, c.z, y, w, dd, Math.max(0.05, w * 0.18), 'accent', { rot }));
    };
    const lit = (c: { x: number; z: number }, y: number, gap: number, turn = rot - 90): void => {
      if (glow > 0) out.extra(sph(c.x, c.z, y, 0.05, 0.05, 0.05, 'glow', { rot: turn, repeat: 2 + Math.round(glow * 2), gap }));
    };

    if (form === 'log' || form === 'rootwad') {
      const wad = form === 'rootwad';
      const len = Math.min(size, wad ? 0.9 : 1.4);
      const centre = wad ? along(-0.08) : ORIGIN;
      out.add(arch(centre.x, centre.z, 0, g, len, g, 'wall2', { rot }));
      if (wad) {
        // The root plate stands on edge at one end, with roots reaching off it and soil still held under it.
        const plate = clamp(g * 3.2, 0.3, 0.9);
        const end = along(-0.08 + len / 2);
        out.add(sph(end.x, end.z, 0, plate, Math.max(0.05, g * 0.45), plate * 0.9, 'wall2', { rot }));
        out.add(sph(end.x, end.z, 0, plate * 0.7, Math.max(0.08, g * 0.9), Math.max(0.05, plate * 0.3), 'wall', { rot }));
        for (let i = 0; i < 2 + Math.min(br, 3); i++) {
          const side = i % 2 === 0 ? 1 : -1;
          const base = { x: end.x + v.x * side * plate * 0.15, z: end.z + v.z * side * plate * 0.15 };
          const a = Math.atan2(v.z * side, v.x * side);
          out.add(blade(base, a, plate * rng.range(0.25, 0.5), plate * rng.range(0.3, 0.5), 0.04, plate * rng.range(0.3, 0.5), 'wall2'));
        }
        out.add(cone(end.x, end.z, plate * 0.6, 0.06, 0.06, plate * 0.5, 'wall2'));
      } else {
        // A broken length beside it and stubs where branches snapped off.
        const side = along(len * 0.2, Math.min(0.3, g * 0.9));
        out.add(arch(side.x, side.z, 0, Math.max(0.04, g * 0.45), len * 0.5, Math.max(0.05, g * 0.45), 'wall2', { rot: rot + rng.range(15, 40) }));
        const knot = along(-len * 0.3);
        out.add(sph(knot.x, knot.z, g * 0.4, g * 0.9, g * 0.9, Math.max(0.05, g * 0.75), 'wall2'));
      }
      for (let i = 0; i < br; i++) {
        const t = len * lerp(-0.38, 0.3, br > 1 ? i / (br - 1) : 0.5);
        const c = along(t, (i % 2 === 0 ? 1 : -1) * g * 0.1);
        out.add(blade(c, a0 + i * GOLD, g * 0.5, g * rng.range(0.6, 1.2), Math.max(0.03, g * 0.3), Math.min(g * rng.range(1, 2.2), 0.14 + g * 0.7), 'wall2'));
      }
      mossy(along(len * 0.1), g * 0.85, g * 0.9, Math.min(1.4, len * 0.4));
      if (moss > 0.6) {
        const c = along(-len * 0.15, g * 0.45);
        out.extra(dome(c.x, c.z, g * 0.35, g * 0.6, g * 0.5, 0.05, 'roof', { rot, repeat: 2, gap: 0.01 }));
      }
      lit(along(0), g * 0.95, len * 0.25);
      out.extra(sph(v.x * g * 1.2, v.z * g * 1.2, 0, 0.09, 0.07, 0.05, 'wall2', { rot: rot - 90, repeat: 3, gap: len * 0.3 }));
      return out.list;
    }

    if (form === 'stump') {
      const w = clamp(g * 2.2, 0.2, 0.9);
      const h = size * 0.45;
      out.add(cone(0, 0, 0, w * 1.5, w * 1.4, Math.max(0.05, h * 0.5), 'wall2'));
      out.add(box(0, 0, 0, w * 0.74, w * 0.7, h, 'wall2', { rot }), box(0, 0, 0, w * 0.74, w * 0.7, h * 0.96, 'wall2', { rot: rot + 45 }));
      const roots = clamp(br + 2, 3, 6);
      for (let i = 0; i < roots; i++) {
        const a = a0 + (i * TAU) / roots + rng.range(-0.2, 0.2);
        out.add(fin(polar(ORIGIN, a, w * 0.3), a, 0, Math.min(0.45, w * rng.range(0.5, 0.9)), Math.max(0.03, w * 0.18), h * rng.range(0.4, 0.7), 'wall2'));
      }
      // The break is never clean: splinters stand up from one side of the top.
      for (let i = 0; i < 2; i++) {
        const a = a0 + 1 + i * 1.3;
        out.add(blade(polar(ORIGIN, a, w * 0.1), a, h * 0.95, w * 0.2, Math.max(0.03, w * 0.22), h * rng.range(0.3, 0.7), 'wall2'));
      }
      mossy(polar(ORIGIN, a0 + 3.5, w * 0.12), h * 0.95, w * 0.6, w * 0.5);
      if (moss > 0.6) {
        const c = polar(ORIGIN, a0 + 2.6, w * 0.36);
        out.extra(dome(c.x, c.z, h * 0.45, w * 0.45, w * 0.35, 0.05, 'roof', { rot: outward(a0 + 2.6) }));
      }
      lit(ORIGIN, h * 0.9, w * 0.25);
      return out.list;
    }

    if (form === 'driftwood') {
      // Smooth worn lengths lying across each other, with prongs reaching up.
      const pieces = 2 + (br > 2 ? 1 : 0);
      for (let i = 0; i < pieces; i++) {
        const c = i === 0 ? ORIGIN : polar(ORIGIN, a0 + i * 2.1, 0.12);
        const len = Math.min(1.4, size * (i === 0 ? 1 : rng.range(0.5, 0.75)));
        const gg = g * (i === 0 ? 0.75 : 0.5);
        out.add(sph(c.x, c.z, i === 0 ? 0 : gg * 0.3, len, Math.max(0.03, gg), Math.max(0.05, gg), 'wall2', { rot: rot + i * 65 }));
      }
      for (let i = 0; i <= br; i++) {
        const t = size * lerp(-0.22, 0.22, br > 0 ? i / br : 0.5);
        const c = { x: v.x * t, z: v.z * t };
        out.add(blade(c, a0 + i * GOLD, g * 0.2, Math.min(0.14, g * rng.range(0.4, 0.8)), Math.max(0.03, g * 0.22), Math.min(g * rng.range(1, 2.4), 0.12 + g * 0.9), 'wall2'));
      }
      mossy(ORIGIN, g * 0.5, g * 0.8, g * 0.6);
      lit(ORIGIN, g * 0.6, size * 0.2, rot);
      out.extra(sph(u.x * 0.3, u.z * 0.3, 0, 0.1, 0.08, 0.05, 'wall2', { rot, repeat: 2, gap: size * 0.4 }));
      return out.list;
    }

    // Ribs: a spine on the ground with pairs of curved ribs standing off it.
    const len = Math.min(size, 1);
    const sg = Math.max(0.05, g * 0.5);
    out.add(sph(0, 0, 0, len, sg, sg, 'wall2', { rot: rot - 90 }));
    const pairs = clamp(br + 2, 3, 6);
    out.add(sph(0, 0, sg * 0.6, sg * 0.9, sg * 0.9, Math.max(0.05, sg * 0.7), 'wall2', { rot: rot - 90, repeat: pairs, gap: (len * 0.7) / (pairs - 1) }));
    const ribH = clamp(g * 2.6, 0.2, 1.1);
    for (let i = 0; i < pairs; i++) {
      const t = len * lerp(-0.35, 0.35, i / (pairs - 1));
      const k = 1 - 0.5 * Math.pow((2 * i) / (pairs - 1) - 1, 2);
      for (const side of [1, -1]) {
        const off = Math.min(0.3, ribH * 0.42 * k);
        const lean = Math.min(off, ribH * 0.4 * k);
        const base = along(t, side * off);
        // A rib rises from the ground outside the spine and curves in over it.
        out.add(blade(base, Math.atan2(-v.z * side, -v.x * side), 0, lean, Math.max(0.03, sg * 0.5), ribH * k * rng.range(0.9, 1.05), 'wall2'));
      }
    }
    const headEnd = along(len * 0.48);
    out.extra(sph(headEnd.x, headEnd.z, 0, sg * 2.4, sg * 1.8, sg * 1.6, 'wall2', { rot: rot - 90 }));
    mossy(along(-len * 0.2), sg * 0.7, sg * 1.5, sg * 1.2);
    lit(ORIGIN, sg * 0.9, len * 0.2);
    return out.list;
  },
);

export const boulder = skel(
  'boulder', 'nature', 'One large stone, rounded or faceted, low or standing, with rubble at its foot.',
  ['erratic boulder', 'standing stone', 'meteorite', 'ice block', 'termite mound', 'sea stack'],
  [
    N('height', 0.3, 3, 0.8, 'height'),
    N('width', 0.4, 1.2, 0.9, 'width'),
    N('angular', 0, 1, 0.4, '0 rounded, 1 sharp facets'),
    N('scatter', 0, 1, 0.4, 'rubble at the foot'),
    N('split', 0, 1, 0, 'cleft into two'),
    N('moss', 0, 1, 0.2, 'moss or snow cap'),
    N('glow', 0, 1, 0, 'glowing seams'),
  ],
  (d, rng) => {
    const H = num(d, 'height');
    const W = num(d, 'width');
    const ang = num(d, 'angular');
    const scatter = num(d, 'scatter');
    const split = num(d, 'split');
    const moss = num(d, 'moss');
    const glow = num(d, 'glow');
    const out = new Parts();
    const r0 = rng.range(0, 90);
    const a0 = rng.range(0, TAU);
    const cleft = split > 0.3;
    // A cleft stone is two unequal halves standing a little apart.
    const shift = cleft ? W * 0.14 : 0;
    const o = polar(ORIGIN, a0, -shift);
    const w = cleft ? W * 0.72 : W;
    let capY = H * 0.82;
    let capW = w * 0.5;

    if (ang < 0.35) {
      // Rounded: one mass swollen by smaller lobes of differing size.
      out.add(sph(o.x, o.z, 0, w * 0.85, w * 0.72, H, 'wall2', { rot: r0 }));
      for (let j = 0; j < 3; j++) {
        const c = polar(o, a0 + 1 + j * GOLD, w * 0.2);
        out.add(sph(c.x, c.z, 0, w * rng.range(0.45, 0.65), w * rng.range(0.4, 0.6), H * rng.range(0.45, 0.8), 'wall2', { rot: rng.range(0, 180) }));
      }
      const s = polar(o, a0 + 2, w * 0.14);
      out.add(sph(s.x, s.z, H * 0.3, w * 0.5, w * 0.45, H * 0.6, 'wall2', { rot: rng.range(0, 180) }));
    } else if (ang < 0.7) {
      // Worn block: a rounded core with the corners of flat faces just breaking through it.
      out.add(sph(o.x, o.z, 0, w * 0.85, w * 0.74, H * 0.96, 'wall2', { rot: r0 }));
      out.add(box(o.x, o.z, 0, w * 0.56, w * 0.48, H * 0.72, 'wall2', { rot: r0 + 20 }));
      const c = polar(o, a0 + 1, w * 0.12);
      out.add(box(c.x, c.z, 0, w * 0.44, w * 0.4, H * 0.5, 'wall2', { rot: r0 + 58 }));
      const l = polar(o, a0 + 3.4, w * 0.2);
      out.add(sph(l.x, l.z, 0, w * 0.5, w * 0.42, H * rng.range(0.4, 0.6), 'wall2', { rot: rng.range(0, 180) }));
      out.add(fin(polar(o, a0 + 5, w * 0.15), a0 + 5, 0, w * 0.34, w * 0.4, H * 0.45, 'wall2'));
      capY = H * 0.86;
    } else {
      // Faceted: a low block and a taller one turned against it, each with a sloped top, and slabs leaning on the foot.
      const c = polar(o, a0 + 1, w * 0.1);
      out.add(box(o.x, o.z, 0, w * 0.8, w * 0.62, H * 0.5, 'wall2', { rot: r0 }));
      out.add(wedge(o.x, o.z, H * 0.5, w * 0.8, w * 0.62, Math.max(0.05, H * 0.26), 'wall2', { rot: r0 + (rng.chance(0.5) ? 180 : 0) }));
      out.add(box(c.x, c.z, 0, w * 0.5, w * 0.46, H * 0.7, 'wall2', { rot: r0 + 38 }));
      out.add(wedge(c.x, c.z, H * 0.7, w * 0.5, w * 0.46, Math.max(0.05, H * 0.3), 'wall2', { rot: r0 + 38 + 180 * rng.int(0, 1) }));
      out.add(fin(polar(o, a0 + 3, w * 0.2), a0 + 3, 0, w * 0.4, w * 0.45, H * 0.45, 'wall2'));
      out.add(fin(polar(o, a0 + 5.2, w * 0.2), a0 + 5.2, 0, w * 0.34, w * 0.3, H * 0.6, 'wall2'));
      capY = H * 0.55;
      capW = w * 0.4;
    }
    if (cleft) {
      const c = polar(ORIGIN, a0, Math.min(0.48, shift + W * 0.24 + split * 0.05));
      const hw = W * 0.4;
      const hh = H * rng.range(0.6, 0.85);
      if (ang < 0.5) out.add(sph(c.x, c.z, 0, hw, hw * 1.3, hh, 'wall2', { rot: outward(a0) }));
      else out.add(box(c.x, c.z, 0, hw * 0.8, hw * 1.2, hh, 'wall2', { rot: outward(a0) }), wedge(c.x, c.z, hh, hw * 0.8, hw * 1.2, Math.max(0.05, hh * 0.2), 'wall2', { rot: outward(a0) }));
    }
    const stones = Math.round(scatter * 5);
    for (let i = 0; i < stones; i++) {
      const c = polar(ORIGIN, a0 + 0.7 + i * GOLD, Math.min(0.48, W * rng.range(0.45, 0.58)));
      const s = W * rng.range(0.12, 0.22);
      const maker = ang < 0.35 ? sph : i % 2 === 0 ? box : pyr;
      out.add(maker(c.x, c.z, 0, s, s * rng.range(0.7, 1), Math.max(0.05, s * rng.range(0.5, 0.9)), 'wall2', { rot: rng.range(0, 90) }));
    }
    out.add(sph(0, Math.min(0.44, W * 0.5), 0, 0.09, 0.08, 0.05, 'wall2', { rot: rng.range(0, 180), repeat: 3, gap: W * 0.27 }));
    if (moss > 0.1) {
      out.extra(dome(o.x, o.z, capY, capW * lerp(0.7, 1.3, moss), capW * lerp(0.6, 1.1, moss), Math.max(0.05, H * 0.08 + 0.03), 'accent', { rot: r0 }));
      if (moss > 0.6) {
        const c = polar(o, a0 + 4, w * 0.36);
        out.extra(sph(c.x, c.z, 0, w * 0.36, w * 0.3, Math.max(0.05, H * 0.22), 'accent'));
      }
    }
    if (glow > 0) {
      // A seam runs through the stone and shows where it breaks the surface.
      out.extra(box(o.x, o.z, H * 0.1, w * 0.88, 0.025, Math.max(0.05, H * 0.5), 'glow', { rot: r0 + 70 }));
      if (glow > 0.5) out.extra(box(o.x, o.z, H * 0.25, w * 0.86, 0.025, Math.max(0.05, H * 0.3), 'glow', { rot: r0 + 160 }));
      out.extra(pyr(0, -Math.min(0.44, W * 0.5), 0, 0.06, 0.05, 0.08, 'glow', { rot: rng.range(0, 180), repeat: 2, gap: W * 0.33 }));
    }
    return out.list;
  },
);

export const crystal = skel(
  'crystal', 'nature', 'Cluster of faceted shards of differing height on a base of rock.',
  ['quartz cluster', 'ice shards', 'basalt columns', 'salt pillars', 'ore crystals', 'obsidian spikes'],
  [
    N('count', 1, 9, 5, 'shards'),
    N('height', 0.3, 4, 1.2, 'tallest shard'),
    N('girth', 0.05, 0.4, 0.14, 'shard width'),
    N('splay', 0, 1, 0.5, '0 upright bundle, 1 fanned out'),
    C('tip', ['point', 'chisel', 'flat'], 'point', 'shard end'),
    N('matrix', 0, 1, 0.5, 'rock base'),
    N('glow', 0, 1, 0.6, 'share of shards that glow'),
  ],
  (d, rng) => {
    const n = int(d, 'count');
    const H = num(d, 'height');
    const g = num(d, 'girth');
    const splay = num(d, 'splay');
    const tip = str(d, 'tip');
    const matrix = num(d, 'matrix');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    if (matrix > 0.1) {
      const mr = Math.min(0.45, (0.1 + 0.045 * n + g * 0.6) * (0.6 + 0.6 * splay));
      out.add(cone(0, 0, 0, mr * (1.6 + 0.8 * matrix), mr * (1.4 + 0.7 * matrix), 0.08 + 0.12 * matrix, 'wall2'));
      const c = polar(ORIGIN, a0 + 2, mr * 0.8);
      out.add(sph(c.x, c.z, 0, 0.2 + 0.2 * matrix, 0.18 + 0.14 * matrix, 0.08 + 0.14 * matrix, 'wall2', { rot: rng.range(0, 180) }));
    }
    const lit = glow > 0 ? Math.max(1, Math.round(glow * n)) : 0;
    const step = n <= 5 && splay > 0.4;
    for (let i = 0; i < n; i++) {
      const a = a0 + i * GOLD;
      const r = i === 0 ? 0 : Math.min(0.4, (0.08 + 0.045 * i + g * 0.4) * (0.6 + 0.6 * splay));
      const h = i === 0 ? H : H * rng.range(0.35, 0.8) * (1 - 0.25 * splay * (i / n));
      const w = Math.max(0.03, i === 0 ? g : g * rng.range(0.5, 0.85));
      const dd = w * rng.range(0.8, 1);
      const rot = outward(a);
      const c = polar(ORIGIN, a, r);
      const tone: PartTone = i < lit ? 'glow' : 'glass';
      const bodyH = Math.max(0.05, h * (tip === 'flat' ? 0.9 : 0.68));
      let top = c;
      if (step && i > 0) {
        // A shard that leans: its upper half is set outward over its lower half.
        top = polar(ORIGIN, a, Math.min(0.48, r + w * 0.4));
        out.add(box(c.x, c.z, 0, w, dd, bodyH * 0.55, 'glass', { rot }));
        out.add(box(top.x, top.z, bodyH * 0.5, w * 0.9, dd * 0.9, bodyH * 0.5, 'glass', { rot }));
      } else out.add(box(c.x, c.z, 0, w, dd, bodyH, 'glass', { rot }));
      const tw = step && i > 0 ? w * 0.9 : w;
      const td = step && i > 0 ? dd * 0.9 : dd;
      const th = Math.max(0.05, h - bodyH);
      if (tip === 'chisel') out.add(wedge(top.x, top.z, bodyH, tw, td, th, tone, { rot }));
      else if (tip === 'flat') out.add(box(top.x, top.z, bodyH, tw * 0.8, td * 0.8, th, tone, { rot }));
      else out.add(pyr(top.x, top.z, bodyH, tw, td, th, tone, { rot }));
    }
    // Chips broken off around the foot.
    const reach = Math.min(0.44, (0.12 + 0.045 * n + g * 0.6) * (0.6 + 0.6 * splay));
    const chips = polar(ORIGIN, a0 + 1, reach);
    out.extra(pyr(chips.x, chips.z, 0, 0.06, 0.05, 0.08, 'glass', { rot: rng.range(0, 90), repeat: 2, gap: reach * 0.6 }));
    const chip = polar(ORIGIN, a0 + 4, reach);
    out.extra(box(chip.x, chip.z, 0, 0.07, 0.05, 0.05, 'glass', { rot: rng.range(0, 90) }));
    return out.list;
  },
);
