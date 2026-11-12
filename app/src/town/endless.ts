// The land beyond the place. A world used to end a few steps past its last building: the walkable ground
// stopped, the detailed ground and the scatter stopped, and a ring of silhouettes stood in for the rest.
// Here the land simply goes on, wherever the walker goes:
//
//   - Ground. The height of the land is a function of position (Land.heightAt), defined everywhere. Around the
//     focus it is drawn as a quadtree of square tiles, each the same grid of cells: the finest under the walker
//     (cells as small as the place's own), each ring out twice as coarse, out to a kilometre or two. Tiles are
//     made a few rows at a time inside a per-frame time budget, come from a pool that is never outgrown, and a
//     change of level of detail is shown only when everything that replaces the old tiles is ready, so the
//     ground never has a hole. Skirts hang from every tile edge to close the hairline gaps between levels.
//   - The seam. The place keeps its own ground mesh (roads, wear, the baked grid), cut back to the `core`
//     rectangle; tiles that reach into the core have their vertices drawn onto its edge, where both read the
//     same heights. Outside the core the land is what the finest tiles draw: surfaceAt() interpolates the same
//     lattice with the same triangles, so whoever stands on it stands on what is seen.
//   - Water without a far shore (a sea, a mist sea, a swamp's sheet) is drawn on the tiles themselves.
//   - What stands on it: the world's own props at their real size, thick or thin by the land's dials, made a
//     chunk at a time (see InstanceWindow); and every few hundred metres a place worth walking to, decided by
//     the cell it lies in: standing stones, a rock arch, a great tree, a camp, a lone building half sunk.
//     All of these are solid to a walker (pushOut).
//   - The horizon ring is carried with the focus, enlarged and set far out, so it is never reached.
//
// Nothing is made until update() is first called; a town whose update is never called looks as it always did.
import * as THREE from 'three';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { Blueprint, PropBlueprint, StyleSpec } from '../world/spec';
import { GeoBatch } from './batch';
import type { MaterialCache } from './batch';
import { addBlueprint, addPropParts } from './blueprint-mesh';
import { GROWN_FOOTPRINTS, waterInside } from './layout';
import type { Rect } from './layout';
import { backdropKinds, propFoot, propProfile } from './props';
import { InstanceWindow, windowMesh } from './scatter';
import type { WindowLayer } from './scatter';
import { bankTint, fbm, hash2, outsideDistance, patchTint, reliefTint, smoothstep } from './terrain';
import type { Land, LandWater, Quality } from './terrain';
import { waterLook, waterMaterial } from './water';
import type { WaterKind, WaterLook } from './water';

/**
 * Makes a horizon material work its scene fog from the view depth times the returned value (1 to begin with),
 * so a ring that is enlarged and set far out keeps the haze it was drawn for.
 */
export function patchFarFog(material: THREE.Material): { value: number } {
  const scale = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uFarFog'] = scale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nuniform float uFarFog;')
      .replace('#include <fog_vertex>', '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z * uFarFog;\n#endif');
  };
  material.customProgramCacheKey = () => 'town-horizon';
  return scale;
}

export interface EndlessLife {
  style: StyleSpec;
  props: readonly PropBlueprint[];
  blueprints: readonly Blueprint[];
  mats: MaterialCache;
  /** SiteSpec.wild and TerrainSpec.settled, 0..1. */
  wild: number; settled: number;
}

export interface EndlessInput {
  land: Land;
  seed: number;
  quality: Quality;
  /** The drawn ground of the place and its material: the far ground is drawn in the same one. */
  terrain: THREE.Mesh;
  groundMaterial: THREE.Material;
  groundHex: string;
  /** The horizon ring: its meshes, the radii it was built between, and the mean height of the feet of its forms. */
  horizon: { meshes: THREE.Mesh[]; inner: number; outer: number; baseY: number; fog: { value: number }[] };
  /** The rectangle the place's own wide water is drawn over, when it has water. */
  waterCovered: Rect | null;
  tintWater?: (kind: WaterKind, look: WaterLook) => void;
  /** Far ground scatter, already built; this module only drives it. */
  scatter: InstanceWindow | null;
  /** What grows and stands out there. Without it the far land has stones only. */
  life: EndlessLife | null;
  /** Metres past the bounds kept clear of far props (the middle distance has its own). */
  clear: number;
  /** Things already standing that a walker goes round: x, z, radius triples. */
  solids?: Float32Array;
  /** Milliseconds of making per update. Default 4. */
  budgetMs?: number;
  /** Colours the far ground where something is laid on it (the streets of a city): multiplies `rgb` for a ground cell of size `cell` at a point. */
  paint?: (x: number, z: number, cell: number, rgb: [number, number, number]) => void;
  /** True where the place's own fabric stands: nothing wild grows there and no lone place of interest is set. */
  built?: (x: number, z: number) => boolean;
}

export interface EndlessStats {
  /** True once the far ground has replaced the outskirts of the place's own. */
  active: boolean;
  /** Tiles drawn, tiles held (drawn, waiting or being made), tiles ever created, and the most that may be. */
  shown: number; held: number; created: number; poolCap: number;
  queued: number;
  /** Instance slots of far props and of far scatter: fixed once made. */
  propCapacity: number; scatterCapacity: number;
  /** Chunks of props made so far, and places of interest now standing. */
  propChunks: number; places: number;
  /** The rectangle the place's own ground is kept in, and the cells along a side of a ground tile. */
  core: Rect; cells: number;
}

export interface Endless {
  group: THREE.Group;
  /** Where the place's own ground is kept: inside it the land is the baked land, outside it the far land. */
  core: Rect;
  /** Height of the ground as drawn, anywhere. */
  surfaceAt(x: number, z: number): number;
  /** Moves a point out of anything solid that stands on the far land (and the middle distance). */
  pushOut(p: { x: number; z: number }): void;
  update(focus: THREE.Vector3, dt: number): void;
  stats(): EndlessStats;
  dispose(): void;
}

interface Tile {
  key: number; level: number; ix: number; iz: number; x0: number; z0: number; size: number;
  geo: THREE.BufferGeometry; mesh: THREE.Mesh; water: THREE.Mesh | null;
  /** 0 free, 1 waiting to be made, 2 made. */
  state: 0 | 1 | 2;
  shown: boolean; wet: boolean;
}

interface Model { meshes: THREE.InstancedMesh[]; n: number; cap: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const now = (): number => performance.now();
const VEG_CHUNK = 64;
const PLACE_CELL = 256;
const PLACE_SPAN = 5;
const PLACE_SOLIDS = 16;
const SINK = 40;
const WALKER = 0.35;

export function createEndless(inp: EndlessInput): Endless {
  const { land, quality } = inp;
  const seed = inp.seed | 0;
  const b = land.bounds;
  const group = new THREE.Group();
  group.name = 'endless';
  const budgetMs = inp.budgetMs ?? 4;

  // ---- The core and the lattice ---------------------------------------------------------------------------
  const N = quality === 2 ? 32 : quality === 1 ? 24 : 16;
  const LEVELS = quality === 0 ? 6 : 7;
  const coarse = quality === 0 ? 2 : 1;
  const lg = land.grid;
  // The surface a walker stands on is worked on the place's own cell size at every tier; the lowest tier only
  // draws it with cells twice as wide, as it does the place's own ground.
  const sLat = lg ? lg.cell : 1;
  const s0 = sLat * coarse;
  const tPos = inp.terrain.geometry.getAttribute('position');
  // The ground of the place is one grid: find its lines.
  let gnx = tPos.count;
  for (let i = 1; i < tPos.count; i++) if (tPos.getX(i) <= tPos.getX(i - 1)) { gnx = i; break; }
  const gnz = Math.max(1, Math.floor(tPos.count / gnx));
  const want: Rect = lg
    ? {
        minX: lg.x0, maxX: lg.x0 + Math.floor((lg.nx - 1) / coarse) * coarse * lg.cell,
        minZ: lg.z0, maxZ: lg.z0 + Math.floor((lg.nz - 1) / coarse) * coarse * lg.cell,
      }
    : { minX: b.minX - 30, maxX: b.maxX + 30, minZ: b.minZ - 30, maxZ: b.maxZ + 30 };
  let i0 = 0;
  let i1 = gnx - 1;
  let j0 = 0;
  let j1 = gnz - 1;
  while (i0 < gnx - 2 && tPos.getX(i0) < want.minX - 1e-3) i0++;
  while (i1 > i0 + 1 && tPos.getX(i1) > want.maxX + 1e-3) i1--;
  while (j0 < gnz - 2 && tPos.getZ(j0 * gnx) < want.minZ - 1e-3) j0++;
  while (j1 > j0 + 1 && tPos.getZ(j1 * gnx) > want.maxZ + 1e-3) j1--;
  const core: Rect = { minX: tPos.getX(i0), maxX: tPos.getX(i1), minZ: tPos.getZ(j0 * gnx), maxZ: tPos.getZ(j1 * gnx) };
  const ox = core.minX;
  const oz = core.minZ;
  const T0 = N * s0;
  const sizes: number[] = [];
  for (let l = 0; l < LEVELS; l++) sizes.push(T0 * 2 ** l);
  const rootSize = sizes[LEVELS - 1] as number;
  const coreCell = Math.max(s0, Math.min(core.maxX - core.minX, core.maxZ - core.minZ) / 6);
  const poolCap = 2 * (36 + 27 * (LEVELS - 1) + 12 * LEVELS) + 8;

  const H = land.heightAt;
  const inCore = (x: number, z: number): boolean => x >= core.minX && x <= core.maxX && z >= core.minZ && z <= core.maxZ;
  const surfaceAt = (x: number, z: number): number => {
    if (inCore(x, z)) return H(x, z);
    const u = (x - ox) / sLat;
    const v = (z - oz) / sLat;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const xa = ox + i * sLat;
    const za = oz + j * sLat;
    const h10 = H(xa + sLat, za);
    const h01 = H(xa, za + sLat);
    if (fu + fv <= 1) {
      const h00 = H(xa, za);
      return h00 + (h10 - h00) * fu + (h01 - h00) * fv;
    }
    const h11 = H(xa + sLat, za + sLat);
    return h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
  };

  // ---- Water with no far shore ----------------------------------------------------------------------------
  const sea: LandWater | null = inp.waterCovered
    ? land.water.find((w) => w.body.area.shape === 'outside') ?? land.water.find((w) => w.body.area.shape === 'half')
      ?? land.water.find((w) => w.body.area.shape === 'sheet') ?? null
    : null;
  const seaSheet = sea?.body.area.shape === 'sheet';

  // ---- State made on first use ----------------------------------------------------------------------------
  const geos: THREE.BufferGeometry[] = [];
  const ownMats: THREE.Material[] = [];
  const tiles = new Map<number, Tile>();
  const desired = new Set<number>();
  const free: Tile[] = [];
  const queue: Tile[] = [];
  let queueAt = 0;
  let created = 0;
  let pendingSwap = false;
  let starved = false;
  let active = false;
  let made = false;
  let disposed = false;
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let rowAt = 0;
  let current: Tile | null = null;
  let index: THREE.BufferAttribute | null = null;
  let seaMat: THREE.MeshStandardMaterial | null = null;
  let coreGeo: THREE.BufferGeometry | null = null;
  let fullGeo: THREE.BufferGeometry | null = null;
  let coreSkirt: THREE.Mesh | null = null;
  let apron: THREE.Mesh | null = null;
  let seaApron: THREE.Mesh | null = null;
  let apronX = Number.NaN;
  let apronZ = Number.NaN;
  let farLevel = 0;
  let veg: InstanceWindow | null = null;
  let vegSolids = new Float32Array(0);
  let vegSolidN = new Int32Array(0);
  let vegCap = 0;
  let placeX = Number.NaN;
  let placeZ = Number.NaN;
  let placesDirty = false;
  let places = 0;
  let rebuildPlaces: (() => void) | null = null;
  const placeSolids = new Float32Array(PLACE_SPAN * PLACE_SPAN * PLACE_SOLIDS * 3);
  let placeSolidN = 0;
  const W = N + 3;
  const tint: [number, number, number] = [1, 1, 1];
  const hs = new Float64Array(W * W);
  const VERTS = (N + 1) * (N + 1) + 4 * (N + 1);
  const horizonF = clamp(5200 / (inp.horizon.outer + 220), 3, 12);
  const hcx = (b.minX + b.maxX) / 2;
  const hcz = (b.minZ + b.maxZ) / 2;

  const keyOf = (level: number, ix: number, iz: number): number => (level * 65536 + (ix + 32768)) * 65536 + (iz + 32768);

  function makeIndex(): THREE.BufferAttribute {
    const idx: number[] = [];
    const R = N + 1;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * R + i;
        idx.push(a, a + R, a + 1, a + 1, a + R, a + R + 1);
      }
    }
    const base = R * R;
    const src = (e: number, k: number): number => (e === 0 ? k : e === 1 ? N * R + k : e === 2 ? k * R : k * R + N);
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < N; k++) {
        const a = src(e, k);
        const c = src(e, k + 1);
        const d = base + e * R + k;
        const f = d + 1;
        // Both ways round: a skirt is seen from whichever side the gap opens to.
        idx.push(a, c, d, c, f, d, a, d, c, c, d, f);
      }
    }
    return new THREE.BufferAttribute(new Uint16Array(idx), 1);
  }

  function createTile(): Tile {
    const geo = new THREE.BufferGeometry();
    const dyn = (n: number): THREE.BufferAttribute => {
      const a = new THREE.BufferAttribute(new Float32Array(VERTS * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    geo.setAttribute('position', dyn(3));
    geo.setAttribute('normal', dyn(3));
    geo.setAttribute('uv', dyn(2));
    geo.setAttribute('color', dyn(3));
    if (sea) geo.setAttribute('waterDepth', dyn(1));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere();
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, inp.groundMaterial);
    mesh.name = 'terrain-far';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    group.add(mesh);
    let water: THREE.Mesh | null = null;
    if (sea && seaMat) {
      water = new THREE.Mesh(geo, seaMat);
      water.name = `water-far:${sea.kind}`;
      water.receiveShadow = true;
      water.castShadow = false;
      water.matrixAutoUpdate = false;
      water.renderOrder = 3;
      water.visible = false;
      group.add(water);
    }
    created++;
    return { key: -1, level: 0, ix: 0, iz: 0, x0: 0, z0: 0, size: 0, geo, mesh, water, state: 0, shown: false, wet: false };
  }

  function show(t: Tile, on: boolean): void {
    t.shown = on;
    t.mesh.visible = on;
    if (t.water) t.water.visible = on && t.wet;
  }

  function release(t: Tile): void {
    show(t, false);
    t.state = 0;
    if (current === t) current = null;
    tiles.delete(t.key);
    free.push(t);
  }

  /** Writes a made tile's buffers from the heights sampled into `hs`. */
  function finish(t: Tile): void {
    const s = t.size / N;
    const R = N + 1;
    const pos = t.geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = t.geo.getAttribute('normal') as THREE.BufferAttribute;
    const uv = t.geo.getAttribute('uv') as THREE.BufferAttribute;
    const col = t.geo.getAttribute('color') as THREE.BufferAttribute;
    const dep = sea ? (t.geo.getAttribute('waterDepth') as THREE.BufferAttribute) : null;
    const pa = pos.array as Float32Array;
    const na = nor.array as Float32Array;
    const ua = uv.array as Float32Array;
    const ca = col.array as Float32Array;
    const da = dep ? (dep.array as Float32Array) : null;
    const E = 1e-4;
    const touches = t.x0 < core.maxX && t.x0 + t.size > core.minX && t.z0 < core.maxZ && t.z0 + t.size > core.minZ;
    const fineTint = s <= 8;
    let lo = Infinity;
    let hi = -Infinity;
    let wet = false;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const v = j * R + i;
        const c = (j + 1) * W + i + 1;
        let x = t.x0 + i * s;
        let z = t.z0 + j * s;
        let y = hs[c] as number;
        let sunk = false;
        if (touches && x > core.minX + E && x < core.maxX - E && z > core.minZ + E && z < core.maxZ - E) {
          // Inside the place's own ground. A vertex whose cells reach out of it is drawn onto its edge, so the
          // far ground ends exactly where the place's begins; one deeper in goes under it.
          const dxl = x - core.minX;
          const dxh = core.maxX - x;
          const dzl = z - core.minZ;
          const dzh = core.maxZ - z;
          const nearX = Math.min(dxl, dxh) < s - E;
          const nearZ = Math.min(dzl, dzh) < s - E;
          if (nearX || nearZ) {
            if (nearX) x = dxl < dxh ? core.minX : core.maxX;
            if (nearZ) z = dzl < dzh ? core.minZ : core.maxZ;
            y = H(x, z);
          } else {
            y -= SINK;
            sunk = true;
          }
        }
        pa[v * 3] = x; pa[v * 3 + 1] = y; pa[v * 3 + 2] = z;
        const hx = ((hs[c + 1] as number) - (hs[c - 1] as number)) / (2 * s);
        const hz = ((hs[c + W] as number) - (hs[c - W] as number)) / (2 * s);
        const nl = 1 / Math.hypot(hx, 1, hz);
        na[v * 3] = -hx * nl; na[v * 3 + 1] = nl; na[v * 3 + 2] = -hz * nl;
        ua[v * 2] = x; ua[v * 2 + 1] = z;
        // The same blotches and drift the place's ground carries, so the two read as one surface.
        let k = 0.83 + 0.2 * fbm(x / 31, z / 31, seed + 41, 3) + (fineTint ? 0.14 * fbm(x / 6.5, z / 6.5, seed + 43, 2) : 0.07);
        const drift = fbm(x / 52, z / 52, seed + 47, 2) - 0.5;
        if (fineTint) k *= patchTint(x, z, seed);
        if (!land.shaped && y > 0) k *= 0.9 + 0.2 * smoothstep(0, 1, fbm(x / 70, z / 70, seed + 59, 2));
        const shore = sea && !sunk ? (seaSheet ? 1 : waterInside(sea.body, x, z)) : -1e9;
        // The same shading by shape the place's ground has: dark damp hollows and banks, pale crests.
        if (shore > -5 && sea) k *= 1 + (bankTint(y - sea.level) - 1) * smoothstep(-5, -2, shore);
        const h0 = hs[c] as number;
        reliefTint(((hs[c + 1] as number) + (hs[c - 1] as number) + (hs[c + W] as number) + (hs[c - W] as number) - 4 * h0) / (s * s), Math.hypot(hx, hz), tint);
        if (inp.paint && !sunk) inp.paint(x, z, s, tint);
        ca[v * 3] = k * (1 + 0.07 * drift) * tint[0]; ca[v * 3 + 1] = k * tint[1]; ca[v * 3 + 2] = k * (1 - 0.09 * drift) * tint[2];
        if (da && sea) {
          const d = sunk ? -1 : shore > -1.5 ? clamp(sea.level - y, -0.5, 40) : -1;
          da[v] = d;
          if (d > 0) wet = true;
        }
        if (!sunk) { if (y < lo) lo = y; if (y > hi) hi = y; }
      }
    }
    // Skirts: the rim again, lower.
    const drop = 0.75 * s + 1;
    const base = R * R;
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k <= N; k++) {
        const from = e === 0 ? k : e === 1 ? N * R + k : e === 2 ? k * R : k * R + N;
        const to = base + e * R + k;
        pa[to * 3] = pa[from * 3] as number; pa[to * 3 + 1] = (pa[from * 3 + 1] as number) - drop; pa[to * 3 + 2] = pa[from * 3 + 2] as number;
        na[to * 3] = na[from * 3] as number; na[to * 3 + 1] = na[from * 3 + 1] as number; na[to * 3 + 2] = na[from * 3 + 2] as number;
        ua[to * 2] = ua[from * 2] as number; ua[to * 2 + 1] = ua[from * 2 + 1] as number;
        ca[to * 3] = ca[from * 3] as number; ca[to * 3 + 1] = ca[from * 3 + 1] as number; ca[to * 3 + 2] = ca[from * 3 + 2] as number;
        if (da) da[to] = da[from] as number;
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    uv.needsUpdate = true;
    col.needsUpdate = true;
    if (dep) dep.needsUpdate = true;
    if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
    if (wet && sea && sea.level > hi) hi = sea.level;
    lo -= drop;
    const sphere = t.geo.boundingSphere as THREE.Sphere;
    sphere.center.set(t.x0 + t.size / 2, (lo + hi) / 2, t.z0 + t.size / 2);
    sphere.radius = Math.hypot(t.size * Math.SQRT1_2, (hi - lo) / 2);
    t.wet = wet;
    t.state = 2;
  }

  /** Whether a made tile lies over one that is drawn but on its way out: such a tile waits for the swap. */
  function overStale(t: Tile): boolean {
    for (const o of tiles.values()) {
      if (!o.shown || desired.has(o.key)) continue;
      if (t.x0 < o.x0 + o.size && t.x0 + t.size > o.x0 && t.z0 < o.z0 + o.size && t.z0 + t.size > o.z0) return true;
    }
    return false;
  }

  let fx = 0;
  let fz = 0;
  function collect(level: number, ix: number, iz: number): void {
    const size = sizes[level] as number;
    const x0 = ox + ix * size;
    const z0 = oz + iz * size;
    if (level > 0) {
      const d = Math.hypot(Math.max(x0 - fx, 0, fx - x0 - size), Math.max(z0 - fz, 0, fz - z0 - size));
      // The place itself is always met by cells small enough to fit round it.
      const forced = size / N > coreCell && x0 < core.maxX && x0 + size > core.minX && z0 < core.maxZ && z0 + size > core.minZ;
      if (d < size || forced) {
        for (let a = 0; a < 4; a++) collect(level - 1, 2 * ix + (a & 1), 2 * iz + (a >> 1));
        return;
      }
    }
    desired.add(keyOf(level, ix, iz));
  }

  function reconfigure(x: number, z: number): void {
    fx = x;
    fz = z;
    lastX = x;
    lastZ = z;
    starved = false;
    desired.clear();
    const rx = Math.floor((x - ox) / rootSize);
    const rz = Math.floor((z - oz) / rootSize);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) collect(LEVELS - 1, rx + i, rz + j);
    // What is neither wanted nor drawn goes back first, so the pool has it to give; then tiles are taken for what is new.
    for (const t of tiles.values()) if (!desired.has(t.key) && !t.shown) release(t);
    for (const key of desired) {
      if (tiles.has(key)) continue;
      const t = free.pop() ?? (created < poolCap ? createTile() : null);
      if (!t) { starved = true; break; }
      t.key = key;
      t.level = Math.floor(key / 4294967296);
      t.ix = (Math.floor(key / 65536) % 65536) - 32768;
      t.iz = (key % 65536) - 32768;
      t.size = sizes[t.level] as number;
      t.x0 = ox + t.ix * t.size;
      t.z0 = oz + t.iz * t.size;
      t.state = 1;
      t.shown = false;
      tiles.set(key, t);
    }
    queue.length = 0;
    queueAt = 0;
    for (const t of tiles.values()) if (t.state === 1) queue.push(t);
    queue.sort((p, q) => p.level - q.level);
    pendingSwap = true;
  }

  function swap(): void {
    for (const t of tiles.values()) {
      if (desired.has(t.key)) { if (t.state === 2 && !t.shown) show(t, true); } else release(t);
    }
    pendingSwap = false;
    if (!active) activate();
  }

  /** Makes ground until `deadline`. True while there is more to make. */
  function workTiles(deadline: number): boolean {
    for (;;) {
      if (!current) {
        while (queueAt < queue.length && (queue[queueAt] as Tile).state !== 1) queueAt++;
        if (queueAt >= queue.length) {
          if (pendingSwap) swap();
          return false;
        }
        current = queue[queueAt++] as Tile;
        rowAt = 0;
      }
      const t = current;
      const s = t.size / N;
      while (rowAt < W) {
        const z = t.z0 + (rowAt - 1) * s;
        const o = rowAt * W;
        for (let i = 0; i < W; i++) hs[o + i] = H(t.x0 + (i - 1) * s, z);
        rowAt++;
        if (now() >= deadline && rowAt < W) return true;
      }
      finish(t);
      current = null;
      if (active && !overStale(t)) show(t, true);
      if (now() >= deadline) return true;
    }
  }

  // ---- First use ------------------------------------------------------------------------------------------
  function make(): void {
    made = true;
    index = makeIndex();
    if (sea && inp.waterCovered) {
      const look = waterLook(sea.kind);
      inp.tintWater?.(sea.kind, look);
      seaMat = waterMaterial(look, { level: sea.level, hole: inp.waterCovered });
      ownMats.push(seaMat);
    }
    // Where the far land lies, for the things that are set on the horizon.
    let sum = 0;
    const far = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 900;
    for (let k = 0; k < 12; k++) sum += H(hcx + Math.cos(k * 0.5236) * far, hcz + Math.sin(k * 0.5236) * far);
    farLevel = sum / 12;
    if (sea && sea.level > farLevel) farLevel = sea.level;

    // The place's ground, cut back to the core, and a skirt round the cut.
    fullGeo = inp.terrain.geometry;
    const cg = new THREE.BufferGeometry();
    for (const name of Object.keys(fullGeo.attributes)) cg.setAttribute(name, fullGeo.getAttribute(name));
    const idx = new Uint32Array((i1 - i0) * (j1 - j0) * 6);
    let n = 0;
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const a = j * gnx + i;
        idx[n++] = a; idx[n++] = a + gnx; idx[n++] = a + 1;
        idx[n++] = a + 1; idx[n++] = a + gnx; idx[n++] = a + gnx + 1;
      }
    }
    cg.setIndex(new THREE.BufferAttribute(idx, 1));
    cg.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((core.minX + core.maxX) / 2, 0, (core.minZ + core.maxZ) / 2), Math.hypot(core.maxX - core.minX, core.maxZ - core.minZ) / 2 + 60,
    );
    coreGeo = cg;
    geos.push(cg);

    const rim: number[] = [];
    for (let i = i0; i <= i1; i++) rim.push(j0 * gnx + i);
    for (let j = j0 + 1; j <= j1; j++) rim.push(j * gnx + i1);
    for (let i = i1 - 1; i >= i0; i--) rim.push(j1 * gnx + i);
    for (let j = j1 - 1; j >= j0; j--) rim.push(j * gnx + i0);
    const tCol = fullGeo.getAttribute('color');
    const tNor = fullGeo.getAttribute('normal');
    const sp = new Float32Array(rim.length * 6);
    const sn = new Float32Array(rim.length * 6);
    const su = new Float32Array(rim.length * 4);
    const sc = new Float32Array(rim.length * 6);
    const si: number[] = [];
    rim.forEach((v, k) => {
      for (let d = 0; d < 2; d++) {
        const o = k * 2 + d;
        sp[o * 3] = tPos.getX(v); sp[o * 3 + 1] = tPos.getY(v) - d * 8; sp[o * 3 + 2] = tPos.getZ(v);
        sn[o * 3] = tNor ? tNor.getX(v) : 0; sn[o * 3 + 1] = tNor ? tNor.getY(v) : 1; sn[o * 3 + 2] = tNor ? tNor.getZ(v) : 0;
        su[o * 2] = tPos.getX(v); su[o * 2 + 1] = tPos.getZ(v);
        sc[o * 3] = tCol ? tCol.getX(v) : 1; sc[o * 3 + 1] = tCol ? tCol.getY(v) : 1; sc[o * 3 + 2] = tCol ? tCol.getZ(v) : 1;
      }
      if (k + 1 < rim.length) {
        const a = k * 2;
        si.push(a, a + 2, a + 1, a + 2, a + 3, a + 1, a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('normal', new THREE.BufferAttribute(sn, 3));
    sg.setAttribute('uv', new THREE.BufferAttribute(su, 2));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    sg.setIndex(si);
    sg.computeBoundingSphere();
    geos.push(sg);
    coreSkirt = new THREE.Mesh(sg, inp.groundMaterial);
    coreSkirt.name = 'terrain-skirt';
    coreSkirt.matrixAutoUpdate = false;
    coreSkirt.visible = false;
    group.add(coreSkirt);

    // Past the last tile: a level apron out to the end of sight, under the fog.
    const SEG = 48;
    const ag = new THREE.BufferGeometry();
    const ap = new THREE.BufferAttribute(new Float32Array(SEG * 2 * 3), 3);
    ap.setUsage(THREE.DynamicDrawUsage);
    const au = new THREE.BufferAttribute(new Float32Array(SEG * 2 * 2), 2);
    au.setUsage(THREE.DynamicDrawUsage);
    const an = new Float32Array(SEG * 2 * 3);
    for (let i = 0; i < SEG * 2; i++) an[i * 3 + 1] = 1;
    const ai: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      const c = ((i + 1) % SEG) * 2;
      ai.push(a, c, a + 1, c, c + 1, a + 1);
    }
    ag.setAttribute('position', ap);
    ag.setAttribute('uv', au);
    ag.setAttribute('normal', new THREE.BufferAttribute(an, 3));
    ag.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SEG * 2 * 3).fill(0.9), 3));
    ag.setAttribute('waterDepth', new THREE.BufferAttribute(new Float32Array(SEG * 2).fill(40), 1));
    ag.setIndex(ai);
    geos.push(ag);
    apron = new THREE.Mesh(ag, inp.groundMaterial);
    apron.name = 'terrain-apron';
    apron.matrixAutoUpdate = false;
    apron.frustumCulled = false;
    apron.visible = false;
    group.add(apron);
    if (sea && seaMat && sea.body.area.shape === 'outside') {
      seaApron = new THREE.Mesh(ag, seaMat);
      seaApron.name = `water-apron:${sea.kind}`;
      seaApron.matrixAutoUpdate = false;
      seaApron.frustumCulled = false;
      seaApron.renderOrder = 3;
      seaApron.visible = false;
      group.add(seaApron);
    }
    makeLife();
  }

  function placeApron(x: number, z: number): void {
    if (!apron) return;
    const ax = Math.round(x / 64) * 64;
    const az = Math.round(z / 64) * 64;
    if (ax === apronX && az === apronZ) return;
    apronX = ax;
    apronZ = az;
    const pos = apron.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = apron.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const n = pos.count / 2;
    const r0 = rootSize * 0.85;
    const r1 = 5600;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      for (let d = 0; d < 2; d++) {
        const r = d === 0 ? r0 : r1;
        const px = ax + Math.cos(a) * r;
        const pz = az + Math.sin(a) * r;
        pos.setXYZ(i * 2 + d, px, farLevel - 30, pz);
        uv.setXY(i * 2 + d, px, pz);
      }
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
  }

  function placeHorizon(x: number, z: number): void {
    // The ring keeps its shape and its place in the view: enlarged about its middle, carried with the focus.
    const F = horizonF;
    for (const m of inp.horizon.meshes) {
      m.matrix.makeScale(F, F, F).setPosition(x - F * hcx, farLevel - 6 * F - F * inp.horizon.baseY, z - F * hcz);
      m.matrixWorldNeedsUpdate = true;
    }
  }

  function activate(): void {
    active = true;
    if (coreGeo) inp.terrain.geometry = coreGeo;
    if (coreSkirt) coreSkirt.visible = true;
    if (apron) apron.visible = true;
    if (seaApron) seaApron.visible = true;
    for (const f of inp.horizon.fog) f.value = 1 / horizonF;
    for (const m of inp.horizon.meshes) m.frustumCulled = false;
  }

  // ---- What stands on the far land ------------------------------------------------------------------------
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const vPos = new THREE.Vector3();
  const vScl = new THREE.Vector3();
  const far = (x: number, z: number): number => outsideDistance(b, x, z);
  const wetAt = (x: number, z: number): boolean => land.waterDepthAt(x, z) > 0.1;

  function makeLife(): void {
    const life = inp.life;
    const groundC = new THREE.Color(inp.groundHex);
    const stoneMat = new THREE.MeshStandardMaterial({ color: groundC.clone().lerp(new THREE.Color('#77736c'), 0.55).multiplyScalar(0.85), roughness: 0.96, flatShading: true });
    ownMats.push(stoneMat);
    // A standing stone: a block with every corner pushed about, one unit tall, foot on the ground.
    const sg0 = new THREE.DodecahedronGeometry(0.62, 0);
    const stoneGeo = sg0.index ? sg0.toNonIndexed() : sg0;
    if (stoneGeo !== sg0) sg0.dispose();
    const sp = stoneGeo.getAttribute('position');
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i); const y = sp.getY(i); const z = sp.getZ(i);
      const k = 0.8 + 0.4 * hash2(Math.round(x * 97) + Math.round(y * 57), Math.round(z * 89) + Math.round(y * 31), seed + 5);
      sp.setXYZ(i, x * k * 0.8, clamp(y * 0.8 + 0.5, 0, 1), z * k * 0.8);
    }
    stoneGeo.computeVertexNormals();
    geos.push(stoneGeo);

    // The world's props as models, built once each.
    interface Kind { kind: PropBlueprint; meshes: THREE.Mesh[]; tris: number; weight: number; foot: number; tall: boolean; height: number }
    const kinds: Kind[] = [];
    const rng0 = makeRng(seed, 'far-life');
    if (life) {
      const tallSet = new Set(backdropKinds(life.props));
      for (const k of life.props) {
        if (k.parts.length === 0) continue;
        const pr = propProfile(k);
        if (pr.glowY !== null || pr.height < 0.6) continue;
        const model = new GeoBatch();
        addPropParts(k.parts, k.size, life.style, { x: 0, z: 0, rotY: 0, scale: 1 }, { batch: model, mats: life.mats, rng: rng0 }, k.nature ? { nature: k.nature } : undefined);
        const meshes = model.build();
        for (const m of meshes) geos.push(m.geometry);
        if (meshes.length === 0) continue;
        kinds.push({
          kind: k, meshes, tris: meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0),
          weight: clamp(Number.isFinite(k.weight) ? k.weight : 1, 1, 5), foot: propFoot(k), tall: tallSet.has(k), height: pr.height,
        });
      }
    }
    const shadows = quality > 0;

    // Scattered props, a chunk at a time.
    if (life && kinds.length > 0) {
      const unit = (v: number, d: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : d);
      const wild = unit(life.wild, 0.3);
      const settled = unit(life.settled, 0.7);
      const span = quality === 2 ? 10 : quality === 1 ? 8 : 6;
      const slots = span * span;
      const perChunk = clamp((0.003 + 0.02 * wild ** 0.8) * (1 - 0.8 * settled) * ([0.35, 0.6, 1][quality] as number) * VEG_CHUNK * VEG_CHUNK, 0, 120);
      const wSum = kinds.reduce((n, k) => n + k.weight, 0);
      let caps = kinds.map((k) => Math.ceil((perChunk * k.weight * 1.4) / wSum));
      const budget = quality === 2 ? 600000 : quality === 1 ? 300000 : 110000;
      const cost = caps.reduce((n, c, i) => n + c * (kinds[i] as Kind).tris, 0) * slots * 0.7;
      if (cost > budget) caps = caps.map((c) => Math.max(1, Math.floor((c * budget) / cost)));
      const total = caps.reduce((a, c) => a + c, 0);
      const fill = Math.min(1, budget / Math.max(1, cost));
      const layers: WindowLayer[] = [];
      const first: number[] = [];
      kinds.forEach((k, i) => {
        first.push(layers.length);
        for (const m of k.meshes) {
          const im = windowMesh(m.geometry, m.material, slots * (caps[i] as number), `far:${k.kind.kind}`, false);
          im.castShadow = shadows;
          im.receiveShadow = true;
          layers.push({ mesh: im, cap: caps[i] as number });
          group.add(im);
        }
      });
      vegCap = total;
      vegSolids = new Float32Array(slots * total * 3);
      vegSolidN = new Int32Array(slots);
      const weights = kinds.map((k) => k.weight);
      veg = new InstanceWindow(VEG_CHUNK, span, layers, (cx, cz, win) => {
        const slot = win.slot;
        vegSolidN[slot] = 0;
        const x0 = cx * VEG_CHUNK;
        const z0 = cz * VEG_CHUNK;
        if (far(x0 + VEG_CHUNK / 2, z0 + VEG_CHUNK / 2) + VEG_CHUNK * Math.SQRT1_2 <= inp.clear) return;
        const rng = makeRng(seed, `far-life|${cx}|${cz}`);
        // Growth comes in stands that pay no heed to chunk lines. Two slow fields are read at the spot itself:
        // one says where the tall growth gathers into groves and leaves clearings, the other where the low
        // things (rocks, scrub) lie in fields. A few loners stand anywhere, and crests are left bare.
        const count = Math.round(perChunk * fill * 1.25);
        let ns = 0;
        for (let n = 0; n < count; n++) {
          const x = x0 + rng.next() * VEG_CHUNK;
          const z = z0 + rng.next() * VEG_CHUNK;
          const ki = pickIndex(weights, rng);
          const k = kinds[ki] as Kind;
          let s = rng.range(0.8, 1.3) * (k.tall && rng.chance(0.15) ? 1.5 : 1);
          const yaw = rng.range(0, Math.PI * 2);
          const u = rng.next();
          if (far(x, z) < inp.clear || inp.built?.(x, z)) continue;
          const grove = fbm(x / 85, z / 85, seed + 211, 3);
          const stand = k.tall
            ? smoothstep(0.42, 0.6, grove)
            : Math.max(0.35 * smoothstep(0.4, 0.58, grove), smoothstep(0.5, 0.66, fbm(x / 60 + 31, z / 60, seed + 223, 3)));
          const dens = 0.04 + 0.96 * stand;
          if (u >= dens || wetAt(x, z)) continue;
          const crest = H(x, z) - (H(x + 7, z) + H(x - 7, z) + H(x, z + 7) + H(x, z - 7)) / 4;
          if (crest > 0.5 && u >= dens * (k.tall ? 0.2 : 0.6)) continue;
          // Tall growth is at its tallest in the heart of a grove and stunted at its edge.
          if (k.tall) s *= 0.8 + 0.45 * smoothstep(0.45, 0.7, grove);
          const y = surfaceAt(x, z) - 0.12 * s;
          let ok = true;
          const l0 = first[ki] as number;
          for (let m = 0; m < k.meshes.length; m++) ok = win.put(l0 + m, x, y, z, yaw, 0, 0, s, s, s) && ok;
          const r = 0.5 * k.foot * s;
          if (ok && r >= 0.2 && ns < total) {
            const o = (slot * total + ns) * 3;
            vegSolids[o] = x; vegSolids[o + 1] = z; vegSolids[o + 2] = Math.min(2.2, r);
            ns++;
          }
        }
        vegSolidN[slot] = ns;
      });
    }

    // Places of interest: few, so they are simply laid out again whenever the walker enters a new cell.
    const cells = PLACE_SPAN * PLACE_SPAN;
    const model = (list: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[], cap: number, name: string): Model => {
      const meshes = list.map((m) => {
        const im = new THREE.InstancedMesh(m.geometry, m.material, cap);
        im.name = name;
        im.count = 0;
        im.visible = false;
        im.frustumCulled = false;
        im.matrixAutoUpdate = false;
        im.castShadow = true;
        im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        group.add(im);
        return im;
      });
      return { meshes, n: 0, cap };
    };
    const stones = model([{ geometry: stoneGeo, material: stoneMat }], cells * 12, 'place:stone');
    const kindModels = kinds.map((k) => model(k.meshes, cells * 8, `place:${k.kind.kind}`));
    const fp = GROWN_FOOTPRINTS.medium;
    const builds: Model[] = [];
    if (life) {
      for (const bp of life.blueprints.slice(0, 3)) {
        const batch = new GeoBatch();
        addBlueprint(bp, life.style, { x: 0, z: 0, rotY: 0, w: fp.w, d: fp.d }, { batch, mats: life.mats, rng: rng0 }, { dress: false });
        const meshes = batch.build();
        for (const m of meshes) geos.push(m.geometry);
        if (meshes.length > 0) builds.push(model(meshes, cells, `place:${bp.id}`));
      }
    }
    const all = [stones, ...kindModels, ...builds];
    const put = (m: Model, x: number, y: number, z: number, yaw: number, tilt: number, sx: number, sy: number, sz: number): void => {
      if (m.n >= m.cap) return;
      euler.set(tilt, yaw, tilt * 0.5, 'YXZ');
      m4.compose(vPos.set(x, y, z), quat.setFromEuler(euler), vScl.set(sx, sy, sz));
      for (const im of m.meshes) im.setMatrixAt(m.n, m4);
      m.n++;
    };
    const solid = (x: number, z: number, r: number): void => {
      if (placeSolidN >= placeSolids.length / 3 || r < 0.2) return;
      placeSolids[placeSolidN * 3] = x; placeSolids[placeSolidN * 3 + 1] = z; placeSolids[placeSolidN * 3 + 2] = r;
      placeSolidN++;
    };
    const stone = (x: number, z: number, yaw: number, w: number, h: number, d: number, tilt: number): void => {
      put(stones, x, surfaceAt(x, z) - 0.08 * h, z, yaw, tilt, w, h, d);
      solid(x, z, 0.45 * Math.max(w, d));
    };
    const tallKinds = kinds.map((k, i) => (k.tall ? i : -1)).filter((i) => i >= 0);
    const lowKinds = kinds.map((k, i) => (k.height < 4 ? i : -1)).filter((i) => i >= 0);
    const options: ('stones' | 'arch' | 'tree' | 'camp' | 'ruin')[] = ['stones', 'arch'];
    if (tallKinds.length > 0) options.push('tree', 'tree');
    if (kinds.length > 0) options.push('camp');
    if (builds.length > 0) options.push('ruin', 'ruin');
    const keepOut = Math.max(inp.clear + 20, 140);

    rebuildPlaces = (): void => {
      for (const m of all) m.n = 0;
      placeSolidN = 0;
      places = 0;
      for (let cj = 0; cj < PLACE_SPAN; cj++) {
        for (let ci = 0; ci < PLACE_SPAN; ci++) {
          const px = placeX - 2 + ci;
          const pz = placeZ - 2 + cj;
          const rng = makeRng(seed, `place|${px}|${pz}`);
          if (!rng.chance(0.72)) continue;
          let x = 0;
          let z = 0;
          let found = false;
          for (let t = 0; t < 4 && !found; t++) {
            x = (px + rng.range(0.15, 0.85)) * PLACE_CELL;
            z = (pz + rng.range(0.15, 0.85)) * PLACE_CELL;
            const h = surfaceAt(x, z);
            found = far(x, z) > keepOut && !inp.built?.(x, z) && !wetAt(x, z) && !wetAt(x + 6, z) && !wetAt(x - 6, z) && !wetAt(x, z + 6) && !wetAt(x, z - 6)
              && Math.abs(surfaceAt(x + 5, z) - h) < 2.5 && Math.abs(surfaceAt(x - 5, z) - h) < 2.5
              && Math.abs(surfaceAt(x, z + 5) - h) < 2.5 && Math.abs(surfaceAt(x, z - 5) - h) < 2.5;
          }
          if (!found) continue;
          places++;
          const what = rng.pick(options);
          const turn = rng.range(0, Math.PI * 2);
          if (what === 'stones') {
            // A ring of standing stones, one or two fallen.
            const n = rng.int(5, 9);
            const R = rng.range(4, 7);
            for (let k = 0; k < n; k++) {
              const a = turn + (k / n) * Math.PI * 2;
              const fallen = rng.chance(0.15);
              stone(x + Math.cos(a) * R, z + Math.sin(a) * R, -a + rng.range(-0.3, 0.3), rng.range(0.9, 1.6), fallen ? rng.range(0.6, 0.9) : rng.range(2, 4.6), fallen ? rng.range(2.2, 3.4) : rng.range(0.7, 1.2), rng.range(-0.08, 0.08));
            }
          } else if (what === 'arch') {
            // Two piers and a slab across them.
            const ux = Math.cos(turn);
            const uz = Math.sin(turn);
            const tall = rng.range(3.6, 5.2);
            const y = Math.min(surfaceAt(x + ux * 2.2, z + uz * 2.2), surfaceAt(x - ux * 2.2, z - uz * 2.2));
            for (const side of [-1, 1]) {
              put(stones, x + ux * 2.2 * side, y - 0.4, z + uz * 2.2 * side, -turn + rng.range(-0.2, 0.2), 0, 1.5, tall + 0.4, 1.4);
              solid(x + ux * 2.2 * side, z + uz * 2.2 * side, 0.8);
            }
            put(stones, x, y + tall - 0.35, z, -turn, rng.range(-0.03, 0.03), 6.6, 1.1, 1.7);
            for (let k = rng.int(1, 3); k > 0; k--) stone(x + rng.range(-7, 7), z + rng.range(-7, 7), rng.range(0, 6.28), rng.range(0.8, 1.6), rng.range(0.5, 1.1), rng.range(0.8, 1.6), rng.range(-0.2, 0.2));
          } else if (what === 'tree') {
            // One giant of the world's own growth, with a few of ordinary size in its shelter.
            const gi = rng.pick(tallKinds);
            const g = kinds[gi] as Kind;
            const s = rng.range(2.4, 3.4);
            put(kindModels[gi] as Model, x, surfaceAt(x, z) - 0.2 * s, z, turn, 0, s, s, s);
            solid(x, z, Math.min(3, 0.5 * g.foot * s));
            for (let k = rng.int(3, 6); k > 0; k--) {
              const a = rng.range(0, Math.PI * 2);
              const d = rng.range(6, 14);
              const ki = rng.int(0, kinds.length - 1);
              const q = rng.range(0.8, 1.2);
              const qx = x + Math.cos(a) * d;
              const qz = z + Math.sin(a) * d;
              if (wetAt(qx, qz)) continue;
              put(kindModels[ki] as Model, qx, surfaceAt(qx, qz) - 0.1, qz, a, 0, q, q, q);
              solid(qx, qz, Math.min(2.2, 0.5 * (kinds[ki] as Kind).foot * q));
            }
          } else if (what === 'camp') {
            // A few of the world's things drawn up round a hearth of stones.
            const pool = lowKinds.length > 0 ? lowKinds : kinds.map((_, i) => i);
            const n = rng.int(4, 7);
            const R = rng.range(2.8, 4.6);
            for (let k = 0; k < n; k++) {
              const a = turn + (k / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
              const ki = rng.pick(pool);
              const qx = x + Math.cos(a) * R;
              const qz = z + Math.sin(a) * R;
              put(kindModels[ki] as Model, qx, surfaceAt(qx, qz) - 0.05, qz, -a + Math.PI / 2, 0, 1, 1, 1);
              solid(qx, qz, Math.min(2, 0.5 * (kinds[ki] as Kind).foot));
            }
            for (let k = 0; k < 5; k++) {
              const a = (k / 5) * Math.PI * 2;
              put(stones, x + Math.cos(a) * 0.7, surfaceAt(x, z) - 0.08, z + Math.sin(a) * 0.7, a, 0, 0.5, 0.32, 0.45);
            }
            solid(x, z, 0.8);
          } else {
            // A lone building of the world's own make, settled into the ground and leaning, stones fallen round it.
            const m = rng.pick(builds);
            const lean = rng.range(0.025, 0.06) * (rng.chance(0.5) ? 1 : -1);
            put(m, x, surfaceAt(x, z) - rng.range(0.3, 0.7), z, turn, lean, 1, 1, 1);
            solid(x, z, Math.min(fp.w, fp.d) * 0.5);
            for (let k = rng.int(2, 4); k > 0; k--) {
              const a = rng.range(0, Math.PI * 2);
              const d = rng.range(7.5, 11);
              stone(x + Math.cos(a) * d, z + Math.sin(a) * d, a, rng.range(0.8, 1.5), rng.range(0.5, 1.4), rng.range(0.8, 1.5), rng.range(-0.25, 0.25));
            }
          }
        }
      }
      for (const m of all) {
        for (const im of m.meshes) {
          im.count = m.n;
          im.visible = m.n > 0;
          im.instanceMatrix.needsUpdate = true;
        }
      }
    };
  }

  function pickIndex(weights: readonly number[], rng: Rng): number {
    let total = 0;
    for (const w of weights) total += w;
    let t = rng.next() * total;
    for (let i = 0; i < weights.length; i++) {
      t -= weights[i] as number;
      if (t <= 0) return i;
    }
    return weights.length - 1;
  }

  const push = (p: { x: number; z: number }, sx: number, sz: number, r: number): void => {
    const dx = p.x - sx;
    const dz = p.z - sz;
    const reach = r + WALKER;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) return;
    const d = Math.sqrt(d2);
    if (d < 1e-4) { p.x = sx + reach; return; }
    p.x = sx + (dx / d) * reach;
    p.z = sz + (dz / d) * reach;
  };

  return {
    group, core, surfaceAt,
    pushOut(p: { x: number; z: number }): void {
      if (disposed || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
      const st = inp.solids;
      if (st && outsideDistance(b, p.x, p.z) < 135) for (let i = 0; i + 2 < st.length; i += 3) push(p, st[i] as number, st[i + 1] as number, st[i + 2] as number);
      if (veg) {
        // The chunk underfoot and whichever neighbours lie within a trunk's reach: at most four, each once.
        const px = p.x;
        const pz = p.z;
        let s1 = -1;
        let s2 = -1;
        let s3 = -1;
        for (let q = 0; q < 4; q++) {
          const slot = veg.slotAt(px + (q & 1 ? 3 : -3), pz + (q & 2 ? 3 : -3));
          if (slot < 0 || slot === s1 || slot === s2 || slot === s3) continue;
          s3 = s2; s2 = s1; s1 = slot;
          const n = vegSolidN[slot] ?? 0;
          for (let k = 0; k < n; k++) {
            const o = (slot * vegCap + k) * 3;
            push(p, vegSolids[o] as number, vegSolids[o + 1] as number, vegSolids[o + 2] as number);
          }
        }
      }
      for (let k = 0; k < placeSolidN; k++) push(p, placeSolids[k * 3] as number, placeSolids[k * 3 + 1] as number, placeSolids[k * 3 + 2] as number);
    },
    update(focus: THREE.Vector3, dt: number): void {
      void dt;
      if (disposed || !Number.isFinite(focus.x) || !Number.isFinite(focus.z)) return;
      if (!made) make();
      const x = focus.x;
      const z = focus.z;
      if (starved || !(Math.hypot(x - lastX, z - lastZ) < T0 / 8)) reconfigure(x, z);
      inp.scatter?.retarget(x, z);
      veg?.retarget(x, z);
      const pcx = Math.floor(x / PLACE_CELL);
      const pcz = Math.floor(z / PLACE_CELL);
      if (pcx !== placeX || pcz !== placeZ) { placeX = pcx; placeZ = pcz; placesDirty = true; }

      // Ground first, then what stands on it, all inside the frame's share of time. The first ground is hurried.
      const deadline = now() + (active ? budgetMs : budgetMs * 3);
      const more = workTiles(deadline);
      if (!more) {
        if (placesDirty && rebuildPlaces) { placesDirty = false; rebuildPlaces(); }
        let any = true;
        while (any && now() < deadline) {
          any = false;
          if (veg?.pending()) { veg.work(); any = true; }
          if (inp.scatter?.pending()) { inp.scatter.work(); any = true; }
        }
      }
      if (active) {
        placeHorizon(x, z);
        placeApron(x, z);
      }
    },
    stats(): EndlessStats {
      let shown = 0;
      for (const t of tiles.values()) if (t.shown) shown++;
      let queued = 0;
      for (const t of tiles.values()) if (t.state === 1) queued++;
      return {
        active, shown, held: tiles.size, created, poolCap, queued,
        propCapacity: veg ? veg.capacity : 0, scatterCapacity: inp.scatter ? inp.scatter.capacity : 0,
        propChunks: veg ? veg.recycles : 0, places, core, cells: N,
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (active && fullGeo) inp.terrain.geometry = fullGeo;
      for (const f of inp.horizon.fog) f.value = 1;
      group.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
      for (const g of geos) g.dispose();
      for (const m of ownMats) m.dispose();
      geos.length = 0;
      tiles.clear();
      desired.clear();
      free.length = 0;
      queue.length = 0;
      current = null;
      veg = null;
      rebuildPlaces = null;
      group.clear();
    },
  };
}
