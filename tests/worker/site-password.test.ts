import { afterEach, describe, expect, it } from 'vitest';
import middleware, { passwordFrom } from '../../middleware';

const basic = (user: string, pass: string): string => `Basic ${btoa(`${user}:${pass}`)}`;
const req = (auth?: string): Request => new Request('https://example.test/', auth ? { headers: { authorization: auth } } : {});

describe('site password', () => {
  afterEach(() => { delete process.env['SITE_PASSWORD']; });

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
});
