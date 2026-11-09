// POST /api/tick: per-NPC action probabilities from the decision model.
import type { TickResponse } from '../../../app/src/net/types';
import type { Env } from '../lib/env';
import { isMock } from '../lib/env';
import { guardEarly } from '../lib/guard';
import { errorJson, isLocalRequest, json, readJson } from '../lib/http';
import { decideTick, mockProbs } from '../lib/typesafe';
import { validateTick } from '../lib/validate';

export async function handleTick(req: Request, env: Env, url: URL): Promise<Response> {
  const early = await guardEarly(req, env, { turnstile: false });
  if (early) return early;
  const body = await readJson(req, 32_768);
  if (!body.ok) return body.res;
  const v = validateTick(body.value);
  if (!v.ok) return errorJson(400, v.error, 'bad_request');

  if (isMock(env) && !env.TYPESAFE_API_KEY) {
    // No TypeSafe key: the mock still returns a usable vector. source stays 'none' because the
    // shared TickResponse type has no 'mock' value.
    const res: TickResponse = { probs: mockProbs(v.value), source: 'none' };
    return json(res);
  }
  return json(await decideTick(env, v.value, isLocalRequest(url)));
}
