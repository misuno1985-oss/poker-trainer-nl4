/**
 * Режимы тренировки, запись раздач и подбор ситуаций.
 *
 * Здесь нет React и нет обращений к localStorage — только логика. Хранение
 * живёт в progress.ts, интерфейс в ui/.
 */

import type { ActionRequest } from '../game/betting';
import type { Street } from '../game/types';
import type { Card } from '../engine/cards';
import { randInt, type Rng } from '../game/rng';
import { PROFILES } from '../bots/profiles';
import { captureSnapshot } from '../coach/snapshot';
import { categorise, type CategoryId } from '../coach/categories';
import type { CoachVerdict } from '../coach/types';
import {
  HERO_SEAT, SEATS, dealNext, handSetupOf, heroAct, isBotTurn, isHeroTurn, restoreHand, stepBot,
  type HandSetup, type Session,
} from './session';

export type ModeKind = 'quick' | 'session' | 'weak-spot' | 'versus';

export interface TrainerMode {
  kind: ModeKind;
  /** Для режима сессии: сколько раздач сыграть. */
  handLimit?: number;
  /** Для тренировки слабого места. */
  category?: CategoryId;
  /** Для игры против конкретного соперника. */
  villain?: string;
}

export const MODE_TITLES: Record<ModeKind, string> = {
  quick: 'Свободная игра',
  session: 'Сессия',
  'weak-spot': 'Слабое место',
  versus: 'Против игрока',
};

/** Одно решение героя внутри раздачи. */
export interface DecisionRecord {
  street: Street;
  action: ActionRequest;
  verdict: CoachVerdict;
  categories: CategoryId[];
  /** Главный соперник в этой точке — тот, кто последним проявил агрессию. */
  villain: string;
  heroCards: [Card, Card];
  board: Card[];
  pot: number;
  /** Сколько действий героя было ДО этого — нужно для переигрывания. */
  priorActions: ActionRequest[];
}

/** Запись раздачи: достаточно, чтобы полностью её воспроизвести. */
export interface HandRecord {
  setup: HandSetup;
  heroActions: ActionRequest[];
  decisions: DecisionRecord[];
  net: number;
}

/* ------------------------------------------------------------------ */
/* Кто главный соперник в этой точке                                   */
/* ------------------------------------------------------------------ */

export function mainVillain(session: Session): string {
  const snap = captureSnapshot(session);
  if (!snap || snap.opponents.length === 0) return '';
  // Тот, кто последним увеличивал ставку; иначе — префлоп-агрессор; иначе первый.
  for (let i = snap.history.length - 1; i >= 0; i--) {
    const a = snap.history[i];
    if (a.kind !== 'bet' && a.kind !== 'raise') continue;
    const opp = snap.opponents.find((o) => o.seat === a.seat);
    if (opp) return opp.name;
  }
  return (snap.opponents.find((o) => o.isPreflopAggressor) ?? snap.opponents[0]).name;
}

/* ------------------------------------------------------------------ */
/* Подбор ситуации для тренировки слабого места                        */
/* ------------------------------------------------------------------ */

/**
 * Проверяет, встретится ли в раздаче нужный тип решения.
 *
 * Раздача проигрывается вперёд «базовым» героем — тем же, что и в
 * доигрывании. Это не сценарий с готовым ответом: подбирается только СИТУАЦИЯ,
 * а как её играть, решает игрок, и он вправе увести раздачу в другую сторону.
 */
function handOffersCategory(session: Session, category: CategoryId, baseline: (s: Session) => ActionRequest): boolean {
  // Работаем на копии: настоящую раздачу трогать нельзя.
  const probe = cloneForProbe(session);
  let guard = 0;
  while (!probe.state.finished && guard++ < 60) {
    if (isHeroTurn(probe)) {
      const snap = captureSnapshot(probe);
      if (snap && categorise(snap).includes(category)) return true;
      heroAct(probe, baseline(probe));
    } else if (isBotTurn(probe)) {
      stepBot(probe);
    } else break;
  }
  return false;
}

function cloneForProbe(session: Session): Session {
  // Раздача восстанавливается из своего описания — это дешевле и надёжнее,
  // чем глубокое копирование состояния.
  const clone: Session = { ...session, bankroll: 0 };
  restoreHand(clone, handSetupOf(session));
  return clone;
}

/** Простая базовая линия для разведки: играет очень усреднённо. */
export function baselineAction(session: Session): ActionRequest {
  const legal = captureSnapshot(session)?.legal;
  if (!legal) return { kind: 'fold' };
  if (legal.canCheck) return { kind: 'check' };
  // Дешёвые продолжения принимаем, дорогие — нет: так разведка доходит до
  // постфлопа достаточно часто, но не раздувает банк искусственно.
  if (legal.canCall && legal.toCall <= legal.allInTotal * 0.25) return { kind: 'call' };
  return { kind: 'fold' };
}

/**
 * Раздать новую руку, стараясь попасть в нужный тип ситуации.
 * Если за отведённые попытки не получилось — играем что есть: лучше обычная
 * раздача, чем зависшее приложение.
 */
export function dealForCategory(
  session: Session,
  category: CategoryId,
  attempts = 25,
): { found: boolean; tried: number } {
  // Перебор идёт через настоящие раздачи — только так колода и боты остаются
  // теми же, что и в игре. Номер раздачи после перебора возвращается к
  // следующему по счёту: игроку не за что видеть, что мы тасовали двадцать раз.
  const startNumber = session.handNumber;
  let found = false;
  let tried = 0;
  for (let i = 0; i < attempts; i++) {
    dealNext(session);
    tried = i + 1;
    if (handOffersCategory(session, category, baselineAction)) { found = true; break; }
  }
  restoreHand(session, { ...handSetupOf(session), handNumber: startNumber + 1 });
  return { found, tried };
}

/* ------------------------------------------------------------------ */
/* Рассадка для режима «против игрока»                                 */
/* ------------------------------------------------------------------ */

/**
 * Пересаживает закреплённого соперника на случайное место.
 * Иначе он всегда оказывался бы по одну сторону от героя, и тренировка учила
 * бы читать его только в одной позиции.
 */
export function reseatVillain(session: Session, villain: string, rng: Rng) {
  const index = session.seatProfiles.findIndex((p) => p?.name === villain);
  if (index <= 0) return;
  const target = 1 + randInt(rng, SEATS - 1);
  if (target === index) return;
  const a = session.seatProfiles[index];
  const b = session.seatProfiles[target];
  session.seatProfiles[index] = b;
  session.seatProfiles[target] = a;
  const s = session.stacks[index];
  session.stacks[index] = session.stacks[target];
  session.stacks[target] = s;
}

/**
 * Раздача в режиме «против игрока»: соперник сначала садится на новое место,
 * и только потом собирается сама раздача. Иначе карты уже были бы розданы под
 * старую рассадку и пересадка ничего бы не меняла.
 */
export function dealVersus(session: Session, villain: string): void {
  dealNext(session);
  reseatVillain(session, villain, session.rng);
  restoreHand(session, {
    handNumber: session.handNumber,
    seed: session.handSeed,
    button: session.button,
    seatNames: session.seatProfiles.map((p) => (p ? p.name : session.config.heroName)),
    stacks: session.stacks.slice(),
  });
}

export const VILLAIN_NAMES = PROFILES.map((p) => p.name);

export { HERO_SEAT };
