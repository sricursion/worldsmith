// Raw-fetch client for the Messages API (this Worker is a proxy; no SDK).
// Never send temperature, top_p or top_k: these models reject them.
import type { Env } from './env';
import { isRecord } from './http';
import { readSseFrames, type SseFrame } from './sse';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface MessagesBody {
  model: string;
  max_tokens: number;
  system: SystemBlock[];
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** Sonnet 5.5: {type:'between_tools'}. Haiku 5.5: {type:'disabled'}. */
  thinking: { type: 'between_tools' } | { type: 'disabled' };
  output_config?: {
    effort?: 'low' | 'medium' | 'high';
    format?: { type: 'json_schema'; schema: object };
  };
  stream?: boolean;
}

export function anthropicFetch(env: Env, body: MessagesBody, signal?: AbortSignal): Promise<Response> {
  return fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal,
  });
}

export type UpstreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'stop'; reason: string | null; outputTokens: number }
  | { kind: 'error'; message: string };

/** Translate one Anthropic SSE frame; returns null for frames we do not care about. */
export function eventFromFrame(frame: SseFrame): UpstreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  switch (data.type) {
    case 'content_block_delta': {
      const d = data.delta;
      if (isRecord(d) && d.type === 'text_delta' && typeof d.text === 'string') return { kind: 'text', text: d.text };
      return null;
    }
    case 'message_delta': {
      const d = isRecord(data.delta) ? data.delta : {};
      const u = isRecord(data.usage) ? data.usage : {};
      return {
        kind: 'stop',
        reason: typeof d.stop_reason === 'string' ? d.stop_reason : null,
        outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
      };
    }
    case 'error': {
      const e = isRecord(data.error) ? data.error : {};
      return { kind: 'error', message: typeof e.type === 'string' ? e.type : 'upstream_error' };
    }
    default:
      return null;
  }
}

export async function* anthropicEvents(res: Response): AsyncGenerator<UpstreamEvent> {
  for await (const frame of readSseFrames(res)) {
    const ev = eventFromFrame(frame);
    if (ev) yield ev;
  }
}

export type JsonResult =
  | { ok: true; text: string; stopReason: string | null; outputTokens: number }
  | { ok: false; status: number; error: string };

/** Non-streaming call for short outputs (rule patches). Joins the text blocks. */
export async function anthropicJson(env: Env, body: MessagesBody): Promise<JsonResult> {
  let res: Response;
  try {
    res = await anthropicFetch(env, { ...body, stream: false });
  } catch {
    return { ok: false, status: 502, error: 'network' };
  }
  if (!res.ok) return { ok: false, status: res.status, error: 'upstream_status' };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: 502, error: 'bad_upstream_json' };
  }
  if (!isRecord(data)) return { ok: false, status: 502, error: 'bad_upstream_json' };
  let text = '';
  if (Array.isArray(data.content)) {
    for (const b of data.content) {
      if (isRecord(b) && b.type === 'text' && typeof b.text === 'string') text += b.text;
    }
  }
  const usage = isRecord(data.usage) ? data.usage : {};
  return {
    ok: true,
    text,
    stopReason: typeof data.stop_reason === 'string' ? data.stop_reason : null,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
  };
}
