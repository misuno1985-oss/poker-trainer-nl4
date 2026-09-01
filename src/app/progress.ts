/**
 * Прогресс обучения: что сохраняем между заходами и как считаем динамику.
 *
 * Хранится в localStorage. Записи компактные — по решению, а не по всей
 * раздаче, — иначе за пару тысяч рук хранилище закончится. Полные данные для
 * переигрывания хранятся только у крупных ошибок и только у последних.
 *
 * Главное правило отчётов: не показывать динамику на маленькой выборке.
 * «48% → 71%» на десяти ситуациях — это шум, а не прогресс.
 */

import type { CategoryId } from '../coach/categories';
import type { HandSetup } from './session';

const KEY = 'nl4-trainer-progress-v1';
/** Сколько решений держим в истории. Больше не нужно, а место экономит. */
const MAX_DECISIONS = 4000;
/** Сколько крупных ошибок храним целиком, чтобы их можно было переиграть. */
const MAX_MISTAKES = 30;

/** Компактная запись об одном решении. */
export interface DecisionEntry {
  /** Время, миллисекунды. */
  t: number;
  score: number;
  /** Категории ситуации. */
  c: CategoryId[];
  /** Ник главного соперника в этой точке. */
  v: string;
}

/** Крупная ошибка — с данными, достаточными для переигрывания. */
export interface MistakeEntry {
  t: number;
  score: number;
  street: string;
  /** Что сделал герой, человеческим текстом. */
  did: string;
  /** Что советовал тренер. */
  better: string;
  heroCards: number[];
  board: number[];
  position: string;
  villain: string;
  pot: number;
  categories: CategoryId[];
  /** Чтобы переиграть: описание раздачи и действия героя до этой точки. */
  setup: HandSetup;
  priorActions: Array<{ kind: string; total?: number }>;
}

export interface SessionEntry {
  t: number;
  hands: number;
  decisions: number;
  net: number;
  score: number;
  mode: string;
}

export interface Progress {
  version: 1;
  hands: number;
  decisions: DecisionEntry[];
  sessions: SessionEntry[];
  mistakes: MistakeEntry[];
  /** Решения против конкретных соперников: ник -> [сумма баллов, количество]. */
  vs: Record<string, [number, number]>;
}

function empty(): Progress {
  return { version: 1, hands: 0, decisions: [], sessions: [], mistakes: [], vs: {} };
}

export function loadProgress(): Progress {
  if (typeof localStorage === 'undefined') return empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Progress;
    if (parsed.version !== 1) return empty();
    return { ...empty(), ...parsed };
  } catch {
    // Повреждённые или недоступные данные не должны ронять приложение.
    return empty();
  }
}

export function saveProgress(p: Progress): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Место кончилось или запись запрещена — тренироваться это не мешает.
  }
}

export function resetProgress(): Progress {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(KEY);
    } catch { /* ignore */ }
  }
  return empty();
}

export function addDecision(p: Progress, entry: DecisionEntry, mistake?: MistakeEntry): Progress {
  p.decisions.push(entry);
  if (p.decisions.length > MAX_DECISIONS) p.decisions.splice(0, p.decisions.length - MAX_DECISIONS);

  if (entry.v) {
    const [sum, n] = p.vs[entry.v] ?? [0, 0];
    p.vs[entry.v] = [sum + entry.score, n + 1];
  }
  if (mistake) {
    p.mistakes.unshift(mistake);
    if (p.mistakes.length > MAX_MISTAKES) p.mistakes.length = MAX_MISTAKES;
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Отчёты                                                              */
/* ------------------------------------------------------------------ */

export const GOOD_SCORE = 7.5;
export const MISTAKE_SCORE = 5;
export const MAJOR_SCORE = 4;

export function isGood(score: number): boolean { return score >= GOOD_SCORE; }
export function isMistake(score: number): boolean { return score < MISTAKE_SCORE; }
export function isMajor(score: number): boolean { return score < MAJOR_SCORE; }

export function averageScore(entries: DecisionEntry[]): number | null {
  if (entries.length === 0) return null;
  return entries.reduce((s, e) => s + e.score, 0) / entries.length;
}

export interface Trend {
  category: CategoryId;
  /** Доля хороших решений в ранней половине, 0..1. */
  early: number | null;
  late: number | null;
  earlyCount: number;
  lateCount: number;
  /** Хватает ли данных, чтобы вообще говорить о динамике. */
  reliable: boolean;
}

/** Минимум ситуаций в каждой половине, ниже которого динамику не показываем. */
export const MIN_FOR_TREND = 25;

/**
 * Динамика по категории: как играл сначала и как играет сейчас.
 * Берутся первые и последние N ситуаций именно этой категории.
 */
export function trendFor(p: Progress, category: CategoryId, window = 100): Trend {
  const hits = p.decisions.filter((d) => d.c.includes(category));
  const half = Math.floor(hits.length / 2);
  const size = Math.min(window, half);

  if (size < MIN_FOR_TREND) {
    return {
      category,
      early: null,
      late: null,
      earlyCount: hits.length,
      lateCount: 0,
      reliable: false,
    };
  }
  const early = hits.slice(0, size);
  const late = hits.slice(-size);
  const share = (xs: DecisionEntry[]) => xs.filter((d) => isGood(d.score)).length / xs.length;
  return {
    category,
    early: share(early),
    late: share(late),
    earlyCount: size,
    lateCount: size,
    reliable: true,
  };
}

export interface CategoryTally {
  category: CategoryId;
  total: number;
  good: number;
  borderline: number;
  mistakes: number;
}

export function tally(entries: DecisionEntry[], category: CategoryId): CategoryTally {
  const hits = entries.filter((d) => d.c.includes(category));
  return {
    category,
    total: hits.length,
    good: hits.filter((d) => isGood(d.score)).length,
    borderline: hits.filter((d) => !isGood(d.score) && !isMistake(d.score)).length,
    mistakes: hits.filter((d) => isMistake(d.score)).length,
  };
}

/** Средний балл против каждого соперника; только там, где выборка достаточна. */
export function versusTable(p: Progress, minDecisions = 30): Array<{ name: string; score: number; n: number }> {
  return Object.entries(p.vs)
    .map(([name, [sum, n]]) => ({ name, score: sum / n, n }))
    .filter((x) => x.n >= minDecisions)
    .sort((a, b) => b.score - a.score);
}
