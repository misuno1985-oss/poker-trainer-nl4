import { describe, expect, it } from 'vitest';
import { act } from '../src/game/hand';
import { legalActions } from '../src/game/betting';
import { totalPot } from '../src/game/types';
import { chipsConserved, setup } from './helpers';

/** Six seats, button on 0 -> SB 1, BB 2, UTG 3, HJ 4, CO 5. */
function table(stacks: number[] = [400, 400, 400, 400, 400, 400]) {
  return setup({
    count: 6,
    button: 0,
    stacks,
    holes: { 0: 'AsKs', 1: '7c2d', 2: 'QhQd', 3: '9s9d', 4: 'Jh3c', 5: '5h4h' },
    board: '2h7s8dTcKc',
  });
}

describe('blinds and opening action', () => {
  it('posts the blinds and gives the action to UTG', () => {
    const s = table();
    expect(s.players[1].handCommit).toBe(2);
    expect(s.players[2].handCommit).toBe(4);
    expect(s.currentBet).toBe(4);
    expect(s.toAct).toBe(3);
    expect(totalPot(s)).toBe(6);
  });

  it('offers UTG fold / call / raise but not check', () => {
    const l = legalActions(table())!;
    expect(l.canCheck).toBe(false);
    expect(l.canCall).toBe(true);
    expect(l.toCall).toBe(4);
    expect(l.canBet).toBe(false);
    expect(l.canRaise).toBe(true);
    expect(l.minRaiseTotal).toBe(8); // 4 + one full big blind
  });

  it('lets the big blind check its option when everyone limps', () => {
    let s = table();
    s = act(s, { kind: 'call' }); // UTG
    s = act(s, { kind: 'fold' }); // HJ
    s = act(s, { kind: 'fold' }); // CO
    s = act(s, { kind: 'fold' }); // BTN
    s = act(s, { kind: 'fold' }); // SB
    expect(s.toAct).toBe(2); // BB still has the option
    const l = legalActions(s)!;
    expect(l.canCheck).toBe(true);
    expect(l.canRaise).toBe(true);
    s = act(s, { kind: 'check' });
    expect(s.street).toBe('flop');
  });

  it('ends the hand when everyone folds to the big blind', () => {
    let s = table();
    for (let i = 0; i < 5; i++) s = act(s, { kind: 'fold' });
    expect(s.finished).toBe(true);
    expect(s.result!.net[2]).toBe(2); // BB wins the small blind only
    expect(s.result!.net[1]).toBe(-2);
    expect(chipsConserved(s)).toBe(true);
  });
});

describe('minimum raise', () => {
  it('tracks the last raise size, not the bet size', () => {
    let s = table();
    s = act(s, { kind: 'raise', total: 12 }); // UTG raises to 12, increment 8
    let l = legalActions(s)!;
    expect(l.minRaiseTotal).toBe(20); // 12 + 8
    s = act(s, { kind: 'raise', total: 20 }); // HJ min-raises, increment 8
    l = legalActions(s)!;
    expect(l.minRaiseTotal).toBe(28);
  });

  it('rejects a raise below the minimum', () => {
    const s = table();
    expect(() => act(s, { kind: 'raise', total: 7 })).toThrow(/below minimum/);
  });

  it('rejects a raise larger than the stack', () => {
    const s = table([400, 400, 400, 100, 400, 400]);
    expect(() => act(s, { kind: 'raise', total: 200 })).toThrow(/exceeds stack/);
  });

  it('uses one big blind as the minimum bet after the flop', () => {
    let s = table();
    s = act(s, { kind: 'fold' }); // UTG
    s = act(s, { kind: 'fold' }); // HJ
    s = act(s, { kind: 'fold' }); // CO
    s = act(s, { kind: 'fold' }); // BTN
    s = act(s, { kind: 'call' }); // SB completes
    s = act(s, { kind: 'check' }); // BB
    expect(s.street).toBe('flop');
    const l = legalActions(s)!;
    expect(l.canBet).toBe(true);
    expect(l.minBetTotal).toBe(4);
    expect(l.canRaise).toBe(false);
  });
});

describe('short all-in does not reopen the betting', () => {
  it('leaves a player who already called unable to re-raise', () => {
    // UTG raises to 12. HJ calls. CO shoves 17 — only 5 more, less than a full
    // raise of 8. UTG must call or fold; HJ, who already called, may not raise.
    let s = table([400, 400, 400, 400, 400, 17]);
    s = act(s, { kind: 'raise', total: 12 }); // UTG
    s = act(s, { kind: 'call' }); // HJ
    s = act(s, { kind: 'raise', total: 17 }); // CO all-in, short raise

    expect(s.players[5].allIn).toBe(true);
    expect(s.currentBet).toBe(17);
    expect(s.lastRaiseSize).toBe(8); // unchanged by the short shove

    s = act(s, { kind: 'fold' }); // BTN
    s = act(s, { kind: 'fold' }); // SB
    s = act(s, { kind: 'fold' }); // BB

    expect(s.toAct).toBe(3); // back to UTG, who owes 5
    let l = legalActions(s)!;
    expect(l.toCall).toBe(5);
    // The original raiser has already acted, so the short shove does not give
    // him a fresh raise either — call or fold only.
    expect(l.canRaise).toBe(false);
    s = act(s, { kind: 'call' });

    expect(s.toAct).toBe(4); // HJ owes 5 too
    l = legalActions(s)!;
    expect(l.toCall).toBe(5);
    expect(l.canRaise).toBe(false); // already acted, short shove did not reopen
    s = act(s, { kind: 'call' });
    expect(s.street).not.toBe('preflop');
  });

  it('reopens the betting after a full all-in raise', () => {
    let s = table([400, 400, 400, 400, 400, 40]);
    s = act(s, { kind: 'raise', total: 12 });
    s = act(s, { kind: 'call' }); // HJ
    s = act(s, { kind: 'raise', total: 40 }); // CO all-in, full raise (increment 28)
    expect(s.lastRaiseSize).toBe(28);
    s = act(s, { kind: 'fold' }); // BTN
    s = act(s, { kind: 'fold' }); // SB
    s = act(s, { kind: 'fold' }); // BB
    s = act(s, { kind: 'call' }); // UTG
    const l = legalActions(s)!; // HJ
    expect(l.canRaise).toBe(true);
    expect(l.minRaiseTotal).toBe(68);
  });
});

describe('all-in and street flow', () => {
  it('runs the board out when everyone left is all-in', () => {
    let s = table([400, 400, 400, 60, 60, 400]);
    s = act(s, { kind: 'raise', total: 60 }); // UTG all-in
    s = act(s, { kind: 'call' }); // HJ all-in
    s = act(s, { kind: 'fold' }); // CO
    s = act(s, { kind: 'fold' }); // BTN
    s = act(s, { kind: 'fold' }); // SB
    s = act(s, { kind: 'fold' }); // BB
    expect(s.finished).toBe(true);
    expect(s.board).toHaveLength(5);
    expect(chipsConserved(s)).toBe(true);
  });

  it('caps a call at the short stack', () => {
    let s = table([400, 400, 400, 400, 30, 400]);
    s = act(s, { kind: 'raise', total: 100 }); // UTG
    const l = legalActions(s)!; // HJ has only 30
    expect(l.callAmount).toBe(30);
    expect(l.canRaise).toBe(false);
    s = act(s, { kind: 'call' });
    expect(s.players[4].allIn).toBe(true);
    expect(s.players[4].handCommit).toBe(30);
  });
});
