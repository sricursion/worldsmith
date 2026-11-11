import { describe, expect, it } from 'vitest';
import { BUILD_STEPS, EXTRA_EXAMPLES, controlsParts, fallbackNotice, liveLine, mergeExamples, peekField, stepStates, writingNow, type BuildStage, controlsHint, effectLabel, promptLabel, formatClock, normalizeHex, readableOn, splitSentencesForTypewriter, tailLines } from '../../app/src/ui/text';

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

describe('touch labels', () => {
  it('swaps the E key hint for Tap on coarse pointers only', () => {
    expect(promptLabel('E · talk to Ada', true)).toBe('Tap · talk to Ada');
    expect(promptLabel('E · talk to Ada', false)).toBe('E · talk to Ada');
    expect(promptLabel('Take the key', true)).toBe('Take the key');
  });
  it('picks the controls hint by pointer type', () => {
    expect(controlsHint(false)).toContain('WASD');
    expect(controlsHint(true)).toContain('tap the pill');
  });
});

describe('landing examples', () => {
  it('merges, trims and drops repeats up to the cap', () => {
    expect(mergeExamples(['A', ' b ', ''], ['a', 'B', 'c', 'd'], 3)).toEqual(['A', 'b', 'c']);
    expect(mergeExamples([], EXTRA_EXAMPLES, 6).length).toBe(EXTRA_EXAMPLES.length);
  });
});

describe('build progress', () => {
  it('makes the first stage that has not arrived the active one', () => {
    expect(stepStates(new Set())).toEqual({ outline: 'active', look: 'waiting', land: 'waiting', story: 'waiting' });
    expect(stepStates(new Set<BuildStage>(['outline', 'look']))).toEqual({ outline: 'done', look: 'done', land: 'active', story: 'waiting' });
    expect(stepStates(new Set<BuildStage>(['outline', 'look', 'story']))).toEqual({ outline: 'done', look: 'done', land: 'active', story: 'done' });
  });
  it('lists every stage exactly once', () => {
    expect(BUILD_STEPS.map((s) => s.id)).toEqual(['outline', 'look', 'land', 'story']);
  });
  it('reads finished string fields out of unfinished JSON', () => {
    const partial = '{"title": "Salt \\"Harbour\\"", "tagline": "The tide keeps its own cou';
    expect(peekField(partial, 'title')).toBe('Salt "Harbour"');
    expect(peekField(partial, 'tagline')).toBeNull();
    expect(peekField('', 'title')).toBeNull();
  });
  it('names the section being written from the last key opened', () => {
    expect(writingNow('{"title":"X","buildings":[{"id":"a"}],"npcs":[{')).toBe('the people');
    expect(writingNow('{"zzz":1')).toBeNull();
  });
  it('builds the live line from real counters only', () => {
    expect(liveLine('', 0.4)).toBe('0 s');
    expect(liveLine('x'.repeat(1200), 12.9)).toBe('1,200 characters so far · 12 s');
    expect(liveLine('{"quest":{', 3)).toBe('Writing the quest · 10 characters so far · 3 s');
    expect(liveLine('', 5)).not.toContain('%');
  });
});

describe('failure and controls text', () => {
  it('says plainly that a saved world is shown', () => {
    expect(fallbackNotice('The forge could not be reached')).toBe('The forge could not be reached. This is a saved world, not one built from your prompt.');
    expect(fallbackNotice('  ')).toMatch(/^The build failed\. /);
  });
  it('offers short key and action pairs for each pointer type', () => {
    expect(controlsParts(false).map((p) => p.key)).toContain('WASD');
    expect(controlsParts(true).every((p) => p.key !== 'WASD')).toBe(true);
  });
});
