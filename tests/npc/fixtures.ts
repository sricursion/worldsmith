import type { NpcSpec, RuleSpec, WorldSpec, WorldState } from '../../app/src/world/spec';

export function mkNpc(over: Partial<NpcSpec> = {}): NpcSpec {
  return {
    id: 'cole',
    name: 'Cole',
    role: 'sheriff',
    persona: 'Weary and fair.',
    knowledge: ['The bank was robbed.'],
    secrets: ['Cole owes the saloon money.', 'Cole saw the thief.'],
    home: 'house_1',
    work: 'jail_1',
    schedule: [
      { hour: 6, place: 'house_1', activity: 'eat' },
      { hour: 8, place: 'jail_1', activity: 'work' },
      { hour: 18, place: 'saloon_1', activity: 'drink' },
      { hour: 22, place: 'house_1', activity: 'sleep' },
    ],
    relationships: [{ npcId: 'mae', stance: 'friend' }],
    appearance: { base: 'knight', palette: 0 },
    temperament: { tau: 1, bias: {} },
    voice: { pitch: 1, rate: 1 },
    mood: 'calm',
    ...over,
  };
}

export function mkSpec(npcs: NpcSpec[] = [mkNpc(), mkNpc({ id: 'mae', name: 'Mae', role: 'barkeep', home: 'house_2', work: 'saloon_1' })]): WorldSpec {
  return {
    version: 1,
    seed: 42,
    prompt: 'a dusty town',
    title: 'Dry Gulch',
    tagline: 'Trouble rides in.',
    theme: 'western',
    era: '1874',
    palette: { ground: '#caa', accent: '#a52', sky: 'day', fog: 0.1 },
    time: { startHour: 8, minutesPerRealSecond: 1 },
    buildings: [
      { id: 'house_1', role: 'house', label: 'Cole House', size: 'small' },
      { id: 'house_2', role: 'house', label: 'Mae House', size: 'small' },
      { id: 'jail_1', role: 'jail', label: 'The Jail', size: 'medium' },
      { id: 'saloon_1', role: 'saloon', label: 'The Dusty Spur', size: 'large' },
    ],
    npcs,
    items: [],
    quest: {
      id: 'q',
      title: 'Q',
      hook: 'h',
      giver: 'cole',
      steps: [
        { id: 's1', kind: 'talk', target: 'cole', requires: [], objective: 'Speak to Cole', beat: 'Cole asks for help.' },
        { id: 's2', kind: 'talk', target: 'mae', requires: ['s1'], objective: 'Speak to Mae', beat: 'Mae knows.' },
        { id: 's3', kind: 'talk', target: 'cole', requires: ['s1'], objective: 'Report back', beat: 'Done.' },
      ],
      endings: [{ stepId: 's3', label: 'End', tone: 'good' }],
    },
    rules: [],
    lexicon: ['two-bits'],
  };
}

export function mkState(over: Partial<WorldState> = {}): WorldState {
  return {
    hour: 9,
    day: 1,
    completedSteps: [],
    unlockedSteps: ['s1'],
    inventory: [],
    itemHolders: {},
    npcMoods: {},
    npcPlaces: { cole: 'jail_1', mae: 'saloon_1' },
    flags: {},
    rules: [],
    log: [],
    ...over,
  };
}

export function rule(id: string, effect: RuleSpec['effect'], text = id): RuleSpec {
  return { id, text, effect, source: 'player' };
}
