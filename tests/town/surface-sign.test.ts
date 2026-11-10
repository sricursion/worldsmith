import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { SIGN_MAX_WIDTH, createSign, disposeSign, setSignLabel, signDesign, signDesignOf, signFace } from '../../app/src/town/sign';
import type { SignContext } from '../../app/src/town/sign';
import { SURFACE_KINDS, disposeSurfaces, surfaceFamily } from '../../app/src/town/surfaces';
import type { SurfaceSet, ThemeId } from '../../app/src/world/spec';
import { STYLE, THEMES } from './helpers';

afterAll(() => disposeSurfaces());

const LABELS = ['Bank', 'Saloon', 'Harbour Master', 'The Drowned Rat Inn', 'General Store & Feed', 'Dry Dock 7', 'X', 'Intergalactic Customs And Excise Office', ''];
const set = (wall: SurfaceSet['wall'], wear = 0.5): SurfaceSet => ({ wall, wall2: wall, roof: 'slate', trim: 'timber', ground: 'dirt', road: 'dirt', wear, wet: 0 });
const ctx = (wall: SurfaceSet['wall'], theme: ThemeId, wear = 0.5, era = ''): SignContext => ({ style: STYLE, surfaces: set(wall, wear), theme, era });
const hsl = (hex: string): { h: number; s: number; l: number } => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
const lum = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

describe('signs', () => {
  it('never exceed the size cap and stay modest, whatever is asked for', () => {
    for (const kind of SURFACE_KINDS) {
      for (const theme of THEMES) {
        for (const label of LABELS) {
          for (const width of [0.5, 2.4, 4.4, 40, NaN]) {
            const d = signDesign(label, '#ffd400', width, ctx(kind, theme));
            expect(d.width).toBeLessThanOrEqual(SIGN_MAX_WIDTH);
            expect(d.width).toBeGreaterThan(0);
            if (width <= SIGN_MAX_WIDTH) expect(d.width).toBeLessThanOrEqual(width);
            expect(d.height).toBeLessThanOrEqual(0.85);
            expect(d.height).toBeGreaterThanOrEqual(0.3);
            expect(d.lines.length).toBeGreaterThanOrEqual(1);
            expect(d.lines.length).toBeLessThanOrEqual(2);
          }
        }
      }
    }
    expect(SIGN_MAX_WIDTH).toBe(2.4);
  });

  it('are never a saturated rectangle: boards are aged paint, stone or a dark backing, with lettering that stands out', () => {
    for (const kind of SURFACE_KINDS) {
      for (const theme of THEMES) {
        for (const label of LABELS) {
          for (const accent of ['#ffd400', '#ff0000', '#00ff40', '#ff00ff']) {
            const d = signDesign(label, accent, 4, ctx(kind, theme, 0.2));
            const board = hsl(d.board);
            expect(board.s, `${kind} ${theme} ${label} ${d.kind}`).toBeLessThanOrEqual(0.55);
            expect(hsl(d.edge).l).toBeLessThan(board.l + 0.01);
            if (d.kind === 'neon') {
              expect(board.l).toBeLessThan(0.15);
              expect(d.glow).toMatch(/^#[0-9a-f]{6}$/);
            } else {
              expect(d.glow).toBeNull();
              const a = lum(d.board) + 0.05;
              const b = lum(d.ink) + 0.05;
              expect(Math.max(a, b) / Math.min(a, b), `${d.kind} ${d.board} ${d.ink}`).toBeGreaterThan(d.kind === 'plaque' ? 1.8 : 2.5);
            }
          }
        }
      }
    }
  });

  it('take their kind from what the building is made of; light only where the place is modern, lit and kept', () => {
    const kinds = (wall: SurfaceSet['wall'], theme: ThemeId, wear = 0.4): Set<string> =>
      new Set(Array.from({ length: 40 }, (_, i) => signDesign(`Shop ${i}`, '#a03020', 4, ctx(wall, theme, wear)).kind));
    expect([...kinds('planks', 'western')].sort()).toEqual(['board', 'shingle']);
    expect([...kinds('stone', 'medieval')].sort()).toEqual(['plaque', 'shingle']);
    expect([...kinds('corrugated', 'modern')].sort()).toEqual(['enamel', 'neon']);
    expect([...kinds('corrugated', 'modern', 0.9)]).toEqual(['enamel']);
    expect([...kinds('corrugated', 'western')]).toEqual(['enamel']);
    for (const kind of SURFACE_KINDS) {
      for (const theme of THEMES) {
        if (!kinds(kind, theme).has('neon')) continue;
        expect(['metal', 'glass']).toContain(surfaceFamily(kind));
        expect(['scifi', 'modern']).toContain(theme);
      }
    }
    // without a glow colour there is no lit sign
    const dull = { ...ctx('metal_panel', 'scifi'), style: { ...STYLE, glow: '' } };
    expect(new Set(Array.from({ length: 30 }, (_, i) => signDesign(`S${i}`, '#a03020', 4, dull).kind))).toEqual(new Set(['enamel']));
  });

  it('letter in a face that suits the era words, falling back to the theme', () => {
    expect(signFace('1880s frontier boomtown', 'modern').family).toContain('Rockwell');
    expect(signFace('high medieval', 'modern').family).toContain('Palatino');
    expect(signFace('far future orbital colony', 'western').family).toContain('Bahnschrift');
    expect(signFace('present day', 'medieval').family).toContain('Arial');
    expect(signFace('', 'western')).toBe(signFace('the 1870s', 'scifi'));
    expect(signFace('', 'scifi').upper).toBe(true);
    expect(signDesign('The Drowned Rat Inn', '#803020', 4, ctx('plaster', 'medieval', 0.5, 'medieval')).lines).toEqual(['The Drowned', 'Rat Inn']);
    expect(signDesign('Saloon', '#803020', 4, ctx('planks', 'western', 0.5, '1880s')).lines).toEqual(['SALOON']);
  });

  it('build as one mesh with its fixings, inside the cap, and dispose cleanly without a DOM', () => {
    for (const [wall, theme] of [['planks', 'western'], ['stone', 'medieval'], ['corrugated', 'modern'], ['metal_panel', 'scifi']] as const) {
      for (const label of LABELS) {
        const sign = createSign(label, '#ffd400', 4.4, ctx(wall, theme));
        expect(sign).toBeInstanceOf(THREE.Mesh);
        expect(sign.name).toBe('sign');
        sign.geometry.computeBoundingBox();
        const box = sign.geometry.boundingBox as THREE.Box3;
        expect(box.max.x - box.min.x).toBeLessThanOrEqual(SIGN_MAX_WIDTH + 1e-6);
        // everything stays on the street side of the wall it is fixed to (the wall is at local z = +0.08)
        const whole = new THREE.Box3().setFromObject(sign);
        expect(whole.max.x - whole.min.x).toBeLessThanOrEqual(SIGN_MAX_WIDTH + 0.3);
        expect(whole.max.z).toBeLessThanOrEqual(0.081);
        expect(whole.min.z).toBeGreaterThan(-0.45);
        const d = signDesignOf(sign);
        expect(d?.width).toBeCloseTo(box.max.x - box.min.x, 6);
        const mats = sign.material as THREE.MeshStandardMaterial[];
        expect(mats).toHaveLength(6);
        // no canvas under Node: the face is the plain board colour and nothing emits
        const face = mats[5] as THREE.MeshStandardMaterial;
        expect(`#${face.color.getHexString()}`).toBe(d?.board);
        expect(face.emissive.r + face.emissive.g + face.emissive.b).toBe(0);
        setSignLabel(sign, 'Closed For Good');
        expect(signDesignOf(sign)?.width).toBe(d?.width);
        disposeSign(sign);
      }
    }
    expect(signDesign('Bank', '#ffd400', 4)).toEqual(signDesign('Bank', '#ffd400', 4));
  });
});
