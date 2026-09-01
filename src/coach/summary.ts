/**
 * Итог сессии: не двадцать замечаний, а максимум три.
 *
 * Выводы строятся из уже посчитанных оценок, а не из принадлежности к
 * категории. Ситуация «большой банк с одной парой» сама по себе не ошибка —
 * ошибкой её делает низкая оценка конкретного решения.
 */

import { CATEGORY_TITLES, type CategoryId } from './categories';
import type { DecisionRecord } from '../app/trainer';

const GOOD = 7.5;
const MISTAKE = 5;

export interface SessionInsight {
  text: string;
  tone: 'good' | 'bad' | 'neutral';
}

export interface SessionSummary {
  insights: SessionInsight[];
  /** Что предлагается потренировать в следующий раз. Рекомендация, не команда. */
  focus: CategoryId | null;
  focusReason: string;
}

interface Bucket {
  category: CategoryId;
  total: number;
  good: number;
  bad: number;
}

function buckets(records: DecisionRecord[]): Bucket[] {
  const map = new Map<CategoryId, Bucket>();
  for (const r of records) {
    for (const c of r.categories) {
      const b = map.get(c) ?? { category: c, total: 0, good: 0, bad: 0 };
      b.total += 1;
      if (r.verdict.score >= GOOD) b.good += 1;
      if (r.verdict.score < MISTAKE) b.bad += 1;
      map.set(c, b);
    }
  }
  return [...map.values()];
}

/** Минимум ситуаций, при котором вообще стоит что-то говорить о категории. */
const MIN_TO_MENTION = 3;

export function buildSessionSummary(records: DecisionRecord[]): SessionSummary {
  if (records.length === 0) {
    return { insights: [], focus: null, focusReason: '' };
  }

  const list = buckets(records).filter((b) => b.total >= MIN_TO_MENTION);
  const insights: SessionInsight[] = [];

  // 1. Самое дорогое: где ошибок больше всего.
  const worst = [...list].sort((a, b) => b.bad - a.bad || b.total - a.total)[0];
  if (worst && worst.bad > 0) {
    insights.push({
      tone: 'bad',
      text: badText(worst),
    });
  }

  // 2. Где всё хорошо — это тоже надо сказать.
  const best = [...list]
    .filter((b) => b !== worst && b.good === b.total)
    .sort((a, b) => b.total - a.total)[0];
  if (best) {
    insights.push({
      tone: 'good',
      text: `Зато ${goodText(best)}`,
    });
  }

  // 3. Второе по величине больное место, если оно есть.
  const second = [...list]
    .filter((b) => b !== worst && b.bad > 0)
    .sort((a, b) => b.bad - a.bad)[0];
  if (second && insights.length < 3) {
    insights.push({ tone: 'bad', text: badText(second) });
  }

  // Ни одна категория не набрала достаточно ситуаций. Тогда говорим про
  // сессию целиком — но честно: если слабые решения были, молчать о них
  // нельзя, даже когда сказать, где именно течёт, ещё не на чем.
  if (insights.length === 0) {
    const total = records.length;
    const good = records.filter((r) => r.verdict.score >= GOOD).length;
    const weak = records.filter((r) => r.verdict.score < MISTAKE).length;
    if (weak > 0) {
      insights.push({
        tone: 'neutral',
        text: weak === 1
          ? `Одно слабое решение из ${total}. По одному случаю вывод делать рано — `
            + 'сыграй ещё, и станет видно, повторяется ли это.'
          : `Слабых решений ${weak} из ${total}, и все в разных ситуациях. `
            + 'По одному-двум случаям вывод делать рано: сыграй ещё, и станет видно, что повторяется.',
      });
    } else {
      insights.push({
        tone: good === total ? 'good' : 'neutral',
        text: good === total
          ? `Все ${total} решений — на уровне. Хорошая сессия.`
          : `Грубых ошибок не было: ${good} из ${total} решений хорошие, остальные пограничные.`,
      });
    }
  }

  const focusBucket = worst && worst.bad > 0 ? worst : null;
  return {
    insights: insights.slice(0, 3),
    focus: focusBucket?.category ?? null,
    focusReason: focusBucket
      ? `${focusBucket.bad} из ${focusBucket.total} решений в этой ситуации оказались слабыми.`
      : '',
  };
}

function badText(b: Bucket): string {
  const times = b.bad === 1 ? 'один раз' : b.bad === 2 ? 'дважды' : `${b.bad} раза`;
  switch (b.category) {
    case 'big-pot-one-pair':
      return `Ты ${times} переплатил с одной парой в крупном банке.`;
    case 'btn-open':
      return `Ты ${times} пропустил выгодное открытие с баттона.`;
    case 'bb-defence':
      return `Ты ${times} слишком легко расстался с большим блайндом.`;
    case 'three-bet':
      return `Ты ${times} сыграл пассивно там, где напрашивалось повышение.`;
    case 'flop-in-position':
      return `Ты ${times} осторожничал на флопе в позиции.`;
    case 'multiway':
      return `Ты ${times} слишком активно играл банк на троих и больше.`;
    case 'delayed-cbet':
      return `Ты ${times} не воспользовался тем, что на флопе никто не поставил.`;
    case 'river-value':
      return `Ты ${times} пропустил небольшую ставку на ривере ради оплаты.`;
    case 'check-raise':
      return `Ты ${times} упустил чек-рейз с сильной рукой.`;
    case 'bet-sizing':
      return `Ты ${times} выбрал неудачный размер ставки.`;
  }
}

function goodText(b: Bucket): string {
  const n = b.total;
  switch (b.category) {
    case 'btn-open': return `все ${n} возможности открыть баттон ты использовал.`;
    case 'bb-defence': return `большой блайнд ты защищал правильно во всех ${n} случаях.`;
    case 'big-pot-one-pair': return `в крупных банках с одной парой ты ${n} раз сыграл аккуратно.`;
    case 'river-value': return `на ривере ты ${n} раз не упустил оплату.`;
    case 'bet-sizing': return `размеры ставок все ${n} раз были удачными.`;
    default: return `${CATEGORY_TITLES[b.category].toLowerCase()} — все ${n} решений хорошие.`;
  }
}
