// Standing and running water (and what stands in for it: lava, acid, ice, a sea of mist) as drawn surfaces.
// The land is already carved to hold each body (see makeLand); here every body gets a level sheet of
// triangles over the ground that lies below its surface, each vertex carrying the depth of water under it.
// One shader, set by uniforms per kind, turns that into depth-tinted colour, a soft foam line at the shore,
// moving ripples, glowing flow for lava and cracked ice for an ice sheet. Time comes from the scatter's wind
// clock, which the game already advances every frame.
import * as THREE from 'three';
import type { Rect, WaterBody } from './layout';
import { waterInside } from './layout';
import { WIND } from './scatter';
import type { Land, Quality } from './terrain';

export type WaterKind = WaterBody['kind'];

export interface WaterLook {
  shallow: string; deep: string; foam: string;
  /** Opacity over the shallows and over deep water. */
  alpha0: number; alpha1: number;
  /** Depth at which the colour is fully `deep`, and the depth the foam line reaches to, metres. */
  fade: number; foamDepth: number; foamAmount: number;
  roughness: number; metalness: number;
  /** Ripple height, ripple size in metres, and how fast the pattern travels. */
  bump: number; scale: number; speed: number;
  /** Emissive strength of the flow pattern (lava, acid) and its colour. */
  glow: number; glowColour: string;
  /** How strongly dark cracks are drawn (ice). */
  crack: number;
  opaque: boolean;
}

const LOOKS: Record<WaterKind, WaterLook> = {
  pond: { shallow: '#4f6a5a', deep: '#16261f', foam: '#c9d4cc', alpha0: 0.35, alpha1: 0.92, fade: 1.0, foamDepth: 0.12, foamAmount: 0.35, roughness: 0.08, metalness: 0, bump: 0.25, scale: 2.2, speed: 0.25, glow: 0, glowColour: '#000000', crack: 0, opaque: false },
  lake: { shallow: '#4b6f78', deep: '#0f2530', foam: '#d5dedf', alpha0: 0.35, alpha1: 0.95, fade: 2.4, foamDepth: 0.18, foamAmount: 0.5, roughness: 0.07, metalness: 0, bump: 0.35, scale: 3.4, speed: 0.4, glow: 0, glowColour: '#000000', crack: 0, opaque: false },
  river: { shallow: '#56736a', deep: '#14292b', foam: '#d8e0dc', alpha0: 0.4, alpha1: 0.93, fade: 1.3, foamDepth: 0.22, foamAmount: 0.7, roughness: 0.1, metalness: 0, bump: 0.5, scale: 1.8, speed: 1.1, glow: 0, glowColour: '#000000', crack: 0, opaque: false },
  shore: { shallow: '#5f8a8c', deep: '#0d2a3a', foam: '#e6ecea', alpha0: 0.4, alpha1: 0.97, fade: 4.5, foamDepth: 0.35, foamAmount: 0.9, roughness: 0.09, metalness: 0, bump: 0.6, scale: 4.5, speed: 0.7, glow: 0, glowColour: '#000000', crack: 0, opaque: false },
  lava: { shallow: '#2a1410', deep: '#160b09', foam: '#3a1c12', alpha0: 1, alpha1: 1, fade: 1.2, foamDepth: 0.3, foamAmount: 0.6, roughness: 0.75, metalness: 0, bump: 0.5, scale: 2.6, speed: 0.12, glow: 3.2, glowColour: '#ff5a14', crack: 0, opaque: true },
  acid: { shallow: '#5d7a2a', deep: '#22380f', foam: '#c9de7a', alpha0: 0.6, alpha1: 0.95, fade: 1.0, foamDepth: 0.2, foamAmount: 0.6, roughness: 0.12, metalness: 0, bump: 0.3, scale: 2.0, speed: 0.3, glow: 0.5, glowColour: '#9be03a', crack: 0, opaque: false },
  ice_sheet: { shallow: '#b9c8d0', deep: '#7f9aa8', foam: '#e8eef0', alpha0: 1, alpha1: 1, fade: 0.5, foamDepth: 0.15, foamAmount: 0.8, roughness: 0.22, metalness: 0, bump: 0.06, scale: 3.0, speed: 0, glow: 0, glowColour: '#000000', crack: 0.55, opaque: true },
  mist_sea: { shallow: '#c8cdd2', deep: '#aeb6be', foam: '#dfe3e6', alpha0: 0.25, alpha1: 0.94, fade: 5, foamDepth: 0.01, foamAmount: 0, roughness: 1, metalness: 0, bump: 0.12, scale: 26, speed: 1.6, glow: 0, glowColour: '#000000', crack: 0, opaque: false },
};

/** The look of a kind of water. A copy: callers may tint it. */
export function waterLook(kind: WaterKind): WaterLook {
  return { ...LOOKS[kind] };
}

const NOISE = /* glsl */ `
uniform float uWaterTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uGlowColour;
uniform vec4 uWaterA; // alpha0, alpha1, fade depth, foam depth
uniform vec4 uWaterB; // foam amount, bump, 1 / scale, speed
uniform vec2 uWaterC; // glow, crack
varying float vWaterDepth;
varying vec2 vWaterXZ;
float wHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float wField(vec2 p) {
  float t = uWaterTime * uWaterB.w;
  return 0.6 * wNoise(p + t * vec2(0.31, 0.17)) + 0.4 * wNoise(p * 2.3 - t * vec2(0.19, 0.37) + 7.1);
}
`;

/**
 * The material of one kind of water. Standard lighting, so it takes the sun, the sky and the fog like the
 * rest of the world; the surface itself is written in onBeforeCompile. The geometry it goes on must carry a
 * float attribute `waterDepth` and sit in world space.
 */
export function waterMaterial(look: WaterLook): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffffff'), roughness: look.roughness, metalness: look.metalness,
    transparent: !look.opaque, depthWrite: look.opaque, envMapIntensity: 1.3,
  });
  const uniforms = {
    uWaterTime: WIND.time,
    uShallow: { value: new THREE.Color(look.shallow) },
    uDeep: { value: new THREE.Color(look.deep) },
    uFoam: { value: new THREE.Color(look.foam) },
    uGlowColour: { value: new THREE.Color(look.glowColour) },
    uWaterA: { value: new THREE.Vector4(look.alpha0, look.alpha1, Math.max(0.05, look.fade), Math.max(0.01, look.foamDepth)) },
    uWaterB: { value: new THREE.Vector4(look.foamAmount, look.bump, 1 / Math.max(0.1, look.scale), look.speed) },
    uWaterC: { value: new THREE.Vector2(look.glow, look.crack) },
  };
  m.userData.water = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float waterDepth;\nvarying float vWaterDepth;\nvarying vec2 vWaterXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterDepth = waterDepth;\nvWaterXZ = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec2 wP = vWaterXZ * uWaterB.z;
        float wN = wField(wP);
        float wDeepness = smoothstep(0.0, uWaterA.z, vWaterDepth);
        float wRidge = 1.0 - abs(2.0 * wNoise(wP * 0.9 + 3.7) - 1.0);
        float wCrack = smoothstep(0.93, 0.995, wRidge) * uWaterC.y;
        float wEdge = 1.0 - smoothstep(0.0, uWaterA.w, vWaterDepth);
        float wFoam = clamp(wEdge * smoothstep(0.3, 0.6, wN + 0.35 * wEdge), 0.0, 1.0) * uWaterB.x;
        diffuseColor.rgb = mix(uShallow, uDeep, wDeepness) * (1.0 - 0.7 * wCrack);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, wFoam);
        diffuseColor.a = max(mix(uWaterA.x, uWaterA.y, wDeepness), wFoam) * smoothstep(-0.1, 0.02, vWaterDepth);`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          float wE = 0.12;
          float wH0 = wField(wP);
          float wHx = wField(wP + vec2(wE, 0.0));
          float wHz = wField(wP + vec2(0.0, wE));
          vec3 wUp = normalize(vec3((wH0 - wHx) * uWaterB.y / wE * 0.3, 1.0, (wH0 - wHz) * uWaterB.y / wE * 0.3));
          normal = normalize((viewMatrix * vec4(wUp, 0.0)).xyz);
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          // Flow that glows: bright veins between drifting plates of crust, hottest where the crust is thin.
          float wVein = pow(clamp(wRidge, 0.0, 1.0), 5.0) + 0.35 * smoothstep(0.55, 0.9, wN);
          totalEmissiveRadiance += uGlowColour * uWaterC.x * wVein * (0.35 + 0.65 * wDeepness);
          float wFresnel = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
          diffuseColor.a = mix(diffuseColor.a, max(diffuseColor.a, 0.96), wFresnel * step(0.001, diffuseColor.a));
        }`);
  };
  m.customProgramCacheKey = () => 'town-water';
  return m;
}

const growRect = (r: Rect, m: number): Rect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
const meet = (a: Rect, b: Rect): Rect => ({ minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX), minZ: Math.max(a.minZ, b.minZ), maxZ: Math.min(a.maxZ, b.maxZ) });

/** The rectangle a body can lie in. */
function bodyBox(body: WaterBody, all: Rect): Rect {
  const a = body.area;
  if (a.shape === 'disc') return growRect({ minX: a.x, maxX: a.x, minZ: a.z, maxZ: a.z }, a.r * (1 + Math.abs(a.wobble)) + 2);
  if (a.shape === 'band') {
    let box: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const p of a.pts) box = { minX: Math.min(box.minX, p.x), maxX: Math.max(box.maxX, p.x), minZ: Math.min(box.minZ, p.z), maxZ: Math.max(box.maxZ, p.z) };
    return growRect(box, a.half + 2);
  }
  return all;
}

export interface WaterSheet { positions: Float32Array; depth: Float32Array; index: Uint32Array }

/**
 * The surface of one body as triangles at its level: a grid of `step` metres over `region`, keeping the
 * cells that have water under at least one corner. Cells whose centre lies in `hole` are left to a finer sheet.
 */
export function waterSheet(land: Land, body: WaterBody, level: number, region: Rect, step: number, hole?: Rect): WaterSheet {
  const nx = Math.max(1, Math.ceil((region.maxX - region.minX) / step));
  const nz = Math.max(1, Math.ceil((region.maxZ - region.minZ) / step));
  const sheet = body.area.shape === 'sheet';
  const depth = new Float32Array((nx + 1) * (nz + 1));
  const has = new Uint8Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = region.minX + i * step;
      const z = region.minZ + j * step;
      const d = level - land.heightAt(x, z);
      const o = j * (nx + 1) + i;
      depth[o] = d;
      // Low ground far from a body is not flooded by it: only a sheet takes every hollow.
      has[o] = d > 0 && (sheet || waterInside(body, x, z) > -1.5) ? 1 : 0;
    }
  }
  const remap = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
  const pos: number[] = [];
  const dep: number[] = [];
  const idx: number[] = [];
  const vert = (o: number, i: number, j: number): number => {
    let v = remap[o] as number;
    if (v < 0) {
      v = pos.length / 3;
      pos.push(region.minX + i * step, level, region.minZ + j * step);
      dep.push(Math.max(-0.5, Math.min(40, depth[o] as number)));
      remap[o] = v;
    }
    return v;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = j * (nx + 1) + i;
      if (!(has[o] || has[o + 1] || has[o + nx + 1] || has[o + nx + 2])) continue;
      if (hole) {
        const x = region.minX + (i + 0.5) * step;
        const z = region.minZ + (j + 0.5) * step;
        if (x > hole.minX && x < hole.maxX && z > hole.minZ && z < hole.maxZ) continue;
      }
      const a = vert(o, i, j);
      const b = vert(o + 1, i + 1, j);
      const c = vert(o + nx + 1, i, j + 1);
      const d = vert(o + nx + 2, i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  return { positions: new Float32Array(pos), depth: new Float32Array(dep), index: new Uint32Array(idx) };
}

export interface WaterInput {
  land: Land;
  quality: Quality;
  /** How far from the middle of the bounds wide water (sea, mist, swamp) is drawn, metres. */
  reach: number;
  /** Tints the look of a kind before its material is made (the style's glow on lava, say). */
  tint?: (kind: WaterKind, look: WaterLook) => void;
}

export interface WaterSet {
  group: THREE.Group;
  /** One entry per body, for sound and life: a disc that stands for it and the height of its surface. */
  bodies: { kind: WaterKind; x: number; z: number; r: number; level: number }[];
  triangles: number;
  dispose(): void;
}

/** Every body of water the land holds, drawn. Nothing here collides or feeds the navmesh. */
export function buildWater(inp: WaterInput): WaterSet {
  const { land } = inp;
  const group = new THREE.Group();
  group.name = 'water';
  const geos: THREE.BufferGeometry[] = [];
  const mats = new Map<WaterKind, THREE.MeshStandardMaterial>();
  const bodies: WaterSet['bodies'] = [];
  let triangles = 0;
  const b = land.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const fine = inp.quality === 2 ? 1.5 : inp.quality === 1 ? 2 : 3;
  // The near sheet covers the place and a margin; its sides are whole multiples of the far sheet's cells.
  const coarse = fine * 6;
  const snap = (v: number): number => Math.ceil(v / coarse) * coarse;
  const hx = snap((b.maxX - b.minX) / 2 + 30);
  const hz = snap((b.maxZ - b.minZ) / 2 + 30);
  const near: Rect = { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
  const far = growRect(near, snap(Math.max(coarse, inp.reach - Math.min(hx, hz))));
  const emit = (kind: WaterKind, s: WaterSheet, name: string): void => {
    if (s.index.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
    g.setAttribute('waterDepth', new THREE.BufferAttribute(s.depth, 1));
    const n = s.positions.length / 3;
    const normal = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      normal[i * 3 + 1] = 1;
      uv[i * 2] = s.positions[i * 3] as number;
      uv[i * 2 + 1] = s.positions[i * 3 + 2] as number;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(s.index, 1));
    g.computeBoundingSphere();
    geos.push(g);
    let mat = mats.get(kind);
    if (!mat) {
      const look = waterLook(kind);
      inp.tint?.(kind, look);
      mat = waterMaterial(look);
      mats.set(kind, mat);
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    triangles += s.index.length / 3;
  };
  for (const w of land.water) {
    const box = bodyBox(w.body, far);
    const inNear = meet(box, near);
    if (inNear.maxX > inNear.minX && inNear.maxZ > inNear.minZ) {
      // Snapped to the fine grid of the near sheet so a body's own sheet lines up with the far one at the seam.
      const snapped: Rect = {
        minX: near.minX + Math.floor((inNear.minX - near.minX) / fine) * fine, maxX: near.minX + Math.ceil((inNear.maxX - near.minX) / fine) * fine,
        minZ: near.minZ + Math.floor((inNear.minZ - near.minZ) / fine) * fine, maxZ: near.minZ + Math.ceil((inNear.maxZ - near.minZ) / fine) * fine,
      };
      emit(w.kind, waterSheet(land, w.body, w.level, snapped, fine), `water:${w.kind}`);
    }
    const inFar = meet(box, far);
    if (w.body.area.shape !== 'disc' && inFar.maxX > inFar.minX && inFar.maxZ > inFar.minZ) {
      emit(w.kind, waterSheet(land, w.body, w.level, far, coarse, near), `water-far:${w.kind}`);
    }
    bodies.push({ kind: w.kind, x: w.body.x, z: w.body.z, r: w.body.r, level: w.level });
  }
  let disposed = false;
  return {
    group, bodies, triangles,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const g of geos) g.dispose();
      for (const m of mats.values()) m.dispose();
      mats.clear();
      group.clear();
    },
  };
}
