# Submission

## Links

- Live demo: https://worldsmith-vvr.vercel.app
- Demo password: (the value of `SITE_PASSWORD` set on the host; any user name)
- Source: https://github.com/sricursion/worldsmith
- Video: VIDEO_URL
- Third-party credits: https://github.com/sricursion/worldsmith/blob/main/docs/THIRD_PARTY.md
- Architecture: https://github.com/sricursion/worldsmith/blob/main/docs/architecture.md

## Written description (about 170 words)

Worldsmith turns a sentence into a world you can walk through. Type any prompt, from a rain-soaked
harbour to a dragon's lair or a colony on Mars, and a staged model compile streams back a world spec: the
land and water, the sky and weather, the buildings, the plants, the people and animals, and a short quest.
The browser builds all of it procedurally in three.js. Buildings and props come from skeleton families,
parametric structures with dials, so nothing is hand-placed for a theme and one family can be a saloon, a
longhouse or a tenement. Surfaces, sound and bodies are generated too, the land goes on past the edge of
the place, and the quest is checked to be winnable before you start. You can talk to the people, who
answer in character and follow daily schedules. Then you can rewrite the rules in plain language, for
example "everyone must be home after dark". The engine turns the sentence into a typed rule, applies it,
and explains what it did in a "why" overlay. A world fits in a share link.

## Focus category

Recommended: the category closest to interactive 3D scene generation from text, because the whole pipeline
is prompt to walkable scene, with the rule editor as the working-logic half. The category list must be
checked against the official hackathon page before choosing; if there is a separate logic or agents
category, pick by whichever the judges' own wording matches best.

## Video script (target 2:40, hard limit under 3:00)

Record the browser at 1080p. Narration is first person and plain. Prompts are in quotes and typed live on
screen. Every prompt below has been compiled before (outputs in `tests/worker/_live/out/`), but
rehearse each one on the hosted demo with real models (`/api/health` must say `"mock":false`) and keep
whichever world looks best. Generation takes tens of seconds, so cut the waiting and show the timer or
the streaming text instead.

0:00 to 0:12. Landing card. Type "a forest of giant glowing mushrooms where tiny folk live" and press
Enter. The build panel follows the stages as they arrive.
Line: "One sentence is the whole input."

0:12 to 0:30. The world appears behind the panel as soon as the look stage lands, while the story is
still being written. Slow turn to show land, sky and buildings. When
the story lands the badge reads "quest verified" with a step count.
Line: "The model writes the world as data in stages. The browser builds it, and checks the quest can be
finished."

0:30 to 0:55. Walk first person, hold Shift to run, cross open ground past the last building. Press V for a
second of third person, then back.
Line: "Every building here comes from a skeleton family with dials: stalk height, cap width, how ruined. The land,
the surfaces and the sound are generated, and the land keeps going."

0:55 to 1:20. Walk up to a person, press E. Their line streams in; the objective on the HUD updates. Say one
short thing back.
Line: "People follow schedules and answer in character. What they say moves the quest, because the engine
holds the state."

1:20 to 1:55. Press R. Type "let time run ten times faster and everyone must be home after dark" and apply.
The rule appears in the list; the clock runs fast. People head for their homes (speed this shot up
if the move takes longer than a few seconds). Press ? and show the overlay line naming the move and its
reason.
Line: "Now I change the rules in plain language. The sentence becomes a typed rule, the engine applies it, and
when I ask why, it answers from its own log."

1:55 to 2:20. Three cuts of about 8 seconds each, the typed prompt as a caption, then a few seconds of walking:
"an underwater coral city", then "the first colony on Mars", then "a dragon's volcanic lair".
Line: "Same engine, no hand-placed theme. Water, a colony, a lair."

2:20 to 2:40. Back to a wide shot of the first world, then an end card with the repo and demo links.
Line: "A staged model compile writes a WorldSpec. A browser engine builds it from 43 skeleton
families, with generated surfaces, endless land, a navmesh and rules. Link below."

Recording notes: record the opening prompt, the talk and the rule edit as separate takes and join them, so
a slow compile or a bad line does not spoil the rest. The rule takes effect on the next engine tick, so
allow a few seconds after applying it. Add captions in case the audio is muted.

## Pre-submission checklist

- Repo is public, `README.md` has the real demo link in place of `DEMO_URL`, `LICENSE` is present.
- No secrets in the repo or history: `worker/.dev.vars` is gitignored; search for key-shaped strings.
- Check commit messages and author fields over the whole branch before the final push.
- Hosted demo opens in a fresh private window in Chrome and one other browser, on a normal laptop GPU.
- `GET /api/health` on the hosted demo returns `"mock":false` and the model key is set in the host's environment.
- `worker/wrangler.toml` still has `REPLACE_WITH_KV_NAMESPACE_ID` for the KV binding: replace it before a Worker deploy.
  On Vercel this does not apply; the build is `vite build` and the Edge function is `api/index.ts`.
- Daily token budgets (`BUDGET_*`) are high enough for judges to try several prompts; a "resting" message is the failure to avoid.
- Run the example chips and three of your own on the hosted demo: world loads, people move, one rule works.
- The share link round-trips: copy it, open it in a private window, the same world loads.
- `npm test` and `npm run typecheck` pass on the commit being submitted.
- Video is under 3:00, uploaded, link opens without signing in, the audio is audible.
- Written description pasted from this file; focus category chosen from the official list.
- Third-party credits link points at `docs/THIRD_PARTY.md`.
- Submit before the deadline shown on the official page (noted earlier as 2026-11-11 16:30 CEST; confirm).
