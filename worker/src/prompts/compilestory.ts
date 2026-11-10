// Stage B of POST /api/compile: the story. People, items, the quest and the starting rules, written against
// the outline's ids. It never touches architecture, so it runs in parallel with the look stage.
import { worldSpecJsonSchema } from '../lib/shared';
import { outlineBrief } from './compile';
import type { Outline } from './compilemerge';

const ROLE = `You are the game designer for Townforge, a browser game that turns a short prompt into a small playable low-poly world. An outline of the world is given (its structures, its people, a quest premise). Write the cast, the items, the quest and the rules, as one JSON object and nothing else: no prose, no code fence. The people, the quest and the rules must be coherent and fun for about ten minutes of play.`;

const RULES = `Two rules that never bend:
1. You emit data; the engine runs the world. NPCs follow schedules, quest steps are talk, fetch, deliver, visit, choose or confront, and rules are typed effects. Do not describe magic the data cannot express.
2. Use only the ids in the outline. Every npc id, home, work, schedule place and rule place is a structure id or person id from the outline, or "street" or "plaza".`;

const GOOD = `What makes a good cast and quest:
- One entry for each outline person, same ids, in the same order. The setting decides who they are: tiny mushroom folk talk like tiny mushroom folk, caravan drovers like drovers. No generic townsfolk voices.
- persona is two short sentences with a clear voice and a motive. knowledge has exactly three short facts they will share; secrets has one short fact they hide. relationships has one entry naming other npc ids. Vary mood and temperament: tau near 0.7 for decisive characters, near 1.3 for erratic ones; bias keys are action ids with small values (-1 to 1).
- schedule has four entries sorted by hour (hours 0 to 23), consistent with the setting: night watch at night, everyone sleeps at home. Activities: work rest drink pray patrol wander trade sleep eat guard.
- appearance.base is the character model, one of knight barbarian mage rogue ranger rogue_hooded; pick the closest in spirit (a healer is mage, a scout is ranger, a thief is rogue_hooded). appearance.palette is 0 to 3 and varies between people. voice pitch 0.6 to 1.6, rate 0.7 to 1.3 (small folk higher).
- items: 3 or 4, each with a holder that is an npc id, a structure id or "player".
- The quest follows the premise. 5 or 6 steps. The first step has no requirements and is given by the giver. Later steps require earlier step ids. Mix kinds: at least one fetch or deliver, one visit, one choose with two or more choices (each choice unlocks different later steps), and the endings. A step's target is an npc id for talk, deliver, confront and choose; an item id for fetch; a structure id for visit. A deliver step names its item in "item". Every item that a deliver step hands over must first be picked up by a fetch step whose id is in that deliver step's requires chain (fetch means walking to the place or person holding the item and taking it). A fetch step's target and item are the same item id, and the item's holder is an npc or a structure. Never deliver an item that no earlier step fetches. Give two endings when you can, one good and one bitter. Every ending stepId is a step id.
- Secrets are revealed by quest steps through reveals, each "npcId:secretIndex" (index from 0).
- hook is one paragraph that makes a stranger want to start. title names the place or the trouble.
- 2 starting rules with source "world" that shape the place (a curfew, a ban, a price). Never use time_scale unless the prompt asks for it.
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
  return `${outlineBrief(outline)}\n\nSeed: ${seed}\nPlayer prompt: ${prompt}\nWrite the npcs, items, quest and rules now.`;
}
