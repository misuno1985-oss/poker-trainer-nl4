/**
 * Короткое доигрывание раздачи — чтобы одноуличная оценка не решала всё.
 *
 * Одноуличная модель не видит того, что в покере решает половину дела:
 * преимущество позиции, бесплатную карту, возможность поставить следующую
 * улицу, выплату при закрывшемся дро и обратную сторону — сколько ещё можно
 * потерять со второй по силе рукой. Здесь раздача просто доигрывается много
 * раз, и всё это получается само.
 *
 * Это НЕ солвер. Соперники играют своими обычными políticas, герой — разумной
 * базовой стратегией. Числа приблизительные, и в тексте они так и подаются.
 *
 * Про подглядывание: карты соперников сюда не приходят и прийти не могут. Они
 * СЕМПЛИРУЮТСЯ из восстановленного диапазона, а настоящие карты текущей руки
 * модели недоступны — их нет в снимке.
 */

import { act } from '../game/hand';
import { legalActions, type ActionRequest } from '../game/betting';
import { NUM_CARDS, type Card } from '../engine/cards';
import { makeRng, type Rng } from '../game/rng';
import type { HandState, Player, Position } from '../game/types';
import { assignPositions } from '../game/positions';
import { decide, defaultKnobs, type BotContext } from '../bots/decide';
import { knobsFor } from '../bots/index';
import { UNKNOWN_PROFILE, type BotProfile } from '../bots/profiles';
import type { WeightedRange } from './range';
import type { DecisionSnapshot } from './types';

/** Сколько комбинаций перебирать в оценке руки внутри доигрывания. */
const FAST_SAMPLES = 110;

export interface RolloutResult {
  /** Средний результат в центах относительно момента решения. */
  ev: number;
  sims: number;
  /** Стандартная ошибка среднего — насколько числу вообще можно верить. */
  stdErr: number;
}

/** Один разыгранный сценарий: чьи карты и какая колода. */
interface Scenario {
  holes: Map<number, [Card, Card]>;
  deck: Card[];
}

/** Кумулятивные веса для выборки из диапазона. */
function cumulative(range: WeightedRange): number[] {
  const out = new Array<number>(range.length);
  let sum = 0;
  for (let i = 0; i < range.length; i++) {
    sum += range[i].weight;
    out[i] = sum;
  }
  return out;
}

function pickCombo(range: WeightedRange, cum: number[], r: number): [Card, Card] {
  const target = r * cum[cum.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return range[lo].cards;
}

/**
 * Готовит одинаковые сценарии для всех сравниваемых действий.
 *
 * Общие случайные числа: каждый вариант проверяется на ОДНИХ И ТЕХ ЖЕ руках
 * соперников и одной и той же доске. Так разница между вариантами измеряется
 * гораздо точнее при том же числе прогонов.
 */
export function buildScenarios(
  snap: DecisionSnapshot,
  ranges: WeightedRange[],
  seed: number,
  count: number,
): Scenario[] {
  const rng = makeRng(seed);
  const cums = ranges.map(cumulative);
  const out: Scenario[] = [];

  const base = new Uint8Array(NUM_CARDS);
  for (const c of snap.heroCards) base[c] = 1;
  for (const c of snap.board) base[c] = 1;

  let guard = 0;
  while (out.length < count && guard++ < count * 6) {
    const used = base.slice();
    const holes = new Map<number, [Card, Card]>();
    let ok = true;

    for (let i = 0; i < snap.opponents.length; i++) {
      let combo: [Card, Card] | null = null;
      for (let attempt = 0; attempt < 14; attempt++) {
        const candidate = pickCombo(ranges[i], cums[i], rng());
        if (!used[candidate[0]] && !used[candidate[1]]) {
          combo = candidate;
          break;
        }
      }
      if (!combo) { ok = false; break; }
      used[combo[0]] = 1;
      used[combo[1]] = 1;
      holes.set(snap.opponents[i].seat, combo);
    }
    if (!ok) continue;

    const deck: Card[] = [];
    for (let c = 0; c < NUM_CARDS; c++) if (!used[c]) deck.push(c);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    out.push({ holes, deck });
  }
  return out;
}

/** Собирает состояние раздачи ровно на момент решения героя. */
function buildState(snap: DecisionSnapshot, scenario: Scenario): HandState {
  const positions = assignPositions(snap.seatCount, snap.button);
  const bySeat = new Map(snap.opponents.map((o) => [o.seat, o]));
  const players: Player[] = [];

  // Мёртвые деньги сбросивших кладём на первое же свободное место, чтобы банк
  // сошёлся: движок считает банк по вкладам игроков.
  let deadPlaced = false;

  for (let seat = 0; seat < snap.seatCount; seat++) {
    const isHero = seat === snap.heroSeat;
    const opp = bySeat.get(seat);
    const position: Position = positions[seat] ?? 'BTN';

    if (isHero) {
      players.push(base(seat, 'hero', position, snap.heroStack, snap.heroCards,
        snap.heroStreetCommit, snap.heroHandCommit, false));
    } else if (opp) {
      players.push(base(seat, opp.name, position, opp.stack,
        scenario.holes.get(seat) ?? [-1, -1], opp.streetCommit, opp.handCommit, false, opp.allIn));
    } else {
      const dead = deadPlaced ? 0 : snap.deadMoney;
      deadPlaced = true;
      players.push(base(seat, 'folded', position, 0, [-1, -1], 0, dead, true));
    }
  }

  return {
    players,
    button: snap.button,
    smallBlind: Math.round(snap.bigBlind / 2),
    bigBlind: snap.bigBlind,
    street: snap.street,
    board: snap.board.slice(),
    deck: scenario.deck,
    deckPos: 0,
    currentBet: snap.currentBet,
    lastRaiseSize: snap.lastRaiseSize,
    toAct: snap.heroSeat,
    log: snap.history.map((a) => ({ ...a })),
    finished: false,
    result: null,
  };
}

function base(
  seat: number, name: string, position: Position, stack: number,
  cards: readonly Card[], streetCommit: number, handCommit: number,
  folded: boolean, allIn = false,
): Player {
  return {
    seat, name, stack, startingStack: stack + handCommit,
    cards: [cards[0], cards[1]] as [Card, Card],
    position, folded, allIn,
    streetCommit, handCommit,
    hasActed: true, mayRaise: true, won: 0,
  };
}

/**
 * Базовая стратегия героя на будущих улицах.
 *
 * Намеренно средняя и без личных утечек: тренер должен оценивать текущее
 * решение, а не наказывать за то, что дальше герой сыграет как обычно.
 */
const HERO_BASELINE: BotProfile = UNKNOWN_PROFILE;
const HERO_BASELINE_KNOBS = defaultKnobs(UNKNOWN_PROFILE);

function contextFor(
  state: HandState, seat: number, snap: DecisionSnapshot, rng: Rng,
): BotContext {
  const p = state.players.find((x) => x.seat === seat)!;
  const legal = legalActions(state)!;
  const isHero = seat === snap.heroSeat;
  const profile = isHero
    ? HERO_BASELINE
    : (snap.opponents.find((o) => o.seat === seat)?.profile ?? UNKNOWN_PROFILE);

  let aggressions = 0;
  let lastAggressor = -1;
  let pfAggressor = -1;
  for (const a of state.log) {
    if (a.street === 'preflop' && a.kind === 'raise') pfAggressor = a.seat;
    if (a.street !== state.street) continue;
    if (a.kind === 'raise' || a.kind === 'bet') { aggressions++; lastAggressor = a.seat; }
  }

  const pot = state.players.reduce((s, x) => s + x.handCommit, 0);
  const bettor = state.street !== 'preflop' && state.currentBet > 0 && lastAggressor >= 0
    ? (snap.opponents.find((o) => o.seat === lastAggressor)?.profile ?? UNKNOWN_PROFILE)
    : undefined;

  return {
    profile,
    knobs: isHero ? HERO_BASELINE_KNOBS : knobsFor(profile),
    cards: p.cards,
    board: state.board,
    street: state.street,
    position: p.position,
    legal,
    pot,
    stack: p.stack,
    bigBlind: state.bigBlind,
    playersInHand: state.players.filter((x) => !x.folded).length,
    level: state.street === 'preflop' ? 1 + aggressions : 1,
    isPreflopAggressor: pfAggressor === seat,
    facingBet: state.street === 'preflop' ? true : state.currentBet > 0,
    bettor,
    rng,
    // Внутри доигрывания сила руки считается по выборке, а не полным
    // перебором: иначе один прогон стоил бы тысячи оценок комбинаций.
    fastSamples: FAST_SAMPLES,
  };
}

/**
 * Доиграть раздачу `sims` раз и вернуть средний результат выбранного действия.
 * Результат считается относительно момента решения: уже вложенное — не в счёт.
 */
export function rolloutAction(
  snap: DecisionSnapshot,
  scenarios: Scenario[],
  action: ActionRequest,
  seed: number,
): RolloutResult {
  // Сброс не требует моделирования: дальше герой ничего не вкладывает и
  // ничего не получает, поэтому результат ровно нулевой по определению.
  if (action.kind === 'fold') {
    return { ev: 0, sims: scenarios.length, stdErr: 0 };
  }

  let sum = 0;
  let sumSq = 0;
  let done = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const rng = makeRng(seed + i * 2654435761);
    const state = buildState(snap, scenarios[i]);
    const before = state.players.find((p) => p.seat === snap.heroSeat)!.stack;

    try {
      act(state, action);
    } catch {
      continue; // действие оказалось нелегальным в этой конфигурации
    }

    let guard = 0;
    while (!state.finished && guard++ < 60) {
      const legal = legalActions(state);
      if (!legal) break;
      const ctx = contextFor(state, legal.seat, snap, rng);
      try {
        act(state, decide(ctx));
      } catch {
        break;
      }
    }

    const hero = state.players.find((p) => p.seat === snap.heroSeat)!;
    const net = hero.stack - before;
    sum += net;
    sumSq += net * net;
    done++;
  }

  if (done === 0) return { ev: 0, sims: 0, stdErr: 0 };
  const mean = sum / done;
  const variance = Math.max(0, sumSq / done - mean * mean);
  return { ev: mean, sims: done, stdErr: Math.sqrt(variance / done) };
}
