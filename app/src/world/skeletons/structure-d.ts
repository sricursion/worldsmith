// Structure skeletons, part four: piles, masts, hollows, rows of columns, wrecks and skyline giants.
import type { BlueprintPart, PartTone } from '../spec';
import type { PartOpts } from './util';
import { arch, box, C, clamp, cone, cyl, dome, gable, int, lerp, N, NOMINAL, num, pyr, ring, SILL, skel, sph, str, turn, wedge } from './util';

export const stack = skel(
  'stack', 'structure', 'Pile of one repeated unit.',
  ['container stack', 'log pile', 'barrel store', 'hay stack', 'server racks', 'cairn', 'ammo dump'],
  [
    C('unit', ['box', 'cylinder', 'sphere'], 'box', 'unit shape'),
    N('across', 1, 6, 3, 'per row'),
    N('ranks', 1, 3, 1, 'rows deep'),
    N('tiers', 1, 6, 3, ';layers'),
    N('unitHeight', 0.3, 4, 1.5, 'm'),
    N('pyramid', 0, 1, 0, 'layers shrink'),
    N('jitter', 0, 1, 0.3, ';disorder'),
    C('cover', ['none', 'tarp', 'roof', 'rack'], 'none', 'what shelters or holds it'),
  ],
  (d, rng) => {
    const unit = str(d, 'unit');
    const across = int(d, 'across');
    const ranks = int(d, 'ranks');
    const tiers = int(d, 'tiers');
    const uh = num(d, 'unitHeight');
    const pyramid = num(d, 'pyramid');
    const jitter = num(d, 'jitter');
    const cover = str(d, 'cover');
    const g = 0.92 / across;
    const wU = g * 0.94;
    // A ball in a single rank is as long as the rank is deep: a log seen end on. Round units in several
    // ranks stay round, and the ranks close up to touch.
    const dU = unit === 'box' || (unit === 'sphere' && ranks === 1) ? (0.8 / ranks) * 0.92 : Math.min((0.8 / ranks) * 0.92, wU * 1.2);
    const gz = dU / 0.92;
    const vy = unit === 'sphere' ? uh * 0.82 : uh;
    const make = unit === 'cylinder' ? cyl : unit === 'sphere' ? sph : box;
    const out: BlueprintPart[] = [
      box(0, 0, 0, 0.98, 0.86, SILL, 'wall2'),
      // Chocks at both ends of the bottom row.
      box(0, 0, SILL, 0.02, ranks * gz * 0.8, Math.min(0.3, uh * 0.4), 'dark', { repeat: 2, gap: across * g + 0.02 }),
    ];
    let topN = across;
    let topR = ranks;
    for (let t = 0; t < tiers; t++) {
      const n = Math.max(1, across - Math.round(pyramid * t));
      const rk = Math.max(1, ranks - Math.round(pyramid * t * 0.5));
      for (let r = 0; r < rk; r++) {
        const tone: PartTone = unit === 'box' && (t + r) % 3 === 2 ? 'accent' : (t + r) % 2 === 1 ? 'wall2' : 'wall';
        const o: PartOpts = { repeat: n, gap: g, rot: t === 0 ? 0 : jitter * rng.range(-5, 5) };
        out.push(make(t === 0 ? 0 : jitter * rng.range(-0.3, 0.3) * wU, (r - (rk - 1) / 2) * gz, SILL + t * vy, wU, dU, uh, tone, o));
      }
      topN = n;
      topR = rk;
    }
    const yTop = SILL + (tiers - 1) * vy + uh;
    const rowW = (topN - 1) * g + wU;
    const depth = (topR - 1) * gz + dU;
    if (cover === 'none') {
      // Lashing over the top layer.
      out.push(box(0, 0, yTop, 0.02, depth + 0.02, 0.05, 'dark', { repeat: 2, gap: Math.max(0.04, rowW * 0.5) }));
    } else if (cover === 'tarp') {
      const fl = Math.min(uh * 0.8, 1.2);
      out.push(box(0, 0, yTop, rowW + 0.04, depth + 0.04, 0.1, 'accent'));
      out.push(box(0, depth / 2 + 0.012, yTop - fl, rowW + 0.04, 0.02, fl, 'accent'));
      out.push(box(rowW / 2 + 0.012, 0, yTop - fl * 0.6, 0.02, depth + 0.04, fl * 0.6, 'accent'));
    } else if (cover === 'roof') {
      for (const sz of [-1, 1]) out.push(box(0, sz * 0.43, 0, 0.03, 0.03, yTop + 0.8, 'dark', { repeat: 2, gap: 0.94 }));
      out.push(gable(0, 0, yTop + 0.8, 1.04, 0.94, 1.2, 'roof'));
    } else if (cover === 'rack') {
      const z0 = (ranks * gz) / 2 + 0.006;
      for (const sz of [-1, 1]) out.push(box(0, sz * z0, SILL, 0.02, 0.02, yTop - SILL + 0.3, 'dark', { repeat: across + 1, gap: g }));
      out.push(box(0, dU / 2 + ((ranks - 1) * gz) / 2 + 0.008, SILL + uh * 0.6, wU * 0.5, 0.02, 0.08, 'glow', { repeat: across, gap: g }));
    }
    return out;
  },
);

export const mast = skel(
  'mast', 'structure', 'Slender upright with crossarms. They carry what the world needs.',
  ['radio tower', 'ship mast', 'totem', 'pylon', 'floodlight tower', 'windmill', 'signal mast'],
  [
    N('height', 5, 27, 14, 'm'),
    C('shaft', ['pole', 'tapered', 'lattice', 'stacked'], 'pole', 'how the upright is built'),
    N('arms', 0, 4, 2, ';crossarms'),
    N('armLength', 0.2, 0.95, 0.6, ';span'),
    C('hang', ['none', 'sails', 'flags', 'lamps', 'dishes', 'wires', 'blades'], 'none', 'what the arms carry'),
    C('top', ['none', 'light', 'finial', 'nest', 'radome'], 'finial', 'crown'),
    N('stays', 0, 4, 0, 'foot fins'),
    C('base', ['pad', 'plinth', 'cabin'], 'pad', 'what it stands on'),
  ],
  (d, rng) => {
    const H = num(d, 'height');
    const shaft = str(d, 'shaft');
    const arms = int(d, 'arms');
    const armLength = num(d, 'armLength');
    const hang = str(d, 'hang');
    const top = str(d, 'top');
    const stays = int(d, 'stays');
    const base = str(d, 'base');
    const sw = clamp(0.035 + H * 0.0015, 0.04, 0.08);
    const out: BlueprintPart[] = [cyl(0, 0, 0, 0.5, 0.5, SILL, 'wall2')];
    /** Depth of a crossarm at a height: on a lattice it is a frame wide enough to bear on the legs there. */
    let armDepth = (_y: number): number => 0.03;
    if (shaft === 'tapered') {
      [1.8, 1.3, 0.8].forEach((k, i) => out.push(cyl(0, 0, (i * H) / 3, sw * k, sw * k, H / 3, 'trim')));
    } else if (shaft === 'lattice') {
      const lg = 0.02;
      const g1 = 0.16;
      const g2 = 0.07;
      const mid = H * 0.55;
      armDepth = (y) => (y < mid ? g1 : g2) + lg;
      for (const sz of [-1, 1]) out.push(box(0, (sz * g1) / 2, 0, lg, lg, mid, 'trim', { repeat: 2, gap: g1 }));
      out.push(box(0, 0, mid - 0.1, g1 + lg, g1 + lg, 0.15, 'dark'));
      for (const sz of [-1, 1]) out.push(box(0, (sz * g2) / 2, mid, lg, lg, H - mid, 'trim', { repeat: 2, gap: g2 }));
      out.push(box(0, 0, mid * 0.5, g1 + lg, g1 + lg, 0.1, 'dark'));
      out.push(box(0, 0, mid + (H - mid) * 0.5, g2 + lg, g2 + lg, 0.1, 'dark'));
      out.push(box(0, 0, H - 0.1, g2 + lg, g2 + lg, 0.1, 'dark'));
    } else if (shaft === 'stacked') {
      const k = clamp(Math.round(H / 2.2), 3, 8);
      const tones: PartTone[] = ['wall', 'accent', 'wall2', 'trim'];
      for (let i = 0; i < k; i++) {
        const w = rng.range(0.12, 0.24);
        const make = i % 3 === 1 ? cyl : box;
        out.push(make(0, 0, (i * H) / k, w, w * 0.9, H / k, tones[i % 4] ?? 'wall'));
        if (i === k - 2) out.push(box(0, (w * 0.9) / 2 + 0.004, (i * H) / k + (H / k) * 0.5, 0.03, 0.02, (H / k) * 0.2, 'glow', { repeat: 2, gap: w * 0.45 }));
      }
    } else out.push(cyl(0, 0, 0, sw, sw, H, 'trim'));

    const armY = (i: number): number => H * (0.92 - 0.18 * i);
    const crossed = hang === 'lamps' || hang === 'dishes' || hang === 'wires';
    for (let i = 0; i < arms; i++) {
      const y = armY(i);
      const len = hang === 'sails' ? armLength * (0.7 + 0.1 * i) : armLength * (1 - 0.12 * i);
      const rot = crossed && i % 2 === 1 ? 90 : 0;
      const ad = armDepth(y);
      out.push(box(0, 0, y, len, ad, 0.14, 'dark', { rot }));
      const side = i % 2 === 0 ? 1 : -1;
      // Offsets along the arm, turned with it.
      const at = (along: number, across: number): [number, number] => (rot === 90 ? [across, -along] : [along, across]);
      switch (hang) {
        case 'sails': {
          const sh = Math.min(H * 0.16, y - 2.5);
          if (sh >= 0.6) out.push(box(0, ad / 2 + 0.008, y - sh, len * 0.92, 0.02, sh, 'wall2'));
          break;
        }
        case 'flags': {
          const fh = rng.range(1.2, 2);
          out.push(box(side * len * 0.4, 0, y - fh, len * 0.16, 0.02, fh, 'accent'));
          break;
        }
        case 'lamps':
          out.push(sph(0, 0, y - 0.3, 0.05, 0.05, 0.3, 'glow', { rot, repeat: 2, gap: len * 0.9 }));
          break;
        case 'dishes': {
          const [dx, dz] = at(side * len * 0.42, ad / 2 + 0.01);
          out.push(sph(dx, dz, y + 0.14, 0.11, 0.035, 1, 'wall2', { rot }));
          break;
        }
        case 'wires':
          out.push(cyl(0, 0, y - 0.7, 0.02, 0.02, 0.7, 'glass', { rot, repeat: 2, gap: len * 0.92 }));
          break;
        default: break;
      }
    }
    if (hang === 'blades') {
      const hub = H * 0.9;
      const bl = armLength * 0.8;
      const reach = Math.min((bl * NOMINAL) / 2, hub - 2.4, 29.5 - hub);
      const z = sw / 2 + 0.012;
      out.push(box(0, z, hub - 0.12, bl, 0.02, 0.24, 'wall2'));
      if (reach > 0.6) out.push(box(0, z, hub - reach, 0.03, 0.02, reach * 2, 'wall2'));
      out.push(sph(0, z + 0.01, hub - 0.3, 0.06, 0.04, 0.6, 'dark'));
    }
    switch (top) {
      case 'light': out.push(sph(0, 0, H, 0.05, 0.05, 0.4, 'glow')); break;
      case 'finial': out.push(cone(0, 0, H, sw * 1.2, sw * 1.2, 1.2 + H * 0.06, 'accent')); break;
      case 'nest':
        out.push(cyl(0, 0, H * 0.8, 0.2, 0.2, 0.2, 'dark'));
        out.push(ring(0, 0, H * 0.8 + 0.9, 0.2, 0.2, 0.12, 'dark'));
        break;
      case 'radome':
        out.push(cyl(0, 0, H, 0.12, 0.12, 0.25, 'dark'));
        out.push(dome(0, 0, H + 0.25, 0.16, 0.16, 1.3, 'wall'));
        break;
      default: break;
    }
    const fin = Math.min(H * 0.25, 5);
    const off = 0.1 + sw / 2;
    const fins: [number, number, number][] = [[-off, 0, 0], [off, 0, 180], [0, off, 90], [0, -off, -90]];
    fins.slice(0, stays).forEach(([x, z, rot]) => out.push(wedge(x, z, SILL, 0.2, 0.025, fin, 'dark', { rot })));
    if (base === 'pad') out.push(cyl(0, 0, SILL, sw * 2.4, sw * 2.4, 0.35, 'dark'));
    else if (base === 'plinth') {
      out.push(box(0, 0, SILL, 0.3, 0.3, 0.6, 'wall2'));
      out.push(box(0, 0, SILL + 0.6, 0.2, 0.2, 0.5, 'wall2'));
    } else if (base === 'cabin') {
      out.push(box(0.3, 0.12, 0, 0.3, 0.3, 2.3, 'wall'));
      out.push(box(0.3, 0.12, 2.3, 0.34, 0.34, 0.2, 'roof'));
      out.push(box(0.3, 0.276, 0, 0.09, 0.02, 2, 'dark'));
    }
    return out;
  },
);

export const pit = skel(
  'pit', 'structure', 'Rim round a hollow or pool.',
  ['arena', 'well', 'crater pool', 'fire pit', 'amphitheatre', 'landing pad', 'summoning circle'],
  [
    C('shape', ['round', 'square'], 'round', 'plan'),
    N('radius', 0.4, 1, 0.8, ';outer width'),
    N('rim', 0.2, 4, 0.8, 'm'),
    N('tiers', 1, 5, 1, ';stepped rings'),
    C('fill', ['dark', 'water', 'glow', 'sand', 'grate'], 'dark', 'what lies inside'),
    N('posts', 0, 12, 0, ';round the rim'),
    N('postHeight', 0.5, 7, 2.5, 'm'),
    C('centre', ['none', 'stone', 'pillar', 'fire', 'spire'], 'none', 'what stands in the middle'),
  ],
  (d) => {
    const round = str(d, 'shape') === 'round';
    const radius = num(d, 'radius');
    const rim = num(d, 'rim');
    const fill = str(d, 'fill');
    const posts = int(d, 'posts');
    const ph = num(d, 'postHeight');
    const centre = str(d, 'centre');
    const lit = fill === 'glow' || centre === 'fire';
    const fillTone: PartTone = fill === 'water' ? 'glass' : fill === 'glow' ? 'glow' : fill === 'sand' ? 'wall' : 'dark';
    const out: BlueprintPart[] = [];
    /** Inner clear width, the height the posts stand at, and the line they stand on. */
    let inner: number;
    let rimTop: number;
    let line: number;
    if (round) {
      const Dm = radius * 1.06;
      const T = int(d, 'tiers');
      const hr = rim / (1 + 0.65 * (T - 1));
      const step = Math.min(hr / 2 / NOMINAL, (Dm - 0.25) / (2 * T));
      out.push(cyl(0, 0, 0, Math.min(1.1, Dm + 0.04), Math.min(1.1, Dm + 0.04), SILL, 'wall2'));
      // Rings stack upward and outward, each bedded in the one below: a berm, a coiled wall or a bowl of seats.
      for (let k = 0; k < T; k++) {
        const w = Dm - 2 * (T - 1 - k) * step;
        out.push(ring(0, 0, SILL + k * 0.65 * hr, w, w, hr, k % 2 === 0 ? 'wall' : 'wall2'));
      }
      inner = Dm - 2 * (T - 1) * step - (2 * hr) / NOMINAL;
      rimTop = SILL + (T - 1) * 0.65 * hr + hr;
      // A coping course along the crest of the rim.
      out.push(ring(0, 0, rimTop - 0.1, Dm - hr / NOMINAL + 0.03, Dm - hr / NOMINAL + 0.03, 0.2, 'trim'));
      line = Dm / 2 - hr / 2 / NOMINAL;
      const fd = clamp(inner, 0.12, 1);
      out.push(fill === 'sand' ? dome(0, 0, SILL, fd, fd, 0.25, fillTone) : cyl(0, 0, SILL, fd, fd, 0.12, fillTone));
      if (fill === 'grate') out.push(box(0, 0, SILL + 0.12, 0.02, fd * 0.7, 0.05, 'trim', { repeat: 6, gap: (fd * 0.7) / 6 }));
    } else {
      const S = radius;
      const tk = 0.07;
      const T = Math.min(int(d, 'tiers'), 3, Math.max(1, Math.floor((S - 0.42) / (2 * tk)) + 1));
      out.push(box(0, 0, 0, Math.min(1.08, S + 0.06), Math.min(1.08, S + 0.06), SILL, 'wall2'));
      // Terraces rise outward; the front of each is open in the middle.
      for (let k = 0; k < T; k++) {
        const s = S - 2 * (T - 1 - k) * tk;
        const h = (rim * (k + 1)) / T;
        const tone: PartTone = k % 2 === 0 ? 'wall' : 'wall2';
        const stubW = (s - 2 * tk - 0.22) / 2;
        out.push(box(0, 0, SILL, tk, s, h, tone, { repeat: 2, gap: s - tk }));
        out.push(box(0, -(s - tk) / 2, SILL, s - 2 * tk, tk, h, tone));
        if (stubW > 0.03) out.push(box(0, (s - tk) / 2, SILL, stubW, tk, h, tone, { repeat: 2, gap: stubW + 0.22 }));
      }
      inner = S - 2 * (T - 1) * tk - 2 * tk;
      rimTop = SILL + rim;
      line = (S - tk) / 2;
      const fd = clamp(inner, 0.1, 1);
      out.push(box(0, 0, SILL, fd, fd, fill === 'sand' ? 0.2 : 0.12, fillTone));
      if (fill === 'grate') out.push(box(0, 0, SILL + 0.12, 0.02, fd * 0.9, 0.05, 'trim', { repeat: 6, gap: fd / 6.5 }));
    }
    const floor = SILL + 0.12;
    switch (centre) {
      case 'stone': out.push(box(0, 0, SILL, 0.16, 0.12, 0.9, 'wall2')); break;
      case 'pillar':
        out.push(cyl(0, 0, SILL, 0.08, 0.08, Math.max(rim * 1.5, 3), 'trim'));
        out.push(box(0, 0, SILL + Math.max(rim * 1.5, 3), 0.11, 0.11, 0.25, 'trim'));
        break;
      case 'fire':
        out.push(box(0, 0, floor - 0.05, 0.16, 0.035, 0.2, 'dark', { rot: 35 }));
        out.push(box(0, 0, floor - 0.05, 0.16, 0.035, 0.2, 'dark', { rot: -40 }));
        out.push(cone(0, 0, floor, 0.1, 0.1, 1.3, 'glow'));
        break;
      case 'spire': out.push(cone(0, 0, SILL, 0.16, 0.16, rim * 2 + 3, 'wall')); break;
      default: break;
    }
    // Posts stand in mirrored pairs around the rim.
    const pairs = Math.ceil(posts / 2);
    const pw = 0.03;
    for (let k = 0; k < pairs; k++) {
      let z: number;
      let gap: number;
      if (round) {
        const a = ((k + 0.5) * Math.PI) / pairs;
        z = line * Math.cos(a);
        gap = 2 * line * Math.sin(a);
      } else {
        z = pairs === 1 ? 0 : lerp(-line, line, k / (pairs - 1));
        gap = 2 * line;
      }
      out.push(cyl(0, z, rimTop - 0.1, pw, pw, ph, 'trim', { repeat: 2, gap }));
      if (lit && k < 5) out.push(sph(0, z, rimTop - 0.1 + ph, pw * 1.6, pw * 1.6, 0.3, 'glow', { repeat: 2, gap }));
    }
    return out;
  },
);

/** Runs of neighbouring columns of equal height become one repeated part each. */
function columnRuns(heights: number[]): { from: number; to: number; h: number }[] {
  const runs: { from: number; to: number; h: number }[] = [];
  heights.forEach((h, i) => {
    const last = runs[runs.length - 1];
    if (last && last.h === h && last.to === i - 1) last.to = i;
    else runs.push({ from: i, to: i, h });
  });
  return runs.filter((r) => r.h > 0);
}

export const colonnade = skel(
  'colonnade', 'structure', 'Columns carrying a beam or nothing, in a row, ring or court.',
  ['temple front', 'pergola', 'pier pilings', 'stone circle', 'overpass', 'cloister', 'station canopy'],
  [
    C('plan', ['row', 'double', 'ring', 'court'], 'row', 'layout'),
    N('count', 2, 12, 6, ';columns'),
    N('height', 2, 14, 5, 'm'),
    N('girth', 0.03, 0.14, 0.06, ';thickness'),
    C('shaft', ['round', 'square', 'slab'], 'round', 'column form'),
    C('top', ['none', 'beam', 'pediment', 'roof', 'slats', 'deck'], 'beam', 'what they carry'),
    N('broken', 0, 1, 0, ';share fallen'),
    N('steps', 0, 3, 1, ';base'),
  ],
  (d, rng) => {
    const plan = str(d, 'plan');
    const count = int(d, 'count');
    const H = num(d, 'height');
    const girth = num(d, 'girth');
    const shaft = str(d, 'shaft');
    const top = str(d, 'top');
    const broken = num(d, 'broken');
    const steps = int(d, 'steps');
    const out: BlueprintPart[] = [];
    const span = plan === 'row' ? 0.34 : plan === 'double' ? 0.72 : 1;
    if (steps > 0) out.push(box(0, 0, 0, 1, span, SILL, 'wall2'));
    for (let j = 1; j < steps; j++) out.push(box(0, 0, SILL + (j - 1) * 0.25, 1 - 0.05 * j, span - 0.05 * j, 0.25, 'wall2'));
    const yb = steps > 0 ? SILL + (steps - 1) * 0.25 : 0;
    const yt = yb + H;
    const bh = 0.3 + H * 0.06;
    const cw = shaft === 'slab' ? girth * 1.7 : girth;
    const cd = shaft === 'slab' ? girth * 0.7 : girth;
    const column = shaft === 'round' ? cyl : box;
    /** 1 for a whole column, a fraction for a stump, 0 for one that is gone. */
    const fate = (): number => (rng.chance(broken) ? (rng.chance(0.3) ? 0 : rng.range(0.12, 0.6)) : 1);
    const capped = top !== 'none' && shaft !== 'slab';
    /** A sparse arrangement gains paving and kerbs along its long edges, so it never falls below four parts. */
    const ground = (): BlueprintPart[] => {
      if (out.length < 4 && steps === 0) out.unshift(box(0, 0, 0, 1, span, 0.1, 'wall2'));
      const edge = span / 2 - 0.03;
      const kerb = plan === 'ring' || plan === 'court' ? [-edge] : [-edge, edge];
      for (const z of kerb) if (out.length < 4) out.push(box(0, z, yb, 0.94, 0.05, 0.16, 'wall2'));
      if (out.length < 4) out.push(box(0, 0, yb, 0.05, span * 0.5, 0.12, 'wall2', { repeat: 2, gap: 0.9 }));
      return out;
    };
    /** Drums of fallen columns lying on the base, at least enough to make four parts. */
    const drums = (): BlueprintPart[] => {
      if (broken <= 0.05) return ground();
      const n = Math.max(2, 4 - out.length);
      for (let i = 0; i < n; i++) {
        const z = (i % 2 === 0 ? 1 : -1) * (span / 2 - 0.07) * (plan === 'row' ? 1 : rng.range(0.3, 0.8));
        out.push(cyl(rng.range(-0.38, 0.38), z, yb, cw * 1.2, cw * 1.2, rng.range(0.25, 0.45), 'trim'));
      }
      return out;
    };

    if (plan === 'ring') {
      const R = 0.42;
      const n = Math.max(4, count + (count % 2));
      const fates: number[] = [];
      const pos = (k: number): [number, number] => {
        const a = ((k + 0.5) * 2 * Math.PI) / n;
        return [R * Math.sin(a), R * Math.cos(a)];
      };
      for (let k = 0; k < n; k++) fates.push(fate());
      if (fates.filter((f) => f > 0).length < 2) fates.fill(0.4, 0, 2);
      for (let k = 0; k < n / 2; k++) {
        const [x, z] = pos(k);
        const a = fates[k] ?? 1;
        const b = fates[n - 1 - k] ?? 1;
        if (a === b && a > 0) out.push(column(0, z, yb, cw, cd, H * a, 'trim', { repeat: 2, gap: 2 * x }));
        else {
          if (a > 0) out.push(column(x, z, yb, cw, cd, H * a, 'trim'));
          if (b > 0) out.push(column(-x, z, yb, cw, cd, H * b, 'trim'));
        }
      }
      const whole = fates.every((f) => f === 1);
      if (top !== 'none' && top !== 'beam' && whole) {
        const w = 2 * R + girth * 1.6;
        out.push(ring(0, 0, yt, w, w, 0.5, 'wall'));
        if (top === 'roof' || top === 'pediment') out.push(cone(0, 0, yt + 0.4, w + 0.06, w + 0.06, H * 0.35 + 1, 'roof'));
        else if (top === 'deck') out.push(cyl(0, 0, yt + 0.4, w + 0.04, w + 0.04, 0.4, 'wall2'));
      } else if (top !== 'none') {
        // Lintels across every other gap whose two columns still stand whole.
        const chord = 2 * R * Math.sin(Math.PI / n) + cw;
        const rm = R * Math.cos(Math.PI / n);
        for (let j = 0; j < n && out.length < 26; j += 2) {
          if (fates[j] !== 1 || fates[(j + 1) % n] !== 1) continue;
          const a = ((j + 1) * 2 * Math.PI) / n;
          out.push(box(rm * Math.sin(a), rm * Math.cos(a), yt, chord, cd * 1.3, bh, 'wall', { rot: (a * 180) / Math.PI }));
        }
      }
      return drums();
    }

    if (plan === 'court') {
      const n = clamp(Math.round(count / 2), 2, 6);
      const g = 0.84 / (n - 1);
      const inner = Math.max(1, n - 2);
      const sides: { x: number; z: number; rot: number; k: number; gap: number }[] = [
        { x: 0, z: 0.42, rot: 0, k: n, gap: g },
        { x: 0, z: -0.42, rot: 0, k: n, gap: g },
        { x: -0.42, z: 0, rot: 90, k: inner, gap: g },
        { x: 0.42, z: 0, rot: 90, k: inner, gap: g },
      ];
      // A broken court loses whole sides: one row down to stumps, another gone.
      const roofTurn = [-90, 90, 180, 0];
      sides.forEach((s, i) => {
        const f = i === 1 && broken < 0.9 ? 1 : fate();
        if (f === 0) return;
        out.push(column(s.x, s.z, yb, cw, cd, H * f, 'trim', { rot: s.rot, repeat: s.k, gap: s.gap }));
        if (f < 1 || top === 'none') return;
        const len = (s.k - 1) * s.gap + cw * 1.6;
        out.push(box(s.x, s.z, yt, len, cd * 1.6, bh, 'wall', { rot: s.rot }));
        if (top !== 'beam') {
          const rx = s.rot === 0 ? 0 : s.x * 0.94;
          const rz = s.rot === 0 ? s.z * 0.94 : 0;
          out.push(wedge(rx, rz, yt + bh, 0.16, s.rot === 0 ? 1 : 0.84, 0.5 + H * 0.08, 'roof', { rot: roofTurn[i] ?? 0 }));
        }
      });
      if (!out.some((p) => p.y <= 0.05)) out.push(box(0, 0, 0, 1, 1, 0.12, 'wall2'));
      return drums();
    }

    const rows = plan === 'double' ? [-0.25, 0.25] : [0];
    const n = count;
    const g = Math.min(0.9 / Math.max(1, n - 1), 0.3);
    const xAt = (i: number): number => (i - (n - 1) / 2) * g;
    const first = Array.from({ length: n }, fate);
    if (first.filter((f) => f > 0).length < 2) first.fill(0.4, 0, 2);
    /** The longest run of whole columns in the front row: what a roof or pediment sits on. */
    let best = { from: 0, to: -1 };
    rows.forEach((z, r) => {
      // The second row breaks in the mirror image of the first, unless that would run past the part budget.
      let heights = r === 0 ? first : [...first].reverse();
      if (r === 1 && out.length + columnRuns(heights).length * 3 > 22) heights = first.map(() => 1);
      for (const run of columnRuns(heights)) {
        const k = run.to - run.from + 1;
        const xc = (xAt(run.from) + xAt(run.to)) / 2;
        out.push(column(xc, z, yb, cw, cd, H * run.h, 'trim', { repeat: k, gap: g }));
        if (run.h !== 1) continue;
        if (r === 0 && k > best.to - best.from + 1) best = { from: run.from, to: run.to };
        if (top === 'none') continue;
        if (capped) out.push(box(xc, z, yt - 0.25, cw * 1.5, cd * 1.5, 0.25, 'trim', { repeat: k, gap: g }));
        if (k >= 2 && top !== 'deck') out.push(box(xc, z, yt, (k - 1) * g + cw * 2, cd * 1.6, bh, 'wall'));
      }
    });
    const k = best.to - best.from + 1;
    if (top === 'none' || top === 'beam' || k < 2) return drums();
    drums();
    const xc = (xAt(best.from) + xAt(best.to)) / 2;
    const runW = (k - 1) * g + cw * 2;
    // In a double row a roof needs the same columns whole behind; otherwise it covers the front row only.
    const both = rows.length === 2 && first.slice(best.from, best.to + 1).every((f) => f === 1)
      && [...first].reverse().slice(best.from, best.to + 1).every((f) => f === 1);
    const zc = rows.length === 2 && !both ? (rows[0] ?? 0) : 0;
    const depth = both ? 0.5 + cd * 1.6 : cd * 1.6;
    switch (top) {
      case 'pediment':
        out.push(gable(xc, zc, yt + bh, depth + 0.04, runW + 0.04, clamp(runW * 2.2, 1, 4), both ? 'roof' : 'trim', { rot: 90 }));
        break;
      case 'roof':
        out.push(box(xc, zc, yt + bh, runW + 0.06, Math.max(depth + 0.06, 0.3), 0.3, 'roof'));
        break;
      case 'slats': {
        const m = clamp(Math.round(runW / 0.07), 3, 12);
        out.push(box(xc, zc, yt + bh, 0.02, Math.max(depth + 0.1, 0.3), 0.12, 'dark', { repeat: m, gap: runW / m }));
        break;
      }
      default:
        out.push(box(xc, zc, yt, runW + 0.06, depth + 0.08, 0.6, 'wall2'));
        for (const sz of [-1, 1]) out.push(box(xc, zc + (sz * (depth + 0.04)) / 2, yt + 0.6, runW + 0.06, 0.02, 0.8, 'wall'));
    }
    return out;
  },
);

export const wreck = skel(
  'wreck', 'structure', 'Broken hull or fuselage lying askew.',
  ['shipwreck', 'crashed plane', 'derelict bus', "dead giant's ribcage", 'fallen tower', 'downed airship', 'beached whale bones'],
  [
    C('section', ['round', 'box', 'keel', 'ribs'], 'round', 'hull cross-section'),
    N('length', 0.6, 1, 0.9, ';overall'),
    N('girth', 1.5, 8, 3.5, 'm;hull height'),
    N('breakAt', 0.25, 0.75, 0.55, ';where it snapped'),
    N('gap', 0, 0.25, 0.08, ';between halves'),
    N('ribs', 0, 10, 4, 'bare frames'),
    N('tilt', 0, 1, 0.4, 'ends sunk'),
    N('yaw', -40, 40, 15, 'degrees;askew'),
    N('fins', 0, 3, 1, 'tail, wings, stacks'),
  ],
  (d, rng) => {
    const section = str(d, 'section');
    const L = num(d, 'length') * 0.92;
    const girth = num(d, 'girth');
    const gapW = num(d, 'gap');
    const ribs = int(d, 'ribs');
    const tilt = num(d, 'tilt');
    const fins = int(d, 'fins');
    const half = L / 2;
    const beam = clamp((girth / NOMINAL) * 1.1, 0.14, 0.3);
    const xb = -half + L * num(d, 'breakAt');
    const bare = section === 'ribs';
    const out: BlueprintPart[] = [];
    /** A length of hull from x0 to x1, `k` of the full height. */
    const hull = (x0: number, x1: number, k: number): void => {
      const xc = (x0 + x1) / 2;
      const len = x1 - x0;
      if (len < 0.03) return;
      if (section === 'round') out.push(arch(xc, 0, SILL, beam, len, girth * k, 'wall', { rot: 90 }));
      else if (section === 'keel') out.push(gable(xc, 0, SILL, len, beam, girth * k, 'wall'));
      else if (bare) out.push(box(xc, 0, SILL, len, 0.04, 0.3, 'dark'));
      else out.push(box(xc, 0, SILL, len, beam, girth * k, 'wall'));
    };
    /** Two rows of frames standing along the keel between x0 and x1. */
    const frames = (x0: number, x1: number, n: number, k: number): void => {
      if (n < 1 || x1 - x0 < 0.03) return;
      const xc = (x0 + x1) / 2;
      const o = { repeat: n, gap: (x1 - x0) / n };
      const post = section === 'box' ? box : cone;
      for (const sz of [-1, 1]) out.push(post(xc, sz * beam * 0.45, SILL, 0.025, 0.025, girth * k, 'trim', o));
      if (!bare) out.push(box(xc, 0, SILL, x1 - x0 + 0.04, 0.05, 0.25, 'dark'));
    };
    const aftK = rng.range(0.75, 1);
    const aftEnd = xb - gapW / 2;
    const foreStart = xb + gapW / 2;
    const sunk = tilt > 0.1 && !bare;
    const aftSink = sunk ? tilt * 0.6 * (aftEnd + half) : 0;
    const foreSink = sunk ? tilt * 0.6 * (half - foreStart) : 0;
    // Skin is stripped from the fore half next to the break, where the frames show.
    const stripped = bare ? 0 : Math.min((half - foreSink - foreStart) * 0.6, ribs * 0.035 + (ribs > 0 ? 0.04 : 0));
    hull(-half + aftSink, aftEnd, aftK);
    if (sunk) out.push(wedge(-half + aftSink / 2, 0, SILL, aftSink, beam, girth * aftK, 'wall'));
    hull(foreStart + stripped, half - foreSink, 1);
    if (sunk) out.push(wedge(half - foreSink / 2, 0, SILL, foreSink, beam, girth, 'wall', { rot: 180 }));
    else if (section === 'round') out.push(sph(half - 0.06, 0, SILL, 0.16, beam * 0.96, girth * 0.96, 'wall2'));
    else if (bare) out.push(sph(half - 0.05, 0, SILL, 0.14, beam * 0.8, girth * 0.5, 'trim'));
    if (bare) {
      const n = Math.max(2, ribs);
      const na = Math.max(1, Math.round((n * (aftEnd + half)) / L));
      frames(-half + 0.03, aftEnd, na, aftK);
      frames(foreStart, half - 0.12, Math.max(1, n - na), 1);
    } else frames(foreStart, foreStart + stripped, Math.ceil(ribs / 2), 0.92);
    const bodyAft = (-half + aftSink + aftEnd) / 2;
    const bodyFore = (foreStart + stripped + half - foreSink) / 2;
    const aftLen = aftEnd - (-half + aftSink);
    const foreLen = half - foreSink - foreStart - stripped;
    if (!bare && fins >= 1 && aftLen > 0.08) {
      const fw = Math.min(0.16, aftLen * 0.9);
      if (section === 'round') out.push(wedge(bodyAft, 0, SILL + girth * aftK - 0.1, fw, 0.02, girth * 0.8, 'wall2', { rot: 180 }));
      else if (section === 'keel') out.push(box(bodyAft, 0, SILL + girth * aftK - 0.3, fw, 0.02, 0.9, 'dark'));
      else out.push(cyl(bodyAft, 0, SILL + girth * aftK - 0.1, 0.07, 0.07, girth * 0.7, 'dark'));
    }
    if (!bare && fins >= 2 && foreLen > 0.1) {
      if (section === 'round') {
        const wy = SILL + girth * 0.3;
        out.push(box(bodyFore, beam / 2 + 0.1, wy, 0.14, 0.22, 0.14, 'wall2'));
        out.push(box(bodyFore, -(beam / 2 + 0.05), wy, 0.14, 0.12, 0.14, 'wall2'));
        if (fins >= 3) out.push(sph(bodyFore, beam / 2 + 0.12, SILL, 0.16, 0.07, 0.9, 'dark'));
      } else {
        const cw = Math.min(0.2, foreLen * 0.8);
        out.push(box(bodyFore, 0, SILL + girth - 0.1, cw, beam * 0.7, 1.6, 'wall2'));
        out.push(box(bodyFore, (beam * 0.7) / 2 + 0.006, SILL + girth + 0.5, cw * 0.8, 0.02, 0.6, 'glass'));
        if (fins >= 3) out.push(cyl(bodyFore, 0, SILL + girth + 1.4, 0.06, 0.06, girth * 0.5, 'dark'));
      }
    }
    // Wreckage thrown out around the break.
    for (let i = 0; i < 3; i++) {
      const s = i % 2 === 0 ? 1 : -1;
      out.push(box(xb + rng.range(-0.1, 0.1), s * (beam / 2 + rng.range(0.05, 0.1)), SILL, rng.range(0.05, 0.11), rng.range(0.04, 0.08), rng.range(0.2, 0.6), i === 1 ? 'dark' : 'wall', { rot: rng.range(0, 90) }));
    }
    return [cyl(0, 0, 0, 1.04, 0.92, SILL, 'wall2'), ...turn(out, num(d, 'yaw'))];
  },
);

export const megastructure = skel(
  'megastructure', 'structure', 'Huge plain skyline form.',
  ['arcology', 'monolith', 'great gate', 'dam', 'colossal statue plinth', 'space elevator base', 'cooling tower'],
  [
    C('form', ['slab', 'needle', 'arch', 'ring', 'pyramid', 'dish'], 'slab', 'overall shape'),
    N('height', 10, 30, 24, 'm'),
    N('width', 0.3, 1, 0.6, ';footprint share'),
    N('taper', 0, 1, 0.2, ';narrows or steps'),
    N('bands', 0, 6, 3, ';trim'),
    N('lights', 0, 1, 0.4, ';windows, beacons'),
    N('void', 0, 1, 0, 'slot through it'),
  ],
  (d) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const Wd = num(d, 'width');
    const taper = num(d, 'taper');
    const bands = int(d, 'bands');
    const lights = num(d, 'lights');
    const hole = num(d, 'void');
    const out: BlueprintPart[] = [];
    switch (form) {
      case 'needle': {
        const w0 = Wd * 0.3;
        const segs = 4;
        const wAt = (y: number): number => w0 * (1 - taper * 0.85 * clamp(y / (H * 0.85), 0, 1));
        if (hole > 0.5) {
          for (const sz of [-1, 1]) out.push(box(0, sz * Wd * 0.3, 0, 0.05, 0.05, H * 0.14, 'wall2', { repeat: 2, gap: Wd * 0.6 }));
          out.push(cyl(0, 0, H * 0.14 - 0.4, Wd * 0.72, Wd * 0.72, 0.6, 'wall2'));
        } else out.push(cyl(0, 0, 0, Wd * 0.7, Wd * 0.7, H * 0.12, 'wall2'));
        const y0 = hole > 0.5 ? H * 0.14 + 0.2 : 0;
        const segH = (H * 0.85 - y0) / segs;
        for (let i = 0; i < segs; i++) {
          const w = wAt(y0 + (i + 0.5) * segH);
          out.push(cyl(0, 0, y0 + i * segH, w, w, segH, 'wall'));
        }
        out.push(cone(0, 0, H * 0.85, wAt(H) * 1.05, wAt(H) * 1.05, H * 0.15, 'trim'));
        for (let k = 1; k <= bands; k++) {
          const y = y0 + ((H * 0.85 - y0) * k) / (bands + 1);
          const w = wAt(y) * 1.7 + 0.03;
          out.push(ring(0, 0, y, w, w, 0.7, k % 2 === 0 && lights > 0.5 ? 'glow' : 'trim'));
        }
        if (lights > 0.05) out.push(sph(0, 0, H - 0.3, 0.05, 0.05, 0.6, 'glow'));
        break;
      }
      case 'arch': {
        const dd = 0.3;
        const pw = Wd * lerp(0.3, 0.14, hole);
        const Hp = H * 0.72;
        const two = taper > 0.3;
        const lower = two ? Hp * 0.6 : Hp;
        out.push(box(0, 0, 0, pw, dd, lower, 'wall', { repeat: 2, gap: Wd - pw }));
        out.push(box(0, 0, 0, pw + 0.04, dd + 0.05, 1 + H * 0.03, 'wall2', { repeat: 2, gap: Wd - pw }));
        if (two) out.push(box(0, 0, lower, pw * (1 - taper * 0.4), dd * 0.9, Hp - lower, 'wall', { repeat: 2, gap: Wd - pw }));
        out.push(box(0, 0, Hp, Math.min(1.1, Wd * 1.06), dd * 1.05, H * 0.12, 'wall2'));
        out.push(arch(0, 0, Hp + H * 0.12, Wd * 0.8, dd * 0.8, H * 0.16, 'wall'));
        for (let k = 1; k <= Math.min(bands, 4); k++) {
          out.push(box(0, 0, (lower * k) / (Math.min(bands, 4) + 1), pw + 0.015, dd + 0.015, 0.5, 'trim', { repeat: 2, gap: Wd - pw }));
        }
        if (lights > 0.5) out.push(box(0, 0, 0, Wd - 2 * pw + 0.01, 0.03, Hp, 'glow'));
        else if (lights > 0.05) out.push(sph(0, 0, Hp + H * 0.12, 0.05, 0.05, 0.6, 'glow', { repeat: 2, gap: Wd }));
        break;
      }
      case 'ring': {
        const hy = H * 0.8;
        const hr = 1.5 + H * 0.05;
        out.push(cyl(0, 0, 0, Wd * 0.9, Wd * 0.9, 0.3, 'wall2'));
        out.push(cyl(0, 0, 0, 0.07, 0.07, hy, 'wall', { repeat: 2, gap: Wd * 0.8 }));
        if (hole < 0.5) out.push(cyl(0, 0, 0, 0.07, 0.07, hy, 'wall', { rot: 90, repeat: 2, gap: Wd * 0.8 }));
        out.push(ring(0, 0, hy, Wd, Wd, hr, 'wall2'));
        out.push(cyl(0, 0, 0.3, 0.12, 0.12, 0.6 + H * 0.03, 'wall2', { repeat: 2, gap: Wd * 0.8 }));
        // Further hoops: lower ones on the pylons, then a crown of shrinking ones above when it tapers.
        const below = taper > 0.4 ? Math.floor(bands / 2) : bands;
        for (let k = 1; k <= below; k++) out.push(ring(0, 0, (hy * k) / (below + 1), Wd * 0.86, Wd * 0.86, 0.6, 'trim'));
        let y = hy + hr * 0.7;
        for (let k = 1; k <= bands - below; k++) {
          const w = Wd * (1 - 0.22 * k * taper);
          out.push(ring(0, 0, y, w, w, hr * 0.8, k % 2 === 1 ? 'wall' : 'wall2'));
          y += hr * 0.55;
        }
        if (lights > 0.05) out.push(ring(0, 0, hy + 0.2, Wd * 0.84, Wd * 0.84, 0.5, 'glow'));
        if (hole < 0.3) {
          out.push(cyl(0, 0, 0, 0.1, 0.1, hy * 0.6, 'wall'));
          out.push(sph(0, 0, hy * 0.6, 0.16, 0.16, 1.6, lights > 0.5 ? 'glow' : 'trim'));
        }
        break;
      }
      case 'pyramid': {
        if (taper < 0.25) {
          out.push(pyr(0, 0, 0, Wd, Wd, H, 'wall'));
          out.push(box(0, 0, 0, Math.min(1.04, Wd * 1.05), Math.min(1.04, Wd * 1.05), 0.5, 'wall2'));
          out.push(pyr(0, 0, H * 0.88, Wd * 0.13, Wd * 0.13, H * 0.12 + 0.15, lights > 0.5 ? 'glow' : 'trim'));
          // Courses standing a little proud of the slope.
          for (let k = 1; k <= Math.max(1, bands); k++) {
            const y = (H * 0.8 * k) / (Math.max(1, bands) + 1);
            const w = Wd * (1 - y / H) + 0.015;
            out.push(box(0, 0, y, w, w, 0.35, 'trim'));
          }
        } else {
          const k = 3 + Math.round(taper * 4);
          const stepH = (H * 0.88) / k;
          for (let i = 0; i < k; i++) {
            const w = Wd * (1 - (i / k) * 0.86);
            out.push(box(0, 0, i * stepH, w, w, stepH, i % 2 === 0 ? 'wall' : 'wall2'));
            if (i > 0 && i <= bands) out.push(box(0, 0, i * stepH - 0.15, w + 0.02, w + 0.02, 0.3, 'trim'));
          }
          out.push(pyr(0, 0, H * 0.88, Wd * 0.16, Wd * 0.16, H * 0.12, lights > 0.5 ? 'glow' : 'trim'));
        }
        if (hole > 0.4) out.push(arch(0, Wd / 2 - 0.03, 0, 0.14, 0.08, 4, 'dark'));
        break;
      }
      case 'dish': {
        const sy = H * 0.75;
        const stem = Wd * 0.22;
        const twin = hole > 0.5;
        const o = twin ? { repeat: 2, gap: Wd * 0.4 } : {};
        out.push(twin ? cyl(0, 0, 0, Wd * 0.75, Wd * 0.4, 0.5, 'wall2') : cone(0, 0, 0, Wd * 0.5, Wd * 0.5, H * 0.2, 'wall2'));
        out.push(cyl(0, 0, 0, stem, stem, sy * 0.5, 'wall', o));
        out.push(cyl(0, 0, sy * 0.5, stem * (1 - taper * 0.5), stem * (1 - taper * 0.5), sy * 0.5, 'wall', o));
        out.push(cyl(0, 0, sy, Wd, Wd, H * 0.08, 'wall2'));
        out.push(ring(0, 0, sy + H * 0.04 - 0.4, Math.min(1.08, Wd * 1.04), Math.min(1.08, Wd * 1.04), 0.8, 'trim'));
        out.push(dome(0, 0, sy + H * 0.08, Wd * 0.7, Wd * 0.7, H * 0.1, 'wall'));
        out.push(cone(0, 0, sy + H * 0.18 - 0.1, 0.04, 0.04, H * 0.14, 'accent'));
        for (let k = 1; k <= Math.min(bands, 4); k++) {
          out.push(ring(0, 0, (sy * k) / (Math.min(bands, 4) + 1), Wd * (twin ? 0.66 : 0.3), stem + 0.06, 0.5, 'trim'));
        }
        if (lights > 0.05) out.push(ring(0, 0, sy - 0.5, Wd * 0.8, Wd * 0.8, 0.4, 'glow'));
        break;
      }
      default: {
        const dd = 0.28;
        const segs = taper > 0.15 ? 3 : 1;
        const twin = hole > 0.3;
        const slot = twin ? Wd * hole * 0.35 : 0;
        const wOf = (i: number): number => Wd * (1 - (taper * 0.6 * i) / segs);
        const wAt = (y: number): number => wOf(Math.min(segs - 1, Math.floor((y / H) * segs)));
        const dAt = (y: number): number => dd * (1 - 0.1 * Math.min(segs - 1, Math.floor((y / H) * segs)));
        const piece = (y: number, w: number, depth: number, h: number, tone: PartTone): BlueprintPart =>
          twin
            ? box(0, 0, y, (w - slot) / 2, depth, h, tone, { repeat: 2, gap: (w + slot) / 2 })
            : box(0, 0, y, w, depth, h, tone);
        for (let i = 0; i < segs; i++) out.push(piece((i * H) / segs, wOf(i), dd * (1 - 0.1 * i), H / segs, 'wall'));
        // A footing course, a cap, and one tall dark opening at the foot to give the mass its scale.
        out.push(box(0, 0, 0, Math.min(1.06, Wd + 0.05), dd + 0.05, 0.7, 'wall2'));
        out.push(piece(H, wOf(segs - 1) + 0.015, dd * (1 - 0.1 * (segs - 1)) + 0.015, 0.35, 'trim'));
        out.push(box(twin ? (Wd + slot) / 4 : 0, (dd + 0.05) / 2 + 0.004, 0, Math.min(0.08, Wd * 0.2), 0.02, 3.2, 'dark'));
        if (twin) {
          out.push(box(0, 0, H * 0.55, slot + 0.04, dd * 0.6, 1.2, 'trim'));
          if (H > 16) out.push(box(0, 0, H * 0.3, slot + 0.04, dd * 0.6, 1.2, 'trim'));
        }
        for (let k = 1; k <= bands; k++) {
          const y = (H * k) / (bands + 1);
          out.push(piece(y - 0.25, wAt(y) + 0.02, dAt(y) + 0.02, 0.5, 'trim'));
        }
        // Rows of lit windows up the front, on alternate towers when it is split.
        const rows = Math.round(lights * 4);
        for (let k = 0; k < rows; k++) {
          const y = H * (0.2 + (0.6 * (k + 0.5)) / rows);
          const w = twin ? (wAt(y) - slot) / 2 : wAt(y);
          const x = twin ? ((k % 2 === 0 ? 1 : -1) * (wAt(y) + slot)) / 4 : 0;
          const n = clamp(Math.round(w / 0.07), 2, 10);
          out.push(box(x, dAt(y) / 2 + 0.004, y, 0.02, 0.02, 1.2, 'glow', { repeat: n, gap: (w * 0.86) / n }));
        }
        if (lights > 0.5) {
          const x = twin ? (wOf(segs - 1) + slot) / 4 : 0;
          out.push(cyl(x, 0, H, 0.02, 0.02, 2.5, 'dark'));
          out.push(sph(x, 0, H + 2.5, 0.04, 0.04, 0.4, 'glow'));
        }
      }
    }
    return out;
  },
);
