import { FULL_DECK, parseCard, parseCards, type Card } from '../src/engine/cards';
import { smallBlindSeat } from '../src/game/positions';
import { createHand, type HandConfig } from '../src/game/hand';
import type { HandState } from '../src/game/types';

export function card(text: string): Card {
  const c = parseCard(text);
  if (c < 0) throw new Error(`bad card: ${text}`);
  return c;
}

export function cards(text: string): Card[] {
  return parseCards(text);
}

export interface DeckSpec {
  count: number;
  button: number;
  /** seat -> "AhKd" */
  holes: Record<number, string>;
  /** "2c7d9s" | "2c7d9sTh" | "2c7d9sTh3c" */
  board?: string;
}

/**
 * Build a deck that deals exactly the requested cards.
 *
 * Deal order mirrors the engine: one card to each seat starting left of the
 * button, then a second round, then the board.
 */
export function makeDeck(spec: DeckSpec): Card[] {
  const { count, button } = spec;
  const sb = smallBlindSeat(count, button);
  const deck: Card[] = new Array(52).fill(-1);
  const used = new Set<Card>();

  const place = (index: number, c: Card) => {
    if (used.has(c)) throw new Error(`card used twice: ${c}`);
    used.add(c);
    deck[index] = c;
  };

  for (const [seatText, text] of Object.entries(spec.holes)) {
    const seat = Number(seatText);
    const hole = cards(text);
    if (hole.length !== 2) throw new Error(`seat ${seat} needs two cards`);
    const offset = (seat - sb + count) % count;
    place(offset, hole[0]);
    place(count + offset, hole[1]);
  }

  if (spec.board) {
    const board = cards(spec.board);
    board.forEach((c, i) => place(2 * count + i, c));
  }

  // Fill the gaps with whatever is left, in order.
  const spare = FULL_DECK.filter((c) => !used.has(c));
  let s = 0;
  for (let i = 0; i < deck.length; i++) if (deck[i] < 0) deck[i] = spare[s++];
  return deck;
}

export interface SetupSpec extends DeckSpec {
  stacks: number[];
  smallBlind?: number;
  bigBlind?: number;
}

export function setup(spec: SetupSpec): HandState {
  const config: HandConfig = {
    seats: spec.stacks.map((stack, i) => ({ name: `P${i}`, stack })),
    button: spec.button,
    smallBlind: spec.smallBlind ?? 2,
    bigBlind: spec.bigBlind ?? 4,
    seed: 1,
    deck: makeDeck(spec),
  };
  return createHand(config);
}

/**
 * Chips must never appear or vanish.
 *
 * Mid-hand the chips are split between stacks and the middle. Once the hand is
 * settled every cent has been pushed back to a stack, and `handCommit` is left
 * as a record of what each player put in — counting it again would double up.
 */
export function chipsConserved(state: HandState): boolean {
  const start = state.players.reduce((s, p) => s + p.startingStack, 0);
  const now = state.finished
    ? state.players.reduce((s, p) => s + p.stack, 0)
    : state.players.reduce((s, p) => s + p.stack + p.handCommit, 0);
  return start === now;
}
