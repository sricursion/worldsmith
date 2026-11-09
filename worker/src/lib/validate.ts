// Request validation. Pure functions returning values, never throwing.
import type { CompileRequest, NpcSayRequest, PatchRequest, TickRequest } from '../../../app/src/net/types';
import type { Mood, ThemeId } from '../../../app/src/world/spec';
import { isRecord } from './http';

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const MOODS: readonly Mood[] = ['calm', 'tense', 'cheerful', 'grieving', 'drunk', 'angry', 'afraid'];
const THEMES: readonly ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;

function str(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
}

function strArr(v: unknown, maxItems: number, maxLen: number): string[] | null {
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || x.length > maxLen) return null;
    out.push(x);
  }
  return out;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Model-generated text can run long; keep the first maxLen characters instead of failing the request. */
function clip(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max).trim();
  return t.length >= min ? t : null;
}

/** Wrong type is a rejection; extra entries are cut (the oldest first for newest-last lists) and long strings clipped. */
function clipArr(v: unknown, maxItems: number, maxLen: number, keep: 'first' | 'last' = 'first'): string[] | null {
  if (!Array.isArray(v)) return null;
  const items = keep === 'first' ? v.slice(0, maxItems) : v.slice(-maxItems);
  const out: string[] = [];
  for (const x of items) {
    if (typeof x !== 'string') return null;
    out.push(x.slice(0, maxLen));
  }
  return out;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function validateCompile(body: unknown): Checked<CompileRequest> {
  if (!isRecord(body)) return fail('body must be an object');
  const prompt = str(body.prompt, 1, 600);
  if (!prompt) return fail('prompt must be 1 to 600 characters');
  const seedRaw = num(body.seed);
  if (seedRaw === null) return fail('seed must be a number');
  return { ok: true, value: { prompt, seed: Math.floor(Math.abs(seedRaw)) % 4294967296 } };
}

export function validateNpcSay(body: unknown): Checked<NpcSayRequest> {
  if (!isRecord(body)) return fail('body must be an object');
  const sessionId = typeof body.sessionId === 'string' && SESSION_RE.test(body.sessionId) ? body.sessionId : null;
  if (!sessionId) return fail('sessionId invalid');
  const playerText = str(body.playerText, 1, 500);
  if (!playerText) return fail('playerText must be 1 to 500 characters');

  const n = body.npc;
  if (!isRecord(n)) return fail('npc missing');
  const id = str(n.id, 1, 80);
  const name = clip(n.name, 1, 80);
  const role = clip(n.role, 1, 80);
  const persona = clip(n.persona, 1, 1200);
  const place = clip(n.place, 1, 80);
  const knowledge = clipArr(n.knowledge, 24, 400);
  const revealed = clipArr(n.revealed, 24, 400);
  const mood = MOODS.find((m) => m === n.mood);
  if (!id || !name || !role || !persona || !place || !knowledge || !revealed || !mood) return fail('npc fields invalid');

  const c = body.context;
  if (!isRecord(c)) return fail('context missing');
  const title = clip(c.title, 1, 160);
  const era = clip(c.era, 1, 160);
  const theme = THEMES.find((t) => t === c.theme);
  const lexicon = clipArr(c.lexicon, 40, 120);
  const hour = num(c.hour);
  const day = num(c.day);
  const rules = clipArr(c.rules, 20, 300, 'last');
  const recentLog = clipArr(c.recentLog, 20, 300, 'last');
  if (!title || !era || !theme || !lexicon || hour === null || day === null || !rules || !recentLog) {
    return fail('context fields invalid');
  }
  if (!Array.isArray(c.activeBeats)) return fail('activeBeats invalid');
  const activeBeats: NpcSayRequest['context']['activeBeats'] = [];
  for (const b of c.activeBeats.slice(0, 8)) {
    if (!isRecord(b)) return fail('activeBeats invalid');
    const stepId = str(b.stepId, 1, 80);
    const objective = clip(b.objective, 1, 400);
    const beat = clip(b.beat, 1, 600);
    if (!stepId || !objective || !beat) return fail('activeBeats invalid');
    activeBeats.push({ stepId, objective, beat });
  }

  if (!Array.isArray(body.history)) return fail('history invalid');
  const history: NpcSayRequest['history'] = [];
  for (const t of body.history.slice(-24)) {
    if (!isRecord(t) || (t.speaker !== 'player' && t.speaker !== 'npc') || typeof t.text !== 'string') {
      return fail('history invalid');
    }
    history.push({ speaker: t.speaker, text: t.text.slice(0, 800) });
  }

  return {
    ok: true,
    value: {
      sessionId,
      npc: { id, name, role, persona, knowledge, revealed, mood, place },
      context: { title, era, theme, lexicon, hour, day, rules, activeBeats, recentLog },
      history: history.slice(-8),
      playerText,
    },
  };
}

export function validateTick(body: unknown): Checked<TickRequest> {
  if (!isRecord(body)) return fail('body must be an object');
  const sessionId = typeof body.sessionId === 'string' && SESSION_RE.test(body.sessionId) ? body.sessionId : null;
  if (!sessionId) return fail('sessionId invalid');
  const stateSummary = str(body.stateSummary, 1, 6000);
  if (!stateSummary) return fail('stateSummary must be 1 to 6000 characters');
  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 16) {
    return fail('questions must hold 1 to 16 entries');
  }
  const questions: TickRequest['questions'] = [];
  for (const q of body.questions) {
    if (!isRecord(q)) return fail('question invalid');
    const npcId = str(q.npcId, 1, 80);
    const question = str(q.question, 1, 600);
    const options = strArr(q.options, 8, 200);
    if (!npcId || !question || !options || options.length < 2) return fail('question invalid');
    questions.push({ npcId, question, options });
  }
  return { ok: true, value: { sessionId, stateSummary, questions } };
}

export function validatePatch(body: unknown): Checked<PatchRequest> {
  if (!isRecord(body)) return fail('body must be an object');
  const sessionId = typeof body.sessionId === 'string' && SESSION_RE.test(body.sessionId) ? body.sessionId : null;
  if (!sessionId) return fail('sessionId invalid');
  const ruleText = str(body.ruleText, 1, 400);
  if (!ruleText) return fail('ruleText must be 1 to 400 characters');
  const summary = typeof body.summary === 'string' && body.summary.length <= 6000 ? body.summary : null;
  if (summary === null) return fail('summary must be a string up to 6000 characters');
  return { ok: true, value: { sessionId, ruleText, summary } };
}

/** Cheap structural check for a shared town; the client runs the full schema on load. */
export function looksLikeSpec(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.title === 'string' &&
    typeof v.theme === 'string' &&
    Array.isArray(v.buildings) &&
    Array.isArray(v.npcs) &&
    isRecord(v.quest)
  );
}
