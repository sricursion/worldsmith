// Nature skeletons. Props sit on a 1 x 1 footprint; heights are in footprint units, so the prop's size scales them.
// Convention: bark, stems and stone take 'wall2'; foliage takes 'accent'; caps and dead fronds 'roof';
// flowers, fruit and snow 'trim'; 'glow' appears only when a glow dial is above 0 (crystals glow by default).
// Each family lives in its own file; 'tree' and 'rock' are the older general ids and stand on the same bones.
import type { BlueprintPart } from '../spec';
import type { Rng } from '../rng';
import { box, C, clamp, cyl, lerp, N, num, skel, sph, str, int, wedge } from './util';
import { build, finished, SPARE } from './nature-util';
import * as trees from './nature-trees';
import * as plants from './nature-plants';
import * as ground from './nature-ground';
import type { Skeleton } from './types';

export const broadleaf = finished(trees.broadleaf);
export const conifer = finished(trees.conifer);
export const palm = finished(trees.palm);
export const succulent = finished(plants.succulent);
export const fungus = finished(plants.fungus);
export const shrub = finished(plants.shrub);
export const grassclump = finished(plants.grassclump);
export const vine = finished(plants.vine);
export const deadwood = finished(ground.deadwood);
export const boulder = finished(ground.boulder);
export const crystal = finished(ground.crystal);

/**
 * The old ids keep to eight parts: a prop that arrives already expanded, with no family named, is held to
 * eight, and worlds saved with these ids must come back the same.
 */
const OLD_ID_PARTS = 8;

const CROWNS = [
  'ball', 'cone', 'layers', 'umbrella', 'weeping', 'dead', 'palm', 'cactus', 'giant-mushroom',
  'bush', 'reeds', 'fern', 'flowers',
];

/** The old crown names, each handed to the family that really has that structure. */
function treeAs(crown: string, T: number, cs: number, lean: number, rng: Rng): BlueprintPart[] {
  switch (crown) {
    case 'cone': {
      const H = T * 0.7 + cs * 1.8;
      return build(trees.conifer, { [SPARE]: 1, height: H, width: cs * 1.2, whorls: 3, bare: (T * 0.5) / H, droop: 0.8, lean: lean * 0.6 }, rng);
    }
    case 'layers': {
      const H = T * 0.6 + cs * 1.6;
      return build(trees.conifer, { [SPARE]: 1, height: H, width: cs * 1.15, whorls: 4, bare: (T * 0.55) / H, droop: 0.35, lean: lean * 0.6 }, rng);
    }
    case 'umbrella': {
      const H = T + 0.2 + cs * 0.5;
      return build(trees.broadleaf, { [SPARE]: 1, height: H, trunk: (T * 0.8) / H, spread: cs * 1.1, crown: 'flat', limbs: 4, lean }, rng);
    }
    case 'weeping': {
      const H = T + cs * 0.7;
      return build(trees.broadleaf, { [SPARE]: 1, height: H, trunk: (T * 0.7) / H, spread: cs, crown: 'round', hang: 0.7, lean }, rng);
    }
    case 'dead': {
      const H = T * 1.1 + cs * 0.5;
      return build(trees.broadleaf, { [SPARE]: 1, height: H, trunk: (T * 0.6) / H, spread: cs, crown: 'bare', girth: 0.1, buttress: 0, lean }, rng);
    }
    case 'palm':
      return build(trees.palm, { [SPARE]: 1, height: T * 1.4, crown: cs * 1.9, curve: lean, fronds: 7 }, rng);
    case 'cactus':
      return build(plants.succulent, { [SPARE]: 1, form: 'column', height: T + 0.4, girth: 0.2, arms: 2 }, rng);
    case 'giant-mushroom':
      return build(plants.fungus, { [SPARE]: 1, height: T * 1.2 + cs * 0.6, cap: 'dome', capSize: cs * 1.25, stalk: 0.2, spots: 0.5 }, rng);
    case 'bush':
      return build(plants.shrub, { [SPARE]: 1, form: 'mound', height: cs * 0.85, spread: cs * 1.1, berries: 0.4 }, rng);
    case 'reeds':
      return build(plants.grassclump, { [SPARE]: 1, form: 'reeds', height: T + 0.2, spread: cs, count: 9, heads: 'cattail', lean }, rng);
    case 'fern':
      return build(trees.palm, { [SPARE]: 1, height: 0.1, girth: 0.08, crown: cs * 1.6, fronds: 7, arch: 0.6, skirt: 0, fruit: 0, curve: 0 }, rng);
    case 'flowers':
      return build(plants.grassclump, { [SPARE]: 1, form: 'blades', height: T * 0.6 + 0.1, spread: cs * 0.8, count: 6, heads: 'flower', lean: 0.3 }, rng);
    default: {
      const H = T + cs * 1.2;
      return build(trees.broadleaf, { [SPARE]: 1, height: H, trunk: (T * 0.85) / H, spread: cs, crown: 'round', lean }, rng);
    }
  }
}

export const tree = finished(skel(
  'tree', 'nature', 'Any plant by crown name; the named families give finer control.',
  ['oak', 'pine', 'palm', 'saguaro cactus', 'giant mushroom', 'reed bed', 'coral fan'],
  [
    N('trunk', 0.2, 2, 0.9, 'trunk or stem height'),
    C('crown', CROWNS, 'ball', 'crown or plant form'),
    N('crownSize', 0.3, 0.85, 0.7, 'crown width'),
    N('lean', 0, 1, 0.2, 'crown drifts sideways'),
  ],
  (d, rng) => treeAs(str(d, 'crown'), num(d, 'trunk'), num(d, 'crownSize'), num(d, 'lean'), rng),
), OLD_ID_PARTS);

export const rock = finished(skel(
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
    if (form === 'crystal') return build(ground.crystal, { count: Math.min(n, 4), height: H, girth: lerp(0.2, 0.07, jag), splay: flat, matrix: 0, glow: 1 }, rng);
    const out: BlueprintPart[] = [];
    for (let i = 0; i < n; i++) {
      const main = i === 0;
      const w = main ? 0.6 : rng.range(0.2, 0.4);
      const x = main ? 0 : clamp(rng.range(-0.38, 0.38), -0.4, 0.4);
      const z = main ? 0 : clamp(rng.range(-0.3, 0.3), -0.3, 0.3);
      const h = (main ? H : H * rng.range(0.3, 0.7));
      const rot = rng.range(0, 90);
      const tone = i % 2 === 0 ? 'wall2' : 'wall';
      if (flat > 0.55) {
        const drum = rng.chance(0.5);
        out.push(drum ? cyl(x, z, 0, w, w * 0.9, h * 0.8, tone, { rot }) : box(x, z, 0, w, w * 0.85, h * 0.8, tone, { rot }));
        // A flat-topped block is worn: its faces belly out between the corners.
        if (main && !drum) out.push(sph(x, z, 0, w * 1.12, w * 0.97, h * 0.74, tone, { rot }));
      } else if (jag < 0.35) {
        // Rounded: a stone and the smaller swelling on its shoulder.
        out.push(sph(x, z, 0, w, w * 0.85, h, tone, { rot }));
        out.push(sph(clamp(x + w * 0.18, -0.5, 0.5), z, 0, w * 0.6, w * 0.55, Math.max(0.05, h * rng.range(0.5, 0.75)), tone, { rot: rot + 40 }));
      } else if (jag < 0.7) {
        // Worn block: a rounded stone with the corners of a flat-faced core breaking through.
        out.push(sph(x, z, 0, w, w * 0.85, h, tone, { rot }));
        out.push(box(x, z, 0, w * 0.66, w * 0.56, h * 0.74, tone, { rot: rot + 25 }));
      } else {
        // Sharp: a block with one sloped face on top, never a bare spike.
        out.push(box(x, z, 0, w * 0.8, w * 0.66, Math.max(0.05, h * 0.45), tone, { rot }));
        out.push(wedge(x, z, Math.max(0.05, h * 0.45), w * 0.8, w * 0.66, Math.max(0.05, h * (0.35 + 0.6 * jag)), tone, { rot: rot + 180 * rng.int(0, 1) }));
      }
    }
    const pebbles = Math.max(1, 4 - n);
    for (let i = 0; i < pebbles; i++) out.push(sph(rng.range(-0.42, 0.42), rng.range(-0.4, 0.4), 0, 0.12, 0.1, 0.08, 'wall'));
    return out;
  },
), OLD_ID_PARTS);

/** Every nature skeleton, in catalogue order. The registry takes its nature families from this list. */
export const NATURE_SKELETONS: Skeleton[] = [
  tree, rock, broadleaf, conifer, palm, succulent, fungus, shrub, grassclump, vine, deadwood, boulder, crystal,
];
