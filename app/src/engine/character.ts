// KayKit Adventurers rig check (tests/engine/inspect-glb.mjs, full output in tests/engine/kaykit-rig-report.md):
//   Barbarian, Knight, Mage, Rogue and Rogue_Hooded each carry 41 joints and 76 clips.
//   Bone-name set diff against Barbarian: Knight, Mage, Rogue, Rogue_Hooded all empty (missing=[] extra=[]).
//   Clip-name set diff against Barbarian: empty for all four. One rig family, so one clip map serves every base.
//   Each file has six skinned meshes (Body, Head or Head_Hooded, ArmLeft, ArmRight, LegLeft, LegRight) sharing
//   one skeleton and one gradient-atlas material, plus unskinned accessories parented to handslot.l/r, head and chest.
//   The pack has no ranger model, so 'ranger' is served by Rogue.glb. There are no root-motion clip variants.
import {
  AnimationMixer,
  Box3,
  CanvasTexture,
  CapsuleGeometry,
  Group,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from 'three';
import type { AnimationAction, AnimationClip, Material, Object3D, Texture } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterBase, ThemeId } from '../world/spec';
import { enableShadows, loadGltf } from './gltf';
import { LOGICAL_CLIPS, resolveClipNames } from './kaykit-clips';
import type { LogicalClip } from './kaykit-clips';
import { paletteSlot, paletteVariant, shiftPixels } from './palette';

export { PALETTE_COUNT, PALETTE_RINGS, classifyPixel, paletteVariant, shiftPixels } from './palette';

export interface CharacterRig {
  root: Object3D;
  mixer: AnimationMixer;
  play(name: LogicalClip, fade?: number): void;
  setPalette(index: number, theme: ThemeId): void;
  lookAt(target: Vector3 | null): void;
  update(dt: number): void;
  dispose(): void;
}

export const CHARACTER_HEIGHT_M = 1.75;
export const HEAD_LOOK_LIMIT_RAD = Math.PI / 3;
const BASE_URL = '/third_party/kaykit-adventurers/';

/** File served for each base. The pack has no ranger, so it reuses the Rogue model. */
export const BASE_FILES: Record<CharacterBase, string> = {
  knight: 'Knight',
  barbarian: 'Barbarian',
  mage: 'Mage',
  rogue: 'Rogue',
  ranger: 'Rogue',
  rogue_hooded: 'Rogue_Hooded',
};

interface LoadedBase {
  file: string;
  scene: Object3D;
  clips: Map<string, AnimationClip>;
  scale: number;
  atlas: Texture | null;
}

const pending = new Map<string, Promise<void>>();
const loaded = new Map<string, LoadedBase>();
const paletteTextures = new Map<string, CanvasTexture>();
const warned = new Set<string>();

function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

function isSkinned(o: Object3D): o is SkinnedMesh {
  return o instanceof SkinnedMesh;
}

function prepareBase(file: string, scene: Object3D, clips: AnimationClip[]): LoadedBase {
  let atlas: Texture | null = null;
  const body = new Box3();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (isSkinned(o)) {
      o.frustumCulled = false; // quantised skinned bounds are unreliable
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (atlas === null && mat instanceof MeshStandardMaterial && mat.map) atlas = mat.map;
      body.union(new Box3().setFromObject(o));
    } else if (o instanceof Mesh && o.parent !== null && o.parent.name.startsWith('handslot')) {
      o.visible = false; // weapons and held props stay off; NPCs are unarmed
    }
  });
  enableShadows(scene);
  const height = body.isEmpty() ? 0 : body.max.y - body.min.y;
  const scale = height > 0.1 ? CHARACTER_HEIGHT_M / height : 1;
  return { file, scene, clips: new Map(clips.map((c) => [c.name, c])), scale, atlas };
}

export function loadCharacterBase(base: CharacterBase): Promise<void> {
  const file = BASE_FILES[base];
  const existing = pending.get(file);
  if (existing !== undefined) return existing;
  const p = (async (): Promise<void> => {
    try {
      const gltf = await loadGltf(`${BASE_URL}${file}.glb`);
      loaded.set(file, prepareBase(file, gltf.scene, gltf.animations));
    } catch (err) {
      pending.delete(file);
      warnOnce(file, `Townforge: character ${file}.glb failed to load (${err instanceof Error ? err.message : 'error'}); using placeholder`);
    }
  })();
  pending.set(file, p);
  return p;
}

/** Recoloured copy of a base's atlas, generated once per (file, theme, slot). Returns null without a DOM. */
function paletteTexture(base: LoadedBase, theme: ThemeId, slot: number): Texture | null {
  const key = `${base.file}|${theme}|${slot}`;
  const cached = paletteTextures.get(key);
  if (cached !== undefined) return cached;
  const src = base.atlas;
  if (src === null || typeof document === 'undefined') return null;
  const image = src.image as CanvasImageSource & { width?: number; height?: number };
  const w = image.width ?? 0;
  const h = image.height ?? 0;
  if (w <= 0 || h <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.drawImage(image, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h);
  const v = paletteVariant(theme, slot);
  shiftPixels(px.data, v.hue, v.value, v.sat);
  ctx.putImageData(px, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = src.colorSpace;
  tex.flipY = src.flipY;
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;
  tex.magFilter = src.magFilter;
  tex.minFilter = src.minFilter;
  tex.anisotropy = src.anisotropy;
  tex.needsUpdate = true;
  paletteTextures.set(key, tex);
  return tex;
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function placeholderRig(): CharacterRig {
  warnOnce('placeholder', 'Townforge: createCharacter called before its base loaded; returning a placeholder');
  const geo = new CapsuleGeometry(0.25, CHARACTER_HEIGHT_M - 0.5, 4, 8);
  const mat = new MeshStandardMaterial({ color: 0xb08968 });
  const mesh = new Mesh(geo, mat);
  mesh.position.y = CHARACTER_HEIGHT_M / 2;
  mesh.castShadow = true;
  const root = new Group();
  root.add(mesh);
  const mixer = new AnimationMixer(root);
  return {
    root,
    mixer,
    play: () => undefined,
    setPalette: () => undefined,
    lookAt: () => undefined,
    update: () => undefined,
    dispose() {
      root.removeFromParent();
      geo.dispose();
      mat.dispose();
    },
  };
}

export function createCharacter(base: CharacterBase): CharacterRig {
  const data = loaded.get(BASE_FILES[base]);
  if (data === undefined) return placeholderRig();

  const model = cloneSkeleton(data.scene);
  model.scale.setScalar(data.scale);
  const root = new Group();
  root.name = `character_${data.file}`;
  root.add(model);
  const mixer = new AnimationMixer(model);
  const names = resolveClipNames([...data.clips.keys()]);
  const actions = new Map<LogicalClip, AnimationAction>();
  for (const logical of LOGICAL_CLIPS) {
    const clipName = names[logical];
    const clip = clipName === null ? undefined : data.clips.get(clipName);
    if (clip === undefined) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(LoopRepeat, Infinity);
    actions.set(logical, action);
  }

  // Per-rig material clones are created lazily by setPalette; the originals stay shared with the base.
  const meshes: { mesh: SkinnedMesh; original: Material | Material[] }[] = [];
  model.traverse((o) => {
    if (isSkinned(o)) meshes.push({ mesh: o, original: o.material });
  });
  const clones = new Map<Material, Material>();
  const head = model.getObjectByName('head') ?? null;

  let current: AnimationAction | null = null;
  let lookTarget: Vector3 | null = null;
  let yaw = 0;
  let lastWritten: Quaternion | null = null;
  const lastBase = new Quaternion();
  const q1 = new Quaternion();
  const q2 = new Quaternion();
  const v1 = new Vector3();
  const up = new Vector3();
  let disposed = false;

  const restoreMaterials = (): void => {
    for (const m of meshes) m.mesh.material = m.original;
  };

  const rig: CharacterRig = {
    root,
    mixer,
    play(name, fade = 0.25) {
      if (disposed) return;
      const next = actions.get(name) ?? actions.get('idle');
      if (next === undefined) return;
      if (next === current) return;
      next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      if (current !== null) current.crossFadeTo(next, Math.max(0, fade), false);
      else next.fadeIn(Math.max(0, fade));
      current = next;
    },
    setPalette(index, theme) {
      if (disposed) return;
      const slot = paletteSlot(index);
      if (slot === 0) {
        restoreMaterials();
        return;
      }
      const tex = paletteTexture(data, theme, slot);
      if (tex === null) return;
      for (const m of meshes) {
        const orig = Array.isArray(m.original) ? m.original[0] : m.original;
        if (orig === undefined) continue;
        let mat = clones.get(orig);
        if (mat === undefined) {
          mat = orig.clone();
          clones.set(orig, mat);
        }
        if (mat instanceof MeshStandardMaterial) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
        m.mesh.material = mat;
      }
    },
    lookAt(target) {
      if (target === null) lookTarget = null;
      else if (lookTarget === null) lookTarget = target.clone();
      else lookTarget.copy(target);
    },
    update(dt) {
      if (disposed) return;
      mixer.update(dt);

      let desired = 0;
      if (lookTarget !== null) {
        root.updateWorldMatrix(true, false);
        v1.copy(lookTarget);
        root.worldToLocal(v1);
        if (Math.hypot(v1.x, v1.z) > 0.05) desired = Math.atan2(v1.x, v1.z);
      }
      if (head !== null) desired = Math.max(-HEAD_LOOK_LIMIT_RAD, Math.min(HEAD_LOOK_LIMIT_RAD, desired));
      yaw += normalizeAngle(desired - yaw) * (1 - Math.exp(-8 * Math.max(0, dt)));

      if (head === null) {
        model.rotation.y = yaw;
        return;
      }
      // The animation may or may not key the head; never compound onto our own previous write.
      if (lastWritten !== null && head.quaternion.equals(lastWritten)) head.quaternion.copy(lastBase);
      if (Math.abs(yaw) < 1e-4) {
        lastWritten = null;
        return;
      }
      lastBase.copy(head.quaternion);
      const parent = head.parent;
      if (parent === null) return;
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(q1);
      root.getWorldQuaternion(q2);
      up.set(0, 1, 0).applyQuaternion(q2);
      q2.setFromAxisAngle(up, yaw); // world-space yaw
      // local' = parent^-1 * yaw * parent * local
      head.quaternion.premultiply(q1).premultiply(q2).premultiply(q1.invert());
      lastWritten = head.quaternion.clone();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      restoreMaterials();
      for (const mat of clones.values()) mat.dispose(); // shared textures stay in the cache
      clones.clear();
      root.removeFromParent();
      current = null;
      lookTarget = null;
    },
  };
  rig.play('idle', 0);
  return rig;
}

/** Releases cached bases and generated palette textures. Rigs created earlier must be disposed first. */
export function disposeCharacterCache(): void {
  for (const t of paletteTextures.values()) t.dispose();
  paletteTextures.clear();
  for (const b of loaded.values()) {
    b.scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.geometry.dispose();
      const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    });
    b.atlas?.dispose();
  }
  loaded.clear();
  pending.clear();
}
