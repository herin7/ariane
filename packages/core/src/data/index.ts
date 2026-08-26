import type { GraphData, GraphEdge, GraphNode, Jurisdiction, RequirementGroup, Source } from "../types";

export { validateGraph, type GraphIssue } from "./validate";

/**
 * The single seam the rest of the product loads data through.
 *
 * No government fact lives in TypeScript. Schemes, documents, offices, fees,
 * eligibility rules and the quotes behind them are rows, because government
 * requirements change and a fact that needs a rebuild and a redeploy to
 * correct is a fact that stays wrong. Code holds the compiler and the rule
 * evaluator, nothing else.
 *
 * No rows live here either. This file is the shape of a bundle and the
 * function that folds bundles into a graph; where the bundles come from is
 * `./providers`, which reads the disk and is therefore server only. Keeping
 * that split means a client component can import a type from `@ariane/core`
 * without a bundler deciding to ship it a database driver.
 */

/** One journey's worth of rows. The unit both the seed files and the DB use. */
export interface GraphBundle {
  id: string;
  sources: Source[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  requirementGroups: RequirementGroup[];
  questions: GraphData["questions"];
  /**
   * Escalation only. CPGRAMS and SWAGAT are not tied to one department, so
   * rather than writing the same two edges onto forty services by hand they
   * are stored once with `*` where the service id goes, and stamped out at
   * load time. Kept apart from `edges` because `*` is not a node and the
   * validator is right to say so.
   */
  edgeTemplates?: GraphEdge[];
}

/**
 * The journey bundles, without the shared escalation templates.
 *
 * `escalation` is stored as one bundle of `*` templates rather than as edges on
 * forty services, so anything that walks "one journey at a time" has to leave
 * it out or it counts a bundle that has no journey.
 */
export const journeysOf = (bundles: GraphBundle[]): GraphBundle[] => bundles.filter((b) => !b.edgeTemplates?.length);

export function loadGraphFrom(bundles: GraphBundle[], jurisdictions: Jurisdiction[]): GraphData {
  const nodes = bundles.flatMap((b) => b.nodes);
  const templates = bundles.flatMap((b) => b.edgeTemplates ?? []);
  const services = nodes.filter((n) => n.type === "SERVICE");

  return {
    jurisdictions,
    nodes,
    edges: [
      ...bundles.flatMap((b) => b.edges),
      ...services.flatMap((s) => templates.map((t) => ({ ...t, id: t.id.replace("*", s.id), from: s.id }))),
    ],
    requirementGroups: bundles.flatMap((b) => b.requirementGroups),
    sources: dedupeBy(bundles.flatMap((b) => b.sources), (s) => s.id),
    questions: dedupeBy(bundles.flatMap((b) => b.questions), (q) => q.field),
  };
}

/**
 * The database backed loader lives in `../server`, not here, and is reached
 * through `@ariane/core/server`. A browser bundle that can see it drags the
 * whole Supabase SDK in behind it, which is 64kB of a citizen's data plan
 * spent on a client that will never open a socket to Postgres.
 */

/**
 * First definition wins.
 *
 * Journeys share question fields like `age`. They also share sources now: a
 * page found while researching property records can answer a question about a
 * permit, so the same url is cited from two bundles. The compiler writes one
 * canonical row per url, so the copies are identical and merging them loses
 * nothing.
 */
function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && seen.add(key(item)));
}
