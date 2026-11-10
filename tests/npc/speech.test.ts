import { afterEach, describe, expect, it } from 'vitest';
import { createSpeech, pickVoice, splitSentences } from '../../app/src/npc/speech';

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g['window'];
  delete g['SpeechSynthesisUtterance'];
});

describe('splitSentences', () => {
  it('splits on sentence ends and drops stage directions', () => {
    expect(splitSentences('Howdy there. *tips hat* How are you? Fine!')).toEqual(['Howdy there.', 'How are you?', 'Fine!']);
  });
  it('handles text without punctuation and empty input', () => {
    expect(splitSentences('no end here')).toEqual(['no end here']);
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('createSpeech', () => {
  it('is disabled and silent where speechSynthesis is missing', () => {
    const s = createSpeech();
    expect(s.enabled).toBe(false);
    expect(() => {
      s.speak('Hello.', { pitch: 1, rate: 1 });
      s.cancel();
    }).not.toThrow();
  });

  it('queues one utterance per sentence with clamped pitch and rate and a stable voice', () => {
    const spoken: { text: string; pitch: number; rate: number; voice: unknown }[] = [];
    let cancelled = 0;
    const voices = [
      { name: 'A', lang: 'en-US' }, { name: 'B', lang: 'fr-FR' }, { name: 'C', lang: 'en-GB' },
    ];
    g['SpeechSynthesisUtterance'] = class {
      pitch = 1;
      rate = 1;
      voice: unknown = null;
      lang = '';
      constructor(public text: string) {}
    };
    g['window'] = {
      speechSynthesis: {
        getVoices: () => voices,
        speak: (u: { text: string; pitch: number; rate: number; voice: unknown }) => spoken.push(u),
        cancel: () => {
          cancelled++;
        },
      },
    };
    const s = createSpeech();
    expect(s.enabled).toBe(true);
    s.speak('One. Two!', { pitch: 5, rate: 0.1 }, 'Cole');
    s.speak('Three.', { pitch: 1, rate: 1 }, 'Cole');
    expect(spoken.map((u) => u.text)).toEqual(['One.', 'Two!', 'Three.']);
    expect(spoken[0]?.pitch).toBe(2);
    expect(spoken[0]?.rate).toBe(0.5);
    expect(spoken[0]?.voice).toBe(spoken[2]?.voice);
    expect((spoken[0]?.voice as { lang: string }).lang.startsWith('en')).toBe(true);
    s.cancel();
    expect(cancelled).toBe(1);
  });

  it('applies the set volume to every utterance and nothing else', () => {
    const spoken: { volume: number; pitch: number; rate: number }[] = [];
    g['SpeechSynthesisUtterance'] = class {
      pitch = 1;
      rate = 1;
      volume = 1;
      constructor(public text: string) {}
    };
    g['window'] = {
      speechSynthesis: {
        getVoices: () => [],
        speak: (u: { volume: number; pitch: number; rate: number }) => spoken.push(u),
        cancel: () => undefined,
      },
    };
    const s = createSpeech();
    s.speak('One.', { pitch: 1.2, rate: 0.9 });
    s.setVolume(0.35);
    s.speak('Two. Three.', { pitch: 1.2, rate: 0.9 });
    s.setVolume(0);
    s.speak('Four.', { pitch: 1.2, rate: 0.9 });
    s.setVolume(7);
    s.speak('Five.', { pitch: 1.2, rate: 0.9 });
    s.setVolume(Number.NaN);
    s.speak('Six.', { pitch: 1.2, rate: 0.9 });
    expect(spoken.map((u) => u.volume)).toEqual([1, 0.35, 0.35, 0, 1, 1]);
    expect(spoken.every((u) => u.pitch === 1.2 && u.rate === 0.9)).toBe(true);
  });

  it('never throws when the platform does', () => {
    g['SpeechSynthesisUtterance'] = class {};
    g['window'] = {
      speechSynthesis: {
        getVoices: () => {
          throw new Error('boom');
        },
        speak: () => {
          throw new Error('boom');
        },
        cancel: () => {
          throw new Error('boom');
        },
      },
    };
    const s = createSpeech();
    expect(() => {
      s.speak('Hi.', { pitch: 1, rate: 1 });
      s.cancel();
    }).not.toThrow();
  });
});

describe('pickVoice', () => {
  const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
  it('is deterministic per key and prefers English voices', () => {
    const voices = [v('a', 'de-DE'), v('b', 'en-US'), v('c', 'en-GB'), v('d', 'en-AU')];
    for (const k of ['Cole', 'Mae', 'Zeb']) {
      expect(pickVoice(voices, k)).toBe(pickVoice(voices, k));
      expect(pickVoice(voices, k)?.lang.startsWith('en')).toBe(true);
    }
    expect(pickVoice([], 'x')).toBeNull();
    expect(pickVoice([v('a', 'de-DE')], 'x')?.name).toBe('a');
  });
});
