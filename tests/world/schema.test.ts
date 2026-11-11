import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../../app/src/world/fixtures';
import {
  GRADE_KINDS, NPC_ACTION_IDS, SITE_PATTERNS, SURFACE_KINDS, WEATHER_KINDS, coerceCreatures, coerceFolk, coerceSkyFeatures,
  coerceTerrain, normalizeSpec, slugify, validateSpec, worldSpecJsonSchema,
} from '../../app/src/world/schema';
import { repairQuest, verifyQuest } from '../../app/src/world/verify';
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
        // Skeleton dials are free-form name -> number|string; the only open object in the schema.
        if (path.endsWith('.dials')) expect(o.additionalProperties).toEqual({ anyOf: [{ type: 'number' }, { type: 'string' }] });
        else expect(o.additionalProperties, `${path} additionalProperties`).toBe(false);
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

describe('worldSpecJsonSchema architecture fields', () => {
  const schema = worldSpecJsonSchema() as {
    required: string[];
    properties: Record<string, { items: { required: string[]; properties: Record<string, unknown> } }>;
  };

  it('requires style, site, blueprints, props, landmarks and building.blueprint', () => {
    for (const k of ['style', 'site', 'blueprints', 'props', 'landmarks']) {
      expect(schema.required).toContain(k);
      expect(schema.properties[k]).toBeDefined();
    }
    expect(schema.properties.buildings?.items.required).toContain('blueprint');
    expect(schema.properties.buildings?.items.required).not.toContain('position');    expect(schema.properties.blueprints?.items.required).toEqual(expect.arrayContaining(['family', 'dials']));
    expect(schema.properties.props?.items.required).toEqual(expect.arrayContaining(['family', 'dials']));
  });

  it('uses no oneOf, no range keywords, and closes every object', () => {
    const text = JSON.stringify(schema);
    expect(text).not.toContain('"oneOf"');
    expect(text).not.toContain('"$ref"');
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems']) {
      // `pattern` is also the name of a SiteSpec field (an object schema), never a string keyword.
      expect(text).not.toContain(k === 'pattern' ? '"pattern":"' : `"${k}"`);
    }
    const bad: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (typeof node !== 'object' || node === null) return;
      const o = node as Record<string, unknown>;
      if (o.type === 'object' && o.additionalProperties !== false && !path.endsWith('.dials')) bad.push(path);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(schema, '$');
    expect(bad).toEqual([]);
    const part = (schema.properties.blueprints as unknown as { items: { properties: { parts: { items: { required: string[] } } } } }).items.properties.parts.items;
    expect(part.required.sort()).toEqual(['d', 'gap', 'h', 'repeat', 'rot', 'shape', 'tone', 'w', 'x', 'y', 'z']);
  });
});

describe('specs without architecture', () => {
  const legacy = (): WorldSpec => {
    const s = clone(FIXTURES.western);
    delete s.style;
    delete s.blueprints;
    delete s.props;
    delete s.landmarks;
    for (const b of s.buildings) delete b.blueprint;
    return s;
  };

  it('still validate and normalize without gaining fields', () => {
    const s = legacy();
    expect(validateSpec(JSON.parse(JSON.stringify(s))).ok).toBe(true);
    const n = normalizeSpec(s);
    expect(n.style).toBeUndefined();
    expect(n.blueprints).toBeUndefined();
    expect(n.props).toBeUndefined();
    expect(n.landmarks).toBeUndefined();
    expect(n.buildings.every((b) => b.blueprint === undefined)).toBe(true);
  });

  it('drops building blueprint ids when the spec has no blueprints', () => {
    const s = legacy();
    s.buildings[0]!.blueprint = 'ghost';
    expect(normalizeSpec(s).buildings[0]?.blueprint).toBeUndefined();
  });
});

describe('normalizeSpec architecture', () => {
  const messy = (): WorldSpec => {
    const s = clone(FIXTURES.modern);
    const bps = s.blueprints!;
    bps[0]!.id = 'Cafe Corner!';
    bps[1]!.id = 'Cafe Corner';
    return s;
  };

  it('slugifies and dedupes blueprint ids, and follows renamed ids from buildings', () => {
    const s = messy();
    s.buildings.find((b) => b.id === 'cafe')!.blueprint = 'Cafe Corner!';
    const n = normalizeSpec(s);
    const ids = n.blueprints!.map((b) => b.id);
    expect(ids.slice(0, 2)).toEqual(['cafe_corner', 'cafe_corner_2']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(n.buildings.find((b) => b.id === 'cafe')?.blueprint).toBe('cafe_corner');
    expect(validateSpec(n).ok).toBe(true);
  });

  it('clamps part, prop, blueprint and style ranges and coerces unknown shape and tone', () => {
    const s = clone(FIXTURES.scifi);
    const part = s.blueprints![0]!.parts[0]!;
    Object.assign(part, { x: 4, z: -4, y: -2, w: 9, d: 0, h: 99, rot: 450, repeat: 40, gap: 9 });
    (part as { shape: string }).shape = 'torus';
    (part as { tone: string }).tone = 'purple';
    s.blueprints![0]!.doorX = 3;
    s.props![0]!.size = 40;
    s.props![0]!.weight = 0;
    s.style!.variety = 7;
    const n = normalizeSpec(s);
    const p = n.blueprints![0]!.parts[0]!;
    expect(p).toMatchObject({ shape: 'box', tone: 'wall', x: 0.5, z: -0.5, y: 0, w: 1.4, d: 0.02, h: 30, rot: 90, repeat: 12, gap: 1.4 });
    expect(n.blueprints![0]!.doorX).toBe(0.4);
    expect(n.props![0]!.size).toBe(16);
    expect(n.props![0]!.weight).toBe(1);
    expect(n.style!.variety).toBe(1);
    expect(validateSpec(n).ok).toBe(true);
  });

  it('caps counts: 8 blueprints, 28 parts, 6 props with 28 parts, 2 landmarks', () => {
    const s = clone(FIXTURES.medieval);
    const first = s.blueprints![0]!;
    while (s.blueprints!.length < 12) s.blueprints!.push({ ...structuredClone(first), id: `extra_${s.blueprints!.length}` });
    while (first.parts.length < 40) first.parts.push({ ...first.parts[0]! });
    const prop = s.props![0]!;
    while (s.props!.length < 9) s.props!.push({ ...structuredClone(prop), kind: `prop ${s.props!.length}` });
    while (prop.parts.length < 40) prop.parts.push({ ...prop.parts[0]! });
    s.landmarks!.push({ ...s.landmarks![0]!, id: 'second' }, { ...s.landmarks![0]!, id: 'third' });
    const n = normalizeSpec(s);
    expect(n.blueprints).toHaveLength(8);
    expect(n.blueprints![0]!.parts).toHaveLength(28);
    expect(n.props).toHaveLength(6);
    expect(n.props![0]!.parts).toHaveLength(28);
    expect(new Set(n.props!.map((p) => p.kind)).size).toBe(6);
    expect(n.landmarks).toHaveLength(2);
  });

  it('replaces bad hex colours with neutrals and keeps good ones, expanding short hex', () => {
    const s = clone(FIXTURES.western);
    s.style!.wall = 'red';
    s.style!.roof = '#ABC';
    s.style!.glow = '#12345';
    const st = normalizeSpec(s).style!;
    expect(st.wall).toMatch(/^#[0-9a-f]{6}$/);
    expect(st.wall).not.toBe('red');
    expect(st.roof).toBe('#aabbcc');
    expect(st.glow).toMatch(/^#[0-9a-f]{6}$/);
    expect(st.trim).toBe(FIXTURES.western.style!.trim);
  });

  it('drops dangling building blueprint ids and assigns by role word, else round-robin', () => {
    const s = clone(FIXTURES.modern);
    for (const b of s.buildings) delete b.blueprint;
    s.buildings.find((b) => b.id === 'cafe')!.blueprint = 'nowhere';
    const n = normalizeSpec(s);
    const by = (id: string): string | undefined => n.buildings.find((b) => b.id === id)?.blueprint;
    expect(by('cafe')).toBe('cafe_corner');
    expect(by('garage')).toBe('roller_garage');
    expect(by('school')).toBe('school_hall');
    expect(by('house')).toBe('gable_house');
    const ids = new Set(n.blueprints!.map((b) => b.id));
    for (const b of n.buildings) expect(ids.has(b.blueprint ?? '')).toBe(true);
    // Deterministic.
    expect(normalizeSpec(s)).toEqual(n);

    const round = clone(FIXTURES.modern);
    round.blueprints = round.blueprints!.map((b, i) => ({ ...b, id: `style_${i}`, summary: 'a building' }));
    for (const b of round.buildings) delete b.blueprint;
    const r = normalizeSpec(round);
    expect(r.buildings.slice(0, 3).map((b) => b.blueprint)).toEqual(['style_0', 'style_1', 'style_2']);
  });

  it('repairs a floating blueprint part during normalisation', () => {
    const s = clone(FIXTURES.western);
    s.blueprints![0]!.parts.push({ ...s.blueprints![0]!.parts[0]!, y: 20, x: 0.2, z: 0.2, w: 0.1, d: 0.1, h: 1 });
    const part = normalizeSpec(s).blueprints![0]!.parts.at(-1)!;
    expect(part.y).toBeLessThan(20);
  });

  it('repairs landmark places and clamps height', () => {
    const s = clone(FIXTURES.western);
    s.landmarks = [
      { id: 'a', prompt: 'x', place: 'The Dusty Spur', height: 0.1 },
      { id: 'b', prompt: 'y', place: 'nowhere', height: 99 },
    ];
    s.buildings[0]!.id = 'The Dusty Spur';
    const n = normalizeSpec(s);
    expect(n.landmarks![0]).toMatchObject({ place: 'the_dusty_spur', height: 2 });
    expect(n.landmarks![1]).toMatchObject({ place: 'plaza', height: 14 });
  });
});

describe('surfaces and mood', () => {
  const dressed = (): WorldSpec => {
    const s = clone(FIXTURES.western);
    s.style!.surfaces = { wall: 'corrugated', wall2: 'rusted', roof: 'corrugated', trim: 'metal_panel', ground: 'concrete', road: 'asphalt', wear: 0.7, wet: 0.8 };
    s.mood = { weather: 'rain', intensity: 0.8, grade: 'teal_orange', haze: 0.6, ambience: ['rain', 'harbor'], music: 'slow noir piano' };
    return s;
  };

  it('validateSpec and normalizeSpec keep them as written', () => {
    const s = dressed();
    const v = validateSpec(JSON.parse(JSON.stringify(s)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.mood).toEqual(s.mood);
    expect(v.value.style?.surfaces).toEqual(s.style?.surfaces);
    const n = normalizeSpec(v.value);
    expect(n.mood).toEqual(s.mood);
    expect(n.style?.surfaces).toEqual(s.style?.surfaces);
  });

  it('coerces unknown kinds per field instead of rejecting the world', () => {
    const raw = JSON.parse(JSON.stringify(dressed())) as { style: { surfaces: Record<string, unknown> }; mood: Record<string, unknown> };
    raw.style.surfaces = { wall: 'Glass Curtain', wall2: 'vibranium', roof: 7, ground: 'lava', wear: 4, wet: '0.5' };
    raw.mood = { weather: 'hail', intensity: -3, grade: 'Teal-Orange', haze: 9, ambience: 'rain', music: 12 };
    const v = validateSpec(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.style?.surfaces).toEqual({ wall: 'glass_curtain', wall2: 'timber', roof: 'shingle', trim: 'timber', ground: 'dirt', road: 'gravel', wear: 1, wet: 0.5 });
    expect(v.value.mood).toEqual({ weather: 'clear', intensity: 0, grade: 'teal_orange', haze: 1, ambience: [], music: '' });
  });

  it('drops surfaces or mood that are not objects, leaving the engine to infer them', () => {
    const raw = JSON.parse(JSON.stringify(dressed())) as { style: Record<string, unknown>; mood: unknown };
    raw.style.surfaces = 'wood';
    raw.mood = 'rainy';
    const v = validateSpec(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.mood).toBeUndefined();
    expect(v.value.style?.surfaces).toBeUndefined();
    expect(v.value.style?.wall).toBe(FIXTURES.western.style?.wall);
  });

  it('clamps numbers, caps ambience at six short lowercase words and music at 40 characters', () => {
    const s = dressed();
    s.style!.surfaces!.wear = 3;
    s.style!.surfaces!.wet = -1;
    s.mood = {
      weather: 'storm', intensity: 7, grade: 'cold_steel', haze: -2,
      ambience: ['Distant Crowd', ' RAIN ', 'rain', '', 'wind', 'a-very-long-ambience-word-that-keeps-going', 'gulls', 'thunder', 'machinery', 'water'],
      music: '   a   slow and very lonely harmonica somewhere far beyond the ridge   ',
    };
    const n = normalizeSpec(s);
    expect(n.style?.surfaces).toMatchObject({ wear: 1, wet: 0 });
    expect(n.mood?.intensity).toBe(1);
    expect(n.mood?.haze).toBe(0);
    expect(n.mood?.ambience).toEqual(['distant_crowd', 'rain', 'wind', 'a_very_long_ambience_wor', 'gulls', 'thunder']);
    expect(n.mood?.music.length).toBeLessThanOrEqual(40);
    expect(n.mood?.music.startsWith('a slow and very lonely harmonica')).toBe(true);
    expect(validateSpec(n).ok).toBe(true);
    expect(normalizeSpec(n)).toEqual(n);
  });

  it('does not invent them on a spec that has none', () => {
    const n = normalizeSpec(FIXTURES.medieval);
    expect(n.mood).toBeUndefined();
    expect(n.style?.surfaces).toBeUndefined();
  });

  it('are required of the model, with every kind listed', () => {
    const schema = worldSpecJsonSchema() as {
      required: string[];
      properties: {
        mood: { required: string[]; properties: { weather: { enum: string[] }; grade: { enum: string[] } } };
        style: { required: string[]; properties: { surfaces: { required: string[]; properties: { wall: { enum: string[] } } } } };
      };
    };
    expect(schema.required).toContain('mood');
    expect(schema.properties.style.required).toContain('surfaces');
    expect([...schema.properties.mood.required].sort()).toEqual(['ambience', 'grade', 'haze', 'intensity', 'music', 'weather']);
    expect([...schema.properties.style.properties.surfaces.required].sort()).toEqual(['ground', 'road', 'roof', 'trim', 'wall', 'wall2', 'wear', 'wet']);
    expect(schema.properties.mood.properties.weather.enum).toEqual(WEATHER_KINDS);
    expect(schema.properties.mood.properties.grade.enum).toEqual(GRADE_KINDS);
    expect(schema.properties.style.properties.surfaces.properties.wall.enum).toEqual(SURFACE_KINDS);
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

  it('trims oversized lists and leaves small places small', () => {
    const big = clone(FIXTURES.medieval);
    for (let i = 0; i < 12; i++) big.buildings.push({ id: `h${i}`, role: 'house', label: `H${i}`, size: 'small' });
    for (let i = 0; i < 8; i++) big.npcs.push({ ...structuredClone(big.npcs[0]!), id: `extra${i}` });
    const n = normalizeSpec(big);
    expect(n.buildings).toHaveLength(14);
    expect(n.npcs).toHaveLength(10);

    const tiny = clone(FIXTURES.medieval);
    tiny.buildings = tiny.buildings.slice(0, 3);
    expect(normalizeSpec(tiny).buildings).toHaveLength(3);
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

describe('land, sky, creatures and folk', () => {
  const wild = (): WorldSpec => ({
    ...clone(FIXTURES.western),
    terrain: { relief: 'dunes', ruggedness: 0.6, water: 'none', waterAmount: 0, horizon: 'dune sea', settled: 0.05 },
    skyFeatures: [{ kind: 'moon', size: 0.1, color: '#eeeeee' }],
    folk: { name: 'drovers', height: 1.75, bulk: 0.4, head: 1, features: ['hood', 'cloak'], skin: ['#8d5f43'], cloth: ['#2f4a6a'], trim: ['#2a2420'] },
    creatures: [{
      id: 'camels', name: 'camels', family: 'quadruped', dials: { hump: 0.8 }, size: 2.2, count: 4, behaviour: 'graze',
      haunt: 'wild', body: '#b8956a', accent: '#8a6a48', glow: '#000000', note: 'Chewing.',
    }],
  });

  it('validates and survives normalisation unchanged, twice', () => {
    const s = wild();
    expect(validateSpec(s).ok).toBe(true);
    const n = normalizeSpec(s);
    expect(n.terrain).toEqual(s.terrain);
    expect(n.skyFeatures).toEqual(s.skyFeatures);
    expect(n.folk).toEqual(s.folk);
    expect(n.creatures).toEqual(s.creatures);
    expect(normalizeSpec(n)).toEqual(n);
  });

  it('old specs without the new fields still validate and gain none', () => {
    const n = normalizeSpec(clone(FIXTURES.medieval));
    expect(n.terrain).toBeUndefined();
    expect(n.creatures).toBeUndefined();
    expect(n.folk).toBeUndefined();
    expect(n.skyFeatures).toBeUndefined();
  });

  it('accepts every site pattern, wilderness included', () => {
    for (const pattern of SITE_PATTERNS) {
      const s = clone(FIXTURES.western);
      s.site = { pattern, wild: 0.5, paths: 'track', spacing: 12 };
      const v = validateSpec(s);
      expect(v.ok).toBe(true);
      expect(normalizeSpec(s).site?.pattern).toBe(pattern);
    }
    expect(SITE_PATTERNS).toEqual(expect.arrayContaining(['wild', 'path', 'shoreline', 'cliffside']));
  });

  it('a slip in a new field never rejects the world', () => {
    const raw = JSON.parse(JSON.stringify(wild())) as Record<string, unknown>;
    raw.terrain = { relief: 'Mountains', ruggedness: 7, water: 'the sea', waterAmount: 'lots', settled: -1 };
    raw.skyFeatures = [{ kind: 'two suns', size: 9, color: 'yellow' }, { kind: 'blimp' }, 'eclipse', ['aurora', 0.5, '#0f0'], { kind: 'moon' }];
    raw.creatures = [
      { name: 'Ash Dragon', family: 'dragon', size: 900, count: 0, behaviour: 'sleeping', haunt: 'Nowhere Special', body: 'grey' },
      { id: 'x' }, 7, null,
      ...Array.from({ length: 9 }, (_, i) => ({ id: 'gull', name: 'gull', family: 'bird', size: 0.01, count: 99.6 + i })),
    ];
    raw.folk = { name: '', height: 40, bulk: 'x', head: 9, features: ['hood', 'hood', 'laser'], skin: 'red', cloth: [] };
    const v = validateSpec(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const n = normalizeSpec(v.value);
    expect(n.terrain).toEqual({ relief: 'craggy', ruggedness: 1, water: 'shore', waterAmount: 0.25, horizon: '', settled: 0 });
    expect(n.skyFeatures).toEqual([
      { kind: 'second_sun', size: 1, color: '#e6e2d6' }, { kind: 'eclipse', size: 0.3, color: '#e6e2d6' }, { kind: 'aurora', size: 0.5, color: '#00ff00' },
    ]);
    expect(n.creatures).toHaveLength(6);
    expect(n.creatures![0]).toMatchObject({ id: 'ash_dragon', family: 'winged', size: 40, count: 1, behaviour: 'sleep', haunt: 'wild', body: '#6b5d4f' });
    expect(n.creatures![1]).toMatchObject({ id: 'x', name: 'x', family: 'quadruped' });
    expect(n.creatures![2]).toMatchObject({ id: 'gull', family: 'bird', size: 0.2, count: 24 });
    expect(new Set(n.creatures!.map((c) => c.id)).size).toBe(6);
    expect(n.folk).toMatchObject({ name: 'people', height: 3, bulk: 0.4, head: 2, features: ['hood'] });
    expect(n.folk!.skin.length).toBeGreaterThan(0);
    expect(n.folk!.cloth.length).toBeGreaterThan(0);
    for (const bad of ['nope', 4, null]) {
      const junk = { ...JSON.parse(JSON.stringify(wild())) as Record<string, unknown>, terrain: bad, folk: bad, creatures: bad, skyFeatures: bad };
      const r = validateSpec(junk);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.terrain).toBeUndefined();
    }
  });

  it('repairs a haunt to a building id, a haunt word or the wild, and water only where there is water', () => {
    const s = wild();
    const first = s.buildings[0]!.id;
    const mk = (id: string, haunt: string) => ({ ...s.creatures![0]!, id, haunt });
    s.creatures = [mk('a', first), mk('b', 'sky'), mk('c', 'water'), mk('d', 'the old mill'), mk('e', 'plaza')];
    expect(normalizeSpec(s).creatures!.map((c) => c.haunt)).toEqual([first, 'sky', 'wild', 'wild', 'plaza']);
    s.terrain = { ...s.terrain!, water: 'river', waterAmount: 0.2 };
    expect(normalizeSpec(s).creatures![2]!.haunt).toBe('water');
  });

  it('coercers return full values from nothing', () => {
    expect(coerceTerrain(undefined).relief).toBe('flat');
    expect(coerceTerrain({ water: 'none', waterAmount: 0.9 }).waterAmount).toBe(0);
    expect(coerceTerrain({ water: 'lake', waterAmount: 0 }).waterAmount).toBe(0.05);
    expect(coerceSkyFeatures('x')).toEqual([]);
    expect(coerceCreatures(undefined)).toEqual([]);
    expect(coerceFolk(null).height).toBe(1.7);
  });

  it('the model schema lists the new fields as required', () => {
    const schema = worldSpecJsonSchema() as { required: string[]; properties: Record<string, { properties?: Record<string, unknown>; items?: { properties?: Record<string, unknown> } }> };
    for (const k of ['terrain', 'skyFeatures', 'creatures', 'folk']) expect(schema.required).toContain(k);
    expect(Object.keys(schema.properties.terrain!.properties!)).toEqual(['relief', 'ruggedness', 'water', 'waterAmount', 'horizon', 'settled']);
    expect(Object.keys(schema.properties.creatures!.items!.properties!)).toContain('haunt');
    expect(Object.keys(schema.properties.folk!.properties!)).toContain('features');
  });
});

describe('places with few people or none', () => {
  it('keeps zero buildings and zero people when the quest needs nobody', () => {
    const s = clone(FIXTURES.western);
    s.buildings = [];
    s.npcs = [];
    s.items = [{ id: 'bell', name: 'Bell', description: 'Bronze.', holder: 'player' }];
    s.rules = [];
    s.quest = {
      id: 'q', title: 'Alone', hook: 'Nobody is here.', giver: '',
      steps: [{ id: 'take', kind: 'fetch', target: 'bell', item: 'bell', requires: [], objective: 'Take the bell.', beat: 'It rings.' }],
      endings: [{ stepId: 'take', label: 'Done', tone: 'neutral' }],
    };
    expect(validateSpec(s).ok).toBe(true);
    const n = normalizeSpec(s);
    expect(n.buildings).toHaveLength(0);
    expect(n.npcs).toHaveLength(0);
    expect(n.quest.giver).toBe('');
    // repairQuest and verifyQuest run safely on it; nothing is unreachable.
    const r = repairQuest(n);
    expect(r.quest.steps).toHaveLength(1);
    expect(verifyQuest(r).unreachable).toEqual([]);
  });

  it('gives the place a spirit only when the quest needs someone to talk to', () => {
    const s = clone(FIXTURES.western);
    s.npcs = [];
    s.rules = [];
    s.items = [];
    const hut = s.buildings[0]!.id;
    s.quest = {
      id: 'q', title: 'Alone', hook: 'Nobody is here.', giver: 'spirit_of_the_place',
      steps: [
        { id: 'hear', kind: 'talk', target: 'spirit_of_the_place', requires: [], objective: 'Listen.', beat: 'Wind.' },
        { id: 'go', kind: 'visit', target: hut, requires: ['hear'], objective: 'Go.', beat: 'There.' },
      ],
      endings: [{ stepId: 'go', label: 'Done', tone: 'neutral' }],
    };
    const n = normalizeSpec(s);
    expect(n.npcs).toHaveLength(1);
    expect(n.npcs[0]).toMatchObject({ id: 'spirit_of_the_place', role: 'spirit of the place' });
    expect(n.quest.giver).toBe('spirit_of_the_place');
    expect(validateSpec(n).ok).toBe(true);
    expect(verifyQuest(repairQuest(n)).winnable).toBe(true);
    expect(normalizeSpec(n)).toEqual(n);
  });

  it('two hermits are enough', () => {
    const s = clone(FIXTURES.medieval);
    s.npcs = s.npcs.slice(0, 2);
    s.buildings = s.buildings.slice(0, 2);
    const n = repairQuest(normalizeSpec(s));
    expect(n.npcs).toHaveLength(2);
    expect(n.buildings).toHaveLength(2);
    expect(validateSpec(n).ok).toBe(true);
  });

  it('keeps pole props to a real height unless the place is industrial', () => {
    const s = clone(FIXTURES.western);
    s.props = [
      { kind: 'lamp', family: 'pole', dials: { head: 'lamp', height: 3, arms: 1 }, size: 6, weight: 2, parts: [] },
      { kind: 'giant_tree', family: 'tree', dials: { trunk: 2, crown: 'umbrella' }, size: 13, weight: 4, parts: [] },
    ];
    const n = normalizeSpec(s);
    expect(n.props![0]!.size).toBe(3);
    expect(n.props![1]!.size).toBe(13);
    s.style = { ...s.style!, surfaces: { wall: 'corrugated', wall2: 'rusted', roof: 'corrugated', trim: 'metal_panel', ground: 'concrete', road: 'asphalt', wear: 0.7, wet: 0.5 } };
    expect(normalizeSpec(s).props![0]!.size).toBe(6);
  });
});
