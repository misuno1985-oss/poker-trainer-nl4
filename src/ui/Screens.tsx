import { useState } from 'react';
import { money, type StackMode } from '../game/stacks';
import { CardText } from './CardText';
import { ALL_CATEGORIES, CATEGORY_HINTS, CATEGORY_TITLES, type CategoryId } from '../coach/categories';
import { buildSessionSummary } from '../coach/summary';
import { buildExport, exportFileName, type SessionLog } from '../app/sessionLog';
import { downloadJson } from '../app/download';
import { PROFILES } from '../bots/profiles';
import { VILLAIN_NAMES, type TrainerMode } from '../app/trainer';
import {
  MIN_FOR_TREND, averageScore, tally, trendFor, versusTable, type Progress,
} from '../app/progress';
import type { SessionTotals } from './useTrainer';

/** «1 раздача», «2 раздачи», «5 раздач» — иначе интерфейс говорит на ломаном. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`;
  switch (n % 10) {
    case 1: return `${n} ${one}`;
    case 2: case 3: case 4: return `${n} ${few}`;
    default: return `${n} ${many}`;
  }
}

const hands = (n: number) => plural(n, 'раздача', 'раздачи', 'раздач');
const decisions = (n: number) => plural(n, 'решение', 'решения', 'решений');

/* ================================================================== */
/* Стартовый экран                                                     */
/* ================================================================== */

interface StartProps {
  progress: Progress;
  onStart: (mode: TrainerMode, stacks: StackMode) => void;
  onProgress: () => void;
  onMistakes: () => void;
}

export function StartScreen({ progress, onStart, onProgress, onMistakes }: StartProps) {
  const [stacks, setStacks] = useState<StackMode>('standard');
  const [picking, setPicking] = useState<'none' | 'weak' | 'versus'>('none');

  const overall = averageScore(progress.decisions);

  return (
    <div className="start">
      <div className="start-head">
        <h2>Что тренируем</h2>
        {progress.decisions.length > 0 && (
          <p className="start-stats">
            Сыграно {hands(progress.hands)} · {decisions(progress.decisions.length)}
            {overall !== null && ` · средняя оценка ${overall.toFixed(1)}`}
          </p>
        )}
      </div>

      <div className="start-stacks">
        <span className="hero-picker-label">Стеки</span>
        <div className="chips">
          <button type="button" className={`btn btn-chip ${stacks === 'standard' ? 'chip-on' : ''}`}
            onClick={() => setStacks('standard')}>100 BB</button>
          <button type="button" className={`btn btn-chip ${stacks === 'realistic' ? 'chip-on' : ''}`}
            onClick={() => setStacks('realistic')}
            title="Как за реальными столами: медиана 114bb, есть короткие и глубокие">КАК В ЖИЗНИ</button>
        </div>
      </div>

      {picking === 'none' && (
        <div className="mode-grid">
          <ModeCard title="Свободная игра" hint="Без ограничения по числу раздач."
            onClick={() => onStart({ kind: 'quick' }, stacks)} primary />
          <div className="mode-card">
            <h3>Сессия</h3>
            <p>Фиксированное число раздач и разбор в конце.</p>
            <div className="mode-row">
              {[10, 25, 50].map((n) => (
                <button key={n} type="button" className="btn btn-outline"
                  onClick={() => onStart({ kind: 'session', handLimit: n }, stacks)}>{n} рук</button>
              ))}
            </div>
          </div>
          <ModeCard title="Слабое место" hint="Чаще подбрасывает нужный тип ситуаций."
            onClick={() => setPicking('weak')} />
          <ModeCard title="Против игрока" hint="Выбранный соперник всегда за столом."
            onClick={() => setPicking('versus')} />
        </div>
      )}

      {picking === 'weak' && (
        <div className="picker">
          <div className="picker-head">
            <h3>Что тренируем</h3>
            <button type="button" className="btn btn-ghost" onClick={() => setPicking('none')}>Назад</button>
          </div>
          <p className="picker-note">
            Режим чаще приводит к нужному типу решения — но не подсказывает ответ.
            В «Ставке на ривере» правильным ходом вполне может оказаться чек.
          </p>
          <div className="cat-grid">
            {ALL_CATEGORIES.map((c) => (
              <button key={c} type="button" className="cat-card"
                onClick={() => onStart({ kind: 'weak-spot', category: c }, stacks)}>
                <strong>{CATEGORY_TITLES[c]}</strong>
                <span>{CATEGORY_HINTS[c]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {picking === 'versus' && (
        <div className="picker">
          <div className="picker-head">
            <h3>Против кого</h3>
            <button type="button" className="btn btn-ghost" onClick={() => setPicking('none')}>Назад</button>
          </div>
          <p className="picker-note">
            Он всегда будет за столом, остальные четверо — случайные. Место он меняет,
            чтобы ты учился читать его из разных позиций.
          </p>
          <div className="villain-grid">
            {VILLAIN_NAMES.map((n) => (
              <button key={n} type="button" className="btn btn-outline"
                onClick={() => onStart({ kind: 'versus', villain: n }, stacks)}>{n}</button>
            ))}
          </div>
        </div>
      )}

      <div className="start-links">
        <button type="button" className="btn btn-ghost" onClick={onProgress}>Прогресс</button>
        <button type="button" className="btn btn-ghost" onClick={onMistakes}>
          Крупные ошибки{progress.mistakes.length ? ` (${progress.mistakes.length})` : ''}
        </button>
        {progress.sessions.length > 0 && (
          <span className="start-last">
            Прошлая сессия: {hands(progress.sessions[0].hands)}, оценка{' '}
            {progress.sessions[0].score.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}

function ModeCard({ title, hint, onClick, primary }: {
  title: string; hint: string; onClick: () => void; primary?: boolean;
}) {
  return (
    <button type="button" className={`mode-card mode-clickable ${primary ? 'mode-primary' : ''}`} onClick={onClick}>
      <h3>{title}</h3>
      <p>{hint}</p>
    </button>
  );
}

/* ================================================================== */
/* Итог сессии                                                         */
/* ================================================================== */

export function SummaryScreen({ totals, progress, sessionLog, onRestart, onHome, onMistakes }: {
  totals: SessionTotals;
  progress: Progress;
  sessionLog: () => SessionLog;
  onRestart: () => void;
  onHome: () => void;
  onMistakes: () => void;
}) {
  const summary = buildSessionSummary(totals.records);
  const [saved, setSaved] = useState<string | null>(null);
  const cats = ALL_CATEGORIES
    .map((c) => ({ c, t: tallyOf(totals, c) }))
    .filter((x) => x.t.total > 0);

  return (
    <div className="sheet">
      <h2>Сессия закончена</h2>

      <div className="summary-top">
        <div className="summary-main">
          <span className="panel-label">Оценка решений</span>
          <div className={`summary-score ${totals.score >= 7.5 ? 'good' : totals.score >= 5.5 ? 'warn' : 'bad'}`}>
            {totals.score.toFixed(1)}<span className="of-ten">/10</span>
          </div>
        </div>
        <div className="summary-side">
          <span className="panel-label">Результат</span>
          <div className={`summary-net ${totals.net >= 0 ? 'good' : 'bad'}`}>
            {totals.net >= 0 ? '+' : ''}{money(totals.net)}
          </div>
          <p className="summary-note">Деньги — второстепенны. Смотри на оценку слева.</p>
        </div>
      </div>

      <div className="summary-counts">
        <Count label="Раздач" value={totals.hands} />
        <Count label="Решений" value={totals.decisions} />
        <Count label="Хороших" value={totals.good} tone="good" />
        <Count label="Пограничных" value={totals.borderline} />
        <Count
          label={totals.major ? `Ошибок (крупных ${totals.major})` : 'Ошибок'}
          value={totals.mistakes}
          tone={totals.mistakes ? 'bad' : undefined}
        />
      </div>

      {summary.insights.length > 0 && (
        <div className="insights">
          <span className="panel-label">Главное</span>
          <ol>
            {summary.insights.map((i, k) => (
              <li key={k} className={`insight insight-${i.tone}`}>{i.text}</li>
            ))}
          </ol>
        </div>
      )}

      {summary.focus && (
        <div className="focus">
          <span className="panel-label">В следующий раз</span>
          <strong>{CATEGORY_TITLES[summary.focus]}</strong>
          <p>{summary.focusReason} Это рекомендация — режим сам не переключится.</p>
        </div>
      )}

      {cats.length > 0 && (
        <div className="cat-table">
          <span className="panel-label">По типам ситуаций</span>
          <table>
            <thead>
              <tr><th>Ситуация</th><th>Было</th><th>Хороших</th><th>Ошибок</th></tr>
            </thead>
            <tbody>
              {cats.map(({ c, t }) => (
                <tr key={c}>
                  <td>{CATEGORY_TITLES[c]}</td>
                  <td className="num">{t.total}</td>
                  <td className="num good">{t.good}</td>
                  <td className={`num ${t.mistakes ? 'bad' : ''}`}>{t.mistakes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fineprint">
            Тип ситуации — это контекст, а не приговор. Ошибкой решение делает только оценка.
          </p>
        </div>
      )}

      <div className="sheet-actions">
        <button type="button" className="btn btn-primary" onClick={onRestart}>Ещё раз</button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            const log = sessionLog();
            const now = Date.now();
            const name = exportFileName(log, now);
            // Только данные тренажёра: ни настроек, ни хранилища, ни чего-либо
            // ещё со страницы.
            downloadJson(name, buildExport(log, summaryInput(totals, summary, progress, log), PROFILES, now));
            setSaved(name);
          }}
        >
          ВЫГРУЗИТЬ СЕССИЮ
        </button>
        <button type="button" className="btn btn-outline" onClick={onMistakes}>Крупные ошибки</button>
        <button type="button" className="btn btn-ghost" onClick={onHome}>В меню</button>
      </div>

      {saved && (
        <p className="fineprint">
          Сохранено: <strong>{saved}</strong>. В файле — каждая раздача, каждое твоё решение,
          что видел тренер и что он посчитал. Его можно отдать на разбор кому угодно.
        </p>
      )}
    </div>
  );
}


/**
 * Данные итога для выгрузки — ровно те, что показаны на экране.
 * Ничего не пересчитывается: цифры берутся из уже готового итога.
 */
function summaryInput(
  totals: SessionTotals,
  summary: ReturnType<typeof buildSessionSummary>,
  progress: Progress,
  log: SessionLog,
) {
  const handOf = new Map<number, number>();
  for (const h of log.hands) {
    if (h.isReplay) continue;
    for (const d of h.decisions) handOf.set(d.atMs, h.handNumber);
  }

  return {
    decisionScore: Number(totals.score.toFixed(2)),
    netCents: totals.net,
    good: totals.good,
    borderline: totals.borderline,
    mistakes: totals.mistakes,
    major: totals.major,
    insights: summary.insights,
    focus: summary.focus,
    focusReason: summary.focusReason,
    categories: ALL_CATEGORIES.map((c) => {
      const t = tallyOf(totals, c);
      return { id: c, title: CATEGORY_TITLES[c], total: t.total, good: t.good, mistakes: t.mistakes };
    }).filter((c) => c.total > 0),
    // Крупные ошибки именно этой сессии: у них есть зерно раздачи из журнала.
    majorMistakes: progress.mistakes
      .filter((m) => log.hands.some((h) => !h.isReplay && h.setup.seed === m.setup.seed))
      .map((m) => ({
        handNumber: m.setup.handNumber,
        street: m.street,
        scoreValue: m.score,
        heroCards: m.heroCards.map(cardLabel),
        board: m.board.map(cardLabel),
        position: m.position,
        villain: m.villain,
        did: m.did,
        better: m.better,
      })),
  };
}

const RANK_TEXT = '23456789TJQKA';
const SUIT_TEXT = 'cdhs';
const cardLabel = (c: number) => (c < 0 ? '' : RANK_TEXT[c >> 2] + SUIT_TEXT[c & 3]);

function tallyOf(totals: SessionTotals, c: CategoryId) {
  return tally(
    totals.records.map((r) => ({ t: 0, score: r.verdict.score, c: r.categories, v: r.villain })),
    c,
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <div className="count">
      <span className="count-label">{label}</span>
      <strong className={tone ?? ''}>{value}</strong>
    </div>
  );
}

/* ================================================================== */
/* Прогресс                                                            */
/* ================================================================== */

export function ProgressScreen({ progress, onHome, onWipe }: {
  progress: Progress; onHome: () => void; onWipe: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const all = progress.decisions;
  const overall = averageScore(all);
  const first = all.length >= 200 ? averageScore(all.slice(0, 500)) : null;
  const last = all.length >= 200 ? averageScore(all.slice(-500)) : null;
  const versus = versusTable(progress);

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Прогресс</h2>
        <button type="button" className="btn btn-ghost" onClick={onHome}>Назад</button>
      </div>

      {all.length === 0 ? (
        <p className="empty">Пока ничего не сыграно. Проведи сессию — и здесь появится динамика.</p>
      ) : (
        <>
          <div className="summary-counts">
            <Count label="Раздач" value={progress.hands} />
            <Count label="Решений" value={all.length} />
            <div className="count">
              <span className="count-label">Оценка</span>
              <strong>{overall !== null ? overall.toFixed(1) : '—'}</strong>
            </div>
          </div>

          <div className="cat-table">
            <span className="panel-label">Как менялась игра</span>
            {first !== null && last !== null ? (
              <div className="delta-row">
                <div><span className="count-label">Первые 500 решений</span><strong>{first.toFixed(1)}</strong></div>
                <div className="delta-arrow">→</div>
                <div><span className="count-label">Последние 500</span>
                  <strong className={last > first ? 'good' : last < first ? 'bad' : ''}>{last.toFixed(1)}</strong></div>
              </div>
            ) : (
              <p className="fineprint">Пока недостаточно решений, чтобы говорить о динамике.</p>
            )}
          </div>

          <div className="cat-table">
            <span className="panel-label">По слабым местам</span>
            <table>
              <thead><tr><th>Ситуация</th><th>Всего</th><th>Раньше</th><th>Сейчас</th></tr></thead>
              <tbody>
                {ALL_CATEGORIES.map((c) => {
                  const t = tally(all, c);
                  const tr = trendFor(progress, c);
                  return (
                    <tr key={c}>
                      <td>{CATEGORY_TITLES[c]}</td>
                      <td className="num">{t.total}</td>
                      {tr.reliable ? (
                        <>
                          <td className="num">{Math.round(tr.early! * 100)}%</td>
                          <td className={`num ${tr.late! > tr.early! ? 'good' : tr.late! < tr.early! ? 'bad' : ''}`}>
                            {Math.round(tr.late! * 100)}%
                          </td>
                        </>
                      ) : (
                        <td className="num fineprint" colSpan={2}>
                          {t.total < MIN_FOR_TREND * 2 ? 'мало данных' : 'копится'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="fineprint">
              Динамика показывается только там, где набралось хотя бы по {MIN_FOR_TREND} ситуаций
              в начале и в конце. На меньшем это шум, а не прогресс.
            </p>
          </div>

          {versus.length > 0 && (
            <div className="cat-table">
              <span className="panel-label">Против соперников</span>
              <table>
                <thead><tr><th>Игрок</th><th>Решений</th><th>Оценка</th></tr></thead>
                <tbody>
                  {versus.map((v) => (
                    <tr key={v.name}>
                      <td>{v.name}</td>
                      <td className="num">{v.n}</td>
                      <td className="num">{v.score.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {versus.length >= 2 && (
                <p className="fineprint">
                  Лучше всего пока идёт против {versus[0].name}, тяжелее всего —
                  против {versus[versus.length - 1].name}.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="sheet-actions">
        {confirming ? (
          <>
            <span className="confirm-text">Удалить всю статистику? Отменить будет нельзя.</span>
            <button type="button" className="btn btn-outline danger" onClick={() => { onWipe(); setConfirming(false); }}>
              Да, удалить
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Отмена</button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>
            Сбросить статистику
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Крупные ошибки                                                      */
/* ================================================================== */

export function MistakesScreen({ progress, onHome, onReplay }: {
  progress: Progress;
  onHome: () => void;
  onReplay: (index: number) => void;
}) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Крупные ошибки</h2>
        <button type="button" className="btn btn-ghost" onClick={onHome}>Назад</button>
      </div>

      {progress.mistakes.length === 0 ? (
        <p className="empty">Пока пусто. Сюда попадают решения с оценкой ниже 4.</p>
      ) : (
        <div className="mistake-grid">
          {progress.mistakes.map((m, i) => (
            <div key={`${m.t}-${i}`} className="mistake-card">
              <div className="mistake-head">
                <span className="mistake-cards"><CardText cards={m.heroCards} /></span>
                <span className="mistake-score">{m.score.toFixed(1)}</span>
              </div>
              <div className="mistake-meta">
                {m.position} · против {m.villain || 'соперника'} · {streetRu(m.street)}
              </div>
              {m.board.length > 0 && <div className="mistake-board"><CardText cards={m.board} /></div>}
              <div className="mistake-did">Ты сыграл: <strong>{m.did}</strong></div>
              {m.better && <div className="mistake-better">Лучше: <strong>{m.better}</strong></div>}
              <button type="button" className="btn btn-outline btn-wide" onClick={() => onReplay(i)}>
                ПЕРЕИГРАТЬ ЭТО РЕШЕНИЕ
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function streetRu(s: string): string {
  return { preflop: 'префлоп', flop: 'флоп', turn: 'тёрн', river: 'ривер' }[s] ?? s;
}
