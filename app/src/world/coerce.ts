// Forgiving pre-pass for model output, run before validateSpec, plus a minimal-world builder
// for the early outline/look stream events. Pure: no I/O, no randomness.
import {
  validateSpec, WorldSpecSchema, normalizeSpec, slugify, coerceMood, coerceTerrain, coerceSkyFeatures, coerceCreatures, coerceFolk,
  SITE_PATTERNS, WILD_PATTERNS,
} from './schema';
import { scaleFields } from './scale';
import type {
  BuildingRole, BuildingSpec, CharacterBase, NpcSpec, SiteSpec, StyleSpec, ThemeId, WorldSpec,
} from './spec';

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keys whose value is a number in the spec, wherever they appear. */
const NUMERIC_KEYS = new Set([
  'seed', 'fog', 'startHour', 'minutesPerRealSecond', 'hour', 'x', 'z', 'y', 'w', 'd', 'h', 'rot', 'rotY', 'repeat', 'gap',
  'doorX', 'weight', 'tau', 'pitch', 'rate', 'fromHour', 'toHour', 'multiplier', 'variety', 'height', 'wild', 'spacing',
  'version', 'ruggedness', 'waterAmount', 'settled', 'bulk', 'head', 'count', 'intensity', 'haze',
]);

/** Keys holding a lower-case enum token. */
const ENUM_KEYS = new Set(['theme', 'sky', 'size', 'mood', 'stance', 'activity', 'base', 'kind', 'tone', 'type', 'shape', 'source']);

function numberish(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') return v;
  const n = Number(t);
  return Number.isFinite(n) ? n : v;
}

function token(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function tidy(node: unknown, key: string | undefined, parent: string | undefined): unknown {
  if (Array.isArray(node)) {
    return node.filter((x) => x !== null && x !== undefined).map((x) => tidy(x, undefined, key));
  }
  if (isRec(node)) {
    const out: Rec = {};
    for (const [k, v] of Object.entries(node)) {
      if (v === null || v === undefined) continue;
      out[k] = tidy(v, k, key ?? parent);
    }
    return out;
  }
  if (key === undefined) return node;
  if (NUMERIC_KEYS.has(key) || (key === 'palette' && parent === 'appearance') || parent === 'bias') return numberish(node);
  if (typeof node !== 'string') return node;
  // `size` is a number on props and an enum on buildings.
  if (key === 'size') return numberish(node) !== node ? numberish(node) : token(node);
  if (ENUM_KEYS.has(key)) return token(node);
  if (key === 'role' && parent === 'buildings') return token(node);
  return node;
}

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Repairs the small slips a model makes so they do not cost the whole world: numeric strings, wrong-case
 * enums, nulls, missing optional arrays, a missing version, junk list entries. Unknown keys are left in
 * place: WorldSpecSchema is a plain z.object, which strips them on parse.
 */
export function coerceSpec(raw: unknown): unknown {
  if (!isRec(raw)) return raw;
  const spec = tidy(raw, undefined, undefined) as Rec;
  if (spec['version'] === undefined) spec['version'] = 1;
  for (const k of ['items', 'rules', 'lexicon']) if (spec[k] === undefined) spec[k] = [];
  if (Array.isArray(spec['npcs'])) {
    spec['npcs'] = spec['npcs'].map((n) => {
      if (!isRec(n)) return n;
      for (const k of ['knowledge', 'secrets']) if (n[k] === undefined) n[k] = [];
      n['relationships'] = asList(n['relationships']).filter(isRec);
      n['schedule'] = asList(n['schedule']).filter(isRec);
      return n;
    });
  }
  if (isRec(spec['quest'])) {
    const q = spec['quest'];
    if (q['endings'] === undefined) q['endings'] = [];
    if (Array.isArray(q['steps'])) {
      q['steps'] = q['steps'].map((s) => {
        if (isRec(s) && s['requires'] === undefined) s['requires'] = [];
        return s;
      });
    }
  }
  return spec;
}

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const p of path) out += typeof p === 'number' ? `[${p}]` : `${out ? '.' : ''}${String(p)}`;
  return out || 'the spec';
}

/** The first three validation problems in plain words, for a console warning. */
export function explainInvalid(raw: unknown): string {
  if (validateSpec(raw).ok) return 'the spec is valid';
  const r = WorldSpecSchema.safeParse(raw);
  if (r.success) return 'the spec is valid';
  const lines = r.error.issues.slice(0, 3).map((i) => `${formatPath(i.path)}: ${i.message}`);
  const more = r.error.issues.length - lines.length;
  return lines.join('; ') + (more > 0 ? `; and ${more} more` : '');
}

// ---------------------------------------------------------------------------------------------
// lookSpec: a playable placeholder world from the outline and look events
// ---------------------------------------------------------------------------------------------

const ROLES: readonly BuildingRole[] = [
  'saloon', 'tavern', 'inn', 'bank', 'jail', 'sheriff', 'church', 'stable', 'general_store', 'market', 'blacksmith',
  'house', 'hotel', 'townhall', 'doctor', 'school', 'barber', 'undertaker', 'warehouse', 'workshop', 'lab', 'hangar',
  'cantina', 'command', 'habitat', 'reactor', 'cafe', 'office', 'shop', 'garage', 'apartment', 'station', 'plaza',
];
const THEMES: readonly ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];
const SKIES = ['dawn', 'day', 'dusk', 'night', 'overcast'] as const;
const BASES: readonly CharacterBase[] = ['knight', 'barbarian', 'mage', 'rogue', 'ranger', 'rogue_hooded'];
const SIZES = ['small', 'medium', 'large'] as const;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const NEUTRAL_STYLE: StyleSpec = {
  name: 'plain local materials', wall: '#b9ab94', wall2: '#9c8f7b', roof: '#6b5a49', trim: '#d8ccb4', accent: '#b5533c',
  dark: '#2f2a26', glass: '#3a4a58', glow: '#ffd98a', ground: '#7d8a5a', road: '#8c8272', variety: 0.3,
};

const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback);
const num = (v: unknown, fallback: number): number => {
  const n = numberish(v);
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const hex = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fallback);
function pick<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  if (typeof v !== 'string') return undefined;
  const t = token(v);
  return allowed.find((a) => a === t);
}

function buildStyle(v: unknown): StyleSpec | undefined {
  if (!isRec(v)) return undefined;
  const out: StyleSpec = { ...NEUTRAL_STYLE, name: str(v['name'], NEUTRAL_STYLE.name), variety: clamp(num(v['variety'], 0.3), 0, 1) };
  for (const k of ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow', 'ground', 'road'] as const) out[k] = hex(v[k], NEUTRAL_STYLE[k]);
  for (const k of ['foliage', 'bark'] as const) if (hex(v[k], '') !== '') out[k] = hex(v[k], '');
  return out;
}

function buildSite(v: unknown): SiteSpec | undefined {
  if (!isRec(v)) return undefined;
  const pattern = pick(v['pattern'], SITE_PATTERNS);
  if (!pattern) return undefined;
  const open = WILD_PATTERNS.includes(pattern);
  return {
    pattern,
    wild: clamp(num(v['wild'], open ? 0.7 : 0.3), 0, 1),
    paths: pick(v['paths'], ['road', 'track', 'none'] as const) ?? (open ? 'track' : 'road'),
    spacing: clamp(num(v['spacing'], open ? 12 : 8), 2, 14),
    ...scaleFields(v),
  };
}

/** The id the quest names when nobody lives in the world; normalizeSpec turns it into the spirit of the place. */
const SPIRIT_ID = 'spirit_of_the_place';

/**
 * Builds a minimal valid spec from the outline and look stream events, or null when they are unusable.
 * The land, the sky, the creatures and the folk decided in the outline are carried through, so the preview
 * already stands on the right ground under the right sky. A place may have no structures and no people.
 */
export function lookSpec(outline: unknown, look: unknown, prompt: string, seed: number): WorldSpec | null {
  const o = isRec(outline) ? outline : {};
  const l = isRec(look) ? look : {};
  const style = buildStyle(l['style']);
  const site = buildSite(l['site']) ?? buildSite(o['site']);
  const op = isRec(o['palette']) ? o['palette'] : {};
  const lp = isRec(l['palette']) ? l['palette'] : {};

  const buildings: BuildingSpec[] = [];
  asList(o['buildings']).forEach((raw, i) => {
    if (!isRec(raw) || buildings.length >= 14) return;
    const id = slugify(str(raw['id'], `building_${i + 1}`), `building_${i + 1}`);
    const b: BuildingSpec = {
      id,
      role: pick(raw['role'], ROLES) ?? 'house',
      label: str(raw['label'] ?? raw['name'], id),
      size: pick(raw['size'], SIZES) ?? 'medium',
    };
    if (typeof raw['blueprint'] === 'string') b.blueprint = raw['blueprint'];
    if (raw['keyBuilding'] === true) b.keyBuilding = true;
    buildings.push(b);
  });
  const first = buildings[0];
  const resolveBuilding = (v: unknown, fallback: string): string => {
    if (typeof v !== 'string') return fallback;
    const s = slugify(v, '');
    return buildings.find((b) => b.id === v || b.id === s)?.id ?? fallback;
  };

  const npcs: NpcSpec[] = [];
  const stubs = asList(o['npcs']).filter(isRec).slice(0, 10);
  stubs.forEach((raw, i) => {
    const name = str(raw['name'], `Local ${i + 1}`);
    const role = str(raw['role'], 'local');
    const home = resolveBuilding(raw['home'], buildings[i % Math.max(1, buildings.length)]?.id ?? 'street');
    const w = raw['work'];
    const work = w === 'street' || w === 'plaza' ? w : resolveBuilding(w, 'street');
    npcs.push({
      id: slugify(str(raw['id'], name), `npc_${i + 1}`),
      name,
      role,
      persona: `${name} is a ${role} here, plain-spoken, and keeps to a daily routine.`,
      knowledge: [],
      secrets: [],
      home,
      work,
      schedule: [
        { hour: 7, place: work, activity: 'work' },
        { hour: 18, place: home, activity: 'eat' },
        { hour: 22, place: home, activity: 'sleep' },
      ],
      relationships: [],
      appearance: { base: BASES[i % BASES.length] as CharacterBase, palette: i },
      temperament: { tau: 1, bias: {} },
      voice: { pitch: 1, rate: 1 },
      mood: 'calm',
    });
  });
  // Nobody here: the quest names the spirit of the place, and normalizeSpec gives it a body.
  const giver = npcs[0]?.id ?? SPIRIT_ID;
  const giverName = npcs[0]?.name ?? 'the spirit of the place';
  const steps: Rec[] = [
    { id: 'first_words', kind: 'talk', target: giver, requires: [], objective: `Speak with ${giverName}`, beat: 'You are told what this place is.' },
  ];
  if (first) steps.push({ id: 'look_around', kind: 'visit', target: first.id, requires: ['first_words'], objective: `Visit ${first.label}`, beat: 'You take in the place.' });
  const lastStep = String((steps[steps.length - 1] as Rec)['id']);
  const hour = num(isRec(o['time']) ? o['time']['startHour'] : undefined, 9);

  const base: Rec = {
    version: 1,
    seed: Math.trunc(Number.isFinite(seed) ? seed : 0) >>> 0,
    prompt,
    title: str(o['title'], prompt.trim().slice(0, 60) || 'A new place'),
    tagline: str(o['tagline'], 'The story is still being written.'),
    theme: pick(o['theme'] ?? l['theme'], THEMES) ?? 'medieval',
    era: str(o['era'], 'unspecified'),
    palette: {
      ground: hex(lp['ground'], style?.ground ?? NEUTRAL_STYLE.ground),
      accent: hex(lp['accent'], style?.accent ?? NEUTRAL_STYLE.accent),
      sky: pick(lp['sky'] ?? l['sky'] ?? op['sky'], SKIES) ?? 'day',
      fog: clamp(num(lp['fog'] ?? l['fog'] ?? op['fog'], 0.2), 0, 1),
    },
    time: { startHour: clamp(hour, 0, 23), minutesPerRealSecond: 2 },
    buildings,
    npcs,
    items: [],
    quest: {
      id: 'settling_in',
      title: 'Settling in',
      hook: 'The tale of this place is still being written. Look around while it arrives.',
      giver,
      steps,
      endings: [{ stepId: lastStep, label: 'You find your bearings', tone: 'neutral' }],
    },
    rules: [],
    lexicon: [],
  };

  const arch: Rec = {};
  if (style) arch['style'] = style;
  if (site) arch['site'] = site;
  // The land, sky and life come from the outline (the look may restate them); each is coerced, so none can fail the spec.
  const land = (k: string): unknown => l[k] ?? o[k];
  if (isRec(o['mood'])) arch['mood'] = coerceMood(o['mood']);
  if (isRec(land('terrain'))) arch['terrain'] = coerceTerrain(land('terrain'));
  if (Array.isArray(land('skyFeatures'))) arch['skyFeatures'] = coerceSkyFeatures(land('skyFeatures'));
  if (Array.isArray(land('creatures'))) arch['creatures'] = coerceCreatures(land('creatures'));
  if (isRec(land('folk'))) arch['folk'] = coerceFolk(land('folk'));
  const model: Rec = {};
  if (Array.isArray(l['blueprints']) && l['blueprints'].length > 0) model['blueprints'] = l['blueprints'];
  if (Array.isArray(l['props'])) model['props'] = l['props'];
  if (Array.isArray(l['landmarks'])) model['landmarks'] = l['landmarks'];

  // Model-authored parts can be malformed; fall back to the plain town rather than no town.
  const tries: Rec[] = [{ ...base, ...arch, ...model }, { ...base, ...arch }, base];
  for (const t of tries) {
    const c = coerceSpec(t);
    if (validateSpec(c).ok) return normalizeSpec(c as WorldSpec);
  }
  return null;
}
