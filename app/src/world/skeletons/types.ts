// Shared types for skeletons. Re-exported from ../skeletons.
import type { BlueprintPart } from '../spec';
import type { Rng } from '../rng';

export type Dials = Record<string, number | string>;

export interface DialSpec {
  name: string;
  kind: 'number' | 'choice';
  min?: number;
  max?: number;
  choices?: string[];
  default: number | string;
  meaning: string;
}

export interface Skeleton {
  id: string;
  group: 'structure' | 'nature' | 'object';
  summary: string;
  /** Unrelated things this form becomes in different worlds. */
  becomes: string[];
  dials: DialSpec[];
  /** Receives fully resolved dials (every dial present, clamped). Must return at most 28 parts. */
  build(d: Dials, rng: Rng): BlueprintPart[];
}
