import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ActionRequest } from '../game/betting';
import type { StackMode } from '../game/stacks';
import {
  dealNext, heroAct, isBotTurn, newSession, stepBot,
  type Session, type SessionConfig,
} from '../app/session';

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
}

export function useSession(initial: SessionConfig): UseSession {
  const ref = useRef<Session | null>(null);
  if (ref.current === null) ref.current = newSession(initial);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const timer = useRef<number | null>(null);

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
    heroAct(ref.current!, request);
    force();
  }, []);

  const doNext = useCallback(() => {
    dealNext(ref.current!);
    force();
  }, []);

  const restart = useCallback((mode: StackMode, pinned?: string) => {
    ref.current = newSession({
      ...initial,
      stackMode: mode,
      pinned,
      seed: (Date.now() & 0x7fffffff) || 1,
    });
    force();
  }, [initial]);

  return {
    session: ref.current!,
    heroAct: doHeroAct,
    nextHand: doNext,
    restart,
    botThinking: isBotTurn(ref.current!),
  };
}
