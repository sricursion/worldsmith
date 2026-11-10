import { describe, expect, it } from 'vitest';
import { handleCompile } from '../../worker/src/routes/compile';
import { outlineSystemPrompt, outlineUserMessage } from '../../worker/src/prompts/compile';
import { lookSystemPrompt, lookUserMessage } from '../../worker/src/prompts/compilelook';
import { storySystemPrompt, storyUserMessage } from '../../worker/src/prompts/compilestory';
import {
  closeTruncated, coerceLook, coerceOutline, coercePart, coerceStory, mergeSpec, parseLooseJson,
} from '../../worker/src/prompts/compilemerge';
import { mockLook, mockOutline, mockStory } from '../../worker/src/lib/mockcast';
import { BASE } from '../../worker/src/lib/mockstyle';
import { nearestTheme } from '../../worker/src/lib/shared';
import { validateSpec } from '../../app/src/world/schema';
import { verifyQuest } from '../../app/src/world/verify';

describe('prompts', () => {
  it('outline prompt stays small and asks for the structural idea, not a town of houses', () => {
    const s = outlineSystemPrompt();
    expect(s.length).toBeLessThan(6000);
    for (const w of ['key', 'site', 'scatter', 'wild', 'quest', 'lexicon', 'form']) expect(s).toContain(w);
    expect(outlineSystemPrompt()).toBe(s);
  });

  it('look prompt carries the skeleton principle, the catalogue and the part vocabulary', () => {
    const s = lookSystemPrompt();
    for (const w of ['SKELETON', 'dials', 'same family', 'trees', 'repeat', 'glow', 'doorX', 'low-poly stylised']) expect(s).toContain(w);
    expect(s.length).toBeLessThan(30000);
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

  it('rejects a story with too few people or steps', () => {
    const o = mockOutline(prompt, 5);
    expect(coerceStory({ npcs: [], quest: { steps: [] } }, o)).toBeNull();
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
    const specFrame = /event: spec\ndata: (.*)\n/.exec(text)?.[1];
    const spec: unknown = JSON.parse(specFrame ?? 'null');
    const v = validateSpec(spec);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.seed).toBe(77);
      expect(v.value.prompt).toBe('a desert caravan camp');
      expect(v.value.site?.pattern).toBe('scatter');
      expect(verifyQuest(v.value).winnable).toBe(true);
    }
  }, 15000);
});
