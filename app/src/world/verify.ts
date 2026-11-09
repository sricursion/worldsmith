// Quest verification and repair. Pure: no engine, no DOM.
//
// Model of the quest graph
//  - Hard edges are `requires`. They must be acyclic and point at existing steps.
//  - A deliver step also has a soft edge to a fetch step that supplies its item (unless the player starts
//    with the item). The fetch must not be a descendant of the deliver step.
//  - A `choose` step lists, per choice, the steps it unlocks; those steps must require the choose step.
//  - The quest is winnable when the giver has a step and at least one ending step is not blocked.
//
// Availability rule (kept deliberately simple): an NPC is "locked away" at an hour only when a `ban` rule on
// 'town' forbids talking. Curfews are not blockers, because the player can visit the NPC's home. Hour is
// therefore irrelevant today, but the loop is kept so a time-windowed ban can be added in one place.
import type { QuestSpec, QuestStep, RuleSpec, WorldSpec } from './spec';

export interface QuestReport { winnable: boolean; order: string[]; problems: string[]; unreachable: string[] }

const NPC_KINDS = new Set(['talk', 'deliver', 'confront']);
const TALK_BAN = /talk|speak|convers|chat|dialog/i;
const ENTER_BAN = /enter|visit|access|go in|trespass/i;

function talkBanned(rules: RuleSpec[], hour: number): boolean {
  void hour;
  return rules.some((r) => r.effect.type === 'ban' && r.effect.where === 'town' && TALK_BAN.test(r.effect.what));
}

function npcAvailableHours(rules: RuleSpec[]): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) if (!talkBanned(rules, h)) out.push(h);
  return out;
}

function visitBanned(rules: RuleSpec[], buildingId: string): boolean {
  return rules.some((r) => r.effect.type === 'ban' && r.effect.where === buildingId && ENTER_BAN.test(r.effect.what));
}

/** Kahn's algorithm over existing hard edges. Returns the steps that are part of, or behind, a cycle. */
function cyclic(steps: QuestStep[]): Set<string> {
  const ids = new Set(steps.map((s) => s.id));
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const s of steps) {
    const deps = s.requires.filter((r) => ids.has(r) && r !== s.id);
    indeg.set(s.id, deps.length + (s.requires.includes(s.id) ? 1 : 0));
    for (const d of deps) out.set(d, [...(out.get(d) ?? []), s.id]);
  }
  const queue = [...indeg].filter(([, n]) => n === 0).map(([id]) => id);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    seen.add(id);
    for (const next of out.get(id) ?? []) {
      const n = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, n);
      if (n === 0) queue.push(next);
    }
  }
  return new Set(steps.map((s) => s.id).filter((id) => !seen.has(id)));
}

function ancestorsOf(id: string, byId: Map<string, QuestStep>): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = byId.get(stack.pop() as string);
    for (const r of cur?.requires ?? []) {
      if (!out.has(r)) {
        out.add(r);
        stack.push(r);
      }
    }
  }
  return out;
}

export function verifyQuest(spec: WorldSpec): QuestReport {
  const problems: string[] = [];
  const q = spec.quest;
  const steps = q.steps;
  const byId = new Map<string, QuestStep>();
  const npcs = new Map(spec.npcs.map((n) => [n.id, n]));
  const buildings = new Set(spec.buildings.map((b) => b.id));
  const items = new Map(spec.items.map((i) => [i.id, i]));
  const bad = new Set<string>();

  if (steps.length === 0) problems.push('quest has no steps');
  for (const s of steps) {
    if (byId.has(s.id)) problems.push(`duplicate step id "${s.id}"`);
    else byId.set(s.id, s);
  }

  for (const s of steps) {
    const fail = (msg: string): void => {
      problems.push(`step "${s.id}": ${msg}`);
      bad.add(s.id);
    };
    for (const r of s.requires) {
      if (r === s.id) fail('requires itself');
      else if (!byId.has(r)) fail(`requires unknown step "${r}"`);
    }
    if (NPC_KINDS.has(s.kind) || (s.kind === 'choose' && npcs.has(s.target))) {
      const npc = npcs.get(s.target);
      if (!npc) fail(`target "${s.target}" is not an NPC`);
      else if (npcAvailableHours(spec.rules).length === 0) fail(`${npc.name} cannot be spoken to at any hour (town-wide talking ban)`);
    } else if (s.kind === 'choose' && !buildings.has(s.target)) {
      fail(`choose target "${s.target}" is neither an NPC nor a building`);
    } else if (s.kind === 'visit') {
      if (!buildings.has(s.target)) fail(`target "${s.target}" is not a building`);
      else if (visitBanned(spec.rules, s.target)) fail(`entering "${s.target}" is banned`);
    } else if (s.kind === 'fetch') {
      const item = items.get(s.target);
      if (!item) fail(`target "${s.target}" is not an item`);
      else if (s.item !== undefined && s.item !== s.target) fail(`item "${s.item}" differs from fetch target "${s.target}"`);
      else {
        const h = item.holder;
        const holderNpc = npcs.get(h);
        const ok = h === 'player' || buildings.has(h) ||
          (holderNpc !== undefined && (buildings.has(holderNpc.home) || holderNpc.schedule.some((e) => buildings.has(e.place) || e.place === 'street' || e.place === 'plaza')));
        if (!ok) fail(`item "${item.id}" is held by "${h}", who is not in town`);
      }
    }
    if (s.kind === 'deliver' && (s.item === undefined || !items.has(s.item))) fail(`deliver item "${s.item ?? ''}" does not exist`);
    if (s.kind === 'choose') {
      if (!s.choices || s.choices.length === 0) fail('choose step has no choices');
      for (const c of s.choices ?? []) {
        for (const u of c.unlocks) {
          const target = byId.get(u);
          if (!target) fail(`choice "${c.label}" unlocks unknown step "${u}"`);
          else if (!target.requires.includes(s.id)) fail(`choice "${c.label}" unlocks "${u}", which does not require "${s.id}"`);
        }
      }
    }
  }

  // Cycles.
  const loops = cyclic(steps);
  if (loops.size > 0) problems.push(`requires cycle involving: ${[...loops].join(', ')}`);
  for (const id of loops) bad.add(id);

  // Deliver steps need an earlier supplier for their item.
  const descendants = (id: string): Set<string> =>
    new Set(steps.filter((s) => ancestorsOf(s.id, byId).has(id)).map((s) => s.id));
  const supplier = new Map<string, string>();
  for (const s of steps) {
    if (s.kind !== 'deliver' || s.item === undefined || !items.has(s.item) || bad.has(s.id)) continue;
    if (items.get(s.item)?.holder === 'player') continue;
    const after = descendants(s.id);
    const fetch = steps.find((f) => f.kind === 'fetch' && f.target === s.item && f.id !== s.id && !after.has(f.id));
    if (fetch) supplier.set(s.id, fetch.id);
    else {
      problems.push(`step "${s.id}": nothing fetches "${s.item}" before it is delivered`);
      bad.add(s.id);
    }
  }

  // Giver.
  const giver = npcs.get(q.giver);
  if (!giver) problems.push(`quest giver "${q.giver}" is not an NPC`);
  const giverHasStep = steps.some((s) => s.target === q.giver && NPC_KINDS.has(s.kind));
  if (giver && !giverHasStep) problems.push(`quest giver "${q.giver}" has no step`);

  // Endings.
  if (q.endings.length === 0) problems.push('quest has no endings');
  for (const e of q.endings) if (!byId.has(e.stepId)) problems.push(`ending "${e.label}" points at unknown step "${e.stepId}"`);

  // Propagate blocks: a step is blocked when any prerequisite is blocked or missing.
  const blocked = new Set(bad);
  for (let changed = true; changed;) {
    changed = false;
    for (const s of steps) {
      if (blocked.has(s.id)) continue;
      const dep = [...s.requires, ...(supplier.has(s.id) ? [supplier.get(s.id) as string] : [])];
      if (dep.some((d) => blocked.has(d) || !byId.has(d))) {
        blocked.add(s.id);
        changed = true;
      }
    }
  }
  const unreachable = steps.filter((s) => blocked.has(s.id)).map((s) => s.id);

  const usable = q.endings.find((e) => byId.has(e.stepId) && !blocked.has(e.stepId));
  const winnable = usable !== undefined && giver !== undefined && giverHasStep;

  // A valid completion order for the first winnable ending: prerequisites before dependants.
  const order: string[] = [];
  if (usable) {
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      done.add(id);
      const s = byId.get(id);
      if (!s) return;
      const sup = supplier.get(id);
      for (const d of [...s.requires, ...(sup ? [sup] : [])]) visit(d);
      order.push(id);
    };
    visit(usable.stepId);
  }

  return { winnable, order, problems, unreachable };
}

// ---------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

/** Drop dangling references and break cycles by cutting requires edges that point inside a cycle. */
function prune(q: QuestSpec): void {
  const ids = new Set(q.steps.map((s) => s.id));
  for (const s of q.steps) {
    s.requires = [...new Set(s.requires.filter((r) => ids.has(r) && r !== s.id))];
    if (s.choices) for (const c of s.choices) c.unlocks = c.unlocks.filter((u) => ids.has(u));
  }
  for (const s of q.steps) {
    if (s.kind !== 'choose') continue;
    for (const c of s.choices ?? []) {
      for (const u of c.unlocks) {
        const t = q.steps.find((x) => x.id === u);
        if (t && !t.requires.includes(s.id)) t.requires.push(s.id);
      }
    }
  }
  // Keep only the steps on a cycle (not those merely downstream of one), then cut the edges between them.
  let loops = cyclic(q.steps);
  for (;;) {
    const needed = new Set<string>();
    for (const s of q.steps) if (loops.has(s.id)) for (const r of s.requires) if (loops.has(r)) needed.add(r);
    const next = new Set([...loops].filter((id) => needed.has(id)));
    if (next.size === loops.size) break;
    loops = next;
  }
  for (const s of q.steps) if (loops.has(s.id)) s.requires = s.requires.filter((r) => !loops.has(r));
  q.endings = q.endings.filter((e, i, all) => ids.has(e.stepId) && all.findIndex((x) => x.stepId === e.stepId) === i);
}

export function repairQuest(input: WorldSpec): WorldSpec {
  const spec = structuredClone(input);
  const q = spec.quest;
  const npcIds = new Set(spec.npcs.map((n) => n.id));
  const buildingIds = new Set(spec.buildings.map((b) => b.id));
  const itemIds = new Set(spec.items.map((i) => i.id));

  if (!npcIds.has(q.giver)) q.giver = spec.npcs[0]?.id ?? q.giver;

  // 1. Drop steps with duplicate ids or unknown targets.
  const seen = new Set<string>();
  q.steps = q.steps.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    switch (s.kind) {
      case 'talk':
      case 'confront':
        return npcIds.has(s.target);
      case 'deliver':
        return npcIds.has(s.target) && s.item !== undefined && itemIds.has(s.item);
      case 'visit':
        return buildingIds.has(s.target);
      case 'fetch':
        return itemIds.has(s.target);
      case 'choose':
        return npcIds.has(s.target) || buildingIds.has(s.target);
    }
  });

  // 2. Fetch items held by someone absent are held by the giver instead.
  const holderOk = (h: string): boolean => h === 'player' || npcIds.has(h) || buildingIds.has(h);
  for (const s of q.steps) {
    if (s.kind !== 'fetch') continue;
    const item = spec.items.find((i) => i.id === s.target);
    if (item && !holderOk(item.holder)) item.holder = q.giver;
    if (s.item !== undefined && s.item !== s.target) s.item = s.target;
  }

  prune(q);

  // 3. Deliver steps with no supplier get a synthesised fetch step.
  const taken = new Set(q.steps.map((s) => s.id));
  for (const d of [...q.steps]) {
    if (d.kind !== 'deliver' || d.item === undefined) continue;
    const item = spec.items.find((i) => i.id === d.item);
    if (!item || item.holder === 'player') continue;
    const after = new Set(q.steps.filter((s) => ancestorsOfSteps(s.id, q.steps).has(d.id)).map((s) => s.id));
    const hasSupplier = q.steps.some((f) => f.kind === 'fetch' && f.target === d.item && !after.has(f.id) && f.id !== d.id);
    if (hasSupplier) continue;
    if (!holderOk(item.holder)) item.holder = q.giver;
    const id = uniqueId(`fetch_${item.id}`, taken);
    taken.add(id);
    q.steps.splice(q.steps.indexOf(d), 0, {
      id, kind: 'fetch', target: item.id, item: item.id, requires: [...d.requires],
      objective: `Pick up ${item.name}.`, beat: `You take ${item.name}.`,
    });
    d.requires = [...d.requires, id];
  }

  // 4. Drop anything the verifier still calls unreachable, a few passes deep.
  for (let pass = 0; pass < 4; pass++) {
    const dead = new Set(verifyQuest(spec).unreachable);
    if (dead.size === 0) break;
    q.steps = q.steps.filter((s) => !dead.has(s.id));
    prune(q);
  }

  // 5. The giver needs an opening step.
  if (!q.steps.some((s) => s.target === q.giver && NPC_KINDS.has(s.kind)) && npcIds.has(q.giver)) {
    const id = uniqueId(`open_${q.giver}`, new Set(q.steps.map((s) => s.id)));
    for (const s of q.steps) if (s.requires.length === 0) s.requires = [id];
    const name = spec.npcs.find((n) => n.id === q.giver)?.name ?? q.giver;
    q.steps.unshift({
      id, kind: 'talk', target: q.giver, requires: [],
      objective: `Talk to ${name}.`, beat: `${name} explains what happened and asks for your help.`,
    });
  }

  // 6. Guarantee an ending: the last step that nothing else requires.
  q.endings = q.endings.filter((e) => q.steps.some((s) => s.id === e.stepId));
  if (q.endings.length === 0 && q.steps.length > 0) {
    const needed = new Set(q.steps.flatMap((s) => s.requires));
    const sinks = q.steps.filter((s) => !needed.has(s.id));
    const last = sinks[sinks.length - 1] ?? q.steps[q.steps.length - 1];
    if (last) q.endings.push({ stepId: last.id, label: 'The matter is settled.', tone: 'neutral' });
  }
  return spec;
}

function ancestorsOfSteps(id: string, steps: QuestStep[]): Set<string> {
  return ancestorsOf(id, new Map(steps.map((s) => [s.id, s])));
}
