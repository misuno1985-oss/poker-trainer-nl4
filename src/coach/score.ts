/**
 * Из разницы в ожидаемом результате — в оценку от 0 до 10.
 *
 * Главное требование: близкие решения должны получать близкие оценки. Если
 * колл и фолд почти равны, это 8 и 7.5, а не 10 и 3. Кривая плавная, без
 * ступенек, поэтому «почти правильно» никогда не превращается в «провал».
 *
 * Выбор действия и его размер оцениваются отдельно: правильная ставка не
 * должна получать двойку из-за того, что она вдвое больше нужного.
 */

import type { Candidate, Certainty, DecisionSnapshot } from './types';

/** Масштаб, в котором меряется разница: банк, но не меньше пары блайндов. */
function scale(snap: DecisionSnapshot): number {
  return Math.max(snap.pot, 4 * snap.bigBlind);
}

/** Плавный перевод отставания в баллы. Отставание 0 → 10, четверть банка → ~4.5. */
export function scoreFromGap(gap: number): number {
  const s = 10 * Math.exp(-3.2 * Math.max(0, gap));
  return Math.round(Math.max(1, Math.min(10, s)) * 10) / 10;
}

export interface Scores {
  actionScore: number;
  sizingScore: number | null;
  score: number;
  certainty: Certainty;
  /** Лучший вариант того же типа, что выбрал герой. */
  bestOfSameKind: Candidate | null;
}

export function buildScores(
  snap: DecisionSnapshot,
  candidates: Candidate[],
  chosen: Candidate,
  best: Candidate,
): Scores {
  const norm = scale(snap);

  // Насколько лучший вариант каждого типа отстаёт от абсолютно лучшего.
  const sameKind = candidates.filter((c) => c.kind === chosen.kind);
  const bestOfSameKind =
    sameKind.length > 0 ? sameKind.reduce((a, b) => (b.ev > a.ev ? b : a)) : null;

  const actionGap = bestOfSameKind ? (best.ev - bestOfSameKind.ev) / norm : (best.ev - chosen.ev) / norm;
  const actionScore = scoreFromGap(actionGap);

  let sizingScore: number | null = null;
  if ((chosen.kind === 'bet' || chosen.kind === 'raise') && bestOfSameKind) {
    const sizingGap = (bestOfSameKind.ev - chosen.ev) / norm;
    sizingScore = scoreFromGap(sizingGap);
  }

  const score =
    sizingScore === null
      ? actionScore
      : Math.round((actionScore * 0.65 + sizingScore * 0.35) * 10) / 10;

  return {
    actionScore,
    sizingScore,
    score,
    certainty: certaintyOf(candidates, norm),
    bestOfSameKind,
  };
}

/**
 * Насколько уверенно вообще можно говорить о «правильном» ходе.
 * Считается по разрыву между лучшими вариантами РАЗНЫХ типов: если ставка и
 * колл почти равны, никакой рекомендации с уверенностью дать нельзя.
 */
function certaintyOf(candidates: Candidate[], norm: number): Certainty {
  const bestByKind = new Map<string, number>();
  for (const c of candidates) {
    const prev = bestByKind.get(c.kind);
    if (prev === undefined || c.ev > prev) bestByKind.set(c.kind, c.ev);
  }
  const values = [...bestByKind.values()].sort((a, b) => b - a);
  if (values.length < 2) return 'clear';
  const gap = (values[0] - values[1]) / norm;
  // Пороги нарочно широкие: лучше честно сказать «примерно одно и то же»,
  // чем выдать уверенную рекомендацию там, где разница в пару центов.
  if (gap < 0.05) return 'close';
  if (gap < 0.13) return 'unclear';
  return 'clear';
}

/**
 * Насколько надёжны данные о соперниках в этой конкретной ситуации.
 * Берётся выборка именно по той улице, о которой идёт речь.
 */
export function dataConfidence(snap: DecisionSnapshot): { level: 'good' | 'thin' | 'none'; sample: number } {
  if (snap.opponents.length === 0) return { level: 'none', sample: 0 };

  const samples = snap.opponents.map((o) => {
    const s = o.profile.samples;
    switch (snap.street) {
      case 'preflop':
        return snap.preflopLevel >= 2 ? s.threeBet : s.open;
      case 'flop':
        return s.flopVsBet;
      case 'turn':
        return s.turnVsBet;
      case 'river':
        return s.riverVsBet;
      default:
        return s.flops;
    }
  });

  const min = Math.min(...samples);
  if (min >= 60) return { level: 'good', sample: min };
  if (min >= 20) return { level: 'thin', sample: min };
  return { level: 'none', sample: min };
}
