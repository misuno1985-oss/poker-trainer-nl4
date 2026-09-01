/**
 * Settling a finished hand: return the uncalled bet, slice the pots, compare
 * hands, hand out chips (odd cents included).
 *
 * Works the same way whether the hand ended on a fold or at showdown — a fold
 * is just a pot with a single eligible player, so there is only one code path
 * and one place for a bug to hide.
 */

import { evaluate } from '../engine/evaluator';
import type { Card } from '../engine/cards';
import { buildPots, returnUncalled } from './pots';
import { oddChipOrder } from './positions';
import type { HandResult, HandState, PotAward } from './types';

/** Best 5-card value for a player, bigger is better. */
export function handValue(hole: [Card, Card], board: Card[]): number {
  const cards: Card[] = [hole[0], hole[1], ...board];
  return evaluate(cards);
}

export function settle(state: HandState): HandResult {
  const uncalled = returnUncalled(state.players);
  const pots = buildPots(state.players);
  const order = oddChipOrder(state.players.length, state.button);

  const alive = state.players.filter((p) => !p.folded);
  const contested = alive.length > 1;

  const awards: PotAward[] = [];

  for (const pot of pots) {
    const eligible = pot.eligible
      .map((seat) => state.players.find((p) => p.seat === seat)!)
      .filter((p) => !p.folded);

    if (eligible.length === 0) continue;

    let winners: number[];
    let value: number | null = null;

    if (eligible.length === 1) {
      winners = [eligible[0].seat];
    } else {
      let best = -1;
      for (const p of eligible) {
        const v = handValue(p.cards, state.board);
        if (v > best) best = v;
      }
      value = best;
      winners = eligible.filter((p) => handValue(p.cards, state.board) === best).map((p) => p.seat);
    }

    const perWinner = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - perWinner * winners.length;

    let oddChipTo: number | null = null;
    for (const seat of winners) {
      const p = state.players.find((x) => x.seat === seat)!;
      p.stack += perWinner;
      p.won += perWinner;
    }
    // Odd cents go to whoever sits closest to the left of the button.
    for (const seat of order) {
      if (remainder <= 0) break;
      if (!winners.includes(seat)) continue;
      const p = state.players.find((x) => x.seat === seat)!;
      p.stack += 1;
      p.won += 1;
      if (oddChipTo === null) oddChipTo = seat;
      remainder -= 1;
    }

    awards.push({ pot, winners, perWinner, oddChipTo, handValue: value });
  }

  const net: Record<number, number> = {};
  for (const p of state.players) net[p.seat] = p.stack - p.startingStack;

  const result: HandResult = {
    awards,
    net,
    showdownSeats: contested ? alive.map((p) => p.seat) : [],
  };

  state.result = result;
  state.finished = true;
  state.street = 'showdown';
  state.toAct = -1;
  void uncalled;
  return result;
}
