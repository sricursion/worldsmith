import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GeoBatch, MaterialCache } from '../../app/src/town/batch';
import { PLINTH, buildTown } from '../../app/src/town/build';
import { distanceToRoad, generateLayout } from '../../app/src/town/layout';
import type { TownLayout } from '../../app/src/town/layout';
import {
  MAX_POLES, POLE_MAX_WIDTH, POLE_MIN_HEIGHT, POLE_SPACING, isPole, lampRadius, pickPoleSpots, propProfile, scatterBlueprintProps,
} from '../../app/src/town/props';
import type { TownLight } from '../../app/src/town/props';
import { makeRng } from '../../app/src/world/rng';
import { normalizeSpec } from '../../app/src/world/schema';
import type { PropBlueprint, WorldSpec } from '../../app/src/world/spec';
import { STYLE, makeBlueprintSpec, part, stubKit } from './helpers';

vi.setConfig({ testTimeout: 60000 });

const LIVE_DIR = fileURLToPath(new URL('../worker/_live/out/', import.meta.url));
const liveSpecs = (): WorldSpec[] =>
  readdirSync(LIVE_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => normalizeSpec(JSON.parse(readFileSync(LIVE_DIR + f, 'utf8')) as WorldSpec));

const LAMP: PropBlueprint = {
  kind: 'street_lamp', size: 3, weight: 5,
  parts: [part('cylinder', { w: 0.06, d: 0.06, h: 2.4 }, 'dark'), part('sphere', { y: 2.2, w: 0.15, d: 0.15, h: 0.2 }, 'glow')],
};
const MAST: PropBlueprint = { kind: 'mast', size: 4, weight: 5, parts: [part('cylinder', { w: 0.05, d: 0.05, h: 3 }, 'dark')] };
const CRATE: PropBlueprint = { kind: 'crate', size: 1, weight: 1, parts: [part('box', { w: 0.9, d: 0.9, h: 0.9 })] };
const TREE: PropBlueprint = {
  kind: 'pine', size: 3, weight: 1,
  parts: [part('cylinder', { w: 0.1, d: 0.1, h: 0.8 }, 'wall2'), part('cone', { y: 0.6, w: 0.8, d: 0.8, h: 1.4 }, 'roof')],
};

function scatter(spec: WorldSpec, layout: TownLayout, kinds: readonly PropBlueprint[]): { counts: Map<string, number>; lights: TownLight[] } {
  const lights: TownLight[] = [];
  const counts = scatterBlueprintProps(layout.props, kinds, spec.style ?? STYLE, {
    batch: new GeoBatch(), visualBatch: new GeoBatch(), mats: new MaterialCache(), rng: makeRng(spec.seed, 'build'), layout, lights,
  });
  return { counts, lights };
}

describe('prop outlines', () => {
  it('measures height, mean width and the lamp height the way the mesh is built', () => {
    const lamp = propProfile(LAMP);
    expect(lamp.height).toBeCloseTo(7.2, 6);
    expect(lamp.width).toBeLessThan(0.3);
    expect(lamp.glowY).toBeCloseTo((2.2 + 0.1) * 3, 6);
    expect(isPole(lamp)).toBe(true);
    expect(propProfile(LAMP, 0.5).height).toBeCloseTo(3.6, 6);
    expect(propProfile(MAST).glowY).toBeNull();
    expect(isPole(propProfile(MAST))).toBe(true);
    // A tree is as tall as a lamp but is mostly crown; a crate is neither tall nor thin.
    const tree = propProfile(TREE);
    expect(tree.height).toBeGreaterThan(POLE_MIN_HEIGHT);
    expect(tree.width).toBeGreaterThan(POLE_MAX_WIDTH);
    expect(isPole(tree)).toBe(false);
    expect(isPole(propProfile(CRATE))).toBe(false);
    expect(isPole({ height: 3, width: 0.1 })).toBe(false);
    expect(isPole({ height: 8, width: 0.6 })).toBe(false);
  });

  it('gives a lamp a light that reaches the ground', () => {
    for (const y of [2, 5, 9, 13, 20]) {
      expect(lampRadius(y)).toBeGreaterThanOrEqual(7);
      expect(lampRadius(y)).toBeLessThanOrEqual(18);
    }
    // The pooled light is cut off at 1.7 radii.
    for (const y of [2, 5, 9, 13]) expect(lampRadius(y) * 1.7).toBeGreaterThan(y * 1.5);
  });
});

describe('pole spots', () => {
  const layout = generateLayout(makeBlueprintSpec({ count: 9 }));

  it('keeps at most 14, at least 9 m apart, nearest the roads and doors first', () => {
    const rng = makeRng(7, 'spots');
    const b = layout.bounds;
    const spots = Array.from({ length: 400 }, () => ({ x: rng.range(b.minX, b.maxX), z: rng.range(b.minZ, b.maxZ) }));
    const kept = pickPoleSpots(spots, layout);
    expect(kept.length).toBeLessThanOrEqual(MAX_POLES);
    expect(kept.length).toBeGreaterThan(6);
    expect(new Set(kept).size).toBe(kept.length);
    const near = (s: { x: number; z: number }): number => Math.min(
      ...layout.roads.map((r) => distanceToRoad(r, s.x, s.z)),
      ...layout.buildings.map((bd) => Math.hypot(s.x - bd.door.x, s.z - bd.door.z)),
    );
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        const p = spots[kept[i] as number] as { x: number; z: number };
        const q = spots[kept[j] as number] as { x: number; z: number };
        expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(POLE_SPACING);
      }
    }
    // The first kept is the spot nearest a road or door of all 400, and the kept ones sit closer than the field does.
    const all = spots.map(near);
    expect(near(spots[kept[0] as number] as { x: number; z: number })).toBe(Math.min(...all));
    const mean = (v: number[]): number => v.reduce((a, c) => a + c, 0) / v.length;
    expect(mean(kept.map((k) => all[k] as number))).toBeLessThan(mean(all) * 0.5);
  });

  it('is stable, and handles none, one and a custom cap', () => {
    const spots = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 20, z: 0 }, { x: 0, z: 30 }];
    expect(pickPoleSpots([], layout)).toEqual([]);
    expect(pickPoleSpots([{ x: 1, z: 1 }], layout)).toEqual([0]);
    expect(pickPoleSpots(spots, { roads: [], buildings: [] })).toEqual([0, 2, 3]);
    expect(pickPoleSpots(spots, { roads: [], buildings: [] }, 2)).toEqual([0, 2]);
    expect(pickPoleSpots(spots, { roads: [], buildings: [] }, 14, 2)).toEqual([0, 1, 2, 3]);
    expect(pickPoleSpots(spots, layout)).toEqual(pickPoleSpots(spots, layout));
  });
});

describe('pole cap in the scatter', () => {
  it('caps poles, fills the freed slots with other kinds and lights the lamps that stay', () => {
    const spec = { ...makeBlueprintSpec({ count: 9 }), site: { pattern: 'scatter' as const, wild: 0.9, paths: 'track' as const, spacing: 8 } };
    const layout = generateLayout(spec);
    expect(layout.props.length).toBeGreaterThan(150);
    const { counts, lights } = scatter(spec, layout, [LAMP, MAST, CRATE, TREE]);
    const poles = (counts.get('street_lamp') ?? 0) + (counts.get('mast') ?? 0);
    expect(poles).toBeLessThanOrEqual(MAX_POLES);
    expect(poles).toBeGreaterThan(8);
    // Ten of every twelve slots drew a pole; nearly all of them now hold a crate or a tree.
    expect((counts.get('crate') ?? 0) + (counts.get('pine') ?? 0) + poles).toBe(layout.props.length);
    expect(lights.length).toBe(counts.get('street_lamp') ?? 0);
    for (const l of lights) {
      expect(l.pos.y).toBeGreaterThan(POLE_MIN_HEIGHT);
      expect(l.radius).toBeGreaterThan(l.pos.y);
      expect(l.color).toBe(STYLE.glow);
      expect(layout.props.some((p) => p.x === l.pos.x && p.z === l.pos.z)).toBe(true);
    }
    for (let i = 0; i < lights.length; i++) {
      for (let j = i + 1; j < lights.length; j++) {
        const a = (lights[i] as TownLight).pos;
        const b = (lights[j] as TownLight).pos;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(POLE_SPACING);
      }
    }
  });

  it('leaves the freed slots empty when the town has nothing but poles', () => {
    const spec = makeBlueprintSpec({ count: 9 });
    const layout = generateLayout(spec);
    const { counts } = scatter(spec, layout, [LAMP, MAST]);
    const placed = [...counts.values()].reduce((a, c) => a + c, 0);
    expect(placed).toBeLessThanOrEqual(MAX_POLES);
    expect(placed).toBeGreaterThan(0);
    expect(placed).toBeLessThan(layout.props.length);
  });

  it('does not touch a town without poles', () => {
    const spec = makeBlueprintSpec({ count: 9 });
    const layout = generateLayout(spec);
    const { counts, lights } = scatter(spec, layout, [CRATE, TREE]);
    expect([...counts.values()].reduce((a, c) => a + c, 0)).toBe(layout.props.length);
    expect(lights).toHaveLength(0);
  });

  it('holds for the generated worlds', () => {
    // Towns have poles and wildernesses may have none: the cap holds for every world, and at least five have poles to cap.
    const specs = liveSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(5);
    let withPoles = 0;
    for (const spec of specs) {
      const layout = generateLayout(spec);
      const kinds = spec.props ?? [];
      const poleKinds = kinds.filter((k) => isPole(propProfile(k)));
      const { counts, lights } = scatter(spec, layout, kinds);
      const poles = poleKinds.reduce((n, k) => n + (counts.get(k.kind) ?? 0), 0);
      expect(poles, spec.title).toBeLessThanOrEqual(MAX_POLES);
      expect(lights.length, spec.title).toBeLessThanOrEqual(poles);
      if (poleKinds.length === 0 || layout.props.length === 0) continue;
      withPoles++;
      expect(poles, spec.title).toBeGreaterThan(0);
    }
    expect(withPoles).toBeGreaterThanOrEqual(5);
  }, 180_000);

  it('adds the lamp lights to the town next to the door lanterns', () => {
    const base = makeBlueprintSpec({ count: 9 });
    const spec = { ...base, props: [LAMP, CRATE] };
    const layout = generateLayout(spec);
    const town = buildTown(layout, spec, stubKit(spec.theme), new THREE.Scene(), { quality: 0 });
    const lamps = (town.lights ?? []).filter((l) => l.pos.y > POLE_MIN_HEIGHT);
    expect(lamps.length).toBeGreaterThan(0);
    expect(lamps.length).toBeLessThanOrEqual(MAX_POLES);
    expect((town.lights ?? []).length).toBeGreaterThanOrEqual(layout.buildings.length + lamps.length);
    town.dispose();
    expect(town.lights).toHaveLength(0);
  });
});

describe('landmark plinth', () => {
  it('is a knee-high block 1.6 m across with a thin dim inlay inside its top face', () => {
    const spec = makeBlueprintSpec({ count: 9 });
    const layout = generateLayout(spec);
    const town = buildTown(layout, spec, stubKit(spec.theme), new THREE.Scene(), { quality: 0 });
    const ids = (spec.landmarks ?? []).map((l) => l.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const plinth = town.group.getObjectByName(`plinth:${id}`) as THREE.Group;
      expect(plinth.children).toHaveLength(2);
      const size = new THREE.Box3().setFromObject(plinth, true).getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.z)).toBeLessThanOrEqual(1.6 + 1e-6);
      expect(Math.max(size.x, size.z)).toBeGreaterThan(1.4);
      expect(size.y).toBeGreaterThanOrEqual(0.4);
      expect(size.y).toBeLessThanOrEqual(0.56);

      const base = plinth.getObjectByName('plinth-base') as THREE.Mesh;
      const inlay = plinth.getObjectByName('plinth-inlay') as THREE.Mesh;
      const baseMat = base.material as THREE.MeshStandardMaterial;
      const glow = inlay.material as THREE.MeshStandardMaterial;
      expect(baseMat.emissiveIntensity * Math.max(baseMat.emissive.r, baseMat.emissive.g, baseMat.emissive.b)).toBe(0);
      expect(baseMat.roughness).toBeGreaterThan(0.8);
      // Dim: the lit line stays under the lowest bloom threshold (0.8), so it never flares.
      expect(glow.emissiveIntensity).toBe(PLINTH.glow);
      expect(glow.emissiveIntensity * Math.max(glow.emissive.r, glow.emissive.g, glow.emissive.b)).toBeLessThan(0.5);

      // The inlay is a flat ring a few centimetres wide, lying on the top face and well inside its edge.
      inlay.geometry.computeBoundingBox();
      const ib = inlay.geometry.boundingBox as THREE.Box3;
      const pos = inlay.geometry.getAttribute('position');
      let inner = Infinity;
      let outer = 0;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        inner = Math.min(inner, r);
        outer = Math.max(outer, r);
      }
      expect(ib.max.y - ib.min.y).toBeLessThan(1e-6);
      expect(outer - inner).toBeLessThan(0.05);
      expect(outer).toBeLessThan((PLINTH.width / 2) * 0.88 - 0.1);
      expect(inlay.position.y).toBeGreaterThan(PLINTH.height);
      expect(inlay.position.y).toBeLessThan(PLINTH.height + 0.01);
    }
    town.dispose();
  });
});
