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

import { grounded, id, KINDS, norm, sane, unmark } from "./gate.mjs";
import { appendJsonl, at, chat, fetchPage, hostOf, jsonArray, ledger, loadNegative, looksSoft404, MODELS, NEGATIVE, negativeRow, pool, readJsonl, renderPage, saveLedger, sha1, sha256, toText, htmlMeta, writeJsonl } from "./lib.mjs";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const PAGES = ".ingest/pages/";
const EXTRACT = ".ingest/extract/";
const PAGES_LEDGER = ".ingest/pages.jsonl";
const FACTS = ".ingest/facts.jsonl";

/** Bump any and every cached extraction is invalidated. No manual busting. */
const SCHEMA_VERSION = 1;
const PROMPT_VERSION = 4;
/**
 * The substring gate is part of what an extraction means, not part of how it
 * was requested. Loosening it without a key of its own leaves a cache full of
 * results the current gate would never have produced, and no way to tell.
 * v2: markdown markup stopped counting as a difference in wording.
 */
const GATE_VERSION = 2;

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

// Bedrock is not the state web server and does not deserve the same manners.
// A long page is up to four calls, so this is pages in flight and not calls,
// and at eight the queue of 253 long pages was measured at 19.4s a page while
// a single call comes back in well under a minute. That gap was all queue.
const MODEL_CONCURRENCY = Number(value("model-concurrency", 20));

// Eight against a state web server is polite. A render goes to Firecrawl and
// not to the site, and `renderPage` paces itself at the plan's eleven a minute,
// so this number stops being a rate and becomes only how much slow render we
// can have in the air at once. Ten covers the 45s ceiling at a 6s gap.
const FETCH_CONCURRENCY = flag("render") ? Number(value("concurrency", 10)) : 8;

// ---------------------------------------------------------- the substring gate

// The gate lives in gate.mjs now that a second extractor needs it. Its
// assertions stay in this file's selftest, because this is the output it
// guards, and a gate whose tests moved away from it is a gate nobody reruns.

/**
 * A long page in as many windows as it takes, not the first 14,000 characters.
 *
 * Measured across the cache: 201 pages are longer than the window and between
 * them 2,478,500 characters had never once been shown to a model. Not thin
 * pages. The opposite: a page is long here because it is the one that lists all
 * forty documents, and we were reading the first third of exactly the pages
 * worth reading.
 *
 * Overlapped, because a requirement that straddles a boundary is invisible in
 * both halves otherwise, and the quote has to survive whole to pass the gate.
 *
 * Limitation: split on characters, not on headings. A heading-aware split is
 * better and this estate's markdown is not consistent enough to trust one.
 */
const WINDOW_OVERLAP = 600;
/** Four windows is 54k characters. Past that a page is a document dump. */
const MAX_WINDOWS = 4;

export function windows(text, size = MAX_CHARS, overlap = WINDOW_OVERLAP) {
  const out = [];
  for (let i = 0; i < text.length && out.length < MAX_WINDOWS; i += size - overlap) out.push(text.slice(i, i + size));
  return out;
}

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

  // A page written in markdown says the same thing a page written in plain text
  // says. The model quotes what a citizen would read off the screen, and until
  // this passed, every bolded requirement on the estate was thrown away.
  const md = "8\\. **For Law Studies:** [**Course List**](https://x.gov.in/c.aspx)\n\nFee is \\*Rs. 20\\* per copy.";
  assert.equal(grounded("For Law Studies: Course List", md), true, "bold and a link are not part of the claim");
  assert.equal(grounded("**For Law Studies:**", md), true, "quoting the markup back at us is also fine");
  assert.equal(grounded("Fee is Rs. 20 per copy.", md), true, "an escaped asterisk is a printed asterisk, not a word");
  assert.equal(grounded("For Law Studies: Course Catalogue", md), false, "still a paraphrase, still dropped");
  assert.equal(grounded("https://x.gov.in/c.aspx", md), false, "a link target is not something the page said");

  // Four ways a page prints a sentence that a citizen reads as plain text. Each
  // one of these was silently throwing away real quotes off real pages.
  const messy = "- The applicant must be a widowed woman.\nApply at <u>https://sarathi.parivahan.gov.in</u> for a learner’s licence.\n\\| city : ahmedabad \\| pin code : 380027\nઆવક અને<br>શહેર";
  assert.equal(grounded("The applicant must be a widowed woman.", messy), true, "a list bullet is the list, not the sentence");
  assert.equal(grounded("Apply at https://sarathi.parivahan.gov.in for a learner's licence.", messy), true, "an html tag and a curly apostrophe are not what the page said");
  assert.equal(grounded("| city : ahmedabad | pin code : 380027", messy), true, "an escaped table pipe is a printed pipe");
  assert.equal(grounded("આવક અને શહેર", messy), true, "a line break tag reads as the space it renders as");
  assert.equal(grounded("The applicant must be a married woman.", messy), false, "none of that softens the gate");

  // The gate must agree with the auditor that runs on the committed graph, or a
  // fact passes here and fails there, which is the worst place to find out.
  const auditor = (s) =>
    s
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\\([-.*_[\]()#+!`>~|])/g, "$1")
      .replace(/[*_`~]/g, "")
      .replace(/<\/?[a-z][^>]{0,200}>/gi, " ")
      .replace(/[\u2018\u2019\u201b]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
      .replace(/^[ \t]*[-+\u2022]\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  for (const s of ["  A   B\nc ", md, "**bold** and [a link](http://x)", "plain", messy]) {
    assert.equal(norm(s), auditor(s), `the two copies of the rule disagree on ${JSON.stringify(s)}`);
  }

  // A page longer than the window is read whole, and the overlap is real, or a
  // requirement that lands on a boundary is in neither half and the quote that
  // proves it never survives to be checked.
  const long = "x".repeat(100);
  assert.deepEqual(windows("short", 10, 3), ["short"]);
  assert.deepEqual(windows("abcdefghij", 4, 1), ["abcd", "defg", "ghij", "j"]);
  assert.equal(windows(long, 10, 3).length, 4, "the cap is a cap, not a suggestion");
  const w = windows("abcdefghij", 4, 1);
  for (const [i, part] of w.slice(1).entries()) {
    assert.ok(w[i].endsWith(part[0]), "consecutive windows must share a character or a sentence can fall between them");
  }

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

/**
 * Failures that mean "a browser would have seen more", as opposed to "there is
 * nothing here".
 *
 * A 404 is a 404 however you render it and a scanned PDF stays a picture, so
 * neither is ever worth a credit. These three are the ones where the plain GET
 * and the citizen's browser disagree: an app shell with no content yet, one
 * shell served for every route, and a WAF that turns away anything without a
 * JavaScript engine.
 */
const RENDERABLE = new Set(["TOO_THIN", "SOFT_404", "BLOCKED_BY_SITE"]);
const rendering = flag("render");

// Deliberately reads the negative cache past its `blockedUntil`. The backoff
// says "do not ask this host again the same way"; asking a different way is the
// whole point of the flag, and without this the 645 urls that already failed
// are exactly the ones a render pass can never reach.
const toRender = rendering
  ? readJsonl(NEGATIVE)
      .filter((r) => RENDERABLE.has(r.reason) && !pages.has(r.url) && !/\.pdf(\?|$)/i.test(r.url))
      .filter((r) => !value("host", null) || hostOf(r.url) === value("host", null))
      .map((r) => ({ url: r.url, title: null, score: 0, rerender: true }))
  : [];
// A url that failed twice is in there twice, and the second row would spend a
// second credit on the same page.
const uniqueRender = [...new Map(toRender.map((r) => [r.url, r])).values()];

/**
 * `--no-fetch` extracts over what is already cached and touches no ledger a
 * fetch owns. Fetching and extracting normally belong in one run, but a render
 * pass takes hours at the plan's eleven a minute, and re-running extraction
 * after a gate change should not have to wait behind it or fight it for
 * `.ingest/pages.jsonl`. The reverse flag, `--fetch-only`, already existed.
 */
const toFetch = flag("no-fetch")
  ? []
  : queue
      .filter((r) => !pages.has(r.url) && !blocked.has(r.url) && !/\.pdf(\?|$)/i.test(r.url))
      .concat(uniqueRender)
      .slice(0, Number(value("limit", Infinity)));

console.log(`${queue.length} discovered urls, ${pages.size} already fetched, ${blocked.size} in the negative cache, ${deferredPdf.length} pdfs deferred, ${toFetch.length} to fetch${rendering ? ` (${uniqueRender.length} of them retries through a browser)` : ""}`);

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
let credits = 0;
let rateLimited = 0;
/**
 * Tier 2. Only ever reached from a tier 1 failure this flag says is worth a
 * browser, and it either produces a page indistinguishable from a fetched one
 * or an honest reason it did not.
 */
const render = async (url, reason, detail) => {
  if (!rendering || !RENDERABLE.has(reason)) {
    newlyNegative.push(negativeRow(url, reason, now, detail));
    return null;
  }
  credits++;
  const shot = await renderPage(url);
  if (shot.failure === "OUT_OF_CREDITS") {
    console.error("out of firecrawl credits, stopping before anything is written half done");
    process.exit(3);
  }
  // Our bill and our impatience are not the page's fault, so the url keeps its
  // old negative row and comes back around on the next run. Writing "HTTP 429"
  // here retired 138 pages we had never actually looked at.
  if (shot.failure === "RATE_LIMITED") {
    rateLimited++;
    return null;
  }
  const text = String(shot.markdown ?? "").trim();
  if (!shot.ok || text.length < MIN_CHARS) {
    // The reason it failed the second time, not the first. "The browser saw an
    // empty page too" and "the plain fetch got a shell" are different findings
    // and the second one is no longer true.
    newlyNegative.push(negativeRow(url, shot.ok ? "TOO_THIN" : shot.failure ?? "EMPTY_RENDER", now, `rendered: ${shot.ok ? `${text.length} chars` : shot.failure}`));
    return null;
  }
  ok++;
  return {
    text,
    row: {
      url,
      sha1: sha1(url),
      contentHash: sha256(text),
      host: hostOf(url),
      title: shot.title || null,
      chars: text.length,
      status: shot.status ?? 200,
      tlsVerified: true,
      truncated: false,
      // Provenance says which pair of eyes saw this. A rendered page is still
      // the page's own bytes, but it is not the bytes a plain GET returns, and
      // anyone checking a quote by hand needs to know to render it too.
      rendered: true,
      score: 0,
      fetchedAt: now,
    },
  };
};

const fetched = await pool(toFetch, FETCH_CONCURRENCY, async (row) => {
  // Already known to be a shell. Skip straight to the browser instead of
  // spending a request to be told the same thing again.
  if (row.rerender) return render(row.url, "TOO_THIN", "known shell");

  const res = await fetchPage(row.url, { timeoutMs: 20_000 });
  if (!res.ok) return render(row.url, res.failure ?? "HTTP_ERROR", res.errorCode ?? null);
  // A url that ends in .html and serves a zip is a thing this estate does.
  if (res.contentType && !/text\/|xml|json/i.test(res.contentType)) {
    newlyNegative.push(negativeRow(row.url, "NOT_TEXT", now, String(res.contentType).slice(0, 60)));
    return;
  }
  const meta = htmlMeta(res.body ?? "");
  const text = toText(res.body ?? "");
  if (looksSoft404(text, meta, res.contentType)) return render(row.url, "SOFT_404", meta.title || null);
  // Not an error and not worth a model. Recorded so it is never fetched again.
  if (text.length < MIN_CHARS) return render(row.url, "TOO_THIN", `${text.length} chars`);

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

// Rewriting the page ledger with what we read at startup would erase whatever a
// concurrent fetch pass has appended since. Under `--no-fetch` we have nothing
// to say about it, so we say nothing.
if (toFetch.length) saveLedger(PAGES_LEDGER, pages);
appendJsonl(NEGATIVE, newlyNegative);
if (toFetch.length)
  console.log(`  ${ok} fetched, ${duplicates} discarded as a catch-all shell, ${newlyNegative.length} recorded as not worth asking again${credits ? `, ${credits} rendered through a browser` : ""}${rateLimited ? `, ${rateLimited} left for next run because we hit our own rate limit` : ""}`);

if (flag("fetch-only")) process.exit(0);

// ------------------------------------------------------------------ extract

const cacheKey = (contentHash, model) => sha256(`${contentHash}|${SCHEMA_VERSION}|${PROMPT_VERSION}|${GATE_VERSION}|${model}`);

/** One page through one model, cached on content plus prompt plus model id. */
async function extract(page, text, model) {
  const file = at(EXTRACT + cacheKey(page.contentHash, model) + ".json");
  if (existsSync(file)) return { ...JSON.parse(readFileSync(file, "utf8")), cached: true };

  // Markup off before the model sees it. Measured: 73% of page lines over 40
  // characters carry an emphasis marker, an escape or a link, and of 14,869
  // facts extracted while it was left on, the number whose evidence contained
  // `**` or a markdown link was zero, so the model was quoting around the
  // formatting rather than through it. `grounded` normalises both sides, so a
  // quote off the stripped text still has to be verbatim on the stored page.
  const parts = windows(unmark(text));
  const replies = await pool(parts, 2, (part, i) =>
    chat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(page.url, page.title, part) + (parts.length > 1 ? `\n\n(Part ${i + 1} of ${parts.length} of this page.)` : "") },
      ],
      { model, maxTokens: 4000 },
    ),
  );

  const raw = replies.some(Boolean) ? replies.flatMap((r) => (r ? (jsonArray(r.text) ?? []) : [])) : null;
  const facts = [];
  const seen = new Set();
  /**
   * What the gate threw away, and why, in the words the model used.
   *
   * This was a counter. 2,309 facts had been rejected corpus wide and not one of
   * them could be looked at again without paying for the model a second time,
   * which means the single gate the entire product rests on was being trusted on
   * faith. It lives in the cache file rather than a ledger of its own because
   * the cache key already says exactly which extractor and which gate produced
   * it, so a re-read replaces the drops along with the facts and the two can
   * never describe different runs.
   */
  const dropped = [];
  const drop = (reason, f, note) =>
    dropped.push({ reason, kind: typeof f?.kind === "string" ? f.kind.slice(0, 40) : null, claim: String(f?.claim ?? "").slice(0, 200), evidence: String(f?.evidence ?? "").slice(0, 200), ...(note ? { note } : {}) });

  for (const f of raw ?? []) {
    if (!f || typeof f !== "object") {
      drop("INVALID_SCHEMA", f, "not an object");
      continue;
    }
    const kind = typeof f.kind === "string" ? f.kind.toUpperCase().trim() : "";
    // The two gates, in order of how much they matter. A kind we do not have is
    // a schema the model invented; evidence not on the page is a fact it did.
    if (!KINDS.includes(kind)) {
      drop("UNSUPPORTED_KIND", f);
      continue;
    }
    if (!grounded(f.evidence, text)) {
      // The two ways a quote fails are not the same mistake and were counted as
      // one. Too short is a model answering with a word; not found is a model
      // writing a sentence the page never printed, and only the second is the
      // fabrication this gate exists to stop.
      drop("EVIDENCE_NOT_VERBATIM", f, norm(String(f.evidence ?? "")).length < 12 ? "shorter than a quote" : "not on the page");
      continue;
    }
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
      drop("DUPLICATE", row);
      continue;
    }
    seen.add(key);
    facts.push(row);
  }

  const result = { url: page.url, contentHash: page.contentHash, model, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, extractedAt: now, reachedModel: raw !== null, windows: parts.length, truncatedChars: Math.max(0, unmark(text).length - (parts.at(-1)?.length ?? 0) - (parts.length - 1) * (MAX_CHARS - WINDOW_OVERLAP)), facts, dropped };
  // Written even when it found nothing. "This page states no citizen facts" is
  // a real and common answer and paying to rediscover it would be silly.
  writeFileSync(file, JSON.stringify(result, null, 1));
  return { ...result, cached: false };
}

/**
 * Pages no model has ever read, at any version of the prompt or the gate.
 *
 * Not the same question as the cache key, which asks "was this page read by
 * *this* extractor". Bumping the gate invalidates all 2,713 by construction,
 * which is correct and costs fourteen hours, and almost all of it buys nothing:
 * a re-read only changes the answer for pages the old extractor could not see
 * properly. A page that has never been read at all is the opposite case, and
 * it is the one a fresh render pass creates by the hundred.
 *
 * Each cache file records the version that wrote it, so a mixed cache stays
 * honest about what produced what.
 */
const everRead = new Set();
if (flag("new-only")) {
  for (const f of readdirSync(at(EXTRACT))) {
    const r = JSON.parse(readFileSync(at(EXTRACT + f), "utf8"));
    everRead.add(`${r.url}|${r.contentHash}`);
  }
}

// `--min-chars` picks the long pages, which are a different population to the
// high scoring ones and the only place the windowing above can show up at all.
const toExtract = [...pages.values()]
  .filter((p) => (p.chars ?? 0) >= Number(value("min-chars", 0)))
  .filter((p) => !flag("new-only") || !everRead.has(`${p.url}|${p.contentHash}`))
  .sort((a, b) => b.score - a.score)
  .slice(0, Number(value("limit", Infinity)));
console.log(`\n${toExtract.length} cached pages to extract from`);

/**
 * How many candidates a cached extraction threw away.
 *
 * Entries written before the drops were kept hold a number here instead of the
 * rows. Both are counted, so the totals stay comparable across a mixed cache,
 * and `rejections:stats` is the one that says how much of it is auditable.
 */
export const droppedCount = (r) => (Array.isArray(r?.dropped) ? r.dropped.length : Number(r?.dropped ?? 0));

const stats = { cached: 0, calls: 0, dropped: 0, unaudited: 0, escalated: 0, unreachable: 0 };
const results = await pool(toExtract, MODEL_CONCURRENCY, async (page) => {
  const text = readFileSync(at(PAGES + page.sha1 + ".md"), "utf8");
  let out = await extract(page, text, MODELS.tier1);
  if (out.cached) stats.cached++;
  else stats.calls++;
  if (!out.reachedModel) stats.unreachable++;
  stats.dropped += droppedCount(out);
  if (!Array.isArray(out.dropped)) stats.unaudited++;

  // Tier 2, once, and only for a page that scored well and gave Tier 1 nothing
  // it could ground. Never a blind rerun: a page that genuinely states no facts
  // will state no facts to the expensive model too.
  if (out.reachedModel && !out.facts.length && page.score >= ESCALATE_ABOVE) {
    const strong = await extract(page, text, MODELS.tier2);
    if (!strong.cached) stats.calls++;
    stats.dropped += droppedCount(strong);
    if (!Array.isArray(strong.dropped)) stats.unaudited++;
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
appendJsonl(".ingest/runs.jsonl", [{ run: "services:extract", at: now, fetched: ok, pages: toExtract.length, modelCalls: stats.calls, cacheHits: stats.cached, facts: facts.length, droppedCandidates: stats.dropped, escalatedToTier2: stats.escalated }]);

const withFacts = results.filter((r) => r?.facts.length).length;
console.log(`\n${stats.calls} model calls, ${stats.cached} cache hits, ${stats.escalated} escalated to ${MODELS.tier2}`);
if (stats.unreachable) console.log(`  ${stats.unreachable} page(s) the model never answered for`);
console.log(`${facts.length} grounded facts from ${withFacts} of ${toExtract.length} pages`);
console.log(`${stats.dropped} candidate(s) dropped. That number going to zero would be more worrying than it going up.`);
if (stats.unaudited) console.log(`  ${stats.unaudited} page(s) were read before the drops were kept, so theirs are a count and nothing else. Run: pnpm rejections:stats`);
console.log(`\n.ingest/facts.jsonl written.`);
