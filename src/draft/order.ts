import type { DraftPhaseOrder, DraftSide } from './types.js';

/** Expand ABBA-style order into a sequence of sides for `countPerSide * 2` actions. */
export function expandSideOrder(
  order: DraftPhaseOrder,
  countPerSide: number,
  firstSide: DraftSide,
): DraftSide[] {
  const other: DraftSide = firstSide === 'red' ? 'blue' : 'red';
  const total = countPerSide * 2;
  const out: DraftSide[] = [];

  if (order === 'fixed') {
    for (let i = 0; i < countPerSide; i++) out.push(firstSide);
    for (let i = 0; i < countPerSide; i++) out.push(other);
    return out;
  }

  if (order === 'winner_first' || order === 'loser_first') {
    const lead = order === 'winner_first' ? firstSide : other;
    const trail: DraftSide = lead === 'red' ? 'blue' : 'red';
    for (let i = 0; i < total; i++) out.push(i % 2 === 0 ? lead : trail);
    return out;
  }

  // abba / abab
  for (let i = 0; i < total; i++) {
    if (order === 'abab') {
      out.push(i % 2 === 0 ? firstSide : other);
      continue;
    }
    // ABBA: A B B A A B B A …
    const pair = Math.floor(i / 2);
    const within = i % 2;
    if (pair % 2 === 0) out.push(within === 0 ? firstSide : other);
    else out.push(within === 0 ? other : firstSide);
  }
  return out;
}
