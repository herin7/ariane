"use client";

import type { Channel, CompiledJourney, DerivedQuestion, Facts, JourneyStep } from "@ariane/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The citizen product.
 *
 * Every time an answer changes we recompile the whole journey. There is no
 * client side rule logic and there never will be, because the moment the UI
 * starts deciding things it starts disagreeing with the graph.
 */

const GUJARAT_DISTRICTS = [
  "Ahmedabad", "Amreli", "Anand", "Aravalli", "Banaskantha", "Bharuch", "Bhavnagar", "Botad",
  "Chhota Udepur", "Dahod", "Dang", "Devbhoomi Dwarka", "Gandhinagar", "Gir Somnath", "Jamnagar",
  "Junagadh", "Kheda", "Kutch", "Mahisagar", "Mehsana", "Morbi", "Narmada", "Navsari", "Panchmahal",
  "Patan", "Porbandar", "Rajkot", "Sabarkantha", "Surat", "Surendranagar", "Tapi", "Vadodara", "Valsad",
];

export function JourneyView() {
  const goal = useSearchParams().get("goal") ?? "driving_licence";

  const [district, setDistrict] = useState("Ahmedabad");
  const [answers, setAnswers] = useState<Facts>({});
  const [held, setHeld] = useState<string[]>([]);
  const [journey, setJourney] = useState<CompiledJourney | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
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
      .catch(() => live && setError("Could not reach the compiler"));
    return () => { live = false; };
  }, [goal, district, answers, held]);

  if (error) return <p><Link href="/">Back</Link><br />{error}</p>;
  if (!journey) return <p className="muted">Compiling your path</p>;

  return (
    <>
      <Link href="/" className="small">Back</Link>
      <h1 style={{ marginTop: 12 }}>{journey.goalName}</h1>
      <p className="sub">
        {journey.jurisdiction.name}. Rules applied in order:{" "}
        <span className="small">{journey.jurisdiction.chain.join(" then ")}</span>
      </p>

      <div className="row">
        <label className="small muted">
          District{" "}
          <select value={district} onChange={(e) => setDistrict(e.target.value)}>
            {GUJARAT_DISTRICTS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
      </div>

      <Summary journey={journey} />

      {journey.outstandingQuestions.length ? (
        <>
          <h2>Answer these and the path gets shorter</h2>
          <p className="muted small" style={{ marginTop: -6 }}>
            We only ask what actually changes the graph. Nothing here is stored.
          </p>
          {journey.outstandingQuestions.map((q) => (
            <Question key={q.field} question={q} onAnswer={(v) => setAnswers((a) => ({ ...a, [q.field]: v }))} />
          ))}
        </>
      ) : null}

      {journey.blockers.length ? (
        <>
          <h2>What is blocking you</h2>
          {journey.blockers.map((b) => (
            <div key={b.nodeId} className="card blocked">
              <h3>{b.title}</h3>
              <p className="small">{b.reason}</p>
              <p className="small muted" style={{ margin: 0 }}>
                {b.actor === "CITIZEN"
                  ? "You can act on this."
                  : `This is with the ${b.actor.toLowerCase()}. Applying again will not move it.`}
              </p>
              {b.resolution ? <p className="small">{b.resolution}</p> : null}
            </div>
          ))}
        </>
      ) : null}

      <h2>Your path</h2>
      {journey.orderedSteps.map((step) => (
        <Step key={step.nodeId} step={step} held={held} onHave={(id) => setHeld((h) => [...h, id])} />
      ))}

      {journey.mobileApps.length ? (
        <>
          <h2>Official apps</h2>
          <div className="card">
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
          <p className="muted small" style={{ marginBottom: 0 }}>
            Applying again does not restart a stalled file. A tracked grievance does.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="small muted" style={{ margin: 0 }}>
            No escalation route verified for this service yet. We would rather say that than send you somewhere we
            have not checked.
          </p>
        </div>
      )}

      <h2>How we worked this out</h2>
      <div className="card">
        {journey.trace.map((t, i) => (
          <p key={i} className="small" style={{ margin: "2px 0" }}>
            <span className="muted">{t.stage}:</span> {t.detail}
          </p>
        ))}
      </div>

      {journey.warnings.length ? (
        <div className="card blocked">
          {journey.warnings.map((w) => <p key={w} className="small">{w}</p>)}
        </div>
      ) : null}
    </>
  );
}

function ChannelLine({ channel, tag }: { channel: Channel; tag: string }) {
  return (
    <div style={{ margin: "6px 0" }}>
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
        <p className="small muted" style={{ margin: 0 }}>
          <a href={channel.sources[0].source.url} target="_blank" rel="noreferrer">
            {channel.sources[0].source.title}
          </a>
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Not verified yet.</p>
      )}
    </div>
  );
}

function Summary({ journey }: { journey: CompiledJourney }) {
  const s = journey.summary;
  const items: [number, string][] = [
    [s.stepsRemaining, "steps left"],
    [s.documentsToPrepareCount, "documents to prepare"],
    [s.documentsReadyCount, "you already have"],
    [s.physicalVisits, "office visits"],
    [s.digitalChannels, "online"],
    [s.blockerCount, "blockers"],
  ];
  return (
    <div className="stat">
      {items.map(([value, label]) => (
        <div key={label}><b>{value}</b>{label}</div>
      ))}
    </div>
  );
}

function Question({ question, onAnswer }: { question: DerivedQuestion; onAnswer: (value: unknown) => void }) {
  const [draft, setDraft] = useState("");

  return (
    <div className="card">
      <h3>{question.label}</h3>
      {question.help ? <p className="muted small">{question.help}</p> : null}

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

      <p className="muted small" style={{ margin: "10px 0 0" }}>
        Changes {question.affects.length} thing{question.affects.length === 1 ? "" : "s"} in your path.
      </p>
    </div>
  );
}

function Step({ step, held, onHave }: { step: JourneyStep; held: string[]; onHave: (id: string) => void }) {
  const tone =
    step.state === "BLOCKED" ? "bad" : step.state === "WAITING_EXTERNAL" ? "warn" : step.state === "SATISFIED" ? "good" : "";

  return (
    <div className={`card${step.state === "BLOCKED" ? " blocked" : ""}`}>
      <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <span className="step-no">{step.order}</span>
        <div style={{ flex: 1 }}>
          <h3>
            {step.title} {step.state !== "READY" ? <span className={`tag ${tone}`}>{step.state.replace("_", " ")}</span> : null}
          </h3>
          {step.officialName && step.officialName !== step.title ? (
            <p className="muted small">Officially: {step.officialName}</p>
          ) : null}
          {step.whyRequired ? <p className="small">{step.whyRequired}</p> : null}
          {step.whatToDo ? <p className="small"><b>Do this: </b>{step.whatToDo}</p> : null}

          <p className="small muted">
            {[step.fee && `Fee: ${step.fee}`, step.formNumber && `Form: ${step.formNumber}`, step.timeline]
              .filter(Boolean)
              .join("  ·  ")}
          </p>

          {step.documentsNeeded.length ? (
            <>
              <p className="small" style={{ marginBottom: 2 }}><b>You will need</b></p>
              <ul className="small">
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
                    {d.producedByServiceId ? <span className="muted"> (you get this from step above)</span> : null}
                    {d.note ? <div className="evidence">{d.note}</div> : null}
                    {!held.includes(d.nodeId) ? (
                      <button className="small" style={{ padding: "1px 8px", marginLeft: 6 }} onClick={() => onHave(d.nodeId)}>
                        I have this
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {step.documentsReady.length ? (
            <p className="small muted">Already have: {step.documentsReady.map((d) => d.name).join(", ")}</p>
          ) : null}

          {step.channels.map((c) => (
            <p key={`${c.nodeId}${c.via}`} className="small" style={{ margin: "2px 0" }}>
              <span className="tag">{c.via.replace("_", " ")}</span>{" "}
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
            </p>
          ))}

          {step.offices.map((o) => (
            <p key={o.nodeId} className="small" style={{ margin: "2px 0" }}>
              <span className="tag">visit</span> {o.name}{" "}
              <span className="muted">{o.address ?? "address not verified yet"}</span>
            </p>
          ))}

          {step.sources.length ? (
            <details style={{ marginTop: 10 }}>
              <summary>Where this came from ({step.sources.length})</summary>
              {step.sources.map((s, i) => (
                <div key={i} className="evidence">
                  “{s.evidence}”
                  <br />
                  <a href={s.source.url} target="_blank" rel="noreferrer" className="small">{s.source.title}</a>{" "}
                  <span className="muted small">retrieved {s.source.retrievedAt}</span>
                </div>
              ))}
            </details>
          ) : (
            <p className="small muted">Not verified yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
