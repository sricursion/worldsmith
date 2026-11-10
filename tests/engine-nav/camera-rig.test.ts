import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  BREATH_PITCH,
  BREATH_Y,
  bvhCollider,
  CAMERA_RADIUS,
  createCameraRig,
  DIP_LIMIT,
  FP_EYE_HEIGHT,
  FP_FOV,
  FP_FRAME_FOV,
  headBob,
  LOOK_SENSITIVITY,
  springStep,
  TP_BOOM,
  TP_BOOM_MAX,
  TP_BOOM_MIN,
  TP_FOV,
  TP_PIVOT_HEIGHT,
  TP_SHOULDER,
} from '../../app/src/engine/camera-rig';
import type { CameraSubject } from '../../app/src/engine/camera-rig';

describe('springStep', () => {
  it('settles without overshoot or blow-up for steps up to 0.1 s', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 30, 0.05, 0.1]) {
      for (const omega of [2.5, 10, 40]) {
        const s = { x: 0, v: 0 };
        let peak = 0;
        let prev = 0;
        for (let t = 0; t < 6; t += dt) {
          springStep(s, 1, omega, dt);
          expect(Number.isFinite(s.x) && Number.isFinite(s.v)).toBe(true);
          expect(s.x).toBeGreaterThanOrEqual(prev - 1e-12); // monotonic approach from rest
          prev = s.x;
          peak = Math.max(peak, s.x);
        }
        expect(peak).toBeLessThanOrEqual(1 + 1e-9);
        expect(s.x).toBeCloseTo(1, 3);
        expect(Math.abs(s.v)).toBeLessThan(1e-2);
      }
    }
  });

  it('gives the same answer in one large step as in many small ones', () => {
    const a = { x: 3, v: -20 };
    const b = { x: 3, v: -20 };
    springStep(a, -1, 9, 0.1);
    for (let i = 0; i < 100; i++) springStep(b, -1, 9, 0.001);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.v).toBeCloseTo(b.v, 6);
  });

  it('stays bounded with a large incoming velocity and ignores a zero step', () => {
    const s = { x: 0, v: 500 };
    springStep(s, 0, 10, 0);
    expect(s).toEqual({ x: 0, v: 500 });
    let peak = 0;
    for (let i = 0; i < 100; i++) peak = Math.max(peak, Math.abs(springStep(s, 0, 10, 0.1).x));
    expect(peak).toBeLessThan(500 / 10); // analytic bound v0 / (e * omega)
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
  });
});

describe('headBob', () => {
  it('dips on each footfall, alternates sides and vanishes at rest', () => {
    const out = { x: 0, y: 0, roll: 0 };
    expect(headBob(3, 1, 0, out).y).toBeLessThan(0);
    expect(headBob(3.5, 1, 0, out).y).toBeGreaterThan(0);
    const left = headBob(0.5, 1, 0, { x: 0, y: 0, roll: 0 });
    const right = headBob(1.5, 1, 0, { x: 0, y: 0, roll: 0 });
    expect(left.x).toBeCloseTo(-right.x);
    expect(left.roll).toBeCloseTo(-right.roll);
    expect(Math.abs(headBob(0.5, 1, 1, out).x)).toBeGreaterThan(Math.abs(left.x));
    headBob(0.37, 0, 1, out);
    expect(Math.abs(out.x) + Math.abs(out.y) + Math.abs(out.roll)).toBe(0);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });
});

/** The over-the-shoulder view; with no options the rig starts in first person. */
const TP = { firstPerson: false } as const;

function subjectAt(x: number, z: number): CameraSubject {
  return { position: new THREE.Vector3(x, 0, z), vx: 0, vz: 0, speed: 0, running: false, stepPhase: 0 };
}

/** Signed distance from a point to an axis-aligned box given by centre and half extents. */
function boxDistance(p: THREE.Vector3, c: THREE.Vector3, h: THREE.Vector3): number {
  const dx = Math.abs(p.x - c.x) - h.x;
  const dy = Math.abs(p.y - c.y) - h.y;
  const dz = Math.abs(p.z - c.z) - h.z;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
  return outside + Math.min(Math.max(dx, dy, dz), 0);
}

function forward(camera: THREE.PerspectiveCamera): THREE.Vector3 {
  camera.updateMatrixWorld(true);
  return camera.getWorldDirection(new THREE.Vector3());
}

describe('createCameraRig', () => {
  it('sits over the right shoulder at head height and looks past the player', () => {
    const camera = new THREE.PerspectiveCamera();
    const rig = createCameraRig(camera, null, TP);
    const s = subjectAt(2, -3);
    rig.reset(s, Math.PI); // facing -Z
    expect(camera.fov).toBeCloseTo(TP_FOV);
    expect(camera.position.x).toBeCloseTo(2 + TP_SHOULDER, 5);
    expect(camera.position.z).toBeGreaterThan(-3 + TP_BOOM * 0.95);
    expect(camera.position.y).toBeGreaterThan(TP_PIVOT_HEIGHT);
    expect(camera.position.y).toBeLessThan(2.2);
    const f = forward(camera);
    expect(f.z).toBeLessThan(-0.95);
    expect(Math.abs(f.x)).toBeLessThan(1e-6);
    // The view line passes over the shoulder point, not through the head.
    const t = (-3 - camera.position.z) / f.z;
    expect(camera.position.y + f.y * t).toBeCloseTo(TP_PIVOT_HEIGHT, 5);
    expect(rig.headDistance).toBeGreaterThan(3);
  });

  it('lags behind a moving subject, settles, and leads slightly once up to speed', () => {
    const camera = new THREE.PerspectiveCamera();
    const rig = createCameraRig(camera, null, TP);
    const s = subjectAt(0, 0);
    rig.reset(s, Math.PI);
    const rest = camera.position.z - s.position.z;
    s.vz = -2.2;
    s.speed = 2.2;
    let maxGap = rest;
    for (let i = 0; i < 20; i++) {
      s.position.z += s.vz / 60;
      s.stepPhase += 2.2 / 60;
      rig.update(1 / 60, s);
      maxGap = Math.max(maxGap, camera.position.z - s.position.z);
    }
    expect(maxGap).toBeGreaterThan(rest + 0.1); // trails on the start
    expect(maxGap).toBeLessThan(rest + 1);
    for (let i = 0; i < 240; i++) {
      s.position.z += s.vz / 60;
      s.stepPhase += 2.2 / 60;
      rig.update(1 / 60, s);
    }
    expect(camera.position.z - s.position.z).toBeLessThan(rest); // then looks ahead
    s.vz = 0;
    s.speed = 0;
    for (let i = 0; i < 300; i++) rig.update(1 / 60, s);
    expect(camera.position.z - s.position.z).toBeCloseTo(rest, 3);
    expect(camera.position.x).toBeCloseTo(TP_SHOULDER, 3);
    expect(camera.rotation.z).toBeCloseTo(0, 5);
  });

  it('keeps clear of walls from every angle, including large frame steps, and eases back out', () => {
    const half = new THREE.Vector3(6, 2, 1);
    const centre = new THREE.Vector3(0, 2, -6);
    const geometry = new THREE.BoxGeometry(12, 4, 2).translate(centre.x, centre.y, centre.z);
    const bvh = new MeshBVH(geometry);
    const camera = new THREE.PerspectiveCamera();
    const rig = createCameraRig(camera, bvhCollider(bvh), TP);
    const s = subjectAt(0, -4.4); // 0.6 m from the wall face at z = -5
    rig.reset(s, 0);
    let closest = Infinity;
    let shortest = Infinity;
    for (const dt of [1 / 60, 1 / 20, 0.1]) {
      for (let i = 0; i < 400; i++) {
        rig.look(37, i % 50 < 25 ? 9 : -9);
        if (i % 40 === 0) rig.zoom(i % 80 === 0 ? 5 : -5);
        rig.update(dt, s);
        closest = Math.min(closest, boxDistance(camera.position, centre, half));
        shortest = Math.min(shortest, rig.headDistance);
        expect(camera.position.y).toBeGreaterThan(0.2);
      }
    }
    expect(closest).toBeGreaterThan(CAMERA_RADIUS - 1e-3);
    expect(shortest).toBeLessThan(0.6); // it did have to pull in

    // Back to the wall with the camera on the far side of it: pulled in tight, then released when the player
    // steps away, without a jump.
    rig.reset(s, 0);
    rig.zoom(-100);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, s);
    expect(rig.headDistance).toBeLessThan(0.6);
    s.position.z = 4;
    rig.reset(s, 0);
    expect(rig.headDistance).toBeGreaterThan(TP_BOOM_MIN * 0.9);

    // A wall on the right takes the shoulder offset before it takes the boom.
    const side = new THREE.BoxGeometry(1, 4, 30).translate(0.5 + 0.5, 2, 20);
    const sideBvh = new MeshBVH(side);
    const rig2 = createCameraRig(camera, bvhCollider(sideBvh), TP);
    const s2 = subjectAt(0, 20);
    rig2.reset(s2, Math.PI); // facing -Z, right is +X, wall face at x = 0.5
    expect(camera.position.x).toBeLessThanOrEqual(0.5 - CAMERA_RADIUS + 1e-6);
    expect(camera.position.z - s2.position.z).toBeGreaterThan(TP_BOOM * 0.9);
    // Walk clear of it and the offset eases back rather than snapping.
    s2.position.x = -5;
    rig2.reset(s2, Math.PI);
    expect(camera.position.x - s2.position.x).toBeCloseTo(TP_SHOULDER, 5);

    geometry.dispose();
    side.dispose();
  });

  it('eases the boom back out after an obstruction clears', () => {
    const geometry = new THREE.BoxGeometry(12, 4, 2).translate(0, 2, 3);
    const bvh = new MeshBVH(geometry);
    const camera = new THREE.PerspectiveCamera();
    const rig = createCameraRig(camera, bvhCollider(bvh), TP);
    const s = subjectAt(0, 0); // wall face 2 m behind the player
    rig.reset(s, Math.PI);
    expect(camera.position.z).toBeLessThanOrEqual(2 - CAMERA_RADIUS + 1e-6);
    const pulled = rig.headDistance;
    s.position.z = -6;
    // Teleporting the subject without a reset stands in for the wall ending.
    rig.update(1 / 60, s);
    expect(rig.headDistance).toBeLessThan(pulled + 1.2);
    for (let i = 0; i < 240; i++) rig.update(1 / 60, s);
    expect(camera.position.z - s.position.z).toBeGreaterThan(TP_BOOM * 0.95);
    geometry.dispose();
  });

  it('zooms within limits and ignores the wheel in first person', () => {
    const camera = new THREE.PerspectiveCamera();
    const rig = createCameraRig(camera, null, TP);
    const s = subjectAt(0, 0);
    rig.reset(s, Math.PI);
    rig.zoom(100);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, s);
    expect(camera.position.distanceTo(new THREE.Vector3(TP_SHOULDER, TP_PIVOT_HEIGHT, 0))).toBeCloseTo(TP_BOOM_MAX, 2);
    rig.zoom(-100);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, s);
    expect(camera.position.distanceTo(new THREE.Vector3(TP_SHOULDER, TP_PIVOT_HEIGHT, 0))).toBeCloseTo(TP_BOOM_MIN, 2);
  });

  it('starts in first person: the eye at 1.65 m behind a 75 degree lens, bobbing with the steps, kicked by a sprint', () => {
    expect(FP_EYE_HEIGHT).toBe(1.65);
    expect(FP_FOV).toBe(75);
    const camera = new THREE.PerspectiveCamera();
    const rig = createCameraRig(camera, null);
    const s = subjectAt(1, 1);
    expect(rig.firstPerson).toBe(true);
    rig.reset(s, Math.PI);
    // The very first frame is already the eye view: nothing to blend in from.
    expect(rig.viewBlend).toBe(1);
    expect(camera.position.y).toBeCloseTo(FP_EYE_HEIGHT, 6);
    expect(camera.fov).toBeCloseTo(FP_FOV, 6);
    expect(forward(camera).z).toBeLessThan(-0.999);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, s);
    expect(rig.viewBlend).toBe(1);
    expect(camera.position.x).toBeCloseTo(1, 6);
    expect(camera.position.z).toBeCloseTo(1, 6);
    expect(Math.abs(camera.position.y - FP_EYE_HEIGHT)).toBeLessThanOrEqual(BREATH_Y + 1e-9);
    expect(camera.fov).toBeCloseTo(FP_FOV, 2);

    // Mouse right turns the view right; mouse down looks down, and pitch stops short of straight down.
    rig.look(Math.PI / 2 / LOOK_SENSITIVITY, 0);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, s);
    expect(forward(camera).x).toBeGreaterThan(0.99); // was facing -Z, and +X is to its right
    rig.look(-Math.PI / LOOK_SENSITIVITY, 0);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, s);
    expect(forward(camera).x).toBeLessThan(-0.99);
    rig.look(0, 100000);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, s);
    const down = forward(camera);
    expect(down.y).toBeLessThan(-0.9);
    expect(down.y).toBeGreaterThan(-1);

    // Walking: the eye moves vertically around its rest height in time with the steps.
    rig.reset(s, Math.PI);
    s.speed = 2.2;
    s.vz = -2.2;
    let lo = Infinity;
    let hi = -Infinity;
    let roll = 0;
    for (let i = 0; i < 180; i++) {
      s.stepPhase += 2.2 / 60;
      rig.update(1 / 60, s);
      lo = Math.min(lo, camera.position.y);
      hi = Math.max(hi, camera.position.y);
      roll = Math.max(roll, Math.abs(camera.rotation.z));
    }
    expect(hi - lo).toBeGreaterThan(0.04);
    expect(hi - lo).toBeLessThan(0.09);
    expect((hi + lo) / 2).toBeCloseTo(FP_EYE_HEIGHT, 1);
    expect(roll).toBeGreaterThan(0.002);
    expect(roll).toBeLessThan(0.02);

    s.running = true;
    s.speed = 5;
    for (let i = 0; i < 120; i++) rig.update(1 / 60, s);
    expect(camera.fov).toBeGreaterThan(FP_FOV + 5);
    s.running = false;
    s.speed = 0;
    s.vz = 0;
    for (let i = 0; i < 240; i++) rig.update(1 / 60, s);
    expect(camera.fov).toBeCloseTo(FP_FOV, 2);
    expect(Math.abs(camera.position.y - FP_EYE_HEIGHT)).toBeLessThanOrEqual(BREATH_Y + 1e-3);

    // V goes over the shoulder and back.
    rig.setFirstPerson(false);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, s);
    expect(rig.viewBlend).toBe(0);
    expect(camera.fov).toBeCloseTo(TP_FOV, 2);
    expect(rig.headDistance).toBeGreaterThan(TP_BOOM * 0.9);
  });

  it('carries weight in first person: breath at rest, a lean into a strafe, a dip where a descent ends', () => {
    const camera = new THREE.PerspectiveCamera();
    const rig = createCameraRig(camera, null);
    const s = subjectAt(0, 0);
    rig.reset(s, Math.PI); // facing -Z, right is +X

    // Standing still the eye rides the breath: a few millimetres, slowly, with a trace of nod.
    let lo = Infinity;
    let hi = -Infinity;
    let nod = 0;
    for (let i = 0; i < 600; i++) {
      rig.update(1 / 60, s);
      lo = Math.min(lo, camera.position.y);
      hi = Math.max(hi, camera.position.y);
      nod = Math.max(nod, Math.abs(camera.rotation.x));
    }
    expect(hi - lo).toBeGreaterThan(BREATH_Y);
    expect(hi - lo).toBeLessThanOrEqual(2 * BREATH_Y + 1e-9);
    expect(nod).toBeGreaterThan(0);
    expect(nod).toBeLessThanOrEqual(BREATH_PITCH + 1e-9);

    // Strafing right rolls the view into the move and comes back level.
    s.vx = 2.2;
    s.speed = 2.2;
    for (let i = 0; i < 90; i++) {
      s.position.x += s.vx / 60;
      rig.update(1 / 60, s);
    }
    const lean = camera.rotation.z;
    expect(lean).toBeLessThan(-0.005);
    expect(lean).toBeGreaterThan(-0.03);
    s.vx = 0;
    s.speed = 0;
    for (let i = 0; i < 240; i++) rig.update(1 / 60, s);
    expect(Math.abs(camera.rotation.z)).toBeLessThan(1e-3);

    // Down a slope at walking pace, then onto the flat: the eye sinks under its rest height and recovers.
    rig.reset(s, Math.PI);
    for (let i = 0; i < 60; i++) {
      s.position.y -= 1.5 / 60;
      rig.update(1 / 60, s);
    }
    let sink = 0;
    for (let i = 0; i < 40; i++) {
      rig.update(1 / 60, s);
      sink = Math.min(sink, camera.position.y - (s.position.y + FP_EYE_HEIGHT));
    }
    expect(sink).toBeLessThan(-0.01);
    expect(sink).toBeGreaterThanOrEqual(-DIP_LIMIT - BREATH_Y - 1e-9);
    for (let i = 0; i < 240; i++) rig.update(1 / 60, s);
    expect(Math.abs(camera.position.y - (s.position.y + FP_EYE_HEIGHT))).toBeLessThanOrEqual(BREATH_Y + 1e-3);
    // Climbing and stopping does not dip.
    for (let i = 0; i < 60; i++) {
      s.position.y += 1.5 / 60;
      rig.update(1 / 60, s);
    }
    let after = 0;
    for (let i = 0; i < 6; i++) {
      rig.update(1 / 60, s);
      after = Math.min(after, camera.position.y - (s.position.y + FP_EYE_HEIGHT));
    }
    expect(after).toBeGreaterThan(-0.2); // only the follow spring catching up, no kick below it

    // A small folk sees from its own height; nonsense is refused.
    rig.setEyeHeight(0.9);
    expect(rig.eyeHeight).toBe(0.9);
    rig.setEyeHeight(Number.NaN);
    rig.setEyeHeight(40);
    expect(rig.eyeHeight).toBe(3);
    rig.setEyeHeight(0.9);
    rig.reset(s, Math.PI);
    expect(camera.position.y).toBeCloseTo(s.position.y + 0.9, 6);
  });

  it('frames a conversation as a two-shot and returns to the previous view', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.aspect = 16 / 9;
    const rig = createCameraRig(camera, null, TP);
    const s = subjectAt(0, 0);
    rig.reset(s, Math.PI);
    const before = camera.position.clone();
    const yawBefore = rig.yaw;
    const npc = new THREE.Vector3(0.4, 0, -2);
    rig.frame(npc);
    rig.look(500, 500); // ignored while framed
    for (let i = 0; i < 240; i++) rig.update(1 / 60, s);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    // Both heads are in front of the lens and inside the frame, on opposite sides of centre.
    const a = new THREE.Vector3(0, 1.6, 0).project(camera);
    const b = new THREE.Vector3(npc.x, 1.6, npc.z).project(camera);
    for (const p of [a, b]) {
      expect(Math.abs(p.x)).toBeLessThan(0.85);
      expect(Math.abs(p.y)).toBeLessThan(0.85);
      expect(p.z).toBeLessThan(1);
    }
    expect(a.x * b.x).toBeLessThan(0);
    expect(camera.fov).toBeLessThan(TP_FOV);

    rig.frame(null);
    for (let i = 0; i < 360; i++) rig.update(1 / 60, s);
    expect(camera.position.distanceTo(before)).toBeLessThan(0.01);
    expect(angleDelta(rig.yaw, yawBefore)).toBeCloseTo(0, 3);
    expect(camera.fov).toBeCloseTo(TP_FOV, 2);

    // In first person the view turns to the speaker without leaving the eye.
    rig.setFirstPerson(true);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, s);
    rig.frame(new THREE.Vector3(3, 0, 0));
    for (let i = 0; i < 240; i++) rig.update(1 / 60, s);
    expect(camera.position.y).toBeCloseTo(FP_EYE_HEIGHT, 4);
    expect(forward(camera).x).toBeGreaterThan(0.99);
    // The lens closes in on the speaker and opens again afterwards.
    expect(camera.fov).toBeCloseTo(FP_FRAME_FOV, 1);
    rig.frame(null);
    for (let i = 0; i < 360; i++) rig.update(1 / 60, s);
    expect(camera.fov).toBeCloseTo(FP_FOV, 1);
  });
});
