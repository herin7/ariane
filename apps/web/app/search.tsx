"use client";

import type { IntentMatch } from "@ariane/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setFailed(false);
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
      setReadAs({ understoodAs: data.understoodAs, detectedLanguage: data.detectedLanguage });

      // One confident match and nothing close behind it, so stop asking.
      const [best, second] = data.matches ?? [];
      if (best && best.confidence >= 0.5 && (!second || second.confidence < best.confidence)) {
        router.push(`/journey?goal=${encodeURIComponent(best.goal)}`);
        return;
      }
      // §5. Two or three, never a ranked list. Past the third the product has
      // stopped answering and started making the citizen do the work.
      setMatches((data.matches ?? []).slice(0, 3));
    } catch {
      // §20. Premium error state: say what happened and leave the sentence
      // they typed exactly where it was.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={submit}>
        <div style={{ position: "relative" }}>
          <input
            className="grow"
            style={{ width: "100%", fontSize: 17, padding: "16px 108px 16px 16px", borderRadius: "var(--r-lg)" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I want to get a driving licence"
            aria-label="What do you need to get done?"
            autoComplete="off"
          />
          <button
            className="primary"
            // Disabled only while it is working. Greying it out on an empty box
            // meant the one call to action on the landing page was the palest
            // thing on the screen every time somebody arrived.
            disabled={busy}
            style={{ position: "absolute", right: 6, top: 6, bottom: 6, padding: "0 16px", borderRadius: "var(--r)" }}
          >
            {busy ? "Reading" : "Start"}
          </button>
        </div>
      </form>

      {/* Say it in Gujarati, read it back in English, before any result. Not a
          confidence score: the actual sentence we searched on. §4. */}
      {readAs.understoodAs ? (
        <p className="small muted rise" style={{ marginTop: 12 }}>
          Read from your sentence: <span style={{ color: "var(--ink)" }}>{readAs.understoodAs}</span>
          {readAs.detectedLanguage ? <span className="faint"> · {readAs.detectedLanguage}</span> : null}
        </p>
      ) : null}

      {failed ? (
        <div className="card rise" style={{ marginTop: 14 }}>
          <h3>That did not go through</h3>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Your sentence is still in the box. Press Start again and we will try once more.
          </p>
        </div>
      ) : null}

      {/* §21. An empty state that tells you what to do next, and does not
          invent a nearest service to fill itself with. */}
      {matches?.length === 0 ? (
        <div className="card rise" style={{ marginTop: 14 }}>
          <h3>We have not mapped that one yet</h3>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            We would rather say so than send you somewhere on a guess. Try saying it another way, or
            open one of the journeys below.
          </p>
        </div>
      ) : null}

      {matches?.length ? (
        <div style={{ marginTop: 20 }}>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Looks like you need
          </p>
          <div className="stack">
            {matches.map((match) => (
              <button
                key={match.goal}
                className="card rise"
                onClick={() => router.push(`/journey?goal=${encodeURIComponent(match.goal)}`)}
              >
                <h3>{match.name}</h3>
                {/* Never a percentage. §4. What a citizen can act on is where
                    the match came from: their own words, or a model reading
                    between them, which is worth a second look. */}
                <span className="small muted">
                  {match.matched.length
                    ? `because you said ${match.matched.join(", ")}`
                    : "read between your words rather than off them, so check this is what you meant"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
