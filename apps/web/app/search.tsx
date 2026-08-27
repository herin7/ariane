"use client";

import type { IntentMatch } from "@ariane/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "./analytics";
import { IGNITION_MS, Ignition } from "./ignition";

export function Search() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<IntentMatch[] | null>(null);
  // What we translated the question into before we searched. The phone has said
  // this since day one and the browser never did, so somebody typing Gujarati
  // got English service names back and no account of how we got there. §4.
  const [readAs, setReadAs] = useState<{ understoodAs?: string; detectedLanguage?: string }>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A service we know by name, know who runs it, and have not mapped. Different
  // from an empty result in the only way that matters to the person asking.
  const [comingSoon, setComingSoon] = useState<IntentMatch | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setFailed(false);
    setComingSoon(null);
    // §10: that a search happened, never what was searched for. The sentence a
    // citizen types is the most sensitive thing on this page.
    track("search_submitted");

    // The overlay says four true things in 1.2s and the request usually takes
    // less. Nothing below is allowed to land until it has finished saying them:
    // a transition that gets cut off halfway reads as a glitch, not as speed.
    const started = Date.now();
    const settled = () => new Promise((r) => setTimeout(r, Math.max(0, IGNITION_MS - (Date.now() - started))));
    let navigating = false;

    try {
      const response = await fetch("/api/intents/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await response.json()) as {
        matches?: IntentMatch[];
        understoodAs?: string;
        detectedLanguage?: string;
      };
      await settled();
      setReadAs({ understoodAs: data.understoodAs, detectedLanguage: data.detectedLanguage });

      // One confident match and nothing close behind it, so stop asking.
      const [best, second] = data.matches ?? [];
      // Except when the confident answer is one we have not built. Routing
      // into an empty journey would be the same dead end, reached faster.
      if (best?.supportStatus === "COMING_SOON") {
        setComingSoon(best);
        setMatches(null);
        return;
      }
      if (best && best.confidence >= 0.5 && (!second || second.confidence < best.confidence)) {
        // The overlay stays up through the navigation. Clearing it here would
        // put the landing page back on screen for however long the journey
        // takes to render, which is the one thing the overlay exists to avoid.
        navigating = true;
        track("service_opened", { serviceId: best.goal, metadata: { from: "auto" } });
        router.push(`/journey?goal=${encodeURIComponent(best.goal)}`);
        return;
      }
      // §5. Two or three, never a ranked list. Past the third the product has
      // stopped answering and started making the citizen do the work.
      setMatches((data.matches ?? []).slice(0, 3));
    } catch {
      // §20. Premium error state: say what happened and leave the sentence
      // they typed exactly where it was.
      await settled();
      setFailed(true);
    } finally {
      if (!navigating) setBusy(false);
    }
  }

  return (
    <div id="start" className={`search-area${busy ? " igniting" : ""}`}>
      {busy ? <Ignition query={text} /> : null}

      <form onSubmit={submit} className="search-form">
        <div className="search-control">
          <svg className="search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <circle cx="9" cy="9" r="5.75" stroke="currentColor" strokeWidth="1.5" />
            <path d="m13.25 13.25 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            className="grow"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I need to renew my driving licence"
            aria-label="What do you need to get done?"
            autoComplete="off"
          />
          <button
            className="primary"
            // Disabled only while it is working. Greying it out on an empty box
            // meant the one call to action on the landing page was the palest
            // thing on the screen every time somebody arrived.
            disabled={busy}
          >
            {busy ? "Reading" : "Find my path"}
          </button>
        </div>
      </form>

      {/* Say it in Gujarati, read it back in English, before any result. Not a
          confidence score: the actual sentence we searched on. §4. */}
      {readAs.understoodAs ? (
        <p className="search-note small muted rise">
          Read from your sentence: <span style={{ color: "var(--ink)" }}>{readAs.understoodAs}</span>
          {readAs.detectedLanguage ? <span className="faint"> · {readAs.detectedLanguage}</span> : null}
        </p>
      ) : null}

      {failed ? (
        <div className="search-message rise">
          <h3>That did not go through</h3>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Your sentence is still in the box. Press Start again and we will try once more.
          </p>
        </div>
      ) : null}

      {/* Not the empty state. We found it, we know whose it is, and the honest
          sentence is "not ours yet" rather than "never heard of it". Every word
          below comes off the node; nothing here knows what a passport is. */}
      {comingSoon ? (
        <div className="search-message coming-soon rise">
          <span className="tiny authority">
            {comingSoon.authorityLevel === "CENTRAL" ? "Central government" : comingSoon.authorityLevel === "LOCAL" ? "Local body" : "State government"}
          </span>
          <h3>
            {comingSoon.name} <span className="soon">coming soon</span>
          </h3>
          {comingSoon.supportNote ? (
            <p className="small muted" style={{ margin: "4px 0 0" }}>{comingSoon.supportNote}</p>
          ) : null}
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            Ariane compiles Gujarat state journeys today. This one is run from Delhi, so the path we
            would draw is not the state&apos;s to describe.
          </p>
        </div>
      ) : null}

      {/* §21. An empty state that tells you what to do next, and does not
          invent a nearest service to fill itself with. */}
      {!comingSoon && matches?.length === 0 ? (
        <div className="search-message rise">
          <h3>We have not mapped that one yet</h3>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            We would rather say so than send you somewhere on a guess. Try saying it another way, or
            open one of the journeys below.
          </p>
        </div>
      ) : null}

      {matches?.length ? (
        <div className="search-results">
          <p className="small muted search-results-label">
            Looks like you need
          </p>
          <div className="search-result-list">
            {matches.map((match) => (
              <button
                key={match.goal}
                className="search-result rise"
                onClick={() => {
                  if (match.supportStatus === "COMING_SOON") {
                    setComingSoon(match);
                    setMatches(null);
                    return;
                  }
                  track("service_opened", { serviceId: match.goal, metadata: { from: "list" } });
                  router.push(`/journey?goal=${encodeURIComponent(match.goal)}`);
                }}
              >
                <h3>
                  {match.name}
                  {match.supportStatus === "COMING_SOON" ? <span className="soon">coming soon</span> : null}
                </h3>
                {/* Never a percentage. §4. What a citizen can act on is where
                    the match came from: their own words, or a model reading
                    between them, which is worth a second look. */}
                <span className="small muted">
                  {match.matched.length
                    ? `because you said ${match.matched.join(", ")}`
                    : "read between your words rather than off them, so check this is what you meant"}
                </span>
                <span className="search-result-arrow" aria-hidden>→</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
