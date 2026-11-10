// Skeletons: general structural families. A skeleton fixes only structure (massing, proportions, where
// the roof and the openings go). Colours, dial settings and extra parts come from the world prompt, so the
// same skeleton becomes a saloon in one world and a mushroom clinic in another.
// Pure module: no three, no DOM.
import type { BlueprintPart } from './spec';
import { makeRng } from './rng';
import { hall, tower, spire, domeForm, tiers, tent } from './skeletons/structure-a';
import { stilts, archway, hull, shell, block, wall, canopy } from './skeletons/structure-b';
import { tree, rock } from './skeletons/nature';
import { pole, container, furniture, blade, statue } from './skeletons/object';
import type { DialSpec, Dials, Skeleton } from './skeletons/types';

export type { DialSpec, Skeleton };

export const SKELETONS: Record<string, Skeleton> = Object.fromEntries(
  [hall, tower, spire, domeForm, tiers, tent, stilts, archway, hull, shell, block, wall, canopy, tree, rock, pole, container, furniture, blade, statue]
    .map((s) => [s.id, s]),
);

/** Family names a model is likely to use that are folded into a canonical skeleton with preset dials. */
const ALIASES: Record<string, { id: string; dials: Dials }> = {
  crystal: { id: 'rock', dials: { form: 'crystal' } },
  plant: { id: 'tree', dials: { crown: 'bush' } },
  bush: { id: 'tree', dials: { crown: 'bush' } },
  gate: { id: 'arch', dials: {} },
  ship: { id: 'hull', dials: {} },
  mushroom: { id: 'shell', dials: {} },
  platform: { id: 'stilts', dials: {} },
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

/**
 * Builds the parts of a skeleton. Unknown family gives []. Every dial is defaulted and clamped, so any
 * input (missing, out of range, wrong type) yields a valid part list. Never throws.
 */
export function buildSkeleton(family: string | undefined, dials: Record<string, number | string> | undefined, seed: number): BlueprintPart[] {
  try {
    if (typeof family !== 'string') return [];
    const key = family.trim().toLowerCase();
    const alias = ALIASES[key];
    const sk = SKELETONS[alias ? alias.id : key];
    if (!sk) return [];
    const given: Record<string, unknown> = { ...(alias?.dials ?? {}) };
    if (dials && typeof dials === 'object') for (const [k, v] of Object.entries(dials)) if (!(alias && k in alias.dials)) given[k] = v;
    const resolved: Dials = {};
    for (const spec of sk.dials) resolved[spec.name] = resolveDial(spec, given[spec.name]);
    const rng = makeRng(Number.isFinite(seed) ? seed : 0, sk.id);
    return sk.build(resolved, rng).slice(0, 28).map(sane);
  } catch {
    return [];
  }
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function dialText(d: DialSpec): string {
  if (d.kind === 'choice') return `${d.name} ${(d.choices ?? []).join('|')} (${d.meaning})`;
  return `${d.name} ${fmt(d.min ?? 0)}-${fmt(d.max ?? 1)} (${d.meaning})`;
}

/** Compact catalogue for the compile model's prompt. */
export function skeletonCatalogText(): string {
  const groups: [Skeleton['group'], string][] = [
    ['structure', 'structure, for blueprints'],
    ['nature', 'nature, for props'],
    ['object', 'object, for props'],
  ];
  const lines: string[] = [
    'Tones: wall wall2 roof trim accent dark glass glow. Props: heights in footprint units; leaves, crystal accent/glow; trunk, stone wall2.',
  ];
  for (const [g, title] of groups) {
    lines.push(`== ${title} ==`);
    for (const s of Object.values(SKELETONS)) {
      if (s.group !== g) continue;
      lines.push(`${s.id}: ${s.summary} becomes: ${s.becomes.slice(0, 5).join(', ')}. dials: ${s.dials.map(dialText).join('; ')}`);
    }
  }
  return lines.join('\n');
}
