/**
 * Полная диагностика контрольной раздачи 01 из PDF — KQ, война рейзов.
 *
 * Печатает внутренний расчёт непосредственно перед последним решением: банк,
 * цену продолжения, диапазон соперника после первого и после второго рейза,
 * его ценностную и блефовую части, долю героя и ожидаемый результат каждого
 * варианта.
 *
 * Запуск: npx vitest run tools/kq-diagnostic.test.ts
 */

import { it, expect } from 'vitest';
import { act, createHand } from '../src/game/hand';
import { legalActions, type ActionRequest } from '../src/game/betting';
import { makeRng } from '../src/game/rng';
import { FULL_DECK, RANKS, SUIT_SYMBOLS, rankOf, suitOf, type Card } from '../src/engine/cards';
import { PROFILE_BY_NAME } from '../src/bots/profiles';
import type { Session } from '../src/app/session';
import type { HandState } from '../src/game/types';
import { captureSnapshot } from '../src/coach/snapshot';
import { inferRange, describeRange, rangeSize, bluffShareFor } from '../src/coach/range';
import { equityVsRanges } from '../src/coach/equity';
import { analyse } from '../src/coach/ev';
import { evaluateDecision } from '../src/coach/index';
import { actionLabel } from '../src/coach/explain';
import { boardAt, boardChange } from '../src/coach/texture';
import fixture from '../tests/real-decisions.json';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const show = (c: Card) => RANKS[rankOf(c)] + SUIT_SYMBOLS[suitOf(c)];
const showAll = (cs: readonly Card[]) => cs.map(show).join(' ');

interface RealHand {
  gid: number; title: string; limit: string; bb: number; sb: number;
  button: number; heroSeat: number;
  players: Array<{ name: string; stack: number }>;
  heroCards: number[]; board: number[];
  actions: Array<{ seat: number; street: number; kind: string; total: number; add: number }>;
}

function session(state: HandState, heroSeat: number): Session {
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

it('раздача KQ: полный внутренний расчёт', () => {
  const h = (fixture as unknown as RealHand[]).find((x) => x.gid === 139380373)!;
  expect(h, 'контрольная раздача KQ должна быть в фикстуре').toBeTruthy();

  const state = createHand({
    seats: h.players.map((p) => ({ name: p.name, stack: p.stack })),
    button: h.button, smallBlind: h.sb, bigBlind: h.bb, seed: h.gid,
    deck: deckFor(h.players.length, h.button, h.heroSeat, h.heroCards, h.board),
  });

  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║ КОНТРОЛЬНАЯ РАЗДАЧА 01 · KQ · война рейзов на флопе                      ║
╚══════════════════════════════════════════════════════════════════════════╝

  ${h.limit} · ${h.players.length} игрока
  Hero: ${showAll(h.heroCards)}   Полный борд: ${showAll(h.board)}
  За столом: ${h.players.map((p, i) => (i === h.heroSeat ? `[${p.name}]` : p.name)).join(', ')}
`);

  // Прогоняем до каждого решения героя и печатаем расчёт перед последним.
  const heroDecisions: Array<{ index: number; action: ActionRequest }> = [];
  h.actions.forEach((a, i) => {
    if (a.seat === h.heroSeat) {
      heroDecisions.push({
        index: i,
        action: (a.kind === 'raise' || a.kind === 'bet'
          ? { kind: a.kind, total: a.total }
          : { kind: a.kind as 'fold' | 'check' | 'call' }) as ActionRequest,
      });
    }
  });
  const lastHeroIndex = heroDecisions[heroDecisions.length - 1].index;

  for (let i = 0; i < h.actions.length; i++) {
    const a = h.actions[i];
    if (state.finished) break;
    const legal = legalActions(state);
    if (!legal || legal.seat !== a.seat) break;

    if (i === lastHeroIndex) {
      const snap = captureSnapshot(session(state, h.heroSeat), h.heroSeat)!;
      const opp = snap.opponents[0];
      const board = snap.board.slice(0, snap.street === 'flop' ? 3 : snap.street === 'turn' ? 4 : 5);

      console.log('  ── СИТУАЦИЯ ПЕРЕД ПОСЛЕДНИМ РЕШЕНИЕМ ─────────────────────────────');
      console.log(`     улица .................. ${snap.street}`);
      console.log(`     борд ................... ${showAll(board)}`);
      console.log(`     банк ................... ${money(snap.pot)}`);
      console.log(`     доложить ............... ${money(snap.legal.toCall)}`);
      console.log(`     шансы банка ............ ${pct(snap.legal.toCall / (snap.pot + snap.legal.toCall))}`);
      console.log(`     стек героя ............. ${money(snap.heroStack)}`);
      console.log(`     эффективный стек ....... ${money(snap.effectiveStack)}`);
      console.log(`     соперник ............... ${opp.name} (${opp.profile.archetype}, ${opp.profile.hands} раздач)`);

      const change = boardChange(boardAt(snap.board, 'flop').slice(0, 0), board);
      console.log(`     текстура доски ......... ${change.text}`);

      // История его агрессии на этой улице.
      const hisActs = snap.history.filter(
        (x) => x.seat === opp.seat && x.street === snap.street && x.kind !== 'post',
      );
      console.log(`\n     Его действия на улице: ${hisActs.map((x) => `${x.kind} ${money(x.total)}`).join(' → ')}`);

      // Диапазон после ПЕРВОГО его повышения: строим отдельный снимок,
      // отрезав историю после первого рейза.
      const firstRaise = hisActs.findIndex((x) => x.kind === 'raise' || x.kind === 'bet');
      if (firstRaise >= 0 && hisActs.length > 1) {
        const cutIndex = snap.history.indexOf(hisActs[firstRaise]);
        const partial = { ...snap, history: snap.history.slice(0, cutIndex + 1) };
        const r1 = inferRange(partial, opp);
        console.log(`\n     ДИАПАЗОН ПОСЛЕ ПЕРВОГО ЕГО ПОВЫШЕНИЯ`);
        console.log(`       комбинаций ${r1.length}, суммарный вес ${rangeSize(r1).toFixed(1)}`);
        console.log(`       состав: ${describeRange(r1, board).join('; ')}`);
        console.log(`       доля героя против него: ${pct(equityVsRanges(snap.heroCards, board, [r1], 1))}`);
      }

      const r2 = inferRange(snap, opp);
      const bluffBet = bluffShareFor(opp.profile, snap.street as 'flop' | 'turn' | 'river', 'bet');
      const bluffRaise = bluffShareFor(opp.profile, snap.street as 'flop' | 'turn' | 'river', 'raise');
      console.log(`\n     ДИАПАЗОН ПОСЛЕ ВСЕХ ЕГО ПОВЫШЕНИЙ`);
      console.log(`       комбинаций ${r2.length}, суммарный вес ${rangeSize(r2).toFixed(1)}`);
      console.log(`       состав: ${describeRange(r2, board).join('; ')}`);
      console.log(`       предполагаемая доля блефа: в ставке ${pct(bluffBet)}, в повышении ${pct(bluffRaise)}`);
      console.log(`       (это ВЫВОД МОДЕЛИ по типу игрока, не измерение)`);

      const eq = equityVsRanges(snap.heroCards, board, [r2], 1);
      console.log(`\n     ДОЛЯ ГЕРОЯ против этого диапазона: ${pct(eq)}`);

      const analysis = analyse(snap);
      console.log(`\n     ОЖИДАЕМЫЙ РЕЗУЛЬТАТ ВАРИАНТОВ`);
      for (const c of analysis.candidates.slice(0, 6)) {
        const d = c.detail;
        const extra =
          d.foldEquity !== undefined
            ? `  [сбросит ${pct(d.foldEquity)} · уравняет ${pct(d.callChance ?? 0)} · повысит ${pct(d.reraiseChance ?? 0)}` +
              ` · доля против колла ${pct(d.equityVsContinue ?? 0)} · против рейза ${pct(d.equityVsReraise ?? 0)}]`
            : d.potOdds !== undefined
              ? `  [нужно ${pct(d.potOdds)}, есть ${pct(d.equity)}]`
              : '';
        console.log(`       ${actionLabel(c).padEnd(18)} ${money(Math.round(c.ev)).padStart(7)}${extra}`);
      }

      const verdict = evaluateDecision(snap, heroDecisions[heroDecisions.length - 1].action as never);
      console.log(`\n     ВЕРДИКТ по фактическому ходу (${actionLabel(verdict.chosen)})`);
      console.log(`       оценка ${verdict.score}/10  (выбор ${verdict.actionScore}` +
        (verdict.sizingScore !== null ? `, размер ${verdict.sizingScore}` : '') + ')');
      console.log(`       уверенность: два лучших — ${verdict.confidence.decision}; ` +
        `данные о сопернике — ${verdict.confidence.data} (${verdict.confidence.sample} наблюдений)`);
      console.log(`       картина: ${verdict.brief.picture}`);
      if (verdict.brief.good) console.log(`       + ${verdict.brief.good}`);
      if (verdict.brief.bad) console.log(`       − ${verdict.brief.bad}`);
      if (verdict.brief.better) console.log(`       → ${verdict.brief.better}`);
      for (const n of verdict.leakNotes) console.log(`       ⚑ ${n.title}`);
      console.log('');
    }

    const req: ActionRequest =
      a.kind === 'raise' || a.kind === 'bet'
        ? { kind: a.kind, total: a.total }
        : { kind: a.kind as 'fold' | 'check' | 'call' };
    act(state, req);
  }
}, 120_000);
