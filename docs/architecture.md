# Townforge architecture

Townforge turns a plain-language prompt into a small playable town in the browser. A language model
compiles the prompt into a **world spec** (data only). The engine builds the town, runs the clock,
moves the NPCs, tracks the quest, and enforces the rules. A second, cheaper model voices NPC lines.
A decision model picks per-tick NPC actions from choices the engine offers. Nothing in the hot loop
waits on a network call.

Two rules that every module obeys:

1. Models emit data; the engine runs the world. If a behaviour cannot be explained from engine
   state, it does not ship.
2. Every mesh, texture, animation and sky is a static file under `assets/`. No asset generation at
   runtime.

## Layout

```
app/                  Vite + TypeScript browser app (vanilla three.js, no framework)
  index.html
  src/
    main.ts           boot: UI, renderer, game loop                      (integration, owner: lead)
    game.ts           Game orchestrator: compile -> layout -> build -> play (owner: lead)
    world/            spec types, zod schema, fixtures, quest verifier, state reducer
    town/             deterministic layout generator and scene builder
    engine/           renderer, sky, input, asset loading, characters, navmesh, player
    npc/              schedules, decision sampling, dialogue client, speech
    net/              fetch/SSE wrappers for the Worker API
    ui/               HTML/CSS overlay: prompt, HUD, dialogue, rule editor, why-overlay
worker/               Cloudflare Worker: model proxy, decision proxy, share links, rate limits
  src/index.ts
  src/prompts/
  wrangler.toml
assets/               Vite publicDir: served at the site root, so a file at assets/third_party/x/y.glb
  third_party/<pack>/ is fetched as /third_party/x/y.glb. Committed CC0 kits with LICENSE and manifest.json
  skies/              1k HDRIs (optional), served as /skies/...
scripts/              asset fetch + gltf-transform optimisation (build time only)
tests/                vitest unit tests, mirror of app/src
docs/                 this file, THIRD_PARTY.md
```

Imports inside `app/src` use **relative paths** (`../world/spec`), not the `@/` alias, so each
module can be type-checked alone.

## Conventions

- TypeScript 5.9, `strict`, `noUncheckedIndexedAccess`. No `any` outside type guards.
- Pure modules (`world/`, `town/layout`, `npc/brain`, `npc/decide`) import nothing from three or the
  DOM, so they run in vitest under Node.
- Deterministic randomness: every module that needs randomness takes a `Rng` (see
  `app/src/world/rng.ts`) seeded from `spec.seed` plus a module salt. `Math.random` is banned.
- Units: metres, seconds, town hours (0..24, fractional). +Y up, buildings face −Z by default.
- Dispose everything you create: geometries, materials, navmeshes, crowds, DOM listeners. Towns are
  regenerated many times in one page session.
- Errors are values at module boundaries (`{ ok: true, value } | { ok: false, error }`); only the
  game loop throws.
- No console output in production paths except `console.warn` for recoverable asset problems.

## Module contracts

Each module exports exactly the surface below. Add internal helpers freely; do not change these
signatures without updating this file and `game.ts`.

### world/ (pure)

```ts
// spec.ts — already written. WorldSpec, WorldState, NpcAction and friends.
// rng.ts
export type Rng = { next(): number; int(lo: number, hi: number): number; pick<T>(xs: readonly T[]): T; shuffle<T>(xs: T[]): T[] };
export function makeRng(seed: number, salt?: string): Rng; // mulberry32 over a 32-bit hash of seed+salt
// schema.ts
export const WorldSpecSchema: z.ZodType<WorldSpec>;   // zod 4; no min/max in the JSON schema export, clamp in normalize
export function validateSpec(raw: unknown): { ok: true; value: WorldSpec } | { ok: false; error: string };
export function normalizeSpec(spec: WorldSpec): WorldSpec; // clamps ranges, dedupes ids, repairs dangling references, sorts schedules
export function worldSpecJsonSchema(): object;         // JSON schema the Worker hands to the compile model (no recursion, additionalProperties false)
// fixtures.ts
export const FIXTURES: Record<ThemeId, WorldSpec>;     // four complete, valid, hand-written towns (used offline and as few-shot examples)
export function nearestTheme(prompt: string): ThemeId; // keyword mapping so any prompt lands on a kit
// verify.ts
export interface QuestReport { winnable: boolean; order: string[]; problems: string[]; unreachable: string[] }
export function verifyQuest(spec: WorldSpec): QuestReport;   // graph walk: items reachable, NPC reachable at some hour under rules, no cycles
export function repairQuest(spec: WorldSpec): WorldSpec;     // drops or rewires unreachable steps, guarantees at least one ending
// state.ts
export function createState(spec: WorldSpec): WorldState;
export type WorldEvent =
  | { type: 'tick'; dtHours: number }
  | { type: 'talk'; npcId: string }
  | { type: 'pickup'; item: string }
  | { type: 'give'; item: string; to: string }
  | { type: 'visit'; buildingId: string }
  | { type: 'choose'; stepId: string; choice: number }
  | { type: 'rule_add'; rule: RuleSpec }
  | { type: 'rule_remove'; ruleId: string }
  | { type: 'npc_moved'; npcId: string; place: string }
  | { type: 'npc_mood'; npcId: string; mood: Mood };
export function applyEvent(spec: WorldSpec, state: WorldState, ev: WorldEvent): { state: WorldState; completed: string[]; unlocked: string[] };
export function activeRules(state: WorldState, hour: number): RuleSpec[];
```

### town/ (layout pure; build uses three)

```ts
// layout.ts
export interface PlacedBuilding { id: string; role: BuildingRole; size: BuildingSize; x: number; z: number; rotY: number; w: number; d: number; door: { x: number; z: number } }
export interface RoadSegment { ax: number; az: number; bx: number; bz: number; width: number }
export interface PlacedProp { kind: string; x: number; z: number; rotY: number; scale: number }
export interface TownLayout {
  buildings: PlacedBuilding[]; roads: RoadSegment[]; props: PlacedProp[];
  plaza: { x: number; z: number; r: number }; spawn: { x: number; z: number; rotY: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  walkable: { x: number; z: number }[]; // sample points on streets, for wander targets before the navmesh exists
}
export function generateLayout(spec: WorldSpec): TownLayout;
// Main street along X through the origin, 1–3 cross streets, lots on both sides, key buildings nearest the centre,
// plaza at the main crossing, props by poisson-disk sampling off the roads. Deterministic from spec.seed.
// Footprints come from FOOTPRINTS[size] = { small: {w:6,d:6}, medium: {w:9,d:8}, large: {w:12,d:10} } unless the kit says otherwise.

// kits.ts
export interface KitManifest { theme: ThemeId; pack: string; buildings: Record<BuildingRole, string[]>; props: Record<string, string>; ground: { color: string; texture?: string } }
export const KITS: Record<ThemeId, KitManifest>; // URL paths under /third_party/..., role -> candidate mesh files
// build.ts
export interface TownObjects { group: THREE.Group; statics: THREE.Mesh[]; signs: Map<string, THREE.Object3D>; doors: Map<string, THREE.Vector3>; dispose(): void }
export function buildTown(layout: TownLayout, spec: WorldSpec, kit: LoadedKit, scene: THREE.Scene): TownObjects;
// Falls back to coloured boxes with the right footprint when a kit mesh is missing, so the town always renders.
```

### engine/ (three)

```ts
// renderer.ts
export interface Viewport { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; resize(): void; start(step: (dt: number) => void): void; stop(): void; dispose(): void }
export function createViewport(canvas: HTMLCanvasElement): Viewport | null; // null when WebGL is unavailable; caller shows a message
// sky.ts
export interface SkyRig { setHour(h: number): void; setPreset(p: SkyPreset, fog: number): void; dispose(): void }
export function createSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer): SkyRig; // Sky.js + PMREM env, one directional light + hemisphere
// input.ts
export interface Input { down(code: string): boolean; axis(): { x: number; y: number }; onKey(code: string, cb: () => void): () => void; pointerDelta(): { dx: number; dy: number }; dispose(): void }
export function createInput(target: HTMLElement): Input; // ignores keys while an input/textarea is focused
// assets.ts
export interface LoadedKit { manifest: KitManifest; building(role: BuildingRole, size: BuildingSize, rng: Rng): THREE.Object3D | null; prop(kind: string): THREE.Object3D | null; footprint(role: BuildingRole, size: BuildingSize): { w: number; d: number } }
export function loadKit(theme: ThemeId, onProgress?: (p: number) => void): Promise<LoadedKit>; // GLTFLoader + MeshoptDecoder, caches per theme, clones on request
// character.ts
export interface CharacterRig { root: THREE.Object3D; mixer: THREE.AnimationMixer; play(name: 'idle' | 'walk' | 'run' | 'talk' | 'sit' | 'wave', fade?: number): void; setPalette(index: number, theme: ThemeId): void; lookAt(target: THREE.Vector3 | null): void; update(dt: number): void; dispose(): void }
export function loadCharacterBase(base: CharacterBase): Promise<void>;     // loads /third_party/kaykit-adventurers/<Base>.glb once
export function createCharacter(base: CharacterBase): CharacterRig;        // SkeletonUtils.clone of the cached base; maps KayKit clip names to the six logical names
// nav.ts
export interface NavWorld { addAgent(pos: THREE.Vector3, opts?: { radius?: number; speed?: number }): NavAgent; moveAlongSurface(from: THREE.Vector3, delta: THREE.Vector3): THREE.Vector3; randomPointNear(p: THREE.Vector3, r: number): THREE.Vector3; nearest(p: THREE.Vector3): THREE.Vector3; update(dt: number): void; debugMesh(): THREE.Object3D; dispose(): void }
export interface NavAgent { position(): THREE.Vector3; velocity(): THREE.Vector3; setTarget(p: THREE.Vector3): void; stop(): void; remove(): void }
export function buildNav(statics: THREE.Mesh[], ground: THREE.Mesh, opts?: { cellSize?: number; agentRadius?: number }): Promise<NavWorld>; // recast-navigation solo navmesh + Crowd; init() once
// player.ts
export interface Player { rig: CharacterRig; position: THREE.Vector3; update(dt: number): void; teleport(p: THREE.Vector3, rotY: number): void; nearestNpc(npcs: { id: string; pos: THREE.Vector3 }[], maxDist: number): string | null; dispose(): void }
export function createPlayer(rig: CharacterRig, nav: NavWorld, camera: THREE.PerspectiveCamera, input: Input, statics: THREE.Mesh[]): Player; // third-person orbit camera, BVH boom raycast, wall sliding via nav.moveAlongSurface
```

### npc/ (brain and decide pure; dialogue and speech use fetch/DOM)

```ts
// brain.ts
export interface NpcIntent { npcId: string; place: string; activity: ScheduleEntry['activity']; reason: string }
export function whereShouldBe(npc: NpcSpec, hour: number, rules: RuleSpec[]): NpcIntent;  // schedule lookup, then rule overrides (curfew sends home, ban closes a place, schedule_override wins)
export function planTick(spec: WorldSpec, state: WorldState): NpcIntent[];               // one intent per NPC for the current hour
// decide.ts
export interface ChoiceQuestion { npcId: string; question: string; options: { id: NpcActionId; label: string; target?: string }[] }
export function buildQuestions(spec: WorldSpec, state: WorldState, intents: NpcIntent[], playerNear: string | null): ChoiceQuestion[]; // 3–5 options each, the schedule intent always included as 'continue'
export function sampleAction(probs: number[], options: ChoiceQuestion['options'], npc: NpcSpec, rng: Rng): NpcAction; // p_i^(1/tau) * exp(bias), renormalise, sample
export function localFallback(q: ChoiceQuestion, npc: NpcSpec, rng: Rng): NpcAction; // used on 429/timeout: weighted toward 'continue'
// dialogue.ts
export interface DialogueTurn { speaker: 'player' | 'npc'; text: string }
export interface DialogueSession { say(playerText: string, onToken: (partial: string) => void): Promise<{ text: string; source: 'model' | 'fallback' }>; history: DialogueTurn[]; close(): void }
export function openDialogue(spec: WorldSpec, state: WorldState, npcId: string, api: Api): DialogueSession;
export function validateLine(text: string): { ok: boolean; cleaned: string; reason?: string }; // rejects reasoning leaks ("Let me think", "As an AI", bracketed stage directions longer than 40 chars, empty)
export function cannedLine(npc: NpcSpec, mood: Mood, rng: Rng): string;
// speech.ts
export interface Speech { speak(text: string, voice: NpcSpec['voice']): void; cancel(): void; enabled: boolean }
export function createSpeech(): Speech; // SpeechSynthesis queue, sentence-split, no-op where unsupported
```

### net/

```ts
// api.ts
export interface Api {
  compile(prompt: string, seed: number, onPartial: (text: string) => void, signal?: AbortSignal): Promise<{ ok: true; spec: unknown } | { ok: false; error: string }>;
  npcSay(body: NpcSayRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; error: string; refusal?: boolean }>;
  tick(body: TickRequest): Promise<{ ok: true; probs: number[][] } | { ok: false; error: string }>;
  patchRules(body: PatchRequest): Promise<{ ok: true; rules: RuleSpec[] } | { ok: false; error: string }>;
  share(spec: WorldSpec): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  load(id: string): Promise<{ ok: true; spec: unknown } | { ok: false; error: string }>;
  health(): Promise<{ ok: boolean; mock: boolean }>;
}
export function createApi(base?: string): Api; // SSE parsing for compile/npcSay; 20 s timeout on compile tokens, 8 s on npcSay
// Request shapes are shared with the Worker and live in app/src/net/types.ts (NpcSayRequest, TickRequest, PatchRequest).
```

### ui/

```ts
// ui.ts
export interface UI {
  showLanding(examples: string[], onSubmit: (prompt: string) => void): void;
  showCompiling(status: string, partial?: string): void;   // skeleton town is already visible behind it
  showHud(spec: WorldSpec): void; setClock(hour: number, day: number): void; setObjective(text: string): void; toast(text: string, kind?: 'info' | 'warn'): void;
  openDialogue(npc: NpcSpec, onSend: (text: string) => void, onClose: () => void): { stream(partial: string): void; done(): void };
  openRules(rules: RuleSpec[], onAdd: (text: string) => void, onRemove: (id: string) => void): void; closeRules(): void;
  showWhy(lines: string[]): void;                           // the "why did they do that?" overlay from state.log
  setPrompt(label: string | null): void;                   // bottom-centre hint: "E · talk to Sheriff Cole"
  showError(text: string, retry?: () => void): void;
  dispose(): void;
}
export function createUI(root: HTMLElement): UI;
// ui.css: dark-first tokens on :root, light under prefers-color-scheme; 16px gutters; works at 400px; canvas untouched by layout.
```

### worker/

Routes, all under `/api`, JSON in, JSON or SSE out, CORS same-origin only:

| Route | Body | Returns | Model |
|---|---|---|---|
| `POST /api/compile` | `{ prompt, seed }` | SSE: `partial` text events, then `spec` event with the parsed object | Sonnet 5.5, structured outputs, `thinking: {type:"between_tools"}`, effort low |
| `POST /api/npc/say` | `NpcSayRequest` (system bible, persona, trimmed state, history, player line) | SSE text deltas, then `done` with `{refusal?: boolean}` | Haiku 5.5, thinking disabled; Sonnet retry on refusal; Groq gpt-oss-120b on vendor error |
| `POST /api/tick` | `TickRequest` (questions) | `{ probs: number[][] }` | Jev `jev-1.14.0` via TypeSafe; Workers AI Clef-flash fallback; `{probs: []}` on total failure |
| `POST /api/rules/patch` | `PatchRequest` (rule text, spec summary) | `{ rules: RuleSpec[] }` | Sonnet 5.5, structured output of `RuleSpec[]` |
| `POST /api/share` | `WorldSpec` | `{ id }` | KV, 30-day TTL |
| `GET /api/load/:id` | | spec | KV |
| `GET /api/health` | | `{ ok, mock }` | |

`MOCK=1` (or any missing key) makes the Worker answer from `app/src/world/fixtures` so the whole
app runs with zero credentials. Secrets: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `TYPESAFE_API_KEY`,
`TURNSTILE_SECRET`, via `wrangler secret put` and a gitignored `.dev.vars`. Rate Limiting binding
per IP on the three model routes; a per-session token budget in KV with a `429 { reason: "resting" }`
response the UI turns into a "the town is resting" state. SSE bodies pass through untouched.

## Game flow (game.ts)

1. Landing prompt. On submit: `seed = hash(prompt)`, pick `nearestTheme(prompt)`, start loading
   that kit and the character bases immediately, show a skeleton town (boxes) within a second.
2. `api.compile` streams. Partial text updates the compiling panel. On the `spec` event:
   `validateSpec` → `normalizeSpec` → `repairQuest` → `verifyQuest` (report shown in the HUD as a
   badge: "quest verified, 6 steps").
3. `generateLayout(spec)` → `buildTown` → `buildNav` → spawn player at `layout.spawn`, spawn one
   `CharacterRig` + `NavAgent` per NPC at `whereShouldBe(npc, startHour)`.
4. Loop at 60 Hz: input → player → crowd → rigs. Town clock advances by
   `minutesPerRealSecond`. Every 20 real seconds (or when the player approaches an NPC):
   `planTick` → `buildQuestions` → `api.tick` → `sampleAction` per NPC → set agent targets, push a
   `log` line with the reason. On API failure `localFallback` keeps everyone moving.
5. `E` near an NPC opens dialogue; lines stream from `api.npcSay`; `validateLine` gates every line;
   `applyEvent({type:'talk'})` advances quest steps whose target is that NPC; `deliver` and `fetch`
   are offered as buttons in the dialogue panel when the state allows.
6. `R` opens the rule editor. New rule text → `api.patchRules` → `applyEvent({type:'rule_add'})`,
   the next tick re-plans, and the "why" overlay cites the rule.
7. `?` shows the last 12 log lines. `Share` compresses the spec with fflate into the URL hash (or KV
   if over 4 KB).

## Testing

- `npm test` runs vitest over `tests/`. Pure modules need tests; three-dependent modules get a
  smoke test only where jsdom is not required.
- `npm run typecheck` must pass before any commit.
- Manual: `npm run dev` with the Worker in mock mode shows the western fixture end to end.
