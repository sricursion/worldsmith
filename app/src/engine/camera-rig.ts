// Camera rig: over-the-shoulder third person and first person on one spring-damped follow, with wall collision,
// step-synced head motion, a sprint kick and a two-shot framing mode for conversations. No DOM access here.
import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

// Look
/** Radians of view rotation per pixel of pointer travel. */
export const LOOK_SENSITIVITY = 0.0023;
/** Time constant of the look low-pass in seconds; 0 applies pointer travel raw. */
export const LOOK_SMOOTH_TIME = 0.035;

// Third person
export const TP_BOOM = 3.2;
export const TP_BOOM_MIN = 1.8;
export const TP_BOOM_MAX = 7;
export const TP_PIVOT_HEIGHT = 1.55;
export const TP_SHOULDER = 0.55;
export const TP_FOV = 62;
const TP_PITCH_DEFAULT = 0.12;
const TP_PITCH_MIN = -0.8; // looking up at rooflines
const TP_PITCH_MAX = 1.2;
const TP_SPRINT_FOV_KICK = 5;
const TP_SWAY = 0.4; // share of the first-person bob that reaches the third-person camera while sprinting
const ZOOM_STEP = 0.6;
const ZOOM_OMEGA = 12;

// First person
export const FP_EYE_HEIGHT = 1.62;
export const FP_FOV = 72;
const FP_PITCH_LIMIT = 1.45;
const FP_SPRINT_FOV_KICK = 7;
const BOB_Y_WALK = 0.032;
const BOB_Y_RUN = 0.058;
const BOB_X_WALK = 0.018;
const BOB_X_RUN = 0.034;
const BOB_ROLL_WALK = 0.005;
const BOB_ROLL_RUN = 0.011;
const BOB_FULL_SPEED = 2; // m/s at which the bob reaches full walking amplitude
const LEAN_MAX = 0.02; // roll into a strafe, radians at LEAN_SPEED
const LEAN_SPEED = 5;

// Follow
const FOLLOW_OMEGA = 10;
const FOLLOW_OMEGA_Y = 7;
const FOLLOW_MAX_OFFSET = 0.9;
const LOOK_AHEAD_TIME = 0.3;
const LOOK_AHEAD_MAX = 0.7;
const LOOK_AHEAD_OMEGA = 2.5;
const VIEW_BLEND_RATE = 9;

// Collision
/** The camera keeps this much air between itself and any surface; it covers the near-plane corners. */
export const CAMERA_RADIUS = 0.25;
const HEAD_HEIGHT = 1.5; // line-of-sight origin; the navmesh keeps this point clear of walls
const FLOOR_CLEARANCE = 0.25;
const BOOM_RECOVER_RATE = 5;
const BOOM_MIN = 0.05;

// Conversation framing
const FRAME_OMEGA = 4.5;
const FRAME_ANGLE = 0.5; // how far behind the player's side the two-shot camera sits, radians
const FRAME_PITCH = 0.1;
const FRAME_FOV = 50;
const FRAME_SUBJECT_HEIGHT = 1.45;

const MAX_DT = 0.1;
const TAU = Math.PI * 2;

export interface Spring {
  x: number;
  v: number;
}

/**
 * Advances a critically damped spring toward `target` using the closed-form solution, so it never overshoots a
 * resting start and stays stable for any step size. Mutates and returns `s`.
 */
export function springStep(s: Spring, target: number, omega: number, dt: number): Spring {
  if (!(dt > 0)) return s;
  const j0 = s.x - target;
  const j1 = s.v + j0 * omega;
  const e = Math.exp(-omega * dt);
  s.x = target + (j0 + j1 * dt) * e;
  s.v = (s.v - j1 * omega * dt) * e;
  return s;
}

/** Shortest signed angular difference b - a in (-pi, pi]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

export interface BobSample {
  x: number;
  y: number;
  roll: number;
}

/**
 * Head motion for a step phase that advances by 1 per footfall. The head is lowest on each contact (integer
 * phase), sways toward the planted foot over two steps and rolls with it. `weight` fades it in with speed and
 * `sprint` moves from walking to running amplitude. Writes into `out`.
 */
export function headBob(phase: number, weight: number, sprint: number, out: BobSample): BobSample {
  const side = Math.sin(Math.PI * phase);
  out.y = -Math.cos(TAU * phase) * (BOB_Y_WALK + (BOB_Y_RUN - BOB_Y_WALK) * sprint) * weight;
  out.x = side * (BOB_X_WALK + (BOB_X_RUN - BOB_X_WALK) * sprint) * weight;
  out.roll = -side * (BOB_ROLL_WALK + (BOB_ROLL_RUN - BOB_ROLL_WALK) * sprint) * weight;
  return out;
}

export interface CameraCollider {
  /** Distance to the first surface along the unit direction `dir`, or Infinity when nothing is within `maxDist`. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number;
  /** Writes the closest surface point within `maxDist` of `p` to `out`; returns its distance, or Infinity. */
  closestPoint(p: THREE.Vector3, maxDist: number, out: THREE.Vector3): number;
}

export function bvhCollider(bvh: MeshBVH): CameraCollider {
  const ray = new THREE.Ray();
  const info = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  return {
    raycast(origin, dir, maxDist) {
      ray.origin.copy(origin);
      ray.direction.copy(dir);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, maxDist);
      return hit ? hit.distance : Infinity;
    },
    closestPoint(p, maxDist, out) {
      const hit = bvh.closestPointToPoint(p, info, 0, maxDist);
      if (!hit) return Infinity;
      out.copy(hit.point);
      return hit.distance;
    },
  };
}

/** What the rig follows. `position` is at the feet. */
export interface CameraSubject {
  position: THREE.Vector3;
  /** Horizontal velocity, m/s. */
  vx: number;
  vz: number;
  speed: number;
  running: boolean;
  /** Advances by 1 per footfall. */
  stepPhase: number;
}

export interface CameraRig {
  /** Orbit yaw in effect: the camera sits toward (sin yaw, cos yaw) of its pivot and looks the other way. */
  readonly yaw: number;
  readonly pitch: number;
  readonly firstPerson: boolean;
  /** 0 in third person, 1 in first person, in between while switching. */
  readonly viewBlend: number;
  /** Distance from the camera to the subject's head after collision. */
  readonly headDistance: number;
  /** Feeds pointer travel in pixels; applied with smoothing on the next update. */
  look(dx: number, dy: number): void;
  /** Wheel steps; positive moves the third-person camera away. */
  zoom(steps: number): void;
  setFirstPerson(on: boolean): void;
  /** Eases to a two-shot of the subject and the given feet position; null eases back. */
  frame(target: THREE.Vector3 | null): void;
  /** Places the camera behind a subject facing `facing` with nothing left in motion. */
  reset(subject: CameraSubject, facing: number): void;
  update(dt: number, subject: CameraSubject): void;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function createCameraRig(camera: THREE.PerspectiveCamera, collider: CameraCollider | null): CameraRig {
  let yaw = Math.PI;
  let pitch = TP_PITCH_DEFAULT;
  let yawOut = yaw;
  let pitchOut = pitch;
  let pendDx = 0;
  let pendDy = 0;
  let firstPerson = false;
  let blend = 0;
  let zoomGoal = TP_BOOM;
  let shoulder = TP_SHOULDER;
  let clear = 1; // share of the head-to-camera line that is free
  let headDistance = TP_BOOM;

  let frameTarget: THREE.Vector3 | null = null;
  let frameSide = 0; // 0 until chosen for the current conversation
  let frameYawTp = 0;
  let frameYawFp = 0;
  let framePitchFp = 0;
  let frameDist = TP_BOOM;
  const frameMid = new THREE.Vector3();

  const zoomS: Spring = { x: TP_BOOM, v: 0 };
  const frameS: Spring = { x: 0, v: 0 };
  const sprintS: Spring = { x: 0, v: 0 };
  const bobS: Spring = { x: 0, v: 0 };
  const leanS: Spring = { x: 0, v: 0 };
  const aheadX: Spring = { x: 0, v: 0 };
  const aheadZ: Spring = { x: 0, v: 0 };
  const followX: Spring = { x: 0, v: 0 };
  const followY: Spring = { x: 0, v: 0 };
  const followZ: Spring = { x: 0, v: 0 };

  const bob: BobSample = { x: 0, y: 0, roll: 0 };
  const head = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const near = new THREE.Vector3();

  function updateFrame(s: CameraSubject): void {
    if (frameTarget === null) return;
    let ux = frameTarget.x - s.position.x;
    let uz = frameTarget.z - s.position.z;
    const sep = Math.hypot(ux, uz);
    if (sep < 1e-3) {
      ux = -Math.sin(yaw);
      uz = -Math.cos(yaw);
    } else {
      ux /= sep;
      uz /= sep;
    }
    if (frameSide === 0) {
      // Stay on whichever side of the pair the camera already is, so the move is short.
      frameSide = Math.sin(yaw) * uz - Math.cos(yaw) * ux >= 0 ? 1 : -1;
    }
    const ca = Math.cos(FRAME_ANGLE);
    const sa = Math.sin(FRAME_ANGLE);
    frameYawTp = Math.atan2(uz * frameSide * ca - ux * sa, -ux * frameSide * ca - uz * sa);
    frameYawFp = Math.atan2(-ux, -uz);
    framePitchFp = Math.atan2(FP_EYE_HEIGHT - FRAME_SUBJECT_HEIGHT + s.position.y - frameTarget.y, Math.max(sep, 0.5));
    frameDist = clamp(sep * 0.75 + 2.2, 2.6, 5.5);
    frameMid.set(
      (s.position.x + frameTarget.x) / 2,
      (s.position.y + frameTarget.y) / 2 + FRAME_SUBJECT_HEIGHT,
      (s.position.z + frameTarget.z) / 2,
    );
  }

  function step(dt: number, s: CameraSubject, snap: boolean): void {
    const p = s.position;

    // Look input, low-passed. A conversation holds the view, so travel during one is dropped.
    if (frameTarget !== null) {
      pendDx = 0;
      pendDy = 0;
    } else {
      const k = snap || LOOK_SMOOTH_TIME <= 0 ? 1 : 1 - Math.exp(-dt / LOOK_SMOOTH_TIME);
      const ax = pendDx * k;
      const ay = pendDy * k;
      pendDx -= ax;
      pendDy -= ay;
      yaw -= ax * LOOK_SENSITIVITY;
      pitch += ay * LOOK_SENSITIVITY;
    }
    pitch = firstPerson ? clamp(pitch, -FP_PITCH_LIMIT, FP_PITCH_LIMIT) : clamp(pitch, TP_PITCH_MIN, TP_PITCH_MAX);

    const blendGoal = firstPerson ? 1 : 0;
    blend = snap ? blendGoal : blend + (blendGoal - blend) * (1 - Math.exp(-VIEW_BLEND_RATE * dt));
    if (Math.abs(blendGoal - blend) < 1e-3) blend = blendGoal;
    const fp = blend * blend * (3 - 2 * blend);

    springStep(frameS, frameTarget !== null ? 1 : 0, FRAME_OMEGA, dt);
    const w = clamp(frameS.x, 0, 1);
    if (frameTarget === null && w < 1e-3) frameSide = 0;
    updateFrame(s);

    springStep(zoomS, zoomGoal, ZOOM_OMEGA, dt);
    springStep(sprintS, s.running ? 1 : 0, 6, dt);
    springStep(bobS, clamp(s.speed / BOB_FULL_SPEED, 0, 1), 8, dt);
    const sprint = clamp(sprintS.x, 0, 1);

    const frameYaw = fp > 0.5 ? frameYawFp : frameYawTp;
    const yawE = yaw + angleDelta(yaw, frameYaw) * w;
    const pitchE = lerp(pitch, fp > 0.5 ? framePitchFp : FRAME_PITCH, w);
    yawOut = yawE;
    pitchOut = pitchE;
    const sy = Math.sin(yawE);
    const cy = Math.cos(yawE);
    const rx = cy; // camera right
    const rz = -sy;

    // Follow: a slow lead toward where the subject is heading, chased by a faster spring, so the camera trails on
    // a start, settles slightly ahead and eases back on a stop.
    const lead = (1 - fp) * (1 - w);
    let lx = s.vx * LOOK_AHEAD_TIME;
    let lz = s.vz * LOOK_AHEAD_TIME;
    const ll = Math.hypot(lx, lz);
    if (ll > LOOK_AHEAD_MAX) {
      lx *= LOOK_AHEAD_MAX / ll;
      lz *= LOOK_AHEAD_MAX / ll;
    }
    springStep(aheadX, lx, LOOK_AHEAD_OMEGA, dt);
    springStep(aheadZ, lz, LOOK_AHEAD_OMEGA, dt);
    springStep(followX, p.x + aheadX.x * lead, FOLLOW_OMEGA, dt);
    springStep(followZ, p.z + aheadZ.x * lead, FOLLOW_OMEGA, dt);
    springStep(followY, p.y, FOLLOW_OMEGA_Y, dt);
    const ox = followX.x - p.x;
    const oz = followZ.x - p.z;
    const ol = Math.hypot(ox, oz);
    if (ol > FOLLOW_MAX_OFFSET) {
      followX.x = p.x + (ox * FOLLOW_MAX_OFFSET) / ol;
      followZ.x = p.z + (oz * FOLLOW_MAX_OFFSET) / ol;
    }
    followY.x = clamp(followY.x, p.y - FOLLOW_MAX_OFFSET, p.y + FOLLOW_MAX_OFFSET);

    headBob(s.stepPhase, clamp(bobS.x, 0, 1), sprint, bob);
    springStep(leanS, clamp((s.vx * rx + s.vz * rz) / LEAN_SPEED, -1, 1) * -LEAN_MAX, 8, dt);

    head.set(p.x, p.y + HEAD_HEIGHT, p.z);

    // The shoulder offset gives way first when a wall is on that side.
    const shoulderGoal = TP_SHOULDER * (1 - w);
    let shoulderFree = shoulderGoal;
    if (collider !== null && fp < 0.999 && shoulderGoal > 0.01) {
      dir.set(rx, 0, rz);
      const hit = collider.raycast(head, dir, shoulderGoal + CAMERA_RADIUS);
      if (hit < Infinity) shoulderFree = clamp(hit - CAMERA_RADIUS, 0, shoulderGoal);
    }
    const recover = 1 - Math.exp(-BOOM_RECOVER_RATE * dt);
    shoulder = snap || shoulderFree < shoulder ? shoulderFree : shoulder + (shoulderFree - shoulder) * recover;

    // Third-person pose on its boom, first-person pose at the eye, blended while switching.
    const boom = lerp(zoomS.x, frameDist, w);
    const cp = Math.cos(pitchE);
    const sway = TP_SWAY * sprint;
    const tx = lerp(followX.x, frameMid.x, w) + rx * shoulder + sy * cp * boom;
    const ty = lerp(followY.x + TP_PIVOT_HEIGHT, frameMid.y, w) + Math.sin(pitchE) * boom + bob.y * sway;
    const tz = lerp(followZ.x, frameMid.z, w) + rz * shoulder + cy * cp * boom;
    const ex = p.x + rx * bob.x;
    const ey = followY.x + FP_EYE_HEIGHT + bob.y;
    const ez = p.z + rz * bob.x;
    pos.set(lerp(tx, ex, fp), lerp(ty, ey, fp), lerp(tz, ez, fp));

    // Collision: the camera stays on the clear part of the line from the subject's head, then is pushed off any
    // surface it still sits too close to. It pulls in at once and eases back out.
    dir.subVectors(pos, head);
    const len = dir.length();
    if (len > 1e-4) {
      dir.multiplyScalar(1 / len);
      let free = len;
      if (collider !== null) {
        const hit = collider.raycast(head, dir, len + CAMERA_RADIUS);
        if (hit < Infinity) free = Math.min(free, hit - CAMERA_RADIUS);
      }
      const floor = p.y + FLOOR_CLEARANCE;
      if (dir.y < -1e-4 && head.y + dir.y * free < floor) free = (floor - head.y) / dir.y;
      const share = clamp(free, Math.min(BOOM_MIN, len), len) / len;
      clear = snap || share < clear ? share : Math.min(share, clear + (share - clear) * recover);
      pos.copy(head).addScaledVector(dir, len * clear);
    } else {
      clear = 1;
    }
    if (collider !== null) {
      for (let i = 0; i < 3; i++) {
        const d = collider.closestPoint(pos, CAMERA_RADIUS, near);
        if (d >= CAMERA_RADIUS) break;
        if (d > 1e-5) pos.addScaledVector(near.sub(pos), -(CAMERA_RADIUS - d) / d);
        else pos.addScaledVector(dir, -CAMERA_RADIUS); // on the surface: back toward the head
      }
    }
    headDistance = pos.distanceTo(head);

    camera.position.copy(pos);
    const roll = (bob.roll + leanS.x) * lerp(sway, 1, fp);
    camera.rotation.set(-pitchE, yawE, roll, 'YXZ');
    const fov = lerp(lerp(TP_FOV, FRAME_FOV, w), FP_FOV, fp) + sprint * lerp(TP_SPRINT_FOV_KICK, FP_SPRINT_FOV_KICK, fp);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    get yaw() {
      return yawOut;
    },
    get pitch() {
      return pitchOut;
    },
    get firstPerson() {
      return firstPerson;
    },
    get viewBlend() {
      return blend;
    },
    get headDistance() {
      return headDistance;
    },
    look(dx, dy) {
      pendDx += dx;
      pendDy += dy;
    },
    zoom(steps) {
      if (firstPerson) return;
      zoomGoal = clamp(zoomGoal + steps * ZOOM_STEP, TP_BOOM_MIN, TP_BOOM_MAX);
    },
    setFirstPerson(on) {
      firstPerson = on;
    },
    frame(target) {
      if (target === null) {
        frameTarget = null;
        return;
      }
      if (frameTarget === null) frameTarget = target.clone();
      else frameTarget.copy(target);
    },
    reset(subject, facing) {
      yaw = facing + Math.PI;
      pitch = firstPerson ? 0 : TP_PITCH_DEFAULT;
      pendDx = 0;
      pendDy = 0;
      frameTarget = null;
      frameSide = 0;
      frameS.x = frameS.v = 0;
      zoomS.x = zoomGoal;
      zoomS.v = 0;
      sprintS.x = sprintS.v = 0;
      bobS.x = bobS.v = 0;
      leanS.x = leanS.v = 0;
      aheadX.x = aheadX.v = 0;
      aheadZ.x = aheadZ.v = 0;
      followX.x = subject.position.x;
      followY.x = subject.position.y;
      followZ.x = subject.position.z;
      followX.v = followY.v = followZ.v = 0;
      step(0, subject, true);
    },
    update(dt, subject) {
      step(clamp(dt, 0, MAX_DT), subject, false);
    },
  };
}
