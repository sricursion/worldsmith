import { readFileSync } from 'node:fs';
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { CLOUD_FORMS, cloudFormFor } from '../../app/src/engine/atmosphere';
import { GROUND_HAZE, HORIZON_BAND, groundHazeTint, horizonBandFor } from '../../app/src/engine/post';
import { CLOUD_UV_MARKER, castSkyLook, cloudLookFor, skyLookFor } from '../../app/src/engine/sky';
import { skyCastFor } from '../../app/src/engine/skyfeatures';

const lum = (c: { r: number; g: number; b: number }): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('ground haze', () => {
  it('leaves the fog alone over a grey or unknown ground', () => {
    const out = new Color();
    for (const g of [new Color(1, 1, 1), new Color(0.3, 0.3, 0.3), new Color(0, 0, 0)]) {
      groundHazeTint(g, 1, out);
      expect(out.r).toBeCloseTo(1, 6);
      expect(out.g).toBeCloseTo(1, 6);
      expect(out.b).toBeCloseTo(1, 6);
    }
  });

  it('takes the hue of the ground, more in hazy air, and never changes how bright the fog is', () => {
    const red = new Color(0.5, 0.16, 0.08);
    const clear = groundHazeTint(red, 0, new Color());
    const hazy = groundHazeTint(red, 1, new Color());
    expect(clear.r).toBeGreaterThan(clear.b);
    expect(hazy.r / hazy.b).toBeGreaterThan(clear.r / clear.b);
    expect(lum(clear)).toBeCloseTo(1, 6);
    expect(lum(hazy)).toBeCloseTo(1, 6);
    expect(GROUND_HAZE[1]).toBeGreaterThan(GROUND_HAZE[0]);
  });

  it('stays finite and bounded for a black, saturated ground', () => {
    const out = groundHazeTint(new Color(0.001, 0, 0.02), 1, new Color());
    for (const v of [out.r, out.g, out.b]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0.2);
      expect(v).toBeLessThan(4);
    }
  });

  it('has a horizon band that grows with haze and stays under the bloom margin', () => {
    expect(horizonBandFor(0)).toBe(HORIZON_BAND[0]);
    expect(horizonBandFor(1)).toBe(HORIZON_BAND[1]);
    expect(horizonBandFor(Number.NaN)).toBe(HORIZON_BAND[0]);
    // Bloom starts at 1.3 times the fog: the band must not reach it.
    expect(1 + HORIZON_BAND[1]).toBeLessThan(1.3);
  });
});

describe('sky cast', () => {
  it('is nothing for a sky with no features, or with only ordinary ones', () => {
    expect(skyCastFor([]).amount).toBe(0);
    expect(skyCastFor([{ kind: 'moon', size: 0.1, color: '#dddddd' }, { kind: 'aurora', size: 0.8, color: '#66ffaa' }, { kind: 'planet', size: 0.1, color: '#ff0000' }]).amount).toBe(0);
  });

  it('comes from a second sun first, then from a planet that fills the sky', () => {
    const sun = skyCastFor([{ kind: 'ringed_planet', size: 0.6, color: '#c9a060' }, { kind: 'second_sun', size: 0.5, color: '#ff5030' }]);
    expect(sun.color).toBe('#ff5030');
    expect(sun.amount).toBeGreaterThan(0.3);
    expect(sun.amount).toBeLessThanOrEqual(0.6);
    const planet = skyCastFor([{ kind: 'ringed_planet', size: 0.6, color: 'c9a060' }]);
    expect(planet.color).toBe('#c9a060');
    expect(planet.amount).toBeGreaterThan(0);
    expect(planet.amount).toBeLessThan(sun.amount);
    expect(skyCastFor([{ kind: 'second_sun', size: 0.5, color: 'red' }]).amount).toBe(0);
  });

  it('leaves a look untouched at 0 and moves the horizon and the fog towards the hue above it', () => {
    const base = skyLookFor('day', 13);
    const same = skyLookFor('day', 13);
    castSkyLook(same, 'day', 13, new Color('#ff5030'), 0);
    expect(same.fog.getHex()).toBe(base.fog.getHex());
    expect(same.hazeHorizonAlpha).toBe(base.hazeHorizonAlpha);

    const cast = skyLookFor('day', 13);
    castSkyLook(cast, 'day', 13, new Color('#ff5030'), 0.5);
    expect(cast.fog.r / cast.fog.b).toBeGreaterThan(base.fog.r / base.fog.b);
    expect(cast.hazeHorizonColor.r / cast.hazeHorizonColor.b).toBeGreaterThan(base.hazeHorizonColor.r / base.hazeHorizonColor.b);
    // The brightness is kept, bar what the cap on a saturated channel takes off.
    expect(lum(cast.hazeHorizonColor) / lum(base.hazeHorizonColor)).toBeGreaterThan(0.95);
    expect(lum(cast.hazeHorizonColor) / lum(base.hazeHorizonColor)).toBeLessThanOrEqual(1 + 1e-9);
    expect(cast.hazeTopAlpha).toBeGreaterThan(base.hazeTopAlpha - 1e-9);
    expect(cast.hazeTopAlpha).toBeLessThanOrEqual(1);
  });
});

describe('cloud forms', () => {
  it('are the same for the same seed and differ between worlds', () => {
    const a = cloudLookFor(CLOUD_FORMS.clear, 1234);
    expect(cloudLookFor(CLOUD_FORMS.clear, 1234)).toEqual(a);
    const seen = new Set<string>();
    for (let seed = 1; seed < 30; seed++) seen.add(cloudLookFor(CLOUD_FORMS.clear, seed).scale.toFixed(8));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('keep every value where the shader can use it, whatever comes in', () => {
    const forms = [...Object.values(CLOUD_FORMS), { size: Number.NaN, density: -4, elevation: 9, stretch: 1e9 }];
    for (const form of forms) {
      for (let seed = 0; seed < 12; seed++) {
        const c = cloudLookFor(form, seed);
        expect(c.scale).toBeGreaterThan(0);
        expect(Number.isFinite(c.scale)).toBe(true);
        expect(c.density).toBeGreaterThan(0);
        expect(c.elevation).toBeGreaterThanOrEqual(0.1);
        expect(c.elevation).toBeLessThanOrEqual(0.9);
        // A stretch squeezes the other axis by as much, so the cover is unchanged.
        expect(c.stretchX * c.stretchZ).toBeCloseTo(1, 9);
      }
    }
  });

  it('follow the weather: storm cloud is bigger, more solid and lower than fair, dust thin, high and banded', () => {
    const fair = cloudFormFor({ weather: 'clear', intensity: 0 });
    const storm = cloudFormFor({ weather: 'storm', intensity: 1 });
    const dust = cloudFormFor({ weather: 'dust', intensity: 1 });
    expect(fair).toEqual(CLOUD_FORMS.clear);
    expect(cloudFormFor({ weather: 'storm', intensity: 0 })).toEqual(CLOUD_FORMS.clear);
    expect(storm.size).toBeGreaterThan(fair.size);
    expect(storm.density).toBeGreaterThan(fair.density);
    expect(storm.elevation).toBeGreaterThan(fair.elevation);
    expect(dust.density).toBeLessThan(fair.density);
    expect(dust.elevation).toBeLessThan(fair.elevation);
    expect(dust.stretch).toBeGreaterThan(2);
    const half = cloudFormFor({ weather: 'storm', intensity: 0.5 });
    expect(half.size).toBeCloseTo((fair.size + storm.size) / 2, 9);
  });

  it('still finds the Sky shader line the stretch is multiplied into', () => {
    const src = readFileSync('node_modules/three/examples/jsm/objects/Sky.js', 'utf8');
    expect(src).toContain(CLOUD_UV_MARKER);
  });
});
