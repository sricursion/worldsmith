// Live check of POST /api/compile against a running worker. Skipped unless LIVE=1.
//   npx wrangler dev --config worker/wrangler.toml --port 8797 --local      (separate shell)
//   LIVE=1 npx vitest run tests/worker/_live/live.manual.test.ts
// Optional: LIVE_OUT=path (append one JSON line per prompt), LIVE_BASE=http://127.0.0.1:8797, LIVE_PROMPT="..." to run one prompt.
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSpec, validateSpec } from '../../../app/src/world/schema';
import { repairQuest, verifyQuest } from '../../../app/src/world/verify';

const LIVE = process.env.LIVE === '1';
const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:8797';
const PROMPTS = process.env.LIVE_PROMPT
  ? [process.env.LIVE_PROMPT]
  : [
      'Wild West 1899, a small town in Middle America, guns and trouble',
      'a forest of giant glowing mushrooms where tiny folk live',
      'a city of needle-thin glass towers in 2400',
      'a desert caravan camp at an oasis',
    ];

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
  blueprints?: { family?: string; dials?: Record<string, unknown>; parts: unknown[] }[];
  props?: { kind: string; family?: string; dials?: unknown }[];
}

describe.skipIf(!LIVE)('live compile', () => {
  it.each(PROMPTS)('%s', async (prompt) => {
    const run = await compile(prompt);
    expect(run.error).toBeNull();
    const spec = run.events.find((e) => e.event === 'spec')?.data;
    const look = run.events.find((e) => e.event === 'look')?.data as LookEvent | undefined;
    const valid = validateSpec(spec);
    if (!valid.ok) console.log('INVALID', prompt, valid.error);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const norm = normalizeSpec(valid.value);
    const raw = verifyQuest(norm);
    const fixed = verifyQuest(repairQuest(norm));
    const pings = run.events.filter((e) => e.event === 'ping').length;
    const stamps = run.events.map((e) => e.t);
    let gap = stamps[0] ?? 0;
    for (let i = 1; i < stamps.length; i++) gap = Math.max(gap, (stamps[i] ?? 0) - (stamps[i - 1] ?? 0));
    const line = JSON.stringify({
      prompt, outline_s: at(run, 'outline'), look_s: at(run, 'look'), spec_s: at(run, 'spec'), pings, max_gap_s: Math.round(gap * 10) / 10,
      buildings: norm.buildings.length, npcs: norm.npcs.length, steps: norm.quest.steps.length,
      winnable_raw: raw.winnable, winnable_repaired: fixed.winnable, problems: raw.problems.slice(0, 3),
      families: (look?.blueprints ?? []).map((b) => ({ family: b.family ?? null, dials: b.dials ?? null, extra: b.parts.length })),
      props: (look?.props ?? []).map((p) => ({ kind: p.kind, family: p.family ?? null })),
    });
    console.log(line);
    if (process.env.LIVE_OUT) appendFileSync(process.env.LIVE_OUT, `${line}
`);
    expect(fixed.winnable).toBe(true);
    expect(at(run, 'look')).not.toBeNull();
    expect(at(run, 'look') ?? 99).toBeLessThan(30);
  }, 180_000);
});
