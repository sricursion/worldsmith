import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KITS, PROP_SIZES } from '../../app/src/town/kits';
import { ALL_ROLES, THEMES } from './helpers';

const assetsRoot = fileURLToPath(new URL('../../assets', import.meta.url));
const onDisk = (u: string): boolean => existsSync(assetsRoot + u);

describe('KITS', () => {
  it('has a manifest per theme with a role entry for every building role', () => {
    for (const t of THEMES) {
      const kit = KITS[t];
      expect(kit.theme).toBe(t);
      for (const r of ALL_ROLES) expect(Array.isArray(kit.buildings[r]), `${t}.${r}`).toBe(true);
    }
  });

  it('points every building and prop at a file that exists under /third_party', () => {
    for (const t of THEMES) {
      const kit = KITS[t];
      const urls = [...Object.values(kit.buildings).flat(), ...Object.values(kit.props)];
      for (const u of urls) {
        expect(u.startsWith('/third_party/'), u).toBe(true);
        expect(onDisk(u), `${t}: ${u}`).toBe(true);
      }
    }
  });

  it('references the .bin of every .gltf it uses', () => {
    for (const t of THEMES) {
      const kit = KITS[t];
      const gltfs = [...Object.values(kit.buildings).flat(), ...Object.values(kit.props)].filter((u) => u.endsWith('.gltf'));
      for (const u of gltfs) {
        const j = JSON.parse(readFileSync(assetsRoot + u, 'utf8')) as { buffers?: { uri?: string }[] };
        for (const b of j.buffers ?? []) {
          if (b.uri && !b.uri.startsWith('data:')) {
            expect(onDisk(u.slice(0, u.lastIndexOf('/') + 1) + b.uri), `${u} -> ${b.uri}`).toBe(true);
          }
        }
      }
    }
  });

  it('leaves western buildings to the procedural fallback and the others covered', () => {
    expect(Object.values(KITS.western.buildings).every((c) => c.length === 0)).toBe(true);
    for (const t of ['medieval', 'scifi', 'modern'] as const) {
      const covered = ALL_ROLES.filter((r) => KITS[t].buildings[r].length > 0);
      expect(covered.length, t).toBeGreaterThanOrEqual(ALL_ROLES.length - 2);
    }
  });

  it('uses the specified ground colours and sizes every mapped prop', () => {
    expect(KITS.western.ground.color).toBe('#c9a46a');
    expect(KITS.medieval.ground.color).toBe('#6f8f4a');
    expect(KITS.scifi.ground.color).toBe('#5b5a63');
    expect(KITS.modern.ground.color).toBe('#4b4f55');
    for (const t of THEMES) {
      for (const k of Object.keys(KITS[t].props)) expect(PROP_SIZES[k], `${t}.${k}`).toBeGreaterThan(0);
    }
  });
});
