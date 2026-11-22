// Keeps what visitors type (world prompts, rules, lines said to characters) in the host's Redis store,
// newest first, so the owner can read them on /prompts. No address is kept, only a short session tag.
// Without the store's variables (local runs) nothing is written. A failure never reaches the visitor.

export const PROMPT_KEY = 'worldsmith:prompts';
export const PROMPT_KEEP = 5000;

export type PromptKind = 'world' | 'rule' | 'talk';
export interface PromptEntry { t: string; kind: PromptKind; text: string; session?: string; to?: string }

/** Short tag that groups one visit's prompts; addresses (the `ip-` fallback) are never kept. */
export function sessionTag(id: string | null | undefined): string | undefined {
  if (!id || id.startsWith('ip-')) return undefined;
  return id.slice(0, 8);
}

export function promptEntry(kind: PromptKind, text: string, session?: string | null, to?: string, now = new Date()): PromptEntry {
  const e: PromptEntry = { t: now.toISOString(), kind, text: text.slice(0, 2000) };
  const tag = sessionTag(session);
  if (tag) e.session = tag;
  if (to) e.to = to.slice(0, 80);
  return e;
}

export async function logPrompt(env: { KV_REST_API_URL?: string; KV_REST_API_TOKEN?: string }, entry: PromptEntry): Promise<void> {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify([
        ['LPUSH', PROMPT_KEY, JSON.stringify(entry)],
        ['LTRIM', PROMPT_KEY, '0', String(PROMPT_KEEP - 1)],
      ]),
    });
  } catch {
    // The visitor's request goes on whether or not the record was kept.
  }
}
