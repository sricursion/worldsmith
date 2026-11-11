import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { GeoBatch, MaterialCache } from '../../app/src/town/batch';
import { addBlueprint, expandBlueprintParts } from '../../app/src/town/blueprint-mesh';
import { PART_BUDGET, RISE, dressBuilding, dressParts, eraFromWords, revealDepth } from '../../app/src/town/detail';
import type { Dressed } from '../../app/src/town/detail';
import { disposeSurfaces, inferSurfaces } from '../../app/src/town/surfaces';
import { makeRng } from '../../app/src/world/rng';
import type { Blueprint, BlueprintPart, StyleSpec, SurfaceKind, SurfaceSet } from '../../app/src/world/spec';
import { BLUEPRINTS, STYLE, part } from './helpers';

afterAll(() => disposeSurfaces());

const W = 9;
const D = 8;
const SURFACES: SurfaceSet = { ...inferSurfaces(STYLE, 'western'), wear: 0.3 };
const ctx = (over: Partial<SurfaceSet> = {}, quality?: 0 | 1 | 2, salt = 'depth') =>
  ({ w: W, d: D, rng: makeRng(7, salt), surfaces: { ...SURFACES, ...over }, doorX: 0, quality });

/** A wall with a window either side of where the door goes. */
const FRONT: BlueprintPart[] = [
  part('box', { w: 0.8, d: 0.8, h: 4 }),
  part('box', { x: -0.25, z: 0.4 + 0.015, y: 1, w: 0.09, d: 0.03, h: 1.1 }, 'glass'),
  part('box', { x: 0.25, z: 0.4 + 0.015, y: 1, w: 0.09, d: 0.03, h: 1.1 }, 'glass'),
];
const HOUSE: BlueprintPart[] = [
  part('box', { w: 0.8, d: 0.8, h: 6.5 }),
  part('gable', { w: 0.9, d: 0.9, y: 6.5, h: 2.4, tone: 'roof' }),
  part('box', { x: 0, z: 0.4 + 0.015, y: 1, w: 0.09, d: 0.03, h: 1.1, repeat: 2, gap: 0.5 }, 'glass'),
  part('box', { x: 0, z: 0.4 + 0.015, y: 4, w: 0.09, d: 0.03, h: 1.1, repeat: 3, gap: 0.25 }, 'glass'),
  part('box', { x: 0.42, z: 0, y: 1, w: 0.03, d: 0.1, h: 1.1 }, 'glass'),
];
/** Many windows on two faces: more trim than any budget holds. */
const MANY: BlueprintPart[] = [
  part('box', { w: 0.9, d: 0.9, h: 9 }),
  part('gable', { w: 1, d: 1, y: 9, h: 2, tone: 'roof' }),
  ...[1, 4, 7].flatMap((y) => [
    part('box', { z: 0.46, y, w: 0.06, d: 0.03, h: 1.2, repeat: 6, gap: 0.14 }, 'glass'),
    part('box', { z: -0.46, y, w: 0.06, d: 0.03, h: 1.2, repeat: 6, gap: 0.14 }, 'glass'),
  ]),
];

const style = (surfaces: Partial<SurfaceSet>): StyleSpec => ({ ...STYLE, surfaces: { ...SURFACES, ...surfaces } });
/** Builds with the building's own frame on the world axes: +z is the front. */
function build(parts: BlueprintPart[], st: StyleSpec, opts: Parameters<typeof addBlueprint>[4] = {}, at = { x: 0, z: 0 }, id = 'depth'): THREE.Mesh[] {
  const batch = new GeoBatch();
  const mats = new MaterialCache();
  const bp: Blueprint = { id, summary: '', doorX: 0, parts };
  addBlueprint(bp, st, { x: at.x, z: at.z, rotY: Math.PI, w: W, d: D }, { batch, mats, rng: makeRng(1, 'depth-build') }, { seed: 3, ...opts });
  return batch.build();
}
/** The stream addBlueprint hands the dressing pass for `build` at the origin: its first draw goes to the texture offset. */
const placedRng = () => {
  const rng = makeRng(3, 'dress|0|0|depth');
  rng.next();
  return rng;
};
const triangles = (meshes: THREE.Mesh[]): number => meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0);
const bounds = (meshes: THREE.Mesh[]): THREE.Box3 => {
  const box = new THREE.Box3();
  for (const m of meshes) box.union(new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position') as THREE.BufferAttribute));
  return box;
};
const drop = (meshes: THREE.Mesh[]): void => meshes.forEach((m) => m.geometry.dispose());
const units = (d: Dressed): number => d.parts.length - d.hidden.length + d.openings.length + d.struts.length + d.roofs.length * 3;

describe('openings cut into walls', () => {
  it('seats two windows and a door in the wall, the glazing behind the wall plane by the reveal depth, for three wall kinds', () => {
    const src = expandBlueprintParts(FRONT);
    const face = 0.4 * D;
    const depths: number[] = [];
    for (const wall of ['stone', 'planks', 'corrugated'] as SurfaceKind[]) {
      const d = dressBuilding(src, ctx({ wall }));
      // the authored parts come back first and untouched; the two glass slabs are replaced by openings
      expect(d.parts.slice(0, src.length)).toEqual(src);
      expect(d.hidden.slice().sort()).toEqual([1, 2]);
      const windows = d.openings.filter((o) => o.kind === 'window');
      const doors = d.openings.filter((o) => o.kind === 'door');
      expect(windows).toHaveLength(2);
      expect(doors).toHaveLength(1);
      for (const o of d.openings) {
        expect(o.wall).toBe(0);
        expect(o.face).toBe(0);
        expect(o.depth).toBeGreaterThanOrEqual(0.12);
        expect(o.depth).toBeLessThanOrEqual(0.35);
        expect(o.depth).toBeGreaterThan(revealDepth(wall) * 0.9);
        expect(o.depth).toBeLessThan(revealDepth(wall) * 1.1);
      }
      for (const o of windows) {
        expect(o.u1 - o.u0).toBeCloseTo(0.09 * W, 6);
        expect(o.v0).toBeCloseTo(1, 6);
        expect(o.v1).toBeCloseTo(2.1, 6);
        expect(o.sill).toBeGreaterThan(0);
      }
      const door = doors[0];
      expect(door && door.u1 - door.u0).toBeCloseTo(1, 6);
      expect(door && door.v1).toBeGreaterThan(2);
      const depth = windows[0]?.depth ?? 0;
      depths.push(depth);

      // in the mesh: every pane of glass lies exactly that far behind the wall face, none on or before it
      const meshes = build(FRONT, style({ wall }), { quality: 2 });
      const glass = meshes.filter((m) => (m.material as THREE.Material).name === 'surface:window');
      expect(glass).toHaveLength(1);
      const pos = (glass[0] as THREE.Mesh).geometry.getAttribute('position');
      expect(pos.count).toBe(12);
      const built = dressBuilding(src, { ...ctx({ wall }), rng: placedRng(), quality: 2 }).openings[1]?.depth ?? 0;
      for (let i = 0; i < pos.count; i++) expect(pos.getZ(i)).toBeCloseTo(face - built, 4);
      // the wall around them is still on its plane, and has faces that run back into it (the reveals)
      const wallMesh = meshes.find((m) => (m.material as THREE.Material).name === `surface:${wall}`) as THREE.Mesh;
      const wp = wallMesh.geometry.getAttribute('position');
      const wn = wallMesh.geometry.getAttribute('normal');
      let onPlane = 0;
      let reveals = 0;
      for (let i = 0; i < wp.count; i += 3) {
        const zs = [wp.getZ(i), wp.getZ(i + 1), wp.getZ(i + 2)];
        if (zs.every((z) => Math.abs(z - face) < 1e-4) && wn.getZ(i) > 0.9) onPlane++;
        // inside the face only: the box's own ends and top, and the parapet's, also run back from this plane
        const inside = [0, 1, 2].every((k) => Math.abs(wp.getX(i + k)) < 3.5 && wp.getY(i + k) < 4 - 1e-3);
        if (inside && Math.max(...zs) > face - 1e-4 && Math.min(...zs) < face - 0.05 && Math.abs(wn.getZ(i)) < 0.5) reveals++;
      }
      expect(onPlane).toBeGreaterThan(10);
      // two jambs, a head and a sill for each of three openings, two triangles apiece
      expect(reveals).toBe(3 * 4 * 2);
      drop(meshes);
    }
    // thick for laid stone, thinner for boards, thinnest for sheet
    expect(depths[0] as number).toBeGreaterThan((depths[1] as number) + 0.08);
    expect(depths[1] as number).toBeGreaterThan(depths[2] as number);
  });

  it('leaves a wall watertight: the panels around the openings cover the face exactly', () => {
    const meshes = build(FRONT, style({ wall: 'brick' }), { quality: 2 });
    const d = dressBuilding(expandBlueprintParts(FRONT), { ...ctx({ wall: 'brick' }), rng: placedRng(), quality: 2 });
    const wallMesh = meshes.find((m) => (m.material as THREE.Material).name === 'surface:brick') as THREE.Mesh;
    const pos = wallMesh.geometry.getAttribute('position');
    const nor = wallMesh.geometry.getAttribute('normal');
    const face = 0.4 * D;
    let area = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      // up to the top of the wall only: the parapet above it stands on the same plane
      if (nor.getZ(i) > 0.9 && Math.abs(a.z - face) < 1e-4 && Math.abs(b.z - face) < 1e-4 && Math.abs(c.z - face) < 1e-4 && Math.max(a.y, b.y, c.y) <= 4 + 1e-4 && Math.abs(a.x) <= 3.6 + 1e-4) {
        area += b.sub(a).cross(c.sub(a)).length() / 2;
      }
    }
    const holes = d.openings.reduce((s, o) => s + (o.u1 - o.u0) * (o.v1 - o.v0), 0);
    // trim that lies flat on the face shares the plane and the surface only when it is the wall's own tone: none here
    expect(area).toBeCloseTo(0.8 * W * 4 - holes, 3);
    drop(meshes);
  });

  it('keeps openings flat when asked, and for the parts-only pass', () => {
    const src = expandBlueprintParts(FRONT);
    expect(dressParts(src, ctx({ wall: 'stone' })).slice(0, src.length)).toEqual(src);
    const flat = build(FRONT, style({ wall: 'stone' }), { quality: 2, depth: false });
    const glass = flat.find((m) => (m.material as THREE.Material).name === 'surface:window') as THREE.Mesh;
    const box = new THREE.Box3().setFromBufferAttribute(glass.geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(box.max.z).toBeGreaterThan(0.4 * D);
    drop(flat);
  });

  it('fits a pane beside the door or above it, and leaves out one that cannot fit', () => {
    const over = expandBlueprintParts([
      part('box', { w: 0.8, d: 0.8, h: 6 }),
      // one that overlaps the door on its right, one that stands right across it and reaches above
      part('box', { x: 0.09, z: 0.415, y: 1, w: 0.09, d: 0.03, h: 1.1 }, 'glass'),
      part('box', { x: 0, z: 0.415, y: 1.2, w: 0.06, d: 0.03, h: 2.2 }, 'glass'),
    ]);
    const d = dressBuilding(over, ctx({ wall: 'brick' }));
    const door = d.openings.find((o) => o.kind === 'door');
    const windows = d.openings.filter((o) => o.kind === 'window');
    expect(door).toBeDefined();
    expect(d.hidden.slice().sort()).toEqual([1, 2]);
    for (const o of windows) {
      const clear = o.u0 >= (door?.u1 ?? 0) + 0.1 || o.u1 <= (door?.u0 ?? 0) - 0.1 || o.v0 >= (door?.v1 ?? 0) + 0.1;
      expect(clear).toBe(true);
    }
    expect(windows.some((o) => o.v0 > (door?.v1 ?? 9))).toBe(true);
  });

  it('does not cut where another part stands in the recess', () => {
    const src = expandBlueprintParts([
      part('box', { w: 0.8, d: 0.8, h: 4 }),
      part('box', { x: 0.25, z: 0.415, y: 1, w: 0.09, d: 0.03, h: 1.1 }, 'glass'),
      // a second mass whose front stands 10 cm behind the first one's, across the window
      part('box', { x: 0.3, z: 0, w: 0.3, d: 0.775, h: 4, tone: 'wall2' }),
    ]);
    const d = dressBuilding(src, { ...ctx({ wall: 'stone' }), doorX: undefined });
    expect(d.openings.filter((o) => o.wall === 0)).toHaveLength(0);
    expect(d.hidden).toEqual([]);
  });
});

describe('budgets, reach and determinism', () => {
  it('stays inside the part budget of each quality, dropping the smallest work first, and inside a triangle budget', () => {
    const src = expandBlueprintParts(MANY);
    const counts: number[] = [];
    const tris: number[] = [];
    for (const q of [0, 1, 2] as const) {
      const d = dressBuilding(src, ctx({ wall: 'brick', roof: 'tile' }, q));
      expect(units(d)).toBeLessThanOrEqual(PART_BUDGET[q]);
      counts.push(units(d));
      // the plinth and the roof slab outlive every cut; the openings themselves are never dropped
      expect(d.parts.slice(src.length).some((p) => p.y === 0 && p.w * W > 0.9 * W && p.h < 0.5)).toBe(true);
      expect(d.roofs).toHaveLength(1);
      // two ground-floor panes stand across the door and are left out; the other 34 are cut at every quality
      expect(d.openings.filter((o) => o.kind === 'window')).toHaveLength(34);
      const meshes = build(MANY, style({ wall: 'brick', roof: 'tile' }), { quality: q });
      tris.push(triangles(meshes));
      // forty triangles a part is a bevelled box with a split face: the average stays under it
      expect(triangles(meshes)).toBeLessThanOrEqual(PART_BUDGET[q] * 40);
      drop(meshes);
    }
    expect(PART_BUDGET).toEqual([80, 140, 220]);
    expect(counts[0] as number).toBeLessThan(counts[1] as number);
    expect(counts[1] as number).toBeLessThan(counts[2] as number);
    expect(tris[0] as number).toBeLessThan(tris[2] as number);
    // an ordinary house does not need the whole budget
    expect(units(dressBuilding(expandBlueprintParts(HOUSE), ctx({}, 0)))).toBeLessThanOrEqual(PART_BUDGET[0]);
  });

  it('lets nothing reach more than 0.7 m beyond the authored bounds sideways, nor higher than a chimney above them', () => {
    const cases: [BlueprintPart[], Partial<SurfaceSet>][] = [
      [HOUSE, { wall: 'plaster', roof: 'thatch' }],
      [HOUSE, { wall: 'stone', roof: 'tile', wear: 1 }],
      [HOUSE, { wall: 'corrugated', wall2: 'metal_panel', roof: 'corrugated', wear: 0.7 }],
      [MANY, { wall: 'brick', roof: 'slate' }],
      ...BLUEPRINTS.map((b): [BlueprintPart[], Partial<SurfaceSet>] => [b.parts, { wall: 'planks', roof: 'shingle', wear: 0.9 }]),
      ...BLUEPRINTS.map((b): [BlueprintPart[], Partial<SurfaceSet>] => [b.parts, { wall: 'stone', roof: 'tile' }]),
    ];
    for (const [parts, surfaces] of cases) {
      const bare = build(parts, style(surfaces), { quality: 2, dress: false });
      const full = build(parts, style(surfaces), { quality: 2 });
      const a = bounds(bare);
      const b = bounds(full);
      expect(b.min.x).toBeGreaterThanOrEqual(a.min.x - 0.7);
      expect(b.max.x).toBeLessThanOrEqual(a.max.x + 0.7);
      expect(b.min.z).toBeGreaterThanOrEqual(a.min.z - 0.7);
      expect(b.max.z).toBeLessThanOrEqual(a.max.z + 0.7);
      expect(b.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(b.max.y).toBeLessThanOrEqual(a.max.y + RISE + 0.01);
      for (const m of full) {
        const pos = m.geometry.getAttribute('position');
        const nor = m.geometry.getAttribute('normal');
        expect(m.geometry.index).toBeNull();
        expect(pos.array).toBeInstanceOf(Float32Array);
        expect(nor.count).toBe(pos.count);
        expect(m.matrixAutoUpdate).toBe(false);
        for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i) + nor.getX(i) + nor.getY(i) + nor.getZ(i))).toBe(true);
      }
      drop(bare);
      drop(full);
    }
  });

  it('builds the same thing for the same seed and place, and tells two neighbours of one blueprint apart', () => {
    const src = expandBlueprintParts(HOUSE);
    expect(dressBuilding(src, ctx({ wear: 0.9 }, 2))).toEqual(dressBuilding(src, ctx({ wear: 0.9 }, 2)));
    const flatten = (meshes: THREE.Mesh[]): number[] => meshes.flatMap((m) => Array.from(m.geometry.getAttribute('position').array as Float32Array));
    const st = style({ wall: 'plaster', roof: 'tile', wear: 0.6 });
    const one = build(HOUSE, st, { quality: 2 });
    const two = build(HOUSE, st, { quality: 2 });
    expect(flatten(one)).toEqual(flatten(two));
    drop(one);
    drop(two);
    // the same blueprint on another lot: its own reveal depth, glazing and trim
    const dressings = [0, 1, 2, 3, 4, 5].map((k) => {
      const d = dressBuilding(src, ctx({ wall: 'plaster', roof: 'tile', wear: 0.6 }, 2, `lot-${k}`));
      return JSON.stringify([d.openings.map((o) => [o.depth.toFixed(3), o.fill, o.room > 0]), d.parts.length, d.struts.length]);
    });
    expect(new Set(dressings).size).toBeGreaterThanOrEqual(5);
  });

  it('builds a dressed building in well under 25 ms once its surfaces exist', () => {
    const st = style({ wall: 'brick', roof: 'tile' });
    drop(build(MANY, st, { quality: 2 }));
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const batch = new GeoBatch();
      const mats = new MaterialCache();
      const t0 = performance.now();
      addBlueprint({ id: 'time', summary: '', doorX: 0, parts: MANY }, st, { x: i * 20, z: 0, rotY: 0, w: W, d: D }, { batch, mats, rng: makeRng(1, 'time') }, { seed: 3, quality: 2 });
      times.push(performance.now() - t0);
      drop(batch.build());
    }
    times.sort((x, y) => x - y);
    expect(times[4] as number).toBeLessThan(25);
  });
});

describe('roofs and structure with thickness', () => {
  it('lays a gable as a slab: an eave below the roof part, a verge beyond its ends, by the roofing', () => {
    const src = expandBlueprintParts(HOUSE);
    const shell = (roof: SurfaceKind) => dressBuilding(src, ctx({ wall: 'plaster', roof }, 2)).roofs[0];
    const thatch = shell('thatch');
    const slate = shell('slate');
    const tile = shell('tile');
    const sheet = shell('corrugated');
    expect(thatch?.part).toBe(1);
    expect(thatch?.edge).toBe('round');
    expect(tile?.edge).toBe('wave');
    expect(sheet?.edge).toBe('wave');
    expect(slate?.edge).toBe('plain');
    expect(thatch?.thick ?? 0).toBeGreaterThan((tile?.thick ?? 0) * 2);
    expect(tile?.thick ?? 0).toBeGreaterThan((slate?.thick ?? 0) * 2);
    expect(sheet?.thick ?? 1).toBeLessThanOrEqual(slate?.thick ?? 0);
    // no scalloped edge at the lowest quality
    expect(dressBuilding(src, ctx({ wall: 'plaster', roof: 'tile' }, 0)).roofs[0]?.edge).toBe('plain');

    const st = style({ wall: 'plaster', roof: 'thatch' });
    const bare = build([HOUSE[0] as BlueprintPart, HOUSE[1] as BlueprintPart], st, { quality: 2, dress: false });
    const full = build([HOUSE[0] as BlueprintPart, HOUSE[1] as BlueprintPart], st, { quality: 2 });
    const roofOf = (meshes: THREE.Mesh[]): THREE.Box3 => bounds(meshes.filter((m) => (m.material as THREE.Material).name === 'surface:thatch'));
    const a = roofOf(bare);
    const b = roofOf(full);
    // the slab hangs below the roof part's eave line and runs out past it on all four sides, and the ridge is capped
    expect(b.min.y).toBeLessThan(a.min.y - 0.1);
    expect(b.max.z).toBeGreaterThan(a.max.z + 0.05);
    expect(b.min.z).toBeLessThan(a.min.z - 0.05);
    expect(b.max.x).toBeGreaterThan(a.max.x + 0.03);
    expect(b.max.y).toBeGreaterThan(a.max.y + 0.02);
    expect(b.max.y).toBeLessThan(a.max.y + 0.4);
    drop(bare);
    drop(full);
  });

  it('carries posts with beams and braces, and stands a parapet on a flat roof', () => {
    const porch = expandBlueprintParts([
      part('box', { w: 0.8, d: 0.6, h: 3.2, z: -0.1 }),
      part('box', { w: 0.8, d: 0.6, y: 3.2, h: 0.3, z: -0.1, tone: 'roof' }),
      part('box', { z: 0.35, y: 2.6, w: 0.8, d: 0.3, h: 0.2, tone: 'wall2' }),
      part('box', { x: 0, z: 0.46, w: 0.03, d: 0.03, h: 2.6, tone: 'dark', repeat: 3, gap: 0.37 }),
    ]);
    const d = dressBuilding(porch, ctx({ wall: 'planks', roof: 'planks' }, 2));
    const added = d.parts.slice(porch.length);
    // a beam from post to post under the porch roof, and a brace or two at every post
    const beams = added.filter((p) => p.h === 0.16 && Math.abs(p.y - 2.44) < 1e-6 && p.w * W > 2.5 && p.z > 0.4);
    expect(beams.length).toBeGreaterThanOrEqual(2);
    const braces = d.struts.filter((s) => Math.abs(s.by - 2.58) < 1e-6 && s.ay < s.by && Math.abs(s.az - 0.46 * D) < 0.05);
    expect(braces.length).toBeGreaterThanOrEqual(4);
    for (const s of braces) expect(Math.abs(s.bx - s.ax)).toBeGreaterThan(0.3);
    // joists under the part of the porch roof that sails clear of the wall
    expect(added.filter((p) => p.h === 0.11 && Math.abs(p.y - 2.49) < 1e-6).length).toBeGreaterThanOrEqual(2);
    // the flat roof: four parapet walls with a coping each
    const walls = added.filter((p) => p.tone === 'wall' && Math.abs(p.y - 3.5) < 1e-6);
    expect(walls).toHaveLength(4);
    expect(added.filter((p) => p.tone === 'trim' && p.h === 0.06 && p.y > 3.8)).toHaveLength(4);
  });

  it('reads an age from words', () => {
    expect(eraFromWords('gothic chapel')).toBeLessThan(0.3);
    expect(eraFromWords('orbital station lab')).toBeGreaterThan(0.7);
    expect(eraFromWords('a house')).toBeUndefined();
    const src = expandBlueprintParts(FRONT);
    const bars = (era: number): number => dressBuilding(src, { ...ctx({ wall: 'brick' }, 2), era }).parts.length;
    expect(bars(0.1)).toBeGreaterThan(bars(0.95));
  });
});
