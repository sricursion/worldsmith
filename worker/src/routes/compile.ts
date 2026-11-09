// POST /api/compile: prompt -> world spec, streamed.
// SSE events:  partial {text}   a raw text delta of the JSON being written
//              spec {...}       the parsed WorldSpec (data is the object itself)
//              error {error, reason?}
import { anthropicEvents, anthropicFetch, SONNET } from '../lib/anthropic';
import type { Env } from '../lib/env';
import { isMock } from '../lib/env';
import { budgetScope, chargeBudget, guardBudget, guardEarly, sessionFromRequest, type BudgetScope } from '../lib/guard';
import { errorJson, isRecord, readJson, sleep } from '../lib/http';
import { createSse, type SseWriter } from '../lib/sse';
import { FIXTURES, nearestTheme, worldSpecJsonSchema } from '../lib/shared';
import { validateCompile } from '../lib/validate';
import { compileSystemPrompt, compileUserMessage } from '../prompts/compile';

const MOCK_CHUNKS = 12;
const MOCK_GAP_MS = 80;
const PING_EVERY_MS = 4000;

async function runMock(sse: SseWriter, prompt: string, seed: number): Promise<void> {
  const spec = { ...FIXTURES[nearestTheme(prompt)], prompt, seed };
  const text = JSON.stringify(spec);
  const size = Math.ceil(text.length / MOCK_CHUNKS);
  for (let i = 0; i < text.length; i += size) {
    await sse.send('partial', { text: text.slice(i, i + size) });
    await sleep(MOCK_GAP_MS);
  }
  await sse.send('spec', spec);
}

async function runReal(sse: SseWriter, env: Env, prompt: string, seed: number, scope: BudgetScope): Promise<void> {
  let res: Response;
  try {
    res = await anthropicFetch(env, {
      model: SONNET,
      max_tokens: 8000,
      stream: true,
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: worldSpecJsonSchema() } },
      system: [{ type: 'text', text: compileSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: compileUserMessage(prompt, seed) }],
    });
  } catch {
    await sse.send('error', { error: 'upstream', reason: 'upstream' });
    return;
  }
  if (!res.ok) {
    await sse.send('error', { error: 'upstream', reason: res.status === 429 ? 'rate_limited' : 'upstream' });
    return;
  }

  let acc = '';
  let stop: string | null = null;
  let tokens = 0;
  let lastSent = Date.now();
  // Thinking and grammar compilation produce frames that map to no client event; a ping keeps the client's idle guard quiet.
  const onIdle = (): void => {
    if (Date.now() - lastSent < PING_EVERY_MS) return;
    lastSent = Date.now();
    void sse.send('ping', {});
  };
  let failed = false;
  try {
    for await (const ev of anthropicEvents(res, onIdle)) {
      if (ev.kind === 'text') {
        acc += ev.text;
        lastSent = Date.now();
        await sse.send('partial', { text: ev.text });
      } else if (ev.kind === 'stop') {
        stop = ev.reason;
        tokens = ev.outputTokens;
      } else {
        failed = true;
        break;
      }
    }
  } finally {
    // Charged once however the stream ended: normal stop, error event or a thrown read.
    await chargeBudget(env, scope, tokens > 0 ? tokens : Math.ceil(acc.length / 3));
  }
  if (failed) {
    await sse.send('error', { error: 'upstream', reason: 'upstream' });
    return;
  }

  if (stop === 'refusal') {
    await sse.send('error', { error: 'refusal', reason: 'refusal' });
    return;
  }
  if (stop === 'max_tokens') {
    await sse.send('error', { error: 'truncated', reason: 'upstream' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(acc);
  } catch {
    await sse.send('error', { error: 'invalid_spec_json', reason: 'upstream' });
    return;
  }
  if (!isRecord(parsed)) {
    await sse.send('error', { error: 'invalid_spec_json', reason: 'upstream' });
    return;
  }
  await sse.send('spec', { ...parsed, prompt, seed });
}

export async function handleCompile(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const early = await guardEarly(req, env);
  if (early) return early;
  const body = await readJson(req, 4096);
  if (!body.ok) return body.res;
  const v = validateCompile(body.value);
  if (!v.ok) return errorJson(400, v.error, 'bad_request');

  const scope = budgetScope(req, sessionFromRequest(req));
  const gate = await guardBudget(env, scope);
  if (!gate.ok) return gate.res;

  const sse = createSse();
  ctx.waitUntil(
    (async () => {
      try {
        if (isMock(env)) await runMock(sse, v.value.prompt, v.value.seed);
        else await runReal(sse, env, v.value.prompt, v.value.seed, scope);
      } catch {
        await sse.send('error', { error: 'internal', reason: 'upstream' });
      } finally {
        await sse.close();
      }
    })(),
  );
  return sse.response;
}
