import { readFileSync } from "node:fs";
import { journeyBundleNames } from "../data/graph/manifest";
import type { GraphBundle } from "../data/index";
import { loadGraph } from "../data/index";
import type { GraphNode, VerificationStatus } from "../types";

/**
 * What we actually know, and how well we know it.
 *
 *   pnpm coverage            every journey
 *   pnpm coverage --json     the same numbers for /admin/coverage
 *   pnpm coverage --check    fail if a journey is not fit to show a citizen
 *
 * `graph:stats` counts nodes. This counts *confidence*, which is a different
 * question and the one that decides whether a journey is ready to put in front
 * of somebody. A journey with ninety nodes and no quote on any of them is worse
 * than a journey with nine, because it looks finished.
 *
 * Nothing here is new logic. `validateGraph` already returns issues,
 * `GraphIndex` already resolves sources, and the research files already record
 * what could not be found. This puts the three in one table.
 */

const args = process.argv.slice(2);
const read = (url: URL) => JSON.parse(readFileSync(url, "utf8"));

/**
 * Nodes a citizen is actually routed through.
 *
 * A PORTAL with no quote is a url we typed off the page; nobody is misled. A
 * SERVICE, DOCUMENT or ELIGIBILITY with no quote is us telling somebody what
 * their government requires of them on no authority at all, so those are the
 * ones counted.
 */
const LOAD_BEARING = new Set<GraphNode["type"]>(["SERVICE", "DOCUMENT", "DOCUMENT_GROUP", "ELIGIBILITY", "ACTION", "PAYMENT", "VERIFICATION"]);

export interface JourneyCoverage {
  journey: string;
  services: number;
  documents: number;
  offices: number;
  helplines: number;
  edges: number;
  sources: number;
  /** How each SourceRef in the bundle describes its own standing. */
  byStatus: Partial<Record<VerificationStatus, number>>;
  /** Load bearing nodes carrying no evidence at all. The number that matters. */
  unsourced: string[];
  /** Things the researcher looked for and could not find, in their own words. */
  notFound: number;
  /** Sources cited but never fetched, so nothing can be quoted from them. */
  unfetched: number;
}

export function coverageOf(name: string): JourneyCoverage {
  const bundle: GraphBundle = read(new URL(`../data/graph/${name}.json`, import.meta.url));
  let research: { notFound?: unknown[]; sources?: { scrapedOk?: boolean }[] } = {};
  try {
    research = read(new URL(`../../../../docs/research/${name}.json`, import.meta.url));
  } catch {
    // A bundle with no research file is a bundle nobody can audit. quotes:audit
    // is the gate that says so; here it is simply zero evidence.
  }

  const of = (type: GraphNode["type"]) => bundle.nodes.filter((n) => n.type === type).length;
  const byStatus: Partial<Record<VerificationStatus, number>> = {};
  for (const holder of [...bundle.nodes, ...bundle.edges, ...bundle.requirementGroups]) {
    for (const ref of holder.sources ?? []) {
      // A ref that never said how well it is known is counted as DISCOVERED,
      // the weakest thing the enum can say. Dropping it would quietly shrink
      // the denominator and make the journey look better evidenced than it is.
      const status = ref.verificationStatus ?? "DISCOVERED";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
  }

  return {
    journey: name,
    services: of("SERVICE"),
    documents: of("DOCUMENT") + of("DOCUMENT_GROUP"),
    offices: of("OFFICE"),
    helplines: of("HELPLINE") + of("GRIEVANCE_CHANNEL"),
    edges: bundle.edges.length,
    sources: bundle.sources.length,
    byStatus,
    unsourced: bundle.nodes.filter((n) => LOAD_BEARING.has(n.type) && !n.sources?.length).map((n) => n.id),
    notFound: research.notFound?.length ?? 0,
    unfetched: (research.sources ?? []).filter((s) => s.scrapedOk === false).length,
  };
}

const all = [...journeyBundleNames].map(coverageOf);

if (args.includes("--json")) {
  const data = loadGraph();
  console.log(JSON.stringify({ generatedBy: "pnpm coverage", services: data.nodes.filter((n) => n.type === "SERVICE").length, journeys: all }, null, 2));
  process.exit(0);
}

// ------------------------------------------------------------------ the table

const columns: [string, (c: JourneyCoverage) => string][] = [
  ["journey", (c) => c.journey],
  ["services", (c) => String(c.services)],
  ["docs", (c) => String(c.documents)],
  ["offices", (c) => String(c.offices)],
  ["edges", (c) => String(c.edges)],
  ["sources", (c) => String(c.sources)],
  ["verified", (c) => String(c.byStatus.VERIFIED ?? 0)],
  ["extracted", (c) => String(c.byStatus.EXTRACTED ?? 0)],
  ["conflicting", (c) => String(c.byStatus.CONFLICTING ?? 0)],
  ["unsourced", (c) => String(c.unsourced.length)],
  ["not found", (c) => String(c.notFound)],
];

const rows = [columns.map(([h]) => h), ...all.map((c) => columns.map(([, f]) => f(c)))];
const widths = columns.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
for (const [i, row] of rows.entries()) {
  console.log(row.map((cell, j) => (j === 0 ? cell.padEnd(widths[j] ?? 0) : cell.padStart(widths[j] ?? 0))).join("  "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("  "));
}

const total = (pick: (c: JourneyCoverage) => number) => all.reduce((sum, c) => sum + pick(c), 0);
console.log(
  `\n${total((c) => c.services)} services across ${all.length} journeys. ` +
    `${total((c) => c.byStatus.VERIFIED ?? 0)} citation(s) a person checked, ` +
    `${total((c) => c.byStatus.EXTRACTED ?? 0)} a machine did.`,
);

const unsourced = all.flatMap((c) => c.unsourced);
if (unsourced.length) {
  console.log(`\n${unsourced.length} load bearing node(s) with no evidence at all:`);
  for (const id of unsourced.slice(0, 20)) console.log(`  ${id}`);
  if (unsourced.length > 20) console.log(`  ...and ${unsourced.length - 20} more`);
}

const unfetched = total((c) => c.unfetched);
if (unfetched) console.log(`\n${unfetched} source(s) cited but never successfully fetched. Recorded as a gap, never as a citation.`);

// --------------------------------------------------------------------- --check

if (args.includes("--check")) {
  // One rule, and it is the only one worth failing a build over: we never tell a
  // citizen their government requires something without being able to show them
  // where we read it.
  if (unsourced.length) {
    console.error(`\n${unsourced.length} load bearing node(s) claim a government requirement with no source.`);
    process.exit(1);
  }
  console.log("\nEvery load bearing node can show its working.");
}
