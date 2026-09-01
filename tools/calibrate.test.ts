/**
 * Калибровка ботов. Инструмент, а не тест.
 *
 * Пороги в decide.ts заданы в терминах силы руки, а измеренная база задаёт
 * частоты. Здесь пороги подгоняются так, чтобы наблюдаемое поведение бота
 * сошлось с тем, что игрок реально делал за столом.
 *
 * Схема простая: сыграть много раздач, посмотреть расхождение по каждой
 * метрике, сдвинуть соответствующую ручку, повторить. Управление
 * пропорциональное с затуханием — так оно не раскачивается.
 *
 * Запуск:  npx vitest run tools/calibrate.test.ts
 * Результат: src/bots/knobs.ts
 */

import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { PROFILES, type BotProfile } from '../src/bots/profiles';
import { defaultKnobs, type BotKnobs, type StreetKnobs } from '../src/bots/decide';
import { simulate, type Counters } from '../src/bots/sim';

const ITERATIONS = 14;
const HANDS_PER_ITERATION = 26_000;
const FINAL_HANDS = 140_000;
const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Ручка-ширина: больше значение — чаще действие. */
function nudgeWidth(current: number, actual: number, target: number, damp = 0.55): number {
  if (target <= 0) return 0;
  if (actual <= 0) return Math.min(1, current + target * 0.5 + 0.01);
  const factor = Math.pow(target / actual, damp);
  return Math.min(1, Math.max(0.0005, current * factor));
}

/** Ручка-порог: больше значение — РЕЖЕ действие (частота ≈ 1 - cut). */
function nudgeCut(current: number, actual: number, target: number, damp = 0.55): number {
  const freq = 1 - current;
  const next = nudgeWidth(freq, actual, target, damp);
  return Math.min(0.995, Math.max(0.02, 1 - next));
}

/** callLoose: больше значение — нужно больше эквити — чаще фолд. */
function nudgeLoose(current: number, actualFold: number, targetFold: number): number {
  if (actualFold <= 0.001 || targetFold <= 0.001) return current;
  const factor = Math.pow(targetFold / actualFold, 0.25);
  return Math.min(8, Math.max(0.2, current * factor));
}

function tuneStreet(k: StreetKnobs, c: { firstOpp: number; firstBet: number; vsBet: number; fold: number; raise: number }, target: BotProfile['flop']) {
  k.betCut = nudgeCut(k.betCut, ratio(c.firstBet, c.firstOpp), target.betFirst);
  k.callLoose = nudgeLoose(k.callLoose, ratio(c.fold, c.vsBet), target.foldVsBet);
  k.raiseCut = nudgeCut(k.raiseCut, ratio(c.raise, c.vsBet), target.raiseVsBet, 0.45);
}

function tune(p: BotProfile, k: BotKnobs, c: Counters) {
  for (const pos of POSITIONS) {
    const actual = ratio(c.openBy[pos] ?? 0, c.openOppBy[pos] ?? 0);
    // Ширина открытия и есть перцентильная граница, поэтому правим её прямо.
    k.openBy[pos] = nudgeWidth(k.openBy[pos], actual, p.openBy[pos], 0.7);
  }
  k.limpWidth = nudgeWidth(k.limpWidth, ratio(c.limp, c.openOpp), p.limp, 0.7);
  k.threeBetValue = nudgeWidth(k.threeBetValue, ratio(c.threeBet, c.threeBetOpp), p.threeBet, 0.5);
  k.coldCallWidth = nudgeWidth(k.coldCallWidth, ratio(c.coldCall, c.coldOpp), p.coldCall, 0.6);
  k.defendCallWidth = nudgeWidth(k.defendCallWidth, ratio(c.defendCall, c.defendOpp), p.defendCall, 0.6);
  k.defendThreeBetValue = nudgeWidth(
    k.defendThreeBetValue, ratio(c.defendThreeBet, c.defendOpp), p.defendThreeBet, 0.5,
  );
  k.fourBetCut = nudgeWidth(k.fourBetCut, ratio(c.vs3betFourBet, c.vs3betOpp), p.fourBet, 0.5);
  k.call3BetCut = nudgeWidth(k.call3BetCut, ratio(c.vs3betCall, c.vs3betOpp), p.call3Bet, 0.5);
  k.cbetCut = nudgeCut(k.cbetCut, ratio(c.cbet, c.cbetOpp), p.cbet, 0.6);

  // VPIP и PFR измерены на самой большой выборке из всех (все раздачи игрока),
  // поэтому им отдаётся последнее слово: после позиционной подгонки ширины
  // масштабируются так, чтобы сойтись с этими двумя числами. Иначе усадка к
  // архетипу вытягивает JPSA и MASELL вверх, а они как раз тем и ценны, что
  // почти никогда не повышают.
  const simPfr = ratio(c.pfr, c.hands);
  if (simPfr > 0.0005 && p.pfr > 0.0005) {
    const f = Math.pow(p.pfr / simPfr, 0.6);
    for (const pos of POSITIONS) k.openBy[pos] = Math.min(1, Math.max(0.0005, k.openBy[pos] * f));
    k.threeBetValue = Math.min(1, Math.max(0.0005, k.threeBetValue * f));
    k.defendThreeBetValue = Math.min(1, Math.max(0.0005, k.defendThreeBetValue * f));
  }
  const simPassive = ratio(c.vpip, c.hands) - simPfr;
  const realPassive = p.vpip - p.pfr;
  if (simPassive > 0.002 && realPassive > 0.002) {
    const f = Math.pow(realPassive / simPassive, 0.6);
    k.limpWidth = Math.min(1, k.limpWidth * f);
    k.coldCallWidth = Math.min(1, k.coldCallWidth * f);
    k.defendCallWidth = Math.min(1, k.defendCallWidth * f);
  }

  tuneStreet(k.flop, c.flop, p.flop);
  tuneStreet(k.turn, c.turn, p.turn);
  tuneStreet(k.river, c.river, p.river);
}

/** Суммарное расхождение по метрикам, которые мы подгоняем. */
function errorOf(p: BotProfile, c: Counters): number {
  const d = (real: number, sim: number) => Math.abs(real - sim);
  return (
    d(p.vpip, ratio(c.vpip, c.hands)) * 2 +
    d(p.pfr, ratio(c.pfr, c.hands)) * 2 +
    d(p.limp, ratio(c.limp, c.openOpp)) +
    d(p.threeBet, ratio(c.threeBet, c.threeBetOpp)) +
    d(p.coldCall, ratio(c.coldCall, c.coldOpp)) +
    d(p.defendCall, ratio(c.defendCall, c.defendOpp)) +
    d(p.cbet, ratio(c.cbet, c.cbetOpp)) +
    d(p.flop.betFirst, ratio(c.flop.firstBet, c.flop.firstOpp)) +
    d(p.flop.foldVsBet, ratio(c.flop.fold, c.flop.vsBet)) +
    d(p.turn.betFirst, ratio(c.turn.firstBet, c.turn.firstOpp)) +
    d(p.turn.foldVsBet, ratio(c.turn.fold, c.turn.vsBet)) +
    d(p.river.betFirst, ratio(c.river.firstBet, c.river.firstOpp)) +
    d(p.river.foldVsBet, ratio(c.river.fold, c.river.vsBet))
  );
}

const clone = (k: BotKnobs): BotKnobs => JSON.parse(JSON.stringify(k)) as BotKnobs;

it('калибрует двадцать профилей', () => {
  const knobs = new Map<string, BotKnobs>();
  for (const p of PROFILES) knobs.set(p.name, defaultKnobs(p));

  // Регулятор фолдов слегка колеблется вокруг цели, поэтому берём не
  // последнюю итерацию, а ту, где расхождение оказалось наименьшим.
  const best = new Map<string, { err: number; k: BotKnobs }>();

  for (let i = 0; i < ITERATIONS; i++) {
    const result = simulate({
      profiles: PROFILES,
      knobs,
      hands: HANDS_PER_ITERATION,
      seed: 1000 + i * 31,
    });
    let worst = 0;
    for (const p of PROFILES) {
      const c = result.get(p.name)!;
      const err = errorOf(p, c);
      worst = Math.max(worst, err);
      const prev = best.get(p.name);
      if (i >= 2 && (!prev || err < prev.err)) best.set(p.name, { err, k: clone(knobs.get(p.name)!) });
      tune(p, knobs.get(p.name)!, c);
    }
    process.stdout.write(`  итерация ${i + 1}/${ITERATIONS}  худшее расхождение ${(worst * 100).toFixed(1)}\n`);
  }
  for (const p of PROFILES) {
    const b = best.get(p.name);
    if (b) knobs.set(p.name, b.k);
  }

  const final = simulate({ profiles: PROFILES, knobs, hands: FINAL_HANDS, seed: 424242 });

  const rows = PROFILES.map((p) => {
    const c = final.get(p.name)!;
    const k = knobs.get(p.name)!;
    return { p, c, k };
  });

  const ts = `/**
 * Откалиброванные пороги для ботов. Собрано tools/calibrate.test.ts —
 * руками не править.
 *
 * Значения подобраны так, чтобы поведение бота в симуляции совпало с тем, что
 * игрок реально делал в базе. Проверено прогоном ${FINAL_HANDS.toLocaleString('ru-RU')} раздач.
 */

import type { BotKnobs } from './decide';

export const KNOBS: Record<string, BotKnobs> = {
${rows
  .map(({ p, k }) => {
    const st = (s: StreetKnobs) =>
      `{ betCut: ${s.betCut.toFixed(4)}, drawBluff: ${s.drawBluff.toFixed(4)}, ` +
      `airBluff: ${s.airBluff.toFixed(4)}, callLoose: ${s.callLoose.toFixed(4)}, ` +
      `raiseCut: ${s.raiseCut.toFixed(4)}, raiseBluff: ${s.raiseBluff.toFixed(4)} }`;
    return `  '${p.name}': {
    openBy: { ${POSITIONS.map((x) => `${x}: ${k.openBy[x].toFixed(4)}`).join(', ')} },
    cbetCut: ${k.cbetCut.toFixed(4)},
    limpWidth: ${k.limpWidth.toFixed(4)},
    threeBetValue: ${k.threeBetValue.toFixed(4)}, threeBetBluff: ${k.threeBetBluff.toFixed(4)},
    coldCallWidth: ${k.coldCallWidth.toFixed(4)},
    defendCallWidth: ${k.defendCallWidth.toFixed(4)}, defendThreeBetValue: ${k.defendThreeBetValue.toFixed(4)},
    call3BetCut: ${k.call3BetCut.toFixed(4)}, fourBetCut: ${k.fourBetCut.toFixed(4)},
    flop: ${st(k.flop)},
    turn: ${st(k.turn)},
    river: ${st(k.river)},
  },`;
  })
  .join('\n')}
};
`;
  writeFileSync(new URL('../src/bots/knobs.ts', import.meta.url), ts);

  // --- таблица real -> sim ---
  const pct = (v: number) => (v * 100).toFixed(1);
  const line = (name: string, real: number, sim: number, n: number) => {
    const flag = Math.abs(real - sim) > 0.03 ? '  <-- расхождение' : '';
    return `    ${name.padEnd(22)} real ${pct(real).padStart(5)}  sim ${pct(sim).padStart(5)}   n(real)=${n}${flag}`;
  };

  const report: string[] = [];
  for (const { p, c } of rows) {
    report.push(`\n  ${p.name}   [${p.archetype}]   раздач в симуляции: ${c.hands}`);
    report.push(line('VPIP', p.vpip, ratio(c.vpip, c.hands), p.hands));
    report.push(line('PFR', p.pfr, ratio(c.pfr, c.hands), p.hands));
    report.push(line('открытие', avgOpen(p), ratio(c.open, c.openOpp), p.samples.open));
    report.push(line('лимп', p.limp, ratio(c.limp, c.openOpp), p.samples.open));
    report.push(line('3-бет', p.threeBet, ratio(c.threeBet, c.threeBetOpp), p.samples.threeBet));
    report.push(line('колл чужого опена', p.coldCall, ratio(c.coldCall, c.coldOpp), p.samples.threeBet));
    report.push(line('c-bet флоп', p.cbet, ratio(c.cbet, c.cbetOpp), p.samples.cbet));
    report.push(line('флоп ставка первым', p.flop.betFirst, ratio(c.flop.firstBet, c.flop.firstOpp), p.samples.flops));
    report.push(line('флоп фолд на ставку', p.flop.foldVsBet, ratio(c.flop.fold, c.flop.vsBet), p.samples.flopVsBet));
    report.push(line('тёрн ставка первым', p.turn.betFirst, ratio(c.turn.firstBet, c.turn.firstOpp), p.samples.flops));
    report.push(line('тёрн фолд на ставку', p.turn.foldVsBet, ratio(c.turn.fold, c.turn.vsBet), p.samples.turnVsBet));
    report.push(line('ривер ставка первым', p.river.betFirst, ratio(c.river.firstBet, c.river.firstOpp), p.samples.flops));
    report.push(line('ривер фолд на ставку', p.river.foldVsBet, ratio(c.river.fold, c.river.vsBet), p.samples.riverVsBet));
    report.push(line('дошёл до вскрытия', p.wtsd, ratio(c.wtsd, c.flops), p.samples.flops));
  }
  console.log(report.join('\n'));
}, 900_000);

function avgOpen(p: BotProfile): number {
  const v = POSITIONS.map((x) => p.openBy[x]);
  return v.reduce((a, b) => a + b, 0) / v.length;
}
