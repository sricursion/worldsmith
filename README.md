# Worldsmith

Type a sentence and walk into the world it describes. Worldsmith turns any text prompt into a
first-person 3D place in the browser: land, water, sky, buildings, plants, people and animals, built
procedurally in three.js from a spec a language model writes. You can talk to the people, follow a quest
the engine has checked can be finished, and change how the world behaves by writing rules in plain language.

Made for the Victoria VR AI Builder Hackathon 2026.

## Try it

Demo: DEMO_URL

Type a prompt and press Enter, or pick one of the example chips. Prompts that work well range from
a western town in 1874 to a dragon's lair, a seabed city or a colony on Mars.

Controls: WASD to move, mouse to look, Shift to run, E to talk, R for the rules panel, ? for the "why"
overlay, V to switch between first and third person. Then try a rule such as
`everyone must be home after dark` and watch the people walk home.

## How it works

1. The browser sends the prompt to `POST /api/compile`. The Worker runs three model calls and streams
   the results back as server-sent events: an outline (what kind of place, how built-up, the land, the
   people, the creatures, the sky), then in parallel a look (building skeletons with dials, palette,
   props, landmarks) and a story (people, items, quest, starting rules).
2. The client shows the world as soon as the look arrives, then swaps in the full spec when the story
   lands, keeping the player where they stand. The spec is cleaned up (`coerceSpec`), checked with zod
   (`validateSpec`), normalised, and the quest is repaired and verified by a graph walk.
3. `generateLayout` plans streets, lots, water and points of interest. `buildTown` builds terrain,
   water, buildings from blueprints, props, signs and ground cover. Surfaces (wood, stone, rust, ice and
   so on) are generated in the browser as PBR maps.
4. The land keeps going past the edge of the place: ground, plants and a place worth walking to every
   few hundred metres (standing stones, a camp, a great tree) stream in around the player.
5. A Recast navmesh is baked over the place. The player walks it, and walks on over open land beyond it.
   People follow hourly schedules on a crowd simulation.
6. Every 20 seconds the engine asks a decision model to pick each person's next action from options the
   engine offers; if that call fails, a local weighted choice is used.
7. Rules typed in plain language go to `POST /api/rules/patch` and come back as typed effects (curfew,
   ban, price, mood, time scale, weather, schedule override, relationship). The engine applies them and
   the "why" overlay shows the last twelve log lines with the reason for each move.

Models write data. The engine runs the world.

## What makes it general

- Nothing is placed by hand for a theme. Buildings and props come from skeleton families: parametric
  bone structures with dials, such as `hall`, `tower`, `hull`, `cave`, `bridge`, `broadleaf`, `crystal`
  and `statue`. The prompt supplies the dial settings, the colours, the surfaces and extra parts, so the
  same `shell` family becomes a mushroom house in one world and a beehive or a jellyfish tower in
  another, and `hall` can be a saloon, a longhouse or a tenement. Every structure family also takes a
  `ruin` dial that turns it into its own ruin.
- There are 43 families (25 structure, 13 nature, 5 object) in
  `app/src/world/skeletons/`, and every dial is clamped, so any model output builds something valid.
- Creatures come from ten body plans (quadruped, biped, winged, serpent, bird, swimmer, crawler,
  floater, colossus, swarm) reshaped by dials. The people are a body plan too (height, bulk, head size,
  features, skin and cloth colours), with the modelled human bodies used where the folk are human.
- Terrain relief, water kind, weather, colour grade, sky features, ambience and music are all fields in
  the spec. Sound is synthesised in the browser.
- The spec is plain JSON with no engine objects, so a world fits in a share link: it is deflated into
  the URL hash.

## Run locally

Needs Node 22 or newer.

```
npm install
npm run worker:dev     # Worker on http://127.0.0.1:8788, answers from fixtures (MOCK=1)
npm run dev            # app on http://127.0.0.1:5173, proxies /api to the Worker
```

Run the two commands in separate terminals. Mock mode needs no keys. For real models, copy
`worker/.dev.vars.example` to `worker/.dev.vars` (gitignored), fill in the keys and set `MOCK=0`.

Environment variable names (set values yourself, never commit them):

- `ANTHROPIC_API_KEY` required for real compile, rules and dialogue.
- `ANTHROPIC_BASE_URL` optional gateway origin.
- `GROQ_API_KEY` optional, fallback for NPC lines.
- `TYPESAFE_API_KEY` optional, decision model for NPC actions.
- `TRIPO_API_KEY` or `MESHY_API_KEY` optional, landmark models.
- `MOCK` set to `1` to force fixtures.
- `BUDGET_SESSION_TOKENS`, `BUDGET_IP_TOKENS`, `BUDGET_GLOBAL_TOKENS`, `LANDMARK_DAILY_CAP` optional
  daily ceilings (defaults in `worker/src/lib/budget.ts` and `wrangler.toml`).

Other scripts: `npm run build`, `npm run preview`, `npm run typecheck`, `npm run worker:deploy`,
`npm run deploy` (build, then deploy the Worker), `npm run assets:fetch`, `npm run assets:optimize`.

Hosting: the Worker serves the built app and `/api/*` (`worker/wrangler.toml`), or Vercel serves `dist/`
and one Edge function (`api/index.ts`, `vercel.json`). On Vercel there is no durable store, so short
share ids and landmark files are unavailable and the share link carries the whole world.

## Tests

```
npm test
```

Vitest over `tests/`: 65 test files with about 800 test cases, covering the spec and schema,
skeletons, layout, terrain and endless land, surfaces, navmesh and player, NPC brain and dialogue, the
UI and network clients, and the Worker. The live-model check in `tests/worker/_live/` is skipped unless
`LIVE=1`.

## Credits

Quaternius human models are the only third-party art in compiled worlds; Kenney and KayKit kits remain as
a fallback. All are CC0. Full list, licences and npm dependencies: [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md).
Design notes: [docs/architecture.md](docs/architecture.md).

## Licence

MIT for the code, see `LICENSE`. Third-party assets keep their own terms, listed in `docs/THIRD_PARTY.md`.
