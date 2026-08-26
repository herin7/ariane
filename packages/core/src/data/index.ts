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

/**
 * Everything in one order, whichever plane the rows arrived on.
 *
 * Array order is not cosmetic here. The compiler's topological sort has no rule
 * for two steps a source never numbered against each other, so it falls back to
 * the order it was handed — which means the order of these arrays is part of
 * what a citizen is told to do first.
 *
 * The two planes hand it different orders. `readAll` in `../db/supabase` reads
 * every table with `.order(id)`, so a graph from Postgres arrives sorted by id.
 * A `.graph` built by the ingest pipeline arrives in pipeline order. Same rows,
 * two answers, and `pnpm gates:integration` was asserting the one production
 * does not serve.
 *
 * So ordering is decided once, here, rather than by whichever provider ran:
 * bundles journeys-first and template-packs-last (`dedupeBy` is first-wins, so
 * that is which duplicate question a citizen is asked), rows inside a bundle by
 * id. `localeCompare` and not a code point sort because Postgres is the plane
 * being matched and it collates `_` and `:` differently — of the 54 populated
 * arrays in the live graph, all 54 match locale order and only 35 match code
 * point order.
 *
 * This canonicalises, it does not re-rank: it is a no-op on rows that came from
 * Postgres, which is the plane citizens are served from.
 *
 * ponytail: array order as the tie-break is the actual problem, and 124 services
 * compile the same step set in an order that depends on it. The fix is data — an
 * ordering edge, so the tie stops being a tie — and it changes which step 81
 * services name first, so it is a product decision and not this pass's.
 */
export function loadGraphFrom(rawBundles: GraphBundle[], jurisdictions: Jurisdiction[]): GraphData {
  const packs = rawBundles.filter((b) => b.edgeTemplates?.length);
  const bundles = [...byId(journeysOf(rawBundles)), ...byId(packs)].map(canonical);

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

const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));

/** One bundle's rows in id order. `questions` is keyed by field, as it is in the database. */
const canonical = (b: GraphBundle): GraphBundle => ({
  ...b,
  sources: byId(b.sources),
  nodes: byId(b.nodes),
  edges: byId(b.edges),
  requirementGroups: byId(b.requirementGroups),
  questions: [...b.questions].sort((a, z) => a.field.localeCompare(z.field)),
  edgeTemplates: b.edgeTemplates && byId(b.edgeTemplates),
});

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
