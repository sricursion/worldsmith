// Text-to-speech for NPC lines. When the Worker reports ElevenLabs voices, each sentence is fetched from
// /api/npc/voice and played in order; any failure drops that sentence (and, after a 404 or 429, the rest of
// the session) back to the browser's SpeechSynthesis. Every call is a no-op where both are missing and
// none of them can throw.
import { hash32 } from '../world/rng';
import type { NpcSpec } from '../world/spec';
import { speechOf } from './dialogue';

/** What the server voice choice is derived from. */
export interface Speaker {
  id: string;
  role?: string;
  persona?: string;
}

export interface SpeechOptions {
  /** Sent with every voice request; the Worker meters characters by it. */
  sessionId: string;
  /** API root, default '/api'. */
  base?: string;
}

export interface Speech {
  /**
   * `key` (normally the NPC name) picks a stable browser voice; without it the pitch/rate pair is used.
   * `who` lets the line use a server voice; without it the browser voice is used.
   */
  speak(text: string, voice: NpcSpec['voice'], key?: string, who?: Speaker): void;
  cancel(): void;
  /** 0..1, applied as the volume of every utterance spoken afterwards. */
  setVolume(v: number): void;
  enabled: boolean;
}

export function splitSentences(text: string): string[] {
  const cleaned = speechOf(text);
  if (cleaned.length === 0) return [];
  const parts = cleaned.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) ?? [cleaned];
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 1;
}

export function pickVoice(voices: readonly SpeechSynthesisVoice[], key: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = en.length > 0 ? en : voices;
  return pool[hash32(key) % pool.length] ?? null;
}

const FEMALE_ABOVE = 1.05;
const MALE_BELOW = 0.95;
const OLD_WORDS = /\b(old|elder|elderly|aged|grandfather|grandmother|grandma|granny|veteran|ancient|retired|widow|widower)\b/;
const ROUGH_WORDS = /\b(outlaw|bandit|gunslinger|brute|thug|pirate|mercenary|drifter|brawler|smuggler|marauder|raider|rough|gruff|grizzled|scarred|bounty|miner|dockhand|sailor)\b/;
const YOUNG_WORDS = /\b(young|child|kid|boy|girl|teen|teenage|teenager|apprentice|student|novice|youth|orphan|rookie|cadet|stablehand)\b/;

/**
 * Server voice key such as "m-mid-3" or "f-young-1". Pitch decides the sex (clearly high is female, clearly
 * low is male, in between the id hash decides), role and persona words decide age or roughness, and a hash
 * of the NPC id picks within the group, so one person always gets the same voice.
 */
export function voiceKeyFor(who: Speaker, voice: NpcSpec['voice']): string {
  const female = voice.pitch > FEMALE_ABOVE ? true : voice.pitch < MALE_BELOW ? false : (hash32(who.id) & 1) === 1;
  const text = `${who.role ?? ''} ${who.persona ?? ''}`.toLowerCase();
  let age = 'mid';
  if (OLD_WORDS.test(text)) age = 'old';
  else if (ROUGH_WORDS.test(text)) age = 'rough';
  else if (YOUNG_WORDS.test(text)) age = 'young';
  // The table has old and rough voices for men only.
  if (female && (age === 'old' || age === 'rough')) age = 'mid';
  return `${female ? 'f' : 'm'}-${age}-${hash32(`${who.id}|voice`) % 1000}`;
}

function getSynth(): SpeechSynthesis | null {
  try {
    if (typeof window === 'undefined') return null;
    if (!('speechSynthesis' in window) || !window.speechSynthesis) return null;
    if (typeof SpeechSynthesisUtterance === 'undefined') return null;
    return window.speechSynthesis;
  } catch {
    return null;
  }
}

export function createSpeech(opts?: SpeechOptions): Speech {
  const synth = getSynth();
  const root = (opts?.base ?? '/api').replace(/\/+$/, '');
  let volume = 1;
  let voicesOn = false;
  // Bumped by cancel(); queued work from an older generation does nothing.
  let gen = 0;
  let tail: Promise<void> = Promise.resolve();
  const controllers = new Set<AbortController>();
  let stopCurrent: (() => void) | null = null;
  let current: HTMLAudioElement | null = null;

  const utterance = (sentence: string, voice: NpcSpec['voice'], chosen: SpeechSynthesisVoice | null): SpeechSynthesisUtterance => {
    const u = new SpeechSynthesisUtterance(sentence);
    u.pitch = clamp(voice.pitch, 0.5, 2);
    u.rate = clamp(voice.rate, 0.5, 2);
    u.volume = volume;
    if (chosen) {
      u.voice = chosen;
      u.lang = chosen.lang;
    }
    return u;
  };

  const browserSpeak = (text: string, voice: NpcSpec['voice'], key: string | undefined): void => {
    if (!synth) return;
    try {
      const chosen = pickVoice(synth.getVoices(), key ?? `${voice.pitch}|${voice.rate}`);
      for (const sentence of splitSentences(text)) synth.speak(utterance(sentence, voice, chosen));
    } catch {
      /* speech is a nicety; ignore platform errors */
    }
  };

  /** One sentence through the browser voice, resolving when it ends so the queue keeps its order. */
  const browserSentence = (sentence: string, voice: NpcSpec['voice'], key: string | undefined): Promise<void> =>
    new Promise<void>((resolve) => {
      if (!synth) return resolve();
      try {
        const u = utterance(sentence, voice, pickVoice(synth.getVoices(), key ?? `${voice.pitch}|${voice.rate}`));
        const done = (): void => {
          clearTimeout(timer);
          if (stopCurrent === done) stopCurrent = null;
          resolve();
        };
        const timer = setTimeout(done, 4000 + sentence.length * 150);
        u.onend = done;
        u.onerror = done;
        stopCurrent = done;
        synth.speak(u);
      } catch {
        resolve();
      }
    });

  /** The audio for one sentence, or null on any failure. A 404 or 429 also ends server voices for the session. */
  const fetchAudio = async (text: string, voiceKey: string, ctl: AbortController): Promise<Blob | null> => {
    try {
      const res = await globalThis.fetch(`${root}/npc/voice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ sessionId: opts?.sessionId ?? '', text, voiceKey }),
        signal: ctl.signal,
      });
      if (res.status === 404 || res.status === 429) {
        voicesOn = false;
        return null;
      }
      if (!res.ok) return null;
      const blob = await res.blob();
      return blob.size > 0 ? blob : null;
    } catch {
      return null;
    } finally {
      controllers.delete(ctl);
    }
  };

  const playBlob = (blob: Blob): Promise<void> =>
    new Promise<void>((resolve) => {
      let url = '';
      try {
        url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = volume;
        const done = (): void => {
          audio.onended = null;
          audio.onerror = null;
          if (stopCurrent === done) stopCurrent = null;
          if (current === audio) current = null;
          try {
            audio.pause();
            URL.revokeObjectURL(url);
          } catch {
            /* ignore */
          }
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        stopCurrent = done;
        current = audio;
        void Promise.resolve(audio.play()).catch(done);
      } catch {
        if (url) URL.revokeObjectURL(url);
        resolve();
      }
    });

  const speech: Speech = {
    get enabled(): boolean {
      return synth !== null || voicesOn;
    },
    speak(text, voice, key, who) {
      if (!voicesOn || !who) {
        browserSpeak(text, voice, key);
        return;
      }
      if (volume <= 0) return;
      const sentences = splitSentences(text);
      if (sentences.length === 0) return;
      const voiceKey = voiceKeyFor(who, voice);
      const myGen = gen;
      // Every sentence is requested now so the next one is ready when the current one ends.
      const jobs = sentences.map((sentence) => {
        const ctl = new AbortController();
        controllers.add(ctl);
        return { sentence, audio: fetchAudio(sentence, voiceKey, ctl) };
      });
      for (const job of jobs) {
        tail = tail.then(async () => {
          const blob = await job.audio;
          if (myGen !== gen) return;
          if (blob) await playBlob(blob);
          else await browserSentence(job.sentence, voice, key);
        });
      }
    },
    setVolume(v) {
      volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : volume;
      if (current) current.volume = volume;
    },
    cancel() {
      gen++;
      for (const c of controllers) c.abort();
      controllers.clear();
      const stop = stopCurrent;
      stopCurrent = null;
      stop?.();
      tail = Promise.resolve();
      if (!synth) return;
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
    },
  };

  if (opts) {
    // One health check decides whether server voices are used at all; failure keeps the browser voice.
    void (async () => {
      try {
        const res = await globalThis.fetch(`${root}/health`, { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const body = (await res.json()) as { voices?: unknown };
        voicesOn = body.voices === true;
      } catch {
        /* keep the browser voice */
      }
    })();
  }
  return speech;
}
