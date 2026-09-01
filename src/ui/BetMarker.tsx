import { money } from '../game/stacks';
import type { BetSpot } from './betMarkers';

/**
 * Стопка фишек перед игроком и сумма под ней.
 *
 * Отдельный элемент от банка, стека игрока и подписи последнего действия:
 * он отвечает ровно на один вопрос — сколько этот игрок положил на стол
 * ИМЕННО на этой улице.
 */

const RX = 9.5;
const RY = 3.2;
const STEP = 3.4;

function ChipStack({ count }: { count: number }) {
  const height = RY * 2 + STEP * (count - 1);
  const w = RX * 2 + 2;
  const h = height + 2;
  return (
    <svg className="chip-stack" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <ellipse
          key={i}
          cx={RX + 1}
          // Рисуем снизу вверх, чтобы верхняя фишка легла поверх остальных.
          cy={h - RY - 1 - i * STEP}
          rx={RX}
          ry={RY}
          className={i === count - 1 ? 'chip chip-top' : i % 2 ? 'chip chip-dark' : 'chip'}
        />
      ))}
    </svg>
  );
}

export function BetMarker({ spot, flying }: { spot: BetSpot; flying?: boolean }) {
  const classes = [
    'bet-marker',
    spot.folded ? 'bet-folded' : '',
    flying ? 'bet-flying' : '',
  ].join(' ');

  return (
    <div className={classes} style={{ left: `${spot.x}%`, top: `${spot.y}%` }}>
      <ChipStack count={spot.chips} />
      <span className="bet-amount">{money(spot.amount)}</span>
      {spot.allIn && !spot.folded && <span className="bet-allin">ALL-IN</span>}
    </div>
  );
}
