import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { GeoBatch, MaterialCache } from '../../app/src/town/batch';
import { addBlueprint, boxGeometry, expandBlueprintParts, shapeGeometries } from '../../app/src/town/blueprint-mesh';
import { disposeSurfaces } from '../../app/src/town/surfaces';
import { makeRng } from '../../app/src/world/rng';
import type { Blueprint } from '../../app/src/world/spec';
import { ALL_SHAPES, BLUEPRINTS, STYLE, part } from './helpers';

afterAll(() => disposeSurfaces());

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
    const body: Blueprint = { id: 'b', summary: '', doorX: 0, parts: [part('box', { w: 0.9, d: 0.9, h: 4, y: 3 })] };
    // vertex colour of the wall, above the height where ground dirt darkens it
    const run = (seed: number): number[] => {
      const e = env(seed);
      addBlueprint(body, STYLE, { x: 0, z: 0, rotY: 0, w: 9, d: 8 }, e, { dress: false });
      const tints = e.batch.build().map((m) => {
        const col = m.geometry.getAttribute('color');
        expect((m.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
        for (let i = 0; i < col.count; i++) expect(col.getX(i)).toBeCloseTo(col.getX(0), 6);
        m.geometry.dispose();
        return col.getX(0);
      });
      e.mats.dispose();
      return tints;
    };
    expect(run(5)).toEqual(run(5));
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(STYLE.wall).getHSL(hsl);
    const seen = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const [k] = run(seed);
      // the linear multiplier, taken back to a lightness shift
      const shift = hsl.l * (Math.pow(k as number, 1 / 2.2) - 1);
      expect(Math.abs(shift)).toBeLessThanOrEqual(0.06 * STYLE.variety + 0.005);
      seen.add(Math.round((k as number) * 1000));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('surfaces on blueprint geometry', () => {
  const placed = { x: 12, z: -30, rotY: 0.7, w: 10, d: 8 };

  it('gives a wall UVs in metres: level courses and true run on a turned building', () => {
    const wall: Blueprint = { id: 'w', summary: '', doorX: 0, parts: [part('box', { w: 0.44, d: 0.5, h: 3.3 })] };
    const e = env();
    addBlueprint(wall, STYLE, placed, e, { dress: false, quality: 1, theme: 'western' });
    const [m] = e.batch.build();
    const mesh = m as THREE.Mesh;
    // western style with no surfaces: plank walls, 2 m per repeat
    expect((mesh.material as THREE.Material).name).toBe('surface:planks');
    const tile = 2.0;
    const pos = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    const nor = mesh.geometry.getAttribute('normal');
    let lo = Infinity;
    let hi = -Infinity;
    let walls = 0;
    for (let i = 0; i < pos.count; i += 3) {
      if (Math.abs(nor.getY(i)) > 0.5) continue;
      walls++;
      for (let j = 0; j < 3; j++) {
        expect(uv.getY(i + j)).toBeCloseTo(pos.getY(i + j) / tile, 5);
        // distance along the wall in metres matches distance in u
        const k = i + ((j + 1) % 3);
        const run = Math.hypot(pos.getX(k) - pos.getX(i + j), pos.getZ(k) - pos.getZ(i + j));
        expect(Math.abs(uv.getX(k) - uv.getX(i + j))).toBeCloseTo(run / tile, 4);
        lo = Math.min(lo, uv.getX(i + j));
        hi = Math.max(hi, uv.getX(i + j));
      }
    }
    // four walls, each split once at 1.5 m: sixteen triangles
    expect(walls).toBe(16);
    expect(hi - lo).toBeGreaterThanOrEqual(4.4 / tile - 1e-4);
    mesh.geometry.dispose();
    e.mats.dispose();
  });

  it('maps tones to surfaces, real glass and an emissive glow', () => {
    const tones = ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'glow'] as const;
    const bp: Blueprint = {
      id: 'tones', summary: '', doorX: 0,
      parts: tones.map((tone, i) => part('box', { x: -0.4 + i * 0.1, w: 0.08, d: 0.2, h: 2, tone })),
    };
    const e = env();
    const style = { ...STYLE, surfaces: { wall: 'brick', wall2: 'stone', roof: 'slate', trim: 'timber', ground: 'dirt', road: 'cobble', wear: 0.5, wet: 0 } as const };
    addBlueprint(bp, style, placed, e, { dress: false, quality: 0 });
    const mats = e.batch.build().map((m) => {
      m.geometry.dispose();
      return m.material as THREE.MeshStandardMaterial;
    });
    const names = mats.map((m) => m.name);
    for (const n of ['surface:brick', 'surface:stone', 'surface:slate', 'surface:timber', 'surface:paint', 'surface:window']) expect(names).toContain(n);
    // trim and dark are both timber here, in different colours
    expect(names.filter((n) => n === 'surface:timber')).toHaveLength(2);
    const glass = mats.find((m) => m.name === 'surface:window') as THREE.MeshStandardMaterial;
    expect(glass.roughness).toBeLessThan(0.15);
    expect(glass.emissiveMap).not.toBeNull();
    const glow = mats.find((m) => m.emissiveIntensity > 1 && !m.map) as THREE.MeshStandardMaterial;
    expect(glow.emissive.getHexString()).toBe(STYLE.glow.slice(1));
    e.mats.dispose();
  });

  it('darkens walls toward the ground, more when worn, and leaves roofs alone', () => {
    const shades = (wear: number, tone: 'wall' | 'roof'): { low: number; high: number } => {
      const bp: Blueprint = { id: 'g', summary: '', doorX: 0, parts: [part('box', { w: 0.5, d: 0.5, h: 5, tone })] };
      const style = { ...STYLE, variety: 0, surfaces: { wall: 'plaster', wall2: 'plaster', roof: 'tile', trim: 'timber', ground: 'dirt', road: 'dirt', wear, wet: 0 } as const };
      const e = env();
      addBlueprint(bp, style, placed, e, { dress: false, quality: 0 });
      const [m] = e.batch.build();
      const g = (m as THREE.Mesh).geometry;
      const pos = g.getAttribute('position');
      const col = g.getAttribute('color');
      let low = 1;
      let high = 0;
      let mid = false;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < 0.01) low = Math.min(low, col.getX(i));
        if (pos.getY(i) > 4.9) high = Math.max(high, col.getX(i));
        if (Math.abs(pos.getY(i) - 1.5) < 1e-4) mid = true;
      }
      // tall walls are split at 1.5 m so the grading stays near the ground
      expect(mid).toBe(tone === 'wall');
      g.dispose();
      e.mats.dispose();
      return { low, high };
    };
    const clean = shades(0, 'wall');
    const worn = shades(1, 'wall');
    expect(clean.high).toBeCloseTo(1, 5);
    expect(clean.low).toBeLessThan(0.95);
    expect(worn.low).toBeLessThan(clean.low - 0.1);
    expect(shades(1, 'roof').low).toBeCloseTo(1, 5);
  });

  it('bevels thick boxes at high quality without growing them', () => {
    const sharp = boxGeometry(2, 3, 1);
    const soft = boxGeometry(2, 3, 1, { chamfer: 0.04, split: 1.5 });
    expect(sharp.getAttribute('position').count).toBe(36);
    expect(soft.getAttribute('position').count).toBeGreaterThan(36 * 3);
    for (const g of [sharp, soft]) {
      g.computeBoundingBox();
      const b = g.boundingBox as THREE.Box3;
      expect(b.min.toArray().map((v) => +v.toFixed(5))).toEqual([-1, 0, -0.5]);
      expect(b.max.toArray().map((v) => +v.toFixed(5))).toEqual([1, 3, 0.5]);
      g.computeVertexNormals();
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      let area = 0;
      for (let i = 0; i < pos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i);
        const b2 = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        const centre = a.clone().add(b2).add(c).divideScalar(3).sub(new THREE.Vector3(0, 1.5, 0));
        expect(new THREE.Vector3().fromBufferAttribute(nor, i).dot(centre)).toBeGreaterThan(0);
        area += b2.sub(a).cross(c.sub(a)).length() / 2;
      }
      // closed surface: a sharp box has area 22; bevels only shave a little off
      expect(area).toBeGreaterThan(21);
      expect(area).toBeLessThanOrEqual(22 + 1e-6);
      g.dispose();
    }
    const count = (quality: 0 | 2): number => {
      const e = env();
      addBlueprint({ id: 'q', summary: '', doorX: 0, parts: [part('box', { w: 0.5, d: 0.5, h: 2 })] }, STYLE, placed, e, { dress: false, quality });
      const n = e.batch.build().reduce((s, m) => {
        const c = m.geometry.getAttribute('position').count;
        m.geometry.dispose();
        return s + c;
      }, 0);
      e.mats.dispose();
      return n;
    };
    expect(count(2)).toBeGreaterThan(count(0));
  });

  it('dresses buildings by default and reports the authored roof height', () => {
    const bp = BLUEPRINTS[0] as Blueprint;
    const tris = (dress: boolean): { n: number; height: number } => {
      const e = env();
      const { height } = addBlueprint(bp, STYLE, placed, e, { dress, quality: 0 });
      const n = e.batch.build().reduce((s, m) => {
        const c = m.geometry.getAttribute('position').count;
        m.geometry.dispose();
        return s + c;
      }, 0);
      e.mats.dispose();
      return { n, height };
    };
    const bare = tris(false);
    const dressed = tris(true);
    expect(dressed.n).toBeGreaterThan(bare.n + 36 * 6);
    expect(dressed.height).toBe(bare.height);
  });

  it('roofs a gable on its slopes only, tiles running down, and walls the ends', () => {
    const bp: Blueprint = { id: 'r', summary: '', doorX: 0, parts: [part('gable', { w: 0.8, d: 0.6, y: 3, h: 2, tone: 'roof' })] };
    const e = env();
    addBlueprint(bp, STYLE, { x: 0, z: 0, rotY: 0, w: 10, d: 8 }, e, { dress: false, quality: 0, theme: 'western' });
    const meshes = e.batch.build();
    const roof = meshes.find((m) => (m.material as THREE.Material).name === 'surface:shingle') as THREE.Mesh;
    const ends = meshes.find((m) => (m.material as THREE.Material).name === 'surface:planks') as THREE.Mesh;
    expect(meshes).toHaveLength(2);
    const upright = (m: THREE.Mesh): number[] => Array.from({ length: m.geometry.getAttribute('normal').count }, (_, i) => Math.abs(m.geometry.getAttribute('normal').getY(i)));
    expect(upright(ends).every((y) => y < 0.2)).toBe(true);
    expect(upright(roof).every((y) => y >= 0.2)).toBe(true);
    expect(ends.geometry.getAttribute('position').count).toBe(6);
    // on the slopes v climbs with height at the true slope length: rise 2 over a run of 2.4
    const pos = roof.geometry.getAttribute('position');
    const uv = roof.geometry.getAttribute('uv');
    const nor = roof.geometry.getAttribute('normal');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (nor.getY(i) < 0.2) continue;
      const v = uv.getY(i);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      expect(v).toBeCloseTo(pos.getY(i) > 4.9 ? hi : lo, 5);
    }
    expect((hi - lo) * 1.6).toBeCloseTo(Math.hypot(2, 2.4), 4);
    meshes.forEach((m) => m.geometry.dispose());
    e.mats.dispose();
  });

  it('runs wood grain along slender members', () => {
    // planks have their grain along v; a beam lying along x must take it along u instead
    const beam: Blueprint = { id: 'beam', summary: '', doorX: 0, parts: [part('box', { w: 0.6, d: 0.02, h: 0.2, y: 2 })] };
    const post: Blueprint = { id: 'post', summary: '', doorX: 0, parts: [part('box', { w: 0.02, d: 0.02, h: 3 })] };
    const spanV = (bp: Blueprint): number => {
      const e = env();
      addBlueprint(bp, STYLE, { x: 0, z: 0, rotY: 0, w: 10, d: 10 }, e, { dress: false, quality: 0, theme: 'western' });
      const [m] = e.batch.build();
      const g = (m as THREE.Mesh).geometry;
      const uv = g.getAttribute('uv');
      const nor = g.getAttribute('normal');
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        if (Math.abs(nor.getZ(i)) < 0.9) continue;
        lo = Math.min(lo, uv.getY(i));
        hi = Math.max(hi, uv.getY(i));
      }
      g.dispose();
      e.mats.dispose();
      return (hi - lo) * 2;
    };
    expect(spanV(beam)).toBeCloseTo(6, 4);
    expect(spanV(post)).toBeCloseTo(3, 4);
  });
});
