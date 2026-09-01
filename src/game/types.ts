/**
 * Core types for a single NLHE cash hand.
 *
 * All money is in **integer cents**. Never use floats for chips: at NL4 the
 * blinds are 2 and 4 cents and float rounding would silently corrupt pots.
 *
 * The engine is pure TypeScript: no React, no globals, no Math.random.
 * Randomness enters only through a seeded deck, which makes every hand
 * reproducible (this is what gives us REPLAY HAND for free).
 */

import type { Card } from '../engine/cards';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

export type ActionKind =
  | 'post'   // blind
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'    // first voluntary chips on a street
  | 'raise'; // chips on top of someone else's bet

export interface Action {
  seat: number;
  street: Street;
  kind: ActionKind;
  /** Chips moved from stack to pot by this action. */
  amount: number;
  /** The player's total commitment on this street after the action. */
  total: number;
  /** True when this action put the player all-in. */
  allIn: boolean;
}

export interface Player {
  seat: number;
  name: string;
  /** Chips still behind. */
  stack: number;
  /** Stack at the start of the hand — needed for P&L and for stack-to-pot maths. */
  startingStack: number;
  cards: [Card, Card];
  position: Position;
  folded: boolean;
  allIn: boolean;
  /** Chips committed on the current street. */
  streetCommit: number;
  /** Chips committed across the whole hand. */
  handCommit: number;
  /** Has acted since the last full raise (blinds do not count as acting). */
  hasActed: boolean;
  /**
   * May this player still raise? Turned off after they act, turned back on by
   * a *full* raise. An all-in raise that is smaller than a full raise does not
   * reopen the betting for players who already acted — this flag encodes that.
   */
  mayRaise: boolean;
  /** Chips returned as an uncalled bet, plus chips won at showdown. */
  won: number;
}

export interface Pot {
  amount: number;
  /** Seats eligible to win this pot (still in the hand at its contribution level). */
  eligible: number[];
}

export interface PotAward {
  pot: Pot;
  winners: number[];
  perWinner: number;
  /** Odd cents handed to the winner closest to the left of the button. */
  oddChipTo: number | null;
  /** Evaluator value of the winning hand, or null when everybody else folded. */
  handValue: number | null;
}

export interface HandResult {
  awards: PotAward[];
  /** seat -> net cents for this hand (negative = lost). */
  net: Record<number, number>;
  /** Seats that reached showdown with cards turned up. */
  showdownSeats: number[];
}

export interface HandState {
  players: Player[];
  /** Physical seat holding the button. */
  button: number;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  board: Card[];
  /** Undealt cards, consumed from the front. */
  deck: Card[];
  deckPos: number;
  /** Highest streetCommit on the current street. */
  currentBet: number;
  /** Size of the last full raise increment; the minimum legal raise on top. */
  lastRaiseSize: number;
  /** Seat to act, or -1 when no one can act. */
  toAct: number;
  log: Action[];
  finished: boolean;
  result: HandResult | null;
}

export interface LegalActions {
  seat: number;
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Amount actually moved by a call (capped by the stack). */
  callAmount: number;
  canBet: boolean;
  minBetTotal: number;
  canRaise: boolean;
  /** Smallest legal raise-to total; equals allInTotal when only a short all-in is left. */
  minRaiseTotal: number;
  /** Largest raise-to total — the player's whole stack. */
  maxRaiseTotal: number;
  /** Total that puts this player all-in. */
  allInTotal: number;
}

/** Total chips in the middle, including the current street. */
export function totalPot(state: HandState): number {
  let sum = 0;
  for (const p of state.players) sum += p.handCommit;
  return sum;
}

export function activePlayers(state: HandState): Player[] {
  return state.players.filter((p) => !p.folded);
}

/** Players who can still put chips in (not folded, not all-in). */
export function contenders(state: HandState): Player[] {
  return state.players.filter((p) => !p.folded && !p.allIn);
}
