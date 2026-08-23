import type { GraphData } from "../types";
import * as escalation from "./escalation";
import { jurisdictions } from "./jurisdictions";
import * as drivingLicence from "./journeys/driving-licence";

export { validateGraph, type GraphIssue } from "./validate";

/**
 * The single seam the rest of the product loads data through.
 *
 * Today this is hand seeded TypeScript, verified line by line against official
 * pages. When Supabase is wired up, this function starts returning rows and
 * nothing above it changes.
 */

const journeys = [drivingLicence];

let cached: GraphData | undefined;

export function loadGraph(): GraphData {
  if (cached) return cached;
  const nodes = journeys.flatMap((j) => j.nodes);
  cached = {
    jurisdictions,
    nodes: [...nodes, ...escalation.nodes],
    edges: [
      ...journeys.flatMap((j) => j.edges),
      ...escalation.edges,
      ...escalation.attachEscalation(nodes.filter((n) => n.type === "SERVICE")),
    ],
    requirementGroups: journeys.flatMap((j) => j.requirementGroups),
    sources: [...journeys.flatMap((j) => j.sources), ...escalation.sources],
    questions: dedupeQuestions(journeys.flatMap((j) => j.questions)),
  };
  return cached;
}

/** Journeys share fields like `age`. First definition wins. */
function dedupeQuestions<T extends { field: string }>(questions: T[]): T[] {
  const seen = new Set<string>();
  return questions.filter((q) => !seen.has(q.field) && seen.add(q.field));
}
