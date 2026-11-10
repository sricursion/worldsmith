import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCreatures } from '../../app/src/engine/creatures';
import type { CreatureBehaviour, CreatureFamily, CreatureSpec } from '../../app/src/world/spec';
import { makeRng } from '../../app/src/world/rng';

const bounds = { minX: -70, maxX: 70, minZ: -60, maxZ: 60 };
const heightAt = (x: number, z: number): number => 2 * Math.sin(x * 0.07) + 1.5 * Math.cos(z * 0.05);

function fakeNav(): { nearest(p: THREE.Vector3): THREE.Vector3; randomPointNear(p: THREE.Vector3, r: number): THREE.Vector3 } {
  const rng = makeRng(5, 'nav');
  const out = new THREE.Vector3();
  const fix = (v: THREE.Vector3): THREE.Vector3 => {
    v.set(Math.min(69, Math.max(-69, v.x)), 0, Math.min(59, Math.max(-59, v.z)));
    v.y = heightAt(v.x, v.z);
    return v;
  };
  return {
    nearest: (p) => fix(out.copy(p)),
    randomPointNear: (p, r) => fix(out.set(p.x + rng.range(-r, r), 0, p.z + rng.range(-r, r))),
  };
}

const kind = (id: string, family: CreatureFamily, behaviour: CreatureBehaviour, size: number, count: number, haunt: string, dials: CreatureSpec['dials'] = {}): CreatureSpec => ({
  id, name: id, family, dials, size, count, behaviour, haunt, body: '#6a5a48', accent: '#3a3028', glow: '#ff8a3a', note: `a ${id}`,
});

const SPECS: CreatureSpec[] = [
  kind('deer', 'quadruped', 'graze', 1.8, 6, 'wild'),
  kind('wolf', 'quadruped', 'stalk', 1.4, 3, 'wild'),
  kind('hound', 'quadruped', 'patrol', 1, 2, 'plaza'),
  kind('bear', 'quadruped', 'sleep', 2.4, 1, 'inn'),
  kind('crab', 'crawler', 'roam', 0.6, 5, 'water', { pairs: 4, claws: 1 }),
  kind('adder', 'serpent', 'roam', 3, 2, 'wild'),
  kind('titan', 'colossus', 'roam', 24, 1, 'wild', { glow: 1 }),
  kind('sentry', 'biped', 'guard', 2.2, 1, 'forge'),
  kind('dragon', 'winged', 'circle', 14, 1, 'sky', { glow_eyes: 1, limbs: 4 }),
  kind('crow', 'bird', 'perch', 0.45, 5, 'wild'),
  kind('gull', 'bird', 'flock', 0.6, 8, 'sky'),
  kind('jelly', 'floater', 'roam', 1.2, 3, 'plaza', { glow: 1 }),
  kind('carp', 'swimmer', 'roam', 0.8, 4, 'water'),
  kind('moths', 'swarm', 'flock', 0.12, 3, 'plaza', { glow: 1, units: 40 }),
];
const GROUND = new Set(['body_quadruped', 'body_crawler', 'body_serpent', 'body_colossus', 'body_biped']);

function world(quality: 0 | 1 | 2 = 2): { scene: THREE.Scene; life: ReturnType<typeof createCreatures> } {
  const scene = new THREE.Scene();
  const doors = new Map<string, THREE.Vector3>([['inn', new THREE.Vector3(12, 0, 8)], ['forge', new THREE.Vector3(-14, 0, 6)], ['mill', new THREE.Vector3(4, 0, -16)]]);
  const life = createCreatures(scene, {
    creatures: SPECS, nav: fakeNav(), heightAt, bounds, doors, plaza: { x: 0, z: 0 }, water: [{ kind: 'pond', x: 40, z: -30, r: 12 }],
    rng: makeRng(9, 'creatures'), quality,
  });
  return { scene, life };
}
const countObjects = (scene: THREE.Scene): number => {
  let n = 0;
  scene.traverse(() => n++);
  return n;
};

describe('createCreatures', () => {
  it('runs 500 frames with constant object counts, ground bodies in bounds and on the land', () => {
    const { scene, life } = world();
    const root = scene.children[0] as THREE.Group;
    const before = countObjects(scene);
    expect(root.children.length).toBeGreaterThan(SPECS.length);
    const focus = new THREE.Vector3();
    const dragon = root.children.find((c) => c.name === 'body_winged') as THREE.Object3D;
    const titan = root.children.find((c) => c.name === 'body_colossus') as THREE.Object3D;
    let turned = 0, lastYaw = dragon.rotation.y, travelled = 0, minTitanR = Infinity, birdsAloft = 0, maxTurn = 0, bad = '';
    const last = dragon.position.clone();
    const moved = new Map<THREE.Object3D, THREE.Vector3>(root.children.map((c) => [c, c.position.clone()]));
    for (let f = 0; f < 500; f++) {
      focus.set(Math.sin(f * 0.02) * 50, 0, Math.cos(f * 0.013) * 45);
      focus.y = heightAt(focus.x, focus.z) + 1.6;
      life.update(1 / 30, focus, 9 + f * 0.01);
      for (const c of root.children) {
        const p = c.position;
        if (!Number.isFinite(p.x + p.y + p.z + c.rotation.y)) bad = `${c.name} not finite at frame ${f}`;
        if (c.name === 'body_bird' && p.y > heightAt(p.x, p.z) + 2) birdsAloft++;
        if (!GROUND.has(c.name)) continue;
        if (p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ) bad = `${c.name} left the bounds at frame ${f}`;
        if (Math.abs(p.y - heightAt(p.x, p.z)) > 1e-6) bad = `${c.name} off the land at frame ${f}`;
      }
      const r = Math.hypot(dragon.position.x, dragon.position.z);
      if (dragon.position.y < heightAt(dragon.position.x, dragon.position.z) + 15 || r < 30 || r > 90) bad = `dragon out of its orbit at frame ${f}`;
      let dy = dragon.rotation.y - lastYaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      if (f > 0) maxTurn = Math.max(maxTurn, Math.abs(dy));
      turned += dy;
      lastYaw = dragon.rotation.y;
      travelled += dragon.position.distanceTo(last);
      last.copy(dragon.position);
      minTitanR = Math.min(minTitanR, Math.hypot(titan.position.x, titan.position.z));
    }
    expect(bad).toBe('');
    expect(countObjects(scene)).toBe(before);
    // The dragon sweeps round smoothly: no snap turns, a good part of a lap in 17 seconds.
    expect(maxTurn).toBeLessThan(0.05);
    expect(Math.abs(turned)).toBeGreaterThan(1);
    expect(travelled).toBeGreaterThan(100);
    // The giant keeps outside the doors (the farthest is about 16.5 m from the plaza).
    expect(minTitanR).toBeGreaterThan(18);
    expect(birdsAloft).toBeGreaterThan(0);
    let walkers = 0;
    for (const [c, p] of moved) if (GROUND.has(c.name) && c.position.distanceTo(p) > 1) walkers++;
    expect(walkers).toBeGreaterThan(5);
    const swarm = root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    expect(swarm.count).toBeLessThanOrEqual(200);
    let finite = true;
    for (const v of swarm.instanceMatrix.array) if (!Number.isFinite(v)) finite = false;
    expect(finite).toBe(true);
    life.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('reports the nearest creature and the nearest glowing ones without allocating new results', () => {
    const { scene, life } = world(0);
    const focus = new THREE.Vector3(0, 1.6, 0);
    for (let f = 0; f < 30; f++) life.update(1 / 60, focus, 12);
    const a = life.nearest(focus, 500);
    expect(a).not.toBeNull();
    expect(SPECS.some((s) => s.id === a?.id && s.note === a.note)).toBe(true);
    expect(life.nearest(focus, 500)).toBe(a);
    expect(life.nearest(new THREE.Vector3(0, 900, 0), 5)).toBeNull();
    const lights = life.lights();
    expect(lights.length).toBeGreaterThan(0);
    expect(lights.length).toBeLessThanOrEqual(4);
    expect(life.lights()).toBe(lights);
    for (const l of lights) expect(l.radius).toBeGreaterThan(0);
    life.dispose();
    life.update(1 / 60, focus, 12);
    expect(scene.children).toHaveLength(0);
  });

  it('leaves a sleeper where it lies when someone walks up', () => {
    const scene = new THREE.Scene();
    const life = createCreatures(scene, {
      creatures: [kind('bear', 'quadruped', 'sleep', 2.4, 1, 'plaza')], nav: fakeNav(), heightAt, bounds, doors: new Map(), plaza: { x: 0, z: 0 },
      rng: makeRng(3, 'c'),
    });
    const body = (scene.children[0] as THREE.Group).children[0] as THREE.Object3D;
    const at = body.position.clone();
    const focus = new THREE.Vector3(30, 2, 0);
    for (let f = 0; f < 120; f++) {
      focus.x = 30 - f * 0.25;
      life.update(1 / 60, focus, 2);
    }
    expect(body.position.distanceTo(at)).toBeLessThan(1e-6);
    life.dispose();
  });
});
