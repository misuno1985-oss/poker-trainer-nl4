/**
 * Seat ↔ position mapping.
 *
 * Seats are numbered clockwise 0..n-1 and never move. The button moves, so a
 * seat's *position* changes every hand — which is exactly what we want to
 * train: hero sits at the bottom of the screen always, but plays UTG one hand
 * and BTN the next.
 */

import type { Position } from './types';

/** Positions by offset from the button, clockwise. Index 0 is the button. */
const BY_COUNT: Record<number, Position[]> = {
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  3: ['BTN', 'SB', 'BB'],
  2: ['BTN', 'BB'], // heads-up: the button posts the small blind
};

/** Position of each seat, indexed by seat number. */
export function assignPositions(playerCount: number, button: number): Position[] {
  const names = BY_COUNT[playerCount];
  if (!names) throw new Error(`unsupported player count: ${playerCount}`);
  const out = new Array<Position>(playerCount);
  for (let offset = 0; offset < playerCount; offset++) {
    out[(button + offset) % playerCount] = names[offset];
  }
  return out;
}

/** Seat that posts the small blind. Heads-up, that is the button. */
export function smallBlindSeat(playerCount: number, button: number): number {
  return playerCount === 2 ? button : (button + 1) % playerCount;
}

export function bigBlindSeat(playerCount: number, button: number): number {
  return playerCount === 2 ? (button + 1) % 2 : (button + 2) % playerCount;
}

/** First seat to act before the flop: left of the big blind. */
export function firstToActPreflop(playerCount: number, button: number): number {
  return (bigBlindSeat(playerCount, button) + 1) % playerCount;
}

/** First seat to act after the flop: left of the button. */
export function firstToActPostflop(playerCount: number, button: number): number {
  return (button + 1) % playerCount;
}

/**
 * Seats ordered by how close they sit to the left of the button — the order
 * used to hand out odd cents when a pot is split.
 */
export function oddChipOrder(playerCount: number, button: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= playerCount; i++) out.push((button + i) % playerCount);
  return out;
}

/** How "late" a position is: 0 = earliest. Useful for bot range widths. */
export const POSITION_RANK: Record<Position, number> = {
  UTG: 0,
  HJ: 1,
  CO: 2,
  BTN: 3,
  SB: 4,
  BB: 5,
};
