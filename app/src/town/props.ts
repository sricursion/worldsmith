// Procedural fallback props, used when the kit has no mesh for a prop kind.
// Sizes follow PROP_SIZES at scale 1; the world matrix (position, yaw, scale) is baked into the batch.
import * as THREE from 'three';
import type { Rng } from '../world/rng';
import type { PropBlueprint, StyleSpec, ThemeId } from '../world/spec';
import type { GeoBatch, MaterialCache } from './batch';
import { addPropParts } from './blueprint-mesh';
import type { PlacedProp } from './layout';
import { Part } from './procedural';
import type { ProcEnv } from './procedural';

/** Props whose longest side is under this many metres are drawn but never block the navmesh. */
export const VISUAL_ONLY_SIZE = 0.8;
export const isVisualOnlyProp = (sizeMetres: number): boolean => sizeMetres < VISUAL_ONLY_SIZE;

const WOOD = '#7a5233';
const DARK_WOOD = '#4e3422';
const METAL = '#6a7078';

function cyl(rt: number, rb: number, h: number, seg = 12): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(rt, rb, h, seg);
}

function foliage(theme: ThemeId): string {
  return theme === 'modern' ? '#4f8a3c' : '#3f7a35';
}

export function addProceduralProp(env: ProcEnv, prop: PlacedProp): void {
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(prop.x, 0, prop.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prop.rotY),
    new THREE.Vector3(prop.scale, prop.scale, prop.scale),
  );
  const p = new Part(env, base);
  switch (prop.kind) {
    case 'barrel':
      p.geo(cyl(0.35, 0.32, 0.9), WOOD, 0, 0.45, 0);
      for (const y of [0.25, 0.65]) p.geo(cyl(0.37, 0.37, 0.06), METAL, 0, y, 0);
      break;
    case 'crate':
      p.box(0.9, 0.9, 0.9, 0, 0.45, 0, env.theme === 'scifi' ? '#7d8a96' : '#9a7448');
      p.box(0.94, 0.1, 0.94, 0, 0.45, 0, DARK_WOOD);
      break;
    case 'tree':
      p.geo(cyl(0.22, 0.32, 2.4, 8), '#5b4030', 0, 1.2, 0);
      p.geo(new THREE.ConeGeometry(1.7, 3.4, 9), foliage(env.theme), 0, 4.0, 0);
      break;
    case 'bush':
      p.geo(new THREE.IcosahedronGeometry(0.7, 1), '#4b7d3a', 0, 0.7, 0);
      break;
    case 'cactus':
      p.geo(new THREE.CapsuleGeometry(0.25, 1.5, 4, 8), '#4f7f4a', 0, 1.0, 0);
      p.geo(new THREE.CapsuleGeometry(0.15, 0.55, 4, 8), '#4f7f4a', 0.5, 1.2, 0);
      p.geo(new THREE.CapsuleGeometry(0.15, 0.4, 4, 8), '#4f7f4a', -0.45, 0.9, 0);
      p.box(0.9, 0.12, 0.12, 0.3, 0.95, 0, '#4f7f4a');
      break;
    case 'fence':
      for (const x of [-1.4, 0, 1.4]) p.box(0.14, 1.1, 0.14, x, 0.55, 0, WOOD);
      for (const y of [0.4, 0.85]) p.box(3, 0.1, 0.06, 0, y, 0, DARK_WOOD);
      break;
    case 'water_trough':
      p.box(2, 0.6, 0.7, 0, 0.3, 0, WOOD);
      p.box(1.8, 0.05, 0.5, 0, 0.58, 0, '#3f6f8f', { roughness: 0.2, metalness: 0.2 });
      for (const x of [-0.8, 0.8]) p.box(0.12, 0.3, 0.8, x, 0.15, 0, DARK_WOOD);
      break;
    case 'hitching_post':
      for (const x of [-0.9, 0.9]) p.box(0.16, 1.3, 0.16, x, 0.65, 0, DARK_WOOD);
      p.box(2.2, 0.1, 0.1, 0, 1.1, 0, WOOD);
      break;
    case 'wagon_wheel':
      p.geo(new THREE.TorusGeometry(0.6, 0.06, 6, 16), WOOD, 0, 0.66, 0);
      p.geo(cyl(0.1, 0.1, 0.14, 8).rotateX(Math.PI / 2), DARK_WOOD, 0, 0.66, 0);
      p.box(1.1, 0.05, 0.05, 0, 0.66, 0, WOOD);
      p.box(0.05, 1.1, 0.05, 0, 0.66, 0, WOOD);
      break;
    case 'well':
      p.geo(cyl(0.9, 0.9, 0.8, 14), '#8a8478', 0, 0.4, 0);
      p.geo(cyl(0.65, 0.65, 0.05, 14), '#2c4a5c', 0, 0.78, 0);
      for (const x of [-0.8, 0.8]) p.box(0.12, 1.8, 0.12, x, 1.4, 0, DARK_WOOD);
      p.geo(new THREE.ConeGeometry(1.3, 0.7, 4).rotateY(Math.PI / 4), '#7a4a35', 0, 2.65, 0);
      break;
    case 'cart':
      p.box(1.5, 0.15, 0.9, 0, 0.6, 0, WOOD);
      p.box(1.5, 0.4, 0.08, 0, 0.85, 0.42, DARK_WOOD);
      p.box(1.5, 0.4, 0.08, 0, 0.85, -0.42, DARK_WOOD);
      for (const z of [-0.5, 0.5]) p.geo(new THREE.TorusGeometry(0.4, 0.05, 6, 14), DARK_WOOD, 0, 0.45, z);
      p.box(1.2, 0.06, 0.06, 1.3, 0.55, 0, WOOD);
      break;
    case 'hay':
      p.box(1.2, 0.9, 0.8, 0, 0.45, 0, '#d1b258');
      p.box(1.22, 0.05, 0.82, 0, 0.3, 0, '#8a7438');
      p.box(1.22, 0.05, 0.82, 0, 0.62, 0, '#8a7438');
      break;
    case 'container':
      p.box(5.8, 2.4, 2.3, 0, 1.2, 0, env.theme === 'scifi' ? '#8a5a4a' : '#7a6a58');
      p.box(5.9, 0.12, 2.4, 0, 2.4, 0, '#4a4f58');
      p.box(5.9, 0.12, 2.4, 0, 0.06, 0, '#4a4f58');
      break;
    case 'antenna':
      p.geo(cyl(0.08, 0.12, 3.2, 6), METAL, 0, 1.6, 0);
      p.geo(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 3), '#d6dae0', 0, 3.1, 0);
      p.geo(new THREE.SphereGeometry(0.08, 6, 6), '#ff4d4d', 0, 3.3, 0, { emissive: '#ff4d4d', emissiveIntensity: 1.5 });
      break;
    case 'light_pole':
      p.geo(cyl(0.06, 0.09, 3.8, 8), METAL, 0, 1.9, 0);
      p.box(0.7, 0.08, 0.14, 0.3, 3.8, 0, METAL);
      p.geo(new THREE.SphereGeometry(0.16, 8, 6), '#fff2c4', 0.6, 3.72, 0, { emissive: '#ffe9a0', emissiveIntensity: 1.6 });
      break;
    case 'plant_pod':
      p.geo(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#9fd8e8', 0, 0.2, 0, { roughness: 0.2, metalness: 0.1 });
      p.geo(cyl(0.72, 0.8, 0.2, 12), '#4a5260', 0, 0.1, 0);
      p.geo(new THREE.ConeGeometry(0.25, 0.8, 6), '#4fb06a', 0, 0.55, 0);
      break;
    case 'bench':
      p.box(1.8, 0.1, 0.5, 0, 0.5, 0, WOOD);
      p.box(1.8, 0.45, 0.08, 0, 0.8, 0.22, WOOD);
      for (const x of [-0.8, 0.8]) p.box(0.08, 0.5, 0.45, x, 0.25, 0, METAL);
      break;
    case 'bin':
      p.geo(cyl(0.34, 0.28, 0.9, 10), '#3f5a45', 0, 0.45, 0);
      p.geo(cyl(0.37, 0.37, 0.06, 10), '#2c3d30', 0, 0.92, 0);
      break;
    case 'hydrant':
      p.geo(cyl(0.16, 0.18, 0.7, 8), '#c43b2f', 0, 0.35, 0);
      p.geo(new THREE.SphereGeometry(0.17, 8, 6), '#c43b2f', 0, 0.75, 0);
      p.box(0.5, 0.12, 0.12, 0, 0.5, 0, '#c43b2f');
      break;
    case 'car': {
      const body = ['#b23a3a', '#3a5ab2', '#d8d8d8', '#2f2f35'][Math.abs(Math.round(prop.x * 7 + prop.z * 13)) % 4] ?? '#b23a3a';
      p.box(1.8, 0.6, 4.2, 0, 0.6, 0, body);
      p.box(1.6, 0.55, 2.2, 0, 1.15, -0.2, '#9cc2d8', { roughness: 0.2, metalness: 0.3 });
      for (const sx of [-1, 1]) for (const z of [-1.3, 1.3]) p.geo(cyl(0.35, 0.35, 0.25, 10).rotateZ(Math.PI / 2), '#1e1f22', sx * 0.9, 0.35, z);
      break;
    }
    default:
      p.box(0.7, 0.7, 0.7, 0, 0.35, 0, '#a08060');
  }
}

/**
 * Scatters generated prop kinds over the layout's prop slots. Each slot takes one spec prop, picked by
 * weight with the rng; the slot's position, yaw and scale are kept. Returns how many were placed per kind.
 */
export function scatterBlueprintProps(
  slots: readonly PlacedProp[], kinds: readonly PropBlueprint[], style: StyleSpec,
  env: { batch: GeoBatch; mats: MaterialCache; rng: Rng; visualBatch?: GeoBatch },
): Map<string, number> {
  const counts = new Map<string, number>();
  const usable = kinds.filter((k) => k.parts.length > 0);
  if (usable.length === 0) return counts;
  const weights = usable.map((k) => Math.min(5, Math.max(1, Number.isFinite(k.weight) ? k.weight : 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  for (const slot of slots) {
    let t = env.rng.next() * total;
    let idx = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      t -= weights[i] ?? 0;
      if (t < 0) { idx = i; break; }
    }
    const kind = usable[idx];
    if (!kind) continue;
    const small = isVisualOnlyProp(kind.size * slot.scale);
    const target = small && env.visualBatch ? env.visualBatch : env.batch;
    addPropParts(kind.parts, kind.size, style, slot, { batch: target, mats: env.mats, rng: env.rng });
    counts.set(kind.kind, (counts.get(kind.kind) ?? 0) + 1);
  }
  return counts;
}
