import { PlayingCard, CardBack } from './PlayingCard';
import { money } from '../game/stacks';
import { totalPot } from '../game/types';
import { seatViews, type Session, type SeatView } from '../app/session';

/**
 * Овальный стол на шесть мест. Герой всегда внизу по центру, остальные идут
 * от него по часовой стрелке — реальная позиция героя при этом меняется
 * каждую раздачу и написана на его бейдже.
 */
const SEAT_COORDS = [
  { x: 50, y: 92 }, // 0 — герой
  { x: 9, y: 70 },
  { x: 9, y: 25 },
  { x: 50, y: 5 },
  { x: 91, y: 25 },
  { x: 91, y: 70 },
];

// На узком экране места приходится сдвигать внутрь: иначе половина таблички
// уезжает за край.
const SEAT_COORDS_NARROW = [
  { x: 50, y: 86 },
  { x: 17, y: 74 },
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
  const streetLabel = { preflop: 'PREFLOP', flop: 'FLOP', turn: 'TURN', river: 'RIVER', showdown: 'SHOWDOWN' }[state.street];

  return (
    <div className="table-wrap">
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

      {views.map((v) => (
        <SeatBox
          key={v.seat}
          view={v}
          x={coords[v.seat].x}
          y={coords[v.seat].y}
          narrow={narrow}
          reveal={showAllCards || v.isHero}
          bigBlind={state.bigBlind}
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
  onInfo: (name: string) => void;
}

function SeatBox({ view, x, y, narrow, reveal, onInfo }: SeatProps) {
  const classes = [
    'seat',
    view.isHero ? 'seat-hero' : '',
    view.folded ? 'seat-folded' : '',
    view.isToAct ? 'seat-active' : '',
  ].join(' ');

  const showCards = !view.folded && view.cards[0] >= 0;

  // Подпись действия у героя стоит НАД картами (он внизу экрана), у остальных —
  // под табличкой. Так она всегда смотрит в сторону центра стола.
  const label = view.lastAction && !view.isToAct && (
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
        {view.committed > 0 && <span className="seat-bet">{money(view.committed)}</span>}
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
