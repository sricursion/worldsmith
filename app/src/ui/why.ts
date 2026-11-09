// "Why did they do that?" overlay: the last log lines in a dismissible, toast-like list.
import { Bag, closeButton, el } from './dom';

export interface WhyView {
  show(lines: string[]): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

const MAX_LINES = 12;

export function createWhy(layer: HTMLElement): WhyView {
  const bag = new Bag();
  const panel = el('aside', 'tf-why tf-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Why did they do that?');
  const head = el('header', 'tf-panel-head');
  head.append(el('h2', 'tf-panel-title', 'Why did they do that?'));
  const list = el('ol', 'tf-why-list');
  let open = false;

  const hide = (): void => {
    panel.hidden = true;
    open = false;
  };
  head.append(closeButton('Dismiss', bag, hide));
  panel.append(head, list);
  layer.append(panel);
  bag.add(() => panel.remove());

  return {
    show(lines) {
      list.replaceChildren();
      const recent = lines.slice(-MAX_LINES);
      if (recent.length === 0) list.append(el('li', 'tf-why-empty', 'Nothing to explain yet. Watch the town for a while.'));
      for (const line of recent) list.append(el('li', 'tf-why-line', line));
      panel.hidden = false;
      open = true;
      list.scrollTop = list.scrollHeight;
    },
    close: hide,
    isOpen: () => open,
    dispose() {
      bag.dispose();
      open = false;
    },
  };
}
