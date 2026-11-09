// Runtime state reducer. Pure and immutable: applyEvent never mutates its inputs.
//
// Quest bookkeeping
//  - state.unlockedSteps holds steps that can be completed right now (unlocked and not yet completed).
//  - A step unlocks when every `requires` step is complete. If a required step is a `choose` step, the step is
//    also gated by the choice: when some choice of that step lists it in `unlocks`, only the picked choice
//    unlocks it. The pick is stored in flags as `choice:<stepId>`.
//  - Completing a step records `revealed:<npcId>:<index>` flags for each entry in `reveals`.
//  - When an ending step completes, flags.questComplete = true and flags.ending = <stepId>.
import type { Mood, QuestStep, RuleSpec, WorldSpec, WorldState } from './spec';

export type WorldEvent =
  | { type: 'tick'; dtHours: number }
  | { type: 'talk'; npcId: string }
  | { type: 'pickup'; item: string }
  | { type: 'give'; item: string; to: string }
  | { type: 'visit'; buildingId: string }
  | { type: 'choose'; stepId: string; choice: number }
  | { type: 'rule_add'; rule: RuleSpec }
  | { type: 'rule_remove'; ruleId: string }
  | { type: 'npc_moved'; npcId: string; place: string }
  | { type: 'npc_mood'; npcId: string; mood: Mood };

const LOG_CAP = 60;

function scheduledPlace(spec: WorldSpec, npcId: string, hour: number): string {
  const npc = spec.npcs.find((n) => n.id === npcId);
  if (!npc) return 'street';
  const entries = npc.schedule;
  let pick = entries[entries.length - 1]; // before the first entry of the day, the last one still holds
  for (const e of entries) if (e.hour <= hour) pick = e;
  return pick?.place ?? npc.home;
}

function canUnlock(spec: WorldSpec, s: WorldState, step: QuestStep): boolean {
  for (const r of step.requires) {
    if (!s.completedSteps.includes(r)) return false;
    const req = spec.quest.steps.find((x) => x.id === r);
    if (req?.kind === 'choose' && req.choices) {
      const picked = s.flags[`choice:${r}`];
      const gated = req.choices.some((c) => c.unlocks.includes(step.id));
      if (gated && typeof picked === 'number' && !req.choices[picked]?.unlocks.includes(step.id)) return false;
    }
  }
  return true;
}

function pushLog(s: WorldState, who: string, what: string): void {
  s.log.push({ t: (s.day - 1) * 24 + s.hour, who, what });
  if (s.log.length > LOG_CAP) s.log.splice(0, s.log.length - LOG_CAP);
}

function cloneState(s: WorldState): WorldState {
  return {
    ...s,
    completedSteps: [...s.completedSteps],
    unlockedSteps: [...s.unlockedSteps],
    inventory: [...s.inventory],
    itemHolders: { ...s.itemHolders },
    npcMoods: { ...s.npcMoods },
    npcPlaces: { ...s.npcPlaces },
    flags: { ...s.flags },
    rules: [...s.rules],
    log: [...s.log],
  };
}

export function createState(spec: WorldSpec): WorldState {
  const hour = spec.time.startHour;
  const s: WorldState = {
    hour,
    day: 1,
    completedSteps: [],
    unlockedSteps: [],
    inventory: spec.items.filter((i) => i.holder === 'player').map((i) => i.id),
    itemHolders: Object.fromEntries(spec.items.map((i) => [i.id, i.holder])),
    npcMoods: Object.fromEntries(spec.npcs.map((n) => [n.id, n.mood])),
    npcPlaces: Object.fromEntries(spec.npcs.map((n) => [n.id, scheduledPlace(spec, n.id, hour)])),
    flags: {},
    rules: [...spec.rules],
    log: [],
  };
  s.unlockedSteps = spec.quest.steps.filter((st) => canUnlock(spec, s, st)).map((st) => st.id);
  return s;
}

interface Tally { completed: string[]; unlocked: string[] }

function complete(spec: WorldSpec, s: WorldState, step: QuestStep, t: Tally): void {
  if (s.completedSteps.includes(step.id)) return;
  s.completedSteps.push(step.id);
  s.unlockedSteps = s.unlockedSteps.filter((id) => id !== step.id);
  t.completed.push(step.id);
  for (const r of step.reveals ?? []) s.flags[`revealed:${r}`] = true;
  pushLog(s, 'quest', `Completed: ${step.objective}`);
  if (s.flags.questComplete !== true && spec.quest.endings.some((e) => e.stepId === step.id)) {
    s.flags.questComplete = true;
    s.flags.ending = step.id;
    pushLog(s, 'quest', 'The quest has reached an ending.');
  }
}

/** Unlock everything that has become available; a fetch whose item is already in hand completes at once. */
function settle(spec: WorldSpec, s: WorldState, t: Tally): void {
  for (let changed = true; changed;) {
    changed = false;
    for (const step of spec.quest.steps) {
      if (s.completedSteps.includes(step.id) || s.unlockedSteps.includes(step.id)) continue;
      if (!canUnlock(spec, s, step)) continue;
      s.unlockedSteps.push(step.id);
      t.unlocked.push(step.id);
      changed = true;
      if (step.kind === 'fetch' && s.inventory.includes(step.item ?? step.target)) complete(spec, s, step, t);
    }
  }
}

function open(spec: WorldSpec, s: WorldState, match: (st: QuestStep) => boolean): QuestStep[] {
  return spec.quest.steps.filter((st) => s.unlockedSteps.includes(st.id) && match(st));
}

export function applyEvent(
  spec: WorldSpec,
  state: WorldState,
  ev: WorldEvent,
): { state: WorldState; completed: string[]; unlocked: string[] } {
  const s = cloneState(state);
  const t: Tally = { completed: [], unlocked: [] };

  switch (ev.type) {
    case 'tick': {
      if (ev.dtHours > 0 && Number.isFinite(ev.dtHours)) {
        s.hour += ev.dtHours;
        while (s.hour >= 24) {
          s.hour -= 24;
          s.day += 1;
        }
      }
      break;
    }
    case 'talk': {
      pushLog(s, 'player', `Talked to ${ev.npcId}`);
      const hit = open(spec, s, (st) => (st.kind === 'talk' || st.kind === 'confront') && st.target === ev.npcId);
      for (const st of hit) complete(spec, s, st, t);
      break;
    }
    case 'pickup': {
      if (!(ev.item in s.itemHolders)) {
        pushLog(s, 'player', `Tried to pick up unknown item ${ev.item}`);
        break;
      }
      if (!s.inventory.includes(ev.item)) s.inventory.push(ev.item);
      s.itemHolders[ev.item] = 'player';
      pushLog(s, 'player', `Picked up ${ev.item}`);
      for (const st of open(spec, s, (x) => x.kind === 'fetch' && (x.item ?? x.target) === ev.item)) complete(spec, s, st, t);
      break;
    }
    case 'give': {
      if (!s.inventory.includes(ev.item)) {
        pushLog(s, 'player', `Has no ${ev.item} to give to ${ev.to}`);
        break;
      }
      s.inventory = s.inventory.filter((i) => i !== ev.item);
      s.itemHolders[ev.item] = ev.to;
      pushLog(s, 'player', `Gave ${ev.item} to ${ev.to}`);
      for (const st of open(spec, s, (x) => x.kind === 'deliver' && x.item === ev.item && x.target === ev.to)) complete(spec, s, st, t);
      break;
    }
    case 'visit': {
      pushLog(s, 'player', `Visited ${ev.buildingId}`);
      for (const st of open(spec, s, (x) => x.kind === 'visit' && x.target === ev.buildingId)) complete(spec, s, st, t);
      break;
    }
    case 'choose': {
      const st = open(spec, s, (x) => x.kind === 'choose' && x.id === ev.stepId)[0];
      if (!st || !st.choices || !Number.isInteger(ev.choice) || ev.choice < 0 || ev.choice >= st.choices.length) {
        pushLog(s, 'player', `Invalid choice for ${ev.stepId}`);
        break;
      }
      s.flags[`choice:${st.id}`] = ev.choice;
      pushLog(s, 'player', `Chose: ${st.choices[ev.choice]?.label ?? ''}`);
      complete(spec, s, st, t);
      break;
    }
    case 'rule_add': {
      s.rules = [...s.rules.filter((r) => r.id !== ev.rule.id), ev.rule];
      pushLog(s, ev.rule.source === 'player' ? 'player' : 'world', `Rule added: ${ev.rule.text}`);
      break;
    }
    case 'rule_remove': {
      const gone = s.rules.find((r) => r.id === ev.ruleId);
      s.rules = s.rules.filter((r) => r.id !== ev.ruleId);
      if (gone) pushLog(s, 'player', `Rule removed: ${gone.text}`);
      break;
    }
    case 'npc_moved': {
      // The game logs moves with their reason; the reducer only records the place.
      s.npcPlaces[ev.npcId] = ev.place;
      break;
    }
    case 'npc_mood': {
      s.npcMoods[ev.npcId] = ev.mood;
      pushLog(s, ev.npcId, `Mood is now ${ev.mood}`);
      break;
    }
  }

  settle(spec, s, t);
  return { state: s, completed: t.completed, unlocked: t.unlocked };
}

/** Curfews apply only inside their hour window (wrapping past midnight); every other rule is always active. */
export function activeRules(state: WorldState, hour: number): RuleSpec[] {
  const h = ((hour % 24) + 24) % 24;
  return state.rules.filter((r) => {
    const e = r.effect;
    if (e.type !== 'curfew') return true;
    if (e.fromHour === e.toHour) return false;
    return e.fromHour < e.toHour ? h >= e.fromHour && h < e.toHour : h >= e.fromHour || h < e.toHour;
  });
}
