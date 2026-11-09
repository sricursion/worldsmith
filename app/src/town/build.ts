// Turns a TownLayout into three.js objects: ground, roads, buildings (kit mesh or procedural fallback),
// signs and props. Static geometry is merged per material with world transforms baked in; kit clones keep
// their own matrices (updated before return). Kit geometry and materials belong to the kit cache and are
// never disposed here.
import * as THREE from 'three';
import type { LoadedKit } from '../engine/assets';
import { makeRng } from '../world/rng';
import type { WorldSpec } from '../world/spec';
import { GeoBatch, MaterialCache } from './batch';
import { MAX_BUILDING_HEIGHT, PROP_SIZES } from './kits';
import { roadRect } from './layout';
import type { PlacedBuilding, TownLayout } from './layout';
import { addProceduralBuilding } from './procedural';
import type { ProcEnv } from './procedural';
import { addProceduralProp } from './props';
import { createSign, disposeSign } from './sign';

export { setSignLabel } from './sign';

export interface TownObjects {
  group: THREE.Group;
  /** Meshes for the navmesh and BVH, ground first (named "ground"). Roads and signs are not included. */
  statics: THREE.Mesh[];
  signs: Map<string, THREE.Object3D>;
  /** Building id -> the point 1 m outside its door on the street side. */
  doors: Map<string, THREE.Vector3>;
  dispose(): void;
}

const GROUND_SIZE = 400;
const FIT_MIN = 0.4;
const FIT_MAX = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Kit meshes decoded by meshopt keep quantised, interleaved attributes (Int16 positions with a
 * dequantising scale). The navmesh and BVH readers take position arrays verbatim, so every kit mesh
 * gets an invisible float-baked collider with its world transform applied, and that is what goes
 * into `statics`. The visible mesh stays as loaded.
 */
function colliderFor(mesh: THREE.Mesh): THREE.Mesh {
  mesh.updateMatrixWorld(true);
  const src = mesh.geometry.getAttribute('position');
  const pos = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) {
    pos[i * 3] = src.getX(i);
    pos[i * 3 + 1] = src.getY(i);
    pos[i * 3 + 2] = src.getZ(i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = mesh.geometry.getIndex();
  if (idx) g.setIndex(idx.clone());
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, COLLIDER_MATERIAL);
  m.name = `collider:${mesh.name}`;
  m.matrixAutoUpdate = false;
  m.visible = false;
  return m;
}

function enableShadows(root: THREE.Object3D, statics: THREE.Mesh[], ownGeos: THREE.BufferGeometry[]): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const c = colliderFor(o);
      ownGeos.push(c.geometry);
      statics.push(c);
    }
  });
}

interface Fitted { holder: THREE.Group; size: THREE.Vector3 }

/** Wraps a kit clone in a holder, scaled by `scaleFor(size)` and re-centred on x/z with its base at y = 0. */
function fit(obj: THREE.Object3D, yaw: number, preScale: number, scaleFor: (size: THREE.Vector3) => number): Fitted | null {
  const holder = new THREE.Group();
  obj.rotation.y = yaw;
  obj.scale.multiplyScalar(preScale);
  holder.add(obj);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  if (box.isEmpty() || size.x <= 0 || size.y <= 0 || size.z <= 0) return null;
  obj.scale.multiplyScalar(scaleFor(size));
  holder.updateMatrixWorld(true);
  box.setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
  holder.updateMatrixWorld(true);
  return { holder, size: box.getSize(size) };
}

function roadColour(ground: THREE.Color, theme: WorldSpec['theme']): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  ground.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, hsl.s * 0.9, hsl.l * (theme === 'modern' ? 0.6 : 0.68));
}

export function buildTown(layout: TownLayout, spec: WorldSpec, kit: LoadedKit, scene: THREE.Scene): TownObjects {
  const rng = makeRng(spec.seed, 'build');
  const group = new THREE.Group();
  group.name = 'town';
  const mats = new MaterialCache();
  const batch = new GeoBatch();
  const env: ProcEnv = { batch, mats, theme: spec.theme };
  const ownGeos: THREE.BufferGeometry[] = [];
  const ownMats: THREE.Material[] = [];
  const signMeshes: THREE.Mesh[] = [];
  const statics: THREE.Mesh[] = [];
  const signs = new Map<string, THREE.Object3D>();
  const doors = new Map<string, THREE.Vector3>();
  const manifest = kit.manifest;
  const labels = new Map(spec.buildings.map((b) => [b.id, b.label]));

  // Ground
  const groundColour = new THREE.Color(manifest.ground.color || spec.palette.ground);
  const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({ color: groundColour, roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.name = 'ground';
  ground.receiveShadow = true;
  ownGeos.push(groundGeo);
  ownMats.push(groundMat);
  group.add(ground);
  statics.push(ground);

  // Roads (flat, 2 cm above ground), pavement tint for modern, plaza disc
  const roadMat = new THREE.MeshStandardMaterial({
    color: roadColour(groundColour, spec.theme), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const walkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8a8d92'), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  ownMats.push(roadMat, walkMat);
  const flat = (w: number, d: number, cx: number, cz: number, y: number, m: THREE.Material, name: string): void => {
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(cx, y, cz);
    mesh.receiveShadow = true;
    mesh.name = name;
    ownGeos.push(g);
    group.add(mesh);
  };
  for (const r of layout.roads) {
    const q = roadRect(r);
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    const cx = (q.minX + q.maxX) / 2;
    const cz = (q.minZ + q.maxZ) / 2;
    if (spec.theme === 'modern') {
      const wide = r.az === r.bz;
      flat(wide ? w : w + 3, wide ? d + 3 : d, cx, cz, 0.01, walkMat, 'pavement');
    }
    flat(w, d, cx, cz, 0.02, roadMat, 'road');
  }
  const plazaMat = new THREE.MeshStandardMaterial({
    color: groundColour.clone().lerp(new THREE.Color('#d6cfc2'), 0.45), roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const plazaGeo = new THREE.CircleGeometry(layout.plaza.r, 48).rotateX(-Math.PI / 2);
  const plazaMesh = new THREE.Mesh(plazaGeo, plazaMat);
  plazaMesh.position.set(layout.plaza.x, 0.03, layout.plaza.z);
  plazaMesh.receiveShadow = true;
  plazaMesh.name = 'plaza';
  ownGeos.push(plazaGeo);
  ownMats.push(plazaMat);
  group.add(plazaMesh);

  // Plaza centrepiece, only when the kit has one (medieval well, scifi pad)
  const centre = kit.building('plaza', 'small', rng);
  if (centre) {
    const f = fit(centre, manifest.facingOffset ?? 0, manifest.unitScale ?? 1, (s) => 3.2 / Math.max(s.x, s.z));
    if (f) {
      f.holder.position.set(layout.plaza.x, 0.03, layout.plaza.z);
      f.holder.updateMatrixWorld(true);
      group.add(f.holder);
      enableShadows(f.holder, statics, ownGeos);
    }
  }

  // Buildings
  const placeSign = (b: PlacedBuilding, y: number, zFront: number): void => {
    const width = clamp(b.w * 0.55, 2.4, 4.4);
    const sign = createSign(labels.get(b.id) ?? b.id, spec.palette.accent, width);
    const local = new THREE.Vector3(0, y, zFront - 0.08).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.rotY);
    sign.position.set(b.x + local.x, local.y, b.z + local.z);
    sign.rotation.y = b.rotY;
    group.add(sign);
    signMeshes.push(sign);
    signs.set(b.id, sign);
  };
  const maxH = MAX_BUILDING_HEIGHT;
  for (const b of layout.buildings) {
    doors.set(b.id, new THREE.Vector3(b.door.x, 0, b.door.z));
    const obj = kit.building(b.role, b.size, rng);
    const fitted = obj
      ? fit(obj, manifest.facingOffset ?? 0, manifest.unitScale ?? 1, (s) => {
          const f = manifest.scaleToFootprint === false ? 1 : clamp(Math.min(b.w / s.x, b.d / s.z), FIT_MIN, FIT_MAX);
          return Math.min(f, maxH[b.size] / s.y);
        })
      : null;
    if (fitted) {
      fitted.holder.position.set(b.x, 0, b.z);
      fitted.holder.rotation.y = b.rotY;
      fitted.holder.updateMatrixWorld(true);
      group.add(fitted.holder);
      enableShadows(fitted.holder, statics, ownGeos);
      placeSign(b, clamp(fitted.size.y * 0.6, 2.8, 4.2), -fitted.size.z / 2);
    } else {
      const res = addProceduralBuilding(env, b, spec.palette.accent, rng);
      placeSign(b, res.signY, -b.d / 2);
    }
  }

  // Props
  for (const p of layout.props) {
    const obj = kit.prop(p.kind);
    const target = (PROP_SIZES[p.kind] ?? 1) * p.scale;
    const fitted = obj ? fit(obj, 0, 1, (s) => target / Math.max(s.x, s.y, s.z)) : null;
    if (fitted) {
      fitted.holder.position.set(p.x, 0, p.z);
      fitted.holder.rotation.y = p.rotY;
      fitted.holder.updateMatrixWorld(true);
      group.add(fitted.holder);
      enableShadows(fitted.holder, statics, ownGeos);
    } else {
      addProceduralProp(env, p);
    }
  }

  const merged = batch.build();
  for (const m of merged) {
    group.add(m);
    statics.push(m);
  }
  scene.add(group);
  group.updateMatrixWorld(true);

  let disposed = false;
  return {
    group, statics, signs, doors,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      for (const m of merged) m.geometry.dispose();
      for (const s of signMeshes) disposeSign(s);
      for (const g of ownGeos) g.dispose();
      for (const m of ownMats) m.dispose();
      mats.dispose();
      group.clear();
      statics.length = 0;
      signs.clear();
      doors.clear();
    },
  };
}
