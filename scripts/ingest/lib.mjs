/**
 * The shared floor under every ingest command.
 *
 * One rule shapes all of it: FETCH ONCE, PARSE MANY TIMES, MODEL ONLY WHEN IT
 * ADDS VALUE. That only works if each stage caches separately, so re-running
 * extraction never re-runs fetching and a changed prompt never re-fetches a
 * page. Hence six ledgers under .ingest/ rather than one blob:
 *
 *   domains.jsonl    host -> category, and which tier was cheap enough to decide it
 *   urls.jsonl       url  -> host, how we found it, priority, state
 *   pages/<sha1>.md  the cleaned page, one file per url
 *   pages.jsonl      url  -> sha1, content hash, status, tlsVerified, when
 *   extract/<key>.json  key = content hash + schema + prompt + model
 *   negative.jsonl   url  -> why it failed and when to stop asking
 *
 * State lives on disk, never in a process, so every command is resumable and
 * killing one halfway costs nothing but the page it was on.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import { fileURLToPath } from "node:url";

export { normalise, hostOf } from "../lib/url.mjs";

const root = new URL("../../", import.meta.url);
export const at = (p) => fileURLToPath(new URL(p, root));
export const INGEST = ".ingest/";

export const sha1 = (s) => createHash("sha1").update(s).digest("hex");
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// --------------------------------------------------------------------- jsonl

/**
 * JSONL and not JSON because these files grow to tens of thousands of rows and
 * a crash mid-write should cost one line, not the ledger. A broken line is
 * skipped rather than fatal, for the same reason.
 */
export function readJsonl(path) {
  let text;
  try {
    text = readFileSync(at(path), "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // a half written last line from a kill -9, not worth losing the file over
    }
  }
  return rows;
}

export function writeJsonl(path, rows) {
  mkdirSync(at(path).replace(/[^/\\]+$/, ""), { recursive: true });
  writeFileSync(at(path), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function appendJsonl(path, rows) {
  if (!rows.length) return;
  mkdirSync(at(path).replace(/[^/\\]+$/, ""), { recursive: true });
  appendFileSync(at(path), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** A ledger as a Map, last row per key winning, so an append is an update. */
export function ledger(path, key = "id") {
  const map = new Map();
  for (const row of readJsonl(path)) map.set(row[key], row);
  return map;
}

export function saveLedger(path, map) {
  writeJsonl(path, [...map.values()]);
}

// ------------------------------------------------------------ negative cache

export const NEGATIVE = INGEST + "negative.jsonl";

/**
 * Reasons to stop asking, and for how long. A hard 404 is forever. A block or a
 * timeout gets a day, because sites come back and we are not going to spend a
 * hundred retries finding out which kind of failure this was.
 */
const BACKOFF_HOURS = { HTTP_404: 24 * 365, HTTP_410: 24 * 365, SOFT_404: 24 * 365, BLOCKED_BY_SITE: 24, TIMEOUT: 24, TLS_FAIL: 24, DNS_FAIL: 24 * 7, HTTP_ERROR: 24, TOO_THIN: 24 * 30, NOT_TEXT: 24 * 365, SCANNED_PDF: 24 * 365, EMPTY_RENDER: 24 * 30, AUTH_REQUIRED: 24 * 365, CAPTCHA: 24 * 365 };

export function loadNegative(now) {
  const blocked = new Map();
  for (const row of readJsonl(NEGATIVE)) blocked.set(row.url, row);
  // Expired rows stay in the file as history and stop blocking.
  for (const [url, row] of blocked) if (row.blockedUntil && row.blockedUntil < now) blocked.delete(url);
  return blocked;
}

export function negativeRow(url, reason, now, detail) {
  const hours = BACKOFF_HOURS[reason] ?? 24;
  return { url, reason, detail: detail ?? null, recordedAt: now, blockedUntil: new Date(Date.parse(now) + hours * 3600_000).toISOString() };
}

// ---------------------------------------------------------------------- dns

/**
 * The cheapest filter there is. Roughly a quarter of the unknown Gujarat hosts
 * do not resolve at all, and every one of those is an HTTP request, a timeout
 * and a retry we now never make.
 *
 * dns.lookup and not dns.resolve4 on purpose: resolve4 talks to the configured
 * resolver directly, which in this environment refuses and reports every host
 * on earth as dead. Measured that once and nearly believed it.
 */
export async function resolves(host) {
  try {
    await lookup(host);
    return true;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------- fetch

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const UA = "Mozilla/5.0 (compatible; ariane-research/1.0; +https://github.com/herin7/ariane)";
const MAX_BYTES = 3_000_000;

/**
 * A GET that reports how it got there.
 *
 * Tries an ordinary verified request first. Only if that fails on a certificate
 * problem does it retry with chain verification off, and then it says so, so
 * the caller can brand every quote taken from that page. This is scoped to the
 * one request that needed it and never leaked into a global env var, because
 * NODE_TLS_REJECT_UNAUTHORIZED=0 turns the caveat off for the whole process
 * including the ones that were fine.
 *
 * It matters more than it sounds. digitalgujarat.gov.in was written off as
 * blocking scrapers for months on the strength of an ERR_TUNNEL_CONNECTION_FAILED
 * from a proxy. It is not blocked. It has a broken certificate chain, and it
 * answers 200 the moment you stop pretending otherwise.
 */
export async function fetchPage(url, { timeoutMs = 20000, redirects = 5 } = {}) {
  const strict = await request(url, { timeoutMs, redirects, insecure: false });
  if (!TLS_CODES.has(strict.errorCode ?? "")) return strict;
  const lax = await request(url, { timeoutMs, redirects, insecure: true });
  return { ...lax, tlsVerified: false, tlsError: strict.errorCode };
}

/**
 * The same GET, but the body comes back as bytes.
 *
 * `fetchPage` sets the response encoding to utf8, which is right for html and
 * destroys a PDF: the decoder replaces every byte that is not valid utf8 with
 * U+FFFD, so the file arrives corrupted and no parser will open it. Same TLS
 * retry, same redirect handling, same failure vocabulary, different sink.
 */
export async function fetchBytes(url, { timeoutMs = 60_000, redirects = 5, maxBytes = 40_000_000 } = {}) {
  const strict = await request(url, { timeoutMs, redirects, insecure: false, binary: true, maxBytes });
  if (!TLS_CODES.has(strict.errorCode ?? "")) return strict;
  const lax = await request(url, { timeoutMs, redirects, insecure: true, binary: true, maxBytes });
  return { ...lax, tlsVerified: false, tlsError: strict.errorCode };
}

function request(url, { timeoutMs, redirects, insecure, binary = false, maxBytes = MAX_BYTES }) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve({ ok: false, failure: "BAD_URL", errorCode: null, tlsVerified: true, finalUrl: url });
    }
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: "GET",
        rejectUnauthorized: !insecure,
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*", "accept-language": "en-IN,en;q=0.9" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) return resolve({ ok: false, status, failure: "TOO_MANY_REDIRECTS", errorCode: null, tlsVerified: !insecure, finalUrl: url });
          const next = new URL(res.headers.location, u).toString();
          // The spread keeps the innermost `finalUrl`, which is where we
          // actually ended up. `redirectedFrom` is overwritten at each level on
          // the way back out, so it ends up naming the url we originally asked
          // for. Both halves of "A sent us to B" survive a chain of any length.
          return resolve(request(next, { timeoutMs, redirects: redirects - 1, insecure, binary, maxBytes }).then((r) => ({ ...r, redirectedFrom: url })));
        }
        let body = binary ? [] : "";
        let bytes = 0;
        if (!binary) res.setEncoding("utf8");
        res.on("data", (c) => {
          bytes += c.length;
          // A 40MB PDF served as text is not worth the memory. Truncation is
          // recorded so nobody later mistakes a cut page for a short one.
          if (bytes <= maxBytes) binary ? body.push(c) : (body += c);
        });
        res.on("end", () =>
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: binary ? Buffer.concat(body) : body,
            bytes,
            truncated: bytes > maxBytes,
            contentType: res.headers["content-type"] ?? "",
            tlsVerified: !insecure,
            errorCode: null,
            finalUrl: url,
            failure: status >= 200 && status < 300 ? null : status === 404 || status === 410 ? `HTTP_${status}` : status === 403 || status === 429 ? "BLOCKED_BY_SITE" : "HTTP_ERROR",
          }),
        );
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, failure: "TIMEOUT", errorCode: "TIMEOUT", tlsVerified: !insecure, finalUrl: url });
    });
    req.on("error", (e) => {
      const code = e.code ?? e.message;
      resolve({
        ok: false,
        failure: TLS_CODES.has(code) ? "TLS_FAIL" : code === "ENOTFOUND" || code === "EAI_AGAIN" ? "DNS_FAIL" : "CONNECT_FAIL",
        errorCode: code,
        tlsVerified: !insecure,
        finalUrl: url,
      });
    });
    req.end();
  });
}

// ------------------------------------------------------------------- parsing

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
export const decode = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => entities[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCharCode(e[1] === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));

const tidy = (s) => decode(s).replace(/\s+/g, " ").trim();

const stripTags = (s) => s.replace(/<[^>]*>/g, " ");

/**
 * Script, style and comments gone. Both readers below start here, because they
 * used not to: an `<h1>` inside a JavaScript string literal was winning over
 * the real heading, and a classifier fed markup written by a template engine
 * would have gone on to name the department after it.
 */
const dechrome = (html) =>
  html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ");

/** Title, description and first heading. Everything Tier 1 classification needs. */
export function htmlMeta(html) {
  const clean = dechrome(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(clean)?.[1];
  const desc =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(clean)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(clean)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(clean)?.[1];
  return { title: tidy(title ?? ""), description: tidy(desc ?? ""), h1: tidy(stripTags(h1 ?? "")) };
}

/**
 * HTML to something a model can read, without adding a parser dependency for
 * what a few regexes do. Kills script, style, nav chrome and comments, keeps
 * headings, list items and link text as lines.
 *
 * ponytail: regex stripper, not a DOM. Good enough to feed an extractor whose
 * output is checked against this very text. Swap in a real parser only if
 * evidence matching starts failing on structure it mangled.
 */
export function toText(html) {
  let s = dechrome(html)
    .replace(/<\/(p|div|section|article|tr|li|h[1-6]|table|ul|ol|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ");
  s = stripTags(s);
  return decode(s)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l, i, a) => l.length > 0 && !(l === a[i - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Every link a page offers, in the shape the url scorer already reads.
 *
 * The free half of discovery. Firecrawl's /v2/map is index backed, so a host
 * nobody has indexed comes back with zero links and a suggestion to try the
 * parent domain: `amreli.gujarat.gov.in` returns 0 while `ahmedabad` returns
 * plenty, and the difference is not that Amreli has no services. Their own
 * homepages list them perfectly well, and reading a homepage we can already
 * fetch costs nothing.
 *
 * Anchor text becomes the title, which is usually better than a crawler's
 * guess: a government homepage links to its own service pages with the name of
 * the service.
 */
export function anchors(html, baseUrl) {
  const out = [];
  const seen = new Set();
  for (const m of dechrome(html).matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1]).trim();
    if (!href || href.startsWith("#")) continue;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    url.hash = "";
    const clean = url.toString();
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push({ url: clean, title: tidy(stripTags(m[2])).slice(0, 200) || null, description: null });
  }
  return out;
}

/**
 * A page that says 200 and means 404.
 *
 * Measured on this estate: robots.txt and sitemap.xml return HTTP 200 with an
 * HTML error body on every Gujarat host tested, six for six. A pipeline that
 * trusts the status code caches that as a successful fetch and later extracts
 * facts from an error page, which is the single most expensive way to be wrong
 * here, because it looks like data.
 */
export function looksSoft404(text, meta, contentType) {
  const t = `${meta.title} ${meta.h1}`.toLowerCase();
  if (/\b(404|error|not found|page unavailable|access denied|bad gateway|service unavailable|under maintenance|forbidden)\b/.test(t)) return true;
  // XML and JSON were asked for as such; short is normal and not suspicious.
  if (/xml|json/.test(contentType)) return false;
  if (text.length < 400 && /error|not found|denied|failed|unavailable/i.test(text)) return true;
  return false;
}

// -------------------------------------------------------------------- model

/**
 * The escalation ladder, by name. Tier 0 is not in here because Tier 0 is a
 * regex and the whole point is that most of the work never reaches this file.
 *
 * qwen3-32b answered a real classification task correctly in 972ms; kimi is the
 * one to reach for when the cheap model returns nothing usable, and only then.
 * Every Anthropic id on this account 403s, so they are not an option here.
 */
export const MODELS = { tier1: "qwen.qwen3-32b", tier2: "moonshotai.kimi-k2.5" };

/**
 * One chat completion, or null.
 *
 * Two retries on a transient failure and then it gives up, per the retry budget:
 * a model that is down stays down for longer than a loop is willing to wait, and
 * a pipeline that hammers it just turns one outage into an hour of nothing.
 *
 * Null is the only failure mode. Callers must already handle "the model said
 * nothing useful", so no-credentials, timeout, 500 and refusal all arrive the
 * same way and none of them get special pleading.
 */
export async function chat(messages, { model = MODELS.tier1, maxTokens = 2000, timeoutMs = 90_000, retries = 2 } = {}) {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (!token) return null;
  const base = (process.env.BEDROCK_BASE_URL?.trim() || "https://bedrock-mantle.us-east-1.api.aws").replace(/\/+$/, "");

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, "openai-project": process.env.BEDROCK_PROJECT?.trim() || "default", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages }),
      });
      // 4xx is us: a bad body or a model this account cannot call. Retrying an
      // argument we lost is just three times the wait for the same answer.
      if (!res.ok) {
        if (res.status < 500 && res.status !== 429) return null;
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      const text = body.choices?.[0]?.message?.content;
      return typeof text === "string" && text.trim() ? { text, model } : null;
    } catch {
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** The first JSON array in a reply, for models that narrate before answering. */
export function jsonArray(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------- pool

/**
 * N at a time, in order, results in input order.
 *
 * Not Promise.all: 285 simultaneous requests to one state's servers is a load
 * test nobody asked for, and the estate is slow enough that half would time out
 * and be recorded as dead hosts. Not a dependency either, because it is this.
 */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

// ----------------------------------------------------------------- self test

/**
 * `node scripts/ingest/lib.mjs` and it either says ok or throws. Runs in the
 * gates. No network, no framework: the parsing here decides what a model is
 * shown and what counts as a successful fetch, and both are too load bearing to
 * be checked only by whether the pipeline felt fine that day.
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { strict: assert } = await import("node:assert");

  const page = `<html><head><title>  Income &amp; Certificate </title>
    <meta name="description" content="Apply online"></head>
    <body><script>var x = "<h1>not a heading</h1>";</script>
    <h1>Mamlatdar <span>Office</span></h1><p>Fee is Rs. 20</p><ul><li>Ration card</li><li>Ration card</li></ul>
    <style>h1{color:red}</style></body></html>`;

  const meta = htmlMeta(page);
  assert.equal(meta.title, "Income & Certificate");
  assert.equal(meta.description, "Apply online");
  assert.equal(meta.h1, "Mamlatdar Office", "h1 must survive a nested span");

  const text = toText(page);
  assert.ok(!text.includes("not a heading"), "script contents must never reach the model");
  assert.ok(!text.includes("color:red"), "style contents must never reach the model");
  assert.ok(text.includes("Fee is Rs. 20"));
  assert.equal(text.match(/Ration card/g)?.length, 1, "consecutive duplicate lines collapse");

  // The one that protects the cache. A 200 that means 404 must not look fetched.
  assert.equal(looksSoft404("whatever", { title: "404 Error - Page Not Found", h1: "" }, "text/html"), true);
  assert.equal(looksSoft404("The requested service failed", { title: "", h1: "" }, "text/html"), true);
  assert.equal(looksSoft404(text, meta, "text/html"), false, "a real service page is not a soft 404");
  assert.equal(looksSoft404("{}", { title: "", h1: "" }, "application/json"), false, "short json is not an error");

  const at404 = negativeRow("https://x.gov.in/a", "HTTP_404", "2026-08-23T00:00:00.000Z");
  const blocked = negativeRow("https://x.gov.in/b", "BLOCKED_BY_SITE", "2026-08-23T00:00:00.000Z");
  assert.ok(at404.blockedUntil > blocked.blockedUntil, "a hard 404 backs off far longer than a block");
  assert.equal(blocked.blockedUntil, "2026-08-24T00:00:00.000Z");

  const links = anchors(
    `<a href="/apply.aspx">Apply <b>Online</b></a><a href="#top">Skip</a><a href="mailto:x@y.in">Mail</a>
     <a href="/apply.aspx#form">Apply again</a><a href="https://other.gov.in/a">Off host</a>
     <script>var s = '<a href="/fake">not a link</a>';</script>`,
    "https://x.gov.in/dept/",
  );
  assert.deepEqual(
    links.map((l) => l.url),
    ["https://x.gov.in/apply.aspx", "https://other.gov.in/a"],
    "relative resolved, fragment and mailto dropped, same page twice counted once",
  );
  assert.equal(links[0].title, "Apply Online", "anchor text is the title, tags stripped");
  assert.ok(!links.some((l) => l.url.includes("fake")), "a link inside a script tag is not a link");

  assert.deepEqual(jsonArray('Sure! ```json\n[{"a":1}]\n``` hope that helps'), [{ a: 1 }]);
  assert.equal(jsonArray("I could not do it"), null, "prose without an array is not an answer");
  assert.equal(jsonArray('[{"a":1'), null, "a truncated reply is not an answer");

  // Bounded and ordered. An unbounded pool would look identical on a good day.
  let live = 0;
  let peak = 0;
  const order = await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    peak = Math.max(peak, ++live);
    await new Promise((r) => setTimeout(r, 8 - n));
    live--;
    return n * 2;
  });
  assert.deepEqual(order, [2, 4, 6, 8, 10, 12, 14], "results come back in input order, not finish order");
  assert.ok(peak <= 3, `pool ran ${peak} at once with a limit of 3`);

  console.log("ingest/lib.mjs: ok");
}
