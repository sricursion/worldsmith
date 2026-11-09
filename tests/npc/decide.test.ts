import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/src/world/state', () => ({
  activeRules: (state: { rules: unknown[] }) => state.rules,
}));

import { planTick } from '../../app/src/npc/brain';
import { buildQuestions, localFallback, sampleAction, type ChoiceQuestion } from '../../app/src/npc/decide';
import { makeRng } from '../../app/src/world/rng';
import { mkNpc, mkSpec, mkState, rule } from './fixtures';

const opts: ChoiceQuestion['options'] = [
  { id: 'continue', label: 'a' },
  { id: 'go_to', label: 'b', target: 'plaza' },
  { id: 'idle', label: 'c' },
];

function freq(probs: number[], tau: number, n = 2000): number[] {
  const npc = mkNpc({ temperament: { tau, bias: {} } });
  const rng = makeRng(7, `tau${tau}`);
  const counts = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = sampleAction(probs, opts, npc, rng);
    const idx = opts.findIndex((o) => o.id === a.id);
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return counts.map((c) => c / n);
}

describe('buildQuestions', () => {
  it('always has continue first and 3..5 options across many states', () => {
    const spec = mkSpec();
    for (let h = 0; h < 24; h += 1.5) {
      for (const near of [null, 'cole', 'mae']) {
        const state = mkState({ hour: h, npcMoods: h > 12 ? { cole: 'afraid' } : {} });
        const qs = buildQuestions(spec, state, planTick(spec, state), near);
        expect(qs).toHaveLength(2);
        for (const q of qs) {
          expect(q.options[0]?.id).toBe('continue');
          expect(q.options.length).toBeGreaterThanOrEqual(3);
          expect(q.options.length).toBeLessThanOrEqual(5);
          expect(new Set(q.options.map((o) => o.id)).size).toBe(q.options.length);
        }
      }
    }
  });

  it('offers talk_to only for an NPC in the same place', () => {
    const spec = mkSpec();
    const apart = mkState();
    const q1 = buildQuestions(spec, apart, planTick(spec, apart), null)[0];
    expect(q1?.options.some((o) => o.id === 'talk_to')).toBe(false);
    const together = mkState({ npcPlaces: { cole: 'saloon_1', mae: 'saloon_1' } });
    const q2 = buildQuestions(spec, together, planTick(spec, together), null)[0];
    expect(q2?.options.find((o) => o.id === 'talk_to')?.target).toBe('mae');
  });

  it('offers follow_player or investigate near the player, and flee only when afraid', () => {
    const spec = mkSpec();
    const state = mkState({ npcMoods: { cole: 'afraid' } });
    const [cole, mae] = buildQuestions(spec, state, planTick(spec, state), 'cole');
    expect(cole?.options.some((o) => o.id === 'follow_player' || o.id === 'investigate')).toBe(true);
    expect(cole?.options.some((o) => o.id === 'flee')).toBe(true);
    expect(mae?.options.some((o) => o.id === 'flee' || o.id === 'follow_player')).toBe(false);
  });

  it('names the hour, place, mood and rules in one sentence', () => {
    const spec = mkSpec();
    const r = rule('c1', { type: 'curfew', fromHour: 0, toHour: 23, exemptRoles: [] }, 'No one on the street after dark.');
    const state = mkState({ hour: 9.5, rules: [r], npcMoods: { cole: 'tense' } });
    const q = buildQuestions(spec, state, planTick(spec, state), null)[0];
    expect(q?.question).toContain('9:30');
    expect(q?.question).toContain('The Jail');
    expect(q?.question).toContain('tense');
    expect(q?.question).toContain('No one on the street after dark');
    expect(q?.question.match(/;/g)?.length).toBe(1);
  });

  it('explains a curfew in the continue reason', () => {
    const spec = mkSpec();
    const r = rule('c1', { type: 'curfew', fromHour: 0, toHour: 23, exemptRoles: [] });
    const state = mkState({ rules: [r] });
    const q = buildQuestions(spec, state, planTick(spec, state), null)[0];
    const a = sampleAction([1, 0, 0], q?.options ?? [], mkNpc(), makeRng(1));
    expect(a.id).toBe('continue');
    expect(a.reason).toContain('curfew');
  });
});

describe('sampleAction', () => {
  it('tau 0.3 concentrates on the argmax', () => {
    const f = freq([0.5, 0.3, 0.2], 0.3);
    expect(f[0]).toBeGreaterThan(0.75);
  });
  it('tau 3 flattens the distribution', () => {
    const f = freq([0.7, 0.2, 0.1], 3);
    for (const x of f) {
      expect(x).toBeGreaterThan(0.2);
      expect(x).toBeLessThan(0.5);
    }
  });
  it('tau 1 follows the probabilities', () => {
    const f = freq([0.6, 0.3, 0.1], 1);
    expect(f[0]).toBeGreaterThan(0.55);
    expect(f[0]).toBeLessThan(0.65);
    expect(f[2]).toBeLessThan(0.15);
  });
  it('bias shifts the choice', () => {
    const npc = mkNpc({ temperament: { tau: 1, bias: { idle: 5 } } });
    const rng = makeRng(3);
    let idle = 0;
    for (let i = 0; i < 200; i++) if (sampleAction([0.4, 0.4, 0.2], opts, npc, rng).id === 'idle') idle++;
    expect(idle).toBeGreaterThan(180);
  });
  it('survives zeros, short vectors and tiny tau', () => {
    const rng = makeRng(5);
    expect(sampleAction([0, 0, 0], opts, mkNpc(), rng).id).toBeTruthy();
    expect(sampleAction([], opts, mkNpc(), rng).id).toBeTruthy();
    const sharp = mkNpc({ temperament: { tau: 0.01, bias: {} } });
    expect(sampleAction([0.01, 0.98, 0.01], opts, sharp, rng).id).toBe('go_to');
  });
  it('carries the option target through', () => {
    const a = sampleAction([0, 1, 0], opts, mkNpc(), makeRng(1));
    expect(a).toMatchObject({ id: 'go_to', target: 'plaza' });
  });
});

describe('localFallback', () => {
  it('picks continue about 70% of the time and spreads the rest evenly', () => {
    const q: ChoiceQuestion = { npcId: 'cole', question: 'q', options: opts };
    const rng = makeRng(11);
    const npc = mkNpc();
    const n = 4000;
    const c: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const a = localFallback(q, npc, rng);
      c[a.id] = (c[a.id] ?? 0) + 1;
    }
    expect((c['continue'] ?? 0) / n).toBeGreaterThan(0.67);
    expect((c['continue'] ?? 0) / n).toBeLessThan(0.73);
    expect((c['go_to'] ?? 0) / n).toBeGreaterThan(0.12);
    expect((c['go_to'] ?? 0) / n).toBeLessThan(0.18);
    expect((c['idle'] ?? 0) / n).toBeGreaterThan(0.12);
  });
  it('handles a single option', () => {
    const q: ChoiceQuestion = { npcId: 'cole', question: 'q', options: [{ id: 'continue', label: 'x' }] };
    expect(localFallback(q, mkNpc(), makeRng(1)).id).toBe('continue');
  });
});
