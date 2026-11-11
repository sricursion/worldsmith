// More of the living and the mineral ground: reef, pond, meadow and field, rock spires, vents, alien growth
// and heaps of loose earth. Heights are in footprint units.
// Tones on plants: wall2 stem, soil and reef rock, accent leaf, roof a darker leaf, trim the pigment
// (coral flesh, petals, fruit). On the mineral families (pinnacle, vent, mound): wall, wall2 and trim are
// stone, roof a cap of moss or snow, glass water and steam. Glow only when the glow dial is above 0.
import type { PartTone } from '../spec';
import { arch, box, C, clamp, cone, cyl, dome, lerp, N, num, pyr, ring, skel, sph, str, int, wedge } from './util';
import { blade, fin, GOLD, lobes, ORIGIN, Parts, polar, outward, stem, TAU } from './nature-util';
import type { P2 } from './nature-util';

const deg = (a: number): number => (a * 180) / Math.PI;

export const coral = skel(
  'coral', 'nature', 'Reef growth on a rock foot, as antler branches, upright fans, a furrowed dome, organ tubes or a table on a stalk.',
  ['staghorn coral', 'sea fan', 'brain coral', 'tube sponge', 'table coral', 'alien polyp'],
  [
    C('form', ['branch', 'fan', 'brain', 'tube', 'table'], 'branch', 'growth habit'),
    N('height', 0.2, 3, 1, 'height'),
    N('spread', 0.3, 1, 0.8, 'width'),
    N('arms', 2, 8, 5, 'branches, fans, lobes or tubes'),
    N('fork', 0, 1, 0.5, 'side shoots, ruffles or tiers'),
    N('glow', 0, 1, 0, 'glowing tips'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const S = num(d, 'spread');
    const n = int(d, 'arms');
    const fork = num(d, 'fork');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const lit = (i: number): boolean => glow > 0 && i < Math.max(1, Math.round(glow * n));
    out.add(sph(0, 0, 0, S * 0.6, S * 0.5, clamp(H * 0.15, 0.05, 0.2), 'wall2', { rot: rng.range(0, 180) }));

    if (form === 'branch') {
      // Each antler leans out of the foot, turns upright, and throws a side shoot where it turns.
      const k = Math.min(n, 6);
      for (let i = 0; i < k; i++) {
        const a = a0 + i * GOLD;
        const h = H * (i === 0 ? 1 : rng.range(0.55, 0.9));
        const g = clamp(S * 0.1, 0.04, 0.1) * (i === 0 ? 1 : rng.range(0.7, 0.95));
        const from = polar(ORIGIN, a, i === 0 ? 0 : S * 0.06);
        const reach = i === 0 ? 0.04 : Math.min(0.4, S * rng.range(0.25, 0.45));
        const tip = polar(from, a, reach);
        out.add(blade(from, a, 0, reach, g, h * 0.6, 'trim'));
        out.add(cone(tip.x, tip.z, h * 0.5, g * 1.1, g * 1.1, Math.max(0.05, h * 0.5), 'trim'));
        if (fork > 0.25 && i < Math.round(fork * 6)) {
          const fa = a + (i % 2 === 0 ? 1.1 : -1.1);
          out.extra(blade(tip, fa, h * 0.42, Math.min(0.14, S * 0.15), g * 0.7, Math.max(0.05, h * rng.range(0.25, 0.4)), 'trim'));
        }
        if (lit(i)) out.extra(sph(tip.x, tip.z, Math.max(0, h - 0.05), g * 1.4, g * 1.4, 0.07, 'glow'));
      }
      return out.list;
    }

    if (form === 'fan') {
      // Flat fans on short stalks, each turned its own way.
      const k = Math.min(n, 6);
      for (let i = 0; i < k; i++) {
        const o = polar(ORIGIN, a0 + i * GOLD, i === 0 ? 0 : S * rng.range(0.15, 0.32));
        const h = H * (i === 0 ? 1 : rng.range(0.45, 0.85));
        const w = clamp(S * (i === 0 ? 0.7 : rng.range(0.3, 0.5)), 0.12, 0.9);
        const rot = rng.range(0, 180);
        const sh = Math.max(0.05, h * 0.2);
        const fy = sh * 0.6;
        const fh = Math.max(0.05, h - fy);
        out.add(cyl(o.x, o.z, 0, 0.05, 0.05, sh, 'wall2'));
        out.add(sph(o.x, o.z, fy, w, 0.04, fh, 'trim', { rot }));
        if (fork > 0.3 && i < 3) out.extra(sph(o.x, o.z, fy + fh * 0.25, w * 0.6, 0.04, Math.max(0.05, fh * 0.6), 'trim', { rot: rot + 50 + 40 * fork }));
        if (lit(i)) out.extra(sph(o.x, o.z, Math.max(0, h - 0.05), 0.07, 0.07, 0.07, 'glow'));
      }
      return out.list;
    }

    if (form === 'brain') {
      const W = S * 0.85;
      const bh = Math.min(H, W * 0.9);
      out.add(dome(0, 0, 0, W, W * rng.range(0.85, 1), bh, 'trim', { rot: rng.range(0, 180) }));
      for (let i = 0; i < n; i++) {
        const c = polar(ORIGIN, a0 + i * GOLD, W * rng.range(0.25, 0.42));
        const w = W * rng.range(0.3, 0.5);
        out.add(dome(c.x, c.z, 0, w, w * rng.range(0.8, 1), Math.max(0.05, bh * rng.range(0.35, 0.7)), 'trim', { rot: rng.range(0, 180) }));
      }
      // Furrows: low ridges that cross the crown, in the same flesh, so they read as relief and not as stripes.
      for (let j = 0; j < Math.round(fork * 4); j++) {
        out.extra(sph(0, 0, bh * 0.55, W * (0.8 - 0.12 * j), 0.05, Math.max(0.05, bh * 0.48), 'trim', { rot: j * 47 + deg(a0) }));
      }
      for (let i = 0; i < 3; i++) {
        if (!lit(i)) continue;
        const c = polar(ORIGIN, a0 + i * 2.1, W * 0.2);
        out.extra(sph(c.x, c.z, bh * 0.86, 0.07, 0.07, 0.07, 'glow'));
      }
      return out.list;
    }

    if (form === 'tube') {
      // Organ pipes of unequal height, each with a flared lip round a dark mouth.
      for (let i = 0; i < n; i++) {
        const o = polar(ORIGIN, a0 + i * GOLD, i === 0 ? 0 : S * rng.range(0.12, 0.36));
        const h = H * (i === 0 ? 1 : rng.range(0.45, 0.9));
        const w = clamp(S * lerp(0.24, 0.13, n / 8) * rng.range(0.8, 1.1), 0.06, 0.3);
        const lip = w * (1.15 + 0.4 * fork);
        out.add(cyl(o.x, o.z, 0, w, w, h, 'trim'));
        out.add(ring(o.x, o.z, Math.max(0, h - 0.05), lip, lip, 0.08, lit(i) ? 'glow' : 'trim'));
        if (i < 4) out.extra(cyl(o.x, o.z, Math.max(0, h - 0.02), w * 0.7, w * 0.7, 0.05, 'dark'));
      }
      return out.list;
    }

    // Table: a stalk carrying flat plates, the widest on top, studded with nubs.
    const tiers = 1 + Math.round(fork * 2);
    const sw = clamp(S * 0.16, 0.06, 0.16);
    const ph = Math.max(0.05, H * 0.07);
    out.add(cone(0, 0, 0, sw * 2, sw * 2, Math.max(0.05, H * 0.5), 'wall2'), cyl(0, 0, 0, sw, sw, H * 0.9, 'trim'));
    for (let j = 0; j < tiers; j++) {
      const last = j === tiers - 1;
      const y = H * (tiers === 1 ? 0.88 : lerp(0.45, 0.88, j / (tiers - 1)));
      const w = S * (last ? 1 : rng.range(0.5, 0.7));
      const c = last ? ORIGIN : polar(ORIGIN, a0 + j * 2.2, S * 0.1);
      out.add(cyl(c.x, c.z, y, w, w * rng.range(0.8, 0.95), ph, 'trim', { rot: rng.range(0, 180) }));
    }
    for (let i = 0; i < n; i++) {
      const c = polar(ORIGIN, a0 + i * GOLD, S * 0.38 * Math.sqrt((i + 0.5) / n));
      out.add(cone(c.x, c.z, H * 0.88 + ph - 0.01, 0.05, 0.05, Math.max(0.05, H * rng.range(0.05, 0.12)), lit(i) ? 'glow' : 'trim'));
    }
    return out.list;
  },
);

export const lily = skel(
  'lily', 'nature', 'Floating leaves on still water, flat or held up on stalks, with blooms between them.',
  ['lily pads', 'lotus', 'giant water lily', 'duckweed raft', 'water hyacinth', 'alien float pads'],
  [
    N('pads', 2, 9, 5, 'leaves'),
    N('size', 0.12, 0.6, 0.3, 'leaf width'),
    N('rise', 0, 1.5, 0.1, 'stalk height; 0 flat on the water'),
    N('rim', 0, 1, 0, 'upturned leaf edge'),
    N('bloom', 0, 1, 0.4, 'flowers'),
    C('flower', ['cup', 'star', 'spike'], 'cup', 'bloom shape'),
    N('glow', 0, 1, 0, 'glowing blooms'),
  ],
  (d, rng) => {
    const n = int(d, 'pads');
    const sz = num(d, 'size');
    const rise = num(d, 'rise');
    const rim = num(d, 'rim');
    const bloom = num(d, 'bloom');
    const kind = str(d, 'flower');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const raised = rise > 0.12;
    const spots: { c: P2; w: number }[] = [];
    for (let i = 0; i < n; i++) {
      const r = i === 0 ? 0 : Math.min(0.45, 0.12 + 0.36 * Math.sqrt(i / n)) * rng.range(0.85, 1.05);
      const c = polar(ORIGIN, a0 + i * GOLD, r);
      const w = sz * (i === 0 ? 1 : rng.range(0.6, 1));
      const dd = w * rng.range(0.85, 1);
      const tone: PartTone = i % 3 === 1 ? 'roof' : 'accent';
      const rot = rng.range(0, 180);
      const up = raised && i % 2 === 0 ? rise * (i === 0 ? 1 : rng.range(0.5, 0.9)) : 0;
      if (up > 0) {
        // A leaf held clear of the water is a shallow parasol on its stalk.
        out.add(cyl(c.x, c.z, 0, 0.03, 0.03, up, 'accent'));
        out.add(dome(c.x, c.z, up, w, dd, Math.max(0.05, w * 0.22), tone, { rot }));
      } else {
        out.add(cyl(c.x, c.z, 0, w, dd, 0.05, tone, { rot }));
        if (rim > 0.1 && i < 5) out.extra(ring(c.x, c.z, 0, w * 1.03, dd * 1.03, 0.05 + rim * 0.12, 'roof', { rot }));
      }
      spots.push({ c, w });
    }
    const weed = polar(ORIGIN, a0 + 4, 0.28);
    out.add(cyl(weed.x, weed.z, 0, 0.07, 0.06, 0.05, 'accent', { rot: rng.range(0, 180), repeat: 3, gap: 0.13 }));

    const tone: PartTone = glow > 0 ? 'glow' : 'trim';
    const blooms = Math.max(bloom > 0.08 ? Math.max(1, Math.round(bloom * 4)) : 0, glow > 0 ? 1 : 0);
    const s = clamp(sz * 0.5, 0.07, 0.22);
    for (let j = 0; j < blooms; j++) {
      const near = spots[(j * 2 + 1) % spots.length] ?? { c: ORIGIN, w: sz };
      const c = polar(near.c, a0 + 1 + j * 2, Math.min(near.w * 0.5 + s * 0.4, 0.2));
      const by = raised ? rise * rng.range(1, 1.25) + 0.06 : 0;
      if (by > 0) out.add(cyl(c.x, c.z, 0, 0.03, 0.03, by, 'accent'));
      if (kind === 'spike') out.add(cone(c.x, c.z, by, s * 0.6, s * 0.6, s * 2.2, tone));
      else if (kind === 'star') {
        out.add(cyl(c.x, c.z, by, s * 1.6, s * 1.6, 0.05, tone));
        out.extra(cone(c.x, c.z, by + 0.03, s * 0.5, s * 0.5, Math.max(0.05, s * 0.7), 'trim'));
      } else {
        out.add(sph(c.x, c.z, by, s, s, s * 0.9, tone));
        out.extra(ring(c.x, c.z, by, s * 1.5, s * 1.5, 0.05, 'trim'));
      }
    }
    return out.list;
  },
);

export const flower = skel(
  'flower', 'nature', 'Flowers on leafy stems, one giant bloom or a clump, with five kinds of head.',
  ['sunflower', 'tulips', 'lupin', 'allium', 'bluebells', 'alien bloom'],
  [
    C('head', ['disc', 'cup', 'spike', 'globe', 'bell'], 'disc', 'bloom shape'),
    N('height', 0.2, 3, 0.9, 'height'),
    N('count', 1, 7, 3, 'stems'),
    N('bloom', 0.08, 0.8, 0.3, 'head width'),
    N('nod', 0, 1, 0.2, 'stems lean apart'),
    N('leaves', 0, 1, 0.5, 'leaf cover'),
    N('glow', 0, 1, 0, 'glowing heads'),
  ],
  (d, rng) => {
    const head = str(d, 'head');
    const H = num(d, 'height');
    const k = int(d, 'count');
    const B = num(d, 'bloom');
    const nod = num(d, 'nod');
    const leaves = num(d, 'leaves');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const segs = k > 4 ? 1 : 2;
    const sw = clamp(0.025 + H * 0.012, 0.03, 0.07);
    out.add(cone(0, 0, 0, 0.16 + 0.03 * k, 0.15 + 0.03 * k, Math.max(0.05, H * 0.18), 'accent'));
    for (let i = 0; i < k; i++) {
      const a = a0 + i * GOLD;
      const o = polar(ORIGIN, a, k === 1 ? 0 : 0.06 + 0.045 * i);
      const h = H * (i === 0 ? 1 : rng.range(0.6, 0.95));
      const b = B * (i === 0 ? 1 : rng.range(0.7, 1));
      const st = stem(o, h, sw, sw * 0.8, nod * 0.12, a, segs, 'accent');
      out.add(...st.parts);
      const c = st.at(h);
      const tone: PartTone = glow > 0 && i < Math.max(1, Math.round(glow * k)) ? 'glow' : 'trim';
      const rot = rng.range(0, 180);
      if (head === 'disc') {
        // A flat face turned to the side, with a dark eye.
        const y = Math.max(0, h - b * 0.5);
        out.add(sph(c.x, c.z, y, b, 0.05, b, tone, { rot }));
        out.extra(sph(c.x, c.z, y + b * 0.28, b * 0.44, 0.09, b * 0.44, 'wall2', { rot }));
      } else if (head === 'cup') {
        const y = Math.max(0, h - b * 0.3);
        out.add(sph(c.x, c.z, y, b * 0.7, b * 0.7, b, tone));
        out.extra(pyr(c.x, c.z, y + b * 0.7, b * 0.5, b * 0.5, Math.max(0.05, b * 0.5), tone, { rot }));
      } else if (head === 'spike') {
        out.add(cone(c.x, c.z, h * 0.55, b * 0.6, b * 0.6, Math.max(0.1, h * 0.5 + b * 0.3), tone));
        out.extra(sph(c.x, c.z, h * 0.5, b * 0.75, b * 0.75, Math.max(0.05, b * 0.5), tone));
      } else if (head === 'globe') {
        out.add(sph(c.x, c.z, Math.max(0, h - b * 0.4), b, b, b, tone));
      } else {
        // Bells hang to either side of the stem top, mouths down.
        const c1 = polar(c, a, b * 0.25);
        out.add(dome(c1.x, c1.z, Math.max(0, h - b * 0.75), b * 0.6, b * 0.6, Math.max(0.05, b * 0.6), tone));
        const c2 = polar(c, a + Math.PI, b * 0.22);
        out.extra(dome(c2.x, c2.z, Math.max(0, h - b * 1.3), b * 0.5, b * 0.5, Math.max(0.05, b * 0.5), tone));
      }
      if (leaves > 0.2) out.extra(blade(o, a + 1.5, 0, clamp(H * 0.2, 0.06, 0.2), 0.05, Math.max(0.05, h * lerp(0.25, 0.5, leaves)), 'accent'));
      if (leaves > 0.6) out.extra(fin(st.at(h * 0.4), a - 1.2, h * 0.3, Math.min(0.18, 0.06 + H * 0.1), 0.05, Math.max(0.05, h * 0.18), 'accent'));
    }
    return out.list;
  },
);

export const crop = skel(
  'crop', 'nature', 'Planted rows on ridged soil, as tall stalks, round heads, vines trained on posts or tufts standing in water.',
  ['corn rows', 'cabbage patch', 'vineyard', 'rice paddy', 'pumpkin patch', 'bean poles', 'tea rows'],
  [
    C('form', ['stalks', 'heads', 'trellis', 'paddy'], 'stalks', 'kind of planting'),
    N('rows', 1, 4, 3, 'rows'),
    N('height', 0.2, 3, 1, 'plant height'),
    N('density', 3, 8, 5, 'plants per row'),
    N('ripe', 0, 1, 0.5, 'ears, fruit or blossom'),
    N('furrow', 0, 1, 0.4, 'soil ridge height'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const R = int(d, 'rows');
    const H = num(d, 'height');
    const k = int(d, 'density');
    const ripe = num(d, 'ripe');
    const furrow = num(d, 'furrow');
    const out = new Parts();
    const pitch = R === 1 ? 0.5 : 0.68 / (R - 1);
    const gap = 0.84 / (k - 1);
    const ridged = form !== 'paddy' && furrow > 0.1;
    const hr = ridged ? 0.05 + furrow * 0.14 : 0;
    const sw = clamp(0.02 + H * 0.012, 0.025, 0.06);
    const later: (() => void)[] = [];
    if (form === 'paddy') {
      // A sheet of water held in by a low bank on two sides.
      const bank = 0.06 + furrow * 0.12;
      out.add(box(0, 0, 0, 0.98, 0.98, 0.05, 'glass'), box(0, -0.46, 0, 1, 0.07, bank, 'wall2'), box(-0.46, 0, 0, 0.07, 1, bank, 'wall2'));
    }
    for (let j = 0; j < R; j++) {
      const z = R === 1 ? 0 : lerp(-0.34, 0.34, j / (R - 1));
      const x = rng.range(-0.02, 0.02);
      const h = H * (j === 0 ? 1 : rng.range(0.8, 1));
      const o = { repeat: k, gap };
      if (ridged) out.add(arch(0, z, 0, Math.min(pitch * 0.75, 0.3), 0.96, hr, 'wall2', { rot: 90 }));
      if (form === 'stalks') {
        // Leaves reach along the row from stalk to stalk, low ones one way and high ones the other.
        out.add(cyl(x, z, 0, sw, sw, h, 'accent', o));
        out.add(wedge(x, z, h * 0.3, gap * 0.9, 0.03, Math.max(0.05, h * 0.3), 'accent', { ...o, rot: j % 2 === 0 ? 0 : 180 }));
        out.add(wedge(x, z, h * 0.58, gap * 0.7, 0.03, Math.max(0.05, h * 0.25), 'roof', { ...o, rot: j % 2 === 0 ? 180 : 0 }));
        if (ripe > 0.25) {
          later.push(() => out.extra(cone(x, z, h * 0.95, 0.05, 0.05, Math.max(0.06, h * 0.1), 'trim', o)));
          later.push(() => out.extra(sph(x + sw, z + 0.02, h * 0.45, 0.05, 0.05, Math.max(0.08, h * 0.14), 'trim', o)));
        }
      } else if (form === 'heads') {
        const s = clamp(H * 0.5, 0.08, Math.min(gap * 0.95, pitch * 0.9, 0.3));
        const lift = h - s > 0.12 ? h - s : hr * 0.6;
        if (lift > hr) out.add(cyl(x, z, 0, sw, sw, lift + s * 0.3, 'accent', o));
        out.add(sph(x, z, lift, s, s, s * 0.85, ripe > 0.6 ? 'trim' : 'accent', o));
        out.add(dome(x, z, lift, Math.min(gap, s * 1.5), s * 1.3, Math.max(0.05, s * 0.4), 'roof', o));
        if (ripe > 0.25 && ripe <= 0.6) later.push(() => out.extra(sph(x, z, lift + s * 0.75, s * 0.3, s * 0.3, Math.max(0.05, s * 0.25), 'trim', o)));
      } else if (form === 'trellis') {
        // Posts and a wire, with the vine massed along the wire and fruit hanging in it.
        const wy = h * 0.38;
        out.add(cyl(0, z, 0, 0.04, 0.04, h, 'wall2', { repeat: 3, gap: 0.44 }));
        out.add(box(0, z, wy, 0.9, 0.02, 0.05, 'dark'));
        out.add(sph(x, z, wy, gap * 1.25, Math.min(0.16, pitch * 0.6), Math.max(0.08, h * 0.6), 'accent', o));
        if (ripe > 0.25) later.push(() => out.extra(sph(x, z + 0.03, wy, 0.06, 0.06, 0.09, 'trim', o)));
      } else {
        out.add(cone(x, z, 0, 0.07, 0.06, h, 'accent', o));
        out.add(pyr(x + gap / 2, z + 0.03, 0, 0.05, 0.04, Math.max(0.05, h * 0.75), 'roof', { repeat: k - 1, gap }));
        if (ripe > 0.25) later.push(() => out.extra(sph(x, z, h * 0.8, 0.05, 0.04, Math.max(0.06, h * 0.15), 'trim', o)));
      }
    }
    later.forEach((add) => add());
    return out.list;
  },
);

export const pod = skel(
  'pod', 'nature', 'Fleshy alien growth: egg sacs, a bulb on a stalk, a ring of tentacles or a gaping maw.',
  ['egg sac', 'spore pod', 'tentacle plant', 'carnivorous maw', 'cocoon', 'sea anemone'],
  [
    C('form', ['egg', 'bulb', 'tendril', 'maw'], 'egg', 'body plan'),
    N('height', 0.3, 3, 1, 'height'),
    N('girth', 0.2, 0.9, 0.5, 'body width'),
    N('count', 1, 6, 3, 'pods, tendrils or jaws'),
    N('open', 0, 1, 0.3, '0 sealed, 1 split wide'),
    N('glow', 0, 1, 0.4, 'glowing core'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const g = num(d, 'girth');
    const k = int(d, 'count');
    const open = num(d, 'open');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const core: PartTone = glow > 0 ? 'glow' : 'trim';

    if (form === 'egg') {
      out.add(dome(0, 0, 0, Math.min(1, g * 1.5), Math.min(0.9, g * 1.3), 0.06, 'roof', { rot: rng.range(0, 180) }));
      for (let i = 0; i < k; i++) {
        const a = a0 + i * GOLD;
        const s = i === 0 ? 1 : rng.range(0.45, 0.75);
        const w = g * s;
        const h = H * s;
        const o = i === 0 ? polar(ORIGIN, a, k > 1 ? g * 0.1 : 0) : polar(ORIGIN, a, Math.min(0.4, g * 0.45 + w * 0.2));
        out.add(sph(o.x, o.z, 0, w, w * 0.9, h, 'accent', { rot: rng.range(0, 180) }));
        out.add(sph(o.x, o.z, h * 0.88, w * 0.36, w * 0.36, Math.max(0.05, w * 0.3), core));
        if (i < 3) {
          if (open > 0.35) {
            // The top has split into flaps that lean away from the core.
            for (let j = 0; j < 3; j++) {
              const pa = a0 + (j * TAU) / 3 + i;
              out.extra(blade(polar(o, pa, w * 0.08), pa, h * 0.75, w * (0.12 + 0.3 * open), w * 0.28, Math.max(0.05, h * 0.3 * (0.5 + open)), 'roof'));
            }
          } else out.extra(sph(o.x, o.z, 0, w * 1.03, 0.04, h * 1.01, 'roof', { rot: rng.range(0, 180) }));
          out.extra(fin(polar(o, a + 2, w * 0.3), a + 2, 0, Math.min(0.2, w * 0.5), 0.05, Math.max(0.05, h * 0.25), 'roof'));
        }
      }
      return out.list;
    }

    if (form === 'bulb') {
      // A leaning stalk carries one swollen head, with feelers hanging under it.
      const sw = clamp(g * 0.25, 0.06, 0.2);
      const sh = H * 0.6;
      const st = stem(ORIGIN, sh, sw, sw * 0.7, 0.08, a0, 3, 'roof');
      out.add(cone(0, 0, 0, sw * 2.2, sw * 2, Math.max(0.05, sw * 1.4), 'roof'), ...st.parts);
      const top = st.at(sh);
      const by = H * 0.5;
      const bh = H * 0.5;
      out.add(sph(top.x, top.z, by, g, g * 0.92, bh, 'accent', { rot: rng.range(0, 180) }));
      out.add(ring(top.x, top.z, by + bh * 0.2, g * 0.9, g * 0.84, 0.06, 'roof'));
      const mouth = g * lerp(0.2, 0.6, open);
      out.add(ring(top.x, top.z, by + bh * 0.9, mouth, mouth, 0.06, 'roof'));
      out.add(sph(top.x, top.z, by + bh * 0.84, mouth * 0.7, mouth * 0.7, Math.max(0.05, bh * 0.2), core));
      for (let i = 0; i < k + 1; i++) {
        const c = polar(top, a0 + 1 + i * GOLD, g * 0.3);
        const len = Math.min(by, H * rng.range(0.15, 0.4));
        out.add(box(c.x, c.z, by + 0.02 - len, 0.03, 0.03, len, 'roof'));
      }
      return out.list;
    }

    if (form === 'tendril') {
      // Tentacles rise in a ring, swaying, the ring wider the further it has opened.
      const m = k + 2;
      const segs = m > 5 ? 3 : 4;
      const w = clamp(g * 0.3, 0.06, 0.2);
      out.add(sph(0, 0, 0, Math.min(1, g * 1.2), Math.min(0.9, g), 0.08, 'roof', { rot: rng.range(0, 180) }));
      for (let i = 0; i < m; i++) {
        const a = a0 + (i * TAU) / m;
        const o = polar(ORIGIN, a, Math.min(0.4, g * lerp(0.15, 0.5, open)));
        const h = H * (i === 0 ? 1 : rng.range(0.55, 0.95));
        out.add(...lobes(o, a + 1.3, h, w, 0.03 + open * 0.05, segs, i % 2 === 0 ? 'accent' : 'roof'));
        if (i < 4) out.extra(sph(o.x, o.z, h * 0.97, w * 0.6, w * 0.6, Math.max(0.05, w * 0.6), core));
      }
      return out.list;
    }

    // Maw: jaws stand round a soft core, shut into a bud or thrown open.
    const m = k + 2;
    out.add(dome(0, 0, 0, Math.min(1, g * 1.3), Math.min(0.9, g * 1.2), 0.07, 'roof', { rot: rng.range(0, 180) }));
    out.add(sph(0, 0, 0, g * 0.7, g * 0.7, H * 0.35, 'trim'));
    out.add(sph(0, 0, H * 0.3, g * 0.3, g * 0.3, Math.max(0.05, g * 0.25), core));
    for (let i = 0; i < m; i++) {
      const a = a0 + (i * TAU) / m + rng.range(-0.1, 0.1);
      const h = H * rng.range(0.75, 1);
      const from = polar(ORIGIN, a, g * 0.25);
      if (open < 0.35) out.add(pyr(from.x, from.z, 0, g * 0.35, g * 0.22, h, 'accent', { rot: outward(a) }));
      else out.add(blade(from, a, 0, Math.min(0.48 - g * 0.25, g * lerp(0.2, 0.6, open)), g * 0.3, h, 'accent'));
      const tooth = polar(ORIGIN, a + 0.35, g * 0.3);
      out.extra(cone(tooth.x, tooth.z, 0, 0.04, 0.04, Math.max(0.05, H * 0.3), 'dark'));
    }
    return out.list;
  },
);

export const pinnacle = skel(
  'pinnacle', 'nature', 'Standing spires of rock, ice or earth, drip-tapered, needle-sharp, capped or lumpy.',
  ['stalagmites', 'ice spikes', 'hoodoo', 'termite spire', 'rock needles', 'salt chimney', 'sea stack'],
  [
    C('form', ['taper', 'needle', 'hoodoo', 'lumpy'], 'taper', 'profile'),
    N('height', 0.4, 5, 1.8, 'tallest spire'),
    N('girth', 0.15, 0.8, 0.4, 'base width'),
    N('count', 1, 6, 3, 'spires'),
    N('lean', 0, 1, 0.2, 'crooked'),
    N('cap', 0, 1, 0, 'moss or snow on the tips'),
    N('glow', 0, 1, 0, 'glowing veins'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const g = num(d, 'girth');
    const n = int(d, 'count');
    const lean = num(d, 'lean');
    const cap = num(d, 'cap');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    out.add(dome(0, 0, 0, Math.min(1, g * 1.7), Math.min(0.9, g * 1.5), clamp(H * 0.05, 0.05, 0.14), 'wall', { rot: rng.range(0, 180) }));
    const lit = glow > 0 ? Math.max(1, Math.round(glow * n)) : 0;
    for (let i = 0; i < n; i++) {
      const a = a0 + i * GOLD;
      const main = i === 0;
      const s = main ? 1 : rng.range(0.3, 0.72);
      const h = H * s;
      const w = Math.max(0.08, g * (main ? 1 : lerp(0.5, 0.8, s)));
      const o = main ? polar(ORIGIN, a, n > 1 ? 0.06 : 0) : polar(ORIGIN, a, Math.min(0.42, g * 0.5 + w * 0.3 + 0.04 * i));
      const dir = rng.range(0, TAU);
      /** Where the axis of the spire has wandered to, a share `t` of the way up. */
      const off = (t: number): P2 => polar(o, dir, Math.min(lean * w * 0.5 * t, 0.12));
      const tone: PartTone = i % 2 === 0 ? 'wall2' : 'wall';
      const rot = rng.range(0, 90);
      const full = main || n <= 4;
      let tip = off(1);
      let top = h;
      let tipW = w * 0.36;
      if (form === 'taper') {
        // Three cones, each standing out of the one below: the stepped outline that dripping water builds.
        const mid = off(0.5);
        out.add(cone(o.x, o.z, 0, w, w * 0.92, h * 0.55, tone, { rot }));
        out.add(cone(mid.x, mid.z, h * 0.22, w * 0.62, w * 0.6, h * 0.5, tone, { rot }));
        if (full) out.add(cone(tip.x, tip.z, h * 0.5, w * 0.36, w * 0.34, h * 0.5, tone));
        else {
          tip = mid;
          top = h * 0.72;
          tipW = w * 0.62;
        }
      } else if (form === 'needle') {
        out.add(pyr(o.x, o.z, 0, w * 0.7, w * 0.6, h * 0.62, tone, { rot }));
        out.add(pyr(tip.x, tip.z, h * 0.3, w * 0.42, w * 0.36, h * 0.7, tone, { rot: rot + 30 }));
        if (full) out.add(fin(o, dir + 2.5, 0, w * 0.6, w * 0.4, h * rng.range(0.3, 0.5), tone));
        tipW = w * 0.42;
      } else if (form === 'hoodoo') {
        // A soft neck under a wider cap of harder stone.
        const belly = off(0.4);
        out.add(cyl(o.x, o.z, 0, w * 0.5, w * 0.46, h * 0.75, tone, { rot }));
        out.add(sph(tip.x, tip.z, h * 0.7, w * 1.05, w * 0.9, h * 0.3, tone === 'wall' ? 'wall2' : 'wall', { rot }));
        if (full) {
          out.add(cone(o.x, o.z, 0, w * 0.9, w * 0.85, h * 0.3, tone, { rot }));
          out.add(sph(belly.x, belly.z, h * 0.2, w * 0.7, w * 0.62, h * 0.35, tone, { rot: rot + 40 }));
        }
        tipW = w * 1.05;
      } else {
        const mid = off(0.5);
        out.add(sph(o.x, o.z, 0, w, w * 0.9, h * 0.5, tone, { rot }));
        out.add(sph(mid.x, mid.z, h * 0.25, w * 0.72, w * 0.66, h * 0.45, tone, { rot: rot + 40 }));
        if (full) out.add(cone(tip.x, tip.z, h * 0.55, w * 0.45, w * 0.42, h * 0.45, tone));
        else {
          tip = mid;
          top = h * 0.7;
          tipW = w * 0.72;
        }
        if (main) {
          const side = polar(o, dir + 2, w * 0.4);
          out.extra(cone(side.x, side.z, 0, w * 0.35, w * 0.3, h * 0.45, tone));
        }
      }
      if (cap > 0.1 && i < 3) {
        if (form === 'hoodoo') out.extra(dome(tip.x, tip.z, top - 0.02, tipW * 0.9, tipW * 0.8, Math.max(0.05, h * 0.07), 'roof', { rot }));
        else {
          const ch = top * lerp(0.12, 0.3, cap);
          out.extra(cone(tip.x, tip.z, top - ch * 0.9, tipW * lerp(0.45, 0.8, cap), tipW * lerp(0.45, 0.8, cap), Math.max(0.05, ch), 'roof'));
        }
      }
      if (i < lit) out.extra(box(o.x, o.z, h * 0.08, 0.025, w * 0.8, Math.max(0.05, h * 0.35), 'glow', { rot: rot + 20 }));
    }
    const rubble = polar(ORIGIN, a0 + 2, 0.36);
    out.add(sph(rubble.x, rubble.z, 0, 0.1, 0.08, 0.06, 'wall', { rot: rng.range(0, 180), repeat: 2, gap: 0.16 }));
    return out.list;
  },
);

export const vent = skel(
  'vent', 'nature', 'Opening in the ground that steams, spouts or glows, as a crater cone, a fissure, a rimmed pool or a geyser.',
  ['fumarole', 'geyser', 'lava crack', 'hot spring', 'tar pit', 'mud volcano'],
  [
    C('form', ['cone', 'crack', 'pool', 'geyser'], 'cone', 'kind of opening'),
    N('width', 0.4, 1.2, 0.9, 'width'),
    N('height', 0.1, 2, 0.5, 'rim or cone height'),
    N('plume', 0, 3, 0.8, 'steam or jet height; 0 none'),
    N('crust', 0, 1, 0.5, 'lumps and slabs on the rim'),
    N('glow', 0, 1, 0.5, 'molten glow inside'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const W = num(d, 'width');
    const H = num(d, 'height');
    const plume = num(d, 'plume');
    const crust = num(d, 'crust');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const rot = rng.range(0, 180);
    const throat: PartTone = glow > 0 ? 'glow' : 'dark';
    /** Steam as puffs that widen as they climb, or a jet of water with spray at its head. */
    const puffs = (c: P2, y0: number, w0: number, jet: boolean): void => {
      if (plume <= 0.05) return;
      if (jet) {
        out.add(cyl(c.x, c.z, y0, w0 * 0.5, w0 * 0.5, plume, 'glass'));
        out.extra(sph(c.x, c.z, y0 + plume * 0.7, w0 * 1.6, w0 * 1.4, Math.max(0.08, plume * 0.36), 'glass', { rot }));
        out.extra(sph(c.x, c.z, y0 + plume * 0.35, w0, w0 * 0.9, Math.max(0.06, plume * 0.3), 'glass', { rot: rot + 60 }));
        return;
      }
      const k = clamp(Math.round(plume * 2.5), 1, 4);
      const step = plume / k;
      let w = w0;
      for (let j = 0; j < k; j++) {
        const cc = polar(c, a0 + j * 2, Math.min(0.04 * j, 0.1));
        out.add(sph(cc.x, cc.z, y0 + j * step, w, w * 0.9, Math.max(0.06, step * 1.3), 'glass', { rot: rot + j * 50 }));
        w = Math.min(0.6, w * 1.35);
      }
    };
    const lumps = (r: number, size: number): void => {
      for (let j = 0; j < Math.round(crust * 4); j++) {
        const c = polar(ORIGIN, a0 + 1 + j * GOLD, Math.min(0.46, r * rng.range(0.85, 1.05)));
        const s = size * rng.range(0.7, 1.2);
        out.add(sph(c.x, c.z, 0, s, s * rng.range(0.7, 1), Math.max(0.05, s * rng.range(0.5, 0.8)), j % 2 === 0 ? 'wall' : 'wall2', { rot: rng.range(0, 180) }));
      }
    };

    if (form === 'cone') {
      // A spatter cone with the neck of its chimney standing out of the top.
      const nw = clamp(W * 0.3, 0.12, 0.36);
      out.add(cone(0, 0, 0, W, W * rng.range(0.85, 1), H * 0.98, 'wall2', { rot }));
      out.add(cyl(0, 0, 0, nw, nw, H, 'wall'));
      out.add(ring(0, 0, Math.max(0, H - 0.05), nw * 1.35, nw * 1.3, 0.09, 'trim', { rot }));
      out.add(cyl(0, 0, H - 0.01, nw * 0.8, nw * 0.8, 0.05, throat));
      lumps(W * 0.32, W * 0.2);
      puffs(ORIGIN, H + 0.02, nw * 0.8, false);
      return out.list;
    }

    if (form === 'crack') {
      // Two lengths of fissure meet at a kink; the ground on both sides is heaved up and slopes away from it.
      const len = Math.min(W, 1);
      const ua = (-rot * Math.PI) / 180;
      const u = polar(ORIGIN, ua, 1);
      for (const s of [-1, 1]) {
        const r2 = rot + s * rng.range(8, 22);
        const c = { x: u.x * s * len * 0.24, z: u.z * s * len * 0.24 };
        out.add(box(c.x, c.z, 0, len * 0.55, 0.09, 0.05, 'dark', { rot: r2 }));
        if (glow > 0) out.add(box(c.x, c.z, 0, len * 0.5, 0.03 + 0.03 * glow, 0.06, 'glow', { rot: r2 }));
      }
      const slabs = 2 + Math.round(crust * 4);
      for (let j = 0; j < slabs; j++) {
        const side = j % 2 === 0 ? 1 : -1;
        const va = ua + (side * Math.PI) / 2;
        const t = lerp(-0.38, 0.38, (j + 0.5) / slabs) * len;
        const from = polar({ x: u.x * t, z: u.z * t }, va, 0.07);
        const reach = clamp(W * rng.range(0.18, 0.3), 0.08, 0.34);
        out.add(fin(from, va, 0, reach, (len / slabs) * rng.range(1.2, 1.7), H * rng.range(0.5, 1), j % 3 === 0 ? 'wall' : 'wall2'));
      }
      puffs(ORIGIN, 0.03, 0.14, false);
      return out.list;
    }

    if (form === 'pool') {
      const dd = W * rng.range(0.75, 0.95);
      const rh = clamp(H * 0.35, 0.06, 0.4);
      out.add(cyl(0, 0, 0, W * 0.96, dd * 0.96, rh, 'wall2', { rot }));
      out.add(ring(0, 0, Math.max(0, rh - 0.04), W, dd, 0.09, 'trim', { rot }));
      out.add(cyl(0, 0, rh - 0.01, W * 0.82, dd * 0.82, 0.05, glow > 0.6 ? 'glow' : 'glass', { rot }));
      if (glow > 0 && glow <= 0.6) out.add(sph(0, 0, rh, 0.1, 0.1, 0.06, 'glow'));
      lumps(W * 0.5, W * 0.16);
      puffs(polar(ORIGIN, a0 + 1, W * 0.14), rh + 0.03, 0.16, false);
      return out.list;
    }

    // Geyser: a nozzle of sinter on a low terraced mound, with the jet standing out of it.
    const nw = clamp(W * 0.16, 0.08, 0.2);
    out.add(cyl(0, 0, 0, W, W * 0.9, 0.05, 'wall', { rot }));
    out.add(dome(0, 0, 0, W * 0.7, W * 0.62, Math.max(0.05, H * 0.5), 'trim', { rot }));
    out.add(cyl(0, 0, 0, nw, nw, H, 'wall2'));
    out.add(ring(0, 0, Math.max(0, H - 0.05), nw * 1.4, nw * 1.4, 0.08, 'trim'));
    out.add(cyl(0, 0, H - 0.01, nw * 0.75, nw * 0.75, 0.05, throat));
    lumps(W * 0.4, W * 0.14);
    puffs(ORIGIN, H + 0.02, nw * 0.9, true);
    return out.list;
  },
);

export const mound = skel(
  'mound', 'nature', 'Heap of loose ground, as a wind-shaped drift, a conical pile, a pitted anthill or a burrow with its hole.',
  ['snowdrift', 'sand dune', 'anthill', 'gravel pile', 'burrow', 'grave mound', 'molehills'],
  [
    C('form', ['drift', 'pile', 'hill', 'burrow'], 'drift', 'kind of heap'),
    N('width', 0.4, 1.2, 0.9, 'width'),
    N('height', 0.1, 1.5, 0.4, 'height'),
    N('lumps', 1, 6, 3, 'smaller heaps, turrets or stones'),
    N('steep', 0, 1, 0.4, '0 smooth swell, 1 sharp crest or cone'),
    N('cap', 0, 1, 0, 'snow, moss or grass on top'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const W = num(d, 'width');
    const H = num(d, 'height');
    const n = int(d, 'lumps');
    const steep = num(d, 'steep');
    const cap = num(d, 'cap');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const rot = rng.range(0, 180);
    /** A cap that lies on the crown of a dome of the given size, a little proud of it. */
    const capOn = (c: P2, w: number, dd: number, h: number, turn: number): void => {
      if (cap <= 0.1) return;
      const f = lerp(0.25, 0.6, cap);
      const k = Math.sqrt(1 - (1 - f) * (1 - f)) * 1.04;
      out.extra(dome(c.x, c.z, h * (1 - f), w * k, dd * k, h * f + 0.02, 'roof', { rot: turn }));
    };
    const stones = (r: number): void => {
      const c = polar(ORIGIN, a0 + 2.5, Math.min(0.44, r));
      out.add(sph(c.x, c.z, 0, 0.09, 0.08, 0.05, 'wall2', { rot: rng.range(0, 180), repeat: 3, gap: 0.14 }));
    };

    if (form === 'drift') {
      // Long and low across the wind, a sharp crest along it when steep, tapering away downwind.
      const ua = (-rot * Math.PI) / 180;
      const va = ua + Math.PI / 2;
      const mh = H * lerp(1, 0.8, steep);
      out.add(dome(0, 0, 0, W, W * 0.55, mh, 'wall', { rot }));
      if (steep > 0.3) out.add(fin(polar(ORIGIN, va, -W * 0.05), va, 0, W * 0.28, W * 0.6, H * lerp(0.8, 1.15, steep), 'wall'));
      out.add(fin(polar(ORIGIN, ua, W * 0.3), ua, 0, Math.min(0.2, W * 0.22), W * 0.3, mh * 0.55, 'wall'));
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const c = polar(polar(ORIGIN, ua, side * W * rng.range(0.1, 0.34)), va, W * rng.range(-0.2, 0.2));
        const w = W * rng.range(0.3, 0.5);
        out.add(dome(c.x, c.z, 0, w, w * 0.6, Math.max(0.05, H * rng.range(0.35, 0.7)), i % 2 === 0 ? 'wall2' : 'wall', { rot: rot + rng.range(-20, 20) }));
      }
      stones(W * 0.4);
      capOn(ORIGIN, W, W * 0.55, mh, rot);
      return out.list;
    }

    if (form === 'pile') {
      // A rounded skirt, and above it the cone that anything poured from one point makes.
      const sk = H * lerp(1, 0.6, steep);
      out.add(dome(0, 0, 0, W, W * 0.92, sk, 'wall', { rot }));
      if (steep > 0.25) out.add(cone(0, 0, 0, W * lerp(0.9, 0.75, steep), W * lerp(0.85, 0.7, steep), H, 'wall', { rot }));
      for (let i = 0; i < n; i++) {
        const c = polar(ORIGIN, a0 + i * GOLD, Math.min(0.44, W * rng.range(0.36, 0.46)));
        const w = W * rng.range(0.2, 0.36);
        const h = Math.max(0.05, H * rng.range(0.2, 0.45));
        out.add((steep > 0.5 ? cone : dome)(c.x, c.z, 0, w, w * 0.9, h, i % 2 === 0 ? 'wall2' : 'wall', { rot: rng.range(0, 180) }));
      }
      stones(W * 0.5);
      if (steep > 0.25 && cap > 0.1) {
        const f = lerp(0.25, 0.55, cap);
        const cw = W * lerp(0.9, 0.75, steep) * f * 1.08 + 0.02;
        out.extra(cone(0, 0, H * (1 - f), cw, cw * 0.94, H * f + 0.02, 'roof', { rot }));
      } else capOn(ORIGIN, W, W * 0.92, sk, rot);
      return out.list;
    }

    if (form === 'hill') {
      // A swollen base with turrets standing out of it, pitted with holes.
      const bw = W * 0.9;
      const bh = H * 0.7;
      out.add(dome(0, 0, 0, bw, bw * 0.9, bh, 'wall', { rot }));
      out.add(cone(0, 0, 0, bw * lerp(0.6, 0.4, steep), bw * lerp(0.55, 0.36, steep), H, 'wall2', { rot }));
      for (let i = 0; i < n; i++) {
        const c = polar(ORIGIN, a0 + i * GOLD, bw * rng.range(0.16, 0.3));
        const w = bw * lerp(0.34, 0.2, steep) * rng.range(0.8, 1.1);
        out.add(cone(c.x, c.z, 0, w, w * 0.9, H * rng.range(0.55, 0.9), i % 2 === 0 ? 'wall' : 'wall2', { rot: rng.range(0, 180) }));
      }
      for (let j = 0; j < 3; j++) {
        const r = 0.26 + 0.05 * j;
        const c = polar(ORIGIN, a0 + 0.6 + j * 2.1, bw * r);
        out.extra(cyl(c.x, c.z, Math.max(0, bh * Math.sqrt(1 - 4 * r * r) - 0.03), 0.07, 0.06, 0.05, 'dark'));
      }
      stones(W * 0.48);
      capOn(ORIGIN, bw, bw * 0.9, bh, rot);
      return out.list;
    }

    // Burrow: a mound with a dark mouth under a lip, and the spoil thrown out in front of it.
    const bw = W * 0.9;
    const turn = 90 - deg(a0);
    const mw = clamp(W * 0.3, 0.14, 0.36);
    const mh = clamp(H * 0.75, 0.09, 0.6);
    out.add(dome(0, 0, 0, bw, bw * 0.88, H * lerp(1, 0.8, steep), 'wall', { rot: -deg(a0) }));
    if (steep > 0.4) out.add(cone(0, 0, 0, bw * 0.6, bw * 0.55, H, 'wall', { rot }));
    // The dark mouth stands a finger proud of the lip around it, so it shows as a hole in a face.
    const holeR = Math.min(0.4, bw * 0.38);
    const lip = polar(ORIGIN, a0, holeR - bw * 0.02);
    const hole = polar(ORIGIN, a0, holeR);
    out.add(arch(lip.x, lip.z, 0, mw * 1.35, Math.max(0.05, bw * 0.26 - 0.02), mh * 1.22, 'wall2', { rot: turn }));
    out.add(arch(hole.x, hole.z, 0, mw, bw * 0.22, mh, 'dark', { rot: turn }));
    const spoil = polar(ORIGIN, a0, Math.min(0.44, bw * 0.5));
    out.add(dome(spoil.x, spoil.z, 0, W * 0.4, W * 0.3, Math.max(0.05, H * 0.15), 'wall2', { rot: -deg(a0) }));
    for (let i = 0; i < n; i++) {
      const c = polar(ORIGIN, a0 + 0.9 + i * 0.9, Math.min(0.46, bw * rng.range(0.44, 0.52)));
      const s = W * rng.range(0.1, 0.18);
      out.add(sph(c.x, c.z, 0, s, s * rng.range(0.7, 1), Math.max(0.05, s * 0.7), 'wall2', { rot: rng.range(0, 180) }));
    }
    capOn(ORIGIN, bw, bw * 0.88, H * lerp(1, 0.8, steep), -deg(a0));
    return out.list;
  },
);
