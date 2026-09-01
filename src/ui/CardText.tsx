import { RANKS, SUIT_SYMBOLS, rankOf, suitOf, type Card } from '../engine/cards';

/**
 * Карты текстом: «J♠ 3♥».
 *
 * Масть красится и получает VS15 (U+FE0E) — без него часть систем подставляет
 * эмодзи-вариант ♥, и червы выезжают из строки чужим шрифтом и чужим цветом.
 */

const RED = new Set([1, 2]); // d, h

export function CardText({ cards }: { cards: readonly Card[] }) {
  return (
    <>
      {cards.map((c, i) => (
        <span key={i} className="card-text">
          {RANKS[rankOf(c)]}
          <span className={RED.has(suitOf(c)) ? 'suit suit-red' : 'suit'}>
            {SUIT_SYMBOLS[suitOf(c)]}
            {'︎'}
          </span>
        </span>
      ))}
    </>
  );
}
