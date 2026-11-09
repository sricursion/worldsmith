// Dialogue client: builds the trimmed context, streams a line from the Worker, and gates every
// line through validateLine so reasoning leaks never reach the player.
import type { Api } from '../net/api';
import type { DialogueContext, NpcSayRequest } from '../net/types';
import { hash32, makeRng, type Rng } from '../world/rng';
import type { Mood, NpcSpec, WorldSpec, WorldState } from '../world/spec';
import { activeRules } from '../world/state';

export interface DialogueTurn { speaker: 'player' | 'npc'; text: string }

export interface DialogueSession {
  say(playerText: string, onToken: (partial: string) => void): Promise<{ text: string; source: 'model' | 'fallback' }>;
  history: DialogueTurn[];
  close(): void;
}

const HISTORY_TURNS = 8;
const LOG_LINES = 5;
const MAX_CHARS = 600;
const MAX_DIRECTION = 40;

const LEAK_MARKERS: readonly string[] = [
  'let me think', 'i should', 'as an ai', 'i am an ai', 'language model',
  'the user', 'the player wants', '<thinking', 'reasoning:',
];

const CANNED: Record<Mood, readonly string[]> = {
  calm: [
    "Not now, friend. Come back when the street's quieter.",
    'I have a few things to see to, but ask away if it is quick.',
    "Folks call me {name}. I keep to myself most days, and that suits me.",
    'Things are steady enough. No sense borrowing trouble.',
    'Walk with me a moment, then. What is on your mind?',
    "I'd tell you more if I knew it. Try asking someone else.",
  ],
  tense: [
    'Not a good time. Keep your voice down.',
    'Everyone is watching everyone today. Say what you need, and quickly.',
    "I don't like how quiet it has gotten. Make it brief.",
    "You ask a lot of questions. I'm {name}, and I have nothing more to add just yet.",
    'Come back when things settle. If they settle.',
    'Careful who hears you, friend.',
  ],
  cheerful: [
    'Well, good to see a fresh face! Pull up and tell me what you need.',
    "Ha, you caught me in a fine mood. Ask away.",
    "Name's {name}, and today I have nothing to complain about.",
    'Not much to report, but I will happily say it twice.',
    "Come back later and I'll have a story for you.",
    'Lovely day for it, whatever it is you are up to.',
    'Keep your chin up, friend. Things have a way of working out.',
  ],
  grieving: [
    'Forgive me. I am not much company today.',
    'There has been a loss. I would rather not speak of it.',
    'Give me a moment, friend. Then ask again.',
    "I'm {name}. That is about all I can manage right now.",
    'It is hard to think straight. Come back another day.',
    'Thank you for stopping. I need to be alone a while.',
  ],
  drunk: [
    'Whoa there, friend. Say that slower, would you?',
    "I'm {name}, and I have had a little too much of everything.",
    'Hah! You look like someone who knows how to listen.',
    'Mind the floor, it keeps moving. What was the question?',
    'I know a thing or two, if I can only remember which.',
    'Come back in the morning. I will make more sense then.',
    "Don't tell anyone I said so, but I like you.",
  ],
  angry: [
    'Not now. I am in no mood for this.',
    'You have got some nerve. State your business and be gone.',
    "I'm {name}, and my patience has run out.",
    'Whatever it is, it can wait. Move along.',
    "Don't push me today, friend.",
    'I have said all I will say.',
  ],
  afraid: [
    'Please, keep your voice down. Someone may be listening.',
    "I do not know anything. I'm just {name}, trying to get through the day.",
    'It would be unwise to be seen talking. Please go.',
    'Things are not safe out here. Find shelter if you can.',
    'I cannot say. Not here, not now.',
    'Come back when it is light, if you are wise.',
  ],
};

export const MOODS: readonly Mood[] = ['calm', 'tense', 'cheerful', 'grieving', 'drunk', 'angry', 'afraid'];

export function cannedLine(npc: NpcSpec, mood: Mood, rng: Rng): string {
  const pool = CANNED[mood] ?? CANNED.calm;
  return rng.pick(pool).split('{name}').join(npc.name);
}

function isLeak(text: string): string | null {
  const lower = text.toLowerCase();
  for (const m of LEAK_MARKERS) if (lower.includes(m)) return m;
  return null;
}

function stripWrapQuotes(s: string): string {
  let t = s.trim();
  const pairs: [string, string][] = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’'], ['`', '`']];
  for (let changed = true; changed;) {
    changed = false;
    for (const [open, close] of pairs) {
      if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) {
        t = t.slice(1, -1).trim();
        changed = true;
      }
    }
  }
  return t;
}

const GENERIC_PREFIX = /^[A-Z][\p{L}'.-]*(?:\s+[A-Z][\p{L}'.-]*){0,2}:\s+/u;

function stripNamePrefix(s: string, npcName?: string): string {
  if (npcName) {
    const first = npcName.split(/\s+/)[0] ?? npcName;
    for (const n of [npcName, first]) {
      const re = new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i');
      if (re.test(s)) return s.replace(re, '');
    }
    return s;
  }
  return s.replace(GENERIC_PREFIX, '');
}

function longDirection(s: string): boolean {
  const re = /\[[^\]]*\]|\*[^*]+\*/g;
  for (const m of s.matchAll(re)) if (m[0].length > MAX_DIRECTION) return true;
  return false;
}

function trimToSentence(s: string): string {
  if (s.length <= MAX_CHARS) return s;
  const head = s.slice(0, MAX_CHARS);
  let end = -1;
  for (let i = head.length - 1; i >= 0; i--) {
    const c = head[i];
    if ((c === '.' || c === '!' || c === '?') && (i === head.length - 1 || /[\s"'”’]/.test(head[i + 1] ?? ''))) {
      end = i;
      break;
    }
  }
  if (end > 0) return head.slice(0, end + 1).trim();
  const sp = head.lastIndexOf(' ');
  return `${(sp > 0 ? head.slice(0, sp) : head).trim()}...`;
}

export function validateLine(text: string, npcName?: string): { ok: boolean; cleaned: string; reason?: string } {
  const raw = text.trim();
  if (raw.length === 0) return { ok: false, cleaned: '', reason: 'empty' };
  const cleaned = trimToSentence(stripNamePrefix(stripWrapQuotes(stripNamePrefix(stripWrapQuotes(raw), npcName)), npcName));
  const leak = isLeak(raw);
  if (leak !== null) return { ok: false, cleaned, reason: `leak: ${leak}` };
  if (longDirection(raw)) return { ok: false, cleaned, reason: 'long stage direction' };
  if (cleaned.length === 0) return { ok: false, cleaned: '', reason: 'empty' };
  return { ok: true, cleaned };
}

function buildContext(spec: WorldSpec, state: WorldState, npc: NpcSpec): DialogueContext {
  const unlocked = new Set(state.unlockedSteps);
  const done = new Set(state.completedSteps);
  const activeBeats = spec.quest.steps
    .filter((s) => unlocked.has(s.id) && !done.has(s.id) && s.target === npc.id)
    .map((s) => ({ stepId: s.id, objective: s.objective, beat: s.beat }));
  const nameLc = npc.name.toLowerCase();
  const recentLog = state.log
    .filter((l) => l.who === npc.id || l.what.toLowerCase().includes(nameLc) || l.what.includes(npc.id))
    .slice(-LOG_LINES)
    .map((l) => `${l.who}: ${l.what}`);
  return {
    title: spec.title,
    era: spec.era,
    theme: spec.theme,
    lexicon: spec.lexicon,
    hour: state.hour,
    day: state.day,
    rules: activeRules(state, state.hour).map((r) => r.text),
    activeBeats,
    recentLog,
  };
}

function revealedSecrets(state: WorldState, npc: NpcSpec): string[] {
  const out: string[] = [];
  npc.secrets.forEach((s, i) => {
    if (state.flags[`revealed:${npc.id}:${i}`]) out.push(s);
  });
  return out;
}

export function openDialogue(spec: WorldSpec, state: WorldState, npcId: string, api: Api): DialogueSession {
  const npc = spec.npcs.find((n) => n.id === npcId);
  const history: DialogueTurn[] = [];
  const abort = new AbortController();
  const sessionId = `${hash32(`${spec.seed}|${npcId}|${state.day}|${state.hour}`).toString(36)}-${npcId}`;
  let closed = false;
  let turn = 0;

  const fallbackFor = (): string => {
    if (!npc) return 'Not now, friend.';
    const mood = state.npcMoods[npc.id] ?? npc.mood;
    return cannedLine(npc, mood, makeRng(spec.seed, `dialogue:${npcId}:${turn}`));
  };

  const session: DialogueSession = {
    history,
    close(): void {
      closed = true;
      abort.abort();
    },
    async say(playerText, onToken) {
      turn += 1;
      const trimmed = playerText.trim();
      const finish = (text: string, source: 'model' | 'fallback'): { text: string; source: 'model' | 'fallback' } => {
        history.push({ speaker: 'player', text: trimmed });
        history.push({ speaker: 'npc', text });
        while (history.length > HISTORY_TURNS) history.shift();
        return { text, source };
      };
      if (!npc || closed) {
        const line = fallbackFor();
        if (!closed) onToken(line);
        return finish(line, 'fallback');
      }

      const req: NpcSayRequest = {
        sessionId,
        npc: {
          id: npc.id,
          name: npc.name,
          role: npc.role,
          persona: npc.persona,
          knowledge: npc.knowledge,
          revealed: revealedSecrets(state, npc),
          mood: state.npcMoods[npc.id] ?? npc.mood,
          place: state.npcPlaces[npc.id] ?? npc.home,
        },
        context: buildContext(spec, state, npc),
        history: history.slice(-HISTORY_TURNS),
        playerText: trimmed,
      };

      let acc = '';
      let suppressed = false;
      const handleToken = (t: string): void => {
        if (closed || suppressed) return;
        acc += t;
        // Once a leak marker or a long stage direction shows up, stop showing text and wait for the verdict.
        if (isLeak(acc) !== null || longDirection(acc)) {
          suppressed = true;
          return;
        }
        onToken(acc);
      };

      let verdict: { ok: boolean; cleaned: string } = { ok: false, cleaned: '' };
      try {
        const res = await api.npcSay(req, handleToken, abort.signal);
        if (res.ok) verdict = validateLine(res.text, npc.name);
      } catch {
        verdict = { ok: false, cleaned: '' };
      }

      if (verdict.ok) {
        if (!closed) onToken(verdict.cleaned);
        return finish(verdict.cleaned, 'model');
      }
      const line = fallbackFor();
      if (!closed) onToken(line);
      return finish(line, 'fallback');
    },
  };
  return session;
}
