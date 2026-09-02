/**
 * Архив последних сессий и выдача банка победителю.
 *
 * Главное обещание архива: файл, скачанный через три дня, совпадает с тем,
 * который скачался бы сразу после игры. Держится оно не на аккуратности, а на
 * том, что оба файла собирает один и тот же `makeExport` — это здесь и
 * проверяется, вместе с правилом вытеснения и с тем, что отказ хранилища
 * ничего не ломает.
 */

import { describe, expect, it } from 'vitest';

import { ARCHIVE_LIMIT, keepNewest } from '../src/app/sessionArchive';
import { makeExport, type Totals } from '../src/app/exportBundle';
import type { SessionLog, LoggedHand } from '../src/app/sessionLog';
import type { Progress } from '../src/app/progress';
import { buildPlan, AWARD_MS, HIGHLIGHT_MS, type Cue, type TableSnapshot } from '../src/ui/tableTimeline';
import { FINALE_MS, TOTAL_DELAY_MS } from '../src/app/autoNext';
import type { Action } from '../src/game/types';

/* ------------------------------------------------------------------ */
/* Заготовки                                                           */
/* ------------------------------------------------------------------ */

function emptyProgress(): Progress {
  return { version: 1, hands: 0, decisions: [], sessions: [], mistakes: [], vs: {} };
}

function hand(n: number, seed: number, replay = false): LoggedHand {
  return {
    handNumber: n,
    setup: { handNumber: n, seed, button: 0, seatNames: ['я', 'a', 'b', 'c', 'd', 'e'], stacks: [400, 400, 400, 400, 400, 400] },
    seats: [0, 1, 2, 3, 4, 5].map((seat) => ({
      seat, name: seat === 0 ? 'я' : `bot${seat}`, isHero: seat === 0,
      position: 'BTN' as const, startingStackCents: 400, endingStackCents: 400,
    })),
    heroSeat: 0,
    heroCards: [51, 47],
    board: [0, 1, 2],
    log: [],
    decisions: [],
    result: null,
    heroNetCents: replay ? 5000 : 100 * n,
    potCents: 40,
    showdown: false,
    actualHoleCards: [],
    startedAt: 1000,
    endedAt: 2000,
    autoAdvanced: true,
    pausedAfter: false,
    isReplay: replay,
    replayCount: replay ? 1 : 0,
  };
}

function log(id: string, endedAt: number, hands: LoggedHand[]): SessionLog {
  return {
    id, mode: 'session', modeDetail: null, targetHands: hands.length,
    startedAt: endedAt - 60_000, endedAt,
    smallBlindCents: 2, bigBlindCents: 4, heroName: 'я', hands,
  };
}

const totals: Totals = {
  score: 7.25, net: 142, good: 8, borderline: 2, mistakes: 1, major: 0, records: [],
};

/* ------------------------------------------------------------------ */
/* Вытеснение старых                                                   */
/* ------------------------------------------------------------------ */

describe('в архиве остаются пять последних', () => {
  const row = (id: string, endedAt: number) => ({ id, endedAt });

  it('пока сессий меньше пяти, ничего не теряется', () => {
    let kept: Array<{ id: string; endedAt: number }> = [];
    for (let i = 1; i <= 4; i++) kept = keepNewest(kept, row(`s${i}`, i));
    expect(kept.map((r) => r.id).sort()).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('шестая вытесняет самую старую, остаются со второй по шестую', () => {
    let kept: Array<{ id: string; endedAt: number }> = [];
    for (let i = 1; i <= 6; i++) kept = keepNewest(kept, row(`s${i}`, i));
    expect(kept).toHaveLength(ARCHIVE_LIMIT);
    expect(kept.map((r) => r.id)).toEqual(['s6', 's5', 's4', 's3', 's2']);
    expect(kept.map((r) => r.id)).not.toContain('s1');
  });

  it('список отсортирован свежими вверх', () => {
    const kept = keepNewest([row('старая', 10), row('свежая', 30)], row('средняя', 20));
    expect(kept.map((r) => r.id)).toEqual(['свежая', 'средняя', 'старая']);
  });

  it('повторная запись той же сессии не создаёт дубль', () => {
    const kept = keepNewest([row('s1', 10)], row('s1', 20));
    expect(kept).toHaveLength(1);
    expect(kept[0].endedAt).toBe(20);
  });
});

/* ------------------------------------------------------------------ */
/* Что именно сохраняется                                              */
/* ------------------------------------------------------------------ */

describe('в архив попадает полный файл, а не краткий итог', () => {
  const session = log('s1', 5_000_000, [hand(1, 111), hand(2, 222)]);
  const bundle = makeExport(session, totals, emptyProgress(), 5_000_000);

  it('запись архива несёт ту же выгрузку, что уходит в файл', () => {
    expect(bundle.record.payload).toBe(bundle.payload);
  });

  it('внутри — раздачи, а не только цифры итога', () => {
    const payload = bundle.payload as any;
    expect(payload.hands).toHaveLength(2);
    expect(payload.hands[0].deterministicSetup.seed).toBe(111);
    expect(payload.hands[0].seats).toHaveLength(6);
    expect(payload.hands[0].omniscient.hiddenFromHeroDuringPlay).toBe(true);
    expect(payload.opponentProfiles).toBeTruthy();
    expect(payload.schemaVersion).toBe(1);
  });

  it('строка для списка читается без разворачивания файла', () => {
    const r = bundle.record;
    expect(r.id).toBe('s1');
    expect(r.hands).toBe(2);
    expect(r.decisionScore).toBe(7.25);
    expect(r.netCents).toBe(142);
    expect(r.fileName).toMatch(/^NL4-session-.*2hands\.json$/);
    expect(typeof r.endedAt).toBe('number');
  });

  it('скачанное из архива совпадает с тем, что скачалось бы сразу', () => {
    // Один и тот же сборщик, одно и то же время — файл обязан совпасть.
    const now = makeExport(session, totals, emptyProgress(), 5_000_000);
    const later = makeExport(session, totals, emptyProgress(), 5_000_000);
    expect(JSON.stringify(later.payload)).toBe(JSON.stringify(now.payload));
    expect(later.fileName).toBe(now.fileName);
  });

  it('вся запись переживает JSON: её можно положить в хранилище', () => {
    // IndexedDB хранит структурно клонируемое; JSON — заведомо более строгая
    // проверка, и если проходит она, пройдёт и клонирование.
    expect(() => JSON.parse(JSON.stringify(bundle.record))).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* Переигрывание                                                       */
/* ------------------------------------------------------------------ */

describe('переигрывание не создаёт вторую сессию', () => {
  const withReplay = log('s1', 5_000_000, [hand(1, 111), hand(2, 222), hand(2, 222, true)]);
  const bundle = makeExport(withReplay, totals, emptyProgress(), 5_000_000);

  it('в счёт идут только оригинальные раздачи', () => {
    expect(bundle.record.hands).toBe(2);
    expect((bundle.payload as any).session.handsPlayed).toBe(2);
    expect((bundle.payload as any).session.replayedHands).toBe(1);
  });

  it('переигранная раздача не меняет ни денег, ни оценки', () => {
    const payload = bundle.payload as any;
    // У переигранной руки в заготовке стоит заведомо огромный выигрыш.
    const last = payload.session.timeline[payload.session.timeline.length - 1];
    expect(last.cumulativeNet.cents).toBe(100 + 200);
    expect(payload.session.result.decisionScore).toBe(7.25);
  });

  it('одна сыгранная сессия — одна запись архива', () => {
    // Идентификатор берётся от сессии, а не от раздачи: сколько бы раз ни
    // переигрывали, запись остаётся одна.
    const again = makeExport(withReplay, totals, emptyProgress(), 6_000_000);
    expect(again.record.id).toBe(bundle.record.id);
    expect(keepNewest([bundle.record], again.record)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Отказ хранилища                                                     */
/* ------------------------------------------------------------------ */

describe('отказ хранилища не ломает тренажёр', () => {
  it('файл собирается из памяти и от архива не зависит', () => {
    // makeExport вообще не обращается к хранилищу: скачать «прямо сейчас»
    // можно даже когда архив недоступен.
    const src = readSource('src/app/exportBundle.ts');
    expect(src).not.toContain('indexedDB');
    expect(src).not.toContain('localStorage');
    expect(src).not.toContain('saveSession');
  });

  it('архив ничего не знает о покерной части', () => {
    const src = readSource('src/app/sessionArchive.ts');
    expect(src).not.toMatch(/from '\.\.\/(game|coach|bots)\//);
  });

  it('сохранение сначала пишет новую запись и только потом чистит старые', () => {
    const src = readSource('src/app/sessionArchive.ts');
    const write = src.indexOf('write.objectStore(STORE).put(record)');
    const trim = src.indexOf('store.delete(old.id)');
    expect(write).toBeGreaterThan(0);
    expect(trim).toBeGreaterThan(write);
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:fs').readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8') as string;
}

/* ------------------------------------------------------------------ */
/* Выдача банка победителю                                             */
/* ------------------------------------------------------------------ */

const SEATS = 6;

function snap(over: Partial<TableSnapshot> = {}): TableSnapshot {
  return {
    hand: 'h1', street: 'river', log: [], board: 5, button: 0,
    folded: [], shown: [], finished: false, winners: [],
    committed: [0, 0, 0, 0, 0, 0], ...over,
  };
}
const awards = (cues: Cue[]) => cues.filter((c) => c.kind.type === 'award');

describe('банк уходит победителю', () => {
  it('одно событие несёт и движение фишек, и звук выигрыша', () => {
    const cues = buildPlan(snap(), snap({ finished: true, winners: [3] }), SEATS).cues;
    const award = awards(cues);
    expect(award).toHaveLength(1);
    expect(award[0].kind).toEqual({ type: 'award', seats: [3] });
    // Тот же самый вызов — значит подсветка и звук начинаются вместе.
    expect(award[0].sound).toBe('win');
  });

  it('герой и бот получают банк одинаково', () => {
    const heroWin = awards(buildPlan(snap(), snap({ finished: true, winners: [0] }), SEATS).cues);
    const botWin = awards(buildPlan(snap(), snap({ finished: true, winners: [4] }), SEATS).cues);
    expect(heroWin[0].sound).toBe(botWin[0].sound);
    expect(heroWin[0].kind.type).toBe(botWin[0].kind.type);
  });

  it('делёж банка — фишки едут каждому победителю', () => {
    const cues = buildPlan(snap(), snap({ finished: true, winners: [1, 4] }), SEATS).cues;
    const award = awards(cues);
    // Одно событие, но с обоими местами: и звук один, а не по звуку на игрока.
    expect(award).toHaveLength(1);
    expect(award[0].kind).toEqual({ type: 'award', seats: [1, 4] });
  });

  it('повторы в списке победителей не удваивают выдачу', () => {
    const cues = buildPlan(snap(), snap({ finished: true, winners: [2, 2] }), SEATS).cues;
    expect((awards(cues)[0].kind as { seats: number[] }).seats).toEqual([2]);
  });

  it('выигрыш без вскрытия выглядит так же', () => {
    const cues = buildPlan(
      snap({ street: 'flop', board: 3 }),
      snap({ street: 'flop', board: 3, finished: true, winners: [0], folded: [1, 2, 3, 4, 5] }),
      SEATS,
    ).cues;
    expect(awards(cues)).toHaveLength(1);
    expect(awards(cues)[0].sound).toBe('win');
  });

  it('пересборка раздачи не выдаёт банк заново', () => {
    // Переигрывание: протокол стал короче — это откат, а не событие.
    const before = snap({ finished: true, winners: [3], log: [{ seat: 0, street: 'river', kind: 'call', amount: 10, total: 10, allIn: false } as Action] });
    const after = snap({ street: 'preflop', board: 0, log: [] });
    const plan = buildPlan(before, after, SEATS);
    expect(plan.cues).toEqual([]);
    expect(plan.jump).toBe(true);
  });

  it('пока раздача не кончилась, банк никому не едет', () => {
    expect(awards(buildPlan(snap(), snap({ winners: [3] }), SEATS).cues)).toHaveLength(0);
  });

  it('выдача ничего не меняет в самой раздаче', () => {
    const before = snap();
    const after = snap({ finished: true, winners: [2] });
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);
    buildPlan(before, after, SEATS);
    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(JSON.stringify(after)).toBe(afterJson);
  });
});

describe('выдача и следующая раздача', () => {
  it('следующая раздача ждёт, пока фишки доедут', () => {
    expect(FINALE_MS).toBeGreaterThan(AWARD_MS);
  });

  it('и пока догорит золотая подсветка', () => {
    expect(TOTAL_DELAY_MS).toBeGreaterThan(AWARD_MS + HIGHLIGHT_MS);
  });

  it('подсветка не вечная', () => {
    expect(HIGHLIGHT_MS).toBeGreaterThanOrEqual(800);
    expect(HIGHLIGHT_MS).toBeLessThanOrEqual(1200);
  });

  it('перелёт короткий, в ритме остальных анимаций стола', () => {
    expect(AWARD_MS).toBeGreaterThanOrEqual(250);
    expect(AWARD_MS).toBeLessThanOrEqual(450);
  });

  it('после выдачи временные фишки убираются, а подсветка гаснет позже', () => {
    const src = readSource('src/ui/useTableTimeline.ts');
    // Сначала исчезают фишки, потом снимается подсветка — и обе уборки есть.
    const chips = src.indexOf("after(AWARD_MS, () => setAnim((c) => ({ ...c, awarding: [] })))");
    const glow = src.indexOf('after(AWARD_MS + HIGHLIGHT_MS');
    expect(chips).toBeGreaterThan(0);
    expect(glow).toBeGreaterThan(chips);
  });

  it('при «меньше движения» банк не летит через стол', () => {
    const css = readSource('src/styles/trainer.css');
    const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.pot-award');
    // А подсветка остаётся — это состояние, а не движение.
    expect(block).toContain('seat-winner');
  });
});
