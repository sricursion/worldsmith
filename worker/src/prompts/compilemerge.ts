// Reading what the three compile stages return. Model output is treated as untrusted data: every
// section is parsed leniently, coerced into the shape of the spec, and merged into one WorldSpec.
// Pure functions, no I/O.
import type {
  Blueprint, BlueprintPart, BuildingRole, BuildingSpec, ItemSpec, LandmarkSpec, Mood, MoodSpec, NpcSpec, PartShape, PartTone,
  PropBlueprint, QuestSpec, QuestStep, RuleEffect, RuleSpec, ScheduleEntry, SitePattern, SiteSpec, SkyPreset, StyleSpec,
  ThemeId, WorldSpec,
} from '../../../app/src/world/spec';
import { SPEC_VERSION } from '../../../app/src/world/spec';
import { coerceMood, coerceSurfaces } from '../../../app/src/world/schema';
import { isRecord } from '../lib/http';
import { fogFor, mockAir, mockSurfaces, skyFor } from '../lib/mockmood';

// ---- Lenient JSON ------------------------------------------------------------------------------

/** Closes whatever a truncated JSON text left open (strings, arrays, objects) so the part that arrived can be read. */
export function closeTruncated(text: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inStr) out += '"';
  out = out.replace(/[,:]\s*$/, (m) => (m.trim() === ',' ? '' : ': null'));
  return out + stack.reverse().join('');
}

/** First JSON object in a model reply: tolerates a code fence, prose around it, trailing commas and a cut-off tail. */
export function parseLooseJson(text: string): unknown {
  const first = text.indexOf('{');
  if (first < 0) return null;
  const last = text.lastIndexOf('}');
  const attempts: string[] = [];
  if (last > first) attempts.push(text.slice(first, last + 1));
  attempts.push(closeTruncated(text.slice(first)));
  for (const a of attempts) {
    for (const t of [a, a.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const v: unknown = JSON.parse(t);
        if (isRecord(v)) return v;
      } catch {
        /* try the next repair */
      }
    }
  }
  return null;
}

// ---- Small coercers ----------------------------------------------------------------------------

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : d);
const num = (v: unknown, d: number): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const oneOf = <T extends string>(v: unknown, xs: readonly T[], d: T): T => xs.find((x) => x === v) ?? d;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown, cap = 40): string[] => list(v).map((x) => str(x)).filter((x) => x.length > 0).slice(0, cap);
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const slug = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const hex = (v: unknown, d: string): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t) ? t : d;
};

export const THEMES: readonly ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];
export const SKIES: readonly SkyPreset[] = ['dawn', 'day', 'dusk', 'night', 'overcast'];
export const ROLES: readonly BuildingRole[] = [
  'saloon', 'tavern', 'inn', 'bank', 'jail', 'sheriff', 'church', 'stable', 'general_store', 'market', 'blacksmith', 'house',
  'hotel', 'townhall', 'doctor', 'school', 'barber', 'undertaker', 'warehouse', 'workshop', 'lab', 'hangar', 'cantina',
  'command', 'habitat', 'reactor', 'cafe', 'office', 'shop', 'garage', 'apartment', 'station', 'plaza',
];
const SIZES = ['small', 'medium', 'large'] as const;
const PATTERNS: readonly SitePattern[] = ['street', 'ring', 'scatter', 'grid', 'terraces'];
const PATHS = ['road', 'track', 'none'] as const;
const MOODS: readonly Mood[] = ['calm', 'tense', 'cheerful', 'grieving', 'drunk', 'angry', 'afraid'];
const STANCES = ['friend', 'rival', 'family', 'debtor', 'suspicious', 'neutral'] as const;
const ACTIVITIES = ['work', 'rest', 'drink', 'pray', 'patrol', 'wander', 'trade', 'sleep', 'eat', 'guard'] as const;
const BASES = ['knight', 'barbarian', 'mage', 'rogue', 'ranger', 'rogue_hooded'] as const;
const KINDS = ['talk', 'fetch', 'deliver', 'visit', 'choose', 'confront'] as const;
const ACTIONS = ['continue', 'go_to', 'talk_to', 'idle', 'flee', 'investigate', 'follow_player', 'work'] as const;
const SHAPES: readonly PartShape[] = ['box', 'cylinder', 'cone', 'pyramid', 'gable', 'dome', 'sphere', 'wedge', 'arch', 'ring'];
const TONES: readonly PartTone[] = ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow'];

/** Nearest role by word, for a model that writes "tent" or "cave" where the schema wants a role. */
const ROLE_WORDS: [RegExp, BuildingRole][] = [
  [/inn|lodg|rest|sleep|bunk|dorm/, 'inn'], [/tavern|pub|bar\b|brew|drink|ale/, 'tavern'], [/market|bazaar|stall|trade|souk/, 'market'],
  [/store|shop|merchant|vendor/, 'general_store'], [/church|temple|shrine|chapel|altar|sanct|monaster/, 'church'],
  [/hall|council|moot|elder|chief|govern|court/, 'townhall'], [/forge|smith|smelt/, 'blacksmith'], [/stable|pen|kennel|corral|barn/, 'stable'],
  [/lab|study|alchem|observ|archive|library|school|academy/, 'lab'], [/doctor|heal|clinic|hospital|infirm/, 'doctor'],
  [/jail|prison|cell|watch|guard|barrack|sheriff|fort/, 'jail'], [/bank|vault|treasur|mint/, 'bank'], [/warehouse|store ?house|granary|silo|depot|dock/, 'warehouse'],
  [/work|mill|press|kiln|loom|craft/, 'workshop'], [/command|bridge|control|tower|beacon/, 'command'], [/hangar|port|pad/, 'hangar'],
  [/cafe|kitchen|bakery|tea|noodle|canteen/, 'cafe'], [/office|bureau|exchange/, 'office'], [/home|house|hut|cottage|tent|pod|burrow|nest|den|dwell/, 'house'],
  [/plaza|square|commons|green|fire ?pit|well/, 'plaza'],
];

function roleOf(role: unknown, label: string, id: string): BuildingRole {
  const direct = ROLES.find((r) => r === role);
  if (direct) return direct;
  const text = `${str(role)} ${label} ${id}`.toLowerCase();
  for (const [re, r] of ROLE_WORDS) if (re.test(text)) return r;
  return 'house';
}

function uniqueIds(ids: string[], prefix: string): string[] {
  const used = new Set<string>();
  return ids.map((raw, i) => {
    const base = slug(raw) || `${prefix}_${i + 1}`;
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}_${k}`;
    used.add(id);
    return id;
  });
}

// ---- Outline -----------------------------------------------------------------------------------

export interface OutlineBuilding { id: string; role: BuildingRole; label: string; size: 'small' | 'medium' | 'large'; keyBuilding: boolean; form: string }
export interface OutlineNpc { id: string; name: string; role: string; home: string; work: string }
export interface Outline {
  title: string; tagline: string; era: string; theme: ThemeId;
  site: SiteSpec; palette: { sky: SkyPreset; fog: number };
  /** Weather, grade, haze and sound, chosen in the first seconds so the client can set the air before the look arrives. */
  mood: MoodSpec;
  time: { startHour: number };
  buildings: OutlineBuilding[]; npcs: OutlineNpc[];
  quest: { title: string; premise: string }; lexicon: string[];
}

export function coerceSite(raw: unknown): SiteSpec {
  const r = rec(raw);
  const pattern = oneOf(r.pattern, PATTERNS, 'street');
  return {
    pattern,
    wild: clamp(num(r.wild, 0.3), 0, 1),
    paths: oneOf(r.paths, PATHS, pattern === 'scatter' ? 'track' : 'road'),
    spacing: clamp(num(r.spacing, 7), 2, 14),
  };
}

/** Null when the outline is too thin to build a world on (fewer than three buildings). */
/** A building or npc as the model writes it: a compact row or a full object. */
function fromRow(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (isRecord(v)) return v;
  if (!Array.isArray(v)) return null;
  const o: Record<string, unknown> = {};
  keys.forEach((k, i) => { o[k] = v[i]; });
  return o;
}
const BUILDING_ROW = ['id', 'role', 'label', 'form', 'size', 'keyBuilding'] as const;
const NPC_ROW = ['id', 'name', 'role', 'home', 'work'] as const;

const START_HOUR: Record<SkyPreset, number> = { dawn: 6, day: 9, dusk: 17.5, night: 21, overcast: 16 };

/**
 * Mood, starting hour, sky and fog as one consistent set. The model's mood and hour are kept; the sky preset
 * follows the hour (rain at noon is overcast, a night hour is a night sky) and fog never sits below what the
 * weather needs. Whatever the model left out is read from the prompt's own words.
 */
export function coerceAir(r: Record<string, unknown>, theme: ThemeId, prompt: string): Pick<Outline, 'mood' | 'time' | 'palette'> {
  const pal = rec(r.palette);
  const guess = mockAir(prompt, theme);
  const mood = isRecord(r.mood) ? coerceMood(r.mood) : guess.mood;
  const given = SKIES.find((x) => x === pal.sky);
  const rawHour = num(rec(r.time).startHour, num(r.startHour, NaN));
  const hour = Number.isFinite(rawHour) && rawHour >= 0 && rawHour < 24
    ? Math.round(rawHour * 4) / 4
    : given ? START_HOUR[given] : guess.startHour;
  const byHour = skyFor(hour, mood.weather);
  const sky = given === 'overcast' && byHour !== 'night' ? 'overcast' : byHour;
  return { mood, time: { startHour: Math.min(23, hour) }, palette: { sky, fog: fogFor(mood, clamp(num(pal.fog, 0.2), 0, 1)) } };
}

export function coerceOutline(raw: unknown, fallbackTheme: ThemeId, prompt = ''): Outline | null {
  const r = rec(raw);
  const src = list(r.buildings).map((b) => fromRow(b, BUILDING_ROW)).filter((b): b is Record<string, unknown> => b !== null).slice(0, 14);
  if (src.length < 3) return null;
  const ids = uniqueIds(src.map((b) => str(b.id) || str(b.label)), 'building');
  const buildings: OutlineBuilding[] = src.map((b, i) => {
    const id = ids[i] as string;
    const label = str(b.label, id.replace(/_/g, ' ')) || id;
    return { id, role: roleOf(b.role, label, id), label, size: oneOf(b.size, SIZES, 'medium'), keyBuilding: b.keyBuilding === true || b.keyBuilding === 1, form: str(b.form) };
  });
  if (!buildings.some((b) => b.keyBuilding)) for (const b of buildings.slice(0, 2)) b.keyBuilding = true;
  const bIds = new Set(buildings.map((b) => b.id));
  const nsrc = list(r.npcs).map((n) => fromRow(n, NPC_ROW)).filter((n): n is Record<string, unknown> => n !== null).slice(0, 10);
  const nids = uniqueIds(nsrc.map((n) => str(n.id) || str(n.name)), 'npc');
  const homeOf = (v: unknown, i: number): string => {
    const t = slug(str(v));
    return bIds.has(t) ? t : (buildings[i % buildings.length] as OutlineBuilding).id;
  };
  const npcs: OutlineNpc[] = nsrc.map((n, i) => {
    const w = slug(str(n.work));
    return {
      id: nids[i] as string, name: str(n.name, `Resident ${i + 1}`), role: str(n.role, 'resident'),
      home: homeOf(n.home, i), work: bIds.has(w) ? w : w === 'street' || w === 'plaza' ? w : homeOf(n.work, i + 1),
    };
  });
  const q = rec(r.quest);
  const theme = oneOf(r.theme, THEMES, fallbackTheme);
  return {
    title: str(r.title, 'Untitled place'), tagline: str(r.tagline), era: str(r.era, 'an unnamed age'),
    theme, site: coerceSite(r.site), ...coerceAir(r, theme, prompt),
    buildings, npcs, quest: { title: str(q.title), premise: str(q.premise) }, lexicon: strs(Array.isArray(r.lexicon) ? r.lexicon : q.lexicon, 14),
  };
}

// ---- Look --------------------------------------------------------------------------------------

export interface LookResult {
  style: StyleSpec; site: SiteSpec; blueprints: Blueprint[]; props: PropBlueprint[]; landmarks: LandmarkSpec[];
  buildings: { id: string; blueprint: string }[];
}

/** A part as the model writes it: either the compact row [shape,x,z,y,w,d,h,rot,tone,repeat,gap] or a full object. */
export function coercePart(raw: unknown): BlueprintPart | null {
  let o: Record<string, unknown>;
  if (Array.isArray(raw)) {
    const [shape, x, z, y, w, d, h, rot, tone, repeat, gap] = raw as unknown[];
    o = { shape, x, z, y, w, d, h, rot, tone, repeat, gap };
  } else if (isRecord(raw)) o = raw;
  else return null;
  const shape = SHAPES.find((s) => s === o.shape);
  if (!shape) return null;
  const repeat = Math.round(clamp(num(o.repeat, 1), 1, 12));
  return {
    shape, x: clamp(num(o.x, 0), -0.5, 0.5), z: clamp(num(o.z, 0), -0.5, 0.5), y: clamp(num(o.y, 0), 0, 30),
    w: clamp(num(o.w, 0.2), 0.02, 1.4), d: clamp(num(o.d, 0.2), 0.02, 1.4), h: clamp(num(o.h, 1), 0.05, 30),
    rot: num(o.rot, 0), tone: oneOf(o.tone, TONES, 'wall'), repeat, gap: repeat === 1 ? 0 : clamp(num(o.gap, 0.1), 0, 1.4),
  };
}

const coerceParts = (v: unknown, cap: number): BlueprintPart[] =>
  list(v).map(coercePart).filter((p): p is BlueprintPart => p !== null).slice(0, cap);

function coerceDials(v: unknown): Record<string, number | string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, number | string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
    else if (typeof x === 'string') out[k] = x;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const STYLE_KEYS = ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow', 'ground', 'road'] as const;

/** Ground under rain is never dry, whatever the look stage wrote. */
const RAIN_WET_FLOOR = 0.4;

/**
 * The model's style over a fallback. Surfaces are always present on the result: the model's kinds where they
 * are valid, else a set read from the prompt and the mood (or the fallback style's own when no mood is given).
 */
export function coerceStyle(raw: unknown, fallback: StyleSpec, air?: { prompt: string; theme: ThemeId; mood: MoodSpec }): StyleSpec {
  const r = rec(raw);
  const out: StyleSpec = { ...fallback, name: str(r.name, fallback.name) || fallback.name, variety: clamp(num(r.variety, fallback.variety), 0, 1) };
  for (const k of STYLE_KEYS) out[k] = hex(r[k], fallback[k]);
  const base = air ? mockSurfaces(air.prompt, air.theme, air.mood) : fallback.surfaces;
  const surfaces = coerceSurfaces(r.surfaces, base);
  const raining = air?.mood.weather === 'rain' || air?.mood.weather === 'storm';
  out.surfaces = raining ? { ...surfaces, wet: Math.max(surfaces.wet, RAIN_WET_FLOOR) } : surfaces;
  return out;
}

/** True when the model really chose a style (at least half of the colours were valid hex). */
export function styleIsReal(raw: unknown): boolean {
  const r = rec(raw);
  return STYLE_KEYS.filter((k) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(str(r[k]))).length >= 6;
}

export function coerceLook(raw: unknown, outline: Outline, fallbackStyle: StyleSpec, prompt = ''): LookResult | null {
  const r = rec(raw);
  const bsrc = list(r.blueprints).filter(isRecord).slice(0, 8);
  const ids = uniqueIds(bsrc.map((b) => str(b.id)), 'blueprint');
  const blueprints: Blueprint[] = [];
  bsrc.forEach((b, i) => {
    const parts = coerceParts(b.parts, 28);
    const family = str(b.family);
    if (!family && parts.length < 3) return;
    const bp: Blueprint = { id: ids[i] as string, summary: str(b.summary, 'building').slice(0, 140), parts, doorX: clamp(num(b.doorX, 0), -0.4, 0.4) };
    if (family) bp.family = family;
    const dials = coerceDials(b.dials);
    if (dials) bp.dials = dials;
    blueprints.push(bp);
  });
  if (blueprints.length === 0 || !styleIsReal(r.style)) return null;

  const psrc = list(r.props).filter(isRecord).slice(0, 6);
  const pkinds = uniqueIds(psrc.map((p) => str(p.kind)), 'prop');
  const props: PropBlueprint[] = [];
  psrc.forEach((p, i) => {
    const parts = coerceParts(p.parts, 8);
    const family = str(p.family);
    if (!family && parts.length === 0) return;
    const pb: PropBlueprint = { kind: pkinds[i] as string, size: clamp(num(p.size, 1.5), 0.3, 6), parts, weight: clamp(num(p.weight, 2), 1, 5) };
    if (family) pb.family = family;
    const dials = coerceDials(p.dials);
    if (dials) pb.dials = dials;
    props.push(pb);
  });

  const bIds = new Set(outline.buildings.map((b) => b.id));
  const lsrc = list(r.landmarks).filter(isRecord).slice(0, 2);
  const lids = uniqueIds(lsrc.map((l) => str(l.id)), 'landmark');
  const landmarks: LandmarkSpec[] = lsrc
    .map((l, i) => ({ id: lids[i] as string, prompt: str(l.prompt), place: str(l.place) === 'plaza' || bIds.has(str(l.place)) ? str(l.place) : 'plaza', height: clamp(num(l.height, 8), 2, 14) }))
    .filter((l) => l.prompt.length > 8);

  // One blueprint on every outline building: the model's pick when it names a real blueprint, else a spread.
  const bpIds = new Set(blueprints.map((b) => b.id));
  const picked = new Map<string, string>();
  for (const e of list(r.buildings).filter(isRecord)) {
    const bid = slug(str(e.id));
    const bp = slug(str(e.blueprint));
    if (bIds.has(bid) && bpIds.has(bp)) picked.set(bid, bp);
  }
  let next = 0;
  const buildings = outline.buildings.map((b) => ({ id: b.id, blueprint: picked.get(b.id) ?? (blueprints[next++ % blueprints.length] as Blueprint).id }));
  const style = coerceStyle(r.style, fallbackStyle, { prompt, theme: outline.theme, mood: outline.mood });
  return { style, site: outline.site, blueprints, props, landmarks, buildings };
}

// ---- Story -------------------------------------------------------------------------------------

export interface StoryResult { npcs: NpcSpec[]; items: ItemSpec[]; quest: QuestSpec; rules: RuleSpec[] }

function coerceSchedule(v: unknown, home: string, work: string, places: Set<string>): ScheduleEntry[] {
  const place = (p: string, d: string): string => (p === 'street' || p === 'plaza' || places.has(p) ? p : d);
  const out: ScheduleEntry[] = list(v).filter(isRecord).map((e) => {
    const activity = oneOf(e.activity, ACTIVITIES, 'wander');
    const fb = activity === 'sleep' || activity === 'rest' || activity === 'eat' ? home : work;
    return { hour: clamp(Math.round(num(e.hour, 8)), 0, 23), place: place(slug(str(e.place)), fb), activity };
  });
  const defaults: ScheduleEntry[] = [
    { hour: 22, place: home, activity: 'sleep' }, { hour: 8, place: work, activity: 'work' }, { hour: 18, place: 'plaza', activity: 'wander' },
  ];
  for (const d of defaults) if (out.length < 3 && !out.some((e) => e.hour === d.hour)) out.push(d);
  return out.sort((a, b) => a.hour - b.hour);
}

export function coerceNpcs(raw: unknown, outline: Outline): NpcSpec[] {
  const places = new Set(outline.buildings.map((b) => b.id));
  const src = list(raw).filter(isRecord).slice(0, 10);
  const ids = uniqueIds(src.map((n) => str(n.id) || str(n.name)), 'npc');
  const idSet = new Set(ids);
  return src.map((n, i) => {
    const id = ids[i] as string;
    const stub = outline.npcs.find((s) => s.id === id);
    const fallbackHome = stub?.home ?? (outline.buildings[i % outline.buildings.length] as OutlineBuilding).id;
    const home = places.has(slug(str(n.home))) ? slug(str(n.home)) : fallbackHome;
    const w = slug(str(n.work));
    const work = places.has(w) || w === 'street' || w === 'plaza' ? w : (stub?.work ?? home);
    const t = rec(n.temperament);
    const bias: Record<string, number> = {};
    for (const a of ACTIONS) bias[a] = clamp(num(rec(t.bias)[a], 0), -5, 5);
    const rels: NpcSpec['relationships'] = [];
    for (const rr of list(n.relationships).filter(isRecord)) {
      const to = slug(str(rr.npcId));
      if (idSet.has(to) && to !== id && !rels.some((x) => x.npcId === to)) rels.push({ npcId: to, stance: oneOf(rr.stance, STANCES, 'neutral') });
    }
    const ap = rec(n.appearance);
    const v = rec(n.voice);
    return {
      id, name: str(n.name, stub?.name ?? `Resident ${i + 1}`), role: str(n.role, stub?.role ?? 'resident'),
      persona: str(n.persona, 'A local with their own worries.'), knowledge: strs(n.knowledge, 12), secrets: strs(n.secrets, 6),
      home, work, schedule: coerceSchedule(n.schedule, home, work, places), relationships: rels,
      appearance: { base: oneOf(ap.base, BASES, BASES[i % BASES.length] as (typeof BASES)[number]), palette: clamp(Math.round(num(ap.palette, i % 4)), 0, 7) },
      temperament: { tau: clamp(num(t.tau, 1), 0.3, 3), bias },
      voice: { pitch: clamp(num(v.pitch, 1), 0.5, 2), rate: clamp(num(v.rate, 1), 0.5, 2) },
      mood: oneOf(n.mood, MOODS, 'calm'),
    };
  });
}

function coerceEffect(raw: unknown): RuleEffect | null {
  const e = rec(raw);
  const mood = (v: unknown): Mood => oneOf(v, MOODS, 'calm');
  switch (e.type) {
    case 'curfew': return { type: 'curfew', fromHour: clamp(num(e.fromHour, 22), 0, 23), toHour: clamp(num(e.toHour, 5), 0, 23), exemptRoles: strs(e.exemptRoles, 12) };
    case 'ban': {
      const out: RuleEffect = { type: 'ban', what: str(e.what, 'trouble'), where: str(e.where, 'town') };
      const enf = str(e.enforcer);
      if (enf) out.enforcer = enf;
      return out;
    }
    case 'price': return str(e.item) ? { type: 'price', item: str(e.item), multiplier: clamp(num(e.multiplier, 1.5), 0.1, 10) } : null;
    case 'mood': return { type: 'mood', who: str(e.who, 'all'), mood: mood(e.mood) };
    case 'time_scale': return { type: 'time_scale', minutesPerRealSecond: clamp(num(e.minutesPerRealSecond, 4), 0.5, 30) };
    case 'weather': return { type: 'weather', sky: oneOf(e.sky, SKIES, 'overcast'), fog: clamp(num(e.fog, 0.4), 0, 1) };
    case 'schedule_override': {
      const en = rec(e.entry);
      return { type: 'schedule_override', who: str(e.who), entry: { hour: clamp(num(en.hour, 20), 0, 23), place: str(en.place, 'street'), activity: oneOf(en.activity, ACTIVITIES, 'wander') } };
    }
    case 'relationship': return { type: 'relationship', a: str(e.a), b: str(e.b), stance: oneOf(e.stance, STANCES, 'neutral') };
    case 'custom': return { type: 'custom', summary: str(e.summary, 'a local custom') };
    default: return null;
  }
}

export function coerceStory(raw: unknown, outline: Outline): StoryResult | null {
  const r = rec(raw);
  const npcs = coerceNpcs(r.npcs, outline);
  if (npcs.length < 3) return null;
  const items: ItemSpec[] = list(r.items).filter(isRecord).slice(0, 20).map((it, i) => ({
    id: slug(str(it.id) || str(it.name)) || `item_${i + 1}`, name: str(it.name, 'Item'), description: str(it.description), holder: str(it.holder, 'player'),
  }));
  const q = rec(r.quest);
  const steps: QuestStep[] = list(q.steps).filter(isRecord).slice(0, 12).map((s, i) => {
    const kind = oneOf(s.kind, KINDS, 'talk');
    const step: QuestStep = {
      id: slug(str(s.id)) || `step_${i + 1}`, kind, target: str(s.target), requires: strs(s.requires, 8).map(slug),
      objective: str(s.objective), beat: str(s.beat),
    };
    if (str(s.item)) step.item = str(s.item);
    if (kind === 'choose') step.choices = list(s.choices).filter(isRecord).slice(0, 4).map((c) => ({ label: str(c.label, 'Choose'), unlocks: strs(c.unlocks, 6).map(slug) }));
    const reveals = strs(s.reveals, 6);
    if (reveals.length > 0) step.reveals = reveals;
    return step;
  });
  if (steps.length < 2) return null;
  const endings = list(q.endings).filter(isRecord).slice(0, 4).map((e) => ({
    stepId: slug(str(e.stepId)), label: str(e.label, 'The end'), tone: oneOf(e.tone, ['good', 'bitter', 'neutral'] as const, 'neutral'),
  }));
  const rules: RuleSpec[] = [];
  list(r.rules).filter(isRecord).slice(0, 6).forEach((ru, i) => {
    const effect = coerceEffect(ru.effect);
    if (effect) rules.push({ id: slug(str(ru.id)) || `rule_${i + 1}`, text: str(ru.text, 'A rule of the place.'), effect, source: 'world' });
  });
  return {
    npcs, items,
    quest: { id: slug(str(q.id)) || 'quest', title: str(q.title, outline.quest.title || 'A task'), hook: str(q.hook, outline.quest.premise), giver: slug(str(q.giver)) || (npcs[0] as NpcSpec).id, steps, endings },
    rules,
  };
}

// ---- Merge -------------------------------------------------------------------------------------

/** Outline, look and story into one WorldSpec. normalizeSpec still runs on the client; this makes the shape valid. */
export function mergeSpec(prompt: string, seed: number, outline: Outline, look: LookResult, story: StoryResult): WorldSpec {
  const bp = new Map(look.buildings.map((b) => [b.id, b.blueprint]));
  const buildings: BuildingSpec[] = outline.buildings.map((b) => {
    const out: BuildingSpec = { id: b.id, role: b.role, label: b.label, size: b.size };
    if (b.keyBuilding) out.keyBuilding = true;
    const blueprint = bp.get(b.id);
    if (blueprint) out.blueprint = blueprint;
    return out;
  });
  return {
    version: SPEC_VERSION, seed, prompt,
    title: outline.title, tagline: outline.tagline, theme: outline.theme, era: outline.era,
    palette: { ground: look.style.ground, accent: look.style.accent, sky: outline.palette.sky, fog: outline.palette.fog },
    time: { startHour: outline.time.startHour, minutesPerRealSecond: 4 },
    buildings, npcs: story.npcs, items: story.items, quest: story.quest, rules: story.rules, lexicon: outline.lexicon,
    style: look.style, site: look.site, mood: outline.mood, blueprints: look.blueprints, props: look.props, landmarks: look.landmarks,
  };
}
