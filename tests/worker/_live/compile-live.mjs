// Posts one compile request to a running `wrangler dev` and prints counts only (never keys).
// Usage: node tests/worker/_live/compile-live.mjs [baseUrl] [prompt]
const base = process.argv[2] ?? 'http://127.0.0.1:8797';
const prompt = process.argv[3] ?? 'a pirate cove built on shipwrecks, 1715';
const t0 = Date.now();
let firstPartial = null;
let spec = null;
let buf = '';
const res = await fetch(`${base}/api/compile`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt, seed: 1715 }),
});
if (!res.ok || !res.body) {
  console.log(JSON.stringify({ ok: false, status: res.status }));
  process.exit(1);
}
const dec = new TextDecoder();
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, i);
    buf = buf.slice(i + 2);
    const ev = /^event: (.*)$/m.exec(frame)?.[1];
    const data = /^data: (.*)$/m.exec(frame)?.[1];
    if (ev === 'partial' && firstPartial === null) firstPartial = (Date.now() - t0) / 1000;
    if (ev === 'spec' && data) spec = JSON.parse(data);
    if (ev === 'error') console.log(JSON.stringify({ ok: false, error: data }));
  }
}
const total = (Date.now() - t0) / 1000;
if (!spec) process.exit(1);
console.log(JSON.stringify({
  ok: true,
  blueprints: spec.blueprints?.length ?? 0,
  partsPerBlueprint: (spec.blueprints ?? []).map((b) => b.parts.length),
  props: spec.props?.length ?? 0,
  landmarks: spec.landmarks?.length ?? 0,
  buildings: spec.buildings?.length ?? 0,
  buildingsWithBlueprint: (spec.buildings ?? []).filter((b) => b.blueprint).length,
  secondsToFirstPartial: firstPartial,
  totalSeconds: total,
}));
