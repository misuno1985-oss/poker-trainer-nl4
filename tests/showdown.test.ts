import { describe, expect, it } from 'vitest';
import { act } from '../src/game/hand';
import { settle } from '../src/game/showdown';
import type { HandState, Player } from '../src/game/types';
import { cards, chipsConserved, setup } from './helpers';

/** A finished-betting state built by hand, for testing the award logic alone. */
function bareState(spec: {
  button: number;
  board: string;
  seats: { seat: number; hole: string; commit: number; stack?: number; folded?: boolean }[];
}): HandState {
  const players: Player[] = spec.seats.map((s) => {
    const hole = cards(s.hole);
    return {
      seat: s.seat,
      name: `P${s.seat}`,
      stack: s.stack ?? 0,
      startingStack: (s.stack ?? 0) + s.commit,
      cards: [hole[0], hole[1]],
      position: 'BTN',
      folded: s.folded ?? false,
      allIn: (s.stack ?? 0) === 0,
      streetCommit: 0,
      handCommit: s.commit,
      hasActed: true,
      mayRaise: false,
      won: 0,
    };
  });
  return {
    players,
    button: spec.button,
    smallBlind: 2,
    bigBlind: 4,
    street: 'river',
    board: cards(spec.board),
    deck: [],
    deckPos: 0,
    currentBet: 0,
    lastRaiseSize: 4,
    toAct: -1,
    log: [],
    finished: false,
    result: null,
  };
}

describe('deciding the winner', () => {
  it('gives the pot to the better made hand', () => {
    const s = bareState({
      button: 0,
      board: '2h7s8dTcKc',
      seats: [
        { seat: 0, hole: 'KsKd', commit: 100 }, // trip kings
        { seat: 1, hole: 'TsTd', commit: 100 }, // trip tens
      ],
    });
    const r = settle(s);
    expect(r.awards).toHaveLength(1);
    expect(r.awards[0].winners).toEqual([0]);
    expect(r.net[0]).toBe(100);
    expect(r.net[1]).toBe(-100);
  });

  it('splits when both players play the same board', () => {
    const s = bareState({
      button: 0,
      board: 'AcAdAhAsKc',
      seats: [
        { seat: 0, hole: '2c3d', commit: 50 },
        { seat: 1, hole: '4h5s', commit: 50 },
      ],
    });
    const r = settle(s);
    expect(r.awards[0].winners).toEqual([0, 1]);
    expect(r.net[0]).toBe(0);
    expect(r.net[1]).toBe(0);
  });
});

describe('odd cents', () => {
  it('goes to the winner closest to the left of the button', () => {
    // 15 cents, two winners: 7 each and one cent left over. The button is on
    // seat 2, so seat 0 is first to its left and takes the extra cent.
    const s = bareState({
      button: 2,
      board: 'AcAdAhAsKc',
      seats: [
        { seat: 0, hole: '2c3d', commit: 5 },
        { seat: 1, hole: '4h5s', commit: 5 },
        { seat: 2, hole: '7c8d', commit: 5, folded: true },
      ],
    });
    const r = settle(s);
    const award = r.awards[0];
    expect(award.pot.amount).toBe(15);
    expect(award.winners).toEqual([0, 1]);
    expect(award.perWinner).toBe(7);
    expect(award.oddChipTo).toBe(0);
    expect(r.net[0]).toBe(3); // 5 in, 8 back
    expect(r.net[1]).toBe(2); // 5 in, 7 back
    expect(r.net[2]).toBe(-5);
  });

  it('never creates or destroys a cent when splitting', () => {
    const s = bareState({
      button: 1,
      board: 'AcAdAhAsKc',
      seats: [
        { seat: 0, hole: '2c3d', commit: 7 },
        { seat: 1, hole: '4h5s', commit: 7 },
        { seat: 2, hole: '9c9d', commit: 7 },
      ],
    });
    settle(s);
    expect(s.players.reduce((t, p) => t + p.stack, 0)).toBe(21);
  });
});

describe('side pots at showdown', () => {
  it('lets the short stack win the main pot while another takes the side', () => {
    // UTG is all-in for 40 with trip kings, HJ and CO play on to 200.
    // HJ has trip tens, CO has a pair of nines.
    let s = setup({
      count: 6,
      button: 0,
      // HJ and CO hold exactly 200, so calling 200 puts them all-in too and
      // the board runs out with no further betting.
      stacks: [400, 400, 400, 40, 200, 200],
      holes: { 0: '3c3d', 1: '4c4d', 2: '5c5d', 3: 'KsKd', 4: 'TsTd', 5: '9c9d' },
      board: '2h7s8dTcKc',
    });
    s = act(s, { kind: 'raise', total: 40 }); // UTG all-in
    s = act(s, { kind: 'raise', total: 200 }); // HJ all-in
    s = act(s, { kind: 'call' }); // CO all-in
    s = act(s, { kind: 'fold' }); // BTN
    s = act(s, { kind: 'fold' }); // SB
    s = act(s, { kind: 'fold' }); // BB

    expect(s.finished).toBe(true);
    const r = s.result!;
    expect(r.awards).toHaveLength(2);

    const main = r.awards[0];
    expect(main.pot.eligible).toEqual([3, 4, 5]);
    expect(main.pot.amount).toBe(2 + 4 + 40 * 3); // dead blinds + three at 40
    expect(main.winners).toEqual([3]);

    const side = r.awards[1];
    expect(side.pot.eligible).toEqual([4, 5]);
    expect(side.pot.amount).toBe((200 - 40) * 2);
    expect(side.winners).toEqual([4]);

    expect(r.net[3]).toBe(126 - 40);
    expect(r.net[4]).toBe(320 - 200);
    expect(r.net[5]).toBe(-200);
    expect(chipsConserved(s)).toBe(true);
    expect(Object.values(r.net).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('returns the uncalled part when nobody can match a shove', () => {
    let s = setup({
      count: 6,
      button: 0,
      stacks: [400, 400, 400, 400, 60, 400],
      holes: { 0: '3c3d', 1: '4c4d', 2: '5c5d', 3: 'KsKd', 4: 'TsTd', 5: '9c9d' },
      board: '2h7s8dTcKc',
    });
    s = act(s, { kind: 'raise', total: 300 }); // UTG shoves big
    s = act(s, { kind: 'call' }); // HJ can only cover 60
    s = act(s, { kind: 'fold' }); // CO
    s = act(s, { kind: 'fold' }); // BTN
    s = act(s, { kind: 'fold' }); // SB
    s = act(s, { kind: 'fold' }); // BB

    const r = s.result!;
    // UTG risked 60 of the 300; the other 240 was never contested.
    expect(r.net[3]).toBe(60 + 2 + 4);
    expect(r.net[4]).toBe(-60);
    expect(chipsConserved(s)).toBe(true);
  });
});
