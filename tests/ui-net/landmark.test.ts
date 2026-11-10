import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollLandmark } from '../../app/src/engine/landmark';
import { createApi } from '../../app/src/net/api';

type Status = Awaited<ReturnType<ReturnType<typeof createApi>['landmarkStatus']>>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pollLandmark', () => {
  it('times out with fake timers while the job stays pending', async () => {
    vi.useFakeTimers();
    const landmarkStatus = vi.fn(async (): Promise<Status> => ({ ok: true, status: 'pending' }));
    const p = pollLandmark({ landmarkStatus }, 'j1', { intervalMs: 1000, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toEqual({ ok: false, reason: 'timeout' });
    expect(landmarkStatus.mock.calls.length).toBeGreaterThan(2);
  });

  it('resolves with the url once ready, retrying transient errors', async () => {
    vi.useFakeTimers();
    const landmarkStatus = vi
      .fn<() => Promise<Status>>()
      .mockResolvedValueOnce({ ok: false, error: 'network' })
      .mockResolvedValueOnce({ ok: true, status: 'pending' })
      .mockResolvedValueOnce({ ok: true, status: 'ready', url: '/api/landmark/file/abc' });
    const p = pollLandmark({ landmarkStatus }, 'j1', { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: true, url: '/api/landmark/file/abc' });
  });

  it('returns failure reasons, disabled for none, and aborts', async () => {
    const failed = { landmarkStatus: async (): Promise<Status> => ({ ok: true, status: 'failed', reason: 'cap' }) };
    expect(await pollLandmark(failed, 'j')).toEqual({ ok: false, reason: 'cap' });
    expect(await pollLandmark(failed, 'none')).toEqual({ ok: false, reason: 'disabled' });
    const ctl = new AbortController();
    ctl.abort();
    expect(await pollLandmark(failed, 'j', { signal: ctl.signal })).toEqual({ ok: false, reason: 'aborted' });
  });
});

describe('api landmark calls', () => {
  it('parses start and status responses', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    f.mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'j', status: 'ready', url: '/api/landmark/file/x' })));
    const api = createApi('/api');
    expect(await api.landmarkStart({ sessionId: 's', id: 'l', prompt: 'p', height: 5 })).toEqual({ ok: true, jobId: 'j', status: 'ready', url: '/api/landmark/file/x' });
    f.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed', reason: 'disabled' })));
    expect(await api.landmarkStatus('none')).toEqual({ ok: true, status: 'failed', reason: 'disabled' });
    expect((f.mock.calls[1] as [string])[0]).toBe('/api/landmark/none');
    f.mockResolvedValueOnce(new Response(JSON.stringify({ nope: 1 })));
    expect(await api.landmarkStatus('j')).toEqual({ ok: false, error: 'bad_response' });
  });
});
