// The generative music bed. A plan (voice, mode, tempo, density) comes from the mood words and
// the theme; this file turns it into notes, scheduled on the audio clock two bars ahead of the
// playhead so timing never depends on the frame rate. It is deliberately sparse: whole bars rest.

import { midiHz, renderPluck, type PluckOpts } from './dsp';
import { Rack, chain, filterNode, gainNode, oneShot, oscNode, panNode, type Kit } from './kit';
import { MODES, scaleNote, type ModeName, type MusicPlan } from './mapping';
import { playBell } from './sfx';

export interface Music {
  tick(now: number): void;
  dispose(): void;
}

// Chord roots as scale steps, two bars each.
const PROGRESSIONS: Record<ModeName, readonly number[]> = {
  dorian: [0, 3, 0, 6],
  aeolian: [0, 5, 3, 6],
  mixolydian: [0, 6, 0, 3],
  lydian: [0, 1, 0, 4],
  phrygian: [0, 1, 0, 6],
  ionian: [0, 3, 4, 0],
  pentatonic: [0, 2, 0, 3],
};

const STRINGS: Record<MusicPlan['timbre'], Omit<PluckOpts, 'freq'>> = {
  guitar: { seconds: 3, brightness: 0.45, sustain: 3.2, position: 0.18 },
  lute: { seconds: 2, brightness: 0.7, sustain: 1.6, position: 0.1 },
  harp: { seconds: 3.2, brightness: 0.3, sustain: 3.8, position: 0.4 },
};

const BARS_AHEAD = 2;

export function createMusic(kit: Kit, plan: MusicPlan, out: AudioNode): Music {
  const { ctx, rng } = kit;
  const rack = new Rack();
  const bus = rack.add(gainNode(ctx, 1));
  bus.connect(out);
  chain(bus, rack.add(gainNode(ctx, 0.45)), kit.reverbIn);

  const beat = 60 / plan.bpm;
  const barDur = beat * 4;
  const len = MODES[plan.mode].length;
  const prog = PROGRESSIONS[plan.mode];
  const hz = (step: number): number => midiHz(scaleNote(plan, step));
  const chordRoot = (bar: number): number => prog[Math.floor(bar / 2) % prog.length] ?? 0;

  let melody = len + 2;
  let rests = 0;
  let nextBar = -1;
  let bar = 0;

  /** Moves the melody by a step or a skip; `snap` pulls it onto the nearest chord tone. */
  const walk = (root: number, snap: boolean): number => {
    melody += rng.pick([-2, -1, -1, 1, 1, 2]);
    if (melody < len - 1) melody += 3;
    if (melody > 2 * len + 1) melody -= 3;
    if (snap) {
      let best = melody;
      let dist = Infinity;
      for (const tone of [root, root + 2, root + 4]) {
        for (const oct of [0, len, 2 * len]) {
          const d = Math.abs(tone + oct - melody);
          if (d < dist) {
            dist = d;
            best = tone + oct;
          }
        }
      }
      melody = best;
    }
    return melody;
  };

  const pluck = (step: number, t: number, vel: number): void => {
    const midi = scaleNote(plan, step);
    const opts = STRINGS[plan.timbre];
    const buffer = kit.buffer(`pluck:${plan.timbre}:${midi}`, (sr, r) => [renderPluck(sr, { ...opts, freq: midiHz(midi) }, r)]);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = gainNode(ctx, vel * 0.42);
    const pan = panNode(ctx, rng.range(-0.3, 0.3));
    chain(src, g, pan, bus);
    oneShot([src], [g, pan], t, t + buffer.duration + 0.05);
  };

  /** Electric-piano-like FM note: one modulator at the carrier's own pitch, its index falling as the note rings. */
  const keys = (step: number, t: number, vel: number): void => {
    const f = hz(step);
    const car = oscNode(ctx, 'sine', f);
    const mod = oscNode(ctx, 'sine', f);
    const index = gainNode(ctx, 0);
    index.gain.setValueAtTime(f * (0.5 + vel * 0.9), t);
    index.gain.setTargetAtTime(f * 0.12, t, 0.28);
    chain(mod, index);
    index.connect(car.frequency);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.07, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.02, 0.95);
    const pan = panNode(ctx, rng.range(-0.35, 0.35));
    chain(car, g, pan, bus);
    oneShot([car, mod], [index, g, pan], t, t + 6);
  };

  // Drone: tonic and fifth, barely there, breathing slowly.
  if (plan.drone) {
    const lp = rack.add(filterNode(ctx, 'lowpass', 600, 0.6));
    const g = rack.add(gainNode(ctx, 0.035));
    chain(lp, g, bus);
    const low = midiHz(plan.root);
    chain(rack.run(oscNode(ctx, 'triangle', low)), lp);
    chain(rack.run(oscNode(ctx, 'triangle', low, 5)), lp);
    chain(rack.run(oscNode(ctx, 'sine', low * 1.5)), rack.add(gainNode(ctx, 0.6)), lp);
    const breath = rack.add(gainNode(ctx, 0.012));
    chain(rack.run(oscNode(ctx, 'sine', 0.07)), breath);
    breath.connect(g.gain);
  }

  // Pad: four voices of detuned saws that glide to each new chord, under a filter that never stops moving.
  const padVoices: OscillatorNode[][] = [];
  let padGain: GainNode | null = null;
  if (plan.voice === 'pad') {
    const lp = rack.add(filterNode(ctx, 'lowpass', 900, 0.8));
    const sweep = rack.add(gainNode(ctx, 450));
    chain(rack.run(oscNode(ctx, 'sine', 0.031)), sweep);
    sweep.connect(lp.frequency);
    padGain = rack.add(gainNode(ctx, 0));
    chain(lp, padGain, bus);
    for (let v = 0; v < 4; v++) {
      const pair: OscillatorNode[] = [];
      const pan = rack.add(panNode(ctx, (v - 1.5) * 0.4));
      pan.connect(lp);
      for (const cents of kit.quality === 0 ? [0] : [-7, 7]) {
        const o = rack.run(oscNode(ctx, 'sawtooth', hz(0), cents));
        o.connect(pan);
        pair.push(o);
      }
      padVoices.push(pair);
    }
  }

  // Lead: one sustained voice with vibrato, for a harmonica or a flute over the main part.
  let lead: { osc: OscillatorNode; env: GainNode } | null = null;
  if (plan.lead) {
    const reed = plan.lead === 'reed';
    const osc = rack.run(oscNode(ctx, reed ? 'sawtooth' : 'triangle', hz(2 * len)));
    const vib = rack.add(gainNode(ctx, 3));
    chain(rack.run(oscNode(ctx, 'sine', reed ? 5.6 : 4.8)), vib);
    vib.connect(osc.frequency);
    const env = rack.add(gainNode(ctx, 0));
    if (reed) {
      chain(osc, rack.add(filterNode(ctx, 'bandpass', 1300, 0.7)), rack.add(filterNode(ctx, 'lowpass', 2800, 0.7)), env);
    } else {
      chain(osc, rack.add(filterNode(ctx, 'lowpass', 2200, 0.7)), env);
      // Breath across the mouthpiece.
      chain(rack.loop(ctx, kit.noise('pink'), 1.7), rack.add(filterNode(ctx, 'bandpass', 2600, 1.5)), rack.add(gainNode(ctx, 0.35)), env);
    }
    chain(env, rack.add(panNode(ctx, 0.15)), bus);
    lead = { osc, env };
  }

  const scheduleBar = (t: number, index: number): void => {
    const root = chordRoot(index);
    const newChord = index % 2 === 0;

    if (padGain && newChord) {
      const steps = [root, root + 4, root + len + 2, root + len + (rng.chance(0.5) ? 6 : 8)];
      padVoices.forEach((pair, v) => {
        const f = hz(steps[v] ?? root);
        for (const o of pair) o.frequency.setTargetAtTime(f, t, 0.5);
      });
      padGain.gain.setTargetAtTime(0.05, t, 1.6);
      padGain.gain.setTargetAtTime(0.028, t + barDur, 2.2);
    }

    if (plan.bells && rng.chance(0.25 + 0.3 * plan.density)) {
      const tone = root + rng.pick([0, 2, 4]) + 2 * len;
      playBell(kit, bus, t + rng.int(0, 7) * (beat / 2), hz(tone), 0.028, 1.3);
    }

    if (lead && newChord && rng.chance(0.4 + 0.4 * plan.density)) {
      // A phrase of one to three long notes, then silence for the rest of the two bars.
      let at = t + rng.pick([0, 1, 2]) * beat;
      const notes = rng.int(1, 3);
      for (let k = 0; k < notes; k++) {
        const dur = rng.pick([1.5, 2, 3]) * beat;
        const step = walk(root, k === 0 || k === notes - 1) + len;
        lead.osc.frequency.setTargetAtTime(hz(Math.min(step, 3 * len)), at, 0.035);
        lead.env.gain.setTargetAtTime(0.03, at, 0.09);
        lead.env.gain.setTargetAtTime(0, at + dur * 0.8, 0.16);
        at += dur;
      }
    }

    // Whole bars of silence are part of the music; never more than two in a row.
    const restChance = Math.min(0.75, Math.max(0.1, 0.85 - plan.density * 1.2));
    if (rests < 2 && rng.chance(restChance)) {
      rests += 1;
      return;
    }
    rests = 0;

    if (plan.voice === 'pluck') {
      if (rng.chance(0.7)) pluck(root, t, 0.8);
      if (rng.chance(0.1 + 0.2 * plan.density)) {
        // A slow strum across the chord on the third beat.
        [root + len, root + len + 2, root + len + 4].forEach((s, i) => pluck(s, t + 2 * beat + i * 0.032, 0.5));
      }
      const count = 1 + Math.floor(rng.next() * plan.density * 6);
      const slots = rng.shuffle([1, 2, 3, 4, 5, 6, 7]).slice(0, Math.min(7, count)).sort((a, b) => a - b);
      slots.forEach((slot, i) => {
        const strong = slot % 2 === 0;
        pluck(walk(root, i === 0), t + slot * (beat / 2) + rng.range(-0.012, 0.012), (strong ? 0.75 : 0.55) * rng.range(0.8, 1.1));
      });
    } else if (plan.voice === 'epiano') {
      if (newChord || rng.chance(0.3)) {
        const at = t + (newChord ? 0 : 2 * beat);
        [root, root + len + 2, root + len + 4, root + len + 6].forEach((s, i) => keys(s, at + i * 0.018, i === 0 ? 0.8 : 0.55));
      }
      const count = Math.floor(rng.next() * plan.density * 4);
      for (let i = 0; i < count; i++) keys(walk(root, i === 0) + len, t + rng.int(2, 7) * (beat / 2), 0.5);
    }
  };

  return {
    tick(now) {
      // After a stall (a throttled tab) pick the grid up from here instead of replaying the gap.
      if (nextBar < now - 0.05) nextBar = now + 0.4;
      while (nextBar < now + BARS_AHEAD * barDur) {
        scheduleBar(nextBar, bar);
        bar += 1;
        nextBar += barDur;
      }
    },
    dispose: () => rack.dispose(),
  };
}
