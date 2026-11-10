// Structure skeletons, part two: platforms, gateways, vessels, organic bulbs, stacks, enclosures, shelters.
import type { BlueprintPart } from '../spec';
import { arch, box, C, clamp, cone, cyl, dome, gable, int, N, num, pyr, skel, sph, str, wedge } from './util';

export const stilts = skel(
  'stilts', 'structure', 'Platform lifted on legs with a hut on top and a way up.',
  ['pier house', 'tree platform', 'oil rig', 'swamp hut', 'treetop lookout', 'orbital dock'],
  [
    N('legHeight', 1, 8, 3, 'metres off the ground'),
    N('legs', 2, 8, 4, 'support legs'),
    N('hut', 0.3, 1, 0.6, 'hut size'),
    C('access', ['ladder', 'ramp', 'none'], 'ladder', 'way up'),
  ],
  (d) => {
    const lh = num(d, 'legHeight');
    const k = clamp(Math.round(int(d, 'legs') / 2), 1, 4);
    const hs = num(d, 'hut');
    const access = str(d, 'access');
    const gap = k > 1 ? 0.8 / (k - 1) : 0;
    const hw = 0.3 + 0.5 * hs;
    const hd = 0.25 + 0.45 * hs;
    const out: BlueprintPart[] = [
      cyl(0, -0.32, 0, 0.05, 0.05, lh + 0.1, 'wall2', { repeat: k, gap }),
      cyl(0, 0.32, 0, 0.05, 0.05, lh + 0.1, 'wall2', { repeat: k, gap }),
      box(0, 0, lh, 0.92, 0.8, 0.25, 'wall'),
      box(0, -0.04, lh + 0.25, hw, hd, 2.4, 'wall2'),
      gable(0, -0.04, lh + 2.65, hw + 0.1, hd + 0.1, 1.2, 'roof'),
      box(hw * 0.25, -0.04 + hd / 2 + 0.005, lh + 1.0, 0.1, 0.03, 0.8, 'glass'),
    ];
    if (access === 'ladder') out.push(box(0.32, 0.42, 0, 0.1, 0.04, lh + 0.8, 'dark'));
    else if (access === 'ramp') out.push(wedge(0.32, 0.5, 0, 0.5, 0.12, lh + 0.25, 'wall2', { rot: 90 }));
    return out;
  },
);

export const archway = skel(
  'arch', 'structure', 'Opening framed by pillars and a lintel, optional towers.',
  ['town gate', 'torii', 'bridge gate', 'portal', 'airlock frame', 'triumphal arch'],
  [
    N('span', 0.3, 0.8, 0.6, 'opening width'),
    N('thickness', 0.08, 0.3, 0.14, 'pillar width'),
    C('lintel', ['round', 'flat', 'pointed', 'torii', 'stepped'], 'round', 'top style'),
    N('towers', 0, 2, 0, '1 keep above, 2 flanking'),
  ],
  (d) => {
    const span = num(d, 'span');
    const t = num(d, 'thickness');
    const lintel = str(d, 'lintel');
    const towers = int(d, 'towers');
    const Hp = 3.6;
    const out: BlueprintPart[] = [
      box(0, 0, 0, t, 0.3, Hp, 'wall', { repeat: 2, gap: span }),
      box(0, 0, 0, span + t, 0.34, 0.12, 'wall2'),
      box(0, 0, Hp - 0.2, t * 1.3, 0.4, 0.2, 'trim', { repeat: 2, gap: span }),
    ];
    let lt = Hp;
    switch (lintel) {
      case 'flat':
        out.push(box(0, 0, Hp, span + t * 2, 0.34, 0.5, 'trim'));
        lt = Hp + 0.5;
        break;
      case 'pointed':
        out.push(gable(0, 0, Hp, 0.3, span + t, 1.8, 'trim', { rot: 90 }));
        lt = Hp + 1.8;
        break;
      case 'torii':
        out.push(box(0, 0, Hp, span + t * 3, 0.4, 0.3, 'accent'));
        out.push(box(0, 0, Hp - 0.9, span, 0.3, 0.2, 'accent'));
        out.push(box(0, 0, Hp + 0.3, span + t * 2.2, 0.34, 0.25, 'dark'));
        lt = Hp + 0.55;
        break;
      case 'stepped':
        out.push(box(0, 0, Hp, span + t * 1.5, 0.34, 0.45, 'trim'));
        out.push(box(0, 0, Hp + 0.45, span + t * 0.8, 0.3, 0.4, 'wall'));
        out.push(box(0, 0, Hp + 0.85, span * 0.5 + t, 0.26, 0.4, 'trim'));
        lt = Hp + 1.25;
        break;
      default:
        out.push(arch(0, 0, Hp, span + t, 0.3, 2.2, 'trim'));
        lt = Hp + 2.2;
    }
    if (towers === 1) {
      out.push(box(0, 0, lt - 0.05, span * 0.7 + t, 0.28, 2.2, 'wall2'));
      out.push(pyr(0, 0, lt + 2.15, span * 0.8 + t, 0.34, 1.2, 'roof'));
    } else if (towers >= 2) {
      const xt = Math.min(0.5, span / 2 + t / 2 + 0.1);
      out.push(box(0, 0, 0, 0.16, 0.36, Hp + 2.6, 'wall2', { repeat: 2, gap: xt * 2 }));
      out.push(pyr(0, 0, Hp + 2.5, 0.2, 0.4, 1.3, 'roof', { repeat: 2, gap: xt * 2 }));
    }
    return out;
  },
);

export const hull = skel(
  'hull', 'structure', 'Long vessel body with raised bow and stern, optional masts and cabin.',
  ['ship', 'longhouse', 'airship gondola', 'crashed shuttle', 'ark', 'train car'],
  [
    N('ratio', 1.5, 4.5, 3, 'length over beam'),
    N('sheer', 0, 1, 0.5, 'bow and stern lift'),
    N('masts', 0, 3, 1, 'masts with sails'),
    C('cabin', ['none', 'aft', 'long'], 'aft', 'deckhouse'),
  ],
  (d) => {
    const L = 0.92;
    const ratio = num(d, 'ratio');
    const sheer = num(d, 'sheer');
    const masts = int(d, 'masts');
    const cabin = str(d, 'cabin');
    const Wd = clamp(L / ratio, 0.2, 0.62);
    const top = 1.6;
    const out: BlueprintPart[] = [
      box(0, 0, 0, L * 0.9, Wd * 0.7, 0.6, 'dark'),
      box(0, 0, 0.6, L, Wd, 1.0, 'wall2'),
      box(0, 0, top - 0.1, L, Wd * 1.04, 0.15, 'trim'),
      wedge(L / 2 - 0.07, 0, top, 0.16, Wd, 0.6 + sheer * 1.6, 'wall'),
      wedge(-(L / 2 - 0.07), 0, top, 0.16, Wd, 0.4 + sheer * 1.0, 'wall', { rot: 180 }),
    ];
    if (masts > 0) {
      out.push(cyl(0, 0, top, 0.03, 0.03, 7, 'dark', { repeat: masts, gap: 0.26 }));
      out.push(box(0, 0, top + 1.2, 0.02, Wd * 1.3, 4.4, 'wall', { repeat: masts, gap: 0.26 }));
    }
    if (cabin === 'aft') {
      out.push(box(-0.3, 0, top, 0.22, Wd * 0.85, 1.7, 'wall'));
      out.push(box(-0.3, 0, top + 1.7, 0.26, Wd * 0.95, 0.2, 'roof'));
    } else if (cabin === 'long') {
      out.push(box(0, 0, top, L * 0.55, Wd * 0.8, 1.6, 'wall'));
      out.push(gable(0, 0, top + 1.6, L * 0.6, Wd * 0.95, 1.2, 'roof'));
    }
    return out;
  },
);

export const shell = skel(
  'shell', 'structure', 'Organic cap on a stalk, skirt, lobes.',
  ['mushroom house', 'beehive', 'gourd dwelling', 'coral home', 'seed pod', 'jellyfish tower'],
  [
    N('stalk', 0.5, 8, 3, 'stalk height, m'),
    N('cap', 0.4, 1, 0.8, 'cap width'),
    N('droop', 0, 1, 0.4, 'skirt hanging low'),
    N('lobes', 1, 5, 1, 'bulbs on the cap'),
  ],
  (d, rng) => {
    const S = num(d, 'stalk');
    const capW = num(d, 'cap');
    const droop = num(d, 'droop');
    const lobes = int(d, 'lobes');
    const capH = 1.6 + capW * 2.4;
    const out: BlueprintPart[] = [
      cone(0, 0, 0, 0.34, 0.34, Math.min(0.8, S * 0.25), 'wall2'),
      cyl(0, 0, 0, 0.2, 0.2, S, 'wall2'),
    ];
    const skirt = Math.min(droop * 1.6, S);
    if (droop >= 0.08 && skirt >= 0.1) out.push(cyl(0, 0, S - skirt, capW * 0.96, capW * 0.86, skirt, 'accent'));
    out.push(dome(0, 0, S, capW, capW * 0.9, capH, 'accent'));
    for (let k = 1; k < lobes; k++) {
      const a = rng.range(0, Math.PI * 2);
      out.push(dome(capW * 0.3 * Math.cos(a), capW * 0.27 * Math.sin(a), S + capH * 0.3, capW * 0.45, capW * 0.4, capH * 0.6, 'accent'));
    }
    if (S >= 1.6) out.push(box(0, 0.105, 0.6, 0.09, 0.03, 0.9, 'glow'));
    out.push(sph(0, -0.15, S + capH * 0.5, 0.08, 0.08, 0.1, 'trim', { repeat: 3, gap: 0.2 }));
    return out;
  },
);

interface Mod { x: number; z: number; y: number; w: number; d: number; h: number }

export const block = skel(
  'block', 'structure', 'Stacked offset boxes: modules piled, shifted and cantilevered.',
  ['shipping-container stack', 'brutalist block', 'favela stack', 'cliff dwelling', 'habitat modules', 'crate city'],
  [
    N('modules', 2, 12, 5, 'boxes'),
    N('offset', 0, 1, 0.4, 'sideways shift per box'),
    N('cantilever', 0, 1, 0.3, 'upper boxes overhang'),
  ],
  (d, rng) => {
    const m = int(d, 'modules');
    const off = num(d, 'offset');
    const cant = num(d, 'cantilever');
    const mods: Mod[] = [{ x: 0, z: 0, y: 0, w: 0.5, d: 0.45, h: 2.8 }];
    for (let i = 1; i < m; i++) {
      const base = mods[rng.int(0, mods.length - 1)] as Mod;
      const sign = rng.chance(0.5) ? 1 : -1;
      const dz = rng.range(-0.06, 0.06);
      const stackY = base.y + base.h;
      if (stackY + 2.8 <= 14) {
        const w = clamp(base.w * (1 + cant * rng.range(0.2, 0.8)) * rng.range(0.85, 1.05), 0.25, 0.8);
        const x = clamp(base.x + sign * off * ((base.w + w) / 2) * 0.8, -0.5, 0.5);
        mods.push({ x, z: clamp(base.z + dz, -0.12, 0.12), y: stackY, w, d: clamp(base.d * rng.range(0.9, 1.1), 0.3, 0.55), h: 2.8 });
      } else {
        const w = rng.range(0.3, 0.5);
        mods.push({ x: clamp(base.x + sign * (base.w / 2 + w / 2) * 0.98, -0.5, 0.5), z: clamp(dz, -0.1, 0.1), y: 0, w, d: rng.range(0.35, 0.5), h: 2.8 });
      }
    }
    const out: BlueprintPart[] = [];
    mods.forEach((p, i) => {
      out.push(box(p.x, p.z, p.y, p.w, p.d, p.h, i % 3 === 1 ? 'wall2' : i % 5 === 4 ? 'accent' : 'wall'));
      out.push(box(p.x, p.z + p.d / 2 + 0.005, p.y + 1.0, p.w * 0.75, 0.03, 0.9, 'glass'));
    });
    return out;
  },
);

export const wall = skel(
  'wall', 'structure', 'Enclosure segment with a gate gap, battlements, posts.',
  ['palisade', 'rampart', 'hedge', 'fence', 'sea wall', 'force-field line'],
  [
    N('height', 1, 8, 3, 'metres'),
    N('crenels', 0, 8, 3, 'merlons per side'),
    N('posts', 0, 12, 4, 'upright stakes'),
  ],
  (d) => {
    const H = num(d, 'height');
    const cr = int(d, 'crenels');
    const posts = int(d, 'posts');
    const half = (0.95 - 0.22) / 2;
    const cx = 0.11 + half / 2;
    const out: BlueprintPart[] = [
      box(0, 0, 0, half, 0.12, H, 'wall', { repeat: 2, gap: cx * 2 }),
      box(0, 0, 0, 0.98, 0.2, 0.3, 'wall2'),
      box(0, 0, 0, 0.07, 0.16, H * 1.2, 'wall2', { repeat: 2, gap: 0.26 }),
      box(0, 0, H, half * 1.05, 0.16, 0.12, 'wall2', { repeat: 2, gap: cx * 2 }),
    ];
    if (H >= 3) out.push(box(0, 0, Math.max(2.2, H * 0.75), 0.34, 0.16, 0.35, 'wall2'));
    if (cr > 0) {
      const g = half / cr;
      out.push(box(-cx, 0, H, g * 0.55, 0.12, H * 0.18 + 0.3, 'wall', { repeat: cr, gap: g }));
      out.push(box(cx, 0, H, g * 0.55, 0.12, H * 0.18 + 0.3, 'wall', { repeat: cr, gap: g }));
    }
    if (posts > 0) {
      const k = Math.ceil(posts / 2);
      const g = 0.55 / Math.max(1, k);
      out.push(cyl(-0.3, 0.075, 0, 0.05, 0.05, H * 1.25, 'wall2', { repeat: k, gap: g }));
      out.push(cyl(0.3, 0.075, 0, 0.05, 0.05, H * 1.25, 'wall2', { repeat: k, gap: g }));
    }
    return out;
  },
);

export const canopy = skel(
  'canopy', 'structure', 'Roof on posts over a slab, optional counter.',
  ['market stall', 'bandstand', 'bus shelter', 'gazebo', 'fuel pump cover', 'shrine pavilion'],
  [
    N('posts', 2, 8, 4, 'supports'),
    C('roof', ['flat', 'gable', 'pyramid', 'dome', 'shed'], 'gable', 'roof form'),
    N('counter', 0, 1, 0.5, 'front counter length'),
  ],
  (d) => {
    const k = clamp(Math.ceil(int(d, 'posts') / 2), 1, 4);
    const roof = str(d, 'roof');
    const counter = num(d, 'counter');
    const gap = k > 1 ? 0.9 / (k - 1) : 0;
    const out: BlueprintPart[] = [
      box(0, 0, 0, 0.98, 0.8, 0.12, 'wall2'),
      cyl(0, -0.3, 0, 0.04, 0.04, 2.8, 'dark', { repeat: k, gap }),
      cyl(0, 0.3, 0, 0.04, 0.04, 2.8, 'dark', { repeat: k, gap }),
    ];
    switch (roof) {
      case 'flat': out.push(box(0, 0, 2.8, 1.1, 0.9, 0.2, 'roof')); break;
      case 'pyramid': out.push(pyr(0, 0, 2.8, 1.1, 0.9, 1.5, 'roof')); break;
      case 'dome': out.push(dome(0, 0, 2.8, 0.95, 0.8, 1.4, 'roof')); break;
      case 'shed': out.push(wedge(0, 0, 2.8, 1.1, 0.9, 0.8, 'roof')); break;
      default: out.push(gable(0, 0, 2.8, 1.1, 0.9, 1.3, 'roof'));
    }
    if (counter > 0.1) {
      out.push(box(0, 0.28, 0.12, 0.8 * counter, 0.14, 0.9, 'wall'));
      out.push(box(0, 0.28, 1.02, 0.12, 0.1, 0.2, 'accent', { repeat: 3, gap: 0.2 * counter }));
    }
    return out;
  },
);
