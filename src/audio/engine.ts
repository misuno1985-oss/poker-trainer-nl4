/**
 * Синтез звуков стола на Web Audio. Никаких файлов, CDN и внешних запросов —
 * приложение остаётся статикой, которую можно положить на GitHub Pages.
 *
 * Звуки собраны из двух кирпичей: короткий всплеск шума через фильтр (щелчок
 * фишки, шлепок карты) и мягкий низкий удар синусом (вес). Из них набираются
 * все нужные события. Это не запись реального стола и ни у кого не заимствовано.
 */

import type { SoundEngine } from './manager';
import type { SoundName as Name } from './events';

/** Длина буфера шума. Одного куска хватает на все звуки. */
const NOISE_SECONDS = 0.5;

interface Ctx {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

/** Один щелчок фишки: полосовой шум с быстрым затуханием. */
function chip(c: Ctx, at: number, gain: number, freq: number, dur: number): void {
  const src = c.ctx.createBufferSource();
  src.buffer = c.noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.5;

  const band = c.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.6;

  const env = c.ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  src.connect(band).connect(env).connect(c.master);
  src.start(at, Math.random() * (NOISE_SECONDS - dur - 0.01));
  src.stop(at + dur + 0.02);
}

/** Мягкий низкий удар — «вес» стопки или карты о сукно. */
function thump(c: Ctx, at: number, gain: number, freq: number, dur: number): void {
  const osc = c.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, at + dur);

  const env = c.ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  osc.connect(env).connect(c.master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Шорох: шум через низкий фильтр, съезжающий вниз. Сгребание фишек. */
function sweep(c: Ctx, at: number, gain: number, from: number, to: number, dur: number): void {
  const src = c.ctx.createBufferSource();
  src.buffer = c.noise;

  const lp = c.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(from, at);
  lp.frequency.exponentialRampToValueAtTime(to, at + dur);

  const env = c.ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + dur * 0.25);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  src.connect(lp).connect(env).connect(c.master);
  src.start(at, Math.random() * (NOISE_SECONDS - dur - 0.01));
  src.stop(at + dur + 0.02);
}

/** Несколько щелчков подряд — стопка фишек. */
function chipRun(c: Ctx, at: number, gain: number, count: number, spread: number): void {
  for (let i = 0; i < count; i++) {
    const jitter = (Math.random() - 0.5) * spread * 0.4;
    chip(
      c,
      at + (i * spread) / count + jitter,
      gain * (0.75 + Math.random() * 0.5),
      2600 + Math.random() * 2600,
      0.035 + Math.random() * 0.03,
    );
  }
}

/**
 * Короткий шорох карты: скользнула по сукну. Из него собраны и раздача, и
 * карта борда, и раскрытие — разной длины и яркости.
 */
function cardSlide(c: Ctx, at: number, gain: number, cut: number, dur: number): void {
  const src = c.ctx.createBufferSource();
  src.buffer = c.noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.3;

  const bp = c.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(cut, at);
  bp.frequency.exponentialRampToValueAtTime(cut * 0.5, at + dur);
  bp.Q.value = 0.8;

  const env = c.ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  src.connect(bp).connect(env).connect(c.master);
  src.start(at, Math.random() * (NOISE_SECONDS - dur - 0.01));
  src.stop(at + dur + 0.02);
}

/**
 * Сброс карт. Ради него всё и затевалось: по этому звуку должно быть понятно,
 * что кто-то выбросил карты, даже если не смотреть на подпись действия.
 * Поэтому он не из семейства фишек — это шлепок бумаги о сукно.
 */
const FOLD_VARIANTS = [
  { cut: 1900, dur: 0.075, thumpFreq: 150 },
  { cut: 1550, dur: 0.09, thumpFreq: 135 },
  { cut: 2200, dur: 0.065, thumpFreq: 165 },
];
let foldVariant = 0;

function cardDrop(c: Ctx, at: number, gain: number): void {
  const v = FOLD_VARIANTS[foldVariant % FOLD_VARIANTS.length];
  foldVariant++;

  const src = c.ctx.createBufferSource();
  src.buffer = c.noise;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;

  const lp = c.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(v.cut, at);
  lp.frequency.exponentialRampToValueAtTime(v.cut * 0.35, at + v.dur);

  const env = c.ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, at + v.dur);

  src.connect(lp).connect(env).connect(c.master);
  src.start(at, Math.random() * (NOISE_SECONDS - v.dur - 0.01));
  src.stop(at + v.dur + 0.02);

  thump(c, at + 0.008, gain * 0.5, v.thumpFreq, 0.06);
}

function render(c: Ctx, name: Name, gain: number): void {
  const t = c.ctx.currentTime + 0.01;
  switch (name) {
    case 'blind': chipRun(c, t, gain, 1, 0.02); break;
    case 'call': chipRun(c, t, gain, 2, 0.05); break;
    case 'bet': chipRun(c, t, gain, 3, 0.08); break;
    case 'raise': chipRun(c, t, gain, 4, 0.11); break;
    case 'allin':
      chipRun(c, t, gain, 7, 0.22);
      thump(c, t + 0.02, gain * 0.55, 110, 0.13);
      break;
    case 'fold': cardDrop(c, t, gain); break;
    case 'check': chip(c, t, gain, 1500, 0.02); break;
    case 'collect': sweep(c, t, gain, 3200, 700, 0.19); break;
    case 'deal': cardSlide(c, t, gain, 3400, 0.045); break;
    case 'card': cardSlide(c, t, gain, 2600, 0.075); thump(c, t + 0.01, gain * 0.3, 190, 0.05); break;
    case 'reveal': cardSlide(c, t, gain, 3000, 0.06); break;
    case 'win':
      chipRun(c, t, gain, 5, 0.24);
      break;
  }
}

export function createWebAudioEngine(): SoundEngine {
  let c: Ctx | null = null;
  let failed = false;

  const build = (): Ctx | null => {
    if (c || failed) return c;
    // Контекст создаётся только по действию пользователя: до этого браузер его
    // всё равно держит заблокированным, а лишний висящий контекст ни к чему.
    const Ctor: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctor) { failed = true; return null; }

    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);

      const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      c = { ctx, master, noise };
      return c;
    } catch {
      failed = true;
      return null;
    }
  };

  return {
    unlock() {
      const built = build();
      // resume возвращает промис и может отклониться, если жеста всё-таки не
      // было — молча, без единой ошибки в консоли.
      if (built && built.ctx.state === 'suspended') void built.ctx.resume().catch(() => {});
    },
    ready() {
      return c !== null && c.ctx.state === 'running';
    },
    play(name, gain) {
      const built = build();
      if (!built || built.ctx.state !== 'running') return;
      try {
        render(built, name, gain);
      } catch {
        // Один непроигравшийся звук не повод ронять раздачу.
      }
    },
  };
}
