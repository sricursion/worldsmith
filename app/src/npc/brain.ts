// Schedule lookup and rule overrides. Pure: no DOM, no three.
//
// Where each RuleEffect type takes effect:
//  - curfew, ban, schedule_override: whereShouldBe below (movement).
//  - mood: effectiveMood below, used by whereShouldBe, decide.ts (decision questions) and dialogue.ts.
//  - time_scale and weather: applied in game.ts when a rule is added or removed.
//  - price and relationship: no mechanical consumer. They reach the dialogue model only as rule text
//    in the dialogue context, so canned and mock dialogue ignore them.
import type { NpcSpec, RuleSpec, ScheduleEntry, WorldSpec, WorldState, Mood } from '../world/spec';
import { activeRules } from '../world/state';

export interface NpcIntent {
  npcId: string;
  place: string;
  activity: ScheduleEntry['activity'];
  reason: string;
}

type Activity = ScheduleEntry['activity'];
type BanEffect = Extract<RuleSpec['effect'], { type: 'ban' }>;

/** Hour at which the day turns to dusk; later hours (and the small hours) count as night. */
const DUSK_HOUR = 19;
const DAWN_HOUR = 6;
/** Activities that are duty rather than idling, so a ban on gatherings does not touch them. */
const DUTY: readonly Activity[] = ['work', 'patrol', 'guard'];

export function normHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  const m = h % 24;
  return m < 0 ? m + 24 : m;
}

export function isAfterDusk(hour: number): boolean {
  const h = normHour(hour);
  return h >= DUSK_HOUR || h < DAWN_HOUR;
}

/** True when `hour` lies in [from, to), wrapping past midnight when to <= from. */
export function inHourWindow(hour: number, from: number, to: number): boolean {
  if (to - from >= 24) return true;
  const h = normHour(hour);
  const f = normHour(from);
  const t = normHour(to);
  if (f === t) return false;
  return f < t ? h >= f && h < t : h >= f || h < t;
}

/** The schedule entry with the greatest hour <= `hour`; before the first entry it wraps to the last. */
export function scheduleEntryAt(npc: NpcSpec, hour: number): ScheduleEntry | null {
  if (npc.schedule.length === 0) return null;
  const sorted = [...npc.schedule].sort((a, b) => a.hour - b.hour);
  const h = normHour(hour);
  let best: ScheduleEntry | null = null;
  for (const e of sorted) {
    if (e.hour <= h) best = e;
    else break;
  }
  if (best) return best;
  return sorted[sorted.length - 1] ?? null;
}

const BAN_WORDS: Record<string, Activity | 'gathering'> = {
  alcohol: 'drink', drink: 'drink', drinks: 'drink', drinking: 'drink', booze: 'drink', liquor: 'drink',
  whiskey: 'drink', whisky: 'drink', beer: 'drink', ale: 'drink', wine: 'drink', spirits: 'drink', drunkenness: 'drink',
  gathering: 'gathering', gatherings: 'gathering', crowds: 'gathering', crowd: 'gathering', loitering: 'gathering',
  assembly: 'gathering', assemblies: 'gathering', congregating: 'gathering', meetings: 'gathering',
  trade: 'trade', trading: 'trade', selling: 'trade', commerce: 'trade', haggling: 'trade',
  prayer: 'pray', praying: 'pray', worship: 'pray', pray: 'pray',
  sleeping: 'sleep', sleep: 'sleep', resting: 'rest', rest: 'rest', idling: 'rest',
  eating: 'eat', eat: 'eat', food: 'eat', wandering: 'wander', wander: 'wander',
  patrol: 'patrol', patrolling: 'patrol', guarding: 'guard', guard: 'guard', work: 'work', working: 'work', labour: 'work', labor: 'work',
};

/** Does a ban on `what` forbid doing `activity`? 'gathering' bans any non-duty presence. */
export function banMatchesActivity(what: string, activity: Activity): boolean {
  const tokens = what.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    const mapped = BAN_WORDS[tok];
    if (mapped === undefined) continue;
    if (mapped === 'gathering') {
      if (!DUTY.includes(activity)) return true;
    } else if (mapped === activity) {
      return true;
    }
  }
  return false;
}

/** True when the ban applies to this NPC doing `activity` at `place`. The named enforcer is never barred. */
export function banBlocks(effect: BanEffect, npc: NpcSpec, place: string, activity: Activity): boolean {
  if (effect.enforcer === npc.id) return false;
  if (effect.where !== 'town' && effect.where !== place) return false;
  if (place === npc.home) return false;
  return banMatchesActivity(effect.what, activity);
}

function roleExempt(role: string, exempt: string[]): boolean {
  const r = role.trim().toLowerCase();
  if (r.length === 0) return false;
  return exempt.some((x) => {
    const e = x.trim().toLowerCase();
    return e.length > 0 && (r === e || r.includes(e));
  });
}

/** The mood an NPC shows right now: the latest mood rule aimed at them (or at everyone) over their own mood. */
export function effectiveMood(npc: NpcSpec, rules: RuleSpec[]): Mood {
  let mood = npc.mood;
  for (const r of rules) {
    if (r.effect.type === 'mood' && (r.effect.who === npc.id || r.effect.who === 'all')) mood = r.effect.mood;
  }
  return mood;
}

function sleepOrRest(hour: number): Activity {
  const h = normHour(hour);
  return h >= 22 || h < DAWN_HOUR ? 'sleep' : 'rest';
}

/** Hours an override entry stays in force: from entry.hour up to the NPC's next scheduled entry, wrapping midnight. */
function overrideActive(npc: NpcSpec, entry: ScheduleEntry, hour: number): boolean {
  const hours = npc.schedule.map((e) => normHour(e.hour));
  const start = normHour(entry.hour);
  const later = hours.filter((h) => h > start);
  const earliest = hours.length > 0 ? Math.min(...hours) : start;
  const end = later.length > 0 ? Math.min(...later) : earliest + 24;
  return inHourWindow(hour, start, end > start ? end : start + 24);
}

export function whereShouldBe(npc: NpcSpec, hour: number, rules: RuleSpec[]): NpcIntent {
  const entry = scheduleEntryAt(npc, hour);
  let place = entry ? entry.place : npc.home;
  let activity: Activity = entry ? entry.activity : 'rest';
  let reason = 'schedule';

  // 1. A schedule override aimed at this NPC wins over everything; the latest one stands.
  let override: RuleSpec | null = null;
  for (const r of rules) {
    if (r.effect.type === 'schedule_override' && r.effect.who === npc.id) override = r;
  }
  if (override && override.effect.type === 'schedule_override') {
    const e = override.effect.entry;
    if (overrideActive(npc, e, hour)) {
      return { npcId: npc.id, place: e.place, activity: e.activity, reason: `override: ${override.id}` };
    }
  }

  // 2. Curfew sends everyone but the exempt roles home to sleep.
  for (const r of rules) {
    const fx = r.effect;
    if (fx.type !== 'curfew') continue;
    if (!inHourWindow(hour, fx.fromHour, fx.toHour)) continue;
    if (roleExempt(npc.role, fx.exemptRoles)) continue;
    return { npcId: npc.id, place: npc.home, activity: 'sleep', reason: 'curfew' };
  }

  // 3. Bans turn the NPC away from the intended place, to the street by day and home by night.
  for (const r of rules) {
    const fx = r.effect;
    if (fx.type !== 'ban') continue;
    if (!banBlocks(fx, npc, place, activity)) continue;
    const reasonText = `ban on ${fx.what} at ${fx.where} (${r.id})`;
    if (isAfterDusk(hour)) {
      place = npc.home;
      activity = sleepOrRest(hour);
    } else {
      place = 'street';
      activity = 'wander';
    }
    reason = reasonText;
  }

  // 4. Frightened people stay indoors once the light goes.
  if (effectiveMood(npc, rules) === 'afraid' && isAfterDusk(hour) && place !== npc.home) {
    place = npc.home;
    activity = sleepOrRest(hour);
    reason = 'afraid after dusk';
  }

  return { npcId: npc.id, place, activity, reason };
}

export function planTick(spec: WorldSpec, state: WorldState): NpcIntent[] {
  const rules = activeRules(state, state.hour);
  return spec.npcs.map((npc) => {
    const mood = state.npcMoods[npc.id];
    const live = mood !== undefined && mood !== npc.mood ? { ...npc, mood } : npc;
    return whereShouldBe(live, state.hour, rules);
  });
}
