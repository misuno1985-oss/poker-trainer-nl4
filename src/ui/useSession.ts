import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ActionRequest } from '../game/betting';
import type { StackMode } from '../game/stacks';
import {
  dealNext, heroAct, isBotTurn, newSession, stepBot,
  type Session, type SessionConfig,
} from '../app/session';
import { captureSnapshot, evaluateDecision } from '../coach/index';
import type { CoachVerdict } from '../coach/types';

export interface ReviewedDecision {
  street: string;
  action: ActionRequest;
  verdict: CoachVerdict;
}

/** Пауза между ходами ботов — чтобы за столом читалось, кто что сделал. */
const BOT_DELAY_MS = 620;
const SHOWDOWN_DELAY_MS = 900;

export interface UseSession {
  session: Session;
  heroAct: (request: ActionRequest) => void;
  nextHand: () => void;
  restart: (mode: StackMode, pinned?: string) => void;
  /** Идёт анимация ходов ботов — кнопки героя в это время скрыты. */
  botThinking: boolean;
  /** Разбор последнего решения. */
  lastReview: ReviewedDecision | null;
  /** Все решения текущей раздачи. */
  handReviews: ReviewedDecision[];
}

export function useSession(initial: SessionConfig): UseSession {
  const ref = useRef<Session | null>(null);
  if (ref.current === null) ref.current = newSession(initial);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const timer = useRef<number | null>(null);
  const lastReview = useRef<ReviewedDecision | null>(null);
  const handReviews = useRef<ReviewedDecision[]>([]);

  // Боты ходят по таймеру, по одному действию за раз.
  useEffect(() => {
    const session = ref.current!;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!isBotTurn(session)) return;
    const delay = session.state.street === 'showdown' ? SHOWDOWN_DELAY_MS : BOT_DELAY_MS;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      stepBot(ref.current!);
      force();
    }, delay);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  });

  const doHeroAct = useCallback((request: ActionRequest) => {
    const session = ref.current!;
    // Слепок снимается ДО действия: тренер должен видеть ровно то, что видел
    // герой в момент нажатия кнопки, и ничего из появившегося позже.
    const snap = captureSnapshot(session);
    const street = session.state.street;
    heroAct(session, request);
    if (snap) {
      const verdict = evaluateDecision(snap, {
        kind: request.kind as 'fold' | 'check' | 'call' | 'bet' | 'raise',
        total: request.total,
      });
      const review: ReviewedDecision = { street, action: request, verdict };
      lastReview.current = review;
      handReviews.current.push(review);
    }
    force();
  }, []);

  const doNext = useCallback(() => {
    dealNext(ref.current!);
    lastReview.current = null;
    handReviews.current = [];
    force();
  }, []);

  const restart = useCallback((mode: StackMode, pinned?: string) => {
    ref.current = newSession({
      ...initial,
      stackMode: mode,
      pinned,
      seed: (Date.now() & 0x7fffffff) || 1,
    });
    lastReview.current = null;
    handReviews.current = [];
    force();
  }, [initial]);

  return {
    session: ref.current!,
    heroAct: doHeroAct,
    nextHand: doNext,
    restart,
    botThinking: isBotTurn(ref.current!),
    lastReview: lastReview.current,
    handReviews: handReviews.current,
  };
}
