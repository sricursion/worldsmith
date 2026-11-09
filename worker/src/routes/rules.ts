// POST /api/rules/patch: plain-language rule -> one to three typed RuleSpec entries.
import type { PatchResponse } from '../../../app/src/net/types';
import { anthropicJson, SONNET } from '../lib/anthropic';
import type { Env } from '../lib/env';
import { isMock } from '../lib/env';
import { budgetScope, chargeBudget, guardBudget, guardEarly } from '../lib/guard';
import { errorJson, json, readJson } from '../lib/http';
import { mockRules } from '../lib/mockrules';
import { validatePatch } from '../lib/validate';
import { RULES_SYSTEM, rulesJsonSchema, rulesUserMessage, sanitizeRules } from '../prompts/rules';

export async function handleRulesPatch(req: Request, env: Env): Promise<Response> {
  const early = await guardEarly(req, env);
  if (early) return early;
  const body = await readJson(req, 16_384);
  if (!body.ok) return body.res;
  const v = validatePatch(body.value);
  if (!v.ok) return errorJson(400, v.error, 'bad_request');
  const { sessionId, ruleText, summary } = v.value;

  if (isMock(env)) {
    const res: PatchResponse = { rules: mockRules(ruleText, summary) };
    return json(res);
  }

  const scope = budgetScope(req, sessionId);
  const gate = await guardBudget(env, scope);
  if (!gate.ok) return gate.res;

  const out = await anthropicJson(env, {
    model: SONNET,
    max_tokens: 1500,
    thinking: { type: 'between_tools' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: rulesJsonSchema() } },
    system: [{ type: 'text', text: RULES_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: rulesUserMessage(ruleText, summary) }],
  });
  if (!out.ok) return errorJson(502, out.error, 'upstream');
  await chargeBudget(env, scope, out.outputTokens);
  if (out.stopReason === 'refusal') return errorJson(422, 'refusal', 'refusal');

  let parsed: unknown;
  try {
    parsed = JSON.parse(out.text);
  } catch {
    return errorJson(502, 'invalid_rules_json', 'upstream');
  }
  const rules = sanitizeRules(parsed);
  if (rules.length === 0) return errorJson(502, 'no_valid_rules', 'upstream');
  const res: PatchResponse = { rules };
  return json(res);
}
