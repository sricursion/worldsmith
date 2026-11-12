// The fabric of a place as geometry (see fabric.ts for the plan).
//
//   - addInnerFabric: the lots that belong to the place itself, built like its named buildings into the same
//     merged batches, so they are solid to the navmesh and the camera.
//   - createFabricStream: the blocks of a town or city beyond the place, made around the walker as they go.
//     Every kind of building is a model built once and drawn instanced. Blocks next to the walker are drawn
//     from the detailed models; blocks further out from a plain massing of the same kind (a few boxes, a grid of
//     windows that light at night); beyond that only what stands tall enough to be seen over the roofs. Nothing
//     out here is on the navmesh: a walker is kept out of the lots by pushOut, as on the open land.
//
// Budgets at quality 2 / 1 / 0, for the stream alone: detailed blocks within 2 / 1 / 1 blocks of the walker,
// massing within 7 / 5 / 3, skyline within 18 / 12 / 0. At quality 2 in a metropolis that comes to some 150 to
// 250 detailed buildings, 1,700 to 2,800 massings and 800 to 1,500 skyline towers: 0.8 to 1.4 million triangles,
// in one draw call per material of each kind near (about 100) and one per kind far (up to 14). Detailed blocks
// cast shadows at quality 2 only; massing never does.
import * as THREE from 'three';
import { expandParts } from '../world/blueprints';
import { makeRng } from '../world/rng';
import type { ScaleProfile } from '../world/scale';
import type { BlueprintPart, PartTone, PropBlueprint, StyleSpec } from '../world/spec';
import { GeoBatch } from './batch';
import type { MaterialCache } from './batch';
import { addBlueprint, addPropParts } from './blueprint-mesh';
import type { BlueprintEnv } from './blueprint-mesh';
import { MAX_FABRIC_HEIGHT, blockLots, blockOf, fabricPresence, lotRect, stretchTo } from './fabric';
import type { FabricGrid, FabricKind, FabricLot, Rect } from './fabric';
import { propProfile } from './props';
import type { Quality } from './terrain';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** How far a foundation carries on below the lowest ground under a lot, metres. */
const SKIRT = 2.5;

/**
 * Builds the lots of the place itself. `seated` runs its callback with everything added standing at the land's
 * height at that point. Returns the footprints for whoever needs to keep off them.
 */
export function addInnerFabric(
  lots: readonly FabricLot[], kinds: readonly FabricKind[], style: StyleSpec, env: BlueprintEnv,
  seated: <T>(x: number, z: number, fn: () => T) => T, opts: { skirt: number },
): Rect[] {
  const rects: Rect[] = [];
  for (const lot of lots) {
    const k = kinds[lot.kind];
    if (!k) continue;
    // Its own height is built in, not scaled: storeys and doors keep their size.
    const bp = Math.abs(lot.sy - 1) > 0.02 ? { ...k.bp, parts: stretchTo(k.bp.parts, k.height * lot.sy) } : k.bp;
    seated(lot.x, lot.z, () => addBlueprint(bp, style, { x: lot.x, z: lot.z, rotY: lot.rotY, w: k.fw * lot.sx, d: k.fd * lot.sz }, env, { skirt: opts.skirt, maxHeight: MAX_FABRIC_HEIGHT + 40 }));
    rects.push(lotRect(lot));
  }
  return rects;
}

// ---- Models ------------------------------------------------------------------------------------------------------

/** A grid of windows, one cell to four texels: a pane framed by wall. `lit` is the share of panes with a light on. */
function windowMaps(seed: number, lit: number): { map: THREE.DataTexture; glow: THREE.DataTexture } {
  const CELLS = 16;
  const S = CELLS * 4;
  const a = new Uint8Array(S * S * 4);
  const g = new Uint8Array(S * S * 4);
  const rng = makeRng(seed, 'windows');
  for (let cj = 0; cj < CELLS; cj++) {
    for (let ci = 0; ci < CELLS; ci++) {
      const on = rng.chance(lit);
      const dark = 95 + Math.floor(rng.next() * 40);
      for (let v = 0; v < 4; v++) {
        for (let u = 0; u < 4; u++) {
          const o = ((cj * 4 + v) * S + ci * 4 + u) * 4;
          const pane = u >= 1 && u <= 2 && v >= 1 && v <= 2;
          const k = pane ? dark : 255;
          a[o] = k; a[o + 1] = k; a[o + 2] = k; a[o + 3] = 255;
          const l = pane && on ? 255 : 0;
          g[o] = l; g[o + 1] = l; g[o + 2] = l; g[o + 3] = 255;
        }
      }
    }
  }
  const tex = (data: Uint8Array): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { map: tex(a), glow: tex(g) };
}

/** Most solids a massing is made of. */
const MASSING_PARTS = 9;
const ROUND: ReadonlySet<string> = new Set(['cylinder', 'dome', 'sphere']);
const POINTED: ReadonlySet<string> = new Set(['cone', 'pyramid']);

/** A kind as a few plain solids in one geometry, coloured by tone, with window cells on its broad walls. */
function massing(kind: FabricKind, tones: Record<PartTone, THREE.Color>, windows: boolean): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const m = new THREE.Matrix4();
  const r = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const all = expandParts(kind.bp.parts as BlueprintPart[]);
  // The body and the largest few of the rest: what gives the outline. Everything finer is lost at this distance anyway.
  const volume = (p: BlueprintPart): number => p.w * p.d * p.h;
  const rest = all.slice(1).sort((a, b) => volume(b) - volume(a)).slice(0, MASSING_PARTS - 1);
  const parts = all.length > 0 ? [all[0] as BlueprintPart, ...rest] : [];
  parts.forEach((p, index) => {
    if (p.shape === 'arch' || p.shape === 'ring' || p.tone === 'glow') return;
    const pw = clamp(p.w, 0.002, 1.4) * kind.fw;
    const pd = clamp(p.d, 0.002, 1.4) * kind.fd;
    let ph = p.h;
    let py = p.y;
    // What cannot be told from a street away is left out.
    if (index > 0 && (Math.max(pw, pd) < 0.9 || ph < 0.5 || pw * pd * ph < 2.5)) return;
    if (py < 0.3) { py -= SKIRT; ph += SKIRT; }
    let g: THREE.BufferGeometry;
    const walls = windows && p.shape === 'box' && ph >= 5 && (p.tone === 'wall' || p.tone === 'wall2' || p.tone === 'glass' || p.tone === 'trim');
    if (ROUND.has(p.shape)) g = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).scale(pw, ph, pd);
    else if (POINTED.has(p.shape)) g = new THREE.ConeGeometry(p.shape === 'pyramid' ? Math.SQRT1_2 : 0.5, 1, p.shape === 'pyramid' ? 4 : 8).rotateY(p.shape === 'pyramid' ? Math.PI / 4 : 0).scale(pw, ph, pd);
    else if (p.shape === 'gable' || p.shape === 'wedge') g = new THREE.BoxGeometry(pw, ph * 0.55, pd).translate(0, -ph * 0.225, 0);
    else g = new THREE.BoxGeometry(pw, ph, pd);
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    // The part frame is turned half a revolution, as addBlueprint turns it: blueprint +z is the front, the building faces -Z.
    m.makeRotationY(Math.PI).multiply(r.makeTranslation(clamp(p.x, -0.7, 0.7) * kind.fw, py + ph / 2, clamp(p.z, -0.7, 0.7) * kind.fd)).multiply(r.makeRotationY((p.rot * Math.PI) / 180));
    const P = flat.getAttribute('position');
    const N = flat.getAttribute('normal');
    const U = flat.getAttribute('uv');
    const c = tones[p.tone] ?? tones.wall;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      n.set(N.getX(i), N.getY(i), N.getZ(i));
      const side = Math.abs(n.y) < 0.5;
      // Window cells: about 3.4 m across and a storey high. Roofs and small parts take the plain wall texel.
      const across = Math.abs(n.x) > 0.5 ? pd : pw;
      const u = walls && side ? U.getX(i) * Math.max(1, Math.round(across / 3.4)) : 0.03;
      const w = walls && side ? U.getY(i) * Math.max(1, Math.round(ph / 3.2)) : 0.03;
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(m);
      n.applyMatrix3(nm).normalize();
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      uv.push(u, w);
      // Darker toward the ground, as the detailed walls are.
      const k = 0.82 + 0.18 * smooth(0, 9, v.y);
      col.push(c.r * k, c.g * k, c.b * k);
    }
    flat.dispose();
  });
  if (pos.length === 0) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** One model drawn many times: every mesh of it shares the same instance buffers. */
class Pool {
  meshes: THREE.InstancedMesh[] = [];
  n = 0;
  private cap = 0;
  readonly triangles: number;

  constructor(
    private readonly parts: readonly { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[],
    private readonly group: THREE.Group, private readonly name: string, private readonly shadow: boolean,
  ) {
    this.triangles = parts.reduce((t, p) => t + p.geometry.getAttribute('position').count / 3, 0);
  }

  /** Makes room for `n` instances. Buffers only ever grow. */
  ensure(n: number): void {
    if (n <= this.cap) return;
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.cap = Math.ceil(n * 1.3) + 8;
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 16), 16);
    matrix.setUsage(THREE.DynamicDrawUsage);
    const colour = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3);
    colour.setUsage(THREE.DynamicDrawUsage);
    this.meshes = this.parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, this.cap);
      im.instanceMatrix = matrix;
      im.instanceColor = colour;
      im.name = this.name;
      im.frustumCulled = false;
      im.matrixAutoUpdate = false;
      im.castShadow = this.shadow;
      im.receiveShadow = true;
      im.count = 0;
      im.visible = false;
      this.group.add(im);
      return im;
    });
  }

  put(m: THREE.Matrix4, r: number, g: number, b: number): void {
    const first = this.meshes[0];
    if (!first || this.n >= this.cap) return;
    m.toArray(first.instanceMatrix.array, this.n * 16);
    const c = (first.instanceColor as THREE.InstancedBufferAttribute).array;
    c[this.n * 3] = r; c[this.n * 3 + 1] = g; c[this.n * 3 + 2] = b;
    this.n++;
  }

  end(): void {
    const first = this.meshes[0];
    if (first) {
      first.instanceMatrix.needsUpdate = true;
      if (first.instanceColor) first.instanceColor.needsUpdate = true;
    }
    for (const m of this.meshes) { m.count = this.n; m.visible = this.n > 0; }
  }

  dispose(): void {
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = [];
  }
}

// ---- The stream --------------------------------------------------------------------------------------------------

export interface FabricStreamInput {
  grid: FabricGrid; kinds: readonly FabricKind[]; profile: ScaleProfile; seed: number;
  style: StyleSpec; mats: MaterialCache; quality: Quality;
  /** Height of the ground as drawn, and depth of water standing on it. */
  surfaceAt(x: number, z: number): number;
  waterDepthAt(x: number, z: number): number;
  /** The world's props: the made ones stand along the streets as clutter. */
  props: readonly PropBlueprint[];
  groundHex: string; roadHex: string;
  /** Milliseconds a frame spent planning blocks. Default 2. */
  budgetMs?: number;
}

export interface FabricStats {
  /** Blocks planned and held, and waiting to be planned. */
  blocks: number; pending: number;
  /** Buildings drawn from the detailed models, from massing, and as skyline. */
  near: number; far: number; skyline: number;
  clutter: number;
  triangles: number; drawCalls: number;
  tallest: number;
}

export interface FabricStream {
  group: THREE.Group;
  grid: FabricGrid;
  update(focus: { x: number; z: number }): void;
  /** Moves a point out of any lot it stands in. */
  pushOut(p: { x: number; z: number }): void;
  /** Darkens far ground where a street runs; `cell` is the size of the ground cell being coloured. */
  paint(x: number, z: number, cell: number, rgb: [number, number, number]): void;
  /** True where the fabric stands thick enough that nothing wild should grow or be found. */
  built(x: number, z: number): boolean;
  stats(): FabricStats;
  dispose(): void;
}

interface Block { i: number; j: number; lots: FabricLot[]; ys: Float32Array; rects: Rect[]; clutter: Float32Array }

const WALKER = 0.35;
/** Detailed, massing and skyline reach in blocks, by quality. */
const REACH: readonly [number, number, number][] = [[1, 3, 0], [1, 5, 12], [2, 7, 18]];

export function createFabricStream(inp: FabricStreamInput): FabricStream {
  const { grid, kinds, profile, seed } = inp;
  const group = new THREE.Group();
  group.name = 'fabric';
  const [r0, r1, r2raw] = REACH[inp.quality] as [number, number, number];
  // Only a place with towers has a skyline worth drawing past the massing.
  const r2 = profile.level >= 5 ? Math.max(r1, r2raw) : r1;
  const budgetMs = inp.budgetMs ?? 2;
  const blocks = new Map<string, Block>();
  const pending: [number, number][] = [];
  let pendingAt = 0;
  let ci = Number.NaN;
  let cj = Number.NaN;
  let dirty = false;
  let sinceBuild = 0;
  let made = false;
  let disposed = false;
  let near: (Pool | null)[] = [];
  let far: (Pool | null)[] = [];
  let clutterPools: { pool: Pool; foot: number }[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const ownMats: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const stats: FabricStats = { blocks: 0, pending: 0, near: 0, far: 0, skyline: 0, clutter: 0, triangles: 0, drawCalls: 0, tallest: 0 };

  const ground = new THREE.Color(inp.groundHex);
  const road = new THREE.Color(inp.roadHex);
  const streetK: [number, number, number] = [
    clamp(road.r / Math.max(0.02, ground.r), 0.35, 1.5), clamp(road.g / Math.max(0.02, ground.g), 0.35, 1.5), clamp(road.b / Math.max(0.02, ground.b), 0.35, 1.5),
  ];
  const P = grid.pitch;
  const half = grid.street / 2;
  const inHoleAt = (x: number, z: number, m: number): boolean => x > grid.hole.minX + m && x < grid.hole.maxX - m && z > grid.hole.minZ + m && z < grid.hole.maxZ - m;

  function make(): void {
    made = true;
    const rng = makeRng(seed, 'fabric-models');
    const q: Quality = inp.quality === 2 ? 1 : inp.quality;
    const tones: Record<PartTone, THREE.Color> = {
      wall: new THREE.Color(inp.style.wall), wall2: new THREE.Color(inp.style.wall2), roof: new THREE.Color(inp.style.roof), trim: new THREE.Color(inp.style.trim),
      accent: new THREE.Color(inp.style.accent).lerp(new THREE.Color(inp.style.wall), 0.5), dark: new THREE.Color(inp.style.dark),
      glass: new THREE.Color(inp.style.glass), glow: new THREE.Color(inp.style.glow),
    };
    const maps = windowMaps(seed, 0.14 + 0.3 * profile.density);
    textures.push(maps.map, maps.glow);
    const lit = new THREE.MeshStandardMaterial({
      vertexColors: true, map: maps.map, emissive: new THREE.Color(inp.style.glow), emissiveMap: maps.glow, emissiveIntensity: 0.7, roughness: 0.92,
    });
    const dull = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    ownMats.push(lit, dull);
    near = kinds.map((k, n) => {
      const batch = new GeoBatch();
      addBlueprint(k.bp, inp.style, { x: 0, z: 0, rotY: 0, w: k.fw, d: k.fd }, { batch, mats: inp.mats, rng }, { quality: q, skirt: SKIRT, maxHeight: MAX_FABRIC_HEIGHT + 40 });
      const meshes = batch.build();
      for (const m of meshes) geos.push(m.geometry);
      return meshes.length > 0 ? new Pool(meshes, group, `fabric:${n}`, inp.quality === 2) : null;
    });
    far = kinds.map((k, n) => {
      const g = massing(k, tones, k.role === 'stand');
      if (!g) return null;
      geos.push(g);
      return new Pool([{ geometry: g, material: k.role === 'stand' ? lit : dull }], group, `fabric-far:${n}`, false);
    });
    // Street clutter: the things of this world that somebody made and that stand on the ground.
    for (const k of inp.props) {
      if (k.nature || k.parts.length === 0) continue;
      const pr = propProfile(k);
      if (pr.height < 0.4) continue;
      const batch = new GeoBatch();
      addPropParts(k.parts, k.size, inp.style, { x: 0, z: 0, rotY: 0, scale: 1 }, { batch, mats: inp.mats, rng }, { quality: q });
      const meshes = batch.build();
      for (const m of meshes) geos.push(m.geometry);
      if (meshes.length > 0) clutterPools.push({ pool: new Pool(meshes, group, `clutter:${k.kind}`, false), foot: Math.min(1.6, 0.5 * Math.max(0.4, pr.width)) });
    }
  }

  const keyOf = (i: number, j: number): string => `${i}|${j}`;

  function plan(i: number, j: number): Block {
    const all = blockLots(grid, kinds, profile, seed, i, j);
    const lots: FabricLot[] = [];
    const ys: number[] = [];
    const rects: Rect[] = [];
    for (const l of all) {
      if (inp.waterDepthAt(l.x, l.z) > 0.1) continue;
      const r = lotRect(l);
      if (inp.waterDepthAt(r.minX, r.minZ) > 0.1 || inp.waterDepthAt(r.maxX, r.maxZ) > 0.1 || inp.waterDepthAt(r.minX, r.maxZ) > 0.1 || inp.waterDepthAt(r.maxX, r.minZ) > 0.1) continue;
      // Seated on the highest ground under it: the foundation runs down to cover the rest.
      const y = Math.max(inp.surfaceAt(l.x, l.z), inp.surfaceAt(r.minX, r.minZ), inp.surfaceAt(r.maxX, r.maxZ), inp.surfaceAt(r.minX, r.maxZ), inp.surfaceAt(r.maxX, r.minZ));
      lots.push(l);
      ys.push(y - 0.05);
      rects.push(r);
    }
    // Clutter along this block's own kerbs: more of it the more crowded the place.
    const clutter: number[] = [];
    if (clutterPools.length > 0 && lots.length > 0) {
      const rng = makeRng(seed, `clutter|${i}|${j}`);
      const x0 = grid.x0 + i * P + half;
      const z0 = grid.z0 + j * P + half;
      const side = P - grid.street;
      const count = Math.round((2 + 14 * profile.density + 8 * profile.damage) * fabricPresence(grid, seed, x0 + side / 2, z0 + side / 2));
      for (let n = 0; n < count; n++) {
        const t = rng.range(1.5, side - 1.5);
        const out = rng.range(0.2, 1.0);
        const e = rng.int(0, 3);
        const x = e === 0 ? x0 + t : e === 1 ? x0 + t : e === 2 ? x0 - out : x0 + side + out;
        const z = e === 0 ? z0 - out : e === 1 ? z0 + side + out : z0 + t;
        if (inp.waterDepthAt(x, z) > 0.05) continue;
        clutter.push(x, inp.surfaceAt(x, z) - 0.04, z, rng.range(0, Math.PI * 2), rng.int(0, clutterPools.length - 1), rng.range(0.85, 1.2));
      }
    }
    return { i, j, lots, ys: Float32Array.from(ys), rects, clutter: Float32Array.from(clutter) };
  }

  function retarget(i: number, j: number): void {
    ci = i;
    cj = j;
    dirty = true;
    for (const [key, b] of blocks) if (Math.max(Math.abs(b.i - i), Math.abs(b.j - j)) > r2 + 2) blocks.delete(key);
    pending.length = 0;
    pendingAt = 0;
    for (let dj = -r2; dj <= r2; dj++) for (let di = -r2; di <= r2; di++) if (!blocks.has(keyOf(i + di, j + dj))) pending.push([i + di, j + dj]);
    pending.sort((a, b) => Math.max(Math.abs(a[0] - i), Math.abs(a[1] - j)) - Math.max(Math.abs(b[0] - i), Math.abs(b[1] - j)));
  }

  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function rebuild(): void {
    dirty = false;
    sinceBuild = 0;
    const nNear = new Int32Array(kinds.length);
    const nFar = new Int32Array(kinds.length);
    const nClutter = new Int32Array(clutterPools.length);
    const tierOf = (b: Block): number => { const d = Math.max(Math.abs(b.i - ci), Math.abs(b.j - cj)); return d <= r0 ? 0 : d <= r1 ? 1 : d <= r2 ? 2 : 3; };
    for (const b of blocks.values()) {
      const tier = tierOf(b);
      if (tier > 2) continue;
      for (const l of b.lots) {
        if (tier === 0 && near[l.kind]) nNear[l.kind] = (nNear[l.kind] as number) + 1;
        else if (tier < 2 || l.tall) nFar[l.kind] = (nFar[l.kind] as number) + 1;
      }
      if (tier === 0) for (let c = 4; c < b.clutter.length; c += 6) nClutter[b.clutter[c] as number] = (nClutter[b.clutter[c] as number] as number) + 1;
    }
    near.forEach((p, k) => { if (p) { p.ensure(nNear[k] as number); p.n = 0; } });
    far.forEach((p, k) => { if (p) { p.ensure(nFar[k] as number); p.n = 0; } });
    clutterPools.forEach((c, k) => { c.pool.ensure(nClutter[k] as number); c.pool.n = 0; });
    stats.near = 0; stats.far = 0; stats.skyline = 0; stats.clutter = 0; stats.tallest = 0;
    for (const b of blocks.values()) {
      const tier = tierOf(b);
      if (tier > 2) continue;
      b.lots.forEach((l, n) => {
        const detailed = tier === 0 && near[l.kind];
        if (!detailed && tier === 2 && !l.tall) return;
        const pool = detailed ? near[l.kind] : far[l.kind];
        if (!pool) return;
        m4.compose(pos.set(l.x, b.ys[n] as number, l.z), quat.setFromAxisAngle(UP, l.rotY), scl.set(l.sx, l.sy, l.sz));
        pool.put(m4, l.value * (1 + l.warm), l.value, l.value * (1 - l.warm));
        if (detailed) stats.near++; else if (tier === 1) stats.far++; else stats.skyline++;
        if (l.height > stats.tallest) stats.tallest = l.height;
      });
      if (tier === 0) {
        for (let c = 0; c < b.clutter.length; c += 6) {
          const cp = clutterPools[b.clutter[c + 4] as number];
          if (!cp) continue;
          const s = b.clutter[c + 5] as number;
          m4.compose(pos.set(b.clutter[c] as number, b.clutter[c + 1] as number, b.clutter[c + 2] as number), quat.setFromAxisAngle(UP, b.clutter[c + 3] as number), scl.set(s, s, s));
          cp.pool.put(m4, 1, 1, 1);
          stats.clutter++;
        }
      }
    }
    stats.triangles = 0;
    stats.drawCalls = 0;
    for (const p of [...near, ...far, ...clutterPools.map((c) => c.pool)]) {
      if (!p) continue;
      p.end();
      stats.triangles += p.n * p.triangles;
      if (p.n > 0) stats.drawCalls += p.meshes.length;
    }
  }

  return {
    group, grid,
    update(focus: { x: number; z: number }): void {
      if (disposed || !Number.isFinite(focus.x) || !Number.isFinite(focus.z)) return;
      if (!made) make();
      const at = blockOf(grid, focus.x, focus.z);
      if (at.i !== ci || at.j !== cj) retarget(at.i, at.j);
      const deadline = performance.now() + budgetMs;
      let worked = false;
      while (pendingAt < pending.length && performance.now() < deadline) {
        const [i, j] = pending[pendingAt++] as [number, number];
        blocks.set(keyOf(i, j), plan(i, j));
        worked = true;
      }
      if (worked) dirty = true;
      sinceBuild++;
      // Shown as soon as everything asked for is planned, and every third of a second or so while it is not.
      if (dirty && (pendingAt >= pending.length || sinceBuild > 20)) rebuild();
    },
    pushOut(p: { x: number; z: number }): void {
      if (disposed || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
      const at = blockOf(grid, p.x, p.z);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const b = blocks.get(keyOf(at.i + di, at.j + dj));
          if (!b) continue;
          for (const r of b.rects) {
            const l = p.x - (r.minX - WALKER);
            const rr = r.maxX + WALKER - p.x;
            const n = p.z - (r.minZ - WALKER);
            const f = r.maxZ + WALKER - p.z;
            if (l <= 0 || rr <= 0 || n <= 0 || f <= 0) continue;
            const m = Math.min(l, rr, n, f);
            if (m === l) p.x = r.minX - WALKER; else if (m === rr) p.x = r.maxX + WALKER; else if (m === n) p.z = r.minZ - WALKER; else p.z = r.maxZ + WALKER;
          }
          for (let c = 0; c < b.clutter.length; c += 6) {
            const cp = clutterPools[b.clutter[c + 4] as number];
            if (!cp) continue;
            const reach = cp.foot * (b.clutter[c + 5] as number) + WALKER;
            const dx = p.x - (b.clutter[c] as number);
            const dz = p.z - (b.clutter[c + 2] as number);
            const d2 = dx * dx + dz * dz;
            if (d2 >= reach * reach || d2 < 1e-8) continue;
            const d = Math.sqrt(d2);
            p.x = (b.clutter[c] as number) + (dx / d) * reach;
            p.z = (b.clutter[c + 2] as number) + (dz / d) * reach;
          }
        }
      }
    },
    paint(x: number, z: number, cell: number, rgb: [number, number, number]): void {
      if (inHoleAt(x, z, half)) return;
      const here = fabricPresence(grid, seed, x, z);
      if (here <= 0.02) return;
      const dx = Math.abs(((x - grid.x0) % P + P) % P);
      const dz = Math.abs(((z - grid.z0) % P + P) % P);
      const d = Math.min(dx, P - dx, dz, P - dz);
      // Ground cells too coarse to carry a street take the share of it that streets cover.
      const t = (cell > grid.street * 0.6 ? 1 - (1 - grid.street / P) ** 2 : 1 - smooth(half - 0.6, half + 1.2, d)) * here;
      if (t <= 0) return;
      rgb[0] *= 1 + (streetK[0] - 1) * t;
      rgb[1] *= 1 + (streetK[1] - 1) * t;
      rgb[2] *= 1 + (streetK[2] - 1) * t;
    },
    built(x: number, z: number): boolean {
      return fabricPresence(grid, seed, x, z) > 0.2;
    },
    stats(): FabricStats {
      stats.blocks = blocks.size;
      stats.pending = pending.length - pendingAt;
      return { ...stats };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const p of [...near, ...far, ...clutterPools.map((c) => c.pool)]) p?.dispose();
      for (const g of geos) g.dispose();
      for (const m of ownMats) m.dispose();
      for (const t of textures) t.dispose();
      near = [];
      far = [];
      clutterPools = [];
      blocks.clear();
      pending.length = 0;
      group.clear();
    },
  };
}
