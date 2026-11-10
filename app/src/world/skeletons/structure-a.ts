// Structure skeletons, part one: masses that rise from a footprint.
import type { BlueprintPart } from '../spec';
import { arch, box, C, clamp, cone, cyl, dome, gable, int, lerp, N, num, pyr, ring, skel, sph, str, wedge } from './util';

const STOREY = 3;

export const hall = skel(
  'hall', 'structure', 'Rectangular storeys under a roof, front treatment, window rhythm.',
  ['saloon', 'longhouse', 'barn', 'workshop', 'market hall', 'tenement'],
  [
    N('storeys', 1, 4, 1, 'floors'),
    C('roof', ['flat', 'gable', 'hip', 'pyramid', 'barrel', 'shed', 'sawtooth'], 'gable', 'roof form'),
    N('overhang', 0, 0.3, 0.06, 'eave reach'),
    C('front', ['plain', 'porch', 'arcade', 'falsefront', 'awning', 'stoop'], 'plain', 'front addition'),
    N('rhythm', 0, 8, 3, 'windows per floor'),
    N('chimney', 0, 2, 0, 'stacks'),
    N('taper', 0, 0.4, 0, 'upper floors shrink'),
  ],
  (d) => {
    const st = int(d, 'storeys');
    const roof = str(d, 'roof');
    const ov = num(d, 'overhang');
    const front = str(d, 'front');
    const rh = int(d, 'rhythm');
    const ch = int(d, 'chimney');
    const tp = num(d, 'taper');
    const W = 0.8;
    const D = 0.66;
    const out: BlueprintPart[] = [];
    let wt = W;
    let dt = D;
    for (let i = 0; i < st; i++) {
      const f = 1 - tp * i * 0.4;
      const wi = W * f;
      const di = D * f;
      out.push(box(0, 0, i * STOREY, wi, di, STOREY, i % 2 === 0 ? 'wall' : 'wall2'));
      let n = rh;
      if (i === 0 && n % 2 === 1) n -= 1; // keep the middle of the ground floor clear for a door
      if (n > 0) out.push(box(0, di / 2 + 0.005, i * STOREY + 0.9, 0.07, 0.03, 1.1, 'glass', { repeat: n, gap: (wi * 0.85) / n }));
      wt = wi;
      dt = di;
    }
    out.push(box(0, 0, 0, W * 1.04, D * 1.04, 0.3, 'wall2'));
    out.push(box(0, 0, st * STOREY - 0.25, wt * 1.04, dt * 1.04, 0.25, 'trim'));
    const top = st * STOREY;
    const rw = wt + ov;
    const rd = dt + ov;
    switch (roof) {
      case 'flat': out.push(box(0, 0, top, rw, rd, 0.3, 'roof')); break;
      case 'hip': out.push(pyr(0, 0, top, rw, rd, 1.9, 'roof')); break;
      case 'pyramid': out.push(pyr(0, 0, top, rw, rd, 3.4, 'roof')); break;
      case 'barrel': out.push(arch(0, 0, top, rw, rd, 2, 'roof')); break;
      case 'shed': out.push(wedge(0, 0, top, rw, rd, 1.6, 'roof')); break;
      case 'sawtooth': out.push(wedge(0, 0, top, rw / 3, rd, 1.4, 'roof', { repeat: 3, gap: rw / 3 })); break;
      default: out.push(gable(0, 0, top, rw, rd, 1.9, 'roof'));
    }
    if (ch > 0) out.push(box(0, -0.1, top, 0.07, 0.07, 2.4, 'dark', { repeat: ch, gap: 0.56 }));
    const fz = D / 2;
    switch (front) {
      case 'porch':
        out.push(box(0, fz + 0.14, 2.6, 0.5, 0.28, 0.15, 'roof'));
        out.push(cyl(0, fz + 0.12, 0, 0.035, 0.035, 2.65, 'wall2', { repeat: 2, gap: 0.42 }));
        break;
      case 'arcade':
        out.push(box(0, fz + 0.15, 2.7, 0.84, 0.3, 0.2, 'trim'));
        out.push(cyl(0, fz + 0.12, 0, 0.035, 0.035, 2.75, 'wall2', { repeat: 4, gap: 0.22 }));
        break;
      case 'falsefront':
        out.push(box(0, fz - 0.02, top - 0.4, W, 0.04, 1.9, 'wall'));
        out.push(box(0, fz - 0.02, top + 1.5, W * 1.04, 0.05, 0.25, 'trim'));
        break;
      case 'awning': out.push(wedge(0, fz + 0.12, 2.4, 0.26, 0.8, 0.45, 'accent', { rot: 90 })); break;
      case 'stoop': out.push(box(0, fz + 0.07, 0, 0.3, 0.14, 0.3, 'wall2')); break;
      default: break;
    }
    return out;
  },
);

export const tower = skel(
  'tower', 'structure', 'Tall slender mass, stepped inward, bands, crown.',
  ['watchtower', 'minaret', 'skyscraper', 'lighthouse', 'water tower', 'wizard spire'],
  [
    N('height', 4, 24, 14, 'metres'),
    C('section', ['square', 'round', 'hex'], 'square', 'plan shape'),
    N('taper', 0, 0.9, 0.2, 'narrowing to top'),
    N('bands', 0, 5, 2, 'trim rings'),
    C('top', ['flat', 'cone', 'dome', 'lantern', 'crown', 'needle', 'tank', 'platform'], 'cone', 'crown'),
    N('flare', 0, 0.5, 0, 'wider base skirt'),
  ],
  (d) => {
    const H = num(d, 'height');
    const sec = str(d, 'section');
    const tp = num(d, 'taper');
    const bands = int(d, 'bands');
    const top = str(d, 'top');
    const fl = num(d, 'flare');
    const W0 = 0.36;
    const segN = tp > 0.03 ? (sec === 'hex' ? 3 : 4) : 1;
    const segH = H / segN;
    const widths: number[] = [];
    const out: BlueprintPart[] = [];
    for (let i = 0; i < segN; i++) {
      const wi = W0 * (1 - (tp * (i + 0.5)) / segN);
      widths.push(wi);
      if (sec === 'round') out.push(cyl(0, 0, i * segH, wi, wi, segH, 'wall'));
      else {
        out.push(box(0, 0, i * segH, wi, wi, segH, 'wall'));
        if (sec === 'hex') out.push(box(0, 0, i * segH, wi * 0.9, wi * 0.9, segH, 'wall', { rot: 45 }));
      }
    }
    const wAt = (y: number): number => widths[Math.min(segN - 1, Math.floor(y / segH))] ?? W0;
    for (let k = 1; k <= bands; k++) {
      const y = (H * k) / (bands + 1);
      const w = wAt(y) * 1.12;
      out.push(sec === 'round' ? cyl(0, 0, y - 0.12, w, w, 0.25, 'trim') : box(0, 0, y - 0.12, w, w, 0.25, 'trim'));
    }
    if (fl > 0.04) {
      const w = W0 * (1 + fl * 1.6);
      const h = Math.min(H * 0.25, 2.5);
      out.push(sec === 'round' ? cyl(0, 0, 0, w, w, h, 'wall2') : box(0, 0, 0, w, w, h, 'wall2'));
    }
    const w0 = widths[0] ?? W0;
    out.push(box(0, 0, 0, W0 * 1.2, W0 * 1.2, 0.4, 'wall2'));
    out.push(box(0, w0 / 2, 1, 0.05, 0.03, Math.min(segH * 0.7, 3), 'glass'));
    const wt = widths[segN - 1] ?? W0;
    switch (top) {
      case 'flat':
        out.push(box(0, 0, H, wt * 1.25, wt * 1.25, 0.35, 'roof'));
        out.push(box(0, 0, H + 0.35, wt * 0.8, wt * 0.8, 0.5, 'trim'));
        break;
      case 'dome': out.push(dome(0, 0, H, wt * 1.15, wt * 1.15, 2, 'roof')); break;
      case 'lantern':
        out.push(box(0, 0, H, wt * 1.2, wt * 1.2, 0.3, 'roof'));
        out.push(box(0, 0, H + 0.3, wt * 0.7, wt * 0.7, 1.3, 'glow'));
        out.push(pyr(0, 0, H + 1.6, wt * 1.1, wt * 1.1, 1.6, 'roof'));
        break;
      case 'crown': {
        out.push(box(0, 0, H, wt * 1.2, wt * 1.2, 0.3, 'roof'));
        const g = (wt * 1.0) / 4;
        out.push(cone(0, wt * 0.55, H + 0.3, 0.05, 0.05, 1.4, 'accent', { repeat: 5, gap: g }));
        out.push(cone(0, -wt * 0.55, H + 0.3, 0.05, 0.05, 1.4, 'accent', { repeat: 5, gap: g }));
        out.push(cone(wt * 0.55, 0, H + 0.3, 0.05, 0.05, 1.4, 'accent', { repeat: 3, gap: g, rot: 90 }));
        out.push(cone(-wt * 0.55, 0, H + 0.3, 0.05, 0.05, 1.4, 'accent', { repeat: 3, gap: g, rot: 90 }));
        break;
      }
      case 'needle':
        out.push(box(0, 0, H, wt * 0.5, wt * 0.5, 0.5, 'trim'));
        out.push(cone(0, 0, H + 0.5, 0.05, 0.05, 4 + H * 0.15, 'accent'));
        break;
      case 'tank': {
        const z = wt * 0.35;
        out.push(box(0, -z, H, 0.03, 0.03, 2, 'dark', { repeat: 2, gap: wt * 0.7 }));
        out.push(box(0, z, H, 0.03, 0.03, 2, 'dark', { repeat: 2, gap: wt * 0.7 }));
        out.push(cyl(0, 0, H + 2, wt * 1.3, wt * 1.3, 2.4, 'wall2'));
        out.push(cone(0, 0, H + 4.4, wt * 1.4, wt * 1.4, 0.9, 'roof'));
        break;
      }
      case 'platform':
        out.push(box(0, 0, H, wt * 1.9, wt * 1.9, 0.3, 'trim'));
        out.push(box(0, wt * 0.9, H + 0.3, 0.02, 0.02, 0.9, 'dark', { repeat: 6, gap: (wt * 1.7) / 5 }));
        out.push(box(0, 0, H + 0.3, wt * 0.9, wt * 0.9, 1.6, 'wall2'));
        break;
      default: out.push(cone(0, 0, H, wt * 1.3, wt * 1.3, Math.min(5, H * 0.3 + 1.5), 'roof'));
    }
    return out;
  },
);

export const spire = skel(
  'spire', 'structure', 'Needle or shard cluster on a low base.',
  ['crystal city', 'cathedral pinnacles', 'rocket gantries', 'coral stacks', 'stalagmites', 'glass needles'],
  [
    N('count', 1, 7, 3, 'shards'),
    N('height', 4, 24, 12, 'tallest, metres'),
    N('lean', 0, 0.5, 0.1, 'tip offset'),
    N('sharpness', 0, 1, 0.6, 'thin and faceted'),
    N('variance', 0, 1, 0.5, 'height difference'),
  ],
  (d, rng) => {
    const n = int(d, 'count');
    const H = num(d, 'height');
    const lean = num(d, 'lean');
    const sharp = num(d, 'sharpness');
    const vr = num(d, 'variance');
    const out: BlueprintPart[] = [box(0, 0, 0, 0.9, 0.8, 0.25, 'wall2')];
    let tipX = 0;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + rng.range(0, 1);
      const r = i === 0 ? 0 : Math.min(0.36, 0.15 + 0.08 * i);
      const x = r * Math.cos(a);
      const z = clamp(r * Math.sin(a), -0.32, 0.32);
      const hi = i === 0 ? H : H * (1 - vr * 0.55 * rng.next());
      const wi = lerp(0.2, 0.07, sharp);
      const faceted = sharp > 0.55;
      const dx = lean * wi * 1.6 * (i % 2 === 0 ? 1 : -1);
      if (i === 0) tipX = x + dx;
      out.push(faceted ? box(x, z, 0, wi, wi, hi * 0.55, 'wall') : cyl(x, z, 0, wi, wi, hi * 0.55, 'wall'));
      out.push(faceted
        ? pyr(x + dx, z, hi * 0.55, wi * 0.95, wi * 0.95, hi * 0.45, 'wall2')
        : cone(x + dx, z, hi * 0.55, wi * 0.95, wi * 0.95, hi * 0.45, 'wall2'));
    }
    out.push(sph(tipX, 0, H, 0.05, 0.05, 0.3, 'glow'));
    return out;
  },
);

export const domeForm = skel(
  'dome', 'structure', 'Round vault on a drum, ribs, lantern, satellite pods.',
  ['observatory', 'mosque', 'biodome', 'igloo', 'arena', 'hab bubble'],
  [
    N('flatness', 0, 1, 0.3, 'low and wide'),
    N('drum', 0, 6, 2, 'wall under dome, m'),
    N('oculus', 0, 1, 0, '>0.5 glowing lantern'),
    N('ribs', 0, 6, 0, 'hoop bands'),
    N('pods', 0, 6, 0, 'small domes around'),
  ],
  (d, rng) => {
    const flat = num(d, 'flatness');
    const drum = num(d, 'drum') < 0.3 ? 0 : num(d, 'drum');
    const oc = num(d, 'oculus');
    const ribs = int(d, 'ribs');
    const pods = int(d, 'pods');
    const DW = 0.64;
    const h = (1 - flat * 0.65) * 3.2;
    const out: BlueprintPart[] = [cyl(0, 0, 0, DW * 1.12, DW * 1.12, 0.35, 'trim')];
    if (drum > 0) out.push(cyl(0, 0, 0, DW, DW, drum, 'wall'));
    out.push(dome(0, 0, drum, DW, DW, h, 'roof'));
    out.push(box(0, 0.36, 0, 0.18, 0.12, 1.6, 'dark'));
    for (let k = 1; k <= ribs; k++) {
      const u = k / (ribs + 1);
      const w = DW * Math.sqrt(Math.max(0.05, 1 - u * u)) * 1.03;
      out.push(ring(0, 0, drum + u * h, w, w, 0.25, 'trim'));
    }
    const topY = drum + h;
    if (oc > 0.5) {
      out.push(cyl(0, 0, topY - 0.1, 0.14, 0.14, 0.7, 'glow'));
      out.push(cone(0, 0, topY + 0.6, 0.1, 0.1, 0.9, 'accent'));
    } else out.push(cone(0, 0, topY - 0.05, 0.06, 0.06, 0.9, 'accent'));
    const off = rng.range(0, Math.PI * 2);
    for (let k = 0; k < pods; k++) {
      const a = off + (k * Math.PI * 2) / Math.max(1, pods);
      out.push(dome(0.38 * Math.cos(a), clamp(0.34 * Math.sin(a), -0.34, 0.34), 0, 0.2, 0.2, 1.5, 'wall2'));
    }
    return out;
  },
);

export const tiers = skel(
  'tiers', 'structure', 'Stacked levels shrinking upward.',
  ['pagoda', 'ziggurat', 'wedding-cake keep', 'terraced temple', 'reactor stack', 'mushroom shelf'],
  [
    N('levels', 2, 7, 4, 'stacked levels'),
    N('shrink', 0.5, 0.95, 0.78, 'width ratio per level'),
    N('flare', 0, 0.4, 0.12, 'roof eave per level'),
    C('top', ['spire', 'finial', 'flat', 'none'], 'spire', 'crown'),
  ],
  (d) => {
    const levels = int(d, 'levels');
    const shrink = num(d, 'shrink');
    const fl = num(d, 'flare');
    const top = str(d, 'top');
    const W0 = 0.8;
    const BH = 2.8;
    const out: BlueprintPart[] = [box(0, 0, 0, W0 * 1.08, W0 * 1.08 * 0.85, 0.4, 'trim')];
    let y = 0.4;
    for (let i = 0; i < levels; i++) {
      const wi = W0 * Math.pow(shrink, i);
      out.push(box(0, 0, y, wi, wi * 0.85, BH, i % 2 === 0 ? 'wall' : 'wall2'));
      const last = i === levels - 1;
      const rw = Math.min(1.4, wi * (1 + fl * 2.5));
      if (last && (top === 'flat' || top === 'none' || fl <= 0.03)) {
        out.push(box(0, 0, y + BH, Math.min(1.4, wi * (1 + fl)), wi * 0.85 * (1 + fl), 0.3, 'roof'));
        y += BH + 0.3;
      } else if (fl > 0.03) {
        out.push(pyr(0, 0, y + BH, rw, rw * 0.85, 1.3, 'roof'));
        y += last ? BH + 1.3 : BH + 0.6;
      } else y += BH;
    }
    if (top === 'spire') out.push(cone(0, 0, y - 0.3, 0.06, 0.06, 4, 'accent'));
    else if (top === 'finial') out.push(sph(0, 0, y - 0.2, 0.1, 0.1, 0.4, 'accent'));
    return out;
  },
);

export const tent = skel(
  'tent', 'structure', 'Fabric over poles: cone, ridge or yurt, with door flaps and pegs.',
  ['nomad tent', 'yurt', 'circus top', 'market awning', 'fungus hut', 'rescue shelter'],
  [
    C('form', ['cone', 'ridge', 'yurt'], 'cone', 'overall shape'),
    N('poles', 1, 3, 1, 'peaks'),
    N('sag', 0, 1, 0.2, 'lower slack roof'),
    N('flaps', 0, 2, 1, 'door flaps'),
  ],
  (d) => {
    const form = str(d, 'form');
    const peaks = int(d, 'poles');
    const sag = num(d, 'sag');
    const flaps = int(d, 'flaps');
    const H = 4.6 * (1 - sag * 0.35);
    const out: BlueprintPart[] = [box(0, 0, 0, 0.95, 0.8, 0.06, 'wall2')];
    const pw = 0.8 / peaks;
    let hTop = H;
    if (form === 'ridge') {
      hTop = 2.8 * (1 - sag * 0.3);
      out.push(gable(0, 0, 0, pw * 1.05, 0.6, hTop, 'wall', { repeat: peaks, gap: pw }));
      out.push(box(0, 0, hTop - 0.05, 0.9, 0.03, 0.1, 'dark'));
    } else if (form === 'yurt') {
      hTop = 1.5 + 2.4 * (1 - sag * 0.3);
      out.push(cyl(0, 0, 0, 0.66, 0.6, 1.5, 'wall'));
      out.push(cone(0, 0, 1.5, 0.76, 0.7, 2.4 * (1 - sag * 0.3), 'roof'));
    } else {
      out.push(cone(0, 0, 0, pw * 1.15, 0.6, H, 'wall', { repeat: peaks, gap: pw * 0.9 }));
    }
    out.push(cyl(0, 0, hTop - 0.5, 0.03, 0.03, 1.4, 'dark', { repeat: form === 'cone' ? peaks : 1, gap: pw * 0.9 }));
    if (flaps > 0) out.push(box(0, 0.28, 0, 0.2, 0.03, 1.8, 'accent', { repeat: flaps, gap: 0.24 }));
    out.push(box(0, 0.44, 0, 0.03, 0.03, 0.35, 'dark', { repeat: 3, gap: 0.35 }));
    return out;
  },
);
