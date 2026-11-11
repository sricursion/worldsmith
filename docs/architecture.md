# Worldsmith architecture

A prompt becomes a `WorldSpec` (plain JSON), the browser turns the spec into a walkable world, and a few
small model calls keep it alive (dialogue, per-person decisions, rule patches). The model writes data.
The engine runs the world.

## Layout

```
app/                  Vite + TypeScript browser app, vanilla three.js, no UI framework
  index.html, vite.config.ts
  src/main.ts         boot: UI, viewport, input, API client, frame loop
  src/game.ts         Game: prompt -> compile -> build -> play; ticks, dialogue, rules, share
  src/world/          spec types, zod schema, coercion, skeletons, quest verify, state reducer, body plans, fixtures
  src/town/           layout, terrain, endless land, water, blueprint meshes, surfaces, props, scatter, signs
  src/engine/         renderer and film pipeline, sky, weather, atmosphere, audio, navmesh, player, people, creatures
  src/npc/            schedules and rules (brain), decision sampling, dialogue client, speech
  src/net/            fetch and SSE client for the Worker API
  src/ui/             landing, HUD, dialogue, rules panel, why overlay, sound panel
worker/               Cloudflare Worker: src/index.ts routes, src/routes/, src/prompts/, src/lib/, wrangler.toml
api/index.ts          Vercel Edge entry that wraps the same Worker fetch handler
assets/               Vite publicDir: CC0 packs under third_party/ (see THIRD_PARTY.md)
scripts/              asset fetch and optimise (build time only)
tests/                Vitest, one folder per area of app/src plus worker/
```

Pure modules (`world/`, `town/layout.ts`, `town/terrain.ts`, `npc/brain.ts`, `npc/decide.ts`) import no DOM
and run under Node in tests. Randomness is always a seeded `Rng` (`app/src/world/rng.ts`, from `spec.seed`
plus a salt), so the same spec builds the same world. Units are metres and seconds; town time is hours.

## The compile pipeline

`POST /api/compile` (`worker/src/routes/compile.ts`) streams server-sent events over one response. Three
stages call `claude-sonnet-5-5` (`worker/src/lib/anthropic.ts`), each with a cached system prompt:

1. Outline (`prompts/compile.ts`): what kind of place this is. Land, how settled it is, site pattern,
   the people's body plan, creatures, sky features, mood (weather, grade, haze, ambience, music), start
   hour, quest premise. Event `outline`.
2. Look (`prompts/compilelook.ts`) and story (`prompts/compilestory.ts`) run in parallel. Look returns
   style and surfaces, blueprints (a skeleton family, dials and extra parts), props, landmarks and which
   blueprint each building uses. Story returns people, items, the quest and starting rules, written
   against the outline's ids. Events `look`, then `spec`.
3. `prompts/compilemerge.ts` coerces each stage (`coerceOutline`, `coerceLook`, `coerceStory`,
   `parseLooseJson`) and `mergeSpec` joins them. If the merged spec fails `validateSpec`, the story is
   replaced by the stock cast and the spec is merged again. A stage that fails or cannot be read falls
   back to a stock result (`lib/mockcast.ts`) and the stream carries a `stage` event saying so.

The stream also sends `partial` text deltas (coalesced to one per 120 ms), `ping` every 3 s, and `error`.
With `MOCK=1` or no `ANTHROPIC_API_KEY` the same events are produced from fixtures (`isMock` in
`lib/env.ts`). Abuse controls (`lib/guard.ts`, `lib/budget.ts`): a per-IP rate limit binding, and daily
output-token budgets per session, per IP and globally; over budget returns `429 resting`.

On the client (`app/src/net/api.ts`, `net/sse.ts`) `buildFromPrompt` in `game.ts` starts loading the
nearest theme's kit and the human models immediately. On `look` it builds a preview from `lookSpec`
(`world/coerce.ts`), so the world is walkable while the story is still being written. On `spec` it runs
`coerceSpec`, `validateSpec`, `normalizeSpec`, then `playSpec`, which keeps the player's position if it is
replacing a preview of the same world. A failed compile shows a saved fixture world and says so.

## WorldSpec and normalise

`app/src/world/spec.ts` is the single contract. A spec holds: theme, era, palette, time; buildings, people,
items, a quest, rules; and the optional generated parts: `style` (colours and `SurfaceSet`), `site`
(street, ring, scatter, grid, terraces, wild, path, shoreline, cliffside), `mood`, `terrain`,
`skyFeatures`, `creatures`, `folk`, `blueprints`, `props`, `landmarks`.

`app/src/world/schema.ts` mirrors it in zod and exports `validateSpec` and `normalizeSpec`. Normalise
clamps every range, caps lists (14 buildings, 10 people, 8 blueprints, 20 items), makes ids unique, repairs
dangling references (homes, workplaces, quest targets, blueprint assignment) and sorts schedules.
`world/verify.ts` holds `verifyQuest` and `repairQuest`: the quest is a graph of required steps, items and
choices, and it counts as winnable when the giver has a step and at least one ending is not blocked. The HUD
badge reads "quest verified" with the step count.

## Skeletons

`app/src/world/skeletons.ts` registers every family exported from `app/src/world/skeletons/`
(`structure-a..d.ts`, `nature*.ts`, `object.ts`; helpers in `util.ts`). A `Skeleton` has an id, a group
(structure, nature, object), what it can become, dials (number with range, or choice) and a `build`
function that returns at most 28 `BlueprintPart`s from primitive shapes (box, cylinder, cone, pyramid,
gable, dome, sphere, wedge, arch, ring). `buildSkeleton` resolves every dial (missing, wrong type or out
of range becomes the default or the nearest legal value) and never throws. Structure families also take
the shared `ruin` dial (`ruinParts`). `ALIASES` fold names a model is likely to use (`ship`, `crater`,
`monolith`) into a real family with preset dials. `skeletonCatalogText()` writes the one-line-per-family
catalogue that goes into the look prompt, so adding a family needs no prompt edit. A blueprint's own
`parts` are added on top of the skeleton's, which is where a prompt makes a building belong to its world.

## Building the world

`generateLayout` (`town/layout.ts`) places lots by the site pattern, keeps key buildings central, plans
water bodies as shapes and allows zero buildings. Footprints grow with `terrain.settled`.
`buildTown` (`town/build.ts`) produces the scene objects and the `statics` that the navmesh and camera
collide with.

- Buildings: `town/variation.ts` varies each archetype per building (storeys, handedness, width, clutter,
  wear) and keeps a variant only if it still passes the blueprint lint. `town/blueprint-mesh.ts` turns
  parts into geometry with box-projected UVs in metres, then `town/detail.ts` adds construction (plinth,
  storey bands, eaves, gutters, chimneys, openings). `town/sign.ts` draws signs that match the material.
- Surfaces: `town/surfaces.ts` and `town/surfaces/` generate albedo, normal and roughness/metalness maps in
  the browser for each `SurfaceKind`, with wear and wetness. Nothing is downloaded.
- Terrain: `town/terrain.ts` (`makeLand`) builds relief from `terrain.relief` and `ruggedness`, carves
  basins for water, and keeps the place level under footprints. `town/water.ts` draws water, lava, acid,
  ice sheets and mist seas with one shader.
- Props and ground cover: `town/props.ts` (prop shapes and set dressing), `town/scatter.ts` (instanced
  grass, flowers, pebbles, litter, windblown).
- Kit meshes (`town/kits.ts`, `engine/assets.ts`) are used only when a spec has no style or blueprints.

## Endless land

`town/endless.ts` makes the land continue past the place. Height is a function defined everywhere
(`Land.heightAt`). Around the player it is drawn as a quadtree of tiles of equal grid size, coarser with
distance, built a few rows per frame within a time budget, with skirts to hide seams. The place keeps its
own ground mesh for roads and wear; tiles reach its edge and share heights there. The world's props are
scattered over the land a chunk at a time, and every few hundred metres a place worth walking to is
generated from the cell it lies in. The horizon ring travels with the player. `Game.update` calls
`objects.update(playerPosition, dt)` each frame, and `engine/player.ts` lets the player walk on past the
navmesh, turned aside by steep slopes, deep water and solid objects.

## Navmesh, people and creatures

`engine/nav.ts` bakes a Recast solo navmesh (`recast-navigation`) over the walkable ground plus statics,
and runs a `Crowd` for people (cell size 0.3 m, agent radius 0.4 m by default). The player moves with
camera-relative controls and a BVH camera boom (`engine/player.ts`, `camera-rig.ts`, `three-mesh-bvh`).

People are built from `spec.folk`. `engine/humans.ts` uses the Quaternius models when the folk are human;
otherwise `engine/bodies/figure.ts` draws the folk body plan. Creatures (`engine/creatures.ts`) use
`world/bodies.ts`, a joint tree plus primitive segments per `CreatureFamily`, reshaped by dials and animated
from joint roles by `engine/bodies/animate.ts`. A small behaviour machine decides where each creature goes.
`engine/life.ts` adds flocks, chimney smoke, cloth and litter as instanced shader-driven layers.

## Light, air and sound

`engine/sky.ts` and `skyfeatures.ts` draw the sky and its moons, planets, rings and aurora. `engine/weather.ts`
is GPU particle weather. `engine/atmosphere.ts` turns `MoodSpec` into fog, haze and wetness. `engine/post.ts`
is the film pipeline (ambient occlusion, air, weather, focus pull during conversation, bloom, grade), with
quality tiers chosen from measured frame time. `engine/audio/` synthesises beds, footsteps, music and
interface sounds with Web Audio.

## People, rules and state

`world/state.ts` is the pure reducer `applyEvent` over `WorldState` (clock, quest progress, inventory,
moods, rules, log). Events: tick, talk, pickup, give, visit, choose, rule_add, rule_remove, npc_moved,
npc_mood.

`npc/brain.ts` (`whereShouldBe`, `planTick`) looks up each person's schedule and applies rules: `curfew`,
`ban` and `schedule_override` change where they go, `mood` changes how they feel. `time_scale` and `weather`
are applied in `game.ts`. `price` and `relationship` have no movement effect; they reach the dialogue
model as rule text. Every 20 seconds `game.ts` calls `buildQuestions` (`npc/decide.ts`), `POST /api/tick`,
and `sampleAction` per person, or `localFallback` if the call fails. Each move writes a log line with its
reason; the "why" overlay (`ui/why.ts`) shows the last 12.

A typed rule goes from `ui/rules.ts` to `Game.addRule`, then `POST /api/rules/patch` (one to three typed
`RuleSpec`s, structured output, model `claude-sonnet-5-5`), then `rule_add`, and the next tick re-plans.
In mock mode `lib/mockrules.ts` maps keywords to effects.

Dialogue (`npc/dialogue.ts`, `POST /api/npc/say`) streams one line with the person's persona, trimmed live
state and history. `validateLine` rejects reasoning leaks. Worker order: Anthropic `claude-sonnet-5-5`, then
Groq `openai/gpt-oss-120b` if the first fails before any text. Speech uses the browser's `SpeechSynthesis`.
Quest progress comes from the reducer: talk steps on conversation, fetch and visit steps by walking to a
door, deliver and choose steps through buttons in the dialogue panel.

## Worker and Vercel entry

Routes (`worker/src/index.ts`), all under `/api`: `GET health`, `POST compile`, `POST npc/say`,
`POST tick`, `POST rules/patch`, `POST share`, `GET load/:id`, and the landmark routes (`POST landmark`,
`GET landmark/:job`, `GET landmark/file/:id`). Origin is checked and CORS is same-origin.

- `POST tick` uses TypeSafe `jev-1.14.0` (2.5 s timeout), then Workers AI `@cf/cloudflare/clef-flash`,
  then returns no probabilities and the client falls back (`lib/typesafe.ts`).
- `POST share` stores a spec in KV for 30 days under a hash id (`routes/share.ts`). The client prefers a
  link that carries the whole spec: `app/src/share.ts` deflates it with fflate into the URL hash and uses KV
  only above 4000 characters.
- Landmarks (`routes/landmark.ts`, `lib/tripo.ts`): optional text-to-3D through Tripo or Meshy, capped per
  day, GLB kept in KV or R2, swapped into the world when ready (`engine/landmark.ts`).
- `worker/wrangler.toml` binds the built app as static assets, KV (`TOWNS`), Workers AI and the rate
  limiter. `[env.dev]` sets `MOCK=1`.
- Vercel: `vercel.json` rewrites `/api/*` to one Edge function, `api/index.ts`, which supplies a
  per-instance in-memory store and environment variables to the same `worker.fetch`. `share` answers 503
  and `load` 404 there because nothing durable exists; the whole-spec link still works. The Workers AI
  and rate-limit bindings are absent on Vercel.

## Tests

`npm test` runs Vitest over `tests/**/*.test.ts` in the Node environment. Areas: `world`, `town`, `engine`,
`engine-nav`, `npc`, `ui-net`, `worker`, `game`, `integration`. `tests/worker/_live/` calls a running Worker
and is skipped unless `LIVE=1`. `npm run typecheck` checks the app and the Worker.
