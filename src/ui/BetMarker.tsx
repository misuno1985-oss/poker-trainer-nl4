import { money } from '../game/stacks';
import type { BetSpot } from './betMarkers';

/**
 * Стопка фишек перед игроком и сумма под ней.
 *
 * Собрана по присланному образцу: настоящая фишка сбоку — диск с насечками по
 * ободу, — а сумма стоит на тёмной таблетке, чтобы читаться на любом сукне.
 *
 * Отдельный элемент от банка, стека игрока и подписи последнего действия: он
 * отвечает ровно на один вопрос — сколько этот игрок положил на стол ИМЕННО
 * на этой улице.
 */

const RX = 9.5;
const RY = 3.4;
const STEP = 3.2;

/**
 * Цвет по величине вклада, как в настоящем руме: белые — мелочь, красные —
 * средние, синие — крупные. Ещё один способ понять размер ставки не читая.
 */
function palette(chips: number): { face: string; edge: string; notch: string } {
  if (chips <= 2) return { face: '#f2f5fa', edge: '#aab3c2', notch: '#9aa4b5' };
  if (chips <= 3) return { face: '#d8483f', edge: '#8f2b25', notch: '#f6e4e2' };
  return { face: '#3f7fd8', edge: '#25508f', notch: '#e2ecf6' };
}

function ChipStack({ count }: { count: number }) {
  const { face, edge, notch } = palette(count);
  const height = RY * 2 + STEP * (count - 1);
  const w = RX * 2 + 2;
  const h = height + 2;
  const cx = RX + 1;

  return (
    <svg className="chip-stack" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const cy = h - RY - 1 - i * STEP;
        const top = i === count - 1;
        return (
          <g key={i}>
            <ellipse cx={cx} cy={cy} rx={RX} ry={RY} fill={face} stroke={edge} strokeWidth="0.9" />
            {/* Насечки по ободу — то, что делает диск фишкой, а не кружком. */}
            {top && [-1, 0, 1].map((k) => (
              <rect
                key={k}
                x={cx + k * (RX * 0.62) - 1.1}
                y={cy - RY + 0.5}
                width="2.2"
                height={RY * 2 - 1}
                rx="0.8"
                fill={notch}
                opacity="0.85"
              />
            ))}
            {top && <ellipse cx={cx} cy={cy} rx={RX * 0.5} ry={RY * 0.5} fill={face} stroke={edge} strokeWidth="0.6" />}
          </g>
        );
      })}
    </svg>
  );
}

export function BetMarker({ spot, flying, motion, from }: {
  spot: BetSpot;
  flying?: boolean;
  /** Класс короткой анимации: фишки приехали от игрока. */
  motion?: string;
  /** Откуда фишки выехали — смещение в пикселях в сторону своего места. */
  from?: { x: number; y: number };
}) {
  const classes = [
    'bet-marker',
    spot.folded ? 'bet-folded' : '',
    flying ? 'bet-flying' : '',
    motion ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{
        left: `${spot.x}%`,
        top: `${spot.y}%`,
        ...(from ? {
          '--from-x': `${from.x.toFixed(1)}px`,
          '--from-y': `${from.y.toFixed(1)}px`,
        } as React.CSSProperties : {}),
      }}
    >
      <ChipStack count={spot.chips} />
      <span className="bet-amount">{money(spot.amount)}</span>
      {spot.allIn && !spot.folded && <span className="bet-allin">ALL-IN</span>}
    </div>
  );
}
