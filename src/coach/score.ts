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

/**
 * Плавный перевод отставания в баллы.
 *
 * Кривая подобрана так, чтобы близкие решения оставались близкими по оценке
 * (отставание в 5% банка — это ещё 8 из 10), но потеря целой доли банка уже
 * читалась как ошибка, а не как «почти правильно».
 *
 *   0.00 → 10      0.05 → 8.1     0.10 → 6.6
 *   0.15 → 5.3     0.25 → 3.5     0.50 → 1.2
 */
export function scoreFromGap(gap: number): number {
  const s = 10 * Math.exp(-4.2 * Math.max(0, gap));
  return Math.round(Math.max(1, Math.min(10, s)) * 10) / 10;
}

export interface Scores {
  actionScore: number;
  sizingScore: number | null;
  score: number;
  /** Насколько разошлись два лучших РАЗНЫХ действия. */
  certainty: Certainty;
  /** Насколько далёк от лучшего именно ВЫБРАННЫЙ ход. */
  chosenCertainty: Certainty;
  /** Отставание выбранного хода от лучшего, в долях банка. */
  chosenGap: number;
  /** Лучший вариант того же типа, что выбрал герой. */
  bestOfSameKind: Candidate | null;
  /** Лучший вариант каждого типа, по убыванию. */
  byKind: Candidate[];
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
  // Оценивать размер имеет смысл, только если есть с чем сравнивать. Один
  // уцелевший вариант этого типа дал бы бессмысленную десятку и завысил итог.
  if ((chosen.kind === 'bet' || chosen.kind === 'raise') && bestOfSameKind && sameKind.length >= 2) {
    const sizingGap = (bestOfSameKind.ev - chosen.ev) / norm;
    sizingScore = scoreFromGap(sizingGap);
  }

  // Правильное действие не должно получать двойку из-за размера — но и
  // удачный размер не должен вытягивать заведомо неверный выбор. Поэтому
  // размер учитывается, только когда сам выбор хотя бы приемлем.
  const score =
    sizingScore === null || actionScore < 5
      ? actionScore
      : Math.round((actionScore * 0.65 + sizingScore * 0.35) * 10) / 10;

  const chosenGap = (best.ev - chosen.ev) / norm;

  return {
    actionScore,
    sizingScore,
    score,
    certainty: certaintyOf(candidates, norm),
    chosenCertainty: bandOf(chosenGap),
    chosenGap,
    bestOfSameKind,
    byKind: bestPerKind(candidates),
  };
}

/** Лучший вариант каждого типа действия, по убыванию ожидаемого результата. */
export function bestPerKind(candidates: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of candidates) {
    const prev = map.get(c.kind);
    if (!prev || c.ev > prev.ev) map.set(c.kind, c);
  }
  return [...map.values()].sort((a, b) => b.ev - a.ev);
}

function bandOf(gap: number): Certainty {
  if (gap < 0.05) return 'close';
  if (gap < 0.13) return 'unclear';
  return 'clear';
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
  // Пороги нарочно широкие: лучше честно сказать «примерно одно и то же»,
  // чем выдать уверенную рекомендацию там, где разница в пару центов.
  return bandOf((values[0] - values[1]) / norm);
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
