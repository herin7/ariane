"use client";

import { useEffect, useState } from "react";

/**
 * The half second between asking and being answered.
 *
 * A government form makes you press submit and then shows you nothing, and the
 * thing you cannot tell from nothing is whether it heard you. So the moment the
 * sentence is sent, the screen commits to it: the page recedes, a thread draws
 * itself from where the question was to where the answer will be, and the four
 * things we are actually doing say themselves in order.
 *
 * Every line below is true. We do read the sentence, we do search a graph of
 * this size, and we do check the jurisdiction before we answer. If the request
 * comes back early the overlay still finishes its sentence, because a flash of
 * choreography is worse than none. If it comes back late the last line holds
 * rather than looping, because a spinner that lies about progress is the thing
 * we are replacing.
 *
 * Under prefers-reduced-motion it is one static line and no movement at all.
 */

/** Said in order, one every 300ms. Four lines is 1.2s, which is the budget. */
const BEATS = [
  { at: 0, label: "Reading your sentence" },
  // Not a node count. A number in copy is a fact nothing recompiles.
  { at: 300, label: "Searching the Gujarat service graph" },
  { at: 600, label: "Checking who has jurisdiction" },
  { at: 900, label: "Drawing your thread" },
];

/** Long enough to land, short enough that nobody waits for it on purpose. */
export const IGNITION_MS = 1200;

export function Ignition({ query }: { query: string }) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const timers = BEATS.map((b, i) => window.setTimeout(() => setBeat(i), b.at));
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <div className="ignition" role="status" aria-live="polite">
      <div className="ignition-thread" aria-hidden>
        <svg viewBox="0 0 2 200" preserveAspectRatio="none">
          <path d="M1 0 L1 200" />
        </svg>
      </div>

      <p className="ignition-query">{query}</p>

      <ul className="ignition-beats">
        {BEATS.map((b, i) => (
          <li key={b.label} className={i < beat ? "done" : i === beat ? "now" : ""}>
            <span className="ignition-dot" aria-hidden />
            {b.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
