import { describe, expect, it } from 'vitest';
import { legalActions, type ActionRequest } from '../src/game/betting';
import {
  HERO_SEAT, dealNext, heroAct, isBotTurn, isHeroTurn, newSession, seatViews, stepBot,
} from '../src/app/session';
import { sampleStack } from '../src/game/stacks';
import { makeRng, randInt } from '../src/game/rng';
import { totalPot } from '../src/game/types';

function randomHeroAction(session: ReturnType<typeof newSession>, rng: () => number): ActionRequest {
  const l = legalActions(session.state)!;
  const options: ActionRequest[] = [{ kind: 'fold' }];
  if (l.canCheck) options.push({ kind: 'check' });
  if (l.canCall) options.push({ kind: 'call' });
  if (l.canBet) options.push({ kind: 'bet', total: l.minBetTotal });
  if (l.canRaise) options.push({ kind: 'raise', total: l.minRaiseTotal });
  return options[randInt(rng, options.length)];
}

describe('сессия за столом', () => {
  it('играет 300 раздач подряд без сбоев', () => {
    const session = newSession({
      heroName: 'withorwithout',
      stackMode: 'realistic',
      smallBlind: 2,
      bigBlind: 4,
      seed: 777,
    });
    const rng = makeRng(31337);

    let handsPlayed = 0;
    let bankrollCheck = 0;

    for (let h = 0; h < 300; h++) {
      let guard = 0;
      while (!session.state.finished) {
        if (++guard > 300) throw new Error('раздача не заканчивается');
        if (isHeroTurn(session)) heroAct(session, randomHeroAction(session, rng));
        else if (isBotTurn(session)) stepBot(session);
        else break;
      }

      expect(session.state.finished).toBe(true);
      // Фишки не появляются и не исчезают.
      const start = session.state.players.reduce((s, p) => s + p.startingStack, 0);
      const end = session.state.players.reduce((s, p) => s + p.stack, 0);
      expect(end, `раздача ${h}`).toBe(start);

      bankrollCheck += session.state.result!.net[HERO_SEAT] ?? 0;
      handsPlayed++;
      dealNext(session);
    }

    expect(handsPlayed).toBe(300);
    expect(session.bankroll).toBe(bankrollCheck);
  }, 120_000);

  it('проводит героя через все шесть позиций', () => {
    const session = newSession({
      heroName: 'withorwithout',
      stackMode: 'standard',
      smallBlind: 2,
      bigBlind: 4,
      seed: 5,
    });
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      seen.add(session.state.players[HERO_SEAT].position);
      while (!session.state.finished) {
        if (isHeroTurn(session)) heroAct(session, { kind: 'fold' });
        else stepBot(session);
      }
      dealNext(session);
    }
    expect([...seen].sort()).toEqual(['BB', 'BTN', 'CO', 'HJ', 'SB', 'UTG']);
  });

  it('сажает за стол пять разных реальных соперников', () => {
    const session = newSession({
      heroName: 'withorwithout',
      stackMode: 'standard',
      smallBlind: 2,
      bigBlind: 4,
      seed: 9,
    });
    const views = seatViews(session);
    expect(views).toHaveLength(6);
    expect(views[0].isHero).toBe(true);
    const names = views.slice(1).map((v) => v.name);
    expect(new Set(names).size).toBe(5);
    for (const v of views.slice(1)) expect(v.profile).not.toBeNull();
  });

  it('закрепляет выбранного соперника за столом', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const session = newSession({
        heroName: 'withorwithout',
        stackMode: 'standard',
        smallBlind: 2,
        bigBlind: 4,
        seed,
        pinned: 'MASELL',
      });
      const names = seatViews(session).map((v) => v.name);
      expect(names, `seed ${seed}`).toContain('MASELL');
    }
  });

  it('начинает раздачу с блайндов и банка в 1.5bb', () => {
    const session = newSession({
      heroName: 'withorwithout',
      stackMode: 'standard',
      smallBlind: 2,
      bigBlind: 4,
      seed: 3,
    });
    expect(totalPot(session.state)).toBe(6);
  });
});

describe('стеки', () => {
  it('в стандартном режиме у всех ровно 100bb', () => {
    const rng = makeRng(1);
    for (let i = 0; i < 50; i++) expect(sampleStack('standard', rng, 4)).toBe(400);
  });

  it('в реалистичном режиме повторяет форму реальных столов', () => {
    const rng = makeRng(2);
    const bb = 4;
    const sample = Array.from({ length: 20_000 }, () => sampleStack('realistic', rng, bb) / bb);
    sample.sort((a, b) => a - b);
    const q = (p: number) => sample[Math.floor(sample.length * p)];

    // Ориентиры из базы: медиана 114bb, десятый перцентиль 54, девяностый 239.
    expect(q(0.5)).toBeGreaterThan(105);
    expect(q(0.5)).toBeLessThan(125);
    expect(q(0.1)).toBeGreaterThan(40);
    expect(q(0.1)).toBeLessThan(70);
    expect(q(0.9)).toBeGreaterThan(200);
    // Хвост обрезан: слишком глубокие столы — это уже не обычный NL4.
    expect(sample[sample.length - 1]).toBeLessThanOrEqual(250);
    expect(sample[0]).toBeGreaterThanOrEqual(20);
  });
});
