// POST /api/compile: prompt -> world spec, in three streamed stages over one SSE response.
//   outline  a fast model decides what kind of place this is: the land, how built-up, the layout, the few or
//            many structures, the people and their body plan, the creatures, the sky, the air, a quest premise (seconds)
//   look     skeleton families + dials + extra parts, palette, props, landmarks (parallel with story)
//   story    people, items, quest, rules, written against the outline's ids (parallel with look)
// SSE events:  partial {text}   raw text deltas of whichever stage is writing
//              ping {}          keepalive, at least every few seconds
//              outline {...}    the coerced outline, with terrain, skyFeatures, creatures, folk, mood (weather, grade,
//                               haze, ambience, music) and time.startHour
//              look {...}       style (with surfaces), site, blueprints, props, landmarks, buildings (with blueprint ids)
//              spec {...}       the merged WorldSpec
//              error {error, reason?}
import { anthropicEvents, anthropicFetch, SONNET, type MessagesBody } from '../lib/anthropic';
import type { Env } from '../lib/env';
import { isMock } from '../lib/env';
import { budgetScope, chargeBudget, guardBudget, guardEarly, sessionFromRequest, type BudgetScope } from '../lib/guard';
import { errorJson, readJson, sleep } from '../lib/http';
import { mockLook, mockOutline, mockStory } from '../lib/mockcast';
import { BASE } from '../lib/mockstyle';
import { createSse, type SseWriter } from '../lib/sse';
import { FIXTURES, nearestTheme } from '../lib/shared';
import { validateCompile } from '../lib/validate';
import { validateSpec } from '../../../app/src/world/schema';
import type { ThemeId, WorldSpec } from '../../../app/src/world/spec';
import { outlineSystemPrompt, outlineUserMessage } from '../prompts/compile';
import { lookSystemPrompt, lookUserMessage } from '../prompts/compilelook';
import {
  coerceLook, coerceOutline, coerceStory, mergeSpec, parseLooseJson,
  type LookResult, type Outline, type StoryResult,
} from '../prompts/compilemerge';
import { storySystemPrompt, storyUserMessage } from '../prompts/compilestory';

const MOCK_GAP_MS = 400;
const PING_EVERY_MS = 3000;
const PARTIAL_EVERY_MS = 120;
const OUTLINE_MS = 25_000;
const LOOK_MS = 75_000;
const STORY_MS = 75_000;

type FailReason = 'upstream' | 'rate_limited' | 'refusal';
type StageResult = { ok: true; text: string; stop: string | null } | { ok: false; reason: FailReason };

interface Run {
  sse: SseWriter;
  env: Env;
  usage: { tokens: number };
}

/** Coalesces small model deltas into one `partial` event per interval so the client is not flooded. */
function partialPump(sse: SseWriter): { push(t: string): void; flush(): Promise<void> } {
  let buf = '';
  let last = 0;
  return {
    push(t) {
      buf += t;
      if (Date.now() - last >= PARTIAL_EVERY_MS) {
        const out = buf;
        buf = '';
        last = Date.now();
        void sse.send('partial', { text: out });
      }
    },
    async flush() {
      if (buf) {
        const out = buf;
        buf = '';
        await sse.send('partial', { text: out });
      }
    },
  };
}

/** One streamed model call. Tokens are added to the shared usage counter; nothing is charged here. */
async function streamStage(run: Run, body: MessagesBody, timeoutMs: number): Promise<StageResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  const pump = partialPump(run.sse);
  let res: Response;
  try {
    res = await anthropicFetch(run.env, { ...body, stream: true }, signal);
  } catch (err) {
    console.warn('compile fetch failed', err instanceof Error ? err.message : String(err));
    return { ok: false, reason: 'upstream' };
  }
  if (!res.ok) {
    // Status and the vendor's error text only; request headers are never logged.
    console.warn('compile upstream', res.status, (await res.text().catch(() => '')).slice(0, 300));
    return { ok: false, reason: res.status === 429 ? 'rate_limited' : 'upstream' };
  }
  let acc = '';
  let stop: string | null = null;
  let tokens = 0;
  try {
    for await (const ev of anthropicEvents(res)) {
      if (ev.kind === 'text') {
        acc += ev.text;
        pump.push(ev.text);
      } else if (ev.kind === 'stop') {
        stop = ev.reason;
        tokens = ev.outputTokens;
      } else return { ok: false, reason: 'upstream' };
    }
  } catch (err) {
    console.warn('compile stream failed', err instanceof Error ? err.message : String(err));
    return { ok: false, reason: 'upstream' };
  } finally {
    run.usage.tokens += tokens > 0 ? tokens : Math.ceil(acc.length / 3);
    await pump.flush();
  }
  if (stop === 'refusal') return { ok: false, reason: 'refusal' };
  return { ok: true, text: acc, stop };
}

const cached = (text: string): MessagesBody['system'] => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];

async function runOutline(run: Run, prompt: string, seed: number): Promise<{ ok: true; outline: Outline } | { ok: false; reason: FailReason }> {
  const fallbackTheme = nearestTheme(prompt);
  let last: FailReason = 'upstream';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await streamStage(run, {
      model: SONNET, max_tokens: 3200, thinking: { type: 'between_tools' }, output_config: { effort: 'high' }, system: cached(outlineSystemPrompt()),
      messages: [{ role: 'user', content: outlineUserMessage(prompt, seed) }],
    }, OUTLINE_MS);
    if (!r.ok) {
      last = r.reason;
      if (r.reason === 'refusal') break;
      continue;
    }
    const outline = coerceOutline(parseLooseJson(r.text), fallbackTheme, prompt);
    if (outline) return { ok: true, outline };
    console.warn('compile outline unreadable', r.stop, r.text.length);
  }
  return { ok: false, reason: last };
}

async function runLook(run: Run, prompt: string, seed: number, outline: Outline): Promise<LookResult> {
  const fallback = (): LookResult => mockLook(prompt, seed, outline.theme, outline);
  const r = await streamStage(run, {
    model: SONNET, max_tokens: 6000, thinking: { type: 'between_tools' }, output_config: { effort: 'high' },
    system: cached(lookSystemPrompt()), messages: [{ role: 'user', content: lookUserMessage(prompt, seed, outline) }],
  }, LOOK_MS);
  if (!r.ok) return fallback();
  const base = FIXTURES[outline.theme].style ?? BASE[outline.theme];
  const look = coerceLook(parseLooseJson(r.text), outline, base, prompt);
  if (!look) {
    console.warn('compile look unreadable', r.stop, r.text.length);
    return fallback();
  }
  return look;
}

async function runStory(run: Run, prompt: string, seed: number, outline: Outline): Promise<StoryResult> {
  const fallback = (): StoryResult => mockStory(outline.theme, outline);
  const r = await streamStage(run, {
    model: SONNET, max_tokens: 7000, thinking: { type: 'between_tools' }, output_config: { effort: 'high' },
    system: cached(storySystemPrompt()), messages: [{ role: 'user', content: storyUserMessage(prompt, seed, outline) }],
  }, STORY_MS);
  if (!r.ok) return fallback();
  const story = coerceStory(parseLooseJson(r.text), outline);
  if (!story) {
    console.warn('compile story unreadable', r.stop, r.text.length);
    return fallback();
  }
  return story;
}

/** The merged spec, with the model's story swapped for the fixture cast if the model's cast breaks the schema. */
export function assemble(prompt: string, seed: number, outline: Outline, look: LookResult, story: StoryResult): WorldSpec {
  const merged = mergeSpec(prompt, seed, outline, look, story);
  const v = validateSpec(merged);
  if (v.ok) return merged;
  console.warn('compile merged spec invalid', v.error);
  return mergeSpec(prompt, seed, outline, look, mockStory(outline.theme, outline));
}

async function runReal(run: Run, prompt: string, seed: number): Promise<void> {
  const { sse } = run;
  const o = await runOutline(run, prompt, seed);
  if (!o.ok) {
    await sse.send('error', { error: o.reason, reason: o.reason });
    return;
  }
  const { outline } = o;
  await sse.send('outline', outline);
  const lookP = runLook(run, prompt, seed, outline).then(async (look) => {
    await sse.send('look', look);
    return look;
  });
  const storyP = runStory(run, prompt, seed, outline);
  const [look, story] = await Promise.all([lookP, storyP]);
  await sse.send('spec', assemble(prompt, seed, outline, look, story));
}

async function runMock(sse: SseWriter, prompt: string, seed: number): Promise<void> {
  const theme: ThemeId = nearestTheme(prompt);
  const outline = mockOutline(prompt, seed);
  await sse.send('partial', { text: JSON.stringify(outline) });
  await sse.send('outline', outline);
  await sleep(MOCK_GAP_MS);
  const look = mockLook(prompt, seed, theme, outline);
  await sse.send('partial', { text: JSON.stringify({ blueprints: look.blueprints, props: look.props }) });
  await sse.send('look', look);
  await sleep(MOCK_GAP_MS);
  const story = mockStory(theme, outline);
  const spec = mergeSpec(prompt, seed, outline, look, story);
  await sse.send('spec', { ...spec, time: { ...FIXTURES[theme].time, startHour: outline.time.startHour } });
}

export async function handleCompile(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const early = await guardEarly(req, env);
  if (early) return early;
  const body = await readJson(req, 4096);
  if (!body.ok) return body.res;
  const v = validateCompile(body.value);
  if (!v.ok) return errorJson(400, v.error, 'bad_request');

  const scope: BudgetScope = budgetScope(req, sessionFromRequest(req));
  const gate = await guardBudget(env, scope);
  if (!gate.ok) return gate.res;

  const sse = createSse();
  ctx.waitUntil(
    (async () => {
      const run: Run = { sse, env, usage: { tokens: 0 } };
      // Model calls can be silent for seconds (thinking); a steady ping keeps the client's idle guard quiet.
      const ticker = setInterval(() => void sse.send('ping', {}), PING_EVERY_MS);
      try {
        if (isMock(env)) await runMock(sse, v.value.prompt, v.value.seed);
        else await runReal(run, v.value.prompt, v.value.seed);
      } catch (err) {
        console.warn('compile failed', err instanceof Error ? err.message : String(err));
        await sse.send('error', { error: 'internal', reason: 'upstream' });
      } finally {
        clearInterval(ticker);
        // Charged once for every stage, however the run ended.
        if (run.usage.tokens > 0) await chargeBudget(env, scope, run.usage.tokens);
        await sse.close();
      }
    })(),
  );
  return sse.response;
}
