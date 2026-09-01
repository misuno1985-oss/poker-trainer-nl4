import { it, expect } from 'vitest';
import { PROFILES, PROFILE_BY_NAME } from '../src/bots/profiles';
import { defaultKnobs } from '../src/bots/decide';
import { simulate } from '../src/bots/sim';

it('прогоняет 2000 раздач и не падает', () => {
  const knobs = new Map(PROFILES.map((p) => [p.name, defaultKnobs(p)]));
  const seats = [
    PROFILE_BY_NAME['PokerMind'], PROFILE_BY_NAME['MASELL'], PROFILE_BY_NAME['griffie'],
    PROFILE_BY_NAME['RiverShark'], PROFILE_BY_NAME['Lucky9090'], PROFILE_BY_NAME['DuhaMetelkin'],
  ];
  const c = simulate({ seats, knobs, hands: 2000, seed: 42, watchSeat: 0 });
  console.log(`
  PokerMind за 2000 раздач:
    VPIP ${(100*c.vpip/c.hands).toFixed(1)}%  (реально 25.4)
    PFR  ${(100*c.pfr/c.hands).toFixed(1)}%  (реально 21.7)
    open ${(100*c.open/c.openOpp).toFixed(1)}% из ${c.openOpp}  (реально 27.4)
    3bet ${(100*c.threeBet/c.threeBetOpp).toFixed(1)}% из ${c.threeBetOpp}  (реально 12.4)
    флопов ${c.flops}, до вскрытия ${c.wtsd}
    флоп ставка первым ${(100*c.street.flop.firstBet/Math.max(1,c.street.flop.firstOpp)).toFixed(1)}% из ${c.street.flop.firstOpp}
    флоп фолд на ставку ${(100*c.street.flop.fold/Math.max(1,c.street.flop.vsBet)).toFixed(1)}% из ${c.street.flop.vsBet}
    c-bet ${(100*c.cbet/Math.max(1,c.cbetOpp)).toFixed(1)}% из ${c.cbetOpp}`);
  expect(c.hands).toBe(2000);
}, 120000);
