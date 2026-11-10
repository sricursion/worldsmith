// People. A figure is the biped body plan dressed for a role and a world: realistic adult proportions,
// clothing that reads at a distance, and the same interface the clip-driven character rig offers, so the
// game can swap any person (the player included) onto these bodies.
import { AnimationMixer } from 'three';
import type { Vector3 } from 'three';
import type { FolkSpec, ThemeId } from '../../world/spec';
import { buildBody } from '../../world/bodies';
import type { BodyDials, BodyPlan } from '../../world/bodies';
import { makeRng } from '../../world/rng';
import type { CharacterClip, CharacterRig } from '../character';
import { createBody } from './animate';
import type { BodyRig } from './animate';
import type { BodyColors } from './geometry';

export interface FigureOptions { folk?: FolkSpec; role: string; theme: ThemeId; seed: number; quality?: 0 | 1 | 2 }
export interface FigureRig extends CharacterRig {
  /** 0 silent .. 1 speaking; a negative amount hands control back to play('talk'). */
  setTalking(amount: number): void;
  body: BodyRig;
}

/** What a role does for a living, as far as dress is concerned. Matched on the free-text role. */
const TRADES: readonly { kind: 'arms' | 'robe' | 'work' | 'gentry' | 'travel' | 'crew'; words: RegExp }[] = [
  { kind: 'arms', words: /guard|soldier|knight|sheriff|marshal|deputy|warrior|captain|watch|sentinel|sentry|trooper|paladin|warden|enforcer|officer|police/ },
  { kind: 'robe', words: /priest|monk|mage|wizard|witch|sage|elder|oracle|druid|shaman|scholar|nun|seer|abbot|cleric|librarian|mystic|keeper|preacher/ },
  { kind: 'work', words: /smith|cook|baker|bartender|barkeep|butcher|mechanic|engineer|farmer|miner|worker|tanner|brewer|carpenter|technician|innkeeper|fisher|mason|potter|weaver|stable|labou?rer|tinker|dock/ },
  { kind: 'gentry', words: /merchant|banker|mayor|noble|doctor|lord|lady|judge|clerk|trader|official|gambler|undertaker|lawyer|governor|chief|owner|teacher|manager|director/ },
  { kind: 'travel', words: /drifter|courier|travel|pilgrim|scout|hunter|peddler|porter|ranger|nomad|wanderer|prospector|explorer|trapper|smuggler|messenger/ },
  { kind: 'crew', words: /pilot|astronaut|scientist|diver|cosmonaut|researcher|medic|operator|android|robot|drone|unit/ },
];

const SKIN = ['#f0c8a4', '#e0ac85', '#c98d62', '#a56c43', '#7d4f2e', '#553420'] as const;
const HAIR = ['#17120e', '#2b1d14', '#4a3222', '#6b4a2b', '#8a6a3c', '#b89a62', '#8c8a86', '#5a2e1c'] as const;
const CLOTH: Record<ThemeId, readonly string[]> = {
  western: ['#6f5a44', '#8a7a62', '#4f5560', '#7a4a38', '#9a8f7a', '#3f4638'],
  medieval: ['#5e5345', '#6e4a3a', '#48553f', '#7d7462', '#3f4a5a', '#8a6f4a'],
  scifi: ['#5a6068', '#3f4850', '#7a7f84', '#4a5a5e', '#8a8478', '#55504a'],
  modern: ['#3a4250', '#5a5a5c', '#6e665a', '#44504a', '#7a6a5e', '#2f3238'],
};
const LEATHER = ['#3a2a1e', '#4a3828', '#2a2622', '#5a4630', '#33302c'] as const;

/** Dials and colours for one person. Deterministic from the options; exported for tests and previews. */
export function planFigure(opts: FigureOptions): { dials: BodyDials; size: number; colors: BodyColors } {
  const rng = makeRng(opts.seed, 'figure');
  const folk = opts.folk;
  const role = opts.role.toLowerCase();
  const feats = new Set<string>(folk?.features ?? []);
  const trade = TRADES.find((t) => t.words.test(role))?.kind ?? 'common';
  const strange = feats.has('snout') || feats.has('visor') || feats.has('mask') || feats.has('antenna');
  const unclothed = folk !== undefined && folk.cloth.length === 0;

  let outfit = 'tunic';
  if (unclothed) outfit = 'bare';
  else if (trade === 'arms') outfit = opts.theme === 'medieval' || opts.theme === 'scifi' || feats.has('armor') ? 'armor' : 'coat';
  else if (trade === 'robe') outfit = 'robe';
  else if (trade === 'work') outfit = 'work';
  else if (trade === 'gentry') outfit = 'coat';
  else if (trade === 'crew') outfit = opts.theme === 'scifi' ? 'suit' : 'coat';
  else if (opts.theme === 'modern') outfit = rng.chance(0.5) ? 'coat' : 'tunic';
  else if (opts.theme === 'scifi') outfit = feats.has('visor') && feats.has('pack') ? 'suit' : rng.chance(0.4) ? 'coat' : 'tunic';
  else if (feats.has('cloak') && rng.chance(0.3)) outfit = 'robe';

  const dials: BodyDials = {
    outfit,
    bulk: Math.min(1, Math.max(0, (folk?.bulk ?? 0.4) + rng.range(-0.08, 0.1) + (trade === 'arms' || trade === 'work' ? 0.06 : 0))),
    shoulders: rng.range(0.38, 0.66),
    hips: rng.range(0.4, 0.62),
    limbs: rng.range(0.44, 0.58),
    arms: rng.range(0.45, 0.56),
    posture: trade === 'robe' ? rng.range(0.15, 0.4) : rng.range(0.04, 0.2),
    head_scale: Math.min(1.9, Math.max(0.6, folk?.head ?? 1)),
    hair: strange || unclothed ? 0 : rng.chance(0.1) ? 0 : rng.range(0.3, 1),
  };
  for (const f of feats) if (f !== 'hat') dials[f] = 1;
  if (trade === 'travel') dials['pack'] = 1;
  if (trade === 'robe' && rng.chance(0.4)) dials['hood'] = 1;
  const hooded = dials['hood'] === 1;
  if (!hooded && outfit !== 'suit' && outfit !== 'bare') {
    if (outfit === 'armor' && rng.chance(0.7)) dials['hat'] = 'helm';
    else if (feats.has('hat') || (opts.theme === 'western' && rng.chance(0.65))) dials['hat'] = trade === 'work' && rng.chance(0.5) ? 'cap' : 'brim';
    else if (trade === 'work' && rng.chance(0.3)) dials['hat'] = 'cap';
  }
  if (trade === 'arms' && opts.theme === 'medieval') dials['tool'] = rng.chance(0.6) ? 'staff' : 'blade';
  else if (trade === 'robe') dials['tool'] = rng.chance(0.45) ? 'staff' : rng.chance(0.4) ? 'book' : 'none';
  else if (trade === 'work' && rng.chance(0.5)) dials['tool'] = 'tool';
  else if (/watch|lamp|miner|night/.test(role)) dials['tool'] = 'lamp';

  const pick = (xs: readonly string[] | undefined, fallback: readonly string[]): string => rng.pick(xs !== undefined && xs.length > 0 ? xs : fallback);
  const skin = pick(folk?.skin, SKIN);
  const cloth = pick(folk?.cloth, CLOTH[opts.theme]);
  let cloth2 = pick(folk?.cloth, CLOTH[opts.theme]);
  if (cloth2 === cloth) cloth2 = pick(folk?.trim, LEATHER);
  const trim = pick(folk?.trim, LEATHER);
  const colors: BodyColors = {
    body: skin, accent: trim, glow: feats.has('glow_eyes') || feats.has('visor') ? trim : '#ffcf90',
    skin, cloth, cloth2, trim, hair: strange ? trim : rng.pick(HAIR), dark: rng.pick(LEATHER),
  };
  const h = folk?.height ?? 1.72;
  return { dials, size: Math.min(3.2, Math.max(0.45, h * rng.range(0.95, 1.06))), colors };
}

/** Builds the pure plan of a person, for tests and for callers that want the proportions. */
export function figurePlan(opts: FigureOptions): BodyPlan {
  const p = planFigure(opts);
  return buildBody('biped', p.dials, p.size, opts.seed);
}

export function createFigure(opts: FigureOptions): FigureRig {
  const p = planFigure(opts);
  const plan = buildBody('biped', p.dials, p.size, opts.seed);
  const body = createBody(plan, p.colors, { quality: opts.quality ?? 2, seed: opts.seed, smoothTurn: true, shadows: true });
  const mixer = new AnimationMixer(body.root);
  let clip: CharacterClip = 'idle';
  let manualTalk = -1;
  let disposed = false;
  const apply = (): void => {
    body.setMode(clip === 'sit' ? 'sit' : 'ground');
    body.setGesture(clip === 'wave' ? 'wave' : clip === 'cheer' ? 'cheer' : clip === 'use' ? 'use' : clip === 'gesture' ? 'gesture' : 'none');
    body.setTalking(manualTalk >= 0 ? manualTalk : clip === 'talk' ? 1 : 0);
  };
  return {
    root: body.root,
    mixer,
    body,
    play(name) {
      if (disposed) return;
      clip = name;
      apply();
    },
    setPalette: () => undefined,
    lookAt(target: Vector3 | null) {
      body.lookAt(target);
    },
    setTalking(amount) {
      manualTalk = Number.isFinite(amount) && amount >= 0 ? Math.min(1, amount) : -1;
      apply();
    },
    update(dt) {
      body.update(dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(body.root);
      body.dispose();
    },
  };
}
