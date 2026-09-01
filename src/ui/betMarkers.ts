/**
 * Фишки текущей улицы: где их рисовать и сколько их в стопке.
 *
 * Здесь только геометрия и внешний вид. Сумма берётся из движка как есть
 * (`Player.streetCommit` через `SeatView.committed`) — интерфейс ничего не
 * досчитывает сам и ничего не помнит между улицами: движок обнуляет вклад в
 * `openStreet`, и маркеры исчезают вместе с ним.
 */

import type { SeatView } from '../app/session';

export interface Point {
  x: number;
  y: number;
}

/** Центр стола в тех же процентах, в которых заданы места. */
export const TABLE_CENTER: Point = { x: 50, y: 50 };

/**
 * Насколько маркер отходит от места к центру: 0 — на самом месте, 1 — в центре.
 * На узком экране места крупнее относительно стола, поэтому отходить приходится
 * дальше, иначе фишки лягут на табличку игрока.
 */
const TRAVEL = 0.34;
const TRAVEL_NARROW = 0.58;

/**
 * Герою приходится отходить дальше остальных, и причина не в эстетике: у всех
 * мест порядок сверху вниз «карты — табличка — подпись действия», а у героя он
 * перевёрнут («подпись — карты — табличка»), потому что он внизу экрана. То
 * есть его карты растут именно в сторону центра, и обычного отступа не хватает.
 */
const TRAVEL_HERO = 0.53;
const TRAVEL_HERO_NARROW = 0.56;

/**
 * Запретная середина: борд и банк, уже расширенные на половину маркера и
 * небольшой зазор. Маркер туда не заходит ни при каком направлении.
 *
 * Числа измерены по свёрстанному столу (борд и плашка банка) и подобраны под
 * две наши раскладки. Проверяются тестом на геометрию и глазами в браузере:
 * если борд когда-нибудь поменяет размер, обе проверки об этом скажут.
 *
 * Широкий стол: борд занимает x 34.6–65.4, банк доходит до y 59.8.
 * Узкий: борд x 20.6–79.4, банк до y 55.7 — там середина заметно шире.
 */
export interface KeepOut {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const KEEP_OUT: KeepOut = { left: 31, right: 69, top: 35.5, bottom: 64.5 };
export const KEEP_OUT_NARROW: KeepOut = { left: 13.2, right: 86.8, top: 29.5, bottom: 62.5 };

export function keepOutFor(narrow: boolean): KeepOut {
  return narrow ? KEEP_OUT_NARROW : KEEP_OUT;
}

/**
 * Если точка попала в середину — вытолкнуть её наружу по кратчайшей стороне.
 *
 * На узком экране стол вытянут в высоту, и луч от верхних боковых мест к
 * центру упирается прямо в угол борда. Отодвигать по тому же лучу бесполезно:
 * маркер поедет вдоль борда. Выталкивание по ближайшей грани уводит его в
 * свободное место и оставляет «перед игроком».
 */
export function pushOutOfCentre(p: Point, box: KeepOut): Point {
  const inside = p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom;
  if (!inside) return p;

  const up = p.y - box.top;
  const down = box.bottom - p.y;
  const left = p.x - box.left;
  const right = box.right - p.x;
  const min = Math.min(up, down, left, right);

  if (min === up) return { x: p.x, y: box.top };
  if (min === down) return { x: p.x, y: box.bottom };
  if (min === left) return { x: box.left, y: p.y };
  return { x: box.right, y: p.y };
}

/**
 * Точка маркера — по направлению от места к центру стола.
 * Одной общей координаты быть не может: у каждого места своё направление,
 * иначе фишки нижнего игрока оказались бы у него за спиной.
 */
export function markerSpot(seat: Point, narrow: boolean, hero = false): Point {
  const t = hero
    ? (narrow ? TRAVEL_HERO_NARROW : TRAVEL_HERO)
    : (narrow ? TRAVEL_NARROW : TRAVEL);
  const ideal = {
    x: seat.x + (TABLE_CENTER.x - seat.x) * t,
    y: seat.y + (TABLE_CENTER.y - seat.y) * t,
  };
  return pushOutOfCentre(ideal, keepOutFor(narrow));
}

/**
 * Высота стопки. Это чисто визуальный эффект: рисовать настоящее число фишек
 * по номиналам смысла нет, а разница между блайндом и крупной ставкой должна
 * читаться с одного взгляда.
 *
 * Пороги заданы в блайндах, чтобы не рассыпаться, если лимит когда-нибудь
 * поменяется: до 2bb — маленькая стопка, до 10bb — средняя, дальше — крупная.
 */
export function chipCount(cents: number, bigBlind: number): number {
  if (cents <= 0) return 0;
  if (cents <= bigBlind * 2) return 2;
  if (cents <= bigBlind * 10) return 3;
  return 5;
}

export interface BetSpot {
  seat: number;
  /** Позиция маркера в процентах от стола. */
  x: number;
  y: number;
  /** Вклад игрока на ТЕКУЩЕЙ улице, в центах. */
  amount: number;
  chips: number;
  folded: boolean;
  allIn: boolean;
}

/**
 * Маркеры для всех, у кого на этой улице есть деньги на столе.
 *
 * Сбросивший игрок тоже показывается — его фишки никуда не делись и лежат в
 * банке, — но приглушённо. Прятать их значило бы врать про то, откуда взялся
 * банк.
 */
export function betSpots(
  views: SeatView[],
  coords: readonly Point[],
  narrow: boolean,
  bigBlind: number,
): BetSpot[] {
  const out: BetSpot[] = [];
  for (const v of views) {
    if (v.committed <= 0) continue;
    const spot = markerSpot(coords[v.seat], narrow, v.isHero);
    out.push({
      seat: v.seat,
      x: spot.x,
      y: spot.y,
      amount: v.committed,
      chips: chipCount(v.committed, bigBlind),
      folded: v.folded,
      allIn: v.allIn,
    });
  }
  return out;
}
