// Live check of POST /api/compile against a running worker. Skipped unless LIVE=1.
//   npx wrangler dev --config worker/wrangler.toml --port 8797 --local      (separate shell)
//   LIVE=1 npx vitest run tests/worker/_live/live.manual.test.ts
// Each merged spec is saved to tests/worker/_live/out/<slug>.json.
// Optional: LIVE_OUT=path (append one JSON line per prompt), LIVE_BASE=http://127.0.0.1:8797, LIVE_PROMPT="..." to run one prompt.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GRADE_KINDS, SURFACE_KINDS, WEATHER_KINDS, normalizeSpec, slugify, validateSpec } from '../../../app/src/world/schema';
import type { GradeKind, SurfaceKind, WeatherKind, WorldSpec } from '../../../app/src/world/spec';
import { repairQuest, verifyQuest } from '../../../app/src/world/verify';

const LIVE = process.env.LIVE === '1';
const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:8797';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

/** What a prompt must come out as. Every list is "any of"; an absent field is not checked. */
interface Fit {
  weather?: WeatherKind[];
  grade?: GradeKind[];
  /** At least one of these kinds appears among wall, wall2, roof and trim. */
  built?: SurfaceKind[];
  /** At least one of these kinds is the ground or the road. */
  floor?: SurfaceKind[];
  wet?: [number, number];
  wear?: [number, number];
  /** Starting hour window; from > to wraps past midnight. */
  hour?: [number, number];
}

const CASES: { prompt: string; fit: Fit }[] = [
  {
    prompt: 'a rain-soaked container port at dawn, cranes overhead, sodium lights',
    fit: { weather: ['rain', 'storm'], built: ['corrugated', 'rusted', 'metal_panel', 'hull_plate'], floor: ['concrete', 'asphalt'], wet: [0.5, 1], hour: [4.5, 8] },
  },
  {
    prompt: 'Wild West 1899, a small town in Middle America, guns and trouble',
    fit: { weather: ['dust', 'clear', 'embers'], grade: ['golden', 'sepia', 'teal_orange', 'bleached', 'crimson'], built: ['planks', 'timber', 'log', 'adobe', 'brick'], floor: ['dirt', 'sand', 'gravel', 'mud'], wet: [0, 0.35] },
  },
  {
    prompt: 'a forest of giant glowing mushrooms where tiny folk live',
    fit: { weather: ['spores', 'fireflies', 'mist', 'fog'], grade: ['verdant', 'moonlit', 'neon_noir', 'teal_orange'], built: ['organic', 'bark'], floor: ['moss', 'dirt', 'grass', 'mud'] },
  },
  {
    prompt: 'a city of needle-thin glass towers in 2400',
    fit: { built: ['glass_curtain'], floor: ['concrete', 'asphalt', 'metal_panel', 'stone', 'glass_curtain'], wear: [0, 0.45] },
  },
  {
    prompt: 'a snowbound mountain monastery at night',
    fit: { weather: ['snow'], grade: ['moonlit', 'cold_steel'], built: ['stone', 'timber', 'log', 'plaster', 'brick'], floor: ['snow', 'ice'], hour: [19.5, 5] },
  },
];
const ONLY = process.env.LIVE_PROMPT;
const RUNS = ONLY ? [CASES.find((c) => c.prompt === ONLY) ?? { prompt: ONLY, fit: {} }] : CASES;

interface Run {
  events: { event: string; t: number; data: unknown }[];
  error: string | null;
}

async function compile(prompt: string): Promise<Run> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/compile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, seed: 1899 }) });
  if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
  const run: Run = { events: [], error: null };
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1] ?? '';
      const raw = /^data: (.*)$/m.exec(frame)?.[1];
      let data: unknown = null;
      try {
        data = raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        data = null;
      }
      run.events.push({ event, t: (Date.now() - t0) / 1000, data });
      if (event === 'error') run.error = raw ?? 'error';
    }
  }
  return run;
}

const at = (r: Run, name: string): number | null => r.events.find((e) => e.event === name)?.t ?? null;

interface LookEvent {
  style?: { name?: string; surfaces?: Record<string, unknown> };
  blueprints?: { id?: string; family?: string; dials?: Record<string, unknown>; parts: { tone?: string }[] }[];
  props?: { kind: string; family?: string; dials?: unknown }[];
}
interface OutlineEvent {
  mood?: { weather?: string; grade?: string; ambience?: unknown[]; music?: string };
  time?: { startHour?: number };
  palette?: { sky?: string; fog?: number };
}

const within = (v: number, [lo, hi]: [number, number]): boolean => (lo <= hi ? v >= lo && v <= hi : v >= lo || v <= hi);

/** Where the spec misses what the prompt asked for; empty when it fits. */
function misfits(spec: WorldSpec, fit: Fit): string[] {
  const out: string[] = [];
  const mood = spec.mood;
  const s = spec.style?.surfaces;
  if (!mood || !s) return ['mood or surfaces missing'];
  if (fit.weather && !fit.weather.includes(mood.weather)) out.push(`weather ${mood.weather}`);
  if (fit.grade && !fit.grade.includes(mood.grade)) out.push(`grade ${mood.grade}`);
  const built = [s.wall, s.wall2, s.roof, s.trim];
  if (fit.built && !fit.built.some((k) => built.includes(k))) out.push(`built ${built.join('/')}`);
  if (fit.floor && !fit.floor.includes(s.ground) && !fit.floor.includes(s.road)) out.push(`floor ${s.ground}/${s.road}`);
  if (fit.wet && !within(s.wet, fit.wet)) out.push(`wet ${s.wet}`);
  if (fit.wear && !within(s.wear, fit.wear)) out.push(`wear ${s.wear}`);
  if (fit.hour && !within(spec.time.startHour, fit.hour)) out.push(`hour ${spec.time.startHour}`);
  return out;
}

describe.skipIf(!LIVE)('live compile', () => {
  it.each(RUNS)('$prompt', async ({ prompt, fit }) => {
    const run = await compile(prompt);
    expect(run.error).toBeNull();
    const spec = run.events.find((e) => e.event === 'spec')?.data;
    const look = run.events.find((e) => e.event === 'look')?.data as LookEvent | undefined;
    const outline = run.events.find((e) => e.event === 'outline')?.data as OutlineEvent | undefined;
    const valid = validateSpec(spec);
    if (!valid.ok) console.log('INVALID', prompt, valid.error);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${slugify(prompt, 'world').slice(0, 32).replace(/_+$/, '')}.json`), `${JSON.stringify(spec, null, 2)}\n`);

    const norm = normalizeSpec(valid.value);
    const raw = verifyQuest(norm);
    const fixed = verifyQuest(repairQuest(norm));
    const pings = run.events.filter((e) => e.event === 'ping').length;
    const stamps = run.events.map((e) => e.t);
    let gap = stamps[0] ?? 0;
    for (let i = 1; i < stamps.length; i++) gap = Math.max(gap, (stamps[i] ?? 0) - (stamps[i - 1] ?? 0));
    const bad = misfits(norm, fit);
    const glow = (look?.blueprints ?? []).reduce((n, b) => n + b.parts.filter((p) => p.tone === 'glow').length, 0);
    const line = JSON.stringify({
      prompt, outline_s: at(run, 'outline'), look_s: at(run, 'look'), spec_s: at(run, 'spec'), pings, max_gap_s: Math.round(gap * 10) / 10,
      buildings: norm.buildings.length, npcs: norm.npcs.length, steps: norm.quest.steps.length,
      winnable_raw: raw.winnable, winnable_repaired: fixed.winnable, problems: raw.problems.slice(0, 3),
      hour: norm.time.startHour, sky: norm.palette.sky, fog: norm.palette.fog, mood: norm.mood, style: norm.style?.name, surfaces: norm.style?.surfaces,
      outline_mood: outline?.mood?.weather ?? null, glow_parts: glow, misfits: bad,
      families: (look?.blueprints ?? []).map((b) => ({ id: b.id ?? null, family: b.family ?? null, dials: b.dials ?? null, extra: b.parts.length })),
      props: (look?.props ?? []).map((p) => ({ kind: p.kind, family: p.family ?? null })),
    });
    console.log(line);
    if (process.env.LIVE_OUT) appendFileSync(process.env.LIVE_OUT, `${line}\n`);

    expect(fixed.winnable).toBe(true);
    expect(at(run, 'look')).not.toBeNull();
    expect(at(run, 'look') ?? 99).toBeLessThan(30);

    // The outline event already carries the air, so the client can set sky and sound in the first seconds.
    expect(WEATHER_KINDS).toContain(outline?.mood?.weather);
    expect(GRADE_KINDS).toContain(outline?.mood?.grade);
    expect(typeof outline?.time?.startHour).toBe('number');
    // The look event carries the materials, and the merged spec carries both, unchanged by normalisation.
    expect(SURFACE_KINDS).toContain(look?.style?.surfaces?.wall);
    expect(valid.value.mood).toEqual(norm.mood);
    expect(valid.value.style?.surfaces).toEqual(norm.style?.surfaces);
    expect(norm.mood?.ambience.length ?? 0).toBeGreaterThan(0);
    // The model wrote the look itself (a fallback look has no skeleton families).
    expect((look?.blueprints ?? []).some((b) => typeof b.family === 'string' && b.family.length > 0)).toBe(true);
    expect(bad).toEqual([]);
  }, 180_000);
});
