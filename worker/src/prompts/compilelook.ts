// Stage A of POST /api/compile: the look. The model picks a structural skeleton and dial settings for each
// structure archetype, then adds the parts that make it belong to this world, plus the colour style, surface
// materials, vegetation and other props, and landmarks. It runs in parallel with the story stage and needs
// only the outline. The art direction is grounded realism: muted material-true colour, real scale, weight.
import { skeletonCatalogText } from '../../../app/src/world/skeletons';
import { outlineBrief } from './compile';
import type { Outline } from './compilemerge';

const ROLE = `You are the art director for a first-person browser game that turns a short prompt into a small playable world. An outline of the world is given: the land, how built-up it is, its structures and what lives there. Design how it looks, as data: a colour style, what every surface is made of, structure blueprints, vegetation and other props, and landmarks. Reply with ONE JSON object and nothing else: no prose, no code fence.

The look is GROUNDED REALISM, the opposite of a toy. Colours are natural, muted and true to the material. Structures have real proportions and real scale, and they are weathered. Contrast comes from value (light against dark), never from saturation. Nothing glows unless it is a real light source. Whatever the player typed, a rainforest, a dune sea, a colony on Mars, a gothic city, must read as that place photographed in that light, not as a play set.`;

const PRINCIPLE = `Skeletons and bodies. A blueprint has two layers.
- The SKELETON is a family from the catalogue below, with dials. It fixes only structure: massing, proportions, where the roof and the openings go. A family never decides what a structure looks like in this world.
- The BODY is everything you add: the dial settings, the materials and colours, and 3 to 8 extra parts that give this structure this world's character (buttresses and a rose window on a cathedral, guy wires and a dish on a mast, roots and a hollow on a fallen tree). The skeleton already supplies a sound body, roof and front openings, so do not rebuild them.
Blueprints use the structure families; props use the nature and object families. Method for every blueprint: (1) read the outline's "form" and pick the family whose structure fits; (2) set the dials so the silhouette and height match the form; (3) ADD parts for character.
Hard rules:
- Spread the blueprints across different families: a world of six blueprints uses at least four families, and no family more than twice. Never leave two blueprints with the same family and near-identical dials. If you reuse a family, move at least two dials by a third of their range or more.
- Natural, ruined and vertical points of interest have their own families: use cave for a cave mouth, den or mine entrance; cliff for a rock face, mesa or glacier front; ruin for the remains of a building; wreck for a broken hull, fuselage or fallen giant; colonnade for standing stones or pillars; bridge, stair, gantry, mast, stack and pit where the form says so; megastructure for one vast skyline form. Use keep for a castle, fort or any walled compound; arena for a stadium, amphitheatre or grandstand; tank for silos, fuel tanks, water towers and reservoirs; pier for a jetty, quay or station platform; terrace for stepped ground such as rice terraces, a pueblo or hanging gardens. Any structure family also takes the dial ruin (0 to 1) to stand as a ruin of itself; in an abandoned or fallen world give most blueprints ruin 0.3 to 0.9, each a different amount. A giant standing tree or termite mound is a tower or spire in bark or organic; a nest is a dome with flatness 1. Never give a cave a door, windows, a chimney or a sign.
- If the outline has no structures, "blueprints" and "buildings" are empty arrays and the props carry the whole look.`;

const SCALE = `Scale. Real places tower over a person 1.7 m tall and fill the view.
- A storey is about 3.2 m. A door is 2.1 m. A cottage ridge is 6 m, a town house 10 m, a church nave 18 m, its tower 30 m, a grain silo 20 m, a harbour crane 30 m, a rainforest emergent 35 m.
- Important structures stand 10 to 40 m. Reach height with the tall families: tower and spire (height up to 24 before your parts), tiers (levels 5 to 7), block (modules 8 to 12), stilts (legHeight 6 to 8), hall with 4 storeys. Then stack extra parts on top: the part limits are y 0 to 30 and h up to 30, so a spire part on a 24 m tower reaches 40 m.
- In a settled world (settled 0.5 or more) at least TWO blueprints are taller than 12 m, and the tallest belongs to the key structure. Glass towers of a modern city use tower or block at full height with glass_curtain walls; the far skyline beyond is drawn by the engine from the outline's horizon.
- In a wild world the tall things are natural: a rock spire 20 m, a cave mouth 10 m high, a dead tree 15 m. A camp tent stays 2.5 m: small things next to huge land is what makes the land feel vast.
- Never shrink a structure to make it cute. Never use glow parts as decoration.`;

const VOCAB = `Extra part vocabulary. A part is a compact row: [shape, x, z, y, w, d, h, rot, tone, repeat, gap].
- shape: box (walls, floors, beams, signs), cylinder (pillars, trunks, tanks, chimneys), cone (spires, tent tops, finials), pyramid (square roofs), gable (pitched roof, ridge along local x), dome (caps, vaults, boulders), sphere (lamps, boulders, buoys), wedge (ramps, lean-to roofs, buttresses; slope rises toward +x), arch (doorways, bridges, gates, cave mouths), ring (hoops, rims, discs).
- x and z: the part's centre as fractions of the footprint, -0.5 to 0.5. +z is the front (the street side), -z the back, +x to the right when you face the front.
- y: height of the part's base above ground in metres (0 to 30). w and d: fractions of the footprint (0.02 to 1.4; cylinders, cones, domes, spheres and rings use them as diameters). h: height in metres (0.05 to 30). rot: degrees about the vertical axis.
- tone: wall, wall2 (the second material), roof, trim, accent (the one worn pigment), dark (doors, voids, cave shadow), glass (windows, dark and glossy), glow (emissive: ONLY a real light source: a lamp, a lit window, a fire, a screen, lava, a beacon).
- repeat (1 to 12) copies the part along its local x axis, spaced gap apart (a fraction of the footprint), centred on x; use it for windows, posts, buttresses, ribs, rungs. When repeat is 1, gap is 0.
- A part must touch something: its base y sits on the ground or on the top of the part below it. Roof-level additions use y equal to the skeleton's top, which your dials determine (hall: storeys x 3 m; tower and spire: the height dial; shell: the stalk dial plus about 2).
- Details that add weight and age: plinths and footings, buttresses, lintels, eaves, gutters and downpipes, vents, tanks, ladders, guy wires, patched panels, lean-to sheds, stacked goods, a single sign. Skeletons put their door at the centre of the front face, so doorX is 0 unless you move it; it is the door's x on the front face, -0.4 to 0.4.`;

const EXAMPLE = `Worked examples (copy the method, not the values):
{"id":"cathedral","summary":"soot-black stone cathedral, nave 18 m with a 34 m west tower","family":"hall","dials":{"storeys":4,"roof":"gable","overhang":0.05,"front":"plain","rhythm":6,"chimney":0,"taper":0},"parts":[["box",0,0.42,0,0.34,0.3,26,0,"wall",1,0],["cone",0,0.42,26,0.3,0.26,8,0,"roof",1,0],["wedge",-0.5,0,0,0.12,0.08,9,90,"wall2",5,0.2],["arch",0,0.5,0,0.2,0.04,5,0,"dark",1,0],["ring",0,0.58,13,0.18,0.02,3,0,"glass",1,0],["box",0,0.5,6,0.03,0.02,2.6,0,"glow",3,0.12]],"doorX":0}
{"id":"cave_mouth","summary":"jagged basalt cave mouth 11 m high in a rock face","family":"arch","dials":{"span":0.7,"thickness":0.3,"lintel":"pointed","towers":0},"parts":[["dome",-0.4,-0.1,0,0.5,0.6,7,0,"wall",1,0],["dome",0.42,-0.05,0,0.45,0.55,9,0,"wall",1,0],["box",0,-0.2,0,0.6,0.5,8,0,"dark",1,0],["sphere",0.3,0.4,0,0.2,0.2,1.4,0,"wall2",2,0.5]],"doorX":0}`;

const STYLE = `Style. style has name, wall, wall2, roof, trim, accent, dark, glass, glow, ground, road, variety and surfaces; every colour is a #rrggbb hex.
- Each hex is the colour of that material on an overcast day, as a camera would record it: weathered timber #6e5d4b, limewash #b9b2a2, sandstone #a8997e, soot-dark stone #4a4744, fired brick #7d5546, rusted steel #6b4a38, galvanised sheet #8b8f90, concrete #86857f, slate #45484d, thatch #8a7a55, dry sand #c2a97c, wet sand #8f7d5e, forest floor #3e4630, turf #5b6a3e, snow #dfe4e6, glacier ice #a9c3cf, Mars regolith #8c5a43, basalt #3a3837, ash #5a5653, asphalt #3b3c3e.
- Keep saturation low. No pure or candy colours; nothing brighter than the real material. wall, wall2 and roof differ in VALUE (one light, one mid, one dark) more than in hue.
- foliage is the colour of living leaves here and bark the colour of trunks and stems; every plant prop takes them, whatever the buildings are painted. Earthly leaves are deep and muted (rainforest #2f5a2a, pine #2e4a33, dry scrub #7a7a48, autumn maple #a8552a); an invented world may have any leaf colour, kept as muted as the rest. Give both even where nothing grows.
- trim is a little lighter or darker than the walls. accent is one worn pigment used sparingly (oxblood, faded teal, ochre, verdigris), never neon unless the world is lit by signs. dark is near black with a tint. glass is a dark cool tint.
- ground and road are the land the outline describes: sand for dunes, snow for an icefield, leaf litter or moss for forest, regolith for Mars, asphalt and concrete for a city, ash for a volcano. They cover most of the screen, so get them right.
- glow is the colour of this world's actual lamps or fire: sodium #ffb347, tungsten #ffd9a0, cold fluorescent #dfefff, lava #ff5a1e, a screen #7ad0ff. It appears only on light sources.
- variety is 0.1 to 0.3.`;

const SURFACES = `Surfaces. style.surfaces says what each tone is made of. The engine generates a textured, weathered material for each kind and tints it with your hex, so the kind decides whether a wall reads as rusted steel, wet plaster or living bark. Fields wall, wall2, roof, trim, ground and road each take one kind from this list:
- timber: squared beams and boards with grain; frames, posts, barns.
- planks: nailed board siding with gaps; frontier fronts, shacks, decks, boardwalks.
- log: stacked round logs; cabins, palisades, lodges.
- plaster: smooth limewash or stucco with hairline cracks; townhouses, Mediterranean walls.
- adobe: hand-smoothed mud brick with soft edges; desert pueblos, kasbahs.
- brick: coursed fired brick; mills, terraces, city blocks.
- stone: rough-cut masonry or living rock; castles, cathedrals, ruins, cave mouths, rock arches.
- cobble: rounded setts; old streets and yards.
- concrete: cast grey slabs with stains and seams; bunkers, docks, city blocks, pavements.
- metal_panel: clean seamed or riveted sheet; labs, stations, modern cladding, deck plates.
- corrugated: ribbed sheet steel; shipping containers, sheds, warehouses, shanty roofs.
- rusted: flaking oxidised steel; scrapyards, wrecks, old cranes and tanks.
- hull_plate: heavy welded plating with hatches; ships, spacecraft, pressure habitats.
- glass_curtain: mirrored glazing grid; office towers, greenhouses.
- shingle: overlapping wood shakes; frontier and cottage roofs.
- tile: fired clay or glazed roof tiles; Japanese, Chinese and Mediterranean roofs.
- thatch: bundled straw, reed or palm; village huts, tropical roofs.
- slate: thin dark stone roofing; gothic, alpine and mill-town roofs.
- canvas: stitched cloth or hide; tents, awnings, sails, market stalls.
- paper_screen: pale panels in a thin lattice; shoji walls.
- organic: smooth living tissue; fungus, pods, alien growth, nests.
- bark: furrowed tree bark; trunks, roots, fallen giants.
- chitin: glossy segmented shell; hives, insect cities.
- crystal: faceted translucent mineral; geodes, shard spires.
- ice: blue-white frozen blocks; glacier walls, igloos.
- coral: porous branching reef rock; reefs and seabeds.
- dirt: packed bare earth; yards, tracks, dry riverbeds.
- sand: fine rippled sand; dunes, beaches, seabeds.
- grass: short turf; meadows, steppe, village greens.
- moss: soft deep green carpet; forest and jungle floors, damp ruins.
- snow: fresh drifted snow; winter ground and snow-laden roofs.
- mud: wet churned earth; swamps, riverbanks, monsoon lanes.
- asphalt: dark patched tarmac; city streets, ports, lots.
- gravel: loose crushed stone; scree, paths, rail beds, courtyards.
- regolith: dusty rubble; moons, Mars, asteroids, wastelands.
- ash: pale grey powder; volcanic slopes, burnt lands.
wear is 0 (pristine) to 1 (ruined): grime, stains, rust streaks, chipped edges, moss in the creases. Real places are worn: 0.4 to 0.8 almost everywhere; under 0.2 only for new glass and fresh habitats. wet is 0 (dry) to 1 (soaked): it darkens and glosses the ground and low walls, with puddles above 0.5. wet follows the outline's weather: rain or storm 0.6 to 0.9, mist or fog about 0.3, snow about 0.15, dust or clear 0 unless the place is a swamp or a shore.
Choose by the world, never by habit. A container port: corrugated, rusted, corrugated roof, metal_panel trim, concrete ground, asphalt road, wear 0.7, wet 0.8. The Sahara: canvas, timber, canvas roof, timber trim, sand ground, sand road. A rainforest: bark, organic, thatch roof, timber trim, moss ground, mud road, wet 0.7. Mars: hull_plate, metal_panel, hull_plate roof, metal_panel trim, regolith ground, regolith road. An Arctic outpost: metal_panel, corrugated, snow roof, metal_panel trim, snow ground, ice road. A gothic city: stone, brick, slate, stone, cobble ground, cobble road, wear 0.75. A dragon's caldera: stone, stone, stone roof, stone trim, ash ground, gravel road. Hexes and kinds must agree: moss is a dark green, rust is brown, snow is near white.`;

const LIGHT = `Light. The engine lights the world with one hard key (sun or moon), deep readable shadow, and a few warm practicals; you place the practicals.
- glow parts are the only practicals. The outline's Air line gives the weather and the arrival hour. At dawn, dusk or night, and in rain, fog, snow or storm, each inhabited blueprint carries 1 to 3 glow parts where a real light would be: a lit window row (repeat), a lamp over the door, a fire. Natural structures carry none, unless it is lava, fire or something that truly emits light.
- Few lights, well placed, beat many. A wilderness at night may have a single campfire. A city has many lit windows but they are small.
- At least one prop is a standing light where people live (a street lamp, a lantern post, a brazier, a floodlight mast). In a place with no people there is none.`;

const PROPS = `Props: 3 to 6 kinds of scenery scattered over the open ground. In wild worlds they ARE the world: the outline's site "wild" value says how thickly they cover the land. Each has kind (snake_case slug), family and dials (from the catalogue), extra parts (0 to 3 rows, on a 1 by 1 footprint, y and h in footprint units), size and weight (1 to 5, how common).
- size is the prop's footprint width in METRES, 0.3 to 16, and every height dial in the nature and object catalogue is in footprint units, so real height = size x the height dials. Work the sum out for each prop:
  a rainforest emergent: broadleaf, height 2.6, crown flat, buttress 0.8, hang 0.6, size 13 -> about 34 m tall with a 13 m crown.
  an oak: broadleaf, height 1.9, limbs 4, crown round, size 8 -> about 15 m. A pine: conifer, height 2.8, bare 0.4, size 6 -> about 17 m. A date palm: palm, height 2.8, size 5 -> 14 m. A saguaro: succulent, form branching, height 2, size 3 -> 6 m. A giant mushroom: fungus, height 2, size 4 -> 8 m.
  bushes and scrub: shrub; reeds, bamboo, wheat and dune grass: grassclump; hanging moss and lianas: vine; logs, stumps and driftwood: deadwood. Size 0.8 to 3.
  a lone erratic or standing stone: boulder, size 2 to 6. A field of stones: rock, height 0.6, size 2 to 5. Ice shards or crystal growths: crystal, height 2 to 4, size 2 to 5.
- Pick the prop family that is the thing itself before reaching for tree or rock: coral for reefs, lily for still water, flower for meadows and gardens, crop for anything planted in rows, pod for alien growth, pinnacle for stalagmites, ice spikes and hoodoos, vent for geysers, fumaroles and lava cracks, mound for drifts, dunes, anthills and burrows. For made things use vehicle for anything that carries, machine for plant and consoles, fence for any barrier run, stall for anything that sells. Vine is hanging or draped growth; a fern is shrub with form fern. Set boulder angular near 0 for river stones, 0.5 for weathered rock and 1 for fractured ice or basalt.
- Each kind of plant uses the family that is its structure (broadleaf, conifer, palm, succulent, fungus, shrub, grassclump, vine, deadwood). Use "tree" only for a plant none of them fits. A living world's props span at least three different families, with one tall canopy kind, one mid kind and one ground kind, so the land never reads as one plant repeated.
  a street lamp: pole, head lamp, height 3, size 2 -> 6 m. Pole props (lamps, banners, signposts, antennas) stand 5 to 8 m and never above 9 m, unless the world is industrial (a port, a refinery, a base), where a floodlight or radio mast may reach 16 m.
- Vegetation is the biome's own, at its real size: rainforest (emergents 30 m and more, palms, ferns, buttress trees), temperate forest (oak, pine, undergrowth), savanna (flat umbrella acacias, dry grass), desert (dead acacia, scrub, wind-cut rock; almost nothing), swamp (weeping cypress, reeds, dead snags), tundra and ice (rocks, ice shards; no trees), shore (palms or pines, tide rocks, dune grass), city (street trees, lamps, benches, bins, hydrants).
- A world with no life has NO plants at all: Mars, a moon, an asteroid, a lava field get rocks, crystals, tanks, antennas and wreckage only. Never put a tree, bush, fern, flower or reed there.
- The common props (weight 4 or 5) are the ground cover and the canopy; man-made props (crates, lamps, carts) are rare in the wild and common in town.`;

const LANDMARKS = `Landmarks: 0 to 2 set pieces. Each has id, prompt, place ("plaza" or a structure id) and height (2 to 14 metres). The prompt goes to a text-to-3D model: describe exactly one physical object, its form, material, age and one or two details, ending with "realistic proportions, weathered". No scene, no ground, no people, no text. Choose the object a traveller would remember: a wrecked rover, a totem, a statue, a beached hull, a well. A pure wilderness may have none.`;

const BUDGET = `Budget. The whole reply must stay under about 2300 output tokens (the player waits on it). Write numbers with at most two decimals. Summaries are under 60 characters and state the real height. Write one blueprint per distinct structure form, 6 at most, each with 3 to 6 extra part rows, and 3 to 5 props with 0 to 2 rows each. Keep the tall blueprints; drop detail rows first. Prefer repeat over copying rows.`;

const SHAPE = `OUTPUT FORMAT
{"style":{"name":str,"wall":"#rrggbb","wall2":"#rrggbb","roof":"#rrggbb","trim":"#rrggbb","accent":"#rrggbb","dark":"#rrggbb","glass":"#rrggbb","glow":"#rrggbb","ground":"#rrggbb","road":"#rrggbb","foliage":"#rrggbb","bark":"#rrggbb","variety":0.2,"surfaces":{"wall":kind,"wall2":kind,"roof":kind,"trim":kind,"ground":kind,"road":kind,"wear":0.6,"wet":0.2}},
"blueprints":[{"id":snake_case,"summary":str,"family":str,"dials":{"<dial>":number or string},"parts":[[shape,x,z,y,w,d,h,rot,tone,repeat,gap],...],"doorX":0}],
"buildings":[{"id":"<structure id from the outline>","blueprint":"<blueprint id>"}],
"props":[{"kind":snake_case,"family":str,"dials":{...},"parts":[[...],...],"size":8,"weight":3}],
"landmarks":[{"id":snake_case,"prompt":str,"place":"plaza","height":8}]}
Write style first (with its surfaces), then blueprints, then buildings, props and landmarks. Every structure in the outline gets exactly one entry in "buildings", and every blueprint is used at least once. Structures with different forms get different blueprints; structures with the same form may share one. Use every dial name exactly as the catalogue spells it, with a value inside the listed range or from the listed choices.`;

let cached: string | null = null;

/** Stable across requests so the prompt cache can hit; the outline and the player's prompt go in the user turn. */
export function lookSystemPrompt(): string {
  if (!cached) cached = [ROLE, PRINCIPLE, SCALE, `SKELETON CATALOGUE\n${skeletonCatalogText()}`, VOCAB, EXAMPLE, STYLE, SURFACES, LIGHT, PROPS, LANDMARKS, BUDGET, SHAPE].join('\n\n');
  return cached;
}

export function lookUserMessage(prompt: string, seed: number, outline: Outline): string {
  const n = outline.buildings.length;
  const settled = outline.terrain.settled >= 0.5;
  const structures = n === 0
    ? 'no blueprints (nothing is built here)'
    : settled
      ? `a blueprint for every structure form (at least two of them MUST stand 14 m or taller: use tower, spire, tiers or block with the height or module dial raised to match, even for sheds, cranes, stacks and masts; check this before you answer)`
      : `a blueprint for each of the ${n} point${n === 1 ? '' : 's'} of interest, natural where the form is natural`;
  return `${outlineBrief(outline)}\n\nSeed: ${seed}\nPlayer prompt: ${prompt}\nDesign the look now, in grounded realism: a muted, material-true style with surfaces that fit this land and its weather, ${structures}, 3 to 6 props at real sizes that are this land's own cover (at least one is a tree or plant family prop whenever the place has any greenery at all, such as a village, a coast, a yard or a garden), 0 to 2 landmarks.`;
}
