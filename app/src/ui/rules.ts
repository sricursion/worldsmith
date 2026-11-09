// Rules panel: current rules with type tags, remove buttons on player rules, and a plain-language add box.
import type { RuleSpec } from '../world/spec';
import { Bag, button, closeButton, el, focusSoon } from './dom';
import { effectLabel } from './text';

export interface RulesView {
  open(rules: RuleSpec[], onAdd: (text: string) => void | Promise<boolean>, onRemove: (id: string) => void): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createRules(layer: HTMLElement): RulesView {
  const bag = new Bag();
  const panel = el('aside', 'tf-rules tf-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Town rules');

  const head = el('header', 'tf-panel-head');
  head.append(el('h2', 'tf-panel-title', 'Rules of the town'));
  const list = el('ul', 'tf-rule-list');
  const form = el('form', 'tf-rule-form');
  const label = el('label', 'tf-label', 'Add a rule in plain language');
  const input = el('textarea', 'tf-rule-input');
  input.id = 'tf-rule-input';
  label.htmlFor = input.id;
  input.rows = 2;
  input.maxLength = 280;
  input.placeholder = 'Nobody may carry a gun after dark';
  const apply = button('tf-btn tf-btn-primary', 'Apply');
  apply.type = 'submit';
  form.append(label, input, apply);

  let onAdd: (text: string) => void | Promise<boolean> = () => undefined;
  let onRemove: (id: string) => void = () => undefined;
  let open = false;

  const hide = (): void => {
    panel.hidden = true;
    open = false;
  };
  head.append(closeButton('Close rules', bag, hide));
  panel.append(head, list, form);
  layer.append(panel);

  let pending = false;
  const setPending = (on: boolean): void => {
    pending = on;
    apply.disabled = on;
    input.disabled = on;
    apply.textContent = on ? 'Interpreting…' : 'Apply';
  };
  const submit = (): void => {
    const text = input.value.trim();
    if (text === '' || pending) return;
    const result = onAdd(text);
    if (result === undefined) {
      input.value = '';
      return;
    }
    setPending(true);
    void Promise.resolve(result).then(
      (ok) => {
        if (ok === true) input.value = '';
        setPending(false);
        if (open) focusSoon(input);
      },
      () => {
        setPending(false);
        if (open) focusSoon(input);
      },
    );
  };
  bag.on(form, 'submit', (e) => {
    e.preventDefault();
    submit();
  });
  bag.on(input, 'keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });
  // One delegated listener covers every remove button, so re-rendering never leaks handlers.
  bag.on(list, 'click', (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button[data-rule-id]') : null;
    const id = target?.dataset['ruleId'];
    if (id) onRemove(id);
  });
  bag.add(() => panel.remove());

  const render = (rules: RuleSpec[]): void => {
    list.replaceChildren();
    if (rules.length === 0) {
      list.append(el('li', 'tf-rule-empty', 'No rules yet. Write one below.'));
      return;
    }
    for (const rule of rules) {
      const item = el('li', `tf-rule tf-rule-${rule.source}`);
      const text = el('p', 'tf-rule-text', rule.text);
      const meta = el('div', 'tf-rule-meta');
      meta.append(el('span', 'tf-tag', effectLabel(rule.effect.type)));
      if (rule.source === 'player') {
        const remove = button('tf-btn tf-btn-small', 'Remove');
        remove.dataset['ruleId'] = rule.id;
        remove.setAttribute('aria-label', `Remove rule: ${rule.text}`);
        meta.append(remove);
      }
      item.append(text, meta);
      list.append(item);
    }
  };

  return {
    open(rules, add, remove) {
      onAdd = add;
      onRemove = remove;
      render(rules);
      if (!open) {
        panel.hidden = false;
        open = true;
        focusSoon(input);
      }
    },
    close: hide,
    isOpen: () => open,
    dispose() {
      bag.dispose();
      onAdd = () => undefined;
      onRemove = () => undefined;
      open = false;
    },
  };
}
