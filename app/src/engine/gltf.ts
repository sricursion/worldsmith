// Shared glTF loading helpers: one GLTFLoader with the meshopt decoder attached, plus
// small utilities for turning a loaded scene into a ground-aligned, shadow-casting template.
import { Box3, Group, Mesh, Vector3 } from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let loader: GLTFLoader | null = null;

export function getGltfLoader(): GLTFLoader {
  if (loader === null) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

export function loadGltf(url: string): Promise<GLTF> {
  return getGltfLoader().loadAsync(url);
}

export function enableShadows(obj: Object3D): void {
  obj.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

export interface NormalizedTemplate {
  /** Origin at the footprint centre on the ground (y = 0 at the lowest point). */
  object: Group;
  /** Axis-aligned size of the content in metres. */
  size: Vector3;
}

/** Wraps a loaded scene so its footprint is centred on x/z and its base rests on y = 0. */
export function normalizeTemplate(scene: Object3D): NormalizedTemplate {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const wrapper = new Group();
  wrapper.name = scene.name;
  if (box.isEmpty()) {
    wrapper.add(scene);
    return { object: wrapper, size: new Vector3() };
  }
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  scene.position.x -= centre.x;
  scene.position.z -= centre.z;
  scene.position.y -= box.min.y;
  wrapper.add(scene);
  return { object: wrapper, size };
}
