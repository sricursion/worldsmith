// Turns a TownLayout into three.js objects: terrain and horizon, roads, buildings (blueprint, kit mesh or
// procedural fallback), signs, props, set dressing and ground scatter. Static geometry is merged per material
// with world transforms baked in; kit clones keep their own matrices (updated before return). Kit geometry
// and materials belong to the kit cache and are never disposed here.
//
// `statics` is what the navmesh and the camera collide with: an invisible mesh named "ground" first, then
// buildings and solid props. The visible terrain, roads, puddles, decals, scatter, water and the horizon ring
// are drawn only.
//
// A spec that carries WorldSpec.terrain has relief (see makeLand). Then "ground" is the walk mesh: the land
// inside the bounds plus a margin, without deep water. Nothing else changes shape for it: the land is level
// under every footprint, so a building is built as it always was and lifted whole onto its pad, each prop is
// lifted to the ground under its own middle, and flat things (roads, decals, puddles) are draped over the
// land vertex by vertex. Without terrain every height is zero and the town is built exactly as before.
import * as THREE from 'three';
import type { LoadedKit } from '../engine/assets';
import { makeRng } from '../world/rng';
import type { Blueprint, LandmarkSpec, StyleSpec, SurfaceSet, WorldSpec } from '../world/spec';
import { GeoBatch, MaterialCache } from './batch';
import { addBlueprint } from './blueprint-mesh';
import { MAX_BUILDING_HEIGHT, PROP_SIZES } from './kits';
import { buildingAabb, distanceToRoad, roadRect } from './layout';
import type { PlacedBuilding, Rect, TownLayout } from './layout';
import { addProceduralBuilding } from './procedural';
import type { ProcEnv } from './procedural';
import { MAX_POLES, POLE_SPACING, addProceduralProp, buildBackdrop, dressTown, isVisualOnlyProp, scatterBlueprintProps } from './props';
import type { TownLight } from './props';
import { buildScatter } from './scatter';
import { createSign, disposeSign } from './sign';
import { groundMaterial, inferSurfaces, roadMaterial } from './surfaces';
import {
  buildGroundGeometry, buildHorizonGeometry, buildRoadGeometry, buildWalkGeometry, groundHalfExtent, horizonForms, horizonKindFor,
  horizonPalette, makeLand, makeTerrainField,
} from './terrain';
import type { Quality } from './terrain';
import { buildWater } from './water';
import type { WaterKind } from './water';

export { setSignLabel } from './sign';
export type { TownLight } from './props';

export interface BuildOptions {
  /** 0 integrated graphics, 1 mid, 2 discrete GPU (default). Sets ground resolution, scatter count and dressing density. */
  quality?: Quality;
}

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
  /** Lanterns by doors and on strung lines: where the lighting may put real lights. Radius in metres. */
  lights?: TownLight[];
  /** Chimney tops and vents: where smoke or steam should rise. */
  smoke?: THREE.Vector3[];
  /**
   * Height of the land at a point, metres. The spawn point is at 0. Zero over a town without terrain.
   * Everything the town places stands on this; so must whatever the game places (people, creatures, markers).
   */
  heightAt(x: number, z: number): number;
  /**
   * The walkable land as a triangle mesh in world space (plain float positions, identity matrix): what the
   * navmesh is built on. With terrain it is the land inside the bounds plus WALK_MARGIN, without water deeper
   * than a person wades, and it is the same mesh as statics[0]. Without terrain it is a level rectangle over
   * the bounds plus WALK_MARGIN. Disposed with the town.
   */
  walkMesh: THREE.Mesh;
  /** True when the spec carried terrain: the land has relief and may hold water. */
  shaped: boolean;
  /** Bodies of water (or lava, ice, mist), each as a disc that stands for it, with the height of its surface. */
  waterBodies: { kind: WaterKind; x: number; z: number; r: number; level: number }[];
  /** Depth of water standing at a point, metres; 0 on dry land. */
  waterDepthAt(x: number, z: number): number;
  dispose(): void;
}

const GROUND_SIZE = 400;
/** Metres of walkable land kept around the bounds. */
export const WALK_MARGIN = 18;
const FIT_MIN = 0.4;
const FIT_MAX = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const hexOr = (c: string | undefined, fallback: string): string => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback);

const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

/**
 * A batch for shaped land: everything added is lifted onto the ground. While `seat.y` is set (one building,
 * one prop) that height is used for every piece, so the thing stays whole; otherwise each piece is lifted
 * to the land under its own middle, which is right for dressing that leans on a building or lies about.
 */
class LandBatch extends GeoBatch {
  private readonly box = new THREE.Box3();
  private readonly mid = new THREE.Vector3();

  constructor(private readonly heightAt: (x: number, z: number) => number, private readonly seat: { y: number | null }) {
    super();
  }

  override add(geo: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    let y = this.seat.y;
    if (y === null) {
      this.box.setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
      this.box.getCenter(this.mid);
      if (matrix) this.mid.applyMatrix4(matrix);
      y = this.heightAt(this.mid.x, this.mid.z);
    }
    const lifted = new THREE.Matrix4().makeTranslation(0, y, 0);
    if (matrix) lifted.multiply(matrix);
    super.add(geo, material, lifted);
  }
}

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

const THEME_STYLE: Record<WorldSpec['theme'], Pick<StyleSpec, 'name' | 'wall' | 'wall2' | 'roof' | 'trim' | 'dark' | 'glass' | 'glow'>> = {
  western: { name: 'weathered frontier timber', wall: '#8b5a3c', wall2: '#a0703f', roof: '#5b4030', trim: '#c9b48a', dark: '#2b2118', glass: '#6f9bb8', glow: '#ffd27a' },
  medieval: { name: 'plaster and timber', wall: '#d9c9a3', wall2: '#8d6e52', roof: '#8a3b2b', trim: '#e0d2b4', dark: '#2f2a26', glass: '#6f9bb8', glow: '#ffd98a' },
  scifi: { name: 'metal panel outpost', wall: '#c8ccd4', wall2: '#98a4b4', roof: '#586070', trim: '#d8dce2', dark: '#2a2e36', glass: '#3a4a58', glow: '#8fe3ff' },
  modern: { name: 'concrete and glass', wall: '#d8d4cc', wall2: '#b9c0c8', roof: '#6f7378', trim: '#e6e2da', dark: '#2c2d30', glass: '#3a4a58', glow: '#ffe9a0' },
};

/**
 * The style every surface is generated from. A compiled town carries one; an old spec gets the colours its
 * theme's kit and palette imply, so the ground, roads and dressing are made the same way for both.
 */
function resolveStyle(spec: WorldSpec, groundHex: string): StyleSpec {
  const s = spec.style;
  if (s) {
    const t = THEME_STYLE[spec.theme];
    return {
      ...s, wall: hexOr(s.wall, t.wall), wall2: hexOr(s.wall2, t.wall2), roof: hexOr(s.roof, t.roof), trim: hexOr(s.trim, t.trim),
      accent: hexOr(s.accent, '#b5533c'), dark: hexOr(s.dark, t.dark), glass: hexOr(s.glass, t.glass), glow: hexOr(s.glow, t.glow),
      ground: hexOr(s.ground, groundHex), road: hexOr(s.road, '#6b6258'),
    };
  }
  return {
    ...THEME_STYLE[spec.theme], accent: hexOr(spec.palette.accent, '#b5533c'), ground: groundHex,
    road: `#${roadColour(new THREE.Color(groundHex), spec.theme).getHexString()}`, variety: 0.4,
  };
}

/**
 * A surface material from the generator, or a plain one in its colour when the generator cannot run here.
 * The meshes it goes on carry wear and grime as a colour multiplier, so vertex colours are switched on.
 */
function surfaceMaterial(make: () => THREE.Material, fallbackHex: string): THREE.Material {
  let m: THREE.Material;
  try {
    m = make();
  } catch {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(fallbackHex), roughness: 1 });
  }
  if (!m.vertexColors) { m.vertexColors = true; m.needsUpdate = true; }
  return m;
}

/**
 * The placeholder a landmark stands on until its model loads: width across and height in metres, the outer
 * radius and width of the lit inlay in its top face, the inlay's emissive level, and the grey the town's dark
 * colour is mixed towards so the block reads as stone.
 */
export const PLINTH = { width: 1.6, height: 0.5, inlay: 0.5, inlayWidth: 0.035, glow: 0.45, stone: '#8b8780' } as const;

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

/**
 * Trails as a ribbon over the land: strongest along the middle, fading to nothing at ragged edges and at
 * both ends. Alpha is the fourth colour component.
 */
function trailGeometry(trails: NonNullable<TownLayout['trails']>, heightAt: (x: number, z: number) => number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const across = [-1, -0.45, 0, 0.45, 1];
  for (const t of trails) {
    const n = t.pts.length;
    if (n < 2) continue;
    const strong = t.kind === 'path' ? 0.85 : 0.5;
    const start = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const p = t.pts[i] as { x: number; z: number };
      const a = t.pts[Math.max(0, i - 1)] as { x: number; z: number };
      const c = t.pts[Math.min(n - 1, i + 1)] as { x: number; z: number };
      const len = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      const px = -(c.z - a.z) / len;
      const pz = (c.x - a.x) / len;
      const end = Math.min(1, i / 2, (n - 1 - i) / 2);
      for (const s of across) {
        const off = s * (t.width / 2 + 0.25) * (1 + 0.25 * Math.sin(i * 1.7 + s * 3));
        const x = p.x + px * off;
        const z = p.z + pz * off;
        pos.push(x, heightAt(x, z) + 0.035, z);
        uv.push(x, z);
        const k = 0.86 + 0.1 * Math.abs(s);
        col.push(k, k, k, Math.abs(s) === 1 ? 0 : strong * end * (s === 0 ? 1 : 0.8));
      }
    }
    const w = across.length;
    for (let i = 0; i + 1 < n; i++) {
      for (let c = 0; c + 1 < w; c++) {
        const o = start + i * w + c;
        idx.push(o, o + w, o + 1, o + 1, o + w, o + w + 1);
      }
    }
  }
  if (idx.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function buildTown(layout: TownLayout, spec: WorldSpec, kit: LoadedKit, scene: THREE.Scene, opts: BuildOptions = {}): TownObjects {
  const quality: Quality = opts.quality ?? 2;
  const rng = makeRng(spec.seed, 'build');
  const group = new THREE.Group();
  group.name = 'town';
  const mats = new MaterialCache();
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

  // Ground: the collider is a flat plane; what is seen is the terrain, flat over the town and rolling beyond it.
  const groundHex = hexOr(style?.ground, hexOr(manifest.ground.color, hexOr(spec.palette.ground, '#7d8a5a')));
  const look = resolveStyle(spec, groundHex);
  const given = look.surfaces ?? inferSurfaces(look, spec.theme, spec.mood);
  const unit = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);
  const surfaces: SurfaceSet = { ...given, wear: unit(given.wear), wet: unit(given.wet) };
  const pathsMode = spec.site?.paths ?? 'road';
  const surfaceOpts = { quality, seed: spec.seed };
  const field = makeTerrainField(layout.bounds, surfaces.ground, spec.seed);
  const land = makeLand(layout, spec.terrain, surfaces.ground, spec.seed);
  const shaped = land.shaped;
  const hAt = shaped ? land.heightAt : (): number => 0;
  const seat: { y: number | null } = { y: null };
  /** Runs `fn` with everything it adds to the batches standing at the land's height at (x, z). */
  const seated = <T>(x: number, z: number, fn: () => T): T => {
    seat.y = hAt(x, z);
    try { return fn(); } finally { seat.y = null; }
  };
  const batch = shaped ? new LandBatch(hAt, seat) : new GeoBatch();
  // Small props render but are not in `statics`, so dense undergrowth does not carve the navmesh.
  const visualBatch = shaped ? new LandBatch(hAt, seat) : new GeoBatch();
  const env: ProcEnv = { batch, mats, theme: spec.theme };
  const colliderGeo = buildWalkGeometry(land, WALK_MARGIN, GROUND_SIZE);
  const ground = new THREE.Mesh(colliderGeo, COLLIDER_MATERIAL);
  ground.name = 'ground';
  ground.visible = false;
  ground.matrixAutoUpdate = false;
  ownGeos.push(colliderGeo);
  statics.push(ground);
  let walkMesh = ground;
  if (!shaped) {
    const lb = layout.bounds;
    const walkGeo = new THREE.PlaneGeometry(lb.maxX - lb.minX + 2 * WALK_MARGIN, lb.maxZ - lb.minZ + 2 * WALK_MARGIN).rotateX(-Math.PI / 2);
    walkGeo.translate((lb.minX + lb.maxX) / 2, 0, (lb.minZ + lb.maxZ) / 2);
    walkMesh = new THREE.Mesh(walkGeo, COLLIDER_MATERIAL);
    walkMesh.name = 'walk';
    walkMesh.visible = false;
    walkMesh.matrixAutoUpdate = false;
    ownGeos.push(walkGeo);
  }
  /** Lays flat geometry built at y = 0 over the land: each vertex rises by the ground under it. */
  const drape = <G extends THREE.BufferGeometry | null>(g: G): G => {
    if (!shaped || !g) return g;
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + hAt(pos.getX(i), pos.getZ(i)));
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };

  const drawn = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, order = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = order;
    ownGeos.push(geo);
    group.add(mesh);
    return mesh;
  };
  const groundMat = surfaceMaterial(() => groundMaterial(surfaces, look, surfaceOpts), look.ground);
  ownMats.push(groundMat);
  const doorPoints = layout.buildings.map((b) => b.door);
  const half = groundHalfExtent(layout.bounds);
  drawn(buildGroundGeometry(layout, field, { quality, doors: doorPoints, half, land }), groundMat, 'terrain');

  // Water the land holds, drawn over the carved ground.
  const water = shaped && land.water.length > 0
    ? buildWater({ land, quality, reach: half, tint: (kind, wl) => { if (kind === 'lava') wl.glowColour = `#${new THREE.Color(wl.glowColour).lerp(new THREE.Color(look.glow), 0.25).getHexString()}`; } })
    : null;
  if (water) group.add(water.group);

  // Horizon ring: mesas, mountains, giant trees or megastructures, far enough out for the fog to take them.
  // What the terrain says the distance is made of comes first; the rest of the world's words fill in.
  const horizonWords = spec.terrain?.horizon ? `${spec.terrain.horizon} ` : '';
  const horizonKind = horizonKindFor(`${horizonWords}${spec.prompt} ${spec.title} ${spec.era} ${look.name}`, surfaces.ground, spec.theme, horizonWords);
  const forms = horizonForms(field, horizonKind, quality);
  if (shaped) for (const f of forms) f.y = Math.min(land.heightAt(f.x, f.z), f.y + 30) - 4;
  const horizon = buildHorizonGeometry(forms, horizonPalette(look, horizonKind, surfaces.ground), quality);
  if (horizon.solid) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    ownMats.push(m);
    drawn(horizon.solid, m, 'horizon').receiveShadow = false;
  }
  if (horizon.glow) {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, color: new THREE.Color('#000000'), emissive: new THREE.Color(look.glow), emissiveIntensity: 1.4, roughness: 1, side: THREE.DoubleSide,
    });
    ownMats.push(m);
    drawn(horizon.glow, m, 'horizon-glow').receiveShadow = false;
  }

  // Roads and plaza in the road surface, kerbs and boardwalks, then decals and puddles over them.
  const roadGeo = buildRoadGeometry({
    layout, surfaces, theme: spec.theme, paths: pathsMode, seed: spec.seed, quality, roadHex: look.road, wallHex: look.wall,
  });
  const offset = <M extends THREE.Material>(m: M, units: number): M => {
    m.polygonOffset = true;
    m.polygonOffsetFactor = units;
    m.polygonOffsetUnits = units;
    return m;
  };
  const roadMat = offset(surfaceMaterial(() => roadMaterial(surfaces, look, { ...surfaceOpts, variant: roadGeo.cls === 'track' ? 'track' : 'road' }), look.road), -2);
  const plazaMat = offset(surfaceMaterial(() => roadMaterial(surfaces, look, { ...surfaceOpts, variant: 'plaza' }), look.road), -3);
  ownMats.push(roadMat, plazaMat);
  if (spec.theme === 'modern' && !style && pathsMode !== 'none') {
    // Pavements: a paler band 1.5 m either side of each street.
    const walkMat = offset(new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a8d92'), roughness: 0.95 }), -1);
    ownMats.push(walkMat);
    for (const r of layout.roads) {
      const q = roadRect(r);
      const wide = r.az === r.bz;
      const g = new THREE.PlaneGeometry(q.maxX - q.minX + (wide ? 0 : 3), q.maxZ - q.minZ + (wide ? 3 : 0)).rotateX(-Math.PI / 2);
      g.translate((q.minX + q.maxX) / 2, 0.01, (q.minZ + q.maxZ) / 2);
      drawn(drape(g), walkMat, 'pavement');
    }
  }
  for (const g of roadGeo.roads) drawn(drape(g), roadMat, 'road');
  const plazaMesh = drawn(drape(roadGeo.plaza), plazaMat, 'plaza');
  plazaMesh.visible = layout.plaza.r > 0;
  drape(roadGeo.trim);
  drape(roadGeo.decals);
  drape(roadGeo.puddles);
  // Trails: a worn line through the land, soft at the edges, drawn in the road surface.
  if (layout.trails?.length) {
    const g = trailGeometry(layout.trails, hAt);
    if (g) {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.road).lerp(new THREE.Color(look.ground), 0.35).multiplyScalar(0.8), vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95 });
      offset(m, -2);
      ownMats.push(m);
      drawn(g, m, 'trails', 1);
    }
  }
  if (roadGeo.trim) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    ownMats.push(m);
    drawn(roadGeo.trim, m, 'road-trim').castShadow = true;
  }
  if (roadGeo.decals) {
    const m = offset(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.75 }), -4);
    ownMats.push(m);
    drawn(roadGeo.decals, m, 'road-decals', 1);
  }
  if (roadGeo.puddles) {
    // Standing water: near-mirror smooth, no normal map, dark enough that what it shows is the sky and the lamps.
    const m = offset(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.03, metalness: 0, envMapIntensity: 1.6 }), -5);
    ownMats.push(m);
    drawn(roadGeo.puddles, m, 'puddles', 2);
  }

  // Plaza centrepiece, only when the kit has one (medieval well, scifi pad)
  const centre = bpMode ? null : kit.building('plaza', 'small', rng);
  if (centre) {
    const f = fit(centre, manifest.facingOffset ?? 0, manifest.unitScale ?? 1, (s) => 3.2 / Math.max(s.x, s.z));
    if (f) {
      f.holder.position.set(layout.plaza.x, 0.03 + hAt(layout.plaza.x, layout.plaza.z), layout.plaza.z);
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
    sign.position.set(b.x + local.x, local.y + hAt(b.x, b.z), b.z + local.z);
    sign.rotation.y = b.rotY;
    group.add(sign);
    signMeshes.push(sign);
    signs.set(b.id, sign);
  };
  const maxH = MAX_BUILDING_HEIGHT;
  const heights = new Map<string, number>();
  const builtFrom = new Map<string, Blueprint>();
  layout.buildings.forEach((b, index) => {
    const padY = hAt(b.x, b.z);
    doors.set(b.id, new THREE.Vector3(b.door.x, hAt(b.door.x, b.door.z), b.door.z));
    if (style && bpMode) {
      // A building whose blueprint id is missing takes one of the town's archetypes by position, so the style stays whole.
      const bp = bpById.get(specBuildings.get(b.id)?.blueprint ?? '') ?? blueprints[index % blueprints.length];
      if (bp) {
        // On shaped land a foundation runs down into the ground, so no wall base shows daylight where the land dips beside it.
        const res = seated(b.x, b.z, () => addBlueprint(bp, style, b, { batch, mats, rng }, shaped ? { skirt: 0.6 } : undefined));
        res.door.y += hAt(res.door.x, res.door.z);
        doors.set(b.id, res.door);
        heights.set(b.id, res.height);
        builtFrom.set(b.id, bp);
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
      fitted.holder.position.set(b.x, padY, b.z);
      fitted.holder.rotation.y = b.rotY;
      fitted.holder.updateMatrixWorld(true);
      group.add(fitted.holder);
      enableShadows(fitted.holder, statics, ownGeos);
      heights.set(b.id, fitted.size.y);
      placeSign(b, clamp(fitted.size.y * 0.6, 2.8, 4.2), -fitted.size.z / 2);
    } else {
      const res = seated(b.x, b.z, () => addProceduralBuilding(env, b, spec.palette.accent, rng));
      heights.set(b.id, res.height);
      placeSign(b, res.signY, -b.d / 2);
    }
  });

  // Props
  const propLights: TownLight[] = [];
  const wildness = unit(spec.site?.wild ?? 0.3);
  const settledness = unit(spec.terrain?.settled ?? 0.7);
  // Nothing is planted in standing water.
  const propSlots = shaped && land.water.length > 0 ? layout.props.filter((p) => land.waterDepthAt(p.x, p.z) < 0.12) : layout.props;
  if (style && bpMode && spec.props?.length) {
    scatterBlueprintProps(propSlots, spec.props, style, {
      batch, mats, rng, visualBatch, layout, lights: propLights,
      seat: shaped ? (x, z) => { seat.y = x === null || z === null ? null : hAt(x, z) - 0.06; } : undefined,
      // Out in the wild the thin tall things are snags, cacti and reeds, not street furniture: more of them stay.
      maxPoles: shaped ? Math.round(MAX_POLES * (1 + 8 * wildness * (1 - settledness))) : undefined,
      poleSpacing: shaped ? POLE_SPACING * (1 - 0.7 * wildness * (1 - settledness)) : undefined,
    });
    for (const l of propLights) l.pos.y += hAt(l.pos.x, l.pos.z);
  } else for (const p of propSlots) {
    const obj = bpMode ? null : kit.prop(p.kind);
    const target = (PROP_SIZES[p.kind] ?? 1) * p.scale;
    const fitted = obj ? fit(obj, 0, 1, (s) => target / Math.max(s.x, s.y, s.z)) : null;
    if (fitted) {
      fitted.holder.position.set(p.x, hAt(p.x, p.z), p.z);
      fitted.holder.rotation.y = p.rotY;
      fitted.holder.updateMatrixWorld(true);
      group.add(fitted.holder);
      if (spec.site && isVisualOnlyProp(target)) {
        fitted.holder.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      } else {
        enableShadows(fitted.holder, statics, ownGeos);
      }
    } else {
      seated(p.x, p.z, () => addProceduralProp(isVisualOnlyProp(target) ? { ...env, batch: visualBatch } : env, p));
    }
  }

  // Landmark plinths: a knee-high stone block with a thin lit inlay set into its top, waiting for its statue.
  // It is replaced when the model arrives.
  const anchors = new Map<string, { x: number; z: number; rotY: number }>();
  const plinths = new Map<string, THREE.Group>();
  const placedModels = new Map<string, THREE.Object3D>();
  if (spec.landmarks?.length) {
    const stone = new THREE.Color(hexOr(style?.dark, '#3a3633')).lerp(new THREE.Color(PLINTH.stone), 0.55);
    const baseMat = new THREE.MeshStandardMaterial({ color: stone, roughness: 0.95, flatShading: true });
    const glowColour = hexOr(style?.glow, spec.palette.accent);
    // Dim: under the bloom threshold at every hour, so the line is seen and the stone around it is not washed out.
    const glowMat = new THREE.MeshStandardMaterial({
      color: stone.clone().multiplyScalar(0.5), emissive: new THREE.Color(glowColour), emissiveIntensity: PLINTH.glow, roughness: 0.6,
    });
    ownMats.push(baseMat, glowMat);
    for (const lm of spec.landmarks) {
      const a = landmarkAnchor(layout, spec, lm);
      anchors.set(lm.id, a);
      const plinth = new THREE.Group();
      plinth.name = `plinth:${lm.id}`;
      const r = PLINTH.width / 2;
      const baseGeo = new THREE.CylinderGeometry(r * 0.88, r, PLINTH.height, 8);
      const inlayGeo = new THREE.RingGeometry(PLINTH.inlay - PLINTH.inlayWidth, PLINTH.inlay, 8).rotateX(-Math.PI / 2);
      ownGeos.push(baseGeo, inlayGeo);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.name = 'plinth-base';
      base.position.y = PLINTH.height / 2;
      const inlay = new THREE.Mesh(inlayGeo, glowMat);
      inlay.name = 'plinth-inlay';
      inlay.position.y = PLINTH.height + 0.004;
      base.castShadow = true;
      for (const m of [base, inlay]) { m.receiveShadow = true; plinth.add(m); }
      plinth.position.set(a.x, hAt(a.x, a.z), a.z);
      plinth.rotation.y = a.rotY;
      group.add(plinth);
      plinths.set(lm.id, plinth);
    }
  }

  // Set dressing against the buildings, then the small stuff that fills the ground between them.
  const dressed = dressTown({
    layout, spec, style: look, surfaces, heights, blueprints: builtFrom,
    keepClear: [...anchors.values()].map((a) => ({ x: a.x, z: a.z, r: 2.6 })), batch, visualBatch, mats, quality,
  });
  if (shaped) {
    for (const l of dressed.lights) l.pos.y += hAt(l.pos.x, l.pos.z);
    for (const p of dressed.smoke) p.y += hAt(p.x, p.z);
  }
  // The street lamps that kept their place light the ground too, alongside the door lanterns.
  dressed.lights.push(...propLights);
  const scatter = buildScatter({
    layout, ground: surfaces.ground, groundHex: look.ground, accents: [look.accent, look.glow, look.trim],
    wild: spec.site?.wild ?? 0.3, wet: surfaces.wet, quality, seed: spec.seed, tracks: roadGeo.cls === 'track' && pathsMode !== 'none',
    heightAt: shaped ? hAt : undefined, waterDepthAt: shaped && land.water.length > 0 ? land.waterDepthAt : undefined,
  });
  group.add(scatter.group);
  // The middle distance: the world's own trees and structures, larger than life, past where anyone can walk.
  const backdrop = shaped && style
    ? buildBackdrop({
        layout, seed: spec.seed, style: look, wild: wildness, settled: settledness, props: spec.props ?? [], blueprints,
        heightAt: land.heightAt, waterDepthAt: land.waterDepthAt, mats, quality, inner: WALK_MARGIN + 3,
      })
    : null;
  if (backdrop) group.add(backdrop.group);

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
    group, statics, signs, doors, lights: dressed.lights, smoke: dressed.smoke,
    heightAt: land.heightAt, walkMesh, shaped, waterBodies: water ? water.bodies : [], waterDepthAt: land.waterDepthAt,
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
      holder.position.set(a.x, hAt(a.x, a.z), a.z);
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
      // Surface materials are shared through their own cache; disposing one here only frees its program until it is next drawn.
      for (const m of [...merged, ...visual]) {
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
      }
      for (const s of signMeshes) disposeSign(s);
      for (const g of ownGeos) g.dispose();
      for (const m of ownMats) m.dispose();
      for (const o of placedModels.values()) disposeObject(o);
      placedModels.clear();
      plinths.clear();
      scatter.dispose();
      water?.dispose();
      backdrop?.dispose();
      dressed.lights.length = 0;
      dressed.smoke.length = 0;
      mats.dispose();
      group.clear();
      statics.length = 0;
      signs.clear();
      doors.clear();
    },
  };
}
