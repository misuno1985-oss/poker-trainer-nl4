import { useState } from 'react';
import { CardText } from './CardText';
import { money } from '../game/stacks';
import { CATEGORY_TITLES } from '../coach/categories';
import type { Candidate, WhySection } from '../coach/types';
import type { DecisionRecord } from '../app/trainer';
import type { Session } from '../app/session';
import { HERO_SEAT } from '../app/session';

/**
 * Подробный разбор закончившейся раздачи.
 *
 * Открытые карты соперников показываются ЗДЕСЬ и только здесь — после того,
 * как раздача сыграна. Тренер их не видел: каждая оценка ниже посчитана по
 * слепку, снятому до действия героя.
 */

const STREET_RU: Record<string, string> = {
  preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер', showdown: 'Вскрытие',
};

const KIND_LABEL: Record<WhySection['kind'], string> = {
  data: 'из базы', model: 'вывод модели', math: 'расчёт',
};

function actionText(k: string, total?: number): string {
  switch (k) {
    case 'fold': return 'ПАС';
    case 'check': return 'ЧЕК';
    case 'call': return 'КОЛЛ';
    case 'bet': return `СТАВКА ${money(total ?? 0)}`;
    case 'raise': return `РЕЙЗ ДО ${money(total ?? 0)}`;
    default: return k;
  }
}

const candidateText = (c: Candidate) => actionText(c.kind, c.total);

interface Props {
  session: Session;
  reviews: DecisionRecord[];
  onClose: () => void;
  onTryAnother: (decisionIndex: number) => void;
}

export function HandAnalysis({ session, reviews, onClose, onTryAnother }: Props) {
  const state = session.state;
  const result = state.result;
  const heroNet = result ? (result.net[HERO_SEAT] ?? 0) : 0;
  const shown = state.players.filter((p) => p.seat !== HERO_SEAT && !p.folded);

  return (
    <div className="analysis-overlay" role="dialog" aria-label="Разбор раздачи">
      <div className="analysis">
        <div className="analysis-head">
          <div>
            <span className="panel-label">Разбор раздачи {session.handNumber}</span>
            <h2>
              <CardText cards={state.players[HERO_SEAT].cards} />
              {state.board.length > 0 && (
                <span className="analysis-board"> · <CardText cards={state.board} /></span>
              )}
            </h2>
          </div>
          <div className="analysis-net">
            <span className={heroNet >= 0 ? 'good' : 'bad'}>
              {heroNet >= 0 ? '+' : ''}{money(heroNet)}
            </span>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Закрыть</button>
          </div>
        </div>

        <div className="analysis-cards">
          <span className="panel-label">Что было у соперников</span>
          {shown.length === 0 ? (
            <p className="fineprint">До вскрытия не дошло — никто не открылся.</p>
          ) : (
            <div className="reveal-row">
              {shown.map((p) => (
                <div key={p.seat} className="reveal">
                  <span className="reveal-name">{p.name}</span>
                  <span className="reveal-cards"><CardText cards={p.cards} /></span>
                </div>
              ))}
            </div>
          )}
          <p className="fineprint">
            Эти карты показаны только сейчас. Оценки ниже считались без них.
          </p>
        </div>

        {reviews.length === 0 ? (
          <p className="empty">В этой раздаче ты не принимал решений — блайнды сыграли сами.</p>
        ) : (
          <ol className="decision-list">
            {reviews.map((r, i) => (
              <DecisionBlock key={i} record={r} index={i} onTryAnother={onTryAnother} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function DecisionBlock({ record, index, onTryAnother }: {
  record: DecisionRecord; index: number; onTryAnother: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const v = record.verdict;
  const tone = v.score >= 8 ? 'good' : v.score >= 5.5 ? 'mid' : 'bad';
  const alternatives = v.ranked.filter((c) => c !== v.chosen).slice(0, 4);

  return (
    <li className="decision">
      <div className="decision-head">
        <div>
          <span className="decision-street">{STREET_RU[record.street] ?? record.street}</span>
          <strong className="decision-action">{actionText(record.action.kind, record.action.total)}</strong>
          {record.board.length > 0 && (
            <span className="decision-board"><CardText cards={record.board} /></span>
          )}
        </div>
        <span className={`coach-score coach-${tone}`}>{v.score}/10</span>
      </div>

      <div className="decision-meta">
        Банк {money(record.pot)}
        {record.villain && ` · главный соперник ${record.villain}`}
        {` · твоя доля против его диапазона ${pct(v.chosen.detail.equity)}`}
        {v.sizingScore !== null && ` · выбор ${v.actionScore}, размер ${v.sizingScore}`}
      </div>

      {v.brief.good && <p className="coach-good">{v.brief.good}</p>}
      {v.brief.bad && <p className="coach-bad">{v.brief.bad}</p>}
      {v.brief.better && (
        <p className="coach-better"><span className="coach-better-label">Лучше</span> {v.brief.better}</p>
      )}
      {v.brief.picture && <p className="coach-picture">{v.brief.picture}</p>}

      {alternatives.length > 0 && (
        <table className="alt-table">
          {/* Доля против диапазона у всех вариантов одна и та же — она вынесена
              выше. Здесь различаются именно ожидание и то, как часто соперник
              на этот ход сбросит. */}
          <thead><tr><th>Вариант</th><th>Ожидание</th><th>Он сбросит</th></tr></thead>
          <tbody>
            <tr className="alt-chosen">
              <td>{candidateText(v.chosen)} — так и сыграл</td>
              <td className="num">{signed(v.chosen.ev)}</td>
              <td className="num">{foldPct(v.chosen)}</td>
            </tr>
            {alternatives.map((c, i) => (
              <tr key={i}>
                <td>{candidateText(c)}</td>
                <td className="num">{signed(c.ev)}</td>
                <td className="num">{foldPct(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {record.categories.length > 0 && (
        <div className="tag-row">
          {record.categories.map((c) => <span key={c} className="tag">{CATEGORY_TITLES[c]}</span>)}
        </div>
      )}

      <div className="decision-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen((x) => !x)}>
          {open ? 'Свернуть' : 'Почему?'}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => onTryAnother(index)}>
          Сыграть иначе отсюда
        </button>
      </div>

      {open && (
        <div className="why">
          {v.why.map((section, i) => (
            <section key={i} className={`why-section why-${section.kind}`}>
              <h4>{section.title}<span className="why-kind">{KIND_LABEL[section.kind]}</span></h4>
              <ul>{section.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
            </section>
          ))}
        </div>
      )}
    </li>
  );
}

const signed = (cents: number) => `${cents >= 0 ? '+' : '−'}${money(Math.abs(cents))}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Как часто соперник сбросит на этот ход. Для паса и чека вопрос не стоит. */
function foldPct(c: Candidate): string {
  if (c.kind === 'fold' || c.kind === 'check' || c.kind === 'call') return '—';
  return c.detail.foldEquity === undefined ? '—' : pct(c.detail.foldEquity);
}
