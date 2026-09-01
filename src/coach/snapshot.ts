/**
 * Граница между движком и тренером.
 *
 * Это ЕДИНСТВЕННЫЙ файл в `coach/`, которому можно знать про `HandState` и
 * `Session`. Он снимает слепок того, что герой видел перед своим ходом, и
 * дальше тренер работает только со слепком.
 *
 * Закрытые карты соперников сюда не попадают. Не «мы их не используем», а
 * буквально не копируются: в `OpponentView` для них нет поля.
 */

import { legalActions } from '../game/betting';
import { totalPot, type Position } from '../game/types';
import { profileFor } from '../bots/profiles';
import type { Session } from '../app/session';
import { HERO_SEAT } from '../app/session';
import type { DecisionSnapshot, OpponentView } from './types';

/** Порядок хода после флопа: кто ходит позже, тот в позиции. */
const POSTFLOP_ORDER: Position[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];

/**
 * Снять слепок, если сейчас ход героя.
 *
 * `heroSeat` обычно равен нулю — за столом герой всегда сидит там. Параметр
 * нужен для разбора реальных раздач из истории, где игрок сидел где придётся.
 */
export function captureSnapshot(
  session: Session,
  heroSeat: number = HERO_SEAT,
): DecisionSnapshot | null {
  const state = session.state;
  const legal = legalActions(state);
  if (!legal || legal.seat !== heroSeat) return null;

  const hero = state.players[heroSeat];

  let preflopAggressor = -1;
  let preflopLevel = 1;
  for (const a of state.log) {
    if (a.street !== 'preflop') continue;
    if (a.kind === 'raise') {
      preflopAggressor = a.seat;
      preflopLevel += 1;
    }
  }

  const opponents: OpponentView[] = state.players
    .filter((p) => p.seat !== heroSeat && !p.folded)
    .map((p) => ({
      seat: p.seat,
      name: p.name,
      // Профиль — это измеренная статистика. Карт в нём нет.
      profile: profileFor(p.name),
      position: p.position,
      stack: p.stack,
      streetCommit: p.streetCommit,
      handCommit: p.handCommit,
      folded: p.folded,
      allIn: p.allIn,
      isPreflopAggressor: p.seat === preflopAggressor,
    }));

  const effectiveStack = Math.min(
    hero.stack,
    ...opponents.filter((o) => !o.allIn).map((o) => o.stack),
    ...(opponents.every((o) => o.allIn) ? [hero.stack] : []),
  );

  const liveCommit = hero.handCommit + opponents.reduce((s, o) => s + o.handCommit, 0);

  return {
    handNumber: session.handNumber,
    street: state.street,
    heroSeat,
    button: state.button,
    seatCount: state.players.length,
    currentBet: state.currentBet,
    lastRaiseSize: state.lastRaiseSize,
    deadMoney: Math.max(0, totalPot(state) - liveCommit),
    heroCards: [hero.cards[0], hero.cards[1]],
    board: state.board.slice(),
    heroPosition: hero.position,
    heroStack: hero.stack,
    heroStreetCommit: hero.streetCommit,
    heroHandCommit: hero.handCommit,
    heroIsPreflopAggressor: preflopAggressor === heroSeat,
    pot: totalPot(state),
    bigBlind: state.bigBlind,
    legal,
    opponents,
    activeCount: opponents.length + 1,
    // Копия, а не ссылка: слепок не должен меняться после хода.
    history: state.log.map((a) => ({ ...a })),
    preflopLevel,
    effectiveStack,
    heroInPosition: isHeroInPosition(hero.position, opponents.map((o) => o.position)),
  };
}

function isHeroInPosition(hero: Position, others: Position[]): boolean {
  const rank = (p: Position) => POSTFLOP_ORDER.indexOf(p);
  return others.every((o) => rank(hero) > rank(o));
}
