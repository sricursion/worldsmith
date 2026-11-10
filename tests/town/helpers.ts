import { makeRng } from '../../app/src/world/rng';
import type { BuildingRole, BuildingSize, ThemeId, WorldSpec } from '../../app/src/world/spec';

export const ALL_ROLES: BuildingRole[] = [
  'saloon', 'tavern', 'inn', 'bank', 'jail', 'sheriff', 'church', 'stable',
  'general_store', 'market', 'blacksmith', 'house', 'hotel', 'townhall',
  'doctor', 'school', 'barber', 'undertaker', 'warehouse', 'workshop',
  'lab', 'hangar', 'cantina', 'command', 'habitat', 'reactor',
  'cafe', 'office', 'shop', 'garage', 'apartment', 'station', 'plaza',
];
export const THEMES: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];
const SIZES: BuildingSize[] = ['small', 'medium', 'large'];

export function makeSpec(opts: { seed?: number; count?: number; theme?: ThemeId; salt?: string } = {}): WorldSpec {
  const seed = opts.seed ?? 1234;
  const rng = makeRng(seed, opts.salt ?? 'test-spec');
  const count = opts.count ?? 8;
  const theme = opts.theme ?? 'western';
  return {
    version: 1,
    seed,
    prompt: 'test town',
    title: 'Test Town',
    tagline: 'A town for tests.',
    theme,
    era: 'now',
    palette: { ground: '#c9a46a', accent: '#c0392b', sky: 'day', fog: 0.2 },
    time: { startHour: 9, minutesPerRealSecond: 2 },
    buildings: Array.from({ length: count }, (_, i) => ({
      id: `b${i}`,
      role: rng.pick(ALL_ROLES),
      label: `Building ${i}`,
      size: rng.pick(SIZES),
      keyBuilding: i < 3,
    })),
    npcs: [],
    items: [],
    quest: { id: 'q', title: 'Q', hook: '', giver: '', steps: [], endings: [] },
    rules: [],
    lexicon: [],
  };
}

import type { Blueprint, BlueprintPart, PartShape, PartTone, StyleSpec } from '../../app/src/world/spec';

export const ALL_SHAPES: PartShape[] = ['box', 'cylinder', 'cone', 'pyramid', 'gable', 'dome', 'sphere', 'wedge', 'arch', 'ring'];

export function part(shape: PartShape, o: Partial<BlueprintPart> = {}, tone: PartTone = 'wall'): BlueprintPart {
  return { shape, x: 0, z: 0, y: 0, w: 0.5, d: 0.5, h: 2, rot: 0, tone, repeat: 1, gap: 0, ...o };
}

export const STYLE: StyleSpec = {
  name: 'test style', wall: '#b08968', wall2: '#8d6e52', roof: '#5b3a29', trim: '#e6d5b8', accent: '#c0392b',
  dark: '#2b2118', glass: '#6f9bb8', glow: '#ffd27a', ground: '#c9a46a', road: '#9a8466', variety: 0.6,
};

export const BLUEPRINTS: Blueprint[] = [
  {
    id: 'shop', summary: 'gabled shop', doorX: 0,
    parts: [
      part('box', { w: 0.9, d: 0.9, h: 4 }),
      part('gable', { w: 1, d: 1, y: 4, h: 2, tone: 'roof' }),
      part('box', { x: 0, z: 0.46, w: 0.2, d: 0.04, h: 2.2, tone: 'dark' }),
      part('box', { x: 0, z: 0.47, w: 0.1, d: 0.05, h: 0.8, y: 1 }, 'glass'),
      part('box', { x: 0, z: 0.4, y: 2.8, w: 0.12, d: 0.04, h: 0.8, repeat: 4, gap: 0.2 }, 'glass'),
    ],
  },
  {
    id: 'tower', summary: 'round tower with a dome', doorX: 0.2,
    parts: [
      part('cylinder', { w: 0.7, d: 0.7, h: 7 }),
      part('dome', { w: 0.8, d: 0.8, y: 7, h: 1.6, tone: 'roof' }),
      part('ring', { w: 0.9, d: 0.9, y: 3, h: 0.3, tone: 'accent' }),
      part('sphere', { x: 0, z: 0, y: 8.6, w: 0.1, d: 0.1, h: 0.5, tone: 'glow' }),
    ],
  },
  {
    id: 'hall', summary: 'long hall with arch and ramp', doorX: -0.25,
    parts: [
      part('box', { w: 1, d: 0.8, h: 3.5, tone: 'wall2' }),
      part('wedge', { x: 0.1, y: 3.5, w: 0.9, d: 0.8, h: 1.2, tone: 'roof' }),
      part('arch', { x: -0.25, z: 0.45, w: 0.2, d: 0.1, h: 2.6, tone: 'trim' }),
      part('pyramid', { x: 0.35, y: 4.7, w: 0.2, d: 0.2, h: 1, tone: 'accent' }),
      part('cone', { x: -0.4, z: -0.4, w: 0.15, d: 0.15, h: 5, tone: 'dark' }),
    ],
  },
];
export function makeBlueprintSpec(opts: { seed?: number; count?: number; props?: boolean; landmarks?: boolean; assign?: boolean } = {}): WorldSpec {
  const base = makeSpec({ seed: opts.seed ?? 21, count: opts.count ?? 10, theme: 'medieval', salt: 'bp-spec' });
  return {
    ...base,
    style: STYLE,
    blueprints: BLUEPRINTS,
    buildings: base.buildings.map((b, i) => (opts.assign === false || i % 4 === 3 ? b : { ...b, blueprint: BLUEPRINTS[i % BLUEPRINTS.length]?.id })),
    props: opts.props === false ? undefined : [
      { kind: 'lantern', size: 1.2, weight: 3, parts: [part('cylinder', { w: 0.1, d: 0.1, h: 1.8, tone: 'dark' }), part('sphere', { y: 1.8, w: 0.3, d: 0.3, h: 0.4, tone: 'glow' })] },
      { kind: 'stack', size: 1, weight: 1, parts: [part('box', { w: 0.8, d: 0.8, h: 0.8 }), part('box', { y: 0.8, w: 0.5, d: 0.5, h: 0.5, tone: 'accent' })] },
    ],
    landmarks: opts.landmarks === false ? undefined : [
      { id: 'tower_lm', prompt: 'a tall tower', place: 'plaza', height: 8 },
      { id: 'mill_lm', prompt: 'a windmill', place: base.buildings[1]?.id ?? 'b1', height: 6 },
    ],
  };
}

import type { LoadedKit } from '../../app/src/engine/assets';
import { KITS } from '../../app/src/town/kits';
import type { SitePattern, SiteSpec } from '../../app/src/world/spec';

export const PATTERNS: SitePattern[] = ['street', 'ring', 'scatter', 'grid', 'terraces'];

export function makeSiteSpec(
  opts: { seed?: number; count?: number; pattern: SitePattern; wild?: number; paths?: SiteSpec['paths']; spacing?: number },
): WorldSpec {
  const base = makeSpec({ seed: opts.seed ?? 1234, count: opts.count ?? 9, theme: 'medieval', salt: `site-${opts.pattern}` });
  return {
    ...base,
    site: { pattern: opts.pattern, wild: opts.wild ?? 0.3, paths: opts.paths ?? 'road', spacing: opts.spacing ?? 6 },
  };
}

export function stubKit(theme: ThemeId = 'medieval'): LoadedKit {
  const table = { small: { w: 6, d: 6 }, medium: { w: 9, d: 8 }, large: { w: 12, d: 10 } };
  return { manifest: KITS[theme], building: () => null, prop: () => null, footprint: (_r, s) => table[s] };
}
