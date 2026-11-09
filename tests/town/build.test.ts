import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LoadedKit } from '../../app/src/engine/assets';
import { buildTown } from '../../app/src/town/build';
import { KITS } from '../../app/src/town/kits';
import { buildingAabb, generateLayout } from '../../app/src/town/layout';
import type { ThemeId } from '../../app/src/world/spec';
import { THEMES, makeSpec } from './helpers';

function stubKit(theme: ThemeId, building: () => THREE.Object3D | null = () => null, prop: () => THREE.Object3D | null = () => null): LoadedKit {
  return { manifest: KITS[theme], building, prop, footprint: () => ({ w: 1, d: 1 }) };
}

function cube(w: number, h: number, d: number, offset = new THREE.Vector3()): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.position.copy(offset).add(new THREE.Vector3(0, h / 2, 0));
  g.add(m);
  return g;
}

describe('buildTown procedural fallback', () => {
  for (const theme of THEMES) {
    it(`builds a complete ${theme} town with an empty kit`, () => {
      const spec = makeSpec({ seed: 11, count: 12, theme });
      const layout = generateLayout(spec);
      const scene = new THREE.Scene();
      const town = buildTown(layout, spec, stubKit(theme), scene);
      expect(scene.children).toContain(town.group);
      expect(town.statics[0]?.name).toBe('ground');
      expect(town.statics.length).toBeGreaterThan(1);
      expect(town.signs.size).toBe(layout.buildings.length);
      expect(town.doors.size).toBe(layout.buildings.length);
      for (const b of layout.buildings) {
        const d = town.doors.get(b.id);
        expect(d?.x).toBeCloseTo(b.door.x);
        expect(d?.z).toBeCloseTo(b.door.z);
        expect(d?.y).toBe(0);
      }
      // merged geometry is baked: bounding boxes lie inside the layout bounds (plus the building height)
      const bd = layout.bounds;
      for (const m of town.statics.slice(1)) {
        m.geometry.computeBoundingBox();
        const box = (m.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(m.matrixWorld);
        expect(box.min.x).toBeGreaterThanOrEqual(bd.minX - 6);
        expect(box.max.x).toBeLessThanOrEqual(bd.maxX + 6);
        expect(box.min.z).toBeGreaterThanOrEqual(bd.minZ - 6);
        expect(box.max.z).toBeLessThanOrEqual(bd.maxZ + 6);
        expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
      }
      town.dispose();
      expect(scene.children).not.toContain(town.group);
    });
  }

  it('is deterministic', () => {
    const spec = makeSpec({ seed: 3, count: 9, theme: 'western' });
    const layout = generateLayout(spec);
    const sizes = (): number[] => {
      const t = buildTown(layout, spec, stubKit('western'), new THREE.Scene());
      const out = t.statics.map((m) => m.geometry.getAttribute('position').count);
      t.dispose();
      return out;
    };
    expect(sizes()).toEqual(sizes());
  });

  it('disposes the geometry it created', () => {
    const spec = makeSpec({ seed: 6, count: 8, theme: 'modern' });
    const layout = generateLayout(spec);
    const town = buildTown(layout, spec, stubKit('modern'), new THREE.Scene());
    const disposed = new Set<THREE.BufferGeometry>();
    for (const m of town.statics) m.geometry.addEventListener('dispose', () => disposed.add(m.geometry));
    town.dispose();
    expect(disposed.size).toBe(new Set(town.statics.map((m) => m.geometry)).size || disposed.size);
    expect(disposed.size).toBeGreaterThan(1);
    town.dispose(); // second call is harmless
  });
});

describe('buildTown with kit meshes', () => {
  it('scales kit buildings to the footprint, centres them on the lot and caps their height', () => {
    const spec = makeSpec({ seed: 8, count: 8, theme: 'medieval' });
    const layout = generateLayout(spec);
    // native 2 x 4 x 2 clone, deliberately off-centre
    const town = buildTown(layout, spec, stubKit('medieval', () => cube(2, 4, 2, new THREE.Vector3(3, 0, -2))), new THREE.Scene());
    const b = layout.buildings[0];
    expect(b).toBeDefined();
    if (!b) return;
    // Kit meshes enter statics as float-baked colliders named collider:<name>.
    const kitMeshes = town.statics.filter((m) => m.name.startsWith('collider:'));
    expect(kitMeshes.length).toBeGreaterThanOrEqual(layout.buildings.length);
    const foot = buildingAabb(b);
    const hit = kitMeshes.find((m) => {
      const bb = new THREE.Box3().setFromObject(m);
      const c = bb.getCenter(new THREE.Vector3());
      return Math.abs(c.x - b.x) < 0.01 && Math.abs(c.z - b.z) < 0.01;
    });
    expect(hit).toBeDefined();
    if (!hit) return;
    const bb = new THREE.Box3().setFromObject(hit);
    expect(bb.min.y).toBeCloseTo(0, 5);
    expect(bb.min.x).toBeGreaterThanOrEqual(foot.minX - 1e-6);
    expect(bb.max.x).toBeLessThanOrEqual(foot.maxX + 1e-6);
    expect(bb.min.z).toBeGreaterThanOrEqual(foot.minZ - 1e-6);
    expect(bb.max.z).toBeLessThanOrEqual(foot.maxZ + 1e-6);
    const cap = { small: 7, medium: 10, large: 14 }[b.size];
    expect(bb.max.y).toBeLessThanOrEqual(cap + 1e-6);
    town.dispose();
  });

  it('sizes kit props to their target dimension and leaves kit geometry alive', () => {
    const spec = makeSpec({ seed: 8, count: 8, theme: 'modern' });
    const layout = generateLayout(spec);
    const shared = new THREE.BoxGeometry(0.3, 0.1, 0.1);
    let disposedShared = false;
    shared.addEventListener('dispose', () => { disposedShared = true; });
    const prop = (): THREE.Object3D => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(shared, new THREE.MeshBasicMaterial()));
      return g;
    };
    const town = buildTown(layout, spec, stubKit('modern', () => null, prop), new THREE.Scene());
    const p = layout.props.find((q) => q.kind === 'bench');
    expect(p).toBeDefined();
    const meshes = town.statics.filter((m) => m.name.startsWith('collider:'));
    expect(meshes.length).toBe(layout.props.length);
    const box = new THREE.Box3().setFromObject(meshes[0] as THREE.Mesh);
    const longest = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    expect(longest).toBeGreaterThan(0.5);
    town.dispose();
    expect(disposedShared).toBe(false);
  });
});
