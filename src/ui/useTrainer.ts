import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ActionRequest } from '../game/betting';
import type { StackMode } from '../game/stacks';
import { totalPot } from '../game/types';
import {
  HERO_SEAT, dealNext, handSetupOf, heroAct, isBotTurn, isHeroTurn, newSession, restoreHand, stepBot,
  type HandSetup, type Session,
} from '../app/session';
import {
  dealForCategory, dealVersus, mainVillain,
  type DecisionRecord, type TrainerMode,
} from '../app/trainer';
import { captureSnapshot, evaluateDecision } from '../coach/index';
import { categorise } from '../coach/categories';
import {
  addDecision, isGood, isMajor, isMistake, loadProgress, resetProgress, saveProgress,
  type Progress, type SessionEntry,
} from '../app/progress';
import type { LoggedDecision, LoggedHand, SessionLog } from '../app/sessionLog';
import { AutoNext, browserTimer } from '../app/autoNext';

/** Пауза между ходами ботов — чтобы за столом читалось, кто что сделал. */
const BOT_DELAY_MS = 560;
const SHOWDOWN_DELAY_MS = 850;
/** Пауза перед воспроизведением уже сыгранного хода героя при переигрывании. */
const REPLAY_DELAY_MS = 420;
/**
 * Насколько тренеру позволено думать молча. Если он уложился — надпись
 * «анализирую» вообще не показывается: моргающая плашка раздражает сильнее,
 * чем четверть секунды ожидания.
 */
const THINKING_VISIBLE_AFTER_MS = 200;



export type Screen = 'start' | 'table' | 'summary' | 'progress' | 'mistakes';

export interface SessionTotals {
  hands: number;
  decisions: number;
  net: number;
  score: number;
  good: number;
  borderline: number;
  mistakes: number;
  major: number;
  records: DecisionRecord[];
}

export interface Trainer {
  screen: Screen;
  mode: TrainerMode;
  session: Session;
  stackMode: StackMode;
  /** Разбор последнего решения. */
  lastReview: DecisionRecord | null;
  /** Все решения текущей раздачи. */
  handReviews: DecisionRecord[];
  /** Идёт анимация ходов ботов. */
  botThinking: boolean;
  /** Тренер считает дольше обычного — показываем «анализирую». */
  coachThinking: boolean;
  handsPlayed: number;
  totals: SessionTotals;
  progress: Progress;
  /** Идёт автоматическое воспроизведение уже сыгранных ходов. */
  replaying: boolean;
  /** Раздача переигрывается: в статистику она не идёт. */
  isReplay: boolean;
  /** Сессия отыграла свои раздачи и ждёт, когда игрок откроет итог. */
  sessionComplete: boolean;
  /** Игрок попросил не начинать следующую раздачу самому. */
  pauseNext: boolean;
  /** Через сколько миллисекунд начнётся следующая раздача; null — не начнётся. */
  autoNextIn: number | null;

  start: (mode: TrainerMode, stackMode: StackMode) => void;
  act: (request: ActionRequest) => void;
  nextHand: () => void;
  replayExact: () => void;
  tryAnotherLine: (decisionIndex: number) => void;
  replayMistake: (index: number) => void;
  goto: (screen: Screen) => void;
  finishSession: () => void;
  wipeProgress: () => void;
  /** Переключить «отложить следующую раздачу». Отменяет и уже идущий отсчёт. */
  setPauseNext: (on: boolean) => void;
  /** Отменить автопереход: игрок открыл разбор и хочет читать. */
  holdAutoNext: () => void;
  /** Полная запись сессии для выгрузки. */
  sessionLog: () => SessionLog;
}

const HERO_NAME = 'withorwithout';

function freshSeed(): number {
  return (Date.now() & 0x7fffffff) || 1;
}

export function useTrainer(): Trainer {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const timer = useRef<number | null>(null);
  const thinkTimer = useRef<number | null>(null);

  const screen = useRef<Screen>('start');
  const mode = useRef<TrainerMode>({ kind: 'quick' });
  const stackMode = useRef<StackMode>('standard');
  const session = useRef<Session | null>(null);
  const progress = useRef<Progress>(loadProgress());

  const handReviews = useRef<DecisionRecord[]>([]);
  const lastReview = useRef<DecisionRecord | null>(null);
  const heroActions = useRef<ActionRequest[]>([]);
  const currentSetup = useRef<HandSetup | null>(null);
  const sessionRecords = useRef<DecisionRecord[]>([]);
  const handsPlayed = useRef(0);
  const netTotal = useRef(0);
  const coachBusy = useRef(false);
  const coachVisible = useRef(false);
  const isReplay = useRef(false);
  const replayQueue = useRef<ActionRequest[]>([]);
  const counted = useRef(false);

  // Автопереход к следующей раздаче. Вся защита от гонок — внутри планировщика.
  const auto = useRef<AutoNext | null>(null);

  // Запись сессии для выгрузки.
  const sessionId = useRef('');
  const sessionStartedAt = useRef(Date.now());
  const hands = useRef<LoggedHand[]>([]);
  const currentHand = useRef<LoggedHand | null>(null);
  const replayCounts = useRef(new Map<number, number>());

  if (session.current === null) {
    session.current = newSession({
      heroName: HERO_NAME, stackMode: 'standard',
      smallBlind: 2, bigBlind: 4, seed: freshSeed(),
    });
    currentSetup.current = handSetupOf(session.current);
    sessionId.current = `s${Date.now().toString(36)}`;
  }

  if (auto.current === null) {
    auto.current = new AutoNext(browserTimer, (wasAuto) => startNextHand(wasAuto));
  }

  /* ---------------- учёт закончившейся раздачи ---------------- */

  const recordSession = useCallback(() => {
    const records = sessionRecords.current;
    const entry: SessionEntry = {
      t: Date.now(),
      hands: handsPlayed.current,
      decisions: records.length,
      net: netTotal.current,
      score: records.length ? records.reduce((a, r) => a + r.verdict.score, 0) / records.length : 0,
      mode: mode.current.kind,
    };
    progress.current.sessions.unshift(entry);
    if (progress.current.sessions.length > 50) progress.current.sessions.length = 50;
    saveProgress(progress.current);
  }, []);

  /** Снять запланированный автопереход. */
  const cancelAuto = useCallback(() => {
    auto.current?.cancel();
  }, []);

  const closeHand = useCallback(() => {
    const s = session.current!;
    if (counted.current) return;
    counted.current = true;

    // Раздача дописывается в журнал сессии в любом случае — и переигранная
    // тоже, но помеченной: по ней потом видно, что переигрывание было.
    finishHandLog();

    // Переигранная раздача — учебная. Она не идёт ни в деньги, ни в статистику:
    // иначе одну и ту же руку можно было бы «выиграть» пять раз подряд.
    if (isReplay.current) {
      scheduleAuto();
      return;
    }

    netTotal.current += s.state.result ? (s.state.result.net[HERO_SEAT] ?? 0) : 0;
    handsPlayed.current += 1;
    progress.current.hands += 1;
    saveProgress(progress.current);

    // Последняя раздача сессии не выбрасывает на экран итога сама: игрок
    // должен успеть посмотреть, чем всё закончилось, и при желании её
    // переиграть. Итог откроется по кнопке.
    const limit = mode.current.handLimit;
    if (limit && handsPlayed.current >= limit) {
      recordSession();
      // Сессия отыграна: следующая раздача не начинается сама ни при каких
      // настройках. Дальше только итог.
      return;
    }
    scheduleAuto();
  }, [recordSession]);

  /* ---------------- ходы ботов и очередь переигрывания ---------------- */

  useEffect(() => {
    const s = session.current!;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (screen.current !== 'table') return;

    // При переигрывании действия героя воспроизводятся из записи, пока очередь
    // не опустеет; дальше он снова играет сам.
    if (replayQueue.current.length > 0 && isHeroTurn(s)) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const next = replayQueue.current.shift()!;
        heroActions.current.push(next);
        heroAct(s, next);
        if (s.state.finished) closeHand();
        force();
      }, REPLAY_DELAY_MS);
      return;
    }
    if (!isBotTurn(s)) return;

    const delay = s.state.street === 'showdown' ? SHOWDOWN_DELAY_MS : BOT_DELAY_MS;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      stepBot(s);
      if (s.state.finished) closeHand();
      force();
    }, delay);

    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  });

  /* ---------------- журнал сессии ---------------- */

  /** Открыть запись новой раздачи. */
  const startHandLog = useCallback((wasAuto: boolean) => {
    const s = session.current!;
    currentHand.current = {
      handNumber: s.handNumber,
      setup: handSetupOf(s),
      seats: s.state.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        isHero: p.seat === HERO_SEAT,
        position: p.position,
        startingStackCents: p.startingStack,
        endingStackCents: p.startingStack,
      })),
      heroSeat: HERO_SEAT,
      heroCards: [...s.state.players[HERO_SEAT].cards] as [number, number],
      board: [],
      log: [],
      decisions: [],
      result: null,
      heroNetCents: 0,
      potCents: 0,
      showdown: false,
      actualHoleCards: [],
      startedAt: Date.now(),
      endedAt: 0,
      autoAdvanced: wasAuto,
      pausedAfter: false,
      isReplay: isReplay.current,
      replayCount: 0,
    };
  }, []);

  /** Закрыть запись раздачи: доснять всё, что известно только в конце. */
  const finishHandLog = useCallback(() => {
    const h = currentHand.current;
    if (!h) return;
    const s = session.current!;
    const result = s.state.result;
    const shown = result ? result.showdownSeats : [];

    h.board = s.state.board.slice();
    h.log = s.state.log.slice();
    h.result = result;
    h.heroNetCents = result ? (result.net[HERO_SEAT] ?? 0) : 0;
    h.potCents = s.state.players.reduce((a, p) => a + p.handCommit, 0);
    h.showdown = shown.length > 1;
    h.endedAt = Date.now();
    h.pausedAfter = auto.current?.isPaused ?? false;
    h.seats = h.seats.map((seat) => ({
      ...seat,
      endingStackCents: s.state.players[seat.seat].stack,
    }));
    // Настоящие карты — отдельно от слепков решений и с пометкой, видел ли их
    // герой на самом деле.
    h.actualHoleCards = s.state.players
      .filter((p) => p.cards[0] >= 0)
      .map((p) => ({
        seat: p.seat,
        name: p.name,
        cards: [...p.cards],
        revealedToHero: p.seat === HERO_SEAT || shown.includes(p.seat),
      }));

    if (h.isReplay) {
      const seen = replayCounts.current.get(h.handNumber) ?? 0;
      replayCounts.current.set(h.handNumber, seen + 1);
      h.replayCount = seen + 1;
    }
    hands.current.push(h);
    currentHand.current = null;
  }, []);

  /* ---------------- автопереход ---------------- */

  /**
   * Запланировать следующую раздачу.
   *
   * Отсчёт начинается не сразу: сперва даём доиграть финалу прошлой руки —
   * вскрытию, награждению, уходу карт в мак, — чтобы звуки и движение двух
   * раздач не накладывались.
   */
  const scheduleAuto = useCallback(() => {
    auto.current?.schedule();
  }, []);

  /* ---------------- раздачи ---------------- */

  const beginHand = useCallback((wasAuto = false) => {
    const s = session.current!;
    cancelAuto();
    handReviews.current = [];
    lastReview.current = null;
    heroActions.current = [];
    replayQueue.current = [];
    isReplay.current = false;
    counted.current = false;

    const m = mode.current;
    if (m.kind === 'weak-spot' && m.category) {
      dealForCategory(s, m.category);
    } else if (m.kind === 'versus' && m.villain) {
      dealVersus(s, m.villain);
    } else {
      dealNext(s);
    }
    currentSetup.current = handSetupOf(s);
    startHandLog(wasAuto);
  }, [cancelAuto, startHandLog]);

  /**
   * Начать следующую раздачу. Единственная дверь: и кнопка, и таймер ходят
   * через неё, поэтому двух раздач подряд из-за двойного клика не выйдет.
   */
  const startNextHand = useCallback((wasAuto: boolean) => {
    cancelAuto();
    beginHand(wasAuto);
    force();
  }, [beginHand, cancelAuto]);

  /* ---------------- действие героя ---------------- */

  const doAct = useCallback((request: ActionRequest) => {
    const s = session.current!;
    if (!isHeroTurn(s)) return;

    // Слепок снимается ДО действия — тренер не должен видеть последствий.
    const snap = captureSnapshot(s);
    const street = s.state.street;
    const villain = mainVillain(s);
    const pot = totalPot(s.state);
    const prior = heroActions.current.slice();
    const replay = isReplay.current;
    // Запись раздачи запоминается СЕЙЧАС. Разбор считается следующим кадром, и
    // к тому моменту раздача может уже закрыться — тогда последнее решение,
    // часто самое интересное, не попало бы в выгрузку вовсе.
    const handLog = currentHand.current;

    heroActions.current.push(request);
    heroAct(s, request);
    if (s.state.finished) closeHand();

    if (!snap) { force(); return; }

    // Стол обновляется сразу, а разбор считается следующим кадром: на сложных
    // решениях расчёт занимает заметное время, и держать из-за него кнопки
    // нажатыми нельзя.
    coachBusy.current = true;
    coachVisible.current = false;
    if (thinkTimer.current !== null) window.clearTimeout(thinkTimer.current);
    thinkTimer.current = window.setTimeout(() => {
      thinkTimer.current = null;
      if (coachBusy.current) { coachVisible.current = true; force(); }
    }, THINKING_VISIBLE_AFTER_MS);
    force();

    window.setTimeout(() => {
      const verdict = evaluateDecision(snap, {
        kind: request.kind as 'fold' | 'check' | 'call' | 'bet' | 'raise',
        total: request.total,
      });
      const record: DecisionRecord = {
        street, action: request, verdict,
        categories: categorise(snap, request.kind as 'bet'),
        villain,
        heroCards: snap.heroCards,
        board: snap.board.slice(),
        pot,
        priorActions: prior,
      };
      lastReview.current = record;
      handReviews.current.push(record);

      // В журнал сессии — и слепок, и вердикт: ровно то, из чего тренер
      // сделал вывод. Переигранные решения тоже пишутся, но раздача помечена.
      const logged: LoggedDecision = {
        index: handReviews.current.length - 1,
        street,
        snapshot: snap,
        chosen: { kind: request.kind, totalCents: request.total },
        verdict,
        categories: record.categories,
        villain,
        atMs: Date.now() - sessionStartedAt.current,
      };
      handLog?.decisions.push(logged);

      if (!replay) {
        sessionRecords.current.push(record);
        const major = isMajor(verdict.score);
        addDecision(
          progress.current,
          { t: Date.now(), score: verdict.score, c: record.categories, v: villain },
          major && currentSetup.current
            ? {
                t: Date.now(),
                score: verdict.score,
                street,
                did: describe(request),
                better: verdict.brief.better ?? '',
                heroCards: [...snap.heroCards],
                board: snap.board.slice(),
                position: snap.heroPosition,
                villain,
                pot,
                categories: record.categories,
                setup: currentSetup.current,
                priorActions: prior.map((a) => ({ kind: a.kind, total: a.total })),
              }
            : undefined,
        );
        saveProgress(progress.current);
      }

      coachBusy.current = false;
      coachVisible.current = false;
      if (thinkTimer.current !== null) {
        window.clearTimeout(thinkTimer.current);
        thinkTimer.current = null;
      }
      force();
    }, 0);
  }, [closeHand]);

  /* ---------------- переигрывание ---------------- */

  const replayFrom = useCallback((setup: HandSetup, actions: ActionRequest[]) => {
    const s = session.current!;
    // Переигрывание отменяет запланированный переход: новая раздача не должна
    // стартовать поверх него.
    auto.current?.setPaused(false);
    restoreHand(s, setup);
    handReviews.current = [];
    lastReview.current = null;
    heroActions.current = [];
    currentSetup.current = setup;
    replayQueue.current = actions.slice();
    isReplay.current = true;
    counted.current = false;
    screen.current = 'table';
    startHandLog(false);
    force();
  }, [cancelAuto, startHandLog]);

  return {
    screen: screen.current,
    mode: mode.current,
    session: session.current!,
    stackMode: stackMode.current,
    lastReview: lastReview.current,
    handReviews: handReviews.current,
    botThinking: isBotTurn(session.current!),
    coachThinking: coachVisible.current,
    handsPlayed: handsPlayed.current,
    progress: progress.current,
    replaying: replayQueue.current.length > 0,
    isReplay: isReplay.current,
    sessionComplete: mode.current.handLimit !== undefined
      && handsPlayed.current >= mode.current.handLimit,
    pauseNext: auto.current!.isPaused,
    autoNextIn: auto.current!.remaining,
    totals: totalsOf(sessionRecords.current, handsPlayed.current, netTotal.current),

    start(nextMode, nextStacks) {
      mode.current = nextMode;
      stackMode.current = nextStacks;
      session.current = newSession({
        heroName: HERO_NAME,
        stackMode: nextStacks,
        smallBlind: 2, bigBlind: 4,
        seed: freshSeed(),
        pinned: nextMode.kind === 'versus' ? nextMode.villain : undefined,
      });
      // newSession уже раздал первую руку. Счёт начинаем с нуля, чтобы
      // beginHand выдал именно её, а не вторую: иначе сессия «10 рук»
      // открывалась бы раздачей номер два.
      session.current.handNumber = 0;
      sessionRecords.current = [];
      handsPlayed.current = 0;
      netTotal.current = 0;
      // Новая сессия — новый журнал.
      auto.current!.setPaused(false);
      hands.current = [];
      currentHand.current = null;
      replayCounts.current = new Map();
      sessionId.current = `s${Date.now().toString(36)}`;
      sessionStartedAt.current = Date.now();
      screen.current = 'table';
      beginHand();
      force();
    },

    act: doAct,

    nextHand() {
      // Единственная дверь для ручного перехода: пауза при этом сбрасывается,
      // и следующая обычная раздача снова продолжится сама.
      auto.current!.manual();
    },

    setPauseNext(on) {
      // Пауза во время отсчёта обязана его отменять, а не «почти успевать».
      auto.current!.setPaused(on);
      if (!on && session.current!.state.finished && screen.current === 'table') scheduleAuto();
      if (currentHand.current) currentHand.current.pausedAfter = on;
      force();
    },

    holdAutoNext() {
      // Игрок открыл подробный разбор — значит хочет читать, а не гнаться за
      // таймером. Считаем это тем же, что и пауза.
      auto.current!.hold();
      force();
    },

    sessionLog(): SessionLog {
      const m = mode.current;
      return {
        id: sessionId.current || `s${sessionStartedAt.current.toString(36)}`,
        mode: m.kind,
        modeDetail: m.category ?? m.villain ?? null,
        targetHands: m.handLimit ?? null,
        startedAt: sessionStartedAt.current,
        endedAt: Date.now(),
        smallBlindCents: session.current!.config.smallBlind,
        bigBlindCents: session.current!.config.bigBlind,
        heroName: HERO_NAME,
        hands: hands.current,
      };
    },

    replayExact() {
      if (currentSetup.current) replayFrom(currentSetup.current, heroActions.current.slice());
    },

    tryAnotherLine(index) {
      if (currentSetup.current) replayFrom(currentSetup.current, heroActions.current.slice(0, index));
    },

    replayMistake(index) {
      const m = progress.current.mistakes[index];
      if (!m) return;
      screen.current = 'table';
      replayFrom(m.setup, m.priorActions as ActionRequest[]);
    },

    goto(next) {
      screen.current = next;
      force();
    },

    finishSession() {
      const limit = mode.current.handLimit;
      // Сессия с лимитом уже записана в момент последней раздачи — второй раз
      // не пишем, иначе в истории появится дубль.
      if (!(limit && handsPlayed.current >= limit)) recordSession();
      screen.current = 'summary';
      force();
    },

    wipeProgress() {
      progress.current = resetProgress();
      force();
    },
  };
}

function describe(a: ActionRequest): string {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  switch (a.kind) {
    case 'fold': return 'FOLD';
    case 'check': return 'CHECK';
    case 'call': return 'CALL';
    case 'bet': return `BET ${money(a.total ?? 0)}`;
    case 'raise': return `RAISE TO ${money(a.total ?? 0)}`;
    default: return a.kind;
  }
}

function totalsOf(records: DecisionRecord[], hands: number, net: number): SessionTotals {
  const scores = records.map((r) => r.verdict.score);
  return {
    hands,
    decisions: records.length,
    net,
    score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    good: scores.filter(isGood).length,
    borderline: scores.filter((s) => !isGood(s) && !isMistake(s)).length,
    mistakes: scores.filter(isMistake).length,
    major: scores.filter(isMajor).length,
    records,
  };
}
