/**
 * Fetch an explicit list of urls into the page cache.
 *
 *   node scripts/ingest/fetch-urls.mjs urls.txt        # one url per line
 *   node scripts/ingest/fetch-urls.mjs --render u1 u2  # allow the browser
 *   node scripts/ingest/fetch-urls.mjs --selftest
 *
 * `services:extract` works from the discovery queue, which is the right shape
 * for 32,000 urls off 468 mapped hosts and the wrong shape for the nine pages
 * a hand written bundle cites. `central-services` is hand written by design -
 * `services-compile.mjs` refuses to emit over it - so the pages behind it need
 * a door of their own, and hand editing `urls.jsonl` to open one is how you end
 * up with a queue nobody can reproduce.
 *
 * Same cache, same ledger, same row shape as the fetch stage of
 * `services:extract`, so a page landed here is indistinguishable from one the
 * queue landed and `pnpm fetch:ledger` counts it the same way. What it
 * deliberately does not do is extract: no model runs here. This puts the page
 * on disk with a content hash, and what a citizen is told off it still has to
 * be quoted verbatim and still has to survive `pnpm quotes:audit`.
 */

import { appendJsonl, at, fetchPage, hostOf, htmlMeta, ledger, looksSoft404, negativeRow, NEGATIVE, pool, renderPage, saveLedger, sha1, sha256, toText } from "./lib.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PAGES = ".ingest/pages/";
const PAGES_LEDGER = ".ingest/pages.jsonl";
/** Under this a page is a shell or an error, whatever status it came with. */
const MIN_CHARS = 600;
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

/** A url list, from a file or straight off the command line. */
export function urlsFrom(inputs, read = (f) => readFileSync(f, "utf8")) {
  const out = [];
  for (const input of inputs) {
    if (input.startsWith("--")) continue;
    const lines = /^https?:\/\//i.test(input) ? [input] : read(input).split(/\r?\n/);
    for (const line of lines) {
      // `#` starts a comment so a url list can say why each url is on it, which
      // is the only thing that makes one reviewable six months later.
      const url = line.replace(/\s+#.*$/, "").trim();
      if (url && !url.startsWith("#")) out.push(url);
    }
  }
  return [...new Set(out)];
}

if (flag("selftest")) {
  const { default: assert } = await import("node:assert/strict");
  const read = () => "# aadhaar update\nhttps://uidai.gov.in/a  # the landing page\n\nhttps://uidai.gov.in/b\nhttps://uidai.gov.in/a\n";
  assert.deepEqual(urlsFrom(["list.txt"], read), ["https://uidai.gov.in/a", "https://uidai.gov.in/b"], "comments stripped, blanks dropped, duplicates collapsed");
  assert.deepEqual(urlsFrom(["https://uidai.gov.in/c"], read), ["https://uidai.gov.in/c"], "a bare url is its own list");
  assert.deepEqual(urlsFrom(["--render", "https://uidai.gov.in/c"], read), ["https://uidai.gov.in/c"], "flags are not urls");
  console.log("fetch-urls selftest ok");
  process.exit(0);
}

const urls = urlsFrom(args);
if (!urls.length) {
  console.error("nothing to fetch. Pass a file of urls or the urls themselves.");
  process.exit(2);
}

mkdirSync(at(PAGES), { recursive: true });
const pages = ledger(PAGES_LEDGER, "url");
const now = new Date().toISOString().slice(0, 10);
const rendering = flag("render");
const failures = [];

console.log(`${urls.length} urls, ${urls.filter((u) => pages.has(u)).length} already in the cache`);

const got = await pool(urls, CONCURRENCY, async (url) => {
  if (pages.has(url) && !flag("refetch")) return { url, skipped: true };

  // A PDF fetched here would land in the page cache as `%PDF-1.7` and an xref
  // table, and a model would be handed that as evidence. `pdf:extract` is the
  // reader, and NOT_TEXT is precisely the row it queues from, so writing that
  // row is both the refusal and the handoff.
  if (/\.pdf(\?|#|$)/i.test(url)) {
    failures.push({ url, why: "pdf, run pnpm pdf:extract", reason: "NOT_TEXT" });
    return;
  }

  const res = await fetchPage(url, { timeoutMs: 30_000 });
  const meta = res.ok ? htmlMeta(res.body ?? "") : {};
  const text = res.ok ? toText(res.body ?? "") : "";
  const thin = !res.ok || text.length < MIN_CHARS || looksSoft404(text, meta, res.contentType);

  // A government portal that is one div and a bundle.js is the normal case on
  // this estate, not an outage. The browser is the second attempt, never the
  // first: it costs a credit and most pages do not need it.
  if (thin && rendering) {
    const shot = await renderPage(url);
    const rendered = String(shot.markdown ?? "").trim();
    if (shot.ok && rendered.length >= MIN_CHARS) {
      return { url, text: rendered, title: shot.title || null, status: shot.status ?? 200, rendered: true };
    }
    failures.push({ url, why: shot.failure ?? `rendered ${rendered.length} chars` });
    return;
  }
  if (thin) {
    failures.push({ url, why: res.ok ? `${text.length} chars, needs --render` : (res.failure ?? `HTTP ${res.status}`) });
    return;
  }
  return { url, text, title: meta.title || null, status: res.status, tlsVerified: res.tlsVerified !== false, truncated: res.truncated === true };
});

let written = 0;
for (const page of got) {
  if (!page || page.skipped) continue;
  const row = {
    url: page.url,
    sha1: sha1(page.url),
    contentHash: sha256(page.text),
    host: hostOf(page.url),
    title: page.title,
    chars: page.text.length,
    status: page.status,
    tlsVerified: page.tlsVerified !== false,
    truncated: page.truncated === true,
    ...(page.rendered ? { rendered: true } : {}),
    score: 0,
    fetchedAt: now,
  };
  writeFileSync(at(PAGES + row.sha1 + ".md"), page.text);
  pages.set(row.url, row);
  written++;
  console.log(`  ok   ${row.chars.toString().padStart(6)}  ${row.url}`);
}

for (const f of failures) console.log(`  --   ${f.why.padEnd(24)} ${f.url}`);

if (written) saveLedger(PAGES_LEDGER, pages);
// A url that failed goes in the negative cache for the same reason the queue's
// failures do: so the next pass knows it was tried, rather than trying it again
// and calling that news.
appendJsonl(NEGATIVE, failures.map((f) => negativeRow(f.url, f.reason ?? "TOO_THIN", now, f.why)));
console.log(`${written} written, ${failures.length} failed`);
