# Townforge

Type a sentence, get a small playable town. Townforge compiles a plain-language prompt into a data
spec, lays out streets and buildings deterministically, fills the town with NPCs on schedules, and
generates a quest that is checked to be winnable. You walk in, talk to people, and rewrite the
town's rules in plain language while it runs.

Built for the Victoria VR AI Builder Hackathon 2026.

## Try it

Demo: `DEMO_URL_PLACEHOLDER`

Prompts to start with:

1. `a Wild West town in the Arizona Territory, 1874, with a missing payroll`
2. `PROMPT_2_PLACEHOLDER`
3. `PROMPT_3_PLACEHOLDER`

Controls: WASD to move, E to talk, R to open the rule editor, ? to ask why something happened.
After the town loads, try the rule `nobody is allowed in the saloon after dark` and watch the
regulars leave.

## How it works

1. **Prompt.** The prompt is hashed into a seed and mapped to the nearest theme kit. A skeleton town
   of boxes is on screen within a second while the kit and characters load.
2. **Compiled world spec.** The compile model streams a `WorldSpec` (buildings, NPCs, items, quest,
   rules). The client validates it with zod, normalizes it, repairs unreachable quest steps, and
   verifies the quest by graph walk. The HUD shows the result, for example "quest verified, 6 steps".
3. **Deterministic layout.** `generateLayout` places a main street, cross streets, lots, a plaza and
   props from the spec and the seed. The same spec always produces the same town.
4. **Navmesh and crowd.** The built town is baked into a Recast navmesh. The player and every NPC
   walk it with a crowd simulation and a wall-sliding third-person camera.
5. **Schedules and a decision model.** Each NPC has an hourly schedule. Every 20 seconds the engine
   offers each NPC three to five options and a decision model returns per-option probabilities, which
   are sampled client-side with a seeded stream and the NPC's temperament. If the call fails, a local
   weighted fallback keeps everyone moving. Dialogue lines stream from a separate model and are
   validated before they are shown.
6. **Live rule rewriting.** Type a rule in plain language. The Worker turns it into a typed effect
   (curfew, ban, price, mood, weather, time scale, schedule override), the engine applies it, the next
   tick re-plans, and the "why?" overlay cites the rule from engine state.

Models emit data. The engine runs the world. If a behaviour cannot be explained from engine state,
it does not ship.

## Why this generalises

- The world spec is data. It is JSON-serialisable and has no engine objects in it.
- There are four theme kits (western, medieval, sci-fi, modern). Any prompt maps to the nearest kit,
  and the model supplies names, people, plot and slang on top of it.
- The same engine runs every town. Layout, pathing, schedules, rules and quest state do not know which
  theme they are in.
- The Worker is a thin proxy: it forwards to the models, rate-limits, and stores shared worlds. It
  holds no game logic.
- Share links carry the whole world. The spec is compressed into the URL hash; larger worlds go to KV
  with a 30-day expiry.
- Every mesh, texture, animation and sky is a static file. Nothing is generated at runtime, so a town
  that works once works again.

## Run locally

```
npm install
npm run dev            # app on the Vite dev server
npm run worker:dev     # Worker on wrangler dev, in a second terminal
```

Set `MOCK=1` for the Worker and no keys are needed: it answers from the hand-written fixture towns.
A missing key has the same effect.

For real models, set these secrets with `wrangler secret put` or in a gitignored `worker/.dev.vars`:

- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`
- `TYPESAFE_API_KEY`
- `TURNSTILE_SECRET`

Other scripts: `npm test`, `npm run typecheck`, `npm run build`, `npm run worker:deploy`,
`npm run assets:fetch`, `npm run assets:optimize`.

Model routing in the Worker: world compile and rule patches call Claude Sonnet 5.5; NPC lines call
Claude Haiku 5.5, retry on Sonnet after a refusal, and fall back to Groq gpt-oss-120b on vendor
error; per-tick decisions call Jev 1.14 through TypeSafe, with a Workers AI fallback.

## Architecture

Full module contracts and the game flow are in [docs/architecture.md](docs/architecture.md).

```
app/src/main.ts      boot, renderer, game loop
app/src/game.ts      prompt -> compile -> layout -> build -> play
app/src/world/       spec types, schema, fixtures, quest verifier, state reducer
app/src/town/        deterministic layout and scene builder
app/src/engine/      renderer, sky, input, assets, characters, navmesh, player
app/src/npc/         schedules, decision sampling, dialogue, speech
app/src/net/         fetch and SSE clients for the Worker API
app/src/ui/          prompt, HUD, dialogue, rule editor, why overlay
worker/src/          Cloudflare Worker: model proxy, share links, rate limits
assets/, tests/      static CC0 kits; vitest tests mirroring app/src
```

## Credits

All 3D models are CC0 packs by Kenney and KayKit (Kay Lousberg), committed under
`assets/third_party/` with their licenses and hash manifests. Pack list and sources:
[docs/THIRD_PARTY.md](docs/THIRD_PARTY.md).

## License

MIT for the code in this repository. LICENSE_PLACEHOLDER: add `LICENSE` with the author name and year.
Third-party assets keep their own CC0 licenses.
