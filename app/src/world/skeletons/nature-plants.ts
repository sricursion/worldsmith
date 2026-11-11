// Plants that are not trees: succulents, fungi, shrubs, grasses and vines. Heights are in footprint units.
// Tones: wall2 stem and bark, accent living green, roof caps, trim flowers, fruit, gills and heads,
// dark spines, glow only when the glow dial is above 0.
import type { PartTone } from '../spec';
import { box, C, clamp, cone, cyl, dome, lerp, N, num, pyr, ring, skel, sph, str, int, wedge } from './util';
import { blade, fin, GOLD, lobes, ORIGIN, Parts, polar, outward, spare, stem, TAU } from './nature-util';
import type { P2 } from './nature-util';

const rad = (deg: number): number => (deg * Math.PI) / 180;

export const succulent = skel(
  'succulent', 'nature', 'Fleshy water-storing plant: ribbed column with arms, forked tree, pads, rosette or barrel.',
  ['saguaro', 'prickly pear', 'agave', 'joshua tree', 'barrel cactus', 'alien cactus'],
  [
    C('form', ['column', 'branching', 'pads', 'rosette', 'barrel'], 'column', 'body plan'),
    N('height', 0.2, 4, 1.6, 'height'),
    N('girth', 0.08, 0.5, 0.2, 'column, leaf or body width'),
    N('arms', 0, 6, 2, 'arms, pads, leaves or pups'),
    N('ribs', 0, 1, 0.5, 'rib depth'),
    N('spines', 0, 1, 0.4, 'spines'),
    N('flowers', 0, 1, 0.2, 'flowers; 1 tall bloom stalk'),
    N('glow', 0, 1, 0, 'glowing blooms'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const g = num(d, 'girth');
    const arms = int(d, 'arms');
    const ribs = num(d, 'ribs');
    const spines = num(d, 'spines');
    const flowers = num(d, 'flowers');
    const glow = num(d, 'glow');
    const bloomTone: PartTone = glow > 0 ? 'glow' : 'trim';
    const blooming = flowers > 0.15 || glow > 0;
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const needles = (c: P2, y: number, span: number, rot: number): void => {
      if (spines > 0.15) out.extra(cone(c.x, c.z, y, 0.02, 0.02, 0.06 + 0.1 * spines, 'dark', { rot, repeat: 3, gap: Math.max(0.03, span) }));
    };
    const bloom = (c: P2, y: number, k: number): void => {
      if (!blooming) return;
      const s = clamp(k * lerp(0.5, 0.9, flowers), 0.04, 0.16);
      out.extra(sph(c.x, c.z, Math.max(0, y - s * 0.3), s, s, s, bloomTone));
    };

    if (form === 'column') {
      const capH = Math.max(0.05, g * 0.5);
      const bodyH = Math.max(0.05, H - capH);
      out.add(cyl(0, 0, 0, g, g, bodyH, 'accent'), dome(0, 0, bodyH, g, g, capH, 'accent'));
      if (ribs > 0.15) {
        const k = ribs > 0.6 ? 3 : 2;
        const r0 = rng.range(0, 90);
        for (let j = 0; j < k; j++) out.add(box(0, 0, 0, g * (1.04 + 0.14 * ribs), Math.max(0.02, g * 0.12), bodyH + capH * 0.4, 'accent', { rot: r0 + (j * 180) / k }));
      }
      for (let i = 0; i < Math.min(arms, 5); i++) {
        const a = a0 + i * GOLD;
        const ag = Math.max(0.04, g * rng.range(0.55, 0.75));
        const ay = bodyH * rng.range(0.28, 0.55);
        const reach = Math.min(0.46, g * 0.5 + ag * 0.5 + g * rng.range(0.25, 0.6));
        const ah = Math.max(0.1, Math.min(H - ay - ag, H * rng.range(0.25, 0.5)));
        const elbow = polar(ORIGIN, a, reach / 2);
        const tip = polar(ORIGIN, a, reach);
        // An arm leaves the column level, turns up through an elbow and ends in a rounded cap.
        out.add(sph(elbow.x, elbow.z, ay, reach + ag, ag, Math.max(0.05, ag), 'accent', { rot: outward(a) }));
        out.add(cyl(tip.x, tip.z, ay + ag * 0.4, ag, ag, ah, 'accent'));
        out.add(dome(tip.x, tip.z, ay + ag * 0.4 + ah, ag, ag, Math.max(0.05, ag * 0.5), 'accent'));
        if (i < 2) bloom(tip, ay + ag * 0.4 + ah + ag * 0.5, ag);
      }
      needles(ORIGIN, H - 0.01, g * 0.3, rng.range(0, 180));
      bloom(ORIGIN, H, g);
      return out.list;
    }

    if (form === 'branching') {
      const trunkH = H * 0.42;
      out.add(cone(0, 0, 0, g * 1.8, g * 1.8, Math.max(0.05, g * 1.2), 'wall2'), cyl(0, 0, 0, g, g, trunkH, 'wall2'));
      const n = clamp(arms, 2, 6);
      for (let i = 0; i < n; i++) {
        const a = a0 + (i * TAU) / n + rng.range(-0.3, 0.3);
        const ag = Math.max(0.04, g * 0.6);
        const reach = Math.min(0.42, g * 0.6 + rng.range(0.1, 0.3));
        const ay = trunkH * rng.range(0.65, 0.95);
        const ah = Math.max(0.08, (H - ay) * rng.range(0.45, 0.8));
        const mid = polar(ORIGIN, a, reach / 2);
        const tip = polar(ORIGIN, a, reach);
        const tuft = clamp(g * 1.9, 0.12, 0.5) * rng.range(0.8, 1.1);
        out.add(box(mid.x, mid.z, ay, reach + ag, ag, Math.max(0.05, ag), 'wall2', { rot: outward(a) }));
        out.add(cyl(tip.x, tip.z, ay, ag, ag, ah, 'wall2'));
        // Each arm ends in a tuft of stiff leaves.
        out.add(sph(tip.x, tip.z, ay + ah - tuft * 0.2, tuft, tuft * rng.range(0.8, 1), tuft * 0.55, 'accent', { rot: rng.range(0, 180) }));
        out.add(cone(tip.x, tip.z, ay + ah, tuft * 0.7, tuft * 0.7, tuft * rng.range(0.8, 1.2), 'accent'));
        if (i < 2) bloom(tip, ay + ah + tuft * 0.7, tuft * 0.5);
      }
      return out.list;
    }

    if (form === 'pads') {
      interface Pad { x: number; z: number; y: number; w: number; h: number; rot: number; leaf: boolean }
      const w0 = clamp(H * 0.42, 0.14, 0.6);
      const pads: Pad[] = [{ x: 0, z: 0, y: 0, w: w0, h: Math.max(0.1, H * 0.5), rot: rng.range(0, 180), leaf: true }];
      const n = 3 + arms;
      for (let i = 1; i < n; i++) {
        const p = pads[Math.floor((i - 1) / 2)] ?? (pads[0] as Pad);
        p.leaf = false;
        const side = i % 2 === 1 ? 1 : -1;
        const off = side * p.w * 0.3;
        pads.push({
          x: p.x + off * Math.cos(rad(p.rot)), z: p.z - off * Math.sin(rad(p.rot)), y: p.y + p.h * 0.7,
          w: Math.max(0.08, p.w * rng.range(0.65, 0.85)), h: Math.max(0.08, p.h * rng.range(0.7, 0.9)), rot: p.rot + side * rng.range(25, 70), leaf: true,
        });
      }
      for (const p of pads) out.add(sph(p.x, p.z, p.y, p.w, Math.max(0.04, g * 0.3), p.h, 'accent', { rot: p.rot }));
      const leaves = pads.filter((p) => p.leaf);
      leaves.slice(0, 3).forEach((p) => needles(p, p.y + p.h - 0.02, p.w * 0.22, p.rot));
      leaves.slice(-3).forEach((p) => bloom(p, p.y + p.h, p.w * 0.4));
      return out.list;
    }

    if (form === 'rosette') {
      const n = 5 + arms;
      out.add(cone(0, 0, 0, g * 1.2, g * 1.2, Math.max(0.05, H * 0.6), 'accent'));
      for (let j = 0; j < 3; j++) {
        const c = polar(ORIGIN, a0 + (j * TAU) / 3, g * 0.3);
        out.add(pyr(c.x, c.z, 0, g * 0.6, g * 0.3, H * rng.range(0.8, 1), 'accent', { rot: outward(a0 + (j * TAU) / 3) }));
      }
      // Outer leaves lean away from the heart and taper to a point.
      for (let i = 0; i < n; i++) {
        const a = a0 + 0.4 + (i * TAU) / n + rng.range(-0.15, 0.15);
        const reach = Math.min(0.48, H * 0.75) * rng.range(0.7, 1);
        out.add(blade(polar(ORIGIN, a, 0.02), a, 0, reach, clamp(g * 0.28, 0.03, 0.1), H * rng.range(0.45, 0.8), 'accent'));
      }
      if (flowers > 0.5) {
        const sh = H * lerp(1.6, 2.6, flowers);
        out.extra(cyl(0, 0, 0, 0.04, 0.04, sh, 'accent'));
        out.extra(sph(0, 0, sh - 0.12, 0.2, 0.2, 0.3, bloomTone));
        out.extra(sph(0, 0, sh * 0.78, 0.09, 0.09, 0.09, bloomTone, { rot: rng.range(0, 180), repeat: 2, gap: 0.1 }));
      } else bloom(ORIGIN, H * 0.75, g);
      needles(ORIGIN, H * 0.75, g * 0.3, outward(a0));
      return out.list;
    }

    // Barrel: a squat ribbed body, with pups around its foot.
    const W = clamp(g * 2.4, 0.2, 1);
    const bodyH = Math.min(H, W * 1.6);
    out.add(sph(0, 0, 0, W, W, bodyH, 'accent'));
    const k = 2 + Math.round(ribs * 2);
    const r0 = rng.range(0, 90);
    for (let j = 0; j < k; j++) out.add(sph(0, 0, 0, W * (1.03 + 0.06 * ribs), Math.max(0.03, W * 0.08), bodyH * 1.01, 'accent', { rot: r0 + (j * 180) / k }));
    for (let i = 0; i < arms; i++) {
      const c = polar(ORIGIN, a0 + i * GOLD, Math.min(0.45, W * 0.5 + 0.03));
      const pw = W * rng.range(0.3, 0.45);
      out.add(sph(c.x, c.z, 0, pw, pw, Math.max(0.05, bodyH * rng.range(0.3, 0.5)), 'accent'));
    }
    needles(ORIGIN, bodyH * 0.97, W * 0.12, r0 + 30);
    if (blooming) {
      const s = clamp(W * 0.16, 0.04, 0.14);
      out.extra(sph(0, 0, bodyH - s * 0.4, s, s, s, bloomTone, { rot: r0, repeat: 3, gap: W * 0.2 }));
    }
    out.extra(sph(0.3, 0.28, 0, 0.08, 0.07, 0.05, 'wall2', { repeat: 2, gap: 0.5, rot: 40 }));
    return out.list;
  },
);

const CAPS = ['flat', 'dome', 'cone', 'funnel', 'shelf'];

export const fungus = skel(
  'fungus', 'nature', 'Stalk, ring and cap, alone or clustered; or shelves stepping up a dead trunk.',
  ['toadstool', 'giant mushroom', 'bracket fungus', 'chanterelle', 'glowing spore pod', 'morel'],
  [
    N('height', 0.2, 4, 1.2, 'height'),
    C('cap', CAPS, 'dome', 'cap shape; shelf grows on a trunk'),
    N('capSize', 0.3, 1.3, 0.8, 'cap width'),
    N('stalk', 0.05, 0.4, 0.14, 'stalk width'),
    N('ring', 0, 1, 0.4, 'skirt on the stalk'),
    N('cluster', 1, 5, 1, 'mushrooms or shelf tiers'),
    N('gills', 0, 1, 0.5, 'pale underside'),
    N('spots', 0, 1, 0.3, 'cap spots'),
    N('glow', 0, 1, 0, 'glowing spots; above 0.5 gills too'),
  ],
  (d, rng) => {
    const H = num(d, 'height');
    const cap = str(d, 'cap');
    const capW = num(d, 'capSize');
    const sw = num(d, 'stalk');
    const annulus = num(d, 'ring');
    const cluster = int(d, 'cluster');
    const gills = num(d, 'gills');
    const spots = num(d, 'spots');
    const glow = num(d, 'glow');
    const spotTone: PartTone = glow > 0 ? 'glow' : 'trim';
    const out = new Parts();
    const a0 = rng.range(0, TAU);

    if (cap === 'shelf') {
      const hw = clamp(sw * 2.2, 0.15, 0.5);
      out.add(cone(0, 0, 0, hw * 1.6, hw * 1.5, Math.max(0.05, H * 0.2), 'wall2'), cyl(0, 0, 0, hw, hw * 0.9, H, 'wall2'));
      out.add(wedge(0, 0, H, hw * 0.7, hw * 0.6, Math.max(0.05, H * 0.12), 'wall2', { rot: rng.range(0, 360) }));
      const ns = 2 + cluster;
      for (let j = 0; j < ns; j++) {
        const a = a0 + j * 2.2 + rng.range(-0.3, 0.3);
        const y = H * lerp(0.15, 0.85, j / (ns - 1));
        const w = Math.max(0.14, capW * rng.range(0.5, 0.85));
        const c = polar(ORIGIN, a, hw * 0.42);
        const h = Math.max(0.05, w * 0.22);
        // A bracket is a low dome half sunk into the trunk.
        out.add(dome(c.x, c.z, y, w, w * 0.75, h, 'roof', { rot: outward(a) }));
        if (gills > 0.15 && j % 2 === 0) out.extra(cyl(c.x, c.z, Math.max(0, y - 0.05), w * 0.9, w * 0.66, 0.05, glow > 0.5 ? 'glow' : 'trim', { rot: outward(a) }));
        if (j < Math.round(Math.max(spots, glow) * 3)) {
          const e = polar(ORIGIN, a, hw * 0.42 + w * 0.25);
          out.extra(sph(e.x, e.z, y + h * 0.5, 0.05, 0.05, 0.05, spotTone));
        }
      }
      return out.list;
    }

    const mushroom = (o: P2, Hm: number, cw: number, w: number, main: boolean): void => {
      const capH = cap === 'flat' ? Math.max(0.05, cw * 0.14) : cap === 'cone' ? Math.min(cw * 0.9, Hm * 0.6) : Math.min(cw * 0.48, Hm * 0.6);
      const Hs = Math.max(0.08, Hm - capH);
      const dir = rng.range(0, TAU);
      const st = stem(o, Hs, w * 1.15, w * 0.85, main ? Math.min(0.06, w * 0.5) : 0, dir, main && !spare(d) ? 2 : 1, 'wall2');
      const c = st.at(Hs);
      if (main) out.add(sph(o.x, o.z, 0, w * 1.7, w * 1.7, Math.max(0.05, w * 1.2), 'wall2'));
      out.add(...st.parts);
      const skirt = cap === 'cone' ? capH * 0.15 : 0;
      const capY = Math.max(0, Hs - skirt);
      if (cap === 'funnel') {
        // A trumpet: the cap widens upward in steps to a rolled rim.
        out.add(cyl(c.x, c.z, Hs, cw * 0.45, cw * 0.45, capH * 0.5, 'roof'));
        out.add(cyl(c.x, c.z, Hs + capH * 0.5, cw * 0.75, cw * 0.75, Math.max(0.05, capH * 0.35), 'roof'));
        if (main) out.add(ring(c.x, c.z, Hs + capH * 0.8, cw, cw, Math.max(0.05, capH * 0.25), glow > 0.5 ? 'glow' : 'roof'));
      } else if (cap === 'cone') out.add(cone(c.x, c.z, capY, cw, cw, capH + skirt, 'roof'));
      else out.add(dome(c.x, c.z, capY, cw, cw * rng.range(0.9, 1), capH, 'roof', { rot: rng.range(0, 180) }));
      if (!main) return;
      if (gills > 0.15 && cap !== 'funnel') {
        const gw = cw * lerp(0.6, 0.92, gills);
        out.extra(cyl(c.x, c.z, Math.max(0, capY - 0.05), gw, gw, 0.05, glow > 0.5 ? 'glow' : 'trim'));
      }
      if (annulus > 0.15) {
        const ry = Hs * 0.62;
        const rc = st.at(ry);
        out.extra(cone(rc.x, rc.z, ry, w * lerp(1.6, 2.8, annulus), w * lerp(1.6, 2.8, annulus), Math.max(0.05, w * 0.6), 'trim'));
      }
      if ((spots > 0.15 || glow > 0) && cap !== 'funnel') {
        const s = clamp(cw * lerp(0.08, 0.16, Math.max(spots, glow)), 0.04, 0.16);
        // Height of the cap surface a share `r` of its radius from the axis.
        const surf = (r: number): number => (cap === 'cone' ? (capH + skirt) * (1 - r) : capH * Math.sqrt(1 - r * r));
        const r1 = rng.range(0, 180);
        out.extra(sph(c.x, c.z, capY + surf(0.5) - s * 0.4, s, s, s, spotTone, { rot: r1, repeat: 2, gap: cw * 0.5 }));
        out.extra(sph(c.x, c.z, capY + surf(0.26) - s * 0.4, s * 0.8, s * 0.8, s * 0.8, spotTone, { rot: r1 + 80, repeat: 2, gap: cw * 0.26 }));
      }
    };

    mushroom(ORIGIN, H, capW, sw, true);
    for (let j = 1; j < cluster; j++) {
      const k = rng.range(0.35, 0.7);
      const o = polar(ORIGIN, a0 + j * GOLD, Math.min(0.42, sw + capW * 0.25 + 0.08 * j));
      mushroom(o, H * k, Math.max(0.1, capW * k * 0.8), Math.max(0.03, sw * k), false);
    }
    return out.list;
  },
);

export const shrub = skel(
  'shrub', 'nature', 'Low woody plant on several stems: leafy mound, upright bush, bare twigs or a tangled ball.',
  ['bush', 'sagebrush', 'heather', 'tumbleweed', 'thornbush', 'coral bush'],
  [
    C('form', ['mound', 'upright', 'tangle'], 'mound', 'habit'),
    N('height', 0.2, 1.6, 0.6, 'height'),
    N('spread', 0.3, 1.2, 0.8, 'width'),
    N('stems', 2, 7, 4, 'stems'),
    N('density', 0, 1, 0.7, '0 bare twigs, 1 solid leaf'),
    N('berries', 0, 1, 0, 'berries or flowers'),
    N('glow', 0, 1, 0, 'glowing buds'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const S = num(d, 'spread');
    const n = int(d, 'stems');
    const dens = num(d, 'density');
    const berries = num(d, 'berries');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const s = clamp(S * 0.09, 0.04, 0.1);
    const budded = berries > 0.1 || glow > 0;
    const budTone = (i: number): PartTone => (glow > 0 && (berries <= 0.1 || i % 2 === 0) ? 'glow' : 'trim');

    if (form === 'tangle') {
      // A rough ball bound by hoops, bristling with twig ends.
      const tone: PartTone = dens < 0.4 ? 'wall2' : 'accent';
      const bw = S * 0.85;
      const bh = H * 0.9;
      out.add(sph(0, 0, 0, bw, bw * rng.range(0.85, 1), bh, tone, { rot: rng.range(0, 180) }));
      for (let j = 0; j < 3; j++) {
        const f = 0.25 + 0.25 * j;
        const w = bw * Math.sqrt(1 - Math.pow(2 * f - 1, 2)) * 1.05;
        const c = polar(ORIGIN, a0 + j * 2, 0.015);
        out.add(ring(c.x, c.z, bh * f, w, w * 0.92, 0.05, dens > 0.6 ? 'accent' : 'wall2', { rot: j * 40 }));
      }
      for (let j = 0; j < n * 2; j++) {
        const f = (j + 0.5) / (n * 2);
        const c = polar(ORIGIN, a0 + j * GOLD, bw * 0.42 * f);
        const top = bh * (0.5 + 0.5 * Math.sqrt(1 - f * f * 0.9));
        out.add(cone(c.x, c.z, top - 0.04, 0.03, 0.03, Math.max(0.06, H * rng.range(0.12, 0.3)), 'wall2'));
      }
      if (budded) for (let j = 0; j < 2; j++) out.extra(sph(0, 0, bh * (0.35 + 0.25 * j), s, s, s, budTone(j), { rot: j * 70 + 20, repeat: 2, gap: bw * (0.92 - 0.1 * j) }));
      return out.list;
    }

    const upright = form === 'upright';
    const twiggy = dens <= 0.2;
    interface Lump { c: P2; y: number; w: number; h: number }
    const lumps: Lump[] = [];
    const tips: { c: P2; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * TAU) / n + rng.range(-0.3, 0.3);
      const r = S * 0.5 * rng.range(upright ? 0.15 : 0.3, upright ? 0.4 : 0.62);
      const hj = H * rng.range(upright ? 0.6 : 0.4, upright ? 0.95 : 0.75);
      const base = polar(ORIGIN, a, r * 0.5);
      const tip = polar(ORIGIN, a, r);
      // Every stem leaves the root crown at its own angle and thins to its tip.
      if (twiggy) out.add(cone(tip.x, tip.z, 0, 0.045, 0.045, hj, 'wall2'));
      else out.add(blade(base, a, 0, r * 0.5, clamp(S * 0.04, 0.03, 0.05), hj, 'wall2'));
      tips.push({ c: tip, y: hj });
      if (twiggy) {
        const side = polar(ORIGIN, a + 0.5, r * rng.range(0.4, 1.2));
        out.extra(cone(side.x, side.z, 0, 0.035, 0.035, hj * rng.range(0.45, 0.8), 'wall2'));
        continue;
      }
      const w = S * (upright ? lerp(0.18, 0.4, dens) : lerp(0.25, 0.6, dens)) * rng.range(0.8, 1.1);
      const c = polar(ORIGIN, a, r * 0.9);
      const y = upright ? Math.min(hj, H * rng.range(0.12, 0.3)) : hj * lerp(0.3, 0, dens);
      lumps.push({ c, y, w, h: Math.max(0.05, (H - y) * rng.range(0.7, 1)) });
    }
    if (!twiggy) lumps.push({ c: ORIGIN, y: H * (upright ? 0.3 : 0.12), w: S * lerp(0.3, 0.55, dens), h: H * (upright ? 0.7 : 0.85) });
    for (const m of lumps) out.add(sph(m.c.x, m.c.z, m.y, m.w, m.w * rng.range(0.8, 1), m.h, 'accent', { rot: rng.range(0, 180) }));
    out.add(cone(0, 0, 0, S * 0.3, S * 0.27, Math.max(0.05, H * 0.2), 'wall2'));
    if (budded) {
      if (twiggy) tips.slice(0, 4).forEach((t, i) => out.extra(sph(t.c.x, t.c.z, Math.max(0, t.y - s), s, s, s, budTone(i))));
      else {
        lumps.slice(0, 4).forEach((m, i) => out.extra(
          sph(m.c.x, m.c.z, m.y + m.h * 0.93 - s * 0.3, s, s, s, budTone(i), { rot: rng.range(0, 180), repeat: 2, gap: m.w * 0.5 }),
        ));
      }
    }
    return out.list;
  },
);

const HEADS = ['none', 'plume', 'cattail', 'ear', 'flower'];

export const grassclump = skel(
  'grassclump', 'nature', 'Clump of tall blades, reeds, jointed culms or swaying ribbons, with optional seed heads.',
  ['pampas grass', 'cattails', 'bamboo', 'wheat', 'kelp', 'alien tendrils'],
  [
    C('form', ['blades', 'reeds', 'culms', 'ribbons'], 'blades', 'leaning blades, straight reeds, jointed canes or wavy ribbons'),
    N('height', 0.2, 5, 0.9, 'height'),
    N('spread', 0.2, 1, 0.6, 'clump width'),
    N('count', 3, 12, 7, 'blades or stalks'),
    N('lean', 0, 1, 0.3, 'outward lean or sway'),
    C('heads', HEADS, 'none', 'seed heads'),
    N('glow', 0, 1, 0, 'glowing heads or tips'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const S = num(d, 'spread');
    const n = int(d, 'count');
    const lean = num(d, 'lean');
    const heads = str(d, 'heads');
    const glow = num(d, 'glow');
    const out = new Parts();
    const a0 = rng.range(0, TAU);
    const r0 = rng.range(0, 180);

    /** A row of thin stalks, each topped by a head; the stalks stand `top` high. */
    const headed = (z: number, top: number, k: number, gap: number, rot: number): void => {
      if (heads === 'none' && glow <= 0) return;
      const tone: PartTone = glow > 0.5 ? 'glow' : heads === 'cattail' ? 'wall2' : 'trim';
      const o = { rot, repeat: k, gap };
      const c = { x: z * Math.sin(rad(rot)), z: z * Math.cos(rad(rot)) };
      out.extra(cyl(c.x, c.z, 0, 0.02, 0.02, top, 'accent', o));
      if (heads === 'plume') out.extra(sph(c.x, c.z, top * 0.82, clamp(S * 0.14, 0.05, 0.12), 0.05, Math.max(0.08, top * 0.3), tone, o));
      else if (heads === 'cattail') out.extra(cyl(c.x, c.z, top * 0.8, 0.05, 0.05, Math.max(0.06, top * 0.18), tone, o));
      else if (heads === 'ear') out.extra(pyr(c.x, c.z, top * 0.85, 0.05, 0.04, Math.max(0.08, top * 0.25), tone, o));
      else if (heads === 'flower') out.extra(sph(c.x, c.z, top - 0.04, 0.09, 0.09, 0.08, tone, o));
      if (glow > 0 && glow <= 0.5) out.extra(sph(c.x, c.z, top - 0.02, 0.04, 0.04, 0.05, 'glow', o));
      else if (glow > 0.5 && heads === 'none') out.extra(sph(c.x, c.z, top - 0.03, 0.06, 0.06, 0.06, 'glow', o));
    };

    if (form === 'blades') {
      const thick = clamp(S * 0.04, 0.02, 0.035);
      out.add(cone(0, 0, 0, S * 0.3, S * 0.3, Math.max(0.05, H * 0.45), 'accent'));
      for (let i = 0; i < n; i++) {
        const a = a0 + i * GOLD;
        const h = H * (i === 0 ? 1 : rng.range(0.5, 1));
        const reach = clamp(lean * h * 0.5, 0.04, S * 0.5) * rng.range(0.7, 1.1);
        const from = polar(ORIGIN, a, S * 0.12 * rng.next());
        // Leaning blades alternate with upright ones, so the clump is pointed from every side.
        if (i % 3 === 2) out.add(pyr(from.x, from.z, 0, thick * 1.6, thick, h, 'accent', { rot: outward(a) }));
        else out.add(blade(from, a, 0, reach, thick, h, 'accent'));
      }
      headed(0, H * 1.15, 3, S * 0.2, r0);
      return out.list;
    }

    if (form === 'reeds' || form === 'culms') {
      const culm = form === 'culms';
      const w = culm ? clamp(S * 0.09, 0.03, 0.09) : 0.025;
      const rows = culm ? (n > 7 ? 3 : 2) : 3;
      for (let j = 0; j < rows; j++) {
        const k = Math.max(1, Math.round(n / rows) + (j === 0 ? 1 : 0));
        const gap = (S * rng.range(0.7, 1)) / Math.max(1, k);
        const rot = r0 + j * (180 / rows) + rng.range(-12, 12);
        const z = (j - (rows - 1) / 2) * S * 0.22;
        const c = { x: z * Math.sin(rad(rot)), z: z * Math.cos(rad(rot)) };
        const top = H * (j === 0 ? 1 : rng.range(0.6, 0.9));
        const o = { rot, repeat: k, gap };
        out.add(cyl(c.x, c.z, 0, w, w, top, 'accent', o));
        if (culm) {
          // Canes are jointed, and leaf out near the top.
          out.add(cyl(c.x, c.z, top * 0.3, w * 1.35, w * 1.35, 0.05, 'accent', o));
          out.add(cyl(c.x, c.z, top * 0.62, w * 1.35, w * 1.35, 0.05, 'accent', o));
          out.add(dome(c.x, c.z, top * 0.8, Math.min(0.3, gap * 1.3 + 0.08), 0.1, Math.max(0.05, top * 0.2), 'accent', o));
        } else if (j === 0) headed(z, top, k, gap, rot);
      }
      // A few leaves lean out of the stand.
      const leaves = culm ? 2 : 2 + Math.round(lean * 3);
      for (let i = 0; i < leaves; i++) {
        const a = a0 + i * GOLD;
        out.extra(blade(polar(ORIGIN, a, S * 0.15), a, 0, clamp(lean * 0.3 + 0.05, 0.05, 0.3), 0.03, H * rng.range(0.35, 0.6), 'accent'));
      }
      if (culm) headed(0, H * 1.05, 2, S * 0.3, r0 + 45);
      return out.list;
    }

    // Ribbons: strands of lobes that sway as they rise.
    const strands = clamp(Math.round(n / 2), 2, 6);
    const lw = clamp(S * 0.22, 0.06, 0.2);
    for (let i = 0; i < strands; i++) {
      const a = a0 + i * GOLD;
      const o = polar(ORIGIN, a, i === 0 ? 0 : S * 0.5 * rng.range(0.35, 0.8));
      const h = H * (i === 0 ? 1 : rng.range(0.55, 0.9));
      out.add(...lobes(o, a + 1.3, h, lw, lean * 0.1, 3, 'accent'));
      if (glow > 0 && i < Math.max(1, Math.round(glow * strands))) out.extra(sph(o.x, o.z, h * 0.98, 0.06, 0.06, 0.07, 'glow'));
      else if (heads !== 'none' && i < 3) out.extra(sph(o.x, o.z, h * 0.98, 0.07, 0.07, 0.08, 'trim'));
    }
    out.extra(sph(0, 0, 0, S * 0.4, S * 0.35, 0.06, 'wall2'));
    return out.list;
  },
);

export const vine = skel(
  'vine', 'nature', 'Strands that hang from a bough, climb a post, fall down a rock face or rise free.',
  ['liana curtain', 'ivy fall', 'hanging moss', 'cables', 'kelp strands', 'wisteria'],
  [
    C('support', ['bough', 'post', 'rock', 'free'], 'bough', 'what carries the strands'),
    N('length', 0.4, 5, 1.6, 'height of the hang or climb'),
    N('strands', 2, 10, 5, 'strands'),
    N('sag', 0, 1, 0.4, '0 level curtain, 1 long in the middle'),
    N('leaves', 0, 1, 0.6, 'leaf cover; 0 bare cable'),
    N('flowers', 0, 1, 0, 'flowers'),
    N('glow', 0, 1, 0, 'glowing buds'),
  ],
  (d, rng) => {
    const support = str(d, 'support');
    const L = num(d, 'length');
    const n = int(d, 'strands');
    const sag = num(d, 'sag');
    const leaves = num(d, 'leaves');
    const flowers = num(d, 'flowers');
    const glow = num(d, 'glow');
    const out = new Parts();
    const strandTone: PartTone = leaves > 0.15 ? 'accent' : 'wall2';
    const budTone: PartTone = glow > 0 ? 'glow' : 'trim';
    const budded = flowers > 0.1 || glow > 0;
    const a0 = rng.range(0, TAU);

    /** Groups of strands hung from `top` along x at depth z: the middle group long, the outer ones shorter with sag. */
    const curtain = (z: number, top: number, halfSpan: number, cx = 0): void => {
      const nC = Math.max(1, Math.round(n * 0.4));
      const nS = Math.floor((n - nC) / 2);
      const groups: { x: number; k: number; span: number; len: number }[] = [
        { x: cx, k: nC, span: halfSpan * 0.7, len: top * 0.9 },
      ];
      if (nS > 0) {
        const len = top * 0.9 * (1 - 0.65 * sag) * rng.range(0.85, 1);
        groups.push({ x: cx - halfSpan * 0.72, k: nS, span: halfSpan * 0.4, len }, { x: cx + halfSpan * 0.72, k: nS, span: halfSpan * 0.4, len: len * rng.range(0.75, 1) });
      }
      groups.forEach((gr, gi) => {
        const len = Math.max(0.1, gr.len);
        const o = { repeat: gr.k, gap: gr.k > 1 ? gr.span / (gr.k - 1) : 0 };
        const zz = z + (gi === 0 ? 0 : 0.015);
        out.add(box(gr.x, zz, top - len, 0.025, 0.025, len, strandTone, o));
        const lw = clamp(0.05 + leaves * 0.07, 0.05, 0.12);
        if (leaves > 0.15) out.extra(sph(gr.x, zz, top - len * 0.4, lw, lw * 0.7, Math.max(0.05, len * 0.16), 'accent', o));
        if (leaves > 0.55) out.extra(sph(gr.x, zz, top - len * 0.82, lw * 0.8, lw * 0.6, Math.max(0.05, len * 0.12), 'accent', o));
        if (budded && (gi === 0 || flowers > 0.5)) out.extra(sph(gr.x, zz, Math.max(0, top - len - 0.03), 0.06, 0.06, 0.07, budTone, o));
      });
    };

    if (support === 'bough') {
      // A dead trunk holds one long limb out to the side; the strands hang from its underside.
      const th = clamp(0.05 + L * 0.012, 0.06, 0.1);
      const tg = clamp(0.09 + L * 0.015, 0.1, 0.16);
      const base: P2 = { x: -0.4, z: 0 };
      const st = stem(base, L * 1.25, tg, tg * 0.6, 0.06, 0, 3, 'wall2');
      out.add(cone(base.x, base.z, 0, tg * 2, tg * 1.8, Math.max(0.05, tg * 1.3), 'wall2'), ...st.parts);
      const crownAt = st.at(L * 1.25);
      out.add(wedge(crownAt.x, crownAt.z, L * 1.25, tg * 0.5, tg * 0.4, Math.max(0.05, L * 0.1), 'wall2', { rot: rng.range(0, 360) }));
      out.add(box(0.06, 0.01, L, 0.9, th, th, 'wall2'));
      out.add(blade({ x: 0.4, z: 0.01 }, 0, L, 0.1, th * 0.8, Math.max(0.05, L * rng.range(0.15, 0.3)), 'wall2'));
      out.add(blade(st.at(L * 0.8), Math.PI + rng.range(-0.6, 0.6), L * 0.8, 0.1, th * 0.8, Math.max(0.05, L * 0.3), 'wall2'));
      if (leaves > 0.3) out.extra(sph(rng.range(0, 0.25), 0.01, L + th * 0.5, 0.34, 0.14, Math.max(0.05, th * 1.4), 'accent'));
      curtain(0.01, L, 0.3, 0.1);
      return out.list;
    }

    if (support === 'rock') {
      // A slab of rock with growth massed along its top and spilling down the face.
      const depth = 0.34;
      out.add(box(0, -0.12, 0, 0.9, depth, L, 'wall2'), sph(-0.3, -0.1, 0, 0.5, 0.42, Math.max(0.05, L * 0.45), 'wall2'));
      out.add(box(0.12, -0.16, 0, 0.7, depth, L * rng.range(0.7, 0.9), 'wall2', { rot: rng.range(-16, -8) }), fin({ x: 0.3, z: -0.1 }, 0, 0, 0.2, 0.3, L * 0.5, 'wall2'));
      out.add(wedge(0.2, -0.14, L, 0.45, depth * 0.8, Math.max(0.05, L * 0.1), 'wall2', { rot: 180 }));
      if (leaves > 0.15) out.add(dome(0, -0.02, L, 0.86, 0.5, Math.max(0.05, 0.06 + leaves * 0.1), 'accent'));
      curtain(-0.12 + depth / 2 + 0.01, L, 0.36);
      return out.list;
    }

    if (support === 'post') {
      // A dead trunk wrapped in coils, leafed in lumps, with strands falling from its head.
      const g = clamp(0.1 + L * 0.02, 0.1, 0.2);
      const st = stem(ORIGIN, L, g, g * 0.65, 0.05, a0, 3, 'wall2');
      out.add(cone(0, 0, 0, g * 1.9, g * 1.9, Math.max(0.05, g), 'wall2'), ...st.parts);
      const coils = clamp(Math.round(n / 2), 1, 5);
      for (let k = 0; k < coils; k++) {
        const y = L * ((k + 0.6) / (coils + 0.6));
        const c = polar(st.at(y), a0 + k * GOLD, 0.015);
        const w = st.width(y) * rng.range(1.35, 1.6);
        out.add(ring(c.x, c.z, y, w, w * 0.9, 0.05, strandTone, { rot: k * 50 }));
      }
      const lumps = Math.round(leaves * 5);
      for (let k = 0; k < lumps; k++) {
        const y = L * rng.range(0.15, 0.9);
        const c = polar(st.at(y), a0 + k * GOLD + 1, st.width(y) * 0.5);
        out.extra(sph(c.x, c.z, y, 0.16, 0.12, Math.max(0.05, 0.1 + L * 0.03), k < Math.round(flowers * 3) ? budTone : 'accent', { rot: rng.range(0, 180) }));
      }
      const head = st.at(L);
      if (leaves > 0.4) out.extra(dome(head.x, head.z, L, g * 2.4, g * 2.2, Math.max(0.05, g * 0.9), 'accent'));
      const falls = Math.min(n, 6);
      for (let k = 0; k < falls; k++) {
        const len = Math.max(0.08, L * rng.range(0.2, 0.45) * (0.5 + sag));
        const y = Math.max(0, L - len);
        const c = polar(st.at(y + 0.001), a0 + k * GOLD + 2, st.width(y + 0.001) * 0.5);
        out.extra(box(c.x, c.z, y, 0.025, 0.025, len, strandTone));
      }
      if (glow > 0) out.extra(sph(head.x, head.z, L, 0.08, 0.08, 0.08, 'glow'));
      return out.list;
    }

    // Free: strands rise on their own from a holdfast.
    const k = Math.min(n, 5);
    out.add(sph(0, 0, 0, 0.4, 0.34, 0.07, 'wall2'));
    for (let i = 0; i < k; i++) {
      const a = a0 + i * GOLD;
      const o = polar(ORIGIN, a, i === 0 ? 0 : rng.range(0.12, 0.38));
      const h = L * (i === 0 ? 1 : rng.range(0.5, 0.9));
      out.add(...lobes(o, a + 1.3, h, clamp(0.06 + leaves * 0.1, 0.05, 0.16), 0.02 + sag * 0.06, 4, strandTone));
      if (budded && i < 3) out.extra(sph(o.x, o.z, h * 0.98, 0.06, 0.06, 0.07, budTone));
    }
    return out.list;
  },
);

