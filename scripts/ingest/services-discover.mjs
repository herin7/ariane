/**
 * Find the pages worth reading, out of every page these hosts have.
 *
 *   pnpm services:discover                 # map every host we have not mapped
 *   pnpm services:discover --limit 10      # a taste
 *   pnpm services:discover --host iora.gujarat.gov.in
 *   pnpm services:discover --score         # rescore what is cached, no network
 *   pnpm services:discover --selftest      # the scorer, no network
 *
 * 384 named hosts. Sitemaps are a dead end on this estate (measured: robots.txt
 * and sitemap.xml return HTTP 200 with an HTML error body, six for six), so
 * Firecrawl's /v2/map is the only thing that enumerates a site cheaply. One call
 * per host, about 4 credits, and it comes back with a title and a description
 * for every url, which is enough to score without fetching a single page.
 *
 * MAP ONCE. The response goes to .ingest/maps/<host>.json and a host that has a
 * file is never mapped again. Rescoring is free and offline, which is the whole
 * reason the raw response is kept rather than just the verdict: the scorer will
 * be wrong at first, and being wrong should not cost credits twice.
 *
 * Scoring is deterministic. No model. A url either has the words a service page
 * has or it does not, and paying a model to notice the word "eligibility" would
 * be an odd way to spend an afternoon.
 *
 * Nothing here fetches a page. It decides what is worth fetching, which is
 * Phase 4's job, and writes the queue it will work from.
 */

import { anchors, appendJsonl, fetchPage, hostOf, normalise, pool, writeJsonl } from "./lib.mjs";
import { buildRegistry } from "../lib/registry.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const at = (p) => fileURLToPath(new URL(p, root));

const MAPS = ".ingest/maps/";
const URLS = ".ingest/urls.jsonl";
// A map call takes about 50 seconds against this estate, so 468 hosts serially
// is an afternoon. Every host is written to disk the moment it lands, so killing
// this halfway costs nothing.
//
// Four, not ten. Ten was measured and it is over Firecrawl's rate limit: the
// first full run got HTTP 429 on 247 of 456 hosts, which is not a slow estate,
// it is us knocking too fast.
const CONCURRENCY = 4;
/** A host that fails this many times is a host for another day, not a loop. */
const MAX_ATTEMPTS = 3;
const PAGE_CAP = 3000;
const THRESHOLD = 4;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** Categories whose hosts can plausibly hold a service a citizen must complete. */
const WORTH_MAPPING = new Set(["SERVICE_PORTAL", "DEPARTMENT", "DISTRICT_COLLECTOR", "DISTRICT_PANCHAYAT", "MUNICIPAL", "POLICE", "TRANSPORT_RTO", "EDUCATION", "JUDICIARY"]);

// ------------------------------------------------------------------ scoring

/**
 * What a page about a government service says about itself, in its url and in
 * the one line a search engine kept.
 *
 * Weighted, not boolean, because the words overlap: a page saying "documents
 * required" and "eligibility" and "fee" is the page we want, and a page saying
 * only "form" might be a feedback form. Gujarati alongside English throughout,
 * for the same reason as the domain classifier.
 */
const POSITIVE = [
  [6, /eligib|who can apply|documents? required|required documents?|how to apply|checklist|પાત્રતા|જરૂરી ?દસ્તાવેજ/],
  [5, /\bapply\b|application form|online application|new application|અરજી|નવી ?અરજી/],
  [4, /\bfee(s)?\b|charges|payment detail|processing time|time ?limit|ફી|સમય ?મર્યાદા/],
  [4, /certificate|licen[cs]e|permit|registration|renewal|પ્રમાણપત્ર|પરવાનો|નોંધણી/],
  [3, /\bservice(s)?\b|\bseva\b|scheme|yojana|benefit|સેવા|યોજના|સહાય/],
  [3, /procedure|process|guideline|instruction|user manual|how ?to|પ્રક્રિયા/],
  [2, /\bform\b|download|પત્રક|ડાઉનલોડ/],
  [2, /grievance|complaint|helpline|toll ?free|escalat|ફરિયાદ|હેલ્પલાઇન/],
  [2, /track|status|check status|સ્થિતિ/],
  [2, /office|contact|address|કચેરી|સરનામ/],
];

/**
 * And what a page that is not that says. Negative rather than excluded, so a
 * page called "news about the new certificate scheme" can still climb back.
 */
const NEGATIVE = [
  [8, /\bnews\b|press ?release|media|gallery|photo|video|album|event|celebrat|સમાચાર/],
  [8, /\btender\b|\beoi\b|quotation|auction|procurement|bid ?document/],
  [6, /screen ?reader|accessibility|site ?map|sitemap|privacy ?policy|disclaimer|terms ?of ?use|copyright|hyperlink ?policy|website ?policy/],
  [6, /\brti\b.{0,12}(annual|quarterly|report)|annual ?report|budget ?speech|minutes ?of/],
  [5, /recruit|vacanc|advertis|result|merit ?list|call ?letter|answer ?key|syllabus|exam ?schedule/],
  [4, /\blogin\b|sign ?in|user ?id|forgot ?password|dashboard|admin\b/],
  [3, /archive|old ?website|previous|\b(19|20)\d\d ?-? ?\d{0,4}\b.{0,6}archive/],
];

const weigh = (rules, text) => rules.reduce((sum, [w, re]) => sum + (re.test(text) ? w : 0), 0);

/**
 * How much this url looks like a page a citizen has to read.
 *
 * The path counts double. A title is written for a human and a description is
 * whatever a crawler kept, but a path is what the people who built the site
 * decided this page was, and `/OnlineAppl.aspx` is a stronger claim than a
 * sentence that happens to contain the word application.
 */
export function score(link) {
  const path = decodeURIComponent((link.url ?? "").replace(/^https?:\/\/[^/]+/i, "")).toLowerCase();
  const text = `${link.title ?? ""} ${link.description ?? ""}`.toLowerCase();
  let n = 2 * (weigh(POSITIVE, path) - weigh(NEGATIVE, path)) + weigh(POSITIVE, text) - weigh(NEGATIVE, text);

  // The homepage is always worth reading: it is where the list of services is,
  // and it never contains any of the words above.
  if (path === "" || path === "/" || /^\/(index|home|default)\.\w+$/.test(path)) n += 8;
  // A pdf on a government site is usually the actual form or the resolution
  // that created the scheme. Worth keeping, worth knowing it needs different
  // handling than html.
  if (/\.pdf$/.test(path)) n += 1;
  // Deep in a query string with an id is a record, not a page about a service.
  if (/[?&](id|no|num|srno)=\d+/.test(path)) n -= 6;
  return n;
}

// ----------------------------------------------------------------- self test

if (flag("selftest")) {
  const { strict: assert } = await import("node:assert");
  const s = (url, title = "", description = "") => score({ url, title, description });

  assert.ok(s("https://x.gov.in/") > THRESHOLD, "a homepage is always worth reading");
  assert.ok(s("https://x.gov.in/OnlineAppl.aspx", "New Application") > THRESHOLD);
  assert.ok(s("https://x.gov.in/eligibility-documents-required.html") > THRESHOLD);
  assert.ok(s("https://x.gov.in/apply-income-certificate", "Income Certificate") > THRESHOLD);
  assert.ok(s("https://x.gov.in/photo-gallery", "Photo Gallery") < THRESHOLD, "a gallery is not a service");
  assert.ok(s("https://x.gov.in/tender/notice-42.pdf", "Tender Notice") < THRESHOLD);
  assert.ok(s("https://x.gov.in/ScreenReaderAccess.aspx") < THRESHOLD);
  assert.ok(s("https://x.gov.in/recruitment/answer-key", "Answer Key") < THRESHOLD);

  // The one that keeps the negatives honest. A news page about a real service is
  // still a lead, so the rules subtract, they do not exclude.
  assert.ok(
    s("https://x.gov.in/news/2026", "Photo gallery") < s("https://x.gov.in/news/apply-for-ration-card-eligibility", "How to apply, documents required"),
    "a news url about a real service outscores a plain gallery",
  );

  console.log("services-discover: ok");
  process.exit(0);
}

// --------------------------------------------------------------------- map

const key = process.env.FIRECRAWL_API_KEY?.trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One /v2/map call.
 *
 * Two retries and then it gives up, per the retry budget. A host that fails
 * three times is a host to come back to tomorrow, not one to block the queue on.
 *
 * 429 gets its own path and a much longer wait. It used to fall through to the
 * generic 3 second backoff, which against a per minute rate limit means all four
 * workers retry in lockstep, get refused again, and burn their whole budget
 * inside ten seconds. That is how 247 hosts came back "failed" when nothing was
 * wrong with any of them.
 */
async function map(host, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/map", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ url: `https://${host}`, limit: 500 }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 402) return { links: [], failure: "OUT_OF_CREDITS" };
      if (res.status === 429) {
        if (attempt === retries) return { links: [], failure: "HTTP_429" };
        const after = Number(res.headers.get("retry-after"));
        await sleep(Math.min(after > 0 ? after * 1000 : 20_000 * 2 ** attempt, 180_000));
        continue;
      }
      if (!res.ok) {
        if (res.status < 500) return { links: [], failure: `HTTP_${res.status}` };
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      return { links: Array.isArray(body.links) ? body.links : [], failure: null };
    } catch (e) {
      if (attempt === retries) return { links: [], failure: String(e.message ?? e).slice(0, 80) };
      await sleep(3000 * 2 ** attempt);
    }
  }
  return { links: [], failure: "GAVE_UP" };
}

// --------------------------------------------------------------------- run

const now = new Date().toISOString();
const registry = buildRegistry();

/** Hosts whose own homepage we already know does not answer. */
const dead = new Set();
try {
  for (const line of readFileSync(at(".ingest/domains.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const row = JSON.parse(line);
    if (["DEAD", "UNREACHABLE", "SOFT_404"].includes(row.state)) dead.add(row.host);
  }
} catch {
  // no classification run on this machine yet, which just means we map more
}

const hosts = registry
  .filter((r) => WORTH_MAPPING.has(r.category) && !dead.has(r.host))
  .map((r) => r.host)
  .filter((h) => !value("host", null) || h === value("host", null));

mkdirSync(at(MAPS), { recursive: true });

const cached = (host) => {
  try {
    return JSON.parse(readFileSync(at(MAPS + host + ".json"), "utf8"));
  } catch {
    return null;
  }
};

/**
 * MAP ONCE meant map once successfully, and it did not say so.
 *
 * A file was written for every host including the failures, and the existence
 * of a file was the whole cache check, so 247 hosts rate limited in one bad
 * minute were recorded as permanently mapped and could never be tried again. A
 * cache that remembers a transient failure forever is worse than no cache: it
 * turns a five minute problem into a silent hole in the data.
 *
 * So a failure is retried, with a counter so a genuinely broken host stops after
 * three tries rather than becoming a loop.
 */
const settled = (host) => {
  const m = cached(host);
  return m !== null && (!m.failure || (m.attempts ?? 1) >= MAX_ATTEMPTS);
};

const todo = hosts.filter((h) => !settled(h)).slice(0, Number(value("limit", Infinity)));

console.log(`${hosts.length} hosts worth mapping, ${hosts.filter(settled).length} already settled, ${todo.length} to do`);

if (!flag("score") && todo.length) {
  if (!key) {
    console.error("FIRECRAWL_API_KEY is not set. Run with --score to rescore what is already cached.");
    process.exit(2);
  }
  let done = 0;
  let failed = 0;
  await pool(todo, CONCURRENCY, async (host) => {
    const result = await map(host);
    if (result.failure === "OUT_OF_CREDITS") {
      console.error("out of firecrawl credits, stopping");
      process.exit(3);
    }
    // Written even when it comes back empty, and that is deliberate. "We mapped
    // this host and it has nothing" is an answer, and without the file on disk
    // the next run pays to learn it again.
    const prior = cached(host);
    writeFileSync(
      at(MAPS + host + ".json"),
      JSON.stringify({ host, mappedAt: now, failure: result.failure, attempts: (prior?.attempts ?? 0) + 1, links: result.links, harvested: prior?.harvested }, null, 1),
    );
    if (result.failure) failed++;
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${todo.length} mapped`);
  });
  console.log(`  ${done} mapped, ${failed} failed`);
}

// ----------------------------------------------------------------- harvest

/**
 * The free half of discovery, for hosts the index has never heard of.
 *
 * 63 hosts came back from /v2/map with zero links and a warning suggesting we
 * map the parent domain instead. `amreli.gujarat.gov.in` is one of them and it
 * is a working district collectorate with a homepage full of service links.
 * Firecrawl's map is index backed, so "not indexed" arrived looking exactly like
 * "has no pages", and taking that at face value would have written off a
 * district.
 *
 * Reading one homepage we can already fetch costs no credits, so this runs for
 * every host the map left empty, and only those.
 */
const barren = hosts.filter((h) => {
  const m = cached(h);
  return m && !(m.links ?? []).length && !m.harvested;
});

if (!flag("score") && barren.length) {
  console.log(`\n${barren.length} host(s) the index has nothing on. Reading their homepages instead, no credits.`);
  let found = 0;
  await pool(barren, 8, async (host) => {
    const res = await fetchPage(`https://${host}/`, { timeoutMs: 20_000 });
    const links = res.ok ? anchors(res.body ?? "", `https://${host}/`) : [];
    const prior = cached(host);
    writeFileSync(at(MAPS + host + ".json"), JSON.stringify({ ...prior, harvestedAt: now, harvested: links }, null, 1));
    if (links.length) found++;
  });
  console.log(`  ${found} of ${barren.length} had a homepage worth reading`);
}

// ------------------------------------------------------------------- score

/** url -> row, deduped by normalise, because two hosts can list the same page. */
const seen = new Map();
let mapped = 0;
let offHost = 0;
let harvestedUrls = 0;
for (const r of registry) {
  const file = cached(r.host);
  if (!file) continue;
  mapped++;
  // Map first so its richer descriptions win a tie, harvest second to fill in
  // what the index never had. Which one found a url is recorded, because they
  // are not equally trustworthy: a map link is a page Firecrawl has seen, a
  // harvested link is a page the host claims to have.
  const sources = [
    ["firecrawl map", file.links ?? []],
    ["homepage links", file.harvested ?? []],
  ];
  for (const [discovery, links] of sources) {
    for (const link of links) {
      const url = normalise(link.url ?? "");
      if (!url.startsWith("http")) continue;
      // Firecrawl returns outbound links too, and a homepage links everywhere. A
      // url on a host we did not ask about has not been classified, so we have
      // no idea whose page it is.
      if (hostOf(url) !== r.host) {
        offHost++;
        continue;
      }
      const existing = seen.get(url);
      if (existing) {
        if (!existing.hosts.includes(r.host)) existing.hosts.push(r.host);
        continue;
      }
      if (discovery === "homepage links") harvestedUrls++;
      seen.set(url, {
        url,
        host: r.host,
        hosts: [r.host],
        category: r.category,
        title: (link.title ?? "").slice(0, 200) || null,
        description: (link.description ?? "").slice(0, 300) || null,
        score: score(link),
        discovery,
        discoveredAt: file.mappedAt ?? now,
      });
    }
  }
}

const all = [...seen.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
const above = all.filter((r) => r.score >= THRESHOLD);

/**
 * The cap, and what it cost.
 *
 * 3000 pages is the agreed ceiling for what gets fetched and committed. Highest
 * score first, and everything below the line is written out anyway with its own
 * state, because a silent truncation reads exactly like full coverage and this
 * is the file somebody will later use to claim we looked everywhere.
 */
const kept = new Set(above.slice(0, PAGE_CAP));
const rows = all.map((r) => ({
  ...r,
  state: r.score < THRESHOLD ? "SKIPPED_LOW_SCORE" : kept.has(r) ? "DISCOVERED" : "SKIPPED_OVER_CAP",
}));

writeJsonl(URLS, rows);

const discovered = rows.filter((r) => r.state === "DISCOVERED").length;
const overCap = rows.filter((r) => r.state === "SKIPPED_OVER_CAP").length;
const lowScore = rows.filter((r) => r.state === "SKIPPED_LOW_SCORE").length;

appendJsonl(".ingest/runs.jsonl", [{ run: "services:discover", at: now, hostsMapped: mapped, urls: rows.length, discovered, overCap, lowScore, offHost }]);

console.log(`\n${mapped} hosts mapped, ${rows.length} unique urls (${harvestedUrls} from homepages, free), ${offHost} off-host links dropped`);
console.log(`  ${discovered} DISCOVERED (score >= ${THRESHOLD}, under the ${PAGE_CAP} cap)`);
if (overCap) console.log(`  ${overCap} SKIPPED_OVER_CAP  <- scored well enough but the cap is ${PAGE_CAP}. Lowest kept score: ${above[PAGE_CAP - 1]?.score}`);
console.log(`  ${lowScore} SKIPPED_LOW_SCORE`);
console.log(`\n.ingest/urls.jsonl written. Nothing has been fetched.`);
