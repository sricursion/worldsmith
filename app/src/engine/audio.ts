// Sound for the whole game, synthesised with the Web Audio API. Nothing is downloaded: noise,
// impulse responses, footsteps, rain drops, plucked strings and insects are all computed in the
// browser. The rig is inert until unlock() runs inside a user gesture, and every method is a
// no-op where there is no AudioContext, so callers never need to check.

import type { MoodSpec, SurfaceKind, ThemeId } from '../world/spec';
import { createBed, type Bed, type BedState } from './audio/beds';
import { renderImpulse } from './audio/dsp';
import {
  FADE_SECONDS, createFader, createKit, fadeTo, filterNode, gainNode,
  type Fader, type Kit, type Quality,
} from './audio/kit';
import {
  StepClock, bedKey, dayPhase, indoorStepFamily, musicPlan, roomFor, sceneMix, stepFamily,
  type BedMix, type DayPhase, type SceneOpts,
} from './audio/mapping';
import { createMusic, type Music } from './audio/music';
import { createFeet, playBlip, playUi, type Feet, type UiKind } from './audio/sfx';

export interface AudioRig {
  /** Call from a user gesture; creates or resumes the AudioContext. */
  unlock(): void;
  setScene(opts: { mood?: MoodSpec; theme: ThemeId; groundKind?: SurfaceKind; sitePattern?: string; hour: number }): void;
  update(dt: number, s: { speed: number; running: boolean; hour: number; indoors?: boolean; nearNpcCount?: number }): void;
  footstep(): void;
  ui(kind: 'open' | 'close' | 'confirm' | 'quest' | 'error' | 'reveal'): void;
  /** A short soft syllable-like blip per streamed word of NPC speech. `pitch` is a multiplier around 1, or hertz when above 8. */
  voiceBlip(pitch: number): void;
  setMuted(m: boolean): void;
  setVolume(v: number): void;
  /** 0..1 multiplier on the ambience and music buses, kept through scene and indoor changes. */
  setBackgroundVolume(v: number): void;
  /** 0..1 multiplier on the voice blip bus. */
  setVoiceVolume(v: number): void;
  dispose(): void;
}

/** Returns a context, or null where audio is unavailable. Tests pass a fake. */
export type AudioContextFactory = () => AudioContext | null;

export interface AudioOptions {
  /** 0 integrated graphics .. 2 full: trims reverb length and voice counts. Default 2. */
  quality?: Quality;
}

const AUDIO_SEED = 0x51f15e;
const AMBIENCE_LEVEL = 0.8;
const MUSIC_LEVEL = 0.3;

function defaultFactory(): AudioContext | null {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
}

interface Slot {
  key: string;
  bed: Bed;
  fader: Fader;
  /** Context time at which a faded-out slot is torn down; 0 while it is in the mix. */
  killAt: number;
}

interface Core {
  setScene(opts: SceneOpts): void;
  update(dt: number, s: { speed: number; running: boolean; hour: number; indoors?: boolean; nearNpcCount?: number }): void;
  footstep(): void;
  ui(kind: UiKind): void;
  voiceBlip(pitch: number): void;
  setMaster(level: number): void;
  setBackground(level: number): void;
  setVoice(level: number): void;
  resume(): void;
  dispose(): void;
}

function softClipCurve(): Float32Array<ArrayBuffer> {
  // Exactly linear to 0.85, then a tanh knee: whatever gets past the limiter bends instead of clipping.
  const n = 1025;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= 0.85 ? x : Math.sign(x) * (0.85 + 0.15 * Math.tanh((a - 0.85) / 0.15));
  }
  return curve;
}

function buildCore(ctx: AudioContext, quality: Quality, masterLevel: number, bgLevel: number, voiceLevel: number): Core {
  const kit: Kit = createKit(ctx, quality, AUDIO_SEED);
  const rng = kit.rng;

  // Master chain: low shelf, compressor, limiter, soft clip, volume.
  const mix = gainNode(ctx, 1);
  const shelf = filterNode(ctx, 'lowshelf', 110, 0.7);
  shelf.gain.value = -3;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.008;
  comp.release.value = 0.3;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  const master = gainNode(ctx, masterLevel);
  mix.connect(shelf);
  shelf.connect(comp);
  comp.connect(limiter);
  limiter.connect(clip);
  clip.connect(master);
  master.connect(ctx.destination);

  // Buses.
  const ambIn = gainNode(ctx, 1);
  const ambLp = filterNode(ctx, 'lowpass', 18000, 0.5);
  const ambOut = gainNode(ctx, AMBIENCE_LEVEL * bgLevel);
  ambIn.connect(ambLp);
  ambLp.connect(ambOut);
  ambOut.connect(mix);
  const sfxIn = gainNode(ctx, 0.9);
  sfxIn.connect(mix);
  const voiceIn = gainNode(ctx, voiceLevel);
  voiceIn.connect(sfxIn);
  const voiceSend = gainNode(ctx, 0.15);
  voiceIn.connect(voiceSend);
  voiceSend.connect(kit.reverbIn);
  const musicIn = gainNode(ctx, MUSIC_LEVEL * bgLevel);
  const duckGain = gainNode(ctx, 1);
  musicIn.connect(duckGain);
  duckGain.connect(mix);

  const feet: Feet = createFeet(kit, sfxIn);
  const clock = new StepClock();
  const bedState: BedState = { nearNpc: 0, indoors: false };

  let slots: Slot[] = [];
  let scene: SceneOpts | null = null;
  let phase: DayPhase = 'day';
  let indoors = false;
  let bg = bgLevel;
  let running = false;
  let wet = 0;

  let room: { key: string; conv: ConvolverNode; fader: Fader } | null = null;
  let oldRooms: { conv: ConvolverNode; fader: Fader; killAt: number }[] = [];
  let music: { key: string; engine: Music; fader: Fader } | null = null;
  let oldMusic: { engine: Music; fader: Fader; killAt: number }[] = [];

  let ducked = false;
  let duckUntil = 0;
  let lastBlip = -1;

  const duck = (amount: number): void => {
    const now = ctx.currentTime;
    duckGain.gain.setTargetAtTime(1 - 0.7 * Math.min(1, Math.max(0, amount)), now, 0.04);
    duckUntil = now + 0.45;
    ducked = true;
  };

  const setRoom = (pattern: string | undefined, now: number): void => {
    const spec = roomFor(pattern);
    if (room && room.key === spec.key) return;
    if (room) {
      fadeTo(room.fader, 0, now);
      oldRooms.push({ conv: room.conv, fader: room.fader, killAt: now + FADE_SECONDS + 0.1 });
    }
    const seconds = spec.seconds * (quality === 0 ? 0.6 : 1);
    const conv = ctx.createConvolver();
    conv.buffer = kit.buffer(`ir:${spec.key}`, (sr, r) => renderImpulse(sr, { seconds, damping: spec.damping, predelay: spec.predelay }, r));
    const fader = createFader(ctx, 0);
    kit.reverbIn.connect(conv);
    conv.connect(fader.node);
    fader.node.connect(mix);
    fadeTo(fader, spec.wet, now);
    room = { key: spec.key, conv, fader };
  };

  const applyMix = (now: number): void => {
    if (!scene) return;
    phase = dayPhase(scene.hour);
    const want: BedMix[] = sceneMix(scene);
    for (const slot of slots) {
      const target = want.find((b) => bedKey(b) === slot.key);
      if (target) {
        if (slot.killAt !== 0 || Math.abs(slot.fader.to - target.level) > 0.01) fadeTo(slot.fader, target.level, now);
        slot.killAt = 0;
      } else if (slot.killAt === 0) {
        fadeTo(slot.fader, 0, now);
        slot.killAt = now + FADE_SECONDS + 0.1;
      }
    }
    for (const b of want) {
      const key = bedKey(b);
      if (slots.some((s) => s.key === key)) continue;
      const fader = createFader(ctx, 0);
      fader.node.connect(ambIn);
      const bed = createBed(kit, b, fader.node);
      fadeTo(fader, b.level, now);
      slots.push({ key, bed, fader, killAt: 0 });
    }
  };

  const applyMusic = (now: number): void => {
    if (!scene) return;
    const plan = musicPlan(scene.mood, scene.theme);
    const key = plan ? JSON.stringify(plan) : '';
    if ((music?.key ?? '') === key) return;
    if (music) {
      fadeTo(music.fader, 0, now);
      oldMusic.push({ engine: music.engine, fader: music.fader, killAt: now + FADE_SECONDS + 0.1 });
      music = null;
    }
    if (plan) {
      const fader = createFader(ctx, 0);
      fader.node.connect(musicIn);
      const engine = createMusic(kit, plan, fader.node);
      fadeTo(fader, 1, now);
      music = { key, engine, fader };
    }
  };

  const reap = (now: number): void => {
    if (slots.some((s) => s.killAt !== 0 && now >= s.killAt)) {
      slots = slots.filter((s) => {
        if (s.killAt === 0 || now < s.killAt) return true;
        s.bed.dispose();
        s.fader.node.disconnect();
        return false;
      });
    }
    if (oldMusic.length > 0 && oldMusic.some((m) => now >= m.killAt)) {
      oldMusic = oldMusic.filter((m) => {
        if (now < m.killAt) return true;
        m.engine.dispose();
        m.fader.node.disconnect();
        return false;
      });
    }
    if (oldRooms.length > 0 && oldRooms.some((r) => now >= r.killAt)) {
      oldRooms = oldRooms.filter((r) => {
        if (now < r.killAt) return true;
        kit.reverbIn.disconnect(r.conv);
        r.conv.disconnect();
        r.fader.node.disconnect();
        return false;
      });
    }
  };

  const footstep = (): void => {
    if (!scene) return;
    const family = indoors ? indoorStepFamily(scene.theme) : stepFamily(scene.groundKind, scene.theme);
    feet.step(family, running, indoors ? 0 : wet);
  };

  return {
    setScene(opts) {
      scene = { ...opts };
      const w = opts.mood?.weather;
      wet = opts.mood && (w === 'rain' || w === 'storm') ? Math.min(1, Math.max(0, opts.mood.intensity)) : 0;
      const now = ctx.currentTime;
      setRoom(opts.sitePattern, now);
      applyMix(now);
      applyMusic(now);
    },
    update(dt, s) {
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      running = s.running;
      const inside = s.indoors ?? false;
      if (inside !== indoors) {
        indoors = inside;
        // Under a roof the weather loses its top end and drops back.
        ambLp.frequency.setTargetAtTime(inside ? 900 : 18000, now, 0.25);
        ambOut.gain.setTargetAtTime(AMBIENCE_LEVEL * bg * (inside ? 0.7 : 1), now, 0.25);
      }
      if (clock.advance(dt, s.speed, s.running) > 0) footstep();
      if (scene && dayPhase(s.hour) !== phase) {
        scene.hour = s.hour;
        applyMix(now);
      }
      bedState.nearNpc = s.nearNpcCount ?? 0;
      bedState.indoors = inside;
      for (const slot of slots) if (slot.killAt === 0) slot.bed.tick(now, bedState);
      if (music) music.engine.tick(now);
      if (ducked && now >= duckUntil) {
        duckGain.gain.setTargetAtTime(1, now, 0.5);
        ducked = false;
      }
      reap(now);
    },
    footstep,
    ui(kind) {
      playUi(kit, sfxIn, kind);
    },
    voiceBlip(pitch) {
      const now = ctx.currentTime;
      // Words can arrive in bursts; one syllable per 45 ms is as fast as speech gets.
      if (lastBlip >= 0 && now - lastBlip < 0.045) return;
      lastBlip = now;
      playBlip(kit, voiceIn, pitch, rng);
      duck(0.6);
    },
    setMaster(level) {
      master.gain.setTargetAtTime(level, ctx.currentTime, 0.03);
    },
    setBackground(level) {
      bg = level;
      const now = ctx.currentTime;
      ambOut.gain.setTargetAtTime(AMBIENCE_LEVEL * bg * (indoors ? 0.7 : 1), now, 0.03);
      musicIn.gain.setTargetAtTime(MUSIC_LEVEL * bg, now, 0.03);
    },
    setVoice(level) {
      voiceIn.gain.setTargetAtTime(level, ctx.currentTime, 0.03);
    },
    resume() {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    },
    dispose() {
      for (const s of slots) {
        s.bed.dispose();
        s.fader.node.disconnect();
      }
      slots = [];
      for (const m of oldMusic) {
        m.engine.dispose();
        m.fader.node.disconnect();
      }
      oldMusic = [];
      if (music) {
        music.engine.dispose();
        music.fader.node.disconnect();
        music = null;
      }
      for (const r of [...oldRooms, ...(room ? [room] : [])]) {
        r.conv.disconnect();
        r.fader.node.disconnect();
      }
      oldRooms = [];
      room = null;
      feet.dispose();
      for (const n of [mix, shelf, comp, limiter, clip, master, ambIn, ambLp, ambOut, sfxIn, voiceIn, voiceSend, musicIn, duckGain, kit.reverbIn]) {
        n.disconnect();
      }
      kit.clear();
      void ctx.close().catch(() => undefined);
    },
  };
}

/**
 * Creates the sound rig. Nothing touches Web Audio until unlock(); setScene, setMuted and
 * setVolume called before that are remembered and applied when the context exists.
 */
export function createAudio(factory: AudioContextFactory = defaultFactory, options: AudioOptions = {}): AudioRig {
  const quality: Quality = options.quality ?? 2;
  let core: Core | null = null;
  let failed = false;
  let disposed = false;
  let muted = false;
  let volume = 0.8;
  let background = 1;
  let voices = 1;
  let pending: SceneOpts | null = null;

  const level = (): number => (muted ? 0 : volume);

  /** Runs one call into the engine; a Web Audio failure silences the rig instead of reaching the game loop. */
  const guard = (fn: (c: Core) => void): void => {
    if (!core) return;
    try {
      fn(core);
    } catch {
      failed = true;
      const dead = core;
      core = null;
      try {
        dead.dispose();
      } catch {
        // already torn down as far as it will go
      }
    }
  };

  return {
    unlock() {
      if (disposed || failed) return;
      if (core) {
        guard((c) => c.resume());
        return;
      }
      try {
        const ctx = factory();
        if (!ctx) {
          failed = true;
          return;
        }
        core = buildCore(ctx, quality, level(), background, voices);
      } catch {
        // No audio on this device or the graph could not be built: stay silent.
        failed = true;
        core = null;
        return;
      }
      guard((c) => {
        c.resume();
        if (pending) c.setScene(pending);
      });
    },
    setScene(opts) {
      if (disposed) return;
      pending = { ...opts };
      const next = pending;
      guard((c) => c.setScene(next));
    },
    update(dt, s) {
      guard((c) => c.update(dt, s));
    },
    footstep() {
      guard((c) => c.footstep());
    },
    ui(kind) {
      guard((c) => c.ui(kind));
    },
    voiceBlip(pitch) {
      guard((c) => c.voiceBlip(pitch));
    },
    setMuted(m) {
      muted = m;
      guard((c) => c.setMaster(level()));
    },
    setVolume(v) {
      volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : volume;
      guard((c) => c.setMaster(level()));
    },
    setBackgroundVolume(v) {
      background = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : background;
      guard((c) => c.setBackground(background));
    },
    setVoiceVolume(v) {
      voices = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : voices;
      guard((c) => c.setVoice(voices));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      guard((c) => c.dispose());
      core = null;
      pending = null;
    },
  };
}
