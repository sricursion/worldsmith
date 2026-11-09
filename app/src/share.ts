// Share links: the world spec, deflated and base64url-encoded into the URL hash.
// The navmesh and layout are never serialised; they are rebuilt from the spec.

import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import type { WorldSpec } from './world/spec';
import { validateSpec, normalizeSpec } from './world/schema';

const PREFIX = 'w1.';

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function encodeShare(spec: WorldSpec): string {
  const json = JSON.stringify(spec);
  return PREFIX + toBase64Url(deflateSync(strToU8(json), { level: 9 }));
}

export function decodeShare(hash: string): WorldSpec | null {
  if (!hash.startsWith(PREFIX)) return null;
  const bytes = fromBase64Url(hash.slice(PREFIX.length));
  if (!bytes) return null;
  try {
    const raw: unknown = JSON.parse(strFromU8(inflateSync(bytes)));
    const v = validateSpec(raw);
    return v.ok ? normalizeSpec(v.value) : null;
  } catch {
    return null;
  }
}
