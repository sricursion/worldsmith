import { describe, expect, it } from 'vitest';
import { coerceSpec, explainInvalid, lookSpec } from '../../app/src/world/coerce';
import { FIXTURES } from '../../app/src/world/fixtures';
import { normalizeSpec, validateSpec } from '../../app/src/world/schema';
import { repairQuest, verifyQuest } from '../../app/src/world/verify';

type Rec = Record<string, unknown>;

const fresh = (): Rec => JSON.parse(JSON.stringify(FIXTURES.western)) as Rec;

/** Walks a dotted path ("npcs.0.mood") and sets or deletes the last key. */
function edit(root: Rec, path: string, value: unknown, del = false): void {
  const keys = path.split('.');
  let cur: unknown = root;
  for (const k of keys.slice(0, -1)) cur = (cur as Rec)[k];
  const last = keys[keys.length - 1] as string;
  if (del) delete (cur as Rec)[last];
  else (cur as Rec)[last] = value;
}
const push = (root: Rec, path: string, ...v: unknown[]): void => {
  let cur: unknown = root;
  for (const k of path.split('.')) cur = (cur as Rec)[k];
  (cur as unknown[]).push(...v);
};
const get = (root: Rec, path: string): unknown => path.split('.').reduce<unknown>((c, k) => (c as Rec)[k], root);

const breakers: [string, (s: Rec) => void][] = [
  ['numeric string seed and time', (s) => {
    edit(s, 'seed', '42');
    edit(s, 'time', { startHour: '9', minutesPerRealSecond: '2.5' });
  }],
  ['missing version', (s) => edit(s, 'version', 0, true)],
  ['upper-case mood and stance', (s) => {
    edit(s, 'npcs.0.mood', 'TENSE');
    edit(s, 'npcs.0.relationships.0.stance', 'Friend');
  }],
  ['null optional fields', (s) => {
    edit(s, 'buildings.0.position', null);
    edit(s, 'buildings.0.blueprint', null);
    edit(s, 'quest.steps.0.item', null);
    edit(s, 'style', null);
  }],
  ['non-object relationships', (s) => push(s, 'npcs.0.relationships', 'bartender_nell', 7, null)],
  ['non-object schedule entries', (s) => push(s, 'npcs.1.schedule', 'noon at the bar', null, 12)],
  ['missing arrays', (s) => {
    for (const p of ['npcs.0.knowledge', 'npcs.0.secrets', 'npcs.0.relationships', 'rules', 'lexicon', 'items', 'quest.steps.0.requires']) edit(s, p, 0, true);
  }],
  ['numeric strings in npc numbers', (s) => {
    edit(s, 'npcs.0.voice', { pitch: '1.1', rate: '0.9' });
    edit(s, 'npcs.0.temperament.tau', '0.8');
    edit(s, 'npcs.0.appearance.palette', '2');
    edit(s, 'npcs.0.schedule.0.hour', '6');
  }],
  ['wrong-case enums everywhere', (s) => {
    edit(s, 'theme', 'Western');
    edit(s, 'palette.sky', 'Dusk');
    edit(s, 'buildings.0.role', 'General Store');
    edit(s, 'buildings.0.size', 'Large');
    edit(s, 'quest.steps.0.kind', 'TALK');
    edit(s, 'quest.endings.0.tone', 'Good');
    edit(s, 'npcs.0.schedule.0.activity', 'Work');
  }],
  ['extra unknown keys, string fog, missing endings', (s) => {
    edit(s, 'extra', { anything: 1 });
    edit(s, 'npcs.0.mysteryField', true);
    edit(s, 'palette.fog', '0.3');
    edit(s, 'quest.endings', 0, true);
  }],
];

describe('coerceSpec', () => {
  it('leaves a valid spec valid', () => {
    expect(validateSpec(coerceSpec(fresh())).ok).toBe(true);
  });

  it('passes non-objects through', () => {
    expect(coerceSpec(5)).toBe(5);
    expect(coerceSpec(null)).toBe(null);
  });

  breakers.forEach(([name, mutate], i) => {
    it(`recovers case ${i + 1}: ${name}`, () => {
      const s = fresh();
      mutate(s);
      expect(validateSpec(s).ok).toBe(false); // genuinely broken before the pre-pass
      const fixed = coerceSpec(s);
      const r = validateSpec(fixed);
      expect(r.ok, r.ok ? '' : r.error).toBe(true);
    });
  });

  it('keeps text fields that merely look numeric', () => {
    const s = fresh();
    edit(s, 'title', '1899');
    edit(s, 'npcs.0.name', '42');
    const fixed = coerceSpec(s) as Rec;
    expect(get(fixed, 'title')).toBe('1899');
    expect(get(fixed, 'npcs.0.name')).toBe('42');
  });
});

describe('explainInvalid', () => {
  it('lists at most three problems in plain words', () => {
    const s = fresh();
    edit(s, 'theme', 'steampunk');
    edit(s, 'seed', 'x');
    edit(s, 'era', 5);
    edit(s, 'title', 1);
    const msg = explainInvalid(s);
    expect(msg.split('; ').length).toBe(4); // three problems plus "and N more"
    expect(msg).toMatch(/and \d+ more$/);
  });
  it('says so for a valid spec', () => {
    expect(explainInvalid(fresh())).toBe('the spec is valid');
  });
});

describe('lookSpec', () => {
  const outline = {
    title: 'Needle Spires',
    tagline: 'Glass towers over cloud.',
    theme: 'scifi',
    era: 'year 2400',
    buildings: [
      { id: 'spire_one', role: 'Office', label: 'First Spire', size: 'large', keyBuilding: true },
      { id: 'spire_two', role: 'lab', label: 'Second Spire', size: 'medium' },
      { id: 'weird', role: 'mushroom hall', label: 'Hall', size: 'tiny' },
    ],
    npcs: [
      { id: 'ada', name: 'Ada Vey', role: 'engineer', home: 'spire_two', work: 'spire_one' },
      { id: 'bo', name: 'Bo', role: 'courier', home: 'nowhere', work: 'street' },
    ],
  };
  const look = {
    style: { name: 'glass and steel', wall: '#cde', roof: 'not a colour', glow: '#8ff' },
    site: { pattern: 'grid', wild: '0.1', paths: 'none', spacing: 20 },
    palette: { sky: 'dusk', fog: 0.4 },
  };

  it('builds a valid, normalisable world', () => {
    const w = lookSpec(outline, look, 'a city of needle-thin glass towers', 9);
    expect(w).not.toBeNull();
    if (!w) return;
    expect(validateSpec(w).ok).toBe(true);
    expect(validateSpec(normalizeSpec(w)).ok).toBe(true);
    expect(w.quest.steps.map((x) => x.kind)).toEqual(['talk', 'visit']);
    expect(w.quest.steps[0]?.target).toBe('ada');
    expect(w.quest.steps[1]?.target).toBe('spire_one');
    expect(verifyQuest(repairQuest(w)).winnable).toBe(true);
    expect(w.quest.endings).toHaveLength(1);
    expect(w.npcs).toHaveLength(2);
    expect(w.npcs[0]?.schedule).toHaveLength(3);
    expect(w.npcs[0]?.home).toBe('spire_two');
    expect(w.npcs[1]?.appearance.palette).toBe(1);
    expect(w.buildings[2]?.role).toBe('house');
    expect(w.site).toEqual({ pattern: 'grid', wild: 0.1, paths: 'none', spacing: 14 });
    expect(w.style?.wall).toBe('#ccddee');
    expect(w.style?.roof).toMatch(/^#/);
    expect(w.palette.sky).toBe('dusk');
    expect(w.prompt).toBe('a city of needle-thin glass towers');
  });

  it('is deterministic', () => {
    expect(lookSpec(outline, look, 'p', 3)).toEqual(lookSpec(outline, look, 'p', 3));
  });

  it('drops malformed blueprints instead of failing', () => {
    const w = lookSpec(outline, { ...look, blueprints: [{ id: 'x', parts: 'nope' }] }, 'p', 1);
    expect(w).not.toBeNull();
    expect(w?.blueprints).toBeUndefined();
  });

  it('still yields a playable world from empty events: no structures, and the spirit of the place to talk to', () => {
    const w = lookSpec(undefined, undefined, 'anything', 1);
    expect(w).not.toBeNull();
    if (!w) return;
    expect(validateSpec(w).ok).toBe(true);
    expect(w.buildings).toHaveLength(0);
    expect(w.npcs.map((n) => n.id)).toEqual(['spirit_of_the_place']);
    expect(verifyQuest(repairQuest(w)).winnable).toBe(true);
  });

  it('carries the land, sky, creatures, folk, mood and hour of the outline into the preview', () => {
    const wild = {
      title: 'Erg', theme: 'western',
      terrain: { relief: 'dunes', ruggedness: 0.6, water: 'none', waterAmount: 0, horizon: 'dune sea', settled: 0.05 },
      site: { pattern: 'wild', wild: 0.1, paths: 'none', spacing: 14 },
      time: { startHour: 17 }, palette: { sky: 'dusk', fog: 0.3 },
      mood: { weather: 'dust', intensity: 0.3, grade: 'golden', haze: 0.6, ambience: ['wind'], music: '' },
      skyFeatures: [{ kind: 'moon', size: 0.1, color: '#eeeeee' }],
      folk: { name: 'drovers', height: 1.75, bulk: 0.4, head: 1, features: ['hood'], skin: ['#8d5f43'], cloth: ['#2f4a6a'], trim: ['#2a2420'] },
      creatures: [
        { id: 'camels', name: 'camels', family: 'quadruped', dials: {}, size: 2.2, count: 4, behaviour: 'graze', haunt: 'camp', body: '#b8956a', accent: '#8a6a48', glow: '#000000', note: 'Chewing.' },
        { id: 'fish', name: 'fish', family: 'swimmer', dials: {}, size: 0.3, count: 9, behaviour: 'flock', haunt: 'water', body: '#888888', accent: '#666666', glow: '#000000', note: '' },
      ],
      buildings: [{ id: 'camp', role: 'house', label: 'Camp', size: 'medium', keyBuilding: true }],
      npcs: [],
    };
    const w = lookSpec(wild, { style: { name: 'sand', wall: '#b9a98a', ground: '#c2a97c' } }, 'the Sahara', 3);
    expect(w).not.toBeNull();
    if (!w) return;
    expect(w.terrain).toMatchObject({ relief: 'dunes', settled: 0.05 });
    expect(w.site?.pattern).toBe('wild');
    expect(w.skyFeatures).toHaveLength(1);
    expect(w.folk?.name).toBe('drovers');
    expect(w.creatures?.map((x) => x.haunt)).toEqual(['camp', 'wild']);
    expect(w.mood?.weather).toBe('dust');
    expect(w.time.startHour).toBe(17);
    expect(w.palette.sky).toBe('dusk');
    expect(w.buildings).toHaveLength(1);
    expect(verifyQuest(repairQuest(w)).winnable).toBe(true);
  });
});
