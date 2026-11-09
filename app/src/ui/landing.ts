// Landing card and the slim "compiling" bar that streams the model's partial JSON.
import { Bag, button, el, focusSoon } from './dom';
import { tailLines } from './text';

const WINDOW_LINES = 4;
const WINDOW_WIDTH = 96;
const MAX_PROMPT = 600;

export interface LandingView {
  showLanding(examples: string[], onSubmit: (prompt: string) => void): void;
  showCompiling(status: string, partial?: string): void;
  hide(): void;
  dispose(): void;
}

export function createLanding(layer: HTMLElement): LandingView {
  const bag = new Bag();

  const card = el('section', 'tf-landing tf-panel');
  card.hidden = true;
  card.setAttribute('aria-labelledby', 'tf-landing-title');
  const title = el('h1', 'tf-landing-title', 'Townforge');
  title.id = 'tf-landing-title';
  const promise = el('p', 'tf-promise', 'Describe a town. Walk in.');
  const label = el('label', 'tf-sr-only', 'Describe your town');
  const input = el('textarea', 'tf-prompt-input');
  input.id = 'tf-prompt-input';
  label.htmlFor = input.id;
  input.rows = 3;
  input.maxLength = MAX_PROMPT;
  input.placeholder = 'A sleepy frontier town where the sheriff is hiding something…';
  input.spellcheck = true;
  const row = el('div', 'tf-landing-row');
  const hint = el('span', 'tf-hint', 'Ctrl/Cmd + Enter to build');
  const count = el('span', 'tf-hint tf-count', `0/${MAX_PROMPT}`);
  const build = button('tf-btn tf-btn-primary', 'Build');
  row.append(hint, count, build);
  const chipsLabel = el('p', 'tf-chips-label', 'Or try one');
  const chips = el('div', 'tf-chips');
  card.append(title, promise, label, input, row, chipsLabel, chips);

  const bar = el('section', 'tf-compiling tf-panel');
  bar.hidden = true;
  bar.setAttribute('aria-label', 'Building your town');
  const status = el('p', 'tf-compiling-status');
  status.setAttribute('role', 'status');
  const stream = el('pre', 'tf-stream');
  stream.setAttribute('aria-hidden', 'true');
  const progress = el('div', 'tf-progress');
  progress.setAttribute('aria-hidden', 'true');
  progress.append(el('span', 'tf-progress-fill'));
  const progressHint = el('p', 'tf-hint', 'Usually 10 to 20 seconds. The town appears behind this bar.');
  bar.append(status, stream, progress, progressHint);

  layer.append(card, bar);

  let onSubmit: ((prompt: string) => void) | null = null;
  let submitted = false;

  const sync = (): void => {
    build.disabled = submitted || input.value.trim() === '';
    count.textContent = `${input.value.length}/${MAX_PROMPT}`;
  };
  const submit = (): void => {
    const text = input.value.trim();
    if (submitted || text === '' || !onSubmit) return;
    submitted = true;
    sync();
    onSubmit(text);
  };

  bag.on(input, 'input', sync);
  bag.on(input, 'keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });
  bag.on(build, 'click', submit);
  bag.add(() => {
    card.remove();
    bar.remove();
  });

  return {
    showLanding(examples, handler) {
      onSubmit = handler;
      submitted = false;
      chips.replaceChildren();
      for (const text of examples) {
        const chip = el('button', 'tf-chip', text);
        chip.type = 'button';
        chip.title = text;
        chip.addEventListener('click', () => {
          input.value = text;
          sync();
          focusSoon(input);
        });
        chips.append(chip); // removed with the chip element itself, no outside reference remains
      }
      chipsLabel.hidden = examples.length === 0;
      stream.textContent = '';
      bar.hidden = true;
      card.hidden = false;
      sync();
      focusSoon(input);
    },
    showCompiling(text, partial) {
      card.hidden = true;
      bar.hidden = false;
      status.textContent = text;
      if (partial !== undefined) {
        stream.textContent = tailLines(partial, WINDOW_LINES, WINDOW_WIDTH).join('\n');
        stream.scrollTop = stream.scrollHeight;
      }
    },
    hide() {
      card.hidden = true;
      bar.hidden = true;
    },
    dispose() {
      bag.dispose();
      onSubmit = null;
    },
  };
}
