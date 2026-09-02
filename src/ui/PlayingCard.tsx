import { SUIT_SYMBOLS, suitOf, type Card } from '../engine/cards';
import { cardRankLabel, isTen } from './rankLabel';

export type CardSize = 'sm' | 'md' | 'lg';

interface Props {
  card: Card;
  size?: CardSize;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  /** Класс анимации: раздача, раскрытие, уход в мак. */
  motion?: string;
  /** Задержка анимации в миллисекундах — для последовательной раздачи. */
  delayMs?: number;
}

/**
 * Игральная карта.
 *
 * Лицо собрано по присланному образцу: белое поле, тонкая серая рамка,
 * достоинство в левом верхнем углу и под ним маленькая масть, а в середине —
 * одна крупная масть. Никаких рисунков и вензелей: карта должна читаться
 * мгновенно и с маленького размера.
 */
export function PlayingCard({ card, size = 'md', onClick, title, disabled, motion, delayMs }: Props) {
  const empty = card < 0;
  const suit = empty ? 0 : suitOf(card);
  const red = suit === 1 || suit === 2;
  const className = [
    'card',
    `card-${size}`,
    empty ? 'card-empty' : red ? 'card-red' : 'card-black',
    // «10» вдвое шире остальных подписей, и ей нужен свой размер.
    !empty && isTen(card) ? 'card-ten' : '',
    onClick ? 'card-clickable' : '',
    motion ?? '',
  ].filter(Boolean).join(' ');

  const style = delayMs ? { animationDelay: `${delayMs}ms` } : undefined;

  const content = empty ? (
    <span className="card-plus">+</span>
  ) : (
    <>
      <span className="card-corner">
        <span className="card-rank">{cardRankLabel(card)}</span>
        <span className="card-pip">{SUIT_SYMBOLS[suit]}</span>
      </span>
      <span className="card-face">{SUIT_SYMBOLS[suit]}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} style={style} onClick={onClick} title={title} disabled={disabled}>
        {content}
      </button>
    );
  }
  return (
    <div className={className} style={style} title={title}>
      {content}
    </div>
  );
}

/** Рубашка — для закрытых карт соперников. */
export function CardBack({ size = 'sm', motion, delayMs }: {
  size?: CardSize; motion?: string; delayMs?: number;
}) {
  return (
    <div
      className={['card', `card-${size}`, 'card-back', motion ?? ''].filter(Boolean).join(' ')}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      aria-hidden="true"
    />
  );
}
