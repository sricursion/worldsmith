// Runs the real character rig in Node against the shipped GLBs (textures stripped, since there is no image
// decoder here) to check the motion layers on actual bones rather than on a stand-in.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fog, Mesh, MeshStandardMaterial, Quaternion, Scene, ShaderLib, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { getGltfLoader } from '../../app/src/engine/gltf';
import {
  CHARACTER_HEIGHT_M, CHARACTER_ROUGHNESS, HEAD_LOOK_LIMIT_RAD, createCharacter, disposeCharacterCache, listAccessories,
  loadCharacterBase, setCharacterQuality, setOutfit, setTalking,
} from '../../app/src/engine/character';
import type { CharacterRig } from '../../app/src/engine/character';
import { makeRng } from '../../app/src/world/rng';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The GLB with images, textures and samplers removed, so the loader never asks for an image decoder. */
function strippedGlb(file: string): ArrayBuffer {
  const buf = readFileSync(join(ROOT, 'assets', 'third_party', 'kaykit-adventurers', `${file}.glb`));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Record<string, unknown> & {
    materials?: { pbrMetallicRoughness?: Record<string, unknown> }[];
    extensionsUsed?: string[];
    extensionsRequired?: string[];
  };
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) delete m.pbrMetallicRoughness?.baseColorTexture;
  const drop = (xs?: string[]): string[] | undefined => xs?.filter((x) => x !== 'EXT_texture_webp');
  json.extensionsUsed = drop(json.extensionsUsed);
  json.extensionsRequired = drop(json.extensionsRequired);
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const jsonBytes = Buffer.from(text, 'utf8');
  const rest = buf.subarray(20 + jsonLen);
  const out = Buffer.alloc(20 + jsonBytes.length + rest.length);
  buf.copy(out, 0, 0, 12);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonBytes.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(out, 20);
  rest.copy(out, 20 + jsonBytes.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length) as ArrayBuffer;
}

const bone = (rig: CharacterRig, name: string): Object3D => {
  const b = rig.root.getObjectByName(name) ?? rig.root.getObjectByName(name.replace('.', ''));
  if (b === undefined) throw new Error(`no bone ${name}`);
  return b;
};
const worldPos = (o: Object3D): Vector3 => {
  o.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(o.matrixWorld);
};
const run = (rig: CharacterRig, seconds: number, each?: (t: number) => void): void => {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    each?.(t);
    rig.update(dt);
  }
};
/** World direction of a bone's local +z; compared against the same bone at rest to read yaw and pitch. */
const facing = (o: Object3D): Vector3 => new Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new Quaternion()));

describe('character rig on the shipped models', () => {
  const loader = getGltfLoader();
  const original = loader.loadAsync.bind(loader);

  beforeAll(async () => {
    loader.loadAsync = (url: string): Promise<GLTF> => {
      const file = /([A-Za-z_]+)\.glb$/.exec(url)?.[1] ?? '';
      return loader.parseAsync(strippedGlb(file), '');
    };
    await Promise.all([loadCharacterBase('knight'), loadCharacterBase('barbarian'), loadCharacterBase('mage'), loadCharacterBase('rogue')]);
  });

  afterAll(() => {
    loader.loadAsync = original;
    disposeCharacterCache();
  });

  it('builds a real rig: scaled to height, matte shaded, shadowed, with a contact blob', () => {
    const rig = createCharacter('knight');
    expect(rig.root.name).toBe('character_Knight');
    let skinned = 0;
    rig.root.traverse((o) => {
      if (!(o instanceof Mesh) || o.name === 'contact_shadow') return;
      skinned++;
      expect(o.castShadow).toBe(true);
      expect(o.receiveShadow).toBe(true);
      const mat = o.material as MeshStandardMaterial;
      expect(mat).toBeInstanceOf(MeshStandardMaterial);
      expect(mat.roughness).toBe(CHARACTER_ROUGHNESS);
      expect(mat.metalness).toBe(0);
      expect(mat.customProgramCacheKey()).toBe('townforge-character-rim');
    });
    expect(skinned).toBeGreaterThanOrEqual(6);
    const blob = rig.root.getObjectByName('contact_shadow') as Mesh;
    expect(blob.castShadow).toBe(false);
    setCharacterQuality(0);
    const strong = (blob.material as { opacity: number }).opacity;
    setCharacterQuality(2);
    expect((blob.material as { opacity: number }).opacity).toBeLessThan(strong);
    run(rig, 0.5);
    // The pack's proportions are stylised: the neck joint sits a little above half height.
    expect(worldPos(bone(rig, 'head')).y).toBeGreaterThan(CHARACTER_HEIGHT_M * 0.45);
    expect(worldPos(bone(rig, 'head')).y).toBeLessThan(CHARACTER_HEIGHT_M * 0.75);
    rig.dispose();
  });

  it('patches the rim into the standard fragment shader', () => {
    const rig = createCharacter('mage');
    let mat: MeshStandardMaterial | null = null;
    rig.root.traverse((o) => {
      if (mat === null && o instanceof Mesh && o.material instanceof MeshStandardMaterial) mat = o.material;
    });
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    (mat as unknown as MeshStandardMaterial).onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uRimColor).toBeDefined();
    expect(shader.uniforms.uRimStrength).toBeDefined();
    expect(shader.fragmentShader).toContain('uniform vec3 uRimColor;');
    expect(shader.fragmentShader.indexOf('outgoingLight += uRimColor')).toBeLessThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'));
    expect(shader.fragmentShader.indexOf('outgoingLight += uRimColor')).toBeGreaterThan(0);
    rig.dispose();
  });

  it('turns the head toward a target at eye level, within its limit, and eases back', () => {
    const rig = createCharacter('rogue');
    const head = bone(rig, 'head');
    run(rig, 1);
    const rest = facing(head);
    rig.lookAt(new Vector3(3, 1.6, 3)); // 45 degrees to the +x side
    run(rig, 2);
    const turned = facing(head);
    const yaw = Math.atan2(turned.x, turned.z) - Math.atan2(rest.x, rest.z);
    expect(yaw).toBeGreaterThan(0.6);
    expect(yaw).toBeLessThan(HEAD_LOOK_LIMIT_RAD + 0.2);
    rig.lookAt(new Vector3(0.2, 4, 2)); // well above eye level: chin up
    run(rig, 2);
    expect(facing(head).y).toBeGreaterThan(rest.y + 0.2);
    rig.lookAt(new Vector3(0, 1.6, -5)); // straight behind: do not crane
    run(rig, 2);
    const behind = facing(head);
    expect(Math.abs(Math.atan2(behind.x, behind.z) - Math.atan2(rest.x, rest.z))).toBeLessThan(0.3);
    rig.lookAt(null);
    run(rig, 2);
    expect(facing(head).distanceTo(rest)).toBeLessThan(0.35);
    rig.dispose();
  });

  it('raises and beats the forearms while talking, and lets them fall when speech stops', () => {
    const rig = createCharacter('barbarian');
    const hand = bone(rig, 'hand.r');
    const head = bone(rig, 'head');
    const sample = (seconds: number): { y: number; z: number; nod: number } => {
      let y = 0;
      let z = 0;
      let n = 0;
      let lo = Infinity;
      let hi = -Infinity;
      run(rig, seconds, () => {
        const p = worldPos(hand);
        y += p.y;
        z += p.z;
        n++;
        const f = facing(head).y;
        lo = Math.min(lo, f);
        hi = Math.max(hi, f);
      });
      return { y: y / n, z: z / n, nod: hi - lo };
    };
    run(rig, 1);
    const quiet = sample(2);
    setTalking(rig, 1);
    run(rig, 1);
    const speaking = sample(2);
    expect(speaking.z).toBeGreaterThan(quiet.z + 0.03); // hands come forward
    expect(speaking.y).toBeGreaterThan(quiet.y + 0.02); // and up
    expect(speaking.nod).toBeGreaterThan(quiet.nod + 0.03); // the head keeps time
    setTalking(rig, 0);
    run(rig, 1.5);
    const after = sample(1);
    expect(Math.abs(after.z - quiet.z)).toBeLessThan(0.03);
    rig.play('talk'); // the clip name alone also talks
    setTalking(rig, -1);
    run(rig, 1);
    expect(sample(1).z).toBeGreaterThan(quiet.z + 0.03);
    rig.dispose();
  });

  it('eases the body toward a new heading and leans into a run', () => {
    const rig = createCharacter('knight');
    const model = rig.root.children[0] as Object3D;
    run(rig, 0.5);
    rig.root.rotation.y = Math.PI / 2;
    rig.update(1 / 60);
    const lag = model.rotation.y;
    expect(lag).toBeLessThan(-1); // still mostly facing the old way
    run(rig, 1);
    expect(Math.abs(model.rotation.y)).toBeLessThan(0.01);
    expect(Math.abs(model.rotation.x)).toBeLessThan(0.01);
    rig.play('run');
    run(rig, 1.5, () => {
      rig.root.position.x += 5 / 60; // 5 m/s along the heading
    });
    expect(model.rotation.x).toBeGreaterThan(0.06);
    expect(model.rotation.x).toBeLessThan(0.21);
    rig.root.position.x += 500; // a teleport is not a sprint
    rig.update(1 / 60);
    expect(model.rotation.x).toBeLessThan(0.21);
    rig.dispose();
  });

  it('stays finite and returns to idle through fidgets over two minutes', () => {
    const scene = new Scene();
    scene.fog = new Fog(0x8899aa, 10, 200);
    const rig = createCharacter('mage');
    scene.add(rig.root);
    run(rig, 120, (t) => {
      rig.play('idle');
      if (Math.floor(t) % 40 === 20) rig.play('talk');
    });
    rig.root.traverse((o) => {
      for (const v of [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.position.x, o.position.y, o.position.z]) expect(Number.isFinite(v)).toBe(true);
    });
    for (const name of ['gesture', 'cheer', 'use', 'look_around', 'sit', 'wave'] as const) {
      rig.play(name);
      run(rig, 0.4);
    }
    rig.play('walk');
    run(rig, 0.5);
    expect(worldPos(bone(rig, 'head')).y).toBeGreaterThan(CHARACTER_HEIGHT_M * 0.45);
    rig.dispose();
    expect(rig.root.parent).toBeNull();
    rig.update(0.016);
  });

  it('dresses real rigs by role and theme', () => {
    const shown = (base: 'knight' | 'barbarian' | 'mage' | 'rogue', theme: 'western' | 'medieval' | 'scifi' | 'modern', role: string): string[] => {
      const rig = createCharacter(base);
      setOutfit(rig, { theme, role, rng: makeRng(9, role) });
      const names = listAccessories(rig.root).filter((a) => a.mesh.visible).map((a) => a.accessory.name).sort();
      rig.dispose();
      return names;
    };
    expect(shown('mage', 'western', 'sheriff')).toContain('Mage_Hat');
    expect(shown('knight', 'medieval', 'monk')).not.toContain('Knight_Helmet');
    expect(shown('knight', 'medieval', 'gate guard')).toEqual(expect.arrayContaining(['Knight_Helmet', '1H_Sword']));
    expect(shown('knight', 'scifi', 'security officer').filter((n) => /Sword|Shield/.test(n))).toEqual([]);
    expect(shown('barbarian', 'western', 'bartender')).toContain('Mug');
    expect(listAccessories(createCharacter('rogue').root).length).toBe(6);
  });
});
