/**
 * Текст тренера. Простой русский, термин — сразу с пояснением в скобках.
 *
 * Два уровня. Короткий (`brief`) — что хорошо, что плохо, что лучше. Длинный
 * (`why`) раскрывается по кнопке и обязан разделять три вещи:
 *
 *   data  — измеренный факт из базы (с размером выборки);
 *   model — вывод модели из этого факта;
 *   math  — расчёт по числам этой раздачи.
 *
 * Правило из docs/coach-rules.md: нельзя писать «PokerMind блефует в 32%»,
 * потому что этого никто не измерял. Можно писать «он часто ставит без
 * готовой руки — так предполагает модель по его типу».
 */

import { RELIABLE_SAMPLE } from '../bots/profiles';
import { describeRange, bluffShareOf } from './range';
import type { Analysis } from './ev';
import type { Brief, Candidate, Confidence, DecisionSnapshot, WhySection } from './types';
import type { Scores } from './score';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function actionLabel(c: Candidate): string {
  switch (c.kind) {
    case 'fold': return 'FOLD';
    case 'check': return 'CHECK';
    case 'call': return 'CALL';
    case 'bet': return `BET ${money(c.total ?? 0)}`;
    case 'raise': return `RAISE TO ${money(c.total ?? 0)}`;
  }
}

/* ------------------------------------------------------------------ */
/* Короткий разбор                                                     */
/* ------------------------------------------------------------------ */

export function buildBrief(
  snap: DecisionSnapshot,
  chosen: Candidate,
  best: Candidate,
  scores: Scores,
): Brief {
  const sameKind = chosen.kind === best.kind;
  const close = scores.certainty === 'close';

  let good: string | null = null;
  let bad: string | null = null;
  let better: string | null = null;

  if (close) {
    const alt = actionLabel(best);
    good = `Решение близкое: ${actionLabel(chosen)} и ${alt} здесь примерно равны.`;
    if (!sameKind) {
      better = `Я чуть больше за ${alt}, но разница небольшая.`;
    }
    return { good, bad, better };
  }

  if (sameKind && scores.sizingScore !== null && scores.sizingScore < 7) {
    // Тип действия верный, подвёл размер.
    const want = scores.bestOfSameKind?.total ?? 0;
    const got = chosen.total ?? 0;
    good = 'Сама идея правильная — рука годится для ставки.';
    bad =
      got > want
        ? `Размер слишком большой. Ты рискуешь ${money(got - snap.legal.streetCommit)} там, ` +
          `где хватило бы примерно ${money(want - snap.legal.streetCommit)}: слабые руки всё ` +
          'равно выбросят, а платить будут только те, что тебя бьют.'
        : `Размер маловат. При ${money(got - snap.legal.streetCommit)} соперник заходит слишком ` +
          `дёшево — примерно ${money(want - snap.legal.streetCommit)} собрало бы больше.`;
    better = actionLabel(scores.bestOfSameKind ?? best);
    return { good, bad, better };
  }

  if (sameKind) {
    good = `${actionLabel(chosen)} — здесь это лучший вариант.`;
    return { good, bad, better };
  }

  bad = explainWhyWorse(snap, chosen, best);
  better = actionLabel(best);
  if (scores.actionScore >= 6) {
    good = 'Вариант рабочий, но есть заметно лучше.';
  }
  return { good, bad, better };
}

function explainWhyWorse(snap: DecisionSnapshot, chosen: Candidate, best: Candidate): string {
  const eq = chosen.detail.equity;

  if (chosen.kind === 'fold') {
    const odds = snap.legal.toCall / (snap.pot + snap.legal.toCall);
    if (eq >= odds) {
      return (
        `Ты сбросил, хотя доложить нужно ${money(snap.legal.toCall)} в банк ${money(snap.pot)}. ` +
        `Чтобы это окупалось, достаточно выигрывать ${pct(odds)} случаев, а по модели у тебя ` +
        `около ${pct(eq)}.`
      );
    }
    if (best.kind === 'bet' || best.kind === 'raise') {
      const fe = best.detail.foldEquity ?? 0;
      return (
        `Уравнивать здесь действительно нечем — по модели у тебя всего около ${pct(eq)}, ` +
        `а нужно ${pct(odds)}. Но у этого соперника ставка часто без готовой руки: он бросает ` +
        `примерно в ${pct(fe)} случаев, поэтому повышение здесь работает лучше, чем просто уйти.`
      );
    }
    return `Здесь выгоднее ${actionLabel(best)}.`;
  }

  if (chosen.kind === 'check' && (best.kind === 'bet' || best.kind === 'raise')) {
    return (
      'Ты проверил, хотя рука достаточно хороша, чтобы ставить. Соперник платит ' +
      'достаточно часто, и эта ставка приносит деньги.'
    );
  }

  if (chosen.kind === 'call' && best.kind === 'fold') {
    const odds = snap.legal.toCall / (snap.pot + snap.legal.toCall);
    return (
      `Чтобы колл окупался, надо выигрывать примерно ${pct(odds)} случаев. По модели его ` +
      `диапазона у тебя около ${pct(eq)} — этого не хватает.`
    );
  }

  if (chosen.kind === 'call' && (best.kind === 'bet' || best.kind === 'raise')) {
    return (
      'Колл оставляет банк маленьким и отдаёт инициативу. С такой рукой выгоднее ' +
      'самому увеличивать банк.'
    );
  }

  if ((chosen.kind === 'bet' || chosen.kind === 'raise') && best.kind === 'fold') {
    return 'Повышать здесь нечем: сильных рук, которые сбросят, у него мало, а слабых, которые заплатят, — почти нет.';
  }

  if ((chosen.kind === 'bet' || chosen.kind === 'raise') && best.kind === 'check') {
    const fe = chosen.detail.foldEquity ?? 0;
    return (
      `Ставка здесь работает плохо: этот соперник сбрасывает лишь около ${pct(fe)} случаев, ` +
      'а те, кто остаётся, чаще тебя бьют.'
    );
  }

  if ((chosen.kind === 'bet' || chosen.kind === 'raise') && best.kind === 'call') {
    return 'Повышение раздувает банк там, где твоей руке комфортнее в маленьком. Колл держит банк под контролем.';
  }

  return `Здесь выгоднее ${actionLabel(best)}.`;
}

/* ------------------------------------------------------------------ */
/* Развёрнутое объяснение                                              */
/* ------------------------------------------------------------------ */

export function buildWhy(
  snap: DecisionSnapshot,
  analysis: Analysis,
  chosen: Candidate,
  scores: Scores,
  confidence: Confidence,
): WhySection[] {
  const out: WhySection[] = [];

  // --- расчёт
  const mathLines: string[] = [
    `Банк ${money(snap.pot)}, твой стек ${money(snap.heroStack)}.`,
    `Твоя доля против его возможных рук — примерно ${pct(analysis.rawEquity)}.`,
  ];
  if (snap.legal.toCall > 0) {
    const odds = snap.legal.toCall / (snap.pot + snap.legal.toCall);
    mathLines.push(
      `Доложить ${money(snap.legal.toCall)} — значит выигрывать хотя бы ${pct(odds)} случаев, ` +
        'чтобы колл не терял деньги.',
    );
  }
  if (chosen.detail.foldEquity !== undefined) {
    mathLines.push(
      `По его статистике на такую ставку он сбросит примерно ${pct(chosen.detail.foldEquity)} раз.`,
    );
  }
  if (chosen.detail.equityVsContinue !== undefined) {
    mathLines.push(
      `Если он всё-таки заплатит, твоя доля падает примерно до ${pct(chosen.detail.equityVsContinue)} — ` +
        'платят обычно руки посильнее.',
    );
  }
  out.push({ title: 'Числа этой раздачи', kind: 'math', lines: mathLines });

  // --- соперники: строго разделяем факт и вывод
  for (const opp of snap.opponents) {
    const p = opp.profile;
    const stats =
      snap.street === 'flop' ? p.flop : snap.street === 'turn' ? p.turn : p.river;
    const sample =
      snap.street === 'flop' ? p.samples.flopVsBet
      : snap.street === 'turn' ? p.samples.turnVsBet
      : snap.street === 'river' ? p.samples.riverVsBet
      : p.samples.open;

    const dataLines: string[] = [
      `Играет примерно ${pct(p.vpip)} рук, повышает до флопа в ${pct(p.pfr)}. Выборка — ${p.hands} раздач.`,
    ];
    if (snap.street !== 'preflop' && sample >= 20) {
      dataLines.push(
        `На этой улице выбрасывал на ставку примерно в ${pct(stats.foldVsBet)} случаев ` +
          `(${sample} наблюдений).`,
      );
    } else if (snap.street !== 'preflop') {
      dataLines.push(
        `Про его игру на этой улице данных мало — всего ${sample} наблюдений. ` +
          'Точный процент называть нельзя.',
      );
    }
    out.push({ title: `${opp.name}: что известно из базы`, kind: 'data', lines: dataLines });

    const modelLines: string[] = [];
    const bluff = bluffShareOf(p);
    modelLines.push(
      bluff <= 0.1
        ? 'Модель предполагает, что блефов у него в диапазоне почти нет — это вывод из его ' +
          'пассивности, а не измерение: карт соперников в выгрузке нет.'
        : 'Модель предполагает, что часть его ставок — без готовой руки. Это вывод из его ' +
          'общей агрессии, а не измерение: карт соперников в выгрузке нет.',
    );
    const range = analysis.ranges.find((r) => r.seat === opp.seat);
    if (range) {
      const parts = describeRange(range.range, snap.board);
      if (parts.length) {
        modelLines.push('Примерно так выглядит его диапазон здесь: ' + parts.join('; ') + '.');
      }
    }
    out.push({ title: `${opp.name}: что из этого следует`, kind: 'model', lines: modelLines });
  }

  // --- альтернативы
  const altLines = analysis.candidates.slice(0, 4).map((c) => {
    const mark = c === chosen ? ' ← твой выбор' : '';
    return `${actionLabel(c)} — ожидаемый результат примерно ${money(Math.round(c.ev))}${mark}`;
  });
  altLines.push(
    'Числа приблизительные: это не солвер, а оценка по доле, цене колла и статистике соперника.',
  );
  out.push({ title: 'Что дают разные варианты', kind: 'math', lines: altLines });

  // --- уверенность
  const confLines: string[] = [];
  confLines.push(
    scores.certainty === 'close'
      ? 'Варианты почти равны — это тот случай, когда правильного ответа по сути нет.'
      : scores.certainty === 'unclear'
        ? 'Разница между вариантами небольшая.'
        : 'Разница между вариантами заметная.',
  );
  confLines.push(
    confidence.data === 'good'
      ? `Данных об этом сопернике достаточно (${confidence.sample} наблюдений в нужной ситуации).`
      : confidence.data === 'thin'
        ? `Данных об этом сопернике немного — ${confidence.sample} наблюдений. Вывод опирается ` +
          'больше на его тип игры, чем на точные проценты.'
        : 'Данных об этом сопернике в такой ситуации почти нет, поэтому вывод опирается на его тип игры.',
  );
  out.push({ title: 'Насколько этому можно верить', kind: 'model', lines: confLines });

  return out;
}

export { RELIABLE_SAMPLE };
