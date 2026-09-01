/**
 * Дымовой прогон: две тысячи раздач подряд не должны ронять движок.
 * Заодно печатает частоты одного профиля рядом с измеренными — это не проверка
 * калибровки (для неё есть calibrate), а быстрый способ увидеть, что модель
 * вообще жива.
 */

import { it, expect } from 'vitest';
import { PROFILES } from '../src/bots/profiles';
import { defaultKnobs } from '../src/bots/decide';
import { simulate } from '../src/bots/sim';

const WATCH = 'PokerMind';

it('прогоняет 2000 раздач и не падает', () => {
  const knobs = new Map(PROFILES.map((p) => [p.name, defaultKnobs(p)]));
  const counters = simulate({ profiles: PROFILES, knobs, hands: 2000, seed: 42 });

  expect(counters.size).toBe(PROFILES.length);
  for (const [, c] of counters) expect(c.hands).toBeGreaterThan(0);

  const c = counters.get(WATCH)!;
  const real = PROFILES.find((p) => p.name === WATCH)!;
  const pct = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(1)}%`;
  console.log(`
  ${WATCH} за ${c.hands} раздач:
    VPIP ${pct(c.vpip, c.hands)}  (реально ${(100 * real.vpip).toFixed(1)}%)
    PFR  ${pct(c.pfr, c.hands)}  (реально ${(100 * real.pfr).toFixed(1)}%)
    open ${pct(c.open, c.openOpp)} из ${c.openOpp}
    3bet ${pct(c.threeBet, c.threeBetOpp)} из ${c.threeBetOpp}
    флопов ${c.flops}, до вскрытия ${c.wtsd}
    флоп ставка первым ${pct(c.flop.firstBet, c.flop.firstOpp)} из ${c.flop.firstOpp}
    флоп фолд на ставку ${pct(c.flop.fold, c.flop.vsBet)} из ${c.flop.vsBet}
    c-bet ${pct(c.cbet, c.cbetOpp)} из ${c.cbetOpp}`);
}, 120000);
