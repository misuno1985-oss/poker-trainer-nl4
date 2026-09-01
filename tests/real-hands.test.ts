import { describe, expect, it } from 'vitest';
import { findUncalled, buildPots } from '../src/game/pots';
import type { Player } from '../src/game/types';
import fixture from './real-pots.json';

/**
 * Cross-check the pot maths against the real thing.
 *
 * `real-pots.json` is every one of the 7667 hands from the player's own 1win
 * history, reduced to what matters here: what each seat put in, what the room
 * handed back as an uncalled bet, what it paid out, and the rake. If our
 * uncalled-bet rule or pot slicing disagreed with a live poker room, this test
 * would say so.
 *
 * Each row: [contributions[], uncalledSeatIndex, uncalledAmount, paidOut, rake]
 */

type Row = [number[], number, number, number, number];
const HANDS = fixture as unknown as Row[];

function players(contributions: number[]): Player[] {
  return contributions.map((commit, seat) => ({
    seat,
    name: `P${seat}`,
    stack: 0,
    startingStack: commit,
    cards: [-1, -1],
    position: 'BTN',
    folded: false,
    allIn: false,
    streetCommit: commit,
    handCommit: commit,
    hasActed: true,
    mayRaise: false,
    won: 0,
  }));
}

/** How many seats actually put chips in. */
function contributors(contributions: number[]): number {
  return contributions.filter((c) => c > 0).length;
}

/**
 * Rows where a single seat is the only one who ever put money in. These are
 * not really hands — a blind posted at a table that then broke up, refunded
 * straight back. 1win books the refund without its usual "uncalled bet" flag,
 * so they are checked separately rather than silently skipped.
 */
const UNCONTESTED = HANDS.filter(([c]) => contributors(c) < 2);
const CONTESTED = HANDS.filter(([c]) => contributors(c) >= 2);

describe('against 7667 real 1win hands', () => {
  it('loads the fixture', () => {
    expect(HANDS.length).toBe(7667);
    expect(CONTESTED.length).toBeGreaterThan(7000);
  });

  it('refunds a lone blind exactly as the room did', () => {
    for (const [contributions, , , paidOut] of UNCONTESTED) {
      const found = findUncalled(players(contributions));
      const staked = contributions.reduce((a, b) => a + b, 0);
      expect(found?.amount ?? 0).toBe(staked);
      expect(paidOut).toBe(staked);
    }
  });

  it('finds the same uncalled bet the poker room returned', () => {
    let checked = 0;
    const mismatches: string[] = [];

    for (let i = 0; i < CONTESTED.length; i++) {
      const [contributions, ubSeat, ubAmount] = CONTESTED[i];
      const found = findUncalled(players(contributions));

      if (ubSeat < 0) {
        // The room returned nothing, so neither should we.
        if (found !== null && mismatches.length < 5) {
          mismatches.push(`hand ${i}: we returned ${found.amount}, room returned nothing`);
        }
      } else {
        checked++;
        if (!found || found.seat !== ubSeat || found.amount !== ubAmount) {
          if (mismatches.length < 5) {
            mismatches.push(
              `hand ${i}: room gave ${ubAmount} to seat ${ubSeat}, ` +
                `we gave ${found ? `${found.amount} to seat ${found.seat}` : 'nothing'}`,
            );
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(5000);
    expect(mismatches).toEqual([]);
  });

  it('slices pots that add up to what the room actually paid out', () => {
    const mismatches: string[] = [];
    let withSidePots = 0;

    for (let i = 0; i < CONTESTED.length; i++) {
      const [contributions, , ubAmount, paidOut, rake] = CONTESTED[i];
      const ps = players(contributions);

      // Take the uncalled part out exactly as the engine does mid-hand.
      const found = findUncalled(ps);
      if (found) {
        const p = ps.find((x) => x.seat === found.seat)!;
        p.handCommit -= found.amount;
      }

      const pots = buildPots(ps);
      const total = pots.reduce((s, pot) => s + pot.amount, 0);

      // Everything contested was either paid to a player or taken as rake.
      if (total !== paidOut + rake && mismatches.length < 5) {
        mismatches.push(
          `hand ${i}: pots ${total}, room paid ${paidOut} + rake ${rake} = ${paidOut + rake}` +
            ` (uncalled ${ubAmount})`,
        );
      }
      if (pots.length > 1) withSidePots++;
    }

    expect(mismatches).toEqual([]);
    expect(withSidePots).toBeGreaterThan(50);
  });
});
