// Architectural dressing: turns a blueprint's bare primitives into believable construction. Works on
// expanded parts (repeat = 1) and returns the same parts followed by what was added:
//   - a plinth, corner posts or quoin strips, storey bands every 3.2 m;
//   - at the roof: a fascia and shadow line, rafter ends, a boxed eave carried out past the wall by an
//     amount that suits the roofing, gutters along the eaves and downpipes to the ground;
//   - at every window: a casing, reveals that set the glass back in the thickness of the wall, a
//     projecting sill, a lintel and glazing bars;
//   - a framed door 1.0 m by 2.1 m with a step;
//   - on the roof: a chimney where the walls are timber, masonry or render, vents and plant where they
//     are metal or glass; a ridge vent on a metal gable;
//   - on metal walls: an access ladder, service pipes on brackets, a cable tray, a guard rail on a flat roof;
//   - corbels under balconies.
// Trim sits flush or a few centimetres proud of what it dresses; eaves, pipes, ladders and roof clutter
// reach further (see REACH_FAR and RISE). The pass also reports where dirty water runs: under every
// sill, under gutter ends and below iron brackets (ctx.stains).
import type { Rng } from '../world/rng';
import type { BlueprintPart, PartShape, PartTone, SurfaceKind, SurfaceSet } from '../world/spec';
import { surfaceFamily } from './surfaces';

/** A run-off stain on a wall, metres in the building's frame (x, z on the footprint, +z the front). */
export interface Stain {
  /** Middle of the stain's top edge. */
  x: number;
  z: number;
  y: number;
  /** Width along the wall and length down it. */
  w: number;
  h: number;
  /** Direction the stained face looks, degrees about the vertical; 0 is +z. */
  rot: number;
  kind: 'stain' | 'rust';
}

export interface DressContext {
  /** Footprint in metres. */
  w: number;
  d: number;
  rng: Rng;
  surfaces: SurfaceSet;
  /** Door position on the front face as a fraction of the footprint width; no door dressing when absent. */
  doorX?: number;
  /** When given, the pass appends the run-off stains it wants drawn. */
  stains?: Stain[];
}

/** Most parts a building may have after dressing. */
export const MAX_DRESSED_PARTS = 140;
/** Furthest ordinary trim may reach outside the original bounding box, metres. */
const REACH = 0.085;
/** Furthest eaves, gutters, pipes and ladders may reach outside it. */
export const REACH_FAR = 0.65;
/** Highest a chimney, vent or rail may stand above it. */
export const RISE = 1.5;
const RAD = Math.PI / 180;

/** Floor-to-floor height, door size and how far each roofing is carried past the wall, metres. */
export const STOREY = 3.2;
export const DOOR = { w: 1.0, h: 2.1 } as const;
const OVERHANG: Partial<Record<SurfaceKind, number>> = {
  thatch: 0.5, tile: 0.4, shingle: 0.35, slate: 0.3, timber: 0.3, planks: 0.3, corrugated: 0.25, metal_panel: 0.2, rusted: 0.25, canvas: 0.15,
};

/** A part in metres on the footprint, with its rotation resolved. */
interface Solid { cx: number; cz: number; y: number; w: number; d: number; h: number; rot: number; cos: number; sin: number }
interface Bounds { x0: number; x1: number; z0: number; z1: number; top: number }
interface Extra { part: BlueprintPart; rank: number; loose: boolean }
interface AddOpts { loose?: boolean; reach?: number; rise?: number }

function solid(p: BlueprintPart, W: number, D: number): Solid {
  return { cx: p.x * W, cz: p.z * D, y: p.y, w: p.w * W, d: p.d * D, h: p.h, rot: p.rot, cos: Math.cos(p.rot * RAD), sin: Math.sin(p.rot * RAD) };
}

function boundsOf(s: Solid): Bounds {
  const c = Math.abs(s.cos);
  const n = Math.abs(s.sin);
  const hx = (s.w / 2) * c + (s.d / 2) * n;
  const hz = (s.w / 2) * n + (s.d / 2) * c;
  return { x0: s.cx - hx, x1: s.cx + hx, z0: s.cz - hz, z1: s.cz + hz, top: s.y + s.h };
}

/** Bounding box of a set of parts, metres on a `w` by `d` footprint. */
export function partsBounds(parts: readonly BlueprintPart[], w: number, d: number): Bounds & { y0: number } {
  const out = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, top: -Infinity, y0: Infinity };
  for (const p of parts) {
    const b = boundsOf(solid(p, w, d));
    out.x0 = Math.min(out.x0, b.x0);
    out.x1 = Math.max(out.x1, b.x1);
    out.z0 = Math.min(out.z0, b.z0);
    out.z1 = Math.max(out.z1, b.z1);
    out.top = Math.max(out.top, b.top);
    out.y0 = Math.min(out.y0, p.y);
  }
  return out;
}

export function dressParts(parts: BlueprintPart[], ctx: DressContext): BlueprintPart[] {
  const W = ctx.w;
  const D = ctx.d;
  if (parts.length === 0 || parts.length >= MAX_DRESSED_PARTS || !(W > 0) || !(D > 0)) return parts;
  const limit = partsBounds(parts, W, D);
  const extras: Extra[] = [];
  const wear = Math.min(1, Math.max(0, ctx.surfaces.wear));
  const rng = ctx.rng;

  /** Adds a part given in metres in the frame of `s`: `lx`/`lz` offset its centre along the solid's own axes. */
  const add = (
    shape: PartShape, s: Solid, lx: number, lz: number, y: number, w: number, d: number, h: number,
    tone: PartTone, rank: number, o: AddOpts = {},
  ): boolean => {
    if (!(w > 0.005) || !(d > 0.005) || !(h > 0.005) || y < 0) return false;
    const q: Solid = { ...s, cx: s.cx + lx * s.cos + lz * s.sin, cz: s.cz - lx * s.sin + lz * s.cos, y, w, d, h };
    const b = boundsOf(q);
    const reach = o.reach ?? REACH;
    const rise = o.rise ?? REACH;
    if (b.x0 < limit.x0 - reach || b.x1 > limit.x1 + reach || b.z0 < limit.z0 - reach || b.z1 > limit.z1 + reach || b.top > limit.top + rise) return false;
    extras.push({ part: { shape, x: q.cx / W, z: q.cz / D, y, w: w / W, d: d / D, h, rot: s.rot, tone, repeat: 1, gap: 0 }, rank, loose: o.loose === true });
    return true;
  };

  /** Records a stain on the face of `s` that looks along its local z (`side` 1 or -1) or local x (`axis` 'x'). */
  const stain = (s: Solid, axis: 'x' | 'z', side: number, along: number, y: number, w: number, h: number, kind: Stain['kind']): void => {
    if (!ctx.stains || !(w > 0.05) || !(h > 0.12)) return;
    const lx = axis === 'x' ? side * (s.w / 2 + 0.006) : along;
    const lz = axis === 'z' ? side * (s.d / 2 + 0.006) : along;
    ctx.stains.push({
      x: s.cx + lx * s.cos + lz * s.sin, z: s.cz - lx * s.sin + lz * s.cos, y, w, h: Math.min(h, y - 0.02),
      rot: s.rot + (axis === 'z' ? (side > 0 ? 0 : 180) : side > 0 ? 90 : -90), kind,
    });
  };

  const family = surfaceFamily(ctx.surfaces.wall);
  const grown = family === 'organic' || family === 'mineral';
  const industrial = family === 'metal' || family === 'glass';
  // What the frame of the building is made of, as a tone: dark timber on rendered and metal walls,
  // dressed trim on masonry and boarded ones.
  const frameTone: PartTone = family === 'render' || industrial || family === 'fabric' ? 'dark' : 'trim';
  const postSize = family === 'masonry' ? 0.4 : industrial || family === 'fabric' ? 0.1 : 0.18;

  // The main body: the biggest wall mass standing on the ground.
  let body: BlueprintPart | null = null;
  let bodyVol = 0;
  for (const p of parts) {
    if ((p.shape !== 'box' && p.shape !== 'cylinder') || p.y > 0.3 || (p.tone !== 'wall' && p.tone !== 'wall2')) continue;
    const vol = p.w * W * p.d * D * p.h;
    if (vol > bodyVol && p.h >= 1.8) {
      body = p;
      bodyVol = vol;
    }
  }
  const bs = body ? solid(body, W, D) : null;
  const boxBody = body !== null && body.shape === 'box';

  if (body && bs && !grown) {
    const ph = Math.min(0.45, Math.max(0.25, bs.h * 0.09));
    add(body.shape, bs, 0, 0, bs.y, bs.w + 0.1, bs.d + 0.1, ph, family === 'masonry' ? 'trim' : 'dark', 0);
    if (boxBody && Math.min(bs.w, bs.d) > 2) {
      const t = postSize;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) add('box', bs, sx * (bs.w / 2 - t / 2 + 0.03), sz * (bs.d / 2 - t / 2 + 0.03), bs.y, t, t, bs.h, frameTone, 1);
      }
    }
    if (family !== 'fabric') {
      let bands = 0;
      for (let y = bs.y + STOREY; y < bs.y + bs.h - 1.2 && bands < 4; y += STOREY, bands++) {
        add(body.shape, bs, 0, 0, y - 0.08, bs.w + 0.05, bs.d + 0.05, 0.16, frameTone, 3);
      }
    }
  }

  // Roofs: a fascia board under the roof edge, a shadow line under that, rafter ends under gable eaves.
  const roofs = parts
    .filter((p) => p.tone === 'roof' && p.y >= 1.5 && p.shape !== 'sphere' && p.shape !== 'ring' && p.shape !== 'arch' && Math.min(p.w * W, p.d * D) >= 1.5)
    .sort((a, b) => b.w * b.d - a.w * a.d)
    .slice(0, 4);
  const roofKind = ctx.surfaces.roof;
  const roofFamily = surfaceFamily(roofKind);
  const guttered = !grown && family !== 'fabric' && roofFamily !== 'fabric' && roofFamily !== 'organic' && roofFamily !== 'mineral' && roofKind !== 'thatch';
  roofs.forEach((r, index) => {
    if (grown) return;
    const s = solid(r, W, D);
    const round = r.shape === 'cone' || r.shape === 'dome' || r.shape === 'cylinder';
    const shape: PartShape = round ? 'cylinder' : 'box';
    add(shape, s, 0, 0, s.y - 0.16, s.w + 0.06, s.d + 0.06, 0.16, 'trim', 1);
    add(shape, s, 0, 0, s.y - 0.21, s.w + 0.02, s.d + 0.02, 0.05, 'dark', 4);
    if (r.shape === 'gable') {
      const n = Math.min(7, Math.max(2, Math.floor(s.w / 0.9)));
      for (let i = 0; i < n; i++) {
        const lx = ((i + 0.5) / n - 0.5) * (s.w - 0.3);
        for (const sz of [-1, 1]) add('box', s, lx, sz * (s.d / 2 - 0.09), s.y - 0.28, 0.09, 0.28, 0.12, 'dark', 6, { loose: true });
      }
    }
    // Eaves: the roofing carried out past the wall on a boxed soffit, a gutter at its edge. A gable
    // sheds to both sides of its ridge (local z), a lean-to to its low side (local -x).
    if (index > 1 || (r.shape !== 'gable' && r.shape !== 'wedge')) return;
    const out = OVERHANG[roofKind] ?? 0.2;
    const eaves: { axis: 'x' | 'z'; side: number }[] = r.shape === 'gable' ? [{ axis: 'z', side: -1 }, { axis: 'z', side: 1 }] : [{ axis: 'x', side: -1 }];
    for (const e of eaves) {
      const run = e.axis === 'z' ? s.w : s.d;
      const half = e.axis === 'z' ? s.d / 2 : s.w / 2;
      const place = (off: number, y: number, across: number, h: number, tone: PartTone, rank: number, length = run + 0.12): boolean =>
        e.axis === 'z'
          ? add('box', s, 0, e.side * (half + off), y, length, across, h, tone, rank, { reach: REACH_FAR })
          : add('box', s, e.side * (half + off), 0, y, across, length, h, tone, rank, { reach: REACH_FAR });
      place(out / 2, s.y - 0.07, out, 0.09, 'roof', 2);
      place(out / 2, s.y - 0.13, out - 0.04, 0.06, 'trim', 5);
      if (!guttered) continue;
      place(out + 0.055, s.y - 0.15, 0.11, 0.1, 'dark', 5);
      // A downpipe at one end of each eave, standing just off the wall beneath it.
      const end = (index + (e.side > 0 ? 1 : 0)) % 2 === 0 ? 1 : -1;
      const at = end * (run / 2 - 0.3);
      const pipeH = s.y - 0.15 - 0.12;
      const piped = e.axis === 'z'
        ? add('cylinder', s, at, e.side * (half + out + 0.055), 0.12, 0.09, 0.09, pipeH, 'dark', 6, { reach: REACH_FAR })
        : add('cylinder', s, e.side * (half + out + 0.055), at, 0.12, 0.09, 0.09, pipeH, 'dark', 6, { reach: REACH_FAR });
      if (piped && bs && boxBody && Math.abs(Math.abs(bs.cos * s.cos + bs.sin * s.sin) - 1) < 0.01) {
        // Where the gutter overflows at its far end, the wall below is streaked.
        const sameAxis = e.axis;
        const reach = 0.6 + 1.6 * wear * rng.next();
        const span = sameAxis === 'z' ? bs.w : bs.d;
        stain(bs, sameAxis, e.side, -end * (span / 2 - 0.5), bs.y + bs.h - 0.02, 0.5 + 0.5 * rng.next(), reach, 'stain');
      }
    }
  });

  // Windows: every thin glass slab gets a casing behind it, reveals at its sides and head, a sill, a
  // lintel and glazing bars in front.
  for (const p of parts) {
    if (p.tone !== 'glass' || p.shape !== 'box') continue;
    const s = solid(p, W, D);
    const alongX = s.w >= s.d;
    const along = alongX ? s.w : s.d;
    const thick = alongX ? s.d : s.w;
    if (thick > 0.45 || along < 0.35 || s.h < 0.4) continue;
    /** A box sized along the pane, up it and through it, offset along the pane by `la`. */
    const pane = (la: number, y: number, a: number, h: number, t: number, tone: PartTone, rank: number, loose = false): void => {
      if (alongX) add('box', s, la, 0, y, a, t, h, tone, rank, { loose });
      else add('box', s, 0, la, y, t, a, h, tone, rank, { loose });
    };
    const big = s.h > 3.5 || along > 4;
    if (!big) {
      pane(0, Math.max(0, s.y - 0.07), along + 0.14, s.h + 0.14 - Math.max(0, 0.07 - s.y), thick > 0.06 ? thick - 0.03 : thick * 0.5, 'trim', 2);
      if (s.y >= 0.3) pane(0, s.y - 0.13, along + 0.26, 0.07, thick + 0.14, 'trim', 3, true);
      pane(0, s.y + s.h + 0.05, along + 0.2, 0.1, thick + 0.04, 'trim', 5, true);
      // Reveals: the glass sits back between jambs as deep as the wall is thick.
      if (!grown) {
        for (const sx of [-1, 1]) pane(sx * (along / 2 + 0.035), s.y - 0.06, 0.07, s.h + 0.11, thick + 0.12, frameTone, 4);
        pane(0, s.y + s.h - 0.01, along + 0.14, 0.07, thick + 0.12, frameTone, 4);
      }
    }
    const bars = big ? Math.min(4, Math.max(1, Math.round(along / 1.2) - 1)) : along > 1.8 ? 2 : 1;
    for (let i = 1; i <= bars; i++) pane((i / (bars + 1) - 0.5) * along, s.y, 0.045, s.h, thick + 0.03, 'trim', 4);
    const rails = big ? Math.min(2, Math.max(1, Math.round(s.h / 1.5) - 1)) : s.h > 0.9 ? 1 : 0;
    for (let i = 1; i <= rails; i++) pane(0, s.y + (rails === 1 ? 0.56 : i / (rails + 1)) * s.h, along, 0.045, thick + 0.03, 'trim', 4);
    // Water runs off the ends of the sill and down the wall beneath: find the body face this pane is on.
    if (!big && bs && boxBody && s.y >= 0.7 && Math.abs(Math.abs(bs.cos * s.cos + bs.sin * s.sin) - 1) < 0.01) {
      const rx = s.cx - bs.cx;
      const rz = s.cz - bs.cz;
      const lx = rx * bs.cos - rz * bs.sin;
      const lz = rx * bs.sin + rz * bs.cos;
      const sameWay = Math.abs(bs.cos * s.cos + bs.sin * s.sin) > 0.99 ? alongX : !alongX;
      const length = Math.min(s.y - 0.2, (0.35 + 0.9 * wear) * (0.6 + 0.8 * rng.next()));
      if (sameWay && Math.abs(Math.abs(lz) - bs.d / 2) < thick / 2 + 0.12 && Math.abs(lx) < bs.w / 2) {
        stain(bs, 'z', Math.sign(lz) || 1, lx, s.y - 0.12, along + 0.2, length, 'stain');
      } else if (!sameWay && Math.abs(Math.abs(lx) - bs.w / 2) < thick / 2 + 0.12 && Math.abs(lz) < bs.d / 2) {
        stain(bs, 'x', Math.sign(lx) || 1, lz, s.y - 0.12, along + 0.2, length, 'stain');
      }
    }
  }

  // Door: find the wall face behind doorX, hang a leaf if the blueprint has none, frame it, lay a step.
  if (ctx.doorX !== undefined && Number.isFinite(ctx.doorX)) {
    const dx = Math.min(0.4, Math.max(-0.4, ctx.doorX)) * W;
    let face = -Infinity;
    for (const p of parts) {
      if (p.tone === 'glass' || p.tone === 'roof' || p.tone === 'glow' || p.y > 0.3 || p.h < 1.8) continue;
      const b = boundsOf(solid(p, W, D));
      if (b.x1 - b.x0 >= 1 && dx > b.x0 + 0.3 && dx < b.x1 - 0.3 && b.z1 > face) face = b.z1;
    }
    if (face > 0) {
      let dw: number = DOOR.w;
      let dh: number = DOOR.h;
      let leaf = false;
      for (const p of parts) {
        if (p.tone === 'wall' || p.tone === 'wall2' || p.tone === 'roof' || p.y > 0.3 || p.h < 1.6 || p.h > 3.2) continue;
        const b = boundsOf(solid(p, W, D));
        const bw = b.x1 - b.x0;
        if (bw >= 0.6 && bw <= 2.4 && dx > b.x0 && dx < b.x1 && b.z1 >= face - 0.06 && b.z1 <= face + 0.3) {
          leaf = true;
          dw = bw;
          dh = b.top;
          face = Math.max(face, b.z1);
        }
      }
      const front: Solid = { cx: dx, cz: face, y: 0, w: 1, d: 1, h: 1, rot: 0, cos: 1, sin: 0 };
      if (!leaf) add('box', front, 0, 0.01, 0, dw, 0.06, dh, 'dark', 1);
      for (const sx of [-1, 1]) add('box', front, sx * (dw / 2 + 0.05), 0.02, 0, 0.1, 0.1, dh + 0.02, 'trim', 2);
      add('box', front, 0, 0.02, dh, dw + 0.36, 0.12, 0.14, 'trim', 2, { loose: true });
      const out = Math.min(0.42, limit.z1 + REACH - 0.005 - face);
      if (out >= 0.06) add('box', front, 0, out / 2 - 0.03, 0, dw + 0.5, out + 0.06, 0.14, family === 'masonry' ? 'trim' : 'dark', 3);
    }
  }

  // Balconies and awnings: thin slabs that sail past the front of the body get corbels beneath.
  if (body && bs) {
    const bb = boundsOf(bs);
    let done = 0;
    for (const p of parts) {
      if (done >= 3) break;
      if (p === body || p.shape !== 'box' || p.y < 1.8 || p.h > 0.45 || p.tone === 'glass' || p.tone === 'glow') continue;
      const b = boundsOf(solid(p, W, D));
      const sail = b.z1 - bb.z1;
      const width = b.x1 - b.x0;
      if (sail < 0.4 || width < 1.2 || b.z0 > bb.z1 + 0.1) continue;
      const depth = Math.min(0.5, sail * 0.6);
      const wall: Solid = { cx: (b.x0 + b.x1) / 2, cz: bb.z1, y: 0, w: 1, d: 1, h: 1, rot: 0, cos: 1, sin: 0 };
      const n = width > 3.5 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const lx = (i / (n - 1) - 0.5) * (width - 0.5);
        add('box', wall, lx, depth / 2 - 0.02, p.y - 0.28, 0.1, depth, 0.28, 'dark', 5, { loose: true });
      }
      done++;
    }
  }

  // What stands on the roof. A building that already has something tall and slim rising through its
  // roof line (a chimney, a mast, a spire) keeps that and gets nothing more.
  const top = roofs[0];
  if (top && !grown && family !== 'fabric') {
    const s = solid(top, W, D);
    const crown = s.y + s.h;
    const flat = top.shape === 'box' || top.shape === 'cylinder';
    const stacked = parts.some((p) => p !== top && p.tone !== 'roof' && p.y + p.h > crown - 0.3 && Math.max(p.w * W, p.d * D) < 1.6 && p.h > 1);
    const sx = rng.chance(0.5) ? 1 : -1;
    const sz = rng.chance(0.5) ? 1 : -1;
    const up = { rise: RISE, reach: REACH };
    if (!stacked && !industrial && (top.shape === 'gable' || top.shape === 'wedge' || flat)) {
      // A chimney, built of the masonry the building has, or a flue pipe where it has none.
      const stackTone: PartTone | null = surfaceFamily(ctx.surfaces.wall2) === 'masonry' ? 'wall2'
        : surfaceFamily(ctx.surfaces.trim) === 'masonry' ? 'trim' : family === 'masonry' || family === 'render' ? 'wall' : null;
      const lx = sx * 0.24 * s.w;
      const lz = top.shape === 'gable' ? sz * 0.16 * s.d : sz * 0.2 * s.d;
      const from = flat ? crown - 0.05 : Math.max(0, s.y - 0.2);
      const to = crown + (flat ? 1.0 : 0.7);
      if (stackTone) {
        if (add('box', s, lx, lz, from, 0.58, 0.58, to - from, stackTone, 4, up)) {
          add('box', s, lx, lz, to, 0.72, 0.72, 0.08, 'trim', 7, up);
          add('cylinder', s, lx - 0.12, lz, to + 0.08, 0.2, 0.2, 0.3, 'dark', 8, up);
          add('cylinder', s, lx + 0.14, lz, to + 0.08, 0.17, 0.17, 0.24, 'dark', 8, up);
        }
      } else if (add('cylinder', s, lx, lz, from, 0.2, 0.2, to - from + 0.2, 'dark', 4, up)) {
        add('cone', s, lx, lz, to + 0.2, 0.34, 0.34, 0.16, 'dark', 8, up);
      }
    }
    if (industrial) {
      if (flat) {
        // Plant on a flat roof: a housed unit on a frame, two cowled vents, a pipe run between them.
        const ux = sx * 0.2 * s.w;
        const uz = -0.15 * s.d;
        add('box', s, ux, uz, crown, 1.3, 0.8, 0.12, 'dark', 6, up);
        add('box', s, ux, uz, crown + 0.12, 1.2, 0.72, 0.78, 'wall2', 5, up);
        add('box', s, ux, uz + 0.37, crown + 0.3, 0.9, 0.03, 0.42, 'dark', 8, up);
        for (const k of [0, 1]) {
          const vx = -sx * (0.12 + 0.2 * k) * s.w;
          const vz = sz * 0.22 * s.d;
          if (add('cylinder', s, vx, vz, crown, 0.36, 0.36, 0.45 + 0.2 * k, 'dark', 6, up)) add('cone', s, vx, vz, crown + 0.5 + 0.2 * k, 0.52, 0.52, 0.16, 'dark', 8, up);
        }
        add('box', s, 0, sz * 0.22 * s.d - sz * 0.5, crown + 0.1, 0.55 * s.w, 0.1, 0.1, 'dark', 8, up);
        // A guard rail along the front edge.
        const n = Math.min(7, Math.max(2, Math.round(s.w / 1.6)));
        const fz = s.d / 2 - 0.08;
        for (let i = 0; i <= n; i++) add('box', s, (i / n - 0.5) * (s.w - 0.16), fz, crown, 0.05, 0.05, 1.05, 'dark', 9, up);
        add('box', s, 0, fz, crown + 1.0, s.w - 0.1, 0.05, 0.05, 'dark', 8, up);
        add('box', s, 0, fz, crown + 0.5, s.w - 0.1, 0.035, 0.035, 'dark', 9, up);
      } else if (top.shape === 'gable') {
        // A raised ridge vent.
        add('box', s, 0, 0, crown - 0.12, 0.55 * s.w, 0.5, 0.2, 'dark', 6, up);
        add('box', s, 0, 0, crown + 0.08, 0.6 * s.w, 0.7, 0.06, 'roof', 6, up);
      }
    }
  }

  // Services on a metal building: an access ladder on one side wall, pipes and a cable tray on the other.
  if (industrial && bs && boxBody && bs.h >= 3 && bs.d >= 3) {
    const side = rng.chance(0.5) ? 1 : -1;
    const far = { reach: REACH_FAR, rise: RISE };
    const wallX = bs.w / 2;
    // Ladder: two stiles standing 15 cm off the wall, rungs every 30 cm, stand-offs back to the wall.
    const lz0 = -0.22 * bs.d;
    const ladderH = bs.h + 0.9;
    for (const dz of [-0.22, 0.22]) add('box', bs, side * (wallX + 0.17), lz0 + dz, bs.y + 0.3, 0.05, 0.05, ladderH - 0.3, 'dark', 7, far);
    const rungs = Math.min(16, Math.floor((ladderH - 0.6) / 0.3));
    const pitch = (ladderH - 0.6) / rungs;
    for (let i = 0; i < rungs; i++) add('box', bs, side * (wallX + 0.17), lz0, bs.y + 0.5 + i * pitch, 0.03, 0.44, 0.03, 'dark', 9, far);
    for (const y of [bs.y + 0.8, bs.y + bs.h * 0.5, bs.y + bs.h - 0.3]) {
      for (const dz of [-0.22, 0.22]) add('box', bs, side * (wallX + 0.085), lz0 + dz, y, 0.17, 0.04, 0.04, 'dark', 10, far);
    }
    // Pipes: two risers of different bore, clipped to the wall every two metres, rust below the clips.
    const px = -side * (wallX + 0.11);
    const pz = 0.18 * bs.d;
    add('cylinder', bs, px, pz, bs.y, 0.14, 0.14, bs.h - 0.15, 'dark', 7, far);
    add('cylinder', bs, px + side * 0.02, pz + 0.26, bs.y, 0.09, 0.09, bs.h * 0.8, 'trim', 8, far);
    for (let y = bs.y + 1; y < bs.y + bs.h - 0.4; y += 2) {
      add('box', bs, -side * (wallX + 0.1), pz + 0.13, y, 0.2, 0.5, 0.05, 'dark', 9, far);
      stain(bs, 'x', -side, pz + 0.13, y, 0.42, 0.5 + 1.2 * wear * rng.next(), 'rust');
    }
    // Cable tray: a shallow channel along the wall above head height, on angle brackets.
    const ty = bs.y + Math.min(2.9, bs.h * 0.62);
    const tz = -0.12 * bs.d;
    const tl = 0.5 * bs.d;
    if (add('box', bs, -side * (wallX + 0.12), tz, ty, 0.2, tl, 0.07, 'dark', 8, far)) {
      for (const k of [-1, 0, 1]) add('box', bs, -side * (wallX + 0.1), tz + k * (tl / 2 - 0.15), ty - 0.16, 0.2, 0.04, 0.16, 'dark', 10, far);
      stain(bs, 'x', -side, tz + tl / 2 - 0.15, ty - 0.16, 0.3, 0.4 + wear * rng.next(), 'rust');
    }
  }

  // Old buildings settle: loose trim hangs a little out of true.
  if (wear > 0.5) {
    const amount = (wear - 0.5) * 2;
    for (const e of extras) {
      if (!e.loose || !rng.chance(0.4)) continue;
      e.part.rot += rng.range(-1.5, 1.5) * amount;
      e.part.y = Math.max(0, e.part.y - rng.range(0, 0.02) * amount);
    }
  }

  // Keep the most structural additions; among equals, the larger ones.
  const volume = (p: BlueprintPart): number => p.w * W * p.d * D * p.h;
  extras.sort((a, b) => a.rank - b.rank || volume(b.part) - volume(a.part));
  const room = MAX_DRESSED_PARTS - parts.length;
  return parts.concat(extras.slice(0, room).map((e) => e.part));
}
