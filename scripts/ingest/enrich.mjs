/**
 * Read the passages that survived, and say what they state.
 *
 *   pnpm services:enrich                    every reranked shortlist not yet read
 *   pnpm services:enrich --limit 20
 *   pnpm services:enrich --service udyam_registration
 *   pnpm services:enrich --dry              what it would cost, no model calls
 *   pnpm services:enrich --stats            what is already on disk
 *
 * §14. The second extraction pass, and the only one that knows what it is
 * looking for. `services:extract` reads a whole page cold and asks what a
 * citizen needs; this reads eight passages a search found and a reranker kept,
 * for one named service and one named missing dimension, and asks a much
 * narrower question. Narrower questions are why this exists: the first pass
 * left 425 of 553 services at one step, not because the facts were absent from
 * the estate but because nobody ever went looking for a specific one.
 *
 * What does not change, and §36 is unambiguous about it:
 *
 *   VERBATIM SUBSTRING GATE. No exception.
 *
 * Every claim goes through `grounded()` against the chunk text, which is a
 * slice of a page whose bytes are on disk. A claim that fails is not corrected,
 * not softened and not retried. It is written to the rejection ledger with the
 * model's own words attached, per §5, so the number of things this gate throws
 * away is a number somebody can read rather than a number somebody trusts.
 *
 * Nothing here writes to the graph. A claim is a candidate with a source, an
 * offset and a status, and promoting one is the compile pass's job.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { grounded, id, KINDS, norm, sane } from "./gate.mjs";
import { at, chat, INGEST, jsonArray, MODELS, pool, readJsonl, REJECTIONS, rejections, replaceStage, RESEARCH, sha256, writeJsonl } from "./lib.mjs";
import { loadChunks, tokens } from "./corpus.mjs";
import { anchorTerms } from "./services-deepen.mjs";
import { RERANKED, where } from "./rerank.mjs";

const CACHE = INGEST + "enrich/";
export const CLAIMS = INGEST + "claims.jsonl";
export const CLAIMS_SUMMARY = `${RESEARCH}/claims.json`;

/** Bump to re-read everything. Same contract as the extraction cache key. */
const PROMPT_VERSION = 1;
/** Bump when `grounded` changes, because then every verdict is a different one. */
const GATE_VERSION = 2;

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

export const cacheKey = (row, model) =>
  sha256([row.serviceId, row.dimension, PROMPT_VERSION, GATE_VERSION, model, ...row.keep.map((c) => c.id)].join("|"));

/**
 * Which kinds a dimension is allowed to produce.
 *
 * The whole point of a targeted pass is that it is targeted. Asked for a fee
 * and handed a fee page, a model will also helpfully report the office, the
 * documents and the helpline, all of them grounded, all of them true, and none
 * of them what this call was for. That is not free: the same page will be read
 * again for OFFICE with a prompt that was actually designed for offices, and
 * the two answers then have to be reconciled. Out of scope kinds are recorded
 * as rejections rather than kept, so nothing is lost and nothing is duplicated.
 */
const KINDS_FOR = {
  DOCUMENTS: ["DOCUMENT_REQUIREMENT", "CONDITIONAL_REQUIREMENT", "ACCEPTED_ALTERNATIVES"],
  ELIGIBILITY: ["ELIGIBILITY", "CONDITIONAL_REQUIREMENT"],
  ACTIONS: ["ACTION", "CHANNEL"],
  APPLICATION_CHANNEL: ["CHANNEL", "APP"],
  OFFICE: ["OFFICE"],
  FEES: ["FEE"],
  TRACKING: ["TRACKING"],
  OUTPUT: ["TIMELINE", "ACTION"],
  HELPLINE: ["HELPLINE"],
  ESCALATION: ["GRIEVANCE"],
  ISSUING_AUTHORITY: ["OFFICE", "ACTION"],
  VERIFICATION: ["ACTION", "TIMELINE"],
};

/**
 * What another service's page is allowed to tell us.
 *
 * §9's bargain was that searching the whole estate finds facts a service's own
 * page never printed, and it delivers: a Collector's office page says "Mamlatdar
 * is custodian of land record of Taluka", which is a real ISSUING_AUTHORITY fact
 * for property records that no property records page states.
 *
 * But the bargain only holds for facts about *identity*. Procedure does not
 * travel. A scholarship page's eligibility is the scholarship's eligibility, its
 * steps are its steps, its fee is its fee, and every one of those sentences will
 * name the income certificate somewhere nearby, because that is why the search
 * found the page. Reading "the annual family income of the applicant must not
 * exceed Rs 6,00,000, and the income certificate must be submitted as proof" as
 * an eligibility rule for income certificates is not a hallucination. It is a
 * correct sentence filed under the wrong service, which is worse, because it
 * arrives with a working citation.
 *
 * So an unanchored passage answers who and what. Its own page answers how.
 */
const CROSS_PAGE_DIMENSIONS = new Set(["ISSUING_AUTHORITY", "VERIFICATION"]);

/** The question, in the words a citizen would use. Shared with the reranker. */
const ASKING = {
  DOCUMENTS: "exactly which documents an applicant must bring or attach, one claim per document",
  ELIGIBILITY: "exactly who is eligible, and every condition, limit or income threshold stated",
  ACTIONS: "the steps an applicant takes, one claim per step, in the order the page gives them",
  APPLICATION_CHANNEL: "where an application is made: the portal url, the app, or the counter",
  OFFICE: "the office an applicant visits, with its name and its address as printed",
  FEES: "the amount a citizen pays, and how it is paid",
  TRACKING: "how an applicant checks the status of something already submitted",
  OUTPUT: "what the applicant receives at the end, and how long it takes",
  HELPLINE: "a phone number or email address a citizen can contact",
  ESCALATION: "where to complain or appeal when the application is refused or delayed",
  ISSUING_AUTHORITY: "which authority or officer issues, signs or sanctions it",
  VERIFICATION: "what verification, inspection or field enquiry happens before it is granted",
};

const SYSTEM = [
  "You are reading passages from Indian government websites to answer one narrow question about one named service.",
  "",
  'Answer with a JSON array only. One object per fact: {"passage": number, "claim": string, "kind": string, "subject": string, "object": string, "detail": object, "evidence": string, "confidence": number}.',
  "",
  "passage is the number of the passage the fact came from.",
  "claim is one plain English sentence, always English even when the passage is in Gujarati, because a citizen reads it beside the original quote.",
  "subject and object are lower_snake_case ids you invent from the words in the passage, for example income_certificate, mamlatdar_office.",
  "detail holds whatever the passage states: amount, currency, days, url, phone, officeName, address. Ordinary digits, so 1 and not 1. Leave it {} rather than filling it in from knowledge.",
  "confidence is 0 to 1, how plainly the passage states this.",
  "",
  "EVIDENCE IS THE WHOLE JOB. evidence must be copied CHARACTER FOR CHARACTER from the passage. Not summarised, not tidied, not translated, not stitched together from two passages. One continuous run of text that contains the fact.",
  "A fact whose evidence is not found word for word is deleted by a checker before anyone reads it. A paraphrase is not partial credit.",
  "",
  "Answer ONLY the question asked. A passage may state ten other true things. They are not what this call is for and they will be discarded.",
  "Report nothing about a service other than the named one, and nothing from a jurisdiction other than the named one.",
  "Report nothing the passages do not state. An empty array is a correct and common answer.",
].join("\n");

/** The passages, numbered, whole. The reranker saw 400 characters; this reads all of it. */
export function prompt(row, texts) {
  const asking = ASKING[row.dimension] ?? row.dimension.toLowerCase().replace(/_/g, " ");
  const passages = row.keep.map((c, i) => `[${i + 1}] ${c.url}\n${c.heading ? `## ${c.heading}\n` : ""}${texts.get(c.id) ?? ""}`);
  return [
    `Service: ${row.name}`,
    `Jurisdiction: ${where(row.jurisdictionId)}`,
    `Question: ${asking}.`,
    `Allowed kind values, and nothing else: ${(KINDS_FOR[row.dimension] ?? KINDS).join(", ")}.`,
    "",
    "--- passages begin ---",
    ...passages,
    "--- passages end ---",
    "",
    "JSON array only.",
  ].join("\n");
}

/**
 * The model's answer, gated.
 *
 * Order matters and it is the same order as the first extractor: schema, then
 * kind, then the substring gate, then duplicates. A fact rejected early is not
 * checked twice, so every rejection has exactly one reason and the counts add
 * up to the number of things the model said.
 *
 * The gate runs against the passage the model said it read, not against the
 * union of all of them. Quoting passage 3 while claiming passage 1 is how a
 * fact acquires a citation to a page that does not contain it, and the citation
 * is the entire product.
 */
export function verify(raw, row, texts) {
  const claims = [];
  const rejected = [];
  const seen = new Set();
  // Dimension-independent, because this asks who the sentence is about and not
  // what it is about. For OUTPUT the retrieval anchor drops "certificate" as
  // uninformative; a quote proving it is talking about the Income Certificate
  // very much needs it.
  const naming = anchorTerms(row.name, null);
  const reject = (reason, f, note) =>
    rejected.push({
      reason,
      serviceId: row.serviceId,
      dimension: row.dimension,
      kind: typeof f?.kind === "string" ? f.kind.slice(0, 40) : null,
      claim: String(f?.claim ?? "").slice(0, 200),
      evidence: String(f?.evidence ?? "").slice(0, 200),
      ...(note ? { note } : {}),
    });

  const allowed = KINDS_FOR[row.dimension] ?? KINDS;

  for (const f of raw ?? []) {
    if (!f || typeof f !== "object") {
      reject("INVALID_SCHEMA", f, "not an object");
      continue;
    }
    const n = Number(f.passage);
    const source = Number.isInteger(n) && n >= 1 && n <= row.keep.length ? row.keep[n - 1] : null;
    if (!source) {
      reject("MISSING_SOURCE", f, `passage ${JSON.stringify(f.passage)} was not one of the ${row.keep.length} it was given`);
      continue;
    }
    const kind = typeof f.kind === "string" ? f.kind.toUpperCase().trim() : "";
    if (!KINDS.includes(kind)) {
      reject("UNSUPPORTED_KIND", f);
      continue;
    }
    // A true fact about the wrong dimension. Kept as a rejection rather than
    // promoted, because the pass that does ask for it will ask properly.
    if (!allowed.includes(kind)) {
      reject("UNSUPPORTED_KIND", f, `${kind} is not what ${row.dimension} asked for`);
      continue;
    }
    if (!grounded(f.evidence, texts.get(source.id) ?? "")) {
      reject("EVIDENCE_NOT_VERBATIM", f, norm(String(f.evidence ?? "")).length < 12 ? "shorter than a quote" : `not in passage ${n}`);
      continue;
    }
    // The gate proves a sentence was published. It cannot prove the sentence was
    // published about us, and on this corpus that is the more common failure.
    // Searching "income certificate" returns scholarship pages, and a model
    // reading one for ACTIONS truthfully reports "Provide the required details
    // in Student Details, Institute Details, Bank Account Details" — verbatim,
    // grounded, and a description of applying for a scholarship in Odisha.
    //
    // So: a passage the retrieval pass could not anchor to the service, whose
    // quote does not name the service either, is a passage about something else.
    // Anchored passages skip this. A collector's fee table has a heading that
    // says "Fees" and a row that says "Income Certificate - Rs. 20", and the row
    // names us even though the page does not.
    if ((source.topical ?? 0) < 1) {
      const said = new Set(tokens(String(f.evidence)));
      if (naming.size && ![...naming].every((t) => said.has(t))) {
        reject("NOT_ABOUT_THIS_SERVICE", f, `neither the page nor the quote names ${row.name}`);
        continue;
      }
      if (!CROSS_PAGE_DIMENSIONS.has(row.dimension)) {
        reject("NOT_ABOUT_THIS_SERVICE", f, `${row.dimension} off a page that is about something else is that page's answer`);
        continue;
      }
    }
    const claim = {
      serviceId: row.serviceId,
      dimension: row.dimension,
      claim: String(f.claim ?? "").slice(0, 400),
      kind,
      subject: id(f.subject),
      object: id(f.object),
      detail: sane(f.detail),
      evidence: String(f.evidence),
      confidence: typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.5,
      // Everything needed to show a citizen where this came from, and to find
      // it again if the chunker recuts the page underneath us.
      chunkId: source.id,
      sourceId: source.sourceId,
      url: source.url,
      start: source.start,
      end: source.end,
      relevance: source.relevance ?? null,
      // §4. A claim is a candidate. Nothing here has been reconciled against
      // another source yet, so nothing here is VERIFIED.
      status: "EXTRACTED",
    };
    const key = `${kind}|${claim.subject}|${claim.object}|${norm(claim.evidence)}`;
    if (seen.has(key)) {
      reject("DUPLICATE", claim);
      continue;
    }
    seen.add(key);
    claims.push(claim);
  }
  return { claims, rejected };
}

/** One reranked shortlist, read. */
export async function enrichOne(row, texts, { ask = chat, model = MODELS.tier1 } = {}) {
  const cached = readCache(cacheKey(row, model));
  if (cached) return { ...cached, cached: true };

  const reply = await ask(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt(row, texts) },
    ],
    { model, maxTokens: 3000 },
  );

  const raw = reply ? jsonArray(reply.text) : null;
  const { claims, rejected } = verify(raw, row, texts);
  const result = {
    serviceId: row.serviceId,
    dimension: row.dimension,
    pass: row.pass,
    name: row.name,
    model,
    promptVersion: PROMPT_VERSION,
    gateVersion: GATE_VERSION,
    reachedModel: raw !== null,
    passages: row.keep.length,
    claims,
    rejected,
    // §28. Nothing found is a finding. The difference between "the model was
    // down" and "the passages do not say" is the difference between retrying
    // and not, so they are two states and not one empty array.
    status: !reply ? "MODEL_UNREACHABLE" : claims.length ? "EXTRACTED" : "NO_EVIDENCE_FOUND",
  };

  // An outage is not a verdict, so it is not cached.
  if (result.status !== "MODEL_UNREACHABLE") writeCache(cacheKey(row, model), result);
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
  writeFileSync(at(CACHE + key + ".json"), JSON.stringify(result, null, 1) + "\n");
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
    keep: [
      { id: "chunk:a_0", sourceId: "src:a", url: "https://a.gov.in/x", heading: "Fees", start: 0, end: 60, topical: 3, relevance: 3 },
      { id: "chunk:b_0", sourceId: "src:b", url: "https://b.gov.in/y", heading: null, start: 10, end: 70, topical: 1, relevance: 2 },
    ],
  };
  const texts = new Map([
    ["chunk:a_0", "The fee for a **Varsai Certificate** is Rs. 20/- per copy."],
    ["chunk:b_0", "Applications are received at the Mamlatdar office, Nadiad."],
  ]);

  const p = prompt(row, texts);
  assert.ok(p.includes("[1] https://a.gov.in/x"), "the passage is numbered and its url is shown");
  assert.ok(p.includes("Rs. 20/- per copy"), "and it is the whole passage, not the reranker's 400 character preview");
  assert.ok(p.includes("Allowed kind values, and nothing else: FEE."), "a targeted pass says what it will accept");
  assert.ok(p.includes("Jurisdiction: Gujarat"));

  // The gate, which is the reason this file exists.
  const ok = verify(
    [{ passage: 1, claim: "The fee is Rs 20 per copy.", kind: "FEE", subject: "varsai_certificate", object: "fee", detail: { amount: "20", currency: "INR" }, evidence: "The fee for a Varsai Certificate is Rs. 20/- per copy.", confidence: 0.9 }],
    row,
    texts,
  );
  assert.equal(ok.claims.length, 1);
  assert.equal(ok.claims[0].status, "EXTRACTED", "a candidate, not a verified fact");
  assert.equal(ok.claims[0].url, "https://a.gov.in/x", "and it carries the passage it came from");
  assert.equal(ok.claims[0].chunkId, "chunk:a_0");
  assert.equal(ok.rejected.length, 0);

  const bad = verify(
    [
      { passage: 1, claim: "The fee is Rs 50.", kind: "FEE", evidence: "The fee for a Varsai Certificate is Rs. 50/- per copy.", confidence: 1 },
      { passage: 1, claim: "Paraphrased.", kind: "FEE", evidence: "You pay twenty rupees for a Varsai Certificate.", confidence: 1 },
      { passage: 1, claim: "Too short.", kind: "FEE", evidence: "Rs. 20", confidence: 1 },
      { passage: 9, claim: "From nowhere.", kind: "FEE", evidence: "The fee for a Varsai Certificate is Rs. 20/- per copy.", confidence: 1 },
      { passage: 1, claim: "Wrong kind.", kind: "OFFICE", evidence: "The fee for a Varsai Certificate is Rs. 20/- per copy.", confidence: 1 },
      { passage: 1, claim: "Invented kind.", kind: "VIBES", evidence: "The fee for a Varsai Certificate is Rs. 20/- per copy.", confidence: 1 },
      "not an object",
    ],
    row,
    texts,
  );
  assert.equal(bad.claims.length, 0, "not one of those reaches a citizen");
  assert.deepEqual(
    bad.rejected.map((r) => r.reason),
    ["EVIDENCE_NOT_VERBATIM", "EVIDENCE_NOT_VERBATIM", "EVIDENCE_NOT_VERBATIM", "MISSING_SOURCE", "UNSUPPORTED_KIND", "UNSUPPORTED_KIND", "INVALID_SCHEMA"],
  );
  assert.equal(bad.rejected.length, 7, "§5: every one of them is kept, with the words the model used");
  assert.ok(bad.rejected[2].note.includes("shorter than a quote"), "too short and not on the page are different mistakes");
  assert.ok(bad.rejected[4].note.includes("not what FEES asked for"), "a true fact about the wrong dimension is still not this call's answer");

  // Quoting one passage while claiming another is how a citation stops pointing
  // at the page that contains it.
  const crossed = verify([{ passage: 1, claim: "Office.", kind: "FEE", evidence: "Applications are received at the Mamlatdar office, Nadiad.", confidence: 1 }], row, texts);
  assert.equal(crossed.claims.length, 0);
  assert.equal(crossed.rejected[0].note, "not in passage 1");

  // A true sentence off a page about a different scheme. Verbatim, grounded, and
  // not an answer about this service.
  const elsewhere = {
    ...row,
    dimension: "ACTIONS",
    keep: [{ id: "chunk:d_0", sourceId: "src:d", url: "https://web.umang.gov.in/scheme/banishree", heading: "How to apply", start: 0, end: 90, topical: 0 }],
  };
  const stolen = new Map([["chunk:d_0", "3. Provide the required details in Student Details, Institute Details, Bank Account Details. 5. Attach a Varsai Certificate issued by the Mamlatdar."]]);
  const borrowed = verify(
    [
      { passage: 1, claim: "Provide student details.", kind: "ACTION", evidence: "Provide the required details in Student Details, Institute Details, Bank Account Details.", confidence: 1 },
      { passage: 1, claim: "It is issued by the Mamlatdar.", kind: "ACTION", evidence: "Attach a Varsai Certificate issued by the Mamlatdar.", confidence: 1 },
    ],
    elsewhere,
    stolen,
  );
  assert.equal(borrowed.claims.length, 0, "a scholarship's steps are the scholarship's steps, even the one that names us");
  assert.deepEqual(borrowed.rejected.map((r) => r.reason), ["NOT_ABOUT_THIS_SERVICE", "NOT_ABOUT_THIS_SERVICE"]);
  assert.ok(borrowed.rejected[0].note.includes("neither the page nor the quote names"));
  assert.ok(borrowed.rejected[1].note.includes("that page's answer"), "and the two ways of being someone else's fact are told apart");

  // §9's actual dividend: who issues a thing travels between pages, and is the
  // reason searching the whole estate was worth building.
  const whoIssues = verify(
    [{ passage: 1, claim: "The Mamlatdar issues it.", kind: "OFFICE", evidence: "Attach a Varsai Certificate issued by the Mamlatdar.", confidence: 1 }],
    { ...elsewhere, dimension: "ISSUING_AUTHORITY" },
    stolen,
  );
  assert.equal(whoIssues.claims.length, 1);

  // An anchored passage is exempt, because the page already established who it
  // is about and a fee table row does not repeat the service name in prose.
  const anchored = { ...row, keep: [{ ...row.keep[0], topical: 3 }] };
  const table = new Map([["chunk:a_0", "Rs. 20/- per copy is payable at the counter."]]);
  const onOwnPage = verify([{ passage: 1, claim: "Rs 20.", kind: "FEE", evidence: "Rs. 20/- per copy is payable at the counter.", confidence: 1 }], anchored, table);
  assert.equal(onOwnPage.claims.length, 1);

  const dupe = verify(
    [
      { passage: 1, claim: "Fee.", kind: "FEE", subject: "a", object: "b", evidence: "The fee for a Varsai Certificate is Rs. 20/- per copy.", confidence: 1 },
      { passage: 1, claim: "Fee again.", kind: "FEE", subject: "a", object: "b", evidence: "The fee for a Varsai   Certificate is Rs. 20/- per copy.", confidence: 1 },
    ],
    row,
    texts,
  );
  assert.equal(dupe.claims.length, 1);
  assert.equal(dupe.rejected[0].reason, "DUPLICATE", "different whitespace is the same quote");

  assert.deepEqual(verify(null, row, texts), { claims: [], rejected: [] }, "a model that said nothing rejected nothing");

  // Cache, and the one thing that must never be cached.
  const model = "test-model";
  const good = async () => ({ text: '[{"passage":1,"kind":"FEE","claim":"Rs 20.","evidence":"The fee for a Varsai Certificate is Rs. 20/- per copy.","confidence":0.9}]' });
  const first = await enrichOne(row, texts, { ask: good, model });
  assert.equal(first.status, "EXTRACTED");
  assert.equal(first.cached, false);
  const second = await enrichOne(row, texts, { ask: async () => { throw new Error("must not be called"); }, model });
  assert.equal(second.cached, true, "§27: restarting must not trigger model work");

  const down = await enrichOne({ ...row, serviceId: "service:nocache" }, texts, { ask: async () => null, model });
  assert.equal(down.status, "MODEL_UNREACHABLE");
  assert.equal(readCache(cacheKey({ ...row, serviceId: "service:nocache" }, model)), null, "so the next run tries again");

  const empty = await enrichOne({ ...row, serviceId: "service:empty" }, texts, { ask: async () => ({ text: "[]" }), model });
  assert.equal(empty.status, "NO_EVIDENCE_FOUND", "a model that read them and found nothing is a finding, and it is cached");
  assert.ok(readCache(cacheKey({ ...row, serviceId: "service:empty" }, model)));

  const { rmSync } = await import("node:fs");
  for (const s of ["service:varsai_certificate", "service:empty"]) rmSync(at(CACHE + cacheKey({ ...row, serviceId: s }, model) + ".json"), { force: true });

  console.log("enrich: ok");
  process.exit(0);
}

// ---------------------------------------------------------------------- run

if (isMain) {
  const ledger = readJsonl(RERANKED).filter((r) => r.keep.length);
  if (!ledger.length) {
    console.log(`Nothing reranked yet. Run: pnpm evidence:rerank`);
    process.exit(0);
  }

  if (flag("stats")) {
    report(readJsonl(CLAIMS));
    process.exit(0);
  }

  const one = value("service");
  const only = value("dimension");
  let rows = ledger.filter((r) => (!one || r.serviceId === one || r.serviceId === `service:${one}`) && (!only || r.dimension === only));
  rows = rows.slice(0, Number(value("limit", rows.length)));

  const model = value("model", MODELS.tier1);
  const pending = rows.filter((r) => !readCache(cacheKey(r, model)));
  console.log(`${rows.length} shortlist(s), ${rows.length - pending.length} already read, ${pending.length} to send.`);
  if (flag("dry")) {
    console.log(`${pending.reduce((n, r) => n + r.keep.length, 0)} passage(s) would be read by ${model}. Nothing sent.`);
    process.exit(0);
  }

  const texts = new Map(loadChunks().map((c) => [c.id, c.text]));
  // Eight at a time, for the same reason the reranker is: see the note there.
  let done = 0;
  const out = await pool(rows, 8, async (row) => {
    const result = await enrichOne(row, texts, { model });
    done++;
    if (!result.cached) process.stdout.write(`\r  ${done}/${rows.length}  ${row.serviceId.slice(8, 40)} ${row.dimension}`.padEnd(78));
    return result;
  });
  process.stdout.write("\r".padEnd(80) + "\r");

  // Everything refused, in the ledger `pnpm rejections:stats` reads, keyed by a
  // stage of its own so the compile pass and this one stop overwriting each
  // other. Read back from every cached verdict rather than just this run's, for
  // the same reason the claims are: the drops are the more interesting half.
  const drops = rejections("enrich", `enrich-${PROMPT_VERSION}.${GATE_VERSION}`);
  for (const r of ledger.flatMap((r) => readCache(cacheKey(r, model))?.rejected ?? [])) {
    const { reason, ...rest } = r;
    drops.reject(reason, rest);
  }
  replaceStage(REJECTIONS, "enrich", drops.rows);

  const rejected = out.flatMap((r) => r.rejected);
  // Rebuilt from the reranked ledger and the cache, never merged with the file
  // it is replacing. Merging looks equivalent and is not: it can only replace a
  // (service, dimension) pair that appears in *this* run, and the pairs that
  // vanish are exactly the ones that need replacing. Bumping the reranker's
  // prompt emptied income_certificate ACTIONS to zero passages, so this run had
  // nothing to say about it, so five claims sourced from a scholarship page the
  // new rubric had just demoted stayed in the ledger, invisibly, as facts about
  // how to get an income certificate. A shortlist that no longer exists has to
  // take its claims with it.
  const all = ledger.flatMap((r) => readCache(cacheKey(r, model))?.claims ?? []);
  writeJsonl(CLAIMS, all);
  report(all, { write: true, rejected, runs: out });
}

/** What was said, what was kept, and what the gate threw out. */
function report(claims, { write = false, rejected = [], runs = [] } = {}) {
  if (!claims.length && !runs.length) {
    console.log(`Nothing extracted yet. Run: pnpm services:enrich --limit 20`);
    return;
  }

  const byDimension = new Map();
  for (const c of claims) {
    const d = byDimension.get(c.dimension) ?? { claims: 0, services: new Set() };
    d.claims++;
    d.services.add(c.serviceId);
    byDimension.set(c.dimension, d);
  }
  const width = Math.max(8, ...[...byDimension.keys()].map((k) => k.length));

  console.log(`\n${claims.length} claim(s) across ${new Set(claims.map((c) => c.serviceId)).size} service(s), every one of them quoted verbatim off a page we hold\n`);
  for (const [d, s] of [...byDimension.entries()].sort((a, b) => b[1].claims - a[1].claims)) {
    console.log(`  ${d.padEnd(width)}  ${String(s.claims).padStart(4)} claim(s)  ${String(s.services.size).padStart(3)} service(s)`);
  }

  if (runs.length) {
    const byReason = new Map();
    for (const r of rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    const unreachable = runs.filter((r) => r.status === "MODEL_UNREACHABLE").length;
    const nothing = runs.filter((r) => r.status === "NO_EVIDENCE_FOUND").length;

    console.log(`\n  ${rejected.length} candidate(s) the gate refused, all of them kept:`);
    for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${reason}`);
    if (!rejected.length) console.log(`    none, which is more suspicious than a large number`);
    console.log(`\n  ${nothing} shortlist(s) the model read and found nothing in, recorded rather than retried`);
    if (unreachable) console.log(`  ${unreachable} shortlist(s) the model never answered for, not cached, will be tried again`);
  }

  console.log(`\n  These are candidates. Nothing is in the graph until the compile pass puts it there.`);

  if (write) {
    writeFileSync(
      CLAIMS_SUMMARY,
      JSON.stringify(
        {
          generatedBy: "pnpm services:enrich",
          claims: claims.length,
          services: new Set(claims.map((c) => c.serviceId)).size,
          rejectedThisRun: rejected.length,
          byDimension: Object.fromEntries([...byDimension.entries()].map(([d, s]) => [d, { claims: s.claims, services: s.services.size }])),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`\n  ${CLAIMS_SUMMARY} written`);
  }
}
