import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../../app/src/world/fixtures';
import { NPC_ACTION_IDS, normalizeSpec, slugify, validateSpec, worldSpecJsonSchema } from '../../app/src/world/schema';
import type { WorldSpec } from '../../app/src/world/spec';

const clone = (s: WorldSpec): WorldSpec => structuredClone(s);

describe('validateSpec', () => {
  it('reports a readable path', () => {
    const bad = JSON.parse(JSON.stringify(FIXTURES.western)) as Record<string, unknown>;
    const npcs = bad.npcs as { schedule: { activity: string }[] }[];
    (npcs[2] as { schedule: { activity: string }[] }).schedule[0]!.activity = 'dance';
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^npcs\[2\]\.schedule\[0\]\.activity:/);
  });
  it('rejects non-objects', () => {
    expect(validateSpec(42).ok).toBe(false);
    expect(validateSpec(null).ok).toBe(false);
  });
});

describe('worldSpecJsonSchema', () => {
  const schema = worldSpecJsonSchema();
  const FORBIDDEN = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', '$ref', '$defs', 'multipleOf'];

  it('has additionalProperties false on every object, and no forbidden keywords', () => {
    let objects = 0;
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (typeof node !== 'object' || node === null) return;
      const o = node as Record<string, unknown>;
      if (o.type === 'object') {
        objects++;
        expect(o.additionalProperties, `${path} additionalProperties`).toBe(false);
      }
      for (const [k, v] of Object.entries(o)) {
        if (k === 'properties') {
          for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) walk(pv, `${path}.${pk}`);
          continue;
        }
        expect(FORBIDDEN.includes(k), `${path}.${k} is forbidden`).toBe(false);
        walk(v, `${path}.${k}`);
      }
    };
    walk(schema, '$');
    expect(objects).toBeGreaterThan(10);
  });

  it('keeps optional fields optional and spells out bias keys', () => {
    const s = JSON.stringify(schema);
    expect(s).not.toContain('"$ref"');
    const root = schema as { required?: string[]; properties: Record<string, unknown> };
    expect(root.required).toContain('quest');
    const npcs = root.properties.npcs as { items: { properties: { temperament: { properties: { bias: { properties: Record<string, unknown> } } } } } };
    expect(Object.keys(npcs.items.properties.temperament.properties.bias.properties).sort()).toEqual([...NPC_ACTION_IDS].sort());
    const buildings = root.properties.buildings as { items: { required: string[] } };
    expect(buildings.items.required).not.toContain('position');
    expect(buildings.items.required).toContain('id');
  });
});

describe('slugify', () => {
  it('produces slugs', () => {
    expect(slugify('The Dusty Spur!')).toBe('the_dusty_spur');
    expect(slugify('Café #1')).toBe('cafe_1');
    expect(slugify('***', 'x')).toBe('x');
  });
});

describe('normalizeSpec', () => {
  it('resolves a choose step aimed at a building to the NPC who works or lives there', () => {
    const w = structuredClone(FIXTURES.western);
    const keeper = w.npcs.find((n) => n.work === 'church')?.id;
    expect(keeper).toBeDefined();
    w.quest.steps.find((x) => x.id === 'decide')!.target = 'church';
    expect(normalizeSpec(w).quest.steps.find((x) => x.id === 'decide')?.target).toBe(keeper);
    w.quest.steps.find((x) => x.id === 'decide')!.target = 'nowhere';
    expect(normalizeSpec(w).quest.steps.find((x) => x.id === 'decide')?.target).toBe(w.quest.giver);
  });

  it('is idempotent', () => {
    const once = normalizeSpec(FIXTURES.scifi);
    expect(normalizeSpec(once)).toEqual(once);
  });

  it('does not mutate its input', () => {
    const s = clone(FIXTURES.modern);
    s.time.startHour = 40;
    const copy = clone(s);
    normalizeSpec(s);
    expect(s).toEqual(copy);
  });

  it('repairs a deliberately broken spec', () => {
    const s = clone(FIXTURES.western);
    // Out-of-range numbers.
    s.time = { startHour: 31, minutesPerRealSecond: 500 };
    s.palette.fog = 4;
    const sheriff = s.npcs[0]!;
    sheriff.temperament.tau = 9;
    sheriff.temperament.bias = { investigate: 1 };
    sheriff.voice = { pitch: 5, rate: 0.01 };
    // Messy ids, one duplicate.
    s.buildings[0]!.id = 'The Dusty Spur';
    s.buildings[3]!.id = 'bank';
    const banRule = s.rules.find((r) => r.id === 'no_guns_saloon')!;
    if (banRule.effect.type === 'ban') banRule.effect.where = 'The Dusty Spur';
    s.npcs[1]!.work = 'The Dusty Spur';
    // Dangling references.
    s.npcs[1]!.home = 'nowhere';
    s.npcs[1]!.schedule = [{ hour: 18, place: 'nowhere', activity: 'work' }, { hour: 3, place: 'hotel', activity: 'sleep' }];
    s.npcs[1]!.relationships.push({ npcId: 'ghost', stance: 'friend' });
    s.items[0]!.holder = 'ghost';
    s.quest.giver = 'ghost';
    s.quest.steps[1]!.target = 'ghost';
    s.quest.steps[2]!.requires = ['stable_tip', 'phantom'];
    s.quest.steps[4]!.choices![0]!.unlocks = ['end_law', 'phantom'];
    s.quest.steps[0]!.reveals = ['sheriff_cole:0', 'sheriff_cole:9'];
    s.quest.endings.push({ stepId: 'phantom', label: 'x', tone: 'neutral' });
    // Too many items in lists.
    for (let i = 0; i < 40; i++) s.lexicon.push(`term ${i}`);

    const n = normalizeSpec(s);
    const v = validateSpec(n);
    expect(v.ok).toBe(true);

    expect(n.time).toEqual({ startHour: 23, minutesPerRealSecond: 30 });
    expect(n.palette.fog).toBe(1);
    const sh = n.npcs[0]!;
    expect(sh.temperament.tau).toBe(3);
    expect(Object.keys(sh.temperament.bias).sort()).toEqual([...NPC_ACTION_IDS].sort());
    expect(sh.temperament.bias.investigate).toBe(1);
    expect(sh.temperament.bias.flee).toBe(0);
    expect(sh.voice).toEqual({ pitch: 2, rate: 0.5 });

    const ids = n.buildings.map((b) => b.id);
    expect(ids[0]).toBe('the_dusty_spur');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('bank_2');
    // Saloon was renamed; everyone who pointed at it follows.
    expect(n.rules.find((r) => r.id === 'no_guns_saloon')?.effect).toMatchObject({ where: 'the_dusty_spur' });
    expect(n.npcs.find((x) => x.id === 'bartender_nell')?.work).toBe('the_dusty_spur');

    const nell = n.npcs.find((x) => x.id === 'bartender_nell')!;
    expect(ids).toContain(nell.home);
    expect(nell.relationships.some((r) => r.npcId === 'ghost')).toBe(false);
    expect(nell.schedule.length).toBeGreaterThanOrEqual(3);
    expect(nell.schedule.map((e) => e.hour)).toEqual([...nell.schedule.map((e) => e.hour)].sort((a, b) => a - b));
    for (const e of nell.schedule) expect(ids.includes(e.place) || e.place === 'street' || e.place === 'plaza').toBe(true);

    expect(n.items[0]!.holder).toBe(n.quest.giver);
    expect(n.npcs.some((x) => x.id === n.quest.giver)).toBe(true);
    const stepIds = new Set(n.quest.steps.map((x) => x.id));
    expect(n.npcs.some((x) => x.id === n.quest.steps[1]!.target)).toBe(true);
    for (const st of n.quest.steps) for (const r of st.requires) expect(stepIds.has(r)).toBe(true);
    expect(n.quest.steps[4]!.choices![0]!.unlocks).toEqual(['end_law']);
    expect(n.quest.steps[0]!.reveals).toEqual(['sheriff_cole:0']);
    expect(n.quest.endings.every((e) => stepIds.has(e.stepId))).toBe(true);
    expect(n.lexicon.length).toBe(30);
  });

  it('trims oversized lists and pads small towns', () => {
    const big = clone(FIXTURES.medieval);
    for (let i = 0; i < 12; i++) big.buildings.push({ id: `h${i}`, role: 'house', label: `H${i}`, size: 'small' });
    for (let i = 0; i < 8; i++) big.npcs.push({ ...structuredClone(big.npcs[0]!), id: `extra${i}` });
    const n = normalizeSpec(big);
    expect(n.buildings).toHaveLength(14);
    expect(n.npcs).toHaveLength(10);

    const tiny = clone(FIXTURES.medieval);
    tiny.buildings = tiny.buildings.slice(0, 3);
    expect(normalizeSpec(tiny).buildings.length).toBeGreaterThanOrEqual(6);
  });

  it('fills short schedules from role defaults and dedupes npc ids', () => {
    const s = clone(FIXTURES.modern);
    s.npcs[0]!.schedule = [];
    s.npcs[1]!.id = s.npcs[0]!.id;
    const n = normalizeSpec(s);
    expect(n.npcs[0]!.schedule.length).toBeGreaterThanOrEqual(3);
    expect(n.npcs[0]!.schedule.some((e) => e.activity === 'sleep')).toBe(true);
    expect(new Set(n.npcs.map((x) => x.id)).size).toBe(n.npcs.length);
  });
});
