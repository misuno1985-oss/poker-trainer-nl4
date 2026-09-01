/**
 * Стеки за столом.
 *
 * STANDARD — у всех ровно 100 bb ($4.00).
 *
 * REALISTIC — выборка из реального распределения стеков на NL4 из базы
 * (26 218 наблюдений). Не равномерный разброс «от $2 до $8», а именно та
 * форма, которая встречается за столом: медиана 114 bb, заметный пик ровно на
 * 100 bb (стандартный бай-ин), длинный хвост вправо. Хвост обрезан на 250 bb —
 * дальше начинается игра, непохожая на обычный NL4.
 */

import type { Rng } from './rng';

/** Квантили стека в больших блайндах: [доля игроков, стек]. */
const QUANTILES: Array<[number, number]> = [
  [0.00, 30], [0.05, 38], [0.10, 54], [0.15, 74], [0.20, 87],
  [0.25, 97], [0.30, 100], [0.35, 100], [0.40, 104], [0.45, 108],
  [0.50, 114], [0.55, 122], [0.60, 131], [0.65, 143], [0.70, 158],
  [0.75, 174], [0.80, 188], [0.85, 209], [0.90, 239], [0.95, 250],
  [1.00, 250],
];

export type StackMode = 'standard' | 'realistic';

/** Стек в центах для заданного режима. */
export function sampleStack(mode: StackMode, rng: Rng, bigBlind: number): number {
  if (mode === 'standard') return 100 * bigBlind;

  const u = rng();
  let lo = QUANTILES[0];
  let hi = QUANTILES[QUANTILES.length - 1];
  for (let i = 1; i < QUANTILES.length; i++) {
    if (u <= QUANTILES[i][0]) {
      lo = QUANTILES[i - 1];
      hi = QUANTILES[i];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const t = span > 0 ? (u - lo[0]) / span : 0;
  const bb = lo[1] + t * (hi[1] - lo[1]);
  return Math.max(20 * bigBlind, Math.round(bb * bigBlind));
}

/** $1.23 — деньги показываем в долларах, как в клиенте. */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** «12.5bb» — для подписей, где нужен масштаб, а не сумма. */
export function inBB(cents: number, bigBlind: number): string {
  const v = cents / bigBlind;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}bb`;
}
