/**
 * Betting rules for one street: what is legal, and what a legal action does.
 *
 * The fiddly rule this file exists to get right is the **short all-in**. When
 * a player shoves for less than a full raise, the price goes up but the betting
 * is *not* reopened: players who already acted must call or fold, they may not
 * re-raise. `Player.mayRaise` carries that state.
 */

import {
  type HandState,
  type LegalActions,
  type Player,
  type ActionKind,
  contenders,
} from './types';

export interface ActionRequest {
  kind: ActionKind;
  /** For bet/raise: the total this player will have on the street afterwards. */
  total?: number;
}

export function playerAt(state: HandState, seat: number): Player {
  const p = state.players.find((x) => x.seat === seat);
  if (!p) throw new Error(`no player in seat ${seat}`);
  return p;
}

export function legalActions(state: HandState): LegalActions | null {
  if (state.finished || state.toAct < 0) return null;
  const p = playerAt(state, state.toAct);
  const toCall = Math.max(0, state.currentBet - p.streetCommit);
  const callAmount = Math.min(toCall, p.stack);

  const canBet = state.currentBet === 0 && p.stack > 0;
  const canRaise = state.currentBet > 0 && p.stack > toCall && p.mayRaise;

  const allInTotal = p.streetCommit + p.stack;
  const minBetTotal = canBet ? Math.min(state.bigBlind, p.stack) : 0;

  let minRaiseTotal = 0;
  if (canRaise) {
    const wanted = state.currentBet + state.lastRaiseSize;
    // A stack too short for a full raise may still shove: that is the only
    // legal raise-to amount left.
    minRaiseTotal = Math.min(wanted, allInTotal);
  }

  return {
    seat: p.seat,
    toCall,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0 && p.stack > 0,
    callAmount,
    canBet,
    minBetTotal,
    canRaise,
    minRaiseTotal,
    maxRaiseTotal: canRaise ? allInTotal : 0,
    allInTotal,
  };
}

function fail(message: string): never {
  throw new Error(`illegal action: ${message}`);
}

/**
 * Apply one action for the player to act. Mutates `state` and returns it.
 * Throws on anything illegal — a trainer that silently accepts a bad action
 * teaches the wrong game.
 */
export function applyAction(state: HandState, req: ActionRequest): HandState {
  const legal = legalActions(state);
  if (!legal) fail('nobody is to act');
  const p = playerAt(state, legal.seat);

  switch (req.kind) {
    case 'fold': {
      p.folded = true;
      p.hasActed = true;
      p.mayRaise = false;
      pushLog(state, p, 'fold', 0);
      break;
    }

    case 'check': {
      if (!legal.canCheck) fail(`cannot check facing ${legal.toCall}`);
      p.hasActed = true;
      p.mayRaise = false;
      pushLog(state, p, 'check', 0);
      break;
    }

    case 'call': {
      if (!legal.canCall) fail('nothing to call');
      moveChips(p, legal.callAmount);
      p.hasActed = true;
      p.mayRaise = false;
      pushLog(state, p, 'call', legal.callAmount);
      break;
    }

    case 'bet': {
      if (!legal.canBet) fail('cannot bet when a bet is already out');
      const total = req.total ?? 0;
      if (total < legal.minBetTotal) fail(`bet ${total} below minimum ${legal.minBetTotal}`);
      if (total > legal.allInTotal) fail(`bet ${total} exceeds stack`);
      applyAggression(state, p, total, 'bet');
      break;
    }

    case 'raise': {
      if (!legal.canRaise) fail('cannot raise here');
      const total = req.total ?? 0;
      if (total < legal.minRaiseTotal) fail(`raise to ${total} below minimum ${legal.minRaiseTotal}`);
      if (total > legal.maxRaiseTotal) fail(`raise to ${total} exceeds stack`);
      applyAggression(state, p, total, 'raise');
      break;
    }

    default:
      fail(`unknown action ${req.kind}`);
  }

  state.toAct = nextToAct(state, legal.seat);
  return state;
}

function applyAggression(state: HandState, p: Player, total: number, kind: 'bet' | 'raise') {
  const amount = total - p.streetCommit;
  moveChips(p, amount);

  const raiseSize = total - state.currentBet;
  const isFullRaise = raiseSize >= state.lastRaiseSize;
  state.currentBet = total;

  if (isFullRaise) {
    state.lastRaiseSize = raiseSize;
    // A full raise puts the decision back to everybody else.
    for (const other of state.players) {
      if (other.seat === p.seat || other.folded || other.allIn) continue;
      other.hasActed = false;
      other.mayRaise = true;
    }
  }
  // A short all-in leaves hasActed alone: players who already acted still owe
  // the difference (so the round is not complete) but mayRaise stays false.

  p.hasActed = true;
  p.mayRaise = false;
  pushLog(state, p, kind, amount);
}

function moveChips(p: Player, amount: number) {
  if (amount < 0) fail('negative amount');
  if (amount > p.stack) fail('not enough chips');
  p.stack -= amount;
  p.streetCommit += amount;
  p.handCommit += amount;
  if (p.stack === 0) p.allIn = true;
}

function pushLog(state: HandState, p: Player, kind: ActionKind, amount: number) {
  state.log.push({
    seat: p.seat,
    street: state.street,
    kind,
    amount,
    total: p.streetCommit,
    allIn: p.allIn,
  });
}

/** Next seat clockwise that still owes a decision, or -1. */
export function nextToAct(state: HandState, from: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    const p = playerAt(state, seat);
    if (p.folded || p.allIn) continue;
    if (!p.hasActed || p.streetCommit < state.currentBet) return seat;
  }
  return -1;
}

/** Is the betting on this street over? */
export function roundComplete(state: HandState): boolean {
  const alive = state.players.filter((p) => !p.folded);
  if (alive.length <= 1) return true;

  const live = contenders(state);
  if (live.length === 0) return true;
  // With a single player still holding chips nobody can be raised, so the only
  // thing left is for them to match the price.
  if (live.length === 1) return live[0].streetCommit === state.currentBet;

  return live.every((p) => p.hasActed && p.streetCommit === state.currentBet);
}

/** Post a blind. Blinds are dead money: they do not count as having acted. */
export function postBlind(state: HandState, seat: number, amount: number) {
  const p = playerAt(state, seat);
  const paid = Math.min(amount, p.stack);
  moveChips(p, paid);
  state.currentBet = Math.max(state.currentBet, p.streetCommit);
  state.log.push({
    seat,
    street: 'preflop',
    kind: 'post',
    amount: paid,
    total: p.streetCommit,
    allIn: p.allIn,
  });
}
