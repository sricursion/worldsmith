import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ThemeId } from '../../app/src/world/spec';
import { CLIP_CANDIDATES, LOGICAL_CLIPS, resolveClipNames } from '../../app/src/engine/kaykit-clips';
import { Group, Mesh } from 'three';
import { PALETTE_COUNT, PALETTE_RINGS, accessoryKind, classifyPixel, paletteForRole, paletteSlot, paletteVariant, planOutfit, shiftPixels } from '../../app/src/engine/palette';
import type { Accessory, AccessorySlot } from '../../app/src/engine/palette';
import {
  BASE_FILES, CHARACTER_HEIGHT_M, EXTRA_CLIPS, EXTRA_CLIP_CANDIDATES, blobAlpha, listAccessories, resolveExtraClipNames, setOutfit,
  turnToward, wrapAngle,
} from '../../app/src/engine/character';
import { makeRng } from '../../app/src/world/rng';
import { FOOTPRINT_TABLE } from '../../app/src/engine/assets';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const THEMES: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

function glbClipNames(file: string): string[] {
  const buf = readFileSync(join(ROOT, 'assets', 'third_party', 'kaykit-adventurers', `${file}.glb`));
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { animations?: { name?: string }[] };
  return (json.animations ?? []).map((a) => a.name ?? '');
}

describe('palette tables', () => {
  it('has ten variants per theme with the first untouched', () => {
    for (const t of THEMES) {
      expect(PALETTE_RINGS[t]).toHaveLength(PALETTE_COUNT);
      expect(PALETTE_RINGS[t][0]).toEqual({ hue: 0, value: 1, sat: 1 });
    }
  });

  it('keeps every variant distinct inside a theme and in moderate ranges', () => {
    for (const t of THEMES) {
      const keys = new Set(PALETTE_RINGS[t].map((p) => `${p.hue}|${p.value}|${p.sat}`));
      expect(keys.size).toBe(PALETTE_COUNT);
      for (const p of PALETTE_RINGS[t]) {
        expect(Math.abs(p.hue)).toBeLessThanOrEqual(150);
        expect(p.value).toBeGreaterThan(0.3);
        expect(p.value).toBeLessThanOrEqual(1.3);
        expect(p.sat).toBeGreaterThan(0.3);
        expect(p.sat).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('gives each theme its own ring', () => {
    const rings = THEMES.map((t) => JSON.stringify(PALETTE_RINGS[t]));
    expect(new Set(rings).size).toBe(THEMES.length);
  });

  it('puts the theme flavours in the intended direction', () => {
    const meanAbs = (t: ThemeId): number => PALETTE_RINGS[t].reduce((a, p) => a + Math.abs(p.hue), 0) / PALETTE_COUNT;
    expect(meanAbs('western')).toBeLessThan(meanAbs('medieval'));
    const modernValue = PALETTE_RINGS.modern.reduce((a, p) => a + p.value, 0) / PALETTE_COUNT;
    expect(modernValue).toBeLessThan(0.9); // darker greys and navies
  });

  it('folds any index into the ring', () => {
    expect(paletteSlot(0)).toBe(0);
    expect(paletteSlot(10)).toBe(0);
    expect(paletteSlot(13)).toBe(3);
    expect(paletteSlot(-1)).toBe(9);
    expect(paletteSlot(Number.NaN)).toBe(0);
    expect(paletteVariant('scifi', 14)).toEqual(PALETTE_RINGS.scifi[4]);
  });
});

describe('shiftPixels', () => {
  const px = (r: number, g: number, b: number, a = 255): Uint8ClampedArray => new Uint8ClampedArray([r, g, b, a]);
  const hueOf = (d: Uint8ClampedArray): number => {
    const r = (d[0] ?? 0) / 255;
    const g = (d[1] ?? 0) / 255;
    const b = (d[2] ?? 0) / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    if (delta === 0) return 0;
    const h = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return h * 60;
  };
  const SKIN = [248, 200, 168] as const;
  const HAIR = [168, 104, 72] as const;
  const BLUE = [40, 60, 200] as const;
  const GREY = [128, 128, 128] as const;

  /** Synthetic atlas holding skin, hair, blue cloth, grey and a saturated red pixel. */
  const atlas = (): Uint8ClampedArray => new Uint8ClampedArray([...SKIN, 255, ...HAIR, 255, ...BLUE, 255, ...GREY, 255, 255, 0, 0, 255]);

  it('classifies skin, hair, grey and cloth', () => {
    expect(classifyPixel(...SKIN)).toBe('skin');
    expect(classifyPixel(...HAIR)).toBe('skin');
    expect(classifyPixel(...GREY)).toBe('neutral');
    expect(classifyPixel(...BLUE)).toBe('cloth');
    expect(classifyPixel(255, 0, 0)).toBe('cloth');
  });

  it('makes palette 0 the identity for every theme', () => {
    for (const t of THEMES) {
      const p = paletteVariant(t, 0);
      const d = atlas();
      shiftPixels(d, p.hue, p.value, p.sat);
      expect(Array.from(d)).toEqual(Array.from(atlas()));
    }
  });

  it('never changes skin or hair pixels under any palette', () => {
    for (const t of THEMES) {
      for (let i = 0; i < PALETTE_COUNT; i++) {
        const p = paletteVariant(t, i);
        const d = atlas();
        shiftPixels(d, p.hue, p.value, p.sat);
        expect(Array.from(d.subarray(0, 8))).toEqual([...SKIN, 255, ...HAIR, 255]);
      }
    }
  });

  it('changes the hue of blue cloth under a non-zero palette', () => {
    for (const t of THEMES) {
      const p = paletteVariant(t, 1);
      const d = px(...BLUE);
      shiftPixels(d, p.hue, p.value, p.sat);
      const diff = Math.abs(hueOf(d) - hueOf(px(...BLUE)));
      expect(Math.min(diff, 360 - diff)).toBeGreaterThan(5);
    }
  });

  it('keeps grey hue, and alpha, untouched', () => {
    const grey = px(...GREY, 77);
    shiftPixels(grey, 90, 0.5, 1.5);
    expect(Array.from(grey)).toEqual([128, 128, 128, 77]);
  });

  it('rotates cloth red to green at +120 degrees and wraps negatives', () => {
    const g = px(255, 0, 0);
    shiftPixels(g, 120, 1);
    expect(Array.from(g)).toEqual([0, 255, 0, 255]);
    const b = px(255, 0, 0);
    shiftPixels(b, -120, 1);
    expect(Array.from(b)).toEqual([0, 0, 255, 255]);
  });

  it('scales value and saturation of cloth only', () => {
    const dim = px(200, 0, 0);
    shiftPixels(dim, 0, 0.5);
    expect(Array.from(dim)).toEqual([100, 0, 0, 255]);
    const pale = px(...BLUE);
    shiftPixels(pale, 0, 1, 0.5);
    expect(pale[2]).toBe(BLUE[2]);
    expect(pale[0]).toBeGreaterThan(BLUE[0]);
  });
});

describe('clip mapping against the real GLBs', () => {
  const files = Array.from(new Set(Object.values(BASE_FILES)));

  it('resolves all six logical names on every shipped model', () => {
    for (const f of files) {
      const map = resolveClipNames(glbClipNames(f));
      for (const logical of LOGICAL_CLIPS) {
        expect(map[logical], `${f}:${logical}`).not.toBeNull();
      }
      expect(map.idle).toBe('Idle');
      expect(map.walk).toBe('Walking_A');
      expect(map.run).toBe('Running_A');
    }
  });

  it('falls back through candidates and returns null when nothing matches', () => {
    expect(resolveClipNames(['Unarmed_Idle']).idle).toBe('Unarmed_Idle');
    expect(resolveClipNames([]).walk).toBeNull();
  });

  it('is described in the committed rig report', () => {
    const report = readFileSync(join(ROOT, 'tests', 'engine', 'kaykit-rig-report.md'), 'utf8');
    for (const logical of LOGICAL_CLIPS) {
      const first = CLIP_CANDIDATES[logical][0];
      expect(first).toBeDefined();
      expect(report).toContain(first as string);
    }
    expect(report).toContain('missing [], extra []');
  });
});

describe('constants', () => {
  it('maps every character base to an existing file', () => {
    for (const f of Object.values(BASE_FILES)) {
      expect(glbClipNames(f).length).toBeGreaterThan(0);
    }
    expect(CHARACTER_HEIGHT_M).toBe(1.75);
  });

  it('keeps the architecture footprint table', () => {
    expect(FOOTPRINT_TABLE).toEqual({ small: { w: 6, d: 6 }, medium: { w: 9, d: 8 }, large: { w: 12, d: 10 } });
  });
});

/** Unskinned mesh nodes of a GLB with the slot each hangs from, read from the JSON chunk. */
function glbAccessories(file: string): Accessory[] {
  const buf = readFileSync(join(ROOT, 'assets', 'third_party', 'kaykit-adventurers', `${file}.glb`));
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { nodes: { name?: string; mesh?: number; skin?: number; children?: number[] }[] };
  const slots: Record<string, AccessorySlot> = { 'handslot.l': 'left', 'handslot.r': 'right', head: 'head', chest: 'chest' };
  const out: Accessory[] = [];
  for (const parent of json.nodes) {
    const slot = slots[parent.name ?? ''];
    if (slot === undefined) continue;
    for (const c of parent.children ?? []) {
      const n = json.nodes[c];
      if (n !== undefined && n.mesh !== undefined && n.skin === undefined) out.push({ name: n.name ?? '', slot });
    }
  }
  return out;
}

describe('turnToward', () => {
  it('takes the shorter arc across the wrap', () => {
    const a = turnToward(3.0, -3.0, 0.1, 5); // 0.283 rad apart through PI, not 6 rad the long way
    expect(Math.abs(a)).toBeGreaterThan(3.0);
    expect(Math.abs(wrapAngle(-3.0 - a))).toBeLessThan(Math.abs(wrapAngle(-3.0 - 3.0)));
    const b = turnToward(-3.0, 3.0, 0.1, 5);
    expect(b).toBeCloseTo(-a, 10);
  });

  it('closes 1 - 1/e of the gap in 1/rate seconds and never overshoots', () => {
    expect(turnToward(0, 1, 0.25, 4)).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(turnToward(0, 1, 100, 4)).toBeCloseTo(1, 10);
    expect(turnToward(0.3, 0.3, 0.1, 9)).toBeCloseTo(0.3, 12);
    let y = 0;
    for (let i = 0; i < 600; i++) {
      const next = turnToward(y, 2.5, 1 / 60, 10);
      expect(next).toBeGreaterThanOrEqual(y);
      expect(next).toBeLessThanOrEqual(2.5 + 1e-12);
      y = next;
    }
    expect(y).toBeCloseTo(2.5, 6);
  });

  it('is frame-rate independent', () => {
    let coarse = 0;
    let fine = 0;
    for (let i = 0; i < 10; i++) coarse = turnToward(coarse, -2, 0.05, 6);
    for (let i = 0; i < 100; i++) fine = turnToward(fine, -2, 0.005, 6);
    expect(coarse).toBeCloseTo(fine, 9);
  });

  it('holds still for zero or negative time and rate, and returns a wrapped angle', () => {
    expect(turnToward(1, 2, 0, 5)).toBeCloseTo(1, 12);
    expect(turnToward(1, 2, -1, 5)).toBeCloseTo(1, 12);
    expect(turnToward(1, 2, 0.1, -3)).toBeCloseTo(1, 12);
    expect(turnToward(7, 7, 0.1, 5)).toBeCloseTo(7 - Math.PI * 2, 12);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Number.NaN)).toBe(0);
    for (const x of [-20, -4, -0.5, 0, 2, 9, 100]) {
      const w = wrapAngle(x);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(x), 9);
    }
  });
});

describe('outfits', () => {
  const PAIRS: readonly (readonly [string, ThemeId, string])[] = [
    ['Mage', 'western', 'sheriff'],
    ['Knight', 'medieval', 'monk'],
    ['Knight', 'medieval', 'captain of the watch'],
    ['Knight', 'scifi', 'station security chief'],
    ['Barbarian', 'western', 'saloon bartender'],
    ['Mage', 'medieval', 'court wizard'],
    ['Rogue', 'modern', 'cafe owner'],
    ['Rogue', 'medieval', 'poacher'],
  ];

  it('classifies every shipped accessory', () => {
    for (const f of new Set(Object.values(BASE_FILES))) {
      const acc = glbAccessories(f);
      expect(acc.length, f).toBeGreaterThanOrEqual(6);
      for (const a of acc) expect(accessoryKind(a.name), a.name).not.toBe('other');
    }
    expect(accessoryKind('Knight_Helmet')).toBe('helmet');
    expect(accessoryKind('Barbarian_Hat')).toBe('horned');
    expect(accessoryKind('Mage_Hat')).toBe('hat');
    expect(accessoryKind('2H_Crossbow')).toBe('ranged');
  });

  it('is deterministic for eight role and theme pairs', () => {
    for (const [file, theme, role] of PAIRS) {
      const acc = glbAccessories(file);
      const first = planOutfit(acc, theme, role, makeRng(1234, role));
      for (let i = 0; i < 5; i++) expect(planOutfit(acc, theme, role, makeRng(1234, role)), `${file}/${theme}/${role}`).toEqual(first);
      // Order of the accessory list must not matter either.
      expect(planOutfit([...acc].reverse(), theme, role, makeRng(1234, role))).toEqual(first);
      expect(first.visible).toEqual([...first.visible].sort());
    }
  });

  it('dresses each of the eight sensibly whatever the seed', () => {
    const shipped = new Map(PAIRS.map(([file]) => [file, glbAccessories(file)]));
    for (let seed = 0; seed < 40; seed++) {
      const plan = (i: number): string[] => {
        const [file, theme, role] = PAIRS[i] as (typeof PAIRS)[number];
        return planOutfit(shipped.get(file) ?? [], theme, role, makeRng(seed, 'o')).visible;
      };
      expect(plan(0).filter((n) => n !== 'Mage_Cape')).toEqual(['Mage_Hat']); // a sheriff keeps the hat and carries no wand
      expect(plan(1)).not.toContain('Knight_Helmet'); // a monk loses the helmet
      expect(plan(1).filter((n) => /Sword|Shield/.test(n))).toEqual([]);
      expect(plan(2)).toEqual(expect.arrayContaining(['Knight_Helmet', '1H_Sword', 'Knight_Cape']));
      expect(plan(3)).toContain('Knight_Helmet'); // reads as armour in a sci-fi town
      expect(plan(3).filter((n) => /Sword|Shield/.test(n))).toEqual([]); // but no medieval weapons
      expect(plan(4)).toContain('Mug');
      expect(plan(4)).not.toContain('Barbarian_Hat');
      expect(plan(4).filter((n) => /Axe|Shield/.test(n))).toEqual([]);
      expect(plan(5)).toContain('Mage_Hat');
      expect(plan(5).some((n) => n === '2H_Staff' || n === '1H_Wand')).toBe(true);
      expect(plan(5).some((n) => n.startsWith('Spellbook'))).toBe(true);
      expect(plan(6)).toEqual([]); // modern: no cape, no knives
      expect(plan(7).filter((n) => n !== 'Rogue_Cape')).toEqual(['1H_Crossbow']);
    }
  });

  it('never hands out off-hand or two-handed weapons, and at most one item per hand', () => {
    const roles = ['guard', 'wizard', 'hunter', 'butcher', 'innkeeper', 'scribe', 'farmer', 'lumberjack', 'hermit', 'priest'];
    for (const f of new Set(Object.values(BASE_FILES))) {
      const acc = glbAccessories(f);
      const slotOf = new Map(acc.map((a) => [a.name, a.slot]));
      for (const theme of THEMES) {
        for (const role of roles) {
          for (let seed = 0; seed < 6; seed++) {
            const v = planOutfit(acc, theme, role, makeRng(seed, 'x')).visible;
            expect(v.filter((n) => slotOf.get(n) === 'left').length).toBeLessThanOrEqual(1);
            expect(v.filter((n) => slotOf.get(n) === 'right').length).toBeLessThanOrEqual(1);
            for (const n of v) {
              expect(n.includes('Offhand')).toBe(false);
              if (n.startsWith('2H_')) expect(n).toBe('2H_Staff');
              if (theme !== 'medieval') expect(/Sword|Shield|Crossbow|Wand|Throwable/.test(n), `${theme}/${role}/${n}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('draws the same number of values whatever the role', () => {
    const acc = glbAccessories('Knight');
    for (const role of ['guard', 'monk', 'nobody in particular']) {
      const rng = makeRng(5, 'draws');
      planOutfit(acc, 'medieval', role, rng);
      const ref = makeRng(5, 'draws');
      for (let i = 0; i < 4; i++) ref.next();
      expect(rng.next()).toBe(ref.next());
    }
  });

  it('applies a plan to the meshes of a rig', () => {
    const root = new Group();
    const add = (parentName: string, names: string[]): void => {
      const parent = new Group();
      parent.name = parentName; // the loader strips the dot from "handslot.l"
      for (const n of names) {
        const m = new Mesh();
        m.name = n;
        parent.add(m);
      }
      root.add(parent);
    };
    add('handslotl', ['1H_Sword_Offhand', 'Round_Shield']);
    add('handslotr', ['1H_Sword', '2H_Sword']);
    add('head', ['Knight_Helmet']);
    add('chest', ['Knight_Cape']);
    add('hips', ['Not_An_Accessory']);
    expect(listAccessories(root).map((a) => `${a.accessory.slot}:${a.accessory.name}`).sort()).toEqual([
      'chest:Knight_Cape', 'head:Knight_Helmet', 'left:1H_Sword_Offhand', 'left:Round_Shield', 'right:1H_Sword', 'right:2H_Sword',
    ]);
    const plan = setOutfit({ root }, { theme: 'medieval', role: 'monk', rng: makeRng(3, 'monk') });
    const visible = listAccessories(root).filter((a) => a.mesh.visible).map((a) => a.accessory.name).sort();
    expect(visible).toEqual(plan.visible);
    expect(visible).toEqual(['Knight_Cape']);
    expect(root.getObjectByName('Not_An_Accessory')?.visible).toBe(true);
    setOutfit({ root }, { theme: 'medieval', role: 'knight', rng: makeRng(3, 'knight') });
    expect(root.getObjectByName('Knight_Helmet')?.visible).toBe(true);
    expect(root.getObjectByName('1H_Sword')?.visible).toBe(true);
    expect(root.getObjectByName('2H_Sword')?.visible).toBe(false);
  });

  it('gives sober roles muted cloth and showy roles vivid cloth', () => {
    const vivid = (theme: ThemeId, i: number): number => (PALETTE_RINGS[theme][i]?.value ?? 0) * (PALETTE_RINGS[theme][i]?.sat ?? 0);
    for (const theme of THEMES) {
      const all = PALETTE_RINGS[theme].map((_, i) => vivid(theme, i)).sort((a, b) => a - b);
      const median = ((all[4] ?? 0) + (all[5] ?? 0)) / 2;
      for (let seed = 0; seed < 20; seed++) {
        const monk = paletteForRole(theme, 'monk', makeRng(seed, 'p'));
        const bard = paletteForRole(theme, 'travelling bard', makeRng(seed, 'p'));
        expect(vivid(theme, monk)).toBeLessThanOrEqual(median);
        expect(vivid(theme, bard)).toBeGreaterThanOrEqual(median);
        const anyone = paletteForRole(theme, 'farmer', makeRng(seed, 'p'));
        expect(anyone).toBeGreaterThanOrEqual(0);
        expect(anyone).toBeLessThan(PALETTE_COUNT);
        expect(paletteForRole(theme, 'farmer', makeRng(seed, 'p'))).toBe(anyone);
      }
    }
  });
});

describe('extra clips and contact shadow', () => {
  it('maps every extra logical name to a real clip on every shipped model', () => {
    const report = readFileSync(join(ROOT, 'tests', 'engine', 'kaykit-rig-report.md'), 'utf8');
    for (const f of new Set(Object.values(BASE_FILES))) {
      const map = resolveExtraClipNames(glbClipNames(f));
      for (const k of EXTRA_CLIPS) expect(map[k], `${f}:${k}`).toBe(EXTRA_CLIP_CANDIDATES[k][0]);
    }
    for (const k of EXTRA_CLIPS) for (const name of EXTRA_CLIP_CANDIDATES[k]) expect(report).toContain(name);
    expect(resolveExtraClipNames([]).gesture).toBeNull();
    expect(resolveExtraClipNames(['Use_Item']).gesture).toBe('Use_Item');
  });

  it('fades the contact shadow smoothly from the feet to nothing at the rim', () => {
    expect(blobAlpha(0)).toBeCloseTo(1, 6);
    expect(blobAlpha(1)).toBe(0);
    expect(blobAlpha(2)).toBe(0);
    let prev = blobAlpha(0);
    for (let r = 0.02; r <= 1; r += 0.02) {
      const a = blobAlpha(r);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
    expect(blobAlpha(0.5)).toBeGreaterThan(0.3);
  });
});
