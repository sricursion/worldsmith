import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildNav } from '../../app/src/engine/nav';
import { CAMERA_RADIUS, FP_EYE_HEIGHT, LOOK_SENSITIVITY, TP_BOOM } from '../../app/src/engine/camera-rig';
import {
  angleDelta,
  cameraRelativeMove,
  createPlayer,
  RUN_SPEED,
  strideLength,
  turnInPlaceScale,
  WALK_SPEED,
} from '../../app/src/engine/player';
import type { CharacterRig } from '../../app/src/engine/character';
import type { Input } from '../../app/src/engine/input';
import { disposeMeshes, makeWorld } from './helpers';

describe('cameraRelativeMove', () => {
  it('is still without input', () => {
    expect(cameraRelativeMove({ x: 0, y: 0 }, 1.3, true)).toEqual({ vx: 0, vz: 0, speed: 0, heading: null });
  });

  it('forward goes away from the camera', () => {
    // yaw 0: camera on +Z looking toward -Z
    const f = cameraRelativeMove({ x: 0, y: 1 }, 0, false);
    expect(f.vx).toBeCloseTo(0);
    expect(f.vz).toBeCloseTo(-WALK_SPEED);
    expect(Math.abs(f.heading ?? 0)).toBeCloseTo(Math.PI);
    // yaw 90 degrees: camera on +X looking toward -X
    const g = cameraRelativeMove({ x: 0, y: 1 }, Math.PI / 2, false);
    expect(g.vx).toBeCloseTo(-WALK_SPEED);
    expect(g.vz).toBeCloseTo(0);
  });

  it('right is to the right of the view direction', () => {
    const r = cameraRelativeMove({ x: 1, y: 0 }, 0, false);
    expect(r.vx).toBeCloseTo(WALK_SPEED);
    expect(r.vz).toBeCloseTo(0);
    expect(r.heading).toBeCloseTo(Math.PI / 2);
  });

  it('runs faster and normalises diagonals', () => {
    const d = cameraRelativeMove({ x: 1, y: 1 }, 0.7, true);
    expect(d.speed).toBeCloseTo(RUN_SPEED);
    expect(Math.hypot(d.vx, d.vz)).toBeCloseTo(RUN_SPEED);
  });

  it('angleDelta takes the short way round', () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(0, 1)).toBeCloseTo(1);
  });

  it('turns on the spot before reversing and lengthens the stride with speed', () => {
    expect(turnInPlaceScale(Math.PI)).toBe(0);
    expect(turnInPlaceScale(0)).toBe(1);
    expect(turnInPlaceScale(Math.PI / 2)).toBe(1);
    expect(turnInPlaceScale(2.6)).toBeGreaterThan(0);
    expect(turnInPlaceScale(2.6)).toBeLessThan(1);
    expect(strideLength(RUN_SPEED)).toBeGreaterThan(strideLength(WALK_SPEED));
    expect(strideLength(0)).toBe(strideLength(WALK_SPEED));
  });
});

function fakeRig(): CharacterRig & { played: string[] } {
  const played: string[] = [];
  return {
    root: new THREE.Group(),
    mixer: new THREE.AnimationMixer(new THREE.Group()),
    play: (n: string) => void played.push(n),
    setPalette: () => undefined,
    lookAt: () => undefined,
    update: () => undefined,
    dispose: () => undefined,
    played,
  } as unknown as CharacterRig & { played: string[] };
}

interface InputState {
  axis: { x: number; y: number };
  shift: boolean;
  dx: number;
  dy: number;
  keys: Map<string, () => void>;
  unlocked: number;
}

function fakeInput(state: InputState): Input {
  return {
    down: (c: string) => state.shift && c === 'ShiftLeft',
    axis: () => state.axis,
    onKey: (code: string, cb: () => void) => {
      state.keys.set(code, cb);
      return () => void state.keys.delete(code);
    },
    isLocked: () => false,
    exitLock: () => void state.unlocked++,
    wheelDelta: () => 0,
    pointerDelta: () => {
      const d = { dx: state.dx, dy: state.dy };
      state.dx = 0;
      state.dy = 0;
      return d;
    },
    dispose: () => undefined,
  };
}

describe('createPlayer', () => {
  it('walks, animates, keeps the camera clear of walls and finds NPCs in front', async () => {
    const { ground, statics } = makeWorld([[0, -6, 12, 2, 4]]);
    const nav = await buildNav(statics, ground);
    const camera = new THREE.PerspectiveCamera();
    const state: InputState = { axis: { x: 0, y: 0 }, shift: false, dx: 0, dy: 0, keys: new Map(), unlocked: 0 };
    const rig = fakeRig();
    const player = createPlayer(rig, nav, camera, fakeInput(state), statics);

    player.teleport(new THREE.Vector3(0, 0, 5), Math.PI); // facing -Z, toward the wall
    // Close over the right shoulder, near head height.
    expect(camera.position.z).toBeGreaterThan(player.position.z + 2.5);
    expect(camera.position.z).toBeLessThan(player.position.z + TP_BOOM + 0.01);
    expect(camera.position.x).toBeGreaterThan(player.position.x + 0.3);
    expect(camera.position.y).toBeGreaterThan(1.5);
    expect(camera.position.y).toBeLessThan(2.3);
    expect(player.speed).toBe(0);

    state.axis.y = 1;
    player.update(1 / 60);
    expect(player.speed ?? 0).toBeLessThan(WALK_SPEED * 0.5); // eases in
    for (let i = 0; i < 59; i++) player.update(1 / 60);
    expect(player.position.z).toBeCloseTo(5 - WALK_SPEED, 0);
    expect(player.speed).toBeCloseTo(WALK_SPEED, 1);
    expect(player.running).toBe(false);
    expect(player.stepPhase ?? 0).toBeGreaterThan(1.5);
    expect(player.stepPhase ?? 0).toBeLessThan(2.5);
    expect(rig.played).toContain('walk');
    // The camera trails behind while the player gets going, never ahead of them.
    expect(camera.position.z).toBeGreaterThan(player.position.z + 2.5);

    state.shift = true;
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    expect(rig.played).toContain('run');
    expect(player.running).toBe(true);
    expect(camera.fov).toBeGreaterThan(63); // sprint kick

    // Run into the wall: stays outside it and goes idle.
    for (let i = 0; i < 300; i++) player.update(1 / 60);
    expect(player.position.z).toBeGreaterThan(-4.9);
    expect(rig.played[rig.played.length - 1]).toBe('idle');

    // Orbit the camera to the wall side; the boom must shorten rather than end up inside the box.
    state.axis.y = 0;
    state.dx = Math.PI / LOOK_SENSITIVITY;
    const eye = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      player.update(1 / 60);
      eye.set(player.position.x, player.position.y + 1.5, player.position.z);
      expect(camera.position.distanceTo(eye)).toBeLessThan(TP_BOOM + 0.8);
      // Never inside the box, nor within the camera's own radius of its near face.
      expect(camera.position.z).toBeGreaterThan(-5 + CAMERA_RADIUS - 1e-3);
    }
    expect(camera.position.z).toBeLessThan(player.position.z); // it did swing to the wall side
    expect(camera.position.distanceTo(eye)).toBeLessThan(1.5); // and the boom shortened to fit

    const px = player.position.x;
    const pz = player.position.z;
    const npcs = [
      { id: 'behind', pos: new THREE.Vector3(px, 0, pz + 2) },
      { id: 'ahead', pos: new THREE.Vector3(px, 0, pz - 3) },
      { id: 'far', pos: new THREE.Vector3(px, 0, pz - 30) },
    ];
    expect(player.nearestNpc(npcs, 5)).toBe('ahead');
    expect(player.nearestNpc(npcs.slice(0, 1), 5)).toBeNull();
    expect(player.nearestNpc(npcs.slice(2), 5)).toBeNull();

    // V switches to first person: eye height at the player's position, body hidden, wider lens.
    state.keys.get('KeyV')?.();
    expect(player.firstPerson).toBe(true);
    for (let i = 0; i < 90; i++) player.update(1 / 60);
    expect(camera.position.y).toBeCloseTo(player.position.y + FP_EYE_HEIGHT, 2);
    expect(Math.hypot(camera.position.x - player.position.x, camera.position.z - player.position.z)).toBeLessThan(0.05);
    expect(rig.root.visible).toBe(false);
    expect(camera.fov).toBeCloseTo(72, 1);
    // Sideways input strafes: the body keeps facing the view.
    const facing = rig.root.rotation.y;
    state.shift = false;
    state.axis.x = 1;
    const beforeX = player.position.x;
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    expect(Math.abs(player.position.x - beforeX)).toBeGreaterThan(0.5);
    expect(rig.root.rotation.y).toBeCloseTo(facing, 5);
    state.axis.x = 0;
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    state.keys.get('KeyV')?.();
    for (let i = 0; i < 90; i++) player.update(1 / 60);
    expect(player.firstPerson).toBe(false);

    player.frameTarget?.(new THREE.Vector3(player.position.x + 1, 0, player.position.z + 2));
    expect(state.unlocked).toBe(1);
    player.frameTarget?.(null);
    for (let i = 0; i < 120; i++) player.update(1 / 60);

    player.dispose();
    expect(state.keys.has('KeyV')).toBe(false);
    expect(rig.root.visible).toBe(true);
    nav.dispose();
    disposeMeshes([ground, ...statics]);
  });
});
