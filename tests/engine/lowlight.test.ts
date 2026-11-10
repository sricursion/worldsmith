import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { shownLuminance } from '../../app/src/engine/atmosphere';
import { GRADES, NIGHT_FOG_LIFT, accentWeight, applyGrade, bloomThresholdFor, gradeTint, nightFogGain } from '../../app/src/engine/post';
import {
  GROUND_LIFT_MAX,
  GROUND_LIFT_MIN,
  PLAYER_FILL,
  REFERENCE_ALBEDO,
  exposureFor,
  groundLift,
  lightRigFor,
  lowLight,
  playerFillIrradiance,
  skyLookFor,
  acesDisplay,
} from '../../app/src/engine/sky';
import type { GradeKind, MoodSpec, SkyPreset } from '../../app/src/world/spec';

type Mood = Pick<MoodSpec, 'weather' | 'intensity' | 'grade' | 'haze'>;
interface World { name: string; preset: SkyPreset; hour: number; mood: Mood; ground: string; band: readonly [number, number] }

const NIGHT: readonly [number, number] = [0.18, 0.28];
const TWILIGHT: readonly [number, number] = [0.3, 0.45];

// The five worlds that were looked at: sky preset, start hour and mood as the compile model wrote them.
const WORLDS: World[] = [
  { name: 'container port at dawn', preset: 'overcast', hour: 5.75, mood: { weather: 'rain', intensity: 0.75, grade: 'teal_orange', haze: 0.6 }, ground: '#4a5256', band: TWILIGHT },
  { name: 'mushroom forest at night', preset: 'night', hour: 20.5, mood: { weather: 'spores', intensity: 0.4, grade: 'verdant', haze: 0.7 }, ground: '#2a4a3a', band: NIGHT },
  { name: 'snowbound monastery at night', preset: 'night', hour: 21.5, mood: { weather: 'snow', intensity: 0.7, grade: 'moonlit', haze: 0.6 }, ground: '#d3dde8', band: NIGHT },
  { name: 'needle-tower city in rain', preset: 'overcast', hour: 19.5, mood: { weather: 'rain', intensity: 0.6, grade: 'neon_noir', haze: 0.6 }, ground: '#20262f', band: NIGHT },
  { name: 'wild west town at dusk', preset: 'dusk', hour: 18.5, mood: { weather: 'dust', intensity: 0.4, grade: 'golden', haze: 0.6 }, ground: '#c4a074', band: TWILIGHT },
];

const PRESETS: SkyPreset[] = ['dawn', 'day', 'dusk', 'night', 'overcast'];
const CLEAR: Mood = { weather: 'clear', intensity: 0, grade: 'neutral', haze: 0.3 };
const luminanceOf = (hex: string): number => {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

describe('low-light levels', () => {
  for (const w of WORLDS) {
    it(`shows mid-grey ground by the player at ${Math.round(w.band[0] * 100)} to ${Math.round(w.band[1] * 100)} percent: ${w.name}`, () => {
      const near = shownLuminance({ preset: w.preset, hour: w.hour, mood: w.mood });
      expect(near.encoded).toBeGreaterThanOrEqual(w.band[0]);
      expect(near.encoded).toBeLessThanOrEqual(w.band[1]);
      // Away from the player the fill is gone, but the street is still there.
      const far = shownLuminance({ preset: w.preset, hour: w.hour, mood: w.mood, distance: Infinity });
      expect(far.encoded).toBeLessThan(near.encoded);
      expect(far.encoded).toBeGreaterThan(0.6 * w.band[0]);
    });
  }

  it('lifts dark ground and holds pale ground back, so each town sees its own ground', () => {
    expect(groundLift()).toBe(1);
    expect(groundLift(REFERENCE_ALBEDO)).toBeCloseTo(1, 9);
    expect(groundLift(0.9)).toBe(GROUND_LIFT_MIN);
    expect(groundLift(0.001)).toBe(GROUND_LIFT_MAX);
    expect(groundLift(Number.NaN)).toBe(1);
    for (const w of WORLDS) {
      const c = new Color(w.ground);
      const g = luminanceOf(w.ground);
      const own = shownLuminance({ preset: w.preset, hour: w.hour, mood: w.mood, groundLuminance: g, albedo: [c.r, c.g, c.b] });
      const flat = shownLuminance({ preset: w.preset, hour: w.hour, mood: w.mood, albedo: [c.r, c.g, c.b] });
      // The correction always moves the ground towards the band, never away from it.
      if (g < REFERENCE_ALBEDO) expect(own.encoded).toBeGreaterThan(flat.encoded);
      else expect(own.encoded).toBeLessThan(flat.encoded);
      expect(own.encoded).toBeLessThan(0.46);
    }
    // Snow stays where it was liked, concrete and packed dirt land in their bands.
    const at = (i: number): number => {
      const w = WORLDS[i] as World;
      const c = new Color(w.ground);
      return shownLuminance({ preset: w.preset, hour: w.hour, mood: w.mood, groundLuminance: luminanceOf(w.ground), albedo: [c.r, c.g, c.b] }).encoded;
    };
    expect(at(2)).toBeGreaterThan(0.2);
    expect(at(2)).toBeLessThan(0.28);
    expect(at(0)).toBeGreaterThan(0.3);
    expect(at(4)).toBeGreaterThan(0.3);
  });

  it('never drops mid-grey ground under 17 percent at any hour, and never jumps between hours', () => {
    for (const preset of PRESETS) {
      let prev = Number.NaN;
      for (let h = 0; h < 24; h += 0.1) {
        const v = shownLuminance({ preset, hour: h, mood: CLEAR }).encoded;
        expect(v, `${preset} ${h.toFixed(1)}`).toBeGreaterThan(0.17);
        expect(v, `${preset} ${h.toFixed(1)}`).toBeLessThan(0.46);
        if (Number.isFinite(prev)) expect(Math.abs(v - prev), `${preset} ${h.toFixed(1)}`).toBeLessThan(0.035);
        prev = v;
      }
    }
  });

  it('leaves the full day as it was', () => {
    for (const preset of ['dawn', 'day', 'dusk'] as const) {
      const rig = lightRigFor(preset, 12);
      expect(rig.dark).toBe(0);
      expect(rig.twilight).toBe(0);
      expect(rig.fillCandela).toBe(0);
      expect(rig.hemiLevel).toBeCloseTo(0.25, 9);
      expect(rig.keyIntensity).toBeCloseTo(4, 9);
      expect(exposureFor(preset, 12)).toBeCloseTo(0.46, 2);
      expect(exposureFor(preset, 12, 0.02)).toBe(exposureFor(preset, 12));
    }
  });

  it('weights dark and twilight by the sun elevation', () => {
    expect(lowLight(-40)).toEqual({ dark: 1, twilight: 0 });
    expect(lowLight(0).dark).toBeGreaterThan(0.95);
    expect(lowLight(0).twilight).toBe(1);
    expect(lowLight(40)).toEqual({ dark: 0, twilight: 0 });
    expect(lowLight(40, 0.5).dark).toBe(0.5);
    let prev = lowLight(-60).dark;
    for (let el = -60; el <= 60; el += 1) {
      const d = lowLight(el).dark;
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });

  it('keeps the moon the key at night, with a fill strong enough to read the shadow side', () => {
    const rig = lightRigFor('night', 0);
    expect(rig.sunUp).toBe(false);
    expect(rig.keyIntensity).toBeCloseTo(1.6, 9);
    expect(rig.hemiLevel).toBeGreaterThan(1.5);
    expect(rig.hemiSky.b).toBeGreaterThan(rig.hemiSky.r * 3);
    const dusk = lightRigFor('dusk', 18.5);
    expect(dusk.hemiLevel).toBeGreaterThan(rig.hemiLevel);
    // Pale ground turns the moon down; dark ground never turns it up.
    expect(lightRigFor('night', 0, { groundLuminance: 0.7 }).keyIntensity).toBeLessThan(1.6);
    expect(lightRigFor('night', 0, { groundLuminance: 0.02 }).keyIntensity).toBeCloseTo(1.6, 9);
  });
});

describe('player fill', () => {
  it('is off by day and comes up as the daylight falls', () => {
    expect(lightRigFor('day', 12).fillCandela).toBe(0);
    let prev = 0;
    for (const h of [15, 16.5, 17.5, 18.5, 21]) {
      const c = lightRigFor('day', h).fillCandela;
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(prev).toBeCloseTo(PLAYER_FILL.candela, 9);
  });

  it('is wide and low: the nearest 8 m keep at least a third of it and it is never the brightest light', () => {
    const c = PLAYER_FILL.candela;
    const centre = playerFillIrradiance(c, 0);
    expect(playerFillIrradiance(c, 8)).toBeGreaterThan(centre / 3);
    expect(playerFillIrradiance(c, 30)).toBeLessThan(centre * 0.05);
    let prev = centre;
    for (let d = 0.5; d <= 40; d += 0.5) {
      const v = playerFillIrradiance(c, d);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    // A door lantern leaves half a unit on a wall one radius away and far more close to; the fill stays under that.
    expect(centre).toBeLessThan(0.75);
  });

  it('takes the cast of the grade', () => {
    expect(gradeTint(GRADES.neutral)).toEqual([1, 1, 1]);
    const moon = gradeTint(GRADES.moonlit);
    expect(moon[2]).toBe(1);
    expect(moon[0]).toBeLessThan(0.75);
    const gold = gradeTint(GRADES.golden);
    expect(gold[0]).toBe(1);
    expect(gold[2]).toBeLessThan(1);
    expect(gradeTint(GRADES.moonlit, 0)).toEqual([1, 1, 1]);
    for (const k of Object.keys(GRADES) as GradeKind[]) for (const v of gradeTint(GRADES[k])) expect(v).toBeGreaterThan(0.5);
  });
});

describe('night fog and bloom', () => {
  it('brightens the fog with haze at night and leaves it alone by day', () => {
    expect(nightFogGain(0.6, 1)).toBe(1);
    expect(nightFogGain(0, 0)).toBe(1);
    expect(nightFogGain(1, 0)).toBeCloseTo(1 + NIGHT_FOG_LIFT, 9);
    expect(nightFogGain(0.6, 0)).toBeGreaterThan(nightFogGain(0.3, 0));
    expect(nightFogGain(Number.NaN, 0)).toBe(1);
    // Still a night sky: the lifted fog stays well under the ground it veils.
    const look = skyLookFor('night', 22);
    const g = nightFogGain(0.7, 0);
    const shown = acesDisplay([look.fog.r * g, look.fog.g * g, look.fog.b * g], look.exposure);
    expect(shown[2]).toBeGreaterThan(shown[0]);
    expect(0.2126 * shown[0] + 0.7152 * shown[1] + 0.0722 * shown[2]).toBeLessThan(0.05);
  });

  it('keeps the bloom threshold under a lamp at night', () => {
    // What the rig hands the pipeline: the key level weighted by the luminance of its colour.
    for (const [preset, hour] of [['night', 22], ['overcast', 19.5], ['dusk', 18.5], ['overcast', 5.75]] as const) {
      const rig = lightRigFor(preset, hour, { groundLuminance: 0.02 });
      const level = rig.keyIntensity * (0.2126 * rig.keyColor.r + 0.7152 * rig.keyColor.g + 0.0722 * rig.keyColor.b);
      // A lantern core is the glow colour at 2.2: about 1.2 for amber, 1.3 for cyan.
      expect(bloomThresholdFor(level, 0.02)).toBeLessThan(1);
    }
  });
});

// ---- Grades keep their warm accents ----------------------------------------------------------------------

function hueSat(c: readonly number[]): { hue: number; sat: number } {
  const [r, g, b] = [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const d = hi - lo || 1e-9;
  const h = hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: h * 60, sat: hi > 0 ? (hi - lo) / hi : 0 };
}

// Display colours of warm emitters: three at full level, two as they look dimmed by distance and haze.
const ACCENTS: [string, string, number][] = [
  ['orange', '#ff8a2a', 1],
  ['magenta', '#ff2f8f', 1],
  ['yellow', '#ffd23a', 1],
  ['lamp amber at half level', '#ffb347', 0.5],
  ['neon pink at 40 percent', '#ff2f8f', 0.4],
];
const COOL_GRADES: GradeKind[] = ['neon_noir', 'teal_orange', 'moonlit', 'cold_steel', 'verdant'];

describe('grades and warm accents', () => {
  for (const k of COOL_GRADES) {
    it(`${k} keeps warm emitters within 15 percent of their hue and saturation`, () => {
      for (const [name, hex, level] of ACCENTS) {
        const c = new Color(hex).multiplyScalar(level);
        const before = hueSat([c.r, c.g, c.b]);
        const after = hueSat(applyGrade([c.r, c.g, c.b], GRADES[k]));
        const turn = Math.abs(((after.hue - before.hue + 540) % 360) - 180);
        expect(turn / before.hue, `${k} ${name} hue`).toBeLessThan(0.15);
        expect(turn, `${k} ${name} hue`).toBeLessThan(15);
        expect(Math.abs(after.sat / before.sat - 1), `${k} ${name} saturation`).toBeLessThan(0.15);
      }
    });

    it(`${k} still tints the shadows cool`, () => {
      const out = applyGrade([0.04, 0.04, 0.04], GRADES[k]);
      expect(out[2]).toBeGreaterThan(out[0]);
    });
  }

  it('leaves an orange lamp and a cyan sign as two different colours under neon_noir', () => {
    const orange = new Color('#ff8a2a');
    const cyan = new Color('#35e6ff');
    const a = hueSat(applyGrade([orange.r, orange.g, orange.b], GRADES.neon_noir));
    const b = hueSat(applyGrade([cyan.r, cyan.g, cyan.b], GRADES.neon_noir));
    expect(Math.abs(a.hue - b.hue)).toBeGreaterThan(120);
    expect(a.sat).toBeGreaterThan(0.8);
    expect(b.sat).toBeGreaterThan(0.8);
    // No crushed blacks: a dark grey stays above black in every channel.
    for (const v of applyGrade([0.01, 0.01, 0.01], GRADES.neon_noir)) expect(v).toBeGreaterThan(0.002);
  });

  it('counts only saturated warm colours as accents', () => {
    expect(accentWeight([1, 0.25, 0.02])).toBe(1);
    expect(accentWeight([1, 0.03, 0.27])).toBe(1);
    expect(accentWeight([0.5, 0.5, 0.5])).toBe(0);
    expect(accentWeight([0.04, 0.8, 1])).toBe(0);
    expect(accentWeight([0.1, 0.6, 0.1])).toBe(0);
    expect(accentWeight([0.001, 0.0002, 0])).toBeLessThan(0.01);
    expect(accentWeight([0, 0, 0])).toBe(0);
  });
});
