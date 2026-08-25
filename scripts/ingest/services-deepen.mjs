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
import { buildIndex, DIMENSIONS, loadChunks, LexicalRetriever, tokens } from "./corpus.mjs";
import { appendJsonl, at, INGEST, readJsonl } from "./lib.mjs";
import { queriesFor } from "./queries.mjs";
import { hostOf, normalise } from "../lib/url.mjs";

export const EVIDENCE = INGEST + "evidence.jsonl";
export const EVIDENCE_SUMMARY = "docs/research/evidence.json";

/** §28. Two, and the second only runs if the first found nothing. */
export const MAX_PASSES = 2;
/** §12. Union the queries, dedupe, keep about thirty for the reranker to cut to eight. */
const KEEP = 30;

/**
 * Bump when a change here would shortlist different passages for the same
 * service and dimension.
 *
 * Every other cache in this pipeline versions itself. An extraction is keyed on
 * the schema, the prompt, the gate and the model, so editing any of them
 * invalidates by construction and nobody has to remember. This ledger was keyed
 * on the service, the dimension and the pass, and on nothing at all about the
 * retriever that produced the row.
 *
 * Which meant that moving the anchor inside the scorer, the fix that took six
 * eval misses to five, changed what every shortlist in the corpus should
 * contain, and the ledger reported all 4,829 rows already done. The improvement
 * was real, on disk, and unreachable, and there was no error to read: a stale
 * cache and a finished job look identical from here.
 *
 * 2: the anchor became a filter passed into `search` rather than a pass over
 *    its top twenty results.
 * 3: the anchor became every name the service answers to, not just the one the
 *    compiler settled on.
 */
export const RETRIEVER_VERSION = 3;

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

/**
 * What identifies one unit of work, and therefore what makes it skippable.
 *
 * A row written before versioning has no `retriever` field, and `undefined`
 * keys differently from 2, which is exactly right: we cannot know what produced
 * it, so it does not count as this retriever's work.
 */
export const key = (serviceId, dimension, pass, retriever = RETRIEVER_VERSION) =>
  `${serviceId}|${dimension}|${pass}|r${retriever}`;

/**
 * Everything already retrieved, as the set of keys not worth doing again.
 *
 * The ledger is append only and never rewritten, so a run that dies halfway
 * leaves a shorter file rather than a corrupt one, and the next run picks up
 * from exactly where it stopped. Reading it back is the entire resume mechanism;
 * there is no state anywhere else.
 */
export function done(rows) {
  // `?? null` and not the bare field. A default parameter fires on undefined,
  // so passing a pre-versioning row's missing `retriever` straight through
  // stamped it with the current version and called it done, which is the exact
  // bug the version exists to prevent. null does not trigger a default.
  return new Set(rows.map((r) => key(r.serviceId, r.dimension, r.pass, r.retriever ?? null)));
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
 * The same idea, once per name the service answers to.
 *
 * A service has one name in the graph and the pages that describe it are under
 * no obligation to use it. `service:varshai` is named after its url; the word
 * "varshai" occurs in zero of 24,110 chunks, while વારસાઈ occurs in 48 and
 * varsai in 4. Anchoring on the name alone meant every search for it was
 * filtered down to nothing, so all seven of its missing dimensions retrieved
 * NO_EVIDENCE_FOUND, and a service with nine required documents and a hero
 * demo behind it could not be deepened at all.
 *
 * Alternatives, not one larger bag of words. Flattening "legal heir
 * certificate" into the anchor would make `whole` mean "carries varshai AND
 * legal AND heir AND certificate", which no page on earth does, so the tier
 * would collapse to ANY for every service that has an alias. Kept apart, a
 * page carrying all three words of one alias is as much a full title match as
 * a page carrying the official name, which is what it is.
 *
 * The union still filters, so this only ever widens what reaches BM25. That is
 * the direction §5 asked for and the fact level guard in enrich.mjs is
 * untouched: a passage that is not topical still cannot produce a fact unless
 * the quote itself names the service.
 */
export function anchorPhrases(m, dimension) {
  const seen = new Set();
  const phrases = [];
  for (const name of [m.name, ...(m.aliases ?? [])]) {
    const terms = [...anchorTerms(name ?? "", dimension)];
    if (!terms.length) continue;
    const k = terms.join(" ");
    if (seen.has(k)) continue;
    seen.add(k);
    phrases.push(terms);
  }
  return { phrases, union: new Set(phrases.flat()) };
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
 *   1  a page on a host this service already lives on, and that host is not a catalogue
 *   0  the words are in the body somewhere
 *
 * The host rung was added after the extraction pass found the FAQ at
 * parivahan.gov.in/en/content/faq scoring zero for driving licence. Parivahan is
 * the driving licence, the FAQ is where it tells you to take an appointment and
 * visit the RTO, and the only reason it scored zero is that the graph happened to
 * cite a different page on the same site and the words "permanent license" are
 * not in the url. Same for the Mamlatdar's duties on anand.gujarat.gov.in, which
 * is where property records already live.
 *
 * It is deliberately not a rung for umang, myScheme or ced.gujarat.gov.in, which
 * 58, 56 and 45 services cite respectively. A host that many services live on is
 * a catalogue, and a page on it is about exactly one of them, which is precisely
 * the ambiguity this function exists to resolve. Measured: 168 hosts across the
 * graph, 78 cited by a single service, 16 cited by more than five.
 *
 * A rank, not a filter. Nothing is dropped for scoring zero here; it just stops
 * beating a passage that is genuinely on topic.
 */
export function topicality(hit, phrases, ownUrls, ownHosts = new Set()) {
  // Through normalise, because the graph cites .../income-certificate/ and the
  // fetcher saved .../income-certificate, and one trailing slash was enough to
  // rank a service's own page below a scholarship FAQ. It is the same function
  // fetch-ledger.mjs uses to decide two citations are one fetch.
  if (ownUrls.has(normalise(hit.url))) return 3;
  const onOwnHost = ownHosts.has(hostOf(String(hit.url ?? "")));
  if (!phrases.length) return onOwnHost ? 1 : 0;
  // Any one name in full, not every word of every name. Flattening the names
  // into one set would ask a heading to say varshai and varsai and વારસાઈ and
  // legal and heir and certificate before it counted as being about the
  // subject, which is a heading nobody has ever written.
  const has = (text) => {
    const t = new Set(tokens(text));
    return phrases.some((terms) => terms.every((a) => t.has(a)));
  };
  if (hit.heading && has(hit.heading)) return 2;
  if (has(String(hit.url ?? "").replace(/[/_.-]+/g, " "))) return 1;
  return onOwnHost ? 1 : 0;
}

/**
 * The hosts a service can be said to live on: cited by it, and not a catalogue.
 *
 * CATALOGUE is the number of services above which a host stops identifying one.
 * Five is where the measured distribution turns: umang 58, myScheme 56, ced 45,
 * gujarattourism 20, then a tail where 78 of 168 hosts belong to one service
 * each. Nothing magic about the number, and it is a number rather than a list of
 * hostnames on purpose, because the estate keeps growing and a hardcoded list of
 * government portals would be stale by the next crawl.
 */
const CATALOGUE = 5;

export function ownHostsOf(rows) {
  const fanout = new Map();
  for (const m of rows) for (const h of hostsOf(m)) fanout.set(h, (fanout.get(h) ?? 0) + 1);
  return new Map(rows.map((m) => [m.serviceId, new Set([...hostsOf(m)].filter((h) => fanout.get(h) <= CATALOGUE))]));
}

const hostsOf = (m) => new Set((m.urls ?? []).map(hostOf).filter(Boolean));

/**
 * One service, one missing dimension, one pass.
 *
 * Union across the queries, dedupe by chunk, sort by best score any query gave
 * it. Not by summed score: a chunk that ranks first for the Gujarati query and
 * fourth for the English one is one good answer, and summing would rank it
 * below a chunk that placed mid table in all five, which is how a search
 * returns the page every query half matches and no query wanted.
 */
export async function retrieveOne(m, dimension, { retriever, graph, pass = 1, ownHosts = new Set() }) {
  const queries = queriesFor(m, dimension, graph);
  const best = new Map();
  const bySearch = [];

  // How much of the service's own name each chunk in the corpus carries, decided
  // once from the postings and handed to the scorer as a filter.
  //
  // This used to run on the results instead, and running it on the results is
  // the bug the eval found. The retriever expands every search with its
  // dimension's vocabulary, so a search for VERIFICATION returns twenty
  // passages about inspections and enquiries whether or not any of them has
  // heard of this service, and the anchor then kept the two that had. Six eval
  // questions had shortlists of two, three and five passages for that reason,
  // out of a budget of thirty we had already paid to retrieve.
  //
  // Inside the scorer, the same rule spends the whole budget on passages that
  // at least mention us. corpus.mjs says exactly this about the jurisdiction
  // filter one function up; the anchor is the same argument.
  const { phrases, union: anchor } = anchorPhrases(m, dimension);
  const carried = anchor.size ? retriever.coverage(anchor) : null;
  // Per name, so "carries a whole title" can be satisfied by any one of them
  // rather than by all of them at once. One entry when there are no aliases,
  // which is the case this used to be written for.
  const perPhrase = phrases.map((terms) => ({ terms, carried: retriever.coverage(terms) }));
  const carriesWhole = (id) => perPhrase.some((p) => p.carried.get(id) === p.terms.length);
  const excluded = new Set();
  const filter = carried
    ? (c) => {
        if (carried.has(c.id)) return true;
        excluded.add(c.id);
        return false;
      }
    : null;

  for (const q of queries) {
    const hits = await retriever.search({ ...q, filter });
    bySearch.push({ query: q.query, jurisdictionId: q.jurisdictionId, hits: hits.length });
    for (const h of hits) {
      const prior = best.get(h.id);
      if (!prior || h.score > prior.score) best.set(h.id, { ...h, query: q.query });
    }
  }

  // Every anchor term first, then the rest. BM25 scores terms independently, so
  // a page repeating "fee" eleven times and "certificate" once outranks the page
  // that is actually about this service's fee: asking for FEES on Income
  // Certificate returned a transport permit fee schedule at rank one, because
  // the permit page says certificate and says fee a great deal. Carrying the
  // whole title is an AND over a scorer that only does OR, and it is free.
  //
  // It is a sort key and not a gate, which it used to be, and being a gate cost
  // us real answers. The eval found six questions the top thirty never answered
  // and the shortlists were two, three and five passages long: a single page
  // happened to carry every word of the title, so the tier above fired, and the
  // twenty five slots we had already paid to retrieve were thrown away. §5 is
  // blunt about it. "Page does not contain the exact service phrase" cannot mean
  // "page can never contain useful evidence", because finding facts off a
  // service's own page is the entire reason §9 built a corpus-wide retriever.
  //
  // Nothing is loosened downstream by this. A passage that is not anchored still
  // scores topical 0, and enrich.mjs refuses a fact off a topical 0 passage
  // unless the quote itself names the service, for the two dimensions where
  // identity travels between pages. The gate that matters is at the fact, not at
  // the shortlist.
  //
  // Which tier the best candidate reached is still recorded: a shortlist where
  // nothing carried the whole title is one a reranker should be sceptical of.
  const hits = [...best.values()];
  const whole = anchor.size ? hits.filter((h) => carriesWhole(h.id)) : [];
  const anchorMode = !anchor.size ? "UNANCHORED" : whole.length ? "ALL" : hits.length ? "ANY" : "NONE";

  const ownUrls = new Set((m.urls ?? []).map(normalise));
  for (const h of hits) {
    h.topical = topicality(h, phrases, ownUrls, ownHosts);
    h.whole = anchor.size ? Number(carriesWhole(h.id)) : 0;
  }
  const candidates = hits.sort((a, b) => b.whole - a.whole || b.topical - a.topical || b.score - a.score).slice(0, KEEP);

  return {
    serviceId: m.serviceId,
    dimension,
    pass,
    /** Which retriever shortlisted this. Absent on a row written before there was one. */
    retriever: RETRIEVER_VERSION,
    name: m.name,
    jurisdictionId: m.jurisdictionId,
    queries: bySearch,
    anchor: [...anchor],
    /** The best tier reached: ALL a candidate carries every anchor term, ANY only some, NONE none survived, UNANCHORED nothing to anchor on. */
    anchorMode,
    /** Chunks the queries matched on the dimension's own vocabulary and nothing about this service. The one hard exclusion, and now counted across the whole corpus rather than across a top twenty. */
    droppedUnanchored: excluded.size,
    // §28. A pass that found nothing says so, in a row, with the queries that
    // failed still attached. An empty result that leaves no trace is a search
    // somebody runs again next week.
    status: candidates.length ? "RETRIEVED" : "NO_EVIDENCE_FOUND",
    // Enough to find the passage again if the chunker changes underneath us.
    // The id alone is a hash of a page and an ordinal, and re-cutting a page
    // renumbers it; url plus offsets survive that, and the text is what P8
    // extracts from and what the substring gate checks against.
    candidates: candidates.map((c) => ({ id: c.id, sourceId: c.sourceId, url: c.url, heading: c.heading, start: c.start, end: c.end, score: c.score, topical: c.topical, whole: c.whole, query: c.query })),
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
  // This retriever's rows only. An older retriever having burned both passes is
  // not evidence that this one has nothing to find, and counting them means a
  // service that came back empty twice can never benefit from a fix.
  const rows = ledger.filter(
    (r) => r.serviceId === serviceId && r.dimension === dimension && r.retriever === RETRIEVER_VERSION,
  );
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

  // Every name it answers to, kept apart. The real case: "varshai" is in no
  // page anywhere, so a service anchored only on it retrieved nothing at all.
  const named = anchorPhrases({ name: "varshai", aliases: ["varsai", "legal heir certificate", "વારસાઈ"] }, "OFFICE");
  assert.deepEqual(named.phrases, [["varshai"], ["varsai"], ["legal", "heir", "certificate"], ["વારસાઈ"]]);
  assert.deepEqual([...named.union], ["varshai", "varsai", "legal", "heir", "certificate", "વારસાઈ"], "the union is what filters, so any one of them lets a passage through");
  assert.deepEqual(anchorPhrases({ name: "Varsai Certificate" }, "OFFICE").phrases, [["varsai", "certificate"]], "no aliases is one phrase, which is what this used to be");
  assert.deepEqual(anchorPhrases({ name: "Varsai", aliases: ["varsai", "VARSAI"] }, "OFFICE").phrases, [["varsai"]], "the same name spelled three ways is one phrase, not three");
  assert.deepEqual(anchorPhrases({ name: "Certificate", aliases: ["certificate"] }, "OUTPUT").phrases, [], "a service whose every name is the dimension's own word still anchors on nothing");

  // A heading has to carry one whole name, not every word of every name. This
  // is the assertion that fails if the union is ever flattened back into the
  // topicality check: no heading says varshai and varsai and legal and heir.
  assert.equal(topicality({ url: "https://x.gov.in/a", heading: "Legal Heir Certificate fees" }, named.phrases, new Set()), 2);
  assert.equal(topicality({ url: "https://x.gov.in/a", heading: "વારસાઈ પ્રમાણપત્ર" }, named.phrases, new Set()), 2, "and it counts in Gujarati too");
  assert.equal(topicality({ url: "https://x.gov.in/a", heading: "Heir" }, named.phrases, new Set()), 0, "one word of a three word name is not the name");

  // And when there is nothing to anchor on, the filter stands down rather than
  // filtering everything away.
  const unanchorable = await retrieveOne({ ...m, name: "Certificate" }, "OUTPUT", { retriever, graph });
  assert.ok(unanchorable.candidates.length > 0, "no anchor is a reason to distrust a shortlist, not to have none");
  assert.deepEqual(unanchorable.anchor, []);
  assert.equal(unanchorable.anchorMode, "UNANCHORED");

  // Every anchor term beats any of them, and a passage carrying none of them is
  // still the one hard exclusion: it matched on the word the dimension supplied.
  assert.equal(office.anchorMode, "ALL");
  assert.ok(office.candidates.every((c) => c.id === "a" || c.id === "b"), "a photo gallery carries no word of the name");
  assert.ok(office.candidates.every((c) => c.whole === 1));
  assert.equal(nothing.anchorMode, "NONE");
  const loose = await retrieveOne({ ...m, name: "Varsai Zzznotaword Certificate" }, "OFFICE", { retriever, graph });
  assert.equal(loose.anchorMode, "ANY", "no page carries a three word title verbatim, so it says so");
  assert.ok(loose.candidates.length > 0);
  assert.ok(loose.candidates.every((c) => c.whole === 0), "and every candidate on it is a partial match");

  // §5. The anchor ranks, it does not gate. One page carrying the whole title
  // used to throw away the other twenty nine slots we had already retrieved,
  // which is how six eval questions had shortlists two and three passages long.
  const backfill = await retrieveOne(
    { ...m, name: "Varsai Certificate", urls: [] },
    "FEES",
    {
      graph,
      retriever: new LexicalRetriever(
        [
          chunk("whole", "a.gov.in", "Varsai Certificate fee is twenty rupees."),
          chunk("partial", "b.gov.in", "The Varsai application fee is thirty rupees at the counter."),
        ],
        { dedupe: false },
      ),
    },
  );
  assert.equal(backfill.anchorMode, "ALL", "the tier is still reported off the best candidate");
  assert.deepEqual(backfill.candidates.map((c) => c.id), ["whole", "partial"], "the full title match leads and the partial one is kept below it, not deleted");
  assert.deepEqual(backfill.candidates.map((c) => c.whole), [1, 0], "and a reranker can see which is which");
  assert.equal(backfill.droppedUnanchored, 0);

  // Ranked on where the name appears, then on score. A section headed with the
  // service beats a better scoring paragraph that only mentions it in passing.
  const anchor = [["varsai", "certificate"]];
  const own = new Set(["https://collectorkheda.gujarat.gov.in/varsai"]);
  assert.equal(topicality({ url: "https://collectorkheda.gujarat.gov.in/varsai" }, anchor, own), 3, "the service's own page");
  assert.equal(topicality({ url: "https://x.gov.in/faq", heading: "Varsai Certificate fees" }, anchor, own), 2);
  assert.equal(topicality({ url: "https://x.gov.in/varsai-certificate-apply", heading: "Fees" }, anchor, own), 1);
  assert.equal(topicality({ url: "https://x.gov.in/scholarship", heading: "Documents" }, anchor, own), 0, "mentions it in the body at best");
  assert.equal(topicality({ url: "https://x.gov.in/varsai", heading: "Varsai" }, [], own), 0, "nothing to be on topic about");

  // A different page on the host this service already lives on. Parivahan's FAQ
  // is the driving licence FAQ even though nothing in its url says so.
  const host = new Set(["collectorkheda.gujarat.gov.in"]);
  assert.equal(topicality({ url: "https://collectorkheda.gujarat.gov.in/faq", heading: "Questions" }, anchor, own, host), 1);
  assert.equal(topicality({ url: "https://collectorkheda.gujarat.gov.in/faq", heading: "Questions" }, [], own, host), 1, "and it does not need an anchor to say so");
  assert.equal(topicality({ url: "https://myscheme.gov.in/schemes/xyz", heading: "Questions" }, anchor, own, host), 0, "a host we do not live on is still nowhere");
  assert.equal(topicality({ url: "https://x.gov.in/faq", heading: "Varsai Certificate fees" }, anchor, own, host), 2, "and it never demotes a better reason");

  // A host is only a home if it is not a catalogue. Both of these cite umang;
  // only one of them cites the Kheda collectorate, and 3 > CATALOGUE would make
  // that a catalogue too.
  const homes = ownHostsOf([
    { serviceId: "a", urls: ["https://collectorkheda.gujarat.gov.in/varsai", "https://web.umang.gov.in/x"] },
    ...Array.from({ length: 6 }, (_, i) => ({ serviceId: `b${i}`, urls: ["https://web.umang.gov.in/y" + i] })),
  ]);
  assert.deepEqual([...homes.get("a")], ["collectorkheda.gujarat.gov.in"], "seven services on umang means umang identifies none of them");
  assert.deepEqual([...homes.get("b0")], []);

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
  const r = RETRIEVER_VERSION;
  const ledger = [{ serviceId: "s", dimension: "OFFICE", pass: 1, retriever: r, status: "RETRIEVED" }];
  assert.equal(nextPass("s", "OFFICE", ledger), null, "a shortlist already exists, so failing on it is P7's job not ours");
  assert.equal(nextPass("s", "FEES", ledger), 1, "a dimension never tried starts at one");
  assert.equal(nextPass("s", "OFFICE", []), 1);
  const empty = [{ serviceId: "s", dimension: "OFFICE", pass: 1, retriever: r, status: "NO_EVIDENCE_FOUND" }];
  assert.equal(nextPass("s", "OFFICE", empty), 2, "a pass that found nothing earns one more, once the graph has moved");
  assert.equal(nextPass("s", "OFFICE", [...empty, { serviceId: "s", dimension: "OFFICE", pass: 2, retriever: r, status: "NO_EVIDENCE_FOUND" }]), null, "§28: two, then stop, and never loop");

  assert.equal(done(ledger).has(key("s", "OFFICE", 1)), true);
  assert.equal(done(ledger).has(key("s", "OFFICE", 2)), false);

  // A retriever change invalidates the ledger, the way every other cache here
  // already works. Without this the fix that moved the anchor into the scorer
  // was unreachable: 4,829 rows on disk, all of them stale, all of them
  // reported as done, and nothing to read that would tell you.
  const older = [
    { serviceId: "s", dimension: "OFFICE", pass: 1, retriever: r - 1, status: "RETRIEVED" },
    { serviceId: "s", dimension: "FEES", pass: 1, retriever: r - 1, status: "NO_EVIDENCE_FOUND" },
    { serviceId: "s", dimension: "FEES", pass: 2, retriever: r - 1, status: "NO_EVIDENCE_FOUND" },
  ];
  assert.equal(done(older).has(key("s", "OFFICE", 1)), false, "another retriever's shortlist is not this one's work");
  assert.equal(nextPass("s", "OFFICE", older), 1, "so it starts over");
  assert.equal(nextPass("s", "FEES", older), 1, "and two empty passes by an older retriever do not spend this one's budget");
  assert.equal(nextPass("s", "FEES", [...older, { serviceId: "s", dimension: "FEES", pass: 1, retriever: r, status: "NO_EVIDENCE_FOUND" }]), 2, "§28's cap still counts, per retriever");

  // Rows predating versioning have no field at all, which has to read the same
  // as a different one rather than as a match.
  const unversioned = [{ serviceId: "s", dimension: "OFFICE", pass: 1, status: "RETRIEVED" }];
  assert.equal(done(unversioned).has(key("s", "OFFICE", 1)), false);
  assert.equal(nextPass("s", "OFFICE", unversioned), 1);

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

  // Measured across the whole graph, not the slice this run touches: whether a
  // host identifies one service is a fact about the estate, and --limit 5 must
  // not turn myScheme into somebody home address.
  const hosts = ownHostsOf(all);

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
      const row = await retrieveOne(m, dimension, { retriever, graph, pass, ownHosts: hosts.get(m.serviceId) ?? new Set() });
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
