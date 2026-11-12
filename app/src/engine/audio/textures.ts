// The beds beyond weather and the common animals: brooks, caves, deep water, air handling, mains
// buzz, a far road, a temple drone, cicadas, jungle, ice and lava. Most are a few noise layers
// whose levels and colours drift on their own slow clocks; each takes its character from the world.

import type { NoiseColor } from './dsp';
import { loopBed, type Bed } from './beds';
import { Rack, chain, filterNode, gainNode, oscNode, panNode, type Kit } from './kit';
import { renderBabble, renderCicadas, renderFireCrackle } from './loops';
import type { BedChar } from './mapping';
import type { BedId } from './vocab';

interface Layer {
  color: NoiseColor;
  type: BiquadFilterType;
  f: number;
  q: number;
  gain: number;
  pan?: number;
  /** 0..1: how far the level wanders from its rest value. */
  move?: number;
  /** Octaves the filter drifts either way. */
  drift?: number;
}

interface Recipe {
  layers: readonly Layer[];
  /** Seconds between changes of direction, shortest and longest. */
  every: readonly [number, number];
}

const RECIPES: Partial<Record<BedId, Recipe>> = {
  stream: {
    every: [0.8, 2.2],
    layers: [
      { color: 'pink', type: 'bandpass', f: 1100, q: 0.6, gain: 0.22, pan: -0.3, move: 0.2, drift: 0.15 },
      { color: 'white', type: 'bandpass', f: 3600, q: 0.7, gain: 0.05, pan: 0.3, move: 0.3, drift: 0.1 },
    ],
  },
  cave: {
    every: [3, 7],
    layers: [
      { color: 'brown', type: 'lowpass', f: 140, q: 0.7, gain: 0.5, move: 0.3 },
      // Air moving through a hollow: a narrow, breathing resonance.
      { color: 'pink', type: 'bandpass', f: 240, q: 6, gain: 0.12, pan: 0.2, move: 0.6, drift: 0.3 },
    ],
  },
  underwater: {
    every: [2.5, 6],
    layers: [
      { color: 'brown', type: 'lowpass', f: 220, q: 0.7, gain: 0.7, move: 0.25 },
      { color: 'pink', type: 'bandpass', f: 520, q: 2, gain: 0.1, pan: -0.4, move: 0.6, drift: 0.4 },
      { color: 'pink', type: 'lowpass', f: 900, q: 0.5, gain: 0.05, pan: 0.4, move: 0.3 },
    ],
  },
  vent: {
    every: [3, 8],
    layers: [
      { color: 'pink', type: 'bandpass', f: 700, q: 0.8, gain: 0.22, pan: -0.25, move: 0.15, drift: 0.08 },
      { color: 'white', type: 'highpass', f: 4200, q: 0.5, gain: 0.012, pan: 0.3, move: 0.3 },
      { color: 'brown', type: 'lowpass', f: 120, q: 0.7, gain: 0.2 },
    ],
  },
  traffic: {
    every: [2, 5],
    layers: [
      { color: 'brown', type: 'lowpass', f: 260, q: 0.7, gain: 0.5, pan: -0.4, move: 0.3 },
      { color: 'pink', type: 'bandpass', f: 750, q: 0.5, gain: 0.12, pan: 0.4, move: 0.5, drift: 0.25 },
    ],
  },
  ice: {
    every: [3, 7],
    layers: [
      { color: 'pink', type: 'lowpass', f: 500, q: 0.5, gain: 0.15, move: 0.4 },
      { color: 'white', type: 'highpass', f: 7000, q: 0.5, gain: 0.01 },
    ],
  },
  lava: {
    every: [2, 5],
    layers: [
      { color: 'brown', type: 'lowpass', f: 110, q: 0.7, gain: 0.7, move: 0.3 },
      { color: 'pink', type: 'bandpass', f: 300, q: 1.5, gain: 0.1, move: 0.6, drift: 0.3 },
    ],
  },
  jungle: {
    every: [1.5, 4],
    layers: [
      // The whine of insects that never stops, and the canopy above it.
      { color: 'white', type: 'bandpass', f: 5200, q: 2.5, gain: 0.03, pan: -0.5, move: 0.5, drift: 0.1 },
      { color: 'pink', type: 'bandpass', f: 2400, q: 0.6, gain: 0.04, pan: 0.5, move: 0.5, drift: 0.15 },
    ],
  },
};

function noiseTexture(kit: Kit, id: BedId, recipe: Recipe, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const amount = 0.8 + 0.2 * variant;
  const parts = recipe.layers.map((layer, i) => {
    const filter = rack.add(filterNode(ctx, layer.type, layer.f * c.colour, layer.q));
    const gain = rack.add(gainNode(ctx, layer.gain * amount));
    chain(rack.loop(ctx, kit.noise(layer.color), rng.range(0, 5) + i * 0.37), filter, gain, rack.add(panNode(ctx, layer.pan ?? 0)), out);
    return { layer, filter, gain };
  });
  // The textures that have a grain of their own on top of the noise.
  if (id === 'stream') {
    const per = Math.round(([70, 110, 160] as const)[variant] * c.density);
    chain(rack.loop(ctx, kit.buffer(`babble:${variant}@${c.seed}`, (sr, r) => renderBabble(sr, 7.7, per, r)), rng.range(0, 7)), rack.add(gainNode(ctx, 0.8)), out);
  } else if (id === 'lava') {
    // Slowed right down, burning wood becomes thick rock bubbling.
    chain(rack.loop(ctx, kit.buffer('fire-crackle', (sr, r) => renderFireCrackle(sr, 5.9, r)), rng.range(0, 5), 0.5 * Math.min(1.2, c.pitch)), rack.add(gainNode(ctx, 0.6)), out);
  } else if (id === 'jungle') {
    const count = Math.max(1, Math.round(2 * c.density));
    chain(rack.loop(ctx, kit.buffer(`cicadas:jungle@${c.seed}`, (sr, r) => renderCicadas(sr, 11.3, count, r)), rng.range(0, 9), Math.min(1.2, Math.max(0.8, c.pitch))), rack.add(gainNode(ctx, 0.35)), out);
  }
  let next = 0;
  return {
    tick(now) {
      if (now < next) return;
      const tc = rng.range(0.6, 1.6) / c.rate;
      for (const p of parts) {
        const move = p.layer.move ?? 0;
        if (move > 0) p.gain.gain.setTargetAtTime(p.layer.gain * amount * (1 - move + 2 * move * rng.next()), now, tc);
        const drift = p.layer.drift ?? 0;
        if (drift > 0) p.filter.frequency.setTargetAtTime(p.layer.f * c.colour * Math.pow(2, rng.range(-drift, drift)), now, tc);
      }
      next = now + rng.range(recipe.every[0], recipe.every[1]) / c.rate;
    },
    dispose: () => rack.dispose(),
  };
}

/** Mains buzz: the thin rasp of a transformer or a tube sign over its low hum, stuttering now and then. */
function buzzBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx, rng } = kit;
  const rack = new Rack();
  // Half the worlds run on 50 hertz mains and half on 60.
  const mains = c.pitch > 1 ? 60 : 50;
  const level = 0.8 + 0.25 * variant;
  const rasp = rack.add(gainNode(ctx, 0.035 * level));
  chain(rack.run(oscNode(ctx, 'sawtooth', mains * 2)), rack.add(filterNode(ctx, 'bandpass', 2400 * c.colour, 1.2)), rasp, rack.add(panNode(ctx, -0.3)), out);
  const fizz = rack.add(gainNode(ctx, 0.012 * level));
  if (kit.quality > 0) {
    chain(rack.run(oscNode(ctx, 'sawtooth', mains * 2 + 0.3)), rack.add(filterNode(ctx, 'bandpass', 5200 * c.colour, 3)), fizz, rack.add(panNode(ctx, 0.4)), out);
  }
  chain(rack.run(oscNode(ctx, 'sine', mains * 2)), rack.add(gainNode(ctx, 0.03 * level)), out);
  let next = -1;
  return {
    tick(now) {
      if (next < 0) next = now + rng.range(2, 9) / c.rate;
      if (now < next) return;
      // The tube drops out for a blink and catches again.
      const blinks = rng.int(1, 3);
      let at = now;
      for (let b = 0; b < blinks; b++) {
        const len = rng.range(0.04, 0.18);
        for (const [g, base] of [[rasp, 0.035], [fizz, 0.012]] as const) {
          g.gain.setTargetAtTime(base * level * 0.15, at, 0.008);
          g.gain.setTargetAtTime(base * level, at + len, 0.015);
        }
        at += len + rng.range(0.05, 0.3);
      }
      next = now + rng.range(3, 12) / c.rate;
    },
    dispose: () => rack.dispose(),
  };
}

/** A held chord in a stone room: a tonic, its fifth and octave, two of them a hair apart so the sound slowly beats. */
function droneBed(kit: Kit, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  const { ctx } = kit;
  const rack = new Rack();
  const root = 98 * c.pitch;
  const lp = rack.add(filterNode(ctx, 'lowpass', 520 * c.colour, 0.6));
  const body = rack.add(gainNode(ctx, 0.08 + 0.02 * variant));
  chain(lp, body, out);
  chain(body, rack.add(gainNode(ctx, 0.5)), kit.reverbIn);
  const voices: readonly (readonly [OscillatorType, number, number, number])[] = [
    ['sine', 1, 0, 0.5], ['sine', 1.004, 0, 0.4], ['sine', 1.5, 3, 0.25], ['triangle', 2, -4, 0.12],
  ];
  for (const [type, ratio, cents, gain] of voices) {
    if (kit.quality === 0 && ratio === 2) continue;
    chain(rack.run(oscNode(ctx, type, root * ratio, cents)), rack.add(gainNode(ctx, gain)), lp);
  }
  const breath = rack.add(gainNode(ctx, 0.03));
  chain(rack.run(oscNode(ctx, 'sine', 0.05 * c.rate)), breath);
  breath.connect(body.gain);
  return { tick() {}, dispose: () => rack.dispose() };
}

/** Builds one of the beds this file owns; an id it does not know gets a faint neutral air rather than nothing. */
export function createTexture(kit: Kit, id: BedId, variant: 0 | 1 | 2, out: AudioNode, c: BedChar): Bed {
  if (id === 'buzz') return buzzBed(kit, variant, out, c);
  if (id === 'drone') return droneBed(kit, variant, out, c);
  if (id === 'cicadas') {
    const count = Math.max(1, Math.round(([2, 4, 6] as const)[variant] * c.density));
    const rate = Math.min(1.2, Math.max(0.8, c.pitch));
    return loopBed(kit, kit.buffer(`cicadas:${variant}@${c.seed}`, (sr, r) => renderCicadas(sr, 11.3, count, r)), 0.9, out, rate);
  }
  const recipe = RECIPES[id] ?? { every: [3, 7] as const, layers: [{ color: 'pink' as const, type: 'lowpass' as const, f: 600, q: 0.5, gain: 0.08, move: 0.3 }] };
  return noiseTexture(kit, id, recipe, variant, out, c);
}
