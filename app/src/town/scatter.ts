// Instanced micro-detail between the buildings: grass tufts and wildflowers (crossed quads with a generated
// alpha texture, bent by a shared wind), pebbles and small rocks, and leaves, twigs, litter or snow clumps by
// ground kind. Nothing here collides and nothing goes to the navmesh.
//
// Every layer keeps its instances sorted by 24 m chunk. When the focus crosses an 8 m cell, the chunks within
// reach are copied to the front of the instance buffers and the draw count is set to match, so the GPU only
// ever sees what is near; the vertex shader shrinks instances to nothing over the last stretch before
// SCATTER_FAR so chunks never pop. Views into the master arrays are made once: an update allocates nothing.
import * as THREE from 'three';
import { makeRng } from '../world/rng';
import type { Rng } from '../world/rng';
import type { SurfaceKind } from '../world/spec';
import { buildingAabb, distanceToRoad } from './layout';
import type { TownLayout } from './layout';
import { fbm, hash2, outsideDistance, smoothstep } from './terrain';
import type { Quality } from './terrain';

/** Shared wind. Advance `time` once a frame (seconds); `strength` 0 is still air, 1 a stiff breeze. */
export const WIND = { time: { value: 0 }, strength: { value: 0.4 } };

/** Metres from the focus past which no scatter is drawn. */
export const SCATTER_FAR = 70;
const CHUNK = 24;
const CELL = 8;
const REACH = SCATTER_FAR + CHUNK * Math.SQRT1_2;
const MARGIN = 28;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export type ScatterLayer = 'tufts' | 'flowers' | 'stones' | 'debris';
export type DebrisKind = 'leaf' | 'twig' | 'clump' | 'shard' | 'litter';

/** Instance budget: 4000 on the lowest tier in a bare plaza city, 20000 on the highest in a wilderness. */
export function scatterBudget(quality: Quality, wild: number): number {
  const lo = [4000, 7000, 10000][quality] as number;
  const hi = [6000, 12000, 20000][quality] as number;
  return Math.round(lo + (hi - lo) * clamp(Number.isFinite(wild) ? wild : 0.3, 0, 1));
}

interface Mix { tufts: number; flowers: number; stones: number; debris: number; kind: DebrisKind; paved: boolean }

/** How the budget is shared, by what the ground is made of. */
export function scatterMix(ground: SurfaceKind): Mix {
  switch (ground) {
    case 'grass': return { tufts: 0.62, flowers: 0.1, stones: 0.1, debris: 0.18, kind: 'leaf', paved: false };
    case 'moss': return { tufts: 0.5, flowers: 0.08, stones: 0.12, debris: 0.3, kind: 'leaf', paved: false };
    case 'dirt': return { tufts: 0.45, flowers: 0.03, stones: 0.3, debris: 0.22, kind: 'leaf', paved: false };
    case 'mud': return { tufts: 0.35, flowers: 0, stones: 0.3, debris: 0.35, kind: 'leaf', paved: false };
    case 'sand': return { tufts: 0.25, flowers: 0, stones: 0.6, debris: 0.15, kind: 'twig', paved: false };
    case 'gravel': return { tufts: 0.2, flowers: 0, stones: 0.7, debris: 0.1, kind: 'twig', paved: false };
    case 'snow': case 'ice': return { tufts: 0.12, flowers: 0, stones: 0.2, debris: 0.68, kind: 'clump', paved: false };
    case 'regolith': case 'ash': return { tufts: 0, flowers: 0, stones: 0.7, debris: 0.3, kind: 'shard', paved: false };
    default: return { tufts: 0.18, flowers: 0, stones: 0.24, debris: 0.58, kind: 'litter', paved: true };
  }
}

// ---- Generated textures ------------------------------------------------------------------------------------

/**
 * RGBA texels for a tuft of grass or a clump of flowers, row 0 at the ground. Grass is grey (dark at the root,
 * light at the tip, a darker rib down each blade) so the instance colour sets the hue; flowers have green stems
 * and white petals, so the instance colour reads as the petal colour. Transparent texels keep the blade colour
 * so mip levels do not fringe dark.
 */
export function tuftTexels(size: number, seed: number, flowers: boolean): Uint8Array {
  const rng = makeRng(seed, flowers ? 'flower-tex' : 'tuft-tex');
  const data = new Uint8Array(size * size * 4);
  const bg = flowers ? [70, 100, 55] : [165, 165, 165];
  for (let i = 0; i < size * size; i++) { data[i * 4] = bg[0] as number; data[i * 4 + 1] = bg[1] as number; data[i * 4 + 2] = bg[2] as number; }
  const put = (px: number, py: number, r: number, g: number, b: number, cov: number): void => {
    if (px < 0 || py < 0 || px >= size || py >= size || cov <= 0) return;
    const o = (py * size + px) * 4;
    if (cov >= 0.35) { data[o] = r; data[o + 1] = g; data[o + 2] = b; }
    data[o + 3] = Math.max(data[o + 3] as number, Math.round(Math.min(1, cov) * 255));
  };
  const blades = flowers ? 7 : 18;
  for (let k = 0; k < blades; k++) {
    const spread = rng.range(-0.5, 0.5);
    const bx = 0.5 + spread * (flowers ? 0.5 : 0.42);
    const h = flowers ? rng.range(0.55, 0.9) : rng.range(0.4, 0.98) * (1 - 0.35 * Math.abs(spread));
    const lean = spread * rng.range(0.25, 0.7) + rng.range(-0.12, 0.12);
    const w0 = (flowers ? 0.011 : rng.range(0.024, 0.042)) * size;
    const shade = rng.range(0.78, 1);
    const rows = Math.floor(h * size);
    let tipX = bx * size;
    for (let y = 0; y < rows; y++) {
      const t = y / rows;
      const cx = (bx + lean * t * t) * size;
      tipX = cx;
      const hw = w0 * (1 - t) ** 0.75 + 0.45;
      for (let px = Math.floor(cx - hw - 1); px <= Math.ceil(cx + hw + 1); px++) {
        const dist = Math.abs(px + 0.5 - cx);
        const rib = dist < hw * 0.22 ? 0.86 : 1;
        const v = (0.4 + 0.6 * t) * shade * rib;
        if (flowers) put(px, y, 80 * v, 120 * v, 60 * v, hw + 0.5 - dist);
        else put(px, y, 255 * v, 255 * v, 255 * v, hw + 0.5 - dist);
      }
    }
    if (!flowers) continue;
    const rad = rng.range(0.055, 0.085) * size;
    const cy = Math.min(size - rad - 1, rows);
    const ph = rng.range(0, 6);
    for (let py = Math.floor(cy - rad); py <= Math.ceil(cy + rad); py++) {
      for (let px = Math.floor(tipX - rad); px <= Math.ceil(tipX + rad); px++) {
        const dx = px + 0.5 - tipX;
        const dy = py + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        const petal = rad * (0.62 + 0.38 * Math.abs(Math.cos(2.5 * Math.atan2(dy, dx) + ph)));
        if (d < rad * 0.28) put(px, py, 235, 190, 70, 1);
        else { const v = Math.min(255, 255 * (0.8 + 0.2 * (d / rad))); put(px, py, v, v, 255, petal + 0.5 - d); }
      }
    }
  }
  return data;
}

const textures = new Map<string, { tex: THREE.DataTexture; refs: number }>();

function acquireTexture(flowers: boolean, size: number): THREE.DataTexture {
  const key = `${flowers ? 'flowers' : 'tufts'}|${size}`;
  let e = textures.get(key);
  if (!e) {
    const tex = new THREE.DataTexture(tuftTexels(size, 7, flowers), size, size, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    tex.name = key;
    e = { tex, refs: 0 };
    textures.set(key, e);
  }
  e.refs++;
  return e.tex;
}

function releaseTexture(tex: THREE.Texture): void {
  const e = textures.get(tex.name);
  if (!e || e.tex !== tex) return;
  if (--e.refs <= 0) {
    e.tex.dispose();
    textures.delete(tex.name);
  }
}

// ---- Geometry ----------------------------------------------------------------------------------------------

/**
 * Vertical quads crossed through the y axis, unit wide and unit tall, base at y = 0. Normals point straight up
 * so a tuft is lit like the ground it stands on, and each quad is wound both ways so it can be drawn
 * single-sided: a double-sided material would flip the normal on the far face and light it from below.
 */
export function crossedQuads(planes: number, rows: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let p = 0; p < planes; p++) {
    const a = (p / planes) * Math.PI;
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      for (const s of [-0.5, 0.5]) {
        pos.push(Math.cos(a) * s, r / rows, Math.sin(a) * s);
        uv.push(s + 0.5, r / rows);
        nor.push(0, 1, 0);
      }
    }
    for (let r = 0; r < rows; r++) {
      const i = base + r * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2, i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A faceted stone: an icosahedron with every corner pushed in or out, flattened, sunk a little into the ground. */
function stoneGeometry(seed: number): THREE.BufferGeometry {
  const src = new THREE.IcosahedronGeometry(0.5, 0);
  const g = src.index ? src.toNonIndexed() : src;
  if (g !== src) src.dispose();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    // Hash on the rounded corner position so the copies of one corner move together and the stone stays closed.
    const k = 0.72 + 0.5 * hash2(Math.round(x * 97) + Math.round(y * 57), Math.round(z * 89) + Math.round(y * 31), seed);
    p.setXYZ(i, x * k, y * k * 0.62 + 0.16, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function debrisGeometry(kind: DebrisKind): THREE.BufferGeometry {
  if (kind === 'clump') {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    g.scale(1, 0.42, 1).translate(0, 0.1, 0);
    return g;
  }
  if (kind === 'shard') return stoneGeometry(91);
  if (kind === 'twig') {
    const g = new THREE.BoxGeometry(1, 0.035, 0.04);
    g.translate(0, 0.02, 0);
    return g;
  }
  // Leaf or scrap of paper: one quad lying on the ground with two corners curled up off it.
  const g = new THREE.BufferGeometry();
  const lift = kind === 'leaf' ? 0.22 : 0.12;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0.015, -0.32, 0.5, 0.015 + lift, -0.32, 0.5, 0.015, 0.32, -0.5, 0.015 + lift * 0.6, 0.32], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3]);
  return g;
}

// ---- Shader patch ------------------------------------------------------------------------------------------

/**
 * Adds the distance fade to a material and, when `sway` is above 0, the wind: the bend grows with the square
 * of the height above the root, rides a slow gust front that travels across the town, and flutters faster on
 * top of it. Applied after the instance matrix, so every tuft leans the same way whatever its own rotation.
 */
function patch(material: THREE.Material, sway: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uScatterTime'] = WIND.time;
    shader.uniforms['uScatterWind'] = WIND.strength;
    shader.uniforms['uScatterFar'] = { value: SCATTER_FAR };
    shader.uniforms['uScatterSway'] = { value: sway };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uScatterTime;\nuniform float uScatterWind;\nuniform float uScatterFar;\nuniform float uScatterSway;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'float scHeight = transformed.y;',
        '#ifdef USE_INSTANCING',
        '  vec4 scOrigin = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );',
        '  transformed *= 1.0 - smoothstep( uScatterFar * 0.72, uScatterFar, distance( scOrigin.xz, cameraPosition.xz ) );',
        '#endif',
      ].join('\n'))
      .replace('#include <project_vertex>', [
        'vec4 mvPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        '  mvPosition = instanceMatrix * mvPosition;',
        '#endif',
        'float scBend = uScatterSway * scHeight * scHeight;',
        'if ( scBend > 0.0 ) {',
        '  float scGust = 0.5 + 0.5 * sin( mvPosition.x * 0.071 + mvPosition.z * 0.043 + uScatterTime * 0.9 );',
        '  scGust *= scGust;',
        '  float scFlutter = sin( uScatterTime * 3.7 + mvPosition.x * 1.9 + mvPosition.z * 2.3 );',
        '  float scAmount = uScatterWind * scBend * ( 0.06 + 0.3 * scGust + 0.035 * scFlutter * ( 0.4 + scGust ) );',
        '  mvPosition.xz += vec2( 0.83, 0.56 ) * scAmount;',
        '  mvPosition.y -= scAmount * scAmount * 0.6;',
        '}',
        'mvPosition = modelViewMatrix * mvPosition;',
        'gl_Position = projectionMatrix * mvPosition;',
      ].join('\n'));
  };
  material.customProgramCacheKey = () => `scatter:${sway > 0 ? 'sway' : 'still'}`;
}

// ---- Placement ---------------------------------------------------------------------------------------------

export interface ScatterInput {
  layout: TownLayout;
  ground: SurfaceKind;
  groundHex: string;
  /** Petal and litter colours, usually the style's accent, glow and trim. */
  accents: readonly string[];
  /** SiteSpec.wild, 0..1. */
  wild: number;
  /** SurfaceSet.wet, 0..1: darkens stones and makes them glossy. */
  wet: number;
  quality: Quality;
  seed: number;
  /** True when the roads are worn tracks: tufts then grow in the strip between the ruts. */
  tracks: boolean;
  /** Height of the land, when it has relief: every instance stands on it. */
  heightAt?: (x: number, z: number) => number;
  /** Depth of standing water: nothing is scattered where it is more than ankle deep. */
  waterDepthAt?: (x: number, z: number) => number;
}

export interface ScatterSet {
  group: THREE.Group;
  counts: Record<ScatterLayer, number>;
  total: number;
  /** Instances currently handed to the GPU, over all layers. */
  visible(): number;
  update(focus: THREE.Vector3): void;
  dispose(): void;
}

interface Layer {
  mesh: THREE.InstancedMesh; chunkX: Float32Array; chunkZ: Float32Array; chunkCount: Uint32Array;
  mViews: Float32Array[]; cViews: Float32Array[]; dstM: Float32Array; dstC: Float32Array;
}

interface Draft { n: number; m: Float32Array; c: Float32Array; key: Int32Array }

const live = new Set<ScatterSet>();
let external = false;
let autoTime = -1;

/** Moves the visible window of every live scatter set to `focus` (the player, or the camera). */
export function updateScatter(focus: THREE.Vector3): void {
  external = true;
  for (const s of live) s.update(focus);
}

function sortIntoLayer(d: Draft, geo: THREE.BufferGeometry, mat: THREE.Material, name: string): Layer {
  const order = Array.from({ length: d.n }, (_, i) => i).sort((a, b) => (d.key[a] as number) - (d.key[b] as number) || a - b);
  const m = new Float32Array(d.n * 16);
  const c = new Float32Array(d.n * 3);
  const starts: number[] = [];
  const keys: number[] = [];
  order.forEach((src, dst) => {
    m.set(d.m.subarray(src * 16, src * 16 + 16), dst * 16);
    c.set(d.c.subarray(src * 3, src * 3 + 3), dst * 3);
    const k = d.key[src] as number;
    if (keys[keys.length - 1] !== k) { keys.push(k); starts.push(dst); }
  });
  const nChunks = keys.length;
  const layer: Layer = {
    mesh: new THREE.InstancedMesh(geo, mat, Math.max(1, d.n)),
    chunkX: new Float32Array(nChunks), chunkZ: new Float32Array(nChunks), chunkCount: new Uint32Array(nChunks),
    mViews: [], cViews: [], dstM: new Float32Array(Math.max(1, d.n) * 16), dstC: new Float32Array(Math.max(1, d.n) * 3),
  };
  for (let i = 0; i < nChunks; i++) {
    const a = starts[i] as number;
    const b = i + 1 < nChunks ? (starts[i + 1] as number) : d.n;
    const k = keys[i] as number;
    layer.chunkX[i] = (Math.floor(k / 4096) - 2048 + 0.5) * CHUNK;
    layer.chunkZ[i] = ((k % 4096) - 2048 + 0.5) * CHUNK;
    layer.chunkCount[i] = b - a;
    layer.mViews.push(m.subarray(a * 16, b * 16));
    layer.cViews.push(c.subarray(a * 3, b * 3));
  }
  const im = new THREE.InstancedBufferAttribute(layer.dstM, 16);
  im.setUsage(THREE.DynamicDrawUsage);
  layer.mesh.instanceMatrix = im;
  const ic = new THREE.InstancedBufferAttribute(layer.dstC, 3);
  ic.setUsage(THREE.DynamicDrawUsage);
  layer.mesh.instanceColor = ic;
  layer.mesh.count = 0;
  layer.mesh.name = name;
  layer.mesh.frustumCulled = false;
  layer.mesh.castShadow = false;
  layer.mesh.receiveShadow = true;
  layer.mesh.matrixAutoUpdate = false;
  return layer;
}

const chunkKey = (x: number, z: number): number => (Math.floor(x / CHUNK) + 2048) * 4096 + (Math.floor(z / CHUNK) + 2048);

function jitter(base: THREE.Color, rng: Rng, dl: number, dh: number, into: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  return into.setHSL((hsl.h + rng.range(-dh, dh) + 1) % 1, hsl.s, clamp(hsl.l + rng.range(-dl, dl), 0.03, 0.95));
}

/** Tuft colour: living ground keeps its own hue, brightened; bare or built ground grows dry straw or dull weeds. */
export function tuftColour(ground: SurfaceKind, groundHex: string): THREE.Color {
  const g = new THREE.Color(groundHex);
  const hsl = { h: 0, s: 0, l: 0 };
  g.getHSL(hsl);
  if (ground === 'grass' || ground === 'moss') return new THREE.Color().setHSL(hsl.h, clamp(hsl.s * 1.15 + 0.05, 0, 0.9), clamp(hsl.l * 1.25 + 0.03, 0.16, 0.6));
  if (ground === 'snow' || ground === 'ice') return new THREE.Color('#8f7f58');
  if (ground === 'sand' || ground === 'gravel' || ground === 'dirt' || ground === 'mud') return g.lerp(new THREE.Color('#9a9150'), 0.6);
  return g.lerp(new THREE.Color('#5f7242'), 0.72);
}

export function buildScatter(inp: ScatterInput): ScatterSet {
  const { layout, quality, seed } = inp;
  const mixOf = scatterMix(inp.ground);
  const budget = scatterBudget(quality, inp.wild);
  const wild = clamp(Number.isFinite(inp.wild) ? inp.wild : 0.3, 0, 1);
  const b = layout.bounds;
  const area = { minX: b.minX - MARGIN, maxX: b.maxX + MARGIN, minZ: b.minZ - MARGIN, maxZ: b.maxZ + MARGIN };
  const boxes = layout.buildings.map((bd) => buildingAabb(bd));
  const pl = layout.plaza;

  // What the ground offers at a point: distance to the nearest road edge and wall, and whether it is built on.
  const probe = { road: 0, wall: 0, door: 0, inside: false };
  const look = (x: number, z: number): void => {
    let road = Math.max(0, Math.hypot(x - pl.x, z - pl.z) - pl.r);
    for (const r of layout.roads) road = Math.min(road, distanceToRoad(r, x, z));
    let wall = 1e9;
    let inside = false;
    for (const r of boxes) {
      const d = Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
      if (d === 0) inside = true;
      wall = Math.min(wall, d);
    }
    let door = 1e9;
    for (const bd of layout.buildings) door = Math.min(door, Math.hypot(x - bd.door.x, z - bd.door.z));
    probe.road = road; probe.wall = wall; probe.door = door; probe.inside = inside;
  };
  const edge = (x: number, z: number): number => 1 - 0.55 * smoothstep(0, MARGIN, outsideDistance(b, x, z));
  // Plants grow in patches, thickest away from traffic and in the shelter of a wall; a wilder site has fewer bare gaps.
  const plantDensity = (x: number, z: number): number => {
    if (probe.inside || probe.door < 1.4 || probe.road <= 0) return 0;
    const sheltered = probe.wall < 0.9 ? 0.75 : 0;
    if (mixOf.paved) return sheltered + (probe.road < 0.5 ? 0.55 : 0) + 0.04;
    const patch = smoothstep(0.52 - 0.3 * wild, 0.66 - 0.2 * wild, fbm(x / 11, z / 11, seed + 101, 3));
    return clamp(smoothstep(0.15, 4.5, probe.road) * (0.1 + 0.9 * patch) + sheltered, 0, 1) * edge(x, z);
  };
  const stoneDensity = (x: number, z: number): number => {
    if (probe.inside) return 0;
    return (probe.road <= 0 ? 0.12 : 1) * (0.25 + 0.75 * smoothstep(0.35, 0.7, fbm(x / 7, z / 7, seed + 103, 3))) * edge(x, z);
  };
  // Leaves and litter drift: they collect against walls and kerbs and thin out where people walk.
  const debrisDensity = (x: number, z: number): number => {
    if (probe.inside) return 0;
    const caught = probe.wall < 0.7 || (probe.road > 0 && probe.road < 0.45) ? 0.8 : 0;
    const drift = smoothstep(0.45, 0.72, fbm(x / 9 + 40, z / 9, seed + 107, 3));
    return clamp((probe.road <= 0 ? 0.22 : 1) * (0.12 + 0.88 * drift) + caught, 0, 1) * edge(x, z);
  };

  const draft = (cap: number): Draft => ({ n: 0, m: new Float32Array(cap * 16), c: new Float32Array(cap * 3), key: new Int32Array(cap) });
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const posV = new THREE.Vector3();
  const sclV = new THREE.Vector3();
  const colour = new THREE.Color();
  const add = (d: Draft, x: number, z: number, yaw: number, tilt: number, sx: number, sy: number, sz: number, c: THREE.Color): void => {
    if (inp.waterDepthAt && inp.waterDepthAt(x, z) > 0.08) return;
    euler.set(tilt, yaw, tilt * 0.6, 'YXZ');
    mat4.compose(posV.set(x, inp.heightAt ? inp.heightAt(x, z) : 0, z), quat.setFromEuler(euler), sclV.set(sx, sy, sz));
    mat4.toArray(d.m, d.n * 16);
    d.c[d.n * 3] = c.r; d.c[d.n * 3 + 1] = c.g; d.c[d.n * 3 + 2] = c.b;
    d.key[d.n] = chunkKey(x, z);
    d.n++;
  };
  const fill = (d: Draft, want: number, salt: string, density: (x: number, z: number) => number, place: (x: number, z: number, rng: Rng) => void): void => {
    const rng = makeRng(seed, `scatter-${salt}`);
    const tries = want * 14;
    for (let t = 0; t < tries && d.n < want; t++) {
      const x = rng.range(area.minX, area.maxX);
      const z = rng.range(area.minZ, area.maxZ);
      look(x, z);
      if (rng.next() < density(x, z)) place(x, z, rng);
    }
  };

  const wantFlowers = Math.round(budget * mixOf.flowers);
  const wantStones = Math.round(budget * mixOf.stones);
  const wantDebris = Math.round(budget * mixOf.debris);
  const wantTufts = budget - wantFlowers - wantStones - wantDebris;
  const tuftBase = tuftColour(inp.ground, inp.groundHex);
  const ground = new THREE.Color(inp.groundHex);

  const tufts = draft(wantTufts);
  if (inp.tracks && wantTufts > 0) {
    // The strip between the ruts, where neither wheel nor hoof lands.
    const rng = makeRng(seed, 'scatter-strip');
    for (const r of layout.roads) {
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
      for (let s = 0.4; s < len && tufts.n < wantTufts * 0.18; s += 0.45) {
        if (!rng.chance(0.5)) continue;
        const x = r.ax + ((r.bx - r.ax) / len) * s + rng.range(-0.14, 0.14);
        const z = r.az + ((r.bz - r.az) / len) * s + rng.range(-0.14, 0.14);
        if (Math.hypot(x - pl.x, z - pl.z) < pl.r) continue;
        add(tufts, x, z, rng.range(0, Math.PI), 0, rng.range(0.3, 0.5), rng.range(0.14, 0.28), rng.range(0.3, 0.5), jitter(tuftBase, rng, 0.06, 0.02, colour));
      }
    }
  }
  fill(tufts, wantTufts, 'tufts', plantDensity, (x, z, rng) => {
    // Sheltered growth against a wall is taller and ranker than the cropped stuff in the open.
    const rank = probe.wall < 0.9 ? 1.35 : 1;
    const w = rng.range(0.5, 0.95) * rank;
    add(tufts, x, z, rng.range(0, Math.PI), 0, w, rng.range(0.26, 0.62) * rank * (0.8 + 0.5 * wild), w, jitter(tuftBase, rng, 0.07, 0.025, colour));
  });

  const flowers = draft(wantFlowers);
  const petals = [...inp.accents, '#ffffff', '#f4e6a0'].map((h) => new THREE.Color(h).lerp(new THREE.Color('#ffffff'), 0.25));
  fill(flowers, wantFlowers, 'flowers', (x, z) => plantDensity(x, z) * smoothstep(0.5, 0.7, fbm(x / 14 + 9, z / 14, seed + 109, 2)), (x, z, rng) => {
    const w = rng.range(0.35, 0.6);
    add(flowers, x, z, rng.range(0, Math.PI), 0, w, rng.range(0.35, 0.7), w, jitter(rng.pick(petals), rng, 0.05, 0.01, colour));
  });

  const stones = draft(wantStones);
  const stoneBase = ground.clone().lerp(new THREE.Color('#7d7a74'), 0.5).multiplyScalar(1 - 0.3 * clamp(inp.wet, 0, 1));
  fill(stones, wantStones, 'stones', stoneDensity, (x, z, rng) => {
    // Mostly gravel-sized, with the odd rock big enough to notice.
    const s = 0.05 + 0.4 * rng.next() ** 3.2;
    add(stones, x, z, rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3), s * rng.range(0.8, 1.4), s * rng.range(0.7, 1.1), s, jitter(stoneBase, rng, 0.08, 0.015, colour));
  });

  const debris = draft(wantDebris);
  const kind = mixOf.kind;
  const debrisBases: THREE.Color[] = kind === 'leaf'
    ? [tuftBase.clone().lerp(new THREE.Color('#a8662c'), 0.75), tuftBase.clone().lerp(new THREE.Color('#7a4a22'), 0.85), tuftBase.clone().lerp(new THREE.Color('#c79a3a'), 0.6)]
    : kind === 'twig' ? [new THREE.Color('#6b5a45'), new THREE.Color('#8a7a62')]
      : kind === 'clump' ? [new THREE.Color('#eef2f6'), new THREE.Color('#dfe6ee')]
        : kind === 'shard' ? [ground.clone().multiplyScalar(0.6), ground.clone().lerp(new THREE.Color('#3a3a40'), 0.6)]
          : [new THREE.Color('#d6d0c2'), new THREE.Color('#b5ad9a'), new THREE.Color('#6d7074'), ...inp.accents.slice(0, 1).map((h) => new THREE.Color(h).lerp(new THREE.Color('#8a8a8a'), 0.5))];
  fill(debris, wantDebris, 'debris', debrisDensity, (x, z, rng) => {
    const c = jitter(rng.pick(debrisBases), rng, 0.06, 0.015, colour);
    if (kind === 'clump') { const s = rng.range(0.14, 0.6); add(debris, x, z, rng.range(0, 6.28), 0, s, s * rng.range(0.6, 1.2), s * rng.range(0.7, 1.2), c); }
    else if (kind === 'shard') { const s = rng.range(0.05, 0.22); add(debris, x, z, rng.range(0, 6.28), rng.range(-0.5, 0.5), s * 1.6, s * 0.5, s, c); }
    else if (kind === 'twig') { const s = rng.range(0.18, 0.6); add(debris, x, z, rng.range(0, 6.28), 0, s, 1, 1, c); }
    else { const s = kind === 'leaf' ? rng.range(0.07, 0.15) : rng.range(0.12, 0.3); add(debris, x, z, rng.range(0, 6.28), 0, s, s, s * rng.range(0.7, 1.1), c); }
  });

  // Meshes
  const group = new THREE.Group();
  group.name = 'scatter';
  const texSize = quality === 0 ? 64 : 128;
  const tuftMat = new THREE.MeshStandardMaterial({ map: acquireTexture(false, texSize), alphaTest: 0.32, roughness: 0.92 });
  const flowerMat = new THREE.MeshStandardMaterial({ map: acquireTexture(true, texSize), alphaTest: 0.32, roughness: 0.9 });
  const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.88 - 0.45 * clamp(inp.wet, 0, 1), flatShading: true });
  const debrisMat = new THREE.MeshStandardMaterial({ roughness: kind === 'clump' ? 0.75 : 0.9, flatShading: kind === 'shard' });
  patch(tuftMat, 0.5);
  patch(flowerMat, 0.6);
  patch(stoneMat, 0);
  patch(debrisMat, 0);
  const cross = crossedQuads(quality === 2 ? 3 : 2, quality === 0 ? 1 : 2);
  const geos = [cross, stoneGeometry(17), debrisGeometry(kind)];
  const mats = [tuftMat, flowerMat, stoneMat, debrisMat];
  const layers: Layer[] = [
    sortIntoLayer(tufts, cross, tuftMat, 'scatter:tufts'),
    sortIntoLayer(flowers, cross, flowerMat, 'scatter:flowers'),
    sortIntoLayer(stones, geos[1] as THREE.BufferGeometry, stoneMat, 'scatter:stones'),
    sortIntoLayer(debris, geos[2] as THREE.BufferGeometry, debrisMat, 'scatter:debris'),
  ];
  for (const l of layers) group.add(l.mesh);

  let cellX = Number.NaN;
  let cellZ = Number.NaN;
  let disposed = false;
  const set: ScatterSet = {
    group,
    counts: { tufts: tufts.n, flowers: flowers.n, stones: stones.n, debris: debris.n },
    total: tufts.n + flowers.n + stones.n + debris.n,
    visible: () => layers.reduce((n, l) => n + l.mesh.count, 0),
    update(focus: THREE.Vector3): void {
      const fx = Math.floor(focus.x / CELL);
      const fz = Math.floor(focus.z / CELL);
      if (disposed || (fx === cellX && fz === cellZ)) return;
      cellX = fx;
      cellZ = fz;
      const px = (fx + 0.5) * CELL;
      const pz = (fz + 0.5) * CELL;
      const reach = (REACH + CELL) * (REACH + CELL);
      for (const l of layers) {
        let w = 0;
        for (let i = 0; i < l.chunkCount.length; i++) {
          const dx = (l.chunkX[i] as number) - px;
          const dz = (l.chunkZ[i] as number) - pz;
          if (dx * dx + dz * dz > reach) continue;
          l.dstM.set(l.mViews[i] as Float32Array, w * 16);
          l.dstC.set(l.cViews[i] as Float32Array, w * 3);
          w += l.chunkCount[i] as number;
        }
        l.mesh.count = w;
        l.mesh.instanceMatrix.needsUpdate = true;
        if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      live.delete(set);
      for (const l of layers) l.mesh.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) {
        if (m.map) releaseTexture(m.map);
        m.dispose();
      }
      group.clear();
    },
  };
  layers.forEach((l, i) => {
    const solid = i === 2;
    let held = -1;
    l.mesh.onBeforeRender = (_renderer, _scene, camera, _geometry, material) => {
      if (material !== l.mesh.material) {
        // A pass that swaps in its own material (the normal and depth pre-pass for ambient occlusion) has no
        // alpha test and no fade: it would see every tuft as a solid card. Cards sit that pass out.
        if (!solid) { held = l.mesh.count; l.mesh.count = 0; }
        return;
      }
      if (i !== 0) return;
      // Until something calls updateScatter and advances WIND.time, the scatter follows the camera and keeps its own clock.
      if (!external) for (const s of live) s.update(camera.position);
      if (WIND.time.value === autoTime || (autoTime < 0 && WIND.time.value === 0)) {
        autoTime = performance.now() / 1000;
        WIND.time.value = autoTime;
      }
    };
    l.mesh.onAfterRender = () => {
      if (held >= 0) { l.mesh.count = held; held = -1; }
    };
  });
  live.add(set);
  set.update(posV.set(layout.spawn.x, 0, layout.spawn.z));
  return set;
}
