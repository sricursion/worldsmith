// Stage B of POST /api/compile: the story. People, items, the quest and the starting rules, written against
// the outline's ids. It never touches architecture, so it runs in parallel with the look stage. The outline may
// hold a city of eight people, two hermits in a wilderness, or nobody at all; creatures can be what the quest is about.
import { worldSpecJsonSchema } from '../lib/shared';
import { outlineBrief } from './compile';
import { SPIRIT_ID, type Outline } from './compilemerge';

const ROLE = `You are the game designer for a first-person browser game that turns a short prompt into a small playable world. An outline of the world is given: the land, its structures or points of interest, its people (there may be few, or none), its creatures and a quest premise. Write the cast, the items, the quest and the rules, as one JSON object and nothing else: no prose, no code fence. It must be coherent and worth about ten minutes of play, in a grounded, unsentimental voice.`;

const RULES = `Two rules that never bend:
1. You emit data; the engine runs the world. NPCs follow schedules, quest steps are talk, fetch, deliver, visit, choose or confront, and rules are typed effects. Do not describe magic the data cannot express.
2. Use only the ids in the outline. Every npc id, home, work, schedule place and rule place is a structure id or person id from the outline, or "street" or "plaza". Creatures are not people: a creature id is never a step target, an item holder or an npc.`;

const GOOD = `What makes a good cast and quest:
- One entry for each outline person, same ids, same order, and nobody else. The setting decides who they are and how they talk: drovers talk like drovers, ice-core techs like tired scientists. No generic townsfolk voices.
- persona is two short sentences with a clear voice and a motive. knowledge has exactly three short facts they will share; secrets has one short fact they hide. relationships has one entry naming another npc id (none when they are alone). Vary mood and temperament: tau near 0.7 for decisive characters, near 1.3 for erratic ones; bias keys are action ids with small values (-1 to 1).
- schedule has four entries sorted by hour (hours 0 to 23), consistent with the setting. Activities: work rest drink pray patrol wander trade sleep eat guard.
- appearance.base is one of knight barbarian mage rogue ranger rogue_hooded; pick the closest in spirit. appearance.palette is 0 to 3 and varies between people. voice pitch 0.6 to 1.6, rate 0.7 to 1.3.
- items: 2 to 4, each with a holder that is an npc id, a structure id or "player". Things a creature left behind (a shed scale, a feather, a broken egg, a tracking collar) are items held by the structure where that creature keeps.
- The quest follows the premise. A step's target is an npc id for talk, deliver, confront and choose; an item id for fetch; a structure id for visit. A deliver step names its item in "item". Every item a deliver step hands over must first be picked up by a fetch step in that deliver step's requires chain. A fetch step's target and item are the same item id. Never deliver an item that no earlier step fetches. Every ending stepId is a step id. The first step has no requirements; later steps require earlier step ids.
- Creatures are good quest subjects. The Creatures list gives each one's haunt: send the player to that structure with a visit step ("Climb to the nest while the dragon sleeps"), and have them fetch what it left there. Say in the objective and the beat what the creature is doing.
- Size the quest to the cast:
  With 4 or more people: 5 or 6 steps mixing kinds: at least one fetch or deliver, one visit, one choose with two or more choices (each choice unlocks different later steps), two endings when you can (one good, one bitter).
  With 1 to 3 people: 4 or 5 steps, mostly visit and fetch across the land, opened by a talk with the giver and closed by a deliver or talk back to them. A choose step is optional.
  With no people: "npcs" is []. quest.giver is "${SPIRIT_ID}": the place itself speaks to the stranger. The first step is a talk step whose target is "${SPIRIT_ID}"; every other step is visit or fetch; 3 to 5 steps; one ending. Item holders are structure ids or "player". No rules that name a person.
- Secrets are revealed by quest steps through reveals, each "npcId:secretIndex" (index from 0).
- hook is one paragraph that makes a stranger want to start. title names the place or the trouble.
- 2 starting rules with source "world" that shape the place (a curfew, a ban, a price); in a wilderness they can be customs of the land ("custom": nobody lights a fire near the nest). 0 to 1 rules when there are no people. Never use time_scale unless the prompt asks for it.
- Short concrete strings. No markdown, no stage directions, no mention of being a game, a model or a prompt.
- Keep it economical: the whole reply stays under about 2600 tokens, so keep every string short.`;

function shapeText(): string {
  const props = (worldSpecJsonSchema() as { properties: Record<string, unknown> }).properties;
  const pick = { npcs: props.npcs, items: props.items, quest: props.quest, rules: props.rules };
  return `OUTPUT FORMAT
Reply with one JSON object with exactly the keys npcs, items, quest and rules. Each value must satisfy this JSON Schema fragment (every listed property is required):
${JSON.stringify(pick)}`;
}

let cached: string | null = null;

/** Stable across requests so the prompt cache can hit; the world outline goes in the user turn. */
export function storySystemPrompt(): string {
  if (!cached) cached = [ROLE, RULES, GOOD, shapeText()].join('\n\n');
  return cached;
}

export function storyUserMessage(prompt: string, seed: number, outline: Outline): string {
  const n = outline.npcs.length;
  const cast = n === 0 ? `nobody lives here, so npcs is [] and the giver is "${SPIRIT_ID}"` : `${n} ${n === 1 ? 'person' : 'people'}, exactly the outline's`;
  return `${outlineBrief(outline)}\n\nSeed: ${seed}\nPlayer prompt: ${prompt}\nWrite the npcs (${cast}), items, quest and rules now.`;
}
