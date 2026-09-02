import { markerSpot, type Point } from './betMarkers';

/**
 * Кнопка дилера — белая шайба с буквой D, лежащая на сукне.
 *
 * Ставится между местом и центром стола, но ближе к месту и в стороне от
 * маркера ставок: у маркера свой путь к центру, у кнопки — свой, смещённый
 * вбок. Иначе на местах с крупной ставкой они наезжали бы друг на друга.
 *
 * Переезд между раздачами — обычный CSS-переход по left/top: кнопка едет по
 * столу, а не телепортируется.
 */

/** Насколько кнопка отходит от места к центру. Ближе, чем фишки. */
const TRAVEL = 0.26;
const TRAVEL_NARROW = 0.3;
/**
 * Сдвиг вбок от линии «место → центр»: по этой линии едут фишки, и кнопке там
 * не место. На узком экране сдвигать приходится сильнее — стол меньше, а
 * таблички и карты те же самые.
 */
const SIDE = 0.34;
const SIDE_NARROW = 0.85;

export function dealerSpot(seat: Point, narrow: boolean, hero: boolean): Point {
  const marker = markerSpot(seat, narrow, hero);
  const travel = narrow ? TRAVEL_NARROW : TRAVEL;
  const side = narrow ? SIDE_NARROW : SIDE;
  const toCentre = { x: 50 - seat.x, y: 50 - seat.y };
  const base = { x: seat.x + toCentre.x * travel, y: seat.y + toCentre.y * travel };

  // Перпендикуляр к направлению «место → центр»: уводит кнопку вбок от
  // траектории фишек.
  const len = Math.hypot(toCentre.x, toCentre.y) || 1;
  const nx = -toCentre.y / len;
  const ny = toCentre.x / len;
  const shift = Math.hypot(marker.x - seat.x, marker.y - seat.y) * side;

  return { x: base.x + nx * shift, y: base.y + ny * shift };
}

export function DealerButton({ spot }: { spot: Point }) {
  return (
    <div
      className="dealer-button"
      style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
      title="Кнопка дилера"
      aria-label="Кнопка дилера"
    >
      D
    </div>
  );
}
