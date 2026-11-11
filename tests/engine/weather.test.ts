import { describe, expect, it } from 'vitest';
import { RAIN_SHUTTER, STREAK_MAX_ANGLE, WEATHER_LAYERS, streakLength } from '../../app/src/engine/weather';

describe('rain streaks', () => {
  it('are the path a drop covers while the shutter is open: a drop, not a line', () => {
    for (const kind of ['rain', 'storm'] as const) {
      for (const layer of WEATHER_LAYERS[kind]) {
        if (layer.type !== 'streaks') continue;
        const speed = Math.hypot(...layer.vel);
        // The longest a streak of this layer gets, far from the eye.
        const longest = streakLength(speed, layer.shutter, 1000, 1);
        expect(longest).toBeLessThan(0.4);
        expect(longest).toBeGreaterThan(0.1);
      }
    }
    expect(streakLength(11.5, RAIN_SHUTTER, 1000)).toBeCloseTo(11.5 / 60, 6);
  });

  it('grow with speed and shutter and with nothing else', () => {
    expect(streakLength(20, RAIN_SHUTTER, 1000)).toBeCloseTo(2 * streakLength(10, RAIN_SHUTTER, 1000), 9);
    expect(streakLength(10, 2 * RAIN_SHUTTER, 1000)).toBeCloseTo(2 * streakLength(10, RAIN_SHUTTER, 1000), 9);
    expect(streakLength(0, RAIN_SHUTTER, 1000)).toBe(0);
    expect(streakLength(-3, RAIN_SHUTTER, 1000)).toBe(0);
  });

  it('never subtend more than a small angle, so a drop passing the lens stays short', () => {
    for (const d of [0.5, 1, 2, 5, 30]) {
      expect(streakLength(14.5, RAIN_SHUTTER * 1.15, d, 1)).toBeLessThanOrEqual(d * STREAK_MAX_ANGLE + 1e-12);
    }
    expect(streakLength(14.5, RAIN_SHUTTER, 1)).toBeCloseTo(STREAK_MAX_ANGLE, 9);
  });

  it('only the kinds of weather that fall as water draw streaks', () => {
    for (const [kind, layers] of Object.entries(WEATHER_LAYERS)) {
      const has = layers.some((l) => l.type === 'streaks');
      expect(has, kind).toBe(kind === 'rain' || kind === 'storm');
    }
    expect(WEATHER_LAYERS.clear).toHaveLength(0);
  });
});
