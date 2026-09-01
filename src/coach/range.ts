/**
 * Диапазон соперника, восстановленный из его действий.
 *
 * Это модель, а не факт. Опирается она на измеренные частоты из реальной базы
 * (как часто игрок открывает, 3-бетит, ставит первым, сбрасывает на ставку), но
 * сам переход «частота → набор рук» — допущение. Там, где допущение особенно
 * велико, стоит пометка HEURISTIC.
 *
 * Никаких настоящих карт соперника здесь нет и быть не может: на входе только
 * снимок и профиль.
 */

import { NUM_CARDS, rankOf, suitOf, type Card } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { preflopPercentile, isBluffCandidate } from '../bots/decide';
import type { BotProfile } from '../bots/profiles';
import type { Action, Street } from '../game/types';
import type { DecisionSnapshot, OpponentView } from './types';

export interface Combo {
  cards: [Card, Card];
  weight: number;
}

export type WeightedRange = Combo[];

/** Доля блефа по архетипу. НЕ измерена: карт соперников в базе нет. */
const BLUFF_SHARE: Record<BotProfile['archetype'], number> = {
  'tight-aggressive': 0.32,
  'loose-aggressive': 0.4,
  'tight-passive': 0.08,
  'loose-passive': 0.05,
};

export function bluffShareOf(profile: BotProfile): number {
  return BLUFF_SHARE[profile.archetype];
}

/**
 * Доля блефа в КОНКРЕТНОМ действии, а не вообще у игрока.
 *
 * Ставка на флопе и повышение на ривере — это совершенно разные вещи, даже у
 * одного человека. Чем позже улица и чем агрессивнее действие, тем меньше в
 * нём блефа: на ривере повышают почти всегда с готовой рукой. Именно это и
 * показал разбор базы игрока — крупная повторная агрессия там почти не бывает
 * блефом.
 *
 * HEURISTIC: множители не измерены (карт соперников в выгрузке нет). Это
 * покерная логика, а не статистика, и в окне «Почему?» так и подписано.
 */
export function bluffShareFor(
  profile: BotProfile,
  street: Street,
  kind: 'bet' | 'raise',
): number {
  const base = BLUFF_SHARE[profile.archetype];
  const byStreet = street === 'flop' ? 1 : street === 'turn' ? 0.85 : 0.7;
  const byKind = kind === 'raise' ? (street === 'river' ? 0.3 : 0.45) : 1;
  return base * byStreet * byKind;
}

/** Все комбинации, не заблокированные известными картами. */
function allCombos(dead: Iterable<Card>): WeightedRange {
  const used = new Uint8Array(NUM_CARDS);
  for (const c of dead) if (c >= 0) used[c] = 1;
  const out: WeightedRange = [];
  for (let a = 0; a < NUM_CARDS; a++) {
    if (used[a]) continue;
    for (let b = a + 1; b < NUM_CARDS; b++) {
      if (used[b]) continue;
      out.push({ cards: [a, b], weight: 1 });
    }
  }
  return out;
}

/**
 * Мягкая граница диапазона: рука точно внутри, точно снаружи или на краю.
 * Резкая граница врала бы — живые люди не играют по строгому проценту.
 */
function bandWeight(percentile: number, width: number, softness = 0.06): number {
  if (width <= 0) return 0;
  if (percentile <= width - softness) return 1;
  if (percentile >= width + softness) return 0;
  return (width + softness - percentile) / (2 * softness);
}

/** Действия одного игрока на конкретной улице. */
function actionsOf(history: Action[], seat: number, street: Street): Action[] {
  return history.filter((a) => a.seat === seat && a.street === street && a.kind !== 'post');
}

/* ------------------------------------------------------------------ */
/* Префлоп                                                             */
/* ------------------------------------------------------------------ */

function applyPreflop(range: WeightedRange, snap: DecisionSnapshot, opp: OpponentView) {
  const acts = actionsOf(snap.history, opp.seat, 'preflop');
  const p = opp.profile;
  const blind = opp.position === 'SB' || opp.position === 'BB';

  // Ничего не делал (например, БЛ ещё не отвечал) — диапазон почти любой.
  if (acts.length === 0) return;

  const raisedAtLevel = acts.find((a) => a.kind === 'raise');
  const called = acts.some((a) => a.kind === 'call');

  // Насколько сильно он сузился, определяется его собственными частотами.
  const openWidth = p.openBy[opp.position];
  const valueThreeBet = p.threeBet * (1 - bluffShareOf(p));
  const callWidth = blind ? p.defendCall : p.coldCall;

  for (const combo of range) {
    const pc = preflopPercentile(combo.cards);
    let w = 0;

    if (raisedAtLevel) {
      const level = levelBefore(snap.history, raisedAtLevel);
      if (level <= 1) {
        // Открыл рейзом.
        w = bandWeight(pc, openWidth);
      } else if (level === 2) {
        // Повысил чужое открытие.
        w = bandWeight(pc, valueThreeBet);
        // HEURISTIC: блефовые 3-беты — подходящие одномастные руки.
        if (w < 1 && isBluffCandidate(combo.cards) && pc < 0.5) {
          w = Math.max(w, bluffShareOf(p));
        }
      } else {
        // 4-бет и выше: очень узко.
        w = bandWeight(pc, Math.max(0.02, p.fourBet * 0.08));
      }
    } else if (called) {
      const lastCall = acts.filter((a) => a.kind === 'call').pop()!;
      const level = levelBefore(snap.history, lastCall);
      if (level <= 1) {
        // Лимп: руки, которыми он не открывает, но и не сбрасывает.
        w = bandWeight(pc, openWidth + p.limp) * (pc > openWidth * 0.6 ? 1 : 0.35);
      } else {
        // Колл чужого рейза: то, что ниже его 3-бет-порога, но выше фолда.
        w = bandWeight(pc, valueThreeBet + callWidth);
        if (pc < valueThreeBet * 0.7) w *= 0.25; // с этим он обычно повышает
      }
    } else {
      // Только чек в блайнде — диапазон почти не сузился.
      w = 1;
    }

    combo.weight *= w;
  }
}

/** Сколько ставок было сделано до этого действия на его улице. */
function levelBefore(history: Action[], action: Action): number {
  let level = 1;
  for (const a of history) {
    if (a === action) break;
    if (a.street !== action.street) continue;
    if (a.kind === 'raise' || a.kind === 'bet') level += 1;
  }
  return level;
}

/* ------------------------------------------------------------------ */
/* Постфлоп                                                            */
/* ------------------------------------------------------------------ */

/**
 * Место комбинации по силе внутри диапазона: 0 — слабейшая, 1 — сильнейшая.
 *
 * Считается по НАКОПЛЕННОМУ ВЕСУ, а не по номеру в списке. Разница
 * принципиальная: комбинаций со слабыми руками бывает вчетверо больше, но их
 * веса малы, и ранг по номеру завышал бы долю мусора в диапазоне. Именно на
 * этом модель сначала решала, что станция коллирует рейз в два банка третьей
 * парой.
 */
function strengthRanks(range: WeightedRange, board: Card[]): Map<Combo, number> {
  const scored = range.map((c) => ({
    combo: c,
    value: evaluate([c.cards[0], c.cards[1], ...board]),
  }));
  scored.sort((a, b) => a.value - b.value);
  const total = scored.reduce((s, x) => s + x.combo.weight, 0) || 1;
  const out = new Map<Combo, number>();
  let acc = 0;
  for (const s of scored) {
    // Середина занимаемого рукой интервала — так одинаковые руки не слипаются.
    out.set(s.combo, (acc + s.combo.weight / 2) / total);
    acc += s.combo.weight;
  }
  return out;
}

/** Есть ли у комбинации заметное дро — кандидат на полублеф. */
function hasDraw(cards: [Card, Card], board: Card[]): boolean {
  const all = [...cards, ...board];
  const suits = [0, 0, 0, 0];
  for (const c of all) suits[suitOf(c)]++;
  if (suits.some((n, s) => n === 4 && (suitOf(cards[0]) === s || suitOf(cards[1]) === s))) return true;
  const ranks = new Set(all.map(rankOf));
  for (let lo = 0; lo <= 8; lo++) {
    let have = 0;
    for (let k = 0; k < 5; k++) if (ranks.has(lo + k)) have++;
    if (have === 4) return true;
  }
  return false;
}

function applyStreet(range: WeightedRange, snap: DecisionSnapshot, opp: OpponentView, street: Street) {
  const acts = actionsOf(snap.history, opp.seat, street);
  if (acts.length === 0) return;

  const board = boardFor(snap.board, street);
  if (board.length === 0) return;

  const stats =
    street === 'flop' ? opp.profile.flop : street === 'turn' ? opp.profile.turn : opp.profile.river;
  const bluff = bluffShareOf(opp.profile);

  for (const act of acts) {
    const level = levelBefore(snap.history, act);
    const bluffCandidates: Combo[] = [];
    let lastActBluff = bluff;
    // Ранги пересчитываются перед КАЖДЫМ его действием, по уже суженному
    // диапазону. Иначе второй и третий рейз на одной улице ничего бы не
    // добавляли — а именно они и означают силу.
    const ranks = strengthRanks(range, board);

    for (const combo of range) {
      const r = ranks.get(combo) ?? 0.5;
      let w = 1;

      if (act.kind === 'bet' || act.kind === 'raise') {
        const freq = act.kind === 'raise' ? Math.max(0.04, stats.raiseVsBet) : stats.betFirst;
        const actBluff = bluffShareFor(opp.profile, street, act.kind);
        const valueTop = freq * (1 - actBluff);
        // Ставит верхушкой диапазона...
        w = r >= 1 - valueTop ? 1 : 0;
        // ...и долей блефа, у кого он вообще есть. Вес блефа подбирается ниже
        // так, чтобы его суммарная доля совпала с предполагаемой.
        // HEURISTIC: блеф берётся из дро и совсем слабых рук.
        if (w === 0 && actBluff > 0.02 && (hasDraw(combo.cards, board) || r < 0.2)) {
          w = -1; // пометка «кандидат в блеф», вес проставим потом
        }
        lastActBluff = actBluff;
      } else if (act.kind === 'call') {
        // Продолжает тем, что не сбросил бы.
        const continueTop = 1 - stats.foldVsBet;
        w = r >= 1 - continueTop ? 1 : 0.06;
        if (level > 1 && r > 1 - continueTop * 0.25) w *= 0.75; // с топом он бы повысил
      } else if (act.kind === 'check') {
        // Проверил — значит сильнейшую часть, скорее всего, поставил бы.
        const wouldBet = stats.betFirst * (1 - bluff);
        w = r >= 1 - wouldBet ? 0.35 : 1;
      }

      if (w >= 0) combo.weight *= w;
      else bluffCandidates.push(combo);
    }

    // Нормируем блеф: его суммарный вес должен составлять примерно ту долю
    // диапазона, которую модель предполагает по типу игрока, а не «сколько
    // нашлось подходящих комбинаций».
    if (bluffCandidates.length > 0) {
      const valueWeight = range.reduce((s, c) => s + c.weight, 0);
      const wantBluff = (valueWeight * lastActBluff) / Math.max(0.05, 1 - lastActBluff);
      const candidateWeight = bluffCandidates.reduce((s, c) => s + c.weight, 0) || 1;
      const scale = Math.min(1, wantBluff / candidateWeight);
      for (const c of bluffCandidates) c.weight *= scale;
    }
  }
}

function boardFor(board: Card[], street: Street): Card[] {
  if (street === 'flop') return board.slice(0, 3);
  if (street === 'turn') return board.slice(0, 4);
  if (street === 'river') return board.slice(0, 5);
  return [];
}

/* ------------------------------------------------------------------ */

/**
 * Диапазон конкретного соперника на момент решения героя.
 * Комбинации с ничтожным весом выбрасываются, остальные нормируются.
 */
export function inferRange(snap: DecisionSnapshot, opp: OpponentView): WeightedRange {
  const dead: Card[] = [...snap.heroCards, ...snap.board];
  const range = allCombos(dead);

  applyPreflop(range, snap, opp);
  if (snap.board.length >= 3) applyStreet(range, snap, opp, 'flop');
  if (snap.board.length >= 4) applyStreet(range, snap, opp, 'turn');
  if (snap.board.length >= 5) applyStreet(range, snap, opp, 'river');

  const kept = range.filter((c) => c.weight > 0.01);
  if (kept.length === 0) {
    // Модель сузила всё в ноль — значит она ошиблась. Честнее вернуться к
    // широкому диапазону, чем притворяться, что мы знаем его руку.
    return allCombos(dead);
  }
  return kept;
}

export function rangeSize(range: WeightedRange): number {
  return range.reduce((s, c) => s + c.weight, 0);
}

/**
 * Разделить диапазон на «продолжит» и «сбросит» при ставке размера
 * `betFraction` от банка. Верхняя часть по силе продолжает.
 */
export function splitByContinue(
  range: WeightedRange,
  board: Card[],
  foldFrequency: number,
): { continues: WeightedRange; foldFrequency: number } {
  if (board.length === 0 || foldFrequency <= 0) {
    return { continues: range, foldFrequency: 0 };
  }
  const ranks = strengthRanks(range, board);
  const keep = Math.max(0.02, 1 - foldFrequency);
  const continues = range
    .filter((c) => (ranks.get(c) ?? 0.5) >= 1 - keep)
    .map((c) => ({ ...c }));
  return { continues: continues.length ? continues : range, foldFrequency };
}

/** Названия групп рук в диапазоне — для окна «Почему?». */
export function describeRange(range: WeightedRange, board: Card[]): string[] {
  if (board.length < 3) return describePreflopRange(range);
  const buckets = new Map<string, number>();
  for (const c of range) {
    const v = evaluate([c.cards[0], c.cards[1], ...board]);
    const cat = v >>> 20;
    const name =
      cat >= 6 ? 'фулл-хаус и лучше'
      : cat === 5 ? 'флеши'
      : cat === 4 ? 'стриты'
      : cat === 3 ? 'сеты и трипсы'
      : cat === 2 ? 'две пары'
      : cat === 1 ? 'одна пара'
      : hasDraw(c.cards, board) ? 'дро без готовой руки'
      : 'без пары';
    buckets.set(name, (buckets.get(name) ?? 0) + c.weight);
  }
  const total = rangeSize(range) || 1;
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, w]) => w / total >= 0.03)
    .map(([name, w]) => `${name} — примерно ${Math.round((w / total) * 100)}%`);
}

function describePreflopRange(range: WeightedRange): string[] {
  const total = rangeSize(range) || 1;
  let pairs = 0;
  let broadway = 0;
  let suited = 0;
  let rest = 0;
  for (const c of range) {
    const r0 = rankOf(c.cards[0]);
    const r1 = rankOf(c.cards[1]);
    if (r0 === r1) pairs += c.weight;
    else if (Math.min(r0, r1) >= 8) broadway += c.weight;
    else if (suitOf(c.cards[0]) === suitOf(c.cards[1])) suited += c.weight;
    else rest += c.weight;
  }
  const pct = (v: number) => Math.round((v / total) * 100);
  return [
    `карманные пары — примерно ${pct(pairs)}%`,
    `две старшие карты — примерно ${pct(broadway)}%`,
    `одномастные — примерно ${pct(suited)}%`,
    `остальное — примерно ${pct(rest)}%`,
  ].filter((s) => !s.endsWith('0%'));
}
