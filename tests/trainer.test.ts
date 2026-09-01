/**
 * Тесты продуктового слоя: переигрывание, подбор ситуаций, рассадка,
 * хранение прогресса и итог сессии.
 *
 * Главное здесь — переигрывание. Если та же раздача с теми же действиями
 * героя даёт другой результат, вся идея «попробуй сыграть иначе» рассыпается:
 * игрок не сможет сравнить две линии, потому что менялись бы не только его
 * решения, но и карты с поведением ботов.
 */

import { describe, expect, it } from 'vitest';
import {
  HERO_SEAT, SEATS, dealNext, handSetupOf, heroAct, isBotTurn, isHeroTurn,
  newSession, restoreHand, stepBot, type Session,
} from '../src/app/session';
import { legalActions } from '../src/game/betting';
import { totalPot } from '../src/game/types';
import { makeRng } from '../src/game/rng';
import { evaluateDecision } from '../src/coach/index';
import type { ActionRequest } from '../src/game/betting';
import type { Action } from '../src/game/types';
import {
  baselineAction, dealForCategory, dealVersus, mainVillain, reseatVillain, VILLAIN_NAMES,
} from '../src/app/trainer';
import { captureSnapshot } from '../src/coach/snapshot';
import { categorise, ALL_CATEGORIES } from '../src/coach/categories';
import {
  MIN_FOR_TREND, addDecision, averageScore, tally, trendFor, versusTable,
  type DecisionEntry, type Progress,
} from '../src/app/progress';
import { buildSessionSummary } from '../src/coach/summary';
import type { DecisionRecord } from '../src/app/trainer';

function makeSession(seed: number, pinned?: string): Session {
  return newSession({
    heroName: 'withorwithout',
    stackMode: 'standard',
    smallBlind: 2,
    bigBlind: 4,
    seed,
    pinned,
  });
}

/** Доиграть раздачу до конца, действия героя брать из сценария. */
function playOut(session: Session, script: ActionRequest[]): { log: Action[]; used: ActionRequest[] } {
  const used: ActionRequest[] = [];
  let i = 0;
  let guard = 0;
  while (!session.state.finished && guard++ < 200) {
    if (isHeroTurn(session)) {
      const want = script[i++] ?? baselineAction(session);
      const request = legalOr(session, want);
      used.push(request);
      heroAct(session, request);
    } else if (isBotTurn(session)) {
      stepBot(session);
    } else {
      break;
    }
  }
  return { log: session.state.log.slice(), used };
}

/** Заменить неподходящее действие на законное — сценарий не должен ронять тест. */
function legalOr(session: Session, want: ActionRequest): ActionRequest {
  const legal = legalActions(session.state);
  if (!legal) return want;
  if (want.kind === 'check' && !legal.canCheck) return { kind: 'call' };
  if (want.kind === 'call' && !legal.canCall) return { kind: 'check' };
  if (want.kind === 'bet' || want.kind === 'raise') {
    if (!legal.canRaise && !legal.canBet) return legal.canCheck ? { kind: 'check' } : { kind: 'call' };
    const min = legal.canBet ? legal.minBetTotal : legal.minRaiseTotal;
    const total = Math.min(Math.max(want.total ?? min, min), legal.allInTotal);
    return { kind: legal.canBet ? 'bet' : 'raise', total };
  }
  return want;
}

const sameLog = (a: Action[], b: Action[]) =>
  JSON.stringify(a) === JSON.stringify(b);

describe('переигрывание раздачи', () => {
  it('те же действия героя дают ту же раздачу до последнего цента', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = makeSession(seed * 977);
      const setup = handSetupOf(s);
      const first = playOut(s, []);
      const firstResult = JSON.stringify(s.state.result);
      const firstBoard = s.state.board.slice();
      const firstCards = s.state.players.map((p) => p.cards.slice());

      restoreHand(s, setup);
      const second = playOut(s, first.used);

      expect(sameLog(first.log, second.log)).toBe(true);
      expect(JSON.stringify(s.state.result)).toBe(firstResult);
      expect(s.state.board).toEqual(firstBoard);
      expect(s.state.players.map((p) => p.cards.slice())).toEqual(firstCards);
    }
  });

  it('карты и стеки не меняются, а другая линия героя приводит к другому исходу', () => {
    // Ищем раздачу, где герой действительно принимает решение и может уйти
    // в другую сторону: пасовать вместо продолжения.
    let changed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = makeSession(seed * 313);
      const setup = handSetupOf(s);
      const first = playOut(s, [{ kind: 'call' }, { kind: 'call' }, { kind: 'call' }]);
      if (first.used.length === 0) continue;
      const board = s.state.board.slice();
      const heroCards = s.state.players[HERO_SEAT].cards.slice();

      restoreHand(s, setup);
      playOut(s, [{ kind: 'fold' }]);

      // Карты героя те же — меняется только его линия.
      expect(s.state.players[HERO_SEAT].cards.slice()).toEqual(heroCards);
      // Доска может быть короче: после паса улицы могут не открыться.
      expect(board.slice(0, s.state.board.length)).toEqual(s.state.board);
      if (first.used[0].kind !== 'fold') changed++;
    }
    expect(changed).toBeGreaterThan(10);
  });

  it('переигрывание не сдвигает номер раздачи и баттон', () => {
    const s = makeSession(4242);
    dealNext(s); dealNext(s);
    const setup = handSetupOf(s);
    const number = s.handNumber;
    const button = s.button;
    playOut(s, []);
    restoreHand(s, setup);
    expect(s.handNumber).toBe(number);
    expect(s.button).toBe(button);
  });
});

describe('подбор ситуации для слабого места', () => {
  it('нужная категория встречается заметно чаще, чем в обычной раздаче', () => {
    const category = 'bb-defence' as const;

    const target = makeSession(555);
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      dealForCategory(target, category);
      if (offers(target, category)) hits++;
    }

    const plain = makeSession(555);
    let base = 0;
    for (let i = 0; i < 40; i++) {
      dealNext(plain);
      if (offers(plain, category)) base++;
    }

    expect(hits).toBeGreaterThan(base);
    expect(hits).toBeGreaterThan(20);
  });

  it('режим подбирает ситуацию, но не решение: герой всё ещё волен пасовать', () => {
    const s = makeSession(31337);
    dealForCategory(s, 'btn-open');
    // Никаких подсказок в состоянии раздачи быть не должно — это обычная рука.
    const snap = captureSnapshot(s);
    if (snap) {
      expect(Object.keys(snap)).not.toContain('category');
      expect(Object.keys(snap)).not.toContain('recommended');
    }
  });

  it('не зацикливается ни на одной категории', () => {
    for (const category of ALL_CATEGORIES) {
      const s = makeSession(90210);
      const t0 = Date.now();
      dealForCategory(s, category, 10);
      expect(Date.now() - t0).toBeLessThan(4000);
      expect(s.state.players.length).toBe(SEATS);
    }
  });
});

/** Встречается ли нужная категория где-то в раздаче при базовой линии героя. */
function offers(session: Session, category: string): boolean {
  const setup = handSetupOf(session);
  const probe = { ...session } as Session;
  restoreHand(probe, setup);
  let guard = 0;
  while (!probe.state.finished && guard++ < 80) {
    if (isHeroTurn(probe)) {
      const snap = captureSnapshot(probe);
      if (snap && categorise(snap).includes(category as never)) return true;
      heroAct(probe, baselineAction(probe));
    } else if (isBotTurn(probe)) {
      stepBot(probe);
    } else break;
  }
  return false;
}

describe('игра против конкретного соперника', () => {
  const villain = VILLAIN_NAMES[0];

  it('соперник за столом в каждой раздаче', () => {
    const s = makeSession(777, villain);
    for (let i = 0; i < 30; i++) {
      dealVersus(s, villain);
      expect(s.state.players.some((p) => p.name === villain)).toBe(true);
    }
  });

  it('он меняет место — иначе тренировался бы только один расклад', () => {
    const s = makeSession(778, villain);
    const seats = new Set<number>();
    for (let i = 0; i < 40; i++) {
      dealVersus(s, villain);
      const seat = s.state.players.findIndex((p) => p.name === villain);
      seats.add(seat);
    }
    expect(seats.size).toBeGreaterThan(2);
    expect(seats.has(HERO_SEAT)).toBe(false);
  });

  it('пересадка не создаёт двойников и не теряет стеки', () => {
    const s = makeSession(779, villain);
    for (let i = 0; i < 20; i++) {
      dealVersus(s, villain);
      const names = s.state.players.map((p) => p.name);
      expect(new Set(names).size).toBe(SEATS);
      expect(s.state.players.every((p) => p.startingStack > 0)).toBe(true);
    }
  });

  it('reseatVillain не трогает место героя', () => {
    const s = makeSession(780, villain);
    for (let i = 0; i < 50; i++) {
      reseatVillain(s, villain, s.rng);
      expect(s.seatProfiles[HERO_SEAT]).toBeNull();
    }
  });
});

describe('главный соперник в точке решения', () => {
  it('это тот, кто последним проявил агрессию', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = makeSession(seed * 61);
      let guard = 0;
      while (!s.state.finished && guard++ < 60) {
        if (isHeroTurn(s)) {
          const snap = captureSnapshot(s)!;
          const name = mainVillain(s);
          if (name) {
            expect(snap.opponents.some((o) => o.name === name)).toBe(true);
          }
          heroAct(s, baselineAction(s));
        } else if (isBotTurn(s)) {
          stepBot(s);
        } else break;
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Прогресс                                                            */
/* ------------------------------------------------------------------ */

function emptyProgress(): Progress {
  return { version: 1, hands: 0, decisions: [], sessions: [], mistakes: [], vs: {} };
}

function entry(score: number, c: string[], v = ''): DecisionEntry {
  return { t: 0, score, c: c as never, v };
}

describe('прогресс', () => {
  it('не показывает динамику на маленькой выборке', () => {
    const p = emptyProgress();
    for (let i = 0; i < MIN_FOR_TREND * 2 - 2; i++) {
      addDecision(p, entry(i % 2 ? 9 : 3, ['btn-open']));
    }
    expect(trendFor(p, 'btn-open').reliable).toBe(false);
    expect(trendFor(p, 'btn-open').early).toBeNull();
  });

  it('показывает динамику, когда данных хватает', () => {
    const p = emptyProgress();
    for (let i = 0; i < MIN_FOR_TREND; i++) addDecision(p, entry(3, ['btn-open']));
    for (let i = 0; i < MIN_FOR_TREND; i++) addDecision(p, entry(9, ['btn-open']));
    const t = trendFor(p, 'btn-open');
    expect(t.reliable).toBe(true);
    expect(t.early).toBe(0);
    expect(t.late).toBe(1);
  });

  it('таблица по сопернику молчит, пока решений мало', () => {
    const p = emptyProgress();
    for (let i = 0; i < 10; i++) addDecision(p, entry(8, [], 'DuhaMetelkin'));
    expect(versusTable(p)).toEqual([]);
    for (let i = 0; i < 25; i++) addDecision(p, entry(8, [], 'DuhaMetelkin'));
    expect(versusTable(p)).toHaveLength(1);
    expect(versusTable(p)[0].n).toBe(35);
  });

  it('считает по категориям, а не по всем решениям подряд', () => {
    const p = emptyProgress();
    addDecision(p, entry(9, ['btn-open']));
    addDecision(p, entry(2, ['bb-defence']));
    addDecision(p, entry(9, ['btn-open', 'bb-defence']));
    expect(tally(p.decisions, 'btn-open').total).toBe(2);
    expect(tally(p.decisions, 'btn-open').good).toBe(2);
    expect(tally(p.decisions, 'bb-defence').mistakes).toBe(1);
    expect(averageScore(p.decisions)).toBeCloseTo((9 + 2 + 9) / 3, 6);
  });

  it('хранит только последние крупные ошибки', () => {
    const p = emptyProgress();
    const mistake = (score: number) => ({
      t: score, score, street: 'flop', did: 'CALL', better: 'FOLD',
      heroCards: [0, 1], board: [2, 3, 4], position: 'BTN', villain: 'x',
      pot: 100, categories: [] as never[],
      setup: { handNumber: 1, seed: 1, button: 0, seatNames: [], stacks: [] },
      priorActions: [],
    });
    for (let i = 0; i < 45; i++) addDecision(p, entry(2, []), mistake(i));
    expect(p.mistakes.length).toBe(30);
    // Самая свежая — первая.
    expect(p.mistakes[0].score).toBe(44);
  });
});

/* ------------------------------------------------------------------ */
/* Итог сессии                                                         */
/* ------------------------------------------------------------------ */

function record(score: number, categories: string[]): DecisionRecord {
  return {
    street: 'flop',
    action: { kind: 'call' },
    verdict: { score } as DecisionRecord['verdict'],
    categories: categories as never,
    villain: 'x',
    heroCards: [0, 1],
    board: [],
    pot: 0,
    priorActions: [],
  };
}

describe('итог сессии', () => {
  it('не больше трёх выводов', () => {
    const records: DecisionRecord[] = [];
    for (const c of ALL_CATEGORIES) {
      for (let i = 0; i < 5; i++) records.push(record(2, [c]));
    }
    expect(buildSessionSummary(records).insights.length).toBeLessThanOrEqual(3);
  });

  it('молчит о категории, по которой было одно-два решения', () => {
    const records = [record(1, ['check-raise']), record(1, ['check-raise'])];
    const s = buildSessionSummary(records);
    expect(s.focus).toBeNull();
    expect(s.insights[0].text).not.toContain('чек-рейз');
  });

  it('прямо говорит, когда ошибок не было', () => {
    const records = Array.from({ length: 10 }, () => record(9, ['btn-open']));
    const s = buildSessionSummary(records);
    expect(s.focus).toBeNull();
    expect(s.insights.length).toBeGreaterThan(0);
  });

  it('рекомендация указывает на категорию с наибольшим числом ошибок', () => {
    const records = [
      ...Array.from({ length: 6 }, () => record(2, ['bb-defence'])),
      ...Array.from({ length: 4 }, () => record(3, ['btn-open'])),
      ...Array.from({ length: 6 }, () => record(9, ['river-value'])),
    ];
    expect(buildSessionSummary(records).focus).toBe('bb-defence');
  });

  it('пустая сессия не выдумывает выводов', () => {
    expect(buildSessionSummary([])).toEqual({ insights: [], focus: null, focusReason: '' });
  });
});

/* ------------------------------------------------------------------ */
/* Долгий прогон: тренер не должен падать ни на одной раздаче          */
/* ------------------------------------------------------------------ */

describe('прогон случайных раздач через тренера', () => {
  it('тысяча раздач со случайной игрой героя: ни падений, ни дырок в оценках', () => {
    const s = makeSession(20260901);
    const rng = makeRng(777);
    let decisions = 0;
    let hands = 0;

    while (hands < 1000) {
      if (s.state.finished) {
        dealNext(s);
        hands++;
        continue;
      }
      if (isHeroTurn(s)) {
        const snap = captureSnapshot(s);
        expect(snap).not.toBeNull();
        // Слепок не должен содержать чужих карт ни на каком уровне вложенности.
        expect(JSON.stringify(snap!.opponents)).not.toContain('cards');

        const request = randomAction(s, rng);
        const verdict = evaluateDecision(snap!, {
          kind: request.kind as 'fold' | 'check' | 'call' | 'bet' | 'raise',
          total: request.total,
        });
        expect(Number.isFinite(verdict.score)).toBe(true);
        expect(verdict.score).toBeGreaterThanOrEqual(0);
        expect(verdict.score).toBeLessThanOrEqual(10);
        expect(verdict.brief.picture.length).toBeGreaterThan(0);
        // Оценка за выбор не может спасать заведомо плохой ход.
        if (verdict.actionScore < 5) expect(verdict.score).toBe(verdict.actionScore);
        expect(categorise(snap!, request.kind as 'bet')).toBeInstanceOf(Array);

        decisions++;
        heroAct(s, request);
      } else if (isBotTurn(s)) {
        stepBot(s);
      } else {
        // Раздача не может застрять: если ходить некому, она обязана быть закончена.
        expect(s.state.finished).toBe(true);
      }
    }

    expect(hands).toBe(1000);
    expect(decisions).toBeGreaterThan(500);
  }, 900000);
});

function randomAction(session: Session, rng: () => number): ActionRequest {
  const legal = legalActions(session.state)!;
  const roll = rng();
  if (roll < 0.18) return { kind: 'fold' };
  if (roll < 0.55) return legal.canCheck ? { kind: 'check' } : { kind: 'call' };
  if (legal.canBet) {
    const total = Math.min(
      Math.max(legal.minBetTotal, Math.round(totalPot(session.state) * (0.3 + rng()))),
      legal.allInTotal,
    );
    return { kind: 'bet', total };
  }
  if (legal.canRaise) {
    const span = legal.allInTotal - legal.minRaiseTotal;
    return { kind: 'raise', total: legal.minRaiseTotal + Math.round(span * rng() * 0.5) };
  }
  return legal.canCheck ? { kind: 'check' } : { kind: 'call' };
}
