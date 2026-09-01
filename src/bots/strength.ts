/**
 * Насколько сильна конкретная рука на конкретном борде.
 *
 * Никаких «если топ-пара, то...». Здесь считаются два числа по настоящим
 * картам:
 *
 *  - `percentile` — доля всех рук соперника, которые мы сейчас бьём. Считается
 *    перебором всех оставшихся комбинаций, а не формулой. Это и есть эквити
 *    против случайной руки на этом борде.
 *  - `outs` / `draws` — что рука может стать, если карта ещё придёт.
 *
 * Оба числа не зависят от того, кто наш соперник: это свойства карт. Характер
 * соперника подключается уже в decide.ts, где из этих чисел получается
 * решение.
 */

import { NUM_CARDS, rankOf, suitOf, type Card } from '../engine/cards';
import { evaluate, categoryOf, CAT_PAIR, CAT_TWO_PAIR } from '../engine/evaluator';

export interface Draws {
  flushDraw: boolean;
  /** Четыре к флешу, но пятая карта уже на борде у всех — «фальшивое» дро. */
  backdoorFlush: boolean;
  openEnded: boolean;
  gutshot: boolean;
  /** Грубая оценка числа карт, улучшающих руку до сильной. */
  outs: number;
}

export interface Strength {
  /** Значение готовой комбинации (сравнимое число из evaluator). */
  value: number;
  category: number;
  /** Доля рук соперника, которые мы бьём: 0..1. Ничьи считаются за половину. */
  percentile: number;
  draws: Draws;
  /** Пара, но не своя — на борде. Такие руки почти нечем защищать. */
  boardPlays: boolean;
  /** Пара из своих карт со старшей картой борда. */
  topPair: boolean;
  overpair: boolean;
}

/**
 * Доля комбинаций соперника, которые бьёт наша рука.
 *
 * Перебираются все пары карт из оставшейся колоды — на флопе это 990
 * вариантов. Дорого, но честно: никакой таблицы приближений.
 */
export function handPercentile(hole: readonly Card[], board: readonly Card[]): number {
  const used = new Uint8Array(NUM_CARDS);
  for (const c of hole) used[c] = 1;
  for (const c of board) used[c] = 1;

  const deck: Card[] = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!used[c]) deck.push(c);

  const mine = evaluate([hole[0], hole[1], ...board]);
  const seven = [0, 0, ...board] as Card[];

  let beaten = 0;
  let total = 0;
  for (let i = 0; i < deck.length; i++) {
    seven[0] = deck[i];
    for (let j = i + 1; j < deck.length; j++) {
      seven[1] = deck[j];
      const theirs = evaluate(seven);
      if (mine > theirs) beaten += 2;
      else if (mine === theirs) beaten += 1;
      total += 2;
    }
  }
  return total === 0 ? 0.5 : beaten / total;
}

/** То же самое, но по случайной подвыборке — для горячих мест. */
export function handPercentileFast(
  hole: readonly Card[],
  board: readonly Card[],
  samples: number,
  rng: () => number,
): number {
  const used = new Uint8Array(NUM_CARDS);
  for (const c of hole) used[c] = 1;
  for (const c of board) used[c] = 1;
  const deck: Card[] = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!used[c]) deck.push(c);

  const mine = evaluate([hole[0], hole[1], ...board]);
  const seven = [0, 0, ...board] as Card[];
  let beaten = 0;
  let total = 0;
  for (let s = 0; s < samples; s++) {
    const i = Math.floor(rng() * deck.length);
    let j = Math.floor(rng() * deck.length);
    if (i === j) j = (j + 1) % deck.length;
    seven[0] = deck[i];
    seven[1] = deck[j];
    const theirs = evaluate(seven);
    if (mine > theirs) beaten += 2;
    else if (mine === theirs) beaten += 1;
    total += 2;
  }
  return total === 0 ? 0.5 : beaten / total;
}

export function findDraws(hole: readonly Card[], board: readonly Card[]): Draws {
  const all = [...hole, ...board];

  const suitCount = [0, 0, 0, 0];
  const holeSuits = [0, 0, 0, 0];
  for (const c of all) suitCount[suitOf(c)]++;
  for (const c of hole) holeSuits[suitOf(c)]++;

  let flushDraw = false;
  let backdoorFlush = false;
  for (let s = 0; s < 4; s++) {
    if (holeSuits[s] === 0) continue;
    if (suitCount[s] === 4) flushDraw = true;
    else if (suitCount[s] === 3 && board.length === 3) backdoorFlush = true;
  }

  const ranks = new Set<number>();
  for (const c of all) ranks.add(rankOf(c));
  if (ranks.has(12)) ranks.add(-1); // туз снизу, для 5-4-3-2-A

  let openEnded = false;
  let gutshot = false;
  for (let low = -1; low <= 8; low++) {
    let have = 0;
    for (let k = 0; k < 5; k++) if (ranks.has(low + k)) have++;
    if (have === 5) {
      openEnded = false;
      gutshot = false;
      break;
    }
    if (have === 4) {
      // Двусторонний, если четвёрка идёт подряд и у окна есть выход с обеих сторон.
      const consecutive =
        ranks.has(low) && ranks.has(low + 1) && ranks.has(low + 2) && ranks.has(low + 3);
      const upper =
        ranks.has(low + 1) && ranks.has(low + 2) && ranks.has(low + 3) && ranks.has(low + 4);
      if ((consecutive && low + 4 <= 12 && low - 1 >= -1) || (upper && low >= 0)) openEnded = true;
      else gutshot = true;
    }
  }

  let outs = 0;
  if (flushDraw) outs += 9;
  if (openEnded) outs += 8;
  else if (gutshot) outs += 4;
  if (flushDraw && (openEnded || gutshot)) outs -= 2; // часть аутов пересекается

  return { flushDraw, backdoorFlush, openEnded, gutshot, outs };
}

export function analyse(hole: readonly Card[], board: readonly Card[]): Strength {
  const value = evaluate([hole[0], hole[1], ...board]);
  const category = categoryOf(value);
  const percentile = handPercentile(hole, board);
  const draws = findDraws(hole, board);

  const boardValue = board.length >= 5 ? evaluate(board as Card[]) : -1;
  const boardPlays = board.length >= 5 && value === boardValue;

  const boardRanks = board.map(rankOf).sort((a, b) => b - a);
  const topBoard = boardRanks[0] ?? -1;
  const h0 = rankOf(hole[0]);
  const h1 = rankOf(hole[1]);
  const pairRank = category === CAT_PAIR ? (value >> 16) & 0xf : -1;

  const topPair =
    category === CAT_PAIR && pairRank === topBoard && (h0 === topBoard || h1 === topBoard);
  const overpair =
    category === CAT_PAIR && h0 === h1 && h0 > topBoard;

  return {
    value,
    category,
    percentile,
    draws,
    boardPlays,
    topPair,
    overpair,
  };
}

/** Сильная готовая рука: две пары и лучше. */
export function isStrongMade(s: Strength): boolean {
  return s.category >= CAT_TWO_PAIR && !s.boardPlays;
}
