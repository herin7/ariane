/**
 * Turn discovered pages into government facts that provably came off the page.
 *
 *   pnpm services:extract                  # fetch and extract the whole queue
 *   pnpm services:extract --limit 50        # a slice, for committing as you go
 *   pnpm services:extract --fetch-only      # fill the page cache, no model
 *   pnpm services:extract --host x.gov.in
 *   pnpm services:extract --selftest        # the substring gate, no network
 *
 * Two stages, cached separately, because they fail for different reasons and
 * re-running one must never re-run the other:
 *
 *   fetch     .ingest/pages/<sha1(url)>.md   +  .ingest/pages.jsonl
 *   extract   .ingest/extract/<key>.json     key = content + schema + prompt + model
 *
 * The cache key is the point. Change the prompt and every extraction is
 * invalidated by construction, with no cache to bust by hand, and not one page
 * is fetched again. Fix the model id in the key and a Tier 2 result can never be
 * mistaken for a Tier 1 one.
 *
 * ------------------------------------------------------------------------
 * THE GUARANTEE
 *
 * Every `evidence` string a model returns is checked to be a verbatim substring
 * of the page text, under exactly the normalisation `quotes.ts` uses. A model
 * that paraphrases gets its fact DROPPED. Not corrected, not flagged, dropped.
 *
 * That is what makes this safe to run at scale. Fabrication is not discouraged
 * here, it is structurally impossible to persist: a fact with no verbatim quote
 * has nowhere to live. The counter for how many were dropped is printed on
 * every run, because a model that suddenly starts paraphrasing everything is a
 * thing we want to find out about immediately.
 * ------------------------------------------------------------------------
 *
 * What this does not do: decide anything. It produces evidence. Phase 5 decides
 * what becomes a node, and every claim it makes still has to survive
 * `pnpm graph:validate` and `pnpm quotes:audit` afterwards.
 */

import { appendJsonl, at, chat, fetchPage, hostOf, jsonArray, ledger, loadNegative, looksSoft404, MODELS, NEGATIVE, negativeRow, pool, readJsonl, saveLedger, sha1, sha256, toText, htmlMeta, writeJsonl } from "./lib.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PAGES = ".ingest/pages/";
const EXTRACT = ".ingest/extract/";
const PAGES_LEDGER = ".ingest/pages.jsonl";
const FACTS = ".ingest/facts.jsonl";

/** Bump either and every cached extraction is invalidated. No manual busting. */
const SCHEMA_VERSION = 1;
const PROMPT_VERSION = 2;

const FETCH_CONCURRENCY = 8;
const MODEL_CONCURRENCY = 4;
/** Enough of a page for the model to see the requirements table, not the footer. */
const MAX_CHARS = 14_000;
/** Below this a page has navigation and nothing else. */
const MIN_CHARS = 400;
/** A page this good that yields nothing groundable is worth one Tier 2 attempt. */
const ESCALATE_ABOVE = 8;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// ---------------------------------------------------------- the substring gate

/** Character for character the same rule as `packages/core/src/cli/quotes.ts`. */
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Did this quote come off this page?
 *
 * One substring check after whitespace normalisation. No fuzzy matching, no
 * edit distance, no "close enough". A quote trimmed differently from the page
 * passes, a paraphrase does not, and that is the entire line worth drawing:
 * the moment it is fuzzy, a confident model can walk a fact across it.
 */
export function grounded(evidence, pageText) {
  if (typeof evidence !== "string") return false;
  const quote = norm(evidence);
  // Six characters is not a quote, it is a coincidence waiting to happen. "Fee"
  // appears on every page in the estate.
  if (quote.length < 12) return false;
  return norm(pageText).includes(quote);
}

const GUJARATI_DIGITS = "૦૧૨૩૪૫૬૭૮૯";

/**
 * `detail` as something downstream can do arithmetic on.
 *
 * A page that says the processing time is ૧ દિવસ gets `{days: "૧"}` back, which
 * is a faithful copy and completely useless to a comparison. The quote keeps the
 * original either way, so converting here loses nothing and saves every consumer
 * from discovering Gujarati numerals on its own.
 */
function sane(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = typeof v === "string" ? v.replace(/[૦-૯]/g, (d) => GUJARATI_DIGITS.indexOf(d)).slice(0, 300) : v;
  }
  return out;
}

const KINDS = [
  "ELIGIBILITY",
  "DOCUMENT_REQUIREMENT",
  "CONDITIONAL_REQUIREMENT",
  "ACCEPTED_ALTERNATIVES",
  "CHANNEL",
  "TIMELINE",
  "FEE",
  "OFFICE",
  "HELPLINE",
  "GRIEVANCE",
  "TRACKING",
  "APP",
  "ACTION",
  "DEPENDENCY",
  "EXTERNAL_DEPENDENCY",
  "BLOCKER",
];

// -------------------------------------------------------------------- prompt

const SYSTEM = [
  "You read one page from an Indian government website and report only the facts a citizen needs in order to complete a service.",
  "",
  'Answer with a JSON array only. One object per fact: {"claim": string, "kind": string, "subject": string, "object": string, "detail": object, "evidence": string, "confidence": number}.',
  "",
  `kind must be exactly one of: ${KINDS.join(", ")}.`,
  "claim is one plain English sentence saying what is required, always English even when the page is in Gujarati, because a citizen reads this next to the original quote.",
  "subject and object are lower_snake_case ids you invent from the words on the page, for example income_certificate, aadhaar_card, mamlatdar_office.",
  "detail is an object with whatever the page actually states: amount, currency, days, url, phone, officeName, address. Write every number in detail in ordinary digits, so 1 and not ૧. Leave it {} rather than filling it in from knowledge.",
  "confidence is 0 to 1, how plainly the page states this.",
  "Report each fact once. Do not repeat a fact under two kinds and do not repeat it with the same quote.",
  "",
  "EVIDENCE IS THE WHOLE JOB. evidence must be copied CHARACTER FOR CHARACTER from the page text you were given. Not summarised, not tidied, not translated, not stitched together from two places. Copy one continuous run of text that contains the fact.",
  "A fact whose evidence is not found word for word in the page is thrown away by a checker before anyone reads it, so a paraphrase is not a partial credit, it is a deleted fact.",
  "",
  "Report nothing the page does not state. Do not add a document, a fee, a timeline or an office because you know it is usually required. An empty array is a correct and common answer: most government pages are navigation.",
  "Never report a fact about a different service than the one this page is about.",
].join("\n");

const userPrompt = (url, title, text) =>
  `Page: ${url}\nTitle: ${title || "-"}\n\n--- page text begins ---\n${text}\n--- page text ends ---\n\nWhat does this page state that a citizen must know? JSON array only.`;

// ----------------------------------------------------------------- self test

if (flag("selftest")) {
  const { strict: assert } = await import("node:assert");

  const page = "Applicants must submit\n\n  Aadhaar Card   and a  ration card.\nThe fee is Rs. 20 per copy.";
  assert.equal(grounded("Applicants must submit", page), true);
  assert.equal(grounded("aadhaar card and a ration card.", page), true, "whitespace and case do not matter");
  assert.equal(grounded("APPLICANTS MUST SUBMIT AADHAAR CARD AND A RATION CARD.", page), true, "collapsed runs still match");
  assert.equal(grounded("Applicants must provide an Aadhaar Card", page), false, "a paraphrase is not evidence");
  assert.equal(grounded("Aadhaar Card and a voter id", page), false, "a fact with an invented document is dropped");
  assert.equal(grounded("The fee is Rs. 50 per copy.", page), false, "a wrong number is not on the page");
  assert.equal(grounded("fee", page), false, "too short to be a quote");
  assert.equal(grounded(undefined, page), false);

  // The gate must agree with the auditor that runs on the committed graph, or a
  // fact passes here and fails there, which is the worst place to find out.
  const auditor = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  assert.equal(norm("  A   B\nc "), auditor("  A   B\nc "));

  assert.deepEqual(sane({ days: "૧૫", amount: 20, blank: "", missing: null }), { days: "15", amount: 20 });
  assert.deepEqual(sane("not an object"), {});

  console.log("services-extract: ok");
  process.exit(0);
}

// -------------------------------------------------------------------- fetch

const now = new Date().toISOString();
mkdirSync(at(PAGES), { recursive: true });
mkdirSync(at(EXTRACT), { recursive: true });

const pages = ledger(PAGES_LEDGER, "url");
const blocked = loadNegative(now);

const queue = readJsonl(".ingest/urls.jsonl")
  .filter((r) => r.state === "DISCOVERED")
  .filter((r) => !value("host", null) || r.host === value("host", null))
  .sort((a, b) => b.score - a.score);

// A PDF is not skipped because it is unimportant, it is skipped because
// `toText` is an HTML stripper and a PDF run through it is binary noise that a
// model would cheerfully summarise. Recorded so the count is visible and so
// whoever adds a PDF reader knows exactly what is waiting for them.
const deferredPdf = queue.filter((r) => !pages.has(r.url) && !blocked.has(r.url) && /\.pdf(\?|$)/i.test(r.url));

const toFetch = queue
  .filter((r) => !pages.has(r.url) && !blocked.has(r.url) && !/\.pdf(\?|$)/i.test(r.url))
  .slice(0, Number(value("limit", Infinity)));

console.log(`${queue.length} discovered urls, ${pages.size} already fetched, ${blocked.size} in the negative cache, ${deferredPdf.length} pdfs deferred, ${toFetch.length} to fetch`);

const newlyNegative = deferredPdf.map((r) => negativeRow(r.url, "NOT_TEXT", now, "pdf, no reader built"));

/**
 * Every content hash we already hold, and the url that earned it.
 *
 * This is the second half of soft-404 detection and the half a title check
 * cannot do. digitalgujarat.gov.in answers 200 with its real homepage, real
 * title and 1436 characters of content for a path that does not exist, because
 * it is a single page app serving one shell for every route. Nothing about that
 * response says "missing". The only thing that gives it away is that the next
 * nonexistent path returns byte-identical content.
 *
 * So: first url to produce a hash keeps it, everyone after is a duplicate. This
 * costs nothing on a normal host and is the difference between a fact cited to
 * the page that states it and a fact cited to a url that never existed.
 */
const byContent = new Map();
for (const p of pages.values()) if (!byContent.has(p.contentHash)) byContent.set(p.contentHash, p.url);

let ok = 0;
const fetched = await pool(toFetch, FETCH_CONCURRENCY, async (row) => {
  const res = await fetchPage(row.url, { timeoutMs: 20_000 });
  if (!res.ok) {
    newlyNegative.push(negativeRow(row.url, res.failure ?? "HTTP_ERROR", now, res.errorCode ?? null));
    return;
  }
  // A url that ends in .html and serves a zip is a thing this estate does.
  if (res.contentType && !/text\/|xml|json/i.test(res.contentType)) {
    newlyNegative.push(negativeRow(row.url, "NOT_TEXT", now, String(res.contentType).slice(0, 60)));
    return;
  }
  const meta = htmlMeta(res.body ?? "");
  const text = toText(res.body ?? "");
  if (looksSoft404(text, meta, res.contentType)) {
    newlyNegative.push(negativeRow(row.url, "SOFT_404", now, meta.title || null));
    return;
  }
  if (text.length < MIN_CHARS) {
    // Not an error and not worth a model. Recorded so it is never fetched again.
    newlyNegative.push(negativeRow(row.url, "TOO_THIN", now, `${text.length} chars`));
    return;
  }
  ok++;
  if (ok % 50 === 0) console.log(`  ${ok} pages fetched`);
  return {
    text,
    row: {
      url: row.url,
      sha1: sha1(row.url),
      contentHash: sha256(text),
      host: hostOf(row.url),
      title: meta.title || row.title || null,
      chars: text.length,
      status: res.status,
      // The caveat travels with the page from here to the citizen's screen.
      tlsVerified: res.tlsVerified !== false,
      truncated: res.truncated === true,
      score: row.score,
      fetchedAt: now,
    },
  };
});

// Written in input order, not completion order, so two runs over the same queue
// pick the same url as the original and the same ones as duplicates.
let duplicates = 0;
for (const got of fetched) {
  if (!got) continue;
  const first = byContent.get(got.row.contentHash);
  if (first && first !== got.row.url) {
    newlyNegative.push(negativeRow(got.row.url, "SOFT_404", now, `byte identical to ${first}`));
    duplicates++;
    continue;
  }
  byContent.set(got.row.contentHash, got.row.url);
  writeFileSync(at(PAGES + got.row.sha1 + ".md"), got.text);
  pages.set(got.row.url, got.row);
}

saveLedger(PAGES_LEDGER, pages);
appendJsonl(NEGATIVE, newlyNegative);
console.log(`  ${ok} fetched, ${duplicates} discarded as a catch-all shell, ${newlyNegative.length} recorded as not worth asking again`);

if (flag("fetch-only")) process.exit(0);

// ------------------------------------------------------------------ extract

const cacheKey = (contentHash, model) => sha256(`${contentHash}|${SCHEMA_VERSION}|${PROMPT_VERSION}|${model}`);

/** One page through one model, cached on content plus prompt plus model id. */
async function extract(page, text, model) {
  const file = at(EXTRACT + cacheKey(page.contentHash, model) + ".json");
  if (existsSync(file)) return { ...JSON.parse(readFileSync(file, "utf8")), cached: true };

  const reply = await chat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt(page.url, page.title, text.slice(0, MAX_CHARS)) },
    ],
    { model, maxTokens: 4000 },
  );

  const raw = reply ? (jsonArray(reply.text) ?? []) : null;
  const facts = [];
  const seen = new Set();
  let dropped = 0;
  for (const f of raw ?? []) {
    if (!f || typeof f !== "object") continue;
    const kind = typeof f.kind === "string" ? f.kind.toUpperCase().trim() : "";
    // The two gates, in order of how much they matter. A kind we do not have is
    // a schema the model invented; evidence not on the page is a fact it did.
    if (!KINDS.includes(kind) || !grounded(f.evidence, text)) {
      dropped++;
      continue;
    }
    const id = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || null;
    const row = {
      claim: String(f.claim ?? "").slice(0, 400),
      kind,
      subject: id(f.subject),
      object: id(f.object),
      detail: sane(f.detail),
      evidence: String(f.evidence),
      confidence: typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.5,
    };
    // The prompt asks for each fact once and mostly gets it. This is the part
    // that is actually true: the same requirement arrived twice under the same
    // quote on the very first page tried, and a duplicated requirement becomes a
    // duplicated step in a citizen's checklist.
    const key = `${kind}|${row.subject}|${row.object}|${norm(row.evidence)}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    facts.push(row);
  }

  const result = { url: page.url, contentHash: page.contentHash, model, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, extractedAt: now, reachedModel: reply !== null, facts, dropped };
  // Written even when it found nothing. "This page states no citizen facts" is
  // a real and common answer and paying to rediscover it would be silly.
  writeFileSync(file, JSON.stringify(result, null, 1));
  return { ...result, cached: false };
}

const toExtract = [...pages.values()].sort((a, b) => b.score - a.score).slice(0, Number(value("limit", Infinity)));
console.log(`\n${toExtract.length} cached pages to extract from`);

const stats = { cached: 0, calls: 0, dropped: 0, escalated: 0, unreachable: 0 };
const results = await pool(toExtract, MODEL_CONCURRENCY, async (page) => {
  const text = readFileSync(at(PAGES + page.sha1 + ".md"), "utf8");
  let out = await extract(page, text, MODELS.tier1);
  if (out.cached) stats.cached++;
  else stats.calls++;
  if (!out.reachedModel) stats.unreachable++;
  stats.dropped += out.dropped;

  // Tier 2, once, and only for a page that scored well and gave Tier 1 nothing
  // it could ground. Never a blind rerun: a page that genuinely states no facts
  // will state no facts to the expensive model too.
  if (out.reachedModel && !out.facts.length && page.score >= ESCALATE_ABOVE) {
    const strong = await extract(page, text, MODELS.tier2);
    if (!strong.cached) stats.calls++;
    stats.dropped += strong.dropped;
    if (strong.facts.length) {
      stats.escalated++;
      out = strong;
    }
  }
  return out;
});

// Grouped by url and merged into what is already on disk, never appended to and
// never blindly rewritten. `--limit 50` used to overwrite facts.jsonl with only
// the fifty pages of that run, quietly deleting every fact found before it,
// which is exactly the failure mode that looks like the extractor got worse.
// A url that now yields nothing loses its old rows on purpose: the page changed
// or the prompt did, and keeping the stale ones would be the same lie.
const byUrl = new Map();
for (const f of readJsonl(FACTS)) {
  if (!byUrl.has(f.url)) byUrl.set(f.url, []);
  byUrl.get(f.url).push(f);
}
for (const r of results.filter(Boolean)) {
  const rows = r.facts.map((f) => ({ ...f, url: r.url, contentHash: r.contentHash, model: r.model, promptVersion: r.promptVersion, schemaVersion: r.schemaVersion, extractedAt: r.extractedAt }));
  if (rows.length) byUrl.set(r.url, rows);
  else byUrl.delete(r.url);
}
const facts = [...byUrl.values()].flat();
writeJsonl(FACTS, facts);
appendJsonl(".ingest/runs.jsonl", [{ run: "services:extract", at: now, fetched: ok, pages: toExtract.length, modelCalls: stats.calls, cacheHits: stats.cached, facts: facts.length, droppedUngrounded: stats.dropped, escalatedToTier2: stats.escalated }]);

const withFacts = results.filter((r) => r?.facts.length).length;
console.log(`\n${stats.calls} model calls, ${stats.cached} cache hits, ${stats.escalated} escalated to ${MODELS.tier2}`);
if (stats.unreachable) console.log(`  ${stats.unreachable} page(s) the model never answered for`);
console.log(`${facts.length} grounded facts from ${withFacts} of ${toExtract.length} pages`);
console.log(`${stats.dropped} fact(s) dropped for not being verbatim on the page. That number going to zero would be more worrying than it going up.`);
console.log(`\n.ingest/facts.jsonl written.`);
