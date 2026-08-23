import type { GraphData, GraphEdge, GraphNode, Jurisdiction, RequirementGroup, Source } from "../types";
import { attachEscalation } from "./escalation";
import certificates from "./graph/certificates.json";
import drivingLicence from "./graph/driving-licence.json";
import escalation from "./graph/escalation.json";
import jurisdictionRows from "./graph/jurisdictions.json";
import pension from "./graph/pension.json";
import pf from "./graph/pf.json";
import scholarship from "./graph/scholarship.json";

export { validateGraph, type GraphIssue } from "./validate";

/**
 * The single seam the rest of the product loads data through.
 *
 * No government fact lives in TypeScript. Schemes, documents, offices, fees,
 * eligibility rules and the quotes behind them are rows, because government
 * requirements change and a fact that needs a redeploy to correct is a fact
 * that stays wrong. Code holds the compiler and the rule evaluator, nothing
 * else.
 *
 * The JSON under `graph/` is the seed: the same rows the database is loaded
 * from, checked in so tests, CI and a laptop with no network still work.
 * `loadGraphFrom` is what the database loader calls once rows are live.
 */

/** One journey's worth of rows. The unit both the seed files and the DB use. */
export interface GraphBundle {
  id: string;
  sources: Source[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  requirementGroups: RequirementGroup[];
  questions: GraphData["questions"];
}

/**
 * JSON arrives untyped and is cast here, once, at the only door it comes
 * through. What TypeScript used to catch at compile time, `validateGraph` now
 * catches at load time, including every enum. That check runs in CI and in
 * `pnpm graph:validate`, so a bad row fails the build the same as a bad type
 * used to.
 */
const bundles = [drivingLicence, certificates, scholarship, pf, pension] as unknown as GraphBundle[];
const escalationBundle = escalation as unknown as GraphBundle;
export const seedJurisdictions = jurisdictionRows as unknown as Jurisdiction[];

/** Every seeded journey, for the tools that work a journey at a time. */
export const seedBundles: GraphBundle[] = bundles;

export function loadGraphFrom(journeys: GraphBundle[], jurisdictions: Jurisdiction[]): GraphData {
  const nodes = journeys.flatMap((j) => j.nodes);
  return {
    jurisdictions,
    nodes: [...nodes, ...escalationBundle.nodes],
    edges: [
      ...journeys.flatMap((j) => j.edges),
      ...escalationBundle.edges,
      ...attachEscalation(nodes.filter((n) => n.type === "SERVICE")),
    ],
    requirementGroups: journeys.flatMap((j) => j.requirementGroups),
    sources: [...journeys.flatMap((j) => j.sources), ...escalationBundle.sources],
    questions: dedupeQuestions(journeys.flatMap((j) => j.questions)),
  };
}

let cached: GraphData | undefined;

export function loadGraph(): GraphData {
  cached ??= loadGraphFrom(bundles, seedJurisdictions);
  return cached;
}

/** Journeys share fields like `age`. First definition wins. */
function dedupeQuestions<T extends { field: string }>(questions: T[]): T[] {
  const seen = new Set<string>();
  return questions.filter((q) => !seen.has(q.field) && seen.add(q.field));
}
