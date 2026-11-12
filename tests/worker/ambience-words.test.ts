import { describe, expect, it } from 'vitest';
import { outlineSystemPrompt } from '../../worker/src/prompts/compile';
import { dryUnlessAsked } from '../../worker/src/prompts/compilemerge';
import { AMBIENCE_WORDS, bedsForWord } from '../../app/src/engine/audio/vocab';

describe('ambience words offered to the compile model', () => {
  const line = outlineSystemPrompt().split('\n').find((l) => l.startsWith('- ambience:')) ?? '';
  const offered = (/first: ([a-z ]+)\./.exec(line)?.[1] ?? '').split(' ').filter((w) => w !== '');

  it('lists exactly the vocabulary the sound engine understands, on one short line', () => {
    expect([...offered].sort()).toEqual([...AMBIENCE_WORDS].sort());
    for (const word of offered) expect(bedsForWord(word).length, word).toBeGreaterThan(0);
    expect(line.length).toBeLessThan(360);
  });

  it('does not lead with wind or water', () => {
    expect(offered.indexOf('wind')).toBeGreaterThan(offered.length - 5);
    expect(offered.indexOf('water')).toBeGreaterThan(8);
  });

  it('still keeps rain and thunder out of a dry prompt', () => {
    const wet = { weather: 'rain', intensity: 0.8, ambience: ['rain', 'thunder', 'harbor', 'gulls'] };
    expect(dryUnlessAsked(wet, 'a fishing port').ambience).toEqual(['harbor', 'gulls']);
    expect(dryUnlessAsked(wet, 'a fishing port in the rain').ambience).toEqual(wet.ambience);
  });
});
