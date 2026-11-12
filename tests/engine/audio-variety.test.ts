import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DAY_PHASES, EVENTS, EVENT_KINDS, EventScheduler, MAX_GAP_FACTOR, MIN_GAP_FACTOR, MIN_GAP_SECONDS, VOICE_CAP, VoicePool, nextGap,
  type Fired,
} from '../../app/src/engine/audio/events';
import { creatureCall, identityLayers, placeOf, soundProfile, type Land, type WorldSound } from '../../app/src/engine/audio/identity';
import { renderBabble, renderCicadas, renderCrickets } from '../../app/src/engine/audio/loops';
import {
  EVENT_FLOOR_SECONDS, FLOOR_BEDS, MAX_EVENT_KINDS, MUSIC_PATTERNS, bedCharacter, musicPlan, placeGain, sceneMix, soundPlan, trimMix,
  type SoundPlan,
} from '../../app/src/engine/audio/mapping';
import { musicFigure } from '../../app/src/engine/audio/music';
import { AMBIENCE_WORDS, EVENT_BUS, VOCABULARY, bedsForWord, wordLayers, type BedId } from '../../app/src/engine/audio/vocab';
import { eventTune, hasVoice } from '../../app/src/engine/audio/voices';
import { peak, rms } from '../../app/src/engine/audio/dsp';
import { makeRng } from '../../app/src/world/rng';
import type { MoodSpec, WorldSpec } from '../../app/src/world/spec';

const mood = (over: Partial<MoodSpec>): MoodSpec => ({ weather: 'clear', intensity: 0, grade: 'neutral', haze: 0.2, ambience: [], music: '', ...over });

const SPEC_DIR = fileURLToPath(new URL('../worker/_live/out3/', import.meta.url));
function savedSpecs(): { name: string; spec: WorldSpec }[] {
  return readdirSync(SPEC_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.raw.json'))
    .sort()
    .map((f) => ({ name: f.replace('.json', ''), spec: JSON.parse(readFileSync(SPEC_DIR + f, 'utf8')) as WorldSpec }));
}
function planFor(spec: WorldSpec, hour = spec.time.startHour): SoundPlan {
  return soundPlan({ mood: spec.mood, theme: spec.theme, hour, groundKind: spec.style?.surfaces?.ground, sitePattern: spec.site?.pattern, world: soundProfile(spec) });
}

describe('ambience vocabulary', () => {
  it('is far wider than the old fifteen words and every word maps to a bed', () => {
    const words = VOCABULARY.map((e) => e.word);
    expect(words.length).toBeGreaterThanOrEqual(40);
    expect(new Set(words).size).toBe(words.length);
    expect(AMBIENCE_WORDS.length).toBeGreaterThanOrEqual(35);
    for (const word of AMBIENCE_WORDS) expect(words).toContain(word);
    for (const word of words) {
      expect(word).toMatch(/^[a-z]+$/);
      expect(bedsForWord(word).length, word).toBeGreaterThan(0);
      // The word alone, in a scene with nothing else, puts something audible in the mix.
      const mix = sceneMix({ theme: 'medieval', hour: 12, mood: mood({ ambience: [word] }) });
      const layers = wordLayers(word);
      for (const id of layers.beds) expect(mix.some((b) => b.id === id), `${word} -> ${id}`).toBe(true);
      const kinds = mix.flatMap((b) => b.events ?? []).map((e) => e.kind);
      for (const kind of layers.events) expect(kinds, word).toContain(kind);
    }
    // The old words still mean what they meant.
    for (const [word, bed] of [['rain', 'rain'], ['thunder', 'thunder'], ['wind', 'wind'], ['crowd', 'murmur'], ['machinery', 'hum'], ['fire', 'fire'], ['leaves', 'leaves']] as const) {
      expect(bedsForWord(word)).toContain(bed);
    }
  });

  it('keeps look-alike words apart', () => {
    expect(bedsForWord('crowd')).toEqual(['murmur']);
    expect(bedsForWord('howling wind')).toEqual(['wind']);
    expect(bedsForWord('monkeys')).toEqual(['jungle']);
    expect(bedsForWord('distant_train')).toEqual(['townlife']);
    expect(bedsForWord('wind chimes')).toEqual(['wind', 'townlife']);
    expect(wordLayers('night owls').events).toEqual(['owl']);
    expect(wordLayers('market_chatter')).toEqual({ beds: ['murmur'], events: ['call', 'clink'] });
  });

  it('still makes a full scene from words it has never seen', () => {
    expect(bedsForWord('qwerty')).toEqual([]);
    for (const theme of ['western', 'medieval', 'scifi', 'modern'] as const) {
      const plan = soundPlan({ theme, hour: 12, mood: mood({ ambience: ['qwerty', 'zxcv'] }) });
      expect(plan.beds.filter((b) => !b.events).length, theme).toBeGreaterThanOrEqual(3);
      expect(plan.events.length, theme).toBeGreaterThanOrEqual(3);
      // A spec that names nothing but air and water still gets the life of its theme on top.
      for (const hour of [6, 13, 23]) {
        const bare = soundPlan({ theme, hour, mood: mood({ ambience: ['wind', 'water'] }) });
        expect(new Set(bare.identity).size, `${theme} ${hour}`).toBeGreaterThanOrEqual(3);
        expect(bare.beds.find((b) => b.id === 'wind')?.level ?? 0).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('has a voice, a bus and a schedule for every kind of event', () => {
    expect(EVENT_KINDS.length).toBeGreaterThanOrEqual(40);
    for (const kind of EVENT_KINDS) {
      expect(hasVoice(kind), kind).toBe(true);
      expect(['wildlife', 'townlife', 'shorelife']).toContain(EVENT_BUS[kind]);
      expect(EVENTS[kind].gap).toBeGreaterThan(MIN_GAP_SECONDS);
      expect(EVENTS[kind].phase.some((k) => k > 0), kind).toBe(true);
    }
    for (const e of VOCABULARY) for (const k of e.events ?? []) expect(EVENT_KINDS).toContain(k);
  });
});

describe('variety between worlds', () => {
  const beds = [...new Set(VOCABULARY.flatMap((e) => e.beds))] as BedId[];

  it('gives the same word measurably different parameters under different seeds', () => {
    for (const id of beds) {
      const a = bedCharacter(101, id);
      const b = bedCharacter(202, id);
      expect(bedCharacter(101, id)).toEqual(a);
      const moved = (['pitch', 'rate', 'density', 'colour'] as const).filter((k) => Math.abs(Math.log2(a[k] / b[k])) > 0.04);
      expect(moved.length, id).toBeGreaterThanOrEqual(2);
    }
    // Across many worlds each parameter covers a wide range, and stays inside sane bounds.
    for (const k of ['pitch', 'rate', 'density', 'colour'] as const) {
      const values = Array.from({ length: 40 }, (_, seed) => bedCharacter(seed * 7919 + 1, 'wind')[k]);
      expect(Math.max(...values) / Math.min(...values), k).toBeGreaterThan(1.5);
      expect(Math.min(...values)).toBeGreaterThan(0.55);
      expect(Math.max(...values)).toBeLessThan(1.6);
    }
    // A bed and its neighbour in the same world are not shifted the same way.
    expect(bedCharacter(5, 'wind')).not.toEqual({ ...bedCharacter(5, 'water') });
  });

  it('tunes events per world and renders insect loops that differ by seed', () => {
    const tunes = Array.from({ length: 20 }, (_, seed) => eventTune(seed + 1, 'bell'));
    expect(new Set(tunes.map((t) => t.toFixed(3))).size).toBeGreaterThan(15);
    expect(Math.max(...tunes) / Math.min(...tunes)).toBeGreaterThan(1.2);
    expect(eventTune(9, 'bell')).toBe(eventTune(9, 'bell'));
    const sr = 11025;
    for (const render of [
      (seed: number) => renderCrickets(sr, 3, 4, makeRng(seed, 'crickets')),
      (seed: number) => renderCicadas(sr, 3, 3, makeRng(seed, 'cicadas')),
      (seed: number) => renderBabble(sr, 3, 60, makeRng(seed, 'babble')),
    ]) {
      const [a] = render(1);
      const [b] = render(2);
      expect(a.every((v) => Number.isFinite(v))).toBe(true);
      expect(peak(a)).toBeLessThanOrEqual(1);
      expect(rms(a)).toBeGreaterThan(0.005);
      let differ = 0;
      for (let i = 0; i < a.length; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 1e-4) differ += 1;
      expect(differ).toBeGreaterThan(a.length * 0.2);
    }
  });

  it('varies the music by seed: key, tempo, mode, pattern and the length of the silences', () => {
    const plans = Array.from({ length: 24 }, (_, i) => musicPlan(mood({ music: 'guitar' }), 'western', 1000 + i * 37));
    const distinct = (pick: (p: NonNullable<(typeof plans)[number]>) => unknown): number => new Set(plans.map((p) => (p ? pick(p) : null))).size;
    expect(distinct((p) => p.pattern)).toBeGreaterThanOrEqual(3);
    expect(distinct((p) => p.mode)).toBeGreaterThanOrEqual(3);
    expect(distinct((p) => p.root)).toBeGreaterThanOrEqual(5);
    expect(distinct((p) => p.bpm)).toBeGreaterThanOrEqual(5);
    expect(distinct((p) => `${p.phraseBars}+${p.restBars}`)).toBeGreaterThanOrEqual(4);
    for (const p of plans) {
      expect(p?.voice).toBe('pluck');
      expect(MUSIC_PATTERNS).toContain(p?.pattern);
      // Every piece rests for at least three bars between phrases.
      expect(p?.restBars ?? 0).toBeGreaterThanOrEqual(3);
      expect(p?.phraseBars ?? 0).toBeGreaterThanOrEqual(4);
    }
    // Words still decide what they name, whatever the seed.
    for (let seed = 1; seed < 12; seed++) {
      expect(musicPlan(mood({ music: 'low war drums' }), 'medieval', seed)).toMatchObject({ mode: 'aeolian', drums: true, pattern: 'ostinato' });
      expect(musicPlan(mood({ music: 'warm celesta' }), 'medieval', seed)).toMatchObject({ voice: 'mallet', mode: 'ionian', bells: true });
      expect(musicPlan(mood({ music: 'soft cello' }), 'medieval', seed)).toMatchObject({ lead: 'bow', pattern: 'chorale' });
      expect(musicPlan(mood({ music: '' }), 'medieval', seed)).toBeNull();
    }
    expect(musicPlan(mood({ music: 'guitar' }), 'western', 5)).toEqual(musicPlan(mood({ music: 'guitar' }), 'western', 5));
    expect(musicFigure(1, 0.5)).toEqual(musicFigure(1, 0.5));
    expect(musicFigure(1, 0.5)).not.toEqual(musicFigure(2, 0.5));
    for (const m of musicFigure(3, 0.9).motif) expect(m.slot).toBeLessThan(8);
  });
});

describe('events scheduler', () => {
  const simulate = (cap: number, minutes: number, phase: (t: number) => (typeof DAY_PHASES)[number], kinds = EVENT_KINDS.slice(0, 14)) => {
    const pool = new VoicePool(cap);
    const sched = new EventScheduler(makeRng(42, 'events'), pool);
    const ids = new Map<number, string>();
    for (const kind of kinds) ids.set(sched.add({ kind, gap: EVENTS[kind].gap }, 0), kind);
    const fired: Fired[] = [];
    let most = 0;
    for (let t = 0; t < minutes * 60; t += 1 / 30) {
      const due = sched.due(t, phase(t));
      expect(due.length).toBeLessThanOrEqual(1);
      fired.push(...due);
      most = Math.max(most, pool.active(t));
    }
    return { fired, most, ids };
  };

  it('draws gaps that are bounded and lopsided', () => {
    const rng = makeRng(7, 'gaps');
    const mean = 20;
    const gaps = Array.from({ length: 5000 }, () => nextGap(rng, mean));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(Math.max(MIN_GAP_SECONDS, mean * MIN_GAP_FACTOR) - 1e-9);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(mean * MAX_GAP_FACTOR + 1e-9);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(avg).toBeGreaterThan(mean * 0.7);
    expect(avg).toBeLessThan(mean * 1.3);
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - avg) ** 2, 0) / gaps.length);
    expect(sd / avg).toBeGreaterThan(0.45);
    // A very short mean never turns into machine-gun repeats.
    expect(nextGap(rng, 0.2)).toBeGreaterThanOrEqual(MIN_GAP_SECONDS);
  });

  it('fires irregularly, one at a time, and never past the voice cap', () => {
    for (const cap of VOICE_CAP) {
      const { fired, most } = simulate(cap, 40, () => 'day');
      expect(most).toBeLessThanOrEqual(cap);
      expect(fired.length).toBeGreaterThan(80);
      // Rebuild the overlaps from what fired: at no start are more than `cap` events sounding.
      for (const f of fired) {
        const sounding = fired.filter((g) => g.at <= f.at && g.at + g.seconds > f.at).length;
        expect(sounding).toBeLessThanOrEqual(cap);
      }
      // Starts never coincide and the waits between them are far from even.
      const starts = fired.map((f) => f.at);
      const waits = starts.slice(1).map((t, i) => t - (starts[i] ?? 0));
      expect(Math.min(...waits)).toBeGreaterThan(0.5);
      const avg = waits.reduce((a, b) => a + b, 0) / waits.length;
      const sd = Math.sqrt(waits.reduce((a, b) => a + (b - avg) ** 2, 0) / waits.length);
      expect(sd / avg).toBeGreaterThan(0.4);
      for (const f of fired) {
        expect(f.pan).toBeGreaterThanOrEqual(-1);
        expect(f.pan).toBeLessThanOrEqual(1);
        expect(f.level).toBeGreaterThan(0.2);
        expect(f.level).toBeLessThanOrEqual(1);
        expect(f.pitch).toBeGreaterThan(0.7);
        expect(f.pitch).toBeLessThan(1.4);
      }
      expect(new Set(fired.map((f) => f.pan.toFixed(2))).size).toBeGreaterThan(30);
    }
  });

  it('keeps every source inside its own bounds', () => {
    const { fired, ids } = simulate(7, 60, () => 'day', ['gull', 'crow', 'dog', 'drip', 'clink', 'creak']);
    for (const [id, kind] of ids) {
      const own = fired.filter((f) => f.source === id).map((f) => f.at);
      expect(own.length, kind).toBeGreaterThan(8);
      const gap = EVENTS[kind as keyof typeof EVENTS].gap;
      const waits = own.slice(1).map((t, i) => t - (own[i] ?? 0));
      expect(Math.min(...waits), kind).toBeGreaterThanOrEqual(MIN_GAP_SECONDS);
      // The longest wait is the longest gap plus a few deferrals to let other events finish.
      expect(Math.max(...waits), kind).toBeLessThan(gap * MAX_GAP_FACTOR * 2.2 + 30);
    }
  });

  it('holds to one voice when one is all there is, and follows the hour', () => {
    const one = simulate(1, 20, () => 'day');
    expect(one.most).toBe(1);
    expect(one.fired.length).toBeGreaterThan(20);
    const day = simulate(5, 30, () => 'day', ['owl', 'wolf', 'rooster', 'gull']);
    const kindOf = (f: Fired, ids: Map<number, string>): string => ids.get(f.source) ?? '';
    expect(day.fired.some((f) => kindOf(f, day.ids) === 'owl' || kindOf(f, day.ids) === 'wolf')).toBe(false);
    expect(day.fired.some((f) => kindOf(f, day.ids) === 'gull')).toBe(true);
    const night = simulate(5, 30, () => 'night', ['owl', 'wolf', 'rooster', 'gull']);
    expect(night.fired.some((f) => kindOf(f, night.ids) === 'owl')).toBe(true);
    expect(night.fired.some((f) => kindOf(f, night.ids) === 'rooster')).toBe(false);
    const dawn = simulate(5, 30, () => 'dawn', ['owl', 'rooster']);
    expect(dawn.fired.filter((f) => kindOf(f, dawn.ids) === 'rooster').length).toBeGreaterThan(10);
  });

  it('stops a source that has been removed', () => {
    const pool = new VoicePool(4);
    const sched = new EventScheduler(makeRng(3, 'events'), pool);
    const id = sched.add({ kind: 'drip', gap: 4 }, 0);
    let before = 0;
    for (let t = 0; t < 60; t += 0.05) before += sched.due(t, 'day').length;
    expect(before).toBeGreaterThan(3);
    sched.remove(id);
    expect(sched.size).toBe(0);
    for (let t = 60; t < 200; t += 0.05) expect(sched.due(t, 'day')).toEqual([]);
  });
});

describe('sound identity from the spec', () => {
  const specs = savedSpecs();
  const plans = new Map(specs.map(({ name, spec }) => [name, planFor(spec)]));
  const plan = (name: string): SoundPlan => {
    const p = plans.get(name);
    if (!p) throw new Error(`no saved spec ${name}`);
    return p;
  };
  const bedIds = (p: SoundPlan): string[] => p.beds.filter((b) => !b.events).map((b) => b.id);
  const kinds = (p: SoundPlan): string[] => p.events.map((e) => e.kind);

  it('gives every saved world at least three layers that are neither wind nor water', () => {
    expect(specs.length).toBeGreaterThanOrEqual(6);
    for (const [name, p] of plans) {
      expect(new Set(p.identity).size, name).toBeGreaterThanOrEqual(3);
      expect(p.identity.some((id) => (FLOOR_BEDS as readonly string[]).includes(id))).toBe(false);
      expect(p.events.length, name).toBeLessThanOrEqual(MAX_EVENT_KINDS);
      // Together the events keep to a pace the ear can follow.
      expect(p.events.reduce((acc, e) => acc + 1 / e.gap, 0), name).toBeLessThanOrEqual(1 / EVENT_FLOOR_SECONDS + 1e-9);
      for (const b of p.beds) {
        expect(b.level).toBeGreaterThan(0);
        expect(b.level).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps wind and water as a floor under the life of the place', () => {
    for (const { name, spec } of specs) {
      const p = plan(name);
      const weather = spec.mood?.weather ?? 'clear';
      if (weather === 'rain' || weather === 'storm' || weather === 'snow') continue;
      const textured = p.beds.filter((b) => !b.events && !(b.id === 'murmur' && b.variant === 0));
      const floor = textured.filter((b) => FLOOR_BEDS.includes(b.id));
      const rest = textured.filter((b) => !FLOOR_BEDS.includes(b.id));
      for (const b of floor) expect(b.level, `${name} ${b.id}`).toBeLessThanOrEqual(0.5);
      const wind = p.beds.find((b) => b.id === 'wind');
      if (wind) expect(wind.level, name).toBeLessThanOrEqual(0.3);
      // Something that is not air or water is at least as loud as the loudest of them.
      expect(Math.max(...rest.map((b) => b.level)), name).toBeGreaterThanOrEqual(Math.max(0, ...floor.map((b) => b.level)));
    }
  });

  it('makes no two worlds alike', () => {
    const signature = (p: SoundPlan): string => `${bedIds(p).sort().join(',')}|${kinds(p).sort().join(',')}`;
    const seen = new Map<string, string>();
    for (const [name, p] of plans) {
      const sig = signature(p);
      expect(seen.get(sig), `${name} sounds like ${seen.get(sig)}`).toBeUndefined();
      seen.set(sig, name);
    }
    // More than the label differs: any two worlds share well under all of their identity layers.
    const names = [...plans.keys()];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = new Set(plan(names[i] ?? '').identity);
        const b = new Set(plan(names[j] ?? '').identity);
        const shared = [...a].filter((x) => b.has(x)).length;
        expect(shared / Math.max(a.size, b.size), `${names[i]} vs ${names[j]}`).toBeLessThan(0.8);
      }
    }
    // The music differs too wherever the words do.
    const tunes = new Set([...plans.values()].map((p) => JSON.stringify(p.music)));
    expect(tunes.size).toBeGreaterThanOrEqual(10);
  });

  it('can be told apart with eyes closed: castle, Mars base, jungle temple, neon city, reef, rig', () => {
    const castle = plan('a_medieval_castle_under_siege');
    expect(kinds(castle)).toEqual(expect.arrayContaining(['anvil', 'hoof', 'flap', 'crow']));
    expect(bedIds(castle)).toEqual(expect.arrayContaining(['fire', 'murmur']));

    const mars = plan('a_research_base_on_mars');
    expect(bedIds(mars)).toEqual(expect.arrayContaining(['hum', 'vent']));
    expect(kinds(mars)).toEqual(expect.arrayContaining(['beep', 'servo', 'static']));
    for (const id of ['birds', 'crickets', 'leaves', 'water', 'surf']) expect(bedIds(mars)).not.toContain(id);
    for (const kind of ['dog', 'gull', 'crow', 'bell']) expect(kinds(mars)).not.toContain(kind);

    const jungle = plan('a_mayan_temple_city_in_the_jungle');
    expect(bedIds(jungle)).toEqual(expect.arrayContaining(['jungle', 'drone', 'birds']));
    expect(kinds(jungle)).toEqual(expect.arrayContaining(['gong', 'whoop', 'squawk']));
    expect(kinds(jungle)).not.toContain('bell');

    const neon = plan('a_cyberpunk_alley_market');
    expect(bedIds(neon)).toEqual(expect.arrayContaining(['buzz', 'traffic', 'murmur']));
    expect(kinds(neon)).toEqual(expect.arrayContaining(['spark', 'call', 'carpass']));

    const reef = plan('an_underwater_coral_city');
    expect(bedIds(reef)).toContain('underwater');
    expect(kinds(reef)).toEqual(expect.arrayContaining(['bubble', 'whale']));
    for (const id of ['wind', 'water', 'surf', 'birds', 'traffic']) expect(bedIds(reef)).not.toContain(id);
    for (const kind of ['dog', 'gull', 'carpass', 'door']) expect(kinds(reef)).not.toContain(kind);

    const rig = plan('an_oil_rig_in_a_storm_free_north_sea');
    expect(bedIds(rig)).toEqual(expect.arrayContaining(['hum', 'surf']));
    expect(kinds(rig)).toEqual(expect.arrayContaining(['gull', 'clank', 'creak']));

    const forum = plan('a_roman_forum');
    expect(kinds(forum)).toEqual(expect.arrayContaining(['call', 'hoof', 'coo']));
    expect(kinds(forum)).not.toContain('gong');
    expect(kinds(plan('an_edo_period_japanese_village_in_autumn'))).toEqual(expect.arrayContaining(['gong', 'chime']));
    expect(kinds(plan('midtown_manhattan_at_rush_hour'))).toEqual(expect.arrayContaining(['carpass', 'train']));
  });

  it('reads creatures, people and the water the land holds', () => {
    expect(creatureCall('carrion crows', 'bird')).toBe('crow');
    expect(creatureCall('stabled warhorses', 'quadruped')).toBe('hoof');
    expect(creatureCall('howler monkeys', 'biped')).toBe('whoop');
    expect(creatureCall('red dragonflies', 'swarm')).toBe('fly');
    expect(creatureCall('ash dragon', 'winged')).toBe('growl');
    expect(creatureCall('survey rovers', 'crawler')).toBe('servo');
    expect(creatureCall('thing with no name', 'swarm')).toBe('fly');
    const base: WorldSound = { seed: 1, text: '', creatures: [], people: 0, settled: 0.1, water: 'none', waterAmount: 0 };
    expect(identityLayers(base, 'medieval').beds.size).toBe(0);
    expect(identityLayers({ ...base, people: 7, settled: 0.9 }, 'medieval').beds.get('murmur') ?? 0).toBeGreaterThan(0.5);
    expect(identityLayers({ ...base, water: 'river', waterAmount: 0.2 }, 'medieval').beds.has('stream')).toBe(true);
    expect(identityLayers({ ...base, water: 'shore', waterAmount: 0.4 }, 'medieval').beds.has('surf')).toBe(true);
    expect(identityLayers({ ...base, text: 'the marsh village' }, 'scifi').mute.size).toBe(0);
    expect(identityLayers({ ...base, text: 'a base on mars' }, 'scifi').mute.has('birds')).toBe(true);
    const flock = identityLayers({ ...base, creatures: [{ name: 'herring gulls', family: 'bird', count: 9 }] }, 'modern').events.get('gull') ?? 0;
    const single = identityLayers({ ...base, creatures: [{ name: 'herring gull', family: 'bird', count: 1 }] }, 'modern').events.get('gull') ?? 0;
    expect(flock).toBeGreaterThan(single);
  });
});

describe('variety over time and by place', () => {
  const spec = savedSpecs().find((s) => s.name === 'a_treehouse_village_in_giant_redwoods')?.spec;
  if (!spec) throw new Error('saved spec missing');
  const level = (p: SoundPlan, id: string): number => p.beds.find((b) => b.id === id)?.level ?? 0;

  it('shifts the mix with the clock: dawn chorus, daytime bustle, night insects', () => {
    const dawn = planFor(spec, 6);
    const day = planFor(spec, 13);
    const dusk = planFor(spec, 19);
    const night = planFor(spec, 23);
    expect(level(dawn, 'birds')).toBeGreaterThan(level(day, 'birds'));
    expect(level(day, 'birds')).toBeGreaterThan(level(dusk, 'birds'));
    expect(level(night, 'birds')).toBe(0);
    expect(dawn.beds.find((b) => b.id === 'birds')?.variant).toBe(2);
    const town = { theme: 'medieval' as const, mood: mood({ ambience: ['crowd', 'crickets'] }) };
    const crowd = (hour: number): number => level(soundPlan({ ...town, hour }), 'murmur');
    expect(crowd(13)).toBeGreaterThan(crowd(6));
    expect(crowd(13)).toBeGreaterThan(crowd(23));
    const crickets = (hour: number): number => level(soundPlan({ ...town, hour }), 'crickets');
    expect(crickets(23)).toBeGreaterThan(crickets(19));
    expect(crickets(19)).toBeGreaterThan(crickets(13));
    for (const phase of DAY_PHASES) expect(['dawn', 'day', 'dusk', 'night']).toContain(phase);
  });

  it('follows the player: water at the bank, voices in the middle, wind on the heights', () => {
    expect(placeGain('stream', { water: 1 })).toBeGreaterThan(placeGain('stream', { water: 0 }) * 3);
    expect(placeGain('shorelife', { water: 0.9 })).toBeGreaterThan(placeGain('shorelife', { water: 0.1 }));
    expect(placeGain('murmur', { settled: 1 })).toBeGreaterThan(placeGain('murmur', { settled: 0 }) * 1.5);
    expect(placeGain('wind', { high: 1, settled: 0 })).toBeGreaterThan(placeGain('wind', { high: 0, settled: 1 }) * 1.5);
    expect(placeGain('wildlife', { settled: 0 })).toBeGreaterThan(placeGain('wildlife', { settled: 1 }));
    // No position, or a bed that does not care, is left alone; nothing is ever boosted far.
    for (const id of ['stream', 'murmur', 'wind', 'hum', 'fire'] as const) {
      expect(placeGain(id, undefined)).toBe(1);
      for (const p of [{ water: 0, settled: 0, high: 0 }, { water: 1, settled: 1, high: 1 }]) {
        expect(placeGain(id, p)).toBeGreaterThan(0.15);
        expect(placeGain(id, p)).toBeLessThanOrEqual(1.4);
      }
    }
    expect(placeGain('hum', { water: 0, settled: 0, high: 0 })).toBe(1);
    expect(placeGain('stream', { settled: 1 })).toBe(1);

    const land: Land = { plaza: { x: 0, z: 0, r: 8 }, bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }, water: [{ x: 50, z: 0, r: 10 }], lo: 0, hi: 20 };
    const centre = placeOf(0, 2, 0, land);
    const bank = placeOf(42, 0, 0, land);
    const peak = placeOf(-55, 20, -55, land);
    expect(bank.water).toBe(1);
    expect(centre.water ?? 0).toBeLessThan(bank.water ?? 0);
    expect(centre.settled).toBe(1);
    expect(peak.settled ?? 1).toBeLessThan(0.3);
    expect(peak.high).toBe(1);
    expect(placeOf(0, 0, 0, { ...land, water: [], lo: 0, hi: 1 })).toEqual({ settled: 1 });
  });

  it('trims the textured beds on a weak machine but keeps the events', () => {
    const full = planFor(spec).beds;
    const trimmed = trimMix(full, 3);
    expect(trimmed.filter((b) => !b.events && !(b.id === 'murmur' && b.variant === 0)).length).toBe(3);
    expect(trimmed.filter((b) => b.events).length).toBe(full.filter((b) => b.events).length);
    const kept = Math.min(...trimmed.filter((b) => !b.events).map((b) => b.level));
    for (const b of full) if (!trimmed.includes(b)) expect(b.level).toBeLessThanOrEqual(kept);
  });
});
