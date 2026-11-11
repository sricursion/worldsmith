import { describe, expect, it } from 'vitest';
import { handleCompile } from '../../worker/src/routes/compile';
import { outlineSystemPrompt, outlineUserMessage } from '../../worker/src/prompts/compile';
import { lookSystemPrompt, lookUserMessage } from '../../worker/src/prompts/compilelook';
import { storySystemPrompt, storyUserMessage } from '../../worker/src/prompts/compilestory';
import {
  closeTruncated, coerceLook, coerceOutline, coercePart, coerceStory, mergeSpec, mute, parseLooseJson, SPIRIT_ID,
} from '../../worker/src/prompts/compilemerge';
import { mockLook, mockOutline, mockStory, plainStory } from '../../worker/src/lib/mockcast';
import { mockLand } from '../../worker/src/lib/mockland';
import { BASE } from '../../worker/src/lib/mockstyle';
import { nearestTheme } from '../../worker/src/lib/shared';
import {
  CREATURE_BEHAVIOURS, CREATURE_FAMILIES, GRADE_KINDS, RELIEF_KINDS, SITE_PATTERNS, SKY_FEATURE_KINDS, SURFACE_KINDS, WATER_KINDS,
  WEATHER_KINDS, normalizeSpec, validateSpec,
} from '../../app/src/world/schema';
import { repairQuest, verifyQuest } from '../../app/src/world/verify';

describe('prompts', () => {
  it('outline prompt stays small and decides the kind of place first, not a town of houses', () => {
    const s = outlineSystemPrompt();
    expect(s.length).toBeLessThan(18000);
    for (const w of ['key', 'site', 'scatter', 'wild', 'quest', 'lexicon', 'form', 'NOT a town', 'settled', 'horizon']) expect(s).toContain(w);
    expect(outlineSystemPrompt()).toBe(s);
  });

  it('outline prompt asks for the air: every weather and grade, ambience, music and a dramatic hour', () => {
    const s = outlineSystemPrompt();
    for (const w of [...WEATHER_KINDS, ...GRADE_KINDS, 'ambience', 'music', 'haze', 'startHour', 'dusk']) expect(s).toContain(w);
  });

  it('outline prompt names every relief, water, site pattern, sky feature, creature family and behaviour', () => {
    const s = outlineSystemPrompt();
    for (const w of [...RELIEF_KINDS, ...WATER_KINDS, ...SITE_PATTERNS, ...SKY_FEATURE_KINDS, ...CREATURE_FAMILIES, ...CREATURE_BEHAVIOURS]) {
      expect(s).toContain(w);
    }
    // Contrastive examples, so one template is not copied onto every prompt.
    for (const w of ['Sahara', 'Arctic', 'Mars', 'rainforest', 'dragon', 'gothic', 'Manhattan', 'beach', 'Vehicles are out of scope', 'folk']) expect(s).toContain(w);
  });

  it('look prompt teaches every surface kind, wear and wet, glow as light, and set pieces', () => {
    const s = lookSystemPrompt();
    for (const k of SURFACE_KINDS) expect(s).toContain(`- ${k}:`);
    for (const w of ['surfaces', 'wear', 'wet', 'practicals', 'crane', 'container port', 'Sahara', 'rainforest', 'Mars']) expect(s).toContain(w);
    const o = mockOutline('a rain-soaked container port at dawn', 3);
    expect(lookUserMessage('x', 1, o)).toContain('Air: weather rain');
  });

  it('look prompt carries the skeleton principle, the catalogue and the part vocabulary', () => {
    const s = lookSystemPrompt();
    for (const w of ['SKELETON', 'dials', 'same family', 'tree', 'repeat', 'glow', 'doorX', 'GROUNDED REALISM', 'METRES', 'taller than 12 m', 'cave mouth', 'NO plants']) expect(s).toContain(w);
    expect(s.length).toBeLessThan(34000);
    expect(lookSystemPrompt()).toBe(s);
  });

  it('story prompt embeds the schema fragment and puts the player prompt in the user turn', () => {
    const s = storySystemPrompt();
    for (const w of ['npcs', 'quest', 'rules', 'schedule', 'endings', 'reveals']) expect(s).toContain(w);
    const o = mockOutline('a forest of giant mushrooms', 3);
    expect(storyUserMessage('a forest of giant mushrooms', 3, o)).toContain('Player prompt: a forest of giant mushrooms');
    expect(lookUserMessage('x', 1, o)).toContain(o.buildings[0]?.id ?? 'missing');
    expect(outlineUserMessage('abc', 2).endsWith('abc')).toBe(true);
    expect(s).not.toContain('a forest of giant mushrooms');
  });
});

describe('lenient parsing', () => {
  it('reads fenced, prose-wrapped, trailing-comma and truncated JSON', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLooseJson('Here you go: {"a":[1,2,],"b":2,} thanks')).toEqual({ a: [1, 2], b: 2 });
    expect(parseLooseJson('{"a":{"b":[1,2],"c":"tex')).toEqual({ a: { b: [1, 2], c: 'tex' } });
    expect(parseLooseJson('{"a":1,"b":')).toEqual({ a: 1, b: null });
    expect(parseLooseJson('{"a":{"x":1},"q":{"t":"T","p":"two."}"lex":["a","b"]}')).toEqual({ a: { x: 1 }, q: { t: 'T' } });
    expect(parseLooseJson('no json here')).toBeNull();
    expect(closeTruncated('{"a":[{"b":1}')).toBe('{"a":[{"b":1}]}');
  });

  it('reads compact part rows and full objects, and clamps them', () => {
    const row = coercePart(['cone', 0.1, 0.2, 3, 0.3, 0.3, 2, 45, 'accent', 3, 0.2]);
    expect(row).toEqual({ shape: 'cone', x: 0.1, z: 0.2, y: 3, w: 0.3, d: 0.3, h: 2, rot: 45, tone: 'accent', repeat: 3, gap: 0.2 });
    const wild = coercePart({ shape: 'box', x: 9, z: -9, y: 99, w: 0, d: 5, h: 0, tone: 'nope', repeat: 40, gap: 9 });
    expect(wild?.x).toBe(0.5);
    expect(wild?.z).toBe(-0.5);
    expect(wild?.y).toBe(30);
    expect(wild?.repeat).toBe(12);
    expect(wild?.tone).toBe('wall');
    expect(coercePart(['teapot', 0, 0, 0, 1, 1, 1, 0, 'wall', 1, 0])).toBeNull();
    expect(coercePart('box')).toBeNull();
  });
});

describe('coercion and merge', () => {
  const prompt = 'a forest of giant glowing mushrooms where tiny folk live';
  const rawOutline = {
    title: 'Capwood', tagline: 'Small folk, tall caps.', era: 'the long dusk', theme: 'medieval',
    site: { pattern: 'scatter', wild: 0.9, paths: 'track', spacing: 10 }, palette: { sky: 'dusk', fog: 0.4 },
    buildings: [
      { id: 'cap_inn', role: 'mushroom inn', label: 'The Soft Cap', form: 'wide red cap on a short stalk', size: 'large', keyBuilding: true },
      { id: 'spore_market', role: 'market', label: 'Spore Market', form: 'ring of stalls', size: 'medium', keyBuilding: true },
      { id: 'stalk_home', role: 'house', label: 'Stalk Home', form: 'thin tall stalk', size: 'small' },
      { id: 'elder_cap', role: 'council hall', label: 'Elder Cap', form: 'huge domed cap', size: 'large' },
    ],
    npcs: [
      { id: 'brin', name: 'Brin', role: 'innkeeper', home: 'cap_inn', work: 'cap_inn' },
      { id: 'ula', name: 'Ula', role: 'forager', home: 'stalk_home', work: 'nowhere' },
    ],
    quest: { title: 'The Dimming', premise: 'The glow is fading. Someone must find out why.' },
    lexicon: ['glimmer', 'cap'],
  };

  it('fixes roles by word, drops unknown ids to real buildings, keeps the layout', () => {
    const o = coerceOutline(rawOutline, 'western');
    expect(o?.theme).toBe('medieval');
    expect(o?.buildings.map((b) => b.role)).toEqual(['inn', 'market', 'house', 'townhall']);
    expect(o?.site.pattern).toBe('scatter');
    expect(o?.site.wild).toBe(0.9);
    const ids = new Set(o?.buildings.map((b) => b.id));
    for (const n of o?.npcs ?? []) {
      expect(ids.has(n.home)).toBe(true);
      expect(ids.has(n.work)).toBe(true);
    }
    expect(coerceOutline({ buildings: [] }, 'western')).toBeNull();
  });

  const rawLook = {
    style: { name: 'spore glow', wall: '#e8c9d8', wall2: '#b58ad1', roof: '#c4416b', trim: '#fff0c8', accent: '#ffd23f', dark: '#241a33', glass: '#2a3a5c', glow: '#7ffff0', ground: '#2e4a3a', road: '#4a6a52', variety: 0.3 },
    blueprints: [
      { id: 'cap_house', summary: 'cap', family: 'tower', dials: { height: 9, taper: 0.4, x: 'y' }, parts: [['dome', 0, 0, 6, 1.2, 1.2, 3, 0, 'roof', 1, 0], ['sphere', 0.2, 0.2, 7, 0.1, 0.1, 0.2, 0, 'glow', 4, 0.1]], doorX: 0.1 },
      { id: 'flat_stall', summary: 'plain', parts: [['box', 0, 0, 0, 1, 1, 3, 0, 'wall', 1, 0], ['gable', 0, 0, 3, 1, 1, 1, 0, 'roof', 1, 0], ['box', 0, 0.5, 0, 0.1, 0.02, 2, 0, 'dark', 1, 0]], doorX: 0 },
    ],
    buildings: [{ id: 'cap_inn', blueprint: 'cap_house' }, { id: 'ghost', blueprint: 'cap_house' }, { id: 'stalk_home', blueprint: 'missing' }],
    props: [{ kind: 'glow_shroom', family: 'tree', dials: { height: 2 }, parts: [], size: 1.2, weight: 5 }, { kind: 'empty' }],
    landmarks: [{ id: 'great_cap', prompt: 'a vast glowing mushroom cap, low-poly stylised', place: 'nowhere', height: 12 }],
  };

  it('assigns a real blueprint to every building and keeps skeleton fields', () => {
    const o = coerceOutline(rawOutline, 'western');
    if (!o) throw new Error('outline');
    const look = coerceLook(rawLook, o, BASE.western);
    expect(look).not.toBeNull();
    const bpIds = new Set(look?.blueprints.map((b) => b.id));
    expect(look?.buildings).toHaveLength(o.buildings.length);
    for (const b of look?.buildings ?? []) expect(bpIds.has(b.blueprint)).toBe(true);
    expect(look?.buildings.find((b) => b.id === 'cap_inn')?.blueprint).toBe('cap_house');
    expect(look?.blueprints[0]?.family).toBe('tower');
    expect(look?.blueprints[0]?.dials).toEqual({ height: 9, taper: 0.4, x: 'y' });
    expect(look?.props).toHaveLength(1);
    expect(look?.landmarks[0]?.place).toBe('plaza');
    expect(coerceLook({ blueprints: [] }, o, BASE.western)).toBeNull();
    expect(coerceLook({ ...rawLook, style: { name: 'x' } }, o, BASE.western)).toBeNull();
  });

  it('merges outline, look and story into a spec that passes the schema', () => {
    const o = mockOutline(prompt, 5);
    const look = mockLook(prompt, 5, o.theme, o);
    const story = mockStory(o.theme, o);
    const spec = mergeSpec(prompt, 5, o, look, story);
    expect(validateSpec(spec).ok).toBe(true);
    expect(spec.prompt).toBe(prompt);
    expect(spec.seed).toBe(5);
    expect(spec.site?.pattern).toBe('scatter');
  });

  it('keeps the outline mood and hour, and makes sky and fog agree with them', () => {
    const mood = { weather: 'rain', intensity: 0.8, grade: 'teal_orange', haze: 0.6, ambience: ['Rain', 'harbor'], music: 'slow noir piano' };
    const wet = 'a harbour town in heavy rain';
    const o = coerceOutline({ ...rawOutline, mood, time: { startHour: 13 }, palette: { sky: 'day', fog: 0.05 } }, 'western', wet);
    expect(o?.mood).toEqual({ ...mood, ambience: ['rain', 'harbor'] });
    // Rain the player never asked for is dropped: clear air, no rain bed.
    const dry = coerceOutline({ ...rawOutline, mood, time: { startHour: 13 }, palette: { sky: 'day', fog: 0.05 } }, 'western', 'a harbour town');
    expect(dry?.mood).toMatchObject({ weather: 'clear', intensity: 0, ambience: ['harbor'] });
    expect(o?.time.startHour).toBe(13);
    expect(o?.palette.sky).toBe('overcast');
    expect(o?.palette.fog ?? 0).toBeGreaterThanOrEqual(0.25);

    const night = coerceOutline({ ...rawOutline, mood: { ...mood, weather: 'snow' }, time: { startHour: 22 }, palette: { sky: 'day', fog: 0.3 } }, 'western', prompt);
    expect(night?.palette.sky).toBe('night');

    // No mood and no hour from the model: both are read from the prompt.
    const bare = coerceOutline({ ...rawOutline, palette: {} }, 'medieval', 'a snowbound mountain monastery at night');
    expect(bare?.mood.weather).toBe('snow');
    expect(bare?.palette.sky).toBe('night');
    expect(bare?.time.startHour).toBe(22);
    expect(coerceOutline({ ...rawOutline, mood: { weather: 'hail', grade: 'pink' } }, 'western')?.mood).toMatchObject({ weather: 'clear', grade: 'neutral' });
  });

  it('carries surfaces on the look: the model kinds, a prompt-read set for the rest, never dry under rain', () => {
    const o = coerceOutline({ ...rawOutline, mood: { weather: 'storm', intensity: 0.9, grade: 'cold_steel', haze: 0.5, ambience: [], music: '' } }, 'western', `${prompt} in a storm`);
    if (!o) throw new Error('outline');
    const withSurfaces = { ...rawLook, style: { ...rawLook.style, surfaces: { wall: 'organic', wall2: 'bark', roof: 'organic', trim: 'nonsense', ground: 'moss', road: 'dirt', wear: 0.3, wet: 0 } } };
    const s = coerceLook(withSurfaces, o, BASE.western, prompt)?.style.surfaces;
    expect(s).toMatchObject({ wall: 'organic', wall2: 'bark', roof: 'organic', trim: 'bark', ground: 'moss', road: 'dirt', wear: 0.3 });
    expect(s?.wet ?? 0).toBeGreaterThanOrEqual(0.4);
    // The model wrote no surfaces at all: the look still has a full set that fits the prompt.
    expect(coerceLook(rawLook, o, BASE.western, prompt)?.style.surfaces).toMatchObject({ wall: 'organic', ground: 'moss' });
  });

  it('merged specs carry mood, surfaces and the outline hour', () => {
    const p = 'a rain-soaked container port at dawn, cranes overhead, sodium lights';
    const o = mockOutline(p, 5);
    const spec = mergeSpec(p, 5, o, mockLook(p, 5, o.theme, o), mockStory(o.theme, o));
    expect(validateSpec(spec).ok).toBe(true);
    expect(spec.mood).toEqual(o.mood);
    expect(spec.mood?.weather).toBe('rain');
    expect(spec.style?.surfaces).toMatchObject({ wall: 'corrugated', road: 'asphalt' });
    expect(spec.time.startHour).toBe(o.time.startHour);
    expect(spec.palette.sky).toBe(o.palette.sky);
  });

  it('rejects a story with too few people or steps', () => {
    const o = mockOutline(prompt, 5);
    expect(coerceStory({ npcs: [], quest: { steps: [] } }, o)).toBeNull();
  });

  it('accepts a story with nobody in it when the outline has nobody, and names the spirit as giver', () => {
    const o = { ...mockOutline('the Sahara desert at dusk', 5), npcs: [] };
    const story = coerceStory({
      npcs: [{ id: 'ghost', name: 'Ghost' }],
      items: [{ id: 'bell', name: 'Camel bell', description: 'Bronze.', holder: 'caravan_tent' }],
      quest: { title: 'Dry wells', hook: 'h', giver: 'nobody', steps: [
        { id: 'a', kind: 'talk', target: SPIRIT_ID, requires: [], objective: 'Listen.', beat: 'Wind.' },
        { id: 'b', kind: 'visit', target: 'caravan_tent', requires: ['a'], objective: 'Reach the camp.', beat: 'Empty.' },
        { id: 'c', kind: 'fetch', target: 'bell', item: 'bell', requires: ['b'], objective: 'Take the bell.', beat: 'It rings.' },
      ], endings: [{ stepId: 'c', label: 'Done', tone: 'neutral' }] },
      rules: [],
    }, o);
    expect(story).not.toBeNull();
    if (!story) return;
    expect(story.npcs).toHaveLength(0);
    expect(story.quest.giver).toBe(SPIRIT_ID);
    const spec = mergeSpec('the Sahara desert at dusk', 5, o, mockLook('the Sahara desert at dusk', 5, 'western', o), story);
    expect(validateSpec(spec).ok).toBe(true);
    const played = repairQuest(normalizeSpec(spec));
    expect(played.npcs.map((n) => n.id)).toEqual([SPIRIT_ID]);
    expect(verifyQuest(played).winnable).toBe(true);
  });
});

describe('fixture fallbacks re-home the cast onto the outline', () => {
  it.each(['a forest of giant mushrooms', 'a city of needle-thin glass towers in 2400', 'wild west 1899', 'a desert caravan camp'])('%s', (p) => {
    const theme = nearestTheme(p);
    const base = mockOutline(p, 1);
    // A different set of structures than the fixture's own.
    const o = { ...base, buildings: base.buildings.slice(0, 7).map((b, i) => ({ ...b, id: `s${i}`, role: i % 2 ? ('house' as const) : b.role })) };
    const story = mockStory(theme, o);
    const ids = new Set(o.buildings.map((b) => b.id));
    for (const n of story.npcs) {
      expect(ids.has(n.home)).toBe(true);
      expect(n.work === 'street' || n.work === 'plaza' || ids.has(n.work)).toBe(true);
      for (const e of n.schedule) expect(e.place === 'street' || e.place === 'plaza' || ids.has(e.place)).toBe(true);
    }
    const spec = mergeSpec(p, 1, o, mockLook(p, 1, theme, o), story);
    expect(validateSpec(spec).ok).toBe(true);
    expect(verifyQuest(spec).winnable).toBe(true);
  });
});

describe('POST /api/compile in mock mode', () => {
  it('streams outline, look, then spec, in that order, with the prompt and seed stamped', async () => {
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException: () => undefined } as unknown as ExecutionContext;
    const req = new Request('http://x/api/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a desert caravan camp', seed: 77 }) });
    const res = await handleCompile(req, { MOCK: '1' }, ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    await Promise.all(waits);
    const events = [...text.matchAll(/^event: (.*)$/gm)].map((m) => m[1]);
    const order = events.filter((e) => e === 'outline' || e === 'look' || e === 'spec');
    expect(order).toEqual(['outline', 'look', 'spec']);
    // The outline event already carries the air, so the client can set sky and sound before the look arrives.
    const outline = JSON.parse(/event: outline\ndata: (.*)\n/.exec(text)?.[1] ?? 'null') as { mood?: { weather?: string; ambience?: string[] }; time?: { startHour?: number } } | null;
    expect(outline?.mood?.weather).toBe('dust');
    expect(outline?.mood?.ambience?.length ?? 0).toBeGreaterThan(0);
    expect(typeof outline?.time?.startHour).toBe('number');
    const look = JSON.parse(/event: look\ndata: (.*)\n/.exec(text)?.[1] ?? 'null') as { style?: { surfaces?: { wall?: string; ground?: string } } } | null;
    expect(look?.style?.surfaces?.ground).toBe('sand');
    const specFrame = /event: spec\ndata: (.*)\n/.exec(text)?.[1];
    const spec: unknown = JSON.parse(specFrame ?? 'null');
    const v = validateSpec(spec);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.seed).toBe(77);
      expect(v.value.prompt).toBe('a desert caravan camp');
      // Open desert, not a town: one camp, two people, and the land, creatures and folk travel with the spec.
      expect(v.value.site?.pattern).toBe('wild');
      expect(v.value.terrain).toMatchObject({ relief: 'dunes', water: 'none' });
      expect(v.value.terrain?.settled ?? 1).toBeLessThan(0.3);
      expect(v.value.buildings.length).toBeLessThanOrEqual(3);
      expect(v.value.npcs.length).toBeLessThanOrEqual(3);
      expect(v.value.creatures?.some((c) => c.family === 'quadruped')).toBe(true);
      expect(v.value.folk?.features).toContain('hood');
      expect(v.value.mood?.weather).toBe('dust');
      expect(v.value.style?.surfaces?.wall).toBe('canvas');
      expect(v.value.time.startHour).toBe(outline?.time?.startHour);
      expect(verifyQuest(v.value).winnable).toBe(true);
    }
  }, 15000);
});

describe('the outline decides the kind of place', () => {
  const sahara = {
    place: 'open dune sea with one caravan camp',
    title: 'Erg Tifernine', tagline: 'Sand to every horizon.', era: 'present day', theme: 'western',
    terrain: { relief: 'Dunes', ruggedness: '0.6', water: 'none', waterAmount: 0.4, horizon: 'dune sea in heat haze', settled: 0.05 },
    site: { pattern: 'wild', wild: 0.1, paths: 'none', spacing: 14 },
    time: { startHour: 17 }, mood: { weather: 'dust', intensity: 0.3, grade: 'golden', haze: 0.6, ambience: ['wind', 'desert'], music: 'lonely oud' },
    palette: { sky: 'dusk', fog: 0.3 },
    skyFeatures: [['moon', 0.08, '#e8e0d0'], ['flying saucer', 1, '#fff'], ['second_sun', 0.2, '#ffd9a0'], ['comet', 0.1, '#fff'], ['aurora', 0.5, '#0f0']],
    folk: { name: 'Tuareg drovers', height: 1.75, bulk: 0.4, head: 1, features: ['hood', 'cloak', 'jetpack'], skin: ['#8d5f43'], cloth: ['#0000ff', '#d8d0bc'], trim: ['#2a2420'] },
    buildings: [['caravan_camp', 'house', 'Camp of Seven Wells', 'low goat-hair tent', 'medium', 1]],
    npcs: [['idir', 'Idir', 'camel drover', 'caravan_camp', 'caravan_camp'], ['tana', 'Tana', 'guide', 'nowhere', 'street']],
    creatures: [
      ['camels', 'dromedary camels', 'quadruped', 2.2, 4, 'graze', 'caravan_camp', '#b8956a', '#8a6a48', '#000000', 'Hobbled and chewing.', { hump: 0.8, legs: 0.7 }],
      ['hawk', 'desert hawk', 'bird', 0.6, 1, 'circle', 'sky', '#7a5a3a', '#3a2a1c', '#000000', 'One mark in the sky.', {}],
      ['eel', 'sand eel', 'swimmer', 99, 500, 'burrow', 'water', '#ff0000', 'red', '#000000', 'Wrong desert.', {}],
      { id: 'wyrm', name: 'dune wyvern', family: 'sandworm', size: 12, count: 1, behaviour: 'lurk', haunt: 'the far dunes' },
    ],
    quest: { title: 'Dry wells', premise: 'The wells are failing. The drovers need a tracker.' }, lexicon: ['erg', 'guelta'],
  };

  it('reads terrain, sky, folk and creature rows, repairing slips', () => {
    const o = coerceOutline(sahara, 'western', 'the Sahara desert at dusk');
    expect(o).not.toBeNull();
    if (!o) return;
    expect(o.terrain).toEqual({ relief: 'dunes', ruggedness: 0.6, water: 'none', waterAmount: 0, horizon: 'dune sea in heat haze', settled: 0.05 });
    expect(o.site.pattern).toBe('wild');
    expect(o.buildings).toHaveLength(1);
    expect(o.npcs.map((n) => n.home)).toEqual(['caravan_camp', 'caravan_camp']);
    expect(o.skyFeatures.map((f) => f.kind)).toEqual(['moon', 'second_sun', 'comet']);
    expect(o.folk.features).toEqual(['hood', 'cloak']);
    expect(o.folk.cloth[0]).not.toBe('#0000ff');
    expect(o.creatures.map((c) => c.family)).toEqual(['quadruped', 'bird', 'swimmer', 'serpent']);
    expect(o.creatures[0]).toMatchObject({ haunt: 'caravan_camp', count: 4, size: 2.2, dials: { hump: 0.8, legs: 0.7 } });
    // No water in this land, so nothing keeps to it; sizes and counts are clamped; unknown behaviour follows the family.
    expect(o.creatures[2]).toMatchObject({ haunt: 'wild', size: 40, count: 24, behaviour: 'roam' });
    expect(o.creatures[3]).toMatchObject({ haunt: 'wild', behaviour: 'stalk' });
  });

  it('accepts land with nothing built and nobody there, and rejects an empty reply', () => {
    const o = coerceOutline({ title: 'Mare Frigoris', terrain: { relief: 'crater', water: 'none', settled: 0 }, buildings: [], npcs: [] }, 'scifi', 'a dead moon');
    expect(o).not.toBeNull();
    expect(o?.buildings).toHaveLength(0);
    expect(o?.npcs).toHaveLength(0);
    expect(o?.site.pattern).toBe('wild');
    expect(coerceOutline({}, 'scifi', 'x')).toBeNull();
    if (!o) return;
    // No structures needs no blueprints; the story falls back to the spirit of the place and the world still plays.
    const look = coerceLook({ style: { wall: '#444444', wall2: '#555555', roof: '#333333', trim: '#666666', accent: '#777777', dark: '#111111', glass: '#222222', glow: '#ffffff', ground: '#8a8a86', road: '#777777' }, blueprints: [], props: [{ kind: 'boulders', family: 'rock', dials: { form: 'boulder' }, parts: [], size: 40, weight: 5 }] }, o, BASE.scifi, 'a dead moon');
    expect(look).not.toBeNull();
    if (!look) return;
    expect(look.blueprints).toHaveLength(0);
    expect(look.props[0]?.size).toBe(16);
    const spec = mergeSpec('a dead moon', 2, o, look, plainStory(o));
    expect(validateSpec(spec).ok).toBe(true);
    expect(spec.npcs).toHaveLength(0);
    const played = repairQuest(normalizeSpec(spec));
    expect(played.buildings).toHaveLength(0);
    expect(played.npcs).toHaveLength(1);
    expect(verifyQuest(played).winnable).toBe(true);
  });

  it('falls back to the land the prompt names when the model leaves terrain and life out', () => {
    const o = coerceOutline({ title: 'Camp', buildings: [['tent', 'house', 'Tent', 'a tent', 'small', 1]] }, 'western', 'the Sahara desert');
    expect(o?.terrain.relief).toBe('dunes');
    expect(o?.creatures.length ?? 0).toBeGreaterThan(0);
    expect(o?.creatures.every((c) => ['sky', 'water', 'wild', 'plaza', 'tent'].includes(c.haunt))).toBe(true);
  });

  it('mutes loud colours and leaves real ones alone', () => {
    expect(mute('#ff0000', 0.5)).toBe('#ff8080');
    expect(mute('#6E5D4B', 0.5)).toBe('#6e5d4b');
    expect(mute('nope', 0.5)).toBe('nope');
  });
});

describe('mock mode shows wilderness as well as towns', () => {
  const cases: [string, string, string][] = [
    ['the Sahara desert at dusk', 'desert', 'dunes'], ['the Amazon jungle after rain', 'jungle', 'rolling'],
    ['an Arctic research outpost in a blizzard', 'arctic', 'icefield'], ['the first colony on Mars', 'mars', 'crater'],
    ['an underwater coral reef', 'ocean', 'islands'], ["a dragon's volcanic lair", 'volcano', 'crater'],
    ['a fog-bound swamp', 'swamp', 'swamp'], ['Manhattan rooftops at night', 'city', 'flat'],
  ];
  it.each(cases)('%s', (p, biome, relief) => {
    const theme = nearestTheme(p);
    const land = mockLand(p, theme);
    expect(land.biome).toBe(biome);
    const o = mockOutline(p, 4);
    expect(o.terrain.relief).toBe(relief);
    expect(o.creatures.length).toBeGreaterThan(0);
    if (biome !== 'city') {
      expect(o.terrain.settled).toBeLessThan(0.3);
      expect(o.buildings.length).toBeLessThanOrEqual(3);
      expect(o.npcs.length).toBeLessThanOrEqual(4);
    } else expect(o.buildings.length).toBeGreaterThanOrEqual(6);
    const spec = mergeSpec(p, 4, o, mockLook(p, 4, theme, o), mockStory(theme, o));
    const v = validateSpec(spec);
    expect(v.ok).toBe(true);
    const played = repairQuest(normalizeSpec(spec));
    expect(verifyQuest(played).winnable).toBe(true);
    const ids = new Set(played.buildings.map((b) => b.id));
    for (const c of played.creatures ?? []) expect(['sky', 'water', 'wild', 'plaza'].includes(c.haunt) || ids.has(c.haunt)).toBe(true);
    for (const b of played.buildings) expect(played.blueprints?.some((x) => x.id === b.blueprint)).toBe(true);
    // Skeleton families were expanded into parts on normalisation.
    for (const bp of played.blueprints ?? []) expect(bp.parts.length).toBeGreaterThan(0);
  });

  it('keeps a town when the prompt names one in a biome, and reads the sky from the prompt', () => {
    const o = mockOutline('a desert town under two suns', 1);
    expect(o.buildings.length).toBeGreaterThanOrEqual(6);
    expect(o.terrain.relief).toBe('dunes');
    expect(o.terrain.settled).toBeGreaterThanOrEqual(0.7);
    expect(o.skyFeatures.map((f) => f.kind)).toContain('second_sun');
  });
});
