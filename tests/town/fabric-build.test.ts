import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildTown } from '../../app/src/town/build';
import { createCrowd, crowdSize } from '../../app/src/town/crowd';
import { lotRect } from '../../app/src/town/fabric';
import { generateLayout } from '../../app/src/town/layout';
import { scaleProfile } from '../../app/src/world/scale';
import type { SiteScale, WorldSpec } from '../../app/src/world/spec';
import { makeBlueprintSpec, stubKit } from './helpers';

// The first town built in a run generates its surface textures, which takes a few seconds.
vi.setConfig({ testTimeout: 180000 });

function specAt(scale: SiteScale | null, damage = 0): WorldSpec {
  const big = scale === 'city' || scale === 'metropolis';
  const base = makeBlueprintSpec({ seed: 91, count: scale === 'hamlet' ? 4 : 10, landmarks: false });
  return {
    ...base,
    terrain: { relief: 'flat', ruggedness: 0.1, water: 'none', waterAmount: 0, horizon: '', settled: scale === 'hamlet' ? 0.3 : 0.95 },
    site: { pattern: big ? 'grid' : scale === 'hamlet' ? 'scatter' : 'street', wild: 0.1, paths: 'road', spacing: 4, ...(scale ? { scale, density: big ? 1 : 0.4, damage } : {}) },
    folk: { name: 'townsfolk', height: 1.7, bulk: 0.4, head: 1, features: ['hood'], skin: ['#8a6248'], cloth: ['#3d4450', '#5a4a42'], trim: ['#c25f3a'] },
  };
}

const triangles = (root: THREE.Object3D): number => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const per = (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3;
    n += per * (o instanceof THREE.InstancedMesh ? o.count : 1);
  });
  return n;
};

describe('fabric as built', () => {
  it('an old spec builds as before: no fabric, the wide walk margin, no crowd', () => {
    const spec = specAt(null);
    const town = buildTown(generateLayout(spec), spec, stubKit(), new THREE.Scene(), { quality: 1 });
    expect(town.fabric).toBeUndefined();
    expect(town.group.getObjectByName('fabric')).toBeUndefined();
    expect(crowdSize(scaleProfile(spec), 2)).toBe(0);
    town.dispose();
  });

  it('a hamlet builds its few extra houses into the place and streams nothing', () => {
    const spec = specAt('hamlet');
    const layout = generateLayout(spec);
    const town = buildTown(layout, spec, stubKit(), new THREE.Scene(), { quality: 1 });
    expect(town.fabric?.grid).toBeNull();
    expect(town.fabric?.inner).toBe(layout.fabric?.lots.length);
    expect(town.fabric?.inner).toBeGreaterThan(1);
    town.update?.(new THREE.Vector3(0, 0, 0), 0.016);
    expect(town.fabric?.stats()).toBeNull();
    // The extra houses are solid: the ground is level under each and something stands on it.
    for (const l of layout.fabric?.lots ?? []) {
      const r = lotRect(l);
      expect(Math.abs(town.heightAt(r.minX + 0.5, r.minZ + 0.5) - town.heightAt(r.maxX - 0.5, r.maxZ - 0.5))).toBeLessThan(0.05);
    }
    town.dispose();
  });

  it('a metropolis builds its centre, then streams blocks, towers and a skyline around the walker within its budget', () => {
    const spec = specAt('metropolis', 0.5);
    const layout = generateLayout(spec);
    const scene = new THREE.Scene();
    const t0 = performance.now();
    const town = buildTown(layout, spec, stubKit(), scene, { quality: 2 });
    const buildMs = performance.now() - t0;
    const grid = town.fabric?.grid;
    expect(grid).toBeTruthy();
    expect(town.fabric?.inner).toBeGreaterThan(30);
    expect(town.statics.length).toBeGreaterThan(1);
    // Nothing of the city beyond is made until the first update.
    expect(town.fabric?.stats()?.near).toBe(0);
    const focus = new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z);
    for (let f = 0; f < 4000 && (f < 5 || (town.fabric?.stats()?.pending ?? 0) > 0); f++) town.update?.(focus, 0.016);
    town.update?.(focus, 0.016);
    const s = town.fabric!.stats()!;
    expect(s.pending).toBe(0);
    expect(s.near).toBeGreaterThan(100);
    expect(s.far).toBeGreaterThan(1500);
    expect(s.skyline).toBeGreaterThan(200);
    expect(s.tallest).toBeGreaterThan(90);
    expect(s.clutter).toBeGreaterThan(50);
    // The budget stated in fabric-mesh.ts.
    expect(s.triangles).toBeLessThan(1_400_000);
    expect(s.drawCalls).toBeLessThan(170);
    console.info(`metropolis: build ${buildMs.toFixed(0)} ms, inner ${town.fabric?.inner}, stream`, JSON.stringify(s), 'scene triangles', Math.round(triangles(town.group)));

    // Out in the city the walker is kept out of the buildings, and the fabric follows them.
    const out = { x: grid!.hole.maxX + grid!.pitch * 3.5, z: grid!.hole.maxZ + grid!.pitch * 2.5 };
    const far = new THREE.Vector3(out.x, 0, out.z);
    for (let f = 0; f < 4000 && (f < 5 || (town.fabric?.stats()?.pending ?? 0) > 0); f++) town.update?.(far, 0.016);
    const s2 = town.fabric!.stats()!;
    expect(s2.near).toBeGreaterThan(150);
    let pushed = 0;
    for (let k = 0; k < 400; k++) {
      const p = { x: out.x + ((k * 37) % 120) - 60, z: out.z + ((k * 53) % 120) - 60 };
      const q = { ...p };
      town.roam?.pushOut?.(q);
      if (Math.hypot(q.x - p.x, q.z - p.z) > 1e-6) pushed++;
      // Wherever it ends up is outside every lot.
      const again = { ...q };
      town.roam?.pushOut?.(again);
      expect(Math.hypot(again.x - q.x, again.z - q.z)).toBeLessThan(0.6);
    }
    expect(pushed).toBeGreaterThan(80);
    expect(pushed).toBeLessThan(380);
    town.dispose();
    expect(town.group.children.length).toBe(0);
  });

  it('the crowd is sized by the scale and keeps to the streets around the walker', () => {
    const sizes = (['lone', 'hamlet', 'village', 'town', 'city', 'metropolis'] as const).map((scale) =>
      crowdSize(scaleProfile({ site: { pattern: 'street', wild: 0.2, paths: 'road', spacing: 5, scale, density: 0.5 } }), 2));
    expect(sizes[0]).toBe(0);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
    const packed = crowdSize(scaleProfile({ site: { pattern: 'grid', wild: 0, paths: 'road', spacing: 3, scale: 'metropolis', density: 1 } }), 2);
    expect(packed).toBeGreaterThan(sizes[5]!);
    expect(packed).toBeGreaterThanOrEqual(150);
    expect(crowdSize(scaleProfile({ site: { pattern: 'grid', wild: 0, paths: 'road', spacing: 3, scale: 'metropolis', density: 1 } }), 0)).toBeLessThan(packed * 0.5);

    const spec = specAt('metropolis');
    const layout = generateLayout(spec);
    const profile = scaleProfile(spec)!;
    const grid = layout.fabric!.grid!;
    const crowd = createCrowd({ profile, folk: spec.folk, seed: spec.seed, quality: 2, walkable: layout.walkable, grid, heightAt: () => 0 })!;
    expect(crowd.count).toBe(packed);
    const focus = { x: grid.hole.maxX + grid.pitch * 2.5, z: grid.hole.minZ - grid.pitch * 1.5 };
    for (let f = 0; f < 900; f++) crowd.update(1 / 30, focus);
    const at = crowd.positions();
    const rects = [...layout.fabric!.lots.map((l) => lotRect(l))];
    let near = 0;
    let onStreet = 0;
    for (let i = 0; i < crowd.count; i++) {
      const x = at[i * 2]!;
      const z = at[i * 2 + 1]!;
      if (Math.hypot(x - focus.x, z - focus.z) < 110) near++;
      const dx = (((x - grid.x0) % grid.pitch) + grid.pitch) % grid.pitch;
      const dz = (((z - grid.z0) % grid.pitch) + grid.pitch) % grid.pitch;
      if (Math.min(dx, grid.pitch - dx, dz, grid.pitch - dz) <= grid.street / 2 + 1.2) onStreet++;
      expect(rects.some((r) => x > r.minX + 0.5 && x < r.maxX - 0.5 && z > r.minZ + 0.5 && z < r.maxZ - 0.5)).toBe(false);
    }
    expect(near).toBeGreaterThan(crowd.count * 0.9);
    expect(onStreet).toBeGreaterThan(crowd.count * 0.9);
    crowd.dispose();
    // A wilderness has nobody in the background.
    expect(createCrowd({ profile: scaleProfile({ site: { pattern: 'wild', wild: 0.7, paths: 'track', spacing: 12, scale: 'lone' } })!, seed: 1, quality: 2, walkable: layout.walkable, grid: null, heightAt: () => 0 })).toBeNull();
  });
});
