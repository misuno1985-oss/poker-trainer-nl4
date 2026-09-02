/**
 * Не тест, а инструмент: играет сессию и кладёт настоящий файл выгрузки на
 * диск, чтобы его можно было открыть и прочитать глазами.
 *
 *   npx vitest run tools/make-export.test.ts
 */

import { writeFileSync } from 'node:fs';
import { it } from 'vitest';

import {
  HERO_SEAT, dealNext, handSetupOf, heroAct, isBotTurn, isHeroTurn, newSession, stepBot,
} from '../src/app/session';
import { legalActions, type ActionRequest } from '../src/game/betting';
import { captureSnapshot, evaluateDecision } from '../src/coach/index';
import { categorise } from '../src/coach/categories';
import { mainVillain } from '../src/app/trainer';
import { PROFILES } from '../src/bots/profiles';
import { buildExport, exportFileName, type LoggedHand, type SessionLog } from '../src/app/sessionLog';

const OUT = process.env.EXPORT_OUT ?? '/tmp/nl4-session.json';
const HANDS = Number(process.env.EXPORT_HANDS ?? 10);

it('делает настоящий файл выгрузки', () => {
  const session = newSession({
    heroName: 'withorwithout', stackMode: 'standard', smallBlind: 2, bigBlind: 4, seed: 20260902,
  });
  session.handNumber = 0;

  const hands: LoggedHand[] = [];
  const startedAt = Date.now();

  for (let i = 0; i < HANDS; i++) {
    dealNext(session);
    const s = session.state;
    const hand: LoggedHand = {
      handNumber: session.handNumber,
      setup: handSetupOf(session),
      seats: s.players.map((p) => ({
        seat: p.seat, name: p.name, isHero: p.seat === HERO_SEAT, position: p.position,
        startingStackCents: p.startingStack, endingStackCents: p.startingStack,
      })),
      heroSeat: HERO_SEAT,
      heroCards: [...s.players[HERO_SEAT].cards] as [number, number],
      board: [], log: [], decisions: [], result: null,
      heroNetCents: 0, potCents: 0, showdown: false, actualHoleCards: [],
      startedAt: Date.now(), endedAt: 0,
      autoAdvanced: i > 0, pausedAfter: false, isReplay: false, replayCount: 0,
    };

    let guard = 0;
    while (!session.state.finished && guard++ < 200) {
      if (isHeroTurn(session)) {
        const legal = legalActions(session.state)!;
        const roll = (session.handNumber * 5 + session.state.log.length * 3) % 10;
        let req: ActionRequest;
        if (roll < 2) req = { kind: 'fold' };
        else if (roll < 7) req = legal.canCheck ? { kind: 'check' } : { kind: 'call' };
        else if (legal.canBet) req = { kind: 'bet', total: Math.min(legal.minBetTotal * 2, legal.allInTotal) };
        else if (legal.canRaise) req = { kind: 'raise', total: Math.min(legal.minRaiseTotal, legal.allInTotal) };
        else req = legal.canCheck ? { kind: 'check' } : { kind: 'call' };

        const snap = captureSnapshot(session);
        if (snap) {
          hand.decisions.push({
            index: hand.decisions.length,
            street: session.state.street,
            snapshot: snap,
            chosen: { kind: req.kind, totalCents: req.total },
            verdict: evaluateDecision(snap, { kind: req.kind as 'bet', total: req.total }),
            categories: categorise(snap, req.kind as 'bet'),
            villain: mainVillain(session),
            atMs: Date.now() - startedAt,
          });
        }
        heroAct(session, req);
      } else if (isBotTurn(session)) {
        stepBot(session);
      } else break;
    }

    const shown = session.state.result ? session.state.result.showdownSeats : [];
    hand.board = session.state.board.slice();
    hand.log = session.state.log.slice();
    hand.result = session.state.result;
    hand.heroNetCents = session.state.result ? (session.state.result.net[HERO_SEAT] ?? 0) : 0;
    hand.potCents = session.state.players.reduce((a, p) => a + p.handCommit, 0);
    hand.showdown = shown.length > 1;
    hand.endedAt = Date.now();
    hand.seats = hand.seats.map((seat) => ({ ...seat, endingStackCents: session.state.players[seat.seat].stack }));
    hand.actualHoleCards = session.state.players
      .filter((p) => p.cards[0] >= 0)
      .map((p) => ({
        seat: p.seat, name: p.name, cards: [...p.cards],
        revealedToHero: p.seat === HERO_SEAT || shown.includes(p.seat),
      }));
    hands.push(hand);
  }

  const log: SessionLog = {
    id: 'demo', mode: 'session', modeDetail: null, targetHands: HANDS,
    startedAt, endedAt: Date.now(), smallBlindCents: 2, bigBlindCents: 4,
    heroName: 'withorwithout', hands,
  };

  const scores = hands.flatMap((h) => h.decisions.map((d) => d.verdict.score));
  const summary = {
    decisionScore: Number((scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)).toFixed(2)),
    netCents: hands.reduce((a, h) => a + h.heroNetCents, 0),
    good: scores.filter((s) => s >= 7.5).length,
    borderline: scores.filter((s) => s < 7.5 && s >= 5).length,
    mistakes: scores.filter((s) => s < 5).length,
    major: scores.filter((s) => s < 4).length,
    insights: [{ text: 'демонстрационная сессия', tone: 'neutral' }],
    focus: null, focusReason: '', categories: [], majorMistakes: [],
  };

  const text = JSON.stringify(buildExport(log, summary, PROFILES, Date.now()), null, 2);
  writeFileSync(OUT, text);
  console.log(`${exportFileName(log, Date.now())} → ${OUT}, ${Math.round(text.length / 1024)} КБ`);
}, 120000);
