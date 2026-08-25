/**
 * Lexical search over every page we ever fetched.
 *
 *   pnpm corpus:index                    build it, report what is in it
 *   pnpm corpus:search "mamlatdar kheda office address"
 *   pnpm corpus:search "income limit" --dimension ELIGIBILITY --limit 5
 *
 * This is the architectural change §9 asks for, and it is one sentence long: a
 * service is no longer limited to facts found on its own page. 279 offices in
 * the last compile had a name and no address, because the name was on the
 * service page and the address was on the contact page, and nothing joined
 * them. Now something can look.
 *
 * BM25 over the chunk store, in memory, no dependencies. Not because BM25 is
 * fashionable but because it is the thing that works without an embedding
 * model, and this Bedrock account exposes 55 models and not one of those is an
 * embedding model. §17 says semantic retrieval comes after lexical retrieval
 * has evals; this is the half that can be built today and measured tomorrow.
 *
 * Two deliberate omissions.
 *
 * No stopword list. BM25's IDF already drives a term appearing in most
 * documents to near zero weight, and a hand written stopword list is a second
 * mechanism doing the same job with a Gujarati column somebody has to maintain.
 *
 * No stemming. "certificate" and "certificates" are two terms here. An English
 * stemmer applied to a corpus that is half Gujarati is worse than no stemmer,
 * and the query generator can emit both forms for free.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHUNKS } from "./chunks.mjs";
import { at, readJsonl, sha1 } from "./lib.mjs";
import { districtOf } from "./places.mjs";

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/**
 * Whether this file was run, as opposed to imported.
 *
 * Two bugs it exists to prevent, both of which chunks.mjs hit first. A bare
 * `if (flag("selftest"))` is true on *import* when the parent was invoked with
 * `--selftest`, so importing this module ran its tests. And the obvious guard,
 * `if (notMain) process.exit(0)`, exits the importing process instead.
 */
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

/** Positional words, with `--flag value` pairs removed. */
const TAKES_VALUE = new Set(["--dimension", "--limit", "--jurisdiction"]);
const positional = () => {
  const out = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (TAKES_VALUE.has(argv[i])) i++;
      continue;
    }
    out.push(argv[i]);
  }
  return out.join(" ");
};

/**
 * The dimensions a service can be incomplete in, and the words a government
 * page uses when it is answering that dimension.
 *
 * §8's list, with the vocabulary attached. This is expansion, not generation:
 * P5 builds the query out of what the graph already knows about a service, and
 * this only adds the words that say which *kind* of answer we are after. Both
 * scripts, so it lives here rather than in either of them.
 *
 * Gujarati terms are in the same list rather than a parallel one, because a
 * bilingual estate means the answer is as likely to be in one script as the
 * other and BM25 does not care which language a term is in.
 */
export const DIMENSIONS = {
  DOCUMENTS: ["documents", "document", "required", "attach", "proof", "enclosure", "દસ્તાવેજ", "જરૂરી", "પુરાવો"],
  ELIGIBILITY: ["eligibility", "eligible", "criteria", "income", "limit", "age", "resident", "પાત્રતા", "લાયકાત", "આવક"],
  ACTIONS: ["procedure", "process", "steps", "how to apply", "apply", "submit", "પ્રક્રિયા", "અરજી"],
  OFFICE: ["office", "address", "visit", "counter", "bhavan", "kendra", "કચેરી", "સરનામું"],
  FEES: ["fee", "fees", "charges", "rupees", "payment", "amount", "ફી", "રૂપિયા"],
  TRACKING: ["track", "status", "application number", "acknowledgement", "receipt", "સ્થિતિ"],
  OUTPUT: ["certificate", "issued", "delivered", "download", "output", "પ્રમાણપત્ર"],
  HELPLINE: ["helpline", "contact", "phone", "toll free", "email", "હેલ્પલાઇન", "સંપર્ક", "ફોન"],
  ESCALATION: ["grievance", "appeal", "complaint", "escalate", "appellate", "ફરિયાદ", "અપીલ"],
  ISSUING_AUTHORITY: ["issued by", "authority", "officer", "mamlatdar", "collector", "sanctioned", "અધિકારી"],
  VERIFICATION: ["verification", "verified", "inspection", "enquiry", "ચકાસણી", "તપાસ"],
};

/**
 * Words, in whatever script the page was written in.
 *
 * `\p{L}` covers Gujarati, Devanagari and Latin in one rule, which is the whole
 * reason to use it rather than `[a-z0-9]`: `[a-z0-9]` would tokenise a Gujarati
 * page to the empty list and half this corpus would silently stop being
 * searchable.
 *
 * `\p{M}` is there because `\p{L}` alone is not enough, and this was a live bug
 * for as long as it took the selftest below to run. Gujarati vowel signs and the
 * virama are marks, not letters, so `[\p{L}\p{N}]+` cut દસ્તાવેજ into
 * ["દસ", "ત", "વ", "જ"] and ફી into ["ફ"], which the length filter then dropped
 * entirely. Every Gujarati term in the corpus was being either fragmented or
 * deleted, and nothing would have said so: the index would have built, reported
 * a healthy term count, and quietly never matched a Gujarati query.
 *
 * Single characters are dropped because a lone consonant or initial carries no
 * meaning and appears everywhere.
 */
export const tokens = (text) =>
  (String(text ?? "").toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).filter((t) => t.length > 1);

/**
 * What a chunk is indexed by, as opposed to what it says.
 *
 * The district is prepended because `collectorkheda.gujarat.gov.in` never
 * prints the word "Kheda" with a space around it, so a chunk on that host is
 * unfindable by anyone searching for Kheda, which is everyone who needs it.
 * The heading is prepended because a passage under "Required Documents" is
 * about documents even when the passage itself only lists nouns.
 *
 * This string is never quoted and never shown. Evidence is `chunk.text`, which
 * is an exact slice of a page. §7: contextualise for retrieval, never mutate
 * provenance.
 */
export const indexText = (chunk) =>
  [districtOf(chunk.host).replace("IN-GJ-", "").replace(/_/g, " "), chunk.heading, chunk.text].filter(Boolean).join("\n");

/**
 * The same passage, seen again on the same host.
 *
 * Every collectorate page carries the same sixty line menu naming all thirty
 * three districts, and to BM25 that is a passage about districts sitting on two
 * thousand pages. A query for "Kheda Mamlatdar office" fills its top twenty with
 * copies of the menu and never reaches the one page that has the address.
 *
 * The answer is to keep the first copy and drop the rest, not to drop them all.
 * Dropping them all was the first version and it is wrong: the test cannot tell
 * a nav menu from a fee table that genuinely appears on six pages, so blanket
 * removal makes real facts unreachable to punish them for being well published.
 * One copy costs one result and keeps the fact quotable.
 *
 * Per host, not globally. The same sentence on two collectorates is two
 * districts saying it, and collapsing that would answer a Kheda question with
 * Surat's page.
 *
 * Limitation: exact normalised match, so a menu that differs by one highlighted
 * item per page survives as N copies. Shingling would catch those and costs a
 * second pass over 38,000 chunks. Revisit if the eval in §25 says these are what
 * it is retrieving.
 */
export function duplicate() {
  const seen = new Set();
  return (c) => {
    const key = `${c.host}|${sha1(tokens(c.text).join(" "))}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  };
}

/**
 * An inverted index over the chunk store.
 *
 * Plain objects and arrays. 38,000 documents is not a scale that needs a
 * library, a service or a format: it is 3 seconds and 200MB, measured, and §34
 * says every new dependency needs a measurable reason.
 */
export function buildIndex(chunks, { dedupe = true } = {}) {
  const isCopy = dedupe ? duplicate() : () => false;
  const docs = [];
  const skipped = [];
  for (const c of chunks) {
    if (isCopy(c)) {
      skipped.push(c);
      continue;
    }
    docs.push(c);
  }

  /** term -> [docIndex, termFrequency, ...] flat, because pairs of pairs are slow. */
  const postings = new Map();
  const length = new Int32Array(docs.length);
  let total = 0;

  for (let d = 0; d < docs.length; d++) {
    const terms = tokens(indexText(docs[d]));
    length[d] = terms.length;
    total += terms.length;
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) {
      const list = postings.get(t);
      if (list) list.push(d, n);
      else postings.set(t, [d, n]);
    }
  }

  return { docs, postings, length, avgLength: total / (docs.length || 1), skipped };
}

/** Okapi BM25's usual constants. Not tuned, because nothing has been measured yet. */
const K1 = 1.2;
const B = 0.75;

/**
 * Score every document that contains at least one query term.
 *
 * Walks postings rather than documents, so a two term query touches two lists
 * instead of 38,000 chunks. `filter` is applied at scoring time and not
 * afterwards, because a jurisdiction filter that runs after the top 20 are
 * chosen returns three results and looks like an empty corpus.
 */
export function score(index, queryTokens, { limit = 20, filter = null } = {}) {
  const { docs, postings, length, avgLength } = index;
  const N = docs.length;
  const scores = new Map();

  for (const term of new Set(queryTokens)) {
    const list = postings.get(term);
    if (!list) continue;
    const df = list.length / 2;
    // The usual BM25 idf, with the +1 that keeps it positive. Without it a term
    // in more than half the corpus scores negative and a document is punished
    // for containing a word you asked for.
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < list.length; i += 2) {
      const d = list[i];
      const tf = list[i + 1];
      if (filter && !filter(docs[d])) continue;
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (length[d] / avgLength)));
      scores.set(d, (scores.get(d) ?? 0) + idf * norm);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([d, s], i) => ({ ...docs[d], score: Number(s.toFixed(4)), rank: i + 1 }));
}

/**
 * §8's `EvidenceRetriever`, over the local chunk store.
 *
 * One implementation, one interface, and §34 would normally call that an
 * abstraction for its own sake. It earns its place because §13 and §18 both
 * plan to put something else behind it (a reranker, then a hybrid of this and
 * an embedding index), and the depth engine should not have to be edited when
 * they arrive. If neither lands, delete the interface and keep the function.
 */
export class LexicalRetriever {
  constructor(chunks, opts = {}) {
    // `index` is for the CLI, which has already built one to report on it and
    // should not pay for a second pass over 38,000 chunks to then search it.
    this.index = opts.index ?? buildIndex(chunks, opts);
  }

  /**
   * For every chunk carrying at least one of these terms, how many it carries.
   *
   * The postings already know this. Asking them costs a walk over the terms'
   * document lists; the obvious alternative, tokenising each hit's indexText
   * again, costs a re-tokenisation of every chunk the query touched and throws
   * it away afterwards, which is the work `buildIndex` did once at startup.
   *
   * Absent from the map means the chunk carries none of them. That is the shape
   * a caller wants for a filter, which is what this is for.
   */
  coverage(terms) {
    const n = new Map();
    for (const t of new Set(terms)) {
      const list = this.index.postings.get(t);
      if (!list) continue;
      for (let i = 0; i < list.length; i += 2) {
        const id = this.index.docs[list[i]].id;
        n.set(id, (n.get(id) ?? 0) + 1);
      }
    }
    return n;
  }

  /**
   * @param {{query: string, serviceId?: string, jurisdictionId?: string, dimension?: string, limit?: number, filter?: ((chunk) => boolean) | null}} input
   * @returns {Promise<Array<{id, sourceId, url, heading, text, start, end, score, rank}>>}
   */
  async search({ query, jurisdictionId, dimension, limit = 20, filter: extra = null }) {
    const expanded = [...tokens(query), ...(dimension ? tokens((DIMENSIONS[dimension] ?? []).join(" ")) : [])];
    if (!expanded.length) return [];

    // The state is not a filter. Every Gujarat host answers to IN-GJ, so
    // filtering on it would keep everything.
    const wanted = jurisdictionId && jurisdictionId !== "IN-GJ" ? jurisdictionId : null;
    if (wanted) {
      // A district does two things, and the filter is only one of them. Keeping
      // state hosts is mandatory, because digitalgujarat is where most services
      // actually live and a strict district filter returns four pages and looks
      // like an empty corpus. But that leaves the filter barely excluding
      // anything, so on its own `jurisdictionId` would be a parameter with no
      // measurable effect. The district's own name goes into the query too, and
      // since indexText prepends it to every chunk on that district's host, the
      // district's pages rank above the state's rather than merely surviving.
      expanded.push(...tokens(wanted.replace(/^IN-GJ-?/, "").replace(/_/g, " ")));
    }
    // Composed rather than chained, because both of these have to run inside the
    // scorer for the same reason. A caller's filter applied to the returned top
    // 20 is a filter that reads whatever twenty passages the dimension's own
    // vocabulary happened to match, and keeps the two of them that were on topic.
    const district = wanted ? (c) => districtOf(c.host) === wanted || districtOf(c.host) === "IN-GJ" : null;
    const filter = district && extra ? (c) => district(c) && extra(c) : (district ?? extra);
    return score(this.index, expanded, { limit, filter });
  }
}

/** Read the chunk store, or say plainly that it has not been built. */
export function loadChunks() {
  if (!existsSync(at(CHUNKS))) {
    console.error(`No chunk store at ${CHUNKS}. Run: pnpm corpus:chunk`);
    process.exit(1);
  }
  return readJsonl(CHUNKS);
}

// ------------------------------------------------------------------ selftest

if (isMain && flag("selftest")) {
  const { default: assert } = await import("node:assert/strict");

  const chunk = (id, host, text, heading = null) => ({ id, host, url: `https://${host}/${id}`, heading, text, sourceId: `src:${id}`, start: 0, end: text.length });

  const corpus = [
    chunk("a", "collectorkheda.gujarat.gov.in", "The Mamlatdar office is on the second floor of the Collectorate building, Nadiad."),
    chunk("b", "collectorsurat.gujarat.gov.in", "The Mamlatdar office is on the ground floor of the Collectorate, Surat."),
    chunk("c", "digitalgujarat.gov.in", "The fee for an income certificate is twenty rupees, payable online."),
  ];

  const r = new LexicalRetriever(corpus, { dedupe: false });

  // The whole point of P3, in one assertion: a page can be found by a word that
  // is only in its hostname.
  const kheda = await r.search({ query: "kheda mamlatdar office", limit: 3 });
  assert.equal(kheda[0].id, "a", "the district in the hostname has to be searchable, or district pages are unreachable");

  const fee = await r.search({ query: "income certificate cost", limit: 3 });
  assert.equal(fee[0].id, "c");

  // Expansion adds the vocabulary of the dimension, not an answer to it.
  const office = await r.search({ query: "nadiad", dimension: "OFFICE", limit: 3 });
  assert.equal(office[0].id, "a");
  assert.ok(Object.keys(DIMENSIONS).length === 11, "§8 names eleven dimensions");

  // A filter that runs before the cut, not after it.
  const scoped = await r.search({ query: "mamlatdar office", jurisdictionId: "IN-GJ-SURAT", limit: 5 });
  assert.ok(scoped.every((x) => x.id !== "a"), "a district filter must not return another district's counter");
  assert.equal(scoped[0].id, "b");

  // And a district that ranks, not only one that filters. digitalgujarat is a
  // state host so it survives the filter; it has to lose to Surat's own page.
  const both = await r.search({ query: "office collectorate", jurisdictionId: "IN-GJ-SURAT", limit: 5 });
  assert.equal(both[0].id, "b", "the named district outranks the state portal, or jurisdictionId does nothing");

  // How much of a set of terms each chunk carries, read off the postings. This
  // is what lets a caller anchor before the scorer cuts to twenty rather than
  // after, which is the difference between thirty candidates and two.
  const cov = r.coverage(["mamlatdar", "nadiad"]);
  assert.equal(cov.get("a"), 2, "the Kheda page carries both");
  assert.equal(cov.get("b"), 1, "Surat's has the officer and not the town");
  assert.equal(cov.has("c"), false, "absent means none of them, which is the shape a filter wants");
  assert.equal(r.coverage([]).size, 0);
  assert.equal(r.coverage(["zzznotaword"]).size, 0);

  // A caller's filter runs inside the scorer, beside the jurisdiction one.
  const withoutA = await r.search({ query: "mamlatdar office", limit: 5, filter: (c) => c.id !== "a" });
  assert.equal(withoutA[0].id, "b");
  assert.ok(withoutA.every((x) => x.id !== "a"));
  // And composes with the district filter rather than replacing it.
  assert.deepEqual(
    await r.search({ query: "mamlatdar office", jurisdictionId: "IN-GJ-SURAT", limit: 5, filter: (c) => c.id !== "b" }),
    [],
    "a district filter and a caller filter that disagree leave nothing, and nothing is the correct answer",
  );

  // And the state portal is still reachable, because most services live there.
  const state = await r.search({ query: "income certificate fee", jurisdictionId: "IN-GJ-SURAT", limit: 5 });
  assert.ok(state.some((x) => x.id === "c"), "a district scope must not hide digitalgujarat");

  assert.deepEqual(await r.search({ query: "   " }), [], "an empty query returns nothing, never everything");
  assert.deepEqual(await r.search({ query: "kholvani zzzznotaword" }), [], "a query no chunk contains returns nothing");

  // Retrieval must not become quotation. What comes back is the slice, untouched.
  assert.equal(kheda[0].text, corpus[0].text, "a hit carries the page's own words, never the contextualised ones");
  assert.ok(!kheda[0].text.toLowerCase().includes("kheda"), "the district was matched from the host and did not enter the evidence");

  // Repetition on one host collapses to one copy. Not to none: the fact stays
  // quotable, it just stops being twenty of the top twenty.
  const menu = "Home About Us Contact Us Tenders Notices Photo Gallery";
  const withMenu = [
    ...corpus,
    ...["p1", "p2", "p3", "p4"].map((id) => chunk(id, "collectorkheda.gujarat.gov.in", menu)),
  ];
  const built = buildIndex(withMenu);
  assert.equal(built.skipped.length, 3, "four copies of one menu on one host index once");
  assert.ok(built.docs.some((d) => d.id === "p1"), "the first copy survives, or the fact becomes unreachable");
  assert.equal(buildIndex(withMenu, { dedupe: false }).skipped.length, 0);

  // The same sentence on two hosts is two districts saying it.
  const twoHosts = [
    chunk("x", "collectorkheda.gujarat.gov.in", menu),
    chunk("y", "collectorsurat.gujarat.gov.in", menu),
  ];
  assert.equal(buildIndex(twoHosts).skipped.length, 0, "deduping across hosts would answer a Kheda question with Surat's page");

  assert.deepEqual(tokens("Rs. 20/- ફી"), ["rs", "20", "ફી"], "punctuation splits, Gujarati survives, single letters go");
  // The one that failed first. A vowel sign is a mark, not a letter, so a
  // letters-only class silently minces every Gujarati word on the estate.
  assert.deepEqual(tokens("દસ્તાવેજ"), ["દસ્તાવેજ"], "a Gujarati word is one term, not four fragments");
  assert.deepEqual(tokens(""), []);

  console.log("corpus: ok");
  process.exit(0);
}

// -------------------------------------------------------------------- search
//
// A block rather than an early return, because a module cannot return and an
// early `process.exit` here would take the importer down with it.

if (isMain) {
const started = Date.now();
const chunks = loadChunks();
const index = buildIndex(chunks, { dedupe: !flag("keep-duplicates") });
const built = Date.now() - started;

const query = positional();

if (!query) {
  // `corpus:index`, which is `corpus:search` with nothing to search for.
  //
  // No index file is written. Building it from the committed chunk store takes
  // the time printed below, which is less than reading a serialised index off
  // disk would take, and an index file is a fourth thing that can be stale.
  // When an embedding index arrives in §17 that calculus changes, because
  // vectors cost a model call and these do not.
  const lengths = index.docs.map((_, i) => index.length[i]);
  console.log(`${chunks.length} chunk(s) read, ${index.docs.length} indexed, ${index.skipped.length} dropped as a repeat of one already indexed`);
  console.log(`${index.postings.size} distinct term(s), ${Math.round(index.avgLength)} term(s) per chunk on average`);
  console.log(`built in ${built}ms, in memory, no index file`);

  const bySite = new Map();
  for (const c of index.skipped) bySite.set(c.host, (bySite.get(c.host) ?? 0) + 1);
  const worst = [...bySite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (worst.length) {
    console.log(`\nmost repetitive host(s), by copies collapsed:`);
    for (const [host, n] of worst) console.log(`  ${String(n).padStart(5)}  ${host}`);
  }
  console.log(`\nNow try: pnpm corpus:search "mamlatdar office address kheda"`);
  console.log(`         pnpm corpus:search "income limit" --dimension ELIGIBILITY`);
  process.exit(0);
}

const dimension = value("dimension");
if (dimension && !DIMENSIONS[dimension]) {
  console.error(`Unknown dimension ${dimension}. One of: ${Object.keys(DIMENSIONS).join(", ")}`);
  process.exit(1);
}

const retriever = new LexicalRetriever(null, { index });
const hits = await retriever.search({ query, dimension, jurisdictionId: value("jurisdiction"), limit: Number(value("limit", 10)) });

console.log(`"${query}"${dimension ? ` [${dimension}]` : ""} -> ${hits.length} hit(s), index built in ${built}ms\n`);
for (const h of hits) {
  console.log(`${String(h.rank).padStart(3)}. ${h.score}  ${h.url}`);
  if (h.heading) console.log(`     under: ${h.heading}`);
  console.log(`     ${h.text.replace(/\s+/g, " ").trim().slice(0, 220)}`);
  console.log();
}
}
