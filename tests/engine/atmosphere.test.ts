import { describe, expect, it } from 'vitest';
import {
  GRADES,
  GRADE_KINDS,
  QUALITY_TIERS,
  QUALITY_UP_HOLD_MS,
  QUALITY_WINDOW_FRAMES,
  applyGrade,
  bloomThresholdFor,
  fogOpticalDepth,
  initialQualityFor,
  initialQualityState,
  makeTileNoise,
  stepQuality,
  type Quality,
  type QualityState,
} from '../../app/src/engine/post';
import { PARTICLE_SCALE, WEATHER_LAYERS, boxEdgeFade, particleCount, wrapToBox } from '../../app/src/engine/weather';
import { WEATHER_AIR, airFor, defaultMood, flashAt, inferTheme } from '../../app/src/engine/atmosphere';
import type { GradeKind, MoodSpec, SkyPreset, StyleSpec, SurfaceSet, ThemeId, WeatherKind } from '../../app/src/world/spec';

const ALL_GRADES: GradeKind[] = ['neutral', 'golden', 'teal_orange', 'cold_steel', 'sepia', 'neon_noir', 'verdant', 'bleached', 'crimson', 'moonlit'];
const ALL_WEATHER: WeatherKind[] = ['clear', 'rain', 'storm', 'snow', 'fog', 'dust', 'ash', 'spores', 'embers', 'fireflies', 'mist'];
const ALL_SKIES: SkyPreset[] = ['dawn', 'day', 'dusk', 'night', 'overcast'];
const ALL_THEMES: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

describe('grades', () => {
  it('has a table for every grade in the spec', () => {
    expect([...GRADE_KINDS].sort()).toEqual([...ALL_GRADES].sort());
    for (const k of ALL_GRADES) {
      const g = GRADES[k];
      expect(g).toBeDefined();
      for (const v of [...g.gamma, ...g.gain, ...g.shadows, ...g.highlights]) expect(v).toBeGreaterThan(0.5);
      for (const v of g.lift) expect(Math.abs(v)).toBeLessThan(0.05);
      expect(g.saturation).toBeGreaterThan(0);
      expect(g.contrast).toBeGreaterThanOrEqual(0);
      expect(g.contrast).toBeLessThanOrEqual(1);
      expect(g.exposure).toBeGreaterThan(0.7);
      expect(g.exposure).toBeLessThan(1.3);
      expect(g.vignette).toBeLessThan(0.6);
      expect(g.grain).toBeLessThan(0.08);
    }
  });

  it('is monotonic on the grey ramp in every channel and stays in range', () => {
    for (const k of ALL_GRADES) {
      const prev = [-1, -1, -1];
      for (let i = 0; i <= 512; i++) {
        const x = i / 512;
        const out = applyGrade([x, x, x], GRADES[k]);
        for (let c = 0; c < 3; c++) {
          const v = out[c] ?? Number.NaN;
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          expect(v, `${k} channel ${c} at ${x}`).toBeGreaterThanOrEqual((prev[c] ?? 0) - 1e-9);
          prev[c] = v;
        }
      }
    }
  });

  it('keeps a brighter colour brighter', () => {
    const lum = (c: readonly number[]): number => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    for (const k of ALL_GRADES) {
      let prev = -1;
      for (let i = 0; i <= 64; i++) {
        const s = i / 64;
        const l = lum(applyGrade([0.9 * s, 0.55 * s, 0.3 * s], GRADES[k]));
        expect(l).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = l;
      }
    }
  });

  it('is the identity at strength 0 and leaves mid grey near mid grey when neutral', () => {
    for (const k of ALL_GRADES) {
      const out = applyGrade([0.2, 0.5, 0.8], GRADES[k], 0);
      expect(out[0]).toBeCloseTo(0.2, 9);
      expect(out[1]).toBeCloseTo(0.5, 9);
      expect(out[2]).toBeCloseTo(0.8, 9);
    }
    const mid = applyGrade([0.214, 0.214, 0.214], GRADES.neutral);
    expect(mid[1]).toBeGreaterThan(0.16);
    expect(mid[1]).toBeLessThan(0.26);
    // Warm grades push red over blue, cold ones the other way.
    const warm = applyGrade([0.6, 0.6, 0.6], GRADES.golden);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    const cold = applyGrade([0.3, 0.3, 0.3], GRADES.moonlit);
    expect(cold[2]).toBeGreaterThan(cold[0]);
  });
});

function run(s: QualityState, frames: number, ms: number): QualityState {
  for (let i = 0; i < frames; i++) stepQuality(s, ms);
  return s;
}

describe('quality stepping', () => {
  it('steps down a tier when a 90-frame window averages under 40 fps', () => {
    const s = initialQualityState(2);
    run(s, 45 + QUALITY_WINDOW_FRAMES - 1, 30);
    expect(s.level).toBe(2);
    run(s, 1, 30);
    expect(s.level).toBe(1);
    run(s, 45 + QUALITY_WINDOW_FRAMES, 30);
    expect(s.level).toBe(0);
    run(s, 1000, 60);
    expect(s.level).toBe(0);
  });

  it('holds between 40 and 58 fps', () => {
    const s = initialQualityState(1);
    run(s, 4000, 20);
    expect(s.level).toBe(1);
  });

  it('steps up only after ten seconds above 58 fps', () => {
    const s = initialQualityState(1);
    const frame = 1000 / 60;
    run(s, 45, frame);
    const windowsNeeded = Math.ceil(QUALITY_UP_HOLD_MS / (QUALITY_WINDOW_FRAMES * frame));
    run(s, (windowsNeeded - 1) * QUALITY_WINDOW_FRAMES, frame);
    expect(s.level).toBe(1);
    run(s, QUALITY_WINDOW_FRAMES, frame);
    expect(s.level).toBe(2);
  });

  it('never passes the ceiling and ignores stalls', () => {
    const s = initialQualityState(2, 1);
    expect(s.level).toBe(1);
    run(s, 5000, 10);
    expect(s.level).toBe(1);
    const t = initialQualityState(2);
    run(t, 2000, 400); // a hidden tab, not a slow GPU
    run(t, 2000, Number.NaN);
    expect(t.level).toBe(2);
  });

  it('waits longer before trying again when a step up does not hold', () => {
    const s = initialQualityState(1);
    run(s, 45 + 7 * QUALITY_WINDOW_FRAMES, 1000 / 60);
    expect(s.level).toBe(2);
    run(s, 45 + QUALITY_WINDOW_FRAMES, 30);
    expect(s.level).toBe(1);
    expect(s.upHoldMs).toBe(QUALITY_UP_HOLD_MS * 2);
    run(s, 45 + 7 * QUALITY_WINDOW_FRAMES, 1000 / 60);
    expect(s.level).toBe(1);
    run(s, 7 * QUALITY_WINDOW_FRAMES, 1000 / 60);
    expect(s.level).toBe(2);
  });

  it('caps the pixel ratio at 1, 1.5 and 2 and spends more at each tier', () => {
    expect(QUALITY_TIERS.map((t) => t.pixelRatio)).toEqual([1, 1.5, 2]);
    expect(QUALITY_TIERS[2].msaa).toBe(4);
    expect(QUALITY_TIERS[0].aoSamples).toBe(0);
    for (const q of [1, 2] as Quality[]) {
      expect(QUALITY_TIERS[q].aoSamples).toBeGreaterThan(QUALITY_TIERS[(q - 1) as Quality].aoSamples);
      expect(QUALITY_TIERS[q].shaftTaps).toBeGreaterThan(QUALITY_TIERS[(q - 1) as Quality].shaftTaps);
    }
  });

  it('starts integrated and software GPUs lower', () => {
    expect(initialQualityFor('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(2);
    expect(initialQualityFor('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(1);
    expect(initialQualityFor('ANGLE (AMD, AMD Radeon 780M Graphics (0x00001900) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(1);
    expect(initialQualityFor('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(1);
    expect(initialQualityFor('ANGLE (AMD, AMD Radeon RX 7600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(2);
    expect(initialQualityFor('Google SwiftShader')).toBe(0);
    expect(initialQualityFor('')).toBe(2);
  });
});

describe('particle wrap', () => {
  it('lands inside the box and stays congruent to the input', () => {
    for (const size of [9, 18, 30, 150]) {
      for (const center of [-320.5, -3, 0, 7.25, 1200]) {
        for (let i = -40; i <= 40; i++) {
          const p = i * 13.37 + 0.11;
          const w = wrapToBox(p, center, size);
          expect(w).toBeGreaterThanOrEqual(center - size / 2 - 1e-9);
          expect(w).toBeLessThan(center + size / 2 + 1e-9);
          const turns = (w - p) / size;
          expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('keeps a particle still in the world while the box moves, until it wraps', () => {
    const p = 4.2;
    expect(wrapToBox(p, 0, 30)).toBeCloseTo(4.2, 9);
    expect(wrapToBox(p, 10, 30)).toBeCloseTo(4.2, 9);
    expect(wrapToBox(p, 19, 30)).toBeCloseTo(4.2, 9);
    expect(wrapToBox(p, 20, 30)).toBeCloseTo(34.2, 9);
  });

  it('fades to nothing at the faces of the box', () => {
    expect(boxEdgeFade(0, 30)).toBe(1);
    expect(boxEdgeFade(10, 30)).toBe(1);
    expect(boxEdgeFade(15, 30)).toBe(0);
    expect(boxEdgeFade(-15, 30)).toBe(0);
    expect(boxEdgeFade(14, 30)).toBeGreaterThan(0);
    expect(boxEdgeFade(14, 30)).toBeLessThan(1);
  });

  it('defines layers for every weather kind and thins them by tier', () => {
    for (const k of ALL_WEATHER) {
      const layers = WEATHER_LAYERS[k];
      expect(layers).toBeDefined();
      if (k !== 'clear') expect(layers.length).toBeGreaterThan(0);
      for (const l of layers) {
        expect(l.count).toBeGreaterThan(0);
        expect(l.share).toBeGreaterThan(0);
        for (const s of l.size) expect(s).toBeGreaterThan(0);
        expect(particleCount(l.count, 0)).toBeLessThan(particleCount(l.count, 2));
        expect(particleCount(l.count, 2)).toBe(l.count);
      }
    }
    expect(PARTICLE_SCALE[0]).toBeLessThan(PARTICLE_SCALE[1]);
    // Everything that glows is additive, so it reaches the bloom.
    for (const k of ['spores', 'embers', 'fireflies'] as const) {
      for (const l of WEATHER_LAYERS[k]) {
        expect(l.type).toBe('points');
        if (l.type === 'points') {
          expect(l.additive).toBe(true);
          expect(l.glow).toBeGreaterThan(1);
        }
      }
    }
  });
});

function styleWith(surfaces: Partial<SurfaceSet>): StyleSpec {
  return {
    name: 'test', wall: '#886644', wall2: '#775533', roof: '#553322', trim: '#332211', accent: '#aa3322', dark: '#111111',
    glass: '#223344', glow: '#ffcc66', ground: '#b08a5a', road: '#8a6a44', variety: 0.3,
    surfaces: { wall: 'organic', wall2: 'organic', roof: 'organic', trim: 'organic', ground: 'ash', road: 'ash', wear: 0.4, wet: 0, ...surfaces },
  };
}

describe('default mood', () => {
  it('gives each theme its own air', () => {
    const western = defaultMood('western', 'day');
    expect(western.weather).toBe('dust');
    expect(western.grade).toBe('golden');
    const scifi = defaultMood('scifi', 'day');
    expect(scifi.weather).toBe('mist');
    expect(scifi.grade).toBe('cold_steel');
    const medieval = defaultMood('medieval', 'dawn');
    expect(medieval.weather).toBe('mist');
    expect(medieval.grade).toBe('verdant');
    const modern = defaultMood('modern', 'day');
    expect(modern.weather).toBe('clear');
    expect(modern.grade).toBe('neutral');
    const grades = new Set(ALL_THEMES.map((t) => defaultMood(t, 'day').grade));
    expect(grades.size).toBe(4);
  });

  it('returns a valid mood for every theme and sky', () => {
    for (const t of [...ALL_THEMES, undefined]) {
      for (const s of ALL_SKIES) {
        for (const fog of [0, 0.3, 1]) {
          const m = defaultMood(t, s, fog, 'scatter');
          expect(ALL_WEATHER).toContain(m.weather);
          expect(ALL_GRADES).toContain(m.grade);
          expect(m.intensity).toBeGreaterThanOrEqual(0);
          expect(m.intensity).toBeLessThanOrEqual(1);
          expect(m.haze).toBeGreaterThanOrEqual(0);
          expect(m.haze).toBeLessThanOrEqual(1);
          expect(m.ambience.length).toBeGreaterThan(0);
        }
      }
    }
    expect(defaultMood('western', 'night').grade).toBe('moonlit');
    expect(defaultMood('modern', 'day', 0.9).weather).toBe('fog');
    expect(defaultMood('modern', 'day', 0, 'scatter').haze).toBeGreaterThan(defaultMood('modern', 'day', 0, 'grid').haze);
  });

  it('reads the theme off the surfaces', () => {
    expect(inferTheme(undefined)).toBeUndefined();
    expect(inferTheme({ ...styleWith({}), surfaces: undefined })).toBeUndefined();
    expect(inferTheme(styleWith({}))).toBeUndefined();
    expect(inferTheme(styleWith({ wall: 'planks', roof: 'shingle', ground: 'dirt' }))).toBe('western');
    expect(inferTheme(styleWith({ wall: 'stone', roof: 'thatch', ground: 'grass', road: 'cobble' }))).toBe('medieval');
    expect(inferTheme(styleWith({ wall: 'hull_plate', roof: 'metal_panel', ground: 'regolith' }))).toBe('scifi');
    expect(inferTheme(styleWith({ wall: 'concrete', roof: 'corrugated', road: 'asphalt' }))).toBe('modern');
  });
});

describe('air settings', () => {
  const mood = (weather: WeatherKind, intensity: number, haze = 0.3): MoodSpec => ({ weather, intensity, grade: 'neutral', haze, ambience: [], music: '' });

  it('covers every weather kind and thickens the air with intensity and haze', () => {
    for (const k of ALL_WEATHER) {
      expect(WEATHER_AIR[k]).toBeDefined();
      const lo = airFor(mood(k, 0.2));
      const hi = airFor(mood(k, 1));
      expect(hi.densityAdd).toBeGreaterThanOrEqual(lo.densityAdd);
      expect(hi.densityMul).toBeGreaterThanOrEqual(lo.densityMul);
      expect(hi.falloff).toBeGreaterThan(0);
      expect(hi.exposureMul).toBeGreaterThan(0.7);
      expect(hi.cloudShadow).toBeGreaterThanOrEqual(0);
    }
    expect(airFor(mood('clear', 0, 0.9)).densityMul).toBeGreaterThan(airFor(mood('clear', 0, 0.1)).densityMul);
    expect(airFor(mood('mist', 1)).falloff).toBeGreaterThan(airFor(mood('fog', 1)).falloff);
  });

  it('soaks the ground in rain and keeps the style wetness otherwise', () => {
    expect(airFor(mood('rain', 1)).wet).toBeGreaterThan(0.8);
    expect(airFor(mood('clear', 0), 0.4).wet).toBeCloseTo(0.4, 9);
    expect(airFor(mood('dust', 1), 0).wet).toBe(0);
    expect(airFor(mood('storm', 1), 5).wet).toBe(1);
    expect(airFor(mood('rain', Number.NaN)).wet).toBe(0);
  });

  it('shapes lightning as decaying pulses', () => {
    const pulses = [0, 0.8, 0.15, 0.6, 0.4, 0];
    expect(flashAt(-0.1, pulses)).toBe(0);
    expect(flashAt(0, pulses)).toBeCloseTo(0.8, 6);
    expect(flashAt(0.1, pulses)).toBeLessThan(flashAt(0, pulses));
    expect(flashAt(0.15, pulses)).toBeGreaterThan(flashAt(0.14, pulses));
    expect(flashAt(2, pulses)).toBeLessThan(1e-6);
    expect(flashAt(0.01, [0, 1, 0, 1, 0, 1])).toBe(1);
  });
});

describe('fog and bloom maths', () => {
  it('thickens with distance and thins with height', () => {
    let prev = 0;
    for (const d of [1, 10, 50, 200, 800]) {
      const tau = fogOpticalDepth(0.002, 0.07, 1.7, 0, d);
      expect(tau).toBeGreaterThan(prev);
      prev = tau;
    }
    const level = fogOpticalDepth(0.002, 0.07, 1.7, 0, 100);
    const up = fogOpticalDepth(0.002, 0.07, 1.7, 0.5, 100);
    const down = fogOpticalDepth(0.002, 0.07, 30, -0.25, 100);
    const high = fogOpticalDepth(0.002, 0.07, 60, 0, 100);
    expect(up).toBeLessThan(level);
    expect(high).toBeLessThan(level);
    expect(down).toBeGreaterThan(high);
    // Level ray near the ground: close to plain exponential fog.
    expect(fogOpticalDepth(0.002, 0.07, 0, 0, 100)).toBeCloseTo(0.2, 6);
    expect(Number.isFinite(fogOpticalDepth(0.01, 0.2, 300, -1, 5000))).toBe(true);
  });

  it('lets the zenith through and closes the horizon when looking at the sky', () => {
    const zenith = fogOpticalDepth(0.001, 0.07, 1.7, 1, 1200, true);
    const horizon = fogOpticalDepth(0.001, 0.07, 1.7, 0.01, 1200, true);
    expect(Math.exp(-zenith)).toBeGreaterThan(0.9);
    expect(Math.exp(-horizon)).toBeLessThan(0.6);
  });

  it('puts the bloom threshold above sunlit surfaces by day and low at night', () => {
    expect(bloomThresholdFor(4, 1)).toBeGreaterThan(4);
    expect(bloomThresholdFor(0.9, 0.05)).toBeLessThan(1);
    expect(bloomThresholdFor(0, 0)).toBeGreaterThan(0.5);
    expect(bloomThresholdFor(1, 3)).toBeGreaterThan(3);
  });

  it('makes noise that tiles and uses the whole range', () => {
    const size = 64;
    const n = makeTileNoise(size, 7);
    expect(n.length).toBe(size * size);
    let lo = 255;
    let hi = 0;
    let inner = 0;
    let seam = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = n[y * size + x] ?? 0;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        if (x > 0) inner = Math.max(inner, Math.abs(v - (n[y * size + x - 1] ?? 0)));
      }
      seam = Math.max(seam, Math.abs((n[y * size] ?? 0) - (n[y * size + size - 1] ?? 0)));
    }
    expect(lo).toBe(0);
    expect(hi).toBe(255);
    expect(seam).toBeLessThanOrEqual(inner);
    expect(makeTileNoise(size, 7)).toEqual(n);
    expect(makeTileNoise(size, 8)).not.toEqual(n);
  });
});
