// Wildlife and anything else that lives in a world besides its people. Each CreatureSpec becomes a few
// bodies (world/bodies.ts plans, drawn and animated by engine/bodies) driven by one small behaviour
// machine, or one instanced cloud for swarms. Bodies read their gait, banking and undulation from how
// this module moves their roots, so behaviour here is only "where to be and which way to face".
import * as THREE from 'three';
import type { CreatureBehaviour, CreatureSpec } from '../world/spec';
import { buildBody, restPositions } from '../world/bodies';
import type { BodyPlan } from '../world/bodies';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import { createBody } from './bodies/animate';
import type { BodyRig } from './bodies/animate';
import { bodyMaterial, buildBodyGeometry, glowMaterial } from './bodies/geometry';

export interface CreatureNav {
  nearest(p: THREE.Vector3): THREE.Vector3;
  randomPointNear(p: THREE.Vector3, r: number): THREE.Vector3;
}
export interface CreaturesOptions {
  creatures: CreatureSpec[];
  nav: CreatureNav;
  heightAt(x: number, z: number): number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  doors: Map<string, THREE.Vector3>;
  plaza: { x: number; z: number };
  water?: { kind: string; x: number; z: number; r: number }[];
  rng: Rng;
  quality?: 0 | 1 | 2;
}
export interface CreatureSighting { id: string; name: string; note: string; position: THREE.Vector3 }
export interface CreatureLight { pos: THREE.Vector3; color: string; radius: number }
export interface Creatures {
  update(dt: number, focus: THREE.Vector3, hour: number): void;
  nearest(focus: THREE.Vector3, maxDist: number): CreatureSighting | null;
  lights(): CreatureLight[];
  dispose(): void;
}

/** Bodies longer than this keep out of the built-up middle, and always cast shadows. */
export const LARGE_CREATURE_M = 6;
export const MAX_SWARM_UNITS = 200;
const BODY_CAP = [16, 32, 48] as const;
const SWARM_CAP = [80, 140, MAX_SWARM_UNITS] as const;
const MAX_LIGHTS = 4;

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const wrap = (a: number): number => {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  else if (x <= -Math.PI) x += TAU;
  return x;
};

type Medium = 'ground' | 'hover' | 'swim' | 'orbit' | 'perch';
type State = 'idle' | 'move' | 'flee' | 'sleep' | 'perched' | 'fly' | 'land';

interface Kind {
  spec: CreatureSpec;
  plan: BodyPlan;
  behaviour: CreatureBehaviour;
  medium: Medium;
  large: boolean;
  size: number;
  hx: number; hz: number;
  /** Annulus around the plaza that large ground bodies keep to. */
  rIn: number; rOut: number;
  /** Disc a swimmer keeps to, and the level of its surface. */
  wx: number; wz: number; wr: number; wy: number;
  comfort: number;
  walk: number; run: number; cruise: number;
  turn: number;
  lift: number;
  orbitR: number; orbitH: number; orbitBase: number; dir: 1 | -1;
  perches: Float32Array;
  stops: Float32Array;
}

interface Being {
  kind: Kind;
  rig: BodyRig;
  x: number; y: number; z: number; yaw: number; speed: number;
  hx: number; hz: number;
  tx: number; tz: number;
  state: State;
  timer: number;
  stuck: number;
  navT: number;
  seq: number;
  th: number; rScale: number; hScale: number; ph: number; ph2: number;
  lod: number; lodDt: number;
  dist: number;
}

interface Swarm {
  spec: CreatureSpec;
  mesh: THREE.InstancedMesh;
  glow: THREE.InstancedMesh | null;
  material: THREE.MeshStandardMaterial;
  flap: THREE.Vector4;
  n: number; groups: number;
  pos: Float32Array; vel: Float32Array;
  centres: Float32Array;
  hx: number; hz: number; hover: number; radius: number; vmax: number; follow: boolean; rate: number;
  hasGlow: boolean; size: number;
  mid: THREE.Vector3;
}

export function createCreatures(scene: THREE.Scene, opts: CreaturesOptions): Creatures {
  const { nav, heightAt, bounds, rng } = opts;
  const quality = opts.quality ?? 2;
  const group = new THREE.Group();
  group.name = 'creatures';
  scene.add(group);

  const tmp = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  const ONE = new THREE.Vector3(1, 1, 1);
  const px = opts.plaza.x, pz = opts.plaza.z;
  const maxR = Math.max(4, Math.min(bounds.maxX - px, px - bounds.minX, bounds.maxZ - pz, pz - bounds.minZ));
  let doorR = 0;
  const doorXZ: number[] = [];
  for (const d of opts.doors.values()) {
    doorR = Math.max(doorR, Math.hypot(d.x - px, d.z - pz));
    doorXZ.push(d.x, d.z);
  }
  const inX = (x: number, m: number): number => clamp(x, Math.min(px, bounds.minX + m), Math.max(px, bounds.maxX - m));
  const inZ = (z: number, m: number): number => clamp(z, Math.min(pz, bounds.minZ + m), Math.max(pz, bounds.maxZ - m));
  const snap = (x: number, z: number): THREE.Vector3 => nav.nearest(tmp.set(x, heightAt(x, z), z));

  /** A spot away from the doors, toward the edge of the playable land. */
  const wildSpot = (out: { x: number; z: number }): void => {
    let best = -1;
    for (let i = 0; i < 12; i++) {
      const a = rng.range(0, TAU), r = maxR * rng.range(0.55, 0.92);
      const x = inX(px + Math.cos(a) * r, 2), z = inZ(pz + Math.sin(a) * r, 2);
      let near = Infinity;
      for (let k = 0; k < doorXZ.length; k += 2) near = Math.min(near, Math.hypot(x - (doorXZ[k] ?? 0), z - (doorXZ[k + 1] ?? 0)));
      if (near > best) {
        best = near;
        out.x = x;
        out.z = z;
      }
    }
  };

  const kinds: Kind[] = [];
  const beings: Being[] = [];
  const swarms: Swarm[] = [];
  const specs = opts.creatures.filter((c) => c.count > 0 && c.size > 0);
  const bodyKinds = specs.filter((c) => c.family !== 'swarm').length;
  const perKind = Math.max(1, Math.ceil(BODY_CAP[quality] / Math.max(1, bodyKinds)));
  let swarmLeft: number = SWARM_CAP[quality];
  const spot = { x: 0, z: 0 };

  specs.forEach((spec, si) => {
    const seed = Math.floor(rng.next() * 0x7fffffff);
    const plan = buildBody(spec.family, spec.dials, spec.size, seed);
    const meta = plan.meta;
    const size = plan.size;
    const large = size > LARGE_CREATURE_M;
    const colors = { body: spec.body, accent: spec.accent, glow: spec.glow };

    // Home.
    const door = opts.doors.get(spec.haunt);
    const pond = opts.water !== undefined && opts.water.length > 0 ? opts.water[si % opts.water.length] : undefined;
    if (spec.haunt === 'plaza') {
      spot.x = px;
      spot.z = pz;
    } else if (door !== undefined) {
      spot.x = door.x;
      spot.z = door.z;
    } else if (spec.haunt === 'water' && pond !== undefined) {
      const a = rng.range(0, TAU);
      spot.x = inX(pond.x + Math.cos(a) * (pond.r + 2 + size), 1);
      spot.z = inZ(pond.z + Math.sin(a) * (pond.r + 2 + size), 1);
    } else if (spec.haunt === 'sky') {
      spot.x = px;
      spot.z = pz;
    } else wildSpot(spot);

    const edge = 2 + size * 0.3;
    const rOut = Math.max(1, maxR - edge);
    const rIn = Math.min(rOut, doorR > 0 ? doorR + 4 + size * 0.4 : size);
    const toRing = (): void => {
      const dx = spot.x - px, dz = spot.z - pz;
      const r = Math.hypot(dx, dz);
      const a = r > 0.01 ? Math.atan2(dz, dx) : rng.range(0, TAU);
      const rr = clamp(r, rIn, rOut);
      spot.x = px + Math.cos(a) * rr;
      spot.z = pz + Math.sin(a) * rr;
    };

    if (spec.family === 'swarm') {
      const groups = clamp(Math.round(spec.count), 1, 6);
      const n = Math.min(swarmLeft, Math.max(1, meta.units) * groups);
      if (n <= 0) return;
      swarmLeft -= n;
      const geo = buildBodyGeometry(plan, colors, quality === 2 ? 1 : 0, seed);
      const material = bodyMaterial(meta.pattern).clone();
      const rest = restPositions(plan);
      const pivot = rest[1] ?? [0, 0, 0];
      const flap = new THREE.Vector4(Math.abs(pivot[0]), pivot[1], plan.joints.length > 1 ? 0.95 : 0, 0);
      material.side = THREE.DoubleSide;
      material.customProgramCacheKey = () => 'swarm-flap';
      material.onBeforeCompile = (shader) => {
        // Joint 0 is the unit's body; anything skinned to a later joint is a wing and beats about its root.
        shader.uniforms['uFlap'] = { value: flap };
        shader.vertexShader = `attribute vec4 skinIndex;\nuniform vec4 uFlap;\n${shader.vertexShader}`.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          if (skinIndex.x > 0.5) {
            float sd = position.x >= 0.0 ? 1.0 : -1.0;
            float fa = sd * uFlap.z * sin(uFlap.w + float(gl_InstanceID) * 2.399);
            vec2 fp = transformed.xy - vec2(sd * uFlap.x, uFlap.y);
            float fc = cos(fa), fs = sin(fa);
            transformed.xy = vec2(fp.x * fc - fp.y * fs, fp.x * fs + fp.y * fc) + vec2(sd * uFlap.x, uFlap.y);
          }`,
        );
      };
      const mesh = new THREE.InstancedMesh(geo.main, material, n);
      mesh.name = `swarm_${spec.id}`;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      let glow: THREE.InstancedMesh | null = null;
      if (geo.glow !== null) {
        glow = new THREE.InstancedMesh(geo.glow, glowMaterial(spec.glow), n);
        glow.instanceMatrix = mesh.instanceMatrix;
        glow.frustumCulled = false;
      }
      const flying = meta.hover;
      const radius = 0.6 + size * 5 * Math.cbrt(n / groups);
      const s: Swarm = {
        spec, mesh, glow, material, flap, n, groups, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
        centres: new Float32Array(groups * 5), hx: spot.x, hz: spot.z, hover: spec.haunt === 'sky' ? Math.max(flying, 12) : flying,
        radius, vmax: clamp(meta.cruise, 1, 9), follow: spec.behaviour === 'stalk', rate: clamp(6 / Math.sqrt(Math.max(0.02, size)), 9, 38),
        hasGlow: meta.hasGlow || geo.glow !== null, size, mid: new THREE.Vector3(),
      };
      for (let g = 0; g < groups; g++) {
        s.centres[g * 5] = spot.x;
        s.centres[g * 5 + 1] = heightAt(spot.x, spot.z) + s.hover;
        s.centres[g * 5 + 2] = spot.z;
        s.centres[g * 5 + 3] = rng.range(0, TAU);
        s.centres[g * 5 + 4] = rng.range(0, TAU);
      }
      for (let i = 0; i < n; i++) {
        s.pos[i * 3] = spot.x + rng.range(-radius, radius);
        s.pos[i * 3 + 1] = heightAt(spot.x, spot.z) + s.hover + rng.range(-radius, radius) * 0.4;
        s.pos[i * 3 + 2] = spot.z + rng.range(-radius, radius);
        s.vel[i * 3] = rng.range(-1, 1);
        s.vel[i * 3 + 2] = rng.range(-1, 1);
      }
      group.add(mesh);
      if (glow !== null) group.add(glow);
      swarms.push(s);
      return;
    }

    const canFly = plan.wings.length > 0 && (spec.family === 'winged' || spec.family === 'bird');
    const floats = spec.family === 'floater';
    const swims = spec.family === 'swimmer';
    const aloft = spec.behaviour === 'circle' || spec.behaviour === 'flock' || spec.haunt === 'sky';
    let medium: Medium = 'ground';
    if (swims) medium = pond !== undefined ? 'swim' : 'orbit';
    else if (canFly && spec.behaviour === 'perch') medium = 'perch';
    else if ((canFly || floats) && aloft) medium = 'orbit';
    else if (floats) medium = 'hover';
    const grounded = medium === 'ground' || medium === 'hover' || medium === 'perch';
    if (large && grounded) toRing();

    const kind: Kind = {
      spec, plan, behaviour: spec.behaviour, medium, large, size, hx: spot.x, hz: spot.z, rIn, rOut,
      wx: pond?.x ?? 0, wz: pond?.z ?? 0, wr: pond !== undefined ? Math.max(0.5, pond.r * 0.8 - size * 0.4) : 0, wy: 0,
      comfort: 2 + size * 1.5,
      walk: Math.max(0.15, meta.walkSpeed * 0.8), run: Math.max(0.3, Math.min(meta.runSpeed, meta.walkSpeed * 2.7)), cruise: meta.cruise,
      turn: clamp(3 / Math.sqrt(Math.max(0.1, size)), 0.35, 4.5),
      lift: floats ? meta.hover : 0,
      orbitR: clamp(size * 4, 18, Math.max(18, Math.min(90, maxR * 1.1))), orbitH: floats ? meta.hover + size : clamp(size * 2.6, 10, 60),
      orbitBase: 0, dir: rng.chance(0.5) ? 1 : -1, perches: new Float32Array(0), stops: new Float32Array(0),
    };
    if (pond !== undefined && swims) {
      let lvl = Infinity;
      for (let i = 0; i < 8; i++) lvl = Math.min(lvl, heightAt(pond.x + Math.cos((i / 8) * TAU) * pond.r, pond.z + Math.sin((i / 8) * TAU) * pond.r));
      kind.wy = lvl - meta.height * 0.35;
    }
    if (medium === 'orbit') {
      if (swims) kind.orbitH = size * 1.5 + 4;
      let base = heightAt(spot.x, spot.z);
      for (let i = 0; i < 8; i++) base = Math.max(base, heightAt(spot.x + Math.cos((i / 8) * TAU) * kind.orbitR, spot.z + Math.sin((i / 8) * TAU) * kind.orbitR));
      kind.orbitBase = base;
    }
    if (medium === 'perch') {
      // High ground: the best of a scatter of candidates.
      const cand: { x: number; z: number; h: number }[] = [];
      for (let i = 0; i < 48; i++) {
        const a = rng.range(0, TAU), r = large ? rng.range(rIn, rOut) : rng.range(0.15, 0.95) * maxR;
        const x = inX(px + Math.cos(a) * r, edge), z = inZ(pz + Math.sin(a) * r, edge);
        cand.push({ x, z, h: heightAt(x, z) });
      }
      cand.sort((a, b) => b.h - a.h);
      const keep = cand.slice(0, 8);
      kind.perches = new Float32Array(keep.length * 2);
      keep.forEach((c, i) => {
        kind.perches[i * 2] = c.x;
        kind.perches[i * 2 + 1] = c.z;
      });
      kind.orbitR = clamp(size * 3, 9, 45);
      kind.orbitH = clamp(size * 2, 5, 36);
    }
    if (spec.behaviour === 'patrol' && doorXZ.length >= 4 && !large) {
      kind.stops = new Float32Array(doorXZ.length);
      for (let k = 0; k < doorXZ.length; k += 2) {
        const p = snap(doorXZ[k] ?? 0, doorXZ[k + 1] ?? 0);
        kind.stops[k] = p.x;
        kind.stops[k + 1] = p.z;
      }
    }
    kinds.push(kind);

    const count = Math.min(clamp(Math.round(spec.count), 1, 24), perKind, spec.family === 'colossus' ? 2 : large ? 3 : 24);
    const spread = clamp(3 + size * 2.5 + count, 5, 28);
    for (let i = 0; i < count; i++) {
      // Every member of a herd gets a body of its own: the same kind, a slightly different build and size.
      // The first keeps the kind's plan, which is the one the behaviour is tuned from.
      const own = seed + i * 7919;
      const body = i === 0 ? plan : buildBody(spec.family, spec.dials, spec.size * makeRng(own, 'stature').range(0.9, 1.08), own);
      const rig = createBody(body, colors, { quality, seed: own, shadows: large || (quality > 0 && size >= 0.7) });
      const b: Being = {
        kind, rig, x: spot.x, y: 0, z: spot.z, yaw: rng.range(-Math.PI, Math.PI), speed: 0, hx: spot.x, hz: spot.z, tx: spot.x, tz: spot.z,
        state: 'idle', timer: rng.range(0.5, 6), stuck: 0, navT: rng.range(0, 0.4), seq: i,
        th: count <= 3 || spec.behaviour !== 'flock' ? (i / count) * TAU + rng.range(-0.3, 0.3) : rng.range(0, 1.3),
        rScale: count > 1 ? rng.range(0.7, 1.2) : 1, hScale: count > 1 ? rng.range(0.8, 1.25) : 1, ph: rng.range(0, TAU), ph2: rng.range(0, TAU),
        lod: i % 3, lodDt: 0, dist: 0,
      };
      if (medium === 'ground' || medium === 'hover') {
        if (i > 0 || spec.haunt === 'wild') {
          if (large) {
            const a = Math.atan2(spot.z - pz, spot.x - px) + (i / count) * TAU, r = rng.range(rIn, rOut);
            b.x = inX(px + Math.cos(a) * r, edge);
            b.z = inZ(pz + Math.sin(a) * r, edge);
          } else {
            const p = nav.randomPointNear(tmp.set(spot.x, heightAt(spot.x, spot.z), spot.z), spread);
            b.x = inX(p.x, 0.3);
            b.z = inZ(p.z, 0.3);
          }
        }
        if (spec.behaviour === 'sleep' || spec.behaviour === 'guard') {
          b.hx = b.x;
          b.hz = b.z;
        }
        if (spec.behaviour === 'sleep') b.state = 'sleep';
        rig.setMode(floats ? 'hover' : b.state === 'sleep' ? 'sleep' : 'ground');
      } else if (medium === 'swim') {
        const a = rng.range(0, TAU), r = kind.wr * Math.sqrt(rng.next());
        b.x = kind.wx + Math.cos(a) * r;
        b.z = kind.wz + Math.sin(a) * r;
        rig.setMode('water');
      } else if (medium === 'perch') {
        const k = (i % Math.max(1, kind.perches.length / 2)) * 2;
        b.x = kind.perches[k] ?? spot.x;
        b.z = kind.perches[k + 1] ?? spot.z;
        b.state = 'perched';
        b.timer = rng.range(4, 30);
        rig.setMode('ground');
      } else {
        rig.setMode(swims ? 'water' : floats ? 'hover' : 'air');
        orbit(b, 0);
      }
      if (medium !== 'orbit') b.y = (medium === 'swim' ? kind.wy : heightAt(b.x, b.z) + kind.lift);
      rig.root.position.set(b.x, b.y, b.z);
      rig.root.rotation.y = b.yaw;
      group.add(rig.root);
      beings.push(b);
    }
  });

  // ---- Movement -----------------------------------------------------------------------------------

  /** Wide banking laps: the radius breathes, the height rises and falls, and the descent is a glide. */
  function orbit(b: Being, dt: number): void {
    const k = b.kind;
    const R = k.orbitR * b.rScale * (1 + 0.22 * Math.sin(0.5 * b.th + b.ph));
    const v = k.cruise * (k.medium === 'orbit' && k.plan.wings.length > 0 ? 0.75 : 0.45);
    b.th += (k.dir * v * dt) / Math.max(1, R);
    const R2 = k.orbitR * b.rScale * (1 + 0.22 * Math.sin(0.5 * b.th + b.ph));
    const x = k.hx + Math.cos(b.th) * R2, z = k.hz + Math.sin(b.th) * R2;
    const y = k.orbitBase + k.orbitH * b.hScale * (1 + 0.16 * Math.cos(0.5 * b.th + b.ph2));
    if (dt > 0) {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz > 1e-8) b.yaw = Math.atan2(dx, dz);
      b.speed = Math.hypot(dx, dz) / dt;
    } else b.yaw = Math.atan2(-Math.sin(b.th) * k.dir, Math.cos(b.th) * k.dir);
    b.x = x;
    b.y = y;
    b.z = z;
    b.rig.setGlide(k.dir * Math.sin(0.5 * b.th + b.ph2) > 0.25 ? 1 : 0);
  }

  /** Turn toward a point at a limited rate and walk along the heading; returns the distance left. */
  function steer(b: Being, tx: number, tz: number, want: number, dt: number, turnScale: number): number {
    const dx = tx - b.x, dz = tz - b.z;
    const dist = Math.hypot(dx, dz);
    const off = wrap(Math.atan2(dx, dz) - b.yaw);
    const maxTurn = b.kind.turn * turnScale * dt;
    b.yaw = wrap(b.yaw + clamp(off, -maxTurn, maxTurn));
    const sp = want * (Math.abs(off) > 1.2 ? 0.3 : Math.abs(off) > 0.5 ? 0.7 : 1);
    b.speed += (sp - b.speed) * (1 - Math.exp(-3 * dt));
    b.x += Math.sin(b.yaw) * b.speed * dt;
    b.z += Math.cos(b.yaw) * b.speed * dt;
    return dist;
  }

  function pickTarget(b: Being): void {
    const k = b.kind;
    if (k.medium === 'swim') {
      const a = rng.range(0, TAU), r = k.wr * Math.sqrt(rng.next());
      b.tx = k.wx + Math.cos(a) * r;
      b.tz = k.wz + Math.sin(a) * r;
    } else if (k.large) {
      // Along the ring, never across the middle.
      const a = Math.atan2(b.z - pz, b.x - px) + rng.range(0.15, 0.7) * (rng.chance(0.75) ? k.dir : -k.dir);
      const r = rng.range(k.rIn, k.rOut);
      b.tx = px + Math.cos(a) * r;
      b.tz = pz + Math.sin(a) * r;
    } else if (k.stops.length > 0) {
      const i = ((b.seq++ * 3 + 1) % (k.stops.length / 2)) * 2;
      b.tx = k.stops[i] ?? b.x;
      b.tz = k.stops[i + 1] ?? b.z;
    } else if (k.behaviour === 'circle') {
      const r = clamp(k.size * 3, 4, maxR * 0.6);
      const a = Math.atan2(b.z - b.hz, b.x - b.hx) + 0.7 * k.dir;
      const p = snap(b.hx + Math.cos(a) * r, b.hz + Math.sin(a) * r);
      b.tx = p.x;
      b.tz = p.z;
    } else {
      const herd = k.behaviour === 'flock' ? 0.5 : 1;
      const p = nav.randomPointNear(tmp.set(b.hx, heightAt(b.hx, b.hz), b.hz), clamp(6 + k.size * 5, 8, maxR * 0.7) * herd);
      b.tx = p.x;
      b.tz = p.z;
    }
    const m = Math.min(2, k.size * 0.3) + 0.3;
    b.tx = inX(b.tx, m);
    b.tz = inZ(b.tz, m);
    b.stuck = 0;
  }

  /** Walkers, floaters and swimmers: everything that keeps to a surface. */
  function surface(b: Being, dt: number, focus: THREE.Vector3, fd: number): void {
    const k = b.kind;
    const rig = b.rig;
    const beh = k.behaviour;
    const still = k.plan.meta.still > 0.8;
    const fx = focus.x, fz = focus.z;
    const arrive = Math.max(0.8, k.size * 0.6);
    const px0 = b.x, pz0 = b.z;
    rig.lookAt(fd < k.comfort * 3 + 4 && k.medium !== 'swim' ? focus : null);

    if (b.state === 'sleep') {
      b.speed = 0;
    } else if (still || beh === 'guard') {
      // Holds its ground and turns to face whoever comes near.
      b.speed += (0 - b.speed) * (1 - Math.exp(-4 * dt));
      if (fd < 10 + k.size * 2 && fd > 0.3 && !still) {
        const off = wrap(Math.atan2(fx - b.x, fz - b.z) - b.yaw);
        b.yaw = wrap(b.yaw + clamp(off, -k.turn * dt, k.turn * dt));
      }
    } else if (beh === 'stalk' && k.medium !== 'swim') {
      const keep = 7 + k.size * 3;
      const ax = b.x - fx, az = b.z - fz;
      const d = Math.max(0.01, Math.hypot(ax, az));
      if (d > keep * 1.35 || d < keep * 0.7) {
        const left = steer(b, inX(fx + (ax / d) * keep, 0.5), inZ(fz + (az / d) * keep, 0.5), d > keep * 2.5 ? k.run * 0.7 : k.walk, dt, 1);
        if (left < arrive) b.speed *= 0.5;
      } else {
        b.speed += (0 - b.speed) * (1 - Math.exp(-4 * dt));
        const off = wrap(Math.atan2(-ax, -az) - b.yaw);
        b.yaw = wrap(b.yaw + clamp(off, -k.turn * dt, k.turn * dt));
      }
    } else {
      // Roam, graze, patrol, herd, ground laps.
      const shy = !k.large && k.medium !== 'swim' && fd < k.comfort;
      if (shy && b.state !== 'flee') {
        const d = Math.max(0.01, fd);
        const p = k.medium === 'hover' ? tmp.set(b.x + ((b.x - fx) / d) * k.comfort * 2, 0, b.z + ((b.z - fz) / d) * k.comfort * 2)
          : snap(b.x + ((b.x - fx) / d) * k.comfort * 2, b.z + ((b.z - fz) / d) * k.comfort * 2);
        b.tx = inX(p.x, 0.5);
        b.tz = inZ(p.z, 0.5);
        b.state = 'flee';
        b.stuck = 0;
        rig.setGraze(false);
      }
      if (b.state === 'idle') {
        b.speed += (0 - b.speed) * (1 - Math.exp(-4 * dt));
        b.timer -= dt;
        if (b.timer <= 0) {
          pickTarget(b);
          b.state = 'move';
          rig.setGraze(false);
        }
      } else {
        const blocked = k.large && fd < k.size * 0.8 + 2;
        const want = blocked ? 0 : b.state === 'flee' ? k.run : k.medium === 'swim' ? k.cruise * 0.45 : k.walk;
        const left = steer(b, b.tx, b.tz, want, dt, 1);
        b.stuck += dt;
        if (left < arrive || b.stuck > 6 + left / Math.max(0.2, k.walk)) {
          b.state = 'idle';
          const grazing = beh === 'graze' || (beh === 'flock' && k.medium === 'ground');
          b.timer = k.medium === 'swim' ? 0 : grazing ? rng.range(4, 12) : beh === 'patrol' ? rng.range(2, 6) : rng.range(1, 7);
          rig.setGraze(grazing || (beh === 'roam' && rng.chance(0.3)));
        }
      }
    }

    // Keep to the land that can be walked: the ring for the large, the nav surface for the rest.
    const m = Math.min(2, k.size * 0.3);
    if (k.medium === 'swim') {
      const dx = b.x - k.wx, dz = b.z - k.wz;
      const d = Math.hypot(dx, dz);
      if (d > k.wr && d > 0) {
        b.x = k.wx + (dx / d) * k.wr;
        b.z = k.wz + (dz / d) * k.wr;
      }
    } else if (k.large) {
      const dx = b.x - px, dz = b.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < k.rIn && d > 0.001) {
        b.x = px + (dx / d) * k.rIn;
        b.z = pz + (dz / d) * k.rIn;
      }
    } else if (k.medium === 'ground' && b.speed > 0.01) {
      b.navT -= dt;
      if (b.navT <= 0) {
        b.navT = 0.3;
        const p = snap(b.x, b.z);
        if (Math.hypot(p.x - b.x, p.z - b.z) > 0.6) {
          // Off the walkable land: step back and choose somewhere else.
          b.x = px0;
          b.z = pz0;
          b.speed = 0;
          b.state = 'idle';
          b.timer = rng.range(0.3, 1.5);
        }
      }
    }
    b.x = inX(b.x, m);
    b.z = inZ(b.z, m);
    b.y = k.medium === 'swim' ? k.wy : heightAt(b.x, b.z) + k.lift * (b.state === 'sleep' ? 0.3 : 1);

    if (beh === 'sleep') rig.lookAt(fd < 6 + k.size * 2 ? focus : null);
  }

  /** Rests on high ground, takes off, flies a lap or two and comes down somewhere else. */
  function percher(b: Being, dt: number, focus: THREE.Vector3, fd: number, hour: number): void {
    const k = b.kind;
    const rig = b.rig;
    const land = Math.max(1.2, k.size * 0.5);
    if (b.state === 'perched') {
      b.speed = 0;
      b.timer -= dt;
      b.y += (heightAt(b.x, b.z) - b.y) * Math.min(1, dt * 6);
      rig.lookAt(fd < k.comfort * 4 ? focus : null);
      const night = hour < 5 || hour > 21;
      if ((b.timer <= 0 && !night) || (fd < k.comfort * 1.6 && b.timer < 26)) {
        b.state = 'fly';
        b.timer = rng.range(12, 30);
        b.hx = b.x;
        b.hz = b.z;
        b.speed = k.cruise * 0.3;
        rig.setMode('air');
        rig.setGlide(0);
        rig.lookAt(null);
      }
      return;
    }
    let alt: number;
    let near = 1;
    if (b.state === 'fly') {
      // Chase a point a little ahead on a circle around where it took off.
      const a = Math.atan2(b.z - b.hz, b.x - b.hx) + 0.9 * k.dir;
      steer(b, b.hx + Math.cos(a) * k.orbitR, b.hz + Math.sin(a) * k.orbitR, k.cruise * 0.7, dt, 1);
      alt = heightAt(b.hx, b.hz) + k.orbitH * b.hScale;
      b.timer -= dt;
      rig.setGlide(b.y > alt - 1 && Math.sin(b.th + b.timer * 0.5) > 0.2 ? 1 : 0);
      if (b.timer <= 0) {
        const i = rng.int(0, Math.max(0, k.perches.length / 2 - 1)) * 2;
        b.tx = k.perches[i] ?? b.hx;
        b.tz = k.perches[i + 1] ?? b.hz;
        b.state = 'land';
        b.timer = 28;
      }
    } else {
      const d0 = Math.hypot(b.tx - b.x, b.tz - b.z);
      near = clamp(d0 / (land * 6), 0, 1);
      const d = steer(b, b.tx, b.tz, k.cruise * (0.3 + 0.4 * near), dt, near < 1 ? 2.5 : 1);
      const gy = heightAt(b.tx, b.tz);
      alt = gy + Math.min(k.orbitH, Math.max(0, d - land) * 0.4);
      b.timer -= dt;
      rig.setGlide(near < 0.5 ? 0 : 1);
      if ((d < land && b.y - gy < k.size * 0.5 + 0.6) || b.timer <= 0) {
        if (b.timer <= 0 && d > land) {
          // Could not line up: settle toward the spot rather than circle forever.
          b.x += (b.tx - b.x) * Math.min(1, dt * 2);
          b.z += (b.tz - b.z) * Math.min(1, dt * 2);
          b.y += (gy - b.y) * Math.min(1, dt * 2);
          if (d > 0.5) return;
        }
        b.state = 'perched';
        b.timer = rng.range(10, 40);
        b.speed = 0;
        rig.setMode('ground');
        rig.setGlide(0);
        return;
      }
    }
    const rate = Math.max(1, b.speed) * 0.55;
    b.y += clamp(alt - b.y, -rate * dt, rate * dt);
    b.y = Math.max(b.y, heightAt(b.x, b.z) + 0.15 * near);
  }

  function swarm(s: Swarm, dt: number, t: number, focus: THREE.Vector3): void {
    if (s.follow) {
      s.hx += (focus.x - s.hx) * Math.min(1, dt * 0.25);
      s.hz += (focus.z - s.hz) * Math.min(1, dt * 0.25);
    }
    const wander = s.follow ? s.radius * 0.6 + 3 : s.radius * 1.5 + 6;
    for (let g = 0; g < s.groups; g++) {
      const a = s.centres[g * 5 + 3] ?? 0, c = s.centres[g * 5 + 4] ?? 0;
      const x = s.hx + Math.sin(t * 0.11 + a) * wander + Math.sin(t * 0.047 + c) * wander * 0.6;
      const z = s.hz + Math.sin(t * 0.083 + c) * wander + Math.cos(t * 0.039 + a) * wander * 0.6;
      s.centres[g * 5] = x;
      s.centres[g * 5 + 2] = z;
      s.centres[g * 5 + 1] = heightAt(x, z) + s.hover * (1 + 0.2 * Math.sin(t * 0.17 + a)) + s.radius * 0.3;
    }
    const { pos, vel, n } = s;
    const sep = Math.max(0.15, s.size * 1.6);
    const pull = 1.6 / Math.max(0.5, s.radius);
    const drag = Math.exp(-0.6 * dt);
    for (let i = 0; i < n; i++) {
      const g = (i % s.groups) * 5, o = i * 3;
      let x = pos[o] ?? 0, y = pos[o + 1] ?? 0, z = pos[o + 2] ?? 0;
      let vx = vel[o] ?? 0, vy = vel[o + 1] ?? 0, vz = vel[o + 2] ?? 0;
      const dx = (s.centres[g] ?? 0) - x, dy = (s.centres[g + 1] ?? 0) - y, dz = (s.centres[g + 2] ?? 0) - z;
      const d = Math.hypot(dx, dy, dz);
      const k = pull * s.vmax * (d > s.radius ? 2.5 : 1);
      // Toward the middle, around it, and a restless wobble of its own.
      vx += (dx * k - dz * 0.8 * pull * s.vmax + Math.sin(t * 1.7 + i * 2.1) * s.vmax * 1.4) * dt;
      vy += (dy * k * 1.5 + Math.sin(t * 2.3 + i * 1.3) * s.vmax * 0.9) * dt;
      vz += (dz * k + dx * 0.8 * pull * s.vmax + Math.cos(t * 1.3 + i * 3.7) * s.vmax * 1.4) * dt;
      for (let j = 1; j <= 7; j += 6) {
        const q = ((i + j) % n) * 3;
        const ex = x - (pos[q] ?? 0), ey = y - (pos[q + 1] ?? 0), ez = z - (pos[q + 2] ?? 0);
        const e2 = ex * ex + ey * ey + ez * ez;
        if (e2 < sep * sep && e2 > 1e-8) {
          const f = ((sep - Math.sqrt(e2)) / sep) * s.vmax * 4 * dt / Math.sqrt(e2);
          vx += ex * f;
          vy += ey * f;
          vz += ez * f;
        }
      }
      vx *= drag;
      vy *= drag;
      vz *= drag;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > s.vmax) {
        vx *= s.vmax / sp;
        vy *= s.vmax / sp;
        vz *= s.vmax / sp;
      }
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      vel[o] = vx;
      vel[o + 1] = vy;
      vel[o + 2] = vz;
      tmpE.set(-Math.atan2(vy, Math.max(0.2, Math.hypot(vx, vz))) * 0.6, Math.atan2(vx, vz), 0);
      tmpM.compose(tmp.set(x, y, z), tmpQ.setFromEuler(tmpE), ONE);
      s.mesh.setMatrixAt(i, tmpM);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
    s.flap.w = t * s.rate;
    s.mid.set(s.centres[0] ?? s.hx, s.centres[1] ?? 0, s.centres[2] ?? s.hz);
  }

  // ---- Lights and sightings -------------------------------------------------------------------------

  const lightPool: CreatureLight[] = [];
  for (let i = 0; i < MAX_LIGHTS; i++) lightPool.push({ pos: new THREE.Vector3(), color: '#ffffff', radius: 1 });
  const lightDist = new Float32Array(MAX_LIGHTS);
  const lightList: CreatureLight[] = [];
  let lightCount = 0;
  const offerLight = (x: number, y: number, z: number, d: number, color: string, radius: number): void => {
    let slot = lightCount;
    if (lightCount < MAX_LIGHTS) lightCount++;
    else {
      slot = 0;
      for (let i = 1; i < MAX_LIGHTS; i++) if ((lightDist[i] ?? 0) > (lightDist[slot] ?? 0)) slot = i;
      if (d >= (lightDist[slot] ?? 0)) return;
    }
    const l = lightPool[slot] as CreatureLight;
    l.pos.set(x, y, z);
    l.color = color;
    l.radius = radius;
    lightDist[slot] = d;
  };

  const sighting: CreatureSighting = { id: '', name: '', note: '', position: new THREE.Vector3() };
  let clock = 0;
  let frame = 0;
  let disposed = false;

  return {
    update(dt, focus, hour) {
      if (disposed) return;
      const h = Math.min(0.1, Math.max(0, dt));
      if (h <= 0) return;
      clock += h;
      frame++;
      lightCount = 0;
      for (let i = 0; i < beings.length; i++) {
        const b = beings[i] as Being;
        const k = b.kind;
        const fd = Math.hypot(b.x - focus.x, b.z - focus.z);
        b.dist = Math.hypot(fd, b.y - focus.y);
        if (k.medium === 'orbit') orbit(b, h);
        else if (k.medium === 'perch') percher(b, h, focus, fd, hour);
        else surface(b, h, focus, fd);
        b.rig.root.position.set(b.x, b.y, b.z);
        b.rig.root.rotation.y = b.yaw;
        // Bodies far from the viewer are posed every third frame.
        b.lodDt += h;
        if (b.dist < 45 + k.size * 8 || (frame + b.lod) % 3 === 0) {
          b.rig.update(b.lodDt);
          b.lodDt = 0;
        }
        if (k.plan.meta.hasGlow) offerLight(b.x, b.y + k.plan.meta.eyeHeight, b.z, b.dist, k.spec.glow, clamp(k.size * 1.5, 2, 14));
      }
      for (let i = 0; i < swarms.length; i++) {
        const s = swarms[i] as Swarm;
        swarm(s, h, clock, focus);
        if (s.hasGlow) offerLight(s.mid.x, s.mid.y, s.mid.z, s.mid.distanceTo(focus), s.spec.glow, clamp(s.radius * 1.5, 2, 10));
      }
    },
    nearest(focus, maxDist) {
      let best = maxDist;
      let found = false;
      for (let i = 0; i < beings.length; i++) {
        const b = beings[i] as Being;
        const d = Math.max(0, Math.hypot(b.x - focus.x, b.y - focus.y, b.z - focus.z) - b.kind.size * 0.5);
        if (d <= best) {
          best = d;
          found = true;
          sighting.id = b.kind.spec.id;
          sighting.name = b.kind.spec.name;
          sighting.note = b.kind.spec.note;
          sighting.position.set(b.x, b.y + b.kind.plan.meta.eyeHeight, b.z);
        }
      }
      for (let i = 0; i < swarms.length; i++) {
        const s = swarms[i] as Swarm;
        const d = Math.max(0, s.mid.distanceTo(focus) - s.radius);
        if (d <= best) {
          best = d;
          found = true;
          sighting.id = s.spec.id;
          sighting.name = s.spec.name;
          sighting.note = s.spec.note;
          sighting.position.copy(s.mid);
        }
      }
      return found ? sighting : null;
    },
    lights() {
      lightList.length = lightCount;
      for (let i = 0; i < lightCount; i++) lightList[i] = lightPool[i] as CreatureLight;
      return lightList;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const b of beings) b.rig.dispose();
      for (const s of swarms) {
        s.mesh.geometry.dispose();
        s.glow?.geometry.dispose();
        s.material.dispose();
        s.mesh.dispose();
        s.glow?.dispose();
      }
      beings.length = 0;
      swarms.length = 0;
      kinds.length = 0;
      group.removeFromParent();
    },
  };
}
