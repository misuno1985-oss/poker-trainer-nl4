/**
 * Сколько примерно стоит каждый вариант действия.
 *
 * Модель одноуличная и намеренно простая: она честно считает то, что можно
 * посчитать (долю против диапазона, цену колла, как часто соперник сбросит по
 * его же измеренной статистике), и не притворяется солвером. Где число
 * получено эвристикой — стоит пометка HEURISTIC и это видно в окне «Почему?».
 *
 * Архитектура рассчитана на замену: если позже захочется настоящий rollout,
 * достаточно подменить `evaluateCandidate`, всё остальное останется.
 *
 * Здесь нет и не может быть настоящих карт соперника: на входе снимок.
 */

import type { Card } from '../engine/cards';
import { equityVsRanges } from './equity';
import { bluffShareOf, inferRange, respondTo, type WeightedRange } from './range';
import { boardAt, boardChange } from './texture';
import type { Candidate, DecisionSnapshot, EvDetail } from './types';

export interface Analysis {
  candidates: Candidate[];
  /** Диапазоны соперников на момент решения — для объяснения. */
  ranges: Array<{ seat: number; name: string; range: WeightedRange }>;
  /** Доля героя против всех оставшихся, если дойти до вскрытия. */
  rawEquity: number;
  rangeList: WeightedRange[];
  seed: number;
}

/**
 * Насколько герой реализует свою долю. Без позиции реализовать труднее:
 * соперник ходит после нас и сам выбирает, когда увеличивать банк.
 * HEURISTIC: числа подобраны по здравому смыслу, не измерены.
 */
function realization(snap: DecisionSnapshot): number {
  if (snap.street === 'river') return 1;
  const base = snap.heroInPosition ? 0.95 : 0.86;
  return snap.activeCount > 2 ? base - 0.04 : base;
}

/** Сколько раз соперник сам увеличивал ставку на текущей улице. */
function aggressionCount(snap: DecisionSnapshot, seat: number): number {
  return snap.history.filter(
    (a) => a.street === snap.street && a.seat === seat && (a.kind === 'bet' || a.kind === 'raise'),
  ).length;
}

/**
 * Как часто соперник сбросит на нашу ставку такого размера.
 *
 * Здесь важно различать два принципиально разных случая, и именно на этом
 * модель сначала ошибалась:
 *
 *  - мы СТАВИМ в того, кто ещё ничего не вложил на этой улице. Тогда работает
 *    его измеренный фолд на ставку — это надёжная цифра из базы;
 *
 *  - мы ПОВЫШАЕМ того, кто только что поставил сам. Его диапазон уже сузился:
 *    он выбросил всё, чем не ставил. Сбросит он в основном свои блефы, а их у
 *    пассивного игрока почти нет. Брать здесь фолд-на-ставку — значит решить,
 *    что MASELL сбрасывает половину своих ставок, а это неправда.
 *
 * Вторая ветка — вывод модели, а не измерение: доля блефа не наблюдаема.
 */
export function foldEquity(snap: DecisionSnapshot, betSize: number): number {
  let combined = 1;
  const ratio = snap.pot > 0 ? betSize / snap.pot : 1;
  // HEURISTIC: крупнее ставка — чаще фолд, но зависимость пологая.
  const sizeAdjust = 0.72 + 0.42 * Math.min(1.6, ratio);

  // Свежая карта меняет не только диапазон, но и готовность сбрасывать. Тот,
  // кто поставил ровно на карте, закрывшей флеш или стрит, чаще всего именно
  // её и получил, и на повышение он не уходит.
  const danger = dangerOfLastCard(snap);
  const textureDamp = 1 - 0.45 * danger;

  for (const opp of snap.opponents) {
    if (opp.allIn) continue;
    let f: number;

    if (snap.street === 'preflop') {
      if (snap.preflopLevel >= 2 && opp.isPreflopAggressor) {
        // Мы 3-бетим того, кто открыл: это его измеренный фолд на 3-бет.
        f = opp.profile.foldTo3Bet;
      } else {
        // Мы открываем или повышаем лимперов: продолжит примерно та доля,
        // с какой он вообще входит в игру.
        f = 1 - Math.min(0.85, opp.profile.vpip * 1.15);
      }
      f *= Math.min(1.2, sizeAdjust);
    } else if (aggressionCount(snap, opp.seat) > 0) {
      // Повышаем того, кто уже поставил. Сбрасывает он прежде всего блефы —
      // но чем крупнее повышение, тем больше он выбрасывает и слабой ценности.
      const bluff = bluffShareOf(opp.profile);
      // HEURISTIC: доля НЕблефов, которая всё же не выдерживает повышения.
      const pressure = Math.min(0.55, 0.3 * Math.min(2, ratio));
      f = bluff + (1 - bluff) * pressure;

      // Каждое СЛЕДУЮЩЕЕ его повышение на той же улице резко сужает диапазон:
      // человек, поднявший дважды подряд, почти не сбрасывает. Это и есть та
      // ситуация, которая в базе игрока оказалась самой дорогой.
      const times = aggressionCount(snap, opp.seat);
      f *= Math.pow(0.5, times - 1);
      f *= textureDamp;

      f = Math.max(0.03, Math.min(0.78, f));
      combined *= f;
      continue;
    } else {
      const stats =
        snap.street === 'flop' ? opp.profile.flop
        : snap.street === 'turn' ? opp.profile.turn
        : opp.profile.river;
      f = stats.foldVsBet * sizeAdjust;
    }

    combined *= Math.max(0.02, Math.min(0.94, f));
  }
  return snap.opponents.length === 0 ? 1 : combined;
}

/** Насколько опасна карта, пришедшая на текущей улице. */
function dangerOfLastCard(snap: DecisionSnapshot): number {
  if (snap.street === 'turn') {
    return boardChange(boardAt(snap.board, 'flop'), boardAt(snap.board, 'turn')).danger;
  }
  if (snap.street === 'river') {
    return boardChange(boardAt(snap.board, 'turn'), boardAt(snap.board, 'river')).danger;
  }
  return 0;
}

/** Размеры ставок, которые тренер вообще рассматривает. */
function candidateSizes(snap: DecisionSnapshot): number[] {
  const l = snap.legal;
  const min = l.canBet ? l.minBetTotal : l.minRaiseTotal;
  const max = l.allInTotal;
  if (max < min) return [];

  const potAfterCall = snap.pot + l.toCall;
  const fractions = snap.street === 'preflop' ? [0.5, 0.75, 1] : [0.33, 0.5, 0.66, 0.8, 1];
  const raw = fractions.map((f) => Math.round(l.streetCommit + l.toCall + f * potAfterCall));
  // Ва-банк рассматриваем, только если он соразмерен банку. Иначе тренер
  // предлагал бы толкать девять банков всякий раз, когда это легально.
  const allInIsSane = max <= l.streetCommit + l.toCall + 2.5 * potAfterCall;
  if (allInIsSane || raw.every((t) => t >= max)) raw.push(max);

  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of raw) {
    const clamped = Math.max(min, Math.min(max, t));
    // Слишком близкие размеры не различаем — они и по смыслу одинаковы.
    if ([...seen].some((s) => Math.abs(s - clamped) <= Math.max(1, snap.bigBlind / 2))) continue;
    seen.add(clamped);
    out.push(clamped);
  }
  return out.sort((a, b) => a - b);
}

export function analyse(snap: DecisionSnapshot): Analysis {
  const ranges = snap.opponents.map((o) => ({
    seat: o.seat,
    name: o.name,
    range: inferRange(snap, o),
  }));
  const rangeList = ranges.map((r) => r.range);

  // Зерно привязано к публичной информации, поэтому один и тот же снимок
  // всегда даёт один и тот же ответ.
  const seed = seedFor(snap);
  const rawEquity = equityVsRanges(snap.heroCards, snap.board, rangeList, seed);
  const r = realization(snap);
  const l = snap.legal;
  const candidates: Candidate[] = [];

  if (l.toCall > 0) {
    candidates.push({ kind: 'fold', ev: 0, detail: { equity: rawEquity, toCall: l.toCall } });
  }

  if (l.canCheck) {
    candidates.push({
      kind: 'check',
      ev: rawEquity * r * snap.pot,
      detail: {
        equity: rawEquity,
        note: 'Чек ничего не стоит; ценность — доля в текущем банке.',
      },
    });
  }

  if (l.canCall) {
    const c = l.callAmount;
    const eq = rawEquity * r;
    candidates.push({
      kind: 'call',
      ev: eq * snap.pot - (1 - eq) * c,
      detail: {
        equity: rawEquity,
        toCall: c,
        potOdds: c / (snap.pot + c),
      },
    });
  }

  const aggressive: 'bet' | 'raise' | null = l.canBet ? 'bet' : l.canRaise ? 'raise' : null;
  if (aggressive) {
    for (const total of candidateSizes(snap)) {
      candidates.push(evalAggressive(snap, aggressive, total, rangeList, rawEquity, seed));
    }
  }

  candidates.sort((a, b) => b.ev - a.ev);
  return { candidates, ranges, rawEquity, rangeList, seed };
}

/**
 * Как часто соперник ответит на нашу ставку повторным повышением.
 * HEURISTIC: опирается на его измеренную частоту рейза чужой ставки, но с
 * поправкой — против крупного повышения повышают только с самой верхушкой.
 */
function reraiseChance(snap: DecisionSnapshot, ratio: number): number {
  let any = 0;
  for (const opp of snap.opponents) {
    if (opp.allIn) continue;
    const stats =
      snap.street === 'flop' ? opp.profile.flop
      : snap.street === 'turn' ? opp.profile.turn
      : snap.street === 'river' ? opp.profile.river
      : opp.profile.flop;
    const base = Math.max(0.02, stats.raiseVsBet) * 0.8;
    const p = Math.max(0.01, Math.min(0.3, base / Math.max(0.6, ratio)));
    any = 1 - (1 - any) * (1 - p);
  }
  return any;
}

/**
 * Оценка ставки или повышения ровно того размера, который выбран.
 *
 * Считается по ТРЁМ веткам ответа соперника, а не по двум. Это тот случай,
 * когда упрощение меняет ответ: против диапазона, с которым он ПОСТАВИЛ, у
 * героя может быть отличная доля, но повышение выгонит именно те руки, что он
 * бил, и уравняют его только те, что бьют его самого.
 */
export function evalAggressive(
  snap: DecisionSnapshot,
  kind: 'bet' | 'raise',
  total: number,
  rangeList: WeightedRange[],
  rawEquity: number,
  seed: number,
): Candidate {
  const added = total - snap.legal.streetCommit;
  const ratio = snap.pot > 0 ? added / snap.pot : 1;
  const pFold = foldEquity(snap, added);
  const pReraise = Math.min(1 - pFold, reraiseChance(snap, ratio));

  const perOppFold = 1 - Math.pow(1 - pFold, 1 / Math.max(1, rangeList.length));
  const responses = rangeList.map((range, i) =>
    respondTo(range, snap.board, snap.opponents[i]?.allIn ? 0 : perOppFold, pReraise),
  );

  const eqCall = equityVsRanges(
    snap.heroCards, snap.board, responses.map((r) => r.calls), seed + 7,
  );
  const eqReraise = equityVsRanges(
    snap.heroCards, snap.board, responses.map((r) => r.reraises), seed + 11,
  );

  // Уравняв, соперник докладывает разницу до нашей суммы, а не всю нашу
  // добавку: часть её лишь покрывает его ставку, уже лежащую в банке.
  const live = snap.opponents.filter((o) => !o.allIn);
  const calledBy =
    live.reduce((sum, o) => sum + Math.min(o.stack, Math.max(0, total - o.streetCommit)), 0) /
    Math.max(1, live.length);

  const evCalled = eqCall * (snap.pot + calledBy) - (1 - eqCall) * added;

  // Если он повысит в ответ: считаем повышение примерно в 2.6 раза от нашего
  // и берём лучшее из «уравнять» и «выбросить». Сдача здесь намеренно
  // осторожная — переоценивать собственную руку в этой точке дороже всего.
  const theirRaiseTo = Math.min(
    (live[0]?.stack ?? total) + (live[0]?.streetCommit ?? 0),
    Math.round(total * 2.6),
  );
  const theirPutIn = Math.max(0, theirRaiseTo - (live[0]?.streetCommit ?? 0));
  const ourExtra = Math.min(snap.heroStack - added, Math.max(0, theirRaiseTo - total));
  const evCallReraise =
    eqReraise * (snap.pot + theirPutIn) - (1 - eqReraise) * (added + ourExtra);
  const evVsReraise = Math.max(-added, evCallReraise);

  const pCall = Math.max(0, 1 - pFold - pReraise);
  const ev = pFold * snap.pot + pCall * evCalled + pReraise * evVsReraise;

  return {
    kind,
    total,
    ev,
    detail: {
      equity: rawEquity,
      equityVsContinue: eqCall,
      equityVsReraise: eqReraise,
      foldEquity: pFold,
      callChance: pCall,
      reraiseChance: pReraise,
      note: 'Частота сброса — из его статистики; деление ответа на колл и рейз — оценка модели.',
    },
  };
}

/** Зерно только из публичных данных — карт соперников в нём нет. */
function seedFor(snap: DecisionSnapshot): number {
  let h = 2166136261;
  const mix = (n: number) => {
    h ^= n + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h >>>= 0;
  };
  mix(snap.handNumber);
  mix(snap.pot);
  mix(snap.board.length);
  for (const c of snap.board) mix(c as Card);
  for (const c of snap.heroCards) mix(c);
  mix(snap.history.length);
  return h || 1;
}

/** Найти в списке кандидат, соответствующий фактическому действию героя. */
export function matchCandidate(
  candidates: Candidate[],
  kind: Candidate['kind'],
  total?: number,
): Candidate | null {
  if (kind !== 'bet' && kind !== 'raise') {
    return candidates.find((c) => c.kind === kind) ?? null;
  }
  const same = candidates.filter((c) => c.kind === kind);
  if (same.length === 0) return null;
  if (total === undefined) return same[0];
  let best = same[0];
  for (const c of same) {
    if (Math.abs((c.total ?? 0) - total) < Math.abs((best.total ?? 0) - total)) best = c;
  }
  return best;
}

export { bluffShareOf };

export type { EvDetail };
