import { RANKS, SUIT_SYMBOLS, rankOf, suitOf, type Card } from '../engine/cards';

export type CardSize = 'sm' | 'md' | 'lg';

interface Props {
  card: Card;
  size?: CardSize;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}

/** A plain, familiar two-colour playing card. */
export function PlayingCard({ card, size = 'md', onClick, title, disabled }: Props) {
  const empty = card < 0;
  const suit = empty ? 0 : suitOf(card);
  const red = suit === 1 || suit === 2;
  const className = [
    'card',
    `card-${size}`,
    empty ? 'card-empty' : red ? 'card-red' : 'card-black',
    onClick ? 'card-clickable' : '',
  ].join(' ');

  const content = empty ? (
    <span className="card-plus">+</span>
  ) : (
    <>
      <span className="card-rank">{RANKS[rankOf(card)]}</span>
      <span className="card-suit">{SUIT_SYMBOLS[suit]}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} title={title} disabled={disabled}>
        {content}
      </button>
    );
  }
  return (
    <div className={className} title={title}>
      {content}
    </div>
  );
}

/** Face-down card, used for opponents with unknown holdings. */
export function CardBack({ size = 'sm' }: { size?: CardSize }) {
  return <div className={`card card-${size} card-back`} aria-hidden="true" />;
}
