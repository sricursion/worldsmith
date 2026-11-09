// Shop signs: a plank whose front face carries the building label rendered to a CanvasTexture.
// Under Node (no document) the sign falls back to a plain plank, so the builder still runs in tests.
import * as THREE from 'three';

interface SignData {
  canvas: HTMLCanvasElement | null;
  texture: THREE.CanvasTexture | null;
  board: string;
  ink: string;
  disposed: boolean;
}

const data = new WeakMap<THREE.Object3D, SignData>();
const CANVAS_W = 512;
const CANVAS_H = 128;
const FALLBACK_FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

function inkFor(board: string): string {
  const c = new THREE.Color(board);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return lum > 0.45 ? '#2a1f16' : '#f6efe0';
}

function paint(canvas: HTMLCanvasElement, text: string, board: string, ink: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = board;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, CANVAS_W - 16, CANVAS_H - 16);
  ctx.globalAlpha = 1;
  let size = 64;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  do {
    ctx.font = `bold ${size}px ${FALLBACK_FONT}`;
    size -= 4;
  } while (ctx.measureText(text).width > CANVAS_W - 48 && size > 16);
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 3);
}

/** Creates a sign plank facing local -Z. Position and rotate the returned mesh (or its parent) yourself. */
export function createSign(label: string, board: string, width: number): THREE.Mesh {
  const ink = inkFor(board);
  const plank = new THREE.MeshStandardMaterial({ color: new THREE.Color(board).multiplyScalar(0.55), roughness: 0.85 });
  const face = new THREE.MeshStandardMaterial({ color: new THREE.Color(board), roughness: 0.8 });
  const info: SignData = { canvas: null, texture: null, board, ink, disposed: false };
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    paint(canvas, label, board, ink);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    face.map = texture;
    face.color.set('#ffffff');
    info.canvas = canvas;
    info.texture = texture;
    // Redraw once the page fonts are ready, in case the first paint used a fallback face.
    void document.fonts?.ready.then(() => {
      if (info.disposed || !info.canvas) return;
      paint(info.canvas, label, board, ink);
      texture.needsUpdate = true;
    });
  }
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, width / 4, 0.12),
    [plank, plank, plank, plank, plank, face], // +x -x +y -y +z -z: the -Z face carries the label
  );
  mesh.castShadow = true;
  mesh.name = 'sign';
  data.set(mesh, info);
  return mesh;
}

/** Redraws a sign made by createSign with new text. */
export function setSignLabel(sign: THREE.Object3D, label: string): void {
  const info = data.get(sign);
  if (!info?.canvas || !info.texture) return;
  paint(info.canvas, label, info.board, info.ink);
  info.texture.needsUpdate = true;
}

export function disposeSign(sign: THREE.Mesh): void {
  const info = data.get(sign);
  if (info) {
    info.disposed = true;
    info.texture?.dispose();
  }
  sign.geometry.dispose();
  const mats = Array.isArray(sign.material) ? sign.material : [sign.material];
  for (const m of new Set(mats)) m.dispose();
}
