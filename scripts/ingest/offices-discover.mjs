/**
 * Every physical counter the corpus knows about, in one place.
 *
 *   pnpm offices:discover           read the facts, write the bundle
 *   pnpm offices:discover --dry     say what would be written, write nothing
 *   pnpm offices:discover --selftest
 *
 * There are 1808 OFFICE facts across 760 urls and the graph had 48 OFFICE nodes,
 * because the only path from a fact to a node ran through services-compile, and
 * that only ever looks at pages it had already tied to a service. An office
 * directory is not a service page. So the RTO list, the Mamlatdar list and the
 * collectorate contact page all sat there fully extracted and unreachable.
 *
 * This owns OFFICE nodes now, for the whole corpus, and writes them as their own
 * bundle. services-compile links to the ids this produces rather than minting
 * its own, so one office is one node no matter how many journeys visit it.
 *
 * The rules, in order of how much they cost us:
 *
 *   1. An office needs a way to be reached. An address, a phone or an email.
 *      A row with a name and nothing else is a heading, not a counter.
 *   2. An office needs a name that is not a form label. "Address", "Contact
 *      Number" and "Location" are what the page called the *field*, and 300 of
 *      the 903 reachable facts are named that way. Where the fact has no real
 *      name, the page's own title is used and the row is marked NORMALIZED,
 *      because the name then came from us reading the page rather than from a
 *      sentence naming the office.
 *   3. Type is read off the name deterministically. No model: "Regional
 *      Transport Office" is an RTO in every district and a regex knows it.
 *   4. Coordinates are not invented. §21 would allow a geocoded lat/lng marked
 *      DERIVED and there is no geocoder here, so there are none, and the
 *      address is what a citizen gets.
 */

import { at, GRAPH, readJsonl, RESEARCH, sha1 } from "./lib.mjs";
import { display, districtIn, districtOf, isPerson, slug, title } from "./places.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FACTS = ".ingest/facts.jsonl";
const PAGES = ".ingest/pages.jsonl";
const BUNDLE = `${GRAPH}/offices.json`;
const OFFICES_RESEARCH = `${RESEARCH}/offices.json`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const today = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------ naming

/**
 * Keys the extractor has used for a phone number, in the order it used them.
 *
 * Measured, not guessed: `phone` 197, `contact_number` 29, `mobile_number` 16,
 * `mobile` 11, `officeNo` 12, `contact` 17. Reading only `phone` threw away a
 * third of every office anybody could actually ring.
 */
const PHONE_KEYS = ["phone", "phoneNumber", "phone_number", "contact_number", "contactNumber", "mobile_number", "mobile", "officeNo", "office_no", "telephone", "contact"];
const EMAIL_KEYS = ["email", "emailId", "email_id", "mail"];
const NAME_KEYS = ["officeName", "office_name", "name", "institute_name", "institute", "office", "title"];
const HOUR_KEYS = ["hours", "timing", "timings", "officeHours", "working_hours"];

/**
 * What the page called the field, not what it called the office.
 *
 * "Address", "Contact Number", "Location", "Head Office", "Main Office" all
 * arrive in a name key and none of them name a place. An office node called
 * "Contact Number" is worse than no node: it is a counter a citizen cannot
 * find, printed with a real address underneath it.
 */
const FIELD_LABEL = /^(office\s*)?(address|addresses|contact|contacts|contact\s*(no|number|numbers|details|information|info|us)|phone|phone\s*no|telephone|mobile|email|e-mail|location|locations|hours|timing|timings|fax|website|url|name|designation|head\s*office|main\s*office|regional\s*office|branch\s*office|temporary\s*campus|conducted\s*at|competent\s*person|helpline|details|information|more|other|general|home|office)$/i;

/**
 * Office types, longest and most specific pattern first.
 *
 * §19's list. "District Panchayat" must be tested before "Panchayat" or every
 * district panchayat is filed as a gram panchayat, and "Taluka Panchayat"
 * before both.
 */
const TYPES = [
  [/passport\s*seva|psk\b|post\s*office\s*passport/i, "Passport Seva Kendra"],
  [/aadhaar\s*(seva|enrol|enroll)|uidai/i, "Aadhaar Seva Kendra"],
  [/regional\s*transport|\brto\b|\bartO\b|transport\s*office/i, "Regional Transport Office"],
  [/jan\s*seva\s*kendra|citizen\s*service\s*cent(re|er)|\bcsc\b|e-?gram/i, "Jan Seva Kendra"],
  [/sub[- ]?registrar|registrar\s*of\s*(assurance|document)/i, "Sub Registrar Office"],
  [/mamlatdar|mamaltdar/i, "Mamlatdar Office"],
  [/taluka\s*(panchayat|development|office)|\btdo\b/i, "Taluka Panchayat"],
  [/district\s*panchayat|\bddo\b|district\s*development/i, "District Panchayat"],
  [/collector|district\s*magistrate|prant|deputy\s*collector/i, "District Collectorate"],
  [/municipal\s*corporation|mahanagar\s*palika|\b(amc|smc|vmc|rmc|bmc|jmc)\b/i, "Municipal Corporation"],
  [/nagarpalika|nagar\s*palika|municipality|municipal\s*council/i, "Municipality"],
  [/gram\s*panchayat|village\s*panchayat|panchayat\s*office/i, "Gram Panchayat"],
  [/employees'?\s*provident|\bepfo\b|provident\s*fund/i, "EPFO Office"],
  [/employees'?\s*state\s*insurance|\besic\b/i, "ESIC Office"],
  [/police\s*station|police\s*commissioner|superintendent\s*of\s*police/i, "Police Office"],
  [/civil\s*hospital|primary\s*health|community\s*health|health\s*cent(re|er)|\bphc\b|\bchc\b/i, "Health Facility"],
  [/land\s*record|superintendent\s*of\s*land|\bslr\b|city\s*survey/i, "Land Records Office"],
  [/social\s*(welfare|defence|justice)|scheduled\s*caste|tribal\s*development/i, "Social Welfare Office"],
  [/district\s*education|education\s*office|\bdeo\b|\bdpeo\b/i, "District Education Office"],
  [/district\s*supply|supply\s*office|food\s*and\s*civil\s*supplies|rationing/i, "Civil Supplies Office"],
  [/labour\s*(office|commissioner)|industrial\s*safety/i, "Labour Office"],
  [/treasury|pay\s*and\s*accounts/i, "Treasury Office"],
  [/court|tribunal|nyayalaya/i, "Court"],
  [/bank\b|branch\b/i, "Bank Branch"],
];

export function officeType(name) {
  const hit = TYPES.find(([re]) => re.test(String(name ?? "")));
  return hit ? hit[1] : null;
}

/**
 * A phone number a citizen can dial, or null.
 *
 * The extractor returns whatever the page printed, which includes "079-",
 * "N/A", "-" and a four digit extension. Ten digits is the shortest thing that
 * is a number in India, counting the STD code, and a page that printed fewer
 * printed a fragment.
 */
export function phone(value) {
  const s = String(value ?? "").trim();
  if (!s || /^(n\.?a\.?|nil|none|-+)$/i.test(s)) return null;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  // Kept as printed, not reformatted. The page's spacing is the page's.
  return s.replace(/\s+/g, " ").slice(0, 40);
}

export function email(value) {
  const s = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

/** An address is a place if it has a number and enough of it to find. */
export function address(value) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (s.length < 20 || s.length > 300) return null;
  if (FIELD_LABEL.test(s)) return null;
  return s;
}

const first = (detail, keys, clean) => {
  for (const k of keys) {
    const v = clean ? clean(detail?.[k]) : detail?.[k];
    if (v) return v;
  }
  return null;
};

/**
 * What to call this office, and how sure we are the page called it that.
 *
 * EXTRACTED when a sentence on the page names it. NORMALIZED when the only
 * name available is the page's own title, which is us reading a directory and
 * deciding the offices on it belong to the department that published it. Null
 * when neither works, and null is a row we drop rather than a node called
 * "Contact Number".
 */
export function nameOf(fact, pageTitle) {
  const detail = fact.detail ?? {};
  for (const k of NAME_KEYS) {
    const v = String(detail[k] ?? "").replace(/\s+/g, " ").trim();
    if (v.length > 3 && v.length < 120 && !FIELD_LABEL.test(v) && !isPerson(v)) return { name: v, status: "EXTRACTED" };
  }
  const object = title(String(fact.object ?? "")).trim();
  if (object.length > 4 && !FIELD_LABEL.test(object) && officeType(object)) return { name: object, status: "EXTRACTED" };
  // The type, not the title it was found in. A form download page is titled
  // "નોન ક્રીમીલેયર પ્રમાણપત્ર મેળવવા અંગે અરજી | Certificate | Jan Seva Kendra
  // form | Collectorate", and the office on it is a Jan Seva Kendra. The id
  // already hashes in the jurisdiction, so fifteen districts keep fifteen
  // offices; what they stop having is fifteen names nobody could read.
  const t = String(pageTitle ?? "").replace(/\s+/g, " ").trim();
  const type = t.length > 4 && t.length < 200 ? officeType(t) : null;
  return type ? { name: type, status: "NORMALIZED" } : null;
}

// ------------------------------------------------------------------ selftest

if (flag("selftest")) {
  const assert = await import("node:assert/strict").then((m) => m.default);

  assert.equal(officeType("Regional Transport Office, Rajkot"), "Regional Transport Office");
  assert.equal(officeType("Jan Seva Kendra Botad"), "Jan Seva Kendra");
  assert.equal(officeType("Taluka Panchayat Kalavad"), "Taluka Panchayat", "taluka wins over the bare panchayat rule");
  assert.equal(officeType("District Panchayat Surat"), "District Panchayat");
  assert.equal(officeType("Gram Panchayat Desar"), "Gram Panchayat");
  assert.equal(officeType("Office of the Collector, Kheda"), "District Collectorate");
  assert.equal(officeType("Ahmedabad Municipal Corporation"), "Municipal Corporation");
  assert.equal(officeType("Some Department"), null, "an unrecognised name gets no type invented for it");

  assert.equal(phone("079-23251501"), "079-23251501");
  assert.equal(phone("+91 79 2325 1501"), "+91 79 2325 1501");
  assert.equal(phone("1501"), null, "an extension is not a number a citizen can dial");
  assert.equal(phone("N/A"), null);
  assert.equal(phone(""), null);
  assert.equal(email("Collector-AHD@gujarat.gov.in"), "collector-ahd@gujarat.gov.in");
  assert.equal(email("click here"), null);
  assert.equal(address("Contact Number"), null, "a field label is not an address");
  assert.equal(address("Block 5"), null, "too short to find");
  assert.ok(address("Office of The Collector, Near Subhash Bridge Circle, Old Wadaj, Ahmedabad - 380027"));

  const t = (o, page) => nameOf({ detail: o, object: "" }, page);
  assert.equal(t({ officeName: "Regional Transport Office Rajkot" }).name, "Regional Transport Office Rajkot");
  assert.equal(t({ officeName: "Regional Transport Office Rajkot" }).status, "EXTRACTED");
  assert.equal(t({ name: "Contact Number" }), null, "a form label never becomes an office");
  assert.equal(t({ name: "Shri V. C. Bodana" }), null, "the officer is not the office");
  assert.equal(t({ name: "Dr. Prashant Jilova, IAS" }), null);
  // The known ceiling, asserted so it is a decision and not a surprise: a bare
  // name has nothing in it that says person, and guessing would cost us offices.
  assert.equal(t({ name: "Anand Nandurbarkar" }, "Photo Gallery").name, "Anand Nandurbarkar");
  assert.equal(
    t({ address: "..." }, "નોન ક્રીમીલેયર પ્રમાણપત્ર મેળવવા અંગે અરજી | Certificate | Jan Seva Kendra form | Collectorate").name,
    "Jan Seva Kendra",
    "the office on a form page is the office, not the form's title",
  );
  assert.equal(t({ address: "..." }, "Mamlatdar Office | Kheda District").status, "NORMALIZED", "the page title is us reading, not the page saying");
  assert.equal(t({ address: "..." }, "Mamlatdar Office | Kheda District").name, "Mamlatdar Office");
  assert.equal(t({ address: "..." }, "Photo Gallery"), null, "a page title that is not an office does not become one");
  assert.equal(
    nameOf({ detail: {}, object: "jan_seva_kendra" }, null).name,
    "Jan seva kendra",
    "an object that reads like a place is a name, once we know what kind of place it is",
  );
  assert.equal(nameOf({ detail: {}, object: "application_submission" }, null), null);

  console.log("offices-discover: ok");
  process.exit(0);
}

// ---------------------------------------------------------------------- read

const pages = new Map(readJsonl(PAGES).map((p) => [p.url, p]));
const facts = readJsonl(FACTS).filter((f) => f.kind === "OFFICE");

/** id -> office under construction */
const offices = new Map();
let unreachable = 0;
let unnamed = 0;

for (const f of facts) {
  const detail = f.detail ?? {};
  const where = address(detail.address ?? detail.location ?? detail.office_address);
  const tel = first(detail, PHONE_KEYS, phone);
  const mail = first(detail, EMAIL_KEYS, email);
  if (!where && !tel && !mail) {
    unreachable++;
    continue;
  }

  const page = pages.get(f.url);
  const named = nameOf(f, page?.title);
  if (!named) {
    unnamed++;
    continue;
  }

  const type = officeType(named.name);
  const host = page?.host ?? (() => { try { return new URL(f.url).hostname; } catch { return ""; } })();
  // The address names the place more often than the hostname does: a state wide
  // directory on gujarat.gov.in lists an office in Kheda, and the host says
  // IN-GJ. Read the address first, fall back to the host.
  const jurisdictionId = districtIn(`${named.name} ${where ?? ""}`) ?? districtOf(host);

  const id = `office:${slug(named.name)}_${sha1(`${type ?? ""}|${slug(named.name)}|${jurisdictionId}`).slice(0, 6)}`;
  const existing = offices.get(id);
  const office = existing ?? {
    id,
    name: display(named.name),
    type,
    jurisdictionId,
    status: named.status,
    addresses: new Set(),
    phones: new Set(),
    emails: new Set(),
    hours: new Set(),
    refs: [],
  };
  if (where) office.addresses.add(where);
  if (tel) office.phones.add(tel);
  if (mail) office.emails.add(mail);
  const when = first(detail, HOUR_KEYS, (v) => (typeof v === "string" && v.trim().length > 3 ? v.trim() : null));
  if (when) office.hours.add(when);
  // A name the page actually said beats a name we read off the title, whichever
  // fact arrived first.
  if (named.status === "EXTRACTED" && office.status === "NORMALIZED") {
    office.status = "EXTRACTED";
    office.name = display(named.name);
  }
  if (office.refs.length < 6 && !office.refs.some((r) => r.url === f.url)) {
    office.refs.push({ url: f.url, evidence: f.evidence, confidence: f.confidence, claim: f.claim });
  }
  offices.set(id, office);
}

// --------------------------------------------------------------------- write

const sources = [];
const sourceFor = (url) => {
  const page = pages.get(url);
  // Namespaced. services-compile keys a source on sha1(url) too, and 45 of the
  // pages that name an office are also service pages, so sharing the scheme
  // made one url two rows with one id in the merged graph.
  const id = `src:office_${sha1(url).slice(0, 10)}`;
  if (!sources.some((s) => s.id === id)) {
    sources.push({
      id,
      url,
      title: page?.title ?? url,
      domain: page?.host ?? "",
      sourceType: "OFFICE_DIRECTORY",
      jurisdictionId: districtOf(page?.host),
      retrievedAt: (page?.fetchedAt ?? "").slice(0, 10) || today(),
      ...(page?.contentHash ? { contentHash: page.contentHash } : {}),
      cacheFile: `.ingest/pages/${page?.sha1}.md`,
      scrapedOk: true,
      ...(page?.tlsVerified === false ? { tlsVerified: false } : {}),
    });
  }
  return id;
};

const nodes = [];
const researchFacts = [];
const notFound = [];

for (const office of [...offices.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  const refs = office.refs.map((r) => ({
    sourceId: sourceFor(r.url),
    evidence: r.evidence,
    confidence: r.confidence,
    verificationStatus: office.status,
  }));
  const addresses = [...office.addresses];
  if (addresses.length > 1) {
    // §42. Two pages printing two addresses for one office is not something to
    // resolve by picking the longer one.
    notFound.push(
      `${office.name}: ${addresses.length} different addresses are published for it across ${office.refs.length} page(s), so the node carries the first and the disagreement is recorded rather than resolved. Someone has to ring them.`,
    );
  }
  nodes.push({
    id: office.id,
    type: "OFFICE",
    name: office.name,
    jurisdictionId: office.jurisdictionId,
    metadata: {
      channelType: "PHYSICAL_OFFICE",
      machineExtracted: true,
      ...(office.type ? { officeType: office.type } : {}),
      ...(addresses.length ? { address: addresses[0] } : {}),
      ...(office.phones.size ? { phoneNumbers: [...office.phones].slice(0, 6) } : {}),
      ...(office.emails.size ? { emails: [...office.emails].slice(0, 4) } : {}),
      // `workingHours` is the name in NodeMetadata and the name the compiler
      // reads. This wrote `hours` for 38 offices, so every published opening
      // time was dropped on the floor between the graph and the screen.
      ...(office.hours.size ? { workingHours: [...office.hours][0] } : {}),
      ...(addresses.length > 1 ? { conflictingAddresses: addresses.slice(1, 4) } : {}),
    },
    sources: refs,
    lastVerifiedAt: today(),
  });
  for (const r of office.refs) {
    researchFacts.push({
      claim: r.claim,
      kind: "OFFICE",
      subject: office.id,
      object: office.type ?? "office",
      detail: { name: office.name, ...(addresses.length ? { address: addresses[0] } : {}) },
      sourceId: sourceFor(r.url),
      evidence: r.evidence,
      confidence: r.confidence,
    });
  }
}

const byType = {};
for (const n of nodes) byType[n.metadata.officeType ?? "(untyped)"] = (byType[n.metadata.officeType ?? "(untyped)"] ?? 0) + 1;
const byJurisdiction = new Set(nodes.map((n) => n.jurisdictionId));

console.log(`${facts.length} OFFICE fact(s) -> ${nodes.length} office(s) across ${byJurisdiction.size} jurisdiction(s)`);
console.log(`  ${unreachable} had no address, phone or email and were dropped`);
console.log(`  ${unnamed} had no name that was not a form label and were dropped`);
for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${type}`);
console.log(`  ${nodes.filter((n) => n.sources[0]?.verificationStatus === "NORMALIZED").length} named from the page title rather than a sentence`);

if (flag("dry")) {
  console.log("\n--dry, nothing written.");
  process.exit(0);
}

// A run that found nothing must not blank a bundle that had something. Same
// rule services-compile uses: an empty result is a broken pipeline, not news.
const before = existsSync(BUNDLE) ? JSON.parse(readFileSync(BUNDLE, "utf8")).nodes.length : 0;
if (nodes.length < before * 0.8) {
  console.error(`\n${nodes.length} office(s) is fewer than the ${before} already written. Nothing written. Check .ingest/facts.jsonl and run again.`);
  process.exit(1);
}

const forGraph = sources.map(({ cacheFile, scrapedOk, ...rest }) => rest);
writeFileSync(BUNDLE, JSON.stringify({ id: "offices", sources: forGraph, nodes, edges: [], requirementGroups: [], questions: [] }, null, 2) + "\n");
writeFileSync(
  OFFICES_RESEARCH,
  JSON.stringify({ journey: "offices", researchedAt: today(), region: "Gujarat, India", sources, facts: researchFacts, notFound }, null, 2) + "\n",
);
console.log(`\nWrote ${BUNDLE} and ${RESEARCH}. Run pnpm graph:validate.`);
