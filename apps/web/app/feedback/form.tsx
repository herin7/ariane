"use client";

import { useState } from "react";
import styles from "./feedback.module.css";

/**
 * Two forms in one, because they are the same three fields.
 *
 * "This page is wrong" and "please add property tax for Rajkot" arrive from the
 * same person in the same moment, and asking them to pick a different page for
 * each is how you get neither. `kind` is a radio, the rest is a textarea.
 *
 * Nothing here is required except the sentence itself. An email field a citizen
 * must fill before complaining is a citizen who does not complain.
 */
export function FeedbackForm() {
  const [kind, setKind] = useState<"REVIEW" | "REQUEST">("REVIEW");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="small" style={{ marginTop: 22 }}>
        Got it, thank you. {kind === "REQUEST" ? "Requested services get researched and sourced before they appear, so it is not instant." : "Every note gets read."}
      </p>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setNote(undefined);
        try {
          const response = await fetch("/api/feedback", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind,
              message,
              rating: kind === "REVIEW" && rating ? Number(rating) : undefined,
              contact: contact || undefined,
              path: window.location.pathname,
            }),
          });
          const result = (await response.json()) as { ok?: boolean; error?: string };
          if (result.ok) setDone(true);
          else setNote(result.error ?? "That did not go through.");
        } catch {
          setNote("Could not reach the server. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className={styles.kinds}>
        <legend>What is this?</legend>
        <label>
          <input
            type="radio"
            name="kind"
            checked={kind === "REVIEW"}
            onChange={() => setKind("REVIEW")}
          />
          A review
        </label>
        <label>
          <input
            type="radio"
            name="kind"
            checked={kind === "REQUEST"}
            onChange={() => setKind("REQUEST")}
          />
          Add something
        </label>
      </fieldset>

      <textarea
        required
        rows={5}
        maxLength={2000}
        aria-label={kind === "REVIEW" ? "Your review" : "What should Ariane cover?"}
        placeholder={
          kind === "REVIEW"
            ? "What worked, what did not, what was wrong."
            : "Which service, and which department or district, if you know it."
        }
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />

      {kind === "REVIEW" && (
        <div className={styles.row}>
          <label htmlFor="rating">Rating, if you want to give one</label>
          <select id="rating" value={rating} onChange={(event) => setRating(event.target.value)}>
            <option value="">No rating</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} out of 5
              </option>
            ))}
          </select>
        </div>
      )}

      <input
        type="email"
        maxLength={200}
        autoComplete="email"
        aria-label="Your email, only if you want a reply"
        placeholder="Email, only if you want a reply (optional)"
        value={contact}
        onChange={(event) => setContact(event.target.value)}
      />

      <button type="submit" className="primary" disabled={busy || message.trim().length < 4}>
        {busy ? "Sending" : "Send"}
      </button>
      {note && <span className="small">{note}</span>}
    </form>
  );
}
