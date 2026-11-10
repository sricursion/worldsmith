import { describe, expect, it } from 'vitest';
import { compileSystemPrompt, compileUserMessage } from '../../worker/src/prompts/compile';
import { remixStyle, mockSpec } from '../../worker/src/lib/mockstyle';
import { MOCK_BLUEPRINTS, PAGODA_BLUEPRINT, SALOON_BLUEPRINT } from '../../worker/src/lib/mockblueprints';
import { messagesUrl } from '../../worker/src/lib/anthropic';
import { FIXTURES, nearestTheme } from '../../worker/src/lib/shared';
import type { Blueprint } from '../../app/src/world/spec';

const HEX = /^#[0-9a-f]{6}$/i;

describe('compile prompt', () => {
  const sys = compileSystemPrompt();

  it('teaches the part vocabulary and the coordinate system', () => {
    for (const w of ['box', 'cylinder', 'cone', 'pyramid', 'gable', 'dome', 'sphere', 'wedge', 'arch', 'ring']) expect(sys).toContain(w);
    for (const w of ['wall2', 'trim', 'accent', 'dark', 'glass', 'glow', 'repeat', 'gap', 'doorX', '+z', 'footprint', '3 m']) expect(sys).toContain(w);
    for (const w of ['blueprints', 'props', 'landmarks', 'low-poly stylised', '7000']) expect(sys).toContain(w);
  });

  it('embeds the two worked blueprints exactly', () => {
    expect(sys).toContain(JSON.stringify(SALOON_BLUEPRINT));
    expect(sys).toContain(JSON.stringify(PAGODA_BLUEPRINT));
  });

  it('is stable across calls and under a size cap', () => {
    expect(compileSystemPrompt()).toBe(sys);
    expect(sys.length).toBeLessThan(26000);
  });

  it('puts the player prompt last in the user message', () => {
    const msg = compileUserMessage('a pirate cove built on shipwrecks, 1715', 42);
    expect(msg.endsWith('Player prompt: a pirate cove built on shipwrecks, 1715')).toBe(true);
    expect(sys).not.toContain('pirate cove built on shipwrecks, 1715');
  });
});

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

describe('ANTHROPIC_BASE_URL', () => {
  it('defaults and honours a gateway, ignoring a trailing slash', () => {
    expect(messagesUrl({})).toBe('https://api.anthropic.com/v1/messages');
    expect(messagesUrl({ ANTHROPIC_BASE_URL: '' })).toBe('https://api.anthropic.com/v1/messages');
    expect(messagesUrl({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/' })).toBe('http://127.0.0.1:8317/v1/messages');
  });
});
