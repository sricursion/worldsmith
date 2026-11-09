import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/src/world/state', () => ({
  activeRules: (state: { rules: unknown[] }) => state.rules,
}));

import { planTick, scheduleEntryAt, whereShouldBe } from '../../app/src/npc/brain';
import { mkNpc, mkSpec, mkState, rule } from './fixtures';

describe('schedule lookup', () => {
  const npc = mkNpc();
  it('picks the greatest hour <= now', () => {
    expect(scheduleEntryAt(npc, 8)?.place).toBe('jail_1');
    expect(scheduleEntryAt(npc, 12.5)?.place).toBe('jail_1');
    expect(scheduleEntryAt(npc, 18)?.place).toBe('saloon_1');
    expect(scheduleEntryAt(npc, 23.9)?.place).toBe('house_1');
  });
  it('wraps to the last entry before the first hour', () => {
    expect(scheduleEntryAt(npc, 3)?.activity).toBe('sleep');
    expect(whereShouldBe(npc, 0, []).place).toBe('house_1');
  });
  it('works with an unsorted schedule', () => {
    const shuffled = mkNpc({ schedule: [...npc.schedule].reverse() });
    expect(scheduleEntryAt(shuffled, 9)?.place).toBe('jail_1');
  });
});

describe('rule overrides', () => {
  const npc = mkNpc();
  it('curfew sends non-exempt roles home to sleep', () => {
    const r = rule('c1', { type: 'curfew', fromHour: 20, toHour: 5, exemptRoles: [] });
    expect(whereShouldBe(npc, 21, [r])).toMatchObject({ place: 'house_1', activity: 'sleep', reason: 'curfew' });
    expect(whereShouldBe(npc, 3, [r]).reason).toBe('curfew');
    expect(whereShouldBe(npc, 12, [r]).reason).toBe('schedule');
  });
  it('exempt roles ignore the curfew', () => {
    const r = rule('c1', { type: 'curfew', fromHour: 20, toHour: 5, exemptRoles: ['Sheriff'] });
    const i = whereShouldBe(npc, 21, [r]);
    expect(i.reason).toBe('schedule');
    expect(i.place).toBe('saloon_1');
  });
  it('schedule_override wins over curfew', () => {
    const o = rule('o1', { type: 'schedule_override', who: 'cole', entry: { hour: 0, place: 'plaza', activity: 'guard' } });
    const c = rule('c1', { type: 'curfew', fromHour: 0, toHour: 23, exemptRoles: [] });
    const i = whereShouldBe(npc, 12, [c, o]);
    expect(i).toMatchObject({ place: 'plaza', activity: 'guard' });
    expect(i.reason).toContain('o1');
  });
  it('schedule_override for someone else is ignored', () => {
    const o = rule('o1', { type: 'schedule_override', who: 'mae', entry: { hour: 0, place: 'plaza', activity: 'guard' } });
    expect(whereShouldBe(npc, 12, [o]).place).toBe('jail_1');
  });
  it('ban on alcohol turns away a drinker at the named place', () => {
    const b = rule('b1', { type: 'ban', what: 'alcohol', where: 'saloon_1' });
    const dusk = whereShouldBe(npc, 20, [b]);
    expect(dusk.place).toBe('house_1');
    expect(dusk.reason).toContain('alcohol');
    expect(dusk.reason).toContain('b1');
    const early = mkNpc({ schedule: [{ hour: 0, place: 'saloon_1', activity: 'drink' }] });
    expect(whereShouldBe(early, 14, [b])).toMatchObject({ place: 'street', activity: 'wander' });
  });
  it('ban does not touch unrelated activities or other places', () => {
    const b = rule('b1', { type: 'ban', what: 'alcohol', where: 'saloon_1' });
    expect(whereShouldBe(npc, 10, [b]).place).toBe('jail_1');
    const other = rule('b2', { type: 'ban', what: 'alcohol', where: 'church_1' });
    expect(whereShouldBe(npc, 19, [other]).place).toBe('saloon_1');
  });
  it('a gathering ban blocks non-work presence but not work', () => {
    const b = rule('b3', { type: 'ban', what: 'gathering', where: 'town' });
    expect(whereShouldBe(npc, 19, [b]).place).toBe('house_1');
    expect(whereShouldBe(npc, 10, [b]).place).toBe('jail_1');
  });
  it('afraid NPCs stay home after dusk', () => {
    const afraid = mkNpc({ mood: 'afraid' });
    expect(whereShouldBe(afraid, 19.5, []).place).toBe('house_1');
    expect(whereShouldBe(afraid, 10, []).place).toBe('jail_1');
    const m = rule('m1', { type: 'mood', who: 'all', mood: 'afraid' });
    expect(whereShouldBe(npc, 19.5, [m]).reason).toBe('afraid after dusk');
  });
});

describe('planTick', () => {
  it('gives one intent per NPC using state rules', () => {
    const spec = mkSpec();
    const c = rule('c1', { type: 'curfew', fromHour: 8, toHour: 12, exemptRoles: ['barkeep'] });
    const out = planTick(spec, mkState({ hour: 9, rules: [c] }));
    expect(out.map((i) => i.npcId)).toEqual(['cole', 'mae']);
    expect(out[0]?.reason).toBe('curfew');
    expect(out[1]?.reason).toBe('schedule');
  });
});
