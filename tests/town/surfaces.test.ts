import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import {
  SURFACE_KINDS, disposeSurfaces, getSurface, glassMaterial, glowPixels, groundMaterial, inferSurfaces, patchGroundShader,
  resolveSurfaces, roadMaterial, setCanvasFactory, setWindowGlow, surfacePixels, surfaceScale, surfaceTexel,
} from '../../app/src/town/surfaces';
import type { CanvasLike, SurfaceId } from '../../app/src/town/surfaces';
import { fbm, makeCell, vnoise, worley } from '../../app/src/town/surfaces/noise';
import { projectWorldUV } from '../../app/src/town/surfaces/uv';
import type { StyleSpec, SurfaceKind } from '../../app/src/world/spec';
import { STYLE } from './helpers';

const ALL_KINDS: SurfaceKind[] = [
  'timber', 'planks', 'log', 'plaster', 'adobe', 'brick', 'stone', 'cobble', 'concrete',
  'metal_panel', 'corrugated', 'rusted', 'hull_plate', 'glass_curtain',
  'shingle', 'tile', 'thatch', 'slate', 'canvas', 'paper_screen',
  'organic', 'bark', 'chitin', 'crystal', 'ice', 'coral',
  'dirt', 'sand', 'grass', 'moss', 'snow', 'mud', 'asphalt', 'gravel', 'regolith', 'ash',
];
const EVERY: SurfaceId[] = [...ALL_KINDS, 'paint'];

afterAll(() => {
  setCanvasFactory(null);
  disposeSurfaces();
});

describe('noise', () => {
  it('value noise and fbm stay in range and wrap on the unit square', () => {
    for (let i = 0; i < 50; i++) {
      const u = i / 50;
      const n = vnoise(u, 0.37, 8, 5, 3);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(vnoise(u, 0, 8, 5, 3)).toBeCloseTo(vnoise(u, 1, 8, 5, 3), 9);
      expect(vnoise(0, u, 8, 5, 3)).toBeCloseTo(vnoise(1, u, 8, 5, 3), 9);
      expect(fbm(u, 0, 4, 4, 4, 9)).toBeCloseTo(fbm(u, 1, 4, 4, 4, 9), 9);
    }
  });

  it('worley wraps and orders its two distances', () => {
    const a = makeCell();
    const b = makeCell();
    for (let i = 0; i < 40; i++) {
      const v = i / 40;
      worley(0, v, 6, 6, 5, 1, a);
      worley(1, v, 6, 6, 5, 1, b);
      expect(a.f1).toBeCloseTo(b.f1, 9);
      expect(a.id).toBe(b.id);
      expect(a.f2).toBeGreaterThanOrEqual(a.f1);
    }
  });
});

/**
 * Mean absolute step between two neighbouring lines of texels: across the wrap, and the largest such
 * step between any two lines inside the tile (a course joint, a seam), for one channel and axis.
 */
function seam(px: Uint8ClampedArray, size: number, channel: number, axis: 'u' | 'v'): { worst: number; wrap: number } {
  const at = (x: number, y: number): number => px[(y * size + x) * 4 + channel] as number;
  const line = (j0: number, j1: number): number => {
    let s = 0;
    for (let k = 0; k < size; k++) s += Math.abs(axis === 'u' ? at(j1, k) - at(j0, k) : at(k, j1) - at(k, j0));
    return s / size;
  };
  let worst = 0;
  for (let j = 0; j + 1 < size; j++) worst = Math.max(worst, line(j, j + 1));
  return { worst, wrap: line(size - 1, 0) };
}

describe('surface pixels', () => {
  it('the library covers every SurfaceKind in the spec', () => {
    expect([...SURFACE_KINDS].sort()).toEqual([...ALL_KINDS].sort());
    for (const k of EVERY) expect(surfaceScale(k)).toBeGreaterThan(0.5);
  });

  for (const kind of EVERY) {
    it(`${kind}: varied, tileable and deterministic by seed`, () => {
      const size = 128;
      const opts = { wear: 0.6, wet: 0.3, size, seed: 4 };
      const a = surfacePixels(kind, '#9a7b5c', opts);
      expect(a.albedo.length).toBe(size * size * 4);
      // not constant: albedo, height and normal all carry detail
      for (const [map, channel, least] of [[a.albedo, 0, 8], [a.data, 0, 8], [a.normal, 0, 3]] as const) {
        let lo = 255;
        let hi = 0;
        for (let i = channel; i < map.length; i += 4) {
          lo = Math.min(lo, map[i] as number);
          hi = Math.max(hi, map[i] as number);
        }
        expect(hi - lo).toBeGreaterThan(least);
      }
      // normals are unit length and face outward
      for (let i = 0; i < a.normal.length; i += 4 * 37) {
        const n = [0, 1, 2].map((c) => (a.normal[i + c] as number) / 127.5 - 1) as [number, number, number];
        expect(Math.hypot(n[0], n[1], n[2])).toBeGreaterThan(0.97);
        expect(n[2]).toBeGreaterThan(0.2);
      }
      // tileable: every texel on the far edge of the next tile is the texel on the near edge of this one
      for (let k = 0; k < size; k += 3) {
        const p = (k + 0.5) / size;
        const edge = 0.5 / size;
        for (const [u, v, du, dv] of [[edge, p, 1, 0], [p, edge, 0, 1], [p, 1 - edge, 0, -1], [1 - edge, p, -1, 0]] as const) {
          const here = surfaceTexel(kind, '#9a7b5c', u, v, opts);
          const there = surfaceTexel(kind, '#9a7b5c', u + du, v + dv, opts);
          for (const key of ['h', 'r', 'g', 'b', 'rough', 'metal'] as const) expect(Math.abs(here[key] - there[key])).toBeLessThan(1e-6);
        }
      }
      // and in the packed maps the step across the wrap is no rougher than the roughest line inside the tile
      for (const map of [a.albedo, a.data]) {
        for (const axis of ['u', 'v'] as const) {
          const s = seam(map, size, 1, axis);
          expect(s.wrap).toBeLessThanOrEqual(s.worst * 1.5 + 6);
        }
      }
      // deterministic for a seed, different for another
      const b = surfacePixels(kind, '#9a7b5c', opts);
      expect(Buffer.from(b.albedo.buffer).equals(Buffer.from(a.albedo.buffer))).toBe(true);
      expect(Buffer.from(b.normal.buffer).equals(Buffer.from(a.normal.buffer))).toBe(true);
      const c = surfacePixels(kind, '#9a7b5c', { ...opts, seed: 5 });
      expect(Buffer.from(c.albedo.buffer).equals(Buffer.from(a.albedo.buffer))).toBe(false);
    });
  }

  it('follows the base colour, darkens and glosses when wet, and wears', () => {
    const mean = (px: Uint8ClampedArray, channel: number): number => {
      let s = 0;
      for (let i = channel; i < px.length; i += 4) s += px[i] as number;
      return s / (px.length / 4);
    };
    for (const kind of ['timber', 'brick', 'plaster', 'corrugated', 'shingle', 'dirt', 'asphalt'] as const) {
      const o = { wear: 0, wet: 0, size: 64, seed: 1 };
      const red = surfacePixels(kind, '#b04030', o);
      const blue = surfacePixels(kind, '#3050b0', o);
      expect(mean(red.albedo, 0)).toBeGreaterThan(mean(red.albedo, 2) + 20);
      expect(mean(blue.albedo, 2)).toBeGreaterThan(mean(blue.albedo, 0) + 20);
      // the clean tile keeps close to the colour it was asked for
      expect(mean(red.albedo, 0)).toBeGreaterThan(0xb0 * 0.72);
      expect(mean(red.albedo, 0)).toBeLessThan(0xb0 * 1.2);
      const wet = surfacePixels(kind, '#b04030', { ...o, wet: 1 });
      expect(mean(wet.albedo, 0)).toBeLessThan(mean(red.albedo, 0) - 3);
      expect(mean(wet.data, 1)).toBeLessThan(mean(red.data, 1) - 20);
      const worn = surfacePixels(kind, '#b04030', { ...o, wear: 1 });
      expect(Buffer.from(worn.albedo.buffer).equals(Buffer.from(red.albedo.buffer))).toBe(false);
    }
  });

  it('corrugated sheet has sixteen ridges across the tile in its normal map', () => {
    const size = 128;
    const px = surfacePixels('corrugated', '#8a8f94', { wear: 0, wet: 0, size, seed: 2 });
    const row = 64;
    let flips = 0;
    let prev = 0;
    for (let x = 0; x < size; x++) {
      const nx = (px.normal[(row * size + x) * 4] as number) - 127.5;
      const sign = nx > 6 ? 1 : nx < -6 ? -1 : 0;
      if (sign !== 0 && prev !== 0 && sign !== prev) flips++;
      if (sign !== 0) prev = sign;
    }
    expect(flips).toBeGreaterThanOrEqual(30);
    expect(flips).toBeLessThanOrEqual(34);
  });

  it('the window glow map is warm and uneven', () => {
    const px = glowPixels(32);
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < px.length; i += 4) {
      lo = Math.min(lo, px[i] as number);
      hi = Math.max(hi, px[i] as number);
      expect(px[i] as number).toBeGreaterThanOrEqual(px[i + 2] as number);
    }
    expect(hi - lo).toBeGreaterThan(60);
  });
});

describe('getSurface', () => {
  const opts = { wear: 0.4, wet: 0, quality: 0 as const, seed: 0 };

  it('builds a cached, correctly configured material for every kind without a DOM', { timeout: 60000 }, () => {
    expect(typeof document).toBe('undefined');
    for (const kind of ALL_KINDS) {
      const m = getSurface(kind, '#8a6f55', opts);
      expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(getSurface(kind, '#8a6f55', opts)).toBe(m);
      const map = m.map as THREE.Texture;
      const normal = m.normalMap as THREE.Texture;
      const data = m.roughnessMap as THREE.Texture;
      expect(m.metalnessMap).toBe(data);
      expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(normal.colorSpace).toBe(THREE.NoColorSpace);
      expect(data.colorSpace).toBe(THREE.NoColorSpace);
      for (const t of [map, normal, data]) {
        expect(t.wrapS).toBe(THREE.RepeatWrapping);
        expect(t.wrapT).toBe(THREE.RepeatWrapping);
        expect(t.anisotropy).toBe(8);
        expect(t.flipY).toBe(false);
        expect(t.generateMipmaps).toBe(true);
        expect((t.image as { width: number }).width).toBe(256);
      }
      expect(m.vertexColors).toBe(false);
    }
    disposeSurfaces();
  });

  it('shares maps between the plain and tinted variants and separates colours, wear and quality', () => {
    const plain = getSurface('brick', '#a04030', opts);
    const tinted = getSurface('brick', '#a04030', { ...opts, tint: true });
    expect(tinted).not.toBe(plain);
    expect(tinted.vertexColors).toBe(true);
    expect(tinted.map).toBe(plain.map);
    expect(getSurface('brick', '#a04031', opts).map).not.toBe(plain.map);
    expect(getSurface('brick', '#a04030', { ...opts, wear: 0.9 }).map).not.toBe(plain.map);
    expect(getSurface('brick', '#a04030', { ...opts, wear: 0.41 })).toBe(plain);
    expect(getSurface('brick', 'not a colour', opts)).toBe(getSurface('brick', '#808080', opts));
    disposeSurfaces();
    expect(getSurface('brick', '#a04030', opts)).not.toBe(plain);
    disposeSurfaces();
  });

  it('uploads through an injected canvas factory', () => {
    const made: { size: number; put: number; bytes: number }[] = [];
    setCanvasFactory((size): CanvasLike => {
      const rec = { size, put: 0, bytes: 0 };
      made.push(rec);
      return {
        width: size,
        height: size,
        getContext: () => ({
          createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: (img) => {
            rec.put++;
            rec.bytes = img.data.length;
          },
        }),
      };
    });
    const m = getSurface('stone', '#777777', opts);
    expect(made).toHaveLength(3);
    for (const c of made) {
      expect(c.size).toBe(256);
      expect(c.put).toBe(1);
      expect(c.bytes).toBe(256 * 256 * 4);
    }
    expect(m.map).toBeInstanceOf(THREE.CanvasTexture);
    expect((m.map as THREE.Texture).flipY).toBe(false);
    setCanvasFactory(null);
    disposeSurfaces();
  });
});

describe('glass, ground and roads', () => {
  it('window glass is dark, glossy and glows by setWindowGlow', () => {
    const g = glassMaterial('#6f9bb8', '#ffd27a');
    expect(glassMaterial('#6f9bb8', '#ffd27a')).toBe(g);
    expect(g.roughness).toBeLessThan(0.15);
    expect(g.emissiveMap).not.toBeNull();
    setWindowGlow(0);
    expect(g.emissiveIntensity).toBe(0);
    setWindowGlow(1);
    const full = g.emissiveIntensity;
    expect(full).toBeGreaterThan(1);
    setWindowGlow(0.5);
    expect(g.emissiveIntensity).toBeCloseTo(full / 2);
    expect(glassMaterial('#203040', '#ffd27a').emissiveIntensity).toBeCloseTo(full / 2);
    setWindowGlow(0.2);
    disposeSurfaces();
  });

  it('ground and road materials are textured, world-sampled and layered', () => {
    const surfaces = inferSurfaces(STYLE, 'western');
    const ground = groundMaterial(surfaces, STYLE, { quality: 0 });
    expect(groundMaterial(surfaces, STYLE, { quality: 0 })).toBe(ground);
    expect(ground.map).not.toBeNull();
    expect(ground.normalMap).not.toBeNull();
    expect(ground.vertexColors).toBe(false);
    expect(ground.userData.baseHex).toBe(STYLE.ground);
    expect(ground.polygonOffset).toBe(false);
    const road = roadMaterial(surfaces, STYLE, { quality: 0 });
    const track = roadMaterial(surfaces, STYLE, { quality: 0, variant: 'track' });
    const plaza = roadMaterial(surfaces, STYLE, { quality: 0, variant: 'plaza' });
    expect(new Set([ground, road, track, plaza]).size).toBe(4);
    expect(road.polygonOffset).toBe(true);
    expect(plaza.polygonOffsetFactor).toBeLessThan(road.polygonOffsetFactor);
    expect(road.userData.baseHex).toBe(STYLE.road);
    disposeSurfaces();
  });

  it('the ground shader patch finds every anchor in the standard material shader', () => {
    const lib = THREE.ShaderLib.standard;
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    patchGroundShader(shader, 4, 0.8);
    expect(shader.uniforms.uTile?.value).toBeCloseTo(0.25);
    expect(shader.uniforms.uWet?.value).toBe(0.8);
    expect(shader.vertexShader).toContain('vMapUv = vGroundXZ * uTile;');
    expect(shader.vertexShader).toContain('vNormalMapUv = vGroundXZ * uTile;');
    expect(shader.vertexShader.match(/varying vec2 vGroundXZ;/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/varying vec2 vGroundXZ;/g)).toHaveLength(1);
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= 0.8 + 0.4 * gMacro;');
    expect(shader.fragmentShader).toContain('roughnessFactor = mix( roughnessFactor, 0.03, gPuddle );');
    expect(shader.fragmentShader).toContain('mix( normal, nonPerturbedNormal, gPuddle )');
    // the names the patch relies on exist in this three.js version
    const chunk = THREE.ShaderChunk;
    expect(chunk.uv_vertex).toContain('vMapUv');
    expect(chunk.uv_vertex).toContain('vRoughnessMapUv');
    expect(chunk.uv_vertex).toContain('vMetalnessMapUv');
    expect(chunk.roughnessmap_fragment).toContain('texelRoughness');
    expect(chunk.normal_fragment_begin).toContain('nonPerturbedNormal');
    expect(chunk.map_fragment).toContain('diffuseColor *= sampledDiffuseColor');
    // the hook is wired on the material
    const m = groundMaterial(inferSurfaces(STYLE, 'western'), STYLE, { quality: 0 });
    const live = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    (m.onBeforeCompile as unknown as (s: typeof live) => void)(live);
    expect(live.vertexShader).toContain('vGroundXZ');
    disposeSurfaces();
  });
});

describe('inferSurfaces', () => {
  const style = (name: string, ground = '#8a7a5a'): StyleSpec => ({ ...STYLE, name, ground });

  it('reads materials from six style names', () => {
    const frontier = inferSurfaces(style('weathered frontier timber'), 'western');
    expect(frontier).toMatchObject({ wall: 'planks', roof: 'shingle', ground: 'dirt', road: 'dirt' });
    expect(frontier.wear).toBeGreaterThan(0.5);

    const mushroom = inferSurfaces(style('bioluminescent mushroom forest'), 'medieval', { weather: 'spores', intensity: 0.6, grade: 'verdant', haze: 0.7, ambience: [], music: '' });
    expect(mushroom).toMatchObject({ wall: 'organic', ground: 'moss' });
    expect(mushroom.wet).toBe(0);

    const neon = inferSurfaces(style('rain-slick neon arcology', '#23262b'), 'scifi', { weather: 'rain', intensity: 0.8, grade: 'neon_noir', haze: 0.5, ambience: [], music: '' });
    expect(neon).toMatchObject({ wall: 'metal_panel', road: 'concrete' });
    expect(neon.wet).toBeGreaterThan(0.6);

    const monastery = inferSurfaces(style('snowbound stone monastery', '#e8edf2'), 'medieval', { weather: 'snow', intensity: 0.7, grade: 'cold_steel', haze: 0.3, ambience: [], music: '' });
    expect(monastery).toMatchObject({ wall: 'stone', roof: 'slate', ground: 'snow', road: 'cobble' });

    const camp = inferSurfaces(style('desert nomad camp at dusk', '#d9b77a'), 'western');
    expect(camp).toMatchObject({ wall: 'canvas', roof: 'canvas', ground: 'sand' });

    const port = inferSurfaces(style('rusted container port'), 'modern');
    expect(port).toMatchObject({ wall: 'corrugated', wall2: 'rusted', road: 'asphalt' });
    expect(port.wear).toBeGreaterThan(0.5);

    const edo = inferSurfaces(style('lacquered Edo townhouse'), 'medieval');
    expect(edo).toMatchObject({ wall: 'plaster', wall2: 'paper_screen', roof: 'tile' });
    expect(edo.wear).toBeLessThan(0.3);
  });

  it('falls back to the theme, then lets the ground colour speak', () => {
    for (const theme of ['western', 'medieval', 'scifi', 'modern'] as const) {
      const s = inferSurfaces(style('zzz'), theme);
      for (const k of [s.wall, s.wall2, s.roof, s.trim, s.ground, s.road]) expect(ALL_KINDS).toContain(k);
      expect(s.wear).toBeGreaterThanOrEqual(0);
      expect(s.wet).toBe(0);
    }
    expect(inferSurfaces(style('zzz', '#5f8a3c'), 'western').ground).toBe('grass');
    expect(inferSurfaces(style('zzz', '#f0f3f6'), 'western').ground).toBe('snow');
  });

  it('resolveSurfaces keeps valid authored fields and repairs the rest', () => {
    const authored = { wall: 'brick', wall2: 'nonsense', roof: 'slate', trim: 'stone', ground: 'gravel', road: 'cobble', wear: 7, wet: Number.NaN };
    const s = resolveSurfaces({ ...style('weathered frontier timber'), surfaces: authored as unknown as StyleSpec['surfaces'] }, 'western');
    expect(s).toMatchObject({ wall: 'brick', wall2: 'timber', roof: 'slate', ground: 'gravel', wear: 1, wet: 0 });
    expect(resolveSurfaces(style('weathered frontier timber'), 'western')).toEqual(inferSurfaces(style('weathered frontier timber'), 'western'));
  });
});

describe('projectWorldUV', () => {
  it('maps a box in metres: walls by run and height, flats by x and z', () => {
    const g = new THREE.BoxGeometry(4, 3, 2).toNonIndexed();
    g.translate(0, 1.5, 0);
    projectWorldUV(g, 2);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const range = { wallU: [Infinity, -Infinity], wallV: [Infinity, -Infinity], sideU: [Infinity, -Infinity] } as Record<string, [number, number]>;
    const grow = (r: [number, number] | undefined, v: number): void => {
      if (!r) return;
      r[0] = Math.min(r[0], v);
      r[1] = Math.max(r[1], v);
    };
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      // v is height on every wall, so courses are level all the way round
      const tri = Math.floor(i / 3) * 3;
      const zs = [0, 1, 2].map((k) => pos.getZ(tri + k));
      const xs = [0, 1, 2].map((k) => pos.getX(tri + k));
      const ys = [0, 1, 2].map((k) => pos.getY(tri + k));
      const front = zs.every((v) => Math.abs(v - 1) < 1e-6);
      const side = xs.every((v) => Math.abs(v - 2) < 1e-6);
      const topFace = ys.every((v) => Math.abs(v - 3) < 1e-6);
      if (front) {
        expect(uv.getY(i)).toBeCloseTo(y / 2, 6);
        grow(range.wallU, uv.getX(i));
        grow(range.wallV, uv.getY(i));
      }
      if (side) {
        expect(uv.getY(i)).toBeCloseTo(y / 2, 6);
        grow(range.sideU, uv.getX(i));
      }
      if (topFace) {
        expect(uv.getX(i)).toBeCloseTo(x / 2, 6);
        expect(uv.getY(i)).toBeCloseTo(z / 2, 6);
      }
    }
    expect((range.wallU as [number, number])[1] - (range.wallU as [number, number])[0]).toBeCloseTo(4 / 2, 6);
    expect((range.wallV as [number, number])[1] - (range.wallV as [number, number])[0]).toBeCloseTo(3 / 2, 6);
    expect((range.sideU as [number, number])[1] - (range.sideU as [number, number])[0]).toBeCloseTo(2 / 2, 6);
    g.dispose();
  });

  it('runs v up a roof slope at true length', () => {
    // one roof plane rising 3 over a run of 4: slope length 5
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 4, 6, 0, 4, 6, 3, 0, 0, 0, 4, 6, 3, 0, 0, 3, 0]), 3));
    projectWorldUV(g, 1);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      lo = Math.min(lo, uv.getY(i));
      hi = Math.max(hi, uv.getY(i));
      if (pos.getY(i) === 3) expect(uv.getY(i)).toBeGreaterThan(uv.getY(0));
    }
    expect(hi - lo).toBeCloseTo(5, 5);
    g.dispose();
  });
});
