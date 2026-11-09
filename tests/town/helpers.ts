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
