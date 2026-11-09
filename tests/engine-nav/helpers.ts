import * as THREE from 'three';

/** 60x60 ground plus box obstacles, no renderer. Boxes: [cx, cz, w, d, h]. */
export function makeWorld(boxes: [number, number, number, number, number][] = [[0, 0, 8, 8, 4]]): {
  ground: THREE.Mesh;
  statics: THREE.Mesh[];
} {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  const statics = boxes.map(([x, z, w, d, h]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    m.position.set(x, h / 2, z);
    m.updateMatrixWorld(true);
    return m;
  });
  return { ground, statics };
}

export function disposeMeshes(meshes: THREE.Mesh[]): void {
  for (const m of meshes) {
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
}
