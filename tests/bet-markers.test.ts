/**
 * Фишки текущей улицы на столе.
 *
 * Проверяется ровно то, что должен показывать интерфейс: у кого сколько лежит
 * на столе ИМЕННО на этой улице. Источник — движок (`Player.streetCommit`), и
 * тест следит, чтобы интерфейс ничего не досчитывал сам: после колла у игрока
 * должен остаться ОДИН маркер на полную сумму, а не два — «блайнд» и «доплата».
 */

import { describe, expect, it } from 'vitest';
import { act, createHand } from '../src/game/hand';
import { legalActions } from '../src/game/betting';
import { totalPot, type HandState } from '../src/game/types';
import { seatViews, type SeatView } from '../src/app/session';
import {
  KEEP_OUT, KEEP_OUT_NARROW, betSpots, chipCount, keepOutFor, markerSpot, pushOutOfCentre,
  type Point,
} from '../src/ui/betMarkers';

const SEAT_COORDS: Point[] = [
  { x: 50, y: 88 }, { x: 9, y: 70 }, { x: 9, y: 25 },
  { x: 50, y: 5 }, { x: 91, y: 25 }, { x: 91, y: 70 },
];
const SEAT_COORDS_NARROW: Point[] = [
  { x: 50, y: 82 }, { x: 17, y: 72 }, { x: 17, y: 24 },
  { x: 50, y: 8 }, { x: 83, y: 24 }, { x: 83, y: 72 },
];

const NAMES = ['withorwithout', 'PokerMind', 'MASELL', 'griffie', 'RiverShark', 'Lucky9090'];
const BB = 4;

function newHand(): HandState {
  return createHand({
    seats: NAMES.map((name) => ({ name, stack: 400 })),
    button: 0,
    smallBlind: 2,
    bigBlind: BB,
    seed: 12345,
  });
}

/** `seatViews` требует Session; для этих тестов хватает того, что оно читает. */
function views(state: HandState): SeatView[] {
  return seatViews({
    state,
    seatProfiles: [null, null, null, null, null, null],
  } as never);
}

function spots(state: HandState, narrow = false) {
  return betSpots(views(state), narrow ? SEAT_COORDS_NARROW : SEAT_COORDS, narrow, BB);
}

/** Сумма по нику — то, что игрок увидит под стопкой фишек. */
function shown(state: HandState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of spots(state)) out[state.players[s.seat].name] = s.amount;
  return out;
}

const seatOf = (state: HandState, name: string) =>
  state.players.findIndex((p) => p.name === name);

/** Довести улицу до конца, доигрывая её чеками и коллами. */
function finishStreet(state: HandState) {
  const street = state.street;
  let guard = 0;
  while (state.street === street && !state.finished && guard++ < 30) {
    const legal = legalActions(state);
    if (!legal) break;
    act(state, legal.canCheck ? { kind: 'check' } : { kind: 'call' });
  }
}

describe('фишки текущей улицы', () => {
  it('блайнды видны сразу: SB $0.02, BB $0.04', () => {
    const state = newHand();
    // Кнопка на месте 0, значит SB — место 1, BB — место 2.
    expect(shown(state)).toEqual({ PokerMind: 2, MASELL: 4 });
    expect(spots(state)).toHaveLength(2);
  });

  it('повышение обновляет сумму именно этого игрока', () => {
    const state = newHand();
    const raiser = state.toAct;
    act(state, { kind: 'raise', total: 10 });

    const byName = shown(state);
    expect(byName[state.players[raiser].name]).toBe(10);
    // Чужие суммы не поехали.
    expect(byName.PokerMind).toBe(2);
    expect(byName.MASELL).toBe(4);
  });

  it('колл доводит прежний блайнд до полной суммы одним маркером', () => {
    const state = newHand();
    act(state, { kind: 'raise', total: 10 });
    // Сбрасываем всех до малого блайнда: он ходит раньше большого, поэтому
    // после его колла улица ещё не закрывается и маркеры видно.
    const sb = seatOf(state, 'PokerMind');
    while (state.toAct !== sb) act(state, { kind: 'fold' });
    expect(shown(state).PokerMind).toBe(2);

    act(state, { kind: 'call' });

    // Ровно один маркер на $0.10, а не «$0.04» плюс «$0.06».
    const his = spots(state).filter((s) => s.seat === sb);
    expect(his).toHaveLength(1);
    expect(his[0].amount).toBe(10);
    // Большой блайнд ещё не ходил — его сумма не изменилась.
    expect(shown(state).MASELL).toBe(4);
  });

  it('3-бет показывает полную сумму повышения', () => {
    const state = newHand();
    act(state, { kind: 'raise', total: 10 });
    const three = state.toAct;
    act(state, { kind: 'raise', total: 36 });
    expect(shown(state)[state.players[three].name]).toBe(36);
  });

  it('на новой улице маркеров нет, а банк остаётся', () => {
    const state = newHand();
    act(state, { kind: 'raise', total: 10 });
    while (state.street === 'preflop' && !state.finished) {
      const legal = legalActions(state)!;
      act(state, legal.canCheck ? { kind: 'check' } : { kind: 'call' });
    }

    expect(state.street).toBe('flop');
    const potAfterPreflop = totalPot(state);
    expect(potAfterPreflop).toBe(60); // шесть игроков по $0.10
    expect(spots(state)).toEqual([]);

    // На флопе счёт снова с нуля, а банк только растёт.
    act(state, { kind: 'bet', total: 30 });
    expect(shown(state)[state.players[state.players.findIndex((p) => p.streetCommit === 30)].name]).toBe(30);
    expect(totalPot(state)).toBe(potAfterPreflop + 30);
  });

  it('каждая улица считает только свои деньги', () => {
    const state = newHand();
    while (state.street === 'preflop' && !state.finished) {
      const legal = legalActions(state)!;
      act(state, legal.canCheck ? { kind: 'check' } : { kind: 'call' });
    }
    finishStreet(state); // флоп чеками
    expect(state.street).toBe('turn');
    expect(spots(state)).toEqual([]);

    act(state, { kind: 'bet', total: 24 });
    const sum = spots(state).reduce((a, s) => a + s.amount, 0);
    expect(sum).toBe(24);
    // Банк уже включает и префлоп, поэтому он заведомо больше.
    expect(totalPot(state)).toBeGreaterThan(sum);
  });

  it('олл-ин остаётся на столе полной суммой', () => {
    const state = createHand({
      seats: NAMES.map((name, i) => ({ name, stack: i === 3 ? 70 : 400 })),
      button: 0, smallBlind: 2, bigBlind: BB, seed: 999,
    });
    const short = seatOf(state, 'griffie');
    while (state.toAct !== short) act(state, { kind: 'fold' });
    act(state, { kind: 'raise', total: 70 });

    const his = spots(state).find((s) => s.seat === short)!;
    expect(his.amount).toBe(70);
    expect(his.allIn).toBe(true);
  });

  it('сбросивший игрок не исчезает со стола, пока улица не кончилась', () => {
    const state = newHand();
    act(state, { kind: 'raise', total: 10 });
    const sb = seatOf(state, 'PokerMind');
    while (state.toAct !== sb) act(state, { kind: 'fold' });
    act(state, { kind: 'fold' });

    // Его $0.02 никуда не делись — они в банке.
    const his = spots(state).find((s) => s.seat === sb)!;
    expect(his.amount).toBe(2);
    expect(his.folded).toBe(true);
  });

  it('сумма всех маркеров — это ровно деньги текущей улицы', () => {
    const state = newHand();
    act(state, { kind: 'raise', total: 10 });
    act(state, { kind: 'call' });

    const fromMarkers = spots(state).reduce((a, s) => a + s.amount, 0);
    const fromEngine = state.players.reduce((a, p) => a + p.streetCommit, 0);
    expect(fromMarkers).toBe(fromEngine);
    // Префлоп — первая улица, поэтому здесь это ещё и весь банк.
    expect(fromMarkers).toBe(totalPot(state));
  });
});

describe('где стоит маркер', () => {
  it('каждый маркер лежит между своим местом и центром', () => {
    for (const narrow of [false, true]) {
      const coords = narrow ? SEAT_COORDS_NARROW : SEAT_COORDS;
      coords.forEach((seat, i) => {
        const p = markerSpot(seat, narrow, i === 0);
        const toCentre = Math.hypot(50 - seat.x, 50 - seat.y);
        const fromSeat = Math.hypot(p.x - seat.x, p.y - seat.y);
        expect(fromSeat).toBeGreaterThan(0);
        expect(fromSeat).toBeLessThan(toCentre);
      });
    }
  });

  it('направление к центру совпадает со стороной, где сидит игрок', () => {
    // Верхние места — маркер ниже них, нижние — выше, левые — правее, правые — левее.
    const cases: Array<[number, (seat: Point, p: Point) => boolean]> = [
      [0, (s, p) => p.y < s.y],
      [1, (s, p) => p.x > s.x && p.y < s.y],
      [2, (s, p) => p.x > s.x && p.y > s.y],
      [3, (s, p) => p.y > s.y],
      [4, (s, p) => p.x < s.x && p.y > s.y],
      [5, (s, p) => p.x < s.x && p.y < s.y],
    ];
    for (const narrow of [false, true]) {
      const coords = narrow ? SEAT_COORDS_NARROW : SEAT_COORDS;
      for (const [i, ok] of cases) {
        expect(ok(coords[i], markerSpot(coords[i], narrow, i === 0)),
          `место ${i}, narrow=${narrow}`).toBe(true);
      }
    }
  });

  it('ни один маркер не заходит в середину, где борд и банк', () => {
    for (const narrow of [false, true]) {
      const coords = narrow ? SEAT_COORDS_NARROW : SEAT_COORDS;
      const box = keepOutFor(narrow);
      coords.forEach((seat, i) => {
        const p = markerSpot(seat, narrow, i === 0);
        const inside = p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom;
        expect(inside, `место ${i}, narrow=${narrow}`).toBe(false);
      });
    }
  });

  it('маркеры не садятся друг на друга', () => {
    // Минимальный зазор в процентах стола: маркер шириной около 4% и высотой 3%.
    for (const narrow of [false, true]) {
      const coords = narrow ? SEAT_COORDS_NARROW : SEAT_COORDS;
      const pts = coords.map((c, i) => markerSpot(c, narrow, i === 0));
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const apart = Math.abs(pts[i].x - pts[j].x) > 9 || Math.abs(pts[i].y - pts[j].y) > 7;
          expect(apart, `места ${i} и ${j}, narrow=${narrow}`).toBe(true);
        }
      }
    }
  });

  it('точку из середины выталкивает по кратчайшей стороне', () => {
    expect(pushOutOfCentre({ x: 50, y: 37 }, KEEP_OUT)).toEqual({ x: 50, y: 35.5 });
    expect(pushOutOfCentre({ x: 50, y: 63 }, KEEP_OUT)).toEqual({ x: 50, y: 64.5 });
    expect(pushOutOfCentre({ x: 33, y: 50 }, KEEP_OUT)).toEqual({ x: 31, y: 50 });
    expect(pushOutOfCentre({ x: 67, y: 50 }, KEEP_OUT)).toEqual({ x: 69, y: 50 });
    // Снаружи — не трогаем.
    expect(pushOutOfCentre({ x: 20, y: 20 }, KEEP_OUT)).toEqual({ x: 20, y: 20 });
    expect(pushOutOfCentre({ x: 20, y: 20 }, KEEP_OUT_NARROW)).toEqual({ x: 20, y: 20 });
  });
});

describe('высота стопки', () => {
  it('растёт со ставкой, но не пытается быть точной', () => {
    expect(chipCount(0, BB)).toBe(0);
    expect(chipCount(2, BB)).toBe(2);   // малый блайнд
    expect(chipCount(8, BB)).toBe(2);   // 2bb
    expect(chipCount(10, BB)).toBe(3);
    expect(chipCount(40, BB)).toBe(3);  // 10bb
    expect(chipCount(41, BB)).toBe(5);
    expect(chipCount(400, BB)).toBe(5);
  });

  it('пороги заданы в блайндах, а не в центах', () => {
    // На вдвое больших блайндах те же 10 центов — это уже мелкая ставка.
    expect(chipCount(10, 8)).toBe(2);
    expect(chipCount(10, 4)).toBe(3);
  });
});
