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
import type { Candidate, CoachVerdict, DecisionSnapshot } from './types';

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

  const best = analysis.candidates[0];
  const scores = buildScores(snap, analysis.candidates, chosen, best);
  const data = dataConfidence(snap);

  const confidence = {
    data: data.level,
    sample: data.sample,
    decision: scores.certainty,
  };

  const brief = buildBrief(snap, chosen, best, scores);
  const why = buildWhy(snap, analysis, chosen, scores, confidence);
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

export { captureSnapshot } from './snapshot';
export { actionLabel } from './explain';
export { inferRange, describeRange } from './range';
export { equityVsRanges } from './equity';
export type {
  CoachVerdict, DecisionSnapshot, Candidate, Confidence, Brief, WhySection, LeakNote, OpponentView,
} from './types';
