/**
 * Thirty passages a search liked, down to the handful worth extracting from.
 *
 *   pnpm evidence:rerank                    every retrieval not yet judged
 *   pnpm evidence:rerank --limit 20
 *   pnpm evidence:rerank --service udyam_registration
 *   pnpm evidence:rerank --dry              what it would cost, no model calls
 *   pnpm evidence:rerank --stats            what is already judged
 *
 * §13. The first model call in the depth pipeline, and it is deliberately the
 * cheapest possible one: the model is not asked what the fee is, or whether the
 * page is trustworthy, or to summarise anything. It is asked which of these
 * numbered passages are about the thing we are looking for, and it answers with
 * numbers. Nothing it says reaches the graph. Nothing it says is a government
 * fact. The worst a bad rerank can do is waste P8's time on a passage the
 * substring gate then finds nothing in.
 *
 * Which is the point of doing it at all. BM25 got Udyam Registration's HELPLINE
 * shortlist down to one candidate and that candidate is a VOTER HELPLINE number
 * from a Mehsana collector page. Lexical scoring cannot tell that apart from a
 * real helpline; a model reading two lines can, in one cheap call, and the tier
 * ordering in §27 puts exactly this call at rung five.
 *
 * Cached on the passages themselves, so re-running is free and a retrieval pass
 * that returns the same shortlist never pays twice. §27: restarting a process
 * must not trigger model work.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { at, chat, INGEST, jsonArray, MODELS, pool, readJsonl, RESEARCH, sha256, writeJsonl } from "./lib.mjs";
import { loadChunks } from "./corpus.mjs";
import { EVIDENCE } from "./services-deepen.mjs";

const CACHE = INGEST + "rerank/";
export const RERANKED = INGEST + "reranked.jsonl";
export const RERANK_SUMMARY = `${RESEARCH}/rerank.json`;

/** Bump to re-judge everything. Same contract as the extraction cache key. */
const PROMPT_VERSION = 3;

/** §13 says five to eight. Eight, because P8 drops what it cannot ground anyway. */
const KEEP = 8;
/** Below this a passage is about something else, and P8 should not read it. */
const FLOOR = 2;

/**
 * How much of a passage the model sees.
 *
 * Enough to tell what it is about, not enough to answer from. A reranker that
 * has read the whole fee table is a reranker being tempted to tell us the fee,
 * and this one is never allowed to say anything but a number. It also keeps
 * thirty passages inside one cheap call instead of three expensive ones.
 *
 * Truncation is for the prompt only. The candidate keeps its offsets, P8 reads
 * the full chunk, and the citizen sees the original source text. Provenance is
 * not what gets shortened here.
 */
const PREVIEW = 400;

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

/** What the model was actually shown, which is what the answer is cached against. */
export const cacheKey = (row, model) =>
  sha256([row.serviceId, row.dimension, PROMPT_VERSION, model, ...row.candidates.map((c) => c.id)].join("|"));

const SYSTEM = [
  "You rank passages. You are not answering a question about government services.",
  "",
  "DO NOT answer the government question.",
  "DO NOT invent facts.",
  "DO NOT summarise, explain, translate or correct any passage.",
  "RETURN passage IDs and relevance scores only.",
  "",
  "Relevance:",
  "  3  this passage states the requested information for the named service",
  "  2  this passage is about the named service and this topic, but states less than a full answer",
  "  1  the named service is mentioned, but the passage is about something else",
  "  0  a different service, a different topic, or navigation and boilerplate",
  "",
  "Score 0 if the passage is about a different state or a different government.",
  "A rule from Madhya Pradesh is not a weaker answer for a Gujarat service. It is a wrong one.",
  "",
  "The most common trap in this corpus: a scholarship, pension or subsidy page that lists the named service among the documents you must attach.",
  "That page is about the scholarship. Its steps are the scholarship's steps and its income limit is the scholarship's income limit.",
  "Score it 1. Score it 3 only for the rare sentence on it that states something about the named service itself, such as who issues it.",
  "",
  'Reply with a JSON array and nothing else: [{"id":1,"relevance":3},{"id":2,"relevance":0}]',
  "Every passage you were given gets exactly one entry. Invent no IDs.",
].join("\n");

/** What we want, in the citizen's words rather than the schema's. */
const ASKING = {
  DOCUMENTS: "which documents an applicant must bring or attach",
  ELIGIBILITY: "who is eligible, and the conditions or limits they must meet",
  ACTIONS: "the steps to apply, in order",
  OFFICE: "the office to visit, and its address",
  FEES: "the fee a citizen pays, and how it is paid",
  TRACKING: "how to check the status of a submitted application",
  OUTPUT: "what the applicant receives at the end, and how they receive it",
  HELPLINE: "a phone number or email a citizen can contact for help",
  ESCALATION: "where to complain or appeal if the application is refused or delayed",
  ISSUING_AUTHORITY: "which authority or officer issues or signs it",
  VERIFICATION: "what verification, inspection or enquiry happens before it is granted",
  APPLICATION_CHANNEL: "where to apply: the portal, app, or counter",
};

/**
 * The jurisdiction, in words rather than as a code.
 *
 * Added after the first live run ranked a Madhya Pradesh scholarship portal 3
 * out of 3 for a Gujarat scheme, and a Delhi scheme 2. Both passages genuinely
 * describe how to apply for a scholarship, both are verbatim on a real
 * government page, and both would sail through the substring gate, because the
 * gate proves a quote was published and cannot prove it was published for you.
 * The model was never told which state it was working for. Now it is.
 */
export const where = (jurisdictionId) => {
  if (!jurisdictionId || jurisdictionId === "IN") return "India";
  const district = /^IN-GJ-(.+)$/.exec(jurisdictionId)?.[1];
  if (jurisdictionId === "IN-GJ") return "Gujarat";
  if (!district) return jurisdictionId;
  return `${district.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} district, Gujarat`;
};

/** One line per passage, numbered from 1 because a model counts like a person. */
export function prompt(row, texts) {
  const asking = ASKING[row.dimension] ?? row.dimension.toLowerCase().replace(/_/g, " ");
  const lines = row.candidates.map((c, i) => {
    const text = (texts.get(c.id) ?? "").replace(/\s+/g, " ").trim().slice(0, PREVIEW);
    return `[${i + 1}] ${c.heading ? `(${c.heading.replace(/\s+/g, " ").trim().slice(0, 90)}) ` : ""}${text}`;
  });
  return [
    `Service: ${row.name}`,
    `Jurisdiction: ${where(row.jurisdictionId)}. A passage about anywhere else scores 0.`,
    `Looking for: ${asking}.`,
    "",
    `${lines.length} passage(s):`,
    ...lines,
  ].join("\n");
}

/**
 * The model's answer, mapped back onto chunk ids and made safe.
 *
 * A reranker that hallucinates id 47 out of thirty passages gets that entry
 * dropped rather than the whole call thrown away, because the other twenty nine
 * answers are still worth having. Out of range scores are clamped. A duplicate
 * id keeps the first mention. Nothing here trusts the model with anything except
 * an ordering.
 */
export function parse(reply, row) {
  const parsed = reply && jsonArray(reply);
  if (!parsed) return null;
  const seen = new Set();
  const out = [];
  for (const entry of parsed) {
    const i = Number(entry?.id);
    if (!Number.isInteger(i) || i < 1 || i > row.candidates.length || seen.has(i)) continue;
    seen.add(i);
    const relevance = Math.max(0, Math.min(3, Math.round(Number(entry?.relevance) || 0)));
    out.push({ ...row.candidates[i - 1], relevance });
  }
  return out.length ? out : null;
}

/**
 * One shortlist, judged.
 *
 * `ask` is injectable so the selftest can run the whole path without a network,
 * and so a caller can swap the tier. Everything else is deterministic.
 *
 * When the model is unreachable or answers with nothing usable, the row is still
 * written, keeping the top eight in retrieval order and saying so in `rankedBy`.
 * A silent fallback that looks like a rerank is how an unreviewed BM25 shortlist
 * ends up described as reranked in a coverage report.
 */
/**
 * What the cache is not allowed to remember.
 *
 * A verdict is the model's opinion of a passage: `relevance`, and nothing else.
 * Everything else on a kept candidate belongs to the retrieval pass -- its BM25
 * score, which query found it, and `topical`, which says whether the passage is
 * on a page this service lives on. Storing those alongside the verdict freezes
 * them at the moment the model was asked.
 *
 * That cost a real regression. The retrieval pass learned that
 * parivahan.gov.in/en/content/faq is the driving licence's own host, so the FAQ
 * went from topical 0 to 1. The candidate ids did not change, so the cache key
 * did not change, so the extractor kept being handed a two week old 0 and kept
 * rejecting five genuine driving licence steps as somebody else's facts. The
 * verdict was right, the metadata travelling with it was stale, and the cache
 * had no way to know the difference.
 *
 * So a cached verdict is re-joined to today's shortlist by id, and only the
 * relevance survives the trip. Bumping PROMPT_VERSION re-asks the model; nothing
 * should have to re-ask it to learn a fact the search already knew.
 */
function freshen(cached, row) {
  const now = new Map((row.candidates ?? []).map((c) => [c.id, c]));
  const rejoin = (c) => ({ ...c, ...(now.get(c.id) ?? {}), relevance: c.relevance });
  return {
    jurisdictionId: row.jurisdictionId ?? null,
    name: row.name,
    keep: (cached.keep ?? []).map(rejoin),
    rejected: cached.rejected ?? [],
  };
}

export async function rerankOne(row, texts, { ask = chat, model = MODELS.tier1 } = {}) {
  const cached = readCache(cacheKey(row, model));
  if (cached) return { ...cached, ...freshen(cached, row), cached: true };

  const reply = await ask([
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt(row, texts) },
  ], { model, maxTokens: 1200 });

  const judged = parse(reply?.text ?? null, row);
  const result = judged
    ? {
        serviceId: row.serviceId,
        dimension: row.dimension,
        pass: row.pass,
        name: row.name,
        jurisdictionId: row.jurisdictionId ?? null,
        model,
        promptVersion: PROMPT_VERSION,
        rankedBy: "MODEL",
        considered: row.candidates.length,
        // Sorted by what the model thought, then by what the search thought,
        // which is the only thing the search is still trusted with here.
        keep: judged
          .filter((c) => c.relevance >= FLOOR)
          .sort((a, b) => b.relevance - a.relevance || b.topical - a.topical || b.score - a.score)
          .slice(0, KEEP),
        rejected: judged.filter((c) => c.relevance < FLOOR).map((c) => ({ id: c.id, url: c.url, relevance: c.relevance })),
      }
    : {
        serviceId: row.serviceId,
        dimension: row.dimension,
        pass: row.pass,
        name: row.name,
        jurisdictionId: row.jurisdictionId ?? null,
        model,
        promptVersion: PROMPT_VERSION,
        rankedBy: "RETRIEVAL_ORDER",
        considered: row.candidates.length,
        keep: row.candidates.slice(0, KEEP).map((c) => ({ ...c, relevance: null })),
        rejected: [],
      };

  // Cached even when the model was unreachable would be wrong: the next run
  // should try again rather than inherit an outage as a verdict.
  if (result.rankedBy === "MODEL") writeCache(cacheKey(row, model), result);
  return { ...result, cached: false };
}

function readCache(key) {
  const file = at(CACHE + key + ".json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(key, result) {
  mkdirSync(at(CACHE), { recursive: true });
  writeFileSync(at(CACHE + key + ".json"), JSON.stringify(result, null, 2) + "\n");
}

// ------------------------------------------------------------------ selftest

if (isMain && flag("selftest")) {
  const { default: assert } = await import("node:assert/strict");

  const row = {
    serviceId: "service:varsai_certificate",
    dimension: "FEES",
    pass: 1,
    name: "Varsai Certificate",
    jurisdictionId: "IN-GJ",
    candidates: [
      { id: "chunk:a_0", url: "https://a.gov.in/x", heading: "Fees", score: 20, topical: 2 },
      { id: "chunk:b_0", url: "https://b.gov.in/y", heading: "Voter Helpline", score: 30, topical: 0 },
      { id: "chunk:c_0", url: "https://c.gov.in/z", heading: null, score: 10, topical: 1 },
    ],
  };
  const texts = new Map([
    ["chunk:a_0", "The fee for a Varsai Certificate is Rs. 20/- payable at the counter."],
    ["chunk:b_0", "VOTER HELPLINE 1950 for electoral roll queries."],
    ["chunk:c_0", "Varsai Certificate is issued by the Mamlatdar."],
  ]);

  const p = prompt(row, texts);
  assert.ok(p.includes("[1] (Fees) The fee for a Varsai Certificate"), "numbered from one, heading kept, whitespace flattened");
  assert.ok(p.includes("[3] Varsai Certificate is issued"), "a passage with no heading is still a passage");
  assert.ok(p.includes("the fee a citizen pays"), "the dimension asked in words a model can act on");
  assert.ok(p.includes("Jurisdiction: Gujarat."), "which state this is for, because the substring gate cannot check that");
  assert.equal(where("IN-GJ-KHEDA"), "Kheda district, Gujarat");
  assert.equal(where("IN"), "India");
  assert.equal(where(null), "India");
  assert.ok(!p.includes("chunk:"), "chunk ids never reach the model, so it cannot invent one that looks real");

  // The model answers with numbers and the numbers come back as chunks.
  const judged = parse('[{"id":1,"relevance":3},{"id":2,"relevance":0},{"id":3,"relevance":2}]', row);
  assert.equal(judged.length, 3);
  assert.equal(judged[0].id, "chunk:a_0");
  assert.equal(judged[0].relevance, 3);

  // Nothing it says is trusted beyond an ordering.
  const messy = parse('Sure! ```json\n[{"id":47,"relevance":3},{"id":1,"relevance":9},{"id":1,"relevance":0},{"id":"x"}]\n```', row);
  assert.equal(messy.length, 1, "an id it made up is dropped, and a repeat keeps the first");
  assert.equal(messy[0].relevance, 3, "9 is not a relevance, and 3 is the nearest thing it can mean");
  assert.equal(parse("I cannot help with that.", row), null);
  assert.equal(parse(null, row), null);

  const ok = await rerankOne(row, texts, { ask: async () => ({ text: '[{"id":1,"relevance":3},{"id":2,"relevance":0},{"id":3,"relevance":2}]' }), model: "test-model" });
  assert.equal(ok.rankedBy, "MODEL");
  assert.deepEqual(ok.keep.map((c) => c.id), ["chunk:a_0", "chunk:c_0"], "the fee first, the helpline gone");
  assert.equal(ok.rejected[0].id, "chunk:b_0", "and the one it cut is named, not just subtracted");
  assert.equal(ok.keep.length + ok.rejected.length, 3, "every passage is accounted for");

  const second = await rerankOne(row, texts, { ask: async () => { throw new Error("must not be called"); }, model: "test-model" });
  assert.equal(second.cached, true, "§27: restarting must not trigger model work");
  assert.deepEqual(second.keep.map((c) => c.id), ["chunk:a_0", "chunk:c_0"]);
  assert.equal(ok.jurisdictionId, "IN-GJ");
  assert.equal(second.jurisdictionId, "IN-GJ", "and a cached verdict still says which state it was about");

  // The retrieval pass learns something new about a passage the model already
  // judged. The judgement stands; the stale metadata does not.
  const relearned = await rerankOne(
    { ...row, candidates: row.candidates.map((c) => (c.id === "chunk:a_0" ? { ...c, topical: 3, score: 99 } : c)) },
    texts,
    { ask: async () => { throw new Error("must not be called"); }, model: "test-model" },
  );
  assert.equal(relearned.cached, true, "a better score is not a reason to pay for the same verdict again");
  assert.equal(relearned.keep[0].topical, 3, "and the extractor downstream sees what the search knows today");
  assert.equal(relearned.keep[0].score, 99);
  assert.equal(relearned.keep[0].relevance, 3, "while the one thing the model actually said survives untouched");

  // An outage is not a verdict.
  const down = await rerankOne({ ...row, serviceId: "service:nocache" }, texts, { ask: async () => null, model: "test-model" });
  assert.equal(down.rankedBy, "RETRIEVAL_ORDER");
  assert.equal(down.keep.length, 3, "unjudged, so the shortlist stands as the search left it");
  assert.equal(down.keep[0].relevance, null, "and it does not pretend to a score");
  assert.equal(readCache(cacheKey({ ...row, serviceId: "service:nocache" }, "test-model")), null, "so the next run tries again");

  assert.notEqual(cacheKey(row, "a"), cacheKey(row, "b"), "a different model is a different answer");
  assert.notEqual(cacheKey(row, "a"), cacheKey({ ...row, candidates: row.candidates.slice(1) }, "a"), "different passages, different question");

  // The cache round trip is the point of two of those assertions, so it writes
  // a real file. It does not get to leave one behind.
  const { rmSync } = await import("node:fs");
  rmSync(at(CACHE + cacheKey(row, "test-model") + ".json"), { force: true });

  console.log("rerank: ok");
  process.exit(0);
}

// ---------------------------------------------------------------------- run

if (isMain) {
  const ledger = readJsonl(EVIDENCE).filter((r) => r.status === "RETRIEVED");
  if (!ledger.length) {
    console.log(`Nothing retrieved yet. Run: pnpm services:deepen --limit 20`);
    process.exit(0);
  }

  const one = value("service");
  const only = value("dimension");
  let rows = ledger.filter((r) => (!one || r.serviceId === one || r.serviceId === `service:${one}`) && (!only || r.dimension === only));
  rows = rows.slice(0, Number(value("limit", rows.length)));

  if (flag("stats")) {
    report(readJsonl(RERANKED));
    process.exit(0);
  }

  const model = value("model", MODELS.tier1);
  const pending = rows.filter((r) => !readCache(cacheKey(r, model)));
  console.log(`${rows.length} shortlist(s), ${rows.length - pending.length} already judged, ${pending.length} to send.`);
  if (flag("dry")) {
    console.log(`${pending.reduce((n, r) => n + r.candidates.length, 0)} passage(s) would be shown to ${model}. Nothing sent.`);
    process.exit(0);
  }

  const texts = new Map(loadChunks().map((c) => [c.id, c.text]));
  // Eight at a time. This was a plain for-loop and the arithmetic caught up
  // with it: 3,882 shortlists at three and a half seconds each is under four
  // hours of one laptop waiting on one socket. Bedrock is happy to answer eight
  // of these at once and `pool` has been in lib.mjs since the fetcher needed it.
  // Not higher, because a rate limit read as a failed judgement is a shortlist
  // silently thrown away, and this is a model call per unit of work, not a
  // government server we would be rude to.
  let done = 0;
  const out = await pool(rows, 8, async (row) => {
    const result = await rerankOne(row, texts, { model });
    done++;
    if (!result.cached) process.stdout.write(`\r  ${done}/${rows.length}  ${row.serviceId.slice(8, 40)} ${row.dimension}`.padEnd(78));
    return result;
  });
  process.stdout.write("\r".padEnd(80) + "\r");

  // Rebuilt rather than appended: the per-call cache is the durable thing, and
  // this file is a view of it, so a re-run with a bumped PROMPT_VERSION does not
  // leave two generations of verdicts interleaved in one ledger.
  const merged = [...readJsonl(RERANKED).filter((r) => !out.some((n) => n.serviceId === r.serviceId && n.dimension === r.dimension && n.pass === r.pass)), ...out];
  writeJsonl(RERANKED, merged);
  report(merged, { write: true });
}

/** What survived, and what it cut. */
function report(rows, { write = false } = {}) {
  if (!rows.length) {
    console.log(`Nothing judged yet. Run: pnpm evidence:rerank --limit 20`);
    return;
  }
  const judged = rows.filter((r) => r.rankedBy === "MODEL");
  const kept = rows.reduce((n, r) => n + r.keep.length, 0);
  const considered = rows.reduce((n, r) => n + r.considered, 0);
  const answered = rows.filter((r) => r.keep.some((c) => c.relevance === 3));

  const byDimension = new Map();
  for (const r of rows) {
    const d = byDimension.get(r.dimension) ?? { rows: 0, kept: 0, considered: 0, answered: 0 };
    d.rows++;
    d.kept += r.keep.length;
    d.considered += r.considered;
    if (r.keep.some((c) => c.relevance === 3)) d.answered++;
    byDimension.set(r.dimension, d);
  }
  const width = Math.max(...[...byDimension.keys()].map((k) => k.length));

  console.log(`\n${rows.length} shortlist(s) judged, ${considered} passage(s) in, ${kept} out\n`);
  for (const [d, s] of [...byDimension.entries()].sort((a, b) => b[1].answered - a[1].answered)) {
    console.log(`  ${d.padEnd(width)}  ${String(s.answered).padStart(4)} of ${String(s.rows).padEnd(4)} look answerable   ${String(s.considered).padStart(5)} -> ${String(s.kept).padEnd(5)}`);
  }

  console.log(`\n  ${answered.length} shortlist(s) hold a passage the model thinks states the answer outright`);
  console.log(`  ${considered - kept} passage(s) cut, which is ${Math.round(((considered - kept) / (considered || 1)) * 100)}% of what the search returned`);
  if (rows.length - judged.length) console.log(`  ${rows.length - judged.length} left in retrieval order because the model was unreachable, and marked as such`);
  console.log(`\n  Still nothing believed. A ranked passage is a passage worth reading, and P8 is what reads it.`);

  if (write) {
    writeFileSync(
      RERANK_SUMMARY,
      JSON.stringify(
        {
          generatedBy: "pnpm evidence:rerank",
          shortlists: rows.length,
          modelRanked: judged.length,
          considered,
          kept,
          answerable: answered.length,
          byDimension: Object.fromEntries(byDimension),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`\n  ${RERANK_SUMMARY} written`);
  }
}
