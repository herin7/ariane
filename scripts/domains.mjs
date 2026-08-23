/**
 * Build the Gujarat government domain registry.
 *
 *   pnpm domains:build     # writes docs/gujarat-domains.md
 *   pnpm domains:build --check   # fails if the file on disk is stale
 *
 * Makes zero network calls, on purpose and permanently. Everything here comes
 * from two files that were captured once:
 *
 *   docs/research/domains/gujarat-hosts.txt            what exists
 *   docs/research/domains/gswan-department-directory.tsv   what it does
 *
 * The second one is the trick. The state publishes its own department to URL
 * mapping, so ~250 hosts get an official name for free and we never have to
 * fetch a page to find out what it is. Everything the directory does not cover
 * falls back to naming convention, which is a guess and is labelled as one.
 *
 * A host in here means "this address exists and this is our best read of it".
 * It does NOT mean anyone fetched it, and nothing in this file may ever be
 * cited as evidence to a citizen. Evidence lives in the research JSON with a
 * verbatim quote and a retrieval date. Keep the two apart.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const lines = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

// ------------------------------------------------------------------ the inputs

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
 * "Collector Office Amreli" and "Amreli District Panchayat" both say Amreli, so
 * the state's own file is the district list and `amreli.gujarat.gov.in` can be
 * recognised as a collectorate. Same reason jurisdictions are rows and not an
 * array in a component: the day a district splits, nobody edits code.
 */
const districts = new Set();
for (const entry of directory.values()) {
  const m = /^Collector Office (.+)$/.exec(entry.name) ?? /^(.+?) District Panchayat$/.exec(entry.name);
  if (m) districts.add(m[1].toLowerCase().replace(/\s+/g, ""));
}

function hostOf(url) {
  const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- classification

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
function categoriseNamed(host, entry) {
  const n = entry.name.toLowerCase();
  if (n.startsWith("collector office")) return "DISTRICT_COLLECTOR";
  if (n.includes("district panchayat")) return "DISTRICT_PANCHAYAT";
  if (n.includes("municipal corporation")) return "MUNICIPAL";
  if (/police|vigilance|prison|anti curruption|prosecution/.test(n)) return "POLICE";
  if (/transport|rto/.test(n)) return "TRANSPORT_RTO";
  return "DEPARTMENT";
}

const CATEGORIES = [
  ["DEPARTMENT", "Departments, directorates, boards and corporations"],
  ["SERVICE_PORTAL", "Transactional service portals"],
  ["DISTRICT_COLLECTOR", "District collectorates"],
  ["DISTRICT_PANCHAYAT", "District panchayats"],
  ["MUNICIPAL", "Municipal corporations"],
  ["POLICE", "Police and home"],
  ["TRANSPORT_RTO", "Transport offices"],
  ["UNCLASSIFIED", "Named but unclassified"],
  ["INFRASTRUCTURE", "Infrastructure and non public hosts"],
];

const registry = hosts.map((host) => {
  const entry = directory.get(host);
  if (entry) {
    return {
      host,
      category: categoriseNamed(host, entry),
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
    return {
      host,
      category: categoriseNamed(host, alias),
      name: alias.name,
      department: alias.department,
      sections: 0,
      basis: "same body, second address",
    };
  }

  if (districts.has(label)) {
    return {
      host,
      category: "DISTRICT_COLLECTOR",
      name: null,
      department: "Revenue",
      sections: 0,
      basis: "district name from directory",
    };
  }

  return { host, category: "UNCLASSIFIED", name: null, department: null, sections: 0, basis: "unknown" };
});

// The directory also names hosts that never showed up in the enumeration.
// A published government URL we have not seen is more interesting than one we
// have, so it goes in rather than getting dropped for being off the list.
const seen = new Set(hosts);
for (const [host, entry] of directory) {
  if (seen.has(host)) continue;
  registry.push({
    host,
    category: categoriseNamed(host, entry),
    name: entry.name,
    department: entry.department,
    sections: entry.urls.length > 1 ? entry.urls.length : 0,
    basis: "GSWAN directory, not in host capture",
  });
}
registry.sort((a, b) => a.host.localeCompare(b.host));

// ------------------------------------------------------------------ the output

const count = (c) => registry.filter((r) => r.category === c).length;
const named = registry.filter((r) => r.name).length;

const out = [];
out.push("# Gujarat government websites");
out.push("");
out.push("Generated by `pnpm domains:build`. Do not edit by hand, the edit will be");
out.push("overwritten. Change the inputs instead:");
out.push("");
out.push("- `docs/research/domains/gujarat-hosts.txt` for hosts that exist");
out.push("- `docs/research/domains/gswan-department-directory.tsv` for what they do");
out.push("");
out.push("**Nothing here has been fetched.** This is a map of where to look, built from a");
out.push("host capture and the state's own published department directory. It is not");
out.push("evidence and must never be cited to a citizen: a claim about a fee, a document");
out.push("or an eligibility rule needs a verbatim quote and a retrieval date in the");
out.push("research JSON, which is a different file for a reason.");
out.push("");
out.push(`${registry.length} hosts, ${named} of them named by the government itself.`);
out.push("");
out.push("| Category | Hosts |");
out.push("| --- | ---: |");
for (const [key, label] of CATEGORIES) {
  const n = count(key);
  if (n) out.push(`| ${label} | ${n} |`);
}
out.push(`| **Total** | **${registry.length}** |`);
out.push("");

for (const [key, label] of CATEGORIES) {
  const rows = registry.filter((r) => r.category === key);
  if (!rows.length) continue;
  out.push(`## ${label}`);
  out.push("");
  if (key === "INFRASTRUCTURE") {
    out.push("Mail, DNS, load balancers, staging copies and build tooling. Listed so nobody");
    out.push("spends an afternoon working out whether `ns2` is a citizen service.");
    out.push("");
  }
  if (key === "UNCLASSIFIED") {
    out.push("Real hosts the department directory does not cover and no naming rule matches.");
    out.push("This is the work queue: each one needs a human to say what it is, and that is");
    out.push("one line added to the TSV, not a scrape.");
    out.push("");
  }
  out.push("| Host | What it is | Department | Basis |");
  out.push("| --- | --- | --- | --- |");
  for (const r of rows) {
    const name = r.name ? (r.sections ? `${r.name} (+${r.sections - 1} sections)` : r.name) : "_not yet identified_";
    out.push(`| \`${r.host}\` | ${name} | ${r.department ?? "-"} | ${r.basis} |`);
  }
  out.push("");
}

const markdown = out.join("\n");
const target = fileURLToPath(new URL("docs/gujarat-domains.md", root));

if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(target, "utf8");
    } catch {
      return null;
    }
  })();
  if (current !== markdown) {
    console.error("docs/gujarat-domains.md is stale. Run: pnpm domains:build");
    process.exit(1);
  }
  console.log(`docs/gujarat-domains.md is current, ${registry.length} hosts`);
} else {
  writeFileSync(target, markdown);
  console.log(`docs/gujarat-domains.md written, ${registry.length} hosts, ${named} named`);
  for (const [key, label] of CATEGORIES) {
    const n = count(key);
    if (n) console.log(`  ${String(n).padStart(4)}  ${label}`);
  }
}
