import { afterEach, describe, expect, it } from 'vitest';
import middleware, { demoResponse, passwordFrom } from '../../middleware';

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

  it('forwards /demo to the video without asking for the password', () => {
    process.env['SITE_PASSWORD'] = 'open sesame';
    const waiting = middleware(new Request('https://example.test/demo'));
    expect(waiting?.status).toBe(200);
    process.env['DEMO_VIDEO_URL'] = 'https://video.example/watch?v=abc';
    const sent = middleware(new Request('https://example.test/demo/'));
    expect(sent?.status).toBe(302);
    expect(sent?.headers.get('location')).toBe('https://video.example/watch?v=abc');
    expect(middleware(new Request('https://example.test/demonstration'))?.status).toBe(401);
    expect(demoResponse('javascript:alert(1)').status).toBe(200);
    expect(demoResponse('not a url').status).toBe(200);
  });
});
