"use client";

import type { QueuePlace, VoiceLimit, VoiceState } from "@ariane/voice/client";
import { VoiceClient } from "@ariane/voice/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { SignIn } from "../signin";
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

/** A life event, several services deep. `projectPlan` in `@ariane/voice`. */
interface VoicePlan {
  title: string;
  jurisdiction: string;
  summary: string;
  services: { id: string; name: string; after: string[] }[];
  checklist: { order: number; stepId: string; title: string; forService: string; alsoFor: string[] }[];
  documents: { neededCount: number; needed: string[] };
  offices: { name: string; line: string }[];
  unknownGoals: string[];
  unverified: boolean;
}

/**
 * What each tool is doing, in the citizen's words rather than ours.
 *
 * The names are the model's API surface and mean nothing to the person on the
 * phone. This is the only place they are translated, and it is presentation:
 * a tool missing from here still runs, it just does not narrate itself.
 */
const DOING: Record<string, string> = {
  resolve_need: "Looking through Gujarat's services",
  build_plan: "Working out everything this involves",
  start_journey: "Opening the path",
  answer_question: "Shortening the path with your answer",
  get_current_journey: "Checking where you are",
  explain_step: "Reading that step",
  save_preference: "Remembering that for next time",
  forget_my_data: "Erasing everything saved about you",
  resume_journey: "Bringing up what you had started",
};

/** How many lines of work stay on screen. Past four it is a log, not a signal. */
const ACTS_SHOWN = 4;

const LABEL: Record<VoiceState, string> = {
  idle: "Talk to Ariane",
  queued: "Waiting for a line",
  connecting: "Connecting",
  listening: "Listening",
  speaking: "Ariane is speaking",
  ended: "Call ended",
  error: "Something went wrong",
};

/**
 * What pressing the button does, where that is not the same as where we are.
 *
 * The status pill says "Something went wrong". A button saying it as well is a
 * button that looks broken rather than one that looks like a second try, and
 * the second try is the whole point: almost every voice failure is a handshake
 * that will work on the next attempt.
 */
const ACTION: Partial<Record<VoiceState, string>> = {
  connecting: "Cancel",
  error: "Try again",
  ended: "Start another call",
};

const clock = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** How often the lines-in-use number is refreshed. */
const TRAFFIC_MS = 10_000;

export function TalkToAriane({ district }: { district?: string }) {
  const client = useRef<VoiceClient>(null);
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [said, setSaid] = useState("");
  const [journey, setJourney] = useState<VoiceJourney>();
  const [plan, setPlan] = useState<VoicePlan>();
  const [acts, setActs] = useState<{ id: number; label: string; ok: boolean }[]>([]);
  const [problem, setProblem] = useState<string>();
  const [place, setPlace] = useState<QueuePlace>();
  const [left, setLeft] = useState<number>();
  const [limit, setLimit] = useState<VoiceLimit>();
  const [email, setEmail] = useState<string>();
  // How many of the ten lines are in use, and how many people are behind them.
  const [traffic, setTraffic] = useState<{ active: number; max: number; queued: number }>();
  // How long we have been connecting or queueing. A spinner that does not say
  // how long it has been spinning is why somebody once sat through a whole
  // minute of a dead handshake without knowing it was dead. §23.
  const [waited, setWaited] = useState(0);
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

  /**
   * Who else is on the line, right now.
   *
   * Counts only, straight off the same lease table the queue is built on, so
   * this cannot disagree with the refusal somebody gets a second later. It
   * runs whether or not this browser is in a call: knowing nine of ten lines
   * are lit is most useful *before* pressing the button.
   */
  useEffect(() => {
    let live = true;
    const read = () =>
      fetch("/api/voice/traffic")
        .then((r) => (r.ok ? r.json() : undefined))
        .then((body) => {
          if (live && body) setTraffic(body as { active: number; max: number; queued: number });
        })
        .catch(() => {
          // A missing traffic number hides one line of text. Not worth a retry.
        });
    void read();
    const every = setInterval(read, TRAFFIC_MS);
    return () => {
      live = false;
      clearInterval(every);
    };
  }, []);

  // Counts up only while nothing is connected yet. The countdown below counts
  // down, and the two are never on screen at the same time.
  useEffect(() => {
    setWaited(0);
    if (state !== "connecting" && state !== "queued") return;
    const from = Date.now();
    const every = setInterval(() => setWaited(Date.now() - from), 1_000);
    return () => clearInterval(every);
  }, [state]);

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
    setActs([]);
    const voice = new VoiceClient({
      jurisdiction: { country: "IN", state: "GJ", ...(district ? { district } : {}) },
      onState: (next) => {
        // A countdown still on screen after the call has gone is a call that
        // looks like it is still running.
        if (next === "idle" || next === "ended" || next === "error") setLeft(undefined);
        setState(next);
      },
      onTranscript: (text) => setSaid(text),
      onJourney: (data) => setJourney(data as VoiceJourney),
      onPlan: (data) => setPlan(data as VoicePlan),
      // Only tools we have words for. A name with no entry in DOING is one
      // somebody added without deciding what a citizen should be told it means,
      // and a raw `save_preference` on screen is worse than silence.
      onTool: (name, result) =>
        setActs((current) =>
          DOING[name]
            ? [{ id: current.length, label: DOING[name] as string, ok: result.ok }, ...current].slice(0, ACTS_SHOWN)
            : current,
        ),
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
          // Never disabled, and "Connecting" least of all. A handshake that
          // hangs used to leave the one control on the panel greyed out, so
          // the only way out was reloading the page. §23.
        >
          {waiting
            ? "Leave queue"
            : live
              ? "End call"
              : // §23. The offer, worded as an offer, and only to somebody who
                // has not signed in and has not just been on a call.
                state === "idle" && email === undefined
                ? "Try Ariane — 1 minute free"
                : (ACTION[state] ?? LABEL[state])}
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
            second over the top of the person Ariane is talking to.

            It appears at Ariane's first word, because that is when the client
            starts counting. Nothing on screen counts down during a handshake
            any more: that number was a minute being spent on silence. */}
        {left !== undefined && (
          <span className={styles.clock} data-low={left <= 10_000} aria-live="polite">
            {clock(left)} left
          </span>
        )}

        <span className={styles.status} data-state={state}>
          <span className={styles.dot} aria-hidden />
          {LABEL[state]}
          {/* Held back three seconds so a normal, fast connect never shows a
              number. Past that, the wait is the news. */}
          {waited >= 3_000 ? ` ${Math.round(waited / 1000)}s` : ""}
        </span>

        {/* Who else is on the line. Not while this browser is queued: the
            queue notice below already says it, in more useful words. */}
        {traffic && traffic.max > 0 && !waiting && (
          <span className={styles.traffic} data-full={traffic.active >= traffic.max}>
            {traffic.active === 0
              ? "All lines free"
              : `${traffic.active} of ${traffic.max} ${traffic.active === 1 ? "line" : "lines"} busy`}
            {traffic.queued > 0 ? ` · ${traffic.queued} waiting` : ""}
          </span>
        )}
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

      {/* What Ariane is doing, while it is doing it. A pause on a government
          line is normally indistinguishable from a line that has died. */}
      {acts.length > 0 && live && (
        <ul className={styles.acts} aria-live="polite" aria-label="What Ariane is doing">
          {acts.map((act) => (
            <li key={act.id} className={styles.act} data-ok={act.ok}>
              {act.ok ? act.label : `${act.label} — could not just now`}
            </li>
          ))}
        </ul>
      )}

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

      {/* The plan, drawn while it is being spoken. The voice says the count and
          the first thing to do; the screen is where the other eleven lines can
          live without anybody having to hold them in their head. */}
      {plan && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{plan.title}</strong>
            <span className="small faint">{plan.jurisdiction}</span>
          </div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            {plan.summary}
          </p>

          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            {plan.services.map((s) => (
              <span key={s.id} className="tag accent">
                {s.name}
              </span>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            {plan.checklist.map((item) => (
              <div key={item.stepId} className={styles.line}>
                <b>{item.order}</b>
                <span>
                  {item.title}
                  <span className="small faint">
                    {" "}
                    · {item.forService}
                    {item.alsoFor.length ? ` and ${item.alsoFor.join(", ")}` : ""}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {plan.offices.length > 0 && (
            <p className="small muted" style={{ margin: "10px 0 0" }}>
              Where you will have to go: {plan.offices.map((o) => o.name).join(", ")}.
            </p>
          )}

          {/* A plan one service short reads exactly like a complete one, so the
              gap is on screen rather than only in the payload. */}
          {plan.unknownGoals.length > 0 && (
            <p className="small" style={{ color: "var(--warn)", margin: "10px 0 0" }}>
              {plan.unknownGoals.length} part{plan.unknownGoals.length === 1 ? " is" : "s are"} not mapped yet and{" "}
              {plan.unknownGoals.length === 1 ? "is" : "are"} not on this list.
            </p>
          )}

          {plan.unverified && (
            <p className="small" style={{ color: "var(--warn)", margin: "10px 0 0" }}>
              Parts of this were read by machine and not yet checked by a person.
            </p>
          )}

          <a className="small" href={`/plan?q=${encodeURIComponent(plan.title)}`}>
            Open this plan, with the map
          </a>
        </div>
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
