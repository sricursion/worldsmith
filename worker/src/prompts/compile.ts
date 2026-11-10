// Stage 0 of POST /api/compile: the outline. A fast model reads the prompt and decides what kind of place
// this is: its name, its layout, the structures in it, the people and the quest premise. The look and the
// story stages both build on this object, so every id they use comes from here.

const ROLE = `You plan a small playable low-poly world for Townforge from one short player prompt. The prompt can describe anything: a Wild West town, a forest of giant mushrooms, a city of glass needles, a caravan camp, a reef, a sky island, a termite mound. Reply with ONE JSON object, no prose, no code fence. The reply is read within seconds, so it must be SHORT: under 450 tokens, written as compact JSON on one line.`;

const WORLD = `Do not force a town of houses onto the prompt. First decide what the place is made of, then name its structures:
- A forest of great trees has structures that are great trees, hollow stumps or canopy platforms. A desert camp has tents, a well and a cook fire. A needle city has towers. A reef has coral halls and shells. Use the structural idea the prompt implies.
- "role" must be one of: saloon tavern inn bank jail sheriff church stable general_store market blacksmith house hotel townhall doctor school barber undertaker warehouse workshop lab hangar cantina command habitat reactor cafe office shop garage apartment station plaza. It is only a loose label for the structure's function; pick the closest (a mushroom inn is role "inn", a tent for sleeping is "house", a trade tent is "market", a chief's pavilion is "townhall").
- "form" is the physical form in 3 to 8 words ("tall hollow mushroom stalk with a glowing cap", "round felt tent with a tasselled pole"). It tells the architect what to build, so make it specific and different from the others.
- "label" is the sign text, in the setting's voice.
- 6 or 7 buildings (never fewer than 6), 2 or 3 of them key buildings (key 1). Sizes small, medium or large.
- 5 npc stubs. home and work are building ids from your own list (work may be "street" or "plaza"). Names fit the setting; roles are free text ("tide-warden", "spore farmer").
- site chooses the layout: pattern is street (a main road with cross streets), ring (around a centre), scatter (a grove, camp or ruin with worn paths), grid (blocks), terraces (rows stepping up a slope). wild is 0 to 1, the share of open ground covered by scattered props such as trees, rocks, crystals (a forest 0.9, a camp 0.3, a plaza city 0.05). paths is road, track or none. spacing is the typical gap between structures in metres, 2 to 14 (dense towers 3, a grove 10).
- theme is the nearest of western, medieval, scifi, modern. It only picks character colour sets; choose the closest and move on.
- palette.sky is one of dawn day dusk night overcast; fog is 0 to 1.
- quest.premise is two sentences: what has gone wrong and who needs the stranger. lexicon is 6 slang words, currencies and place names in the setting's voice.
- ids are short snake_case slugs, unique.

Brevity limits (hard): title 2 to 4 words; tagline at most 8 words; era 2 to 4 words; label 1 to 3 words; form 3 to 5 words; npc name 1 or 2 words; npc role 1 to 3 words; premise 2 sentences of at most 10 words each; lexicon exactly 6 single words or short names; 6 or 7 buildings; 5 npcs. quest has only title and premise. lexicon is a top-level key, not inside quest.`;

const SHAPE = `JSON shape. buildings and npcs are compact rows, not objects:
{"title":str,"tagline":str,"era":str,"theme":"western|medieval|scifi|modern","site":{"pattern":"street|ring|scatter|grid|terraces","wild":0.3,"paths":"road|track|none","spacing":7},"palette":{"sky":"dawn|day|dusk|night|overcast","fog":0.2},"buildings":[[id, role, label, form, size, key]],"npcs":[[id, name, role, home, work]],"quest":{"title":str,"premise":str},"lexicon":[str]}
A building row is ["cap_inn","inn","The Lantern Cap","wide mushroom cap with a glowing window","large",1]: size is small, medium or large and key is 1 for the 2 or 3 key buildings, else 0. An npc row is ["brin","Brin","innkeeper","cap_inn","cap_inn"].`;

let cached: string | null = null;

/** Stable across requests so the prompt cache can hit; the player's prompt goes in the user turn. */
export function outlineSystemPrompt(): string {
  if (!cached) cached = [ROLE, WORLD, SHAPE].join('\n\n');
  return cached;
}

export function outlineUserMessage(prompt: string, seed: number): string {
  return `Seed: ${seed}\nPlayer prompt: ${prompt}`;
}

/** The outline as the later stages see it: ids and one-line forms, no more. */
export function outlineBrief(o: {
  title: string; era: string; theme: string; site: { pattern: string; wild: number; paths: string; spacing: number };
  palette: { sky: string; fog: number };
  buildings: { id: string; role: string; label: string; form: string; size: string; keyBuilding: boolean }[];
  npcs: { id: string; name: string; role: string; home: string; work: string }[];
  quest: { title: string; premise: string }; lexicon: string[];
}): string {
  const b = o.buildings.map((x) => `- ${x.id} [${x.role}, ${x.size}${x.keyBuilding ? ', key' : ''}] "${x.label}": ${x.form || x.role}`).join('\n');
  const n = o.npcs.map((x) => `- ${x.id}: ${x.name}, ${x.role}; home ${x.home}, work ${x.work}`).join('\n');
  return [
    `World: "${o.title}", ${o.era}. Theme id ${o.theme}. Sky ${o.palette.sky}, fog ${o.palette.fog}.`,
    `Site: pattern ${o.site.pattern}, wild ${o.site.wild}, paths ${o.site.paths}, spacing ${o.site.spacing} m.`,
    `Structures (use these exact ids):\n${b}`,
    `People (use these exact ids):\n${n}`,
    `Quest premise: ${o.quest.premise}`,
    `Lexicon: ${o.lexicon.join(', ')}`,
  ].join('\n');
}
