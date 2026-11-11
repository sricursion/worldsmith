# Submission form answers

Paste each block into the field with the same number.

## 3. Project name

Worldsmith

## 4. Project description

Type a sentence. Thirty seconds later you are standing inside it.

Worldsmith turns plain language into a complete, living 3D world in a browser tab: land and water, sky and weather, buildings, plants, people, animals, and a quest. You walk it in first person, talk to the people who live there, and then rewrite how the world works by typing a rule in plain English.

The problem. An interactive 3D scene still costs a modeller, a level designer, a programmer and days of work. That shuts out almost everyone who has a world in their head: writers, teachers, game masters, designers testing an idea, creators building for virtual worlds without a studio behind them. Text-to-3D tools that return one object do not fix this. An object is not a place, and it has no behaviour.

What it does.
- Scene from language: "a research base on Mars", "an Edo village in autumn", "an underwater coral city" each become a different, fully walkable world, not a reskin of one template.
- People from language: every character has a role, a daily schedule and a voice, and answers in character.
- Logic from language: type "everyone must be home after dark" and it becomes a typed rule the simulation enforces. A "why" overlay shows which rule caused which behaviour.
- A quest that code has proven can be finished, and a share link that rebuilds the same world for anyone.

Nothing to install, nothing to learn, no asset library to run out of.

## 5. What makes your project unique?

Existing text-to-3D gives you one of three things: a single static mesh, a scene assembled from a fixed asset library (so every prompt looks like the library), or generated code that breaks. Worldsmith does none of these.

1. It generates the grammar, not the assets. Every building, plant and object is grown from one of 60 skeleton families (hall, keep, arena, pier, coral, vehicle and more). A family fixes only the bones. The prompt supplies the dials, colours, materials and extra parts. The same family is a saloon in one world and a mushroom clinic in the next, any structure can stand as its own ruin, and no two buildings in a world are identical. Terrain, surfaces, sky, water, creatures and sound are generated in the browser as well. The only pre-made art in a generated world is the rigged human models.

2. It is general, and we measured it. In one run of 16 unrelated prompts (Mars base, midtown Manhattan, Edo village, coral city, Mayan temple city, Moroccan bazaar, candy kingdom and others) all 16 produced a complete walkable world with people, creatures and a quest, in 26 to 46 seconds each, with zero fallback content.

3. The logic is real, not narrated. A plain-language rule compiles to a typed rule that the simulation enforces, explains and can undo. The quest is proven completable by code before the player starts. The model never gets to pretend something happened.

4. A bad generation cannot break it. The model returns a typed description, never code. A validator repairs and clamps whatever comes back, so a world always builds. About 1,800 automated tests hold that line.

5. It is one loop, not a pipeline of tools: sentence to place to people to behaviour, streamed live so you watch the world take shape, in a browser tab with no install.

## 6. Public source code repository URL

https://github.com/sricursion/worldsmith

## 7. Live browser demo URL

https://worldsmith-vvr.vercel.app

## 8. Demo video URL

https://worldsmith-vvr.vercel.app/demo

## 9. Demo access instructions

The demo is behind a shared demo password so the public cannot spend the model budget. This is a test credential made for judging, not a personal password.

1. Open https://worldsmith-vvr.vercel.app in a current desktop Chrome, Edge or Firefox (WebGL 2; a laptop with a dedicated or recent integrated GPU is recommended).
2. When the browser asks, enter any user name (for example "judge") and the password: PASTE_DEMO_PASSWORD_HERE
3. Type any place, or click an example, and press Enter. A world takes about 25 to 45 seconds. The panel shows each stage as it arrives and you can start walking as soon as the buildings stand.

The 90-second tour:
- Walk: WASD to move, mouse to look, Shift to run.
- Talk: face a person and press E. Ask them about the objective shown bottom left.
- Change the rules: press R and type a rule in plain language, for example "everyone must be home after dark". Press ? to see why people now behave as they do.
- Prove it generalises: click "New world" and type something completely different, real or invented.

If a build fails or a saved world is shown instead, a banner says so and offers "Try again".

## 10. Technologies and frameworks used

AI
- Anthropic Claude Sonnet 5.5 (Messages API): staged world compile (outline, look, story, spec), plain-language rule compilation, and in-character dialogue. Streaming over server-sent events, prompt caching on the system prompts.
- Optional providers wired in the code and enabled by key: Groq (dialogue fallback), Cloudflare Workers AI and the Typesafe API (character decision ticks), Tripo and Meshy text-to-3D (hero landmark models). The hosted demo runs on Claude Sonnet 5.5 alone.

3D engine (all in the browser)
- three.js 0.186 on WebGL 2, TypeScript, custom GLSL shaders for water, weather, sky bodies, aerial haze and colour grading.
- Post-processing: EffectComposer, GTAO ambient occlusion, bloom; lighting driven by the generated sky.
- Procedural generation written for this project: 60 parametric skeleton families, per-instance shaped geometry, generated PBR surface maps, terrain and water carving, street plans, endless streamed land, body plans for people and creatures.
- three-mesh-bvh (collision and camera), recast-navigation in WebAssembly (navmesh and crowd), poisson-disk-sampling (placement), merged and instanced geometry, meshopt-compressed glTF via GLTFLoader for the human models.

Simulation and logic
- Typed WorldSpec with a zod 4 schema and a repairing normaliser; typed rule engine with an explanation trace; quest solvability verifier; seeded deterministic generation.

Audio and voice
- Web Audio API (synthesised ambience and music), Web Speech API (character voices).

Platform
- Vite 8 build, Vercel Edge Functions and Routing Middleware for hosting; the same API also runs as a Cloudflare Worker (wrangler, KV, R2, rate limiting).
- Browser APIs: Pointer Lock, WebAssembly, fetch streaming, fflate-compressed share links.

Quality and tooling
- vitest (about 1,800 tests), TypeScript strict mode, glTF-Transform for asset optimisation, Git and GitHub.

## 11. How does your project transform natural language into interactive 3D experiences?

The model never writes code or meshes. It writes a typed description of a world, and deterministic code builds and runs it. That is why it is fast, why it cannot crash, and why the logic is real.

1. Sentence to spec (about 30 seconds, streamed). A staged compile returns in parts: an outline (name, setting, site, terrain), then the look (palette, materials, sky, and building and prop blueprints picked from 60 skeleton families with their dials) and the story (people, items, a quest, starting rules). The first text arrives in about two seconds and the browser shows each stage as it lands.

2. Spec to scene (in the browser). The client validates and repairs the spec, expands every family and its dials into parts, and builds the world: carved terrain and water, a street plan chosen by the kind of site (grid, ring, single street, terraces, shoreline, scatter and more), buildings with real openings and roofs, plants and rocks shaped per instance, generated surfaces, sky and weather, people and animals grown from body plans, and a navmesh so everyone can walk. Land keeps streaming in past the edge of the settlement.

3. Language to logic. Code proves the quest can be completed. Characters follow daily schedules and answer in character, held to the world's facts. A rule typed in plain language is compiled to a typed rule (who, when, where, what), validated, and enforced by the simulation on its next tick. The "why" overlay traces each behaviour back to the rule that caused it, and any rule can be removed.

4. Interaction. The player walks in first person, talks to people, picks up and gives items, follows or ignores the quest, rewrites the rules, and shares the world as a link that rebuilds the same world for anyone.

Scene, characters and behaviour all come from plain language, and the same path handles a real city, a historical village and a place that has never existed.

## 12. Third-party materials and licenses

Complete attribution file: https://github.com/sricursion/worldsmith/blob/main/docs/THIRD_PARTY.md

Libraries (npm)
- three, three-mesh-bvh, recast-navigation, @recast-navigation/three, zod, fflate, poisson-disk-sampling: MIT.
- Development only: TypeScript (Apache-2.0), Vite (MIT), vitest (MIT), wrangler (MIT or Apache-2.0), glTF-Transform (MIT).

3D assets (all CC0 1.0, public domain)
- Quaternius animated humans: the people in generated worlds.
- Kenney and KayKit kits: shipped only as a fallback for specs that carry no generated blueprints.
- Everything else in a generated world (buildings, plants, props, terrain, surfaces, sky, creatures, sound) is produced by the project's own code.

APIs and services
- Anthropic Messages API (Claude Sonnet 5.5), under Anthropic's commercial terms.
- Vercel (hosting).
- Optional and off in the hosted demo: Groq, Cloudflare Workers AI, Typesafe, Tripo, Meshy, each under its provider's terms.

No datasets and no model weights are shipped. The project's own code is MIT licensed.
