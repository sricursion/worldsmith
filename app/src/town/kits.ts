// Theme kits: which static mesh files render which building role and prop kind.
// URLs are served from assets/ (the Vite publicDir), so assets/third_party/x/y.glb is /third_party/x/y.glb.
// Native unit scales below were measured from accessor min/max in each file (first scene, node transforms applied).
import type { BuildingRole, ThemeId } from '../world/spec';

export interface KitManifest {
  theme: ThemeId;
  pack: string; // primary pack; individual files may come from the sibling packs noted below
  buildings: Record<BuildingRole, string[]>; // role -> candidate mesh files; [] means procedural fallback
  props: Record<string, string>;             // prop kind -> mesh file; missing kind means procedural fallback
  ground: { color: string; texture?: string };
  /** Building meshes are rescaled in build.ts so their width matches the lot footprint. */
  scaleToFootprint?: boolean;
  /** Rough multiplier applied before fitting, so the 0.4..4 fit clamp has room (native buildings are 1 to 2 units wide). */
  unitScale?: number;
  /** Rotation (radians about Y) that turns the pack's door side towards -Z. */
  facingOffset?: number;
}

const ALL_ROLES: BuildingRole[] = [
  'saloon', 'tavern', 'inn', 'bank', 'jail', 'sheriff', 'church', 'stable',
  'general_store', 'market', 'blacksmith', 'house', 'hotel', 'townhall',
  'doctor', 'school', 'barber', 'undertaker', 'warehouse', 'workshop',
  'lab', 'hangar', 'cantina', 'command', 'habitat', 'reactor',
  'cafe', 'office', 'shop', 'garage', 'apartment', 'station', 'plaza',
];

function roles(map: Partial<Record<BuildingRole, string[]>>): Record<BuildingRole, string[]> {
  const out = {} as Record<BuildingRole, string[]>;
  for (const r of ALL_ROLES) out[r] = map[r] ?? [];
  return out;
}

const letters = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
};

const url = (pack: string, file: string): string => `/third_party/${pack}/${file}`;

// ---- medieval: kaykit-medieval-hexagon -------------------------------------------------------
// Native scale about 0.8 to 2 units wide (a hex tile is 2 units across); castle is 2 x 4 x 2.3, tavern 1.2 x 1.4 x 1.3.
// Files are .gltf with a sibling .bin and a shared texture, in one folder per team colour.
const HEX = 'kaykit-medieval-hexagon';
const hex = (name: string, colours: string[] = ['blue', 'green', 'red']): string[] =>
  colours.map((c) => url(HEX, `buildings/${c}/building_${name}_${c}.gltf`));
const hexNeutral = (file: string): string => url(HEX, `buildings/neutral/${file}.gltf`);
const homes = [...hex('home_A'), ...hex('home_B')];

const medieval: KitManifest = {
  theme: 'medieval',
  pack: HEX,
  buildings: roles({
    tavern: hex('tavern'), inn: hex('tavern'), saloon: hex('tavern'), cantina: hex('tavern'), cafe: hex('tavern'),
    church: hex('church'),
    blacksmith: hex('blacksmith'), workshop: hex('blacksmith'),
    market: hex('market'), general_store: hex('market'), shop: hex('market'),
    house: homes, apartment: homes, habitat: homes, hotel: hex('home_B'), office: hex('home_B'),
    jail: hex('barracks'), sheriff: hex('barracks'),
    townhall: [...hex('castle'), ...hex('tower_A')], bank: [...hex('castle'), ...hex('tower_A')], command: hex('castle'),
    stable: hex('lumbermill'), warehouse: hex('lumbermill'), garage: hex('lumbermill'), hangar: hex('lumbermill'),
    doctor: hex('home_A'), school: hex('home_A'), undertaker: hex('home_A'), barber: hex('home_A'),
    lab: hex('tower_B'), reactor: hex('tower_B'), station: hex('tower_A'),
    plaza: hex('well'),
  }),
  props: {
    // kenney-fantasy-town-kit, kenney-nature-kit, kenney-survival-kit, kenney-pirate-kit
    barrel: url('kenney-survival-kit', 'barrel.glb'),
    crate: url('kenney-pirate-kit', 'crate.glb'),
    tree: url('kenney-nature-kit', 'tree_oak.glb'),
    bush: url('kenney-nature-kit', 'plant_bushLarge.glb'),
    well: url(HEX, 'buildings/blue/building_well_blue.gltf'),
    cart: url('kenney-fantasy-town-kit', 'cart.glb'),
    lantern: url('kenney-fantasy-town-kit', 'lantern.glb'),
    hedge: url('kenney-fantasy-town-kit', 'hedge.glb'),
    fence: url('kenney-fantasy-town-kit', 'fence.glb'),
    banner_red: url('kenney-fantasy-town-kit', 'banner-red.glb'),
    banner_green: url('kenney-fantasy-town-kit', 'banner-green.glb'),
    fountain: url('kenney-fantasy-town-kit', 'fountain-round.glb'),
    rock: url('kenney-fantasy-town-kit', 'rock-large.glb'),
  },
  ground: { color: '#6f8f4a' },
  scaleToFootprint: true,
  unitScale: 4,
  facingOffset: Math.PI,
};

// ---- scifi: kaykit-space-base-bits plus kenney-space-kit -------------------------------------
// kaykit-space-base-bits: modules about 2.2 x 1 x 2.2, cargo depot 2.1 x 1.1 x 2.1, containers 0.5 x 0.2 x 0.5 (.gltf + .bin).
// kenney-space-kit: hangar_smallA 2 x 1 x 2, generator 1 x 0.7 x 1.3, satellite dish 0.7 x 0.6 x 0.6 (.glb).
const SB = 'kaykit-space-base-bits';
const SK = 'kenney-space-kit';
const sb = (n: string): string => url(SB, `${n}.gltf`);
const modules = letters('A', 'E').map((l) => sb(`basemodule_${l}`));
const depots = letters('A', 'C').map((l) => sb(`cargodepot_${l}`));

const scifi: KitManifest = {
  theme: 'scifi',
  pack: SB,
  buildings: roles({
    habitat: modules, house: modules, apartment: modules, hotel: modules, inn: modules, school: modules, barber: modules, undertaker: modules,
    warehouse: depots, stable: depots, garage: depots, workshop: depots, blacksmith: depots,
    hangar: [sb('lander_A'), sb('lander_B'), sb('landingpad_small')], station: [sb('lander_A'), sb('lander_B'), sb('landingpad_small')],
    command: [sb('structure_tall')], townhall: [sb('structure_tall')], bank: [sb('structure_tall')], church: [sb('structure_tall')],
    lab: [sb('drill_structure'), sb('structure_low')], doctor: [sb('drill_structure'), sb('structure_low')],
    cantina: [sb('basemodule_garage')], saloon: [sb('basemodule_garage')], tavern: [sb('basemodule_garage')], cafe: [sb('basemodule_garage')],
    reactor: [url(SK, 'machine_generatorLarge.glb'), url(SK, 'machine_generator.glb')],
    jail: [url(SK, 'hangar_smallA.glb')], sheriff: [url(SK, 'hangar_smallA.glb')],
    shop: [url(SK, 'hangar_roundGlass.glb')], market: [url(SK, 'hangar_roundGlass.glb')], general_store: [url(SK, 'hangar_roundGlass.glb')],
    office: modules,
    plaza: [sb('landingpad_small')],
  }),
  props: {
    crate: sb('cargo_A'),
    container: sb('containers_A'),
    antenna: url(SK, 'satelliteDish.glb'),
    light_pole: sb('lights'),
    plant_pod: url(SK, 'rock_crystals.glb'),
    cargo_stack: sb('cargo_B_stacked'),
    solarpanel: sb('solarpanel'),
    windturbine: sb('windturbine_low'),
    rocks: sb('rocks_A'),
    rock: sb('rock_B'),
    barrels: url(SK, 'barrels.glb'),
    crater: url(SK, 'crater.glb'),
    pipe: url(SK, 'pipe_straight.glb'),
  },
  ground: { color: '#5b5a63' },
  scaleToFootprint: true,
  unitScale: 4,
  facingOffset: Math.PI,
};

// ---- modern: kenney-city-kit-suburban / -commercial plus kaykit-city-builder-bits -------------
// kenney-city-kit-suburban: houses about 1.3 x 0.8 x 1.0. kenney-city-kit-commercial: 0.9 x 1.3 x 0.9, skyscrapers 1.4 x 2.9 x 1.4.
// kaykit-city-builder-bits: buildings 2 x 1.65 x 2 (.gltf + .bin); props are roughly 0.1 to 0.9 units (car 0.4 x 0.4 x 0.9).
const SUB = 'kenney-city-kit-suburban';
const COM = 'kenney-city-kit-commercial';
const CB = 'kaykit-city-builder-bits';
const suburban = letters('a', 'u').map((l) => url(SUB, `building-type-${l}.glb`));
const commercial = letters('a', 'n').map((l) => url(COM, `building-${l}.glb`));
const skyscrapers = letters('a', 'e').map((l) => url(COM, `building-skyscraper-${l}.glb`));
const cityBits = letters('A', 'H').map((l) => url(CB, `building_${l}.gltf`));

const modern: KitManifest = {
  theme: 'modern',
  pack: COM,
  buildings: roles({
    house: suburban, apartment: [...suburban, ...cityBits.slice(0, 4)], habitat: suburban, hotel: [...skyscrapers.slice(0, 2), ...commercial],
    cafe: commercial, shop: commercial, market: commercial, general_store: commercial, saloon: commercial, tavern: commercial, cantina: commercial, inn: commercial,
    office: [...skyscrapers, ...commercial], bank: [...commercial, ...cityBits], townhall: [...skyscrapers, ...cityBits],
    command: skyscrapers, school: [...commercial, ...cityBits], doctor: commercial, barber: commercial, undertaker: commercial, lab: commercial,
    jail: cityBits, sheriff: cityBits, church: cityBits, blacksmith: cityBits, workshop: cityBits, reactor: cityBits,
    station: [url(CB, 'watertower.gltf'), ...cityBits.slice(0, 3)],
    warehouse: [url(CB, 'watertower.gltf'), ...cityBits.slice(4)], stable: cityBits.slice(4), garage: cityBits.slice(4), hangar: cityBits.slice(4),
  }),
  props: {
    bench: url(CB, 'bench.gltf'),
    tree: url(SUB, 'tree-large.glb'),
    tree_small: url(SUB, 'tree-small.glb'),
    bin: url(CB, 'trash_A.gltf'),
    bin_b: url(CB, 'trash_B.gltf'),
    light_pole: url(CB, 'streetlight.gltf'),
    hydrant: url(CB, 'firehydrant.gltf'),
    car: url(CB, 'car_sedan.gltf'),
    car_hatchback: url(CB, 'car_hatchback.gltf'),
    car_taxi: url(CB, 'car_taxi.gltf'),
    bush: url(CB, 'bush.gltf'),
    dumpster: url(CB, 'dumpster.gltf'),
    planter: url(SUB, 'planter.glb'),
  },
  ground: { color: '#4b4f55' }, // asphalt grey; build.ts tints a lighter pavement band around the roads
  scaleToFootprint: true,
  unitScale: 4,
  facingOffset: Math.PI,
};

// ---- western: no finished kit, buildings are procedural -----------------------------------------
// kenney-survival-kit: barrel 0.24 x 0.34 x 0.24. kenney-nature-kit: cactus_tall 0.4 x 0.75 x 0.34.
// kenney-pirate-kit: crate 1.1 x 0.8 x 1.3, structure-fence a few units long.
const western: KitManifest = {
  theme: 'western',
  pack: 'kenney-survival-kit',
  buildings: roles({}),
  props: {
    barrel: url('kenney-survival-kit', 'barrel.glb'),
    barrel_open: url('kenney-survival-kit', 'barrel-open.glb'),
    crate: url('kenney-pirate-kit', 'crate.glb'),
    crate_bottles: url('kenney-pirate-kit', 'crate-bottles.glb'),
    cactus: url('kenney-nature-kit', 'cactus_tall.glb'),
    cactus_short: url('kenney-nature-kit', 'cactus_short.glb'),
    fence: url('kenney-pirate-kit', 'structure-fence.glb'),
    box: url('kenney-survival-kit', 'box.glb'),
    box_large: url('kenney-survival-kit', 'box-large.glb'),
    bucket: url('kenney-survival-kit', 'bucket.glb'),
    campfire: url('kenney-survival-kit', 'campfire-pit.glb'),
    signpost: url('kenney-survival-kit', 'signpost.glb'),
    signpost_single: url('kenney-survival-kit', 'signpost-single.glb'),
    tree_trunk: url('kenney-survival-kit', 'tree-trunk.glb'),
    rock: url('kenney-survival-kit', 'rock-sand-a.glb'),
    rock_b: url('kenney-survival-kit', 'rock-sand-b.glb'),
    rock_c: url('kenney-survival-kit', 'rock-sand-c.glb'),
    grass_patch: url('kenney-pirate-kit', 'grass-patch.glb'),
    rocks_sand: url('kenney-pirate-kit', 'rocks-sand-a.glb'),
  },
  ground: { color: '#c9a46a' },
  scaleToFootprint: true,
  unitScale: 4,
  facingOffset: Math.PI,
};

export const KITS: Record<ThemeId, KitManifest> = { western, medieval, scifi, modern };

/** Target size in metres of the largest dimension of a prop at scale 1; build.ts rescales kit meshes and sizes fallbacks to match. */
export const PROP_SIZES: Record<string, number> = {
  barrel: 0.95, barrel_open: 0.95, crate: 0.9, crate_bottles: 0.9, box: 0.8, box_large: 1.2, bucket: 0.5,
  cactus: 2.4, cactus_short: 1.2, fence: 3, water_trough: 2, hitching_post: 2.2, wagon_wheel: 1.4,
  tree: 6, tree_small: 3.5, tree_trunk: 2.5, bush: 1.4, well: 2.4, cart: 2.6, hay: 1.3, lantern: 2.2, hedge: 2.4,
  banner_red: 3, banner_green: 3, fountain: 3.5, rock: 1.4, rock_b: 1.1, rock_c: 0.9, rocks: 1.4, rocks_sand: 1.3,
  campfire: 1, signpost: 2, signpost_single: 2, grass_patch: 1.2,
  container: 3.6, antenna: 2.6, light_pole: 3.6, plant_pod: 1.4, cargo_stack: 1.6, solarpanel: 2.2, windturbine: 4.5,
  barrels: 1.2, crater: 3, pipe: 2.5,
  bench: 1.8, bin: 1.1, bin_b: 1.1, hydrant: 0.9, car: 4.2, car_hatchback: 3.8, car_taxi: 4.2, dumpster: 2, planter: 1,
};

/** Maximum building height in metres by size, so tall kit meshes (castles, towers) shrink to fit. */
export const MAX_BUILDING_HEIGHT = { small: 7, medium: 10, large: 14 } as const;
