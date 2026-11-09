// Keyword heuristic that turns rule text into a typed RuleSpec without a model (mock mode).
import type { Mood, RuleEffect, RuleSpec, SkyPreset } from '../../../app/src/world/spec';

const MOOD_WORDS: [RegExp, Mood][] = [
  [/\b(happy|cheer\w*|joy\w*|merry|festiv\w*)\b/, 'cheerful'],
  [/\b(angry|furious|mad|rage\w*|hostile)\b/, 'angry'],
  [/\b(afraid|scared|fear\w*|terrif\w*|panic\w*)\b/, 'afraid'],
  [/\b(tense|nervous|anxious|uneasy|suspicious)\b/, 'tense'],
  [/\b(sad|grie\w*|mourn\w*|sorrow\w*)\b/, 'grieving'],
  [/\b(drunk|tipsy|wasted)\b/, 'drunk'],
  [/\b(calm|peaceful|relaxed|quiet)\b/, 'calm'],
];

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** "9", "9pm", "9 pm", "21:00" -> 0..23 */
export function parseHour(text: string): number | null {
  const m = /\b(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  if (h > 24) return null;
  if (m[2] === 'pm' && h < 12) h += 12;
  if (m[2] === 'am' && h === 12) h = 0;
  if (!m[2] && h >= 1 && h <= 11 && /\b(after|from|at|past)\b/.test(text)) h += 12; // "after 9" means evening
  return h % 24;
}

function idTokens(summary: string): string[] {
  return [...new Set(summary.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [])];
}

function matchId(text: string, ids: string[]): string | null {
  const words: string[] = text.match(/[a-z]+/g) ?? [];
  for (const id of ids) {
    const stem = id.split('_')[0] ?? id;
    if (stem.length >= 3 && words.includes(stem)) return id;
  }
  return null;
}

function effectFor(text: string, summary: string): RuleEffect {
  const t = text.toLowerCase();
  const ids = idTokens(summary.toLowerCase());

  if (/\bcurfew\b/.test(t) || (/\b(after|past)\s+\d/.test(t) && /\b(inside|indoors|home|streets?|out)\b/.test(t))) {
    const from = parseHour(t) ?? 21;
    return { type: 'curfew', fromHour: from, toHour: from >= 12 ? 5 : from + 8, exemptRoles: ['sheriff', 'deputy', 'guard'] };
  }

  // Prohibitions come before weather: "nobody in the saloon after dark" is a ban, not a night sky.
  if (/\b(no|nobody|no one|ban\w*|forbid\w*|prohibit\w*|illegal|outlaw\w*|not allowed|may not|must not|cannot|can't)\b/.test(t)) {
    const what =
      /\b(?:no|ban(?:ned)?|forbid\w*|prohibit\w*|outlaw\w*)\s+([a-z]+(?:\s+[a-z]+)?)/.exec(t)?.[1] ??
      (/\b(nobody|no one|not allowed|may not|must not|cannot|can't)\b/.test(t) ? 'entry' : 'trouble');
    const where = matchId(t, ids.filter((id) => !/^(npc|item)_/.test(id))) ?? 'town';
    return { type: 'ban', what: what.replace(/\s+(in|at|on|the|for|from)$/, ''), where };
  }

  const weather = /\b(rain\w*|storm\w*|fog\w*|night|dark\w*|dusk|dawn|overcast)\b/.exec(t);
  if (weather) {
    const w = weather[1] ?? '';
    let sky: SkyPreset = 'overcast';
    let fog = 0.3;
    if (/^night|^dark/.test(w)) sky = 'night';
    else if (/^dusk/.test(w)) sky = 'dusk';
    else if (/^dawn/.test(w)) sky = 'dawn';
    else if (/^fog/.test(w)) fog = 0.8;
    else if (/^(rain|storm)/.test(w)) fog = 0.5;
    return { type: 'weather', sky, fog };
  }

  if (/\b(price\w*|cost\w*|expensive|cheap\w*|free|discount\w*|doubl\w*|half)\b/.test(t)) {
    const item = ids.find((id) => t.includes(id.replace(/_/g, ' ')) || t.includes(id)) ?? matchId(t, ids) ?? 'all';
    let multiplier = 1.5;
    const pct = /(\d{1,3})\s*%/.exec(t);
    if (pct) multiplier = Number(pct[1]) / 100;
    else if (/\b(free|half|cheap\w*|discount\w*)\b/.test(t)) multiplier = 0.5;
    else if (/\btripl\w*\b/.test(t)) multiplier = 3;
    else if (/\b(doubl\w*|expensive)\b/.test(t)) multiplier = 2;
    return { type: 'price', item, multiplier: Math.min(5, Math.max(0.1, multiplier)) };
  }

  const mood = MOOD_WORDS.find(([re]) => re.test(t));
  if (mood || /\b(everyone|everybody|all)\b/.test(t)) {
    const who = /\b(everyone|everybody|all)\b/.test(t) ? 'all' : (matchId(t, ids) ?? 'all');
    return { type: 'mood', who, mood: mood ? mood[1] : 'tense' };
  }

  return { type: 'custom', summary: text.trim().slice(0, 200) };
}

/** One rule per request in mock mode; the id is stable for identical text. */
export function mockRules(ruleText: string, summary: string): RuleSpec[] {
  return [
    {
      id: `rule_${hash(ruleText.trim().toLowerCase())}`,
      text: ruleText.trim(),
      effect: effectFor(ruleText, summary),
      source: 'player',
    },
  ];
}
