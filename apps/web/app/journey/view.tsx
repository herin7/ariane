"use client";

import { officeLine, stageGroups, type Channel, type CompiledJourney, type DerivedQuestion, type Facts, type JourneyStep } from "@ariane/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The citizen product.
 *
 * Every time an answer changes we recompile the whole journey. There is no
 * client side rule logic and there never will be, because the moment the UI
 * starts deciding things it starts disagreeing with the graph.
 */

export function JourneyView({ districts }: { districts: string[] }) {
  const goal = useSearchParams().get("goal") ?? "driving_licence";

  const [district, setDistrict] = useState(districts[0] ?? "Ahmedabad");
  const [answers, setAnswers] = useState<Facts>({});
  const [held, setHeld] = useState<string[]>([]);
  const [journey, setJourney] = useState<CompiledJourney | null>(null);
  // A recompile after an answer used to blank the whole page back to one line
  // of grey text, which reads as having lost the thing you were reading. The
  // old journey stays on screen and dims instead. §20.
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The sticky prompt is only worth the space it takes once the thing it points
  // at has scrolled off. Shown unconditionally it sat on top of the questions
  // it was telling you to go and answer.
  const questionsRef = useRef<HTMLElement | null>(null);
  const [questionsVisible, setQuestionsVisible] = useState(true);

  useEffect(() => {
    const section = questionsRef.current;
    if (!section) return;
    const watcher = new IntersectionObserver(([entry]) => setQuestionsVisible(!!entry?.isIntersecting));
    watcher.observe(section);
    return () => watcher.disconnect();
  }, [journey]);

  useEffect(() => {
    let live = true;
    setPending(true);
    fetch("/api/journeys/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal,
        jurisdiction: { country: "India", state: "Gujarat", district },
        citizen: { answers, documents: held },
      }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (!live) return;
        if (!r.ok) { setError(body.error ?? "Something went wrong"); return; }
        setError(null);
        setJourney(body as CompiledJourney);
      })
      .catch(() => live && setError("Could not reach the compiler"))
      .finally(() => live && setPending(false));
    return () => { live = false; };
  }, [goal, district, answers, held]);

  if (error) {
    return (
      <div className="card rise">
        <h3>We could not build that path</h3>
        <p className="small muted">{error}</p>
        <Link href="/" className="small">Start again</Link>
      </div>
    );
  }

  if (!journey) return <Loading />;

  const questions = journey.outstandingQuestions;

  return (
    <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity var(--fast)" }}>
      <Link href="/" className="small muted" style={{ textDecoration: "none" }}>‹ Back</Link>

      <h1 style={{ marginTop: 14 }}>{journey.goalName}</h1>

      {/* §29. The result moment. Not "12 nodes matched": the thing a person
          came here to be told, said before any of the work is described. */}
      <p className="lede" style={{ marginBottom: 18 }}>
        You can do this. Here is the whole of it, in the order it actually happens.
      </p>

      <Summary journey={journey} />

      <div className="row small muted" style={{ marginTop: 14 }}>
        <label>
          Near{" "}
          <select
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            style={{ padding: "6px 10px", fontSize: 13.5 }}
          >
            {districts.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
        <span className="faint">
          Rules applied in order: {journey.jurisdiction.chain.join(" then ")}
        </span>
      </div>

      {questions.length ? (
        <section id="questions" ref={questionsRef}>
          {/* §6. How much is left, not which numbered step of a form you are
              standing on. Nobody has ever been reassured by "step 3 of 17". */}
          <h2>
            We only need {questions.length} more thing{questions.length === 1 ? "" : "s"}
          </h2>
          <div className="stack">
            {questions.map((q) => (
              <Question key={q.field} question={q} onAnswer={(v) => setAnswers((a) => ({ ...a, [q.field]: v }))} />
            ))}
          </div>
        </section>
      ) : null}

      {journey.blockers.length ? (
        <>
          <h2>What is blocking you</h2>
          <div className="stack">
            {journey.blockers.map((b) => (
              <div key={b.nodeId} className="card blocked rise">
                <h3>{b.title}</h3>
                <p className="small" style={{ margin: "6px 0 0" }}>{b.reason}</p>
                <p className="small muted" style={{ margin: "6px 0 0" }}>
                  {b.actor === "CITIZEN"
                    ? "You can act on this."
                    : `This is with the ${b.actor.toLowerCase()}. Applying again will not move it.`}
                </p>
                {b.resolution ? <p className="small" style={{ margin: "6px 0 0" }}>{b.resolution}</p> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2>Your path</h2>
      <Path
        steps={journey.orderedSteps}
        held={held}
        onHave={(id) => setHeld((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]))}
      />

      {journey.mobileApps.length ? (
        <>
          <h2>Official apps</h2>
          <div className="card quiet">
            {journey.mobileApps.map((a) => (
              <p key={a.nodeId} className="small" style={{ margin: "4px 0" }}>
                <b>{a.name}</b>
                {a.androidAppId ? (
                  <>
                    {" "}
                    <a href={`https://play.google.com/store/apps/details?id=${a.androidAppId}`} target="_blank" rel="noreferrer">
                      Android
                    </a>
                  </>
                ) : null}
                {a.iosAppId ? (
                  <>
                    {" "}
                    <a href={`https://apps.apple.com/in/app/id${a.iosAppId}`} target="_blank" rel="noreferrer">iOS</a>
                  </>
                ) : null}
                {a.note ? <span className="muted"> {a.note}</span> : null}
              </p>
            ))}
          </div>
        </>
      ) : null}

      <h2>If you get stuck</h2>
      {journey.helplines.length || journey.escalationPaths.length ? (
        <div className="card">
          {journey.helplines.map((c) => (
            <ChannelLine key={c.nodeId} channel={c} tag="call" />
          ))}
          {journey.escalationPaths.map((c) => (
            <ChannelLine key={c.nodeId} channel={c} tag="escalate" />
          ))}
          <p className="muted small" style={{ margin: "12px 0 0" }}>
            Applying again does not restart a stalled file. A tracked grievance does.
          </p>
        </div>
      ) : (
        <div className="card quiet">
          <p className="small muted" style={{ margin: 0 }}>
            No escalation route verified for this service yet. We would rather say that than send you
            somewhere we have not checked.
          </p>
        </div>
      )}

      {/* §11 on the citizen side: the reasoning is available, not imposed. */}
      <details style={{ marginTop: 32 }}>
        <summary>See how Ariane worked this out</summary>
        <div className="card quiet">
          {journey.trace.map((t, i) => (
            <p key={i} className="small" style={{ margin: "3px 0" }}>
              <span className="mono faint">{t.stage}</span> {t.detail}
            </p>
          ))}
          <p className="small" style={{ margin: "12px 0 0" }}>
            <Link href="/admin/graph">Open the same thing as a graph</Link>
          </p>
        </div>
      </details>

      {journey.warnings.length ? (
        <div className="card blocked" style={{ marginTop: 16 }}>
          {journey.warnings.map((w) => <p key={w} className="small" style={{ margin: "4px 0" }}>{w}</p>)}
        </div>
      ) : null}

      {/* §15. On a phone the one thing left to do does not scroll away. */}
      {questions.length && !questionsVisible ? (
        <div className="sticky-action">
          <a href="#questions" className="primary" style={{ flex: 1, textAlign: "center", padding: "13px 16px", borderRadius: "var(--r)", background: "var(--accent)", color: "var(--accent-ink)", textDecoration: "none", fontWeight: 600 }}>
            Answer {questions.length} question{questions.length === 1 ? "" : "s"} and this gets shorter
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** §20. Shaped like the page that is coming, not a spinner over nothing. */
function Loading() {
  const bar = (w: string, h = 14) => (
    <div style={{ width: w, height: h, borderRadius: 6, background: "var(--paper-sunk)" }} />
  );
  return (
    <div className="stack" aria-busy="true" aria-label="Building your path">
      <div style={{ height: 8 }} />
      {bar("70%", 34)}
      {bar("90%")}
      {bar("40%")}
      <div style={{ height: 16 }} />
      <div className="card">{bar("55%", 18)}<div style={{ height: 10 }} />{bar("85%")}</div>
      <div className="card">{bar("45%", 18)}<div style={{ height: 10 }} />{bar("75%")}</div>
    </div>
  );
}

function ChannelLine({ channel, tag }: { channel: Channel; tag: string }) {
  return (
    <div style={{ margin: "10px 0" }}>
      <p className="small" style={{ margin: 0 }}>
        <span className="tag">{tag}</span>{" "}
        {channel.url ? (
          <a href={channel.url} target="_blank" rel="noreferrer">{channel.name}</a>
        ) : (
          <b>{channel.name}</b>
        )}
      </p>
      {channel.phoneNumbers?.length || channel.emails?.length ? (
        <p className="small" style={{ margin: 0 }}>
          {channel.phoneNumbers?.map((p) => (
            <a key={p} href={`tel:${p.replace(/[^+\d]/g, "")}`} style={{ marginRight: 10 }}>{p}</a>
          ))}
          {channel.emails?.map((e) => (
            <a key={e} href={`mailto:${e}`} style={{ marginRight: 10 }}>{e}</a>
          ))}
          {channel.workingHours ? <span className="muted">{channel.workingHours}</span> : null}
        </p>
      ) : null}
      {channel.note ? <p className="small muted" style={{ margin: 0 }}>{channel.note}</p> : null}
      {channel.sources[0] ? (
        <p className="small" style={{ margin: 0 }}>
          <a href={channel.sources[0].source.url} target="_blank" rel="noreferrer" className="muted">
            {channel.sources[0].source.title}
          </a>
        </p>
      ) : (
        <p className="small faint" style={{ margin: 0 }}>Not verified yet.</p>
      )}
    </div>
  );
}

/**
 * §7. One line a person reads, not a scoreboard.
 *
 * This used to be six numbers in a row, each with a label under it, which is
 * the shape of an analytics dashboard and told a citizen nothing they could
 * act on. Same numbers, said the way somebody would say them.
 */
function Summary({ journey }: { journey: CompiledJourney }) {
  const s = journey.summary;
  const parts = [
    `${s.stepsRemaining} step${s.stepsRemaining === 1 ? "" : "s"} left`,
    s.documentsToPrepareCount ? `${s.documentsToPrepareCount} document${s.documentsToPrepareCount === 1 ? "" : "s"} to prepare` : "",
    s.physicalVisits ? `${s.physicalVisits} office visit${s.physicalVisits === 1 ? "" : "s"}` : "",
    s.digitalChannels && !s.physicalVisits ? "all of it online" : "",
  ].filter(Boolean);

  return (
    <div className="row" style={{ gap: 8 }}>
      {parts.map((p) => (
        <span key={p} className="tag accent">{p}</span>
      ))}
      {s.documentsReadyCount ? <span className="tag good">{s.documentsReadyCount} you already have</span> : null}
      {s.blockerCount ? (
        <span className="tag bad">{s.blockerCount} blocker{s.blockerCount === 1 ? "" : "s"}</span>
      ) : null}
    </div>
  );
}

function Question({ question, onAnswer }: { question: DerivedQuestion; onAnswer: (value: unknown) => void }) {
  const [draft, setDraft] = useState("");

  return (
    <div className="card rise">
      <h3>{question.label}</h3>
      {question.help ? <p className="muted small" style={{ margin: "4px 0 0" }}>{question.help}</p> : null}

      <div style={{ marginTop: 12 }}>
        {question.inputType === "SINGLE_SELECT" && question.options ? (
          <div className="row">
            {question.options.map((o) => (
              <button key={o.value} onClick={() => onAnswer(o.value)}>{o.label}</button>
            ))}
          </div>
        ) : question.inputType === "BOOLEAN" ? (
          <div className="row">
            <button onClick={() => onAnswer(true)}>Yes</button>
            <button onClick={() => onAnswer(false)}>No</button>
          </div>
        ) : (
          <form
            className="row"
            onSubmit={(e) => { e.preventDefault(); onAnswer(question.inputType === "NUMBER" ? Number(draft) : draft); }}
          >
            <input
              className="grow"
              type={question.inputType === "NUMBER" ? "number" : "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={question.label}
            />
            <button className="primary" disabled={draft === ""}>Answer</button>
          </form>
        )}
      </div>

      <p className="faint small" style={{ margin: "12px 0 0" }}>
        Nothing here is stored. It changes {question.affects.length} thing
        {question.affects.length === 1 ? "" : "s"} in your path.
      </p>
    </div>
  );
}

/**
 * The steps, hung off one thread, grouped by the part of the week they belong to.
 *
 * §16. Flat numbering was a lie by omission: 517 of 553 services have no
 * numbered process on any page we hold, so the citizen was reading "4." off a
 * list whose order nobody published. The heading is dropped when everything
 * lands in one stage, because a lone "Apply" over the only three steps there
 * are is furniture, not information.
 */
function Path({ steps, held, onHave }: { steps: JourneyStep[]; held: string[]; onHave: (id: string) => void }) {
  const groups = stageGroups(steps);
  return (
    <div className="thread">
      {groups.map((g) => (
        <section key={g.stage ?? "all"}>
          {groups.length > 1 ? <p className="stage-label">{g.label}</p> : null}
          <div className="stack">
            {g.steps.map((step) => (
              <Step key={step.nodeId} step={step} held={held} onHave={onHave} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * §10. What a citizen is entitled to know before believing a line on a screen.
 *
 * Three states, three sentences, one of which is an admission. The chip sits at
 * the top of the card rather than under the fee it is a caveat about, because a
 * disclaimer under the fee is a disclaimer nobody read before believing the fee.
 */
function trust(step: JourneyStep) {
  if (step.sources.some((s) => s.verificationStatus === "CONFLICTING")) {
    return { tone: "warn", label: "Official sources disagree" };
  }
  if (step.machineExtracted) return { tone: "warn", label: "Machine extracted" };
  if (step.sources.length) return { tone: "good", label: "Source verified" };
  return { tone: "", label: "Not verified yet" };
}

function Step({ step, held, onHave }: { step: JourneyStep; held: string[]; onHave: (id: string) => void }) {
  const tone =
    step.state === "BLOCKED" ? "bad" : step.state === "WAITING_EXTERNAL" ? "warn" : step.state === "SATISFIED" ? "good" : "";
  const mark = trust(step);
  const knot =
    step.state === "SATISFIED" ? "knot done" : step.state === "BLOCKED" ? "knot stop" : step.orderVerified ? "knot" : "knot dot";

  return (
    <div className={`card${step.state === "BLOCKED" ? " blocked" : ""}`}>
      {/* A number only where something published one. Everywhere else these are
          things to do, not a fourth thing to do after a third. §11. */}
      <span className={knot} title={step.orderVerified ? "The source numbers these steps." : "These are in no published order."}>
        {step.state === "SATISFIED" ? "✓" : step.orderVerified ? step.order : "•"}
      </span>

      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <span className={`tag ${mark.tone}`}>{mark.label}</span>
        {step.state !== "READY" ? <span className={`tag ${tone}`}>{step.state.replace("_", " ").toLowerCase()}</span> : null}
      </div>

      <h3>{step.title}</h3>
      {step.officialName && step.officialName !== step.title ? (
        <p className="faint small" style={{ margin: "2px 0 0" }}>Officially: {step.officialName}</p>
      ) : null}

      {step.machineExtracted ? (
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          Every line below is quoted from the government page it links to, but a machine did the
          reading. Open the source before you rely on it.
        </p>
      ) : null}

      {step.description ? <p className="small" style={{ margin: "8px 0 0" }}>{step.description}</p> : null}
      {step.whyRequired ? <p className="small muted" style={{ margin: "6px 0 0" }}>{step.whyRequired}</p> : null}
      {step.whatToDo ? <p className="small" style={{ margin: "8px 0 0" }}><b>Do this: </b>{step.whatToDo}</p> : null}
      {step.expectedOutput ? <p className="small" style={{ margin: "6px 0 0" }}><b>You get: </b>{step.expectedOutput}</p> : null}

      {step.fee || step.formNumber || step.timeline ? (
        <p className="small muted" style={{ margin: "10px 0 0" }}>
          {[step.fee && `Fee: ${step.fee}`, step.formNumber && `Form: ${step.formNumber}`, step.timeline]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
      ) : null}

      {step.documentsNeeded.length ? (
        <div style={{ marginTop: 14 }}>
          <p className="small" style={{ margin: "0 0 4px" }}><b>You will need</b></p>
          <ul className="small" style={{ margin: 0 }}>
            {step.documentsNeeded.map((d) => (
              <li key={d.nodeId}>
                {d.name}
                {d.alternatives?.length ? (
                  <span className="muted">
                    {" "}({d.mode === "ANY_OF" ? "any one of" : d.mode === "AT_LEAST_N" ? `any ${d.minimumRequired} of` : "all of"}
                    {": "}
                    {d.alternatives.map((a) => a.name).join(", ")})
                  </span>
                ) : null}
                {d.producedByServiceId ? <span className="muted"> (you get this from a step above)</span> : null}
                {!held.includes(d.nodeId) ? (
                  <button className="tiny" style={{ marginLeft: 8 }} onClick={() => onHave(d.nodeId)}>
                    I have this
                  </button>
                ) : null}
                {d.note ? <div className="evidence">{d.note}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step.documentsReady.length ? (
        <p className="small muted" style={{ margin: "10px 0 0" }}>
          Already have:{" "}
          {step.documentsReady.map((d) => (
            <span key={d.nodeId} style={{ marginRight: 8 }}>
              {d.name}
              {held.includes(d.nodeId) ? (
                // Misclicking "I have this" used to mean reloading the page.
                <button className="tiny" style={{ marginLeft: 4 }} onClick={() => onHave(d.nodeId)}>undo</button>
              ) : null}
            </span>
          ))}
        </p>
      ) : null}

      {step.channels.length || step.offices.length ? (
        <div className="stack" style={{ gap: 4, marginTop: 12 }}>
          {step.channels.map((c) => (
            <p key={`${c.nodeId}${c.via}`} className="small" style={{ margin: 0 }}>
              <span className="tag">{c.via.replace("_", " ").toLowerCase()}</span>{" "}
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
            </p>
          ))}
          {step.offices.map((o) => (
            <p key={o.nodeId} className="small" style={{ margin: 0 }}>
              <span className="tag">visit</span> {officeLine(o)}{" "}
              {/* An address is exactly the kind of fact §41 says never to
                  fabricate, so it carries its source on the same line as the
                  address rather than nowhere. */}
              {o.sources[0] ? (
                <a href={o.sources[0].source.url} target="_blank" rel="noreferrer" className="muted">
                  {o.sources.some((s) => s.verificationStatus === "CONFLICTING") ? "sources disagree" : "source"}
                </a>
              ) : (
                <span className="faint">Not verified yet.</span>
              )}
            </p>
          ))}
        </div>
      ) : null}

      {/* §9. Everything a person needs in order to act is above this line.
          Everything they need in order to check us is below it, one click away
          and never in the way. */}
      {step.eligibility?.length || step.couldBlock?.length || step.sources.length ? (
        <details style={{ marginTop: 8 }}>
          <summary>
            {step.sources.length
              ? `The proof, in the government's own words (${step.sources.length})`
              : "What the page says about this"}
          </summary>

          {step.eligibility?.length ? (
            <>
              {/* Quoted, not evaluated. We are not telling anyone they qualify. */}
              <p className="small" style={{ margin: "6px 0 2px" }}><b>Who the page says qualifies</b></p>
              <ul className="small">
                {step.eligibility.map((rule) => <li key={rule}>{rule}</li>)}
              </ul>
            </>
          ) : null}

          {step.couldBlock?.length ? (
            <>
              {/* Not a blocker. A blocker is somebody holding your application
                  and you can see it. These are the ones you find out about when
                  the money does not arrive. */}
              <p className="small" style={{ margin: "10px 0 2px" }}><b>What quietly stops this</b></p>
              <ul className="small" style={{ color: "var(--warn)" }}>
                {step.couldBlock.map((risk) => <li key={risk}>{risk}</li>)}
              </ul>
            </>
          ) : null}

          {step.sources.some((s) => s.verificationStatus === "CONFLICTING") ? (
            // §42. Four government pages quote four different pension amounts.
            // Picking one silently would be the single most damaging thing this
            // product could do, so the citizen gets told they disagree and gets
            // to read all of them.
            <p className="small" style={{ margin: "10px 0 0" }}>
              Official pages do not say the same thing here. Read all sides before you rely on it.
            </p>
          ) : null}

          {step.sources.map((s, i) => (
            <div key={i} className="evidence">
              {s.verificationStatus === "CONFLICTING" ? <span className="tag warn">disputed</span> : null}{" "}
              <span className="quote">&ldquo;{s.evidence}&rdquo;</span>
              <br />
              <a href={s.source.url} target="_blank" rel="noreferrer" className="small">{s.source.title}</a>{" "}
              <span className="faint small">retrieved {s.source.retrievedAt}</span>
              {s.source.tlsVerified === false ? (
                <>
                  {" "}
                  <span className="tag warn" title="This government site served a certificate we could not verify. The quote is what the page said; nothing proved the page was who it claimed to be.">
                    unverified certificate
                  </span>
                </>
              ) : null}
            </div>
          ))}
        </details>
      ) : (
        <p className="small faint" style={{ margin: "10px 0 0" }}>Not verified yet.</p>
      )}
    </div>
  );
}
