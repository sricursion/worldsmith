// Seeded randomness shared by every module. Math.random is banned in app/src.

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  /** In-place Fisher–Yates; returns the same array. */
  shuffle<T>(xs: T[]): T[];
  /** True with probability p. */
  chance(p: number): boolean;
}

/** 32-bit FNV-1a over a string; used to fold a seed and a salt into one state word. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable seed for a prompt string, so the same words rebuild the same town. */
export function seedFromPrompt(prompt: string): number {
  return hash32(prompt.trim().toLowerCase().replace(/\s+/g, ' '));
}

export function makeRng(seed: number, salt = ''): Rng {
  let a = (hash32(`${seed >>> 0}|${salt}`) ^ 0x9e3779b9) >>> 0;
  const next = (): number => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (xs) => {
      if (xs.length === 0) throw new Error('pick from empty array');
      return xs[Math.floor(next() * xs.length)] as (typeof xs)[number];
    },
    shuffle: (xs) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = xs[i] as (typeof xs)[number];
        xs[i] = xs[j] as (typeof xs)[number];
        xs[j] = t;
      }
      return xs;
    },
    chance: (p) => next() < p,
  };
  return rng;
}
