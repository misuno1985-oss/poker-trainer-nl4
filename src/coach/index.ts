/**
 * Тренер: оценка одного решения героя.
 *
 * На входе — только слепок того, что герой видел, и его действие. Закрытых
 * карт соперников здесь нет: их не существует в типе `DecisionSnapshot`.
 *
 * Порядок намеренно такой:
 *   1. обычная покерная оценка всех разумных вариантов (ev.ts);
 *   2. перевод разницы в баллы, отдельно за выбор и за размер (score.ts);
 *   3. и только потом — примечания о личных утечках (leaks.ts).
 *
 * Утечки не меняют оценку. Иначе «одна пара и второй рейз» превратилось бы в
 * жёсткое правило, а этого делать нельзя: против разных соперников один и тот
 * же второй рейз означает разное.
 */

import { analyse, evalAggressive, matchCandidate } from './ev';
import { buildScores, dataConfidence } from './score';
import { buildBrief, buildWhy } from './explain';
import { detectLeaks } from './leaks';
import { buildScenarios, rolloutAction } from './rollout';
import { analyse as analyseHand } from '../bots/strength';
import { boardAt, boardChange } from './texture';
import type { Candidate, CoachVerdict, DecisionSnapshot } from './types';

/** Сколько раз доигрывать раздачу. Компромисс между точностью и отзывчивостью. */
const ROLLOUT_SIMS = 220;
/** Сколько вариантов проверять доигрыванием. */
const ROLLOUT_CANDIDATES = 4;

/**
 * Нужно ли вообще доигрывать. Одноуличной оценки достаточно на ривере и в
 * очевидных местах; доигрывание включается там, где «что будет дальше» реально
 * меняет ответ.
 */
export function shouldRollout(snap: DecisionSnapshot, candidates: Candidate[]): boolean {
  if (snap.street !== 'flop' && snap.street !== 'turn') return false;
  if (candidates.length < 2) return false;

  const norm = Math.max(snap.pot, 4 * snap.bigBlind);
  const byKind = new Map<string, number>();
  for (const c of candidates) {
    const prev = byKind.get(c.kind);
    if (prev === undefined || c.ev > prev) byKind.set(c.kind, c.ev);
  }
  const top = [...byKind.values()].sort((a, b) => b - a);

  // 1. Верхние варианты близки — тут одноуличная модель и ошибается чаще всего.
  if (top.length >= 2 && (top[0] - top[1]) / norm < 0.12) return true;
  // 2. Банк уже крупный: цена ошибки высока.
  if (snap.pot >= 25 * snap.bigBlind) return true;
  // 3. У героя дро — его ценность вся в будущих улицах.
  const strength = analyseHand(snap.heroCards, snap.board);
  if (strength.draws.outs >= 8) return true;
  // 4. Свежая карта сильно поменяла доску.
  const previous = snap.street === 'turn' ? boardAt(snap.board, 'flop') : [];
  if (previous.length && boardChange(previous, boardAt(snap.board, 'turn')).danger >= 0.7) return true;
  // 5. Рассматривается крупное повышение или ва-банк.
  const big = candidates.some(
    (c) => (c.kind === 'bet' || c.kind === 'raise') && (c.total ?? 0) - snap.legal.streetCommit >= snap.pot * 0.8,
  );
  if (big) return true;
  // 6. Одна пара против серьёзной агрессии — самая дорогая ситуация в базе.
  const onePair = strength.category === 1 || strength.topPair || strength.overpair;
  const aggression = snap.history.filter(
    (a) => a.street === snap.street && a.seat !== snap.heroSeat && (a.kind === 'bet' || a.kind === 'raise'),
  ).length;
  if (onePair && aggression >= 1 && snap.legal.toCall > snap.pot * 0.4) return true;

  return false;
}

export interface HeroAction {
  kind: Candidate['kind'];
  total?: number;
}

export function evaluateDecision(snap: DecisionSnapshot, action: HeroAction): CoachVerdict {
  const analysis = analyse(snap);

  // Герой мог поставить сумму, которой нет среди кандидатов, — считаем её отдельно.
  let chosen = matchCandidate(analysis.candidates, action.kind, action.total);
  if (
    (action.kind === 'bet' || action.kind === 'raise') &&
    action.total !== undefined &&
    (!chosen || chosen.total !== action.total)
  ) {
    chosen = evalAggressive(
      snap, action.kind, action.total, analysis.rangeList, analysis.rawEquity, analysis.seed,
    );
    analysis.candidates.push(chosen);
    analysis.candidates.sort((a, b) => b.ev - a.ev);
  }
  if (!chosen) {
    // Такого действия в списке нет вообще — берём худший вариант как запасной.
    chosen = analysis.candidates[analysis.candidates.length - 1];
  }

  // Доигрывание там, где одноуличной оценки мало. Оно уточняет числа, но не
  // заменяет их: если разница внутри погрешности, оставляем как было.
  let rolledOut = false;
  if (shouldRollout(snap, analysis.candidates)) {
    const scenarios = buildScenarios(snap, analysis.rangeList, analysis.seed, ROLLOUT_SIMS);
    if (scenarios.length >= ROLLOUT_SIMS / 2) {
      const targets = pickForRollout(analysis.candidates, chosen);
      const done: Candidate[] = [];
      for (const c of targets) {
        const r = rolloutAction(
          snap, scenarios,
          { kind: c.kind, total: c.total } as never,
          analysis.seed + 17,
        );
        if (r.sims > 0) {
          c.ev = r.ev;
          c.detail.rollout = { sims: r.sims, stdErr: r.stdErr };
          done.push(c);
          rolledOut = true;
        }
      }
      // Сравнивать доигранный вариант с недоигранным нельзя: это две разные
      // шкалы. Быстрая оценка работает как фильтр, решение принимается по
      // доигрыванию, поэтому в сравнении остаются только доигранные варианты.
      if (done.length >= 2) {
        analysis.candidates = done;
      } else {
        for (const c of done) delete c.detail.rollout;
        rolledOut = false;
      }
      analysis.candidates.sort((a, b) => b.ev - a.ev);
    }
  }

  const best = analysis.candidates[0];
  const scores = buildScores(snap, analysis.candidates, chosen, best);
  const data = dataConfidence(snap);

  const confidence = {
    data: data.level,
    sample: data.sample,
    decision: scores.certainty,
  };

  const brief = buildBrief(snap, chosen, best, scores);
  const why = buildWhy(snap, analysis, chosen, scores, confidence, rolledOut);
  const leakNotes = detectLeaks(snap, chosen, best);

  return {
    chosen,
    best,
    ranked: analysis.candidates,
    actionScore: scores.actionScore,
    sizingScore: scores.sizingScore,
    score: scores.score,
    confidence,
    brief,
    why,
    leakNotes,
  };
}

/**
 * Какие варианты доигрывать: выбранный, обязательно пассивные (фолд и чек —
 * это базовая линия, без них не с чем сравнивать) и лучшие по быстрой оценке.
 */
function pickForRollout(candidates: Candidate[], chosen: Candidate): Candidate[] {
  const out: Candidate[] = [chosen];
  const add = (c: Candidate | undefined) => {
    if (c && !out.includes(c)) out.push(c);
  };
  add(candidates.find((c) => c.kind === 'fold'));
  add(candidates.find((c) => c.kind === 'check'));
  for (const c of candidates) {
    if (out.length >= ROLLOUT_CANDIDATES + 2) break;
    add(c);
  }
  return out;
}

export { captureSnapshot } from './snapshot';
export { actionLabel } from './explain';
export { inferRange, describeRange } from './range';
export { equityVsRanges } from './equity';
export type {
  CoachVerdict, DecisionSnapshot, Candidate, Confidence, Brief, WhySection, LeakNote, OpponentView,
} from './types';
