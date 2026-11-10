import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CharacterRig } from '../../app/src/engine/character';
import type { Input } from '../../app/src/engine/input';
import { buildNav } from '../../app/src/engine/nav';
import { FREE_MAX_SLOPE, FREE_MAX_WADE, HOME_FAR, createPlayer, freeStep } from '../../app/src/engine/player';
import type { PlayerLand } from '../../app/src/engine/player';
import { disposeMeshes, makeWorld } from './helpers';

function fakeRig(): CharacterRig {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3), new THREE.MeshStandardMaterial()));
  return {
    root, mixer: new THREE.AnimationMixer(new THREE.Group()), play: () => undefined, setPalette: () => undefined,
    lookAt: () => undefined, update: () => undefined, dispose: () => undefined,
  } as unknown as CharacterRig;
}

interface Keys { axis: { x: number; y: number }; shift: boolean }
function fakeInput(state: Keys): Input {
  return {
    down: (c: string) => state.shift && c === 'ShiftLeft',
    axis: () => state.axis,
    onKey: () => () => undefined,
    isLocked: () => false,
    exitLock: () => undefined,
    wheelDelta: () => 0,
    pointerDelta: () => ({ dx: 0, dy: 0 }),
    dispose: () => undefined,
  };
}

const CORE = { minX: -27, maxX: 27, minZ: -27, maxZ: 27 };
const flat = (h = 0): PlayerLand => ({ heightAt: () => h, coreBounds: CORE });

describe('freeStep', () => {
  const out = { x: 0, z: 0 };

  it('takes the whole step on open ground and none without one', () => {
    expect(freeStep(flat(), 3, 4, 0.1, -0.2, out)).toBe(true);
    expect(out).toEqual({ x: 3.1, z: 3.8 });
    expect(freeStep(flat(), 3, 4, 0, 0, out)).toBe(false);
    expect(out).toEqual({ x: 3, z: 4 });
  });

  it('refuses to climb a slope steeper than forty degrees, slides along it, and goes down it freely', () => {
    const steep: PlayerLand = { heightAt: (x) => x * (FREE_MAX_SLOPE + 0.2), coreBounds: CORE };
    expect(freeStep(steep, 0, 0, 0.1, 0, out)).toBe(false);
    expect(out).toEqual({ x: 0, z: 0 });
    // Taken at enough of an angle the same hillside is walkable: what counts is the rise along the step.
    expect(freeStep(steep, 0, 0, 0.1, 0.1, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.1, 6);
    // Up and across a face too steep even for that: only the part along the hillside is taken.
    const face: PlayerLand = { heightAt: (x) => x * 3, coreBounds: CORE };
    expect(freeStep(face, 0, 0, 0.1, 0.1, out)).toBe(true);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(0.1, 6);
    expect(freeStep(steep, 0, 0, -0.1, 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(-0.1, 6);
    const gentle: PlayerLand = { heightAt: (x) => x * (FREE_MAX_SLOPE - 0.05), coreBounds: CORE };
    expect(freeStep(gentle, 0, 0, 0.1, 0, out)).toBe(true);
  });

  it('wades to the knee and no deeper, along the shore instead, and always back out', () => {
    // A beach falling away to the east: 10 cm deeper every metre past x = 0.
    const shore: PlayerLand = { heightAt: (x) => -Math.max(0, x) * 0.1, waterDepthAt: (x) => Math.max(0, x) * 0.1, coreBounds: CORE };
    let x = -1;
    let z = 0;
    for (let i = 0; i < 400; i++) {
      freeStep(shore, x, z, 0.05, 0.02, out);
      x = out.x;
      z = out.z;
      expect(shore.waterDepthAt?.(x, z) ?? 0).toBeLessThanOrEqual(FREE_MAX_WADE + 1e-9);
    }
    expect(x).toBeGreaterThan(4);
    expect(z).toBeGreaterThan(6); // it kept moving along the shore
    // Dropped in deep water, the way to the shallows is open and the way further out is not.
    expect(freeStep(shore, 20, 0, 0.1, 0, out)).toBe(false);
    expect(freeStep(shore, 20, 0, -0.1, 0, out)).toBe(true);
  });

  it('never returns a bad number', () => {
    const bad: PlayerLand = { heightAt: (x) => (x > 1 ? Number.NaN : 0), coreBounds: CORE };
    expect(freeStep(bad, 0.95, 0, 0.1, 0, out)).toBe(false);
    expect(out).toEqual({ x: 0.95, z: 0 });
    expect(freeStep(flat(), 0, 0, Number.NaN, 0, out)).toBe(false);
    expect(Number.isFinite(out.x + out.z)).toBe(true);
  });
});

describe('the player beyond the navmesh', () => {
  it('walks off the edge of the navmesh, two kilometres straight out, and back onto it, with no step in height', async () => {
    const { ground, statics } = makeWorld([[20, 20, 2, 2, 2]]);
    const nav = await buildNav(statics, ground);
    const state: Keys = { axis: { x: 0, y: 0 }, shift: true };
    // The open land lies a little off the navmesh's own height, as a real one does.
    const player = createPlayer(fakeRig(), nav, new THREE.PerspectiveCamera(), fakeInput(state), statics, { firstPerson: false, land: flat(0.12) });
    player.teleport(new THREE.Vector3(0, 0, 5), Math.PI); // facing -Z
    expect(player.roaming).toBe(false);
    expect(player.distanceFromHome).toBeUndefined();
    expect(player.homeBearing).toBeUndefined();

    state.axis.y = 1;
    let lastY = player.position.y;
    let worstStep = 0;
    let left = Number.NaN;
    for (let i = 0; i < 12400; i++) {
      player.update(1 / 30);
      const p = player.position;
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      worstStep = Math.max(worstStep, Math.abs(p.y - lastY));
      lastY = p.y;
      if (Number.isNaN(left) && player.roaming) left = p.z;
    }
    // It left where the navmesh ends (the ground is 60 m square), not before and not at a wall.
    expect(left).toBeLessThan(-28.5);
    expect(left).toBeGreaterThan(-31);
    expect(player.roaming).toBe(true);
    expect(player.position.z).toBeLessThan(-2000);
    expect(Math.abs(player.position.x)).toBeLessThan(0.5);
    expect(player.position.y).toBeCloseTo(0.12, 3);
    expect(worstStep).toBeLessThan(0.05);
    expect(player.speed).toBeCloseTo(5, 1);
    // The way home: straight back along +Z.
    expect(player.distanceFromHome).toBeCloseTo(-player.position.z - 27, 3);
    expect(Math.abs(player.homeBearing ?? 9)).toBeLessThan(0.01);

    // Back the way it came.
    state.axis.y = -1;
    let back = false;
    for (let i = 0; i < 14000 && player.position.z < -12; i++) {
      player.update(1 / 30);
      worstStep = Math.max(worstStep, Math.abs(player.position.y - lastY));
      lastY = player.position.y;
      if (player.position.z > -HOME_FAR - 27 + 1) expect(player.distanceFromHome).toBeUndefined();
      if (!player.roaming) back = true;
    }
    expect(player.position.z).toBeGreaterThan(-12.5);
    expect(back).toBe(true);
    expect(player.roaming).toBe(false);
    expect(worstStep).toBeLessThan(0.05);
    expect(Math.abs(player.position.y - nav.nearest(player.position).y)).toBeLessThan(0.01); // on the navmesh again, at its height
    player.dispose();
    nav.dispose();
    disposeMeshes([ground, ...statics]);
  });

  it('is turned back by a cliff, by deep water and by what stands in the way, and stays put without land', async () => {
    const { ground, statics } = makeWorld([[20, 20, 2, 2, 2]]);
    const nav = await buildNav(statics, ground);
    const r = (x: number, z: number): number => Math.hypot(x, z);
    const run = (land: PlayerLand | undefined, frames: number, startX = 0): THREE.Vector3 => {
      const state: Keys = { axis: { x: 0, y: 1 }, shift: true };
      const player = createPlayer(fakeRig(), nav, new THREE.PerspectiveCamera(), fakeInput(state), statics, { firstPerson: true, land });
      player.teleport(new THREE.Vector3(startX, 0, 5), Math.PI);
      for (let i = 0; i < frames; i++) {
        player.update(1 / 30);
        expect(Number.isFinite(player.position.x + player.position.y + player.position.z)).toBe(true);
      }
      const end = player.position.clone();
      player.dispose();
      return end;
    };

    // A wall of land rising at 63 degrees from 100 m out.
    const cliff = run({ heightAt: (x, z) => Math.max(0, r(x, z) - 100) * 2, coreBounds: CORE }, 1500);
    expect(r(cliff.x, cliff.z)).toBeGreaterThan(99);
    expect(r(cliff.x, cliff.z)).toBeLessThan(100.5);

    // A sea from 100 m out, 10 cm deeper every metre.
    const depth = (x: number, z: number): number => Math.max(0, r(x, z) - 100) * 0.1;
    const sea = run({ heightAt: (x, z) => -depth(x, z), waterDepthAt: depth, coreBounds: CORE }, 1500);
    expect(depth(sea.x, sea.z)).toBeGreaterThan(0.3);
    expect(depth(sea.x, sea.z)).toBeLessThanOrEqual(FREE_MAX_WADE + 1e-6);

    // A boulder a little off the line of march: gone round, never entered.
    const rock = { x: 0.6, z: -60, r: 3 };
    let nearest = Infinity;
    const round = run({
      heightAt: () => 0, coreBounds: CORE,
      pushOut: (p) => {
        const d = Math.hypot(p.x - rock.x, p.z - rock.z);
        if (d < rock.r && d > 1e-6) { p.x = rock.x + ((p.x - rock.x) / d) * rock.r; p.z = rock.z + ((p.z - rock.z) / d) * rock.r; }
        nearest = Math.min(nearest, Math.hypot(p.x - rock.x, p.z - rock.z));
      },
    }, 900);
    expect(nearest).toBeGreaterThan(rock.r - 1e-6);
    expect(round.z).toBeLessThan(-80);

    // Without land the navmesh is still the whole world.
    const held = run(undefined, 600);
    expect(held.z).toBeGreaterThan(-30.01);

    // Set down far from the place, the player stands on the land there.
    const state: Keys = { axis: { x: 0, y: 0 }, shift: false };
    const far = createPlayer(fakeRig(), nav, new THREE.PerspectiveCamera(), fakeInput(state), statics, { land: { heightAt: (x) => x * 0.01, coreBounds: CORE } });
    far.teleport(new THREE.Vector3(700, 0, -300), 0);
    expect(far.roaming).toBe(true);
    expect(far.position.y).toBeCloseTo(7, 6);
    far.update(1 / 60);
    expect(far.position.x).toBe(700);
    expect(far.distanceFromHome).toBeGreaterThan(600);
    far.dispose();
    nav.dispose();
    disposeMeshes([ground, ...statics]);
  });
});
