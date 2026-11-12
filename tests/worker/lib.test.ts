import { describe, expect, it } from 'vitest';
import { addUsage, DAILY_TOKEN_BUDGET, freshBudget, isExhausted, parseBudget, remaining } from '../../worker/src/lib/budget';
import { originAllowed } from '../../worker/src/lib/http';
import { eventFromFrame } from '../../worker/src/lib/anthropic';
import { mockRules, parseHour } from '../../worker/src/lib/mockrules';
import { formatSse, parseSseBuffer } from '../../worker/src/lib/sse';
import { buildTypesafeBody, mockProbs, parseTypesafe } from '../../worker/src/lib/typesafe';
import { looksLikeSpec, validateCompile, validateNpcSay, validatePatch, validateTick } from '../../worker/src/lib/validate';
import { rulesJsonSchema, sanitizeRules } from '../../worker/src/prompts/rules';
import { mockNpcLine, npcSystemBlocks, npcUserMessage } from '../../worker/src/prompts/npc';

const npcBody = () => ({
  sessionId: 'abc_123',
  npc: {
    id: 'sheriff_cole',
    name: 'Cole',
    role: 'sheriff',
    persona: 'A weary lawman with a hidden gambling debt and a soft spot for strays.',
    knowledge: ['The bank was robbed Tuesday.'],
    revealed: [],
    mood: 'tense',
    place: 'sheriff_1',
  },
  context: {
    title: 'Dry Gulch',
    era: '1874',
    theme: 'western',
    lexicon: ['bits'],
    hour: 14.5,
    day: 1,
    rules: ['No guns in the saloon'],
    activeBeats: [{ stepId: 's1', objective: 'Find the thief', beat: 'Cole hints at the stable' }],
    recentLog: [],
  },
  history: [{ speaker: 'player', text: 'hello' }],
  playerText: 'Who robbed the bank?',
});

describe('validateCompile', () => {
  it('accepts a prompt and normalises the seed', () => {
    const r = validateCompile({ prompt: '  a dusty town ', seed: -5.7 });
    expect(r).toEqual({ ok: true, value: { prompt: 'a dusty town', seed: 5 } });
  });
  it('rejects bad bodies', () => {
    expect(validateCompile(null).ok).toBe(false);
    expect(validateCompile({ prompt: '', seed: 1 }).ok).toBe(false);
    expect(validateCompile({ prompt: 'x'.repeat(601), seed: 1 }).ok).toBe(false);
    expect(validateCompile({ prompt: 'ok', seed: 'nope' }).ok).toBe(false);
  });
});

describe('validateNpcSay', () => {
  it('accepts a full request and trims history to 8', () => {
    const b = npcBody();
    b.history = Array.from({ length: 12 }, (_, i) => ({ speaker: i % 2 ? 'npc' : 'player', text: `t${i}` }));
    const r = validateNpcSay(b);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.history).toHaveLength(8);
  });
  it('rejects bad mood, empty text, bad session', () => {
    expect(validateNpcSay({ ...npcBody(), npc: { ...npcBody().npc, mood: 'sleepy' } }).ok).toBe(false);
    expect(validateNpcSay({ ...npcBody(), playerText: '' }).ok).toBe(false);
    expect(validateNpcSay({ ...npcBody(), sessionId: 'a b' }).ok).toBe(false);
  });
});

describe('validateTick and validatePatch', () => {
  it('requires at least two options', () => {
    const base = { sessionId: 's1', stateSummary: 'x', questions: [{ npcId: 'a', question: 'q', options: ['one'] }] };
    expect(validateTick(base).ok).toBe(false);
    expect(validateTick({ ...base, questions: [{ npcId: 'a', question: 'q', options: ['one', 'two'] }] }).ok).toBe(true);
  });
  it('validates patch bodies', () => {
    expect(validatePatch({ sessionId: 's1', ruleText: 'no guns', summary: '' }).ok).toBe(true);
    expect(validatePatch({ sessionId: 's1', ruleText: '', summary: '' }).ok).toBe(false);
  });
  it('looksLikeSpec is structural', () => {
    expect(looksLikeSpec({ title: 't', theme: 'western', buildings: [], npcs: [], quest: {} })).toBe(true);
    expect(looksLikeSpec({ title: 't' })).toBe(false);
  });
});

describe('SSE framing', () => {
  it('formats single-line frames', () => {
    expect(formatSse('partial', { text: 'a\nb' })).toBe('event: partial\ndata: {"text":"a\\nb"}\n\n');
  });
  it('parses frames split across chunks and keeps the remainder', () => {
    const a = parseSseBuffer('event: x\ndata: {"n":1}\n\nevent: y\nda');
    expect(a.frames).toEqual([{ event: 'x', data: '{"n":1}' }]);
    const b = parseSseBuffer(a.rest + 'ta: 2\n\n');
    expect(b.frames).toEqual([{ event: 'y', data: '2' }]);
    expect(b.rest).toBe('');
  });
  it('handles CRLF, comments and default event name', () => {
    const r = parseSseBuffer(': ping\r\n\r\ndata: hi\r\n\r\n');
    expect(r.frames).toEqual([{ event: 'message', data: 'hi' }]);
  });
  it('maps Anthropic frames', () => {
    expect(eventFromFrame({ event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}' })).toEqual({ kind: 'text', text: 'hi' });
    expect(eventFromFrame({ event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}' })).toBeNull();
    expect(eventFromFrame({ event: 'message_delta', data: '{"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":9}}' })).toEqual({ kind: 'stop', reason: 'refusal', outputTokens: 9 });
    expect(eventFromFrame({ event: 'error', data: '{"type":"error","error":{"type":"overloaded_error"}}' })).toEqual({ kind: 'error', message: 'overloaded_error' });
  });
});

describe('origin check', () => {
  const u = new URL('https://worldsmith.example/api/compile');
  it('allows no origin and same host', () => {
    expect(originAllowed(null, u)).toBe(true);
    expect(originAllowed('https://worldsmith.example', u)).toBe(true);
  });
  it('rejects other hosts, including localhost against a public host', () => {
    expect(originAllowed('https://evil.example', u)).toBe(false);
    expect(originAllowed('http://localhost:5173', u)).toBe(false);
  });
  it('allows a local dev origin against a local worker', () => {
    expect(originAllowed('http://localhost:5173', new URL('http://127.0.0.1:8787/api/health'))).toBe(true);
  });
});

describe('budget arithmetic', () => {
  const now = 1_000_000;
  it('starts fresh and accumulates', () => {
    let r = parseBudget(null, now);
    expect(r).toEqual(freshBudget(now));
    r = addUsage(r, 120_000);
    r = addUsage(r, 180_000);
    expect(r.used).toBe(300_000);
    expect(isExhausted(r)).toBe(true);
    expect(remaining(r)).toBe(0);
  });
  it('is not exhausted below the cap', () => {
    expect(isExhausted({ used: DAILY_TOKEN_BUDGET - 1, resetAt: now + 10 })).toBe(false);
  });
  it('resets expired or corrupt records', () => {
    expect(parseBudget(JSON.stringify({ used: 999_999, resetAt: now - 1 }), now).used).toBe(0);
    expect(parseBudget('not json', now).used).toBe(0);
    expect(parseBudget(JSON.stringify({ used: 5, resetAt: now + 50 }), now).used).toBe(5);
  });
  it('ignores bad token counts', () => {
    expect(addUsage({ used: 5, resetAt: 1 }, -3).used).toBe(5);
    expect(addUsage({ used: 5, resetAt: 1 }, Number.NaN).used).toBe(5);
  });
});

describe('TypeSafe parser', () => {
  const qs = [
    { npcId: 'a', question: 'q1', options: ['continue', 'flee', 'idle'] },
    { npcId: 'b', question: 'q2', options: ['continue', 'work'] },
  ];
  it('reads shape A: array of {probabilities}', () => {
    const r = parseTypesafe([{ probabilities: [2, 1, 1] }, { probabilities: [0.25, 0.75] }], qs);
    expect(r).toEqual([[0.5, 0.25, 0.25], [0.25, 0.75]]);
  });
  it('reads shape B: {answers:[{distribution}]} as vector, map and entries', () => {
    const r = parseTypesafe(
      { answers: [{ distribution: { continue: 0.5, flee: 0.25, idle: 0.25 } }, { distribution: [{ option: 'work', probability: 3 }, { option: 'continue', probability: 1 }] }] },
      qs,
    );
    expect(r).toEqual([[0.5, 0.25, 0.25], [0.25, 0.75]]);
  });
  it('rejects wrong lengths, missing keys and empty distributions', () => {
    expect(parseTypesafe([{ probabilities: [1, 1] }, { probabilities: [1, 1] }], qs)).toBeNull();
    expect(parseTypesafe({ answers: [{ distribution: { continue: 1 } }, { distribution: [1, 1] }] }, qs)).toBeNull();
    expect(parseTypesafe([{ probabilities: [0, 0, 0] }, { probabilities: [1, 1] }], qs)).toBeNull();
    expect(parseTypesafe({ nope: true }, qs)).toBeNull();
    expect(parseTypesafe([{ probabilities: [1, 1, 1] }], qs)).toBeNull();
  });
  it('builds a choice question per NPC and a mock vector summing to 1 with first = 0.5', () => {
    const body = buildTypesafeBody({ sessionId: 's', stateSummary: 'sum', questions: qs }) as { model: string; state: string; questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }> };
    expect(body.model).toBe('jev-1.14.0');
    expect(body.state).toBe('sum');
    expect(Object.keys(body.questions)).toEqual(['q0', 'q1']);
    expect(body.questions['q0']?.type).toBe('choice');
    expect(Object.values(body.questions['q0']?.criteria ?? {})).toEqual(qs[0]?.options);
    // The reply is keyed the way the request was.
    const n = qs[0]?.options.length ?? 0;
    const probabilities = Object.fromEntries(Array.from({ length: n }, (_, j) => [`o${j}`, j === 0 ? 0.9 : 0.1 / Math.max(1, n - 1)]));
    const m = qs[1]?.options.length ?? 0;
    const second = Object.fromEntries(Array.from({ length: m }, (_, j) => [`o${j}`, 1 / m]));
    const read = parseTypesafe({ model: 'jev-1.14.0', answers: { q0: { type: 'choice', choice: 'o0', probabilities }, q1: { type: 'choice', probabilities: second } } }, qs);
    expect(read?.[0]?.[0]).toBeCloseTo(0.9, 6);
    expect(read?.[1]).toHaveLength(m);
    expect(parseTypesafe({ answers: { q0: { probabilities } } }, qs)).toBeNull();
    for (const p of mockProbs({ sessionId: 's', stateSummary: 'x', questions: qs })) {
      expect(p[0]).toBe(0.5);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });
});

describe('mock rule heuristic', () => {
  const summary = 'buildings: saloon_1 saloon, bank_1 bank; items: whisky_bottle';
  const eff = (t: string) => mockRules(t, summary)[0]?.effect;
  it('curfew', () => {
    expect(eff('Curfew after 9pm')).toMatchObject({ type: 'curfew', fromHour: 21 });
    expect(parseHour('after 9')).toBe(21);
    expect(parseHour('at 6am')).toBe(6);
  });
  it('ban', () => {
    expect(eff('No guns in the saloon')).toMatchObject({ type: 'ban', where: 'saloon_1' });
    expect(eff('Ban singing')).toMatchObject({ type: 'ban', what: 'singing', where: 'town' });
  });
  it('price', () => {
    expect(eff('Whisky should cost double')).toMatchObject({ type: 'price', multiplier: 2 });
    expect(eff('Make everything cheap')).toMatchObject({ type: 'price', multiplier: 0.5 });
  });
  it('mood', () => {
    expect(eff('Everyone is angry today')).toMatchObject({ type: 'mood', who: 'all', mood: 'angry' });
  });
  it('weather', () => {
    expect(eff('Let it rain')).toMatchObject({ type: 'weather', sky: 'overcast' });
    expect(eff('Make it night')).toMatchObject({ type: 'weather', sky: 'night' });
  });
  it('custom fallback, and a stable source and id', () => {
    const [r] = mockRules('The mayor owes me a favour', summary);
    expect(r?.effect).toMatchObject({ type: 'custom' });
    expect(r?.source).toBe('player');
    expect(mockRules('The mayor owes me a favour', summary)[0]?.id).toBe(r?.id);
  });
});

describe('rules schema and sanitiser', () => {
  it('schema is closed and lists all nine effects', () => {
    const s = rulesJsonSchema() as { additionalProperties: boolean; properties: { rules: { items: { properties: { effect: { anyOf: unknown[] } } } } } };
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.rules.items.properties.effect.anyOf).toHaveLength(9);
  });
  it('clamps, drops invalid entries, caps at three and uniquifies ids', () => {
    const raw = {
      rules: [
        { id: 'a', text: 't', effect: { type: 'price', item: 'x', multiplier: 99 }, source: 'player' },
        { id: 'a', text: 't', effect: { type: 'ban', what: 'w', where: 'town', enforcer: '' }, source: 'player' },
        { id: 'c', text: 't', effect: { type: 'mood', who: 'all', mood: 'sleepy' }, source: 'player' },
        { id: 'd', text: 't', effect: { type: 'weather', sky: 'night', fog: 3 }, source: 'player' },
        { id: 'e', text: 't', effect: { type: 'custom', summary: 's' }, source: 'player' },
      ],
    };
    const out = sanitizeRules(raw);
    expect(out.map((r) => r.id)).toEqual(['rule_a', 'rule_a_2', 'rule_d']);
    expect(out[0]?.effect).toMatchObject({ multiplier: 5 });
    expect(out[1]?.effect).toEqual({ type: 'ban', what: 'w', where: 'town' });
    expect(out[2]?.effect).toMatchObject({ fog: 1 });
  });
});

describe('npc prompts', () => {
  it('puts cache_control on the bible only and keeps the persona separate', () => {
    const blocks = npcSystemBlocks(npcBody() as never);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[1]?.cache_control).toBeUndefined();
    expect(blocks[0]?.text.length).toBeGreaterThan(2000);
    expect(blocks[1]?.text).toContain('Cole');
  });
  it('keeps mutable context in the user turn', () => {
    const u = npcUserMessage(npcBody() as never);
    expect(u).toContain('14:30');
    expect(u).toContain('Who robbed the bank?');
  });
  it('mock line is deterministic and in character', () => {
    const a = mockNpcLine(npcBody() as never);
    expect(a).toBe(mockNpcLine(npcBody() as never));
    expect(a.length).toBeGreaterThan(20);
  });
});
