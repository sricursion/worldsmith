// Sound panel: overall, voices and background levels plus a mute switch, remembered in localStorage.
import { Bag, closeButton, el, focusSoon } from './dom';

export interface SoundSettings {
  overall: number;
  voices: number;
  background: number;
  muted: boolean;
}

export const SOUND_KEY = 'worldsmith.sound.v2';
export const SOUND_DEFAULTS: Readonly<SoundSettings> = { overall: 0.8, voices: 0.9, background: 0.35, muted: false };

/** Deltas in 0..1 units (0.1 is one keyboard step); toggleMute flips the mute switch. */
export interface SoundChange { overall?: number; background?: number; voices?: number; toggleMute?: boolean }

const roundLevel = (v: number): number => Math.round(v * 100) / 100;

/** Applies a change to a copy of the settings, clamping every level to 0..1. */
export function applySoundChange(s: SoundSettings, change: SoundChange): SoundSettings {
  const out = { ...s };
  for (const k of ['overall', 'voices', 'background'] as const) {
    const d = change[k];
    if (typeof d === 'number' && Number.isFinite(d)) out[k] = level(roundLevel(out[k] + d), out[k]);
  }
  if (change.toggleMute === true) out.muted = !out.muted;
  return out;
}

export type SoundStorage = Pick<Storage, 'getItem' | 'setItem'>;

function level(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function defaultStorage(): SoundStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSound(storage: SoundStorage | null = defaultStorage()): SoundSettings {
  const out: SoundSettings = { ...SOUND_DEFAULTS };
  if (!storage) return out;
  try {
    const raw = storage.getItem(SOUND_KEY);
    if (raw === null) return out;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return out;
    const d = data as Record<string, unknown>;
    out.overall = level(d['overall'], out.overall);
    out.voices = level(d['voices'], out.voices);
    out.background = level(d['background'], out.background);
    out.muted = d['muted'] === true;
  } catch {
    return { ...SOUND_DEFAULTS };
  }
  return out;
}

export function saveSound(s: SoundSettings, storage: SoundStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SOUND_KEY, JSON.stringify(s));
  } catch {
    // storage may be full or blocked; the levels still apply for this visit
  }
}

export interface SoundView {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  get(): SoundSettings;
  adjust(change: SoundChange): SoundSettings;
  dispose(): void;
}

export function createSound(layer: HTMLElement, notify: (s: SoundSettings) => void, storage: SoundStorage | null = defaultStorage()): SoundView {
  const bag = new Bag();
  const state = loadSound(storage);
  let open = false;

  const panel = el('aside', 'tf-sound tf-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Sound');
  const head = el('header', 'tf-panel-head');
  head.append(el('h2', 'tf-panel-title', 'Sound'));
  const hide = (): void => {
    panel.hidden = true;
    open = false;
  };
  head.append(closeButton('Close sound settings', bag, hide));
  const body = el('div', 'tf-sound-body');

  const changed = (): void => {
    saveSound(state, storage);
    notify({ ...state });
  };

  const syncs: (() => void)[] = [];
  const slider = (id: string, text: string, key: 'overall' | 'voices' | 'background'): void => {
    const row = el('div', 'tf-sound-row');
    const label = el('label', 'tf-sound-label', text);
    const input = el('input', 'tf-slider');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.id = `tf-sound-${id}`;
    label.htmlFor = input.id;
    input.value = String(Math.round(state[key] * 100));
    const out = el('output', 'tf-sound-value', input.value);
    out.htmlFor = input.id;
    bag.on(input, 'input', () => {
      state[key] = level(Number(input.value) / 100, state[key]);
      out.textContent = String(Math.round(state[key] * 100));
      changed();
    });
    syncs.push(() => {
      input.value = String(Math.round(state[key] * 100));
      out.textContent = input.value;
    });
    row.append(label, input, out);
    body.append(row);
  };
  slider('overall', 'Overall', 'overall');
  slider('voices', 'Voices', 'voices');
  slider('background', 'Background', 'background');

  let syncMute = (): void => undefined;
  const muteLabel = el('label', 'tf-sound-mute');
  const mute = el('input');
  mute.type = 'checkbox';
  mute.checked = state.muted;
  bag.on(mute, 'change', () => {
    state.muted = mute.checked;
    changed();
  });
  syncMute = (): void => {
    mute.checked = state.muted;
  };
  muteLabel.append(mute, el('span', undefined, 'Mute all'));
  body.append(muteLabel);
  body.append(el('p', 'tf-sound-keys', '- / = volume · [ / ] background · M mute'));

  panel.append(head, body);
  layer.append(panel);
  bag.add(() => panel.remove());

  const view: SoundView = {
    open() {
      if (open) return;
      panel.hidden = false;
      open = true;
      focusSoon(panel.querySelector<HTMLElement>('input') ?? panel);
    },
    close: hide,
    toggle() {
      if (open) hide();
      else view.open();
    },
    isOpen: () => open,
    get: () => ({ ...state }),
    adjust(change) {
      Object.assign(state, applySoundChange(state, change));
      for (const sync of syncs) sync();
      syncMute();
      changed();
      return { ...state };
    },
    dispose() {
      bag.dispose();
      open = false;
    },
  };
  return view;
}
