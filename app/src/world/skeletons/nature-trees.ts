// Trees: three structurally different families. Heights are in footprint units (the prop's size scales them).
// Tones: wall2 bark, accent foliage, roof dead fronds, trim blossom, fruit and snow, glow only when the glow dial is above 0.
import type { BlueprintPart } from '../spec';
import { box, C, clamp, cone, dome, lerp, N, num, pyr, ring, skel, sph, str, int, wedge } from './util';
import { blade, fin, GOLD, ORIGIN, Parts, polar, outward, spare, stem, TAU } from './nature-util';
import type { P2 } from './nature-util';

interface Mass { x: number; z: number; y: number; w: number; h: number; flat: boolean }

/** Where the surface of a crown mass is, as a share of its height, `r` (0..1 of its radius) from its axis. */
const topAt = (m: Mass, r: number): number => (m.flat ? Math.sqrt(1 - r * r) : 0.5 + 0.5 * Math.sqrt(1 - r * r));

export const broadleaf = skel(
  'broadleaf', 'nature', 'Trunk that forks into limbs, each carrying its own crown mass.',
  ['oak', 'kapok', 'baobab', 'banyan', 'acacia', 'dead tree', 'alien pod tree'],
  [
    N('height', 0.6, 5, 1.8, 'total height'),
    N('trunk', 0.15, 0.7, 0.4, 'bare trunk share'),
    N('girth', 0.06, 0.45, 0.14, 'trunk width'),
    N('limbs', 2, 5, 3, 'major limbs'),
    N('spread', 0.3, 1, 0.7, 'crown width'),
    C('crown', ['round', 'flat', 'tall', 'pods', 'bare'], 'round', 'crown masses'),
    N('buttress', 0, 1, 0.2, 'root fins'),
    N('hang', 0, 1, 0, 'vines, moss; 1 aerial roots'),
    N('lean', 0, 1, 0.15, 'trunk lean'),
    N('bloom', 0, 1, 0, 'blossom or fruit'),
    N('glow', 0, 1, 0, 'glowing fruit'),
  ],
  (d, rng) => {
    const H = num(d, 'height');
    const g = num(d, 'girth');
    const n = int(d, 'limbs');
    const S = num(d, 'spread');
    const crown = str(d, 'crown');
    const hang = num(d, 'hang');
    const bloom = num(d, 'bloom');
    const glow = num(d, 'glow');
    const buttress = num(d, 'buttress');
    const T = H * num(d, 'trunk');
    const zone = H - T;
    const leafy = crown === 'round' || crown === 'flat' || crown === 'tall';
    const out = new Parts();

    // The crown leans away from the foot, and the two are centred on the footprint between them.
    const dir = rng.range(0, TAU);
    const bend = num(d, 'lean') * 0.2;
    const foot = polar(ORIGIN, dir, -bend / 2);

    // Top mass first: it decides how far the trunk runs into the crown.
    const topH = crown === 'flat' ? Math.max(0.06, S * 0.24) : crown === 'tall' ? zone * 0.78 : zone * 0.6;
    const podW = S * 0.3;
    const trunkH = leafy ? H - topH * 0.9 : crown === 'pods' ? H - podW * 0.8 : H * 0.9;
    const st = stem(foot, trunkH, g, g * (leafy ? 0.6 : 0.4), bend, dir, spare(d) ? 1 : 3, 'wall2');
    out.add(cone(foot.x, foot.z, 0, g * 1.7, g * 1.7, Math.max(0.05, Math.min(T * 0.5, g * 1.3)), 'wall2'), ...st.parts);
    const head = st.at(trunkH);

    const masses: Mass[] = [];
    const boughs: { c: P2; y: number; w: number; rot: number }[] = [];
    const a0 = rng.range(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * TAU) / n + rng.range(-0.35, 0.35);
      const yl = T + zone * 0.3 * ((i * 0.618 + 0.2) % 1);
      const r = S * 0.5 * rng.range(0.6, 0.95);
      const c = st.at(yl);
      const lg = Math.max(0.03, st.width(yl) * 0.5);
      const bare = crown === 'bare';
      const lw = r * (bare ? 0.75 : 0.6) + lg;
      const lc = polar(c, a, lw / 2 - lg / 2);
      // A limb runs out level from the trunk, then a bough climbs from its end to a tip `r` away.
      out.add(box(lc.x, lc.z, yl, lw, lg, Math.max(0.05, lg), 'wall2', { rot: outward(a) }));
      const bh = zone * rng.range(0.25, 0.4);
      out.add(blade(polar(c, a, r * (bare ? 0.7 : 0.55)), a, yl, r * (bare ? 0.3 : 0.45), lg * 0.9, bh, 'wall2'));
      boughs.push({ c: lc, y: yl, w: lw, rot: outward(a) });
      const tip = polar(c, a, r);
      const mid = polar(c, a, r * 0.8);
      if (crown === 'round') {
        const w = S * rng.range(0.5, 0.78);
        masses.push({ ...mid, y: yl + bh * 0.5, w, h: Math.min(w * 2.2, zone * rng.range(0.3, 0.45)), flat: false });
      } else if (crown === 'flat') {
        const w = S * rng.range(0.5, 0.75);
        masses.push({ ...mid, y: yl + bh, w, h: Math.max(0.05, w * 0.22), flat: true });
      } else if (crown === 'tall') {
        const w = S * rng.range(0.3, 0.42);
        masses.push({ ...mid, y: yl + bh * 0.3, w, h: zone * rng.range(0.5, 0.65), flat: false });
      } else if (crown === 'pods') {
        const w = Math.max(0.05, S * rng.range(0.2, 0.32));
        const h = w * rng.range(0.9, 1.3);
        masses.push({ ...tip, y: yl + bh - h * 0.3, w, h, flat: false });
      } else {
        // Bare: a twig stands off each limb part way along and leans its own way.
        out.add(blade(polar(c, a, r * 0.4), a + rng.range(1.2, 2.2), yl, r * 0.2, lg * 0.6, zone * rng.range(0.2, 0.35), 'wall2'));
      }
    }
    if (crown === 'round') masses.push({ ...head, y: H - topH, w: S * 0.9, h: topH, flat: false });
    else if (crown === 'flat') masses.push({ ...head, y: H - topH, w: Math.min(1.4, S * 1.15), h: topH, flat: true });
    else if (crown === 'tall') masses.push({ ...head, y: H - topH, w: S * 0.5, h: topH, flat: false });
    else if (crown === 'pods') masses.push({ ...head, y: H - podW * 0.9, w: podW, h: podW * 0.9, flat: false });
    else out.add(wedge(head.x, head.z, trunkH, g * 0.4, g * 0.3, H - trunkH, 'wall2', { rot: rng.range(0, 360) }));

    const lit = glow > 0 && crown === 'pods' ? Math.max(1, Math.round(glow * masses.length)) : 0;
    masses.forEach((m, i) => {
      const dd = m.w * (m.flat ? 0.9 : rng.range(0.85, 1));
      const rot = rng.range(0, 180);
      const tone = i < lit ? 'glow' : 'accent';
      out.add(m.flat ? dome(m.x, m.z, m.y, m.w, dd, m.h, tone, { rot }) : sph(m.x, m.z, m.y, m.w, dd, m.h, tone, { rot }));
    });

    if (buttress > 0.12) {
      const nb = buttress > 0.85 ? 5 : buttress > 0.55 ? 4 : 3;
      const b0 = rng.range(0, TAU);
      for (let j = 0; j < nb; j++) {
        const len = Math.min(0.42, g * (0.8 + 2.2 * buttress)) * rng.range(0.8, 1.1);
        out.extra(fin(polar(foot, b0 + (j * TAU) / nb, g * 0.25), b0 + (j * TAU) / nb, 0, len, Math.max(0.03, g * 0.28), Math.max(0.05, T * 0.75 * buttress), 'wall2'));
      }
    }

    if (hang > 0.05) {
      // Strands hang from under the two biggest masses, or from the limbs of a bare tree.
      const hosts = leafy
        ? [...masses].sort((p, q) => q.w - p.w).slice(0, 2).map((m) => ({ x: m.x, z: m.z, top: m.y + Math.min(0.12, m.h * 0.12), gap: m.w * 0.16, rot: rng.range(0, 180) }))
        : boughs.slice(0, 2).map((b) => ({ x: b.c.x, z: b.c.z, top: b.y, gap: b.w * 0.25, rot: b.rot }));
      for (const hst of hosts) {
        const roots = hang > 0.8;
        const len = roots ? hst.top : Math.min(hst.top, Math.max(0.06, hst.top * hang * rng.range(0.5, 0.9)));
        const w = roots ? 0.04 : 0.025;
        out.extra(box(hst.x, hst.z, hst.top - len, w, w, len, roots ? 'wall2' : 'accent', { rot: hst.rot, repeat: roots ? 3 : 5, gap: hst.gap * (roots ? 1.6 : 1) }));
      }
    }

    const dots = (m: Mass, tone: 'trim' | 'glow', k: number): BlueprintPart => {
      const s = clamp(m.w * (0.12 + 0.1 * k), 0.04, 0.16);
      return sph(m.x, m.z, m.y + m.h * topAt(m, 0.5) - s * 0.3, s, s, s, tone, { rot: rng.range(0, 180), repeat: 2, gap: m.w * 0.5 });
    };
    if (leafy && bloom > 0.05) for (const m of masses.slice(0, bloom > 0.5 ? 3 : 2)) out.extra(dots(m, 'trim', bloom));
    if (leafy && glow > 0) {
      // Lantern fruit under the crown.
      for (const m of masses.slice(-Math.max(1, Math.round(glow * 3)))) {
        const s = clamp(m.w * 0.16, 0.04, 0.12);
        out.extra(sph(m.x, m.z, Math.max(0, m.y + (m.flat ? 0 : m.h * 0.05) - s * 0.7), s, s, s, 'glow', { rot: rng.range(0, 180), repeat: 2, gap: m.w * 0.3 }));
      }
    }
    return out.list;
  },
);

export const conifer = skel(
  'conifer', 'nature', 'Straight trunk through stacked whorls that shrink upward.',
  ['pine', 'spruce', 'cedar', 'dead snag', 'crystal fir', 'cypress'],
  [
    N('height', 0.8, 5, 2.4, 'total height'),
    N('width', 0.25, 1, 0.6, 'lowest whorl width'),
    N('whorls', 2, 7, 4, 'tiers'),
    N('bare', 0, 0.7, 0.2, 'bare lower trunk share'),
    N('droop', 0, 1, 0.5, '0 level plates, 1 hanging skirts'),
    N('foliage', 0, 1, 1, '0 dead snag, 1 full'),
    C('cut', ['round', 'faceted'], 'round', 'whorl shape'),
    N('snow', 0, 1, 0, 'snow load'),
    N('lean', 0, 1, 0.1, 'trunk lean'),
    N('glow', 0, 1, 0, 'glowing cones'),
  ],
  (d, rng) => {
    const H = num(d, 'height');
    const W = num(d, 'width');
    const n = int(d, 'whorls');
    const droop = num(d, 'droop');
    const foliage = num(d, 'foliage');
    const faceted = str(d, 'cut') === 'faceted';
    const snow = num(d, 'snow');
    const glow = num(d, 'glow');
    const out = new Parts();
    const g = clamp(0.045 + H * 0.022, 0.05, 0.16);
    const dir = rng.range(0, TAU);
    const bend = num(d, 'lean') * 0.18;
    const foot = polar(ORIGIN, dir, -bend / 2);
    const bareH = H * num(d, 'bare');
    const s = (H - bareH) / n;
    const snag = foliage < 0.15;
    const topH = s * 1.3;
    const stemH = snag ? H * 0.94 : H - topH * 0.55;
    const st = stem(foot, stemH, g, g * 0.4, bend, dir, spare(d) ? 1 : 4, 'wall2');
    out.add(cone(foot.x, foot.z, 0, g * 1.9, g * 1.9, Math.max(0.05, g * 1.6), 'wall2'), ...st.parts);
    const phase = rng.next();
    const lit = Math.round(glow * 3);
    for (let i = 0; i < n; i++) {
      const top = i === n - 1;
      const t = n > 1 ? i / (n - 1) : 1;
      const y = top ? H - topH : bareH + i * s;
      const w = Math.max(0.06, W * lerp(1, 0.3, Math.pow(t, 0.9)) * rng.range(0.9, 1.08));
      const dd = w * rng.range(0.88, 1);
      const axis = st.at(Math.min(y, stemH - 0.01));
      const c = polar(axis, rng.range(0, TAU), Math.min(0.03, w * 0.06));
      const rot = rng.range(0, 90);
      const present = !snag && (foliage >= 0.7 || (top ? foliage >= 0.4 : (i * 0.618 + phase) % 1 < foliage));
      if (!present) {
        // A dead tier: broken boughs, thick at the trunk and sagging to nothing, no two pointing the same way.
        const sy = Math.min(y + s * 0.3, stemH - 0.06);
        const sa = phase * TAU + i * GOLD;
        const sh = clamp(s * 0.3, 0.05, 0.14);
        out.add(fin(axis, sa, sy, w * 0.45, 0.03, sh, 'wall2'));
        out.extra(fin(axis, sa + 2.5 + rot / 90, Math.min(sy + s * 0.25, stemH - 0.06), w * (i % 2 === 0 ? 0.36 : 0.24), 0.03, sh * 0.8, 'wall2'));
        continue;
      }
      const plate = !top && droop < 0.25;
      const h = top ? topH : plate ? Math.max(0.05, s * lerp(0.28, 0.42, droop * 4)) : s * lerp(0.95, 1.9, (droop - 0.25) / 0.75);
      const py = plate ? y + s * 0.25 : y;
      const shape = faceted ? pyr : plate ? dome : cone;
      out.add(shape(c.x, c.z, py, w, dd, h, 'accent', { rot }));
      // One bough per tier reaches past the rim and hangs, so no two tiers have the same outline.
      if (!top && !faceted) out.extra(fin(c, phase * TAU + i * GOLD, py, w * rng.range(0.58, 0.72), Math.max(0.04, w * 0.22), Math.max(0.05, h * (plate ? 0.9 : 0.45)), 'accent'));
      if (snow > 0.05) {
        // A cap that sits just proud of the upper part of the whorl.
        const f0 = plate ? 0.45 : lerp(0.6, 0.25, snow);
        const sw = plate ? w * 0.9 : w * (1 - f0) * 1.12 + 0.02;
        const sh = plate ? h * 0.7 : h * (1 - f0) + 0.03;
        out.extra(shape(c.x, c.z, py + h * f0, sw, sw * (dd / w), Math.max(0.05, sh), 'trim', { rot }));
      }
      if (i < lit && i < n - 1) {
        const gs = clamp(w * 0.12, 0.04, 0.1);
        out.extra(sph(c.x, c.z, Math.max(0, py - gs * 0.8), gs, gs, gs, 'glow', { rot: rot + 40, repeat: 2, gap: w * 0.7 }));
      }
    }
    if (snag) out.add(wedge(st.at(stemH).x, st.at(stemH).z, stemH, g * 0.4, g * 0.35, Math.max(0.05, H - stemH), 'wall2', { rot: rng.range(0, 360) }));
    return out.list;
  },
);

export const palm = skel(
  'palm', 'nature', 'Slender ringed trunk, curved, under a fountain of arching fronds.',
  ['coconut palm', 'date palm', 'cycad', 'tree fern', 'yucca', 'antenna plant'],
  [
    N('height', 0.1, 5, 2.6, 'trunk height; 0.1 fronds from the ground'),
    N('girth', 0.04, 0.3, 0.09, 'trunk width'),
    N('curve', 0, 1, 0.35, 'trunk curve'),
    N('crown', 0.4, 2, 1.4, 'crown width'),
    N('fronds', 3, 9, 6, 'fronds'),
    N('arch', 0, 1, 0.6, '0 upright spikes, 1 drooping'),
    N('skirt', 0, 1, 0.2, 'dead fronds under crown'),
    N('fruit', 0, 1, 0.3, 'fruit cluster'),
    N('glow', 0, 1, 0, 'glowing tip'),
  ],
  (d, rng) => {
    const H = num(d, 'height');
    const g = num(d, 'girth');
    const R = num(d, 'crown') / 2;
    const nF = int(d, 'fronds');
    const arch = num(d, 'arch');
    const skirt = num(d, 'skirt');
    const fruit = num(d, 'fruit');
    const glow = num(d, 'glow');
    const out = new Parts();
    const segs = spare(d) ? 1 : clamp(Math.round(H / 0.3), 1, 5);
    const segH = H / segs;
    const dir = rng.range(0, TAU);
    const bend = Math.min(num(d, 'curve') * 0.28, H * 0.4, 1 - R);
    const foot = polar(ORIGIN, dir, -bend / 2);
    const st = stem(foot, H, g * 1.15, g * 0.85, bend, dir, segs, 'wall2');
    out.add(cone(foot.x, foot.z, 0, g * 2, g * 2, Math.max(0.05, Math.min(H * 0.3, g * 1.5)), 'wall2'), ...st.parts);
    // Ring scars where the segments meet.
    for (let k = 1; k < Math.min(segs, 4); k++) {
      const c = st.at(k * segH + 0.001);
      const w = st.width(k * segH + 0.001) * 1.3;
      out.add(ring(c.x, c.z, Math.max(0, k * segH - 0.025), w, w, 0.05, 'wall2'));
    }
    const top = st.at(H);
    const heartH = Math.max(0.05, g * 1.6);
    const heartY = Math.max(0, H - g * 0.6);
    out.add(sph(top.x, top.z, heartY, g * 1.4, g * 1.4, heartH, 'wall2'));

    const a0 = rng.range(0, TAU);
    const thick = clamp(R * 0.11, 0.04, 0.1);
    const reach = Math.min(R, 1 - bend - 0.04);
    for (let i = 0; i < nF; i++) {
      const tier = i % 3;
      const a = a0 + (i * TAU) / nF + rng.range(-0.2, 0.2);
      const L = Math.max(0.1, reach * ([1, 0.85, 0.6][tier] ?? 1) * rng.range(0.88, 1));
      const h = Math.max(0.05, L * lerp(1.1, 0.26, arch) * ([0.7, 1, 1.5][tier] ?? 1));
      const y = Math.max(0, H + ([-0.04, 0, 0.04][tier] ?? 0));
      const c = polar(top, a, L / 2 - 0.02);
      // A frond is one thin arch: it leaves the heart, peaks, and comes back down at its tip.
      out.add(dome(c.x, c.z, y, L, thick, h, 'accent', { rot: outward(a) }));
    }
    out.extra(cone(top.x, top.z, H, g * 0.8, g * 0.8, Math.max(0.05, R * lerp(1.3, 0.5, arch)), 'accent'));

    if (arch > 0.3) {
      // Older fronds hang below the crown.
      const dh = Math.min(R * 0.9 * (arch - 0.15), segH + 0.1, H * 0.6);
      if (dh >= 0.05) {
        for (let j = 0; j < 3; j++) {
          const a = a0 + 0.5 + j * GOLD;
          out.extra(fin(polar(top, a, -0.02), a, Math.max(0, H - g * 0.3 - dh), Math.min(0.9, R * rng.range(0.7, 0.9)), thick * 0.7, dh, 'accent'));
        }
      }
    }
    if (skirt > 0.1) {
      const sh = Math.min(H * 0.5 * skirt + 0.05, segH + 0.1, H);
      out.extra(cone(top.x, top.z, Math.max(0, heartY - sh + 0.02), g * lerp(1.6, 2.8, skirt), g * lerp(1.6, 2.8, skirt), sh, 'roof'));
    }
    if (fruit > 0.15) {
      const fs = clamp(g * lerp(0.7, 1.3, fruit), 0.04, 0.14);
      out.extra(sph(top.x, top.z, Math.max(0, heartY - fs * 0.9), fs, fs, fs, 'trim', { rot: rng.range(0, 180), repeat: fruit > 0.6 ? 3 : 2, gap: g * 0.7 + fs * 0.4 }));
    }
    if (glow > 0) {
      const gs = clamp(0.05 + glow * 0.1, 0.05, 0.15);
      out.extra(sph(top.x, top.z, H + heartH * 0.2, gs, gs, gs, 'glow'));
    }
    return out.list;
  },
);
