/**
 * Seeded randomness.
 *
 * Everything random in a hand (the shuffle, and later the bots' frequency
 * mixing) draws from one seeded stream, so a hand can be replayed exactly.
 * The generator itself is the mulberry32 already used by the equity engine.
 */

export { makeRng } from '../engine/equity';

export type Rng = () => number;

/** Uniform integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Pick one element. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randInt(rng, items.length)];
}

/** Fisher–Yates, in place. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const t = items[i];
    items[i] = items[j];
    items[j] = t;
  }
  return items;
}

/** Pick `count` distinct elements without mutating the source. */
export function sample<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = items.slice();
  shuffle(rng, pool);
  return pool.slice(0, count);
}
