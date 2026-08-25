/**
 * What to go and search for, decided by the graph.
 *
 *   pnpm services:queries --service income_certificate
 *   pnpm services:queries --dimension OFFICE --limit 20
 *
 * §10. Query generation is deterministic and it is not a model's job. The graph
 * already knows this service's name, which district's host it came off, which
 * portal it applies at and which authority issues it, and a model asked to
 * "generate search queries" would give those four facts back in a sentence and
 * charge for it. §27 puts deterministic logic above every model call for exactly
 * this reason. A model gets involved when these templates come back empty, which
 * is P6's problem and not this file's.
 *
 * The retriever does half the work already. `LexicalRetriever.search` expands
 * the dimension into its own vocabulary, so nothing here needs to remember that
 * OFFICE means "address" and "કચેરી". What it cannot know is the *entity*: which
 * service, in which district, issued by whom. That is what a query is for here,
 * and it is why these are graph guided rather than templated off a string.
 *
 * Every query comes back as a whole retrieval input rather than a string,
 * because a query without its jurisdiction is a query that answers Surat with
 * Kheda's counter, and the two should not be separable by accident.
 */
import { fileURLToPath } from "node:url";
import { completeness, DIMENSIONS as MEASURED, loadGraph } from "./completeness.mjs";
import { DIMENSIONS as VOCABULARY } from "./corpus.mjs";
import { districtIn, districtOf } from "./places.mjs";

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

/** The most, per dimension, per pass. §12 says two to five and means it. */
const MAX = 5;

/**
 * A service name a person would type, from whatever the compiler stored.
 *
 * Some names arrived as page titles ("Non-Creamy layer Certificate For Central
 * Government") and some as url slugs ("income-tax-return-filing"), because the
 * extractor takes whichever the page actually printed. Both have to become
 * words before they are worth searching for: a hyphenated slug tokenises fine
 * but reads as three terms that never co-occur in prose.
 */
export const readable = (name) =>
  String(name ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Words a government page uses about everything, so they cost a query slot and
 * buy nothing.
 *
 * Not a stopword list for the index, which does not have one and does not need
 * one: IDF handles common terms when they are competing against other terms in
 * the same document. This is different. It trims the *query*, where "For" and
 * "Of" are two of the five terms and the district is not one of them.
 */
const FILLER = new Set(["for", "of", "the", "and", "or", "in", "to", "a", "an", "on", "at", "by", "from", "with"]);

/** The distinctive half of a long name. "Non-Creamy layer Certificate" out of the mouthful above. */
export const shorten = (name, keep = 4) => {
  const words = readable(name).split(" ").filter((w) => !FILLER.has(w.toLowerCase()));
  return words.slice(0, keep).join(" ");
};

/**
 * The head terms of a dimension's vocabulary, one per script.
 *
 * Derived from corpus.mjs rather than repeated here. The English terms are the
 * ASCII ones and the Gujarati terms are the rest, which is a crude test that
 * happens to be exactly right for this corpus and would need rewriting the day
 * a Hindi column arrives. Cheaper than maintaining a second table that has to
 * agree with the first.
 */
export function heads(dimension) {
  const all = VOCABULARY[dimension] ?? [];
  const english = all.filter((t) => /^[\x20-\x7E]+$/.test(t));
  const other = all.filter((t) => !/^[\x20-\x7E]+$/.test(t));
  return { english: english[0] ?? "", other: other[0] ?? "" };
}

/**
 * The district this service's evidence actually came from.
 *
 * `jurisdictionId` says IN-GJ on almost every compiled service, because the
 * compiler only writes a district when the page said one out loud. The hostname
 * usually did say one: devbhumidwarka.nic.in is Devbhoomi Dwarka's site whether
 * or not its certificates page ever prints the word. Falling back to the name
 * catches the rest, where the service is called "Kheda Varsai Certificate".
 */
export function scopeOf(m) {
  if (m.jurisdictionId && m.jurisdictionId !== "IN-GJ") return m.jurisdictionId;
  for (const url of m.urls ?? []) {
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    const d = districtOf(host);
    if (d !== "IN-GJ") return d;
  }
  return districtIn(m.name) ?? null;
}

/**
 * Who the graph already says is involved, in the words the graph uses.
 *
 * An office, department or portal already attached to this service is the best
 * search term available that is not the service's own name, because a page that
 * names the Mamlatdar's office is a page about what the Mamlatdar's office does.
 * Portals contribute their host, which is worth nothing as prose and is skipped.
 */
export function neighbours(serviceId, graph) {
  const out = graph.outgoing.get(serviceId) ?? [];
  const names = [];
  for (const e of out) {
    const n = graph.nodes.get(e.to);
    if (!n || !["OFFICE", "DEPARTMENT", "DOCUMENT"].includes(n.type)) continue;
    const name = readable(n.officialName || n.name || "");
    // A node named after a hostname is the compiler recording a link, not an
    // institution, and "gpcl.gujarat.gov.in" is not a phrase on any page.
    if (name && !/\.(gov|nic|com|org|in)\b/.test(name) && name.length > 3) names.push(name);
  }
  return [...new Set(names)];
}

/**
 * Two to five retrieval inputs for one missing dimension of one service.
 *
 * Ordered most specific first, so a caller that can only afford two gets the
 * two worth running. Each is a complete input to `LexicalRetriever.search`.
 */
export function queriesFor(m, dimension, graph) {
  if (!VOCABULARY[dimension]) throw new Error(`${dimension} is not a searchable dimension`);
  const name = readable(m.name);
  if (!name) return [];

  const scope = scopeOf(m);
  const head = heads(dimension);
  const short = shorten(name);
  const near = graph ? neighbours(m.serviceId, graph) : [];

  const out = [];
  const push = (query, jurisdictionId) => {
    const q = String(query).replace(/\s+/g, " ").trim();
    // Deduped on the pair, not on the query. The same words scoped two ways is
    // two searches worth running, and that is template 2's entire job; the same
    // words at the same scope is one.
    const key = `${q.toLowerCase()}|${jurisdictionId ?? ""}`;
    if (q && !out.some((x) => `${x.query.toLowerCase()}|${x.jurisdictionId ?? ""}` === key)) out.push({ query: q, dimension, jurisdictionId, serviceId: m.serviceId });
  };

  // 1. The name, in the district it came from, with the dimension doing the
  //    rest. The single most likely query to find the right page.
  push(`${name} ${head.english}`, scope);
  // 2. The same thing unscoped, because the district guess comes off a hostname
  //    and digitalgujarat answers for services no district portal mentions.
  if (scope) push(`${name} ${head.english}`, null);
  // 3. Bilingual. Half this estate publishes the fee table in Gujarati only.
  if (head.other) push(`${name} ${head.other}`, scope);
  // 4. Who the graph already knows is involved. For OFFICE and
  //    ISSUING_AUTHORITY this is usually the query that works.
  if (near[0]) push(`${near[0]} ${short} ${head.english}`, scope);
  // 5. The distinctive half of a long name, for when the full title is a
  //    sentence and no page repeats it word for word.
  if (short.toLowerCase() !== name.toLowerCase()) push(`${short} ${head.english}`, scope);

  return out.slice(0, MAX);
}

/** Every query worth running for one service, across every dimension it is missing. */
export function queriesForService(m, graph) {
  return m.retrievable.flatMap((d) => queriesFor(m, d, graph));
}

// ------------------------------------------------------------------ selftest

if (isMain && flag("selftest")) {
  const { default: assert } = await import("node:assert/strict");

  const m = {
    serviceId: "service:varsai_certificate",
    name: "Varsai Certificate For Legal Heirs",
    jurisdictionId: "IN-GJ",
    urls: ["https://collectorkheda.gujarat.gov.in/varsai"],
    retrievable: ["OFFICE", "DOCUMENTS"],
  };
  const graph = {
    nodes: new Map([
      ["office:mamlatdar", { id: "office:mamlatdar", type: "OFFICE", name: "Mamlatdar Office" }],
      ["portal:dg", { id: "portal:dg", type: "PORTAL", name: "digitalgujarat.gov.in" }],
    ]),
    outgoing: new Map([
      [
        "service:varsai_certificate",
        [
          { to: "office:mamlatdar", type: "VISIT_AT" },
          { to: "portal:dg", type: "APPLY_AT" },
        ],
      ],
    ]),
  };

  // The district is read off the hostname, because the compiler wrote IN-GJ.
  assert.equal(scopeOf(m), "IN-GJ-KHEDA", "a Kheda host is Kheda evidence even when the node says IN-GJ");
  assert.equal(scopeOf({ ...m, jurisdictionId: "IN-GJ-SURAT" }), "IN-GJ-SURAT", "an explicit district beats a guess from a hostname");
  assert.equal(scopeOf({ name: "Anything", urls: ["https://digitalgujarat.gov.in/x"] }), null);
  assert.equal(scopeOf({ name: "Rajkot Property Tax", urls: [] }), "IN-GJ-RAJKOT", "the name is the last resort and it does work");
  assert.equal(scopeOf({ name: "x", urls: ["not a url"] }), null, "a broken url is skipped, never thrown");

  const office = queriesFor(m, "OFFICE", graph);
  assert.ok(office.length >= 2 && office.length <= 5, "§12 says two to five");
  assert.equal(office[0].query, "Varsai Certificate For Legal Heirs office");
  assert.equal(office[0].jurisdictionId, "IN-GJ-KHEDA");
  assert.equal(office[1].jurisdictionId, null, "the same words unscoped, because the district came off a hostname");
  assert.ok(office.some((q) => q.query.includes("Mamlatdar Office")), "the office the graph already knows is the best term we have");
  assert.ok(office.every((q) => q.dimension === "OFFICE" && q.serviceId === m.serviceId));

  // A portal is a link, not an institution, and its host is not prose.
  assert.ok(!office.some((q) => q.query.includes("digitalgujarat")), "a hostname is not a phrase on any page");

  // Bilingual, because half the estate publishes this in Gujarati only.
  assert.ok(queriesFor(m, "FEES", graph).some((q) => /[઀-૿]/.test(q.query)), "a Gujarati shot every time the vocabulary has one");

  // Filler words cost a slot and buy nothing.
  assert.equal(shorten("Non-Creamy layer Certificate For Central Government"), "Non Creamy layer Certificate", "For is filler, and the hyphen is two words before it is counted");
  assert.equal(readable("income-tax-return-filing"), "income tax return filing", "a slug has to become words");

  // With no district to scope to, template 2 collapses into template 1 and
  // must not be emitted twice.
  const dupes = queriesFor({ ...m, name: "Ration Card", urls: [] }, "OFFICE", graph);
  assert.equal(scopeOf({ ...m, name: "Ration Card", urls: [] }), null);
  assert.equal(new Set(dupes.map((q) => `${q.query.toLowerCase()}|${q.jurisdictionId ?? ""}`)).size, dupes.length, "the same words at the same scope is one search");
  assert.equal(dupes.filter((q) => q.query === "Ration Card office").length, 1);

  assert.deepEqual(queriesFor({ ...m, name: "" }, "OFFICE", graph), [], "a service with no name has nothing to search for");
  assert.throws(() => queriesFor(m, "SOURCE", graph), /not a searchable dimension/);

  // The heads come off corpus.mjs, so the two tables cannot drift apart.
  for (const d of Object.keys(VOCABULARY)) {
    const h = heads(d);
    assert.ok(h.english, `${d} has no English head term`);
    assert.ok(h.other, `${d} has no Gujarati head term, so half the corpus is unreachable for it`);
  }

  // And everything the measurement says is retrievable is something this can
  // actually build a query for.
  for (const d of Object.values(MEASURED)) {
    if (d.retrieveAs) assert.ok(VOCABULARY[d.retrieveAs], `${d.retrieveAs} is measured as retrievable and is not searchable`);
  }

  console.log("queries: ok");
  process.exit(0);
}

// -------------------------------------------------------------------- report

if (isMain) {
  const graph = loadGraph();
  const all = completeness(graph);
  const one = value("service");
  const only = value("dimension");

  const chosen = one ? all.filter((s) => s.serviceId === one || s.serviceId === `service:${one}`) : all.slice(0, Number(value("limit", 5)));
  if (one && !chosen.length) {
    console.error(`No service ${one}. Try: pnpm services:completeness | head`);
    process.exit(1);
  }

  let total = 0;
  for (const m of chosen) {
    const queries = only ? queriesFor(m, only, graph) : queriesForService(m, graph);
    total += queries.length;
    console.log(`${m.answered}/${m.of}  ${m.serviceId}  ${m.name}`);
    console.log(`  scope: ${scopeOf(m) ?? "state wide"}  missing: ${m.retrievable.join(", ") || "nothing"}`);
    let dimension = null;
    for (const q of queries) {
      if (q.dimension !== dimension) {
        dimension = q.dimension;
        console.log(`  ${dimension}`);
      }
      console.log(`    "${q.query}"${q.jurisdictionId ? `  [${q.jurisdictionId}]` : ""}`);
    }
    console.log();
  }
  console.log(`${total} quer(ies) across ${chosen.length} service(s), ${(total / Math.max(1, chosen.length)).toFixed(1)} each, none of them from a model`);
}
