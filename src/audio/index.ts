/**
 * Один звуковой слой на всё приложение.
 *
 * Разбужен он будет только по первому настоящему действию пользователя —
 * этого требуют браузеры, и до тех пор всё молчит без единой ошибки в консоли.
 */

import { createWebAudioEngine } from './engine';
import { AudioManager } from './manager';

export const audio = new AudioManager(createWebAudioEngine());

let attached = false;

/** Разбудить звук по первому клику, касанию или клавише. */
export function armAudioUnlock(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;

  const wake = () => {
    audio.unlock();
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
    window.removeEventListener('touchstart', wake);
  };

  window.addEventListener('pointerdown', wake, { once: false, passive: true });
  window.addEventListener('keydown', wake, { once: false });
  window.addEventListener('touchstart', wake, { once: false, passive: true });
}

export { AudioManager } from './manager';
export type { SoundLevel, SoundEngine, Settings } from './manager';
export { soundForAction, soundForStreet, diffLog } from './events';
export type { SoundName, LogCursor } from './events';
