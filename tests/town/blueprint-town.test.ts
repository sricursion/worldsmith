import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { LoadedKit } from '../../app/src/engine/assets';
import { MAX_SETBACK, buildTown, landmarkAnchor } from '../../app/src/town/build';
import { KITS } from '../../app/src/town/kits';
import { buildingAabb, distanceToRoad, generateLayout } from '../../app/src/town/layout';
import { STYLE, makeBlueprintSpec } from './helpers';

// The first town built in a run generates its surface textures, which takes a few seconds.
vi.setConfig({ testTimeout: 60000 });

function kitWithMeshes(): LoadedKit {
  const cube = (): THREE.Object3D => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()));
    return g;
  };
  return { manifest: KITS.medieval, building: cube, prop: cube, footprint: () => ({ w: 9, d: 8 }) };
}

describe('blueprint towns', () => {
  for (const count of [6, 9, 14]) {
    it(`builds ${count} buildings from blueprints with a sign and door for each`, () => {
      const spec = makeBlueprintSpec({ count });
      const layout = generateLayout(spec);
      const scene = new THREE.Scene();
      const town = buildTown(layout, spec, kitWithMeshes(), scene);
      expect(town.signs.size).toBe(layout.buildings.length);
      expect(town.doors.size).toBe(layout.buildings.length);
      expect(town.statics[0]?.name).toBe('ground');
      // statics hold only the ground and plain float geometry, never kit colliders
      expect(town.statics.filter((m) => m.name.startsWith('collider:'))).toHaveLength(0);
      for (const m of town.statics) {
        const pos = m.geometry.getAttribute('position');
        expect(pos.array).toBeInstanceOf(Float32Array);
        for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      }
      // the collider is a flat plane outside the drawn group; the drawn ground and roads carry generated surfaces
      const collider = town.statics[0] as THREE.Mesh;
      expect(town.group.getObjectByName('ground')).toBeUndefined();
      collider.geometry.computeBoundingBox();
      expect(collider.geometry.boundingBox?.min.y).toBeCloseTo(0, 6);
      expect(collider.geometry.boundingBox?.max.y).toBeCloseTo(0, 6);
      const terrain = town.group.getObjectByName('terrain') as THREE.Mesh;
      const road = town.group.getObjectByName('road') as THREE.Mesh;
      for (const m of [terrain, road]) {
        expect(m.geometry.getAttribute('color')).toBeDefined();
        expect(m.geometry.getAttribute('uv')).toBeDefined();
        expect((m.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
      }
      expect((terrain.material as THREE.MeshStandardMaterial).userData['baseHex']).toBe(STYLE.ground);
      // every door sits 1 m outside the front on the street side, at most 0.4 of the frontage off centre;
      // the building itself may stand back from its lot line by up to MAX_SETBACK and a degree or so off square
      for (const b of layout.buildings) {
        const d = town.doors.get(b.id) as THREE.Vector3;
        const front = new THREE.Vector3(-Math.sin(b.rotY), 0, -Math.cos(b.rotY));
        const out = d.clone().sub(new THREE.Vector3(b.x, 0, b.z)).dot(front);
        expect(out).toBeLessThanOrEqual(b.d / 2 + 1 + 0.15);
        expect(out).toBeGreaterThanOrEqual(b.d / 2 + 1 - MAX_SETBACK - 0.15);
        expect(Math.hypot(d.x - b.door.x, d.z - b.door.z)).toBeLessThanOrEqual(0.4 * b.w + MAX_SETBACK + 0.15);
      }
      town.dispose();
      expect(scene.children).not.toContain(town.group);
    });
  }

  it('gives buildings that name no blueprint one of the archetypes; specs without blueprints keep the kit path', () => {
    const spec = makeBlueprintSpec({ count: 8, assign: false });
    const town = buildTown(generateLayout(spec), spec, kitWithMeshes(), new THREE.Scene());
    expect(town.statics.filter((m) => m.name.startsWith('collider:'))).toHaveLength(0);
    town.dispose();

    const plain = { ...spec, style: undefined, blueprints: undefined, props: undefined, landmarks: undefined };
    const t2 = buildTown(generateLayout(plain), plain, kitWithMeshes(), new THREE.Scene());
    expect(t2.statics.filter((m) => m.name.startsWith('collider:')).length).toBeGreaterThan(0);
    t2.dispose();
  });

  it('is deterministic', () => {
    const spec = makeBlueprintSpec({ count: 10 });
    const layout = generateLayout(spec);
    const sig = (): number[] => {
      const t = buildTown(layout, spec, kitWithMeshes(), new THREE.Scene());
      const out = t.statics.map((m) => m.geometry.getAttribute('position').count);
      t.dispose();
      return out;
    };
    expect(sig()).toEqual(sig());
  });

  it('disposes everything it created, including a placed landmark', () => {
    const spec = makeBlueprintSpec({ count: 9 });
    const layout = generateLayout(spec);
    const town = buildTown(layout, spec, kitWithMeshes(), new THREE.Scene());
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    town.placeLandmark?.('tower_lm', model, 8);
    town.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geos.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      }
    });
    expect(geos.has(model.geometry)).toBe(true);
    const gd = new Set<THREE.BufferGeometry>();
    const md = new Set<THREE.Material>();
    geos.forEach((g) => g.addEventListener('dispose', () => gd.add(g)));
    mats.forEach((m) => m.addEventListener('dispose', () => md.add(m)));
    town.dispose();
    expect(gd.size).toBe(geos.size);
    expect(md.size).toBe(mats.size);
    town.dispose();
  });

  it('shows a plinth per landmark and swaps it for the model, scaled and grounded', () => {
    const spec = makeBlueprintSpec({ count: 9 });
    const layout = generateLayout(spec);
    const town = buildTown(layout, spec, kitWithMeshes(), new THREE.Scene());
    expect(town.group.getObjectByName('plinth:tower_lm')).toBeDefined();
    expect(town.group.getObjectByName('plinth:mill_lm')).toBeDefined();
    const model = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2).translate(5, 10, 5), new THREE.MeshStandardMaterial());
    town.placeLandmark?.('tower_lm', model, 8);
    expect(town.group.getObjectByName('plinth:tower_lm')).toBeUndefined();
    expect(town.group.getObjectByName('plinth:mill_lm')).toBeDefined();
    const holder = town.group.getObjectByName('landmark:tower_lm') as THREE.Object3D;
    const box = new THREE.Box3().setFromObject(holder);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(8, 5);
    const lm = spec.landmarks?.[0] as NonNullable<typeof spec.landmarks>[number];
    const a = landmarkAnchor(layout, spec, lm);
    const c = box.getCenter(new THREE.Vector3());
    expect(c.x).toBeCloseTo(a.x, 4);
    expect(c.z).toBeCloseTo(a.z, 4);
    expect(town.statics.some((m) => m.name.startsWith('plinth'))).toBe(false);
    town.placeLandmark?.('nope', new THREE.Group(), 3); // unknown id is ignored
    town.dispose();
  });
});

describe('landmarkAnchor', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`is off the roads and outside every footprint (seed ${seed})`, () => {
      const spec = makeBlueprintSpec({ seed, count: 6 + seed * 2 });
      const layout = generateLayout(spec);
      const places = ['plaza', ...layout.buildings.map((b) => b.id)];
      for (const place of places) {
        const a = landmarkAnchor(layout, spec, { id: 'x', prompt: 'p', place, height: 6 });
        for (const r of layout.roads) expect(distanceToRoad(r, a.x, a.z)).toBeGreaterThan(0.5);
        for (const b of layout.buildings) {
          const r = buildingAabb(b);
          const inside = a.x > r.minX && a.x < r.maxX && a.z > r.minZ && a.z < r.maxZ;
          expect(inside).toBe(false);
        }
        expect(Number.isFinite(a.rotY)).toBe(true);
        if (place !== 'plaza') {
          const b = layout.buildings.find((q) => q.id === place);
          expect(Math.hypot(a.x - (b?.x ?? 0), a.z - (b?.z ?? 0))).toBeLessThan(45);
        }
      }
    });
  }

  it('falls back to the plaza for an unknown building id', () => {
    const spec = makeBlueprintSpec({ count: 8 });
    const layout = generateLayout(spec);
    const a = landmarkAnchor(layout, spec, { id: 'x', prompt: 'p', place: 'missing', height: 5 });
    const b = landmarkAnchor(layout, spec, { id: 'x', prompt: 'p', place: 'plaza', height: 5 });
    expect(a).toEqual(b);
  });
});
