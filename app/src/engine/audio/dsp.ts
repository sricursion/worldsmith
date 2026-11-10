// Offline signal maths for the sound engine. Everything here fills plain Float32Arrays and
// never touches Web Audio, so it runs under Node and is rendered once per key in the browser.

import type { Rng } from '../../world/rng';

export type NoiseColor = 'white' | 'pink' | 'brown';

const TAU = Math.PI * 2;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function rms(data: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    acc += v * v;
  }
  return data.length > 0 ? Math.sqrt(acc / data.length) : 0;
}

export function peak(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i] ?? 0);
    if (v > p) p = v;
  }
  return p;
}

/** Scales the channels together so their mean RMS is `target`, then soft-limits stray peaks. */
export function normaliseRms(channels: readonly Float32Array[], target: number): void {
  let acc = 0;
  for (const ch of channels) acc += rms(ch);
  const mean = channels.length > 0 ? acc / channels.length : 0;
  if (mean < 1e-9) return;
  const k = target / mean;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = (ch[i] ?? 0) * k;
      // Linear below 0.7, tanh knee above, so texture loops with a high crest factor never clip.
      ch[i] = Math.abs(v) < 0.7 ? v : Math.sign(v) * (0.7 + 0.29 * Math.tanh((Math.abs(v) - 0.7) / 0.29));
    }
  }
}

export function normalisePeak(data: Float32Array, target: number): void {
  const p = peak(data);
  if (p < 1e-9) return;
  const k = target / p;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) * k;
}

/**
 * Fills `out` with noise that loops without a seam: the tail that would follow the last sample
 * is blended into the head with equal-power weights. RMS is normalised to 0.25 for every colour
 * so gain staging downstream does not depend on the colour.
 */
export function fillNoise(out: Float32Array, color: NoiseColor, rng: Rng): void {
  const n = out.length;
  const blend = Math.min(4096, n >> 2);
  const raw = new Float32Array(n + blend);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rng.next() * 2 - 1;
    if (color === 'white') {
      raw[i] = w;
    } else if (color === 'pink') {
      // Paul Kellet's economy pink filter: -3 dB per octave within half a dB down to 10 Hz.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      // Leaky integrator: -6 dB per octave, the leak keeps it from wandering off as DC.
      brown = (brown + 0.02 * w) / 1.02;
      raw[i] = brown;
    }
  }
  for (let i = 0; i < n; i++) {
    if (i < blend) {
      const x = (i / blend) * (Math.PI / 2);
      out[i] = (raw[i] ?? 0) * Math.sin(x) + (raw[n + i] ?? 0) * Math.cos(x);
    } else {
      out[i] = raw[i] ?? 0;
    }
  }
  normaliseRms([out], 0.25);
}

export type FilterShape = 'lp' | 'hp' | 'bp';

/** RBJ cookbook biquad, transposed direct form II. The band-pass has 0 dB gain at its centre. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(shape: FilterShape, sr: number, f: number, q: number) {
    this.set(shape, sr, f, q);
  }

  set(shape: FilterShape, sr: number, f: number, q: number): void {
    const w0 = TAU * clamp(f, 10, sr * 0.45) / sr;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(0.05, q));
    const a0 = 1 + alpha;
    if (shape === 'lp') {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else if (shape === 'hp') {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export interface PingOpts {
  /** Start frequency in Hz. */
  f: number;
  /** Frequency reached after three time constants; defaults to `f`. */
  fEnd?: number;
  /** Decay time constant in seconds. */
  tau: number;
  amp: number;
  phase?: number;
  /** When true the tail wraps to the start of the buffer, for seamless loops. */
  wrap?: boolean;
}

/** Adds an exponentially damped sine: the sound of one struck mode. */
export function addPing(out: Float32Array, start: number, sr: number, o: PingOpts): void {
  const n = out.length;
  const len = Math.ceil(o.tau * 7 * sr);
  const fEnd = o.fEnd ?? o.f;
  let ph = o.phase ?? 0;
  // Two samples of fade-in remove the step a non-zero starting phase would make.
  for (let k = 0; k < len; k++) {
    let i = start + k;
    if (i >= n) {
      if (!o.wrap) break;
      i %= n;
    }
    const t = k / sr;
    const glide = Math.min(1, t / (o.tau * 3));
    ph += (TAU * (o.f + (fEnd - o.f) * glide)) / sr;
    const edge = k < 2 ? (k + 1) / 3 : 1;
    out[i] = (out[i] ?? 0) + Math.sin(ph) * Math.exp(-t / o.tau) * o.amp * edge;
  }
}

export interface BurstOpts {
  shape: FilterShape;
  f: number;
  /** Centre or cutoff reached at the end of the burst; the filter is re-tuned every 32 samples. */
  fEnd?: number;
  q: number;
  /** Linear attack in seconds. */
  attack: number;
  /** Decay time constant in seconds. */
  decay: number;
  amp: number;
  wrap?: boolean;
}

/** Adds a burst of filtered white noise with a linear attack and exponential decay. */
export function addBurst(out: Float32Array, start: number, sr: number, o: BurstOpts, rng: Rng): void {
  const n = out.length;
  const attack = Math.max(1, Math.round(o.attack * sr));
  const len = attack + Math.ceil(o.decay * 7 * sr);
  const bq = new Biquad(o.shape, sr, o.f, o.q);
  // A band-pass passes roughly f/q of the spectrum; compensate so narrow bursts keep their level.
  const comp = o.shape === 'bp' ? Math.sqrt(clamp((sr * 0.5 * o.q) / (o.f * 1.57), 1, 400)) * 0.5 : 1;
  for (let k = 0; k < len; k++) {
    let i = start + k;
    if (i >= n) {
      if (!o.wrap) break;
      i %= n;
    }
    if (o.fEnd !== undefined && (k & 31) === 0) {
      bq.set(o.shape, sr, o.f + (o.fEnd - o.f) * (k / len), o.q);
    }
    const env = k < attack ? k / attack : Math.exp(-(k - attack) / (o.decay * sr));
    out[i] = (out[i] ?? 0) + bq.run(rng.next() * 2 - 1) * env * o.amp * comp;
  }
}

/** Equal-power pan gains for a position in [-1, 1]. */
export function panGains(pan: number): [number, number] {
  const x = (clamp(pan, -1, 1) + 1) * (Math.PI / 4);
  return [Math.cos(x), Math.sin(x)];
}

export interface ImpulseOpts {
  /** Length of the tail in seconds (reaches -60 dB at the end). */
  seconds: number;
  /** 0 bright stone canyon .. 1 soft, absorbent open ground. */
  damping: number;
  /** Gap before the first reflection, in seconds. */
  predelay: number;
}

/**
 * A stereo reverb impulse response made of decaying noise whose high end dies faster than its
 * low end, with a handful of discrete early reflections in front of the diffuse tail.
 */
export function renderImpulse(sr: number, o: ImpulseOpts, rng: Rng): [Float32Array, Float32Array] {
  const pre = Math.round(o.predelay * sr);
  const n = pre + Math.max(64, Math.round(o.seconds * sr));
  const make = (): Float32Array => {
    const out = new Float32Array(n);
    let s = 0;
    const build = Math.round(0.02 * sr);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const x = t / o.seconds;
      const fc = 400 + 11000 * Math.exp(-(1.5 + o.damping * 5) * x);
      const a = 1 - Math.exp((-TAU * fc) / sr);
      s += a * (rng.next() * 2 - 1 - s);
      const swell = i - pre < build ? (i - pre) / build : 1;
      out[i] = s * Math.exp(-6.9 * x) * swell;
    }
    const taps = 7;
    for (let k = 0; k < taps; k++) {
      const at = pre + Math.round(rng.range(0.004, 0.075) * sr);
      if (at < n) out[at] = (out[at] ?? 0) + (k % 2 === 0 ? 1 : -1) * rng.range(0.25, 0.7) * (1 - o.damping * 0.5);
    }
    // Fade the last 10 percent so the tail ends on silence instead of a truncation click.
    const fade = Math.round(n * 0.1);
    for (let i = 0; i < fade; i++) {
      const j = n - 1 - i;
      out[j] = (out[j] ?? 0) * (i / fade);
    }
    return out;
  };
  const left = make();
  const right = make();
  let energy = 0;
  for (let i = 0; i < n; i++) energy += (left[i] ?? 0) ** 2 + (right[i] ?? 0) ** 2;
  const k = energy > 0 ? 1 / Math.sqrt(energy / 2) : 1;
  for (let i = 0; i < n; i++) {
    left[i] = (left[i] ?? 0) * k;
    right[i] = (right[i] ?? 0) * k;
  }
  return [left, right];
}

export interface PluckOpts {
  freq: number;
  seconds: number;
  /** 0 dull nylon .. 1 bright wire. */
  brightness: number;
  /** Seconds for the fundamental to fall 60 dB. */
  sustain: number;
  /** Where along the string it is plucked, 0.05 near the bridge .. 0.5 in the middle. */
  position: number;
}

/**
 * Karplus-Strong plucked string with a fractional delay so it plays in tune, a pick-position
 * comb on the excitation, and a loop filter whose weight sets how fast the highs die.
 */
export function renderPluck(sr: number, o: PluckOpts, rng: Rng): Float32Array {
  const n = Math.round(o.seconds * sr);
  const out = new Float32Array(n);
  const s = 0.5 - 0.38 * clamp(o.brightness, 0, 1); // loop-filter weight on the older sample
  const period = sr / o.freq - s; // the two-point average delays the loop by s samples
  const whole = Math.floor(period);
  const frac = period - whole;
  if (whole < 2) return out;
  const size = whole + 2;
  const line = new Float32Array(size);
  const g = Math.pow(10, -3 / (o.freq * Math.max(0.05, o.sustain)));

  const exc = new Float32Array(whole);
  let lp = 0;
  const a = 0.25 + 0.7 * clamp(o.brightness, 0, 1);
  for (let i = 0; i < whole; i++) {
    lp += a * (rng.next() * 2 - 1 - lp);
    exc[i] = lp;
  }
  const comb = Math.max(1, Math.round(whole * clamp(o.position, 0.05, 0.5)));
  for (let i = whole - 1; i >= comb; i--) exc[i] = (exc[i] ?? 0) - (exc[i - comb] ?? 0);

  let w = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const d0 = line[(w - whole + size * 2) % size] ?? 0;
    const d1 = line[(w - whole - 1 + size * 2) % size] ?? 0;
    const cur = d0 * (1 - frac) + d1 * frac;
    const y = g * ((1 - s) * cur + s * prev) + (i < whole ? (exc[i] ?? 0) : 0);
    prev = cur;
    line[w] = y;
    w = (w + 1) % size;
    out[i] = y;
  }
  // Soften the first millisecond and fade the end so a truncated note does not click.
  const edge = Math.round(0.001 * sr);
  for (let i = 0; i < edge && i < n; i++) out[i] = (out[i] ?? 0) * (i / edge);
  const fade = Math.min(n, Math.round(0.06 * sr));
  for (let i = 0; i < fade; i++) {
    const j = n - 1 - i;
    out[j] = (out[j] ?? 0) * (i / fade);
  }
  normalisePeak(out, 0.8);
  return out;
}

/** Equal-tempered frequency of a MIDI note number. */
export function midiHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
