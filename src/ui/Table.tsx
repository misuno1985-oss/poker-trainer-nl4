import { useEffect, useRef, useState } from 'react';
import { PlayingCard, CardBack } from './PlayingCard';
import { BetMarker } from './BetMarker';
import { DealerButton, dealerSpot } from './DealerButton';
import { TABLE_CENTER, betSpots, type BetSpot } from './betMarkers';
import { useTableFit } from './useTableFit';
import { DEAL_STAGGER_MS } from './tableTimeline';
import type { TableAnim } from './useTableTimeline';
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


/**
 * Направление «от места к центру стола» в пикселях.
 *
 * Проценты по осям неравнозначны: стол шире, чем выше, поэтому 1% по X — это
 * больше пикселей, чем 1% по Y. Без поправки карты нижних мест улетали бы в
 * мак под другим углом, чем боковых.
 */
function towardCentre(seat: { x: number; y: number }, distance: number) {
  const dx = (50 - seat.x) * 1.6;
  const dy = 50 - seat.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (dx / len) * distance, y: (dy / len) * distance };
}

interface Props {
  session: Session;
  narrow: boolean;
  showAllCards: boolean;
  /** Состояние анимаций: его считает таймлайн, стол только рисует. */
  anim: TableAnim;
  onInfo: (name: string) => void;
}

export function Table({ session, narrow, showAllCards, anim, onInfo }: Props) {
  const state = session.state;
  const views = seatViews(session);
  const coords = narrow ? SEAT_COORDS_NARROW : SEAT_COORDS;
  const pot = totalPot(state);
  // Ширина стола на широком экране считается замером ячейки: так он всегда
  // помещается по высоте, и панель кнопок не наезжает на место героя.
  const [wrapRef, fitWidth] = useTableFit(16 / 10, 920, !narrow);
  const spots = betSpots(views, coords, narrow, state.bigBlind);
  const dealtAt = (seat: number) => anim.dealt.indexOf(seat);
  // У героя подпись действия стоит НАД картами, то есть ровно там, куда на
  // узком экране приходит его маркер. Дублировать нечего: маркер говорит то же
  // самое и точнее, поэтому подпись героя уступает ему место.
  const heroHasMarker = spots.some((s2) => s2.seat === HERO_SEAT);
  const flying = useCollectAnimation(spots, anim.collecting);
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
                  {state.board[i] !== undefined && i < anim.boardShown ? (
                    <PlayingCard
                      key={`${session.handNumber}-${state.board[i]}`}
                      card={state.board[i]}
                      size={narrow ? 'sm' : 'md'}
                      motion={anim.boardEntering.includes(i) ? 'card-deal-board' : undefined}
                    />
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
        <BetMarker
          key={`bet-${s2.seat}`}
          spot={s2}
          from={towardCentre(coords[s2.seat], narrow ? -18 : -24)}
          motion={anim.chips.includes(s2.seat) ? 'bet-arriving' : undefined}
        />
      ))}

      {/* Уехавшие в банк фишки прошлой улицы: только показать, что они ушли. */}
      {flying.map((s2) => (
        <BetMarker key={`fly-${s2.seat}`} spot={s2} flying />
      ))}

      <DealerButton spot={dealerSpot(coords[anim.button], narrow, anim.button === HERO_SEAT)} />

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
          dealtAt={dealtAt(v.seat)}
          entering={anim.entering.includes(v.seat)}
          folding={anim.folding.includes(v.seat)}
          revealing={anim.revealing.includes(v.seat)}
          awarded={anim.awarding === v.seat}
          handKey={session.handNumber}
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
  /** Каким по счёту месту раздали карты; -1 — ещё не раздали. */
  dealtAt: number;
  /** Карты этого места появились по событию раздачи, а не прыжком. */
  entering: boolean;
  folding: boolean;
  revealing: boolean;
  awarded: boolean;
  handKey: number;
  onInfo: (name: string) => void;
}

function SeatBox({
  view, x, y, narrow, reveal, hideAction, dealtAt, entering, folding, revealing, awarded, handKey, onInfo,
}: SeatProps) {
  const classes = [
    'seat',
    view.isHero ? 'seat-hero' : '',
    // Пока карты уходят в мак, место ещё не «сброшенное»: иначе оно потускнеет
    // раньше, чем карты доедут.
    view.folded && !folding ? 'seat-folded' : '',
    view.isToAct ? 'seat-active' : '',
    awarded ? 'seat-awarded' : '',
  ].filter(Boolean).join(' ');

  // Карты видно, когда дилер до этого места дошёл, и пока они не уехали в мак.
  const showCards = dealtAt >= 0 && view.cards[0] >= 0 && (!view.folded || folding);
  const motion = folding ? 'card-muck' : entering ? 'card-deal' : '';
  const delay = folding || !entering ? 0 : dealtAt * DEAL_STAGGER_MS;
  const size = view.isHero && !narrow ? 'md' : 'sm';

  // Карты приходят со стороны центра и туда же уходят в мак — у каждого места
  // своё направление, как и у фишек.
  const muck = towardCentre({ x, y }, narrow ? 20 : 26);
  const vars = {
    '--muck-x': `${muck.x.toFixed(1)}px`,
    '--muck-y': `${muck.y.toFixed(1)}px`,
    '--deal-x': `${(-muck.x * 0.7).toFixed(1)}px`,
    '--deal-y': `${(-muck.y * 0.7).toFixed(1)}px`,
  } as React.CSSProperties;

  // Подпись действия у героя стоит НАД картами (он внизу экрана), у остальных —
  // под табличкой. Так она всегда смотрит в сторону центра стола.
  const label = view.lastAction && !view.isToAct && !hideAction && (
    <div className={`seat-action ${view.lastAction.startsWith('FOLD') ? 'act-fold' : ''}`}>
      {view.lastAction}
    </div>
  );

  return (
    <div className={classes} style={{ left: `${x}%`, top: `${y}%`, ...vars }}>
      {view.isHero && label}

      <div className={`seat-cards ${folding ? 'seat-cards-muck' : ''}`}>
        {showCards ? (
          reveal ? (
            <>
              <PlayingCard key={`${handKey}-a`} card={view.cards[0]} size={size}
                motion={revealing ? 'card-reveal' : motion} delayMs={delay} />
              <PlayingCard key={`${handKey}-b`} card={view.cards[1]} size={size}
                motion={revealing ? 'card-reveal' : motion} delayMs={delay} />
            </>
          ) : (
            <>
              <CardBack key={`${handKey}-a`} size="sm" motion={motion} delayMs={delay} />
              <CardBack key={`${handKey}-b`} size="sm" motion={motion} delayMs={delay} />
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
 * Короткий переезд фишек в центр при сборе банка.
 *
 * Момент переезда задаёт таймлайн — тот же, что играет звук сбора, поэтому
 * движение и звук начинаются вместе. Само по себе это только оформление: банк
 * в `totalPot` считается по `handCommit` и уже включает ставки текущей улицы,
 * так что в момент перехода его число не меняется.
 */
function useCollectAnimation(spots: BetSpot[], collecting: boolean): BetSpot[] {
  const [flying, setFlying] = useState<BetSpot[]>([]);
  const lastSpots = useRef<BetSpot[]>(spots);
  const wasCollecting = useRef(false);

  useEffect(() => {
    if (collecting === wasCollecting.current) {
      if (!collecting) lastSpots.current = spots;
      return;
    }
    wasCollecting.current = collecting;
    if (!collecting) {
      setFlying([]);
      return;
    }

    const from = lastSpots.current;
    if (from.length === 0) return;

    setFlying(from.map((s) => ({ ...s })));
    // Второй кадр нужен, чтобы браузер успел отрисовать фишки на месте и
    // только потом поехал: без этого перехода не видно.
    const raf = requestAnimationFrame(() => {
      setFlying((cur) => cur.map((s) => ({ ...s, x: TABLE_CENTER.x, y: TABLE_CENTER.y })));
    });
    return () => cancelAnimationFrame(raf);
  });

  return flying;
}
