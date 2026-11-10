// Sound panel: overall, voices and background levels plus a mute switch, remembered in localStorage.
import { Bag, closeButton, el, focusSoon } from './dom';

export interface SoundSettings {
  overall: number;
  voices: number;
  background: number;
  muted: boolean;
}

export const SOUND_KEY = 'townforge.sound';
export const SOUND_DEFAULTS: Readonly<SoundSettings> = { overall: 0.8, voices: 0.9, background: 0.7, muted: false };

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
    row.append(label, input, out);
    body.append(row);
  };
  slider('overall', 'Overall', 'overall');
  slider('voices', 'Voices', 'voices');
  slider('background', 'Background', 'background');

  const muteLabel = el('label', 'tf-sound-mute');
  const mute = el('input');
  mute.type = 'checkbox';
  mute.checked = state.muted;
  bag.on(mute, 'change', () => {
    state.muted = mute.checked;
    changed();
  });
  muteLabel.append(mute, el('span', undefined, 'Mute all'));
  body.append(muteLabel);

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
    dispose() {
      bag.dispose();
      open = false;
    },
  };
  return view;
}
