// Tiny DOM helpers shared by the UI panels. All DOM is created in code.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className: string, label: string, onClick?: () => void, bag?: Bag): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  if (onClick && bag) bag.on(b, 'click', onClick);
  return b;
}

export function closeButton(label: string, bag: Bag, onClick: () => void): HTMLButtonElement {
  const b = button('tf-close', '×', onClick, bag);
  b.setAttribute('aria-label', label);
  return b;
}

type Target = HTMLElement | Document;

/** Collects listeners and cleanups so a panel can release everything in one call. */
export class Bag {
  private cleanups: (() => void)[] = [];

  on<K extends keyof GlobalEventHandlersEventMap>(
    target: Target,
    type: K,
    handler: (ev: GlobalEventHandlersEventMap[K]) => void,
  ): void {
    const fn = handler as EventListener;
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  add(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  dispose(): void {
    for (const fn of this.cleanups.splice(0)) fn();
  }
}

export function focusSoon(node: HTMLElement): void {
  node.focus({ preventScroll: true });
}
