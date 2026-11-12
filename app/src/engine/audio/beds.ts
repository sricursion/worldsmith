// Ambience beds. Each is a small persistent graph feeding one output gain; anything that moves
// (gusts, syllables, waves, thunder, bird song) is driven from tick() with parameter automation
// or short one-shot voices, so a bed costs nothing per frame beyond a few comparisons.

import { makeRng } from '../../world/rng';
import type { BedChar, BedMix } from './mapping';
import { Rack, chain, filterNode, gainNode, oneShot, oscNode, panNode, type Kit } from './kit';
import { renderCrickets, renderFireCrackle, renderFrogs, renderRainPatter, renderRoofDrum } from './loops';
import { createTexture } from './textures';

export interface BedState {
  nearNpc: number;
  indoors: boolean;
}

export interface Bed {
  tick(now: number, st: BedState): void;
  dispose(): void;
}

const BAND = [0.25, 0.55, 0.9] as const;

/** Loops are re-pitched by playing them faster or slower; kept inside a range where they still sound like themselves. */
function loopRate(c: BedChar): number {
  return Math.min(1.25, Math.max(0.8, c.pitch));
}

/** Two decorrelated copies of a noise loop, each through its own chain, panned left and right. */
export function wide(
  kit: Kit, rack: Rack, color: 'white' | 'pink' | 'brown', width: number, dest: AudioNode,
  shape: (side: number) => BiquadFilterNode[],
): BiquadFilterNode[][] {
  const sides: BiquadFilterNode[][] = [];
  for (const side of [-1, 1]) {
    const src = rack.loop(kit.ctx, kit.noise(color), side < 0 ? kit.rng.range(0, 2) : kit.rng.range(2.5, 5));
    const filters = shape(side);
    let cur: AudioNode = src;
    for (const f of filters) cur = chain(cur, rack.add(f));
    chain(cur, rack.add(panNode(kit.ctx, side * width)), dest);
    sides.push(filters);
  }
  return sides;
}

function rainBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const amount = BAND[variant];

  // High: the hiss of drops in the air and on far surfaces.
  const hissBase = 0.15 + 0.3 * amount;
  const hiss = rack.add(gainNode(ctx, hissBase));
  wide(kit, rack, 'white', 0.8, hiss, () => [filterNode(ctx, 'highpass', 2400 * c.colour, 0.5), filterNode(ctx, 'lowpass', 8500 * Math.min(1.2, c.colour), 0.5)]);
  hiss.connect(out);

  // The wash that fills the middle of the spectrum between hiss and drum.
  const wash = rack.add(gainNode(ctx, 0.12 + 0.3 * amount));
  chain(rack.loop(ctx, kit.noise('pink'), 1.3), rack.add(filterNode(ctx, 'bandpass', 900 * c.colour, 0.6)), wash, out);

  // Mid: individual drops, pre-rendered as a stereo loop.
  // Kept far down and very dense: single audible drops read as ticking, so this layer only adds grain to the wash.
  const patterBase = 0.05 + 0.05 * amount;
  const patter = rack.add(gainNode(ctx, patterBase));
  const drops = ([260, 420, 640] as const)[variant];
  chain(rack.loop(ctx, kit.buffer(`rain-patter:${variant}`, (sr, r) => renderRainPatter(sr, 6.5, drops, r)), 0, loopRate(c)), patter, out);

  // Low: drumming on roofs; louder than everything else once the listener is under one.
  const drumBase = 0.1 + 0.14 * amount;
  const drum = rack.add(gainNode(ctx, drumBase));
  const hits = ([6, 14, 26] as const)[variant];
  chain(
    rack.loop(ctx, kit.buffer(`roof-drum:${variant}`, (sr, r) => renderRoofDrum(sr, 7.3, hits, r))),
    rack.add(filterNode(ctx, 'lowpass', 420 * c.colour, 0.7)), drum, out,
  );

  let nextSheet = 0;
  let indoors = false;
  return {
    tick(now, st) {
      if (now >= nextSheet) {
        // Rain arrives in sheets: let the hiss breathe by a few dB.
        hiss.gain.setTargetAtTime(hissBase * rng.range(0.7, 1.25), now, 1.2);
        nextSheet = now + rng.range(2, 5) / c.rate;
      }
      if (st.indoors !== indoors) {
        indoors = st.indoors;
        drum.gain.setTargetAtTime(drumBase * (indoors ? 1.9 : 1), now, 0.3);
        patter.gain.setTargetAtTime(patterBase * (indoors ? 0.5 : 1), now, 0.3);
      }
    },
    dispose: () => rack.dispose(),
  };
}

function thunderBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const send = gainNode(ctx, 0.5);
  send.connect(kit.reverbIn);
  let next = -1;

  const strike = (t: number): void => {
    const far = rng.next();
    const dur = rng.range(5, 9);
    const src = ctx.createBufferSource();
    src.buffer = kit.noise('brown');
    src.loop = true;
    const lp = filterNode(ctx, 'lowpass', far < 0.45 ? 2400 : 500, 0.6);
    lp.frequency.setValueAtTime(far < 0.45 ? 2400 : 500, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + dur);
    const env = gainNode(ctx, 0);
    // A rolling envelope: a fast rise, a long fall, and a few later swells as the sound arrives
    // by other paths.
    const points = 48;
    const curve: number[] = [];
    const swells = [rng.range(0.12, 0.3), rng.range(0.3, 0.55), rng.range(0.5, 0.8)];
    const peak = (1.7 - 1.1 * far) * (0.7 + 0.3 * BAND[variant]);
    for (let i = 0; i < points; i++) {
      const x = i / (points - 1);
      let v = Math.min(1, x * 30) * Math.exp(-3.2 * x);
      for (const s of swells) v += 0.45 * Math.exp(-(((x - s) / 0.05) ** 2)) * (1 - x);
      curve.push(i === points - 1 ? 0 : v * peak);
    }
    env.gain.setValueCurveAtTime(curve, t, dur);
    const pan = panNode(ctx, rng.range(-0.7, 0.7));
    chain(src, lp, env, pan, out);
    pan.connect(send);
    const nodes: AudioNode[] = [lp, env, pan];
    const sources: AudioScheduledSourceNode[] = [src];
    if (far < 0.45) {
      // A close strike opens with the crack of the channel itself.
      const crack = ctx.createBufferSource();
      crack.buffer = kit.noise('white');
      crack.loop = true;
      const hp = filterNode(ctx, 'highpass', 1200, 0.7);
      const cg = gainNode(ctx, 0);
      let at = t;
      cg.gain.setValueAtTime(0, t);
      for (let k = 0; k < 3; k++) {
        cg.gain.linearRampToValueAtTime((0.5 - far) * (1 - k * 0.25), at + 0.006);
        const end = at + rng.range(0.05, 0.11);
        cg.gain.exponentialRampToValueAtTime(0.004, end);
        at = end + rng.range(0.01, 0.05);
      }
      cg.gain.linearRampToValueAtTime(0, at + 0.3);
      chain(crack, hp, cg, pan);
      nodes.push(hp, cg);
      sources.push(crack);
    }
    oneShot(sources, nodes, t, t + dur + 0.1);
  };

  return {
    tick(now) {
      if (next < 0) next = now + rng.range(4, 14);
      if (now < next) return;
      kit.voices.take(now, now + 9);
      strike(now + 0.05);
      next = now + rng.range(12, 40) / c.rate;
    },
    dispose() {
      send.disconnect();
    },
  };
}

function windBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const amount = BAND[variant];
  const base = 0.2 + 0.5 * amount;
  const body = rack.add(gainNode(ctx, base * 0.4));
  const bands = wide(kit, rack, 'pink', 0.6, body, () => [filterNode(ctx, 'bandpass', 420 * c.colour, 0.9)]);
  body.connect(out);
  const low = rack.add(gainNode(ctx, 0.25 * amount));
  chain(rack.loop(ctx, kit.noise('brown'), 0.7), rack.add(filterNode(ctx, 'lowpass', 180, 0.7)), low, out);

  // At high intensity the wind finds an edge to whistle across: a narrow resonance that tracks the gusts.
  let whistle: { f1: BiquadFilterNode; f2: BiquadFilterNode; g: GainNode } | null = null;
  if (variant === 2) {
    const f1 = rack.add(filterNode(ctx, 'bandpass', 900, 28));
    const f2 = rack.add(filterNode(ctx, 'bandpass', 900, 12));
    const g = rack.add(gainNode(ctx, 0));
    chain(rack.loop(ctx, kit.noise('white'), 3.1), f1, f2, g, rack.add(panNode(ctx, rng.range(-0.4, 0.4))), out);
    whistle = { f1, f2, g };
  }

  let next = 0;
  return {
    tick(now) {
      if (now < next) return;
      const gust = Math.pow(rng.next(), 1.5);
      const tc = rng.range(0.8, 1.8);
      body.gain.setTargetAtTime(base * (0.3 + 1.0 * gust), now, tc);
      low.gain.setTargetAtTime(0.25 * amount * (0.4 + gust), now, tc);
      const f = (280 + 720 * gust * (0.5 + 0.5 * amount)) * c.colour;
      for (const side of bands) side[0]?.frequency.setTargetAtTime(f * rng.range(0.92, 1.08), now, tc);
      if (whistle) {
        const wf = (700 + 900 * gust) * c.pitch;
        whistle.f1.frequency.setTargetAtTime(wf, now, tc * 0.7);
        whistle.f2.frequency.setTargetAtTime(wf, now, tc * 0.7);
        whistle.g.gain.setTargetAtTime(gust > 0.5 ? 5 * (gust - 0.5) : 0, now, tc * 0.6);
      }
      next = now + rng.range(1.2, 3.5) / c.rate;
    },
    dispose: () => rack.dispose(),
  };
}

/** Snowfall: the world goes soft. A low, close hush and the faintest high sparkle of flakes landing. */
function snowBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const base = 0.35 + 0.25 * BAND[variant];
  const hush = rack.add(gainNode(ctx, base));
  wide(kit, rack, 'pink', 0.5, hush, () => [filterNode(ctx, 'lowpass', 650 * c.colour, 0.5)]);
  hush.connect(out);
  chain(rack.loop(ctx, kit.noise('white'), 1.9), rack.add(filterNode(ctx, 'highpass', 6500, 0.5)), rack.add(gainNode(ctx, 0.02)), out);
  let next = 0;
  return {
    tick(now) {
      if (now < next) return;
      hush.gain.setTargetAtTime(base * rng.range(0.7, 1.15), now, 2);
      next = now + rng.range(3, 7);
    },
    dispose: () => rack.dispose(),
  };
}

/** Dry wind: thinner and higher than wet-country wind, with sand hissing along the ground in the gusts. */
function desertBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const amount = BAND[variant];
  const base = 0.14 + 0.3 * amount;
  const body = rack.add(gainNode(ctx, base * 0.5));
  const bands = wide(kit, rack, 'white', 0.6, body, () => [filterNode(ctx, 'bandpass', 1500 * c.colour, 0.7)]);
  body.connect(out);
  const sand = rack.add(gainNode(ctx, 0));
  chain(rack.loop(ctx, kit.noise('white'), 4.2), rack.add(filterNode(ctx, 'highpass', 5500, 0.6)), sand, out);
  const low = rack.add(gainNode(ctx, 0.12 + 0.15 * amount));
  chain(rack.loop(ctx, kit.noise('brown'), 2.2), rack.add(filterNode(ctx, 'lowpass', 150, 0.7)), low, out);
  let next = 0;
  return {
    tick(now) {
      if (now < next) return;
      const gust = Math.pow(rng.next(), 1.3);
      const tc = rng.range(0.9, 2.2);
      body.gain.setTargetAtTime(base * (0.25 + gust), now, tc);
      for (const side of bands) side[0]?.frequency.setTargetAtTime(rng.range(0.9, 1.1) * (900 + 1700 * gust) * c.colour, now, tc);
      sand.gain.setTargetAtTime((0.02 + 0.1 * amount) * gust * gust, now, tc * 0.6);
      next = now + rng.range(1.5, 4.5) / c.rate;
    },
    dispose: () => rack.dispose(),
  };
}

export function loopBed(kit: Kit, buffer: AudioBuffer, level: number, out: AudioNode, rate = 1): Bed {
  const rack = new Rack();
  chain(rack.loop(kit.ctx, buffer, kit.rng.range(0, buffer.duration * 0.9), rate), rack.add(gainNode(kit.ctx, level)), out);
  return { tick() {}, dispose: () => rack.dispose() };
}

interface Species {
  base: number;
  notes: number;
  dur: number;
  gap: number;
  /** Frequency ratio from the start to the end of each note. */
  sweep: number;
  /** Ratio applied to the pitch from one note to the next. */
  walk: number;
  fmRate: number;
  fmDepth: number;
}

/**
 * Sparse day birds: each call is one FM voice whose pitch and level are automated note by note.
 * The species are drawn from the world's seed, so each world has its own birds.
 */
function birdsBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const send = gainNode(ctx, 0.35);
  send.connect(kit.reverbIn);
  const species: Species[] = [];
  const local = makeRng(c.seed, 'bird-species');
  const kinds = Math.min(7, Math.max(3, Math.round(5 * c.density)));
  for (let i = 0; i < kinds; i++) {
    species.push({
      base: local.range(1900, 4400) * c.pitch,
      notes: local.int(2, 6),
      dur: local.range(0.05, 0.15),
      gap: local.range(0.03, 0.1),
      sweep: local.pick([0.72, 0.85, 1.2, 1.45, 1.0]),
      walk: local.pick([0.9, 1, 1, 1.08, 1.15]),
      fmRate: local.range(18, 46),
      fmDepth: local.chance(0.5) ? local.range(80, 320) : 0,
    });
  }
  const pace = ([1.6, 1, 0.6] as const)[variant] / c.rate;
  let next = -1;

  const sing = (t: number, sp: Species): void => {
    const near = rng.range(0.25, 1);
    const car = oscNode(ctx, 'sine', sp.base);
    const env = gainNode(ctx, 0);
    const pan = panNode(ctx, rng.range(-0.9, 0.9));
    chain(car, env, pan, out);
    pan.connect(send);
    const sources: AudioScheduledSourceNode[] = [car];
    const nodes: AudioNode[] = [env, pan];
    if (sp.fmDepth > 0) {
      const mod = oscNode(ctx, 'sine', sp.fmRate);
      const depth = gainNode(ctx, sp.fmDepth);
      chain(mod, depth);
      depth.connect(car.frequency);
      sources.push(mod);
      nodes.push(depth);
    }
    let at = t;
    let f = sp.base * rng.range(0.94, 1.06);
    const repeats = rng.chance(0.3) ? 2 : 1;
    env.gain.setValueAtTime(0, t);
    for (let rep = 0; rep < repeats; rep++) {
      for (let k = 0; k < sp.notes; k++) {
        const dur = sp.dur * rng.range(0.85, 1.15);
        car.frequency.setValueAtTime(f, at);
        car.frequency.exponentialRampToValueAtTime(f * sp.sweep, at + dur);
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(0.085 * near, at + Math.min(0.012, dur * 0.3));
        env.gain.linearRampToValueAtTime(0.05 * near, at + dur * 0.7);
        env.gain.linearRampToValueAtTime(0, at + dur);
        at += dur + sp.gap;
        f *= sp.walk;
      }
      f = sp.base;
      at += 0.25;
    }
    oneShot(sources, nodes, t, at + 0.05);
  };

  return {
    tick(now) {
      if (next < 0) next = now + rng.range(1, 5);
      if (now < next) return;
      // A song holds a voice for a couple of seconds; when every voice is busy the bird waits its turn.
      if (kit.voices.take(now, now + 2.5)) sing(now + 0.03, rng.pick(species));
      // Birds answer each other: a short gap sometimes, a long silence usually.
      next = now + (rng.chance(0.3) ? rng.range(0.6, 1.6) : rng.range(3, 10)) * pace;
    },
    dispose() {
      send.disconnect();
    },
  };
}

const VOWELS: readonly (readonly [number, number])[] = [[730, 1090], [530, 1840], [300, 2250], [570, 840], [320, 870], [500, 1500]];

interface Talker {
  osc: OscillatorNode;
  f1: BiquadFilterNode;
  f2: BiquadFilterNode;
  amp: GainNode;
  pitch: number;
  next: number;
  left: number;
}

/**
 * Distant voices: a few sawtooth "throats" pushed through two moving formant filters and gated
 * into syllables and phrases, then dulled and smeared so no word can ever be made out.
 * Variant 0 is heard only near NPCs; variant 1 keeps a crowd in the background.
 */
function murmurBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const floor = variant === 0 ? 0 : 0.35;
  const crowd = rack.add(gainNode(ctx, floor));
  const dull = rack.add(filterNode(ctx, 'lowpass', 1700 * c.colour, 0.5));
  chain(dull, crowd, out);
  chain(crowd, rack.add(gainNode(ctx, 0.5)), kit.reverbIn);
  // Room tone under the voices.
  chain(rack.loop(ctx, kit.noise('pink'), 3.3), rack.add(filterNode(ctx, 'bandpass', 700, 0.8)), rack.add(gainNode(ctx, 0.05)), dull);

  const talkers: Talker[] = [];
  const count = kit.quality === 0 ? 2 : variant === 2 ? 5 : c.density > 1.15 ? 4 : 3;
  for (let i = 0; i < count; i++) {
    const pitch = rng.range(95, 230) * Math.sqrt(c.pitch);
    const osc = rack.run(oscNode(ctx, 'sawtooth', pitch));
    const f1 = rack.add(filterNode(ctx, 'bandpass', 500, 5));
    const f2 = rack.add(filterNode(ctx, 'bandpass', 1500, 7));
    const amp = rack.add(gainNode(ctx, 0));
    osc.connect(f1);
    osc.connect(f2);
    f1.connect(amp);
    chain(f2, rack.add(gainNode(ctx, 0.6)), amp);
    chain(amp, rack.add(panNode(ctx, rng.range(-0.8, 0.8))), dull);
    talkers.push({ osc, f1, f2, amp, pitch, next: 0, left: 0 });
  }

  let near = -1;
  return {
    tick(now, st) {
      if (st.nearNpc !== near) {
        near = st.nearNpc;
        crowd.gain.setTargetAtTime(floor + (1 - floor) * Math.min(1, near / 5), now, 0.6);
      }
      if (floor === 0 && near <= 0) return;
      for (const v of talkers) {
        if (now < v.next) continue;
        if (v.left <= 0) {
          // A new phrase after a pause, at a new speaking level.
          v.left = rng.int(3, 9);
          v.next = now + rng.range(0.5, 3.5) / c.rate;
          continue;
        }
        v.left -= 1;
        const len = rng.range(0.11, 0.26);
        const vowel = rng.pick(VOWELS);
        v.osc.frequency.setTargetAtTime(v.pitch * rng.range(0.86, 1.22), now, 0.04);
        v.f1.frequency.setTargetAtTime(vowel[0] * rng.range(0.9, 1.1), now, 0.03);
        v.f2.frequency.setTargetAtTime(vowel[1] * rng.range(0.9, 1.1), now, 0.03);
        v.amp.gain.setTargetAtTime(rng.range(0.15, 0.3), now, 0.03);
        v.amp.gain.setTargetAtTime(0, now + len * 0.65, 0.05);
        v.next = now + len + rng.range(0.01, 0.07);
      }
    },
    dispose: () => rack.dispose(),
  };
}

/** Machinery: detuned saws beating slowly through a low-pass, air handling above it, and now and then a servo or a status ping far off. */
function humBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const send = rack.add(gainNode(ctx, 0.6));
  send.connect(kit.reverbIn);
  const lp = rack.add(filterNode(ctx, 'lowpass', 230 * c.colour, 2));
  const body = rack.add(gainNode(ctx, 0.17 + 0.06 * variant));
  chain(lp, body, out);
  for (const [f, g] of [[55, 0.5], [55.31, 0.5], [109.6, 0.22], [82.7, 0.12]] as const) {
    if (kit.quality === 0 && f === 82.7) continue;
    chain(rack.run(oscNode(ctx, 'sawtooth', f * c.pitch)), rack.add(gainNode(ctx, g)), lp);
  }
  // A very slow sweep of the cutoff keeps the tone from sitting still.
  const sweep = rack.add(gainNode(ctx, 60));
  chain(rack.run(oscNode(ctx, 'sine', 0.05 * c.rate)), sweep);
  sweep.connect(lp.frequency);
  chain(rack.loop(ctx, kit.noise('pink'), 0.4), rack.add(filterNode(ctx, 'bandpass', 320 * c.colour, 0.8)), rack.add(gainNode(ctx, 0.1)), out);

  let next = -1;
  const ping = (t: number): void => {
    const pan = panNode(ctx, rng.range(-0.8, 0.8));
    const env = gainNode(ctx, 0);
    chain(env, pan, out);
    pan.connect(send);
    if (rng.chance(0.55)) {
      const f = rng.pick([1318.5, 1568, 1760, 2093, 2637]) * c.pitch;
      const o = oscNode(ctx, 'sine', f);
      o.connect(env);
      const count = rng.int(1, 2);
      env.gain.setValueAtTime(0, t);
      for (let k = 0; k < count; k++) {
        env.gain.linearRampToValueAtTime(0.03, t + k * 0.22 + 0.004);
        env.gain.setTargetAtTime(0, t + k * 0.22 + 0.01, 0.07);
        env.gain.setValueAtTime(0, t + k * 0.22 + 0.2);
      }
      oneShot([o], [env, pan], t, t + 1.2);
    } else {
      // A servo: a pitched whirr that winds up or down and stops.
      const dur = rng.range(0.35, 0.9);
      const up = rng.chance(0.5);
      const o = oscNode(ctx, 'sawtooth', up ? 170 : 400);
      o.frequency.setValueAtTime(up ? 170 : 400, t);
      o.frequency.exponentialRampToValueAtTime(up ? 430 : 160, t + dur);
      const bp = filterNode(ctx, 'bandpass', 900, 3);
      chain(o, bp, env);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.02, t + 0.05);
      env.gain.setValueAtTime(0.02, t + dur - 0.06);
      env.gain.linearRampToValueAtTime(0, t + dur);
      oneShot([o], [bp, env, pan], t, t + dur + 0.05);
    }
  };

  return {
    tick(now) {
      if (next < 0) next = now + rng.range(3, 10);
      if (now < next) return;
      if (kit.voices.take(now, now + 1.2)) ping(now + 0.03);
      next = now + rng.range(6, 20) / c.rate;
    },
    dispose: () => rack.dispose(),
  };
}

function leavesBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const base = 0.1 + 0.08 * variant;
  const g = rack.add(gainNode(ctx, base * 0.3));
  wide(kit, rack, 'white', 0.85, g, () => [filterNode(ctx, 'highpass', 2200 * c.colour, 0.5), filterNode(ctx, 'lowpass', 7500 * Math.min(1.2, c.colour), 0.4)]);
  g.connect(out);
  let next = 0;
  return {
    tick(now) {
      if (now < next) return;
      // Leaves answer every small movement of air, so they move faster than the wind bed does.
      const stir = rng.next();
      g.gain.setTargetAtTime(base * (0.12 + stir * stir), now, rng.range(0.25, 0.6));
      next = now + rng.range(0.5, 1.8) / c.rate;
    },
    dispose: () => rack.dispose(),
  };
}

/**
 * Water at an edge: each wave swells, brightens as it breaks, and drains away in foam. Lapping at
 * a quay it is small and quick; as surf the waves are long, heavy and far apart over a low roar.
 */
function waterBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar, surf: boolean): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const size = (0.7 + 0.3 * variant) * (surf ? 1.25 : 1);
  const slow = (surf ? 1.9 : 1) / c.rate;
  const lp = rack.add(filterNode(ctx, 'lowpass', 350, 0.6));
  if (surf) chain(rack.loop(ctx, kit.noise('brown'), 1.4), rack.add(filterNode(ctx, 'lowpass', 160 * c.colour, 0.7)), rack.add(gainNode(ctx, 0.3)), out);
  const swell = rack.add(gainNode(ctx, 0.05));
  chain(rack.loop(ctx, kit.noise('pink'), 2.9), lp, swell, out);
  const foam = rack.add(gainNode(ctx, 0.003));
  chain(rack.loop(ctx, kit.noise('white'), 0.9), rack.add(filterNode(ctx, 'bandpass', 3200 * c.colour, 0.5)), foam, out);
  let next = 0;
  return {
    tick(now) {
      if (now < next) return;
      const amp = rng.range(0.5, 1) * size;
      swell.gain.setTargetAtTime(0.3 * amp, now, 0.55 * slow);
      swell.gain.setTargetAtTime(0.05, now + 1.6 * slow, 0.9 * slow);
      lp.frequency.setTargetAtTime((900 + 900 * amp) * c.colour, now, 0.5 * slow);
      lp.frequency.setTargetAtTime(330, now + 1.6 * slow, slow);
      foam.gain.setTargetAtTime((surf ? 0.11 : 0.06) * amp, now + 1.2 * slow, 0.25 * slow);
      foam.gain.setTargetAtTime(0.003, now + 1.9 * slow, 0.8 * slow);
      next = now + rng.range(3.8, 7) * slow;
    },
    dispose: () => rack.dispose(),
  };
}

function fireBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx } = kit;
  const rack = new Rack();
  chain(rack.loop(ctx, kit.buffer('fire-crackle', (sr, r) => renderFireCrackle(sr, 5.9, r)), kit.rng.range(0, 5), loopRate(c)), rack.add(gainNode(ctx, 0.8)), out);
  // The roar of the flame body, fluttering at two rates that never line up.
  const roar = rack.add(gainNode(ctx, 0.2 + 0.08 * variant));
  chain(rack.loop(ctx, kit.noise('brown'), 1.1), rack.add(filterNode(ctx, 'lowpass', 330 * c.colour, 0.7)), roar, out);
  for (const hz of [7.3, 4.1]) {
    const depth = rack.add(gainNode(ctx, 0.05));
    chain(rack.run(oscNode(ctx, 'sine', hz)), depth);
    depth.connect(roar.gain);
  }
  return { tick() {}, dispose: () => rack.dispose() };
}

const SILENT: Bed = { tick() {}, dispose() {} };

/**
 * Builds the graph for one bed and connects it to `out`. `c` is the character the bed takes in
 * this world. The three life buses have no graph of their own: the rig plays their events into `out`.
 */
export function createBed(kit: Kit, mix: BedMix, out: AudioNode, c: BedChar): Bed {
  const v = mix.variant;
  switch (mix.id) {
    case 'rain': return rainBed(kit, v, out, c);
    case 'thunder': return thunderBed(kit, v, out, c);
    case 'wind': return windBed(kit, v, out, c);
    case 'snow': return snowBed(kit, v, out, c);
    case 'desert': return desertBed(kit, v, out, c);
    case 'crickets': {
      // The insects themselves are rendered per world: how many, how they are pitched, when each rests.
      const count = Math.max(2, Math.round(([3, 6, 9] as const)[v] * c.density));
      return loopBed(kit, kit.buffer(`crickets:${v}@${c.seed}`, (sr, r) => renderCrickets(sr, 9.1, count, r)), 0.9, out, loopRate(c));
    }
    case 'frogs': {
      const count = Math.max(2, Math.round(([2, 3, 5] as const)[v] * c.density));
      return loopBed(kit, kit.buffer(`frogs:${v}@${c.seed}`, (sr, r) => renderFrogs(sr, 13.3, count, r)), 0.8, out, loopRate(c));
    }
    case 'birds': return birdsBed(kit, v, out, c);
    case 'murmur': return murmurBed(kit, v, out, c);
    case 'hum': return humBed(kit, v, out, c);
    case 'leaves': return leavesBed(kit, v, out, c);
    case 'water': return waterBed(kit, v, out, c, false);
    case 'surf': return waterBed(kit, v, out, c, true);
    case 'fire': return fireBed(kit, v, out, c);
    case 'wildlife': case 'townlife': case 'shorelife': return SILENT;
    default: return createTexture(kit, mix.id, v, out, c);
  }
}
