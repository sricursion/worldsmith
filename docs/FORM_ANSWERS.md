# Submission form answers

Paste each block into the field with the same number.

## 3. Project name

Worldsmith

## 4. Project description

Worldsmith turns one sentence into a world you can walk through in the browser. Building an interactive 3D scene normally takes modelling, level design and scripting skills; here you type a place ("a research base on Mars", "an Edo village in autumn", "an underwater coral city") and about half a minute later you are standing in it in first person. The world has shaped land and water, its own sky and weather, buildings, plants, people and animals, and a short quest that is checked to be winnable before you start. You can talk to the people, who answer in character, and you can change how the world works in plain language ("everyone must be home after dark"): the sentence becomes a typed rule, the world obeys it, and a "why" overlay explains each decision. A world can be shared as a link.

## 5. What makes your project unique?

Nothing is hand-built per theme. Every building, plant and object is grown from one of 60 "skeleton families": parametric structures (hall, tower, keep, arena, pier, coral, vehicle and so on) that fix only the bones. The prompt supplies the dials, colours, materials and extra parts, so the same family is a saloon in one world and a mushroom clinic in the next, and no two buildings in a world are identical. Surfaces, terrain, sky, people, creatures and sound are generated in the browser as well, so the system is not limited to a fixed asset library and works for real places, historical settings and invented ones alike. The second half is working logic: plain-language rules compile to typed rules the simulation enforces and can explain, rather than free text the model merely narrates. The quest is verified solvable by code, not assumed.

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

1. Prompt to spec. The prompt goes to a staged compile that streams back in parts: first an outline (name, setting, site and terrain), then the look (palette, materials, sky, building blueprints and props chosen from the skeleton families with their dials) and the story (people, items, a quest, starting rules), merged into one typed WorldSpec. The browser shows each stage as it lands.
2. Spec to scene. The client validates and repairs the spec, expands every family and its dials into parts, and builds the world procedurally: carved terrain and water, a street plan chosen by the kind of site, buildings with real openings and roofs, plants and rocks shaped per instance, generated surfaces, sky and weather, people and animals built from body plans, and a navmesh so everyone can walk. Land keeps streaming in beyond the settlement.
3. Generated logic. The quest is checked by code to be completable. Characters follow schedules and answer in character through the model, constrained by the world's facts. A rule typed in plain language is compiled into a typed rule (who, when, where, what), validated, and enforced by the simulation on its next tick; the "why" overlay shows which rule drove which behaviour. Rules can be removed again.
4. Interaction. The player walks in first person, talks to people, picks up and gives items, follows or ignores the quest, edits the rules, and shares the world as a link.

## 12. Third-party materials and licenses

Full attribution file: https://github.com/sricursion/worldsmith/blob/main/docs/THIRD_PARTY.md

- Libraries (npm): three (MIT), three-mesh-bvh (MIT), recast-navigation and @recast-navigation/three (MIT), zod (MIT), fflate (MIT), poisson-disk-sampling (MIT); development only: TypeScript (Apache-2.0), Vite (MIT), vitest (MIT), wrangler.
- 3D assets, all CC0 1.0: Quaternius animated humans (people in every world); Kenney and KayKit kits (used only as a fallback for specs without generated blueprints). Buildings, plants, props, terrain, surfaces, sky and sound in compiled worlds are generated by the project's own code.
- API: Anthropic Messages API (Claude Sonnet 5.5), used under Anthropic's commercial terms.
- Hosting: Vercel.
- No datasets and no pre-trained model weights are shipped. The project's own code is MIT licensed.
