/**
 * Сборка файла выгрузки: одно место на всё приложение.
 *
 * И кнопка сразу после сессии, и скачивание старой сессии из архива зовут
 * ровно эту функцию. Поэтому файл, полученный через три дня, совпадает с тем,
 * который скачался бы сразу после игры, — не по договорённости, а потому что
 * его собирает один и тот же код.
 */

import { buildSessionSummary } from '../coach/summary';
import { ALL_CATEGORIES, CATEGORY_TITLES, type CategoryId } from '../coach/categories';
import { PROFILES } from '../bots/profiles';
import type { DecisionRecord } from './trainer';
import type { Progress } from './progress';
import { isGood, isMistake } from './progress';
import { buildExport, exportFileName, type SessionLog } from './sessionLog';
import type { ArchiveRecord } from './sessionArchive';

/** Итог сессии в том виде, в каком его показывает экран. */
export interface Totals {
  score: number;
  net: number;
  good: number;
  borderline: number;
  mistakes: number;
  major: number;
  records: DecisionRecord[];
}

const RANK_TEXT = '23456789TJQKA';
const SUIT_TEXT = 'cdhs';
const cardLabel = (c: number) => (c < 0 ? '' : RANK_TEXT[c >> 2] + SUIT_TEXT[c & 3]);

function tallyFor(records: DecisionRecord[], c: CategoryId) {
  const hits = records.filter((r) => r.categories.includes(c));
  return {
    total: hits.length,
    good: hits.filter((r) => isGood(r.verdict.score)).length,
    mistakes: hits.filter((r) => isMistake(r.verdict.score)).length,
  };
}

export interface Bundle {
  fileName: string;
  payload: unknown;
  record: ArchiveRecord;
}

export function makeExport(
  log: SessionLog,
  totals: Totals,
  progress: Progress,
  now: number = Date.now(),
): Bundle {
  const summary = buildSessionSummary(totals.records);

  const input = {
    decisionScore: Number(totals.score.toFixed(2)),
    netCents: totals.net,
    good: totals.good,
    borderline: totals.borderline,
    mistakes: totals.mistakes,
    major: totals.major,
    insights: summary.insights,
    focus: summary.focus,
    focusReason: summary.focusReason,
    categories: ALL_CATEGORIES
      .map((c) => ({ id: c, title: CATEGORY_TITLES[c], ...tallyFor(totals.records, c) }))
      .filter((c) => c.total > 0),
    // Крупные ошибки именно этой сессии: их узнаём по зерну раздачи.
    majorMistakes: progress.mistakes
      .filter((m) => log.hands.some((h) => !h.isReplay && h.setup.seed === m.setup.seed))
      .map((m) => ({
        handNumber: m.setup.handNumber,
        street: m.street,
        scoreValue: m.score,
        heroCards: m.heroCards.map(cardLabel),
        board: m.board.map(cardLabel),
        position: m.position,
        villain: m.villain,
        did: m.did,
        better: m.better,
      })),
  };

  const payload = buildExport(log, input, PROFILES, now);
  const fileName = exportFileName(log, now);

  return {
    fileName,
    payload,
    record: {
      id: log.id,
      endedAt: log.endedAt,
      mode: log.mode,
      modeDetail: log.modeDetail,
      hands: log.hands.filter((h) => !h.isReplay).length,
      decisionScore: input.decisionScore,
      netCents: totals.net,
      majorMistakes: totals.major,
      focus: summary.focus,
      fileName,
      payload,
    },
  };
}
