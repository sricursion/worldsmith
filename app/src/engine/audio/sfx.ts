// One-shot sounds: footsteps from pre-rendered buffers, interface cues, and the syllable blip
// that stands in for NPC speech.

import type { Rng } from '../../world/rng';
import { chain, filterNode, gainNode, oneShot, oscNode, panNode, type Kit } from './kit';
import { renderSplash, renderStep, type StepFamily } from './loops';

export type UiKind = 'open' | 'close' | 'confirm' | 'quest' | 'error' | 'reveal';

const STEP_VARIANTS = 5;
const STEP_GAIN: Record<StepFamily, number> = { soft: 0.55, grit: 0.45, snow: 0.45, wood: 0.5, hard: 0.38, metal: 0.36 };

export interface Feet {
  /** Plays one footfall. `wet` 0..1 lays a splash over it. */
  step(family: StepFamily, running: boolean, wet: number): void;
  dispose(): void;
}

export function createFeet(kit: Kit, out: AudioNode): Feet {
  const { ctx, rng } = kit;
  // One fixed chain per foot; a step allocates only its buffer source.
  const feet = [-0.16, 0.16].map((p) => {
    const g = gainNode(ctx, 1);
    const pan = panNode(ctx, p);
    chain(g, pan, out);
    return { g, pan };
  });
  const send = gainNode(ctx, 0.12);
  send.connect(kit.reverbIn);
  for (const f of feet) f.pan.connect(send);
  let left = true;
  let last = -1;

  const play = (buffer: AudioBuffer, level: number, rate: number, when: number): void => {
    const foot = feet[left ? 0 : 1];
    if (!foot) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = gainNode(ctx, level);
    chain(src, g, foot.g);
    oneShot([src], [g], when, when + buffer.duration / rate + 0.02);
  };

  return {
    step(family, running, wet) {
      let v = rng.int(0, STEP_VARIANTS - 1);
      if (v === last) v = (v + 1) % STEP_VARIANTS;
      last = v;
      const now = ctx.currentTime;
      const level = STEP_GAIN[family] * (running ? 1 : 0.72) * rng.range(0.82, 1);
      play(kit.buffer(`step:${family}:${v}`, (sr, r) => [renderStep(family, sr, r)]), level, rng.range(0.94, 1.07) * (running ? 1.04 : 1), now);
      if (wet > 0.3 && family !== 'snow') {
        play(kit.buffer(`splash:${v % 3}`, (sr, r) => [renderSplash(sr, r)]), 0.3 * wet * (running ? 1 : 0.7), rng.range(0.9, 1.15), now + 0.004);
      }
      left = !left;
    },
    dispose() {
      for (const f of feet) {
        f.g.disconnect();
        f.pan.disconnect();
      }
      send.disconnect();
    },
  };
}

interface Note {
  f: number;
  /** Seconds after the cue starts. */
  at: number;
  /** Decay time constant. */
  tau: number;
  gain: number;
  type?: OscillatorType;
  /** Glide target, reached over the note. */
  to?: number;
}

function playNote(kit: Kit, out: AudioNode, t0: number, n: Note): void {
  const { ctx } = kit;
  const t = t0 + n.at;
  const o = oscNode(ctx, n.type ?? 'sine', n.f);
  if (n.to !== undefined) {
    o.frequency.setValueAtTime(n.f, t);
    o.frequency.exponentialRampToValueAtTime(n.to, t + n.tau * 3);
  }
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(n.gain, t + 0.006);
  g.gain.setTargetAtTime(0, t + 0.012, n.tau);
  chain(o, g, out);
  oneShot([o], [g], t, t + n.tau * 7 + 0.05);
}

/** A struck-bell tone: a sine carrier frequency-modulated at a non-integer ratio with a decaying index. */
export function playBell(kit: Kit, out: AudioNode, t: number, f: number, gain: number, tau: number): void {
  const { ctx } = kit;
  const car = oscNode(ctx, 'sine', f);
  const mod = oscNode(ctx, 'sine', f * 3.51);
  const index = gainNode(ctx, 0);
  index.gain.setValueAtTime(f * 1.6, t);
  index.gain.setTargetAtTime(f * 0.1, t, tau * 0.25);
  chain(mod, index);
  index.connect(car.frequency);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.01, tau);
  chain(car, g, out);
  oneShot([car, mod], [index, g], t, t + tau * 7);
}

/** Interface cues: small, soft and consonant, so they sit over any scene's music. */
export function playUi(kit: Kit, out: AudioNode, kind: UiKind): void {
  const { ctx } = kit;
  const t = ctx.currentTime + 0.005;
  const bus = gainNode(ctx, 1);
  bus.connect(out);
  const send = gainNode(ctx, 0.25);
  chain(bus, send, kit.reverbIn);
  let tail = 1;
  switch (kind) {
    case 'open':
      playNote(kit, bus, t, { f: 440, to: 587.3, at: 0, tau: 0.05, gain: 0.07, type: 'triangle' });
      playNote(kit, bus, t, { f: 880, at: 0.05, tau: 0.07, gain: 0.03 });
      tail = 0.8;
      break;
    case 'close':
      playNote(kit, bus, t, { f: 587.3, to: 392, at: 0, tau: 0.05, gain: 0.06, type: 'triangle' });
      tail = 0.6;
      break;
    case 'confirm':
      playNote(kit, bus, t, { f: 659.3, at: 0, tau: 0.07, gain: 0.07, type: 'triangle' });
      playNote(kit, bus, t, { f: 987.8, at: 0.09, tau: 0.12, gain: 0.07, type: 'triangle' });
      tail = 1.2;
      break;
    case 'quest': {
      // A rising arpeggio that lands on a bell: the one cue allowed to feel like a reward.
      const notes = [523.3, 659.3, 784, 1046.5];
      notes.forEach((f, i) => playNote(kit, bus, t, { f, at: i * 0.085, tau: 0.16, gain: 0.055, type: 'triangle' }));
      playBell(kit, bus, t + 0.34, 1568, 0.05, 0.5);
      tail = 4;
      break;
    }
    case 'error':
      playNote(kit, bus, t, { f: 196, to: 155.6, at: 0, tau: 0.06, gain: 0.08, type: 'square' });
      playNote(kit, bus, t, { f: 185, to: 146.8, at: 0.13, tau: 0.08, gain: 0.08, type: 'square' });
      tail = 1;
      break;
    case 'reveal': {
      // The world appearing: a swell of filtered noise opening upward under an open fifth and a bell.
      const src = ctx.createBufferSource();
      src.buffer = kit.noise('pink');
      src.loop = true;
      const bp = filterNode(ctx, 'bandpass', 300, 1.2);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + 1.5);
      const g = gainNode(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 1.1);
      g.gain.linearRampToValueAtTime(0, t + 1.9);
      chain(src, bp, g, bus);
      oneShot([src], [bp, g], t, t + 2);
      for (const [f, at] of [[196, 0.2], [293.7, 0.5], [392, 0.8], [587.3, 1.1]] as const) {
        playNote(kit, bus, t, { f, at, tau: 0.7, gain: 0.04, type: 'triangle' });
      }
      playBell(kit, bus, t + 1.3, 1174.7, 0.05, 0.9);
      tail = 8;
      break;
    }
  }
  // The cue's bus is released once everything on it has rung out.
  const done = oscNode(ctx, 'sine', 20);
  const mute = gainNode(ctx, 0);
  chain(done, mute, bus);
  oneShot([done], [mute, bus, send], t, t + tail);
}

const BLIP_VOWELS: readonly (readonly [number, number])[] = [[700, 1150], [520, 1750], [330, 2100], [560, 900], [350, 950]];

/**
 * One soft syllable. `pitch` at or below 8 is a multiplier on a neutral speaking pitch (1 is
 * neutral, 0.8 a deep voice, 1.3 a high one); above that it is taken as hertz.
 */
export function playBlip(kit: Kit, out: AudioNode, pitch: number, rng: Rng): void {
  const { ctx } = kit;
  const t = ctx.currentTime + 0.005;
  const base = Number.isFinite(pitch) && pitch > 0 ? (pitch <= 8 ? 165 * pitch : pitch) : 165;
  const f = Math.min(900, Math.max(60, base)) * rng.range(0.93, 1.09);
  const len = rng.range(0.06, 0.1);
  const vowel = rng.pick(BLIP_VOWELS);
  const o = oscNode(ctx, 'sawtooth', f);
  o.frequency.setValueAtTime(f * 1.04, t);
  o.frequency.linearRampToValueAtTime(f * rng.range(0.9, 1.02), t + len);
  const f1 = filterNode(ctx, 'bandpass', vowel[0], 4);
  const f2 = filterNode(ctx, 'bandpass', vowel[1], 6);
  const g2 = gainNode(ctx, 0.5);
  const env = gainNode(ctx, 0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.16, t + 0.012);
  env.gain.setTargetAtTime(0, t + len * 0.55, 0.022);
  o.connect(f1);
  o.connect(f2);
  f1.connect(env);
  chain(f2, g2, env);
  env.connect(out);
  oneShot([o], [f1, f2, g2, env], t, t + len + 0.15);
}
