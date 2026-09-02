/**
 * Один таймлайн на стол: и движение, и звук.
 *
 * Здесь нет ни React, ни Web Audio, ни движка — только правило «что изменилось
 * в состоянии → какие события с этим связаны и когда». Каждое событие несёт
 * СРАЗУ и вид анимации, и звук, поэтому они физически не могут разойтись: их
 * запускает один и тот же вызов в один и тот же миг.
 *
 * Движок про анимации ничего не знает и знать не должен: он сообщает состояние,
 * а интерфейс сам вычисляет по нему переходы.
 */

import type { Action, Street } from '../game/types';
import type { SoundName } from '../audio/events';
import { soundForAction } from '../audio/events';

/* ------------------------------------------------------------------ */
/* Длительности. Всё быстрое и сдержанное — это стол, а не кино.        */
/* ------------------------------------------------------------------ */

export const DEAL_MS = 180;
export const DEAL_STAGGER_MS = 55;
export const BOARD_MS = 170;
export const BOARD_STAGGER_MS = 70;
export const FOLD_MS = 210;
export const CHIP_MS = 190;
export const COLLECT_MS = 320;
export const AWARD_MS = 360;
export const REVEAL_MS = 190;
export const BUTTON_MS = 220;

/** Пауза перед сбором фишек и перед первой картой новой улицы. */
const COLLECT_LEAD_MS = 120;
const ACTION_STAGGER_MS = 70;

/* ------------------------------------------------------------------ */
/* Что интерфейсу нужно знать о столе                                  */
/* ------------------------------------------------------------------ */

export interface TableSnapshot {
  /** Ключ раздачи: номер и зерно. Меняется — значит раздача другая. */
  hand: string;
  street: Street;
  log: readonly Action[];
  /** Сколько карт лежит на борде. */
  board: number;
  button: number;
  /** Места, которые уже сбросили карты. */
  folded: readonly number[];
  /** Места с открытыми картами: вскрытие. */
  shown: readonly number[];
  finished: boolean;
  /** Кому уходит банк. */
  winners: readonly number[];
  /** Вклад каждого места на текущей улице. */
  committed: readonly number[];
}

export type CueKind =
  | { type: 'deal'; seat: number }
  | { type: 'board'; index: number }
  | { type: 'fold'; seat: number }
  | { type: 'chips'; seat: number }
  | { type: 'collect' }
  | { type: 'award'; seat: number }
  | { type: 'reveal'; seat: number }
  | { type: 'button'; seat: number };

export interface Cue {
  /** Смещение от начала пачки, миллисекунды. */
  at: number;
  kind: CueKind;
  /** Звук ровно этого события. null — событие беззвучное. */
  sound: SoundName | null;
}

export interface Plan {
  cues: Cue[];
  /**
   * Состояние, к которому надо перескочить МОЛЧА и мгновенно: первый кадр,
   * пересборка раздачи для переигрывания, возврат на игровой экран.
   */
  jump: boolean;
  /** Началась новая раздача: всё, что было на столе, надо сбросить. */
  reset: boolean;
}

/** Порядок раздачи: от малого блайнда по кругу, как за настоящим столом. */
export function dealOrder(button: number, seats: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= seats; i++) out.push((button + i) % seats);
  return out;
}

/**
 * Что произошло между двумя кадрами.
 *
 * Правило то же, что у звука с самого начала: протокол не только растёт. При
 * переигрывании раздача пересобирается, и он становится КОРОЧЕ — это откат
 * состояния, а не события, и ни звука, ни анимации он порождать не должен.
 */
export function buildPlan(
  previous: TableSnapshot | null,
  next: TableSnapshot,
  seats: number,
): Plan {
  // Первый кадр — просто догоняем состояние.
  if (previous === null) return { cues: [], jump: true, reset: false };

  // Новая раздача: карты раздаются заново, кнопка дилера переезжает.
  if (previous.hand !== next.hand) {
    const cues: Cue[] = [];
    let t = 0;
    cues.push({ at: 0, kind: { type: 'button', seat: next.button }, sound: null });
    for (const seat of dealOrder(next.button, seats)) {
      cues.push({ at: t, kind: { type: 'deal', seat }, sound: 'deal' });
      t += DEAL_STAGGER_MS;
    }
    // Блайнды уже стоят в протоколе новой раздачи — озвучиваем их после сдачи.
    for (const a of next.log) {
      if (a.kind !== 'post') continue;
      cues.push({ at: t, kind: { type: 'chips', seat: a.seat }, sound: 'blind' });
      t += ACTION_STAGGER_MS;
    }
    return { cues, jump: false, reset: true };
  }

  // Протокол укоротился — раздачу пересобрали. Молча.
  if (next.log.length < previous.log.length) return { cues: [], jump: true, reset: false };

  const cues: Cue[] = [];
  let t = 0;

  // 1. Действия игроков: у каждого свой звук и своё движение.
  for (const a of next.log.slice(previous.log.length)) {
    const sound = soundForAction(a);
    const kind: CueKind = a.kind === 'fold'
      ? { type: 'fold', seat: a.seat }
      : { type: 'chips', seat: a.seat };
    // Чек не двигает фишек — только тихий щелчок.
    if (a.kind === 'check') {
      cues.push({ at: t, kind: { type: 'chips', seat: a.seat }, sound });
    } else {
      cues.push({ at: t, kind, sound });
    }
    t += ACTION_STAGGER_MS;
  }

  // 2. Улица закрылась — фишки едут в центр.
  if (next.street !== previous.street && next.street !== 'preflop') {
    cues.push({ at: t, kind: { type: 'collect' }, sound: 'collect' });
    t += COLLECT_LEAD_MS;
  }

  // 3. Новые карты борда — по одной, каждая со своим звуком.
  for (let i = previous.board; i < next.board; i++) {
    cues.push({ at: t, kind: { type: 'board', index: i }, sound: 'card' });
    t += BOARD_STAGGER_MS;
  }

  // 4. Вскрытие чужих карт.
  for (const seat of next.shown) {
    if (previous.shown.includes(seat)) continue;
    cues.push({ at: t, kind: { type: 'reveal', seat }, sound: 'reveal' });
    t += DEAL_STAGGER_MS;
  }

  // 5. Банк уходит победителю.
  if (next.finished && !previous.finished) {
    for (const seat of next.winners) {
      cues.push({ at: t, kind: { type: 'award', seat }, sound: 'win' });
      break; // Один звук на раздачу, даже если банк делится.
    }
  }

  return { cues, jump: false, reset: false };
}
