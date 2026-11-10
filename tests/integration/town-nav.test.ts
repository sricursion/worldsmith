import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FIXTURES } from '../../app/src/world/fixtures';
import { generateLayout } from '../../app/src/town/layout';
import { buildTown } from '../../app/src/town/build';
import { KITS } from '../../app/src/town/kits';
import type { LoadedKit } from '../../app/src/engine/assets';
import { buildNav } from '../../app/src/engine/nav';
import type { ReliefKind, SitePattern, ThemeId, WaterKind, WorldSpec } from '../../app/src/world/spec';
import { makeBlueprintSpec } from '../town/helpers';

function stubKit(theme: ThemeId): LoadedKit {
  const table = { small: { w: 6, d: 6 }, medium: { w: 9, d: 8 }, large: { w: 12, d: 10 } };
  return { manifest: KITS[theme], building: () => null, prop: () => null, footprint: (_r, s) => table[s] };
}

function finite(mesh: THREE.Mesh): boolean {
  const pos = mesh.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) return false;
  }
  return true;
}

describe('town statics feed the navmesh', () => {
  for (const theme of Object.keys(FIXTURES) as ThemeId[]) {
    it(`${theme}: every static mesh is finite and the navmesh builds`, async () => {
      const spec = FIXTURES[theme];
      const layout = generateLayout(spec);
      const scene = new THREE.Scene();
      const town = buildTown(layout, spec, stubKit(theme), scene);
      const bad = town.statics.filter((m) => !finite(m));
      expect(bad.map((m) => m.name)).toEqual([]);
      const ground = town.statics.find((m) => m.name === 'ground');
      expect(ground).toBeTruthy();
      const nav = await buildNav(town.statics, ground!);
      const spawn = nav.nearest(new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z));
      expect(Math.hypot(spawn.x - layout.spawn.x, spawn.z - layout.spawn.z)).toBeLessThan(2);
      nav.dispose();
      town.dispose();
    }, 60000);
  }
});

describe('blueprint towns feed the navmesh', () => {
  for (const count of [6, 10, 14]) {
    it(`synthetic blueprint town with ${count} buildings builds a navmesh and reaches its doors`, async () => {
      const spec = makeBlueprintSpec({ count });
      const layout = generateLayout(spec);
      const town = buildTown(layout, spec, stubKit('medieval'), new THREE.Scene());
      expect(town.statics.filter((m) => !finite(m))).toEqual([]);
      const ground = town.statics.find((m) => m.name === 'ground');
      expect(ground).toBeTruthy();
      const nav = await buildNav(town.statics, ground!);
      const spawn = nav.nearest(new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z));
      expect(Math.hypot(spawn.x - layout.spawn.x, spawn.z - layout.spawn.z)).toBeLessThan(2);
      for (const d of town.doors.values()) {
        const n = nav.nearest(d);
        expect(Math.hypot(n.x - d.x, n.z - d.z)).toBeLessThan(2.5);
      }
      nav.dispose();
      town.dispose();
    }, 60000);
  }

  for (const theme of Object.keys(FIXTURES) as ThemeId[]) {
    it(`${theme} fixture builds and, when it carries blueprints, uses them`, async () => {
      const spec = FIXTURES[theme];
      const layout = generateLayout(spec);
      const town = buildTown(layout, spec, stubKit(theme), new THREE.Scene());
      const hasBlueprints = !!spec.style && (spec.blueprints?.length ?? 0) > 0;
      if (hasBlueprints) expect(town.statics.filter((m) => m.name.startsWith('collider:'))).toHaveLength(0);
      const ground = town.statics.find((m) => m.name === 'ground');
      const nav = await buildNav(town.statics, ground!);
      const spawn = nav.nearest(new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z));
      expect(Math.hypot(spawn.x - layout.spawn.x, spawn.z - layout.spawn.z)).toBeLessThan(2);
      nav.dispose();
      town.dispose();
    }, 60000);
  }
});

describe('shaped land feeds the navmesh', () => {
  const cases: [ReliefKind, SitePattern, WaterKind, number][] = [
    ['flat', 'street', 'pond', 6], ['rolling', 'wild', 'river', 4], ['dunes', 'path', 'none', 3], ['craggy', 'scatter', 'lava', 5],
    ['terraced', 'terraces', 'none', 6], ['crater', 'ring', 'none', 5], ['canyon', 'path', 'river', 4], ['icefield', 'wild', 'ice_sheet', 3],
    ['swamp', 'wild', 'none', 3], ['islands', 'shoreline', 'shore', 4], ['rolling', 'cliffside', 'none', 5], ['rolling', 'wild', 'lake', 0],
  ];
  for (const [relief, pattern, water, count] of cases) {
    it(`${relief} / ${pattern} / ${water} / ${count} buildings: the navmesh builds on the walk mesh and reaches spawn and doors`, async () => {
      const base = makeBlueprintSpec({ seed: 404, count: Math.max(1, count), landmarks: false });
      const spec: WorldSpec = {
        ...base,
        buildings: count === 0 ? [] : base.buildings,
        site: { pattern, wild: 0.5, paths: 'track', spacing: 6 },
        terrain: { relief, ruggedness: 0.8, water, waterAmount: 0.4, horizon: 'mountain range', settled: 0.4 },
      };
      const layout = generateLayout(spec);
      const t0 = performance.now();
      const town = buildTown(layout, spec, stubKit('medieval'), new THREE.Scene(), { quality: 1 });
      const built = performance.now() - t0;
      expect(town.shaped).toBe(true);
      expect(town.statics.filter((m) => !finite(m)).map((m) => m.name)).toEqual([]);
      // As the game does it: everything solid except the ground, on the walk mesh.
      const nav = await buildNav(town.statics.filter((m) => m.name !== 'ground'), town.walkMesh);
      const at = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, town.heightAt(x, z), z);
      const spawn = nav.nearest(at(layout.spawn.x, layout.spawn.z));
      expect(Math.hypot(spawn.x - layout.spawn.x, spawn.z - layout.spawn.z)).toBeLessThan(2);
      expect(Math.abs(spawn.y)).toBeLessThan(0.8);
      for (const d of town.doors.values()) {
        const n = nav.nearest(d);
        expect(Math.hypot(n.x - d.x, n.z - d.z), `${relief} door`).toBeLessThan(2.5);
        expect(Math.abs(n.y - d.y), `${relief} door height`).toBeLessThan(1);
      }
      for (const t of layout.trails ?? []) {
        for (const p of t.pts) {
          const n = nav.nearest(at(p.x, p.z));
          expect(Math.hypot(n.x - p.x, n.z - p.z), `${relief} trail`).toBeLessThan(3);
        }
      }
      expect(built, 'town build time, ms').toBeLessThan(20000);
      nav.dispose();
      town.dispose();
    }, 90000);
  }
});
