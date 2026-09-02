/**
 * Автоматический переход к следующей раздаче.
 *
 * Вынесен из интерфейса отдельно и с подставляемым таймером, потому что тут
 * легко ошибиться на гонках: пауза, нажатая за мгновение до перехода, обязана
 * его отменить, а таймер, поставленный прошлой раздачей, не имеет права
 * запустить новую. Оба правила держатся на метке: у каждого запланированного
 * перехода она своя, и перед стартом он сверяет, что метка ещё та самая.
 */

export interface Timer {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
  now(): number;
}

export const browserTimer: Timer = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
  now: () => Date.now(),
};

/** Сколько ждём, пока доиграет финал прошлой раздачи. */
export const FINALE_MS = 550;
/** Пауза, за которую видно результат и оценку тренера. */
export const AUTO_NEXT_MS = 1700;
export const TOTAL_DELAY_MS = FINALE_MS + AUTO_NEXT_MS;

export class AutoNext {
  private token = 0;
  private id: number | null = null;
  private dueAt: number | null = null;
  /** Одноразовая просьба «не начинай следующую сам». */
  private paused = false;

  constructor(
    private readonly timer: Timer,
    /** Что делать, когда пора: `true` — переход случился сам. */
    private readonly start: (auto: boolean) => void,
  ) {}

  get isPaused(): boolean { return this.paused; }

  /** Сколько миллисекунд осталось; null — переход не запланирован. */
  get remaining(): number | null {
    return this.dueAt === null ? null : Math.max(0, this.dueAt - this.timer.now());
  }

  /** Снять запланированный переход. Метка меняется — старый таймер обезврежен. */
  cancel(): void {
    this.token += 1;
    this.dueAt = null;
    if (this.id !== null) {
      this.timer.clear(this.id);
      this.id = null;
    }
  }

  /**
   * Запланировать переход. Если игрок попросил паузу — не планируем вовсе.
   * Повторный вызов заменяет прошлый план, а не добавляет второй.
   */
  schedule(delay = TOTAL_DELAY_MS): void {
    this.cancel();
    if (this.paused) return;

    const mine = this.token;
    this.dueAt = this.timer.now() + delay;
    this.id = this.timer.set(() => {
      this.id = null;
      this.dueAt = null;
      // Метка изменилась — переход уже отменили: паузой, переигрыванием или
      // ручной кнопкой. Молча уходим.
      if (mine !== this.token || this.paused) return;
      this.start(true);
    }, delay);
  }

  /** Включить или снять паузу. Включение обязано отменять идущий отсчёт. */
  setPaused(on: boolean): void {
    this.paused = on;
    if (on) this.cancel();
  }

  /**
   * Переход вручную. Пауза одноразовая: после ручной кнопки автопереход снова
   * работает — иначе галочку пришлось бы потом не забыть снять.
   */
  manual(): void {
    this.cancel();
    this.paused = false;
    this.start(false);
  }

  /** Удержать паузу: игрок открыл разбор и хочет читать. */
  hold(): void {
    this.paused = true;
    this.cancel();
  }
}
