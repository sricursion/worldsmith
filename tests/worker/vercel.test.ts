import { describe, expect, it } from 'vitest';
import handler, { originalUrl } from '../../api/index';

describe('Vercel entry point', () => {
  it('rebuilds the API path from the rewrite parameter', () => {
    expect(originalUrl('https://x.test/api?p=health').pathname).toBe('/api/health');
    expect(originalUrl('https://x.test/api?p=npc/say').pathname).toBe('/api/npc/say');
    expect(originalUrl('https://x.test/api?p=landmark/abc&x=1').toString()).toBe('https://x.test/api/landmark/abc?x=1');
    expect(originalUrl('https://x.test/api/health').pathname).toBe('/api/health');
  });

  it('answers health through the shared handler, in mock mode when no key is set', async () => {
    const res = await handler(new Request('https://x.test/api?p=health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('declines short share links so the client keeps the whole world in the URL', async () => {
    const res = await handler(new Request('https://x.test/api?p=share', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(503);
    expect((await handler(new Request('https://x.test/api?p=load/abcdef1234'))).status).toBe(404);
  });

  it('streams a mock compile end to end', async () => {
    const res = await handler(new Request('https://x.test/api?p=compile', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://x.test' }, body: JSON.stringify({ prompt: 'a desert town', seed: 3 }),
    }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: spec');
  }, 20000);
});
