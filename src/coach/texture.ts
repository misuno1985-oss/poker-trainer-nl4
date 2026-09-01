/**
 * Что происходит с доской.
 *
 * Без этого модель не отличает крупную ставку на пустой карте от точно такой
 * же ставки на карте, закрывшей флеш, — а это в покере совершенно разные
 * заявления. Здесь считается только то, что видно всем за столом: сама доска
 * и то, как её изменила новая карта.
 *
 * Никаких карт соперника: на входе доска и, для оценки руки, карты героя.
 */

import { rankOf, suitOf, type Card } from '../engine/cards';

export interface BoardTexture {
  /** На доске три карты одной масти — флеш уже возможен. */
  flushPossible: boolean;
  /** Четыре одной масти: флеш есть у очень многих. */
  fourToFlush: boolean;
  /** Пара или больше на доске. */
  paired: boolean;
  trips: boolean;
  /** Возможен стрит по видимым картам. */
  straightPossible: boolean;
  /** Четыре к стриту: не хватает одной карты, и она у многих. */
  fourToStraight: boolean;
  /** Насколько доска связная: 0 — сухая, 1 — очень опасная. */
  wetness: number;
  /** Старшая карта доски. */
  topRank: number;
}

export type ChangeKind =
  | 'flush-completed'
  | 'four-to-flush'
  | 'straight-completed'
  | 'four-to-straight'
  | 'board-paired'
  | 'overcard'
  | 'blank';

export interface BoardChange {
  kind: ChangeKind;
  /** Насколько карта опасна для того, кто вёл торговлю: 0..1. */
  danger: number;
  /** Человеческое описание для окна «Почему?». */
  text: string;
}

export function analyseBoard(board: readonly Card[]): BoardTexture {
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[suitOf(c)]++;
  const maxSuit = Math.max(...suits);

  const counts = new Map<number, number>();
  for (const c of board) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const paired = [...counts.values()].some((n) => n >= 2);
  const trips = [...counts.values()].some((n) => n >= 3);

  const ranks = new Set(board.map(rankOf));
  if (ranks.has(12)) ranks.add(-1); // туз снизу
  let straightPossible = false;
  let fourToStraight = false;
  for (let lo = -1; lo <= 8; lo++) {
    let have = 0;
    for (let k = 0; k < 5; k++) if (ranks.has(lo + k)) have++;
    if (have >= 4) fourToStraight = true;
    if (have >= 3) straightPossible = true;
  }

  const topRank = board.length ? Math.max(...board.map(rankOf)) : -1;

  let wetness = 0;
  if (maxSuit >= 3) wetness += maxSuit >= 4 ? 0.45 : 0.3;
  if (fourToStraight) wetness += 0.35;
  else if (straightPossible) wetness += 0.18;
  if (paired) wetness += 0.12;

  return {
    flushPossible: maxSuit >= 3,
    fourToFlush: maxSuit >= 4,
    paired,
    trips,
    straightPossible,
    fourToStraight,
    wetness: Math.min(1, wetness),
    topRank,
  };
}

/** Что сделала последняя карта: сравниваем доску до и после. */
export function boardChange(previous: readonly Card[], current: readonly Card[]): BoardChange {
  if (previous.length === 0 || current.length <= previous.length) {
    return { kind: 'blank', danger: 0, text: 'Доска не изменилась.' };
  }
  const before = analyseBoard(previous);
  const after = analyseBoard(current);
  const fresh = current[current.length - 1];

  if (after.flushPossible && !before.flushPossible) {
    return {
      kind: 'flush-completed',
      danger: 0.95,
      text: 'Пришла третья карта одной масти — флеш стал возможен.',
    };
  }
  if (after.fourToFlush && !before.fourToFlush) {
    return {
      kind: 'four-to-flush',
      danger: 0.9,
      text: 'На доске четыре карты одной масти — флеш теперь у очень многих.',
    };
  }
  if (after.fourToStraight && !before.fourToStraight) {
    return {
      kind: 'straight-completed',
      danger: 0.8,
      text: 'Карта достроила очевидный стрит.',
    };
  }
  if (after.straightPossible && !before.straightPossible) {
    return {
      kind: 'four-to-straight',
      danger: 0.45,
      text: 'Доска стала связнее — появились стрит-дро.',
    };
  }
  if (after.paired && !before.paired) {
    return {
      kind: 'board-paired',
      danger: 0.5,
      text: 'Доска спарилась — возможны трипс и фулл-хаус.',
    };
  }
  if (rankOf(fresh) > before.topRank) {
    return {
      kind: 'overcard',
      danger: 0.4,
      text: 'Пришла карта старше всей прежней доски.',
    };
  }
  return { kind: 'blank', danger: 0.08, text: 'Карта почти ничего не изменила.' };
}

/**
 * Делает ли эта комбинация ту руку, которую доска только что позволила.
 * Нужно, чтобы усилить в диапазоне именно тех, кто «доехал».
 */
export function completesChange(
  cards: readonly Card[],
  board: readonly Card[],
  change: ChangeKind,
): boolean {
  if (change === 'flush-completed' || change === 'four-to-flush') {
    const suits = [0, 0, 0, 0];
    for (const c of board) suits[suitOf(c)]++;
    const flushSuit = suits.findIndex((n) => n >= 3);
    if (flushSuit < 0) return false;
    const mine = cards.filter((c) => suitOf(c) === flushSuit).length;
    return suits[flushSuit] + mine >= 5;
  }
  if (change === 'straight-completed' || change === 'four-to-straight') {
    const ranks = new Set([...board, ...cards].map(rankOf));
    if (ranks.has(12)) ranks.add(-1);
    for (let lo = -1; lo <= 8; lo++) {
      let have = 0;
      for (let k = 0; k < 5; k++) if (ranks.has(lo + k)) have++;
      if (have === 5) return true;
    }
    return false;
  }
  if (change === 'board-paired') {
    const counts = new Map<number, number>();
    for (const c of board) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
    const pairedRank = [...counts.entries()].find(([, n]) => n >= 2)?.[0];
    return cards.some((c) => rankOf(c) === pairedRank) || cards[0] === cards[1];
  }
  if (change === 'overcard') {
    const top = Math.max(...board.map(rankOf));
    return cards.some((c) => rankOf(c) === top);
  }
  return false;
}

/** Доска после указанной улицы. */
export function boardAt(board: readonly Card[], street: 'flop' | 'turn' | 'river'): Card[] {
  const n = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  return board.slice(0, Math.min(n, board.length));
}
