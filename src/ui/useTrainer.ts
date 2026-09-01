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

  start: (mode: TrainerMode, stackMode: StackMode) => void;
  act: (request: ActionRequest) => void;
  nextHand: () => void;
  replayExact: () => void;
  tryAnotherLine: (decisionIndex: number) => void;
  replayMistake: (index: number) => void;
  goto: (screen: Screen) => void;
  finishSession: () => void;
  wipeProgress: () => void;
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

  if (session.current === null) {
    session.current = newSession({
      heroName: HERO_NAME, stackMode: 'standard',
      smallBlind: 2, bigBlind: 4, seed: freshSeed(),
    });
    currentSetup.current = handSetupOf(session.current);
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

  const closeHand = useCallback(() => {
    const s = session.current!;
    // Переигранная раздача — учебная. Она не идёт ни в деньги, ни в статистику:
    // иначе одну и ту же руку можно было бы «выиграть» пять раз подряд.
    if (isReplay.current || counted.current) return;
    counted.current = true;

    netTotal.current += s.state.result ? (s.state.result.net[HERO_SEAT] ?? 0) : 0;
    handsPlayed.current += 1;
    progress.current.hands += 1;
    saveProgress(progress.current);

    // Последняя раздача сессии не выбрасывает на экран итога сама: игрок
    // должен успеть посмотреть, чем всё закончилось, и при желании её
    // переиграть. Итог откроется по кнопке.
    const limit = mode.current.handLimit;
    if (limit && handsPlayed.current >= limit) recordSession();
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

  /* ---------------- раздачи ---------------- */

  const beginHand = useCallback(() => {
    const s = session.current!;
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
  }, []);

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
    restoreHand(s, setup);
    handReviews.current = [];
    lastReview.current = null;
    heroActions.current = [];
    currentSetup.current = setup;
    replayQueue.current = actions.slice();
    isReplay.current = true;
    counted.current = false;
    screen.current = 'table';
    force();
  }, []);

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
      screen.current = 'table';
      beginHand();
      force();
    },

    act: doAct,

    nextHand() {
      // Из переигранной раздачи возвращаемся в обычный ход сессии.
      beginHand();
      force();
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
