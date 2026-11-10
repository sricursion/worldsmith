// Text-to-speech for NPC lines. A thin queue over SpeechSynthesis; every call is a no-op where the
// API is missing and none of them can throw.
import { hash32 } from '../world/rng';
import type { NpcSpec } from '../world/spec';
import { speechOf } from './dialogue';

export interface Speech {
  /** `key` (normally the NPC name) picks a stable voice; without it the pitch/rate pair is used. */
  speak(text: string, voice: NpcSpec['voice'], key?: string): void;
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

export function createSpeech(): Speech {
  const synth = getSynth();
  let volume = 1;
  const speech: Speech = {
    enabled: synth !== null,
    speak(text, voice, key) {
      if (!speech.enabled || !synth) return;
      try {
        const voices = synth.getVoices();
        const chosen = pickVoice(voices, key ?? `${voice.pitch}|${voice.rate}`);
        for (const sentence of splitSentences(text)) {
          const u = new SpeechSynthesisUtterance(sentence);
          u.pitch = clamp(voice.pitch, 0.5, 2);
          u.rate = clamp(voice.rate, 0.5, 2);
          u.volume = volume;
          if (chosen) {
            u.voice = chosen;
            u.lang = chosen.lang;
          }
          synth.speak(u);
        }
      } catch {
        /* speech is a nicety; ignore platform errors */
      }
    },
    setVolume(v) {
      volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : volume;
    },
    cancel() {
      if (!synth) return;
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
    },
  };
  return speech;
}
