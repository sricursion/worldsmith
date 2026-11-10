// Live check of POST /api/compile against a running worker. Skipped unless LIVE=1.
//   npx wrangler dev --config worker/wrangler.toml --port 8797 --local      (separate shell)
//   LIVE=1 npx vitest run tests/worker/_live/live.manual.test.ts
// Each merged spec is saved to tests/worker/_live/out/<slug>.json.
// Optional: LIVE_OUT=path (append one JSON line per prompt), LIVE_BASE=http://127.0.0.1:8797, LIVE_PROMPT="..." to run one prompt.
//
// The prompts span what a player may type: open desert, rainforest, ice, another planet, a monster's lair,
// dense cities, a shore, a village, a seabed, a port, a frontier town, a ruin. Each must validate, be winnable,
// show its look inside 30 seconds, and FIT: the land, how built-up it is, what lives there and what it is made of.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GRADE_KINDS, SURFACE_KINDS, WEATHER_KINDS, normalizeSpec, slugify, validateSpec } from '../../../app/src/world/schema';
import type {
  CreatureFamily, GradeKind, ReliefKind, SitePattern, SkyFeature, SurfaceKind, WaterKind, WeatherKind, WorldSpec,
} from '../../../app/src/world/spec';
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
  relief?: ReliefKind[];
  water?: WaterKind[];
  /** True when the world must be wet somehow: water on the land, or rain, storm or mist in the air. */
  waterOrRain?: boolean;
  settled?: [number, number];
  pattern?: SitePattern[];
  structures?: [number, number];
  people?: [number, number];
  /** At least one creature of one of these families. */
  life?: CreatureFamily[];
  /** No creature of these families. */
  noLife?: CreatureFamily[];
  /** A creature at least this long or tall, in metres. */
  giant?: number;
  /** At least one of these in the sky. */
  sky?: SkyFeature['kind'][];
  /** Every one of these in the sky. */
  skyAll?: SkyFeature['kind'][];
  /** Vegetation props: true needs some, false forbids any. */
  plants?: boolean;
  /** At least this many blueprints stand taller than 12 m. */
  tall?: number;
}

const NIGHT: [number, number] = [19, 5];

const CASES: { prompt: string; fit: Fit }[] = [
  {
    prompt: 'the Sahara desert at dusk',
    fit: { relief: ['dunes'], water: ['none', 'pond'], settled: [0, 0.3], structures: [0, 4], people: [0, 4], weather: ['clear', 'dust'], floor: ['sand'], hour: [16.5, 19.5], life: ['quadruped', 'bird', 'crawler', 'serpent'], wet: [0, 0.2] },
  },
  {
    prompt: 'the Amazon rainforest after rain',
    fit: { relief: ['rolling', 'swamp', 'flat', 'canyon'], waterOrRain: true, settled: [0, 0.3], structures: [0, 4], people: [0, 3], plants: true, pattern: ['wild', 'path', 'scatter', 'shoreline'], life: ['biped', 'bird', 'quadruped', 'serpent', 'swarm'], wet: [0.4, 1] },
  },
  {
    prompt: 'an Arctic research outpost in a blizzard',
    fit: { relief: ['icefield'], water: ['ice_sheet', 'none', 'shore'], settled: [0, 0.4], structures: [1, 6], people: [1, 6], weather: ['snow', 'storm'], floor: ['snow', 'ice'], grade: ['cold_steel', 'moonlit', 'bleached'] },
  },
  {
    prompt: 'the first colony on Mars',
    fit: { relief: ['crater', 'craggy', 'canyon', 'dunes', 'rolling', 'flat'], water: ['none'], settled: [0, 0.55], structures: [2, 8], plants: false, floor: ['regolith', 'sand', 'dirt', 'gravel', 'metal_panel'], noLife: ['bird', 'swimmer'], weather: ['clear', 'dust'] },
  },
  {
    prompt: 'a brand-new alien planet with two suns and floating rocks',
    fit: { skyAll: ['second_sun', 'floating_islands'], settled: [0, 0.4], structures: [0, 5], life: ['quadruped', 'biped', 'winged', 'serpent', 'bird', 'swimmer', 'crawler', 'floater', 'colossus', 'swarm'] },
  },
  {
    prompt: "a dragon's volcanic lair",
    fit: { relief: ['crater', 'craggy', 'canyon'], water: ['lava'], settled: [0, 0.3], structures: [1, 5], people: [0, 4], life: ['winged', 'colossus'], giant: 8, grade: ['crimson', 'teal_orange', 'golden'], floor: ['ash', 'gravel', 'regolith', 'dirt'] },
  },
  {
    prompt: 'a gothic cathedral city under a blood moon, Souls-like',
    fit: { settled: [0.7, 1], structures: [7, 12], people: [3, 8], sky: ['moon', 'eclipse'], tall: 2, built: ['stone', 'brick', 'slate'], grade: ['crimson', 'moonlit'], hour: NIGHT, wear: [0.5, 1] },
  },
  {
    prompt: "Manhattan rooftops at night, a masked hero's city",
    fit: { settled: [0.8, 1], pattern: ['grid'], structures: [7, 12], tall: 2, built: ['glass_curtain', 'concrete', 'brick', 'metal_panel'], floor: ['asphalt', 'concrete'], hour: NIGHT, noLife: ['swimmer'] },
  },
  {
    prompt: 'a sunny beach city like Vice City',
    fit: { water: ['shore'], settled: [0.5, 1], structures: [6, 12], weather: ['clear'], plants: true, life: ['bird', 'quadruped', 'swimmer', 'crawler'], floor: ['sand', 'asphalt', 'concrete'] },
  },
  {
    prompt: 'a quiet Japanese mountain village in autumn',
    fit: { relief: ['terraced', 'craggy', 'rolling'], settled: [0.25, 0.8], structures: [4, 12], people: [2, 8], built: ['timber', 'plaster', 'paper_screen', 'tile', 'thatch', 'planks', 'shingle'], plants: true },
  },
  {
    prompt: 'an underwater coral city',
    fit: { settled: [0.3, 1], structures: [4, 12], life: ['swimmer', 'swarm', 'serpent', 'floater', 'crawler'], noLife: ['bird'] },
  },
  {
    prompt: 'a rain-soaked container port at dawn',
    fit: { weather: ['rain', 'storm'], built: ['corrugated', 'rusted', 'metal_panel', 'hull_plate'], floor: ['concrete', 'asphalt'], wet: [0.5, 1], hour: [4.5, 8], settled: [0.5, 1], water: ['shore', 'river', 'lake'], tall: 2, structures: [6, 12] },
  },
  {
    prompt: 'Wild West 1899',
    fit: { weather: ['dust', 'clear', 'embers'], grade: ['golden', 'sepia', 'teal_orange', 'bleached', 'crimson'], built: ['planks', 'timber', 'log', 'adobe', 'brick'], floor: ['dirt', 'sand', 'gravel', 'mud'], wet: [0, 0.35], settled: [0.3, 0.9], structures: [5, 12], life: ['quadruped', 'bird'] },
  },
  {
    prompt: 'a post-apocalyptic highway overgrown with vines',
    fit: { wear: [0.6, 1], plants: true, settled: [0, 0.6], floor: ['asphalt', 'concrete', 'gravel', 'dirt', 'moss', 'grass'], pattern: ['path', 'wild', 'street', 'scatter'] },
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
  props?: { kind: string; family?: string; dials?: Record<string, unknown>; size?: number }[];
}
interface OutlineEvent {
  mood?: { weather?: string; grade?: string; ambience?: unknown[]; music?: string };
  time?: { startHour?: number };
  palette?: { sky?: string; fog?: number };
  terrain?: { relief?: string; settled?: number };
  creatures?: unknown[];
  folk?: { name?: string };
}

const within = (v: number, [lo, hi]: [number, number]): boolean => (lo <= hi ? v >= lo && v <= hi : v >= lo || v <= hi);

/** A prop that is a plant: the tree family and the names a model folds into it. */
const isPlant = (p: { kind: string; family?: string }): boolean => /^(tree|plant|bush)$/.test((p.family ?? '').trim().toLowerCase());

/** Metres to the top of each blueprint once its skeleton is expanded. */
function heights(spec: WorldSpec): number[] {
  return (spec.blueprints ?? []).map((b) => b.parts.reduce((m, p) => Math.max(m, p.y + p.h), 0));
}

/** Where the spec misses what the prompt asked for; empty when it fits. */
function misfits(spec: WorldSpec, look: LookEvent | undefined, fit: Fit): string[] {
  const out: string[] = [];
  const mood = spec.mood;
  const s = spec.style?.surfaces;
  const t = spec.terrain;
  if (!mood || !s) return ['mood or surfaces missing'];
  if (!t || !spec.folk || !spec.creatures || !spec.skyFeatures) return ['terrain, folk, creatures or skyFeatures missing'];
  if (fit.weather && !fit.weather.includes(mood.weather)) out.push(`weather ${mood.weather}`);
  if (fit.grade && !fit.grade.includes(mood.grade)) out.push(`grade ${mood.grade}`);
  const built = [s.wall, s.wall2, s.roof, s.trim];
  if (fit.built && !fit.built.some((k) => built.includes(k))) out.push(`built ${built.join('/')}`);
  if (fit.floor && !fit.floor.includes(s.ground) && !fit.floor.includes(s.road)) out.push(`floor ${s.ground}/${s.road}`);
  if (fit.wet && !within(s.wet, fit.wet)) out.push(`wet ${s.wet}`);
  if (fit.wear && !within(s.wear, fit.wear)) out.push(`wear ${s.wear}`);
  if (fit.hour && !within(spec.time.startHour, fit.hour)) out.push(`hour ${spec.time.startHour}`);
  if (fit.relief && !fit.relief.includes(t.relief)) out.push(`relief ${t.relief}`);
  if (fit.water && !fit.water.includes(t.water)) out.push(`water ${t.water}`);
  if (fit.waterOrRain && t.water === 'none' && !['rain', 'storm', 'mist'].includes(mood.weather)) out.push(`dry: water ${t.water}, weather ${mood.weather}`);
  if (fit.settled && !within(t.settled, fit.settled)) out.push(`settled ${t.settled}`);
  if (fit.pattern && !(spec.site && fit.pattern.includes(spec.site.pattern))) out.push(`pattern ${spec.site?.pattern ?? 'none'}`);
  if (fit.structures && !within(spec.buildings.length, fit.structures)) out.push(`structures ${spec.buildings.length}`);
  if (fit.people && !within(spec.npcs.length, fit.people)) out.push(`people ${spec.npcs.length}`);
  const fams = spec.creatures.map((c) => c.family);
  if (fit.life && !fit.life.some((f) => fams.includes(f))) out.push(`life ${fams.join('/') || 'none'}`);
  if (fit.noLife && fit.noLife.some((f) => fams.includes(f))) out.push(`unwanted life ${fams.join('/')}`);
  if (fit.giant !== undefined && !spec.creatures.some((c) => c.size >= (fit.giant ?? 0))) out.push(`no giant: sizes ${spec.creatures.map((c) => c.size).join('/')}`);
  const sky = spec.skyFeatures.map((f) => f.kind);
  if (fit.sky && !fit.sky.some((k) => sky.includes(k))) out.push(`sky ${sky.join('/') || 'empty'}`);
  if (fit.skyAll && !fit.skyAll.every((k) => sky.includes(k))) out.push(`sky ${sky.join('/') || 'empty'}`);
  const plants = (look?.props ?? []).filter(isPlant).map((p) => p.kind);
  if (fit.plants === true && plants.length === 0) out.push('no vegetation props');
  if (fit.plants === false && plants.length > 0) out.push(`vegetation ${plants.join('/')}`);
  const tall = heights(spec).filter((h) => h > 12).length;
  if (fit.tall !== undefined && tall < fit.tall) out.push(`tall blueprints ${tall}: ${heights(spec).map((h) => Math.round(h)).join('/')}`);
  // Nothing drives or sails as a creature, whatever the world.
  const vehicle = spec.creatures.find((c) => /\b(car|cars|taxi|taxis|truck|bus|traffic|train|ship|boat|tram)\b/i.test(c.name));
  if (vehicle) out.push(`vehicle as creature: ${vehicle.name}`);
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
    const played = repairQuest(norm);
    const fixed = verifyQuest(played);
    const pings = run.events.filter((e) => e.event === 'ping').length;
    const stamps = run.events.map((e) => e.t);
    let gap = stamps[0] ?? 0;
    for (let i = 1; i < stamps.length; i++) gap = Math.max(gap, (stamps[i] ?? 0) - (stamps[i - 1] ?? 0));
    const bad = misfits(norm, look, fit);
    const glow = (look?.blueprints ?? []).reduce((n, b) => n + b.parts.filter((p) => p.tone === 'glow').length, 0);
    const line = JSON.stringify({
      prompt, outline_s: at(run, 'outline'), look_s: at(run, 'look'), spec_s: at(run, 'spec'), pings, max_gap_s: Math.round(gap * 10) / 10,
      title: norm.title, terrain: norm.terrain, site: norm.site,
      structures: norm.buildings.map((b) => b.id), people: norm.npcs.length, folk: norm.folk ? { name: norm.folk.name, height: norm.folk.height, features: norm.folk.features } : null,
      creatures: (norm.creatures ?? []).map((c) => `${c.count}x ${c.name} [${c.family} ${c.size}m ${c.behaviour}@${c.haunt}]`),
      sky_features: (norm.skyFeatures ?? []).map((f) => `${f.kind} ${f.size}`),
      steps: norm.quest.steps.length, step_kinds: played.quest.steps.map((s) => s.kind).join(','),
      winnable_raw: raw.winnable, winnable_repaired: fixed.winnable, problems: raw.problems.slice(0, 3),
      hour: norm.time.startHour, sky: norm.palette.sky, fog: norm.palette.fog, mood: norm.mood, style: norm.style, surfaces: norm.style?.surfaces,
      glow_parts: glow, heights_m: heights(norm).map((h) => Math.round(h)), misfits: bad,
      families: (look?.blueprints ?? []).map((b) => ({ id: b.id ?? null, family: b.family ?? null, dials: b.dials ?? null, extra: b.parts.length })),
      props: (look?.props ?? []).map((p) => ({ kind: p.kind, family: p.family ?? null, dials: p.dials ?? null, size: p.size ?? null })),
    });
    console.log(line);
    if (process.env.LIVE_OUT) appendFileSync(process.env.LIVE_OUT, `${line}\n`);

    expect(fixed.winnable).toBe(true);
    expect(at(run, 'look')).not.toBeNull();
    expect(at(run, 'look') ?? 99).toBeLessThan(30);

    // The outline event already carries the land, the life and the air, so the client can set them in the first seconds.
    expect(WEATHER_KINDS).toContain(outline?.mood?.weather);
    expect(GRADE_KINDS).toContain(outline?.mood?.grade);
    expect(typeof outline?.time?.startHour).toBe('number');
    expect(typeof outline?.terrain?.relief).toBe('string');
    expect(Array.isArray(outline?.creatures)).toBe(true);
    expect(typeof outline?.folk?.name).toBe('string');
    // The look event carries the materials, and the merged spec carries everything, unchanged by normalisation.
    expect(SURFACE_KINDS).toContain(look?.style?.surfaces?.wall);
    expect(valid.value.mood).toEqual(norm.mood);
    expect(valid.value.style?.surfaces).toEqual(norm.style?.surfaces);
    expect(valid.value.terrain).toEqual(norm.terrain);
    expect(valid.value.folk).toEqual(norm.folk);
    expect(valid.value.creatures).toEqual(norm.creatures);
    expect(norm.mood?.ambience.length ?? 0).toBeGreaterThan(0);
    // The model wrote the look itself (a fallback look for a built place carries hand-written blueprints with no family).
    if (norm.buildings.length > 0) expect((look?.blueprints ?? []).some((b) => typeof b.family === 'string' && b.family.length > 0)).toBe(true);
    expect(bad).toEqual([]);
  }, 180_000);
});
