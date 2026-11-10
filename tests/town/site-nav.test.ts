import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildNav } from '../../app/src/engine/nav';
import { buildTown } from '../../app/src/town/build';
import { buildingAabb, generateLayout } from '../../app/src/town/layout';
import type { SitePattern } from '../../app/src/world/spec';
import { PATTERNS, makeBlueprintSpec, makeSiteSpec, part, stubKit } from './helpers';

function vertexCount(meshes: THREE.Mesh[]): number {
  return meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
}

describe('site towns feed the navmesh', () => {
  for (const pattern of PATTERNS) {
    for (const paths of ['road', 'none'] as const) {
      it(`${pattern} (${paths}): navmesh builds and every door is reachable near the spawn's mesh`, async () => {
        const spec = makeSiteSpec({ pattern, count: 9, seed: 42, wild: 0.8, paths });
        const layout = generateLayout(spec);
        const town = buildTown(layout, spec, stubKit('medieval'), new THREE.Scene());
        const ground = town.statics.find((m) => m.name === 'ground');
        expect(ground).toBeTruthy();
        const nav = await buildNav(town.statics, ground!);
        const spawn = nav.nearest(new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z));
        expect(Math.hypot(spawn.x - layout.spawn.x, spawn.z - layout.spawn.z)).toBeLessThan(3);
        for (const d of town.doors.values()) {
          const n = nav.nearest(d);
          expect(Math.hypot(n.x - d.x, n.z - d.z), `${pattern} door`).toBeLessThan(3);
        }
        for (const p of layout.walkable.slice(0, 40)) {
          const n = nav.nearest(new THREE.Vector3(p.x, 0, p.z));
          expect(Math.hypot(n.x - p.x, n.z - p.z)).toBeLessThan(3);
        }
        const foot = layout.buildings.map(buildingAabb);
        expect(foot.length).toBe(9);
        nav.dispose();
        town.dispose();
      }, 120000);
    }
  }

  it('drawn roads are skipped for paths none and narrowed for track', () => {
    const roadsOf = (pattern: SitePattern, paths: 'road' | 'track' | 'none'): number => {
      const spec = makeSiteSpec({ pattern, count: 9, seed: 5, paths });
      const town = buildTown(generateLayout(spec), spec, stubKit('medieval'), new THREE.Scene());
      const n = town.group.children.filter((c) => c.name === 'road').length;
      town.dispose();
      return n;
    };
    expect(roadsOf('grid', 'road')).toBeGreaterThan(3);
    expect(roadsOf('grid', 'none')).toBe(0);
    expect(roadsOf('scatter', 'track')).toBeGreaterThan(5);
  });

  it('props smaller than 0.8 m render but stay out of the statics', () => {
    const base = makeBlueprintSpec({ count: 8, seed: 9 });
    const spec = {
      ...base,
      site: { pattern: 'scatter' as const, wild: 1, paths: 'track' as const, spacing: 6 },
      props: [{ kind: 'pebble', size: 0.5, weight: 1, parts: [part('sphere', { w: 1, d: 1, h: 0.6 })] }],
    };
    const layout = generateLayout(spec);
    expect(layout.props.length).toBeGreaterThan(100);
    const withProps = buildTown(layout, spec, stubKit('medieval'), new THREE.Scene());
    const without = buildTown({ ...layout, props: [] }, spec, stubKit('medieval'), new THREE.Scene());
    expect(vertexCount(withProps.statics)).toBe(vertexCount(without.statics));
    const visible = (t: typeof withProps): number => t.group.children.reduce((n, c) => (c instanceof THREE.Mesh ? n + c.geometry.getAttribute('position').count : n), 0);
    expect(visible(withProps)).toBeGreaterThan(visible(without));
    withProps.dispose();
    without.dispose();
  });
});
