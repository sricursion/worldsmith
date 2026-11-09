import { describe, expect, it } from 'vitest';
import { FIXTURES, nearestTheme } from '../../app/src/world/fixtures';
import { normalizeSpec, validateSpec } from '../../app/src/world/schema';
import { verifyQuest } from '../../app/src/world/verify';
import type { ThemeId } from '../../app/src/world/spec';

const THEMES: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

describe.each(THEMES)('fixture %s', (theme) => {
  const spec = FIXTURES[theme];

  it('passes validateSpec', () => {
    const r = validateSpec(JSON.parse(JSON.stringify(spec)));
    expect(r.ok).toBe(true);
  });

  it('round-trips through normalizeSpec unchanged', () => {
    expect(normalizeSpec(spec)).toEqual(spec);
  });

  it('has a winnable, problem-free quest', () => {
    const rep = verifyQuest(spec);
    expect(rep.problems).toEqual([]);
    expect(rep.unreachable).toEqual([]);
    expect(rep.winnable).toBe(true);
    expect(rep.order.length).toBeGreaterThanOrEqual(5);
  });

  it('has well-formed NPCs', () => {
    const buildings = new Set(spec.buildings.map((b) => b.id));
    const npcs = new Map(spec.npcs.map((n) => [n.id, n]));
    for (const n of spec.npcs) {
      expect(n.secrets.length).toBeGreaterThanOrEqual(1);
      expect(n.secrets.length).toBeLessThanOrEqual(3);
      expect(n.schedule.length).toBeGreaterThanOrEqual(4);
      expect(n.schedule.length).toBeLessThanOrEqual(6);
      expect(n.schedule.some((e) => e.activity === 'sleep' && e.place === n.home)).toBe(true);
      expect(n.schedule.some((e) => e.place === n.work)).toBe(true);
      expect(buildings.has(n.home)).toBe(true);
      expect(n.persona.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(2);
      expect(n.persona.split(/[.!?]\s/).length).toBeLessThanOrEqual(4);
      for (const e of n.schedule) expect(buildings.has(e.place) || e.place === 'street' || e.place === 'plaza').toBe(true);
      for (const r of n.relationships) expect(npcs.has(r.npcId)).toBe(true);
    }
  });

  it('cross-links at least three relationship pairs', () => {
    let pairs = 0;
    for (const a of spec.npcs) {
      for (const r of a.relationships) {
        const b = spec.npcs.find((n) => n.id === r.npcId);
        if (b && a.id < b.id && b.relationships.some((x) => x.npcId === a.id)) pairs++;
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(3);
  });

  it('quest reveals point at real secrets', () => {
    let revealed = 0;
    for (const s of spec.quest.steps) {
      for (const r of s.reveals ?? []) {
        const [id, idx] = r.split(':');
        const npc = spec.npcs.find((n) => n.id === id);
        expect(npc).toBeDefined();
        expect(Number(idx)).toBeLessThan(npc?.secrets.length ?? 0);
        revealed++;
      }
    }
    expect(revealed).toBeGreaterThanOrEqual(2);
  });
});

describe('western specifics', () => {
  const w = FIXTURES.western;
  it('matches the brief', () => {
    expect(w.buildings.map((b) => b.role).sort()).toEqual(
      ['saloon', 'sheriff', 'bank', 'general_store', 'church', 'stable', 'hotel', 'undertaker', 'house'].sort(),
    );
    expect(w.npcs).toHaveLength(7);
    expect(w.quest.steps.length).toBeGreaterThanOrEqual(6);
    expect(w.quest.steps.length).toBeLessThanOrEqual(7);
    expect(w.quest.steps.filter((s) => s.kind === 'choose')).toHaveLength(1);
    expect(w.quest.endings).toHaveLength(2);
    expect(w.rules).toHaveLength(3);
    expect(w.lexicon.length).toBeGreaterThanOrEqual(8);
    expect(w.lexicon.length).toBeLessThanOrEqual(10);
  });
  it('bartender works at the saloon, sheriff enforces the ban', () => {
    expect(w.npcs.find((n) => n.role === 'bartender')?.work).toBe('saloon');
    const ban = w.rules.find((r) => r.effect.type === 'ban');
    expect(ban?.effect.type === 'ban' && ban.effect.enforcer).toBe('sheriff_cole');
  });
});

describe('other fixtures meet the brief', () => {
  it('building and NPC counts', () => {
    expect(FIXTURES.medieval.buildings).toHaveLength(8);
    expect(FIXTURES.medieval.npcs).toHaveLength(6);
    expect(FIXTURES.scifi.buildings.map((b) => b.role).sort()).toEqual(
      ['lab', 'hangar', 'cantina', 'command', 'habitat', 'reactor', 'warehouse', 'station'].sort(),
    );
    expect(FIXTURES.scifi.npcs).toHaveLength(6);
    expect(FIXTURES.modern.buildings.map((b) => b.role).sort()).toEqual(
      ['cafe', 'office', 'shop', 'garage', 'apartment', 'station', 'school', 'house'].sort(),
    );
    expect(FIXTURES.modern.npcs).toHaveLength(6);
  });
});

describe('nearestTheme', () => {
  const cases: [string, ThemeId][] = [
    ['a cowboy town with a saloon and a sheriff', 'western'],
    ['gold rush camp in 1849 nevada', 'western'],
    ['outlaws on a dusty ranch in the desert', 'western'],
    ['Wild West frontier, 1881', 'western'],
    ['a castle town ruled by a king', 'medieval'],
    ['viking raiders and a market village', 'medieval'],
    ['a tavern near the monastery with a dragon legend', 'medieval'],
    ['pirate harbor with a blacksmith', 'medieval'],
    ['a knight guards the village market', 'medieval'],
    ['a mining colony on mars', 'scifi'],
    ['neon cyber district with robot bartenders', 'scifi'],
    ['space station orbiting an alien moon', 'scifi'],
    ['a future city in 2204', 'scifi'],
    ['a cafe by the beach today', 'modern'],
    ['suburb with an office and a school', 'modern'],
    ['small city in 1987', 'modern'],
    ['coastal town, 2019', 'modern'],
    ['school day in a busy city', 'modern'],
    ['a wizard and an elf in a magic kingdom', 'medieval'],
    ['fantasy village in the middle ages', 'medieval'],
    ['victorian witch hunt', 'medieval'],
    ['sci-fi steampunk airship harbor', 'scifi'],
    ['android uprising on a galactic starship', 'scifi'],
    ['cyberpunk orbital elevator', 'scifi'],
    ['a modern seaside harbour town', 'modern'],
    ['contemporary downtown noir', 'modern'],
    ['something peaceful', 'western'],
    ['', 'western'],
  ];
  it.each(cases)('%s -> %s', (prompt, theme) => {
    expect(nearestTheme(prompt)).toBe(theme);
  });
});
