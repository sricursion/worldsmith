import { describe, expect, it, vi, afterEach } from 'vitest';
import { logPrompt, promptEntry, PROMPT_KEY, sessionTag } from '../../worker/src/lib/promptlog';

describe('prompt log', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a short session tag and never an address', () => {
    expect(sessionTag('ip-203.0.113.9')).toBeUndefined();
    expect(sessionTag('k3J9xYz0abcdef')).toBe('k3J9xYz0');
    const e = promptEntry('world', 'x'.repeat(3000), 'ip-1.2.3.4', undefined, new Date('2026-11-22T00:00:00Z'));
    expect(e).toEqual({ t: '2026-11-22T00:00:00.000Z', kind: 'world', text: 'x'.repeat(2000) });
  });

  it('writes nothing without the store, and pushes then trims with it', async () => {
    const f = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', f);
    await logPrompt({}, promptEntry('rule', 'no guns'));
    expect(f).not.toHaveBeenCalled();
    await logPrompt({ KV_REST_API_URL: 'https://r.example/', KV_REST_API_TOKEN: 'tok' }, promptEntry('rule', 'no guns', 'sess12345'));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://r.example/pipeline');
    const cmds = JSON.parse(String(init.body)) as string[][];
    expect(cmds[0]?.[0]).toBe('LPUSH');
    expect(cmds[0]?.[1]).toBe(PROMPT_KEY);
    expect(JSON.parse(cmds[0]?.[2] ?? '{}')).toMatchObject({ kind: 'rule', text: 'no guns', session: 'sess1234' });
    expect(cmds[1]).toEqual(['LTRIM', PROMPT_KEY, '0', '4999']);
  });

  it('swallows a store failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(logPrompt({ KV_REST_API_URL: 'https://r.example', KV_REST_API_TOKEN: 't' }, promptEntry('talk', 'hi'))).resolves.toBeUndefined();
  });
});

describe('middleware stays self-contained', () => {
  it('imports nothing, since the host runs it unbundled, and uses the same store key', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    const mw = await import('../../middleware');
    expect(mw.PROMPT_KEY).toBe(PROMPT_KEY);
  });
});
