/**
 * Таймлайн стола: движение и звук от одного события.
 *
 * Здесь проверяется главное обещание этой части интерфейса: каждое событие
 * несёт И анимацию, И звук, и запускается одним вызовом. Поэтому «сначала
 * звук, потом карта» — не вопрос настройки таймеров, а вещь, которая просто
 * не может случиться.
 *
 * Отдельно проверяется переигрывание: техническая пересборка раздачи не должна
 * порождать ни звуков, ни анимаций.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BOARD_STAGGER_MS, DEAL_STAGGER_MS,
  buildPlan, dealOrder, type Cue, type TableSnapshot,
} from '../src/ui/tableTimeline';
import type { Action, Street } from '../src/game/types';
import { rankLabel, cardRankLabel, isTen, TEN } from '../src/ui/rankLabel';
import { RANKS, makeCard, parseCard } from '../src/engine/cards';
import { ALL_CLASSES } from '../src/engine/range';
import { dealerSpot } from '../src/ui/DealerButton';

const SEATS = 6;

const action = (kind: Action['kind'], seat = 1, extra: Partial<Action> = {}): Action => ({
  seat, street: 'flop', kind, amount: 0, total: 0, allIn: false, ...extra,
});

function snap(over: Partial<TableSnapshot> = {}): TableSnapshot {
  return {
    hand: 'h1',
    street: 'preflop',
    log: [],
    board: 0,
    button: 0,
    folded: [],
    shown: [],
    finished: false,
    winners: [],
    committed: [0, 0, 0, 0, 0, 0],
    ...over,
  };
}

const kinds = (cues: Cue[]) => cues.map((c) => c.kind.type);
const find = (cues: Cue[], type: string) => cues.filter((c) => c.kind.type === type);

/* ------------------------------------------------------------------ */
/* Появление и уход карт                                               */
/* ------------------------------------------------------------------ */

describe('карты приходят и уходят событиями', () => {
  it('новая раздача раздаёт карты каждому месту, по очереди', () => {
    const plan = buildPlan(snap(), snap({ hand: 'h2', log: [] }), SEATS);
    const deals = find(plan.cues, 'deal');
    expect(deals).toHaveLength(SEATS);
    // Порядок — от малого блайнда, как за настоящим столом.
    expect(deals.map((c) => (c.kind as { seat: number }).seat)).toEqual(dealOrder(0, SEATS));
    // И по очереди, а не все разом.
    expect(deals[1].at - deals[0].at).toBe(DEAL_STAGGER_MS);
    expect(plan.reset).toBe(true);
  });

  it('у раздачи карт свой тихий звук', () => {
    const plan = buildPlan(snap(), snap({ hand: 'h2' }), SEATS);
    for (const cue of find(plan.cues, 'deal')) expect(cue.sound).toBe('deal');
  });

  it('пас даёт событие ухода карт в мак и звук сброса — вместе', () => {
    const before = snap();
    const after = snap({ log: [action('fold', 2)], folded: [2] });
    const cues = buildPlan(before, after, SEATS).cues;

    expect(kinds(cues)).toEqual(['fold']);
    const fold = cues[0];
    expect(fold.kind).toEqual({ type: 'fold', seat: 2 });
    // Одна и та же подсказка несёт и движение, и звук: разойтись им негде.
    expect(fold.sound).toBe('fold');
    expect(fold.at).toBe(0);
  });

  it('флоп раскрывается тремя картами по очереди, каждая со своим звуком', () => {
    const before = snap({ street: 'preflop', board: 0 });
    const after = snap({ street: 'flop', board: 3 });
    const cues = buildPlan(before, after, SEATS).cues;

    const board = find(cues, 'board');
    expect(board).toHaveLength(3);
    expect(board.map((c) => (c.kind as { index: number }).index)).toEqual([0, 1, 2]);
    for (const c of board) expect(c.sound).toBe('card');
    // Именно по очереди.
    expect(board[1].at - board[0].at).toBe(BOARD_STAGGER_MS);
    expect(board[2].at - board[1].at).toBe(BOARD_STAGGER_MS);
  });

  it('тёрн и ривер — одна карта, одно раскрытие', () => {
    const turn = buildPlan(snap({ street: 'flop', board: 3 }), snap({ street: 'turn', board: 4 }), SEATS);
    expect(find(turn.cues, 'board')).toHaveLength(1);

    const river = buildPlan(snap({ street: 'turn', board: 4 }), snap({ street: 'river', board: 5 }), SEATS);
    expect(find(river.cues, 'board')).toHaveLength(1);
    expect(find(river.cues, 'board')[0].sound).toBe('card');
  });

  it('вскрытие чужих карт — своё событие со своим звуком', () => {
    const before = snap({ street: 'river', board: 5 });
    const after = snap({ street: 'river', board: 5, shown: [0, 3], finished: true, winners: [3] });
    const cues = buildPlan(before, after, SEATS).cues;

    const reveals = find(cues, 'reveal');
    expect(reveals).toHaveLength(2);
    for (const c of reveals) expect(c.sound).toBe('reveal');
  });
});

/* ------------------------------------------------------------------ */
/* Фишки                                                               */
/* ------------------------------------------------------------------ */

describe('фишки', () => {
  it('ставка даёт событие движения фишек со своим звуком', () => {
    const cues = buildPlan(snap(), snap({ log: [action('bet', 4, { total: 30 })] }), SEATS).cues;
    expect(cues[0].kind).toEqual({ type: 'chips', seat: 4 });
    expect(cues[0].sound).toBe('bet');
  });

  it('колл, рейз и олл-ин звучат по-разному, но двигают те же фишки', () => {
    const one = (a: Action) => buildPlan(snap(), snap({ log: [a] }), SEATS).cues[0];
    expect(one(action('call', 1)).sound).toBe('call');
    expect(one(action('raise', 1)).sound).toBe('raise');
    expect(one(action('raise', 1, { allIn: true })).sound).toBe('allin');
    for (const a of [action('call', 1), action('raise', 1), action('raise', 1, { allIn: true })]) {
      expect(one(a).kind).toEqual({ type: 'chips', seat: 1 });
    }
  });

  it('блайнды кладутся на стол в начале раздачи', () => {
    const after = snap({
      hand: 'h2',
      log: [action('post', 1, { street: 'preflop', total: 2 }), action('post', 2, { street: 'preflop', total: 4 })],
    });
    const cues = buildPlan(snap(), after, SEATS).cues;
    const chips = find(cues, 'chips');
    expect(chips).toHaveLength(2);
    for (const c of chips) expect(c.sound).toBe('blind');
    // После сдачи карт, а не до неё.
    const deals = find(cues, 'deal');
    expect(chips[0].at).toBeGreaterThanOrEqual(deals[deals.length - 1].at);
  });

  it('добор до общей суммы — то же место, а не второй маркер', () => {
    // Большой блайнд уравнивает повышение: у него меняется вклад, а событие
    // адресовано ровно его месту.
    const before = snap({ committed: [0, 2, 4, 0, 0, 0], log: [action('raise', 3, { total: 10 })] });
    const after = snap({
      committed: [0, 2, 10, 0, 0, 0],
      log: [action('raise', 3, { total: 10 }), action('call', 2, { total: 10 })],
    });
    const cues = buildPlan(before, after, SEATS).cues;
    expect(cues).toHaveLength(1);
    expect(cues[0].kind).toEqual({ type: 'chips', seat: 2 });
  });

  it('конец круга торговли собирает фишки в центр — вместе со звуком сбора', () => {
    const cues = buildPlan(
      snap({ street: 'preflop', board: 0 }),
      snap({ street: 'flop', board: 3 }),
      SEATS,
    ).cues;
    const collect = find(cues, 'collect');
    expect(collect).toHaveLength(1);
    expect(collect[0].sound).toBe('collect');
    // Сбор идёт ПЕРЕД тем, как лягут новые карты.
    expect(collect[0].at).toBeLessThan(find(cues, 'board')[0].at);
  });

  it('банк уходит победителю одним событием со звуком выигрыша', () => {
    const cues = buildPlan(
      snap({ street: 'river', board: 5 }),
      snap({ street: 'river', board: 5, finished: true, winners: [4] }),
      SEATS,
    ).cues;
    const award = find(cues, 'award');
    expect(award).toHaveLength(1);
    expect(award[0].kind).toEqual({ type: 'award', seat: 4 });
    expect(award[0].sound).toBe('win');
  });

  it('делёж банка не даёт двух звуков подряд', () => {
    const cues = buildPlan(
      snap({ street: 'river', board: 5 }),
      snap({ street: 'river', board: 5, finished: true, winners: [1, 4] }),
      SEATS,
    ).cues;
    expect(find(cues, 'award')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Звук и движение — одно событие                                      */
/* ------------------------------------------------------------------ */

describe('звук и движение идут от одного события', () => {
  it('у каждой озвученной подсказки есть и вид анимации, и момент', () => {
    const before = snap({ street: 'preflop', board: 0 });
    const after = snap({
      street: 'flop',
      board: 3,
      log: [action('call', 1), action('fold', 2)],
      folded: [2],
    });
    const cues = buildPlan(before, after, SEATS).cues;

    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.kind.type).toBeTruthy();
      expect(Number.isFinite(cue.at)).toBe(true);
      expect(cue.at).toBeGreaterThanOrEqual(0);
    }
    // Звук сброса привязан ровно к уходу карт в мак, а не к соседнему событию.
    const fold = cues.find((c) => c.kind.type === 'fold')!;
    expect(fold.sound).toBe('fold');
    // Звук карты борда — к раскрытию именно этой карты.
    for (const c of find(cues, 'board')) expect(c.sound).toBe('card');
  });

  it('каждая карта борда получает собственный момент, а не один общий', () => {
    const cues = buildPlan(snap(), snap({ street: 'flop', board: 3 }), SEATS).cues;
    const at = find(cues, 'board').map((c) => c.at);
    expect(new Set(at).size).toBe(3);
  });

  it('таймлайн не знает ни про React, ни про Web Audio, ни про движок', () => {
    const src = readFileSync(new URL('../src/ui/tableTimeline.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from 'react'/);
    expect(src).not.toMatch(/AudioContext/);
    expect(src).not.toMatch(/from '\.\.\/(coach|bots|app)\//);
    // Из движка — только типы состояния.
    expect(src).toMatch(/import type \{ Action, Street \} from '\.\.\/game\/types'/);
  });
});

/* ------------------------------------------------------------------ */
/* Переигрывание                                                       */
/* ------------------------------------------------------------------ */

describe('переигрывание', () => {
  it('первый кадр ничего не проигрывает', () => {
    const plan = buildPlan(null, snap({ board: 5, log: [action('call'), action('fold')] }), SEATS);
    expect(plan.cues).toEqual([]);
    expect(plan.jump).toBe(true);
  });

  it('пересборка раздачи молчит и не анимирует', () => {
    // Была доигранная раздача, нажали «переиграть»: протокол стал короче.
    const before = snap({
      street: 'river', board: 5, finished: true,
      log: [action('call'), action('call'), action('bet'), action('fold')],
    });
    const after = snap({ street: 'preflop', board: 0, log: [action('post'), action('post')] });

    const plan = buildPlan(before, after, SEATS);
    expect(plan.cues).toEqual([]);
    expect(plan.jump).toBe(true);
    expect(plan.reset).toBe(false);
  });

  it('после пересборки воспроизведение идёт как обычная игра', () => {
    const restored = snap({ log: [action('post'), action('post')] });
    const played = snap({ log: [action('post'), action('post'), action('raise', 3)] });
    const cues = buildPlan(restored, played, SEATS).cues;
    expect(cues).toHaveLength(1);
    expect(cues[0].kind).toEqual({ type: 'chips', seat: 3 });
    expect(cues[0].sound).toBe('raise');
  });

  it('повторный кадр без изменений не порождает событий', () => {
    const s = snap({ log: [action('call')] });
    expect(buildPlan(s, snap({ log: [action('call')] }), SEATS).cues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Кнопка дилера                                                       */
/* ------------------------------------------------------------------ */

describe('кнопка дилера', () => {
  const COORDS = [
    { x: 50, y: 88 }, { x: 9, y: 70 }, { x: 9, y: 25 },
    { x: 50, y: 5 }, { x: 91, y: 25 }, { x: 91, y: 70 },
  ];

  it('на новой раздаче переезжает к новому месту', () => {
    const plan = buildPlan(snap({ button: 0 }), snap({ hand: 'h2', button: 1 }), SEATS);
    const move = find(plan.cues, 'button');
    expect(move).toHaveLength(1);
    expect(move[0].kind).toEqual({ type: 'button', seat: 1 });
    // Переезд беззвучный: это не действие игрока.
    expect(move[0].sound).toBeNull();
  });

  it('внутри раздачи никуда не двигается', () => {
    const cues = buildPlan(snap({ button: 2 }), snap({ button: 2, log: [action('call')] }), SEATS).cues;
    expect(find(cues, 'button')).toHaveLength(0);
  });

  it('лежит на столе рядом со своим местом, а не в его табличке', () => {
    for (const narrow of [false, true]) {
      COORDS.forEach((seat, i) => {
        const p = dealerSpot(seat, narrow, i === 0);
        // Не на самом месте и не в центре.
        const fromSeat = Math.hypot(p.x - seat.x, p.y - seat.y);
        const toCentre = Math.hypot(50 - seat.x, 50 - seat.y);
        expect(fromSeat).toBeGreaterThan(2);
        expect(fromSeat).toBeLessThan(toCentre);
        // И в пределах стола.
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(100);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(100);
      });
    }
  });
});

/* ------------------------------------------------------------------ */
/* Порядок и сдержанность                                              */
/* ------------------------------------------------------------------ */

describe('игра не превращается в кино', () => {
  it('вся пачка событий укладывается в короткое время', () => {
    // Худший случай: олл-ин, доигрывание всех пяти карт и вскрытие.
    const before = snap({ street: 'preflop', board: 0 });
    const after = snap({
      street: 'showdown', board: 5, finished: true, winners: [2], shown: [1, 2],
      log: [action('raise', 1, { allIn: true }), action('call', 2, { allIn: true })],
    });
    const cues = buildPlan(before, after, SEATS).cues;
    const last = Math.max(...cues.map((c) => c.at));
    // Меньше секунды от первого события до последнего.
    expect(last).toBeLessThan(1000);
  });

  it('раздача карт занимает меньше трети секунды', () => {
    const plan = buildPlan(snap(), snap({ hand: 'h2' }), SEATS);
    const deals = find(plan.cues, 'deal');
    expect(deals[deals.length - 1].at).toBeLessThan(330);
  });

  it('порядок событий читается как настоящий стол', () => {
    const cues = buildPlan(
      snap({ street: 'preflop', board: 0 }),
      snap({ street: 'flop', board: 3, log: [action('call', 5)] }),
      SEATS,
    ).cues;
    // Сначала ход игрока, потом сбор фишек, потом карты.
    expect(kinds(cues)).toEqual(['chips', 'collect', 'board', 'board', 'board']);
    for (let i = 1; i < cues.length; i++) expect(cues[i].at).toBeGreaterThanOrEqual(cues[i - 1].at);
  });
});

/* ------------------------------------------------------------------ */
/* Десятка и рисунок карты                                             */
/* ------------------------------------------------------------------ */

describe('карта на экране', () => {
  it('десятка показывается как «10»', () => {
    expect(rankLabel(TEN)).toBe('10');
    for (const suit of [0, 1, 2, 3]) {
      expect(cardRankLabel(makeCard(TEN, suit))).toBe('10');
      expect(isTen(makeCard(TEN, suit))).toBe(true);
    }
  });

  it('внутренняя нотация осталась однобуквенной', () => {
    expect(RANKS[TEN]).toBe('T');
    expect(parseCard('Ts')).toBe(makeCard(TEN, 3));
    const labels = ALL_CLASSES.map((c) => c.label);
    for (const want of ['TT', 'ATs', 'T9o', 'JTs']) expect(labels).toContain(want);
    expect(labels.some((l) => l.includes('10'))).toBe(false);
  });

  it('лицо карты собрано из угла и крупной масти', () => {
    const src = readFileSync(new URL('../src/ui/PlayingCard.tsx', import.meta.url), 'utf8');
    expect(src).toContain('card-corner');
    expect(src).toContain('card-rank');
    expect(src).toContain('card-pip');
    expect(src).toContain('card-face');
    // Достоинство берётся из подписи для экрана, а не напрямую из движка.
    expect(src).toContain('cardRankLabel');
    expect(src).not.toContain('RANKS[');
  });

  it('движение карты задаётся классом, а не логикой раздачи', () => {
    const src = readFileSync(new URL('../src/ui/PlayingCard.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/motion\?: string/);
    expect(src).not.toMatch(/from '\.\.\/(game|coach|bots)\//);
  });
});

/* ------------------------------------------------------------------ */
/* Анимации ничего не решают в покере                                  */
/* ------------------------------------------------------------------ */

describe('движок и тренер не знают про анимации', () => {
  it('в движке, тренере и ботах нет ни слова про анимацию и звук', () => {
    const files = [
      'game/hand.ts', 'game/betting.ts', 'game/types.ts',
      'coach/index.ts', 'coach/ev.ts', 'bots/decide.ts', 'app/session.ts', 'app/progress.ts',
    ];
    for (const f of files) {
      const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/animation|audio\/|tableTimeline|requestAnimationFrame/i);
    }
  });

  it('состояние раздачи от построения таймлайна не меняется', () => {
    const before = snap();
    const after = snap({ log: [action('bet', 3)], committed: [0, 0, 0, 30, 0, 0] });
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);

    buildPlan(before, after, SEATS);

    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(JSON.stringify(after)).toBe(afterJson);
  });
});

/* ------------------------------------------------------------------ */
/* Уважение к настройке «меньше движения»                              */
/* ------------------------------------------------------------------ */

describe('меньше движения', () => {
  it('в стилях есть правило prefers-reduced-motion для всех анимаций стола', () => {
    const css = readFileSync(new URL('../src/styles/trainer.css', import.meta.url), 'utf8');
    const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    for (const cls of ['card-deal', 'card-muck', 'card-reveal', 'bet-arriving']) {
      expect(block, cls).toContain(cls);
    }
    // Движение выключается, звук — нет: про звук здесь ни слова.
    expect(block).not.toContain('sound');
  });

  it('состояние всё равно меняется: событие остаётся событием', () => {
    // Список подсказок не зависит от настроек движения — от них зависит только
    // то, как это выглядит.
    const cues = buildPlan(snap(), snap({ log: [action('fold', 2)], folded: [2] }), SEATS).cues;
    expect(cues).toHaveLength(1);
    expect(cues[0].sound).toBe('fold');
  });
});

const _street: Street = 'flop';
void _street;
