// Architecture for the western fixture: frontier timber and adobe, built from blueprint parts.
import type { LandmarkSpec, PropBlueprint, StyleSpec } from '../spec';
import { blueprint, box, cone, cyl, door, gable, propOf, pyramid, sphere, windows } from './util';

export const westernStyle: StyleSpec = {
  name: 'weathered frontier timber',
  wall: '#c49a68',
  wall2: '#7d6a48',
  roof: '#5e4332',
  trim: '#e6d6b4',
  accent: '#a8442a',
  dark: '#2a2018',
  glass: '#5a7a82',
  glow: '#ffc24a',
  ground: '#c9a26b',
  road: '#b08c5c',
  variety: 0.25,
};

export const westernBlueprints = [
  // Two storeys behind a tall false front, porch below, balcony above. Used for the saloon and the hotel.
  blueprint('false_front_saloon', 'two-storey false-front saloon with a balcony over a deep porch', 0, [
    box(0, -0.06, 0, 0.9, 0.76, 6, 'wall'),
    gable(0, -0.06, 6, 0.94, 0.8, 1, 'roof'),
    box(0, 0.3, 6, 0.9, 0.06, 1.5, 'wall2'),
    box(0, 0.3, 7.5, 0.46, 0.06, 0.6, 'wall2'),
    box(0, 0.335, 6.15, 0.56, 0.02, 0.95, 'accent'),
    box(0, 0.42, 0, 0.96, 0.2, 0.25, 'trim'),
    cyl(0, 0.5, 0.25, 0.035, 0.035, 2.75, 'trim', { repeat: 4, gap: 0.29 }),
    box(0, 0.42, 3, 0.96, 0.2, 0.15, 'trim'),
    cyl(0, 0.5, 3.15, 0.016, 0.016, 0.85, 'trim', { repeat: 9, gap: 0.115 }),
    box(0, 0.5, 4, 0.96, 0.03, 0.07, 'trim'),
    cyl(0, 0.5, 3.15, 0.035, 0.035, 1.85, 'trim', { repeat: 2, gap: 0.94 }),
    box(0, 0.42, 5, 0.98, 0.24, 0.12, 'roof'),
    windows(0, 3.7, 4, 0.26, 0.32, 0.09, 1.2),
    windows(0, 0.9, 2, 0.62, 0.32, 0.15, 1.3),
    door(0, 0.32, 0.16, 2.3),
    box(-0.34, -0.2, 6, 0.06, 0.08, 1.6, 'dark'),
  ]),
  // Single storey, deep porch, barred window, flag on the roof.
  blueprint('sheriff_office', 'sheriff office with a porch, a barred window and a flag', -0.12, [
    box(0, -0.08, 0, 0.86, 0.84, 3.2, 'wall'),
    gable(0, -0.08, 3.2, 0.92, 0.9, 1.5, 'roof'),
    box(0, 0.43, 0, 0.92, 0.18, 0.2, 'trim'),
    cyl(0, 0.5, 0.2, 0.035, 0.035, 2.4, 'trim', { repeat: 3, gap: 0.4 }),
    box(0, 0.43, 2.6, 0.94, 0.2, 0.12, 'roof'),
    door(-0.12, 0.34, 0.12, 2.2),
    windows(0.26, 1, 1, 0, 0.34, 0.16, 1.1),
    cyl(0.26, 0.35, 1, 0.012, 0.012, 1.1, 'dark', { repeat: 5, gap: 0.035 }),
    windows(-0.34, 1, 1, 0, 0.34, 0.12, 1.1),
    box(0, 0.5, 2.2, 0.4, 0.02, 0.3, 'accent'),
    box(0.3, -0.25, 3.2, 0.07, 0.09, 1.5, 'wall2'),
    cyl(-0.42, 0.3, 3.2, 0.015, 0.015, 2.4, 'dark'),
    box(-0.36, 0.3, 4.6, 0.1, 0.01, 0.5, 'accent'),
    cyl(0.42, 0.46, 0, 0.07, 0.07, 0.9, 'wall2'),
  ]),
  // Stone block with pilasters, a stepped door and a low hipped roof.
  blueprint('stone_bank', 'stone bank with pilasters, barred windows and a stepped entrance', 0, [
    box(0, -0.05, 0, 0.9, 0.9, 4.2, 'wall2'),
    box(0, -0.05, 4.2, 0.96, 0.96, 0.25, 'trim'),
    pyramid(0, -0.05, 4.45, 0.8, 0.8, 1.2, 'roof'),
    box(0, 0.41, 0, 0.09, 0.08, 0.4, 'wall2', { repeat: 4, gap: 0.3 }),
    box(0, 0.41, 0.4, 0.07, 0.06, 3.5, 'trim', { repeat: 4, gap: 0.3 }),
    box(0, 0.41, 3.9, 0.09, 0.08, 0.3, 'trim', { repeat: 4, gap: 0.3 }),
    box(0, 0.46, 0, 0.5, 0.14, 0.3, 'trim'),
    door(0, 0.4, 0.16, 2.5),
    box(0, 0.41, 2.5, 0.2, 0.04, 0.5, 'trim'),
    windows(0, 1.3, 2, 0.6, 0.4, 0.14, 1.6),
    cyl(0, 0.42, 1.3, 0.01, 0.01, 1.6, 'dark', { repeat: 2, gap: 0.6 }),
    windows(0, 3, 3, 0.3, 0.4, 0.1, 0.8),
    box(0, 0.425, 3.7, 0.5, 0.03, 0.3, 'accent'),
  ]),
  // Adobe mission: nave with a front bell tower, open belfry and a cross.
  blueprint('mission_church', 'adobe mission church with a front bell tower and a cross', 0, [
    box(0, 0.05, 0, 0.78, 0.8, 3.4, 'wall'),
    gable(0, 0.05, 3.4, 0.9, 0.86, 2, 'roof', { rot: 90 }),
    box(0, 0.35, 0, 0.3, 0.26, 5.4, 'wall'),
    cyl(0, 0.35, 5.4, 0.03, 0.03, 1.2, 'wall2', { repeat: 2, gap: 0.22 }),
    cyl(0, 0.35, 5.4, 0.03, 0.03, 1.2, 'wall2', { rot: 90, repeat: 2, gap: 0.2 }),
    box(0, 0.35, 5.4, 0.12, 0.12, 0.3, 'wall2'),
    cone(0, 0.35, 5.7, 0.06, 0.07, 0.6, 'accent'),
    pyramid(0, 0.35, 6.6, 0.36, 0.32, 1.8, 'roof'),
    box(0, 0.35, 8.4, 0.02, 0.02, 0.7, 'trim'),
    box(0, 0.35, 8.8, 0.1, 0.02, 0.05, 'trim'),
    box(0.395, 0, 1.4, 0.1, 0.03, 1.6, 'glass', { rot: 90, repeat: 3, gap: 0.22 }),
    box(-0.395, 0, 1.4, 0.1, 0.03, 1.6, 'glass', { rot: 90, repeat: 3, gap: 0.22 }),
    box(0, 0.492, 3, 0.1, 0.02, 0.9, 'glass'),
    door(0, 0.48, 0.12, 2.2),
    box(0, 0.485, 2.2, 0.16, 0.04, 0.5, 'trim'),
    box(0, 0.5, 0, 0.3, 0.12, 0.2, 'trim'),
  ]),
  // Barn-like livery: wide door, hayloft hatch, lean-to and a hitching rail.
  blueprint('livery_stable', 'livery stable with a wide door, hayloft hatch, lean-to and hitching rail', 0, [
    box(0, -0.05, 0, 0.9, 0.9, 4.2, 'wall'),
    gable(0, -0.05, 4.2, 0.96, 0.96, 1.4, 'roof'),
    door(0, 0.4, 0.36, 2.5),
    box(0, 0.4, 2.5, 0.42, 0.04, 0.1, 'trim'),
    box(0, 0.4, 0, 0.04, 0.04, 2.5, 'trim', { repeat: 2, gap: 0.4 }),
    box(0, 0.405, 3, 0.2, 0.03, 1.1, 'dark'),
    box(0, 0.46, 4.2, 0.04, 0.14, 0.05, 'trim'),
    windows(0, 1.5, 2, 0.7, 0.4, 0.1, 0.6, 'dark'),
    box(0.5, -0.05, 0, 0.3, 0.7, 2.2, 'wall2'),
    box(0.5, -0.05, 2.2, 0.34, 0.74, 0.12, 'roof'),
    cyl(0, 0.5, 0, 0.03, 0.03, 1, 'wall2', { repeat: 2, gap: 0.7 }),
    box(0, 0.5, 0.9, 0.76, 0.03, 0.06, 'wall2'),
    cyl(0, 0, 5.6, 0.01, 0.01, 0.8, 'dark'),
    box(0, 0, 6.4, 0.12, 0.01, 0.1, 'accent'),
  ]),
  // Dry-goods store: striped awning on posts, big display window, crates and barrel out front.
  blueprint('general_store', 'general store with a striped awning, display window and crates', 0.1, [
    box(0, -0.05, 0, 0.9, 0.9, 3.4, 'wall'),
    box(0, 0.35, 3.4, 0.9, 0.06, 1.1, 'wall2'),
    gable(0, -0.05, 3.4, 0.94, 0.94, 0.9, 'roof'),
    box(0, 0.415, 3.6, 0.6, 0.02, 0.7, 'accent'),
    box(0, 0.5, 2.6, 0.96, 0.3, 0.08, 'accent'),
    box(0, 0.5, 2.68, 0.1, 0.3, 0.04, 'wall2', { repeat: 5, gap: 0.2 }),
    box(0, 0.5, 2.5, 0.96, 0.02, 0.15, 'wall2'),
    cyl(0, 0.5, 0, 0.03, 0.03, 2.6, 'trim', { repeat: 2, gap: 0.88 }),
    door(0.1, 0.4, 0.12, 2.2),
    box(-0.28, 0.405, 0.9, 0.3, 0.03, 1.3, 'glass'),
    windows(0.35, 1, 1, 0, 0.4, 0.12, 1),
    box(-0.3, 0.5, 0, 0.1, 0.08, 0.5, 'wall2'),
    cyl(0.4, 0.5, 0, 0.06, 0.06, 0.9, 'wall2'),
    box(-0.3, -0.3, 3.4, 0.07, 0.09, 1.2, 'wall2'),
  ]),
  // Small adobe cabin with shutters, a woodpile and a barrel.
  blueprint('adobe_cabin', 'small adobe cabin with shutters, a woodpile and a rain barrel', 0, [
    box(0, 0, 0, 0.84, 0.8, 2.6, 'wall'),
    gable(0, 0, 2.6, 0.92, 0.88, 1.3, 'roof'),
    door(0, 0.4, 0.2, 2),
    box(0, 0.41, 2, 0.26, 0.02, 0.1, 'trim'),
    windows(0, 1.1, 2, 0.6, 0.4, 0.14, 0.8),
    box(0, 0.41, 0.98, 0.14, 0.04, 0.05, 'trim', { repeat: 2, gap: 0.6 }),
    box(-0.3, 0.41, 1.1, 0.05, 0.02, 0.8, 'wall2', { repeat: 2, gap: 0.2 }),
    box(0.3, 0.41, 1.1, 0.05, 0.02, 0.8, 'wall2', { repeat: 2, gap: 0.2 }),
    box(0.3, -0.1, 2.6, 0.1, 0.1, 1.8, 'wall2'),
    box(0, 0.46, 0, 0.4, 0.14, 0.2, 'trim'),
    cyl(0.4, 0.45, 0, 0.07, 0.07, 0.8, 'wall2'),
    box(-0.48, -0.1, 0, 0.14, 0.5, 1, 'wall2'),
  ]),
];

// Props are authored at unit scale (longest dimension 1) and scaled up to `size` metres.
export const westernProps: PropBlueprint[] = [
  propOf('hitching_post', 1.8, 3, [
    cyl(0, 0, 0, 0.05, 0.05, 0.6, 'wall2', { repeat: 2, gap: 0.8 }),
    box(0, 0, 0.42, 0.9, 0.05, 0.06, 'wall2'),
    box(0, 0, 0.25, 0.9, 0.04, 0.05, 'wall2'),
  ]),
  propOf('water_trough', 1.5, 2, [
    box(0, 0, 0.05, 1, 0.38, 0.34, 'wall2'),
    box(0, 0, 0.3, 0.9, 0.3, 0.06, 'glass'),
    box(0, 0, 0, 0.06, 0.44, 0.1, 'dark', { repeat: 2, gap: 0.8 }),
  ]),
  propOf('barrel_stack', 1.2, 3, [
    cyl(-0.25, 0, 0, 0.4, 0.4, 0.6, 'wall2'),
    cyl(0.25, 0.05, 0, 0.4, 0.4, 0.6, 'wall2'),
    cyl(0, -0.05, 0.6, 0.4, 0.4, 0.4, 'wall2'),
    box(0.3, -0.3, 0, 0.3, 0.3, 0.3, 'wall'),
  ]),
  propOf('crate_stack', 1.1, 3, [
    box(-0.2, 0, 0, 0.5, 0.5, 0.5, 'wall'),
    box(0.3, 0.1, 0, 0.4, 0.4, 0.4, 'wall2'),
    box(-0.1, 0, 0.5, 0.4, 0.4, 0.4, 'wall2', { rot: 20 }),
  ]),
  propOf('lamp_post', 3, 2, [
    cyl(0, 0, 0, 0.06, 0.06, 0.9, 'dark'),
    box(0, 0, 0.9, 0.2, 0.2, 0.08, 'dark'),
    sphere(0, 0, 0.98, 0.14, 0.14, 0.1, 'glow'),
  ]),
  propOf('tumbleweed', 0.9, 1, [
    sphere(0, 0, 0, 0.9, 0.9, 0.8, 'wall2'),
    sphere(0.1, 0.05, 0.1, 0.7, 0.7, 0.6, 'wall'),
  ]),
];

export const westernLandmarks: LandmarkSpec[] = [
  {
    id: 'water_tower',
    prompt: 'a weathered wooden railroad water tower on four braced stilts with a conical shingle roof and a hanging spout, low-poly, single object',
    place: 'plaza',
    height: 10,
  },
];
