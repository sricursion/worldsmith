// Material cache and per-material geometry merging for the procedural parts of a town.
// Everything added to a GeoBatch has its world transform baked in, so the merged meshes sit at the
// identity matrix and feed the navmesh and BVH directly.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MaterialOpts { emissive?: string; emissiveIntensity?: number; roughness?: number; metalness?: number }

export class MaterialCache {
  private readonly map = new Map<string, THREE.MeshStandardMaterial>();

  get(color: string, opts: MaterialOpts = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? 0}|${opts.roughness ?? 0.9}|${opts.metalness ?? 0}`;
    let m = this.map.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: opts.roughness ?? 0.9,
        metalness: opts.metalness ?? 0,
        emissive: new THREE.Color(opts.emissive ?? '#000000'),
        emissiveIntensity: opts.emissiveIntensity ?? 0,
      });
      this.map.set(key, m);
    }
    return m;
  }

  dispose(): void {
    for (const m of this.map.values()) m.dispose();
    this.map.clear();
  }
}

export class GeoBatch {
  private readonly buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();

  /** Takes ownership of `geo` (it is disposed) and stores a transformed non-indexed copy. */
  add(geo: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    g.clearGroups();
    g.applyMatrix4(matrix);
    let b = this.buckets.get(material.uuid);
    if (!b) {
      b = { material, geos: [] };
      this.buckets.set(material.uuid, b);
    }
    b.geos.push(g);
  }

  /** One mesh per material. The returned meshes own their merged geometry; materials stay with their cache. */
  build(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const { material, geos } of this.buckets.values()) {
      const merged = mergeGeometries(geos, false);
      if (merged) {
        for (const g of geos) g.dispose();
        merged.computeBoundingSphere();
        meshes.push(this.mesh(merged, material));
      } else {
        for (const g of geos) meshes.push(this.mesh(g, material));
      }
    }
    this.buckets.clear();
    return meshes;
  }

  private mesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }
}
