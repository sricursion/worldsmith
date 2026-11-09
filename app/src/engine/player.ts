// Third-person controller: camera-relative movement, orbit camera with a BVH boom, wall sliding via the navmesh.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { CharacterRig } from './character';
import type { Input } from './input';
import { mergeWorldGeometry } from './nav';
import type { NavWorld } from './nav';

export interface Player {
  rig: CharacterRig;
  position: THREE.Vector3;
  update(dt: number): void;
  teleport(p: THREE.Vector3, rotY: number): void;
  nearestNpc(npcs: { id: string; pos: THREE.Vector3 }[], maxDist: number): string | null;
  dispose(): void;
}

export const WALK_SPEED = 2.2;
export const RUN_SPEED = 5;
const SENSITIVITY = 0.0025;
const PITCH_MIN = -0.2;
const PITCH_MAX = 1.2;
const DIST_MIN = 3;
const DIST_MAX = 9;
const DIST_DEFAULT = 5.5;
const DEFAULT_PITCH = 0.35;
const LOOK_HEIGHT = 1.4;
const TURN_RATE = 12;
const CAM_MARGIN = 0.3;
const CAM_MIN_DIST = 0.5;
const CAM_RECOVER_RATE = 6;
const CONE_HALF_ANGLE = Math.PI / 3; // 120 degree cone in front

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

/** Shortest signed angular difference b - a in (-pi, pi]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function createPlayer(
  rig: CharacterRig,
  nav: NavWorld,
  camera: THREE.PerspectiveCamera,
  input: Input,
  statics: THREE.Mesh[],
): Player {
  const position = new THREE.Vector3();
  let heading = 0;
  let camYaw = Math.PI;
  let camPitch = DEFAULT_PITCH;
  let camDist = DIST_DEFAULT;
  let boom = DIST_DEFAULT; // current (possibly shortened) camera distance
  let anim: 'idle' | 'walk' | 'run' | '' = '';
  let disposed = false;

  const bvhGeometry = mergeWorldGeometry(statics);
  const bvh = bvhGeometry ? new MeshBVH(bvhGeometry) : null;

  const onWheel = (e: WheelEvent): void => {
    if (e.target instanceof Element && e.target.closest('.tf-panel')) return;
    camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 0.5, DIST_MIN, DIST_MAX);
  };
  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) window.addEventListener('wheel', onWheel, { passive: true });

  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const ray = new THREE.Ray();
  const delta = new THREE.Vector3();

  function play(name: 'idle' | 'walk' | 'run'): void {
    if (anim === name) return;
    anim = name;
    rig.play(name, 0.2);
  }

  function updateCamera(dt: number, snap: boolean): void {
    target.set(position.x, position.y + LOOK_HEIGHT, position.z);
    const cp = Math.cos(camPitch);
    dir.set(Math.sin(camYaw) * cp, Math.sin(camPitch), Math.cos(camYaw) * cp);
    let allowed = camDist;
    if (bvh) {
      ray.origin.copy(target);
      ray.direction.copy(dir);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, camDist + CAM_MARGIN);
      if (hit) allowed = Math.max(CAM_MIN_DIST, Math.min(camDist, hit.distance - CAM_MARGIN));
    }
    if (snap || allowed < boom) boom = allowed;
    else boom = Math.min(allowed, boom + (allowed - boom) * (1 - Math.exp(-CAM_RECOVER_RATE * dt)));
    camera.position.copy(target).addScaledVector(dir, boom);
    camera.lookAt(target);
  }

  function syncRig(): void {
    rig.root.position.copy(position);
    rig.root.rotation.y = heading;
  }

  return {
    rig,
    position,
    update(dt: number): void {
      if (disposed) return;
      const look = input.pointerDelta();
      camYaw -= look.dx * SENSITIVITY;
      camPitch = THREE.MathUtils.clamp(camPitch + look.dy * SENSITIVITY, PITCH_MIN, PITCH_MAX);

      const running = input.down('ShiftLeft') || input.down('ShiftRight');
      const mv = cameraRelativeMove(input.axis(), camYaw, running);
      let moved = 0;
      if (dt > 0 && mv.speed > 0) {
        delta.set(mv.vx * dt, 0, mv.vz * dt);
        const next = nav.moveAlongSurface(position, delta);
        moved = Math.hypot(next.x - position.x, next.z - position.z) / dt;
        position.copy(next);
      }
      if (mv.heading !== null) {
        heading += angleDelta(heading, mv.heading) * (1 - Math.exp(-TURN_RATE * dt));
      }
      play(moved < 0.3 ? 'idle' : running ? 'run' : 'walk');

      syncRig();
      rig.update(dt);
      updateCamera(dt, false);
    },
    teleport(p: THREE.Vector3, rotY: number): void {
      position.copy(nav.nearest(p));
      heading = rotY;
      camYaw = rotY + Math.PI;
      camPitch = DEFAULT_PITCH;
      syncRig();
      updateCamera(0, true);
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
      if (hasWindow) window.removeEventListener('wheel', onWheel);
      bvhGeometry?.dispose();
    },
  };
}
