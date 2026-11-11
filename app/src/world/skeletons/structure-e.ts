// Structure skeletons, part five: walled courts, seating bowls, storage vessels, landing stages and stepped ground.
// Masses that are not houses stand on a low footing (SILL), so the dressing pass gives them no door or plinth.
import type { BlueprintPart, PartTone } from '../spec';
import type { PartOpts } from './util';
import { arch, box, C, clamp, cone, cyl, dome, gable, int, lerp, N, NOMINAL, num, pyr, ring, SILL, skel, sph, str, turn, wedge } from './util';

/** Whether `n` more parts still fit in the budget of 28. Optional detail is added only while this holds. */
const fits = (out: BlueprintPart[], n = 1): boolean => out.length + n <= 28;

export const keep = skel(
  'keep', 'structure', 'Walled court with corner towers, a gate and a building inside.',
  ['castle', 'frontier fort', 'monastery', 'caravanserai', 'prison yard', 'walled villa', 'moon outpost', 'stockade'],
  [
    N('wall', 2, 9, 5, 'm'),
    N('width', 0.6, 1, 1, ';plan'),
    N('towers', 0, 4, 4, ';at the corners, front pair first'),
    C('towerForm', ['round', 'square'], 'round', 'tower plan'),
    N('towerRise', 0.5, 8, 3, 'm above the wall'),
    C('crown', ['crenels', 'cones', 'flat', 'hoard'], 'crenels', 'tower tops and wall crest'),
    C('gate', ['gap', 'arch', 'gatehouse'], 'arch', 'gateway'),
    N('inner', 0, 22, 11, 'm;a yard under 1.5, a hall under 8, a tower keep above'),
  ],
  (d) => {
    const Hw = num(d, 'wall');
    const W = num(d, 'width') * 0.96;
    const D = W * 0.92;
    const towers = int(d, 'towers');
    const round = str(d, 'towerForm') === 'round';
    const rise = num(d, 'towerRise');
    const crown = str(d, 'crown');
    const gate = str(d, 'gate');
    const inner = num(d, 'inner');
    const tw = 0.18;
    const t = 0.07;
    // The curtain runs between the tower centres.
    const ex = W / 2 - tw / 2;
    const ez = D / 2 - tw / 2;
    const gw = 0.2;
    const sw = ex - gw / 2;
    const body = Hw - SILL;
    const out: BlueprintPart[] = [
      box(0, 0, 0, W + 0.02, D + 0.02, SILL, 'wall2'),
      box(0, 0, SILL, t, 2 * ez, body, 'wall', { repeat: 2, gap: 2 * ex }),
      box(0, -ez, SILL, 2 * ex, t, body, 'wall'),
      box(0, ez, SILL, sw, t, body, 'wall', { repeat: 2, gap: gw + sw }),
    ];
    // The gateway stays a real opening; its head is never lower than a rider.
    const gh = clamp(Hw - 1, 2.4, 3.6);
    if (gate === 'gatehouse') {
      const top = Math.max(Hw, gh) + 2.2;
      out.push(box(0, ez, SILL, 0.1, 0.16, top - SILL, 'wall2', { repeat: 2, gap: gw + 0.1 }));
      out.push(box(0, ez, gh, gw + 0.02, 0.14, top - gh, 'wall'));
      out.push(gable(0, ez, top, gw + 0.34, 0.2, 1.3, 'roof'));
    } else {
      const top = gate === 'arch' ? Math.max(Hw, gh + 0.9) : Math.max(Hw, gh) + 0.7;
      out.push(box(0, ez, SILL, 0.05, t + 0.03, top - SILL, 'wall2', { repeat: 2, gap: gw + 0.05 }));
      if (gate === 'arch') out.push(box(0, ez, gh, gw + 0.1, t + 0.02, top - gh, 'wall'));
    }
    if (crown === 'crenels' || crown === 'hoard') {
      const k = clamp(Math.round(sw / 0.07), 1, 4);
      const kz = clamp(Math.round((2 * ez) / 0.1), 2, 8);
      for (const sx of [-1, 1]) {
        out.push(box(sx * (gw / 2 + sw / 2), ez, Hw, (sw / k) * 0.55, t, 0.55, 'wall', { repeat: k, gap: sw / k }));
        out.push(box(sx * ex, 0, Hw, ((2 * ez) / kz) * 0.55, t, 0.55, 'wall', { rot: 90, repeat: kz, gap: (2 * ez) / kz }));
      }
    } else {
      out.push(box(0, ez, Hw, sw, t + 0.03, 0.15, 'trim', { repeat: 2, gap: gw + sw }));
      out.push(box(0, 0, Hw, t + 0.03, 2 * ez, 0.15, 'trim', { repeat: 2, gap: 2 * ex }));
    }
    const Ht = Hw + rise;
    const mass = round ? cyl : box;
    const cap = round ? cone : pyr;
    const rows: { x: number; z: number; k: number }[] = [];
    if (towers >= 2) rows.push({ x: 0, z: ez, k: 2 });
    if (towers >= 4) rows.push({ x: 0, z: -ez, k: 2 });
    if (towers === 1 || towers === 3) rows.push({ x: -ex, z: -ez, k: 1 });
    for (const r of rows) {
      const o: PartOpts = { repeat: r.k, gap: 2 * ex };
      out.push(mass(r.x, r.z, SILL, tw, tw, Ht - SILL, 'wall2', o));
      if (crown === 'cones') {
        out.push(mass(r.x, r.z, Ht - 0.3, tw * 1.12, tw * 1.12, 0.3, 'trim', o));
        out.push(cap(r.x, r.z, Ht, tw * 1.3, tw * 1.3, 1.8 + rise * 0.35, 'roof', o));
      } else if (crown === 'hoard') {
        // A timber gallery jettied out round the tower head.
        out.push(mass(r.x, r.z, Ht - 1.3, tw * 1.35, tw * 1.35, 1.3, 'dark', o));
        out.push(cap(r.x, r.z, Ht, tw * 1.5, tw * 1.5, 1.4, 'roof', o));
      } else if (crown === 'flat') {
        out.push(mass(r.x, r.z, Ht, tw * 1.15, tw * 1.15, 0.35, 'trim', o));
      } else {
        out.push(mass(r.x, r.z, Ht, tw * 1.18, tw * 1.18, 0.4, 'trim', o));
        for (const x of r.k === 2 ? [-ex, ex] : [r.x]) out.push(box(x, r.z, Ht + 0.4, 0.045, tw * 1.18, 0.5, 'wall2', { repeat: 2, gap: tw * 0.8 }));
      }
    }
    const first = rows[0];
    if (crown === 'flat' && first) {
      const fx = first.k === 2 ? -ex : first.x;
      out.push(cyl(fx, first.z, Ht + 0.35, 0.02, 0.02, 2.6, 'dark'));
      out.push(box(fx + 0.04, first.z, Ht + 2.1, 0.07, 0.02, 0.7, 'accent'));
    }
    // What stands in the court, against the back wall: its height alone decides what it is.
    const cw = 2 * ex - t;
    const cd = 2 * ez - t;
    if (inner < 1.5) out.push(cyl(0, -cd * 0.1, SILL, 0.12, 0.12, 0.8, 'wall2'));
    else if (inner < 8) {
      const hw = Math.min(0.5, cw * 0.8);
      const hd = Math.min(0.3, cd * 0.55);
      const zc = -ez + t / 2 + hd / 2 + 0.005;
      const eave = inner * 0.68;
      out.push(box(0, zc, 0, hw, hd, eave, 'wall'));
      out.push(gable(0, zc, eave, hw + 0.04, hd + 0.04, inner - eave, 'roof'));
      if (eave >= 2) out.push(box(0, zc + hd / 2 + 0.005, eave * 0.4, 0.05, 0.02, Math.min(1.1, eave * 0.4), 'glass', { repeat: 2, gap: hw * 0.6 }));
    } else {
      const kw = Math.min(0.34, cw * 0.75);
      const kd = Math.min(kw * 0.9, cd * 0.7);
      const zc = -ez + t / 2 + kd / 2 + 0.005;
      out.push(box(0, zc, 0, kw, kd, inner, 'wall'));
      out.push(box(kw * 0.2, zc + kd / 2 + 0.03, 0, kw * 0.5, 0.08, inner * 0.35, 'wall2'));
      out.push(box(0, zc, inner, kw + 0.03, kd + 0.03, 0.4, 'trim'));
      for (const sz of [-1, 1]) out.push(box(0, zc + (sz * kd) / 2, inner + 0.4, 0.05, 0.035, 0.55, 'wall', { repeat: 2, gap: kw - 0.03 }));
      out.push(box(0, zc + kd / 2 + 0.005, inner * 0.55, 0.03, 0.02, 1.3, 'dark', { repeat: 2, gap: kw * 0.4 }));
    }
    return out;
  },
);

interface Face { x: number; z: number; len: number; rot: number }

export const arena = skel(
  'arena', 'structure', 'Raked seating round a floor, behind an outer wall.',
  ['stadium', 'colosseum', 'bullring', 'racetrack grandstand', 'open-air theatre', 'senate chamber', 'fighting pit', 'drone-race bowl'],
  [
    C('plan', ['bowl', 'horseshoe', 'twin', 'stand'], 'bowl', 'eight-sided, open-ended, two facing stands, or one'),
    N('height', 4, 20, 10, 'm'),
    N('tiers', 2, 6, 4, ';seating steps'),
    N('width', 0.6, 1, 1, ';plan'),
    C('facade', ['plain', 'arches', 'piers', 'bands'], 'arches', 'outer wall'),
    C('roof', ['none', 'rim', 'canopy', 'masts'], 'none', 'cover over the top tier, or floodlights'),
    C('floor', ['sand', 'water', 'court', 'stage', 'track'], 'sand', 'what the seats look at'),
  ],
  (d) => {
    const plan = str(d, 'plan');
    const H = num(d, 'height');
    const T = int(d, 'tiers');
    const a = num(d, 'width') * 0.48;
    const facade = str(d, 'facade');
    const roof = str(d, 'roof');
    const floor = str(d, 'floor');
    // Depth of a stand from the outer wall to the floor, and of one seating step.
    const sd = a * (plan === 'stand' ? 1.1 : plan === 'twin' ? 0.56 : 0.44);
    const td = sd / T;
    const low = clamp(H * 0.15, 0.8, 2);
    const hOf = (k: number): number => lerp(H - SILL, low, k / (T - 1));
    const tone = (k: number): PartTone => (k % 2 === 0 ? 'wall' : 'wall2');
    /** Length of step k of a stand; the bowl is eight-sided, so its steps shorten inward. */
    const lenOf = (k: number): number => (plan === 'twin' ? 2 * a * 0.96 : plan === 'stand' ? 2 * a : 0.828 * (a - k * td));
    const side0 = 0.828 * a;
    const sideLen = (k: number): number => (plan === 'horseshoe' ? a + lenOf(k) / 2 : lenOf(k));
    const sideZ = (k: number): number => (plan === 'horseshoe' ? (a - lenOf(k) / 2) / 2 : 0);
    const out: BlueprintPart[] = [box(0, 0, 0, 2 * a + 0.02, 2 * a + 0.02, SILL, 'wall2')];
    for (let k = 0; k < T; k++) {
      const line = a - (k + 0.5) * td;
      if (plan !== 'stand') out.push(box(0, sideZ(k), SILL, td, sideLen(k), hOf(k), tone(k), { repeat: 2, gap: 2 * line }));
      if (plan === 'bowl') out.push(box(0, 0, SILL, td, lenOf(k), hOf(k), tone(k), { rot: 90, repeat: 2, gap: 2 * line }));
      else if (plan !== 'twin') out.push(box(0, -line, SILL, lenOf(k), td, hOf(k), tone(k)));
    }
    // The corners of the bowl are single rakes set on the diagonal, as high as the wall at their backs.
    const corners: [number, number, number][] = plan === 'bowl' ? [[1, 1, -45], [1, -1, 45], [-1, -1, 135], [-1, 1, -135]]
      : plan === 'horseshoe' ? [[1, -1, 45], [-1, -1, 135]] : [];
    const rc = (a - sd / 2) * Math.SQRT1_2;
    for (const [sx, sz, rot] of corners) out.push(wedge(sx * rc, sz * rc, SILL, sd, side0, H - SILL, 'wall', { rot }));

    const fx = plan === 'stand' ? a : a - sd;
    const fz0 = plan === 'stand' ? -a + sd : plan === 'twin' ? -a * 0.96 : -(a - sd);
    const fz1 = plan === 'bowl' ? a - sd : plan === 'twin' ? a * 0.96 : a;
    const fw = 2 * fx;
    const fd = fz1 - fz0;
    const fcz = (fz0 + fz1) / 2;
    out.push(box(0, fcz, SILL, fw, fd, 0.08, floor === 'water' ? 'glass' : floor === 'court' ? 'accent' : 'wall'));
    if (floor === 'court') {
      out.push(box(0, fcz, SILL + 0.08, fw * 0.9, 0.02, 0.05, 'trim'));
      out.push(box(0, fcz, SILL, 0.02, fd * 0.3, 2.4, 'trim', { repeat: 2, gap: fw * 0.86 }));
    } else if (floor === 'stage') {
      out.push(box(0, fz1 - fd * 0.2, SILL, fw * 0.6, fd * 0.3, 0.9, 'wall2'));
      out.push(box(0, fz1 - fd * 0.2, SILL, 0.05, fd * 0.3, 3.2, 'trim', { repeat: 2, gap: fw * 0.6 }));
    } else if (floor === 'track') {
      // A spine down the long axis with a turning post at each end.
      const long = fd > fw;
      out.push(box(0, fcz, SILL, long ? 0.03 : fw * 0.55, long ? fd * 0.55 : 0.03, 0.9, 'wall2'));
      out.push(cone(0, fcz, SILL, 0.05, 0.05, 2.6, 'trim', { rot: long ? 90 : 0, repeat: 2, gap: (long ? fd : fw) * 0.62 }));
    }

    const faces: Face[] = [];
    if (plan === 'bowl') faces.push({ x: 0, z: a, len: side0, rot: 0 });
    if (plan !== 'stand') faces.push({ x: -a, z: sideZ(0), len: sideLen(0), rot: 90 }, { x: a, z: sideZ(0), len: sideLen(0), rot: 90 });
    if (plan !== 'twin') faces.push({ x: 0, z: -a, len: lenOf(0), rot: 0 });
    /** A point `e` outside (or, negative, inside) the middle of an outer face. */
    const off = (f: Face, e: number): [number, number] => {
      const s = Math.sign(f.x || f.z);
      return f.rot === 90 ? [f.x + s * e, f.z] : [f.x, f.z + s * e];
    };
    for (const f of faces) {
      let n = clamp(Math.round(f.len / 0.11), 2, 9);
      // No pier stands in the middle of the street front, where the way in is.
      if (f.z > 0 && f.rot === 0 && facade === 'piers' && n % 2 === 0) n += 1;
      const g = f.len / n;
      if (facade === 'arches') {
        const ah = clamp(H * 0.42, 1.6, 4.2);
        const [x, z] = off(f, 0.004);
        out.push(arch(x, z, SILL, g * 0.62, 0.03, ah, 'dark', { rot: f.rot, repeat: n, gap: g }));
        if (H >= 11 && fits(out, 6)) out.push(arch(x, z, SILL + ah + 1.1, g * 0.5, 0.03, Math.min(ah, H - SILL - ah - 2.2), 'dark', { rot: f.rot, repeat: n, gap: g }));
      } else if (facade === 'piers') {
        const [x, z] = off(f, 0.012);
        out.push(box(x, z, SILL, 0.03, 0.04, H - SILL + 0.3, 'trim', { rot: f.rot, repeat: n + 1, gap: g }));
      } else if (facade === 'bands') {
        const [x, z] = off(f, 0.006);
        for (const k of H >= 9 ? [0.4, 0.75] : [0.6]) out.push(box(x, z, SILL + (H - SILL) * k, f.len, 0.03, 0.35, 'trim', { rot: f.rot }));
      } else out.push(box(f.x, f.z, H, f.len, 0.05, 0.25, 'trim', { rot: f.rot }));
    }
    if (plan === 'bowl' && facade !== 'arches' && fits(out)) out.push(arch(0, a + 0.006, SILL, 0.1, 0.04, clamp(H * 0.3, 2.2, 3.4), 'dark'));

    if (roof === 'rim' || roof === 'canopy') {
      for (const f of faces) {
        if (!fits(out, 2)) break;
        const s = Math.sign(f.x || f.z);
        const [wx, wz] = off(f, -0.015);
        out.push(box(wx, wz, H, f.len, 0.03, 2.6, 'wall', { rot: f.rot }));
        if (roof === 'rim') {
          const reach = Math.min(sd, td * 1.5 + 0.03);
          const [x, z] = off(f, -reach / 2);
          out.push(box(x, z, H + 2.6, f.len, reach, 0.25, 'roof', { rot: f.rot }));
        } else {
          // A cantilever that tilts up toward the floor.
          const reach = sd * 0.85;
          const [x, z] = off(f, -reach / 2);
          const rot = f.rot === 90 ? (s > 0 ? 180 : 0) : s > 0 ? 90 : -90;
          out.push(wedge(x, z, H + 2.4, reach, f.len, 1 + reach * 5, 'roof', { rot }));
        }
      }
    } else if (roof === 'masts' && fits(out, 4)) {
      const m = a - 0.025;
      for (const sz of [-1, 1]) {
        out.push(cyl(0, sz * m, 0, 0.035, 0.035, H + 6, 'dark', { repeat: 2, gap: 2 * m }));
        out.push(box(0, sz * m, H + 6, 0.1, 0.03, 0.9, 'glow', { repeat: 2, gap: 2 * m }));
      }
    }
    return out;
  },
);

export const tank = skel(
  'tank', 'structure', 'Vessels for storage, upright, raised or lying.',
  ['grain silo', 'fuel depot', 'water tower', 'gas holder', 'brewery vats', 'cryo tanks', 'reservoir', 'air scrubbers'],
  [
    C('form', ['upright', 'sphere', 'lying', 'telescoped', 'basin'], 'upright', 'vessel'),
    N('count', 1, 4, 2, ''),
    N('height', 2, 22, 9, 'm'),
    N('girth', 0.3, 1, 0.85, ';share of its bay'),
    N('legs', 0, 10, 0, 'm raised'),
    C('top', ['flat', 'dome', 'cone', 'open'], 'dome', 'lid of an upright vessel'),
    N('bands', 0, 5, 3, ';hoops'),
    C('access', ['none', 'ladder', 'stair', 'catwalk'], 'catwalk', 'way up'),
    N('pipes', 0, 1, 0.6, ';pipework at the foot'),
  ],
  (d) => {
    const form = str(d, 'form');
    const n = int(d, 'count');
    const girth = num(d, 'girth');
    const top = str(d, 'top');
    const bands = int(d, 'bands');
    const access = str(d, 'access');
    const pipes = num(d, 'pipes');
    const lying = form === 'lying';
    // Lying vessels lie along the street in ranks from front to back; the others stand in a row.
    const bay = (lying ? 0.9 : 0.94) / n;
    const dv = lying ? Math.min(bay * 0.92 * girth, 0.45) : Math.min(bay * 0.94 * girth, 0.9);
    const wide = dv * NOMINAL;
    const H0 = num(d, 'height');
    const H = form === 'sphere' ? clamp(H0, wide * 0.7, wide * 1.2) : lying ? clamp(H0, wide * 0.6, wide * 1.2)
      : form === 'basin' ? clamp(H0 * 0.25, 1, 4) : H0;
    const legs = Math.min(num(d, 'legs'), 26 - H);
    const raised = !lying && form !== 'basin' && (form === 'sphere' || legs > 0.4);
    const y0 = form === 'sphere' ? Math.max(legs, H * 0.2) : lying ? clamp(legs, 0.6, 6) : raised ? legs : SILL;
    const yT = y0 + H;
    const o: PartOpts = lying ? { rot: 90, repeat: n, gap: bay } : { repeat: n, gap: bay };
    const out: BlueprintPart[] = [box(0, 0, 0, 0.98, lying ? 0.98 : Math.min(0.98, dv + 0.12), SILL, 'wall2')];
    if (lying) {
      for (const sx of [-1, 1]) out.push(box(sx * 0.27, 0, 0, dv * 0.85, 0.05, y0 + H * 0.25, 'wall2', o));
    } else if (raised) {
      const at = dv * 0.36;
      const lh = form === 'sphere' ? y0 + H * 0.5 : y0 + 0.1;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) out.push(box(sx * at, sz * at, 0, 0.03, 0.03, lh, 'dark', o));
      }
      if (lh >= 3) out.push(ring(0, 0, lh * 0.5, dv * 0.8, dv * 0.8, 0.14, 'dark', o));
      if (form !== 'sphere') out.push(cyl(0, 0, 0, 0.05, 0.05, y0 + 0.1, 'wall2', o));
    } else if (form !== 'basin') out.push(cyl(0, 0, SILL, dv + 0.03, dv + 0.03, 0.35, 'wall2', o));

    const hoop = (y: number, w: number): BlueprintPart => cyl(0, 0, y - 0.1, w + 0.014, w + 0.014, 0.2, 'trim', o);
    if (form === 'sphere') {
      out.push(sph(0, 0, y0, dv, dv, H, 'wall', o));
      if (bands > 0) out.push(hoop(y0 + H * 0.5, dv));
      out.push(cyl(0, 0, yT - 0.15, dv * 0.3, dv * 0.3, 0.3, 'dark', o));
    } else if (lying) {
      out.push(arch(0, 0, y0, dv, 0.84, H, 'wall', o));
      for (const sx of [-1, 1]) out.push(sph(sx * 0.42, 0, y0, dv * 0.98, 0.1, H * 0.98, 'wall', o));
      for (let k = 0; k < bands; k++) out.push(arch(bands > 1 ? lerp(-0.34, 0.34, k / (bands - 1)) : 0, 0, y0, dv + 0.014, 0.025, H + 0.05, 'trim', o));
      out.push(cyl(0, 0, yT - 0.1, 0.06, 0.06, 0.5, 'dark', o));
    } else if (form === 'telescoped') {
      // Three lifts, each rising out of the one below, inside a guide frame.
      for (let i = 0; i < 3; i++) {
        const w = dv * (1 - 0.09 * i);
        out.push(cyl(0, 0, y0 + (i * H) / 3, w, w, H / 3, i % 2 === 1 ? 'wall2' : 'wall', o));
        if (i < Math.min(bands, 2)) out.push(hoop(y0 + ((i + 1) * H) / 3, w));
      }
      const yp = raised ? 0 : SILL;
      for (const s of [-1, 1]) {
        out.push(box(s * dv * 0.5, 0, yp, 0.02, 0.02, yT + 0.6 - yp, 'dark', o));
        out.push(box(0, s * dv * 0.5, yp, 0.02, 0.02, yT + 0.6 - yp, 'dark', o));
      }
      out.push(ring(0, 0, yT + 0.3, dv * 1.04, dv * 1.04, 0.2, 'dark', o));
    } else if (form === 'basin') {
      out.push(cyl(0, 0, y0, dv, dv, H, 'wall', o));
      out.push(cyl(0, 0, yT - 0.12, dv * 0.9, dv * 0.9, 0.14, 'glass', o));
      out.push(box(0, 0, yT, dv * 0.98, 0.03, 0.25, 'dark', o));
      out.push(cyl(0, 0, yT, 0.05, 0.05, 0.9, 'dark', o));
      for (let k = 1; k <= Math.min(bands, 2); k++) out.push(hoop(y0 + (H * k) / 3, dv));
    } else {
      out.push(cyl(0, 0, y0, dv, dv, H, 'wall', o));
      for (let k = 1; k <= bands; k++) out.push(hoop(y0 + (H * k) / (bands + 1), dv));
    }
    if (form === 'upright' || form === 'telescoped') {
      const dt = form === 'telescoped' ? dv * 0.82 : dv;
      if (top === 'dome') out.push(dome(0, 0, yT, dt, dt, clamp(dt * NOMINAL * 0.3, 0.5, 3.5), 'roof', o));
      else if (top === 'cone') out.push(cone(0, 0, yT, dt * 1.04, dt * 1.04, clamp(dt * NOMINAL * 0.4, 0.6, 4.5), 'roof', o));
      else if (top === 'open') {
        out.push(cyl(0, 0, yT - 0.2, dt + 0.016, dt + 0.016, 0.2, 'trim', o));
        out.push(cyl(0, 0, yT - 0.1, dt * 0.9, dt * 0.9, 0.12, 'dark', o));
      } else {
        out.push(cyl(0, 0, yT, dt + 0.016, dt + 0.016, 0.2, 'trim', o));
        out.push(cyl(0, 0, yT + 0.2, dt * 0.2, dt * 0.2, 0.5, 'dark', o));
      }
    }

    // The way up runs on the street face of the row, or of the front rank.
    const zF = lying ? ((n - 1) / 2) * bay + dv / 2 : dv / 2;
    const lo = lying || raised ? 0 : SILL;
    const firstX = lying ? 0.2 : -((n - 1) / 2) * bay;
    if (access === 'ladder' || (lying && access === 'stair')) {
      out.push(lying
        ? box(firstX, zF + 0.008, lo, 0.03, 0.02, yT + 0.6 - lo, 'dark')
        : box(0, zF + 0.008, lo, 0.03, 0.02, yT + 0.7 - lo, 'dark', o));
    } else if (access === 'stair') {
      // A flight seen from the side: a thin plate whose top edge climbs across the face of the vessel.
      out.push(wedge(0, zF + 0.012, lo, dv * 0.85, 0.02, yT - lo, 'dark', o));
      out.push(box(dv * 0.4, zF + 0.02, yT - 0.15, 0.07, 0.06, 0.15, 'dark', o));
    } else if (access === 'catwalk') {
      const span = lying ? 0.8 : Math.min(0.96, (n - 1) * bay + dv + 0.06);
      const zw = lying ? zF - dv / 2 : zF - 0.04;
      out.push(box(0, zw, yT, span, 0.06, 0.12, 'dark'));
      out.push(box(0, zw + 0.02, yT + 0.12, span, 0.02, 0.9, 'dark'));
      out.push(box(firstX, zF + 0.008, lo, 0.03, 0.02, yT + 0.7 - lo, 'dark'));
    }
    if (pipes > 0.15) {
      const zP = zF + 0.035;
      const px = lying ? 0 : -dv * 0.3;
      const span = lying ? 0.56 : (n - 1) * bay + 0.06;
      out.push(box(px, zP, 0, 0.03, 0.03, 1.3, 'dark', lying ? { repeat: 2, gap: 0.5 } : { repeat: n, gap: bay }));
      out.push(box(px, zP, 1, span, 0.03, 0.25, 'dark'));
      if (pipes > 0.5) out.push(box(lying ? 0.33 : Math.min(0.44, px + span / 2 + 0.06), zP, 0, 0.08, 0.07, 1.1, 'accent'));
      if (pipes > 0.8 && !lying) out.push(box(dv * 0.3, zF + 0.012, lo, 0.025, 0.025, yT + 0.4 - lo, 'dark', o));
    }
    return out;
  },
);

export const pier = skel(
  'pier', 'structure', 'Long deck on piles, floats or a solid base, with moorings.',
  ['fishing jetty', 'railway platform', 'boardwalk', 'ferry landing', 'loading dock', 'airship berth', 'space dock arm', 'canal quay'],
  [
    C('run', ['along', 'out'], 'along', 'beside the street, or away from it'),
    C('base', ['piles', 'floats', 'solid', 'trestle'], 'piles', 'piles and floats stand in water'),
    N('height', 0.6, 6, 1.6, 'm'),
    N('width', 0.15, 0.6, 0.3, ''),
    N('bays', 2, 10, 6, ';pile pairs'),
    C('head', ['none', 'shed', 'shelter', 'tee', 'light'], 'shed', 'what the far end carries'),
    N('rails', 0, 2, 1, ';sides railed'),
    N('berths', 0, 3, 1, 'boats or cars alongside'),
    N('lamps', 0, 6, 2, ''),
    N('stores', 0, 1, 0.5, ';goods on deck'),
  ],
  (d) => {
    const base = str(d, 'base');
    const Hd = num(d, 'height');
    const wd = num(d, 'width');
    const bays = int(d, 'bays');
    const head = str(d, 'head');
    const rails = int(d, 'rails');
    const berths = int(d, 'berths');
    const lamps = int(d, 'lamps');
    const stores = Math.round(num(d, 'stores') * 3);
    // Built along x with the land at the left end; the deck moves back to leave room for what is moored.
    const zc = berths > 0 ? -Math.min(0.12, 0.48 - wd / 2) : 0;
    const zF = zc + wd / 2;
    const zB = zc - wd / 2;
    const xm = 0.05;
    const Ld = 0.86;
    const g = Ld / bays;
    const along: PartOpts = { repeat: bays, gap: g };
    const wet = base === 'piles' || base === 'floats';
    const out: BlueprintPart[] = [];
    if (wet) out.push(box(0, 0, 0, 1, 1, 0.06, 'glass'));
    if (base === 'solid') {
      out.push(box(0, zc, 0, 1, Math.min(1, wd + 0.1), SILL, 'wall2'));
      out.push(box(xm, zc, SILL, Ld, wd, Hd - 0.2 - SILL, 'wall'));
      if (Hd >= 1.6) out.push(arch(xm, zF + 0.004, SILL, g * 0.55, 0.03, Hd - SILL - 0.45, 'dark', along));
    } else if (base === 'floats') {
      out.push(box(xm, zc, 0, g * 0.6, wd * 0.9, 0.55, 'wall2', along));
      out.push(cyl(xm, zc, 0, 0.03, 0.03, Hd - 0.2, 'dark', along));
    } else {
      // Piles on a side with no rail stand proud of the deck as mooring posts.
      out.push(cyl(xm, zB + 0.03, 0, 0.035, 0.035, Hd + (rails === 0 ? 0.6 : 0), 'dark', along));
      out.push(cyl(xm, zF - 0.03, 0, 0.035, 0.035, Hd + (rails < 2 ? 0.6 : 0), 'dark', along));
      out.push(box(xm, zc, Hd - 0.5, 0.03, wd, 0.3, 'dark', along));
      if (base === 'trestle' && Hd >= 2.2) {
        for (const z of [zB + 0.03, zF - 0.03]) out.push(box(xm, z, Hd * 0.45, Ld, 0.02, 0.15, 'dark'));
      }
    }
    // A ramp up from the land, then the deck and its fender.
    out.push(wedge(-0.44, zc, 0, 0.12, wd, Hd, 'wall2'));
    out.push(box(xm, zc, Hd - 0.2, Ld, wd, 0.2, base === 'solid' ? 'trim' : 'wall'));
    if (base !== 'solid') out.push(box(xm, zF + 0.008, Hd - 0.32, Ld, 0.02, 0.3, 'dark'));

    const far = 0.34;
    if (head === 'shed') {
      const sd = wd * 0.8;
      out.push(box(far, zc, Hd, 0.2, sd, 2.3, 'wall'));
      out.push(gable(far, zc, Hd + 2.3, 0.24, sd + 0.04, 0.9, 'roof'));
      out.push(box(far - 0.106, zc, Hd, 0.02, Math.min(0.1, sd * 0.5), 1.9, 'dark'));
      out.push(box(far, zc + sd / 2 + 0.005, Hd + 1, 0.07, 0.02, 0.7, 'glass'));
    } else if (head === 'shelter') {
      const k = clamp(Math.round(bays / 2), 2, 5);
      out.push(cyl(xm, zc, Hd, 0.03, 0.03, 2.7, 'dark', { repeat: k, gap: (Ld * 0.8) / k }));
      out.push(box(xm, zc, Hd + 2.5, Ld * 0.85, 0.03, 0.2, 'trim'));
      out.push(gable(xm, zc, Hd + 2.7, Ld * 0.85, Math.min(wd * 1.1, wd + 0.08), 0.6, 'roof'));
      out.push(box(xm, zc, Hd, Ld * 0.3, 0.04, 0.5, 'wall2'));
    } else if (head === 'tee') {
      const across = Math.min(wd * 2.2, 2 * (0.48 - Math.abs(zc)));
      out.push(box(0.4, zc, Hd - 0.2, 0.16, across, 0.2, 'wall'));
      out.push(cyl(0.4, zc, 0, 0.035, 0.035, Hd + 0.6, 'dark', { rot: 90, repeat: 2, gap: across - 0.05 }));
    } else if (head === 'light') {
      const lw = Math.min(0.09, wd * 0.5);
      out.push(cyl(0.42, zc, Hd, lw, lw, 4.2, 'wall'));
      out.push(cyl(0.42, zc, Hd + 4.2, 0.12, 0.12, 0.15, 'dark'));
      out.push(sph(0.42, zc, Hd + 4.35, 0.07, 0.07, 0.6, 'glow'));
      out.push(cone(0.42, zc, Hd + 4.95, 0.1, 0.1, 0.5, 'roof'));
    }
    for (const z of rails >= 2 ? [zB + 0.012, zF - 0.012] : rails === 1 ? [zB + 0.012] : []) {
      out.push(box(xm, z, Hd, 0.02, 0.02, 0.95, 'dark', { repeat: 10, gap: Ld / 10 }));
      out.push(box(xm, z, Hd + 0.88, Ld, 0.02, 0.07, 'dark'));
    }
    if (lamps > 0) {
      const o: PartOpts = { repeat: lamps, gap: Ld / lamps };
      out.push(box(xm, zB + 0.05, Hd, 0.02, 0.02, 2.6, 'dark', o));
      out.push(sph(xm, zB + 0.05, Hd + 2.6, 0.04, 0.04, 0.3, 'glow', o));
    }
    // What lies alongside: a hull, a bow and a cabin each.
    for (let i = 0; i < berths && fits(out, 3); i++) {
      const bx = berths === 1 ? 0 : lerp(-0.22, 0.3, i / (berths - 1));
      const len = berths === 3 ? 0.17 : 0.22;
      const zb = zF + 0.075;
      out.push(box(bx, zb, 0, len, 0.09, 0.75, 'wall2'));
      out.push(wedge(bx + len / 2 + 0.03, zb, 0, 0.06, 0.09, 0.75, 'wall2', { rot: 180 }));
      out.push(box(bx - len * 0.2, zb, 0.75, len * 0.4, 0.07, 0.8, i % 2 === 0 ? 'accent' : 'wall'));
    }
    const sw = Math.min(0.07, wd * 0.3);
    if (stores >= 1 && fits(out)) out.push(box(-0.22, zc - wd * 0.2, Hd, sw, sw, 0.7, 'accent'));
    if (stores >= 2 && fits(out)) out.push(cyl(-0.1, zc - wd * 0.2, Hd, sw * 0.7, sw * 0.7, 0.8, 'wall2', { repeat: 2, gap: sw * 0.85 }));
    if (stores >= 3 && fits(out)) out.push(box(-0.27, zc + wd * 0.15, Hd, sw * 0.7, sw * 0.7, 0.5, 'wall2'));
    return str(d, 'run') === 'out' ? turn(out, 90) : out;
  },
);

export const terrace = skel(
  'terrace', 'structure', 'Stepped platforms climbing to one side, planted or lived in.',
  ['rice terraces', 'pueblo', 'hanging gardens', 'hillside vineyard', 'river ghats', 'cliff dwelling', 'terraced flats', 'quarry benches'],
  [
    N('steps', 2, 6, 4, ''),
    N('rise', 0.8, 4.5, 2.4, 'm each'),
    C('climb', ['back', 'side', 'corner'], 'back', 'where the high end is'),
    N('setback', 0.3, 1, 0.8, '1 even treads, low a steep face'),
    C('cover', ['bare', 'plants', 'crops', 'water', 'rooms'], 'plants', 'what each level carries'),
    C('edge', ['plain', 'parapet', 'rail', 'coping'], 'coping', 'lip of each level'),
    C('way', ['none', 'stair', 'ladders', 'ramps'], 'stair', 'way up'),
    C('top', ['none', 'hut', 'tree', 'shrine', 'cistern', 'tower'], 'hut', 'what the highest level carries'),
  ],
  (d, rng) => {
    const T = int(d, 'steps');
    const rise = num(d, 'rise');
    const climb = str(d, 'climb');
    const cover = str(d, 'cover');
    const edge = str(d, 'edge');
    const way = str(d, 'way');
    const top = str(d, 'top');
    const corner = climb === 'corner';
    // The first flight needs ground to stand on in front of the lowest level.
    const lead = way === 'none' ? 0.02 : 0.1;
    const zb = -0.48;
    const f0 = 0.48 - lead;
    const tread = ((f0 - zb) * num(d, 'setback')) / T;
    const treadX = (0.96 * num(d, 'setback')) / T;
    const front = (k: number): number => f0 - k * tread;
    const yOf = (k: number): number => SILL + (k + 1) * rise;
    const x0: number[] = [];
    const x1: number[] = [];
    let inset = 0;
    for (let k = 0; k < T; k++) {
      if (k > 0) inset += rng.range(0, 0.02);
      x0.push(corner ? -0.48 : -0.48 + inset);
      x1.push(corner ? 0.48 - k * treadX : 0.48 - inset);
    }
    const mid = (k: number): number => ((x0[k] ?? 0) + (x1[k] ?? 0)) / 2;
    const span = (k: number): number => (x1[k] ?? 0) - (x0[k] ?? 0);
    const out: BlueprintPart[] = [box(0, 0, 0, 1, 1, SILL, 'wall2')];
    for (let k = 0; k < T; k++) out.push(box(mid(k), (zb + front(k)) / 2, SILL, span(k), front(k) - zb, (k + 1) * rise, k % 2 === 0 ? 'wall' : 'wall2'));
    // Lived-in levels show a row of doorways in every riser.
    if (cover === 'rooms') {
      for (let k = 0; k < T; k++) {
        const n = clamp(Math.round(span(k) / 0.2), 1, 5);
        out.push(box(mid(k), front(k) + 0.006, yOf(k) - rise, 0.05, 0.02, Math.min(1.9, rise * 0.75), 'dark', { repeat: n, gap: span(k) / n }));
      }
    }
    const tk = T - 1;
    const tcx = mid(tk);
    const tcz = (zb + front(tk)) / 2;
    const tw = span(tk);
    const tdp = front(tk) - zb;
    const yT = yOf(tk);
    if (top === 'hut') {
      const hw = Math.min(0.3, tw * 0.6);
      const hd = Math.min(0.24, tdp * 0.7);
      out.push(box(tcx, tcz, yT, hw, hd, 2.4, 'wall2'));
      out.push(gable(tcx, tcz, yT + 2.4, hw + 0.05, hd + 0.05, 1, 'roof'));
      out.push(box(tcx, tcz + hd / 2 + 0.005, yT, Math.min(0.08, hw * 0.4), 0.02, 1.9, 'dark'));
    } else if (top === 'tree') {
      const cw = Math.min(0.3, tw * 0.6);
      out.push(cyl(tcx, tcz, yT, 0.04, 0.04, 1.8, 'wall2'));
      out.push(sph(tcx, tcz, yT + 1.4, cw, Math.min(cw, tdp), 2.6, 'accent'));
    } else if (top === 'shrine') {
      const hw = Math.min(0.26, tw * 0.6);
      const hd = Math.min(0.2, tdp * 0.7);
      for (const sz of [-1, 1]) out.push(box(tcx, tcz + (sz * hd) / 2, yT, 0.025, 0.025, 2.4, 'trim', { repeat: 2, gap: hw }));
      out.push(pyr(tcx, tcz, yT + 2.4, hw + 0.08, hd + 0.08, 1.3, 'roof'));
    } else if (top === 'cistern') {
      const cw = Math.min(0.22, tw * 0.6, tdp * 0.8);
      out.push(cyl(tcx, tcz, yT, cw, cw, 1.6, 'wall2'));
      out.push(cyl(tcx, tcz, yT + 1.5, cw * 0.86, cw * 0.86, 0.12, 'glass'));
    } else if (top === 'tower') {
      const th = Math.min(rise * 1.5 + 3, 28.4 - yT);
      const cw = Math.min(0.16, tw * 0.5);
      const cdp = Math.min(0.16, tdp * 0.8);
      out.push(box(tcx, tcz, yT, cw, cdp, th, 'wall'));
      out.push(pyr(tcx, tcz, yT + th, cw + 0.03, cdp + 0.03, 1.2, 'roof'));
      out.push(box(tcx, tcz + cdp / 2 + 0.004, yT + th * 0.6, 0.03, 0.02, Math.min(1.2, th * 0.25), 'dark'));
    }
    // One flight to each level, standing on the level below.
    for (let k = 0; k < T && way !== 'none' && fits(out); k++) {
      const yb = yOf(k) - rise;
      const room = k === 0 ? lead - 0.01 : tread;
      if (way === 'stair') {
        const run = Math.min(room, 0.2);
        out.push(wedge(corner ? -0.2 : 0.18, front(k) + run / 2, yb, run, 0.11, rise, 'wall2', { rot: 90 }));
      } else if (way === 'ladders') {
        const lx = corner ? -0.3 + 0.15 * (k % 2) : (k % 2 === 0 ? 1 : -1) * 0.15;
        out.push(box(lx, front(k) + 0.012, yb, 0.04, 0.02, rise + 0.6, 'dark'));
      } else {
        // Ramps zigzag across the face.
        const dp = clamp(room * 0.8, 0.03, 0.07);
        out.push(wedge(mid(k), front(k) + dp / 2, yb, span(k) * 0.7, dp, rise, 'wall2', { rot: k % 2 === 0 ? 0 : 180 }));
      }
    }
    for (let k = 0; k < T && edge !== 'plain' && fits(out); k++) {
      const y = yOf(k);
      if (edge === 'parapet') out.push(box(mid(k), front(k) - 0.015, y, span(k), 0.03, 0.7, 'wall2'));
      else if (edge === 'rail') out.push(box(mid(k), front(k) - 0.01, y, span(k), 0.02, 0.9, 'dark'));
      else out.push(box(mid(k), front(k) - 0.02, y - 0.12, span(k) + 0.02, 0.07, 0.2, 'trim'));
    }
    /** What grows or stands on a strip of level ground `len` long and `dp` deep. */
    const grow = (cx: number, cz: number, len: number, dp: number, y: number, rot: number): BlueprintPart | undefined => {
      if (cover === 'plants') {
        const n = clamp(Math.round(len / 0.14), 1, 7);
        const w = Math.min(dp * 0.8, 0.13);
        return dome(cx, cz, y, w, w, rng.range(0.6, 1.3), 'accent', { rot, repeat: n, gap: len / n });
      }
      if (cover === 'crops') return box(cx, cz, y, len * 0.94, dp * 0.6, 0.4, 'accent', { rot });
      if (cover === 'water') return box(cx, cz, y, len * 0.94, dp * 0.8, 0.07, 'glass', { rot });
      return undefined;
    };
    for (let k = 0; k < T; k++) {
      const strips: (BlueprintPart | undefined)[] = [];
      if (k < tk) {
        strips.push(grow(mid(k), front(k) - tread / 2, span(k), tread, yOf(k), 0));
        if (corner) strips.push(grow((x1[k] ?? 0) - treadX / 2, (zb + front(k + 1)) / 2, front(k + 1) - zb, treadX, yOf(k), 90));
        if (cover === 'rooms') {
          // Roof beams poke out under each parapet.
          const n = clamp(Math.round(span(k) / 0.09), 2, 10);
          strips.push(box(mid(k), front(k) + 0.012, yOf(k) - 0.4, 0.02, 0.04, 0.12, 'dark', { repeat: n, gap: span(k) / n }));
        }
      } else if (top === 'none') strips.push(grow(tcx, tcz, tw, tdp, yT, 0));
      for (const p of strips) if (p && fits(out)) out.push(p);
    }
    // Two bare levels alone still get a footing course along the lowest riser.
    if (out.length < 4) out.push(box(mid(0), front(0) + 0.01, SILL, span(0), 0.04, 0.25, 'wall2'));
    return climb === 'side' ? turn(out, -90) : out;
  },
);
