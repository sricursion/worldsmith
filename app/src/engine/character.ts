// KayKit Adventurers rig check (tests/engine/inspect-glb.mjs, full output in tests/engine/kaykit-rig-report.md):
//   Barbarian, Knight, Mage, Rogue and Rogue_Hooded each carry 41 joints and 76 clips.
//   Bone-name set diff against Barbarian: Knight, Mage, Rogue, Rogue_Hooded all empty (missing=[] extra=[]).
//   Clip-name set diff against Barbarian: empty for all four. One rig family, so one clip map serves every base.
//   Each file has six skinned meshes (Body, Head or Head_Hooded, ArmLeft, ArmRight, LegLeft, LegRight) sharing
//   one skeleton and one gradient-atlas material, plus unskinned accessories parented to handslot.l/r, head and chest.
//   The pack has no ranger model, so 'ranger' is served by Rogue.glb. There are no root-motion clip variants.
//
// On top of the clips the rig adds motion the pack does not ship: the visible body turns toward the heading
// it is given instead of snapping, leans into speed and banks into turns, the chest and head share a damped
// look-at with pitch, idle characters shift weight, breathe and glance around, and speech is a procedural
// layer (head nods on a phrase envelope, forearm beats) over the idle clip.
import {
  AnimationMixer,
  Box3,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  DataTexture,
  Euler,
  Group,
  LinearFilter,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  SkinnedMesh,
  Vector3,
} from 'three';
import type { AnimationAction, AnimationClip, Material, Object3D, Texture } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterBase, ThemeId } from '../world/spec';
import type { Rng } from '../world/rng';
import { makeRng } from '../world/rng';
import { enableShadows, loadGltf } from './gltf';
import { LOGICAL_CLIPS, resolveClipNames } from './kaykit-clips';
import type { LogicalClip } from './kaykit-clips';
import { paletteSlot, paletteVariant, planOutfit, shiftPixels } from './palette';
import type { Accessory, AccessorySlot, OutfitPlan } from './palette';

export { PALETTE_COUNT, PALETTE_RINGS, classifyPixel, paletteForRole, paletteVariant, planOutfit, shiftPixels } from './palette';

/** Logical names beyond the six in kaykit-clips.ts. 'sit' is already one of those six. */
export type ExtraClip = 'gesture' | 'cheer' | 'use' | 'look_around';
export type CharacterClip = LogicalClip | ExtraClip;

export const EXTRA_CLIPS: readonly ExtraClip[] = ['gesture', 'cheer', 'use', 'look_around'];

/** Real clip names from the rig report, best first. The pack has no glance clip, so look_around pairs the
 * unarmed idle with the rig's procedural head sweep. */
export const EXTRA_CLIP_CANDIDATES: Record<ExtraClip, readonly string[]> = {
  gesture: ['Interact', 'Use_Item'],
  cheer: ['Cheer'],
  use: ['Use_Item', 'PickUp', 'Interact'],
  look_around: ['Unarmed_Idle', 'Idle'],
};

export function resolveExtraClipNames(available: readonly string[]): Record<ExtraClip, string | null> {
  const have = new Set(available);
  const out: Record<ExtraClip, string | null> = { gesture: null, cheer: null, use: null, look_around: null };
  for (const k of EXTRA_CLIPS) out[k] = EXTRA_CLIP_CANDIDATES[k].find((n) => have.has(n)) ?? null;
  return out;
}

export interface CharacterRig {
  root: Object3D;
  mixer: AnimationMixer;
  play(name: CharacterClip, fade?: number): void;
  setPalette(index: number, theme: ThemeId): void;
  lookAt(target: Vector3 | null): void;
  update(dt: number): void;
  dispose(): void;
}

export const CHARACTER_HEIGHT_M = 1.75;
export const HEAD_LOOK_LIMIT_RAD = Math.PI / 3;
export const HEAD_PITCH_LIMIT_RAD = 0.45;
export const CHARACTER_ROUGHNESS = 0.75;
/** Exponential rate (1/s) at which the visible body catches up with the heading set on rig.root. */
export const TURN_RATE = 10;
/** Nominal eye line. Callers aim look targets at a human 1.6 m, so pitch is measured from the same convention. */
const EYE_HEIGHT_M = CHARACTER_HEIGHT_M * 0.89;
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

// ---- Angles -------------------------------------------------------------------------------------

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  const two = Math.PI * 2;
  let x = a % two;
  if (x > Math.PI) x -= two;
  else if (x <= -Math.PI) x += two;
  return x;
}

/**
 * Moves a yaw toward a target along the shorter arc with exponential ease: after 1/rate seconds about
 * 63% of the gap is closed, whatever the frame rate. Never overshoots; returns a value in (-PI, PI].
 */
export function turnToward(currentYaw: number, targetYaw: number, dt: number, rate: number): number {
  const gap = wrapAngle(targetYaw - currentYaw);
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
  return wrapAngle(currentYaw + gap * k);
}

// ---- Shading ------------------------------------------------------------------------------------

const rim = { color: { value: new Color(0x9fb4d6) }, strength: { value: 0.6 } };
let rimManual = false;
let quality: 0 | 1 | 2 = 2;
const BLOB_OPACITY: readonly [number, number, number] = [0.6, 0.45, 0.24];
const RIM_KEY = 'worldsmith-character-rim';

/**
 * Tints the fresnel rim on every character. Pass the sky colour near the horizon (linear working space).
 * Until this is called the rim follows the fog colour of whatever scene a character stands in.
 */
export function setCharacterRim(sky: Color, strength = 0.6): void {
  rim.color.value.copy(sky);
  rim.strength.value = Math.max(0, strength);
  rimManual = true;
}

/** 0 = no real shadows expected (strong contact blob), 1 = cheap shadows, 2 = full shadows (faint blob as contact shade). */
export function setCharacterQuality(level: 0 | 1 | 2): void {
  quality = level;
  if (blobMaterial !== null) blobMaterial.opacity = BLOB_OPACITY[level];
}

type CompileHook = MeshStandardMaterial['onBeforeCompile'];

const patchRim: CompileHook = (shader) => {
  shader.uniforms.uRimColor = rim.color;
  shader.uniforms.uRimStrength = rim.strength;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
    .replace(
      '#include <opaque_fragment>',
      /* glsl */ `{
  // Sky rim: grazing angles pick up the sky, strongest on surfaces that face up or sideways.
  float rimF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
  vec3 rimUpV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float rimSky = 0.3 + 0.7 * saturate( dot( normal, rimUpV ) * 0.5 + 0.5 );
  outgoingLight += uRimColor * ( rimF * rimSky * uRimStrength ) * mix( vec3( 1.0 ), diffuseColor.rgb, 0.6 );
}
#include <opaque_fragment>`,
    );
};

/** Matte cloth-and-skin response with the sky rim. Safe to call again on a clone (hooks are not copied by clone). */
function shadeMaterial(mat: Material): void {
  if (!(mat instanceof MeshStandardMaterial)) return;
  mat.roughness = CHARACTER_ROUGHNESS;
  mat.metalness = 0;
  if (mat.map !== null) mat.map.colorSpace = SRGBColorSpace;
  mat.onBeforeCompile = patchRim;
  mat.customProgramCacheKey = () => RIM_KEY;
  mat.needsUpdate = true;
}

let blobGeometry: PlaneGeometry | null = null;
let blobMaterial: MeshBasicMaterial | null = null;
let blobTexture: DataTexture | null = null;

/** Soft radial falloff, darkest under the feet. Built from numbers so it needs no canvas. */
export function blobAlpha(r: number): number {
  const x = Math.min(1, Math.max(0, r));
  const s = 1 - x * x;
  return s * s * (0.55 + 0.45 * (1 - x));
}

function makeBlob(): Mesh {
  if (blobGeometry === null) {
    blobGeometry = new PlaneGeometry(1, 1);
    blobGeometry.rotateX(-Math.PI / 2);
  }
  if (blobMaterial === null) {
    const n = 64;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = ((x + 0.5) / n) * 2 - 1;
        const dy = ((y + 0.5) / n) * 2 - 1;
        const i = (y * n + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(255 * blobAlpha(Math.hypot(dx, dy)));
      }
    }
    blobTexture = new DataTexture(data, n, n, RGBAFormat);
    blobTexture.magFilter = LinearFilter;
    blobTexture.minFilter = LinearFilter;
    blobTexture.needsUpdate = true;
    blobMaterial = new MeshBasicMaterial({
      color: 0x000000,
      map: blobTexture,
      transparent: true,
      opacity: BLOB_OPACITY[quality],
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  const blob = new Mesh(blobGeometry, blobMaterial);
  blob.name = 'contact_shadow';
  blob.position.y = 0.03;
  blob.scale.set(1.05, 1, 0.9);
  blob.renderOrder = 1;
  return blob;
}

// ---- Loading ------------------------------------------------------------------------------------

function slotOf(parentName: string): AccessorySlot | null {
  const n = parentName.toLowerCase().replace(/[^a-z]/g, '');
  if (n === 'handslotl') return 'left';
  if (n === 'handslotr') return 'right';
  if (n === 'head') return 'head';
  if (n === 'chest') return 'chest';
  return null;
}

function prepareBase(file: string, scene: Object3D, clips: AnimationClip[]): LoadedBase {
  let atlas: Texture | null = null;
  const body = new Box3();
  const shaded = new Set<Material>();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (shaded.has(m)) continue;
      shaded.add(m);
      shadeMaterial(m);
    }
    if (isSkinned(o)) {
      o.frustumCulled = false; // quantised skinned bounds are unreliable
      const mat = mats[0];
      if (atlas === null && mat instanceof MeshStandardMaterial && mat.map) atlas = mat.map;
      body.union(new Box3().setFromObject(o));
    } else if (o.parent !== null && o.parent.name.startsWith('handslot')) {
      o.visible = false; // held props stay off until setOutfit hands one out
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
      warnOnce(file, `Worldsmith: character ${file}.glb failed to load (${err instanceof Error ? err.message : 'error'}); using placeholder`);
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
  tex.colorSpace = SRGBColorSpace;
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

// ---- Outfits ------------------------------------------------------------------------------------

/** Accessory meshes hanging off the head, chest and hand slots of a rig (or of anything shaped like one). */
export function listAccessories(root: Object3D): { mesh: Object3D; accessory: Accessory }[] {
  const out: { mesh: Object3D; accessory: Accessory }[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh) || isSkinned(o) || o.parent === null) return;
    const slot = slotOf(o.parent.name);
    if (slot !== null) out.push({ mesh: o, accessory: { name: o.name, slot } });
  });
  return out;
}

/**
 * Dresses a character for its role and world: a sheriff keeps a hat, a monk loses the helmet, nobody
 * outside a medieval town carries a sword. Deterministic for a given rng state. Returns what was shown.
 */
export function setOutfit(rig: Pick<CharacterRig, 'root'>, opts: { theme: ThemeId; role: string; rng: Rng }): OutfitPlan {
  const found = listAccessories(rig.root);
  const plan = planOutfit(found.map((f) => f.accessory), opts.theme, opts.role, opts.rng);
  const show = new Set(plan.visible);
  for (const f of found) f.mesh.visible = show.has(f.accessory.name);
  return plan;
}

// ---- Rig ----------------------------------------------------------------------------------------

const talkSetters = new WeakMap<CharacterRig, (amount: number) => void>();

/**
 * Drives the speech layer of a rig: 0 silent, 1 talking. Feed it a voice envelope for lip-sync-like
 * emphasis, or just 0 and 1. A negative amount hands control back to play('talk'), which talks at 1.
 */
export function setTalking(rig: CharacterRig, amount: number): void {
  talkSetters.get(rig)?.(amount);
}

function placeholderRig(): CharacterRig {
  warnOnce('placeholder', 'Worldsmith: createCharacter called before its base loaded; returning a placeholder');
  const geo = new CapsuleGeometry(0.25, CHARACTER_HEIGHT_M - 0.5, 4, 8);
  const mat = new MeshStandardMaterial({ color: 0xb08968, roughness: CHARACTER_ROUGHNESS });
  const mesh = new Mesh(geo, mat);
  mesh.position.y = CHARACTER_HEIGHT_M / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const root = new Group();
  root.add(mesh, makeBlob());
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

function findBone(model: Object3D, name: string): Object3D | null {
  return model.getObjectByName(name) ?? model.getObjectByName(name.replace(/[[\].:/]/g, '')) ?? null;
}

/**
 * Hinge axis of an arm bone in its own space: the axis that swings the bone's length toward the model's
 * forward. Measured on the rest pose, so it holds for any rig whose arms are not already pointing forward.
 */
function flexAxis(bone: Object3D | null, model: Object3D): Vector3 | null {
  if (bone === null) return null;
  const child = bone.children.find((c) => (c as { isBone?: boolean }).isBone === true && c.position.lengthSq() > 1e-8);
  if (child === undefined) return null;
  const along = child.position.clone().normalize();
  const forward = new Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new Quaternion()));
  forward.applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert());
  const axis = along.cross(forward);
  return axis.length() < 0.3 ? null : axis.normalize();
}

/** Layers a rotation over a bone the mixer may or may not key, without compounding frame over frame. */
class BoneLayer {
  private readonly base = new Quaternion();
  private readonly written = new Quaternion();
  private active = false;
  constructor(readonly bone: Object3D) {}
  /** Call after the mixer ran: recovers the animated pose if the mixer left our last write in place. */
  begin(): void {
    if (this.active && this.bone.quaternion.equals(this.written)) this.bone.quaternion.copy(this.base);
    this.base.copy(this.bone.quaternion);
    this.active = false;
  }
  commit(): void {
    this.written.copy(this.bone.quaternion);
    this.active = true;
  }
}

const tmpQ1 = new Quaternion();
const tmpQ2 = new Quaternion();
const tmpQ3 = new Quaternion();
const tmpQ4 = new Quaternion();
const tmpEuler = new Euler(0, 0, 0, 'YXZ');
const tmpV = new Vector3();
let rigCounter = 0;

/** Rotates a bone by pitch (nod down positive), yaw (toward +x positive) and roll given in the frame `frame`. */
function rotateInFrame(layer: BoneLayer | null, frame: Quaternion, pitch: number, yaw: number, roll: number): void {
  if (layer === null) return;
  const bone = layer.bone;
  if (bone.parent === null) return;
  bone.parent.getWorldQuaternion(tmpQ1);
  tmpQ2.setFromEuler(tmpEuler.set(pitch, yaw, roll, 'YXZ'));
  tmpQ3.copy(frame).multiply(tmpQ2).multiply(tmpQ4.copy(frame).invert()); // world-space delta
  // local' = parent^-1 * delta * parent * local
  bone.quaternion.premultiply(tmpQ1).premultiply(tmpQ3).premultiply(tmpQ1.invert());
  layer.commit();
}

/** Critically damped spring, semi-implicit; stable while h * omega < 2. */
class Spring {
  x = 0;
  private v = 0;
  step(target: number, omega: number, h: number): number {
    this.v += (omega * omega * (target - this.x) - 2 * omega * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

export function createCharacter(base: CharacterBase): CharacterRig {
  const data = loaded.get(BASE_FILES[base]);
  if (data === undefined) return placeholderRig();

  const model = cloneSkeleton(data.scene);
  model.scale.setScalar(data.scale);
  model.rotation.order = 'YXZ';
  const root = new Group();
  root.name = `character_${data.file}`;
  root.add(model, makeBlob());
  const mixer = new AnimationMixer(model);
  const clipNames = [...data.clips.keys()];
  const names: Record<CharacterClip, string | null> = { ...resolveClipNames(clipNames), ...resolveExtraClipNames(clipNames) };
  const actions = new Map<CharacterClip, AnimationAction>();
  for (const logical of [...LOGICAL_CLIPS, ...EXTRA_CLIPS]) {
    const clipName = names[logical];
    const clip = clipName === null ? undefined : data.clips.get(clipName);
    if (clip === undefined) continue;
    actions.set(logical, mixer.clipAction(clip));
  }

  // Per-rig material clones are created lazily by setPalette; the originals stay shared with the base.
  // Accessories share the atlas, so a recoloured character keeps a matching hat and cape.
  const meshes: { mesh: Mesh; original: Material | Material[] }[] = [];
  model.traverse((o) => {
    if (o instanceof Mesh) meshes.push({ mesh: o, original: o.material as Material | Material[] });
  });
  const clones = new Map<Material, Material>();

  model.updateMatrixWorld(true);
  const layerOf = (name: string): BoneLayer | null => {
    const b = findBone(model, name);
    return b === null ? null : new BoneLayer(b);
  };
  const head = layerOf('head');
  const chest = layerOf('chest');
  const spine = layerOf('spine');
  const armR = layerOf('lowerarm.r');
  const armL = layerOf('lowerarm.l');
  const axisR = flexAxis(armR?.bone ?? null, model);
  const axisL = flexAxis(armL?.bone ?? null, model);
  const layers = [spine, chest, head, armR, armL].filter((l): l is BoneLayer => l !== null);

  const rng = makeRng(rigCounter++, `rig|${data.file}`);
  const phase = rng.range(0, Math.PI * 2);
  const phase2 = rng.range(0, Math.PI * 2);

  let baseName: CharacterClip = 'idle';
  let baseAction: AnimationAction | null = null;
  let live: AnimationAction | null = null;
  let oneShot: AnimationAction | null = null;
  let oneShotLeft = 0;
  let lookTarget: Vector3 | null = null;
  let clock = 0;
  let talkManual = -1;
  let talk = 0;
  let talkClock = 0;
  const yawSpring = new Spring();
  const pitchSpring = new Spring();
  let armBlend = 0;
  let visYaw = 0;
  let started = false;
  const lastPos = new Vector3();
  let speed = 0;
  let lean = 0;
  let bank = 0;
  let still = 0;
  let nextFidget = rng.range(4, 10);
  let sweepLeft = 0;
  let sweepDur = 1;
  let sweepAmp = 0;
  let nextEmphasis = rng.range(2.5, 5);
  const frame = new Quaternion();
  const qArm = new Quaternion();
  let disposed = false;

  const restoreMaterials = (): void => {
    for (const m of meshes) m.mesh.material = m.original;
  };

  /** Speech rides on the idle clip; the pack's Interact loop is kept for emphasis only. */
  const actionFor = (name: CharacterClip): AnimationAction | undefined => actions.get(name === 'talk' ? 'idle' : name) ?? actions.get('idle');

  const startOneShot = (name: CharacterClip): void => {
    const a = actions.get(name);
    if (a === undefined || a === live || a === baseAction) return;
    a.reset().setLoop(LoopOnce, 1);
    a.clampWhenFinished = true;
    a.setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (live !== null) live.crossFadeTo(a, 0.3, false);
    live = a;
    oneShot = a;
    oneShotLeft = Math.max(0.2, a.getClip().duration - 0.35);
  };

  const endOneShot = (): void => {
    const from = oneShot;
    oneShot = null;
    if (from === null || baseAction === null) return;
    baseAction.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    from.crossFadeTo(baseAction, 0.35, false);
    live = baseAction;
  };

  const rig: CharacterRig = {
    root,
    mixer,
    play(name, fade = 0.25) {
      if (disposed) return;
      const next = actionFor(name);
      if (next === undefined) return;
      baseName = name;
      if (next === baseAction) return; // same clip (idle and talk share one); a running one-shot finishes on its own
      baseAction = next;
      oneShot = null;
      next.reset().setLoop(LoopRepeat, Infinity);
      next.clampWhenFinished = false;
      next.setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      if (live !== null && live !== next) live.crossFadeTo(next, Math.max(0, fade), false);
      else if (live === null) next.fadeIn(Math.max(0, fade));
      live = next;
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
          shadeMaterial(mat);
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
      const h = Math.min(0.1, Math.max(0, dt));
      clock += h;

      // Rim follows the air of the scene the character stands in unless it was set by hand.
      if (!rimManual) {
        let top: Object3D = root;
        while (top.parent !== null) top = top.parent;
        const fog = (top as { fog?: { color?: Color } | null }).fog;
        if (fog?.color !== undefined) rim.color.value.lerp(fog.color, 1 - Math.exp(-2 * h));
      }

      // Motion read from how the owner moves the root: speed, and the heading the body eases toward.
      if (!started) {
        started = true;
        lastPos.copy(root.position);
        visYaw = root.rotation.y;
      }
      const step = tmpV.copy(root.position).sub(lastPos).length();
      lastPos.copy(root.position);
      const rawSpeed = h > 1e-4 && step < 3 ? step / h : 0; // a jump of metres in one frame is a teleport
      const prevSpeed = speed;
      speed += (rawSpeed - speed) * (1 - Math.exp(-6 * h));
      const accel = h > 1e-4 ? (speed - prevSpeed) / h : 0;
      const prevYaw = visYaw;
      visYaw = turnToward(visYaw, root.rotation.y, h, TURN_RATE);
      const yawRate = h > 1e-4 ? wrapAngle(visYaw - prevYaw) / h : 0;
      const moving = Math.min(1, speed / 1.2);
      const leanTarget = Math.max(-0.08, Math.min(0.2, 0.022 * speed + Math.max(-0.07, Math.min(0.07, accel * 0.012))));
      const bankTarget = Math.max(-0.14, Math.min(0.14, -yawRate * 0.035 * Math.min(1, speed / 2)));
      const ease = 1 - Math.exp(-7 * h);
      lean += (leanTarget - lean) * ease;
      bank += (bankTarget - bank) * ease;
      model.rotation.set(lean, wrapAngle(visYaw - root.rotation.y), bank, 'YXZ');

      // Speech amount: explicit when set, otherwise on while the talk clip is the requested one.
      const talkTarget = talkManual >= 0 ? talkManual : baseName === 'talk' ? 1 : 0;
      talk += (talkTarget - talk) * (1 - Math.exp(-9 * h));
      talkClock += h * (0.6 + 0.4 * talk);

      // One-shots: glances and small business while standing, a reach now and then while speaking.
      const calm = baseName === 'idle' || baseName === 'talk';
      if (oneShot !== null) {
        oneShotLeft -= h;
        if (oneShotLeft <= 0 || !calm || speed > 0.4) endOneShot();
      }
      if (calm && speed < 0.2) {
        still += h;
        if (talk > 0.5) {
          nextEmphasis -= h;
          if (nextEmphasis <= 0 && oneShot === null) {
            nextEmphasis = rng.range(4, 9);
            startOneShot('gesture');
          }
        } else if (still > nextFidget && oneShot === null) {
          still = 0;
          nextFidget = rng.range(6, 15);
          const r = rng.next();
          if (r < 0.2) startOneShot('use');
          else if (r < 0.32) startOneShot('look_around');
          if (r >= 0.2 && lookTarget === null) {
            sweepDur = rng.range(2.2, 3.6);
            sweepLeft = sweepDur;
            sweepAmp = rng.range(0.35, 0.75) * (rng.chance(0.5) ? 1 : -1);
          }
        }
      } else {
        still = 0;
      }

      mixer.update(dt);

      // Look target in the body's own frame (after the turn offset), with eye-level pitch.
      let wantYaw = 0;
      let wantPitch = 0;
      if (lookTarget !== null) {
        root.updateWorldMatrix(true, false);
        tmpV.copy(lookTarget);
        root.worldToLocal(tmpV);
        const flat = Math.hypot(tmpV.x, tmpV.z);
        if (flat > 0.05) {
          const rel = wrapAngle(Math.atan2(tmpV.x, tmpV.z) - model.rotation.y);
          // Something behind the shoulders is not worth craning at; face front until the body turns.
          if (Math.abs(rel) < 2.3) {
            wantYaw = Math.max(-HEAD_LOOK_LIMIT_RAD, Math.min(HEAD_LOOK_LIMIT_RAD, rel));
            wantPitch = Math.max(-HEAD_PITCH_LIMIT_RAD, Math.min(HEAD_PITCH_LIMIT_RAD, -Math.atan2(tmpV.y - EYE_HEIGHT_M, flat)));
          }
        }
        sweepLeft = 0;
      } else if (sweepLeft > 0) {
        sweepLeft -= h;
        const p = 1 - Math.max(0, sweepLeft) / sweepDur;
        // Out to one side, hold, drift across to the other, home.
        wantYaw = sweepAmp * (Math.sin(p * Math.PI) * 0.6 + Math.sin(p * Math.PI * 2) * 0.55);
        wantPitch = 0.05 * Math.sin(p * Math.PI * 3);
      }
      const yaw = yawSpring.step(wantYaw, 7, h);
      const pitch = pitchSpring.step(wantPitch, 7, h);

      const standing = 1 - moving;
      const t = clock;
      const s = talkClock;
      const phrase = 0.55 + 0.45 * Math.sin(s * 2.2 + phase2); // emphasis rises and falls across a sentence
      const beat = Math.sin(s * 6.5 + phase);
      const breath = Math.sin(t * 1.7 + phase);
      const shift = Math.sin(t * 0.43 + phase2) + 0.4 * Math.sin(t * 0.97 + phase);

      model.getWorldQuaternion(frame);
      for (const l of layers) l.begin();

      // Weight shift from the waist up so planted feet stay planted.
      rotateInFrame(spine, frame, 0, 0, standing * 0.022 * shift);
      rotateInFrame(chest, frame, -0.012 * breath * standing + talk * 0.02 * beat * phrase, yaw * 0.3, -standing * 0.01 * shift);
      rotateInFrame(
        head,
        frame,
        pitch + talk * (0.075 * phrase * Math.sin(s * 13 + phase) + 0.03 * Math.sin(s * 5.3 + phase2)),
        yaw * 0.7 + talk * 0.06 * Math.sin(s * 3.7 + phase),
        talk * 0.04 * Math.sin(s * 2.9 + phase2),
      );
      // Forearm beats give way while a clip gesture owns the arms.
      armBlend += ((oneShot === null ? talk : 0) - armBlend) * (1 - Math.exp(-8 * h));
      if (armBlend > 0.01) {
        if (armR !== null && axisR !== null) {
          armR.bone.quaternion.multiply(qArm.setFromAxisAngle(axisR, armBlend * (0.5 + 0.32 * phrase * beat)));
          armR.commit();
        }
        if (armL !== null && axisL !== null) {
          armL.bone.quaternion.multiply(qArm.setFromAxisAngle(axisL, armBlend * (0.22 + 0.2 * phrase * Math.sin(s * 6.5 + phase + 2.1))));
          armL.commit();
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      talkSetters.delete(rig);
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      restoreMaterials();
      for (const mat of clones.values()) mat.dispose(); // shared textures stay in the cache
      clones.clear();
      model.traverse((o) => {
        if (isSkinned(o)) o.skeleton.dispose();
      });
      root.removeFromParent();
      baseAction = null;
      live = null;
      oneShot = null;
      lookTarget = null;
    },
  };
  talkSetters.set(rig, (amount) => {
    talkManual = Number.isFinite(amount) && amount >= 0 ? Math.min(1, amount) : -1;
  });
  rig.play('idle', 0);
  return rig;
}

/** Releases cached bases, generated palette textures and the shared contact shadow. Rigs created earlier must be disposed first. */
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
  blobGeometry?.dispose();
  blobMaterial?.dispose();
  blobTexture?.dispose();
  blobGeometry = null;
  blobMaterial = null;
  blobTexture = null;
}
