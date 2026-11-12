// The small synth toolkit the beds, music and effects are built from: cached noise and rendered
// buffers, node helpers, a rack that owns nodes for disposal, and equal-power parameter fades.

import { makeRng, type Rng } from '../../world/rng';
import { fillNoise, type NoiseColor } from './dsp';
import { VOICE_CAP, VoicePool } from './events';

export type Quality = 0 | 1 | 2;

export interface Kit {
  readonly ctx: AudioContext;
  readonly sr: number;
  readonly rng: Rng;
  readonly quality: Quality;
  /** Input of the shared reverb; connect a send gain here. */
  readonly reverbIn: GainNode;
  /** Six seconds of looping noise, generated on first use. */
  noise(color: NoiseColor): AudioBuffer;
  /** A rendered buffer cached by key; `render` returns one Float32Array per channel. */
  buffer(key: string, render: (sr: number, rng: Rng) => readonly Float32Array[]): AudioBuffer;
  /** Drops the cached buffers whose key the test accepts, e.g. the loops rendered for a world that has been left. */
  evict(test: (key: string) => boolean): void;
  /** Drops every cached buffer. */
  clear(): void;
  /** The ceiling on one-shot voices sounding at once, shared by the beds and the events. */
  readonly voices: VoicePool;
}

const NOISE_SECONDS = 6;

export function createKit(ctx: AudioContext, quality: Quality, seed: number): Kit {
  const cache = new Map<string, AudioBuffer>();
  const sr = ctx.sampleRate;
  const reverbIn = ctx.createGain();
  const kit: Kit = {
    ctx,
    sr,
    rng: makeRng(seed, 'audio-live'),
    quality,
    reverbIn,
    noise(color) {
      return kit.buffer(`noise:${color}`, (rate, rng) => {
        const data = new Float32Array(Math.round(rate * NOISE_SECONDS));
        fillNoise(data, color, rng);
        return [data];
      });
    },
    buffer(key, render) {
      const hit = cache.get(key);
      if (hit) return hit;
      // Each buffer gets its own generator, so what it contains does not depend on render order.
      const channels = render(sr, makeRng(seed, key));
      const first = channels[0];
      const buf = ctx.createBuffer(Math.max(1, channels.length), Math.max(1, first ? first.length : 1), sr);
      channels.forEach((data, ch) => buf.getChannelData(ch).set(data));
      cache.set(key, buf);
      return buf;
    },
    evict(test) {
      for (const key of [...cache.keys()]) if (test(key)) cache.delete(key);
    },
    clear() {
      cache.clear();
    },
    voices: new VoicePool(VOICE_CAP[quality]),
  };
  return kit;
}

/** Owns a set of nodes: stops the sources and disconnects everything on dispose. */
export class Rack {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];

  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /** Registers a source and starts it now. */
  run<T extends AudioScheduledSourceNode>(node: T): T {
    this.nodes.push(node);
    this.sources.push(node);
    node.start();
    return node;
  }

  /** Registers a looping buffer source and starts it `offset` seconds into the buffer. */
  loop(ctx: AudioContext, buffer: AudioBuffer, offset = 0, rate = 1): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    if (rate !== 1) s.playbackRate.value = rate;
    this.nodes.push(s);
    this.sources.push(s);
    s.start(0, offset);
    return s;
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
    this.sources.length = 0;
  }
}

export function gainNode(ctx: AudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function filterNode(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function oscNode(ctx: AudioContext, type: OscillatorType, freq: number, detuneCents = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (detuneCents !== 0) o.detune.value = detuneCents;
  return o;
}

/** A stereo position; falls back to a plain gain where StereoPannerNode is missing. */
export function panNode(ctx: AudioContext, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }
  return ctx.createGain();
}

/** Connects the nodes in series and returns the last one. */
export function chain(first: AudioNode, ...rest: AudioNode[]): AudioNode {
  let cur = first;
  for (const n of rest) {
    cur.connect(n);
    cur = n;
  }
  return cur;
}

/**
 * Schedules one-shot sources and frees their whole chain when the last one ends. `nodes` lists
 * everything to disconnect; the sources themselves are included automatically.
 */
export function oneShot(sources: readonly AudioScheduledSourceNode[], nodes: readonly AudioNode[], start: number, stop: number): void {
  let live = sources.length;
  for (const s of sources) {
    s.start(start);
    s.stop(stop);
    s.onended = () => {
      s.disconnect();
      live -= 1;
      if (live === 0) for (const n of nodes) n.disconnect();
    };
  }
}

export const FADE_SECONDS = 2;
const CURVE_POINTS = 17;

/** A gain that remembers its own fade, so a new fade can start from wherever the last one had reached. */
export interface Fader {
  readonly node: GainNode;
  from: number;
  to: number;
  start: number;
  seconds: number;
}

export function createFader(ctx: AudioContext, value: number): Fader {
  return { node: gainNode(ctx, value), from: value, to: value, start: 0, seconds: 0 };
}

function fadeShape(x: number, rising: boolean): number {
  // Quarter sine up, quarter cosine down: two uncorrelated beds crossfading keep constant power.
  return rising ? Math.sin((x * Math.PI) / 2) : 1 - Math.cos((x * Math.PI) / 2);
}

export function faderValue(f: Fader, now: number): number {
  if (f.seconds <= 0 || now >= f.start + f.seconds) return f.to;
  if (now <= f.start) return f.from;
  return f.from + (f.to - f.from) * fadeShape((now - f.start) / f.seconds, f.to > f.from);
}

/** Starts an equal-power fade to `target` from the fader's present value. */
export function fadeTo(f: Fader, target: number, now: number, seconds = FADE_SECONDS): void {
  const cur = faderValue(f, now);
  f.from = cur;
  f.to = target;
  f.start = now;
  f.seconds = seconds;
  const curve: number[] = [];
  for (let i = 0; i < CURVE_POINTS; i++) curve.push(cur + (target - cur) * fadeShape(i / (CURVE_POINTS - 1), target > cur));
  curve[CURVE_POINTS - 1] = target;
  const p = f.node.gain;
  try {
    p.cancelScheduledValues(now);
    p.setValueCurveAtTime(curve, now, seconds);
  } catch {
    // Some engines refuse a curve that touches an automation still in flight; approach instead.
    p.setTargetAtTime(target, now, seconds / 4);
  }
}
