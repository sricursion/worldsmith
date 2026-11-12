import { afterEach, describe, expect, it } from 'vitest';
import middleware, { DEMO_VIDEO, demoResponse, embedOf, passwordFrom } from '../../middleware';

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
