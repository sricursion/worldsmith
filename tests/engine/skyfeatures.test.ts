import { afterEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { Mesh, ShaderMaterial } from 'three';
import {
  BODY_LEVEL_NIGHT,
  ECLIPSE_KEY_DIM,
  MAX_SKY_FEATURES,
  bodyLevel,
  boltAt,
  createSkyFeatures,
  featureAngularRadius,
  featurePlacement,
  islandGeometry,
  litFraction,
  secondSunDirection,
  skyDirection,
} from '../../app/src/engine/skyfeatures';
import { AIR } from '../../app/src/engine/post';
import { SKY_FEATURE_KINDS } from '../../app/src/world/schema';
import type { SkyFeature } from '../../app/src/world/spec';

const deg = (r: number): number => (r * 180) / Math.PI;

function make(features: SkyFeature[] | undefined, seed = 7, sun = new Vector3(0.3, 0.6, -0.4).normalize(), daylight = 1) {
  const scene = new Scene();
  const rig = createSkyFeatures(scene, features, { sunDir: () => sun, daylight: () => daylight, seed });
  return { scene, rig };
}

afterEach(() => {
  AIR.keyDim = 1;
  AIR.rigMoon = true;
});

describe('sky feature placement', () => {
  it('maps apparent size to an angle: our moon a few degrees, a huge one over twenty across', () => {
    expect(deg(featureAngularRadius(0.08))).toBeGreaterThan(2);
    expect(deg(featureAngularRadius(0.08))).toBeLessThan(3.5);
    expect(deg(featureAngularRadius(0.4)) * 2).toBeGreaterThan(20);
    expect(featureAngularRadius(5)).toBe(featureAngularRadius(1));
    expect(featureAngularRadius(Number.NaN)).toBe(featureAngularRadius(0));
  });

  it('is the same for the same seed and keeps bodies above the horizon, planets low enough to be in frame', () => {
    for (let seed = 1; seed < 40; seed += 3) {
      expect(featurePlacement('ringed_planet', 0, seed).elevationDeg).toBeLessThanOrEqual(30);
      expect(featurePlacement('planet', 0, seed).elevationDeg).toBeLessThanOrEqual(32);
    }
    for (const kind of ['moon', 'planet', 'ringed_planet', 'comet', 'nebula'] as const) {
      for (let seed = 1; seed < 40; seed += 3) {
        const a = featurePlacement(kind, 0, seed);
        expect(featurePlacement(kind, 0, seed)).toEqual(a);
        expect(a.elevationDeg, kind).toBeGreaterThanOrEqual(13);
        expect(a.elevationDeg, kind).toBeLessThanOrEqual(66);
        expect(a.azimuthDeg).toBeGreaterThanOrEqual(0);
        expect(a.azimuthDeg).toBeLessThan(360);
      }
    }
  });

  it('keeps two features of one world apart in the sky', () => {
    for (let seed = 1; seed < 60; seed += 7) {
      const a = featurePlacement('moon', 0, seed);
      const b = featurePlacement('planet', 1, seed);
      const c = featurePlacement('moon', 2, seed);
      const da = skyDirection(a.elevationDeg, a.azimuthDeg, new Vector3());
      const db = skyDirection(b.elevationDeg, b.azimuthDeg, new Vector3());
      const dc = skyDirection(c.elevationDeg, c.azimuthDeg, new Vector3());
      expect(deg(da.angleTo(db)), `seed ${seed}`).toBeGreaterThan(40);
      expect(deg(db.angleTo(dc)), `seed ${seed}`).toBeGreaterThan(40);
    }
  });

  it('uses the sun rig compass: north is -Z, east is +X', () => {
    expect(skyDirection(0, 90, new Vector3()).x).toBeCloseTo(1, 6);
    expect(skyDirection(0, 0, new Vector3()).z).toBeCloseTo(-1, 6);
    expect(skyDirection(90, 0, new Vector3()).y).toBeCloseTo(1, 6);
  });
});

describe('sky feature light', () => {
  it('gives a body opposite the sun a full disc and one beside the sun none', () => {
    const sun = new Vector3(0, 0.2, 1).normalize();
    expect(litFraction(sun.clone().negate(), sun)).toBeCloseTo(1, 6);
    expect(litFraction(sun.clone(), sun)).toBeCloseTo(0, 6);
    expect(litFraction(new Vector3(1, 0, 0), new Vector3(0, 0, 1))).toBeCloseTo(0.5, 6);
  });

  it('holds a body bright at night and ties it to the sky by day', () => {
    expect(bodyLevel(0, 0.02)).toBe(BODY_LEVEL_NIGHT);
    expect(bodyLevel(1, 2)).toBeCloseTo(1, 6);
    expect(bodyLevel(1, 0)).toBeGreaterThan(0);
    expect(bodyLevel(0.5, 2)).toBeLessThan(BODY_LEVEL_NIGHT);
  });

  it('sets a second sun with the first', () => {
    const out = new Vector3();
    const noon = new Vector3(0.2, 0.9, -0.3).normalize();
    expect(secondSunDirection(noon, 0.6, out).y).toBeGreaterThan(0.5);
    expect(out.length()).toBeCloseTo(1, 6);
    expect(deg(out.angleTo(noon))).toBeGreaterThan(8);
    const set = new Vector3(-0.9, -0.2, 0.1).normalize();
    expect(secondSunDirection(set, 0.6, out).y).toBeLessThan(0);
  });

  it('strikes in two pulses and dies out', () => {
    expect(boltAt(-1)).toBe(0);
    expect(boltAt(0)).toBeCloseTo(1, 6);
    expect(boltAt(0.15)).toBeGreaterThan(boltAt(0.13));
    expect(boltAt(1.5)).toBeLessThan(0.01);
  });
});

describe('island geometry', () => {
  it('is flat on top, tapers underneath and holds no bad numbers', () => {
    const geo = islandGeometry(11);
    const pos = geo.getAttribute('position');
    let top = -Infinity;
    let bottom = Infinity;
    let widthTop = 0;
    let widthLow = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      expect(Number.isFinite(x + y + z)).toBe(true);
      top = Math.max(top, y);
      bottom = Math.min(bottom, y);
      if (y > -0.05) widthTop = Math.max(widthTop, Math.hypot(x, z));
    }
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < bottom * 0.7) widthLow = Math.max(widthLow, Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    expect(top).toBeLessThan(0.4);
    expect(bottom).toBeLessThan(-0.6);
    expect(widthTop).toBeGreaterThan(0.7);
    expect(widthLow).toBeLessThan(widthTop * 0.6);
    geo.dispose();
  });
});

describe('createSkyFeatures', () => {
  it('adds nothing for a plain sky', () => {
    for (const features of [undefined, []]) {
      const { scene, rig } = make(features);
      expect(scene.children).toHaveLength(0);
      rig.update(0.016, new PerspectiveCamera());
      rig.dispose();
    }
    expect(AIR.keyDim).toBe(1);
    expect(AIR.rigMoon).toBe(true);
  });

  it('builds every kind, follows the camera and cleans up', () => {
    for (const kind of SKY_FEATURE_KINDS) {
      const { scene, rig } = make([{ kind, size: 0.3, color: '#88aacc' }]);
      expect(scene.children, kind).toHaveLength(1);
      const group = scene.children[0];
      expect(group?.children.length, kind).toBeGreaterThan(0);
      const camera = new PerspectiveCamera();
      camera.position.set(40, 3, -25);
      camera.updateMatrixWorld();
      for (let i = 0; i < 5; i++) rig.update(0.05, camera);
      expect(group?.position.x).toBeCloseTo(40, 6);
      expect(group?.position.z).toBeCloseTo(-25, 6);
      group?.traverse((o) => {
        expect(Number.isFinite(o.position.lengthSq()), kind).toBe(true);
        expect(o.castShadow).toBe(false);
        const m = (o as Mesh).material as ShaderMaterial | undefined;
        // Nothing at sky distance may write depth: the air pass must go on treating those pixels as sky.
        // Islands are the exception: solid things a few hundred metres off, fogged as land is.
        if (m !== undefined) expect(m.depthWrite, kind).toBe(kind === 'floating_islands');
      });
      rig.dispose();
      expect(scene.children, kind).toHaveLength(0);
      rig.dispose();
    }
  });

  it('takes the moon over from the sky rig and gives it back', () => {
    const { rig } = make([{ kind: 'moon', size: 0.08, color: '#e8e0d0' }, { kind: 'moon', size: 0.05, color: '#9a8a7c' }]);
    expect(AIR.rigMoon).toBe(false);
    rig.dispose();
    expect(AIR.rigMoon).toBe(true);
  });

  it('stands the first moon where the moonlight comes from', () => {
    const { scene, rig } = make([{ kind: 'moon', size: 0.08, color: '#e8e0d0' }], 3, new Vector3(0, -0.6, 0.8), 0);
    AIR.moonDir.set(0.5, 0.5, -0.7).normalize();
    rig.update(0.016, new PerspectiveCamera());
    const pivot = scene.children[0]?.children[0];
    expect(pivot?.position.clone().normalize().distanceTo(AIR.moonDir)).toBeLessThan(1e-6);
    rig.dispose();
  });

  it('dims the key under an eclipse and restores it', () => {
    const { rig } = make([{ kind: 'eclipse', size: 0.3, color: '#ffe9c8' }]);
    expect(AIR.keyDim).toBe(ECLIPSE_KEY_DIM);
    rig.dispose();
    expect(AIR.keyDim).toBe(1);
  });

  it('caps the count and ignores junk', () => {
    const many = Array.from({ length: 9 }, (): SkyFeature => ({ kind: 'comet', size: 0.2, color: 'not-a-colour' }));
    const { scene, rig } = make([...many, null as unknown as SkyFeature]);
    expect(scene.children[0]?.children).toHaveLength(MAX_SKY_FEATURES);
    rig.dispose();
  });
});
