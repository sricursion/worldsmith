import { describe, expect, it } from 'vitest';
import { blockLots, blockOf, fabricKinds, fabricPresence, inHole, lotRect, lotsAround, saidHeight, stretchTo } from '../../app/src/town/fabric';
import type { FabricLot, Rect } from '../../app/src/town/fabric';
import { buildingAabb, generateLayout, roadRect } from '../../app/src/town/layout';
import type { TownLayout } from '../../app/src/town/layout';
import { SITE_SCALES, scaleFields, scaleFromSettled, scaleProfile } from '../../app/src/world/scale';
import { normalizeSpec, validateSpec } from '../../app/src/world/schema';
import type { SitePattern, SiteScale, WorldSpec } from '../../app/src/world/spec';
import { makeBlueprintSpec, part } from './helpers';

const SETTLED: Record<SiteScale, number> = { lone: 0.03, outpost: 0.12, hamlet: 0.3, village: 0.45, town: 0.7, city: 0.92, metropolis: 1 };
const COUNT: Record<SiteScale, number> = { lone: 1, outpost: 3, hamlet: 4, village: 6, town: 9, city: 10, metropolis: 10 };

function specAt(scale: SiteScale, o: { pattern?: SitePattern; seed?: number; damage?: number; heights?: [number, number] } = {}): WorldSpec {
  const base = makeBlueprintSpec({ seed: o.seed ?? 77, count: COUNT[scale], landmarks: false });
  const wild = scale === 'lone';
  return {
    ...base,
    terrain: { relief: 'flat', ruggedness: 0.1, water: 'none', waterAmount: 0, horizon: '', settled: SETTLED[scale] },
    site: {
      pattern: o.pattern ?? (wild ? 'wild' : scale === 'city' || scale === 'metropolis' ? 'grid' : scale === 'town' ? 'street' : 'scatter'),
      wild: wild ? 0.7 : 0.2, paths: wild ? 'track' : 'road', spacing: 5, scale,
      density: scale === 'metropolis' ? 1 : 0.5, ...(o.damage !== undefined ? { damage: o.damage } : {}), ...(o.heights ? { heights: o.heights } : {}),
    },
  };
}

const area = (lots: readonly { w: number; d: number }[]): number => lots.reduce((n, l) => n + l.w * l.d, 0);
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6;

/** Everything that stands within `radius` of the middle of a place: named buildings, the lots built with it, the lattice beyond. */
function standing(spec: WorldSpec, layout: TownLayout, radius: number): { named: number; lots: FabricLot[]; footprint: number } {
  const profile = scaleProfile(spec);
  const lots = [...(layout.fabric?.lots ?? [])];
  const grid = layout.fabric?.grid;
  if (profile && grid) lots.push(...lotsAround(grid, fabricKinds(spec, profile), profile, spec.seed, grid.cx, grid.cz, radius));
  return { named: layout.buildings.length, lots, footprint: area(layout.buildings) + area(lots) };
}

describe('scale of the place', () => {
  it('reads a scale from how settled the land is when none is given, and cleans the fields a model writes', () => {
    expect(scaleFromSettled(0.02, 1)).toBe('lone');
    expect(scaleFromSettled(0.3, 4)).toBe('hamlet');
    expect(scaleFromSettled(0.7, 9)).toBe('town');
    expect(scaleFromSettled(1, 10)).toBe('metropolis');
    expect(scaleFields({ scale: 'Megacity', density: 4, heights: [150, 30], damage: -1 })).toEqual({ scale: 'metropolis', density: 1, heights: [30, 150], damage: 0 });
    expect(scaleFields({ scale: 'huge', heights: 'tall' })).toEqual({});
    for (const s of SITE_SCALES) expect(scaleProfile({ site: { pattern: 'street', wild: 0.3, paths: 'road', spacing: 6, scale: s } })?.scale).toBe(s);
  });

  it('keeps the scale fields through validation and normalising, and a spec without them has none', () => {
    const spec = specAt('metropolis', { damage: 0.6, heights: [25, 150] });
    expect(validateSpec(spec).ok).toBe(true);
    const site = normalizeSpec(spec).site;
    expect(site?.scale).toBe('metropolis');
    expect(site?.heights).toEqual([25, 150]);
    expect(site?.damage).toBe(0.6);
    const old = makeBlueprintSpec({ seed: 77 });
    old.site = { pattern: 'street', wild: 0.3, paths: 'road', spacing: 6 };
    expect(validateSpec(old).ok).toBe(true);
    expect(normalizeSpec(old).site).toEqual({ pattern: 'street', wild: 0.3, paths: 'road', spacing: 6 });
    expect(scaleProfile(old)).toBeNull();
  });
});

describe('fabric of the place', () => {
  it('an old spec without a scale is laid out exactly as before, with no fabric', () => {
    const old = specAt('city');
    delete old.site?.scale;
    delete old.site?.density;
    const layout = generateLayout(old);
    expect(layout.fabric).toBeUndefined();
    expect(layout.buildings).toHaveLength(old.buildings.length);
  });

  it('a wilderness and an outpost get no filler at all', () => {
    for (const scale of ['lone', 'outpost'] as const) {
      const spec = specAt(scale);
      const layout = generateLayout(spec);
      expect(layout.fabric).toBeUndefined();
      expect(layout.buildings).toHaveLength(spec.buildings.length);
      expect(fabricKinds(spec, scaleProfile(spec)!)).toHaveLength(0);
    }
  });

  it('a hamlet gets a few more houses and a village more than that, none on a named building or a road', () => {
    const counts: number[] = [];
    for (const scale of ['hamlet', 'village'] as const) {
      const spec = specAt(scale);
      const layout = generateLayout(spec);
      const lots = layout.fabric?.lots ?? [];
      counts.push(lots.length);
      expect(layout.fabric?.grid).toBeNull();
      expect(lots.length).toBeGreaterThanOrEqual(scale === 'hamlet' ? 2 : 6);
      expect(lots.length).toBeLessThanOrEqual(scale === 'hamlet' ? 6 : 18);
      const named = layout.buildings.map((b) => buildingAabb(b));
      for (const l of lots) {
        const r = lotRect(l);
        expect(named.some((q) => overlap(r, q))).toBe(false);
        expect(layout.roads.some((rd) => overlap(r, roadRect(rd)))).toBe(false);
        expect(r.minX).toBeGreaterThanOrEqual(layout.bounds.minX);
        expect(r.maxX).toBeLessThanOrEqual(layout.bounds.maxX);
      }
    }
    expect(counts[1]).toBeGreaterThan(counts[0] as number);
  });

  it('counts and built ground grow with the scale: a metropolis has far more than a hamlet', () => {
    const totals = (['hamlet', 'village', 'town', 'city', 'metropolis'] as const).map((scale) => {
      const spec = specAt(scale);
      const s = standing(spec, generateLayout(spec), 400);
      return { scale, count: s.named + s.lots.length, footprint: s.footprint };
    });
    const by = Object.fromEntries(totals.map((t) => [t.scale, t]));
    // Hamlet to city, each has more than the last; a metropolis has broader lots on broader blocks, so it is
    // measured by the ground it covers.
    for (let i = 1; i < totals.length - 1; i++) expect(totals[i]!.count).toBeGreaterThan(totals[i - 1]!.count);
    expect(by.metropolis!.footprint).toBeGreaterThan(by.city!.footprint);
    expect(by.city!.footprint).toBeGreaterThan(3 * by.town!.footprint);
    expect(by.town!.footprint).toBeGreaterThan(3 * by.village!.footprint);
    expect(by.metropolis!.footprint).toBeGreaterThan(10 * by.hamlet!.footprint);
    expect(by.metropolis!.count).toBeGreaterThan(20 * by.hamlet!.count);
    expect(by.city!.count).toBeGreaterThan(5 * by.village!.count);
    expect(by.metropolis!.count).toBeGreaterThan(1000);
  });

  it('a city has tall buildings and a metropolis taller ones; a hamlet has none', () => {
    const tallest = (scale: SiteScale, heights?: [number, number]): number => {
      const spec = specAt(scale, { heights });
      return Math.max(...standing(spec, generateLayout(spec), 300).lots.map((l) => l.height));
    };
    expect(tallest('hamlet')).toBeLessThan(13);
    expect(tallest('city')).toBeGreaterThan(35);
    expect(tallest('metropolis')).toBeGreaterThan(90);
    expect(tallest('metropolis', [30, 180])).toBeGreaterThan(150);
    // What the spec says of height is held to what the scale can be.
    expect(tallest('hamlet', [30, 180])).toBeLessThan(18);
    const spec = specAt('metropolis');
    const lots = standing(spec, generateLayout(spec), 300).lots;
    expect(lots.filter((l) => l.tall).length).toBeGreaterThan(20);
    expect(lots.filter((l) => l.height < 30).length).toBeGreaterThan(lots.length * 0.3);
  });

  it('no two neighbours are the same building: next along a street differs in kind or in its own proportions', () => {
    const spec = specAt('metropolis');
    const layout = generateLayout(spec);
    const profile = scaleProfile(spec)!;
    const kinds = fabricKinds(spec, profile);
    const grid = layout.fabric!.grid!;
    let pairs = 0;
    let sameKind = 0;
    for (let j = -4; j <= 4; j++) {
      for (let i = -4; i <= 4; i++) {
        const lots = blockLots(grid, kinds, profile, spec.seed, i, j);
        for (let a = 0; a < lots.length; a++) {
          for (let b = a + 1; b < lots.length; b++) {
            const p = lots[a]!;
            const q = lots[b]!;
            expect(overlap(lotRect(p), lotRect(q))).toBe(false);
            if (Math.hypot(p.x - q.x, p.z - q.z) > (p.w + q.w) / 2 + 4 || p.rotY !== q.rotY) continue;
            pairs++;
            if (p.kind === q.kind) sameKind++;
            const alike = p.kind === q.kind && Math.abs(p.sx - q.sx) < 1e-3 && Math.abs(p.sy - q.sy) < 1e-3 && Math.abs(p.value - q.value) < 1e-3;
            expect(alike).toBe(false);
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(200);
    expect(sameKind / pairs).toBeLessThan(0.2);
    // The kinds themselves differ: no two share a height.
    const heights = kinds.filter((k) => k.role === 'stand').map((k) => Math.round(k.height * 10));
    expect(new Set(heights).size).toBe(heights.length);
  });

  it('blocks are the same every time they are asked for and keep off the streets and the named site', () => {
    const spec = specAt('city');
    const layout = generateLayout(spec);
    const profile = scaleProfile(spec)!;
    const kinds = fabricKinds(spec, profile);
    const grid = layout.fabric!.grid!;
    expect(blockLots(grid, kinds, profile, spec.seed, 3, -2)).toEqual(blockLots(grid, kinds, profile, spec.seed, 3, -2));
    expect(generateLayout(spec)).toEqual(layout);
    const at = blockOf(grid, grid.cx, grid.cz);
    expect(inHole(grid, at.i, at.j)).toBe(true);
    expect(blockLots(grid, kinds, profile, spec.seed, at.i, at.j)).toHaveLength(0);
    for (const l of lotsAround(grid, kinds, profile, spec.seed, grid.cx, grid.cz, 250)) {
      const r = lotRect(l);
      // Clear of every street of the lattice: no lot crosses a centre line.
      const i0 = Math.floor((r.minX - grid.x0) / grid.pitch);
      const j0 = Math.floor((r.minZ - grid.z0) / grid.pitch);
      expect(r.minX - (grid.x0 + i0 * grid.pitch)).toBeGreaterThanOrEqual(grid.street / 2 - 1e-6);
      expect(grid.x0 + (i0 + 1) * grid.pitch - r.maxX).toBeGreaterThanOrEqual(grid.street / 2 - 1e-6);
      expect(r.minZ - (grid.z0 + j0 * grid.pitch)).toBeGreaterThanOrEqual(grid.street / 2 - 1e-6);
      expect(grid.z0 + (j0 + 1) * grid.pitch - r.maxZ).toBeGreaterThanOrEqual(grid.street / 2 - 1e-6);
      expect(overlap(r, grid.hole)).toBe(false);
    }
  });

  it('inside the place the lots stand clear of named buildings, roads, the plaza and one another, for every site pattern', () => {
    for (const pattern of ['street', 'ring', 'scatter', 'grid', 'terraces'] as const) {
      for (const scale of ['town', 'city', 'metropolis'] as const) {
        const spec = specAt(scale, { pattern, seed: 5 });
        const layout = generateLayout(spec);
        const lots = layout.fabric?.lots ?? [];
        expect(lots.length).toBeGreaterThan(8);
        expect(layout.buildings).toHaveLength(spec.buildings.length);
        const named = layout.buildings.map((b) => buildingAabb(b));
        const rects = lots.map((l) => lotRect(l));
        rects.forEach((r, n) => {
          expect(named.some((q) => overlap(r, q))).toBe(false);
          expect(layout.roads.some((rd) => overlap(r, roadRect(rd)))).toBe(false);
          expect(Math.hypot(Math.max(r.minX - layout.plaza.x, 0, layout.plaza.x - r.maxX), Math.max(r.minZ - layout.plaza.z, 0, layout.plaza.z - r.maxZ))).toBeGreaterThan(layout.plaza.r);
          expect(rects.some((q, m) => m > n && overlap(r, q))).toBe(false);
          expect(r.minX >= layout.bounds.minX && r.maxX <= layout.bounds.maxX && r.minZ >= layout.bounds.minZ && r.maxZ <= layout.bounds.maxZ).toBe(true);
        });
        // The spawn point and every named door stay open.
        for (const r of rects) expect(r.minX < layout.spawn.x && r.maxX > layout.spawn.x && r.minZ < layout.spawn.z && r.maxZ > layout.spawn.z).toBe(false);
        // A ring street closes the place, and no prop was scattered into a lot.
        expect(layout.roads.length).toBeGreaterThanOrEqual(4);
        for (const p of layout.props) expect(rects.some((r) => p.x > r.minX + 0.3 && p.x < r.maxX - 0.3 && p.z > r.minZ + 0.3 && p.z < r.maxZ - 0.3)).toBe(false);
      }
    }
  });

  it('a town ends: past its extent the blocks thin out to open land, while a metropolis does not', () => {
    const town = specAt('town');
    const tl = generateLayout(town);
    const tp = scaleProfile(town)!;
    const tg = tl.fabric!.grid!;
    const tk = fabricKinds(town, tp);
    expect(fabricPresence(tg, town.seed, tg.cx, tg.cz)).toBe(1);
    expect(fabricPresence(tg, town.seed, tg.cx + 600, tg.cz)).toBe(0);
    expect(lotsAround(tg, tk, tp, town.seed, tg.cx + 700, tg.cz, 120)).toHaveLength(0);
    const metro = specAt('metropolis');
    const ml = generateLayout(metro);
    const mp = scaleProfile(metro)!;
    const mg = ml.fabric!.grid!;
    expect(lotsAround(mg, fabricKinds(metro, mp), mp, metro.seed, mg.cx + 3000, mg.cz - 2000, 120).length).toBeGreaterThan(80);
  });

  it('war damage breaks part of the fabric and leaves the rest standing', () => {
    const spec = specAt('metropolis', { damage: 0.6 });
    const profile = scaleProfile(spec)!;
    const kinds = fabricKinds(spec, profile);
    const ruins = kinds.map((k, i) => (k.role === 'ruin' ? i : -1)).filter((i) => i >= 0);
    expect(ruins.length).toBeGreaterThan(0);
    const lots = standing(spec, generateLayout(spec), 300).lots;
    const share = lots.filter((l) => ruins.includes(l.kind)).length / lots.length;
    expect(share).toBeGreaterThan(0.12);
    expect(share).toBeLessThan(0.6);
    const whole = specAt('metropolis');
    expect(fabricKinds(whole, scaleProfile(whole)!).some((k) => k.role === 'ruin')).toBe(false);
  });

  it('a world whose own blueprints are all open frames still gets ordinary buildings, and uses the frames as features', () => {
    const spec = specAt('city');
    spec.blueprints = [
      { id: 'mast', summary: 'radio mast', doorX: 0, parts: [part('cylinder', { w: 0.05, d: 0.05, h: 20 }), part('box', { w: 0.3, d: 0.3, h: 0.3 })] },
      { id: 'canopy', summary: 'market canopy', doorX: 0, parts: [part('box', { w: 0.95, d: 0.8, y: 3, h: 0.15, tone: 'roof' }), part('cylinder', { x: -0.4, z: -0.3, w: 0.04, d: 0.04, h: 3, repeat: 2, gap: 0.8 })] },
    ];
    const kinds = fabricKinds(spec, scaleProfile(spec)!);
    expect(kinds.filter((k) => k.role === 'stand').length).toBeGreaterThanOrEqual(6);
    expect(kinds.filter((k) => k.role === 'feature').length).toBe(2);
    for (const k of kinds.filter((q) => q.role === 'stand')) expect(k.bp.parts.length).toBeGreaterThan(2);
  });

  it('stretches a building to a height and reads the height its summary states', () => {
    const parts = [part('box', { w: 0.8, d: 0.8, h: 20 }), part('cone', { w: 0.8, d: 0.8, y: 20, h: 4, tone: 'roof' }), part('box', { z: 0.4, w: 0.2, d: 0.04, h: 2.2, tone: 'dark' })];
    const up = stretchTo(parts, 96);
    expect(Math.max(...up.map((p) => p.y + p.h))).toBeCloseTo(96, 3);
    expect(up[2]!.h).toBeCloseTo(2.2, 6);
    expect(up[1]!.y).toBeCloseTo(up[0]!.h, 6);
    expect(saidHeight({ summary: 'glass office spire, 60 m', parts }, 200)).toBe(60);
    expect(saidHeight({ summary: 'glass office spire, 60 m', parts }, 50)).toBe(50);
    // Never to more than three times what was built: past that the building is pulled out of shape.
    expect(saidHeight({ summary: 'glass office spire, 120 m', parts }, 200)).toBe(72);
    expect(saidHeight({ summary: 'stone tower 24 m', parts }, 200)).toBeNull();
    expect(saidHeight({ summary: 'a low shed', parts }, 200)).toBeNull();
  });
});
