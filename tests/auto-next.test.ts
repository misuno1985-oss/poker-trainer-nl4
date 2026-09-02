/**
 * Автопереход к следующей раздаче.
 *
 * Здесь важны не столько сами задержки, сколько гонки: пауза, нажатая за
 * мгновение до перехода, обязана его отменить, а таймер прошлой раздачи не
 * имеет права запустить новую. Поэтому таймер подставной, и время в тестах
 * двигается вручную — по-настоящему воспроизвести такую гонку иначе нельзя.
 */

import { describe, expect, it } from 'vitest';
import { AUTO_NEXT_MS, AutoNext, FINALE_MS, TOTAL_DELAY_MS, type Timer } from '../src/app/autoNext';

/** Управляемое время: ничего не происходит само, пока не сдвинешь часы. */
function fakeTimer() {
  let now = 1000;
  let nextId = 1;
  const jobs = new Map<number, { at: number; fn: () => void }>();

  const timer: Timer = {
    now: () => now,
    set(fn, ms) {
      const id = nextId++;
      jobs.set(id, { at: now + ms, fn });
      return id;
    },
    clear(id) { jobs.delete(id); },
  };

  const advance = (ms: number) => {
    now += ms;
    // Копия: сработавшая задача может поставить новую.
    for (const [id, job] of [...jobs]) {
      if (job.at <= now) {
        jobs.delete(id);
        job.fn();
      }
    }
  };

  return { timer, advance, pending: () => jobs.size };
}

function setup() {
  const clock = fakeTimer();
  const starts: boolean[] = [];
  const auto = new AutoNext(clock.timer, (wasAuto) => starts.push(wasAuto));
  return { ...clock, auto, starts };
}

describe('обычный ход', () => {
  it('законченная раздача запускает следующую сама', () => {
    const { auto, advance, starts } = setup();
    auto.schedule();
    advance(TOTAL_DELAY_MS);
    expect(starts).toEqual([true]);
  });

  it('но не мгновенно: есть пауза на результат и оценку', () => {
    const { auto, advance, starts } = setup();
    auto.schedule();

    advance(FINALE_MS);
    expect(starts).toEqual([]);       // финал прошлой руки ещё доигрывает
    advance(AUTO_NEXT_MS - 1);
    expect(starts).toEqual([]);       // и ещё видно результат
    advance(1);
    expect(starts).toEqual([true]);
  });

  it('пауза заметная, но не утомительная', () => {
    expect(TOTAL_DELAY_MS).toBeGreaterThanOrEqual(1500);
    expect(TOTAL_DELAY_MS).toBeLessThanOrEqual(3000);
  });

  it('видно, сколько осталось', () => {
    const { auto, advance } = setup();
    expect(auto.remaining).toBeNull();
    auto.schedule();
    expect(auto.remaining).toBe(TOTAL_DELAY_MS);
    advance(1000);
    expect(auto.remaining).toBe(TOTAL_DELAY_MS - 1000);
  });
});

describe('отложить следующую раздачу', () => {
  it('включённая заранее пауза не даёт раздаче начаться', () => {
    const { auto, advance, starts } = setup();
    // Игрок отметил галочку ещё во время руки.
    auto.setPaused(true);
    auto.schedule();
    advance(TOTAL_DELAY_MS * 3);
    expect(starts).toEqual([]);
  });

  it('пауза во время отсчёта отменяет уже запланированный переход', () => {
    const { auto, advance, starts } = setup();
    auto.schedule();
    // Осталось 300 мс — успеваем.
    advance(TOTAL_DELAY_MS - 300);
    auto.setPaused(true);
    advance(10_000);
    expect(starts).toEqual([]);
    expect(auto.remaining).toBeNull();
  });

  it('ручной переход после паузы запускает ровно одну раздачу', () => {
    const { auto, advance, starts } = setup();
    auto.setPaused(true);
    auto.schedule();
    advance(TOTAL_DELAY_MS);

    auto.manual();
    expect(starts).toEqual([false]);
    advance(10_000);
    expect(starts).toEqual([false]);
  });

  it('пауза одноразовая: после ручного перехода снова работает автопереход', () => {
    const { auto, advance, starts } = setup();
    auto.setPaused(true);
    expect(auto.isPaused).toBe(true);

    auto.manual();
    expect(auto.isPaused).toBe(false);

    // Следующая обычная раздача продолжается сама.
    auto.schedule();
    advance(TOTAL_DELAY_MS);
    expect(starts).toEqual([false, true]);
  });

  it('снятая галочка возвращает отсчёт только по расписанию', () => {
    const { auto, advance, starts } = setup();
    auto.setPaused(true);
    auto.setPaused(false);
    expect(auto.isPaused).toBe(false);
    // Сама по себе снятая галочка ничего не запускает.
    advance(10_000);
    expect(starts).toEqual([]);
  });
});

describe('разбор и переигрывание', () => {
  it('открытый подробный разбор отменяет переход', () => {
    const { auto, advance, starts } = setup();
    auto.schedule();
    advance(500);
    auto.hold();
    advance(10_000);
    expect(starts).toEqual([]);
    expect(auto.isPaused).toBe(true);
  });

  it('после разбора раздача начинается только вручную', () => {
    const { auto, advance, starts } = setup();
    auto.schedule();
    auto.hold();
    advance(10_000);
    expect(starts).toEqual([]);

    auto.manual();
    expect(starts).toEqual([false]);
  });

  it('переигрывание отменяет запланированный переход', () => {
    const { auto, advance, starts } = setup();
    auto.schedule();
    advance(500);
    // Так это делает интерфейс при «переиграть».
    auto.cancel();
    advance(10_000);
    expect(starts).toEqual([]);
  });
});

describe('гонки и двойные нажатия', () => {
  it('таймер прошлой раздачи не может запустить новую позже', () => {
    const { auto, advance, starts } = setup();
    auto.schedule();
    advance(TOTAL_DELAY_MS - 100);

    // Игрок нажал «следующая» сам, не дожидаясь.
    auto.manual();
    expect(starts).toEqual([false]);

    // Старый таймер добежал — и обязан промолчать.
    advance(1000);
    expect(starts).toEqual([false]);
  });

  it('двойное нажатие не создаёт две раздачи подряд из таймера', () => {
    const { auto, advance, starts } = setup();
    auto.schedule();
    auto.manual();
    auto.manual();
    // Два нажатия — две раздачи, это честно. Но таймер сверх них ничего не даёт.
    expect(starts).toEqual([false, false]);
    advance(10_000);
    expect(starts).toEqual([false, false]);
  });

  it('повторный schedule заменяет план, а не добавляет второй', () => {
    const { auto, advance, starts, pending } = setup();
    auto.schedule();
    auto.schedule();
    auto.schedule();
    expect(pending()).toBe(1);
    advance(TOTAL_DELAY_MS);
    expect(starts).toEqual([true]);
  });

  it('отменённый переход не оставляет висящих таймеров', () => {
    const { auto, pending } = setup();
    auto.schedule();
    expect(pending()).toBe(1);
    auto.cancel();
    expect(pending()).toBe(0);
  });

  it('конец сессии: если переход не планировали, ничего и не случится', () => {
    const { advance, starts } = setup();
    // Интерфейс на последней раздаче сессии просто не вызывает schedule.
    advance(10_000);
    expect(starts).toEqual([]);
  });
});
