"use client";

import type { QueuePlace, VoiceLimit, VoiceState } from "@ariane/voice/client";
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
 *
 * Nothing in here enforces anything. The countdown, the queue position and the
 * "sign in to keep talking" line are all reports of decisions the server has
 * already made; editing any of them in devtools changes what one person sees
 * and nothing about what they get.
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
  queued: "Waiting for a line",
  connecting: "Connecting",
  listening: "Listening",
  speaking: "Ariane is speaking",
  ended: "Call ended",
  error: "Something went wrong",
};

const clock = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export function TalkToAriane({ district }: { district?: string }) {
  const client = useRef<VoiceClient>(null);
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [said, setSaid] = useState("");
  const [journey, setJourney] = useState<VoiceJourney>();
  const [problem, setProblem] = useState<string>();
  const [place, setPlace] = useState<QueuePlace>();
  const [left, setLeft] = useState<number>();
  const [limit, setLimit] = useState<VoiceLimit>();
  const [email, setEmail] = useState<string>();
  // Undefined until the first attempt: a deployment without voice keys answers
  // 503 and the button should disappear rather than fail in front of somebody.
  const [available, setAvailable] = useState(true);

  // Who is on the line, asked once. The answer only changes the words on the
  // button; the tier itself is decided on the server from the same cookie.
  useEffect(() => {
    let live = true;
    fetch("/api/auth")
      .then((r) => r.json())
      .then((body: { signedIn?: boolean; email?: string }) => {
        if (live && body.signedIn) setEmail(body.email ?? "");
      })
      .catch(() => {
        // Sign-in not configured here. Guest is the default and it works.
      });
    return () => {
      live = false;
    };
  }, []);

  const stop = useCallback(() => {
    client.current?.stop();
    client.current = null;
    setPlace(undefined);
    setLeft(undefined);
  }, []);

  // A call that outlives its panel is a microphone nobody can turn off.
  useEffect(() => stop, [stop]);

  /**
   * A tab that closes mid-call would otherwise hold one of ten lines until its
   * lease expired. `stop` sends the hang-up with `keepalive`, which is what
   * makes it survive the page going away. The lease expiring is still the
   * mechanism; this only makes the common case fast. §4.
   */
  useEffect(() => {
    const bye = () => client.current?.stop();
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, []);

  const start = useCallback(async () => {
    setProblem(undefined);
    setLimit(undefined);
    setSaid("");
    const voice = new VoiceClient({
      jurisdiction: { country: "IN", state: "GJ", ...(district ? { district } : {}) },
      onState: setState,
      onTranscript: (text) => setSaid(text),
      onJourney: (data) => setJourney(data as VoiceJourney),
      onQueue: setPlace,
      onTime: setLeft,
      onLimit: setLimit,
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
  const waiting = state === "queued";
  const busy = live || waiting || state === "connecting";

  return (
    <section className={styles.panel} aria-label="Talk to Ariane">
      <div className={styles.bar}>
        <button
          type="button"
          className={busy ? "" : "primary"}
          onClick={waiting ? () => client.current?.leaveQueue() : busy ? stop : start}
          disabled={state === "connecting"}
        >
          {waiting
            ? "Leave queue"
            : live
              ? "End call"
              : // §23. The offer, worded as an offer, and only to somebody who
                // has not signed in and has not just been on a call.
                state === "idle" && email === undefined
                ? "Try Ariane — 1 minute free"
                : LABEL[state]}
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

        {/* Visible, subtle, and honest about being a display. Polite rather
            than assertive so a screen reader does not read a number every
            second over the top of the person Ariane is talking to. */}
        {live && left !== undefined && (
          <span className={styles.clock} data-low={left <= 10_000} aria-live="polite">
            {clock(left)} left
          </span>
        )}

        <span className={styles.status} data-state={state}>
          <span className={styles.dot} aria-hidden />
          {LABEL[state]}
        </span>
      </div>

      {/* §23. Being tenth in line is not an error and is not styled as one. */}
      {waiting && place && (
        <p className={styles.notice} role="status">
          <strong>All {place.max} Ariane lines are currently helping someone.</strong>
          <br />
          You&rsquo;re #{place.position} in line
          {place.estimatedWaitMs ? ` — about ${Math.ceil(place.estimatedWaitMs / 60_000)} minutes` : ""}. We&rsquo;ll
          connect you automatically.
        </p>
      )}

      {/* Ariane's own words, on screen for anyone who cannot hear them. */}
      <p className={styles.transcript} aria-live="polite">
        {said || (live ? "Say what you need to get done." : "Ask in Gujarati, Hindi or English.")}
      </p>

      {/* §17, and before the first call rather than after it. Two sentences,
          not a legal modal: audio is not kept, text may be, do not read out
          numbers you would not put in an email. */}
      {!busy && (
        <p className="small faint" style={{ margin: 0 }}>
          Ariane is an AI assistant. Your audio is not recorded or stored; a text record of the conversation is kept so
          we can improve it, and you can ask us to delete it. Please don&rsquo;t read out Aadhaar, PAN, card or OTP
          numbers unless a step asks for them.
        </p>
      )}

      {limit && <Ceiling limit={limit} signedIn={email !== undefined} onSignedIn={setEmail} />}

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

          {journey.nextQuestion && <p className={styles.question}>{journey.nextQuestion.prompt}</p>}

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

/**
 * The ceiling, said in a sentence, with the one thing that lifts it.
 *
 * Only the guest quota offers a way out, and it is the only one that has one:
 * a busy line is a matter of waiting and a cooldown is not something a person
 * should be able to click past.
 */
function Ceiling({
  limit,
  signedIn,
  onSignedIn,
}: {
  limit: VoiceLimit;
  signedIn: boolean;
  onSignedIn: (email: string) => void;
}) {
  return (
    <div className={styles.notice} role="status">
      {limit.message}
      {limit.code === "GUEST_QUOTA" && !signedIn && <SignIn onSignedIn={onSignedIn} />}
    </div>
  );
}

/**
 * The whole of Ariane's login. An email, a six digit code, done.
 *
 * No password field, so there is no password to store, leak or reset. Nothing
 * here holds a token: the code is exchanged on the server and the session comes
 * back as an HttpOnly cookie this component cannot read. §8.
 */
function SignIn({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    setNote(undefined);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await response.json()) as { error?: string; sent?: boolean; signedIn?: boolean; email?: string };
    } catch {
      return { error: "Could not reach the server. Try again." };
    } finally {
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <form
        className={styles.signin}
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await post("/api/auth/otp", { email });
          if (result.error) setNote(result.error);
          else setSent(true);
        }}
      >
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" className="primary" disabled={busy}>
          Continue with email
        </button>
        {note && <span className="small">{note}</span>}
      </form>
    );
  }

  return (
    <form
      className={styles.signin}
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await post("/api/auth/verify", { email, code });
        if (result.signedIn) onSignedIn(result.email ?? email);
        else setNote(result.error ?? "That code was not right.");
      }}
    >
      <input
        inputMode="numeric"
        pattern="\d{6}"
        required
        autoComplete="one-time-code"
        placeholder="6 digit code"
        aria-label="The code from your email"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <button type="submit" className="primary" disabled={busy}>
        Sign in
      </button>
      <span className="small faint">Sent to {email}</span>
      {note && <span className="small">{note}</span>}
    </form>
  );
}
