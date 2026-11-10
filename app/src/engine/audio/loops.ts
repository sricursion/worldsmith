// Pre-rendered textures: loops that would cost thousands of scheduled events per minute if
// played live (rain drops, crickets, frogs, fire crackle) and the one-shot footstep sounds.
// All pure; each is rendered once per key and cached as an AudioBuffer by the kit.

import type { Rng } from '../../world/rng';
import { Biquad, addBurst, addPing, normalisePeak, normaliseRms, panGains } from './dsp';

const TAU = Math.PI * 2;

export type StepFamily = 'soft' | 'grit' | 'snow' | 'wood' | 'hard' | 'metal';
export const STEP_FAMILIES: readonly StepFamily[] = ['soft', 'grit', 'snow', 'wood', 'hard', 'metal'];

function stereo(n: number): [Float32Array, Float32Array] {
  return [new Float32Array(n), new Float32Array(n)];
}

/**
 * Mid layer of rain: individual drops hitting hard ground. Each drop is a few milliseconds of
 * band-passed noise; one in seven lands in water and rings as a short rising plink. Loudness is
 * heavy-tailed, so most drops form a bed and a few close ones stand out.
 */
export function renderRainPatter(sr: number, seconds: number, dropsPerSec: number, rng: Rng): [Float32Array, Float32Array] {
  const n = Math.round(seconds * sr);
  const [l, r] = stereo(n);
  const drops = Math.round(seconds * dropsPerSec);
  const bq = new Biquad('bp', sr, 3000, 2);
  for (let d = 0; d < drops; d++) {
    const start = rng.int(0, n - 1);
    const amp = 0.04 + Math.pow(rng.next(), 3);
    const [gl, gr] = panGains(rng.range(-1, 1));
    if (rng.chance(0.14)) {
      const f = rng.range(900, 2600);
      const tau = rng.range(0.004, 0.012);
      const len = Math.ceil(tau * 6 * sr);
      let ph = 0;
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        ph += (TAU * f * (1 + 0.35 * Math.min(1, t / (tau * 3)))) / sr;
        const v = Math.sin(ph) * Math.exp(-t / tau) * amp * 0.7 * Math.min(1, k / 3);
        const i = (start + k) % n;
        l[i] = (l[i] ?? 0) + v * gl;
        r[i] = (r[i] ?? 0) + v * gr;
      }
      continue;
    }
    const f = 1400 * Math.pow(2, rng.range(0, 2.3));
    const tau = rng.range(0.0012, 0.007);
    const len = Math.ceil(tau * 6 * sr);
    bq.set('bp', sr, f, rng.range(1.2, 4));
    for (let k = 0; k < len; k++) {
      const v = bq.run(rng.next() * 2 - 1) * Math.exp(-k / (tau * sr)) * amp * Math.min(1, k / 2);
      const i = (start + k) % n;
      l[i] = (l[i] ?? 0) + v * gl;
      r[i] = (r[i] ?? 0) + v * gr;
    }
  }
  normaliseRms([l, r], 0.1);
  return [l, r];
}

/** Low layer of rain: drops drumming on roofs, awnings and hollow things. */
export function renderRoofDrum(sr: number, seconds: number, hitsPerSec: number, rng: Rng): [Float32Array] {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const hits = Math.round(seconds * hitsPerSec);
  for (let h = 0; h < hits; h++) {
    const start = rng.int(0, n - 1);
    const amp = 0.08 + Math.pow(rng.next(), 2.5);
    const f = rng.range(70, 260);
    addPing(out, start, sr, { f, fEnd: f * 0.85, tau: rng.range(0.016, 0.055), amp, phase: rng.range(0, TAU), wrap: true });
    addBurst(out, start, sr, { shape: 'lp', f: 700, q: 0.7, attack: 0.0005, decay: 0.006, amp: amp * 0.5, wrap: true }, rng);
  }
  normaliseRms([out], 0.1);
  return [out];
}

/**
 * A field of crickets. Each insect is a sine carrier near 4 to 5 kHz gated into chirps of two to
 * four raised-cosine syllables; one in four is a tree cricket holding a continuous trill. Chirp
 * periods divide the loop exactly, and each insect falls silent for part of it.
 */
export function renderCrickets(sr: number, seconds: number, count: number, rng: Rng): [Float32Array, Float32Array] {
  const n = Math.round(seconds * sr);
  const [l, r] = stereo(n);
  for (let c = 0; c < count; c++) {
    const triller = c % 4 === 3;
    const fc = triller ? rng.range(2600, 3400) : rng.range(3700, 5300);
    const pulseRate = triller ? rng.range(42, 58) : rng.range(26, 38);
    const syllables = triller ? 0 : rng.int(2, 4);
    const chirps = Math.max(1, Math.round(seconds / (triller ? 1 : rng.range(0.38, 0.95))));
    const chirpLen = n / chirps;
    const level = (triller ? 0.25 : 1) * rng.range(0.2, 1);
    const [gl, gr] = panGains(rng.range(-1, 1));
    const restAt = rng.next();
    const restLen = rng.range(0.15, 0.4);
    const pulseLen = Math.round((sr / pulseRate) * 0.62);
    const stride = Math.round(sr / pulseRate);
    for (let ch = 0; ch < chirps; ch++) {
      const where = (ch / chirps - restAt + 1) % 1;
      if (where < restLen) continue;
      const base = Math.round(ch * chirpLen);
      const pulses = triller ? Math.floor(chirpLen / stride) : syllables;
      const loud = level * rng.range(0.8, 1);
      for (let p = 0; p < pulses; p++) {
        const start = base + p * stride;
        for (let k = 0; k < pulseLen; k++) {
          const x = k / pulseLen;
          const env = Math.sin(Math.PI * x) ** 2;
          // The wing stroke slows slightly through each syllable, which pulls the pitch down.
          const v = Math.sin((TAU * fc * (1 - 0.03 * x) * k) / sr) * env * loud;
          const i = (start + k) % n;
          l[i] = (l[i] ?? 0) + v * gl;
          r[i] = (r[i] ?? 0) + v * gr;
        }
      }
    }
  }
  normaliseRms([l, r], 0.05);
  return [l, r];
}

/** A few frogs calling across each other: pulse trains of a harmonic tone that rises through the call. */
export function renderFrogs(sr: number, seconds: number, count: number, rng: Rng): [Float32Array, Float32Array] {
  const n = Math.round(seconds * sr);
  const [l, r] = stereo(n);
  for (let c = 0; c < count; c++) {
    const f0 = rng.range(360, 900);
    const rate = rng.range(15, 24);
    const [gl, gr] = panGains(rng.range(-0.9, 0.9));
    const level = rng.range(0.3, 1);
    const calls = rng.int(2, 4);
    for (let q = 0; q < calls; q++) {
      const pulses = rng.int(4, 9);
      const stride = Math.round(sr / rate);
      const pulseLen = Math.round(stride * 0.7);
      const callLen = pulses * stride;
      const start = rng.int(0, Math.max(0, n - callLen - 1));
      for (let p = 0; p < pulses; p++) {
        const f = f0 * (1 + (0.18 * p) / pulses);
        const swell = Math.sin((Math.PI * (p + 0.5)) / pulses);
        for (let k = 0; k < pulseLen; k++) {
          const x = k / pulseLen;
          const ph = (TAU * f * k) / sr;
          const tone = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph) + 0.12 * Math.sin(5 * ph);
          const v = tone * Math.sin(Math.PI * x) ** 1.5 * swell * level * 0.5;
          const i = start + p * stride + k;
          if (i >= n) break;
          l[i] = (l[i] ?? 0) + v * gl;
          r[i] = (r[i] ?? 0) + v * gr;
        }
      }
    }
  }
  normaliseRms([l, r], 0.04);
  return [l, r];
}

/** Burning wood: a dense spray of tiny snaps with the odd loud pop that carries a low thump. */
export function renderFireCrackle(sr: number, seconds: number, rng: Rng): [Float32Array, Float32Array] {
  const n = Math.round(seconds * sr);
  const [l, r] = stereo(n);
  const snaps = Math.round(seconds * 16);
  const bq = new Biquad('bp', sr, 2000, 2);
  for (let s = 0; s < snaps; s++) {
    const start = rng.int(0, n - 1);
    const pop = rng.chance(0.04);
    const amp = pop ? rng.range(0.7, 1) : 0.03 + Math.pow(rng.next(), 4) * 0.6;
    const [gl, gr] = panGains(rng.range(-0.6, 0.6));
    const tau = rng.range(0.0006, 0.004);
    const len = Math.ceil(tau * 6 * sr);
    bq.set('bp', sr, rng.range(900, 5200), rng.range(1, 3));
    for (let k = 0; k < len; k++) {
      const v = bq.run(rng.next() * 2 - 1) * Math.exp(-k / (tau * sr)) * amp;
      const i = (start + k) % n;
      l[i] = (l[i] ?? 0) + v * gl;
      r[i] = (r[i] ?? 0) + v * gr;
    }
    if (pop) {
      const thump = new Float32Array(Math.ceil(0.12 * sr));
      addPing(thump, 0, sr, { f: rng.range(140, 220), fEnd: 90, tau: 0.014, amp: amp * 0.25 });
      for (let k = 0; k < thump.length; k++) {
        const i = (start + k) % n;
        l[i] = (l[i] ?? 0) + (thump[k] ?? 0) * gl;
        r[i] = (r[i] ?? 0) + (thump[k] ?? 0) * gr;
      }
    }
  }
  normaliseRms([l, r], 0.045);
  return [l, r];
}

function jit(rng: Rng, amount: number): number {
  return 1 + rng.range(-amount, amount);
}

/**
 * One footfall: a heel strike and, 45 to 65 ms later, the sole coming down. What each part is
 * made of depends on the ground: struck modes for wood and metal, grains for gravel and snow,
 * a damped thud for earth, a sharp filtered tick for stone.
 */
export function renderStep(family: StepFamily, sr: number, rng: Rng): Float32Array {
  const seconds = family === 'metal' ? 0.5 : family === 'snow' ? 0.4 : 0.34;
  const out = new Float32Array(Math.round(seconds * sr));
  const at = (t: number): number => Math.round(t * sr);
  const toe = rng.range(0.045, 0.065);

  if (family === 'soft') {
    const f = 78 * jit(rng, 0.12);
    addPing(out, 0, sr, { f, fEnd: f * 0.7, tau: 0.035, amp: 0.9 });
    addBurst(out, 0, sr, { shape: 'lp', f: 420 * jit(rng, 0.2), q: 0.7, attack: 0.004, decay: 0.04, amp: 0.55 }, rng);
    addPing(out, at(toe), sr, { f: f * 1.25, fEnd: f, tau: 0.02, amp: 0.32 });
    addBurst(out, at(toe), sr, { shape: 'lp', f: 900, q: 0.7, attack: 0.004, decay: 0.028, amp: 0.25 }, rng);
    addBurst(out, at(toe * 0.5), sr, { shape: 'bp', f: 2600 * jit(rng, 0.2), q: 0.7, attack: 0.02, decay: 0.05, amp: 0.035 }, rng);
  } else if (family === 'grit') {
    addPing(out, 0, sr, { f: 92 * jit(rng, 0.1), fEnd: 70, tau: 0.02, amp: 0.35 });
    addBurst(out, 0, sr, { shape: 'bp', f: 1700 * jit(rng, 0.2), q: 0.8, attack: 0.003, decay: 0.06, amp: 0.3 }, rng);
    for (let g = 0; g < 46; g++) {
      const second = g >= 30;
      const t = (second ? toe : 0) + 0.15 * rng.next() ** 2;
      addBurst(out, at(t), sr, {
        shape: 'bp', f: rng.range(1800, 6500), q: 3, attack: 0.0003, decay: rng.range(0.0012, 0.004),
        amp: rng.range(0.08, 0.4) * (second ? 0.7 : 1),
      }, rng);
    }
  } else if (family === 'snow') {
    addBurst(out, 0, sr, { shape: 'lp', f: 300, q: 0.7, attack: 0.006, decay: 0.05, amp: 0.45 }, rng);
    for (let g = 0; g < 60; g++) {
      const t = 0.2 * Math.pow(rng.next(), 1.3);
      addBurst(out, at(t), sr, {
        shape: 'bp', f: rng.range(700, 2800), q: 2.5, attack: 0.0006, decay: rng.range(0.003, 0.007),
        amp: rng.range(0.1, 0.36) * (1 - t * 2.5),
      }, rng);
    }
    // Dry cold snow squeaks as the crystals shear under the sole.
    const sq = 1150 * jit(rng, 0.15);
    addBurst(out, at(0.04), sr, { shape: 'bp', f: sq, fEnd: sq * 1.5, q: 18, attack: 0.035, decay: 0.035, amp: 0.2 }, rng);
  } else if (family === 'wood') {
    const k = jit(rng, 0.08);
    addBurst(out, 0, sr, { shape: 'bp', f: 2400, q: 1, attack: 0.0004, decay: 0.004, amp: 0.3 }, rng);
    const modes: readonly [number, number, number][] = [[128, 0.07, 0.85], [305, 0.045, 0.45], [540, 0.028, 0.3], [910, 0.015, 0.15]];
    for (const [f, tau, amp] of modes) {
      addPing(out, 0, sr, { f: f * k * jit(rng, 0.03), tau, amp });
      addPing(out, at(toe), sr, { f: f * k * 1.12, tau: tau * 0.8, amp: amp * 0.45 });
    }
    addBurst(out, at(toe), sr, { shape: 'bp', f: 1800, q: 1, attack: 0.0004, decay: 0.004, amp: 0.14 }, rng);
  } else if (family === 'hard') {
    const k = jit(rng, 0.1);
    for (const [t, a, m] of [[0, 1, 1], [toe, 0.45, 1.2]] as const) {
      addBurst(out, at(t), sr, { shape: 'bp', f: 2900 * k * m, q: 1.2, attack: 0.0003, decay: 0.0035, amp: 0.8 * a }, rng);
      addPing(out, at(t), sr, { f: 1150 * k * m, tau: 0.006, amp: 0.3 * a });
      addPing(out, at(t), sr, { f: 240 * k * m, fEnd: 180, tau: 0.012, amp: 0.5 * a });
      addBurst(out, at(t), sr, { shape: 'lp', f: 500, q: 0.7, attack: 0.001, decay: 0.02, amp: 0.3 * a }, rng);
    }
  } else {
    const k = jit(rng, 0.06);
    addBurst(out, 0, sr, { shape: 'bp', f: 3200, q: 0.8, attack: 0.0003, decay: 0.004, amp: 0.5 }, rng);
    addPing(out, 0, sr, { f: 105 * k, fEnd: 80, tau: 0.03, amp: 0.6 });
    // Inharmonic plate modes; the boot stays on the plate, so they ring far shorter than a struck bar.
    const modes: readonly [number, number, number][] = [[397, 0.11, 0.4], [911, 0.09, 0.33], [1543, 0.06, 0.25], [2318, 0.045, 0.18], [3270, 0.03, 0.1]];
    for (const [f, tau, amp] of modes) {
      const fj = f * k * jit(rng, 0.025);
      addPing(out, 0, sr, { f: fj, tau, amp });
      addPing(out, at(toe), sr, { f: fj * 1.004, tau: tau * 0.7, amp: amp * 0.4, phase: rng.range(0, TAU) });
    }
  }

  const fade = Math.round(0.008 * sr);
  for (let i = 0; i < fade; i++) {
    const j = out.length - 1 - i;
    out[j] = (out[j] ?? 0) * (i / fade);
  }
  normalisePeak(out, 0.8);
  return out;
}

/** The splash laid over a footstep on soaked ground. */
export function renderSplash(sr: number, rng: Rng): Float32Array {
  const out = new Float32Array(Math.round(0.3 * sr));
  addBurst(out, 0, sr, { shape: 'hp', f: 2500, q: 0.7, attack: 0.008, decay: 0.07, amp: 0.4 }, rng);
  addBurst(out, 0, sr, { shape: 'bp', f: 900 * jit(rng, 0.2), q: 0.6, attack: 0.004, decay: 0.05, amp: 0.3 }, rng);
  for (let d = 0; d < 5; d++) {
    const f = rng.range(1100, 2800);
    addPing(out, Math.round(rng.range(0.02, 0.16) * sr), sr, { f, fEnd: f * 1.3, tau: rng.range(0.004, 0.01), amp: rng.range(0.05, 0.2) });
  }
  const fade = Math.round(0.01 * sr);
  for (let i = 0; i < fade; i++) {
    const j = out.length - 1 - i;
    out[j] = (out[j] ?? 0) * (i / fade);
  }
  normalisePeak(out, 0.7);
  return out;
}
