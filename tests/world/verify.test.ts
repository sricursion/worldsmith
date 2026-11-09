import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../../app/src/world/fixtures';
import { repairQuest, verifyQuest } from '../../app/src/world/verify';
import type { WorldSpec } from '../../app/src/world/spec';

const western = (): WorldSpec => structuredClone(FIXTURES.western);

describe('verifyQuest', () => {
  it('returns a valid completion order for the western quest', () => {
    const rep = verifyQuest(FIXTURES.western);
    expect(rep.winnable).toBe(true);
    const pos = new Map(rep.order.map((id, i) => [id, i]));
    for (const id of rep.order) {
      const step = FIXTURES.western.quest.steps.find((s) => s.id === id)!;
      for (const r of step.requires) expect(pos.get(r)).toBeLessThan(pos.get(id)!);
    }
    expect(rep.order[0]).toBe('report');
    expect(rep.order.indexOf('find_chest')).toBeLessThan(rep.order.indexOf(rep.order[rep.order.length - 1]!));
  });

  it('catches a requires cycle', () => {
    const s = western();
    s.quest.steps[0]!.requires = ['confront_pike'];
    const rep = verifyQuest(s);
    expect(rep.problems.join('\n')).toMatch(/cycle/);
    expect(rep.winnable).toBe(false);
  });

  it('catches an unknown requires id', () => {
    const s = western();
    s.quest.steps[2]!.requires = ['ghost'];
    const rep = verifyQuest(s);
    expect(rep.problems.join('\n')).toMatch(/unknown step "ghost"/);
    expect(rep.unreachable).toContain('find_chest');
  });

  it('catches a target of the wrong kind', () => {
    const s = western();
    s.quest.steps[1]!.target = 'bank';
    const rep = verifyQuest(s);
    expect(rep.problems.join('\n')).toMatch(/not an NPC/);
    expect(rep.winnable).toBe(false);
  });

  it('catches a fetch item with no reachable holder', () => {
    const s = western();
    s.items[0]!.holder = 'ghost';
    const rep = verifyQuest(s);
    expect(rep.problems.join('\n')).toMatch(/not in town/);
    expect(rep.winnable).toBe(false);
  });

  it('catches a deliver whose item is never fetched', () => {
    const s = western();
    s.quest.steps = s.quest.steps.filter((x) => x.id !== 'find_chest');
    s.quest.steps.forEach((x) => (x.requires = x.requires.filter((r) => r !== 'find_chest')));
    s.quest.steps.find((x) => x.id === 'confront_pike')!.requires = ['stable_tip'];
    const rep = verifyQuest(s);
    expect(rep.problems.join('\n')).toMatch(/nothing fetches "payroll_chest"/);
    expect(rep.winnable).toBe(false);
  });

  it('catches a missing giver step, a bad ending and a town-wide talking ban', () => {
    const noGiverStep = western();
    noGiverStep.quest.steps = noGiverStep.quest.steps.filter((x) => x.id !== 'report');
    noGiverStep.quest.steps.forEach((x) => (x.requires = x.requires.filter((r) => r !== 'report')));
    noGiverStep.quest.giver = 'drifter_jed';
    expect(verifyQuest(noGiverStep).problems.join('\n')).toMatch(/giver .* has no step/);

    const badEnding = western();
    badEnding.quest.endings = [{ stepId: 'nope', label: 'x', tone: 'good' }];
    const rep = verifyQuest(badEnding);
    expect(rep.problems.join('\n')).toMatch(/unknown step "nope"/);
    expect(rep.winnable).toBe(false);

    const banned = western();
    banned.rules.push({ id: 'silence', text: 'No talking anywhere.', effect: { type: 'ban', what: 'talking', where: 'town' }, source: 'player' });
    const r2 = verifyQuest(banned);
    expect(r2.problems.join('\n')).toMatch(/banned|spoken/);
    expect(r2.winnable).toBe(false);
  });

  it('does not treat a curfew as a blocker', () => {
    const s = western();
    s.rules.push({ id: 'total', text: 'Everyone inside.', effect: { type: 'curfew', fromHour: 0, toHour: 23, exemptRoles: [] }, source: 'player' });
    expect(verifyQuest(s).winnable).toBe(true);
  });
});

describe('repairQuest', () => {
  it('leaves a healthy quest alone', () => {
    const fixed = repairQuest(FIXTURES.modern);
    expect(fixed.quest).toEqual(FIXTURES.modern.quest);
  });

  it('makes a broken quest winnable', () => {
    const s = western();
    s.quest.steps[1]!.target = 'ghost'; // stable_tip
    s.items[0]!.holder = 'ghost';
    s.quest.steps[2]!.requires = ['stable_tip', 'phantom'];
    s.quest.endings = [{ stepId: 'nope', label: 'x', tone: 'good' }];
    expect(verifyQuest(s).winnable).toBe(false);

    const fixed = repairQuest(s);
    const rep = verifyQuest(fixed);
    expect(rep.problems).toEqual([]);
    expect(rep.winnable).toBe(true);
    expect(fixed.items[0]!.holder).toBe('sheriff_cole');
    expect(fixed.quest.endings.length).toBeGreaterThanOrEqual(1);
  });

  it('adds a fallback ending on the last step when none exists', () => {
    const s = western();
    s.quest.endings = [];
    const fixed = repairQuest(s);
    expect(fixed.quest.endings).toHaveLength(1);
    expect(verifyQuest(fixed).winnable).toBe(true);
  });

  it('synthesises a fetch for an unsupplied deliver and breaks cycles', () => {
    const s = western();
    s.quest.steps = s.quest.steps.filter((x) => x.id !== 'find_chest');
    s.quest.steps.find((x) => x.id === 'confront_pike')!.requires = ['stable_tip'];
    s.quest.steps.find((x) => x.id === 'report')!.requires = ['stable_tip'];
    const fixed = repairQuest(s);
    const rep = verifyQuest(fixed);
    expect(rep.problems).toEqual([]);
    expect(rep.winnable).toBe(true);
    expect(fixed.quest.steps.some((x) => x.kind === 'fetch' && x.target === 'payroll_chest')).toBe(true);
  });

  it('re-adds an opening step for the giver', () => {
    const s = western();
    s.quest.steps = s.quest.steps.filter((x) => x.id !== 'report');
    s.quest.steps.forEach((x) => (x.requires = x.requires.filter((r) => r !== 'report')));
    s.quest.giver = 'widow_marsh';
    const fixed = repairQuest(s);
    expect(verifyQuest(fixed).winnable).toBe(true);
    expect(fixed.quest.steps[0]!.target).toBe('widow_marsh');
  });

  it('does not mutate its input', () => {
    const s = western();
    s.quest.steps[1]!.target = 'ghost';
    const copy = structuredClone(s);
    repairQuest(s);
    expect(s).toEqual(copy);
  });
});
