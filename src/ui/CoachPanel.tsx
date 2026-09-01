import { useState } from 'react';
import type { DecisionRecord } from '../app/trainer';
import type { WhySection } from '../coach/types';

/**
 * Панель тренера. Сначала коротко — что хорошо, что плохо, что лучше.
 * Подробности только по кнопке «Почему?», и там факты из базы отделены от
 * выводов модели: пользователь должен видеть, где кончается измеренное.
 */

interface Props {
  review: DecisionRecord | null;
  handReviews: DecisionRecord[];
}

const STREET_RU: Record<string, string> = {
  preflop: 'префлоп',
  flop: 'флоп',
  turn: 'тёрн',
  river: 'ривер',
  showdown: 'вскрытие',
};

const KIND_LABEL: Record<WhySection['kind'], string> = {
  data: 'из базы',
  model: 'вывод модели',
  math: 'расчёт',
};

export function CoachPanel({ review, handReviews }: Props) {
  const [why, setWhy] = useState(false);

  if (!review) {
    return (
      <div className="coach-card">
        <span className="panel-label">Тренер</span>
        <p className="coach-idle">
          Сделай ход — и здесь появится разбор. Подсказок заранее не будет: сначала
          решение, потом объяснение.
        </p>
      </div>
    );
  }

  const v = review.verdict;
  const tone = v.score >= 8 ? 'good' : v.score >= 5.5 ? 'mid' : 'bad';

  return (
    <div className="coach-card">
      <div className="coach-head">
        <span className="panel-label">Тренер · {STREET_RU[review.street] ?? review.street}</span>
        <span className={`coach-score coach-${tone}`}>{v.score}/10</span>
      </div>

      {v.sizingScore !== null && (
        <div className="coach-split">
          <span>выбор {v.actionScore}</span>
          <span>размер {v.sizingScore}</span>
        </div>
      )}

      {v.brief.good && <p className="coach-good">{v.brief.good}</p>}
      {v.brief.bad && <p className="coach-bad">{v.brief.bad}</p>}
      {v.brief.better && (
        <p className="coach-better">
          <span className="coach-better-label">Лучше</span> {v.brief.better}
        </p>
      )}

      {v.brief.picture && <p className="coach-picture">{v.brief.picture}</p>}

      {v.leakNotes.map((n) => (
        <div key={n.id} className={`leak-note ${n.triggered ? '' : 'leak-quiet'}`}>
          <strong>{n.title}</strong>
          <p>{n.text}</p>
        </div>
      ))}

      <button type="button" className="btn btn-outline btn-wide why-btn" onClick={() => setWhy((v2) => !v2)}>
        {why ? 'СВЕРНУТЬ' : 'ПОЧЕМУ?'}
      </button>

      {why && (
        <div className="why">
          {v.why.map((section, i) => (
            <section key={i} className={`why-section why-${section.kind}`}>
              <h4>
                {section.title}
                <span className="why-kind">{KIND_LABEL[section.kind]}</span>
              </h4>
              <ul>
                {section.lines.map((line, j) => (
                  <li key={j}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {handReviews.length > 1 && (
        <div className="hand-scores">
          <span className="panel-label">Эта раздача</span>
          <div className="score-row">
            {handReviews.map((r, i) => (
              <span key={i} className={`score-chip chip-${r.verdict.score >= 8 ? 'good' : r.verdict.score >= 5.5 ? 'mid' : 'bad'}`}>
                {STREET_RU[r.street]?.slice(0, 4) ?? r.street} {r.verdict.score}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
