// Stand-ins for the three compile stages. Mock mode streams them offline, and the live route falls back to
// them when a stage fails: a keyword outline (a town, or a stretch of land with a few points of interest), a
// look from hand-written or skeleton blueprints, and a cast re-homed onto whatever the outline named.
import type { BuildingRole, CharacterBase, NpcSpec, QuestStep, RuleEffect, RuleSpec, ThemeId, WorldSpec } from '../../../app/src/world/spec';
import { SPIRIT_ID, type LookResult, type Outline, type OutlineBuilding, type OutlineNpc, type StoryResult } from '../prompts/compilemerge';
import { FIXTURES, nearestTheme } from './shared';
import { landBlueprints, mockLand } from './mockland';
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
  const land = mockLand(prompt, theme);
  const blueprintOf = new Map((fx.blueprints ?? []).map((b) => [b.id, b.summary]));
  // A keyword land brings its own few structures and people; otherwise the fixture town stands on that land.
  const buildings: OutlineBuilding[] = land.structures
    ? land.structures.map((s, i) => ({ id: s.id, role: s.role, label: s.label, size: s.size, keyBuilding: i === 0, form: s.form }))
    : fx.buildings.map((b) => ({
      id: b.id, role: b.role, label: b.label, size: b.size, keyBuilding: b.keyBuilding === true, form: blueprintOf.get(b.blueprint ?? '') ?? '',
    }));
  const place = (i: number): string => buildings[i % Math.max(1, buildings.length)]?.id ?? 'street';
  const npcs: OutlineNpc[] = land.people === null
    ? fx.npcs.map((n) => ({ id: n.id, name: n.name, role: n.role, home: n.home, work: n.work }))
    : fx.npcs.slice(0, land.people).map((n, i) => ({ id: n.id, name: n.name, role: n.role, home: place(i), work: place(i) }));
  // Open land is named after the prompt itself, not after the fixture town.
  const words = prompt.trim().replace(/\s+/g, ' ').slice(0, 40).trim();
  const wild = land.structures !== null;
  const title = wild && words ? words.charAt(0).toUpperCase() + words.slice(1) : fx.title;
  const first = buildings[0];
  const premise = wild
    ? `A stranger arrives${first ? ` at ${first.label}` : ''}. Out past it lies ${land.terrain.horizon}.`
    : fx.quest.hook;
  return {
    title, tagline: wild ? `Nothing but ${land.terrain.horizon}.` : fx.tagline, era: wild ? 'the present day' : fx.era, theme,
    site: land.biome === null ? siteFor(prompt, fx) : land.site, palette: { sky: fx.palette.sky, fog: fx.palette.fog },
    mood: fx.mood ?? mockAir(prompt, theme).mood, time: { startHour: fx.time.startHour },
    terrain: land.terrain, skyFeatures: land.skyFeatures, creatures: land.creatures, folk: land.folk,
    buildings, npcs,
    quest: { title: wild ? 'The lay of the land' : fx.quest.title, premise }, lexicon: wild ? [] : fx.lexicon,
  };
}

/** Which blueprint stands on which outline building: same role as a fixture building first, then a spread. */
export function mockLook(prompt: string, seed: number, theme: ThemeId, outline: Outline): LookResult {
  const fx = mockSpec(FIXTURES[theme], prompt, seed);
  const land = mockLand(prompt, theme);
  const ids = new Set(outline.buildings.map((b) => b.id));
  // Materials follow the outline's own weather, which on the live fallback path is the model's, not the keyword guess.
  const base = fx.style ?? BASE[theme];
  const style = { ...base, surfaces: mockSurfaces(prompt, theme, outline.mood) };
  const landmarks = (fx.landmarks ?? []).map((l) => ({ ...l, place: l.place === 'plaza' || ids.has(l.place) ? l.place : 'plaza' }));
  const props = land.props ?? fx.props ?? [];

  if (land.structures) {
    // The land's own structures, each built from its skeleton; outline structures the land does not know share them in turn.
    const blueprints = landBlueprints(land.structures);
    const own = new Map(land.structures.map((s, i) => [s.id, blueprints[i]?.id ?? '']));
    let next = 0;
    const buildings = outline.buildings.map((b) => ({ id: b.id, blueprint: own.get(b.id) ?? blueprints[next++ % Math.max(1, blueprints.length)]?.id ?? '' }));
    return { style, site: outline.site, blueprints, props, landmarks: outline.terrain.settled < 0.3 ? [] : landmarks, buildings };
  }

  const blueprints = fx.blueprints ?? [];
  const byRole = new Map<BuildingRole, string>();
  for (const b of fx.buildings) if (b.blueprint && !byRole.has(b.role)) byRole.set(b.role, b.blueprint);
  let next = 0;
  const buildings = outline.buildings.map((b) => ({
    id: b.id,
    blueprint: byRole.get(b.role) ?? blueprints[next++ % Math.max(1, blueprints.length)]?.id ?? '',
  }));
  return { style, site: outline.site, blueprints, props, landmarks, buildings };
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

const BASES: readonly CharacterBase[] = ['ranger', 'rogue', 'mage', 'barbarian', 'knight', 'rogue_hooded'];

/**
 * A plain cast and quest for a place too small for the fixture story: the outline's own few people (or nobody),
 * and a walk that opens with whoever is there, or with the spirit of the place, then takes in each point of
 * interest and each kind of creature's haunt. Built only from the outline, so it fits any land.
 */
export function plainStory(outline: Outline): StoryResult {
  const ids = new Set(outline.buildings.map((b) => b.id));
  const at = (v: string, i: number): string =>
    (ids.has(v) || v === 'street' || v === 'plaza' ? v : outline.buildings[i % Math.max(1, outline.buildings.length)]?.id ?? 'street');
  const npcs: NpcSpec[] = outline.npcs.map((raw, i) => ({ ...raw, home: at(raw.home, i), work: at(raw.work, i) })).map((n, i) => ({
    id: n.id, name: n.name, role: n.role,
    persona: `${n.name} is a ${n.role} who knows this ground better than anyone. Speaks plainly and wastes no words.`,
    knowledge: [outline.quest.premise || `${outline.title} is a hard place to live.`, `The far distance is ${outline.terrain.horizon || 'empty'}.`],
    secrets: [],
    home: n.home, work: n.work,
    schedule: [
      { hour: 6, place: n.work, activity: 'work' },
      { hour: 13, place: n.home, activity: 'eat' },
      { hour: 21, place: n.home, activity: 'sleep' },
    ],
    relationships: [],
    appearance: { base: BASES[i % BASES.length] as CharacterBase, palette: i % 4 },
    temperament: { tau: 1, bias: {} },
    voice: { pitch: 1, rate: 1 },
    mood: 'calm',
  }));
  const giver = npcs[0]?.id ?? SPIRIT_ID;
  const giverName = npcs[0]?.name ?? 'the spirit of the place';
  const steps: QuestStep[] = [{
    id: 'first_words', kind: 'talk', target: giver, requires: [],
    objective: `Speak with ${giverName}.`, beat: outline.quest.premise || 'You are told what this place is and what it needs.',
  }];
  for (const b of outline.buildings.slice(0, 3)) {
    const last = steps[steps.length - 1] as QuestStep;
    const dweller = outline.creatures.find((c) => c.haunt === b.id);
    steps.push({
      id: `reach_${b.id}`.slice(0, 40), kind: 'visit', target: b.id, requires: [last.id],
      objective: dweller ? `Find ${b.label}, where the ${dweller.name} keeps.` : `Find ${b.label}.`,
      beat: dweller ? dweller.note || `The ${dweller.name} is here.` : `You reach ${b.label}.`,
    });
  }
  const end = steps[steps.length - 1] as QuestStep;
  return {
    npcs, items: [],
    quest: {
      id: 'the_lay_of_the_land', title: outline.quest.title || 'The lay of the land',
      hook: outline.quest.premise || `Nobody has walked ${outline.title} in a long time.`, giver, steps,
      endings: [{ stepId: end.id, label: 'You know this ground now.', tone: 'neutral' }],
    },
    rules: [],
  };
}

export function mockStory(theme: ThemeId, outline: Outline): StoryResult {
  // The fixture cast needs a town to live in; a few people on open land get a story of their own.
  if (outline.npcs.length < 3 || outline.buildings.length < 3) return plainStory(outline);
  const fx = FIXTURES[theme];
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
