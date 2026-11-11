// Structure skeletons, part three: land forms, remains, and things that span, climb or lift.
// Big masses stand on a low footing (SILL) so that the dressing pass does not take them for house walls.
import type { BlueprintPart, PartTone } from '../spec';
import { arch, box, C, clamp, cone, cyl, dome, gable, int, lerp, N, num, pyr, ring, SILL, skel, sph, str, wedge } from './util';

interface Bed { x: number; z: number; y: number; w: number; d: number; h: number; front: number }

export const cliff = skel(
  'cliff', 'structure', 'Rock face in stacked beds.',
  ['mesa wall', 'quarry face', 'glacier front', 'canyon side', 'coral wall', 'crater rim', 'sea stack'],
  [
    N('height', 3, 26, 10, 'm'),
    N('beds', 1, 6, 3, ';layers'),
    N('overhang', 0, 1, 0.3, '0 steps back, 1 leans out'),
    N('ledges', 0, 4, 1, ';shelves'),
    N('cleft', 0, 1, 0, 'splits it in two'),
    N('crest', 0, 6, 0, 'teeth on top'),
    N('talus', 0, 1, 0.4, 'scree at the foot'),
  ],
  (d, rng) => {
    const H = num(d, 'height');
    const n = int(d, 'beds');
    const ov = num(d, 'overhang');
    const ledges = int(d, 'ledges');
    const cleft = num(d, 'cleft');
    const crest = int(d, 'crest');
    const talus = num(d, 'talus');
    const split = cleft > 0.25;
    const cw = split ? 0.05 + cleft * 0.2 : 0;
    const out: BlueprintPart[] = [box(0, -0.06, 0, 1, 0.88, SILL, 'wall2')];
    const weights = Array.from({ length: n }, () => rng.range(0.6, 1.4));
    const total = weights.reduce((a, b) => a + b, 0);
    const beds: Bed[] = [];
    let y = SILL;
    weights.forEach((wt, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const front = lerp(0.26 - 0.3 * t, 0.04 + 0.36 * t * t, ov) + rng.range(-0.03, 0.03);
      const w = rng.range(0.84, 1);
      const h = ((H - SILL) * wt) / total;
      beds.push({ x: (rng.range(-1, 1) * (1 - w)) / 2, z: (front - 0.5) / 2, y, w, d: front + 0.5, h, front });
      y += h;
    });
    /** Width of one half of a bed when the face is split. */
    const half = (b: Bed): number => (b.w - cw) / 2;
    const lay = (b: Bed, at: number, h: number, tone: PartTone, grow = 0): BlueprintPart =>
      split
        ? box(b.x, b.z, at, half(b) + grow, b.d + grow, h, tone, { repeat: 2, gap: half(b) + cw })
        : box(b.x, b.z, at, b.w + grow, b.d + grow, h, tone);
    beds.forEach((b, i) => {
      out.push(lay(b, b.y, b.h, i % 2 === 0 ? 'wall' : 'wall2'));
      if (i > 0 && b.h > 0.5) out.push(lay(b, b.y - 0.08, 0.16, 'dark', 0.012));
    });
    // A single bed still shows one parting across its face.
    if (n === 1) {
      const b = beds[0] as Bed;
      out.push(lay(b, b.y + b.h * rng.range(0.35, 0.65), 0.16, 'dark', 0.012));
    }
    const topBed = beds[n - 1] as Bed;
    const peak = topBed.y + topBed.h;
    const high = rng.chance(0.5) ? 1 : -1;
    if (crest === 0) out.push(lay(topBed, peak, 0.22, 'trim', 0.01));
    // A split face stands a bed higher on one side.
    if (split) out.push(box(topBed.x + (high * (half(topBed) + cw)) / 2, topBed.z, peak, half(topBed) * 0.9, topBed.d * 0.9, clamp(H * 0.14, 0.6, 3), 'wall'));
    if (crest > 0) {
      const th = clamp(H * rng.range(0.08, 0.2), 0.5, 4);
      const td = Math.min(topBed.d * 0.6, 0.3);
      if (split) {
        const k = Math.ceil(crest / 2);
        const g = (half(topBed) * 0.9) / k;
        out.push(pyr(topBed.x - (high * (half(topBed) + cw)) / 2, topBed.z, peak, g * 0.9, td, th, 'wall2', { repeat: k, gap: g }));
      } else {
        const g = (topBed.w * 0.9) / crest;
        out.push(pyr(topBed.x, topBed.z, peak, g * 0.9, td, th, 'wall2', { repeat: crest, gap: g }));
      }
    }
    for (let k = 0; k < ledges; k++) {
      const b = beds[rng.int(0, n - 1)] as Bed;
      const room = split ? half(b) : b.w;
      const wl = Math.min(rng.range(0.14, 0.3), room * 0.8);
      const cx = split ? b.x + ((rng.chance(0.5) ? 1 : -1) * (half(b) + cw)) / 2 : b.x;
      out.push(box(cx + (rng.range(-1, 1) * (room - wl)) / 2, b.front + 0.04, b.y + b.h * rng.range(0.25, 0.8), wl, 0.14, 0.22, 'wall2'));
    }
    if (talus > 0.1) {
      const b0 = beds[0] as Bed;
      const reach = 0.1 + 0.14 * talus;
      const sx = rng.range(-0.25, 0.25);
      out.push(wedge(sx, b0.front + reach / 2 - 0.01, SILL, reach, 0.3 + 0.3 * talus, Math.min(H * 0.4, 1 + 3 * talus), 'wall2', { rot: 90 }));
      out.push(sph(-sx, Math.min(0.42, b0.front + 0.12), 0, 0.13, 0.11, 0.5 + talus * 0.7, 'wall', { repeat: 2 + Math.round(talus), gap: 0.2 }));
    }
    return out;
  },
);

export const cave = skel(
  'cave', 'structure', 'Dark mouth in a mound, rock face or bunker.',
  ['mine entrance', "dragon's den", 'bunker door', 'burrow', 'ice cave', 'sewer outfall', 'tomb'],
  [
    C('mass', ['mound', 'face', 'bunker'], 'mound', 'what the mouth is in'),
    N('height', 3, 14, 6, 'm'),
    N('width', 0.5, 1, 0.85, ';of the mass'),
    N('mouth', 0.15, 0.6, 0.3, ';opening width'),
    N('mouthHeight', 0.25, 0.8, 0.5, ';share of height'),
    C('frame', ['bare', 'rocks', 'beam', 'arch'], 'rocks', 'mouth surround'),
    N('teeth', 0, 8, 0, ';spikes in the mouth'),
    N('glow', 0, 1, 0, ';light within'),
    N('spill', 0, 1, 0.3, ';debris outside'),
  ],
  (d, rng) => {
    const mass = str(d, 'mass');
    const H = num(d, 'height');
    const Wm = num(d, 'width');
    const frame = str(d, 'frame');
    const teeth = int(d, 'teeth');
    const glow = num(d, 'glow');
    const spill = num(d, 'spill');
    const body = H - SILL;
    const mw = Math.min(num(d, 'mouth'), Wm * 0.6);
    const mh = clamp(body * num(d, 'mouthHeight') * (mass === 'mound' ? 0.8 : 1), 1.1, body - 0.6);
    const out: BlueprintPart[] = [];
    /** Front of the portal, and how far it runs back into the mass. */
    let zf: number;
    let L: number;
    if (mass === 'mound') {
      const zc = -0.06;
      const rz = 0.4 * Wm;
      const sx = rng.chance(0.5) ? 1 : -1;
      out.push(cyl(0, 0, 0, 1, 1, SILL, 'wall2'));
      out.push(dome(0, zc, SILL, Wm, 0.8 * Wm, body, 'wall'));
      out.push(dome(sx * Wm * 0.3, zc - 0.08, SILL, Wm * 0.5, 0.42, body * rng.range(0.45, 0.7), 'wall2'));
      out.push(dome(-sx * Wm * 0.32, zc + 0.02, SILL, Wm * 0.4, 0.36, body * rng.range(0.3, 0.5), 'wall'));
      // The portal runs back to where the hill is as high and as wide as the mouth.
      const inside = Math.sqrt(Math.max(0.04, 1 - (mh / body) ** 2 - (mw / Wm) ** 2));
      zf = zc + rz + 0.03;
      L = rz * (1 - inside) + 0.06;
    } else if (mass === 'face') {
      out.push(box(0, -0.04, 0, 1, 0.92, SILL, 'wall2'));
      const beds = H > 7 ? 3 : 2;
      const first = Math.min(body, Math.max(mh + 0.9, body / beds));
      let y = SILL;
      for (let i = 0; i < beds; i++) {
        const h = i === 0 ? first : (body - first) / (beds - 1);
        if (h < 0.3) break;
        const front = 0.12 - 0.05 * i + rng.range(-0.02, 0.02);
        const w = Wm * rng.range(0.9, 1);
        out.push(box((rng.range(-1, 1) * (1 - w)) / 2, (front - 0.5) / 2, y, w, front + 0.5, h, i % 2 === 0 ? 'wall' : 'wall2'));
        y += h;
      }
      zf = 0.19;
      L = 0.3;
    } else {
      const bw = Wm * 0.7;
      const berm = (1 - bw) / 2;
      out.push(box(0, 0, 0, 1, 1, SILL, 'wall2'));
      out.push(box(0, -0.1, SILL, bw, 0.6, body, 'wall'));
      out.push(wedge(-(bw + berm) / 2 + 0.01, -0.1, SILL, berm, 0.6, body * 0.8, 'wall2'));
      out.push(wedge((bw + berm) / 2 - 0.01, -0.1, SILL, berm, 0.6, body * 0.8, 'wall2', { rot: 180 }));
      out.push(box(0, -0.1, H, bw + 0.06, 0.66, 0.3, 'trim'));
      out.push(cyl(bw * 0.25, -0.2, H + 0.3, 0.05, 0.05, 1.2, 'dark'));
      zf = 0.26;
      L = 0.3;
    }
    const zm = zf - L / 2;
    /** Front face of the darkness: set back in a post-and-lintel surround, proud of an arched one. */
    let dark = zf - 0.012;
    if (frame === 'arch') {
      const t = 0.05;
      out.push(arch(0, zm, SILL, mw + 2 * t, L, mh + 0.5, 'trim'));
      out.push(arch(0, zm + 0.006, SILL, mw, L, mh, 'dark'));
      dark = zf + 0.006;
    } else {
      const t = frame === 'bare' ? 0.03 : frame === 'beam' ? 0.035 : 0.055;
      const tone: PartTone = frame === 'beam' ? 'dark' : frame === 'rocks' ? 'wall2' : 'wall';
      const lh = frame === 'beam' ? 0.35 : frame === 'rocks' ? 0.8 : 0.5;
      const over = frame === 'beam' ? 0.06 : 0.02;
      out.push(box(0, zm, SILL, t, L, mh, tone, { repeat: 2, gap: mw + t }));
      out.push(box(0, zm, SILL + mh, mw + 2 * t + over, L + over / 2, lh, tone));
      out.push(box(0, zm - 0.006, SILL, mw, L, mh, 'dark'));
      if (frame === 'rocks') out.push(sph(0, zf - 0.02, SILL, t * 2.2, 0.1, mh * 0.5, 'wall', { repeat: 2, gap: mw + t * 2.4 }));
    }
    if (teeth > 0) {
      const g = (mw * 0.9) / teeth;
      const tw = Math.min(0.05, g * 0.65);
      out.push(cone(0, dark - 0.03, SILL, tw, tw, mh * rng.range(0.15, 0.3), 'trim', { repeat: teeth, gap: g }));
      if (frame !== 'arch' && teeth > 1) {
        const len = mh * rng.range(0.12, 0.25);
        out.push(cyl(0, dark - 0.03, SILL + mh - len, tw * 0.6, tw * 0.6, len, 'trim', { repeat: teeth - 1, gap: g }));
      }
    }
    if (glow > 0.05) {
      out.push(glow < 0.5
        ? sph(0, dark - 0.006, SILL + mh * 0.55, 0.035, 0.02, 0.25, 'glow', { repeat: 2, gap: mw * 0.3 })
        : box(0, dark - 0.006, SILL, mw * 0.7, 0.02, mh * 0.5 * glow, 'glow'));
    }
    if (spill > 0.1) {
      const px = clamp((rng.chance(0.5) ? 1 : -1) * (mw / 2 + 0.16), -0.42, 0.42);
      out.push(cone(px, Math.min(0.43, zf + 0.06), 0, 0.16 + 0.1 * spill, 0.14, 0.4 + 1.3 * spill, 'wall2'));
      out.push(sph(-px, Math.min(0.44, zf + 0.08), 0, 0.09, 0.08, 0.3 + 0.3 * spill, 'wall', { repeat: 2, gap: 0.12 }));
    }
    // A timbered mouth has a track running out of it.
    if (frame === 'beam') out.push(box(0, (zf + 0.5) / 2, SILL, 0.02, 0.5 - zf, 0.07, 'dark', { repeat: 2, gap: mw * 0.4 }));
    return out;
  },
);

export const ruin = skel(
  'ruin', 'structure', 'Remains of a hall: wall stubs, one piece still standing.',
  ['temple ruin', 'bombed house', 'abandoned outpost', 'sunken shrine', 'burnt barn', 'fallen keep', 'dead reactor hall'],
  [
    N('decay', 0.15, 1, 0.6, ';how far gone'),
    N('storeys', 1, 3, 1, ';it once had'),
    N('width', 0.5, 0.95, 0.85, ';plan'),
    C('standing', ['none', 'gable', 'arch', 'chimney', 'tower'], 'gable', 'what still stands whole'),
    N('columns', 0, 8, 0, ';stumps inside'),
    N('rubble', 0, 1, 0.5, ';fallen blocks'),
    N('overgrowth', 0, 1, 0.3, ';plants'),
  ],
  (d, rng) => {
    const decay = num(d, 'decay');
    const full = int(d, 'storeys') * 3;
    const W = num(d, 'width');
    const standing = str(d, 'standing');
    const cols = int(d, 'columns');
    const rubble = num(d, 'rubble');
    const og = num(d, 'overgrowth');
    const D = 0.74;
    const t = 0.07;
    const F = 0.2;
    const stub = (): number => Math.max(0.5, full * (1 - decay * rng.range(0.35, 1)));
    const out: BlueprintPart[] = [box(0, 0, 0, W + 0.04, D + 0.04, F, 'wall2')];
    const zb = -D / 2 + t / 2;
    const zfw = D / 2 - t / 2;
    if (standing === 'gable') {
      out.push(box(0, zb, 0, W, t, full, 'wall'));
      out.push(gable(0, zb, full, t, W, clamp(W * 3.2, 1.5, 3.5), 'wall', { rot: 90 }));
      if (full >= 3) out.push(box(0, zb, 1.1, 0.07, t + 0.012, Math.min(1.6, full * 0.4), 'dark', { repeat: 2, gap: W * 0.4 }));
    } else {
      for (const i of [-1, 0, 1]) out.push(box((i * W) / 3, zb, 0, W / 3, t, stub(), 'wall'));
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) out.push(box(sx * (W / 2 - t / 2), (sz * D) / 4, 0, t, D / 2, stub(), 'wall'));
    }
    const sw = W * 0.28;
    for (const sx of [-1, 1]) out.push(box(sx * (W / 2 - sw / 2), zfw, 0, sw, t, stub() * 0.7, 'wall'));
    if (standing === 'arch') {
      out.push(box(0, zfw, 0, 0.07, t + 0.02, 2.8, 'trim', { repeat: 2, gap: 0.24 }));
      out.push(arch(0, zfw, 2.8, 0.31, t + 0.02, 1.3, 'trim'));
    } else if (standing === 'chimney') {
      out.push(box(-W * 0.25, zb + 0.07, 0, 0.1, 0.12, full + 1.8, 'wall2'));
      out.push(box(-W * 0.25, zb + 0.07, full + 1.8, 0.13, 0.15, 0.2, 'trim'));
    } else if (standing === 'tower') {
      const th = full * 1.4 * (1 - decay * 0.3);
      const tx = W / 2 - 0.1;
      const tz = zb + 0.08;
      out.push(box(tx, tz, 0, 0.24, 0.24, th, 'wall2'));
      out.push(wedge(tx, tz, th, 0.24, 0.24, 1.2, 'wall2', { rot: rng.pick([0, 90, 180]) }));
      out.push(box(tx, tz + 0.124, th * 0.5, 0.04, 0.02, 1.2, 'dark'));
    }
    if (cols > 0) {
      const colH = (): number => Math.max(0.4, full * (1 - decay * rng.range(0.4, 0.9)));
      const a = Math.ceil(cols / 2);
      const b = Math.floor(cols / 2);
      out.push(cyl(0, -D * 0.18, F, 0.06, 0.06, colH(), 'trim', { repeat: a, gap: (W * 0.7) / a }));
      if (b > 0) out.push(cyl(0, D * 0.18, F, 0.06, 0.06, colH(), 'trim', { repeat: b, gap: (W * 0.7) / b }));
      out.push(cyl(rng.range(-0.2, 0.2) * W, 0.02, F, 0.09, 0.09, 0.35, 'trim'));
    }
    const blocks = Math.round(rubble * 5);
    for (let i = 0; i < blocks; i++) {
      const o = { rot: rng.range(0, 90) };
      const tone: PartTone = rng.chance(0.5) ? 'wall' : 'wall2';
      const w = rng.range(0.06, 0.15);
      const dd = rng.range(0.05, 0.11);
      const h = rng.range(0.25, 0.7);
      // Most lie on the floor inside; some have fallen out in front.
      if (i % 3 === 2) out.push(box(rng.range(-1, 1) * (W / 2 - 0.1), D / 2 + 0.07, 0, w, dd, h, tone, o));
      else out.push(box(rng.range(-1, 1) * (W / 2 - 0.14), rng.range(-1, 1) * (D / 2 - 0.14), F, w, dd, h, tone, o));
    }
    const growth = Math.round(og * 4);
    for (let i = 0; i < growth; i++) {
      const sx = i % 2 === 0 ? 1 : -1;
      out.push(sph(clamp(sx * (W / 2 + 0.03), -0.46, 0.46), rng.range(-0.3, 0.3), 0, rng.range(0.14, 0.24), rng.range(0.14, 0.2), rng.range(0.5, 1.3), 'accent'));
    }
    if (og > 0.7) {
      const gx = rng.range(-0.5, 0.5) * (W / 2 - 0.15);
      out.push(cyl(gx, 0.05, F, 0.04, 0.04, 1, 'wall2'));
      out.push(cone(gx, 0.05, F + 0.8, 0.22, 0.22, 2.2 + full * 0.3, 'accent'));
    }
    return out;
  },
);

export const bridge = skel(
  'bridge', 'structure', 'Deck across a gap. It spans between two abutments.',
  ['aqueduct', 'footbridge', 'pipeline', 'skywalk', 'causeway', 'rope crossing', 'rail viaduct'],
  [
    C('type', ['beam', 'arch', 'suspension', 'rope', 'truss', 'pipe'], 'beam', 'how it spans'),
    N('rise', 1, 10, 3.5, 'm;deck height'),
    N('deck', 0.12, 0.6, 0.3, ';width'),
    N('piers', 0, 5, 2, ';supports or arches'),
    N('towers', 0, 12, 0, 'm;above the deck'),
    C('rails', ['none', 'posts', 'walls'], 'posts', 'deck edge'),
    C('under', ['ground', 'water', 'void'], 'ground', 'what it crosses'),
    N('lamps', 0, 6, 0, ';deck lights'),
  ],
  (d) => {
    const type = str(d, 'type');
    const rise = num(d, 'rise');
    const dk = num(d, 'deck');
    const piers = int(d, 'piers');
    const towers = num(d, 'towers');
    const rails = str(d, 'rails');
    const under = str(d, 'under');
    const lamps = int(d, 'lamps');
    const top = rise + 0.3;
    const out: BlueprintPart[] = [];
    if (under !== 'ground') out.push(box(0, 0, 0, 0.6, 1, 0.06, under === 'water' ? 'glass' : 'dark'));
    const pads = (): void => {
      out.push(box(0, 0, 0, 0.18, dk + 0.14, SILL, 'wall2', { repeat: 2, gap: 0.82 }));
    };
    const ends = (): void => {
      pads();
      out.push(box(0, 0, SILL, 0.14, dk + 0.08, rise - SILL, 'wall', { repeat: 2, gap: 0.86 }));
    };
    const deck = (): void => {
      out.push(box(0, 0, rise, 1, dk, 0.3, 'wall2'));
    };
    switch (type) {
      case 'arch': {
        const k = Math.max(1, piers);
        out.push(box(0, 0, 0, 1, dk + 0.1, SILL, 'wall2'));
        out.push(box(0, 0, SILL, 1, dk, rise - SILL, 'wall'));
        out.push(arch(0, 0, SILL, (0.9 / k) * 0.72, dk + 0.016, Math.max(0.4, rise - SILL - 0.3), 'dark', { repeat: k, gap: 0.9 / k }));
        out.push(box(0, 0, rise, 1, dk + 0.04, 0.3, 'trim'));
        break;
      }
      case 'suspension': {
        const tH = Math.max(towers, 4);
        ends();
        deck();
        for (const sx of [-1, 1]) out.push(box(sx * 0.27, 0, 0, 0.035, 0.035, top + tH, 'trim', { rot: 90, repeat: 2, gap: dk + 0.04 }));
        out.push(box(0, 0, top + tH - 0.5, 0.04, dk + 0.1, 0.4, 'trim', { repeat: 2, gap: 0.54 }));
        // Stays as thin triangular webs in the centre plane, falling from each tower head to the deck.
        out.push(wedge(-0.135, 0, top, 0.25, 0.02, tH - 0.6, 'dark', { rot: 180 }));
        out.push(wedge(-0.385, 0, top, 0.21, 0.02, tH - 0.6, 'dark'));
        out.push(wedge(0.135, 0, top, 0.25, 0.02, tH - 0.6, 'dark'));
        out.push(wedge(0.385, 0, top, 0.21, 0.02, tH - 0.6, 'dark', { rot: 180 }));
        break;
      }
      case 'rope': {
        const sag = clamp(rise * 0.12, 0.2, 0.7);
        pads();
        for (const sx of [-1, 1]) out.push(box(sx * 0.47, 0, 0, 0.03, 0.03, rise + 1.2, 'dark', { rot: 90, repeat: 2, gap: dk }));
        for (const sz of [-1, 1]) out.push(box(0, (sz * dk) / 2, rise - sag, 0.94, 0.02, sag + 0.95, 'dark'));
        for (const sx of [-1, 1]) out.push(box(sx * 0.31, 0, rise - 0.3 * sag - 0.08, 0.05, dk * 0.92, 0.08, 'wall2', { repeat: 5, gap: 0.062 }));
        out.push(box(0, 0, rise - sag, 0.05, dk * 0.92, 0.08, 'wall2', { repeat: 5, gap: 0.062 }));
        break;
      }
      case 'truss': {
        const tr = clamp(rise * 0.5 + 1.5, 2, 5);
        ends();
        deck();
        for (const sz of [-1, 1]) {
          out.push(box(0, sz * (dk / 2 - 0.015), top, 0.025, 0.03, tr, 'dark', { repeat: 7, gap: 0.155 }));
          out.push(box(0, sz * (dk / 2 - 0.015), top + tr, 0.98, 0.03, 0.25, 'dark'));
        }
        out.push(box(0, 0, top + tr, 0.03, dk, 0.2, 'dark', { repeat: 4, gap: 0.3 }));
        break;
      }
      case 'pipe': {
        const pd = dk * 0.6;
        const ph = clamp(pd * 8, 0.6, 4);
        ends();
        if (piers > 0) out.push(box(0, 0, 0, 0.05, pd + 0.06, rise, 'trim', { repeat: piers, gap: 0.7 / piers }));
        out.push(arch(0, 0, rise, pd, 1, ph, 'wall', { rot: 90 }));
        out.push(box(0, 0, rise, 0.02, pd + 0.025, ph + 0.04, 'trim', { repeat: 5, gap: 0.22 }));
        if (rails !== 'none') out.push(box(0, pd / 2 + 0.03, rise, 1, 0.05, 0.1, 'dark'));
        break;
      }
      default: {
        ends();
        out.push(box(0, 0, rise - 0.45, 0.9, dk * 0.5, 0.45, 'dark'));
        if (piers > 0) out.push(box(0, 0, 0, 0.05, dk * 0.7, rise - 0.45, 'trim', { repeat: piers, gap: 0.7 / piers }));
        deck();
      }
    }
    const decked = type === 'beam' || type === 'arch' || type === 'suspension';
    if (decked && rails === 'posts') {
      for (const sz of [-1, 1]) {
        out.push(box(0, sz * (dk / 2 - 0.012), top, 0.02, 0.02, 0.9, 'dark', { repeat: 11, gap: 0.095 }));
        out.push(box(0, sz * (dk / 2 - 0.012), top + 0.85, 0.98, 0.02, 0.07, 'dark'));
      }
    } else if (decked && rails === 'walls') {
      for (const sz of [-1, 1]) out.push(box(0, sz * (dk / 2 - 0.015), top, 1, 0.03, 0.85, 'wall'));
    }
    if ((type === 'beam' || type === 'arch') && towers > 0.5) {
      // A gate frame over each end of the deck.
      for (const sx of [-1, 1]) out.push(box(sx * 0.44, 0, top, 0.05, 0.05, towers, 'wall', { rot: 90, repeat: 2, gap: dk - 0.05 }));
      out.push(box(0, 0, top + towers, 0.07, dk + 0.06, 0.5, 'trim', { repeat: 2, gap: 0.88 }));
    }
    if (lamps > 0 && type !== 'rope' && type !== 'pipe') {
      const g = 0.9 / lamps;
      out.push(box(0, dk / 2 - 0.03, top, 0.02, 0.02, 2.4, 'dark', { repeat: lamps, gap: g }));
      out.push(sph(0, dk / 2 - 0.03, top + 2.4, 0.035, 0.035, 0.28, 'glow', { repeat: lamps, gap: g }));
    }
    return out;
  },
);

export const stair = skel(
  'stair', 'structure', 'Climb to a platform.',
  ['fire escape', 'temple steps', 'gangway', 'ziggurat stair', 'loading ramp', 'spiral lookout stair', 'scaffold ladder'],
  [
    C('type', ['steps', 'ramp', 'ladder', 'spiral'], 'steps', 'how it climbs'),
    N('rise', 1.5, 14, 4, 'm'),
    N('flights', 1, 3, 1, 'switchbacks;or spiral turns'),
    N('width', 0.15, 0.5, 0.3, ';tread'),
    C('under', ['solid', 'open'], 'solid', 'mass beneath, or legs'),
    N('rails', 0, 2, 1, ';sides railed'),
    N('landing', 0.12, 0.3, 0.2, ';platform length'),
    C('top', ['none', 'canopy', 'gate', 'beacon'], 'none', 'what stands on the platform'),
  ],
  (d) => {
    const type = str(d, 'type');
    const rise = num(d, 'rise');
    const flights = int(d, 'flights');
    const width = num(d, 'width');
    const solid = str(d, 'under') === 'solid';
    const rails = int(d, 'rails');
    const land = num(d, 'landing');
    const top = str(d, 'top');
    const mass: PartTone = solid ? 'wall' : 'dark';
    const out: BlueprintPart[] = [];
    /** What stands on the top platform, centred on (px, pz), `pw` by `pd` across, floor at `y`. */
    const crown = (px: number, pz: number, pw: number, pd: number, y: number): void => {
      if (top === 'canopy') {
        for (const sx of [-1, 1]) out.push(box(px + sx * pw * 0.4, pz, y, 0.02, 0.02, 2.2, 'dark', { rot: 90, repeat: 2, gap: pd * 0.8 }));
        out.push(pyr(px, pz, y + 2.2, pw + 0.06, pd + 0.06, 0.9, 'roof'));
      } else if (top === 'gate') {
        out.push(box(px, pz, y, 0.03, 0.03, 2.5, 'trim', { rot: 90, repeat: 2, gap: pd * 0.8 }));
        out.push(box(px, pz, y + 2.5, 0.04, pd, 0.25, 'trim'));
      } else if (top === 'beacon') {
        out.push(cyl(px, pz, y, 0.03, 0.03, 1.6, 'dark'));
        out.push(sph(px, pz, y + 1.6, 0.07, 0.07, 0.5, 'glow'));
      }
    };
    if (type === 'ladder') {
      const yT = SILL + rise;
      const stages = clamp(flights, 1, 3);
      const pw = land * 2 + 0.2;
      const pd = width + 0.1;
      out.push(box(0, 0, 0, 0.6, 0.5, SILL, 'wall2'));
      out.push(box(0, -0.1, 0, 0.12, 0.12, yT, 'trim'));
      out.push(box(0, -0.02, SILL, 0.02, 0.02, rise + 1, 'dark', { repeat: 2, gap: 0.06 }));
      out.push(box(0, -0.02, SILL + 0.2, 0.05, 0.02, rise - 0.2, 'dark'));
      for (let k = 1; k <= 3; k++) out.push(ring(0, 0.03, SILL + (rise * k) / 4, 0.12, 0.12, 0.12, 'dark'));
      for (let s = 0; s < stages - 1; s++) {
        out.push(box((s % 2 === 0 ? 1 : -1) * 0.14, -0.1, SILL + (rise * (s + 1)) / stages - 0.2, 0.36, pd, 0.2, 'wall2'));
      }
      out.push(box(0, -0.1, yT - 0.2, pw, pd, 0.2, 'wall2'));
      if (rails > 0) out.push(ring(0, -0.1, yT + 0.7, pw, pd, 0.1, 'dark'));
      crown(0, -0.1, pw * 0.8, pd * 0.8, yT);
      return out;
    }
    if (type === 'spiral') {
      const R = clamp(width, 0.15, 0.42);
      const n = clamp(Math.round(rise / 0.5), 6, 16);
      const step = (270 * flights) / n;
      const yT = SILL + rise;
      out.push(cyl(0, 0, 0, Math.min(1, 2 * R + 0.16), Math.min(1, 2 * R + 0.16), SILL, 'wall2'));
      out.push(cyl(0, 0, 0, solid ? R * 0.8 : 0.07, solid ? R * 0.8 : 0.07, yT + 1.1, 'trim'));
      for (let k = 0; k < n; k++) {
        const a = (k * step * Math.PI) / 180;
        const r = R / 2 + 0.02;
        out.push(box(r * Math.cos(a), -r * Math.sin(a), SILL + (k * rise) / n, R, 0.09, 0.1, mass, { rot: k * step }));
      }
      out.push(cyl(0, 0, yT, 2 * R + 0.1, 2 * R + 0.1, 0.2, 'wall2'));
      if (rails > 0) out.push(ring(0, 0, yT + 0.9, 2 * R + 0.1, 2 * R + 0.1, 0.1, 'dark'));
      crown(0, 0, R * 1.4, R * 1.4, yT + 0.2);
      return out;
    }
    const F = Math.min(flights, Math.max(1, Math.floor(rise / 1.5)));
    const fr = rise / F;
    const lw = Math.min(width, 0.9 / F);
    const r0 = 0.5 - land;
    const run = 2 * r0;
    const laneZ = (i: number): number => (i - (F - 1) / 2) * lw;
    out.push(box(0, 0, 0, 1, F * lw + 0.08, SILL, 'wall2'));
    for (let i = 0; i < F; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const y0 = SILL + i * fr;
      const z = laneZ(i);
      const o = { rot: dir > 0 ? 0 : 180 };
      if (type === 'ramp') {
        if (solid && i > 0) out.push(box(0, z, SILL, run, lw * 0.96, y0 - SILL, 'wall'));
        out.push(wedge(0, z, y0, run, lw * 0.96, fr, mass, o));
        // A threshold strip where the ramp meets the ground or the landing below.
        out.push(box(dir * (-r0 + 0.02), z, y0, 0.04, lw * 0.96, 0.06, 'dark'));
      } else {
        const S = clamp(Math.round(fr / 0.45), 3, F === 1 ? 8 : F === 2 ? 5 : 4);
        const r = fr / S;
        for (let k = 0; k < S; k++) {
          const x = dir * (-r0 + ((k + 0.5) * run) / S);
          out.push(solid
            ? box(x, z, SILL, run / S, lw * 0.96, i * fr + (k + 1) * r, 'wall')
            : box(x, z, y0 + k * r, run / S, lw * 0.96, Math.max(0.12, r - 0.1), 'dark'));
        }
      }
      // A balustrade is a thin plate whose top edge runs parallel to the flight, 0.9 m above it.
      const sides = F === 1 ? (rails >= 2 ? [-1, 1] : rails === 1 ? [-1] : []) : rails === 0 ? [] : i === 0 ? [-1] : i === F - 1 ? [1] : [];
      for (const s of sides) out.push(wedge(0, z + s * lw * 0.47, y0 + 0.9, run, 0.02, fr, mass, o));
      const last = i === F - 1;
      const lx = dir * (r0 + land / 2);
      const lz = last ? z : (z + laneZ(i + 1)) / 2;
      const ld = last ? lw * 0.96 : lw * 1.96;
      const ly = y0 + fr;
      if (solid) out.push(box(lx, lz, SILL, land, ld, ly - SILL, 'wall'));
      else {
        out.push(box(lx, lz, ly - 0.25, land, ld, 0.25, 'dark'));
        out.push(box(lx, lz, SILL, 0.03, 0.03, ly - 0.25 - SILL, 'dark', { rot: 90, repeat: 2, gap: ld * 0.8 }));
      }
      if (last) crown(lx, lz, land, ld, ly);
    }
    return out;
  },
);

export const gantry = skel(
  'gantry', 'structure', 'Legs and a beam with a hanging load.',
  ['port crane', 'gallows', 'mine headframe', 'rocket gantry', 'well sweep', 'signal bridge', 'tower crane'],
  [
    C('frame', ['portal', 'jib', 'aframe', 'tower'], 'portal', 'leg arrangement'),
    N('height', 3, 24, 9, 'm;to the beam'),
    N('span', 0.3, 0.95, 0.7, ';beam length'),
    N('depth', 0.3, 3, 0.6, 'm;beam depth, a truss over 1.2'),
    C('load', ['none', 'hook', 'claw', 'crate', 'cage', 'bucket', 'lamps', 'pod'], 'hook', 'what hangs'),
    N('drop', 0, 1, 0.4, 'how low it hangs'),
    N('trolley', 0, 1, 0.5, 'load position'),
    C('cab', ['none', 'top', 'under'], 'none', 'operator cabin'),
  ],
  (d) => {
    const frame = str(d, 'frame');
    const H = num(d, 'height');
    const sp = num(d, 'span');
    const depth = num(d, 'depth');
    const load = str(d, 'load');
    const drop = num(d, 'drop');
    const cab = str(d, 'cab');
    const lw = clamp(0.03 + H * 0.002, 0.03, 0.07);
    const out: BlueprintPart[] = [];
    const beam = (x0: number, x1: number): void => {
      const xc = (x0 + x1) / 2;
      const w = x1 - x0;
      if (depth > 1.2) {
        const m = clamp(Math.round(w / 0.1), 2, 10);
        out.push(box(xc, 0, H, w, 0.08, 0.25, 'dark'));
        out.push(box(xc, 0, H + 0.25, 0.02, 0.06, depth - 0.5, 'dark', { repeat: m, gap: (w - 0.04) / (m - 1) }));
        out.push(box(xc, 0, H + depth - 0.25, w, 0.08, 0.25, 'dark'));
      } else out.push(box(xc, 0, H, w, 0.1, depth, 'wall2'));
    };
    /** The stretch of beam the load can hang from, and where a cabin goes. */
    let xa: number;
    let xb: number;
    let cx: number;
    if (frame === 'jib' || frame === 'tower') {
      const tower = frame === 'tower';
      const mx = tower ? -0.16 : -sp / 2;
      const mw = clamp((tower ? 0.07 : 0.05) + H * 0.003, 0.05, 0.14);
      const stay = H * 0.18 + 1;
      const tip = tower ? Math.min(0.5, mx + sp * 0.75) : sp / 2;
      out.push(box(mx, 0, 0, mw + 0.16, mw + 0.16, 0.3, 'wall2'));
      out.push(box(mx, 0, 0, mw, mw, H + depth + stay, 'trim'));
      if (tower) {
        const tail = Math.max(-0.5, mx - sp * 0.3);
        for (let k = 1; k <= 3; k++) out.push(box(mx, 0, (H * k) / 4, mw + 0.015, mw + 0.015, 0.2, 'dark'));
        beam(tail, tip);
        out.push(wedge((mx + tail) / 2, 0, H + depth, mx - tail, 0.02, stay, 'dark'));
        out.push(box(tail + 0.05, 0, H - 1.3, 0.1, 0.14, 1.3, 'dark'));
      } else beam(mx - mw / 2, tip);
      out.push(wedge((mx + tip) / 2, 0, H + depth, tip - mx, 0.02, stay, 'dark', { rot: 180 }));
      xa = mx + mw + 0.05;
      xb = tip - 0.04;
      cx = mx + mw / 2 + 0.06;
    } else if (frame === 'aframe') {
      const lx = 0.4 - (1 - sp) * 0.3;
      const back = sp * 0.7;
      out.push(box(0, 0, 0, 1, 0.5, SILL, 'wall2'));
      out.push(box(lx, 0, SILL, lw, lw, H - SILL, 'trim', { rot: 90, repeat: 2, gap: 0.24 }));
      for (const sz of [-1, 1]) out.push(wedge(lx - back / 2 - lw / 2 + 0.005, sz * 0.12, SILL, back, 0.03, (H - SILL) * 0.92, 'trim'));
      out.push(box(lx, 0, H - 0.3, lw * 1.4, 0.24 + lw, 0.3, 'trim'));
      beam(lx - 0.12, lx + 0.12);
      out.push(arch(lx + 0.02, 0, H + depth, 0.16, 0.03, 0.8, 'dark'));
      xa = lx - 0.05;
      xb = lx + 0.05;
      cx = lx - 0.02;
    } else {
      out.push(box(0, -0.22, 0, lw, lw, H, 'trim', { repeat: 2, gap: sp }));
      out.push(box(0, 0.22, 0, lw, lw, H, 'trim', { repeat: 2, gap: sp }));
      out.push(box(0, 0, 0, lw * 1.6, 0.6, 0.3, 'dark', { repeat: 2, gap: sp }));
      out.push(box(0, 0, H - 0.4, lw, 0.44 + lw, 0.4, 'trim', { repeat: 2, gap: sp }));
      if (H > 8) out.push(box(0, 0, H * 0.5, lw * 0.8, 0.44, 0.25, 'dark', { repeat: 2, gap: sp }));
      if (H >= 5) out.push(box(-sp / 2, -0.22 - lw / 2 - 0.01, 0.3, 0.035, 0.02, H - 0.3, 'dark'));
      beam(-sp / 2 - 0.04, sp / 2 + 0.04);
      xa = -sp / 2 + lw + 0.06;
      xb = sp / 2 - lw - 0.06;
      cx = -sp / 2 + 0.09;
    }
    if (load === 'lamps') {
      const n = clamp(Math.round((xb - xa) / 0.12) + 1, 2, 6);
      out.push(sph((xa + xb) / 2, 0, H - 0.35, 0.04, 0.04, 0.35, 'glow', { repeat: n, gap: (xb - xa) / (n - 1) }));
    } else {
      const x = lerp(xa, xb, num(d, 'trolley'));
      const size = load === 'crate' ? 1.6 : load === 'cage' ? 2.1 : load === 'bucket' ? 1.1 : load === 'pod' ? 2.2 : load === 'claw' ? 0.7 : 0.5;
      const yT = H - 0.3;
      const L = drop * Math.max(0, yT - size - 0.5);
      let yB = yT;
      out.push(box(x, 0, yT, 0.07, 0.14, 0.3, 'dark'));
      if (L >= 0.3) {
        out.push(box(x, 0, yT - L, 0.02, 0.02, L, 'dark'));
        yB = yT - L;
      }
      switch (load) {
        case 'hook': out.push(sph(x, 0, yB - 0.5, 0.05, 0.05, 0.5, 'dark')); break;
        case 'claw':
          out.push(cyl(x, 0, yB - 0.4, 0.08, 0.08, 0.4, 'dark'));
          out.push(ring(x, 0, yB - 0.7, 0.2, 0.2, 0.3, 'dark'));
          break;
        case 'crate': out.push(box(x, 0, yB - 1.6, 0.2, 0.24, 1.6, 'accent')); break;
        case 'cage':
          out.push(box(x, 0, yB - 0.12, 0.16, 0.2, 0.12, 'dark'));
          for (const sz of [-1, 1]) out.push(box(x, sz * 0.09, yB - 2, 0.02, 0.02, 1.88, 'dark', { repeat: 2, gap: 0.14 }));
          out.push(box(x, 0, yB - 2.1, 0.16, 0.2, 0.1, 'dark'));
          break;
        case 'bucket': out.push(cyl(x, 0, yB - 1.1, 0.14, 0.14, 1.1, 'wall2')); break;
        case 'pod':
          out.push(sph(x, 0, yB - 2.2, 0.2, 0.2, 2.2, 'wall'));
          out.push(box(x, 0.095, yB - 1.3, 0.06, 0.02, 0.4, 'glow'));
          break;
        default: break;
      }
    }
    if (cab === 'top') {
      out.push(box(cx, 0.06, H + depth, 0.1, 0.16, 1.7, 'wall2'));
      out.push(box(cx, 0.146, H + depth + 0.7, 0.08, 0.02, 0.7, 'glass'));
    } else if (cab === 'under') {
      out.push(box(cx, 0.1, H - 1.9, 0.1, 0.16, 1.9, 'wall2'));
      out.push(box(cx, 0.186, H - 1.2, 0.08, 0.02, 0.7, 'glass'));
    }
    return out;
  },
);
