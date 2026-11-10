// Box-projected UVs in metres for non-indexed geometry. Each triangle is projected along its own face
// normal: flat faces take (x, z); everything else takes the horizontal direction across the face as u
// and the direction up the face as v. On a wall v is height, so courses stay level; on a roof v runs up
// the slope, so tiles hang down it. Dividing by the tile size gives texture repeats.
import * as THREE from 'three';

const FLAT = 0.98;

/**
 * Writes the `uv` attribute of a non-indexed geometry from its positions. `tile` is the size of one
 * texture repeat in metres; `uOff`/`vOff` shift the pattern (in repeats) so neighbours do not line up.
 * `turn` swaps u and v, laying the texture on its side: the way to run wood grain along a member
 * whose length is across the grain of the texture.
 */
export function projectWorldUV(geo: THREE.BufferGeometry, tile: number, uOff = 0, vOff = 0, turn = false): void {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const inv = 1 / tile;
  for (let i = 0; i + 2 < n; i += 3) {
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const az = pos.getZ(i);
    const e1x = pos.getX(i + 1) - ax;
    const e1y = pos.getY(i + 1) - ay;
    const e1z = pos.getZ(i + 1) - az;
    const e2x = pos.getX(i + 2) - ax;
    const e2y = pos.getY(i + 2) - ay;
    const e2z = pos.getZ(i + 2) - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      ny = 1;
    }
    const horiz = Math.hypot(nx, nz);
    const flat = Math.abs(ny) > FLAT || horiz === 0;
    // t = up x n (across the face), b = n x t (up the face).
    const tx = flat ? 1 : nz / horiz;
    const tz = flat ? 0 : -nx / horiz;
    const bx = flat ? 0 : -ny * nx / horiz;
    const by = flat ? 0 : horiz;
    const bz = flat ? 1 : -ny * nz / horiz;
    for (let j = 0; j < 3; j++) {
      const x = pos.getX(i + j);
      const y = pos.getY(i + j);
      const z = pos.getZ(i + j);
      const u = (x * tx + z * tz) * inv + uOff;
      const v = (x * bx + y * by + z * bz) * inv + vOff;
      uv[(i + j) * 2] = turn ? v : u;
      uv[(i + j) * 2 + 1] = turn ? u : v;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
