// Game orchestrator: prompt -> compile -> layout -> build -> play.
// Owns the lifecycle of one town at a time and tears everything down before building the next.

import * as THREE from 'three';
import type { WorldSpec, WorldState, NpcSpec, RuleSpec, ThemeId, SkyPreset } from './world/spec';
import { makeRng, seedFromPrompt, type Rng } from './world/rng';
import { validateSpec, normalizeSpec } from './world/schema';
import { coerceSpec, explainInvalid, lookSpec } from './world/coerce';
import { FIXTURES, nearestTheme } from './world/fixtures';
import { verifyQuest, repairQuest } from './world/verify';
import { createState, applyEvent, type WorldEvent } from './world/state';
import { generateLayout, type TownLayout } from './town/layout';
import { buildTown, type TownObjects } from './town/build';
import type { Viewport } from './engine/renderer';
import { createSky, addPracticalLight, type SkyRig } from './engine/sky';
import { createAtmosphere, type Atmosphere } from './engine/atmosphere';
import { createAudio, type AudioRig } from './engine/audio';
import { createLife } from './engine/life';
import { setSurfaceDefaults, setWindowGlow } from './town/surfaces';
import { updateScatter, WIND } from './town/scatter';
import type { Input } from './engine/input';
import { loadKit, type LoadedKit } from './engine/assets';
import type { CharacterRig } from './engine/character';
import { createFigure, disposeBodyCache } from './engine/bodies';
import { createCreatures } from './engine/creatures';
import { createSkyFeatures } from './engine/skyfeatures';
import { hash32 } from './world/rng';
import { buildNav, type NavWorld, type NavAgent } from './engine/nav';
import { createPlayer, type Player } from './engine/player';
import { loadLandmark, pollLandmark } from './engine/landmark';
import { planTick, type NpcIntent } from './npc/brain';
import { buildQuestions, sampleAction, localFallback } from './npc/decide';
import { openDialogue, type DialogueSession } from './npc/dialogue';
import { createSpeech, type Speech } from './npc/speech';
import type { Api } from './net/api';
import type { UI, DialogueHandle, SoundSettings } from './ui/ui';
import { encodeShare, decodeShare } from './share';

const TICK_SECONDS = 20;
const TALK_DISTANCE = 3.2;
/** People are built from the world's own folk body plan; talking is driven on the figure itself. */
type Person = CharacterRig & { setTalking?(amount: number): void };
const NAV_MARGIN = 18; // metres of walkable ground around the town bounds

interface NpcRuntime {
  spec: NpcSpec;
  rig: Person;
  agent: NavAgent;
  place: string;        // where the brain thinks they are or are heading
  targetPlace: string;
  lastReason: string;
}

interface Town {
  spec: WorldSpec;
  state: WorldState;
  layout: TownLayout;
  objects: TownObjects;
  nav: NavWorld;
  navGround: THREE.Mesh;
  life: { update(dt: number, focus: THREE.Vector3, hour: number): void; dispose(): void } | null;
  creatures: ReturnType<typeof createCreatures> | null;
  skyFeatures: ReturnType<typeof createSkyFeatures> | null;
  lightRemovers: (() => void)[];
  player: Player;
  npcs: Map<string, NpcRuntime>;
  rng: Rng;
  elapsed: number;
  nextTickAt: number;
  tickInFlight: boolean;
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

/** Turns transport and model error codes into one line a player can act on. */
export function friendlyError(code: string): string {
  if (code === 'resting' || code === 'rate_limited') return 'The town is resting for a moment';
  if (code === 'refusal') return 'That prompt could not be built as written';
  if (code === 'timeout' || code === 'network' || code === 'stream_ended' || code === 'upstream' || /^http_5/.test(code)) {
    return 'The town forge could not be reached';
  }
  if (code === 'bad_spec' || code === 'invalid_spec_json' || code === 'truncated') return 'The world came back malformed';
  return 'Something went wrong';
}

export class Game {
  private readonly sky: SkyRig;
  private readonly speech: Speech;
  private readonly atmosphere: Atmosphere;
  private readonly audio: AudioRig;
  private town: Town | null = null;
  private kit: LoadedKit | null = null;
  private compiling: AbortController | null = null;
  private readonly sessionId = Math.floor(performance.now() * 1000).toString(36) + '-' + Date.now().toString(36);
  private unsubscribe: (() => void)[] = [];

  constructor(private readonly deps: GameDeps) {
    this.sky = createSky(deps.viewport.scene, deps.viewport.renderer);
    this.speech = createSpeech();
    this.atmosphere = createAtmosphere(deps.viewport, this.sky);
    this.audio = createAudio();
    this.applySound(deps.ui.getSound());
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    const { input } = deps;
    this.unsubscribe.push(
      input.onKey('KeyE', () => this.tryTalk()),
      input.onKey('KeyR', () => this.openRules()),
      input.onKey('Slash', () => this.showWhy()),
      input.onKey('Escape', () => this.closeDialogue()),
      input.onKey('KeyV', () => this.town?.player.toggleView?.()),
    );
    deps.ui.onHud({
      rules: () => this.openRules(),
      why: () => this.showWhy(),
      share: () => void this.share().then((r) => this.copyLink(r)),
      talk: () => this.tryTalk(),
      newTown: () => this.newTown(),
      sound: (s) => this.applySound(s),
    });
  }

  private applySound(s: SoundSettings): void {
    this.audio.setVolume(s.overall);
    this.audio.setMuted(s.muted);
    this.audio.setBackgroundVolume(s.background);
    this.audio.setVoiceVolume(s.voices * s.overall);
    this.speech.setVolume(s.muted ? 0 : s.voices * s.overall);
  }

  private async copyLink(r: { url: string; short: boolean }): Promise<void> {
    try {
      await navigator.clipboard.writeText(r.url);
      this.deps.ui.toast(r.short ? 'Share link copied.' : 'Share link copied. The whole town travels in the URL.');
    } catch {
      this.deps.ui.toast('Could not copy automatically. The link is in the address bar.', 'warn');
    }
  }

  /** Entry point: show the landing card, or load a shared town from the URL hash. */
  async start(): Promise<void> {
    if (location.hash.length > 1) {
      this.deps.ui.showCompiling('Opening shared town…');
      const shared = await this.loadShared(location.hash.slice(1));
      if (shared) {
        try {
          await this.playSpec(shared);
          return;
        } catch (err) {
          this.failBuild(err);
          return;
        }
      }
      this.deps.ui.toast('That link did not hold a town. Start a new one.', 'warn');
      this.clearHash();
    }
    this.showLanding();
  }

  /** Back to the prompt: aborts an in-flight compile, tears the town down, clears the URL. */
  newTown(): void {
    this.compiling?.abort();
    this.compiling = null;
    this.teardown();
    this.clearHash();
    this.showLanding();
  }

  private clearHash(): void {
    history.replaceState(null, '', location.pathname + location.search);
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
    if (/^[0-9a-f]{10,32}$/.test(hash)) {
      const r = await this.deps.api.load(hash);
      if (r.ok) {
        const v = validateSpec(r.spec);
        if (v.ok) return normalizeSpec(v.value);
      }
    }
    return null;
  }

  private failBuild(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('town build failed:', message);
    this.teardown();
    this.deps.ui.showError('Could not build that town. Try the prompt again or pick an example.', () => {
      this.clearHash();
      this.showLanding();
    });
  }

  async buildFromPrompt(prompt: string): Promise<void> {
    const { ui, api } = this.deps;
    this.compiling?.abort();
    const ctl = new AbortController();
    this.compiling = ctl;
    const seed = seedFromPrompt(prompt);
    const theme = nearestTheme(prompt);

    try {
      // Start the heavy loads now so the town appears the moment the spec lands.
      const kitPromise = this.ensureKit(theme);
      const charPromise = Promise.resolve();
      ui.showCompiling('Thinking about your town…');

      // The town is shown as soon as its look arrives; the cast and quest follow a few seconds later.
      let outline: unknown = null;
      let preview: Promise<void> | null = null;
      const result = await api.compile(prompt, seed, (partial) => { if (!this.town) ui.showCompiling('Writing the world…', partial); }, ctl.signal, {
        onOutline: (o) => {
          outline = o;
          ui.showCompiling('Designing the buildings…');
        },
        onLook: (look) => {
          const early = lookSpec(outline, look, prompt, seed);
          if (!early || ctl.signal.aborted) return;
          preview = Promise.all([kitPromise, charPromise])
            .then(() => (ctl.signal.aborted ? undefined : this.playSpec(early)))
            .then(() => { if (!ctl.signal.aborted) ui.toast('Walk around. The townsfolk and their story are still arriving.'); })
            .catch((err: unknown) => console.warn('preview failed:', err instanceof Error ? err.message : String(err)));
        },
      });
      if (ctl.signal.aborted) return;
      if (preview) await preview;
      let spec: WorldSpec;
      if (!result.ok) {
        ui.toast(`${friendlyError(result.error)}. Showing a saved town instead.`, 'warn');
        spec = { ...FIXTURES[theme], prompt, seed };
      } else {
        const coerced = coerceSpec(result.spec);
        const v = validateSpec(coerced);
        if (!v.ok) {
          console.warn('invalid world:', explainInvalid(coerced));
          if (this.town) return; // keep the preview town rather than swapping to an unrelated one
          ui.toast('The world came back malformed; showing a saved town instead.', 'warn');
          spec = { ...FIXTURES[theme], prompt, seed };
        } else {
          spec = v.value;
        }
      }
      spec = normalizeSpec({ ...spec, prompt, seed });
      if (!this.town) ui.showCompiling('Laying out streets…');
      await Promise.all([kitPromise, charPromise]);
      if (ctl.signal.aborted) return;
      await this.playSpec(spec);
    } catch (err) {
      if (ctl.signal.aborted) return;
      this.failBuild(err);
    } finally {
      if (this.compiling === ctl) this.compiling = null;
    }
  }

  private async ensureKit(theme: ThemeId): Promise<LoadedKit> {
    if (this.kit && this.kit.manifest.theme === theme) return this.kit;
    const kit = await loadKit(theme);
    this.kit = kit;
    return kit;
  }

  async playSpec(input: WorldSpec): Promise<void> {
    const { ui, viewport } = this.deps;
    // When a fuller version of the same world replaces a preview, the player stays where they stand.
    const keep = this.town && this.town.spec.prompt === input.prompt && this.town.spec.seed === input.seed
      ? { pos: this.town.player.position.clone(), yaw: this.town.player.rig.root.rotation.y }
      : null;
    this.teardown();
    const repaired = repairQuest(normalizeSpec(input));
    const verified = verifyQuest(repaired);
    const spec = repaired;
    const kit = await this.ensureKit(spec.theme);

    // Everything created below is registered here so a failure half-way cannot orphan it in the scene.
    const created: { objects?: TownObjects; nav?: NavWorld; navGround?: THREE.Mesh; rigs: CharacterRig[]; agents: NavAgent[]; player?: Player } = { rigs: [], agents: [] };
    try {
      const rng = makeRng(spec.seed, 'game');
      const layout = generateLayout(spec);
      setSurfaceDefaults({ theme: spec.theme, mood: spec.mood, quality: viewport.getQuality?.() ?? 2 });
      const objects = buildTown(layout, spec, kit, viewport.scene, { quality: viewport.getQuality?.() ?? 2 });
      created.objects = objects;

      // The navmesh covers the town plus a margin, not the 400 m visual ground: a fraction of the voxels.
      const b = layout.bounds;
      const navGround = new THREE.Mesh(
        new THREE.PlaneGeometry(b.maxX - b.minX + 2 * NAV_MARGIN, b.maxZ - b.minZ + 2 * NAV_MARGIN).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      navGround.name = 'navground';
      navGround.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
      navGround.updateMatrixWorld(true);
      created.navGround = navGround;
      const nav = await buildNav(objects.statics.filter((m) => m.name !== 'ground'), navGround);
      created.nav = nav;

      const quality = viewport.getQuality?.() ?? 2;
      const playerRig: Person = createFigure({ folk: spec.folk, role: 'traveller', theme: spec.theme, seed: hash32(`${spec.seed}|player`), quality });
      viewport.scene.add(playerRig.root);
      created.rigs.push(playerRig);
      const player = createPlayer(playerRig, nav, viewport.camera, this.deps.input, objects.statics);
      created.player = player;
      if (keep) player.teleport(keep.pos, keep.yaw);
      else player.teleport(new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z), layout.spawn.rotY);

      const state = createState(spec);
      const npcs = new Map<string, NpcRuntime>();
      for (const n of spec.npcs) {
        const rig: Person = createFigure({ folk: spec.folk, role: n.role, theme: spec.theme, seed: hash32(`${spec.seed}|${n.id}`), quality });
        viewport.scene.add(rig.root);
        created.rigs.push(rig);
        const place = state.npcPlaces[n.id] ?? n.home;
        const start = this.placeToPoint(layout, objects, place, nav, rng);
        const agent = nav.addAgent(start, { radius: 0.4, speed: 1.6 + rng.range(-0.2, 0.3) });
        created.agents.push(agent);
        rig.root.position.copy(start);
        npcs.set(n.id, { spec: n, rig, agent, place, targetPlace: '', lastReason: 'starting the day' });
      }

      const lightRemovers = (objects.lights ?? []).map((l) => addPracticalLight(l.pos, l.color, l.radius));
      const life = createLife(viewport.scene, { theme: spec.theme, mood: spec.mood, style: spec.style, bounds: layout.bounds, smoke: objects.smoke, rng: makeRng(spec.seed, 'life') });
      const land = objects as typeof objects & { heightAt?(x: number, z: number): number; waterBodies?: { kind: string; x: number; z: number; r: number }[] };
      const creatures = (spec.creatures?.length ?? 0) > 0
        ? createCreatures(viewport.scene, {
            creatures: spec.creatures ?? [], nav, heightAt: (x, z) => land.heightAt?.(x, z) ?? 0, bounds: layout.bounds,
            doors: objects.doors, plaza: { x: layout.plaza.x, z: layout.plaza.z }, water: land.waterBodies, rng: makeRng(spec.seed, 'creatures'), quality,
          })
        : null;
      const skyRig = this.sky as SkyRig & { sunDirection?(): THREE.Vector3; daylight?(): number };
      const fallbackSun = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
      const skyFeatures = (spec.skyFeatures?.length ?? 0) > 0
        ? createSkyFeatures(viewport.scene, spec.skyFeatures, { sunDir: () => skyRig.sunDirection?.() ?? fallbackSun, daylight: () => skyRig.daylight?.() ?? 1, seed: spec.seed })
        : null;
      this.town = {
        spec, state, layout, objects, nav, navGround, player, npcs, rng, life, lightRemovers, creatures, skyFeatures,
        elapsed: 0, nextTickAt: 2, tickInFlight: false, dialogue: null, dialogueNpc: null, handle: null, verified,
      };
    } catch (err) {
      for (const a of created.agents) a.remove();
      for (const r of created.rigs) {
        viewport.scene.remove(r.root);
        r.dispose();
      }
      created.player?.dispose();
      created.nav?.dispose();
      created.navGround?.geometry.dispose();
      created.objects?.dispose();
      throw err;
    }

    this.applyWeather();
    this.sky.setHour(this.town.state.hour);
    this.sky.setGroundTint?.(spec.style?.ground ?? spec.palette.ground);
    this.atmosphere.setTheme?.(spec.theme);
    this.atmosphere.setMood(spec.mood, spec.style, spec.site?.pattern);
    const grade = this.atmosphere.getMood?.().grade;
    if (grade) viewport.setGrade?.(grade);
    this.audio.setScene({ mood: this.atmosphere.getMood?.() ?? spec.mood, theme: spec.theme, groundKind: spec.style?.surfaces?.ground, sitePattern: spec.site?.pattern, hour: this.town.state.hour });
    this.audio.ui('reveal');
    void this.forgeLandmarks(this.town);
    document.documentElement.style.setProperty('--accent', spec.palette.accent);
    ui.showHud(spec);
    ui.setBadge(verified.winnable ? `quest verified · ${verified.order.length} steps` : 'quest unverified');
    ui.setObjective(this.currentObjective());
    ui.toast(verified.winnable ? `Quest verified: ${verified.order.length} steps, ${spec.quest.endings.length} endings` : 'Quest could not be fully verified', verified.winnable ? 'info' : 'warn');
    this.pushLog('world', `${spec.title} wakes at ${this.fmtHour(this.town.state.hour)}`);
    const hash = encodeShare(spec);
    if (hash.length < 4000) history.replaceState(null, '', '#' + hash);
  }

  /** Generates each landmark as a full 3D model in the background and swaps it in when it lands. */
  private async forgeLandmarks(t: Town): Promise<void> {
    for (const lm of t.spec.landmarks ?? []) {
      try {
        const start = await this.deps.api.landmarkStart({ sessionId: this.sessionId, id: lm.id, prompt: lm.prompt, height: lm.height });
        if (this.town !== t) return;
        if (!start.ok || start.jobId === 'none' || start.status === 'failed') continue;
        const done = start.status === 'ready' && start.url
          ? { ok: true as const, url: start.url }
          : await pollLandmark(this.deps.api, start.jobId, {});
        if (this.town !== t) return;
        if (!done.ok) continue;
        const model = await loadLandmark(done.url);
        if (this.town !== t) return;
        t.objects.placeLandmark?.(lm.id, model, lm.height);
        this.deps.ui.toast('A landmark was forged for this town.');
        this.pushLog('world', `a landmark took shape: ${lm.prompt}`);
      } catch (err) {
        console.warn('landmark failed:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** The newest weather rule wins; with none, the spec's palette applies. */
  private applyWeather(): void {
    const t = this.town;
    if (!t) return;
    let sky: SkyPreset = t.spec.palette.sky;
    let fog = t.spec.palette.fog;
    for (const r of t.state.rules) {
      if (r.effect.type === 'weather') {
        sky = r.effect.sky;
        fog = r.effect.fog;
      }
    }
    this.sky.setPreset(sky, fog);
  }

  /** Called by main.ts every frame. */
  update(dt: number): void {
    const t = this.town;
    if (!t) return;
    t.elapsed += dt;
    const scaleRule = t.state.rules.find((r) => r.effect.type === 'time_scale');
    const minutesPerSecond = scaleRule && scaleRule.effect.type === 'time_scale' ? scaleRule.effect.minutesPerRealSecond : t.spec.time.minutesPerRealSecond;
    t.state = applyEvent(t.spec, t.state, { type: 'tick', dtHours: (dt * minutesPerSecond) / 60 }).state;
    this.sky.setHour(t.state.hour);
    this.deps.ui.setClock(t.state.hour, t.state.day);

    t.player.update(dt); // also advances the player's rig
    this.sky.setFocus?.(t.player.position.x, t.player.position.z);
    this.atmosphere.update(dt, t.player.position, t.state.hour);
    t.life?.update(dt, t.player.position, t.state.hour);
    t.creatures?.update(dt, t.player.position, t.state.hour);
    t.skyFeatures?.update(dt, this.deps.viewport.camera);
    updateScatter(t.player.position);
    WIND.time.value += dt;
    const h = t.state.hour;
    setWindowGlow(h < 6 || h > 18.5 ? 1 : h > 17 ? (h - 17) / 1.5 : h < 7.5 ? (7.5 - h) / 1.5 : 0.08);
    let nearNpcs = 0;
    for (const n of t.npcs.values()) if (n.agent.position().distanceTo(t.player.position) < 14) nearNpcs++;
    this.audio.update(dt, { speed: t.player.speed ?? 0, running: t.player.running ?? false, hour: h, nearNpcCount: nearNpcs });
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

    const near = this.nearestNpcId();
    if (near && !t.dialogue) {
      this.deps.ui.setPrompt(`E · talk to ${t.npcs.get(near)?.spec.name ?? ''}`);
    } else {
      // Nobody to talk to: name the nearest creature and what the player is looking at.
      const seen = t.dialogue ? null : t.creatures?.nearest(t.player.position, 30) ?? null;
      this.deps.ui.setPrompt(seen ? `${seen.name} · ${seen.note}` : null);
    }

    if (t.elapsed >= t.nextTickAt && !t.dialogue && !t.tickInFlight) {
      t.nextTickAt = t.elapsed + TICK_SECONDS;
      void this.tick();
    }
    this.checkProximity();
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
    t.tickInFlight = true;
    try {
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
        if (t.dialogueNpc === q.npcId) return; // never walk away from a conversation
        const p = probs[i];
        const action = p && p.length === q.options.length ? sampleAction(p, q.options, n.spec, t.rng) : localFallback(q, n.spec, t.rng);
        const intent = intents.find((it) => it.npcId === q.npcId);
        this.applyAction(n, action.id, action.target, action.reason, intent);
      });
    } finally {
      t.tickInFlight = false;
    }
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
        n.targetPlace = ''; // so the next schedule intent re-routes them
        this.pushLog(n.spec.id, `${n.spec.name} heads toward you: ${reason}`);
        return;
      case 'flee':
        place = n.spec.home;
        break;
      case 'idle':
      default:
        n.agent.setTarget(t.nav.randomPointNear(n.agent.position(), 3));
        n.lastReason = reason;
        n.targetPlace = '';
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
    n.targetPlace = '';
    t.player.frameTarget?.(n.agent.position());
    this.audio.ui('open');
    // The talk event lands before the session opens, so the greeting already sees the advanced quest state.
    const res = applyEvent(t.spec, t.state, { type: 'talk', npcId: id });
    t.state = res.state;
    const session = openDialogue(t.spec, () => this.town?.state ?? t.state, id, this.deps.api);
    t.dialogue = session;
    t.dialogueNpc = id;
    const handle = this.deps.ui.openDialogue(n.spec, (text) => void this.send(text), () => this.closeDialogue());
    t.handle = handle;
    this.afterEvent(res.completed);
    this.offerItemActions(n, handle);
    void session.say('(walks up)', (partial) => handle.stream(partial)).then((r) => {
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
    const after = (completed: string[]): void => {
      this.afterEvent(completed);
      if (t.handle === h) this.offerItemActions(n, h); // follow-up buttons appear at once
    };
    for (const stepId of t.state.unlockedSteps) {
      const step = t.spec.quest.steps.find((s) => s.id === stepId);
      if (!step || t.state.completedSteps.includes(stepId)) continue;
      if (step.kind === 'fetch' && t.state.itemHolders[step.target] === n.spec.id) {
        const item = t.spec.items.find((i) => i.id === step.target);
        h.addAction(`Take ${item?.name ?? step.target}`, () => {
          const res = applyEvent(t.spec, t.state, { type: 'pickup', item: step.target });
          t.state = res.state;
          after(res.completed);
        });
      }
      if (step.kind === 'deliver' && step.target === n.spec.id && step.item && t.state.inventory.includes(step.item)) {
        const item = t.spec.items.find((i) => i.id === step.item);
        const itemId = step.item;
        h.addAction(`Give ${item?.name ?? itemId}`, () => {
          const res = applyEvent(t.spec, t.state, { type: 'give', item: itemId, to: n.spec.id });
          t.state = res.state;
          after(res.completed);
        });
      }
      if (step.kind === 'choose' && step.target === n.spec.id && step.choices) {
        step.choices.forEach((c, idx) => h.addAction(c.label, () => {
          const res = applyEvent(t.spec, t.state, { type: 'choose', stepId: step.id, choice: idx });
          t.state = res.state;
          after(res.completed);
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
    t.player.frameTarget?.(null);
    for (const n of t.npcs.values()) n.rig.setTalking?.(-1);
    this.audio.ui('close');
    this.speech.cancel();
    t.nextTickAt = Math.min(t.nextTickAt, t.elapsed + 2);
  }

  /** Visit steps complete at a building's door; items left in a building are picked up there too. */
  private checkProximity(): void {
    const t = this.town;
    if (!t) return;
    for (const stepId of t.state.unlockedSteps) {
      if (t.state.completedSteps.includes(stepId)) continue;
      const step = t.spec.quest.steps.find((s) => s.id === stepId);
      if (!step) continue;
      if (step.kind === 'visit') {
        const door = t.objects.doors.get(step.target);
        if (door && door.distanceTo(t.player.position) < 2.5) {
          const res = applyEvent(t.spec, t.state, { type: 'visit', buildingId: step.target });
          t.state = res.state;
          this.afterEvent(res.completed);
        }
      } else if (step.kind === 'fetch') {
        const holder = t.state.itemHolders[step.target];
        const door = holder ? t.objects.doors.get(holder) : undefined;
        if (door && door.distanceTo(t.player.position) < 2.5) {
          const item = t.spec.items.find((i) => i.id === step.target);
          const res = applyEvent(t.spec, t.state, { type: 'pickup', item: step.target });
          t.state = res.state;
          if (res.completed.length === 0) this.deps.ui.toast(`Picked up ${item?.name ?? step.target}`);
          this.afterEvent(res.completed);
        }
      }
    }
  }

  private afterEvent(completed: string[]): void {
    const t = this.town;
    if (!t) return;
    for (const id of completed) {
      const step = t.spec.quest.steps.find((s) => s.id === id);
      if (step) {
        this.deps.ui.toast(`✓ ${step.objective}`);
        this.audio.ui('quest');
      }
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
    this.deps.ui.openRules(t.state.rules, (text) => this.addRule(text), (id) => this.removeRule(id));
  }

  private removeRule(id: string): void {
    const t = this.town;
    if (!t) return;
    t.state = applyEvent(t.spec, t.state, { type: 'rule_remove', ruleId: id }).state;
    this.pushLog('world', `rule removed: ${id}`);
    this.applyWeather();
    this.openRules();
    t.nextTickAt = t.elapsed + 1;
  }

  private async addRule(text: string): Promise<boolean> {
    const t = this.town;
    if (!t) return false;
    const summary = [
      'buildings: ' + t.spec.buildings.map((b) => `${b.id}(${b.role})`).join(', '),
      'npcs: ' + t.spec.npcs.map((n) => `${n.id}(${n.role})`).join(', '),
      'items: ' + t.spec.items.map((i) => i.id).join(', '),
      'rules: ' + t.state.rules.map((r) => r.text).join(' | '),
    ].join('\n');
    const r = await this.deps.api.patchRules({ sessionId: this.sessionId, ruleText: text, summary });
    if (this.town !== t) return false;
    if (!r.ok) {
      this.deps.ui.toast(`${friendlyError(r.error)}. The rule was not applied.`, 'warn');
      return false;
    }
    for (const rule of r.rules) {
      const stamped: RuleSpec = { ...rule, source: 'player' };
      t.state = applyEvent(t.spec, t.state, { type: 'rule_add', rule: stamped }).state;
      this.pushLog('world', `new rule: ${stamped.text}`);
    }
    this.applyWeather();
    this.deps.ui.toast(`${r.rules.length} rule${r.rules.length === 1 ? '' : 's'} now in force`);
    this.openRules();
    t.nextTickAt = t.elapsed + 0.5;
    return true;
  }

  // ---- why, share, misc -----------------------------------------------------------------------

  private showWhy(): void {
    const t = this.town;
    if (!t) return;
    const lines = t.state.log.slice(-12).map((l) => `${this.fmtHour(l.t)}  ${l.what}`);
    this.deps.ui.showWhy(lines.length ? lines : ['Nothing has happened yet.']);
  }

  async share(): Promise<{ url: string; short: boolean }> {
    const t = this.town;
    if (!t) return { url: location.href, short: false };
    const hash = encodeShare(t.spec);
    if (hash.length < 4000) {
      history.replaceState(null, '', '#' + hash);
      return { url: location.href, short: false };
    }
    const r = await this.deps.api.share(t.spec);
    if (r.ok) {
      history.replaceState(null, '', '#' + r.id);
    } else {
      this.deps.ui.toast('The share service is unavailable right now; the long link below still works.', 'warn');
      history.replaceState(null, '', '#' + hash);
    }
    return { url: location.href, short: r.ok };
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
    t.life?.dispose();
    t.creatures?.dispose();
    t.skyFeatures?.dispose();
    for (const r of t.lightRemovers) r();
    t.nav.dispose();
    t.navGround.geometry.dispose();
    (t.navGround.material as THREE.Material).dispose();
    t.objects.dispose();
    disposeBodyCache();
    this.town = null;
  }

  dispose(): void {
    this.teardown();
    this.unsubscribe.forEach((u) => u());
    this.atmosphere.dispose();
    this.audio.dispose();
    this.sky.dispose();
  }
}

export function applyEvents(spec: WorldSpec, state: WorldState, events: WorldEvent[]): WorldState {
  return events.reduce((s, ev) => applyEvent(spec, s, ev).state, state);
}
