import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTown, WALK_MARGIN } from '../../app/src/town/build';
import { buildingAabb, generateLayout, waterInside } from '../../app/src/town/layout';
import type { TownLayout } from '../../app/src/town/layout';
import { makeLand, WADE_DEPTH } from '../../app/src/town/terrain';
import { buildWater, waterLook, waterMaterial } from '../../app/src/town/water';
import type { ReliefKind, SitePattern, TerrainSpec, WaterKind, WorldSpec } from '../../app/src/world/spec';
import { normalizeSpec } from '../../app/src/world/schema';
import { backdropBudget, backdropKinds } from '../../app/src/town/props';
import { makeBlueprintSpec, stubKit } from './helpers';

const RELIEFS: ReliefKind[] = ['flat', 'rolling', 'dunes', 'craggy', 'terraced', 'crater', 'canyon', 'icefield', 'swamp', 'islands'];
const SITES: SitePattern[] = ['street', 'ring', 'scatter', 'grid', 'terraces', 'wild', 'path', 'shoreline', 'cliffside'];
const WATERS: WaterKind[] = ['none', 'pond', 'river', 'shore', 'lake', 'lava', 'acid', 'ice_sheet', 'mist_sea'];

function landSpec(o: { seed?: number; count?: number; pattern?: SitePattern; wild?: number; terrain?: Partial<TerrainSpec> }): WorldSpec {
  const base = makeBlueprintSpec({ seed: o.seed ?? 5, count: Math.max(1, o.count ?? 6), landmarks: false });
  return {
    ...base,
    buildings: o.count === 0 ? [] : base.buildings,
    site: { pattern: o.pattern ?? 'wild', wild: o.wild ?? 0.6, paths: 'track', spacing: 6 },
    terrain: { relief: 'rolling', ruggedness: 0.7, water: 'none', waterAmount: 0.4, horizon: 'mountain range', settled: 0.3, ...o.terrain },
  };
}

const down = new THREE.Vector3(0, -1, 0);
function hitY(mesh: THREE.Mesh, x: number, z: number): number | null {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 500, z), down);
  const savedSide = (mesh.material as THREE.Material).side;
  (mesh.material as THREE.Material).side = THREE.DoubleSide;
  mesh.visible = true;
  const hits = ray.intersectObject(mesh, false);
  mesh.visible = false;
  (mesh.material as THREE.Material).side = savedSide;
  return hits[0] ? hits[0].point.y : null;
}

/** Points along every road and trail of a layout, about a metre apart. */
function routePoints(layout: TownLayout): { x: number; z: number }[][] {
  const lines: { x: number; z: number }[][] = [];
  const walk = (pts: readonly { x: number; z: number }[]): void => {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as { x: number; z: number };
      const b = pts[i + 1] as { x: number; z: number };
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    const last = pts[pts.length - 1];
    if (last) out.push(last);
    lines.push(out);
  };
  for (const r of layout.roads) walk([{ x: r.ax, z: r.az }, { x: r.bx, z: r.bz }]);
  for (const t of layout.trails ?? []) walk(t.pts);
  return lines;
}

describe('a town without terrain stays flat', () => {
  it('has zero height, a level walk mesh over the bounds and the old ground collider', () => {
    const spec = makeBlueprintSpec({ count: 6 });
    const layout = generateLayout(spec);
    const town = buildTown(layout, spec, stubKit(), new THREE.Scene(), { quality: 0 });
    expect(town.shaped).toBe(false);
    expect(town.heightAt(layout.spawn.x, layout.spawn.z)).toBe(0);
    expect(town.waterBodies).toEqual([]);
    expect(town.statics[0]?.name).toBe('ground');
    town.statics[0]?.geometry.computeBoundingBox();
    expect(town.statics[0]?.geometry.boundingBox?.max.x).toBeCloseTo(200, 3);
    town.walkMesh.geometry.computeBoundingBox();
    const box = town.walkMesh.geometry.boundingBox as THREE.Box3;
    expect(box.min.x).toBeCloseTo(layout.bounds.minX - WALK_MARGIN, 3);
    expect(box.max.z).toBeCloseTo(layout.bounds.maxZ + WALK_MARGIN, 3);
    expect(box.max.y - box.min.y).toBeLessThan(1e-6);
    for (const d of town.doors.values()) expect(d.y).toBe(0);
    town.dispose();
  });
});

describe('a world with no buildings', () => {
  for (const pattern of ['wild', 'path', 'shoreline', 'cliffside'] as SitePattern[]) {
    it(`${pattern}: lays out, and the walk mesh carries the spawn and every trail point`, () => {
      const spec = landSpec({ count: 0, pattern, terrain: { relief: 'rolling', water: pattern === 'shoreline' ? 'shore' : 'pond' } });
      const layout = generateLayout(spec);
      expect(layout.buildings).toHaveLength(0);
      expect(layout.plaza.r).toBe(0);
      expect((layout.trails ?? []).length + layout.walkable.length).toBeGreaterThan(0);
      const town = buildTown(layout, spec, stubKit(), new THREE.Scene(), { quality: 0 });
      expect(town.shaped).toBe(true);
      expect(town.walkMesh).toBe(town.statics[0]);
      expect(Math.abs(town.heightAt(layout.spawn.x, layout.spawn.z))).toBeLessThan(0.05);
      const pts = [{ x: layout.spawn.x, z: layout.spawn.z }, ...layout.walkable, ...(layout.trails ?? []).flatMap((t) => t.pts)];
      for (const p of pts) {
        const y = hitY(town.walkMesh, p.x, p.z);
        expect(y, `${pattern} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).not.toBeNull();
        expect(Math.abs((y as number) - town.heightAt(p.x, p.z))).toBeLessThan(1);
      }
      town.dispose();
    });
  }
});

describe('the land under what is built', () => {
  const LIMIT = Math.tan((30 * Math.PI) / 180);
  for (const relief of RELIEFS) {
    it(`${relief}: routes stay under 30 degrees and pads are level, over 20 seeds`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const pattern = SITES[seed % SITES.length] as SitePattern;
        const water = WATERS[(seed * 7) % WATERS.length] as WaterKind;
        const spec = landSpec({ seed: seed * 131, count: seed % 5 === 0 ? 0 : 3 + (seed % 4), pattern, terrain: { relief, ruggedness: 0.4 + 0.03 * seed, water, settled: (seed % 10) / 10 } });
        const layout = generateLayout(spec);
        const land = makeLand(layout, spec.terrain, 'grass', spec.seed);
        const tag = `${relief} seed ${seed} ${pattern} ${water}`;
        for (const line of routePoints(layout)) {
          for (let i = 0; i + 1 < line.length; i++) {
            const a = line[i] as { x: number; z: number };
            const b = line[i + 1] as { x: number; z: number };
            const run = Math.hypot(b.x - a.x, b.z - a.z);
            if (run < 0.5) continue;
            expect(Math.abs(land.heightAt(b.x, b.z) - land.heightAt(a.x, a.z)) / run, tag).toBeLessThan(LIMIT);
          }
        }
        for (const bd of layout.buildings) {
          const r = buildingAabb(bd);
          const h = land.heightAt(bd.x, bd.z);
          for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]] as [number, number][]) {
            expect(Math.abs(land.heightAt(x, z) - h), `${tag} ${bd.id} corner`).toBeLessThan(0.1);
          }
          // The door stands on the pad's apron: a step at most from the floor.
          expect(Math.abs(land.heightAt(bd.door.x, bd.door.z) - h), `${tag} ${bd.id} door`).toBeLessThan(0.25);
          expect(land.waterDepthAt(bd.x, bd.z), `${tag} ${bd.id}`).toBe(0);
        }
        expect(land.waterDepthAt(layout.spawn.x, layout.spawn.z), tag).toBeLessThan(0.3);
      }
    }, 240000);
  }
});

describe('water', () => {
  for (const kind of ['pond', 'lake', 'river', 'shore', 'lava', 'ice_sheet'] as WaterKind[]) {
    it(`${kind}: is carved into the land, drawn, and left out of the walk mesh`, () => {
      const spec = landSpec({ seed: 77, count: 4, pattern: 'wild', terrain: { relief: 'rolling', water: kind, waterAmount: 0.6 } });
      const layout = generateLayout(spec);
      expect(layout.water?.length ?? 0).toBeGreaterThan(0);
      const town = buildTown(layout, spec, stubKit(), new THREE.Scene(), { quality: 0 });
      expect(town.waterBodies.length).toBe(layout.water?.length);
      expect(town.waterBodies[0]?.kind).toBe(kind);
      const waterGroup = town.group.getObjectByName('water');
      expect(waterGroup).toBeTruthy();
      let tris = 0;
      waterGroup?.traverse((o) => { if (o instanceof THREE.Mesh) tris += (o.geometry.getIndex()?.count ?? 0) / 3; });
      expect(tris).toBeGreaterThan(0);
      // Deep water inside the walkable margin: none of it is on the walk mesh.
      const b = layout.bounds;
      let deep = 0;
      for (let x = b.minX - 10; x <= b.maxX + 10; x += 1.7) {
        for (let z = b.minZ - 10; z <= b.maxZ + 10; z += 1.7) {
          if (town.waterDepthAt(x, z) < WADE_DEPTH + 0.05) continue;
          if (!(layout.water ?? []).some((w) => waterInside(w, x, z) > 1.5)) continue;
          if (deep++ % 7 !== 0 || deep > 400) continue;
          expect(hitY(town.walkMesh, x, z), `${kind} (${x}, ${z})`).toBeNull();
        }
      }
      expect(deep, kind).toBeGreaterThan(0);
      // Dry land by the spawn is on it.
      expect(hitY(town.walkMesh, layout.spawn.x, layout.spawn.z)).not.toBeNull();
      town.dispose();
    }, 30000);
  }

  it('a swamp holds a sheet of water in its hollows and keeps what is built dry', () => {
    const spec = landSpec({ seed: 9, count: 3, pattern: 'wild', terrain: { relief: 'swamp', water: 'none' } });
    const layout = generateLayout(spec);
    const land = makeLand(layout, spec.terrain, 'mud', spec.seed);
    expect(land.water.length).toBe(1);
    const set = buildWater({ land, quality: 0, reach: 200 });
    expect(set.triangles).toBeGreaterThan(0);
    for (const bd of layout.buildings) expect(land.waterDepthAt(bd.x, bd.z)).toBe(0);
    set.dispose();
  });

  it('every kind has a look and a material that asks for the depth attribute', () => {
    for (const kind of WATERS) {
      if (kind === 'none') continue;
      const m = waterMaterial(waterLook(kind));
      expect(m.userData.water).toBeTruthy();
      const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>' };
      m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
      expect(shader.vertexShader).toContain('attribute float waterDepth');
      expect(shader.fragmentShader).toContain('uWaterTime');
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance');
      m.dispose();
    }
  });
});

describe('what the town places stands on the land', () => {
  it('doors, lights and smoke points are at the height of the ground under them, and buildings rise from their pads', () => {
    const spec = landSpec({ seed: 31, count: 7, pattern: 'street', terrain: { relief: 'rolling', ruggedness: 1, settled: 0.6 } });
    const layout = generateLayout(spec);
    const town = buildTown(layout, spec, stubKit(), new THREE.Scene(), { quality: 0 });
    let spread = 0;
    for (const bd of layout.buildings) {
      const d = town.doors.get(bd.id) as THREE.Vector3;
      expect(Math.abs(d.y - town.heightAt(d.x, d.z))).toBeLessThan(0.05);
      spread = Math.max(spread, Math.abs(town.heightAt(bd.x, bd.z)));
      const sign = town.signs.get(bd.id) as THREE.Object3D;
      expect(sign.position.y - town.heightAt(bd.x, bd.z)).toBeGreaterThan(2);
      expect(sign.position.y - town.heightAt(bd.x, bd.z)).toBeLessThan(4.5);
    }
    expect(spread).toBeGreaterThan(0.3);
    for (const l of town.lights ?? []) {
      const up = l.pos.y - town.heightAt(l.pos.x, l.pos.z);
      expect(up).toBeGreaterThan(0.5);
      expect(up).toBeLessThan(12);
    }
    // No solid geometry hangs far below the land or floats: the lowest point of the merged statics over each footprint is near its pad.
    const solid = town.statics.filter((m) => m.name !== 'ground');
    for (const bd of layout.buildings) {
      const r = buildingAabb(bd);
      let lo = Infinity;
      for (const m of solid) {
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          if (x > r.minX - 0.3 && x < r.maxX + 0.3 && z > r.minZ - 0.3 && z < r.maxZ + 0.3) lo = Math.min(lo, pos.getY(i));
        }
      }
      expect(Math.abs(lo - town.heightAt(bd.x, bd.z)), bd.id).toBeLessThan(0.75);
    }
    town.dispose();
  });
});

describe('the middle distance', () => {
  it('thickens with wildness, thins with settlement, and holds structures only where people have built', () => {
    expect(backdropBudget(2, 0.95, 0.02).plants).toBeGreaterThan(backdropBudget(2, 0.3, 0.02).plants);
    expect(backdropBudget(2, 0.95, 0.9).plants).toBeLessThan(backdropBudget(2, 0.95, 0.02).plants);
    expect(backdropBudget(2, 0.5, 0.1).structures).toBe(0);
    expect(backdropBudget(2, 0.1, 1).structures).toBeGreaterThan(30);
    expect(backdropBudget(0, 1, 0).plants).toBeLessThan(backdropBudget(2, 1, 0).plants);
  });

  it('takes tall, broad, unlit props and leaves lamps, poles and ground cover', () => {
    const spec = makeBlueprintSpec({ count: 4 });
    const lantern = (spec.props ?? [])[0];
    const tree = { kind: 'tree', size: 6, weight: 3, parts: [
      { shape: 'cylinder' as const, x: 0, z: 0, y: 0, w: 0.12, d: 0.12, h: 1.2, rot: 0, tone: 'wall2' as const, repeat: 1, gap: 0 },
      { shape: 'sphere' as const, x: 0, z: 0, y: 1, w: 0.9, d: 0.9, h: 1.1, rot: 0, tone: 'roof' as const, repeat: 1, gap: 0 },
    ] };
    const kinds = backdropKinds([...(lantern ? [lantern] : []), tree]);
    expect(kinds.map((k) => k.kind)).toEqual(['tree']);
  });
});

describe('the generated worlds build on their land', () => {
  const dir = fileURLToPath(new URL('../worker/_live/out/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    it(f.replace('.json', ''), () => {
      const spec = normalizeSpec(JSON.parse(readFileSync(dir + f, 'utf8')) as WorldSpec);
      const layout = generateLayout(spec);
      const t0 = performance.now();
      const town = buildTown(layout, spec, stubKit(spec.theme), new THREE.Scene(), { quality: 1 });
      const ms = performance.now() - t0;
      expect(town.shaped).toBe(!!spec.terrain);
      expect(town.walkMesh.geometry.getAttribute('position').count).toBeGreaterThan(3);
      expect(Math.abs(town.heightAt(layout.spawn.x, layout.spawn.z))).toBeLessThan(0.05);
      const y = hitY(town.walkMesh, layout.spawn.x, layout.spawn.z);
      expect(y).not.toBeNull();
      expect(Math.abs(y as number)).toBeLessThan(0.1);
      for (const d of town.doors.values()) {
        expect(Number.isFinite(d.y)).toBe(true);
        expect(Math.abs(d.y - town.heightAt(d.x, d.z))).toBeLessThan(0.05);
        expect(town.waterDepthAt(d.x, d.z)).toBeLessThan(0.3);
      }
      const backdrop = town.group.getObjectByName('backdrop');
      expect(!!backdrop).toBe(!!spec.terrain && !!spec.style);
      let instances = 0;
      backdrop?.traverse((o) => { if (o instanceof THREE.InstancedMesh) instances += o.count; });
      let lo = Infinity;
      let hi = -Infinity;
      const pos = town.walkMesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { lo = Math.min(lo, pos.getY(i)); hi = Math.max(hi, pos.getY(i)); }
      console.log(`${f.slice(0, 30).padEnd(30)} ${ms.toFixed(0).padStart(5)} ms  relief ${(spec.terrain?.relief ?? '-').padEnd(9)} walk y ${lo.toFixed(1)}..${hi.toFixed(1)}  water ${town.waterBodies.map((w) => w.kind).join(',') || '-'}  backdrop instances ${instances}  buildings ${layout.buildings.length}`);
      expect(ms).toBeLessThan(20000);
      town.dispose();
    }, 60000);
  }
});
