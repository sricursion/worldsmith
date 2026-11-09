// HTML/CSS overlay over the 3D canvas. No three, no game logic: the game calls in, callbacks call out.
import type { NpcSpec, RuleSpec, WorldSpec } from '../world/spec';
import './ui.css';
import { Bag, el } from './dom';
import { createDialogue, type DialogueHandle } from './dialogue';
import { createHud, type HudHandlers } from './hud';
import { createLanding } from './landing';
import { createNotices } from './notices';
import { createRules } from './rules';
import { createWhy } from './why';

export { formatClock, splitSentencesForTypewriter } from './text';
export type { DialogueHandle } from './dialogue';
export type { HudHandlers } from './hud';

export interface UI {
  showLanding(examples: string[], onSubmit: (prompt: string) => void): void;
  showCompiling(status: string, partial?: string): void;
  showHud(spec: WorldSpec): void;
  setClock(hour: number, day: number): void;
  setObjective(text: string): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
  openDialogue(npc: NpcSpec, onSend: (text: string) => void, onClose: () => void): DialogueHandle;
  openRules(rules: RuleSpec[], onAdd: (text: string) => void | Promise<boolean>, onRemove: (id: string) => void): void;
  closeRules(): void;
  showWhy(lines: string[]): void;
  setPrompt(label: string | null): void;
  showError(text: string, retry?: () => void): void;
  /** Addition: wires the HUD buttons (New town, Rules, Why, Share) and the talk pill to the game. */
  onHud(handlers: HudHandlers): void;
  /** Addition: text for the verified badge next to the clock, or null to hide it. */
  setBadge(text: string | null): void;
  dispose(): void;
}

export function createUI(root: HTMLElement): UI {
  const bag = new Bag();
  const layer = el('div', 'tf-layer');
  root.classList.add('tf-ui');
  root.append(layer);

  const landing = createLanding(layer);
  const hud = createHud(layer, root);
  const rules = createRules(layer);
  const why = createWhy(layer);
  const dialogue = createDialogue(layer, root);
  const notices = createNotices(layer);

  // Escape closes the topmost open surface: error, dialogue, rules, then the why list.
  bag.on(document, 'keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (notices.isErrorOpen()) notices.closeError();
    else if (dialogue.isOpen()) dialogue.close();
    else if (rules.isOpen()) rules.close();
    else if (why.isOpen()) why.close();
    else return;
    e.preventDefault();
  });

  return {
    showLanding: (examples, onSubmit) => {
      hud.hide();
      dialogue.close();
      rules.close();
      why.close();
      landing.showLanding(examples, onSubmit);
    },
    showCompiling: (status, partial) => landing.showCompiling(status, partial),
    showHud: (spec) => {
      landing.hide();
      hud.show(spec);
    },
    setClock: (hour, day) => hud.setClock(hour, day),
    setObjective: (text) => hud.setObjective(text),
    toast: (text, kind) => notices.toast(text, kind),
    openDialogue: (npc, onSend, onClose) => dialogue.open(npc, onSend, onClose),
    openRules: (list, onAdd, onRemove) => rules.open(list, onAdd, onRemove),
    closeRules: () => rules.close(),
    showWhy: (lines) => why.show(lines),
    setPrompt: (label) => hud.setPrompt(label),
    showError: (text, retry) => notices.showError(text, retry),
    onHud: (handlers) => hud.setHandlers(handlers),
    setBadge: (text) => hud.setBadge(text),
    dispose() {
      bag.dispose();
      notices.dispose();
      dialogue.dispose();
      why.dispose();
      rules.dispose();
      hud.dispose();
      landing.dispose();
      layer.remove();
      root.classList.remove('tf-ui', 'tf-has-dialogue');
    },
  };
}
