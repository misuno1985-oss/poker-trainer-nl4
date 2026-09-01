import { useSyncExternalStore } from 'react';
import { audio } from '../audio';

/**
 * Выключатель звука. Стоит в шапке — на виду, но без нажима.
 * Состояние живёт в localStorage, поэтому переживает перезагрузку.
 */
export function SoundToggle() {
  const on = useSyncExternalStore(
    (fn) => audio.subscribe(fn),
    () => audio.enabled,
    () => true,
  );
  const level = useSyncExternalStore(
    (fn) => audio.subscribe(fn),
    () => audio.level,
    () => 'normal' as const,
  );

  return (
    <div className="sound-toggle">
      <button
        type="button"
        className={`btn btn-chip ${on ? '' : 'sound-off'}`}
        aria-pressed={on}
        title={on ? 'Выключить звук' : 'Включить звук'}
        onClick={() => audio.setEnabled(!on)}
      >
        <span aria-hidden="true">{on ? '🔊' : '🔇'}</span>
        <span className="sound-label">{on ? 'ЗВУК' : 'БЕЗ ЗВУКА'}</span>
      </button>
      {on && (
        <button
          type="button"
          className="btn btn-chip sound-level"
          title={level === 'low' ? 'Сделать погромче' : 'Сделать потише'}
          onClick={() => audio.setLevel(level === 'low' ? 'normal' : 'low')}
        >
          {level === 'low' ? 'ТИШЕ' : 'ОБЫЧНО'}
        </button>
      )}
    </div>
  );
}
