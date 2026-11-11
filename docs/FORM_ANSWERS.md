# Submission form answers

Paste each block into the field with the same number.

## 3. Project name

Worldsmith

## 4. Project description

Worldsmith turns one sentence into a world you can walk through, talk to and re-rule, in a browser tab, in about half a minute.

The problem: an interactive 3D scene still takes a modeller, a level designer and a programmer, and days of work. That shuts out most of the people who have a world in their head: writers, teachers, game masters, designers testing an idea, anyone building for a virtual world without a studio behind them. Tools that generate a single 3D object do not solve it, because an object is not a place and has no behaviour.

What it does: type a place ("a research base on Mars", "an Edo village in autumn", "an underwater coral city") and you are standing in it in first person. The world has shaped land and water, its own sky and weather, buildings, plants, people and animals, and a short quest that code has checked can be finished. You talk to the people and they answer in character. Then you change how the world works in plain language ("everyone must be home after dark"): the sentence becomes a typed rule, the simulation obeys it, and a "why" overlay shows which rule caused which behaviour. Any world can be shared as a link.

Scene and logic both come from plain language, with nothing to install and nothing to learn.

## 5. What makes your project unique?

Most text-to-3D tools give you one of three things: a single static mesh, a scene assembled from a fixed asset library (so every prompt looks like the library), or generated code that breaks. Worldsmith does none of these.

1. It generates the grammar, not the assets. Every building, plant and object is grown from one of 60 skeleton families (hall, keep, arena, pier, coral, vehicle and so on). A family fixes only the bones; the prompt supplies dials, colours, materials and extra parts. One family is a saloon in one world and a mushroom clinic in the next, and no two buildings in a world are identical. Terrain, surfaces, sky, water, creatures and sound are generated in the browser too. The only pre-made art in a generated world is the rigged human models.

2. It is general by construction, and measured. In one run of 16 unrelated prompts (Mars base, midtown Manhattan, Edo village, coral city, Mayan temple city, Moroccan bazaar, candy kingdom and others) all 16 produced a complete walkable world with people, creatures and a quest, in 26 to 46 seconds each, with no fallback content.

3. The logic is real, not narrated. A rule typed in plain language compiles to a typed rule that the simulation enforces and can explain, and can be removed again. The quest is proven completable by code before the player starts. The model never gets to pretend something happened.

4. It cannot crash on a bad generation. The model returns a spec, never code; a validator repairs and clamps whatever comes back, so the world always builds.

The result is a full loop from sentence to place to behaviour, with no install, in a browser tab.

## 6. Public source code repository URL

https://github.com/sricursion/worldsmith

## 7. Live browser demo URL

https://worldsmith-vvr.vercel.app

## 8. Demo video URL

https://worldsmith-vvr.vercel.app/demo

## 9. Demo access instructions

1. Open https://worldsmith-vvr.vercel.app in a current desktop Chrome, Edge or Firefox (WebGL 2 needed; a laptop with a dedicated or recent integrated GPU is recommended).
2. The browser asks for a user name and password. This is a shared demo credential, not a personal one. User name: anything (for example "judge"). Password: PASTE_DEMO_PASSWORD_HERE
3. Type any place in the box, or click one of the examples, and press Enter. A world takes roughly 25 to 45 seconds; the panel shows each stage as it arrives.
4. Controls: WASD to move, mouse to look, Shift to run, E to talk to the person you face, R to open the rules panel, ? for the "why" overlay. "New world" returns to the prompt.
5. Things to try: talk to a character and follow the objective; open Rules and type a rule in plain language such as "everyone must be home after dark"; build two very different prompts to compare.

## 10. Technologies and frameworks used

- Rendering and engine: three.js 0.186 (WebGL 2), TypeScript, Vite; three-mesh-bvh for collision; custom procedural geometry, generated PBR surface maps, sky, weather, water and post-processing shaders.
- Navigation: recast-navigation (WebAssembly navmesh and crowd).
- AI model: Anthropic Claude Sonnet 5.5 through the Messages API, used at runtime for the staged world compile (outline, look, story, spec), for turning plain-language rules into typed rules, and for character dialogue. Responses stream over server-sent events.
- Validation: zod schema for the world spec, with a normaliser that repairs and clamps whatever the model returns.
- Backend: one fetch-handler API, deployed as a Vercel Edge Function (also runs as a Cloudflare Worker for local development with wrangler).
- Audio: Web Audio API, synthesised in the browser.
- Other: fflate (share links), poisson-disk-sampling (placement), vitest (about 1,800 automated tests).

## 11. How does your project transform natural language into interactive 3D experiences?

The model never writes code or meshes. It writes a typed description of a world, and deterministic code builds and runs it.

1. Prompt to spec. A staged compile streams back in parts: an outline (name, setting, site, terrain), then the look (palette, materials, sky, and building and prop blueprints chosen from 60 skeleton families with their dials) and the story (people, items, a quest, starting rules), merged into one WorldSpec. The browser shows each stage as it lands, so the wait reads as the world taking shape.
2. Spec to scene. The client validates and repairs the spec, expands every family and its dials into parts, and builds the world procedurally: carved terrain and water, a street plan chosen by the kind of site (grid, ring, single street, terraces, shoreline, scatter and others), buildings with real openings and roofs, plants and rocks shaped per instance, generated surfaces, sky and weather, people and animals from body plans, and a navmesh so everyone can walk. Land keeps streaming in past the edge of the settlement.
3. Generated logic. Code checks the quest can be completed. Characters follow daily schedules and answer in character through the model, held to the world's facts. A rule typed in plain language is compiled to a typed rule (who, when, where, what), validated, and enforced by the simulation on its next tick; the "why" overlay shows which rule drove which behaviour, and rules can be removed.
4. Interaction. The player walks in first person, talks to people, picks up and gives items, follows or ignores the quest, rewrites the rules, and shares the world as a link that rebuilds the same world for anyone.

## 12. Third-party materials and licenses

Full attribution file: https://github.com/sricursion/worldsmith/blob/main/docs/THIRD_PARTY.md

- Libraries (npm): three (MIT), three-mesh-bvh (MIT), recast-navigation and @recast-navigation/three (MIT), zod (MIT), fflate (MIT), poisson-disk-sampling (MIT); development only: TypeScript (Apache-2.0), Vite (MIT), vitest (MIT), wrangler.
- 3D assets, all CC0 1.0: Quaternius animated humans (people in every world); Kenney and KayKit kits (used only as a fallback for specs without generated blueprints). Buildings, plants, props, terrain, surfaces, sky and sound in compiled worlds are generated by the project's own code.
- API: Anthropic Messages API (Claude Sonnet 5.5), used under Anthropic's commercial terms.
- Hosting: Vercel.
- No datasets and no pre-trained model weights are shipped. The project's own code is MIT licensed.
