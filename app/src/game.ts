// Game orchestrator: prompt -> compile -> layout -> build -> play.
// Owns the lifecycle of one town at a time and tears everything down before building the next.

import * as THREE from 'three';
import type { WorldSpec, WorldState, NpcSpec, RuleSpec, ThemeId } from './world/spec';
import { makeRng, seedFromPrompt, type Rng } from './world/rng';
import { validateSpec, normalizeSpec } from './world/schema';
import { FIXTURES, nearestTheme } from './world/fixtures';
import { verifyQuest, repairQuest } from './world/verify';
import { createState, applyEvent, type WorldEvent } from './world/state';
import { generateLayout, type TownLayout } from './town/layout';
import { buildTown, type TownObjects } from './town/build';
import type { Viewport } from './engine/renderer';
import { createSky, type SkyRig } from './engine/sky';
import type { Input } from './engine/input';
import { loadKit, type LoadedKit } from './engine/assets';
import { loadCharacterBase, createCharacter, type CharacterRig } from './engine/character';
import { buildNav, type NavWorld, type NavAgent } from './engine/nav';
import { createPlayer, type Player } from './engine/player';
import { planTick, type NpcIntent } from './npc/brain';
import { buildQuestions, sampleAction, localFallback } from './npc/decide';
import { openDialogue, type DialogueSession } from './npc/dialogue';
import { createSpeech, type Speech } from './npc/speech';
import type { Api } from './net/api';
import type { UI, DialogueHandle } from './ui/ui';
import { encodeShare, decodeShare } from './share';

const TICK_SECONDS = 20;
const TALK_DISTANCE = 3.2;

interface NpcRuntime {
  spec: NpcSpec;
  rig: CharacterRig;
  agent: NavAgent;
  place: string;        // where the brain thinks they are or are heading
  targetPlace: string;
  lastReason: string;
  idleUntil: number;
}

interface Town {
  spec: WorldSpec;
  state: WorldState;
  layout: TownLayout;
  objects: TownObjects;
  nav: NavWorld;
  player: Player;
  npcs: Map<string, NpcRuntime>;
  rng: Rng;
  elapsed: number;
  nextTickAt: number;
  dialogue: DialogueSession | null;
  dialogueNpc: string | null;
  handle: DialogueHandle | null;
  verified: ReturnType<typeof verifyQuest>;
}

export interface GameDeps {
  viewport: Viewport;
  input: Input;
  ui: UI;
  api: Api;
}

export class Game {
  private readonly sky: SkyRig;
  private readonly speech: Speech;
  private town: Town | null = null;
  private kit: LoadedKit | null = null;
  private compiling: AbortController | null = null;
  private readonly sessionId = Math.floor(performance.now() * 1000).toString(36) + '-' + Date.now().toString(36);
  private unsubscribe: (() => void)[] = [];

  constructor(private readonly deps: GameDeps) {
    this.sky = createSky(deps.viewport.scene, deps.viewport.renderer);
    this.speech = createSpeech();
    const { input } = deps;
    this.unsubscribe.push(
      input.onKey('KeyE', () => this.tryTalk()),
      input.onKey('KeyR', () => this.openRules()),
      input.onKey('Slash', () => this.showWhy()),
      input.onKey('Escape', () => this.closeDialogue()),
    );
    deps.ui.onHud({
      rules: () => this.openRules(),
      why: () => this.showWhy(),
      share: () => void this.share().then((url) => this.copyLink(url)),
    });
  }

  private async copyLink(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.deps.ui.toast('Share link copied. The whole town travels in the URL.');
    } catch {
      this.deps.ui.toast(url);
    }
  }

  /** Entry point: show the landing card, or load a shared town from the URL hash. */
  async start(): Promise<void> {
    const shared = location.hash.length > 1 ? await this.loadShared(location.hash.slice(1)) : null;
    if (shared) {
      await this.playSpec(shared);
      return;
    }
    this.showLanding();
  }

  private showLanding(): void {
    const examples = [
      FIXTURES.western.prompt,
      FIXTURES.medieval.prompt,
      FIXTURES.scifi.prompt,
      FIXTURES.modern.prompt,
    ];
    this.deps.ui.showLanding(examples, (prompt) => void this.buildFromPrompt(prompt));
  }

  private async loadShared(hash: string): Promise<WorldSpec | null> {
    const local = decodeShare(hash);
    if (local) return local;
    if (/^[A-Za-z0-9_-]{8,12}$/.test(hash)) {
      const r = await this.deps.api.load(hash);
      if (r.ok) {
        const v = validateSpec(r.spec);
        if (v.ok) return normalizeSpec(v.value);
      }
    }
    return null;
  }

  async buildFromPrompt(prompt: string): Promise<void> {
    const { ui, api } = this.deps;
    this.compiling?.abort();
    const ctl = new AbortController();
    this.compiling = ctl;
    const seed = seedFromPrompt(prompt);
    const theme = nearestTheme(prompt);

    // Start the heavy loads now so the town appears the moment the spec lands.
    const kitPromise = this.ensureKit(theme);
    const charPromise = Promise.all((['knight', 'barbarian', 'mage', 'rogue', 'rogue_hooded'] as const).map(loadCharacterBase));
    ui.showCompiling('Thinking about your town…');

    const result = await api.compile(prompt, seed, (partial) => ui.showCompiling('Writing the world…', partial), ctl.signal);
    if (ctl.signal.aborted) return;
    let spec: WorldSpec;
    if (!result.ok) {
      if (result.error === 'resting') {
        ui.toast('The town is resting. Showing a saved town instead.', 'warn');
      } else {
        ui.toast(`Compile failed (${result.error}). Showing a saved town instead.`, 'warn');
      }
      spec = { ...FIXTURES[theme], prompt, seed };
    } else {
      const v = validateSpec(result.spec);
      if (!v.ok) {
        ui.toast('The model returned an invalid world; repaired with a saved town.', 'warn');
        spec = { ...FIXTURES[theme], prompt, seed };
      } else {
        spec = v.value;
      }
    }
    spec = normalizeSpec({ ...spec, prompt, seed });
    ui.showCompiling('Laying out streets…');
    await Promise.all([kitPromise, charPromise]);
    await this.playSpec(spec);
  }

  private async ensureKit(theme: ThemeId): Promise<LoadedKit> {
    if (this.kit && this.kit.manifest.theme === theme) return this.kit;
    const kit = await loadKit(theme);
    this.kit = kit;
    return kit;
  }

  async playSpec(input: WorldSpec): Promise<void> {
    const { ui, viewport } = this.deps;
    this.teardown();
    const repaired = repairQuest(normalizeSpec(input));
    const verified = verifyQuest(repaired);
    const spec = repaired;
    const kit = await this.ensureKit(spec.theme);
    await Promise.all(spec.npcs.map((n) => loadCharacterBase(n.appearance.base)));

    const rng = makeRng(spec.seed, 'game');
    const layout = generateLayout(spec);
    const objects = buildTown(layout, spec, kit, viewport.scene);
    const ground = objects.statics.find((m) => m.name === 'ground') ?? objects.statics[0];
    if (!ground) throw new Error('town has no ground mesh');
    const nav = await buildNav(objects.statics, ground);

    const playerRig = createCharacter('ranger');
    playerRig.setPalette(0, spec.theme);
    viewport.scene.add(playerRig.root);
    const player = createPlayer(playerRig, nav, viewport.camera, this.deps.input, objects.statics);
    player.teleport(new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z), layout.spawn.rotY);

    const state = createState(spec);
    const npcs = new Map<string, NpcRuntime>();
    for (const n of spec.npcs) {
      const rig = createCharacter(n.appearance.base);
      rig.setPalette(n.appearance.palette, spec.theme);
      viewport.scene.add(rig.root);
      const start = this.placeToPoint(layout, objects, state.npcPlaces[n.id] ?? n.home, nav, rng);
      const agent = nav.addAgent(start, { radius: 0.4, speed: 1.6 + rng.range(-0.2, 0.3) });
      rig.root.position.copy(start);
      npcs.set(n.id, { spec: n, rig, agent, place: state.npcPlaces[n.id] ?? n.home, targetPlace: '', lastReason: 'starting the day', idleUntil: 0 });
    }

    this.town = { spec, state, layout, objects, nav, player, npcs, rng, elapsed: 0, nextTickAt: 2, dialogue: null, dialogueNpc: null, handle: null, verified };
    this.sky.setPreset(spec.palette.sky, spec.palette.fog);
    this.sky.setHour(state.hour);
    document.documentElement.style.setProperty('--accent', spec.palette.accent);
    ui.showHud(spec);
    ui.setBadge(verified.winnable ? `quest verified · ${verified.order.length} steps` : 'quest unverified');
    ui.setObjective(this.currentObjective());
    ui.toast(verified.winnable ? `Quest verified: ${verified.order.length} steps, ${spec.quest.endings.length} endings` : 'Quest could not be fully verified', verified.winnable ? 'info' : 'warn');
    this.pushLog('world', `${spec.title} wakes at ${this.fmtHour(state.hour)}`);
    history.replaceState(null, '', '#' + encodeShare(spec));
  }

  /** Called by main.ts every frame. */
  update(dt: number): void {
    const t = this.town;
    if (!t) return;
    t.elapsed += dt;
    const dtHours = (dt * t.spec.time.minutesPerRealSecond) / 60;
    const scaleRule = t.state.rules.find((r) => r.effect.type === 'time_scale');
    const minutesPerSecond = scaleRule && scaleRule.effect.type === 'time_scale' ? scaleRule.effect.minutesPerRealSecond : t.spec.time.minutesPerRealSecond;
    const res = applyEvent(t.spec, t.state, { type: 'tick', dtHours: (dt * minutesPerSecond) / 60 });
    void dtHours;
    t.state = res.state;
    this.sky.setHour(t.state.hour);
    this.deps.ui.setClock(t.state.hour, t.state.day);

    t.player.update(dt);
    t.nav.update(dt);

    for (const n of t.npcs.values()) {
      const p = n.agent.position();
      n.rig.root.position.copy(p);
      const v = n.agent.velocity();
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0.1) {
        n.rig.root.rotation.y = Math.atan2(v.x, v.z);
        n.rig.play(speed > 2.5 ? 'run' : 'walk');
      } else if (t.dialogueNpc === n.spec.id) {
        n.rig.play('talk');
      } else {
        n.rig.play('idle');
      }
      n.rig.lookAt(t.dialogueNpc === n.spec.id || p.distanceTo(t.player.position) < 4 ? t.player.position.clone().setY(1.6) : null);
      n.rig.update(dt);
    }
    t.player.rig.update(dt);

    const near = this.nearestNpcId();
    this.deps.ui.setPrompt(near && !t.dialogue ? `E · talk to ${t.npcs.get(near)?.spec.name ?? ''}` : null);

    if (t.elapsed >= t.nextTickAt && !t.dialogue) {
      t.nextTickAt = t.elapsed + TICK_SECONDS;
      void this.tick();
    }
    this.checkVisits();
  }

  private playerPlace(): string {
    const t = this.town;
    if (!t) return 'street';
    let best: { id: string; d: number } | null = null;
    for (const [id, door] of t.objects.doors) {
      const d = door.distanceTo(t.player.position);
      if (d < 4 && (!best || d < best.d)) best = { id, d };
    }
    return best ? best.id : 'street';
  }

  private nearestNpcId(): string | null {
    const t = this.town;
    if (!t) return null;
    const list = [...t.npcs.values()].map((n) => ({ id: n.spec.id, pos: n.agent.position() }));
    return t.player.nearestNpc(list, TALK_DISTANCE);
  }

  private async tick(): Promise<void> {
    const t = this.town;
    if (!t) return;
    t.state = { ...t.state, flags: { ...t.state.flags, player_place: this.playerPlace() } };
    const intents = planTick(t.spec, t.state);
    const near = this.nearestNpcId();
    const questions = buildQuestions(t.spec, t.state, intents, near);
    const stateSummary = this.summarizeForDecisions(intents);
    let probs: number[][] = [];
    try {
      const r = await this.deps.api.tick({ sessionId: this.sessionId, stateSummary, questions: questions.map((q) => ({ npcId: q.npcId, question: q.question, options: q.options.map((o) => o.label) })) });
      if (r.ok) probs = r.probs;
    } catch {
      probs = [];
    }
    if (this.town !== t) return; // town changed while waiting
    questions.forEach((q, i) => {
      const n = t.npcs.get(q.npcId);
      if (!n) return;
      const p = probs[i];
      const action = p && p.length === q.options.length ? sampleAction(p, q.options, n.spec, t.rng) : localFallback(q, n.spec, t.rng);
      const intent = intents.find((it) => it.npcId === q.npcId);
      this.applyAction(n, action.id, action.target, action.reason, intent);
    });
  }

  private applyAction(n: NpcRuntime, id: string, target: string | undefined, reason: string, intent: NpcIntent | undefined): void {
    const t = this.town;
    if (!t) return;
    let place = n.place;
    switch (id) {
      case 'continue':
      case 'work':
        place = intent?.place ?? n.spec.work;
        break;
      case 'go_to':
        place = target ?? place;
        break;
      case 'talk_to': {
        const other = target ? t.npcs.get(target) : undefined;
        if (other) place = other.place;
        break;
      }
      case 'follow_player':
      case 'investigate':
        n.agent.setTarget(t.nav.randomPointNear(t.player.position, 2.5));
        n.lastReason = reason;
        this.pushLog(n.spec.id, `${n.spec.name} heads toward you: ${reason}`);
        return;
      case 'flee':
        place = n.spec.home;
        break;
      case 'idle':
      default:
        n.agent.setTarget(t.nav.randomPointNear(n.agent.position(), 3));
        n.lastReason = reason;
        return;
    }
    if (place !== n.targetPlace) {
      n.targetPlace = place;
      const dest = this.placeToPoint(t.layout, t.objects, place, t.nav, t.rng);
      n.agent.setTarget(dest);
      n.lastReason = reason;
      this.pushLog(n.spec.id, `${n.spec.name} → ${this.placeLabel(place)}: ${reason}`);
      n.place = place;
      t.state = applyEvent(t.spec, t.state, { type: 'npc_moved', npcId: n.spec.id, place }).state;
    }
  }

  private placeToPoint(layout: TownLayout, objects: TownObjects, place: string, nav: NavWorld, rng: Rng): THREE.Vector3 {
    if (place === 'plaza') return nav.randomPointNear(new THREE.Vector3(layout.plaza.x, 0, layout.plaza.z), layout.plaza.r * 0.7);
    if (place === 'street') {
      const w = rng.pick(layout.walkable);
      return nav.nearest(new THREE.Vector3(w.x, 0, w.z));
    }
    const door = objects.doors.get(place);
    if (door) return nav.randomPointNear(door, 1.2);
    const w = rng.pick(layout.walkable);
    return nav.nearest(new THREE.Vector3(w.x, 0, w.z));
  }

  private placeLabel(place: string): string {
    const b = this.town?.spec.buildings.find((x) => x.id === place);
    return b ? b.label : place;
  }

  private summarizeForDecisions(intents: NpcIntent[]): string {
    const t = this.town!;
    const rules = t.state.rules.map((r) => `- ${r.text}`).join('\n');
    const who = intents.map((i) => `${i.npcId}: at ${i.place}, ${i.activity}`).join('; ');
    return `${t.spec.title}. ${t.spec.era}. Day ${t.state.day}, ${this.fmtHour(t.state.hour)}.\nRules:\n${rules || '- none'}\nPeople: ${who}`;
  }

  // ---- dialogue -------------------------------------------------------------------------------

  private tryTalk(): void {
    const t = this.town;
    if (!t || t.dialogue) return;
    const id = this.nearestNpcId();
    if (!id) return;
    const n = t.npcs.get(id);
    if (!n) return;
    n.agent.stop();
    const session = openDialogue(t.spec, t.state, id, this.deps.api);
    t.dialogue = session;
    t.dialogueNpc = id;
    const handle = this.deps.ui.openDialogue(n.spec, (text) => void this.send(text), () => this.closeDialogue());
    t.handle = handle;
    const res = applyEvent(t.spec, t.state, { type: 'talk', npcId: id });
    t.state = res.state;
    this.afterEvent(res.completed);
    this.offerItemActions(n, handle);
    void session.say('', (partial) => handle.stream(partial)).then((r) => {
      if (t.handle !== handle) return;
      handle.done();
      this.speech.speak(r.text, n.spec.voice, n.spec.name);
    });
  }

  private async send(text: string): Promise<void> {
    const t = this.town;
    if (!t || !t.dialogue || !t.dialogueNpc) return;
    const n = t.npcs.get(t.dialogueNpc);
    const handle = t.handle;
    if (!n || !handle) return;
    const r = await t.dialogue.say(text, (partial) => handle.stream(partial));
    if (t.handle !== handle) return;
    handle.done();
    this.speech.speak(r.text, n.spec.voice, n.spec.name);
    // A confront step completes on any exchange once its requirements are met.
    const res = applyEvent(t.spec, t.state, { type: 'talk', npcId: n.spec.id });
    t.state = res.state;
    this.afterEvent(res.completed);
    this.offerItemActions(n, handle);
  }

  private offerItemActions(n: NpcRuntime, h: DialogueHandle): void {
    const t = this.town;
    if (!t) return;
    h.clearActions();
    // Items this NPC holds that an unlocked fetch step wants.
    for (const stepId of t.state.unlockedSteps) {
      const step = t.spec.quest.steps.find((s) => s.id === stepId);
      if (!step || t.state.completedSteps.includes(stepId)) continue;
      if (step.kind === 'fetch' && t.state.itemHolders[step.target] === n.spec.id) {
        const item = t.spec.items.find((i) => i.id === step.target);
        h.addAction(`Take ${item?.name ?? step.target}`, () => {
          const res = applyEvent(t.spec, t.state, { type: 'pickup', item: step.target });
          t.state = res.state;
          this.afterEvent(res.completed);
        });
      }
      if (step.kind === 'deliver' && step.target === n.spec.id && step.item && t.state.inventory.includes(step.item)) {
        const item = t.spec.items.find((i) => i.id === step.item);
        h.addAction(`Give ${item?.name ?? step.item}`, () => {
          const res = applyEvent(t.spec, t.state, { type: 'give', item: step.item!, to: n.spec.id });
          t.state = res.state;
          this.afterEvent(res.completed);
        });
      }
      if (step.kind === 'choose' && step.target === n.spec.id && step.choices) {
        step.choices.forEach((c, idx) => h.addAction(c.label, () => {
          const res = applyEvent(t.spec, t.state, { type: 'choose', stepId: step.id, choice: idx });
          t.state = res.state;
          this.afterEvent(res.completed);
        }));
      }
    }
  }

  private closeDialogue(): void {
    const t = this.town;
    if (!t || !t.dialogue) return;
    t.dialogue.close();
    t.dialogue = null;
    t.dialogueNpc = null;
    t.handle = null;
    this.speech.cancel();
    t.nextTickAt = Math.min(t.nextTickAt, t.elapsed + 2);
  }

  private checkVisits(): void {
    const t = this.town;
    if (!t) return;
    for (const stepId of t.state.unlockedSteps) {
      if (t.state.completedSteps.includes(stepId)) continue;
      const step = t.spec.quest.steps.find((s) => s.id === stepId);
      if (!step || step.kind !== 'visit') continue;
      const door = t.objects.doors.get(step.target);
      if (door && door.distanceTo(t.player.position) < 2.5) {
        const res = applyEvent(t.spec, t.state, { type: 'visit', buildingId: step.target });
        t.state = res.state;
        this.afterEvent(res.completed);
      }
    }
  }

  private afterEvent(completed: string[]): void {
    const t = this.town;
    if (!t) return;
    for (const id of completed) {
      const step = t.spec.quest.steps.find((s) => s.id === id);
      if (step) this.deps.ui.toast(`✓ ${step.objective}`);
      const ending = t.spec.quest.endings.find((e) => e.stepId === id);
      if (ending) this.deps.ui.toast(`Ending: ${ending.label}`, 'info');
    }
    this.deps.ui.setObjective(this.currentObjective());
  }

  private currentObjective(): string {
    const t = this.town;
    if (!t) return '';
    const open = t.state.unlockedSteps.filter((id) => !t.state.completedSteps.includes(id));
    const step = t.spec.quest.steps.find((s) => s.id === open[0]);
    if (step) return step.objective;
    const done = t.spec.quest.endings.find((e) => t.state.completedSteps.includes(e.stepId));
    return done ? `${t.spec.quest.title} — ${done.label}` : t.spec.quest.hook;
  }

  // ---- rules ----------------------------------------------------------------------------------

  private openRules(): void {
    const t = this.town;
    if (!t) return;
    this.deps.ui.openRules(
      t.state.rules,
      (text) => void this.addRule(text),
      (id) => {
        t.state = applyEvent(t.spec, t.state, { type: 'rule_remove', ruleId: id }).state;
        this.pushLog('world', `rule removed: ${id}`);
        this.deps.ui.openRules(t.state.rules, (x) => void this.addRule(x), (y) => this.removeRule(y));
        t.nextTickAt = t.elapsed + 1;
      },
    );
  }

  private removeRule(id: string): void {
    const t = this.town;
    if (!t) return;
    t.state = applyEvent(t.spec, t.state, { type: 'rule_remove', ruleId: id }).state;
    t.nextTickAt = t.elapsed + 1;
  }

  private async addRule(text: string): Promise<void> {
    const t = this.town;
    if (!t) return;
    const summary = [
      'buildings: ' + t.spec.buildings.map((b) => `${b.id}(${b.role})`).join(', '),
      'npcs: ' + t.spec.npcs.map((n) => `${n.id}(${n.role})`).join(', '),
      'items: ' + t.spec.items.map((i) => i.id).join(', '),
      'rules: ' + t.state.rules.map((r) => r.text).join(' | '),
    ].join('\n');
    const r = await this.deps.api.patchRules({ sessionId: this.sessionId, ruleText: text, summary });
    if (this.town !== t) return;
    if (!r.ok) {
      this.deps.ui.toast(`Could not interpret that rule (${r.error})`, 'warn');
      return;
    }
    for (const rule of r.rules) {
      const stamped: RuleSpec = { ...rule, source: 'player' };
      const res = applyEvent(t.spec, t.state, { type: 'rule_add', rule: stamped });
      t.state = res.state;
      if (stamped.effect.type === 'weather') this.sky.setPreset(stamped.effect.sky, stamped.effect.fog);
      this.pushLog('world', `new rule: ${stamped.text}`);
    }
    this.deps.ui.toast(`${r.rules.length} rule${r.rules.length === 1 ? '' : 's'} now in force`);
    this.deps.ui.openRules(t.state.rules, (x) => void this.addRule(x), (y) => this.removeRule(y));
    t.nextTickAt = t.elapsed + 0.5;
  }

  // ---- why, share, misc -----------------------------------------------------------------------

  private showWhy(): void {
    const t = this.town;
    if (!t) return;
    const lines = t.state.log.slice(-12).map((l) => `${this.fmtHour(l.t)}  ${l.what}`);
    this.deps.ui.showWhy(lines.length ? lines : ['Nothing has happened yet.']);
  }

  async share(): Promise<string> {
    const t = this.town;
    if (!t) return location.href;
    const hash = encodeShare(t.spec);
    if (hash.length < 4000) {
      history.replaceState(null, '', '#' + hash);
      return location.href;
    }
    const r = await this.deps.api.share(t.spec);
    if (r.ok) {
      history.replaceState(null, '', '#' + r.id);
    }
    return location.href;
  }

  private pushLog(who: string, what: string): void {
    const t = this.town;
    if (!t) return;
    const log = [...t.state.log, { t: t.state.hour, who, what }].slice(-60);
    t.state = { ...t.state, log };
  }

  private fmtHour(h: number): string {
    const hh = Math.floor(h) % 24;
    const mm = Math.floor((h % 1) * 60);
    return `${hh}:${mm.toString().padStart(2, '0')}`;
  }

  private teardown(): void {
    const t = this.town;
    if (!t) return;
    this.closeDialogue();
    for (const n of t.npcs.values()) {
      n.agent.remove();
      this.deps.viewport.scene.remove(n.rig.root);
      n.rig.dispose();
    }
    this.deps.viewport.scene.remove(t.player.rig.root);
    t.player.dispose();
    t.player.rig.dispose();
    t.nav.dispose();
    t.objects.dispose();
    this.town = null;
  }

  dispose(): void {
    this.teardown();
    this.unsubscribe.forEach((u) => u());
    this.sky.dispose();
  }
}

export function applyEvents(spec: WorldSpec, state: WorldState, events: WorldEvent[]): WorldState {
  return events.reduce((s, ev) => applyEvent(spec, s, ev).state, state);
}
