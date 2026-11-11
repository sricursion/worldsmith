import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { GeoBatch, MaterialCache } from '../../app/src/town/batch';
import { addBlueprint, addPropParts } from '../../app/src/town/blueprint-mesh';
import {
  boxGeometry, contactShade, contactsOf, growthOf, organicGeometry, partSeed, roundSegments, shapeGeometries, solidOf,
} from '../../app/src/town/part-geometry';
import type { Growth } from '../../app/src/town/part-geometry';
import { disposeSurfaces } from '../../app/src/town/surfaces';
import { makeRng } from '../../app/src/world/rng';
import { SKELETONS, buildSkeleton, skeletonNature } from '../../app/src/world/skeletons';
import type { Blueprint, BlueprintPart, PartShape } from '../../app/src/world/spec';
import { BLUEPRINTS, STYLE, part } from './helpers';

afterAll(() => disposeSurfaces());

const env = (): { batch: GeoBatch; mats: MaterialCache; rng: ReturnType<typeof makeRng> } => ({ batch: new GeoBatch(), mats: new MaterialCache(), rng: makeRng(1, 'part-geometry') });
const positions = (g: THREE.BufferGeometry): number[] => Array.from(g.getAttribute('position').array as Float32Array);
const triangles = (meshes: THREE.Mesh[]): number => meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0);
const drop = (meshes: THREE.Mesh[]): void => meshes.forEach((m) => m.geometry.dispose());

/** Every grown shape with the plain shape it replaces and a size it is used at, metres. */
const GROWN: readonly { kind: Growth; shape: PartShape; w: number; h: number; d: number; grounded: boolean }[] = [
  { kind: 'leaf', shape: 'sphere', w: 2.6, h: 2.2, d: 2.4, grounded: false },
  { kind: 'leaf', shape: 'dome', w: 1.8, h: 0.9, d: 1.6, grounded: false },
  { kind: 'leaf', shape: 'box', w: 1.2, h: 0.9, d: 0.8, grounded: true },
  { kind: 'whorl', shape: 'cone', w: 2.2, h: 1.6, d: 2.2, grounded: false },
  { kind: 'stem', shape: 'cylinder', w: 0.5, h: 3.5, d: 0.5, grounded: true },
  { kind: 'stem', shape: 'cylinder', w: 0.3, h: 1.4, d: 0.26, grounded: false },
  { kind: 'boulder', shape: 'sphere', w: 1.6, h: 1.1, d: 1.3, grounded: true },
  { kind: 'boulder', shape: 'dome', w: 2.4, h: 0.8, d: 2, grounded: true },
  { kind: 'rock', shape: 'box', w: 1.4, h: 1, d: 1.1, grounded: true },
  { kind: 'rock', shape: 'box', w: 0.4, h: 0.3, d: 0.35, grounded: false },
  { kind: 'rock', shape: 'pyramid', w: 1.2, h: 1.8, d: 1, grounded: true },
  { kind: 'rock', shape: 'wedge', w: 1.5, h: 0.7, d: 1, grounded: true },
];
const label = (c: (typeof GROWN)[number]): string => `${c.kind} from a ${c.shape} ${c.w} x ${c.h} x ${c.d}`;

describe('grown and weathered shapes', () => {
  it('are the same for the same seed and differ between seeds', () => {
    for (const c of GROWN) {
      const a = organicGeometry(c.kind, c.shape, c.w, c.h, c.d, 1234, 2, c.grounded);
      const b = organicGeometry(c.kind, c.shape, c.w, c.h, c.d, 1234, 2, c.grounded);
      const other = organicGeometry(c.kind, c.shape, c.w, c.h, c.d, 99, 2, c.grounded);
      expect(positions(a.geometry), label(c)).toEqual(positions(b.geometry));
      expect(Array.from(a.geometry.getAttribute('normal').array as Float32Array), label(c)).toEqual(Array.from(b.geometry.getAttribute('normal').array as Float32Array));
      expect(Array.from(a.shade), label(c)).toEqual(Array.from(b.shade));
      expect(positions(other.geometry), label(c)).not.toEqual(positions(a.geometry));
      for (const g of [a, b, other]) g.geometry.dispose();
    }
  });

  it('stay inside the box of the part they replace, to a millimetre, and still reach its base and its top', () => {
    const margin = 1e-3;
    for (const c of GROWN) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const { geometry } = organicGeometry(c.kind, c.shape, c.w, c.h, c.d, seed, 2, c.grounded);
        geometry.computeBoundingBox();
        const b = geometry.boundingBox as THREE.Box3;
        expect(b.min.x, label(c)).toBeGreaterThanOrEqual(-c.w / 2 - margin);
        expect(b.max.x, label(c)).toBeLessThanOrEqual(c.w / 2 + margin);
        expect(b.min.z, label(c)).toBeGreaterThanOrEqual(-c.d / 2 - margin);
        expect(b.max.z, label(c)).toBeLessThanOrEqual(c.d / 2 + margin);
        // what stood on something still does, and what carried something still reaches it
        expect(b.min.y, label(c)).toBeCloseTo(0, 5);
        expect(b.max.y, label(c)).toBeCloseTo(c.h, 5);
        // and it has not shrunk away from its outline: a mass still spans all of it, a stem (slimmer above its foot) most
        const kept = c.kind === 'stem' ? 0.75 : 0.999;
        expect(b.max.x - b.min.x, label(c)).toBeGreaterThan(kept * c.w);
        expect(b.max.z - b.min.z, label(c)).toBeGreaterThan(kept * c.d);
        geometry.dispose();
      }
    }
  });

  it('are closed skins that face outward, with finite unit normals and a shade per vertex', () => {
    for (const c of GROWN) {
      const { geometry, shade } = organicGeometry(c.kind, c.shape, c.w, c.h, c.d, 42, 2, c.grounded);
      const pos = geometry.getAttribute('position');
      const nor = geometry.getAttribute('normal');
      expect(geometry.index).toBeNull();
      expect(nor.count).toBe(pos.count);
      expect(shade.length).toBe(pos.count);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const e = new THREE.Vector3();
      const n = new THREE.Vector3();
      let volume = 0;
      let inward = 0;
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1);
        e.fromBufferAttribute(pos, i + 2);
        // signed volume under each face: positive in total only if the faces are wound outward
        volume += a.dot(new THREE.Vector3().crossVectors(b, e)) / 6;
        const faceNormal = new THREE.Vector3().crossVectors(b.clone().sub(a), e.clone().sub(a));
        for (let k = 0; k < 3; k++) {
          n.fromBufferAttribute(nor, i + k);
          expect(n.length(), label(c)).toBeCloseTo(1, 4);
          if (faceNormal.lengthSq() > 1e-12 && n.dot(faceNormal) < 0) inward++;
          const s = shade[i + k] as number;
          expect(s, label(c)).toBeGreaterThan(0.25);
          expect(s, label(c)).toBeLessThan(1.2);
        }
      }
      // a shared normal may lie behind one of its faces only at the sharp fold round the flat underside of a dome
      expect(inward, label(c)).toBeLessThanOrEqual(c.shape === 'dome' ? pos.count * 0.01 : 0);
      // a solid, and one that fills a fair share of its box
      expect(volume, label(c)).toBeGreaterThan(0.1 * c.w * c.h * c.d);
      expect(volume, label(c)).toBeLessThan(c.w * c.h * c.d);
      // every edge is shared by exactly two faces
      const edges = new Map<string, number>();
      const key = (i: number): string => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
      for (let i = 0; i < pos.count; i += 3) {
        for (let k = 0; k < 3; k++) {
          const p = key(i + k);
          const q = key(i + ((k + 1) % 3));
          if (p === q) continue;
          const id = p < q ? `${p}|${q}` : `${q}|${p}`;
          edges.set(id, (edges.get(id) ?? 0) + 1);
        }
      }
      // a stem that stands in the ground has no underside: that ring is open
      const open = [...edges.values()].filter((v) => v !== 2).length;
      if (c.kind === 'stem' && c.grounded) expect(open, label(c)).toBeLessThanOrEqual(12);
      else expect(open, label(c)).toBe(0);
      geometry.dispose();
    }
  });

  it('breaks the outline of a leaf mass and facets a rock, where the plain shapes were a ball and a crate', () => {
    // a crown seen from above: its radius swings by a good part of itself going round
    const crown = organicGeometry('leaf', 'sphere', 3, 3, 3, 7, 2, false);
    const pos = crown.geometry.getAttribute('position');
    const reach = new Array<number>(24).fill(0);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.floor(((Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI) / (2 * Math.PI)) * 24) % 24;
      reach[k] = Math.max(reach[k] as number, Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(0.12 * 1.5);
    // its underside is in shade, its top in light
    let low = 0;
    let lowN = 0;
    let high = 0;
    let highN = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.6) {
        low += crown.shade[i] as number;
        lowN++;
      } else if (pos.getY(i) > 2.4) {
        high += crown.shade[i] as number;
        highN++;
      }
    }
    expect(low / lowN).toBeLessThan(0.8 * (high / highN));
    crown.geometry.dispose();

    // a rock: flat facets (each triangle's three normals agree), none of them square to the box any more than a few
    const rock = organicGeometry('rock', 'box', 1.4, 1, 1.1, 7, 2, true);
    const rn = rock.geometry.getAttribute('normal');
    let square = 0;
    for (let i = 0; i < rn.count; i += 3) {
      expect(rn.getX(i)).toBeCloseTo(rn.getX(i + 1), 6);
      expect(rn.getY(i)).toBeCloseTo(rn.getY(i + 2), 6);
      if (Math.max(Math.abs(rn.getX(i)), Math.abs(rn.getY(i)), Math.abs(rn.getZ(i))) > 0.999) square++;
    }
    // the face it stands on is left flat; the rest has been worn out of true
    expect(square).toBeLessThan(rn.count / 3 / 4);
    rock.geometry.dispose();

    // a boulder is rounded: neighbouring faces share their normals at a shared point
    const boulder = organicGeometry('boulder', 'sphere', 1.6, 1.1, 1.3, 7, 2, true);
    const bn = boulder.geometry.getAttribute('normal');
    let smooth = 0;
    for (let i = 0; i < bn.count; i += 3) if (Math.abs(bn.getX(i) - bn.getX(i + 1)) > 1e-4 || Math.abs(bn.getY(i) - bn.getY(i + 1)) > 1e-4) smooth++;
    expect(smooth).toBeGreaterThan(bn.count / 3 / 2);
    boulder.geometry.dispose();
  });

  it('tapers a trunk and flares it at the ground', () => {
    const trunk = organicGeometry('stem', 'cylinder', 0.6, 4, 0.6, 5, 2, true);
    const pos = trunk.geometry.getAttribute('position');
    /** Width of the stem between two heights, whichever way it has bowed. */
    const width = (y0: number, y1: number): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < y0 || pos.getY(i) > y1) continue;
        lo = Math.min(lo, pos.getX(i));
        hi = Math.max(hi, pos.getX(i));
      }
      return hi - lo;
    };
    const foot = width(0, 0.01);
    const waist = width(2, 2.6);
    const head = width(3.99, 4);
    expect(foot).toBeGreaterThan(waist * 1.03);
    expect(head).toBeLessThan(foot);
    expect(head).toBeLessThan(0.9 * 0.6);
    expect(foot).toBeLessThanOrEqual(0.6 + 1e-6);
    trunk.geometry.dispose();
  });

  it('shapes only what is a lump of leaf, wood or stone', () => {
    expect(growthOf('plant', 'sphere', 'accent', 2, 2, 2)).toBe('leaf');
    expect(growthOf('plant', 'cone', 'roof', 2, 1.5, 2)).toBe('whorl');
    expect(growthOf('plant', 'cylinder', 'wall2', 0.4, 3, 0.4)).toBe('stem');
    expect(growthOf('plant', 'sphere', 'wall2', 0.8, 0.6, 0.8)).toBe('boulder');
    expect(growthOf('mineral', 'sphere', 'wall', 1, 0.8, 1)).toBe('boulder');
    expect(growthOf('mineral', 'box', 'wall2', 1, 0.8, 1)).toBe('rock');
    expect(growthOf('mineral', 'pyramid', 'wall2', 1, 1.5, 1)).toBe('rock');
    expect(growthOf('mineral', 'wedge', 'trim', 1, 0.5, 0.8)).toBe('rock');
    // a frond (a thin dome), a blade, a pebble, a flower, a crystal and a lamp keep their plain shapes
    expect(growthOf('plant', 'dome', 'accent', 2, 0.8, 0.3)).toBeNull();
    expect(growthOf('plant', 'box', 'accent', 0.05, 1, 0.4)).toBeNull();
    expect(growthOf('mineral', 'sphere', 'wall', 0.1, 0.08, 0.1)).toBeNull();
    expect(growthOf('plant', 'sphere', 'trim', 0.3, 0.3, 0.3)).toBeNull();
    expect(growthOf('mineral', 'box', 'glass', 0.5, 2, 0.5)).toBeNull();
    expect(growthOf('mineral', 'box', 'accent', 0.5, 2, 0.5)).toBeNull();
    expect(growthOf('plant', 'sphere', 'glow', 1, 1, 1)).toBeNull();
    expect(growthOf('plant', 'cylinder', 'wall2', 1, 0.3, 1)).toBeNull();
  });

  it('seeds a part from the world seed, the place and the part, and from nothing else', () => {
    expect(partSeed(3, 10.5, -4, 2)).toBe(partSeed(3, 10.5, -4, 2));
    const seen = new Set([partSeed(3, 10.5, -4, 2), partSeed(4, 10.5, -4, 2), partSeed(3, 10.51, -4, 2), partSeed(3, 10.5, -4.01, 2), partSeed(3, 10.5, -4, 3)]);
    expect(seen.size).toBe(5);
  });
});

describe('props built from parts', () => {
  const tree: BlueprintPart[] = [
    part('cylinder', { w: 0.14, d: 0.14, h: 0.6 }, 'wall2'),
    part('sphere', { y: 0.5, w: 0.7, d: 0.7, h: 0.6 }, 'accent'),
    part('sphere', { x: 0.2, y: 0.4, w: 0.45, d: 0.45, h: 0.4 }, 'accent'),
  ];
  const build = (parts: BlueprintPart[], nature: 'plant' | 'mineral' | undefined, at: { x: number; z: number }, seed = 5, size = 4): THREE.Mesh[] => {
    const e = env();
    addPropParts(parts, size, STYLE, { x: at.x, z: at.z, rotY: 0, scale: 1 }, e, { quality: 2, seed, ...(nature ? { nature } : {}) });
    return e.batch.build();
  };
  const flat = (meshes: THREE.Mesh[]): number[] => meshes.flatMap((m) => positions(m.geometry));

  it('builds the same tree twice in the same place, and another one a step away', () => {
    const a = build(tree, 'plant', { x: 12, z: -3 });
    const b = build(tree, 'plant', { x: 12, z: -3 });
    const c = build(tree, 'plant', { x: 17, z: -3 });
    expect(flat(a)).toEqual(flat(b));
    const moved = flat(c).map((v, i) => (i % 3 === 0 ? v - 5 : v));
    expect(moved.length).toBe(flat(a).length);
    expect(moved.some((v, i) => Math.abs(v - (flat(a)[i] as number)) > 0.02)).toBe(true);
    for (const m of [a, b, c]) drop(m);
  });

  it('keeps a tree and a rock inside the outline they were authored with', () => {
    for (const [parts, nature] of [[tree, 'plant'], [[part('sphere', { w: 0.8, d: 0.7, h: 0.5 }), part('box', { x: 0.3, w: 0.3, d: 0.3, h: 0.25 }, 'wall2')], 'mineral']] as const) {
      const grown = build(parts as BlueprintPart[], nature, { x: 0, z: 0 });
      const plain = build(parts as BlueprintPart[], undefined, { x: 0, z: 0 });
      const box = (meshes: THREE.Mesh[]): THREE.Box3 => {
        const b = new THREE.Box3();
        for (const m of meshes) b.union(new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position') as THREE.BufferAttribute));
        return b;
      };
      const g = box(grown);
      const p = box(plain);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(g.min[k]).toBeGreaterThanOrEqual(p.min[k] - 1e-3);
        expect(g.max[k]).toBeLessThanOrEqual(p.max[k] + 1e-3);
      }
      expect(g.min.y).toBeCloseTo(0, 4);
      expect(g.max.y).toBeCloseTo(p.max.y, 3);
      drop(grown);
      drop(plain);
    }
  });

  it('shades the trunk under the crown', () => {
    const meshes = build(tree, 'plant', { x: 0, z: 0 });
    const bark = meshes.find((m) => (m.material as THREE.Material).name === 'surface:bark') as THREE.Mesh;
    const pos = bark.geometry.getAttribute('position');
    const col = bark.geometry.getAttribute('color');
    let under = 0;
    let underN = 0;
    let clear = 0;
    let clearN = 0;
    for (let i = 0; i < pos.count; i++) {
      // the crown starts at 2 m; the top of the trunk's side just below it, against its middle
      if (pos.getY(i) > 1.75 && pos.getY(i) < 2) {
        under += col.getX(i);
        underN++;
      } else if (pos.getY(i) > 0.5 && pos.getY(i) < 0.9) {
        clear += col.getX(i);
        clearN++;
      }
    }
    expect(underN).toBeGreaterThan(0);
    expect(clearN).toBeGreaterThan(0);
    expect(under / underN).toBeLessThan(0.9 * (clear / clearN));
    drop(meshes);
  });

  it('holds every nature family to a triangle budget, in one draw per surface', () => {
    const families = Object.values(SKELETONS).filter((s) => s.group === 'nature').map((s) => s.id);
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      for (const seed of [1, 2, 3]) {
        const parts = buildSkeleton(family, undefined, seed);
        expect(parts.length, family).toBeGreaterThan(0);
        const meshes = build(parts, skeletonNature(family), { x: 0, z: 0 }, seed);
        // 28 parts at most; the heaviest single part is a crown or boulder over five metres at 720 triangles
        expect(triangles(meshes), family).toBeLessThanOrEqual(4500);
        // bark, leaf, a second leaf, flower, stone, crystal, lamp: never more surfaces than tones
        expect(meshes.length, family).toBeLessThanOrEqual(8);
        for (const m of meshes) {
          const pos = m.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
        }
        drop(meshes);
      }
    }
  }, 120000);
});

describe('buildings', () => {
  const placed = { x: 12, z: -30, rotY: 0.7, w: 10, d: 8 };

  it('gives small round parts few sides and large ones enough to hide the corners', () => {
    expect(roundSegments(0.09, 2)).toBeLessThanOrEqual(8);
    expect(roundSegments(0.5, 2)).toBeLessThanOrEqual(12);
    expect(roundSegments(6, 2)).toBeGreaterThanOrEqual(32);
    // the turn between neighbouring sides of anything over two metres is under fifteen degrees
    for (const span of [2, 3, 5, 8, 12]) expect(360 / roundSegments(span, 2)).toBeLessThanOrEqual(15);
    for (const span of [0.05, 0.5, 2, 8, 20]) {
      expect(roundSegments(span, 0)).toBeLessThanOrEqual(roundSegments(span, 2));
      expect(roundSegments(span, 0)).toBeGreaterThanOrEqual(6);
    }
    const sides = (w: number): number => {
      const e = env();
      addBlueprint({ id: 'c', summary: '', doorX: 0, parts: [part('cylinder', { w: w / 10, d: w / 8, h: 3, y: 4 })] }, STYLE, placed, e, { dress: false, quality: 2 });
      const meshes = e.batch.build();
      const n = triangles(meshes);
      drop(meshes);
      // a cylinder is four triangles a side
      return n / 4;
    };
    expect(sides(0.1)).toBeLessThanOrEqual(8);
    expect(sides(7)).toBeGreaterThanOrEqual(32);
  });

  it('draws glass cones, pyramids, balls and domes as plain glass, and only panes as lit windows', () => {
    const materials = (shape: PartShape, o: Partial<BlueprintPart> = {}): string[] => {
      const e = env();
      addBlueprint({ id: 'g', summary: '', doorX: 0, parts: [part(shape, { w: 0.12, d: 0.15, h: 1.2, y: 3, ...o }, 'glass')] }, STYLE, placed, e, { dress: false, quality: 1 });
      const meshes = e.batch.build();
      const names = meshes.map((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        // plain glass carries no map at all: nothing to blotch
        if (mat.name !== 'surface:window') {
          expect(mat.emissiveMap).toBeNull();
          expect(mat.map).toBeNull();
          expect(mat.roughness).toBeLessThan(0.15);
        }
        return mat.name;
      });
      drop(meshes);
      return names;
    };
    for (const shape of ['cone', 'pyramid', 'sphere', 'dome', 'wedge', 'gable', 'ring'] as const) expect(materials(shape), shape).not.toContain('surface:window');
    // a thin glass cylinder is a tube, not a glazed room
    expect(materials('cylinder')).not.toContain('surface:window');
    expect(materials('cylinder', { w: 0.3, d: 0.3 })).toContain('surface:window');
    expect(materials('box')).toContain('surface:window');
    expect(materials('arch')).toContain('surface:window');
    // a pane too large to be a window was already a plain sheet
    expect(materials('box', { w: 0.6, d: 0.02, h: 4 })).not.toContain('surface:window');
  });

  it('shades a wall under the eaves and leaves a flush stack alone', () => {
    const top = (roofW: number): { top: number; mid: number } => {
      const bp: Blueprint = { id: 'e', summary: '', doorX: 0, parts: [part('box', { w: 0.5, d: 0.5, h: 4 }), part('box', { y: 4, w: roofW, d: roofW, h: 0.4 }, 'wall2')] };
      const style = { ...STYLE, variety: 0, surfaces: { wall: 'plaster', wall2: 'stone', roof: 'tile', trim: 'timber', ground: 'dirt', road: 'dirt', wear: 0, wet: 0 } as const };
      const e = env();
      addBlueprint(bp, style, { x: 0, z: 0, rotY: 0, w: 10, d: 10 }, e, { dress: false, quality: 0 });
      const meshes = e.batch.build();
      const wall = meshes.find((m) => (m.material as THREE.Material).name === 'surface:plaster') as THREE.Mesh;
      const pos = wall.geometry.getAttribute('position');
      const col = wall.geometry.getAttribute('color');
      const nor = wall.geometry.getAttribute('normal');
      let at4 = 1;
      let at33 = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(nor.getY(i)) > 0.5) continue;
        if (pos.getY(i) > 3.99) at4 = Math.min(at4, col.getX(i));
        if (Math.abs(pos.getY(i) - 3.1) < 1e-3) at33 = Math.max(at33, col.getX(i));
      }
      drop(meshes);
      return { top: at4, mid: at33 };
    };
    const eaved = top(0.6);
    // dark right under the overhang, and back to the wall's own tone on the line 0.9 m below it, where that shade runs out
    expect(eaved.top).toBeLessThan(0.8);
    expect(eaved.mid).toBeCloseTo(1, 5);
    const flush = top(0.5);
    expect(flush.top).toBeCloseTo(1, 5);
  });

  it('seats a small part on the one that carries it', () => {
    const lower = solidOf(0, 0, 0, 2, 1, 2, 0, true);
    const upper = solidOf(0.2, 0, 1, 0.8, 0.8, 0.8, 20, true);
    const solids = [lower, upper];
    expect(contactsOf(solids, 0)?.over).toEqual([upper]);
    expect(contactsOf(solids, 1)?.under).toEqual([lower]);
    const [g] = shapeGeometries('box', 0.8, 0.8, 0.8);
    const crate = g as THREE.BufferGeometry;
    crate.translate(0.2, 1, 0);
    const shade = contactShade(crate, upper, contactsOf(solids, 1)) as ArrayLike<number>;
    const pos = crate.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(shade[i]).toBeCloseTo(pos.getY(i) < 1.01 ? 0.8 : 1, 5);
    // nothing near it: no array is made at all
    expect(contactShade(crate, upper, contactsOf([upper], 0))).toBe(1);
    crate.dispose();
  });

  it('leans a foundation in toward its top and bevels a wall with windows, inside their boxes', () => {
    const plain = boxGeometry(4, 2, 3);
    const battered = boxGeometry(4, 2, 3, { chamfer: 0, split: 0, batter: 0.04 });
    for (const g of [plain, battered]) g.computeBoundingBox();
    expect((battered.boundingBox as THREE.Box3).max.toArray().map((v) => +v.toFixed(5))).toEqual([2, 2, 1.5]);
    const pos = battered.getAttribute('position');
    let topX = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 1.99) topX = Math.max(topX, pos.getX(i));
    expect(topX).toBeCloseTo(2 - 0.04, 5);
    plain.dispose();
    battered.dispose();

    // the shop has windows and a door cut into its body; at quality 2 that wall's corners are no longer razor edges
    const bevels = (quality: 0 | 2): number => {
      const e = env();
      addBlueprint(BLUEPRINTS[0] as Blueprint, STYLE, { x: 0, z: 0, rotY: Math.PI, w: 9, d: 8 }, e, { quality, theme: 'western' });
      const meshes = e.batch.build();
      const wall = meshes.find((m) => (m.material as THREE.Material).name === 'surface:planks') as THREE.Mesh;
      const p = wall.geometry.getAttribute('position');
      const n = wall.geometry.getAttribute('normal');
      let count = 0;
      for (let i = 0; i < p.count; i += 3) {
        // a facet standing at 45 degrees between two walls, at the body's own corner
        const corner = [0, 1, 2].every((k) => Math.abs(Math.abs(p.getX(i + k)) - 4.05) < 0.04 && Math.abs(Math.abs(p.getZ(i + k)) - 3.6) < 0.04);
        if (corner && Math.abs(n.getY(i)) < 0.1 && Math.abs(Math.abs(n.getX(i)) - Math.SQRT1_2) < 0.01) count++;
      }
      drop(meshes);
      return count;
    };
    expect(bevels(2)).toBeGreaterThanOrEqual(8);
    expect(bevels(0)).toBe(0);
  });

  it('keeps a typical building and a typical tree within their triangle budgets', () => {
    const building = (bp: Blueprint): number => {
      const e = env();
      addBlueprint(bp, STYLE, { x: 0, z: 0, rotY: 0, w: 9, d: 8 }, e, { quality: 2 });
      const meshes = e.batch.build();
      const n = triangles(meshes);
      drop(meshes);
      return n;
    };
    // the gabled shop was 1868 triangles before edges were bevelled and round parts sized by girth; the tower, 1700
    expect(building(BLUEPRINTS[0] as Blueprint)).toBeLessThanOrEqual(2400);
    expect(building(BLUEPRINTS[1] as Blueprint)).toBeLessThanOrEqual(3600);
    expect(building(BLUEPRINTS[2] as Blueprint)).toBeLessThanOrEqual(1400);
    const e = env();
    addPropParts(buildSkeleton('broadleaf', undefined, 3), 4, STYLE, { x: 0, z: 0, rotY: 0, scale: 1 }, e, { quality: 2, nature: 'plant' });
    const meshes = e.batch.build();
    // 1716 with plain balls and pipes
    expect(triangles(meshes)).toBeLessThanOrEqual(2400);
    drop(meshes);
  });
});
