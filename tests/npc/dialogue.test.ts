import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/src/world/state', () => ({
  activeRules: (state: { rules: unknown[] }) => state.rules,
}));

import { cannedLine, gestureFor, MOODS, normalizeLine, openDialogue, parseLine, speechOf, validateLine } from '../../app/src/npc/dialogue';
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
  it('keeps short actions, drops actions over 60 characters, and needs speech', () => {
    expect(validateLine('*tips hat* Evening, friend.')).toEqual({ ok: true, cleaned: '*tips hat* Evening, friend.' });
    expect(validateLine('[nods] Evening.').cleaned).toBe('*nods* Evening.');
    const long = `*${'slowly leans across the bar and lowers his voice'.padEnd(70, ' x')}* Evening.`;
    expect(validateLine(long)).toEqual({ ok: true, cleaned: 'Evening.' });
    expect(validateLine(`*${'a'.repeat(60)}* Evening.`).cleaned).toBe(`*${'a'.repeat(60)}* Evening.`);
    expect(validateLine('*tips hat slowly*').ok).toBe(false);
    expect(validateLine(`[${'a'.repeat(61)}]`).ok).toBe(false);
  });
  it('repairs an unterminated action run into the speech', () => {
    expect(validateLine("*tips hat slow, keeps one eye on the roadNot now, friend.").cleaned).toBe('*tips hat slow, keeps one eye on the road* Not now, friend.');
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

describe('parseLine', () => {
  it('splits the unterminated run into action and the canned fallback line (exact example a)', () => {
    expect(parseLine("*tips hat slow, keeps one eye on the roadNot now, friend. Come back when the street's quieter.")).toEqual([
      { kind: 'action', text: 'tips hat slow, keeps one eye on the road' },
      { kind: 'speech', text: "Not now, friend. Come back when the street's quieter." },
    ]);
  });
  it('treats a terminated asterisk action as an action (exact example b)', () => {
    expect(parseLine('*leans on the plaza rail, grinning* Well, look at you...')).toEqual([
      { kind: 'action', text: 'leans on the plaza rail, grinning' },
      { kind: 'speech', text: 'Well, look at you...' },
    ]);
  });
  it('ends an unterminated action at sentence-ending punctuation', () => {
    expect(parseLine('*sighs. Fine, come in.')).toEqual([
      { kind: 'action', text: 'sighs' },
      { kind: 'speech', text: 'Fine, come in.' },
    ]);
  });
  it('handles leading parentheses and brackets, mid-line actions and plain speech', () => {
    expect(parseLine('(nods) Evening.')).toEqual([{ kind: 'action', text: 'nods' }, { kind: 'speech', text: 'Evening.' }]);
    expect(parseLine('[shrugs] Who knows.')).toEqual([{ kind: 'action', text: 'shrugs' }, { kind: 'speech', text: 'Who knows.' }]);
    expect(parseLine('Well *grins* then.')).toEqual([
      { kind: 'speech', text: 'Well' }, { kind: 'action', text: 'grins' }, { kind: 'speech', text: 'then.' },
    ]);
    expect(parseLine('I saw (him) leave.')).toEqual([{ kind: 'speech', text: 'I saw (him) leave.' }]);
    expect(parseLine('Hello there.')).toEqual([{ kind: 'speech', text: 'Hello there.' }]);
  });
  it('trims and drops empty segments, and copes with partial text', () => {
    expect(parseLine('   ')).toEqual([]);
    expect(parseLine('** **')).toEqual([]);
    expect(parseLine('*')).toEqual([]);
    expect(parseLine('*tips ha')).toEqual([{ kind: 'action', text: 'tips ha' }]);
  });
  it('speechOf and normalizeLine keep only what is said / rebuild the line', () => {
    expect(speechOf('*leans on the plaza rail, grinning* Well, look at you...')).toBe('Well, look at you...');
    expect(speechOf('*sighs*')).toBe('');
    expect(normalizeLine('(nods) Evening.')).toBe('*nods* Evening.');
    expect(normalizeLine(normalizeLine('*tips hat* Hi.'))).toBe('*tips hat* Hi.');
  });
});

describe('gestureFor', () => {
  it.each([
    ['tips hat slow', 'wave'], ['nods', 'wave'], ['waves', 'wave'], ['salutes', 'wave'],
    ['sits down', 'sit'], ['leans on the plaza rail, grinning', 'gesture'], ['slumps', 'gesture'],
    ['shrugs', 'gesture'], ['spreads hands', 'gesture'], ['gestures wide', 'gesture'],
    ['grins', 'cheer'], ['laughs', 'cheer'], ['cheers', 'cheer'],
    ['points east', 'use'], ['pours a drink', 'use'], ['wipes the bar', 'use'], ['polishes a glass', 'use'], ['counts coins', 'use'],
    ['glances at the door', 'look_around'], ['squints', 'look_around'], ['watches you', 'look_around'],
  ])('%s -> %s', (action, clip) => {
    expect(gestureFor(action)).toBe(clip);
  });
  it('is null when nothing matches', () => {
    expect(gestureFor('')).toBeNull();
    expect(gestureFor('hums quietly')).toBeNull();
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
    const s = openDialogue(spec, () => state, 'cole', api);
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

  it('reads the live state on every say and in the fallback', async () => {
    let current = state;
    const bodies: NpcSayRequest[] = [];
    const api = fakeApi(async (body) => {
      bodies.push(body);
      return bodies.length === 1 ? { ok: true, text: 'Fine.' } : { ok: false as const, error: 'x' };
    });
    const s = openDialogue(spec, () => current, 'cole', api);
    await s.say('one', () => undefined);
    expect(bodies[0]?.npc.revealed).toEqual(['Cole saw the thief.']);
    current = { ...state, flags: { ...state.flags, 'revealed:cole:0': true }, npcMoods: { cole: 'afraid' } };
    const r = await s.say('two', () => undefined);
    expect(bodies[1]?.npc.revealed).toEqual(['Cole owes the saloon money.', 'Cole saw the thief.']);
    expect(bodies[1]?.npc.mood).toBe('afraid');
    expect(r.source).toBe('fallback');
  });

  it('applies mood rules to the mood sent to the model', async () => {
    const withRule = { ...state, rules: [rule('m1', { type: 'mood', who: 'all', mood: 'angry' }, 'Everyone is angry.')] };
    let seen: NpcSayRequest | null = null;
    const api = fakeApi(async (body) => {
      seen = body;
      return { ok: true, text: 'Hmph.' };
    });
    await openDialogue(spec, () => withRule, 'cole', api).say('Hi', () => undefined);
    expect((seen as NpcSayRequest | null)?.npc.mood).toBe('angry');
  });

  it('keeps only the last 8 turns', async () => {
    const bodies: NpcSayRequest[] = [];
    const api = fakeApi(async (body) => {
      bodies.push(body);
      return { ok: true, text: 'Fine.' };
    });
    const s = openDialogue(spec, () => state, 'cole', api);
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
    const s = openDialogue(spec, () => state, 'cole', api);
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
      const s = openDialogue(spec, () => state, 'cole', fakeApi(impl));
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
    const s = openDialogue(spec, () => state, 'cole', api);
    await s.say('Hi', () => undefined);
    s.close();
    expect(signal?.aborted).toBe(true);
  });
});

describe('streaming contract', () => {
  const spec = mkSpec();
  const state = mkState({ unlockedSteps: [], completedSteps: [], flags: {}, rules: [], log: [] });

  it('only ever passes the full text so far, and a fallback replaces the partial line', async () => {
    const api = fakeApi(async (_b, onToken) => {
      onToken('*tips hat slow, ');
      onToken('keeps one eye on the road');
      return { ok: false, error: 'upstream' };
    });
    const s = openDialogue(spec, () => state, 'cole', api);
    const shown: string[] = [];
    let line = '';
    const r = await s.say('Hi', (full) => {
      shown.push(full);
      line = full; // the panel replaces the line with whatever it is given
    });
    expect(r.source).toBe('fallback');
    expect(shown[0]).toBe('*tips hat slow,*');
    expect(line).toBe(r.text);
    expect(line).not.toContain('tips hat');
    expect(parseLine(line).every((g) => g.kind === 'speech')).toBe(true);
  });

  it('each streamed call extends the previous full text', async () => {
    const api = fakeApi(async (_b, onToken) => {
      onToken('*nods* Ev');
      onToken('ening, friend.');
      return { ok: true, text: '*nods* Evening, friend.' };
    });
    const shown: string[] = [];
    await openDialogue(spec, () => state, 'cole', api).say('Hi', (f) => shown.push(f));
    expect(shown).toEqual(['*nods* Ev', '*nods* Evening, friend.', '*nods* Evening, friend.']);
  });
});
