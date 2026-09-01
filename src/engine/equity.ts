/**
 * Equity engines: exact enumeration and Monte Carlo simulation.
 *
 * Both engines share the same rules:
 *  - every player is represented by the list of *physical* combos they can hold;
 *  - one physical card can never be in two places at once (players + board);
 *  - at showdown the pot is split evenly between all players tied for best hand,
 *    so a three-way chop gives each winner exactly 1/3.
 */

import { NUM_CARDS, remainingDeck, type Card } from './cards';
import { evaluate7 } from './evaluator';

export interface PlayerInput {
  id: string;
  /** Flat combo list: [c1, c2, c1, c2, ...]. One entry pair per possible hand. */
  combos: Uint8Array;
}

export interface EquityInput {
  players: PlayerInput[];
  board: Card[];
}

export interface PlayerEquity {
  id: string;
  win: number;
  tie: number;
  lose: number;
  equity: number;
}

export type EquityMode = 'exact' | 'monte-carlo';

export interface EquityResult {
  players: PlayerEquity[];
  iterations: number;
  mode: EquityMode;
  /** Iterations skipped because no collision-free deal could be found. */
  impossible: boolean;
}

export const DEFAULT_EXACT_LIMIT = 2_000_000;
export const DEFAULT_SIMULATIONS = 100_000;

/** All two-card combos available from the deck once `dead` cards are removed. */
export function allCombosFrom(dead: Iterable<Card>): Uint8Array {
  const deck = remainingDeck(dead);
  const out = new Uint8Array((deck.length * (deck.length - 1)) / 2 * 2);
  let k = 0;
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      out[k++] = deck[i];
      out[k++] = deck[j];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Shared accumulation                                                 */
/* ------------------------------------------------------------------ */

class Tally {
  readonly n: number;
  readonly wins: Float64Array;
  readonly ties: Float64Array;
  readonly equity: Float64Array;
  iterations = 0;

  constructor(n: number) {
    this.n = n;
    this.wins = new Float64Array(n);
    this.ties = new Float64Array(n);
    this.equity = new Float64Array(n);
  }

  add(values: number[]) {
    const n = this.n;
    let best = -1;
    let winners = 0;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v > best) {
        best = v;
        winners = 1;
      } else if (v === best) {
        winners++;
      }
    }
    const share = 1 / winners;
    for (let i = 0; i < n; i++) {
      if (values[i] === best) {
        this.equity[i] += share;
        if (winners === 1) this.wins[i] += 1;
        else this.ties[i] += 1;
      }
    }
    this.iterations++;
  }

  result(ids: string[], mode: EquityMode): EquityResult {
    const it = this.iterations;
    const players: PlayerEquity[] = ids.map((id, i) => {
      const win = it ? this.wins[i] / it : 0;
      const tie = it ? this.ties[i] / it : 0;
      return {
        id,
        win,
        tie,
        lose: it ? Math.max(0, 1 - win - tie) : 0,
        equity: it ? this.equity[i] / it : 0,
      };
    });
    return { players, iterations: it, mode, impossible: it === 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Work estimation                                                     */
/* ------------------------------------------------------------------ */

function nChooseK(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/** Upper bound on the number of showdowns a full enumeration would evaluate. */
export function estimateExactWork(input: EquityInput): number {
  let assignments = 1;
  for (const p of input.players) {
    const c = p.combos.length / 2;
    if (c === 0) return 0;
    assignments *= c;
    if (assignments > 1e12) return Infinity;
  }
  const knownCards = input.board.length + input.players.length * 2;
  const missing = 5 - input.board.length;
  const runouts = nChooseK(NUM_CARDS - knownCards, missing);
  const work = assignments * runouts;
  return Number.isFinite(work) ? work : Infinity;
}

/* ------------------------------------------------------------------ */
/* Exact enumeration                                                   */
/* ------------------------------------------------------------------ */

export function computeExact(input: EquityInput): EquityResult {
  const n = input.players.length;
  const tally = new Tally(n);
  const used = new Uint8Array(NUM_CARDS);
  for (const c of input.board) used[c] = 1;

  const hole = new Int32Array(n * 2);
  const board = new Int32Array(5);
  for (let i = 0; i < input.board.length; i++) board[i] = input.board[i];
  const values = new Array<number>(n).fill(0);
  const missing = 5 - input.board.length;

  const showdown = () => {
    for (let i = 0; i < n; i++) {
      values[i] = evaluate7(
        hole[i * 2], hole[i * 2 + 1],
        board[0], board[1], board[2], board[3], board[4],
      );
    }
    tally.add(values);
  };

  const dealBoard = (slot: number, startCard: number) => {
    if (slot === input.board.length + missing) {
      showdown();
      return;
    }
    for (let c = startCard; c < NUM_CARDS; c++) {
      if (used[c]) continue;
      used[c] = 1;
      board[slot] = c;
      dealBoard(slot + 1, c + 1);
      used[c] = 0;
    }
  };

  const assign = (playerIdx: number) => {
    if (playerIdx === n) {
      dealBoard(input.board.length, 0);
      return;
    }
    const combos = input.players[playerIdx].combos;
    for (let k = 0; k < combos.length; k += 2) {
      const a = combos[k];
      const b = combos[k + 1];
      if (used[a] || used[b]) continue;
      used[a] = 1;
      used[b] = 1;
      hole[playerIdx * 2] = a;
      hole[playerIdx * 2 + 1] = b;
      assign(playerIdx + 1);
      used[a] = 0;
      used[b] = 0;
    }
  };

  assign(0);
  return tally.result(input.players.map((p) => p.id), 'exact');
}

/* ------------------------------------------------------------------ */
/* Monte Carlo                                                         */
/* ------------------------------------------------------------------ */

/** mulberry32 — small, fast, deterministic when seeded. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MonteCarloRunner {
  private readonly input: EquityInput;
  private readonly tally: Tally;
  private readonly used = new Uint8Array(NUM_CARDS);
  private readonly baseUsed = new Uint8Array(NUM_CARDS);
  private readonly board = new Int32Array(5);
  private readonly hole: Int32Array;
  private readonly values: number[];
  private readonly missing: number;
  private readonly rng: () => number;
  private failures = 0;

  constructor(input: EquityInput, seed = (Math.random() * 2 ** 32) >>> 0) {
    this.input = input;
    const n = input.players.length;
    this.tally = new Tally(n);
    this.hole = new Int32Array(n * 2);
    this.values = new Array<number>(n).fill(0);
    this.missing = 5 - input.board.length;
    this.rng = makeRng(seed);
    for (const c of input.board) this.baseUsed[c] = 1;
    for (let i = 0; i < input.board.length; i++) this.board[i] = input.board[i];
  }

  get iterations(): number {
    return this.tally.iterations;
  }

  /** True when no legal deal could be produced at all (contradictory input). */
  get stuck(): boolean {
    return this.tally.iterations === 0 && this.failures > 0;
  }

  run(iterations: number): void {
    const { input, used, baseUsed, board, hole, values, rng } = this;
    const n = input.players.length;
    const boardLen = input.board.length;
    const missing = this.missing;

    for (let iter = 0; iter < iterations; iter++) {
      // Whole-deal rejection sampling keeps the joint distribution of the
      // players' hands uniform over all collision-free assignments. Sampling
      // player by player "conditionally" would quietly bias overlapping ranges.
      let dealt = false;
      for (let attempt = 0; attempt < 200 && !dealt; attempt++) {
        used.set(baseUsed);
        let ok = true;
        for (let p = 0; p < n; p++) {
          const combos = input.players[p].combos;
          const count = combos.length >> 1;
          if (count === 0) {
            ok = false;
            break;
          }
          const k = ((rng() * count) | 0) << 1;
          const a = combos[k];
          const b = combos[k + 1];
          if (used[a] || used[b]) {
            ok = false;
            break;
          }
          used[a] = 1;
          used[b] = 1;
          hole[p * 2] = a;
          hole[p * 2 + 1] = b;
        }
        if (ok) dealt = true;
      }

      if (!dealt) {
        this.failures++;
        continue;
      }

      for (let i = 0; i < missing; i++) {
        let c: number;
        do {
          c = (rng() * NUM_CARDS) | 0;
        } while (used[c]);
        used[c] = 1;
        board[boardLen + i] = c;
      }

      for (let i = 0; i < n; i++) {
        values[i] = evaluate7(
          hole[i * 2], hole[i * 2 + 1],
          board[0], board[1], board[2], board[3], board[4],
        );
      }
      this.tally.add(values);
    }
  }

  result(): EquityResult {
    return this.tally.result(this.input.players.map((p) => p.id), 'monte-carlo');
  }
}

export interface ComputeOptions {
  simulations?: number;
  exactLimit?: number;
  seed?: number;
  /** Force a mode instead of picking automatically. */
  force?: EquityMode;
}

/** Synchronous convenience entry point (used by tests and by the worker). */
export function computeEquity(input: EquityInput, opts: ComputeOptions = {}): EquityResult {
  const exactLimit = opts.exactLimit ?? DEFAULT_EXACT_LIMIT;
  const simulations = opts.simulations ?? DEFAULT_SIMULATIONS;
  const work = estimateExactWork(input);

  if (opts.force === 'exact' || (opts.force !== 'monte-carlo' && work <= exactLimit)) {
    return computeExact(input);
  }
  const runner = new MonteCarloRunner(input, opts.seed);
  runner.run(simulations);
  return runner.result();
}
