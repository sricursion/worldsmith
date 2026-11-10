import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { LoadedKit } from '../../app/src/engine/assets';
import { buildTown } from '../../app/src/town/build';
import { KITS } from '../../app/src/town/kits';
import { buildingAabb, generateLayout } from '../../app/src/town/layout';
import { FLAT_MARGIN, outsideDistance } from '../../app/src/town/terrain';
import type { SurfaceSet, ThemeId, WorldSpec } from '../../app/src/world/spec';
import { STYLE, THEMES, makeBlueprintSpec, makeSpec } from './helpers';

// The first town built in a run generates its surface textures, which takes a few seconds.
vi.setConfig({ testTimeout: 60000 });

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

describe('buildTown ground, distance and dressing', () => {
  const DRAWN_ONLY = ['terrain', 'horizon', 'horizon-glow', 'road', 'plaza', 'road-trim', 'road-decals', 'puddles', 'pavement'];
  const surfaces = (over: Partial<SurfaceSet> = {}): SurfaceSet => ({
    wall: 'timber', wall2: 'planks', roof: 'shingle', trim: 'timber', ground: 'dirt', road: 'dirt', wear: 0.5, wet: 0.2, ...over,
  });
  const styled = (over: Partial<SurfaceSet> = {}, count = 9): WorldSpec => {
    const spec = makeBlueprintSpec({ count });
    return { ...spec, style: { ...STYLE, surfaces: surfaces(over) } };
  };
  const build = (spec: WorldSpec, quality: 0 | 1 | 2 = 0): { town: ReturnType<typeof buildTown>; layout: ReturnType<typeof generateLayout> } => {
    const layout = generateLayout(spec);
    return { town: buildTown(layout, spec, stubKit(spec.theme), new THREE.Scene(), { quality }), layout };
  };

  it('keeps the collider flat and everything decorative out of the statics', () => {
    const { town, layout } = build(styled({ wet: 0.9 }));
    const collider = town.statics[0] as THREE.Mesh;
    const cp = collider.geometry.getAttribute('position');
    for (let i = 0; i < cp.count; i++) expect(cp.getY(i)).toBeCloseTo(0, 9);
    expect(collider.visible).toBe(false);
    const drawn = new Set<THREE.Object3D>();
    for (const name of DRAWN_ONLY) town.group.traverse((o) => { if (o.name === name) drawn.add(o); });
    const scatter = town.group.getObjectByName('scatter') as THREE.Group;
    scatter.traverse((o) => drawn.add(o));
    expect(drawn.size).toBeGreaterThan(8);
    for (const m of town.statics) {
      expect(drawn.has(m)).toBe(false);
      expect(m).not.toBeInstanceOf(THREE.InstancedMesh);
      expect(DRAWN_ONLY).not.toContain(m.name);
    }
    // solid things stay inside the town: nothing in the statics reaches the rolling ground or the horizon
    for (const m of town.statics.slice(1)) {
      const box = new THREE.Box3().setFromObject(m);
      expect(outsideDistance(layout.bounds, box.min.x, box.min.z)).toBeLessThan(6);
      expect(outsideDistance(layout.bounds, box.max.x, box.max.z)).toBeLessThan(6);
    }
    town.dispose();
  });

  it('draws terrain that is flat in town and rises beyond it, with a horizon ring far outside', () => {
    const { town, layout } = build(styled());
    const terrain = town.group.getObjectByName('terrain') as THREE.Mesh;
    const p = terrain.geometry.getAttribute('position');
    let high = 0;
    for (let i = 0; i < p.count; i++) {
      if (outsideDistance(layout.bounds, p.getX(i), p.getZ(i)) <= FLAT_MARGIN) expect(p.getY(i)).toBe(0);
      high = Math.max(high, p.getY(i));
    }
    expect(high).toBeGreaterThan(8);
    const horizon = town.group.getObjectByName('horizon') as THREE.Mesh;
    const hp = horizon.geometry.getAttribute('position');
    let nearest = Infinity;
    let top = 0;
    for (let i = 0; i < hp.count; i++) {
      nearest = Math.min(nearest, outsideDistance(layout.bounds, hp.getX(i), hp.getZ(i)));
      top = Math.max(top, hp.getY(i));
    }
    // even the foot of the widest form is off the flat ground
    expect(nearest).toBeGreaterThan(FLAT_MARGIN);
    expect(top).toBeGreaterThan(40);
    expect(horizon.castShadow).toBe(false);
    expect(town.statics).not.toContain(horizon);
    town.dispose();
  });

  it('has puddles only when the surfaces are wet', () => {
    const dry = build(styled({ wet: 0.3 }));
    expect(dry.town.group.getObjectByName('puddles')).toBeUndefined();
    dry.town.dispose();
    const wet = build(styled({ wet: 0.95, road: 'cobble' }));
    const puddles = wet.town.group.getObjectByName('puddles') as THREE.Mesh;
    expect(puddles).toBeDefined();
    const mat = puddles.material as THREE.MeshStandardMaterial;
    expect(mat.roughness).toBeLessThan(0.1);
    expect(mat.normalMap).toBeNull();
    expect(mat.transparent).toBe(true);
    expect(wet.town.statics).not.toContain(puddles);
    wet.town.dispose();
  });

  it('scatters more on a wilder site and on a higher quality tier', () => {
    const count = (wild: number, quality: 0 | 1 | 2): number => {
      const spec: WorldSpec = { ...styled({ ground: 'grass' }), site: { pattern: 'street', wild, paths: 'road', spacing: 6 } };
      const { town } = build(spec, quality);
      const scatter = town.group.getObjectByName('scatter') as THREE.Group;
      const n = scatter.children.reduce((sum, c) => sum + (c as THREE.InstancedMesh).instanceMatrix.count, 0);
      town.dispose();
      return n;
    };
    const tame = count(0.1, 0);
    expect(tame).toBeGreaterThan(2500);
    expect(count(0.9, 0)).toBeGreaterThan(tame);
    expect(count(0.5, 2)).toBeGreaterThan(count(0.5, 0) * 1.8);
    expect(count(1, 2)).toBeLessThanOrEqual(20000);
  });

  it('registers a lantern light by every door and smoke above the roofs', () => {
    const { town, layout } = build(styled());
    expect(town.lights?.length).toBeGreaterThanOrEqual(layout.buildings.length);
    for (const b of layout.buildings) {
      const near = (town.lights ?? []).filter((l) => Math.hypot(l.pos.x - b.door.x, l.pos.z - b.door.z) < 3.5);
      expect(near.length).toBeGreaterThan(0);
    }
    for (const l of town.lights ?? []) {
      expect(l.pos.y).toBeGreaterThan(1.5);
      expect(l.pos.y).toBeLessThan(7);
      expect(l.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(l.radius).toBeGreaterThan(3);
    }
    expect(town.smoke?.length).toBeGreaterThan(0);
    for (const s of town.smoke ?? []) {
      expect(s.y).toBeGreaterThan(2.5);
      expect(layout.buildings.some((b) => Math.hypot(s.x - b.x, s.z - b.z) < Math.hypot(b.w, b.d))).toBe(true);
    }
    town.dispose();
    expect(town.lights).toHaveLength(0);
  });

  it('is built the same way for old specs with no style', () => {
    for (const theme of THEMES) {
      const spec = makeSpec({ seed: 4, count: 8, theme });
      const { town } = build(spec);
      for (const name of ['terrain', 'horizon', 'plaza', 'scatter']) expect(town.group.getObjectByName(name), theme + ' ' + name).toBeDefined();
      expect(town.lights?.length).toBe(8);
      town.dispose();
    }
  });
});
