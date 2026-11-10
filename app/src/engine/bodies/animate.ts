// Builds a body plan as one skinned mesh and moves it with no clips: every pose is computed each frame
// from the joint roles. Speed, turn rate and climb are read from how the owner moves `root`, so feet
// step at the pace the body actually travels, wings bank into the turn actually flown, and a serpent's
// body follows the path its head actually took.
import { Bone, Box3, Group, Matrix4, Quaternion, Skeleton, SkinnedMesh, Sphere, Vector3 } from 'three';
import type { BodyLeg, BodyPlan } from '../../world/bodies';
import { GAIT_DUTY, gaitPhases } from '../../world/bodies';
import { makeRng } from '../../world/rng';
import { bodyMaterial, buildBodyGeometry, glowMaterial } from './geometry';
import type { BodyColors } from './geometry';

export type BodyMode = 'ground' | 'air' | 'water' | 'hover' | 'sleep' | 'sit';
export type BodyGesture = 'none' | 'wave' | 'cheer' | 'use' | 'gesture';

export interface BodyRig {
  /** Move and turn this; the body reads its motion from it. Heading is rotation.y, forward is +Z. */
  root: Group;
  plan: BodyPlan;
  setMode(mode: BodyMode): void;
  /** Flyers: 0 flaps, 1 holds the wings out. */
  setGlide(amount: number): void;
  /** Lowers the head to the ground while standing. */
  setGraze(on: boolean): void;
  setTalking(amount: number): void;
  setGesture(g: BodyGesture): void;
  lookAt(target: Vector3 | null): void;
  /** Current smoothed ground speed in m/s. */
  speed(): number;
  update(dt: number): void;
  dispose(): void;
}

export interface BodyOptions {
  quality?: 0 | 1 | 2;
  seed?: number;
  shadows?: boolean;
  /** Ease the visible body toward a heading that is set in jumps (people driven by a crowd simulation). */
  smoothTurn?: boolean;
}

const wrap = (a: number): number => {
  const two = Math.PI * 2;
  let x = a % two;
  if (x > Math.PI) x -= two;
  else if (x <= -Math.PI) x += two;
  return x;
};
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const frac = (x: number): number => x - Math.floor(x);

const UP = new Vector3(0, 1, 0);
const tmpV = new Vector3();
const tmpAxis = new Vector3();
const tmpQ = new Quaternion();
const IDENTITY = new Matrix4();

interface LegRT {
  leg: BodyLeg; hip: Bone; knee: Bone; foot: Bone;
  nx: number; nz: number;
  t1r: number; t2r: number; to0: number; tu0: number; fx0: number; fz0: number; psi0: number; bend: number;
  walk: number; trot: number; run: number;
  /** Fore-aft offset of the foot this frame, as a fraction of leg length; arms swing against it. */
  dz: number;
}

/** In-plane two-bone solve; the knee keeps to the side it rests on. */
function solveLeg(l: LegRT, dz: number, lift: number, drop: number, toe: number): void {
  const { l1, l2 } = l.leg;
  let to = l.to0 + dz;
  let yaw = 0;
  if (l.leg.splay) {
    const tz = l.fz0 + dz;
    yaw = wrap(Math.atan2(l.fx0, tz) - l.psi0);
    to = Math.hypot(l.fx0, tz);
  }
  const tu = l.tu0 + lift + drop;
  const d = clamp(Math.hypot(to, tu), Math.abs(l1 - l2) + 0.03 * (l1 + l2), (l1 + l2) * 0.999);
  const base = Math.atan2(tu, to);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const th1 = base + l.bend * a;
  const th2 = Math.atan2(d * Math.sin(base) - l1 * Math.sin(th1), d * Math.cos(base) - l1 * Math.cos(th1));
  tmpAxis.set(l.nx, 0, l.nz);
  l.hip.quaternion.setFromAxisAngle(UP, yaw).multiply(tmpQ.setFromAxisAngle(tmpAxis, wrap(th1 - l.t1r)));
  l.knee.quaternion.setFromAxisAngle(tmpAxis, wrap(th2 - th1 - (l.t2r - l.t1r)));
  l.foot.quaternion.setFromAxisAngle(tmpAxis, wrap(-(th2 - l.t2r)) * 0.9 - toe);
}

export function createBody(plan: BodyPlan, colors: BodyColors, opts: BodyOptions = {}): BodyRig {
  const quality = opts.quality ?? 2;
  const seed = opts.seed ?? 1;
  const rng = makeRng(seed, 'body-rig');
  const root = new Group();
  root.name = `body_${plan.family}`;
  const pose = new Group();
  pose.rotation.order = 'YXZ';
  root.add(pose);

  const bones = plan.joints.map((j) => {
    const b = new Bone();
    b.name = j.name;
    b.position.set(j.pos[0], j.pos[1], j.pos[2]);
    b.rotation.order = 'YXZ';
    return b;
  });
  plan.joints.forEach((j, i) => {
    const b = bones[i] as Bone;
    if (j.parent >= 0) (bones[j.parent] as Bone).add(b);
    else pose.add(b);
  });
  const bone = (i: number): Bone => bones[i] as Bone;
  pose.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  const geo = buildBodyGeometry(plan, colors, quality, seed);
  const sphere = geo.main.boundingSphere ?? new Sphere(new Vector3(), plan.size);
  const reach = sphere.radius * 1.8 + 0.2;
  const meshes: SkinnedMesh[] = [];
  const addMesh = (m: SkinnedMesh, shadows: boolean): void => {
    m.bind(skeleton, IDENTITY);
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.boundingSphere = new Sphere(sphere.center.clone(), reach);
    m.boundingBox = new Box3().setFromCenterAndSize(sphere.center, tmpV.set(reach * 2, reach * 2, reach * 2));
    pose.add(m);
    meshes.push(m);
  };
  addMesh(new SkinnedMesh(geo.main, bodyMaterial(plan.meta.pattern)), opts.shadows ?? true);
  if (geo.glow !== null) addMesh(new SkinnedMesh(geo.glow, glowMaterial(colors.glow)), false);

  const meta = plan.meta;
  const family = plan.family;
  const rootBone = bone(0);
  const restY = rootBone.position.y;
  const legLen = Math.max(0.01, meta.legLength);
  const biped = family === 'biped' || (family === 'colossus' && plan.arms.length > 0);
  const flyer = plan.wings.length > 0;

  // Legs: rest geometry in each leg's own plane.
  const nLegs = plan.legs.length;
  const pw = gaitPhases(nLegs, 'walk'), pt = gaitPhases(nLegs, 'trot'), pr = gaitPhases(nLegs, 'run');
  const pairs = Math.max(1, Math.round(nLegs / 2));
  const legs: LegRT[] = plan.legs.map((leg) => {
    const k = plan.joints[leg.knee]?.pos ?? [0, -1, 0];
    const f = plan.joints[leg.foot]?.pos ?? [0, -1, 0];
    const fx = k[0] + f[0], fz = k[2] + f[2];
    const h = Math.hypot(fx, fz);
    const ox = leg.splay ? fx / h : 0, oz = leg.splay ? fz / h : 1;
    const t1r = Math.atan2(k[1], k[0] * ox + k[2] * oz), t2r = Math.atan2(f[1], f[0] * ox + f[2] * oz);
    const to0 = fx * ox + fz * oz, tu0 = k[1] + f[1];
    const off = wrap(t1r - Math.atan2(tu0, to0));
    const idx = Math.min(pairs - 1, leg.pair) * 2 + (leg.side > 0 ? 0 : 1);
    return {
      leg, hip: bone(leg.hip), knee: bone(leg.knee), foot: bone(leg.foot), nx: -oz, nz: ox,
      t1r, t2r, to0, tu0, fx0: fx, fz0: fz, psi0: Math.atan2(fx, fz), bend: off < -0.02 ? -1 : 1,
      walk: pw[idx] ?? 0, trot: pt[idx] ?? 0, run: pr[idx] ?? 0, dz: 0,
    };
  });

  const chainsOf = (kind: string): Bone[][] => plan.chains.filter((c) => c.kind === kind).map((c) => c.joints.map(bone));
  const spine = chainsOf('spine')[0] ?? [];
  const neck = chainsOf('neck')[0] ?? [];
  const tails = chainsOf('tail');
  const tentacles = chainsOf('tentacle');
  const head = plan.head > 0 ? bone(plan.head) : null;
  const jaw = plan.jaw > 0 ? bone(plan.jaw) : null;
  const fins = plan.fins.map((i) => ({ b: bone(i), side: plan.joints[i]?.side ?? 1 }));
  const wings = plan.wings.map((w) => ({ root: bone(w.root), mid: bone(w.mid), tip: bone(w.tip), side: w.side }));
  const arms = plan.arms.map((a) => ({ sh: bone(a.shoulder), el: bone(a.elbow), hand: bone(a.hand), side: a.side }));
  const tailSprings = new Float32Array(8 * 2);
  const flapHz = clamp(2.6 / Math.sqrt(Math.max(0.05, meta.wingspan)), 0.42, 8);

  // Serpents keep a trail of where the head has been, one sample every half link.
  const snake = family === 'serpent' && spine.length > 2;
  const link = snake ? meta.length / (spine.length + 1) : 1;
  const TRAIL = snake ? spine.length * 2 + 8 : 0;
  const trail = new Float32Array(TRAIL * 2);
  let trailHead = 0;
  let trailRem = 0;
  let trailReady = false;

  const phase = rng.range(0, Math.PI * 2);
  const phase2 = rng.range(0, Math.PI * 2);
  let mode: BodyMode = flyer || nLegs > 0 || snake ? 'ground' : family === 'swimmer' ? 'water' : 'hover';
  let glideWant = 0;
  let graze = false;
  let talkWant = 0;
  let gesture: BodyGesture = 'none';
  let lookTarget: Vector3 | null = null;
  let disposed = false;

  let clock = 0;
  let started = false;
  const last = new Vector3();
  let lastYaw = 0;
  let visYaw = 0;
  let speed = 0;
  let vy = 0;
  let yawRate = 0;
  let cycle = rng.next();
  let flap = phase;
  // Blends, each eased toward its target.
  let air = 0, crouch = 0, sit = 0, fold = flyer ? 1 : 0, glide = 0, grazeK = 0, talk = 0, gest = 0, alert = 0;
  let lookYaw = 0, lookPitch = 0, bank = 0, pitch = 0, lean = 0;
  let wWalk = 1, wTrot = 0, wRun = 0;

  const sampleTrail = (dist: number, out: Vector3): Vector3 => {
    // Point `dist` back along the path from the head's current position.
    const cx = root.position.x, cz = root.position.z;
    if (dist <= trailRem || TRAIL === 0) {
      const i = trailHead * 2;
      const t = trailRem > 1e-6 ? dist / trailRem : 0;
      return out.set(cx + ((trail[i] ?? cx) - cx) * t, 0, cz + ((trail[i + 1] ?? cz) - cz) * t);
    }
    const f = (dist - trailRem) / (link * 0.5);
    const k = Math.min(TRAIL - 2, Math.floor(f));
    const a = ((trailHead - k + TRAIL * 4) % TRAIL) * 2, b = ((trailHead - k - 1 + TRAIL * 4) % TRAIL) * 2;
    const t = Math.min(1, f - k);
    const ax = trail[a] ?? cx, az = trail[a + 1] ?? cz;
    return out.set(ax + ((trail[b] ?? ax) - ax) * t, 0, az + ((trail[b + 1] ?? az) - az) * t);
  };

  const rig: BodyRig = {
    root,
    plan,
    setMode(m) {
      mode = m;
    },
    setGlide(a) {
      glideWant = clamp(a, 0, 1);
    },
    setGraze(on) {
      graze = on;
    },
    setTalking(a) {
      talkWant = Number.isFinite(a) ? clamp(a, 0, 1) : 0;
    },
    setGesture(g) {
      gesture = g;
    },
    lookAt(target) {
      if (target === null) lookTarget = null;
      else if (lookTarget === null) lookTarget = target.clone();
      else lookTarget.copy(target);
    },
    speed: () => speed,
    update(dt) {
      if (disposed) return;
      const h = Math.min(0.1, Math.max(0, dt));
      if (h <= 0) return;
      clock += h;
      const t = clock;

      // ---- Motion read from the root ----
      if (!started) {
        started = true;
        last.copy(root.position);
        lastYaw = root.rotation.y;
        visYaw = lastYaw;
      }
      const dx = root.position.x - last.x, dy = root.position.y - last.y, dzw = root.position.z - last.z;
      last.copy(root.position);
      const step = Math.hypot(dx, dzw);
      const teleport = step > Math.max(3, plan.size * 2);
      const ease6 = 1 - Math.exp(-6 * h);
      speed += ((teleport ? 0 : step / h) - speed) * ease6;
      vy += ((teleport ? 0 : dy / h) - vy) * ease6;
      let heading = root.rotation.y;
      if (opts.smoothTurn === true) {
        visYaw = wrap(visYaw + wrap(heading - visYaw) * (1 - Math.exp(-10 * h)));
        heading = visYaw;
      }
      yawRate += (wrap(heading - lastYaw) / h - yawRate) * ease6;
      lastYaw = heading;

      const e = (rate: number): number => 1 - Math.exp(-rate * h);
      const flying = mode === 'air';
      air += ((flying ? 1 : 0) - air) * e(3);
      crouch += ((mode === 'sleep' ? 1 : 0) - crouch) * e(1.6);
      sit += ((mode === 'sit' ? 1 : 0) - sit) * e(4);
      fold += ((flying ? 0 : 1) - fold) * e(flying ? 5 : 2.2);
      glide += (glideWant - glide) * e(2.2);
      grazeK += ((graze && mode === 'ground' && speed < meta.walkSpeed * 0.3 ? 1 : 0) - grazeK) * e(2);
      talk += (talkWant - talk) * e(9);
      gest += ((gesture === 'none' ? 0 : 1) - gest) * e(7);
      alert += ((lookTarget !== null ? 1 : 0) - alert) * e(3);
      const awake = 1 - crouch * (1 - alert);

      // ---- Gait ----
      const ratio = speed / Math.max(0.05, meta.walkSpeed);
      const wr = sstep(2.3, 3, ratio), wt = sstep(1.5, 1.9, ratio) * (1 - wr);
      wRun += (wr - wRun) * e(5);
      wTrot += (wt - wTrot) * e(5);
      wWalk = 1 - wRun - wTrot;
      const duty = GAIT_DUTY.walk * wWalk + GAIT_DUTY.trot * wTrot + GAIT_DUTY.run * wRun;
      const turnStep = Math.abs(yawRate) * meta.length * 0.25;
      const moveSpeed = speed + (nLegs > 0 ? turnStep : 0);
      const amp = sstep(0.04, 0.3, moveSpeed / Math.max(0.05, meta.walkSpeed)) * (1 - meta.still) * (1 - air) * (1 - crouch) * (1 - sit);
      const stride = legLen * (1.35 + 0.42 * Math.min(4, ratio));
      if (amp > 0.001) cycle = frac(cycle + (moveSpeed / stride) * h);
      const stepLen = Math.min(duty * stride, legLen * 1.5) * amp;
      const bobbing = nLegs > 0 ? -Math.cos(cycle * Math.PI * (nLegs === 2 ? 4 : 2 * pairs)) * 0.022 * legLen * amp * (1 + wRun * 2) : 0;
      const breathe = Math.sin(t * (1.5 - crouch * 0.7) + phase);
      const drop = crouch * meta.clearance * 0.94 + sit * legLen * (biped ? 0.46 : 0.3) - bobbing;
      rootBone.position.y = restY - drop;

      for (const l of legs) {
        const p = frac(cycle + l.walk * wWalk + l.trot * wTrot + l.run * wRun);
        let dz: number;
        let lift = 0;
        if (p < duty) dz = 0.5 - p / duty;
        else {
          const u = (p - duty) / (1 - duty);
          dz = -0.5 + sstep(0, 1, u);
          lift = Math.sin(Math.PI * u);
        }
        l.dz = dz * amp;
        const tuckUp = air * (l.leg.l1 + l.leg.l2) * 0.32;
        const lz = dz * stepLen - air * (l.leg.l1 + l.leg.l2) * 0.3 + sit * (biped ? l.leg.l1 * 0.95 : 0);
        solveLeg(l, lz, lift * legLen * (0.1 + 0.1 * wRun) * amp + tuckUp, drop, lift * 0.35 * amp * (l.leg.splay ? 0 : 1));
      }

      // ---- Body attitude ----
      const g = 9.81;
      const bankWant = flying ? -clamp(Math.atan((speed * yawRate) / g), -0.95, 0.95) : -clamp(yawRate * 0.03 * Math.min(1, speed / 2), -0.12, 0.12);
      bank += (bankWant - bank) * e(flying ? 2.5 : 7);
      const pitchWant = air > 0.3 ? -clamp(Math.atan2(vy, Math.max(1, speed)) * 0.7, -0.6, 0.6) : 0;
      pitch += (pitchWant - pitch) * e(3);
      lean += ((biped ? clamp(0.018 * speed + wRun * 0.1, 0, 0.24) : 0) - lean) * e(6);
      const hover = mode === 'hover' || mode === 'water' ? Math.sin(t * 1.1 + phase) * 0.05 * meta.height : 0;
      const flapAmp = (1 - glide) * air;
      flap += Math.PI * 2 * flapHz * (1 + clamp(vy * 0.05, -0.2, 0.4)) * h;
      const heave = flyer ? -Math.sin(flap - 0.5) * 0.045 * meta.wingspan * flapAmp : 0;
      pose.rotation.set(pitch + lean, opts.smoothTurn === true ? wrap(visYaw - root.rotation.y) : 0, bank, 'YXZ');
      pose.position.y = hover + heave;
      pose.scale.y = 1 + crouch * 0.018 * breathe;

      // ---- Look ----
      let wantYaw = 0, wantPitch = 0;
      if (lookTarget !== null && head !== null) {
        root.updateWorldMatrix(true, false);
        tmpV.copy(lookTarget);
        root.worldToLocal(tmpV);
        const flat = Math.hypot(tmpV.x, tmpV.z);
        if (flat > 0.05) {
          const rel = wrap(Math.atan2(tmpV.x, tmpV.z) - pose.rotation.y);
          const lim = 0.9 + 0.3 * neck.length;
          if (Math.abs(rel) < 2.5) {
            wantYaw = clamp(rel, -lim, lim);
            wantPitch = clamp(-Math.atan2(tmpV.y - meta.eyeHeight, flat), -0.6, 0.6);
          }
        }
      } else if (crouch < 0.5) {
        // Unprompted glances: slow, irregular, small.
        wantYaw = 0.28 * Math.sin(t * 0.31 + phase) * Math.sin(t * 0.13 + phase2) * (1 - Math.min(1, ratio));
      }
      lookYaw += (wantYaw - lookYaw) * e(5);
      lookPitch += (wantPitch - lookPitch) * e(5);
      const sleepHead = crouch * (1 - alert);
      const nodWalk = !biped && nLegs === 4 ? Math.sin(cycle * Math.PI * 4) * 0.035 * amp : 0;
      const neckN = neck.length;
      const share = neckN > 0 ? 0.6 / neckN : 0;
      const neckPitch = grazeK * (biped ? 0 : 1.25) + sleepHead * 0.75 + air * 0.5 + nodWalk;
      for (const b of neck) b.rotation.set(lookPitch * share + neckPitch / Math.max(1, neckN), lookYaw * share + (sleepHead * 1.5) / Math.max(1, neckN), 0);
      if (head !== null) {
        const nod = talk * (0.07 * Math.sin(t * 11 + phase) * (0.55 + 0.45 * Math.sin(t * 2.2 + phase2)) + 0.03 * Math.sin(t * 5.3 + phase2));
        const own = neckN > 0 ? 0.4 : 1;
        head.rotation.set(lookPitch * own - grazeK * 0.3 - air * 0.4 + nod + sleepHead * (biped ? 0.5 : 0.1), lookYaw * own + talk * 0.05 * Math.sin(t * 3.7 + phase), talk * 0.04 * Math.sin(t * 2.9 + phase2));
      }
      if (jaw !== null) jaw.rotation.x = 0.02 + 0.12 * alert * (0.5 + 0.5 * Math.sin(t * 0.9 + phase)) * (biped ? 0 : 1) + talk * 0.2 * Math.abs(Math.sin(t * 9 + phase));

      // ---- Spine ----
      if (snake) {
        // Lay the links along the trail the head left behind.
        if (!trailReady || teleport) {
          trailReady = true;
          for (let i = 0; i < TRAIL; i++) {
            const d = (i + 1) * link * 0.5;
            const k = ((trailHead - i + TRAIL * 4) % TRAIL) * 2;
            trail[k] = root.position.x - Math.sin(root.rotation.y) * d;
            trail[k + 1] = root.position.z - Math.cos(root.rotation.y) * d;
          }
          trailRem = link * 0.5;
        }
        trailRem += step;
        while (trailRem >= link * 0.5) {
          // Drop a sample half a link behind the head, on the line back to the previous one.
          trailRem -= link * 0.5;
          const pi = trailHead * 2;
          const px = trail[pi] ?? 0, pz = trail[pi + 1] ?? 0;
          const back = Math.hypot(root.position.x - px, root.position.z - pz);
          const f = back > 1e-6 ? Math.max(0, 1 - trailRem / back) : 1;
          trailHead = (trailHead + 1) % TRAIL;
          trail[trailHead * 2] = px + (root.position.x - px) * f;
          trail[trailHead * 2 + 1] = pz + (root.position.z - pz) * f;
        }
        const slither = 0.1 + 0.28 * Math.min(1, speed / Math.max(0.05, meta.cruise * 0.3));
        let prev = 0;
        const n = spine.length;
        for (let c = 0; c < n; c++) {
          const a = sampleTrail((c + 1) * link, tmpV);
          const ax = a.x, az = a.z;
          const b = sampleTrail((c + 2) * link, tmpV);
          let local = wrap(Math.atan2(ax - b.x, az - b.z) - root.rotation.y);
          local += slither * Math.min(1, (c + 1) / 4) * Math.sin(c * 0.85 - t * (1.5 + speed * 1.2) + phase) * (1 - crouch);
          local = local * (1 - crouch) + crouch * (c + 1) * 0.42;
          const bend = clamp(wrap(local - prev), -0.85, 0.85);
          prev = wrap(prev + bend);
          (spine[c] as Bone).rotation.set(meta.humps * 0.55 * Math.sin(c * 1.1 - t * 1.4 + phase) * (1 - crouch), bend, 0);
        }
        pose.position.y += meta.humps * link * 0.6;
      } else if (family === 'swimmer') {
        const beat = t * (2.2 + (speed / Math.max(0.2, meta.length)) * 2.4) + phase;
        for (let c = 0; c < spine.length; c++) {
          const w = (0.07 + 0.055 * c) * Math.sin(beat - c * 0.9) - clamp(yawRate * 0.12, -0.25, 0.25) * (meta.fluke > 0 ? 0 : 1);
          (spine[c] as Bone).rotation.set(meta.fluke > 0 ? w : 0, meta.fluke > 0 ? -clamp(yawRate * 0.12, -0.25, 0.25) : w, 0);
        }
      } else if (biped) {
        const sway = Math.sin(t * 0.43 + phase2) + 0.4 * Math.sin(t * 0.97 + phase);
        const standing = (1 - amp) * (1 - sit);
        const twist = Math.sin(cycle * Math.PI * 2 + 1.2) * 0.1 * amp;
        rootBone.rotation.set(0, twist, standing * 0.025 * sway + Math.sin(cycle * Math.PI * 2) * 0.03 * amp);
        const s0 = spine[0], s1 = spine[1];
        if (s0 !== undefined) s0.rotation.set(sit * 0.06 - 0.01 * breathe + wRun * 0.08, -twist * 0.8 + lookYaw * 0.15, -standing * 0.03 * sway);
        if (s1 !== undefined) s1.rotation.set(talk * 0.02 * Math.sin(t * 6.5 + phase) - 0.012 * breathe + sleepHead * 0.35, -twist * 0.9 + lookYaw * 0.2, -Math.sin(cycle * Math.PI * 2) * 0.03 * amp);
      } else {
        const flex = Math.sin(cycle * Math.PI * 2) * 0.13 * wRun * amp;
        rootBone.rotation.set(-flex * 0.5, 0, Math.sin(cycle * Math.PI * 2) * 0.025 * amp);
        for (const b of spine) b.rotation.set(flex + 0.01 * breathe, Math.sin(cycle * Math.PI * 2 + 0.6) * 0.045 * amp * wWalk, 0);
      }

      // ---- Tails: a chain of lagging springs, plus sway and the sleeping curl ----
      const curl = family === 'quadruped' || family === 'winged' || biped ? crouch : 0;
      const lag = clamp(-yawRate * 0.22, -0.5, 0.5);
      for (let ti = 0; ti < tails.length; ti++) {
        const chain = tails[ti] as Bone[];
        let follow = lag;
        const n = chain.length;
        for (let c = 0; c < n && c < 8; c++) {
          const x = tailSprings[c * 2] ?? 0;
          let v = tailSprings[c * 2 + 1] ?? 0;
          const om = 7 - c * 0.5;
          v += (om * om * (follow - x) - 2 * om * 0.8 * v) * h;
          const nx = x + v * h;
          tailSprings[c * 2] = nx;
          tailSprings[c * 2 + 1] = v;
          follow = nx;
          const swayA = family === 'crawler' ? 0.03 : 0.07 + 0.05 * amp;
          const sway = swayA * Math.sin(t * (0.9 + amp * 3) - c * 0.8 + phase2) * awake;
          (chain[c] as Bone).rotation.set(curl * 0.12 - wRun * 0.06 * amp - air * 0.1, nx * (2.2 / n) + sway - curl * 0.55, 0);
        }
      }

      // ---- Wings ----
      for (const w of wings) {
        const s = w.side;
        const A = (0.62 - 0.15 * Math.min(1, meta.wingspan / 12)) * flapAmp;
        const up = A * Math.sin(flap) + 0.1 + glide * 0.07 * Math.sin(t * 0.7 + phase);
        const rise = Math.max(0, Math.cos(flap)) * flapAmp;
        const open = 1 - fold;
        w.root.rotation.set(0, s * fold * 1.2, s * (up * open + fold * 0.3));
        w.mid.rotation.set(0, s * (0.38 * rise * open - fold * 2.35), s * 0.5 * A * Math.sin(flap - 0.9) * open);
        w.tip.rotation.set(0, s * (0.3 * Math.max(0, Math.cos(flap - 0.5)) * flapAmp * open + fold * 2.4), s * 0.45 * A * Math.sin(flap - 1.6) * open);
      }

      // ---- Arms ----
      const lDz = legs[0]?.dz ?? 0, rDz = legs[1]?.dz ?? 0;
      for (const a of arms) {
        const s = a.side;
        if (!biped) {
          // Pincers: held ready, opening toward whatever is being watched.
          a.sh.rotation.set(-0.25 * alert, s * (0.12 * Math.sin(t * 0.8 + phase + s) - 0.2 * alert), 0);
          a.el.rotation.set(0, s * 0.1 * Math.sin(t * 1.1 + phase2), 0);
          continue;
        }
        const swing = (s > 0 ? rDz : lDz) * (0.75 + wRun * 0.5);
        const phrase = 0.55 + 0.45 * Math.sin(t * 2.2 + phase2);
        const beat = Math.sin(t * 6.5 + phase + (s > 0 ? 2.1 : 0));
        const lead = s < 0 ? 1 : 0.45;
        let sx = -swing + sit * -0.4 - talk * 0.22 * lead;
        let sz = s * (0.07 + 0.02 * breathe);
        let ex = -(0.12 + wRun * 1.25 * amp + Math.max(0, swing) * 0.5) - sit * 0.75 - talk * lead * (0.55 + 0.3 * phrase * beat);
        let ez = 0;
        if (gest > 0.01) {
          const lead2 = s < 0 ? 1 : 0;
          if (gesture === 'wave' && lead2 > 0) {
            sz += s * 2.45 * gest;
            ex = ex * (1 - gest) - 0.5 * gest;
            ez = -s * 0.45 * Math.sin(t * 9) * gest;
          } else if (gesture === 'cheer') {
            sz += s * (2.6 + 0.12 * Math.sin(t * 8 + s)) * gest;
            ex = ex * (1 - gest) - 0.3 * gest;
          } else if ((gesture === 'use' || gesture === 'gesture') && lead2 > 0) {
            sx = sx * (1 - gest) - (1.05 + 0.12 * Math.sin(t * 3.1)) * gest;
            ex = ex * (1 - gest) - (0.55 + 0.25 * Math.sin(t * 4.3 + 1)) * gest;
          }
        }
        a.sh.rotation.set(sx, 0, sz);
        a.el.rotation.set(ex, 0, ez);
      }

      // ---- Tentacles and fins ----
      const trailBack = Math.min(0.5, speed * 0.14);
      for (let ti = 0; ti < tentacles.length; ti++) {
        const chain = tentacles[ti] as Bone[];
        for (let c = 0; c < chain.length; c++) {
          (chain[c] as Bone).rotation.set(0.2 * Math.sin(t * 1.6 - c * 0.9 + ti * 1.7 + phase) + trailBack / 2, 0, 0.18 * Math.sin(t * 1.25 - c * 0.8 + ti * 2.3 + phase2));
        }
      }
      if (family === 'floater' && tentacles.length > 0) {
        const pulse = Math.sin(t * 2.1 + phase);
        rootBone.scale.set(1 - 0.05 * pulse, 1 + 0.07 * pulse, 1 - 0.05 * pulse);
      }
      for (const f of fins) f.b.rotation.set(0, 0, f.side * (0.1 + 0.32 * Math.sin(t * (1.4 + speed * 0.5) + phase)));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      geo.main.dispose();
      geo.glow?.dispose();
      skeleton.dispose();
      lookTarget = null;
    },
  };
  // Settle into a valid pose now; motion tracking starts on the owner's first update, after it has placed the root.
  rig.update(1 / 60);
  started = false;
  trailReady = false;
  return rig;
}
