// How big the place is. A prompt names a lighthouse rock, a hamlet, a market town or a megacity, and the spec
// carries that as SiteSpec.scale with how crowded it is, how tall it is typically built and how much of it is
// damaged. Everything that sizes the built world reads the one profile made here: how far the fabric of the
// place runs past its named structures, how wide its streets and blocks are, how many people are on them.
//
// A spec without a scale (an old share link) has no profile: it is built exactly as it always was.
//
// Pure module: no three, no DOM. The worker uses the same coercion as the client.
import type { SiteScale, SiteSpec, WorldSpec } from './spec';

export const SITE_SCALES: readonly SiteScale[] = ['lone', 'outpost', 'hamlet', 'village', 'town', 'city', 'metropolis'];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Words a model writes in place of a scale it was given. */
const ALIASES: Record<string, SiteScale> = {
  wilderness: 'lone', wild: 'lone', solitary: 'lone', single: 'lone', none: 'lone', camp: 'outpost', base: 'outpost', station: 'outpost',
  settlement: 'hamlet', farm: 'hamlet', farmstead: 'hamlet', suburb: 'town', district: 'city', megacity: 'metropolis', megalopolis: 'metropolis',
  capital: 'metropolis', arcology: 'metropolis',
};

export function scaleWord(v: unknown): SiteScale | undefined {
  if (typeof v !== 'string') return undefined;
  const w = v.trim().toLowerCase();
  return SITE_SCALES.find((s) => s === w) ?? ALIASES[w];
}

/** The scale a place has when nobody said: read from how settled the land is. */
export function scaleFromSettled(settled: number, structures: number): SiteScale {
  if (structures === 0 || settled < 0.06) return 'lone';
  if (settled < 0.22) return structures <= 1 ? 'lone' : 'outpost';
  if (settled < 0.38) return 'hamlet';
  if (settled < 0.62) return 'village';
  if (settled < 0.86) return 'town';
  return settled >= 0.97 ? 'metropolis' : 'city';
}

/**
 * The scale fields of a site as written by a model or carried by a link, cleaned: only the ones that are
 * present and usable come back, so a site that never had them still has none.
 */
export function scaleFields(raw: Record<string, unknown>): Pick<SiteSpec, 'scale' | 'density' | 'heights' | 'damage'> {
  const out: Pick<SiteSpec, 'scale' | 'density' | 'heights' | 'damage'> = {};
  const scale = scaleWord(raw['scale']);
  if (scale) out.scale = scale;
  if (finite(raw['density'])) out.density = clamp(raw['density'], 0, 1);
  if (finite(raw['damage'])) out.damage = clamp(raw['damage'], 0, 1);
  const h = raw['heights'];
  if (Array.isArray(h) && finite(h[0]) && finite(h[1])) {
    const lo = clamp(Math.min(h[0], h[1]), 2, 80);
    out.heights = [Math.round(lo), Math.round(clamp(Math.max(h[0], h[1]), lo, 200))];
  }
  return out;
}

export interface ScaleProfile {
  scale: SiteScale;
  /** 0 lone .. 6 metropolis. */
  level: number;
  /** none: only what the spec names. rural: a few more houses round the named ones. urban: blocks and streets. */
  fabric: 'none' | 'rural' | 'urban';
  /** 0..1: how full the streets are of people and clutter. */
  density: number;
  /** Typical height of what is built, metres: most stand near `low`, the tallest reach `high`. */
  low: number; high: number;
  /** 0..1: how much of the fabric is broken. */
  damage: number;
  /** Urban: centre line to centre line of the street lattice, and the width of a street, metres. */
  pitch: number; street: number;
  /** How far the fabric runs from the middle before it thins out, metres. Infinity: it never does. */
  extent: number;
  /** Rural: houses added round the named ones. */
  extras: number;
  /** People on the streets around the walker at full quality. */
  crowd: number;
}

interface Row { fabric: ScaleProfile['fabric']; low: number; high: number; pitch: number; street: number; extent: number; extras: number; crowd: number }
const ROWS: Record<SiteScale, Row> = {
  lone: { fabric: 'none', low: 3, high: 8, pitch: 0, street: 0, extent: 0, extras: 0, crowd: 0 },
  outpost: { fabric: 'none', low: 3, high: 9, pitch: 0, street: 0, extent: 0, extras: 0, crowd: 0 },
  hamlet: { fabric: 'rural', low: 4, high: 8, pitch: 0, street: 0, extent: 70, extras: 5, crowd: 5 },
  village: { fabric: 'rural', low: 4, high: 11, pitch: 0, street: 0, extent: 120, extras: 12, crowd: 9 },
  town: { fabric: 'urban', low: 6, high: 16, pitch: 46, street: 7, extent: 240, extras: 0, crowd: 26 },
  city: { fabric: 'urban', low: 10, high: 45, pitch: 56, street: 9, extent: 700, extras: 0, crowd: 70 },
  metropolis: { fabric: 'urban', low: 14, high: 110, pitch: 64, street: 11, extent: Number.POSITIVE_INFINITY, extras: 0, crowd: 120 },
};

/** The profile of a world, or null when its spec says nothing of scale. */
export function scaleProfile(spec: Pick<WorldSpec, 'site'>): ScaleProfile | null {
  const site = spec.site;
  const scale = site ? scaleWord(site.scale) : undefined;
  if (!site || !scale) return null;
  const row = ROWS[scale];
  const level = SITE_SCALES.indexOf(scale);
  const density = finite(site.density) ? clamp(site.density, 0, 1) : 0.5;
  let low = row.low;
  let high = row.high;
  if (site.heights && finite(site.heights[0]) && finite(site.heights[1])) {
    // The spec's own range, held to what this scale can be: a hamlet has no towers whatever it says.
    low = clamp(site.heights[0], 2.5, row.high);
    high = clamp(site.heights[1], Math.max(low + 1, row.low + 2), level >= 5 ? 200 : row.high * 1.6);
  }
  return {
    scale, level, fabric: row.fabric, density, low, high, damage: finite(site.damage) ? clamp(site.damage, 0, 1) : 0,
    pitch: row.pitch, street: row.street, extent: row.extent, extras: Math.round(row.extras * (0.6 + 0.8 * density)),
    crowd: Math.round(row.crowd * (0.45 + 1.1 * density)),
  };
}

/** One line for the stages that design the look and the story, so they build for the scale too. */
export function scaleBrief(site: Pick<SiteSpec, 'scale' | 'density' | 'heights' | 'damage'>): string {
  if (!site.scale) return '';
  const h = site.heights ? `, built ${site.heights[0]} to ${site.heights[1]} m tall` : '';
  const d = finite(site.density) ? `, crowding ${site.density}` : '';
  const w = finite(site.damage) && site.damage > 0.05 ? `, damage ${site.damage}` : '';
  return ` Scale: ${site.scale}${h}${d}${w}.`;
}
