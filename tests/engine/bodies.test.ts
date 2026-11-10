import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBody, createFigure, figurePlan, planFigure } from '../../app/src/engine/bodies';
import { CREATURE_FAMILIES, buildBody } from '../../app/src/world/bodies';
import type { FolkSpec, ThemeId } from '../../app/src/world/spec';

const COLORS = { body: '#6a5a48', accent: '#3a3028', glow: '#ff8a3a' };
const allFinite = (root: THREE.Object3D): boolean => {
  let ok = true;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    for (const v of o.matrixWorld.elements) if (!Number.isFinite(v)) ok = false;
  });
  return ok;
};
const finiteArray = (xs: ArrayLike<number>): boolean => {
  for (let i = 0; i < xs.length; i++) if (!Number.isFinite(xs[i])) return false;
  return true;
};

describe('bodies', () => {
  it('poses every family through every mode without a bad number', () => {
    for (const family of CREATURE_FAMILIES) {
      const rig = createBody(buildBody(family, {}, family === 'colossus' ? 20 : 2, 4), COLORS, { quality: 1, seed: 4 });
      let mesh: THREE.SkinnedMesh | null = null;
      rig.root.traverse((o) => {
        if (mesh === null && o instanceof THREE.SkinnedMesh) mesh = o;
      });
      const geo = (mesh as unknown as THREE.SkinnedMesh).geometry;
      expect(geo.getAttribute('position').count, family).toBeGreaterThan(20);
      expect(finiteArray(geo.getAttribute('position').array), family).toBe(true);
      expect(finiteArray(geo.getAttribute('normal').array), family).toBe(true);
      const target = new THREE.Vector3(3, 1, 4);
      for (const mode of ['ground', 'air', 'water', 'hover', 'sleep', 'sit'] as const) {
        rig.setMode(mode);
        rig.lookAt(mode === 'sleep' ? target : null);
        for (let f = 0; f < 40; f++) {
          rig.root.position.x += 0.05 * Math.sin(f * 0.1);
          rig.root.position.z += 0.06;
          rig.root.rotation.y += 0.02;
          rig.update(1 / 30);
        }
        expect(allFinite(rig.root), `${family} ${mode}`).toBe(true);
      }
      rig.dispose();
    }
  });

  it('dresses a person by role and folk, at believable proportions', () => {
    const themes: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];
    for (const theme of themes) {
      for (const role of ['guard', 'priest', 'blacksmith', 'merchant', 'drifter', 'pilot', 'townsperson']) {
        const plan = figurePlan({ role, theme, seed: 11 });
        const heads = plan.meta.height / plan.meta.headHeight;
        expect(heads, `${theme} ${role}`).toBeGreaterThan(6.6);
        expect(heads, `${theme} ${role}`).toBeLessThan(8.4);
        expect(plan.size).toBeGreaterThan(1.5);
        expect(plan.size).toBeLessThan(1.95);
      }
    }
    expect(planFigure({ role: 'priest', theme: 'medieval', seed: 2 }).dials['outfit']).toBe('robe');
    expect(planFigure({ role: 'town guard', theme: 'medieval', seed: 2 }).dials['outfit']).toBe('armor');
    const folk: FolkSpec = { name: 'kobolds', height: 1.1, bulk: 0.3, head: 1.2, features: ['tail', 'snout', 'horns'], skin: ['#7a5a3a'], cloth: ['#4a4038'], trim: ['#2a2a2a'] };
    const p = planFigure({ folk, role: 'miner', theme: 'medieval', seed: 5 });
    expect(p.size).toBeGreaterThan(1);
    expect(p.size).toBeLessThan(1.2);
    expect(p.dials['tail']).toBe(1);
    expect(p.colors.skin).toBe('#7a5a3a');
    expect(planFigure({ folk, role: 'miner', theme: 'medieval', seed: 5 })).toEqual(p);
  });

  it('offers the character rig interface and moves when walked', () => {
    const fig = createFigure({ role: 'baker', theme: 'western', seed: 3, quality: 1 });
    expect(fig.root).toBeInstanceOf(THREE.Object3D);
    expect(fig.mixer).toBeInstanceOf(THREE.AnimationMixer);
    fig.setPalette(2, 'western');
    const plan = fig.body.plan;
    const hip = fig.root.getObjectByName(plan.joints[plan.legs[0]?.hip ?? 0]?.name ?? '') as THREE.Object3D;
    const arm = fig.root.getObjectByName(plan.joints[plan.arms[0]?.elbow ?? 0]?.name ?? '') as THREE.Object3D;
    const still = hip.quaternion.clone();
    fig.play('walk');
    let swing = 0;
    for (let f = 0; f < 90; f++) {
      fig.root.position.z += 1.4 / 60;
      fig.update(1 / 60);
      swing = Math.max(swing, hip.quaternion.angleTo(still));
    }
    expect(swing).toBeGreaterThan(0.15);
    expect(fig.body.speed()).toBeGreaterThan(1);
    for (const clip of ['idle', 'talk', 'sit', 'wave', 'run', 'gesture', 'cheer', 'use', 'look_around'] as const) {
      fig.play(clip);
      for (let f = 0; f < 20; f++) fig.update(1 / 60);
      expect(allFinite(fig.root), clip).toBe(true);
    }
    fig.play('idle');
    for (let f = 0; f < 120; f++) fig.update(1 / 60);
    const quiet = arm.quaternion.clone();
    fig.setTalking(1);
    let talk = 0;
    for (let f = 0; f < 60; f++) {
      fig.update(1 / 60);
      talk = Math.max(talk, arm.quaternion.angleTo(quiet));
    }
    expect(talk).toBeGreaterThan(0.2);
    fig.lookAt(new THREE.Vector3(2, 1.6, 2));
    fig.update(1 / 60);
    expect(allFinite(fig.root)).toBe(true);
    fig.dispose();
    fig.update(1 / 60);
  });
});
