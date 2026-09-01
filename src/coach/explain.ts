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
  const picture = describePicture(snap, scores);

  // «Близко» относится к ВЫБРАННОМУ ходу, а не к паре лучших вариантов.
  // Иначе получалось бы «CALL 10 / FOLD 5 — разница небольшая», где текст и
  // баллы говорят разное.
  if (scores.chosenCertainty === 'close') {
    const good = sameKind
      ? `${actionLabel(chosen)} — здесь это лучший вариант.`
      : `${actionLabel(chosen)} и ${actionLabel(best)} здесь примерно равны.`;
    const better = sameKind ? null : `Я чуть больше за ${actionLabel(best)}, но разница небольшая.`;
    return { good, bad: null, better, picture };
  }

  if (sameKind && scores.sizingScore !== null && scores.sizingScore < 7) {
    // Тип действия верный, подвёл размер.
    const want = scores.bestOfSameKind?.total ?? 0;
    const got = chosen.total ?? 0;
    const bad =
      got > want
        ? `Размер слишком большой. Ты рискуешь ${money(got - snap.legal.streetCommit)} там, ` +
          `где хватило бы примерно ${money(want - snap.legal.streetCommit)}: слабые руки всё ` +
          'равно выбросят, а платить будут только те, что тебя бьют.'
        : `Размер маловат. При ${money(got - snap.legal.streetCommit)} соперник заходит слишком ` +
          `дёшево — примерно ${money(want - snap.legal.streetCommit)} собрало бы больше.`;
    return {
      good: 'Сама идея правильная — рука годится для такой линии.',
      bad,
      better: actionLabel(scores.bestOfSameKind ?? best),
      picture,
    };
  }

  if (sameKind) {
    return { good: `${actionLabel(chosen)} — здесь это лучший вариант.`, bad: null, better: null, picture };
  }

  return {
    good: scores.chosenCertainty === 'unclear' ? 'Вариант рабочий, но есть лучше.' : null,
    bad: explainWhyWorse(snap, chosen, best),
    better: actionLabel(best),
    picture,
  };
}

/**
 * Картина целиком: что близко, что заметно хуже. Строится ровно из тех же
 * чисел, что и баллы, поэтому спорить с ними не может.
 */
function describePicture(snap: DecisionSnapshot, scores: Scores): string {
  const norm = Math.max(snap.pot, 4 * snap.bigBlind);
  const list = scores.byKind;
  if (list.length === 0) return '';
  const top = list[0];

  const near = list.filter((c) => (top.ev - c.ev) / norm < 0.05);
  const far = list.filter((c) => (top.ev - c.ev) / norm >= 0.05);

  const names = (cs: Candidate[]) => cs.map(actionLabel).join(' и ');

  if (near.length >= 2 && far.length > 0) {
    return `${names(near)} — примерно равны; ${names(far)} заметно хуже.`;
  }
  if (near.length >= 2) {
    return `${names(near)} — примерно равны.`;
  }
  if (far.length > 0) {
    return `${actionLabel(top)} заметно лучше остального.`;
  }
  return `${actionLabel(top)} — единственный разумный вариант.`;
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
  rolledOut = false,
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
    if (snap.street !== 'river') {
      const r = snap.heroInPosition ? 0.95 : 0.86;
      mathLines.push(
        `Раздача на этом не заканчивается, поэтому свою долю ты реализуешь не полностью: ` +
          `${snap.heroInPosition ? 'в позиции' : 'без позиции'} примерно ${pct(r)} от неё. ` +
          'Из-за этого сравнение с шансами банка чуть строже, чем «доля больше процента — значит колл».',
      );
    }
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

    const dataLines: string[] = p.hands === 0
      ? [
          'Этого игрока в базе почти нет — статистики по нему не существует. ' +
            'Вместо неё берётся усреднённый профиль по всем измеренным соперникам, ' +
            'поэтому любые числа ниже относятся к «среднему игроку», а не к нему лично.',
        ]
      : [
          `Играет примерно ${pct(p.vpip)} рук, повышает до флопа в ${pct(p.pfr)}. ` +
            `Выборка — ${p.hands} раздач.`,
        ];
    if (p.hands === 0) {
      // Нечего добавлять: конкретных наблюдений за ним нет.
    } else if (snap.street !== 'preflop' && sample >= 20) {
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
    rolledOut
      ? `Решение непростое, поэтому я дополнительно доиграл раздачу ${chosen.detail.rollout?.sims ?? 0} раз ` +
        'с разными возможными картами соперника и разными тёрнами и риверами. Числа выше — ' +
        'средний итог таких доигрываний, они приблизительные.'
      : 'Числа приблизительные: это не солвер, а оценка по доле, цене колла и статистике соперника.',
  );
  out.push({ title: 'Что дают разные варианты', kind: 'math', lines: altLines });

  // --- уверенность
  const confLines: string[] = [];
  confLines.push(scores.certainty === 'close'
    ? 'Два лучших варианта почти равны — правильного ответа здесь по сути нет.'
    : scores.certainty === 'unclear'
      ? 'Два лучших варианта различаются немного.'
      : 'Лучший вариант заметно опережает остальные.');
  confLines.push(
    scores.chosenCertainty === 'close'
      ? 'Твой ход — среди этих лучших.'
      : scores.chosenCertainty === 'unclear'
        ? 'Твой ход немного отстаёт от лучшего.'
        : 'Твой ход заметно отстаёт от лучшего.',
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
