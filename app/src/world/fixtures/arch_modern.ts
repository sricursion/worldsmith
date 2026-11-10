// Architecture for the modern fixture: a small coastal town in white clapboard, blue-grey render and glass.
import type { LandmarkSpec, PropBlueprint, StyleSpec } from '../spec';
import { blueprint, box, cone, cyl, door, gable, propOf, sphere, windows } from './util';

export const modernStyle: StyleSpec = {
  name: 'coastal clapboard, render and glass',
  wall: '#e8e2d6',
  wall2: '#9fb3bf',
  roof: '#555b63',
  trim: '#ffffff',
  accent: '#e07a3f',
  dark: '#2b2e33',
  glass: '#6f9db5',
  glow: '#fff1b8',
  ground: '#9aa58b',
  road: '#4d5156',
  variety: 0.3,
};

export const modernBlueprints = [
  // Glass-fronted cafe with a striped awning, a table and umbrella on the pavement.
  blueprint('cafe_corner', 'cafe with a big glass front, striped awning and a pavement table with an umbrella', 0.3, [
    box(0, -0.05, 0, 0.9, 0.9, 3.4, 'wall'),
    box(0, -0.05, 3.4, 0.96, 0.96, 0.15, 'roof'),
    box(-0.15, 0.405, 0.3, 0.5, 0.03, 2.4, 'glass'),
    box(-0.15, 0.415, 0.3, 0.02, 0.02, 2.4, 'trim', { repeat: 5, gap: 0.125 }),
    door(0.3, 0.4, 0.14, 2.2),
    box(0.3, 0.405, 2.2, 0.2, 0.03, 0.1, 'trim'),
    box(0, 0.5, 2.7, 0.96, 0.3, 0.08, 'accent'),
    box(0, 0.5, 2.78, 0.1, 0.3, 0.03, 'trim', { repeat: 6, gap: 0.16 }),
    box(0, 0.405, 2.95, 0.6, 0.02, 0.3, 'dark'),
    cyl(-0.3, 0.5, 0, 0.05, 0.05, 0.7, 'dark'),
    cyl(-0.3, 0.5, 0.7, 0.16, 0.16, 0.04, 'trim'),
    cyl(-0.3, 0.5, 0.7, 0.015, 0.015, 1.2, 'dark'),
    cone(-0.3, 0.5, 1.9, 0.28, 0.28, 0.4, 'accent'),
    box(0.3, -0.2, 3.55, 0.15, 0.15, 0.5, 'wall2'),
    box(0.44, 0.43, 0, 0.08, 0.04, 1, 'dark'),
  ]),
  // Two floors of window grid between a dark base and a trimmed parapet, with a canopy entrance.
  blueprint('office_block', 'two-storey office block with a window grid, entrance canopy and roof plant', 0, [
    box(0, 0, 0, 0.92, 0.8, 7, 'wall2'),
    box(0, 0, 7, 0.96, 0.84, 0.3, 'trim'),
    windows(-0.27, 1, 2, 0.2, 0.4, 0.1, 1.4),
    windows(0.27, 1, 2, 0.2, 0.4, 0.1, 1.4),
    windows(0, 4.6, 5, 0.18, 0.4, 0.12, 1.5),
    door(0, 0.4, 0.14, 2.3),
    box(0, 0.5, 2.6, 0.4, 0.3, 0.1, 'trim'),
    box(0, 0.405, 2.85, 0.3, 0.02, 0.25, 'accent'),
    box(0, 0.405, 3.5, 0.92, 0.02, 0.2, 'trim'),
    box(0, 0.405, 0, 0.92, 0.02, 0.3, 'dark'),
    box(0.25, -0.1, 7.3, 0.3, 0.3, 0.8, 'wall'),
    cyl(-0.3, -0.1, 7.3, 0.02, 0.02, 1.4, 'dark'),
    box(0, 0.46, 0, 0.4, 0.1, 0.15, 'wall'),
    box(0, 0.46, 0, 0.1, 0.1, 0.4, 'dark', { repeat: 2, gap: 0.8 }),
  ]),
  // Two roller doors and a side door under a flat roof, with tyres, a drum and a rear lean-to.
  blueprint('roller_garage', 'garage with two roller doors, a side door, tyre stack and a rear lean-to', -0.38, [
    box(0, -0.05, 0, 0.92, 0.9, 3.6, 'wall2'),
    box(0, -0.05, 3.6, 0.96, 0.94, 0.2, 'roof'),
    box(0.12, 0.405, 0, 0.34, 0.03, 2.7, 'wall', { repeat: 2, gap: 0.4 }),
    box(0, 0.405, 2.8, 0.9, 0.03, 0.1, 'dark'),
    door(-0.38, 0.4, 0.1, 2.1),
    box(-0.38, 0.41, 2.35, 0.08, 0.02, 0.08, 'glow'),
    box(0, 0.405, 3, 0.6, 0.02, 0.35, 'accent'),
    cyl(0.42, 0.5, 0, 0.07, 0.07, 0.8, 'accent'),
    cyl(-0.45, 0.5, 0, 0.08, 0.08, 0.3, 'dark'),
    cyl(-0.45, 0.5, 0.3, 0.08, 0.08, 0.3, 'dark'),
    box(0.3, -0.2, 3.8, 0.3, 0.3, 0.5, 'wall'),
    cyl(-0.3, -0.2, 3.8, 0.06, 0.06, 0.6, 'dark'),
    box(0, -0.5, 0, 0.6, 0.2, 2.2, 'wall2'),
    box(0, -0.5, 2.2, 0.64, 0.24, 0.08, 'roof'),
    box(0.15, 0.5, 0, 0.7, 0.2, 0.06, 'trim'),
  ]),
  // Three storeys with repeated balconies and glazed rails; a lobby with a canopy at street level.
  blueprint('apartment_block', 'three-storey apartment block with repeated balconies, glass rails and a canopy lobby', 0, [
    box(0, -0.15, 0, 0.92, 0.7, 9.6, 'wall'),
    box(0, -0.15, 9.6, 0.96, 0.74, 0.2, 'roof'),
    box(0.25, -0.2, 9.8, 0.3, 0.3, 0.9, 'wall2'),
    box(0, 0.36, 3.2, 0.18, 0.32, 0.1, 'trim', { repeat: 4, gap: 0.24 }),
    box(0, 0.36, 6.4, 0.18, 0.32, 0.1, 'trim', { repeat: 4, gap: 0.24 }),
    box(0, 0.5, 3.3, 0.18, 0.02, 0.9, 'glass', { repeat: 4, gap: 0.24 }),
    box(0, 0.5, 6.5, 0.18, 0.02, 0.9, 'glass', { repeat: 4, gap: 0.24 }),
    windows(0, 3.4, 4, 0.24, 0.2, 0.15, 1.4),
    windows(0, 6.6, 4, 0.24, 0.2, 0.15, 1.4),
    windows(0, 1, 2, 0.6, 0.2, 0.2, 1.4),
    door(0, 0.2, 0.2, 2.4),
    box(0, 0.35, 2.7, 0.4, 0.3, 0.08, 'accent'),
    box(0, 0.205, 2.4, 0.3, 0.02, 0.15, 'accent'),
    box(0, 0.3, 0, 0.4, 0.2, 0.15, 'wall2'),
  ]),
  // Gabled house with a covered porch, shutters, chimney and a mailbox.
  blueprint('gable_house', 'small gabled house with a covered porch, shutters, chimney and mailbox', -0.2, [
    box(0, 0, 0, 0.84, 0.84, 0.2, 'wall2'),
    box(0, 0, 0, 0.8, 0.8, 2.6, 'wall'),
    gable(0, 0, 2.6, 0.9, 0.92, 1.8, 'roof', { rot: 90 }),
    box(-0.2, 0.46, 0, 0.4, 0.2, 0.12, 'trim'),
    cyl(-0.2, 0.5, 0.12, 0.03, 0.03, 2, 'trim', { repeat: 2, gap: 0.36 }),
    box(-0.2, 0.46, 2.12, 0.46, 0.28, 0.1, 'roof'),
    door(-0.2, 0.4, 0.14, 2, 'accent'),
    windows(0.22, 1, 1, 0, 0.4, 0.2, 1),
    box(0.22, 0.41, 1, 0.04, 0.02, 1, 'accent', { repeat: 2, gap: 0.26 }),
    box(0, 0.455, 3.3, 0.14, 0.02, 0.5, 'glass'),
    box(0.3, -0.1, 2.6, 0.1, 0.1, 2.2, 'wall2'),
    cyl(0.45, 0.5, 0, 0.015, 0.015, 0.9, 'dark'),
    box(0.45, 0.5, 0.9, 0.06, 0.1, 0.12, 'accent'),
  ]),
  // Corner shop under a flat roof: big window, sign band, bench out front.
  blueprint('corner_shop', 'corner shop with a big shop window, bold sign band and a pavement bench', -0.3, [
    box(0, -0.05, 0, 0.9, 0.9, 3.8, 'wall2'),
    box(0, -0.05, 3.8, 0.96, 0.96, 0.15, 'roof'),
    box(0.1, 0.405, 0.3, 0.6, 0.03, 2.3, 'glass'),
    box(0.1, 0.415, 0.3, 0.02, 0.02, 2.3, 'trim', { repeat: 4, gap: 0.2 }),
    door(-0.3, 0.4, 0.16, 2.3),
    box(-0.3, 0.405, 2.3, 0.24, 0.03, 0.1, 'trim'),
    box(0, 0.41, 2.75, 0.9, 0.03, 0.5, 'accent'),
    box(0, 0.43, 2.9, 0.6, 0.01, 0.2, 'trim'),
    box(0.15, 0.5, 0, 0.04, 0.08, 0.4, 'dark', { repeat: 2, gap: 0.4 }),
    box(0.15, 0.5, 0.4, 0.5, 0.1, 0.05, 'trim'),
    box(0.15, 0.46, 0.45, 0.5, 0.02, 0.3, 'trim'),
    box(0.3, -0.2, 3.95, 0.3, 0.3, 0.5, 'wall'),
    cyl(-0.3, -0.2, 3.95, 0.02, 0.02, 1.5, 'dark'),
  ]),
  // Low school wing with a taller central entrance, clock, canopy and a flagpole.
  blueprint('school_hall', 'single-storey school wing with a taller gabled entrance, clock, canopy and flagpole', 0, [
    box(0, 0, 0, 0.95, 0.7, 3.2, 'wall'),
    box(0, 0.2, 0, 0.4, 0.5, 4.6, 'wall2'),
    box(0, 0, 3.2, 1, 0.76, 0.15, 'roof'),
    gable(0, 0.2, 4.6, 0.56, 0.46, 0.9, 'roof', { rot: 90 }),
    door(0, 0.45, 0.2, 2.4),
    box(0, 0.5, 2.7, 0.4, 0.2, 0.08, 'accent'),
    windows(-0.28, 1.1, 3, 0.14, 0.35, 0.1, 1.2),
    windows(0.28, 1.1, 3, 0.14, 0.35, 0.1, 1.2),
    box(0, 0.455, 3.6, 0.16, 0.02, 0.16, 'trim'),
    cyl(0.42, 0.4, 0, 0.015, 0.015, 5.5, 'dark'),
    box(0.46, 0.4, 4.6, 0.08, 0.01, 0.5, 'accent'),
    box(0, 0.5, 0, 0.5, 0.12, 0.15, 'wall2'),
    box(0.38, -0.2, 3.35, 0.1, 0.1, 1.4, 'wall2'),
  ]),
];

// Props are authored at unit scale (longest dimension 1) and scaled up to `size` metres.
export const modernProps: PropBlueprint[] = [
  propOf('park_bench', 1.7, 3, [
    box(0, 0, 0, 0.04, 0.3, 0.4, 'dark', { repeat: 2, gap: 0.8 }),
    box(0, 0, 0.4, 1, 0.34, 0.06, 'trim'),
    box(0, -0.14, 0.46, 1, 0.04, 0.3, 'trim'),
  ]),
  propOf('street_lamp', 4.5, 3, [
    cyl(0, 0, 0, 0.05, 0.05, 0.9, 'dark'),
    box(0.08, 0, 0.9, 0.25, 0.06, 0.04, 'dark'),
    sphere(0.18, 0, 0.88, 0.1, 0.1, 0.08, 'glow'),
  ]),
  propOf('recycling_bin', 1, 2, [
    cyl(-0.25, 0, 0, 0.4, 0.4, 0.8, 'wall2'),
    cyl(0.25, 0, 0, 0.4, 0.4, 0.8, 'accent'),
    cyl(-0.25, 0, 0.8, 0.44, 0.44, 0.08, 'dark'),
    cyl(0.25, 0, 0.8, 0.44, 0.44, 0.08, 'dark'),
  ]),
  propOf('lobster_crates', 1.2, 2, [
    box(-0.2, 0, 0, 0.5, 0.4, 0.3, 'accent'),
    box(0.3, 0.05, 0, 0.4, 0.4, 0.3, 'wall2'),
    box(0, 0, 0.3, 0.5, 0.4, 0.3, 'wall2', { rot: 10 }),
    box(0.05, 0, 0.6, 0.4, 0.35, 0.3, 'accent'),
  ]),
  propOf('harbour_buoy', 1.4, 1, [
    cyl(0, 0, 0, 0.4, 0.4, 0.5, 'accent'),
    cone(0, 0, 0.5, 0.4, 0.4, 0.3, 'trim'),
    cyl(0, 0, 0.8, 0.04, 0.04, 0.2, 'dark'),
  ]),
];

export const modernLandmarks: LandmarkSpec[] = [
  {
    id: 'lighthouse',
    prompt: 'a tall white lighthouse tower with a red lantern room, a railed gallery and a small keeper cottage at its base, low-poly, single object',
    place: 'plaza',
    height: 13,
  },
];
