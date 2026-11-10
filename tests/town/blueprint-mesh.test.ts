import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GeoBatch, MaterialCache } from '../../app/src/town/batch';
import { addBlueprint, expandBlueprintParts, shapeGeometries } from '../../app/src/town/blueprint-mesh';
import { makeRng } from '../../app/src/world/rng';
import type { Blueprint } from '../../app/src/world/spec';
import { ALL_SHAPES, BLUEPRINTS, STYLE, part } from './helpers';

function env(seed = 1): { batch: GeoBatch; mats: MaterialCache; rng: ReturnType<typeof makeRng> } {
  return { batch: new GeoBatch(), mats: new MaterialCache(), rng: makeRng(seed, 'bp-test') };
}

describe('part shapes', () => {
  for (const shape of ALL_SHAPES) {
    it(`${shape} builds finite flat-shaded geometry on or above its base height`, () => {
      const e = env();
      const bp: Blueprint = { id: 't', summary: '', doorX: 0, parts: [part(shape, { w: 0.6, d: 0.5, h: 3, y: 1 })] };
      const res = addBlueprint(bp, STYLE, { x: 0, z: 0, rotY: 0, w: 8, d: 6 }, e);
      expect(res.height).toBeCloseTo(4);
      const meshes = e.batch.build();
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) {
        const pos = m.geometry.getAttribute('position');
        const nor = m.geometry.getAttribute('normal');
        expect(m.geometry.index).toBeNull();
        expect(nor.count).toBe(pos.count);
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
          expect(Number.isFinite(nor.getX(i) + nor.getY(i) + nor.getZ(i))).toBe(true);
          expect(pos.getY(i)).toBeGreaterThanOrEqual(1 - 1e-6);
        }
        m.geometry.dispose();
      }
      e.mats.dispose();
    });
  }

  it('shape geometries sit on y = 0 and stay inside their box', () => {
    for (const shape of ALL_SHAPES) {
      const box = new THREE.Box3();
      for (const g of shapeGeometries(shape, 2, 3, 4)) {
        g.computeBoundingBox();
        box.union(g.boundingBox as THREE.Box3);
        g.dispose();
      }
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
      // a ring's thickness is capped by its footprint, so it may be lower than h
      if (shape === 'ring') expect(box.max.y).toBeLessThanOrEqual(3 + 1e-6);
      else expect(box.max.y).toBeCloseTo(3, 5);
      expect(box.max.x - box.min.x).toBeLessThanOrEqual(2 + 1e-6);
      expect(box.max.z - box.min.z).toBeLessThanOrEqual(4 + 1e-6);
    }
  });

  it('gable and wedge faces point outwards', () => {
    for (const shape of ['gable', 'wedge'] as const) {
      const [g] = shapeGeometries(shape, 2, 3, 4);
      expect(g).toBeDefined();
      if (!g) return;
      g.computeVertexNormals();
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      const centre = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < pos.count; i += 3) {
        const c = new THREE.Vector3();
        for (let j = 0; j < 3; j++) c.add(new THREE.Vector3(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j)));
        c.divideScalar(3).sub(centre);
        const n = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i));
        expect(n.dot(c)).toBeGreaterThan(0);
      }
      g.dispose();
    }
  });
});

describe('expandBlueprintParts', () => {
  it('spreads repeats along local x, centred, honouring rot', () => {
    const out = expandBlueprintParts([part('box', { x: 0.1, z: 0, repeat: 3, gap: 0.2 })]);
    expect(out.map((p) => p.x)).toEqual([expect.closeTo(-0.1, 6), expect.closeTo(0.1, 6), expect.closeTo(0.3, 6)]);
    expect(out.every((p) => p.repeat === 1 && p.gap === 0)).toBe(true);
    const turned = expandBlueprintParts([part('box', { repeat: 2, gap: 0.4, rot: 90 })]);
    expect(turned[0]?.x).toBeCloseTo(0, 6);
    expect(Math.abs(turned[0]?.z ?? 0)).toBeCloseTo(0.2, 6);
  });

  it('drops parts with non-finite numbers and caps repeat at 12', () => {
    expect(expandBlueprintParts([part('box', { h: Number.NaN })])).toHaveLength(0);
    expect(expandBlueprintParts([part('box', { repeat: 99, gap: 0.01 })])).toHaveLength(12);
  });
});

describe('addBlueprint placement', () => {
  const bp = BLUEPRINTS[0] as Blueprint;

  it('puts the door on the street side, 1 m beyond the front face, matching the layout door at doorX 0', () => {
    for (const rotY of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
      const placed = { x: 10, z: -7, rotY, w: 9, d: 8 };
      const layoutDoor = { x: placed.x - Math.sin(rotY) * (placed.d / 2 + 1), z: placed.z - Math.cos(rotY) * (placed.d / 2 + 1) };
      const e = env();
      const { door } = addBlueprint(bp, STYLE, placed, e);
      expect(Math.hypot(door.x - layoutDoor.x, door.z - layoutDoor.z)).toBeLessThan(1.5);
      expect(door.y).toBe(0);
      e.batch.build().forEach((m) => m.geometry.dispose());
      e.mats.dispose();
    }
  });

  it('keeps an off-centre door on the street side and inside the lot frontage', () => {
    const rotY = Math.PI / 2;
    const placed = { x: 0, z: 0, rotY, w: 12, d: 10 };
    const off = { ...bp, doorX: 0.3 };
    const e = env();
    const { door } = addBlueprint(off, STYLE, placed, e);
    const front = new THREE.Vector3(-Math.sin(rotY), 0, -Math.cos(rotY));
    expect(door.dot(front)).toBeCloseTo(placed.d / 2 + 1, 5);
    const lateral = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
    expect(Math.abs(door.dot(lateral))).toBeCloseTo(0.3 * placed.w, 5);
    e.batch.build().forEach((m) => m.geometry.dispose());
    e.mats.dispose();
  });

  it('builds +z parts on the street side of the footprint', () => {
    const slab: Blueprint = { id: 's', summary: '', doorX: 0, parts: [part('box', { z: 0.45, w: 1, d: 0.1, h: 3 })] };
    for (const rotY of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
      const e = env();
      const placed = { x: 3, z: 4, rotY, w: 10, d: 8 };
      const { door } = addBlueprint(slab, STYLE, placed, e);
      const meshes = e.batch.build();
      const c = new THREE.Box3().setFromObject(meshes[0] as THREE.Mesh).getCenter(new THREE.Vector3());
      const toDoor = new THREE.Vector3(door.x - placed.x, 0, door.z - placed.z);
      const toSlab = new THREE.Vector3(c.x - placed.x, 0, c.z - placed.z);
      expect(toSlab.dot(toDoor)).toBeGreaterThan(0);
      meshes.forEach((m) => m.geometry.dispose());
      e.mats.dispose();
    }
  });

  it('is deterministic for a seed and keeps wall colour drift small', () => {
    const run = (seed: number): string[] => {
      const e = env(seed);
      addBlueprint(bp, STYLE, { x: 0, z: 0, rotY: 0, w: 9, d: 8 }, e);
      const cols = e.batch.build().map((m) => `#${(m.material as THREE.MeshStandardMaterial).color.getHexString()}`);
      e.mats.dispose();
      return cols;
    };
    expect(run(5)).toEqual(run(5));
    const lightness = (c: string): number => {
      const o = { h: 0, s: 0, l: 0 };
      new THREE.Color(c).getHSL(o);
      return o.l;
    };
    const base = lightness(STYLE.wall);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const near = run(seed).filter((c) => Math.abs(lightness(c) - base) <= 0.06 * STYLE.variety + 0.01);
      expect(near.length).toBeGreaterThan(0);
    }
  });
});
