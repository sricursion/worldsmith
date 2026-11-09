import { describe, expect, it } from 'vitest';
import {
  budgetLimits,
  DAILY_GLOBAL_BUDGET,
  DAILY_IP_BUDGET,
  DAILY_TOKEN_BUDGET,
  globalBudgetKey,
  ipBudgetId,
  ipBudgetKey,
} from '../../worker/src/lib/budget';
import type { Env } from '../../worker/src/lib/env';
import { chargeBudget, guardBudget, guardEarly } from '../../worker/src/lib/guard';
import { readJson } from '../../worker/src/lib/http';
import { validateNpcSay } from '../../worker/src/lib/validate';
import { handleLoad, handleShare, shareId } from '../../worker/src/routes/share';

class FakeKv {
  data = new Map<string, string>();
  puts: string[] = [];
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.puts.push(key);
    this.data.set(key, value);
  }
}

function realEnv(kv: FakeKv, extra: Partial<Env> = {}): Env {
  return { ANTHROPIC_API_KEY: 'k', TOWNS: kv as unknown as KVNamespace, ...extra };
}

const NOW = Math.floor(Date.UTC(2026, 10, 9, 12) / 1000);

describe('budget limits and keys', () => {
  it('uses the defaults and honours env overrides', () => {
    expect(budgetLimits({})).toEqual({ session: DAILY_TOKEN_BUDGET, ip: DAILY_IP_BUDGET, global: DAILY_GLOBAL_BUDGET });
    expect(DAILY_TOKEN_BUDGET).toBe(300_000);
    expect(DAILY_IP_BUDGET).toBe(600_000);
    expect(DAILY_GLOBAL_BUDGET).toBe(6_000_000);
    expect(budgetLimits({ BUDGET_IP_TOKENS: '1000', BUDGET_GLOBAL_TOKENS: 'bogus' })).toMatchObject({
      ip: 1000,
      global: DAILY_GLOBAL_BUDGET,
    });
  });
  it('truncates IPv6 to the /64 and keys by UTC date', () => {
    expect(ipBudgetId('203.0.113.9')).toBe('203.0.113.9');
    expect(ipBudgetId('2001:db8:abcd:12:aaaa:bbbb:cccc:dddd')).toBe('2001:0db8:abcd:0012');
    expect(ipBudgetId('2001:db8:abcd:12::1')).toBe('2001:0db8:abcd:0012');
    expect(ipBudgetId('2001:DB8::1')).toBe('2001:0db8:0000:0000');
    expect(ipBudgetId('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(ipBudgetKey('2001:db8:abcd:12::1', NOW)).toBe('budget:ip:2001:0db8:abcd:0012:2026-11-09');
    expect(globalBudgetKey(NOW)).toBe('budget:global:2026-11-09');
  });
});

describe('guardBudget and chargeBudget', () => {
  const req = new Request('https://x.test/api/compile', { headers: { 'cf-connecting-ip': '203.0.113.9' } });
  const scope = { session: 'sess1', ip: '203.0.113.9' };

  it('charges the session, the IP and the global counter together', async () => {
    const kv = new FakeKv();
    await chargeBudget(realEnv(kv), scope, 1234);
    const keys = [...kv.data.keys()];
    expect(keys).toContain('budget:sess1');
    expect(keys.some((k) => k.startsWith('budget:ip:203.0.113.9:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('budget:global:'))).toBe(true);
    const ipKey = keys.find((k) => k.startsWith('budget:ip:')) ?? '';
    expect(kv.data.get(ipKey)).toBe('1234');
  });

  it('rests when the IP ceiling is reached even with a fresh session id', async () => {
    const kv = new FakeKv();
    const env = realEnv(kv, { BUDGET_IP_TOKENS: '1000' });
    await chargeBudget(env, scope, 1000);
    const gate = await guardBudget(env, { session: 'brand-new', ip: scope.ip });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.res.status).toBe(429);
      expect(await gate.res.json()).toEqual({ error: 'resting', reason: 'resting' });
    }
    expect((await guardBudget(env, { session: 'brand-new', ip: '198.51.100.1' })).ok).toBe(true);
  });

  it('rests for everyone once the global ceiling is reached', async () => {
    const kv = new FakeKv();
    const env = realEnv(kv, { BUDGET_GLOBAL_TOKENS: '500' });
    await chargeBudget(env, scope, 500);
    const gate = await guardBudget(env, { session: 'other', ip: '198.51.100.1' });
    expect(gate.ok).toBe(false);
  });

  it('still enforces the session ceiling and skips everything in mock mode', async () => {
    const kv = new FakeKv();
    const env = realEnv(kv, { BUDGET_SESSION_TOKENS: '100' });
    await chargeBudget(env, scope, 100);
    expect((await guardBudget(env, scope)).ok).toBe(false);
    expect((await guardBudget({ ...env, MOCK: '1' }, scope)).ok).toBe(true);
  });

  it('guardEarly no longer demands a Turnstile token', async () => {
    expect(await guardEarly(req, { TURNSTILE_SECRET: 'x' } as Env)).toBeNull();
  });
});

describe('model text truncation', () => {
  function body(over: Record<string, unknown> = {}, npc: Record<string, unknown> = {}, ctx: Record<string, unknown> = {}) {
    return {
      sessionId: 's1',
      playerText: 'hello',
      npc: { id: 'n1', name: 'Ann', role: 'baker', persona: 'kind', knowledge: ['a'], revealed: [], mood: 'calm', place: 'shop', ...npc },
      context: {
        title: 'T',
        era: 'E',
        theme: 'western',
        lexicon: ['w'],
        hour: 9,
        day: 1,
        rules: [],
        activeBeats: [],
        recentLog: [],
        ...ctx,
      },
      history: [],
      ...over,
    };
  }

  it('cuts long strings and long arrays instead of rejecting', () => {
    const r = validateNpcSay(
      body(
        { history: Array.from({ length: 30 }, (_, i) => ({ speaker: 'npc', text: `${i}`.padEnd(900, 'x') })) },
        { persona: 'p'.repeat(5000), name: 'n'.repeat(200), knowledge: Array.from({ length: 40 }, () => 'k'.repeat(900)) },
        {
          title: 't'.repeat(500),
          rules: Array.from({ length: 30 }, (_, i) => `rule${i}`),
          lexicon: Array.from({ length: 80 }, () => 'l'),
          activeBeats: Array.from({ length: 12 }, (_, i) => ({ stepId: `s${i}`, objective: 'o'.repeat(900), beat: 'b'.repeat(900) })),
        },
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.npc.persona).toHaveLength(1200);
    expect(r.value.npc.name).toHaveLength(80);
    expect(r.value.npc.knowledge).toHaveLength(24);
    expect(r.value.npc.knowledge[0]).toHaveLength(400);
    expect(r.value.context.title).toHaveLength(160);
    expect(r.value.context.rules).toHaveLength(20);
    expect(r.value.context.rules[19]).toBe('rule29');
    expect(r.value.context.lexicon).toHaveLength(40);
    expect(r.value.context.activeBeats).toHaveLength(8);
    expect(r.value.context.activeBeats[0]?.objective).toHaveLength(400);
    expect(r.value.history.length).toBeLessThanOrEqual(8);
  });

  it('still rejects wrong types and player text abuse', () => {
    expect(validateNpcSay(body({}, { persona: 5 })).ok).toBe(false);
    expect(validateNpcSay(body({}, { knowledge: ['ok', 3] })).ok).toBe(false);
    expect(validateNpcSay(body({}, {}, { rules: 'nope' })).ok).toBe(false);
    expect(validateNpcSay(body({ playerText: 'x'.repeat(501) })).ok).toBe(false);
  });
});

describe('readJson body cap', () => {
  it('returns 413 and stops reading once a chunked body passes the cap', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode('x'.repeat(100)));
        if (pulled > 1000) controller.close();
      },
    });
    const req = new Request('https://x.test/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    const out = await readJson(req, 450);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.res.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });
  it('parses a body under the cap and flags bad JSON', async () => {
    const ok = await readJson(new Request('https://x.test/', { method: 'POST', body: '{"a":1}' }), 100);
    expect(ok).toEqual({ ok: true, value: { a: 1 } });
    const bad = await readJson(new Request('https://x.test/', { method: 'POST', body: '{oops' }), 100);
    expect(bad.ok).toBe(false);
  });
});

describe('share ids', () => {
  const spec = { title: 'T', theme: 'western', buildings: [], npcs: [], quest: {} };
  const post = (): Request => new Request('https://x.test/api/share', { method: 'POST', body: JSON.stringify(spec) });

  it('uses 24 hex characters', async () => {
    expect(await shareId('abc')).toMatch(/^[0-9a-f]{24}$/);
  });

  it('never overwrites an existing key', async () => {
    const kv = new FakeKv();
    const env = realEnv(kv);
    const id = await shareId(JSON.stringify(spec));
    kv.data.set(`town:${id}`, 'original');
    const res = await handleShare(post(), env);
    expect(await res.json()).toEqual({ id });
    expect(kv.puts).toHaveLength(0);
    expect(kv.data.get(`town:${id}`)).toBe('original');
  });

  it('stores a new town once and loads both id lengths', async () => {
    const kv = new FakeKv();
    const env = realEnv(kv);
    const res = await handleShare(post(), env);
    const { id } = (await res.json()) as { id: string };
    expect(id).toHaveLength(24);
    expect(kv.puts).toEqual([`town:${id}`]);
    expect((await handleLoad(id, env)).status).toBe(200);
    kv.data.set('town:0123456789', '{"old":true}');
    expect((await handleLoad('0123456789', env)).status).toBe(200);
    expect((await handleLoad('0123456', env)).status).toBe(400);
  });
});
