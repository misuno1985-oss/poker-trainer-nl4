/**
 * Звук стола и подпись десятки.
 *
 * Проверяется то, что должно быть правдой независимо от браузера: какое
 * действие каким звуком озвучивается, что выключенный звук выключен совсем,
 * что настройка переживает перезагрузку, что переигрывание не сыплет лишними
 * звуками и что быстрая серия ходов не превращается в трескотню.
 *
 * Сам синтез (Web Audio) сюда не входит намеренно: он подставляется снаружи,
 * и вместо него здесь стоит счётчик.
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AudioManager, loadSettings, type SoundEngine } from '../src/audio/manager';
import { diffLog, soundForAction, soundForStreet, type SoundName } from '../src/audio/events';
import type { Action } from '../src/game/types';
import { RANKS, makeCard, parseCard } from '../src/engine/cards';
import { rankLabel, cardRankLabel, isTen, TEN } from '../src/ui/rankLabel';
import { ALL_CLASSES, parseRange } from '../src/engine/range';
import { HAND_PERCENTILE } from '../src/bots/handRank';

/* ------------------------------------------------------------------ */
/* Заглушки                                                            */
/* ------------------------------------------------------------------ */

function fakeEngine() {
  const played: Array<{ name: SoundName; gain: number }> = [];
  const engine: SoundEngine = {
    play: (name, gain) => { played.push({ name, gain }); },
    unlock: () => {},
    ready: () => true,
  };
  return { engine, played };
}

/** Управляемые часы: без них тест на наложение зависел бы от скорости машины. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const action = (kind: Action['kind'], extra: Partial<Action> = {}): Action => ({
  seat: 1, street: 'flop', kind, amount: 0, total: 0, allIn: false, ...extra,
});

/* ------------------------------------------------------------------ */
/* Какое действие как звучит                                           */
/* ------------------------------------------------------------------ */

describe('действие → звук', () => {
  it('ставки, коллы и повышения звучат фишками', () => {
    expect(soundForAction(action('bet'))).toBe('bet');
    expect(soundForAction(action('call'))).toBe('call');
    expect(soundForAction(action('raise'))).toBe('raise');
    expect(soundForAction(action('post'))).toBe('blind');
  });

  it('у сброса карт свой отдельный звук, не из семейства фишек', () => {
    const fold = soundForAction(action('fold'));
    expect(fold).toBe('fold');
    // Именно отдельный: по нему должно быть слышно, что кто-то выбросил карты,
    // даже не глядя на подпись действия.
    expect(fold).not.toBe('call');
    expect(fold).not.toBe('bet');
    expect(fold).not.toBe('check');
  });

  it('у чека свой тихий звук', () => {
    expect(soundForAction(action('check'))).toBe('check');
  });

  it('олл-ин слышно отдельно, каким бы действием он ни был сделан', () => {
    expect(soundForAction(action('call', { allIn: true }))).toBe('allin');
    expect(soundForAction(action('raise', { allIn: true }))).toBe('allin');
    expect(soundForAction(action('bet', { allIn: true }))).toBe('allin');
  });

  it('смена улицы собирает банк, а начало раздачи — нет', () => {
    expect(soundForStreet('preflop', 'flop')).toBe('collect');
    expect(soundForStreet('turn', 'river')).toBe('collect');
    expect(soundForStreet('flop', 'flop')).toBeNull();
    expect(soundForStreet('river', 'preflop')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Выключатель и громкость                                             */
/* ------------------------------------------------------------------ */

/** Тесты идут в node, где localStorage нет. Подставляем свой на время. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
}

describe('выключатель звука', () => {
  // В node глобальная localStorage может существовать как undefined.
  const had = typeof globalThis.localStorage !== 'undefined';
  beforeAll(() => {
    if (!had) Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  });
  afterAll(() => {
    if (!had) Reflect.deleteProperty(globalThis as object, 'localStorage');
  });
  beforeEach(() => localStorage.clear());

  it('по умолчанию звук включён', () => {
    expect(loadSettings()).toEqual({ enabled: true, level: 'normal' });
  });

  it('SOUND OFF не пропускает ни одного звука', () => {
    const { engine, played } = fakeEngine();
    const c = clock();
    const m = new AudioManager(engine, c.now, { enabled: false, level: 'normal' });

    for (const name of ['bet', 'call', 'raise', 'allin', 'fold', 'check', 'collect', 'win', 'blind'] as SoundName[]) {
      c.advance(1000);
      expect(m.play(name)).toBe(false);
    }
    expect(played).toEqual([]);
  });

  it('настройка сохраняется и читается после перезагрузки', () => {
    const { engine } = fakeEngine();
    const m = new AudioManager(engine, () => 0);
    m.setEnabled(false);
    m.setLevel('low');

    // Новый запуск приложения читает то же самое из localStorage.
    expect(loadSettings()).toEqual({ enabled: false, level: 'low' });
    const fresh = new AudioManager(fakeEngine().engine, () => 0);
    expect(fresh.enabled).toBe(false);
    expect(fresh.level).toBe('low');
  });

  it('тихий режим действительно тише обычного', () => {
    const normal = fakeEngine();
    const low = fakeEngine();
    new AudioManager(normal.engine, () => 0, { enabled: true, level: 'normal' }).play('raise');
    new AudioManager(low.engine, () => 0, { enabled: true, level: 'low' }).play('raise');
    expect(low.played[0].gain).toBeLessThan(normal.played[0].gain);
  });

  it('громкость всех звуков остаётся низкой', () => {
    const { engine, played } = fakeEngine();
    const c = clock();
    const m = new AudioManager(engine, c.now);
    for (const name of ['bet', 'raise', 'allin', 'fold', 'win'] as SoundName[]) {
      c.advance(1000);
      m.play(name);
    }
    // Ни один звук не должен бить по ушам рядом с музыкой или видео.
    for (const p of played) expect(p.gain).toBeLessThanOrEqual(0.2);
  });
});

/* ------------------------------------------------------------------ */
/* Наложение                                                           */
/* ------------------------------------------------------------------ */

describe('быстрая серия ходов не превращается в кашу', () => {
  it('один и тот же звук подряд не повторяется мгновенно', () => {
    const { engine, played } = fakeEngine();
    const c = clock();
    const m = new AudioManager(engine, c.now);

    expect(m.play('fold')).toBe(true);
    c.advance(10);
    expect(m.play('fold')).toBe(false);
    c.advance(100);
    expect(m.play('fold')).toBe(true);
    expect(played).toHaveLength(2);
  });

  it('в коротком окне звучит ограниченное число звуков', () => {
    const { engine, played } = fakeEngine();
    const c = clock();
    const m = new AudioManager(engine, c.now);

    // Десять разных действий подряд, почти одновременно.
    const names: SoundName[] = ['bet', 'call', 'raise', 'fold', 'check', 'allin', 'win', 'collect', 'blind', 'bet'];
    for (const n of names) { m.play(n); c.advance(5); }
    expect(played.length).toBeLessThanOrEqual(4);

    // Когда шквал прошёл, звук снова работает.
    c.advance(1000);
    expect(m.play('bet')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Переигрывание                                                       */
/* ------------------------------------------------------------------ */

describe('переигрывание не создаёт лишних звуков', () => {
  const log = (n: number): Action[] => Array.from({ length: n }, () => action('call'));

  it('первый кадр догоняет состояние молча', () => {
    const d = diffLog(null, 'h1', log(5));
    expect(d.fresh).toEqual([]);
    expect(d.cursor.seen).toBe(5);
  });

  it('озвучиваются только новые действия', () => {
    const d = diffLog({ hand: 'h1', seen: 3 }, 'h1', log(6));
    expect(d.fresh).toHaveLength(3);
  });

  it('пересборка раздачи — это откат, а не события', () => {
    // Было десять действий, раздачу переиграли: протокол снова из двух блайндов.
    const d = diffLog({ hand: 'h1', seen: 10 }, 'h1', log(2));
    expect(d.fresh).toEqual([]);
    expect(d.cursor.seen).toBe(2);
  });

  it('новая раздача звучит с самого начала, включая блайнды', () => {
    const d = diffLog({ hand: 'h1', seen: 10 }, 'h2', log(2));
    expect(d.fresh).toHaveLength(2);
  });

  it('повторный кадр без изменений молчит', () => {
    const l = log(4);
    const first = diffLog({ hand: 'h1', seen: 0 }, 'h1', l);
    expect(first.fresh).toHaveLength(4);
    const second = diffLog(first.cursor, 'h1', l);
    expect(second.fresh).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Звук ничего не решает в покере                                      */
/* ------------------------------------------------------------------ */

describe('звук отделён от игры', () => {
  it('аудио-слой не импортирует ни движок, ни тренера, ни ботов', () => {
    for (const file of ['manager.ts', 'engine.ts', 'index.ts']) {
      const src = readFileSync(new URL(`../src/audio/${file}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/from '\.\.\/(game|coach|bots|app)\//);
    }
    // events.ts читает только типы действий — ничего исполняемого.
    const events = readFileSync(new URL('../src/audio/events.ts', import.meta.url), 'utf8');
    expect(events).toMatch(/import type \{ Action, Street \} from '\.\.\/game\/types'/);
    expect(events).not.toMatch(/^import \{/m);
  });

  it('проигрывание звука не трогает переданное действие', () => {
    const { engine } = fakeEngine();
    const m = new AudioManager(engine, () => 0);
    const a = action('raise', { total: 120, amount: 100 });
    const before = JSON.stringify(a);
    m.play(soundForAction(a)!);
    expect(JSON.stringify(a)).toBe(before);
  });
});

/* ------------------------------------------------------------------ */
/* Десятка                                                             */
/* ------------------------------------------------------------------ */

describe('десятка на карте', () => {
  it('на экране это «10», а не «T»', () => {
    expect(rankLabel(TEN)).toBe('10');
    for (const suit of [0, 1, 2, 3]) {
      expect(cardRankLabel(makeCard(TEN, suit))).toBe('10');
      expect(isTen(makeCard(TEN, suit))).toBe(true);
    }
  });

  it('остальные достоинства не изменились', () => {
    const expected = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    expect(Array.from({ length: 13 }, (_, r) => rankLabel(r))).toEqual(expected);
  });

  it('внутренняя нотация по-прежнему T', () => {
    expect(RANKS[TEN]).toBe('T');
    expect(RANKS).toBe('23456789TJQKA');
    // Разбор карт, подписи классов рук и таблица силы — всё на прежней
    // однобуквенной нотации, её подмена в интерфейсе не касается.
    expect(parseCard('Ts')).toBe(makeCard(TEN, 3));

    const labels = ALL_CLASSES.map((c) => c.label);
    for (const want of ['TT', 'ATs', 'T9o', 'JTs', 'QTo']) {
      expect(labels, want).toContain(want);
    }
    expect(labels.some((l) => l.includes('10'))).toBe(false);

    expect(HAND_PERCENTILE.TT).toBeGreaterThan(0);
    expect(HAND_PERCENTILE.ATs).toBeGreaterThan(0);

    const parsed = parseRange('TT+, ATs, T9s');
    expect(parsed.errors).toEqual([]);
    expect(parsed.range.size).toBeGreaterThan(0);
  });

  it('подмена живёт только в интерфейсе', () => {
    const cards = readFileSync(new URL('../src/engine/cards.ts', import.meta.url), 'utf8');
    expect(cards).not.toContain("'10'");
    const label = readFileSync(new URL('../src/ui/rankLabel.ts', import.meta.url), 'utf8');
    expect(label).toContain("'10'");
  });
});
