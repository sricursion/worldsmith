// The people in the background. The named characters of a world are the few with something to say; a village
// has more people than that on its lanes, and a crowded city has its streets full. These are plain figures in
// the proportions and colours of the world's own folk, drawn instanced (a body, a head and two legs: four draw
// calls for everyone), walking the streets around the walker. They are kept near: whoever falls behind is set
// down again on a street ahead. Nobody here talks, and nobody is on the navmesh.
//
// How many is the scale's figure (see world/scale.ts) times 1, 0.65 or 0.4 by quality, at most 220.
import * as THREE from 'three';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { ScaleProfile } from '../world/scale';
import type { FolkSpec } from '../world/spec';
import { fabricPresence } from './fabric';
import type { FabricGrid } from './fabric';

export const MAX_CROWD = 220;
const QUALITY_SHARE: readonly [number, number, number] = [0.4, 0.65, 1];

/** How many background people a world has around the walker. */
export function crowdSize(profile: ScaleProfile | null, quality: 0 | 1 | 2): number {
  if (!profile) return 0;
  return Math.min(MAX_CROWD, Math.round(profile.crowd * (QUALITY_SHARE[quality] as number)));
}

export interface CrowdInput {
  profile: ScaleProfile;
  folk?: FolkSpec;
  seed: number;
  quality: 0 | 1 | 2;
  /** Points along the place's own streets and paths (TownLayout.walkable). */
  walkable: readonly { x: number; z: number }[];
  /** The street lattice of a town or city, or null. */
  grid: FabricGrid | null;
  heightAt(x: number, z: number): number;
  waterDepthAt?(x: number, z: number): number;
}

export interface Crowd {
  group: THREE.Group;
  /** People in the crowd. */
  count: number;
  update(dt: number, focus: { x: number; z: number }): void;
  /** Where everyone stands, for tests and for sound: x, z pairs. */
  positions(): Float32Array;
  dispose(): void;
}

interface Walker {
  x: number; z: number; y: number;
  /** Unit heading, and metres a second (0 for someone standing about). */
  dx: number; dz: number; speed: number;
  /** on a lattice street: along x (0) or z (1), the street's own coordinate, and the sideways offset kept from its middle. */
  lattice: boolean; axis: 0 | 1; line: number; off: number;
  /** In the place: the point being walked to. */
  tx: number; tz: number;
  phase: number; tall: number; wide: number; fade: number; pause: number;
}

const HEX = /^#[0-9a-f]{6}$/i;
const colours = (list: readonly string[] | undefined, fallback: string[]): THREE.Color[] =>
  ((list ?? []).filter((c) => HEX.test(c)).length > 0 ? (list ?? []).filter((c) => HEX.test(c)) : fallback).map((c) => new THREE.Color(c));

export function createCrowd(inp: CrowdInput): Crowd | null {
  const count = crowdSize(inp.profile, inp.quality);
  const grid = inp.grid;
  if (count <= 0 || (inp.walkable.length < 2 && !grid)) return null;
  const group = new THREE.Group();
  group.name = 'crowd';
  const folk = inp.folk;
  const height = Math.min(3, Math.max(0.5, folk?.height ?? 1.72));
  const k = height / 1.75;
  const bulk = 0.85 + 0.5 * Math.min(1, Math.max(0, folk?.bulk ?? 0.4));
  const head = Math.min(1.6, Math.max(0.7, folk?.head ?? 1));
  const covered = (folk?.features ?? []).some((f) => f === 'hood' || f === 'mask' || f === 'visor' || f === 'hat');

  // A figure in the proportions of a person 1.75 m tall, scaled per walker: legs hinged at the hip.
  const HIP = 0.86;
  const leg = new THREE.BoxGeometry(0.13, HIP, 0.15).translate(0, -HIP / 2, 0);
  const torso = new THREE.CylinderGeometry(0.2, 0.17, 0.62, 7).scale(1, 1, 0.62).translate(0, HIP + 0.31, 0);
  const armL = new THREE.BoxGeometry(0.09, 0.58, 0.11).translate(-0.25, HIP + 0.3, 0);
  const armR = new THREE.BoxGeometry(0.09, 0.58, 0.11).translate(0.25, HIP + 0.3, 0);
  const body = mergeFlat([torso, armL, armR]);
  const skull = new THREE.IcosahedronGeometry(0.115 * head, 1).translate(0, HIP + 0.62 + 0.14 * head, 0);
  const geos = [leg, body, skull];
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const mesh = (g: THREE.BufferGeometry, name: string, shadow: boolean): THREE.InstancedMesh => {
    const im = new THREE.InstancedMesh(g, mat, count);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.name = name;
    im.frustumCulled = false;
    im.matrixAutoUpdate = false;
    im.castShadow = shadow;
    im.receiveShadow = false;
    group.add(im);
    return im;
  };
  const bodies = mesh(body, 'crowd:body', inp.quality === 2);
  const heads = mesh(skull, 'crowd:head', false);
  const legL = mesh(leg, 'crowd:leg', false);
  const legR = mesh(leg, 'crowd:leg', false);

  const rng = makeRng(inp.seed, 'crowd');
  const skin = colours(folk?.skin, ['#8a6248', '#c49a78', '#5e4130']);
  const cloth = colours(folk?.cloth, ['#4a4f58', '#6a5a4c', '#3c463f', '#7a6e62']);
  const trim = colours(folk?.trim, ['#2e2c2a', '#4a3f36']);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const shade = rng.range(0.75, 1.1);
    c.copy(rng.pick(cloth)).multiplyScalar(shade);
    bodies.setColorAt(i, c);
    // Hooded, masked or helmeted folk mostly show cloth where a face would be.
    if (covered && rng.chance(0.7)) c.multiplyScalar(0.8); else c.copy(rng.pick(skin));
    heads.setColorAt(i, c);
    c.copy(rng.chance(0.3) ? rng.pick(trim) : rng.pick(cloth)).multiplyScalar(0.6 * shade);
    legL.setColorAt(i, c);
    legR.setColorAt(i, c);
  }

  const NEAR = 14;
  const FAR = inp.quality === 0 ? 60 : 85;
  const P = grid ? grid.pitch : 0;
  const half = grid ? grid.street / 2 : 0;
  const wet = (x: number, z: number): boolean => (inp.waterDepthAt ? inp.waterDepthAt(x, z) > 0.1 : false);
  const inHole = (x: number, z: number): boolean => !!grid && x > grid.hole.minX + 0.5 && x < grid.hole.maxX - 0.5 && z > grid.hole.minZ + 0.5 && z < grid.hole.maxZ - 0.5;
  /** Whether the stretch of lattice street through (x, z) can be walked: a real street, on dry ground, where the place still stands. */
  const open = (x: number, z: number): boolean => !!grid && !inHole(x, z) && !wet(x, z) && fabricPresence(grid, inp.seed, x, z) > 0.3;

  const walkers: Walker[] = [];
  const blank = (): Walker => ({
    x: 0, z: 0, y: 0, dx: 1, dz: 0, speed: 0, lattice: false, axis: 0, line: 0, off: 0, tx: 0, tz: 0,
    phase: rng.range(0, 6.28), tall: k * rng.range(0.9, 1.08), wide: bulk * rng.range(0.88, 1.14), fade: 0, pause: 0,
  });

  /** A point of the place's own streets near `p`, between `lo` and `hi` metres from it. */
  const nearby = (p: { x: number; z: number }, lo: number, hi: number, r: Rng): { x: number; z: number } | null => {
    const n = inp.walkable.length;
    if (n === 0) return null;
    for (let t = 0; t < 24; t++) {
      const q = inp.walkable[r.int(0, n - 1)] as { x: number; z: number };
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= lo && d <= hi) return q;
    }
    return null;
  };

  function place(w: Walker, focus: { x: number; z: number }, first: boolean): boolean {
    const lo = first ? 7 : NEAR;
    // In a town or city most are out on the lattice once the walker has left the middle; in the middle, on its own streets.
    const inner = nearby(focus, lo, FAR * 0.8, rng);
    if (grid && (!inner || rng.chance(0.5))) {
      for (let t = 0; t < 12; t++) {
        const ang = rng.range(0, Math.PI * 2);
        const d = rng.range(lo, FAR);
        const px = focus.x + Math.cos(ang) * d;
        const pz = focus.z + Math.sin(ang) * d;
        const axis: 0 | 1 = rng.chance(0.5) ? 0 : 1;
        // Snapped onto the nearest street running along that axis.
        const line = axis === 0 ? grid.z0 + Math.round((pz - grid.z0) / P) * P : grid.x0 + Math.round((px - grid.x0) / P) * P;
        const x = axis === 0 ? px : line;
        const z = axis === 0 ? line : pz;
        if (!open(x, z) && !(axis === 0 ? onRing(x, z, 0) : onRing(x, z, 1))) continue;
        if (wet(x, z)) continue;
        w.lattice = true;
        w.axis = axis;
        w.line = line;
        // Most keep to the pavements; some cross in the roadway.
        w.off = (rng.chance(0.5) ? 1 : -1) * (rng.chance(0.75) ? half + rng.range(0.1, 0.9) : rng.range(0, half - 0.5));
        const dir = rng.chance(0.5) ? 1 : -1;
        w.dx = axis === 0 ? dir : 0;
        w.dz = axis === 0 ? 0 : dir;
        w.x = x + (axis === 0 ? 0 : w.off);
        w.z = z + (axis === 0 ? w.off : 0);
        w.speed = rng.range(0.9, 1.7);
        return true;
      }
    }
    if (!inner) return false;
    w.lattice = false;
    w.x = inner.x + rng.range(-1.2, 1.2);
    w.z = inner.z + rng.range(-1.2, 1.2);
    w.tx = w.x;
    w.tz = w.z;
    // One in four stands about: at a corner, by a door, in the square.
    w.speed = rng.chance(0.25) ? 0 : rng.range(0.8, 1.5);
    const a = rng.range(0, Math.PI * 2);
    w.dx = Math.cos(a);
    w.dz = Math.sin(a);
    return true;
  }

  /** True on the street that rings the named site: its centre lines are the hole's edges. */
  function onRing(x: number, z: number, axis: 0 | 1): boolean {
    if (!grid) return false;
    const h = grid.hole;
    return axis === 0
      ? (Math.abs(z - h.minZ) < 0.5 || Math.abs(z - h.maxZ) < 0.5) && x > h.minX - P && x < h.maxX + P
      : (Math.abs(x - h.minX) < 0.5 || Math.abs(x - h.maxX) < 0.5) && z > h.minZ - P && z < h.maxZ + P;
  }

  function step(w: Walker, dt: number): void {
    if (w.speed === 0) return;
    if (w.lattice && grid) {
      const before = w.axis === 0 ? w.x : w.z;
      const move = w.speed * dt * (w.axis === 0 ? w.dx : w.dz);
      const after = before + move;
      const origin = w.axis === 0 ? grid.x0 : grid.z0;
      // Crossing a street: carry straight on, or turn onto it.
      const c0 = Math.floor((before - origin) / P);
      const c1 = Math.floor((after - origin) / P);
      if (c0 !== c1) {
        const cross = origin + Math.max(c0, c1) * P;
        const dir = move > 0 ? 1 : -1;
        const ax = w.axis;
        const at = (a: 0 | 1, d: number): boolean => {
          // The middle of the next block's worth of street in that direction.
          const x = a === 0 ? (ax === 0 ? cross : w.line) + d * P * 0.5 : (ax === 0 ? cross : w.line);
          const z = a === 0 ? (ax === 0 ? w.line : cross) : (ax === 0 ? w.line : cross) + d * P * 0.5;
          return open(x, z) || onRing(x, z, a);
        };
        const other: 0 | 1 = ax === 0 ? 1 : 0;
        const ways: [0 | 1, number][] = [];
        if (at(ax, dir)) { ways.push([ax, dir], [ax, dir]); }
        if (at(other, 1)) ways.push([other, 1]);
        if (at(other, -1)) ways.push([other, -1]);
        const [na, nd] = ways.length > 0 ? rng.pick(ways) : [ax, -dir];
        if (na !== ax) {
          w.axis = na;
          w.line = cross;
          if (na === 0) { w.z = cross + w.off; w.dx = nd; w.dz = 0; } else { w.x = cross + w.off; w.dz = nd; w.dx = 0; }
          return;
        }
        if (nd !== dir) { w.dx = -w.dx; w.dz = -w.dz; return; }
      }
      if (w.axis === 0) w.x = after; else w.z = after;
      return;
    }
    // In the place: from one point of its streets to the next near one.
    const ddx = w.tx - w.x;
    const ddz = w.tz - w.z;
    const d = Math.hypot(ddx, ddz);
    if (d < 0.4) {
      if (w.pause > 0) { w.pause -= dt; return; }
      const next = nearby(w, 2, 9, rng);
      if (next) { w.tx = next.x + rng.range(-1, 1); w.tz = next.z + rng.range(-1, 1); }
      if (rng.chance(0.08)) w.pause = rng.range(1, 5);
      return;
    }
    w.dx = ddx / d;
    w.dz = ddz / d;
    w.x += w.dx * w.speed * dt;
    w.z += w.dz * w.speed * dt;
  }

  const m4 = new THREE.Matrix4();
  const sway = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const out = new Float32Array(count * 2);
  let started = false;
  let frame = 0;
  let disposed = false;

  return {
    group, count,
    update(dt: number, focus: { x: number; z: number }): void {
      if (disposed || !Number.isFinite(focus.x) || !Number.isFinite(focus.z)) return;
      if (!started) {
        started = true;
        for (let i = 0; i < count; i++) {
          const w = blank();
          w.fade = place(w, focus, true) ? 1 : -1;
          w.y = inp.heightAt(w.x, w.z);
          walkers.push(w);
        }
      }
      frame++;
      const t = Math.min(0.1, Math.max(0, dt));
      walkers.forEach((w, i) => {
        const far = Math.hypot(w.x - focus.x, w.z - focus.z);
        // Whoever is left behind, or has nowhere to stand, is set down again a few at a time.
        if ((far > FAR + 12 || w.fade < 0) && (i + frame) % 7 === 0) {
          w.fade = place(w, focus, false) ? 0 : -1;
          if (w.fade === 0) w.y = inp.heightAt(w.x, w.z);
        }
        if (w.fade < 0) {
          m4.makeScale(0, 0, 0);
          bodies.setMatrixAt(i, m4); heads.setMatrixAt(i, m4); legL.setMatrixAt(i, m4); legR.setMatrixAt(i, m4);
          return;
        }
        step(w, t);
        if (w.fade < 1) w.fade = Math.min(1, w.fade + t * 2);
        // The ground is read for a third of them each frame and eased to.
        if ((i + frame) % 3 === 0) w.y += (inp.heightAt(w.x, w.z) - w.y) * 0.6;
        const moving = w.speed > 0 && w.pause <= 0;
        if (moving) w.phase += t * w.speed * 3.4 / w.tall;
        const yaw = Math.atan2(w.dx, w.dz);
        const s = w.tall * w.fade;
        const bob = moving ? Math.abs(Math.sin(w.phase)) * 0.025 * s : 0;
        quat.setFromAxisAngle(UP, yaw);
        m4.compose(pos.set(w.x, w.y + bob, w.z), quat, scl.set(s * w.wide, s, s * w.wide));
        bodies.setMatrixAt(i, m4);
        heads.setMatrixAt(i, m4.compose(pos, quat, scl.set(s, s, s)));
        const swing = moving ? Math.sin(w.phase) * 0.5 : 0;
        for (const side of [-1, 1]) {
          // Hinged at the hip: out to the side, then swung fore or aft.
          m4.compose(pos.set(w.x, w.y + bob, w.z), quat, scl.set(s, s, s));
          m4.multiply(sway.makeTranslation(side * 0.09 * w.wide, HIP, 0)).multiply(sway.makeRotationX(side * swing));
          (side < 0 ? legL : legR).setMatrixAt(i, m4);
        }
        out[i * 2] = w.x;
        out[i * 2 + 1] = w.z;
      });
      for (const im of [bodies, heads, legL, legR]) im.instanceMatrix.needsUpdate = true;
    },
    positions: () => out,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const im of [bodies, heads, legL, legR]) im.dispose();
      for (const g of geos) g.dispose();
      mat.dispose();
      group.clear();
    },
  };
}

/** Several geometries as one, non-indexed, with position and normal only. */
function mergeFlat(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of list) {
    const f = g.index ? g.toNonIndexed() : g;
    pos.push(...(f.getAttribute('position').array as Float32Array));
    nor.push(...(f.getAttribute('normal').array as Float32Array));
    if (f !== g) f.dispose();
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
