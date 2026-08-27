import { compilePlan } from "@ariane/core";
import type { CitizenContext, JurisdictionQuery } from "@ariane/core";
import { loadLiveGraph, planGoals } from "@ariane/core/server";
import { NextResponse } from "next/server";

/**
 * POST /api/plans/compose
 *
 * A life event in, a checklist out. "I want to start a company" is not one
 * service and `/api/journeys/compile` cannot answer it: this picks the services
 * the sentence actually involves, compiles each one, and merges them.
 *
 * Two kinds of question come back and they are not the same thing:
 *
 *   questions        derived from the graph, provably load-bearing, answered
 *                    into `citizen.answers` and re-posted
 *   scopingQuestions asked by the model, and they decide which services are in
 *                    the plan at all. Answered into `answers` and re-posted.
 *
 * Post the same text back with more answers and the plan gets narrower. Nothing
 * is remembered server side; the client holds the answers, which is also why
 * this route is a pure function of its body.
 */

/** Two model calls and a compile. The serverless default cuts that off. */
export const maxDuration = 60;

interface Body {
  text?: string;
  jurisdiction?: JurisdictionQuery;
  /** Answers to the model's scoping questions, keyed by question id. */
  answers?: Record<string, string | string[]>;
  /** Answers to the graph's own derived questions, plus documents held. */
  citizen?: CitizenContext;
  /** Skip the model and compile exactly these. Used when the citizen edits the plan. */
  goals?: string[];
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const text = body.text?.trim() ?? "";
  if (!text && !body.goals?.length) {
    return NextResponse.json({ error: "text or goals is required" }, { status: 400 });
  }

  const graph = await loadLiveGraph();
  const jurisdiction = body.jurisdiction ?? { country: "IN", state: "GJ" };

  // An explicit goal list is the citizen's, not a model's, so it is not
  // second-guessed. This is what "remove that licence, I don't sell food"
  // posts back.
  const planned = body.goals?.length
    ? { goals: body.goals, questions: [], inferred: false, title: undefined }
    : await planGoals(graph, text, body.answers ?? {});

  const plan = compilePlan(graph, {
    goals: planned.goals,
    jurisdiction,
    ...(body.citizen ? { citizen: body.citizen } : {}),
    ...(text ? { intent: text } : {}),
  });

  return NextResponse.json({
    ...plan,
    ...(planned.title ? { title: planned.title } : {}),
    inferred: planned.inferred,
    scopingQuestions: planned.questions,
  });
}
