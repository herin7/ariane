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
  // got English service names back and no account of how we got there.
  const [readAs, setReadAs] = useState<{ understoodAs?: string; detectedLanguage?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
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
    setBusy(false);
    setReadAs({ understoodAs: data.understoodAs, detectedLanguage: data.detectedLanguage });

    // One confident match and nothing close behind it, so stop asking.
    const [best, second] = data.matches ?? [];
    if (best && best.confidence >= 0.5 && (!second || second.confidence < best.confidence)) {
      router.push(`/journey?goal=${encodeURIComponent(best.goal)}`);
      return;
    }
    setMatches(data.matches ?? []);
  }

  return (
    <>
      <form onSubmit={submit} className="row">
        <input
          className="grow"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="I want to get a driving licence"
          aria-label="What do you need to get done?"
        />
        <button className="primary" disabled={busy}>{busy ? "Thinking" : "Find my path"}</button>
      </form>

      {readAs.understoodAs ? (
        <p className="muted small" style={{ marginTop: 12 }}>
          Read as: {readAs.understoodAs}
          {readAs.detectedLanguage ? ` (${readAs.detectedLanguage})` : ""}
        </p>
      ) : null}

      {matches?.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>
          We do not have that journey mapped yet. Only the services listed below are covered so far, and we
          would rather say so than send you somewhere on a guess.
        </p>
      ) : null}

      {matches?.length ? (
        <div style={{ marginTop: 12 }}>
          <p className="muted small">Did you mean one of these?</p>
          {matches.map((match) => (
            <button
              key={match.goal}
              className="card"
              style={{ display: "block", width: "100%", textAlign: "left" }}
              onClick={() => router.push(`/journey?goal=${encodeURIComponent(match.goal)}`)}
            >
              <h3>{match.name}</h3>
              {/* An empty `matched` is the model having read the sentence, not
                  a word having matched. It rendered as "matched on  (25% sure)",
                  a claim about words that were never there. Mobile already said
                  the right thing here and the web did not. */}
              <span className="muted small">
                {match.matched.length
                  ? `matched on ${match.matched.join(", ")} (${Math.round(match.confidence * 100)}% sure)`
                  : "read out of your sentence by a model, not matched on a word. Check it is what you meant."}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
