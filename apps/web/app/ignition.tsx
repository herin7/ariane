"use client";

import { animate } from "motion";
import { useEffect, useRef, useState } from "react";
import { BEATS, IGNITION_MS } from "./ignition-beats";

/**
 * The second between asking and being answered.
 *
 * A government form makes you press submit and then shows you nothing, and the
 * thing you cannot tell from nothing is whether it heard you. So the screen
 * commits: your sentence stays on it, and the thread grows down the page tying
 * a knot at each of the four things we are actually doing.
 *
 * The thread is the point. Ariane is Ariadne's, the journey pages are drawn as
 * one, and a route through government is what this product returns - so the
 * wait is that route being tied rather than a spinner claiming progress it
 * cannot know. The rail reaches the bottom exactly as the last knot lands,
 * which is a promise this component can actually keep.
 *
 * Loaded on demand from `search.tsx` and warmed when the search box is focused,
 * so Motion is never in the landing page's first load. If the request comes
 * back early the overlay still finishes its sentence, because a flash of
 * choreography is worse than none.
 *
 * Under prefers-reduced-motion nothing animates: the beats still say themselves
 * in order, which was always the part that carried the meaning.
 */

/** A spring that arrives quickly and barely overshoots. Knots are tied, not thrown. */
const KNOT = { type: "spring", stiffness: 620, damping: 22, mass: 0.7 } as const;

export function Ignition({ query }: { query: string }) {
  const [beat, setBeat] = useState(0);
  const route = useRef<HTMLOListElement>(null);
  const rail = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const timers = BEATS.map((b, i) => window.setTimeout(() => setBeat(i), b.at));
    return () => timers.forEach(window.clearTimeout);
  }, []);

  /**
   * The rail, drawn once for the whole run.
   *
   * Linear on purpose: it is a clock, and a clock that eases is a clock that
   * lies about where it is. The knots are the part that springs.
   */
  useEffect(() => {
    if (!rail.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const drawing = animate(rail.current, { scaleY: [0, 1] }, { duration: IGNITION_MS / 1000, ease: "linear" });
    return () => drawing.stop();
  }, []);

  /**
   * Each knot ties itself as its beat arrives, and rings once.
   *
   * Keyed off `beat` rather than a per-item effect so a knot animates exactly
   * when it is reached, including the first one on mount.
   */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const row = route.current?.children[beat];
    if (!row) return;

    const knot = row.querySelector<HTMLElement>(".ignition-knot");
    const ring = row.querySelector<HTMLElement>(".ignition-ring");
    const label = row.querySelector<HTMLElement>(".ignition-label");

    if (knot) void animate(knot, { scale: [0.3, 1] }, KNOT);
    if (ring) void animate(ring, { scale: [0.6, 2.4], opacity: [0.55, 0] }, { duration: 0.68, ease: [0.16, 1, 0.3, 1] });
    if (label) void animate(label, { opacity: [0, 1], x: [-8, 0] }, { type: "spring", stiffness: 520, damping: 26 });
  }, [beat]);

  return (
    <div className="ignition" role="status" aria-live="polite">
      {/* The sentence they typed, kept on screen. Being told your own words
          were received is most of what a loading state is for. */}
      <p className="ignition-query">{query}</p>

      <div className="ignition-route">
        {/* Behind the knots, growing from the top, and a sibling of the list
            rather than inside it: an `ol` may only contain `li`, and a rail
            counted as a list item is a rail read out as a step. */}
        <span className="ignition-rail" ref={rail} aria-hidden />

        <ol className="ignition-beats" ref={route}>
          {BEATS.map((b, index) => (
            <li key={b.label} data-state={index < beat ? "done" : index === beat ? "now" : "next"}>
              <span className="ignition-knot" aria-hidden>
                <span className="ignition-ring" />
              </span>
              <span className="ignition-label">{b.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
