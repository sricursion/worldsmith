// The one-shot events, synthesised. Three small engines cover every kind: a voiced call (a pitched
// source through a formant, for animals, horns and shouts), a struck body (decaying partials, for
// bells, anvils, hooves and drips) and a noise gesture (a filtered swell or a run of bursts, for
// gusts, doors, steam and static). Each event is one short graph that frees itself when it ends.

import { makeRng } from '../../world/rng';
import type { NoiseColor } from './dsp';
import type { Fired } from './events';
import { chain, filterNode, gainNode, oneShot, oscNode, panNode, type Kit } from './kit';
import type { EventKind } from './vocab';

/** One note of a call: seconds, pitch ratio at its start and end, silence after it. */
type Note = readonly [number, number, number, number];

interface Call {
  wave: OscillatorType;
  f: number;
  notes: readonly Note[];
  /** How many times the phrase is said, lowest and highest. */
  repeat: readonly [number, number];
  formant: number;
  q: number;
  gain: number;
  /** Vibrato: rate in hertz and depth as a fraction of the pitch. */
  vib?: readonly [number, number];
  /** Roughness: amplitude flutter rate in hertz and depth 0..1. */
  rough?: readonly [number, number];
  /** A second voice at this pitch ratio. */
  chord?: number;
  attack?: number;
  /** Moves across the stereo field while it sounds. */
  sweep?: boolean;
}

const CALLS: Partial<Record<EventKind, Call>> = {
  gull: { wave: 'sawtooth', f: 900, notes: [[0.3, 0.85, 1.3, 0.02], [0.25, 1.3, 0.8, 0.15]], repeat: [2, 4], formant: 1800, q: 3, gain: 0.05 },
  crow: { wave: 'sawtooth', f: 520, notes: [[0.22, 1.05, 0.9, 0.14]], repeat: [2, 4], formant: 1400, q: 2, gain: 0.055, rough: [70, 0.8] },
  owl: { wave: 'sine', f: 340, notes: [[0.22, 1, 0.97, 0.25], [0.12, 1, 1, 0.08], [0.3, 1.02, 0.93, 0.5]], repeat: [1, 2], formant: 400, q: 0.8, gain: 0.08 },
  wolf: { wave: 'triangle', f: 420, notes: [[0.6, 0.7, 1.25, 0], [1.6, 1.25, 1.2, 0], [1, 1.2, 0.8, 0.6]], repeat: [1, 2], formant: 700, q: 1.5, gain: 0.06, vib: [5, 0.012], attack: 0.15 },
  dog: { wave: 'sawtooth', f: 380, notes: [[0.09, 1.3, 0.85, 0.17]], repeat: [2, 5], formant: 900, q: 2, gain: 0.055, rough: [55, 0.5] },
  hawk: { wave: 'sawtooth', f: 2300, notes: [[0.9, 1.1, 0.7, 0.5]], repeat: [1, 2], formant: 2600, q: 3, gain: 0.035, rough: [40, 0.35] },
  rooster: { wave: 'sawtooth', f: 620, notes: [[0.14, 0.8, 1, 0.05], [0.12, 1, 1.05, 0.04], [0.2, 1.05, 1.25, 0.02], [0.6, 1.25, 0.75, 0.8]], repeat: [1, 1], formant: 1500, q: 2.5, gain: 0.045 },
  whoop: { wave: 'sawtooth', f: 300, notes: [[0.25, 0.7, 1.5, 0.12]], repeat: [3, 7], formant: 800, q: 2, gain: 0.055, rough: [45, 0.3] },
  squawk: { wave: 'sawtooth', f: 1100, notes: [[0.16, 1.1, 0.85, 0.1]], repeat: [1, 3], formant: 2200, q: 3, gain: 0.04, rough: [95, 0.9] },
  coo: { wave: 'sine', f: 480, notes: [[0.18, 0.95, 1.05, 0.06], [0.4, 1.05, 0.92, 0.3]], repeat: [2, 3], formant: 500, q: 0.8, gain: 0.055, vib: [18, 0.03] },
  low: { wave: 'sawtooth', f: 130, notes: [[1.3, 0.85, 1.1, 0.1], [0.6, 1.1, 0.8, 0.8]], repeat: [1, 1], formant: 500, q: 1.5, gain: 0.07, attack: 0.2 },
  growl: { wave: 'sawtooth', f: 85, notes: [[1.6, 1, 0.85, 0.6]], repeat: [1, 1], formant: 350, q: 1, gain: 0.08, rough: [28, 0.9], attack: 0.25 },
  seal: { wave: 'sawtooth', f: 300, notes: [[0.16, 1.1, 0.8, 0.14]], repeat: [2, 4], formant: 700, q: 3, gain: 0.05, rough: [50, 0.6] },
  whale: { wave: 'sine', f: 220, notes: [[1.8, 0.8, 1.5, 0.1], [1.5, 1.5, 0.6, 1]], repeat: [1, 1], formant: 300, q: 0.7, gain: 0.08, vib: [3, 0.02], attack: 0.4 },
  squeak: { wave: 'sine', f: 3800, notes: [[0.05, 1, 1.3, 0.06]], repeat: [2, 5], formant: 4000, q: 1, gain: 0.02 },
  fly: { wave: 'sawtooth', f: 190, notes: [[1.4, 0.95, 1.08, 0.2]], repeat: [1, 1], formant: 1200, q: 1.2, gain: 0.025, rough: [30, 0.5], attack: 0.4, sweep: true },
  horn: { wave: 'sawtooth', f: 175, notes: [[1.6, 0.98, 1, 0.25], [2.2, 1.5, 1.49, 1]], repeat: [1, 1], formant: 600, q: 0.8, gain: 0.055, attack: 0.15 },
  call: { wave: 'sawtooth', f: 210, notes: [[0.22, 1, 1.3, 0.05], [0.5, 1.3, 0.9, 0.4]], repeat: [1, 2], formant: 900, q: 2, gain: 0.05, vib: [6, 0.01] },
  train: { wave: 'sawtooth', f: 330, notes: [[1.1, 1, 1, 0.3], [2.2, 1, 0.985, 1]], repeat: [1, 1], formant: 700, q: 0.6, gain: 0.04, chord: 1.2, attack: 0.08 },
  servo: { wave: 'sawtooth', f: 220, notes: [[0.5, 0.7, 1.6, 0.3]], repeat: [1, 2], formant: 900, q: 3, gain: 0.022, attack: 0.05 },
  creak: { wave: 'sawtooth', f: 38, notes: [[0.7, 0.8, 1.3, 0.15], [0.5, 1.3, 0.9, 0.4]], repeat: [1, 1], formant: 620, q: 9, gain: 0.07, attack: 0.1 },
};

/** One partial of a struck body: pitch ratio, decay relative to the body's, loudness. */
type Partial3 = readonly [number, number, number];

interface Strike {
  f: number;
  partials: readonly Partial3[];
  /** Decay time constant of the body in seconds. */
  tau: number;
  hits: readonly [number, number];
  /** Seconds between hits. */
  spacing: readonly [number, number];
  /** Hits fall on a steady beat instead of scattering. */
  even?: boolean;
  gain: number;
  /** A noise tick at the moment of contact. */
  click?: boolean;
  /** Pitch ratio each hit slides to as it rings. */
  glide?: number;
  /** Pitch ratios a hit may pick from. */
  scale?: readonly number[];
  sweep?: boolean;
}

const STRIKES: Partial<Record<EventKind, Strike>> = {
  bell: { f: 330, partials: [[0.5, 1.2, 0.4], [1, 1, 1], [1.19, 0.8, 0.5], [2, 0.5, 0.35]], tau: 1.4, hits: [1, 4], spacing: [1.7, 2.3], even: true, gain: 0.05 },
  chime: { f: 1500, partials: [[1, 1, 1], [2.76, 0.4, 0.3]], tau: 0.9, hits: [3, 7], spacing: [0.08, 0.6], gain: 0.022, scale: [1, 1.125, 1.25, 1.5, 1.667, 2] },
  gong: { f: 110, partials: [[1, 1, 1], [1.48, 0.8, 0.6], [2.31, 0.6, 0.5], [3.2, 0.4, 0.3]], tau: 2.6, hits: [1, 1], spacing: [1, 1], gain: 0.07 },
  anvil: { f: 1250, partials: [[1, 1, 1], [2.4, 0.6, 0.5], [3.9, 0.35, 0.3]], tau: 0.12, hits: [3, 8], spacing: [0.42, 0.6], even: true, gain: 0.045, click: true },
  clink: { f: 2600, partials: [[1, 1, 1], [1.7, 0.6, 0.5]], tau: 0.06, hits: [1, 3], spacing: [0.07, 0.3], gain: 0.022, scale: [1, 1.12, 0.9] },
  clank: { f: 260, partials: [[1, 1, 1], [2.3, 0.7, 0.6], [3.6, 0.4, 0.4]], tau: 0.25, hits: [1, 2], spacing: [0.3, 0.7], gain: 0.045, click: true },
  knock: { f: 300, partials: [[1, 1, 1], [2.4, 0.5, 0.3]], tau: 0.035, hits: [2, 5], spacing: [0.22, 0.4], even: true, gain: 0.07, click: true },
  peck: { f: 900, partials: [[1, 1, 1]], tau: 0.012, hits: [8, 14], spacing: [0.055, 0.07], even: true, gain: 0.035, click: true },
  hoof: { f: 520, partials: [[1, 1, 1], [1.8, 0.5, 0.4]], tau: 0.02, hits: [8, 14], spacing: [0.15, 0.22], even: true, gain: 0.05, click: true, scale: [1, 0.84], sweep: true },
  drip: { f: 1300, partials: [[1, 1, 1]], tau: 0.05, hits: [1, 2], spacing: [0.15, 0.5], gain: 0.035, glide: 1.4 },
  bubble: { f: 420, partials: [[1, 1, 1]], tau: 0.045, hits: [3, 8], spacing: [0.05, 0.2], gain: 0.035, glide: 1.6, scale: [0.7, 0.85, 1, 1.2, 1.5] },
  beep: { f: 1568, partials: [[1, 1, 1]], tau: 0.07, hits: [1, 3], spacing: [0.18, 0.24], even: true, gain: 0.018 },
};

interface Gesture {
  color: NoiseColor;
  type: BiquadFilterType;
  /** Filter frequency at the start and end of each burst. */
  f0: number;
  f1: number;
  q: number;
  attack: number;
  hold: number;
  release: number;
  gain: number;
  bursts?: readonly [number, number];
  gap?: readonly [number, number];
  sweep?: boolean;
  /** A pitched body under the noise: start and end frequency, decay, loudness. */
  thump?: readonly [number, number, number, number];
}

const GESTURES: Partial<Record<EventKind, Gesture>> = {
  gust: { color: 'pink', type: 'bandpass', f0: 300, f1: 900, q: 1.2, attack: 1.2, hold: 0.5, release: 2, gain: 0.1 },
  rustle: { color: 'white', type: 'highpass', f0: 2500, f1: 4000, q: 0.7, attack: 0.05, hold: 0.02, release: 0.18, gain: 0.03, bursts: [2, 4], gap: [0.08, 0.25] },
  splash: { color: 'white', type: 'bandpass', f0: 1200, f1: 2600, q: 0.8, attack: 0.01, hold: 0.02, release: 0.3, gain: 0.05, thump: [180, 120, 0.05, 0.04] },
  hiss: { color: 'white', type: 'highpass', f0: 3500, f1: 5000, q: 0.7, attack: 0.05, hold: 0.5, release: 0.8, gain: 0.03 },
  carpass: { color: 'pink', type: 'bandpass', f0: 350, f1: 800, q: 0.7, attack: 1.6, hold: 0.2, release: 2.2, gain: 0.09, sweep: true },
  rumble: { color: 'brown', type: 'lowpass', f0: 90, f1: 160, q: 0.7, attack: 1.5, hold: 1, release: 3, gain: 0.2 },
  flap: { color: 'pink', type: 'lowpass', f0: 500, f1: 800, q: 0.7, attack: 0.03, hold: 0.02, release: 0.12, gain: 0.07, bursts: [3, 6], gap: [0.1, 0.3] },
  static: { color: 'white', type: 'bandpass', f0: 1800, f1: 2200, q: 2, attack: 0.01, hold: 0.15, release: 0.08, gain: 0.02, bursts: [2, 5], gap: [0.05, 0.2] },
  spark: { color: 'white', type: 'highpass', f0: 3000, f1: 3000, q: 0.7, attack: 0.002, hold: 0.004, release: 0.02, gain: 0.035, bursts: [3, 8], gap: [0.02, 0.09] },
  icecrack: { color: 'white', type: 'highpass', f0: 1500, f1: 600, q: 0.7, attack: 0.002, hold: 0.004, release: 0.12, gain: 0.07, thump: [900, 120, 0.25, 0.06] },
  door: { color: 'brown', type: 'lowpass', f0: 300, f1: 300, q: 0.7, attack: 0.004, hold: 0.01, release: 0.09, gain: 0.25, thump: [95, 70, 0.05, 0.12] },
};

/** The pitch a kind of event takes in the world with this seed: this town's bell, this valley's wolves. */
export function eventTune(seed: number, kind: EventKind): number {
  return Math.pow(2, makeRng(seed, `event:${kind}`).range(-0.25, 0.25));
}

interface Built {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  end: number;
}

function voiced(kit: Kit, c: Call, base: number, bright: number, level: number, t: number, limit: number, dest: AudioNode): Built {
  const { ctx, rng } = kit;
  const bp = filterNode(ctx, 'bandpass', c.formant * bright, c.q);
  const env = gainNode(ctx, 0);
  chain(bp, env, dest);
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [bp, env];
  const oscs: OscillatorNode[] = [];
  for (const ratio of c.chord ? [1, c.chord] : [1]) {
    const o = oscNode(ctx, c.wave, base * ratio);
    o.connect(bp);
    oscs.push(o);
    sources.push(o);
  }
  if (c.vib) {
    const lfo = oscNode(ctx, 'sine', c.vib[0]);
    const depth = gainNode(ctx, base * c.vib[1]);
    chain(lfo, depth);
    for (const o of oscs) depth.connect(o.frequency);
    sources.push(lfo);
    nodes.push(depth);
  }
  if (c.rough) {
    const mod = oscNode(ctx, 'sine', c.rough[0] * rng.range(0.9, 1.1));
    const depth = gainNode(ctx, c.rough[1] * 0.5);
    const am = gainNode(ctx, 1 - c.rough[1] * 0.5);
    chain(mod, depth);
    depth.connect(am.gain);
    env.disconnect();
    chain(env, am, dest);
    sources.push(mod);
    nodes.push(depth, am);
  }
  const peak = c.gain * level;
  const phrase = c.notes.reduce((acc, n) => acc + n[0] + n[3], 0);
  const repeats = rng.int(c.repeat[0], c.repeat[1]);
  let at = t;
  env.gain.setValueAtTime(0, t);
  for (let rep = 0; rep < repeats && at - t + phrase <= limit; rep++) {
    for (const [dur, from, to, gap] of c.notes) {
      const d = dur * rng.range(0.85, 1.15);
      const attack = Math.min(c.attack ?? 0.02, d * 0.4);
      oscs.forEach((o, i) => {
        const f = base * (i === 0 ? 1 : c.chord ?? 1);
        o.frequency.setValueAtTime(f * from, at);
        o.frequency.exponentialRampToValueAtTime(f * to, at + d);
      });
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(peak, at + attack);
      env.gain.linearRampToValueAtTime(peak * 0.7, at + d * 0.75);
      env.gain.linearRampToValueAtTime(0, at + d);
      at += d + gap * rng.range(0.8, 1.3);
    }
  }
  return { sources, nodes, end: at };
}

function struck(kit: Kit, s: Strike, base: number, level: number, t: number, limit: number, dest: AudioNode): Built {
  const { ctx, rng } = kit;
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [];
  const times: number[] = [];
  const beat = rng.range(s.spacing[0], s.spacing[1]);
  let at = t;
  const hits = rng.int(s.hits[0], s.hits[1]);
  for (let h = 0; h < hits && (h === 0 || at - t < limit - s.tau * 4.5); h++) {
    times.push(at);
    at += s.even ? beat * rng.range(0.96, 1.04) : rng.range(s.spacing[0], s.spacing[1]);
  }
  const ratios = times.map((_, h) => (s.scale ? (s.even ? s.scale[h % s.scale.length] ?? 1 : rng.pick(s.scale)) : 1));
  const loud = times.map((_, h) => (h === 0 ? 1 : rng.range(0.6, 1)));
  for (const [ratio, tauScale, amp] of s.partials) {
    const o = oscNode(ctx, 'sine', base * ratio);
    const g = gainNode(ctx, 0);
    chain(o, g, dest);
    const tau = s.tau * tauScale;
    g.gain.setValueAtTime(0, t);
    let last = -1;
    let lastPeak = 0;
    times.forEach((when, h) => {
      const f = base * ratio * (ratios[h] ?? 1);
      o.frequency.setValueAtTime(f, when);
      if (s.glide) o.frequency.exponentialRampToValueAtTime(f * s.glide, when + tau * 2);
      // Start each hit from wherever the last one has decayed to, so a ringing body is struck again without a step.
      const residue = last < 0 ? 0 : lastPeak * Math.exp(-(when - last - 0.004) / tau);
      const peak = s.gain * amp * level * (loud[h] ?? 1);
      g.gain.setValueAtTime(residue, when);
      g.gain.linearRampToValueAtTime(Math.max(peak, residue), when + 0.003);
      g.gain.setTargetAtTime(0, when + 0.004, tau);
      last = when;
      lastPeak = Math.max(peak, residue);
    });
    sources.push(o);
    nodes.push(g);
  }
  if (s.click) {
    const src = ctx.createBufferSource();
    src.buffer = kit.noise('white');
    src.loop = true;
    const hp = filterNode(ctx, 'bandpass', Math.min(6000, base * 2.5), 0.8);
    const g = gainNode(ctx, 0);
    chain(src, hp, g, dest);
    g.gain.setValueAtTime(0, t);
    times.forEach((when, h) => {
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(s.gain * level * (loud[h] ?? 1) * 1.5, when + 0.001);
      g.gain.linearRampToValueAtTime(0, when + 0.014);
    });
    sources.push(src);
    nodes.push(hp, g);
  }
  return { sources, nodes, end: (times[times.length - 1] ?? t) + s.tau * 5 };
}

function gesture(kit: Kit, g: Gesture, pitch: number, level: number, t: number, limit: number, dest: AudioNode): Built {
  const { ctx, rng } = kit;
  const src = ctx.createBufferSource();
  src.buffer = kit.noise(g.color);
  src.loop = true;
  const filter = filterNode(ctx, g.type, g.f0 * pitch, g.q);
  const env = gainNode(ctx, 0);
  chain(src, filter, env, dest);
  const sources: AudioScheduledSourceNode[] = [src];
  const nodes: AudioNode[] = [filter, env];
  const bursts = g.bursts ? rng.int(g.bursts[0], g.bursts[1]) : 1;
  const one = g.attack + g.hold + g.release;
  let at = t;
  env.gain.setValueAtTime(0, t);
  for (let b = 0; b < bursts && at - t + one <= limit; b++) {
    const peak = g.gain * level * (b === 0 ? 1 : rng.range(0.5, 1));
    const stretch = g.bursts ? 1 : rng.range(0.8, 1.25);
    filter.frequency.setValueAtTime(g.f0 * pitch, at);
    filter.frequency.exponentialRampToValueAtTime(g.f1 * pitch, at + (g.attack + g.hold) * stretch);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + g.attack * stretch);
    env.gain.setValueAtTime(peak, at + (g.attack + g.hold) * stretch);
    env.gain.linearRampToValueAtTime(0, at + one * stretch);
    at += one * stretch + (g.gap ? rng.range(g.gap[0], g.gap[1]) : 0);
  }
  if (g.thump) {
    const [f0, f1, tau, amp] = g.thump;
    const o = oscNode(ctx, 'sine', f0 * pitch);
    o.frequency.setValueAtTime(f0 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(f1 * pitch, t + tau * 3);
    const tg = gainNode(ctx, 0);
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(amp * level, t + 0.004);
    tg.gain.setTargetAtTime(0, t + 0.006, tau);
    chain(o, tg, dest);
    sources.push(o);
    nodes.push(tg);
    at = Math.max(at, t + tau * 6);
  }
  return { sources, nodes, end: at };
}

/**
 * Plays one event into `out`. `tune` is the world's pitch for this kind. Distance dulls the sound
 * and sends more of it to the reverb; everything is scheduled on the audio clock and torn down
 * when the last source stops.
 */
export function playEvent(kit: Kit, out: AudioNode, f: Fired, tune: number): void {
  const { ctx } = kit;
  const t = f.at + 0.03;
  const limit = f.seconds - 0.1;
  const pitch = f.pitch * tune;
  const far = Math.min(1, Math.max(0, f.far));
  const air = filterNode(ctx, 'lowpass', 9500 - 6500 * far, 0.5);
  const pan = panNode(ctx, f.pan);
  const send = gainNode(ctx, 0.2 + 0.5 * far);
  chain(air, pan, out);
  chain(pan, send, kit.reverbIn);

  const call = CALLS[f.kind];
  const strike = STRIKES[f.kind];
  const noise = GESTURES[f.kind];
  let built: Built;
  let sweep = false;
  if (call) {
    built = voiced(kit, call, call.f * pitch, Math.sqrt(pitch), f.level, t, limit, air);
    sweep = call.sweep === true;
  } else if (strike) {
    built = struck(kit, strike, strike.f * pitch, f.level, t, limit, air);
    sweep = strike.sweep === true;
  } else if (noise) {
    built = gesture(kit, noise, pitch, f.level, t, limit, air);
    sweep = noise.sweep === true;
  } else {
    air.disconnect();
    pan.disconnect();
    send.disconnect();
    return;
  }
  const end = Math.min(built.end, f.at + f.seconds) + 0.05;
  if (sweep) {
    // Something passing: it crosses from one side to the other while it sounds.
    const p = (pan as Partial<StereoPannerNode>).pan;
    if (p) {
      const from = f.pan < 0 ? -0.9 : 0.9;
      p.setValueAtTime(from, t);
      p.linearRampToValueAtTime(-from, end);
    }
  }
  oneShot(built.sources, [...built.nodes, air, pan, send], t, end);
}

/** Every kind has exactly one engine; used by the tests to prove none is left without a sound. */
export function hasVoice(kind: EventKind): boolean {
  return [CALLS[kind], STRIKES[kind], GESTURES[kind]].filter((x) => x !== undefined).length === 1;
}
