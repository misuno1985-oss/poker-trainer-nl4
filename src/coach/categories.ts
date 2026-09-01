/**
 * К какому типу ситуаций относится решение.
 *
 * Категория — это КОНТЕКСТ, а не приговор. Она отвечает на вопрос «какого рода
 * решение сейчас принимается», и ничего не говорит о том, хорошее оно или
 * плохое. Ошибку определяет только оценка из ev.ts.
 *
 * Нужна для двух вещей: считать прогресс по слабым местам и подбирать
 * ситуации в режиме тренировки. Ни в том, ни в другом случае принадлежность к
 * категории сама по себе не должна снижать оценку.
 */

import { analyse as analyseHand } from '../bots/strength';
import { preflopPercentile } from '../bots/decide';
import type { DecisionSnapshot } from './types';

export type CategoryId =
  | 'big-pot-one-pair'
  | 'btn-open'
  | 'bb-defence'
  | 'three-bet'
  | 'flop-in-position'
  | 'multiway'
  | 'delayed-cbet'
  | 'river-value'
  | 'check-raise'
  | 'bet-sizing';

export const CATEGORY_TITLES: Record<CategoryId, string> = {
  'big-pot-one-pair': 'Большой банк с одной парой',
  'btn-open': 'Открытие с баттона',
  'bb-defence': 'Защита большого блайнда',
  'three-bet': '3-бет',
  'flop-in-position': 'Флоп в позиции',
  multiway: 'Банк на троих и больше',
  'delayed-cbet': 'Отложенная ставка',
  'river-value': 'Ставка на ривере',
  'check-raise': 'Чек-рейз',
  'bet-sizing': 'Размер ставки',
};

/** Короткое пояснение для экрана прогресса и меню тренировки. */
export const CATEGORY_HINTS: Record<CategoryId, string> = {
  'big-pot-one-pair': 'Одна пара, когда банк уже вырос или соперник повысил повторно.',
  'btn-open': 'Все сбросили, ты на баттоне — открывать или пропускать.',
  'bb-defence': 'Ты в большом блайнде, кто-то открыл — защищаться или нет.',
  'three-bet': 'Перед тобой одно повышение: поднять, уравнять или сбросить.',
  'flop-in-position': 'Ты поднимал до флопа, ходишь последним, соперник проверил.',
  multiway: 'В банке трое и больше — блеф работает заметно хуже.',
  'delayed-cbet': 'На флопе никто не поставил, идёт тёрн.',
  'river-value': 'Ривер, ты ходишь первым и у тебя готовая рука.',
  'check-raise': 'Ты проверил, соперник поставил.',
  'bet-sizing': 'Любая твоя ставка или повышение — насколько удачен размер.',
};

export const ALL_CATEGORIES: CategoryId[] = Object.keys(CATEGORY_TITLES) as CategoryId[];

/** Сбросили ли все до героя. */
function foldedToHero(snap: DecisionSnapshot): boolean {
  const pf = snap.history.filter((a) => a.street === 'preflop' && a.kind !== 'post');
  return pf.length > 0 && pf.every((a) => a.kind === 'fold');
}

function heroCheckedThisStreet(snap: DecisionSnapshot): boolean {
  return snap.history.some(
    (a) => a.street === snap.street && a.seat === snap.heroSeat && a.kind === 'check',
  );
}

function opponentAggression(snap: DecisionSnapshot): number {
  return snap.history.filter(
    (a) => a.street === snap.street && a.seat !== snap.heroSeat &&
      (a.kind === 'bet' || a.kind === 'raise'),
  ).length;
}

/**
 * Все категории, к которым относится ЭТА точка принятия решения.
 * Считается по снимку — то есть до того, как герой что-либо сделал.
 */
export function categorise(
  snap: DecisionSnapshot,
  actionKind?: 'fold' | 'check' | 'call' | 'bet' | 'raise',
): CategoryId[] {
  const out: CategoryId[] = [];
  const postflop = snap.board.length >= 3;

  if (snap.street === 'preflop') {
    if (snap.heroPosition === 'BTN' && foldedToHero(snap)) out.push('btn-open');
    if (snap.heroPosition === 'BB' && snap.preflopLevel === 2) out.push('bb-defence');
    if (snap.preflopLevel === 2 && preflopPercentile(snap.heroCards) < 0.35) out.push('three-bet');
  } else {
    const strength = analyseHand(snap.heroCards, snap.board);
    const onePair =
      (strength.category === 1 || strength.overpair || strength.topPair) && !strength.boardPlays;

    if (onePair && (snap.pot >= 25 * snap.bigBlind || opponentAggression(snap) >= 2)) {
      out.push('big-pot-one-pair');
    }
    if (snap.activeCount >= 3) out.push('multiway');
    if (
      snap.street === 'flop' && snap.heroIsPreflopAggressor &&
      snap.heroInPosition && snap.activeCount === 2 && snap.legal.canBet
    ) {
      out.push('flop-in-position');
    }
    if (snap.street === 'turn' && snap.heroIsPreflopAggressor && snap.legal.canBet) {
      const flopChecks = snap.history.filter((a) => a.street === 'flop' && a.kind === 'check');
      if (flopChecks.length >= 2) out.push('delayed-cbet');
    }
    if (snap.street === 'river' && snap.legal.canBet && strength.percentile >= 0.55) {
      out.push('river-value');
    }
    if (heroCheckedThisStreet(snap) && snap.legal.canRaise) out.push('check-raise');
  }

  if (postflop && (actionKind === 'bet' || actionKind === 'raise')) out.push('bet-sizing');
  return out;
}

/** Насколько ситуация подходит для тренировки этой категории: 0 — не подходит. */
export function categoryFit(snap: DecisionSnapshot, category: CategoryId): number {
  return categorise(snap).includes(category) ? 1 : 0;
}
