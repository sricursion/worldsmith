// Stand-ins for the three compile stages. Mock mode streams them offline, and the live route falls back to
// them when a stage fails: a keyword outline, a look from the hand-written blueprints, and the fixture cast
// re-homed onto whatever buildings the outline named.
import type { BuildingRole, QuestStep, RuleEffect, RuleSpec, ThemeId, WorldSpec } from '../../../app/src/world/spec';
import type { LookResult, Outline, OutlineBuilding, StoryResult } from '../prompts/compilemerge';
import { FIXTURES, nearestTheme } from './shared';
import { mockAir, mockSurfaces } from './mockmood';
import { BASE, mockSpec } from './mockstyle';

interface SiteHint { pattern: Outline['site']['pattern']; wild: number; paths: Outline['site']['paths']; spacing: number }

/** Layout words in the prompt pick the site, so offline worlds do not all become one street. */
function siteFor(prompt: string, base: WorldSpec): SiteHint {
  const p = prompt.toLowerCase();
  if (/forest|grove|jungle|mushroom|woods|swamp|garden|glade/.test(p)) return { pattern: 'scatter', wild: 0.9, paths: 'track', spacing: 9 };
  if (/camp|caravan|oasis|tent|nomad|village of tents/.test(p)) return { pattern: 'scatter', wild: 0.35, paths: 'track', spacing: 8 };
  if (/tower|spire|skyscraper|arcology|needle|megacity|neon/.test(p)) return { pattern: 'grid', wild: 0.05, paths: 'road', spacing: 4 };
  if (/cliff|terrace|hillside|mountain|stair/.test(p)) return { pattern: 'terraces', wild: 0.3, paths: 'track', spacing: 6 };
  if (/ring|circle|round|wheel|station/.test(p)) return { pattern: 'ring', wild: 0.15, paths: 'road', spacing: 6 };
  return base.site ?? { pattern: 'street', wild: 0.3, paths: 'road', spacing: 7 };
}

export function mockOutline(prompt: string, seed: number): Outline {
  const theme = nearestTheme(prompt);
  const fx = mockSpec(FIXTURES[theme], prompt, seed);
  const blueprintOf = new Map((fx.blueprints ?? []).map((b) => [b.id, b.summary]));
  return {
    title: fx.title, tagline: fx.tagline, era: fx.era, theme,
    site: siteFor(prompt, fx), palette: { sky: fx.palette.sky, fog: fx.palette.fog },
    mood: fx.mood ?? mockAir(prompt, theme).mood, time: { startHour: fx.time.startHour },
    buildings: fx.buildings.map((b): OutlineBuilding => ({
      id: b.id, role: b.role, label: b.label, size: b.size, keyBuilding: b.keyBuilding === true, form: blueprintOf.get(b.blueprint ?? '') ?? '',
    })),
    npcs: fx.npcs.map((n) => ({ id: n.id, name: n.name, role: n.role, home: n.home, work: n.work })),
    quest: { title: fx.quest.title, premise: fx.quest.hook }, lexicon: fx.lexicon,
  };
}

/** Which blueprint stands on which outline building: same role as a fixture building first, then a spread. */
export function mockLook(prompt: string, seed: number, theme: ThemeId, outline: Outline): LookResult {
  const fx = mockSpec(FIXTURES[theme], prompt, seed);
  const blueprints = fx.blueprints ?? [];
  const byRole = new Map<BuildingRole, string>();
  for (const b of fx.buildings) if (b.blueprint && !byRole.has(b.role)) byRole.set(b.role, b.blueprint);
  let next = 0;
  const buildings = outline.buildings.map((b) => ({
    id: b.id,
    blueprint: byRole.get(b.role) ?? blueprints[next++ % Math.max(1, blueprints.length)]?.id ?? '',
  }));
  const ids = new Set(outline.buildings.map((b) => b.id));
  // Materials follow the outline's own weather, which on the live fallback path is the model's, not the keyword guess.
  const style = fx.style ?? BASE[theme];
  return {
    style: { ...style, surfaces: mockSurfaces(prompt, theme, outline.mood) },
    site: outline.site,
    blueprints,
    props: fx.props ?? [],
    landmarks: (fx.landmarks ?? []).map((l) => ({ ...l, place: l.place === 'plaza' || ids.has(l.place) ? l.place : 'plaza' })),
    buildings,
  };
}

/** Fixture building id -> outline building id: same role, then any unused building, then a spread. */
function buildingMap(from: WorldSpec['buildings'], to: readonly OutlineBuilding[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const b of from) {
    const hit = to.find((t) => t.role === b.role && !used.has(t.id));
    if (hit) { map.set(b.id, hit.id); used.add(hit.id); }
  }
  let next = 0;
  for (const b of from) {
    if (map.has(b.id)) continue;
    const free = to.find((t) => !used.has(t.id));
    const pick = free ?? (to[next++ % to.length] as OutlineBuilding);
    map.set(b.id, pick.id);
    used.add(pick.id);
  }
  return map;
}

export function mockStory(theme: ThemeId, outline: Outline): StoryResult {
  const fx = FIXTURES[theme];
  if (outline.buildings.length === 0) return { npcs: fx.npcs, items: fx.items, quest: fx.quest, rules: fx.rules };
  const bm = buildingMap(fx.buildings, outline.buildings);
  const re = (id: string): string => (id === 'street' || id === 'plaza' ? id : (bm.get(id) ?? id));
  const effect = (e: RuleEffect): RuleEffect => {
    if (e.type === 'ban') return { ...e, where: e.where === 'town' ? 'town' : re(e.where) };
    if (e.type === 'schedule_override') return { ...e, entry: { ...e.entry, place: re(e.entry.place) } };
    return e;
  };
  const step = (s: QuestStep): QuestStep => (s.kind === 'visit' ? { ...s, target: re(s.target) } : s);
  const npcIds = new Set(fx.npcs.map((n) => n.id));
  return {
    npcs: fx.npcs.map((n) => ({
      ...n, home: re(n.home), work: re(n.work), schedule: n.schedule.map((e) => ({ ...e, place: re(e.place) })),
    })),
    items: fx.items.map((i) => ({ ...i, holder: i.holder === 'player' || npcIds.has(i.holder) ? i.holder : re(i.holder) })),
    quest: { ...fx.quest, steps: fx.quest.steps.map(step) },
    rules: fx.rules.map((r): RuleSpec => ({ ...r, effect: effect(r.effect) })),
  };
}
