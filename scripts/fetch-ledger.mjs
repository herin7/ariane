/**
 * The answer to "have we already fetched this?"
 *
 *   pnpm fetch:ledger                    # rebuild docs/research/fetch-ledger.json
 *   pnpm fetch:ledger --check            # fail if it is stale or a cache file is missing
 *   pnpm fetch:have <url> [url...]       # HAVE or NEED, per url, exit 1 if any NEED
 *
 * Why this exists: every page we cite was fetched once, by hand, through
 * Firecrawl, and the only record of that was a `cacheFile` path buried in one
 * journey's research JSON. So the same URL fetched for two journeys looked like
 * two different pages, and nobody could answer "do we already have this" without
 * grepping five files. At sixty seven sources that is annoying. At six hundred
 * it means paying to fetch the same page twice.
 *
 * The ledger is derived, not authored. It is rebuilt from the research JSON plus
 * whatever is on disk, so it cannot drift from reality without --check saying so.
 *
 * Rule this enforces: never fetch a URL that says HAVE. Not to refresh it, not
 * to check it changed, not because it is a different journey. Refetching is an
 * explicit decision a human makes out loud, not a default.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalise } from "./lib/url.mjs";

const root = new URL("../", import.meta.url);
const at = (p) => fileURLToPath(new URL(p, root));

// ------------------------------------------------------------- what we cited

/** url -> { url, journeys[], cacheFile, retrievedAt, title, sourceType, fetchFailed } */
const cited = new Map();
const researchDir = at("docs/research/");
for (const file of readdirSync(researchDir).filter((f) => f.endsWith(".json"))) {
  const bundle = JSON.parse(readFileSync(researchDir + file, "utf8"));
  const quotedIds = new Set((bundle.facts ?? []).map((f) => f.sourceId));
  for (const source of bundle.sources ?? []) {
    const key = normalise(source.url);
    const entry = cited.get(key) ?? { url: key, journeys: [], cacheFile: null, retrievedAt: null, title: null, sourceType: null, fetchFailed: false, quoted: false };
    // This is the whole point of keying by URL. Two journeys citing one page is
    // one fetch, and the ledger is where that becomes visible.
    if (!entry.journeys.includes(bundle.journey)) entry.journeys.push(bundle.journey);
    entry.cacheFile ??= source.cacheFile ?? null;
    entry.retrievedAt ??= source.retrievedAt ?? null;
    entry.title ??= source.title ?? null;
    entry.sourceType ??= source.sourceType ?? null;
    // A page we tried to fetch and could not. Recorded, not hidden: the whole
    // digitalgujarat portal answers ERR_TUNNEL_CONNECTION_FAILED, and pretending
    // that is the same as "somebody forgot to save the file" is how a known
    // blocked host turns into a permanent red build nobody reads any more.
    if (source.scrapedOk === false) entry.fetchFailed = true;
    if (quotedIds.has(source.id)) entry.quoted = true;
    cited.set(key, entry);
  }
}

// ------------------------------------------------------------ what is on disk

const files = new Map(); // relative path -> { bytes, sha256 }
(function walk(dir) {
  let entries;
  try {
    entries = readdirSync(at(dir), { withFileTypes: true });
  } catch {
    return; // no cache on this machine yet, which --check will report
  }
  for (const e of entries) {
    const path = `${dir}${e.name}`;
    if (e.isDirectory()) walk(`${path}/`);
    else {
      const buffer = readFileSync(at(path));
      files.set(path, { bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") });
    }
  }
})(".firecrawl/");

// ------------------------------------------------------------------ reconcile

const entries = [...cited.values()]
  .map((e) => {
    const file = e.cacheFile ? files.get(e.cacheFile) : null;
    return {
      url: e.url,
      title: e.title,
      sourceType: e.sourceType,
      journeys: e.journeys.sort(),
      cacheFile: e.cacheFile,
      // Present means a clone can read the page without a network call. Missing
      // means somebody would have to refetch, which is the thing we are here to
      // stop, so it is a failure and not a warning. FETCH_FAILED is the fourth
      // answer and the honest one: there is no page to cache because nobody was
      // ever served one. A source in that state is a lead and a recorded gap,
      // never a citation, which is enforced by there being no quote to cite.
      status: e.cacheFile ? (file ? "CACHED" : "MISSING") : e.fetchFailed ? "FETCH_FAILED" : "NO_CACHE_FILE",
      quoted: e.quoted,
      bytes: file?.bytes ?? null,
      sha256: file?.sha256 ?? null,
      retrievedAt: e.retrievedAt,
    };
  })
  .sort((a, b) => a.url.localeCompare(b.url));

const referenced = new Set(entries.map((e) => e.cacheFile).filter(Boolean));
const orphans = [...files.keys()].filter((f) => !referenced.has(f)).sort();

const ledger = {
  // Regenerate with `pnpm fetch:ledger`. Hand edits get overwritten.
  generatedBy: "scripts/fetch-ledger.mjs",
  urls: entries.length,
  cached: entries.filter((e) => e.status === "CACHED").length,
  missing: entries.filter((e) => e.status === "MISSING").length,
  noCacheFile: entries.filter((e) => e.status === "NO_CACHE_FILE").length,
  // Pages that answered with a block or an error rather than content. Kept in
  // the ledger on purpose: a known gap somebody already burned two attempts on
  // is worth more than a blank space that invites a third.
  fetchFailed: entries.filter((e) => e.status === "FETCH_FAILED").length,
  // Raw pages nobody cites. Not deleted: an uncited page is a page whose facts
  // have not been extracted yet, which is a lead, not litter.
  orphanedCacheFiles: orphans,
  entries,
};

// --------------------------------------------------------------------- modes

const args = process.argv.slice(2);
const target = at("docs/research/fetch-ledger.json");
const rendered = JSON.stringify(ledger, null, 2) + "\n";

if (args[0] === "--have") {
  const wanted = args.slice(1);
  if (!wanted.length) {
    console.error("usage: pnpm fetch:have <url> [url...]");
    process.exit(2);
  }
  let need = 0;
  for (const raw of wanted) {
    const key = normalise(raw);
    const hit = entries.find((e) => e.url === key);
    if (hit?.status === "CACHED") console.log(`HAVE  ${key}\n      ${hit.cacheFile}  cited by ${hit.journeys.join(", ")}`);
    else if (hit) console.log(`NEED  ${key}\n      cited by ${hit.journeys.join(", ")} but ${hit.status}`), need++;
    else console.log(`NEED  ${key}`), need++;
  }
  process.exit(need ? 1 : 0);
}

if (args.includes("--check")) {
  const problems = [];
  let current;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = null;
  }
  if (current !== rendered) problems.push("fetch-ledger.json is stale, run: pnpm fetch:ledger");
  for (const e of entries) {
    if (e.status === "MISSING") problems.push(`cache file missing, a clone would refetch: ${e.cacheFile}  (${e.url})`);
    if (e.status === "NO_CACHE_FILE") problems.push(`cited with no cache file, unreproducible: ${e.url}`);
    // The one that actually matters. A page nobody was ever served cannot have
    // produced a verbatim quote, so a fact hanging off it was typed from
    // somewhere else, and "somewhere else" is the thing this repo exists to stop.
    if (e.status === "FETCH_FAILED" && e.quoted) problems.push(`quoted a page that was never fetched: ${e.url}`);
  }
  for (const p of problems) console.error(`  ${p}`);
  console.log(`${entries.length} urls, ${ledger.cached} cached, ${ledger.fetchFailed} unfetchable, ${orphans.length} orphaned raw pages`);
  process.exit(problems.length ? 1 : 0);
}

writeFileSync(target, rendered);
console.log(`docs/research/fetch-ledger.json written`);
console.log(`  ${entries.length} unique urls across ${new Set(entries.flatMap((e) => e.journeys)).size} journeys`);
console.log(`  ${ledger.cached} cached, ${ledger.missing} missing, ${ledger.noCacheFile} with no cache file, ${ledger.fetchFailed} unfetchable`);
console.log(`  ${orphans.length} raw pages nobody cites yet`);
const shared = entries.filter((e) => e.journeys.length > 1);
if (shared.length) console.log(`  ${shared.length} url(s) shared between journeys, fetched once`);
