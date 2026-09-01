import { describe, expect, it } from 'vitest';
import { buildPots, findUncalled, returnUncalled } from '../src/game/pots';
import type { Player } from '../src/game/types';

function P(seat: number, handCommit: number, folded = false): Player {
  return {
    seat,
    name: `P${seat}`,
    stack: 0,
    startingStack: handCommit,
    cards: [-1, -1],
    position: 'BTN',
    folded,
    allIn: false,
    streetCommit: handCommit,
    handCommit,
    hasActed: true,
    mayRaise: false,
    won: 0,
  };
}

describe('uncalled bet', () => {
  it('returns the excess of the largest commitment', () => {
    // The exact shape of the very first hand in the real 1win base:
    // 495 in from one player, 191 and 161 from the others -> 304 comes back.
    const players = [P(0, 495), P(1, 161), P(2, 191)];
    expect(findUncalled(players)).toEqual({ seat: 0, amount: 304 });
  });

  it('returns nothing when the top two are level', () => {
    expect(findUncalled([P(0, 100), P(1, 100), P(2, 40)])).toBeNull();
  });

  it('counts a folded caller as having matched', () => {
    // Hero bets 100, the only opponent folds after putting in 40.
    // 60 is uncalled; the 40 stays in the pot.
    const players = [P(0, 100), P(1, 40, true)];
    expect(findUncalled(players)).toEqual({ seat: 0, amount: 60 });
  });

  it('moves the chips back to the stack', () => {
    const players = [P(0, 495), P(1, 161), P(2, 191)];
    returnUncalled(players);
    expect(players[0].handCommit).toBe(191);
    expect(players[0].stack).toBe(304);
  });
});

describe('side pots', () => {
  it('makes a single pot when nobody is all-in for less', () => {
    const pots = buildPots([P(0, 50), P(1, 50), P(2, 50)]);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(150);
    expect(pots[0].eligible).toEqual([0, 1, 2]);
  });

  it('splits main and side pot for one short all-in', () => {
    // Seat 0 all-in 30, seats 1 and 2 continue to 100.
    const pots = buildPots([P(0, 30), P(1, 100), P(2, 100)]);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 90, eligible: [0, 1, 2] });
    expect(pots[1]).toEqual({ amount: 140, eligible: [1, 2] });
  });

  it('handles three all-ins at three different levels', () => {
    const pots = buildPots([P(0, 20), P(1, 60), P(2, 150), P(3, 150)]);
    expect(pots.map((p) => p.amount)).toEqual([80, 120, 180]);
    expect(pots.map((p) => p.eligible)).toEqual([[0, 1, 2, 3], [1, 2, 3], [2, 3]]);
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(20 + 60 + 150 + 150);
  });

  it('keeps a folded player money but not eligibility', () => {
    const pots = buildPots([P(0, 100), P(1, 100), P(2, 100, true)]);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligible).toEqual([0, 1]);
  });

  it('merges slices that have the same eligible players', () => {
    // The short stack folded, so both slices are contested by 1 and 2 alone.
    // Keeping them apart would be pointless bookkeeping: they merge into one.
    const pots = buildPots([P(0, 25, true), P(1, 90), P(2, 90)]);
    expect(pots).toHaveLength(1);
    expect(pots[0]).toEqual({ amount: 205, eligible: [1, 2] });
  });

  it('keeps a side pot separate when the short stack is still live', () => {
    const pots = buildPots([P(0, 25), P(1, 90), P(2, 90)]);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 75, eligible: [0, 1, 2] });
    expect(pots[1]).toEqual({ amount: 130, eligible: [1, 2] });
  });

  it('never loses a cent', () => {
    const players = [P(0, 7), P(1, 33), P(2, 33), P(3, 91), P(4, 12, true)];
    const pots = buildPots(players);
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(7 + 33 + 33 + 91 + 12);
  });
});
