// Object skeletons. Props sit on a 1 x 1 footprint; heights are in footprint units, so the prop's size scales them.
import type { BlueprintPart } from '../spec';
import { arch, box, C, cone, cyl, dome, int, N, num, pyr, ring, skel, sph, str, wedge } from './util';

export { vehicle, machine, fence, stall } from './object-b';

export const pole = skel(
  'pole', 'object', 'Thin upright with a head: lamp, banner, totem, signs or antenna.',
  ['street lamp', 'banner pole', 'totem', 'signpost', 'radio mast', 'maypole'],
  [
    C('head', ['lamp', 'banner', 'totem', 'signs', 'antenna'], 'lamp', 'what it carries'),
    N('height', 1, 3.5, 2, 'footprint units'),
    N('arms', 0, 3, 1, 'lamps, banners, boards, bars'),
  ],
  (d) => {
    const head = str(d, 'head');
    const H = num(d, 'height');
    const k = int(d, 'arms');
    const base = cyl(0, 0, 0, 0.18, 0.18, 0.12, 'wall2');
    const thin = cyl(0, 0, 0, 0.06, 0.06, H, 'dark');
    switch (head) {
      case 'banner': {
        const n = Math.max(1, k);
        return [
          base, thin,
          box(0, 0, H - 0.12, 0.3 + 0.28 * n, 0.03, 0.04, 'dark'),
          box(0, 0, H - 0.62, 0.22, 0.02, 0.5, 'accent', { repeat: n, gap: 0.26 }),
          sph(0, 0, H, 0.1, 0.1, 0.1, 'accent'),
        ];
      }
      case 'totem': {
        const n = Math.max(1, k);
        const blocks: BlueprintPart[] = [];
        for (let i = 0; i < n; i++) blocks.push(box(0, 0, 0.15 * H + i * 0.27 * H, 0.34, 0.34, 0.2 * H, i % 2 === 0 ? 'accent' : 'wall'));
        return [base, cyl(0, 0, 0, 0.22, 0.22, H, 'wall2'), ...blocks, box(0, 0, H * 0.55, 0.6, 0.07, 0.08, 'accent'), cone(0, 0, H, 0.3, 0.3, 0.25, 'accent')];
      }
      case 'signs': {
        const n = Math.max(1, k);
        const boards: BlueprintPart[] = [];
        for (let i = 0; i < n; i++) boards.push(box(i % 2 === 0 ? 0.17 : -0.17, 0, H - 0.12 - i * 0.2, 0.36, 0.03, 0.12, i % 2 === 0 ? 'wall' : 'accent'));
        return [base, thin, cone(0, 0, H, 0.1, 0.1, 0.18, 'dark'), ...boards];
      }
      case 'antenna': {
        const bars: BlueprintPart[] = [];
        for (let i = 0; i < k; i++) bars.push(box(0, 0, H * (0.4 + 0.18 * i), 0.5 - 0.1 * i, 0.02, 0.03, 'dark'));
        return [base, thin, ...bars, dome(0, 0, H - 0.05, 0.3, 0.3, 0.15, 'trim'), sph(0, 0, H, 0.06, 0.06, 0.1, 'glow')];
      }
      default: {
        if (k === 0) return [base, thin, sph(0, 0, H - 0.05, 0.2, 0.2, 0.24, 'glow'), cone(0, 0, H + 0.19, 0.26, 0.26, 0.14, 'dark')];
        return [base, thin, box(0, 0, H - 0.1, 0.3 + 0.2 * k, 0.04, 0.04, 'dark'), sph(0, 0, H - 0.28, 0.15, 0.15, 0.18, 'glow', { repeat: k, gap: 0.28 })];
      }
    }
  },
);

/** One container of the given form with its base at y = cy, width sw and height H (footprint units). */
function unit(form: string, cx: number, cz: number, cy: number, sw: number, H: number): BlueprintPart[] {
  switch (form) {
    case 'crate':
      return [box(cx, cz, cy, sw, sw, H, 'wall'), box(cx, cz, cy + H * 0.44, sw * 1.03, sw * 1.03, H * 0.12, 'wall2'), box(cx, cz, cy + H, sw * 1.05, sw * 1.05, H * 0.1, 'wall2')];
    case 'chest':
      return [
        box(cx, cz, cy, sw * 1.1, sw * 0.8, H * 0.6, 'wall'),
        arch(cx, cz, cy + H * 0.6, sw * 1.1, sw * 0.8, H * 0.45, 'wall2'),
        box(cx, cz + sw * 0.4 + 0.01, cy + H * 0.45, 0.08, 0.03, 0.14, 'accent'),
      ];
    case 'urn':
      return [
        cyl(cx, cz, cy, sw * 0.5, sw * 0.5, H * 0.2, 'wall2'),
        sph(cx, cz, cy + H * 0.15, sw, sw, H * 0.55, 'wall'),
        cyl(cx, cz, cy + H * 0.6, sw * 0.4, sw * 0.4, H * 0.28, 'wall2'),
        cyl(cx, cz, cy + H * 0.84, sw * 0.55, sw * 0.55, H * 0.1, 'accent'),
      ];
    case 'sacks':
      return [
        sph(cx, cz, cy, sw, sw * 0.9, H * 0.8, 'wall'),
        cone(cx, cz, cy + H * 0.65, sw * 0.35, sw * 0.35, H * 0.3, 'wall'),
        sph(cx + sw * 0.3, cz + 0.1, cy, sw * 0.8, sw * 0.7, H * 0.6, 'wall2'),
        cone(cx + sw * 0.3, cz + 0.1, cy + H * 0.5, sw * 0.28, sw * 0.28, H * 0.25, 'wall2'),
      ];
    case 'tank':
      return [
        box(cx, cz, cy, sw * 0.1, sw * 0.1, H * 0.2, 'dark', { repeat: 2, gap: sw * 0.6 }),
        cyl(cx, cz, cy + H * 0.15, sw, sw, H * 0.7, 'wall2'),
        dome(cx, cz, cy + H * 0.85, sw, sw, H * 0.14, 'wall2'),
        cyl(cx + sw * 0.3, cz, cy + H * 0.85, sw * 0.12, sw * 0.12, H * 0.25, 'dark'),
      ];
    default:
      return [
        cyl(cx, cz, cy, sw, sw, H, 'wall2'),
        cyl(cx, cz, cy + H - 0.03, sw * 0.9, sw * 0.9, 0.05, 'wall'),
        ring(cx, cz, cy + H * 0.2, sw * 1.02, sw * 1.02, 0.08, 'dark'),
        ring(cx, cz, cy + H * 0.7, sw * 1.02, sw * 1.02, 0.08, 'dark'),
      ];
  }
}

export const container = skel(
  'container', 'object', 'Vessel for goods, single or piled.',
  ['barrel', 'crate', 'treasure chest', 'amphora', 'grain sacks', 'fuel tank'],
  [
    C('form', ['barrel', 'crate', 'chest', 'urn', 'sacks', 'tank'], 'barrel', 'vessel type'),
    N('count', 1, 4, 1, 'pieces in the pile'),
    N('height', 0.3, 1.2, 0.6, 'footprint units'),
  ],
  (d) => {
    const form = str(d, 'form');
    const n = int(d, 'count');
    const H = num(d, 'height');
    const out: BlueprintPart[] = [box(0, 0, 0, 0.96, 0.7, 0.05, 'dark')];
    const y = H * 0.75;
    if (n === 1) out.push(...unit(form, 0, 0, 0.05, 0.5, H));
    else if (n === 2) out.push(...unit(form, -0.26, 0, 0.05, 0.44, H), ...unit(form, 0.26, 0, 0.05, 0.44, H));
    else if (n === 3) out.push(...unit(form, -0.25, 0, 0.05, 0.44, H), ...unit(form, 0.25, 0, 0.05, 0.44, H), ...unit(form, 0, 0, y, 0.42, H));
    else out.push(...unit(form, -0.32, 0, 0.05, 0.3, H), ...unit(form, 0, 0, 0.05, 0.3, H), ...unit(form, 0.32, 0, 0.05, 0.3, H), ...unit(form, 0.16, 0, y, 0.3, H));
    return out;
  },
);

export const furniture = skel(
  'furniture', 'object', 'Things to sit at, load or display.',
  ['bench', 'trestle table', 'handcart', 'stall rack', 'throne', 'workbench'],
  [
    C('form', ['bench', 'table', 'cart', 'rack', 'throne'], 'bench', 'furniture type'),
    N('length', 0.4, 1, 0.8, 'long dimension'),
    N('height', 0.3, 1.2, 0.5, 'footprint units'),
    N('extras', 0, 1, 0.5, 'backrest, cloth, load, ornament'),
  ],
  (d) => {
    const form = str(d, 'form');
    const L = num(d, 'length');
    const H = num(d, 'height');
    const ex = num(d, 'extras');
    switch (form) {
      case 'table':
        return [
          box(0, 0, H * 0.9, L, L * 0.6, H * 0.1, 'wall'),
          box(0, -0.2, 0, 0.06, 0.06, H * 0.92, 'wall2', { repeat: 2, gap: L * 0.8 }),
          box(0, 0.2, 0, 0.06, 0.06, H * 0.92, 'wall2', { repeat: 2, gap: L * 0.8 }),
          sph(0.2 * L, 0, H, 0.1, 0.1, 0.1, 'trim'),
          ...(ex > 0.5 ? [box(0, 0, H * 0.82, L * 1.05, L * 0.62, H * 0.16, 'accent')] : []),
        ];
      case 'cart': {
        const hx = Math.min(0.5, L / 2 + 0.08);
        return [
          box(0, 0, H * 0.35, L, 0.5, H * 0.2, 'wall'),
          sph(0, -0.24, 0, 0.28, 0.04, H * 0.7, 'dark', { repeat: 2, gap: L * 0.6 }),
          sph(0, 0.24, 0, 0.28, 0.04, H * 0.7, 'dark', { repeat: 2, gap: L * 0.6 }),
          box(hx, 0, H * 0.4, 0.2, 0.04, 0.04, 'wall2'),
          sph(-0.1, 0, H * 0.55, 0.3 * (0.5 + ex), 0.3, 0.3, 'accent'),
        ];
      }
      case 'rack':
        return [
          box(0, -0.17, 0, 0.05, 0.05, H * 1.6, 'wall2', { repeat: 2, gap: L * 0.95 }),
          box(0, 0.17, 0, 0.05, 0.05, H * 1.6, 'wall2', { repeat: 2, gap: L * 0.95 }),
          box(0, 0, H * 0.4, L, 0.4, 0.04, 'wall'),
          box(0, 0, H * 0.9, L, 0.4, 0.04, 'wall'),
          sph(0, 0, H * 0.4 + 0.04, 0.1, 0.1, 0.1, 'accent', { repeat: 4, gap: L * 0.2 }),
          sph(0, 0, H * 0.9 + 0.04, 0.1, 0.1, 0.1, 'glow', { repeat: 3, gap: L * 0.25 }),
        ];
      case 'throne': {
        const bh = H * (0.7 + 0.6 * ex);
        return [
          box(0, 0, 0, 0.5, 0.45, H * 0.55, 'wall'),
          box(0, -0.17, H * 0.55, 0.5, 0.1, bh, 'wall2'),
          box(0, 0, H * 0.55, 0.06, 0.4, H * 0.3, 'wall2', { repeat: 2, gap: 0.44 }),
          box(0, 0.03, H * 0.55, 0.36, 0.3, 0.07, 'accent'),
          sph(0, -0.17, H * 0.55 + bh, 0.14, 0.14, 0.16, 'accent'),
        ];
      }
      default:
        return [
          box(0, 0, H * 0.5, L, 0.3, H * 0.1, 'wall'),
          box(0, 0, 0, 0.06, 0.26, H * 0.52, 'wall2', { repeat: 2, gap: L * 0.8 }),
          box(0, 0, H * 0.2, L * 0.8, 0.04, 0.04, 'wall2'),
          ex > 0.3 ? box(0, -0.12, H * 0.6, L, 0.05, H * 0.55 * (0.5 + ex), 'wall') : box(0, 0, H * 0.6, L * 0.5, 0.22, H * 0.08, 'accent'),
        ];
    }
  },
);

export const blade = skel(
  'blade', 'object', 'Pointed tool or weapon, upright or lying flat.',
  ['dagger', 'cleaver', 'sword in stone', 'spear head', 'pen nib', 'chisel'],
  [
    C('pose', ['standing', 'lying'], 'standing', 'upright or flat'),
    N('length', 0.3, 1, 0.8, 'blade length'),
    N('width', 0.03, 0.3, 0.1, 'blade width'),
    N('curve', 0, 1, 0, 'bend along the blade'),
    N('guard', 0, 1, 0.5, 'cross-guard size'),
    C('tip', ['point', 'clip', 'round', 'chisel'], 'point', 'end shape'),
  ],
  (d) => {
    const pose = str(d, 'pose');
    const L = num(d, 'length');
    const w = num(d, 'width');
    const curve = num(d, 'curve');
    const guard = num(d, 'guard');
    const tip = str(d, 'tip');
    const gw = 0.12 + 0.5 * guard;
    const out: BlueprintPart[] = [];
    if (pose === 'lying') {
      const bl = L * 0.7;
      const x0 = -0.24;
      const step = w * 0.8 * curve;
      out.push(box(0, 0, 0, 0.98, 0.5, 0.03, 'wall2'));
      out.push(box(-0.38, 0, 0.03, 0.22, 0.05, 0.05, 'dark'));
      out.push(box(-0.26, 0, 0.03, 0.04, gw, 0.06, 'accent'));
      const bodyL = bl * (tip === 'chisel' ? 0.9 : 0.65);
      out.push(box(x0 + bodyL / 2, step * 0.5, 0.03, bodyL, w, 0.05, 'trim'));
      const xe = x0 + bodyL;
      const rest = bl - bodyL;
      if (tip === 'point') [0.7, 0.4, 0.15].forEach((f, i) => out.push(box(xe + rest * ((i + 0.5) / 3), step * (1 + i * 0.5), 0.03, rest / 3, w * f, 0.05, 'trim')));
      else if (tip === 'clip') [0.7, 0.3].forEach((f, i) => out.push(box(xe + rest * ((i + 0.5) / 2), step * (1 + i * 0.5), 0.03, rest / 2, w * f, 0.05, 'trim')));
      else if (tip === 'round') out.push(cyl(xe, step, 0.03, w, w, 0.05, 'trim'));
      else out.push(box(xe + rest / 2, step, 0.03, Math.max(0.02, rest), w * 0.9, 0.04, 'wall'));
      return out;
    }
    const Hh = L * 1.6;
    const grip = Hh * 0.22;
    const segs = curve > 0.1 ? 3 : 1;
    const bladeH = Hh - grip - 0.1;
    const segH = bladeH / segs;
    const yb = 0.08 + grip;
    out.push(cyl(0, 0, 0, 0.35, 0.35, 0.08, 'wall2'));
    out.push(cyl(0, 0, 0.08, 0.05, 0.05, grip, 'dark'));
    out.push(box(0, 0, yb - 0.03, gw, 0.06, 0.06, 'accent'));
    let dx = 0;
    for (let i = 0; i < segs; i++) {
      dx = curve * w * 0.9 * i;
      out.push(box(dx, 0, yb + i * segH, w, 0.03, segH, 'trim'));
    }
    const yt = yb + bladeH;
    if (tip === 'clip') out.push(wedge(dx, 0, yt, w, 0.03, w * 1.3, 'trim'));
    else if (tip === 'round') out.push(dome(dx, 0, yt, w, 0.03, w * 0.5, 'trim'));
    else if (tip === 'chisel') out.push(wedge(dx, 0, yt, 0.03, w, w * 0.9, 'trim', { rot: 90 }));
    else out.push(pyr(dx, 0, yt, w * 0.95, 0.03, w * 2.2, 'trim'));
    return out;
  },
);

export const statue = skel(
  'statue', 'object', 'Plinth with an abstract figure, obelisk, orb or beast.',
  ['hero statue', 'obelisk', 'orb monument', 'guardian beast', 'idol', 'memorial'],
  [
    C('form', ['figure', 'obelisk', 'orb', 'beast'], 'figure', 'subject'),
    N('height', 0.6, 2.5, 1.5, 'above plinth, units'),
    N('steps', 1, 3, 2, 'plinth tiers'),
    N('pose', 0, 1, 0.3, '>0.5 arms raised'),
  ],
  (d) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const steps = int(d, 'steps');
    const pose = num(d, 'pose');
    const out: BlueprintPart[] = [];
    for (let k = 0; k < steps; k++) out.push(box(0, 0, k * 0.14, 0.7 - 0.1 * k, 0.7 - 0.1 * k, 0.14, k % 2 === 0 ? 'wall2' : 'wall'));
    const ph = steps * 0.14;
    switch (form) {
      case 'obelisk':
        out.push(box(0, 0, ph, 0.22, 0.22, H * 0.8, 'wall'), box(0, 0, ph + H * 0.3, 0.26, 0.26, 0.06, 'trim'), pyr(0, 0, ph + H * 0.8, 0.22, 0.22, H * 0.2, 'accent'));
        break;
      case 'orb':
        out.push(cyl(0, 0, ph, 0.2, 0.2, H * 0.35, 'wall'), sph(0, 0, ph + H * 0.33, 0.42, 0.42, Math.min(H * 0.55, 0.5), 'glow'), ring(0, 0, ph + H * 0.45, 0.62, 0.62, 0.06, 'accent'));
        break;
      case 'beast':
        out.push(
          box(0, 0, ph + H * 0.3, 0.55, 0.22, H * 0.3, 'wall'),
          box(0, -0.07, ph, 0.06, 0.06, H * 0.32, 'wall2', { repeat: 2, gap: 0.4 }),
          box(0, 0.07, ph, 0.06, 0.06, H * 0.32, 'wall2', { repeat: 2, gap: 0.4 }),
          box(0.3, 0, ph + H * 0.5, 0.2, 0.18, H * 0.25, 'wall'),
          box(-0.32, 0, ph + H * 0.45, 0.15, 0.05, 0.05, 'wall2'),
        );
        break;
      default:
        out.push(box(0, 0, ph, 0.09, 0.12, H * 0.3, 'wall', { repeat: 2, gap: 0.12 }), box(0, 0, ph + H * 0.3, 0.3, 0.18, H * 0.35, 'wall2'), sph(0, 0, ph + H * 0.65, 0.16, 0.16, H * 0.15, 'wall'));
        if (pose > 0.5) out.push(box(0, 0, ph + H * 0.5, 0.07, 0.07, H * 0.35, 'wall2', { repeat: 2, gap: 0.36 }));
        else out.push(box(0, 0, ph + H * 0.5, 0.62, 0.07, H * 0.07, 'wall2'));
    }
    return out;
  },
);
