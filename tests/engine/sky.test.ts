import { describe, expect, it } from 'vitest';
import {
  ENV_STEPS,
  MAX_SUN_ELEVATION_DEG,
  SKY_PRESETS,
  envStepForHour,
  fogDensityFor,
  sunFromHour,
  wrapHour,
} from '../../app/src/engine/sky';
import { joystickAxis, keyAxis } from '../../app/src/engine/input';

describe('sunFromHour', () => {
  it('puts the sun on the horizon in the east at 6', () => {
    const s = sunFromHour(6);
    expect(s.elevationDeg).toBeCloseTo(0, 6);
    expect(s.azimuthDeg).toBeCloseTo(90, 6);
    expect(s.direction[0]).toBeCloseTo(1, 6);
  });

  it('peaks in the south at noon', () => {
    const s = sunFromHour(12);
    expect(s.elevationDeg).toBeCloseTo(MAX_SUN_ELEVATION_DEG, 6);
    expect(s.azimuthDeg).toBeCloseTo(180, 6);
    expect(s.direction[1]).toBeGreaterThan(0.9);
    expect(s.direction[2]).toBeGreaterThan(0); // south is +Z
    expect(s.daylight).toBeCloseTo(1, 6);
  });

  it('sets in the west at 18', () => {
    const s = sunFromHour(18);
    expect(Math.abs(s.elevationDeg)).toBeLessThan(1e-6);
    expect(s.azimuthDeg).toBeCloseTo(270, 6);
    expect(s.direction[0]).toBeCloseTo(-1, 6);
  });

  it('is below the horizon between 18 and 6', () => {
    for (const h of [19, 21, 0, 2, 4, 5.5]) {
      expect(sunFromHour(h).elevationDeg).toBeLessThan(0);
    }
    expect(sunFromHour(0).daylight).toBe(0);
  });

  it('is above the horizon between 6 and 18', () => {
    for (const h of [6.5, 8, 12, 16, 17.5]) {
      expect(sunFromHour(h).elevationDeg).toBeGreaterThan(0);
    }
  });

  it('keeps daylight within 0..1 and monotone on the morning rise', () => {
    let prev = -1;
    for (let h = 4; h <= 12; h += 0.25) {
      const d = sunFromHour(h).daylight;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('returns unit direction vectors and wraps hours', () => {
    for (const h of [0, 3.3, 6, 9.9, 12, 15, 18, 23.99]) {
      const [x, y, z] = sunFromHour(h).direction;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    }
    expect(wrapHour(25)).toBe(1);
    expect(wrapHour(-1)).toBe(23);
    expect(sunFromHour(36).elevationDeg).toBeCloseTo(sunFromHour(12).elevationDeg, 9);
  });
});

describe('environment map steps', () => {
  it('has 24 distinct steps, one per whole hour', () => {
    const seen = new Set<number>();
    for (let h = 0; h < 24; h++) seen.add(envStepForHour(h));
    expect(seen.size).toBe(ENV_STEPS);
  });

  it('stays on one step inside an hour and changes at the boundary', () => {
    expect(envStepForHour(10.0)).toBe(envStepForHour(10.99));
    expect(envStepForHour(10.99)).not.toBe(envStepForHour(11));
    expect(envStepForHour(24)).toBe(0);
    expect(envStepForHour(-0.5)).toBe(23);
  });
});

describe('presets and fog', () => {
  it('defines parameters for every preset', () => {
    for (const key of ['dawn', 'day', 'dusk', 'night', 'overcast'] as const) {
      const p = SKY_PRESETS[key];
      expect(p.turbidity).toBeGreaterThan(0);
      expect(p.rayleigh).toBeGreaterThan(0);
      expect(p.mieDirectionalG).toBeLessThan(1);
    }
    expect(SKY_PRESETS.overcast.turbidity).toBeGreaterThan(SKY_PRESETS.day.turbidity);
    expect(SKY_PRESETS.overcast.sunScale).toBeLessThan(SKY_PRESETS.day.sunScale);
  });

  it('maps the fog hint monotonically and clamps bad input', () => {
    expect(fogDensityFor(0)).toBeGreaterThan(0);
    expect(fogDensityFor(0.5)).toBeGreaterThan(fogDensityFor(0.1));
    expect(fogDensityFor(1)).toBeGreaterThan(fogDensityFor(0.5));
    expect(fogDensityFor(5)).toBe(fogDensityFor(1));
    expect(fogDensityFor(-1)).toBe(fogDensityFor(0));
    expect(fogDensityFor(Number.NaN)).toBe(fogDensityFor(0));
  });
});

describe('input axis maths', () => {
  it('combines WASD and arrows', () => {
    expect(keyAxis((c) => c === 'KeyW')).toEqual({ x: 0, y: 1 });
    expect(keyAxis((c) => c === 'ArrowDown' || c === 'KeyD')).toEqual({ x: 1, y: -1 });
    expect(keyAxis((c) => c === 'KeyA' || c === 'ArrowLeft')).toEqual({ x: -1, y: 0 });
    expect(keyAxis((c) => c === 'KeyA' || c === 'KeyD')).toEqual({ x: 0, y: 0 });
  });

  it('turns joystick drags into a clamped axis with a dead zone', () => {
    expect(joystickAxis(2, 2)).toEqual({ x: 0, y: 0 });
    const up = joystickAxis(0, -56);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(1);
    const far = joystickAxis(300, 0);
    expect(far.x).toBeCloseTo(1);
    expect(Math.hypot(far.x, far.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
