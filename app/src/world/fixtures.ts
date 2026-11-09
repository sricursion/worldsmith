// Four hand-written towns: the offline demo, the mock Worker response and the few-shot examples
// the compile model sees. One file per theme under fixtures/.
import type { ThemeId, WorldSpec } from './spec';
import { western } from './fixtures/western';
import { medieval } from './fixtures/medieval';
import { scifi } from './fixtures/scifi';
import { modern } from './fixtures/modern';

export { western, medieval, scifi, modern };

export const FIXTURES: Record<ThemeId, WorldSpec> = { western, medieval, scifi, modern };

/** Keyword patterns per theme. Each pattern is anchored at a word start, so "cyber" matches "cyberpunk". */
const THEME_KEYWORDS: Record<ThemeId, RegExp[]> = {
  western: [
    /\bwest/, /\bcowboy/, /\bsaloon/, /\bsheriff/, /\bfrontier/, /\bdesert/, /\b18\d\d\b/, /\boutlaw/, /\branch/,
    /\bgold rush/,
  ],
  medieval: [
    /\bcastle/, /\bknight/, /\bking\b/, /\bkingdom/, /\btavern/, /\bvillage/, /\bdragon/, /\bblacksmith/,
    /\bmarket/, /\bmonaster/, /\bviking/, /\bpirate/,
  ],
  scifi: [
    /\bspace/, /\bmars\b/, /\bmoon\b/, /\bstation/, /\bcolon(y|ies)/, /\bcyber/, /\bneon/, /\brobot/, /\balien/,
    /\bfuture/, /\bfuturistic/, /\b(20[3-9]\d|2[1-9]\d\d)\b/,
  ],
  modern: [
    /\btoday/, /\bcity/, /\bsuburb/, /\bcafe/, /\bcafé/, /\boffice/, /\bschool/, /\bbeach/, /\bcoastal/,
    /\b19[5-9]\d\b/, /\b20[0-2]\d\b/,
  ],
};

const THEME_ORDER: ThemeId[] = ['western', 'medieval', 'scifi', 'modern'];

/** Highest keyword score wins; ties go to the earlier theme in THEME_ORDER; no match is western. */
export function nearestTheme(prompt: string): ThemeId {
  const text = prompt.toLowerCase();
  let best: ThemeId = 'western';
  let bestScore = 0;
  for (const theme of THEME_ORDER) {
    let score = 0;
    for (const re of THEME_KEYWORDS[theme]) if (re.test(text)) score++;
    if (score > bestScore) {
      best = theme;
      bestScore = score;
    }
  }
  return best;
}
