/**
 * Pot construction: uncalled-bet return, then main pot and side pots.
 *
 * This is the part of a poker engine that quietly goes wrong, so it lives on
 * its own and is tested directly. Two separate steps, in this order:
 *
 *  1. Return the uncalled part of the last bet. If one player put in more than
 *     anybody else could match, the excess was never contested and goes back.
 *  2. Slice what is left into pots at every distinct commitment level. A player
 *     is eligible for a pot only if they reached that level and did not fold.
 *
 * Folded players' chips stay in the pot but win nothing — that is why
 * eligibility is checked separately from contribution.
 */

import type { Player, Pot } from './types';

export interface UncalledReturn {
  seat: number;
  amount: number;
}

/**
 * Find the uncalled excess of the largest commitment.
 *
 * Compared against the largest commitment of *any other* player, folded ones
 * included: a player who folded after calling 50 has still matched 50 of it.
 * Returns null when the top two commitments are level (nothing uncalled).
 */
export function findUncalled(players: Player[]): UncalledReturn | null {
  let top = -1;
  let topSeat = -1;
  let second = 0;
  for (const p of players) {
    if (p.handCommit > top) {
      second = top < 0 ? 0 : top;
      top = p.handCommit;
      topSeat = p.seat;
    } else if (p.handCommit > second) {
      second = p.handCommit;
    }
  }
  if (topSeat < 0 || top <= second) return null;
  return { seat: topSeat, amount: top - second };
}

/**
 * Give the uncalled part back. Mutates the player: the chips return to the
 * stack and stop counting as committed, so the pot maths below never sees them.
 */
export function returnUncalled(players: Player[]): UncalledReturn | null {
  const found = findUncalled(players);
  if (!found) return null;
  const p = players.find((x) => x.seat === found.seat)!;
  p.handCommit -= found.amount;
  p.streetCommit = Math.max(0, p.streetCommit - found.amount);
  p.stack += found.amount;
  p.won += found.amount;
  if (p.stack > 0) p.allIn = false;
  return found;
}

/**
 * Slice commitments into main pot + side pots.
 *
 * Call *after* returnUncalled. Adjacent slices with the same eligible set are
 * merged, so an ordinary hand with no all-in yields exactly one pot.
 */
export function buildPots(players: Player[]): Pot[] {
  const levels = Array.from(new Set(players.map((p) => p.handCommit).filter((v) => v > 0))).sort(
    (a, b) => a - b,
  );

  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    let amount = 0;
    for (const p of players) {
      const capped = Math.min(p.handCommit, level);
      const below = Math.min(p.handCommit, previous);
      amount += capped - below;
    }
    if (amount > 0) {
      const eligible = players
        .filter((p) => !p.folded && p.handCommit >= level)
        .map((p) => p.seat)
        .sort((a, b) => a - b);
      const last = pots[pots.length - 1];
      if (last && sameSeats(last.eligible, eligible)) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligible });
      }
    }
    previous = level;
  }

  return pots;
}

function sameSeats(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
