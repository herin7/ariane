/**
 * What we think every Gujarat government host is, and why we think it.
 *
 * Makes zero network calls, on purpose and permanently. Everything here comes
 * from files that were captured once:
 *
 *   docs/research/domains/gujarat-hosts.txt                what exists
 *   docs/research/domains/gswan-department-directory.tsv   what it does
 *   docs/research/domains/observed.tsv                     what it said it was
 *
 * The second one is the trick. The state publishes its own department to URL
 * mapping, so ~250 hosts get an official name for free and we never have to
 * fetch a page to find out what it is. The third is written by
 * `pnpm domains:classify`, which reads the title of the hosts the first two
 * cannot explain. Everything else falls back to naming convention, which is a
 * guess and is labelled as one.
 *
 * A host in here means "this address exists and this is our best read of it".
 * It does NOT mean anyone extracted a fact from it, and nothing in here may
 * ever be cited as evidence to a citizen. Evidence lives in the research JSON
 * with a verbatim quote and a retrieval date. Keep the two apart.
 *
 * Lives in its own file because both the renderer and the classifier need it,
 * and the classifier working off the rendered markdown would mean parsing our
 * own report to find out what we already knew.
 */

import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => {
  try {
    return readFileSync(new URL(p, root), "utf8");
  } catch {
    return "";
  }
};
const lines = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

export function hostOf(url) {
  const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export const CATEGORIES = [
  ["DEPARTMENT", "Departments, directorates, boards and corporations"],
  ["SERVICE_PORTAL", "Transactional service portals"],
  ["DISTRICT_COLLECTOR", "District collectorates"],
  ["DISTRICT_PANCHAYAT", "District panchayats"],
  ["MUNICIPAL", "Municipal corporations"],
  ["POLICE", "Police and home"],
  ["TRANSPORT_RTO", "Transport offices"],
  ["EDUCATION", "Universities, boards and institutes"],
  ["JUDICIARY", "Courts and tribunals"],
  ["UNCLASSIFIED", "Named but unclassified"],
  ["INFRASTRUCTURE", "Infrastructure and non public hosts"],
  ["DEAD", "Hosts that no longer resolve"],
];

/**
 * Naming convention, applied only where the directory says nothing.
 *
 * Order matters: the first rule that matches wins, so the specific patterns
 * (collector, sp, dp) sit above the catch alls. Every one of these is a guess
 * off a string, which is why the output marks the source of each verdict.
 */
const RULES = [
  // Not citizen facing. Recording them is the point: "we looked and it is
  // plumbing" is a real answer that stops the next person re-checking.
  [/^(ns\d|mx\d?|smtp|imap|pop3?|mail\d?|webmail|postmaster|autodiscover|autoconfig|relay|lb\d|vpn|proxy|firewall|router|gateway|grafana|zabbix|nagios|monitor|backup|cpanel|whm|ftp|sftp|ssh|git|jenkins|nexus|repo|edge|cdn|static|assets|images|img)\b/, "INFRASTRUCTURE"],
  [/^(dev|test|testing|qa|uat|staging|stage|beta|alpha|demo|sandbox|preview|temp|tmp|old|new|new\d|backup|bak|archive|private|internal|intranet|v\d)\b/, "INFRASTRUCTURE"],
  // The same words as a suffix, which is how most of them actually appear:
  // enagaruat, garvibeta, cybertreasuryuat. A staging copy of a citizen portal
  // is still not a citizen portal.
  [/(uat|beta|test|staging|demo|sandbox|dev)\d*\.gujarat\.gov\.in$/, "INFRASTRUCTURE"],
  // Named boxes rather than named services: guj-gnr-hub01, gswan-vc-expe01.
  [/-[a-z]*\d{2,}\.gujarat\.gov\.in$/, "INFRASTRUCTURE"],
  // And the same words run straight into the name with no separator at all:
  // testdigitalgujarat, stagingefps, stagingipds. The \b rules above miss those
  // because there is no boundary between "test" and "digital", which let a
  // staging copy of Digital Gujarat through wearing the production site's name.
  // Only the four words nothing here legitimately starts with: `dev` and `demo`
  // and `beta` would eat devbhoomi and betivadhaao.
  [/^(test|uat|staging|sandbox)/, "INFRASTRUCTURE"],

  [/^collector/, "DISTRICT_COLLECTOR"],
  [/dp\.gujarat\.gov\.in$/, "DISTRICT_PANCHAYAT"],
  [/^(sp|cp)[a-z]/, "POLICE"],
  [/^(police|acb|prisons|prohibition-excise|dgp)/, "POLICE"],
  [/^a?rto/, "TRANSPORT_RTO"],
  [/^(nagarpalika|municipal|amc|smc|vmc|rmc|bmc|jmc|gmc)\b/, "MUNICIPAL"],
  [/municipal|nagarpalika|city\.gov/, "MUNICIPAL"],
  [/^(ojas|digitalgujarat|eservices|online|apply|portal|seva|citizen)/, "SERVICE_PORTAL"],
];

/** Directory department -> category, for the hosts the state already named. */
function categoriseNamed(entry) {
  const n = entry.name.toLowerCase();
  if (n.startsWith("collector office")) return "DISTRICT_COLLECTOR";
  if (n.includes("district panchayat")) return "DISTRICT_PANCHAYAT";
  if (n.includes("municipal corporation")) return "MUNICIPAL";
  if (/police|vigilance|prison|anti curruption|prosecution/.test(n)) return "POLICE";
  if (/transport|rto/.test(n)) return "TRANSPORT_RTO";
  return "DEPARTMENT";
}

export function buildRegistry() {
  const hosts = [...new Set(lines(read("docs/research/domains/gujarat-hosts.txt")).map((h) => h.toLowerCase()))].sort();

  /** host -> { department, name, urls[] }, from the state's own directory. */
  const directory = new Map();
  for (const line of lines(read("docs/research/domains/gswan-department-directory.tsv"))) {
    const [department, name, url] = line.split("\t");
    if (!url) continue;
    const host = hostOf(url);
    if (!host) continue;
    const entry = directory.get(host) ?? { department, name, urls: [] };
    // Several directory rows share a host (sje.gujarat.gov.in has twelve). The
    // first row names the host; the rest are sections of the same site.
    entry.urls.push(url);
    directory.set(host, entry);
  }

  /** host -> what the host itself said, written by `pnpm domains:classify`. */
  const observed = new Map();
  for (const line of lines(read("docs/research/domains/observed.tsv"))) {
    const [host, category, name, tier, evidence] = line.split("\t");
    if (!host || !category) continue;
    observed.set(host.toLowerCase(), { category, name: name || null, tier: tier || "?", evidence: evidence || "" });
  }

  /**
   * Leftmost label -> directory entry, for the same body on a second domain.
   *
   * The directory lists `gpcb.gov.in`, the enumeration found
   * `gpcb.gujarat.gov.in`, and they are the Gujarat Pollution Control Board
   * either way. Matching on the leftmost label recovers a few dozen of those
   * without inventing a single fact: the name still comes from the government,
   * we just noticed it answers on two addresses.
   *
   * Only labels of four characters or more, because `dol` and `dop` and `cos`
   * are short enough to collide by accident and a wrong name is worse than none.
   */
  const byLabel = new Map();
  for (const [host, entry] of directory) {
    const label = host.split(".")[0];
    if (label.length < 4) continue;
    byLabel.set(label, byLabel.has(label) ? null : entry); // null marks ambiguous
  }

  /**
   * District names, read off the directory rather than typed here.
   *
   * "Collector Office Amreli" and "Amreli District Panchayat" both say Amreli,
   * so the state's own file is the district list and `amreli.gujarat.gov.in`
   * can be recognised as a collectorate. Same reason jurisdictions are rows and
   * not an array in a component: the day a district splits, nobody edits code.
   */
  const districts = new Set();
  for (const entry of directory.values()) {
    const m = /^Collector Office (.+)$/.exec(entry.name) ?? /^(.+?) District Panchayat$/.exec(entry.name);
    if (m) districts.add(m[1].toLowerCase().replace(/\s+/g, ""));
  }

  const classify = (host) => {
    const entry = directory.get(host);
    if (entry) {
      return {
        host,
        category: categoriseNamed(entry),
        name: entry.name,
        department: entry.department,
        // Extra rows on the same host are sections of that site, worth keeping
        // because they are deep links the research pass can start from.
        sections: entry.urls.length > 1 ? entry.urls.length : 0,
        basis: "GSWAN directory",
      };
    }
    // Infrastructure first: a staging copy of a named portal is still plumbing,
    // and letting the alias match name it would put it in a citizen facing list.
    const rule = RULES.find(([pattern]) => pattern.test(host));
    if (rule) return { host, category: rule[1], name: null, department: null, sections: 0, basis: "naming convention" };

    const label = host.split(".")[0];

    const alias = byLabel.get(label);
    if (alias) {
      return { host, category: categoriseNamed(alias), name: alias.name, department: alias.department, sections: 0, basis: "same body, second address" };
    }

    if (districts.has(label)) {
      return { host, category: "DISTRICT_COLLECTOR", name: null, department: "Revenue", sections: 0, basis: "district name from directory" };
    }

    // Last, and only for hosts nothing above could explain. A title read off a
    // live page is weaker than the state's own directory and is labelled as
    // such, down to which tier of the ladder was cheap enough to settle it.
    const seenIt = observed.get(host);
    if (seenIt) {
      return { host, category: seenIt.category, name: seenIt.name, department: null, sections: 0, basis: `${seenIt.tier}, page said "${seenIt.evidence}"`.slice(0, 160) };
    }

    return { host, category: "UNCLASSIFIED", name: null, department: null, sections: 0, basis: "unknown" };
  };

  const registry = hosts.map(classify);

  // The directory also names hosts that never showed up in the enumeration.
  // A published government URL we have not seen is more interesting than one we
  // have, so it goes in rather than getting dropped for being off the list.
  const seen = new Set(hosts);
  for (const [host, entry] of directory) {
    if (seen.has(host)) continue;
    registry.push({
      host,
      category: categoriseNamed(entry),
      name: entry.name,
      department: entry.department,
      sections: entry.urls.length > 1 ? entry.urls.length : 0,
      basis: "GSWAN directory, not in host capture",
    });
  }
  registry.sort((a, b) => a.host.localeCompare(b.host));
  return registry;
}
