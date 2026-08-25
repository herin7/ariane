import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGraphFrom, validateGraph, type GraphBundle } from "../data/index";
import { compileJourney } from "../journey";
import type { Jurisdiction, SourceRef } from "../types";

/**
 * The whole pipeline, on data small enough to read in one sitting.
 *
 * Ariane's real corpus is thousands of saved government pages, and it is not in
 * this repository: those pages are third-party content and republishing them is
 * not ours to do. That absence would leave the central claim untestable by
 * anyone who clones this, so `fixtures/demo/` carries one synthetic page and the
 * two layers derived from it, and this walks the same chain the real thing does:
 *
 *   page body -> extracted fact -> graph citation -> validated graph -> journey
 *
 * The service is invented, on an `example.gov.invalid` host, so nothing here can
 * ever be mistaken for a government fact.
 */

const at = (p: string) => new URL(`../../../../fixtures/demo/${p}`, import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(at(p), "utf8"));

const page = readFileSync(at("source/tree-felling-permit.md"), "utf8");
const research: { facts: { claim: string; evidence: string; sourceId: string }[]; sources: { id: string; title?: string; cacheFile?: string }[] } = read("research.json");
const bundle: GraphBundle = read("graph.json");
const jurisdictions: Jurisdiction[] = read("jurisdictions.json");

/** The comparison `pnpm quotes:audit` uses, so the fixture is held to the real rule. */
const norm = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([-.*_[\]()#+!`>~])/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

describe("every extracted fact came off the page", () => {
  const body = norm(page);

  it("quotes the source verbatim, not from memory", () => {
    for (const fact of research.facts) expect(body, fact.claim).toContain(norm(fact.evidence));
  });

  it("points every fact at a declared source", () => {
    const ids = new Set(research.sources.map((s) => s.id));
    for (const fact of research.facts) expect(ids).toContain(fact.sourceId);
  });

  it("records what the page did not say instead of filling it in", () => {
    expect(read("research.json").notFound.length).toBeGreaterThan(0);
  });
});

describe("every graph citation traces back to a fact", () => {
  const quotes = new Set<string>();
  for (const fact of research.facts) quotes.add(norm(fact.evidence));
  for (const source of research.sources) if (source.title) quotes.add(norm(source.title));

  const refs: { where: string; ref: SourceRef }[] = [];
  for (const n of bundle.nodes) for (const ref of n.sources ?? []) refs.push({ where: `node ${n.id}`, ref });
  for (const e of bundle.edges) for (const ref of e.sources ?? []) refs.push({ where: `edge ${e.id}`, ref });

  it("cites something a researcher actually read", () => {
    expect(refs.length).toBeGreaterThan(0);
    for (const { where, ref } of refs) {
      expect(ref.evidence, where).toBeTruthy();
      const q = norm(ref.evidence ?? "");
      expect([...quotes].some((f) => f.includes(q)), `${where}: ${ref.evidence}`).toBe(true);
    }
  });

  it("cites only sources the bundle declares", () => {
    const declared = new Set(bundle.sources.map((s) => s.id));
    for (const { where, ref } of refs) expect(declared, where).toContain(ref.sourceId);
  });
});

describe("the graph compiles into a journey", () => {
  const data = loadGraphFrom([bundle], jurisdictions);

  it("passes the same validator the real bundles do", () => {
    expect(validateGraph(data).filter((i) => i.severity === "ERROR")).toEqual([]);
  });

  it("turns the service into ordered steps", () => {
    const journey = compileJourney(data, {
      goal: "tree_felling_permit",
      jurisdiction: { country: "Exampleland", state: "Example State", district: "Example District" },
    });
    const steps = journey.orderedSteps.map((s) => s.nodeId);
    // A document is something you bring, not something you do, so it is listed
    // rather than stepped through. The fee is an act and gets its own step.
    expect(journey.documentsNeeded.map((d) => d.nodeId)).toContain("document:property_tax_receipt");
    expect(steps).toContain("payment:tree_felling_permit_fee");
    expect(steps.indexOf("payment:tree_felling_permit_fee")).toBeLessThan(steps.indexOf("service:tree_felling_permit"));
    expect(journey.digitalChannels.map((c) => c.nodeId)).toContain("portal:example_services");
  });

  it("carries the quote all the way to the citizen", () => {
    const journey = compileJourney(data, {
      goal: "tree_felling_permit",
      jurisdiction: { country: "Exampleland", state: "Example State", district: "Example District" },
    });
    // The point of the whole chain. A step a citizen is asked to take has to be
    // traceable back to a sentence on a page, or it is just an assertion.
    expect(journey.sources.length).toBeGreaterThan(0);
    for (const s of journey.sources) {
      expect(s.source.url).toContain("example.gov.invalid");
      expect(norm(page)).toContain(norm(s.evidence ?? ""));
    }
  });
});
