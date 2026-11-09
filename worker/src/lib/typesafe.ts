// Decision-model proxy: TypeSafe System One (Jev) with a Workers AI fallback.
import type { TickRequest, TickResponse } from '../../../app/src/net/types';
import type { Env } from './env';
import { isRecord } from './http';

export const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-1.14.0';
export const CLEF_MODEL = '@cf/cloudflare/clef-flash';

type Question = TickRequest['questions'][number];

/** Request body. Field names follow the System One docs as remembered; confirm against the live API. */
export function buildTypesafeBody(req: TickRequest): object {
  return {
    model: JEV_MODEL,
    context: req.stateSummary,
    questions: req.questions.map((q) => ({ type: 'choice', question: q.question, options: q.options })),
  };
}

function normalize(weights: number[]): number[] | null {
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  return sum > 0 ? clean.map((w) => w / sum) : null;
}

/** Accepts number[], {option: p}, or [{option|label|value, probability|p|prob}] and returns option order. */
function toVector(v: unknown, options: string[]): number[] | null {
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'number')) {
      return v.length === options.length ? normalize(v as number[]) : null;
    }
    const byLabel = new Map<string, number>();
    for (const e of v) {
      if (!isRecord(e)) return null;
      const label = [e.option, e.label, e.value, e.choice].find((x) => typeof x === 'string');
      const p = [e.probability, e.p, e.prob, e.score].find((x) => typeof x === 'number');
      if (typeof label !== 'string' || typeof p !== 'number') return null;
      byLabel.set(label, p);
    }
    return fromMap(byLabel, options);
  }
  if (isRecord(v)) {
    const byLabel = new Map<string, number>();
    for (const [k, p] of Object.entries(v)) if (typeof p === 'number') byLabel.set(k, p);
    return fromMap(byLabel, options);
  }
  return null;
}

function fromMap(m: Map<string, number>, options: string[]): number[] | null {
  const out: number[] = [];
  for (const o of options) {
    const p = m.get(o);
    if (p === undefined) return null;
    out.push(p);
  }
  return normalize(out);
}

function vectorFromItem(item: unknown, options: string[]): number[] | null {
  if (Array.isArray(item) || !isRecord(item)) return toVector(item, options);
  const answer = isRecord(item.answer) ? item.answer : {};
  const candidates = [item.probabilities, item.probs, item.distribution, answer.probabilities, answer.distribution];
  for (const c of candidates) {
    if (c === undefined) continue;
    const v = toVector(c, options);
    if (v) return v;
  }
  return null;
}

/**
 * Defensive parser for the System One response.
 * CONFIRM AGAINST A REAL RESPONSE: the exact shape is not verified. Two likely shapes are handled:
 *   A) an array (top level, or under results/questions/predictions) of { probabilities: number[] }
 *   B) { answers: [{ distribution: number[] | {option: p} | [{option, probability}] }] }
 * Returns one normalised vector per question, or null if any question cannot be read.
 */
export function parseTypesafe(raw: unknown, questions: Question[]): number[][] | null {
  let items: unknown = raw;
  if (isRecord(raw)) {
    items = raw.answers ?? raw.results ?? raw.questions ?? raw.predictions ?? (isRecord(raw.data) ? raw.data.answers : undefined);
  }
  if (!Array.isArray(items) || items.length !== questions.length) return null;
  const out: number[][] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q) return null;
    const v = vectorFromItem(items[i], q.options);
    if (!v) return null;
    out.push(v);
  }
  return out;
}

let warnedShape = false;

async function callJev(env: Env, req: TickRequest, dev: boolean): Promise<number[][] | null> {
  if (!env.TYPESAFE_API_KEY) return null;
  try {
    const res = await fetch(TYPESAFE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      body: JSON.stringify(buildTypesafeBody(req)),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as unknown;
    if (dev && !warnedShape) {
      warnedShape = true;
      console.warn('[tick] raw System One response shape (confirm parser):', JSON.stringify(raw).slice(0, 800));
    }
    return parseTypesafe(raw, req.questions);
  } catch {
    return null;
  }
}

interface AiRunner {
  run(model: string, input: unknown): Promise<unknown>;
}

async function callClef(env: Env, req: TickRequest): Promise<number[][] | null> {
  if (!env.AI) return null;
  const prompt =
    `World summary:\n${req.stateSummary}\n\n` +
    'For each question give a probability for every option, in order. ' +
    'Reply with JSON only: {"probs":[[...],[...]]} with one array per question.\n\n' +
    req.questions.map((q, i) => `Q${i + 1} (${q.npcId}): ${q.question}\nOptions: ${q.options.join(' | ')}`).join('\n\n');
  try {
    const out = await (env.AI as unknown as AiRunner).run(CLEF_MODEL, { prompt, max_tokens: 400 });
    const text = isRecord(out) && typeof out.response === 'string' ? out.response : '';
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as unknown;
    const probs = isRecord(parsed) ? parsed.probs : undefined;
    return parseTypesafe(probs, req.questions);
  } catch {
    return null;
  }
}

export async function decideTick(env: Env, req: TickRequest, dev: boolean): Promise<TickResponse> {
  const jev = await callJev(env, req, dev);
  if (jev) return { probs: jev, source: 'jev' };
  const clef = await callClef(env, req);
  if (clef) return { probs: clef, source: 'clef' };
  return { probs: [], source: 'none' };
}

/** Mock decision: first option (the schedule's 'continue') gets 0.5, the rest share the remainder unevenly. */
export function mockProbs(req: TickRequest): number[][] {
  return req.questions.map((q) => {
    const rest = q.options.length - 1;
    const weights = q.options.map((_, i) => (i === 0 ? 0 : 1 + ((i * 7) % 3)));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    return q.options.map((_, i) => (i === 0 ? 0.5 : rest > 0 ? (0.5 * (weights[i] ?? 0)) / wsum : 0));
  });
}
