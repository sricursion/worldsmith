// Always-on heads-up display: title, clock, badge, objective, prompt hint and the button row.
import type { WorldSpec } from '../world/spec';
import { Bag, button, closeButton, el } from './dom';
import { createSound, type SoundSettings } from './sound';
import { controlsHint, formatClock, normalizeHex, promptLabel, readableOn } from './text';

const HINT_MS = 15_000;
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface HudHandlers {
  newTown?: () => void;
  talk?: () => void;
  rules?: () => void;
  why?: () => void;
  share?: () => void;
  sound?: (s: SoundSettings) => void;
}

export interface HudView {
  show(spec: WorldSpec): void;
  hide(): void;
  setClock(hour: number, day: number): void;
  setObjective(text: string): void;
  setBadge(text: string | null): void;
  setPrompt(label: string | null): void;
  setHandlers(handlers: HudHandlers): void;
  getSound(): SoundSettings;
  isSoundOpen(): boolean;
  closeSound(): void;
  dispose(): void;
}

export function createHud(layer: HTMLElement, root: HTMLElement): HudView {
  const bag = new Bag();
  let handlers: HudHandlers = {};
  const coarse = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const hud = el('div', 'tf-hud');
  hud.hidden = true;

  const titleBox = el('div', 'tf-hud-title tf-panel');
  const title = el('h1', 'tf-hud-name');
  const tagline = el('p', 'tf-hud-tagline');
  titleBox.append(title, tagline);

  const topRight = el('div', 'tf-hud-clock tf-panel');
  const clock = el('span', 'tf-clock', formatClock(0, 1));
  const badge = el('span', 'tf-badge');
  badge.hidden = true;
  topRight.append(clock, badge);

  const bottom = el('div', 'tf-hud-bottom');
  const objective = el('div', 'tf-objective tf-panel');
  objective.hidden = true;
  const objectiveText = el('span', 'tf-objective-text');
  objective.append(el('span', 'tf-label', 'Objective'), objectiveText);

  const hint = el('p', 'tf-controls-hint tf-panel');
  hint.hidden = true;
  const hideHint = (): void => {
    hint.hidden = true;
    if (hintTimer !== undefined) clearTimeout(hintTimer);
    hintTimer = undefined;
  };
  const dismiss = closeButton('Dismiss controls hint', bag, hideHint);
  const hintText = el('span', 'tf-controls-text');
  hint.append(hintText, dismiss);
  bag.on(document, 'keydown', (e) => {
    if (!hint.hidden && MOVE_KEYS.has(e.code)) hideHint();
  });
  bag.add(hideHint);

  const prompt = button('tf-prompt', '');
  prompt.hidden = true;
  bag.on(prompt, 'click', () => handlers.talk?.());

  const buttons = el('div', 'tf-hud-buttons');
  const mk = (text: string, key: string | null, aria: string, pick: () => (() => void) | undefined): void => {
    const b = button('tf-btn', text);
    if (key) b.append(' ', el('kbd', 'tf-kbd', key));
    b.setAttribute('aria-label', aria);
    bag.on(b, 'click', () => pick()?.());
    buttons.append(b);
  };
  mk('New world', null, 'Start over with a new world description', () => handlers.newTown);
  mk('Rules', 'R', 'Open the rules (R)', () => handlers.rules);
  mk('Why', '?', 'Why did they do that? (?)', () => handlers.why);
  mk('Share', null, 'Share this town', () => handlers.share);

  const soundBtn = button('tf-btn tf-btn-sound', '');
  const svgNs = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(svgNs, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) icon.setAttribute(k, v);
  const shape = (tag: string, attr: Record<string, string>): void => {
    const n = document.createElementNS(svgNs, tag);
    for (const [k, v] of Object.entries(attr)) n.setAttribute(k, v);
    icon.append(n);
  };
  shape('polygon', { points: '3 9 8 9 13 5 13 19 8 15 3 15' });
  shape('path', { d: 'M16.5 9a4 4 0 0 1 0 6' });
  shape('path', { d: 'M19 6.5a8 8 0 0 1 0 11' });
  soundBtn.append(icon, ' Sound');
  soundBtn.setAttribute('aria-label', 'Sound settings');
  buttons.append(soundBtn);

  const sound = createSound(layer, (s) => handlers.sound?.(s));
  bag.on(soundBtn, 'click', () => sound.toggle());
  bag.add(() => sound.dispose());

  bottom.append(hint, objective, prompt, buttons);
  hud.append(titleBox, topRight, bottom);
  layer.append(hud);
  bag.add(() => hud.remove());

  return {
    show(spec) {
      title.textContent = spec.title;
      tagline.textContent = spec.tagline;
      tagline.hidden = spec.tagline === '';
      const accent = normalizeHex(spec.palette.accent);
      if (accent) {
        root.style.setProperty('--accent', accent);
        root.style.setProperty('--on-accent', readableOn(accent));
      }
      hud.hidden = false;
      hintText.textContent = controlsHint(coarse());
      hint.hidden = false;
      if (hintTimer !== undefined) clearTimeout(hintTimer);
      hintTimer = setTimeout(hideHint, HINT_MS);
    },
    hide() {
      hud.hidden = true;
      hideHint();
      sound.close();
    },
    setClock(hour, day) {
      const text = formatClock(hour, day);
      if (clock.textContent !== text) clock.textContent = text;
    },
    setObjective(text) {
      objectiveText.textContent = text;
      objective.hidden = text.trim() === '';
    },
    setBadge(text) {
      badge.hidden = text === null || text === '';
      badge.textContent = text === null || text === '' ? '' : `✓ ${text}`;
    },
    setPrompt(label) {
      prompt.hidden = label === null || label === '';
      prompt.textContent = label === null ? '' : promptLabel(label, coarse());
    },
    setHandlers(next) {
      handlers = next;
      next.sound?.(sound.get());
    },
    getSound: () => sound.get(),
    isSoundOpen: () => sound.isOpen(),
    closeSound: () => sound.close(),
    dispose() {
      bag.dispose();
      handlers = {};
      root.style.removeProperty('--accent');
      root.style.removeProperty('--on-accent');
    },
  };
}
