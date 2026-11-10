// Measures how fast a walk or run clip carries the body over the ground, so playback can be matched to the
// speed the game actually moves the root at. The clips play in place, so the planted foot is the ruler: while a
// foot is on the ground it travels backwards relative to the hips at exactly the ground speed the clip implies.
import { AnimationMixer, Vector3 } from 'three';
import type { AnimationClip, Bone, Object3D } from 'three';

const SAMPLES = 40;

/** GLTFLoader strips dots from node names ("Foot.L" loads as "FootL"), so both spellings are tried. */
function findBone(root: Object3D, name: string): Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, '')) ?? null;
}

/** Ground speed implied by `clip`, in the model's own units per second, or null when the rig cannot be read.
 * `model` must be a private copy (it is posed); it is left posed at an arbitrary frame. */
export function measureStrideSpeed(model: Object3D, clip: AnimationClip): number | null {
  const hips = findBone(model, 'Hips');
  const footL = findBone(model, 'Foot.L');
  const footR = findBone(model, 'Foot.R');
  if (hips === null || footL === null || footR === null || !(clip.duration > 0.1)) return null;

  const mixer = new AnimationMixer(model);
  mixer.clipAction(clip).play();
  const feet: Object3D[] = [footL, footR];
  // Positions are taken in the model's own frame so the root's scale and heading do not matter.
  model.updateWorldMatrix(true, true);
  const inv = model.matrixWorld.clone().invert();
  const tmp = new Vector3();
  const hipsPos = new Vector3();
  const dt = clip.duration / SAMPLES;

  // ys[f][i]: foot height above the model origin; zs[f][i]: foot position ahead of the hips.
  const ys: number[][] = [[], []];
  const zs: number[][] = [[], []];
  for (let i = 0; i < SAMPLES; i++) {
    mixer.setTime(i * dt);
    model.updateMatrixWorld(true);
    hips.getWorldPosition(hipsPos).applyMatrix4(inv);
    for (let f = 0; f < 2; f++) {
      (feet[f] as Object3D).getWorldPosition(tmp).applyMatrix4(inv);
      (ys[f] as number[]).push(tmp.y);
      (zs[f] as number[]).push(tmp.z - hipsPos.z);
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);

  let sum = 0;
  let count = 0;
  for (let f = 0; f < 2; f++) {
    const y = ys[f] as number[];
    const z = zs[f] as number[];
    const lo = Math.min(...y);
    const hi = Math.max(...y);
    const limit = lo + (hi - lo) * 0.3;
    for (let i = 0; i < SAMPLES; i++) {
      const j = (i + 1) % SAMPLES;
      if ((y[i] as number) > limit || (y[j] as number) > limit) continue;
      // The body faces +Z, so a planted foot slides toward -Z relative to the hips; sideways sway is not travel.
      sum += ((z[i] as number) - (z[j] as number)) / dt;
      count++;
    }
  }
  if (count < 3) return null;
  return Math.abs(sum / count);
}

/** Bones the procedural layer drives, looked up once per model. Any may be missing on an odd rig. */
export interface HumanBones {
  head: Bone | null;
  neck: Bone | null;
  chest: Bone | null;
  armR: Bone | null;
  foreR: Bone | null;
  armL: Bone | null;
  foreL: Bone | null;
}

function asBone(o: Object3D | null): Bone | null {
  return o !== null && (o as Bone).isBone === true ? (o as Bone) : null;
}

export function findHumanBones(model: Object3D): HumanBones {
  const get = (n: string): Bone | null => asBone(findBone(model, n));
  return {
    head: get('Head'),
    neck: get('Neck'),
    chest: get('Chest') ?? get('Torso'),
    armR: get('UpperArm.R'),
    foreR: get('LowerArm.R'),
    armL: get('UpperArm.L'),
    foreL: get('LowerArm.L'),
  };
}
