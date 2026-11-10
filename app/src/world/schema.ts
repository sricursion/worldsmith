// Zod mirror of spec.ts, plus normalisation and the JSON schema handed to the compile model.
import { z } from 'zod';
import { SPEC_VERSION } from './spec';
import { repairBlueprint } from './blueprints';
import type {
  Blueprint, BlueprintPart, BuildingRole, BuildingSpec, LandmarkSpec, NpcActionId, NpcSpec, PartShape, PartTone,
  PropBlueprint, QuestStep, RuleEffect, RuleSpec, ScheduleEntry, StyleSpec, WorldSpec,
} from './spec';

export const NPC_ACTION_IDS: readonly NpcActionId[] = [
  'continue', 'go_to', 'talk_to', 'idle', 'flee', 'investigate', 'follow_player', 'work',
];

const ThemeS = z.enum(['western', 'medieval', 'scifi', 'modern']);
const SkyS = z.enum(['dawn', 'day', 'dusk', 'night', 'overcast']);
const RoleS = z.enum([
  'saloon', 'tavern', 'inn', 'bank', 'jail', 'sheriff', 'church', 'stable',
  'general_store', 'market', 'blacksmith', 'house', 'hotel', 'townhall',
  'doctor', 'school', 'barber', 'undertaker', 'warehouse', 'workshop',
  'lab', 'hangar', 'cantina', 'command', 'habitat', 'reactor',
  'cafe', 'office', 'shop', 'garage', 'apartment', 'station', 'plaza',
]);
const SizeS = z.enum(['small', 'medium', 'large']);
const MoodS = z.enum(['calm', 'tense', 'cheerful', 'grieving', 'drunk', 'angry', 'afraid']);
const StanceS = z.enum(['friend', 'rival', 'family', 'debtor', 'suspicious', 'neutral']);
const ActivityS = z.enum(['work', 'rest', 'drink', 'pray', 'patrol', 'wander', 'trade', 'sleep', 'eat', 'guard']);
const BaseS = z.enum(['knight', 'barbarian', 'mage', 'rogue', 'ranger', 'rogue_hooded']);

const ScheduleEntryS = z.object({ hour: z.number(), place: z.string(), activity: ActivityS });

const BuildingS = z.object({
  id: z.string(),
  role: RoleS,
  label: z.string(),
  size: SizeS,
  position: z.object({ x: z.number(), z: z.number(), rotY: z.number() }).optional(),
  footprint: z.object({ w: z.number(), d: z.number() }).optional(),
  keyBuilding: z.boolean().optional(),
  blueprint: z.string().optional(),
});

const NpcS = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  persona: z.string(),
  knowledge: z.array(z.string()),
  secrets: z.array(z.string()),
  home: z.string(),
  work: z.string(),
  schedule: z.array(ScheduleEntryS),
  relationships: z.array(z.object({ npcId: z.string(), stance: StanceS })),
  appearance: z.object({ base: BaseS, palette: z.number() }),
  temperament: z.object({ tau: z.number(), bias: z.record(z.string(), z.number()) }),
  voice: z.object({ pitch: z.number(), rate: z.number() }),
  mood: MoodS,
});

const ItemS = z.object({ id: z.string(), name: z.string(), description: z.string(), holder: z.string() });

const StepS = z.object({
  id: z.string(),
  kind: z.enum(['talk', 'fetch', 'deliver', 'visit', 'choose', 'confront']),
  target: z.string(),
  item: z.string().optional(),
  requires: z.array(z.string()),
  objective: z.string(),
  beat: z.string(),
  choices: z.array(z.object({ label: z.string(), unlocks: z.array(z.string()) })).optional(),
  reveals: z.array(z.string()).optional(),
});

const QuestS = z.object({
  id: z.string(),
  title: z.string(),
  hook: z.string(),
  giver: z.string(),
  steps: z.array(StepS),
  endings: z.array(z.object({ stepId: z.string(), label: z.string(), tone: z.enum(['good', 'bitter', 'neutral']) })),
});

const EffectS = z.discriminatedUnion('type', [
  z.object({ type: z.literal('curfew'), fromHour: z.number(), toHour: z.number(), exemptRoles: z.array(z.string()) }),
  z.object({ type: z.literal('ban'), what: z.string(), where: z.string(), enforcer: z.string().optional() }),
  z.object({ type: z.literal('price'), item: z.string(), multiplier: z.number() }),
  z.object({ type: z.literal('mood'), who: z.string(), mood: MoodS }),
  z.object({ type: z.literal('time_scale'), minutesPerRealSecond: z.number() }),
  z.object({ type: z.literal('weather'), sky: SkyS, fog: z.number() }),
  z.object({ type: z.literal('schedule_override'), who: z.string(), entry: ScheduleEntryS }),
  z.object({ type: z.literal('relationship'), a: z.string(), b: z.string(), stance: StanceS }),
  z.object({ type: z.literal('custom'), summary: z.string() }),
]);

const RuleS = z.object({ id: z.string(), text: z.string(), effect: EffectS, source: z.enum(['world', 'player']) });

const PART_SHAPES: readonly PartShape[] = ['box', 'cylinder', 'cone', 'pyramid', 'gable', 'dome', 'sphere', 'wedge', 'arch', 'ring'];
const PART_TONES: readonly PartTone[] = ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow'];

const PartS = z.object({
  shape: z.enum(PART_SHAPES as [PartShape, ...PartShape[]]),
  x: z.number(),
  z: z.number(),
  y: z.number(),
  w: z.number(),
  d: z.number(),
  h: z.number(),
  rot: z.number(),
  tone: z.enum(PART_TONES as [PartTone, ...PartTone[]]),
  repeat: z.number(),
  gap: z.number(),
});

const BlueprintS = z.object({ id: z.string(), summary: z.string(), parts: z.array(PartS), doorX: z.number() });
const PropS = z.object({ kind: z.string(), size: z.number(), parts: z.array(PartS), weight: z.number() });
const StyleS = z.object({
  name: z.string(),
  wall: z.string(),
  wall2: z.string(),
  roof: z.string(),
  trim: z.string(),
  accent: z.string(),
  dark: z.string(),
  glass: z.string(),
  glow: z.string(),
  ground: z.string(),
  road: z.string(),
  variety: z.number(),
});
const LandmarkS = z.object({ id: z.string(), prompt: z.string(), place: z.string(), height: z.number() });

export const WorldSpecSchema: z.ZodType<WorldSpec> = z.object({
  version: z.literal(SPEC_VERSION),
  seed: z.number(),
  prompt: z.string(),
  title: z.string(),
  tagline: z.string(),
  theme: ThemeS,
  era: z.string(),
  palette: z.object({ ground: z.string(), accent: z.string(), sky: SkyS, fog: z.number() }),
  time: z.object({ startHour: z.number(), minutesPerRealSecond: z.number() }),
  buildings: z.array(BuildingS),
  npcs: z.array(NpcS),
  items: z.array(ItemS),
  quest: QuestS,
  rules: z.array(RuleS),
  lexicon: z.array(z.string()),
  style: StyleS.optional(),
  blueprints: z.array(BlueprintS).optional(),
  props: z.array(PropS).optional(),
  landmarks: z.array(LandmarkS).optional(),
});

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const p of path) out += typeof p === 'number' ? `[${p}]` : `${out ? '.' : ''}${String(p)}`;
  return out || '(root)';
}

export function validateSpec(raw: unknown): { ok: true; value: WorldSpec } | { ok: false; error: string } {
  const r = WorldSpecSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  const more = r.error.issues.length > 1 ? ` (+${r.error.issues.length - 1} more)` : '';
  if (!first) return { ok: false, error: '(root): invalid spec' };
  return { ok: false, error: `${formatPath(first.path)}: ${first.message}${more}` };
}

// ---------------------------------------------------------------------------------------------
// JSON schema for the compile model
// ---------------------------------------------------------------------------------------------

const DROP_KEYS = new Set([
  '$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength',
  'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'propertyNames',
]);

function cleanJson(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanJson);
  if (typeof node !== 'object' || node === null) return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (DROP_KEYS.has(k)) continue;
    // Structured-output schemas accept anyOf only; the discriminated union exports as oneOf.
    if (k === 'oneOf') {
      out.anyOf = cleanJson(v);
      continue;
    }
    if (k === 'properties' && typeof v === 'object' && v !== null) {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = cleanJson(pv);
      out[k] = props;
    } else out[k] = cleanJson(v);
  }
  // A record (only temperament.bias) becomes an explicit object over the action ids.
  if (out.type === 'object' && out.properties === undefined && typeof out.additionalProperties === 'object') {
    const valueSchema = out.additionalProperties;
    const props: Record<string, unknown> = {};
    for (const id of NPC_ACTION_IDS) props[id] = valueSchema;
    out.properties = props;
  }
  if (out.type === 'object') out.additionalProperties = false;
  if (Array.isArray(out.required) && out.required.length === 0) delete out.required;
  return out;
}

export function worldSpecJsonSchema(): object {
  const raw = z.toJSONSchema(WorldSpecSchema, { io: 'output' });
  const cleaned = cleanJson(raw) as Record<string, unknown>;
  delete cleaned.$defs;
  // Optional in zod so old share links validate; required for the model so every new town carries them.
  const require = (node: unknown, keys: string[]): void => {
    const o = node as { required?: string[] };
    o.required = [...new Set([...(o.required ?? []), ...keys])];
  };
  const props = cleaned.properties as Record<string, unknown>;
  require(cleaned, ['style', 'blueprints', 'props', 'landmarks']);
  require((props.buildings as { items: unknown }).items, ['blueprint']);
  return cleaned;
}

// ---------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export function slugify(s: string, fallback = 'item'): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return out || fallback;
}

interface IdMap { ids: string[]; resolve(v: string | undefined): string | undefined }

function makeIdMap(olds: string[], prefix: string): IdMap {
  const used = new Set<string>();
  const map = new Map<string, string>();
  const ids: string[] = [];
  olds.forEach((o, i) => {
    const base = slugify(o, `${prefix}_${i + 1}`);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    ids.push(id);
    if (!map.has(o)) map.set(o, id);
  });
  olds.forEach((o, i) => {
    const sl = slugify(o, '');
    if (sl && !map.has(sl)) map.set(sl, ids[i] as string);
  });
  for (const id of ids) if (!map.has(id)) map.set(id, id);
  return {
    ids,
    resolve: (v) => (v === undefined ? undefined : (map.get(v) ?? map.get(slugify(v, '')))),
  };
}

const HOUSING: BuildingRole[] = ['house', 'apartment', 'habitat', 'inn', 'hotel'];
const ROLE_HINTS: [RegExp, BuildingRole[]][] = [
  [/sheriff|marshal|deputy|constable|police|officer/i, ['sheriff', 'jail', 'station', 'townhall']],
  [/bartend|barkeep|innkeep|publican|tavern|saloon/i, ['saloon', 'tavern', 'inn', 'cantina', 'cafe']],
  [/bank|clerk|reeve|mayor|steward/i, ['bank', 'townhall', 'office', 'command']],
  [/preach|priest|monk|abbot|reverend|pastor|chaplain|brother/i, ['church']],
  [/stable|groom|ostler|farrier/i, ['stable']],
  [/doctor|herbal|healer|physician|nurse|medic/i, ['doctor', 'lab']],
  [/smith/i, ['blacksmith', 'workshop', 'garage']],
  [/mechanic/i, ['garage', 'workshop']],
  [/teacher|professor/i, ['school']],
  [/merchant|shopkeep|grocer|trader|vendor/i, ['general_store', 'market', 'shop', 'warehouse']],
  [/pilot/i, ['hangar']],
  [/engineer|technician/i, ['reactor', 'workshop']],
  [/scien|research/i, ['lab']],
  [/command|captain|chief of/i, ['command', 'townhall', 'sheriff']],
  [/undertaker/i, ['undertaker']],
  [/barber/i, ['barber']],
  [/barista|baker|cook/i, ['cafe', 'tavern', 'saloon']],
  [/haul|dock|porter|loader/i, ['warehouse']],
];

function buildingForRole(role: string, buildings: BuildingSpec[]): string | undefined {
  for (const [re, roles] of ROLE_HINTS) {
    if (!re.test(role)) continue;
    for (const r of roles) {
      const b = buildings.find((x) => x.role === r);
      if (b) return b.id;
    }
  }
  return undefined;
}

function homeFallback(buildings: BuildingSpec[]): string {
  for (const r of HOUSING) {
    const b = buildings.find((x) => x.role === r);
    if (b) return b.id;
  }
  return buildings[0]?.id ?? 'street';
}

function fillSchedule(entries: ScheduleEntry[], home: string, work: string): ScheduleEntry[] {
  const out = [...entries];
  const defaults: ScheduleEntry[] = [
    { hour: 22, place: home, activity: 'sleep' },
    { hour: 8, place: work, activity: 'work' },
    { hour: 18, place: 'plaza', activity: 'wander' },
    { hour: 13, place: work, activity: 'eat' },
  ];
  for (const d of defaults) {
    if (out.length >= 3) break;
    if (!out.some((e) => e.hour === d.hour)) out.push(d);
  }
  return out;
}

const sortByHour = (xs: ScheduleEntry[]): ScheduleEntry[] =>
  xs.map((e, i) => ({ e, i })).sort((a, b) => a.e.hour - b.e.hour || a.i - b.i).map((x) => x.e);

const trimList = (xs: string[], cap: number): string[] =>
  xs.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, cap);

interface FixCtx {
  bMap: IdMap; nMap: IdMap; itemId(v: string | undefined): string | undefined;
  place(v: string | undefined): string | undefined;
}

function fixEffect(e: RuleEffect, c: FixCtx): RuleEffect | null {
  switch (e.type) {
    case 'curfew':
      return { ...e, fromHour: clamp(e.fromHour, 0, 23), toHour: clamp(e.toHour, 0, 23), exemptRoles: trimList(e.exemptRoles, 12) };
    case 'ban': {
      const where = e.where === 'town' ? 'town' : (c.bMap.resolve(e.where) ?? 'town');
      const enforcer = c.nMap.resolve(e.enforcer);
      const out: RuleEffect = { type: 'ban', what: e.what, where };
      if (enforcer) out.enforcer = enforcer;
      return out;
    }
    case 'price': {
      const item = c.itemId(e.item);
      return item ? { ...e, item, multiplier: clamp(e.multiplier, 0.1, 10) } : null;
    }
    case 'mood': {
      const who = e.who === 'all' ? 'all' : c.nMap.resolve(e.who);
      return who ? { ...e, who } : null;
    }
    case 'time_scale':
      return { ...e, minutesPerRealSecond: clamp(e.minutesPerRealSecond, 0.5, 30) };
    case 'weather':
      return { ...e, fog: clamp(e.fog, 0, 1) };
    case 'schedule_override': {
      const who = c.nMap.resolve(e.who);
      if (!who) return null;
      return { ...e, who, entry: { ...e.entry, hour: clamp(e.entry.hour, 0, 23), place: c.place(e.entry.place) ?? 'street' } };
    }
    case 'relationship': {
      const a = c.nMap.resolve(e.a);
      const b = c.nMap.resolve(e.b);
      return a && b && a !== b ? { ...e, a, b } : null;
    }
    case 'custom':
      return e;
  }
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexOr(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  if (!HEX_RE.test(t)) return fallback;
  const h = t.slice(1).toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

const NEUTRAL_STYLE: StyleSpec = {
  name: 'plain',
  wall: '#b8a88a', wall2: '#9c8c70', roof: '#6b4f3a', trim: '#d8ceb8', accent: '#b5532d',
  dark: '#2b2622', glass: '#3b5568', glow: '#ffd27a', ground: '#8a8a6a', road: '#6e6a60', variety: 0.2,
};

function fixStyle(s: StyleSpec): StyleSpec {
  const out: StyleSpec = { ...NEUTRAL_STYLE, name: s.name.trim() || NEUTRAL_STYLE.name, variety: clamp(s.variety, 0, 1) };
  for (const k of ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow', 'ground', 'road'] as const) {
    out[k] = hexOr(s[k], NEUTRAL_STYLE[k]);
  }
  return out;
}

function fixPart(p: BlueprintPart): BlueprintPart {
  const repeat = Math.round(clamp(p.repeat, 1, 12));
  const rot = Number.isFinite(p.rot) ? (p.rot >= -180 && p.rot <= 180 ? p.rot : ((((p.rot + 180) % 360) + 360) % 360) - 180) : 0;
  return {
    shape: PART_SHAPES.includes(p.shape) ? p.shape : 'box',
    x: clamp(p.x, -0.5, 0.5),
    z: clamp(p.z, -0.5, 0.5),
    y: clamp(p.y, 0, 30),
    w: clamp(p.w, 0.02, 1.4),
    d: clamp(p.d, 0.02, 1.4),
    h: clamp(p.h, 0.05, 30),
    rot,
    tone: PART_TONES.includes(p.tone) ? p.tone : 'wall',
    repeat,
    gap: repeat === 1 ? 0 : clamp(p.gap, 0, 1.4),
  };
}

function fixBlueprints(input: Blueprint[]): Blueprint[] {
  const src = input.slice(0, 8);
  const ids = makeIdMap(src.map((b) => b.id), 'blueprint').ids;
  return src.map((b, i) =>
    repairBlueprint({
      id: ids[i] as string,
      summary: b.summary.trim(),
      parts: b.parts.slice(0, 28).map(fixPart),
      doorX: clamp(b.doorX, -0.4, 0.4),
    }),
  );
}

function fixProps(input: PropBlueprint[]): PropBlueprint[] {
  const src = input.slice(0, 6);
  const ids = makeIdMap(src.map((p) => p.kind), 'prop').ids;
  const out: PropBlueprint[] = [];
  src.forEach((p, i) => {
    if (p.parts.length === 0) return;
    out.push({
      kind: ids[i] as string,
      size: clamp(p.size, 0.3, 6),
      parts: p.parts.slice(0, 8).map(fixPart),
      weight: clamp(p.weight, 1, 5),
    });
  });
  return out;
}

function fixLandmarks(input: LandmarkSpec[], bMap: IdMap): LandmarkSpec[] {
  const src = input.slice(0, 2);
  const ids = makeIdMap(src.map((l) => l.id), 'landmark').ids;
  return src.map((l, i) => ({
    id: ids[i] as string,
    prompt: l.prompt.trim(),
    place: l.place === 'plaza' ? 'plaza' : (bMap.resolve(l.place) ?? 'plaza'),
    height: clamp(l.height, 2, 14),
  }));
}

/** Picks a blueprint for a building that has none: by role word in id or summary, else round-robin. */
function assignBlueprints(buildings: BuildingSpec[], bps: Blueprint[]): BuildingSpec[] {
  let next = 0;
  return buildings.map((b) => {
    if (b.blueprint !== undefined) return b;
    const words = [b.role.replace(/_/g, ' ')];
    const last = b.role.split('_').pop() ?? b.role;
    if (last.length >= 4) words.push(last);
    let hit: Blueprint | undefined;
    for (const w of words) {
      hit = bps.find((bp) => bp.id.replace(/_/g, ' ').includes(w) || bp.summary.toLowerCase().includes(w));
      if (hit) break;
    }
    return { ...b, blueprint: (hit ?? (bps[next++ % bps.length] as Blueprint)).id };
  });
}

export function normalizeSpec(input: WorldSpec): WorldSpec {
  const spec = structuredClone(input);

  // Buildings: 6..14, padded with cottages when the model undershoots.
  let buildings = spec.buildings.slice(0, 14);
  for (let i = buildings.length; i < 6; i++) {
    buildings.push({ id: `cottage_${i + 1}`, role: 'house', label: 'Cottage', size: 'small' });
  }
  const bMap = makeIdMap(buildings.map((b) => b.id), 'building');
  buildings = buildings.map((b, i) => ({ ...b, id: bMap.ids[i] as string, label: b.label.trim() || b.id }));

  const bps = spec.blueprints ? fixBlueprints(spec.blueprints) : undefined;
  const bpMap = makeIdMap((spec.blueprints ?? []).slice(0, 8).map((b) => b.id), 'blueprint');
  buildings = buildings.map((b) => {
    const { blueprint: old, ...rest } = b;
    const id = old !== undefined ? bpMap.resolve(old) : undefined;
    return id !== undefined && bps?.some((x) => x.id === id) ? { ...rest, blueprint: id } : rest;
  });
  if (bps && bps.length > 0) buildings = assignBlueprints(buildings, bps);

  const npcsIn = spec.npcs.slice(0, 10);
  const nMap = makeIdMap(npcsIn.map((n) => n.id), 'npc');
  const iMap = makeIdMap(spec.items.map((i) => i.id), 'item');
  const sMap = makeIdMap(spec.quest.steps.map((s) => s.id), 'step');
  const rMap = makeIdMap(spec.rules.map((r) => r.id), 'rule');

  const place = (v: string | undefined): string | undefined =>
    v === 'street' || v === 'plaza' ? v : bMap.resolve(v);

  const npcs: NpcSpec[] = npcsIn.map((n, idx) => {
    const id = nMap.ids[idx] as string;
    const home = bMap.resolve(n.home) ?? homeFallback(buildings);
    const work = place(n.work) ?? buildingForRole(n.role, buildings) ?? 'street';
    const sched = n.schedule.map((e): ScheduleEntry => {
      const fallback = e.activity === 'sleep' || e.activity === 'rest' || e.activity === 'eat' ? home : work;
      return { hour: clamp(e.hour, 0, 23), place: place(e.place) ?? fallback, activity: e.activity };
    });
    const rels: NpcSpec['relationships'] = [];
    for (const r of n.relationships) {
      const t = nMap.resolve(r.npcId);
      if (t && t !== id && !rels.some((x) => x.npcId === t)) rels.push({ npcId: t, stance: r.stance });
    }
    const biasOut: Record<string, number> = {};
    for (const a of NPC_ACTION_IDS) {
      const v = n.temperament.bias[a];
      biasOut[a] = typeof v === 'number' ? clamp(v, -5, 5) : 0;
    }
    return {
      ...n,
      id,
      name: n.name.trim(),
      knowledge: trimList(n.knowledge, 12),
      secrets: trimList(n.secrets, 6),
      home,
      work,
      schedule: sortByHour(fillSchedule(sortByHour(sched), home, work)),
      relationships: rels,
      appearance: { base: n.appearance.base, palette: Math.max(0, Math.round(n.appearance.palette)) },
      temperament: { tau: clamp(n.temperament.tau, 0.3, 3), bias: biasOut },
      voice: { pitch: clamp(n.voice.pitch, 0.5, 2), rate: clamp(n.voice.rate, 0.5, 2) },
    };
  });

  const giver = nMap.resolve(spec.quest.giver) ?? npcs[0]?.id ?? spec.quest.giver;

  const items = spec.items.slice(0, 20).map((it, i) => ({
    ...it,
    id: iMap.ids[i] as string,
    holder: it.holder === 'player' ? 'player' : (nMap.resolve(it.holder) ?? bMap.resolve(it.holder) ?? giver),
  }));
  const itemId = (v: string | undefined): string | undefined => {
    const r = iMap.resolve(v);
    return r !== undefined && items.some((x) => x.id === r) ? r : undefined;
  };

  const stepRef = (v: string): string | undefined => {
    const r = sMap.resolve(v);
    return r !== undefined && sMap.ids.includes(r) ? r : undefined;
  };
  const uniq = (xs: string[]): string[] => [...new Set(xs)];

  const steps: QuestStep[] = spec.quest.steps.map((s, i) => {
    const id = sMap.ids[i] as string;
    const asNpc = (): string => {
      const direct = nMap.resolve(s.target);
      if (direct) return direct;
      const t = slugify(s.target, '');
      return npcs.find((n) => slugify(n.name, '') === t)?.id ?? giver;
    };
    let target = s.target;
    let item: string | undefined;
    if (s.kind === 'talk' || s.kind === 'deliver' || s.kind === 'confront') target = asNpc();
    else if (s.kind === 'fetch') target = itemId(s.target) ?? itemId(s.item) ?? items[0]?.id ?? s.target;
    else if (s.kind === 'visit') {
      const b = bMap.resolve(s.target);
      const npc = npcs.find((n) => n.id === nMap.resolve(s.target));
      target = b ?? (npc && npc.work !== 'street' && npc.work !== 'plaza' ? npc.work : undefined) ?? buildings[0]?.id ?? s.target;
    } else {
      // choose: only an NPC can offer the choice, so a building resolves to whoever works or lives there.
      const direct = nMap.resolve(s.target);
      const b = direct ? undefined : bMap.resolve(s.target);
      const keeper = b ? (npcs.find((n) => n.work === b) ?? npcs.find((n) => n.home === b))?.id : undefined;
      target = direct ?? keeper ?? asNpc();
    }
    if (s.kind === 'fetch') item = target;
    else if (s.kind === 'deliver') item = itemId(s.item);

    const out: QuestStep = {
      id,
      kind: s.kind,
      target,
      requires: uniq(s.requires.map(stepRef).filter((x): x is string => x !== undefined && x !== id)),
      objective: s.objective.trim(),
      beat: s.beat.trim(),
    };
    if (item !== undefined) out.item = item;
    if (s.kind === 'choose' && s.choices) {
      out.choices = s.choices.slice(0, 4).map((c) => ({
        label: c.label.trim(),
        unlocks: uniq(c.unlocks.map(stepRef).filter((x): x is string => x !== undefined)),
      }));
    }
    if (s.reveals) {
      const kept: string[] = [];
      for (const r of s.reveals) {
        const [who, idx] = r.split(':');
        const npcId = nMap.resolve(who);
        const npc = npcs.find((n) => n.id === npcId);
        const k = Number(idx);
        if (npc && Number.isInteger(k) && k >= 0 && k < npc.secrets.length) kept.push(`${npc.id}:${k}`);
      }
      out.reveals = kept;
    }
    return out;
  });

  const endings = spec.quest.endings
    .map((e) => ({ ...e, stepId: stepRef(e.stepId) }))
    .filter((e): e is typeof e & { stepId: string } => e.stepId !== undefined)
    .filter((e, i, all) => all.findIndex((x) => x.stepId === e.stepId) === i);

  const rules: RuleSpec[] = [];
  spec.rules.slice(0, 12).forEach((r, i) => {
    const effect = fixEffect(r.effect, { bMap, nMap, itemId, place });
    if (effect) rules.push({ ...r, id: rMap.ids[i] as string, effect });
  });

  const arch: Partial<Pick<WorldSpec, 'style' | 'blueprints' | 'props' | 'landmarks'>> = {};
  if (spec.style) arch.style = fixStyle(spec.style);
  if (bps) arch.blueprints = bps;
  if (spec.props) arch.props = fixProps(spec.props);
  if (spec.landmarks) arch.landmarks = fixLandmarks(spec.landmarks, bMap);

  return {
    ...spec,
    ...arch,
    seed: Math.trunc(Number.isFinite(spec.seed) ? spec.seed : 0) >>> 0,
    palette: { ...spec.palette, fog: clamp(spec.palette.fog, 0, 1) },
    time: {
      startHour: clamp(spec.time.startHour, 0, 23),
      minutesPerRealSecond: clamp(spec.time.minutesPerRealSecond, 0.5, 30),
    },
    buildings,
    npcs,
    items,
    quest: { ...spec.quest, id: slugify(spec.quest.id, 'quest'), giver, steps, endings },
    rules,
    lexicon: trimList(spec.lexicon, 30),
  };
}
