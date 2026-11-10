// Player controller: camera-relative movement on the navmesh with eased starts and stops, driving the camera rig
// (first person by default, over-the-shoulder third person on V) and exposing step cadence for audio. In first
// person the body is not drawn but still casts its shadow.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { angleDelta, bvhCollider, createCameraRig } from './camera-rig';
import type { CameraSubject } from './camera-rig';
import type { CharacterRig } from './character';
import type { Input } from './input';
import { mergeWorldGeometry } from './nav';
import type { NavWorld } from './nav';
import { AIR } from './post';

export { angleDelta } from './camera-rig';

export interface Player {
  rig: CharacterRig;
  position: THREE.Vector3;
  update(dt: number): void;
  teleport(p: THREE.Vector3, rotY: number): void;
  nearestNpc(npcs: { id: string; pos: THREE.Vector3 }[], maxDist: number): string | null;
  dispose(): void;
  /** Advances by 1 per footfall; each integer crossing is a foot contact. */
  readonly stepPhase?: number;
  /** Horizontal speed over the ground, m/s. */
  readonly speed?: number;
  readonly running?: boolean;
  readonly firstPerson?: boolean;
  /** Switches between third and first person (also on the V key). */
  toggleView?(): void;
  /**
   * Eases the camera to the NPC standing at `target` (feet): the view turns to them in first person, a two-shot
   * in third. The top quality tier pulls focus to their face. null eases back.
   */
  frameTarget?(target: THREE.Vector3 | null): void;
  /** First-person eye height over the feet, metres: call it with the folk's height times 0.94 for non-human folk. */
  setEyeHeight?(h: number): void;
}

export const WALK_SPEED = 2.2;
export const RUN_SPEED = 5;
const ACCEL_RATE = 9; // 1/s, exponential approach to the wanted velocity
const DECEL_RATE = 13;
const TURN_RATE = 10;
const RUN_ANIM_SPEED = (WALK_SPEED + RUN_SPEED) / 2;
const IDLE_SPEED = 0.3;
const FP_BACK_FACTOR = 0.7;
const FP_STRAFE_FACTOR = 0.85;
const STRIDE_WALK = 1.0; // metres per footfall at walking speed
const STRIDE_RUN = 1.6;
const RIG_HIDE_DISTANCE = 0.7; // the body is hidden when the camera is pushed this close to the head
const FOCUS_HEIGHT = 1.5; // the lens focuses this far above the feet of whoever is spoken to
const CONE_HALF_ANGLE = Math.PI / 3; // 120 degree cone in front

/** Metres covered per footfall at a given ground speed. */
export function strideLength(speed: number): number {
  const t = Math.min(1, Math.max(0, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
  return STRIDE_WALK + (STRIDE_RUN - STRIDE_WALK) * t;
}

/**
 * Share of the wanted speed allowed while the body still faces away from it: 0 when asked to go straight back,
 * 1 once within a right angle, so a reversal starts as a turn on the spot.
 */
export function turnInPlaceScale(headingError: number): number {
  const t = Math.min(1, Math.max(0, (Math.cos(headingError) + 0.9) / 0.8));
  return t * t * (3 - 2 * t);
}

export interface MoveResult {
  /** Horizontal velocity in m/s, world axes. */
  vx: number;
  vz: number;
  speed: number;
  /** Yaw of the rig that faces the motion (rig forward is +Z); null when standing still. */
  heading: number | null;
}

/**
 * Camera-relative movement. `camYaw` is the orbit angle of the camera around the player: the camera sits at
 * (sin yaw, cos yaw) from the target, so the view direction is (-sin yaw, -cos yaw) and right is (cos yaw, -sin yaw).
 * `axis.y > 0` is forward, `axis.x > 0` is right. Diagonals are normalised so they are not faster.
 */
export function cameraRelativeMove(
  axis: { x: number; y: number },
  camYaw: number,
  running: boolean,
): MoveResult {
  let ax = axis.x;
  let ay = axis.y;
  const len = Math.hypot(ax, ay);
  if (len < 1e-4) return { vx: 0, vz: 0, speed: 0, heading: null };
  if (len > 1) {
    ax /= len;
    ay /= len;
  }
  const s = Math.sin(camYaw);
  const c = Math.cos(camYaw);
  const dx = -s * ay + c * ax;
  const dz = -c * ay - s * ax;
  const speed = (running ? RUN_SPEED : WALK_SPEED) * Math.min(1, len);
  const dl = Math.hypot(dx, dz) || 1;
  const ux = dx / dl;
  const uz = dz / dl;
  return { vx: ux * speed, vz: uz * speed, speed, heading: Math.atan2(ux, uz) };
}

export function createPlayer(
  rig: CharacterRig,
  nav: NavWorld,
  camera: THREE.PerspectiveCamera,
  input: Input,
  statics: THREE.Mesh[],
  options: { firstPerson?: boolean; eyeHeight?: number } = {},
): Player {
  const position = new THREE.Vector3();
  let heading = 0;
  let stepPhase = 0;
  let anim: 'idle' | 'walk' | 'run' | '' = '';
  let disposed = false;

  const bvhGeometry = mergeWorldGeometry(statics);
  const bvh = bvhGeometry ? new MeshBVH(bvhGeometry) : null;
  const cam = createCameraRig(camera, bvh ? bvhCollider(bvh) : null, options);
  const subject: CameraSubject = { position, vx: 0, vz: 0, speed: 0, running: false, stepPhase: 0 };
  const delta = new THREE.Vector3();

  // More than one listener may be bound to the view key: only the first call between two updates switches.
  let toggled = false;
  const toggleView = (): void => {
    if (disposed || toggled) return;
    toggled = true;
    cam.setFirstPerson(!cam.firstPerson);
  };
  const offViewKey = input.onKey('KeyV', toggleView);

  // First person: every mesh of the body takes a material that writes neither colour nor depth. The shadow pass
  // uses its own depth material, so the body still throws its shadow on the ground in front of the camera.
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  shadowOnly.name = 'player-shadow-only';
  const bodyMeshes: THREE.Mesh[] = [];
  const bodyMaterials: (THREE.Material | THREE.Material[])[] = [];
  let bodyShadowOnly = false;
  const collectBody = (o: THREE.Object3D): void => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true || mesh.material === shadowOnly) return;
    bodyMeshes.push(mesh);
    bodyMaterials.push(mesh.material);
    mesh.material = shadowOnly;
  };
  function setBodyShadowOnly(on: boolean): void {
    if (on === bodyShadowOnly) return;
    bodyShadowOnly = on;
    if (on) {
      rig.root.traverse(collectBody);
      return;
    }
    for (let i = 0; i < bodyMeshes.length; i++) {
      const mesh = bodyMeshes[i];
      const material = bodyMaterials[i];
      if (mesh !== undefined && material !== undefined) mesh.material = material;
    }
    bodyMeshes.length = 0;
    bodyMaterials.length = 0;
  }

  function play(name: 'idle' | 'walk' | 'run'): void {
    if (anim === name) return;
    anim = name;
    rig.play(name, 0.2);
  }

  function syncRig(): void {
    rig.root.position.copy(position);
    rig.root.rotation.y = heading;
    const eyeView = cam.viewBlend >= 0.5;
    setBodyShadowOnly(eyeView);
    rig.root.visible = eyeView || cam.headDistance >= RIG_HIDE_DISTANCE;
  }

  return {
    rig,
    position,
    get stepPhase() {
      return stepPhase;
    },
    get speed() {
      return subject.speed;
    },
    get running() {
      return subject.running;
    },
    get firstPerson() {
      return cam.firstPerson;
    },
    toggleView,
    frameTarget(target: THREE.Vector3 | null): void {
      if (disposed) return;
      cam.frame(target);
      AIR.focusOn = target !== null;
      if (target !== null) {
        AIR.focus.set(target.x, target.y + FOCUS_HEIGHT, target.z);
        input.exitLock?.(); // free the cursor for the conversation panel
      }
    },
    setEyeHeight(h: number): void {
      if (!disposed) cam.setEyeHeight(h);
    },
    update(dt: number): void {
      if (disposed) return;
      toggled = false;
      const look = input.pointerDelta();
      cam.look(look.dx, look.dy);
      const wheel = input.wheelDelta();
      if (wheel !== 0) cam.zoom(wheel);

      const fp = cam.firstPerson;
      const axis = input.axis();
      const shift = input.down('ShiftLeft') || input.down('ShiftRight');
      const mv = cameraRelativeMove(axis, cam.yaw, shift && (!fp || axis.y > 0.1));
      let scale = 1;
      if (mv.heading !== null) {
        if (fp) scale = axis.y < -0.1 ? FP_BACK_FACTOR : Math.abs(axis.x) > Math.abs(axis.y) ? FP_STRAFE_FACTOR : 1;
        else scale = turnInPlaceScale(angleDelta(heading, mv.heading));
      }
      const k = dt > 0 ? 1 - Math.exp(-(mv.speed > 0 ? ACCEL_RATE : DECEL_RATE) * dt) : 0;
      subject.vx += (mv.vx * scale - subject.vx) * k;
      subject.vz += (mv.vz * scale - subject.vz) * k;
      let wanted = Math.hypot(subject.vx, subject.vz);
      if (mv.speed === 0 && wanted < 0.02) {
        subject.vx = 0;
        subject.vz = 0;
        wanted = 0;
      }

      let moved = 0;
      if (dt > 0 && wanted > 0) {
        delta.set(subject.vx * dt, 0, subject.vz * dt);
        const next = nav.moveAlongSurface(position, delta);
        const mx = (next.x - position.x) / dt;
        const mz = (next.z - position.z) / dt;
        moved = Math.hypot(mx, mz);
        if (moved < wanted * 0.6) {
          // Blocked or sliding along a wall: carry on from what the surface allowed.
          subject.vx = mx;
          subject.vz = mz;
        }
        position.copy(next);
        stepPhase += (moved * dt) / strideLength(moved);
      }
      subject.speed = moved;
      subject.running = moved > RUN_ANIM_SPEED;
      subject.stepPhase = stepPhase;

      if (fp) heading = cam.yaw + Math.PI; // the body faces the view, so sideways input strafes
      else if (mv.heading !== null) heading += angleDelta(heading, mv.heading) * (1 - Math.exp(-TURN_RATE * dt));
      play(moved < IDLE_SPEED ? 'idle' : subject.running ? 'run' : 'walk');

      cam.update(dt, subject);
      syncRig();
      rig.update(dt);
    },
    teleport(p: THREE.Vector3, rotY: number): void {
      position.copy(nav.nearest(p));
      heading = rotY;
      subject.vx = 0;
      subject.vz = 0;
      subject.speed = 0;
      subject.running = false;
      cam.reset(subject, rotY);
      syncRig();
    },
    nearestNpc(npcs, maxDist): string | null {
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      const cosLimit = Math.cos(CONE_HALF_ANGLE);
      let best: string | null = null;
      let bestD = maxDist;
      for (const n of npcs) {
        const dx = n.pos.x - position.x;
        const dz = n.pos.z - position.z;
        const d = Math.hypot(dx, dz);
        if (d > bestD) continue;
        if (d > 1e-3 && (dx * fx + dz * fz) / d < cosLimit) continue;
        best = n.id;
        bestD = d;
      }
      return best;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      offViewKey();
      setBodyShadowOnly(false);
      shadowOnly.dispose();
      AIR.focusOn = false;
      rig.root.visible = true;
      bvhGeometry?.dispose();
    },
  };
}
