import { describe, expect, it } from 'vitest';
import { SOUND_DEFAULTS, SOUND_KEY, loadSound, saveSound, type SoundSettings, type SoundStorage } from '../../app/src/ui/sound';

class FakeStorage implements SoundStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
}

const throwing: SoundStorage = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};

describe('sound settings storage', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(loadSound(new FakeStorage())).toEqual({ overall: 0.8, voices: 0.9, background: 0.7, muted: false });
    expect(loadSound(null)).toEqual(SOUND_DEFAULTS);
  });

  it('round-trips through storage under townforge.sound', () => {
    const store = new FakeStorage();
    const s: SoundSettings = { overall: 0.25, voices: 1, background: 0, muted: true };
    saveSound(s, store);
    expect(SOUND_KEY).toBe('townforge.sound');
    expect(store.data.has('townforge.sound')).toBe(true);
    expect(loadSound(store)).toEqual(s);
  });

  it('falls back per field on bad data and clamps to 0..1', () => {
    const store = new FakeStorage();
    store.data.set(SOUND_KEY, JSON.stringify({ overall: 4, voices: 'loud', background: -1, muted: 'yes' }));
    expect(loadSound(store)).toEqual({ overall: 1, voices: 0.9, background: 0, muted: false });
    store.data.set(SOUND_KEY, '{not json');
    expect(loadSound(store)).toEqual(SOUND_DEFAULTS);
    store.data.set(SOUND_KEY, 'null');
    expect(loadSound(store)).toEqual(SOUND_DEFAULTS);
  });

  it('never throws when storage does', () => {
    expect(loadSound(throwing)).toEqual(SOUND_DEFAULTS);
    expect(() => saveSound(SOUND_DEFAULTS, throwing)).not.toThrow();
  });
});
