// Architectural dressing: turns a blueprint's bare primitives into believable construction without
// moving its outline. Works on expanded parts (repeat = 1) and returns the same parts followed by the
// added trim: a plinth, corner posts or quoin strips, storey bands, fascia and rafter ends under roofs,
// casings, sills, lintels and glazing bars on windows, a framed door with a step, corbels under
// balconies. Every addition sits flush or 1 to 8 cm proud of what it dresses, so nothing shares a plane.
import type { Rng } from '../world/rng';
import type { BlueprintPart, PartShape, PartTone, SurfaceSet } from '../world/spec';
import { surfaceFamily } from './surfaces';

export interface DressContext {
  /** Footprint in metres. */
  w: number;
  d: number;
  rng: Rng;
  surfaces: SurfaceSet;
  /** Door position on the front face as a fraction of the footprint width; no door dressing when absent. */
  doorX?: number;
}

/** Most parts a building may have after dressing. */
export const MAX_DRESSED_PARTS = 90;
/** Furthest any addition may reach outside the original bounding box, metres. */
const REACH = 0.085;
const RAD = Math.PI / 180;

/** A part in metres on the footprint, with its rotation resolved. */
interface Solid { cx: number; cz: number; y: number; w: number; d: number; h: number; rot: number; cos: number; sin: number }
interface Bounds { x0: number; x1: number; z0: number; z1: number; top: number }
interface Extra { part: BlueprintPart; rank: number; loose: boolean }

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

  /** Adds a part given in metres in the frame of `s`: `lx`/`lz` offset its centre along the solid's own axes. */
  const add = (
    shape: PartShape, s: Solid, lx: number, lz: number, y: number, w: number, d: number, h: number,
    tone: PartTone, rank: number, loose = false,
  ): void => {
    if (!(w > 0.005) || !(d > 0.005) || !(h > 0.005) || y < 0) return;
    const q: Solid = { ...s, cx: s.cx + lx * s.cos + lz * s.sin, cz: s.cz - lx * s.sin + lz * s.cos, y, w, d, h };
    const b = boundsOf(q);
    if (b.x0 < limit.x0 - REACH || b.x1 > limit.x1 + REACH || b.z0 < limit.z0 - REACH || b.z1 > limit.z1 + REACH || b.top > limit.top + REACH) return;
    extras.push({ part: { shape, x: q.cx / W, z: q.cz / D, y, w: w / W, d: d / D, h, rot: s.rot, tone, repeat: 1, gap: 0 }, rank, loose });
  };

  const family = surfaceFamily(ctx.surfaces.wall);
  const grown = family === 'organic' || family === 'mineral';
  // What the frame of the building is made of, as a tone: dark timber on rendered and metal walls,
  // dressed trim on masonry and boarded ones.
  const frameTone: PartTone = family === 'render' || family === 'metal' || family === 'glass' || family === 'fabric' ? 'dark' : 'trim';
  const postSize = family === 'masonry' ? 0.4 : family === 'metal' || family === 'glass' || family === 'fabric' ? 0.1 : 0.18;

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

  if (body && !grown) {
    const s = solid(body, W, D);
    const ph = Math.min(0.45, Math.max(0.25, s.h * 0.09));
    add(body.shape, s, 0, 0, s.y, s.w + 0.1, s.d + 0.1, ph, family === 'masonry' ? 'trim' : 'dark', 0);
    if (body.shape === 'box' && Math.min(s.w, s.d) > 2) {
      const t = postSize;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) add('box', s, sx * (s.w / 2 - t / 2 + 0.03), sz * (s.d / 2 - t / 2 + 0.03), s.y, t, t, s.h, frameTone, 1);
      }
    }
    if (family !== 'fabric') {
      let bands = 0;
      for (let y = s.y + 3; y < s.y + s.h - 1.2 && bands < 3; y += 3, bands++) {
        add(body.shape, s, 0, 0, y - 0.08, s.w + 0.05, s.d + 0.05, 0.16, frameTone, 3);
      }
    }
  }

  // Roofs: a fascia board under the roof edge, a shadow line under that, rafter ends under gable eaves.
  const roofs = parts
    .filter((p) => p.tone === 'roof' && p.y >= 1.5 && p.shape !== 'sphere' && p.shape !== 'ring' && p.shape !== 'arch' && Math.min(p.w * W, p.d * D) >= 1.5)
    .sort((a, b) => b.w * b.d - a.w * a.d)
    .slice(0, 4);
  for (const r of roofs) {
    if (grown) break;
    const s = solid(r, W, D);
    const round = r.shape === 'cone' || r.shape === 'dome' || r.shape === 'cylinder';
    const shape: PartShape = round ? 'cylinder' : 'box';
    add(shape, s, 0, 0, s.y - 0.16, s.w + 0.06, s.d + 0.06, 0.16, 'trim', 1);
    add(shape, s, 0, 0, s.y - 0.21, s.w + 0.02, s.d + 0.02, 0.05, 'dark', 4);
    if (r.shape === 'gable') {
      const n = Math.min(7, Math.max(2, Math.floor(s.w / 0.9)));
      for (let i = 0; i < n; i++) {
        const lx = ((i + 0.5) / n - 0.5) * (s.w - 0.3);
        for (const sz of [-1, 1]) add('box', s, lx, sz * (s.d / 2 - 0.09), s.y - 0.28, 0.09, 0.28, 0.12, 'dark', 6, true);
      }
    }
  }

  // Windows: every thin glass slab gets a casing behind it, a sill, a lintel and glazing bars in front.
  for (const p of parts) {
    if (p.tone !== 'glass' || p.shape !== 'box') continue;
    const s = solid(p, W, D);
    const alongX = s.w >= s.d;
    const along = alongX ? s.w : s.d;
    const thick = alongX ? s.d : s.w;
    if (thick > 0.45 || along < 0.35 || s.h < 0.4) continue;
    /** A box sized along the pane, up it and through it, offset along the pane by `la`. */
    const pane = (la: number, y: number, a: number, h: number, t: number, tone: PartTone, rank: number, loose = false): void => {
      if (alongX) add('box', s, la, 0, y, a, t, h, tone, rank, loose);
      else add('box', s, 0, la, y, t, a, h, tone, rank, loose);
    };
    const big = s.h > 3.5 || along > 4;
    if (!big) {
      pane(0, Math.max(0, s.y - 0.07), along + 0.14, s.h + 0.14 - Math.max(0, 0.07 - s.y), thick > 0.06 ? thick - 0.03 : thick * 0.5, 'trim', 2);
      if (s.y >= 0.3) pane(0, s.y - 0.13, along + 0.26, 0.07, thick + 0.08, 'trim', 3, true);
      pane(0, s.y + s.h + 0.05, along + 0.2, 0.1, thick + 0.04, 'trim', 5, true);
    }
    const bars = big ? Math.min(4, Math.max(1, Math.round(along / 1.2) - 1)) : along > 1.8 ? 2 : 1;
    for (let i = 1; i <= bars; i++) pane((i / (bars + 1) - 0.5) * along, s.y, 0.045, s.h, thick + 0.03, 'trim', 4);
    const rails = big ? Math.min(2, Math.max(1, Math.round(s.h / 1.5) - 1)) : s.h > 0.9 ? 1 : 0;
    for (let i = 1; i <= rails; i++) pane(0, s.y + (rails === 1 ? 0.56 : i / (rails + 1)) * s.h, along, 0.045, thick + 0.03, 'trim', 4);
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
      let dw = 1.05;
      let dh = 2.1;
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
      add('box', front, 0, 0.02, dh, dw + 0.36, 0.12, 0.14, 'trim', 2, true);
      const out = Math.min(0.42, limit.z1 + REACH - 0.005 - face);
      if (out >= 0.06) add('box', front, 0, out / 2 - 0.03, 0, dw + 0.5, out + 0.06, 0.14, family === 'masonry' ? 'trim' : 'dark', 3);
    }
  }

  // Balconies and awnings: thin slabs that sail past the front of the body get corbels beneath.
  if (body) {
    const bb = boundsOf(solid(body, W, D));
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
        add('box', wall, lx, depth / 2 - 0.02, p.y - 0.28, 0.1, depth, 0.28, 'dark', 5, true);
      }
      done++;
    }
  }

  // Old buildings settle: loose trim hangs a little out of true.
  if (wear > 0.5) {
    const amount = (wear - 0.5) * 2;
    for (const e of extras) {
      if (!e.loose || !ctx.rng.chance(0.4)) continue;
      e.part.rot += ctx.rng.range(-1.5, 1.5) * amount;
      e.part.y = Math.max(0, e.part.y - ctx.rng.range(0, 0.02) * amount);
    }
  }

  // Keep the most structural additions; among equals, the larger ones.
  const volume = (p: BlueprintPart): number => p.w * W * p.d * D * p.h;
  extras.sort((a, b) => a.rank - b.rank || volume(b.part) - volume(a.part));
  const room = MAX_DRESSED_PARTS - parts.length;
  return parts.concat(extras.slice(0, room).map((e) => e.part));
}
