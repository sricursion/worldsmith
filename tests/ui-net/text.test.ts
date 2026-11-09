import { describe, expect, it } from 'vitest';
import { effectLabel, formatClock, normalizeHex, readableOn, splitSentencesForTypewriter, tailLines } from '../../app/src/ui/text';

describe('formatClock', () => {
  it('formats fractional hours', () => {
    expect(formatClock(7.7, 1)).toBe('Day 1 · 7:42');
    expect(formatClock(0, 3)).toBe('Day 3 · 0:00');
    expect(formatClock(23.999, 2)).toBe('Day 2 · 23:59');
  });
  it('wraps and sanitises odd input', () => {
    expect(formatClock(24, 1)).toBe('Day 1 · 0:00');
    expect(formatClock(-1, 1)).toBe('Day 1 · 23:00');
    expect(formatClock(Number.NaN, Number.NaN)).toBe('Day 1 · 0:00');
    expect(formatClock(9.05, 0)).toBe('Day 1 · 9:03');
  });
});

describe('splitSentencesForTypewriter', () => {
  it('splits on terminal punctuation and keeps it', () => {
    expect(splitSentencesForTypewriter('Howdy. You new here? Watch yourself!')).toEqual(['Howdy.', 'You new here?', 'Watch yourself!']);
  });
  it('keeps trailing text without punctuation and handles quotes and ellipses', () => {
    expect(splitSentencesForTypewriter('He said "run." Then… nothing at all')).toEqual(['He said "run."', 'Then…', 'nothing at all']);
  });
  it('does not split after abbreviations', () => {
    expect(splitSentencesForTypewriter('Ask Mr. Hale about it. He knows.')).toEqual(['Ask Mr. Hale about it.', 'He knows.']);
  });
  it('returns an empty list for blank input', () => {
    expect(splitSentencesForTypewriter('   ')).toEqual([]);
    expect(splitSentencesForTypewriter('')).toEqual([]);
  });
});

describe('tailLines', () => {
  it('keeps the last lines and wraps long ones', () => {
    expect(tailLines('a\nb\nc\nd\ne\n', 4, 10)).toEqual(['b', 'c', 'd', 'e']);
    expect(tailLines('abcdefghij', 2, 4)).toEqual(['abcd', 'efgh', 'ij'].slice(-2));
  });
  it('handles empty text', () => {
    expect(tailLines('', 4, 10)).toEqual(['']);
  });
});

describe('colour helpers', () => {
  it('normalises hex and rejects junk', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' #E0A23A ')).toBe('#e0a23a');
    expect(normalizeHex('red; background:url(x)')).toBeNull();
  });
  it('chooses a readable foreground', () => {
    expect(readableOn('#ffffff')).toBe('#14110a');
    expect(readableOn('#101010')).toBe('#ffffff');
    expect(readableOn('nope')).toBe('#14110a');
  });
  it('labels effect types', () => {
    expect(effectLabel('schedule_override')).toBe('schedule override');
  });
});
