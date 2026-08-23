"use client";

import type { IntentMatch } from "@ariane/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function Search() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<IntentMatch[] | null>(null);
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
    const data = (await response.json()) as { matches?: IntentMatch[] };
    setBusy(false);

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
              <span className="muted small">
                matched on {match.matched.join(", ")} ({Math.round(match.confidence * 100)}% sure)
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
