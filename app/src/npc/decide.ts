// Per-tick NPC decisions: build the multiple-choice questions, sample an action from the model's
// probabilities, and fall back locally when the decision service is unavailable. Pure.
import { hash32, type Rng } from '../world/rng';
import type { Mood, NpcAction, NpcActionId, NpcSpec, RuleSpec, ScheduleEntry, WorldSpec, WorldState } from '../world/spec';
import { activeRules } from '../world/state';
import { banBlocks, effectiveMood, scheduleEntryAt, type NpcIntent } from './brain';

export interface ChoiceOption {
  id: NpcActionId;
  label: string;
  target?: string;
  /** Clause for the "why?" overlay when this option is picked. */
  reason?: string;
}

export interface ChoiceQuestion {
  npcId: string;
  question: string;
  options: ChoiceOption[];
}

type Activity = ScheduleEntry['activity'];

const ACTIVITY_VERB: Record<Activity, string> = {
  work: 'work', rest: 'rest', drink: 'have a drink', pray: 'pray', patrol: 'patrol',
  wander: 'wander', trade: 'trade', sleep: 'sleep', eat: 'eat', guard: 'stand guard',
};

const SOCIAL_ROLES: readonly string[] = ['saloon', 'tavern', 'cantina', 'cafe', 'inn'];
const MAX_OPTIONS = 5;

export function placeLabel(spec: WorldSpec, place: string): string {
  if (place === 'street') return 'the street';
  if (place === 'plaza') return 'the plaza';
  const b = spec.buildings.find((x) => x.id === place);
  return b ? b.label : place;
}

export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  let whole = Math.floor(h);
  let mins = Math.round((h - whole) * 60);
  if (mins === 60) {
    whole = (whole + 1) % 24;
    mins = 0;
  }
  return `${whole}:${mins.toString().padStart(2, '0')}`;
}

function continueReason(spec: WorldSpec, npc: NpcSpec, intent: NpcIntent, hour: number): string {
  const label = placeLabel(spec, intent.place);
  if (intent.reason === 'curfew') return `curfew keeps the town shut and sends ${npc.name} home`;
  if (intent.reason.startsWith('ban')) return intent.reason;
  if (intent.reason.startsWith('override')) return `a new rule changed ${npc.name}'s routine`;
  if (intent.reason === 'afraid after dusk') return `fear keeps ${npc.name} indoors after dark`;
  const h = Math.floor(((hour % 24) + 24) % 24);
  return `it is ${h} and ${npc.name} is due to ${ACTIVITY_VERB[intent.activity]} at ${label}`;
}

function moodOf(npc: NpcSpec, state: WorldState, rules: RuleSpec[]): Mood {
  return effectiveMood({ ...npc, mood: state.npcMoods[npc.id] ?? npc.mood }, rules);
}

function playerPlace(state: WorldState): string | null {
  const p = state.flags['player_place'];
  return typeof p === 'string' && p.length > 0 ? p : null;
}

function namedByEnforcer(rules: RuleSpec[], npc: NpcSpec, entry: ScheduleEntry | null): boolean {
  for (const r of rules) {
    const fx = r.effect;
    if (fx.type !== 'ban' || fx.enforcer === undefined || fx.enforcer === npc.id) continue;
    const text = r.text.toLowerCase();
    if (text.includes(npc.name.toLowerCase()) || text.includes(npc.id.toLowerCase())) return true;
    if (entry && banBlocks(fx, npc, entry.place, entry.activity)) return true;
  }
  return false;
}

function goToCandidates(spec: WorldSpec, npc: NpcSpec, rules: RuleSpec[], avoid: Set<string>): string[] {
  const out: string[] = [];
  const add = (p: string | undefined): void => {
    if (p && !avoid.has(p) && !out.includes(p)) out.push(p);
  };
  add('plaza');
  for (const b of spec.buildings) {
    if (!SOCIAL_ROLES.includes(b.role)) continue;
    const closed = rules.some((r) => r.effect.type === 'ban' && banBlocks(r.effect, npc, b.id, 'drink'));
    if (!closed) add(b.id);
  }
  for (const rel of npc.relationships) {
    if (rel.stance !== 'friend' && rel.stance !== 'family') continue;
    const other = spec.npcs.find((n) => n.id === rel.npcId);
    if (other && other.work !== 'street') add(other.work);
  }
  if (out.length === 0) {
    add('street');
    add(npc.home);
  }
  if (out.length === 0) out.push('street');
  return out;
}

export function buildQuestions(spec: WorldSpec, state: WorldState, intents: NpcIntent[], playerNear: string | null): ChoiceQuestion[] {
  const rules = activeRules(state, state.hour);
  const ruleText = rules.slice(0, 3).map((r) => r.text.replace(/[.\s]+$/, '')).join('; ');
  const pPlace = playerPlace(state);
  const questions: ChoiceQuestion[] = [];

  for (const intent of intents) {
    const npc = spec.npcs.find((n) => n.id === intent.npcId);
    if (!npc) continue;
    const here = state.npcPlaces[npc.id] ?? intent.place;
    const mood = moodOf(npc, state, rules);
    const opts: ChoiceOption[] = [];

    opts.push({
      id: 'continue',
      label: `Carry on: ${ACTIVITY_VERB[intent.activity]} at ${placeLabel(spec, intent.place)}`,
      target: intent.place,
      reason: continueReason(spec, npc, intent, state.hour),
    });

    const cands = goToCandidates(spec, npc, rules, new Set<string>([intent.place, here]));
    const pick = cands[hash32(`${npc.id}|${Math.floor(state.hour)}|${state.day}`) % cands.length];
    if (pick !== undefined) {
      const lbl = placeLabel(spec, pick);
      opts.push({ id: 'go_to', label: `Head over to ${lbl}`, target: pick, reason: `${npc.name} fancies a change and heads to ${lbl}` });
    }

    const neighbour = spec.npcs.find((n) => n.id !== npc.id && state.npcPlaces[n.id] === here);
    if (neighbour) {
      opts.push({ id: 'talk_to', label: `Talk with ${neighbour.name}`, target: neighbour.id, reason: `${npc.name} wants a word with ${neighbour.name}` });
    }

    opts.push({ id: 'idle', label: 'Stay put and idle', reason: `${npc.name} lingers a while` });

    if (playerNear === npc.id) {
      const wary = mood === 'tense' || mood === 'angry';
      opts.push(wary
        ? { id: 'investigate', label: 'Size up the stranger', reason: `something about the stranger draws ${npc.name}'s attention` }
        : { id: 'follow_player', label: 'Fall in beside the stranger', reason: `${npc.name} is curious about the stranger` });
    } else if (pPlace !== null && pPlace === here) {
      opts.push({ id: 'investigate', label: 'Look into the stranger nearby', reason: `a stranger is in the same place as ${npc.name}` });
    }

    if (mood === 'afraid' || namedByEnforcer(rules, npc, scheduleEntryAt(npc, state.hour))) {
      opts.push({
        id: 'flee',
        label: 'Get away from here',
        target: npc.home,
        reason: mood === 'afraid' ? `fear drives ${npc.name} away` : `a rule's enforcer is after ${npc.name}`,
      });
    }

    if (opts.length > MAX_OPTIONS) {
      const i = opts.findIndex((o) => o.id === 'idle');
      if (i >= 0) opts.splice(i, 1);
    }
    opts.length = Math.min(opts.length, MAX_OPTIONS);

    const ruleClause = ruleText.length > 0 ? `, and the rules in force say: ${ruleText}` : ', and no rules are in force';
    const question = `At ${formatHour(state.hour)} on day ${state.day}, ${npc.name} the ${npc.role} is at ${placeLabel(spec, here)}, feeling ${mood}${ruleClause}; what does ${npc.name} do next?`;
    questions.push({ npcId: npc.id, question, options: opts });
  }
  return questions;
}

function toAction(opt: ChoiceOption, npc: NpcSpec): NpcAction {
  const reason = opt.reason ?? `${npc.name} chose to ${opt.label.charAt(0).toLowerCase()}${opt.label.slice(1)}`;
  const a: NpcAction = { id: opt.id, reason };
  if (opt.target !== undefined) a.target = opt.target;
  return a;
}

export function sampleAction(probs: number[], options: ChoiceQuestion['options'], npc: NpcSpec, rng: Rng): NpcAction {
  if (options.length === 0) return { id: 'idle', reason: `${npc.name} has nothing to decide` };
  const tau = Math.max(0.05, Number.isFinite(npc.temperament.tau) ? npc.temperament.tau : 1);
  // w_i = p_i^(1/tau) * exp(bias_i), computed in log space so a small tau cannot underflow.
  const logw = options.map((o, i) => {
    const p = probs[i];
    if (p === undefined || !Number.isFinite(p) || p <= 0) return Number.NEGATIVE_INFINITY;
    const b = npc.temperament.bias[o.id] ?? 0;
    return Math.log(p) / tau + (Number.isFinite(b) ? b : 0);
  });
  const top = Math.max(...logw);
  const weights = top === Number.NEGATIVE_INFINITY ? options.map(() => 1) : logw.map((l) => Math.exp(l - top));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng.next() * total;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) return toAction(options[i] as ChoiceOption, npc);
  }
  return toAction(options[options.length - 1] as ChoiceOption, npc);
}

export function localFallback(q: ChoiceQuestion, npc: NpcSpec, rng: Rng): NpcAction {
  const first = q.options[0];
  if (!first) return { id: 'idle', reason: `${npc.name} has nothing to decide` };
  const rest = q.options.slice(1);
  if (rest.length === 0 || rng.next() < 0.7) return toAction(first, npc);
  const opt = rest[Math.min(rest.length - 1, Math.floor(rng.next() * rest.length))] as ChoiceOption;
  return toAction(opt, npc);
}
