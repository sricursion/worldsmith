// Mock mode: weather, colour grade, sound and surface materials read from the words of the prompt, so the
// offline demo shows a different atmosphere per prompt. Also the fallback when a live stage leaves them out.
import type { GradeKind, MoodSpec, SkyPreset, SurfaceSet, ThemeId, WeatherKind } from '../../../app/src/world/spec';

export interface Air {
  mood: MoodSpec;
  startHour: number;
  sky: SkyPreset;
  fog: number;
}

interface MoodHint { weather?: WeatherKind; intensity?: number; grade?: GradeKind; haze?: number; hour?: number; ambience?: string[]; music?: string }

/** What each fixture theme feels like when the prompt names no weather, hour or light. */
const THEME_AIR: Record<ThemeId, Required<MoodHint>> = {
  western: { weather: 'dust', intensity: 0.45, grade: 'golden', haze: 0.6, hour: 17.5, ambience: ['wind', 'dust', 'saloon'], music: 'lonely harmonica' },
  medieval: { weather: 'mist', intensity: 0.55, grade: 'golden', haze: 0.7, hour: 6, ambience: ['birds', 'stream', 'wind'], music: 'gentle lute' },
  scifi: { weather: 'snow', intensity: 0.3, grade: 'cold_steel', haze: 0.4, hour: 21, ambience: ['hum', 'wind', 'vent'], music: 'low synth drone' },
  modern: { weather: 'rain', intensity: 0.7, grade: 'neon_noir', haze: 0.55, hour: 18.5, ambience: ['rain', 'street', 'neon'], music: 'slow noir piano' },
};

/** Weather words. The first match sets the weather; each carries the light and hour that suit it. */
const WEATHER_WORDS: [RegExp, MoodHint][] = [
  [/\b(storm\w*|thunder\w*|tempest|hurricane|typhoon|lightning)\b/, { weather: 'storm', intensity: 0.85, grade: 'cold_steel', haze: 0.55, hour: 18, ambience: ['rain', 'thunder', 'wind'], music: 'dark low drone' }],
  [/\b(rain\w*|drizzl\w*|monsoon|downpour|soaked|drenched|sodden)\b/, { weather: 'rain', intensity: 0.7, grade: 'teal_orange', haze: 0.5, hour: 18.5, ambience: ['rain', 'wind'], music: 'slow sad piano' }],
  [/\b(blizzard|whiteout)\b/, { weather: 'snow', intensity: 0.9, grade: 'cold_steel', haze: 0.6, hour: 16.5, ambience: ['blizzard', 'wind'], music: 'sparse bells' }],
  [/\b(snow\w*|winter\w*|frost\w*|arctic|frozen|icy|ice|glacier|tundra)\b/, { weather: 'snow', intensity: 0.5, grade: 'cold_steel', haze: 0.45, hour: 16.5, ambience: ['snow', 'wind'], music: 'sparse bells' }],
  [/\b(fog\w*|smog)\b/, { weather: 'fog', intensity: 0.7, grade: 'bleached', haze: 0.8, hour: 6, ambience: ['wind'], music: 'eerie pad' }],
  [/\b(mist\w*|haz[ey])\b/, { weather: 'mist', intensity: 0.5, grade: 'bleached', haze: 0.7, hour: 6, ambience: ['wind', 'birds'], music: 'soft flute' }],
  [/\b(ash\w*|volcan\w*|lava|magma|cinder\w*)\b/, { weather: 'ash', intensity: 0.6, grade: 'crimson', haze: 0.6, hour: 19, ambience: ['wind', 'fire'], music: 'ominous drone' }],
  [/\b(ember\w*|inferno|forge|bonfire|burning)\b/, { weather: 'embers', intensity: 0.5, grade: 'crimson', haze: 0.5, hour: 20, ambience: ['fire', 'wind'], music: 'dark drone' }],
  [/\b(dust\w*|sandstorm|desert|dune\w*|arid|canyon|mesa|badlands|drought)\b/, { weather: 'dust', intensity: 0.5, grade: 'golden', haze: 0.6, hour: 17.5, ambience: ['desert', 'wind'], music: 'desert oud' }],
  [/\b(spore\w*|mushroom\w*|fung\w*|mycel\w*)\b/, { weather: 'spores', intensity: 0.55, grade: 'verdant', haze: 0.6, hour: 20, ambience: ['leaves', 'insects', 'drip'], music: 'dreamy kalimba' }],
  [/\b(firefl\w*|swamp\w*|bayou|marsh\w*|bog|mangrove)\b/, { weather: 'fireflies', intensity: 0.6, grade: 'verdant', haze: 0.6, hour: 20.5, ambience: ['frogs', 'crickets', 'water'], music: 'slow banjo' }],
  [/\b(forest\w*|jungle|grove|woods|rain\s?forest|glade)\b/, { weather: 'mist', intensity: 0.3, grade: 'verdant', haze: 0.6, hour: 6.5, ambience: ['leaves', 'birds'], music: 'gentle flute' }],
];

const TIME_WORDS: [RegExp, MoodHint][] = [
  [/\b(night\w*|midnight|moonlit|moonlight|starlit)\b/, { hour: 22, grade: 'moonlit', ambience: ['crickets'] }],
  [/\b(dusk|sunset|twilight|evening)\b/, { hour: 18.5, grade: 'teal_orange' }],
  [/\b(dawn|sunrise|daybreak|morning)\b/, { hour: 6, grade: 'golden', ambience: ['birds'] }],
  [/\b(noon|midday|high sun)\b/, { hour: 12, grade: 'bleached' }],
];

/** Light words that name the grade outright, whatever the weather. */
const GRADE_WORDS: [RegExp, MoodHint][] = [
  [/\b(neon|cyber\w*|noir|arcology|synth\w*)\b/, { grade: 'neon_noir', hour: 21, haze: 0.55, ambience: ['neon', 'hum'], music: 'slow noir synth' }],
  [/\b(sodium|lamp\s?lit|gaslight|gaslit)\b/, { grade: 'teal_orange', haze: 0.6 }],
  [/\b(sepia|old photo\w*|faded|18\d\d)\b/, { grade: 'sepia' }],
  [/\b(blood\w*|hell\w*|crimson|war\w*)\b/, { grade: 'crimson' }],
  [/\b(gothic|haunted|graveyard|crypt|cursed|vampir\w*)\b/, { grade: 'moonlit', hour: 23, haze: 0.6, music: 'eerie organ' }],
  [/\b(space|orbital|station|asteroid|mars|moon|starship)\b/, { grade: 'cold_steel', ambience: ['hum', 'vent'] }],
];

/** Places that have a sound of their own. Every match adds its words. */
const PLACE_SOUNDS: [RegExp, string[]][] = [
  [/\b(port|harbou?r|dock\w*|wharf|quay|sea\w*|ocean|coast\w*|cove|island|reef|ship\w*)\b/, ['harbor', 'gulls']],
  [/\b(market|bazaar|city|town|street\w*|saloon|tavern|festival)\b/, ['crowd']],
  [/\b(factory|refinery|reactor|machine\w*|industrial|crane\w*|container\w*|tower\w*)\b/, ['machinery']],
  [/\b(camp\w*|caravan)\b/, ['campfire']],
  [/\b(river|stream|canal|waterfall|oasis|fountain)\b/, ['stream']],
  [/\b(mountain\w*|peak|cliff\w*|summit|monastery)\b/, ['wind']],
];

function firstHint(prompt: string, table: [RegExp, MoodHint][]): MoodHint | null {
  for (const [re, hint] of table) if (re.test(prompt)) return hint;
  return null;
}

/** The sky preset an hour of the day shows; wet or thick air turns plain daylight overcast. */
export function skyFor(hour: number, weather: WeatherKind): SkyPreset {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 20 || h < 5) return 'night';
  if (h < 8) return 'dawn';
  if (h >= 17) return 'dusk';
  return weather === 'rain' || weather === 'storm' || weather === 'snow' || weather === 'fog' || weather === 'mist' || weather === 'ash' ? 'overcast' : 'day';
}

const FOG_FLOOR: Partial<Record<WeatherKind, number>> = { fog: 0.6, mist: 0.4, storm: 0.4, rain: 0.3, snow: 0.3, ash: 0.4, dust: 0.3, spores: 0.3 };

/** The lowest palette fog a weather allows, so the sky dome and the air agree. */
export function fogFor(mood: MoodSpec, fog: number): number {
  const floor = (FOG_FLOOR[mood.weather] ?? 0) * (0.6 + 0.4 * mood.intensity);
  return Math.round(Math.min(1, Math.max(fog, floor)) * 100) / 100;
}

const HOUR_OF_SKY: Record<SkyPreset, number> = { dawn: 6, day: 10, dusk: 18, night: 22, overcast: 16 };

/**
 * Mood and starting hour for a prompt. Weather, hour and light words each contribute; whatever the prompt
 * leaves unsaid comes from the weather's own habit, then the look's sky, then the theme. A prompt that
 * names none of them gets the theme's full default mood.
 */
export function mockAir(prompt: string, theme: ThemeId, lookSky: SkyPreset | null = null, lookFog: number | null = null): Air {
  const p = prompt.toLowerCase();
  const base = THEME_AIR[theme];
  const w = firstHint(p, WEATHER_WORDS);
  const t = firstHint(p, TIME_WORDS);
  const g = firstHint(p, GRADE_WORDS);
  const named = w !== null || t !== null || g !== null;
  const lookHour = lookSky ? HOUR_OF_SKY[lookSky] : undefined;
  const weather: WeatherKind = w?.weather ?? (named ? 'clear' : base.weather);
  const hour = t?.hour ?? g?.hour ?? w?.hour ?? lookHour ?? base.hour;
  // Night wins over the weather's own grade; a named light (neon, sepia) wins over both.
  const nightGrade = t?.grade === 'moonlit' ? t.grade : undefined;
  const grade: GradeKind = g?.grade ?? nightGrade ?? w?.grade ?? t?.grade ?? (named ? 'neutral' : base.grade);
  const ambience: string[] = [];
  const push = (xs: readonly string[] | undefined): void => {
    for (const x of xs ?? []) if (!ambience.includes(x) && ambience.length < 6) ambience.push(x);
  };
  push(w?.ambience);
  for (const [re, words] of PLACE_SOUNDS) if (re.test(p)) push(words);
  push(g?.ambience);
  push(t?.ambience);
  if (ambience.length < 2) push(base.ambience);
  const mood: MoodSpec = {
    weather,
    intensity: weather === 'clear' ? 0 : (w?.intensity ?? base.intensity),
    grade,
    haze: g?.haze ?? w?.haze ?? base.haze,
    ambience,
    music: g?.music ?? w?.music ?? base.music,
  };
  return { mood, startHour: hour, sky: skyFor(hour, weather), fog: fogFor(mood, lookFog ?? 0.15) };
}

// ---- Surfaces ----------------------------------------------------------------------------------

type SurfaceHint = Partial<SurfaceSet>;

const THEME_SURFACES: Record<ThemeId, SurfaceSet> = {
  western: { wall: 'planks', wall2: 'timber', roof: 'shingle', trim: 'timber', ground: 'dirt', road: 'dirt', wear: 0.65, wet: 0 },
  medieval: { wall: 'plaster', wall2: 'timber', roof: 'thatch', trim: 'timber', ground: 'grass', road: 'cobble', wear: 0.45, wet: 0 },
  scifi: { wall: 'metal_panel', wall2: 'hull_plate', roof: 'metal_panel', trim: 'metal_panel', ground: 'regolith', road: 'metal_panel', wear: 0.3, wet: 0 },
  modern: { wall: 'brick', wall2: 'concrete', roof: 'slate', trim: 'concrete', ground: 'concrete', road: 'asphalt', wear: 0.35, wet: 0 },
};

/** What the place is built from. The first match is the main material set; order is by how specific the word is. */
const SURFACE_WORDS: [RegExp, SurfaceHint][] = [
  [/\b(port|dock\w*|wharf|container\w*|shipyard|industrial|factory|refinery|scrap\w*|junk\w*)\b/, { wall: 'corrugated', wall2: 'rusted', roof: 'corrugated', trim: 'metal_panel', ground: 'concrete', road: 'asphalt', wear: 0.7 }],
  [/\b(mushroom\w*|fung\w*|spore\w*|mycel\w*)\b/, { wall: 'organic', wall2: 'bark', roof: 'organic', trim: 'bark', ground: 'moss', road: 'dirt', wear: 0.35 }],
  [/\b(hive|termite|insect\w*|chitin\w*|carapace)\b/, { wall: 'chitin', wall2: 'organic', roof: 'chitin', trim: 'organic', ground: 'dirt', road: 'dirt', wear: 0.4 }],
  [/\b(crystal\w*|gem\w*|geode)\b/, { wall: 'crystal', wall2: 'stone', roof: 'crystal', trim: 'stone', ground: 'gravel', road: 'stone', wear: 0.2 }],
  [/\b(reef|coral|under\s?water|atlantis|lagoon)\b/, { wall: 'coral', wall2: 'stone', roof: 'coral', trim: 'stone', ground: 'sand', road: 'sand', wear: 0.4 }],
  [/\b(glass|skyscraper\w*|needle\w*|corporate|chrome)\b/, { wall: 'glass_curtain', wall2: 'metal_panel', roof: 'metal_panel', trim: 'metal_panel', ground: 'concrete', road: 'asphalt', wear: 0.1 }],
  [/\b(neon|cyber\w*|arcology|noir|megacity)\b/, { wall: 'concrete', wall2: 'metal_panel', roof: 'metal_panel', trim: 'metal_panel', ground: 'asphalt', road: 'asphalt', wear: 0.55 }],
  [/\b(space|orbital|asteroid|mars|moon|starship|colony)\b/, { wall: 'hull_plate', wall2: 'metal_panel', roof: 'hull_plate', trim: 'metal_panel', ground: 'regolith', road: 'metal_panel', wear: 0.3 }],
  [/\b(volcan\w*|lava|magma|ash\w*|cinder\w*)\b/, { wall: 'stone', wall2: 'rusted', roof: 'slate', trim: 'stone', ground: 'ash', road: 'gravel', wear: 0.7 }],
  [/\b(igloo|glacier|ice|icy|frozen)\b/, { wall: 'ice', wall2: 'stone', roof: 'snow', trim: 'timber', ground: 'snow', road: 'ice', wear: 0.3 }],
  [/\b(monastery|abbey|castle|fortress|gothic|cathedral|crypt|keep|citadel)\b/, { wall: 'stone', wall2: 'brick', roof: 'slate', trim: 'timber', ground: 'gravel', road: 'cobble', wear: 0.65 }],
  [/\b(edo|samurai|japan\w*|shogun|pagoda|feudal|dynasty|china|chinese)\b/, { wall: 'plaster', wall2: 'paper_screen', roof: 'tile', trim: 'timber', ground: 'gravel', road: 'cobble', wear: 0.3 }],
  [/\b(camp\w*|caravan|tent\w*|nomad\w*|yurt\w*|circus)\b/, { wall: 'canvas', wall2: 'canvas', roof: 'canvas', trim: 'timber', ground: 'sand', road: 'dirt', wear: 0.5 }],
  [/\b(desert|dune\w*|oasis|adobe|canyon|mesa|egypt\w*|pueblo)\b/, { wall: 'adobe', wall2: 'plaster', roof: 'adobe', trim: 'timber', ground: 'sand', road: 'sand', wear: 0.5 }],
  [/\b(swamp\w*|bayou|marsh\w*|bog|mangrove|jungle|tropic\w*|pirate\w*|cove|island)\b/, { wall: 'planks', wall2: 'log', roof: 'thatch', trim: 'timber', ground: 'mud', road: 'planks', wear: 0.65 }],
  [/\b(forest\w*|grove|woods|glade|elv\w*|elf)\b/, { wall: 'log', wall2: 'bark', roof: 'shingle', trim: 'timber', ground: 'grass', road: 'dirt', wear: 0.4 }],
];

/** Ground and wear words that lay over the main set. */
const SURFACE_MODS: [RegExp, SurfaceHint][] = [
  [/\b(snow\w*|blizzard|winter\w*|arctic|tundra|frost\w*)\b/, { ground: 'snow', road: 'snow' }],
  [/\b(mountain\w*|cliff\w*|peak|summit)\b/, { road: 'stone' }],
  [/\b(ruin\w*|abandoned|derelict|rotting|wreck\w*|forgotten|decay\w*)\b/, { wear: 0.9 }],
  [/\b(weathered|rust\w*|old|dusty|grim\w*|shanty|battered)\b/, { wear: 0.7 }],
  [/\b(pristine|gleaming|polished|spotless|brand new)\b/, { wear: 0.08 }],
];

const WET_OF: Partial<Record<WeatherKind, number>> = { rain: 0.45, storm: 0.55, mist: 0.25, fog: 0.25, snow: 0.15 };

/** How soaked the ground is under a mood: rain and storm scale with their strength. */
export function wetFor(mood: MoodSpec): number {
  const base = WET_OF[mood.weather] ?? 0;
  const scaled = mood.weather === 'rain' || mood.weather === 'storm' ? base + 0.45 * mood.intensity : base;
  return Math.round(Math.min(1, scaled) * 100) / 100;
}

/** Surface materials for a prompt: the first material word, then ground and wear words, over the theme's set. */
export function mockSurfaces(prompt: string, theme: ThemeId, mood: MoodSpec): SurfaceSet {
  const p = prompt.toLowerCase();
  let out: SurfaceSet = { ...THEME_SURFACES[theme] };
  for (const [re, hint] of SURFACE_WORDS) {
    if (!re.test(p)) continue;
    out = { ...out, ...hint };
    break;
  }
  for (const [re, hint] of SURFACE_MODS) if (re.test(p)) out = { ...out, ...hint };
  const soaked = /\b(swamp\w*|bayou|marsh\w*|bog|flood\w*|soaked|drenched|sodden)\b/.test(p) ? 0.6 : 0;
  out.wet = Math.max(out.wet, soaked, wetFor(mood));
  return out;
}
