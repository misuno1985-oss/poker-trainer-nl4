/**
 * Какое действие за столом каким звуком озвучивается.
 *
 * Модуль намеренно ничего не знает ни про Web Audio, ни про React: это чистое
 * правило «событие → имя звука». Источник события — действие в протоколе
 * раздачи, а не нажатая героем кнопка, поэтому ходы соперников звучат так же,
 * как свои, и переигрывание звучит так же, как обычная игра.
 */

import type { Action, Street } from '../game/types';

export type SoundName =
  | 'blind'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'allin'
  | 'fold'
  | 'collect'
  | 'win';

/** Звук одного действия. null — событие, которое озвучивать не нужно. */
export function soundForAction(action: Action): SoundName | null {
  // Олл-ин слышно отдельно, каким бы действием он ни был сделан.
  if (action.allIn && action.kind !== 'fold' && action.kind !== 'check') return 'allin';

  switch (action.kind) {
    case 'post': return 'blind';
    case 'check': return 'check';
    case 'call': return 'call';
    case 'bet': return 'bet';
    case 'raise': return 'raise';
    case 'fold': return 'fold';
    default: return null;
  }
}

/**
 * Что нового произошло в протоколе с прошлого кадра.
 *
 * Отдельная функция, потому что здесь легко ошибиться. Протокол не только
 * растёт: при переигрывании раздача пересобирается, и он становится КОРОЧЕ.
 * Это не события, это откат состояния — озвучивать его нельзя, иначе на каждое
 * «переиграть» сыпалась бы очередь чужих звуков.
 */
export interface LogCursor {
  /** Ключ раздачи: номер и зерно. Меняется — значит раздача другая. */
  hand: string;
  /** Сколько записей протокола уже озвучено. */
  seen: number;
}

export interface LogDiff {
  cursor: LogCursor;
  /** Действия, которые нужно озвучить сейчас. */
  fresh: Action[];
}

export function diffLog(
  previous: LogCursor | null,
  hand: string,
  log: readonly Action[],
): LogDiff {
  // Первый кадр: догоняем текущее состояние молча. Иначе при заходе на
  // страницу сразу зазвучали бы блайнды уже сданной раздачи.
  if (previous === null) return { cursor: { hand, seen: log.length }, fresh: [] };

  // Другая раздача — озвучиваем с начала, включая блайнды.
  if (previous.hand !== hand) return { cursor: { hand, seen: log.length }, fresh: log.slice() };

  // Протокол укоротился: раздачу пересобрали для переигрывания. Молча
  // подхватываем новую длину.
  if (log.length < previous.seen) return { cursor: { hand, seen: log.length }, fresh: [] };

  return { cursor: { hand, seen: log.length }, fresh: log.slice(previous.seen) };
}

/**
 * Смена улицы — фишки уезжают в центр.
 * На префлоп не реагируем: это начало раздачи, а не сбор банка.
 */
export function soundForStreet(from: Street, to: Street): SoundName | null {
  if (from === to || to === 'preflop') return null;
  return 'collect';
}
