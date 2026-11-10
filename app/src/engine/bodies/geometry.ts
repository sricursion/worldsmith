// Turns a body plan into render data: one merged, rigidly skinned geometry with smooth normals and
// baked vertex colour (lighter belly, darker back and extremities), a second one for the glowing parts,
// and the small tiling textures that give hide its pattern and grain.
import {
  BufferGeometry, Color, DataTexture, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial,
  Quaternion, RepeatWrapping, RGBAFormat, SRGBColorSpace, Uint16BufferAttribute, Vector2, Vector3,
} from 'three';
import type { BodyPattern, BodyPlan, BodySegment, BodyTone, V3 } from '../../world/bodies';
import { restPositions } from '../../world/bodies';
import { hash32 } from '../../world/rng';

export interface BodyColors {
  body: string; accent: string; glow: string;
  skin?: string; cloth?: string; cloth2?: string; trim?: string; hair?: string; dark?: string;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const HSL = { h: 0, s: 0, l: 0 };

/** Pulls a colour toward what hide, cloth and stone really look like: no pure primaries, no pure white or black. */
export function groundedColor(hex: string, out: Color, maxSat = 0.5): Color {
  try {
    out.set(hex);
  } catch {
    out.set(0x7a7168);
  }
  if (!Number.isFinite(out.r + out.g + out.b)) out.set(0x7a7168);
  out.getHSL(HSL, SRGBColorSpace);
  return out.setHSL(HSL.h, Math.min(HSL.s * 0.82, maxSat), clamp(HSL.l, 0.05, 0.74), SRGBColorSpace);
}

function toneColors(c: BodyColors): Record<BodyTone, Color> {
  const g = (hex: string | undefined, fallback: string, sat = 0.5): Color => groundedColor(hex ?? fallback, new Color(), sat);
  const body = g(c.body, '#7a6a58');
  const accent = g(c.accent, c.body);
  const dark = c.dark !== undefined ? g(c.dark, c.dark) : body.clone().multiplyScalar(0.22);
  return {
    body, accent, dark,
    glow: g(c.glow, '#ffb060', 0.9),
    skin: g(c.skin, c.body, 0.45),
    cloth: g(c.cloth, c.body),
    cloth2: g(c.cloth2, c.accent),
    trim: g(c.trim, c.accent),
    hair: c.hair !== undefined ? g(c.hair, c.hair) : accent.clone().multiplyScalar(0.4),
  };
}

// ---- Mesh writer ------------------------------------------------------------------------------------

class Writer {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  readonly skin: number[] = [];
  readonly idx: number[] = [];
  count = 0;
  private readonly p = new Vector3();
  private readonly n = new Vector3();
  private readonly q = new Quaternion();
  private readonly o = new Vector3();
  private joint = 0;
  private color = new Color();
  private shade = 1;
  private natural = false;
  private salt = 0;

  begin(seg: BodySegment, origin: V3, color: Color, salt: number): void {
    this.q.set(seg.quat[0], seg.quat[1], seg.quat[2], seg.quat[3]);
    this.o.set(origin[0] + seg.pos[0], origin[1] + seg.pos[1], origin[2] + seg.pos[2]);
    this.joint = seg.joint;
    this.color = color;
    this.shade = seg.shade;
    this.natural = seg.tone === 'body' || seg.tone === 'accent' || seg.tone === 'skin';
    this.salt = salt;
  }
  /** Adds a vertex given in the segment's own frame. Returns its index. */
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number): number {
    this.p.set(x, y, z).applyQuaternion(this.q).add(this.o);
    this.n.set(nx, ny, nz).applyQuaternion(this.q).normalize();
    return this.raw(this.p.x, this.p.y, this.p.z, this.n.x, this.n.y, this.n.z, u, w);
  }
  /** Adds a vertex already in body space (offset by the joint origin only). */
  raw(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    // Countershading: undersides catch bounce light and are paler on most animals; backs are darker.
    let k = this.shade;
    let lift = 0;
    if (this.natural) {
      k *= 1 - 0.12 * Math.max(0, ny);
      lift = 0.3 * Math.max(0, -ny - 0.25);
    }
    const jitter = ((hash32(`${this.salt}|${this.count}`) & 0xff) / 255 - 0.5) * 0.06;
    k *= 1 + jitter;
    const c = this.color;
    this.col.push(c.r * k + (0.5 * (c.r + c.g + c.b) / 1.5 + 0.03) * lift * k, c.g * k + (0.5 * (c.r + c.g + c.b) / 1.5 + 0.03) * lift * k, c.b * k + (0.5 * (c.r + c.g + c.b) / 1.5 + 0.02) * lift * k);
    this.uv.push(u, w);
    this.skin.push(this.joint);
    return this.count++;
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    const si = new Uint16Array(this.count * 4);
    const sw = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      si[i * 4] = this.skin[i] ?? 0;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Rings of a surface of revolution with an elliptical section: each ring is [y, radius scale, normal y]. */
function lathe(w: Writer, rings: [number, number, number][], rx: number, rz: number, radial: number, tile: number): void {
  const girth = Math.PI * (rx + rz);
  const reps = Math.max(1, Math.round(girth / tile));
  const start = w.count;
  for (const [y, k, ny] of rings) {
    const flat = Math.sqrt(Math.max(0, 1 - ny * ny));
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      w.v(cx * rx * k, y, cz * rz * k, (cx / rx) * flat * Math.min(rx, rz), ny, (cz / rz) * flat * Math.min(rx, rz), (s / radial) * reps, y / tile);
    }
  }
  const row = radial + 1;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < radial; s++) {
      const a = start + r * row + s;
      w.quad(a, a + row, a + row + 1, a + 1);
    }
  }
}

function capsule(w: Writer, seg: BodySegment, radial: number, hemi: number, tile: number): void {
  const rx = seg.size[0] / 2, rz = seg.size[2] / 2;
  const t = seg.taper;
  const half = seg.size[1] / 2;
  const yb = -half + rx;
  const yt = Math.max(yb, half - rx * t);
  const rings: [number, number, number][] = [];
  for (let i = 0; i <= hemi; i++) {
    const phi = -Math.PI / 2 + (i / hemi) * (Math.PI / 2);
    rings.push([yb + rx * Math.sin(phi), Math.max(0.02, Math.cos(phi)), Math.sin(phi)]);
  }
  for (let i = 0; i <= hemi; i++) {
    const phi = (i / hemi) * (Math.PI / 2);
    rings.push([yt + rx * t * Math.sin(phi), Math.max(0.02, Math.cos(phi)) * t, Math.sin(phi)]);
  }
  lathe(w, rings, rx, rz, radial, tile);
}

function ellipsoid(w: Writer, seg: BodySegment, radial: number, stacks: number, tile: number): void {
  const rx = seg.size[0] / 2, ry = seg.size[1] / 2, rz = seg.size[2] / 2;
  const rings: [number, number, number][] = [];
  const squash = Math.min(rx, rz) / Math.max(1e-6, ry);
  for (let i = 0; i <= stacks; i++) {
    const phi = -Math.PI / 2 + (i / stacks) * Math.PI;
    // Normal of an ellipsoid leans toward its short axis.
    const ny = Math.sin(phi) * squash;
    const nn = ny / Math.hypot(ny, Math.cos(phi));
    rings.push([ry * Math.sin(phi), Math.max(0.02, Math.cos(phi)), nn]);
  }
  lathe(w, rings, rx, rz, radial, tile);
}

function cone(w: Writer, seg: BodySegment, radial: number, tile: number): void {
  const rx = seg.size[0] / 2, rz = seg.size[2] / 2;
  const half = seg.size[1] / 2;
  const slope = Math.min(rx, rz) / Math.max(1e-6, seg.size[1]);
  const ny = slope / Math.hypot(1, slope);
  lathe(w, [[-half, 0.02, -1], [-half, 1, -0.4], [-half, 1, ny], [0, 0.5, ny], [half, 0.03, ny]], rx, rz, radial, tile);
}

function box(w: Writer, seg: BodySegment, tile: number): void {
  const h: V3 = [seg.size[0] / 2, seg.size[1] / 2, seg.size[2] / 2];
  for (let axis = 0; axis < 3; axis++) {
    for (const sgn of [-1, 1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const n: V3 = [0, 0, 0];
      n[axis] = sgn;
      const ids: number[] = [];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const p: V3 = [0, 0, 0];
        p[axis] = sgn * (h[axis] as number);
        p[u] = a * (h[u] as number);
        p[v] = b * (h[v] as number);
        ids.push(w.v(p[0], p[1], p[2], n[0], n[1], n[2], (p[u] as number) / tile, (p[v] as number) / tile));
      }
      if (sgn > 0) w.quad(ids[0] as number, ids[1] as number, ids[2] as number, ids[3] as number);
      else w.quad(ids[3] as number, ids[2] as number, ids[1] as number, ids[0] as number);
    }
  }
}

const sa = new Vector3();
const sb = new Vector3();
const sn = new Vector3();

/** A flat polygon drawn on both faces, so wings and fins light correctly from either side. */
function sheet(w: Writer, seg: BodySegment, origin: V3, tile: number): void {
  const pts = seg.pts;
  if (pts === undefined || pts.length < 9) return;
  const n = Math.floor(pts.length / 3);
  const at = (i: number, out: Vector3): Vector3 => out.set((pts[i * 3] ?? 0) + origin[0], (pts[i * 3 + 1] ?? 0) + origin[1], (pts[i * 3 + 2] ?? 0) + origin[2]);
  sn.set(0, 0, 0);
  for (let i = 1; i < n - 1; i++) {
    at(i, sa).sub(at(0, sb));
    const c = at(i + 1, new Vector3()).sub(sb);
    sn.add(sa.cross(c));
  }
  if (sn.lengthSq() < 1e-12) sn.set(0, 1, 0);
  sn.normalize();
  for (const face of [1, -1]) {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      at(i, sa);
      ids.push(w.raw(sa.x, sa.y, sa.z, sn.x * face, sn.y * face, sn.z * face, (sa.x + sa.y * 0.37) / tile, (sa.z + sa.y * 0.61) / tile));
    }
    for (let i = 1; i < n - 1; i++) {
      if (face > 0) w.idx.push(ids[0] as number, ids[i] as number, ids[i + 1] as number);
      else w.idx.push(ids[0] as number, ids[i + 1] as number, ids[i] as number);
    }
  }
}

export interface BodyGeometry { main: BufferGeometry; glow: BufferGeometry | null }

/** One geometry for the lit body and one for its glowing parts, both skinned one joint per vertex. */
export function buildBodyGeometry(plan: BodyPlan, colors: BodyColors, quality: 0 | 1 | 2 = 2, seed = 1): BodyGeometry {
  const tones = toneColors(colors);
  const at = restPositions(plan);
  const main = new Writer();
  const glow = new Writer();
  // Small bodies and low tiers get fewer sides; a 12 m dragon gets the full count.
  const big = plan.size > 3 ? 2 : 0;
  const radial = [6, 8, 10][quality] as number + big;
  const hemi = quality === 0 ? 2 : 3;
  const tile = Math.max(0.04, Math.max(plan.meta.height, plan.meta.length) * 0.22);
  plan.segments.forEach((seg, i) => {
    const w = seg.tone === 'glow' ? glow : main;
    const origin = at[seg.joint] ?? [0, 0, 0];
    w.begin(seg, origin, tones[seg.tone], seed * 131 + i);
    const thin = Math.min(seg.size[0], seg.size[2]) < plan.meta.height * 0.02;
    const r = thin ? Math.max(5, radial - 3) : radial;
    if (seg.shape === 'capsule') capsule(w, seg, r, thin ? 2 : hemi, tile);
    else if (seg.shape === 'ellipsoid') ellipsoid(w, seg, r + 2, thin ? 4 : hemi * 2, tile);
    else if (seg.shape === 'cone') cone(w, seg, r, tile);
    else if (seg.shape === 'box') box(w, seg, tile);
    else sheet(w, seg, origin, tile);
  });
  return { main: main.geometry(), glow: glow.count > 0 ? glow.geometry() : null };
}

// ---- Pattern textures --------------------------------------------------------------------------------

const frac = (x: number): number => x - Math.floor(x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const cell = (x: number, y: number, period: number, salt: number): number => {
  const xi = ((x % period) + period) % period, yi = ((y % period) + period) % period;
  return (hash32(`${salt}|${xi}|${yi}`) & 0xffff) / 0xffff;
};
/** Tiling value noise, period `p` cells across the unit square. */
function noise(u: number, v: number, p: number, salt: number): number {
  const x = u * p, y = v * p;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(0, 1, x - x0), fy = smooth(0, 1, y - y0);
  const a = cell(x0, y0, p, salt), b = cell(x0 + 1, y0, p, salt), c = cell(x0, y0 + 1, p, salt), d = cell(x0 + 1, y0 + 1, p, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Distance to the nearest jittered point on a tiling p x p grid, in cells. */
function worley(u: number, v: number, p: number, salt: number): number {
  const x = u * p, y = v * p;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const px = x0 + i + 0.2 + 0.6 * cell(x0 + i, y0 + j, p, salt), py = y0 + j + 0.2 + 0.6 * cell(x0 + i, y0 + j, p, salt + 7);
      best = Math.min(best, Math.hypot(px - x, py - y));
    }
  }
  return best;
}

/** Albedo multiplier (0..1) and relief height (0..1) of a pattern at a point of its unit tile. */
export function patternSample(pattern: BodyPattern, u: number, v: number): { tint: number; height: number } {
  const grain = noise(u, v, 16, 3) * 0.6 + noise(u, v, 32, 5) * 0.4;
  if (pattern === 'stripes') {
    const s = Math.sin(Math.PI * 2 * (3 * v + 0.16 * Math.sin(Math.PI * 2 * u) + 0.22 * noise(u, v, 4, 11)));
    return { tint: 1 - 0.42 * smooth(0.25, 0.6, s) - 0.05 * grain, height: grain };
  }
  if (pattern === 'spots') return { tint: 1 - 0.4 * (1 - smooth(0.2, 0.34, worley(u, v, 5, 13))) - 0.05 * grain, height: grain };
  if (pattern === 'patches') return { tint: 1 - 0.36 * smooth(0.5, 0.58, noise(u, v, 3, 17) * 0.8 + noise(u, v, 8, 19) * 0.2) - 0.05 * grain, height: grain };
  if (pattern === 'scales') {
    const p = 8;
    const row = Math.floor(v * p);
    const x = frac(u * p + (row % 2) * 0.5) - 0.5, y = frac(v * p) - 0.35;
    const d = Math.hypot(x * 1.05, y * 0.95);
    const dome = clamp(1 - d * 1.6, 0, 1);
    return { tint: 0.72 + 0.28 * Math.sqrt(dome) - 0.04 * grain, height: dome };
  }
  return { tint: 0.92 + 0.08 * grain, height: grain };
}

const TEX = 64;
const textures = new Map<string, DataTexture>();
const materials = new Map<string, MeshStandardMaterial>();

function finishTexture(t: DataTexture, srgb: boolean): DataTexture {
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Raw RGBA bytes of a pattern's albedo and normal tiles; exported so a test can look at them. */
export function patternPixels(pattern: BodyPattern, size = TEX): { albedo: Uint8Array; normal: Uint8Array } {
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = patternSample(pattern, (x + 0.5) / size, (y + 0.5) / size);
      const i = (y * size + x) * 4;
      // sRGB-encode the multiplier so the linear value the shader sees is the tint itself.
      const e = Math.round(255 * Math.pow(clamp(s.tint, 0, 1), 1 / 2.2));
      albedo[i] = e;
      albedo[i + 1] = e;
      albedo[i + 2] = e;
      albedo[i + 3] = 255;
      hgt[y * size + x] = s.height;
    }
  }
  const strength = pattern === 'scales' ? 2.2 : 0.9;
  const H = (x: number, y: number): number => hgt[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = Math.round(255 * (0.5 - (0.5 * dx) / l));
      normal[i + 1] = Math.round(255 * (0.5 - (0.5 * dy) / l));
      normal[i + 2] = Math.round(255 * (0.5 + 0.5 / l));
      normal[i + 3] = 255;
    }
  }
  return { albedo, normal };
}

function patternTextures(pattern: BodyPattern): { map: DataTexture; normalMap: DataTexture } {
  let map = textures.get(`${pattern}|a`);
  let normalMap = textures.get(`${pattern}|n`);
  if (map === undefined || normalMap === undefined) {
    const px = patternPixels(pattern);
    map = finishTexture(new DataTexture(px.albedo, TEX, TEX, RGBAFormat), true);
    normalMap = finishTexture(new DataTexture(px.normal, TEX, TEX, RGBAFormat), false);
    textures.set(`${pattern}|a`, map);
    textures.set(`${pattern}|n`, normalMap);
  }
  return { map, normalMap };
}

/** Shared lit material for a pattern: colour comes from the vertices, so every body of that pattern uses one program. */
export function bodyMaterial(pattern: BodyPattern): MeshStandardMaterial {
  let m = materials.get(pattern);
  if (m === undefined) {
    const t = patternTextures(pattern);
    m = new MeshStandardMaterial({
      vertexColors: true, map: t.map, normalMap: t.normalMap,
      normalScale: new Vector2(pattern === 'scales' ? 0.9 : 0.4, pattern === 'scales' ? 0.9 : 0.4),
      roughness: pattern === 'scales' ? 0.62 : 0.84, metalness: 0,
    });
    m.name = `body_${pattern}`;
    materials.set(pattern, m);
  }
  return m;
}

/** Shared emissive material for one glow colour. The surface itself stays dark so only the light reads. */
export function glowMaterial(hex: string): MeshStandardMaterial {
  const c = groundedColor(hex, new Color(), 0.9);
  const key = `glow|${c.getHexString()}`;
  let m = materials.get(key);
  if (m === undefined) {
    m = new MeshStandardMaterial({ color: c.clone().multiplyScalar(0.25), emissive: c, emissiveIntensity: 2.6, roughness: 0.5, metalness: 0 });
    m.name = key;
    materials.set(key, m);
  }
  return m;
}

/** Releases the shared textures and materials. Bodies created earlier must be disposed first. */
export function disposeBodyCache(): void {
  for (const t of textures.values()) t.dispose();
  for (const m of materials.values()) m.dispose();
  textures.clear();
  materials.clear();
}
