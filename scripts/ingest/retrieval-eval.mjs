/**
 * How good is retrieval, in numbers, so §17 can let embeddings in or keep them out.
 *
 *   pnpm retrieval:eval                  score the lexical retriever
 *   pnpm retrieval:eval --cases 200      more cases, same sampling order
 *   pnpm retrieval:eval --dimension FEES only that dimension
 *   pnpm retrieval:eval --misses         print the cases that failed
 *
 * §25 says do not judge retrieval by vibes, and §16 of the plan says every new
 * piece of complexity has to win an eval before it stays. That needs a scored
 * dataset, and the honest problem with building one is that nobody is going to
 * hand label a thousand government passages this week.
 *
 * We do not have to. The enrichment pass already did the labelling, expensively
 * and under a stricter rule than a human annotator would have used: a model read
 * a passage, answered a dimension question from it, quoted the passage, and the
 * quote had to survive the verbatim substring gate before the claim was kept.
 * Every row in `claims.jsonl` is therefore a triple of (service, dimension) ->
 * a chunk that provably contains the answer. That is a relevance judgement, and
 * it cost model calls that have already been spent.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT.
 *
 * The labelled chunks were found by this same lexical retriever, so it cannot
 * be scored on passages it has never shown anyone. This is a RANKING eval, not
 * an absolute recall eval: given that an answer is in the corpus and reachable,
 * how near the top does it come? That is the number that matters operationally,
 * because the reranker only ever sees the top 30, so an answer at rank 45 is an
 * answer nobody will read.
 *
 * `answer@k` is the fairer of the two metrics and the one to compare a future
 * semantic retriever on. It asks whether ANY chunk in the top k contains the
 * verbatim answer text, not whether the one specific chunk we labelled came
 * back. Government estates repeat themselves constantly, the same fee table
 * lives on four pages, and a retriever that finds a different page carrying the
 * same sentence has done its job. `recall@k` is the strict version, kept
 * because a drop in it while `answer@k` holds means the ranking got luckier
 * rather than better.
 *
 * The queries are not the ones that produced the labels. They are regenerated
 * from today's graph, and the depth pass has since added the offices and
 * departments that `neighbours()` builds template 4 out of, so template 4 asks
 * something different now than it did when these chunks were retrieved.
 */
import { fileURLToPath } from "node:url";
import { loadChunks, LexicalRetriever, buildIndex } from "./corpus.mjs";
import { loadGraph, measureServiceCompleteness } from "./completeness.mjs";
import { CLAIMS } from "./enrich.mjs";
import { norm } from "./gate.mjs";
import { readJsonl, sha1 } from "./lib.mjs";
import { retrieveOne } from "./services-deepen.mjs";

const isMain = fileURLToPath(import.meta.url) === process.argv[1];
const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** The cut-offs §25 asks for. 30 is here because it is what the reranker is handed. */
export const CUTOFFS = [5, 10, 20, 30];

/** §25 says 50 to 100. 80 leaves room to stratify across ten dimensions. */
const DEFAULT_CASES = 80;

/**
 * One (service, dimension) question, and every chunk known to answer it.
 *
 * Grouped rather than one case per claim, because a service with eleven
 * eligibility claims off one page is one retrieval question that was answered
 * once, and counting it eleven times would let the easiest pages set the score.
 */
export function buildCases(claims) {
  const cases = new Map();
  for (const c of claims) {
    if (!c.chunkId || !c.evidence) continue;
    const key = `${c.serviceId}|${c.dimension}`;
    const found = cases.get(key) ?? { serviceId: c.serviceId, dimension: c.dimension, chunks: new Set(), answers: [] };
    found.chunks.add(c.chunkId);
    // Longest wins. A short quote like a phone number turns up inside pages
    // that have nothing to do with this service, and `answer@k` would score a
    // hit on a page that never mentioned it. The longest verbatim span the
    // extractor kept is the one least likely to appear somewhere by accident.
    found.answers.push(c.evidence);
    cases.set(key, found);
  }
  return [...cases.values()].map((c) => ({
    ...c,
    chunks: [...c.chunks],
    answers: [...new Set(c.answers)].sort((a, b) => b.length - a.length).slice(0, 3),
  }));
}

/**
 * A stable sample, stratified across dimensions.
 *
 * Deterministic on purpose: `Math.random` would mean the number moved when the
 * sample moved and nobody could tell which. Sorting on a hash of the key is a
 * shuffle that is the same shuffle every time, and taking round robin across
 * dimensions stops FEES, which has a handful of cases, from being crowded out
 * by ELIGIBILITY, which has hundreds.
 */
export function sample(cases, limit) {
  const byDimension = new Map();
  for (const c of [...cases].sort((a, b) => sha1(`${a.serviceId}|${a.dimension}`).localeCompare(sha1(`${b.serviceId}|${b.dimension}`)))) {
    const list = byDimension.get(c.dimension) ?? [];
    list.push(c);
    byDimension.set(c.dimension, list);
  }

  const out = [];
  const lists = [...byDimension.values()];
  for (let round = 0; out.length < limit; round++) {
    let took = 0;
    for (const list of lists) {
      if (round >= list.length) continue;
      if (out.length >= limit) break;
      out.push(list[round]);
      took++;
    }
    if (!took) break;
  }
  return out;
}

/** 1-based rank of the first relevant chunk, or 0 if it never came back. */
export const firstRelevant = (candidates, relevant) => {
  const wanted = new Set(relevant);
  const i = candidates.findIndex((c) => wanted.has(c.id));
  return i < 0 ? 0 : i + 1;
};

/**
 * 1-based rank of the first candidate whose text carries one of the answers.
 *
 * Normalised the same way the substring gate normalises, because that is the
 * comparison the pipeline already trusts and a second opinion about whitespace
 * is a second bug.
 */
export function firstAnswer(candidates, answers, textOf) {
  const wanted = answers.map(norm).filter((a) => a.length >= 12);
  if (!wanted.length) return 0;
  for (let i = 0; i < candidates.length; i++) {
    const text = norm(textOf(candidates[i].id) ?? "");
    if (text && wanted.some((a) => text.includes(a))) return i + 1;
  }
  return 0;
}

/** A rank of 0 means never found, which is not the same as found late. */
export const hitAt = (rank, k) => rank > 0 && rank <= k;

/** Mean reciprocal rank. The single number that notices rank 2 beating rank 9. */
export const mrr = (ranks) => ranks.reduce((sum, r) => sum + (r > 0 ? 1 / r : 0), 0) / (ranks.length || 1);

/** Percentages for one column of results. */
export function summarise(rows, pick) {
  const ranks = rows.map(pick);
  const out = { cases: rows.length, mrr: Number(mrr(ranks).toFixed(3)) };
  for (const k of CUTOFFS) out[`@${k}`] = Math.round((ranks.filter((r) => hitAt(r, k)).length / (ranks.length || 1)) * 100);
  return out;
}

/**
 * Score one retriever over the sampled cases.
 *
 * Runs the real `retrieveOne`, not a reimplementation of it. An eval that
 * measures a parallel copy of the retrieval path measures the copy.
 */
export async function evaluate(cases, { retriever, graph, textOf }) {
  const rows = [];
  for (const c of cases) {
    const m = measureServiceCompleteness(c.serviceId, graph);
    if (!m) continue;
    // Ask for this dimension whether or not the service still counts as missing
    // it. It does not, usually: the claim we are scoring against is why.
    const result = await retrieveOne({ ...m, retrievable: [c.dimension] }, c.dimension, { retriever, graph });
    rows.push({
      serviceId: c.serviceId,
      dimension: c.dimension,
      name: m.name,
      anchorMode: result.anchorMode,
      returned: result.candidates.length,
      recall: firstRelevant(result.candidates, c.chunks),
      answer: firstAnswer(result.candidates, c.answers, textOf),
    });
  }
  return rows;
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

function table(title, rows, pick) {
  const s = summarise(rows, pick);
  console.log(`\n  ${title}`);
  console.log(`    ${CUTOFFS.map((k) => num(`@${k}`, 6)).join("")}${num("mrr", 8)}`);
  console.log(`    ${CUTOFFS.map((k) => num(`${s[`@${k}`]}%`, 6)).join("")}${num(s.mrr, 8)}`);
  return s;
}

// ------------------------------------------------------------------ selftest

if (isMain && flag("selftest")) {
  const { default: assert } = await import("node:assert/strict");

  const claims = [
    { serviceId: "service:a", dimension: "FEES", chunkId: "chunk:1", evidence: "The fee is twenty rupees." },
    { serviceId: "service:a", dimension: "FEES", chunkId: "chunk:2", evidence: "The fee is twenty rupees payable online at the counter." },
    { serviceId: "service:a", dimension: "OFFICE", chunkId: "chunk:3", evidence: "Second floor of the Collectorate." },
    { serviceId: "service:b", dimension: "FEES", chunkId: "chunk:4", evidence: "No fee is charged for this service." },
    { serviceId: "service:c", dimension: "FEES", chunkId: null, evidence: "orphan" },
  ];

  const cases = buildCases(claims);
  assert.equal(cases.length, 3, "one case per service and dimension, not one per claim");
  const fees = cases.find((c) => c.serviceId === "service:a" && c.dimension === "FEES");
  assert.deepEqual(fees.chunks.sort(), ["chunk:1", "chunk:2"], "both chunks answer the same question");
  assert.equal(fees.answers[0], "The fee is twenty rupees payable online at the counter.", "longest answer first, it is the hardest to hit by accident");
  assert.ok(!cases.some((c) => c.serviceId === "service:c"), "a claim with no chunk cannot be a retrieval judgement");

  // Stratification: FEES has 2 cases and OFFICE has 1, so a sample of 2 must
  // not be two FEES cases.
  assert.deepEqual(
    [...new Set(sample(cases, 2).map((c) => c.dimension))].sort(),
    ["FEES", "OFFICE"],
    "round robin across dimensions, so a rare dimension is never crowded out",
  );
  assert.equal(sample(cases, 99).length, 3, "asking for more cases than exist is not an error");
  assert.deepEqual(sample(cases, 2), sample(cases, 2), "the same sample every run, or the number moved and nobody knows why");

  const candidates = [{ id: "chunk:9" }, { id: "chunk:2" }, { id: "chunk:1" }];
  assert.equal(firstRelevant(candidates, ["chunk:1", "chunk:2"]), 2, "the first relevant one, not the best one");
  assert.equal(firstRelevant(candidates, ["chunk:7"]), 0, "never found is rank zero");

  const texts = new Map([
    ["chunk:9", "Something else entirely about tractors."],
    ["chunk:2", "Notice:  the   FEE is TWENTY rupees.  "],
    ["chunk:1", "The fee is twenty rupees."],
  ]);
  const textOf = (id) => texts.get(id);
  assert.equal(
    firstAnswer(candidates, ["The fee is twenty rupees."], textOf),
    2,
    "normalised the way the gate normalises, so casing and spacing are not a miss",
  );
  assert.equal(firstAnswer(candidates, ["a fee"], textOf), 0, "under twelve characters is not evidence, same rule as the gate");
  assert.equal(firstAnswer([{ id: "chunk:404" }], ["The fee is twenty rupees."], textOf), 0, "a chunk with no text cannot answer");

  assert.equal(hitAt(0, 30), false, "rank zero is a miss at every cutoff");
  assert.equal(hitAt(30, 30), true, "the cutoff is inclusive");
  assert.equal(hitAt(31, 30), false);
  assert.equal(mrr([1, 2, 0]), (1 + 0.5 + 0) / 3, "a miss contributes nothing rather than dividing by zero");
  assert.equal(mrr([]), 0, "no cases is zero, not NaN");

  const summary = summarise([{ r: 1 }, { r: 7 }, { r: 0 }, { r: 25 }], (x) => x.r);
  assert.equal(summary["@5"], 25, "one of four inside five");
  assert.equal(summary["@10"], 50);
  assert.equal(summary["@30"], 75, "the one that was never found stays a miss no matter how wide the cutoff");

  console.log("retrieval-eval selftest ok");
  process.exit(0);
}

// ---------------------------------------------------------------------- main

if (isMain) {
  const claims = readJsonl(CLAIMS);
  if (!claims.length) {
    console.error(`No claims at ${CLAIMS}. Run: pnpm services:enrich`);
    process.exit(1);
  }

  const only = value("dimension");
  const all = buildCases(claims).filter((c) => !only || c.dimension === only);
  const cases = sample(all, Number(value("cases", DEFAULT_CASES)));

  console.log(`\nRetrieval eval: ${cases.length} case(s) sampled from ${all.length}, labelled by ${claims.length} verified claims.`);

  const chunks = loadChunks();
  const textOf = ((map) => (id) => map.get(id))(new Map(chunks.map((c) => [c.id, c.text])));
  const graph = loadGraph();
  const retriever = new LexicalRetriever(null, { index: buildIndex(chunks, { dedupe: false }) });

  const rows = await evaluate(cases, { retriever, graph, textOf });

  table("answer@k, any top-k chunk carries the verbatim answer", rows, (r) => r.answer);
  table("recall@k, the specific labelled chunk came back", rows, (r) => r.recall);

  console.log("\n  by dimension, answer@k");
  console.log(`    ${pad("dimension", 22)}${num("cases", 6)}${CUTOFFS.map((k) => num(`@${k}`, 6)).join("")}`);
  const dimensions = [...new Set(rows.map((r) => r.dimension))].sort();
  for (const d of dimensions) {
    const s = summarise(rows.filter((r) => r.dimension === d), (r) => r.answer);
    console.log(`    ${pad(d.toLowerCase(), 22)}${num(s.cases, 6)}${CUTOFFS.map((k) => num(`${s[`@${k}`]}%`, 6)).join("")}`);
  }

  // The anchor tier is the one knob in `retrieveOne` that changes what is even
  // eligible to rank, so a score that is really an anchoring score should say so.
  console.log("\n  by anchor tier");
  for (const mode of ["ALL", "ANY", "NONE", "UNANCHORED"]) {
    const subset = rows.filter((r) => r.anchorMode === mode);
    if (!subset.length) continue;
    const s = summarise(subset, (r) => r.answer);
    console.log(`    ${pad(mode.toLowerCase(), 22)}${num(s.cases, 6)}${CUTOFFS.map((k) => num(`${s[`@${k}`]}%`, 6)).join("")}`);
  }

  const missed = rows.filter((r) => !r.answer);
  console.log(`\n  ${missed.length} case(s) where no chunk in the top 30 carried the answer.`);
  if (flag("misses")) {
    for (const r of missed) console.log(`    ${pad(r.dimension.toLowerCase(), 16)}${pad(r.anchorMode.toLowerCase(), 12)}${r.returned} returned  ${r.name.slice(0, 46)}`);
  } else if (missed.length) {
    console.log("  Run with --misses to read them.");
  }

  console.log("\n  Labels come from claims this same lexical retriever surfaced, so this");
  console.log("  scores ranking and not absolute recall. It is the floor a semantic or");
  console.log("  hybrid retriever has to beat on answer@k before §17 lets it in.\n");
}
