// Maps the logical animation names the game plays onto the clips inside the Quaternius human GLBs.
// Two rig families ship in the pack. The "CharacterArmature" bodies carry 24 clips (Idle, Idle_Neutral, Walk, Run,
// Wave, Interact, ...); the "HumanArmature" bodies carry 11 clips prefixed Female_ or Man_ (Idle, Walk, Run, Sitting,
// Clapping, ...). Neither family ships a talking clip, so talk is idle plus procedural head and arm motion.
import type { CharacterClip } from '../character';

export const HUMAN_CLIPS: readonly CharacterClip[] = ['idle', 'walk', 'run', 'talk', 'sit', 'wave', 'gesture', 'cheer', 'use', 'look_around'];

/** "CharacterArmature|Idle_Neutral" -> "Idle_Neutral", "HumanArmature|Female_Walk" -> "Walk". */
export function shortClipName(name: string): string {
  const tail = name.slice(name.lastIndexOf('|') + 1);
  return tail.replace(/^(?:Female|Man)_/, '');
}

/** Short clip names per logical name, best first. An empty list means the pack has no such clip. */
export const HUMAN_CLIP_CANDIDATES: Record<CharacterClip, readonly string[]> = {
  idle: ['Idle_Neutral', 'Idle', 'Standing'],
  walk: ['Walk'],
  run: ['Run'],
  talk: [],
  sit: ['Sitting'],
  wave: ['Wave'],
  gesture: ['Interact'],
  cheer: ['Clapping', 'Wave'],
  use: ['Interact'],
  look_around: ['Idle', 'Standing'],
};

/** What stands in when a model lacks the clip: first present entry wins, idle is the floor. */
export const HUMAN_CLIP_FALLBACKS: Record<CharacterClip, readonly CharacterClip[]> = {
  idle: [],
  walk: ['run', 'idle'],
  run: ['walk', 'idle'],
  talk: ['idle'],
  sit: ['idle'],
  wave: ['cheer', 'gesture', 'idle'],
  gesture: ['use', 'wave', 'idle'],
  cheer: ['wave', 'gesture', 'idle'],
  use: ['gesture', 'idle'],
  look_around: ['idle'],
};

export type HumanClipMap = Record<CharacterClip, string | null>;

/** Resolves each logical name to a real clip name present in `available` (full names as in the GLB), or null. */
export function resolveHumanClips(available: readonly string[]): HumanClipMap {
  const byShort = new Map<string, string>();
  for (const full of available) {
    const s = shortClipName(full);
    if (!byShort.has(s)) byShort.set(s, full);
  }
  const out = {} as HumanClipMap;
  for (const logical of HUMAN_CLIPS) {
    let hit: string | null = null;
    for (const cand of HUMAN_CLIP_CANDIDATES[logical]) {
      const full = byShort.get(cand);
      if (full !== undefined) {
        hit = full;
        break;
      }
    }
    out[logical] = hit;
  }
  return out;
}

/** The clip name that actually plays for a logical name, following the fallback chain. */
export function playableClip(map: HumanClipMap, logical: CharacterClip): { logical: CharacterClip; name: string } | null {
  const direct = map[logical];
  if (direct !== null) return { logical, name: direct };
  for (const alt of HUMAN_CLIP_FALLBACKS[logical]) {
    const name = map[alt];
    if (name !== null) return { logical: alt, name };
  }
  return null;
}
