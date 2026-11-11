// Per-building variation. A blueprint is an archetype shared by several buildings; no two of them should come
// out alike. varyBlueprint returns the archetype as ONE building would have been built: a storey taller or
// shorter, handed the other way round, a little wider or narrower, its chimneys and roof clutter moved, lost or
// doubled, a lean-to against one wall, a few things missing or knocked askew where the place is worn, a
// secondary mass in the other wall material. Everything is drawn from the seed, so the same building is always
// the same building.
//
// Every step is tried on its own and kept only if the blueprint still lints as cleanly as it did before, so a
// variant is never less sound than its archetype: nothing floats, nothing leaves the lot, the door stays clear.
// The first part is the body: it is never removed, moved on its own or lifted off the ground.
//
// Pure module: no three, no DOM.
import { expandParts, lintBlueprint } from '../world/blueprints';
import { hash32, makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { Blueprint, BlueprintPart, PartShape } from '../world/spec';

export interface VaryOptions {
  /** 0 leaves the blueprint as it is; 1 is as different as one archetype gets. */
  amount: number;
  /** SurfaceSet.wear, 0..1: from about a third up, things go missing and hang askew. */
  wear: number;
  /** TerrainSpec.settled, 0..1: a dense place grows upward, a loose one grows sheds and lean-tos. */
  settled: number;
}

const MAX_PARTS = 28;
const MAX_HEIGHT = 30;
/** Floor-to-floor height a body is cut into, metres; the same figure the dressing pass bands walls at. */
const STOREY = 3.2;
/** Below this the ground floor (door, shopfront) is left alone when a storey is taken out. */
const GROUND_FLOOR = 2.5;
/** How far outside the footprint (fraction) an added annex may reach. */
const ANNEX_REACH = 0.62;
/** Widest change in frontage, as a fraction. */
export const MAX_WIDEN = 0.12;

const RAD = Math.PI / 180;
const unit = (v: number, d: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const topOf = (p: BlueprintPart): number => p.y + p.h;
const ROUND: ReadonlySet<PartShape> = new Set<PartShape>(['cylinder', 'cone', 'dome', 'sphere', 'ring', 'pyramid']);
const prism = (p: BlueprintPart): boolean => p.shape === 'box' || p.shape === 'cylinder';
/** True when the part's own x axis lies along the footprint's x axis (not turned a quarter). */
const alongX = (p: BlueprintPart): boolean => Math.abs(Math.cos(p.rot * RAD)) >= Math.SQRT1_2;

interface Box { x0: number; x1: number; z0: number; z1: number }

/** Footprint box of a part with its repeat copies, the way the lint measures it. */
function boxOf(p: BlueprintPart): Box {
  const c = Math.abs(Math.cos(p.rot * RAD));
  const s = Math.abs(Math.sin(p.rot * RAD));
  const run = p.repeat > 1 ? (p.repeat - 1) * p.gap : 0;
  const hx = ((p.w + run) / 2) * c + (p.d / 2) * s;
  const hz = ((p.w + run) / 2) * s + (p.d / 2) * c;
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}

const overlap = (a: Box, b: Box, tol = 0): boolean => a.x0 < b.x1 + tol && b.x0 < a.x1 + tol && a.z0 < b.z1 + tol && b.z0 < a.z1 + tol;
const within = (parts: readonly BlueprintPart[]): boolean =>
  parts.length <= MAX_PARTS && parts.every((p) => p.y >= 0 && p.y <= MAX_HEIGHT && p.h >= 0.05 && p.h <= MAX_HEIGHT && p.w >= 0.02 && p.d >= 0.02);

// ---- Height --------------------------------------------------------------------------------------------------

/**
 * Adds (`k` > 0) or removes (`k` < 0) whole storeys from a body that is a plain prism. The cut is made just
 * under the top of the body: what stands on the body rides with it, what reaches the eave from below is
 * stretched or shortened, and the windows of the top floor are repeated on every floor added.
 */
function changeStoreys(parts: readonly BlueprintPart[], k: number): BlueprintPart[] | null {
  const body = parts[0];
  if (!body || !prism(body) || body.y > 0.05 || body.h < 2.8 || k === 0) return null;
  const floors = Math.max(1, Math.round(body.h / STOREY));
  const storey = body.h / floors;
  const cut = body.y + body.h - 0.02;
  const out: BlueprintPart[] = [];
  if (k > 0) {
    const rise = k * storey;
    const copies: BlueprintPart[] = [];
    parts.forEach((p, i) => {
      const top = topOf(p);
      if (p.y >= cut) out.push({ ...p, y: p.y + rise });
      else if (top <= cut) {
        out.push({ ...p });
        if (i > 0 && p.y >= cut - storey - 0.05 && p.h <= storey) for (let j = 1; j <= k; j++) copies.push({ ...p, y: p.y + j * storey });
      } else if (i > 0 && p.h < 1.5) out.push({ ...p, y: p.y + rise });
      else out.push({ ...p, h: p.h + rise });
    });
    for (const c of copies) if (out.length < MAX_PARTS) out.push(c);
    return within(out) ? out : null;
  }
  const drop = -k * storey;
  const low = cut - drop;
  if (floors + k < 1 || low < GROUND_FLOOR) return null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as BlueprintPart;
    const top = topOf(p);
    if (p.y >= cut) out.push({ ...p, y: p.y - drop });
    else if (top <= low) out.push({ ...p });
    else if (p.y >= low) {
      // Its base is on the floor that goes.
      if (top <= cut) {
        if (i === 0) return null;
      } else if (i > 0 && p.h < 1.5) out.push({ ...p, y: p.y - drop });
      else if (top - cut >= 0.05) out.push({ ...p, y: low, h: top - cut });
    } else if (top > cut) out.push({ ...p, h: p.h - drop });
    else {
      const h = low - p.y;
      if (i === 0 || h >= 0.65 * p.h) out.push({ ...p, h });
    }
  }
  return within(out) ? out : null;
}

/** Head height: below it are doors and shopfronts, which keep their size whatever the building does. */
const HEAD = 2.3;

/**
 * Stretches or squeezes everything above `from` metres by `f`. The vertical axis is remapped as a whole, so
 * whatever touched still touches. From head height it is what a dome, a spire or a grown thing gets in place
 * of storeys, and what gives two houses of one design eaves at different heights; from the foot of the roof
 * it is the pitch of the roof.
 */
function stretchAbove(parts: readonly BlueprintPart[], f: number, from = HEAD): BlueprintPart[] | null {
  const g = (t: number): number => (t <= from ? t : from + (t - from) * f);
  const out = parts.map((p) => {
    const y = g(p.y);
    return { ...p, y, h: Math.max(0.05, g(topOf(p)) - y) };
  });
  return within(out) ? out : null;
}

// ---- What stands on the roof ---------------------------------------------------------------------------------

/** The part that carries `p`: the broadest other part under its middle whose height range takes in its base. */
function carrier(parts: readonly BlueprintPart[], index: number): BlueprintPart | null {
  const p = parts[index] as BlueprintPart;
  let best: BlueprintPart | null = null;
  parts.forEach((q, j) => {
    if (j === index) return;
    const b = boxOf(q);
    if (p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1) return;
    if (p.y < q.y - 0.15 || p.y > topOf(q) + 0.15) return;
    if (!best || q.w * q.d > best.w * best.d) best = q;
  });
  return best;
}

/** Indices of `index` and of the small things stacked on it (a pot on a chimney, a light on a mast). */
function stackOn(parts: readonly BlueprintPart[], index: number): number[] {
  const p = parts[index] as BlueprintPart;
  const b = boxOf(p);
  const out = [index];
  parts.forEach((q, j) => {
    if (j === 0 || j === index) return;
    if (q.x >= b.x0 - 0.02 && q.x <= b.x1 + 0.02 && q.z >= b.z0 - 0.02 && q.z <= b.z1 + 0.02 && q.y >= topOf(p) - 0.2 && q.w * q.d <= Math.max(0.02, 2.5 * p.w * p.d)) out.push(j);
  });
  return out;
}

/**
 * The direction a thing may slide along on what carries it, as a unit step in footprint fractions and the room
 * either way: anywhere on a flat top, along the ridge of a gable, along the top edge of a lean-to; nowhere on a
 * dome, a cone or a pyramid, where a step sideways leaves it in the air.
 */
function slideOn(q: BlueprintPart, p: BlueprintPart, rng: Rng): { dx: number; dz: number; room: number; mid: number } | null {
  const c = Math.cos(q.rot * RAD);
  const s = Math.sin(q.rot * RAD);
  // Position of p in q's own frame (x along q's local x, z along its local z).
  const lx = (p.x - q.x) * c - (p.z - q.z) * s;
  const lz = (p.x - q.x) * s + (p.z - q.z) * c;
  const own = Math.max(p.w, p.d) / 2;
  if (q.repeat > 1) return null;
  if (q.shape === 'gable' || (prism(q) && rng.chance(0.5))) return { dx: c, dz: -s, room: q.w / 2 - own - 0.02, mid: lx };
  if (q.shape === 'wedge' || prism(q)) return { dx: s, dz: c, room: q.d / 2 - own - 0.02, mid: lz };
  return null;
}

// ---- Annex ---------------------------------------------------------------------------------------------------

/** A lean-to against a side wall, or a flat-roofed shed against the back, where the lot has the room. */
function annex(parts: readonly BlueprintPart[], rng: Rng): BlueprintPart[] | null {
  const body = parts[0];
  if (!body || body.shape !== 'box' || body.y > 0.05 || body.h < 2.6 || body.repeat > 1 || parts.length > MAX_PARTS - 2) return null;
  if (Math.abs(Math.sin(body.rot * RAD)) > 0.05) return null;
  const h = Math.min(body.h - 0.5, clamp(body.h * rng.range(0.45, 0.7), 2.1, 3.4));
  if (h < 1.9) return null;
  const tone = rng.chance(0.5) ? body.tone : body.tone === 'wall' ? 'wall2' : 'wall';
  const sides = rng.shuffle([1, -1, 0]);
  for (const side of sides) {
    let box: BlueprintPart;
    let roof: BlueprintPart;
    if (side !== 0) {
      const edge = body.x + (side * body.w) / 2;
      const w = Math.min(rng.range(0.14, 0.24), ANNEX_REACH - side * edge);
      const d = body.d * rng.range(0.35, 0.6);
      if (w < 0.1 || d < 0.15) continue;
      const z = Math.min(body.z + rng.range(-0.5, 0.5) * (body.d - d), 0.42 - d / 2);
      box = { shape: 'box', x: edge + side * (w / 2 - 0.01), z, y: 0, w, d, h, rot: 0, tone, repeat: 1, gap: 0 };
      roof = { shape: 'wedge', x: box.x + side * 0.01, z, y: h, w: w + 0.03, d: d + 0.03, h: rng.range(0.45, 0.9), rot: side > 0 ? 180 : 0, tone: 'roof', repeat: 1, gap: 0 };
    } else {
      const edge = body.z - body.d / 2;
      const d = Math.min(rng.range(0.14, 0.24), ANNEX_REACH + edge);
      const w = body.w * rng.range(0.35, 0.6);
      if (d < 0.1 || w < 0.15) continue;
      const x = body.x + rng.range(-0.5, 0.5) * (body.w - w);
      box = { shape: 'box', x, z: edge - d / 2 + 0.01, y: 0, w, d, h, rot: 0, tone, repeat: 1, gap: 0 };
      roof = { shape: 'box', x, z: box.z - 0.01, y: h, w: w + 0.04, d: d + 0.04, h: 0.16, rot: 0, tone: 'roof', repeat: 1, gap: 0 };
    }
    const b = boxOf(box);
    // Nothing else may already stand there: a porch, a stair, another wing.
    if (parts.some((q, j) => j > 0 && q.y < h && overlap(b, boxOf(q)))) continue;
    return [...parts.map((p) => ({ ...p })), box, roof];
  }
  return null;
}

// ---- Width and handedness --------------------------------------------------------------------------------------

function widen(parts: readonly BlueprintPart[], f: number): BlueprintPart[] {
  const body = parts[0];
  // A round body stays round: everything is scaled about the middle instead of across the front only.
  const whole = body !== undefined && ROUND.has(body.shape);
  return parts.map((p) => {
    const q = { ...p, x: p.x * f };
    if (whole) {
      q.z = p.z * f;
      q.w = p.w * f;
      q.d = p.d * f;
      q.gap = p.gap * f;
    } else if (!ROUND.has(p.shape)) {
      if (alongX(p)) {
        q.w = p.w * f;
        q.gap = p.gap * f;
      } else q.d = p.d * f;
    }
    q.w = clamp(q.w, 0.02, 1.4);
    q.d = clamp(q.d, 0.02, 1.4);
    return q;
  });
}

const wrap = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Left for right. A lean-to slope has a high end, so it is turned about; everything else is symmetric along its own x. */
function mirror(parts: readonly BlueprintPart[]): BlueprintPart[] {
  return parts.map((p) => ({ ...p, x: -p.x, rot: wrap(p.shape === 'wedge' ? 180 - p.rot : -p.rot) }));
}

// ---- The whole pass --------------------------------------------------------------------------------------------

/**
 * One building's own version of a blueprint. `seed` picks the building (fold the world seed and the building
 * id into it); the same seed always gives the same result. The result lints at least as cleanly as `bp`.
 */
export function varyBlueprint(bp: Blueprint, seed: number, opts: VaryOptions): Blueprint {
  const amount = unit(opts.amount, 0.4);
  const wear = unit(opts.wear, 0.3);
  const settled = unit(opts.settled, 0.7);
  let cur: Blueprint = { ...bp, parts: bp.parts.map((p) => ({ ...p })) };
  if (amount <= 0 || cur.parts.length === 0) return cur;
  const rng = makeRng(seed, `vary|${bp.id}`);
  const allowed = lintBlueprint(bp).length;
  const attempt = (next: BlueprintPart[] | null, doorX = cur.doorX): boolean => {
    if (!next || next.length === 0 || next.length > MAX_PARTS) return false;
    const cand: Blueprint = { ...cur, parts: next, doorX };
    if (lintBlueprint(cand).length > allowed) return false;
    cur = cand;
    return true;
  };

  // 1. Height. A plain body gains or loses storeys; any other form is drawn out or pressed down.
  const body = cur.parts[0] as BlueprintPart;
  const total = cur.parts.reduce((m, p) => Math.max(m, topOf(p)), 0);
  if (rng.chance(0.45 + 0.5 * amount)) {
    let done = false;
    if (prism(body) && body.y <= 0.05 && body.h >= 2.8) {
      const floors = Math.max(1, Math.round(body.h / STOREY));
      const most = Math.max(1, Math.round(floors * 0.3 * amount * (0.6 + 0.8 * settled)));
      const down = floors >= 2 && rng.chance(0.42);
      const k = rng.int(1, most) * (down ? -1 : 1);
      done = attempt(changeStoreys(cur.parts, k)) || (Math.abs(k) > 1 && attempt(changeStoreys(cur.parts, Math.sign(k)))) || attempt(changeStoreys(cur.parts, -Math.sign(k)));
    }
    if (!done && total > 3) {
      const f = rng.chance(0.5) ? 1 + rng.range(0.12, 0.45) * amount : 1 - rng.range(0.1, 0.3) * amount;
      attempt(stretchAbove(cur.parts, f));
    }
  }
  // Eaves a little higher or lower than the next building of the same design, and a roof of its own pitch.
  if (total > 3 && rng.chance(0.85)) attempt(stretchAbove(cur.parts, 1 + rng.range(-0.14, 0.2) * Math.min(1, 0.3 + amount)));
  {
    const floor = cur.parts[0] as BlueprintPart;
    const area = floor.w * floor.d;
    let foot = -1;
    for (const p of cur.parts) if (p.tone === 'roof' && p.y >= HEAD && p.h >= 0.5 && p.w * p.d >= 0.3 * area && p.y > foot) foot = p.y;
    if (foot >= HEAD && rng.chance(0.85)) attempt(stretchAbove(cur.parts, 1 + rng.range(-0.38, 0.55) * Math.min(1, 0.3 + amount), foot));
  }

  // 2. Chimneys, vents, masts, finials and the like: small things high up. Each may go, double or move.
  const bodyTop = topOf(cur.parts[0] as BlueprintPart);
  const high = Math.min(bodyTop - 0.6, 0.6 * total);
  const small = cur.parts
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i > 0 && p.repeat === 1 && p.y >= high && Math.max(p.w, p.d) <= 0.3 && p.h >= 0.25);
  // Deal with the lowest first and never with something that rides on a thing already handled.
  const handled = new Set<BlueprintPart>();
  for (const { p } of small.sort((a, b) => a.p.y - b.p.y).slice(0, 6)) {
    if (handled.has(p)) continue;
    const index = cur.parts.indexOf(p);
    if (index < 1) continue;
    const stack = stackOn(cur.parts, index);
    for (const j of stack) handled.add(cur.parts[j] as BlueprintPart);
    const roll = rng.next();
    const q = carrier(cur.parts, index);
    const slide = q ? slideOn(q, p, rng) : null;
    const moved = (t: number): BlueprintPart[] | null => {
      if (!slide || slide.room <= 0.03) return null;
      const to = clamp(t, -slide.room, slide.room);
      const by = to - slide.mid;
      if (Math.abs(by) < 0.03) return null;
      return stack.map((j) => {
        const s = cur.parts[j] as BlueprintPart;
        return { ...s, x: s.x + slide.dx * by, z: s.z + slide.dz * by };
      });
    };
    if (roll < 0.22 * amount) {
      attempt(cur.parts.filter((_, j) => !stack.includes(j)));
    } else if (roll < 0.55 * amount && cur.parts.length + stack.length <= MAX_PARTS) {
      // A second one, across the middle of whatever carries it or a stride along.
      const twin = moved(Math.abs(slide?.mid ?? 0) > 0.08 ? -(slide?.mid ?? 0) : (slide?.mid ?? 0) + (rng.chance(0.5) ? 1 : -1) * rng.range(0.15, 0.3));
      if (twin) attempt([...cur.parts, ...twin]);
    } else if (roll < 0.55 * amount + 0.4) {
      const to = moved((slide?.mid ?? 0) + (rng.chance(0.5) ? 1 : -1) * rng.range(0.06, 0.3) * (0.4 + amount));
      if (to) {
        const next = cur.parts.slice();
        stack.forEach((j, n) => { next[j] = to[n] as BlueprintPart; });
        attempt(next);
      }
    }
  }

  // 3. A lean-to or a shed. Rare in a dense place, where the next building stands close.
  if (rng.chance(amount * (0.16 + 0.3 * (1 - settled)))) attempt(annex(cur.parts, rng));

  // 4. Age: an end shutter gone from a row, a lamp or a board missing, a few things hanging askew.
  if (wear > 0.35) {
    const worn = (wear - 0.35) / 0.65;
    const loose = cur.parts
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i > 0 && Math.max(p.w, p.d) <= (p.h <= 1.3 ? 0.45 : 0.25) && p.h <= 3);
    const missing = Math.min(loose.length, Math.round(worn * (0.5 + amount) * rng.range(0.6, 2.6)));
    for (const { p } of rng.shuffle(loose.slice()).slice(0, missing)) {
      const index = cur.parts.indexOf(p);
      if (index < 1) continue;
      if (p.repeat >= 3) {
        // One end of the row is lost; the rest stay where they were.
        const side = rng.chance(0.5) ? 1 : -1;
        const c = Math.cos(p.rot * RAD);
        const s = Math.sin(p.rot * RAD);
        const next = cur.parts.slice();
        next[index] = { ...p, repeat: p.repeat - 1, x: p.x + (side * p.gap * c) / 2, z: p.z - (side * p.gap * s) / 2 };
        attempt(next);
      } else attempt(cur.parts.filter((_, j) => j !== index));
    }
    const boards = cur.parts
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i > 0 && p.shape === 'box' && p.repeat === 1 && Math.max(p.w, p.d) <= 0.3 && Math.max(p.w, p.d) > 1.5 * Math.min(p.w, p.d));
    const askew = Math.min(boards.length, Math.round(worn * (0.5 + amount) * rng.range(0.4, 2.2)));
    for (const { p } of rng.shuffle(boards.slice()).slice(0, askew)) {
      const index = cur.parts.indexOf(p);
      if (index < 1) continue;
      const next = cur.parts.slice();
      next[index] = { ...p, rot: wrap(p.rot + (rng.chance(0.5) ? 1 : -1) * rng.range(3, 9)) };
      attempt(next);
    }
  }

  // 5. A wing, a porch or an upper stage in the other wall material.
  {
    const next = cur.parts.map((p, i) =>
      i > 0 && (p.tone === 'wall' || p.tone === 'wall2') && p.w * p.d >= 0.03 && p.h >= 1.2 && rng.chance(0.32 * (0.4 + amount))
        ? { ...p, tone: p.tone === 'wall' ? ('wall2' as const) : ('wall' as const) }
        : { ...p });
    attempt(next);
  }

  // 6. Frontage. A round body can only shrink: grown, it would close on its own door.
  {
    const span = MAX_WIDEN * Math.min(1, 0.35 + amount);
    const round = ROUND.has((cur.parts[0] as BlueprintPart).shape);
    const f = 1 + (round ? -rng.next() : rng.range(-1, 1)) * span;
    if (Math.abs(f - 1) > 0.01 && !attempt(widen(cur.parts, f), clamp(cur.doorX * f, -0.4, 0.4)) && f > 1) {
      const g = 2 - f;
      attempt(widen(cur.parts, g), clamp(cur.doorX * g, -0.4, 0.4));
    }
  }

  // 7. Handedness.
  if (rng.chance(0.5)) attempt(mirror(cur.parts), -cur.doorX);

  return {
    ...cur,
    doorX: r3(cur.doorX),
    parts: cur.parts.map((p) => ({ ...p, x: r3(p.x), z: r3(p.z), y: r3(p.y), w: r3(p.w), d: r3(p.d), h: r3(p.h), rot: r3(p.rot), gap: r3(p.gap) })),
  };
}

/** The seed of one building in one world. */
export function buildingSeed(worldSeed: number, buildingId: string, attempt = 0): number {
  return hash32(`${worldSeed >>> 0}|${buildingId}|${attempt}`);
}

/**
 * The outline of a blueprint as a key: what it covers seen from the front and from the side, on a grid of a
 * twentieth of the footprint by half a metre. Two blueprints with the same key look the same from the street.
 */
export function silhouetteKey(bp: Pick<Blueprint, 'parts'>): string {
  const COLS = 28;
  const ROWS = 64;
  const front = new Uint8Array(COLS * ROWS);
  const side = new Uint8Array(COLS * ROWS);
  const mark = (grid: Uint8Array, a0: number, a1: number, y0: number, y1: number): void => {
    const c0 = Math.max(0, Math.round((a0 + 0.7) * 20));
    const c1 = Math.min(COLS, Math.round((a1 + 0.7) * 20));
    const r0 = Math.max(0, Math.round(y0 * 2));
    const r1 = Math.min(ROWS, Math.max(r0 + 1, Math.round(y1 * 2)));
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) grid[r * COLS + c] = 1;
  };
  for (const p of expandParts(bp.parts)) {
    const b = boxOf(p);
    mark(front, b.x0, b.x1, p.y, topOf(p));
    mark(side, b.z0, b.z1, p.y, topOf(p));
  }
  return `${hash32(front.join(''))}-${hash32(side.join(''))}`;
}

export interface Assignable { id: string; x: number; z: number; blueprint?: string; size?: string; keyBuilding?: boolean }

/**
 * Which blueprint each building is built from. A building keeps the blueprint it names. One that names none
 * (or an unknown one) takes the blueprint its neighbours do not have, the least used first. When there are more
 * buildings than blueprints, a building that would stand next to its twin is given another blueprint as well,
 * unless it is a key building: the twin elsewhere of the same size is preferred, so a hall lot gets a hall.
 * Neighbours are each building's two nearest, either way round; the two beyond those are kept different as well
 * while there are blueprints enough.
 */
export function assignBlueprints(buildings: readonly Assignable[], blueprintIds: readonly string[], seed: number): Map<string, string> {
  const out = new Map<string, string>();
  const n = buildings.length;
  if (n === 0 || blueprintIds.length === 0) return out;
  const known = new Set(blueprintIds);
  const near: Set<number>[] = buildings.map(() => new Set<number>());
  const around: Set<number>[] = buildings.map(() => new Set<number>());
  buildings.forEach((a, i) => {
    const order = buildings
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) }))
      .filter((e) => e.j !== i && e.d < 60)
      .sort((p, q) => p.d - q.d || p.j - q.j)
      .slice(0, 4);
    order.forEach((e, rank) => {
      const sets = rank < 2 ? [near, around] : [around];
      for (const s of sets) {
        (s[i] as Set<number>).add(e.j);
        (s[e.j] as Set<number>).add(i);
      }
    });
  });
  const pick: (string | null)[] = buildings.map((b) => (b.blueprint !== undefined && known.has(b.blueprint) ? b.blueprint : null));
  const crowded = n > blueprintIds.length;
  if (crowded) {
    // Key buildings keep theirs; of two ordinary neighbours alike, the later gives way.
    for (let i = 0; i < n; i++) {
      const b = buildings[i] as Assignable;
      if (pick[i] === null || b.keyBuilding) continue;
      for (const j of near[i] as Set<number>) {
        if (pick[j] === pick[i] && (j < i || (buildings[j] as Assignable).keyBuilding)) { pick[i] = null; break; }
      }
    }
  }
  const used = new Map<string, number>();
  const sizes = new Map<string, Set<string>>();
  buildings.forEach((b, i) => {
    const id = pick[i];
    if (id === null || id === undefined) return;
    used.set(id, (used.get(id) ?? 0) + 1);
    if (b.size) sizes.set(id, (sizes.get(id) ?? new Set<string>()).add(b.size));
  });
  for (let i = 0; i < n; i++) {
    if (pick[i] !== null) continue;
    const b = buildings[i] as Assignable;
    const beside = new Set<string>();
    const close = new Set<string>();
    for (const j of near[i] as Set<number>) { const id = pick[j]; if (id) beside.add(id); }
    for (const j of around[i] as Set<number>) { const id = pick[j]; if (id) close.add(id); }
    let best = blueprintIds[0] as string;
    let bestScore = Infinity;
    for (const id of blueprintIds) {
      const fits = b.size !== undefined && sizes.get(id)?.has(b.size) === true;
      const score = (beside.has(id) ? 10000 : close.has(id) ? 1000 : 0)
        + (used.get(id) ?? 0) * 4 + (fits ? 0 : 2) + (hash32(`${seed >>> 0}|${b.id}|${id}`) % 1000) / 1000;
      if (score < bestScore) { bestScore = score; best = id; }
    }
    pick[i] = best;
    used.set(best, (used.get(best) ?? 0) + 1);
    if (b.size) sizes.set(best, (sizes.get(best) ?? new Set<string>()).add(b.size));
  }
  buildings.forEach((b, i) => out.set(b.id, pick[i] as string));
  return out;
}

// ---- Things that grow and lie about: stands, bare ground, one of a kind ---------------------------------------
// Props are not sown evenly. A low, slow noise says where growth gathers and where the ground is bare; a second
// noise per kind says what grows there, so pines stand with pines and scrub takes the next slope. Each instance
// then gets its own size, lean and cast of colour.

const mix32 = (n: number): number => {
  let t = (n + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
};
/** A number in 0..1 from a lattice point. */
const lattice = (ix: number, iz: number, seed: number): number => mix32(mix32(mix32(seed >>> 0) ^ (ix | 0)) ^ Math.imul(iz | 0, 0x9e3779b1)) / 4294967296;
const fade = (t: number): number => t * t * (3 - 2 * t);
const smooth = (lo: number, hi: number, v: number): number => fade(clamp((v - lo) / (hi - lo), 0, 1));

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = lattice(ix, iz, seed);
  const b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed);
  const d = lattice(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Smooth noise in 0..1 with a mean of a half; one unit of x or z is one feature across. */
export function fieldNoise(x: number, z: number, seed: number): number {
  return (valueNoise(x, z, seed) * 2 + valueNoise(x * 2.03 + 11.5, z * 2.03 - 7.25, seed + 977)) / 3;
}

/** A number in 0..1 that belongs to a spot on the ground (to the centimetre) and a purpose. */
export function spotUnit(x: number, z: number, seed: number, salt = 0): number {
  return lattice(Math.round(x * 100), Math.round(z * 100), (seed >>> 0) + Math.imul(salt + 1, 0x85ebca6b));
}

/** Metres across one patch of growth or of bare ground. */
export const PATCH = 24;
/** Metres across one stand of a single kind. */
export const STAND = 34;

/** How thick growth is at a point: 0 on bare ground, 1 in the middle of a thicket. About a quarter of the land is under a half. */
export function growthAt(x: number, z: number, seed: number): number {
  return smooth(0.3, 0.62, fieldNoise(x / PATCH, z / PATCH, (seed >>> 0) + 4201));
}

/** The chance that a spot is left bare, 0..1: nothing where growth is middling or better, nearly all where it is thinnest. */
export function bareAt(x: number, z: number, seed: number): number {
  return clamp(1 - 2 * growthAt(x, z, seed), 0, 1);
}

/** How much a kind favours a point, about 0.1 to 3: most of the land is someone else's, a few places are its own. */
export function standFactor(x: number, z: number, seed: number, kind: number): number {
  const a = fieldNoise(x / STAND + kind * 17.3, z / STAND - kind * 9.1, (seed >>> 0) + 7919 * (kind + 1));
  const over = Math.max(0, a - 0.36);
  return 0.1 + over * over * 32;
}

/**
 * Picks a kind at a point. `strength` 0 is the plain weighted draw; 1 lets the stands decide. `u` is the
 * caller's random number in 0..1.
 */
export function mixKind(weights: readonly number[], x: number, z: number, seed: number, strength: number, u: number): number {
  const s = unit(strength, 0);
  let total = 0;
  const local = weights.map((w, i) => {
    const v = Math.max(0, w) * (1 - s + s * standFactor(x, z, seed, i));
    total += v;
    return v;
  });
  if (!(total > 0)) return 0;
  let t = clamp(u, 0, 0.999999) * total;
  for (let i = 0; i < local.length; i++) {
    t -= local[i] as number;
    if (t < 0) return i;
  }
  return local.length - 1;
}

export interface ShareOptions {
  /** Kinds that may be handed out (poles and lamps keep their own rules). */
  open: readonly boolean[];
  /** Sites that keep the kind they have. */
  locked?: (site: number) => boolean;
  /** Largest share of the sites one kind may hold, 0..1. */
  cap: number;
  /** How many different kinds must appear, when that many are open. */
  minKinds: number;
  seed: number;
}

/**
 * Evens out what a wild place grows. `kinds[i]` is the kind at site i (-1 for none) and is changed in place:
 * a kind holding more than `cap` of the sites gives up the ones it favours least, each to the kind that favours
 * the spot most; a kind that came up nowhere is given a stand of its own where it grows best.
 */
export function evenShares(kinds: number[], sites: readonly { x: number; z: number }[], weights: readonly number[], o: ShareOptions): number[] {
  const live: number[] = [];
  kinds.forEach((k, i) => { if (k >= 0) live.push(i); });
  const n = live.length;
  const openKinds = weights.map((_, k) => k).filter((k) => o.open[k] === true);
  if (n < 6 || weights.length < 3 || openKinds.length < 2) return kinds;
  const counts = weights.map(() => 0);
  for (const i of live) counts[kinds[i] as number] = (counts[kinds[i] as number] ?? 0) + 1;
  const fav = (i: number, k: number): number => {
    const s = sites[i] as { x: number; z: number };
    return standFactor(s.x, s.z, o.seed, k) * Math.max(0.2, weights[k] ?? 1);
  };
  const free = (i: number): boolean => o.locked?.(i) !== true;
  const limit = Math.max(1, Math.floor(o.cap * n));
  weights.forEach((_, k) => {
    if ((counts[k] as number) <= limit) return;
    const mine = live.filter((i) => kinds[i] === k && free(i)).sort((a, b) => fav(a, k) - fav(b, k) || a - b);
    for (const i of mine) {
      if ((counts[k] as number) <= limit) break;
      let best = -1;
      let bestScore = -1;
      for (const j of openKinds) {
        if (j === k || (counts[j] as number) >= limit) continue;
        const score = fav(i, j);
        if (score > bestScore) { bestScore = score; best = j; }
      }
      if (best < 0) break;
      kinds[i] = best;
      counts[k] = (counts[k] as number) - 1;
      counts[best] = (counts[best] as number) + 1;
    }
  });
  const need = Math.min(o.minKinds, counts.filter((c, k) => c > 0 || o.open[k] === true).length);
  const stand = Math.max(2, Math.round(0.06 * n));
  const missing = openKinds.filter((k) => counts[k] === 0).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || a - b);
  for (const k of missing) {
    if (counts.filter((c) => c > 0).length >= need) break;
    // Its best spot among the sites of kinds that can spare some, then the sites nearest to that spot.
    const donors = live.filter((i) => free(i) && (counts[kinds[i] as number] as number) > 2 * stand);
    if (donors.length === 0) break;
    let heart = donors[0] as number;
    for (const i of donors) if (fav(i, k) > fav(heart, k)) heart = i;
    const h = sites[heart] as { x: number; z: number };
    const nearest = donors
      .map((i) => ({ i, d: Math.hypot((sites[i] as { x: number; z: number }).x - h.x, (sites[i] as { x: number; z: number }).z - h.z) }))
      .sort((a, b) => a.d - b.d || a.i - b.i);
    let given = 0;
    for (const { i } of nearest) {
      if (given >= stand) break;
      const from = kinds[i] as number;
      if ((counts[from] as number) <= stand) continue;
      kinds[i] = k;
      counts[from] = (counts[from] as number) - 1;
      counts[k] = (counts[k] as number) + 1;
      given++;
    }
  }
  return kinds;
}

/**
 * What makes one instance of a prop its own. `scale` is its size; `height`, `wide` and `deep` stretch it along
 * its own axes (a boulder is never the same boulder twice); the lean is radians about x and z; `value` and
 * `warm` cast its colour lighter or darker, warmer or cooler.
 */
export interface InstanceLook { scale: number; height: number; wide: number; deep: number; leanX: number; leanZ: number; value: number; warm: number }

/** 'tree': tall and grown. 'grown': low and of the land (rocks, scrub, mounds). 'pole': a lamp or a mast. 'thing': made. */
export type InstanceForm = 'tree' | 'grown' | 'pole' | 'thing';

/**
 * One instance's look, from where it stands. With the slot's own scale (0.85 to 1.2) sizes run from about
 * 0.75 to 1.3. A tree has the widest spread, with the odd giant, a lean of a few degrees and its own height
 * for its girth; a low grown thing is squatter or taller, broader one way than the other; a made thing keeps
 * its proportions and a pole stays upright and near its size. `spread` above 1 widens the differences in
 * shape, for a place that has only one or two kinds to show.
 */
export function instanceLook(seed: number, x: number, z: number, form: InstanceForm, spread = 1): InstanceLook {
  const rng = makeRng(seed, `inst|${Math.round(x * 100)}|${Math.round(z * 100)}`);
  const u = rng.next();
  const value = 1 + (rng.next() - 0.5) * 0.16;
  const warm = (rng.next() - 0.5) * 0.07;
  const k = Math.max(0, spread);
  const around = (amount: number): number => 1 + (rng.next() - 0.5) * 2 * amount * k;
  if (form === 'pole') return { scale: 0.94 + 0.12 * u, height: 1, wide: 1, deep: 1, leanX: 0, leanZ: 0, value: 1, warm: 0 };
  if (form === 'thing') return { scale: 0.9 + 0.18 * u, height: 1, wide: 1, deep: 1, leanX: 0, leanZ: 0, value: 1 + (value - 1) * 0.5, warm: warm * 0.5 };
  const giant = rng.chance(0.1) ? rng.range(1.15, 1.4) : 1;
  if (form === 'grown') {
    return { scale: (0.88 + 0.22 * u * u) * giant, height: around(0.22), wide: around(0.18), deep: around(0.18), leanX: 0, leanZ: 0, value, warm };
  }
  const lean = rng.range(0, 0.085) * rng.next();
  const dir = rng.range(0, Math.PI * 2);
  return {
    scale: (0.86 + 0.24 * u * u) * giant, height: around(0.16) + 0.02, wide: around(0.08), deep: around(0.08),
    leanX: Math.cos(dir) * lean, leanZ: Math.sin(dir) * lean, value, warm,
  };
}
