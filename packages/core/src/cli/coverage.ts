import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { journeyBundleNames } from "../data/graph/manifest";
import type { GraphBundle } from "../data/index";
import { loadGraph } from "../data/index";
import { GraphIndex } from "../graph";
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
  /**
   * Things we looked for and could not find, in the words they were recorded in.
   *
   * Carried as prose rather than a count on purpose. "9" says a journey has
   * gaps; "digitalgujarat.gov.in is hard-blocked from scraping, so only the
   * Mahesana evidence list could be verified officially" says which gap, and
   * that is the sentence that decides whether a citizen should trust the rest
   * of the page. A count of the things we admit to is not an admission.
   */
  notFound: string[];
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
    // Strings only. Two of the fourteen research files were hand written and
    // nothing stops the next one recording a gap as an object.
    notFound: (research.notFound ?? []).filter((n): n is string => typeof n === "string"),
    unfetched: (research.sources ?? []).filter((s) => s.scrapedOk === false).length,
  };
}

/** Every journey, in manifest order. What `/admin/coverage` renders. */
export function coverage(): JourneyCoverage[] {
  return [...journeyBundleNames].map(coverageOf);
}

// --------------------------------------------------------------------- depth
//
// The journey table answers "do we have evidence". This answers "how much of
// the journey do we actually know", which is a different failure: a service
// with a source, a portal link and nothing else passes every gate in this repo
// and still cannot tell a citizen what to bring.

/**
 * The ten things a citizen needs before a service page is any use to them.
 *
 * Each is a question the graph can answer or cannot, read off edges and node
 * metadata. Nothing here is hardcoded per service; every count is computed.
 */
const DIMENSIONS = [
  "source",
  "application channel",
  "required documents",
  "eligibility",
  "ordered actions",
  "tracking",
  "physical office",
  "helpline",
  "escalation",
  "produced output",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export interface DepthReport {
  services: number;
  /** How many services can answer each question. */
  byDimension: Record<Dimension, number>;
  /** Services grouped by how many ACTION steps their journey has. */
  steps: { one: number; twoToThree: number; fourToSix: number; sevenPlus: number };
  /**
   * Services whose own page printed a sequence, not ones we arranged.
   *
   * §11 forbids inventing a total order and `uiStage` deliberately is not one,
   * so "has four steps" and "knows which comes first" are separate claims and
   * this is the second. Counted off `stepNumber`, which only exists when a
   * source numbered the step, and only from two upwards because a lone "1." is
   * not a sequence.
   */
  ordered: number;
  /** Distribution of how many of the ten dimensions each service can answer. */
  answered: number[];
  /**
   * The same distribution as three buckets, which is the shape §23 asks for.
   *
   * A mean of 4.6 is the number that hides the problem: it reads as every
   * service being half mapped when it is really a deep minority carrying a
   * long shallow tail. `thin` is the count that should be falling.
   */
  buckets: { thin: number; middling: number; deep: number };
  pdfs: { parsed: number; pages: number; pageUnits: number; unreadable: number };
}

export function depth(): DepthReport {
  const data = loadGraph();
  const index = new GraphIndex(data);
  const services = data.nodes.filter((n) => n.type === "SERVICE");
  const typeOf = (id: string) => index.node(id)?.type;

  const byDimension = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;
  const steps = { one: 0, twoToThree: 0, fourToSix: 0, sevenPlus: 0 };
  const answered: number[] = [];
  let ordered = 0;

  for (const service of services) {
    const out = index.outgoing(service.id);
    const to = (type: string) => out.some((e) => typeOf(e.to) === type);
    const actionNodes = out.map((e) => index.node(e.to)).filter((n) => n?.type === "ACTION");
    const actions = actionNodes.length;
    if (actionNodes.filter((n) => typeof n?.metadata?.stepNumber === "number").length >= 2) ordered++;

    const has: Record<Dimension, boolean> = {
      source: Boolean(service.sources?.length),
      "application channel": out.some((e) => e.type === "APPLY_AT" || e.type === "AVAILABLE_VIA"),
      "required documents": to("DOCUMENT") || to("DOCUMENT_GROUP"),
      // Either a rule node or the sentence the compiler carries on the service.
      eligibility: to("ELIGIBILITY") || Boolean((service.metadata as { eligibility?: unknown[] })?.eligibility?.length),
      "ordered actions": actions >= 2,
      tracking: out.some((e) => e.type === "TRACK_AT"),
      "physical office": to("OFFICE"),
      helpline: to("HELPLINE"),
      escalation: out.some((e) => e.type === "ESCALATE_TO"),
      "produced output": out.some((e) => e.type === "PRODUCES"),
    };
    for (const d of DIMENSIONS) if (has[d]) byDimension[d]++;
    answered.push(DIMENSIONS.filter((d) => has[d]).length);

    // §12. A service that compiles to one step is a link with a name on it.
    if (actions <= 1) steps.one++;
    else if (actions <= 3) steps.twoToThree++;
    else if (actions <= 6) steps.fourToSix++;
    else steps.sevenPlus++;
  }

  const buckets = {
    thin: answered.filter((n) => n <= 3).length,
    middling: answered.filter((n) => n >= 4 && n <= 6).length,
    deep: answered.filter((n) => n >= 7).length,
  };
  return { services: services.length, byDimension, steps, ordered, answered, buckets, pdfs: pdfCounts() };
}

/**
 * What the pdf corpus cost and what came out of it.
 *
 * Read off the committed ledgers, never off `.ingest/pdf/`, which is gitignored:
 * a clone has every number and none of the bytes, and these have to agree in
 * both places or the report is only true on one machine.
 */
function pdfCounts(): DepthReport["pdfs"] {
  const jsonl = (name: string): Record<string, unknown>[] => {
    try {
      return readFileSync(new URL(`../../../../.ingest/${name}`, import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((r): r is Record<string, unknown> => r !== null);
    } catch {
      return [];
    }
  };
  const pdfs = jsonl("pdfs.jsonl");
  return {
    parsed: pdfs.length,
    pages: pdfs.reduce((sum, p) => sum + (typeof p.pageCount === "number" ? p.pageCount : 0), 0),
    pageUnits: jsonl("pages.jsonl").filter((p) => p.pdf).length,
    unreadable: jsonl("negative.jsonl").filter((n) => n.reason === "SCANNED_PDF").length,
  };
}

// ---------------------------------------------------------------------- cli
//
// Everything below runs only when this file is the process entry point, so
// `/admin/coverage` can import coverage() without a table appearing in the
// server log and without --json calling process.exit inside a request.

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main(): void {
const args = process.argv.slice(2);
const all = coverage();

if (args.includes("--json")) {
  const data = loadGraph();
  console.log(JSON.stringify({ generatedBy: "pnpm coverage", services: data.nodes.filter((n) => n.type === "SERVICE").length, journeys: all, depth: depth() }, null, 2));
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
  ["not found", (c) => String(c.notFound.length)],
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

// ------------------------------------------------------------- the depth table

const d = depth();
const pct = (n: number) => `${((n / Math.max(1, d.services)) * 100).toFixed(0)}%`;
console.log(`
How deep, across all ${d.services} services:`);
const widest = Math.max(...DIMENSIONS.map((k) => k.length));
for (const k of DIMENSIONS) {
  console.log(`  ${k.padEnd(widest)}  ${String(d.byDimension[k]).padStart(4)}  ${pct(d.byDimension[k]).padStart(4)}`);
}
console.log(
  `
  steps per service: ${d.steps.one} at one, ${d.steps.twoToThree} at two or three, ` +
    `${d.steps.fourToSix} at four to six, ${d.steps.sevenPlus} at seven or more`,
);
console.log(`  ${d.services - d.steps.one} of them multi step, and ${d.ordered} where a source numbered the sequence`);
const mean = d.answered.reduce((a, b) => a + b, 0) / Math.max(1, d.answered.length);
console.log(`  a service answers ${mean.toFixed(1)} of the ${DIMENSIONS.length} questions on average`);
// The average is the number that flatters. This is the one to read.
console.log(`  ${d.buckets.thin} answer three or fewer, ${d.buckets.middling} answer four to six, ${d.buckets.deep} answer seven or more`);
console.log(
  `  pdfs: ${d.pdfs.parsed} parsed into ${d.pdfs.pages} page(s), ` +
    `${d.pdfs.pageUnits} worth extracting from, ${d.pdfs.unreadable} scanned and unread`,
);

const unsourced = all.flatMap((c) => c.unsourced);
if (unsourced.length) {
  console.log(`\n${unsourced.length} load bearing node(s) with no evidence at all:`);
  for (const id of unsourced.slice(0, 20)) console.log(`  ${id}`);
  if (unsourced.length > 20) console.log(`  ...and ${unsourced.length - 20} more`);
}

// Behind a flag because there are 74 of them and they are paragraphs, not ids.
// The table says how many; this says which, and /admin/coverage shows the same
// text to anyone who does not have a terminal.
const gaps = all.flatMap((c) => c.notFound.map((n) => [c.journey, n] as const));
if (args.includes("--gaps")) {
  console.log(`\n${gaps.length} thing(s) we looked for and could not find:`);
  for (const [journey, note] of gaps) console.log(`\n  [${journey}] ${note}`);
} else if (gaps.length) {
  console.log(`\n${gaps.length} thing(s) we looked for and could not find. Run with --gaps to read them.`);
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
}
