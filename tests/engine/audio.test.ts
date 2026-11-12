import { describe, expect, it } from 'vitest';
import { createAudio } from '../../app/src/engine/audio';
import { fillNoise, peak, renderImpulse, renderPluck, rms } from '../../app/src/engine/audio/dsp';
import { STEP_FAMILIES, renderCrickets, renderRainPatter, renderStep } from '../../app/src/engine/audio/loops';
import {
  RUN_STEP_HZ, StepClock, WALK_STEP_HZ, bedsForWord, dayPhase, indoorStepFamily, musicPlan, roomFor,
  sceneMix, scaleNote, stepFamily, stepRate,
} from '../../app/src/engine/audio/mapping';
import { EVENTS, EVENT_KINDS } from '../../app/src/engine/audio/events';
import type { WorldSound } from '../../app/src/engine/audio/identity';
import { createKit } from '../../app/src/engine/audio/kit';
import { VOCABULARY } from '../../app/src/engine/audio/vocab';
import { playEvent } from '../../app/src/engine/audio/voices';
import { makeRng } from '../../app/src/world/rng';
import type { MoodSpec } from '../../app/src/world/spec';

interface ParamEvent {
  kind: string;
  value: number;
  time: number;
  duration: number;
  last: number;
}

class FakeParam {
  value = 0;
  events: ParamEvent[] = [];
  private push(kind: string, value: number, time: number, duration = 0, last = value): this {
    this.events.push({ kind, value, time, duration, last });
    return this;
  }
  setValueAtTime(v: number, t: number): this { return this.push('set', v, t); }
  linearRampToValueAtTime(v: number, t: number): this { return this.push('linear', v, t); }
  exponentialRampToValueAtTime(v: number, t: number): this { return this.push('exp', v, t); }
  setTargetAtTime(v: number, t: number, tc: number): this { return this.push('target', v, t, tc); }
  setValueCurveAtTime(curve: number[], t: number, d: number): this {
    return this.push('curve', curve[0] ?? 0, t, d, curve[curve.length - 1] ?? 0);
  }
  cancelScheduledValues(t: number): this { return this.push('cancel', 0, t); }
}

class FakeNode {
  [key: string]: unknown;
  connections = 0;
  started: number | null = null;
  stopped: number | null = null;
  constructor(readonly kind: string, params: string[]) {
    for (const p of params) this[p] = new FakeParam();
  }
  connect(target: unknown): unknown { this.connections += 1; return target; }
  disconnect(): void { this.connections = 0; }
  start(when = 0): void { this.started = when; }
  stop(when = 0): void { this.stopped = when; }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 12000;
  state = 'running';
  closed = false;
  nodes: FakeNode[] = [];
  destination = new FakeNode('destination', []);
  private make(kind: string, params: string[]): FakeNode {
    const n = new FakeNode(kind, params);
    this.nodes.push(n);
    return n;
  }
  createGain(): FakeNode { const n = this.make('gain', ['gain']); (n.gain as FakeParam).value = 1; return n; }
  createBiquadFilter(): FakeNode { return this.make('filter', ['frequency', 'Q', 'gain', 'detune']); }
  createOscillator(): FakeNode { return this.make('osc', ['frequency', 'detune']); }
  createBufferSource(): FakeNode { return this.make('source', ['playbackRate', 'detune']); }
  createStereoPanner(): FakeNode { return this.make('pan', ['pan']); }
  createConvolver(): FakeNode { return this.make('convolver', []); }
  createDynamicsCompressor(): FakeNode { return this.make('compressor', ['threshold', 'knee', 'ratio', 'attack', 'release']); }
  createWaveShaper(): FakeNode { return this.make('shaper', []); }
  createBuffer(channels: number, length: number, sampleRate: number): unknown {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] };
  }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { this.closed = true; return Promise.resolve(); }

  params(kind: string, name: string): FakeParam[] {
    return this.nodes.filter((n) => n.kind === kind).map((n) => n[name] as FakeParam);
  }
  /** Gain fades (equal-power curves) that begin at `time`. */
  fades(time: number): ParamEvent[] {
    return this.params('gain', 'gain').flatMap((p) => p.events).filter((e) => e.kind === 'curve' && Math.abs(e.time - time) < 1e-6);
  }
  /** Started one-shot buffer sources shorter than `maxSeconds`. */
  shots(maxSeconds: number): FakeNode[] {
    return this.nodes.filter((n) => {
      const buf = n.buffer as { duration: number } | undefined;
      return n.kind === 'source' && n.started !== null && n.loop !== true && buf !== undefined && buf.duration < maxSeconds;
    });
  }
}

function rigWith(fake: FakeContext): ReturnType<typeof createAudio> {
  return createAudio(() => fake as unknown as AudioContext);
}

const mood = (over: Partial<MoodSpec>): MoodSpec => ({ weather: 'clear', intensity: 0.5, grade: 'neutral', haze: 0.2, ambience: [], music: '', ...over });
const idle = { speed: 0, running: false, hour: 12 };

function run(rig: ReturnType<typeof createAudio>, fake: FakeContext, seconds: number, s: Parameters<ReturnType<typeof createAudio>['update']>[1]): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    fake.currentTime += dt;
    rig.update(dt, s);
  }
}

describe('audio rig without a context', () => {
  const exercise = (rig: ReturnType<typeof createAudio>): void => {
    rig.setScene({ theme: 'western', hour: 9 });
    rig.unlock();
    rig.setScene({ theme: 'scifi', hour: 22, mood: mood({ weather: 'storm', ambience: ['machine hum'], music: 'low drone' }), groundKind: 'hull_plate', sitePattern: 'grid' });
    rig.update(0.016, { speed: 3, running: true, hour: 22, indoors: true, nearNpcCount: 3 });
    rig.footstep();
    for (const k of ['open', 'close', 'confirm', 'quest', 'error', 'reveal'] as const) rig.ui(k);
    rig.voiceBlip(1.1);
    rig.setMuted(true);
    rig.setVolume(0.4);
    rig.dispose();
    rig.update(0.016, idle);
    rig.unlock();
  };

  it('is silent and safe when no AudioContext exists', () => {
    expect(() => exercise(createAudio())).not.toThrow();
    expect(() => exercise(createAudio(() => null))).not.toThrow();
    expect(() => exercise(createAudio(() => { throw new Error('blocked'); }))).not.toThrow();
  });

  it('does not create a context before unlock', () => {
    let made = 0;
    const fake = new FakeContext();
    const rig = createAudio(() => { made += 1; return fake as unknown as AudioContext; });
    rig.setScene({ theme: 'medieval', hour: 10 });
    rig.update(0.016, { speed: 2, running: false, hour: 10 });
    rig.footstep();
    rig.ui('open');
    expect(made).toBe(0);
    expect(fake.nodes.length).toBe(0);
    rig.unlock();
    rig.unlock();
    expect(made).toBe(1);
    // The scene set before unlock is applied once the context exists.
    expect(fake.fades(0).some((e) => e.last > 0)).toBe(true);
  });

  it('goes quiet instead of throwing when the graph fails mid-flight', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'western', hour: 12 });
    (fake as unknown as { createBufferSource: () => never }).createBufferSource = () => { throw new Error('gone'); };
    expect(() => { rig.footstep(); rig.update(0.016, idle); rig.ui('quest'); }).not.toThrow();
  });
});

describe('scene changes', () => {
  it('crossfades beds over two seconds and tears the old ones down', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'modern', hour: 12, mood: mood({ weather: 'rain', intensity: 0.9, ambience: ['rain'] }) });
    const loops = fake.nodes.filter((n) => n.kind === 'source' && n.loop === true);
    expect(loops.length).toBeGreaterThanOrEqual(5); // hiss L/R, wash, patter, drum
    const first = fake.fades(0);
    expect(first.every((e) => e.duration === 2)).toBe(true);
    expect(first.filter((e) => e.value === 0 && e.last > 0).length).toBeGreaterThanOrEqual(2);

    run(rig, fake, 5, idle);
    const t = fake.currentTime;
    rig.setScene({ theme: 'western', hour: 12, mood: mood({ weather: 'dust', intensity: 0.6, ambience: ['dry wind'] }) });
    const cross = fake.fades(t);
    expect(cross.some((e) => e.value > 0 && e.last === 0)).toBe(true); // rain out
    expect(cross.some((e) => e.value === 0 && e.last > 0)).toBe(true); // desert in
    expect(cross.every((e) => e.duration === 2)).toBe(true);
    expect(loops.every((n) => n.stopped === null)).toBe(true);
    run(rig, fake, 2.5, idle);
    // The two scenes share no bed, so every loop of the first has been stopped.
    expect(loops.filter((n) => n.stopped !== null).length).toBe(loops.length);
  });

  it('leaves the mix alone when the same scene is set again', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    const scene = { theme: 'scifi' as const, hour: 12, mood: mood({ weather: 'rain', ambience: ['rain', 'machine hum'], music: 'slow pad' }) };
    rig.setScene(scene);
    run(rig, fake, 3, idle);
    const before = fake.nodes.length;
    const t = fake.currentTime;
    rig.setScene({ ...scene });
    expect(fake.fades(t).length).toBe(0);
    expect(fake.nodes.length).toBe(before);
  });

  it('swaps birds for crickets when the hour crosses into night', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'medieval', hour: 12 });
    run(rig, fake, 1, { ...idle, hour: 12 });
    const t0 = fake.currentTime;
    run(rig, fake, 0.1, { ...idle, hour: 22 });
    const fades = fake.params('gain', 'gain').flatMap((p) => p.events).filter((e) => e.kind === 'curve' && e.time > t0);
    expect(fades.some((e) => e.last === 0 && e.value > 0)).toBe(true);
    expect(fades.some((e) => e.value === 0 && e.last > 0)).toBe(true);
  });

  it('schedules music ahead on the audio clock and none when the mood asks for silence', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'western', hour: 12, mood: mood({ music: '' }) });
    run(rig, fake, 20, idle);
    expect(fake.shots(10).length).toBe(0);
    rig.setScene({ theme: 'western', hour: 12, mood: mood({ music: 'busy bright guitar' }) });
    run(rig, fake, 8, idle);
    const plucks = fake.shots(10);
    expect(plucks.length).toBeGreaterThan(5);
    expect(plucks.some((n) => (n.started ?? 0) > fake.currentTime + 1)).toBe(true);
  });

  it('plays music in phrases with long silences between them', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'western', hour: 12, mood: mood({ music: 'bright guitar' }) });
    run(rig, fake, 180, idle);
    const starts = fake.shots(10).map((n) => n.started ?? 0).sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThan(20);
    const bar = 240 / (musicPlan(mood({ music: 'bright guitar' }), 'western')?.bpm ?? 60);
    let longest = 0;
    for (let i = 1; i < starts.length; i++) longest = Math.max(longest, (starts[i] ?? 0) - (starts[i - 1] ?? 0));
    // At least one silence of three whole bars, and the music comes back after it.
    expect(longest).toBeGreaterThan(bar * 3);
    expect(starts[starts.length - 1] ?? 0).toBeGreaterThan(120);
  });

  it('ducks the music under speech and lets it back up', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'western', hour: 12 });
    run(rig, fake, 1, idle);
    const t = fake.currentTime;
    rig.voiceBlip(1);
    const targets = (): ParamEvent[] => fake.params('gain', 'gain').flatMap((p) => p.events).filter((e) => e.kind === 'target' && e.time >= t);
    expect(targets().some((e) => e.time === t && e.duration === 0.04 && e.value < 0.6)).toBe(true);
    run(rig, fake, 1, idle);
    expect(targets().some((e) => e.duration === 0.5 && e.value === 1)).toBe(true);
  });

  it('closes the context on dispose', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'scifi', hour: 2 });
    run(rig, fake, 1, idle);
    rig.dispose();
    expect(fake.closed).toBe(true);
    const count = fake.nodes.length;
    rig.footstep();
    rig.update(0.016, idle);
    expect(fake.nodes.length).toBe(count);
  });
});

describe('beds, events and the world they belong to', () => {
  const world = (seed: number, text = 'a harbour town with a forge and a market'): WorldSound =>
    ({ seed, text, creatures: [{ name: 'herring gulls', family: 'bird', count: 6 }], people: 6, settled: 0.7, water: 'shore', waterAmount: 0.3 });
  const allEvents = (fake: FakeContext): ParamEvent[] =>
    fake.nodes.flatMap((n) => Object.values(n).filter((v): v is FakeParam => v instanceof FakeParam)).flatMap((p) => p.events);

  it('builds every bed in the vocabulary and runs it without a bad number', () => {
    for (const quality of [0, 2] as const) {
      const fake = new FakeContext();
      const rig = createAudio(() => fake as unknown as AudioContext, { quality });
      rig.unlock();
      for (const { word } of VOCABULARY) {
        rig.setScene({ theme: 'medieval', hour: 13, mood: mood({ ambience: [word] }), world: world(11) });
        run(rig, fake, 4, idle);
      }
      rig.setScene({ theme: 'scifi', hour: 23, mood: mood({ ambience: ['qwerty'] }), world: world(12, 'a reef city of coral') });
      run(rig, fake, 4, idle);
      for (const e of allEvents(fake)) {
        expect(Number.isFinite(e.value) && Number.isFinite(e.time) && Number.isFinite(e.last)).toBe(true);
        expect(e.time).toBeGreaterThanOrEqual(0);
      }
      // Beds left behind are torn down: most of what ever looped has been stopped.
      const loops = fake.nodes.filter((n) => n.kind === 'source' && n.loop === true && n.started !== null);
      expect(loops.filter((n) => n.stopped !== null).length).toBeGreaterThan(loops.length * 0.6);
      rig.dispose();
    }
  });

  it('plays every kind of event as a short graph that ramps in, ends on time and stays quiet', () => {
    for (const kind of EVENT_KINDS) {
      const fake = new FakeContext();
      const kit = createKit(fake as unknown as AudioContext, 2, 5);
      const out = fake.createGain();
      const at = 10;
      for (const far of [0, 1]) {
        playEvent(kit, out as unknown as AudioNode, { source: 1, kind, at, pitch: 1.1, level: 1, pan: -0.4, far, seconds: EVENTS[kind].seconds }, 0.9);
      }
      const sources = fake.nodes.filter((n) => n.started !== null);
      expect(sources.length, kind).toBeGreaterThan(0);
      for (const n of sources) {
        expect(n.started ?? 0, kind).toBeGreaterThan(at);
        expect(n.stopped ?? Infinity, kind).toBeLessThanOrEqual(at + EVENTS[kind].seconds + 0.06);
        expect(n.stopped ?? 0, kind).toBeGreaterThan(n.started ?? 0);
      }
      // Envelope gains start from silence and never ask for more than a modest level.
      const envelopes = fake.params('gain', 'gain').filter((p) => p.events.some((e) => e.kind === 'linear'));
      expect(envelopes.length, kind).toBeGreaterThan(0);
      for (const p of envelopes) {
        expect(p.events[0]?.kind, kind).toBe('set');
        expect(p.events[0]?.value, kind).toBe(0);
        for (const e of p.events) expect(Math.abs(e.value), kind).toBeLessThanOrEqual(0.3);
      }
      for (const p of fake.params('osc', 'frequency')) for (const e of p.events) expect(e.value, kind).toBeGreaterThan(0);
    }
  });

  it('sounds one-shot events over the beds as time passes, and stops them with the scene', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'medieval', hour: 13, mood: mood({ ambience: ['market', 'forge', 'gulls'] }), world: world(21) });
    run(rig, fake, 10, idle);
    const early = fake.nodes.filter((n) => n.kind === 'pan').length;
    run(rig, fake, 240, { ...idle, hour: 13 });
    const pans = fake.nodes.filter((n) => n.kind === 'pan').length - early;
    // Four minutes of a busy harbour: a few dozen events, not hundreds.
    expect(pans).toBeGreaterThan(15);
    expect(pans).toBeLessThan(160);
    const shots = fake.nodes.filter((n) => n.kind === 'osc' && (n.started ?? 0) > 10 && n.stopped !== null);
    expect(shots.length).toBeGreaterThan(15);
    for (const n of shots) expect((n.stopped ?? 0) - (n.started ?? 0)).toBeLessThan(15);
    rig.dispose();
    const count = fake.nodes.length;
    fake.currentTime += 60;
    rig.update(0.016, idle);
    expect(fake.nodes.length).toBe(count);
  });

  it('builds a different graph for a different seed and the same graph for the same one', () => {
    const colours = (seed: number): number[] => {
      const fake = new FakeContext();
      const rig = rigWith(fake);
      rig.unlock();
      rig.setScene({ theme: 'medieval', hour: 13, mood: mood({ ambience: ['wind', 'stream', 'machinery', 'vents'] }), world: world(seed) });
      return fake.params('filter', 'frequency').map((p) => p.value);
    };
    const a = colours(1);
    const b = colours(2);
    expect(a).toEqual(colours(1));
    expect(a.length).toBe(b.length);
    const moved = a.filter((f, i) => Math.abs(Math.log2(f / (b[i] ?? f))) > 0.04).length;
    expect(moved).toBeGreaterThan(a.length * 0.5);
  });

  it('rebuilds the beds for a new world and follows the player to the water', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    const scene = { theme: 'medieval' as const, hour: 13, mood: mood({ ambience: ['stream', 'crowd'] }) };
    const here = { ...idle, hour: 13, place: { water: 1, settled: 1, high: 0 } };
    rig.setScene({ ...scene, world: world(1) });
    run(rig, fake, 3, here);
    const t = fake.currentTime;
    rig.setScene({ ...scene, world: world(2) });
    expect(fake.fades(t).some((e) => e.value > 0 && e.last === 0)).toBe(true);
    expect(fake.fades(t).some((e) => e.value === 0 && e.last > 0)).toBe(true);
    run(rig, fake, 4, here);
    const before = fake.currentTime;
    run(rig, fake, 2, { ...idle, hour: 13, place: { water: 0, settled: 0, high: 0 } });
    const moves = fake.params('gain', 'gain').flatMap((p) => p.events).filter((e) => e.kind === 'target' && e.time > before && e.duration === 0.8);
    // Away from the water and the town, the stream and the voices drop back; both glide rather than jump.
    expect(moves.some((e) => Math.abs(e.value - 0.2) < 1e-9)).toBe(true);
    expect(moves.some((e) => Math.abs(e.value - 0.45) < 1e-9)).toBe(true);
  });
});

describe('background and voice volume', () => {
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 1e-9;
  const gains = (fake: FakeContext): FakeParam[] => fake.params('gain', 'gain');
  const lastTarget = (fake: FakeContext, v: number): boolean =>
    gains(fake).some((p) => p.events.some((e) => e.kind === 'target' && near(e.value, v)));

  it('remembers levels set before unlock and builds the buses with them', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.setBackgroundVolume(0.5);
    rig.setVoiceVolume(0.25);
    expect(fake.nodes.length).toBe(0);
    rig.unlock();
    const initial = gains(fake).map((p) => p.value);
    expect(initial.some((v) => near(v, 0.8 * 0.5))).toBe(true);
    expect(initial.some((v) => near(v, 0.3 * 0.5))).toBe(true);
    expect(initial.some((v) => near(v, 0.25))).toBe(true);
  });

  it('keeps the background multiplier through scene and indoor changes', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'western', hour: 12, mood: mood({ music: 'bright guitar' }) });
    rig.setBackgroundVolume(0.5);
    rig.setVoiceVolume(0.25);
    expect(lastTarget(fake, 0.4)).toBe(true);
    expect(lastTarget(fake, 0.15)).toBe(true);
    expect(lastTarget(fake, 0.25)).toBe(true);
    run(rig, fake, 3, idle);
    rig.setScene({ theme: 'scifi', hour: 12, mood: mood({ weather: 'rain', ambience: ['rain'], music: 'slow pad' }) });
    run(rig, fake, 3, idle);
    // The buses are only ever re-targeted by the user's level; crossfades run on per-bed faders.
    expect(lastTarget(fake, 0.8)).toBe(false);
    expect(lastTarget(fake, 0.3)).toBe(false);
    run(rig, fake, 1, { ...idle, indoors: true });
    expect(lastTarget(fake, 0.8 * 0.5 * 0.7)).toBe(true);
    rig.setBackgroundVolume(1);
    run(rig, fake, 1, { ...idle, indoors: true });
    expect(lastTarget(fake, 0.8 * 0.7)).toBe(true);
  });
});

describe('footsteps', () => {
  it('falls at walking and running cadence', () => {
    const count = (speed: number, running: boolean): number => {
      const clock = new StepClock();
      let n = 0;
      for (let i = 0; i < 600; i++) n += clock.advance(1 / 60, speed, running);
      return n;
    };
    expect(stepRate(2.2, false)).toBeCloseTo(WALK_STEP_HZ, 5);
    expect(stepRate(5, true)).toBeCloseTo(RUN_STEP_HZ, 5);
    expect(stepRate(0.1, false)).toBe(0);
    expect(Math.abs(count(2.2, false) - 19)).toBeLessThanOrEqual(1);
    expect(Math.abs(count(5, true) - 29)).toBeLessThanOrEqual(1);
    expect(count(0, false)).toBe(0);
  });

  it('is triggered by update from speed alone, alternating feet', () => {
    const fake = new FakeContext();
    const rig = rigWith(fake);
    rig.unlock();
    rig.setScene({ theme: 'western', hour: 12, mood: mood({ music: '' }), groundKind: 'gravel' });
    run(rig, fake, 10, { speed: 2.2, running: false, hour: 12 });
    const steps = fake.shots(0.6);
    expect(Math.abs(steps.length - 19)).toBeLessThanOrEqual(1);
    run(rig, fake, 3, idle);
    expect(fake.shots(0.6).length).toBe(steps.length);
  });

  it('maps every surface to a family and renders each one', () => {
    expect(stepFamily('dirt', 'modern')).toBe('soft');
    expect(stepFamily('grass', 'modern')).toBe('soft');
    expect(stepFamily('gravel', 'modern')).toBe('grit');
    expect(stepFamily('sand', 'modern')).toBe('grit');
    expect(stepFamily('snow', 'modern')).toBe('snow');
    expect(stepFamily('planks', 'modern')).toBe('wood');
    expect(stepFamily('stone', 'western')).toBe('hard');
    expect(stepFamily('asphalt', 'western')).toBe('hard');
    expect(stepFamily('hull_plate', 'western')).toBe('metal');
    expect(stepFamily(undefined, 'scifi')).toBe('metal');
    expect(stepFamily(undefined, 'western')).toBe('soft');
    expect(indoorStepFamily('medieval')).toBe('wood');
    const centroid = (d: Float32Array): number => {
      // Mean absolute first difference over mean absolute value: a cheap brightness measure.
      let diff = 0, abs = 0;
      for (let i = 1; i < d.length; i++) { diff += Math.abs((d[i] ?? 0) - (d[i - 1] ?? 0)); abs += Math.abs(d[i] ?? 0); }
      return diff / abs;
    };
    const bright: Record<string, number> = {};
    for (const family of STEP_FAMILIES) {
      const d = renderStep(family, 44100, makeRng(7, family));
      expect(d.every((v) => Number.isFinite(v))).toBe(true);
      expect(peak(d)).toBeCloseTo(0.8, 3);
      expect(Math.abs(d[d.length - 1] ?? 1)).toBeLessThan(0.01);
      bright[family] = centroid(d);
    }
    // A thud on earth is far duller than gravel crunching or a boot on stone.
    expect(bright.soft).toBeLessThan((bright.grit ?? 0) * 0.5);
    expect(bright.soft).toBeLessThan((bright.hard ?? 0) * 0.5);
    expect(bright.wood).toBeLessThan(bright.metal ?? 0);
  });
});

describe('scene mapping', () => {
  // The textured beds; the three life buses that carry one-shot events are checked separately.
  const ids = (m: ReturnType<typeof sceneMix>): string[] => m.filter((b) => !b.events).map((b) => b.id).sort();
  const kinds = (m: ReturnType<typeof sceneMix>): string[] => m.flatMap((b) => b.events ?? []).map((e) => e.kind).sort();

  it('maps free ambience words to beds', () => {
    expect(bedsForWord('distant_crowd')).toEqual(['murmur']);
    expect(bedsForWord('Night insects')).toEqual(['crickets']);
    expect(bedsForWord('rainfall')).toContain('rain');
    expect(bedsForWord('train')).not.toContain('rain');
    expect(bedsForWord('season')).not.toContain('water');
    expect(bedsForWord('lapping water')).toEqual(['water']);
    expect(bedsForWord('breaking waves')).toEqual(['surf']);
    expect(bedsForWord('crowd')).not.toContain('wildlife');
    expect(bedsForWord('campfire')).toEqual(['fire']);
    expect(bedsForWord('machine hum')).toEqual(['hum']);
    expect(bedsForWord('howling wind')).toEqual(['wind']);
    expect(bedsForWord('leaf rustle')).toEqual(['leaves']);
    expect(bedsForWord('frogs')).toEqual(['frogs']);
    expect(bedsForWord('birdsong')).toEqual(['birds']);
    expect(bedsForWord('zzz')).toEqual([]);
  });

  it('builds the mix from weather, words, theme and hour', () => {
    const storm = sceneMix({ theme: 'scifi', hour: 23, mood: mood({ weather: 'storm', intensity: 0.9, ambience: ['neon buzz'] }) });
    expect(ids(storm)).toEqual(['buzz', 'murmur', 'rain', 'thunder', 'wind']);
    expect(kinds(storm)).toContain('spark');
    expect(storm.find((b) => b.id === 'rain')?.variant).toBe(2);

    const day = ids(sceneMix({ theme: 'medieval', hour: 12 }));
    expect(day).toContain('birds');
    expect(day).not.toContain('crickets');
    const night = ids(sceneMix({ theme: 'medieval', hour: 23 }));
    expect(night).toContain('crickets');
    expect(night).not.toContain('birds');

    expect(ids(sceneMix({ theme: 'scifi', hour: 12 }))).toContain('hum');
    expect(ids(sceneMix({ theme: 'western', hour: 12 }))).toContain('desert');
    expect(ids(sceneMix({ theme: 'medieval', hour: 12, mood: mood({ weather: 'snow', intensity: 0.5 }) }))).toEqual(expect.arrayContaining(['snow', 'wind']));
    const quay = sceneMix({ theme: 'modern', hour: 12, groundKind: 'sand', mood: mood({ ambience: ['harbour', 'gulls'] }) });
    expect(ids(quay)).toEqual(['murmur', 'water']);
    expect(kinds(quay)).toEqual(expect.arrayContaining(['gull', 'creak']));
    expect(quay.some((b) => b.id === 'shorelife')).toBe(true);
    // Unknown words fall back to the theme default rather than silence.
    expect(ids(sceneMix({ theme: 'scifi', hour: 12, mood: mood({ ambience: ['qwerty'] }) }))).toContain('hum');
    for (const b of storm) expect(b.level).toBeGreaterThan(0);
    for (const b of storm) expect(b.level).toBeLessThanOrEqual(1);
    expect(dayPhase(6)).toBe('dawn');
    expect(dayPhase(12)).toBe('day');
    expect(dayPhase(19)).toBe('dusk');
    expect(dayPhase(2)).toBe('night');
    expect(dayPhase(26)).toBe('night');
  });

  it('sizes the reverb by site pattern', () => {
    expect(roomFor('grid').seconds).toBeGreaterThan(roomFor('street').seconds);
    expect(roomFor('scatter').seconds).toBeLessThan(roomFor('street').seconds);
    expect(roomFor('nonsense').key).toBe('street');
    expect(roomFor(undefined).key).toBe('street');
  });

  it('plans music from the words and the theme', () => {
    expect(musicPlan(undefined, 'western')).toMatchObject({ voice: 'pluck', timbre: 'guitar', mode: 'dorian' });
    expect(musicPlan(undefined, 'medieval')).toMatchObject({ voice: 'pluck', timbre: 'lute', mode: 'mixolydian', drone: true });
    expect(musicPlan(undefined, 'scifi')).toMatchObject({ voice: 'pad', bells: true });
    expect(musicPlan(undefined, 'modern')).toMatchObject({ voice: 'epiano' });
    expect(musicPlan(mood({ music: '' }), 'western')).toBeNull();
    expect(musicPlan(mood({ music: 'lonely harmonica' }), 'western')).toMatchObject({ voice: 'pluck', lead: 'reed', mode: 'dorian' });
    expect(musicPlan(mood({ music: 'low drone' }), 'medieval')).toMatchObject({ voice: 'pad', drone: true, mode: 'aeolian' });
    expect(musicPlan(mood({ music: 'bright lute' }), 'scifi')).toMatchObject({ voice: 'pluck', timbre: 'lute', mode: 'mixolydian' });
    const slow = musicPlan(mood({ music: 'slow piano' }), 'modern');
    expect(slow?.bpm).toBeLessThan(60);
    const plan = musicPlan(undefined, 'western');
    if (!plan) throw new Error('no plan');
    expect(scaleNote(plan, 0)).toBe(45);
    expect(scaleNote(plan, 7)).toBe(57);
    expect(scaleNote(plan, 2)).toBe(48);
    expect(scaleNote(plan, -1)).toBe(43);
  });
});

describe('offline synthesis', () => {
  it('makes level-matched noise in three colours', () => {
    const tilt: number[] = [];
    for (const color of ['white', 'pink', 'brown'] as const) {
      const d = new Float32Array(48000);
      fillNoise(d, color, makeRng(1, color));
      expect(rms(d)).toBeGreaterThan(0.2);
      expect(rms(d)).toBeLessThan(0.27);
      expect(peak(d)).toBeLessThanOrEqual(1);
      let diff = 0;
      for (let i = 1; i < d.length; i++) diff += ((d[i] ?? 0) - (d[i - 1] ?? 0)) ** 2;
      tilt.push(diff);
    }
    // Each colour has less high-frequency energy than the one before it.
    expect(tilt[1]).toBeLessThan(tilt[0] ?? 0);
    expect(tilt[2]).toBeLessThan(tilt[1] ?? 0);
  });

  it('plucks a string in tune that decays', () => {
    const sr = 44100;
    for (const freq of [110, 220, 329.63]) {
      const d = renderPluck(sr, { freq, seconds: 1.5, brightness: 0.5, sustain: 2.5, position: 0.2 }, makeRng(3, 'p'));
      // Autocorrelation peak near the expected period, searched to a tenth of a sample by parabola.
      const from = Math.floor(sr * 0.1);
      const size = 8192;
      const want = sr / freq;
      let best = 0, bestLag = 0;
      const corr = (lag: number): number => {
        let acc = 0;
        for (let i = 0; i < size; i++) acc += (d[from + i] ?? 0) * (d[from + i + lag] ?? 0);
        return acc;
      };
      for (let lag = Math.floor(want * 0.8); lag <= Math.ceil(want * 1.2); lag++) {
        const c = corr(lag);
        if (c > best) { best = c; bestLag = lag; }
      }
      const a = corr(bestLag - 1), b = corr(bestLag), c = corr(bestLag + 1);
      const period = bestLag + (0.5 * (a - c)) / (a - 2 * b + c);
      const cents = 1200 * Math.log2(sr / period / freq);
      expect(Math.abs(cents)).toBeLessThan(6);
      expect(rms(d.subarray(0, sr / 10))).toBeGreaterThan(rms(d.subarray(sr, sr + sr / 10)) * 1.5);
    }
  });

  it('makes a reverb tail that decays and differs between ears', () => {
    const [l, r] = renderImpulse(44100, { seconds: 1.5, damping: 0.4, predelay: 0.01 }, makeRng(5, 'ir'));
    expect(l.length).toBe(r.length);
    const third = Math.floor(l.length / 3);
    expect(rms(l.subarray(0, third))).toBeGreaterThan(rms(l.subarray(third, 2 * third)) * 3);
    expect(rms(l.subarray(third, 2 * third))).toBeGreaterThan(rms(l.subarray(2 * third)) * 3);
    expect(l[l.length - 1]).toBe(0);
    let same = 0;
    for (let i = 0; i < l.length; i++) if (l[i] === r[i]) same += 1;
    expect(same).toBeLessThan(l.length * 0.05);
  });

  it('renders texture loops that are finite, stereo and denser when heavier', () => {
    const sr = 22050;
    const light = renderRainPatter(sr, 3, 18, makeRng(2, 'a'));
    const heavy = renderRainPatter(sr, 3, 95, makeRng(2, 'b'));
    for (const ch of [...light, ...heavy]) {
      expect(ch.every((v) => Number.isFinite(v))).toBe(true);
      expect(peak(ch)).toBeLessThanOrEqual(1);
    }
    // Both are normalised to the same loudness, so sparse drops leave far more near-silence between them.
    const quiet = (ch: Float32Array): number => ch.filter((v) => Math.abs(v) < 0.01).length / ch.length;
    expect(quiet(light[0])).toBeGreaterThan(quiet(heavy[0]) * 1.5);
    const crickets = renderCrickets(sr, 4, 5, makeRng(9, 'c'));
    expect(rms(crickets[0])).toBeGreaterThan(0.01);
    expect(crickets[0].some((v, i) => v !== crickets[1][i])).toBe(true);
  });
});
