/**
 * What Ariane says it is doing, and for how long.
 *
 * Data only, no React and no animation library, so `search.tsx` can hold the
 * request to this floor without pulling the overlay - and everything that draws
 * it - into the landing page's first load.
 *
 * Every line is true. We do read the sentence, we do search a graph of this
 * size, and we do check the jurisdiction before answering. A loading state that
 * narrates work nobody is doing is the thing this product exists to replace.
 */

export interface Beat {
  /** Milliseconds after the overlay appears. */
  at: number;
  label: string;
}

/** Said in order, one every 300ms. Four lines is 1.2s, which is the budget. */
export const BEATS: readonly Beat[] = [
  { at: 0, label: "Reading your sentence" },
  // Not a node count. A number in copy is a fact nothing recompiles.
  { at: 300, label: "Searching the Gujarat service graph" },
  { at: 600, label: "Checking who has jurisdiction" },
  { at: 900, label: "Drawing your thread" },
];

/** Long enough to land, short enough that nobody waits for it on purpose. */
export const IGNITION_MS = 1200;
