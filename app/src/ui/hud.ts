// Always-on heads-up display: title, clock, badge, objective, prompt hint and the button row.
import type { WorldSpec } from '../world/spec';
import { Bag, button, closeButton, el } from './dom';
import { controlsHint, formatClock, normalizeHex, promptLabel, readableOn } from './text';

const HINT_MS = 15_000;
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface HudHandlers {
  newTown?: () => void;
  talk?: () => void;
  rules?: () => void;
  why?: () => void;
  share?: () => void;
}

export interface HudView {
  show(spec: WorldSpec): void;
  hide(): void;
  setClock(hour: number, day: number): void;
  setObjective(text: string): void;
  setBadge(text: string | null): void;
  setPrompt(label: string | null): void;
  setHandlers(handlers: HudHandlers): void;
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
  mk('New town', null, 'Start over with a new town description', () => handlers.newTown);
  mk('Rules', 'R', 'Open the rules (R)', () => handlers.rules);
  mk('Why', '?', 'Why did they do that? (?)', () => handlers.why);
  mk('Share', null, 'Share this town', () => handlers.share);

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
    },
    dispose() {
      bag.dispose();
      handlers = {};
      root.style.removeProperty('--accent');
      root.style.removeProperty('--on-accent');
    },
  };
}
