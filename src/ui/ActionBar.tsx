import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionRequest } from '../game/betting';
import type { LegalActions } from '../game/types';
import { money } from '../game/stacks';

interface Props {
  legal: LegalActions | null;
  /**
   * Меняется ровно тогда, когда наступает НОВОЕ решение героя. Нужен потому,
   * что `legal` пересоздаётся на каждом рендере, и сброс панели по его
   * идентичности закрывал бы её сразу после открытия.
   */
  decisionKey: string;
  /** Весь банк, включая ставки текущей улицы. */
  pot: number;
  bigBlind: number;
  preflop: boolean;
  onAct: (request: ActionRequest) => void;
  disabled: boolean;
}

const POT_FRACTIONS: Array<[string, number]> = [
  ['1/3', 1 / 3],
  ['1/2', 0.5],
  ['2/3', 2 / 3],
  ['3/4', 0.75],
  ['POT', 1],
];

const PREFLOP_BB = [2, 2.5, 3, 4];

export function ActionBar({ legal, decisionKey, pot, bigBlind, preflop, onAct, disabled }: Props) {
  const canAggress = !!legal && (legal.canBet || legal.canRaise);
  const [sizing, setSizing] = useState(false);
  const [amount, setAmount] = useState(0);

  const bounds = useMemo(() => {
    if (!legal || !canAggress) return null;
    const min = legal.canBet ? legal.minBetTotal : legal.minRaiseTotal;
    const max = legal.allInTotal;
    return { min, max };
    // Пересчитываем по значениям, а не по ссылке на legal.
  }, [canAggress, legal?.canBet, legal?.minBetTotal, legal?.minRaiseTotal, legal?.allInTotal]);

  // Свежие значения для эффекта, который зависит только от decisionKey.
  const boundsRef = useRef(bounds);
  const legalRef = useRef(legal);
  const potRef = useRef(pot);
  const preflopRef = useRef(preflop);
  const bbRef = useRef(bigBlind);
  boundsRef.current = bounds;
  legalRef.current = legal;
  potRef.current = pot;
  preflopRef.current = preflop;
  bbRef.current = bigBlind;

  // Новое решение — закрываем панель размера и подставляем разумную сумму.
  useEffect(() => {
    setSizing(false);
    if (boundsRef.current && legalRef.current) {
      setAmount(defaultSize(boundsRef.current, potRef.current, legalRef.current, preflopRef.current, bbRef.current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionKey]);

  if (!legal) return null;

  const kind: 'bet' | 'raise' = legal.canBet ? 'bet' : 'raise';

  const fire = (total: number) => {
    const t = Math.round(Math.max(bounds!.min, Math.min(bounds!.max, total)));
    onAct({ kind, total: t });
    setSizing(false);
  };

  return (
    <div className={`actionbar ${disabled ? 'actionbar-off' : ''}`}>
      {sizing && bounds && (
        <div className="sizer">
          <div className="sizer-chips">
            {preflop
              ? PREFLOP_BB.map((bb) => {
                  const total = Math.round(bb * bigBlind);
                  const ok = total >= bounds.min && total <= bounds.max;
                  return (
                    <button
                      key={bb}
                      type="button"
                      className="btn btn-chip"
                      disabled={!ok}
                      onClick={() => fire(total)}
                    >
                      {bb} BB
                    </button>
                  );
                })
              : POT_FRACTIONS.map(([label, f]) => {
                  const total = potRaiseTotal(legal, pot, f);
                  const ok = total >= bounds.min && total <= bounds.max;
                  return (
                    <button
                      key={label}
                      type="button"
                      className="btn btn-chip"
                      disabled={!ok}
                      onClick={() => fire(total)}
                      title={money(total)}
                    >
                      {label}
                    </button>
                  );
                })}
            <button type="button" className="btn btn-chip chip-allin" onClick={() => fire(bounds.max)}>
              ALL-IN
            </button>
          </div>

          <div className="sizer-row">
            <input
              className="sizer-slider"
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Размер ставки"
            />
            <input
              className="sizer-input"
              type="number"
              min={bounds.min / 100}
              max={bounds.max / 100}
              step={0.01}
              value={(amount / 100).toFixed(2)}
              onChange={(e) => setAmount(Math.round(Number(e.target.value) * 100))}
              aria-label="Сумма в долларах"
            />
            <button type="button" className="btn btn-primary btn-wide" onClick={() => fire(amount)}>
              {kind === 'bet' ? 'BET' : 'RAISE TO'} {money(amount)}
            </button>
          </div>
          <p className="sizer-hint">
            {legal.toCall > 0
              ? `сверх колла ${money(amount - legal.streetCommit - legal.toCall)} · ` +
                `банк станет ${money(pot + (amount - legal.streetCommit))}`
              : pot > 0 && `${Math.round((amount / pot) * 100)}% банка · ` +
                `банк станет ${money(pot + amount - legal.streetCommit)}`}
            {' · минимум '}
            {money(bounds.min)}
          </p>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn btn-outline" onClick={() => onAct({ kind: 'fold' })}>
          FOLD
        </button>

        {legal.canCheck && (
          <button type="button" className="btn btn-outline" onClick={() => onAct({ kind: 'check' })}>
            CHECK
          </button>
        )}

        {legal.canCall && (
          <button type="button" className="btn btn-outline" onClick={() => onAct({ kind: 'call' })}>
            CALL {money(legal.callAmount)}
          </button>
        )}

        {canAggress && (
          <button
            type="button"
            className={`btn ${sizing ? 'btn-outline' : 'btn-primary'}`}
            onClick={() => setSizing((v) => !v)}
          >
            {sizing ? 'ОТМЕНА' : kind === 'bet' ? 'BET' : 'RAISE'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Ставка в долях банка. Для рейза считается «как если бы я сначала уравнял»:
 * уравниваю `toCall`, банк становится `pot + toCall`, и от него беру долю.
 * Одна формула работает и для ставки (там `toCall` равен нулю).
 */
function potRaiseTotal(legal: LegalActions, pot: number, fraction: number): number {
  const potAfterCall = pot + legal.toCall;
  return Math.round(legal.streetCommit + legal.toCall + fraction * potAfterCall);
}

/**
 * Разумный размер по умолчанию — просто чтобы слайдер не стоял на минимуме.
 *
 * До флопа: открытие в 3 больших блайнда плюс по одному за каждого лимпера,
 * а против чужого повышения — примерно втрое от него. После флопа — около
 * двух третей банка.
 */
function defaultSize(
  bounds: { min: number; max: number },
  pot: number,
  legal: LegalActions,
  preflop: boolean,
  bigBlind: number,
): number {
  let want: number;
  if (preflop) {
    const currentBet = legal.streetCommit + legal.toCall;
    if (currentBet <= bigBlind) {
      // Лишние деньги в банке сверх блайндов — это лимперы: за каждого +1bb.
      const extra = Math.max(0, pot - 1.5 * bigBlind - legal.streetCommit);
      want = Math.round(3 * bigBlind + extra);
    } else {
      want = Math.round(currentBet * 3);
    }
  } else {
    want = potRaiseTotal(legal, pot, 0.65);
  }
  return Math.max(bounds.min, Math.min(bounds.max, want));
}
