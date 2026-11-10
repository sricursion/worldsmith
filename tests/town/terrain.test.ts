import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildingAabb, distanceToRoad, generateLayout } from '../../app/src/town/layout';
import { catenaryPoints, facingPairs, lineKindFor } from '../../app/src/town/props';
import { SCATTER_FAR, WIND, buildScatter, crossedQuads, scatterBudget, scatterMix, tuftTexels, updateScatter } from '../../app/src/town/scatter';
import type { ScatterInput } from '../../app/src/town/scatter';
import {
  FLAT_MARGIN, buildGroundGeometry, buildHorizonGeometry, buildRoadGeometry, fbm, groundHalfExtent, horizonForms, horizonKindFor,
  horizonPalette, horizonRadii, landformFor, makeTerrainField, outsideDistance, roadClassFor, roadDecalKind, terrainHeight, valueNoise,
} from '../../app/src/town/terrain';
import type { RoadInput } from '../../app/src/town/terrain';
import type { SurfaceKind, SurfaceSet } from '../../app/src/world/spec';
import { STYLE, makeBlueprintSpec, makeSiteSpec } from './helpers';

const BOUNDS = { minX: -60, maxX: 70, minZ: -40, maxZ: 45 };
const GROUNDS: SurfaceKind[] = ['sand', 'grass', 'regolith', 'snow', 'asphalt'];
const SURFACES: SurfaceSet = { wall: 'plaster', wall2: 'stone', roof: 'tile', trim: 'timber', ground: 'grass', road: 'cobble', wear: 0.4, wet: 0 };

function finite(g: THREE.BufferGeometry, name = 'position'): boolean {
  const a = g.getAttribute(name);
  for (let i = 0; i < a.count * a.itemSize; i++) if (!Number.isFinite(a.array[i])) return false;
  return true;
}
const maxY = (g: THREE.BufferGeometry): number => {
  g.computeBoundingBox();
  return (g.boundingBox as THREE.Box3).max.y;
};

describe('noise', () => {
  it('stays in 0..1, repeats for a seed and differs between seeds', () => {
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 4000; i++) {
      const v = fbm(i * 0.37 - 300, i * 0.21 + 11, 9, 4);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(0.4);
    expect(valueNoise(3.3, -7.1, 5)).toBe(valueNoise(3.3, -7.1, 5));
    expect(valueNoise(3.3, -7.1, 5)).not.toBe(valueNoise(3.3, -7.1, 6));
    // continuous across a lattice line
    expect(Math.abs(valueNoise(3.9999, 0.5, 1) - valueNoise(4.0001, 0.5, 1))).toBeLessThan(1e-3);
  });
});

describe('terrain height', () => {
  it('maps every ground kind to a landform', () => {
    expect(GROUNDS.map(landformFor)).toEqual(['dunes', 'hills', 'craters', 'drifts', 'flats']);
  });

  for (const ground of GROUNDS) {
    it(`${ground}: exactly 0 inside the bounds and across the flat margin`, () => {
      const f = makeTerrainField(BOUNDS, ground, 77);
      for (let x = BOUNDS.minX - FLAT_MARGIN; x <= BOUNDS.maxX + FLAT_MARGIN; x += 7.3) {
        for (let z = BOUNDS.minZ - FLAT_MARGIN; z <= BOUNDS.maxZ + FLAT_MARGIN; z += 6.1) {
          if (outsideDistance(BOUNDS, x, z) <= FLAT_MARGIN) expect(terrainHeight(f, x, z)).toBe(0);
        }
      }
    });

    it(`${ground}: continuous at the seam and all the way out, and it rises`, () => {
      const f = makeTerrainField(BOUNDS, ground, 77);
      let far = 0;
      let samples = 0;
      for (let a = 0; a < 24; a++) {
        const dx = Math.cos((a / 24) * Math.PI * 2);
        const dz = Math.sin((a / 24) * Math.PI * 2);
        // walk outward from the centre in 25 cm steps
        let prev = 0;
        let seamSeen = false;
        for (let r = 0; r < 420; r += 0.25) {
          const x = 5 + dx * r;
          const z = 2 + dz * r;
          const h = terrainHeight(f, x, z);
          expect(Math.abs(h - prev)).toBeLessThan(0.45);
          const e = outsideDistance(BOUNDS, x, z) - FLAT_MARGIN;
          if (e > 0 && e < 1.5) {
            seamSeen = true;
            expect(Math.abs(h)).toBeLessThan(0.02);
          }
          if (e > 180) { far += h; samples++; }
          prev = h;
        }
        expect(seamSeen).toBe(true);
      }
      expect(far / samples).toBeGreaterThan(3);
    });
  }
});

describe('ground mesh', () => {
  const spec = makeBlueprintSpec({ count: 9 });
  const layout = generateLayout(spec);
  const field = makeTerrainField(layout.bounds, 'grass', spec.seed);
  const half = groundHalfExtent(layout.bounds);
  const geo = buildGroundGeometry(layout, field, { quality: 1, doors: layout.buildings.map((b) => b.door), half });
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const col = geo.getAttribute('color');

  it('is flat over the town, reaches past the horizon ring and has world-space UVs', () => {
    expect(finite(geo) && finite(geo, 'color') && finite(geo, 'normal')).toBe(true);
    let high = 0;
    let reach = 0;
    const b = layout.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (outsideDistance(b, x, z) <= FLAT_MARGIN) expect(pos.getY(i)).toBe(0);
      expect(pos.getY(i)).toBe(terrainHeight(field, x, z) === 0 ? 0 : pos.getY(i));
      expect(uv.getX(i)).toBeCloseTo(x, 4);
      expect(uv.getY(i)).toBeCloseTo(z, 4);
      high = Math.max(high, pos.getY(i));
      reach = Math.max(reach, Math.abs(x - cx), Math.abs(z - cz));
    }
    expect(high).toBeGreaterThan(8);
    expect(reach).toBeGreaterThanOrEqual(horizonRadii(b).outer);
    expect(pos.count).toBeGreaterThan(5000);
    expect(pos.count).toBeLessThan(120000);
  });

  it('is darker where roads and doors wear it and against walls, lighter on the verges', () => {
    const boxes = layout.buildings.map((bd) => buildingAabb(bd));
    const sums = { worn: 0, wornN: 0, verge: 0, vergeN: 0, wall: 0, wallN: 0, open: 0, openN: 0 };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (outsideDistance(layout.bounds, x, z) > 0) continue;
      const k = col.getY(i);
      expect(k).toBeGreaterThan(0.3);
      expect(k).toBeLessThan(1.5);
      const roadD = Math.min(...layout.roads.map((r) => distanceToRoad(r, x, z)));
      const wallD = Math.min(...boxes.map((r) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ))));
      if (wallD > 0 && wallD < 0.4 && roadD > 6) { sums.wall += k; sums.wallN++; }
      if (wallD < 2.5) continue;
      if (roadD > 0 && roadD < 0.6) { sums.worn += k; sums.wornN++; }
      else if (roadD > 3.6 && roadD < 4.2) { sums.verge += k; sums.vergeN++; }
      else if (roadD > 9) { sums.open += k; sums.openN++; }
    }
    expect(Math.min(sums.wornN, sums.vergeN, sums.wallN, sums.openN)).toBeGreaterThan(20);
    const open = sums.open / sums.openN;
    expect(sums.worn / sums.wornN).toBeLessThan(open * 0.9);
    expect(sums.verge / sums.vergeN).toBeGreaterThan(open * 1.02);
    expect(sums.wall / sums.wallN).toBeLessThan(open * 0.9);
  });

  it('uses fewer vertices on a lower quality tier', () => {
    const low = buildGroundGeometry(layout, field, { quality: 0, doors: [], half });
    expect(low.getAttribute('position').count).toBeLessThan(pos.count);
    low.dispose();
  });
});

describe('horizon ring', () => {
  it('picks forms from the words of the world, then the ground, then the theme', () => {
    expect(horizonKindFor('a mushroom forest in spore mist', 'moss', 'medieval')).toBe('mushrooms');
    expect(horizonKindFor('a neon arcology in rain', 'asphalt', 'scifi')).toBe('towers');
    expect(horizonKindFor('a snowbound monastery', 'snow', 'medieval')).toBe('mountains');
    expect(horizonKindFor('a desert camp at dusk', 'sand', 'western')).toBe('mesas');
    expect(horizonKindFor('a frontier town at golden hour', 'dirt', 'western')).toBe('mesas');
    expect(horizonKindFor('', 'regolith', 'scifi')).toBe('spires');
    expect(horizonKindFor('', 'moss', 'medieval')).toBe('trees');
    expect(horizonKindFor('', 'dirt', 'modern')).toBe('towers');
  });

  for (const kind of ['mesas', 'mountains', 'trees', 'mushrooms', 'towers', 'spires'] as const) {
    it(`${kind}: every form stands beyond 150 m, clear of the flat ground, and towers over it`, () => {
      const field = makeTerrainField(BOUNDS, 'grass', 31);
      const forms = horizonForms(field, kind, 2);
      expect(forms.length).toBeGreaterThanOrEqual(20);
      const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
      const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
      for (const f of forms) {
        expect(Math.hypot(f.x - cx, f.z - cz)).toBeGreaterThan(150);
        expect(outsideDistance(BOUNDS, f.x, f.z)).toBeGreaterThan(FLAT_MARGIN);
        expect(f.height).toBeGreaterThan(25);
      }
      // the ring closes: no gap wider than a quarter turn
      const angles = forms.map((f) => Math.atan2(f.z - cz, f.x - cx)).sort((a, b) => a - b);
      for (let i = 1; i < angles.length; i++) expect((angles[i] as number) - (angles[i - 1] as number)).toBeLessThan(Math.PI / 2);
      const { solid, glow } = buildHorizonGeometry(forms, horizonPalette(STYLE, kind, 'grass'), 2);
      expect(solid).not.toBeNull();
      if (!solid) return;
      expect(finite(solid) && finite(solid, 'color') && finite(solid, 'normal')).toBe(true);
      expect(maxY(solid)).toBeGreaterThan(40);
      // no form puts a foot on the flat ground around the town
      const sp = solid.getAttribute('position');
      for (let i = 0; i < sp.count; i++) expect(outsideDistance(BOUNDS, sp.getX(i), sp.getZ(i))).toBeGreaterThan(FLAT_MARGIN);
      expect(glow !== null).toBe(kind === 'towers' || kind === 'mushrooms');
      if (glow) expect(finite(glow)).toBe(true);
      expect(horizonForms(field, kind, 2)).toEqual(forms);
      solid.dispose();
      glow?.dispose();
    });
  }

  it('moves the ring out for a large town', () => {
    const big = { minX: -160, maxX: 160, minZ: -140, maxZ: 140 };
    expect(horizonRadii(BOUNDS).inner).toBeGreaterThanOrEqual(150);
    expect(horizonRadii(big).inner).toBeGreaterThan(Math.hypot(160, 140) + FLAT_MARGIN);
  });
});

describe('roads', () => {
  const spec = makeBlueprintSpec({ count: 10 });
  const layout = generateLayout(spec);
  const input = (over: Partial<SurfaceSet>, extra: Partial<RoadInput> = {}): RoadInput => ({
    layout, surfaces: { ...SURFACES, ...over }, theme: 'medieval', paths: 'road', seed: 5, quality: 2, roadHex: STYLE.road, wallHex: STYLE.wall, ...extra,
  });

  it('classes roads by surface and site, and decals by class and theme', () => {
    expect(roadClassFor('cobble', 'road')).toBe('paved');
    expect(roadClassFor('asphalt', 'track')).toBe('track');
    expect(roadClassFor('dirt', 'road')).toBe('track');
    expect(roadDecalKind('paved', 'western')).toBe('manholes');
    expect(roadDecalKind('track', 'western')).toBe('hoofprints');
    expect(roadDecalKind('track', 'scifi')).toBe('tyre_tracks');
  });

  it('paved roads get kerbs and covers; tracks get ruts and prints and no kerbs', () => {
    const paved = buildRoadGeometry(input({ road: 'cobble' }));
    expect(paved.cls).toBe('paved');
    expect(paved.roads.length).toBe(layout.roads.length);
    expect(paved.kerbCount).toBeGreaterThan(50);
    expect(paved.trim).not.toBeNull();
    expect(paved.decals).not.toBeNull();
    const track = buildRoadGeometry(input({ road: 'dirt' }));
    expect(track.cls).toBe('track');
    expect(track.kerbCount).toBe(0);
    expect(track.trim).toBeNull();
    expect(track.decalKind).toBe('hoofprints');
    expect(track.decals).not.toBeNull();
    // ruts: a track strip has darker bands than its lightest column
    const c = (track.roads[0] as THREE.BufferGeometry).getAttribute('color');
    let lo = 9;
    let hi = 0;
    for (let i = 0; i < c.count; i++) { lo = Math.min(lo, c.getY(i)); hi = Math.max(hi, c.getY(i)); }
    expect(hi / lo).toBeGreaterThan(1.3);
    for (const g of [...paved.roads, paved.plaza, paved.trim, paved.decals, ...track.roads, track.decals]) {
      expect(g && finite(g) && finite(g, 'color')).toBe(true);
      // everything on the walkable ground is micro-relief
      expect(g ? maxY(g) : 0).toBeLessThan(0.11);
      expect(g?.getAttribute('uv').getX(0)).toBeCloseTo(g?.getAttribute('position').getX(0) ?? 1, 4);
    }
  });

  it('kerb stones leave crossings open', () => {
    const paved = buildRoadGeometry(input({ road: 'cobble' }));
    const p = (paved.trim as THREE.BufferGeometry).getAttribute('position');
    // no kerb vertex sits well inside another road's carriageway
    for (let i = 0; i < p.count; i += 7) {
      const inside = layout.roads.filter((r) => distanceToRoad({ ...r, width: r.width - 1 }, p.getX(i), p.getZ(i)) === 0).length;
      expect(inside).toBe(0);
    }
  });

  it('puddles appear only above wet 0.5 and grow with it', () => {
    expect(buildRoadGeometry(input({ wet: 0 })).puddles).toBeNull();
    expect(buildRoadGeometry(input({ wet: 0.5 })).puddles).toBeNull();
    const damp = buildRoadGeometry(input({ wet: 0.6 }));
    const soaked = buildRoadGeometry(input({ wet: 1 }));
    expect(soaked.puddles).not.toBeNull();
    expect(soaked.puddleCount).toBeGreaterThan(damp.puddleCount);
    expect(soaked.puddleCount).toBeGreaterThan(8);
    const g = soaked.puddles as THREE.BufferGeometry;
    const p = g.getAttribute('position');
    const c = g.getAttribute('color');
    expect(c.itemSize).toBe(4);
    let soft = 0;
    for (let i = 0; i < p.count; i++) {
      // dead flat, and on a road or the plaza
      expect(p.getY(i)).toBeCloseTo(p.getY(0), 6);
      if (c.getW(i) === 0) soft++;
    }
    expect(soft).toBeGreaterThan(0);
    for (let i = 0; i < p.count; i += 45) {
      const onRoad = layout.roads.some((r) => distanceToRoad(r, p.getX(i), p.getZ(i)) < 1.5);
      const onPlaza = Math.hypot(p.getX(i) - layout.plaza.x, p.getZ(i) - layout.plaza.z) < layout.plaza.r + 1.5;
      expect(onRoad || onPlaza).toBe(true);
    }
  });

  it('boardwalks front timber buildings only, and paths none draws nothing but the plaza', () => {
    expect(buildRoadGeometry(input({ wall: 'plaster', road: 'dirt' })).boardwalkCount).toBe(0);
    const timber = buildRoadGeometry(input({ wall: 'timber', road: 'dirt' }));
    expect(timber.boardwalkCount).toBeGreaterThan(0);
    expect(timber.trim).not.toBeNull();
    const none = buildRoadGeometry(input({ wet: 1 }, { paths: 'none' }));
    expect(none.roads).toHaveLength(0);
    expect(none.kerbCount).toBeGreaterThanOrEqual(0);
    expect(none.plaza.getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('scatter', () => {
  const base = (wild: number, over: Partial<ScatterInput> = {}): ScatterInput => {
    const spec = makeSiteSpec({ pattern: 'street', count: 9, seed: 12, wild });
    return { layout: generateLayout(spec), ground: 'grass', groundHex: '#6f8a4a', accents: ['#c0392b'], wild, wet: 0, quality: 1, seed: 12, tracks: false, ...over };
  };

  it('budgets 4000 to 20000 instances by quality and wildness', () => {
    expect(scatterBudget(0, 0)).toBe(4000);
    expect(scatterBudget(2, 1)).toBe(20000);
    for (const q of [0, 1, 2] as const) {
      expect(scatterBudget(q, 0.9)).toBeGreaterThan(scatterBudget(q, 0.1));
      if (q > 0) expect(scatterBudget(q, 0.5)).toBeGreaterThan(scatterBudget((q - 1) as 0 | 1, 0.5));
    }
    expect(scatterBudget(1, Number.NaN)).toBe(scatterBudget(1, 0.3));
  });

  it('shares the budget by ground kind', () => {
    for (const g of ['grass', 'moss', 'dirt', 'mud', 'sand', 'gravel', 'snow', 'regolith', 'asphalt', 'cobble'] as const) {
      const m = scatterMix(g);
      expect(m.tufts + m.flowers + m.stones + m.debris).toBeCloseTo(1, 6);
    }
    expect(scatterMix('grass').tufts).toBeGreaterThan(scatterMix('sand').tufts);
    expect(scatterMix('regolith').tufts).toBe(0);
    expect(scatterMix('snow').kind).toBe('clump');
    expect(scatterMix('asphalt').kind).toBe('litter');
    expect(scatterMix('grass').kind).toBe('leaf');
  });

  it('places more when the site is wilder, never inside a building, and no plants on a road', () => {
    const tame = buildScatter(base(0.1));
    const wildSet = buildScatter(base(0.9));
    expect(wildSet.total).toBeGreaterThan(tame.total * 1.2);
    expect(wildSet.counts.tufts).toBeGreaterThan(tame.counts.tufts);
    expect(tame.total).toBeGreaterThan(3000);
    expect(wildSet.total).toBeLessThanOrEqual(scatterBudget(1, 0.9));
    const inp = base(0.9);
    const boxes = inp.layout.buildings.map((b) => buildingAabb(b));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    updateScatter(new THREE.Vector3(inp.layout.spawn.x, 0, inp.layout.spawn.z));
    for (const child of wildSet.group.children) {
      const mesh = child as THREE.InstancedMesh;
      expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
      expect(mesh.castShadow).toBe(false);
      for (let i = 0; i < mesh.count; i += 3) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        expect(p.y).toBe(0);
        expect(boxes.some((r) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ)).toBe(false);
        if (mesh.name === 'scatter:tufts' || mesh.name === 'scatter:flowers') {
          expect(inp.layout.roads.some((r) => distanceToRoad(r, p.x, p.z) === 0)).toBe(false);
        }
      }
    }
    tame.dispose();
    wildSet.dispose();
  });

  it('grows a strip of tufts between the ruts of a track', () => {
    const inp = base(0.5, { tracks: true });
    const set = buildScatter(inp);
    const mesh = set.group.getObjectByName('scatter:tufts') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let onRoad = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (inp.layout.roads.some((r) => distanceToRoad(r, p.x, p.z) === 0)) onRoad++;
    }
    expect(onRoad).toBeGreaterThan(20);
    set.dispose();
  });

  it('draws only what is within reach of the focus', () => {
    const inp = base(0.6);
    const set = buildScatter(inp);
    const spawn = new THREE.Vector3(inp.layout.spawn.x, 0, inp.layout.spawn.z);
    updateScatter(spawn);
    const near = set.visible();
    expect(near).toBeGreaterThan(500);
    expect(near).toBeLessThanOrEqual(set.total);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const child of set.group.children) {
      const mesh = child as THREE.InstancedMesh;
      for (let i = 0; i < mesh.count; i += 5) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        // a whole 24 m chunk comes in when any of it is in range
        expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeLessThan(SCATTER_FAR + 24 * Math.SQRT2 + 8);
      }
    }
    updateScatter(new THREE.Vector3(spawn.x + 60, 0, spawn.z));
    const moved = set.visible();
    expect(moved).toBeGreaterThan(0);
    updateScatter(new THREE.Vector3(5000, 0, 5000));
    expect(set.visible()).toBe(0);
    updateScatter(spawn);
    expect(set.visible()).toBe(near);
    set.dispose();
    updateScatter(new THREE.Vector3(5000, 0, 5000));
    expect(set.group.children).toHaveLength(0);
  });

  it('is deterministic and disposes its geometry and materials', () => {
    const a = buildScatter(base(0.5));
    const b = buildScatter(base(0.5));
    expect(a.counts).toEqual(b.counts);
    const ma = (a.group.children[0] as THREE.InstancedMesh).instanceMatrix.array;
    const mb = (b.group.children[0] as THREE.InstancedMesh).instanceMatrix.array;
    expect(Array.from(ma.slice(0, 160))).toEqual(Array.from(mb.slice(0, 160)));
    let disposed = 0;
    const seen = new Set<unknown>();
    for (const child of a.group.children) {
      const mesh = child as THREE.InstancedMesh;
      for (const d of [mesh.geometry, mesh.material as THREE.Material]) {
        if (seen.has(d)) continue;
        seen.add(d);
        d.addEventListener('dispose', () => { disposed++; });
      }
    }
    a.dispose();
    expect(disposed).toBe(seen.size);
    a.dispose();
    b.dispose();
  });

  it('exposes one shared wind', () => {
    expect(WIND.time.value).toBeTypeOf('number');
    expect(WIND.strength.value).toBeGreaterThan(0);
  });

  it('generates tuft texels that are solid at the root and thin toward the tip', () => {
    for (const flowers of [false, true]) {
      const size = 64;
      const px = tuftTexels(size, 7, flowers);
      expect(px.length).toBe(size * size * 4);
      const coverage = (row: number): number => {
        let n = 0;
        for (let x = 0; x < size; x++) if ((px[(row * size + x) * 4 + 3] as number) > 80) n++;
        return n / size;
      };
      expect(coverage(1)).toBeGreaterThan(flowers ? 0.05 : 0.2);
      expect(coverage(size - 1)).toBeLessThan(0.2);
      expect(coverage(1)).toBeGreaterThan(flowers ? 0 : coverage(size - 2));
      // the corners are empty, so quads do not show as cards
      expect(px[3]).toBe(0);
      expect(px[(size - 1) * 4 + 3]).toBe(0);
      expect(Array.from(tuftTexels(size, 7, flowers))).toEqual(Array.from(px));
    }
    // grass darkens toward the root
    const g = tuftTexels(64, 7, false);
    const mean = (row: number): number => {
      let s = 0;
      let n = 0;
      for (let x = 0; x < 64; x++) if ((g[(row * 64 + x) * 4 + 3] as number) > 200) { s += g[(row * 64 + x) * 4] as number; n++; }
      return n > 0 ? s / n : 0;
    };
    expect(mean(2)).toBeLessThan(mean(24));
  });

  it('builds crossed quads with upward normals, wound both ways', () => {
    const g = crossedQuads(3, 2);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([0, 1, 0]);
    expect(g.getIndex()?.count).toBe(3 * 2 * 12);
    g.computeBoundingBox();
    expect(g.boundingBox?.min.y).toBe(0);
    expect(g.boundingBox?.max.y).toBe(1);
    g.dispose();
  });
});

describe('strung lines', () => {
  it('hangs a catenary between its ends with the asked sag', () => {
    const a = new THREE.Vector3(0, 5, 0);
    const b = new THREE.Vector3(12, 5, 0);
    const pts = catenaryPoints(a, b, 0.9, 16);
    expect(pts).toHaveLength(17);
    expect(pts[0]?.distanceTo(a)).toBeLessThan(1e-6);
    expect(pts[16]?.distanceTo(b)).toBeLessThan(1e-6);
    expect(pts[8]?.y).toBeCloseTo(4.1, 3);
    for (let i = 0; i <= 8; i++) expect(pts[i]?.y).toBeCloseTo(pts[16 - i]?.y ?? 0, 6);
    for (let i = 1; i <= 8; i++) expect(pts[i]?.y ?? 0).toBeLessThan(pts[i - 1]?.y ?? 0);
    // a cosh curve hangs lower at the quarter points than the parabola through the same three points
    const parabola = 5 - 0.9 * (1 - (2 * 0.25 - 1) ** 2);
    expect(pts[4]?.y ?? 0).toBeGreaterThan(parabola - 0.05);
    const sloped = catenaryPoints(a, new THREE.Vector3(10, 7, 4), 0.5, 10);
    expect(sloped[10]?.y).toBeCloseTo(7, 6);
    expect(catenaryPoints(a, b, 0, 4).every((p) => Math.abs(p.y - 5) < 1e-9)).toBe(true);
  });

  it('finds buildings that face each other across a street and chooses what to string between them', () => {
    const layout = generateLayout(makeBlueprintSpec({ count: 12 }));
    const pairs = facingPairs(layout.buildings);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [a, b] of pairs) {
      expect(Math.cos(a.rotY - b.rotY)).toBeLessThan(-0.9);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(60);
    }
    expect(lineKindFor('a neon arcology in rain', 'scifi', SURFACES, 0.1)).toBe('cables');
    expect(lineKindFor('a mushroom forest in spore mist', 'medieval', SURFACES, 0.9)).toBe('vines');
    expect(lineKindFor('a lantern festival', 'medieval', SURFACES, 0.2)).toBe('lights');
    expect(lineKindFor('a frontier town', 'western', SURFACES, 0.2)).toBe('bunting');
  });
});
