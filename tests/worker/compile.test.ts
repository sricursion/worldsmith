import { describe, expect, it } from 'vitest';
import { remixStyle, mockSpec } from '../../worker/src/lib/mockstyle';
import { MOCK_BLUEPRINTS, SALOON_BLUEPRINT } from '../../worker/src/lib/mockblueprints';
import { messagesUrl } from '../../worker/src/lib/anthropic';
import { FIXTURES, nearestTheme } from '../../worker/src/lib/shared';
import { normalizeSpec, validateSpec } from '../../app/src/world/schema';
import type { Blueprint } from '../../app/src/world/spec';

const HEX = /^#[0-9a-f]{6}$/i;

describe('worked blueprints', () => {
  const inRange = (b: Blueprint): void => {
    expect(b.parts.length).toBeGreaterThanOrEqual(4);
    expect(b.parts.length).toBeLessThanOrEqual(28);
    expect(b.parts[0]?.y).toBe(0);
    for (const p of b.parts) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(0.5);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.w).toBeGreaterThanOrEqual(0.02);
      expect(p.w).toBeLessThanOrEqual(1.4);
      expect(p.h).toBeGreaterThanOrEqual(0.05);
      expect(p.h).toBeLessThanOrEqual(30);
      expect(p.repeat).toBeGreaterThanOrEqual(1);
      expect(p.repeat).toBeLessThanOrEqual(12);
      if (p.repeat === 1) expect(p.gap).toBe(0);
      else expect(Math.abs(p.x) + ((p.repeat - 1) * p.gap) / 2 + p.w / 2).toBeLessThanOrEqual(0.7);
    }
  };
  it.each(MOCK_BLUEPRINTS.map((b) => [b.id, b] as const))('%s stays inside the contract', (_id, b) => inRange(b));
});

describe('mock style remix', () => {
  const base = FIXTURES.western;

  it('gives different prompts different styles', () => {
    const prompts = ['a neon arcology', 'an arctic whaling station', 'a desert oasis bazaar', 'a gothic vampire village', 'a jungle temple town'];
    const walls = new Set(prompts.map((p) => mockSpec(base, p, 1).style?.wall));
    expect(walls.size).toBe(prompts.length);
  });

  it('only emits valid hex colours and a variety in range', () => {
    for (const p of ['neon rain', 'pastel candy town', 'volcanic forge', 'pirate cove at dusk', 'nothing matches here']) {
      const { style } = remixStyle(p, mockSpec(base, p, 1).style ?? (undefined as never));
      for (const k of ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow', 'ground', 'road'] as const) expect(style[k]).toMatch(HEX);
      expect(style.variety).toBeGreaterThanOrEqual(0);
      expect(style.variety).toBeLessThanOrEqual(1);
    }
  });

  it('applies sky and fog from keywords and syncs the palette', () => {
    const spec = mockSpec(base, 'a neon city', 7);
    expect(spec.palette.sky).toBe('night');
    expect(spec.palette.ground).toBe(spec.style?.ground);
    expect(spec.palette.accent).toBe(spec.style?.accent);
  });

  it('is deterministic and keeps the prompt and seed', () => {
    expect(mockSpec(base, 'snow village', 9)).toEqual(mockSpec(base, 'snow village', 9));
    const s = mockSpec(base, 'snow village', 9);
    expect(s.prompt).toBe('snow village');
    expect(s.seed).toBe(9);
  });

  it('attaches blueprints to every building when the fixture has none, and streams fixture blueprints as is', () => {
    const spec = mockSpec(FIXTURES[nearestTheme('a pirate cove')], 'a pirate cove', 3);
    const ids = new Set(spec.blueprints?.map((b) => b.id));
    expect(ids.size).toBeGreaterThan(0);
    for (const b of spec.buildings) expect(b.blueprint && ids.has(b.blueprint)).toBe(true);
    expect((spec.props?.length ?? 0)).toBeGreaterThan(0);
    expect((spec.landmarks?.length ?? 0)).toBeGreaterThan(0);

    const own: Blueprint = { ...SALOON_BLUEPRINT, id: 'own' };
    const withOwn = { ...base, blueprints: [own], buildings: base.buildings.map((b) => ({ ...b, blueprint: 'own' })) };
    const out = mockSpec(withOwn, 'a desert town', 1);
    expect(out.blueprints).toEqual([own]);
    expect(out.buildings.every((b) => b.blueprint === 'own')).toBe(true);
  });
});

describe('mock mood and surfaces', () => {
  const run = (p: string): ReturnType<typeof mockSpec> => mockSpec(FIXTURES[nearestTheme(p)], p, 1);

  it('reads weather, hour, grade and materials from prompt words', () => {
    const port = run('a rain-soaked container port at dawn');
    expect(port.mood).toMatchObject({ weather: 'rain', grade: 'teal_orange' });
    expect(port.mood?.ambience).toEqual(expect.arrayContaining(['rain', 'harbor']));
    expect(port.style?.surfaces).toMatchObject({ wall: 'corrugated', wall2: 'rusted', ground: 'concrete', road: 'asphalt' });
    expect(port.style?.surfaces?.wet ?? 0).toBeGreaterThan(0.6);
    expect(port.time.startHour).toBe(6);
    expect(port.palette.sky).toBe('dawn');

    const monastery = run('a snowbound mountain monastery at night');
    expect(monastery.mood).toMatchObject({ weather: 'snow', grade: 'moonlit' });
    expect(monastery.style?.surfaces).toMatchObject({ wall: 'stone', ground: 'snow' });
    expect(monastery.palette.sky).toBe('night');

    expect(run('a storm over a pirate cove').mood?.weather).toBe('storm');
    expect(run('a foggy gothic village').mood).toMatchObject({ weather: 'fog', grade: 'moonlit' });
    expect(run('a desert oasis bazaar').mood?.weather).toBe('dust');
    expect(run('a swamp village on stilts').mood?.weather).toBe('fireflies');
    expect(run('a forest of giant glowing mushrooms').style?.surfaces).toMatchObject({ wall: 'organic', ground: 'moss' });
    expect(run('a city of needle-thin glass towers').style?.surfaces?.wall).toBe('glass_curtain');
    expect(run('a neon arcology in the rain').mood).toMatchObject({ weather: 'rain', grade: 'neon_noir' });
  });

  it('gives different prompts different atmospheres', () => {
    const prompts = ['a rain-soaked port at dawn', 'a snowbound monastery at night', 'a desert caravan camp', 'a mushroom forest', 'a volcanic forge town', 'a neon arcology'];
    const airs = new Set(prompts.map((p) => {
      const s = run(p);
      return `${s.mood?.weather}|${s.mood?.grade}|${s.style?.surfaces?.wall}|${s.style?.surfaces?.ground}`;
    }));
    expect(airs.size).toBe(prompts.length);
  });

  it('falls back to a strong default mood per theme when the prompt names none', () => {
    const plain = (theme: 'western' | 'medieval' | 'scifi' | 'modern'): ReturnType<typeof mockSpec> => mockSpec(FIXTURES[theme], 'somewhere', 1);
    expect(plain('western').mood).toMatchObject({ weather: 'dust', grade: 'golden' });
    expect(plain('western').time.startHour).toBe(17.5);
    expect(plain('medieval').mood).toMatchObject({ weather: 'mist', grade: 'golden' });
    expect(plain('medieval').palette.sky).toBe('dawn');
    expect(plain('scifi').mood).toMatchObject({ weather: 'snow', grade: 'cold_steel' });
    expect(plain('scifi').mood?.intensity ?? 1).toBeLessThan(0.5);
    expect(plain('modern').mood).toMatchObject({ weather: 'clear', grade: 'teal_orange' });
    expect(plain('modern').palette.sky).toBe('dusk');
    for (const t of ['western', 'medieval', 'scifi', 'modern'] as const) {
      const s = plain(t);
      expect(validateSpec(s).ok).toBe(true);
      expect(normalizeSpec(s).mood).toEqual(s.mood);
      expect(normalizeSpec(s).style?.surfaces).toEqual(s.style?.surfaces);
    }
  });
});

describe('ANTHROPIC_BASE_URL', () => {
  it('defaults and honours a gateway, ignoring a trailing slash', () => {
    expect(messagesUrl({})).toBe('https://api.anthropic.com/v1/messages');
    expect(messagesUrl({ ANTHROPIC_BASE_URL: '' })).toBe('https://api.anthropic.com/v1/messages');
    expect(messagesUrl({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/' })).toBe('http://127.0.0.1:8317/v1/messages');
  });
});
