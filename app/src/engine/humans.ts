// Human people: rigged, animated, low-poly adult bodies (Quaternius animated characters, CC0, see
// docs/THIRD_PARTY.md) standing in for the procedural figure whenever the world's folk are human.
//
// Usage: await loadHumans() once at boot, then createHuman({...}) ?? createFigure({...}) per person. A human is a
// CharacterRig plus setTalking. The game moves rig.root; walking and running are read back from that motion, with the
// playback rate set from the measured stride of the clip so feet do not slide. The packs ship no talking clip, so
// speech is idle plus head nods and forearm beats applied to the skeleton after the animation mixer has run.
import { AnimationMixer, Box3, Euler, Group, LoopRepeat, Quaternion, Vector3 } from 'three';
import type { AnimationAction, AnimationClip, Bone, Object3D, SkinnedMesh } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { FolkSpec, ThemeId } from '../world/spec';
import { makeRng } from '../world/rng';
import type { CharacterClip, CharacterRig } from './character';
import { turnToward, wrapAngle } from './character';
import { loadGltf } from './gltf';
import { HUMAN_MODELS, HUMAN_PACK_URL, humanHeight, isHumanFolk, pickHumanColors, pickHumanModel } from './humans/catalog';
import type { HumanModel } from './humans/catalog';
import { HUMAN_CLIPS, playableClip, resolveHumanClips } from './humans/clips';
import type { HumanClipMap } from './humans/clips';
import { applyColors, cloneMaterials, disposeDressing } from './humans/dress';
import { DEFAULT_RUN_STRIDE, DEFAULT_WALK_STRIDE, classifyLocomotion, rootSpeed, runThreshold, smoothSpeed, strideRate } from './humans/motion';
import type { Locomotion } from './humans/motion';
import { findHumanBones, measureStrideSpeed } from './humans/stride';
import type { HumanBones } from './humans/stride';

export { isHumanFolk } from './humans/catalog';

export interface HumanOptions { role: string; theme: ThemeId; folk?: FolkSpec; seed: number; quality?: 0 | 1 | 2 }
export interface HumanRig extends CharacterRig {
  /** 0 silent .. 1 speaking; a negative amount hands control back to play('talk'). */
  setTalking(amount: number): void;
  /** Catalogue file of the body in use, for tests and the gallery. */
  readonly model: string;
}

const HEAD_LOOK_LIMIT_RAD = Math.PI / 3;
const HEAD_PITCH_LIMIT_RAD = 0.45;
const TURN_RATE = 10;
const FADE_S = 0.25;
const EYE_FRACTION = 0.93;

interface Template {
  entry: HumanModel;
  scene: Object3D;
  clips: Map<string, AnimationClip>;
  names: HumanClipMap;
  /** Standing height of the bind pose in model units, and the lowest point. */
  height: number;
  minY: number;
  /** Ground speed of the walk and run clips in model units per second; null when unmeasured. */
  walkNative: number | null;
  runNative: number | null;
}

const templates = new Map<string, Template>();
let pending: Promise<boolean> | null = null;
let ready = false;

export function humansReady(): boolean {
  return ready;
}

async function loadTemplate(entry: HumanModel): Promise<Template> {
  const gltf = await loadGltf(HUMAN_PACK_URL + entry.file);
  const scene = gltf.scene;
  const props: Object3D[] = [];
  scene.traverse((o) => {
    if (/^Sword$/i.test(o.name)) props.push(o);
  });
  for (const p of props) p.removeFromParent();
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene, true);
  const height = box.max.y - box.min.y;
  if (!(height > 0.1)) throw new Error(`${entry.file}: empty model`);
  const clips = new Map<string, AnimationClip>();
  for (const c of gltf.animations) clips.set(c.name, c);
  const names = resolveHumanClips([...clips.keys()]);
  if (names.idle === null || names.walk === null) throw new Error(`${entry.file}: no idle or walk clip`);
  const probe = cloneSkeleton(scene);
  const walk = clips.get(names.walk);
  const run = names.run === null ? undefined : clips.get(names.run);
  const walkNative = walk === undefined ? null : measureStrideSpeed(probe, walk);
  const runNative = run === undefined ? null : measureStrideSpeed(probe, run);
  probe.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh === true) (o as SkinnedMesh).skeleton.dispose();
  });
  return { entry, scene, clips, names, height, minY: box.min.y, walkNative, runNative };
}

/** Loads and caches the whole pack. Resolves false when anything fails; calling again retries. */
export function loadHumans(): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  if (pending !== null) return pending;
  pending = (async () => {
    try {
      const loaded = await Promise.all(HUMAN_MODELS.map(loadTemplate));
      templates.clear();
      for (const t of loaded) templates.set(t.entry.file, t);
      ready = true;
      return true;
    } catch (err) {
      console.warn('humans: pack failed to load, falling back to procedural people', err);
      templates.clear();
      ready = false;
      return false;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** One skeleton bone nudged in the model's own frame after the mixer has posed it, and undone before the next pose. */
class BoneLayer {
  private readonly applied = new Quaternion();
  private readonly inverse = new Quaternion();
  private has = false;
  constructor(readonly bone: Bone | null) {}

  begin(): void {
    if (this.bone === null || !this.has) return;
    this.bone.quaternion.premultiply(this.inverse);
    this.has = false;
  }

  /** Rotates the bone by Euler(x, y, z) expressed in the model frame (z forward, y up, x to the person's left). */
  commit(x: number, y: number, z: number, modelQuat: Quaternion, scratch: Scratch): void {
    const bone = this.bone;
    if (bone === null || bone.parent === null) return;
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 1e-4) return;
    bone.parent.matrixWorld.decompose(scratch.p, scratch.qp, scratch.s);
    scratch.e.set(x, y, z, 'YXZ');
    scratch.d.setFromEuler(scratch.e);
    // L = qp^-1 * qm * D * qm^-1 * qp
    this.applied.copy(scratch.qp).invert().multiply(modelQuat).multiply(scratch.d).multiply(scratch.qm.copy(modelQuat).invert()).multiply(scratch.qp);
    this.inverse.copy(this.applied).invert();
    bone.quaternion.premultiply(this.applied);
    bone.updateMatrixWorld(true);
    this.has = true;
  }
}

interface Scratch {
  p: Vector3;
  s: Vector3;
  qp: Quaternion;
  qm: Quaternion;
  d: Quaternion;
  e: Euler;
}

function newScratch(): Scratch {
  return { p: new Vector3(), s: new Vector3(), qp: new Quaternion(), qm: new Quaternion(), d: new Quaternion(), e: new Euler() };
}

function makeLayers(b: HumanBones): { chest: BoneLayer; neck: BoneLayer; head: BoneLayer; armR: BoneLayer; foreR: BoneLayer; armL: BoneLayer; foreL: BoneLayer; all: BoneLayer[] } {
  const chest = new BoneLayer(b.chest);
  const neck = new BoneLayer(b.neck);
  const head = new BoneLayer(b.head);
  const armR = new BoneLayer(b.armR);
  const foreR = new BoneLayer(b.foreR);
  const armL = new BoneLayer(b.armL);
  const foreL = new BoneLayer(b.foreL);
  return { chest, neck, head, armR, foreR, armL, foreL, all: [chest, neck, head, armR, foreR, armL, foreL] };
}

const GESTURE_CLIPS: ReadonlySet<CharacterClip> = new Set<CharacterClip>(['wave', 'cheer', 'gesture', 'use']);

/** A person, or null while the pack is not loaded or when the folk are clearly not human. */
export function createHuman(opts: HumanOptions): HumanRig | null {
  if (!ready || !isHumanFolk(opts.folk)) return null;
  const entry = pickHumanModel(opts.role, opts.theme, opts.seed, HUMAN_MODELS.filter((m) => templates.has(m.file)));
  const tpl = entry === null ? undefined : templates.get(entry.file);
  if (entry === null || tpl === undefined) return null;

  const quality = opts.quality ?? 2;
  const height = humanHeight(opts.folk, opts.seed);
  const scale = height / tpl.height;
  const model = cloneSkeleton(tpl.scene);
  model.scale.setScalar(scale);
  model.position.y = -tpl.minY * scale;
  model.rotation.order = 'YXZ';
  const root = new Group();
  root.name = `human_${entry.file.replace(/\.glb$/, '')}`;
  root.add(model);

  const dressing = cloneMaterials(model, quality >= 1, quality >= 2);
  let variant = 0;
  const recolor = (): void => applyColors(dressing, entry, pickHumanColors({ role: opts.role, theme: opts.theme, folk: opts.folk, seed: opts.seed, variant }));
  recolor();

  const mixer = new AnimationMixer(model);
  const actions = new Map<string, AnimationAction>();
  for (const logical of HUMAN_CLIPS) {
    const pick = playableClip(tpl.names, logical);
    if (pick === null || actions.has(pick.name)) continue;
    const clip = tpl.clips.get(pick.name);
    if (clip !== undefined) actions.set(pick.name, mixer.clipAction(clip));
  }

  const sane = (v: number | null, lo: number, hi: number, fallback: number): number => (v !== null && v * scale >= lo && v * scale <= hi ? v * scale : fallback);
  const walkStride = sane(tpl.walkNative, 0.3, 3, DEFAULT_WALK_STRIDE);
  const runStride = Math.max(walkStride * 1.2, sane(tpl.runNative, 0.8, 9, DEFAULT_RUN_STRIDE));
  const runAt = runThreshold(walkStride, runStride);

  const rng = makeRng(opts.seed, `human-motion|${opts.role}`);
  const phase = rng.range(0, Math.PI * 2);
  const phase2 = rng.range(0, Math.PI * 2);
  const bones = findHumanBones(model);
  const layers = makeLayers(bones);
  const scratch = newScratch();

  let requested: CharacterClip = 'idle';
  let loco: Locomotion = 'idle';
  let current: AnimationAction | null = null;
  let currentLogical: CharacterClip = 'idle';
  let speed = 0;
  let started = false;
  let disposed = false;
  let manualTalk = -1;
  let talk = 0;
  let talkClock = rng.range(0, 10);
  let clock = 0;
  let armBlend = 0;
  let visYaw = 0;
  let lookYaw = 0;
  let lookPitch = 0;
  let lookTarget: Vector3 | null = null;
  let sweepLeft = 0;
  let sweepDur = 1;
  let sweepAmp = 0;
  let nextSweep = rng.range(4, 10);
  const lastPos = new Vector3();
  const tmpV = new Vector3();
  const modelQuat = new Quaternion();
  const modelPos = new Vector3();
  const modelScale = new Vector3();

  const select = (logical: CharacterClip): void => {
    const pick = playableClip(tpl.names, logical);
    if (pick === null) return;
    const next = actions.get(pick.name);
    if (next === undefined || next === current) {
      currentLogical = logical;
      return;
    }
    next.reset();
    next.setLoop(LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.setEffectiveWeight(1).setEffectiveTimeScale(1);
    // Switching between walk and run keeps the stride phase so the feet do not hop.
    if (current !== null && (currentLogical === 'walk' || currentLogical === 'run') && (pick.logical === 'walk' || pick.logical === 'run')) {
      const d = current.getClip().duration;
      if (d > 0) next.time = next.getClip().duration * ((current.time % d) / d);
    }
    next.play();
    if (current !== null) current.crossFadeTo(next, FADE_S, false);
    else next.fadeIn(0);
    current = next;
    currentLogical = pick.logical === 'walk' || pick.logical === 'run' ? pick.logical : logical;
  };

  select('idle');

  const rig: HumanRig = {
    root,
    mixer,
    model: entry.file,
    play(name) {
      if (disposed) return;
      requested = name;
    },
    setPalette(index) {
      if (disposed) return;
      variant = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
      recolor();
    },
    lookAt(target) {
      if (target === null) lookTarget = null;
      else if (lookTarget === null) lookTarget = target.clone();
      else lookTarget.copy(target);
    },
    setTalking(amount) {
      manualTalk = Number.isFinite(amount) && amount >= 0 ? Math.min(1, amount) : -1;
    },
    update(dt) {
      if (disposed) return;
      const h = Math.min(0.1, Math.max(0, dt));
      clock += h;

      // Motion read from how the owner moves the root.
      if (!started) {
        started = true;
        lastPos.copy(root.position);
        visYaw = root.rotation.y;
      }
      const step = tmpV.copy(root.position).sub(lastPos).length();
      lastPos.copy(root.position);
      speed = smoothSpeed(speed, rootSpeed(step, h), h);
      loco = classifyLocomotion(speed, loco, runAt);
      visYaw = turnToward(visYaw, root.rotation.y, h, TURN_RATE);
      model.rotation.y = wrapAngle(visYaw - root.rotation.y);

      // Which clip: locomotion follows the measured speed; otherwise whatever the game asked for.
      const wanted: CharacterClip = loco !== 'idle' ? loco : requested === 'walk' || requested === 'run' ? 'idle' : requested;
      select(wanted);
      if (current !== null) {
        const ts = currentLogical === 'walk' ? strideRate('walk', speed, walkStride) : currentLogical === 'run' ? strideRate('run', speed, runStride) : 1;
        current.setEffectiveTimeScale(ts);
      }

      // Speech amount: explicit when set, otherwise on while talk is the requested clip.
      const talkTarget = manualTalk >= 0 ? manualTalk : requested === 'talk' ? 1 : 0;
      talk += (talkTarget - talk) * (1 - Math.exp(-9 * h));
      talkClock += h * (0.6 + 0.4 * talk);

      for (const l of layers.all) l.begin();
      mixer.update(dt);
      if (quality === 0) return;

      // Where the person is looking, in their own frame.
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
            wantPitch = Math.max(-HEAD_PITCH_LIMIT_RAD, Math.min(HEAD_PITCH_LIMIT_RAD, -Math.atan2(tmpV.y - height * EYE_FRACTION, flat)));
          }
        }
        sweepLeft = 0;
      } else if (requested === 'look_around' || (loco === 'idle' && requested === 'idle' && talk < 0.1)) {
        // A glance now and then while standing; look_around asks for it more often.
        if (sweepLeft <= 0) {
          nextSweep -= h * (requested === 'look_around' ? 4 : 1);
          if (nextSweep <= 0) {
            nextSweep = rng.range(5, 12);
            sweepDur = rng.range(2.2, 3.6);
            sweepLeft = sweepDur;
            sweepAmp = rng.range(0.35, 0.75) * (rng.chance(0.5) ? 1 : -1);
          }
        }
        if (sweepLeft > 0) {
          sweepLeft -= h;
          const p = 1 - Math.max(0, sweepLeft) / sweepDur;
          wantYaw = sweepAmp * (Math.sin(p * Math.PI) * 0.6 + Math.sin(p * Math.PI * 2) * 0.55);
          wantPitch = 0.05 * Math.sin(p * Math.PI * 3);
        }
      }
      const k = 1 - Math.exp(-7 * h);
      lookYaw += (wantYaw - lookYaw) * k;
      lookPitch += (wantPitch - lookPitch) * k;

      const phrase = 0.55 + 0.45 * Math.sin(talkClock * 2.2 + phase2);
      const beat = Math.sin(talkClock * 6.5 + phase);
      const gesturing = GESTURE_CLIPS.has(currentLogical) && loco === 'idle';
      armBlend += ((gesturing ? 0 : talk) - armBlend) * (1 - Math.exp(-8 * h));
      const moving = loco !== 'idle';
      const active = Math.abs(lookYaw) + Math.abs(lookPitch) > 0.003 || talk > 0.01 || armBlend > 0.01;
      if (!active) return;

      model.updateWorldMatrix(true, true);
      model.matrixWorld.decompose(modelPos, modelQuat, modelScale);
      const nod = talk * (0.075 * phrase * Math.sin(talkClock * 13 + phase) + 0.03 * Math.sin(talkClock * 5.3 + phase2));
      const sway = talk * 0.06 * Math.sin(talkClock * 3.7 + phase);
      layers.chest.commit(-0.012 * Math.sin(clock * 1.7 + phase) * (moving ? 0 : 1) + talk * 0.02 * beat * phrase, lookYaw * 0.2, 0, modelQuat, scratch);
      layers.neck.commit(lookPitch * 0.3, lookYaw * 0.25, 0, modelQuat, scratch);
      layers.head.commit(lookPitch * 0.7 + nod, lookYaw * 0.55 + sway, talk * 0.04 * Math.sin(talkClock * 2.9 + phase2), modelQuat, scratch);
      if (armBlend > 0.01 && !moving) {
        layers.armR.commit(-armBlend * (0.3 + 0.18 * phrase * beat), 0, 0, modelQuat, scratch);
        layers.foreR.commit(-armBlend * (0.65 + 0.35 * phrase * beat), 0, 0, modelQuat, scratch);
        layers.foreL.commit(-armBlend * (0.12 + 0.12 * phrase * Math.sin(talkClock * 6.5 + phase + 2.1)), 0, 0, modelQuat, scratch);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const l of layers.all) l.begin();
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      model.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh === true) (o as SkinnedMesh).skeleton.dispose();
      });
      disposeDressing(dressing);
      root.removeFromParent();
      current = null;
    },
  };
  return rig;
}

/** Test and gallery helper: the clip name that currently plays is not exposed on the rig, so expose the mapping. */
export function humanClipMap(file: string): HumanClipMap | null {
  return templates.get(file)?.names ?? null;
}

/** Measured ground speed (m/s at the body's native size) of the walk and run clips, for tests and the gallery. */
export function humanStrides(file: string): { walk: number | null; run: number | null; height: number } | null {
  const t = templates.get(file);
  return t === undefined ? null : { walk: t.walkNative, run: t.runNative, height: t.height };
}
