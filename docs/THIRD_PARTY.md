# Third party

Everything here is either an npm dependency, a CC0 asset pack committed under `assets/third_party/`, or
an outside service the Worker calls. The code in this repository is MIT (see `LICENSE`).

## What is actually used at runtime

Worlds the model compiles are built from generated geometry, generated surfaces, generated sound and
generated body plans. The only third-party art that appears in them is the Quaternius human models
(`app/src/engine/humans/catalog.ts`, loaded by `app/src/engine/humans.ts`). The Kenney and KayKit kits are
the fallback: `app/src/town/build.ts` uses a kit mesh only when a spec has no style and no blueprints (for
example an old share link). The kit for the world's nearest theme is still loaded at start
(`ensureKit` in `app/src/game.ts`).

## Asset packs (all CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/)

Each folder under `assets/third_party/` carries the author's licence text and a `manifest.json` with file
hashes. Vite serves `assets/` as the site root, so every pack below is part of the deployed site.

Used by code:

- `quaternius-animated-humans`: Quaternius, 18 rigged people. https://poly.pizza/u/Quaternius. Human folk in every world.
- `kaykit-medieval-hexagon`: KayKit (Kay Lousberg). https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0. Medieval kit.
- `kaykit-city-builder-bits`: KayKit. https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0. Modern kit.
- `kaykit-space-base-bits`: KayKit. https://github.com/KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0. Sci-fi kit.
- `kenney-fantasy-town-kit`: Kenney. https://kenney.nl/assets/fantasy-town-kit. Medieval props.
- `kenney-space-kit`: Kenney. https://kenney.nl/assets/space-kit. Sci-fi kit.
- `kenney-city-kit-suburban`: Kenney. https://kenney.nl/assets/city-kit-suburban. Modern kit.
- `kenney-city-kit-commercial`: Kenney. https://kenney.nl/assets/city-kit-commercial. Modern kit.
- `kenney-pirate-kit`: Kenney. https://kenney.nl/assets/pirate-kit. Props.
- `kenney-survival-kit`: Kenney. https://kenney.nl/assets/survival-kit. Props.
- `kenney-nature-kit`: Kenney. https://kenney.nl/assets/nature-kit. Props.

Present in the repository and the build, not referenced by any code in `app/src`:

- `kaykit-adventurers`: Kay Lousberg. https://kaylousberg.itch.io/kaykit-adventurers. Only `app/src/engine/character.ts` points at it, and nothing calls that loader in the running game (tests do).
- `kaykit-restaurant-bits`: KayKit. https://github.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0
- `kaykit-furniture-bits`: KayKit. https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0
- `kenney-castle-kit`: Kenney. https://kenney.nl/assets/castle-kit
- `kenney-modular-space-kit`: Kenney. https://kenney.nl/assets/modular-space-kit
- `kenney-city-kit-roads`: Kenney. https://kenney.nl/assets/city-kit-roads

CC0 needs no credit, but credit is given here anyway. The fetch and optimise scripts are
`scripts/fetch-assets.mjs`, `scripts/fetch-humans.mjs` and `scripts/optimize-assets.mjs`; refresh with
`npm run assets:fetch` then `npm run assets:optimize`.

## npm dependencies (`package.json`, exact versions)

Runtime, bundled into the browser app:

- `three` 0.186.1, MIT. Rendering.
- `three-mesh-bvh` 0.9.17, MIT. Camera and collision raycasts (`app/src/engine/player.ts`).
- `recast-navigation` 0.43.1 and `@recast-navigation/three` 0.43.1, MIT. Navmesh and crowd (`app/src/engine/nav.ts`). The WebAssembly build of Recast Navigation ships inline.
- `zod` 4.3.6, MIT. Spec schema (`app/src/world/schema.ts`); also bundled into the Worker.
- `fflate` 0.8.3, MIT. Share-link compression (`app/src/share.ts`).
- `poisson-disk-sampling` 2.3.1, MIT. Prop and lot placement (`app/src/town/layout.ts`).

Development only:

- `typescript` 5.9.3 (Apache-2.0), `vite` 8.3.5 (MIT), `vitest` 4.1.4 (MIT).
- `wrangler` 4.154.0 and `@cloudflare/workers-types` 4.20260702.1 (MIT or Apache-2.0).
- `@gltf-transform/cli` 4.5.1 (MIT). Only the asset optimise script uses it.
- `@types/node` 22.19.0 and `@types/three` 0.186.0 (MIT).

Licences above were read from the installed `package.json` files.

## Outside services the Worker calls

None of these is bundled. Keys are set as environment variables and never committed.

- Anthropic Messages API, model `claude-sonnet-5-5`: world compile (outline, look, story), rule patches and NPC dialogue (`worker/src/lib/anthropic.ts`).
- Groq, model `openai/gpt-oss-120b`: fallback for NPC lines when the Anthropic call fails (`worker/src/routes/npc.ts`).
- TypeSafe, model `jev-1.14.0`: per-NPC action probabilities (`worker/src/lib/typesafe.ts`). Falls back to Cloudflare Workers AI `@cf/cloudflare/clef-flash`, then to a local weighted choice in the client.
- Tripo (default model `v3.1-20260211`) or Meshy: optional text-to-3D for one or two landmark models per world (`worker/src/lib/tripo.ts`). Off unless a key is set.
- Hosting: Cloudflare Workers with static assets (`worker/wrangler.toml`) or Vercel with an Edge function (`api/index.ts`, `vercel.json`).

## Browser features

Speech output uses the browser's own `SpeechSynthesis`. All sound effects, ambience and music are
synthesised with the Web Audio API; no audio or font files are downloaded.
