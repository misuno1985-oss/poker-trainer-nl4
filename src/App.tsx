import { useState } from 'react';
import { Table } from './ui/Table';
import { ActionBar } from './ui/ActionBar';
import { OpponentInfo } from './ui/OpponentInfo';
import { CoachPanel } from './ui/CoachPanel';
import { HandAnalysis } from './ui/HandAnalysis';
import { MistakesScreen, ProgressScreen, StartScreen, SummaryScreen } from './ui/Screens';
import { SoundToggle } from './ui/SoundToggle';
import { useTableSounds } from './ui/useTableSounds';
import { useNarrow } from './ui/useNarrow';
import { useTrainer } from './ui/useTrainer';
import { HERO_SEAT, heroLegal, isHeroTurn, type Session } from './app/session';
import { MODE_TITLES, type TrainerMode } from './app/trainer';
import { CATEGORY_TITLES } from './coach/categories';
import { money } from './game/stacks';
import { totalPot } from './game/types';
import { categoryName } from './engine/evaluator';

export default function App() {
  const narrow = useNarrow();
  const [info, setInfo] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState(false);
  const t = useTrainer();
  // Звук слушает протокол раздачи, а не кнопки: ходы соперников и
  // переигрывание звучат так же, как свои ходы.
  useTableSounds(t.session, t.screen === 'table');

  const close = () => setAnalysis(false);

  if (t.screen === 'start') {
    return (
      <Shell>
        <StartScreen
          progress={t.progress}
          onStart={(mode, stacks) => { close(); t.start(mode, stacks); }}
          onProgress={() => t.goto('progress')}
          onMistakes={() => t.goto('mistakes')}
        />
      </Shell>
    );
  }

  if (t.screen === 'summary') {
    return (
      <Shell>
        <SummaryScreen
          totals={t.totals}
          onRestart={() => t.start(t.mode, t.stackMode)}
          onHome={() => t.goto('start')}
          onMistakes={() => t.goto('mistakes')}
        />
      </Shell>
    );
  }

  if (t.screen === 'progress') {
    return (
      <Shell>
        <ProgressScreen progress={t.progress} onHome={() => t.goto('start')} onWipe={t.wipeProgress} />
      </Shell>
    );
  }

  if (t.screen === 'mistakes') {
    return (
      <Shell>
        <MistakesScreen
          progress={t.progress}
          onHome={() => t.goto('start')}
          onReplay={(i) => { close(); t.replayMistake(i); }}
        />
      </Shell>
    );
  }

  /* ---------------- стол ---------------- */

  const session = t.session;
  const state = session.state;
  const legal = heroLegal(session);
  const heroTurn = isHeroTurn(session) && !t.replaying;
  const result = state.result;
  const heroNet = result ? (result.net[HERO_SEAT] ?? 0) : 0;
  const limit = t.mode.handLimit;

  const nextHand = () => { close(); t.nextHand(); };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button type="button" className="brand-mark brand-home" title="В меню"
            onClick={() => { close(); t.goto('start'); }}>NL4</button>
          <div>
            <h1>{modeTitle(t.mode)}</h1>
            <p>
              $0.02 / $0.04 · 6-max · раздача{' '}
              {limit
                ? `${Math.min(result ? t.handsPlayed : t.handsPlayed + 1, limit)} из ${limit}`
                : session.handNumber}
            </p>
          </div>
        </div>

        <div className="topbar-right">
          {t.isReplay && <span className="replay-badge">ПЕРЕИГРЫВАНИЕ · в статистику не идёт</span>}
          <SoundToggle />
          <div className="bankroll">
            <span className="hero-picker-label">Оценка</span>
            <strong className={t.totals.decisions === 0 ? '' : t.totals.score >= 7.5 ? 'good' : t.totals.score >= 5.5 ? '' : 'bad'}>
              {t.totals.decisions > 0 ? t.totals.score.toFixed(1) : '—'}
            </strong>
          </div>
          <div className="bankroll bankroll-quiet">
            <span className="hero-picker-label">Деньги</span>
            <strong>{t.totals.net >= 0 ? '+' : ''}{money(t.totals.net)}</strong>
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
                {heroNet >= 0 ? '+' : ''}{money(heroNet)}
              </div>
              <p className="result-line">{describeResult(session)}</p>
              <div className="hand-buttons">
                {t.sessionComplete ? (
                  <button type="button" className="btn btn-primary btn-wide" onClick={t.finishSession}>
                    ПОСМОТРЕТЬ ИТОГ СЕССИИ
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-wide" onClick={nextHand}>
                    СЛЕДУЮЩАЯ РАЗДАЧА
                  </button>
                )}
                <button type="button" className="btn btn-outline btn-wide"
                  onClick={() => { close(); t.replayExact(); }}>
                  ПЕРЕИГРАТЬ РАЗДАЧУ
                </button>
                <button type="button" className="btn btn-outline btn-wide" onClick={() => setAnalysis(true)}>
                  ПОДРОБНЫЙ РАЗБОР
                </button>
                {!limit && t.totals.decisions > 0 && (
                  <button type="button" className="btn btn-ghost btn-wide" onClick={t.finishSession}>
                    Закончить и посмотреть итог
                  </button>
                )}
                {t.sessionComplete && (
                  <p className="fineprint">
                    Раздачи сессии закончились. Можно ещё раз посмотреть эту руку или открыть итог.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="result-card">
              <span className="panel-label">Ход</span>
              <div className="turn-line">
                {heroTurn
                  ? 'Твой ход'
                  : t.replaying
                    ? 'Повторяю сыгранное…'
                    : t.botThinking ? `Думает ${currentName(session)}` : '…'}
              </div>
              <p className="result-line">
                Банк {money(totalPot(state))}
                {legal && legal.toCall > 0 && ` · доложить ${money(legal.toCall)}`}
              </p>
              {t.mode.kind === 'weak-spot' && t.mode.category && (
                <p className="mode-hint">
                  Тренируем: {CATEGORY_TITLES[t.mode.category]}. Такая ситуация встречается чаще
                  обычного — но что в ней делать, зависит от карт, а не от названия режима.
                </p>
              )}
              {t.mode.kind === 'versus' && t.mode.villain && (
                <p className="mode-hint">Против {t.mode.villain} — место он меняет каждую раздачу.</p>
              )}
            </div>
          )}

          {t.coachThinking && <div className="coach-thinking">Тренер анализирует решение…</div>}
          <CoachPanel review={t.lastReview} handReviews={t.handReviews} />
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
            onAct={t.act}
            disabled={false}
          />
        ) : (
          <div className="actionbar actionbar-idle">
            {result ? (
              <>
                {t.sessionComplete ? (
                  <button type="button" className="btn btn-primary" onClick={t.finishSession}>ИТОГ СЕССИИ</button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={nextHand}>СЛЕДУЮЩАЯ РАЗДАЧА</button>
                )}
                <button type="button" className="btn btn-outline" onClick={() => setAnalysis(true)}>РАЗБОР</button>
              </>
            ) : (
              <span className="waiting">{t.replaying ? 'Повторяю сыгранное…' : 'Ход соперника…'}</span>
            )}
          </div>
        )}
      </div>

      {analysis && (
        <HandAnalysis
          session={session}
          reviews={t.handReviews}
          onClose={close}
          onTryAnother={(i) => { close(); t.tryAnotherLine(i); }}
        />
      )}
      <OpponentInfo name={info} onClose={() => setInfo(null)} />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app app-sheet">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">NL4</div>
          <div>
            <h1>NL4 Poker Trainer</h1>
            <p>$0.02 / $0.04 · 6-max · тренажёр с разбором каждого решения</p>
          </div>
        </div>
        <div className="topbar-right"><SoundToggle /></div>
      </header>
      <div className="layout layout-sheet">{children}</div>
    </div>
  );
}

function modeTitle(mode: TrainerMode): string {
  if (mode.kind === 'weak-spot' && mode.category) return CATEGORY_TITLES[mode.category];
  if (mode.kind === 'versus' && mode.villain) return `Против ${mode.villain}`;
  return MODE_TITLES[mode.kind];
}

function currentName(session: Session): string {
  const seat = session.state.toAct;
  return seat >= 0 ? session.state.players[seat].name : '';
}

function describeResult(session: Session): string {
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
