import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildNav } from '../../app/src/engine/nav';
import { disposeMeshes, makeWorld } from './helpers';

function pathLength(pts: THREE.Vector3[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += (pts[i] as THREE.Vector3).distanceTo(pts[i - 1] as THREE.Vector3);
  return l;
}

describe('buildNav', () => {
  it('builds a navmesh from a plane with boxes and snaps points to it', async () => {
    const { ground, statics } = makeWorld();
    const nav = await buildNav(statics, ground);
    const p = nav.nearest(new THREE.Vector3(10, 0.3, 10));
    expect(p.x).toBeCloseTo(10, 0);
    expect(p.z).toBeCloseTo(10, 0);
    expect(Math.abs(p.y)).toBeLessThan(0.5);
    // The top of the box is walkable geometry too, on its own island at roof height.
    const roof = nav.nearest(new THREE.Vector3(0, 4, 0));
    expect(roof.y).toBeGreaterThan(3.5);
    expect(nav.debugMesh()).toBeInstanceOf(THREE.Object3D);
    nav.dispose();
    disposeMeshes([ground, ...statics]);
  });

  it('routes a crowd agent around a box, longer than the straight line', async () => {
    const { ground, statics } = makeWorld();
    const nav = await buildNav(statics, ground);
    const start = new THREE.Vector3(-12, 0, 0);
    const goal = new THREE.Vector3(12, 0, 0);
    const agent = nav.addAgent(start, { speed: 3 });
    agent.setTarget(goal);
    const trail: THREE.Vector3[] = [agent.position()];
    for (let i = 0; i < 60 * 15; i++) {
      nav.update(1 / 60);
      if (i % 6 === 0) trail.push(agent.position());
    }
    const end = agent.position();
    expect(end.distanceTo(goal)).toBeLessThan(1.5);
    expect(pathLength(trail)).toBeGreaterThan(24.5);
    for (const t of trail) expect(Math.max(Math.abs(t.x), Math.abs(t.z))).toBeGreaterThan(3.9);
    agent.remove();
    nav.dispose();
    disposeMeshes([ground, ...statics]);
  });

  it('moveAlongSurface walks freely in the open and stops at a wall', async () => {
    const { ground, statics } = makeWorld();
    const nav = await buildNav(statics, ground);
    const open = nav.moveAlongSurface(new THREE.Vector3(-20, 0, 10), new THREE.Vector3(2, 0, 0));
    expect(open.x).toBeCloseTo(-18, 1);
    expect(open.z).toBeCloseTo(10, 1);

    // Walk east into the box face at x = -4 along z = 0.
    let p = new THREE.Vector3(-10, 0, 0);
    for (let i = 0; i < 200; i++) p = nav.moveAlongSurface(p, new THREE.Vector3(0.1, 0, 0));
    expect(p.x).toBeLessThan(-3.9);
    expect(p.x).toBeGreaterThan(-5.5);
    expect(Math.abs(p.y)).toBeLessThan(0.5);

    // Slides along the wall when pushed diagonally.
    let s = new THREE.Vector3(-4.7, 0, 0);
    for (let i = 0; i < 20; i++) s = nav.moveAlongSurface(s, new THREE.Vector3(0.1, 0, 0.1));
    expect(s.z).toBeGreaterThan(1);
    expect(s.x).toBeLessThan(-3.9);
    nav.dispose();
    disposeMeshes([ground, ...statics]);
  });

  it('follows a low step (porch) with the right height', async () => {
    const { ground, statics } = makeWorld([[0, 0, 10, 10, 0.4]]);
    const nav = await buildNav(statics, ground);
    let p = new THREE.Vector3(-8, 0, 0);
    for (let i = 0; i < 100; i++) p = nav.moveAlongSurface(p, new THREE.Vector3(0.15, 0, 0));
    expect(p.x).toBeGreaterThan(5);
    expect(p.y).toBeGreaterThan(0.3);
    nav.dispose();
    disposeMeshes([ground, ...statics]);
  });

  it('randomPointNear returns a walkable point within the radius', async () => {
    const { ground, statics } = makeWorld();
    const nav = await buildNav(statics, ground);
    const c = new THREE.Vector3(15, 0, 15);
    for (let i = 0; i < 10; i++) {
      const r = nav.randomPointNear(c, 5);
      expect(Math.hypot(r.x - c.x, r.z - c.z)).toBeLessThan(5.5);
    }
    nav.dispose();
    disposeMeshes([ground, ...statics]);
  });

  it('builds and disposes 30 navmeshes in a loop in bounded time', async () => {
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) {
      const { ground, statics } = makeWorld([[0, 0, 6 + (i % 4), 6, 3]]);
      const nav = await buildNav(statics, ground);
      nav.addAgent(new THREE.Vector3(10, 0, 10)).setTarget(new THREE.Vector3(-10, 0, -10));
      nav.update(1 / 30);
      nav.debugMesh();
      nav.dispose();
      nav.dispose(); // idempotent
      disposeMeshes([ground, ...statics]);
    }
    expect(performance.now() - t0).toBeLessThan(60_000);
  }, 90_000);
});
