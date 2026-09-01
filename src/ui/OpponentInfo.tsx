import { PROFILE_BY_NAME, RELIABLE_SAMPLE, type BotProfile } from '../bots/profiles';

/**
 * Что известно про соперника. Не HUD для регуляра: человеческим языком, и с
 * честной пометкой, где данных мало.
 *
 * Правило из docs/coach-rules.md: чем меньше выборка, тем меньше конкретных
 * процентов и тем больше «по его игре видно, что...».
 */

interface Props {
  name: string | null;
  onClose: () => void;
}

export function OpponentInfo({ name, onClose }: Props) {
  if (!name) return null;
  const p = PROFILE_BY_NAME[name];
  if (!p) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{p.name}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <p className="info-lead">{describe(p)}</p>

        <h4>Что видно по его игре</h4>
        <ul className="info-list">
          {bullets(p).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>

        <p className="info-source">
          Основано на {p.hands}{' '}
          {plural(p.hands, 'раздаче', 'раздачах', 'раздачах')} из реальной базы.
          {p.hands < 300 && ' Выборка небольшая — считай это общим впечатлением, а не точной цифрой.'}
        </p>
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function describe(p: BotProfile): string {
  const hands = Math.round(p.vpip * 100);
  const raises = Math.round(p.pfr * 100);
  const style =
    p.archetype === 'tight-aggressive'
      ? 'Крепкий регуляр.'
      : p.archetype === 'loose-aggressive'
        ? 'Играет много рук и при этом агрессивно.'
        : p.archetype === 'tight-passive'
          ? 'Осторожный, но пассивный игрок.'
          : 'Играет очень много рук и почти всегда пассивно.';
  return `${style} Заходит примерно в ${hands} рук из 100, из них повышает до флопа примерно в ${raises}.`;
}

function bullets(p: BotProfile): string[] {
  const out: string[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // --- вход в раздачу
  if (p.limp > 0.25) {
    out.push(
      `Очень часто просто уравнивает блайнд вместо повышения (${pct(p.limp)} случаев). ` +
        'Это значит, что его диапазон почти не содержит по-настоящему сильных рук.',
    );
  } else if (p.limp < 0.03) {
    out.push('Почти никогда не входит коллом: если играет руку, то повышает.');
  }

  // --- 3-бет
  if (p.samples.threeBet >= RELIABLE_SAMPLE) {
    if (p.threeBet > 0.1) {
      out.push(
        `Повышает чужое повышение довольно часто (${pct(p.threeBet)}). ` +
          'Один его 3-бет ещё не означает AA или KK.',
      );
    } else if (p.threeBet < 0.04) {
      out.push(
        `Повышает чужое повышение крайне редко (${pct(p.threeBet)}). ` +
          'Если он это сделал — относись серьёзно.',
      );
    }
  }

  // --- защита блайндов и колл
  if (p.defendCall > 0.4) {
    out.push('Из блайндов почти никогда не выбрасывает: платит и смотрит флоп.');
  }

  // --- постфлоп
  const f = p.flop;
  if (p.samples.flops >= 40) {
    if (f.betFirst < 0.15) {
      out.push(
        `Сам почти не начинает торговлю на флопе — ставит первым лишь в ${pct(f.betFirst)} случаев. ` +
          'Против него можно ставить чаще обычного.',
      );
    } else if (f.betFirst > 0.45) {
      out.push(`Ставит на флопе очень охотно (${pct(f.betFirst)} случаев), даже без готовой руки.`);
    }
    if (f.foldVsBet > 0.62) {
      out.push(`Часто выбрасывает на первую же ставку (${pct(f.foldVsBet)}).`);
    } else if (f.foldVsBet < 0.45) {
      out.push(`Липучий: на флопе выбрасывает всего ${pct(f.foldVsBet)} — блефовать против него дорого.`);
    }
  }

  // --- ривер: самое важное для чтения
  const r = p.river;
  if (p.samples.riverVsBet >= 20) {
    if (r.raiseVsBet > 0.12) {
      out.push('На ривере способен повысить чужую ставку — не только с монстром.');
    } else if (r.raiseVsBet < 0.05) {
      out.push(
        'На ривере почти никогда не повышает чужую ставку. Если всё же повысил — ' +
          'это очень сильный сигнал.',
      );
    }
  } else {
    out.push(
      'Про его игру на ривере данных мало: в базе таких ситуаций набралось единицы. ' +
        'Опирайся на его общий тип, а не на точные проценты.',
    );
  }

  if (p.wtsd > 0.42) {
    out.push('Любит доходить до вскрытия: с ним стоит чаще ставить на оплату и реже блефовать.');
  }

  return out;
}
