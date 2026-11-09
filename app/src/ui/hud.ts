// Always-on heads-up display: title, clock, badge, objective, prompt hint and the button row.
import type { WorldSpec } from '../world/spec';
import { Bag, button, el } from './dom';
import { formatClock, normalizeHex, readableOn } from './text';

export interface HudHandlers {
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

  const prompt = el('div', 'tf-prompt');
  prompt.hidden = true;
  prompt.setAttribute('role', 'status');

  const buttons = el('div', 'tf-hud-buttons');
  const mk = (text: string, key: string | null, aria: string, pick: () => (() => void) | undefined): void => {
    const b = button('tf-btn', text);
    if (key) b.append(' ', el('kbd', 'tf-kbd', key));
    b.setAttribute('aria-label', aria);
    bag.on(b, 'click', () => pick()?.());
    buttons.append(b);
  };
  mk('Rules', 'R', 'Open the rules (R)', () => handlers.rules);
  mk('Why', '?', 'Why did they do that? (?)', () => handlers.why);
  mk('Share', null, 'Share this town', () => handlers.share);

  bottom.append(objective, prompt, buttons);
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
    },
    hide() {
      hud.hidden = true;
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
      prompt.textContent = label ?? '';
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
