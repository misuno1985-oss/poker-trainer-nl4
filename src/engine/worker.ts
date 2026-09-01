/// <reference lib="webworker" />
/**
 * Equity worker: keeps the heavy loops off the UI thread and yields between
 * chunks so a newer request can cancel the one in flight.
 */

import {
  computeExact, estimateExactWork, MonteCarloRunner,
  DEFAULT_EXACT_LIMIT, DEFAULT_SIMULATIONS,
  type EquityInput, type EquityResult,
} from './equity';

export interface CalcRequest {
  type: 'calc';
  id: number;
  input: EquityInput;
  simulations?: number;
  exactLimit?: number;
  seed?: number;
}

export interface CancelRequest {
  type: 'cancel';
  id: number;
}

export type WorkerRequest = CalcRequest | CancelRequest;

export interface WorkerResponse {
  type: 'progress' | 'done';
  id: number;
  result: EquityResult;
  /** Enumeration cost estimate, so the UI can explain the chosen mode. */
  work: number;
}

let latestId = -1;
const cancelled = new Set<number>();
const CHUNK = 20_000;

const isStale = (id: number) => latestId !== id || cancelled.has(id);

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }

  const { id, input } = msg;
  latestId = Math.max(latestId, id);
  const simulations = msg.simulations ?? DEFAULT_SIMULATIONS;
  const exactLimit = msg.exactLimit ?? DEFAULT_EXACT_LIMIT;
  const work = estimateExactWork(input);

  if (work > 0 && work <= exactLimit) {
    const result = computeExact(input);
    if (!isStale(id)) post({ type: 'done', id, result, work });
    return;
  }

  const runner = new MonteCarloRunner(input, msg.seed);
  let done = 0;
  while (done < simulations) {
    if (isStale(id)) return;
    const n = Math.min(CHUNK, simulations - done);
    runner.run(n);
    done += n;
    if (done < simulations) {
      post({ type: 'progress', id, result: runner.result(), work });
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (!isStale(id)) post({ type: 'done', id, result: runner.result(), work });
};
