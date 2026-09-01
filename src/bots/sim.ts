/**
 * Прогон раздач между ботами и замер их поведения.
 *
 * Замеряется РОВНО по тем же определениям, что и статистика из реальной базы
 * (extract.py): «открытие» — рейз, когда до тебя никто не поднимал; «3-бет» —
 * рейз против одного открытия; «ставка первым» — ставка на улице, где до тебя
 * ещё не ставили. Иначе сравнение real → sim было бы нечестным.
 *
 * Замеряются все шесть мест сразу: за один прогон набирается статистика на
 * шесть профилей, иначе калибровка двадцати ботов заняла бы часы.
 */

import { playerAt, legalActions, type ActionRequest } from '../game/betting';
import { act, createHand } from '../game/hand';
import { totalPot, type HandState, type Position, type Street } from '../game/types';
import { makeRng, randInt, type Rng } from '../game/rng';
import { decide, type BotKnobs, type BotContext } from './decide';
import type { BotProfile } from './profiles';

export interface StreetCounters {
  firstOpp: number;
  firstBet: number;
  vsBet: number;
  fold: number;
  call: number;
  raise: number;
}

export interface Counters {
  hands: number;
  vpip: number;
  pfr: number;
  openOpp: number;
  open: number;
  limp: number;
  openOppBy: Record<string, number>;
  openBy: Record<string, number>;
  threeBetOpp: number;
  threeBet: number;
  coldOpp: number;
  coldCall: number;
  defendOpp: number;
  defendCall: number;
  defendThreeBet: number;
  vs3betOpp: number;
  vs3betFold: number;
  vs3betCall: number;
  vs3betFourBet: number;
  flops: number;
  wtsd: number;
  cbetOpp: number;
  cbet: number;
  flop: StreetCounters;
  turn: StreetCounters;
  river: StreetCounters;
}

export function emptyCounters(): Counters {
  const s = (): StreetCounters => ({ firstOpp: 0, firstBet: 0, vsBet: 0, fold: 0, call: 0, raise: 0 });
  return {
    hands: 0, vpip: 0, pfr: 0, openOpp: 0, open: 0, limp: 0,
    openOppBy: {}, openBy: {},
    threeBetOpp: 0, threeBet: 0, coldOpp: 0, coldCall: 0,
    defendOpp: 0, defendCall: 0, defendThreeBet: 0,
    vs3betOpp: 0, vs3betFold: 0, vs3betCall: 0, vs3betFourBet: 0,
    flops: 0, wtsd: 0, cbetOpp: 0, cbet: 0,
    flop: s(), turn: s(), river: s(),
  };
}

interface Watch {
  vpip: boolean;
  raisedPreflop: boolean;
  countedOpen: boolean;
  countedThreeBet: boolean;
  countedVs3bet: boolean;
  foldedPreflop: boolean;
  actedThisStreet: boolean;
  countedFirstIn: boolean;
}

export interface SimOptions {
  profiles: BotProfile[];
  knobs: Map<string, BotKnobs>;
  hands: number;
  seed: number;
  smallBlind?: number;
  bigBlind?: number;
  /** Функция стека; по умолчанию ровно 100bb. */
  stackFor?: (rng: Rng, bb: number) => number;
}

export function buildContext(
  state: HandState,
  seat: number,
  profile: BotProfile,
  knobs: BotKnobs,
  seatProfiles: BotProfile[],
  rng: Rng,
): BotContext {
  const p = playerAt(state, seat);
  const legal = legalActions(state)!;

  let aggressionsThisStreet = 0;
  let lastAggressor = -1;
  let pfAggressor = -1;
  for (const a of state.log) {
    if (a.street === 'preflop' && a.kind === 'raise') pfAggressor = a.seat;
    if (a.street !== state.street) continue;
    if (a.kind === 'raise' || a.kind === 'bet') {
      aggressionsThisStreet++;
      lastAggressor = a.seat;
    }
  }

  const bettorSeat = state.street !== 'preflop' && state.currentBet > 0 ? lastAggressor : -1;

  return {
    profile,
    knobs,
    cards: p.cards,
    board: state.board,
    street: state.street,
    position: p.position,
    legal,
    pot: totalPot(state),
    stack: p.stack,
    bigBlind: state.bigBlind,
    playersInHand: state.players.filter((x) => !x.folded).length,
    level: state.street === 'preflop' ? 1 + aggressionsThisStreet : 1,
    isPreflopAggressor: pfAggressor === seat,
    facingBet: state.street === 'preflop' ? true : state.currentBet > 0,
    bettor: bettorSeat >= 0 ? seatProfiles[bettorSeat] : undefined,
    rng,
  };
}

/**
 * Играет `hands` раздач. На каждую раздачу за стол садятся шесть случайных
 * профилей из переданного списка, поэтому за один прогон статистика
 * набирается сразу на всех.
 */
export function simulate(opts: SimOptions): Map<string, Counters> {
  const out = new Map<string, Counters>();
  for (const p of opts.profiles) out.set(p.name, emptyCounters());

  const sb = opts.smallBlind ?? 2;
  const bb = opts.bigBlind ?? 4;
  const rng = makeRng(opts.seed);
  const pool = opts.profiles;

  for (let h = 0; h < opts.hands; h++) {
    // Шесть разных профилей за стол.
    const seatProfiles: BotProfile[] = [];
    const taken = new Set<number>();
    while (seatProfiles.length < 6) {
      const i = randInt(rng, pool.length);
      if (taken.has(i) && pool.length >= 6) continue;
      taken.add(i);
      seatProfiles.push(pool[i]);
    }

    const state = createHand({
      seats: seatProfiles.map((p) => ({
        name: p.name,
        stack: opts.stackFor ? opts.stackFor(rng, bb) : 100 * bb,
      })),
      button: h % 6,
      smallBlind: sb,
      bigBlind: bb,
      seed: (opts.seed * 7919 + h) >>> 0,
    });

    const watches: Watch[] = seatProfiles.map(() => ({
      vpip: false, raisedPreflop: false, countedOpen: false, countedThreeBet: false,
      countedVs3bet: false, foldedPreflop: false, actedThisStreet: false, countedFirstIn: false,
    }));
    for (const p of seatProfiles) out.get(p.name)!.hands++;

    let street: Street = state.street;
    let sawBetThisStreet = false;

    let guard = 0;
    while (!state.finished) {
      if (++guard > 400) break;

      if (state.street !== street) {
        street = state.street;
        sawBetThisStreet = false;
        for (const w of watches) {
          w.actedThisStreet = false;
          w.countedFirstIn = false;
        }
        if (street === 'flop') {
          state.players.forEach((pl, i) => {
            if (!watches[i].foldedPreflop) out.get(seatProfiles[i].name)!.flops++;
            void pl;
          });
        }
      }

      const seat = state.toAct;
      const profile = seatProfiles[seat];
      const knobs = opts.knobs.get(profile.name)!;
      const ctx = buildContext(state, seat, profile, knobs, seatProfiles, rng);
      const request = decide(ctx);

      record(out.get(profile.name)!, watches[seat], ctx, request, ctx.position, sawBetThisStreet);

      watches[seat].actedThisStreet = true;
      if (request.kind === 'raise' || request.kind === 'bet') sawBetThisStreet = true;
      if (state.street === 'preflop' && request.kind === 'fold') watches[seat].foldedPreflop = true;

      act(state, request);
    }

    if (state.board.length === 5) {
      const alive = state.players.filter((p) => !p.folded);
      if (alive.length > 1) {
        for (const p of alive) out.get(seatProfiles[p.seat].name)!.wtsd++;
      }
    }
  }

  return out;
}

function record(
  c: Counters,
  w: Watch,
  ctx: BotContext,
  req: ActionRequest,
  pos: Position,
  sawBetThisStreet: boolean,
) {
  const isRaise = req.kind === 'raise';
  const isBet = req.kind === 'bet';
  const isCall = req.kind === 'call';

  if (ctx.street === 'preflop') {
    if ((isCall || isRaise) && !w.vpip) { c.vpip++; w.vpip = true; }
    if (isRaise && !w.raisedPreflop) c.pfr++;

    if (ctx.level <= 1 && !w.countedOpen) {
      c.openOpp++;
      c.openOppBy[pos] = (c.openOppBy[pos] ?? 0) + 1;
      w.countedOpen = true;
      if (isRaise) { c.open++; c.openBy[pos] = (c.openBy[pos] ?? 0) + 1; }
      else if (isCall) c.limp++;
    } else if (ctx.level === 2 && !w.raisedPreflop && !w.countedThreeBet) {
      c.threeBetOpp++;
      w.countedThreeBet = true;
      if (pos === 'SB' || pos === 'BB') {
        c.defendOpp++;
        if (isCall) c.defendCall++;
        if (isRaise) { c.defendThreeBet++; c.threeBet++; }
      } else {
        c.coldOpp++;
        if (isCall) c.coldCall++;
        if (isRaise) c.threeBet++;
      }
    } else if (ctx.level >= 3 && w.raisedPreflop && !w.countedVs3bet) {
      c.vs3betOpp++;
      w.countedVs3bet = true;
      if (req.kind === 'fold') c.vs3betFold++;
      else if (isCall) c.vs3betCall++;
      else if (isRaise) c.vs3betFourBet++;
    }

    if (isRaise) w.raisedPreflop = true;
    return;
  }

  const s = ctx.street === 'flop' ? c.flop : ctx.street === 'turn' ? c.turn : c.river;

  if (sawBetThisStreet) {
    s.vsBet++;
    if (req.kind === 'fold') s.fold++;
    else if (isCall) s.call++;
    else if (isRaise) s.raise++;
    return;
  }

  if (!w.countedFirstIn) {
    w.countedFirstIn = true;
    s.firstOpp++;
    if (isBet) s.firstBet++;
    if (ctx.street === 'flop' && ctx.isPreflopAggressor) {
      c.cbetOpp++;
      if (isBet) c.cbet++;
    }
  }
}
