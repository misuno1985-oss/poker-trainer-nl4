import { describe, expect, it } from 'vitest';
import { PROFILES, PROFILE_BY_NAME } from '../src/bots/profiles';
import { ALL_KNOBS } from '../src/bots/index';
import { simulate } from '../src/bots/sim';
import { preflopPercentile, isBluffCandidate } from '../src/bots/decide';
import { analyse, findDraws, handPercentile } from '../src/bots/strength';
import { cards } from './helpers';

describe('оценка руки', () => {
  it('ранжирует стартовые руки как положено', () => {
    const p = (t: string) => preflopPercentile(cards(t));
    expect(p('AcAd')).toBeLessThan(p('KcKd'));
    expect(p('KcKd')).toBeLessThan(p('AcKc'));
    expect(p('AcKc')).toBeLessThan(p('AcKd')); // одномастная сильнее разномастной
    expect(p('7c6c')).toBeLessThan(p('7c2d'));
    expect(p('3c2d')).toBeGreaterThan(0.97);
  });

  it('узнаёт кандидатов в блеф-3-бет', () => {
    expect(isBluffCandidate(cards('Ac3c'))).toBe(true);
    expect(isBluffCandidate(cards('9h8h'))).toBe(true);
    expect(isBluffCandidate(cards('Ac3d'))).toBe(false); // разномастные не годятся
    expect(isBluffCandidate(cards('AcKc'))).toBe(false); // это ценность, не блеф
  });

  it('считает долю рук, которые мы бьём, а не приблизительную категорию', () => {
    const nuts = handPercentile(cards('AcAd'), cards('AsAh7c'));
    expect(nuts).toBeGreaterThan(0.999);
    const air = handPercentile(cards('7c2d'), cards('AsKhQd'));
    expect(air).toBeLessThan(0.2);
    const mid = handPercentile(cards('KcQd'), cards('Ks7h2c'));
    expect(mid).toBeGreaterThan(0.8);
    expect(mid).toBeLessThan(0.98);
  });

  it('видит дро', () => {
    const fd = findDraws(cards('AcTc'), cards('7c2c9h'));
    expect(fd.flushDraw).toBe(true);
    expect(fd.outs).toBeGreaterThanOrEqual(9);
    const oesd = findDraws(cards('9h8d'), cards('7c6s2h'));
    expect(oesd.openEnded).toBe(true);
    const nothing = findDraws(cards('Ac2d'), cards('7h9sKc'));
    expect(nothing.outs).toBe(0);
  });

  it('отличает топ-пару от оверпары и от пары на борде', () => {
    expect(analyse(cards('AcKd'), cards('Ks7h2c')).topPair).toBe(true);
    expect(analyse(cards('AcAd'), cards('Ks7h2c')).overpair).toBe(true);
    expect(analyse(cards('2c3d'), cards('KsKh7c9d4s')).boardPlays).toBe(true);
  });
});

describe('калибровка ботов держится', () => {
  // Один прогон на все профили: каждый бот получает примерно 12 000 раздач.
  const result = simulate({
    profiles: PROFILES,
    knobs: ALL_KNOBS,
    hands: 40_000,
    seed: 555,
  });

  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

  it('даёт каждому профилю достаточную выборку', () => {
    for (const p of PROFILES) {
      expect(result.get(p.name)!.hands, p.name).toBeGreaterThan(9_000);
    }
  });

  it.each(PROFILES.map((p) => [p.name] as const))(
    '%s играет столько же рук, сколько в реальной базе',
    (name) => {
      const p = PROFILE_BY_NAME[name];
      const c = result.get(name)!;
      expect(ratio(c.vpip, c.hands), 'VPIP').toBeCloseTo(p.vpip, 1);
      expect(ratio(c.pfr, c.hands), 'PFR').toBeCloseTo(p.pfr, 1);
    },
  );

  it('сохраняет разницу между похожими по VPIP игроками', () => {
    const r = (n: string) => result.get(n)!;
    // PokerMind и RiverShark почти одинаковы по VPIP/PFR, но RiverShark
    // заметно чаще 3-бетит, а PokerMind заметно липучее на флопе.
    const pm = r('PokerMind');
    const rs = r('RiverShark');
    expect(ratio(rs.threeBet, rs.threeBetOpp)).toBeGreaterThan(ratio(pm.threeBet, pm.threeBetOpp));
    expect(ratio(pm.flop.fold, pm.flop.vsBet)).toBeLessThan(ratio(rs.flop.fold, rs.flop.vsBet));

    // MASELL и JPSA оба сверхпассивны, но JPSA почти не ставит на флопе.
    const ma = r('MASELL');
    const jp = r('JPSA');
    expect(ratio(jp.flop.firstBet, jp.flop.firstOpp)).toBeLessThan(
      ratio(ma.flop.firstBet, ma.flop.firstOpp),
    );

    // griffie и DuhaMetelkin оба аккуратны, но griffie гораздо чаще
    // берёт инициативу на ривере.
    const gr = r('griffie');
    const du = r('DuhaMetelkin');
    expect(ratio(gr.river.firstBet, gr.river.firstOpp)).toBeGreaterThan(
      ratio(du.river.firstBet, du.river.firstOpp),
    );
  });

  it('пассивные боты почти не повышают до флопа', () => {
    for (const name of ['JPSA', 'Lucky9090', 'MASELL', 'YnnzX']) {
      const c = result.get(name)!;
      expect(ratio(c.pfr, c.hands), name).toBeLessThan(0.08);
    }
  });

  it('агрессивные боты действительно давят', () => {
    for (const name of ['PokerMind', 'RiverShark', 'KaplKapl']) {
      const c = result.get(name)!;
      expect(ratio(c.threeBet, c.threeBetOpp), name).toBeGreaterThan(0.08);
    }
  });
}, 180_000);
