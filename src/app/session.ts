/**
 * Сессия за столом: кто сидит, какая идёт раздача, чей ход.
 *
 * Чистая логика без React. Герой всегда занимает место 0 — так его удобно
 * рисовать внизу экрана, — а баттон каждую раздачу сдвигается, поэтому его
 * позиция честно проходит весь круг: UTG, HJ, CO, BTN, SB, BB.
 */

import { act, createHand } from '../game/hand';
import { legalActions, type ActionRequest } from '../game/betting';
import { makeRng, randInt, type Rng } from '../game/rng';
import { sampleStack, type StackMode } from '../game/stacks';
import type { Action, HandState, Position } from '../game/types';
import { buildContext } from '../bots/sim';
import { decide } from '../bots/decide';
import { knobsFor } from '../bots/index';
import { PROFILES, PROFILE_BY_NAME, profileFor, type BotProfile } from '../bots/profiles';

export const HERO_SEAT = 0;
export const SEATS = 6;

export interface SeatView {
  seat: number;
  name: string;
  isHero: boolean;
  profile: BotProfile | null;
  position: Position;
  stack: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  cards: [number, number];
  /** Последнее действие для всплывающей подписи у места. */
  lastAction: string | null;
  isToAct: boolean;
  won: number;
}

export interface SessionConfig {
  heroName: string;
  stackMode: StackMode;
  smallBlind: number;
  bigBlind: number;
  seed: number;
  /** Ник, который обязан быть за столом (режим TRAIN VS). */
  pinned?: string;
}

export interface Session {
  config: SessionConfig;
  handNumber: number;
  button: number;
  state: HandState;
  /**
   * Зерно текущей раздачи и её собственный поток случайности.
   *
   * Отдельный поток на раздачу — обязательное условие для переигрывания: при
   * том же зерне и тех же действиях героя боты примут ровно те же решения.
   * Общий на всю сессию поток этого не давал бы.
   */
  handSeed: number;
  handRng: Rng;
  /** Профили по местам; на месте героя — null. */
  seatProfiles: (BotProfile | null)[];
  /** Стеки, которые переносятся между раздачами. */
  stacks: number[];
  /** Накопленный результат героя за сессию, в центах. */
  bankroll: number;
  rng: Rng;
  /** Раздача закончилась и ждёт кнопки «Следующая». */
  awaitingNext: boolean;
}

function pickOpponents(rng: Rng, pinned?: string): BotProfile[] {
  const out: BotProfile[] = [];
  if (pinned && PROFILE_BY_NAME[pinned]) out.push(PROFILE_BY_NAME[pinned]);
  const pool = PROFILES.filter((p) => p.name !== pinned);
  while (out.length < SEATS - 1) {
    const p = pool[randInt(rng, pool.length)];
    if (out.some((x) => x.name === p.name)) continue;
    out.push(p);
  }
  // Место героя не должно всегда соседствовать с закреплённым игроком.
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newSession(config: SessionConfig): Session {
  const rng = makeRng(config.seed);
  const opponents = pickOpponents(rng, config.pinned);
  const seatProfiles: (BotProfile | null)[] = [null, ...opponents];
  const stacks = seatProfiles.map(() => sampleStack(config.stackMode, rng, config.bigBlind));

  const session: Session = {
    config,
    handNumber: 0,
    button: 0,
    state: null as unknown as HandState,
    handSeed: 0,
    handRng: makeRng(1),
    seatProfiles,
    stacks,
    bankroll: 0,
    rng,
    awaitingNext: false,
  };
  dealNext(session);
  return session;
}

/** Раздать новую руку, обновив стеки и сдвинув баттон. */
export function dealNext(session: Session): Session {
  const { config } = session;

  if (session.handNumber > 0) {
    // Перенести стеки, добить коротких до бай-ина — как делает автопополнение.
    session.state.players.forEach((p, i) => {
      session.stacks[i] = p.stack;
    });
    session.stacks = session.stacks.map((s, i) => {
      const min = 20 * config.bigBlind;
      if (s >= min) return s;
      return i === HERO_SEAT
        ? 100 * config.bigBlind
        : sampleStack(config.stackMode, session.rng, config.bigBlind);
    });
    // Изредка кто-то встаёт и на его место садится другой игрок.
    for (let i = 1; i < SEATS; i++) {
      // Закреплённый соперник со стола не уходит: в режиме «против игрока»
      // весь смысл в том, что он всегда напротив.
      if (config.pinned && session.seatProfiles[i]?.name === config.pinned) continue;
      if (session.rng() < 0.04) {
        const fresh = pickOpponents(session.rng, config.pinned)[0];
        if (!session.seatProfiles.some((p) => p?.name === fresh.name)) {
          session.seatProfiles[i] = fresh;
          session.stacks[i] = sampleStack(config.stackMode, session.rng, config.bigBlind);
        }
      }
    }
    session.button = (session.button + 1) % SEATS;
  }

  session.handNumber += 1;
  session.awaitingNext = false;
  session.handSeed = (config.seed * 7919 + session.handNumber * 131) >>> 0;
  session.handRng = makeRng(session.handSeed || 1);
  session.state = createHand({
    seats: session.seatProfiles.map((p, i) => ({
      name: p ? p.name : config.heroName,
      stack: session.stacks[i],
    })),
    button: session.button,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    seed: session.handSeed,
  });
  return session;
}

/**
 * Пересобрать раздачу заново из её описания — для переигрывания.
 * Те же места, стеки, баттон и зерно дают ту же колоду и то же поведение ботов.
 */
export function restoreHand(session: Session, setup: HandSetup): Session {
  session.handNumber = setup.handNumber;
  session.button = setup.button;
  session.handSeed = setup.seed;
  session.handRng = makeRng(setup.seed || 1);
  session.seatProfiles = setup.seatNames.map((n, i) =>
    i === HERO_SEAT ? null : profileFor(n));
  session.stacks = setup.stacks.slice();
  session.awaitingNext = false;
  session.state = createHand({
    seats: setup.seatNames.map((name, i) => ({ name, stack: setup.stacks[i] })),
    button: setup.button,
    smallBlind: session.config.smallBlind,
    bigBlind: session.config.bigBlind,
    seed: setup.seed,
  });
  return session;
}

/** Всё, что нужно, чтобы воспроизвести раздачу заново. */
export interface HandSetup {
  handNumber: number;
  seed: number;
  button: number;
  seatNames: string[];
  stacks: number[];
}

/** Снять описание текущей раздачи до её начала. */
export function handSetupOf(session: Session): HandSetup {
  return {
    handNumber: session.handNumber,
    seed: session.handSeed,
    button: session.button,
    seatNames: session.state.players.map((p) => p.name),
    stacks: session.state.players.map((p) => p.startingStack),
  };
}

export function isHeroTurn(session: Session): boolean {
  return !session.state.finished && session.state.toAct === HERO_SEAT;
}

export function isBotTurn(session: Session): boolean {
  return !session.state.finished && session.state.toAct >= 0 && session.state.toAct !== HERO_SEAT;
}

/** Что бот решил бы сейчас — без применения. */
export function botChoice(session: Session): ActionRequest | null {
  if (!isBotTurn(session)) return null;
  const seat = session.state.toAct;
  const profile = session.seatProfiles[seat]!;
  const profiles = session.seatProfiles.map((p) => p ?? HERO_STUB);
  const ctx = buildContext(session.state, seat, profile, knobsFor(profile), profiles, session.handRng);
  return decide(ctx);
}

/**
 * Заглушка для места героя: ботам нужен профиль соперника, чтобы читать его
 * ставку. Пока герой не имеет собственной модели, он выглядит для них как
 * средний аккуратный регуляр.
 */
const HERO_STUB: BotProfile = profileFor('DuhaMetelkin');

export function stepBot(session: Session): Session {
  const request = botChoice(session);
  if (!request) return session;
  act(session.state, request);
  finishIfDone(session);
  return session;
}

export function heroAct(session: Session, request: ActionRequest): Session {
  if (!isHeroTurn(session)) return session;
  act(session.state, request);
  finishIfDone(session);
  return session;
}

function finishIfDone(session: Session) {
  if (session.state.finished && !session.awaitingNext) {
    session.awaitingNext = true;
    session.bankroll += session.state.result!.net[HERO_SEAT] ?? 0;
  }
}

/** Читаемая подпись последнего действия игрока, как на реальном столе. */
export function describeAction(a: Action, bigBlind: number): string {
  void bigBlind;
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  switch (a.kind) {
    case 'fold': return 'FOLD';
    case 'check': return 'CHECK';
    case 'call': return a.allIn ? `ALL-IN ${dollars(a.total)}` : `CALL ${dollars(a.total)}`;
    case 'bet': return a.allIn ? `ALL-IN ${dollars(a.total)}` : `BET ${dollars(a.total)}`;
    case 'raise': return a.allIn ? `ALL-IN ${dollars(a.total)}` : `RAISE TO ${dollars(a.total)}`;
    case 'post': return null as unknown as string;
    default: return '';
  }
}

export function seatViews(session: Session): SeatView[] {
  const s = session.state;
  const lastBySeat = new Map<number, Action>();
  for (const a of s.log) {
    if (a.street !== s.street || a.kind === 'post') continue;
    lastBySeat.set(a.seat, a);
  }
  return s.players.map((p, i) => {
    const last = lastBySeat.get(i);
    return {
      seat: i,
      name: p.name,
      isHero: i === HERO_SEAT,
      profile: session.seatProfiles[i],
      position: p.position,
      stack: p.stack,
      committed: p.streetCommit,
      folded: p.folded,
      allIn: p.allIn,
      cards: p.cards,
      lastAction: last ? describeAction(last, s.bigBlind) : null,
      isToAct: s.toAct === i && !s.finished,
      won: p.won,
    };
  });
}

export function heroLegal(session: Session) {
  return isHeroTurn(session) ? legalActions(session.state) : null;
}
