import { compileJourney, GoalNotFoundError } from "./journey";
import type {
  Channel,
  CitizenContext,
  CompiledJourney,
  DerivedQuestion,
  DocumentRequirement,
  GraphData,
  JourneyStep,
  JurisdictionQuery,
  OfficeRef,
} from "./types";

/**
 * Several journeys, answered as one.
 *
 * "I want to start a company" is not a service. It is a company registration, a
 * PAN, a GST registration, a Udyam registration, a shop and establishment
 * licence and possibly a food licence, and every one of those is a separate row
 * in the graph with its own documents, its own office and its own fee. Compiling
 * one of them and calling it the answer is how somebody registers a company and
 * finds out about the licence when an inspector tells them.
 *
 * So: compile each goal with the compiler that already exists, then merge.
 *
 * Everything here is deterministic, exactly like `journey.ts`. A model may have
 * chosen *which* goals (see `lang/plan.ts`, which can only pick ids that already
 * exist), but from this point on nothing is inferred: the order comes from
 * `prerequisiteServices`, the documents come from the compiled journeys, and a
 * step nobody published a sequence for still says so.
 */

export interface PlanRequest {
  /** Goal keys, in no particular order. Unknown ids are reported, not thrown. */
  goals: readonly string[];
  jurisdiction: JurisdictionQuery;
  citizen?: CitizenContext;
  /** What the citizen actually said, carried through for the UI heading. */
  intent?: string;
}

/** One service inside a plan, and where the citizen has got to on it. */
export interface PlanTrack {
  goal: string;
  goalName: string;
  summary: CompiledJourney["summary"];
  steps: JourneyStep[];
  documentsNeeded: DocumentRequirement[];
  offices: OfficeRef[];
  blockers: CompiledJourney["blockers"];
  outstandingQuestions: DerivedQuestion[];
  /** Goals in this plan that must happen before this one. */
  after: string[];
}

/** One line a citizen ticks off. Flat on purpose: a checklist is a flat thing. */
export interface PlanItem {
  /** 1..n across the whole plan, after the tracks are ordered. */
  order: number;
  goal: string;
  goalName: string;
  step: JourneyStep;
  /** Other goals in this plan that need the same step. Shown, not repeated. */
  alsoFor: string[];
}

export interface CompiledPlan {
  intent?: string;
  jurisdiction: CompiledJourney["jurisdiction"];
  tracks: PlanTrack[];
  checklist: PlanItem[];
  /** Every document across the plan, once, with who wants it. */
  documents: (DocumentRequirement & { forGoals: string[] })[];
  offices: OfficeRef[];
  digitalChannels: Channel[];
  helplines: Channel[];
  /** Every unanswered question across the plan, deduped by field. */
  questions: DerivedQuestion[];
  /** Goals asked for that no service in the graph matches. */
  unknownGoals: string[];
  /** True when any step in the plan was read by a machine and not a person. */
  unverified: boolean;
}

/**
 * Compile every goal, then put them in an order a person can act on.
 *
 * A goal that another goal names in `prerequisiteServices` comes first. That is
 * the graph's own statement, not a guess: a PAN is a prerequisite of a GST
 * registration because an edge says so. Goals with no such relationship keep the
 * order they were asked for, which is the order the model listed them and is
 * therefore at least somebody's reading of the request rather than alphabetical.
 */
export function compilePlan(graph: GraphData, request: PlanRequest): CompiledPlan {
  const unknownGoals: string[] = [];
  const compiled: CompiledJourney[] = [];

  for (const goal of dedupe(request.goals)) {
    try {
      compiled.push(compileJourney(graph, { goal, jurisdiction: request.jurisdiction, citizen: request.citizen }));
    } catch (error) {
      // A goal we cannot compile is dropped from the plan and named in it. The
      // alternative is a plan that is quietly one service short, which reads
      // exactly like a complete one.
      if (error instanceof GoalNotFoundError) unknownGoals.push(goal);
      else throw error;
    }
  }

  const ordered = sortByPrerequisite(compiled);

  const tracks: PlanTrack[] = ordered.map((journey) => ({
    goal: journey.goal,
    goalName: journey.goalName,
    summary: journey.summary,
    steps: journey.orderedSteps,
    documentsNeeded: journey.documentsNeeded,
    offices: journey.offices,
    blockers: journey.blockers,
    outstandingQuestions: journey.outstandingQuestions,
    after: ordered
      .filter((other) => other !== journey && journey.prerequisiteServices.includes(other.goal))
      .map((other) => other.goal),
  }));

  return {
    ...(request.intent ? { intent: request.intent } : {}),
    jurisdiction: ordered[0]?.jurisdiction ?? { resolvedId: "", chain: [], name: "" },
    tracks,
    checklist: checklistOf(ordered),
    documents: mergeDocuments(ordered),
    offices: uniqueBy(ordered.flatMap((j) => j.offices), (o) => o.nodeId),
    digitalChannels: uniqueBy(ordered.flatMap((j) => j.digitalChannels), (c) => c.nodeId),
    helplines: uniqueBy(ordered.flatMap((j) => j.helplines), (c) => c.nodeId),
    questions: uniqueBy(ordered.flatMap((j) => j.outstandingQuestions), (q) => q.field),
    unknownGoals,
    unverified: ordered.some((j) => j.orderedSteps.some((s) => s.machineExtracted)),
  };
}

/**
 * Prerequisites first, then the order asked for.
 *
 * Kahn's algorithm over the goals only, not over the whole graph: the compiler
 * has already resolved what each journey depends on, and `prerequisiteServices`
 * is that answer. A cycle between two goals cannot be ordered, so whatever is
 * left when nothing more can be emitted is appended in request order rather
 * than dropped. A plan missing a service is worse than a plan whose two
 * mutually-dependent services are in an arbitrary order, and the compiler
 * already warns about cycles.
 */
function sortByPrerequisite(journeys: readonly CompiledJourney[]): CompiledJourney[] {
  const inPlan = new Set(journeys.map((j) => j.goal));
  const waiting = new Map(
    journeys.map((j) => [j.goal, new Set(j.prerequisiteServices.filter((p) => inPlan.has(p) && p !== j.goal))]),
  );

  const out: CompiledJourney[] = [];
  const left = [...journeys];
  while (left.length) {
    const next = left.findIndex((j) => !waiting.get(j.goal)?.size);
    if (next < 0) break;
    const [taken] = left.splice(next, 1);
    if (!taken) break;
    out.push(taken);
    for (const set of waiting.values()) set.delete(taken.goal);
  }
  return [...out, ...left];
}

/**
 * The tracks flattened into one list, with a step that two services both need
 * appearing once.
 *
 * Deduped by node id, and the duplicate is not thrown away silently: it becomes
 * `alsoFor`, so the citizen who is told to get a PAN sees that it unblocks both
 * the company and the GST registration. That is the single most useful thing a
 * multi-service plan can say that a single journey cannot.
 */
function checklistOf(journeys: readonly CompiledJourney[]): PlanItem[] {
  const byNode = new Map<string, PlanItem>();
  for (const journey of journeys) {
    for (const step of journey.orderedSteps) {
      const seen = byNode.get(step.nodeId);
      if (seen) {
        if (!seen.alsoFor.includes(journey.goalName)) seen.alsoFor.push(journey.goalName);
        continue;
      }
      byNode.set(step.nodeId, { order: 0, goal: journey.goal, goalName: journey.goalName, step, alsoFor: [] });
    }
  }
  return [...byNode.values()].map((item, i) => ({ ...item, order: i + 1 }));
}

/** Every document once, carrying the names of the services that want it. */
function mergeDocuments(journeys: readonly CompiledJourney[]): (DocumentRequirement & { forGoals: string[] })[] {
  const byNode = new Map<string, DocumentRequirement & { forGoals: string[] }>();
  for (const journey of journeys) {
    for (const doc of journey.documentsNeeded) {
      const seen = byNode.get(doc.nodeId);
      if (seen) {
        if (!seen.forGoals.includes(journey.goalName)) seen.forGoals.push(journey.goalName);
        continue;
      }
      byNode.set(doc.nodeId, { ...doc, forGoals: [journey.goalName] });
    }
  }
  return [...byNode.values()];
}

const dedupe = (values: readonly string[]): string[] => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const value of values) if (!seen.has(key(value))) seen.set(key(value), value);
  return [...seen.values()];
}
