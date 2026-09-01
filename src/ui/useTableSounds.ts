import { useEffect, useRef } from 'react';
import type { Session } from '../app/session';
import type { Street } from '../game/types';
import { armAudioUnlock, audio, diffLog, soundForAction, soundForStreet, type LogCursor } from '../audio';

/**
 * Озвучка стола.
 *
 * Слушает не кнопки героя, а ПРОТОКОЛ раздачи. Поэтому ходы соперников звучат
 * так же, как свои, а переигрывание — так же, как обычная игра: движок в обоих
 * случаях пишет в протокол одни и те же действия.
 *
 * Ничего в раздаче не меняет: только читает состояние и проигрывает звук.
 */

/** Промежуток между звуками, если за один кадр пришло несколько действий. */
const STAGGER_MS = 70;
/** Больше четырёх звуков подряд превращаются в кашу. */
const MAX_PER_BATCH = 4;

export function useTableSounds(session: Session, active: boolean): void {
  const cursor = useRef<LogCursor | null>(null);
  const street = useRef<Street | null>(null);
  const finished = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => { armAudioUnlock(); }, []);

  useEffect(() => {
    const state = session.state;
    const hand = `${session.handNumber}:${session.handSeed}`;

    const { cursor: next, fresh } = diffLog(cursor.current, hand, state.log);
    const handChanged = cursor.current?.hand !== hand;
    cursor.current = next;

    if (handChanged) {
      street.current = state.street;
      finished.current = state.finished;
    }

    if (!active) {
      // Экран не игровой — состояние догоняем молча.
      street.current = state.street;
      finished.current = state.finished;
      return;
    }

    const queue = fresh
      .map(soundForAction)
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .slice(0, MAX_PER_BATCH);

    // Сбор банка и выигрыш — после действий, которые к ним привели.
    const streetSound = street.current ? soundForStreet(street.current, state.street) : null;
    if (streetSound) queue.push(streetSound);
    street.current = state.street;

    if (state.finished && !finished.current) queue.push('win');
    finished.current = state.finished;

    queue.forEach((name, i) => {
      if (i === 0) {
        audio.play(name);
        return;
      }
      const id = window.setTimeout(() => audio.play(name), i * STAGGER_MS);
      timers.current.push(id);
    });

    return () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
  });
}
