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
