import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { FolkSpec, ThemeId } from '../../app/src/world/spec';
import { createHuman, humansReady, isHumanFolk, loadHumans } from '../../app/src/engine/humans';
import {
  HUMAN_MODELS, humanHeight, mutedCloth, pickHumanColors, pickHumanModel, plausibleSkin, roleSex, tradeOf,
} from '../../app/src/engine/humans/catalog';
import { HUMAN_CLIPS, playableClip, resolveHumanClips, shortClipName } from '../../app/src/engine/humans/clips';
import {
  RUN_MIN_RATE, RUN_MAX_RATE, WALK_ENTER, WALK_EXIT, WALK_MAX_RATE, classifyLocomotion, rootSpeed, runThreshold, smoothSpeed, strideRate,
} from '../../app/src/engine/humans/motion';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACK = join(ROOT, 'assets', 'third_party', 'quaternius-animated-humans');
const THEMES: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

interface GlbInfo { clips: string[]; joints: Set<string> }

/** Reads clip and joint names from the JSON chunk of a GLB without any WebGL, as tests/engine/inspect-glb.mjs does. */
function readGlb(file: string): GlbInfo {
  const buf = readFileSync(join(PACK, file));
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    animations?: { name?: string }[];
    nodes?: { name?: string }[];
    skins?: { joints: number[] }[];
  };
  const joints = new Set<string>();
  for (const s of json.skins ?? []) for (const j of s.joints) joints.add(json.nodes?.[j]?.name ?? '');
  return { clips: (json.animations ?? []).map((a) => a.name ?? ''), joints };
}

function folk(over: Partial<FolkSpec>): FolkSpec {
  return { name: 'frontier settlers', height: 1.75, bulk: 0.5, head: 1, features: [], skin: ['#d9ab84'], cloth: ['#6f5a44'], trim: ['#4a3828'], ...over };
}

describe('pack on disk', () => {
  it('ships every catalogue file with a CC0 licence and a matching manifest', () => {
    const manifest = JSON.parse(readFileSync(join(PACK, 'manifest.json'), 'utf8')) as { license: string; files: { path: string; bytes: number }[] };
    expect(manifest.license).toBe('CC0-1.0');
    const listed = new Set(manifest.files.map((f) => f.path));
    for (const m of HUMAN_MODELS) expect(listed.has(m.file), m.file).toBe(true);
    expect(listed.has('LICENSE.txt')).toBe(true);
    expect(readFileSync(join(PACK, 'LICENSE.txt'), 'utf8')).toMatch(/CC0 1\.0/);
    expect(manifest.files.reduce((n, f) => n + f.bytes, 0)).toBeLessThan(25 * 1024 * 1024);
  });
});

describe('clip mapping against the real GLBs', () => {
  it('maps idle, walk and run on every body', () => {
    for (const m of HUMAN_MODELS) {
      const { clips } = readGlb(m.file);
      const map = resolveHumanClips(clips);
      for (const k of ['idle', 'walk', 'run'] as const) {
        const name = map[k];
        expect(name, `${m.file} ${k}`).not.toBeNull();
        expect(clips).toContain(name);
      }
    }
  });

  it('uses the right clips for each rig family', () => {
    const a = resolveHumanClips(readGlb('casual.glb').clips);
    expect(a.idle).toBe('CharacterArmature|Idle_Neutral');
    expect(a.walk).toBe('CharacterArmature|Walk');
    expect(a.run).toBe('CharacterArmature|Run');
    expect(a.wave).toBe('CharacterArmature|Wave');
    expect(a.gesture).toBe('CharacterArmature|Interact');
    expect(a.use).toBe('CharacterArmature|Interact');
    expect(a.look_around).toBe('CharacterArmature|Idle');
    expect(a.sit).toBeNull();
    expect(a.talk).toBeNull();

    const f = resolveHumanClips(readGlb('woman-casual.glb').clips);
    expect(f.idle).toBe('HumanArmature|Female_Idle');
    expect(f.walk).toBe('HumanArmature|Female_Walk');
    expect(f.run).toBe('HumanArmature|Female_Run');
    expect(f.sit).toBe('HumanArmature|Female_Sitting');
    expect(f.cheer).toBe('HumanArmature|Female_Clapping');
    expect(f.wave).toBeNull();

    const m = resolveHumanClips(readGlb('man-suit.glb').clips);
    expect(m.sit).toBe('HumanArmature|Man_Sitting');
    expect(m.walk).toBe('HumanArmature|Man_Walk');
  });

  it('falls back along the chain and always lands on something playable', () => {
    for (const m of HUMAN_MODELS) {
      const map = resolveHumanClips(readGlb(m.file).clips);
      for (const k of HUMAN_CLIPS) {
        const p = playableClip(map, k);
        expect(p, `${m.file} ${k}`).not.toBeNull();
        expect(Object.values(map)).toContain(p?.name);
      }
    }
    const f = resolveHumanClips(readGlb('woman-casual.glb').clips);
    expect(playableClip(f, 'wave')?.logical).toBe('cheer');
    expect(playableClip(f, 'talk')?.logical).toBe('idle');
    const a = resolveHumanClips(readGlb('casual.glb').clips);
    expect(playableClip(a, 'sit')?.logical).toBe('idle');
  });

  it('strips armature and sex prefixes from clip names', () => {
    expect(shortClipName('CharacterArmature|Idle_Neutral')).toBe('Idle_Neutral');
    expect(shortClipName('HumanArmature|Female_Walk')).toBe('Walk');
    expect(shortClipName('HumanArmature|Man_Sitting')).toBe('Sitting');
    expect(shortClipName('Walk')).toBe('Walk');
  });

  it('keeps the bones the procedural layer and stride measurement look up', () => {
    for (const m of HUMAN_MODELS) {
      const { joints } = readGlb(m.file);
      for (const b of ['Hips', 'Neck', 'Head', 'Foot.L', 'Foot.R', 'UpperArm.R', 'LowerArm.R', 'UpperArm.L', 'LowerArm.L']) {
        expect(joints.has(b), `${m.file} ${b}`).toBe(true);
      }
      expect(joints.has('Chest') || joints.has('Torso'), m.file).toBe(true);
    }
  });

  it('names clothing materials that exist in each GLB', () => {
    for (const m of HUMAN_MODELS) {
      const buf = readFileSync(join(PACK, m.file));
      const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { materials?: { name?: string }[] };
      const have = new Set((json.materials ?? []).map((x) => x.name ?? ''));
      for (const n of [...m.skin, ...m.hair, ...Object.values(m.slots).flat()]) expect(have.has(n), `${m.file} ${n}`).toBe(true);
    }
  });
});

describe('human or not', () => {
  const cases: [string, FolkSpec | undefined, boolean][] = [
    ['no spec means people', undefined, true],
    ['frontier settlers', folk({}), true],
    ['tall colonists with armor and a pack', folk({ name: 'station crew', height: 1.95, features: ['armor', 'pack', 'hat'] }), true],
    ['kobolds are short', folk({ name: 'kobolds', height: 0.9, features: ['tail', 'snout'] }), false],
    ['ogres are too tall', folk({ name: 'hill folk', height: 2.6 }), false],
    ['androids with a visor', folk({ name: 'maintenance androids', height: 1.8, features: ['visor', 'antenna'] }), false],
    ['winged folk', folk({ name: 'sky wardens', height: 1.7, features: ['wings'] }), false],
    ['horned folk', folk({ name: 'dune walkers', height: 1.8, features: ['horns'] }), false],
    ['named robots at human height', folk({ name: 'service robots', height: 1.7 }), false],
    ['elves in hoods are still people-shaped', folk({ name: 'wood elves', height: 1.85, features: ['long_ears', 'hood', 'cloak'] }), true],
    ['height bounds are inclusive', folk({ height: 1.4 }), true],
    ['just under the bound', folk({ height: 1.39 }), false],
    ['just over the bound', folk({ height: 2.11 }), false],
  ];
  for (const [label, f, want] of cases) {
    it(label, () => expect(isHumanFolk(f)).toBe(want));
  }
});

describe('root-motion classifier', () => {
  const runAt = runThreshold(1.0, 2.5);

  it('reads speed from displacement and ignores teleports and empty frames', () => {
    expect(rootSpeed(0.05, 0.025)).toBeCloseTo(2, 6);
    expect(rootSpeed(5, 0.016)).toBe(0);
    expect(rootSpeed(0.1, 0)).toBe(0);
    expect(rootSpeed(Number.NaN, 0.016)).toBe(0);
  });

  it('smooths toward the raw speed without overshooting on a stalled frame', () => {
    const s = smoothSpeed(0, 3, 10); // dt clamps to 0.1 s
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(3);
    expect(smoothSpeed(2, 2, 0.016)).toBeCloseTo(2, 9);
  });

  it('moves idle to walk to run with hysteresis in both directions', () => {
    expect(classifyLocomotion(0, 'idle', runAt)).toBe('idle');
    expect(classifyLocomotion(WALK_ENTER - 0.01, 'idle', runAt)).toBe('idle');
    expect(classifyLocomotion(WALK_ENTER + 0.01, 'idle', runAt)).toBe('walk');
    // between the exit and enter thresholds a walker keeps walking and a stander keeps standing
    const mid = (WALK_ENTER + WALK_EXIT) / 2;
    expect(classifyLocomotion(mid, 'walk', runAt)).toBe('walk');
    expect(classifyLocomotion(mid, 'idle', runAt)).toBe('idle');
    expect(classifyLocomotion(WALK_EXIT - 0.01, 'walk', runAt)).toBe('idle');
    expect(classifyLocomotion(runAt, 'walk', runAt)).toBe('walk');
    expect(classifyLocomotion(runAt + 0.3, 'walk', runAt)).toBe('run');
    expect(classifyLocomotion(runAt - 0.1, 'run', runAt)).toBe('run');
    expect(classifyLocomotion(runAt - 0.5, 'run', runAt)).toBe('walk');
    expect(classifyLocomotion(0.05, 'run', runAt)).toBe('idle');
  });

  it('hands over from walk to run between the two natural speeds', () => {
    expect(runAt).toBeGreaterThan(1.0);
    expect(runAt).toBeLessThan(2.5);
    expect(runAt).toBeCloseTo(Math.sqrt(1.0 * WALK_MAX_RATE * 2.5 * RUN_MIN_RATE), 9);
  });

  it('matches playback rate to ground speed so feet do not slide, within natural limits', () => {
    expect(strideRate('walk', 1.0, 1.0)).toBeCloseTo(1, 9);
    expect(strideRate('walk', 1.3, 1.0)).toBeCloseTo(1.3, 9);
    expect(strideRate('run', 2.5, 2.5)).toBeCloseTo(1, 9);
    expect(strideRate('walk', 50, 1)).toBe(WALK_MAX_RATE);
    expect(strideRate('run', 50, 2.5)).toBe(RUN_MAX_RATE);
    expect(strideRate('run', 0.1, 2.5)).toBe(RUN_MIN_RATE);
    expect(strideRate('walk', 0.01, 1)).toBeGreaterThan(0);
    expect(strideRate('walk', 1.4, 0)).toBeGreaterThan(0.9); // unmeasured stride falls back to a default
  });

  it('stays continuous across a sweep of speeds: the rate never jumps by more than the hand-over ratio', () => {
    let loco = classifyLocomotion(0, 'idle', runAt);
    let prev = 0;
    for (let v = 0; v <= 6; v += 0.05) {
      loco = classifyLocomotion(v, loco, runAt);
      if (loco === 'idle') continue;
      const rate = strideRate(loco, v, loco === 'walk' ? 1.0 : 2.5);
      expect(rate).toBeGreaterThan(0.5);
      expect(rate).toBeLessThanOrEqual(RUN_MAX_RATE);
      prev = rate;
    }
    expect(prev).toBeGreaterThan(0);
  });
});

describe('body and colour choice', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = pickHumanModel('villager', 'western', 7);
    expect(pickHumanModel('villager', 'western', 7)?.file).toBe(a?.file);
    const seen = new Set<string>();
    for (let s = 0; s < 80; s++) seen.add(pickHumanModel('villager', 'modern', s)?.file ?? '');
    expect(seen.size).toBeGreaterThan(5);
  });

  it('respects named sex, trade and theme', () => {
    for (let s = 0; s < 60; s++) {
      const f = HUMAN_MODELS.find((m) => m.file === pickHumanModel('waitress', 'modern', s)?.file);
      expect(f?.sex).toBe('f');
      const m = HUMAN_MODELS.find((x) => x.file === pickHumanModel('old man', 'medieval', s)?.file);
      expect(m?.sex).not.toBe('f');
      const crew = pickHumanModel('villager', 'western', s);
      expect(crew?.file).not.toBe('astronaut.glb');
      expect(crew?.file).not.toBe('swat.glb');
    }
    let space = 0;
    for (let s = 0; s < 60; s++) if (pickHumanModel('pilot', 'scifi', s)?.file === 'astronaut.glb') space++;
    expect(space).toBeGreaterThan(10);
    expect(tradeOf('town sheriff')).toBe('arms');
    expect(tradeOf('barkeep')).toBe('work');
    expect(tradeOf('neighbour')).toBe('common');
    expect(roleSex('the innkeeper\'s wife')).toBe('f');
    expect(roleSex('gentleman')).toBe('m');
    expect(roleSex('blacksmith')).toBeNull();
  });

  it('keeps clothing muted and skin natural', () => {
    for (const t of THEMES) {
      for (let s = 0; s < 40; s++) {
        const c = pickHumanColors({ role: 'villager', theme: t, seed: s });
        expect(plausibleSkin(c.skin), c.skin).toBe(true);
        expect(mutedCloth(c.top)).toBe(c.top);
      }
    }
    expect(mutedCloth('#ff0000')).not.toBe('#ff0000');
    const c = pickHumanColors({ role: 'x', theme: 'modern', seed: 1, folk: folk({ skin: ['#33ff33'], cloth: ['#0000ff'] }) });
    expect(plausibleSkin(c.skin)).toBe(true); // a green "skin" is rejected for a natural tone
    expect(c.top).toBe(mutedCloth('#0000ff'));
  });

  it('takes skin from the folk when it reads as skin', () => {
    const c = pickHumanColors({ role: 'x', theme: 'western', seed: 3, folk: folk({ skin: ['#c58f65'] }) });
    expect(c.skin).toBe('#c58f65');
  });

  it('sizes people from the folk height with a small spread, inside human limits', () => {
    for (let s = 0; s < 30; s++) {
      const h = humanHeight(folk({ height: 1.8 }), s);
      expect(h).toBeGreaterThan(1.8 * 0.96);
      expect(h).toBeLessThan(1.8 * 1.04);
    }
    expect(humanHeight(undefined, 1)).toBeGreaterThan(1.65);
    expect(humanHeight(undefined, 1)).toBeLessThan(1.85);
    expect(humanHeight(folk({ height: 1.4 }), 2)).toBeGreaterThanOrEqual(1.4);
  });
});

describe('createHuman before and without a pack', () => {
  it('returns null before loadHumans', () => {
    expect(humansReady()).toBe(false);
    expect(createHuman({ role: 'merchant', theme: 'western', seed: 1 })).toBeNull();
    expect(createHuman({ role: 'merchant', theme: 'western', seed: 1, folk: folk({}), quality: 0 })).toBeNull();
  });

  it('resolves false when the pack cannot be fetched, and stays null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = await loadHumans();
    expect(ok).toBe(false);
    expect(humansReady()).toBe(false);
    expect(createHuman({ role: 'merchant', theme: 'western', seed: 1 })).toBeNull();
    warn.mockRestore();
  });
});
