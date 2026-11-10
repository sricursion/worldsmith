import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CharacterRig } from '../../app/src/engine/character';
import type { Input } from '../../app/src/engine/input';
import { buildNav } from '../../app/src/engine/nav';
import { FREE_MAX_WADE, createPlayer } from '../../app/src/engine/player';
import { buildTown } from '../../app/src/town/build';
import { generateLayout } from '../../app/src/town/layout';
import type { WorldSpec } from '../../app/src/world/spec';
import { makeBlueprintSpec, makeSpec, stubKit } from '../town/helpers';

function fakeRig(): CharacterRig {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3), new THREE.MeshStandardMaterial()));
  return {
    root, mixer: new THREE.AnimationMixer(new THREE.Group()), play: () => undefined, setPalette: () => undefined,
    lookAt: () => undefined, update: () => undefined, dispose: () => undefined,
  } as unknown as CharacterRig;
}

const input: Input = {
  down: (c: string) => c === 'ShiftLeft',
  axis: () => ({ x: 0, y: 1 }),
  onKey: () => () => undefined,
  isLocked: () => false,
  exitLock: () => undefined,
  wheelDelta: () => 0,
  pointerDelta: () => ({ dx: 0, dy: 0 }),
  dispose: () => undefined,
};

const base = makeBlueprintSpec({ seed: 404, count: 4, landmarks: false });
const WORLDS: [string, WorldSpec, number][] = [
  ['a flat town', makeSpec({ seed: 19, count: 6 }), 700],
  ['rolling wilds', { ...base, site: { pattern: 'wild', wild: 0.6, paths: 'track', spacing: 6 }, terrain: { relief: 'rolling', ruggedness: 0.35, water: 'none', waterAmount: 0.3, horizon: 'jungle canopy', settled: 0.3 } }, 300],
  ['a shore', { ...base, site: { pattern: 'shoreline', wild: 0.5, paths: 'track', spacing: 6 }, terrain: { relief: 'islands', ruggedness: 0.4, water: 'shore', waterAmount: 0.4, horizon: 'open sea', settled: 0.4 } }, 0],
];

describe('walking out of the place', () => {
  for (const [name, spec, least] of WORLDS) {
    it(`${name}: the player runs off the navmesh onto land that is made under them, and is never lost`, async () => {
      const layout = generateLayout(spec);
      const town = buildTown(layout, spec, stubKit(spec.theme), new THREE.Scene(), { quality: 1, streamBudgetMs: 1.5 });
      const nav = await buildNav(town.statics.filter((m) => m.name !== 'ground'), town.walkMesh);
      const player = createPlayer(fakeRig(), nav, new THREE.PerspectiveCamera(), input, town.statics, { land: town.roam });
      // From the edge of the place, heading straight out of it (+X).
      const b = layout.bounds;
      let start: THREE.Vector3 | null = null;
      for (let z = b.minZ; z <= b.maxZ && !start; z += 2) {
        const p = new THREE.Vector3(b.maxX + 12, town.heightAt(b.maxX + 12, z), z);
        const n = nav.nearest(p);
        if (Math.hypot(n.x - p.x, n.z - p.z) < 0.3 && town.waterDepthAt(p.x, p.z) === 0) start = n;
      }
      expect(start, 'somewhere to stand at the edge').not.toBeNull();
      player.teleport(start as THREE.Vector3, Math.PI / 2);
      expect(player.roaming).toBe(false);
      let roamed = false;
      let poolMax = 0;
      let farthest = 0;
      for (let i = 0; i < 5400; i++) {
        player.update(1 / 30);
        town.update?.(player.position, 1 / 30);
        const p = player.position;
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        if (player.roaming) {
          roamed = true;
          // On the ground that is drawn (but for the moment of easing off the navmesh), and never out of its depth.
          expect(Math.abs(p.y - town.heightAt(p.x, p.z))).toBeLessThan(0.35);
          expect(town.waterDepthAt(p.x, p.z)).toBeLessThanOrEqual(FREE_MAX_WADE + 1e-6);
        }
        farthest = Math.max(farthest, player.distanceFromHome ?? 0);
        if (i % 200 === 0) poolMax = Math.max(poolMax, town.endlessStats?.().created ?? 0);
      }
      const st = town.endlessStats?.();
      expect(st).toBeDefined();
      expect(roamed).toBe(true);
      expect(poolMax).toBeLessThanOrEqual(st?.poolCap ?? 0);
      expect(st?.active).toBe(true);
      console.log(`${name.padEnd(14)} farthest from home ${farthest.toFixed(0)} m, tiles ${st?.shown}/${st?.created} of ${st?.poolCap}, prop slots ${st?.propCapacity}, scatter slots ${st?.scatterCapacity}, places ${st?.places}`);
      expect(farthest).toBeGreaterThanOrEqual(least);
      if (farthest > 80) expect(Number.isFinite(player.homeBearing ?? Number.NaN)).toBe(farthest > 80 && player.distanceFromHome !== undefined ? true : false);
      player.dispose();
      nav.dispose();
      town.dispose();
    }, 180000);
  }
});
