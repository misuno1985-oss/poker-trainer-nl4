/**
 * Запись сессии для выгрузки.
 *
 * Собирается из тех же данных, что видит интерфейс: движок, тренер и боты
 * ничего про выгрузку не знают. Ни одна цифра здесь не считается заново — всё
 * уже посчитано во время игры, выгрузка только раскладывает это по полкам.
 *
 * Главное правило файла — то же, на котором стоит весь тренер: слепок решения
 * содержит ТОЛЬКО то, что герой видел в тот момент. Настоящие карты соперников
 * лежат отдельным блоком и явно помечены как скрытые во время игры, чтобы
 * внешний разбор мог сначала оценить решение без послезнания.
 */

import type { Card } from '../engine/cards';
import type { Action, HandResult, Position, Street } from '../game/types';
import type { BotProfile } from '../bots/profiles';
import type { CoachVerdict, DecisionSnapshot } from '../coach/types';
import type { CategoryId } from '../coach/categories';
import type { HandSetup } from './session';
import type { ModeKind } from './trainer';

export const SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.6';

/* ------------------------------------------------------------------ */
/* Что накапливается по ходу сессии                                    */
/* ------------------------------------------------------------------ */

/** Одно решение героя: что он видел, что выбрал и что сказал тренер. */
export interface LoggedDecision {
  /** Порядковый номер решения внутри раздачи. */
  index: number;
  street: Street;
  /** Состояние ДО действия — ровно то, что получил тренер. */
  snapshot: DecisionSnapshot;
  chosen: { kind: string; totalCents?: number };
  verdict: CoachVerdict;
  categories: CategoryId[];
  villain: string;
  /** Миллисекунды от начала сессии. */
  atMs: number;
}

/** Раздача целиком. */
export interface LoggedHand {
  handNumber: number;
  setup: HandSetup;
  seats: Array<{
    seat: number;
    name: string;
    isHero: boolean;
    position: Position;
    startingStackCents: number;
    endingStackCents: number;
  }>;
  heroSeat: number;
  heroCards: [Card, Card];
  board: Card[];
  log: Action[];
  decisions: LoggedDecision[];
  result: HandResult | null;
  heroNetCents: number;
  potCents: number;
  showdown: boolean;
  /** Настоящие карты всех, кто их получил. Во время игры герой их не видел. */
  actualHoleCards: Array<{ seat: number; name: string; cards: Card[]; revealedToHero: boolean }>;
  startedAt: number;
  endedAt: number;
  /** Раздача продолжилась сама или игрок нажал кнопку. */
  autoAdvanced: boolean;
  /** Игрок просил остановиться после этой раздачи. */
  pausedAfter: boolean;
  /** Раздачу переигрывали — в статистику сессии она не идёт. */
  isReplay: boolean;
  replayCount: number;
}

/** Всё, что нужно знать о сессии для выгрузки. */
export interface SessionLog {
  id: string;
  mode: ModeKind;
  modeDetail: string | null;
  targetHands: number | null;
  startedAt: number;
  endedAt: number;
  smallBlindCents: number;
  bigBlindCents: number;
  heroName: string;
  hands: LoggedHand[];
}

/* ------------------------------------------------------------------ */
/* Выгрузка                                                            */
/* ------------------------------------------------------------------ */

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Деньги везде целыми центами; строка рядом — только для чтения глазами. */
function amount(cents: number) {
  return { cents, display: money(cents) };
}

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';

/** Карта в привычной записи. Внутри движка это число, здесь — «Ts». */
export function cardText(card: Card): string {
  if (card < 0) return '';
  return RANKS[card >> 2] + SUITS[card & 3];
}

const cards = (cs: readonly Card[]) => cs.map(cardText);

/** Понятное имя действия вместо строчки для глаз. */
export function actionCode(a: Action): string {
  if (a.kind === 'post') return a.total <= 0 ? 'POST' : 'POST_BLIND';
  if (a.allIn && a.kind !== 'fold' && a.kind !== 'check') return 'ALL_IN';
  return a.kind.toUpperCase();
}

interface Running {
  potBefore: number;
  stacks: Map<number, number>;
  commits: Map<number, number>;
}

/**
 * Протокол с суммами до и после каждого действия.
 *
 * Движок хранит только сами действия, поэтому банк и стеки восстанавливаются
 * прокруткой протокола вперёд. Ничего не досчитывается «по-новому»: берутся те
 * же числа, что уже лежат в действиях.
 */
export function serialiseLog(hand: LoggedHand) {
  const run: Running = {
    potBefore: 0,
    stacks: new Map(hand.seats.map((s) => [s.seat, s.startingStackCents])),
    commits: new Map(hand.seats.map((s) => [s.seat, 0])),
  };
  const byPosition = new Map(hand.seats.map((s) => [s.seat, s.position]));
  const byName = new Map(hand.seats.map((s) => [s.seat, s.name]));
  let street: Street | null = null;

  return hand.log.map((a, i) => {
    // Новая улица — вклады обнуляются, как и в движке.
    if (street !== a.street) {
      street = a.street;
      for (const seat of run.commits.keys()) run.commits.set(seat, 0);
    }
    const stackBefore = run.stacks.get(a.seat) ?? 0;
    const commitBefore = run.commits.get(a.seat) ?? 0;
    const potBefore = run.potBefore;

    run.potBefore += a.amount;
    run.stacks.set(a.seat, stackBefore - a.amount);
    run.commits.set(a.seat, commitBefore + a.amount);

    return {
      eventIndex: i,
      street: a.street,
      seat: a.seat,
      nick: byName.get(a.seat) ?? '',
      position: byPosition.get(a.seat) ?? null,
      action: actionCode(a),
      rawKind: a.kind,
      allIn: a.allIn,
      amountAdded: amount(a.amount),
      amountTo: amount(a.total),
      potBefore: amount(potBefore),
      potAfter: amount(run.potBefore),
      stackBefore: amount(stackBefore),
      stackAfter: amount(stackBefore - a.amount),
      streetCommitBefore: amount(commitBefore),
      streetCommitAfter: amount(commitBefore + a.amount),
    };
  });
}

/** Соперник глазами героя — без карт, как и в самом слепке. */
function serialiseOpponents(snap: DecisionSnapshot) {
  return snap.opponents.map((o) => ({
    seat: o.seat,
    nick: o.name,
    position: o.position,
    stack: amount(o.stack),
    streetCommit: amount(o.streetCommit),
    handCommit: amount(o.handCommit),
    folded: o.folded,
    allIn: o.allIn,
    isPreflopAggressor: o.isPreflopAggressor,
    profileSample: o.profile.hands,
    archetype: o.profile.archetype,
  }));
}

/**
 * Слепок решения. Здесь нет и не может быть чужих карт: в самом типе
 * `DecisionSnapshot` для них нет поля.
 */
export function serialiseSnapshot(snap: DecisionSnapshot) {
  return {
    street: snap.street,
    heroCards: cards(snap.heroCards),
    board: cards(snap.board),
    heroSeat: snap.heroSeat,
    heroPosition: snap.heroPosition,
    heroStack: amount(snap.heroStack),
    heroStreetCommit: amount(snap.heroStreetCommit),
    heroHandCommit: amount(snap.heroHandCommit),
    heroIsPreflopAggressor: snap.heroIsPreflopAggressor,
    heroInPosition: snap.heroInPosition,
    effectiveStack: amount(snap.effectiveStack),
    pot: amount(snap.pot),
    bigBlind: amount(snap.bigBlind),
    button: snap.button,
    seatCount: snap.seatCount,
    currentBet: amount(snap.currentBet),
    lastRaiseSize: amount(snap.lastRaiseSize),
    deadMoney: amount(snap.deadMoney),
    preflopLevel: snap.preflopLevel,
    activeCount: snap.activeCount,
    amountToCall: amount(snap.legal.toCall),
    legalActions: {
      canFold: true,
      canCheck: snap.legal.canCheck,
      canCall: snap.legal.canCall,
      canBet: snap.legal.canBet,
      canRaise: snap.legal.canRaise,
      minBetTotal: amount(snap.legal.minBetTotal),
      minRaiseTotal: amount(snap.legal.minRaiseTotal),
      allInTotal: amount(snap.legal.allInTotal),
    },
    opponents: serialiseOpponents(snap),
    history: snap.history.map((a) => ({
      street: a.street,
      seat: a.seat,
      action: actionCode(a),
      amountAdded: amount(a.amount),
      amountTo: amount(a.total),
      allIn: a.allIn,
    })),
  };
}

const candidate = (c: CoachVerdict['chosen']) => ({
  action: c.kind.toUpperCase(),
  amountTo: c.total === undefined ? null : amount(c.total),
  ev: amount(Math.round(c.ev)),
  equity: c.detail.equity,
  equityVsContinue: c.detail.equityVsContinue ?? null,
  equityVsReraise: c.detail.equityVsReraise ?? null,
  foldEquity: c.detail.foldEquity ?? null,
  callChance: c.detail.callChance ?? null,
  reraiseChance: c.detail.reraiseChance ?? null,
  potOdds: c.detail.potOdds ?? null,
  toCall: c.detail.toCall === undefined ? null : amount(c.detail.toCall),
  rollout: c.detail.rollout ?? null,
  note: c.detail.note ?? null,
});

/** Вердикт тренера целиком — ровно то, что он посчитал во время игры. */
export function serialiseVerdict(v: CoachVerdict) {
  return {
    score: v.score,
    actionScore: v.actionScore,
    sizingScore: v.sizingScore,
    chosen: candidate(v.chosen),
    recommended: candidate(v.best),
    alternatives: v.ranked.map(candidate),
    rolloutUsed: v.ranked.some((c) => c.detail.rollout !== undefined),
    confidence: {
      data: v.confidence.data,
      opponentSample: v.confidence.sample,
      decision: v.confidence.decision,
      closeDecision: v.confidence.decision !== 'clear',
    },
    brief: {
      good: v.brief.good,
      bad: v.brief.bad,
      better: v.brief.better,
      picture: v.brief.picture,
    },
    // Факты из базы, выводы модели и арифметика помечены отдельно — так же,
    // как они помечены в интерфейсе.
    explanation: v.why.map((s) => ({ title: s.title, kind: s.kind, lines: s.lines })),
    leaks: v.leakNotes.map((n) => ({ id: n.id, title: n.title, text: n.text, triggered: n.triggered })),
  };
}

export interface SummaryInput {
  decisionScore: number;
  netCents: number;
  good: number;
  borderline: number;
  mistakes: number;
  major: number;
  insights: Array<{ text: string; tone: string }>;
  focus: string | null;
  focusReason: string;
  categories: Array<{ id: CategoryId; title: string; total: number; good: number; mistakes: number }>;
  majorMistakes: Array<{
    handNumber: number;
    street: string;
    scoreValue: number;
    heroCards: string[];
    board: string[];
    position: string;
    villain: string;
    did: string;
    better: string;
  }>;
}

/** Итоговый объект выгрузки. */
export function buildExport(
  log: SessionLog,
  summary: SummaryInput,
  profiles: BotProfile[],
  now: number,
): unknown {
  const counted = log.hands.filter((h) => !h.isReplay);

  let running = 0;
  const timeline = counted.map((h) => {
    running += h.heroNetCents;
    const scores = h.decisions.map((d) => d.verdict.score);
    return {
      handNumber: h.handNumber,
      heroNet: amount(h.heroNetCents),
      cumulativeNet: amount(running),
      decisionScores: scores,
      handAverageScore: scores.length
        ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
        : null,
      elapsedMs: h.endedAt - log.startedAt,
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date(now).toISOString(),

    session: {
      id: log.id,
      mode: log.mode,
      modeDetail: log.modeDetail,
      targetHands: log.targetHands,
      handsPlayed: counted.length,
      replayedHands: log.hands.filter((h) => h.isReplay).length,
      startedAt: new Date(log.startedAt).toISOString(),
      endedAt: new Date(log.endedAt).toISOString(),
      durationMs: log.endedAt - log.startedAt,
      heroName: log.heroName,
      stakes: {
        smallBlind: amount(log.smallBlindCents),
        bigBlind: amount(log.bigBlindCents),
        label: `${money(log.smallBlindCents)}/${money(log.bigBlindCents)}`,
      },
      result: {
        netPnL: amount(summary.netCents),
        decisionScore: summary.decisionScore,
        decisions: summary.good + summary.borderline + summary.mistakes,
        goodDecisions: summary.good,
        borderlineDecisions: summary.borderline,
        mistakes: summary.mistakes,
        majorMistakes: summary.major,
      },
      summary: {
        insights: summary.insights,
        focusNextSession: summary.focus,
        focusReason: summary.focusReason,
        categories: summary.categories,
      },
      majorMistakes: summary.majorMistakes,
      timeline,
    },

    // Профиль каждого соперника — один раз на сессию, а не копией в каждой руке.
    opponentProfiles: Object.fromEntries(profiles.map((p) => [p.name, {
      nick: p.name,
      archetype: p.archetype,
      realSampleHands: p.hands,
      measured: {
        vpip: p.vpip, pfr: p.pfr, threeBet: p.threeBet, limp: p.limp,
        openByPosition: p.openBy, openSizeBB: p.openSizeBB,
        coldCall: p.coldCall, defendCall: p.defendCall, defendThreeBet: p.defendThreeBet,
        foldTo3Bet: p.foldTo3Bet, call3Bet: p.call3Bet, fourBet: p.fourBet,
        cbet: p.cbet, wtsd: p.wtsd, wsd: p.wsd,
        flop: p.flop, turn: p.turn, river: p.river,
      },
      sampleSizes: p.samples,
      note: p.hands === 0
        ? 'Незнакомый игрок: усреднение по всем профилям, своей выборки нет.'
        : 'Частоты измерены по реальной базе; при малой выборке подтянуты к архетипу.',
    }])),

    hands: log.hands.map((h) => ({
      handNumber: h.handNumber,
      isReplay: h.isReplay,
      countedInSession: !h.isReplay,
      replayCount: h.replayCount,
      autoAdvanced: h.autoAdvanced,
      pausedAfter: h.pausedAfter,
      startedAt: new Date(h.startedAt).toISOString(),
      endedAt: new Date(h.endedAt).toISOString(),

      // Зерна и расстановки хватает, чтобы позже воспроизвести раздачу заново.
      deterministicSetup: {
        seed: h.setup.seed,
        button: h.setup.button,
        seatNames: h.setup.seatNames,
        startingStacks: h.setup.stacks.map(amount),
        heroActions: h.decisions.map((d) => d.chosen),
      },

      seats: h.seats.map((s) => ({
        seat: s.seat,
        nick: s.name,
        isHero: s.isHero,
        position: s.position,
        startingStack: amount(s.startingStackCents),
        endingStack: amount(s.endingStackCents),
      })),

      heroSeat: h.heroSeat,
      heroCards: cards(h.heroCards),
      board: cards(h.board),
      // Внесено по протоколу и осталось в банке — это РАЗНЫЕ числа: если
      // последнюю ставку никто не уравнял, непокрытая часть возвращается.
      // Без этой пары внешний разбор спотыкался бы о расхождение.
      potContributed: amount(h.log.reduce((a, x) => a + x.amount, 0)),
      pot: amount(h.potCents),
      uncalledReturned: amount(h.log.reduce((a, x) => a + x.amount, 0) - h.potCents),
      showdown: h.showdown,
      winners: h.result ? h.result.awards.flatMap((a) => a.winners) : [],
      awards: h.result
        ? h.result.awards.map((a) => ({
            winners: a.winners,
            perWinner: amount(a.perWinner),
            oddChipTo: a.oddChipTo,
            handValue: a.handValue,
          }))
        : [],
      heroResult: amount(h.heroNetCents),

      actions: serialiseLog(h),

      decisions: h.decisions.map((d) => ({
        decisionId: `${log.id}-h${h.handNumber}-d${d.index}`,
        handNumber: h.handNumber,
        index: d.index,
        street: d.street,
        atMs: d.atMs,
        categories: d.categories,
        mainVillain: d.villain,
        // Только то, что герой видел в тот момент. Чужих карт здесь нет.
        heroVisibleState: serialiseSnapshot(d.snapshot),
        chosenAction: {
          action: d.chosen.kind.toUpperCase(),
          amountTo: d.chosen.totalCents === undefined ? null : amount(d.chosen.totalCents),
        },
        coach: serialiseVerdict(d.verdict),
      })),

      // Отдельный блок с настоящими картами — только для разбора постфактум.
      omniscient: {
        hiddenFromHeroDuringPlay: true,
        note: 'Карты соперников. Во время игры герой их не видел; в слепках решений их нет.',
        holeCards: h.actualHoleCards.map((c) => ({
          seat: c.seat,
          nick: c.name,
          cards: cards(c.cards),
          revealedToHero: c.revealedToHero,
        })),
      },
    })),
  };
}

/** Имя файла: читаемое, с датой и режимом. */
export function exportFileName(log: SessionLog, now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const counted = log.hands.filter((h) => !h.isReplay).length;

  switch (log.mode) {
    case 'weak-spot':
      return `NL4-weakspot-${safe(log.modeDetail ?? 'spot')}-${stamp}.json`;
    case 'versus':
      return `NL4-vs-${safe(log.modeDetail ?? 'player')}-${stamp}.json`;
    case 'session':
      return `NL4-session-${stamp}-${counted}hands.json`;
    default:
      return `NL4-freeplay-${stamp}-${counted}hands.json`;
  }
}
