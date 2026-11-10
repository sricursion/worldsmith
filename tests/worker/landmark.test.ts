import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/src/lib/env';
import { handleLandmarkFile, handleLandmarkStart, handleLandmarkStatus, landmarkKey } from '../../worker/src/routes/landmark';

class FakeKv {
  data = new Map<string, string | ArrayBuffer>();
  async get(key: string, type?: string): Promise<unknown> {
    const v = this.data.get(key);
    if (v === undefined) return null;
    if (type === 'arrayBuffer') return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v;
    return typeof v === 'string' ? v : null;
  }
  async put(key: string, value: string | ArrayBuffer): Promise<void> {
    this.data.set(key, value);
  }
}

function glb(): ArrayBuffer {
  const b = new Uint8Array(32);
  b.set([0x67, 0x6c, 0x54, 0x46]);
  return b.buffer;
}

const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function makeEnv(kv: FakeKv, extra: Partial<Record<string, string>> = {}): Env {
  return { ANTHROPIC_API_KEY: 'k', TRIPO_API_KEY: 'tk', TOWNS: kv as unknown as KVNamespace, ...extra } as Env;
}

const start = (env: Env, body: Record<string, unknown> = {}): Promise<Response> =>
  handleLandmarkStart(
    new Request('https://t.test/api/landmark', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', id: 'l1', prompt: 'A  Wooden Water Tower', height: 8, ...body }),
    }),
    env,
  );
const status = (env: Env, id: string): Promise<Response> => handleLandmarkStatus(new Request(`https://t.test/api/landmark/${id}`), env, id);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('landmark routes', () => {
  it('returns ready from storage without calling the vendor', async () => {
    const kv = new FakeKv();
    const key = await landmarkKey('a wooden water tower');
    kv.data.set(`landmark:glb:${key}`, glb());
    const res = await start(makeEnv(kv));
    const body = (await res.json()) as { status: string; url: string; jobId: string };
    expect(body.status).toBe('ready');
    expect(body.url).toBe(`/api/landmark/file/${key}`);
    expect(fetchMock).not.toHaveBeenCalled();
    const poll = (await (await status(makeEnv(kv), body.jobId)).json()) as { status: string };
    expect(poll.status).toBe('ready');
  });

  it('runs pending then ready and stores the downloaded bytes', async () => {
    const kv = new FakeKv();
    const env = makeEnv(kv);
    fetchMock.mockResolvedValueOnce(json({ code: 0, data: { task_id: 'T1' } }));
    const started = (await (await start(env)).json()) as { jobId: string; status: string };
    expect(started.status).toBe('pending');
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/generation/text-to-model');
    const sent = JSON.parse(String(call[1].body)) as { prompt: string };
    expect(sent.prompt).toContain('no ground plane');
    expect(JSON.stringify(call[1].headers)).toContain('Bearer tk');

    fetchMock.mockResolvedValueOnce(json({ data: { status: 'running' } }));
    expect(((await (await status(env, started.jobId)).json()) as { status: string }).status).toBe('pending');

    fetchMock.mockResolvedValueOnce(json({ data: { status: 'success', output: { model_url: 'https://cdn.test/m.glb' } } }));
    fetchMock.mockResolvedValueOnce(new Response(glb()));
    const ready = (await (await status(env, started.jobId)).json()) as { status: string; url: string };
    expect(ready.status).toBe('ready');
    const key = await landmarkKey('a wooden water tower');
    expect(ready.url).toBe(`/api/landmark/file/${key}`);
    expect(kv.data.get(`landmark:glb:${key}`)).toBeInstanceOf(ArrayBuffer);

    const file = await handleLandmarkFile(key, env);
    expect(file.headers.get('cache-control')).toContain('immutable');
    expect((await file.arrayBuffer()).byteLength).toBe(32);
  });

  it('enforces the daily and per-session caps', async () => {
    const kv = new FakeKv();
    const env = makeEnv(kv, { LANDMARK_DAILY_CAP: '1' });
    fetchMock.mockImplementation(async () => json({ data: { task_id: 'T' } }));
    expect(((await (await start(env, { prompt: 'first tower' })).json()) as { status: string }).status).toBe('pending');
    const capped = (await (await start(env, { prompt: 'second tower', sessionId: 's2' })).json()) as { status: string; reason: string };
    expect(capped).toMatchObject({ status: 'failed', reason: 'cap' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const kv2 = new FakeKv();
    const env2 = makeEnv(kv2);
    for (const p of ['tower one', 'tower two']) await start(env2, { prompt: p });
    const third = (await (await start(env2, { prompt: 'tower three' })).json()) as { reason: string };
    expect(third.reason).toBe('cap');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('is disabled in mock mode and without a vendor key', async () => {
    const kv = new FakeKv();
    for (const env of [makeEnv(kv, { MOCK: '1' }), makeEnv(kv, { TRIPO_API_KEY: '' })]) {
      expect(await (await start(env)).json()).toEqual({ jobId: 'none' });
      expect(await (await status(env, 'none')).json()).toEqual({ status: 'failed', reason: 'disabled' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to Meshy when only its key exists', async () => {
    const kv = new FakeKv();
    const env = makeEnv(kv, { TRIPO_API_KEY: '', MESHY_API_KEY: 'mk' });
    fetchMock.mockResolvedValueOnce(json({ result: 'M1' }));
    const r = (await (await start(env)).json()) as { status: string };
    expect(r.status).toBe('pending');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.meshy.ai/openapi/v2/text-to-3d');
  });

  it('reports a failed vendor task', async () => {
    const kv = new FakeKv();
    const env = makeEnv(kv);
    fetchMock.mockResolvedValueOnce(json({ data: { task_id: 'T' } }));
    const { jobId } = (await (await start(env)).json()) as { jobId: string };
    fetchMock.mockResolvedValueOnce(json({ data: { status: 'failed' } }));
    expect(await (await status(env, jobId)).json()).toEqual({ status: 'failed', reason: 'vendor' });
  });
});
