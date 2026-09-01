/**
 * The hand state machine: deal, post blinds, run the streets, settle.
 *
 * `act()` is the only entry point a caller needs. It applies one action and
 * then pushes the hand forward as far as it can go on its own — dealing the
 * next street, running the board out when everybody is all-in, or settling.
 * It stops as soon as a human or bot decision is required again.
 */

import { FULL_DECK, type Card } from '../engine/cards';
import { applyAction, nextToAct, postBlind, roundComplete, type ActionRequest } from './betting';
import {
  assignPositions,
  bigBlindSeat,
  firstToActPreflop,
  smallBlindSeat,
} from './positions';
import { shuffle, makeRng } from './rng';
import { settle } from './showdown';
import { contenders, type HandState, type Player, type Street } from './types';

export interface SeatConfig {
  name: string;
  /** Starting stack in cents. */
  stack: number;
}

export interface HandConfig {
  seats: SeatConfig[];
  button: number;
  smallBlind: number;
  bigBlind: number;
  seed: number;
  /** Optional fixed deck, for tests and for replaying a real hand. */
  deck?: Card[];
}

export function createHand(config: HandConfig): HandState {
  const count = config.seats.length;
  if (count < 2 || count > 6) throw new Error('need 2..6 players');

  const deck = config.deck ? config.deck.slice() : shuffle(makeRng(config.seed), FULL_DECK.slice());
  const positions = assignPositions(count, config.button);

  const players: Player[] = config.seats.map((seat, i) => ({
    seat: i,
    name: seat.name,
    stack: seat.stack,
    startingStack: seat.stack,
    cards: [-1, -1] as [Card, Card],
    position: positions[i],
    folded: false,
    allIn: false,
    streetCommit: 0,
    handCommit: 0,
    hasActed: false,
    mayRaise: true,
    won: 0,
  }));

  const state: HandState = {
    players,
    button: config.button,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    street: 'preflop',
    board: [],
    deck,
    deckPos: 0,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    toAct: -1,
    log: [],
    finished: false,
    result: null,
  };

  // Deal two cards each, one at a time, starting left of the button.
  const sb = smallBlindSeat(count, config.button);
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < count; i++) {
      const seat = (sb + i) % count;
      players[seat].cards[round] = state.deck[state.deckPos++];
    }
  }

  postBlind(state, sb, config.smallBlind);
  postBlind(state, bigBlindSeat(count, config.button), config.bigBlind);
  // Blinds are forced, so posting them is not "acting": the big blind still has
  // the option to raise when the action comes back around.
  for (const p of players) p.hasActed = false;

  state.toAct = firstToActPreflop(count, config.button);
  if (players[state.toAct].folded || players[state.toAct].allIn) {
    state.toAct = nextToAct(state, state.toAct);
  }

  autoAdvance(state);
  return state;
}

/** Apply one action and run the hand forward until input is needed again. */
export function act(state: HandState, req: ActionRequest): HandState {
  applyAction(state, req);
  autoAdvance(state);
  return state;
}

const NEXT_STREET: Record<Street, Street> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: 'showdown',
  showdown: 'showdown',
};

const CARDS_FOR: Record<Street, number> = {
  preflop: 0,
  flop: 3,
  turn: 1,
  river: 1,
  showdown: 0,
};

function dealStreet(state: HandState, street: Street) {
  const n = CARDS_FOR[street];
  for (let i = 0; i < n; i++) state.board.push(state.deck[state.deckPos++]);
}

function openStreet(state: HandState, street: Street) {
  state.street = street;
  dealStreet(state, street);
  for (const p of state.players) {
    p.streetCommit = 0;
    p.hasActed = false;
    p.mayRaise = true;
  }
  state.currentBet = 0;
  state.lastRaiseSize = state.bigBlind;
  // Post-flop action starts left of the button.
  state.toAct = nextToAct(state, state.button);
}

/** Deal every remaining board card without any betting (everyone is all-in). */
function runOutBoard(state: HandState) {
  let street = state.street;
  while (street !== 'river') {
    street = NEXT_STREET[street];
    if (street === 'showdown') break;
    state.street = street;
    dealStreet(state, street);
  }
}

export function autoAdvance(state: HandState) {
  for (;;) {
    if (state.finished) return;

    const alive = state.players.filter((p) => !p.folded);
    if (alive.length <= 1) {
      settle(state);
      return;
    }

    if (!roundComplete(state)) {
      if (state.toAct < 0) state.toAct = nextToAct(state, state.button);
      if (state.toAct < 0) {
        // Nobody can act but the round is not complete: nothing left to bet.
        runOutBoard(state);
        settle(state);
      }
      return;
    }

    if (state.street === 'river') {
      settle(state);
      return;
    }

    // No one left with chips to bet: run the board out and show down.
    if (contenders(state).length <= 1) {
      runOutBoard(state);
      settle(state);
      return;
    }

    openStreet(state, NEXT_STREET[state.street]);

    if (state.toAct < 0) {
      // Everyone remaining is all-in.
      runOutBoard(state);
      settle(state);
      return;
    }
  }
}
