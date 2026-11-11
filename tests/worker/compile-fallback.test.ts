import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCompile } from '../../worker/src/routes/compile';

const frame = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const modelReply = (text: string): Response =>
  new Response(
    frame('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text } }) +
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const OUTLINE = JSON.stringify({
  title: 'Test Cove', theme: 'medieval', terrain: { relief: 'flat', settled: 0.6 },
  buildings: [['hall', 'townhall', 'Hall', 'hall', 'medium', true], ['inn', 'inn', 'Inn', 'hall', 'small', false], ['mill', 'workshop', 'Mill', 'hall', 'small', false]],
  npcs: [['ann', 'Ann', 'keeper', 'hall', 'hall'], ['bo', 'Bo', 'miller', 'mill', 'mill'], ['cy', 'Cy', 'host', 'inn', 'inn']],
});

async function run(): Promise<string> {
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const req = new Request('http://x/api/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a test cove', seed: 5 }) });
  const res = await handleCompile(req, { ANTHROPIC_API_KEY: 'test' }, ctx);
  const text = await res.text();
  await Promise.all(waits);
  return text;
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/compile when a stage fails', () => {
  it('says which stage fell back to the stock result and why, and still sends a spec', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++calls === 1 ? modelReply(OUTLINE) : new Response('boom', { status: 500 }))));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const text = await run();
    const stages = [...text.matchAll(/^event: stage\ndata: (.*)$/gm)].map((m) => JSON.parse(m[1] as string) as { stage: string; fallback: boolean; why: string });
    expect(stages.map((s) => s.stage).sort()).toEqual(['look', 'story']);
    expect(stages.every((s) => s.fallback && s.why === 'upstream')).toBe(true);
    expect(text).toContain('event: spec');
  }, 15000);
});
