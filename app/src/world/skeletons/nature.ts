// Nature skeletons. Props sit on a 1 x 1 footprint; heights are in footprint units, so the prop's size scales them.
// Convention: foliage, caps and crystals take 'accent' or 'glow'; trunks and stone take 'wall2'.
import type { BlueprintPart } from '../spec';
import { box, C, clamp, cone, cyl, dome, lerp, N, num, pyr, skel, sph, str, wedge, int } from './util';

const CROWNS = [
  'ball', 'cone', 'layers', 'umbrella', 'weeping', 'dead', 'palm', 'cactus', 'giant-mushroom',
  'bush', 'reeds', 'fern', 'flowers',
];

export const tree = skel(
  'tree', 'nature', 'Trunk and crown or low plant: forests, deserts, fungus groves, gardens.',
  ['oak', 'pine', 'palm', 'saguaro cactus', 'giant mushroom', 'reed bed', 'coral fan'],
  [
    N('trunk', 0.2, 2, 0.9, 'trunk or stem height'),
    C('crown', CROWNS, 'ball', 'crown or plant form'),
    N('crownSize', 0.3, 0.85, 0.7, 'crown width'),
    N('lean', 0, 1, 0.2, 'crown drifts sideways'),
  ],
  (d) => {
    const T = num(d, 'trunk');
    const crown = str(d, 'crown');
    const cs = num(d, 'crownSize');
    const ox = Math.min(num(d, 'lean') * 0.25, cs / 2 - 0.06);
    const roots = cone(0, 0, 0, 0.26, 0.26, 0.18, 'wall2');
    const trunk = (t: number, w = 0.12): BlueprintPart => cyl(0, 0, 0, w, w, t, 'wall2');
    switch (crown) {
      case 'cone':
        return [roots, trunk(T), cone(ox, 0, T * 0.55, cs * 1.2, cs * 1.2, cs * 0.7, 'accent'), cone(ox, 0, T * 0.7, cs, cs, cs * 1.8, 'accent')];
      case 'layers':
        return [roots, trunk(T), ...[0, 1, 2].map((k) => cone(ox, 0, T * 0.6 + k * cs * 0.38, cs * (1.15 - 0.28 * k), cs * (1.15 - 0.28 * k), cs * 0.7, 'accent'))];
      case 'umbrella':
        return [roots, trunk(T + 0.2), cyl(ox, 0, T + 0.14, cs * 1.2, cs * 1.2, 0.08, 'wall2'), dome(ox, 0, T + 0.2, cs * 1.25, cs * 1.25, cs * 0.5, 'accent')];
      case 'weeping': {
        const sh = Math.min(T, cs * 0.55);
        return [roots, trunk(T), dome(ox, 0, T, cs, cs, cs * 0.55, 'accent'), box(ox, 0, T - sh, 0.04, 0.04, sh, 'accent', { repeat: 5, gap: cs * 0.18 })];
      }
      case 'dead': {
        const k = cs / 0.7;
        return [
          roots, trunk(T * 1.1, 0.1),
          box(0.1 * k, 0, T * 0.55, 0.35 * k, 0.05, 0.06, 'wall2', { rot: 20 }),
          box(-0.1 * k, 0.02, T * 0.75, 0.3 * k, 0.05, 0.06, 'wall2', { rot: -25 }),
          box(0.27 * k, 0, T * 0.55, 0.04, 0.04, 0.28 * k, 'wall2'),
        ];
      }
      case 'palm': {
        const Tt = T * 1.4;
        return [
          roots, trunk(Tt, 0.09),
          ...[0, 45, 90, 135].map((r) => box(ox, 0, Tt, cs * 1.2, 0.09, 0.05, 'accent', { rot: r })),
          sph(ox, 0, Tt - 0.1, 0.12, 0.12, 0.12, 'wall2'),
        ];
      }
      case 'cactus': {
        const k = T * 0.45;
        return [
          cyl(0, 0, 0, 0.2, 0.2, T + 0.3, 'accent'),
          dome(0, 0, T + 0.3, 0.2, 0.2, 0.1, 'accent'),
          box(0.12, 0, k, 0.22, 0.1, 0.1, 'accent'),
          cyl(0.22, 0, k, 0.1, 0.1, T * 0.4, 'accent'),
          box(-0.12, 0, T * 0.3, 0.2, 0.1, 0.1, 'accent'),
          cyl(-0.2, 0, T * 0.3, 0.09, 0.09, T * 0.3, 'accent'),
        ];
      }
      case 'giant-mushroom': {
        const s = T * 1.2;
        const w = cs * 1.25;
        return [roots, cyl(0, 0, 0, 0.22, 0.22, s, 'trim'), dome(ox, 0, s, w, w, cs * 0.6, 'accent'), sph(ox, -0.1, s + cs * 0.3, 0.08, 0.08, 0.08, 'trim', { repeat: 3, gap: 0.2 })];
      }
      case 'bush':
        return [
          sph(0, 0, 0, cs, cs, cs * 0.8, 'accent'),
          sph(0.2 * cs, 0.15, 0, cs * 0.6, cs * 0.6, cs * 0.5, 'accent'),
          sph(-0.2 * cs, -0.12, 0, cs * 0.55, cs * 0.55, cs * 0.5, 'accent'),
          sph(0, 0.25 * cs, cs * 0.3, 0.07, 0.07, 0.07, 'glow', { repeat: 3, gap: 0.12 }),
        ];
      case 'reeds': {
        const g = 0.13 * (cs / 0.7);
        return [
          cyl(0, -0.15, 0, 0.03, 0.03, T + 0.2, 'accent', { repeat: 7, gap: g }),
          cyl(0, 0.05, 0, 0.03, 0.03, T * 0.8, 'accent', { repeat: 8, gap: g * 0.85 }),
          cyl(0, 0.22, 0, 0.03, 0.03, T * 0.65, 'accent', { repeat: 6, gap: g * 1.1 }),
          box(0, -0.15, T + 0.2, 0.05, 0.05, 0.15, 'wall2', { repeat: 7, gap: g }),
        ];
      }
      case 'fern': {
        const leaves = [0, 60, 120, 180, 240, 300].map((r) => {
          const a = (r * Math.PI) / 180;
          return wedge(0.22 * Math.cos(a), -0.22 * Math.sin(a), 0, cs * 0.7, 0.1, T * 0.35 + 0.1, 'accent', { rot: r });
        });
        return [...leaves, sph(0, 0, 0, 0.16, 0.16, 0.16, 'accent')];
      }
      case 'flowers': {
        const g = 0.16 * (cs / 0.7);
        const s = T * 0.6 + 0.1;
        return [
          cyl(0, -0.1, 0, 0.02, 0.02, s, 'accent', { repeat: 5, gap: g }),
          cyl(0, 0.15, 0, 0.02, 0.02, s * 0.8, 'accent', { repeat: 5, gap: g }),
          sph(0, -0.1, s - 0.04, 0.1, 0.1, 0.1, 'trim', { repeat: 5, gap: g }),
          sph(0, 0.15, s * 0.8 - 0.04, 0.1, 0.1, 0.1, 'glow', { repeat: 5, gap: g }),
        ];
      }
      default:
        return [roots, trunk(T), sph(ox, 0, T * 0.9, cs, cs, cs * 1.05, 'accent'), sph(-ox * 0.5, 0.1, T * 0.9 + cs * 0.35, cs * 0.6, cs * 0.6, cs * 0.6, 'accent')];
    }
  },
);

export const rock = skel(
  'rock', 'nature', 'Cluster of boulders or crystals standing on the ground.',
  ['boulders', 'mesa stones', 'ice shards', 'glowing crystals', 'ore outcrop', 'coral heads'],
  [
    C('form', ['boulder', 'crystal'], 'boulder', 'stone type'),
    N('count', 1, 7, 3, 'pieces'),
    N('height', 0.2, 1, 0.5, 'tallest piece'),
    N('jagged', 0, 1, 0.5, 'rough, or thin and sharp'),
    N('flat', 0, 1, 0.2, 'flat top, or crystal tilt'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const n = int(d, 'count');
    const H = num(d, 'height');
    const jag = num(d, 'jagged');
    const flat = num(d, 'flat');
    const out: BlueprintPart[] = [];
    if (form === 'crystal') {
      out.push(cone(0, 0, 0, 0.8, 0.7, 0.14, 'wall2'));
      out.push(sph(0.34, 0.2, 0, 0.14, 0.12, 0.1, 'wall2'));
      for (let i = 0; i < n; i++) {
        const a = i * 2.4 + rng.range(0, 1);
        const r = i === 0 ? 0 : Math.min(0.34, 0.12 + 0.07 * i);
        const hi = i === 0 ? H : H * rng.range(0.5, 0.95);
        const wi = lerp(0.2, 0.07, jag);
        const dx = flat * wi * 0.9 * (i % 2 === 0 ? 1 : -1);
        const x = r * Math.cos(a);
        const z = clamp(r * Math.sin(a), -0.3, 0.3);
        out.push(cyl(x, z, 0, wi, wi, hi * 0.55, 'glass'));
        out.push(pyr(x + dx, z, hi * 0.55, wi * 0.95, wi * 0.95, hi * 0.5, 'glow'));
      }
      return out;
    }
    for (let i = 0; i < n; i++) {
      const main = i === 0;
      const w = main ? 0.6 : rng.range(0.2, 0.4);
      const x = main ? 0 : clamp(rng.range(-0.38, 0.38), -0.4, 0.4);
      const z = main ? 0 : clamp(rng.range(-0.3, 0.3), -0.3, 0.3);
      const h = (main ? H : H * rng.range(0.3, 0.7));
      const rot = rng.range(0, 90);
      const tone = i % 2 === 0 ? 'wall2' : 'wall';
      if (flat > 0.55) out.push(rng.chance(0.5) ? cyl(x, z, 0, w, w * 0.9, h * 0.8, tone, { rot }) : box(x, z, 0, w, w * 0.85, h * 0.8, tone, { rot }));
      else if (jag < 0.35) out.push(sph(x, z, 0, w, w * 0.85, h, tone, { rot }));
      else if (jag < 0.7) out.push(pyr(x, z, 0, w, w * 0.85, h * 1.1, tone, { rot }));
      else out.push(cone(x, z, 0, w * 0.8, w * 0.7, h * 1.4, tone, { rot }));
    }
    const pebbles = Math.max(1, 4 - n);
    for (let i = 0; i < pebbles; i++) out.push(sph(rng.range(-0.42, 0.42), rng.range(-0.4, 0.4), 0, 0.12, 0.1, 0.08, 'wall'));
    return out;
  },
);
