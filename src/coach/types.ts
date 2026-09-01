/**
 * Что тренер знает о решении — и, что важнее, чего он знать НЕ ДОЛЖЕН.
 *
 * `DecisionSnapshot` — это полный слепок информации, доступной герою в момент
 * нажатия кнопки. Закрытых карт соперников здесь нет ни в каком виде, и это
 * ограничение архитектурное, а не договорённость: тип просто не содержит поля,
 * куда их можно было бы положить, а весь модуль `coach/` не импортирует ни
 * `HandState`, ни `Session`. Единственное исключение — `snapshot.ts`, который
 * стоит на границе и снимает слепок.
 *
 * Проверяется двумя тестами: один меняет скрытые карты соперника и требует
 * идентичного вердикта, второй читает исходники и следит за импортами.
 */

import type { Card } from '../engine/cards';
import type { Action, LegalActions, Position, Street } from '../game/types';
import type { BotProfile } from '../bots/profiles';

/** Соперник глазами героя: статистика и публичные действия, но не карты. */
export interface OpponentView {
  seat: number;
  name: string;
  /** Измеренная статистика из реальной базы. Карт здесь нет. */
  profile: BotProfile;
  position: Position;
  stack: number;
  streetCommit: number;
  handCommit: number;
  folded: boolean;
  allIn: boolean;
  isPreflopAggressor: boolean;
}

export interface DecisionSnapshot {
  handNumber: number;
  street: Street;
  /** Карты героя — их он, разумеется, видит. */
  heroCards: [Card, Card];
  board: Card[];
  heroPosition: Position;
  heroStack: number;
  heroStreetCommit: number;
  heroHandCommit: number;
  heroIsPreflopAggressor: boolean;
  /** Весь банк, включая ставки текущей улицы. */
  pot: number;
  bigBlind: number;
  legal: LegalActions;
  /** Только те, кто ещё в раздаче. */
  opponents: OpponentView[];
  /** Сколько игроков всего осталось, включая героя. */
  activeCount: number;
  /** Публичная история торговли — то, что видно за столом. */
  history: Action[];
  /** Уровень торговли до флопа: 1 блайнд, 2 опен, 3 три-бет, 4 четыре-бет. */
  preflopLevel: number;
  /** Меньший из стеков героя и соперника — сколько реально можно проиграть. */
  effectiveStack: number;
  /** Герой в позиции (ходит последним) на этой улице. */
  heroInPosition: boolean;

  /* --- публичные детали стола, нужные для доигрывания раздачи --- */
  /** Место героя. */
  heroSeat: number;
  /** Место баттона. */
  button: number;
  /** Сколько мест за столом. */
  seatCount: number;
  /** Текущая наибольшая ставка на улице. */
  currentBet: number;
  /** Минимальный шаг повышения. */
  lastRaiseSize: number;
  /** Деньги в банке от уже сбросивших игроков. */
  deadMoney: number;
}

/** Действие-кандидат, которое тренер взвешивает. */
export interface Candidate {
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** Для bet/raise — сумма, до которой поднимаем. */
  total?: number;
  /** Ожидаемый результат в центах относительно «сейчас». */
  ev: number;
  /** Из чего он сложился — для окна «Почему?». */
  detail: EvDetail;
}

export interface EvDetail {
  /** Наша доля против диапазона соперника, 0..1. */
  equity: number;
  /** Доля против того, с чем он УРАВНЯЕТ нашу ставку. */
  equityVsContinue?: number;
  /** Доля против того, с чем он ПОВЫСИТ в ответ. */
  equityVsReraise?: number;
  /** Как часто он просто уравняет. */
  callChance?: number;
  /** Как часто повысит в ответ. */
  reraiseChance?: number;
  /** Как часто он сбросит на такую ставку. */
  foldEquity?: number;
  /** Цена колла и требуемая доля. */
  toCall?: number;
  potOdds?: number;
  /** Заполнено, если число уточнено доигрыванием раздачи. */
  rollout?: { sims: number; stdErr: number };
  /** Пояснение, если число получено эвристикой, а не расчётом. */
  note?: string;
}

export type Certainty = 'clear' | 'close' | 'unclear';

export interface Confidence {
  /** Насколько надёжны данные о сопернике. */
  data: 'good' | 'thin' | 'none';
  /** Размер выборки, на которую опирается вывод о сопернике. */
  sample: number;
  /** Насколько далеко разошлись варианты. */
  decision: Certainty;
}

export interface CoachVerdict {
  /** Что герой сделал. */
  chosen: Candidate;
  /** Лучший вариант по мнению тренера. */
  best: Candidate;
  /** Все рассмотренные варианты, отсортированные по EV. */
  ranked: Candidate[];
  /** 0..10 за выбор типа действия. */
  actionScore: number;
  /** 0..10 за размер; null, если размер не при чём. */
  sizingScore: number | null;
  /** Итоговая оценка. */
  score: number;
  confidence: Confidence;
  /** Короткий текст: что хорошо, что плохо, что лучше. */
  brief: Brief;
  /** Развёрнутое объяснение для кнопки «Почему?». */
  why: WhySection[];
  /** Замечания по личным утечкам — добавка к оценке, а не её замена. */
  leakNotes: LeakNote[];
}

export interface Brief {
  good: string | null;
  bad: string | null;
  better: string | null;
  /**
   * Одной строкой: какие варианты близки, а какие заметно хуже. Нужна, чтобы
   * текст, баллы и посчитанные EV описывали одну и ту же картину, а не спорили
   * друг с другом.
   */
  picture: string;
}

export interface WhySection {
  title: string;
  /** 'data' — измеренный факт из базы; 'model' — вывод модели; 'math' — расчёт. */
  kind: 'data' | 'model' | 'math';
  lines: string[];
}

export interface LeakNote {
  id: string;
  title: string;
  text: string;
  /** Сработала ли утечка в этой конкретной раздаче. */
  triggered: boolean;
}
