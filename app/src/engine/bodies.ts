// Everything that lives is drawn and moved from a body plan (world/bodies.ts): a joint tree with dials.
// This module is the engine side: plan -> skinned mesh -> procedural motion, and people as dressed bipeds.
export { createBody } from './bodies/animate';
export type { BodyGesture, BodyMode, BodyOptions, BodyRig } from './bodies/animate';
export { createFigure, figurePlan, planFigure } from './bodies/figure';
export type { FigureOptions, FigureRig } from './bodies/figure';
export { bodyMaterial, buildBodyGeometry, disposeBodyCache, glowMaterial, groundedColor, patternPixels, patternSample } from './bodies/geometry';
export type { BodyColors, BodyGeometry } from './bodies/geometry';
