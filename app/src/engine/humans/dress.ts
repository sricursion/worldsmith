// Per-person materials. The GLBs use flat-colour materials named by garment ("Skin", "Hair", "Suit", "LightBlue", ...),
// so a person is dressed by cloning those materials and setting their colours: skin tone, hair, and the clothing slots
// the catalogue lists for the model. Two-tone garments keep their relative shading. Everything stays matte and muted.
import { Color, Mesh, MeshStandardMaterial } from 'three';
import type { Material, Object3D } from 'three';
import type { HumanColors, HumanModel } from './catalog';

export interface Dressing {
  /** One private clone per distinct material of the model. */
  materials: MeshStandardMaterial[];
  /** Original (pack) colour of each clone, for relative shading. */
  base: Map<MeshStandardMaterial, Color>;
}

const METALLIC = /metal|gold|earring/i;

function luminance(c: Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Replaces every material on the model with a private MeshStandardMaterial clone and enables shadows. */
export function cloneMaterials(model: Object3D, castShadow: boolean, receiveShadow: boolean): Dressing {
  const made = new Map<Material, MeshStandardMaterial>();
  const materials: MeshStandardMaterial[] = [];
  const base = new Map<MeshStandardMaterial, Color>();
  const convert = (m: Material): MeshStandardMaterial => {
    const known = made.get(m);
    if (known !== undefined) return known;
    const src = m as Partial<MeshStandardMaterial>;
    const out = new MeshStandardMaterial({
      name: m.name,
      color: src.color instanceof Color ? src.color.clone() : new Color('#8a8a8a'),
      map: src.map ?? null,
      roughness: 0.82,
      metalness: METALLIC.test(m.name) ? 0.25 : 0,
    });
    made.set(m, out);
    materials.push(out);
    base.set(out, out.color.clone());
    return out;
  };
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.material = Array.isArray(o.material) ? (o.material as Material[]).map(convert) : convert(o.material as Material);
    o.castShadow = castShadow;
    o.receiveShadow = receiveShadow;
  });
  return { materials, base };
}

const tmp = new Color();

/** Sets the colour of every clone whose name is in `names`; the darkest and lightest keep their relative values. */
function paint(d: Dressing, names: readonly string[] | undefined, hex: string, scale = 1): void {
  if (names === undefined || names.length === 0) return;
  const hit = d.materials.filter((m) => names.includes(m.name));
  if (hit.length === 0) return;
  let top = 0;
  for (const m of hit) top = Math.max(top, luminance(d.base.get(m) ?? m.color));
  for (const m of hit) {
    const rel = top > 1e-4 ? luminance(d.base.get(m) ?? m.color) / top : 1;
    tmp.set(hex);
    m.color.copy(tmp).multiplyScalar(scale * (0.7 + 0.3 * rel));
  }
}

/** Applies a person's colours to their clones. Safe to call again with new colours. */
export function applyColors(d: Dressing, entry: HumanModel, c: HumanColors): void {
  const skinNames = entry.skin;
  for (const n of skinNames) paint(d, [n], c.skin, n === 'Skin_Darker' ? 0.9 : 1);
  for (const n of entry.hair) paint(d, [n], c.hair, /brow|base/i.test(n) ? 0.8 : 1);
  paint(d, entry.slots.top, c.top);
  paint(d, entry.slots.bottom, c.bottom);
  paint(d, entry.slots.accent, c.accent);
  paint(d, entry.slots.hat, c.hat);
}

export function disposeDressing(d: Dressing): void {
  for (const m of d.materials) m.dispose();
  d.materials.length = 0;
  d.base.clear();
}
