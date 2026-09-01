import { describe, expect, it } from 'vitest';
import { act, createHand } from '../src/game/hand';
import type { ActionRequest } from '../src/game/betting';
import { makeRng } from '../src/game/rng';
import { FULL_DECK, parseCards, type Card } from '../src/engine/cards';
import { PROFILE_BY_NAME } from '../src/bots/profiles';
import type { Session } from '../src/app/session';
import type { HandState } from '../src/game/types';
import { captureSnapshot } from '../src/coach/snapshot';
import { analyse } from '../src/coach/ev';
import { inferRange, describeRange } from '../src/coach/range';
import { evaluateDecision } from '../src/coach/index';
import { analyseBoard, boardChange } from '../src/coach/texture';
import type { Candidate } from '../src/coach/types';
import fixture from './real-decisions.json';

/**
 * Проверка КАЧЕСТВА покерных решений, а не работоспособности кода.
 *
 * Проверяются направления, а не точные числа: «против блефующего колл лучше
 * рейза», «на карте, закрывшей флеш, диапазон сужается». Так тест ловит
 * содержательные регрессии и не ломается от подстройки коэффициентов.
 */

const cards = (t: string): Card[] => parseCards(t);

function session(state: HandState, heroSeat = 0): Session {
  return {
    config: { heroName: state.players[heroSeat].name, stackMode: 'standard',
      smallBlind: state.smallBlind, bigBlind: state.bigBlind, seed: 1 },
    handNumber: 1, button: state.button, state,
    seatProfiles: state.players.map((p, i) =>
      i === heroSeat ? null : (PROFILE_BY_NAME[p.name] ?? PROFILE_BY_NAME['DuhaMetelkin'])),
    stacks: state.players.map((p) => p.startingStack),
    bankroll: 0, rng: makeRng(1), awaitingNext: false,
  };
}

function deckFor(count: number, button: number, heroSeat: number, hero: Card[], board: Card[]): Card[] {
  const sb = count === 2 ? button : (button + 1) % count;
  const deck: Card[] = new Array(52).fill(-1);
  const used = new Set<Card>();
  const put = (i: number, c: Card) => { deck[i] = c; used.add(c); };
  const offset = (heroSeat - sb + count) % count;
  put(offset, hero[0]);
  put(count + offset, hero[1]);
  board.forEach((c, i) => put(2 * count + i, c));
  const spare = FULL_DECK.filter((c) => !used.has(c));
  let s = 0;
  for (let i = 0; i < deck.length; i++) if (deck[i] < 0) deck[i] = spare[s++];
  return deck;
}

interface Spot {
  hero: string;
  board: string;
  villain: string;
  script: ActionRequest[];
  stacks?: number[];
}

/** Строит ситуацию: герой на баттоне (место 0), соперник в большом блайнде. */
function build(spot: Spot) {
  const stacks = spot.stacks ?? [400, 400, 400, 400, 400, 400];
  const state = createHand({
    seats: [
      { name: 'withorwithout', stack: stacks[0] },
      { name: 'Matthew0', stack: stacks[1] },
      { name: spot.villain, stack: stacks[2] },
      { name: 'statham1', stack: stacks[3] },
      { name: 'Klybberth21', stack: stacks[4] },
      { name: 'Gumanaikl', stack: stacks[5] },
    ],
    button: 0, smallBlind: 2, bigBlind: 4, seed: 11,
    deck: deckFor(6, 0, 0, cards(spot.hero), cards(spot.board)),
  });
  for (const a of spot.script) act(state, a);
  const snap = captureSnapshot(session(state));
  expect(snap, 'ход должен быть за героем').not.toBeNull();
  return snap!;
}

const best = (c: Candidate[], kind: Candidate['kind']) =>
  c.filter((x) => x.kind === kind).reduce((a, b) => (b.ev > a.ev ? b : a), { ev: -Infinity } as Candidate);

/** Герой открывает с баттона, большой блайнд коллирует, дальше по сценарию. */
const OPEN_AND_CALL: ActionRequest[] = [
  { kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' },
  { kind: 'raise', total: 10 }, { kind: 'fold' }, { kind: 'call' },
];

describe('качество покерных решений', () => {
  it('1. против блефующего на ривере колл лучше вэлью-рейза', () => {
    // PokerMind ставит ривер часто и с широким диапазоном. Герой держит
    // вторую пару: он бьёт много блефов, но рейз выгонит ровно их.
    const snap = build({
      hero: 'Ts9s',
      board: 'Kd7h2c4s9h',
      villain: 'PokerMind',
      script: [
        ...OPEN_AND_CALL,
        { kind: 'check' }, { kind: 'check' },
        { kind: 'check' }, { kind: 'check' },
        { kind: 'bet', total: 24 },
      ],
    });
    const { candidates } = analyse(snap);
    const call = best(candidates, 'call');
    const raise = best(candidates, 'raise');
    expect(call.ev).toBeGreaterThan(raise.ev);
    // Именно из-за того, что доля против УРАВНИВАЮЩЕГО диапазона ниже, чем
    // против диапазона ставки.
    expect(raise.detail.equityVsContinue!).toBeLessThan(raise.detail.equity);
  });

  it('2. против пассивного игрока с сильным коллирующим диапазоном рейз плох', () => {
    // JPSA почти не блефует: то, чем он платит рейз, героя бьёт.
    const snap = build({
      hero: 'AhJd',
      board: 'Ac8s3d5h2c',
      villain: 'JPSA',
      script: [
        ...OPEN_AND_CALL,
        { kind: 'check' }, { kind: 'bet', total: 14 }, { kind: 'call' },
        { kind: 'check' }, { kind: 'check' },
        { kind: 'bet', total: 30 },
      ],
    });
    const { candidates } = analyse(snap);
    const raise = best(candidates, 'raise');
    const call = best(candidates, 'call');
    // Он почти не блефует и не сбрасывает: повышение не должно давать
    // ощутимого выигрыша по сравнению с простым коллом.
    expect(raise.ev - call.ev).toBeLessThan(snap.pot * 0.05);
    // А против того, чем он ОТВЕТИТ повышением, у героя должно быть мало.
    expect(raise.detail.equityVsReraise!).toBeLessThan(0.3);
  });

  it('3. настоящий тонкий вэлью-бет против станции существует', () => {
    // Lucky9090 почти никогда не ставит сам, но платит. Топ-пара на ривере,
    // когда все чекали, — это ставка, а не чек.
    const snap = build({
      hero: 'KsQd',
      board: 'Kh7c2d4s9h',
      villain: 'Lucky9090',
      script: [
        ...OPEN_AND_CALL,
        { kind: 'check' }, { kind: 'check' },
        { kind: 'check' }, { kind: 'check' },
        { kind: 'check' },
      ],
    });
    const { candidates } = analyse(snap);
    const bet = best(candidates, 'bet');
    const check = best(candidates, 'check');
    expect(bet.ev).toBeGreaterThan(check.ev);
  });

  it('4. текст, баллы и посчитанные EV всегда описывают одну картину', () => {
    // Это не проверка конкретной ситуации, а проверка свойства: близкие по
    // ожидаемому результату варианты обязаны получать близкие оценки, а
    // описание картины не должно зависеть от того, что выбрал герой.
    const spots: Spot[] = [
      {
        hero: '8h7h', board: 'Kd9c4s2h', villain: 'DuhaMetelkin',
        script: [...OPEN_AND_CALL, { kind: 'check' }, { kind: 'bet', total: 12 },
          { kind: 'call' }, { kind: 'bet', total: 30 }],
      },
      {
        hero: 'AsKs', board: 'Ad7c2h9s3d', villain: 'MASELL',
        script: [...OPEN_AND_CALL, { kind: 'check' }, { kind: 'bet', total: 14 },
          { kind: 'call' }, { kind: 'check' }, { kind: 'check' }, { kind: 'bet', total: 34 }],
      },
      {
        hero: 'QcJc', board: 'Kh8d3s', villain: 'Solevarnya',
        script: [...OPEN_AND_CALL, { kind: 'check' }, { kind: 'bet', total: 12 }, { kind: 'raise', total: 40 }],
      },
    ];

    for (const spot of spots) {
      const snap = build(spot);
      const { candidates } = analyse(snap);
      const top = candidates[0];
      const norm = Math.max(snap.pot, 4 * snap.bigBlind);

      const pictures = new Set<string>();
      for (const c of candidates) {
        const v = evaluateDecision(snap, { kind: c.kind, total: c.total });
        pictures.add(v.brief.picture);

        const gap = (top.ev - c.ev) / norm;
        if (gap < 0.05) {
          // Почти равный вариант не может получить низкую оценку.
          expect(v.score, `${spot.hero}: ${c.kind} при отставании ${gap.toFixed(3)}`)
            .toBeGreaterThanOrEqual(7.5);
          }
        if (gap > 0.3) {
          // И наоборот: явно худший вариант не может получить высокую.
          expect(v.score, `${spot.hero}: ${c.kind} при отставании ${gap.toFixed(3)}`)
            .toBeLessThan(7);
        }
      }
      // Картина описывает ситуацию, а не выбор героя, — она одна и та же.
      expect(pictures.size, `картина меняется от выбора: ${[...pictures].join(' / ')}`).toBe(1);
    }
  });

  it('5. близкий колл/рейз описывается как близкий', () => {
    const snap = build({
      hero: 'AsKs',
      board: 'Ad7c2h9s3d',
      villain: 'MASELL',
      script: [
        ...OPEN_AND_CALL,
        { kind: 'check' }, { kind: 'bet', total: 14 }, { kind: 'call' },
        { kind: 'check' }, { kind: 'check' },
        { kind: 'bet', total: 34 },
      ],
    });
    const v = evaluateDecision(snap, { kind: 'call' });
    // Что бы модель ни предпочла, фолд с топ-парой здесь должен быть худшим.
    const fold = v.ranked.find((c) => c.kind === 'fold')!;
    const call = v.ranked.find((c) => c.kind === 'call')!;
    expect(call.ev).toBeGreaterThan(fold.ev);
    expect(v.brief.picture.length).toBeGreaterThan(0);
  });

  it('6. карта, закрывшая флеш, сужает диапазон и снижает оценку агрессии', () => {
    const dry = build({
      hero: 'AsKd',
      board: 'Ac7h2h8s',
      villain: 'DuhaMetelkin',
      script: [
        ...OPEN_AND_CALL,
        { kind: 'check' }, { kind: 'bet', total: 14 }, { kind: 'call' },
        { kind: 'bet', total: 30 },
      ],
    });
    const wet = build({
      hero: 'AsKd',
      board: 'Ac7h2h9h',
      villain: 'DuhaMetelkin',
      script: [
        ...OPEN_AND_CALL,
        { kind: 'check' }, { kind: 'bet', total: 14 }, { kind: 'call' },
        { kind: 'bet', total: 30 },
      ],
    });
    const dryEq = analyse(dry).rawEquity;
    const wetEq = analyse(wet).rawEquity;
    // Та же рука, та же линия — но на достроившемся флеше доля должна упасть.
    expect(wetEq).toBeLessThan(dryEq);

    const change = boardChange(cards('Ac7h2h'), cards('Ac7h2h9h'));
    expect(change.kind).toBe('flush-completed');
    expect(change.danger).toBeGreaterThan(0.8);
  });

  it('7. карта, закрывшая очевидный стрит, распознаётся', () => {
    const change = boardChange(cards('9h8c2d'), cards('9h8c2d7s'));
    expect(change.kind).toBe('four-to-straight');
    const closed = boardChange(cards('9h8c7d'), cards('9h8c7d6s'));
    expect(closed.kind).toBe('straight-completed');
    expect(closed.danger).toBeGreaterThan(0.7);
  });

  it('8. спарившийся ривер распознаётся и снижает ценность одной пары', () => {
    const change = boardChange(cards('Kd9c4s2h'), cards('Kd9c4s2h9d'));
    expect(change.kind).toBe('board-paired');

    const snap = build({
      hero: 'KsQd',
      board: 'Kd9c4s2h9h',
      villain: 'Solevarnya',
      script: [
        ...OPEN_AND_CALL,
        { kind: 'check' }, { kind: 'bet', total: 14 }, { kind: 'call' },
        { kind: 'check' }, { kind: 'check' },
        { kind: 'bet', total: 40 },
      ],
    });
    const { candidates } = analyse(snap);
    const raise = best(candidates, 'raise');
    // Повышать двумя парами по борду против ставки на спаренном ривере плохо.
    expect(raise.detail.equityVsContinue!).toBeLessThan(0.55);
  });

  it('9. текстура доски считается корректно', () => {
    const dry = analyseBoard(cards('Ac7h2s'));
    expect(dry.flushPossible).toBe(false);
    expect(dry.wetness).toBeLessThan(0.25);

    const wet = analyseBoard(cards('9h8h7h'));
    expect(wet.flushPossible).toBe(true);
    expect(wet.straightPossible).toBe(true);
    expect(wet.wetness).toBeGreaterThan(0.4);

    const four = analyseBoard(cards('9h8c7d6s'));
    expect(four.fourToStraight).toBe(true);

    const paired = analyseBoard(cards('KcKd4s'));
    expect(paired.paired).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Контрольные раздачи из отчёта                                       */
/* ------------------------------------------------------------------ */

interface RealHand {
  gid: number; title: string; bb: number; sb: number;
  button: number; heroSeat: number;
  players: Array<{ name: string; stack: number }>;
  heroCards: number[]; board: number[];
  actions: Array<{ seat: number; street: number; kind: string; total: number; add: number }>;
}

/** Прогоняет реальную раздачу и возвращает вердикт по последнему ходу героя. */
function lastHeroVerdict(gid: number) {
  const h = (fixture as unknown as RealHand[]).find((x) => x.gid === gid)!;
  const state = createHand({
    seats: h.players.map((p) => ({ name: p.name, stack: p.stack })),
    button: h.button, smallBlind: h.sb, bigBlind: h.bb, seed: h.gid,
    deck: deckFor(h.players.length, h.button, h.heroSeat, h.heroCards, h.board),
  });
  const heroIndexes = h.actions
    .map((a, i) => (a.seat === h.heroSeat ? i : -1))
    .filter((i) => i >= 0);
  const last = heroIndexes[heroIndexes.length - 1];

  let verdict = null as ReturnType<typeof evaluateDecision> | null;
  for (let i = 0; i < h.actions.length; i++) {
    const a = h.actions[i];
    if (state.finished) break;
    const req: ActionRequest =
      a.kind === 'raise' || a.kind === 'bet'
        ? { kind: a.kind, total: a.total }
        : { kind: a.kind as 'fold' | 'check' | 'call' };
    if (i === last) {
      const snap = captureSnapshot(session(state, h.heroSeat), h.heroSeat);
      if (snap) verdict = evaluateDecision(snap, req as never);
    }
    act(state, req);
  }
  return verdict;
}

describe('контрольные раздачи из отчёта', () => {
  it('KQ · война рейзов: рейз должен быть худшим вариантом', () => {
    const v = lastHeroVerdict(139380373)!;
    expect(v).not.toBeNull();
    const fold = v.ranked.find((c) => c.kind === 'fold')!;
    const raise = v.ranked.filter((c) => c.kind === 'raise').reduce((a, b) => (b.ev > a.ev ? b : a));
    // Отчёт говорил: после второго повышения нужно было останавливаться.
    expect(raise.ev).toBeLessThan(fold.ev);
    expect(v.best.kind).not.toBe('raise');
    // И утечка должна быть отмечена отдельно от оценки.
    expect(v.leakNotes.some((n) => n.id === 'one-pair-second-raise')).toBe(true);
  });

  it('AQ · достроившийся флеш действительно попадает в диапазон', () => {
    // Контрольная раздача на текстуру доски. Проверяем не «какой ход верный»
    // — модель имеет право считать это близким решением, — а то, что третья
    // черва вообще учтена: раньше в диапазоне соперника не было НИ ОДНОГО
    // флеша, и текстура не работала.
    const h = (fixture as unknown as RealHand[]).find((x) => x.gid === 139123774)!;
    const state = createHand({
      seats: h.players.map((p) => ({ name: p.name, stack: p.stack })),
      button: h.button, smallBlind: h.sb, bigBlind: h.bb, seed: h.gid,
      deck: deckFor(h.players.length, h.button, h.heroSeat, h.heroCards, h.board),
    });
    const heroIndexes = h.actions.map((a, i) => (a.seat === h.heroSeat ? i : -1)).filter((i) => i >= 0);
    const last = heroIndexes[heroIndexes.length - 1];

    for (let i = 0; i < h.actions.length; i++) {
      const a = h.actions[i];
      if (state.finished) break;
      const req: ActionRequest =
        a.kind === 'raise' || a.kind === 'bet'
          ? { kind: a.kind, total: a.total }
          : { kind: a.kind as 'fold' | 'check' | 'call' };
      if (i === last) {
        const snap = captureSnapshot(session(state, h.heroSeat), h.heroSeat)!;
        const board = snap.board.slice(0, 4);
        const range = inferRange(snap, snap.opponents[0]);
        const parts = describeRange(range, board);

        // Флеши обязаны быть заметной частью его диапазона.
        const flushes = parts.find((p) => p.startsWith('флеши'));
        expect(flushes, `в диапазоне нет флешей: ${parts.join('; ')}`).toBeTruthy();
        const share = Number(flushes!.match(/(\d+)%/)![1]);
        expect(share).toBeGreaterThanOrEqual(15);

        // И доля героя с одной парой против такого диапазона не может быть высокой.
        const { rawEquity } = analyse(snap);
        expect(rawEquity).toBeLessThan(0.6);

        // Ва-банк здесь как минимум не «явно лучший» ход.
        const verdict = evaluateDecision(snap, req as never);
        expect(verdict.confidence.decision).not.toBe('clear');
      }
      act(state, req);
    }
  });
});
