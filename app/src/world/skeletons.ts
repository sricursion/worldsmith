// Skeletons: general structural families. A skeleton fixes only structure (massing, proportions, where
// the roof and the openings go). Colours, dial settings and extra parts come from the world prompt, so the
// same skeleton becomes a saloon in one world and a mushroom clinic in another.
// Pure module: no three, no DOM.
import type { BlueprintPart } from './spec';
import { makeRng } from './rng';
import { hall, tower, spire, domeForm, tiers, tent } from './skeletons/structure-a';
import { stilts, archway, hull, shell, block, wall, canopy } from './skeletons/structure-b';
import { cliff, cave, ruin, bridge, stair, gantry } from './skeletons/structure-c';
import { stack, mast, pit, colonnade, wreck, megastructure } from './skeletons/structure-d';
import { keep, arena, tank, pier, terrace } from './skeletons/structure-e';
import * as natureGroup from './skeletons/nature';
import * as objectGroup from './skeletons/object';
import type { DialSpec, Dials, Skeleton } from './skeletons/types';
import { N, ruinParts } from './skeletons/util';

export type { DialSpec, Skeleton };

const isSkeleton = (v: unknown): v is Skeleton => {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Partial<Skeleton>;
  return typeof s.id === 'string' && typeof s.build === 'function' && Array.isArray(s.dials) && Array.isArray(s.becomes);
};

/** Every skeleton a group file exports, whether one by one or as arrays, so a new one registers by being exported. */
function exported(group: Record<string, unknown>, lead: string[]): Skeleton[] {
  const found = Object.values(group).flatMap((v) => (Array.isArray(v) ? (v as unknown[]) : [v])).filter(isSkeleton);
  const rank = (s: Skeleton): number => (lead.includes(s.id) ? lead.indexOf(s.id) : lead.length);
  return found.sort((a, b) => rank(a) - rank(b));
}

export const SKELETONS: Record<string, Skeleton> = Object.fromEntries(
  [
    hall, tower, spire, domeForm, tiers, tent, stilts, archway, hull, shell, block, wall, canopy,
    cliff, cave, ruin, bridge, stair, gantry, stack, mast, pit, colonnade, wreck, megastructure,
    keep, arena, tank, pier, terrace,
    ...exported(natureGroup, []),
    ...exported(objectGroup, ['pole', 'container', 'furniture', 'blade', 'statue']),
  ].map((s) => [s.id, s]),
);

/**
 * The one dial every structure family takes on top of its own: how far the finished structure has fallen
 * into ruin. See ruinParts.
 */
export const RUIN_DIAL: DialSpec = N('ruin', 0, 1, 0, '0 whole, 0.5 roofless and broken, 1 stubs and fallen blocks');

/** Family names a model is likely to use that are folded into a canonical skeleton with preset dials. */
const ALIASES: Record<string, { id: string; dials: Dials }> = {
  crystal: { id: 'rock', dials: { form: 'crystal' } },
  plant: { id: 'tree', dials: { crown: 'bush' } },
  bush: { id: 'tree', dials: { crown: 'bush' } },
  gate: { id: 'arch', dials: {} },
  ship: { id: 'hull', dials: {} },
  mushroom: { id: 'shell', dials: {} },
  platform: { id: 'stilts', dials: {} },
  ruins: { id: 'ruin', dials: {} },
  crane: { id: 'gantry', dials: {} },
  stairs: { id: 'stair', dials: {} },
  columns: { id: 'colonnade', dials: {} },
  pile: { id: 'stack', dials: {} },
  crater: { id: 'pit', dials: {} },
  outcrop: { id: 'cliff', dials: {} },
  shipwreck: { id: 'wreck', dials: {} },
  monolith: { id: 'megastructure', dials: { form: 'slab' } },
  castle: { id: 'keep', dials: {} },
  fort: { id: 'keep', dials: {} },
  stadium: { id: 'arena', dials: {} },
  silo: { id: 'tank', dials: {} },
  jetty: { id: 'pier', dials: {} },
  dock: { id: 'pier', dials: {} },
  terraces: { id: 'terrace', dials: {} },
};

const clampNum = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function resolveDial(spec: DialSpec, raw: unknown): number | string {
  if (spec.kind === 'number') {
    const lo = spec.min ?? 0;
    const hi = spec.max ?? 1;
    const fallback = typeof spec.default === 'number' ? spec.default : lo;
    let v = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(v)) v = fallback;
    return clampNum(v, lo, hi);
  }
  const choices = spec.choices ?? [];
  const fallback = typeof spec.default === 'string' ? spec.default : (choices[0] ?? '');
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    const hit = choices.find((c) => c.toLowerCase() === t);
    if (hit !== undefined) return hit;
  } else if (typeof raw === 'number' && Number.isFinite(raw) && choices.length > 0) {
    return choices[clampNum(Math.floor(raw), 0, choices.length - 1)] ?? fallback;
  }
  return fallback;
}

const finite = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);

/** Same limits as normalizeSpec's part clamp, so a skeleton's output is already in normal form. */
function sane(p: BlueprintPart): BlueprintPart {
  const repeat = Math.round(clampNum(finite(p.repeat, 1), 1, 12));
  const rot = finite(p.rot, 0);
  return {
    shape: p.shape,
    x: clampNum(finite(p.x, 0), -0.5, 0.5),
    z: clampNum(finite(p.z, 0), -0.5, 0.5),
    y: clampNum(finite(p.y, 0), 0, 30),
    w: clampNum(finite(p.w, 0.1), 0.02, 1.4),
    d: clampNum(finite(p.d, 0.1), 0.02, 1.4),
    h: clampNum(finite(p.h, 1), 0.05, 30),
    rot: rot >= -180 && rot <= 180 ? rot : ((((rot + 180) % 360) + 360) % 360) - 180,
    tone: p.tone,
    repeat,
    gap: repeat === 1 ? 0 : clampNum(finite(p.gap, 0), 0, 1.4),
  };
}

const MINERAL_FAMILIES = new Set(['rock', 'boulder', 'crystal', 'pinnacle', 'vent', 'mound']);

/** Whether a prop of this family is a plant or a mineral; undefined for made things and unknown families. */
export function skeletonNature(family: string | undefined): 'plant' | 'mineral' | undefined {
  if (typeof family !== 'string') return undefined;
  const key = family.trim().toLowerCase();
  const sk = SKELETONS[key] ?? SKELETONS[ALIASES[key]?.id ?? ''];
  if (!sk || sk.group !== 'nature') return undefined;
  return MINERAL_FAMILIES.has(sk.id) ? 'mineral' : 'plant';
}

/**
 * Builds the parts of a skeleton. Unknown family gives []. Every dial is defaulted and clamped, so any
 * input (missing, out of range, wrong type) yields a valid part list. Never throws.
 */
export function buildSkeleton(family: string | undefined, dials: Record<string, number | string> | undefined, seed: number): BlueprintPart[] {
  try {
    if (typeof family !== 'string') return [];
    const key = family.trim().toLowerCase();
    // A registered family always wins over an alias of the same name.
    const alias = SKELETONS[key] ? undefined : ALIASES[key];
    const sk = SKELETONS[alias ? alias.id : key];
    if (!sk) return [];
    const given: Record<string, unknown> = { ...(alias?.dials ?? {}) };
    if (dials && typeof dials === 'object') for (const [k, v] of Object.entries(dials)) if (!(alias && k in alias.dials)) given[k] = v;
    const resolved: Dials = {};
    for (const spec of sk.dials) resolved[spec.name] = resolveDial(spec, given[spec.name]);
    const base = Number.isFinite(seed) ? seed : 0;
    const parts = sk.build(resolved, makeRng(base, sk.id)).slice(0, 28).map(sane);
    const worn = sk.group === 'structure' ? resolveDial(RUIN_DIAL, given[RUIN_DIAL.name]) : 0;
    if (typeof worn !== 'number' || worn <= 0.04) return parts;
    return ruinParts(parts, worn, makeRng(base, `${sk.id}|ruin`)).slice(0, 28).map(sane);
  } catch {
    return [];
  }
}

/** A figure to two places, without the leading zero of a fraction. */
const fmt = (n: number): string => String(Math.round(n * 100) / 100).replace(/^(-?)0\./, '$1.');

/**
 * The gloss of a dial, cut to its first clause. A gloss of up to three words that repeats the dial's own name
 * ("cap width" for cap, "glowing buds" for glow) tells the model nothing the name does not, and is dropped unless it gives a unit.
 */
function glossOf(d: DialSpec): string {
  const first = (d.meaning.split(/[;:]/)[0] ?? '').trim().replace(/metres/g, 'm');
  const words = first.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  const name = d.name.toLowerCase();
  const stem = name.length > 3 && name.endsWith('s') ? name.slice(0, -1) : name;
  const echo = (w: string): boolean => w.length > 2 && (w.startsWith(stem) || name.startsWith(w));
  const unit = words.some((w) => w === 'm' || w === 'units');
  if (words.length === 0 || (words.length <= 3 && !unit && words.some(echo))) return '';
  return first;
}

/**
 * One dial: its name, its range unless that is the usual 0-1, and a short gloss (in brackets where it starts
 * with a figure, so it cannot be read as the range). Choice names speak for themselves and carry no gloss.
 */
function dialText(d: DialSpec): string {
  if (d.kind === 'choice') return `${d.name} ${(d.choices ?? []).join('|')}`;
  const lo = d.min ?? 0;
  const hi = d.max ?? 1;
  const range = lo === 0 && hi === 1 ? '' : ` ${fmt(lo)}${lo < 0 ? ' to ' : '-'}${fmt(hi)}`;
  const g = glossOf(d);
  return `${d.name}${range}${g === '' ? '' : /^[0-9>]/.test(g) ? ` (${g})` : ` ${g}`}`;
}

/** Three things a family becomes, or two when their names run long. */
function examples(s: Skeleton): string {
  const three = s.becomes.slice(0, 3).join(', ');
  return three.length <= 32 ? three : s.becomes.slice(0, 2).join(', ');
}

/** The first clause of a summary: the bones, without the list of options the dials already spell out. */
function brief(summary: string): string {
  const sentence = (summary.split(/[.:;]/)[0] ?? summary).trim();
  const clause = (sentence.split(',')[0] ?? sentence).trim();
  return clause.split(' ').length >= 3 ? clause : sentence;
}

/** Compact catalogue for the compile model's prompt: one line per family, one entry per dial. */
export function skeletonCatalogText(): string {
  const groups: [Skeleton['group'], string][] = [
    ['structure', 'structure, for blueprints'],
    ['nature', 'nature, for props'],
    ['object', 'object, for props'],
  ];
  const lines: string[] = [
    'Tones: wall wall2 roof trim accent dark glass glow. Props: heights in footprint units; leaves, crystal accent/glow; trunk, stone wall2.',
    'Per line: family: what it is (things it becomes) dials. A dial with no range runs 0-1; m is metres.',
    `Every structure family also takes ${RUIN_DIAL.name} (${RUIN_DIAL.meaning}): anything can stand as its own ruin.`,
  ];
  for (const [g, title] of groups) {
    lines.push(`== ${title} ==`);
    for (const s of Object.values(SKELETONS)) {
      if (s.group !== g) continue;
      lines.push(`${s.id}: ${brief(s.summary)} (${examples(s)}) ${s.dials.map(dialText).join('; ')}`);
    }
  }
  return lines.join('\n');
}
