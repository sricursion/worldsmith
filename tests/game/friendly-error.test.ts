import { describe, expect, it } from 'vitest';
import { friendlyError } from '../../app/src/game';

describe('friendlyError', () => {
  it('maps transport and model codes to player-facing lines', () => {
    expect(friendlyError('resting')).toMatch(/resting/);
    expect(friendlyError('rate_limited')).toMatch(/resting/);
    expect(friendlyError('refusal')).toMatch(/could not be built/);
    for (const c of ['timeout', 'network', 'stream_ended', 'upstream', 'http_502']) expect(friendlyError(c)).toMatch(/could not be reached/);
    expect(friendlyError('bad_spec')).toMatch(/malformed/);
    expect(friendlyError('anything_else')).toBe('Something went wrong');
  });
});
