/**
 * Turn grounded facts into journey bundles a citizen can actually be routed through.
 *
 *   pnpm services:compile                 # every journey with enough evidence
 *   pnpm services:compile --min 3          # how many hard facts a page needs
 *   pnpm services:compile --dry            # identify and report, write nothing
 *   pnpm services:compile --selftest
 *
 * This is the transform that has never existed in this repo. Until now
 * `docs/research/` and `packages/core/src/data/graph/` were both written by
 * hand, separately, and only an audit tied them together. Here they are emitted
 * as a pair from one input, so they cannot disagree.
 *
 * ------------------------------------------------------------------------
 * WHAT THIS IS ALLOWED TO INVENT: nothing.
 *
 * Every node and every edge carries SourceRefs whose evidence came off a page,
 * and `pnpm quotes:audit` re-checks them against the research file afterwards.
 * The one thing a model contributes that is not a quote is the service's *name*
 * and one-line summary, and both are constrained to the words already on the
 * page.
 *
 * Everything here is written as `EXTRACTED`, never `VERIFIED`. A machine proved
 * the quote is on the page. Nobody has yet confirmed the page is current, that
 * the office still exists, or that the rule still applies. Those are different
 * claims and the graph has separate words for them, so we use the honest one.
 * ------------------------------------------------------------------------
 *
 * The unit of canonicalisation is the page, not the model's per-fact `subject`.
 * Extraction invented 1529 subjects across 4383 facts, including `applicant`,
 * `citizen` and `application_form`, which are not services. A government service
 * page, on the other hand, is reliably about one service.
 */

import { at, chat, jsonArray, pool, readJsonl, sha1 } from "./lib.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const IDENTIFY = ".ingest/identify/";
const PROMPT_VERSION = 2;
const CONCURRENCY = 8;
/** Facts that describe what a citizen must do, as opposed to what a page mentions. */
const HARD = ["DOCUMENT_REQUIREMENT", "ELIGIBILITY", "FEE", "TIMELINE", "CONDITIONAL_REQUIREMENT"];

/**
 * Form fields the extractor reported as documents, because the page listed them
 * under the same heading.
 *
 * "Attach your Aadhaar card" and "enter your gender" both appear under
 * Requirements on a Gujarat application page, and the model is not wrong to read
 * both as required. But a citizen cannot go and obtain a gender, so
 * `document:gender` is a node nobody can ever satisfy, and the journey engine
 * would present it as a blocker forever.
 *
 * ponytail: a stoplist, not a classifier. If this grows past about thirty
 * entries the right answer is to ask the extractor for a `fieldNotDocument`
 * flag at extraction time, where the page text is still in hand.
 */
const FIELDS = new Set([
  "name", "full_name", "applicant_name", "father_name", "mother_name", "gender", "age", "date_of_birth",
  "address", "applicant_address", "mobile_number", "phone_number", "email", "email_id", "contact_details",
  "bank_name", "bank_account_number", "ifsc_code", "account_number", "format", "documents", "document",
  "details", "information", "signature", "declaration", "application_form", "form", "fee", "amount",
]);
/** Below this a bundle is a stub pretending to be a journey. */
const MIN_SERVICES = 3;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const today = () => new Date().toISOString().slice(0, 10);
const slug = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

/**
 * The journeys this is allowed to produce, and what belongs in each.
 *
 * A closed list on purpose. An open one lets a model invent a journey per page
 * and produce fifty bundles of one service each, which is not coverage, it is
 * filing. Names are checked against the bundles that already exist so a
 * generated file can never overwrite a hand written one.
 */
const JOURNEYS = {
  "district-certificates": "a certificate issued over the counter at a District Collectorate or Jan Seva Kendra: domicile, EWS, heirship or varsai, senior citizen, small savings, solvency, character",
  "welfare-schemes": "cash assistance, sahay, yojana or scholarship paid to a citizen who qualifies",
  "permits-and-licences": "a permit or licence a person or business must hold: forest, film shooting, drug manufacture, electrical contractor, weights and measures, safari booking",
  "ration-card": "a ration card, a name change on one, or the public distribution system",
  "birth-death": "registering a birth or a death, or getting that certificate",
  "property-and-land": "land records, 7/12, property registration, stamp duty, mutation",
  marriage: "registering a marriage or getting a marriage certificate",
  "voter-id": "voter registration, an EPIC card, or the electoral roll",
  "msme-and-udyam": "Udyam or MSME registration and the benefits that follow it",
  startup: "recognising or registering a startup",
  passport: "an Indian passport, fresh or reissue, and police verification",
  aadhaar: "Aadhaar enrolment, update, or authentication",
  pan: "a PAN card, fresh or corrected",
  gst: "GST registration, returns or cancellation",
};

/** Bundles that already exist and were written by a person. Never overwritten. */
const EXISTING = new Set(
  readdirSync(at("packages/core/src/data/graph/"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "")),
);

const DISTRICTS = [
  "AHMEDABAD", "AMRELI", "ANAND", "ARAVALLI", "BANASKANTHA", "BHARUCH", "BHAVNAGAR", "BOTAD", "CHHOTA_UDEPUR",
  "DAHOD", "DANG", "DEVBHOOMI_DWARKA", "GANDHINAGAR", "GIR_SOMNATH", "JAMNAGAR", "JUNAGADH", "KHEDA", "KUTCH",
  "MAHISAGAR", "MEHSANA", "MORBI", "NARMADA", "NAVSARI", "PANCHMAHAL", "PATAN", "PORBANDAR", "RAJKOT",
  "SABARKANTHA", "SURAT", "SURENDRANAGAR", "TAPI", "VADODARA", "VALSAD",
];

/**
 * What a district is called in a hostname when that is not its name.
 *
 * `collectordwarka.gujarat.gov.in` is the Devbhoomi Dwarka collectorate; the
 * district was renamed and the hostname was not. Kachchh and Kutch are the same
 * place spelled two ways and both spellings are in live use by the state.
 */
const ALIASES = {
  dwarka: "DEVBHOOMI_DWARKA",
  kachchh: "KUTCH",
  bhuj: "KUTCH",
  somnath: "GIR_SOMNATH",
  veraval: "GIR_SOMNATH",
  panchmahals: "PANCHMAHAL",
  godhra: "PANCHMAHAL",
  chhotaudepur: "CHHOTA_UDEPUR",
  modasa: "ARAVALLI",
  lunawada: "MAHISAGAR",
  ahwa: "DANG",
};

/**
 * Which district a host belongs to, or the state.
 *
 * `collectorkheda.gujarat.gov.in` is Kheda's collectorate and its page about the
 * varsai certificate describes Kheda's counter, not Gujarat's. Scoping it to
 * `IN-GJ` would tell someone in Surat to visit an office in Kheda, so the
 * hostname is worth reading.
 *
 * Longest pattern first: "dwarka" and "devbhoomidwarka" both point at the same
 * district, but "somnath" must not be tested before "girsomnath" on a host that
 * has both.
 */
const PATTERNS = [
  ...DISTRICTS.map((d) => [d.toLowerCase().replace(/_/g, ""), d]),
  ...Object.entries(ALIASES),
].sort((a, b) => b[0].length - a[0].length);

export function districtOf(host) {
  const flat = String(host ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const hit = PATTERNS.find(([pattern]) => flat.includes(pattern));
  return hit ? `IN-GJ-${hit[1]}` : "IN-GJ";
}

/** Which of the ten allowed source types this page is, from what it yielded. */
export function sourceTypeOf(url, title, kinds) {
  const path = url.replace(/^https?:\/\/[^/]+/i, "").toLowerCase();
  const text = `${path} ${String(title ?? "").toLowerCase()}`;
  if (/\.pdf$/.test(path)) return "PDF";
  if (/faq|question|પ્રશ્નોત્તર/.test(text)) return "FAQ";
  if (/grievance|complaint|ફરિયાદ/.test(text)) return "GRIEVANCE_PAGE";
  if (/guideline|instruction|manual|circular/.test(text)) return "GUIDELINE";
  if (path === "" || path === "/" || /^\/(index|home|default)\b/.test(path)) return "PORTAL_HOME";
  // Only when the page is mostly that, otherwise every service page with a
  // footer phone number would be filed as a helpline.
  const only = (kind) => kinds.length > 0 && kinds.filter((k) => k === kind).length / kinds.length > 0.6;
  if (only("OFFICE")) return "OFFICE_DIRECTORY";
  if (only("HELPLINE")) return "HELPLINE";
  if (only("TRACKING")) return "TRACKING_PAGE";
  if (only("APP")) return "MOBILE_APP_INFO";
  return "SERVICE_PAGE";
}

/**
 * Words that turn a service's name into the same service's longer name.
 *
 * "Gir Online Permit Booking" and "Gir Online Permit Booking System" came off
 * two pages about one booking system, and shipping both means a citizen who
 * searches for a Gir permit is asked to pick between two identical answers.
 * Merging on prefix alone would be worse — it would fold "Water Connection" into
 * "Water Connection For Industrial Use", which are different applications — so
 * the leftover has to be nothing but filler.
 */
const FILLER = new Set(["system", "scheme", "schemes", "portal", "online", "service", "services", "application", "form", "gujarat", "registration"]);

export function absorbs(shortId, longId) {
  if (shortId === longId || !longId.startsWith(shortId + "_")) return false;
  return longId
    .slice(shortId.length + 1)
    .split("_")
    .every((w) => FILLER.has(w));
}

// ----------------------------------------------------------------- self test

if (flag("selftest")) {
  const { strict: assert } = await import("node:assert");

  assert.equal(districtOf("collectorkheda.gujarat.gov.in"), "IN-GJ-KHEDA");
  assert.equal(districtOf("collectordwarka.gujarat.gov.in"), "IN-GJ-DEVBHOOMI_DWARKA", "Dwarka is Devbhoomi Dwarka, and DWARKA must not win on being shorter");
  assert.equal(districtOf("chhotaudepur.gujarat.gov.in"), "IN-GJ-CHHOTA_UDEPUR", "the underscore is ours, the hostname does not have it");
  assert.equal(districtOf("garvi.gujarat.gov.in"), "IN-GJ", "a state portal is not a district");

  assert.equal(sourceTypeOf("https://x.gov.in/", "Home", []), "PORTAL_HOME");
  assert.equal(sourceTypeOf("https://x.gov.in/faqs.htm", "FAQ", []), "FAQ");
  assert.equal(sourceTypeOf("https://x.gov.in/apply", "Income Certificate", ["DOCUMENT_REQUIREMENT", "FEE"]), "SERVICE_PAGE");
  assert.equal(sourceTypeOf("https://x.gov.in/contact", "Offices", ["OFFICE", "OFFICE", "OFFICE", "FEE"]), "OFFICE_DIRECTORY");
  assert.equal(
    sourceTypeOf("https://x.gov.in/apply", "Apply", ["OFFICE", "DOCUMENT_REQUIREMENT", "FEE"]),
    "SERVICE_PAGE",
    "one office fact on a service page does not make it a directory",
  );

  assert.equal(slug("Varsai (heirship) Certificate"), "varsai_heirship_certificate");

  assert.ok(absorbs("gir_online_permit_booking", "gir_online_permit_booking_system"));
  assert.ok(absorbs("education_loan", "education_loan_scheme"));
  assert.ok(!absorbs("water_connection", "water_connection_for_industrial_use"), "different applications, and a prefix is not evidence they are one");
  assert.ok(!absorbs("ews_certificate", "ews_certificate"), "a name does not absorb itself");
  assert.ok(!absorbs("permit", "gir_permit"), "a suffix match is not a prefix match");

  // The generated bundles must never be able to land on a hand written name.
  for (const name of Object.keys(JOURNEYS)) {
    assert.ok(!EXISTING.has(name) || name === "__never__", `journey "${name}" would overwrite an existing bundle`);
  }

  console.log("services-compile: ok");
  process.exit(0);
}

// -------------------------------------------------------------------- input

const pages = new Map(readJsonl(".ingest/pages.jsonl").map((p) => [p.url, p]));
const byUrl = new Map();
for (const f of readJsonl(".ingest/facts.jsonl")) {
  if (!byUrl.has(f.url)) byUrl.set(f.url, []);
  byUrl.get(f.url).push(f);
}

const MIN_HARD = Number(value("min", 3));
const candidates = [...byUrl.entries()]
  .map(([url, facts]) => ({ url, facts, page: pages.get(url) }))
  .filter((c) => c.page && c.facts.filter((f) => HARD.includes(f.kind)).length >= MIN_HARD)
  .sort((a, b) => b.facts.length - a.facts.length);

console.log(`${byUrl.size} pages with facts, ${candidates.length} with at least ${MIN_HARD} hard facts`);

// ----------------------------------------------------------------- identify

const SYSTEM = [
  "You are told the title of one Indian government web page and the facts that were extracted from it, each with a verbatim quote from that page.",
  "Say which single government service the page is about.",
  "",
  `Answer with a JSON array holding exactly one object: [{"service": string, "aliases": [string], "summary": string, "journey": string, "skip": boolean}]`,
  "",
  "service is the service's name as a citizen would say it, in English, taken from the words already present. Never invent a name and never expand an abbreviation the page does not expand.",
  "aliases are other names for the same thing that appear in the text, including the Gujarati name if the page shows one. Empty array if there are none.",
  "summary is one sentence describing what the service gives a citizen, using only what the facts say. Do not add a requirement, a fee, an office or a timeline that is not in the facts.",
  `journey must be exactly one of these, chosen by what the service is:\n${Object.entries(JOURNEYS).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`,
  "",
  'Set skip to true when the page is not about a service a citizen applies for. Committee member lists, news, staff directories, tender notices, room hire rates and "about us" pages are all skip. So is a page about a service that belongs to no journey above.',
  "",
  "Three traps, all seen in real pages from this estate:",
  "1. An academic course, degree, diploma, syllabus or admission at a university, college or institute is skip, even when the qualification it awards is called a certificate. A Certificate Course in Warehouse Executive is a course somebody studies, not a certificate a government office issues, and district-certificates is not where it goes.",
  "2. A grievance, complaint, vigilance or RTI page is skip. Those are handled elsewhere and do not belong to any journey above.",
  "3. service is the name of the service, never the name of the journey. Answering \"welfare-schemes\" or \"property-and-land\" in the service field is always wrong.",
  "",
  "skip is a correct and common answer. A page filed under the wrong journey is worse than a page left out, because it sends someone down the wrong path.",
].join("\n");

const identifyKey = (contentHash) => sha1(`${contentHash}|${PROMPT_VERSION}`);

mkdirSync(at(IDENTIFY), { recursive: true });

async function identify(c) {
  const file = at(IDENTIFY + identifyKey(c.page.contentHash) + ".json");
  if (existsSync(file)) return { ...JSON.parse(readFileSync(file, "utf8")), cached: true };

  const shown = c.facts
    .slice(0, 40)
    .map((f) => `- [${f.kind}] ${f.claim}  |  quote: "${f.evidence.slice(0, 200)}"`)
    .join("\n");
  const reply = await chat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Page title: ${c.page.title ?? "-"}\nUrl: ${c.url}\n\nFacts:\n${shown}\n\nWhich service is this page about?` },
    ],
    { maxTokens: 800 },
  );

  const got = reply ? (jsonArray(reply.text) ?? [])[0] : null;
  const journey = typeof got?.journey === "string" ? got.journey.trim() : "";
  const name = typeof got?.service === "string" ? got.service.trim() : "";
  const out = {
    url: c.url,
    contentHash: c.page.contentHash,
    // A page we could not identify is skipped, not guessed at. There are 617 of
    // them and no single one is worth being wrong about.
    //
    // The last two clauses are belt and braces for two mistakes the prompt now
    // warns about and a model still occasionally makes: naming the journey
    // instead of the service, and reading "Certificate Course in Warehouse
    // Executive" as a certificate a Mamlatdar issues. Both are unambiguous in
    // text, so neither needs a model to catch it twice.
    skip:
      !got ||
      got.skip === true ||
      !name ||
      name.length < 3 ||
      !Object.hasOwn(JOURNEYS, journey) ||
      Object.hasOwn(JOURNEYS, name.toLowerCase().replace(/\s+/g, "-")) ||
      /\bcertificate course\b|\bdiploma\b|\bsyllabus\b/i.test(name),
    service: name,
    serviceId: slug(name),
    aliases: Array.isArray(got?.aliases) ? got.aliases.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim().toLowerCase()).slice(0, 8) : [],
    summary: typeof got?.summary === "string" ? got.summary.trim().slice(0, 400) : "",
    journey,
    model: reply?.model ?? null,
    promptVersion: PROMPT_VERSION,
  };
  writeFileSync(file, JSON.stringify(out, null, 1));
  return { ...out, cached: false };
}

let calls = 0;
const identified = (await pool(candidates, CONCURRENCY, async (c) => {
  const id = await identify(c);
  if (!id.cached) calls++;
  if (calls && calls % 40 === 0) console.log(`  ${calls} identified`);
  return { ...c, ...id };
})).filter((c) => c && !c.skip);

console.log(`${calls} model calls, ${candidates.length - calls} cached`);
console.log(`${identified.length} pages are about a service in a known journey, ${candidates.length - identified.length} skipped`);

// ------------------------------------------------------- group into services

/** journey -> serviceId -> { name, aliases, summary, pages[] } */
const journeys = new Map();
for (const c of identified) {
  if (!journeys.has(c.journey)) journeys.set(c.journey, new Map());
  const services = journeys.get(c.journey);
  const existing = services.get(c.serviceId);
  if (existing) {
    existing.pages.push(c);
    for (const a of c.aliases) if (!existing.aliases.includes(a)) existing.aliases.push(a);
    continue;
  }
  services.set(c.serviceId, { id: c.serviceId, name: c.service, aliases: [...c.aliases], summary: c.summary, pages: [c] });
}

let merged = 0;
for (const services of journeys.values()) {
  // Longest first, so the survivor is the fuller name and every shorter form
  // folds into it rather than into each other.
  const ids = [...services.keys()].sort((a, b) => b.length - a.length);
  for (const shortId of ids) {
    const into = ids.find((longId) => absorbs(shortId, longId) && services.has(longId));
    if (!into || !services.has(shortId)) continue;
    const winner = services.get(into);
    const loser = services.get(shortId);
    winner.pages.push(...loser.pages);
    if (!winner.aliases.includes(loser.name.toLowerCase())) winner.aliases.push(loser.name.toLowerCase());
    services.delete(shortId);
    merged++;
  }
}
if (merged) console.log(`${merged} service(s) folded into a longer name for the same thing`);

/**
 * Node ids the hand written bundles already own.
 *
 * Two rules come out of this set. A service that already exists is left alone,
 * because a person wrote it and a person did it better. A document that already
 * exists is referenced rather than declared again: the bundles are merged before
 * validation, so pointing an edge at `document:aadhaar_card` works, while
 * declaring a second one is a DUPLICATE_NODE error and, worse, two answers to
 * the same question.
 */
const taken = new Set();
for (const name of EXISTING) {
  if (name === "jurisdictions" || name === "manifest") continue;
  // A journey we generate is not evidence about who owns a node, it is last
  // run's output. Reading it back would let the second run believe every node it
  // is about to write already belongs to somebody, and emit nothing.
  if (Object.hasOwn(JOURNEYS, name)) continue;
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(at(`packages/core/src/data/graph/${name}.json`), "utf8"));
  } catch {
    continue;
  }
  for (const n of bundle.nodes ?? []) taken.add(n.id);
}

// -------------------------------------------------------------------- build

const ref = (sourceId, fact) => ({ sourceId, evidence: fact.evidence, confidence: fact.confidence, verificationStatus: "EXTRACTED" });

function build(journey, services) {
  const sources = [];
  const nodes = [];
  const edges = [];
  const declared = new Set();
  const facts = [];
  const notFound = [];

  /** One graph node, unless somebody already owns that id. */
  const put = (node) => {
    if (declared.has(node.id) || taken.has(node.id)) return false;
    declared.add(node.id);
    nodes.push(node);
    return true;
  };
  const link = (from, to, type, note, refs) => {
    const id = `e:${slug(from)}__${type.toLowerCase()}__${slug(to)}`.slice(0, 120);
    if (edges.some((e) => e.id === id)) return;
    edges.push({ id, from, to, type, verificationStatus: "EXTRACTED", ...(note ? { note } : {}), sources: refs });
  };

  for (const service of services) {
    const serviceNodeId = `service:${service.id}`;
    // A hand written service wins. Its pages are still worth nothing to us here,
    // because whatever we would add, somebody already wrote better.
    if (taken.has(serviceNodeId)) {
      notFound.push(`${service.name}: already in the hand written graph as ${serviceNodeId}, so the pages found for it were not merged in. Reconciling the two is a job for a person.`);
      continue;
    }

    const jurisdictionId = districtOf(service.pages[0].page.host);
    const serviceRefs = [];

    for (const c of service.pages) {
      const sourceId = `src:${sha1(c.url).slice(0, 12)}`;
      if (!sources.some((s) => s.id === sourceId)) {
        sources.push({
          id: sourceId,
          url: c.url,
          title: c.page.title ?? c.service,
          domain: c.page.host,
          sourceType: sourceTypeOf(c.url, c.page.title, c.facts.map((f) => f.kind)),
          jurisdictionId: districtOf(c.page.host),
          retrievedAt: (c.page.fetchedAt ?? "").slice(0, 10) || today(),
          contentHash: c.page.contentHash,
          cacheFile: `.ingest/pages/${c.page.sha1}.md`,
          scrapedOk: true,
          // Carried, not dropped. A quote off an unverified chain is still a
          // quote off that page, and the citizen is shown which it is.
          ...(c.page.tlsVerified === false ? { tlsVerified: false } : {}),
        });
      }

      for (const f of c.facts) {
        facts.push({ claim: f.claim, kind: f.kind, subject: f.subject, object: f.object, detail: f.detail, sourceId, evidence: f.evidence, confidence: f.confidence });
        const r = [ref(sourceId, f)];

        if (f.kind === "DOCUMENT_REQUIREMENT" && f.object && !FIELDS.has(f.object)) {
          const docId = `document:${f.object}`;
          put({ id: docId, type: "DOCUMENT", name: title(f.object), jurisdictionId, sources: r, lastVerifiedAt: today() });
          link(serviceNodeId, docId, "REQUIRES", f.claim, r);
        } else if (f.kind === "OFFICE" && f.detail.officeName) {
          const officeId = `office:${slug(f.detail.officeName)}`;
          put({
            id: officeId,
            type: "OFFICE",
            name: f.detail.officeName,
            jurisdictionId,
            metadata: { channelType: "PHYSICAL_OFFICE", ...(f.detail.address ? { address: f.detail.address } : {}) },
            sources: r,
          });
          link(serviceNodeId, officeId, "VISIT_AT", f.claim, r);
        } else if (f.kind === "HELPLINE" && f.detail.phone) {
          const helpId = `helpline:${slug(f.detail.phone)}`;
          put({ id: helpId, type: "HELPLINE", name: f.detail.phone, jurisdictionId, metadata: { channelType: "PHONE", phone: f.detail.phone }, sources: r });
          link(serviceNodeId, helpId, "CALL_IF", f.claim, r);
        } else if (f.kind === "GRIEVANCE") {
          const gId = `grievance:${slug(service.id)}`;
          put({ id: gId, type: "GRIEVANCE_CHANNEL", name: `Grievances about ${service.name.toLowerCase()}`, jurisdictionId, metadata: { channelType: "GRIEVANCE_PORTAL" }, sources: r });
          link(serviceNodeId, gId, "ESCALATE_TO", f.claim, r);
        } else if (HARD.includes(f.kind) || f.kind === "ACTION" || f.kind === "CHANNEL") {
          // Not its own node, but it is why this service node is believable, so
          // it hangs off the service with its quote intact.
          if (serviceRefs.length < 12) serviceRefs.push(ref(sourceId, f));
        }
      }
    }

    if (!serviceRefs.length) {
      notFound.push(`${service.name}: no quotable requirement, fee or timeline survived, so no service node was written for it.`);
      continue;
    }

    const fees = service.pages.flatMap((c) => c.facts.filter((f) => f.kind === "FEE" && f.detail.amount));
    const times = service.pages.flatMap((c) => c.facts.filter((f) => f.kind === "TIMELINE" && f.detail.days));

    put({
      id: serviceNodeId,
      type: "SERVICE",
      name: service.name,
      officialName: service.name,
      // Omitted rather than empty. Postgres has no way to tell an empty array
      // from an absent one, so writing `[]` here is a round trip that never
      // closes, and "this service has no other names" is exactly what absent
      // already means.
      ...(service.aliases.length ? { aliases: service.aliases } : {}),
      description: service.summary,
      jurisdictionId,
      metadata: {
        // The one honest label that has to survive to the screen. Everything in
        // this bundle was read by a machine and checked by a machine, and that
        // is a different thing from a person having looked at it.
        machineExtracted: true,
        ...(fees[0]?.detail.amount ? { fee: String(fees[0].detail.amount) } : {}),
        ...(times[0]?.detail.days ? { processingDays: String(times[0].detail.days) } : {}),
      },
      sources: serviceRefs,
      lastVerifiedAt: today(),
    });

    const portalHost = service.pages[0].page.host;
    const portalId = `portal:${slug(portalHost)}`;
    if (put({ id: portalId, type: "PORTAL", name: portalHost, jurisdictionId, metadata: { channelType: "WEB", url: `https://${portalHost}/` }, sources: [serviceRefs[0]] })) {
      // nothing further, the edge below is added either way
    }
    link(serviceNodeId, portalId, "APPLY_AT", `Published on ${portalHost}.`, [serviceRefs[0]]);
  }

  // An edge whose service never got written is a dangling edge, and the
  // validator is right to refuse it.
  const live = new Set(nodes.map((n) => n.id));
  const kept = edges.filter((e) => (live.has(e.from) || taken.has(e.from)) && (live.has(e.to) || taken.has(e.to)));

  // The two layers disagree about `cacheFile` and `scrapedOk` on purpose. They
  // are facts about *our fetch*, which the ledger needs and the sources table
  // has no column for, so carrying them into the graph makes `db:push` lose them
  // on the way out and the round trip diff never closes.
  const forGraph = sources.map(({ cacheFile, scrapedOk, ...rest }) => rest);

  return {
    graph: { id: journey, sources: forGraph, nodes, edges: kept, requirementGroups: [], questions: [] },
    research: { journey, researchedAt: today(), region: "Gujarat, India", sources, facts, notFound },
  };
}

const title = (s) =>
  String(s ?? "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

// --------------------------------------------------------------------- write

let written = 0;
const summary = [];
for (const [journey, services] of [...journeys.entries()].sort()) {
  const list = [...services.values()].filter((s) => s.pages.length > 0);
  if (list.length < MIN_SERVICES) {
    summary.push(`${journey}: ${list.length} service(s), below the ${MIN_SERVICES} needed to be a journey. Not written.`);
    continue;
  }
  if (EXISTING.has(journey)) {
    summary.push(`${journey}: refused, a hand written bundle already owns that name.`);
    continue;
  }

  const { graph, research } = build(journey, list);
  if (!graph.nodes.filter((n) => n.type === "SERVICE").length) {
    summary.push(`${journey}: nothing survived with a quotable requirement. Not written.`);
    continue;
  }

  if (!flag("dry")) {
    writeFileSync(at(`packages/core/src/data/graph/${journey}.json`), JSON.stringify(graph, null, 1) + "\n");
    writeFileSync(at(`docs/research/${journey}.json`), JSON.stringify(research, null, 1) + "\n");
  }
  // Whoever declares a node owns it. `document:aadhaar_card` is one document
  // whether welfare-schemes or district-certificates got to it first; the other
  // one points an edge at it and does not declare a second. Bundles are merged
  // before validation, so a cross bundle edge resolves, and a second declaration
  // is a DUPLICATE_NODE error and two answers to one question.
  for (const n of graph.nodes) taken.add(n.id);
  written++;
  const svc = graph.nodes.filter((n) => n.type === "SERVICE").length;
  const doc = graph.nodes.filter((n) => n.type === "DOCUMENT").length;
  summary.push(`${journey}: ${svc} services, ${doc} documents, ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.sources.length} sources`);
}

console.log(`\n${written} bundle(s) ${flag("dry") ? "would be" : ""} written\n`);
for (const s of summary) console.log("  " + s);
if (!flag("dry")) console.log(`\nNow run: pnpm bundles:build && pnpm graph:validate && pnpm quotes:audit`);
