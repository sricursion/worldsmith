import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/src/world/state', () => ({
  activeRules: (state: { rules: unknown[] }) => state.rules,
}));

import { cannedLine, MOODS, openDialogue, validateLine } from '../../app/src/npc/dialogue';
import type { Api } from '../../app/src/net/api';
import type { NpcSayRequest } from '../../app/src/net/types';
import { makeRng } from '../../app/src/world/rng';
import type { Mood } from '../../app/src/world/spec';
import { mkNpc, mkSpec, mkState, rule } from './fixtures';

describe('validateLine', () => {
  it('rejects empty and whitespace', () => {
    expect(validateLine('').ok).toBe(false);
    expect(validateLine('   \n ').reason).toBe('empty');
  });
  it('accepts a plain line', () => {
    expect(validateLine('Howdy, stranger.')).toEqual({ ok: true, cleaned: 'Howdy, stranger.' });
  });
  it.each([
    'Let me think about what the sheriff would say.',
    'Well. I should respond in character here.',
    'As an AI, I cannot do that.',
    'I am an AI model.',
    'This language model will answer.',
    'The user wants to know about the bank.',
    'The player wants a clue.',
    '<thinking>plan</thinking> Howdy.',
    'Reasoning: the NPC is calm. Howdy.',
  ])('rejects leak: %s', (line) => {
    const v = validateLine(line);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/leak/);
  });
  it('rejects a leak buried mid-text', () => {
    expect(validateLine('Howdy there. It is a fine day. Let me think about the bank.').ok).toBe(false);
  });
  it('keeps short stage directions and rejects long ones', () => {
    expect(validateLine('*tips hat* Evening, friend.').ok).toBe(true);
    expect(validateLine('[nods] Evening.').ok).toBe(true);
    const long = `*${'slowly leans across the bar and lowers his voice'.padEnd(50, ' x')}* Evening.`;
    expect(validateLine(long).ok).toBe(false);
    expect(validateLine(`[${'a'.repeat(45)}] Evening.`).ok).toBe(false);
  });
  it('strips surrounding quotes and a Name: prefix', () => {
    expect(validateLine('"Howdy, stranger."').cleaned).toBe('Howdy, stranger.');
    expect(validateLine('“Howdy.”').cleaned).toBe('Howdy.');
    expect(validateLine('Sheriff Cole: Howdy.').cleaned).toBe('Howdy.');
    expect(validateLine('Cole: "Howdy."').cleaned).toBe('Howdy.');
    expect(validateLine('Cole: Howdy.', 'Cole').cleaned).toBe('Howdy.');
    expect(validateLine('Warning: Howdy.', 'Cole').cleaned).toBe('Warning: Howdy.');
  });
  it('trims long lines at the last sentence end', () => {
    const sentence = 'The road east is washed out past the creek. ';
    const v = validateLine(sentence.repeat(30));
    expect(v.ok).toBe(true);
    expect(v.cleaned.length).toBeLessThanOrEqual(600);
    expect(v.cleaned.endsWith('.')).toBe(true);
  });
  it('trims a long line with no sentence end at a word boundary', () => {
    const v = validateLine('word '.repeat(200));
    expect(v.ok).toBe(true);
    expect(v.cleaned.length).toBeLessThanOrEqual(604);
  });
});

describe('cannedLine', () => {
  it('covers every Mood with 6 to 8 lines and substitutes the name', () => {
    const npc = mkNpc();
    const moods: Mood[] = ['calm', 'tense', 'cheerful', 'grieving', 'drunk', 'angry', 'afraid'];
    expect([...MOODS].sort()).toEqual([...moods].sort());
    for (const m of moods) {
      const seen = new Set<string>();
      const rng = makeRng(1, m);
      for (let i = 0; i < 400; i++) {
        const l = cannedLine(npc, m, rng);
        expect(l.length).toBeGreaterThan(5);
        expect(l).not.toContain('{name}');
        expect(validateLine(l).ok).toBe(true);
        seen.add(l);
      }
      expect(seen.size).toBeGreaterThanOrEqual(6);
      expect(seen.size).toBeLessThanOrEqual(8);
    }
  });
  it('uses the NPC name', () => {
    const rng = makeRng(2);
    const lines = Array.from({ length: 300 }, () => cannedLine(mkNpc({ name: 'Zeb' }), 'calm', rng));
    expect(lines.some((l) => l.includes('Zeb'))).toBe(true);
  });
});

function fakeApi(impl: Api['npcSay']): Api {
  const no = (): never => {
    throw new Error('unused');
  };
  return { compile: no, npcSay: impl, tick: no, patchRules: no, share: no, load: no, health: no } as unknown as Api;
}

describe('openDialogue', () => {
  const spec = mkSpec();
  const log = Array.from({ length: 8 }, (_, i) => ({ t: i, who: i % 2 ? 'cole' : 'mae', what: i % 2 ? `Cole did thing ${i}` : `Mae saw Cole at ${i}` }));
  log.push({ t: 99, who: 'mae', what: 'Mae sold a drink' });
  const state = mkState({
    unlockedSteps: ['s1', 's2'],
    completedSteps: [],
    flags: { 'revealed:cole:1': true },
    rules: [rule('r1', { type: 'custom', summary: 's' }, 'No guns in the saloon.')],
    log,
  });

  it('builds a trimmed request and records history on success', async () => {
    let seen: NpcSayRequest | null = null;
    const api = fakeApi(async (body, onToken) => {
      seen = body;
      onToken('Howdy');
      onToken('Howdy there.');
      return { ok: true, text: '"Howdy there."' };
    });
    const s = openDialogue(spec, state, 'cole', api);
    const partials: string[] = [];
    const r = await s.say('Hello', (p) => partials.push(p));
    expect(r).toEqual({ text: 'Howdy there.', source: 'model' });
    expect(partials[partials.length - 1]).toBe('Howdy there.');
    expect(s.history).toEqual([{ speaker: 'player', text: 'Hello' }, { speaker: 'npc', text: 'Howdy there.' }]);
    const req = seen as NpcSayRequest | null;
    expect(req?.npc.revealed).toEqual(['Cole saw the thief.']);
    expect(req?.context.rules).toEqual(['No guns in the saloon.']);
    expect(req?.context.activeBeats.map((b) => b.stepId)).toEqual(['s1']);
    expect(req?.context.recentLog.length).toBe(5);
    expect(req?.npc.place).toBe('jail_1');
    expect(req?.playerText).toBe('Hello');
  });

  it('keeps only the last 8 turns', async () => {
    const bodies: NpcSayRequest[] = [];
    const api = fakeApi(async (body) => {
      bodies.push(body);
      return { ok: true, text: 'Fine.' };
    });
    const s = openDialogue(spec, state, 'cole', api);
    for (let i = 0; i < 7; i++) await s.say(`q${i}`, () => undefined);
    expect(s.history.length).toBe(8);
    expect(bodies[6]?.history.length).toBe(8);
    expect(s.history[s.history.length - 2]?.text).toBe('q6');
  });

  it('stops showing text once a leak appears mid-stream and falls back on a bad final line', async () => {
    const api = fakeApi(async (_b, onToken) => {
      onToken('Howdy. ');
      onToken('Let me think about');
      onToken(' what to say.');
      return { ok: true, text: 'Howdy. Let me think about what to say.' };
    });
    const s = openDialogue(spec, state, 'cole', api);
    const partials: string[] = [];
    const r = await s.say('Hi', (p) => partials.push(p));
    expect(r.source).toBe('fallback');
    expect(partials.some((p) => p.toLowerCase().includes('let me think'))).toBe(false);
    expect(partials[partials.length - 1]).toBe(r.text);
    expect(s.history[1]).toEqual({ speaker: 'npc', text: r.text });
  });

  it('falls back on refusal, error and thrown exceptions', async () => {
    for (const impl of [
      async () => ({ ok: false as const, error: 'x', refusal: true }),
      async () => ({ ok: false as const, error: 'timeout' }),
      async (): Promise<never> => {
        throw new Error('network');
      },
    ]) {
      const s = openDialogue(spec, state, 'cole', fakeApi(impl));
      const r = await s.say('Hi', () => undefined);
      expect(r.source).toBe('fallback');
      expect(r.text.length).toBeGreaterThan(0);
      expect(s.history.length).toBe(2);
    }
  });

  it('close aborts the request signal', async () => {
    let signal: AbortSignal | undefined;
    const api = fakeApi(async (_b, _t, sig) => {
      signal = sig;
      return { ok: true, text: 'ok.' };
    });
    const s = openDialogue(spec, state, 'cole', api);
    await s.say('Hi', () => undefined);
    s.close();
    expect(signal?.aborted).toBe(true);
  });
});
