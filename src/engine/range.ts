/**
 * Hand ranges.
 *
 * A range is a set of the 169 starting-hand classes (13x13 matrix).
 * Class index = row * 13 + col, where row/col are matrix coordinates with
 * 0 = ace ... 12 = deuce (the usual poker grid layout):
 *   row === col -> pocket pair
 *   row  <  col -> suited
 *   row  >  col -> offsuit
 *
 * Ranges are always expanded into *physical* combinations before they reach the
 * equity engines, so card removal (blockers) is honoured everywhere.
 */

import { RANKS, makeCard, type Card } from './cards';

export type HandClassKind = 'pair' | 'suited' | 'offsuit';

export interface HandClass {
  index: number;
  row: number;
  col: number;
  kind: HandClassKind;
  /** rank indices, 0 = deuce .. 12 = ace */
  high: number;
  low: number;
  label: string;
}

export type Range = Set<number>;

/** matrix coordinate -> rank index (0 = deuce .. 12 = ace) */
export function coordRank(coord: number): number {
  return 12 - coord;
}

/** rank index -> matrix coordinate */
export function rankCoord(rank: number): number {
  return 12 - rank;
}

export function classAt(row: number, col: number): HandClass {
  const index = row * 13 + col;
  if (row === col) {
    const r = coordRank(row);
    return { index, row, col, kind: 'pair', high: r, low: r, label: RANKS[r] + RANKS[r] };
  }
  if (row < col) {
    const high = coordRank(row);
    const low = coordRank(col);
    return { index, row, col, kind: 'suited', high, low, label: RANKS[high] + RANKS[low] + 's' };
  }
  const high = coordRank(col);
  const low = coordRank(row);
  return { index, row, col, kind: 'offsuit', high, low, label: RANKS[high] + RANKS[low] + 'o' };
}

export const ALL_CLASSES: HandClass[] = (() => {
  const out: HandClass[] = [];
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) out.push(classAt(row, col));
  }
  return out;
})();

export function classIndex(high: number, low: number, kind: HandClassKind): number {
  if (kind === 'pair') {
    const c = rankCoord(high);
    return c * 13 + c;
  }
  const hi = Math.max(high, low);
  const lo = Math.min(high, low);
  const hiC = rankCoord(hi);
  const loC = rankCoord(lo);
  return kind === 'suited' ? hiC * 13 + loC : loC * 13 + hiC;
}

/** Number of physical combos of a class before card removal: 6 / 4 / 12. */
export function baseComboCount(kind: HandClassKind): number {
  return kind === 'pair' ? 6 : kind === 'suited' ? 4 : 12;
}

/** All physical combos of one class, skipping any combo that uses a dead card. */
export function classCombos(cls: HandClass, dead?: Uint8Array): Array<[Card, Card]> {
  const out: Array<[Card, Card]> = [];
  const alive = (c: Card) => !dead || dead[c] === 0;
  if (cls.kind === 'pair') {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = s1 + 1; s2 < 4; s2++) {
        const a = makeCard(cls.high, s1);
        const b = makeCard(cls.high, s2);
        if (alive(a) && alive(b)) out.push([a, b]);
      }
    }
  } else if (cls.kind === 'suited') {
    for (let s = 0; s < 4; s++) {
      const a = makeCard(cls.high, s);
      const b = makeCard(cls.low, s);
      if (alive(a) && alive(b)) out.push([a, b]);
    }
  } else {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = 0; s2 < 4; s2++) {
        if (s1 === s2) continue;
        const a = makeCard(cls.high, s1);
        const b = makeCard(cls.low, s2);
        if (alive(a) && alive(b)) out.push([a, b]);
      }
    }
  }
  return out;
}

/** Flat list of every combo in a range: [c1, c2, c1, c2, ...] */
export function rangeCombos(range: Range, dead?: Uint8Array): Uint8Array {
  const list: number[] = [];
  for (const idx of range) {
    const cls = ALL_CLASSES[idx];
    for (const [a, b] of classCombos(cls, dead)) {
      list.push(a, b);
    }
  }
  return Uint8Array.from(list);
}

export function rangeComboCount(range: Range, dead?: Uint8Array): number {
  let total = 0;
  for (const idx of range) total += classCombos(ALL_CLASSES[idx], dead).length;
  return total;
}

/** Percentage of all 1326 preflop combos covered by the range (no card removal). */
export function rangePercent(range: Range): number {
  let total = 0;
  for (const idx of range) total += baseComboCount(ALL_CLASSES[idx].kind);
  return (total / 1326) * 100;
}

/* ------------------------------------------------------------------ */
/* Text notation                                                       */
/* ------------------------------------------------------------------ */

function rankValue(ch: string): number {
  return RANKS.indexOf(ch.toUpperCase());
}

export interface ParseResult {
  range: Range;
  errors: string[];
}

interface Token {
  high: number;
  low: number;
  kind: HandClassKind | 'both';
}

function parseSimple(token: string): Token | null {
  const t = token.trim();
  if (t.length < 2 || t.length > 3) return null;
  const r1 = rankValue(t[0]);
  const r2 = rankValue(t[1]);
  if (r1 < 0 || r2 < 0) return null;
  const suffix = t.length === 3 ? t[2].toLowerCase() : '';
  if (r1 === r2) {
    if (suffix !== '') return null;
    return { high: r1, low: r2, kind: 'pair' };
  }
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  if (suffix === 's') return { high, low, kind: 'suited' };
  if (suffix === 'o') return { high, low, kind: 'offsuit' };
  if (suffix === '') return { high, low, kind: 'both' };
  return null;
}

function addToken(range: Range, t: Token) {
  if (t.kind === 'both') {
    range.add(classIndex(t.high, t.low, 'suited'));
    range.add(classIndex(t.high, t.low, 'offsuit'));
  } else {
    range.add(classIndex(t.high, t.low, t.kind));
  }
}

/**
 * Parse standard range notation, e.g.
 *   "22+, A2s+, K9s+, QTs+, JTs, ATo+, KQo, 77-99, A5s-A2s"
 *
 * "+" keeps the higher card fixed and walks the lower card up (A2s+ = A2s..AKs);
 * for pairs it walks the pair up (22+ = 22..AA).
 */
export function parseRange(text: string): ParseResult {
  const range: Range = new Set();
  const errors: string[] = [];
  const parts = text.split(/[,;\s]+/).filter((p) => p.length > 0);

  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;

    if (part.includes('-')) {
      const [aRaw, bRaw] = part.split('-');
      const a = parseSimple(aRaw);
      const b = parseSimple(bRaw);
      if (!a || !b || a.kind !== b.kind) {
        errors.push(part);
        continue;
      }
      if (a.kind === 'pair') {
        const lo = Math.min(a.high, b.high);
        const hi = Math.max(a.high, b.high);
        for (let r = lo; r <= hi; r++) addToken(range, { high: r, low: r, kind: 'pair' });
      } else {
        if (a.high !== b.high) {
          errors.push(part);
          continue;
        }
        const lo = Math.min(a.low, b.low);
        const hi = Math.max(a.low, b.low);
        for (let r = lo; r <= hi; r++) addToken(range, { high: a.high, low: r, kind: a.kind });
      }
      continue;
    }

    if (part.endsWith('+')) {
      const base = parseSimple(part.slice(0, -1));
      if (!base) {
        errors.push(part);
        continue;
      }
      if (base.kind === 'pair') {
        for (let r = base.high; r <= 12; r++) addToken(range, { high: r, low: r, kind: 'pair' });
      } else {
        for (let r = base.low; r < base.high; r++) {
          addToken(range, { high: base.high, low: r, kind: base.kind });
        }
      }
      continue;
    }

    const simple = parseSimple(part);
    if (!simple) {
      errors.push(part);
      continue;
    }
    addToken(range, simple);
  }

  return { range, errors };
}

/** Compact canonical notation for a range, e.g. "TT+, AQs+, AJo+". */
export function rangeToString(range: Range): string {
  const out: string[] = [];

  // pairs
  const pairRanks: number[] = [];
  for (let r = 0; r <= 12; r++) if (range.has(classIndex(r, r, 'pair'))) pairRanks.push(r);
  out.push(...runsToNotation(pairRanks, 12, (lo, hi) => {
    if (hi === 12 && lo !== hi) return `${RANKS[lo]}${RANKS[lo]}+`;
    if (lo === hi) return `${RANKS[lo]}${RANKS[lo]}`;
    return `${RANKS[hi]}${RANKS[hi]}-${RANKS[lo]}${RANKS[lo]}`;
  }));

  for (const kind of ['suited', 'offsuit'] as const) {
    const suffix = kind === 'suited' ? 's' : 'o';
    for (let high = 12; high >= 1; high--) {
      const lows: number[] = [];
      for (let low = 0; low < high; low++) {
        if (range.has(classIndex(high, low, kind))) lows.push(low);
      }
      out.push(...runsToNotation(lows, high - 1, (lo, hi) => {
        if (hi === high - 1 && lo !== hi) return `${RANKS[high]}${RANKS[lo]}${suffix}+`;
        if (lo === hi) return `${RANKS[high]}${RANKS[lo]}${suffix}`;
        return `${RANKS[high]}${RANKS[hi]}${suffix}-${RANKS[high]}${RANKS[lo]}${suffix}`;
      }));
    }
  }

  return out.join(', ');
}

/** Collapse ascending rank lists into runs and render each run. */
function runsToNotation(
  sorted: number[],
  topValue: number,
  render: (lo: number, hi: number) => string,
): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const lo = sorted[i];
    const hi = sorted[j];
    void topValue;
    out.push(render(lo, hi));
    i = j + 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export function allPairs(): Range {
  const r: Range = new Set();
  for (let i = 0; i < 13; i++) r.add(i * 13 + i);
  return r;
}

export function allSuited(): Range {
  const r: Range = new Set();
  for (let row = 0; row < 13; row++) for (let col = row + 1; col < 13; col++) r.add(row * 13 + col);
  return r;
}

export function allOffsuit(): Range {
  const r: Range = new Set();
  for (let row = 1; row < 13; row++) for (let col = 0; col < row; col++) r.add(row * 13 + col);
  return r;
}

export function allHands(): Range {
  const r: Range = new Set();
  for (let i = 0; i < 169; i++) r.add(i);
  return r;
}
