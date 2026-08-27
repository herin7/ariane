/**
 * Fifty ordinary sentences that hide a permission nobody mentions.
 *
 *   pnpm edge:research                    every case, resumable
 *   pnpm edge:research --limit 5          the first five
 *   pnpm edge:research --case EDGE-013
 *   pnpm edge:research --report           what is on disk, no network
 *   pnpm edge:research --selftest
 *
 * The point is not fifty more services. It is one pattern, learned with
 * evidence attached:
 *
 *   ordinary goal -> hidden trigger -> conditional permission -> authority
 *
 * "I want a diesel generator" is not "you need a PESO licence". It is "storing
 * more than some quantity of diesel needs a licence, and here is the page that
 * says the quantity". A product that flattens that is worse than one that says
 * nothing, because the citizen cannot tell which of the two it did.
 *
 * The hypothesis on each case is a research oracle and is never ingested. It
 * exists so a human can see whether the pass found what a knowledgeable person
 * would expect, and so an empty result reads as a gap rather than a pass. No
 * claim in the output came from it: every claim carries a url we fetched and a
 * quote that is a verbatim substring of what we fetched, through the same
 * `gate.mjs` the rest of the estate goes through.
 *
 * Nothing here writes to `.graph`'s bundles. The output is a research artifact
 * under `.graph/research/`, which the compiler does not read, so an UNVERIFIED
 * or CONFLICTING finding cannot reach a citizen by accident. Promoting one is a
 * separate, deliberate act.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { grounded, id, unmark } from "./gate.mjs";
import { at, appendJsonl, chat, fetchBytes, fetchPage, hostOf, INGEST, jsonArray, MODELS, normalise, pool, renderPage, RESEARCH, sha1, toText } from "./lib.mjs";

/**
 * pdfjs hands back a run per text item and a government PDF is mostly tables.
 *
 * `pdf-extract.mjs` has this same tidy and it is not imported: that file is a
 * command, not a module, and importing it runs its whole queue. Four lines of
 * whitespace handling is the cheaper duplicate. The gate is the thing that must
 * never be copied, and that one is imported.
 */
const tidyPdfText = (raw) => {
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  return lines.filter((l, i) => l && l !== lines[i - 1]).join("\n");
};

const EDGE = INGEST + "edge/";
const SEARCHES = EDGE + "search/";
const PAGES = INGEST + "pages/";
const ANSWERS = EDGE + "answers/";
export const FACTS = EDGE + "facts.jsonl";
export const REPORT = `${RESEARCH}/edge-cases.json`;

/**
 * Bump when a change here would make the same page answer differently.
 *
 * 2: a quote has to be a sentence, because v1 reported four downloadable form
 *    names off one page as four separate rules.
 * 3: a sentence has to do something. v2 kept a nine word row of a licence menu
 *    and a marketing blog’s twelve lakh threshold.
 * 4: the model is told who is asking. v3 answered a home baker with the draft
 *    rules for school meal caterers and a cloud kitchen with the clearance
 *    times for imported consignments, both verbatim and neither about them.
 */
export const PROMPT_VERSION = 4;

/**
 * A case is a sentence, a hypothesis and the words to search with.
 *
 * `ask` is what a person says. `hypothesis` is what we expect to find and is
 * evidence of nothing. `queries` are search strings, not answers: they name the
 * activity and the jurisdiction and let the government's own pages name the
 * permission, because a query that already contains "PESO licence" can only
 * find the answer it was given.
 */
export const CASES = [
  { id: "EDGE-001", ask: "I rented a small shop in Ahmedabad and want to open a café.", hypothesis: "Shops and Establishment, food licensing, premises fire and building use, employer registrations if staff. None of them universal.", queries: ["Gujarat shops and establishment registration restaurant", "Ahmedabad restaurant licence requirements municipal corporation"] },
  { id: "EDGE-002", ask: "I bake cakes from home and sell them on Instagram.", hypothesis: "Home based food business can still need FSSAI registration; petty food business operator category and the current turnover threshold decide which.", queries: ["FSSAI registration petty food business operator eligibility", "FSSAI home based food business licence registration"] },
  { id: "EDGE-003", ask: "I want to put a food stall at a two-day college festival.", hypothesis: "Temporary stall holders can fall under food registration; event or organiser permissions may cover part of it.", queries: ["FSSAI registration temporary stall holder event", "Gujarat temporary food stall permission"] },
  { id: "EDGE-004", ask: "No dine-in, just delivery from a rented kitchen.", hypothesis: "No dine-in does not remove food licensing; premises conditions still apply.", queries: ["FSSAI licence cloud kitchen requirement", "FoSCoS eligibility kind of business"] },
  { id: "EDGE-005", ask: "I rented an office in Ahmedabad and hired 12 people.", hypothesis: "Shops and Establishment, professional tax employer registration, premises compliance. Thresholds must come from the rules, not from us.", queries: ["Gujarat shops and establishment act registration establishment", "Gujarat professional tax employer registration"] },
  { id: "EDGE-006", ask: "My company has 8 employees but 30 contract cleaners and guards.", hypothesis: "Principal employer obligations can trigger on contract labour headcount, not direct headcount.", queries: ["contract labour regulation abolition act registration principal employer", "Gujarat labour contractor licence registration"] },
  { id: "EDGE-007", ask: "I hired workers through a contractor from Rajasthan.", hypothesis: "Inter state migrant workmen registration or contractor licence on a headcount trigger.", queries: ["inter state migrant workmen act registration contractor licence", "Gujarat inter state migrant workmen licence"] },
  { id: "EDGE-008", ask: "I operate a fleet of vans and employ drivers.", hypothesis: "Motor transport workers registration in addition to ordinary business registration.", queries: ["motor transport workers act registration certificate", "Gujarat motor transport undertaking registration labour"] },
  { id: "EDGE-009", ask: "We want to install a lift in our office building.", hypothesis: "Permission to erect, inspection, then permission to use. Three states, not one node.", queries: ["Gujarat lift escalator permission electrical inspector", "Gujarat lift act rules permission to erect"] },
  { id: "EDGE-010", ask: "The builder already installed the lift. Can we start using it?", hypothesis: "Installed is not licensed; a use permission or inspection may still be pending, and the duty may sit with the owner or occupier.", queries: ["Gujarat lift permission to use licence owner", "Gujarat lift escalator inspection certificate"] },
  { id: "EDGE-011", ask: "Temporary lighting and equipment for a three-day exhibition.", hypothesis: "Chief Electrical Inspector publishes a temporary installation approval path.", queries: ["Gujarat chief electrical inspector temporary installation approval", "ceiced gujarat temporary installation checklist"] },
  { id: "EDGE-012", ask: "I want to install a diesel generator as backup power.", hypothesis: "Electrical approval, pollution rules and fuel storage each have their own trigger; capacity and fuel quantity decide.", queries: ["Gujarat pollution control board DG set generator consent", "Gujarat electrical inspector generating plant approval"] },
  { id: "EDGE-013", ask: "We keep a diesel drum for our generator.", hypothesis: "Petroleum storage licensing turns on quantity and class, with an exempt quantity below it.", queries: ["PESO requirement of license petroleum rules 2002 storage", "petroleum rules exemption quantity licence diesel storage"] },
  { id: "EDGE-014", ask: "My restaurant uses several commercial LPG cylinders.", hypothesis: "Food licence answers none of this; cylinder quantity and storage decide whether a separate approval applies.", queries: ["PESO LPG cylinder storage licence commercial", "gas cylinder rules storage licence exemption quantity"] },
  { id: "EDGE-015", ask: "I want to drill a borewell for my factory.", hypothesis: "Groundwater NOC, with the assessment unit category and the use deciding.", queries: ["CGWA groundwater NOC industrial guidelines", "Gujarat groundwater NOC borewell industry"] },
  { id: "EDGE-016", ask: "Our apartment society wants its own borewell.", hypothesis: "Group housing is not the individual household exemption.", queries: ["CGWA groundwater NOC group housing society", "ground water abstraction NOC domestic exemption"] },
  { id: "EDGE-017", ask: "I want to start a bottled water plant.", hypothesis: "Groundwater, food licence, standards certification and pollution consent stack.", queries: ["packaged drinking water BIS certification licence", "packaged drinking water FSSAI licence requirement"] },
  { id: "EDGE-018", ask: "One tree blocks the entrance to my factory plot. Can I cut it?", hypothesis: "Owning the land is not permission; Gujarat exposes a felling permission path.", queries: ["Gujarat permission to cut tree private land forest department", "Gujarat tree felling permission application"] },
  { id: "EDGE-019", ask: "I got permission to cut the tree. Can I move the wood?", hypothesis: "Transit of timber is a separate permission from felling it.", queries: ["Gujarat transport permission chopped wood forest", "forest clearance cut and transport trees Gujarat"] },
  { id: "EDGE-020", ask: "I bought land near Ahmedabad airport and want to build.", hypothesis: "Airport Authority NOC on a height and distance condition, not on every building.", queries: ["Gujarat building plan NOC airport authority", "AAI NOC height clearance building application"] },
  { id: "EDGE-021", ask: "My property is close to a protected monument.", hypothesis: "National Monuments Authority NOC inside a prohibited or regulated zone.", queries: ["National Monuments Authority NOC construction regulated area", "Gujarat building plan NOC monument authority"] },
  { id: "EDGE-022", ask: "I'm constructing a commercial building.", hypothesis: "Fire NOC applicability by building height and use, and more than one stage of it.", queries: ["Gujarat fire NOC building construction requirement", "Gujarat comprehensive general development control regulations fire"] },
  { id: "EDGE-023", ask: "Construction is complete. Can I move my office in?", hypothesis: "Building use permission, and the final fire approval where it applies.", queries: ["Gujarat building use permission occupancy certificate", "Ahmedabad municipal corporation building use permission"] },
  { id: "EDGE-024", ask: "I want to use my residential flat as an office.", hypothesis: "Land use and building use constrain it; ownership does not settle it.", queries: ["Ahmedabad change of use residential to commercial permission", "Gujarat development control regulations use change permission"] },
  { id: "EDGE-025", ask: "I got a dog. Do I need to register it?", hypothesis: "Municipal, not state wide. Ahmedabad has a pet registration path.", queries: ["Ahmedabad municipal corporation pet dog registration", "AMC dog licence registration"] },
  { id: "EDGE-026", ask: "I want to sell puppies and pet animals.", hypothesis: "Pet shop registration under animal welfare rules plus ordinary business registration.", queries: ["pet shop registration rules animal welfare board", "Gujarat pet shop licence registration"] },
  { id: "EDGE-027", ask: "I want to open a veterinary clinic.", hypothesis: "Professional registration plus establishment and waste requirements.", queries: ["Gujarat veterinary council registration practitioner", "veterinary clinic registration requirement India"] },
  { id: "EDGE-028", ask: "I'm a doctor opening a small private clinic.", hypothesis: "Medical registration, clinical establishment registration where the state has adopted it, biomedical waste authorisation, drug licence only if dispensing.", queries: ["Gujarat clinical establishment registration act", "biomedical waste authorisation Gujarat pollution control board clinic"] },
  { id: "EDGE-029", ask: "I'm opening a dental clinic with an X-ray machine.", hypothesis: "AERB registration or licence for the radiation source, separate from the clinic.", queries: ["AERB eLORA registration dental x-ray equipment", "AERB radiation facility licence medical diagnostic x-ray"] },
  { id: "EDGE-030", ask: "I want to start a blood-testing laboratory.", hypothesis: "Clinical establishment or local registration, waste authorisation, staffing conditions.", queries: ["Gujarat pathology laboratory registration requirement", "clinical establishment registration laboratory India"] },
  { id: "EDGE-031", ask: "I want to sell medicines through my website.", hypothesis: "Drug licensing applies; online sale has extra constraints and unsettled rules.", queries: ["CDSCO online sale of medicines drug licence", "Gujarat FDCA retail drug licence application"] },
  { id: "EDGE-032", ask: "My clinic stores oxygen cylinders.", hypothesis: "Compressed gas cylinder storage rules with an exempt quantity.", queries: ["PESO medical oxygen cylinder storage licence", "gas cylinder rules 2016 storage exemption oxygen"] },
  { id: "EDGE-033", ask: "I run a grocery shop and use a weighing scale.", hypothesis: "Legal metrology verification and stamping for a weight used in trade.", queries: ["Gujarat legal metrology verification stamping weighing instrument", "legal metrology act verification weights and measures use in trade"] },
  { id: "EDGE-034", ask: "I repair weighing machines for shops.", hypothesis: "Dealer or repairer licence under legal metrology.", queries: ["Gujarat legal metrology dealer repairer licence", "legal metrology repairer licence application"] },
  { id: "EDGE-035", ask: "I package spices and sell them in 500g packets.", hypothesis: "Food licence plus packaged commodity declarations. A label rule is not a permission to operate.", queries: ["legal metrology packaged commodities rules declarations", "FSSAI licence food manufacturer packing"] },
  { id: "EDGE-036", ask: "I want to start selling agricultural seeds.", hypothesis: "A seed licence with a named competent authority.", queries: ["Gujarat seed licence agriculture department application", "seed licence issue renewal Gujarat"] },
  { id: "EDGE-037", ask: "I want to open a fertilizer shop.", hypothesis: "Fertiliser authorisation, not ordinary shop registration.", queries: ["Gujarat fertilizer licence authorisation certificate dealer", "fertilizer control order authorisation certificate application"] },
  { id: "EDGE-038", ask: "I want to sell pesticides.", hypothesis: "Insecticide licence with qualification and storage conditions.", queries: ["Gujarat insecticide licence dealer application", "insecticides act licence to sell stock exhibit"] },
  { id: "EDGE-039", ask: "I got a shed in GIDC. Can I start production immediately?", hypothesis: "Estate level approvals do not carry unit level ones: factory licence, consent, electrical approval remain.", queries: ["GIDC plug and play approvals unit", "Gujarat factory licence application chief inspector of factories"] },
  { id: "EDGE-040", ask: "The factory building is ready. Can production start?", hypothesis: "Consent to establish, then consent to operate, by industry category.", queries: ["GPCB consent to establish consent to operate procedure", "Gujarat pollution control board CTE CTO application"] },
  { id: "EDGE-041", ask: "We have all licences but installed new machinery.", hypothesis: "Amendment of existing approvals when capacity, process or load changes.", queries: ["GPCB amendment consent change in product capacity", "Gujarat factory licence amendment change machinery"] },
  { id: "EDGE-042", ask: "Our factory installed a steam boiler.", hypothesis: "Boiler registration, inspection and periodic certificate as a separate track.", queries: ["Gujarat boiler registration inspection certificate", "boilers act registration inspection Gujarat"] },
  { id: "EDGE-043", ask: "We use compressed gas tanks in manufacturing.", hypothesis: "Pressure vessel and gas rules with vessel, gas and capacity deciding.", queries: ["PESO static and mobile pressure vessel licence SMPV", "gas cylinder rules filling storage licence industrial"] },
  { id: "EDGE-044", ask: "I'm hosting a public workshop with amplified sound.", hypothesis: "Loudspeaker permission from police and noise rules by time and zone.", queries: ["Gujarat police loudspeaker permission application", "noise pollution rules loudspeaker permission night"] },
  { id: "EDGE-045", ask: "My café has live bands on weekends.", hypothesis: "Performance or amusement permission, loudspeaker permission and music copyright licensing are three different things.", queries: ["Gujarat police public performance licence permission", "Ahmedabad municipal corporation amusement licence"] },
  { id: "EDGE-046", ask: "I'm organizing a fair with amusement rides.", hypothesis: "Event permission, electrical inspection, fire and ride safety.", queries: ["Gujarat amusement ride permission safety inspection", "Ahmedabad event permission fire NOC temporary structure"] },
  { id: "EDGE-047", ask: "I rented my flat to someone. Do I need to tell the police?", hypothesis: "Gujarat exposes tenant registration; whether it is mandatory and whose duty it is has to come from the source.", queries: ["Gujarat police tenant registration form", "Ahmedabad police tenant verification registration online"] },
  { id: "EDGE-048", ask: "I want a large illuminated signboard outside my shop.", hypothesis: "Municipal advertisement permission; a nameplate and a hoarding are not the same thing.", queries: ["Ahmedabad municipal corporation advertisement hoarding permission", "Gujarat municipal advertisement licence signboard fee"] },
  { id: "EDGE-049", ask: "I want rooftop solar for my office.", hypothesis: "Discom net metering application and electrical approval by capacity and connection type.", queries: ["Gujarat rooftop solar net metering application discom", "GERC rooftop solar regulations net metering procedure"] },
  { id: "EDGE-050", ask: "Three floors in Ahmedabad: café below, 30 staff above, DG set, new lift, borewell, LED sign, office dog, monthly live music.", hypothesis: "The answer is a question set, not a licence list. Premises, responsibility, capacity and event details decide which of the other forty-nine branches even open.", queries: ["Gujarat single window clearance approvals business", "Gujarat investor facilitation portal approvals list"] },
];

/**
 * Official, and nothing else.
 *
 * A consultant's blog explaining the rule correctly is still a consultant's
 * blog: it can be a lead for a search and it can never be a source. Second
 * level check on `.in` because `gov.in` as a substring matches a domain
 * somebody registered to look like one.
 */
export const official = (url) => {
  const host = hostOf(url);
  if (!host) return false;
  // `.gov` without the `.in` was here to catch a stray central host and what it
  // actually caught was the Texas Commission on Environmental Quality, which
  // answered a Gujarat diesel drum with the exemptions from Texas petroleum
  // storage tank rules. Official, verbatim, and eight thousand miles wrong.
  return /(^|\.)(gov|nic)\.in$/.test(host);
};

/**
 * The other states, by name, because a national portal serves all of them.
 *
 * Measured on the first probe: "Registration under The Shops and Establishment
 * Act" came back grounded, verbatim and correct, off the Jammu and Kashmir page
 * of the national single window. Everything about that claim was true except
 * the only thing a citizen in Ahmedabad needed it to be. A page that names
 * another state in its own url is answering somebody else's question.
 */
const OTHER_STATES =
  /(andhra|arunachal|assam|bihar|chhattisgarh|goa|haryana|himachal|jharkhand|karnataka|kerala|madhya[-_]?pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil[-_]?nadu|telangana|tripura|uttar[-_]?pradesh|uttarakhand|west[-_]?bengal|jammu|kashmir|ladakh|puducherry|chandigarh)/i;

/**
 * The same thing again as a subdomain, because a state does not have to spell
 * its name to be the wrong one.
 *
 * `excise.wb.gov.in` came back for a food stall in Gujarat and passed every
 * check: official host, no state named anywhere in the url, and a perfectly
 * true page about West Bengal liquor licences. Every state code except `gj`.
 */
const STATE_CODES =
  /\.(ap|ar|as|br|cg|ga|hp|hr|jh|jk|ka|kl|la|ld|mh|ml|mn|mp|mz|nl|od|pb|py|rj|sk|tn|tr|ts|uk|up|wb|an|ch|dd|dn)\.gov\.in$/i;

/**
 * A blog on a government domain is still a blog.
 *
 * `startupindia.gov.in/content/sih/en/bloglist/...` is a `.gov.in` host and a
 * marketing article, and it is where the twelve lakh food licence threshold
 * came back from: a number somebody wrote up once, on a page no department
 * maintains, which is exactly the stale fact this pass exists to not repeat.
 */
const NOT_A_RULE_PAGE = /\/(blog|bloglist|blogs|news|press|media|gallery|tenders?|recruitment|vacanc)/i;

/**
 * Neither is a document somebody has to win, or one nobody has passed yet.
 *
 * A Delhi Development Authority request for proposals for a park kiosk lists a
 * valid FSSAI licence among the things a bidder must furnish, which is true and
 * is a term of that contract, not a rule for a college festival stall. A draft
 * notice inviting comments is the other half: it is what the rule might become.
 */
const NOT_IN_FORCE = /(rfp|rfq|\bbid\b|eoi|landdisposal|draft[-_]?(notice|rules?|regulation)|_draft|comments?[-_]invited)/i;

/**
 * And once more as a squashed prefix, because neither of the two above catches
 * a state that abbreviates itself into the host label.
 *
 * `hrylabour.gov.in` and `pblabour.gov.in` are Haryana's and Punjab's labour
 * departments and both came back for a Gujarat contract labour question, with
 * no state name, no state code and a perfectly correct answer about somewhere
 * else. `ghmc.gov.in` is Hyderabad's municipal corporation and arrived the same
 * way. A department host is `<who><what>.gov.in`, so this asks for the state
 * code and a department word after it rather than the code alone: `up` on its
 * own would take `upsc.gov.in` off the table and `ap` would take `apeda`, and
 * both of those are central bodies with every right to answer.
 */
const STATE_DEPARTMENTS =
  /^(hry|pb|mh|ap|ts|ka|tn|up|mp|rj|wb|od|br|jh|cg|hp|uk)(labour|labor|police|rto|excise|revenue|health|fire|panchayat|urban|municipal|transport|forest|industries|pollution|treasury)/i;

/** Somebody else's city. Whole label only: these are the corporation's name. */
const OTHER_CITIES = /^(ghmc|bbmp|mcgm|pmc|kmc|nmmc|bmc|ndmc|mcd|dda)$/i;

export const wrongState = (url) => {
  const u = url.toLowerCase();
  if (/gujarat/.test(u)) return false;
  const host = hostOf(u) ?? "";
  if (OTHER_STATES.test(u) || STATE_CODES.test(host)) return true;
  const label = host.replace(/^www\./, "").split(".")[0] ?? "";
  return /\.gov\.in$/.test(host) && (STATE_DEPARTMENTS.test(label) || OTHER_CITIES.test(label));
};

export const readable = (url) => !NOT_A_RULE_PAGE.test(url) && !NOT_IN_FORCE.test(url);

/**
 * Gujarat first, then the central regulator, then whatever else is official.
 *
 * Not a score, an order: a case about a Gujarat café is answered by Gujarat's
 * own department before it is answered by a national aggregator, and the six
 * page budget means the order decides what gets read at all.
 */
export const rank = (url) => {
  const host = hostOf(url) ?? "";
  if (host.endsWith(".gujarat.gov.in") || host.includes("gujarat")) return 0;
  if (/^(www\.)?(fssai|peso|aerb|cdsco|cgwa|dgft)\./.test(host)) return 1;
  if (host.endsWith(".gov.in")) return 2;
  return 3;
};

const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const isMain = fileURLToPath(import.meta.url) === process.argv[1];

// ------------------------------------------------------------------- search

/**
 * Firecrawl's search, cached on the query.
 *
 * Cached because the same query runs again on every resume and a search result
 * page is the cheapest thing in the pipeline to get wrong twice. The cache is
 * the query, so changing the words is a different search and re-running with
 * the same words costs nothing.
 */
export async function search(query, { limit = 10 } = {}) {
  const file = at(SEARCHES + sha1(query) + ".json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));

  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return { query, results: [], failure: "NO_API_KEY" };

  let out = { query, results: [], failure: null };
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ query, limit, sources: ["web"] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) out.failure = `HTTP_${res.status}`;
    else {
      const body = await res.json();
      // v2 nests by source, v1 returned a flat array. Take whichever arrived.
      const rows = Array.isArray(body?.data) ? body.data : (body?.data?.web ?? []);
      out.results = rows
        .map((r) => ({ url: String(r?.url ?? ""), title: String(r?.title ?? "").slice(0, 200) }))
        .filter((r) => r.url);
    }
  } catch (e) {
    out.failure = String(e?.message ?? e).slice(0, 60);
  }

  if (!out.failure) writeFileSync(file, JSON.stringify(out));
  return out;
}

// -------------------------------------------------------------------- fetch

/**
 * The page, from the corpus cache if the estate already has it.
 *
 * `.ingest/pages/<sha1(url)>.md` is the same cache `services-extract` fills, so
 * a case whose answer is on a page we already fetched costs nothing at all. A
 * page nobody has fetched is fetched here, and only the ones that come back
 * thin are worth a render: a browser render is the expensive path and most
 * government pages are static html that never needed one.
 */
export const isPdf = (url) => /\.pdf(\?|#|$)/i.test(url) || /AttachmentFileName=.*\.pdf/i.test(url);

export async function page(url) {
  const key = sha1(normalise(url));
  const file = at(PAGES + key + ".md");
  if (existsSync(file)) return { url, text: readFileSync(file, "utf8"), from: "CACHE" };

  // A PDF put through the html reader is not a thin page, it is a page of
  // binary that no gate can quote from and every model will hallucinate around.
  // Gujarat's approval checklists are mostly PDFs, so this is the common path
  // here rather than an edge of it.
  if (isPdf(url)) {
    const bytes = await fetchBytes(url);
    if (!bytes.ok || !bytes.body?.length) return { url, text: "", from: "EMPTY" };
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(bytes.body));
      const { text } = await extractText(doc, { mergePages: true });
      const tidy = tidyPdfText(String(text ?? ""));
      if (tidy.length < 200) return { url, text: "", from: "EMPTY" };
      mkdirSync(at(PAGES), { recursive: true });
      writeFileSync(file, tidy);
      return { url, text: tidy, from: "PDF" };
    } catch {
      // Encrypted, malformed, or a version pdfjs will not open. A gap, and the
      // case reports it as unreadable rather than as an absence of rules.
      return { url, text: "", from: "EMPTY" };
    }
  }

  const got = await fetchPage(url);
  let text = got.ok && got.body ? toText(got.body) : "";
  let from = "FETCH";
  if (text.trim().length < 600) {
    const rendered = await renderPage(url);
    if (rendered.ok && rendered.markdown.length > text.length) {
      text = rendered.markdown;
      from = "RENDER";
    }
  }
  if (text.trim().length < 200) return { url, text: "", from: "EMPTY" };

  mkdirSync(at(PAGES), { recursive: true });
  writeFileSync(file, text);
  return { url, text, from };
}

// ------------------------------------------------------------------ extract

const SYSTEM = `You read one official Indian government page and report what it says about permissions, licences and approvals.

You are looking for CONDITIONS, not conclusions. "A licence is required" is nearly useless. "A licence is required for storage above 2500 litres" is the fact worth having.

Return a JSON array. Each object:
{
  "permission": "the name of the licence, NOC, registration or approval as the page calls it",
  "authority": "the office or body that issues it, as named on the page, or null",
  "trigger": "the condition under which it applies, in the page's own terms",
  "who": "who must apply, or null",
  "exemption": "a stated exemption, threshold or 'shall not apply' case, or null",
  "channel": "ONLINE, OFFLINE, BOTH or null",
  "renewal": "validity or renewal period, or null",
  "evidence": "an EXACT sentence copied character for character from the page"
}

Rules:
- evidence must be copied from the page verbatim. Not summarised, not tidied, not translated. If you cannot copy a sentence that supports the fact, do not report the fact.
- never turn "may be required" into "is required". Report the page's hedge as the page wrote it.
- evidence must be a full sentence of at least eight words. A form name, a menu item, a column heading or a link label is not evidence, even when it is on the page.
- if the page does not discuss permissions, return [].
- you are told what somebody is trying to do. Report only permissions that would bind THEM. A page can be official, current and verbatim and still be about somebody else: a school meal contractor, an importer at a port, a bidder for a park kiosk in Delhi. Those are not this person, and reporting them is worse than reporting nothing, because it reads as an answer.
- if the page is about permissions but none of them touch what this person is doing, return [].
- at most 8 objects. Prefer the ones with a number, a threshold or a named authority in them.
Return only the JSON array.`;

/**
 * The page, and who is asking.
 *
 * The ask went missing from this prompt for two versions and the pass answered
 * a home baker with the FSSAI's draft rules for school meal caterers and a
 * cloud kitchen with the timeline for clearing imported consignments at a port.
 * Both were verbatim, official and current. Neither was about them.
 */
const userPrompt = (url, title, text, ask) =>
  `Somebody's situation: ${ask}\n\nPage: ${url}\nTitle: ${title ?? ""}\n\n${text.slice(0, 12000)}`;

/**
 * Long enough to be a rule rather than a label.
 *
 * Eight words and forty characters, both measured against the junk the first
 * probe let through: every dropped row was a form name or a column heading and
 * none of them reached eight words. A real requirement almost always carries a
 * verb, a number or a condition, and cannot say any of that in five words.
 */
const RULE_MARKER = /\b(shall|must|require[ds]?|needs?|obtain|apply|application|issued?|grant(ed)?|prescribed|exempt|liable|permitted|valid|renew|not apply)\b|\d/i;

/**
 * "Form No. II [See rule 18(1)] Certificate of Registration" is eight words, has
 * three numbers in it and is a row in a table of downloadable forms. It cleared
 * both floors above and came back four times off one page. A row that opens by
 * naming a form is naming a form.
 */
const A_FORM_INDEX_ROW = /^form\s*(no\.?|number)?\s*[-–]?\s*[ivxlc0-9]/i;

/**
 * A run of links read as one line, which is what a nav bar looks like in text.
 *
 * "Registration of Motor transport undertaking | Section 3" is a row of the
 * Act's own table of contents. "Applications Under Contract Labour Act
 * Registration Application License Application License Renew Application
 * Application for amendment in registration" is the sidebar of a forms page,
 * forty words long with six of them repeated. Prose does not repeat itself like
 * that and does not use a pipe.
 */
const A_MENU = (t) => {
  if (t.includes("|")) return true;
  const words = t.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return words.length >= 8 && new Set(words).size / words.length < 0.65;
};

export const sentence = (s) => {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (A_FORM_INDEX_ROW.test(t) || A_MENU(t)) return false;
  // A row of a licence menu clears eight words easily: "FL ON License for
  // hotel or restaurant & attached bar" is nine and is a link. A rule either
  // does something to somebody or has a number in it, and a list entry has
  // neither.
  return t.length >= 40 && t.split(/\s+/).length >= 8 && RULE_MARKER.test(t);
};

/** One page through the model, cached on the page content and this prompt. */
export async function readPage(caseId, got, ask, model = MODELS.tier1) {
  const key = sha1(`${got.url}|${ask}|${PROMPT_VERSION}|${model}|${got.text.length}`);
  const file = at(ANSWERS + key + ".json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));

  const reply = await chat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt(got.url, null, unmark(got.text), ask) },
    ],
    { model, maxTokens: 3000 },
  );

  const raw = reply ? (jsonArray(reply.text) ?? []) : [];
  const claims = [];
  const dropped = [];
  for (const f of raw) {
    if (!f || typeof f !== "object" || typeof f.permission !== "string" || !f.permission.trim()) {
      dropped.push({ reason: "INVALID_SCHEMA", permission: String(f?.permission ?? "").slice(0, 80) });
      continue;
    }
    // A row in a table of downloadable forms is verbatim, official and says
    // nothing: the first probe returned "Shops and Establishment License
    // Application Form-A" four times as though it were four rules. The gate
    // below cannot see the difference because both are really on the page, so
    // the length of the sentence is the only thing separating a rule from a
    // filename.
    if (!sentence(f.evidence)) {
      dropped.push({ reason: "NOT_A_SENTENCE", permission: f.permission.slice(0, 80), evidence: String(f.evidence ?? "").slice(0, 160) });
      continue;
    }
    // The gate the whole estate rests on, unchanged and imported rather than
    // rewritten. A permission we cannot quote off the page does not exist.
    if (!grounded(f.evidence, got.text)) {
      dropped.push({ reason: "EVIDENCE_NOT_VERBATIM", permission: f.permission.slice(0, 80), evidence: String(f.evidence ?? "").slice(0, 160) });
      continue;
    }
    claims.push({
      caseId,
      permissionId: id(f.permission),
      permission: f.permission.slice(0, 160),
      authority: f.authority ? String(f.authority).slice(0, 160) : null,
      trigger: f.trigger ? String(f.trigger).slice(0, 300) : null,
      who: f.who ? String(f.who).slice(0, 120) : null,
      exemption: f.exemption ? String(f.exemption).slice(0, 300) : null,
      channel: ["ONLINE", "OFFLINE", "BOTH"].includes(String(f.channel).toUpperCase()) ? String(f.channel).toUpperCase() : null,
      renewal: f.renewal ? String(f.renewal).slice(0, 120) : null,
      evidence: String(f.evidence).slice(0, 600),
      sourceUrl: got.url,
      sourceHost: hostOf(got.url),
    });
  }

  const out = { url: got.url, model: reply?.model ?? null, claims, dropped, asked: Boolean(reply) };
  mkdirSync(at(ANSWERS), { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  return out;
}

// -------------------------------------------------------------------- judge

/**
 * What a case is allowed to claim, and the two ways it is not allowed to.
 *
 * VERIFIED     at least one permission quoted off an official page, with a
 *              condition attached. Anything less is a rumour with a footnote.
 * CONFLICTING  two official hosts describing the same permission with
 *              different triggers. Kept as a finding, never resolved by us:
 *              picking one silently is how a wrong rule gets authority.
 * UNVERIFIED   nothing survived the gate. This is the honest majority and it
 *              stays out of the graph.
 */
export function judge(claims) {
  if (!claims.length) return { status: "UNVERIFIED", conflicts: [] };

  const byPermission = new Map();
  for (const c of claims) {
    const key = c.permissionId ?? c.permission.toLowerCase();
    if (!byPermission.has(key)) byPermission.set(key, []);
    byPermission.get(key).push(c);
  }

  const conflicts = [];
  for (const [key, group] of byPermission) {
    const hosts = new Set(group.map((c) => c.sourceHost));
    if (hosts.size < 2) continue;
    const triggers = new Set(group.map((c) => (c.trigger ?? "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean));
    if (triggers.size > 1) conflicts.push({ permission: key, triggers: [...triggers].slice(0, 4), hosts: [...hosts] });
  }

  const conditional = claims.some((c) => c.trigger || c.exemption);
  return { status: conflicts.length ? "CONFLICTING" : conditional ? "VERIFIED" : "EXTRACTED_PENDING_REVIEW", conflicts };
}

// --------------------------------------------------------------------- run

/**
 * The same words twice, once with the web narrowed to government.
 *
 * Measured on the first two cases: eight results for "FSSAI registration petty
 * food business operator" and seven of them were consultants selling the
 * registration. The open query still runs because it sometimes surfaces the
 * department page a site: filter misses, but on its own it is a search of the
 * industry that has grown around the rule rather than the rule.
 */
export const queriesFor = (kase) => kase.queries.flatMap((q) => [q, `${q} site:gov.in`]);

async function runCase(kase) {
  const searches = [];
  for (const q of queriesFor(kase)) searches.push(await search(q));

  const urls = [];
  const seen = new Set();
  for (const s of searches) {
    for (const r of s.results) {
      const u = normalise(r.url);
      if (!official(u) || wrongState(u) || !readable(u) || seen.has(u)) continue;
      seen.add(u);
      urls.push(u);
    }
  }
  urls.sort((a, b) => rank(a) - rank(b));

  // Six pages that open is a case's budget, and a page that will not open does
  // not spend it. Four of the eight the café case reached came back empty, and
  // it reported "no rules" when what had happened was "no pages" - which is the
  // difference between a gap in the state's website and a gap in this pass, and
  // the report has no way to tell them apart after the fact. A second wave runs
  // only when the first did not fill the budget; sixteen attempts is the
  // ceiling either way.
  //
  // Three at a time. Sequentially it was a government page's twenty second
  // timeout plus a browser render, eight times over, and one case was taking
  // longer than the model work for the whole pass.
  const attempts = [];
  for (const batch of [urls.slice(0, 8), urls.slice(8, 16)]) {
    if (!batch.length || attempts.filter((r) => r && !r.empty).length >= 6) break;
    attempts.push(
      ...(await pool(batch, 3, async (url) => {
        const got = await page(url);
        if (!got.text) return { url, claims: [], dropped: [], empty: true };
        return readPage(kase.id, got, kase.ask);
      })),
    );
  }
  const reads = attempts.filter(Boolean);
  const read = reads.filter((r) => !r.empty).length;

  // The evidence gate again, on the way out.
  //
  // `readPage` caches what survived it, so tightening the gate would otherwise
  // only reach pages nobody has read yet and the artifact would be half old
  // rules and half new ones with nothing saying which. Running it here as well
  // costs a regex per claim and means the report obeys the gate as it stands
  // today, whatever the cache remembers.
  const claims = reads.flatMap((r) => r?.claims ?? []).filter((c) => sentence(c.evidence) && official(c.sourceUrl) && !wrongState(c.sourceUrl));
  const { status, conflicts } = judge(claims);

  return {
    caseId: kase.id,
    ask: kase.ask,
    hypothesis: kase.hypothesis,
    status,
    searched: kase.queries.length,
    officialFound: urls.length,
    read,
    unreadable: reads.filter((r) => r?.empty).length,
    droppedNotVerbatim: reads.reduce((n, r) => n + (r?.dropped?.filter((d) => d.reason === "EVIDENCE_NOT_VERBATIM").length ?? 0), 0),
    permissions: [...new Set(claims.map((c) => c.permission))].slice(0, 12),
    conflicts,
    claims,
    sources: [...new Set(claims.map((c) => c.sourceUrl))],
  };
}

function report(records) {
  const by = (s) => records.filter((r) => r.status === s).length;
  return {
    generatedFrom: "scripts/ingest/edge-cases.mjs",
    promptVersion: PROMPT_VERSION,
    cases: records.length,
    verified: by("VERIFIED"),
    conflicting: by("CONFLICTING"),
    pendingReview: by("EXTRACTED_PENDING_REVIEW"),
    unverified: by("UNVERIFIED"),
    claims: records.reduce((n, r) => n + r.claims.length, 0),
    // Nothing in this file is a graph edge. Saying so in the artifact means a
    // reader who opens it out of context cannot mistake it for one.
    note: "Research only. No claim here is in the citizen graph; promotion is a separate deliberate act.",
    // Claims stay in the artifact rather than only in `facts.jsonl`, so the
    // file a reader opens is the file a test can check: a report that says
    // VERIFIED and cannot show the quote is the thing this whole pass exists
    // to stop somebody doing.
    records,
  };
}

/**
 * The same findings, for a person.
 *
 * `docs/research/` is where this repo puts what a human has to read, and it is
 * committed while `.graph/` is not, so this is the only part of the pass a
 * reviewer sees without running it. Nothing reads it at runtime: it is a record
 * of what was found and what was not, quotes attached, so the gaps are as
 * visible as the answers.
 */
export function markdown(on) {
  const lines = [
    "# Fifty ordinary sentences, and what they actually trigger",
    "",
    "Generated by `pnpm edge:research`. Research only: no claim below is in the",
    "citizen graph, and nothing here is read at runtime. Every quote is a verbatim",
    "substring of the page it cites, through the same gate as the rest of the estate.",
    "",
    `${on.cases} cases — **${on.verified} verified**, ${on.conflicting} conflicting, ${on.pendingReview} pending review, ${on.unverified} unverified, ${on.claims} grounded claims.`,
    "",
  ];
  for (const r of on.records) {
    lines.push(`## ${r.caseId} — ${r.ask}`, "", `**${r.status}**. ${r.officialFound} official page(s) found, ${r.read} read, ${r.unreadable} would not open.`, "");
    lines.push(`_Hypothesis (never ingested): ${r.hypothesis}_`, "");
    if (!r.claims?.length) {
      lines.push("Nothing survived the gate. This is a gap, not an absence of rules.", "");
      continue;
    }
    for (const c of r.claims.slice(0, 8)) {
      lines.push(`- **${c.permission}**${c.authority ? ` — ${c.authority}` : ""}`);
      if (c.trigger) lines.push(`  - when: ${c.trigger}`);
      if (c.exemption) lines.push(`  - exemption: ${c.exemption}`);
      if (c.renewal) lines.push(`  - renewal: ${c.renewal}`);
      lines.push(`  - > ${c.evidence.replace(/\s+/g, " ")}`, `  - ${c.sourceUrl}`);
    }
    for (const k of r.conflicts ?? []) lines.push(`- **CONFLICTING** ${k.permission}: ${k.triggers.join(" / ")} (${k.hosts.join(", ")})`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  mkdirSync(at(SEARCHES), { recursive: true });
  mkdirSync(at(ANSWERS), { recursive: true });
  mkdirSync(RESEARCH, { recursive: true });

  if (flag("report") || flag("markdown")) {
    if (!existsSync(REPORT)) return console.error("nothing on disk yet. run pnpm edge:research first.");
    const on = JSON.parse(readFileSync(REPORT, "utf8"));
    if (flag("markdown")) {
      writeFileSync(at("docs/research/edge-cases.md"), markdown(on));
      return console.log(`docs/research/edge-cases.md — ${on.cases} case(s), ${on.claims} claim(s)`);
    }
    console.log(`${on.cases} cases: ${on.verified} verified, ${on.conflicting} conflicting, ${on.pendingReview} pending review, ${on.unverified} unverified, ${on.claims} grounded claims`);
    for (const r of on.records) console.log(`  ${r.caseId} ${r.status.padEnd(24)} ${r.permissions.slice(0, 3).join("; ") || "-"}`);
    return;
  }

  const only = value("case");
  const limit = Number(value("limit", "0")) || 0;
  let todo = CASES;
  if (only) todo = todo.filter((c) => c.id === only);
  if (limit) todo = todo.slice(0, limit);

  console.log(`${todo.length} case(s), ${todo.reduce((n, c) => n + queriesFor(c).length, 0)} searches`);
  const records = [];
  // Five cases at a time. A case is mostly waiting on government web servers,
  // and one of them times out at twenty seconds often enough that doing them in
  // a line put the whole pass at over two hours.
  await pool(todo, 5, async (kase) => {
    const record = await runCase(kase);
    records.push(record);
    console.log(`  ${record.caseId} ${record.status} — ${record.claims.length} grounded claim(s) from ${record.sources.length} source(s), ${record.officialFound} official page(s) found`);
    if (record.claims.length) appendJsonl(FACTS, record.claims);
    // Written every case rather than at the end: a run that dies at case 40
    // has still learned thirty-nine things and there is no reason to lose them.
    records.sort((a, b) => a.caseId.localeCompare(b.caseId));
    writeFileSync(REPORT, JSON.stringify(report(records), null, 2));
  });

  const done = report(records);
  console.log(`${done.verified} verified, ${done.conflicting} conflicting, ${done.pendingReview} pending review, ${done.unverified} unverified`);
  console.log(`report: ${REPORT}`);
}

function selftest() {
  const ids = CASES.map((c) => c.id);
  console.assert(new Set(ids).size === ids.length, "case ids must be unique");
  console.assert(CASES.every((c) => c.ask && c.hypothesis && c.queries.length), "every case needs a sentence, a hypothesis and queries");

  // A query that already contains the answer can only find the answer it was
  // given. The hypothesis is ours; the search terms must be the citizen's.
  console.assert(
    CASES.every((c) => !c.queries.some((q) => /peso|aerb|cgwa/i.test(q) && !/^(peso|aerb|cgwa)/i.test(q.trim()))),
    "search terms should name the activity, not the acronym we expect",
  );

  console.assert(official("https://gpcb.gujarat.gov.in/x") && official("https://services.india.gov.in/y"), "official hosts");
  console.assert(!official("https://cleartax.in/licence") && !official("https://notgov.in.example.com/a"), "a lookalike is not official");

  // The gate is the imported one, not a copy: a paraphrase fails, a bolded
  // quote passes, and neither behaviour is defined in this file.
  console.assert(grounded("licence is required for storage", "A **licence** is required for storage of petroleum."), "markup normalised");
  console.assert(!grounded("a licence is needed for storing", "A licence is required for storage."), "paraphrase rejected");

  console.assert(tidyPdfText("a  \n\n\n b \r\n b \n") === "a\nb", "same tidy as pdf-extract: collapsed, trimmed, duplicates dropped");
  console.assert(isPdf("https://ifp.gujarat.gov.in/IC/StaticAttachment?AttachmentFileName=/pdf/a/23_x.pdf"), "a pdf behind a query string is still a pdf");
  console.assert(!isPdf("https://x.gov.in/pdf-guide"), "a word is not an extension");

  console.assert(!wrongState("https://www.nsws.gov.in/portal/approval-details/jammu-and-kashmir/x") === false, "another state's page is another state's answer");
  console.assert(!wrongState("https://ifp.gujarat.gov.in/IC/x"), "Gujarat is not another state");
  console.assert(!wrongState("https://fssai.gov.in/cms/registration.php"), "a central regulator names no state");
  console.assert(rank("https://ifp.gujarat.gov.in/a") < rank("https://fssai.gov.in/b"), "Gujarat before the centre");
  console.assert(rank("https://fssai.gov.in/b") < rank("https://nsws.gov.in/c"), "the regulator before the aggregator");

  console.assert(!sentence("Shops and Establishment License Application Form-A"), "a form name is not a rule");
  console.assert(!sentence("FL ON License for club, theatre, public resort etc and others"), "a row of a licence menu is not a rule");
  console.assert(!sentence("Form No. II [See rule 18(1)] Certificate of Registration under section 7"), "a row of a table of forms is not a rule either");
  console.assert(!sentence("Registration of Motor transport undertaking | Section 3 of the Act applies"), "a row of a table of contents is not a rule");
  console.assert(!sentence("Applications Under Contract Labour Act Registration Application License Application License Renew Application Application for amendment in registration"), "a sidebar is not a rule");
  console.assert(sentence("Registration is compulsory for principal employer to employ 10 or more contract labours."), "and a rule with a threshold in it survives all of that");
  console.assert(!readable("https://dda.gov.in/sites/default/files/LandDisposal/rpf_document_restaurant.pdf"), "a document a bidder must win is not a rule");
  console.assert(!readable("https://fssai.gov.in/upload/Draft_Notice_Comments_Food_School_Children.pdf"), "a draft out for comments is not in force");
  console.assert(wrongState("https://excise.wb.gov.in/FAQ/category_licen.aspx"), "a state code is a state");
  console.assert(!wrongState("https://ceiced.gujarat.gov.in/x") && !wrongState("https://peso.gov.in/y"), "Gujarat and the centre are not");
  console.assert(wrongState("https://hrylabour.gov.in/x") && wrongState("https://pblabour.gov.in/y"), "a state code welded to its department is a state");
  console.assert(wrongState("https://www.ghmc.gov.in/z"), "somebody else's municipal corporation is somebody else's");
  console.assert(!official("https://www.tceq.texas.gov/assistance/industry/pst/exclusions"), "a .gov is not an Indian government page");
  console.assert(official("https://ceiced.gujarat.gov.in/lift") && official("https://clc.gov.in/x"), "these are");
  console.assert(!wrongState("https://upsc.gov.in/a") && !wrongState("https://apeda.gov.in/b") && !wrongState("https://clc.gov.in/c"), "the centre is not a state that starts the same way");
  console.assert(!readable("https://www.startupindia.gov.in/content/sih/en/bloglist/blogs/all_about_food_licensing.html"), "a blog on a gov domain is a blog");
  console.assert(readable("https://excise.gujarat.gov.in/faq.htm"), "an FAQ a department maintains is not");
  console.assert(sentence("A licence is required for the storage of petroleum in excess of 2500 litres."), "a rule is");

  console.assert(judge([]).status === "UNVERIFIED", "no claims is not a finding");
  console.assert(judge([{ permission: "Fire NOC", permissionId: "fire_noc", trigger: "buildings above 15m", sourceHost: "a.gov.in" }]).status === "VERIFIED", "a conditional claim verifies");
  console.assert(judge([{ permission: "Fire NOC", permissionId: "fire_noc", trigger: "above 15m", sourceHost: "a.gov.in" }, { permission: "Fire NOC", permissionId: "fire_noc", trigger: "above 9m", sourceHost: "b.gov.in" }]).status === "CONFLICTING", "two official hosts, two triggers");
  console.assert(judge([{ permission: "Fire NOC", permissionId: "fire_noc", trigger: "above 15m", sourceHost: "a.gov.in" }, { permission: "Fire NOC", permissionId: "fire_noc", trigger: "above 15m", sourceHost: "b.gov.in" }]).conflicts.length === 0, "agreement is not a conflict");

  console.log("edge-cases ok");
}

if (isMain) {
  if (flag("selftest")) selftest();
  else await main();
}
