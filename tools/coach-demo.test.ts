/**
 * Витрина тренера, а не тест. Печатает три вещи:
 *
 *   1. одну и ту же руку против разных соперников;
 *   2. близкие решения, где правильного ответа по сути нет;
 *   3. реальные решения из базы игрока — те самые, что разобраны в PDF.
 *
 * Запуск: npx vitest run tools/coach-demo.test.ts
 */

import { it } from 'vitest';
import { act, createHand } from '../src/game/hand';
import { legalActions, type ActionRequest } from '../src/game/betting';
import { makeRng } from '../src/game/rng';
import { FULL_DECK, RANKS, SUIT_SYMBOLS, rankOf, suitOf, type Card } from '../src/engine/cards';
import type { HandState } from '../src/game/types';
import { PROFILE_BY_NAME } from '../src/bots/profiles';
import type { Session } from '../src/app/session';
import { captureSnapshot, evaluateDecision, actionLabel } from '../src/coach/index';
import type { CoachVerdict } from '../src/coach/types';
import fixture from '../tests/real-decisions.json';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const show = (c: Card) => (c < 0 ? '??' : RANKS[rankOf(c)] + SUIT_SYMBOLS[suitOf(c)]);
const showAll = (cs: Card[]) => cs.map(show).join(' ');

function session(state: HandState, heroSeat: number): Session {
  return {
    config: {
      heroName: state.players[heroSeat].name,
      stackMode: 'standard',
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      seed: 1,
    },
    handNumber: 1,
    button: state.button,
    state,
    seatProfiles: state.players.map((p, i) =>
      i === heroSeat ? null : (PROFILE_BY_NAME[p.name] ?? PROFILE_BY_NAME['DuhaMetelkin']),
    ),
    stacks: state.players.map((p) => p.startingStack),
    bankroll: 0,
    rng: makeRng(1),
    awaitingNext: false,
  };
}

/** Колода, раздающая заданные карты герою и на борд, остальным — что осталось. */
function deckFor(count: number, button: number, heroSeat: number, hero: Card[], board: Card[]): Card[] {
  const sb = count === 2 ? button : (button + 1) % count;
  const deck: Card[] = new Array(52).fill(-1);
  const used = new Set<Card>();
  const put = (i: number, c: Card) => {
    deck[i] = c;
    used.add(c);
  };
  const offset = (heroSeat - sb + count) % count;
  put(offset, hero[0]);
  put(count + offset, hero[1]);
  board.forEach((c, i) => put(2 * count + i, c));
  const spare = FULL_DECK.filter((c) => !used.has(c));
  let s = 0;
  for (let i = 0; i < deck.length; i++) if (deck[i] < 0) deck[i] = spare[s++];
  return deck;
}

function printVerdict(v: CoachVerdict, indent = '    ') {
  const conf =
    v.confidence.decision === 'close' ? 'решение близкое'
    : v.confidence.decision === 'unclear' ? 'разница небольшая'
    : 'разница заметная';
  const data =
    v.confidence.data === 'good' ? `данных достаточно (${v.confidence.sample})`
    : v.confidence.data === 'thin' ? `данных немного (${v.confidence.sample})`
    : 'данных почти нет';

  console.log(`${indent}ОЦЕНКА ${v.score}/10  ` +
    (v.sizingScore !== null ? `[выбор ${v.actionScore} · размер ${v.sizingScore}]  ` : '') +
    `— ${conf}, ${data}`);
  if (v.brief.good) console.log(`${indent}  + ${v.brief.good}`);
  if (v.brief.bad) console.log(`${indent}  − ${v.brief.bad}`);
  if (v.brief.better) console.log(`${indent}  → лучше: ${v.brief.better}`);
  const top = v.ranked.slice(0, 3).map((c) => `${actionLabel(c)} ${money(Math.round(c.ev))}`);
  console.log(`${indent}  варианты: ${top.join('  |  ')}`);
  for (const n of v.leakNotes) {
    console.log(`${indent}  ⚑ ${n.title}${n.triggered ? '' : ' (не сработала)'}`);
  }
}

/* ================================================================== */

it('одна и та же рука против разных соперников', () => {
  const villains = ['MASELL', 'JPSA', 'Lucky9090', 'PokerMind', 'RiverShark', 'griffie'];
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║ 1. ОДНА И ТА ЖЕ РУКА, РАЗНЫЕ СОПЕРНИКИ                                   ║
╚══════════════════════════════════════════════════════════════════════════╝

  NL4 6-max. Hero BTN, $4.00, A♥K♦.
  Все сбросили, Hero открыл до $0.10, большой блайнд уравнял.
  Флоп A♣ 7♥ 2♠ — топ-пара с тузом. BB чек, Hero ставит $0.14, BB коллирует.
  Тёрн 9♦ — чек, чек.
  Ривер 3♣ — BB СТАВИТ $0.34 в банк $0.48.

  Меняется только один человек: кто именно поставил.
  Карты соперника тренеру недоступны — он видит лишь его статистику.
`);

  for (const villain of villains) {
    const hero: Card[] = [50, 45]; // A♥ K♦
    const board: Card[] = [48, 22, 3, 29, 4]; // A♣ 7♥ 2♠ 9♦ 3♣
    const state = createHand({
      seats: [
        { name: 'withorwithout', stack: 400 },
        { name: 'Solevarnya', stack: 400 },
        { name: villain, stack: 400 },
        { name: 'Matthew0', stack: 400 },
        { name: 'statham1', stack: 400 },
        { name: 'Pavelvdn', stack: 400 },
      ],
      button: 0,
      smallBlind: 2,
      bigBlind: 4,
      seed: 1,
      deck: deckFor(6, 0, 0, hero, board),
    });
    // UTG, HJ, CO сбрасывают; Hero (BTN) открывает; SB сбрасывает; BB коллирует.
    const script: ActionRequest[] = [
      { kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' },
      { kind: 'raise', total: 10 }, { kind: 'fold' }, { kind: 'call' },
      { kind: 'check' }, { kind: 'bet', total: 14 }, { kind: 'call' },
      { kind: 'check' }, { kind: 'check' },
      { kind: 'bet', total: 34 },
    ];
    for (const a of script) act(state, a);

    const snap = captureSnapshot(session(state, 0))!;
    const v = evaluateDecision(snap, { kind: 'call' });
    const p = PROFILE_BY_NAME[villain];
    console.log(`  ── Ставит ${villain} (${p.archetype}, ${p.hands} раздач в базе)`);
    console.log(`     Hero: ${showAll(hero)}   Борд: ${showAll(board)}   Банк ${money(snap.pot)}, доложить ${money(snap.legal.toCall)}`);
    console.log('     Если Hero КОЛЛИРУЕТ:');
    printVerdict(v, '     ');
    console.log('');
  }
}, 120_000);

/* ================================================================== */

it('близкие решения', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║ 2. БЛИЗКИЕ РЕШЕНИЯ                                                       ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

  const spots: Array<{ name: string; hero: Card[]; board: Card[]; villain: string; script: ActionRequest[]; test: ActionRequest[] }> = [
    {
      name: 'Вторая пара против ставки на тёрне от осторожного игрока',
      hero: [37, 26], // K♦ 8♣ -> подберём ниже
      board: [44, 25, 10, 33],
      villain: 'DuhaMetelkin',
      script: [
        { kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' },
        { kind: 'raise', total: 10 }, { kind: 'fold' }, { kind: 'call' },
        { kind: 'check' }, { kind: 'bet', total: 12 }, { kind: 'call' },
        { kind: 'bet', total: 20 },
      ],
      test: [{ kind: 'call' }, { kind: 'fold' }],
    },
    {
      name: 'Средняя рука на ривере против ставки половиной банка',
      hero: [40, 27],
      board: [12, 31, 5, 46, 18],
      villain: 'Solevarnya',
      script: [
        { kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' },
        { kind: 'raise', total: 10 }, { kind: 'fold' }, { kind: 'call' },
        { kind: 'check' }, { kind: 'check' },
        { kind: 'check' }, { kind: 'check' },
        { kind: 'bet', total: 11 },
      ],
      test: [{ kind: 'call' }, { kind: 'fold' }],
    },
  ];

  for (const spot of spots) {
    const state = createHand({
      seats: [
        { name: 'withorwithout', stack: 400 },
        { name: 'Kokop2', stack: 400 },
        { name: spot.villain, stack: 400 },
        { name: 'Matthew0', stack: 400 },
        { name: 'statham1', stack: 400 },
        { name: 'Pavelvdn', stack: 400 },
      ],
      button: 0, smallBlind: 2, bigBlind: 4, seed: 3,
      deck: deckFor(6, 0, 0, spot.hero, spot.board),
    });
    for (const a of spot.script) act(state, a);
    const snap = captureSnapshot(session(state, 0))!;

    console.log(`  ── ${spot.name}`);
    console.log(`     Hero: ${showAll(spot.hero)}   Борд: ${showAll(state.board)}   Банк ${money(snap.pot)}, доложить ${money(snap.legal.toCall)}`);
    for (const action of spot.test) {
      const v = evaluateDecision(snap, action as { kind: 'call' | 'fold' });
      console.log(`     ${action.kind.toUpperCase()}:`);
      printVerdict(v, '       ');
    }
    console.log('');
  }
}, 120_000);

/* ================================================================== */

interface RealHand {
  gid: number; title: string; limit: string; bb: number; sb: number;
  button: number; heroSeat: number;
  players: Array<{ name: string; stack: number }>;
  heroCards: number[]; board: number[];
  actions: Array<{ seat: number; street: number; kind: string; total: number; add: number }>;
}

it('реальные решения из базы', () => {
  const hands = fixture as unknown as RealHand[];
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║ 3. РЕАЛЬНЫЕ РЕШЕНИЯ ИЗ БАЗЫ (те самые, что разобраны в PDF)              ║
╚══════════════════════════════════════════════════════════════════════════╝

  Карты соперников в выгрузке отсутствуют, поэтому в движке им розданы
  произвольные карты. Тренеру это безразлично: он их не видит по построению.
`);

  let evaluated = 0;
  for (const h of hands) {
    const state = createHand({
      seats: h.players.map((p) => ({ name: p.name, stack: p.stack })),
      button: h.button,
      smallBlind: h.sb,
      bigBlind: h.bb,
      seed: h.gid,
      deck: deckFor(h.players.length, h.button, h.heroSeat, h.heroCards, h.board),
    });

    console.log(`\n  ${'─'.repeat(70)}`);
    console.log(`  ${h.title}`);
    console.log(`  ${h.limit} · ${h.players.length} игроков · Hero ${showAll(h.heroCards)} · борд ${showAll(h.board)}`);
    console.log(`  За столом: ${h.players.map((p, i) => (i === h.heroSeat ? `[${p.name}]` : p.name)).join(', ')}`);

    let ok = true;
    for (const a of h.actions) {
      if (state.finished) break;
      const legal = legalActions(state);
      if (!legal || legal.seat !== a.seat) {
        console.log(`     (последовательность разошлась на ${a.kind} места ${a.seat} — дальше не идём)`);
        ok = false;
        break;
      }

      if (a.seat === h.heroSeat) {
        const snap = captureSnapshot(session(state, h.heroSeat), h.heroSeat);
        if (snap) {
          const streetName = ['префлоп', 'флоп', 'тёрн', 'ривер'][a.street];
          const req: ActionRequest =
            a.kind === 'raise' || a.kind === 'bet'
              ? { kind: a.kind, total: a.total }
              : { kind: a.kind as 'fold' | 'check' | 'call' };
          const v = evaluateDecision(snap, req as { kind: 'fold' | 'check' | 'call' | 'bet' | 'raise'; total?: number });
          const label =
            a.kind === 'raise' || a.kind === 'bet'
              ? `${a.kind.toUpperCase()} ${money(a.total)}`
              : a.kind.toUpperCase();
          console.log(`\n     [${streetName}] банк ${money(snap.pot)} · Hero сыграл ${label}`);
          printVerdict(v, '     ');
          evaluated++;
        }
      }

      const req: ActionRequest =
        a.kind === 'raise' || a.kind === 'bet'
          ? { kind: a.kind, total: a.total }
          : { kind: a.kind as 'fold' | 'check' | 'call' };
      try {
        act(state, req);
      } catch (e) {
        console.log(`     (движок отклонил ${a.kind}: ${(e as Error).message})`);
        ok = false;
        break;
      }
    }
    void ok;
  }
  console.log(`\n  Всего оценено решений: ${evaluated}\n`);
}, 300_000);
