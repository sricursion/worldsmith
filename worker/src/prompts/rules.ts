// Prompt, hand-made JSON schema and sanitiser for rule patches.
// The schema mirrors RuleSpec in app/src/world/spec.ts exactly. Structured outputs require
// additionalProperties:false on every object and do not accept numeric bounds, so the sanitiser
// clamps ranges after parsing.
import type { Mood, RuleEffect, RuleSpec, SkyPreset, Stance } from '../../../app/src/world/spec';
import { isRecord } from '../lib/http';

const MOODS = ['calm', 'tense', 'cheerful', 'grieving', 'drunk', 'angry', 'afraid'] as const;
const STANCES = ['friend', 'rival', 'family', 'debtor', 'suspicious', 'neutral'] as const;
const SKIES = ['dawn', 'day', 'dusk', 'night', 'overcast'] as const;
const ACTIVITIES = ['work', 'rest', 'drink', 'pray', 'patrol', 'wander', 'trade', 'sleep', 'eat', 'guard'] as const;

const S = { type: 'string' } as const;
const N = { type: 'number' } as const;

function obj(type: string, props: Record<string, object>): object {
  const properties: Record<string, object> = { type: { type: 'string', enum: [type] }, ...props };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

const scheduleEntry = {
  type: 'object',
  properties: { hour: N, place: S, activity: { type: 'string', enum: [...ACTIVITIES] } },
  required: ['hour', 'place', 'activity'],
  additionalProperties: false,
};

export const RULE_EFFECT_SCHEMA = {
  anyOf: [
    obj('curfew', { fromHour: N, toHour: N, exemptRoles: { type: 'array', items: S } }),
    obj('ban', { what: S, where: S, enforcer: S }),
    obj('price', { item: S, multiplier: N }),
    obj('mood', { who: S, mood: { type: 'string', enum: [...MOODS] } }),
    obj('time_scale', { minutesPerRealSecond: N }),
    obj('weather', { sky: { type: 'string', enum: [...SKIES] }, fog: N }),
    obj('schedule_override', { who: S, entry: scheduleEntry }),
    obj('relationship', { a: S, b: S, stance: { type: 'string', enum: [...STANCES] } }),
    obj('custom', { summary: S }),
  ],
};

export function rulesJsonSchema(): object {
  const rule = {
    type: 'object',
    properties: { id: S, text: S, effect: RULE_EFFECT_SCHEMA, source: { type: 'string', enum: ['player'] } },
    required: ['id', 'text', 'effect', 'source'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: { rules: { type: 'array', items: rule } },
    required: ['rules'],
    additionalProperties: false,
  };
}

export const RULES_SYSTEM = `You translate a player's plain-language wish about their town into one to three typed rules the game engine can enforce. The engine runs the world; you only emit data.

Effect types and when to use them:
- curfew: people must be at home between fromHour and toHour (0 to 24, town hours; toHour may be smaller than fromHour to wrap past midnight). exemptRoles lists NPC roles that may stay out (for example "sheriff").
- ban: something is forbidden. "what" is a short noun phrase ("guns", "singing"), "where" is a building id from the summary or "town". "enforcer" is an NPC id, or an empty string when nobody in particular enforces it.
- price: multiply the price of an item id (from the summary) or "all". 0.5 is half price, 2 is double.
- mood: set the mood of an NPC id or "all" to one of calm, tense, cheerful, grieving, drunk, angry, afraid.
- time_scale: how fast the clock runs, minutesPerRealSecond between 0.5 and 12.
- weather: sky is dawn, day, dusk, night or overcast; fog is 0 to 1.
- schedule_override: force one NPC (id) to be somewhere at an hour: entry has hour, place (building id, "street" or "plaza") and activity.
- relationship: set how NPC a (id) regards NPC b (id): friend, rival, family, debtor, suspicious or neutral.
- custom: last resort, a one-sentence summary the dialogue will reflect but the engine does not enforce.

Rules of the job:
- Use only ids that appear in the summary. Never invent a building, NPC or item.
- Prefer the most specific typed effect. Use custom only when nothing else fits.
- Set "source" to "player". Give each rule a short unique snake_case id starting with "rule_".
- "text" restates the rule in the player's voice in one short sentence.
- Return between one and three rules, no more.`;

export function rulesUserMessage(ruleText: string, summary: string): string {
  return `Town summary:\n${summary}\n\nPlayer's rule: ${ruleText}`;
}

const isMood = (v: unknown): v is Mood => MOODS.some((m) => m === v);
const isStance = (v: unknown): v is Stance => STANCES.some((m) => m === v);
const isSky = (v: unknown): v is SkyPreset => SKIES.some((m) => m === v);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const s = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sanitizeEffect(e: unknown): RuleEffect | null {
  if (!isRecord(e)) return null;
  switch (e.type) {
    case 'curfew': {
      const from = n(e.fromHour);
      const to = n(e.toHour);
      if (from === null || to === null) return null;
      const roles = Array.isArray(e.exemptRoles) ? e.exemptRoles.filter((r): r is string => typeof r === 'string').slice(0, 8) : [];
      return { type: 'curfew', fromHour: clamp(from, 0, 24), toHour: clamp(to, 0, 24), exemptRoles: roles };
    }
    case 'ban': {
      const what = s(e.what);
      const where = s(e.where, 80);
      if (!what || !where) return null;
      const enforcer = s(e.enforcer, 80);
      return enforcer ? { type: 'ban', what, where, enforcer } : { type: 'ban', what, where };
    }
    case 'price': {
      const item = s(e.item, 80);
      const m = n(e.multiplier);
      return item && m !== null ? { type: 'price', item, multiplier: clamp(m, 0.1, 5) } : null;
    }
    case 'mood': {
      const who = s(e.who, 80);
      return who && isMood(e.mood) ? { type: 'mood', who, mood: e.mood } : null;
    }
    case 'time_scale': {
      const m = n(e.minutesPerRealSecond);
      return m !== null ? { type: 'time_scale', minutesPerRealSecond: clamp(m, 0.5, 12) } : null;
    }
    case 'weather': {
      const fog = n(e.fog);
      return isSky(e.sky) && fog !== null ? { type: 'weather', sky: e.sky, fog: clamp(fog, 0, 1) } : null;
    }
    case 'schedule_override': {
      const who = s(e.who, 80);
      const en = e.entry;
      if (!who || !isRecord(en)) return null;
      const hour = n(en.hour);
      const place = s(en.place, 80);
      const act = ACTIVITIES.find((a) => a === en.activity);
      if (hour === null || !place || !act) return null;
      return { type: 'schedule_override', who, entry: { hour: clamp(Math.floor(hour), 0, 23), place, activity: act } };
    }
    case 'relationship': {
      const a = s(e.a, 80);
      const b = s(e.b, 80);
      return a && b && isStance(e.stance) ? { type: 'relationship', a, b, stance: e.stance } : null;
    }
    case 'custom': {
      const summary = s(e.summary, 300);
      return summary ? { type: 'custom', summary } : null;
    }
    default:
      return null;
  }
}

/** Keep valid rules only (max 3), force source 'player', make ids unique. */
export function sanitizeRules(raw: unknown): RuleSpec[] {
  const list = isRecord(raw) && Array.isArray(raw.rules) ? raw.rules : [];
  const out: RuleSpec[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (!isRecord(r)) continue;
    const effect = sanitizeEffect(r.effect);
    const text = s(r.text, 300);
    if (!effect || !text) continue;
    let id = (s(r.id, 60) ?? 'rule').replace(/[^a-z0-9_]/gi, '_');
    if (!id.startsWith('rule_')) id = `rule_${id}`;
    let k = 2;
    const base = id;
    while (seen.has(id)) id = `${base}_${k++}`;
    seen.add(id);
    out.push({ id, text, effect, source: 'player' });
    if (out.length === 3) break;
  }
  return out;
}
