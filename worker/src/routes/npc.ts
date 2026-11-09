// POST /api/npc/say: one NPC line, streamed.
// SSE events:  token {text}      a text delta
//              done {refusal}    the last event of a reply
//              error {error, reason}  instead of done when no vendor produced any text
// Anthropic (Haiku) first; on any vendor failure before text arrived, one retry on Groq when keyed.
import { anthropicEvents, anthropicFetch, HAIKU } from '../lib/anthropic';
import type { Env } from '../lib/env';
import { isMock } from '../lib/env';
import { budgetScope, chargeBudget, guardBudget, guardEarly, type BudgetScope } from '../lib/guard';
import { errorJson, isRecord, readJson, sleep } from '../lib/http';
import { createSse, readSseFrames, type SseWriter } from '../lib/sse';
import { validateNpcSay } from '../lib/validate';
import { mockNpcLine, npcSystemBlocks, npcSystemText, npcUserMessage } from '../prompts/npc';
import type { NpcSayRequest } from '../../../app/src/net/types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';

async function runMock(sse: SseWriter, req: NpcSayRequest): Promise<void> {
  const words = mockNpcLine(req).split(' ');
  for (let i = 0; i < words.length; i++) {
    await sse.send('token', { text: (i === 0 ? '' : ' ') + words[i] });
    await sleep(35);
  }
  await sse.send('done', { refusal: false });
}

/** Streams a Groq completion; returns the number of characters forwarded (0 means nothing was sent). */
async function groqFallback(sse: SseWriter, env: Env, req: NpcSayRequest): Promise<number> {
  let emitted = 0;
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY ?? ''}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        stream: true,
        reasoning_effort: 'low',
        max_completion_tokens: 700, // reasoning tokens share this budget
        messages: [
          { role: 'system', content: npcSystemText(req) },
          { role: 'user', content: npcUserMessage(req) },
        ],
      }),
    });
    if (!res.ok) return 0;
    for await (const frame of readSseFrames(res)) {
      if (frame.data === '[DONE]') break;
      let d: unknown;
      try {
        d = JSON.parse(frame.data);
      } catch {
        continue;
      }
      const choice = isRecord(d) && Array.isArray(d.choices) ? d.choices[0] : undefined;
      const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta : undefined;
      if (delta && typeof delta.content === 'string' && delta.content.length > 0) {
        emitted += delta.content.length;
        await sse.send('token', { text: delta.content });
      }
    }
  } catch {
    /* fall through with whatever was emitted */
  }
  return emitted;
}

async function runReal(sse: SseWriter, env: Env, req: NpcSayRequest, scope: BudgetScope): Promise<void> {
  let vendorFailure = false;
  let chars = 0;
  let stop: string | null = null;
  let tokens = 0;

  try {
    try {
      const res = await anthropicFetch(env, {
        model: HAIKU,
        max_tokens: 220,
        stream: true,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system: npcSystemBlocks(req),
        messages: [{ role: 'user', content: npcUserMessage(req) }],
      });
      if (!res.ok) {
        // Any non-ok status (credit exhausted, bad key, bad model) means the vendor path is dead: try Groq.
        vendorFailure = true;
        console.error(`[npc] anthropic status ${res.status}`);
      } else {
        for await (const ev of anthropicEvents(res)) {
          if (ev.kind === 'text') {
            chars += ev.text.length;
            await sse.send('token', { text: ev.text });
          } else if (ev.kind === 'stop') {
            stop = ev.reason;
            tokens = ev.outputTokens;
          } else {
            vendorFailure = true;
            break;
          }
        }
      }
    } catch {
      vendorFailure = true;
    }

    if (stop === 'refusal') {
      await sse.send('done', { refusal: true });
      return;
    }
    if (vendorFailure && chars === 0) {
      if (env.GROQ_API_KEY) chars = await groqFallback(sse, env, req);
      if (chars === 0) {
        await sse.send('error', { error: 'upstream', reason: 'upstream' });
        return;
      }
    }
    await sse.send('done', { refusal: false });
  } finally {
    // Charged once on every exit; reported tokens when present, otherwise an estimate from the text sent (Groq included).
    await chargeBudget(env, scope, tokens > 0 ? tokens : Math.ceil(chars / 3));
  }
}

export async function handleNpcSay(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const early = await guardEarly(request, env);
  if (early) return early;
  const body = await readJson(request, 32_768);
  if (!body.ok) return body.res;
  const v = validateNpcSay(body.value);
  if (!v.ok) return errorJson(400, v.error, 'bad_request');

  const scope = budgetScope(request, v.value.sessionId);
  const gate = await guardBudget(env, scope);
  if (!gate.ok) return gate.res;

  const sse = createSse();
  ctx.waitUntil(
    (async () => {
      try {
        if (isMock(env)) await runMock(sse, v.value);
        else await runReal(sse, env, v.value, scope);
      } catch {
        await sse.send('done', { refusal: false });
      } finally {
        await sse.close();
      }
    })(),
  );
  return sse.response;
}
