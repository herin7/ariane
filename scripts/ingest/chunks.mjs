/**
 * A page, cut into the pieces a retriever can hand back.
 *
 *   pnpm corpus:chunk           cut every cached page, write .ingest/chunks.jsonl
 *   pnpm corpus:chunk --stats   measure the cut without writing anything
 *
 * Why this exists: 279 offices in the last compile had a name and no address,
 * because the name is on the service page and the address is on the contact
 * page and nothing joins them. Joining them means searching the corpus, and
 * searching the corpus means having something smaller than a page to return.
 * A 6,000 character page is not an answer to "where do I go".
 *
 * §7 says structure aware, not blind 1000 character splits, and it is right,
 * but the structure has to actually be there. Measured before writing a line:
 * of 2,713 cached pages, 286 have a markdown heading, 514 have a bullet list
 * and 80 have a table. Nine in ten of these pages are `toText` output off an
 * HTML government site, which means the only structure left is blank lines and
 * lines that look like labels. So the cut is: real headings where a page has
 * them, label lines and blank lines where it does not, and a line boundary as
 * the last resort. Never a character count alone.
 *
 * The invariant that matters more than any of that: **a chunk is a slice**.
 * `text === page.slice(start, end)`, character for character, always. The
 * substring gate is the whole product, and a chunk that has been tidied,
 * dedented or had its bullets stripped is a chunk whose quotes no longer
 * appear on the page they claim to come from. Contextualisation for retrieval
 * happens in `searchText`, which is a separate field and never the evidence.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { at, INGEST, readJsonl, sha1, writeJsonl } from "./lib.mjs";

export const CHUNKS = INGEST + "chunks.jsonl";

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/**
 * Whether this file was run or imported.
 *
 * Both the selftest and the corpus pass hang off it, and neither may fire on
 * import. `corpus.mjs` imports `CHUNKS` from here, so a bare `process.exit` at
 * this level takes the importer down with it; and `flag("selftest")` is true
 * for anything the *parent* was invoked with, which is how running the corpus
 * selftest came to print "chunks: ok" and stop before testing anything.
 */
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

/**
 * How big a chunk is allowed to get before we cut it somewhere less natural.
 *
 * 1,500 characters is roughly a screen, which is roughly what a reranker can
 * judge and a person can check. The floor exists because a heading on its own
 * is not a passage: "Required Documents" retrieves beautifully and tells the
 * citizen nothing, so a short block is glued to what follows it rather than
 * indexed as its own answer.
 */
const MAX = 1500;
const MIN = 200;

/** One unbroken token this long is a data URI, a hash or a minified script. */
const JUNK = /\S{200,}/;

/** A markdown heading, the only unambiguous section boundary in this corpus. */
const MD_HEADING = /^#{1,6}\s+\S/;
/** A whole line in bold, which is what a CMS emits when it meant a heading. */
const BOLD_LINE = /^\*\*[^*]{2,90}\*\*:?$/;
/** "Step 3", "3.", "(iv)" at the start of a line: a numbered process section. */
const STEP_LINE = /^\s*(?:step\s*[-:.]?\s*\d{1,2}\b|\d{1,2}\s*[).]\s+\S|\(\s*[ivx]{1,4}\s*\))/i;
/** A question, which is where an FAQ divides. */
const FAQ_LINE = /^\s*(?:q\s*[-.:)]|\d{1,2}\s*\.\s*)?[^?\n]{10,140}\?\s*$/i;
/** A table row. Consecutive ones are one unit and must not be split apart. */
const TABLE_ROW = /^\s*\|.*\|\s*$/;

/**
 * A line that reads as a label for what comes after it.
 *
 * The workhorse on this estate, because the heading tags did not survive the
 * conversion to text. Short, no sentence-ending punctuation, and either ends in
 * a colon or is title case. Deliberately conservative: a false heading costs a
 * chunk boundary in a slightly wrong place, and a missed one costs nothing at
 * all because the blank line rules still apply.
 */
export function looksLikeHeading(line) {
  const s = String(line ?? "").trim();
  if (!s || s.length > 90) return false;
  if (MD_HEADING.test(s) || BOLD_LINE.test(s)) return true;
  if (/[.!?,;]$/.test(s)) return false;
  if (s.split(/\s+/).length > 12) return false;
  if (/:$/.test(s) && s.length > 3) return true;
  // Title Case Like This, with at least two words, and not a bullet.
  return /^[A-Z઀-૿]/.test(s) && s.split(/\s+/).length >= 2 && !/^[-*•]/.test(s);
}

/** The heading text without its markup, for the contextualised search string. */
export const headingText = (line) =>
  String(line ?? "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*|\*\*:?$/g, "")
    .replace(/:$/, "")
    .trim()
    .slice(0, 120);

/**
 * Cut one page into chunks, each an exact slice of the input.
 *
 * Walks lines, opens a new chunk at a structural boundary, and closes the
 * current one when it would outgrow `max`. Offsets are tracked as we go rather
 * than recovered afterwards with indexOf, because a page that repeats a line
 * (and every one of these repeats its navigation) would have indexOf pointing
 * every copy at the first.
 */
export function cut(text, { max = MAX, min = MIN } = {}) {
  const page = String(text ?? "");
  if (!page.trim()) return [];

  const lines = page.split("\n");
  /** Character offset of the start of each line, including its newline. */
  const offset = [];
  let running = 0;
  for (const line of lines) {
    offset.push(running);
    running += line.length + 1;
  }

  const out = [];
  let start = 0;
  let heading = null;
  /** The heading that opened the chunk currently being built. */
  let openHeading = null;

  const close = (end) => {
    const slice = page.slice(start, end);
    if (slice.trim()) out.push({ start, end, text: slice, heading: openHeading });
    start = end;
    openHeading = heading;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const here = offset[i];
    const grown = here - start;

    // A table is one unit. Splitting a row off its header makes a chunk of
    // numbers with nothing saying what they count.
    const inTable = TABLE_ROW.test(line) && i > 0 && TABLE_ROW.test(lines[i - 1] ?? "");

    const structural =
      !inTable &&
      (MD_HEADING.test(line) ||
        BOLD_LINE.test(line) ||
        STEP_LINE.test(line) ||
        FAQ_LINE.test(line) ||
        (looksLikeHeading(line) && (lines[i + 1] ?? "").trim().length > line.trim().length));

    if (structural) {
      // The floor. A heading immediately after a heading is a menu, and cutting
      // between them yields two chunks of three words each.
      if (grown >= min) close(here);
      heading = headingText(line);
      // The chunk being built is labelled by the newest heading only while it
      // is still empty. A sub-heading that arrives mid-passage does not rename
      // the passage it is buried in.
      if (!page.slice(start, here).trim()) openHeading = heading;
      continue;
    }

    // Blank line, and we are already big enough to be a passage.
    if (!line.trim() && grown >= max * 0.6 && !inTable) {
      close(here);
      continue;
    }

    // Last resort: this line would take us past the ceiling, so cut before it.
    // Still a line boundary, never mid-sentence.
    if (grown >= max && !inTable) close(here);

    // And the last resort's last resort: one line longer than the ceiling, so
    // there is no boundary left to prefer. Cut it into ceiling sized pieces so
    // a chunk stays a bounded thing. Still exact slices, so a quote spanning
    // the cut simply will not be found, which is the safe direction to fail.
    if (line.length > max) {
      for (let mark = here + max; mark < here + line.length; mark += max) close(mark);
    }
  }
  close(page.length);

  // Glue a runt onto its neighbour rather than index it. Backwards, so a short
  // tail joins what it was the tail of.
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i].text.trim().length >= min) continue;
    const prev = out[i - 1];
    if (prev.text.length + out[i].text.length > max * 1.5) continue;
    prev.end = out[i].end;
    prev.text = page.slice(prev.start, prev.end);
    out.splice(i, 1);
  }

  // A page that is one 790,000 character base64 image on a single line is not
  // a passage, and gsphc.gujarat.gov.in is exactly that. Real government prose
  // never has a two hundred character word, so that is the test: it costs one
  // regex and it does not need a list of hosts to keep up to date.
  return out.filter((c) => !JUNK.test(c.text));
}

/** One page's chunks, with the provenance that makes them citable. */
export function chunksOf(page, text) {
  const url = page.url;
  const hash = /#page=(\d+)$/.exec(url);
  return cut(text).map((c, i) => ({
    id: `chunk:${page.sha1.slice(0, 12)}_${i}`,
    sourceId: `src:${sha1(url).slice(0, 12)}`,
    url,
    host: page.host,
    sha1: page.sha1,
    contentHash: page.contentHash,
    ...(hash ? { pageNumber: Number(hash[1]) } : {}),
    heading: c.heading,
    start: c.start,
    end: c.end,
    text: c.text,
  }));
}

// ------------------------------------------------------------------ selftest

if (isMain && flag("selftest")) {
  const { default: assert } = await import("node:assert/strict");

  // The invariant. Everything else is a preference; this one is the product.
  const page = [
    "## Required Documents",
    "- Aadhaar card",
    "- Ration card",
    "",
    "## How to apply",
    "Step 1: Visit the Jan Seva Kendra with the documents listed above and fill in the form provided at the counter.",
    "Step 2: Pay the prescribed fee of Rs 20 at the cash counter and collect the receipt for your records.",
  ].join("\n");
  const got = cut(page, { max: 120, min: 20 });
  assert.ok(got.length >= 3, "a page with headings and steps is more than one chunk");
  for (const c of got) assert.equal(c.text, page.slice(c.start, c.end), "a chunk is a slice of the page, never a tidied copy");
  assert.equal(got.map((c) => c.text).join(""), page, "the chunks cover the page exactly once, with no gap and no overlap");
  assert.equal(got[0].heading, "Required Documents");
  assert.ok(got.some((c) => c.heading === "How to apply"));

  // A runt is glued, not indexed. "Fees" on its own retrieves for every query
  // about money and answers none of them.
  const runty = cut("## Fee Details\n" + "twenty rupees ".repeat(30), { max: 1500, min: 200 });
  assert.equal(runty.length, 1, "a heading with nothing under it is not a passage of its own");

  // A table stays whole.
  const table = ["Fee table", "| Service | Fee |", "| --- | --- |", "| Income certificate | Rs 20 |", "| Caste certificate | Rs 20 |"].join("\n");
  assert.equal(cut(table, { max: 30, min: 5 }).filter((c) => /\|/.test(c.text)).length, 1, "a table is one unit, however far past the ceiling it runs");

  assert.deepEqual(cut(""), [], "an empty page has no chunks, not one empty one");
  assert.deepEqual(cut("   \n\n  "), [], "and neither does a blank one");

  assert.ok(looksLikeHeading("Required Documents:"));
  assert.ok(looksLikeHeading("## Eligibility"));
  assert.ok(!looksLikeHeading("The applicant must be a resident of Gujarat."), "a sentence is not a heading, whatever its capitals");
  assert.ok(!looksLikeHeading("- Aadhaar card"), "a bullet is a member, not a label");
  assert.equal(headingText("**Required Documents**"), "Required Documents");

  console.log("chunks: ok");
  process.exit(0);
}

// --------------------------------------------------------------------- chunk
//
// A block rather than an early return, because a module cannot return and an
// early `process.exit` at this level would take the importer down with it.
// services-compile.mjs runs its whole pipeline on import and one of those is
// enough.

if (isMain) {
const pages = readJsonl(".ingest/pages.jsonl").filter((p) => p.sha1);
const limit = Number(value("limit", pages.length));

const rows = [];
let read = 0;
let missing = 0;
for (const page of pages.slice(0, limit)) {
  const file = at(`.ingest/pages/${page.sha1}.md`);
  if (!existsSync(file)) {
    missing++;
    continue;
  }
  read++;
  const text = readFileSync(file, "utf8");
  const cuts = chunksOf(page, text);
  // The invariant, checked on the real corpus and not only on the fixture.
  // It costs one slice per chunk and it is the difference between a retriever
  // and a paraphraser. A chunk that is not a slice cannot be quoted, and a
  // quote that is not on the page is the one thing this product forbids.
  for (const c of cuts) {
    if (c.text !== text.slice(c.start, c.end)) throw new Error(`${c.id} is not a slice of ${page.url}`);
  }
  rows.push(...cuts);
}

const lengths = rows.map((r) => r.text.length).sort((a, b) => a - b);
const at_ = (q) => lengths[Math.floor(lengths.length * q)] ?? 0;
console.log(`${read} page(s) cut into ${rows.length} chunk(s), ${(rows.length / (read || 1)).toFixed(1)} per page`);
console.log(`  length: p50 ${at_(0.5)}, p90 ${at_(0.9)}, p99 ${at_(0.99)}, max ${lengths.at(-1) ?? 0}`);
console.log(`  ${rows.filter((r) => r.heading).length} chunk(s) sit under a heading we could name`);
if (missing) console.log(`  ${missing} page(s) in the ledger have no cached file`);

if (!flag("stats")) {
  writeJsonl(CHUNKS, rows);
  console.log(`\nWritten to ${CHUNKS}. Next: pnpm corpus:index`);
}
}
