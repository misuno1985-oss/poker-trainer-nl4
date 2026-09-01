/**
 * Личные утечки игрока — из разбора его 7667 реальных раздач.
 *
 * ВАЖНО: это не правила принятия решений. Тренер сперва считает обычную
 * покерную оценку (ev.ts), и только потом сюда приходит уже готовый вердикт,
 * чтобы добавить примечание. «Одна пара и второй рейз» не означает
 * автоматический фолд, а «фолд на баттоне» не означает автоматическую ошибку.
 *
 * Отсюда следует и ограничение: функции здесь возвращают текст, а не оценку.
 */

import { analyse as analyseHand } from '../bots/strength';
import { preflopPercentile } from '../bots/decide';
import type { Action } from '../game/types';
import type { Candidate, DecisionSnapshot, LeakNote } from './types';

/** Сколько раз соперники проявили агрессию на текущей улице. */
function opponentAggression(snap: DecisionSnapshot): number {
  return snap.history.filter(
    (a: Action) =>
      a.street === snap.street &&
      a.seat !== snap.legal.seat &&
      (a.kind === 'bet' || a.kind === 'raise'),
  ).length;
}

function heroWasAggressor(snap: DecisionSnapshot): boolean {
  return snap.history.some(
    (a) => a.street === snap.street && a.seat === snap.legal.seat && (a.kind === 'bet' || a.kind === 'raise'),
  );
}

function foldedToHero(snap: DecisionSnapshot): boolean {
  const pf = snap.history.filter((a) => a.street === 'preflop' && a.kind !== 'post');
  return pf.length > 0 && pf.every((a) => a.kind === 'fold');
}

export function detectLeaks(snap: DecisionSnapshot, chosen: Candidate, best: Candidate): LeakNote[] {
  const notes: LeakNote[] = [];
  const postflop = snap.board.length >= 3;
  const strength = postflop ? analyseHand(snap.heroCards, snap.board) : null;
  const onePair =
    strength !== null &&
    (strength.category === 1 || strength.overpair || strength.topPair) &&
    !strength.boardPlays;

  // --- 1. Одна пара в большом банке. Самая дорогая утечка по разбору базы.
  if (postflop && onePair) {
    const aggression = opponentAggression(snap);
    const bigPot = snap.pot >= 30 * snap.bigBlind;
    if (aggression >= 2 && heroWasAggressor(snap)) {
      notes.push({
        id: 'one-pair-second-raise',
        title: 'Одна пара против второго повышения',
        text:
          'Ты поставил, соперник повысил, и он повышает снова. По твоей базе это самая ' +
          'дорогая повторяющаяся ситуация: в семи из восьми крупнейших проигрышей у тебя ' +
          'была ровно одна пара. Это не значит «всегда фолд» — смотри, кто именно повышает. ' +
          'Но это точка, где стоит остановиться и подумать отдельно.',
        triggered: chosen.kind === 'call' || chosen.kind === 'raise',
      });
    } else if (aggression >= 1 && bigPot && (chosen.kind === 'call' || chosen.kind === 'raise')) {
      notes.push({
        id: 'one-pair-big-pot',
        title: 'Большой банк с одной парой',
        text:
          `В банке уже ${(snap.pot / snap.bigBlind).toFixed(0)} больших блайндов, а у тебя одна пара. ` +
          'По разбору твоей базы именно такие банки съедали больше всего денег.',
        triggered: true,
      });
    }
  }

  // --- 2. Баттон: слишком редкие открытия.
  if (snap.street === 'preflop' && snap.heroPosition === 'BTN' && foldedToHero(snap)) {
    const pc = preflopPercentile(snap.heroCards);
    if (chosen.kind === 'fold' && pc < 0.42) {
      notes.push({
        id: 'btn-open',
        title: 'Открытие с баттона',
        text:
          'После тебя остаются только два игрока, поэтому на баттоне выгодно играть ' +
          'заметно больше рук, чем с ранней позиции. По базе ты атакуешь отсюда только ' +
          'в 22% случаев — это мало. Проверь, точно ли эта рука хуже того, что стоит открывать.',
        triggered: true,
      });
    }
  }

  // --- 3. Защита большого блайнда.
  if (snap.street === 'preflop' && snap.heroPosition === 'BB' && snap.preflopLevel === 2) {
    const opener = snap.opponents.find((o) => o.isPreflopAggressor);
    if (chosen.kind === 'fold' && opener && (opener.position === 'BTN' || opener.position === 'SB')) {
      notes.push({
        id: 'bb-defence',
        title: 'Защита большого блайнда',
        text:
          `Ты уже поставил ${(snap.bigBlind / 100).toFixed(2)}$, чтобы увидеть флоп, нужно доложить ` +
          `${(snap.legal.toCall / 100).toFixed(2)}$. С поздней позиции соперник открывает много ` +
          'неидеальных рук. По базе ты защищаешь блайнд лишь в 23% случаев — это тайтово.',
        triggered: true,
      });
    }
  }

  // --- 4. Три-бет состоит почти только из премиум-рук.
  if (snap.street === 'preflop' && snap.preflopLevel === 2 && chosen.kind === 'call') {
    const pc = preflopPercentile(snap.heroCards);
    if (pc < 0.09) {
      notes.push({
        id: 'three-bet-value',
        title: 'Колл с сильной рукой вместо повышения',
        text:
          'По базе ты 22 раза уравнивал чужое повышение с рукой из TT+, AQ+ или KQs. ' +
          'Такие руки обычно выгоднее поднимать: так ты и банк строишь, и чаще остаёшься ' +
          'один на один.',
        triggered: true,
      });
    }
  }

  // --- 5. Флоп в позиции: слишком осторожно.
  if (
    snap.street === 'flop' &&
    snap.heroIsPreflopAggressor &&
    snap.heroInPosition &&
    snap.activeCount === 2 &&
    snap.legal.canBet &&
    chosen.kind === 'check'
  ) {
    notes.push({
      id: 'flop-in-position',
      title: 'Флоп в позиции',
      text:
        'Ты поднимал до флопа и ходишь последним, а соперник проверил. По базе именно ' +
        'здесь ты осторожничаешь: c-bet в позиции у тебя 52%, а без позиции 65% — должно ' +
        'быть наоборот.',
      triggered: best.kind === 'bet',
    });
  }

  // --- 6. Мультипот: лишняя агрессия.
  if (postflop && snap.activeCount >= 3 && (chosen.kind === 'bet' || chosen.kind === 'raise')) {
    const weak = strength !== null && strength.percentile < 0.72;
    if (weak) {
      notes.push({
        id: 'multiway-bet',
        title: 'Ставка против нескольких соперников',
        text:
          `В банке ${snap.activeCount} игрока. Одной ставкой нужно заставить выбросить сразу ` +
          'нескольких, а это заметно труднее. Против двух и более ставь ради оплаты, ' +
          'а не чтобы забрать банк.',
        triggered: true,
      });
    }
  }

  // --- 7. Отложенная ставка после чек-чека.
  if (snap.street === 'turn' && snap.heroIsPreflopAggressor && snap.legal.canBet) {
    const flopChecks = snap.history.filter((a) => a.street === 'flop' && a.kind === 'check');
    if (flopChecks.length >= 2 && chosen.kind === 'check') {
      notes.push({
        id: 'delayed-cbet',
        title: 'Отложенная ставка',
        text:
          'На флопе никто не поставил. Соперник уже один раз отказался увеличивать банк, ' +
          'значит по-настоящему сильная рука у него теперь встречается реже. По базе ты ' +
          'используешь это лишь в 11% случаев.',
        triggered: best.kind === 'bet',
      });
    }
  }

  // --- 8. Ставка на ривере ради оплаты.
  if (snap.street === 'river' && snap.legal.canBet && chosen.kind === 'check') {
    const decent = strength !== null && strength.percentile >= 0.6;
    const passive = snap.opponents.some((o) => o.profile.wtsd > 0.4 || o.profile.pfr < 0.06);
    if (decent) {
      notes.push({
        id: 'river-value',
        title: 'Ставка на ривере',
        text: passive
          ? 'У тебя готовая рука, а соперник из тех, кто любит доходить до вскрытия. ' +
            'Вопрос не «а вдруг он меня бьёт», а «какие руки хуже моей он уравняет». ' +
            'По базе ты ставишь первым на ривере только в 30% случаев.'
          : 'У тебя готовая рука и ты ходишь первым. По базе ты ставишь здесь лишь ' +
            'в 30% случаев — это мало, ты недобираешь оплату.',
        triggered: best.kind === 'bet',
      });
    }
  }

  // --- 9. Чек-рейз как приём почти отсутствует.
  if (postflop && snap.legal.canRaise && heroCheckedThisStreet(snap) && chosen.kind === 'call') {
    const strong = strength !== null && strength.percentile >= 0.9;
    if (strong) {
      notes.push({
        id: 'check-raise',
        title: 'Чек-рейз',
        text:
          'Ты проверил, соперник поставил, и у тебя сильная рука. По базе чек-рейз у тебя ' +
          'практически отсутствует — 0.9% случаев. Это значит, что после твоего чека ' +
          'соперник может ставить совершенно безнаказанно.',
        triggered: best.kind === 'raise',
      });
    }
  }

  return notes;
}

function heroCheckedThisStreet(snap: DecisionSnapshot): boolean {
  return snap.history.some(
    (a) => a.street === snap.street && a.seat === snap.legal.seat && a.kind === 'check',
  );
}
