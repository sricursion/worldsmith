// Browser client for the Worker API. Errors are values: every method resolves, none rejects.
import type { RuleSpec, WorldSpec } from '../world/spec';
import type { NpcSayRequest, PatchRequest, TickRequest } from './types';
import { abortPromise, parseSse } from './sse';

export interface Api {
  compile(prompt: string, seed: number, onPartial: (text: string) => void, signal?: AbortSignal): Promise<{ ok: true; spec: unknown } | { ok: false; error: string }>;
  npcSay(body: NpcSayRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; error: string; refusal?: boolean }>;
  tick(body: TickRequest): Promise<{ ok: true; probs: number[][] } | { ok: false; error: string }>;
  patchRules(body: PatchRequest): Promise<{ ok: true; rules: RuleSpec[] } | { ok: false; error: string }>;
  share(spec: WorldSpec): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  load(id: string): Promise<{ ok: true; spec: unknown } | { ok: false; error: string }>;
  health(): Promise<{ ok: boolean; mock: boolean }>;
}

export const COMPILE_IDLE_MS = 20_000;
export const NPC_IDLE_MS = 8_000;
export const JSON_TIMEOUT_MS = 6_000;

class ApiFailure extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface Guard {
  signal: AbortSignal;
  reset(): void;
  clear(): void;
  timedOut(): boolean;
}

/** An abort signal that fires after `ms` of silence (call reset() on activity) or when `external` aborts. */
function createGuard(ms: number, external?: AbortSignal): Guard {
  const ctl = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, ms);
  };
  const onExternal = (): void => ctl.abort();
  if (external) {
    if (external.aborted) ctl.abort();
    else external.addEventListener('abort', onExternal, { once: true });
  }
  arm();
  return {
    signal: ctl.signal,
    reset: arm,
    clear: () => {
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener('abort', onExternal);
    },
    timedOut: () => timedOut,
  };
}

function describeError(err: unknown, guard: Guard, external?: AbortSignal): string {
  if (guard.timedOut()) return 'timeout';
  if (external?.aborted) return 'aborted';
  if (err instanceof ApiFailure) return err.message;
  return 'network';
}

async function httpError(res: Response): Promise<string> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const reason = isRecord(body) && typeof body['reason'] === 'string' ? body['reason'] : undefined;
  if (res.status === 429) return reason === 'resting' ? 'resting' : 'rate_limited';
  if (isRecord(body) && typeof body['error'] === 'string') return body['error'];
  return `http_${res.status}`;
}

function eventError(data: unknown): string {
  if (!isRecord(data)) return 'upstream';
  if (data['reason'] === 'resting') return 'resting';
  return typeof data['error'] === 'string' ? data['error'] : 'upstream';
}

function parseData(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function createApi(base = '/api'): Api {
  const root = base.replace(/\/+$/, '');

  /** fetch that also gives up when the guard fires, even if the platform fetch ignores the signal. */
  async function guardedFetch(path: string, init: RequestInit, guard: Guard): Promise<Response> {
    const gate = abortPromise(guard.signal);
    try {
      return await Promise.race([globalThis.fetch(root + path, { ...init, signal: guard.signal }), gate.promise]);
    } finally {
      gate.off();
    }
  }

  const postInit = (body: unknown, sse: boolean): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: sse ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify(body),
  });

  async function requestJson(path: string, init: RequestInit): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    const guard = createGuard(JSON_TIMEOUT_MS);
    try {
      const res = await guardedFetch(path, init, guard);
      if (!res.ok) return { ok: false, error: await httpError(res) };
      const gate = abortPromise(guard.signal);
      try {
        return { ok: true, data: await Promise.race([res.json() as Promise<unknown>, gate.promise]) };
      } catch (err) {
        if (guard.timedOut()) throw err;
        throw new ApiFailure('bad_response');
      } finally {
        gate.off();
      }
    } catch (err) {
      return { ok: false, error: describeError(err, guard) };
    } finally {
      guard.clear();
    }
  }

  return {
    async compile(prompt, seed, onPartial, signal) {
      const guard = createGuard(COMPILE_IDLE_MS, signal);
      try {
        const res = await guardedFetch('/compile', postInit({ prompt, seed }, true), guard);
        if (!res.ok) return { ok: false, error: await httpError(res) };
        if (!res.body) return { ok: false, error: 'empty_response' };
        guard.reset();
        let acc = '';
        for await (const ev of parseSse(res.body, guard.signal)) {
          guard.reset();
          const data = parseData(ev.data);
          if (ev.event === 'partial') {
            if (isRecord(data) && typeof data['text'] === 'string') {
              acc += data['text'];
              onPartial(acc);
            }
          } else if (ev.event === 'spec') {
            if (data === undefined || data === null) return { ok: false, error: 'bad_spec' };
            return { ok: true, spec: data };
          } else if (ev.event === 'error') {
            return { ok: false, error: eventError(data) };
          }
        }
        return { ok: false, error: 'stream_ended' };
      } catch (err) {
        return { ok: false, error: describeError(err, guard, signal) };
      } finally {
        guard.clear();
      }
    },

    async npcSay(body, onToken, signal) {
      const guard = createGuard(NPC_IDLE_MS, signal);
      try {
        const res = await guardedFetch('/npc/say', postInit(body, true), guard);
        if (!res.ok) return { ok: false, error: await httpError(res) };
        if (!res.body) return { ok: false, error: 'empty_response' };
        guard.reset();
        const parts: string[] = [];
        for await (const ev of parseSse(res.body, guard.signal)) {
          guard.reset();
          const data = parseData(ev.data);
          if (ev.event === 'token') {
            const tok = isRecord(data) ? (typeof data['text'] === 'string' ? data['text'] : typeof data['t'] === 'string' ? data['t'] : null) : null;
            if (tok !== null) {
              parts.push(tok);
              onToken(tok);
            }
          } else if (ev.event === 'done') {
            if (isRecord(data) && data['refusal'] === true) return { ok: false, error: 'refusal', refusal: true };
            return { ok: true, text: parts.join('') };
          } else if (ev.event === 'error') {
            return { ok: false, error: eventError(data) };
          }
        }
        return { ok: false, error: 'stream_ended' };
      } catch (err) {
        return { ok: false, error: describeError(err, guard, signal) };
      } finally {
        guard.clear();
      }
    },

    async tick(body) {
      const r = await requestJson('/tick', postInit(body, false));
      if (!r.ok) return r;
      const probs = isRecord(r.data) ? r.data['probs'] : undefined;
      if (!Array.isArray(probs) || !probs.every((row) => Array.isArray(row) && row.every((n) => typeof n === 'number'))) {
        return { ok: false, error: 'bad_response' };
      }
      return { ok: true, probs: probs as number[][] };
    },

    async patchRules(body) {
      const r = await requestJson('/rules/patch', postInit(body, false));
      if (!r.ok) return r;
      const rules = isRecord(r.data) ? r.data['rules'] : undefined;
      if (!Array.isArray(rules)) return { ok: false, error: 'bad_response' };
      return { ok: true, rules: rules as RuleSpec[] };
    },

    async share(spec) {
      const r = await requestJson('/share', postInit(spec, false));
      if (!r.ok) return r;
      const id = isRecord(r.data) ? r.data['id'] : undefined;
      if (typeof id !== 'string' || id === '') return { ok: false, error: 'bad_response' };
      return { ok: true, id };
    },

    async load(id) {
      const r = await requestJson(`/load/${encodeURIComponent(id)}`, { method: 'GET', headers: { accept: 'application/json' } });
      if (!r.ok) return r;
      if (!isRecord(r.data)) return { ok: false, error: 'bad_response' };
      return { ok: true, spec: r.data };
    },

    async health() {
      const r = await requestJson('/health', { method: 'GET', headers: { accept: 'application/json' } });
      if (!r.ok || !isRecord(r.data)) return { ok: false, mock: false };
      return { ok: r.data['ok'] === true, mock: r.data['mock'] === true };
    },
  };
}
