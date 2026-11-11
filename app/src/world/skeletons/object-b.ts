// Made things that carry, work, bar the way and sell: vehicles, machines, fences and stalls.
// Props sit on a 1 x 1 footprint; heights are in footprint units. Long things run along x, and nothing
// reaches the front edge of the footprint.
import type { Rng } from '../rng';
import { arch, box, C, clamp, cone, cyl, dome, gable, int, lerp, N, num, pyr, skel, sph, str, wedge } from './util';
import { blade, fin, outward, Parts } from './nature-util';

/** Body width of a vehicle across its line of travel, and where its wheels stand. */
const BW = 0.4;
const WHEEL_Z = 0.23;

/** Wheels along both sides, `n` a side over `span`; with none, the body sits on blocks. */
function gear(out: Parts, n: number, wd: number, span: number, thick = 0.05): void {
  if (n <= 0) {
    out.add(box(0, 0, 0, 0.1, BW * 0.9, wd * 0.5, 'dark', { repeat: 2, gap: span }));
    return;
  }
  for (const z of [-WHEEL_Z, WHEEL_Z]) out.add(sph(0, z, 0, wd, thick, wd, 'dark', n > 1 ? { repeat: n, gap: span / (n - 1) } : {}));
}

function cargo(out: Parts, x: number, y: number, len: number, load: number, H: number, rng: Rng): void {
  if (load <= 0.1) return;
  const h = Math.max(0.06, H * 0.6 * load);
  out.add(sph(x, 0, y, len * lerp(0.5, 0.9, load), BW * 0.8, h, 'accent', { rot: rng.range(-8, 8) }));
  if (load > 0.6) out.extra(box(x + len * 0.2, 0, y, len * 0.3, BW * 0.5, h * 1.15, 'wall2', { rot: rng.range(-12, 12) }));
}

export const vehicle = skel(
  'vehicle', 'object', 'Wheeled or hulled carrier seen side-on, with a body, running gear, a cab or canopy and a load.',
  ['ox cart', 'covered wagon', 'car', 'pickup truck', 'rover', 'rowing boat', 'mine cart'],
  [
    C('form', ['cart', 'wagon', 'car', 'truck', 'rover', 'boat'], 'cart', 'kind of carrier'),
    N('length', 0.5, 1, 0.9, 'length'),
    N('height', 0.3, 1.2, 0.5, 'body height, units'),
    N('wheels', 0, 4, 2, 'per side; 0 on blocks, oars on a boat'),
    N('cab', 0, 1, 0.5, 'cab, canopy or sail size'),
    N('load', 0, 1, 0.4, 'cargo'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const L = num(d, 'length');
    const H = num(d, 'height');
    const wheels = int(d, 'wheels');
    const cab = num(d, 'cab');
    const load = num(d, 'load');
    const out = new Parts();

    if (form === 'cart') {
      // An open bed between tall wheels, with shafts out in front.
      const wd = clamp(H * 0.9, 0.22, 0.5);
      const by = wd * 0.5;
      const bh = Math.max(0.05, H * 0.12);
      gear(out, Math.min(wheels, 2), wd, L * 0.5);
      out.add(box(0, 0, by, L * 0.8, BW, bh, 'wall'));
      out.add(box(0, -BW / 2 + 0.02, by + bh, L * 0.8, 0.03, H * 0.4, 'wall2'), box(0, BW / 2 - 0.02, by + bh, L * 0.8, 0.03, H * 0.4, 'wall2'));
      out.add(box(-L * 0.39, 0, by + bh, 0.03, BW, H * 0.4, 'wall2'));
      const sx = Math.min(0.4, L * 0.4 + 0.08);
      out.add(box(sx, -0.12, by, 0.2, 0.03, 0.05, 'wall2'), box(sx, 0.12, by, 0.2, 0.03, 0.05, 'wall2'));
      cargo(out, -L * 0.05, by + bh, L * 0.7, load, H, rng);
      return out.list;
    }

    if (form === 'wagon') {
      // A deep bed under a tilt stretched over hoops, the driver's seat ahead of it.
      const wd = clamp(H * 0.6, 0.18, 0.36);
      const by = wd * 0.55;
      const bh = H * 0.3;
      gear(out, clamp(wheels, 0, 3), wd, L * 0.62);
      out.add(box(0, 0, by, L * 0.85, BW, bh, 'wall'));
      out.add(box(L * 0.36, 0, by + bh, 0.08, BW * 0.9, Math.max(0.05, H * 0.22), 'wall2'));
      out.add(box(Math.min(0.42, L * 0.42 + 0.06), 0, by, 0.16, 0.04, 0.05, 'wall2'));
      if (cab > 0.2) {
        const cl = L * lerp(0.4, 0.66, cab);
        const ch = H * lerp(0.5, 1, cab);
        const cx = -L * 0.42 + cl / 2;
        out.add(arch(cx, 0, by + bh, BW * 1.02, cl, ch, 'trim', { rot: 90 }));
        for (const e of [-1, 1]) out.extra(arch(cx + e * (cl / 2 - 0.02), 0, by + bh, BW * 1.08, 0.03, ch + 0.02, 'wall2', { rot: 90 }));
      } else {
        out.add(box(0, -BW / 2 + 0.02, by + bh, L * 0.6, 0.03, H * 0.3, 'wall2'), box(0, BW / 2 - 0.02, by + bh, L * 0.6, 0.03, H * 0.3, 'wall2'));
        cargo(out, -L * 0.1, by + bh, L * 0.6, load, H, rng);
      }
      if (load > 0.5) out.extra(cyl(-L * 0.43, BW / 2 + 0.04, by, 0.1, 0.1, Math.max(0.1, H * 0.35), 'accent'));
      return out.list;
    }

    if (form === 'car') {
      // A low body with a glazed cabin set back on it, bumpers and lamps at the ends.
      const wd = clamp(H * 0.5, 0.16, 0.3);
      const by = wd * 0.4;
      const bh = H * 0.45;
      const cl = L * lerp(0.3, 0.6, cab);
      const ch = Math.max(0.08, H * 0.4);
      gear(out, clamp(wheels, 0, 3), wd, L * 0.6);
      out.add(box(0, 0, by, L, BW, bh, 'accent'));
      out.add(box(-L * 0.06, 0, by + bh, cl, BW * 0.9, ch, 'glass'));
      out.add(box(-L * 0.06, 0, by + bh + ch, cl * 1.03, BW * 0.93, 0.05, 'accent'));
      out.add(box(0, 0, by, 0.04, BW * 1.03, 0.08, 'dark', { repeat: 2, gap: L - 0.02 }));
      out.add(box(Math.min(0.49, L / 2), 0, by + bh * 0.5, 0.08, 0.03, 0.06, 'glow', { rot: 90, repeat: 2, gap: BW * 0.66 }));
      if (load > 0.5) out.extra(box(-L * 0.06, 0, by + bh + ch + 0.05, cl * 0.8, BW * 0.7, Math.max(0.05, H * 0.2 * load), 'wall2'));
      return out.list;
    }

    if (form === 'truck') {
      // A cab at the front of a flat chassis, and behind it a bed with whatever it carries.
      const wd = clamp(H * 0.5, 0.18, 0.3);
      const by = wd * 0.5;
      const cl = L * 0.3;
      const ch = H * lerp(0.6, 1, cab);
      const cx = L * 0.5 - cl / 2;
      const bedH = Math.max(0.06, H * 0.25);
      gear(out, clamp(wheels, 0, 3), wd, L * 0.66);
      out.add(box(0, 0, by, L, BW * 0.8, 0.08, 'dark'));
      out.add(box(cx, 0, by + 0.06, cl, BW, ch, 'accent'));
      out.add(box(Math.min(0.49, L * 0.5), 0, by + 0.06 + ch * 0.5, 0.03, BW * 0.85, ch * 0.38, 'glass'));
      out.add(box(-L * 0.16, 0, by + 0.06, L * 0.66, BW, bedH, 'wall'));
      out.add(cyl(cx - cl / 2 - 0.03, BW * 0.4, by + 0.06, 0.05, 0.05, ch * 1.15, 'dark'));
      if (load > 0.15) {
        out.add(box(-L * 0.16, 0, by + 0.06 + bedH, L * 0.6, BW * 0.9, Math.max(0.06, H * 0.9 * load), 'wall2'));
        if (load > 0.6) out.extra(sph(-L * 0.16, 0, by + 0.06 + bedH + H * 0.9 * load - 0.04, L * 0.5, BW * 0.8, Math.max(0.08, H * 0.2), 'trim'));
      }
      return out.list;
    }

    if (form === 'rover') {
      // Fat wheels under a slab of panel, with a mast, a dish and a box of instruments.
      const wd = clamp(H * 0.55, 0.18, 0.32);
      const by = wd * 0.7;
      const bh = Math.max(0.06, H * 0.25);
      const top = by + bh;
      const mh = H * lerp(0.4, 1.4, cab);
      gear(out, clamp(wheels, 0, 3), wd, L * 0.66, 0.1);
      out.add(box(0, 0, by, L * 0.8, BW * 0.8, bh, 'wall'));
      out.add(box(-L * 0.1, 0, top, L * 0.6, BW * 1.1, 0.05, 'glass'));
      out.add(cyl(L * 0.3, 0, top, 0.04, 0.04, mh, 'dark'));
      out.add(box(L * 0.3, 0, top + mh - 0.02, 0.12, 0.2, 0.08, 'trim'));
      out.add(dome(-L * 0.28, 0, top + 0.04, 0.2, 0.2, 0.1, 'trim'));
      out.extra(sph(L * 0.3 + 0.06, 0, top + mh, 0.04, 0.04, 0.05, 'glow'));
      if (load > 0.2) out.extra(box(-L * 0.4, 0, by, 0.1, 0.2, bh + H * 0.3 * load, 'accent'));
      return out.list;
    }

    // Boat: a hull that rises to bow and stern inside the line of its gunwale, with thwarts, oars and a sail.
    const hh = H * 0.5;
    out.add(box(0, 0, 0, L * 0.5, BW, hh, 'wall'));
    out.add(fin({ x: L * 0.25, z: 0 }, 0, 0, L * 0.25, BW * 0.8, hh * 1.1, 'wall'));
    out.add(fin({ x: -L * 0.25, z: 0 }, Math.PI, 0, L * 0.2, BW * 0.9, hh, 'wall'));
    out.add(sph(0, 0, Math.max(0, hh - 0.04), L * 0.98, BW * 1.08, 0.08, 'wall2'));
    out.add(cyl(0, 0, hh - 0.02, L * 0.8, BW * 0.8, 0.05, 'dark'));
    out.add(box(0, 0, hh + 0.01, 0.06, BW, 0.05, 'wall2', { repeat: 2, gap: L * 0.3 }));
    const oars = Math.min(wheels, 2);
    if (oars > 0) out.add(box(0, 0, hh + 0.02, 0.04, 0.9, 0.05, 'wall2', oars > 1 ? { repeat: 2, gap: L * 0.2 } : {}));
    if (cab > 0.4) {
      const mh = H * lerp(1, 2.4, cab);
      out.add(cyl(0.05, 0, hh - 0.02, 0.04, 0.04, mh, 'wall2'));
      out.add(fin({ x: 0.03, z: 0 }, Math.PI, hh + mh * 0.15, L * 0.4, 0.03, mh * 0.8, 'trim'));
    }
    if (load > 0.3) out.extra(box(L * 0.14, 0, hh + 0.02, 0.14, 0.2, Math.max(0.06, H * 0.25 * load), 'accent', { rot: rng.range(-15, 15) }));
    return out.list;
  },
);

/** Corner posts and a top rail round a machine of the given width and depth. */
function railed(out: Parts, W: number, D: number, h: number, guard: number): void {
  if (guard <= 0.5) return;
  const x = Math.min(0.48, W / 2 + 0.03);
  for (const z of [-D / 2, D / 2]) {
    out.extra(box(0, z, 0, 0.03, 0.03, h, 'trim', { repeat: 2, gap: x * 2 }));
    out.extra(box(0, z, h, x * 2, 0.03, 0.05, 'trim'));
  }
}

export const machine = skel(
  'machine', 'object', 'Working plant on a skid: an engine block with stacks, a desk of screens, a nodding pump, a lying drum or a dish on a mount.',
  ['generator', 'control console', 'oil pump', 'jet engine', 'radar dish', 'air conditioner', 'reactor'],
  [
    C('form', ['block', 'console', 'pump', 'drum', 'dish'], 'block', 'kind of machine'),
    N('width', 0.4, 1, 0.8, 'width'),
    N('height', 0.4, 2.5, 1, 'footprint units'),
    N('pipes', 0, 4, 2, 'stacks, pipes, levers or aerials'),
    N('lights', 0, 1, 0.5, 'lamps and screens'),
    N('guard', 0, 1, 0.3, 'rails, cage or skid'),
  ],
  (d) => {
    const form = str(d, 'form');
    const W = num(d, 'width');
    const H = num(d, 'height');
    const pipes = int(d, 'pipes');
    const lights = num(d, 'lights');
    const guard = num(d, 'guard');
    const out = new Parts();
    const row = (n: number, span: number) => (n > 1 ? { repeat: n, gap: span / (n - 1) } : {});

    if (form === 'block') {
      // A housing with a curved hood, a grille on its face and exhaust stacks behind the hood.
      const bh = H * 0.6;
      const top = 0.06 + bh;
      out.add(box(0, 0, 0, W, 0.5, 0.06, 'dark'));
      out.add(box(0, 0, 0.06, W * 0.9, 0.44, bh, 'wall2'));
      out.add(arch(0, 0.04, top, 0.3, W * 0.6, Math.max(0.08, H * 0.18), 'wall', { rot: 90 }));
      out.add(box(0, 0.225, 0.06 + bh * 0.25, W * 0.5, 0.03, bh * 0.5, 'dark'));
      if (pipes > 0) {
        out.add(cyl(0, -0.15, top, 0.07, 0.07, H * 0.4, 'dark', row(pipes, W * 0.6)));
        out.extra(cone(0, -0.15, top + H * 0.4, 0.1, 0.1, 0.06, 'dark', row(pipes, W * 0.6)));
      }
      out.add(box(W * 0.32, 0.225, 0.06 + bh * 0.45, 0.14, 0.04, Math.max(0.08, bh * 0.3), 'accent'));
      if (lights > 0.2) out.add(box(W * 0.32, 0.25, 0.06 + bh * 0.62, 0.06, 0.02, 0.05, 'glow'));
      if (guard > 0.2) out.extra(cyl(-W * 0.3, 0.14, top, 0.16, 0.16, Math.max(0.06, H * 0.14), 'accent'));
      railed(out, W, 0.5, H * 0.5, guard);
      return out.list;
    }

    if (form === 'console') {
      // A desk with a sloped face, a bank of screens standing along its back edge.
      const dh = H * 0.4;
      const sh = H * lerp(0.2, 0.5, lights);
      out.add(box(0, 0, 0, W, 0.3, dh, 'wall2'));
      out.add(wedge(0, 0, dh, 0.3, W, Math.max(0.06, H * 0.15), 'wall', { rot: 90 }));
      out.add(box(0, -0.14, dh, W * 0.92, 0.03, H * 0.1 + sh + 0.04, 'dark'));
      if (lights > 0.1) out.add(box(0, -0.12, dh + H * 0.1, W * 0.84, 0.02, sh, 'glow'));
      out.add(sph(0, 0.08, dh + 0.01, 0.04, 0.04, 0.05, 'accent', { repeat: 4, gap: W * 0.2 }));
      if (pipes > 0) out.add(cyl(0, 0.02, dh, 0.025, 0.025, Math.max(0.08, H * 0.16), 'dark', row(pipes, W * 0.5)));
      if (pipes > 2) out.extra(cyl(W * 0.42, -0.14, dh, 0.02, 0.02, H * 0.9, 'dark'));
      if (guard > 0.2) out.extra(cyl(0, 0.34, 0, 0.14, 0.14, Math.max(0.1, H * 0.25), 'accent'));
      return out.list;
    }

    if (form === 'pump') {
      // A beam rocks on an A-post: the horse's head and rod over the well at one end, the crank at the other.
      const by = H * 0.75;
      const hx = W * 0.4;
      out.add(box(0, 0, 0, W, 0.4, 0.06, 'dark'));
      out.add(blade({ x: -0.08, z: 0 }, 0, 0.06, 0.08, 0.1, by, 'wall2'), blade({ x: 0.08, z: 0 }, Math.PI, 0.06, 0.08, 0.1, by, 'wall2'));
      out.add(box(0, 0, by, W * 0.85, 0.07, 0.07, 'accent'));
      out.add(box(hx, 0, by - 0.1, 0.08, 0.1, 0.22, 'accent'));
      out.add(box(hx, 0, 0.06, 0.03, 0.03, Math.max(0.05, by - 0.16), 'dark'));
      out.add(cyl(hx, 0, 0.06, 0.12, 0.12, Math.max(0.06, H * 0.2), 'wall'));
      const cw = clamp(H * 0.4, 0.14, 0.4);
      out.add(sph(-W * 0.3, 0, 0.06, cw, 0.08, cw, 'dark'));
      out.add(box(-W * 0.38, 0, 0.06, 0.03, 0.03, Math.max(0.05, by - 0.06), 'dark'));
      if (pipes > 0) out.extra(cyl(hx, 0.1, 0.06, 0.05, 0.05, Math.max(0.06, H * 0.12), 'accent', { rot: 90, ...row(pipes, 0.07 * pipes) }));
      if (lights > 0.3) out.extra(sph(0, 0, by + 0.07, 0.06, 0.06, 0.06, 'glow'));
      railed(out, W, 0.4, H * 0.3, guard);
      return out.list;
    }

    if (form === 'drum') {
      // A round body lying in cradles, capped at both ends, with stacks out of its back.
      const dw = clamp(H * 0.6, 0.2, 0.5);
      const dy = H * 0.2;
      const dh = Math.max(0.12, H * 0.6);
      out.add(box(0, 0, 0, 0.08, 0.4, H * 0.25, 'dark', { repeat: 2, gap: W * 0.6 }));
      out.add(arch(0, 0, dy, dw, W * 0.92, dh, 'wall2', { rot: 90 }));
      out.add(sph(Math.min(0.48, W / 2 - 0.01), 0, dy + dh * 0.08, 0.08, dw * 0.85, dh * 0.85, 'accent'));
      out.add(sph(-Math.min(0.48, W / 2 - 0.01), 0, dy + dh * 0.08, 0.08, dw * 0.85, dh * 0.85, 'dark'));
      if (pipes > 0) out.add(cyl(0, 0, dy + dh - 0.03, 0.06, 0.06, H * 0.3, 'dark', row(pipes, W * 0.5)));
      if (lights > 0.2) out.extra(box(0, dw / 2 + 0.005, dy + dh * 0.3, 0.1, 0.02, 0.06, 'glow'));
      if (guard > 0.2) out.extra(box(0, 0, 0, W, 0.44, 0.05, 'dark'));
      railed(out, W, 0.46, H * 0.4, guard);
      return out.list;
    }

    // Dish: a round face turned to the sky's edge on a yoke and pedestal, its feed held out in front.
    const D = clamp(W * 0.9, 0.3, 0.9);
    const py = H * 0.5;
    const dy = H * 0.56;
    const turn = 25;
    const nx = Math.sin((turn * Math.PI) / 180);
    const nz = Math.cos((turn * Math.PI) / 180);
    out.add(box(0, 0, 0, 0.4, 0.4, 0.08, 'dark'));
    out.add(cyl(0, 0, 0.08, 0.12, 0.12, py, 'wall2'));
    out.add(box(0, 0, py, 0.2, 0.14, 0.1, 'wall'));
    out.add(sph(nx * 0.03, nz * 0.03, dy, D, 0.07, D, 'trim', { rot: turn }));
    out.add(box(nx * 0.14, nz * 0.14, dy + D * 0.5 - 0.02, 0.03, 0.24, 0.05, 'dark', { rot: turn }));
    if (lights > 0.3) out.add(sph(nx * 0.26, nz * 0.26, dy + D * 0.5 - 0.02, 0.06, 0.06, 0.06, 'glow'));
    if (pipes > 0) out.add(cyl(-0.12, -0.14, 0.08, 0.02, 0.02, H * 0.9, 'dark', row(pipes, 0.04 * pipes)));
    railed(out, 0.5, 0.5, H * 0.3, guard);
    return out.list;
  },
);

export const fence = skel(
  'fence', 'object', 'Run of barrier across the footprint, as rails, pickets, wire, panels, bars or a low heaped wall.',
  ['picket fence', 'corral rail', 'barbed wire', 'hoarding', 'iron railing', 'sandbag wall', 'crowd barrier'],
  [
    C('form', ['rail', 'picket', 'wire', 'panel', 'bars', 'heaped'], 'rail', 'kind of barrier'),
    N('height', 0.3, 2, 0.8, 'footprint units'),
    N('posts', 2, 6, 4, 'posts'),
    N('wander', 0, 1, 0, '0 straight, 1 zigzag'),
    N('gaps', 0, 1, 0, 'missing or fallen sections'),
    N('top', 0, 1, 0.3, 'points, finials, coping or coils'),
  ],
  (d, rng) => {
    const form = str(d, 'form');
    const H = num(d, 'height');
    const n = int(d, 'posts');
    const wander = num(d, 'wander');
    const gaps = num(d, 'gaps');
    const top = num(d, 'top');
    const out = new Parts();
    const at = (i: number) => ({ x: lerp(-0.46, 0.46, i / (n - 1)), z: wander * 0.14 * (i % 2 === 0 ? -1 : 1) });
    const keep = rng.int(0, n - 2);
    const heaped = form === 'heaped';
    const pw = form === 'wire' || form === 'bars' ? 0.04 : 0.07;
    if (!heaped) {
      for (let i = 0; i < n; i++) {
        const p = at(i);
        out.add(box(p.x, p.z, 0, pw, pw, H * 1.05, form === 'bars' ? 'dark' : 'wall2'));
      }
    }
    const garnish: (() => void)[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const a = at(i);
      const b = at(i + 1);
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const rot = outward(Math.atan2(b.z - a.z, b.x - a.x));
      if (i !== keep && gaps > 0 && rng.next() < gaps * 0.7) {
        // What is left of a missing section lies where it fell.
        if (rng.chance(0.6)) garnish.push(() => out.extra(box(mx, mz + 0.1, 0, len * 0.85, 0.05, 0.05, heaped ? 'wall' : 'wall2', { rot: rot + rng.range(10, 25) })));
        continue;
      }
      if (form === 'rail') {
        const rh = Math.max(0.05, H * 0.08);
        out.add(box(mx, mz, H * 0.4, len, 0.04, rh, 'wall', { rot }), box(mx, mz, H * 0.8, len, 0.04, rh, 'wall', { rot }));
        if (top > 0.6) garnish.push(() => out.extra(box(mx, mz, H * 0.12, len, 0.04, rh, 'wall', { rot })));
      } else if (form === 'picket') {
        const o = { rot, repeat: 3, gap: len / 3.5 };
        out.add(box(mx, mz, H * 0.55, len, 0.03, 0.06, 'wall2', { rot }));
        out.add(box(mx, mz, 0, 0.05, 0.03, H * 0.92, 'wall', o));
        if (top > 0.2) garnish.push(() => out.extra(pyr(mx, mz, H * 0.92, 0.05, 0.03, 0.05 + top * 0.1, 'wall', o)));
      } else if (form === 'wire') {
        out.add(box(mx, mz, H * 0.45, len, 0.02, 0.05, 'dark', { rot }), box(mx, mz, H * 0.85, len, 0.02, 0.05, 'dark', { rot }));
        if (top > 0.3) garnish.push(() => out.extra(cone(mx, mz, H * 0.88, 0.03, 0.03, 0.07, 'dark', { rot, repeat: 3, gap: len / 3.5 })));
      } else if (form === 'panel') {
        out.add(box(mx, mz, 0, len, 0.04, H * 0.92, 'wall', { rot }));
        if (top > 0.3) out.add(box(mx, mz, H * 0.92, len, 0.07, 0.05, 'trim', { rot }));
        if (top > 0.7) garnish.push(() => out.extra(box(mx, mz, H * 0.5, len * 0.9, 0.05, Math.max(0.05, H * 0.12), 'accent', { rot })));
      } else if (form === 'bars') {
        const o = { rot, repeat: 4, gap: len / 5 };
        out.add(box(mx, mz, H * 0.12, len, 0.03, 0.05, 'dark', { rot }), box(mx, mz, H * 0.85, len, 0.03, 0.05, 'dark', { rot }));
        out.add(cyl(mx, mz, H * 0.12, 0.025, 0.025, H * 0.82, 'dark', o));
        if (top > 0.2) garnish.push(() => out.extra(cone(mx, mz, H * 0.92, 0.04, 0.04, 0.06 + top * 0.1, 'accent', o)));
      } else {
        // Two courses of lumps, the upper sitting over the joints of the lower.
        out.add(sph(mx, mz, 0, (len / 3) * 1.18, 0.2, Math.max(0.08, H * 0.55), 'wall', { rot, repeat: 3, gap: len / 3 }));
        out.add(sph(mx, mz, H * 0.42, (len / 3) * 1.18, 0.18, Math.max(0.08, H * 0.5), 'wall2', { rot, repeat: 2, gap: len / 3 }));
        if (top > 0.5) garnish.push(() => out.extra(sph(mx, mz, H * 0.8, len / 3, 0.16, Math.max(0.06, H * 0.3), 'wall', { rot })));
      }
    }
    if (!heaped && top > 0.5) {
      for (let i = 0; i < n; i++) {
        const p = at(i);
        garnish.push(() => out.extra(sph(p.x, p.z, H * 1.03, pw * 1.4, pw * 1.4, pw * 1.4, 'accent')));
      }
    }
    // Something always lies at the foot of a barrier: a spilled bag, a loose stone, an offcut.
    out.add(sph(-0.3, 0.2, 0, 0.12, 0.09, 0.06, 'wall2', { rot: rng.range(0, 180) }), sph(0.24, -0.2, 0, 0.1, 0.08, 0.05, 'wall2', { rot: rng.range(0, 180) }));
    garnish.forEach((add) => add());
    return out.list;
  },
);

export const stall = skel(
  'stall', 'object', 'Small selling place: a counter under an awning, a closed booth, a barrow with a canopy or a table under an umbrella.',
  ['market stall', 'ticket booth', 'food cart', 'newsstand', 'fruit stand', 'noodle stand', 'cafe table'],
  [
    C('form', ['awning', 'booth', 'barrow', 'umbrella'], 'awning', 'kind of stand'),
    N('width', 0.5, 1, 0.9, 'width'),
    N('height', 1, 2.6, 1.6, 'footprint units'),
    N('awning', 0, 1, 0.6, 'canopy reach and pitch'),
    N('goods', 0, 1, 0.6, 'wares on show'),
    N('sign', 0, 1, 0.3, 'signboard size'),
  ],
  (d) => {
    const form = str(d, 'form');
    const W = num(d, 'width');
    const H = num(d, 'height');
    const awn = num(d, 'awning');
    const goods = num(d, 'goods');
    const sign = num(d, 'sign');
    const out = new Parts();
    const wares = 2 + Math.round(goods * 4);

    if (form === 'awning') {
      // A counter between four posts, the cloth pitched from the tall back pair down to the short front pair.
      const ch = H * 0.4;
      const ey = H * 0.85;
      const ah = H * lerp(0.06, 0.3, awn);
      out.add(box(0, 0.05, 0, W, 0.26, ch, 'wall'), box(0, 0.05, ch, Math.min(1, W * 1.04), 0.3, 0.05, 'wall2'));
      out.add(box(0, -0.3, 0, 0.05, 0.05, H, 'wall2', { repeat: 2, gap: W * 0.94 }), box(0, 0.26, 0, 0.05, 0.05, ey, 'wall2', { repeat: 2, gap: W * 0.94 }));
      out.add(wedge(0, -0.02, ey, 0.62, Math.min(1.04, W * 1.06), ah, 'accent', { rot: 90 }));
      out.add(box(0, 0.29, ey - 0.08, Math.min(1.04, W * 1.06), 0.02, 0.1, 'trim'));
      if (goods > 0.1) {
        out.add(sph(0, 0.05, ch + 0.05, 0.1, 0.1, 0.09, 'trim', { repeat: wares, gap: (W * 0.84) / wares }));
        if (goods > 0.5) out.extra(sph(0, -0.03, ch + 0.05, 0.08, 0.08, 0.12, 'accent', { repeat: wares - 1, gap: (W * 0.84) / wares }));
        if (goods > 0.8) {
          out.extra(box(0, 0.2, ey - 0.22, 0.03, 0.03, 0.22, 'dark', { repeat: 2, gap: W * 0.5 }));
          out.extra(sph(0, 0.2, ey - 0.32, 0.1, 0.1, 0.12, 'glow', { repeat: 2, gap: W * 0.5 }));
        }
      }
      if (sign > 0.15) out.add(box(0, -0.3, Math.min(H, ey + ah), W * lerp(0.4, 0.9, sign), 0.04, H * lerp(0.1, 0.25, sign), 'trim'));
      return out.list;
    }

    if (form === 'booth') {
      // A closed box with a window and a ledge on its face, under a roof that overhangs it.
      const bh = H * 0.8;
      out.add(box(0, -0.04, 0, W * 0.7, 0.5, bh, 'wall'));
      out.add(box(0, 0.215, H * 0.42, W * 0.5, 0.03, H * 0.25, 'glass'));
      out.add(box(0, 0.24, H * 0.38, W * 0.56, 0.1, 0.05, 'wall2'));
      out.add(box(-W * 0.351, -0.04, 0, 0.02, 0.2, H * 0.55, 'dark'));
      if (awn > 0.5) out.add(pyr(0, -0.04, bh, W * 0.85, 0.66, H * lerp(0.1, 0.3, awn), 'roof'));
      else out.add(box(0, 0, bh, W * 0.9, 0.68, 0.07, 'roof'));
      if (sign > 0.15) out.add(box(0, 0.22, H * 0.68, W * lerp(0.3, 0.66, sign), 0.03, Math.max(0.06, H * 0.1 * (0.5 + sign)), 'trim'));
      if (goods > 0.3) {
        out.extra(box(0, 0.33, 0, W * 0.5, 0.08, H * 0.25, 'wall2'));
        out.extra(sph(0, 0.33, H * 0.25, 0.08, 0.08, 0.08, 'accent', { repeat: Math.min(wares, 4), gap: (W * 0.42) / 4 }));
      }
      return out.list;
    }

    if (form === 'barrow') {
      // A bed on one pair of wheels and a prop leg, with a canopy on two poles.
      const by = 0.18;
      const bh = H * 0.15;
      const top = by + bh;
      out.add(sph(-W * 0.2, -0.2, 0, 0.3, 0.05, 0.3, 'dark'), sph(-W * 0.2, 0.2, 0, 0.3, 0.05, 0.3, 'dark'));
      out.add(box(W * 0.3, 0, 0, 0.05, 0.3, by + 0.03, 'wall2'));
      out.add(box(0, 0, by, W * 0.8, 0.36, bh, 'wall'));
      out.add(box(Math.min(0.42, W * 0.4 + 0.06), 0, by, 0.16, 0.3, 0.05, 'wall2'));
      out.add(box(0, 0, top, 0.04, 0.04, H * 0.88 - top, 'wall2', { repeat: 2, gap: W * 0.7 }));
      if (awn > 0.5) out.add(arch(0, 0, H * 0.88, 0.5, W * 0.9, Math.max(0.1, H * 0.14), 'accent', { rot: 90 }));
      else out.add(gable(0, 0, H * 0.88, W * 0.9, 0.5, Math.max(0.06, H * lerp(0.05, 0.14, awn * 2)), 'accent'));
      if (goods > 0.1) out.add(sph(0, 0, top, 0.1, 0.1, 0.1, 'trim', { repeat: Math.min(wares, 5), gap: (W * 0.7) / 5 }));
      if (sign > 0.15) out.extra(box(0, 0.24, H * 0.88 - H * 0.12 * (0.5 + sign), W * lerp(0.3, 0.7, sign), 0.02, H * 0.12 * (0.5 + sign), 'trim'));
      return out.list;
    }

    // Umbrella: a round table on one leg, the pole through it, stools either side.
    const th = H * 0.3;
    const tw = Math.min(0.5, W * 0.5);
    out.add(cyl(0, 0, 0, 0.04, 0.04, H, 'dark'), cone(0, 0, 0, 0.2, 0.2, 0.08, 'dark'));
    out.add(cyl(0, 0, th, tw, tw, 0.05, 'wall'));
    out.add(cone(0, 0, H * 0.8, W, Math.min(W, 0.96), H * lerp(0.1, 0.3, awn), 'accent'));
    out.add(cyl(0, 0, 0, 0.14, 0.14, Math.max(0.1, H * 0.18), 'wall2', { repeat: 2, gap: W * 0.8 }));
    if (goods > 0.1) out.add(sph(0, 0.06, th + 0.05, 0.07, 0.07, 0.08, 'trim', { repeat: Math.min(wares, 3), gap: tw * 0.3 }));
    if (sign > 0.15) out.extra(gable(W * 0.34, 0.3, 0, 0.16, 0.14, H * lerp(0.15, 0.32, sign), 'trim'));
    return out.list;
  },
);
