/**
 * Как достоинство карты выглядит НА ЭКРАНЕ.
 *
 * Внутри движка десятка — это `T`: одна буква, по ней удобно разбирать записи
 * вроде `T9s`, `TT`, `ATs`, и весь оценщик рук с диапазонами на этом стоит.
 * Игроку же привычнее видеть «10». Поэтому подмена живёт здесь, на самом
 * верхнем слое, и ниже интерфейса не проникает.
 */

import { RANKS, rankOf, type Card } from '../engine/cards';

/** Индекс десятки в `RANKS`. Считаем из самой строки, а не числом наугад. */
export const TEN = RANKS.indexOf('T');

export function rankLabel(rank: number): string {
  return rank === TEN ? '10' : RANKS[rank];
}

export function cardRankLabel(card: Card): string {
  return rankLabel(rankOf(card));
}

/** Десятке нужен свой класс: «10» вдвое шире любой другой подписи. */
export function isTen(card: Card): boolean {
  return rankOf(card) === TEN;
}
