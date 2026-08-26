import { describe, expect, it } from "vitest";
import { loadGraphFrom, validateGraph } from "../data/index";
import { localGraphProvider } from "../data/providers";

const provider = localGraphProvider();
const seedBundles = provider.bundles();
const seedJurisdictions = provider.jurisdictions();
import { jurisdictionRows, toBundles, toJurisdictions, toRows } from "../db/rows";

/**
 * The whole seed, pushed through the row mapping and back, asserted identical.
 *
 * This is the only part of the persistence layer that can quietly corrupt a
 * government fact, so it is tested without a database rather than not tested
 * until credentials show up. A dropped quote, a stringified condition or an
 * optional field that comes back as explicit `undefined` all fail here.
 */

const roundTripped = toBundles(toRows(seedBundles));
const jurisdictions = toJurisdictions(jurisdictionRows(seedJurisdictions));

describe("a government fact survives the trip through Postgres", () => {
  // toEqual, not string equality: column order is not a fact, and Postgres
  // would not preserve it anyway. Every value and every key must survive.
  it("comes back intact, all five journeys", () => {
    expect(roundTripped).toEqual(seedBundles);
  });

  it("keeps jurisdictions and their parent chain", () => {
    expect(jurisdictions).toEqual(seedJurisdictions);
  });

  it("keeps the scope on a requirement group, so a Gujarat OR rule stays in Gujarat", () => {
    const scoped = seedBundles.flatMap((b) => b.requirementGroups).filter((g) => g.jurisdictionId);
    expect(scoped.length).toBeGreaterThan(0);
    expect(roundTripped.flatMap((b) => b.requirementGroups).filter((g) => g.jurisdictionId)).toEqual(scoped);
  });

  it("keeps tlsVerified:false, so a page from a portal with a broken chain stays branded", () => {
    // Nothing in the seed carries it yet, and it has to survive the day it does:
    // `false` is the whole signal, and a mapper that drops falsy values would
    // silently upgrade an unverifiable government page to an ordinary one.
    const branded = seedBundles.slice(0, 1).map((b) => ({ ...b, sources: b.sources.map((s, i) => (i === 0 ? { ...s, tlsVerified: false } : s)) }));
    expect(toBundles(toRows(branded))[0]?.sources[0]?.tlsVerified).toBe(false);
  });

  it("compiles the same graph however the rows were handed to it", () => {
    // The planes hand `loadGraphFrom` different orders — Postgres reads every
    // table sorted by id, the ingest pipeline writes in pipeline order — and
    // array order is the compiler's tie-break between two steps nobody
    // numbered. A graph that depends on it is a graph that answers two ways.
    const reverse = <T>(xs: T[]) => [...xs].reverse();
    const shuffled = reverse(seedBundles).map((b) => ({
      ...b,
      sources: reverse(b.sources),
      nodes: reverse(b.nodes),
      edges: reverse(b.edges),
      requirementGroups: reverse(b.requirementGroups),
      questions: reverse(b.questions),
      edgeTemplates: b.edgeTemplates && reverse(b.edgeTemplates),
    }));
    expect(loadGraphFrom(shuffled, seedJurisdictions)).toEqual(loadGraphFrom(seedBundles, seedJurisdictions));
  });

  it("compiles the same graph out of rows as out of the seed", () => {
    const fromRows = loadGraphFrom(roundTripped, jurisdictions);
    expect(fromRows).toEqual(loadGraphFrom(seedBundles, seedJurisdictions));
    expect(validateGraph(fromRows).filter((i) => i.severity === "ERROR")).toEqual([]);
  });
});

describe("what the tables are shaped to hold", () => {
  const rows = toRows(seedBundles);

  it("stamps every row with the journey it came from", () => {
    for (const list of [rows.sources, rows.nodes, rows.edges, rows.requirement_groups, rows.questions]) {
      for (const r of list) expect(r.journey_id).toBeTruthy();
    }
  });

  it("never writes a node or edge with an empty sources array, which the schema rejects", () => {
    for (const r of [...rows.nodes, ...rows.edges]) {
      expect((r.sources as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("writes snake case columns, because that is what Postgres gets", () => {
    const node = rows.nodes.find((r) => r.official_name)!;
    expect(node).toHaveProperty("official_name");
    expect(node).not.toHaveProperty("officialName");
  });

  it("leaves no key holding null, so absent stays absent on the way back", () => {
    for (const list of Object.values(rows)) {
      for (const r of list as Record<string, unknown>[]) {
        for (const [k, v] of Object.entries(r)) expect(v, k).not.toBeNull();
      }
    }
  });
});
