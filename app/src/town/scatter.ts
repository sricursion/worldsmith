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

/**
 * RGBA texels for a mark on the ground: a white blot with a ragged, broken edge and a mottled middle, clear
 * at the border of the square. The instance colour makes it a bare patch, a damp stain, a scorch or a drift,
 * and a long thin instance of it reads as a crack or a streak.
 */
export function markTexels(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size * size * 4).fill(255);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = ((px + 0.5) / size) * 2 - 1;
      const v = ((py + 0.5) / size) * 2 - 1;
      const r = Math.hypot(u, v);
      const rim = 0.62 + 0.6 * (fbm(u * 2.2 + 5, v * 2.2, seed, 3) - 0.5);
      const body = r >= 0.96 ? 0 : smoothstep(rim, rim * 0.55, r) * (0.5 + 0.5 * smoothstep(0.3, 0.6, fbm(u * 6, v * 6, seed + 3, 2)));
      data[(py * size + px) * 4 + 3] = Math.round(body * 200);
    }
  }
  return data;
}

function acquireMarkTexture(): THREE.DataTexture {
  const key = 'marks|64';
  let e = textures.get(key);
  if (!e) {
    const tex = new THREE.DataTexture(markTexels(64, 7), 64, 64, THREE.RGBAFormat);
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

/** What marks a kind of ground carries: their colours, how many are thin streaks, and whether they lie drifted by the wind. */
export interface MarkPlan { colours: THREE.Color[]; streak: number; drift: boolean }

/**
 * Marks by ground kind, every colour worked from the world's own ground colour (and its accents, on ground
 * that is not of this earth), so purple soil gets purple-black scorches and pale purple dust, not brown ones.
 */
export function markPlan(ground: SurfaceKind, groundHex: string, accents: readonly string[]): MarkPlan {
  const g = new THREE.Color(groundHex);
  const dark = g.clone().multiplyScalar(0.55);
  const pale = g.clone().lerp(new THREE.Color('#ffffff'), 0.24);
  switch (ground) {
    // Bare earth showing through, damp patches, sun-dried grass.
    case 'grass': case 'moss': return { colours: [g.clone().lerp(new THREE.Color('#6b5238'), 0.65), dark, g.clone().lerp(new THREE.Color('#b8a25a'), 0.4)], streak: 0, drift: false };
    // Damp and dried-out patches, drying cracks.
    case 'dirt': case 'mud': case 'gravel': return { colours: [dark, pale, dark], streak: 0.25, drift: false };
    // Wind-laid ripples of finer, paler sand with darker lee sides.
    case 'sand': return { colours: [pale, pale, g.clone().multiplyScalar(0.78)], streak: 0.1, drift: true };
    // Blue shadowed drifts, scoured dark ice, cracks.
    case 'snow': case 'ice': return { colours: [g.clone().lerp(new THREE.Color('#8fa6c4'), 0.45), g.clone().lerp(new THREE.Color('#566473'), 0.5), pale], streak: ground === 'ice' ? 0.35 : 0.08, drift: true };
    // Scorches, settled dust, and mineral stains in the world's accent colours.
    case 'regolith': case 'ash': return {
      colours: [g.clone().multiplyScalar(0.4), pale, ...accents.slice(0, 2).map((h) => g.clone().lerp(new THREE.Color(h), 0.42))], streak: 0.12, drift: false,
    };
    // Paving: oil and damp stains, patched repairs, cracks.
    default: return { colours: [g.clone().multiplyScalar(0.45), g.clone().multiplyScalar(0.7), pale], streak: 0.3, drift: false };
  }
}

const markDraw = { yaw: 0, sx: 1, sz: 1 };
/** Draws the size and heading of one mark into `markDraw`. */
function markShape(rng: Rng, plan: MarkPlan): void {
  if (rng.next() < plan.streak) {
    markDraw.sx = rng.range(1.2, 3.4); markDraw.sz = rng.range(0.1, 0.24); markDraw.yaw = rng.range(0, Math.PI);
    return;
  }
  const s = 0.5 + 2.1 * rng.next() ** 2;
  if (plan.drift) {
    // Drifts lie along the shared wind.
    markDraw.sx = s * rng.range(1.8, 2.8); markDraw.sz = s * rng.range(0.6, 0.9); markDraw.yaw = -0.594 + rng.range(-0.35, 0.35);
  } else {
    markDraw.sx = s * rng.range(0.8, 1.5); markDraw.sz = s * rng.range(0.7, 1.2); markDraw.yaw = rng.range(0, Math.PI * 2);
  }
}

/** One square lying just clear of the ground, facing up: the lift is in the geometry so an instance still stands at ground height. */
function markGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0.03, -0.5, 0.5, 0.03, -0.5, 0.5, 0.03, 0.5, -0.5, 0.03, 0.5], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

/** On wet ground the marks shine: the dark ones then read as standing damp and shallow puddles. */
function markMaterial(wet: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: acquireMarkTexture(), transparent: true, depthWrite: false, roughness: 1 - 0.8 * clamp(Number.isFinite(wet) ? wet : 0, 0, 1),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  patch(m, 0);
  return m;
}

/** Share of the scatter budget spent on ground marks; the other layers split what is left. */
const MARK_SHARE = 0.05;

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
  /** Flat marks on the ground (patches, stains, cracks, drifts): counted in `total`, taken out of the same budget. */
  marks: number;
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

  const wantMarks = Math.round(budget * MARK_SHARE);
  const rest = budget - wantMarks;
  const wantFlowers = Math.round(rest * mixOf.flowers);
  const wantStones = Math.round(rest * mixOf.stones);
  const wantDebris = Math.round(rest * mixOf.debris);
  const wantTufts = Math.max(0, rest - wantFlowers - wantStones - wantDebris);
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

  // Marks lie on open ground off the roads, in loose groups, each tipped to the slope it lies on.
  const marks = draft(wantMarks);
  const plan = markPlan(inp.ground, inp.groundHex, inp.accents);
  const H = inp.heightAt;
  fill(marks, wantMarks, 'marks', (x, z) => {
    if (probe.inside || probe.road < 0.4 || probe.door < 1.2) return 0;
    return (0.08 + 0.92 * smoothstep(0.42, 0.68, fbm(x / 13 + 17, z / 13, seed + 113, 3))) * edge(x, z);
  }, (x, z, rng) => {
    markShape(rng, plan);
    jitter(rng.pick(plan.colours), rng, 0.04, 0.01, colour);
    if (inp.waterDepthAt && inp.waterDepthAt(x, z) > 0.08) return;
    let tx = 0;
    let tz = 0;
    if (H) {
      const gx = (H(x + 0.6, z) - H(x - 0.6, z)) / 1.2;
      const gz = (H(x, z + 0.6) - H(x, z - 0.6)) / 1.2;
      if (Math.hypot(gx, gz) > 0.45) return;
      const cs = Math.cos(markDraw.yaw);
      const sn = Math.sin(markDraw.yaw);
      tz = Math.atan(gx * cs - gz * sn);
      tx = -Math.atan(gx * sn + gz * cs);
    }
    euler.set(tx, markDraw.yaw, tz, 'YXZ');
    mat4.compose(posV.set(x, H ? H(x, z) : 0, z), quat.setFromEuler(euler), sclV.set(markDraw.sx, 1, markDraw.sz));
    mat4.toArray(marks.m, marks.n * 16);
    marks.c[marks.n * 3] = colour.r; marks.c[marks.n * 3 + 1] = colour.g; marks.c[marks.n * 3 + 2] = colour.b;
    marks.key[marks.n] = chunkKey(x, z);
    marks.n++;
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
  const markMat = markMaterial(inp.wet);
  const geos = [cross, stoneGeometry(17), debrisGeometry(kind), markGeometry()];
  const mats = [tuftMat, flowerMat, stoneMat, debrisMat, markMat];
  const layers: Layer[] = [
    sortIntoLayer(tufts, cross, tuftMat, 'scatter:tufts'),
    sortIntoLayer(flowers, cross, flowerMat, 'scatter:flowers'),
    sortIntoLayer(stones, geos[1] as THREE.BufferGeometry, stoneMat, 'scatter:stones'),
    sortIntoLayer(debris, geos[2] as THREE.BufferGeometry, debrisMat, 'scatter:debris'),
    sortIntoLayer(marks, geos[3] as THREE.BufferGeometry, markMat, 'scatter:marks'),
  ];
  for (const l of layers) group.add(l.mesh);

  let cellX = Number.NaN;
  let cellZ = Number.NaN;
  let disposed = false;
  const set: ScatterSet = {
    group,
    counts: { tufts: tufts.n, flowers: flowers.n, stones: stones.n, debris: debris.n },
    marks: marks.n,
    total: tufts.n + flowers.n + stones.n + debris.n + marks.n,
    visible:() => layers.reduce((n, l) => n + l.mesh.count, 0),
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

// ---- Streaming windows -------------------------------------------------------------------------------------
// Past the place itself the land goes on for ever, and what lies on it is made as it comes into reach. A window
// is a square of `span` x `span` chunks that follows a focus. Every chunk owns a fixed run of instances in each
// layer's buffer, found by its coordinate modulo the span, so when the focus moves on, the chunks left behind
// hand their runs to the ones coming in: the buffers never grow and nothing is allocated after the first frame.
// What stands in a chunk is decided by its coordinate alone, so it is the same every time it is walked back to.

export interface WindowLayer { mesh: THREE.InstancedMesh; /** Instances a chunk may hold in this layer. */ cap: number }

export class InstanceWindow {
  /** Chunks filled so far, over the life of the window. */
  recycles = 0;
  private readonly slotX: Int32Array;
  private readonly slotZ: Int32Array;
  private readonly filled: Uint8Array;
  private readonly dirty: Int32Array;
  private readonly used: Int32Array;
  private dirtyN = 0;
  private dirtyAt = 0;
  private baseX = Number.NaN;
  private baseZ = Number.NaN;
  private cur = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();

  /**
   * `size` is a chunk's side in metres and `span` (even) the chunks along a side of the window. Each layer's
   * mesh must hold span * span * cap instances. `fill` is called for one chunk at a time and places with put().
   */
  constructor(
    readonly size: number, readonly span: number, readonly layers: readonly WindowLayer[],
    private readonly fill: (cx: number, cz: number, win: InstanceWindow) => void,
  ) {
    const n = span * span;
    this.slotX = new Int32Array(n);
    this.slotZ = new Int32Array(n);
    this.filled = new Uint8Array(n);
    this.dirty = new Int32Array(n);
    this.used = new Int32Array(layers.length);
    for (const l of layers) {
      const a = l.mesh.instanceMatrix.array;
      a.fill(0);
      for (let i = 15; i < a.length; i += 16) a[i] = 1;
      l.mesh.count = n * l.cap;
      l.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Instances held over all layers: fixed for the life of the window. */
  get capacity(): number {
    return this.layers.reduce((n, l) => n + l.cap, 0) * this.span * this.span;
  }

  /** The slot being filled, during fill. */
  get slot(): number { return this.cur; }

  /** Instances placed so far in a layer of the chunk being filled. */
  placed(layer: number): number { return this.used[layer] ?? 0; }

  private slotFor(cx: number, cz: number): number {
    const s = this.span;
    return (((cx % s) + s) % s) + (((cz % s) + s) % s) * s;
  }

  /** The slot that holds the chunk over a point, or -1 while that chunk is not made. */
  slotAt(x: number, z: number): number {
    const cx = Math.floor(x / this.size);
    const cz = Math.floor(z / this.size);
    const s = this.slotFor(cx, cz);
    return this.filled[s] === 1 && this.slotX[s] === cx && this.slotZ[s] === cz ? s : -1;
  }

  /** Moves the window to stand around a point. Chunks that came into it are queued; work() makes them. */
  retarget(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const bx = Math.floor(x / this.size) - this.span / 2;
    const bz = Math.floor(z / this.size) - this.span / 2;
    if (bx === this.baseX && bz === this.baseZ) return;
    this.baseX = bx;
    this.baseZ = bz;
    this.dirtyN = 0;
    this.dirtyAt = 0;
    for (let j = 0; j < this.span; j++) {
      for (let i = 0; i < this.span; i++) {
        const cx = bx + i;
        const cz = bz + j;
        const s = this.slotFor(cx, cz);
        if (this.filled[s] === 1 && this.slotX[s] === cx && this.slotZ[s] === cz) continue;
        this.slotX[s] = cx;
        this.slotZ[s] = cz;
        this.filled[s] = 0;
        this.dirty[this.dirtyN++] = s;
      }
    }
  }

  pending(): boolean { return this.dirtyAt < this.dirtyN; }

  /** Makes one queued chunk. */
  work(): void {
    if (this.dirtyAt >= this.dirtyN) return;
    const s = this.dirty[this.dirtyAt++] as number;
    this.cur = s;
    this.used.fill(0);
    const cx = this.slotX[s] as number;
    const cz = this.slotZ[s] as number;
    for (const l of this.layers) {
      // Whatever the last chunk left here shrinks to nothing; put() then writes over the front of the run.
      const a = l.mesh.instanceMatrix.array;
      const o = s * l.cap * 16;
      a.fill(0, o, o + l.cap * 16);
      for (let i = 0; i < l.cap; i++) {
        a[o + i * 16 + 12] = (cx + 0.5) * this.size;
        a[o + i * 16 + 14] = (cz + 0.5) * this.size;
        a[o + i * 16 + 15] = 1;
      }
    }
    this.fill(cx, cz, this);
    this.filled[s] = 1;
    this.recycles++;
    for (const l of this.layers) {
      this.touch(l.mesh.instanceMatrix, s * l.cap * 16, l.cap * 16);
      if (l.mesh.instanceColor) this.touch(l.mesh.instanceColor, s * l.cap * 3, l.cap * 3);
    }
  }

  private touch(attr: THREE.InstancedBufferAttribute, start: number, count: number): void {
    // Ranges are cleared when the renderer uploads them; a mesh that is not being drawn must not pile them up.
    if (attr.updateRanges.length > 24) attr.clearUpdateRanges();
    else if (count > 0) attr.addUpdateRange(start, count);
    attr.needsUpdate = true;
  }

  /** Places one instance in a layer of the chunk being filled. False when that chunk's run in the layer is full. */
  put(layer: number, x: number, y: number, z: number, yaw: number, tiltX: number, tiltZ: number, sx: number, sy: number, sz: number, c?: THREE.Color): boolean {
    const l = this.layers[layer];
    const n = this.used[layer];
    if (!l || n === undefined || n >= l.cap) return false;
    const i = this.cur * l.cap + n;
    this.euler.set(tiltX, yaw, tiltZ, 'YXZ');
    this.m4.compose(this.pos.set(x, y, z), this.quat.setFromEuler(this.euler), this.scl.set(sx, sy, sz));
    this.m4.toArray(l.mesh.instanceMatrix.array, i * 16);
    if (c && l.mesh.instanceColor) {
      const a = l.mesh.instanceColor.array;
      a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
    }
    this.used[layer] = n + 1;
    return true;
  }
}

/** A mesh for one layer of a window: `total` instances, never culled as a whole, drawn from wherever the window is. */
export function windowMesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], total: number, name: string, coloured: boolean): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, total));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (coloured) {
    const ic = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 3).fill(1), 3);
    ic.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = ic;
  }
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Side of a chunk of far scatter, and the chunks along a side of its window: the focus is never nearer than SCATTER_FAR to its edge. */
const FIELD_CHUNK = 24;
const FIELD_SPAN = 8;

export interface ScatterFieldInput extends ScatterInput {
  heightAt: (x: number, z: number) => number;
  /** What the scatter of the place itself came to, by layer: the far scatter is a little thinner than that. */
  placed: Record<ScatterLayer, number>;
}

export interface ScatterField {
  group: THREE.Group;
  window: InstanceWindow;
  dispose(): void;
}

/**
 * The same tufts, flowers, stones and debris as buildScatter, for the land beyond the place: nothing within
 * the margin buildScatter covers, everything past it, made a chunk at a time around the focus.
 */
export function buildScatterField(inp: ScatterFieldInput): ScatterField {
  const { layout, quality, seed } = inp;
  const mixOf = scatterMix(inp.ground);
  const wild = clamp(Number.isFinite(inp.wild) ? inp.wild : 0.3, 0, 1);
  const b = layout.bounds;
  const area = (b.maxX - b.minX + 2 * MARGIN) * (b.maxZ - b.minZ + 2 * MARGIN);
  const perChunk = (n: number): number => Math.max(0, Math.min(700, Math.ceil((n / Math.max(1, area)) * FIELD_CHUNK * FIELD_CHUNK * (mixOf.paved ? 0.4 : 0.8))));
  // Marks are not reported by layer: the place gave them a fixed share of what it placed, and so does the far land.
  const placedMarks = ((inp.placed.tufts + inp.placed.flowers + inp.placed.stones + inp.placed.debris) * MARK_SHARE) / (1 - MARK_SHARE);
  const caps = [perChunk(inp.placed.tufts), perChunk(inp.placed.flowers), perChunk(inp.placed.stones), perChunk(inp.placed.debris), perChunk(placedMarks)] as const;

  const group = new THREE.Group();
  group.name = 'scatter-far';
  const texSize = quality === 0 ? 64 : 128;
  const kind = mixOf.kind;
  const tuftMat = new THREE.MeshStandardMaterial({ map: acquireTexture(false, texSize), alphaTest: 0.32, roughness: 0.92 });
  const flowerMat = new THREE.MeshStandardMaterial({ map: acquireTexture(true, texSize), alphaTest: 0.32, roughness: 0.9 });
  const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.88 - 0.45 * clamp(inp.wet, 0, 1), flatShading: true });
  const debrisMat = new THREE.MeshStandardMaterial({ roughness: kind === 'clump' ? 0.75 : 0.9, flatShading: kind === 'shard' });
  patch(tuftMat, 0.5);
  patch(flowerMat, 0.6);
  patch(stoneMat, 0);
  patch(debrisMat, 0);
  const cross = crossedQuads(quality === 2 ? 3 : 2, quality === 0 ? 1 : 2);
  const geos = [cross, stoneGeometry(17), debrisGeometry(kind), markGeometry()];
  const mats = [tuftMat, flowerMat, stoneMat, debrisMat, markMaterial(inp.wet)];
  const plan = markPlan(inp.ground, inp.groundHex, inp.accents);
  const slots = FIELD_SPAN * FIELD_SPAN;
  const names = ['tufts', 'flowers', 'stones', 'debris', 'marks'];
  const layers: WindowLayer[] = caps.map((cap, i) => ({
    cap,
    mesh: windowMesh(i < 2 ? cross : (geos[i - 1] as THREE.BufferGeometry), mats[i] as THREE.Material, slots * cap, `scatter-far:${names[i]}`, true),
  }));
  for (const l of layers) {
    l.mesh.castShadow = false;
    l.mesh.receiveShadow = true;
    if (l.cap > 0) group.add(l.mesh);
  }

  const tuftBase = tuftColour(inp.ground, inp.groundHex);
  const ground = new THREE.Color(inp.groundHex);
  const petals = [...inp.accents, '#ffffff', '#f4e6a0'].map((h) => new THREE.Color(h).lerp(new THREE.Color('#ffffff'), 0.25));
  const stoneBase = ground.clone().lerp(new THREE.Color('#7d7a74'), 0.5).multiplyScalar(1 - 0.3 * clamp(inp.wet, 0, 1));
  const debrisBases: THREE.Color[] = kind === 'leaf'
    ? [tuftBase.clone().lerp(new THREE.Color('#a8662c'), 0.75), tuftBase.clone().lerp(new THREE.Color('#7a4a22'), 0.85), tuftBase.clone().lerp(new THREE.Color('#c79a3a'), 0.6)]
    : kind === 'twig' ? [new THREE.Color('#6b5a45'), new THREE.Color('#8a7a62')]
      : kind === 'clump' ? [new THREE.Color('#eef2f6'), new THREE.Color('#dfe6ee')]
        : kind === 'shard' ? [ground.clone().multiplyScalar(0.6), ground.clone().lerp(new THREE.Color('#3a3a40'), 0.6)]
          : [new THREE.Color('#d6d0c2'), new THREE.Color('#b5ad9a'), new THREE.Color('#6d7074')];
  const colour = new THREE.Color();
  const dry = (x: number, z: number): boolean => outsideDistance(b, x, z) > MARGIN && !(inp.waterDepthAt && inp.waterDepthAt(x, z) > 0.08);
  // The place's own scatter thins to 0.45 of itself at its margin: the far scatter starts there and fills out.
  const ease = (x: number, z: number): number => 0.55 + 0.45 * smoothstep(MARGIN, MARGIN + 40, outsideDistance(b, x, z));
  // Slow fields over the far land: meadows against thin ground, rock fields against stretches with hardly a stone.
  const meadow = (x: number, z: number): number => 0.25 + 0.75 * smoothstep(0.38, 0.6, fbm(x / 70 + 13, z / 70, seed + 127, 2));
  const rocky = (x: number, z: number): number => 0.15 + 1.1 * smoothstep(0.42, 0.66, fbm(x / 55, z / 55 + 7, seed + 131, 2));

  const window = new InstanceWindow(FIELD_CHUNK, FIELD_SPAN, layers, (cx, cz, win) => {
    const rng = makeRng(seed, `far-scatter|${cx}|${cz}`);
    const x0 = cx * FIELD_CHUNK;
    const z0 = cz * FIELD_CHUNK;
    // Wholly inside the place's own margin: nothing to do.
    if (outsideDistance(b, x0 + FIELD_CHUNK / 2, z0 + FIELD_CHUNK / 2) + FIELD_CHUNK * Math.SQRT1_2 <= MARGIN) return;
    for (let k = 0; k < caps[0]; k++) {
      const x = x0 + rng.next() * FIELD_CHUNK;
      const z = z0 + rng.next() * FIELD_CHUNK;
      const patchy = mixOf.paved ? 0.3 : 0.1 + 0.9 * smoothstep(0.52 - 0.3 * wild, 0.66 - 0.2 * wild, fbm(x / 11, z / 11, seed + 101, 3));
      const w = rng.range(0.5, 0.95);
      const h = rng.range(0.26, 0.62) * (0.8 + 0.5 * wild);
      const yaw = rng.range(0, Math.PI);
      jitter(tuftBase, rng, 0.07, 0.025, colour);
      if (rng.next() < patchy * meadow(x, z) * ease(x, z) && dry(x, z)) win.put(0, x, inp.heightAt(x, z), z, yaw, 0, 0, w, h, w, colour);
    }
    for (let k = 0; k < caps[1]; k++) {
      const x = x0 + rng.next() * FIELD_CHUNK;
      const z = z0 + rng.next() * FIELD_CHUNK;
      const patchy = (0.1 + 0.9 * smoothstep(0.52 - 0.3 * wild, 0.66 - 0.2 * wild, fbm(x / 11, z / 11, seed + 101, 3))) * smoothstep(0.5, 0.7, fbm(x / 14 + 9, z / 14, seed + 109, 2));
      const w = rng.range(0.35, 0.6);
      const h = rng.range(0.35, 0.7);
      const yaw = rng.range(0, Math.PI);
      jitter(rng.pick(petals), rng, 0.05, 0.01, colour);
      if (rng.next() < patchy * ease(x, z) && dry(x, z)) win.put(1, x, inp.heightAt(x, z), z, yaw, 0, 0, w, h, w, colour);
    }
    for (let k = 0; k < caps[2]; k++) {
      const x = x0 + rng.next() * FIELD_CHUNK;
      const z = z0 + rng.next() * FIELD_CHUNK;
      const dens = 0.25 + 0.75 * smoothstep(0.35, 0.7, fbm(x / 7, z / 7, seed + 103, 3));
      const s = 0.05 + 0.4 * rng.next() ** 3.2;
      const yaw = rng.range(0, Math.PI * 2);
      const tilt = rng.range(-0.3, 0.3);
      const sx = s * rng.range(0.8, 1.4);
      const sy = s * rng.range(0.7, 1.1);
      jitter(stoneBase, rng, 0.08, 0.015, colour);
      if (rng.next() < dens * rocky(x, z) * ease(x, z) && dry(x, z)) win.put(2, x, inp.heightAt(x, z), z, yaw, tilt, tilt * 0.6, sx, sy, s, colour);
    }
    for (let k = 0; k < caps[4]; k++) {
      const x = x0 + rng.next() * FIELD_CHUNK;
      const z = z0 + rng.next() * FIELD_CHUNK;
      markShape(rng, plan);
      jitter(rng.pick(plan.colours), rng, 0.04, 0.01, colour);
      const dens = 0.08 + 0.92 * smoothstep(0.42, 0.68, fbm(x / 13 + 17, z / 13, seed + 113, 3));
      if (!(rng.next() < dens * ease(x, z) && dry(x, z))) continue;
      const gx = (inp.heightAt(x + 0.6, z) - inp.heightAt(x - 0.6, z)) / 1.2;
      const gz = (inp.heightAt(x, z + 0.6) - inp.heightAt(x, z - 0.6)) / 1.2;
      if (Math.hypot(gx, gz) > 0.45) continue;
      const cs = Math.cos(markDraw.yaw);
      const sn = Math.sin(markDraw.yaw);
      win.put(4, x, inp.heightAt(x, z), z, markDraw.yaw, -Math.atan(gx * sn + gz * cs), Math.atan(gx * cs - gz * sn), markDraw.sx, 1, markDraw.sz, colour);
    }
    for (let k = 0; k < caps[3]; k++) {
      const x = x0 + rng.next() * FIELD_CHUNK;
      const z = z0 + rng.next() * FIELD_CHUNK;
      const dens = 0.12 + 0.88 * smoothstep(0.45, 0.72, fbm(x / 9 + 40, z / 9, seed + 107, 3));
      const yaw = rng.range(0, 6.28);
      const u = rng.next();
      const v = rng.next();
      jitter(rng.pick(debrisBases), rng, 0.06, 0.015, colour);
      if (!(rng.next() < dens * ease(x, z) && dry(x, z))) continue;
      const y = inp.heightAt(x, z);
      if (kind === 'clump') { const s = 0.14 + 0.46 * u; win.put(3, x, y, z, yaw, 0, 0, s, s * (0.6 + 0.6 * v), s * (0.7 + 0.5 * v), colour); }
      else if (kind === 'shard') { const s = 0.05 + 0.17 * u; win.put(3, x, y, z, yaw, v - 0.5, 0.6 * (v - 0.5), s * 1.6, s * 0.5, s, colour); }
      else if (kind === 'twig') { const s = 0.18 + 0.42 * u; win.put(3, x, y, z, yaw, 0, 0, s, 1, 1, colour); }
      else { const s = kind === 'leaf' ? 0.07 + 0.08 * u : 0.12 + 0.18 * u; win.put(3, x, y, z, yaw, 0, 0, s, s, s * (0.7 + 0.4 * v), colour); }
    }
  });

  // Cards sit out any pass that draws with its own material (see buildScatter).
  layers.forEach((l, i) => {
    if (i === 2 || i === 3) return;
    let held = -1;
    l.mesh.onBeforeRender = (_renderer, _scene, _camera, _geometry, material) => {
      if (material !== l.mesh.material) { held = l.mesh.count; l.mesh.count = 0; }
    };
    l.mesh.onAfterRender = () => {
      if (held >= 0) { l.mesh.count = held; held = -1; }
    };
  });

  let disposed = false;
  return {
    group, window,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const l of layers) l.mesh.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) {
        if (m.map) releaseTexture(m.map);
        m.dispose();
      }
      group.clear();
    },
  };
}
