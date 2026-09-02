/**
 * Единственная точка, через которую в приложении звучит звук.
 *
 * Здесь живут громкость, выключатель и защита от каши: когда несколько ботов
 * ходят подряд, звуки не должны накладываться в трескотню. Синтез вынесен в
 * `engine.ts` и подставляется снаружи — поэтому всё, что ниже, проверяется
 * тестами без браузера и без Web Audio.
 */

import type { SoundName } from './events';

export type SoundLevel = 'low' | 'normal';

export interface SoundEngine {
  /** Проиграть звук с итоговой громкостью 0..1. */
  play(name: SoundName, gain: number): void;
  /** Разбудить аудио после первого действия пользователя. */
  unlock(): void;
  /** Готов ли звук вообще звучать (контекст создан и не заблокирован). */
  ready(): boolean;
}

const KEY = 'nl4-sound-v1';

/** Базовая громкость. Заведомо тише музыки и видео — по этому пункту просили. */
const BASE_GAIN = 0.18;
const LEVEL_GAIN: Record<SoundLevel, number> = { low: 0.5, normal: 1 };

/** Минимальный промежуток между двумя одинаковыми звуками. */
const SAME_SOUND_GAP_MS = 55;
/** Окно и предел, за которым звуки перестают накладываться. */
const CROWD_WINDOW_MS = 220;
const CROWD_LIMIT = 4;

/**
 * Насколько каждый звук громче или тише остальных. Фишки не должны бить по
 * ушам, чек почти не слышен, сброс карт — заметный, но короткий.
 */
const RELATIVE: Record<SoundName, number> = {
  blind: 0.55,
  check: 0.35,
  call: 0.7,
  bet: 0.8,
  raise: 0.95,
  allin: 1,
  fold: 0.75,
  collect: 0.6,
  win: 0.9,
  deal: 0.3,
  card: 0.55,
  reveal: 0.45,
};

export interface Settings {
  enabled: boolean;
  level: SoundLevel;
}

export function loadSettings(): Settings {
  const fallback: Settings = { enabled: true, level: 'normal' };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      enabled: parsed.enabled !== false,
      level: parsed.level === 'low' ? 'low' : 'normal',
    };
  } catch {
    return fallback;
  }
}

function saveSettings(s: Settings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Хранилище недоступно — играть это не мешает.
  }
}

export class AudioManager {
  private settings: Settings;
  private readonly lastAt = new Map<SoundName, number>();
  private recent: number[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private readonly engine: SoundEngine,
    private readonly now: () => number = () => Date.now(),
    settings: Settings = loadSettings(),
  ) {
    this.settings = settings;
  }

  get enabled(): boolean { return this.settings.enabled; }
  get level(): SoundLevel { return this.settings.level; }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  setEnabled(enabled: boolean): void {
    this.settings = { ...this.settings, enabled };
    saveSettings(this.settings);
    if (enabled) this.engine.unlock();
    this.changed();
  }

  setLevel(level: SoundLevel): void {
    this.settings = { ...this.settings, level };
    saveSettings(this.settings);
    this.changed();
  }

  /** Разбудить звук. Вызывается по первому действию пользователя. */
  unlock(): void {
    if (this.settings.enabled) this.engine.unlock();
  }

  /**
   * Проиграть звук. Возвращает, прозвучал ли он: на этом держатся тесты про
   * выключенный звук и про наложение.
   */
  play(name: SoundName): boolean {
    if (!this.settings.enabled) return false;

    const t = this.now();

    // Тот же звук слишком быстро — пропускаем.
    const last = this.lastAt.get(name);
    if (last !== undefined && t - last < SAME_SOUND_GAP_MS) return false;

    // Слишком много звуков в коротком окне — стол должен звучать живым, а не
    // игровым автоматом.
    this.recent = this.recent.filter((at) => t - at < CROWD_WINDOW_MS);
    if (this.recent.length >= CROWD_LIMIT) return false;

    this.lastAt.set(name, t);
    this.recent.push(t);

    this.engine.play(name, BASE_GAIN * LEVEL_GAIN[this.settings.level] * RELATIVE[name]);
    return true;
  }
}
