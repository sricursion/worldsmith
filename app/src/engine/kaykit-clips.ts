// Maps the six logical animation names to the clips embedded in the KayKit Adventurers GLBs.
// The real clip list is in tests/engine/kaykit-rig-report.md. There are no root-motion
// variants in this pack, so the first match in each list is used.
export type LogicalClip = 'idle' | 'walk' | 'run' | 'talk' | 'sit' | 'wave';

export const LOGICAL_CLIPS: readonly LogicalClip[] = ['idle', 'walk', 'run', 'talk', 'sit', 'wave'];

/** Candidate clip names per logical name, best first. */
export const CLIP_CANDIDATES: Record<LogicalClip, readonly string[]> = {
  idle: ['Idle', 'Unarmed_Idle'],
  walk: ['Walking_A', 'Walking_B', 'Walking_C'],
  run: ['Running_A', 'Running_B'],
  talk: ['Interact', 'Use_Item', 'Unarmed_Idle'],
  sit: ['Sit_Chair_Idle', 'Sit_Chair_Pose', 'Sit_Floor_Idle'],
  wave: ['Cheer', 'Interact'],
};

export type ClipNameMap = Record<LogicalClip, string | null>;

/** Resolves each logical name against the clip names available on a model. */
export function resolveClipNames(available: readonly string[]): ClipNameMap {
  const have = new Set(available);
  const out: ClipNameMap = { idle: null, walk: null, run: null, talk: null, sit: null, wave: null };
  for (const logical of LOGICAL_CLIPS) {
    out[logical] = CLIP_CANDIDATES[logical].find((n) => have.has(n)) ?? null;
  }
  return out;
}
