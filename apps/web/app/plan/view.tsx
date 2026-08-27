"use client";

import type { CompiledPlan, DerivedQuestion, Facts, PlanItem } from "@ariane/core";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { Offices } from "../journey/offices";
import { Question, Step } from "../journey/view";

/**
 * A life event, answered as a plan.
 *
 * "I want to start a company" is five services and nobody's website says so.
 * The journey page answers one goal; this one answers the sentence, and the
 * difference is entirely in `/api/plans/compose`, not here. This file draws
 * what came back and posts answers back at it.
 *
 * Two question sets and they are not interchangeable:
 *
 *   scoping    which services belong in the plan at all. A model asked these,
 *              and answering one changes the checklist, not just its length.
 *   derived    the graph's own, off conditional edges, exactly as on /journey.
 *
 * The tick boxes are the citizen's, kept in this browser and nowhere else. A
 * checklist you cannot tick is a document, not a tool, and a checklist that
 * needs an account to remember a tick is worse than a printed one.
 */

interface PlanResponse extends CompiledPlan {
  title?: string;
  inferred?: boolean;
  scopingQuestions?: {
    id: string;
    label: string;
    help?: string;
    options: { value: string; label: string }[];
    multi?: boolean;
  }[];
}

const DONE_KEY = (intent: string) => `ariane.plan.done.${intent.trim().toLowerCase().slice(0, 120)}`;

export function PlanView({ districts }: { districts: string[] }) {
  const text = useSearchParams().get("q") ?? "";

  const [district, setDistrict] = useState(districts[0] ?? "Ahmedabad");
  const [scoping, setScoping] = useState<Record<string, string | string[]>>({});
  const [answers, setAnswers] = useState<Facts>({});
  const [held, setHeld] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[] | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // §10: that a plan was asked for, never the sentence that asked for it.
  useEffect(() => {
    track("plan_started");
  }, []);

  // Ticks survive a refresh, a recompile and closing the tab. Same browser
  // only: nothing about a plan is worth sending anywhere.
  useEffect(() => {
    if (!text) return;
    try {
      const saved = window.localStorage.getItem(DONE_KEY(text));
      if (saved) setDone(JSON.parse(saved) as string[]);
    } catch {
      // Private mode, quota, a value somebody edited. An unticked list is fine.
    }
  }, [text]);

  const tick = useCallback(
    (nodeId: string) => {
      setDone((current) => {
        const next = current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId];
        try {
          window.localStorage.setItem(DONE_KEY(text), JSON.stringify(next));
        } catch {
          // Ticking still works for this visit.
        }
        return next;
      });
    },
    [text],
  );

  // Every input that changes the plan, as one string. Taking a service off the
  // plan has to recompile it, and the response setting `goals` must not: the
  // request that produced a plan records the key its own answer will produce,
  // so the render that follows it recognises the work as already done.
  const requestKey = JSON.stringify({ text, district, scoping, answers, held, goals });
  const fetched = useRef("");

  useEffect(() => {
    if (!text && !goals?.length) return;
    if (requestKey === fetched.current) {
      setPending(false);
      return;
    }
    fetched.current = requestKey;
    let live = true;
    setPending(true);
    fetch("/api/plans/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        jurisdiction: { country: "India", state: "Gujarat", district },
        answers: scoping,
        citizen: { answers, documents: held },
        ...(goals ? { goals } : {}),
      }),
    })
      .then(async (response) => {
        const body = (await response.json()) as PlanResponse & { error?: string };
        if (!live) return;
        if (body.error) {
          setError(body.error);
          return;
        }
        setError(null);
        setPlan(body);
        // The goals the model chose become the citizen's, so answering a
        // derived question later recompiles the same plan instead of asking a
        // model to plan the sentence a second time and possibly differently.
        if (!goals) {
          const chosen = body.tracks.map((t) => t.goal);
          fetched.current = JSON.stringify({ text, district, scoping, answers, held, goals: chosen });
          setGoals(chosen);
        }
      })
      .catch(() => live && setError("We could not build that plan just now."))
      .finally(() => live && setPending(false));
    return () => {
      live = false;
    };
  }, [text, district, scoping, answers, held, goals, requestKey]);

  if (!text) {
    return (
      <div className="search-message">
        <h3>Say what you are trying to do</h3>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          Try &ldquo;I want to start a company&rdquo; or &ldquo;my father died and I need to sort out the paperwork&rdquo;.
        </p>
        {/* There is no box on this page on purpose: one search box, on the
            front page, and it decides whether a sentence is one service or
            several. Two boxes asking the same question is the thing a citizen
            has to guess between. */}
        <a className="small" href="/#start">Say what you need &rarr;</a>
      </div>
    );
  }

  const scopingQuestions = plan?.scopingQuestions ?? [];
  const derived = plan?.questions ?? [];
  const remaining = plan ? plan.checklist.filter((i) => !done.includes(i.step.nodeId)).length : 0;

  return (
    <div className="stack" style={{ opacity: pending && plan ? 0.55 : 1, transition: "opacity .2s" }}>
      <header>
        <p className="page-eyebrow">Your plan</p>
        <h1>{plan?.title ?? text}</h1>
        {plan?.inferred ? (
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            We read your sentence and picked {plan.tracks.length} service{plan.tracks.length === 1 ? "" : "s"} that
            already exist in Ariane. Nothing here was invented; remove anything that is not yours.
          </p>
        ) : null}

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <label className="small muted" htmlFor="district">Where you are</label>
          <select id="district" value={district} onChange={(e) => setDistrict(e.target.value)}>
            {districts.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
      </header>

      {error ? (
        <div className="card blocked">
          <p className="small" style={{ margin: 0 }}>{error}</p>
        </div>
      ) : null}

      {!plan && pending ? <Loading /> : null}

      {/* A sentence the graph has nothing for, or a plan the citizen emptied
          themselves. Both end here rather than on a page reading "0 services,
          0 of 0 left to do", which is the shape of a bug and not an answer. */}
      {plan && !plan.tracks.length ? (
        <div className="card blocked">
          {goals?.length === 0 ? (
            <>
              <p className="small" style={{ margin: 0 }}><b>Nothing left in this plan.</b></p>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                You took every service off it. Put them back and start again from the sentence.
              </p>
              <button className="tiny" style={{ marginTop: 10 }} onClick={() => setGoals(null)}>
                Start this plan again
              </button>
            </>
          ) : (
            <>
              <p className="small" style={{ margin: 0 }}><b>We have not mapped this one yet.</b></p>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                Nothing in Ariane matches that sentence, and a plausible guess at the services involved would be
                worse than saying so. Naming one thing you need &mdash; a certificate, a licence, a card &mdash; usually
                finds it.
              </p>
              <a className="small" href="/#start" style={{ display: "inline-block", marginTop: 10 }}>
                Try a different sentence &rarr;
              </a>
            </>
          )}
        </div>
      ) : null}

      {plan && plan.tracks.length ? (
        <>
          <div className="row" style={{ gap: 8 }}>
            <span className="tag accent">{plan.tracks.length} service{plan.tracks.length === 1 ? "" : "s"}</span>
            <span className="tag accent">{remaining} of {plan.checklist.length} left to do</span>
            {plan.documents.length ? (
              <span className="tag accent">{plan.documents.length} document{plan.documents.length === 1 ? "" : "s"}</span>
            ) : null}
            {plan.offices.length ? (
              <span className="tag accent">{plan.offices.length} office{plan.offices.length === 1 ? "" : "s"} to visit</span>
            ) : null}
            {plan.unverified ? <span className="tag warn">parts read by machine</span> : null}
          </div>

          {/* The services in the plan, and the door out of one that is not
              yours. A plan you cannot edit is a plan you have to argue with. */}
          <div className="card">
            <p className="small" style={{ margin: "0 0 8px" }}><b>What this involves</b></p>
            <div className="stack" style={{ gap: 6 }}>
              {plan.tracks.map((t, i) => (
                <div key={t.goal} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="small">
                    <b>{i + 1}. {t.goalName}</b>
                    {t.after.length ? (
                      <span className="muted"> — after {t.after.map((g) => name(plan, g)).join(", ")}</span>
                    ) : null}
                  </span>
                  <button
                    className="tiny"
                    onClick={() => setGoals((current) => (current ?? plan.tracks.map((x) => x.goal)).filter((g) => g !== t.goal))}
                  >
                    not mine
                  </button>
                </div>
              ))}
            </div>
            {plan.unknownGoals.length ? (
              <p className="small" style={{ margin: "10px 0 0", color: "var(--warn)" }}>
                We could not open {plan.unknownGoals.length} of the services this involves, so they are not on the list
                below. Ask about them separately rather than assuming they are done.
              </p>
            ) : null}
          </div>

          {/* Scoping first: these decide what is on the list, so answering one
              after working through the list would rewrite what you just read. */}
          {scopingQuestions.length ? (
            <section className="stack">
              <p className="stage-label">Answer these and the plan changes</p>
              {scopingQuestions.map((q) => (
                <div key={q.id} className="card rise">
                  <h3>{q.label}</h3>
                  {q.help ? <p className="muted small" style={{ margin: "4px 0 0" }}>{q.help}</p> : null}
                  <div className="row" style={{ marginTop: 12 }}>
                    {q.options.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => {
                          // A scoping answer changes which services apply, so
                          // the model plans again from scratch.
                          setGoals(null);
                          setScoping((current) => ({ ...current, [q.id]: o.value }));
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          <section className="stack">
            <p className="stage-label">Everything you have to do</p>
            {plan.checklist.map((item) => (
              <PlanRow
                key={item.step.nodeId}
                item={item}
                done={done.includes(item.step.nodeId)}
                onTick={() => tick(item.step.nodeId)}
                held={held}
                onHave={(id) => setHeld((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))}
              />
            ))}
          </section>

          {plan.documents.length ? (
            <section className="card">
              <p className="small" style={{ margin: "0 0 8px" }}><b>Everything to bring, once</b></p>
              <ul className="small" style={{ margin: 0 }}>
                {plan.documents.map((d) => (
                  <li key={d.nodeId}>
                    {d.name}
                    {d.forGoals.length > 1 ? <span className="muted"> — needed for {d.forGoals.join(", ")}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="small faint" style={{ margin: "10px 0 0" }}>
                A document two services want is one document. Take the original and a copy for each.
              </p>
            </section>
          ) : null}

          {/* Where to go, on a map, for the whole plan rather than per step. */}
          {plan.offices.length ? (
            <section className="stack">
              <p className="stage-label">Where you will have to go</p>
              <Offices offices={plan.offices} />
            </section>
          ) : null}

          {derived.length ? (
            <section className="stack" id="questions">
              <p className="stage-label">This gets shorter if you answer</p>
              {derived.map((q: DerivedQuestion) => (
                <Question
                  key={q.field}
                  question={q}
                  onAnswer={(value) => setAnswers((current) => ({ ...current, [q.field]: value as never }))}
                />
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** The service name for a goal id, when the plan holds it. */
const name = (plan: PlanResponse, goal: string): string => plan.tracks.find((t) => t.goal === goal)?.goalName ?? goal;

/**
 * One line of the checklist: the journey card, with a tick and the reason it is
 * on a plan rather than a journey.
 *
 * The card itself is `Step` from `/journey`, unchanged. Two renderings of a
 * government step that could drift apart is exactly the bug §23 keeps warning
 * about, and it would drift on the day somebody fixed a fee's formatting in one
 * of them.
 */
function PlanRow({
  item,
  done,
  onTick,
  held,
  onHave,
}: {
  item: PlanItem;
  done: boolean;
  onTick: () => void;
  held: string[];
  onHave: (id: string) => void;
}) {
  return (
    <div style={{ opacity: done ? 0.5 : 1 }}>
      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <label className="small row" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={done} onChange={onTick} aria-label={`Mark ${item.step.title} done`} />
          {done ? "Done" : "Not done"}
        </label>
        <span className="small muted">for {item.goalName}</span>
        {item.alsoFor.length ? (
          <span className="tag good" title="One thing, two services. Do it once.">
            also for {item.alsoFor.join(", ")}
          </span>
        ) : null}
      </div>
      <Step step={item.step} held={held} onHave={onHave} />
    </div>
  );
}

/** Shaped like the plan that is coming. Same idea as /journey's. */
function Loading() {
  const bar = (w: string, h = 14) => <div style={{ width: w, height: h, borderRadius: 6, background: "var(--paper-sunk)" }} />;
  return (
    <div className="stack" aria-busy="true" aria-label="Working out what this involves">
      {bar("60%", 30)}
      {bar("85%")}
      <div className="card">{bar("50%", 18)}<div style={{ height: 10 }} />{bar("80%")}</div>
      <div className="card">{bar("55%", 18)}<div style={{ height: 10 }} />{bar("70%")}</div>
    </div>
  );
}
