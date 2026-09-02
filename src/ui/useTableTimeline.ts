import { useEffect, useRef, useState } from 'react';
import type { Session } from '../app/session';
import { SEATS } from '../app/session';
import { armAudioUnlock, audio } from '../audio';
import {
  AWARD_MS, CHIP_MS, COLLECT_MS, FOLD_MS, HIGHLIGHT_MS, REVEAL_MS,
  buildPlan, dealOrder, type Cue, type TableSnapshot,
} from './tableTimeline';

/**
 * Проигрывает таймлайн стола: движение и звук из одного события.
 *
 * Каждая подсказка (`Cue`) несёт и вид анимации, и звук, и запускается одним
 * вызовом — поэтому «звук раньше движения» здесь невозможен в принципе, а не
 * по счастливому совпадению таймеров.
 *
 * Раздача от этого не меняется: хук только читает состояние.
 */

export interface TableAnim {
  /** Сколько карт борда уже раскрыто. Остальные ещё не показываем. */
  boardShown: number;
  /** Места, чьи карты уже розданы. */
  dealt: number[];
  /** Места, чьи карты сейчас уходят в мак. */
  folding: number[];
  /** Места, чьи фишки только что поехали к маркеру. */
  chips: number[];
  /** Фишки едут в банк. */
  collecting: boolean;
  /** Кому едут фишки банка прямо сейчас. */
  awarding: number[];
  /** Кто подсвечен золотым как победитель. */
  winners: number[];
  /** Места, чьи карты сейчас раскрываются. */
  revealing: number[];
  /** Где лежит кнопка дилера. */
  button: number;
  /**
   * Места и карты борда, появившиеся ПО СОБЫТИЮ, а не прыжком.
   *
   * Разделение нужно из-за переигрывания: там раздача пересобирается целиком, и
   * карты обязаны просто оказаться на столе, без анимации входа. Списком, а не
   * общим флагом: флаг сбрасывался бы первым же следующим событием и запускал
   * раздачу заново — на этом я один раз уже попался.
   */
  entering: number[];
  boardEntering: number[];
}

function emptyAnim(button: number): TableAnim {
  return {
    boardShown: 0, dealt: [], folding: [], chips: [],
    collecting: false, awarding: [], winners: [], revealing: [], button,
    entering: [], boardEntering: [],
  };
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function snapshot(session: Session): TableSnapshot {
  const s = session.state;
  return {
    hand: `${session.handNumber}:${session.handSeed}`,
    street: s.street,
    // Копия, а не ссылка. Движок дописывает протокол на месте: если хранить
    // ссылку, «прошлый» кадр всегда равен нынешнему, и разница действий
    // получается пустой — фолды и ставки при этом молча теряются.
    log: s.log.slice(),
    board: s.board.length,
    button: session.button,
    folded: s.players.filter((p) => p.folded).map((p) => p.seat),
    shown: s.result && s.result.showdownSeats.length > 1 ? s.result.showdownSeats : [],
    finished: s.finished,
    winners: s.result ? s.result.awards.flatMap((a) => a.winners) : [],
    committed: s.players.map((p) => p.streetCommit),
  };
}

/** Состояние без анимаций: первый кадр, пересборка раздачи, чужой экран. */
function instant(snap: TableSnapshot): TableAnim {
  return {
    boardShown: snap.board,
    dealt: dealOrder(snap.button, SEATS),
    folding: [],
    chips: [],
    collecting: false,
    awarding: [],
    winners: [],
    revealing: [],
    button: snap.button,
    // Прыжок — значит без анимаций входа.
    entering: [],
    boardEntering: [],
  };
}

export function useTableTimeline(session: Session, active: boolean): TableAnim {
  const [anim, setAnim] = useState<TableAnim>(() => emptyAnim(session.button));
  const previous = useRef<TableSnapshot | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => { armAudioUnlock(); }, []);

  const clearAll = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  // Эффект без списка зависимостей: состояние раздачи меняется на месте, и
  // React сам этого не замечает. Отсюда важная тонкость — убирать таймеры на
  // каждом перерисовывании НЕЛЬЗЯ: их же ставит и этот эффект, а перерисовки
  // идут от его собственных setAnim. Однажды на этом всё и сломалось: карты
  // борда не появлялись, потому что их подсказки отменялись через кадр.
  useEffect(() => {
    const next = snapshot(session);
    const plan = buildPlan(previous.current, next, SEATS);
    previous.current = next;

    // Не игровой экран или пересборка раздачи — догоняем молча и мгновенно.
    if (!active || plan.jump) {
      clearAll();
      setAnim(instant(next));
      return;
    }
    if (plan.cues.length === 0) return;

    // Новая раздача: со стола убирается всё, что осталось от прошлой.
    if (plan.reset) {
      clearAll();
      setAnim(emptyAnim(previous.current?.button ?? next.button));
    }

    const reduced = prefersReducedMotion();

    for (const cue of plan.cues) {
      const fire = () => {
        // Звук и движение — в одном вызове. Ровно это и означает
        // «синхронизировано»: не два таймера, а одно событие.
        if (cue.sound) audio.play(cue.sound);
        setAnim((cur) => apply(cur, cue, next));
        scheduleEnd(cue, reduced, timers, setAnim);
      };
      if (cue.at <= 0) fire();
      else timers.current.push(window.setTimeout(fire, cue.at));
    }
  });

  // Уборка только при размонтировании: см. комментарий выше.
  useEffect(() => clearAll, []);

  return anim;
}

/** Как событие меняет состояние анимации. */
function apply(cur: TableAnim, cue: Cue, snap: TableSnapshot): TableAnim {
  switch (cue.kind.type) {
    case 'deal':
      return {
        ...cur,
        dealt: [...cur.dealt, cue.kind.seat],
        entering: [...cur.entering, cue.kind.seat],
      };
    case 'board':
      return {
        ...cur,
        boardShown: Math.max(cur.boardShown, cue.kind.index + 1),
        boardEntering: [...cur.boardEntering, cue.kind.index],
      };
    case 'fold':
      return { ...cur, folding: [...cur.folding, cue.kind.seat] };
    case 'chips':
      return { ...cur, chips: [...cur.chips, cue.kind.seat] };
    case 'collect':
      return { ...cur, collecting: true };
    case 'award':
      // Фишки едут и подсветка загорается одним событием: к моменту, когда
      // банк доехал, победитель уже светится.
      return { ...cur, awarding: cue.kind.seats, winners: cue.kind.seats };
    case 'reveal':
      return { ...cur, revealing: [...cur.revealing, cue.kind.seat] };
    case 'button':
      return { ...cur, button: cue.kind.seat, boardShown: snap.board === 0 ? 0 : cur.boardShown };
  }
}

/** Убрать за собой, когда анимация доиграла. */
function scheduleEnd(
  cue: Cue,
  reduced: boolean,
  timers: React.MutableRefObject<number[]>,
  setAnim: React.Dispatch<React.SetStateAction<TableAnim>>,
): void {
  const after = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, reduced ? 0 : ms));
  };

  switch (cue.kind.type) {
    case 'fold': {
      const seat = cue.kind.seat;
      // Только после ухода в мак карты действительно перестают рисоваться.
      after(FOLD_MS, () => setAnim((c) => ({ ...c, folding: c.folding.filter((s) => s !== seat) })));
      break;
    }
    case 'chips': {
      const seat = cue.kind.seat;
      after(CHIP_MS, () => setAnim((c) => ({ ...c, chips: c.chips.filter((s) => s !== seat) })));
      break;
    }
    case 'collect':
      after(COLLECT_MS, () => setAnim((c) => ({ ...c, collecting: false })));
      break;
    case 'award':
      // Фишки убираются, как только доехали, а подсветка живёт чуть дольше —
      // но обязательно гаснет сама, без вечного золотого свечения.
      after(AWARD_MS, () => setAnim((c) => ({ ...c, awarding: [] })));
      after(AWARD_MS + HIGHLIGHT_MS, () => setAnim((c) => ({ ...c, winners: [] })));
      break;
    case 'reveal': {
      const seat = cue.kind.seat;
      after(REVEAL_MS, () => setAnim((c) => ({ ...c, revealing: c.revealing.filter((s) => s !== seat) })));
      break;
    }
    default:
      break;
  }
}
