// Pure helpers for blueprints: repeat expansion, bounds, lint and repair. No three.js here, so the
// schema, the tests and the worker can all use it.
import type { Blueprint, BlueprintPart } from './spec';

/** Support tolerance (metres) when deciding whether a part rests on another. */
const SUPPORT_TOL = 0.15;
/** A part whose base is at or below this counts as standing on the ground. */
const GROUND_TOL = 0.05;
/** How far a part may sit outside the footprint (fraction) before it counts as detached. */
const OVERHANG = 0.3;
const FOOT = 0.5;
/** Fraction in front of the door face that must stay walkable, and the heights that block a walker. */
const DOOR_PROBE_Z = 0.56;
const DOOR_MIN_BLOCK_TOP = 0.4;
const DOOR_MAX_BLOCK_BASE = 1.8;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Repeat copies sit along the part's local x axis; after rotation about Y that is (cos, -sin) in x, z. */
function copies(p: BlueprintPart): BlueprintPart[] {
  const n = Math.max(1, Math.min(12, Math.round(p.repeat)));
  if (n === 1) return [{ ...p, repeat: 1, gap: 0 }];
  const c = Math.cos(rad(p.rot));
  const s = Math.sin(rad(p.rot));
  const out: BlueprintPart[] = [];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * p.gap;
    out.push({ ...p, x: p.x + off * c, z: p.z - off * s, repeat: 1, gap: 0 });
  }
  return out;
}

/** Applies repeat/gap along local x (honouring rot) and returns only repeat=1 parts. */
export function expandParts(parts: BlueprintPart[]): BlueprintPart[] {
  return parts.flatMap(copies);
}

export function blueprintBounds(bp: Blueprint, _footprint: { w: number; d: number }): { height: number } {
  let height = 0;
  for (const p of expandParts(bp.parts)) height = Math.max(height, p.y + p.h);
  return { height };
}

interface Box { x0: number; x1: number; z0: number; z1: number }

function aabb(p: BlueprintPart): Box {
  const c = Math.abs(Math.cos(rad(p.rot)));
  const s = Math.abs(Math.sin(rad(p.rot)));
  const hx = (p.w / 2) * c + (p.d / 2) * s;
  const hz = (p.w / 2) * s + (p.d / 2) * c;
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}

const overlaps = (a: Box, b: Box, tol = 0.02): boolean =>
  a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.z0 <= b.z1 + tol && b.z0 <= a.z1 + tol;

interface Flat { part: BlueprintPart; src: number; box: Box }

function flatten(parts: BlueprintPart[]): Flat[] {
  const out: Flat[] = [];
  parts.forEach((p, src) => {
    for (const c of copies(p)) out.push({ part: c, src, box: aabb(c) });
  });
  return out;
}

/**
 * Another part (from a different source part) that carries this one: either its vertical extent
 * contains this part's base (standing on it or attached to it), or this part's top touches its
 * underside (hanging from it, like a sign on a bracket).
 */
function supportedBy(f: Flat, all: Flat[]): boolean {
  const top = f.part.y + f.part.h;
  return all.some(
    (q) =>
      q.src !== f.src &&
      overlaps(f.box, q.box) &&
      ((f.part.y >= q.part.y - SUPPORT_TOL && f.part.y <= q.part.y + q.part.h + SUPPORT_TOL) ||
        Math.abs(top - q.part.y) <= SUPPORT_TOL),
  );
}

function doorBlockedAt(doorX: number, all: Flat[]): Flat | undefined {
  return all.find(
    (f) =>
      f.box.x0 <= doorX && doorX <= f.box.x1 && f.box.z0 <= DOOR_PROBE_Z && DOOR_PROBE_Z <= f.box.z1 &&
      f.part.y < DOOR_MAX_BLOCK_BASE && f.part.y + f.part.h > DOOR_MIN_BLOCK_TOP,
  );
}

/** Human-readable problems. An empty list means the blueprint is sound. */
export function lintBlueprint(bp: Blueprint): string[] {
  const warnings: string[] = [];
  if (bp.parts.length < 4) warnings.push(`only ${bp.parts.length} parts, need at least 4`);
  const flat = flatten(bp.parts);
  if (!flat.some((f) => f.part.y <= GROUND_TOL)) warnings.push('no body part at y=0');
  const seen = new Set<string>();
  for (const f of flat) {
    const name = `part ${f.src} (${f.part.shape})`;
    if (f.part.y > GROUND_TOL && !supportedBy(f, flat) && !seen.has(`f${f.src}`)) {
      seen.add(`f${f.src}`);
      warnings.push(`${name} floats at y=${f.part.y} with nothing under it`);
    }
    const b = f.box;
    const out = b.x0 > FOOT + OVERHANG || b.x1 < -FOOT - OVERHANG || b.z0 > FOOT + OVERHANG || b.z1 < -FOOT - OVERHANG;
    if (out && !seen.has(`o${f.src}`)) {
      seen.add(`o${f.src}`);
      warnings.push(`${name} lies entirely outside the footprint`);
    }
  }
  const blocker = doorBlockedAt(bp.doorX, flat);
  if (blocker) warnings.push(`door at x=${bp.doorX} is blocked by part ${blocker.src} (${blocker.part.shape})`);
  return warnings;
}

const clampN = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

const FILLERS: BlueprintPart[] = [
  { shape: 'gable', x: 0, z: 0, y: 3, w: 0.9, d: 0.9, h: 1.6, rot: 0, tone: 'roof', repeat: 1, gap: 0 },
  { shape: 'box', x: 0, z: 0.5, y: 0, w: 0.14, d: 0.03, h: 2.1, rot: 0, tone: 'dark', repeat: 1, gap: 0 },
  { shape: 'box', x: -0.3, z: -0.2, y: 3, w: 0.08, d: 0.08, h: 1.2, rot: 0, tone: 'dark', repeat: 1, gap: 0 },
];

/**
 * Makes a blueprint buildable: guarantees a body at y=0 and at least 4 parts, pulls detached parts
 * back within reach of the footprint, snaps floating parts onto what is under them and keeps the
 * door clear. A sound blueprint comes back unchanged.
 */
export function repairBlueprint(bp: Blueprint): Blueprint {
  let parts = bp.parts.map((p) => ({ ...p }));
  const hasBody = expandParts(parts).some((p) => p.y <= GROUND_TOL);
  if (!hasBody) {
    parts.unshift({ shape: 'box', x: 0, z: 0, y: 0, w: 0.8, d: 0.7, h: 3, rot: 0, tone: 'wall', repeat: 1, gap: 0 });
  }
  for (let i = 0; parts.length < 4 && i < FILLERS.length; i++) parts.push({ ...(FILLERS[i] as BlueprintPart) });

  // Detached parts: only the centre is clamped, so the part always overlaps the allowance band.
  const lim = FOOT + OVERHANG;
  parts = parts.map((p) => {
    const b = aabb(p);
    const out = b.x0 > lim || b.x1 < -lim || b.z0 > lim || b.z1 < -lim;
    return out ? { ...p, x: clampN(p.x, -lim, lim), z: clampN(p.z, -lim, lim) } : p;
  });

  // Floating parts, lowest first so that parts snapped onto the ground can carry the ones above.
  const order = parts.map((_, i) => i).sort((a, b) => (parts[a] as BlueprintPart).y - (parts[b] as BlueprintPart).y || a - b);
  for (const i of order) {
    const p = parts[i] as BlueprintPart;
    if (p.y <= GROUND_TOL) continue;
    const all = flatten(parts);
    const mine = all.filter((f) => f.src === i);
    const bad = mine.find((f) => !supportedBy(f, all));
    if (!bad) continue;
    let top = 0;
    for (const q of all) {
      if (q.src === i || !overlaps(bad.box, q.box)) continue;
      const t = q.part.y + q.part.h;
      if (t <= p.y + SUPPORT_TOL && t > top) top = t;
    }
    parts[i] = { ...p, y: top };
  }

  let doorX = clampN(bp.doorX, -0.4, 0.4);
  const flat = flatten(parts);
  if (doorBlockedAt(doorX, flat)) {
    for (let k = 1; k <= 8; k++) {
      const cand = [doorX - 0.05 * k, doorX + 0.05 * k].filter((c) => Math.abs(c) <= 0.4);
      const ok = cand.find((c) => !doorBlockedAt(c, flat));
      if (ok !== undefined) {
        doorX = Math.round(ok * 100) / 100;
        break;
      }
    }
  }
  return { ...bp, parts, doorX };
}
