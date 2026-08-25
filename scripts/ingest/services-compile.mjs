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

import { at, chat, jsonArray, pool, readJsonl, REJECTIONS, REJECTION_SUMMARY, rejections, replaceStage, sha1, writeJsonl } from "./lib.mjs";
import { display, districtOf, isPerson, slug, title } from "./places.mjs";
import { norm } from "./gate.mjs";
import { handSaved } from "./chunks.mjs";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const IDENTIFY = ".ingest/identify/";
const PROMPT_VERSION = 2;
const CONCURRENCY = 8;
/** Facts that describe what a citizen must do, as opposed to what a page mentions. */
const HARD = ["DOCUMENT_REQUIREMENT", "ELIGIBILITY", "FEE", "TIMELINE", "CONDITIONAL_REQUIREMENT"];

/**
 * A fact with somewhere to go in the graph, as opposed to one we log and drop.
 *
 * The detail checks are not decoration. A HELPLINE fact with no number is a
 * page saying "call us", and the branch below writes nothing for it, so it is
 * not a reason to spend a model call working out what the page is about.
 */
export function placeable(f) {
  if (HARD.includes(f.kind)) return true;
  if (f.kind === "HELPLINE") return Boolean(f.detail?.phone || f.detail?.number);
  if (f.kind === "OFFICE") return Boolean(f.detail?.address);
  if (f.kind === "CHANNEL" || f.kind === "TRACKING") return Boolean(f.detail?.url);
  return f.kind === "GRIEVANCE";
}

/**
 * Why a fact reached the bottom of the placement chain without becoming a row.
 *
 * The chain in `build` is a run of `else if`s, so a fact that fails every guard
 * falls out of the end and nothing anywhere says which guard it failed. This is
 * asked once, at the bottom, so the answer stays next to the guards rather than
 * being duplicated into fifteen call sites.
 *
 * Reads as a list of near misses on purpose, because that is what it is: an
 * OFFICE fact with a name and no address is one line of a page away from being
 * a place a citizen could walk into, and there are hundreds of them.
 */
export function whyUnplaceable(f) {
  const d = f.detail ?? {};
  if (f.kind === "OFFICE") return officeName(f) ? "NO_LOCATION" : "UNKNOWN_CANONICAL_ENTITY";
  if (f.kind === "HELPLINE") return "NO_CONTACT_VALUE";
  if (f.kind === "TRACKING") return d.url ? "UNTRUSTED_HOST" : "FAILED_NORMALIZATION";
  if (f.kind === "BLOCKER") return "NO_REASON";
  if (f.kind === "DEPENDENCY" || f.kind === "EXTERNAL_DEPENDENCY" || f.kind === "ACCEPTED_ALTERNATIVES") return "AMBIGUOUS_RELATION";
  return "UNSUPPORTED_KIND";
}

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
/**
 * What to call an office, or null if the fact never says.
 *
 * The extractor writes the name under whichever key the page suggested, so
 * `officeName`, `office_name` and `name` are all in use, and often there is no
 * key at all and the name is the fact's own object: "The application must be
 * submitted at the Jan Seva Kendra Ahmedabad" arrives as
 * `object: jan_seva_kendra` with the full address in `detail`.
 *
 * Requiring `officeName` alone threw all of those away, which is how four
 * generated journeys ended up with one office between them. Requiring nothing
 * gives you `office:address`, a node named after a form label. So: take a real
 * name where there is one, fall back to the object where it reads like a place,
 * and refuse where it reads like a field.
 */
export function officeName(fact) {
  const d = fact.detail ?? {};
  const explicit = d.officeName || d.office_name || d.name || d.institute_name || d.institute;
  // A directory page prints the officer beside the office and the extractor
  // writes both into `name`. He gets transferred; the Collectorate does not.
  if (typeof explicit === "string" && explicit.trim().length > 3 && !isPerson(explicit)) return explicit.trim();
  const object = String(fact.object ?? "");
  // "office_address", "contact_email", "office_no" name a field on a page about
  // an office, not the office.
  const fieldish =
    !object ||
    object.length < 5 ||
    FIELDS.has(object) ||
    /^(office_)?(address|email|contact|phone|number|no|url|website|location|hours)$|_(address|email|no|number|url)$/.test(object);
  return fieldish ? officeFromClaim(fact.claim) : object;
}

/**
 * Whose office the address is, taken out of the sentence that gave the address.
 *
 * 201 office facts carry a real address and no name for it, because the page
 * printed the address under a heading and the extractor put the heading's words
 * in `claim` and the address in `detail`. Dropping them cost 107 services an
 * office they had one for, and the alternative people reach for first is worse:
 * naming the node after the building. Six departments answer at Udyog Bhavan,
 * so `office:udyog_bhavan` would merge six offices into one and then send a
 * citizen to whichever won.
 *
 * The sentence already says it. "The Gujarat Biodiversity Board office is
 * located at Aranya Bhavan B Wing" names the office in front of the verb, and
 * "The application must be submitted at the Jan Seva Kendra Ahmedabad" names it
 * after the preposition. So read it off the claim, which is a substring of the
 * page, and refuse anything that does not read like an office: the same two
 * patterns also match "The contact information for the GARVI 2.0 website is at
 * ...", and a website is not somewhere to go.
 *
 * ponytail: over splits. "Jan Seva Kendra in Junagadh" and "Jan Seva Kendra
 * Junagadh office" become two nodes with the same address. Two true offices is
 * a cosmetic problem; one office made of two is a wrong direction, so the merge
 * waits for someone who can check the addresses match.
 */
const OFFICE_LOCATED =
  /^(?:the\s+)?(.{4,90}?)\s+(?:is|are)\s+(?:located|situated|based)\s+(?:at|in)\b|^(?:the\s+)?(.{4,90}?)(?:'s)?\s+(?:office\s+)?address\s+is\b|^(?:the\s+)?(.{4,90}?)\s+is\s+at\b/i;
const OFFICE_SUBMIT =
  /\b(?:submitted|submit|apply|applied|obtained|available|contact)\s+(?:at|to|from)\s+(?:the\s+)?([^.,;()]{4,80})/i;

/** Words that make a phrase a place a citizen can walk into rather than a thing. */
const OFFICE_WORD =
  /\b(department|directorate|commission|commissioner|commissionerate|corporation|board|office|kendra|kacheri|bhavan|bhawan|sadan|sachivalaya|collector|mamlatdar|rto|council|authority|agency|campus|institute|centre|center|magistrate|municipal|panchayat|nagarpalika|taluka|headquarters|prant|કચેરી|ભવન|કેન્દ્ર)\b/i;

export function officeFromClaim(claim) {
  const text = String(claim ?? "").trim();
  const m = OFFICE_LOCATED.exec(text) ?? OFFICE_SUBMIT.exec(text);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
  if (!OFFICE_WORD.test(raw)) return null;

  const name = raw
    // "The application must be submitted to the office of the Electricity
    // Revenue Collector at Block No. 3" hands back the address with the name.
    .replace(/\s+at\s+(?:block|plot|room|floor|near|opp\b|\d).*$/i, "")
    // A qualifier in front of "office of" is not part of the office's name, and
    // keeping it is how one municipal corporation became three nodes.
    .replace(/^(?:main|head|administrative|registration|regional|central|corporate)\s+office\s+(?:of|for)\s+(?:the\s+)?/i, "")
    .replace(/^(?:contact\s+information|address)\s+(?:for|of)\s+(?:the\s+)?/i, "")
    .replace(/'s\s+(?:head|main|administrative)?\s*office$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return name.length > 3 ? name : null;
}

/**
 * Who the page says issues a document, or checks an application before it counts.
 *
 * ISSUED_BY and VERIFIED_BY have been in the edge enum and in the journey
 * engine's attachment list since the seed was written, with zero rows behind
 * them. They are the answer to "and who actually signs this", which a citizen
 * standing at a counter needs and which no other edge carries.
 *
 * Passive voice only, because the passive is the one construction in which the
 * page has named the actor and not merely described a job. "The certificate
 * will be issued by the Mahatma Gandhi Labour Institute" names an issuer;
 * "Mamlatdar issues certificates" is a directory blurb about a role. §26 says
 * do not guess the actor, and the grammar is what stops us guessing.
 *
 * A bare "and" is kept, not split on and not rejected. "Directorate of
 * Marketing and Inspection" is one body whose name contains an "and", and
 * "Mamlatdar and Taluka Development Officer" is two bodies, and no rule tells
 * them apart. Splitting mangles the first; the phrase as printed is true of
 * both, so the node is named exactly what the page said and nobody has to
 * guess. "and then" and "or" and a slash list are different: they say the page
 * declined to name one actor, and those are dropped.
 */
const AUTHORITY_VERB = [
  ["ISSUED_BY", /\b(?:is|are|was|were|will\s+be|shall\s+be)\s+(?:issued|granted)\s+by\s+(?:the\s+)?([^.,;()]{4,70})/i],
  ["ISSUED_BY", /\bmust\s+be\s+obtained\s+from\s+(?:the\s+)?([^.,;()]{4,70})/i],
  ["VERIFIED_BY", /\b(?:is|are|was|were|will\s+be|shall\s+be)\s+(?:verified|attested|countersigned|approved|sanctioned)\s+by\s+(?:the\s+)?([^.,;()]{4,70})/i],
  ["VERIFIED_BY", /\bverification\s+by\s+(?:the\s+)?([^.,;()]{4,70})/i],
];

/**
 * The active voice, which is only trusted on a claim the depth engine retrieved.
 *
 * The passive rule above exists because "Mamlatdar issues certificates" on a
 * crawled page is a directory blurb about a job, not a fact about the service
 * we happen to be compiling, and the sentence reads the same either way. A
 * promoted claim is not that: retrieval was handed the service id, the reranker
 * was handed the service name, and the extractor refused any quote that did not
 * name the service. "Gujarat Agro Industry Corporation issues the
 * Agri.Business Registration Number" arrived because something asked who issues
 * this, and the page answered.
 *
 * So the grammar can loosen exactly as far as the provenance tightened, and no
 * further. `promoted` is the whole gate.
 *
 * Greedy on the subject, and that is not a detail. Lazy matching stops at the
 * first verb it can reach, so "The authority that grants or renews a license
 * issues the arms license" hands back "authority that" and the multi actor
 * guard never sees the "or" that makes the sentence abstract. Greedy hands back
 * the whole subject phrase, guards and all.
 */
const AUTHORITY_ACTIVE = [
  ["ISSUED_BY", /^(?:the\s+)?([^.,;()]{4,70})\s+(?:issues|grants)\s+\S/i],
  ["VERIFIED_BY", /^(?:the\s+)?([^.,;()]{4,70})\s+(?:approves|verifies|inspects)\s+\S/i],
];

/**
 * A phrase that names the job and not the body doing it.
 *
 * "must be obtained from a prescribed officer" passes every other test here:
 * it is passive, it names one actor, and "officer" is an authority word. It is
 * also not an answer. A citizen cannot walk into `department:a_prescribed_officer`,
 * and writing that node would be us inventing a body the page declined to name.
 */
const UNNAMED_ACTOR =
  /^(?:(?:an?|any|the)\s+)?(?:prescribed|concerned|appropriate|competent|respective|relevant|designated|authorised|authorized|issuing|licensing|sanctioning|approval|nodal|above|said)\b/i;

/**
 * True when a sentence named an authority in the passive and we refused it.
 *
 * §26 says do not guess the actor, and the refusals are the interesting half:
 * "issued by any one of the following officers" is a page that genuinely
 * declined to say who, and "verified by the Mamlatdar / Talati" is a page that
 * named two. Both look identical to a counter that only records what survived.
 */
export const authorityRefused = (claim, { active = false } = {}) =>
  !authorityFromClaim(claim, { active }) &&
  (active ? [...AUTHORITY_VERB, ...AUTHORITY_ACTIVE] : AUTHORITY_VERB).some(([, re]) => re.test(String(claim ?? "")));

/** An officer holds an office. `OFFICE_WORD` is about buildings and misses them. */
const AUTHORITY_WORD =
  /\b(officer|adhikari|inspector|registrar|tahsildar|talati|ministry|secretary|university|institute|committee)\b/i;

/** A condition attached to the approval, not part of who gives it. */
const TRAILING_CLAUSE = /\s+(?:if|when|upon|as\s+per|as|under|within|after|before|for|on|in\s+case)\b.*$/i;

/** "any three of", "either the", and every other way a page declines to say who. */
const NOT_ONE_ACTOR = /\b(?:any|either|one|two|three)\s+(?:of|the|three|two)\b|\/|\sand\s+then\s|\s+or\s+/i;

export function authorityFromClaim(claim, { active = false } = {}) {
  const text = String(claim ?? "").trim();
  for (const [type, re] of active ? [...AUTHORITY_VERB, ...AUTHORITY_ACTIVE] : AUTHORITY_VERB) {
    const m = re.exec(text);
    if (!m) continue;
    const raw = m[1].trim();
    if (NOT_ONE_ACTOR.test(raw) || UNNAMED_ACTOR.test(raw)) return null;
    const name = raw.replace(TRAILING_CLAUSE, "").replace(/\s{2,}/g, " ").trim();
    if (name.length < 4 || isPerson(name)) return null;
    if (!OFFICE_WORD.test(name) && !AUTHORITY_WORD.test(name)) return null;
    // "and" survives the multi actor check only inside a name, so it has to
    // still look like one thing by the time we get here.
    return { type, authority: name };
  }
  return null;
}

/**
 * What the citizen walks away holding.
 *
 * 553 services and thirteen of them could say. Not because the pages are silent:
 * 139 claims were retrieved for the OUTPUT dimension and every one of them
 * landed as an ACTION, because ACTION is the only kind the extractor has for a
 * sentence with a verb in it. "The applicant receives a Sanction Letter" became
 * a step to perform rather than a thing to receive, and the PRODUCES edge that
 * `completeness` looks for was never built by anything.
 *
 * This is not the metric being loosened to make a number rise. The sentences
 * genuinely name an output, they arrived because retrieval asked what the
 * citizen ends up with, and the answer is the single most useful thing a
 * government service page can tell someone. It was being thrown away on a
 * technicality of kind.
 *
 * Promoted claims only, and the reasoning is the same as the active voice
 * authority grammar: retrieval was handed the service id and the extractor
 * refused any quote that did not name the service, so "a certificate will be
 * issued" is about this service and not a sentence that happened to be nearby.
 */
const OUTPUT_VERB = [
  /\b(?:applicant|citizen|user|beneficiary|candidate|holder)\s+(?:will\s+)?(?:receives?|shall\s+receive|will\s+receive|gets?|obtains?|is\s+issued|is\s+granted)\s+(?:an?\s+|the\s+)?([^.,;()]{4,60})/i,
  /\b(?:an?\s+|the\s+)?([^.,;()]{4,60}?)\s+(?:will\s+be|shall\s+be|is|are)\s+(?:issued|granted|provided|generated)\s+(?:to\s+the\s+applicant|online|by\s+the|after|on\s+completion|upon)/i,
  /\bon\s+(?:successful\s+)?(?:completion|approval|registration)[^.]{0,40}?,?\s*(?:an?\s+|the\s+)?([^.,;()]{4,60}?)\s+(?:will\s+be|shall\s+be|is)\s+(?:issued|generated|granted)/i,
];

/**
 * A word that makes the phrase a thing rather than an outcome.
 *
 * "The applicant receives a confirmation that the application was submitted" is
 * not an output, it is the submission acknowledging itself. Requiring a noun
 * from this list keeps the edge pointing at something the citizen could later
 * be asked to produce, which is what makes PRODUCES worth drawing: it is the
 * join to another service's REQUIRES.
 */
const OUTPUT_NOUN =
  /\b(certificate|licence|license|permit|card|number|registration|letter|passbook|sanction|approval|slip|receipt|challan|declaration|identity|id|patta|khata|passport|policy|award|order|memo|acknowledgment|acknowledgement|token)\b/i;

/** A promise about time or process dressed up as a noun. Never an output. */
const NOT_AN_OUTPUT =
  /\b(?:process|procedure|service|scheme|application|form|website|portal|information|details|status|assistance|benefit|amount|subsidy|instalment|installment|payment|fund|training|facility)\b/i;

/**
 * Where the name of the thing stops and the sentence carries on about it.
 *
 * "The applicant receives a Sanction Letter and can claim assistance quarterly"
 * captures the whole rest of the clause, and then the guard that exists to
 * reject "assistance" fires on a sentence that had correctly named a Sanction
 * Letter. The noun tests can only be trusted once the phrase is just the noun.
 */
const OUTPUT_TAIL =
  /\s+(?:and|or|which|who|that|valid|containing|along|from|issued|granted|provided|generated|through|via|by|at|online|offline|digitally|once|only|instantly|immediately|directly)\b.*$/i;

export function outputFromClaim(claim) {
  const text = String(claim ?? "").trim();
  for (const re of OUTPUT_VERB) {
    const m = re.exec(text);
    if (!m) continue;
    const raw = m[1].trim();
    // Checked before the tail is cut, because cutting at "or" would delete the
    // evidence that the page named two possible outcomes and meant neither.
    if (NOT_ONE_ACTOR.test(raw)) continue;
    const name = raw
      .replace(TRAILING_CLAUSE, "")
      .replace(OUTPUT_TAIL, "")
      .replace(/^(?:his|her|their|its|your)\s+/i, "")
      // Pages scare quote the name of the thing they issue. The quotes are the
      // page's punctuation, not part of what the citizen is handed.
      .replace(/^['"‘’“”]+|['"‘’“”]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (name.length < 4 || isPerson(name)) continue;
    // Both tests, and in this order. A phrase has to name a thing we can hand
    // over, and must not be one of the words a page reaches for when it is
    // describing the service back to itself.
    if (!OUTPUT_NOUN.test(name) || NOT_AN_OUTPUT.test(name)) continue;
    return { output: name };
  }
  return null;
}

/** Matched the grammar, named nothing we could hand over. Worth counting, per §5. */
export const outputRefused = (claim) => !outputFromClaim(claim) && OUTPUT_VERB.some((re) => re.test(String(claim ?? "")));

/**
 * The other twenty seven states, so a national portal's pages can be told apart.
 *
 * myscheme.gov.in holds the scheme catalogue for the whole country and its
 * pages render identically whichever state wrote the scheme. Mukhyamantri
 * Medhavi Vidyarthi Yojana is a real scheme with real documents and a real
 * eligibility rule, and a citizen in Ahmedabad cannot have any of it, because
 * it belongs to Madhya Pradesh. Putting it in a Gujarat graph is not a
 * fabricated fact, it is a true fact aimed at the wrong person, which lands the
 * same way.
 *
 * Delhi is left out on purpose: it is in the postal address of half the central
 * government and naming it would exclude the schemes that do apply here.
 */
const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra",
  "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttarakhand", "Uttar Pradesh", "West Bengal",
  "Jammu and Kashmir", "Ladakh", "Puducherry",
];

/**
 * A host whose pages are Gujarat's by construction, so the state filter below
 * never has to read them.
 *
 * `districtOf` answers IN-GJ for everything it does not recognise, so its bare
 * answer proves nothing. A named district does: it only names one when the
 * hostname says so, which is how suratmunicipal.gov.in counts and
 * myscheme.gov.in does not.
 */
export const isGujarat = (host) =>
  /(^|\.)gujarat\.gov\.in$/.test(String(host ?? "")) || districtOf(host).split("-").length > 2;

/**
 * Which state's scheme this page is about, or null if it is Gujarat's, the
 * country's, or unclear.
 *
 * Says nothing unless the page is unambiguous: one other state named, Gujarat
 * named nowhere. A page that mentions two states is a comparison or a list and
 * a page that says Gujarat is ours whatever else it says, so both are kept.
 * Erring towards keeping is deliberate; the cost of dropping a Gujarat scheme
 * is a citizen who cannot find what they are entitled to.
 */
export function otherState(text) {
  const t = String(text ?? "");
  if (/\bgujarat\b|ગુજરાત/i.test(t)) return null;
  const named = STATES.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(t));
  return named.length === 1 ? named[0] : null;
}

/** Below this a bundle is a stub pretending to be a journey. */
const MIN_SERVICES = 3;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const today = () => new Date().toISOString().slice(0, 10);
// slug, title, display and districtOf moved to places.mjs, so
// offices-discover reads the same gazetteer instead of keeping its own.

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

/**
 * Bundles that already exist and were written by a person. Never overwritten.
 *
 * A journey in JOURNEYS is excluded even though its file is sitting right there,
 * because that file is last run's output and not a person's work. Counting it as
 * a hand written bundle is how the second run refuses to write anything: every
 * journey it is about to emit already exists, and it says so and stops.
 */
const EXISTING = new Set(
  readdirSync(at("packages/core/src/data/graph/"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .filter((name) => !Object.hasOwn(JOURNEYS, name)),
);



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

/**
 * True if this name is the journey's heading rather than one of its services.
 *
 * Listing pages are titled with the category they list, and the model names the
 * service off the page it read, so a Jan Seva Kendra index became a service
 * called "Certificate". It has real quotes on a real page. It is still not a
 * thing a citizen can apply for, and it outranked "Income Certificate" in
 * search for the query "income certificate" because a shorter name is a fuller
 * match of itself.
 *
 * The test is not a stoplist of generic words. That list is endless, different
 * in every state, and "certificate" is only generic here because a dozen
 * services in this journey are one. So ask the journey. A name the page wrote
 * as a single word, which two or more longer names in the same journey qualify,
 * is the heading above them.
 *
 * Deliberately shy on both counts. The word has to be alone on the page and not
 * merely alone after filler is stripped, or "Vehicle Registration" becomes
 * "vehicle" and gets deleted for sitting above vehicle fitness testing, which
 * is a service people actually need. And two qualifiers, not one, because one
 * badly titled page is a naming accident and not a category. The cost is that
 * "Registration Certificate Services" survives as a mediocre catalogue row.
 * That is the cheaper mistake: a bad row is noise, a deleted service is a
 * citizen with no answer.
 *
 * "Varshai", "Apostille" and "PUC" stand alone in their journeys and stay.
 */
export function isHeading(id, ids) {
  if (id.includes("_")) return false;
  const under = ids.filter((other) => {
    if (other === id) return false;
    const rest = other.split("_").filter((w) => !FILLER.has(w));
    return rest.length > 1 && rest.includes(id);
  });
  return under.length >= 2;
}


/**
 * Hosts we are willing to send a citizen to, recognised from the name alone.
 *
 * Not a whitelist of sites we trust. A whitelist of sites whose name is
 * evidence. `.gov.in` and `.nic.in` are registry controlled and nobody outside
 * Indian government can hold one, so the hostname is the proof.
 */
const GOV_HOST = /(^|\.)(gov\.in|nic\.in)$/;

/**
 * The url a CHANNEL or TRACKING fact points at, if it is a government one.
 *
 * 342 facts carry a url and 302 of them parse. 239 are on a government host and
 * the rest are facebook, twitter, gmail and a payment gateway, which is exactly
 * why this gate exists: an APPLY_AT edge is us telling a citizen where to go.
 *
 * What it costs is real and worth saying. gujarattourism.com and mcjamnagar.com
 * are the genuine Gujarat tourism and Jamnagar municipal sites and both are
 * dropped, because "we recognise the brand" is not proof and the day it becomes
 * proof is the day somebody registers gujarat-tourism.com.
 */
/**
 * The parsed url a fact points at, whoever owns it, or null if it is not one.
 *
 * `detail.url` holds whatever the extractor found where a link should be, and
 * that is not always a link: "Sanman Portal", "To view your document on
 * DigiLocker, Click here.". A page that names a destination without printing
 * its href and a page that links somewhere we will not vouch for are both gaps
 * and they are not the same gap, so they do not get the same sentence.
 */
export function urlOf(value) {
  const raw = String(value ?? "").trim();
  if (!raw || !raw.includes(".") || /\s/.test(raw)) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

export function govUrl(value) {
  const url = urlOf(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!GOV_HOST.test(host)) return null;
  // Keyed on the host without www, linked to the hostname the page wrote,
  // because dropping www is right for an id and sometimes a 404 for a request.
  return { host, url: `https://${url.hostname}${url.pathname}${url.search}`, root: url.pathname === "/" && !url.search };
}

// ------------------------------------------------------------ ordered actions

/**
 * The number this line calls itself, or null if it does not call itself one.
 *
 * "Step 3:" and "3)" are the two ways this estate writes a process. The second
 * is also how it writes an FAQ, a list of court orders and a table of contents,
 * so a bare number is a candidate and never an answer on its own: `orderedSteps`
 * below throws away the whole run unless the numbers form a clean 1..N and the
 * lines read as instructions rather than questions.
 */
export function stepMarker(text) {
  const line = String(text ?? "").trimStart().split("\n")[0] ?? "";
  const explicit = /^(?:step|stage|પગલું|તબક્કો)\s*[-:.]?\s*(\d{1,2})\b/i.exec(line);
  if (explicit) return { n: Number(explicit[1]), explicit: true, rest: line.slice(explicit[0].length).replace(/^[\s:.\-)]+/, "") };
  const bare = /^\(?(\d{1,2})\)?\s*[).:\-]\s*(?=\S)/.exec(line);
  if (bare) return { n: Number(bare[1]), explicit: false, rest: line.slice(bare[0].length) };
  return null;
}

/**
 * A question wearing a number.
 *
 * incometax.gov.in publishes its help as "1. What is Challan Correction?",
 * "2. Which attributes are available?", numbered 1 to 15, in perfect order. It
 * is not a process and turning it into one would hand a citizen fifteen steps
 * that are not steps. Same for a page of dated tribunal orders.
 */
export function readsAsAQuestion(text) {
  const s = String(text ?? "").trim();
  if (s.includes("?")) return true;
  if (/^(what|which|how|why|when|where|who|can|will|does|do|is|are|should|may|if)\b/i.test(s)) return true;
  // "21-Mar-2025 | NCLT | ..." is a row in a register, not an instruction.
  if (/^\d{1,2}[-/][A-Za-z0-9]{2,4}[-/]\d{2,4}\b/.test(s)) return true;
  return false;
}

/** How many of a page's ACTION facts have to be numbered before it is a process. */
const MIN_STEPS = 3;

/**
 * The ordered process a page states, or an empty array.
 *
 * §9, mechanically. A page that lists "upload documents, pay fee, visit office"
 * without saying which comes first gets nothing from this, because inventing
 * that sequence is inventing a government fact, and the invented one reads
 * exactly as authoritative as a real one.
 *
 * The run has to be clean to survive: distinct numbers, starting at 1, no gaps,
 * and not one of them a question. A page whose numbers are 1, 2, 4 is a page we
 * have misread or a page with a step we did not extract, and both mean the
 * ordering we would print is wrong. Everything rejected here is written into
 * `notFound` so the count of processes we did not build is visible.
 */
export function orderedSteps(facts) {
  const marked = [];
  for (const f of facts) {
    if (f.kind !== "ACTION") continue;
    const m = stepMarker(f.evidence);
    if (!m) continue;
    marked.push({ ...m, fact: f, label: (m.rest || f.claim).trim() });
  }
  if (marked.length < MIN_STEPS) return [];
  if (marked.some((m) => readsAsAQuestion(m.rest || m.fact.claim))) return [];

  // First writing of each number wins. A page that repeats "Step 1" for three
  // separate procedures is three processes and we cannot tell which is which,
  // which the gap check below turns into no process at all.
  const byNumber = new Map();
  for (const m of marked) if (!byNumber.has(m.n)) byNumber.set(m.n, m);

  const run = [...byNumber.keys()].sort((a, b) => a - b);
  if (run.length < MIN_STEPS) return [];
  if (run[0] !== 1) return [];
  if (run.some((n, i) => n !== i + 1)) return [];
  // A bare numbered list has to be unanimous. One "Step 4:" among "1) 2) 3)" is
  // two lists interleaved and neither of them is the one we would print.
  const explicit = marked.filter((m) => m.explicit).length;
  if (explicit && explicit !== marked.length) return [];

  // Same bar the page reader has to clear. A startup policy pdf numbers its six
  // kinds of assistance in a table, the extractor calls each row an ACTION
  // because it says "on submission of proof", and the run is as clean as a real
  // process. Printed as steps it tells a founder to do six things in an order
  // the policy never claimed. Numbering is not instruction.
  const steps = run.map((n) => byNumber.get(n));
  if (steps.filter((m) => INSTRUCTION.test(m.rest || m.fact.claim)).length / steps.length < MOSTLY) return [];

  return steps;
}

/**
 * The page saying, in its own words, that what follows is the order.
 *
 * `orderedSteps` can only see the handful of lines the extractor decided were
 * ACTION facts, and it measured badly: 92 pages in the corpus have a numbered
 * instruction somewhere and only 11 of them survive as a process, because the
 * model quoted steps 1, 2 and 5 of a list of nine and a gap is a refusal. The
 * numbered list is right there in the cached markdown. Reading it ourselves
 * costs nothing, cannot paraphrase, and the evidence is the line.
 *
 * What it must not do is turn every numbered list into a process. 192 pages
 * have a clean 1..N run and most of them are gazette clauses, footnote
 * markers and policy paragraphs. So the page has to have said the word: a
 * heading within eight lines that calls it a procedure, or every line of the
 * run reading as an instruction. Both together is better and rarer.
 */
const PROCESS_HEAD =
  /\b(how\s+to\s+apply|application\s+process|procedure|process\s+flow|step[\s-]*by[\s-]*step|steps?\s+(to|for)\b|following\s+steps|below\s+steps|apply\s+online|registration\s+process|process\s+of\b|પ્રક્રિયા)\b/i;

/** A line that tells a citizen to do something, rather than telling them a rule. */
const INSTRUCTION =
  /\b(appl(y|ies)|submit|upload|fill|click|select|visit|login|log\s*in|register|registration|pay|download|print|attach|enter|choose|go\s+to|open|receive|collect|obtain|verify|scan|send|check|create|generate|complete|sign|book|search|contact|bring|carry|provide|enclose|affix|deposit|કરો|કરવી|જાઓ)\b/i;

/** How much of a run has to read as an instruction once the heading vouched for it. */
const MOSTLY = 0.6;

/** Numbered markdown lines. Same shapes as `stepMarker`, anchored for a whole line. */
const LINE_STEP = /^\s*(?:\*\*)?(?:step|stage|પગલું|તબક્કો)\s*[-:.]?\s*(\d{1,2})\b[).:\-\s]*/i;
// The `(?![\d.])` is what keeps "1.2 Nodal Institution" out. A document outline
// numbers its sections and is not telling anybody to do anything.
const LINE_NUM = /^\s*(?:\*\*)?\(?(\d{1,2})\)?\s*[).:\-]\s*(?![\d.])(?=\S)/;

/**
 * The numbered process a cached page states, or an empty array.
 *
 * Returns the same shape as `orderedSteps` so the caller cannot tell which of
 * the two read the page, including a synthetic fact whose `evidence` is the
 * untouched line. Verbatim by construction: the quote is a slice of the file
 * the substring gate checks against.
 */
export function pageSteps(text) {
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const first = LINE_STEP.exec(lines[i]) ?? LINE_NUM.exec(lines[i]);
    if (!first || Number(first[1]) !== 1) continue;

    const run = [lines[i]];
    for (let j = i + 1, want = 2; j < lines.length && j < i + 200; j++) {
      if (!lines[j].trim()) continue;
      const next = LINE_STEP.exec(lines[j]) ?? LINE_NUM.exec(lines[j]);
      if (!next) continue;
      if (Number(next[1]) !== want) break;
      run.push(lines[j]);
      want++;
    }
    if (run.length < MIN_STEPS) continue;

    const bodies = run.map((line) => line.replace(LINE_STEP, "").replace(LINE_NUM, "").trim());
    // Eight characters is "Pay fee." Anything shorter is a table cell that
    // happened to start with a number; anything past 240 is a paragraph.
    if (!bodies.every((b) => b.length >= 8 && b.length <= 240)) continue;
    if (bodies.some(readsAsAQuestion)) continue;

    const headed = PROCESS_HEAD.test(lines.slice(Math.max(0, i - 8), i).join(" "));
    const share = bodies.filter((b) => INSTRUCTION.test(b)).length / bodies.length;
    if (!(headed ? share >= MOSTLY : share === 1)) continue;

    return run.map((line, k) => ({
      n: k + 1,
      explicit: LINE_STEP.test(line),
      rest: bodies[k],
      label: bodies[k],
      fact: { kind: "ACTION", claim: bodies[k], evidence: line.trim(), confidence: 0.55 },
    }));
  }
  return [];
}

/** A short human label for a step, taken off the page and never written for it. */
export const stepLabel = (text) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:,]\s*$/, "")
    .slice(0, 90);

// ------------------------------------------------------------- citizen stages

/**
 * §16's seven stages, in the order a citizen meets them.
 *
 * This is a *UI* grouping and it is not the same claim as an order the source
 * verified. A page that numbers nine steps is telling us step 4 comes after
 * step 3; putting "Visit the RTO" under IN_PERSON is telling the citizen where
 * in their day it belongs. Conflating the two is how a graph starts asserting
 * sequences nobody published, so they stay two fields: `stepNumber` is the
 * source's claim and `uiStage` is ours.
 */
export const STAGES = ["ELIGIBILITY", "PREPARE", "APPLY", "IN_PERSON", "AFTER_SUBMISSION", "TRACK", "HELP"];

/** Dimension first, because retrieval already asked the question this answers. */
const BY_DIMENSION = {
  ELIGIBILITY: "ELIGIBILITY",
  DOCUMENTS: "PREPARE",
  OFFICE: "IN_PERSON",
  TRACKING: "TRACK",
  HELPLINE: "HELP",
  ESCALATION: "HELP",
  OUTPUT: "AFTER_SUBMISSION",
};

/**
 * What the sentence is telling you to do, when the dimension does not say.
 *
 * ACTIONS, VERIFICATION and ISSUING_AUTHORITY all arrive as steps and land in
 * different parts of a citizen's week. Verb first and in this order, because a
 * sentence can carry two: "Visit the RTO on the scheduled date with original
 * documents" is a trip, not a packing list, and reading PREPARE off "documents"
 * would file it under things to do at home.
 */
const BY_VERB = [
  ["IN_PERSON", /\b(visit|go to|appear|attend|present yourself|in person|at the (?:office|counter)|bring (?:the )?original)\b/i],
  ["TRACK", /\b(track|status of|check the status|know your (?:application|status)|to (?:get|view|see) [\w' ]{0,30}details)\b/i],
  ["AFTER_SUBMISSION", /\b(will be (?:issued|given|generated|sent|delivered)|after (?:registration|submission|completion|approval)|collect the|download the (?:certificate|licence|license))\b/i],
  ["PREPARE", /\b(keep ready|gather|obtain|attach|upload|scan|self.?attest)\b/i],
];

/**
 * A sentence that is about operating a control, not about getting a thing done.
 *
 * "Click 'continue'." came back as a driving licence step, verbatim, off
 * parivahan's own FAQ, and it is not wrong: that page does say it. It is the
 * wrong size. A citizen's step is "Take an appointment" or "Visit the RTO on
 * the scheduled date with original documents"; nobody plans their week around
 * a button. §26's north star is whether the result helps somebody finish the
 * task, and a list where step 5 is a button is a list you stop reading.
 *
 * The verb is the whole test, and only in first position. "Fill up the
 * Application Form" survives, because filling the form is the thing. "Select
 * the district and click submit" does not, and that is the intended answer.
 */
export const isMicroInstruction = (claim) => /^\s*(?:click|press|tap|select|choose|scroll|hover)\b/i.test(String(claim ?? ""));

export function uiStage(fact) {
  const byDimension = BY_DIMENSION[fact.dimension];
  if (byDimension) return byDimension;
  const claim = String(fact.claim ?? "");
  return BY_VERB.find(([, re]) => re.test(claim))?.[0] ?? "APPLY";
}

// -------------------------------------------------------- requirement groups

/**
 * Grouping language, and what it means. Nothing else counts.
 *
 * §14: a list is only alternatives when the page says it is. Two documents that
 * look alike under one heading are not an ANY_OF, they are two documents, and
 * guessing otherwise tells a citizen they can skip one of the two things they
 * actually need.
 */
const GROUP_HEADS = [
  [/\b(any\s+one\s+of\s+the\s+following|any\s+of\s+the\s+following|one\s+of\s+the\s+following|either\s+of\s+the\s+following)\b/i, "ANY_OF", 1],
  [/\b(નીચેના\s*પૈકી\s*(?:કોઈ|કોઇ)?\s*એક|પૈકી\s*(?:કોઈ|કોઇ)\s*એક)\b/, "ANY_OF", 1],
  [/\bany\s+two\s+of\s+the\s+following\b/i, "AT_LEAST_N", 2],
  [/\bat\s+least\s+two\s+of\s+the\s+following\b/i, "AT_LEAST_N", 2],
  [/\b(all\s+of\s+the\s+following|following\s+documents?\s+(?:are\s+)?(?:is\s+)?(?:required|to\s+be\s+submitted|should\s+be\s+submitted|must\s+be\s+submitted|are\s+needed))\b/i, "ALL_OF", 0],
  [/\b(જરૂરી\s*દસ્તાવેજો?\s*નીચે\s*મુજબ|નીચે\s*મુજબના\s*દસ્તાવેજો)\b/, "ALL_OF", 0],
];

/** Lines that are the site around the list rather than a member of it. */
const NOT_A_MEMBER = /^(ans\s*:|answer\s*:|note\s*:|home|back|next|click here|read more|know more|online services|contact us|sitemap|disclaimer|\W*$)/i;

/**
 * Every explicitly grouped list of documents on a page.
 *
 * Deterministic, no model. Finds the header, takes the lines under it until the
 * list stops looking like a list, and returns the block with the header quoted
 * verbatim so the group can carry the sentence that made it a group.
 *
 * ponytail: line based, so a list laid out across table cells on one line is
 * missed. The alternative is a DOM and a model, and this is the half that is
 * safe to get wrong: a missed group is two documents both shown as required,
 * which is a citizen bringing one more paper than they needed to.
 */
export function groupBlocks(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i] ?? "";
    if (head.length > 160) continue;
    const hit = GROUP_HEADS.find(([re]) => re.test(head));
    if (!hit) continue;
    const members = [];
    let last = i;
    for (let j = i + 1; j < Math.min(i + 16, lines.length); j++) {
      const line = (lines[j] ?? "").replace(/^[\s•\-*·–—o]+/, "").replace(/^\(?[a-z0-9]{1,3}[).]\s*/i, "").trim();
      if (!line || line.length > 120) break;
      if (NOT_A_MEMBER.test(line)) break;
      // A second header means the previous list ended, whatever it looked like.
      if (GROUP_HEADS.some(([re]) => re.test(line))) break;
      members.push(line);
      last = j;
    }
    // Two is the smallest thing that is a choice. One member under an "any one
    // of" header is a page we misread, and the validator would reject it anyway.
    //
    // `evidence` is the untouched slice of the page from the header to the last
    // member, not the tidied members joined back up. The bullets and the
    // indentation have to still be there or the substring gate in quotes:audit
    // rejects the quote, and it is right to: a quote you had to reassemble is
    // not a quote.
    if (members.length >= 2) {
      out.push({ head: head.trim(), mode: hit[1], minimum: hit[2], members, evidence: lines.slice(i, last + 1).join("\n").trim() });
    }
  }
  return out;
}

/** A government email address, or null. Same proof as the hostname. */
export function govEmail(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 1 || /\s/.test(raw)) return null;
  return GOV_HOST.test(raw.slice(at + 1)) ? raw : null;
}

/**
 * True if this FEE fact is money the citizen hands over for this service.
 *
 * 334 FEE facts carry an amount and only 140 of them are a fee. The rest are
 * money moving the other way or not moving at all: "Financial assistance of up
 * to Rs. 15,000 is given", "The Gujarat Government has allocated Rs. 5500
 * Crore", "A discretionary grant of Rs. 25 Lakh to each Prant Officer". Written
 * onto a service as `fee` those read as a bill, and telling somebody a welfare
 * scheme costs 5500 crore is worse than telling them nothing.
 *
 * A word test on the model's own sentence, deliberately. The extractor already
 * decided this was about money; what it did not decide is which direction, and
 * a page that says "fee" and does not say "subsidy" has said which direction.
 * It loses "A token amount of 1000 rupees needs to be submitted", which is a
 * real fee described without the word. Missing a fee is a gap. Inventing one is
 * a lie, and §41 only forbids one of those.
 */
const PAYS = /\b(fee|fees|charge|charges|cost|costs|price|payable|pay)\b/i;
const NOT_A_FEE = /\b(crore|allocat\w*|budget|outlay|subsid\w*|grant\w*|assistance|incentive|reimburs\w*|scholarship|stipend|benefit|award\w*|prize|loan|income|salary|turnover|investment)\b/i;

/**
 * Two ways a sentence about money is not a bill, both found by reading the
 * nodes this test let through.
 *
 * The direction words first. NOT_A_FEE names the *kinds* of money that flow
 * toward a citizen and misses the verbs, so "The Mentor receives 90% of the
 * Mentoring Fee" and "A mother will receive 200 rupees for the cost of
 * transportation" both said "fee" or "cost" and both passed. Janani Suraksha
 * pays a woman to get to hospital; we had it billing her for the trip.
 *
 * Then the price of the thing. "cost" is in PAYS because "Online applications
 * cost Rs. 30" is a fee, but a scheme page also prints what the scheme buys:
 * "The total cost of one housing unit is Rs. 43,000", "The unit cost for each
 * training program is Rs. 10,50,000", "The package cost for 100 deliveries is
 * Rs. 3,80,000". That is the government's arithmetic, not the citizen's, and
 * on a PAYMENT node it reads as a price of admission to a housing scheme.
 *
 * It costs us three real fees quoted as a share of a project cost, including
 * "the fees and charges for the development of a mini estate are up to 5% of
 * the project cost". Same trade as the paragraph above: a gap over a lie.
 */
const MONEY_COMING_TO_YOU =
  /\b(receives?|receiving|offers?|disburs\w*|provided\s+(?:for|to)|payable\s+to\s+the\s+(?:mentor|agency|consultant|operator))\b/i;
const PRICE_OF_THE_THING =
  /\b(?:projects?|unit|package|programme?|total|eligible|capital|installation|construction)\s+cost\b|\bcost\s+of\s+(?:the\s+)?(?:programmes?|projects?|one|raw|transport\w*|travel)\b/i;

export const isCitizenFee = (f) =>
  f.kind === "FEE" &&
  Boolean(f.detail?.amount) &&
  PAYS.test(f.claim) &&
  !NOT_A_FEE.test(f.claim) &&
  !MONEY_COMING_TO_YOU.test(f.claim) &&
  !PRICE_OF_THE_THING.test(f.claim);

/**
 * True if this TIMELINE fact is how long the government takes, not some other clock.
 *
 * Same shape of problem. 190 timeline facts carry a number of days and half of
 * them are a deadline the citizen has to meet, a course length or a maintenance
 * window: "An appeal must be filed within 60 days", "The course duration is 1
 * month", "The website will be down on 13/06/2019". Shown as "how long this
 * takes" every one of those is wrong, and the appeal one is wrong in the
 * expensive direction, because a citizen who reads a 60 day filing deadline as
 * a processing time misses it.
 */
const TAKES = /(processing time|time (?:limit|frame|period)|is (?:issued|delivered|provided)|will be (?:issued|delivered|provided)|issued (?:in|within)|delivered (?:in|within)|disposed of|completed (?:in|within)|takes)/i;
const NOT_A_WAIT = /\b(appeal|revision|course duration|valid for|validity|renew\w*|before the|prior to|deadline for applying|last date)\b/i;
export const isProcessingTime = (f) =>
  f.kind === "TIMELINE" && Boolean(f.detail?.days) && TAKES.test(f.claim) && !NOT_A_WAIT.test(f.claim);

/**
 * True if this ELIGIBILITY fact says who qualifies, rather than what the scheme is.
 *
 * "Am I eligible" is the first thing anybody asks and 189 of the 217 services
 * had no answer to it, while 644 eligibility facts sat in the extraction
 * unread. Half of them are not criteria though. The extractor filed the aim of
 * the scheme, its inauguration date and its achievements under ELIGIBILITY too:
 * "The Panchavati Scheme aims to promote rural life", "Gandhinagar Municipal
 * Corporation was formed on March 16, 2010", "All 13693 Gram Panchayats have
 * been provided computer hardware". Printed under "who qualifies" every one of
 * those is a non answer wearing the costume of an answer.
 *
 * So the same word test as the fee and the timeline, on the model's own
 * sentence: a criterion says somebody must be, is eligible, is excluded, or may
 * apply. It loses real criteria phrased without any of that ("Families with no
 * income from any source are included for food security"), which is a gap, and
 * gaps are the acceptable failure here.
 */
const QUALIFIES =
  /(must (?:be|have|not|hold|possess|own|reside|belong)|is eligible|are eligible|eligible (?:for|if|to|under|candidates?|applicants?|beneficiar\w+)|not eligible|ineligible|is excluded|are excluded|excluded from|open (?:only )?to|is applicable to|are applicable to|is available (?:only )?(?:for|to)|are available (?:only )?(?:for|to)|requires? (?:the )?(?:candidate|applicant)|should (?:be|have)|can apply|may apply|can avail)/i;
const NOT_A_CRITERION =
  /(aims? to|was (?:formed|established|launched|set up|started|created)|(?:have|has) been provided|is intended to promote)/i;
export const isQualifyingRule = (f) =>
  f.kind === "ELIGIBILITY" && QUALIFIES.test(f.claim) && !NOT_A_CRITERION.test(f.claim);

/**
 * How many criteria a service shows before the list stops being read.
 *
 * The worst service in the corpus quotes 30 of these across nine pages. A wall
 * of 30 sentences is the government website we are supposed to be replacing.
 */
const ELIGIBILITY_SHOWN = 6;

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
  assert.equal(slug("Chief Minister's Matru Shakti Yojana"), slug("Chief Minister Matru Shakti Yojana"), "one scheme, two ways of typing it");

  assert.ok(absorbs("gir_online_permit_booking", "gir_online_permit_booking_system"));
  assert.ok(absorbs("education_loan", "education_loan_scheme"));
  assert.ok(!absorbs("water_connection", "water_connection_for_industrial_use"), "different applications, and a prefix is not evidence they are one");
  assert.ok(!absorbs("ews_certificate", "ews_certificate"), "a name does not absorb itself");
  assert.ok(!absorbs("permit", "gir_permit"), "a suffix match is not a prefix match");

  const CERTS = ["certificate", "salary_certificate", "residence_certificate", "varshai", "apostille", "certified_copies"];
  assert.ok(isHeading("certificate", CERTS), "a bare Certificate sits above the certificates");
  assert.ok(!isHeading("varshai", CERTS), "a name nothing else qualifies is a service");
  assert.ok(!isHeading("apostille", CERTS));
  assert.ok(!isHeading("salary_certificate", CERTS), "two words is a name, never a heading");
  assert.ok(!isHeading("certificate", ["certificate", "salary_certificate", "varshai"]), "one longer name is a naming accident, not a category");
  assert.ok(
    !isHeading("vehicle_registration", ["vehicle_registration", "vehicle_fitness_testing", "vehicle_registration_and_license"]),
    "the page said two words, so it is not a bare category however much filler we strip",
  );
  assert.ok(!isHeading("chiranjeevi_scheme", ["chiranjeevi_scheme", "chiranjeevi_yojana"]), "the same scheme spelt twice is a merge problem, not a heading");

  assert.equal(govUrl("https://acpc.gujarat.gov.in/").host, "acpc.gujarat.gov.in");
  assert.equal(govUrl("1000d.gujarat.gov.in").url, "https://1000d.gujarat.gov.in/", "a bare hostname is still a url");
  assert.equal(govUrl("https://www.digitalgujarat.gov.in/x.aspx?id=1").host, "digitalgujarat.gov.in");
  assert.equal(govUrl("https://www.digitalgujarat.gov.in/x.aspx?id=1").url, "https://www.digitalgujarat.gov.in/x.aspx?id=1", "www goes from the id, never from the link");
  assert.equal(govUrl("https://acpc.gujarat.gov.in/").root, true);
  assert.equal(govUrl("Digital Gujarat"), null, "the name of a portal is not a link to it");
  assert.equal(govUrl("https://facebook.com/collector"), null);
  assert.equal(govUrl("https://gujarattourism.com"), null, "genuinely official, and we still cannot prove it from the name");
  assert.equal(govUrl("https://notgov.in.example.com/"), null, "gov.in has to end the hostname, not appear in it");

  assert.equal(urlOf("https://gujarattourism.com/x")?.hostname, "gujarattourism.com", "not ours, still a link");
  assert.equal(urlOf("Sanman Portal"), null, "the name of a portal is not a link");
  assert.equal(urlOf("To view your document on DigiLocker, Click here."), null, "nor is the words on the link");
  assert.equal(govEmail("mam-mehsana@gujarat.gov.in"), "mam-mehsana@gujarat.gov.in");
  assert.equal(govEmail("collector.ahd@gmail.com"), null, "a collector using gmail is real and is still not a channel we can verify");

  const FEE = (claim) => ({ kind: "FEE", claim, detail: { amount: 1 } });
  assert.ok(isCitizenFee(FEE("The course fee is Rs. 3,000 per year.")));
  assert.ok(isCitizenFee(FEE("The camera fee for amateur photography is Rs. 200 for Indian nationals.")));
  assert.ok(!isCitizenFee(FEE("The Gujarat Government has allocated Rs. 5500 Crore for health care.")), "money the state spends is not money you owe");
  assert.ok(!isCitizenFee(FEE("Financial assistance of up to Rs. 15,000 is given for training programs.")), "money coming to you is not a fee");
  assert.ok(isCitizenFee(FEE("Online applications cost Rs. 30 if done directly.")), "cost still means cost when it is the citizen doing the paying");
  assert.ok(isCitizenFee(FEE("The citizen pays 50% of the cost of quality certification for an MSME ESDM unit.")));
  assert.ok(!isCitizenFee(FEE("The Mentor receives 90% of the Mentoring Fee, subject to a maximum of Rs. 20,000/- per enterprise.")), "a fee somebody else collects is not your bill");
  assert.ok(!isCitizenFee(FEE("A mother will receive 200 rupees for the cost of transportation to and from the hospital.")), "Janani Suraksha pays her to get there");
  assert.ok(!isCitizenFee(FEE("The scheme offers Rs. 1,000/- per annum per temple for Current Consumption Charges.")));
  assert.ok(!isCitizenFee(FEE("The total cost of one housing unit is Rs. 43,000.")), "what the scheme builds is not what you are charged");
  assert.ok(!isCitizenFee(FEE("The unit cost for each training program is Rs. 10,50,000.")));
  assert.ok(!isCitizenFee(FEE("The package cost for 100 deliveries under the Chiranjeevi Yojana is Rs. 3,80,000.")));
  assert.ok(!isCitizenFee(FEE("The project cost of a greenhouse is Rs 26 lakh per greenhouse per acre.")));
  assert.ok(!isCitizenFee(FEE("The total cost of the program is $12,000 CAD per student.")));
  assert.ok(!isCitizenFee(FEE("The maximum cost of projects under PMEGP is Rs.25.00 lakh in the manufacturing sector.")), "a ceiling on what you may build is not a bill");
  assert.ok(!isCitizenFee(FEE("Up to Rs. 10 lakhs will be provided for the cost of raw materials and components.")), "provided for is the other direction");
  assert.ok(!isCitizenFee({ kind: "FEE", claim: "The fee is Rs. 50.", detail: {} }), "a fee with no amount is a sentence, not a price");
  assert.ok(!isCitizenFee({ kind: "TIMELINE", claim: "The fee is Rs. 50.", detail: { amount: 50 } }));

  const WHEN = (claim) => ({ kind: "TIMELINE", claim, detail: { days: 1 } });
  assert.ok(isProcessingTime(WHEN("The processing time for the Domicile Certificate is 1 day.")));
  assert.ok(isProcessingTime(WHEN("The certificate is issued within 30 days after receiving the documents.")));
  assert.ok(!isProcessingTime(WHEN("An appeal under Section 203 must be filed within 60 days of the decision.")), "a deadline you must meet read as a wait is the expensive way to be wrong");
  assert.ok(!isProcessingTime(WHEN("The course duration is 1 month.")));
  assert.ok(!isProcessingTime(WHEN("The website will be down on 13/06/2019 due to technical maintenance.")));

  const WHO = (claim) => ({ kind: "ELIGIBILITY", claim });
  assert.ok(isQualifyingRule(WHO("The applicant must be at least 18 years old to be eligible for the PMEGP scheme.")));
  assert.ok(isQualifyingRule(WHO("Families with a government servant are excluded from being identified as Priority Households.")));
  assert.ok(isQualifyingRule(WHO("BPL card holders who are HIV Patients are eligible for the Antyodaya Anna Yojana ration card.")));
  assert.ok(!isQualifyingRule(WHO("The Tirthagram Yojana aims to promote unity and harmony in villages.")), "what a scheme is for is not who it is for");
  assert.ok(!isQualifyingRule(WHO("Gandhinagar Municipal Corporation was formed on March 16, 2010.")));
  assert.ok(!isQualifyingRule(WHO("All 13693 Gram Panchayats in Gujarat have been provided computer hardware and software.")));
  assert.ok(!isQualifyingRule({ kind: "BLOCKER", claim: "The applicant must be at least 18 years old." }));

  assert.equal(officeName({ object: "jan_seva_kendra", detail: { address: "Near Subhash Bridge Circle" } }), "jan_seva_kendra");
  assert.equal(officeName({ object: "contact_email", detail: { email: "x@gujarat.gov.in" } }), null);
  assert.equal(officeName({ object: "office_address", detail: { address: "L. D. College" } }), null, "the page's label for the address is not the office");
  assert.equal(officeName({ object: "anything", detail: { officeName: "District Collector Office" } }), "District Collector Office");
  assert.equal(officeName({ object: "anything", detail: { office_name: "Mamlatdar Office" } }), "Mamlatdar Office", "the extractor uses both spellings of the key");
  assert.equal(officeName({ object: "name", detail: {} }), null, "a form field is never an office");
  assert.equal(
    officeName({ object: "collector", detail: { name: "Dr. Prashant Jilova, IAS", address: "Collectorate, Sector 11" } }),
    "collector",
    "the officer on the directory page is not the office, but the office is still there",
  );

  // ------------------------------------------- whose address the page printed

  assert.equal(
    officeName({ object: "office_address", claim: "The Gujarat Biodiversity Board office is located at Aranya Bhavan B Wing, 5th Floor.", detail: { address: "Aranya Bhavan B Wing" } }),
    "Gujarat Biodiversity Board office",
    "the sentence that gave the address also says whose it is",
  );
  assert.equal(
    officeFromClaim("The application must be submitted at the Jan Seva Kendra Ahmedabad."),
    "Jan Seva Kendra Ahmedabad",
    "named after the preposition instead of before the verb, and still named",
  );
  assert.equal(
    officeFromClaim("The contact information for the GARVI 2.0 website is at Stamp & Registration Bhavan, KH-5."),
    null,
    "a website is not somewhere a citizen can go, whatever address it prints",
  );
  assert.equal(
    officeFromClaim("The application must be submitted to the office of the Electricity Revenue Collector at Block No. 3, Udyog Bhavan."),
    "office of the Electricity Revenue Collector",
    "the address is not part of the name of the office it belongs to",
  );
  assert.equal(
    officeFromClaim("The main office of Gandhinagar Municipal Corporation is located at Pandit Dindayal Upadhyay Bhavan."),
    "Gandhinagar Municipal Corporation",
    "same office as the one two sentences up, so it has to reach the same id",
  );
  assert.equal(
    officeFromClaim("The Gandhinagar Municipal Corporation's office is located at Pandit Dindayal Upadhyay Bhavan."),
    "Gandhinagar Municipal Corporation",
  );
  assert.equal(officeFromClaim("Applications are processed within 15 days."), null, "a timeline sentence names no office");
  assert.equal(
    officeFromClaim("The tablets are supplied at the two companies Acer and Lenovo."),
    null,
    "a supplier is not an office, and nothing in that sentence claims it is",
  );

  assert.equal(display("varshai"), "Varshai");
  assert.equal(display("EWS Certificate"), "EWS Certificate", "a name copied off the page keeps the page's capitals");

  // The generated bundles must never be able to land on a hand written name.
  // Checked against the hand built five by name and not against EXISTING,
  // because after the first run EXISTING contains our own output and the
  // assertion would fail on exactly the thing it is meant to allow.
  const HERO = new Set(["driving-licence", "certificates", "scholarship", "pf", "pension"]);
  for (const name of Object.keys(JOURNEYS)) {
    assert.ok(!HERO.has(name), `journey "${name}" would overwrite a hand written bundle`);
  }

  // ---------------------------------------------------------- ordered actions

  const action = (evidence, claim = evidence) => ({ kind: "ACTION", evidence, claim });

  assert.deepEqual(stepMarker("Step 3: Click on the Apply button"), { n: 3, explicit: true, rest: "Click on the Apply button" });
  assert.deepEqual(stepMarker("  4) Upload the documents"), { n: 4, explicit: false, rest: "Upload the documents" });
  assert.deepEqual(stepMarker("(2) Pay the fee"), { n: 2, explicit: false, rest: "Pay the fee" });
  assert.equal(stepMarker("Visit the Mamlatdar office"), null, "an instruction with no number is not a step");
  assert.equal(stepMarker("2024 was the year of the scheme"), null, "a year is not a step number");

  assert.equal(readsAsAQuestion("What is Challan Correction?"), true);
  assert.equal(readsAsAQuestion("Which attributes are available"), true, "a question keeps being one without its mark");
  assert.equal(readsAsAQuestion("21-Mar-2025 | NCLT | In the matter of"), true, "a dated register row is not an instruction");
  assert.equal(readsAsAQuestion("Login to the system and find Renewal Application"), false);

  const process3 = [
    action("1) Login to the system and find Renewal Application submenu."),
    action("2) Click on + icon which you find on top right."),
    action("3) Then upload attachment and add payment detail."),
  ];
  assert.deepEqual(orderedSteps(process3).map((s) => s.n), [1, 2, 3], "a clean run is a process");
  assert.deepEqual(
    orderedSteps([...process3, action("Visit the office with the fee slip")]).map((s) => s.n),
    [1, 2, 3],
    "an unnumbered instruction alongside a clean run is left out, not slotted in",
  );

  // §9, the whole reason this exists. Every one of these is a page that names
  // the things to do and never says in what order.
  assert.deepEqual(orderedSteps([action("Upload documents"), action("Pay the fee"), action("Visit the office")]), [], "an unordered list gets no order invented for it");
  assert.deepEqual(orderedSteps([action("2) Pay the fee"), action("3) Visit"), action("4) Collect")]), [], "a run that does not start at one is a run we have misread");
  assert.deepEqual(orderedSteps([action("1) Apply"), action("2) Pay"), action("4) Collect")]), [], "a gap means a step we did not extract");
  assert.deepEqual(orderedSteps([action("1) Apply"), action("2) Pay")]), [], `under ${MIN_STEPS} numbered lines is not a process`);
  assert.deepEqual(
    orderedSteps([action("1. What is Challan Correction?"), action("2. Which attributes are available"), action("3. Where can a user raise a request")]),
    [],
    "a numbered FAQ is not a numbered process",
  );
  assert.deepEqual(
    orderedSteps([action("1) Apply online"), action("2) Pay the fee"), action("Step 3: Collect it")]),
    [],
    "one Step 3 among bare numbers is two interleaved lists",
  );

  assert.deepEqual(
    orderedSteps([
      action("1. Capital Assistance In 3 tranches Reimbursement as per approval"),
      action("2. Mentoring Assistance On Submission of Proof of eligible expenditure"),
      action("3. Operating Assistance On Submission of Audited Accounts"),
    ]),
    [],
    "a numbered table of what a scheme pays for is not a numbered process",
  );

  assert.equal(
    otherState('The scheme "Mukhyamantri Medhavi Vidyarthi Yojana" by the state government of Madhya Pradesh aims to help students.'),
    "Madhya Pradesh",
    "a real scheme with real documents, and not one a citizen in Ahmedabad can have",
  );
  assert.equal(otherState("Registered under the Rajasthan Gaushala Act, 1960."), "Rajasthan");
  assert.equal(otherState("Applicants from Gujarat and Rajasthan may both apply."), null, "a page that says Gujarat is ours whatever else it says");
  assert.equal(otherState("A comparison of Kerala, Karnataka and Tamil Nadu practice."), null, "two states is a list, not an owner");
  assert.equal(otherState("Pradhan Mantri Awas Yojana is open to all citizens of India."), null, "a central scheme names no state and stays");
  assert.equal(otherState("Directorate of Social Defence, New Delhi."), null, "half the central government has a Delhi address");
  assert.equal(isGujarat("collectorahmedabad.gujarat.gov.in"), true);
  assert.equal(isGujarat("www.myscheme.gov.in"), false, "a national portal is not evidence of jurisdiction");

  // ------------------------------------------------------- and who signs it
  assert.deepEqual(
    authorityFromClaim("The certificate will be issued by the Mahatma Gandhi Labour Institute."),
    { type: "ISSUED_BY", authority: "Mahatma Gandhi Labour Institute" },
    "the passive names an actor, which is the whole reason we only read the passive",
  );
  assert.deepEqual(
    authorityFromClaim("AGMARK certification is required and is issued by the Directorate of Marketing and Inspection."),
    { type: "ISSUED_BY", authority: "Directorate of Marketing and Inspection" },
    "one body with an and in its name, so splitting on and would have invented a second",
  );
  assert.deepEqual(
    authorityFromClaim("The application is verified by the District Education Officer under the Commissionerate of Schools."),
    { type: "VERIFIED_BY", authority: "District Education Officer" },
    "where the authority sits is not part of who the authority is",
  );
  // The known ceiling, asserted so it is a decision and not a surprise. The
  // sentence does say who verifies, and "KVK" survives the trim as three
  // letters that match no office word and no officer word. Recognising bare
  // acronyms means keeping a list of them, and a list we half maintain is how a
  // gate quietly stops being one.
  assert.equal(
    authorityFromClaim("The form will only be considered valid after verification by the KVK under the authority of the Commissionerate of Employment."),
    null,
  );
  assert.deepEqual(
    authorityFromClaim("A NOC for a boiler is issued by the Boiler office if the boiler meets the conditions mentioned in section 2(b)."),
    { type: "ISSUED_BY", authority: "Boiler office" },
    "the condition on the approval is not part of the name of who approves",
  );
  assert.equal(
    authorityFromClaim("The form will be approved by the Government Labour Officer and then the Member Secretary."),
    null,
    "two actors in an order, and choosing one of them would be us deciding",
  );
  assert.equal(
    authorityFromClaim("Approval will be made after field verification by any three of BTM/ATM/Gram Sewak/Horticulture Officer."),
    null,
    "any three of a list of five is the page declining to say who",
  );
  assert.equal(
    authorityFromClaim("The Mamlatdar issues income certificates."),
    null,
    "the active voice is a job description, not a named actor on this service",
  );
  assert.equal(
    authorityFromClaim("The resolution plan was approved by the NCLT on 13-Jul-2026."),
    null,
    "NCLT is real and is not an office word, and inventing a match for it is how the gate rots",
  );
  assert.equal(
    authorityFromClaim("The Sukhadi recipe is approved by the CFTRI and nutrition experts."),
    null,
    "a recipe endorsement is not a step a citizen completes",
  );
  assert.equal(
    authorityFromClaim("A certificate of registration is issued on payment of a fee not exceeding 115 rupees."),
    null,
    "issued on is not issued by, and a fee is not an authority",
  );

  // The active voice, which a promoted claim has earned and a crawled page has not.
  assert.deepEqual(
    authorityFromClaim("Gujarat Agro Industry Corporation issues the Agri.Business Registration Number.", { active: true }),
    { type: "ISSUED_BY", authority: "Gujarat Agro Industry Corporation" },
    "retrieval asked who issues this, and the page answered in the active",
  );
  assert.deepEqual(
    authorityFromClaim("The Registrar of Births and Deaths issues a birth certificate.", { active: true }),
    { type: "ISSUED_BY", authority: "Registrar of Births and Deaths" },
  );
  assert.equal(
    authorityFromClaim("The Registrar of Births and Deaths issues a birth certificate."),
    null,
    "the same sentence off a crawled page is still a directory blurb",
  );
  assert.deepEqual(
    authorityFromClaim("Authorization is granted by the Gujarat Pollution Control Board.", { active: true }),
    { type: "ISSUED_BY", authority: "Gujarat Pollution Control Board" },
    "granted is issued, and the passive did not need the flag",
  );
  assert.equal(
    authorityFromClaim("The authority that grants or renews a license issues the arms license.", { active: true }),
    null,
    "grants or renews is a page describing a role in the abstract",
  );
  assert.equal(
    authorityFromClaim("A certificate for exemption from electricity duty must be obtained from a prescribed officer.", { active: true }),
    null,
    "a prescribed officer is a job, not a body a citizen can walk into",
  );
  assert.equal(
    authorityFromClaim("The certificate must be obtained from the Chief Electrical Inspector.", { active: true }).authority,
    "Chief Electrical Inspector",
    "obtained from names the issuer as plainly as issued by does",
  );
  assert.ok(
    authorityRefused("The concerned authority approves the claim.", { active: true }),
    "matched the grammar, named nobody, and that refusal is worth counting",
  );
  assert.ok(!authorityRefused("The concerned authority approves the claim."), "not counted against a pass that never looked");

  // What the citizen walks away holding.
  assert.equal(
    outputFromClaim("The applicant receives a Sanction Letter and can claim assistance quarterly.").output,
    "Sanction Letter",
    "the trailing clause is a condition on the letter, not part of it",
  );
  assert.equal(
    outputFromClaim("The applicant receives a Declaration of Survey issued by the Surveyor.").output,
    "Declaration of Survey",
    "who issued it is the authority grammar's business, not this one's",
  );
  assert.equal(
    outputFromClaim("After completion of the process of registration, a certificate will be issued online.").output,
    "certificate",
    "the passive, where the thing comes first and the verb after it",
  );
  assert.equal(
    outputFromClaim("A permanent registration number will be given after registration."),
    null,
    "given is not issued, and widening the verb list to catch it also catches every sentence about giving documents in",
  );
  assert.equal(
    outputFromClaim("The applicant receives email and SMS notifications once the challan correction is processed."),
    null,
    "a notification is not a thing anybody can later be asked to produce",
  );
  assert.equal(
    outputFromClaim("The applicant receives assistance on a quarterly basis."),
    null,
    "assistance is an outcome, and PRODUCES is for objects",
  );
  assert.equal(
    outputFromClaim("The applicant receives the application form from the office."),
    null,
    "a form is what you arrive with, not what you leave with",
  );
  assert.equal(
    outputFromClaim("The applicant receives a certificate or a rejection letter."),
    null,
    "two outcomes is the page declining to say which, same rule as two actors",
  );
  assert.ok(
    outputRefused("The applicant receives detailed information about the scheme."),
    "matched the grammar, named nothing to hand over, and section 5 wants that counted",
  );
  assert.ok(!outputRefused("The applicant should visit the Mamlatdar office."), "never looked like an output, so not a refusal");
  // All three came off the real corpus, and all three used to keep the rest of
  // the sentence. A node called "Gujarat Card at the end" is not a thing.
  assert.equal(outputFromClaim("The applicant receives the 'e-Permit' at the end of the process.").output, "e-Permit", "the scare quotes are the page's, not the permit's");
  assert.equal(outputFromClaim("The applicant receives a Gujarat Card at the end of the process.").output, "Gujarat Card");
  assert.equal(outputFromClaim("The applicant receives a transfer order online.").output, "transfer order");

  assert.equal(placeable({ kind: "FEE", detail: {} }), true, "a fee is why we are here");
  assert.equal(placeable({ kind: "HELPLINE", detail: { phone: "1800 233 5500" } }), true);
  assert.equal(placeable({ kind: "HELPLINE", detail: { number: "1800 233 5500" } }), true, "the extractor uses both keys for the same thing");
  assert.equal(placeable({ kind: "HELPLINE", detail: {} }), false, "a page saying call us with no number is not a helpline");
  assert.equal(placeable({ kind: "OFFICE", detail: { email: "x@gujarat.gov.in" } }), false, "an office with no address is not somewhere to go");
  assert.equal(placeable({ kind: "APP", detail: { name: "Digital Gujarat" } }), false, "§41: we do not write a mobile app we cannot find a listing for");

  // ------------------------------------------------- the page read directly

  const HOW = "How to apply for Renewal License?\n\n1) Login to the system and find the Renewal submenu.\n2) Upload the attachment and add the payment detail.\n3) Submit the application and print the receipt.\n";
  assert.deepEqual(pageSteps(HOW).map((s) => s.n), [1, 2, 3], "a numbered list under How to apply is the page stating an order");
  assert.equal(pageSteps(HOW)[0].fact.evidence, "1) Login to the system and find the Renewal submenu.", "the quote is the line, untouched");
  assert.deepEqual(
    pageSteps("Contents\n\n1.2 Nodal Institution shall be notified\n2.1 Eligible enterprises are defined\n3.1 The scheme period is five years"),
    [],
    "a document outline numbers its sections and instructs nobody",
  );
  assert.deepEqual(
    pageSteps("Procedure\n\n1. These words, brackets and letters were substituted by notification.\n2. These figures were omitted by the same notification.\n3. This clause was renumbered accordingly."),
    [],
    "gazette footnotes sit under the word Procedure and are still not steps",
  );
  assert.deepEqual(
    pageSteps("Register Online here\n\n1) Go to the portal and click Register.\n2) Enter your details and submit the form.\n3) Download the acknowledgement receipt.").map((s) => s.n),
    [1, 2, 3],
    "no heading, but every line tells the citizen to do something",
  );
  assert.deepEqual(
    pageSteps("Notes\n\n1) The scheme was announced in 2015 by the department.\n2) The budget allocated was fifty crore rupees.\n3) The scheme covers all districts of the state."),
    [],
    "three numbered statements with nothing to do are not a process",
  );
  assert.deepEqual(
    pageSteps("Steps to apply\n\n2) Pay the fee at the counter.\n3) Collect the receipt from the clerk.\n4) Submit the receipt online."),
    [],
    "a run that does not start at one is a run we have joined halfway",
  );
  assert.deepEqual(
    orderedSteps([action("1) Apply online"), action("1) Apply online again"), action("2) Pay"), action("3) Collect")]).map((s) => s.n),
    [1, 2, 3],
    "the first writing of a number wins",
  );

  assert.equal(stepLabel("  Click on the Apply  button.  "), "Click on the Apply button");

  // ---------------------------------------------------------- citizen stages
  // The dimension wins where retrieval asked the question.
  assert.equal(uiStage({ dimension: "DOCUMENTS", claim: "Visit the RTO." }), "PREPARE");
  assert.equal(uiStage({ dimension: "HELPLINE", claim: "Call 1800." }), "HELP");
  // And where it did not, the verb decides, in the order it is listed.
  assert.equal(uiStage({ dimension: "ACTIONS", claim: "Visit the RTO on the scheduled date with original documents." }), "IN_PERSON");
  assert.equal(uiStage({ dimension: "ACTIONS", claim: "Upload the scanned documents." }), "PREPARE");
  assert.equal(uiStage({ dimension: "ACTIONS", claim: "After registration, a permanent number will be given." }), "AFTER_SUBMISSION");
  assert.equal(uiStage({ dimension: "ACTIONS", claim: "Fill up the Application Form." }), "APPLY");
  assert.equal(uiStage({ dimension: "VERIFICATION", claim: "Check the status of the application." }), "TRACK");
  assert.equal(uiStage({ claim: "Enter the licence number and date of birth to get licence details." }), "TRACK");
  // A button is not a step, and the verb only counts in first position.
  assert.ok(isMicroInstruction("Click 'continue'."));
  assert.ok(isMicroInstruction("Select the district and click submit"));
  assert.ok(!isMicroInstruction("Fill up the Application Form."));
  assert.ok(!isMicroInstruction("Take an appointment."));
  // Every stage this can return is one the citizen UI knows how to show.
  for (const claim of ["Visit the office", "Track it", "Pay the fee", "Upload it", "It will be issued"]) {
    assert.ok(STAGES.includes(uiStage({ claim })), claim);
  }

  // -------------------------------------------------------- requirement groups

  const anyOne = groupBlocks("Identity proof, any one of the following:\n- Aadhaar card\n- Passport\n- Election ID card\n\nNext section");
  assert.equal(anyOne.length, 1);
  assert.equal(anyOne[0].mode, "ANY_OF");
  assert.deepEqual(anyOne[0].members, ["Aadhaar card", "Passport", "Election ID card"], "bullets and numbering stripped, the blank line ends it");
  assert.ok(anyOne[0].head.includes("any one of the following"), "the group carries the sentence that made it a group");

  const all = groupBlocks("Following documents should be submitted for license renewal\nAn application in form No. 3\nTreasury receipt of necessary fees\nOriginal License.");
  assert.equal(all[0]?.mode, "ALL_OF");
  assert.equal(all[0]?.members.length, 3);

  assert.equal(groupBlocks("Any two of the following:\na) Ration card\nb) Light bill")[0]?.minimum, 2);

  // The line §14 draws. A heading over a list is not the page saying "any one".
  assert.deepEqual(groupBlocks("Identity Proof:\n- Aadhaar card\n- Passport"), [], "a bare heading over a list is not grouping language");
  assert.deepEqual(groupBlocks("Any one of the following:\n- Aadhaar card"), [], "one member is not a choice");
  assert.deepEqual(groupBlocks("Any one of the following:\nAns :\nAadhaar card\nPassport"), [], "the site's own furniture ends the list");
  assert.deepEqual(
    groupBlocks("Any one of the following:\nAadhaar card\nPassport\nAny two of the following:\nRation card\nLight bill").map((g) => g.mode),
    ["ANY_OF", "AT_LEAST_N"],
    "a second header ends the first list and starts its own",
  );

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

/**
 * How many facts this compiler can place have to be on a page before it is
 * worth asking which service the page is about.
 *
 * Was three hard facts, which was a bill limiter back when identifying a page
 * cost a model call every run. It cost 70 services: a page that lists a
 * helpline, an office and where to apply has zero *hard* facts and was thrown
 * away whole, helpline included. Identification is cached now, so the same
 * corpus at one is free.
 *
 * Then the count itself was wrong. 376 urls carry a phone number we could
 * publish and 246 of them were never sent to identification at all, because a
 * contact page has no document list. A fact we know how to turn into a node is
 * a reason to read the page, whatever kind it is.
 */
const MIN_HARD = Number(value("min", 1));

/**
 * Where a page's text actually sits, which is two places.
 *
 * `.ingest/pages/<sha1>.md` is what the pipeline fetched. `.firecrawl/` is what
 * a person saved by hand before the pipeline existed, and the five hero
 * journeys are entirely in there. Keyed on the file rather than the sha1,
 * because a hand saved page's filename is a person's word and not a hash of
 * anything, so there is nothing to derive it from.
 */
const fileOf = (page) => page.file ?? `.ingest/pages/${page.sha1}.md`;
const textOf = memo((path) => {
  const file = at(path);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
});
const blocksOf = memo((path) => groupBlocks(textOf(path)));

/**
 * Everything this run threw away, and why.
 *
 * 19,622 facts on disk and 8,539 citations shipped, and until now the other
 * eleven thousand left no trace at all. Not a mystery worth having: the drops
 * are where the depth is, and a funnel you cannot see is a funnel you cannot
 * fix. Collected in memory and written once at the end, because a compile that
 * dies at journey nine would otherwise leave a ledger that reads as "journeys
 * ten onward rejected nothing".
 */
const runId = `compile-${new Date().toISOString()}`;
const drops = rejections("compile", runId);
/** Shorthand, because this is about to be called from twenty places. */
const reject = (reason, row) => drops.reject(reason, row);
/** What a rejection says about the fact it is refusing. */
const of = (f) => ({ url: f.url, kind: f.kind, claim: f.claim, evidence: f.evidence });

const withFacts = [...byUrl.entries()].map(([url, facts]) => ({ url, facts, page: pages.get(url) }));
const admissible = withFacts.filter((c) => c.page && c.facts.filter(placeable).length >= MIN_HARD);
for (const c of withFacts) {
  if (admissible.includes(c)) continue;
  // One row per page, not per fact. A page with no source row is a bookkeeping
  // hole; a page whose facts we cannot place is a schema hole, and conflating
  // them would hide the first inside the second.
  if (!c.page) reject("MISSING_SOURCE", { url: c.url, note: `${c.facts.length} fact(s) off a page with no row in pages.jsonl` });
  else reject("PAGE_NOT_ADMISSIBLE", { url: c.url, note: `${c.facts.length} fact(s), none of a kind this compiler places` });
}

// A national portal carries every state's schemes, and this one is for Gujarat.
const foreign = admissible.filter((c) => !isGujarat(c.page.host) && otherState(textOf(fileOf(c.page))));
for (const c of foreign) reject("OUT_OF_JURISDICTION", { url: c.url, note: otherState(textOf(fileOf(c.page))) });
const candidates = admissible
  .filter((c) => !foreign.includes(c))
  .sort((a, b) => b.facts.length - a.facts.length);

console.log(`${byUrl.size} pages with facts, ${candidates.length} with at least ${MIN_HARD} fact(s) we could place`);
if (foreign.length) {
  const where = [...new Set(foreign.map((c) => otherState(textOf(fileOf(c.page)))))].sort();
  console.log(`  ${foreign.length} page(s) left out because they are another state's scheme: ${where.join(", ")}`);
}

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
const answered = (await pool(candidates, CONCURRENCY, async (c) => {
  const id = await identify(c);
  if (!id.cached) calls++;
  if (calls && calls % 40 === 0) console.log(`  ${calls} identified`);
  // Re-slugged rather than read off the cache file. The id is how two pages
  // become one service, so a fix to `slug` has to reach identifications that
  // were cached before it, and the cached model answer is the name, not the id.
  return { ...c, ...id, serviceId: slug(id.service) };
})).filter(Boolean);
for (const c of answered) {
  if (c.skip) reject("NOT_A_SERVICE_PAGE", { url: c.url, claim: c.service || c.page.title, note: c.service ? "identified, and nobody applies for it" : "no service name came back" });
}
const identified = answered.filter((c) => !c.skip);

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

/** journey -> the index pages we named a service after. Written to notFound. */
const headings = new Map();
for (const [journey, services] of journeys) {
  const ids = [...services.keys()];
  for (const id of ids) {
    if (!isHeading(id, ids)) continue;
    reject("HEADING_NOT_SERVICE", { url: services.get(id).pages[0]?.url, claim: services.get(id).name, note: `sits above ${ids.length - 1} other names in ${journey}` });
    const dropped = headings.get(journey) ?? [];
    dropped.push(`${services.get(id).name}: a page listing ${ids.length - 1} other services in this journey, not a service itself, so it was read for its links and not kept as somewhere to apply. Its pages: ${services.get(id).pages.map((p) => p.url).join(", ")}`);
    headings.set(journey, dropped);
    services.delete(id);
  }
}
const headingCount = [...headings.values()].reduce((n, d) => n + d.length, 0);
if (headingCount) console.log(`${headingCount} name(s) were the heading over a journey, not a service in it`);

// ------------------------------------------------------------ promoted claims
//
// Where the depth engine's output finally becomes graph.
//
// `pnpm services:enrich` searches the whole cached estate for the dimensions a
// service is missing, and writes what it found to `.ingest/claims.jsonl` as
// candidates. Candidates are not graph. §4's chain ends `verified claim -> graph
// edge`, and this is that last arrow.
//
// The lazy version is the right one: a claim is already the same shape as a
// fact, already carries a verbatim quote and a url, and this file already knows
// how to turn a fact on a page into a node with a citation. So a promoted claim
// joins the fact stream of the service it was retrieved *for*, and the whole
// existing chain below places it. No second builder, no second id scheme, no
// second set of rules about what may become a node.
//
// The one thing a promoted page is not allowed to do is contribute a numbered
// process. Enrich may pull a passage off a page that belongs to a different
// service entirely, which is the point for "who issues this", and is exactly
// wrong for "what are the nine steps": `pageSteps` would read that other
// service's list and file it here. So the page comes in for its facts and is
// marked, and the ordered actions block skips it.
// Both caches, because retrieval searches both. Nine of the first twenty five
// claims were quoted off `.firecrawl/` pages, which pages.jsonl has never heard
// of, and refusing them for MISSING_SOURCE would have thrown away every fact
// the depth engine found for driving licence and the SC scholarship: the two
// services whose entire evidence base a person saved by hand.
const CLAIMS = ".ingest/claims.jsonl";
const cached = new Map([...handSaved(), ...pages.values()].map((p) => [p.url, p]));
const claimed = new Map();
for (const [journey, services] of journeys) for (const [id, s] of services) claimed.set(`service:${id}`, { journey, service: s });

let promoted = 0;
const deepened = new Set();
for (const claim of readJsonl(CLAIMS)) {
  const row = { url: claim.url, kind: claim.kind, claim: claim.claim, evidence: claim.evidence };
  const found = claimed.get(claim.serviceId);
  if (!found) {
    // The service was deepened off the graph as it stood, and this compile did
    // not rebuild it: a hand written bundle owns the name, or its pages fell
    // below the admissibility bar this run. Either way the claim has nowhere to
    // land and saying so is better than dropping it into the nearest service.
    reject("UNKNOWN_CANONICAL_ENTITY", { ...row, note: `${claim.serviceId} is not a service this compile built` });
    continue;
  }
  const page = cached.get(claim.url);
  if (!page) {
    reject("MISSING_SOURCE", { ...row, note: `${claim.url} is in neither page cache` });
    continue;
  }
  const { journey, service } = found;
  if (service.pages.some((c) => c.facts.some((f) => f.kind === claim.kind && norm(f.evidence) === norm(claim.evidence)))) {
    // Retrieval found the service's own page and quoted the sentence the
    // extractor already quoted. Common, harmless, and worth counting: it is the
    // share of the deepening pass that bought nothing.
    reject("DUPLICATE", { ...row, note: "already extracted from a page this service was built from" });
    continue;
  }
  let into = service.pages.find((c) => c.url === claim.url);
  if (!into) {
    into = { url: claim.url, page, facts: [], service: service.name, aliases: [], summary: service.summary, journey, serviceId: slug(service.name), promoted: true };
    service.pages.push(into);
  }
  into.facts.push({
    claim: claim.claim,
    kind: claim.kind,
    // The question retrieval was asking. Kept because it is a better answer to
    // "where in the journey does this belong" than any verb in the sentence.
    dimension: claim.dimension,
    subject: claim.subject,
    object: claim.object,
    detail: claim.detail ?? {},
    evidence: claim.evidence,
    confidence: claim.confidence,
    url: claim.url,
    // Load bearing twice over: it is how `build` tells a claim retrieved *for*
    // this service from a fact this compiler derived about it, and hand written
    // services are allowed only the first kind.
    promoted: true,
  });
  promoted++;
  deepened.add(claim.serviceId);
}
if (promoted) console.log(`${promoted} deepening claim(s) promoted into ${deepened.size} service(s)`);

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
const handBundles = [];
for (const name of EXISTING) {
  if (name === "jurisdictions" || name === "manifest") continue;
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(at(`packages/core/src/data/graph/${name}.json`), "utf8"));
  } catch {
    continue;
  }
  handBundles.push(bundle);
  for (const n of bundle.nodes ?? []) {
    taken.add(n.id);
    // Also every id `resolveGoal` would build out of a hand written service's
    // own words. `scholarship.json` has no node called `service:scholarship`;
    // it answers to that because "scholarship" is an alias of
    // `service:nsp_scholarship`, and resolveGoal tries `service:<slug>` before
    // it scans aliases. So a generated service named "Scholarship" off a Rajkot
    // listing page minted `service:scholarship`, won the earlier candidate, and
    // the whole hero journey compiled to one step. An id nobody declared was
    // still load bearing, which is why reserving declared ids was not enough.
    if (n.type !== "SERVICE") continue;
    for (const phrase of [n.name, n.officialName, ...(n.aliases ?? [])]) {
      const id = slug(phrase);
      if (id) taken.add(`service:${id}`);
    }
  }
}

/**
 * Hand written services that already have a path, as against ones that only
 * have a name.
 *
 * `taken` says a person owns the id. It does not say what they wrote, and the
 * difference decides whether a machine step is noise or the only step there is.
 * Driving licence has eight authored steps and adding "Take an appointment."
 * above them makes the journey worse. Domicile certificate is a hand written
 * service with eleven documents, an office and no steps at all, and "The
 * applicant must visit the Taluka Mamlatdar office" is the whole answer to what
 * do I actually do.
 *
 * Found out by pruning them from a live database: the first version of this
 * rule keyed on `taken` and quietly took two real steps off domicile, two off
 * caste and sebc, and one off certified copies. So the rule is not "a person
 * owns this" but "a person wrote the sequence", which is what §11 is protecting
 * in the first place.
 */
const authoredSteps = (() => {
  const type = new Map();
  for (const b of handBundles) for (const n of b.nodes ?? []) type.set(n.id, n.type);
  const has = new Set();
  for (const b of handBundles) {
    for (const e of b.edges ?? []) {
      if (type.get(e.from) === "SERVICE" && type.get(e.to) === "ACTION") has.add(e.from);
    }
  }
  return has;
})();

// ---------------------------------------------------- documents, not fields

/**
 * Which of the extractor's "required documents" are documents.
 *
 * The FIELDS stoplist above caught `document:gender` and stopped there, because
 * a stoplist only knows the words somebody thought of. The real page says this,
 * under one heading, in one list:
 *
 *   Aadhaar card · Aadhaar number · English name per Aadhaar · Village or city
 *   name · Anganwadi name · District and taluka · Ration card member id
 *
 * Two of those seven are documents. The other five are boxes on the form, and
 * telling a woman applying for Matru Shakti Yojana to go and obtain a "village
 * or city name" is worse than telling her nothing, because she will believe it.
 *
 * A regex cannot draw this line. "Aadhaar card" and "name per ration card" both
 * end in "card"; "Electoral id card" is a document and "Family card id" is not.
 * So this is a model call, and it is the right kind: it never invents a
 * document, it only says which of ours were never documents. Cached per phrase,
 * so the second run asks nothing and the fiftieth asks only about new words.
 */
const DOCUMENTS = ".ingest/documents.jsonl";
const DOC_VERSION = 1;
const DOC_BATCH = 60;

const DOC_SYSTEM = [
  "You are given phrases that an extractor pulled out of the \"documents required\" area of an Indian government page.",
  "Some are documents. The rest are form fields, headings or navigation that happened to sit under the same heading.",
  "",
  "Answer with a JSON array of only the phrases that are documents, copied exactly as they were given to you, and nothing else.",
  "",
  "A document exists before the application and can be handed over or uploaded: a card, a certificate, a passbook, a photograph, an affidavit, a marksheet, a deed, a cancelled cheque, a government order, a sanctioned plan.",
  "A field has no existence outside the form: \"Aadhaar number\", \"village or city name\", \"district and taluka\", \"alternative mobile number\", \"name per ration card\", \"gender selection\", \"captcha code\", \"registration number\".",
  "\"Aadhaar card\" is a document and \"Aadhaar number\" is a field. The test is whether you could put it in an envelope.",
  "",
  "An empty array is a correct answer. Leaving out a real document is a small mistake. Telling a citizen to go and obtain a form field is a large one.",
].join("\n");

/** phrase as shown to the model -> true if it is a document */
const known = new Map(readJsonl(DOCUMENTS).filter((r) => r.promptVersion === DOC_VERSION).map((r) => [r.phrase, r.document]));

/**
 * The cached page, and the grouped lists on it.
 *
 * Grouping language ("any one of the following") almost never survives into a
 * fact's own evidence quote, because the extractor quotes the requirement and
 * not the sentence above it. Measured: 7 facts in the whole corpus carry
 * at-least-n language, 3 either/or, 1 one-of-following. The sentence that makes
 * a list a choice lives on the page, so this reads the page.
 *
 * Both memoised on sha1: one service can be built from nine pages and every
 * page is read twice, once to ask the classifier about its members and once to
 * write the group.
 */

function memo(fn) {
  const seen = new Map();
  return (key) => {
    if (!seen.has(key)) seen.set(key, fn(key));
    return seen.get(key);
  };
}

const wanted = new Set();
for (const services of journeys.values()) {
  for (const service of services.values()) {
    for (const page of service.pages) {
      for (const f of page.facts) {
        if (f.kind === "DOCUMENT_REQUIREMENT" && f.object && !FIELDS.has(f.object)) wanted.add(f.object);
      }
      // A group member goes through the same classifier as everything else. A
      // list under "any one of the following" is still full of form fields.
      for (const b of blocksOf(fileOf(page.page))) for (const m of b.members) wanted.add(m);
    }
  }
}

const asking = [...wanted].filter((o) => !known.has(title(o)));
if (asking.length) {
  console.log(`\nasking which of ${asking.length} phrase(s) are documents and which are form fields`);
  const batches = Array.from({ length: Math.ceil(asking.length / DOC_BATCH) }, (_, i) => asking.slice(i * DOC_BATCH, (i + 1) * DOC_BATCH));
  const rows = [];
  await pool(batches, CONCURRENCY, async (batch) => {
    const phrases = batch.map(title);
    const reply = await chat(
      [
        { role: "system", content: DOC_SYSTEM },
        { role: "user", content: `Phrases:\n${phrases.map((p) => `- ${p}`).join("\n")}\n\nWhich of these are documents?` },
      ],
      { maxTokens: 1600 },
    );
    const kept = reply ? jsonArray(reply.text) : null;
    // A batch the model never answered stays unclassified rather than being
    // guessed either way. Nothing is written for it, so the next run asks again.
    if (!kept) return;
    const yes = new Set(kept.filter((k) => typeof k === "string").map((k) => k.trim().toLowerCase()));
    for (const [i, phrase] of phrases.entries()) {
      const document = yes.has(phrase.toLowerCase());
      known.set(phrase, document);
      rows.push({ phrase, object: batch[i], document, model: reply.model ?? null, promptVersion: DOC_VERSION });
    }
  });
  if (rows.length) appendFileSync(at(DOCUMENTS), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const unclassified = [...wanted].filter((o) => !known.has(title(o)));
// Half the corpus unanswered means Bedrock is down, not that the pages changed.
// Writing now would ship bundles stripped of their documents and every gate
// would pass, because an empty list is valid. Stop instead.
if (unclassified.length * 2 >= wanted.size) {
  console.error(`\n${unclassified.length} of ${wanted.size} document phrases could not be classified. Nothing written. Check Bedrock and run again.`);
  process.exit(1);
}
console.log(
  `${[...wanted].filter((o) => known.get(title(o))).length} of ${wanted.size} phrase(s) are documents` +
    (unclassified.length ? `, ${unclassified.length} unanswered and dropped for now` : ""),
);

/** A phrase nobody has classified is not a document yet. UNKNOWN, not assumed. */
const isDocument = (object) => known.get(title(object)) === true;

// ------------------------------------------------------------ curated names

/**
 * Names citizens type that no page prints, from `docs/research/service-names.tsv`.
 *
 * Everything else in this file is what a machine read off a government page,
 * which is the right default and has one blind spot: a service answers only to
 * the words its own page happened to use. `service:varshai` has nine required
 * documents, three sources and a 60 day timeline, and until this existed a
 * citizen typing "legal heir certificate" got an empty screen, because the
 * Kheda collectorate writes વારસાઈ and never writes the English name.
 *
 * Names only. The header of that file is the contract and it is worth
 * repeating here: a row adds a string somebody might search for, never a fact
 * about the service. Facts still arrive the one way they have always arrived.
 */
const curatedNames = (() => {
  const file = at("docs/research/service-names.tsv");
  const by = new Map();
  if (!existsSync(file)) return by;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [id, alias] = line.split("\t").map((s) => s?.trim() ?? "");
    if (!id || !alias) continue;
    const list = by.get(id) ?? [];
    list.push(alias.toLowerCase());
    by.set(id, list);
  }
  return by;
})();

/** Rows whose service no longer exists. Reported at the end, never silent. */
const namesUnused = new Set(curatedNames.keys());

// -------------------------------------------------------------------- build

const ref = (sourceId, fact) => ({ sourceId, evidence: fact.evidence, confidence: fact.confidence, verificationStatus: "EXTRACTED" });

/**
 * One row per url for the whole run, not one per journey.
 *
 * Corpus wide retrieval means a page can now back a service in a journey it
 * was never fetched for, so the same url turns up in two bundles. A source
 * describes the page, not the journey that cited it, and two bundles
 * disagreeing about whether myscheme.gov.in/schemes/dbabocwwb is a
 * SERVICE_PAGE or an OFFICE_DIRECTORY is a bug in us, not a fact about the
 * page. First writer decides, everyone after gets the same row.
 */
const sourceRows = new Map();
const sourceRow = (c) =>
  sourceRows.get(c.url) ??
  sourceRows
    .set(c.url, {
      id: `src:${sha1(c.url).slice(0, 12)}`,
      url: c.url,
      title: c.page.title ?? c.service,
      domain: c.page.host,
      sourceType: sourceTypeOf(c.url, c.page.title, c.facts.map((f) => f.kind)),
      jurisdictionId: districtOf(c.page.host),
      retrievedAt: (c.page.fetchedAt ?? "").slice(0, 10) || today(),
      contentHash: c.page.contentHash,
      cacheFile: fileOf(c.page),
      scrapedOk: true,
      // Carried, not dropped. A quote off an unverified chain is still a
      // quote off that page, and the citizen is shown which it is.
      ...(c.page.tlsVerified === false ? { tlsVerified: false } : {}),
    })
    .get(c.url);


function build(journey, services) {
  const sources = [];
  const nodes = [];
  const edges = [];
  const declared = new Set();
  const facts = [];
  const requirementGroups = [];
  const notFound = [...(headings.get(journey) ?? [])];

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
    /**
     * A hand written service wins, and the depth engine is the one exception.
     *
     * The old rule was flat: an id somebody wrote by hand keeps everything this
     * compiler found for it, because whatever we would add, a person already
     * wrote better. That rule cost us the whole point of the deepening pass.
     * §35 aimed P9 at driving licence, income certificate and the SC
     * scholarship, and those are precisely the five hero journeys a person
     * wrote, so nine of the first twenty five claims were retrieved for a
     * service this file then refused to touch. §38 says make the existing
     * services smarter. Refusing to enrich exactly the good ones is the
     * opposite.
     *
     * The distinction that makes it safe: a page this compiler *found* for
     * "Driving Licence" is a guess about what the page is about, and competing
     * with a person's judgement on that is how you get a worse graph. A claim
     * is not a guess about the subject. Retrieval was handed the service id, the
     * reranker was told the service name, the extractor refused anything the
     * quote did not name, and the quote is a verbatim substring of a cached
     * page. So the found pages stay out and the claims come in, and nothing this
     * writes can shadow the hand written node: `put` refuses a taken id, so the
     * SERVICE node below is never redeclared, only pointed at. Bundles merge
     * before validation and `kept` already lets an edge leave a taken id.
     */
    const owned = taken.has(serviceNodeId);
    let pages = service.pages;
    if (owned) {
      const found = service.pages.flatMap((c) => c.facts).filter((f) => !f.promoted);
      if (found.length) {
        notFound.push(`${service.name}: the hand written graph already answers to ${serviceNodeId}, so the pages found for it were not merged in. Reconciling the two is a job for a person.`);
        reject("ALREADY_OWNED", { url: service.pages[0].url, claim: service.name, note: `${found.length} fact(s) across ${service.pages.length} page(s) not merged into ${serviceNodeId}` });
      }
      pages = service.pages.map((c) => ({ ...c, facts: c.facts.filter((f) => f.promoted) })).filter((c) => c.facts.length);
      if (!pages.length) continue;
    }

    const before = edges.length;
    const jurisdictionId = districtOf(pages[0].page.host);
    const serviceRefs = [];
    /**
     * A quote hung off the service node, or a note that we ran out of room.
     *
     * The cap is twelve because a service page showing forty quotes is a wall
     * nobody reads, and the thirteenth is not worse evidence than the twelfth,
     * it is just later on the page. Worth knowing how often we hit it.
     */
    const cite = (r, f) => {
      if (serviceRefs.length < 12) serviceRefs.push(r);
      else reject("TRUNCATED_BY_CAP", { ...of(f), note: "past the 12 quotes a service node shows" });
    };
    /** What this service's pages said that we read and then refused to write. */
    const gaps = [];
    /** One numbered process per service. Nine pages do not make nine processes. */
    let steps = 0;

    for (const c of pages) {
      const row = sourceRow(c);
      const sourceId = row.id;
      if (!sources.some((s) => s.id === sourceId)) sources.push(row);

      for (const f of c.facts) {
        facts.push({ claim: f.claim, kind: f.kind, subject: f.subject, object: f.object, detail: f.detail, sourceId, evidence: f.evidence, confidence: f.confidence });
        const r = [ref(sourceId, f)];

        // Asked before the chain, not after it. DOCUMENT_REQUIREMENT is in
        // HARD, so a document fact that fails these three guards is caught by
        // the HARD branch at the bottom and kept as a service quote, which is
        // right, and it would leave the biggest single loss in the funnel with
        // nothing recorded against it. 2,821 of these arrive and 217 services
        // end up with documents.
        if (f.kind === "DOCUMENT_REQUIREMENT" && !(f.object && !FIELDS.has(f.object) && isDocument(f.object))) {
          if (!f.object) reject("INVALID_SCHEMA", { ...of(f), note: "a document requirement naming no document" });
          else if (FIELDS.has(f.object)) reject("NOT_A_DOCUMENT", { ...of(f), note: `${f.object} is a form field` });
          else reject(known.has(title(f.object)) ? "NOT_A_DOCUMENT" : "UNKNOWN_CANONICAL_ENTITY", { ...of(f), note: f.object });
        }

        if (f.kind === "DOCUMENT_REQUIREMENT" && f.object && !FIELDS.has(f.object) && isDocument(f.object)) {
          const docId = `document:${f.object}`;
          put({ id: docId, type: "DOCUMENT", name: title(f.object), jurisdictionId, sources: r, lastVerifiedAt: today() });
          link(serviceNodeId, docId, "REQUIRES", f.claim, r);
        } else if (f.kind === "OFFICE" && officeName(f) && (f.detail.address || f.detail.phone)) {
          const named = officeName(f);
          const officeId = `office:${slug(named)}`;
          put({
            id: officeId,
            type: "OFFICE",
            name: display(named),
            jurisdictionId,
            metadata: {
              channelType: "PHYSICAL_OFFICE",
              ...(f.detail.address ? { address: f.detail.address } : {}),
              ...(f.detail.phone ? { phoneNumbers: [String(f.detail.phone)] } : {}),
            },
            sources: r,
          });
          link(serviceNodeId, officeId, "VISIT_AT", f.claim, r);
        } else if (f.kind === "HELPLINE" && (f.detail.phone || f.detail.number)) {
          // Keyed on the number because that is the thing that is unique and
          // stable. Named for what it is *for*, because "+91-8031338686" is not
          // an answer to "who do I call". The extractor writes the number under
          // `phone` or under `number` depending on what the page called it, and
          // reading only one of the two threw away 28 published numbers.
          const line = String(f.detail.phone || f.detail.number);
          const helpId = `helpline:${slug(line)}`;
          const named = f.detail.name || f.detail.title || `${service.name} helpline`;
          put({ id: helpId, type: "HELPLINE", name: display(String(named)), jurisdictionId, metadata: { channelType: "PHONE", phoneNumbers: [line] }, sources: r });
          link(serviceNodeId, helpId, "CALL_IF", f.claim, r);
        } else if ((f.kind === "CHANNEL" || f.kind === "TRACKING") && govUrl(f.detail.url)) {
          // Where you actually go, which is often not the site that told us.
          // "The application for the Domicile Certificate can be submitted
          // online via Digital Gujarat" was read off a collectorate page, and
          // without this the only APPLY_AT we wrote pointed at the collectorate.
          const g = govUrl(f.detail.url);
          const portalId = `portal:${slug(g.host)}${g.root ? "" : `_${sha1(g.url).slice(0, 6)}`}`;
          put({
            id: portalId,
            type: "PORTAL",
            name: g.root ? g.host : `${g.host}${new URL(g.url).pathname}`,
            jurisdictionId,
            metadata: { channelType: "WEB", url: g.url },
            sources: r,
          });
          link(serviceNodeId, portalId, f.kind === "TRACKING" ? "TRACK_AT" : "APPLY_AT", f.claim, r);
          cite(ref(sourceId, f), f);
        } else if (f.kind === "CHANNEL" && govEmail(f.detail.email)) {
          const address = govEmail(f.detail.email);
          const mailId = `helpline:${slug(address)}`;
          put({
            id: mailId,
            type: "HELPLINE",
            name: `${display(service.name)} by email`,
            jurisdictionId,
            metadata: { channelType: "EMAIL", emails: [address] },
            sources: r,
          });
          link(serviceNodeId, mailId, "CALL_IF", f.claim, r);
          cite(ref(sourceId, f), f);
        } else if (f.kind === "APP") {
          // §41 forbids inventing an official mobile application, and a page
          // saying "download our app" is not a store listing. 46 APP facts in
          // the whole corpus and 2 of them name a package. So no MOBILE_APP
          // node, ever, from this: the citizen is told the page mentions one
          // and that we could not find where it lives.
          gaps.push(`${service.name}: a page mentions a mobile app ("${f.claim}") but gives no Play Store or App Store listing, so we did not write one. Finding the real listing is a job for a person.`);
          reject("UNSUPPORTED_KIND", { ...of(f), note: "APP never becomes a node, by policy" });
        } else if ((f.kind === "CHANNEL" || f.kind === "TRACKING") && f.detail.url) {
          // Not a gov.in or nic.in host, so the hostname is not proof of who
          // owns it. gujarattourism.com and mcjamnagar.com are genuinely
          // official and are dropped here anyway, because "we recognise the
          // brand" stops being a test the day somebody registers a lookalike.
          const dest = urlOf(f.detail.url);
          reject(dest ? "UNTRUSTED_HOST" : "FAILED_NORMALIZATION", { ...of(f), note: dest ? dest.hostname : String(f.detail.url).slice(0, 80) });
          gaps.push(
            dest
              ? `${service.name}: the page links to ${dest.hostname}, which is not a gov.in or nic.in host, so we could not prove from the name alone that government owns it and did not send anyone there.`
              : `${service.name}: the page names "${f.detail.url}" as somewhere to go but printed no link to it, so there was nothing to send anyone to.`,
          );
        } else if (f.kind === "GRIEVANCE") {
          const gId = `grievance:${slug(service.id)}`;
          put({ id: gId, type: "GRIEVANCE_CHANNEL", name: `Grievances about ${service.name.toLowerCase()}`, jurisdictionId, metadata: { channelType: "GRIEVANCE_PORTAL" }, sources: r });
          link(serviceNodeId, gId, "ESCALATE_TO", f.claim, r);
        } else if (f.kind === "ACTION" && f.promoted && isMicroInstruction(f.claim)) {
          reject("NOT_A_CITIZEN_STEP", { ...of(f), note: "a button, not a step" });
        } else if (f.kind === "ACTION" && f.promoted && authoredSteps.has(serviceNodeId)) {
          // ------------------------------------ somebody already wrote the path
          //
          // Every other promoted fact is welcome on a hand written service. A
          // fee, an office, a helpline, a produced document: each is one answer
          // to one question, it either belongs or it does not, and a person who
          // did not write it down was not asserting it is absent.
          //
          // A step is not one answer. A sequence is a claim about the shape of
          // the whole thing, and the five that landed on driving licence say
          // what that costs. "Take an appointment." "Fill up the Application
          // Form." "Visit the RTO on the scheduled date with original
          // documents", which the authored step 3 already says at length and
          // with the four things to carry. "An online slot booking for a test
          // of competence is required before a permanent license is ", cut off
          // mid sentence by the id length, duplicating authored step 11.
          // "Enter the Driver's License number and Date of birth", which is how
          // you track an application and was filed under how you make one.
          //
          // Each passed every gate it met. All of them are verbatim off
          // parivahan's own FAQ. Not one is false and not one is worth reading,
          // and they sat in the middle of the best journey in the graph, which
          // is the one §28 puts on a screen.
          //
          // The rule the rest of this file already follows, applied to steps: a
          // page this compiler found is a guess and a person's judgement wins.
          // Retrieval knowing the service id makes a promoted claim a better
          // guess about the subject, not a better one about the order.
          //
          // Keyed on the sequence existing, not on the id being owned. A hand
          // written service with no steps of its own is not a person saying
          // there are none; see `authoredSteps`.
          reject("ALREADY_OWNED", { ...of(f), note: `${serviceNodeId} has a hand written sequence, so a machine step does not join it` });
        } else if (f.kind === "ACTION" && f.promoted && stepLabel(f.claim)) {
          // ------------------------------------------------ a step, unordered
          //
          // §15: do not force a total sequence when the source does not give
          // one. Everywhere else in this file an ACTION becomes a node only if
          // the page numbered it, because 2521 ACTION facts arrive and most are
          // a Mamlatdar's job description. A promoted claim is the case that
          // rule was too blunt for: retrieval was handed the service id and the
          // ACTIONS dimension, the reranker was told the service name, the
          // extractor refused anything the quote did not name. "Take an
          // appointment" and "Visit the RTO on the scheduled date with original
          // documents" are steps in the driving licence journey whether or not
          // parivahan's FAQ page printed a 3. and a 4. beside them.
          //
          // So it becomes a node and it gets no DEPENDS_ON. The numbered branch
          // below chains its run because the page said so; there is nothing to
          // say here, and inventing an order is the same class of mistake as
          // inventing a fee. The journey compiler already topologically sorts a
          // partial order, and `uiStage` groups these for the citizen without
          // claiming the group is a sequence.
          const label = stepLabel(f.claim);
          const actionId = `action:${service.id}_${slug(label).slice(0, 48)}`;
          put({
            id: actionId,
            type: "ACTION",
            name: display(label),
            jurisdictionId,
            metadata: { whatToDo: f.claim, uiStage: uiStage(f), machineExtracted: true },
            sources: r,
            lastVerifiedAt: today(),
          });
          link(serviceNodeId, actionId, "REQUIRES", f.claim, r);
          cite(ref(sourceId, f), f);
        } else if (HARD.includes(f.kind) || f.kind === "ACTION" || f.kind === "CHANNEL") {
          // Not its own node, but it is why this service node is believable, so
          // it hangs off the service with its quote intact.
          cite(ref(sourceId, f), f);
        } else {
          // Off the end of the chain: quotable, on a page about a real service,
          // and there is nowhere in the graph to put it. The near misses live
          // here, which is why the reason is worked out rather than fixed.
          reject(whyUnplaceable(f), of(f));
        }

        // ------------------------------------------------- who signs it off
        //
        // Runs beside the chain above, not inside it, because the sentence that
        // names the issuer is usually already doing another job: it arrives as a
        // DOCUMENT_REQUIREMENT, a CONDITIONAL_REQUIREMENT or an ACTION, and one
        // sentence can be both "you need AGMARK" and "AGMARK comes from the
        // Directorate of Marketing and Inspection".
        const authority = authorityFromClaim(f.claim, { active: Boolean(f.promoted) });
        if (authority) {
          const deptId = `department:${slug(authority.authority)}`;
          // DEPARTMENT and not OFFICE. The page named who, never where, and an
          // OFFICE node with no address is an invitation to go and stand
          // somewhere we never found.
          put({ id: deptId, type: "DEPARTMENT", name: display(authority.authority), jurisdictionId, sources: r, lastVerifiedAt: today() });
          // ISSUED_BY belongs to the document, when we wrote the document. The
          // service issues nothing; the certificate is what gets issued.
          const docId = `document:${f.object}`;
          const from = authority.type === "ISSUED_BY" && declared.has(docId) ? docId : serviceNodeId;
          link(from, deptId, authority.type, f.claim, r);
          cite(ref(sourceId, f), f);
        } else if (authorityRefused(f.claim, { active: Boolean(f.promoted) })) {
          // The page used the passive and never named the officer, or named two
          // and left the choice open. §26 says do not guess, so nothing is
          // written, and this is how often that costs us an ISSUED_BY.
          reject("NO_ACTOR", { ...of(f), note: "a sentence about who does it that names nobody" });
        }

        // ------------------------------------------- what you walk away with
        //
        // Same shape as the block above and for the same reason: the sentence
        // that names the output is already busy being an ACTION, because ACTION
        // is the only kind the extractor has for a sentence with a verb. Only
        // promoted claims, so we know something went looking for this service's
        // output rather than the phrase drifting past on a page.
        const produced = f.promoted ? outputFromClaim(f.claim) : null;
        if (produced) {
          // Reuse the document node when the thing produced is a document this
          // graph already knows, because that is the join that makes PRODUCES
          // worth drawing: one service's output is the next service's REQUIRES,
          // and a separate output node beside an identical document node breaks
          // the chain §30 is built on.
          const docId = `document:${slug(produced.output)}`;
          const outId = declared.has(docId) ? docId : `output:${slug(produced.output)}`;
          if (outId !== docId) put({ id: outId, type: "OUTPUT", name: display(produced.output), jurisdictionId, sources: r, lastVerifiedAt: today() });
          link(serviceNodeId, outId, "PRODUCES", f.claim, r);
          cite(ref(sourceId, f), f);
        } else if (f.promoted && outputRefused(f.claim)) {
          reject("NO_OUTPUT_NAMED", of(f));
        }
      }

      // ------------------------------------------------------ ordered actions
      //
      // Only where the page numbered them itself. `orderedSteps` returns a run
      // or nothing, and nothing is the common answer: 2521 ACTION facts across
      // the corpus and most of them are a Mamlatdar's job description or a
      // dropdown label. §9: an ambiguous sequence never becomes a citizen path.
      // The extractor's facts first, because a fact was worth quoting; the page
      // itself second, for the nine step list the extractor quoted three of.
      const fromFacts = steps ? [] : orderedSteps(c.facts);
      // `c.promoted` is a page retrieval brought in for one dimension, which may
      // be about another service entirely. Its facts are attributed; its step
      // list is not.
      const run = steps ? [] : (fromFacts.length ? fromFacts : c.promoted ? [] : pageSteps(textOf(fileOf(c.page))));
      if (run.length) {
        // A step read straight off the page is not one of `c.facts`, so it is
        // not in the evidence layer yet, and quotes:audit is right to call a
        // graph quote nobody recorded a fabrication. Record it as what it is.
        if (run !== fromFacts) {
          for (const m of run) {
            facts.push({ claim: m.fact.claim, kind: "ACTION", subject: service.id, object: null, detail: { stepNumber: m.n }, sourceId, evidence: m.fact.evidence, confidence: m.fact.confidence });
          }
        }
        let previous = null;
        for (const m of run) {
          const label = stepLabel(m.label);
          // Scoped to the service. Two services that both say "Pay the fee" are
          // two steps, because the fee, the counter and the receipt differ.
          const actionId = `action:${service.id}_${m.n}_${slug(label).slice(0, 40)}`;
          const r = [ref(sourceId, m.fact)];
          put({
            id: actionId,
            type: "ACTION",
            name: display(label),
            jurisdictionId,
            // Both fields, and they are not the same claim. `stepNumber` is the
            // page's: it printed a 3 beside this one. `uiStage` is ours.
            metadata: { whatToDo: m.fact.claim, stepNumber: m.n, uiStage: uiStage(m.fact), machineExtracted: true },
            sources: r,
            lastVerifiedAt: today(),
          });
          link(serviceNodeId, actionId, "REQUIRES", `Step ${m.n} of ${run.length} as the page numbers them.`, r);
          if (previous) link(actionId, previous, "DEPENDS_ON", "The page puts this step after that one.", r);
          previous = actionId;
          cite(ref(sourceId, m.fact), m.fact);
        }
        steps = run.length;
      } else if (!steps && c.facts.filter((f) => f.kind === "ACTION").length >= MIN_STEPS) {
        for (const f of c.facts) if (f.kind === "ACTION") reject("NO_EXPLICIT_ORDER", of(f));
        gaps.push(
          `${service.name}: ${c.url} lists several things to do but never says which comes first, so they were not written as steps. Ordering them would have been us deciding, not the page.`,
        );
      }

      // --------------------------------------------------- requirement groups
      for (const b of blocksOf(fileOf(c.page))) {
        // Deduped on the id, not the phrase: "Aadhaar Card" and "Aadhaar card"
        // are one member, and a group listing the same node twice is a defect
        // the validator is right to reject.
        const members = [...new Map(b.members.filter((m) => isDocument(m) && slug(m)).map((m) => [slug(m), m])).values()];
        if (members.length < 2) {
          if (b.members.length >= 2) {
            reject("GROUP_TOO_FEW_MEMBERS", { url: c.url, kind: "DOCUMENT_GROUP", claim: b.head, evidence: b.evidence, note: `${b.members.length} line(s), ${members.length} of them a known document` });
            gaps.push(`${service.name}: ${c.url} offers a choice under "${b.head}" but fewer than two of the lines under it are documents, so no group was written.`);
          }
          continue;
        }
        // Keyed on the choice itself. The same ten proofs listed on four pages
        // is one group, and the fourth page finding it again is a no-op.
        const key = sha1(`${b.mode}|${members.map((m) => title(m)).sort().join("|")}`).slice(0, 10);
        const groupId = `document_group:g_${key}`;
        const r = [{ sourceId, evidence: b.evidence, confidence: 0.6, verificationStatus: "EXTRACTED" }];
        // Same id shape as the DOCUMENT_REQUIREMENT branch above, so "Aadhaar
        // card" read off a list and `aadhaar_card` read out of a fact land on
        // one node instead of two.
        const memberIds = members.map((m) => `document:${slug(m)}`);
        for (const [i, m] of members.entries()) {
          put({ id: memberIds[i], type: "DOCUMENT", name: display(title(m)), jurisdictionId, sources: r, lastVerifiedAt: today() });
        }
        if (put({ id: groupId, type: "DOCUMENT_GROUP", name: display(stepLabel(b.head)), officialName: b.head, jurisdictionId, sources: r, lastVerifiedAt: today() })) {
          requirementGroups.push({
            id: `rg:g_${key}`,
            ownerNodeId: groupId,
            mode: b.mode,
            ...(b.mode === "AT_LEAST_N" ? { minimumRequired: b.minimum } : {}),
            jurisdictionId,
            members: memberIds.map((nodeId) => ({ nodeId })),
            sources: r,
          });
        }
        link(serviceNodeId, groupId, "REQUIRES", b.head, r);
        // Recorded in the research layer too, and not only cited in the graph.
        // A group's quote is a block read straight off the page rather than a
        // fact an extractor returned, so nothing else was ever going to write
        // it down, and `quotes:audit` is right to call a graph quote with no
        // research behind it unsourced. It passed until now by luck: the same
        // page usually also yielded a DOCUMENT_REQUIREMENT whose evidence
        // contained the block. Corpus wide retrieval broke the luck by
        // attaching pages to services that had never read them.
        facts.push({ claim: b.head, kind: "DOCUMENT_GROUP", subject: service.id, object: null, detail: { mode: b.mode, members: members.map((m) => title(m)) }, sourceId, evidence: b.evidence, confidence: 0.6 });
        cite(r[0], { url: c.url, kind: "DOCUMENT_GROUP", claim: b.head, evidence: b.evidence });
      }
    }

    // Everything below here describes the SERVICE node: its quotes, its fee, its
    // eligibility, the portal it was published on. A hand written service has
    // all of that already and better, and this pass was never allowed to write
    // it. What the claims bought was the edges, and those are already in.
    if (owned) {
      if (edges.length === before) {
        reject("NO_QUOTABLE_EVIDENCE", { url: pages[0].url, claim: service.name, note: `${pages.flatMap((c) => c.facts).length} promoted claim(s) and no edge came out of them` });
      }
      continue;
    }

    if (!serviceRefs.length) {
      notFound.push(`${service.name}: no quotable requirement, fee or timeline survived, so no service node was written for it.`);
      reject("NO_QUOTABLE_EVIDENCE", { url: pages[0].url, claim: service.name, note: `${pages.flatMap((c) => c.facts).length} fact(s) and not one of them load bearing` });
      continue;
    }
    // Deduped: one service quoting the same off-government portal on nine pages
    // is one gap, not nine.
    notFound.push(...new Set(gaps));

    const all = pages.flatMap((c) => c.facts);
    const fee = all.find(isCitizenFee);
    const timeline = all.find(isProcessingTime);
    // Three kinds that arrive under the right name and mean something else: a
    // fee the department pays, a deadline read as a processing time, a sentence
    // about what the scheme is for read as who it is for. Refusing them is the
    // point; not counting them was not.
    for (const f of all) {
      if (f.kind === "FEE" && !isCitizenFee(f)) reject("NOT_A_CITIZEN_FEE", of(f));
      else if (f.kind === "TIMELINE" && !isProcessingTime(f)) reject("NOT_A_PROCESSING_TIME", of(f));
      else if (f.kind === "ELIGIBILITY" && !isQualifyingRule(f)) reject("NOT_A_CRITERION", of(f));
    }
    // Deduped before capping, because nine pages of one scheme repeat the
    // income limit nine times and six copies of one sentence is not six criteria.
    //
    // ponytail: exact match only, so two pages writing one rule in two wordings
    // ("must not own any plot or house" / "must not own any plot or house in
    // their own name") both survive, and Sardar Patel Awas Yojana shows the
    // land rule twice out of six. Tried prefix matching with the shortest kept
    // first and it was worse: sorting by length pulled all four paraphrases of
    // the same rule to the top and pushed the four distinct ones off the end.
    // Jaccard is the real fix and its threshold has no safe setting here,
    // because Chiranjeevi Yojana's five genuinely different rules share a
    // fourteen word boilerplate tail and score 0.48 against each other. Page
    // order plus exact dedupe reads fine; revisit with sentence embeddings or
    // not at all.
    const rules = [...new Set(all.filter(isQualifyingRule).map((f) => f.claim))];
    const eligibility = rules.slice(0, ELIGIBILITY_SHOWN);
    for (const claim of rules.slice(ELIGIBILITY_SHOWN)) {
      reject("TRUNCATED_BY_CAP", { url: pages[0].url, kind: "ELIGIBILITY", claim, note: `past the ${ELIGIBILITY_SHOWN} rules a service shows` });
    }

    // Page names first, then the ones citizens use. Deduped because a curated
    // row and a page can independently arrive at the same string, and a node
    // listing one name twice is a node that looks edited by hand.
    namesUnused.delete(serviceNodeId);
    const aliases = [...new Set([...service.aliases, ...(curatedNames.get(serviceNodeId) ?? [])])];

    put({
      id: serviceNodeId,
      type: "SERVICE",
      name: display(service.name),
      officialName: service.name,
      // Omitted rather than empty. Postgres has no way to tell an empty array
      // from an absent one, so writing `[]` here is a round trip that never
      // closes, and "this service has no other names" is exactly what absent
      // already means.
      ...(aliases.length ? { aliases } : {}),
      description: service.summary,
      jurisdictionId,
      metadata: {
        // The one honest label that has to survive to the screen. Everything in
        // this bundle was read by a machine and checked by a machine, and that
        // is a different thing from a person having looked at it.
        machineExtracted: true,
        // The sentence, not the number. `{amount: 50}` rendered as "Fee: 50",
        // which is not an answer to what it costs, and `processingDays` was
        // written by this line and read by nobody, so 189 services had a
        // published processing time that never reached a screen.
        ...(fee ? { fee: fee.claim } : {}),
        ...(timeline ? { timeline: timeline.claim } : {}),
        ...(eligibility.length ? { eligibility } : {}),
      },
      sources: serviceRefs,
      lastVerifiedAt: today(),
    });

    // -------------------------------------------- what it costs, as a node
    //
    // `metadata.fee` above is one sentence, because `all.find` takes the first
    // fee and a string has room for one. That was enough while a fee was a
    // number. It is not enough for the RTO, whose page prices twenty different
    // registrations, and completeness has never counted any of it: it asks for
    // a PAYMENT node and this file only ever wrote a string. 47 fees across 12
    // services had already survived the verbatim gate and `isCitizenFee`, and
    // every one of them stopped here.
    //
    // One node per service, not per price. Twenty PAYMENT nodes compile to
    // twenty steps, and a citizen registering one motorcycle does not pay
    // twenty times. A fee schedule is one thing you do at one counter.
    const priced = [];
    for (const c of pages) {
      const sourceId = sourceRow(c).id;
      for (const f of c.facts) if (isCitizenFee(f)) priced.push({ f, r: ref(sourceId, f) });
    }
    if (priced.length) {
      const paymentId = `payment:${service.id}_fee`;
      // Deduped on the sentence: nine pages of one scheme quote the same price
      // nine times, and nine copies of Rs. 20 is not a schedule.
      const schedule = [...new Set(priced.map((p) => p.f.claim))];
      if (put({
        id: paymentId,
        type: "PAYMENT",
        name: `Pay the fee for ${display(service.name)}`,
        jurisdictionId,
        metadata: { machineExtracted: true, fee: schedule.join("\n") },
        sources: priced.slice(0, 12).map((p) => p.r),
        lastVerifiedAt: today(),
      })) {
        for (const p of priced.slice(12)) reject("TRUNCATED_BY_CAP", { ...of(p.f), note: "past the 12 quotes a payment node shows" });
        link(serviceNodeId, paymentId, "REQUIRES", schedule[0], [priced[0].r]);
      }
    }

    const portalHost = pages[0].page.host;
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
  for (const e of edges) {
    if (kept.includes(e)) continue;
    const missing = live.has(e.from) || taken.has(e.from) ? e.to : e.from;
    reject("DANGLING_REFERENCE", { url: journey, kind: e.type, claim: e.id, evidence: e.sources?.[0]?.evidence, note: `${missing} was never written` });
  }

  // The two layers disagree about `cacheFile` and `scrapedOk` on purpose. They
  // are facts about *our fetch*, which the ledger needs and the sources table
  // has no column for, so carrying them into the graph makes `db:push` lose them
  // on the way out and the round trip diff never closes.
  const forGraph = sources.map(({ cacheFile, scrapedOk, ...rest }) => rest);

  return {
    // A group whose owner never made it into `nodes` is the same dangling
    // reference as a dangling edge, and both happen for the same reason: the
    // service it hung off had nothing quotable and was dropped.
    graph: {
      id: journey,
      sources: forGraph,
      nodes,
      edges: kept,
      requirementGroups: requirementGroups.filter((g) => live.has(g.ownerNodeId) && g.members.every((m) => live.has(m.nodeId))),
      questions: [],
    },
    research: { journey, researchedAt: today(), region: "Gujarat, India", sources, facts, notFound },
  };
}

// --------------------------------------------------------------------- write

let written = 0;
const summary = [];
for (const [journey, services] of [...journeys.entries()].sort()) {
  const list = [...services.values()].filter((s) => s.pages.length > 0);
  if (list.length < MIN_SERVICES) {
    summary.push(`${journey}: ${list.length} service(s), below the ${MIN_SERVICES} needed to be a journey. Not written.`);
    for (const s of list) reject("JOURNEY_TOO_SMALL", { url: s.pages[0].url, claim: s.name, note: `${journey} had ${list.length}, needs ${MIN_SERVICES}` });
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

// A curated name pointing at a service that no longer compiles is a citizen
// search term that silently stopped working. Say so; the whole reason the file
// exists is that a name going missing looks like an empty page, not an error.
if (namesUnused.size) {
  console.log(`\n${namesUnused.size} row(s) in docs/research/service-names.tsv name a service this run did not build:`);
  for (const id of namesUnused) console.log(`  ${id}`);
}

// ---------------------------------------------------------------- rejections
//
// Written even on a dry run. Seeing what a compile *would* throw away, without
// touching the bundles, is most of the point of --dry.
replaceStage(REJECTIONS, "compile", drops.rows);

/**
 * The committed aggregate.
 *
 * The rows themselves are gitignored: they rebuild from committed facts with
 * no model call, so they are derived data and 5MB of churn per compile is 5MB
 * of history nobody will ever read. The counts are the thing you want in a
 * diff, because a reason that doubles between two runs is the review comment.
 */
const byReason = new Map();
for (const row of drops.rows) {
  const key = `${row.stage}|${row.reason}`;
  const seen = byReason.get(key) ?? { stage: row.stage, reason: row.reason, count: 0, examples: [] };
  seen.count++;
  if (seen.examples.length < 5) seen.examples.push({ url: row.url, claim: row.claim ?? null, note: row.note ?? null });
  byReason.set(key, seen);
}
writeFileSync(
  at(REJECTION_SUMMARY),
  JSON.stringify(
    {
      runId,
      compiledAt: today(),
      total: drops.rows.length,
      reasons: [...byReason.values()].sort((a, b) => b.count - a.count),
    },
    null,
    1,
  ) + "\n",
);
console.log(`\n${drops.rows.length} candidate(s) refused, by ${byReason.size} distinct reason(s). Written to ${REJECTIONS}`);
console.log(`Run: pnpm rejections:stats`);

if (!flag("dry")) console.log(`\nNow run: pnpm bundles:build && pnpm graph:validate && pnpm quotes:audit`);
