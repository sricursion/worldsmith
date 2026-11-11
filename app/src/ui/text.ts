// Pure text helpers for the UI. No DOM access, so they run under Node in tests.

/** "Day 1 · 7:42" from a fractional town hour and a day counter. */
export function formatClock(hour: number, day: number): string {
  const h = Number.isFinite(hour) ? hour : 0;
  const minutes = Math.floor((((h % 24) + 24) % 24) * 60 + 1e-6);
  const dayNo = Number.isFinite(day) ? Math.max(1, Math.floor(day)) : 1;
  return `Day ${dayNo} · ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Capt|Col|Sgt|Gen|Lt)\.$/;

/** Splits NPC text into sentences, keeping punctuation, without breaking after "Mr." style abbreviations. */
export function splitSentencesForTypewriter(text: string): string[] {
  const raw = text.match(/[^.!?…]+(?:[.!?…]+["')\]”]*|$)\s*/g) ?? [];
  const out: string[] = [];
  let carry = '';
  for (const piece of raw) {
    const joined = carry + piece;
    if (ABBREVIATION.test(joined.trimEnd())) {
      carry = joined;
      continue;
    }
    carry = '';
    const trimmed = joined.trim();
    if (trimmed !== '') out.push(trimmed);
  }
  const rest = carry.trim();
  if (rest !== '') out.push(rest);
  return out;
}

/** The last `maxLines` display lines of a streaming text, hard-wrapped at `width` characters. */
export function tailLines(text: string, maxLines: number, width: number): string[] {
  const src = text.length > 4000 ? text.slice(-4000) : text;
  const lines: string[] = [];
  for (const raw of src.split(/\r?\n/)) {
    if (raw === '') {
      lines.push('');
      continue;
    }
    for (let i = 0; i < raw.length; i += width) lines.push(raw.slice(i, i + width));
  }
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-maxLines);
}

/** Normalises #rgb / #rrggbb to lowercase #rrggbb, or null when it is not a hex colour. */
export function normalizeHex(value: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const hex = (m[1] ?? '').toLowerCase();
  return '#' + (hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex);
}

/** Dark or light text colour that stays readable on the given hex background. */
export function readableOn(hex: string): string {
  const n = normalizeHex(hex);
  if (!n) return '#14110a';
  const lin = (i: number): number => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  return lum > 0.35 ? '#14110a' : '#ffffff';
}

/** Human label for a rule effect type: "schedule_override" becomes "schedule override". */
export function effectLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

/** "Nell leans on the rail, grinning." from a character name and the bare action text. */
export function formatAction(name: string, action: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const body = action.trim().replace(/[\s.!?…,;:]+$/, '');
  if (body === '') return '';
  return `${first === '' ? '' : first + ' '}${body}.`;
}

export const CONTROLS_HINT_DESKTOP = 'WASD move · mouse look · Shift run · E talk · V view · -/= volume · M mute · [/] background';
export const CONTROLS_HINT_TOUCH = 'Left half: move · right half: look · tap the pill to talk';

/** Controls hint text for the given pointer type. */
export function controlsHint(coarse: boolean): string {
  return coarse ? CONTROLS_HINT_TOUCH : CONTROLS_HINT_DESKTOP;
}

/** On touch devices the key hint 'E · ' in a prompt label becomes 'Tap · '. */
export function promptLabel(label: string, coarse: boolean): string {
  return coarse && label.startsWith('E · ') ? `Tap · ${label.slice(4)}` : label;
}

/** The short key-and-action pairs shown when a world first opens. */
export function controlsParts(coarse: boolean): { key: string; label: string }[] {
  return coarse
    ? [{ key: 'Left half', label: 'move' }, { key: 'Right half', label: 'look' }, { key: 'Tap a name', label: 'talk' }]
    : [{ key: 'WASD', label: 'move' }, { key: 'Mouse', label: 'look' }, { key: 'Shift', label: 'run' }, { key: 'E', label: 'talk' }];
}

// Landing card.
export const LANDING = {
  title: 'Worldsmith',
  promise: 'Describe a place. Walk into it about half a minute later.',
  inputLabel: 'Describe a world',
  placeholder: 'A harbour town at dawn, a monastery in the snow, the first colony on Mars',
  build: 'Build world',
  keysDesktop: 'Enter builds · Shift+Enter for a new line',
  keysTouch: 'Any place, any era, in your own words',
  examples: 'Or start from one of these',
} as const;

/** Prompts offered next to whatever the game supplies, so the list covers more than four genres. */
export const EXTRA_EXAMPLES: readonly string[] = [
  'A lighthouse village on a sea cliff where the lamp went out three nights ago',
  'A night market on stilts above a flooded city, lit by paper lanterns',
  'A snowbound monastery that guards a bell nobody is allowed to ring',
];

/** Merges example prompts, dropping blanks and repeats, keeping at most `max`. */
export function mergeExamples(given: readonly string[], extra: readonly string[], max: number): string[] {
  const out: string[] = [];
  for (const raw of [...given, ...extra]) {
    const text = raw.trim();
    if (text === '' || out.some((o) => o.toLowerCase() === text.toLowerCase())) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

// Build wait. Each step turns over on a real event from the build stream, never on a timer.
export type BuildStage = 'outline' | 'look' | 'land' | 'story';
export type StepState = 'done' | 'active' | 'waiting';

export const BUILD_STEPS: readonly { id: BuildStage; label: string; detail: string }[] = [
  { id: 'outline', label: 'Outline', detail: 'the name, the premise and what stands where' },
  { id: 'look', label: 'Look', detail: 'materials, colours, sky and weather' },
  { id: 'land', label: 'Land and buildings', detail: 'raising the ground and placing every building' },
  { id: 'story', label: 'People and story', detail: 'who lives here and what they want from you' },
];

export const BUILD = {
  heading: 'Building',
  untitled: 'A world without a name yet',
  hint: 'Usually 20 to 40 seconds. You can walk in as soon as the buildings stand.',
  pending: 'The people and their story are still being written. Walk around meanwhile.',
  stepDone: 'done',
  stepActive: 'in progress',
  stepWaiting: 'waiting',
} as const;

/**
 * State of every step given the stages that have arrived. The first step that has not arrived is the
 * active one; when the land is being built everything before it in the stream counts as received.
 */
export function stepStates(arrived: ReadonlySet<BuildStage>): Record<BuildStage, StepState> {
  const out = {} as Record<BuildStage, StepState>;
  let activeSet = false;
  for (const step of BUILD_STEPS) {
    if (arrived.has(step.id)) out[step.id] = 'done';
    else if (!activeSet) {
      out[step.id] = 'active';
      activeSet = true;
    } else out[step.id] = 'waiting';
  }
  return out;
}

/** Reads a finished string field such as "title" out of a JSON text that is still being written. */
export function peekField(partial: string, field: string): string | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(partial);
  if (!m || m[1] === undefined) return null;
  try {
    const value: unknown = JSON.parse(`"${m[1]}"`);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
}

const SECTIONS: readonly [string, string][] = [
  ['title', 'the name'], ['palette', 'the colours'], ['style', 'the look'], ['site', 'the land'],
  ['buildings', 'the buildings'], ['npcs', 'the people'], ['items', 'the things people carry'],
  ['rules', 'the rules'], ['quest', 'the quest'],
];

/** Which part of the world the stream is writing right now, from the last section key it opened. */
export function writingNow(partial: string): string | null {
  let best: string | null = null;
  let at = -1;
  for (const [key, label] of SECTIONS) {
    const i = partial.lastIndexOf(`"${key}"`);
    if (i > at) {
      at = i;
      best = label;
    }
  }
  return best;
}

/** "Writing the people · 3,412 characters so far · 12 s" from real stream counters. */
export function liveLine(partial: string, seconds: number): string {
  const parts: string[] = [];
  const now = writingNow(partial);
  if (now) parts.push(`Writing ${now}`);
  if (partial.length > 0) parts.push(`${partial.length.toLocaleString('en-US')} characters so far`);
  parts.push(`${Math.max(0, Math.floor(seconds))} s`);
  return parts.join(' · ');
}

/** The one line shown when the player is given a saved world instead of the one they asked for. */
export function fallbackNotice(reason: string): string {
  const why = reason.trim().replace(/[.\s]+$/, '');
  return `${why === '' ? 'The build failed' : why}. This is a saved world, not one built from your prompt.`;
}

export const NOTICE = { retry: 'Try again', dismiss: 'Dismiss notice' } as const;
