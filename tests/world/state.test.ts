import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../../app/src/world/fixtures';
import { activeRules, applyEvent, createState } from '../../app/src/world/state';
import type { WorldEvent } from '../../app/src/world/state';
import type { WorldSpec, WorldState } from '../../app/src/world/spec';

const spec = FIXTURES.western;

function run(sp: WorldSpec, st: WorldState, evs: WorldEvent[]): { state: WorldState; completed: string[] } {
  let state = st;
  const completed: string[] = [];
  for (const ev of evs) {
    const r = applyEvent(sp, state, ev);
    state = r.state;
    completed.push(...r.completed);
  }
  return { state, completed };
}

describe('createState', () => {
  it('seeds hour, placement, items, rules and opening steps', () => {
    const s = createState(spec);
    expect(s.hour).toBe(9);
    expect(s.day).toBe(1);
    expect(s.npcPlaces.bartender_nell).toBe('hotel'); // asleep since 03:00
    expect(s.npcPlaces.sheriff_cole).toBe('sheriff');
    expect(s.npcPlaces.drifter_jed).toBe('street');
    expect(s.itemHolders.payroll_chest).toBe('church');
    expect(s.npcMoods.banker_pike).toBe('afraid');
    expect(s.rules.map((r) => r.id)).toEqual(spec.rules.map((r) => r.id));
    expect(s.unlockedSteps).toEqual(['report']);
    expect(s.completedSteps).toEqual([]);
  });

  it('places NPCs from the last entry before their first one', () => {
    const early = structuredClone(spec);
    early.time.startHour = 2;
    const s = createState(early);
    expect(s.npcPlaces.sheriff_cole).toBe('sheriff'); // 22:00 sleep entry wraps
    expect(s.npcPlaces.preacher_wells).toBe('church');
  });
});

describe('applyEvent', () => {
  it('is immutable', () => {
    const s0 = createState(spec);
    const snapshot = JSON.stringify(s0);
    const r = applyEvent(spec, s0, { type: 'talk', npcId: 'sheriff_cole' });
    expect(JSON.stringify(s0)).toBe(snapshot);
    expect(r.state).not.toBe(s0);
    expect(r.completed).toEqual(['report']);
    expect(r.unlocked).toEqual(['stable_tip']);
    expect(r.state.flags['revealed:sheriff_cole:0']).toBe(true);
  });

  it('ignores a step that is not unlocked yet', () => {
    const r = applyEvent(spec, createState(spec), { type: 'talk', npcId: 'banker_pike' });
    expect(r.completed).toEqual([]);
  });

  it('advances the clock and rolls the day', () => {
    let s = createState(spec);
    s = applyEvent(spec, s, { type: 'tick', dtHours: 15.5 }).state;
    expect(s.hour).toBeCloseTo(0.5);
    expect(s.day).toBe(2);
  });

  it('caps the log at 60 entries', () => {
    let s = createState(spec);
    for (let i = 0; i < 100; i++) s = applyEvent(spec, s, { type: 'npc_moved', npcId: 'drifter_jed', place: i % 2 ? 'saloon' : 'street' }).state;
    expect(s.log).toHaveLength(60);
    expect(s.npcPlaces.drifter_jed).toBe('saloon');
  });

  it('adds and removes rules, and updates moods', () => {
    let s = createState(spec);
    s = applyEvent(spec, s, { type: 'rule_add', rule: { id: 'r1', text: 'Dry town', effect: { type: 'ban', what: 'drinking', where: 'town' }, source: 'player' } }).state;
    expect(s.rules.some((r) => r.id === 'r1')).toBe(true);
    s = applyEvent(spec, s, { type: 'rule_remove', ruleId: 'r1' }).state;
    expect(s.rules.some((r) => r.id === 'r1')).toBe(false);
    s = applyEvent(spec, s, { type: 'npc_mood', npcId: 'drifter_jed', mood: 'angry' }).state;
    expect(s.npcMoods.drifter_jed).toBe('angry');
  });

  it('refuses to give an item the player does not hold', () => {
    const r = applyEvent(spec, createState(spec), { type: 'give', item: 'payroll_chest', to: 'sheriff_cole' });
    expect(r.state.itemHolders.payroll_chest).toBe('church');
  });

  it('walks the western quest to the lawful ending', () => {
    const { state, completed } = run(spec, createState(spec), [
      { type: 'talk', npcId: 'sheriff_cole' },
      { type: 'talk', npcId: 'stablehand_toby' },
      { type: 'pickup', item: 'payroll_chest' },
      { type: 'talk', npcId: 'banker_pike' },
      { type: 'choose', stepId: 'decide', choice: 0 },
      { type: 'give', item: 'payroll_chest', to: 'sheriff_cole' },
    ]);
    expect(completed).toEqual(['report', 'stable_tip', 'find_chest', 'confront_pike', 'decide', 'end_law']);
    expect(state.flags.questComplete).toBe(true);
    expect(state.flags.ending).toBe('end_law');
    expect(state.inventory).toEqual([]);
    expect(state.itemHolders.payroll_chest).toBe('sheriff_cole');
    expect(state.flags['revealed:banker_pike:1']).toBe(true);
    expect(state.flags['revealed:preacher_wells:0']).toBe(true);
  });

  it('gates the endings by the choice made', () => {
    const upToChoice: WorldEvent[] = [
      { type: 'talk', npcId: 'sheriff_cole' },
      { type: 'talk', npcId: 'stablehand_toby' },
      { type: 'pickup', item: 'payroll_chest' },
      { type: 'talk', npcId: 'banker_pike' },
    ];
    const base = run(spec, createState(spec), upToChoice).state;
    expect(base.unlockedSteps).toEqual(['decide']);

    const quiet = run(spec, base, [{ type: 'choose', stepId: 'decide', choice: 1 }]).state;
    expect(quiet.unlockedSteps).toEqual(['end_quiet']);
    // Handing it to the sheriff now does nothing for the quest.
    const wrong = applyEvent(spec, quiet, { type: 'give', item: 'payroll_chest', to: 'sheriff_cole' });
    expect(wrong.completed).toEqual([]);
    const done = run(spec, quiet, [{ type: 'give', item: 'payroll_chest', to: 'banker_pike' }]);
    expect(done.completed).toEqual(['end_quiet']);
    expect(done.state.flags.ending).toBe('end_quiet');
  });

  it('rejects bad choices', () => {
    const base = run(spec, createState(spec), [
      { type: 'talk', npcId: 'sheriff_cole' },
      { type: 'talk', npcId: 'stablehand_toby' },
      { type: 'pickup', item: 'payroll_chest' },
      { type: 'talk', npcId: 'banker_pike' },
    ]).state;
    expect(applyEvent(spec, base, { type: 'choose', stepId: 'decide', choice: 7 }).completed).toEqual([]);
    expect(applyEvent(spec, base, { type: 'choose', stepId: 'report', choice: 0 }).completed).toEqual([]);
  });

  it('counts an early pickup once the fetch step unlocks', () => {
    const early = run(spec, createState(spec), [{ type: 'pickup', item: 'payroll_chest' }]).state;
    expect(early.completedSteps).toEqual([]);
    const r = run(spec, early, [{ type: 'talk', npcId: 'sheriff_cole' }, { type: 'talk', npcId: 'stablehand_toby' }]);
    expect(r.completed).toEqual(['report', 'stable_tip', 'find_chest']);
    expect(r.state.unlockedSteps).toEqual(['confront_pike']);
  });

  it('completes visit steps (scifi)', () => {
    const sf = FIXTURES.scifi;
    const r = run(sf, createState(sf), [
      { type: 'talk', npcId: 'commander_vance' },
      { type: 'visit', buildingId: 'reactor' },
    ]);
    expect(r.completed).toEqual(['briefing', 'inspect_reactor']);
  });
});

describe('activeRules', () => {
  const base = createState(spec);
  const ids = (h: number): string[] => activeRules(base, h).map((r) => r.id);

  it('applies the 22 to 5 curfew across midnight', () => {
    expect(ids(23)).toContain('curfew_22');
    expect(ids(22)).toContain('curfew_22');
    expect(ids(0.5)).toContain('curfew_22');
    expect(ids(4.99)).toContain('curfew_22');
    expect(ids(5)).not.toContain('curfew_22');
    expect(ids(12)).not.toContain('curfew_22');
    expect(ids(21.9)).not.toContain('curfew_22');
  });

  it('always returns non-curfew rules', () => {
    for (const h of [0, 6, 12, 23]) {
      expect(ids(h)).toContain('no_guns_saloon');
      expect(ids(h)).toContain('whiskey_sunday');
    }
  });

  it('handles a same-day window and hours past 24', () => {
    const s = applyEvent(spec, base, {
      type: 'rule_add',
      rule: { id: 'siesta', text: 'Siesta', effect: { type: 'curfew', fromHour: 13, toHour: 16, exemptRoles: [] }, source: 'player' },
    }).state;
    expect(activeRules(s, 14).some((r) => r.id === 'siesta')).toBe(true);
    expect(activeRules(s, 16).some((r) => r.id === 'siesta')).toBe(false);
    expect(activeRules(s, 38).some((r) => r.id === 'siesta')).toBe(true); // 38 -> 14:00
  });
});
