// Player controller: camera-relative movement on the navmesh with eased starts and stops, driving the camera rig
// (first person by default, over-the-shoulder third person on V) and exposing step cadence for audio. In first
// person the body is not drawn but still casts its shadow.
//
// The navmesh covers the place itself. Given the land (PlayerLand), the player is not held to it: where the
// navmesh ends the walk carries on over the land's own height, turned aside by slopes too steep to climb, by
// water deeper than the knee and by whatever solid stands out there, and steps back onto the navmesh on return.
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
  /** True while walking the open land beyond the navmesh. */
  readonly roaming?: boolean;
  /**
   * Set once the player is more than HOME_FAR metres out from the place: how far out, in metres, and the yaw
   * (as rig.root.rotation.y: 0 faces +Z) that faces its middle. Undefined nearer in, and without land.
   */
  readonly distanceFromHome?: number;
  readonly homeBearing?: number;
}

/** What the player needs to walk beyond the navmesh. TownObjects.roam is one. */
export interface PlayerLand {
  /** Height of the ground, metres, anywhere. */
  heightAt(x: number, z: number): number;
  /** Depth of standing water, metres; 0 on dry land. */
  waterDepthAt?(x: number, z: number): number;
  /** Inside this rectangle the navmesh alone decides where one can go (what is built stands in it); outside it the land does. */
  coreBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Moves a point out of whatever solid stands near it on the open land. */
  pushOut?(p: { x: number; z: number }): void;
}

/** The steepest ground walked up on the open land (rise over run: 40 degrees), and the deepest water waded. */
export const FREE_MAX_SLOPE = Math.tan((40 * Math.PI) / 180);
export const FREE_MAX_WADE = 0.45;
/** Metres out from the place past which the way home is reported. */
export const HOME_FAR = 80;

function freeAllowed(land: PlayerLand, x: number, z: number, dx: number, dz: number, h0: number, w0: number): boolean {
  const len = Math.hypot(dx, dz);
  const h1 = land.heightAt(x + dx, z + dz);
  if (!Number.isFinite(h1) || !(len > 0)) return false;
  // Down any slope, up only what can be climbed.
  if ((h1 - h0) / len > FREE_MAX_SLOPE) return false;
  if (land.waterDepthAt) {
    const w1 = land.waterDepthAt(x + dx, z + dz);
    // No deeper than the knee; out of deep water toward the shallows is always allowed.
    if (w1 > FREE_MAX_WADE && w1 >= w0) return false;
  }
  return true;
}

/**
 * One step over open land from (x, z) by (dx, dz): the whole step where the land allows it, else the part of
 * it that runs along the slope (so a hillside or a shore is slid along, not stuck to), else none. Writes
 * where the step ends to `out`; false when it could not move.
 */
export function freeStep(land: PlayerLand, x: number, z: number, dx: number, dz: number, out: { x: number; z: number }): boolean {
  out.x = x;
  out.z = z;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-7) || !Number.isFinite(len)) return false;
  const h0 = land.heightAt(x, z);
  const w0 = land.waterDepthAt ? land.waterDepthAt(x, z) : 0;
  if (freeAllowed(land, x, z, dx, dz, h0, w0)) {
    out.x = x + dx;
    out.z = z + dz;
    return true;
  }
  const e = 0.5;
  const gx = (land.heightAt(x + e, z) - land.heightAt(x - e, z)) / (2 * e);
  const gz = (land.heightAt(x, z + e) - land.heightAt(x, z - e)) / (2 * e);
  const gl = Math.hypot(gx, gz);
  if (!(gl > 1e-6)) return false;
  const tx = -gz / gl;
  const tz = gx / gl;
  const along = dx * tx + dz * tz;
  if (Math.abs(along) < len * 0.05) return false;
  if (!freeAllowed(land, x, z, tx * along, tz * along, h0, w0)) return false;
  out.x = x + tx * along;
  out.z = z + tz * along;
  return true;
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
  options: { firstPerson?: boolean; eyeHeight?: number; land?: PlayerLand } = {},
): Player {
  const position = new THREE.Vector3();
  const land = options.land;
  const home = land ? land.coreBounds : null;
  /** True while off the navmesh, on the open land. */
  let roaming = false;
  /** What is left of the height difference where the walk changed between navmesh and land: eased away, so there is no step. */
  let yEase = 0;
  let baseY = 0;
  const step = { x: 0, z: 0 };
  const probe = new THREE.Vector3();
  const inHome = (x: number, z: number, grow: number): boolean =>
    home !== null && x > home.minX - grow && x < home.maxX + grow && z > home.minZ - grow && z < home.maxZ + grow;
  const outFromHome = (): number =>
    (home === null ? 0 : Math.hypot(Math.max(home.minX - position.x, 0, position.x - home.maxX), Math.max(home.minZ - position.z, 0, position.z - home.maxZ)));
  /** The navmesh point under (x, z), or null where there is none. nearest() hands back its argument when it finds nothing. */
  const navUnder = (x: number, z: number, y: number): THREE.Vector3 | null => {
    probe.set(x, y + 1, z);
    const q = nav.nearest(probe);
    return Math.abs(q.y - probe.y) > 1e-3 && Math.hypot(q.x - x, q.z - z) < 0.05 ? q : null;
  };
  let heading = 0;
  let stepPhase = 0;
  let anim: 'idle' | 'walk' | 'run' | '' = '';
  let disposed = false;

  const bvhGeometry = mergeWorldGeometry(statics);
  const bvh = bvhGeometry ? new MeshBVH(bvhGeometry) : null;
  const cam = createCameraRig(camera, bvh ? bvhCollider(bvh) : null, { firstPerson: options.firstPerson, eyeHeight: options.eyeHeight, groundAt: land ? (x, z) => land.heightAt(x, z) : undefined });
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
    get roaming() {
      return roaming;
    },
    get distanceFromHome() {
      const d = outFromHome();
      return d > HOME_FAR ? d : undefined;
    },
    get homeBearing() {
      if (home === null || !(outFromHome() > HOME_FAR)) return undefined;
      return Math.atan2((home.minX + home.maxX) / 2 - position.x, (home.minZ + home.maxZ) / 2 - position.z);
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
        let next: THREE.Vector3;
        if (roaming && land) {
          // Open land: the ground's own height, its slopes, its water and what stands on it.
          freeStep(land, position.x, position.z, delta.x, delta.z, step);
          land.pushOut?.(step);
          if (!Number.isFinite(step.x) || !Number.isFinite(step.z)) { step.x = position.x; step.z = position.z; }
          let y = land.heightAt(step.x, step.z);
          if (inHome(step.x, step.z, 4)) {
            const on = navUnder(step.x, step.z, y);
            if (on) {
              // Back on the navmesh: it takes over from here.
              roaming = false;
              yEase += y - on.y;
              y = on.y;
            } else if (inHome(step.x, step.z, 0)) {
              // Inside the place only the navmesh says where one can stand.
              step.x = position.x;
              step.z = position.z;
              y = land.heightAt(step.x, step.z);
            }
          }
          next = probe.set(step.x, y, step.z);
        } else {
          next = nav.moveAlongSurface(position, delta);
          if (land) {
            const tx = position.x + delta.x;
            const tz = position.z + delta.z;
            const short = Math.hypot(next.x - tx, next.z - tz);
            if (short > 0.3 * Math.hypot(delta.x, delta.z) && !inHome(tx, tz, 0) && freeStep(land, position.x, position.z, delta.x, delta.z, step)) {
              // The navmesh ends here and the land goes on: walk on over it.
              roaming = true;
              const y = land.heightAt(step.x, step.z);
              yEase = position.y - land.heightAt(position.x, position.z);
              next.set(step.x, y, step.z);
            }
          }
        }
        baseY = next.y;
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
      if (yEase !== 0) {
        // The height carried over a change of footing melts away in a fraction of a second.
        yEase = Math.abs(yEase) < 0.002 ? 0 : yEase * Math.exp(-8 * Math.max(0, dt));
        position.y = baseY + yEase;
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
      yEase = 0;
      roaming = false;
      if (land && !inHome(p.x, p.z, 0) && Number.isFinite(p.x) && Number.isFinite(p.z)) {
        const y = land.heightAt(p.x, p.z);
        const on = navUnder(p.x, p.z, y);
        if (on) position.copy(on);
        else { roaming = true; position.set(p.x, y, p.z); }
      } else position.copy(nav.nearest(p));
      baseY = position.y;
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
