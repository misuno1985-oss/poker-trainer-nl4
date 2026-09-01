import { useState } from 'react';
import { Table } from './ui/Table';
import { ActionBar } from './ui/ActionBar';
import { OpponentInfo } from './ui/OpponentInfo';
import { CoachPanel } from './ui/CoachPanel';
import { useNarrow } from './ui/useNarrow';
import { useSession } from './ui/useSession';
import { HERO_SEAT, heroLegal, isHeroTurn } from './app/session';
import { money, type StackMode } from './game/stacks';
import { totalPot } from './game/types';
import { categoryName } from './engine/evaluator';

const HERO_NAME = 'withorwithout';

export default function App() {
  const narrow = useNarrow();
  const [mode, setMode] = useState<StackMode>('standard');
  const [info, setInfo] = useState<string | null>(null);

  const { session, heroAct, nextHand, restart, botThinking, lastReview, handReviews } = useSession({
    heroName: HERO_NAME,
    stackMode: 'standard',
    smallBlind: 2,
    bigBlind: 4,
    seed: 20260901,
  });

  const state = session.state;
  const legal = heroLegal(session);
  const heroTurn = isHeroTurn(session);
  const result = state.result;
  const heroNet = result ? (result.net[HERO_SEAT] ?? 0) : 0;

  const switchMode = (next: StackMode) => {
    setMode(next);
    restart(next);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">NL4</div>
          <div>
            <h1>NL4 Poker Trainer</h1>
            <p>$0.02 / $0.04 · 6-max · раздача {session.handNumber}</p>
          </div>
        </div>

        <div className="topbar-right">
          <div className="stack-modes">
            <span className="hero-picker-label">Стеки</span>
            <div className="chips">
              <button
                type="button"
                className={`btn btn-chip ${mode === 'standard' ? 'chip-on' : ''}`}
                onClick={() => switchMode('standard')}
              >
                100 BB
              </button>
              <button
                type="button"
                className={`btn btn-chip ${mode === 'realistic' ? 'chip-on' : ''}`}
                onClick={() => switchMode('realistic')}
                title="Как за реальными столами: медиана 114bb, есть короткие и глубокие"
              >
                КАК В ЖИЗНИ
              </button>
            </div>
          </div>
          <div className="bankroll">
            <span className="hero-picker-label">Сессия</span>
            <strong className={session.bankroll >= 0 ? 'good' : 'bad'}>
              {session.bankroll >= 0 ? '+' : ''}
              {money(session.bankroll)}
            </strong>
          </div>
        </div>
      </header>

      <div className="layout">
        <main className="table-area">
          <Table
            session={session}
            narrow={narrow}
            showAllCards={!!result && result.showdownSeats.length > 1}
            onInfo={setInfo}
          />
        </main>

        <aside className="panel side-panel">
          {result ? (
            <div className="result-card">
              <span className="panel-label">Раздача {session.handNumber}</span>
              <div className={`result-amount ${heroNet >= 0 ? 'good' : 'bad'}`}>
                {heroNet >= 0 ? '+' : ''}
                {money(heroNet)}
              </div>
              <p className="result-line">{describeResult(session)}</p>
              <button type="button" className="btn btn-primary btn-wide" onClick={nextHand}>
                СЛЕДУЮЩАЯ РАЗДАЧА
              </button>
            </div>
          ) : (
            <div className="result-card">
              <span className="panel-label">Ход</span>
              <div className="turn-line">
                {heroTurn ? 'Твой ход' : botThinking ? `Думает ${currentName(session)}` : '…'}
              </div>
              <p className="result-line">
                Банк {money(totalPot(state))}
                {legal && legal.toCall > 0 && ` · доложить ${money(legal.toCall)}`}
              </p>
            </div>
          )}

          <CoachPanel review={lastReview} handReviews={handReviews} />
        </aside>
      </div>

      <div className="controls">
        {heroTurn && legal ? (
          <ActionBar
            legal={legal}
            decisionKey={`${session.handNumber}:${state.street}:${state.log.length}`}
            pot={totalPot(state)}
            bigBlind={state.bigBlind}
            preflop={state.street === 'preflop'}
            onAct={heroAct}
            disabled={false}
          />
        ) : (
          <div className="actionbar actionbar-idle">
            {result ? (
              <button type="button" className="btn btn-primary btn-wide" onClick={nextHand}>
                СЛЕДУЮЩАЯ РАЗДАЧА
              </button>
            ) : (
              <span className="waiting">Ход соперника…</span>
            )}
          </div>
        )}
      </div>

      <OpponentInfo name={info} onClose={() => setInfo(null)} />
    </div>
  );
}

function currentName(session: ReturnType<typeof useSession>['session']): string {
  const seat = session.state.toAct;
  return seat >= 0 ? session.state.players[seat].name : '';
}

function describeResult(session: ReturnType<typeof useSession>['session']): string {
  const state = session.state;
  const result = state.result!;
  const alive = state.players.filter((p) => !p.folded);

  if (alive.length === 1) {
    return `${alive[0].name} забирает банк — остальные сбросили.`;
  }

  const main = result.awards[result.awards.length - 1];
  const winners = main.winners.map((s) => state.players[s].name).join(' и ');
  const hand = main.handValue !== null ? categoryName(main.handValue) : '';
  const ru: Record<string, string> = {
    'High Card': 'старшая карта',
    Pair: 'пара',
    'Two Pair': 'две пары',
    'Three of a Kind': 'сет',
    Straight: 'стрит',
    Flush: 'флеш',
    'Full House': 'фулл-хаус',
    'Four of a Kind': 'каре',
    'Straight Flush': 'стрит-флеш',
  };
  return `${winners} — ${ru[hand] ?? hand}.`;
}
