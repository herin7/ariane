/**
 * The 925 PDFs the pipeline has been walking past since it started.
 *
 *   pnpm pdf:extract                 # fetch, parse, shortlist, emit page units
 *   pnpm pdf:extract --limit 50
 *   pnpm pdf:extract --host x.gov.in
 *   pnpm pdf:extract --fetch-only    # fill the byte and text caches, emit nothing
 *   pnpm pdf:extract --selftest
 *
 * Gujarat publishes its GRs, fee schedules, scheme rules, office annexures and
 * document checklists as PDFs. `services:extract` skipped every one of them with
 * `NOT_TEXT, pdf, no reader built`, which was the honest thing to record and the
 * largest single body of unread evidence we had.
 *
 * ------------------------------------------------------------------------
 * THE SHAPE, AND WHY IT IS NOT A NEW PIPELINE
 *
 * A PDF page comes out of here as an ordinary page in the ordinary page ledger,
 * under the url the PDF already has plus the fragment that opens that page:
 *
 *     https://x.gov.in/scheme.pdf#page=7
 *
 * That is a real fragment. A browser and every PDF viewer honour it, so the
 * citation a citizen clicks lands on the page the quote came from, and
 * `services:extract`, `services:compile`, `quotes:audit` and the fetch ledger
 * all keep working with no change at all. There is no parallel PDF graph, no
 * second extractor and no second provenance vocabulary. There is one more kind
 * of page.
 *
 * Three caches, as everywhere else, because they fail for different reasons:
 *
 *   .ingest/pdf/<sha1(url)>.pdf        the bytes, gitignored, sha256 in the ledger
 *   .ingest/pdftext/<sha1(url)>.json   page preserving text, committed
 *   .ingest/pdfs.jsonl                 url -> sha256, bytes, pages, chars, when
 *   .ingest/pages/<sha1(url#page=N)>.md   the page unit the model actually reads
 *
 * The bytes are the one thing not committed. A 925 file PDF corpus is hundreds
 * of megabytes and the text extracted from it is the thing every quote is
 * checked against, so committing the text and pinning the bytes by sha256 keeps
 * every guarantee and none of the weight. Refetching one is a single GET that
 * nobody will ever need to make.
 * ------------------------------------------------------------------------
 *
 * Cheapest first, as always. Nothing here calls a model. Page selection is a
 * keyword score, and the model only ever sees a page that scored, through the
 * extractor that already exists and already throws away anything it cannot
 * quote off the page.
 */

import { appendJsonl, at, fetchBytes, hostOf, ledger, loadNegative, NEGATIVE, negativeRow, pool, readJsonl, saveLedger, sha1, sha256 } from "./lib.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PDF_BYTES = ".ingest/pdf/";
const PDF_TEXT = ".ingest/pdftext/";
const PDFS_LEDGER = ".ingest/pdfs.jsonl";
const PAGES = ".ingest/pages/";
const PAGES_LEDGER = ".ingest/pages.jsonl";

/** Bump and every PDF is parsed again from bytes we already hold. */
const TEXT_VERSION = 1;

const FETCH_CONCURRENCY = 6;
/** A page under this is a header, a footer and a page number. */
const MIN_PAGE_CHARS = 220;
/** Whole file under this and the PDF is scanned images, not text. */
const MIN_DOC_CHARS = 400;
/** No PDF gets to contribute more than this many pages to the queue. */
const MAX_PAGES_PER_PDF = 12;
/** A 40MB annexure is a scan. We are not paying for it. */
const MAX_BYTES = 40_000_000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// ------------------------------------------------------------------- scoring

/**
 * What a page has to be about before a model is allowed to read it.
 *
 * Weighted because they are not equally load bearing. "documents required" is
 * the thing a citizen needs and is almost never on a page about something else;
 * "office" and "district" appear in the letterhead of every government PDF ever
 * written and score one each so that a page needs several of them to clear.
 *
 * Gujarati alongside English because half this corpus is Gujarati and a
 * requirement list in Gujarati is exactly as useful as one in English.
 */
const SIGNALS = [
  [4, /\b(documents?\s+required|required\s+documents?|list\s+of\s+documents?|enclosures?)\b/i],
  [4, /\b(eligibility|eligible|qualifying\s+criteria|who\s+can\s+apply)\b/i],
  [4, /\b(application\s+(procedure|process)|how\s+to\s+apply|procedure\s+for\s+applying|step\s*[-\s]?\d)\b/i],
  [3, /\b(fee|fees|charges|rate\s+of|amount\s+payable|rs\.?\s*\d)\b/i],
  [3, /\b(income\s+limit|age\s+limit|annual\s+income|below\s+poverty)\b/i],
  [3, /\b(scheme\s+guidelines?|resolution|circular|annexure|schedule\s+[ivx]+)\b/i],
  [3, /\b(verification|scrutiny|sanction|selection|approval|renewal)\b/i],
  [2, /\b(helpline|toll\s*free|grievance|contact\s+(us|number)|email)\b/i],
  [2, /\b(certificate|licence|license|permit|registration|subsidy|assistance|pension|scholarship)\b/i],
  [1, /\b(office|mamlatdar|collector|taluka|district|municipal|department)\b/i],
  [4, /(જરૂરી\s*દસ્તાવેજ|આધાર\s*પુરાવા|સાધનિક\s*કાગળો)/],
  [4, /(પાત્રતા|લાયકાત|યોગ્યતા)/],
  [3, /(અરજી\s*કરવાની|અરજી\s*પ્રક્રિયા|પ્રક્રિયા)/],
  [3, /(સહાય|યોજના|ઠરાવ|પરિપત્ર)/],
  [2, /(ફી|રકમ|દર)/],
];

/** Things that mean the page is real but is not about getting a service done. */
const AGAINST = [
  [6, /\b(tender|e-?tender|bid\s+document|quotation|corrigendum)\b/i],
  [5, /\b(minutes\s+of\s+the\s+meeting|agenda|committee\s+members?|board\s+of\s+directors)\b/i],
  [5, /\b(annual\s+report|audit\s+report|balance\s+sheet|budget\s+estimate)\b/i],
  [4, /\b(merit\s+list|result|seniority\s+list|roll\s+number|admit\s+card|answer\s+key)\b/i],
  [4, /\b(press\s+note|news\s*letter|photo\s+gallery|speech)\b/i],
  [3, /\b(recruitment|vacanc|advertisement\s+no|syllabus|exam\s+schedule)\b/i],
];

/**
 * How much a page is worth reading. Deterministic, no model, no network.
 *
 * A signal counts once. Without that, a fee schedule listing "Rs." four hundred
 * times outscores a page that states the eligibility, the documents and the fee
 * once each, which is exactly backwards: repetition is a table, variety is an
 * explanation, and it is the explanation a citizen is missing.
 */
export function scorePage(text) {
  if (!text || text.length < MIN_PAGE_CHARS) return 0;
  let score = 0;
  for (const [weight, re] of SIGNALS) if (re.test(text)) score += weight;
  for (const [weight, re] of AGAINST) if (re.test(text)) score -= weight;
  return score;
}

/** Clears this and a model is allowed to read the page. Below it, nobody is. */
const KEEP_ABOVE = 5;

/**
 * PDF text as something the extractor can quote from.
 *
 * pdfjs hands back a run per text item and a government PDF is mostly tables, so
 * raw output is one word per line and any quote spanning a cell is unfindable.
 * Joined and re-wrapped on the line breaks it actually has.
 */
export function tidyPdfText(raw) {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, a) => l.length > 0 && !(l === a[i - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The url of one page inside a PDF. A real fragment, honoured by viewers. */
export const pageUrl = (url, page) => `${url}#page=${page}`;

// ----------------------------------------------------------------- self test

if (flag("selftest")) {
  const { strict: assert } = await import("node:assert");

  const good =
    "Documents Required for the Income Certificate\nRation card, Aadhaar card, light bill, school leaving certificate.\n" +
    "Eligibility: the applicant must be a resident of the district and the annual income must not exceed the prescribed limit.\n" +
    "The fee is Rs. 20 and the application is made at the Mamlatdar office of the taluka.";
  const tender =
    "Tender Document for supply of stationery to the District Collector office, Ahmedabad.\n" +
    "Bid document may be downloaded from the website. Corrigendum no 2 applies to this tender.\n" +
    "The quotation format is attached herewith for the information of intending bidders and agencies.";
  assert.ok(scorePage(good) > KEEP_ABOVE, `a documents page must clear the bar, scored ${scorePage(good)}`);
  assert.ok(scorePage(tender) < KEEP_ABOVE, `a tender must not, scored ${scorePage(tender)}`);
  assert.equal(scorePage("Page 3 of 40"), 0, "a page number is not a page");
  assert.equal(scorePage(""), 0);

  // Repetition is a table, variety is an explanation. The explanation wins.
  const table = "Rs. 20 per copy for the year\n".repeat(20) + "Rate of fee charges amount payable";
  assert.ok(scorePage(good) > scorePage(table), "a page of one repeated signal must not beat a page of several");

  const gujarati =
    "જરૂરી દસ્તાવેજ: રેશન કાર્ડ, આધાર કાર્ડ, વીજળી બિલ અને શાળા છોડ્યાનું પ્રમાણપત્ર.\n" +
    "પાત્રતા માટે અરજદાર જિલ્લાનો રહેવાસી હોવો જોઈએ અને વાર્ષિક આવક મર્યાદામાં હોવી જોઈએ.\n" +
    "અરજી કરવાની પ્રક્રિયા નીચે મુજબ છે. સહાય યોજના હેઠળ ફી ભરવાની રહેશે અને કચેરીમાં જમા કરાવવાનું રહેશે.";
  assert.ok(scorePage(gujarati) > KEEP_ABOVE, `Gujarati requirements count too, scored ${scorePage(gujarati)}`);

  assert.equal(tidyPdfText("a  \n\n\n b \r\n b \n"), "a\nb", "collapsed, trimmed, blank and duplicate lines dropped");
  assert.equal(pageUrl("https://x.gov.in/a.pdf", 7), "https://x.gov.in/a.pdf#page=7");

  console.log("pdf-extract: ok");
  process.exit(0);
}

// -------------------------------------------------------------------- queue

const now = new Date().toISOString();
mkdirSync(at(PDF_BYTES), { recursive: true });
mkdirSync(at(PDF_TEXT), { recursive: true });
mkdirSync(at(PAGES), { recursive: true });

const isPdf = (url) => /\.pdf(\?|#|$)/i.test(url);
const done = ledger(PDFS_LEDGER, "url");
const blocked = loadNegative(now);

/**
 * Where the PDFs are.
 *
 * `negative.jsonl` is the authoritative list: every one of them was discovered,
 * scored, queued and then written off with `NOT_TEXT, pdf, no reader built`, so
 * the reason we skipped them is also the record of which ones they were.
 * `urls.jsonl` is checked too because it is where new ones will arrive, and it
 * is gitignored, so on a clone the negative cache is the only copy.
 */
const seen = new Map();
for (const r of readJsonl(".ingest/urls.jsonl")) if (isPdf(r.url) && r.state === "DISCOVERED") seen.set(r.url, r.score ?? 0);
for (const r of readJsonl(NEGATIVE)) if (isPdf(r.url) && r.reason === "NOT_TEXT" && !seen.has(r.url)) seen.set(r.url, 0);

const host = value("host", null);
const queue = [...seen.entries()]
  .filter(([url]) => !done.has(url))
  .filter(([url]) => !host || hostOf(url) === host)
  // A url blocked for any reason other than "we had no pdf reader" stays blocked.
  // NOT_TEXT is the row this pass exists to answer; a 404 or a block is not.
  .filter(([url]) => (blocked.get(url)?.reason ?? "NOT_TEXT") === "NOT_TEXT")
  .sort((a, b) => b[1] - a[1])
  .slice(0, Number(value("limit", Infinity)))
  .map(([url, score]) => ({ url, score }));

console.log(`${seen.size} pdf urls known, ${done.size} already parsed, ${queue.length} to do`);

// --------------------------------------------------------------- fetch, parse

const { extractText, getDocumentProxy } = await import("unpdf");

const newlyNegative = [];
let bytesTotal = 0;

async function take({ url, score }) {
  const key = sha1(url);
  const file = at(PDF_BYTES + key + ".pdf");

  let buf;
  let tlsVerified = true;
  if (existsSync(file)) {
    buf = readFileSync(file);
    tlsVerified = done.get(url)?.tlsVerified !== false;
  } else {
    const res = await fetchBytes(url, { timeoutMs: 60_000, maxBytes: MAX_BYTES });
    if (!res.ok) {
      newlyNegative.push(negativeRow(url, res.failure ?? "HTTP_ERROR", now, res.errorCode ?? null));
      return null;
    }
    buf = res.body;
    // A .pdf that serves an html error page is a thing this estate does, and it
    // is the one failure that would otherwise reach a model as evidence.
    if (!buf || buf.length < 1000 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      newlyNegative.push(negativeRow(url, "NOT_TEXT", now, `not a pdf, starts "${buf.subarray(0, 12).toString("latin1").replace(/[^\x20-\x7e]/g, ".")}"`));
      return null;
    }
    if (res.truncated) {
      newlyNegative.push(negativeRow(url, "NOT_TEXT", now, `over ${MAX_BYTES} bytes`));
      return null;
    }
    writeFileSync(file, buf);
    tlsVerified = res.tlsVerified !== false;
  }
  bytesTotal += buf.length;

  const textFile = at(PDF_TEXT + key + ".json");
  if (existsSync(textFile)) {
    const cached = JSON.parse(readFileSync(textFile, "utf8"));
    if (cached.textVersion === TEXT_VERSION) return { ...cached, score, cached: true };
  }

  let pages;
  try {
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(doc, { mergePages: false });
    pages = text.map((t, i) => ({ page: i + 1, text: tidyPdfText(t) }));
  } catch (e) {
    // Encrypted, malformed, or a version pdfjs will not open. Recorded, not
    // retried, and not guessed at.
    newlyNegative.push(negativeRow(url, "NOT_TEXT", now, `pdf unreadable: ${String(e.message ?? e).slice(0, 80)}`));
    return null;
  }

  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars < MIN_DOC_CHARS) {
    // Real, opened fine, and holds no text: it is a scan. OCR is the answer and
    // we have not built one, so it is recorded as exactly that rather than as a
    // PDF we read and found nothing in.
    newlyNegative.push(negativeRow(url, "SCANNED_PDF", now, `${pages.length} page(s), ${chars} chars of text, needs ocr`));
    return null;
  }

  const out = {
    url,
    sha1: key,
    sha256: sha256(buf),
    bytes: buf.length,
    contentType: "application/pdf",
    pageCount: pages.length,
    chars,
    textVersion: TEXT_VERSION,
    tlsVerified,
    fetchedAt: now,
    pages,
  };
  writeFileSync(textFile, JSON.stringify(out, null, 1));
  return { ...out, score, cached: false };
}

let did = 0;
const parsed = (await pool(queue, FETCH_CONCURRENCY, async (row) => {
  const got = await take(row);
  if (++did % 25 === 0) console.log(`  ${did}/${queue.length}`);
  return got;
})).filter(Boolean);

for (const p of parsed) {
  const { pages, score, cached, ...meta } = p;
  done.set(p.url, meta);
}
saveLedger(PDFS_LEDGER, done);
appendJsonl(NEGATIVE, newlyNegative);

console.log(`\n${parsed.length} pdf(s) parsed, ${newlyNegative.length} recorded as not worth asking again`);
if (parsed.length) console.log(`  ${parsed.reduce((n, p) => n + p.pageCount, 0)} pages, ${(bytesTotal / 1e6).toFixed(1)}MB of bytes cached`);

if (flag("fetch-only")) process.exit(0);

// ------------------------------------------------------- emit the page units

/**
 * Every page that scored becomes an ordinary row in the ordinary page ledger.
 *
 * From here nothing in the pipeline knows or cares that this came out of a PDF.
 * `services:extract` reads pages.jsonl and will extract from these on its next
 * run, `services:compile` will cite them, `quotes:audit` will check every quote
 * against the .md file written here, and the url a citizen clicks opens the PDF
 * at the page the quote is on.
 */
const pages = ledger(PAGES_LEDGER, "url");
const all = [...done.values()];

let emitted = 0;
let skippedLowScore = 0;
let capped = 0;

for (const pdf of all) {
  const textFile = at(PDF_TEXT + pdf.sha1 + ".json");
  if (!existsSync(textFile)) continue;
  const doc = JSON.parse(readFileSync(textFile, "utf8"));

  const scored = doc.pages
    .map((p) => ({ ...p, score: scorePage(p.text) }))
    .filter((p) => p.score > KEEP_ABOVE);
  skippedLowScore += doc.pages.length - scored.length;

  const keep = scored.sort((a, b) => b.score - a.score).slice(0, MAX_PAGES_PER_PDF);
  capped += scored.length - keep.length;

  // Back into reading order. A model shown page 9 then page 3 will narrate the
  // process backwards, and the page number in the citation is the only thing
  // that makes a PDF quote checkable.
  for (const p of keep.sort((a, b) => a.page - b.page)) {
    const url = pageUrl(pdf.url, p.page);
    if (pages.has(url)) continue;
    const key = sha1(url);
    writeFileSync(at(PAGES + key + ".md"), p.text);
    pages.set(url, {
      url,
      sha1: key,
      contentHash: sha256(p.text),
      host: hostOf(pdf.url),
      title: `${pdf.url.split("/").pop()?.replace(/\.pdf.*$/i, "") ?? "pdf"} (page ${p.page} of ${pdf.pageCount})`,
      chars: p.text.length,
      status: 200,
      tlsVerified: pdf.tlsVerified !== false,
      truncated: false,
      // Carried so `services:compile` can say a fact came off page 7 of a PDF
      // and not off a web page that happens to end in .pdf.
      pdf: { source: pdf.url, page: p.page, of: pdf.pageCount, sha256: pdf.sha256 },
      score: p.score,
      fetchedAt: pdf.fetchedAt,
    });
    emitted++;
  }
}

saveLedger(PAGES_LEDGER, pages);
appendJsonl(".ingest/runs.jsonl", [{ run: "pdf:extract", at: now, queued: queue.length, parsed: parsed.length, pdfsHeld: done.size, pagesEmitted: emitted, negative: newlyNegative.length }]);

console.log(`\n${emitted} page unit(s) added to the page ledger`);
console.log(`  ${skippedLowScore} page(s) scored too low to be worth a model, ${capped} dropped by the ${MAX_PAGES_PER_PDF} page cap`);
console.log(`\nRun pnpm services:extract next. It reads pages.jsonl and does not need to know these came out of a pdf.`);
