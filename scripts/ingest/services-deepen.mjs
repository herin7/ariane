/**
 * Go and find the things a service cannot say yet.
 *
 *   pnpm services:deepen                       every shallow service
 *   pnpm services:deepen --limit 20            the twenty shallowest
 *   pnpm services:deepen --service ration_card
 *   pnpm services:deepen --dimension OFFICE
 *   pnpm services:deepen --stats               what is already on disk
 *
 * §2's loop, and this is the retrieval half of it: completeness says what is
 * missing, queries.mjs says what to search for, corpus.mjs searches the whole
 * cached estate rather than the one page this service was found on, and the
 * candidates land in a ledger. Reranking is P7 and extraction is P8; both read
 * this file rather than repeating the search.
 *
 * Nothing here calls a model or the network. That is not an accident, it is the
 * point of doing the retrieval pass separately: §27 puts cache and deterministic
 * logic and lexical search above every model call, and running those three to
 * exhaustion first means the expensive stages start from a shortlist instead of
 * from a corpus. It also means this whole command is free to re-run, which is
 * what makes §2's "measure completeness again" affordable.
 *
 * Resumable by construction. A row is keyed by service, dimension and pass, and
 * a pass that already has rows is skipped without being recomputed. §28 caps it
 * at two passes per service: if the second pass produces nothing the first did
 * not, the answer is that this corpus does not contain it, and NO_EVIDENCE_FOUND
 * is a finding rather than a reason to loop.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { completeness, loadGraph } from "./completeness.mjs";
import { buildIndex, DIMENSIONS, indexText, loadChunks, LexicalRetriever, tokens } from "./corpus.mjs";
import { appendJsonl, at, INGEST, readJsonl } from "./lib.mjs";
import { queriesFor } from "./queries.mjs";
import { normalise } from "../lib/url.mjs";

export const EVIDENCE = INGEST + "evidence.jsonl";
export const EVIDENCE_SUMMARY = "docs/research/evidence.json";

/** §28. Two, and the second only runs if the first found nothing. */
export const MAX_PASSES = 2;
/** §12. Union the queries, dedupe, keep about thirty for the reranker to cut to eight. */
const KEEP = 30;

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

/** What identifies one unit of work, and therefore what makes it skippable. */
export const key = (serviceId, dimension, pass) => `${serviceId}|${dimension}|${pass}`;

/**
 * Everything already retrieved, as the set of keys not worth doing again.
 *
 * The ledger is append only and never rewritten, so a run that dies halfway
 * leaves a shorter file rather than a corrupt one, and the next run picks up
 * from exactly where it stopped. Reading it back is the entire resume mechanism;
 * there is no state anywhere else.
 */
export function done(rows) {
  return new Set(rows.map((r) => key(r.serviceId, r.dimension, r.pass)));
}

/**
 * The words that make a passage about *this* service rather than about offices.
 *
 * The retriever expands every search with its dimension's vocabulary, which is
 * what makes it find an address at all. It is also why a search almost never
 * comes back empty: ask for OFFICE and every chunk containing "office" scores,
 * whether or not it has heard of your service. Left alone, NO_EVIDENCE_FOUND
 * would essentially never fire and every shortlist would be thirty passages
 * matched on the word we supplied ourselves.
 *
 * So a candidate has to contain at least one word from the service's own name
 * that the dimension did not also contribute. "Varsai" qualifies. "Certificate"
 * does not, when the dimension is OUTPUT and OUTPUT's vocabulary already says
 * certificate.
 */
export function anchorTerms(name, dimension) {
  const supplied = new Set(tokens((DIMENSIONS[dimension] ?? []).join(" ")));
  return new Set(tokens(name).filter((t) => !supplied.has(t)));
}

/**
 * Is this passage *about* the service, or does it merely mention it?
 *
 * BM25 cannot tell the difference, and on this corpus the difference is most of
 * the answer. Searching income certificate returns twenty scholarship pages,
 * because every scholarship page says "attach an income certificate" and says it
 * with the words we searched for. Nothing is wrong with those passages, and one
 * of them turns out to hold "Who can issue the income certificate?", which is a
 * real ISSUING_AUTHORITY fact found on another service's page and exactly what
 * §9 said searching the whole estate would buy. But a heading that names the
 * service should outrank a body that references it in passing, and term
 * frequency will never say so on its own.
 *
 * So rank on where the name appears before ranking on score. Structure the
 * chunker already preserved, used as the signal it is:
 *
 *   3  a chunk of one of the service's own source pages
 *   2  every anchor term in the heading, so the section is about it
 *   1  every anchor term in the url, so the page is about it
 *   0  the words are in the body somewhere
 *
 * A rank, not a filter. Nothing is dropped for scoring zero here; it just stops
 * beating a passage that is genuinely on topic.
 */
export function topicality(hit, anchor, ownUrls) {
  // Through normalise, because the graph cites .../income-certificate/ and the
  // fetcher saved .../income-certificate, and one trailing slash was enough to
  // rank a service's own page below a scholarship FAQ. It is the same function
  // fetch-ledger.mjs uses to decide two citations are one fetch.
  if (ownUrls.has(normalise(hit.url))) return 3;
  if (!anchor.size) return 0;
  const has = (text) => {
    const t = new Set(tokens(text));
    return [...anchor].every((a) => t.has(a));
  };
  if (hit.heading && has(hit.heading)) return 2;
  if (has(String(hit.url ?? "").replace(/[/_.-]+/g, " "))) return 1;
  return 0;
}

/**
 * One service, one missing dimension, one pass.
 *
 * Union across the queries, dedupe by chunk, sort by best score any query gave
 * it. Not by summed score: a chunk that ranks first for the Gujarati query and
 * fourth for the English one is one good answer, and summing would rank it
 * below a chunk that placed mid table in all five, which is how a search
 * returns the page every query half matches and no query wanted.
 */
export async function retrieveOne(m, dimension, { retriever, graph, pass = 1 }) {
  const queries = queriesFor(m, dimension, graph);
  const best = new Map();
  const bySearch = [];

  for (const q of queries) {
    const hits = await retriever.search(q);
    bySearch.push({ query: q.query, jurisdictionId: q.jurisdictionId, hits: hits.length });
    for (const h of hits) {
      const prior = best.get(h.id);
      if (!prior || h.score > prior.score) best.set(h.id, { ...h, query: q.query });
    }
  }

  // Every anchor term, then any, then none. BM25 scores terms independently, so
  // a page repeating "fee" eleven times and "certificate" once outranks the page
  // that is actually about this service's fee: asking for FEES on Income
  // Certificate returned a transport permit fee schedule at rank one, because
  // the permit page says certificate and says fee a great deal. Requiring every
  // anchor term is an AND over a scorer that only does OR, and it is free.
  //
  // It falls back rather than failing, because a six word service title has six
  // anchor terms and no page repeats a title word for word. Which tier was used
  // is recorded: a shortlist built on ANY is one a reranker should be sceptical
  // of, and that is worth telling it.
  const anchor = anchorTerms(m.name, dimension);
  const hits = [...best.values()];
  const terms = new Map(hits.map((h) => [h.id, new Set(tokens(indexText(h)))]));
  const all = anchor.size ? hits.filter((h) => [...anchor].every((t) => terms.get(h.id).has(t))) : [];
  const any = anchor.size ? hits.filter((h) => [...anchor].some((t) => terms.get(h.id).has(t))) : [];
  const anchorMode = all.length ? "ALL" : any.length ? "ANY" : anchor.size ? "NONE" : "UNANCHORED";
  const anchored = all.length ? all : any.length ? any : anchor.size ? [] : hits;

  const ownUrls = new Set((m.urls ?? []).map(normalise));
  for (const h of anchored) h.topical = topicality(h, anchor, ownUrls);
  const candidates = anchored.sort((a, b) => b.topical - a.topical || b.score - a.score).slice(0, KEEP);

  return {
    serviceId: m.serviceId,
    dimension,
    pass,
    name: m.name,
    jurisdictionId: m.jurisdictionId,
    queries: bySearch,
    anchor: [...anchor],
    /** ALL every anchor term, ANY at least one, NONE none survived, UNANCHORED nothing to anchor on. */
    anchorMode,
    /** Matched on the dimension's own vocabulary and nothing about this service. */
    droppedUnanchored: best.size - anchored.length,
    // §28. A pass that found nothing says so, in a row, with the queries that
    // failed still attached. An empty result that leaves no trace is a search
    // somebody runs again next week.
    status: candidates.length ? "RETRIEVED" : "NO_EVIDENCE_FOUND",
    // Enough to find the passage again if the chunker changes underneath us.
    // The id alone is a hash of a page and an ordinal, and re-cutting a page
    // renumbers it; url plus offsets survive that, and the text is what P8
    // extracts from and what the substring gate checks against.
    candidates: candidates.map((c) => ({ id: c.id, sourceId: c.sourceId, url: c.url, heading: c.heading, start: c.start, end: c.end, score: c.score, topical: c.topical, query: c.query })),
  };
}

/**
 * Which pass to run for a service and dimension, or null to leave it alone.
 *
 * Pass 2 exists for the case where pass 1's queries were built from a graph
 * that has since learned something, so the queries are different now. It does
 * not exist to try the same queries twice, which is why a pass 1 that retrieved
 * anything is left alone: the shortlist is there, and it is P7 and P8's job to
 * fail on it, not this one's.
 */
export function nextPass(serviceId, dimension, ledger) {
  const rows = ledger.filter((r) => r.serviceId === serviceId && r.dimension === dimension);
  if (!rows.length) return 1;
  if (rows.length >= MAX_PASSES) return null;
  return rows.every((r) => r.status === "NO_EVIDENCE_FOUND") ? rows.length + 1 : null;
}

// ------------------------------------------------------------------ selftest

if (isMain && flag("selftest")) {
  const { default: assert } = await import("node:assert/strict");

  const chunk = (id, host, text, heading = null) => ({ id, host, url: `https://${host}/${id}`, heading, text, sourceId: `src:${id}`, start: 0, end: text.length });
  const corpus = [
    chunk("a", "collectorkheda.gujarat.gov.in", "Varsai Certificate is issued at the Mamlatdar office, Ayojan Bhavan, Nadiad, Kheda 387001."),
    chunk("b", "digitalgujarat.gov.in", "The fee for a Varsai Certificate is twenty rupees payable online."),
    chunk("c", "gujarattourism.com", "Photo gallery of the Rann Utsav festival grounds."),
  ];
  const retriever = new LexicalRetriever(corpus, { dedupe: false });

  const m = {
    serviceId: "service:varsai_certificate",
    name: "Varsai Certificate",
    jurisdictionId: "IN-GJ",
    urls: ["https://collectorkheda.gujarat.gov.in/varsai"],
    retrievable: ["OFFICE", "FEES"],
  };
  const graph = { nodes: new Map(), outgoing: new Map() };

  const office = await retrieveOne(m, "OFFICE", { retriever, graph });
  assert.equal(office.status, "RETRIEVED");
  assert.equal(office.candidates[0].id, "a", "the page with the address, found from a page that does not have it");
  assert.ok(office.queries.length >= 2, "every query is recorded, including the ones that found nothing");
  assert.ok(office.candidates.every((c) => c.url && c.start >= 0 && c.query), "a candidate has to be findable again after a re-chunk");
  assert.ok(!office.candidates.some((c) => c.id === "c"), "a photo gallery is not an office");

  // The union takes each chunk's best score, never the sum. Otherwise the page
  // every query half matches beats the page one query actually wanted.
  const fees = await retrieveOne(m, "FEES", { retriever, graph });
  assert.equal(fees.candidates[0].id, "b");
  assert.equal(new Set(fees.candidates.map((c) => c.id)).size, fees.candidates.length, "one row per chunk, however many queries found it");

  // §28. Nothing found is a finding, with the failed queries still attached.
  // Note this only works because of the anchor: every chunk saying "office"
  // scores for an OFFICE search, so without it this row would come back with
  // thirty candidates about a service the corpus has never heard of.
  const nothing = await retrieveOne({ ...m, name: "Zzznotaservice" }, "OFFICE", { retriever, graph });
  assert.equal(nothing.status, "NO_EVIDENCE_FOUND");
  assert.equal(nothing.candidates.length, 0);
  assert.ok(nothing.droppedUnanchored > 0, "they did match, on the word we supplied ourselves");
  assert.ok(nothing.queries.length, "the queries that failed are the record of what we tried");

  // The anchor drops the words the dimension already contributes.
  assert.deepEqual([...anchorTerms("Varsai Certificate", "OUTPUT")], ["varsai"], "OUTPUT already says certificate, so certificate proves nothing");
  assert.deepEqual([...anchorTerms("Varsai Certificate", "OFFICE")], ["varsai", "certificate"]);
  assert.equal(anchorTerms("Certificate", "OUTPUT").size, 0, "a name with nothing of its own leaves nothing to anchor on");

  // And when there is nothing to anchor on, the filter stands down rather than
  // filtering everything away.
  const unanchorable = await retrieveOne({ ...m, name: "Certificate" }, "OUTPUT", { retriever, graph });
  assert.ok(unanchorable.candidates.length > 0, "no anchor is a reason to distrust a shortlist, not to have none");
  assert.deepEqual(unanchorable.anchor, []);
  assert.equal(unanchorable.anchorMode, "UNANCHORED");

  // Every anchor term beats any of them. Both fixture pages say "certificate",
  // only one says "varsai", and an OR anchor would hand a reranker both.
  assert.equal(office.anchorMode, "ALL");
  assert.ok(office.candidates.every((c) => c.id === "a" || c.id === "b"), "both name words, or not on the list");
  assert.equal(nothing.anchorMode, "NONE");
  const loose = await retrieveOne({ ...m, name: "Varsai Zzznotaword Certificate" }, "OFFICE", { retriever, graph });
  assert.equal(loose.anchorMode, "ANY", "no page carries a three word title verbatim, so it falls back and says so");
  assert.ok(loose.candidates.length > 0);

  // Ranked on where the name appears, then on score. A section headed with the
  // service beats a better scoring paragraph that only mentions it in passing.
  const anchor = new Set(["varsai", "certificate"]);
  const own = new Set(["https://collectorkheda.gujarat.gov.in/varsai"]);
  assert.equal(topicality({ url: "https://collectorkheda.gujarat.gov.in/varsai" }, anchor, own), 3, "the service's own page");
  assert.equal(topicality({ url: "https://x.gov.in/faq", heading: "Varsai Certificate fees" }, anchor, own), 2);
  assert.equal(topicality({ url: "https://x.gov.in/varsai-certificate-apply", heading: "Fees" }, anchor, own), 1);
  assert.equal(topicality({ url: "https://x.gov.in/scholarship", heading: "Documents" }, anchor, own), 0, "mentions it in the body at best");
  assert.equal(topicality({ url: "https://x.gov.in/varsai", heading: "Varsai" }, new Set(), own), 0, "nothing to be on topic about");

  const ranked = await retrieveOne(
    { ...m, urls: [] },
    "FEES",
    {
      graph,
      retriever: new LexicalRetriever(
        [
          chunk("hi", "a.gov.in", "Varsai certificate fee twenty rupees."),
          chunk("lo", "b.gov.in", `The fee is thirty rupees payable at the counter. ${"Unrelated prose about opening hours and public holidays. ".repeat(20)}`, "Varsai Certificate charges"),
        ],
        { dedupe: false },
      ),
    },
  );
  assert.equal(ranked.candidates[0].id, "lo", "the heading that names the service outranks the page that repeats the dimension's words");
  assert.equal(ranked.candidates[0].topical, 2);
  assert.ok(ranked.candidates[1].score > ranked.candidates[0].score, "and it outranks it despite scoring lower, which is the whole point");

  // Resume, and the cap on it.
  const ledger = [{ serviceId: "s", dimension: "OFFICE", pass: 1, status: "RETRIEVED" }];
  assert.equal(nextPass("s", "OFFICE", ledger), null, "a shortlist already exists, so failing on it is P7's job not ours");
  assert.equal(nextPass("s", "FEES", ledger), 1, "a dimension never tried starts at one");
  assert.equal(nextPass("s", "OFFICE", []), 1);
  const empty = [{ serviceId: "s", dimension: "OFFICE", pass: 1, status: "NO_EVIDENCE_FOUND" }];
  assert.equal(nextPass("s", "OFFICE", empty), 2, "a pass that found nothing earns one more, once the graph has moved");
  assert.equal(nextPass("s", "OFFICE", [...empty, { serviceId: "s", dimension: "OFFICE", pass: 2, status: "NO_EVIDENCE_FOUND" }]), null, "§28: two, then stop, and never loop");

  assert.equal(done(ledger).has(key("s", "OFFICE", 1)), true);
  assert.equal(done(ledger).has(key("s", "OFFICE", 2)), false);

  console.log("services-deepen: ok");
  process.exit(0);
}

// ---------------------------------------------------------------------- run

if (isMain) {
  // readJsonl returns [] for a file that is not there, which is the first run.
  const ledger = readJsonl(EVIDENCE);

  if (flag("stats")) {
    report(ledger);
    process.exit(0);
  }

  const graph = loadGraph();
  const all = completeness(graph);
  const one = value("service");
  const only = value("dimension");

  let services = one ? all.filter((s) => s.serviceId === one || s.serviceId === `service:${one}`) : all;
  if (one && !services.length) {
    console.error(`No service ${one}.`);
    process.exit(1);
  }
  if (!one) services = services.slice(0, Number(value("limit", services.length)));

  console.log(`Reading the chunk store.`);
  const chunks = loadChunks();
  const started = Date.now();
  const index = buildIndex(chunks);
  const retriever = new LexicalRetriever(null, { index });
  console.log(`${index.docs.length} chunk(s) indexed in ${Date.now() - started}ms. No model, no network, nothing to pay for.\n`);

  const skip = done(ledger);
  const written = [];
  let considered = 0;
  let skipped = 0;

  for (const m of services) {
    for (const dimension of m.retrievable) {
      if (only && dimension !== only) continue;
      considered++;
      const pass = nextPass(m.serviceId, dimension, ledger);
      if (pass === null || skip.has(key(m.serviceId, dimension, pass))) {
        skipped++;
        continue;
      }
      const row = await retrieveOne(m, dimension, { retriever, graph, pass });
      written.push(row);
      skip.add(key(m.serviceId, dimension, pass));
      // Appended per row rather than at the end, so killing this halfway keeps
      // everything it had already found. services-extract.mjs writes nothing
      // until its pool drains and that is a lesson, not a pattern.
      appendJsonl(EVIDENCE, [row]);
    }
  }

  console.log(
    `${considered} service/dimension pair(s) considered, ${written.length} retrieved, ${skipped} already on disk or past §28's two passes.`,
  );
  report([...ledger, ...written], { write: true });
}

/** What is in the ledger, and what it is worth. */
function report(rows, { write = false } = {}) {
  if (!rows.length) {
    console.log(`Nothing retrieved yet. Run: pnpm services:deepen --limit 20`);
    return;
  }
  const found = rows.filter((r) => r.status === "RETRIEVED");
  const byDimension = new Map();
  for (const r of rows) {
    const d = byDimension.get(r.dimension) ?? { tried: 0, found: 0, candidates: 0 };
    d.tried++;
    if (r.status === "RETRIEVED") {
      d.found++;
      d.candidates += r.candidates.length;
    }
    byDimension.set(r.dimension, d);
  }

  const width = Math.max(...[...byDimension.keys()].map((k) => k.length));
  console.log(`\n${rows.length} retrieval(s) on disk across ${new Set(rows.map((r) => r.serviceId)).size} service(s)\n`);
  for (const [d, s] of [...byDimension.entries()].sort((a, b) => b[1].found - a[1].found)) {
    console.log(`  ${d.padEnd(width)}  ${String(s.found).padStart(5)} of ${String(s.tried).padEnd(5)}  ${String(s.candidates).padStart(6)} candidate(s)`);
  }

  const empty = rows.length - found.length;
  const passages = found.reduce((n, r) => n + r.candidates.length, 0);
  const unanchored = rows.reduce((n, r) => n + (r.droppedUnanchored ?? 0), 0);
  const loose = found.filter((r) => r.anchorMode === "ANY").length;
  console.log(`\n  ${passages} candidate passage(s) waiting for a reranker`);
  if (unanchored) console.log(`  ${unanchored} hit(s) dropped for matching the dimension's vocabulary and nothing about the service`);
  if (loose) console.log(`  ${loose} shortlist(s) built on a partial name match, worth a reranker's suspicion`);
  if (empty) console.log(`  ${empty} pair(s) the corpus genuinely does not answer, recorded as NO_EVIDENCE_FOUND rather than retried`);
  console.log(`\n  Nothing above has been believed yet. A candidate is a passage worth reading, not a fact.`);

  // The ledger itself is gitignored, for the same reason chunks.jsonl is: it
  // rebuilds from committed inputs with no model call and no network. What
  // belongs in a diff is this, which is small and says whether a pass moved.
  if (write) {
    writeFileSync(at(EVIDENCE_SUMMARY), JSON.stringify({ generatedBy: "pnpm services:deepen", retrievals: rows.length, services: new Set(rows.map((r) => r.serviceId)).size, passages, unanchored, partialNameMatch: loose, noEvidence: empty, byDimension: Object.fromEntries([...byDimension.entries()].map(([d, s]) => [d, s])) }, null, 2) + "\n");
    console.log(`\n  ${EVIDENCE_SUMMARY} written`);
  }
}
