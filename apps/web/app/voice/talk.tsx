"use client";

import type { VoiceState } from "@ariane/voice/client";
import { VoiceClient } from "@ariane/voice/client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./talk.module.css";

/**
 * Talk to Ariane.
 *
 * §23: the same journey, said out loud. This renders the projection the model
 * was handed, so the panel and the voice cannot disagree - there is one compile
 * behind both, and if they ever differ it is because they were given different
 * answers, never because they ran different code.
 *
 * New file, and only new files. Ariane's design is not being redesigned to fit
 * a microphone: this borrows the existing tokens and primitives and adds one
 * scoped stylesheet for the parts that have no precedent, like a level meter.
 */

interface VoiceJourney {
  service: { id: string; name: string };
  jurisdiction: string;
  summary: string;
  nextQuestion?: { id: string; prompt: string };
  nextBestAction?: { stepId: string; title: string; whatToDo?: string };
  documents: { readyCount: number; neededCount: number; needed: string[] };
  stepsRemaining: number;
  unverified: boolean;
}

const LABEL: Record<VoiceState, string> = {
  idle: "Talk to Ariane",
  connecting: "Connecting",
  listening: "Listening",
  speaking: "Ariane is speaking",
  ended: "Call ended",
  error: "Something went wrong",
};

export function TalkToAriane({ district }: { district?: string }) {
  const client = useRef<VoiceClient>(null);
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [said, setSaid] = useState("");
  const [journey, setJourney] = useState<VoiceJourney>();
  const [problem, setProblem] = useState<string>();
  // Undefined until the first attempt: a deployment without voice keys answers
  // 503 and the button should disappear rather than fail in front of somebody.
  const [available, setAvailable] = useState(true);

  const stop = useCallback(() => {
    client.current?.stop();
    client.current = null;
  }, []);

  // A call that outlives its panel is a microphone nobody can turn off.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setProblem(undefined);
    setSaid("");
    const voice = new VoiceClient({
      jurisdiction: { country: "IN", state: "GJ", ...(district ? { district } : {}) },
      onState: setState,
      onTranscript: (text) => setSaid(text),
      onJourney: (data) => setJourney(data as VoiceJourney),
      onError: (message) => {
        setProblem(message);
        if (message.includes("not configured") || message.includes("not available")) setAvailable(false);
      },
    });
    client.current = voice;
    await voice.start();
  }, [district]);

  if (!available) return null;

  const live = state === "listening" || state === "speaking";

  return (
    <section className={styles.panel} aria-label="Talk to Ariane">
      <div className={styles.bar}>
        <button
          type="button"
          className={live ? "" : "primary"}
          onClick={live || state === "connecting" ? stop : start}
          disabled={state === "connecting"}
        >
          {live ? "End call" : LABEL[state]}
        </button>

        {live && (
          <button
            type="button"
            className="ghost"
            aria-pressed={muted}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              client.current?.setMuted(next);
            }}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
        )}

        <span className={styles.status} data-state={state}>
          <span className={styles.dot} aria-hidden />
          {LABEL[state]}
        </span>
      </div>

      {/* Ariane's own words, on screen for anyone who cannot hear them. Shown
          and never stored: reload the page and this is gone, because §19 says
          a transcript is not a thing we keep. */}
      <p className={styles.transcript} aria-live="polite">
        {said || (live ? "Say what you need to get done." : "Ask in Gujarati, Hindi or English.")}
      </p>

      {problem && (
        <p className="small" role="status" style={{ color: "var(--bad)" }}>
          {problem}
        </p>
      )}

      {journey && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{journey.service.name}</strong>
            <span className="small faint">{journey.jurisdiction}</span>
          </div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            {journey.summary}
          </p>

          {journey.nextQuestion && (
            <p className={styles.question}>{journey.nextQuestion.prompt}</p>
          )}

          {journey.nextBestAction && (
            <p className="small" style={{ margin: "10px 0 0" }}>
              {journey.nextBestAction.whatToDo ?? journey.nextBestAction.title}
            </p>
          )}

          {journey.documents.needed.length > 0 && (
            <ul className="small">
              {journey.documents.needed.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}

          {/* Not a tooltip. If no person has read the pages behind this path,
              the citizen is told so where they are already looking. */}
          {journey.unverified && (
            <p className="small" style={{ color: "var(--warn)", margin: "10px 0 0" }}>
              Parts of this were read by machine and not yet checked by a person.
            </p>
          )}

          <a className="small" href={`/journey?goal=${encodeURIComponent(journey.service.id)}`}>
            See the whole journey
          </a>
        </div>
      )}
    </section>
  );
}
