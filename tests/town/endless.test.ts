import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildTown } from '../../app/src/town/build';
import type { TownObjects } from '../../app/src/town/build';
import { generateLayout } from '../../app/src/town/layout';
import type { TownLayout } from '../../app/src/town/layout';
import { InstanceWindow, buildScatterField, windowMesh } from '../../app/src/town/scatter';
import { levelOff, makeTerrainField, terrainHeight } from '../../app/src/town/terrain';
import type { ReliefKind, SitePattern, WaterKind, WorldSpec } from '../../app/src/world/spec';
import { makeBlueprintSpec, makeSpec, stubKit } from './helpers';

vi.setConfig({ testTimeout: 120000 });

function shaped(relief: ReliefKind, pattern: SitePattern, water: WaterKind, seed = 77): WorldSpec {
  const base = makeBlueprintSpec({ seed, count: 4, landmarks: false });
  return {
    ...base,
    site: { pattern, wild: 0.7, paths: 'track', spacing: 6 },
    terrain: { relief, ruggedness: 0.6, water, waterAmount: 0.4, horizon: 'mountain range', settled: 0.3 },
  };
}

function build(spec: WorldSpec, quality: 0 | 1 | 2 = 1, budget = 1e6): { town: TownObjects; layout: TownLayout } {
  const layout = generateLayout(spec);
  const town = buildTown(layout, spec, stubKit(spec.theme), new THREE.Scene(), { quality, streamBudgetMs: budget });
  return { town, layout };
}

const stats = (town: TownObjects): NonNullable<ReturnType<NonNullable<TownObjects['endlessStats']>>> => {
  const s = town.endlessStats?.();
  if (!s) throw new Error('no endless land');
  return s;
};

/** Calls update at a point until nothing is left to make. */
function settle(town: TownObjects, x: number, z: number): void {
  const f = new THREE.Vector3(x, 0, z);
  for (let i = 0; i < 400; i++) {
    town.update?.(f, 1 / 60);
    if (stats(town).queued === 0 && stats(town).active) return;
  }
  throw new Error('the land did not settle');
}

function shownTiles(town: TownObjects): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  town.group.traverse((o) => { if (o instanceof THREE.Mesh && o.name === 'terrain-far' && o.visible) out.push(o); });
  return out;
}

const WORLDS: [string, WorldSpec][] = [
  ['dunes', shaped('dunes', 'path', 'none')],
  ['jungle hills', shaped('rolling', 'wild', 'river')],
  ['icefield', shaped('icefield', 'wild', 'ice_sheet')],
  ['crater with lava', shaped('crater', 'ring', 'lava')],
  ['shoreline', shaped('islands', 'shoreline', 'shore')],
  ['swamp', shaped('swamp', 'wild', 'none')],
  ['flat town', makeSpec({ seed: 31, count: 6 })],
];

describe('the far rise of the land', () => {
  it('eases level instead of climbing for ever', () => {
    expect(levelOff(100)).toBe(100);
    expect(levelOff(260)).toBe(260);
    expect(levelOff(1e6)).toBeLessThan(461);
    // Slope continuous where the ease begins.
    expect(levelOff(261) - levelOff(260)).toBeCloseTo(1, 2);
    const field = makeTerrainField({ minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, 'grass', 9);
    let hi = 0;
    for (let d = 500; d < 20000; d += 137) hi = Math.max(hi, terrainHeight(field, d, d * 0.3));
    expect(hi).toBeLessThan(80);
  });
});

describe('the endless land', () => {
  for (const [name, spec, quality] of [...WORLDS.map(([n, s]) => [n, s, 1] as const), ['dunes, lowest tier', WORLDS[0]?.[1] as WorldSpec, 0] as const, ['icefield, highest tier', WORLDS[2]?.[1] as WorldSpec, 2] as const]) {
    it(`${name}: one surface from the place out to the far ground, with no step at the seam or between tiles`, () => {
      const { town, layout } = build(spec, quality);
      const before = (town.group.getObjectByName('terrain') as THREE.Mesh).geometry;
      // Never updated: nothing is made and the ground is the ground it always was.
      expect(stats(town).created).toBe(0);
      expect(stats(town).active).toBe(false);
      settle(town, layout.spawn.x, layout.spawn.z);
      const st = stats(town);
      const core = st.core;
      expect((town.group.getObjectByName('terrain') as THREE.Mesh).geometry).not.toBe(before);

      // The seam: just inside the core and just outside it are the same ground.
      let worst = 0;
      for (let k = 0; k <= 400; k++) {
        const t = k / 400;
        const x = core.minX + (core.maxX - core.minX) * t;
        const z = core.minZ + (core.maxZ - core.minZ) * t;
        for (const [ix, iz, ox, oz] of [[core.minX + 1e-4, z, core.minX - 1e-4, z], [core.maxX - 1e-4, z, core.maxX + 1e-4, z], [x, core.minZ + 1e-4, x, core.minZ - 1e-4], [x, core.maxZ - 1e-4, x, core.maxZ + 1e-4]] as const) {
          worst = Math.max(worst, Math.abs(town.heightAt(ix, iz) - town.heightAt(ox, oz)));
        }
      }
      expect(worst, 'step across the seam, metres').toBeLessThan(0.02);

      // The walk mesh lies on the same land the far ground continues.
      const wp = town.walkMesh.geometry.getAttribute('position');
      let walkWorst = 0;
      for (let i = 0; i < wp.count; i += 7) walkWorst = Math.max(walkWorst, Math.abs(wp.getY(i) - town.heightAt(wp.getX(i), wp.getZ(i))));
      expect(walkWorst).toBeLessThan(0.02);

      // Every tile vertex is on that surface, so tiles agree wherever they meet; on the seam they meet the core.
      const tiles = shownTiles(town);
      expect(tiles.length).toBeGreaterThan(40);
      const main = (st.cells + 1) * (st.cells + 1);
      let off = 0;
      let seam = 0;
      let seamCount = 0;
      const e = 1e-3;
      for (const m of tiles) {
        const p = m.geometry.getAttribute('position');
        expect(p.count).toBe(main + 4 * (st.cells + 1));
        for (let i = 0; i < main; i++) {
          const x = p.getX(i);
          const y = p.getY(i);
          const z = p.getZ(i);
          expect(Number.isFinite(x + y + z)).toBe(true);
          const inside = x > core.minX + e && x < core.maxX - e && z > core.minZ + e && z < core.maxZ - e;
          if (inside) {
            // Under the place's own ground, never through it.
            expect(y).toBeLessThan(town.heightAt(x, z) - 1);
            continue;
          }
          const d = Math.abs(y - town.heightAt(x, z));
          off = Math.max(off, d);
          const onSeam = x >= core.minX - e && x <= core.maxX + e && z >= core.minZ - e && z <= core.maxZ + e;
          if (onSeam) { seam = Math.max(seam, d); seamCount++; }
        }
      }
      expect(off, 'tile vertex off the surface, metres').toBeLessThan(0.02);
      expect(seamCount).toBeGreaterThan(20);
      expect(seam).toBeLessThan(0.02);

      // Across tile borders near the walker the height is continuous.
      let jump = 0;
      for (let k = -6; k <= 6; k++) {
        for (let q = 0; q < 40; q++) {
          const line = core.maxX + k * 16;
          const z = core.maxZ + 5 + q * 3.3;
          jump = Math.max(jump, Math.abs(town.heightAt(line - 1e-4, z) - town.heightAt(line + 1e-4, z)));
        }
      }
      expect(jump).toBeLessThan(0.01);
      town.dispose();
    });
  }

  it('follows a walker two kilometres out in a straight line with a fixed pool and no bad numbers', () => {
    const { town, layout } = build(shaped('rolling', 'wild', 'river'), 1, 3);
    settle(town, layout.spawn.x, layout.spawn.z);
    const first = stats(town);
    const f = new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z);
    let maxHeld = 0;
    let maxShown = 0;
    let objects = 0;
    // Everything in the scene that is not a pooled ground tile (or the water drawn on one).
    const count = (): number => { let n = 0; town.group.traverse((o) => { if (o.name !== 'terrain-far' && !o.name.startsWith('water-far:')) n++; }); return n; };
    objects = count();
    for (let step = 0; step < 2000; step++) {
      f.x += 0.8;
      f.z += 0.6;
      f.y = town.heightAt(f.x, f.z);
      expect(Number.isFinite(f.y)).toBe(true);
      town.update?.(f, 1 / 30);
      const s = stats(town);
      maxHeld = Math.max(maxHeld, s.held);
      maxShown = Math.max(maxShown, s.shown);
      expect(s.created).toBeLessThanOrEqual(s.poolCap);
      expect(s.propCapacity).toBe(first.propCapacity);
      expect(s.scatterCapacity).toBe(first.scatterCapacity);
    }
    expect(Math.hypot(f.x - layout.spawn.x, f.z - layout.spawn.z)).toBeCloseTo(2000, 0);
    settle(town, f.x, f.z);
    const end = stats(town);
    expect(maxHeld).toBeLessThanOrEqual(end.poolCap);
    expect(maxShown).toBeLessThan(end.poolCap / 2 + 1);
    // Nothing but pooled tiles is ever added to the scene, however far the walk goes, and the pool has a ceiling.
    expect(count()).toBe(objects);
    expect(end.created).toBeLessThanOrEqual(end.poolCap);
    expect(end.propChunks).toBeGreaterThan(100);
    // The ground is under the walker out here, at the finest size, and on the surface.
    const under = shownTiles(town).filter((m) => {
      const b = m.geometry.boundingSphere as THREE.Sphere;
      return Math.abs(b.center.x - f.x) < 20 && Math.abs(b.center.z - f.z) < 20 && b.radius < 40;
    });
    expect(under.length).toBeGreaterThan(0);
    for (const m of shownTiles(town)) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 13) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
    }
    // The horizon came along: its ring is centred on the walker.
    const horizon = town.group.getObjectByName('horizon') as THREE.Mesh;
    const lb = layout.bounds;
    const centre = new THREE.Vector3((lb.minX + lb.maxX) / 2, 0, (lb.minZ + lb.maxZ) / 2).applyMatrix4(horizon.matrix);
    expect(Math.hypot(centre.x - f.x, centre.z - f.z)).toBeLessThan(1e-6 + 1e-3);
    town.dispose();
  });

  it('puts places worth walking to on the far land, the same ones every time, and they are solid', () => {
    const spec = shaped('rolling', 'wild', 'none', 12);
    const a = build(spec);
    const b = build(spec);
    const at = { x: a.layout.spawn.x + 900, z: a.layout.spawn.z - 700 };
    settle(a.town, at.x, at.z);
    settle(b.town, at.x, at.z);
    expect(stats(a.town).places).toBeGreaterThan(3);
    expect(stats(a.town).places).toBe(stats(b.town).places);
    const collect = (town: TownObjects): number[] => {
      const out: number[] = [];
      town.group.traverse((o) => {
        if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith('place:') || o.count === 0) return;
        const m = new THREE.Matrix4();
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); out.push(m.elements[12] as number, m.elements[13] as number, m.elements[14] as number); }
      });
      return out;
    };
    const pa = collect(a.town);
    expect(pa.length).toBeGreaterThan(9);
    expect(pa).toEqual(collect(b.town));
    for (const v of pa) expect(Number.isFinite(v)).toBe(true);
    // Standing in the middle of a stone is not possible.
    let stone: THREE.InstancedMesh | null = null;
    a.town.group.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.name === 'place:stone' && o.count > 0) stone = o; });
    expect(stone).not.toBeNull();
    const m = new THREE.Matrix4();
    (stone as unknown as THREE.InstancedMesh).getMatrixAt(0, m);
    const p = { x: (m.elements[12] as number) + 0.01, z: m.elements[14] as number };
    const p0 = { ...p };
    a.town.roam?.pushOut?.(p);
    expect(Math.hypot(p.x - p0.x, p.z - p0.z)).toBeGreaterThan(0.3);
    a.town.dispose();
    b.town.dispose();
  });

  it('honours the quality tier and frees everything it made', () => {
    const spec = shaped('dunes', 'path', 'none');
    const lo = build(spec, 0);
    const hi = build(spec, 2);
    settle(lo.town, lo.layout.spawn.x + 300, lo.layout.spawn.z);
    settle(hi.town, hi.layout.spawn.x + 300, hi.layout.spawn.z);
    expect(stats(lo.town).cells).toBeLessThan(stats(hi.town).cells);
    expect(stats(lo.town).shown).toBeLessThan(stats(hi.town).shown);
    expect(stats(lo.town).scatterCapacity).toBeLessThan(stats(hi.town).scatterCapacity);
    expect(stats(lo.town).propCapacity).toBeLessThanOrEqual(stats(hi.town).propCapacity);
    for (const { town } of [lo, hi]) {
      const geos = new Set<THREE.BufferGeometry>();
      town.group.traverse((o) => { if (o instanceof THREE.Mesh) geos.add(o.geometry); });
      let freed = 0;
      for (const g of geos) g.addEventListener('dispose', () => { freed++; });
      town.dispose();
      expect(freed).toBe(geos.size);
      expect(town.group.children.length).toBe(0);
      // Updating a town that is gone does nothing.
      town.update?.(new THREE.Vector3(5, 0, 5), 0.016);
    }
  });

  it('a flat town with no terrain, no style and no props still has land without end', () => {
    const spec = makeSpec({ seed: 8, count: 5, theme: 'modern' });
    const { town, layout } = build(spec, 2);
    expect(town.shaped).toBe(false);
    expect(town.roam).toBeDefined();
    for (const [x, z] of [[0, 0], [400, -250], [3000, 3000], [-12000, 800]] as const) {
      settle(town, layout.spawn.x + x, layout.spawn.z + z);
      expect(Number.isFinite(town.heightAt(layout.spawn.x + x, layout.spawn.z + z))).toBe(true);
      expect(stats(town).shown).toBeGreaterThan(40);
    }
    // Level over the town as ever.
    expect(town.heightAt(layout.spawn.x, layout.spawn.z)).toBe(0);
    town.dispose();
  });
});

describe('streaming windows', () => {
  it('keeps one fixed pool through more than 500 chunk recycles', () => {
    const spec = makeSpec({ seed: 3, count: 4 });
    const layout = generateLayout(spec);
    const field = buildScatterField({
      layout, ground: 'grass', groundHex: '#6f8a4a', accents: ['#c0392b'], wild: 0.8, wet: 0.2, quality: 1, seed: 3, tracks: false,
      heightAt: (x, z) => 0.01 * x + 0.02 * z, placed: { tufts: 6000, flowers: 800, stones: 1500, debris: 1200 },
    });
    const w = field.window;
    const capacity = w.capacity;
    expect(capacity).toBeGreaterThan(1000);
    const lengths = w.layers.map((l) => l.mesh.instanceMatrix.array.length);
    const counts = w.layers.map((l) => l.mesh.count);
    for (let step = 0; w.recycles < 600; step++) {
      w.retarget(200 + step * 7, 100 + step * 3);
      while (w.pending()) w.work();
      expect(step).toBeLessThan(5000);
    }
    expect(w.recycles).toBeGreaterThan(500);
    expect(w.capacity).toBe(capacity);
    expect(w.layers.map((l) => l.mesh.instanceMatrix.array.length)).toEqual(lengths);
    expect(w.layers.map((l) => l.mesh.count)).toEqual(counts);
    let live = 0;
    for (const l of w.layers) {
      const a = l.mesh.instanceMatrix.array;
      expect(l.mesh.instanceMatrix.updateRanges.length).toBeLessThan(40);
      for (let i = 0; i < a.length; i += 16) {
        expect(Number.isFinite((a[i] as number) + (a[i + 12] as number) + (a[i + 13] as number) + (a[i + 14] as number))).toBe(true);
        if ((a[i] as number) !== 0 || (a[i + 5] as number) !== 0) live++;
      }
    }
    expect(live).toBeGreaterThan(200);
    field.dispose();
  });

  it('gives a chunk the same contents whenever it is made, and hands its run to the chunk that replaces it', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = windowMesh(geo, mat, 4 * 4 * 3, 'test', false);
    const seen: string[] = [];
    const w = new InstanceWindow(10, 4, [{ mesh, cap: 3 }], (cx, cz, win) => {
      seen.push(`${cx},${cz}`);
      expect(win.put(0, cx * 10 + 5, 0, cz * 10 + 5, 0, 0, 0, 1, 1, 1)).toBe(true);
      expect(win.put(0, cx * 10 + 6, 0, cz * 10 + 5, 0, 0, 0, 1, 1, 1)).toBe(true);
      expect(win.put(0, cx * 10 + 7, 0, cz * 10 + 5, 0, 0, 0, 1, 1, 1)).toBe(true);
      expect(win.put(0, cx * 10 + 8, 0, cz * 10 + 5, 0, 0, 0, 1, 1, 1)).toBe(false);
    });
    w.retarget(5, 5);
    while (w.pending()) w.work();
    expect(seen.length).toBe(16);
    expect(w.slotAt(5, 5)).toBeGreaterThanOrEqual(0);
    expect(w.slotAt(500, 5)).toBe(-1);
    const xs = (): number[] => Array.from({ length: 48 }, (_, i) => mesh.instanceMatrix.array[i * 16 + 12] as number).sort((p, q) => p - q);
    const before = xs();
    w.retarget(15, 5); // one chunk along: one column of four comes in
    while (w.pending()) w.work();
    expect(seen.length).toBe(20);
    w.retarget(5, 5);
    while (w.pending()) w.work();
    expect(seen.length).toBe(24);
    expect(xs()).toEqual(before);
    expect(mesh.count).toBe(48);
    mesh.dispose();
    geo.dispose();
    mat.dispose();
  });
});
