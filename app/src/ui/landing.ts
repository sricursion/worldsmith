// Landing card and the build panel that follows the build stream step by step.
import { Bag, button, el, focusSoon } from './dom';
import {
  BUILD, BUILD_STEPS, EXTRA_EXAMPLES, LANDING, liveLine, mergeExamples, peekField, stepStates,
  type BuildStage,
} from './text';

const MAX_PROMPT = 600;
const MAX_EXAMPLES = 6;

export interface BuildInfo {
  title?: string | undefined;
  line?: string | undefined;
}

export interface LandingView {
  showLanding(examples: string[], onSubmit: (prompt: string) => void): void;
  /** Plain status with no steps, or (during a build) fresh stream text for the live line. */
  showCompiling(status: string, partial?: string): void;
  /** Opens the build panel for a prompt with every step still ahead. */
  startBuild(prompt: string): void;
  /** Marks a stage as arrived; the name and story line are shown as soon as they are known. */
  buildStage(stage: BuildStage, info?: BuildInfo): void;
  hide(): void;
  dispose(): void;
}

/** Pulls a name and a story line out of an outline of unknown shape. */
export function outlineInfo(outline: unknown): BuildInfo {
  if (typeof outline !== 'object' || outline === null) return {};
  const o = outline as Record<string, unknown>;
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  return { title: text(o['title']), line: text(o['tagline']) };
}

export function createLanding(layer: HTMLElement): LandingView {
  const bag = new Bag();
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  const card = el('section', 'tf-landing tf-panel');
  card.hidden = true;
  card.setAttribute('aria-labelledby', 'tf-landing-title');
  const title = el('h1', 'tf-landing-title', LANDING.title);
  title.id = 'tf-landing-title';
  const promise = el('p', 'tf-promise', LANDING.promise);
  const label = el('label', 'tf-sr-only', LANDING.inputLabel);
  const input = el('textarea', 'tf-prompt-input');
  input.id = 'tf-prompt-input';
  label.htmlFor = input.id;
  input.rows = 3;
  input.maxLength = MAX_PROMPT;
  input.placeholder = LANDING.placeholder;
  input.spellcheck = true;
  input.setAttribute('enterkeyhint', 'go');
  const row = el('div', 'tf-landing-row');
  const hint = el('span', 'tf-hint', coarse ? LANDING.keysTouch : LANDING.keysDesktop);
  const count = el('span', 'tf-hint tf-count');
  count.hidden = true;
  const build = button('tf-btn tf-btn-primary tf-btn-build', LANDING.build);
  row.append(hint, count, build);
  const chipsLabel = el('p', 'tf-chips-label', LANDING.examples);
  const chips = el('div', 'tf-chips');
  card.append(title, promise, label, input, row, chipsLabel, chips);

  const panel = el('section', 'tf-build tf-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', BUILD.heading);
  const kicker = el('p', 'tf-label', BUILD.heading);
  const name = el('h2', 'tf-build-name');
  const story = el('p', 'tf-build-story');
  const steps = el('ol', 'tf-steps');
  const stepNodes = new Map<BuildStage, { item: HTMLElement; state: HTMLElement }>();
  for (const step of BUILD_STEPS) {
    const item = el('li', 'tf-step');
    const mark = el('span', 'tf-step-mark');
    mark.setAttribute('aria-hidden', 'true');
    const body = el('span', 'tf-step-body');
    body.append(el('span', 'tf-step-label', step.label), el('span', 'tf-step-detail', step.detail));
    const state = el('span', 'tf-sr-only');
    item.append(mark, body, state);
    steps.append(item);
    stepNodes.set(step.id, { item, state });
  }
  const live = el('p', 'tf-build-live');
  live.setAttribute('role', 'status');
  const buildHint = el('p', 'tf-hint', BUILD.hint);
  panel.append(kicker, name, story, steps, live, buildHint);

  layer.append(card, panel);

  let onSubmit: ((prompt: string) => void) | null = null;
  let submitted = false;
  // Build panel state. `building` is false for a plain status such as opening a shared link.
  let building = false;
  let arrived = new Set<BuildStage>();
  let named = false;
  let storied = false;
  let partialText = '';
  let startedAt = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const stopTicker = (): void => {
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
  };
  const renderLive = (): void => {
    live.textContent = liveLine(partialText, (Date.now() - startedAt) / 1000);
  };
  const renderSteps = (): void => {
    const states = stepStates(arrived);
    for (const step of BUILD_STEPS) {
      const node = stepNodes.get(step.id);
      if (!node) continue;
      const s = states[step.id];
      node.item.dataset['state'] = s;
      node.state.textContent = s === 'done' ? BUILD.stepDone : s === 'active' ? BUILD.stepActive : BUILD.stepWaiting;
    }
  };
  const setName = (text: string | undefined): void => {
    if (!text || named) return;
    named = true;
    name.textContent = text;
    name.classList.remove('tf-build-name-pending');
  };
  const setStory = (text: string | undefined): void => {
    if (!text || storied) return;
    storied = true;
    story.textContent = text;
    story.classList.remove('tf-build-story-prompt');
  };

  const sync = (): void => {
    build.disabled = submitted || input.value.trim() === '';
    // The counter only matters near the limit; before that it is noise.
    count.hidden = input.value.length < MAX_PROMPT * 0.8;
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
    // Enter builds; Shift+Enter keeps its usual meaning. Enter while composing (IME) is left alone.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    submit();
  });
  bag.on(build, 'click', submit);
  bag.add(() => {
    stopTicker();
    card.remove();
    panel.remove();
  });

  return {
    showLanding(examples, handler) {
      onSubmit = handler;
      submitted = false;
      building = false;
      stopTicker();
      chips.replaceChildren();
      const list = mergeExamples(examples, EXTRA_EXAMPLES, MAX_EXAMPLES);
      for (const text of list) {
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
      chipsLabel.hidden = list.length === 0;
      panel.hidden = true;
      card.hidden = false;
      sync();
      focusSoon(input);
    },
    startBuild(prompt) {
      building = true;
      arrived = new Set();
      named = false;
      storied = false;
      partialText = '';
      startedAt = Date.now();
      kicker.textContent = BUILD.heading;
      name.textContent = BUILD.untitled;
      name.classList.add('tf-build-name-pending');
      story.textContent = prompt;
      story.classList.add('tf-build-story-prompt');
      story.hidden = false;
      steps.hidden = false;
      buildHint.hidden = false;
      renderSteps();
      renderLive();
      stopTicker();
      ticker = setInterval(renderLive, 1000);
      card.hidden = true;
      panel.hidden = false;
    },
    buildStage(stage, info) {
      if (!building) return;
      // Stages arrive in stream order, so everything before this one has been received too. The land
      // is built by the browser: when it starts without an early preview, the story is already in hand.
      if (stage === 'land') for (const id of ['outline', 'look', 'story'] as const) arrived.add(id);
      else {
        for (const step of BUILD_STEPS) {
          arrived.add(step.id);
          if (step.id === stage) break;
        }
      }
      setName(info?.title);
      setStory(info?.line);
      renderSteps();
    },
    showCompiling(text, partial) {
      if (building) {
        if (partial !== undefined) {
          partialText = partial;
          if (!named) setName(peekField(partial, 'title') ?? undefined);
          if (!storied) setStory(peekField(partial, 'tagline') ?? undefined);
          renderLive();
        }
        card.hidden = true;
        panel.hidden = false;
        return;
      }
      stopTicker();
      kicker.textContent = LANDING.title;
      name.textContent = text;
      name.classList.remove('tf-build-name-pending');
      story.hidden = true;
      steps.hidden = true;
      buildHint.hidden = true;
      live.textContent = '';
      card.hidden = true;
      panel.hidden = false;
    },
    hide() {
      building = false;
      stopTicker();
      card.hidden = true;
      panel.hidden = true;
    },
    dispose() {
      bag.dispose();
      onSubmit = null;
    },
  };
}
