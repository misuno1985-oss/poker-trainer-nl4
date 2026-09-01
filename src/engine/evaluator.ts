/**
 * 5-, 6- and 7-card hand evaluator.
 *
 * evaluate() returns a single integer where a bigger number is a better hand:
 *   value = category * 2^20 + r1 * 2^16 + r2 * 2^12 + r3 * 2^8 + r4 * 2^4 + r5
 * with r1..r5 the significant ranks in descending importance (0 = deuce, 12 = ace).
 * Two hands are equal (a chop) exactly when their values are equal.
 */

import type { Card } from './cards';

export const HAND_CATEGORIES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

export const CAT_HIGH_CARD = 0;
export const CAT_PAIR = 1;
export const CAT_TWO_PAIR = 2;
export const CAT_TRIPS = 3;
export const CAT_STRAIGHT = 4;
export const CAT_FLUSH = 5;
export const CAT_FULL_HOUSE = 6;
export const CAT_QUADS = 7;
export const CAT_STRAIGHT_FLUSH = 8;

export function categoryOf(value: number): number {
  return value >>> 20;
}

export function categoryName(value: number): string {
  return HAND_CATEGORIES[categoryOf(value)];
}

function mk(cat: number, r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0): number {
  return (cat << 20) | (r1 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4) | r5;
}

/**
 * Highest straight contained in a 13-bit rank mask (bit 0 = deuce, bit 12 = ace).
 * Returns the rank index of the straight's high card, or -1.
 * A-2-3-4-5 (the wheel) is handled by giving the ace a low position.
 */
export function straightHigh(rankMask: number): number {
  // 14-bit mask: bit 0 = low ace, bit i = rank (i - 1)
  const m = ((rankMask << 1) | ((rankMask >>> 12) & 1)) & 0x3fff;
  for (let top = 13; top >= 4; top--) {
    const window = 0x1f << (top - 4);
    if ((m & window) === window) return top - 1;
  }
  return -1;
}

/** Top `n` set bits of a 13-bit rank mask, high to low. */
function topRanks(mask: number, n: number, out: number[]): number {
  let count = 0;
  for (let r = 12; r >= 0 && count < n; r--) {
    if ((mask >>> r) & 1) out[count++] = r;
  }
  return count;
}

const scratch: number[] = [0, 0, 0, 0, 0];

/** Evaluate any 5..7 cards. */
export function evaluate(cards: Card[] | Int8Array | Uint8Array): number {
  const n = cards.length;
  let rankMask = 0;
  const rankCount = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const suitCount = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];

  for (let i = 0; i < n; i++) {
    const c = cards[i] as number;
    const r = c >> 2;
    const s = c & 3;
    rankMask |= 1 << r;
    rankCount[r]++;
    suitCount[s]++;
    suitMask[s] |= 1 << r;
  }

  // Flush / straight flush
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      flushSuit = s;
      break;
    }
  }
  if (flushSuit >= 0) {
    const fMask = suitMask[flushSuit];
    const sfHigh = straightHigh(fMask);
    if (sfHigh >= 0) return mk(CAT_STRAIGHT_FLUSH, sfHigh);
  }

  // Rank groupings
  let quad = -1;
  let trip1 = -1;
  let trip2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = rankCount[r];
    if (c === 4) {
      if (quad < 0) quad = r;
    } else if (c === 3) {
      if (trip1 < 0) trip1 = r;
      else if (trip2 < 0) trip2 = r;
    } else if (c === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  if (quad >= 0) {
    let kicker = -1;
    for (let r = 12; r >= 0; r--) {
      if (r !== quad && rankCount[r] > 0) {
        kicker = r;
        break;
      }
    }
    return mk(CAT_QUADS, quad, kicker);
  }

  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const pairPart = trip2 >= 0 && (pair1 < 0 || trip2 > pair1) ? trip2 : pair1;
    return mk(CAT_FULL_HOUSE, trip1, pairPart);
  }

  if (flushSuit >= 0) {
    topRanks(suitMask[flushSuit], 5, scratch);
    return mk(CAT_FLUSH, scratch[0], scratch[1], scratch[2], scratch[3], scratch[4]);
  }

  const sHigh = straightHigh(rankMask);
  if (sHigh >= 0) return mk(CAT_STRAIGHT, sHigh);

  if (trip1 >= 0) {
    let k = 0;
    const kick = [0, 0];
    for (let r = 12; r >= 0 && k < 2; r--) {
      if (r !== trip1 && rankCount[r] > 0) kick[k++] = r;
    }
    return mk(CAT_TRIPS, trip1, kick[0], kick[1]);
  }

  if (pair1 >= 0 && pair2 >= 0) {
    let kicker = -1;
    for (let r = 12; r >= 0; r--) {
      if (r !== pair1 && r !== pair2 && rankCount[r] > 0) {
        kicker = r;
        break;
      }
    }
    return mk(CAT_TWO_PAIR, pair1, pair2, kicker);
  }

  if (pair1 >= 0) {
    let k = 0;
    const kick = [0, 0, 0];
    for (let r = 12; r >= 0 && k < 3; r--) {
      if (r !== pair1 && rankCount[r] > 0) kick[k++] = r;
    }
    return mk(CAT_PAIR, pair1, kick[0], kick[1], kick[2]);
  }

  topRanks(rankMask, 5, scratch);
  return mk(CAT_HIGH_CARD, scratch[0], scratch[1], scratch[2], scratch[3], scratch[4]);
}

/** Convenience wrapper used by the equity engines' hot loop. */
const seven = new Uint8Array(7);
export function evaluate7(
  a: number, b: number, c: number, d: number, e: number, f: number, g: number,
): number {
  seven[0] = a; seven[1] = b; seven[2] = c; seven[3] = d;
  seven[4] = e; seven[5] = f; seven[6] = g;
  return evaluate(seven);
}
