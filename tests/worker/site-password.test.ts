import { afterEach, describe, expect, it } from 'vitest';
import middleware, { DEMO_VIDEO, demoResponse, embedOf, passwordFrom, promptsResponse } from '../../middleware';

const basic = (user: string, pass: string): string => `Basic ${btoa(`${user}:${pass}`)}`;
const req = (auth?: string): Request => new Request('https://example.test/', auth ? { headers: { authorization: auth } } : {});

describe('site password', () => {
  afterEach(() => { delete process.env['SITE_PASSWORD']; delete process.env['DEMO_VIDEO_URL']; });

  it('lets everything through when no password is set', () => {
    expect(middleware(req())).toBeUndefined();
  });

  it('asks for the password and takes it under any user name', () => {
    process.env['SITE_PASSWORD'] = 'open sesame';
    const denied = middleware(req());
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get('www-authenticate')).toContain('Basic');
    expect(middleware(req(basic('judge', 'wrong')))?.status).toBe(401);
    expect(middleware(req(basic('judge', 'open sesame')))).toBeUndefined();
    expect(middleware(req(basic('', 'open sesame')))).toBeUndefined();
  });

  it('reads a password that itself holds a colon, and rejects junk', () => {
    expect(passwordFrom(basic('u', 'a:b'))).toBe('a:b');
    expect(passwordFrom('Bearer x')).toBeNull();
    expect(passwordFrom('Basic %%%')).toBeNull();
  });

  it('shows the video at /demo, embedded, without asking for the password', async () => {
    process.env['SITE_PASSWORD'] = 'open sesame';
    const page = middleware(new Request('https://example.test/demo'));
    expect(page?.status).toBe(200);
    expect(page?.headers.get('location')).toBeNull();
    expect(await page?.text()).toContain('<iframe class="player" src="https://drive.google.com/file/d/');
    process.env['DEMO_VIDEO_URL'] = 'https://www.youtube.com/watch?v=abc123XYZ_-';
    const yt = middleware(new Request('https://example.test/demo/'));
    expect(yt?.status).toBe(200);
    expect(await yt?.text()).toContain('src="https://www.youtube.com/embed/abc123XYZ_-"');
    expect(middleware(new Request('https://example.test/demonstration'))?.status).toBe(401);
  });

  it('lets the page-view counter load without the password, on the app and on the demo page', async () => {
    process.env['SITE_PASSWORD'] = 'open sesame';
    expect(middleware(new Request('https://example.test/_vercel/insights/script.js'))).toBeUndefined();
    expect(middleware(new Request('https://example.test/_vercel/insights/view', { method: 'POST' }))).toBeUndefined();
    expect(middleware(new Request('https://example.test/_vercelish'))?.status).toBe(401);
    expect(await middleware(new Request('https://example.test/demo'))?.text()).toContain('src="/_vercel/insights/script.js"');
  });

  it('turns share addresses into embeds and refuses anything that is not https', async () => {
    expect(embedOf('https://drive.google.com/file/d/1AbC_d-9/view?usp=sharing')).toEqual({ src: 'https://drive.google.com/file/d/1AbC_d-9/preview', kind: 'frame' });
    expect(embedOf('https://youtu.be/abc123XYZ_-')?.src).toBe('https://www.youtube.com/embed/abc123XYZ_-');
    expect(embedOf('https://cdn.example/film.mp4')).toEqual({ src: 'https://cdn.example/film.mp4', kind: 'file' });
    expect(embedOf('javascript:alert(1)')).toBeNull();
    expect(embedOf('not a url')).toBeNull();
    expect(embedOf(DEMO_VIDEO)?.src).toMatch(/\/preview$/);
    // A bad address on the host falls back to the built-in video, and markup in an address is not passed through.
    expect(await demoResponse('javascript:alert(1)').text()).toContain('drive.google.com/file/d/');
    expect(await demoResponse('https://x.example/a"><script>alert(1)</script>.mp4').text()).not.toContain('<script>alert');
  });
});

describe('prompts page', () => {
  afterEach(() => { delete process.env['SITE_PASSWORD']; });
  const store = { KV_REST_API_URL: 'https://redis.example', KV_REST_API_READ_ONLY_TOKEN: 'ro' };

  it('is not served without a site password, and needs the password when one is set', async () => {
    expect((await middleware(new Request('https://example.test/prompts')))?.status).toBe(404);
    process.env['SITE_PASSWORD'] = 'open sesame';
    expect((await middleware(new Request('https://example.test/prompts')))?.status).toBe(401);
  });

  it('lists entries newest first, escaped, from the read-only token', async () => {
    let seen = '';
    let auth = '';
    const fake = (async (u: string, init?: RequestInit) => {
      seen = u;
      auth = new Headers(init?.headers).get('authorization') ?? '';
      const rows = [
        JSON.stringify({ t: '2026-11-22T10:00:00.000Z', kind: 'world', text: 'a city <script>x</script>', session: 'abcd1234' }),
        JSON.stringify({ t: '2026-11-22T09:00:00.000Z', kind: 'talk', text: 'hello', to: 'Mara' }),
        'not json',
      ];
      return new Response(JSON.stringify({ result: rows }), { status: 200 });
    }) as typeof fetch;
    const html = await (await promptsResponse(store, fake)).text();
    expect(seen).toBe('https://redis.example/lrange/worldsmith%3Aprompts/0/999');
    expect(auth).toBe('Bearer ro');
    expect(html).toContain('2 shown');
    expect(html).toContain('1 worlds');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('to Mara');
    expect(html.indexOf('a city')).toBeLessThan(html.indexOf('hello'));
  });

  it('says so when no store is connected', async () => {
    expect(await (await promptsResponse({})).text()).toContain('No store is connected');
  });
});
