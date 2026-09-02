/**
 * Выгрузка сессии и автопереход между раздачами.
 *
 * Главная проверка здесь — не «есть ли поле», а можно ли по одному файлу, без
 * доступа к приложению, восстановить каждую раздачу и каждое решение. Поэтому
 * тесты играют настоящую сессию настоящим движком, выгружают её и разбирают
 * получившийся JSON так, как это делал бы посторонний.
 *
 * И отдельно — правило, на котором стоит весь тренер: в слепке решения не
 * должно быть чужих карт. Настоящие карты лежат только в помеченном блоке.
 */

import { describe, expect, it } from 'vitest';

import {
  HERO_SEAT, dealNext, handSetupOf, heroAct, isBotTurn, isHeroTurn, newSession, stepBot,
  type Session,
} from '../src/app/session';
import { legalActions, type ActionRequest } from '../src/game/betting';
import { totalPot } from '../src/game/types';
import { captureSnapshot, evaluateDecision } from '../src/coach/index';
import { categorise } from '../src/coach/categories';
import { mainVillain } from '../src/app/trainer';
import { PROFILES } from '../src/bots/profiles';
import {
  APP_VERSION, SCHEMA_VERSION, actionCode, buildExport, cardText, exportFileName,
  type LoggedDecision, type LoggedHand, type SessionLog, type SummaryInput,
} from '../src/app/sessionLog';

/* ------------------------------------------------------------------ */
/* Сыграть настоящую сессию и записать её так же, как это делает игра   */
/* ------------------------------------------------------------------ */

function playSession(handCount: number, seed = 4242): SessionLog {
  const session = newSession({
    heroName: 'withorwithout', stackMode: 'standard',
    smallBlind: 2, bigBlind: 4, seed,
  });
  session.handNumber = 0;

  const hands: LoggedHand[] = [];
  const startedAt = Date.now();

  for (let i = 0; i < handCount; i++) {
    dealNext(session);
    const hand = openHand(session);

    let guard = 0;
    while (!session.state.finished && guard++ < 200) {
      if (isHeroTurn(session)) {
        const request = heroChoice(session, i);
        recordDecision(session, hand, request, startedAt);
        heroAct(session, request);
      } else if (isBotTurn(session)) {
        stepBot(session);
      } else break;
    }
    closeHand(session, hand);
    hands.push(hand);
  }

  return {
    id: 's-test',
    mode: 'session',
    modeDetail: null,
    targetHands: handCount,
    startedAt,
    endedAt: Date.now(),
    smallBlindCents: 2,
    bigBlindCents: 4,
    heroName: 'withorwithout',
    hands,
  };
}

function openHand(session: Session): LoggedHand {
  const s = session.state;
  return {
    handNumber: session.handNumber,
    setup: handSetupOf(session),
    seats: s.players.map((p) => ({
      seat: p.seat, name: p.name, isHero: p.seat === HERO_SEAT, position: p.position,
      startingStackCents: p.startingStack, endingStackCents: p.startingStack,
    })),
    heroSeat: HERO_SEAT,
    heroCards: [...s.players[HERO_SEAT].cards] as [number, number],
    board: [], log: [], decisions: [], result: null,
    heroNetCents: 0, potCents: 0, showdown: false, actualHoleCards: [],
    startedAt: Date.now(), endedAt: 0,
    autoAdvanced: true, pausedAfter: false, isReplay: false, replayCount: 0,
  };
}

/** Герой играет разнообразно, чтобы в выгрузку попали все виды решений. */
function heroChoice(session: Session, salt: number): ActionRequest {
  const legal = legalActions(session.state)!;
  const roll = (session.handNumber * 7 + salt * 13 + session.state.log.length) % 10;
  if (roll < 2) return { kind: 'fold' };
  if (roll < 7) return legal.canCheck ? { kind: 'check' } : { kind: 'call' };
  if (legal.canBet) return { kind: 'bet', total: Math.min(legal.minBetTotal * 2, legal.allInTotal) };
  if (legal.canRaise) return { kind: 'raise', total: Math.min(legal.minRaiseTotal, legal.allInTotal) };
  return legal.canCheck ? { kind: 'check' } : { kind: 'call' };
}

function recordDecision(session: Session, hand: LoggedHand, request: ActionRequest, startedAt: number) {
  const snap = captureSnapshot(session);
  if (!snap) return;
  const verdict = evaluateDecision(snap, {
    kind: request.kind as 'fold' | 'check' | 'call' | 'bet' | 'raise',
    total: request.total,
  });
  const decision: LoggedDecision = {
    index: hand.decisions.length,
    street: session.state.street,
    snapshot: snap,
    chosen: { kind: request.kind, totalCents: request.total },
    verdict,
    categories: categorise(snap, request.kind as 'bet'),
    villain: mainVillain(session),
    atMs: Date.now() - startedAt,
  };
  hand.decisions.push(decision);
}

function closeHand(session: Session, hand: LoggedHand) {
  const s = session.state;
  const shown = s.result ? s.result.showdownSeats : [];
  hand.board = s.board.slice();
  hand.log = s.log.slice();
  hand.result = s.result;
  hand.heroNetCents = s.result ? (s.result.net[HERO_SEAT] ?? 0) : 0;
  hand.potCents = s.players.reduce((a, p) => a + p.handCommit, 0);
  hand.showdown = shown.length > 1;
  hand.endedAt = Date.now();
  hand.seats = hand.seats.map((seat) => ({ ...seat, endingStackCents: s.players[seat.seat].stack }));
  hand.actualHoleCards = s.players
    .filter((p) => p.cards[0] >= 0)
    .map((p) => ({
      seat: p.seat, name: p.name, cards: [...p.cards],
      revealedToHero: p.seat === HERO_SEAT || shown.includes(p.seat),
    }));
}

function summaryOf(log: SessionLog): SummaryInput {
  const scores = log.hands.flatMap((h) => h.decisions.map((d) => d.verdict.score));
  const net = log.hands.reduce((a, h) => a + (h.isReplay ? 0 : h.heroNetCents), 0);
  return {
    decisionScore: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0,
    netCents: net,
    good: scores.filter((s) => s >= 7.5).length,
    borderline: scores.filter((s) => s < 7.5 && s >= 5).length,
    mistakes: scores.filter((s) => s < 5).length,
    major: scores.filter((s) => s < 4).length,
    insights: [{ text: 'тест', tone: 'neutral' }],
    focus: null,
    focusReason: '',
    categories: [],
    majorMistakes: [],
  };
}

/** То, что реально уедет в файл. */
function exported(log: SessionLog, now = 1_772_000_000_000) {
  return JSON.parse(JSON.stringify(buildExport(log, summaryOf(log), PROFILES, now))) as any;
}

const LOG = playSession(6);
const OUT = exported(LOG);

/* ------------------------------------------------------------------ */
/* Файл в целом                                                        */
/* ------------------------------------------------------------------ */

describe('файл выгрузки', () => {
  it('версия схемы и приложения на месте', () => {
    expect(OUT.schemaVersion).toBe(SCHEMA_VERSION);
    expect(OUT.appVersion).toBe(APP_VERSION);
    expect(typeof OUT.exportedAt).toBe('string');
  });

  it('целиком превращается в JSON и обратно', () => {
    const text = JSON.stringify(buildExport(LOG, summaryOf(LOG), PROFILES, Date.now()), null, 2);
    expect(() => JSON.parse(text)).not.toThrow();
    // Читаемый: с отступами, а не одной строкой.
    expect(text.split('\n').length).toBeGreaterThan(100);
  });

  it('в файле нет ничего, кроме тренажёра', () => {
    const text = JSON.stringify(OUT);
    for (const forbidden of ['localStorage', 'cookie', 'token', 'password', 'userAgent', 'nl4-sound', 'nl4-trainer-progress']) {
      expect(text.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('две выгрузки одной сессии совпадают, кроме времени', () => {
    const a = exported(LOG, 1);
    const b = exported(LOG, 2);
    delete a.exportedAt;
    delete b.exportedAt;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('имя файла читаемое и с датой', () => {
    const name = exportFileName(LOG, Date.UTC(2026, 8, 2, 12, 30));
    expect(name).toMatch(/^NL4-session-\d{4}-\d{2}-\d{2}-\d{4}-6hands\.json$/);

    const weak = exportFileName({ ...LOG, mode: 'weak-spot', modeDetail: 'river-value' }, Date.now());
    expect(weak).toMatch(/^NL4-weakspot-river-value-/);

    const vs = exportFileName({ ...LOG, mode: 'versus', modeDetail: 'PokerMind' }, Date.now());
    expect(vs).toMatch(/^NL4-vs-PokerMind-/);
  });
});

/* ------------------------------------------------------------------ */
/* Каждая раздача                                                      */
/* ------------------------------------------------------------------ */

describe('каждая раздача восстановима', () => {
  it('число раздач совпадает с сыгранным', () => {
    expect(OUT.hands).toHaveLength(6);
    expect(OUT.session.handsPlayed).toBe(6);
  });

  it('у каждой есть зерно и расстановка — хватит, чтобы воспроизвести', () => {
    for (const h of OUT.hands) {
      expect(typeof h.deterministicSetup.seed).toBe('number');
      expect(h.deterministicSetup.seatNames).toHaveLength(6);
      expect(h.deterministicSetup.startingStacks).toHaveLength(6);
      expect(Array.isArray(h.deterministicSetup.heroActions)).toBe(true);
      expect(typeof h.deterministicSetup.button).toBe('number');
    }
  });

  it('карты героя, борд и места записаны словами, а не числами', () => {
    for (const h of OUT.hands) {
      expect(h.heroCards).toHaveLength(2);
      for (const c of h.heroCards) expect(c).toMatch(/^[23456789TJQKA][cdhs]$/);
      for (const c of h.board) expect(c).toMatch(/^[23456789TJQKA][cdhs]$/);
      expect(h.seats).toHaveLength(6);
      for (const s of h.seats) {
        expect(typeof s.nick).toBe('string');
        expect(s.position).toBeTruthy();
        expect(typeof s.startingStack.cents).toBe('number');
        expect(typeof s.endingStack.cents).toBe('number');
      }
    }
  });

  it('протокол действий полный и с суммами до и после', () => {
    for (const h of OUT.hands) {
      expect(h.actions.length).toBeGreaterThanOrEqual(2); // хотя бы блайнды
      for (const a of h.actions) {
        expect(a.action).toMatch(/^(POST_BLIND|POST|FOLD|CHECK|CALL|BET|RAISE|ALL_IN)$/);
        expect(typeof a.eventIndex).toBe('number');
        expect(a.street).toBeTruthy();
        expect(typeof a.nick).toBe('string');
        expect(a.position).toBeTruthy();
        expect(typeof a.potBefore.cents).toBe('number');
        expect(typeof a.potAfter.cents).toBe('number');
        expect(typeof a.stackBefore.cents).toBe('number');
        expect(typeof a.stackAfter.cents).toBe('number');
        expect(typeof a.streetCommitBefore.cents).toBe('number');
        expect(typeof a.streetCommitAfter.cents).toBe('number');
      }
    }
  });

  it('банк сходится с протоколом с точностью до возврата непокрытой ставки', () => {
    for (const h of OUT.hands) {
      if (h.actions.length === 0) continue;
      const last = h.actions[h.actions.length - 1];
      // Внесено по протоколу — это валовая сумма.
      expect(last.potAfter.cents).toBe(h.potContributed.cents);
      // В банке остаётся меньше ровно на возвращённую непокрытую ставку.
      expect(h.potContributed.cents - h.uncalledReturned.cents).toBe(h.pot.cents);
      expect(h.uncalledReturned.cents).toBeGreaterThanOrEqual(0);
    }
  });

  it('хотя бы в одной раздаче возврат непокрытой ставки действительно был', () => {
    // Иначе проверка выше ничего не значила бы.
    expect(OUT.hands.some((h: any) => h.uncalledReturned.cents > 0)).toBe(true);
  });

  it('результат раздачи и накопленный итог записаны', () => {
    let running = 0;
    for (const [i, h] of OUT.hands.entries()) {
      expect(typeof h.heroResult.cents).toBe('number');
      running += h.heroResult.cents;
      expect(OUT.session.timeline[i].cumulativeNet.cents).toBe(running);
      expect(OUT.session.timeline[i].handNumber).toBe(h.handNumber);
    }
    expect(OUT.session.result.netPnL.cents).toBe(running);
  });

  it('деньги везде целыми центами', () => {
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (typeof o.cents === 'number' && typeof o.display === 'string') {
        expect(Number.isInteger(o.cents)).toBe(true);
      }
      Object.values(o).forEach(walk);
    };
    walk(OUT);
  });
});

/* ------------------------------------------------------------------ */
/* Каждое решение героя                                                */
/* ------------------------------------------------------------------ */

describe('каждое решение героя разбираемо', () => {
  const decisions = () => OUT.hands.flatMap((h: any) => h.decisions);

  it('решения вообще есть', () => {
    expect(decisions().length).toBeGreaterThan(5);
  });

  it('у каждого — состояние ДО действия', () => {
    for (const d of decisions()) {
      const st = d.heroVisibleState;
      expect(st.heroCards).toHaveLength(2);
      expect(st.heroPosition).toBeTruthy();
      expect(typeof st.pot.cents).toBe('number');
      expect(typeof st.amountToCall.cents).toBe('number');
      expect(typeof st.effectiveStack.cents).toBe('number');
      expect(st.legalActions).toBeTruthy();
      expect(Array.isArray(st.opponents)).toBe(true);
      expect(Array.isArray(st.history)).toBe(true);
    }
  });

  it('выбранное действие сохранено', () => {
    for (const d of decisions()) {
      expect(d.chosenAction.action).toMatch(/^(FOLD|CHECK|CALL|BET|RAISE)$/);
      if (['BET', 'RAISE'].includes(d.chosenAction.action)) {
        expect(d.chosenAction.amountTo).not.toBeNull();
      }
    }
  });

  it('вердикт тренера сохранён целиком, а не одной оценкой', () => {
    for (const d of decisions()) {
      const c = d.coach;
      expect(typeof c.score).toBe('number');
      expect(typeof c.actionScore).toBe('number');
      expect(c.recommended.action).toBeTruthy();
      expect(c.confidence.data).toBeTruthy();
      expect(typeof c.confidence.opponentSample).toBe('number');
      expect(typeof c.confidence.closeDecision).toBe('boolean');
      expect(c.brief).toBeTruthy();
      expect(Array.isArray(c.explanation)).toBe(true);
      // Факты из базы, выводы модели и арифметика помечены отдельно.
      for (const block of c.explanation) {
        expect(['data', 'model', 'math']).toContain(block.kind);
      }
    }
  });

  it('альтернативы с ожиданием сохранены', () => {
    for (const d of decisions()) {
      expect(d.coach.alternatives.length).toBeGreaterThan(0);
      for (const alt of d.coach.alternatives) {
        expect(alt.action).toBeTruthy();
        expect(typeof alt.ev.cents).toBe('number');
        expect(typeof alt.equity).toBe('number');
      }
      // По ним видно, почему рекомендованный вариант лучше.
      const best = Math.max(...d.coach.alternatives.map((a: any) => a.ev.cents));
      expect(d.coach.recommended.ev.cents).toBe(best);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Видимое и скрытое                                                   */
/* ------------------------------------------------------------------ */

describe('видимое герою и скрытое разделены', () => {
  it('в слепке решения нет чужих карт', () => {
    for (const h of OUT.hands) {
      for (const d of h.decisions) {
        const text = JSON.stringify(d.heroVisibleState);
        expect(text).not.toContain('cards"');
        // Карты героя есть, а вот у соперников поля карт нет вовсе.
        for (const o of d.heroVisibleState.opponents) {
          expect(Object.keys(o)).not.toContain('cards');
          expect(Object.keys(o)).not.toContain('holeCards');
        }
      }
    }
  });

  it('настоящие карты лежат отдельно и помечены', () => {
    for (const h of OUT.hands) {
      expect(h.omniscient.hiddenFromHeroDuringPlay).toBe(true);
      expect(typeof h.omniscient.note).toBe('string');
      for (const c of h.omniscient.holeCards) {
        expect(typeof c.revealedToHero).toBe('boolean');
        for (const card of c.cards) expect(card).toMatch(/^[23456789TJQKA][cdhs]$/);
      }
      // Карты героя он, разумеется, видел.
      const hero = h.omniscient.holeCards.find((c: any) => c.seat === h.heroSeat);
      if (hero) expect(hero.revealedToHero).toBe(true);
    }
  });

  it('без вскрытия чужие карты помечены как невиденные', () => {
    const noShowdown = OUT.hands.filter((h: any) => !h.showdown);
    expect(noShowdown.length).toBeGreaterThan(0);
    for (const h of noShowdown) {
      for (const c of h.omniscient.holeCards) {
        if (c.seat === h.heroSeat) continue;
        expect(c.revealedToHero).toBe(false);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Профили соперников                                                  */
/* ------------------------------------------------------------------ */

describe('профили соперников', () => {
  it('лежат один раз на сессию, а не копией в каждой руке', () => {
    expect(Object.keys(OUT.opponentProfiles).length).toBe(PROFILES.length);
    // В самих раздачах больших копий профиля нет.
    for (const h of OUT.hands) {
      const text = JSON.stringify(h);
      expect(text).not.toContain('openByPosition');
      expect(text).not.toContain('sampleSizes');
    }
  });

  it('в профиле измеренное и размер выборки', () => {
    for (const p of Object.values<any>(OUT.opponentProfiles)) {
      expect(typeof p.nick).toBe('string');
      expect(typeof p.realSampleHands).toBe('number');
      expect(typeof p.measured.vpip).toBe('number');
      expect(typeof p.measured.pfr).toBe('number');
      expect(typeof p.measured.threeBet).toBe('number');
      expect(p.sampleSizes).toBeTruthy();
      expect(typeof p.note).toBe('string');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Переигранные раздачи                                                */
/* ------------------------------------------------------------------ */

describe('переигранные раздачи', () => {
  const withReplay: SessionLog = {
    ...LOG,
    hands: [
      ...LOG.hands,
      { ...LOG.hands[0], isReplay: true, replayCount: 1, heroNetCents: 999_00 },
    ],
  };

  it('в выгрузку попадают, но помечены', () => {
    const out = exported(withReplay) as any;
    expect(out.hands).toHaveLength(7);
    const replay = out.hands[6];
    expect(replay.isReplay).toBe(true);
    expect(replay.countedInSession).toBe(false);
    expect(replay.replayCount).toBe(1);
    expect(out.session.replayedHands).toBe(1);
  });

  it('не удваивают результат сессии', () => {
    const out = exported(withReplay) as any;
    expect(out.session.handsPlayed).toBe(6);
    const original = exported(LOG) as any;
    expect(out.session.timeline).toHaveLength(original.session.timeline.length);
    const last = out.session.timeline[out.session.timeline.length - 1];
    const lastOriginal = original.session.timeline[original.session.timeline.length - 1];
    expect(last.cumulativeNet.cents).toBe(lastOriginal.cumulativeNet.cents);
  });
});

/* ------------------------------------------------------------------ */
/* Мелочи представления                                                */
/* ------------------------------------------------------------------ */

describe('представление данных', () => {
  it('карта пишется привычной записью, десятка как T', () => {
    expect(cardText(8 * 4 + 3)).toBe('Ts');
    expect(cardText(12 * 4 + 0)).toBe('Ac');
    expect(cardText(0)).toBe('2c');
  });

  it('действия названы кодами, а не строчками для глаз', () => {
    const a = (kind: any, allIn = false) =>
      actionCode({ seat: 0, street: 'flop', kind, amount: 0, total: 10, allIn });
    expect(a('fold')).toBe('FOLD');
    expect(a('check')).toBe('CHECK');
    expect(a('call')).toBe('CALL');
    expect(a('bet')).toBe('BET');
    expect(a('raise')).toBe('RAISE');
    expect(a('raise', true)).toBe('ALL_IN');
    expect(a('post')).toBe('POST_BLIND');
  });
});

/* ------------------------------------------------------------------ */
/* Разбор «со стороны»: хватает ли одного файла                         */
/* ------------------------------------------------------------------ */

describe('по одному файлу видно каждую руку и каждое решение', () => {
  it('можно пересказать раздачу, не заглядывая в приложение', () => {
    const h = OUT.hands.find((x: any) => x.decisions.length > 0)!;

    // Кто где сидел и с чем.
    const hero = h.seats.find((s: any) => s.isHero);
    expect(hero.position).toBeTruthy();
    expect(h.heroCards.join(' ')).toMatch(/^[23456789TJQKA][cdhs] [23456789TJQKA][cdhs]$/);

    // Как шла торговля.
    const line = h.actions.map((a: any) => `${a.nick} ${a.action} ${a.amountTo.display}`);
    expect(line.length).toBeGreaterThan(1);

    // Что решал герой и что об этом думает тренер.
    const d = h.decisions[0];
    expect(d.heroVisibleState.pot.display).toMatch(/^\$\d+\.\d\d$/);
    expect(d.chosenAction.action).toBeTruthy();
    expect(d.coach.recommended.action).toBeTruthy();
    expect(typeof d.coach.score).toBe('number');
    expect(d.coach.brief.picture.length).toBeGreaterThan(0);

    // И чем всё кончилось.
    expect(typeof h.heroResult.cents).toBe('number');
    expect(Array.isArray(h.winners)).toBe(true);
  });

  it('решение можно оценить без послезнания, а потом свериться с картами', () => {
    const h = OUT.hands.find((x: any) => x.decisions.length > 0 && x.showdown)
      ?? OUT.hands.find((x: any) => x.decisions.length > 0)!;
    const d = h.decisions[0];

    // Всё нужное для оценки — в состоянии, которое видел герой.
    expect(d.heroVisibleState.board).toBeDefined();
    expect(d.heroVisibleState.opponents.length).toBeGreaterThanOrEqual(0);

    // Настоящие карты — отдельно, и до них надо дойти сознательно.
    expect(h.omniscient.holeCards.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Размер файла                                                        */
/* ------------------------------------------------------------------ */

describe('размер выгрузки', () => {
  it('десяток раздач укладывается в разумный файл', () => {
    const log = playSession(10, 777);
    const text = JSON.stringify(buildExport(log, summaryOf(log), PROFILES, Date.now()), null, 2);
    const kb = Math.round(text.length / 1024);
    // Не мегабайты: файл должен без труда открываться и целиком читаться.
    expect(kb).toBeLessThan(4000);
    expect(kb).toBeGreaterThan(20);
  });
});

/* ------------------------------------------------------------------ */
/* Ничего лишнего в движке                                             */
/* ------------------------------------------------------------------ */

describe('выгрузка ничего не меняет в игре', () => {
  it('построение файла не трогает записанную сессию', () => {
    const before = JSON.stringify(LOG);
    buildExport(LOG, summaryOf(LOG), PROFILES, Date.now());
    expect(JSON.stringify(LOG)).toBe(before);
  });

  it('состояние раздачи после выгрузки то же самое', () => {
    const session = newSession({
      heroName: 'withorwithout', stackMode: 'standard', smallBlind: 2, bigBlind: 4, seed: 99,
    });
    const before = JSON.stringify(session.state);
    const pot = totalPot(session.state);
    buildExport(LOG, summaryOf(LOG), PROFILES, Date.now());
    expect(JSON.stringify(session.state)).toBe(before);
    expect(totalPot(session.state)).toBe(pot);
  });
});
