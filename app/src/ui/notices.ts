// Toasts (bottom-centre) and the blocking error modal with an optional retry.
import { Bag, button, el, focusSoon } from './dom';

export interface NoticesView {
  toast(text: string, kind?: 'info' | 'warn'): void;
  showError(text: string, retry?: () => void): void;
  closeError(): void;
  isErrorOpen(): boolean;
  dispose(): void;
}

const MAX_TOASTS = 3;
const LIFETIME_MS = { info: 4500, warn: 7000 } as const;

export function createNotices(layer: HTMLElement): NoticesView {
  const toasts = el('div', 'tf-toasts');
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');
  layer.append(toasts);

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let modal: { node: HTMLElement; bag: Bag; restore: HTMLElement | null } | null = null;

  const dropToast = (node: HTMLElement): void => {
    node.remove();
  };

  const closeError = (): void => {
    if (!modal) return;
    const m = modal;
    modal = null;
    m.bag.dispose();
    m.node.remove();
    if (m.restore?.isConnected) focusSoon(m.restore);
  };

  return {
    toast(text, kind = 'info') {
      const node = el('div', `tf-toast tf-toast-${kind}`, text);
      toasts.append(node);
      while (toasts.childElementCount > MAX_TOASTS) toasts.firstElementChild?.remove();
      const timer = setTimeout(() => {
        timers.delete(timer);
        dropToast(node);
      }, LIFETIME_MS[kind]);
      timers.add(timer);
      node.addEventListener('click', () => dropToast(node), { once: true });
    },

    showError(text, retry) {
      closeError();
      const bag = new Bag();
      const node = el('div', 'tf-modal');
      const card = el('div', 'tf-modal-card tf-panel');
      card.setAttribute('role', 'alertdialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-labelledby', 'tf-error-title');
      card.setAttribute('aria-describedby', 'tf-error-text');
      const title = el('h2', 'tf-panel-title', 'Something went wrong');
      title.id = 'tf-error-title';
      const body = el('p', 'tf-error-text', text);
      body.id = 'tf-error-text';
      const row = el('div', 'tf-modal-actions');
      const dismiss = button('tf-btn', retry ? 'Dismiss' : 'Close', closeError, bag);
      if (retry) {
        const again = button('tf-btn tf-btn-primary', 'Try again', () => {
          closeError();
          retry();
        }, bag);
        row.append(dismiss, again);
      } else {
        row.append(dismiss);
      }
      card.append(title, body, row);
      node.append(card);
      layer.append(node);
      // Keep Tab inside the modal while it is open.
      bag.on(card, 'keydown', (e) => {
        if (e.key !== 'Tab') return;
        const items = Array.from(row.querySelectorAll<HTMLButtonElement>('button'));
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });
      modal = { node, bag, restore: document.activeElement instanceof HTMLElement ? document.activeElement : null };
      focusSoon(row.lastElementChild instanceof HTMLElement ? row.lastElementChild : dismiss);
    },

    closeError,
    isErrorOpen: () => modal !== null,

    dispose() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      closeError();
      toasts.remove();
    },
  };
}
