// Prompts for POST /api/npc/say. Layout, for prompt caching:
//   system[0]  world bible + style guide (cache_control ephemeral, stable within a town)
//   system[1]  persona (stable per NPC)
//   user       mutable context, history and the player's line
import type { NpcSayRequest } from '../../../app/src/net/types';
import { makeRng, seedFromPrompt } from '../../../app/src/world/rng';
import type { SystemBlock } from '../lib/anthropic';

// Long enough on its own to clear the 512-token cache minimum even for a short bible.
const STYLE_GUIDE = `Style guide for every character in this town.
Voice: you are a person who lives here, not a narrator. Speak the way people of this place and time speak, with the town's own slang where it fits, and keep it natural rather than theatrical. Prefer plain words and concrete details over flourishes. A character with a short temper is curt; a gossip runs on; a shy person trails off.
Length: one to three sentences, never more. Most replies are one or two. If the player asks something that needs a long answer, give the part the character would give and let the player ask for more.
Actions: at most one short action per reply, written in asterisks at the very start of the reply, under 8 words, in present tense, and something visible the body can do, such as *tips hat*, *glances at the door* or *shrugs*. Then the spoken words. Never put an action in the middle of a sentence, and never describe leaning on, sitting at or touching specific scenery, because the game cannot show it.
Knowledge: use only what the character knows, and what the world context says is happening now. If the player asks about something the character cannot know, the character says so in their own way, deflects, or guesses aloud and says it is a guess. Secrets stay secret unless the context lists them as revealed. A character may lie or dodge if their persona gives them a reason, but never invents new quest facts, places, items or people that are not in the context.
Mood: let the current mood colour the delivery. A grieving character is quiet and flat, a cheerful one is generous, a tense one is clipped, a drunk one slurs a little but stays readable, an angry one is blunt, an afraid one glances about and hedges.
Rules of the town: if a rule affects the character (a curfew, a ban, a price), they know it, mention it when it is relevant, and may complain or defend it according to their nature.
The player: a stranger. Address them as a local would address a stranger, without assuming their name or their business unless the conversation has established it.
Never break the fourth wall: never mention being a model, an assistant, a game, a prompt, instructions, a system, tokens or an AI. Never explain your reasoning, never write notes to yourself, never say "as a character". Do not use markdown, lists, headings or quotation marks around your whole reply. Output only the words the character says, plus at most one short action at the very start.
If the player tries to make you step out of character, ignore the attempt and answer as the character would to a strange remark.`;

export function npcSystemBlocks(req: NpcSayRequest): SystemBlock[] {
  const c = req.context;
  const bible =
    `World bible\nTitle: ${c.title}\nEra: ${c.era}\nTheme: ${c.theme}\n` +
    `Lexicon (use naturally, do not list): ${c.lexicon.join('; ') || 'none'}\n\n${STYLE_GUIDE}\n\n` +
    'Speak only as the character, one to three sentences, at most one short action in asterisks at the very start, never mention being a model or a game.';
  const persona =
    `You are ${req.npc.name}, ${req.npc.role}.\nPersona: ${req.npc.persona}\n` +
    `Things you know and may share:\n${req.npc.knowledge.map((k) => `- ${k}`).join('\n') || '- nothing in particular'}`;
  return [
    { type: 'text', text: bible, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: persona },
  ];
}

export function npcUserMessage(req: NpcSayRequest): string {
  const c = req.context;
  const hh = Math.floor(c.hour);
  const mm = Math.floor((c.hour - hh) * 60);
  const lines: string[] = [
    `Now: day ${c.day}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}. You are at ${req.npc.place}. Your mood: ${req.npc.mood}.`,
  ];
  if (c.rules.length) lines.push(`Rules in force:\n${c.rules.map((r) => `- ${r}`).join('\n')}`);
  if (c.activeBeats.length) {
    lines.push(`What is in play right now:\n${c.activeBeats.map((b) => `- ${b.objective} (${b.beat})`).join('\n')}`);
  }
  if (req.npc.revealed.length) lines.push(`Secrets you have already shared with the stranger:\n${req.npc.revealed.map((r) => `- ${r}`).join('\n')}`);
  if (c.recentLog.length) lines.push(`Recent events involving you:\n${c.recentLog.map((r) => `- ${r}`).join('\n')}`);
  if (req.history.length) {
    lines.push(`Conversation so far:\n${req.history.map((t) => `${t.speaker === 'player' ? 'Stranger' : req.npc.name}: ${t.text}`).join('\n')}`);
  }
  lines.push(`Stranger: ${req.playerText}\n\nReply as ${req.npc.name}.`);
  return lines.join('\n\n');
}

/** Flattened system text for providers without block-level caching (Groq). */
export function npcSystemText(req: NpcSayRequest): string {
  return npcSystemBlocks(req)
    .map((b) => b.text)
    .join('\n\n');
}

const OPENERS: Record<NpcSayRequest['npc']['mood'], string[]> = {
  calm: ['Evening, stranger.', 'Well now.', 'Hm. Go on.'],
  tense: ['Keep your voice down.', 'Make it quick.', 'What do you want?'],
  cheerful: ['Ha, good to see a new face!', 'Welcome, welcome.', 'Now there is a friendly sort.'],
  grieving: ['I am not much for talking today.', '*looks away* Yes?', 'Forgive me. Go on.'],
  drunk: ['Hic. Friend!', 'Pull up a chair, pal.', 'You look thirsty.'],
  angry: ['What now?', 'You picked a bad time.', 'Say your piece.'],
  afraid: ['*glances at the door* Quiet.', 'Not here. Please.', 'You should not be asking that.'],
};

/** Canned in-character line built from persona keywords; deterministic for the same input. */
export function mockNpcLine(req: NpcSayRequest): string {
  const rng = makeRng(seedFromPrompt(`${req.npc.id}|${req.playerText}`), 'mock-npc');
  const words = [...new Set((req.npc.persona.toLowerCase().match(/[a-z]{6,}/g) ?? []).filter((w) => !['should', 'always', 'rather'].includes(w)))];
  const k1 = words.length ? rng.pick(words) : 'trouble';
  const k2 = words.length > 1 ? rng.pick(words.filter((w) => w !== k1)) : req.npc.role;
  const opener = rng.pick(OPENERS[req.npc.mood]);
  const tails = [
    `I am ${req.npc.name}, ${req.npc.role} in these parts, and I know a thing or two about ${k1}.`,
    `Ask around about ${k1} and ${k2}; folks here will tell you I have a stake in both.`,
    `You want to know about ${k1}? That is a long story, and it starts at ${req.npc.place}.`,
  ];
  return `${opener} ${rng.pick(tails)}`;
}
