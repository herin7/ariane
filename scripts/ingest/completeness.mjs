/**
 * What a service still cannot tell a citizen.
 *
 *   pnpm services:completeness                     the histogram, worst first
 *   pnpm services:completeness --service service:income_certificate
 *   pnpm services:completeness --dimension OFFICE  who is missing this one
 *
 * §11. `pnpm coverage` already answers this in aggregate and that table is the
 * one a human reads. This answers it per service, which is a different job: the
 * depth engine cannot fetch anything for "39% of services have documents", it
 * needs the id of one service and the name of one thing it is missing.
 *
 * Two lists, deliberately not merged.
 *
 * The keys below are what the *graph* can be missing. `DIMENSIONS` in corpus.mjs
 * is what a *search* can go looking for, and §8 names eleven of those. They are
 * nearly the same list and the difference is the interesting part: SOURCE is
 * measurable and not retrievable, because a service with no source is not a
 * service we found, it is a bug. APPLICATION_CHANNEL is measurable and shares
 * its vocabulary with ACTIONS, because a page explaining how to apply is the
 * same page that lists the steps. `retrieveAs` is that mapping, and it is the
 * thing P5 turns into a query.
 *
 * Read straight off the committed bundle JSON, the same files
 * services-compile.mjs writes and offices-discover.mjs reads. No model, no
 * network, no cache: it is a pass over the graph and it costs milliseconds, so
 * the depth loop can afford to call it again after every pass, which §2 says it
 * must.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { at } from "./lib.mjs";

const GRAPH = "packages/core/src/data/graph/";

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

/**
 * The questions, and how the graph answers each one.
 *
 * `has` gets the service node and a small view of its edges. Every one of these
 * is a structural test, never a keyword test: a service has an office because
 * an edge points at an OFFICE node, not because the word "office" appeared
 * somewhere on the page. That is the difference between the graph deciding and
 * the model deciding, and §0 is not subtle about which one this is.
 *
 * The first ten are `pnpm coverage`'s ten, computed the same way on purpose so
 * the two reports cannot disagree about the same service. The last three are
 * new here because §8 says they are retrievable, and a dimension we can go
 * looking for is worth knowing we are missing.
 */
export const DIMENSIONS = {
  SOURCE: { retrieveAs: null, has: (s) => Boolean(s.sources?.length) },
  APPLICATION_CHANNEL: { retrieveAs: "ACTIONS", has: (s, g) => g.edge("APPLY_AT") || g.edge("AVAILABLE_VIA") },
  DOCUMENTS: { retrieveAs: "DOCUMENTS", has: (s, g) => g.to("DOCUMENT") || g.to("DOCUMENT_GROUP") },
  ELIGIBILITY: {
    retrieveAs: "ELIGIBILITY",
    // Either a rule node or the sentence the compiler carries on the service.
    has: (s, g) => g.to("ELIGIBILITY") || Boolean(s.metadata?.eligibility?.length),
  },
  ACTIONS: {
    retrieveAs: "ACTIONS",
    // Two, not one. §2's whole complaint is that 425 of 440 services compiled to
    // a single step, and a single step is a link with a name on it, not a
    // procedure. One ACTION is not an answer to "what do I do".
    has: (s, g) => g.count("ACTION") >= 2,
  },
  FEES: { retrieveAs: "FEES", has: (s, g) => g.to("PAYMENT") },
  OFFICE: { retrieveAs: "OFFICE", has: (s, g) => g.to("OFFICE") },
  HELPLINE: { retrieveAs: "HELPLINE", has: (s, g) => g.to("HELPLINE") },
  TRACKING: { retrieveAs: "TRACKING", has: (s, g) => g.edge("TRACK_AT") },
  ESCALATION: { retrieveAs: "ESCALATION", has: (s, g) => g.edge("ESCALATE_TO") },
  OUTPUT: { retrieveAs: "OUTPUT", has: (s, g) => g.edge("PRODUCES") },
  ISSUING_AUTHORITY: { retrieveAs: "ISSUING_AUTHORITY", has: (s, g) => g.edge("ISSUED_BY") || g.to("DEPARTMENT") },
  VERIFICATION: { retrieveAs: "VERIFICATION", has: (s, g) => g.edge("VERIFIED_BY") || g.to("VERIFICATION") },
};

export const DIMENSION_NAMES = Object.keys(DIMENSIONS);

/**
 * Every bundle, flattened into one graph with the lookups these tests need.
 *
 * Built once and passed in rather than rebuilt per service, because 553
 * services times a linear scan of 20,000 edges is the kind of quadratic that
 * looks fine until it is the inner loop of an enrichment pass.
 */
export function loadGraph(dir = GRAPH) {
  const nodes = new Map();
  const outgoing = new Map();
  const journeyOf = new Map();
  const sources = new Map();
  const templates = [];
  const add = (e) => {
    const list = outgoing.get(e.from);
    if (list) list.push(e);
    else outgoing.set(e.from, [e]);
  };

  for (const file of readdirSync(at(dir)).filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
    const bundle = JSON.parse(readFileSync(at(dir + file), "utf8"));
    const journey = file.replace(/\.json$/, "");
    for (const n of bundle.nodes ?? []) {
      nodes.set(n.id, n);
      journeyOf.set(n.id, journey);
    }
    for (const e of bundle.edges ?? []) add(e);
    for (const s of bundle.sources ?? []) sources.set(s.id, s);
    templates.push(...(bundle.edgeTemplates ?? []));
  }

  // escalation.json stores CPGRAMS and SWAGAT once with `*` where the service
  // id goes, and data/index.ts stamps them onto every service at load time.
  // Reading the files without doing the same is not a smaller version of the
  // graph, it is a different one: it says 47 services have an escalation route
  // when 553 do, and the depth engine would then spend a model call each on
  // 506 services looking for something already in the bundle.
  for (const t of templates) {
    for (const n of nodes.values()) {
      if (n.type === "SERVICE") add({ ...t, id: t.id.replace("*", n.id), from: n.id });
    }
  }
  return { nodes, outgoing, journeyOf, sources };
}

/**
 * §11's `measureServiceCompleteness`, and it returns a shape, not a score.
 *
 * "Do not reduce it to one fake score" is the whole instruction. `answered` is
 * here because a histogram needs a number, but `missing` is what the depth
 * engine consumes and `known` is what an admin page renders. A service at 6 of
 * 13 with no documents and no office is a different problem from a service at
 * 6 of 13 with no helpline and no tracking, and one number cannot say which.
 */
export function measureServiceCompleteness(serviceId, graph) {
  const service = graph.nodes.get(serviceId);
  if (!service) throw new Error(`no node ${serviceId}`);
  if (service.type !== "SERVICE") throw new Error(`${serviceId} is a ${service.type}, not a SERVICE`);

  const out = graph.outgoing.get(serviceId) ?? [];
  const typeOf = (id) => graph.nodes.get(id)?.type;
  const g = {
    edge: (type) => out.some((e) => e.type === type),
    to: (type) => out.some((e) => typeOf(e.to) === type),
    count: (type) => out.filter((e) => typeOf(e.to) === type).length,
  };

  const known = {};
  for (const [name, d] of Object.entries(DIMENSIONS)) known[name] = Boolean(d.has(service, g));
  const missing = DIMENSION_NAMES.filter((n) => !known[n]);

  return {
    serviceId,
    name: service.officialName || service.name,
    // Every other name it answers to. P5 anchors retrieval on these as well as
    // on the name, because the name is whatever the compiler settled on and the
    // pages are under no obligation to agree with it. service:varshai is named
    // after its url and the word "varshai" appears in nothing: the corpus
    // writes વારસાઈ 48 times and varsai 4 times, so anchoring on the name alone
    // retrieved zero passages for all seven of its missing dimensions.
    aliases: service.aliases ?? [],
    jurisdictionId: service.jurisdictionId ?? null,
    journey: graph.journeyOf.get(serviceId) ?? null,
    // The urls this service was built from. P5 needs them: a service already
    // sitting on a district collectorate host should search that district
    // first, and nothing else in the node says which host it came off.
    urls: [...new Set((service.sources ?? []).map((r) => graph.sources.get(r.sourceId)?.url).filter(Boolean))],
    known,
    missing,
    // What to actually go and search for. SOURCE drops out here because there
    // is no query that finds a source for a service we have no source for.
    retrievable: [...new Set(missing.map((n) => DIMENSIONS[n].retrieveAs).filter(Boolean))],
    answered: DIMENSION_NAMES.length - missing.length,
    of: DIMENSION_NAMES.length,
  };
}

/** Every service in the graph, shallowest first, which is the order to fix them in. */
export function completeness(graph = loadGraph()) {
  return [...graph.nodes.values()]
    .filter((n) => n.type === "SERVICE")
    .map((n) => measureServiceCompleteness(n.id, graph))
    .sort((a, b) => a.answered - b.answered || a.serviceId.localeCompare(b.serviceId));
}

// ------------------------------------------------------------------ selftest

if (isMain && flag("selftest")) {
  const { default: assert } = await import("node:assert/strict");

  const graph = {
    nodes: new Map([
      ["service:thin", { id: "service:thin", type: "SERVICE", name: "Thin", jurisdictionId: "IN-GJ", sources: [{ sourceId: "src:1" }] }],
      ["service:deep", { id: "service:deep", type: "SERVICE", name: "Deep", officialName: "Deep Certificate", jurisdictionId: "IN-GJ-KHEDA", sources: [{ sourceId: "src:1" }, { sourceId: "src:2" }] }],
      ["service:orphan", { id: "service:orphan", type: "SERVICE", name: "Orphan" }],
      ["document:d", { id: "document:d", type: "DOCUMENT" }],
      ["office:o", { id: "office:o", type: "OFFICE" }],
      ["action:a1", { id: "action:a1", type: "ACTION" }],
      ["action:a2", { id: "action:a2", type: "ACTION" }],
      ["portal:p", { id: "portal:p", type: "PORTAL" }],
    ]),
    outgoing: new Map([
      ["service:thin", [{ from: "service:thin", to: "action:a1", type: "NEXT" }]],
      [
        "service:deep",
        [
          { from: "service:deep", to: "document:d", type: "REQUIRES" },
          { from: "service:deep", to: "office:o", type: "VISIT_AT" },
          { from: "service:deep", to: "action:a1", type: "NEXT" },
          { from: "service:deep", to: "action:a2", type: "NEXT" },
          { from: "service:deep", to: "portal:p", type: "APPLY_AT" },
        ],
      ],
    ]),
    journeyOf: new Map([["service:deep", "certificates"]]),
    sources: new Map([
      ["src:1", { id: "src:1", url: "https://kheda.gujarat.gov.in/a" }],
      ["src:2", { id: "src:2", url: "https://kheda.gujarat.gov.in/a" }],
    ]),
  };

  const deep = measureServiceCompleteness("service:deep", graph);
  assert.equal(deep.name, "Deep Certificate", "the official name wins, it is the one on the form");
  assert.deepEqual(
    Object.entries(deep.known).filter(([, v]) => v).map(([k]) => k).sort(),
    ["ACTIONS", "APPLICATION_CHANNEL", "DOCUMENTS", "OFFICE", "SOURCE"],
    "five answered, and each one because an edge says so",
  );
  assert.ok(deep.missing.includes("HELPLINE"));
  assert.equal(deep.answered, 5);
  assert.equal(deep.of, 13);
  assert.equal(deep.journey, "certificates");
  assert.deepEqual(deep.urls, ["https://kheda.gujarat.gov.in/a"], "two refs on one page is one url, not two");

  // One step is not a procedure. This is §2's entire complaint, as an assertion.
  const thin = measureServiceCompleteness("service:thin", graph);
  assert.equal(thin.known.ACTIONS, false, "one ACTION is a link with a name on it");
  assert.equal(deep.known.ACTIONS, true, "two is a sequence");

  // A dimension with no retrieval is dropped from the shopping list, not from
  // the measurement. Orphan is genuinely missing a source and saying so matters.
  const orphan = measureServiceCompleteness("service:orphan", graph);
  assert.equal(orphan.known.SOURCE, false);
  assert.ok(orphan.missing.includes("SOURCE"));
  assert.ok(!orphan.retrievable.includes("SOURCE"), "there is no query that finds a source for a service we cannot cite");
  assert.equal(orphan.answered, 0);

  // APPLICATION_CHANNEL and ACTIONS both search with the ACTIONS vocabulary and
  // must not queue the same search twice.
  assert.equal(thin.retrievable.filter((d) => d === "ACTIONS").length, 1, "one query, not one per dimension that wants it");

  // Every retrieval target has to be a dimension corpus.mjs can actually expand.
  const { DIMENSIONS: SEARCHABLE } = await import("./corpus.mjs");
  for (const d of Object.values(DIMENSIONS)) {
    if (d.retrieveAs) assert.ok(SEARCHABLE[d.retrieveAs], `${d.retrieveAs} is not a dimension corpus.mjs knows`);
  }

  const ranked = completeness(graph);
  assert.equal(ranked[0].serviceId, "service:orphan", "shallowest first, because that is the order to fix them in");
  assert.equal(ranked.at(-1).serviceId, "service:deep");
  assert.equal(ranked.length, 3, "services only, never the documents and offices they point at");

  assert.throws(() => measureServiceCompleteness("document:d", graph), /not a SERVICE/);
  assert.throws(() => measureServiceCompleteness("service:nope", graph), /no node/);

  // On the real bundles, because the bug this catches only exists there.
  // escalation.json's two edges are stored once against `*` and stamped onto
  // every service at load time, and a reader that skips that step disagrees
  // with `pnpm coverage` about 506 services while looking perfectly correct.
  const real = completeness();
  assert.ok(real.length > 100, "the real graph should have hundreds of services");
  assert.ok(
    real.every((s) => s.known.ESCALATION),
    "every service has CPGRAMS and SWAGAT, and this number has to match pnpm coverage",
  );
  assert.ok(real.every((s) => s.known.SOURCE), "a service with no source is not a service we found");

  console.log("completeness: ok");
  process.exit(0);
}

// -------------------------------------------------------------------- report

if (isMain) {
  const all = completeness();
  const one = value("service");
  const only = value("dimension");

  if (one) {
    const m = all.find((s) => s.serviceId === one || s.serviceId === `service:${one}`);
    if (!m) {
      console.error(`No service ${one}. Try: pnpm services:completeness | head`);
      process.exit(1);
    }
    console.log(`${m.name}\n  ${m.serviceId}  [${m.journey}]  ${m.jurisdictionId ?? "no jurisdiction"}`);
    for (const url of m.urls) console.log(`  ${url}`);
    console.log(`\n  ${m.answered} of ${m.of} answered`);
    for (const d of DIMENSION_NAMES) console.log(`    ${m.known[d] ? "yes" : " no"}  ${d}`);
    if (m.retrievable.length) console.log(`\n  worth searching for: ${m.retrievable.join(", ")}`);
    process.exit(0);
  }

  if (only) {
    if (!DIMENSIONS[only]) {
      console.error(`Unknown dimension ${only}. One of: ${DIMENSION_NAMES.join(", ")}`);
      process.exit(1);
    }
    const without = all.filter((s) => !s.known[only]);
    console.log(`${without.length} of ${all.length} service(s) cannot answer ${only}\n`);
    for (const m of without.slice(0, Number(value("limit", 30)))) {
      console.log(`  ${String(m.answered).padStart(2)}/${m.of}  ${m.serviceId}  ${m.name}`);
    }
    if (without.length > 30) console.log(`  ...and ${without.length - Number(value("limit", 30))} more`);
    process.exit(0);
  }

  const width = Math.max(...DIMENSION_NAMES.map((d) => d.length));
  const pct = (n) => `${((n / Math.max(1, all.length)) * 100).toFixed(0)}%`;
  console.log(`${all.length} service(s), measured on ${DIMENSION_NAMES.length} dimension(s)\n`);
  for (const d of DIMENSION_NAMES) {
    const n = all.filter((s) => s.known[d]).length;
    console.log(`  ${d.padEnd(width)}  ${String(n).padStart(4)}  ${pct(n).padStart(4)}`);
  }

  const mean = all.reduce((sum, s) => sum + s.answered, 0) / Math.max(1, all.length);
  console.log(`\n  a service answers ${mean.toFixed(1)} of ${DIMENSION_NAMES.length} on average`);

  // The number the depth engine exists to move. Printed as a count of services
  // rather than a percentage because a percentage of a corpus we chose is a
  // statistic, and a count of citizens who get a link and no instructions is a
  // number.
  const shallow = all.filter((s) => s.answered <= 3).length;
  console.log(`  ${shallow} service(s) answer three or fewer, which is a name and a link`);

  console.log(`\nshallowest:`);
  for (const m of all.slice(0, 10)) console.log(`  ${String(m.answered).padStart(2)}/${m.of}  ${m.serviceId}  ${m.name}`);
  console.log(`\nRun: pnpm services:completeness --dimension OFFICE`);
}
