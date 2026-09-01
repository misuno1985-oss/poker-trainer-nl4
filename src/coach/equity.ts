/**
 * Доля героя против МОДЕЛИ диапазонов соперников.
 *
 * Настоящие карты соперников сюда не приходят — только восстановленные
 * диапазоны. Поэтому число всегда приблизительное, и это правильно: герой в
 * момент решения тоже не знает точного ответа.
 *
 * На ривере считается точно перебором. На более ранних улицах — Монте-Карло с
 * фиксированным зерном, чтобы один и тот же снимок всегда давал один и тот же
 * ответ (без этого нельзя было бы проверить отсутствие подглядывания).
 */

import { NUM_CARDS, type Card } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { makeRng } from '../game/rng';
import type { WeightedRange } from './range';

const DEFAULT_SAMPLES = 4000;

/** Кумулятивные веса для быстрой выборки комбинации из диапазона. */
function cumulative(range: WeightedRange): number[] {
  const out = new Array<number>(range.length);
  let sum = 0;
  for (let i = 0; i < range.length; i++) {
    sum += range[i].weight;
    out[i] = sum;
  }
  return out;
}

function pickCombo(range: WeightedRange, cum: number[], r: number): Card[] {
  const target = r * cum[cum.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return range[lo].cards;
}

/**
 * Доля героя против одного или нескольких диапазонов.
 * Ничьи считаются как доля банка, а не как проигрыш.
 */
export function equityVsRanges(
  heroCards: readonly Card[],
  board: readonly Card[],
  ranges: WeightedRange[],
  seed = 12345,
  samples = DEFAULT_SAMPLES,
): number {
  if (ranges.length === 0) return 1;

  if (board.length === 5) return exactRiver(heroCards, board, ranges);

  const rng = makeRng(seed);
  const cums = ranges.map(cumulative);
  const toCome = 5 - board.length;

  const dead = new Uint8Array(NUM_CARDS);
  for (const c of heroCards) dead[c] = 1;
  for (const c of board) dead[c] = 1;

  const fullBoard: Card[] = new Array(5);
  for (let i = 0; i < board.length; i++) fullBoard[i] = board[i];

  let total = 0;
  let won = 0;

  outer: for (let s = 0; s < samples; s++) {
    const used = dead.slice();
    const holdings: Card[][] = [];

    for (let i = 0; i < ranges.length; i++) {
      let combo: Card[] | null = null;
      // Комбинация может конфликтовать с уже выбранными — пробуем несколько раз.
      for (let attempt = 0; attempt < 12; attempt++) {
        const candidate = pickCombo(ranges[i], cums[i], rng());
        if (!used[candidate[0]] && !used[candidate[1]]) {
          combo = candidate;
          break;
        }
      }
      if (!combo) continue outer;
      used[combo[0]] = 1;
      used[combo[1]] = 1;
      holdings.push(combo);
    }

    for (let i = 0; i < toCome; i++) {
      let c: Card;
      do {
        c = Math.floor(rng() * NUM_CARDS);
      } while (used[c]);
      used[c] = 1;
      fullBoard[board.length + i] = c;
    }

    const mine = evaluate([heroCards[0], heroCards[1], ...fullBoard]);
    let best = mine;
    let ties = 1;
    for (const h of holdings) {
      const v = evaluate([h[0], h[1], ...fullBoard]);
      if (v > best) {
        best = v;
        ties = 1;
      } else if (v === best) {
        ties += 1;
      }
    }
    if (mine === best) won += 1 / ties;
    total += 1;
  }

  return total === 0 ? 0.5 : won / total;
}

/** На ривере карты уже все известны — перебираем диапазон точно. */
function exactRiver(
  heroCards: readonly Card[],
  board: readonly Card[],
  ranges: WeightedRange[],
): number {
  const mine = evaluate([heroCards[0], heroCards[1], ...board]);

  // Точный перебор всех сочетаний диапазонов дорог при трёх соперниках,
  // поэтому точно считаем только один-на-один, остальное — тем же Монте-Карло.
  if (ranges.length > 1) {
    return equityVsRangesMulti(heroCards, board, ranges);
  }

  const used = new Uint8Array(NUM_CARDS);
  for (const c of heroCards) used[c] = 1;
  for (const c of board) used[c] = 1;

  let weight = 0;
  let score = 0;
  for (const combo of ranges[0]) {
    if (used[combo.cards[0]] || used[combo.cards[1]]) continue;
    const theirs = evaluate([combo.cards[0], combo.cards[1], ...board]);
    weight += combo.weight;
    if (mine > theirs) score += combo.weight;
    else if (mine === theirs) score += combo.weight / 2;
  }
  return weight === 0 ? 0.5 : score / weight;
}

function equityVsRangesMulti(
  heroCards: readonly Card[],
  board: readonly Card[],
  ranges: WeightedRange[],
): number {
  const rng = makeRng(4242);
  const cums = ranges.map(cumulative);
  const mine = evaluate([heroCards[0], heroCards[1], ...board]);
  const dead = new Uint8Array(NUM_CARDS);
  for (const c of heroCards) dead[c] = 1;
  for (const c of board) dead[c] = 1;

  let total = 0;
  let won = 0;
  outer: for (let s = 0; s < 3000; s++) {
    const used = dead.slice();
    let best = mine;
    let ties = 1;
    for (let i = 0; i < ranges.length; i++) {
      let combo: Card[] | null = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        const candidate = pickCombo(ranges[i], cums[i], rng());
        if (!used[candidate[0]] && !used[candidate[1]]) {
          combo = candidate;
          break;
        }
      }
      if (!combo) continue outer;
      used[combo[0]] = 1;
      used[combo[1]] = 1;
      const v = evaluate([combo[0], combo[1], ...board]);
      if (v > best) {
        best = v;
        ties = 1;
      } else if (v === best) {
        ties += 1;
      }
    }
    if (mine === best) won += 1 / ties;
    total += 1;
  }
  return total === 0 ? 0.5 : won / total;
}
