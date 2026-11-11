import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { waterLook, waterLookFor, waterMaterial } from '../../app/src/town/water';
import type { WaterKind } from '../../app/src/town/water';

const KINDS: WaterKind[] = ['pond', 'lake', 'river', 'shore', 'lava', 'acid', 'ice_sheet', 'mist_sea'];
const luma = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

function compiled(kind: WaterKind, far = false): { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string } {
  const m = waterMaterial(waterLook(kind), far ? { level: 2, hole: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } } : undefined);
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  m.onBeforeCompile(shader as never, null as never);
  m.dispose();
  return shader;
}

describe('water surface', () => {
  it('patches one standard material with every uniform it declares, near and far', () => {
    for (const kind of KINDS) {
      for (const far of [false, true]) {
        const s = compiled(kind, far);
        for (const src of [s.vertexShader, s.fragmentShader]) {
          for (const [open, close] of [['(', ')'], ['{', '}']] as const) expect(src.split(open).length, `${kind} ${open}`).toBe(src.split(close).length);
        }
        const declared = [...s.fragmentShader.matchAll(/^\s*uniform\s+\w+\s+(uWater\w*|uShallow|uDeep|uFoam|uGlowColour|uHorizon);/gm)].map((m) => m[1] as string);
        expect(declared.length).toBeGreaterThanOrEqual(8);
        for (const u of declared) expect(s.uniforms[u], `${kind} ${u}`).toBeDefined();
      }
    }
  });

  it('has the shore line, the view-angle shading and the far swell, each declared before it is used', () => {
    const f = compiled('lake').fragmentShader;
    for (const name of ['wLap', 'wFacing', 'wGraze', 'wDist', 'wFar']) {
      const first = f.indexOf(`float ${name}`);
      expect(first, name).toBeGreaterThan(0);
      expect(f.indexOf(name), name).toBe(first + 'float '.length);
    }
    expect(f).toContain('mix(diffuseColor.rgb, uHorizon');
    // No second pass and nothing sampled: the surface is arithmetic on one material.
    expect(f).not.toMatch(/texture2D\(\s*uWater|sampler2D uWater/);
  });

  it('pales open water toward the sky at a distance and leaves lava and ice their own colour', () => {
    const horizon = (kind: WaterKind): THREE.Color => compiled(kind).uniforms.uHorizon?.value as THREE.Color;
    expect(luma(`#${horizon('lake').getHexString()}`)).toBeGreaterThan(luma(waterLook('lake').shallow));
    expect(horizon('lava').getHexString()).toBe(new THREE.Color(waterLook('lava').shallow).getHexString());
    expect(horizon('ice_sheet').getHexString()).toBe(new THREE.Color(waterLook('ice_sheet').shallow).getHexString());
  });
});

describe('waterLookFor', () => {
  it('takes the colour and the motion of the water from the world', () => {
    const plain = waterLook('lake');
    const reef = waterLookFor('lake', { words: 'A tropical lagoon village on stilts' });
    const bog = waterLookFor('lake', { words: 'peat cutters in a drowned bog' });
    const canal = waterLookFor('river', { words: 'a canal city of brick warehouses' });
    const tarn = waterLookFor('lake', { words: 'a glacial valley' });
    expect(luma(reef.shallow)).toBeGreaterThan(luma(plain.shallow));
    expect(reef.alpha0).toBeLessThan(plain.alpha0);
    expect(luma(bog.deep)).toBeLessThan(luma(plain.deep));
    expect(new THREE.Color(bog.shallow).r).toBeGreaterThan(new THREE.Color(bog.shallow).b);
    expect(bog.speed).toBeLessThan(plain.speed);
    expect(canal.alpha0).toBeGreaterThan(waterLook('river').alpha0);
    expect(canal.bump).toBeLessThan(waterLook('river').bump);
    expect(tarn.bump).toBeLessThan(plain.bump * 0.5);
    expect(waterLookFor('lake', { words: 'a quiet market town' })).toEqual(plain);
  });

  it('lets the bed show through the shallows and never repaints lava, ice or mist', () => {
    const sand = waterLookFor('shore', { words: '', ground: '#d8c48a' });
    expect(luma(sand.shallow)).toBeGreaterThan(luma(waterLook('shore').shallow));
    expect(sand.deep).toBe(waterLook('shore').deep);
    expect(waterLookFor('shore', { words: '', ground: 'sand' })).toEqual(waterLook('shore'));
    for (const kind of ['lava', 'ice_sheet', 'mist_sea'] as WaterKind[]) expect(waterLookFor(kind, { words: 'tropical peat canal', ground: '#ffffff' })).toEqual(waterLook(kind));
    // Acid keeps its green whatever the place is called, but still lies on the world's ground.
    expect(waterLookFor('acid', { words: 'tropical lagoon' }).deep).toBe(waterLook('acid').deep);
  });
});
