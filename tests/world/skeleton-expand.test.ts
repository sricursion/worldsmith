import { describe, expect, it } from 'vitest';
import { lintBlueprint } from '../../app/src/world/blueprints';
import { FIXTURES } from '../../app/src/world/fixtures';
import { box } from '../../app/src/world/fixtures/util';
import { normalizeSpec, validateSpec, worldSpecJsonSchema } from '../../app/src/world/schema';
import { buildSkeleton } from '../../app/src/world/skeletons';
import type { ThemeId, WorldSpec } from '../../app/src/world/spec';

const clone = (s: WorldSpec): WorldSpec => structuredClone(s);
const THEMES: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

function withFamily(): WorldSpec {
  const s = clone(FIXTURES.western);
  s.seed = 4242;
  s.blueprints = [
    {
      id: 'needle', family: 'tower', dials: { height: 20, section: 'hex', top: 'needle', taper: 0.6 },
      summary: 'a glass needle', parts: [box(0, 0.3, 4, 0.1, 0.03, 0.5, 'glow')], doorX: 0,
    },
    { id: 'plain_hall', family: 'hall', dials: { storeys: 2, roof: 'barrel' }, summary: 'a hall', parts: [], doorX: 0.2 },
    { id: 'legacy', summary: 'old style', parts: structuredClone(FIXTURES.western.blueprints![0]!.parts), doorX: 0 },
  ];
  s.props = [
    { family: 'tree', dials: { crown: 'cactus' }, kind: 'cactus', size: 2, parts: [], weight: 2 },
    { family: 'not_a_family', kind: 'bare', size: 1, parts: [box(0, 0, 0, 0.5, 0.5, 0.5, 'wall')], weight: 1 },
  ];
  s.buildings.forEach((b, i) => { b.blueprint = (s.blueprints ?? [])[i % 3]!.id; });
  return s;
}

describe('skeleton expansion in normalizeSpec', () => {
  it('puts skeleton parts first, then the model parts, and drops family and dials', () => {
    const n = normalizeSpec(withFamily());
    const needle = n.blueprints!.find((b) => b.id === 'needle')!;
    expect(needle.family).toBeUndefined();
    expect(needle.dials).toBeUndefined();
    const bones = buildSkeleton('tower', { height: 20, section: 'hex', top: 'needle', taper: 0.6 }, 0);
    expect(needle.parts.length).toBe(bones.length + 1);
    expect(needle.parts.at(-1)).toMatchObject({ tone: 'glow', shape: 'box' });
    expect(needle.parts[0]?.shape).toBe(bones[0]?.shape);
    expect(lintBlueprint(needle)).toEqual([]);
    const hall = n.blueprints!.find((b) => b.id === 'plain_hall')!;
    expect(hall.parts.length).toBeGreaterThanOrEqual(4);
    expect(hall.parts.some((p) => p.shape === 'arch')).toBe(true);
  });

  it('expands props and leaves unknown families to their own parts', () => {
    const n = normalizeSpec(withFamily());
    const cactus = n.props!.find((p) => p.kind === 'cactus')!;
    expect(cactus.parts.length).toBeGreaterThanOrEqual(4);
    expect(cactus.parts.length).toBeLessThanOrEqual(28);
    expect(cactus.family).toBeUndefined();
    const bare = n.props!.find((p) => p.kind === 'bare')!;
    expect(bare.parts).toHaveLength(1);
    expect((bare as { family?: string }).family).toBeUndefined();
  });

  it('is deterministic and idempotent, and the result still validates', () => {
    const s = withFamily();
    const once = normalizeSpec(s);
    expect(normalizeSpec(s)).toEqual(once);
    expect(normalizeSpec(once)).toEqual(once);
    expect(validateSpec(JSON.parse(JSON.stringify(once))).ok).toBe(true);
  });

  it('caps expanded parts at 28 with the skeleton first', () => {
    const s = withFamily();
    const own = box(0.3, 0.3, 0, 0.1, 0.1, 1, 'accent');
    s.blueprints![1]!.parts = Array.from({ length: 40 }, () => ({ ...own }));
    const hall = normalizeSpec(s).blueprints!.find((b) => b.id === 'plain_hall')!;
    expect(hall.parts).toHaveLength(28);
    const bones = buildSkeleton('hall', { storeys: 2, roof: 'barrel' }, 0);
    expect(hall.parts.slice(0, bones.length).map((p) => p.shape)).toEqual(bones.map((p) => p.shape));
  });

  it('survives garbage dials in a spec', () => {
    const s = withFamily();
    s.blueprints![0]!.dials = { height: 'tall', section: 7, taper: -4, junk: 'x' } as unknown as Record<string, number | string>;
    const n = normalizeSpec(s);
    expect(n.blueprints![0]!.parts.length).toBeGreaterThanOrEqual(4);
    expect(lintBlueprint(n.blueprints![0]!)).toEqual([]);
  });

  it('gives different worlds different bones when their families differ', () => {
    const a = withFamily();
    const b = withFamily();
    b.blueprints![0]!.family = 'shell';
    b.blueprints![0]!.dials = { stalk: 4 };
    const pa = normalizeSpec(a).blueprints![0]!.parts.map((p) => p.shape).join();
    const pb = normalizeSpec(b).blueprints![0]!.parts.map((p) => p.shape).join();
    expect(pa).not.toEqual(pb);
  });
});

describe('site', () => {
  it('is optional, kept as given when valid, and clamped otherwise', () => {
    const s = clone(FIXTURES.western);
    expect(normalizeSpec(s).site).toBeUndefined();
    s.site = { pattern: 'ring', wild: 0.4, paths: 'track', spacing: 6 };
    expect(normalizeSpec(s).site).toEqual({ pattern: 'ring', wild: 0.4, paths: 'track', spacing: 6 });
    s.site = { pattern: 'ring', wild: 9, paths: 'none', spacing: 100 };
    expect(normalizeSpec(s).site).toEqual({ pattern: 'ring', wild: 1, paths: 'none', spacing: 14 });
    s.site = { pattern: 'ring', wild: -3, paths: 'road', spacing: 0 };
    expect(normalizeSpec(s).site).toMatchObject({ wild: 0, spacing: 2 });
    s.site = { pattern: 'spiral' as never, wild: Number.NaN, paths: 'road', spacing: Number.NaN };
    expect(normalizeSpec(s).site).toMatchObject({ pattern: 'street', wild: 0, spacing: 2 });
  });

  it('validateSpec turns an unknown pattern into street instead of failing', () => {
    const raw = JSON.parse(JSON.stringify(FIXTURES.western)) as Record<string, unknown>;
    raw.site = { pattern: 'spiral', wild: 0.5, paths: 'cobbles', spacing: 5 };
    const r = validateSpec(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.site).toMatchObject({ pattern: 'street', paths: 'road' });
  });
});

describe('model schema for skeletons', () => {
  it('declares family, dials and site', () => {
    const schema = worldSpecJsonSchema() as {
      required: string[];
      properties: Record<string, { items: { properties: Record<string, { type?: string; additionalProperties?: unknown }>; required: string[] } }>;
    };
    expect(schema.required).toContain('site');
    for (const k of ['blueprints', 'props']) {
      const items = schema.properties[k]!.items;
      expect(items.properties.family?.type).toBe('string');
      expect(items.properties.dials?.type).toBe('object');
      expect(items.properties.dials?.additionalProperties).toEqual({ anyOf: [{ type: 'number' }, { type: 'string' }] });
      expect(items.required).toEqual(expect.arrayContaining(['family', 'dials']));
    }
  });
});

describe('existing fixtures', () => {
  it.each(THEMES)('%s still validates and round-trips through normalizeSpec unchanged in shape', (t) => {
    const spec = FIXTURES[t];
    expect(validateSpec(JSON.parse(JSON.stringify(spec))).ok).toBe(true);
    const n = normalizeSpec(spec);
    expect(normalizeSpec(n)).toEqual(n);
    expect(n.blueprints?.map((b) => b.parts.length)).toEqual(spec.blueprints?.map((b) => b.parts.length));
    for (const b of n.blueprints ?? []) expect(b.family).toBeUndefined();
  });
});
