import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { act } from '../src/game/hand';
import type { ActionRequest } from '../src/game/betting';
import { captureSnapshot, evaluateDecision } from '../src/coach/index';
import type { Session } from '../src/app/session';
import { makeRng } from '../src/game/rng';
import type { HandState } from '../src/game/types';
import { PROFILE_BY_NAME } from '../src/bots/profiles';
import { cards, setup } from './helpers';

/**
 * Главная проверка Этапа D: тренер не должен видеть закрытых карт.
 *
 * Берём одно и то же решение, меняем ТОЛЬКО скрытые карты соперников и
 * требуем побайтово одинаковый вердикт. Если он меняется — значит где-то
 * протекла информация, которой герой знать не мог.
 */

function fakeSession(state: HandState): Session {
  return {
    config: {
      heroName: state.players[0].name,
      stackMode: 'standard',
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      seed: 1,
    },
    handNumber: 1,
    button: state.button,
    state,
    seatProfiles: state.players.map((p, i) =>
      i === 0 ? null : (PROFILE_BY_NAME[p.name] ?? PROFILE_BY_NAME['DuhaMetelkin']),
    ),
    stacks: state.players.map((p) => p.startingStack),
    bankroll: 0,
    rng: makeRng(1),
    handSeed: 1,
    handRng: makeRng(1),
    awaitingNext: false,
  };
}

interface Scenario {
  /** Карты соперников — именно их мы будем подменять. */
  villainCards: Record<number, string>;
  heroCards: string;
  board: string;
  stacks: number[];
  names: string[];
  /** Действия до решения героя. */
  script: ActionRequest[];
}

function buildDecision(spec: Scenario) {
  const state = setup({
    count: 6,
    button: 0,
    stacks: spec.stacks,
    holes: { 0: spec.heroCards, ...spec.villainCards },
    board: spec.board,
  });
  state.players.forEach((p, i) => {
    p.name = spec.names[i];
  });
  for (const a of spec.script) act(state, a);
  return state;
}

/** Место героя — 0; всем остальным раздаём указанные карты. */
const BASE: Scenario = {
  heroCards: 'AhKd',
  villainCards: { 1: '7c2d', 2: '9s8s', 3: 'QhJh', 4: '5c5d', 5: 'Tc4h' },
  board: 'Ac7h2s9d3c',
  stacks: [400, 400, 400, 400, 400, 400],
  names: ['withorwithout', 'MASELL', 'PokerMind', 'griffie', 'Lucky9090', 'RiverShark'],
  // Все сбрасывают до баттона (герой), SB сбрасывает, BB (PokerMind) остаётся.
  script: [
    { kind: 'fold' }, // UTG seat3 griffie
    { kind: 'fold' }, // HJ seat4 Lucky9090
    { kind: 'fold' }, // CO seat5 RiverShark
  ],
};

describe('тренер не видит закрытых карт', () => {
  it('даёт тот же вердикт при других картах соперника', () => {
    const variants = [
      { 1: '7c2d', 2: '9s8s', 3: 'QhJh', 4: '5c5d', 5: 'Tc4h' },
      { 1: 'KsKc', 2: 'AsAd', 3: '6h6d', 4: 'JdTd', 5: '4s3s' },
      { 1: '2h3h', 2: 'QsQd', 3: 'Ts9c', 4: '8h7d', 5: 'Jc6c' },
    ];

    const verdicts = variants.map((villainCards) => {
      const state = buildDecision({ ...BASE, villainCards });
      const snap = captureSnapshot(fakeSession(state));
      expect(snap).not.toBeNull();
      return evaluateDecision(snap!, { kind: 'call' });
    });

    // Оценка, лучший вариант и весь текст обязаны совпасть.
    const first = JSON.stringify(verdicts[0]);
    for (let i = 1; i < verdicts.length; i++) {
      expect(JSON.stringify(verdicts[i]), `вариант ${i}`).toBe(first);
    }
  });

  it('не кладёт карты соперников в снимок', () => {
    const state = buildDecision(BASE);
    const snap = captureSnapshot(fakeSession(state))!;
    const serialized = JSON.stringify(snap);

    // Карты соперников не должны встречаться в снимке ни в каком виде.
    const heroCards = new Set(snap.heroCards);
    const boardCards = new Set(snap.board);
    for (const p of state.players.slice(1)) {
      for (const c of p.cards) {
        if (heroCards.has(c) || boardCards.has(c)) continue;
        const asField = new RegExp(`"cards":\\s*\\[[^\\]]*\\b${c}\\b`);
        expect(asField.test(serialized), `карта ${c} утекла в снимок`).toBe(false);
      }
    }
    // И вообще ни одного поля с картами у соперников.
    for (const opp of snap.opponents) {
      expect(Object.keys(opp)).not.toContain('cards');
      expect(Object.keys(opp)).not.toContain('hole');
    }
  });

  it('не подсматривает и при доигрывании раздачи', () => {
    // Флоп с крупным банком: здесь тренер запускает Монте-Карло. Карты
    // соперников для доигрывания должны семплироваться из диапазона, а не
    // браться настоящие.
    const flopScenario: Scenario = {
      ...BASE,
      board: 'Ac7h2s',
      script: [
        { kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' },
        { kind: 'raise', total: 30 }, { kind: 'fold' }, { kind: 'call' },
        { kind: 'bet', total: 40 },
      ],
    };
    const variants = [
      { 1: '7c2d', 2: '9s8s', 3: 'QhJh', 4: '5c5d', 5: 'Tc4h' },
      { 1: 'KsKc', 2: 'AsAd', 3: '6h6d', 4: 'JdTd', 5: '4s3s' },
      { 1: '2h3h', 2: 'QsQd', 3: 'Ts9c', 4: '8h7d', 5: 'Jc6c' },
    ];
    const verdicts = variants.map((villainCards) => {
      const state = buildDecision({ ...flopScenario, villainCards });
      const snap = captureSnapshot(fakeSession(state))!;
      return evaluateDecision(snap, { kind: 'call' });
    });
    // Доигрывание должно было включиться — иначе тест ничего не проверяет.
    expect(verdicts[0].ranked.some((c) => c.detail.rollout)).toBe(true);
    const first = JSON.stringify(verdicts[0]);
    for (let i = 1; i < verdicts.length; i++) {
      expect(JSON.stringify(verdicts[i]), `вариант ${i}`).toBe(first);
    }
  });

  it('меняет вердикт, когда меняются КАРТЫ ГЕРОЯ — иначе он ничего не считает', () => {
    const strong = buildDecision({ ...BASE, heroCards: 'AhKd' });
    const weak = buildDecision({
      ...BASE,
      heroCards: '5h4d',
      villainCards: { 1: '7c2d', 2: '9s8s', 3: 'QhJh', 4: 'AcAd', 5: 'Tc4h' },
      board: 'As7h2s9d3c',
    });
    const a = evaluateDecision(captureSnapshot(fakeSession(strong))!, { kind: 'call' });
    const b = evaluateDecision(captureSnapshot(fakeSession(weak))!, { kind: 'call' });
    expect(a.score).not.toBe(b.score);
  });
});

describe('архитектурная граница', () => {
  const dir = new URL('../src/coach/', import.meta.url);
  const files = readdirSync(dir).filter((f: string) => f.endsWith('.ts'));

  it('только snapshot.ts и rollout.ts знают про движок раздачи', () => {
    // rollout.ts обязан уметь доигрывать раздачу, поэтому движок ему нужен.
    // Защита здесь не в запрете импорта, а в тесте подмены скрытых карт ниже:
    // карты соперников он получает только семплированием из диапазона.
    for (const file of files) {
      if (file === 'snapshot.ts' || file === 'rollout.ts') continue;
      const src = readFileSync(new URL(file, dir), 'utf8');
      const imports = [...src.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/gm)];
      for (const [, names, from] of imports) {
        if (from.includes('app/session')) {
          throw new Error(`${file} импортирует сессию: ${from}`);
        }
        // Из движка допустимы только типы, и только безопасные.
        if (from.includes('game/')) {
          const bad = names
            .split(',')
            .map((n: string) => n.trim().replace(/^type\s+/, ''))
            .filter((n: string) => n === 'HandState' || n === 'Player');
          expect(bad, `${file} тянет состояние раздачи`).toEqual([]);
        }
      }
    }
  });

  it('в типе снимка нет поля для карт соперника', () => {
    const src = readFileSync(new URL('types.ts', dir), 'utf8');
    const block = src.slice(src.indexOf('interface OpponentView'), src.indexOf('interface DecisionSnapshot'));
    expect(block).not.toMatch(/cards/);
    expect(block).not.toMatch(/hole/);
  });
});

describe('снимок фиксирует момент решения', () => {
  it('не меняется после того, как герой сходил', () => {
    const state = buildDecision(BASE);
    const snap = captureSnapshot(fakeSession(state))!;
    const before = JSON.stringify(snap);
    act(state, { kind: 'call' }); // герой
    act(state, { kind: 'call' }); // малый блайнд доложил
    act(state, { kind: 'check' }); // большой блайнд
    expect(JSON.stringify(snap)).toBe(before);
  });

  it('видит карты героя и борд', () => {
    const state = buildDecision(BASE);
    const snap = captureSnapshot(fakeSession(state))!;
    expect(snap.heroCards).toEqual(cards('AhKd'));
    expect(snap.opponents.length).toBeGreaterThan(0);
  });
});
