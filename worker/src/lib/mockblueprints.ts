// Hand-written blueprints. They serve two jobs: worked examples inside the compile prompt, and
// stand-in architecture for mock mode when a fixture carries no blueprints of its own.
// Footprint fractions: x/z in -0.5..0.5 with +z the street front; y and h in metres.
import type { Blueprint, BlueprintPart, PartShape, PartTone, PropBlueprint } from '../../../app/src/world/spec';

function part(shape: PartShape, x: number, z: number, y: number, w: number, d: number, h: number, tone: PartTone, rot = 0, repeat = 1, gap = 0): BlueprintPart {
  return { shape, x, z, y, w, d, h, rot, tone, repeat, gap };
}

/** Two-storey western false-front saloon, footprint about 9 x 8 m. */
export const SALOON_BLUEPRINT: Blueprint = {
  id: 'saloon_front',
  summary: 'two-storey saloon with a tall false front, cornice, balcony and swing doors',
  doorX: 0,
  parts: [
    part('box', 0, -0.1, 0, 0.96, 0.7, 6, 'wall'), // main body, two storeys
    part('box', 0, 0.26, 0, 1, 0.06, 8, 'wall2'), // false front rising above the roof line
    part('box', 0, -0.1, 6, 0.96, 0.7, 0.2, 'roof'), // flat roof at body height
    part('box', 0, 0.27, 7.6, 1.04, 0.1, 0.4, 'trim'), // cornice
    part('box', 0, 0.4, 3, 0.9, 0.2, 0.15, 'trim'), // balcony deck
    part('box', 0, 0.46, 0, 0.04, 0.04, 3, 'trim', 0, 5, 0.22), // balcony posts
    part('box', 0, 0.46, 3.15, 0.03, 0.03, 0.9, 'trim', 0, 10, 0.1), // rail balusters
    part('box', 0, 0.46, 4.05, 0.9, 0.04, 0.08, 'trim'), // rail top
    part('box', 0, 0.3, 0, 0.14, 0.02, 2.4, 'dark'), // front door
    part('box', 0, 0.31, 0.9, 0.12, 0.02, 1.2, 'accent'), // swing doors
    part('box', 0, 0.3, 1, 0.1, 0.02, 1.2, 'glass', 0, 2, 0.6), // ground-floor windows
    part('box', 0, 0.3, 3.6, 0.1, 0.02, 1.3, 'glass', 0, 3, 0.3), // upper windows
    part('box', 0, 0.31, 5.2, 0.6, 0.03, 0.9, 'accent'), // sign board
    part('box', 0.3, -0.3, 6, 0.08, 0.08, 1.4, 'dark'), // chimney
  ],
};

/** Gate pagoda, footprint about 8 x 8 m. A setting outside the four kits. */
export const PAGODA_BLUEPRINT: Blueprint = {
  id: 'pagoda_gate',
  summary: 'stone-based gate pagoda with red pillars, two curved-eave tiers, lanterns and a finial',
  doorX: 0,
  parts: [
    part('box', 0, 0, 0, 1, 0.9, 0.4, 'wall2'), // stone platform
    part('cylinder', 0, 0.38, 0.4, 0.1, 0.1, 4, 'accent', 0, 2, 0.76), // front pillars
    part('cylinder', 0, -0.38, 0.4, 0.1, 0.1, 4, 'accent', 0, 2, 0.76), // back pillars
    part('box', 0, 0.38, 3.4, 0.85, 0.08, 0.2, 'accent'), // tie beam
    part('box', 0, 0.38, 4.4, 1.1, 0.12, 0.3, 'dark'), // main beam
    part('gable', 0, 0, 4.4, 1.3, 1, 1, 'roof'), // lower roof
    part('box', 0, 0, 5, 0.6, 0.55, 2, 'wall'), // upper chamber
    part('box', 0, 0.285, 5.6, 0.1, 0.02, 0.8, 'glow', 0, 3, 0.17), // lit upper windows
    part('gable', 0, 0, 7, 0.9, 0.8, 1.3, 'roof'), // upper roof
    part('cone', 0, 0, 8.3, 0.05, 0.05, 0.8, 'accent'), // finial
    part('sphere', 0, 0.4, 2.8, 0.06, 0.06, 0.5, 'glow', 0, 2, 0.76), // hanging lanterns
    part('box', 0, 0.43, 3.6, 0.3, 0.02, 0.7, 'accent'), // name plaque hung from the tie beam
    part('box', 0, 0.47, 0, 0.4, 0.1, 0.2, 'wall2'), // entrance step
  ],
};

/** Plain gabled house, footprint about 6 x 6 m. Used by mock mode for ordinary lots. */
export const HOUSE_BLUEPRINT: Blueprint = {
  id: 'plain_house',
  summary: 'single-storey house with a gabled roof, chimney, door and two windows',
  doorX: 0,
  parts: [
    part('box', 0, 0, 0, 0.9, 0.85, 3, 'wall'),
    part('gable', 0, 0, 3, 1.05, 1, 1.6, 'roof'),
    part('box', 0, 0.43, 0, 0.16, 0.02, 2.1, 'dark'),
    part('box', 0, 0.43, 1.1, 0.14, 0.02, 0.9, 'glass', 0, 2, 0.56),
    part('box', 0.28, -0.1, 3, 0.1, 0.1, 1.8, 'trim'),
    part('box', 0, 0.47, 0, 0.4, 0.1, 0.15, 'trim'),
  ],
};

/** A hanging lantern on a post, 2 m tall. */
export const LANTERN_PROP: PropBlueprint = {
  kind: 'post_lantern',
  size: 2,
  weight: 3,
  parts: [
    part('cylinder', 0, 0, 0, 0.12, 0.12, 2, 'dark'),
    part('box', 0, 0.12, 1.7, 0.02, 0.2, 0.05, 'dark'),
    part('sphere', 0, 0.2, 1.4, 0.16, 0.16, 0.3, 'glow'),
  ],
};

export const MOCK_BLUEPRINTS: readonly Blueprint[] = [SALOON_BLUEPRINT, PAGODA_BLUEPRINT, HOUSE_BLUEPRINT];
