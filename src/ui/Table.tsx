import { useEffect, useRef, useState } from 'react';
import { PlayingCard, CardBack } from './PlayingCard';
import { BetMarker } from './BetMarker';
import { TABLE_CENTER, betSpots, type BetSpot } from './betMarkers';
import { useTableFit } from './useTableFit';
import { money } from '../game/stacks';
import { totalPot } from '../game/types';
import { HERO_SEAT, seatViews, type Session, type SeatView } from '../app/session';

/**
 * Овальный стол на шесть мест. Герой всегда внизу по центру, остальные идут
 * от него по часовой стрелке — реальная позиция героя при этом меняется
 * каждую раздачу и написана на его бейдже.
 */
const SEAT_COORDS = [
  { x: 50, y: 88 }, // 0 — герой
  { x: 9, y: 70 },
  { x: 9, y: 25 },
  { x: 50, y: 5 },
  { x: 91, y: 25 },
  { x: 91, y: 70 },
];

// На узком экране места приходится сдвигать внутрь: иначе половина таблички
// уезжает за край.
const SEAT_COORDS_NARROW = [
  { x: 50, y: 82 },
  { x: 17, y: 72 },
  { x: 17, y: 24 },
  { x: 50, y: 8 },
  { x: 83, y: 24 },
  { x: 83, y: 74 },
];

interface Props {
  session: Session;
  narrow: boolean;
  showAllCards: boolean;
  onInfo: (name: string) => void;
}

export function Table({ session, narrow, showAllCards, onInfo }: Props) {
  const state = session.state;
  const views = seatViews(session);
  const coords = narrow ? SEAT_COORDS_NARROW : SEAT_COORDS;
  const pot = totalPot(state);
  // Ширина стола на широком экране считается замером ячейки: так он всегда
  // помещается по высоте, и панель кнопок не наезжает на место героя.
  const [wrapRef, fitWidth] = useTableFit(16 / 10, 920, !narrow);
  const spots = betSpots(views, coords, narrow, state.bigBlind);
  // У героя подпись действия стоит НАД картами, то есть ровно там, куда на
  // узком экране приходит его маркер. Дублировать нечего: маркер говорит то же
  // самое и точнее, поэтому подпись героя уступает ему место.
  const heroHasMarker = spots.some((s2) => s2.seat === HERO_SEAT);
  const flying = useCollectAnimation(spots, state.street, session.handNumber);
  const streetLabel = { preflop: 'PREFLOP', flop: 'FLOP', turn: 'TURN', river: 'RIVER', showdown: 'SHOWDOWN' }[state.street];

  return (
    <div className="table-wrap" ref={wrapRef} style={fitWidth === null ? undefined : { width: fitWidth }}>
      <div className="felt">
        <div className="felt-inner">
          <div className="table-mark">NL4 · 6-MAX</div>

          <div className="table-center">
            <div className="board">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className={`board-slot ${i === 3 ? 'board-gap' : ''}`}>
                  {state.board[i] !== undefined ? (
                    <PlayingCard card={state.board[i]} size={narrow ? 'sm' : 'md'} />
                  ) : (
                    <div className={`card card-${narrow ? 'sm' : 'md'} card-hidden`} />
                  )}
                </div>
              ))}
            </div>
            <div className="pot">
              <span className="pot-chip" />
              <span className="pot-amount">POT {money(pot)}</span>
              <span className="pot-street">{streetLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {spots.map((s2) => (
        <BetMarker key={`bet-${s2.seat}`} spot={s2} />
      ))}

      {/* Уехавшие в банк фишки прошлой улицы: только показать, что они ушли. */}
      {flying.map((s2) => (
        <BetMarker key={`fly-${s2.seat}`} spot={s2} flying />
      ))}

      {views.map((v) => (
        <SeatBox
          key={v.seat}
          view={v}
          x={coords[v.seat].x}
          y={coords[v.seat].y}
          narrow={narrow}
          reveal={showAllCards || v.isHero}
          bigBlind={state.bigBlind}
          hideAction={narrow && v.isHero && heroHasMarker}
          onInfo={onInfo}
        />
      ))}
    </div>
  );
}

interface SeatProps {
  view: SeatView;
  x: number;
  y: number;
  narrow: boolean;
  reveal: boolean;
  bigBlind: number;
  hideAction: boolean;
  onInfo: (name: string) => void;
}

function SeatBox({ view, x, y, narrow, reveal, hideAction, onInfo }: SeatProps) {
  const classes = [
    'seat',
    view.isHero ? 'seat-hero' : '',
    view.folded ? 'seat-folded' : '',
    view.isToAct ? 'seat-active' : '',
  ].join(' ');

  const showCards = !view.folded && view.cards[0] >= 0;

  // Подпись действия у героя стоит НАД картами (он внизу экрана), у остальных —
  // под табличкой. Так она всегда смотрит в сторону центра стола.
  const label = view.lastAction && !view.isToAct && !hideAction && (
    <div className={`seat-action ${view.lastAction.startsWith('FOLD') ? 'act-fold' : ''}`}>
      {view.lastAction}
    </div>
  );

  return (
    <div className={classes} style={{ left: `${x}%`, top: `${y}%` }}>
      {view.isHero && label}

      <div className="seat-cards">
        {showCards ? (
          reveal ? (
            <>
              <PlayingCard card={view.cards[0]} size={view.isHero && !narrow ? 'md' : 'sm'} />
              <PlayingCard card={view.cards[1]} size={view.isHero && !narrow ? 'md' : 'sm'} />
            </>
          ) : (
            <>
              <CardBack size="sm" />
              <CardBack size="sm" />
            </>
          )
        ) : null}
      </div>

      <div className="seat-plate">
        <div className="seat-row">
          <span className="seat-name">{view.name}</span>
          {view.profile && (
            <button
              type="button"
              className="seat-info"
              title={`Что известно про ${view.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onInfo(view.profile!.name);
              }}
            >
              i
            </button>
          )}
        </div>
        <div className="seat-row seat-row-2">
          <span className={`seat-pos pos-${view.position}`}>{view.position}</span>
          <span className="seat-stack">{view.allIn ? 'ALL-IN' : money(view.stack)}</span>
        </div>
      </div>

      {!view.isHero && label}
    </div>
  );
}

/**
 * Короткий переезд фишек в центр при смене улицы.
 *
 * Только оформление: банк в `totalPot` и так считается по `handCommit`, то есть
 * уже включает ставки текущей улицы, и в момент перехода его число не меняется.
 * Анимация показывает, куда девались фишки, и ничего не пересчитывает.
 */
function useCollectAnimation(spots: BetSpot[], street: string, handNumber: number): BetSpot[] {
  const [flying, setFlying] = useState<BetSpot[]>([]);
  const lastStreet = useRef(street);
  const lastHand = useRef(handNumber);
  const lastSpots = useRef<BetSpot[]>(spots);

  useEffect(() => {
    const streetChanged = lastStreet.current !== street;
    const newHand = lastHand.current !== handNumber;
    const from = lastSpots.current;
    lastStreet.current = street;
    lastHand.current = handNumber;

    // Новая раздача — не переезд, а обнуление: собирать нечего.
    if (!streetChanged || newHand || from.length === 0) {
      setFlying([]);
      return;
    }

    setFlying(from.map((s) => ({ ...s })));
    // Второй кадр нужен, чтобы браузер успел отрисовать фишки на месте и
    // только потом поехал: без этого перехода не видно.
    const raf = requestAnimationFrame(() => {
      setFlying((cur) => cur.map((s) => ({ ...s, x: TABLE_CENTER.x, y: TABLE_CENTER.y })));
    });
    const timer = window.setTimeout(() => setFlying([]), 480);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      // Обязательно убрать за собой: если улица сменилась раньше, чем фишки
      // доехали, таймер отменяется вместе с уборкой, и прошлый переезд остался
      // бы висеть в разметке навсегда.
      setFlying([]);
    };
  }, [street, handNumber]);

  // Обновляем снимок после эффекта перехода, чтобы он видел прошлую улицу.
  useEffect(() => {
    if (lastStreet.current === street) lastSpots.current = spots;
  });

  return flying;
}
