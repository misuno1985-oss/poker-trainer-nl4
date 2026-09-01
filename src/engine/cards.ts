/**
 * Card model.
 *
 * A card is encoded as an integer 0..51:  card = rank * 4 + suit
 *   rank: 0 = deuce ... 12 = ace
 *   suit: 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades
 *
 * The whole engine is plain TypeScript and knows nothing about React.
 */

export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠']; // c d h s
export const RED_SUITS = new Set([1, 2]);

export const NUM_CARDS = 52;

export function makeCard(rank: number, suit: number): Card {
  return rank * 4 + suit;
}

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

/** "As", "Td", "9c" -> card index. Returns -1 when unparsable. */
export function parseCard(text: string): Card {
  if (!text || text.length < 2) return -1;
  const r = RANKS.indexOf(text[0].toUpperCase());
  const s = SUITS.indexOf(text[1].toLowerCase());
  if (r < 0 || s < 0) return -1;
  return makeCard(r, s);
}

export function cardToString(card: Card): string {
  return RANKS[rankOf(card)] + SUITS[suitOf(card)];
}

export function parseCards(text: string): Card[] {
  const out: Card[] = [];
  const cleaned = text.replace(/[^A-Za-z0-9]/g, '');
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    const c = parseCard(cleaned.slice(i, i + 2));
    if (c < 0) return out;
    out.push(c);
  }
  return out;
}

export const FULL_DECK: Card[] = Array.from({ length: NUM_CARDS }, (_, i) => i);

/** Every card not present in `dead`. */
export function remainingDeck(dead: Iterable<Card>): Card[] {
  const used = new Uint8Array(NUM_CARDS);
  for (const c of dead) if (c >= 0 && c < NUM_CARDS) used[c] = 1;
  const deck: Card[] = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!used[c]) deck.push(c);
  return deck;
}

/** Bitmask helpers: a 52-bit mask stored as a pair of 32-bit ints is avoided by
 *  using a plain Uint8Array; for hot loops we use a `number[]` of used flags. */
export function cardsToMaskArray(cards: Iterable<Card>): Uint8Array {
  const used = new Uint8Array(NUM_CARDS);
  for (const c of cards) used[c] = 1;
  return used;
}

export function hasDuplicates(cards: Card[]): boolean {
  const seen = new Uint8Array(NUM_CARDS);
  for (const c of cards) {
    if (c < 0 || c >= NUM_CARDS) return true;
    if (seen[c]) return true;
    seen[c] = 1;
  }
  return false;
}
