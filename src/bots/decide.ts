/**
 * Решение бота.
 *
 * Никакой рулетки «20% рейз / 30% колл / 50% фолд». Бот смотрит на свои
 * настоящие карты, считает, какую долю рук соперника он бьёт на этом борде,
 * учитывает дро, размер банка, цену колла, глубину стека, число соперников —
 * и только потом характер профиля решает, где у него пороги.
 *
 * Частоты из реальной базы задают не действие, а ПОРОГИ. Насколько часто
 * PokerMind ставит на флопе — это следствие того, где у него проходит граница
 * «достаточно сильная рука», а не бросок кубика.
 *
 * Что здесь честно измерено, а что смоделировано:
 *  - пороги силы руки калибруются по измеренным частотам из базы;
 *  - доля блефа в 3-бете и на постфлопе измерена быть НЕ МОЖЕТ (в выгрузке нет
 *    карт соперников), поэтому берётся из архетипа. Это допущение, а не факт.
 */

import { rankOf, suitOf, type Card } from '../engine/cards';
import { classIndex } from '../engine/range';
import { PERCENTILE_BY_INDEX } from './handRank';
import type { BotProfile } from './profiles';
import { analyse, type Strength } from './strength';
import type { ActionRequest } from '../game/betting';
import type { LegalActions, Position, Street } from '../game/types';
import type { Rng } from '../game/rng';

/* ------------------------------------------------------------------ */
/* Ручки, которые калибруются                                          */
/* ------------------------------------------------------------------ */

export interface StreetKnobs {
  /** Перцентиль, выше которого рука ставится ради ценности. */
  betCut: number;
  /** Вероятность поставить с дро (полублеф). */
  drawBluff: number;
  /** Вероятность поставить вообще без ничего. */
  airBluff: number;
  /** Множитель к шансам банка: <1 — коллирует шире, чем «по цене». */
  callLoose: number;
  /** Перцентиль, выше которого рука повышает чужую ставку. */
  raiseCut: number;
  /** Вероятность повысить с дро. */
  raiseBluff: number;
}

export interface BotKnobs {
  /** Перцентильная граница открытия по позициям (она же ширина диапазона). */
  openBy: Record<Position, number>;
  /** Отдельный порог для c-bet: агрессор префлопа ставит на флопе иначе. */
  cbetCut: number;
  limpWidth: number;
  threeBetValue: number;
  threeBetBluff: number;
  coldCallWidth: number;
  defendCallWidth: number;
  defendThreeBetValue: number;
  call3BetCut: number;
  fourBetCut: number;
  flop: StreetKnobs;
  turn: StreetKnobs;
  river: StreetKnobs;
}

/** Доля блефа в диапазоне — модельное допущение по архетипу, не измерение. */
const BLUFF_SHARE: Record<BotProfile['archetype'], number> = {
  'tight-aggressive': 0.32,
  'loose-aggressive': 0.4,
  'tight-passive': 0.08,
  'loose-passive': 0.05,
};

export function defaultKnobs(p: BotProfile): BotKnobs {
  const bluff = BLUFF_SHARE[p.archetype];
  const street = (s: { betFirst: number; foldVsBet: number; raiseVsBet: number }): StreetKnobs => ({
    betCut: 1 - s.betFirst * (1 - bluff),
    drawBluff: bluff * 1.6,
    airBluff: bluff * 0.25,
    callLoose: 1,
    raiseCut: 1 - s.raiseVsBet * (1 - bluff * 0.6),
    raiseBluff: bluff * 0.35,
  });
  return {
    openBy: { ...p.openBy },
    cbetCut: 1 - p.cbet * (1 - bluff),
    limpWidth: p.limp,
    threeBetValue: p.threeBet * (1 - bluff),
    threeBetBluff: bluff,
    coldCallWidth: p.coldCall,
    defendCallWidth: p.defendCall,
    defendThreeBetValue: p.defendThreeBet * (1 - bluff),
    call3BetCut: p.call3Bet,
    fourBetCut: p.fourBet,
    flop: street(p.flop),
    turn: street(p.turn),
    river: street(p.river),
  };
}

/* ------------------------------------------------------------------ */
/* Префлоп                                                             */
/* ------------------------------------------------------------------ */

/** Насколько сильна стартовая рука: 0 = AA, 1 = худшая. */
export function preflopPercentile(cards: readonly Card[]): number {
  const r0 = rankOf(cards[0]);
  const r1 = rankOf(cards[1]);
  const suited = suitOf(cards[0]) === suitOf(cards[1]);
  const high = Math.max(r0, r1);
  const low = Math.min(r0, r1);
  const kind = r0 === r1 ? 'pair' : suited ? 'suited' : 'offsuit';
  return PERCENTILE_BY_INDEX[classIndex(high, low, kind)];
}

/**
 * Годится ли рука в блеф-3-бет: одномастные тузы низкого достоинства и
 * одномастные связки. Их ценность не в текущей силе, а в том, что они
 * блокируют сильные руки соперника и хорошо играются после флопа.
 */
export function isBluffCandidate(cards: readonly Card[]): boolean {
  const r0 = rankOf(cards[0]);
  const r1 = rankOf(cards[1]);
  const suited = suitOf(cards[0]) === suitOf(cards[1]);
  if (!suited || r0 === r1) return false;
  const high = Math.max(r0, r1);
  const low = Math.min(r0, r1);
  if (high === 12 && low <= 3) return true; // A2s..A5s
  if (high - low === 1 && low >= 3 && low <= 8) return true; // 65s..T9s
  if (high === 11 && low >= 5 && low <= 8) return true; // K7s..KTs
  return false;
}

/* ------------------------------------------------------------------ */
/* Контекст решения                                                    */
/* ------------------------------------------------------------------ */

export interface BotContext {
  profile: BotProfile;
  knobs: BotKnobs;
  cards: [Card, Card];
  board: Card[];
  street: Street;
  position: Position;
  legal: LegalActions;
  /** Банк до действия. */
  pot: number;
  stack: number;
  bigBlind: number;
  /** Сколько игроков ещё в раздаче. */
  playersInHand: number;
  /** Уровень торговли на префлопе: 1 — блайнд, 2 — опен, 3 — 3-бет. */
  level: number;
  /** Был ли бот агрессором на префлопе. */
  isPreflopAggressor: boolean;
  /** Ставил ли уже кто-то на этой улице до бота. */
  facingBet: boolean;
  /** Профиль того, кто поставил (если известен). */
  bettor?: BotProfile;
  rng: Rng;
}

/* ------------------------------------------------------------------ */
/* Главная функция                                                     */
/* ------------------------------------------------------------------ */

export function decide(ctx: BotContext): ActionRequest {
  return ctx.street === 'preflop' ? decidePreflop(ctx) : decidePostflop(ctx);
}

function decidePreflop(ctx: BotContext): ActionRequest {
  const { profile, knobs, legal, rng } = ctx;
  const p = preflopPercentile(ctx.cards);
  const bluffy = isBluffCandidate(ctx.cards);

  // --- никто ещё не поднимал: открыть, лимпить или сбросить
  if (ctx.level <= 1) {
    const openWidth = knobs.openBy[ctx.position];
    if (p <= openWidth && legal.canRaise) {
      return raiseTo(ctx, Math.round(profile.openSizeBB * ctx.bigBlind));
    }
    if (p <= openWidth + knobs.limpWidth) {
      if (legal.canCheck) return { kind: 'check' };
      if (legal.canCall) return { kind: 'call' };
    }
    return legal.canCheck ? { kind: 'check' } : { kind: 'fold' };
  }

  // --- перед нами открытие
  if (ctx.level === 2) {
    const blind = ctx.position === 'SB' || ctx.position === 'BB';
    const valueCut = blind ? knobs.defendThreeBetValue : knobs.threeBetValue;
    const callWidth = blind ? knobs.defendCallWidth : knobs.coldCallWidth;

    if (p <= valueCut && legal.canRaise) return raiseTo(ctx, threeBetSize(ctx));
    if (bluffy && legal.canRaise && rng() < knobs.threeBetBluff) return raiseTo(ctx, threeBetSize(ctx));
    if (p <= valueCut + callWidth && legal.canCall) {
      // Короткий стек предпочитает 3-бет коллу: играть без позиции с 25bb плохо.
      if (ctx.stack < 30 * ctx.bigBlind && p <= valueCut * 2 && legal.canRaise) {
        return raiseTo(ctx, threeBetSize(ctx));
      }
      return { kind: 'call' };
    }
    return legal.canCheck ? { kind: 'check' } : { kind: 'fold' };
  }

  // --- перед нами 3-бет или больше
  const fourBetCut = knobs.fourBetCut * 0.06;
  const callCut = fourBetCut + knobs.call3BetCut * 0.14;
  if (p <= fourBetCut && legal.canRaise) return raiseTo(ctx, fourBetSize(ctx));
  if (p <= callCut && legal.canCall) return { kind: 'call' };
  return legal.canCheck ? { kind: 'check' } : { kind: 'fold' };
}

function threeBetSize(ctx: BotContext): number {
  const target = Math.round(ctx.profile.threeBetSizeBB * ctx.bigBlind);
  // Без позиции 3-бет крупнее — иначе соперник заходит слишком дёшево.
  const oop = ctx.position === 'SB' || ctx.position === 'BB';
  return Math.round(target * (oop ? 1.2 : 1));
}

function fourBetSize(ctx: BotContext): number {
  return Math.round(ctx.legal.toCall * 2.3 + ctx.pot * 0.4);
}

/* ------------------------------------------------------------------ */

function decidePostflop(ctx: BotContext): ActionRequest {
  const { knobs, legal, rng } = ctx;
  const s = analyse(ctx.cards, ctx.board);
  const k = ctx.street === 'flop' ? knobs.flop : ctx.street === 'turn' ? knobs.turn : knobs.river;
  const stats =
    ctx.street === 'flop' ? ctx.profile.flop : ctx.street === 'turn' ? ctx.profile.turn : ctx.profile.river;

  const multiway = ctx.playersInHand > 2;
  const equity = effectiveEquity(s, ctx.street, multiway);

  if (!ctx.facingBet) return decideFirstIn(ctx, s, k, stats, equity, multiway);

  // --- перед нами ставка
  const toCall = legal.toCall;
  const potOdds = toCall / (ctx.pot + toCall);

  // Ключевой пересчёт. `percentile` — это доля ВСЕХ рук, которые мы бьём.
  // Но соперник ставит не случайной рукой, а верхушкой своего диапазона плюс
  // немного блефа. Против такой ставки наша реальная доля заметно меньше.
  const vsRange = equityVsBettingRange(s.percentile, ctx);
  const drawBonus = Math.max(0, equity - s.percentile);
  const continueEquity = Math.min(1, vsRange + drawBonus);

  if (legal.canRaise) {
    if (vsRange >= k.raiseCut) return raiseTo(ctx, raiseSize(ctx, stats.sizePct));
    if (s.draws.outs >= 8 && rng() < k.raiseBluff && !multiway) {
      return raiseTo(ctx, raiseSize(ctx, stats.sizePct));
    }
  }

  const needed = potOdds * k.callLoose;
  if (legal.canCall && continueEquity >= needed) return { kind: 'call' };
  return legal.canCheck ? { kind: 'check' } : { kind: 'fold' };
}

/**
 * Перевод «сколько рук вообще я бью» в «сколько я бью из тех, с которыми он
 * сюда ставит».
 *
 * Считаем, что диапазон ставки — это верхняя часть рук (ценность) плюс доля
 * блефа. Блеф мы бьём почти всегда, ценность — только если наш перцентиль
 * выше нижней границы его ценностного диапазона.
 *
 * Отсюда же берётся то, ради чего всё затевалось: одна и та же ставка от
 * MASELL и от PokerMind даёт разные числа, потому что у них разная частота
 * ставки и разная доля блефа.
 */
function equityVsBettingRange(percentile: number, ctx: BotContext): number {
  const b = ctx.bettor;
  const stats = b
    ? ctx.street === 'flop' ? b.flop : ctx.street === 'turn' ? b.turn : b.river
    : null;

  const betFreq = Math.min(0.9, Math.max(0.08, stats ? stats.betFirst : 0.35));
  const bluffShare = b ? BLUFF_SHARE[b.archetype] : 0.25;

  const value = betFreq * (1 - bluffShare);
  const bluff = betFreq * bluffShare;
  if (value + bluff <= 0) return percentile;

  // Доля ВСЕХ рук, которые мы бьём и которые при этом входят в его ценность.
  const beatValue = Math.max(0, percentile - (1 - value));
  return Math.min(1, (beatValue + bluff) / (value + bluff));
}

function decideFirstIn(
  ctx: BotContext,
  s: Strength,
  k: StreetKnobs,
  stats: { sizePct: number },
  equity: number,
  multiway: boolean,
): ActionRequest {
  const { legal, rng } = ctx;
  if (!legal.canBet) return legal.canCheck ? { kind: 'check' } : { kind: 'fold' };

  // Против нескольких соперников ставка должна продавить всех сразу,
  // поэтому блефовать заметно хуже, а ценность нужна выше.
  const mwPenalty = multiway ? 1 + 0.12 * (ctx.playersInHand - 2) : 1;
  // Агрессор префлопа на флопе ставит по своему порогу: c-bet и обычная
  // ставка первым — разные по частоте вещи, и в базе они разные.
  const baseCut =
    ctx.street === 'flop' && ctx.isPreflopAggressor ? ctx.knobs.cbetCut : k.betCut;
  const valueCut = Math.min(0.985, baseCut * mwPenalty);

  if (s.percentile >= valueCut) return betTo(ctx, betSize(ctx, stats.sizePct));

  const bluffScale = multiway ? 0.35 : 1;
  if (s.draws.outs >= 8 && rng() < k.drawBluff * bluffScale) {
    return betTo(ctx, betSize(ctx, stats.sizePct));
  }
  if (equity < 0.35 && rng() < k.airBluff * bluffScale) {
    return betTo(ctx, betSize(ctx, stats.sizePct * 0.8));
  }
  return { kind: 'check' };
}

/** Эквити с учётом дро: правило 2 и 4, огрублённое. */
function effectiveEquity(s: Strength, street: Street, multiway: boolean): number {
  if (street === 'river') return s.percentile;
  const cardsToCome = street === 'flop' ? 2 : 1;
  const drawEquity = Math.min(0.62, s.draws.outs * 0.021 * cardsToCome);
  const base = Math.max(s.percentile, drawEquity);
  return multiway ? base * 0.92 : base;
}

/* ------------------------------------------------------------------ */
/* Размеры                                                             */
/* ------------------------------------------------------------------ */

function betSize(ctx: BotContext, pct: number): number {
  const want = Math.round(ctx.pot * pct);
  return clampBet(ctx, want);
}

function raiseSize(ctx: BotContext, pct: number): number {
  const pot = ctx.pot + ctx.legal.toCall;
  const want = Math.round(ctx.legal.toCall + pot * Math.max(0.6, pct));
  return clampRaise(ctx, want);
}

function clampBet(ctx: BotContext, want: number): number {
  const { legal } = ctx;
  return Math.max(legal.minBetTotal, Math.min(legal.allInTotal, want));
}

function clampRaise(ctx: BotContext, want: number): number {
  const { legal } = ctx;
  return Math.max(legal.minRaiseTotal, Math.min(legal.maxRaiseTotal, want));
}

function betTo(ctx: BotContext, total: number): ActionRequest {
  const t = clampBet(ctx, total);
  // Оставлять себе меньше четверти банка бессмысленно — проще идти ва-банк.
  if (ctx.stack - (t - 0) < ctx.pot * 0.25) return { kind: 'bet', total: ctx.legal.allInTotal };
  return { kind: 'bet', total: t };
}

function raiseTo(ctx: BotContext, total: number): ActionRequest {
  const t = clampRaise(ctx, total);
  if (ctx.legal.maxRaiseTotal - t < ctx.pot * 0.3) {
    return { kind: 'raise', total: ctx.legal.maxRaiseTotal };
  }
  return { kind: 'raise', total: t };
}
