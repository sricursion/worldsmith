// Stage 0 of POST /api/compile: the outline. A fast model reads the prompt and decides what KIND of place
// this is before anything else: the land (relief, water, horizon, how much of it is built on), the layout,
// the few or many structures, who lives there and what their bodies are, what else is alive or moving, the
// sky, and the air (weather, hour, grade, sound). The look and the story stages both build on this object,
// so every id they use comes from here, and the client sets land, sky and ambience from it within seconds.
import { bodyCatalogText } from '../../../app/src/world/bodies';
import { scaleBrief } from '../../../app/src/world/scale';
import type { SiteScale } from '../../../app/src/world/spec';

const ROLE = `You plan a small playable world from one short player prompt, for a first-person browser game with a grounded, realistic look. The prompt can be anything: the Sahara, a rainforest, an Arctic outpost, Mars, a planet nobody has seen, a dragon's lair, a gothic city, a hero's rooftops, a harbour town, a frontier street. Reply with ONE JSON object, no prose, no code fence. The reply is read within seconds, so it must be SHORT: compact JSON on one line, under 900 tokens.`;

const KIND = `FIRST decide what kind of place this is. Most prompts are NOT a town. Never put a little settlement with a road and a plaza on a prompt that names a landscape. Write that decision in "place" (at most 14 words), then make every other field agree with it.

terrain is the land itself:
- relief: flat (streets, decks, salt pan), rolling (hills, forest floor), dunes, craggy (rock, mountain, broken ground), terraced (stepped slopes, paddies), crater (bowl with a rim: impact site, caldera, quarry), canyon (walls either side), icefield, swamp, islands.
- ruggedness 0 to 1: how tall the relief stands inside the play area. A parking lot 0.05, farmland 0.2, dunes 0.6, a caldera 0.9.
- water: none, pond, river, shore (sea or big lake along one side), lake, lava, acid, ice_sheet (frozen sea or lake), mist_sea (cloud or void below sky islands and peaks). waterAmount 0 to 1 is the share of the area it takes (a stream 0.1, a harbour 0.35, an archipelago 0.6); 0 when water is none.
- horizon: what the far distance is made of, 2 to 6 words ("dune sea in heat haze", "glacier wall", "unbroken jungle canopy", "glass towers with lit windows", "ringed gas giant over black ridges").
- settled 0 to 1: how much of the place is built. Untouched wilderness 0 to 0.05, a camp or outpost in the wild 0.05 to 0.2, a village 0.4, a town 0.7, dense city 0.95.

settled decides how many structures and people you NAME. Follow it:
- settled under 0.15: 0 to 3 structures, 0 to 3 people.
- settled 0.15 to 0.5: 3 to 6 structures, 2 to 5 people.
- settled over 0.5: 7 to 12 structures, 5 to 8 people.
At least 1 structure unless the prompt wants land with nothing on it. Zero people is a valid answer for a dead moon or a deep wilderness.

You name only the few places the story needs; the engine builds the rest around them from site.scale. Give the TRUE size the prompt names, never smaller:
- scale: lone (one thing in empty land), outpost (a camp, base or station), hamlet (a few houses), village, town, city (streets of blocks in every direction), metropolis (a megacity, a capital, a great city such as Rome or Manhattan, anything vast or endless).
- density 0 to 1, how full the streets are of people and things: ghost town 0.05, quiet village 0.3, market day 0.7, overpopulated 1.
- heights [typical, tallest] in metres: farmsteads [4,7], medieval town [7,16], ancient Rome [10,35], modern downtown [20,120], megacity [30,180].
- damage 0 to 1: whole 0, neglected 0.3, just after a war or quake 0.6, bombed flat 0.9.

site is the layout:
- Built places: street (a main road with cross streets), ring (around a centre), scatter (a camp, grove or ruin with worn tracks), grid (city blocks), terraces (rows stepping up a slope).
- Land: wild (open country, the few points of interest far apart), path (one track winding through forest, swamp or canyon from point to point), shoreline (strung along the water's edge), cliffside (on ledges under a rock wall or crater rim).
- wild 0 to 1 is how much open ground is covered by vegetation and rocks (rainforest 0.95, savanna 0.4, dunes 0.1, a plaza city 0.05, bare ice or regolith 0.15). paths: road, track or none. spacing is the gap between structures in metres, 2 to 14 (dense towers 3, a street 6, wilderness 14).`;

const THINGS = `Structures ("buildings" rows) are whatever a person would walk towards. In a wilderness they are natural or ruined points of interest, not houses: a cave mouth, a giant fallen tree, a rock arch, a crashed lander, a wreck, standing stones, a nest, a ruined gate, a lone hut, a camp.
- "role" is one of: saloon tavern inn bank jail sheriff church stable general_store market blacksmith house hotel townhall doctor school barber undertaker warehouse workshop lab hangar cantina command habitat reactor cafe office shop garage apartment station plaza. It is only a loose label for function; pick the nearest (a cave or nest is "house", a wreck "warehouse", a shrine or standing stones "church", a mast "command", an open gathering place "plaza").
- "form" is the physical form in 3 to 6 words, with its real scale ("basalt cave mouth 12 m high", "fallen kapok trunk, hollow", "glass office tower 30 m", "low goat-hair tent"). It tells the architect what to build; make each different.
- "label" is its name in the setting's voice. size is small, medium or large. key is 1 for the 1 to 3 that matter most.
- Real places tower over a person. In a settled place make 2 or more structures tall (a tower, spire, stack, mast, crane, belfry, minaret) and say the height in "form".

People ("npcs" rows): home and work are structure ids from your list (work may be "street" or "plaza"). Names and roles fit the setting ("tide-warden", "ice-core tech"). Nobody is needed in a place that has nobody.

folk is the body plan of whoever lives here; fill it even when there are no people.
- name ("Tuareg drovers", "station crew", "kobolds", "maintenance androids"). height is adult height in metres (humans 1.6 to 1.85; kobolds 1.1; giants 2.6). bulk 0 slight to 1 massive. head is head size against a real human: 1 for realistic people. Only folk who are odd by nature differ (0.9 to 1.3).
- features, any of: tail horns long_ears snout visor antenna wings hood hat cloak armor pack mask glow_eyes. Dress them for the climate and the work: parkas are hood and pack, pressure suits are visor and pack, desert robes are hood and cloak.
- skin, cloth and trim are 2 or 3 hex colours each: real skin or shell tones, cloth in muted dyed or worn colours, trim for belts and gear.

creatures are everything else that lives or moves: wildlife, monsters, machines. 0 to 6 kinds. Always include something alive or moving (even one bird overhead) unless the world is deliberately dead. A creature row is [id, name, family, size, count, behaviour, haunt, body, accent, glow, note, dials].
- family is a body plan from the list below; dials reshape it (use the dial names listed for that family, 2 to 4 of them, or {}).
- size is body length or height in metres, real scale: songbird 0.2, fox 0.7, wolf 1.4, horse 2.4, camel 2.2 at the shoulder, elephant 6, whale 15, a dragon 10 to 18. count is how many (a herd 4 to 8, a flock 6 to 12, a lone hunter 1, a colossus 1).
- behaviour: roam graze patrol perch circle sleep guard flock stalk.
- haunt: sky, water, wild, plaza, or a structure id (the nest it sleeps on, the camp it is tethered at). water only when the terrain has water.
- body and accent are natural, muted hex colours: fur, hide, feather, scale, painted metal. glow is the colour of a real light on it (machine lamps, fire in the throat, a lure) or "#000000" when it gives no light.
- note is one short sentence the player reads when they look at it.
- Vehicles are out of scope: never write cars, traffic, trains or ships as creatures. Machines are allowed only as floater drones or crawler rovers and walkers, and only when the world has them.

BODY PLANS
${bodyCatalogText()}

skyFeatures: 0 to 3 rows of [kind, size, color]. kind: moon planet ringed_planet second_sun aurora nebula comet floating_islands orbital_ring storm_wall eclipse. size 0 to 1 is apparent size (our moon 0.08, a huge moon 0.4, an aurora across the sky 0.7). Only what this sky really has; an ordinary Earth day has none.`;

const AIR = `theme is the nearest of western, medieval, scifi, modern; it only picks a fallback, choose and move on.
mood is the air of the place. You are its cinematographer: one hard light, deep shadow, air that catches it. Always honour weather, hour or light the prompt names.
- weather: clear rain storm snow fog dust ash spores embers fireflies mist. Use rain or storm ONLY when the player's prompt itself mentions rain, a storm or wet weather; otherwise never. Most worlds are clear, or have dust, mist, snow or embers that belong to the place. intensity 0 to 1 (drizzle 0.3, downpour 0.9, blizzard 0.9; 0 when clear).
- grade: neutral (plain daylight), golden (low warm sun, dust), teal_orange (wet dawn or dusk: warm lamps against cool shadow), cold_steel (blue-grey: snow, steel, storm), sepia (old photograph), neon_noir (wet night under signs), verdant (deep green: forest, swamp), bleached (glare, salt, overcast), crimson (fire, lava, blood moon), moonlit (blue night).
- haze 0 to 1: how much light hangs in the air: 0.2 crisp, 0.5 atmospheric, 0.8 thick.
- ambience: 4 or 5 of these, most telling first: market tavern crowd forge bells chimes hooves creaks temple harbor gulls surf stream water cave underwater birds crows owls wolves crickets cicadas frogs jungle leaves machinery neon station traffic train fire snow desert wind rain thunder. Only what is heard there.
- music: 2 or 3 words, a feeling and an instrument ("lonely harmonica", "low synth drone", "slow noir piano"), or "".
time.startHour is the hour the player arrives, 0 to 23.5, chosen for drama: dawn 5.5 to 7, dusk 17 to 19, night 20 to 23, or storm light, far more often than midday. Plain noon is for places that are about glare.
palette.sky is one of dawn day dusk night overcast and agrees with the hour and weather: rain, storm, snow or fog by day is overcast; 20 or later is night. fog 0 to 1: at least 0.4 in fog, mist or storm, about 0.3 in rain, snow, dust or ash, 0.1 to 0.2 when clear.
quest.premise is two sentences: what has gone wrong here and why a stranger matters. In a wilderness it can be about the land or a creature (a nest robbed, a beacon gone dark, a herd that will not cross). lexicon is 6 words of slang, currency and place names.`;

const EXAMPLES = `How different prompts come out. These are decisions to learn from, not templates to copy:
- "the Sahara": dunes, ruggedness 0.6, water none, settled 0.05, horizon "dune sea in heat haze". site wild, wild 0.1. ONE structure, a caravan camp (low goat-hair tent). 2 drovers; folk hood and cloak in indigo. 4 camels (quadruped, 2.2, graze, haunt the camp), 1 hawk (bird, circle, sky). Dust 0.3, golden, heat haze 0.6, hour 17.
- "an Arctic research outpost": icefield, water ice_sheet 0.4, settled 0.1, horizon "glacier wall". scatter, scale outpost. 3 structures, one a radio mast 18 m. 4 people; folk hood and pack, red and navy parkas. Seals asleep on the ice (swimmer, sleep, water), a white fox. Sky: aurora. Snow, cold_steel.
- "a Mars colony": crater 0.6, water none, settled 0.15, horizon "rust-red crater rim". scatter. 4 habitats and a mast. 4 colonists; folk visor and pack. Creatures are machines: 3 rovers (crawler, patrol), 2 drones (floater). Sky: two small moons (0.06, 0.04). Dust. No birds, no plants.
- "the Amazon rainforest": rolling 0.5, river 0.25, settled 0.02, horizon "unbroken canopy". site path, wild 0.95. 1 or 2 structures: a fallen kapok, maybe a stilt hut. 0 or 1 person. Howler monkeys (biped 0.7, 5, roam), macaws (bird, flock, sky), ONE jaguar (quadruped, stalk). Mist, verdant (rain only if the prompt says so).
- "a dragon's lair": crater 0.9, lava 0.3, settled 0.03, horizon "smoking caldera rim". cliffside. 3 natural structures: a cave mouth, a bone nest, vent spires. 2 kobolds; folk 1.1 m, snout, tail, horns. ONE dragon (winged, size 18, count 1, sleep or circle, haunt the nest), cinder lizards (crawler). Embers, crimson, night.
- "a Yharnam-like gothic city at night": terraced or flat, water none, settled 0.95, horizon "spires and chimney smoke". grid or terraces, spacing 3, scale city, density 0.4, heights [12,40]. 10 structures, several tall: cathedral 40 m, clock tower 30 m, tenements. 6 hunters and townsfolk; folk hat, cloak, mask. Crows (bird, perch). Sky: a huge moon or an eclipse. Fog, moonlit, hour 23.
- "Manhattan rooftops, a superhero's city": flat, settled 1, horizon "glass towers 40 to 300 m, lit windows". grid, spacing 3, scale metropolis, density 0.8, heights [30,160]. 10 structures: towers 60 to 160 m and street-level places. Pigeons (bird, flock, plaza). No cars or traffic. Night, neon_noir.
- "a megacity after a war, overpopulated": flat, settled 1, grid, scale metropolis, density 1, heights [25,150], damage 0.6. 10 structures, one a relief tower 90 m.
- "a GTA beach city at sunset": flat, water shore 0.35, settled 0.7, horizon "ocean and hotel towers". shoreline, scale city, density 0.6, heights [8,60]. 8 structures along the front. Gulls. Clear, golden, hour 18.5.
- "a farming hamlet": rolling 0.2, settled 0.3, scatter, scale hamlet, density 0.25, heights [4,7].`;

const LIMITS = `Brevity limits (hard): place at most 14 words; title 2 to 4 words; tagline at most 8 words; era 2 to 4 words; label 1 to 3 words; form 3 to 6 words; npc name 1 or 2 words; npc role 1 to 3 words; creature note at most 10 words; premise 2 sentences of at most 12 words each; lexicon exactly 6. ids are short snake_case slugs, unique across structures, people and creatures. Numbers have at most two decimals. quest has only title and premise.`;

const SHAPE = `JSON shape, in this order. buildings, npcs, creatures and skyFeatures are compact rows, not objects:
{"place":str,"title":str,"tagline":str,"era":str,"theme":"western|medieval|scifi|modern","terrain":{"relief":"dunes","ruggedness":0.6,"water":"none","waterAmount":0,"horizon":str,"settled":0.05},"site":{"pattern":"street|ring|scatter|grid|terraces|wild|path|shoreline|cliffside","wild":0.1,"paths":"road|track|none","spacing":14,"scale":"lone|outpost|hamlet|village|town|city|metropolis","density":0.2,"heights":[4,8],"damage":0},"time":{"startHour":17},"mood":{"weather":"dust","intensity":0.3,"grade":"golden","haze":0.6,"ambience":["hooves","desert"],"music":"lonely oud"},"palette":{"sky":"dawn|day|dusk|night|overcast","fog":0.3},"skyFeatures":[[kind,size,"#rrggbb"]],"folk":{"name":str,"height":1.72,"bulk":0.4,"head":1,"features":["hood","cloak"],"skin":["#rrggbb"],"cloth":["#rrggbb"],"trim":["#rrggbb"]},"buildings":[[id,role,label,form,size,key]],"npcs":[[id,name,role,home,work]],"creatures":[[id,name,family,size,count,behaviour,haunt,"#body","#accent","#glow",note,{dials}]],"quest":{"title":str,"premise":str},"lexicon":[str]}
A building row is ["caravan_camp","house","Camp of Seven Wells","low goat-hair tent","medium",1]. An npc row is ["idir","Idir","camel drover","caravan_camp","caravan_camp"]. A creature row is ["camels","dromedary camels","quadruped",2.2,4,"graze","caravan_camp","#b8956a","#8a6a48","#000000","Hobbled, chewing, unimpressed by you.",{}].`;

let cached: string | null = null;

/** Stable across requests so the prompt cache can hit; the player's prompt goes in the user turn. */
export function outlineSystemPrompt(): string {
  if (!cached) cached = [ROLE, KIND, THINGS, AIR, EXAMPLES, LIMITS, SHAPE].join('\n\n');
  return cached;
}

export function outlineUserMessage(prompt: string, seed: number): string {
  return `Seed: ${seed}\nPlayer prompt: ${prompt}`;
}

/** The outline as the later stages see it: the land, the ids and one-line forms, no more. */
export function outlineBrief(o: {
  title: string; era: string; theme: string; site: { pattern: string; wild: number; paths: string; spacing: number; scale?: SiteScale; density?: number; heights?: [number, number]; damage?: number };
  palette: { sky: string; fog: number };
  mood?: { weather: string; intensity: number; grade: string; haze: number };
  time?: { startHour: number };
  terrain?: { relief: string; ruggedness: number; water: string; waterAmount: number; horizon: string; settled: number };
  skyFeatures?: { kind: string; size: number }[];
  folk?: { name: string; height: number; features: string[] };
  creatures?: { id: string; name: string; family: string; size: number; count: number; behaviour: string; haunt: string }[];
  buildings: { id: string; role: string; label: string; form: string; size: string; keyBuilding: boolean }[];
  npcs: { id: string; name: string; role: string; home: string; work: string }[];
  quest: { title: string; premise: string }; lexicon: string[];
}): string {
  const b = o.buildings.map((x) => `- ${x.id} [${x.role}, ${x.size}${x.keyBuilding ? ', key' : ''}] "${x.label}": ${x.form || x.role}`).join('\n');
  const n = o.npcs.map((x) => `- ${x.id}: ${x.name}, ${x.role}; home ${x.home}, work ${x.work}`).join('\n');
  const c = (o.creatures ?? []).map((x) => `- ${x.id}: ${x.count} x ${x.name} (${x.family}, ${x.size} m), ${x.behaviour} at ${x.haunt}`).join('\n');
  const hour = o.time ? `, arriving at ${Math.floor(o.time.startHour)}:${String(Math.round((o.time.startHour % 1) * 60)).padStart(2, '0')}` : '';
  const air = o.mood ? `\nAir: weather ${o.mood.weather} (intensity ${o.mood.intensity}), grade ${o.mood.grade}, haze ${o.mood.haze}${hour}.` : '';
  const t = o.terrain;
  const sky = (o.skyFeatures ?? []).map((f) => f.kind).join(', ');
  const land = t
    ? `\nLand: relief ${t.relief} (ruggedness ${t.ruggedness}), water ${t.water}${t.water === 'none' ? '' : ` (${t.waterAmount} of the area)`}, settled ${t.settled} (0 wilderness, 1 dense city), horizon "${t.horizon}"${sky ? `. In the sky: ${sky}` : ''}.`
    : '';
  const folk = o.folk ? `\nFolk: ${o.folk.name}, about ${o.folk.height} m tall${o.folk.features.length > 0 ? `, with ${o.folk.features.join(', ')}` : ''}.` : '';
  return [
    `World: "${o.title}", ${o.era}. Theme id ${o.theme}. Sky ${o.palette.sky}, fog ${o.palette.fog}.${air}${land}${folk}`,
    `Site: pattern ${o.site.pattern}, wild ${o.site.wild}, paths ${o.site.paths}, spacing ${o.site.spacing} m.${scaleBrief(o.site)}`,
    o.buildings.length > 0 ? `Structures (use these exact ids):\n${b}` : 'Structures: none. Nothing is built here.',
    o.npcs.length > 0 ? `People (use these exact ids):\n${n}` : 'People: none. Nobody lives here.',
    c ? `Creatures (ids):\n${c}` : 'Creatures: none.',
    `Quest premise: ${o.quest.premise}`,
    `Lexicon: ${o.lexicon.join(', ')}`,
  ].join('\n');
}
