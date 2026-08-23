/**
 * Where a page is, and what to call the thing it is about.
 *
 * Lifted out of services-compile because offices-discover needs exactly the
 * same answers and a second copy of the district table is a second copy that
 * drifts. Nothing here fetches, models or writes: it is string handling with a
 * gazetteer, so both scripts can import it without importing a pipeline.
 */

export const DISTRICTS = [
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
export const ALIASES = {
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
 * Longest pattern first: "dwarka" and "devbhoomidwarka" both point at the same
 * district, but "somnath" must not be tested before "girsomnath" on a host that
 * has both.
 */
const PATTERNS = [
  ...DISTRICTS.map((d) => [d.toLowerCase().replace(/_/g, ""), d]),
  ...Object.entries(ALIASES),
].sort((a, b) => b[0].length - a[0].length);

/**
 * Which district a host belongs to, or the state.
 *
 * `collectorkheda.gujarat.gov.in` is Kheda's collectorate and its page about the
 * varsai certificate describes Kheda's counter, not Gujarat's. Scoping it to
 * `IN-GJ` would tell someone in Surat to visit an office in Kheda, so the
 * hostname is worth reading.
 */
export function districtOf(host) {
  const flat = String(host ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const hit = PATTERNS.find(([pattern]) => flat.includes(pattern));
  return hit ? `IN-GJ-${hit[1]}` : "IN-GJ";
}

/** The district named inside a piece of text, or null. Word boundaries, not substrings. */
export function districtIn(text) {
  const s = ` ${String(text ?? "").toLowerCase().replace(/[^a-z]+/g, " ")} `;
  for (const [pattern, district] of PATTERNS) {
    if (s.includes(` ${pattern} `)) return `IN-GJ-${district}`;
  }
  return null;
}

export const slug = (s) =>
  String(s ?? "")
    .toLowerCase()
    // One page writes "Chief Minister's Matru Shakti Yojana", the next writes
    // "Chief Minister Matru Shakti Yojana", and both are the same scheme. The
    // possessive goes with the apostrophe, or they stay two services differing
    // by one letter and a citizen sees the scheme listed twice.
    .replace(/['‘’]s\b/g, "")
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

export const title = (s) =>
  String(s ?? "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

/**
 * A name the model returned in lower case, capitalised for a human to read.
 *
 * Some pages say "varshai" in a url slug and nowhere else, so that is what comes
 * back, and "varshai" is what a citizen would then see on their screen. Only
 * applied when there is no capital anywhere: a name that already has one was
 * copied off the page and its capitalisation is the page's, not ours to improve.
 */
export const display = (s) => (/[A-Z]/.test(s) ? s : s.replace(/\b[a-z]/g, (c) => c.toUpperCase()));

/**
 * True if this is the name of a person rather than of a place.
 *
 * Directory pages list the officer next to the office, and the extractor
 * dutifully wrote both into `detail.name`. That is how the graph came to hold
 * `office:dr_prashant_jilova_ias` with a Collectorate address, which tells a
 * citizen to go and visit a man. He will be transferred; the office will not.
 *
 * Honorifics and service suffixes only, both of which are printed on Indian
 * government pages as a matter of form. No attempt to recognise a name as a
 * name: "Anand Nandurbarkar" is indistinguishable from a place by spelling and
 * we would rather keep a stray person than drop a real office.
 */
const HONORIFIC = /^\s*(dr|shri|shree|smt|shrimati|mr|mrs|ms|prof|sri|kum|thiru|હો?ન|શ્રી|શ્રીમતી|ડૉ|ડો)\b\.?\s/i;
const SERVICE_CADRE = /[,(]\s*(i\.?a\.?s|i\.?p\.?s|i\.?f\.?s|g\.?a\.?s|g\.?p\.?s|r\.?a\.?s)\.?\s*[).]?\s*$/i;

export const isPerson = (name) => {
  const s = String(name ?? "").trim();
  return HONORIFIC.test(s) || SERVICE_CADRE.test(s);
};
