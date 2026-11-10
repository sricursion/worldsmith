// Developer page: renders every skeleton with default and random dials so the bones can be judged by eye.
import * as THREE from 'three';
import { SKELETONS, buildSkeleton } from './world/skeletons';
import { makeRng } from './world/rng';
import type { Blueprint, StyleSpec } from './world/spec';
import { addBlueprint, addPropParts } from './town/blueprint-mesh';
import { GeoBatch, MaterialCache } from './town/batch';

const STYLES: StyleSpec[] = [
  { name: 'frontier timber', wall: '#b98a5e', wall2: '#8a5f3c', roof: '#7a3b2a', trim: '#e9dcc3', accent: '#2f7d7a', dark: '#2a211c', glass: '#22313a', glow: '#ffc76b', ground: '#c9a46a', road: '#a8875a', variety: 0.5 },
  { name: 'moon base', wall: '#d9dee6', wall2: '#9aa6b5', roof: '#5d6b7d', trim: '#f4f6f9', accent: '#ff7a3d', dark: '#232a33', glass: '#16334a', glow: '#6fe3ff', ground: '#5b5a63', road: '#484750', variety: 0.3 },
  { name: 'mushroom grove', wall: '#e8dcc6', wall2: '#7b5a44', roof: '#c2413b', trim: '#fff4dc', accent: '#3f9a57', dark: '#2b2030', glass: '#3a2c4a', glow: '#b7ff8a', ground: '#4f7a4a', road: '#6b5a40', variety: 0.6 },
  { name: 'lacquered Edo', wall: '#efe6d2', wall2: '#5b3a2a', roof: '#2f3a44', trim: '#a2332b', accent: '#c9a23a', dark: '#1e1a18', glass: '#3b3a34', glow: '#ffd98a', ground: '#8d9370', road: '#77705c', variety: 0.3 },
  { name: 'neon arcology', wall: '#4a5270', wall2: '#343a52', roof: '#5d6890', trim: '#9aa8cf', accent: '#ff3da6', dark: '#171a24', glass: '#1c5a8c', glow: '#3dfff0', ground: '#3a3f52', road: '#2a2e3c', variety: 0.2 },
];

const W = 500;
const H = 420;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;

function renderCell(family: string, dials: Record<string, number | string>, style: StyleSpec, seed: number): HTMLCanvasElement {
  const sk = SKELETONS[family];
  if (!sk) throw new Error(`unknown skeleton ${family}`);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#aecbe6');
  scene.add(new THREE.HemisphereLight('#dfeaff', '#6b5a45', 0.9));
  const sun = new THREE.DirectionalLight('#fff1d8', 2.6);
  sun.position.set(14, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: style.ground, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const batch = new GeoBatch();
  const mats = new MaterialCache();
  const rng = makeRng(seed, 'gallery');
  const parts = buildSkeleton(family, dials, seed); // clamps and defaults every dial, as the game does
  if (sk.group === 'structure') {
    const bp: Blueprint = { id: family, summary: sk.summary, parts, doorX: 0 };
    addBlueprint(bp, style, { x: 0, z: 0, rotY: Math.PI, w: 9, d: 8 }, { batch, mats, rng });
  } else {
    addPropParts(parts, 3, style, { x: 0, z: 0, rotY: 0, scale: 1 }, { batch, mats, rng });
  }
  const meshes = batch.build();
  const box = new THREE.Box3();
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    box.expandByObject(m);
  }
  const size = box.getSize(new THREE.Vector3());
  // A 1.75 m figure for scale.
  const figure = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.19, 4, 8), new THREE.MeshStandardMaterial({ color: '#e0523a' }));
  figure.position.set(size.x / 2 + 1.2, 0.875, size.z / 2 + 0.6);
  figure.castShadow = true;
  scene.add(figure);

  const r = Math.max(size.x, size.y, size.z, 3);
  const cam = new THREE.PerspectiveCamera(38, W / H, 0.1, 400);
  const c = box.getCenter(new THREE.Vector3());
  cam.position.set(c.x + r * 1.15, c.y + r * 0.75 + 1, c.z + r * 1.45);
  cam.lookAt(c.x, Math.max(c.y * 0.9, 0.8), c.z);
  renderer.render(scene, cam);

  const out = document.createElement('canvas');
  out.className = 'cell';
  out.width = W;
  out.height = H;
  out.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
  for (const m of meshes) m.geometry.dispose();
  ground.geometry.dispose();
  figure.geometry.dispose();
  mats.dispose();
  return out;
}

function randomDials(family: string, seed: number): Record<string, number | string> {
  const sk = SKELETONS[family];
  const rng = makeRng(seed, family);
  const d: Record<string, number | string> = {};
  for (const dial of sk?.dials ?? []) {
    if (dial.kind === 'choice' && dial.choices?.length) d[dial.name] = rng.pick(dial.choices);
    else d[dial.name] = Math.round(rng.range(dial.min ?? 0, dial.max ?? 1) * 100) / 100;
  }
  return d;
}

const rows = document.getElementById('rows');
const report: Record<string, number> = {};
for (const [id, sk] of Object.entries(SKELETONS)) {
  const section = document.createElement('section');
  section.id = id;
  const h = document.createElement('h2');
  h.textContent = `${id} (${sk.group})`;
  const sum = document.createElement('div');
  sum.className = 'sum';
  sum.textContent = `${sk.summary} Becomes: ${sk.becomes.join(', ')}.`;
  const row = document.createElement('div');
  row.className = 'row';
  for (let i = 0; i < 6; i++) {
    const dials = i === 0 ? {} : randomDials(id, 100 + i);
    const fig = document.createElement('figure');
    try {
      fig.append(renderCell(id, dials, STYLES[i % STYLES.length] as StyleSpec, 7 + i));
      report[id] = (report[id] ?? 0) + 1;
    } catch (err) {
      fig.textContent = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    const cap = document.createElement('figcaption');
    cap.textContent = i === 0 ? 'defaults' : Object.entries(dials).map(([k, v]) => `${k}=${v}`).join(' ');
    fig.append(cap);
    row.append(fig);
  }
  section.append(h, sum, row);
  rows?.append(section);
}
(window as unknown as { __gallery?: unknown }).__gallery = report;
