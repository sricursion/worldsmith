import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MAX_SURFACE_SATURATION, SURFACE_KINDS, disposeSurfaces, getSurface, groundRequests, groundTone, groundedPalette, patchSurfaceShader,
  signTone, surfacePixels, warmSurfaces,
} from '../../app/src/town/surfaces';
import type { SurfaceId, SurfaceRequest } from '../../app/src/town/surfaces';
import { townSurfaceRequests } from '../../app/src/town/blueprint-mesh';
import type { StyleSpec, SurfaceKind, SurfaceSet } from '../../app/src/world/spec';
import { STYLE } from './helpers';

afterAll(() => disposeSurfaces());

const hsl = (hex: string): { h: number; s: number; l: number } => {
  const c = new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
  return { h: c.h * 360, s: c.s, l: c.l };
};
const set = (over: Partial<SurfaceSet> = {}): SurfaceSet => ({ wall: 'planks', wall2: 'concrete', roof: 'tile', trim: 'stone', ground: 'grass', road: 'asphalt', wear: 0.3, wet: 0, ...over });
const NEON: StyleSpec = {
  ...STYLE, wall: '#ff7a00', wall2: '#8c8c8a', roof: '#ff2020', trim: '#00ff66', accent: '#ffe600', dark: '#3030ff', glass: '#00ffff', glow: '#ff00ff', ground: '#00ff00', road: '#ff00aa',
};
const TONES = ['wall', 'wall2', 'roof', 'trim', 'accent', 'dark', 'glass', 'ground', 'road'] as const;

describe('groundedPalette', () => {
  it('pulls a neon-orange timber wall into the range of timber and leaves grey concrete alone', () => {
    const out = groundedPalette(NEON, set());
    const wall = hsl(out.wall);
    expect(hsl(NEON.wall).s).toBeGreaterThan(0.95);
    expect(wall.h).toBeGreaterThanOrEqual(13);
    expect(wall.h).toBeLessThanOrEqual(47);
    expect(wall.s).toBeLessThanOrEqual(0.42);
    expect(wall.l).toBeGreaterThan(0.1);
    expect(wall.l).toBeLessThan(0.8);
    expect(out.wall2).toBe('#8c8c8a');
    // on a new building, colours that were already natural are not moved
    const calm: StyleSpec = { ...STYLE, wall: '#7a5a3e', wall2: '#9a9a96', roof: '#8a4a38', trim: '#8c8880', ground: '#4f6a34', road: '#3a3a3c', dark: '#2a2420' };
    const kept = groundedPalette(calm, set({ wear: 0 }));
    for (const key of ['wall', 'wall2', 'roof', 'trim', 'ground', 'road', 'dark'] as const) expect(kept[key]).toBe(calm[key]);
  });

  it('holds every surface under the saturation limit, whatever the kind, and never touches glow', () => {
    for (const kind of SURFACE_KINDS) {
      for (const wear of [0, 0.5, 1]) {
        const out = groundedPalette(NEON, set({ wall: kind, wall2: kind, roof: kind, trim: kind, ground: kind, road: kind, wear }));
        for (const key of TONES) {
          expect(out[key]).toMatch(/^#[0-9a-f]{6}$/);
          expect(hsl(out[key]).s, `${kind} ${key}`).toBeLessThanOrEqual(MAX_SURFACE_SATURATION + 0.01);
        }
        expect(out.glow).toBe(NEON.glow);
      }
    }
  });

  it('keeps the hue where the material can carry it as paint, and fades colour with age', () => {
    const blue: StyleSpec = { ...STYLE, wall: '#1f6fd0' };
    const fresh = hsl(groundedPalette(blue, set({ wall: 'corrugated', wear: 0 })).wall);
    const old = hsl(groundedPalette(blue, set({ wall: 'corrugated', wear: 1 })).wall);
    expect(Math.abs(fresh.h - hsl(blue.wall).h)).toBeLessThan(4);
    expect(old.s).toBeLessThan(fresh.s);
    // a log is never painted: a blue one comes back brown
    const log = hsl(groundedPalette(blue, set({ wall: 'log' })).wall);
    expect(log.h).toBeGreaterThanOrEqual(13);
    expect(log.h).toBeLessThanOrEqual(43);
  });

  it('preserves which of wall, second wall, roof and trim is lighter, and is stable when applied twice', () => {
    const style: StyleSpec = { ...STYLE, wall: '#f4e8d0', wall2: '#40342a', roof: '#201a16', trim: '#fff6e0' };
    const surfaces = set({ wall: 'plaster', wall2: 'timber', roof: 'slate', trim: 'plaster' });
    const out = groundedPalette(style, surfaces);
    const wall = hsl(out.wall).l;
    expect(hsl(out.wall2).l).toBeLessThan(wall - 0.2);
    expect(hsl(out.roof).l).toBeLessThan(wall - 0.2);
    // a dark wall under a pale roof of a kind that cannot be that pale: the roof is still the lighter of the two
    const flip = groundedPalette({ ...STYLE, wall: '#2a2622', roof: '#e8e4dc' }, set({ wall: 'stone', roof: 'slate' }));
    expect(hsl(flip.roof).l).toBeGreaterThan(hsl(flip.wall).l + 0.15);
    const twice = groundedPalette(out, surfaces);
    for (const key of TONES) {
      const a = new THREE.Color(out[key]);
      const b = new THREE.Color(twice[key]);
      expect(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b), key).toBeLessThan(0.03);
    }
  });

  it('groundTone and signTone: one colour at a time, signs a little fresher but never pure', () => {
    expect(hsl(groundTone('timber', '#ff7a00')).s).toBeLessThanOrEqual(0.42);
    expect(groundTone('concrete', '#9a9a96')).toBe('#9a9a96');
    const sign = hsl(signTone('#ffe600'));
    expect(sign.s).toBeLessThanOrEqual(0.73);
    expect(sign.s).toBeGreaterThan(MAX_SURFACE_SATURATION);
    expect(hsl(signTone('#ffe600', 1)).s).toBeLessThan(sign.s);
    expect(groundTone('not-a-kind' as SurfaceId, 'nonsense')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/** Variance of the normal map's x and y: how much relief a raking light will find. */
function reliefEnergy(kind: SurfaceId, wear: number): number {
  const size = 128;
  const px = surfacePixels(kind, '#8a8478', { wear, wet: 0, size, seed: 1 });
  const n = size * size;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const x = (px.normal[i * 4] as number) / 127.5 - 1;
    const y = (px.normal[i * 4 + 1] as number) / 127.5 - 1;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
  }
  return sxx / n - (sx / n) ** 2 + syy / n - (sy / n) ** 2;
}

describe('relief', () => {
  // Built-up surfaces (boards, courses, ribs, laps) must throw real shadow; worked ones show joints and
  // grain; smooth ones (render, sheet, snow) still carry a grain so a highlight never lies dead flat.
  const DEEP: SurfaceKind[] = ['timber', 'planks', 'log', 'brick', 'stone', 'cobble', 'corrugated', 'shingle', 'tile', 'thatch', 'bark', 'gravel', 'coral', 'crystal'];
  const WORKED: SurfaceKind[] = ['slate', 'chitin', 'moss', 'paper_screen', 'dirt', 'sand', 'grass', 'mud', 'rusted'];

  it('every kind has relief energy above the floor for its class', () => {
    for (const kind of SURFACE_KINDS) {
      const floor = DEEP.includes(kind) ? 0.025 : WORKED.includes(kind) ? 0.007 : 0.0005;
      for (const wear of [0, 0.5]) expect(reliefEnergy(kind, wear), `${kind} at wear ${wear}`).toBeGreaterThan(floor);
    }
    expect(reliefEnergy('corrugated', 0.5)).toBeGreaterThan(0.1);
    expect(reliefEnergy('paint', 0.5)).toBeGreaterThan(0.0004);
  });

  it('cavities are darker than the proud parts of the same surface', () => {
    for (const kind of ['brick', 'planks', 'cobble', 'tile'] as const) {
      const size = 128;
      const px = surfacePixels(kind, '#8a8478', { wear: 0.3, wet: 0, size, seed: 1 });
      let lo = 0;
      let loN = 0;
      let hi = 0;
      let hiN = 0;
      for (let i = 0; i < size * size; i++) {
        const h = px.data[i * 4] as number;
        const l = (px.albedo[i * 4] as number) + (px.albedo[i * 4 + 1] as number) + (px.albedo[i * 4 + 2] as number);
        if (h < 70) {
          lo += l;
          loN++;
        } else if (h > 150) {
          hi += l;
          hiN++;
        }
      }
      expect(loN, kind).toBeGreaterThan(20);
      expect(hiN, kind).toBeGreaterThan(20);
      expect(lo / loN, kind).toBeLessThan((hi / hiN) * 0.85);
    }
  });
});

describe('weathering shader', () => {
  it('finds every anchor in the standard material shader and wires rust to sheet metal only', () => {
    const lib = THREE.ShaderLib.standard;
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    for (const anchor of ['#include <common>', '#include <uv_vertex>']) expect(lib.vertexShader).toContain(anchor);
    for (const anchor of ['#include <common>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>']) expect(lib.fragmentShader).toContain(anchor);
    // the patch reads its own values in the order the standard shader reaches these chunks
    const f = lib.fragmentShader;
    expect(f.indexOf('#include <map_fragment>')).toBeLessThan(f.indexOf('#include <roughnessmap_fragment>'));
    expect(f.indexOf('#include <roughnessmap_fragment>')).toBeLessThan(f.indexOf('#include <metalnessmap_fragment>'));
    expect(THREE.ShaderChunk.roughnessmap_fragment).toContain('roughnessFactor');
    expect(THREE.ShaderChunk.metalnessmap_fragment).toContain('metalnessFactor');
    patchSurfaceShader(shader, { edge: 1, grime: 0.5, bleach: 0.5, dripGloss: 0.3, edgeGloss: 0.16, rust: 0.7 });
    expect(shader.uniforms.uSurfRust?.value).toBe(0.7);
    expect(shader.vertexShader).toContain('attribute vec4 wearing;');
    expect(shader.fragmentShader.match(/uniform float uSurfRust;/g)).toHaveLength(1);
    expect(shader.fragmentShader).toContain('metalnessFactor *= 1.0 - sRust;');
    expect(shader.fragmentShader).toContain('roughnessFactor = mix( roughnessFactor, 0.93, sRust );');

    const run = (m: THREE.Material): Record<string, { value: unknown }> => {
      const live = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      (m.onBeforeCompile as unknown as (s: typeof live) => void)(live);
      return live.uniforms;
    };
    const opts = { wear: 0.7, wet: 0, quality: 0 as const, seed: 0, tint: true, worn: true };
    expect(run(getSurface('corrugated', '#5c7078', opts)).uSurfRust?.value).toBeGreaterThan(0.5);
    expect(run(getSurface('corrugated', '#5c7078', { ...opts, wear: 0 })).uSurfRust?.value).toBe(0);
    expect(run(getSurface('planks', '#7a5a3e', opts)).uSurfRust?.value).toBe(0);
    expect(run(getSurface('glass_curtain', '#5a7890', opts)).uSurfRust?.value).toBe(0);
    expect(getSurface('planks', '#7a5a3e', opts).userData.wearing).toBe(true);
    expect(getSurface('planks', '#7a5a3e', { ...opts, worn: false }).userData.wearing).toBeUndefined();
  });
});

describe('warmSurfaces', () => {
  it('generates, between turns of the event loop, the same maps the synchronous path would, once', async () => {
    disposeSurfaces();
    const req: SurfaceRequest[] = [
      { kind: 'brick', hex: '#8a4a38', wear: 0.5, wet: 0.2, quality: 0, seed: 4 },
      { kind: 'slate', hex: '#4e5560', wear: 0.5, wet: 0.2, quality: 0, seed: 4 },
      { kind: 'brick', hex: '#8a4a38', wear: 0.5, wet: 0.2, quality: 0, seed: 4 },
    ];
    let turns = 0;
    const tick = setInterval(() => { turns++; }, 0);
    await warmSurfaces(req, 2);
    clearInterval(tick);
    expect(turns).toBeGreaterThan(0);
    const m = getSurface('brick', '#8a4a38', { wear: 0.5, wet: 0.2, quality: 0, seed: 4 });
    const direct = surfacePixels('brick', '#8a4a38', { wear: 0.5, wet: 0.2, size: 256, seed: 4 });
    const image = (m.map as THREE.DataTexture).image as { data: Uint8ClampedArray; width: number };
    expect(image.width).toBe(256);
    expect(Buffer.compare(Buffer.from(image.data.buffer), Buffer.from(direct.albedo.buffer))).toBe(0);
    const normal = ((m.normalMap as THREE.DataTexture).image as { data: Uint8ClampedArray }).data;
    expect(Buffer.compare(Buffer.from(normal.buffer), Buffer.from(direct.normal.buffer))).toBe(0);
    // warming again is a no-op and keeps the same textures
    await warmSurfaces(req);
    expect(getSurface('brick', '#8a4a38', { wear: 0.5, wet: 0.2, quality: 0, seed: 4 }).map).toBe(m.map);
    await warmSurfaces([]);
  });

  it('a town lists every surface its buildings and ground will ask for, in grounded colours', () => {
    const style: StyleSpec = { ...NEON, surfaces: set() };
    const list = townSurfaceRequests(style, { quality: 0, theme: 'western' });
    expect(list.length).toBeGreaterThanOrEqual(10);
    for (const r of list) {
      expect(r.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(hsl(r.hex).s).toBeLessThanOrEqual(0.73);
    }
    const kinds = list.map((r) => r.kind);
    for (const k of ['planks', 'concrete', 'tile', 'stone', 'paint', 'grass', 'asphalt']) expect(kinds).toContain(k);
    expect(groundRequests(set(), style, { quality: 0 })).toHaveLength(4);
  });
});
