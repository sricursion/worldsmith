// Turns a TownLayout into three.js objects: ground, roads, buildings (kit mesh or procedural fallback),
// signs and props. Static geometry is merged per material with world transforms baked in; kit clones keep
// their own matrices (updated before return). Kit geometry and materials belong to the kit cache and are
// never disposed here.
import * as THREE from 'three';
import type { LoadedKit } from '../engine/assets';
import { makeRng } from '../world/rng';
import type { Blueprint, LandmarkSpec, WorldSpec } from '../world/spec';
import { GeoBatch, MaterialCache } from './batch';
import { addBlueprint } from './blueprint-mesh';
import { MAX_BUILDING_HEIGHT, PROP_SIZES } from './kits';
import { TRACK_WIDTH, buildingAabb, distanceToRoad, roadRect } from './layout';
import type { PlacedBuilding, Rect, TownLayout } from './layout';
import { addProceduralBuilding } from './procedural';
import type { ProcEnv } from './procedural';
import { addProceduralProp, isVisualOnlyProp, scatterBlueprintProps } from './props';
import { createSign, disposeSign } from './sign';

export { setSignLabel } from './sign';

export interface TownObjects {
  group: THREE.Group;
  /** Meshes for the navmesh and BVH, ground first (named "ground"). Roads and signs are not included. */
  statics: THREE.Mesh[];
  signs: Map<string, THREE.Object3D>;
  /** Building id -> the point 1 m outside its door on the street side. */
  doors: Map<string, THREE.Vector3>;
  /**
   * Swaps the plinth at a landmark's anchor for a loaded model: scaled to `heightMetres`, base on the
   * ground, centred on the anchor, facing the street. Unknown ids are ignored; a second call for the
   * same id replaces the first. The model's geometry and materials are disposed with the town.
   */
  placeLandmark?(id: string, object: THREE.Object3D, heightMetres: number): void;
  dispose(): void;
}

const GROUND_SIZE = 400;
const FIT_MIN = 0.4;
const FIT_MAX = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const hexOr = (c: string | undefined, fallback: string): string => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback);

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

const LANDMARK_ROAD_MARGIN = 1.2;
const LANDMARK_BUILDING_MARGIN = 1.5;

/**
 * Where a landmark stands. 'plaza': the first free spot found by searching outward from 3 m off the plaza
 * centre (the streets cross there, so the free spots are the plaza's corners). A building id: beside that
 * building's lot, toward the far end of its street, facing the same way as the building. Always off the
 * roads and outside every footprint.
 */
export function landmarkAnchor(layout: TownLayout, spec: WorldSpec, lm: LandmarkSpec): { x: number; z: number; rotY: number } {
  void spec;
  const boxes: Rect[] = layout.buildings.map((b) => buildingAabb(b));
  const free = (x: number, z: number): boolean => {
    if (layout.roads.some((r) => distanceToRoad(r, x, z) < LANDMARK_ROAD_MARGIN)) return false;
    const m = LANDMARK_BUILDING_MARGIN;
    if (boxes.some((r) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m)) return false;
    const bd = layout.bounds;
    return x >= bd.minX && x <= bd.maxX && z >= bd.minZ && z <= bd.maxZ;
  };
  const faceToward = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));
  const pl = layout.plaza;
  const building = lm.place === 'plaza' ? undefined : layout.buildings.find((b) => b.id === lm.place);
  if (building) {
    const ux = Math.cos(building.rotY);
    const uz = -Math.sin(building.rotY);
    const away = (building.x - pl.x) * ux + (building.z - pl.z) * uz >= 0 ? 1 : -1;
    for (const dir of [away, -away]) {
      for (let k = 0; k < 20; k++) {
        const off = dir * (building.w / 2 + 3 + k * 1.5);
        const x = building.x + ux * off;
        const z = building.z + uz * off;
        if (free(x, z)) return { x, z, rotY: building.rotY };
      }
    }
  }
  for (let r = 3; r < 60; r += 0.5) {
    for (let a = 0; a < 8; a++) {
      const ang = Math.PI / 4 + (a * Math.PI) / 4;
      const x = pl.x + Math.cos(ang) * r;
      const z = pl.z + Math.sin(ang) * r;
      if (free(x, z)) return { x, z, rotY: faceToward(x, z, layout.spawn.x, layout.spawn.z) };
    }
  }
  return { x: pl.x + 3, z: pl.z + 3, rotY: 0 };
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const ms: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

export function buildTown(layout: TownLayout, spec: WorldSpec, kit: LoadedKit, scene: THREE.Scene): TownObjects {
  const rng = makeRng(spec.seed, 'build');
  const group = new THREE.Group();
  group.name = 'town';
  const mats = new MaterialCache();
  const batch = new GeoBatch();
  // Small props render but are not in `statics`, so dense undergrowth does not carve the navmesh.
  const visualBatch = new GeoBatch();
  const env: ProcEnv = { batch, mats, theme: spec.theme };
  const ownGeos: THREE.BufferGeometry[] = [];
  const ownMats: THREE.Material[] = [];
  const signMeshes: THREE.Mesh[] = [];
  const statics: THREE.Mesh[] = [];
  const signs = new Map<string, THREE.Object3D>();
  const doors = new Map<string, THREE.Vector3>();
  const manifest = kit.manifest;
  const labels = new Map(spec.buildings.map((b) => [b.id, b.label]));
  const style = spec.style;
  const blueprints: Blueprint[] = style && spec.blueprints ? spec.blueprints : [];
  const bpMode = !!style && blueprints.length > 0;
  const bpById = new Map(blueprints.map((b) => [b.id, b]));
  const specBuildings = new Map(spec.buildings.map((b) => [b.id, b]));

  // Ground
  const groundColour = new THREE.Color(hexOr(style?.ground, manifest.ground.color || spec.palette.ground));
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
    color: style ? new THREE.Color(hexOr(style.road, '#6b6258')) : roadColour(groundColour, spec.theme), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
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
  const pathsMode = spec.site?.paths ?? 'road';
  const trackMat = new THREE.MeshStandardMaterial({
    color: (style ? new THREE.Color(hexOr(style.road, '#6b6258')) : roadColour(groundColour, spec.theme)).lerp(groundColour, 0.5),
    roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  ownMats.push(trackMat);
  for (const seg of pathsMode === 'none' ? [] : layout.roads) {
    const r = pathsMode === 'track' && seg.width > TRACK_WIDTH ? { ...seg, width: TRACK_WIDTH } : seg;
    const q = roadRect(r);
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    const cx = (q.minX + q.maxX) / 2;
    const cz = (q.minZ + q.maxZ) / 2;
    if (spec.theme === 'modern' && !style) {
      const wide = r.az === r.bz;
      flat(wide ? w : w + 3, wide ? d + 3 : d, cx, cz, 0.01, walkMat, 'pavement');
    }
    flat(w, d, cx, cz, 0.02, pathsMode === 'track' ? trackMat : roadMat, 'road');
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
  const centre = bpMode ? null : kit.building('plaza', 'small', rng);
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
  layout.buildings.forEach((b, index) => {
    doors.set(b.id, new THREE.Vector3(b.door.x, 0, b.door.z));
    if (style && bpMode) {
      // A building whose blueprint id is missing takes one of the town's archetypes by position, so the style stays whole.
      const bp = bpById.get(specBuildings.get(b.id)?.blueprint ?? '') ?? blueprints[index % blueprints.length];
      if (bp) {
        const res = addBlueprint(bp, style, b, { batch, mats, rng });
        doors.set(b.id, res.door);
        placeSign(b, clamp(res.height * 0.6, 2.4, 4.2), -b.d / 2);
        return;
      }
    }
    const obj = bpMode ? null : kit.building(b.role, b.size, rng);
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
  });

  // Props
  if (style && bpMode && spec.props?.length) {
    scatterBlueprintProps(layout.props, spec.props, style, { batch, mats, rng, visualBatch });
  } else for (const p of layout.props) {
    const obj = bpMode ? null : kit.prop(p.kind);
    const target = (PROP_SIZES[p.kind] ?? 1) * p.scale;
    const fitted = obj ? fit(obj, 0, 1, (s) => target / Math.max(s.x, s.y, s.z)) : null;
    if (fitted) {
      fitted.holder.position.set(p.x, 0, p.z);
      fitted.holder.rotation.y = p.rotY;
      fitted.holder.updateMatrixWorld(true);
      group.add(fitted.holder);
      if (spec.site && isVisualOnlyProp(target)) {
        fitted.holder.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      } else {
        enableShadows(fitted.holder, statics, ownGeos);
      }
    } else {
      addProceduralProp(isVisualOnlyProp(target) ? { ...env, batch: visualBatch } : env, p);
    }
  }

  // Landmark plinths: a low octagonal base with a glow ring, replaced when the model arrives.
  const anchors = new Map<string, { x: number; z: number; rotY: number }>();
  const plinths = new Map<string, THREE.Group>();
  const placedModels = new Map<string, THREE.Object3D>();
  if (spec.landmarks?.length) {
    const baseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hexOr(style?.dark, '#3a3633')), roughness: 0.9 });
    const glowColour = hexOr(style?.glow, spec.palette.accent);
    const glowMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(glowColour), emissive: new THREE.Color(glowColour), emissiveIntensity: 1.6, roughness: 0.5,
    });
    ownMats.push(baseMat, glowMat);
    for (const lm of spec.landmarks) {
      const a = landmarkAnchor(layout, spec, lm);
      anchors.set(lm.id, a);
      const plinth = new THREE.Group();
      plinth.name = `plinth:${lm.id}`;
      const baseGeo = new THREE.CylinderGeometry(1.6, 1.8, 0.3, 8);
      const ringGeo = new THREE.TorusGeometry(1.3, 0.06, 6, 24).rotateX(Math.PI / 2);
      ownGeos.push(baseGeo, ringGeo);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.15;
      const ring = new THREE.Mesh(ringGeo, glowMat);
      ring.position.y = 0.34;
      for (const m of [base, ring]) { m.castShadow = true; m.receiveShadow = true; plinth.add(m); }
      plinth.position.set(a.x, 0, a.z);
      plinth.rotation.y = a.rotY;
      group.add(plinth);
      plinths.set(lm.id, plinth);
    }
  }

  const merged = batch.build();
  for (const m of merged) {
    group.add(m);
    statics.push(m);
  }
  const visual = visualBatch.build();
  for (const m of visual) group.add(m);
  scene.add(group);
  group.updateMatrixWorld(true);

  let disposed = false;
  return {
    group, statics, signs, doors,
    placeLandmark(id: string, object: THREE.Object3D, heightMetres: number): void {
      const a = anchors.get(id);
      if (!a || disposed) return;
      const old = placedModels.get(id);
      if (old) {
        group.remove(old);
        disposeObject(old);
      }
      const plinth = plinths.get(id);
      if (plinth) {
        group.remove(plinth);
        plinths.delete(id);
      }
      const holder = new THREE.Group();
      holder.name = `landmark:${id}`;
      holder.add(object);
      holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(holder);
      const size = box.getSize(new THREE.Vector3());
      if (!box.isEmpty() && size.y > 0 && Number.isFinite(size.y)) {
        const k = clamp(heightMetres, 0.5, 40) / size.y;
        object.scale.multiplyScalar(k);
        holder.updateMatrixWorld(true);
        box.setFromObject(holder);
        const c = box.getCenter(new THREE.Vector3());
        object.position.x -= c.x;
        object.position.z -= c.z;
        object.position.y -= box.min.y;
      }
      holder.position.set(a.x, 0, a.z);
      holder.rotation.y = a.rotY;
      holder.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      holder.updateMatrixWorld(true);
      group.add(holder);
      placedModels.set(id, holder);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      for (const m of merged) m.geometry.dispose();
      for (const m of visual) m.geometry.dispose();
      for (const s of signMeshes) disposeSign(s);
      for (const g of ownGeos) g.dispose();
      for (const m of ownMats) m.dispose();
      for (const o of placedModels.values()) disposeObject(o);
      placedModels.clear();
      plinths.clear();
      mats.dispose();
      group.clear();
      statics.length = 0;
      signs.clear();
      doors.clear();
    },
  };
}
