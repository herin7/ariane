/**
 * Work out what the unnamed Gujarat government hosts are.
 *
 *   pnpm domains:classify              # the hosts nothing has decided yet
 *   pnpm domains:classify --limit 20   # a taste, for checking the ladder
 *   pnpm domains:classify --recheck    # ignore the ledger, ask everything again
 *   pnpm domains:classify --no-model   # tiers 0.5 and 1 only, zero tokens
 *
 * 667 hosts exist, the state's own directory names 269 of them, and the rest
 * have been "the work queue" for a while. Reading 285 homepages by hand is not
 * a plan, and neither is throwing 285 pages at a strong model.
 *
 * So: a ladder, each rung only touching what the one above could not settle.
 *
 *   0    directory + naming rules   free      done already, in lib/registry.mjs
 *   0.5  dns.lookup                 free      ~a quarter of the queue is dead
 *   1    fetch, read the title      free      measured 7 usable titles in 10
 *   2    qwen3-32b, batched         ~cents    titles a regex cannot read
 *
 * Tier 3, a Firecrawl scrape for pages that are an empty JavaScript shell, is
 * deliberately not here. This run reports how many hosts would need it; if that
 * number is small, hand-checking them is cheaper than writing the rung.
 *
 * Every row records which tier decided it. That is the point of the whole file.
 * A title saying "Digital Gujarat" is weaker evidence than the state publishing
 * that URL under a department name, and the day someone builds on top of this
 * they need to be able to tell those two apart without re-deriving anything.
 *
 * What this never does: name a host it could not reach, guess a department it
 * did not read, or let the model invent a category that is not in the list.
 */

import { appendJsonl, chat, fetchPage, hostOf, htmlMeta, jsonArray, ledger, looksSoft404, MODELS, pool, resolves, saveLedger, toText } from "./lib.mjs";
import { buildRegistry, CATEGORIES } from "../lib/registry.mjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LEDGER = ".ingest/domains.jsonl";
const OBSERVED = fileURLToPath(new URL("../../docs/research/domains/observed.tsv", import.meta.url));
const CONCURRENCY = 8;
const BATCH = 25;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const VALID = new Set(CATEGORIES.map(([k]) => k).filter((k) => k !== "UNCLASSIFIED" && k !== "DEAD"));

// ------------------------------------------------------------------ tier 1

/**
 * What a page calls itself, mapped to a category.
 *
 * Reading the words on the page, not the hostname. `iora.gujarat.gov.in` means
 * nothing to a regex; its title says "Integrated Online Revenue Applications"
 * and that is a department portal in anyone's book. First match wins, so the
 * specific rows sit above "the word department appears somewhere".
 */
const TEXT_RULES = [
  // The server answering instead of a site. Nobody's citizen service is called
  // "Welcome to nginx", and IIS shipping its own homepage means nothing is
  // deployed here at all.
  [/welcome to nginx|apache2? (ubuntu |debian )?default page|iis windows server|it works!|test page for the apache/, "INFRASTRUCTURE"],
  [/\b(webmail|roundcube|zimbra|outlook web|cpanel|plesk|phpmyadmin|grafana|kibana|jenkins|sonarqube)\b/, "INFRASTRUCTURE"],

  // Gujarati alongside English throughout, because a good half of this estate
  // renders its own name in Gujarati and only the chrome in English. Sending
  // those to a paid model to be told they say "police" would be a strange way
  // to spend money on a word we can match for free.
  [/\bcollector(ate)?\b|district magistrate|jilla collector|કલેક્ટર/, "DISTRICT_COLLECTOR"],
  [/district panchayat|jilla panchayat|taluka panchayat|પંચાયત/, "DISTRICT_PANCHAYAT"],
  [/municipal corporation|nagarpalika|nagar palika|municipality|mahanagar seva sadan|urban local bod|નગરપાલિકા|મહાનગરપાલિકા/, "MUNICIPAL"],
  [/\bpolice\b|superintendent of police|commissioner of police|anti[- ]corruption|prison|jail|home guard|પોલીસ|ગૃહ ?વિભાગ/, "POLICE"],
  [/regional transport|\brto\b|motor vehicle|driving licen[cs]e|vehicle registration|વાહન|પરિવહન/, "TRANSPORT_RTO"],
  [/universit|vidyapith|college|polytechnic|education board|examination board|shikshan|vidyalaya|school of |institute of technolog|admission committee|\bnit\b|\biit\b|યુનિવર્સિટી|શિક્ષણ|વિદ્યાલય/, "EDUCATION"],
  [/\b(high )?court\b|tribunal|judicial|nyayalaya|lok adalat|legal services authority|અદાલત|ન્યાયાલય/, "JUDICIARY"],
  // Service portal before department: a page whose job is to take applications
  // is a service portal even when it is run by a directorate.
  [/apply online|online application|citizen (login|portal|service)|e-?service|user login|new registration|track (your )?application|grievance|seva ?setu|\bportal\b|અરજી|ઓનલાઈન/, "SERVICE_PORTAL"],
  [/department|directorate|commissionerate|\bboard\b|corporation|nigam|mandal|authority|bureau|council|commission|ministry|government of gujarat|gujarat state|વિભાગ|નિગમ|ગુજરાત સરકાર/, "DEPARTMENT"],
];

/** Chrome around the actual name: "Home | X", "Welcome to X", "X :: GoG". */
const NAME_NOISE = /^(home|welcome( to)?|index|official website( of)?)\s*[|:\-–—]*\s*|\s*[|:\-–—]+\s*(home|official website|government of gujarat|gujarat government|goverment of gujarat)\s*$/gi;

/** Words a government body uses about itself, in either language. */
const ORG_WORD = /department|directorate|mission|board|corporation|commission|committee|authority|council|office|centre|center|bureau|nigam|mandal|yojana|portal|universit|court|panchayat|municipal|police|વિભાગ|નિગમ|યોજના|કચેરી|પંચાયત/i;

/**
 * Page furniture that a heading tag happens to be wrapped around.
 *
 * `garvi.gujarat.gov.in` has `<h1>Banner</h1>`, and both the rules and the model
 * dutifully reported that the Gujarat property registration portal is called
 * Banner. A name that is one of these words is not a name, whoever produced it,
 * which is why this is checked on the model's answer as well as our own.
 */
const NOT_A_NAME = /^(banner|logo|slider|header|footer|menu|navigation|main( content)?|content|image|photo|title|untitled|welcome|home ?page|skip to (main )?content|search|login|sign in|left|right|top|bottom)$/i;

/**
 * What this body calls itself, out of the title and the first heading.
 *
 * Neither one wins by default. The h1 is usually the real name, right up until
 * it is a visitor counter: arogyasathi's heading is literally "Website Visits
 * 583" while its title says National Health Mission. So both get scored, an
 * organisational word is worth more than a number, and the better one wins.
 */
function readName(meta) {
  const score = (name) => (ORG_WORD.test(name) ? 2 : 0) - (/\d{2,}/.test(name) ? 3 : 0);
  const candidates = [meta.h1, meta.title]
    .map((raw) => (raw ?? "").replace(NAME_NOISE, "").replace(/\s+/g, " ").trim())
    .filter((name) => name.length >= 4 && name.length <= 120 && /\p{L}/u.test(name) && !NOT_A_NAME.test(name));
  if (!candidates.length) return null;
  // Stable on a tie: h1 is first in the list and sort is stable, so the heading
  // still wins when nothing distinguishes them.
  return candidates.sort((a, b) => score(b) - score(a))[0];
}

function tier1(meta) {
  const text = `${meta.title} ${meta.h1} ${meta.description}`.toLowerCase();
  const hit = TEXT_RULES.find(([pattern]) => pattern.test(text));
  return hit ? hit[1] : null;
}

// ------------------------------------------------------------------ tier 2

const SYSTEM = [
  "You classify Indian government websites from the text they show on their own homepage.",
  `Answer with a JSON array only. One object per host: {"host": string, "category": string, "name": string}.`,
  `category must be exactly one of: ${[...VALID].join(", ")}, or UNKNOWN.`,
  // Four of the first fifty answers made exactly this mistake: a fibre network
  // company, a smart city authority and a pollution board's vehicle tracker were
  // all called INFRASTRUCTURE because infrastructure is what they are about.
  "INFRASTRUCTURE is about the website, never about the subject. It means a mail server, a monitoring tool, a staging copy or a default server page. A state corporation that builds roads, fibre or cities is a DEPARTMENT.",
  "name is the organisation's own name as it appears in the text you were given. Never translate it, never expand an abbreviation, never write a name that is not in the text.",
  "Never answer with a word from the page furniture such as Banner, Home, Logo, Menu or Welcome. If the text does not contain the organisation's name, leave name empty.",
  "Answer UNKNOWN when the text does not say what the organisation is. UNKNOWN is a correct answer and a guess is not: this feeds a system that routes citizens to government offices.",
].join("\n");

async function tier2(rows) {
  // With the page text, not just the header. Starving it of the body was a false
  // economy: given only "Home | Garvi" the model guessed, and called the state
  // property registration portal a piece of infrastructure. The body says
  // "Superintendent of Stamps" in the first paragraph. The page is already
  // fetched and sitting in memory, so this costs input tokens on a cheap model
  // and buys the difference between an answer and a guess.
  const shown = (r) => `${r.meta.title} ${r.meta.h1} ${r.meta.description} ${r.text.slice(0, 1200)}`;
  const listed = rows
    .map((r) => `${r.host}\ntitle: ${r.meta.title || "-"}\nheading: ${r.meta.h1 || "-"}\ndescription: ${r.meta.description || "-"}\npage text: ${r.text.slice(0, 1200).replace(/\n+/g, " / ") || "-"}`)
    .join("\n\n");
  const reply = await chat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Classify these ${rows.length} hosts.\n\n${listed}` },
    ],
    { model: MODELS.tier1, maxTokens: 4000 },
  );
  if (!reply) return new Map();

  const wanted = new Map(rows.map((r) => [r.host, r]));
  const out = new Map();
  for (const item of jsonArray(reply.text) ?? []) {
    // Everything below is the safety property, not defensive habit. A model that
    // returns a host we did not ask about, or a category we do not have, is
    // making things up, and the fix is to drop it rather than repair it.
    const host = typeof item?.host === "string" ? item.host.toLowerCase().trim() : null;
    if (!host || !wanted.has(host) || out.has(host)) continue;
    const category = typeof item.category === "string" ? item.category.toUpperCase().trim() : "";
    if (!VALID.has(category)) continue;

    // And the name has to have been in the text we handed it. Same rule as every
    // quote in this repo: if it is not in the source, it did not come from the
    // source, and a plausible department name is the most dangerous kind.
    const source = shown(wanted.get(host)).toLowerCase();
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const grounded = name.length >= 4 && !NOT_A_NAME.test(name) && source.includes(name.toLowerCase());
    out.set(host, { category, name: grounded ? name : null, model: reply.model });
  }
  return out;
}

// --------------------------------------------------------------- self test

/**
 * `pnpm domains:classify --selftest`, no network, runs in the gates.
 *
 * The two rungs that make free decisions about what a government body is. Both
 * were wrong on the first real run in ways that read fine in the source: the
 * heading picker named a health mission "Website Visits 583", and every rule
 * was English-only on an estate that is half Gujarati.
 */
if (flag("selftest")) {
  const { strict: assert } = await import("node:assert");

  assert.equal(readName({ h1: "Website Visits 583", title: "-::-National Health Mission :: Govt. Of Gujarat" }), "-::-National Health Mission :: Govt. Of Gujarat");
  assert.equal(readName({ h1: "Food and Drugs Control Administration", title: "FDCA" }), "Food and Drugs Control Administration");
  assert.equal(readName({ h1: "", title: "Home | Garvi" }), "Garvi", "leading Home| is chrome, not a name");
  assert.equal(readName({ h1: "", title: "" }), null);
  assert.equal(readName({ h1: "Banner", title: "Home | Garvi" }), "Garvi", "page furniture is not a name");
  assert.equal(readName({ h1: "મુખ્યમંત્રી માતૃશક્તિ યોજના", title: "" }), "મુખ્યમંત્રી માતૃશક્તિ યોજના", "a Gujarati only name is a name");

  assert.equal(tier1({ title: "અધિક પોલીસ મહાનિદેશકશ્રી", h1: "", description: "" }), "POLICE");
  assert.equal(tier1({ title: "Admission Committee for Professional Courses", h1: "", description: "" }), "EDUCATION");
  assert.equal(tier1({ title: "Welcome to nginx!", h1: "", description: "" }), "INFRASTRUCTURE", "a default server page is not a service");
  assert.equal(tier1({ title: "Apply Online", h1: "", description: "" }), "SERVICE_PORTAL");
  assert.equal(tier1({ title: "Some Thing", h1: "", description: "" }), null, "no signal is not a category");

  console.log("domains-classify: ok");
  process.exit(0);
}

// ------------------------------------------------------------------ audit

const now = new Date().toISOString();
const registry = buildRegistry();
const known = new Map(registry.map((r) => [r.host, r]));
const decided = ledger(LEDGER, "host");

/**
 * `pnpm domains:classify --audit 20`, the only honest test of Tier 1.
 *
 * The hosts the state's own directory names never enter the queue, which makes
 * them free ground truth: fetch one, run the text rules over it, and compare
 * what the rules say to what the government says. Every disagreement is a bug
 * in the ladder, and it is much cheaper to find them here than to find them
 * three phases later in a citizen's journey.
 *
 * Costs nothing but HTTP. No model, no Firecrawl.
 */
if (flag("audit")) {
  const n = Number(value("audit", 20));
  // Every third one, not the first n: the file is alphabetical by department and
  // the first twenty are all Agriculture, which would prove nothing.
  const truth = registry.filter((r) => r.basis === "GSWAN directory").filter((_, i) => i % 3 === 0).slice(0, n);
  let agree = 0;
  let silent = 0;
  const disagreements = [];
  await pool(truth, CONCURRENCY, async (r) => {
    const res = await fetchPage(`https://${r.host}/`, { timeoutMs: 15000 });
    if (!res.ok) return void disagreements.push([r.host, r.category, `unreachable (${res.failure})`, ""]);
    const meta = htmlMeta(res.body);
    const guess = tier1(meta);
    if (!guess) return void silent++;
    if (guess === r.category) agree++;
    else disagreements.push([r.host, r.category, guess, (meta.title || meta.h1 || "").slice(0, 60)]);
  });
  for (const [host, want, got, why] of disagreements.sort()) console.log(`  ${host.padEnd(32)} directory says ${want.padEnd(19)} rules say ${got.padEnd(19)} ${why}`);
  console.log(`\n${truth.length} hosts the government itself named: ${agree} agree, ${disagreements.length} disagree, ${silent} the rules had nothing to say about.`);
  process.exit(0);
}

// -------------------------------------------------------------------- run


/**
 * What still needs asking.
 *
 * Normally: the hosts nothing has explained, minus the ones already in the
 * ledger, so a second run costs nothing and a killed run resumes.
 *
 * Under --recheck, also every host this script itself decided, which is exactly
 * the rows whose basis starts with "tier". Without that clause a host leaves the
 * UNCLASSIFIED queue the moment we name it and can never be looked at again, so
 * improving a rule would only ever apply to whatever had not been reached yet.
 *
 * And no further than that. Anything the directory or a naming rule can now
 * explain belongs to Tier 0 and is not asked again: a regex that has learned to
 * recognise a staging host should take it back off the model, not leave the
 * ledger claiming a model decided something free.
 */
const ours = (r) => r.category === "UNCLASSIFIED" || r.basis.startsWith("tier");
const queue = registry
  .filter((r) => (flag("recheck") ? ours(r) : r.category === "UNCLASSIFIED"))
  .map((r) => r.host)
  .filter((h) => flag("recheck") || !decided.has(h))
  .slice(0, Number(value("limit", Infinity)));

console.log(`${registry.length} hosts, ${registry.filter((r) => r.category === "UNCLASSIFIED").length} unclassified, ${decided.size} already decided, ${queue.length} to do`);
if (!queue.length) process.exit(0);

// Tier 0.5. The cheapest rung: no HTTP request, no timeout, no retry.
const alive = [];
const stats = { DEAD: 0, REDIRECT: 0, UNKNOWN: 0 };
await pool(queue, 32, async (host) => {
  if (await resolves(host)) return alive.push(host);
  stats.DEAD++;
  decided.set(host, { host, state: "DEAD", category: "DEAD", name: null, tier: "tier 0.5 dns", evidence: null, checkedAt: now });
});
console.log(`  tier 0.5: ${stats.DEAD} do not resolve, ${alive.length} answer dns`);

// Tier 1. Fetch the homepage, read what it calls itself.
const ambiguous = [];
let fetched = 0;
await pool(alive, CONCURRENCY, async (host) => {
  const res = await fetchPage(`https://${host}/`, { timeoutMs: 15000 });
  const row = { host, state: "UNKNOWN", category: null, name: null, tier: "tier 1 fetch", evidence: null, checkedAt: now, tlsVerified: res.tlsVerified !== false };

  if (!res.ok) {
    row.state = "UNREACHABLE";
    row.evidence = res.failure ?? `HTTP ${res.status}`;
    return decided.set(host, row);
  }
  fetched++;

  const meta = htmlMeta(res.body);
  const text = toText(res.body ?? "");
  if (looksSoft404(text, meta, res.contentType)) {
    // A 200 that means 404. Recording it as a live unnamed host would put it
    // back in the queue forever, which is exactly what this ledger is for.
    row.state = "SOFT_404";
    row.evidence = meta.title || null;
    return decided.set(host, row);
  }

  // Redirected off its own hostname. The site is somewhere else, and if we
  // already know that somewhere it inherits the answer for free.
  const landed = hostOf(res.finalUrl ?? "");
  if (landed && landed !== host) {
    const target = known.get(landed);
    row.state = target && target.category !== "UNCLASSIFIED" ? "DUPLICATE" : "REDIRECT";
    row.category = target && target.category !== "UNCLASSIFIED" ? target.category : null;
    row.name = target?.name ?? null;
    row.tier = "tier 1 redirect";
    row.evidence = landed;
    row.redirectTo = landed;
    stats.REDIRECT++;
    return decided.set(host, row);
  }

  const category = tier1(meta);
  const name = readName(meta);
  if (category) {
    row.state = "VERIFIED_SOURCE";
    row.category = category;
    row.name = name;
    row.evidence = (meta.title || meta.h1 || "").slice(0, 120);
    return decided.set(host, row);
  }

  // Reached it, read it, and the rules had nothing to say. Tier 2's queue.
  row.evidence = (meta.title || meta.h1 || "").slice(0, 120);
  if (meta.title || meta.h1 || meta.description || text.length > 200) ambiguous.push({ host, meta, text, row });
  else {
    row.state = "EMPTY_BODY"; // a JavaScript shell, which is Tier 3's problem
    decided.set(host, row);
  }
});
console.log(`  tier 1: ${fetched} pages read, ${stats.REDIRECT} redirect elsewhere, ${ambiguous.length} titles the rules could not read`);

// Tier 2. Batched, cheap model, title and heading only. Never the whole page:
// the question is "what is this body called", and the answer is in the header.
if (ambiguous.length && !flag("no-model")) {
  const batches = Array.from({ length: Math.ceil(ambiguous.length / BATCH) }, (_, i) => ambiguous.slice(i * BATCH, i * BATCH + BATCH));
  const answers = await pool(batches, 3, tier2);
  let named = 0;
  for (const [i, batch] of batches.entries()) {
    const got = answers[i] ?? new Map();
    for (const { host, row } of batch) {
      const hit = got.get(host);
      if (!hit) {
        stats.UNKNOWN++;
        decided.set(host, row);
        continue;
      }
      named++;
      decided.set(host, { ...row, state: "PROBABLE", category: hit.category, name: hit.name, tier: `tier 2 ${hit.model}` });
    }
  }
  console.log(`  tier 2: ${named} of ${ambiguous.length} classified by ${MODELS.tier1}`);
} else {
  for (const { host, row } of ambiguous) {
    stats.UNKNOWN++;
    decided.set(host, row);
  }
  if (ambiguous.length) console.log(`  tier 2: skipped, ${ambiguous.length} left UNKNOWN`);
}

// ----------------------------------------------------------------- output

// Rows a Tier 0 rule has since learned to explain for free. Dropping them keeps
// the ledger honest about which rung decided what, and costs nothing: take the
// rule away again and the host comes straight back to the queue, which is
// exactly what should happen.
for (const r of registry) if (r.category !== "UNCLASSIFIED" && !r.basis.startsWith("tier")) decided.delete(r.host);

saveLedger(LEDGER, decided);
appendJsonl(".ingest/runs.jsonl", [
  {
    run: "domains:classify",
    at: now,
    queued: queue.length,
    dead: stats.DEAD,
    fetched,
    redirects: stats.REDIRECT,
    modelled: ambiguous.length,
    unknown: stats.UNKNOWN,
    firecrawlCredits: 0,
  },
]);

/**
 * The verdicts, in the shape lib/registry.mjs reads. Only rows that actually
 * decided something: an unreachable host stays UNCLASSIFIED in the markdown,
 * which is honest, and the ledger is what stops us checking it again tomorrow.
 */
const rows = [...decided.values()]
  .filter((r) => r.category)
  .sort((a, b) => a.host.localeCompare(b.host))
  .map((r) => [r.host, r.category, r.name ?? "", r.tier, (r.evidence ?? "").replace(/[\t\n]+/g, " ")].join("\t"));

writeFileSync(
  OBSERVED,
  [
    "# What the hosts said they were, written by `pnpm domains:classify`.",
    "# Do not edit by hand: the next run overwrites it. To correct a row, put",
    "# the right answer in gswan-department-directory.tsv instead, which is read",
    "# first and wins.",
    "#",
    "# host<TAB>category<TAB>name<TAB>deciding tier<TAB>what the page said",
    ...rows,
    "",
  ].join("\n"),
);

console.log(`\n${rows.length} hosts now have a verdict. docs/research/domains/observed.tsv written.`);
console.log(`Next: pnpm domains:build`);
const shells = [...decided.values()].filter((r) => r.state === "EMPTY_BODY").length;
if (shells) console.log(`${shells} host(s) served an empty JavaScript shell and would need a rendered scrape (tier 3, not built).`);
