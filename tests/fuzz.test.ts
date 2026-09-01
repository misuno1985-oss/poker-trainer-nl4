import { describe, expect, it } from 'vitest';
import { legalActions, type ActionRequest } from '../src/game/betting';
import { act, createHand } from '../src/game/hand';
import { handValue } from '../src/game/showdown';
import { makeRng, randInt, type Rng } from '../src/game/rng';
import type { HandState } from '../src/game/types';

/**
 * Play random *legal* actions until the hand ends, then check the invariants
 * that must hold for every possible hand. This is the test that catches the
 * bugs no hand-written case thinks of: three-way all-ins at odd amounts, short
 * shoves that reopen nothing, blinds bigger than a stack, and so on.
 */

function randomAction(state: HandState, rng: Rng): ActionRequest {
  const l = legalActions(state)!;
  const options: ActionRequest[] = [];

  if (l.canCheck) options.push({ kind: 'check' });
  if (l.canCall) options.push({ kind: 'call' });
  options.push({ kind: 'fold' });

  if (l.canBet) {
    options.push({ kind: 'bet', total: l.minBetTotal });
    options.push({ kind: 'bet', total: l.allInTotal });
    if (l.allInTotal > l.minBetTotal) {
      const span = l.allInTotal - l.minBetTotal;
      options.push({ kind: 'bet', total: l.minBetTotal + randInt(rng, span + 1) });
    }
  }

  if (l.canRaise) {
    options.push({ kind: 'raise', total: l.minRaiseTotal });
    options.push({ kind: 'raise', total: l.maxRaiseTotal });
    if (l.maxRaiseTotal > l.minRaiseTotal) {
      const span = l.maxRaiseTotal - l.minRaiseTotal;
      options.push({ kind: 'raise', total: l.minRaiseTotal + randInt(rng, span + 1) });
    }
  }

  return options[randInt(rng, options.length)];
}

/** Stacks shaped roughly like the real NL4 tables: some short, most around
 *  100–150bb, a few deep. Cents, big blind = 4. */
function randomStack(rng: Rng): number {
  const r = rng();
  if (r < 0.1) return 40 + randInt(rng, 160); // 10–50bb
  if (r < 0.75) return 200 + randInt(rng, 440); // 50–160bb
  return 640 + randInt(rng, 360); // 160–250bb
}

interface Report {
  hands: number;
  showdowns: number;
  foldWins: number;
  sidePots: number;
  splits: number;
  allInHands: number;
}

function playRandomHands(count: number, seedBase: number): Report {
  const report: Report = {
    hands: 0,
    showdowns: 0,
    foldWins: 0,
    sidePots: 0,
    splits: 0,
    allInHands: 0,
  };

  for (let h = 0; h < count; h++) {
    const rng = makeRng(seedBase + h);
    const seatCount = 2 + randInt(rng, 5); // 2..6
    const state = createHand({
      seats: Array.from({ length: seatCount }, (_, i) => ({
        name: `P${i}`,
        stack: randomStack(rng),
      })),
      button: randInt(rng, seatCount),
      smallBlind: 2,
      bigBlind: 4,
      seed: seedBase + h,
    });

    const startTotal = state.players.reduce((s, p) => s + p.startingStack, 0);

    let steps = 0;
    while (!state.finished) {
      if (++steps > 500) throw new Error(`hand ${h} did not terminate`);
      act(state, randomAction(state, rng));
    }

    // --- invariants -------------------------------------------------------
    const endTotal = state.players.reduce((s, p) => s + p.stack, 0);
    expect(endTotal, `hand ${h}: chips changed`).toBe(startTotal);

    for (const p of state.players) {
      expect(p.stack, `hand ${h}: negative stack`).toBeGreaterThanOrEqual(0);
    }

    const result = state.result!;
    const netSum = Object.values(result.net).reduce((a, b) => a + b, 0);
    expect(netSum, `hand ${h}: net does not balance`).toBe(0);

    // No card was ever dealt twice.
    const seen = new Set<number>();
    for (const p of state.players) {
      for (const c of p.cards) {
        expect(seen.has(c), `hand ${h}: duplicate card`).toBe(false);
        seen.add(c);
      }
    }
    for (const c of state.board) {
      expect(seen.has(c), `hand ${h}: duplicate board card`).toBe(false);
      seen.add(c);
    }

    const alive = state.players.filter((p) => !p.folded);
    if (alive.length > 1) {
      expect(state.board.length, `hand ${h}: showdown without a full board`).toBe(5);
      report.showdowns++;
    } else {
      report.foldWins++;
    }

    // Every pot went to the best hand among the players eligible for it.
    for (const award of result.awards) {
      const eligible = award.pot.eligible
        .map((seat) => state.players.find((p) => p.seat === seat)!)
        .filter((p) => !p.folded);
      if (eligible.length > 1) {
        const best = Math.max(...eligible.map((p) => handValue(p.cards, state.board)));
        for (const seat of award.winners) {
          const p = state.players.find((x) => x.seat === seat)!;
          expect(handValue(p.cards, state.board), `hand ${h}: wrong winner`).toBe(best);
        }
      }
      if (award.winners.length > 1) report.splits++;
    }

    // Awarded chips equal the money that was actually contested.
    const contested = state.players.reduce((s, p) => s + p.handCommit, 0);
    const awarded = result.awards.reduce((s, a) => s + a.pot.amount, 0);
    expect(awarded, `hand ${h}: pot total mismatch`).toBe(contested);

    if (result.awards.length > 1) report.sidePots++;
    if (state.players.some((p) => p.allIn)) report.allInHands++;
    report.hands++;
  }

  return report;
}

describe('random hands', () => {
  it('holds every invariant across 10000 hands', () => {
    const report = playRandomHands(10_000, 12345);
    expect(report.hands).toBe(10_000);

    // The run has to actually exercise the hard paths, otherwise it proves
    // nothing. These are lower bounds, not expected values.
    expect(report.showdowns).toBeGreaterThan(1000);
    expect(report.foldWins).toBeGreaterThan(1000);
    expect(report.sidePots).toBeGreaterThan(100);
    expect(report.splits).toBeGreaterThan(50);
    expect(report.allInHands).toBeGreaterThan(1000);
  }, 120_000);

  it('is deterministic for a given seed', () => {
    const a = playRandomHands(200, 999);
    const b = playRandomHands(200, 999);
    expect(a).toEqual(b);
  });
});
