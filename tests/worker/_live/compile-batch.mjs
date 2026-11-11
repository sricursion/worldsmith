// Runs a list of prompts through /api/compile one at a time and saves each final spec plus a summary line.
// Usage: node tests/worker/_live/compile-batch.mjs [outDir] [baseUrl] [promptsFile.json | "prompt|prompt|..."]
// Prints counts and timings only. Specs land in <outDir>/<slug>.json (after the client's normalizeSpec) with the raw
// merged spec beside them as <slug>.raw.json. Family counts read the raw spec: normalizeSpec expands a family into parts and drops the name.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'tests/worker/_live/out3';
const base = process.argv[3] ?? 'http://127.0.0.1:8788';
const arg = process.argv[4];
const DEFAULT = [
  'a research base on Mars', 'midtown Manhattan at rush hour', 'an Edo-period Japanese village in autumn', 'an underwater coral city',
  'a medieval castle under siege', 'a Rio favela on a hillside', 'an oil rig in a storm-free North Sea', 'a Mayan temple city in the jungle',
  'an American suburb in the 1950s', 'an Arctic research station', 'a Moroccan bazaar', 'a cyberpunk alley market', 'a Roman forum',
  'a treehouse village in giant redwoods', 'a graveyard on a foggy moor', 'a candy kingdom',
];
const prompts = !arg ? DEFAULT : existsSync(arg) ? JSON.parse(readFileSync(arg, 'utf8')) : arg.split('|');
mkdirSync(outDir, { recursive: true });

// The client normalizes every spec on arrival; bundle the same function so the counts match what a player gets.
const bundle = join(tmpdir(), `schema-bundle-${process.pid}.mjs`);
await build({ entryPoints: ['app/src/world/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' });
const { normalizeSpec } = await import(pathToFileURL(bundle).href);

const slugOf = (p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const distinct = (xs) => new Set(xs.map((x) => x.family ?? '(none)')).size;

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      const h = await (await fetch(`${base}/api/health`)).json();
      if (h.ok && h.mock === false) return true;
    } catch { /* worker reloading */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function one(prompt) {
  const t0 = Date.now();
  const stages = [];
  let spec = null;
  let err = null;
  const res = await fetch(`${base}/api/compile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, seed: 1715 }) });
  if (!res.ok || !res.body) return { prompt, ok: false, err: `http ${res.status}`, secs: 0 };
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (ev === 'stage' && data) stages.push(JSON.parse(data));
      if (ev === 'spec' && data) spec = JSON.parse(data);
      if (ev === 'error') err = data;
    }
  }
  return { prompt, spec, stages, err, secs: (Date.now() - t0) / 1000 };
}

const rows = [];
for (const prompt of prompts) {
  if (!(await waitHealthy())) { console.log(JSON.stringify({ prompt, ok: false, err: 'worker not healthy' })); break; }
  // A dropped stream (the dev Worker reloading under an edit) gets one more try; the first failure is reported.
  let r;
  const started = Date.now();
  let dropped = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { r = await one(prompt); if (r.spec) break; } catch (e) { dropped ??= `${e} after ${((Date.now() - started) / 1000).toFixed(1)}s`; r = { prompt, err: String(e), secs: (Date.now() - started) / 1000 }; }
    await waitHealthy();
  }
  if (!r.spec) { const row = { prompt, ok: false, err: r.err ?? 'no spec', secs: r.secs }; rows.push(row); console.log(JSON.stringify(row)); continue; }
  const raw = r.spec;
  const spec = normalizeSpec(raw);
  const slug = slugOf(prompt);
  writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(spec, null, 1));
  writeFileSync(join(outDir, `${slug}.raw.json`), JSON.stringify(raw, null, 1));
  const used = new Set(spec.buildings.map((b) => b.blueprint).filter(Boolean));
  const row = {
    prompt, ok: true, secs: +r.secs.toFixed(1),
    blueprints: spec.blueprints?.length ?? 0, bpFamilies: distinct(raw.blueprints ?? []), blueprintsUsed: used.size,
    buildings: spec.buildings.length, propKinds: spec.props?.length ?? 0, propFamilies: distinct(raw.props ?? []),
    people: spec.npcs.length, creatureKinds: spec.creatures?.length ?? 0, questSteps: spec.quest?.steps?.length ?? 0,
    rawBlueprints: raw.blueprints?.length ?? 0, rawProps: raw.props?.length ?? 0, rawNpcs: raw.npcs.length,
    dropped, fellBack: r.stages.map((s) => `${s.stage}:${s.why}`), error: r.err,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log(`done ${rows.filter((r) => r.ok).length}/${prompts.length}`);
