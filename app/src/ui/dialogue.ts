// Dialogue panel: transcript with streamed NPC text, a text input and game-injected action buttons.
import type { NpcSpec } from '../world/spec';
import { Bag, button, closeButton, el, focusSoon } from './dom';
import { parseLine } from '../npc/dialogue';
import { formatAction, splitSentencesForTypewriter } from './text';

export interface DialogueHandle {
  /** Full text so far for the NPC line being spoken; always replaces the current line (a fallback replaces a partial). */
  stream(partial: string): void;
  /** Marks the NPC line finished. */
  done(): void;
  /** Adds a button to the action row; returns a function that removes it again. */
  addAction(label: string, cb: () => void): () => void;
  clearActions(): void;
}

export interface DialogueView {
  open(npc: NpcSpec, onSend: (text: string) => void, onClose: () => void): DialogueHandle;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

interface Active {
  panel: HTMLElement;
  bag: Bag;
  onClose: () => void;
  restore: HTMLElement | null;
  closed: boolean;
}

export function createDialogue(layer: HTMLElement, root: HTMLElement): DialogueView {
  let active: Active | null = null;

  const teardown = (a: Active, notify: boolean): void => {
    if (a.closed) return;
    a.closed = true;
    a.bag.dispose();
    a.panel.remove();
    root.classList.remove('tf-has-dialogue');
    if (active === a) active = null;
    if (a.restore?.isConnected) focusSoon(a.restore);
    if (notify) a.onClose();
  };

  const open = (npc: NpcSpec, onSend: (text: string) => void, onClose: () => void): DialogueHandle => {
    if (active) teardown(active, false);

    const bag = new Bag();
    const panel = el('aside', 'tf-dialogue tf-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Conversation with ${npc.name}`);

    const head = el('header', 'tf-panel-head');
    const who = el('div', 'tf-who-block');
    who.append(el('h2', 'tf-npc-name', npc.name), el('p', 'tf-npc-role', npc.role));
    head.append(who);

    const log = el('div', 'tf-transcript');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    const actions = el('div', 'tf-actions');
    actions.hidden = true;

    const form = el('form', 'tf-say');
    const input = el('input', 'tf-say-input');
    input.type = 'text';
    input.maxLength = 280;
    input.autocomplete = 'off';
    input.placeholder = `Say something to ${npc.name}…`;
    input.setAttribute('aria-label', `Message to ${npc.name}`);
    const send = button('tf-btn tf-btn-primary', 'Send');
    send.type = 'submit';
    form.append(input, send);

    const a: Active = {
      panel,
      bag,
      onClose,
      restore: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      closed: false,
    };
    head.append(closeButton('End conversation', bag, () => teardown(a, true)));
    panel.append(head, log, actions, form);
    layer.append(panel);
    root.classList.add('tf-has-dialogue');
    active = a;

    let waiting = true; // the greeting is pending until the first done()
    send.disabled = true;
    input.disabled = true;
    const setWaiting = (on: boolean): void => {
      waiting = on;
      input.disabled = on;
      send.disabled = on;
      if (!on) focusSoon(input);
    };
    interface Line { box: HTMLElement; text: HTMLElement; actions: HTMLElement | null; value: string }
    let line: Line | null = null;
    const scroll = (): void => {
      log.scrollTop = log.scrollHeight;
    };
    const addLine = (speaker: 'player' | 'npc', text: string): Line => {
      const box = el('div', `tf-line ${speaker === 'player' ? 'tf-line-player' : 'tf-line-npc'}`);
      const body = el('p', 'tf-line-text', text);
      const actions = speaker === 'npc' ? el('div', 'tf-line-actions') : null;
      box.append(el('span', 'tf-line-who', speaker === 'player' ? 'You' : npc.name));
      if (actions) box.append(actions);
      box.append(body);
      log.append(box);
      scroll();
      return { box, text: body, actions, value: text };
    };
    /** Actions go on their own dim italic lines above the speech bubble; re-parsed on every update. */
    const render = (l: Line, typewriter: boolean): void => {
      const segs = parseLine(l.value);
      const acts = segs.filter((g) => g.kind === 'action').map((g) => formatAction(npc.name, g.text)).filter((t) => t !== '');
      const speech = segs.filter((g) => g.kind === 'speech').map((g) => g.text).join(' ');
      l.actions?.replaceChildren(...acts.map((t) => el('p', 'tf-line-action', t)));
      const parts = typewriter ? splitSentencesForTypewriter(speech) : [];
      if (parts.length > 1) {
        l.text.replaceChildren(...parts.flatMap((s, i) => [...(i > 0 ? [document.createTextNode(' ')] : []), el('span', 'tf-sentence', s)]));
      } else {
        l.text.textContent = speech;
      }
      l.text.hidden = speech === '';
    };
    const finish = (): void => {
      if (!line) return;
      if (line.value.trim() === '') {
        line.box.remove();
      } else {
        render(line, true);
        line.box.classList.remove('tf-pending');
      }
      line = null;
    };

    bag.on(form, 'submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text === '' || waiting) return;
      setWaiting(true);
      finish();
      addLine('player', text);
      line = addLine('npc', '');
      line.box.classList.add('tf-pending');
      line.text.append(el('span', 'tf-dots'));
      input.value = '';
      onSend(text);
    });

    focusSoon(input);

    return {
      stream(partial) {
        if (a.closed) return;
        if (!line) {
          line = addLine('npc', '');
          line.box.classList.add('tf-pending');
        }
        if (partial === line.value) return;
        line.value = partial;
        if (parseLine(partial).length === 0) return; // nothing readable yet: keep the dots
        render(line, false);
        line.box.classList.remove('tf-pending');
        scroll();
      },
      done() {
        if (a.closed) return;
        finish();
        setWaiting(false);
      },
      addAction(label, cb) {
        const b = button('tf-btn tf-action', label);
        const handler = (): void => cb();
        b.addEventListener('click', handler);
        actions.append(b);
        actions.hidden = false;
        let removed = false;
        const remove = (): void => {
          if (removed) return;
          removed = true;
          b.removeEventListener('click', handler);
          b.remove();
          actions.hidden = actions.childElementCount === 0;
        };
        bag.add(remove);
        return remove;
      },
      clearActions() {
        for (const b of Array.from(actions.children)) b.remove();
        actions.hidden = true;
      },
    };
  };

  return {
    open,
    close() {
      if (active) teardown(active, true);
    },
    isOpen: () => active !== null,
    dispose() {
      if (active) teardown(active, false);
    },
  };
}
